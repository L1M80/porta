# Keeps one identity-scoped Porta app and Cloudflare tunnel healthy.
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int] $OriginPort = 3070,

    [ValidateRange(1, 65535)]
    [int] $ProxyPort = 3170,

    [ValidateRange(1, 65535)]
    [int] $TunnelMetricsPort = 20241,

    [Parameter(Mandatory = $true)]
    [string] $PublicHost,

    [string] $CloudflaredConfig = (Join-Path $env:USERPROFILE '.cloudflared\config.yml'),

    [string] $PnpmBinDir = (Join-Path $env:USERPROFILE 'bin'),

    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string] $TaskName = 'PortaWatchdog',

    [ValidateRange(30, 3600)]
    [int] $CooldownSeconds = 180,

    [ValidateRange(5, 300)]
    [int] $StartupGraceSeconds = 45
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir '..\..'))
$RunnerScript = Join-Path $ScriptDir 'managed-runner.ps1'
$PortaCommandScript = Join-Path $ScriptDir 'run-porta.bat'
$TunnelCommandScript = Join-Path $ScriptDir 'run-tunnel.bat'
$EnvFile = Join-Path $RepoRoot '.env'
$CloudflaredConfig = [System.IO.Path]::GetFullPath($CloudflaredConfig)
$PnpmBinDir = [System.IO.Path]::GetFullPath($PnpmBinDir)
$PortaRuntimeConfigHash = ''
$CloudflaredConfigHash = ''

. (Join-Path $ScriptDir 'watchdog-common.ps1')

$distinctPorts = @($OriginPort, $ProxyPort, $TunnelMetricsPort) | Select-Object -Unique
if (@($distinctPorts).Count -ne 3) {
    throw 'OriginPort, ProxyPort, and TunnelMetricsPort must use three different ports.'
}
if ($PublicHost.Contains('://') -or $PublicHost.Contains('/') -or $PublicHost.Contains('\') -or
    $PublicHost.Contains(':') -or $PublicHost -notmatch '^[A-Za-z0-9.-]+$') {
    throw 'PublicHost must be one hostname only, without a scheme, port, path, or wildcard.'
}

$InstanceId = Get-PortaInstanceId -RepoRoot $RepoRoot -TaskName $TaskName
$StateDirectory = Get-PortaStateDirectory -InstanceId $InstanceId
if (-not (Test-Path -LiteralPath $StateDirectory)) {
    New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
}

$Log = Join-Path $ScriptDir "watchdog-$InstanceId.log"

function Write-WatchdogLog {
    param([string] $Message)

    "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message |
        Out-File -LiteralPath $Log -Append -Encoding UTF8
}

if ((Test-Path -LiteralPath $Log) -and ((Get-Item -LiteralPath $Log).Length -gt 1MB)) {
    Get-Content -LiteralPath $Log -Tail 500 |
        Set-Content -LiteralPath $Log -Encoding UTF8
}

function Test-Cooldown {
    param(
        [ValidateSet('porta', 'tunnel')]
        [string] $Component
    )

    $marker = Join-Path $StateDirectory "$Component.last-start"
    if (Test-Path -LiteralPath $marker) {
        $age = ((Get-Date) - (Get-Item -LiteralPath $marker).LastWriteTime).TotalSeconds
        if ($age -lt $CooldownSeconds) {
            return $false
        }
    }

    New-Item -ItemType File -Path $marker -Force | Out-Null
    return $true
}

function Start-ManagedComponent {
    param(
        [ValidateSet('porta', 'tunnel')]
        [string] $Component
    )

    $commandScript = if ($Component -eq 'porta') {
        $PortaCommandScript
    }
    else {
        $TunnelCommandScript
    }
    $arguments = @(
        '-NoProfile',
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', "`"$RunnerScript`"",
        '-Component', $Component,
        '-InstanceId', $InstanceId,
        '-StateDirectory', "`"$StateDirectory`"",
        '-CommandScript', "`"$commandScript`""
    )
    if ($Component -eq 'tunnel') {
        $arguments += @(
            '-CloudflaredConfig', "`"$CloudflaredConfig`"",
            '-CloudflaredConfigHash', $CloudflaredConfigHash,
            '-TunnelMetricsPort', [string] $TunnelMetricsPort
        )
    }
    else {
        $arguments += @(
            '-PortaRuntimeConfigHash', $PortaRuntimeConfigHash
        )
    }

    Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden | Out-Null
}

function Get-ValidatedRuntimeConfiguration {
    if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
        throw "Missing runtime configuration: $EnvFile"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $PnpmBinDir 'pnpm.cmd') -PathType Leaf)) {
        throw "Managed pnpm.cmd is missing from $PnpmBinDir."
    }

    $envValues = Read-PortaEnvFile -Path $EnvFile
    if ([string] $envValues['PORTA_REQUIRE_AUTH'] -notmatch '^(?i:1|true|yes|on)$') {
        throw 'PORTA_REQUIRE_AUTH is no longer enabled.'
    }

    $token = [string] $envValues['PORTA_ACCESS_TOKEN']
    if ($token.Length -lt 32) {
        throw 'PORTA_ACCESS_TOKEN is missing or shorter than 32 characters.'
    }

    if ([string] $envValues['PORTA_WEB_PORT'] -ne [string] $OriginPort) {
        throw "PORTA_WEB_PORT no longer matches watchdog port $OriginPort."
    }
    if ([string] $envValues['PORTA_PORT'] -ne [string] $ProxyPort) {
        throw "PORTA_PORT no longer matches watchdog proxy port $ProxyPort."
    }
    if ([string] $envValues['PORTA_HOST'] -ne '127.0.0.1') {
        throw 'PORTA_HOST must remain 127.0.0.1 for this public tunnel recipe.'
    }

    $allowedHosts = @(([string] $envValues['PORTA_ALLOWED_HOSTS']).Split(',') |
        ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($allowedHosts -contains '*' -or $allowedHosts -contains 'true' -or
        $allowedHosts -contains 'all' -or $allowedHosts -notcontains $PublicHost) {
        throw "PORTA_ALLOWED_HOSTS must contain only explicit hosts including '$PublicHost'."
    }

    $publicOrigin = "https://$PublicHost"
    $corsOrigins = @(([string] $envValues['PORTA_CORS_ORIGINS']).Split(',') |
        ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if (-not @($corsOrigins | Where-Object { $_ -ceq $publicOrigin })) {
        throw "PORTA_CORS_ORIGINS must contain the exact origin '$publicOrigin'."
    }

    if (-not (Test-Path -LiteralPath $CloudflaredConfig -PathType Leaf)) {
        throw "Cloudflared config is missing: $CloudflaredConfig"
    }
    $configHashBeforeValidation = (
        Get-FileHash -LiteralPath $CloudflaredConfig -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    Assert-PortaCloudflaredIngress -CloudflaredConfig $CloudflaredConfig `
        -PublicOrigin $publicOrigin -OriginPort $OriginPort
    $configHashAfterValidation = (
        Get-FileHash -LiteralPath $CloudflaredConfig -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    if ($configHashBeforeValidation -ne $configHashAfterValidation) {
        throw 'Cloudflared config changed while it was being validated; retry on the next tick.'
    }

    $runtimeConfigHash = Get-PortaPinnedEnvironmentHash `
        -RequireAuth '1' -AccessToken $token -HostName '127.0.0.1' `
        -ProxyPort ([string] $ProxyPort) -WebPort ([string] $OriginPort) `
        -AllowedHosts $PublicHost -CorsOrigins $publicOrigin

    return [pscustomobject] @{
        AccessToken = $token
        PublicOrigin = $publicOrigin
        PortaRuntimeConfigHash = $runtimeConfigHash
        CloudflaredConfigHash = $configHashAfterValidation
    }
}

function Test-WebHealth {
    param(
        [Parameter(Mandatory = $true)]
        [string] $AccessToken
    )

    try {
        $unauthorizedStatus = Get-PortaHttpStatus -Port $OriginPort `
            -HostHeader $PublicHost
        $cookieToken = [Uri]::EscapeDataString($AccessToken)
        $authorizedStatus = Get-PortaHttpStatus -Port $OriginPort `
            -HostHeader $PublicHost -Cookie "porta_access=$cookieToken"
        return $unauthorizedStatus -eq 401 -and $authorizedStatus -eq 200
    }
    catch {
        return $false
    }
}

function Test-ProxyHealth {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$ProxyPort/api/health" `
            -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -ne 200) {
            return $false
        }

        $body = $response.Content | ConvertFrom-Json
        return [string] $body.status -eq 'ok'
    }
    catch {
        return $false
    }
}

function Test-TunnelHealth {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$TunnelMetricsPort/ready" `
            -UseBasicParsing -TimeoutSec 5
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Stop-TrackedComponent {
    param(
        [ValidateSet('porta', 'tunnel')]
        [string] $Component
    )

    $commandScript = if ($Component -eq 'porta') {
        $PortaCommandScript
    }
    else {
        $TunnelCommandScript
    }
    $runner = Get-PortaManagedRunner -StateDirectory $StateDirectory -Component $Component `
        -InstanceId $InstanceId -RunnerScript $RunnerScript -CommandScript $commandScript
    if ($null -ne $runner) {
        Stop-PortaManagedRunner -StateDirectory $StateDirectory -Component $Component `
            -InstanceId $InstanceId -RunnerScript $RunnerScript `
            -CommandScript $commandScript | Out-Null
        Write-WatchdogLog "Stopped managed $Component runner PID $($runner.runnerPid)."
    }
}

function Wait-PortaHealth {
    param(
        [Parameter(Mandatory = $true)]
        [string] $AccessToken,

        [ValidateRange(0, 300)]
        [int] $TimeoutSeconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ($true) {
        $candidate = Get-PortaManagedRunner -StateDirectory $StateDirectory `
            -Component porta -InstanceId $InstanceId -RunnerScript $RunnerScript `
            -CommandScript $PortaCommandScript
        $matchesConfig = $null -ne $candidate -and
            (Test-PortaManagedRunner -State $candidate -Component porta `
                -InstanceId $InstanceId -RunnerScript $RunnerScript `
                -CommandScript $PortaCommandScript `
                -PortaRuntimeConfigHash $PortaRuntimeConfigHash)
        if ($matchesConfig -and
            (Test-WebHealth -AccessToken $AccessToken) -and
            (Test-ProxyHealth)) {
            return $candidate
        }

        if ([DateTime]::UtcNow -ge $deadline) {
            return $null
        }
        Start-Sleep -Seconds 1
    }
}

$lockPath = Join-Path $StateDirectory 'watchdog.lock'
$lock = $null
try {
    $lock = [System.IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
}
catch {
    Write-WatchdogLog 'Another watchdog instance is active; exiting.'
    return
}

try {
    try {
        $runtimeConfiguration = Get-ValidatedRuntimeConfiguration
        $PortaRuntimeConfigHash = $runtimeConfiguration.PortaRuntimeConfigHash
        $CloudflaredConfigHash = $runtimeConfiguration.CloudflaredConfigHash
        $env:PATH = "$PnpmBinDir;$env:PATH"
        # Pin the values validated from .env. Vite and Node otherwise permit
        # .env.local, mode-specific files, or inherited process variables to
        # override the public deployment's security and network settings.
        $env:PORTA_REQUIRE_AUTH = '1'
        $env:PORTA_ACCESS_TOKEN = $runtimeConfiguration.AccessToken
        $env:PORTA_HOST = '127.0.0.1'
        $env:PORTA_PORT = [string] $ProxyPort
        $env:PORTA_WEB_PORT = [string] $OriginPort
        $env:PORTA_ALLOWED_HOSTS = $PublicHost
        $env:PORTA_CORS_ORIGINS = $runtimeConfiguration.PublicOrigin
    }
    catch {
        Write-WatchdogLog "SECURITY: $($_.Exception.Message) Stopping all managed public-deployment processes."
        foreach ($component in @('tunnel', 'porta')) {
            try {
                Stop-TrackedComponent -Component $component
            }
            catch {
                Write-WatchdogLog "ERROR: could not stop managed $component after configuration failure: $($_.Exception.Message)"
            }
        }
        return
    }

    $portaRunner = Get-PortaManagedRunner -StateDirectory $StateDirectory -Component porta `
        -InstanceId $InstanceId -RunnerScript $RunnerScript -CommandScript $PortaCommandScript
    $portaMatchesConfig = $null -ne $portaRunner -and
        (Test-PortaManagedRunner -State $portaRunner -Component porta `
            -InstanceId $InstanceId -RunnerScript $RunnerScript `
            -CommandScript $PortaCommandScript `
            -PortaRuntimeConfigHash $PortaRuntimeConfigHash)
    $portaHealthy = $portaMatchesConfig -and
        (Test-WebHealth -AccessToken $runtimeConfiguration.AccessToken) -and
        (Test-ProxyHealth)

    if (-not $portaHealthy) {
        Write-WatchdogLog 'Porta has not passed both health checks; stopping the managed tunnel before recovery.'
        Stop-TrackedComponent -Component tunnel
    }

    if (-not $portaHealthy -and $portaMatchesConfig) {
        try {
            $runnerStarted = [DateTimeOffset]::Parse(
                [string] $portaRunner.startedAtUtc
            ).UtcDateTime
            $runnerAgeSeconds = (
                [DateTime]::UtcNow - $runnerStarted
            ).TotalSeconds
            $remainingGrace = [Math]::Max(
                0,
                [Math]::Ceiling($StartupGraceSeconds - $runnerAgeSeconds)
            )
        }
        catch {
            $remainingGrace = 0
        }

        if ($remainingGrace -gt 0) {
            Write-WatchdogLog "Porta is still starting; waiting up to $remainingGrace seconds."
            $readyRunner = Wait-PortaHealth `
                -AccessToken $runtimeConfiguration.AccessToken `
                -TimeoutSeconds ([int] $remainingGrace)
            if ($null -ne $readyRunner) {
                $portaRunner = $readyRunner
                $portaHealthy = $true
            }
        }
    }

    if (-not $portaHealthy) {
        if ($null -ne $portaRunner) {
            Write-WatchdogLog "Porta runner PID $($portaRunner.runnerPid) is unhealthy; stopping its managed tree."
            Stop-PortaManagedRunner -StateDirectory $StateDirectory -Component porta `
                -InstanceId $InstanceId -RunnerScript $RunnerScript `
                -CommandScript $PortaCommandScript | Out-Null
        }

        if (Test-Cooldown -Component porta) {
            Write-WatchdogLog 'Porta is down or unhealthy; starting its managed runner.'
            Start-ManagedComponent -Component porta
            $readyRunner = Wait-PortaHealth `
                -AccessToken $runtimeConfiguration.AccessToken `
                -TimeoutSeconds $StartupGraceSeconds
            if ($null -ne $readyRunner) {
                $portaRunner = $readyRunner
                $portaHealthy = $true
                Write-WatchdogLog 'Porta passed startup health checks.'
            }
        }
        else {
            Write-WatchdogLog 'Porta is unhealthy but still within its restart cooldown.'
        }
    }

    if (-not $portaHealthy) {
        Write-WatchdogLog 'Tunnel remains stopped until Porta passes authenticated and unauthenticated health checks.'
        return
    }

    $tunnelRunner = Get-PortaManagedRunner -StateDirectory $StateDirectory -Component tunnel `
        -InstanceId $InstanceId -RunnerScript $RunnerScript `
        -CommandScript $TunnelCommandScript
    $tunnelMatchesConfig = $null -ne $tunnelRunner -and
        (Test-PortaManagedRunner -State $tunnelRunner -Component tunnel `
            -InstanceId $InstanceId -RunnerScript $RunnerScript `
            -CommandScript $TunnelCommandScript -CloudflaredConfig $CloudflaredConfig `
            -CloudflaredConfigHash $CloudflaredConfigHash -TunnelMetricsPort $TunnelMetricsPort)
    $tunnelHealthy = $tunnelMatchesConfig -and (Test-TunnelHealth)

    if (-not $tunnelHealthy) {
        if ($null -ne $tunnelRunner) {
            Write-WatchdogLog "Tunnel runner PID $($tunnelRunner.runnerPid) is unhealthy or uses different settings; stopping its managed tree."
            Stop-PortaManagedRunner -StateDirectory $StateDirectory -Component tunnel `
                -InstanceId $InstanceId -RunnerScript $RunnerScript `
                -CommandScript $TunnelCommandScript | Out-Null
        }

        if (Test-Cooldown -Component tunnel) {
            Write-WatchdogLog 'Configured Cloudflare tunnel is down or unhealthy; starting its managed runner.'
            Start-ManagedComponent -Component tunnel
        }
        else {
            Write-WatchdogLog 'Tunnel is unhealthy but still within its restart cooldown.'
        }
    }

    if ($portaHealthy -and $tunnelHealthy) {
        Write-WatchdogLog "OK: managed Porta on :$OriginPort and configured tunnel are healthy."
    }
}
catch {
    Write-WatchdogLog "ERROR: $($_.Exception.Message)"
    throw
}
finally {
    if ($null -ne $lock) {
        $lock.Close()
    }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
