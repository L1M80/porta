# One-time setup for the identity-scoped Porta + Cloudflare watchdog.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $PublicHost,

    [ValidateRange(1, 65535)]
    [int] $OriginPort = 3070,

    [ValidateRange(1, 65535)]
    [int] $ProxyPort = 3170,

    [ValidateRange(1, 65535)]
    [int] $TunnelMetricsPort = 20241,

    [ValidateNotNullOrEmpty()]
    [string] $CloudflaredConfig = (Join-Path $env:USERPROFILE '.cloudflared\config.yml'),

    [ValidateNotNullOrEmpty()]
    [string] $BinDir = (Join-Path $env:USERPROFILE 'bin'),

    [string] $PnpmVersion = '11.15.1',

    [ValidateRange(1, 1440)]
    [int] $IntervalMinutes = 5,

    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string] $TaskName = 'PortaWatchdog'
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir '..\..'))
$EnvFile = Join-Path $RepoRoot '.env'
$CloudflaredConfig = [System.IO.Path]::GetFullPath($CloudflaredConfig)
$BinDir = [System.IO.Path]::GetFullPath($BinDir)
if ($BinDir.Contains(';')) {
    throw 'BinDir cannot contain a semicolon because it is added to PATH.'
}
$WatchdogScript = Join-Path $ScriptDir 'porta-watchdog.ps1'
$LegacyWatchdogScript = Join-Path $ScriptDir 'silent-watchdog.vbs'
$RunnerScript = Join-Path $ScriptDir 'managed-runner.ps1'

. (Join-Path $ScriptDir 'watchdog-common.ps1')

$InstanceId = Get-PortaInstanceId -RepoRoot $RepoRoot -TaskName $TaskName
$StateDirectory = Get-PortaStateDirectory -InstanceId $InstanceId

if ($PublicHost.Contains('://') -or $PublicHost.Contains('/') -or $PublicHost.Contains('\') -or
    $PublicHost.Contains(':') -or $PublicHost -notmatch '^[A-Za-z0-9.-]+$') {
    throw 'PublicHost must be one hostname only, without a scheme, port, path, or wildcard.'
}
$distinctPorts = @($OriginPort, $ProxyPort, $TunnelMetricsPort) | Select-Object -Unique
if (@($distinctPorts).Count -ne 3) {
    throw 'OriginPort, ProxyPort, and TunnelMetricsPort must use three different ports.'
}

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw "Missing $EnvFile. Copy .env.example to .env and configure the public deployment first."
}
if (-not (Test-Path -LiteralPath $CloudflaredConfig -PathType Leaf)) {
    throw "Cloudflared config does not exist: $CloudflaredConfig"
}

$envValues = Read-PortaEnvFile -Path $EnvFile
$requireAuth = [string] $envValues['PORTA_REQUIRE_AUTH']
if ($requireAuth -notmatch '^(?i:1|true|yes|on)$') {
    throw 'PORTA_REQUIRE_AUTH must be enabled with 1, true, yes, or on before installing the public watchdog.'
}

$accessToken = [string] $envValues['PORTA_ACCESS_TOKEN']
if ($accessToken.Length -lt 32) {
    throw 'PORTA_ACCESS_TOKEN must contain at least 32 characters.'
}

$configuredWebPort = [string] $envValues['PORTA_WEB_PORT']
if ($configuredWebPort -ne [string] $OriginPort) {
    throw "PORTA_WEB_PORT must be $OriginPort to match the watchdog and tunnel."
}

$configuredProxyPort = [string] $envValues['PORTA_PORT']
if ($configuredProxyPort -ne [string] $ProxyPort) {
    throw "PORTA_PORT must be $ProxyPort to match the watchdog health check."
}

$configuredHost = [string] $envValues['PORTA_HOST']
if ($configuredHost -ne '127.0.0.1') {
    throw 'This tunnel recipe requires PORTA_HOST=127.0.0.1.'
}

$allowedHosts = @(([string] $envValues['PORTA_ALLOWED_HOSTS']).Split(',') |
    ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($allowedHosts -contains '*' -or $allowedHosts -contains 'true' -or $allowedHosts -contains 'all') {
    throw 'PORTA_ALLOWED_HOSTS must list the exact public hostname; wildcards are not allowed by this recipe.'
}
if ($allowedHosts -notcontains $PublicHost) {
    throw "PORTA_ALLOWED_HOSTS must contain the exact hostname '$PublicHost'."
}

$publicOrigin = "https://$PublicHost"
$corsOrigins = @(([string] $envValues['PORTA_CORS_ORIGINS']).Split(',') |
    ForEach-Object { $_.Trim() } | Where-Object { $_ })
if (-not @($corsOrigins | Where-Object { $_ -ceq $publicOrigin })) {
    throw "PORTA_CORS_ORIGINS must contain '$publicOrigin'."
}

Assert-PortaCloudflaredIngress -CloudflaredConfig $CloudflaredConfig `
    -PublicOrigin $publicOrigin -OriginPort $OriginPort

$preflightProblems = New-Object 'System.Collections.Generic.List[string]'
$existingTask = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName `
    -ErrorAction SilentlyContinue
if ($null -ne $existingTask) {
    $taskOwnership = Get-PortaScheduledTaskOwnership -Task $existingTask `
        -TaskName $TaskName -WatchdogScript $WatchdogScript `
        -LegacyWatchdogScript $LegacyWatchdogScript
    if ($taskOwnership -eq 'current') {
        $preflightProblems.Add(
            "The current checkout already owns scheduled task '\$TaskName'. " +
            'Run stop-watchdog.ps1 before reinstalling it.'
        )
    }
    elseif ($taskOwnership -eq 'legacy') {
        $preflightProblems.Add(
            "The legacy watchdog task '\$TaskName' still exists for this checkout. " +
            'Run stop-watchdog.ps1, then stop any legacy-compatible launchers it reports.'
        )
    }
    else {
        $preflightProblems.Add(
            "Scheduled task '\$TaskName' is not owned by this checkout. " +
            'Choose another -TaskName or inspect the existing task manually.'
        )
    }
}

$untrackedLaunchers = @(Get-PortaUntrackedBatchLaunchers -ScriptDirectory $ScriptDir `
    -StateDirectory $StateDirectory -InstanceId $InstanceId -RunnerScript $RunnerScript)
foreach ($launcher in $untrackedLaunchers) {
    $preflightProblems.Add(
        "Untracked $($launcher.Component) launcher PID $($launcher.ProcessId) is using " +
        "this checkout's run-$($launcher.Component).bat."
    )
}

$portaRunner = Get-PortaManagedRunner -StateDirectory $StateDirectory -Component porta `
    -InstanceId $InstanceId -RunnerScript $RunnerScript `
    -CommandScript (Join-Path $ScriptDir 'run-porta.bat')
foreach ($port in @($OriginPort, $ProxyPort)) {
    $listenerPids = @(Get-NetTCPConnection -LocalPort $port -State Listen `
        -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($listenerPid in $listenerPids) {
        $isManagedListener = $null -ne $portaRunner -and
            (Test-PortaProcessDescendant -ProcessId ([int] $listenerPid) `
                -AncestorProcessId ([int] $portaRunner.runnerPid))
        if (-not $isManagedListener) {
            $preflightProblems.Add(
                "Untracked process PID $listenerPid is already listening on required port $port."
            )
        }
    }
}

$tunnelRunner = Get-PortaManagedRunner -StateDirectory $StateDirectory -Component tunnel `
    -InstanceId $InstanceId -RunnerScript $RunnerScript `
    -CommandScript (Join-Path $ScriptDir 'run-tunnel.bat')
$cloudflaredProcesses = @(Get-CimInstance Win32_Process `
    -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue)
foreach ($process in $cloudflaredProcesses) {
    if (-not (Test-PortaCommandLinePathOption -CommandLine ([string] $process.CommandLine) `
            -Option '--config' -Path $CloudflaredConfig)) {
        continue
    }

    $isManagedTunnel = $null -ne $tunnelRunner -and
        (Test-PortaProcessDescendant -ProcessId ([int] $process.ProcessId) `
            -AncestorProcessId ([int] $tunnelRunner.runnerPid))
    if (-not $isManagedTunnel) {
        $preflightProblems.Add(
            "Untracked cloudflared PID $($process.ProcessId) is already using this config file."
        )
    }
}

if ($preflightProblems.Count -gt 0) {
    $details = ($preflightProblems | ForEach-Object { "  - $_" }) -join [Environment]::NewLine
    throw (
        "Cannot install without risking another deployment or an unmanaged public process." +
        [Environment]::NewLine + $details + [Environment]::NewLine +
        'No task or process was changed. Resolve the listed item(s), then rerun the installer.'
    )
}

Write-Host "==> 1/4  Ensuring '$BinDir' exists and is on your user PATH"
if (-not (Test-Path -LiteralPath $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir | Out-Null
}
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if (($userPath -split ';') -notcontains $BinDir) {
    $newUserPath = if ([string]::IsNullOrWhiteSpace($userPath)) {
        $BinDir
    }
    else {
        $userPath.TrimEnd(';') + ';' + $BinDir
    }
    [Environment]::SetEnvironmentVariable('PATH', $newUserPath, 'User')
    Write-Host "    added $BinDir to user PATH (restart shells to pick it up)"
}
$env:PATH = "$BinDir;$env:PATH"

Write-Host '==> 2/4  Installing pnpm via corepack without an interactive download prompt'
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
[Environment]::SetEnvironmentVariable('COREPACK_ENABLE_DOWNLOAD_PROMPT', '0', 'User')
$corepack = Get-Command corepack -CommandType Application -ErrorAction Stop
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & $corepack.Source enable --install-directory $BinDir pnpm
    $corepackEnableExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
if ($corepackEnableExitCode -ne 0) {
    throw "corepack enable failed with exit code $corepackEnableExitCode."
}

try {
    $ErrorActionPreference = 'Continue'
    & $corepack.Source prepare "pnpm@$PnpmVersion" --activate
    $corepackPrepareExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
if ($corepackPrepareExitCode -ne 0) {
    throw "corepack prepare failed with exit code $corepackPrepareExitCode."
}

$pnpmShim = Join-Path $BinDir 'pnpm.cmd'
if (-not (Test-Path -LiteralPath $pnpmShim -PathType Leaf)) {
    throw "Corepack did not create the Windows pnpm shim: $pnpmShim"
}
try {
    $ErrorActionPreference = 'Continue'
    $pnpmOutput = & $pnpmShim --version 2>&1
    $pnpmExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
$pnpmVer = ([string] (($pnpmOutput | Select-Object -Last 1))).Trim()
if ($pnpmExitCode -ne 0 -or $pnpmVer -ne $PnpmVersion) {
    throw "The pnpm.cmd shim reported '$pnpmVer' (exit $pnpmExitCode); expected '$PnpmVersion'."
}
Write-Host "    pnpm ready: $pnpmVer"

Write-Host "==> 3/4  Registering '$TaskName' (every $IntervalMinutes minutes and at logon)"
$watchdogArguments = @(
    '-NoProfile',
    '-WindowStyle', 'Hidden',
    '-ExecutionPolicy', 'Bypass',
    '-File', "`"$WatchdogScript`"",
    '-OriginPort', [string] $OriginPort,
    '-ProxyPort', [string] $ProxyPort,
    '-TunnelMetricsPort', [string] $TunnelMetricsPort,
    '-PublicHost', "`"$PublicHost`"",
    '-CloudflaredConfig', "`"$CloudflaredConfig`"",
    '-PnpmBinDir', "`"$BinDir`"",
    '-TaskName', "`"$TaskName`""
) -join ' '

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $watchdogArguments `
    -WorkingDirectory $RepoRoot
$firstRun = (Get-Date).AddMinutes(1)
$periodicTrigger = New-ScheduledTaskTrigger -Once -At $firstRun `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $periodicTrigger, $logonTrigger `
    -Settings $settings -Principal $principal | Out-Null

Write-Host '==> 4/4  Running the watchdog once to bring the pipeline up'
Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host 'Done. Automatic recovery is active while this user is signed in.'
Write-Host "Watchdog log: $ScriptDir\watchdog-$InstanceId.log"
Write-Host "Porta logs:    $RepoRoot\logs"
Write-Host "Tunnel log:    $(Join-Path $StateDirectory 'tunnel.log')"
Write-Host "Stop safely:   $ScriptDir\stop-watchdog.ps1 -TaskName `"$TaskName`""
