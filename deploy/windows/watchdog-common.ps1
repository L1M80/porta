# Shared helpers for the Windows watchdog, runner, and stop scripts.

function Get-PortaInstanceId {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $RepoRoot,

        [Parameter(Mandatory = $true)]
        [string] $TaskName
    )

    $normalizedRoot = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\').ToLowerInvariant()
    $normalizedTaskName = $TaskName.ToLowerInvariant()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("$normalizedRoot`n$normalizedTaskName")
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($bytes)
    }
    finally {
        $sha.Dispose()
    }

    return ([System.BitConverter]::ToString($hash).Replace('-', '').Substring(0, 16).ToLowerInvariant())
}

function Get-PortaPinnedEnvironmentHash {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $RequireAuth,

        [Parameter(Mandatory = $true)]
        [string] $AccessToken,

        [Parameter(Mandatory = $true)]
        [string] $HostName,

        [Parameter(Mandatory = $true)]
        [string] $ProxyPort,

        [Parameter(Mandatory = $true)]
        [string] $WebPort,

        [Parameter(Mandatory = $true)]
        [string] $AllowedHosts,

        [Parameter(Mandatory = $true)]
        [string] $CorsOrigins
    )

    $values = @(
        $RequireAuth,
        $AccessToken,
        $HostName,
        $ProxyPort,
        $WebPort,
        $AllowedHosts,
        $CorsOrigins
    )
    $payload = ($values | ForEach-Object {
        $value = [string] $_
        "$($value.Length):$value"
    }) -join '|'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($bytes)
    }
    finally {
        $sha.Dispose()
    }

    return [System.BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant()
}

function Get-PortaStateDirectory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $InstanceId
    )

    $localData = [Environment]::GetFolderPath('LocalApplicationData')
    if ([string]::IsNullOrWhiteSpace($localData)) {
        throw 'Could not resolve the current user LocalApplicationData directory.'
    }

    return Join-Path $localData (Join-Path 'Porta\watchdog' $InstanceId)
}

function Test-PortaProcessDescendant {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int] $ProcessId,

        [Parameter(Mandatory = $true)]
        [int] $AncestorProcessId
    )

    if ($ProcessId -le 0 -or $AncestorProcessId -le 0) {
        return $false
    }

    $currentId = $ProcessId
    $visited = New-Object 'System.Collections.Generic.HashSet[int]'
    for ($depth = 0; $depth -lt 64; $depth++) {
        if ($currentId -eq $AncestorProcessId) {
            return $true
        }
        if (-not $visited.Add($currentId)) {
            return $false
        }

        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $currentId" `
            -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            return $false
        }

        $currentId = [int] $process.ParentProcessId
        if ($currentId -le 0) {
            return $false
        }
    }

    return $false
}

function Get-PortaScheduledTaskOwnership {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [psobject] $Task,

        [Parameter(Mandatory = $true)]
        [string] $TaskName,

        [Parameter(Mandatory = $true)]
        [string] $WatchdogScript,

        [Parameter(Mandatory = $true)]
        [string] $LegacyWatchdogScript
    )

    $actions = @($Task.Actions)
    if ($actions.Count -ne 1) {
        return 'unowned'
    }

    $action = $actions[0]
    $execute = [Environment]::ExpandEnvironmentVariables([string] $action.Execute)
    $executeName = [System.IO.Path]::GetFileName($execute)
    $arguments = ([string] $action.Arguments).Trim()

    if ($executeName -ieq 'powershell.exe') {
        $watchdogPath = [Regex]::Escape(
            [System.IO.Path]::GetFullPath($WatchdogScript)
        )
        $taskNamePattern = [Regex]::Escape($TaskName)
        $fileArgument = '(?i)(?:^|\s)-File\s+"' + $watchdogPath + '"(?=\s|$)'
        $nameArgument = '(?i)(?:^|\s)-TaskName\s+"' + $taskNamePattern + '"(?=\s|$)'
        if ($arguments -match $fileArgument -and $arguments -match $nameArgument) {
            return 'current'
        }
    }

    if ($executeName -ieq 'wscript.exe') {
        $expectedArguments = '"' +
            [System.IO.Path]::GetFullPath($LegacyWatchdogScript) + '"'
        if ($arguments -ieq $expectedArguments) {
            return 'legacy'
        }
    }

    return 'unowned'
}

function Test-PortaCommandLinePathToken {
    [CmdletBinding()]
    param(
        [string] $CommandLine,

        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    if ([string]::IsNullOrWhiteSpace($CommandLine)) {
        return $false
    }

    $pattern = '(?i)(?:^|[\s"''])' +
        [Regex]::Escape([System.IO.Path]::GetFullPath($Path)) +
        '(?=$|[\s"''])'
    return $CommandLine -match $pattern
}

function Test-PortaCommandLinePathOption {
    [CmdletBinding()]
    param(
        [string] $CommandLine,

        [Parameter(Mandatory = $true)]
        [ValidatePattern('^-{1,2}[A-Za-z0-9-]+$')]
        [string] $Option,

        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    if ([string]::IsNullOrWhiteSpace($CommandLine)) {
        return $false
    }

    $pattern = '(?i)(?:^|\s)' + [Regex]::Escape($Option) +
        '(?:=|\s+)"?' +
        [Regex]::Escape([System.IO.Path]::GetFullPath($Path)) +
        '"?(?=\s|$)'
    return $CommandLine -match $pattern
}

function Test-PortaCommandLineValueOption {
    [CmdletBinding()]
    param(
        [string] $CommandLine,

        [Parameter(Mandatory = $true)]
        [ValidatePattern('^-{1,2}[A-Za-z0-9-]+$')]
        [string] $Option,

        [Parameter(Mandatory = $true)]
        [string] $Value
    )

    if ([string]::IsNullOrWhiteSpace($CommandLine)) {
        return $false
    }

    $pattern = '(?i)(?:^|\s)' + [Regex]::Escape($Option) +
        '(?:=|\s+)"?' + [Regex]::Escape($Value) + '"?(?=\s|$)'
    return $CommandLine -match $pattern
}

function Get-PortaHttpStatus {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateRange(1, 65535)]
        [int] $Port,

        [Parameter(Mandatory = $true)]
        [string] $HostHeader,

        [string] $Path = '/',
        [string] $Cookie = '',

        [ValidateRange(1, 60)]
        [int] $TimeoutSeconds = 5
    )

    $client = New-Object System.Net.Sockets.TcpClient
    $stream = $null
    try {
        $client.SendTimeout = $TimeoutSeconds * 1000
        $client.ReceiveTimeout = $TimeoutSeconds * 1000
        $client.Connect('127.0.0.1', $Port)
        $stream = $client.GetStream()
        $stream.ReadTimeout = $TimeoutSeconds * 1000
        $stream.WriteTimeout = $TimeoutSeconds * 1000

        $cookieHeader = if ([string]::IsNullOrWhiteSpace($Cookie)) {
            ''
        }
        else {
            "Cookie: $Cookie`r`n"
        }
        $request = (
            "GET $Path HTTP/1.1`r`n" +
            "Host: $HostHeader`r`n" +
            $cookieHeader +
            "Connection: close`r`n`r`n"
        )
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($request)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()

        $reader = New-Object System.IO.StreamReader(
            $stream,
            [System.Text.Encoding]::ASCII,
            $false,
            1024,
            $true
        )
        try {
            $statusLine = $reader.ReadLine()
        }
        finally {
            $reader.Dispose()
        }

        if ($statusLine -notmatch '^HTTP/\d+(?:\.\d+)?\s+(\d{3})(?:\s|$)') {
            throw "Unexpected HTTP status line: $statusLine"
        }
        return [int] $Matches[1]
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
        $client.Dispose()
    }
}

function Get-PortaComponentStatePath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $StateDirectory,

        [Parameter(Mandatory = $true)]
        [ValidateSet('porta', 'tunnel')]
        [string] $Component
    )

    return Join-Path $StateDirectory "$Component.json"
}

function Read-PortaComponentState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $StateDirectory,

        [Parameter(Mandatory = $true)]
        [ValidateSet('porta', 'tunnel')]
        [string] $Component
    )

    $path = Get-PortaComponentStatePath -StateDirectory $StateDirectory -Component $Component
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Write-PortaComponentState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $StateDirectory,

        [Parameter(Mandatory = $true)]
        [ValidateSet('porta', 'tunnel')]
        [string] $Component,

        [Parameter(Mandatory = $true)]
        [psobject] $State
    )

    if (-not (Test-Path -LiteralPath $StateDirectory)) {
        New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
    }

    $path = Get-PortaComponentStatePath -StateDirectory $StateDirectory -Component $Component
    $temporaryPath = "$path.$PID.tmp"
    $State | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $path -Force
}

function Test-PortaManagedRunner {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [psobject] $State,

        [Parameter(Mandatory = $true)]
        [ValidateSet('porta', 'tunnel')]
        [string] $Component,

        [Parameter(Mandatory = $true)]
        [string] $InstanceId,

        [Parameter(Mandatory = $true)]
        [string] $RunnerScript,

        [Parameter(Mandatory = $true)]
        [string] $CommandScript,

        [string] $PortaRuntimeConfigHash = '',
        [string] $CloudflaredConfig = '',
        [string] $CloudflaredConfigHash = '',
        [int] $TunnelMetricsPort = 0
    )

    try {
        $runnerPid = [int] $State.runnerPid
        if ($runnerPid -le 0) {
            return $false
        }

        if ([string] $State.component -ne $Component -or
            [string] $State.instanceId -ne $InstanceId -or
            [System.IO.Path]::GetFullPath([string] $State.runnerScript) -ne
                [System.IO.Path]::GetFullPath($RunnerScript) -or
            [System.IO.Path]::GetFullPath([string] $State.commandScript) -ne
                [System.IO.Path]::GetFullPath($CommandScript)) {
            return $false
        }

        if ($Component -eq 'porta' -and
            -not [string]::IsNullOrWhiteSpace($PortaRuntimeConfigHash) -and
            [string] $State.portaRuntimeConfigHash -ne $PortaRuntimeConfigHash) {
            return $false
        }

        if ($Component -eq 'tunnel' -and -not [string]::IsNullOrWhiteSpace($CloudflaredConfig)) {
            if ([System.IO.Path]::GetFullPath([string] $State.cloudflaredConfig) -ne
                    [System.IO.Path]::GetFullPath($CloudflaredConfig) -or
                [string] $State.cloudflaredConfigHash -ne $CloudflaredConfigHash -or
                [int] $State.tunnelMetricsPort -ne $TunnelMetricsPort) {
                return $false
            }
        }

        $process = Get-Process -Id $runnerPid -ErrorAction Stop
        $expectedStart = [DateTimeOffset]::Parse([string] $State.startedAtUtc).UtcDateTime
        $actualStart = $process.StartTime.ToUniversalTime()
        if ([Math]::Abs(($actualStart - $expectedStart).TotalSeconds) -gt 2) {
            return $false
        }

        $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $runnerPid" -ErrorAction Stop
        $commandLine = [string] $cim.CommandLine
        $matchesExpectedRunner = (
            (Test-PortaCommandLinePathOption -CommandLine $commandLine `
                -Option '-File' -Path $RunnerScript) -and
            (Test-PortaCommandLinePathOption -CommandLine $commandLine `
                -Option '-CommandScript' -Path $CommandScript) -and
            (Test-PortaCommandLineValueOption -CommandLine $commandLine `
                -Option '-InstanceId' -Value $InstanceId) -and
            (Test-PortaCommandLineValueOption -CommandLine $commandLine `
                -Option '-Component' -Value $Component)
        )
        if (-not $matchesExpectedRunner) {
            return $false
        }

        if ($Component -eq 'porta' -and
            -not [string]::IsNullOrWhiteSpace($PortaRuntimeConfigHash)) {
            return Test-PortaCommandLineValueOption -CommandLine $commandLine `
                -Option '-PortaRuntimeConfigHash' -Value $PortaRuntimeConfigHash
        }

        if ($Component -eq 'tunnel' -and -not [string]::IsNullOrWhiteSpace($CloudflaredConfig)) {
            return (
                (Test-PortaCommandLinePathOption -CommandLine $commandLine `
                    -Option '-CloudflaredConfig' -Path $CloudflaredConfig) -and
                (Test-PortaCommandLineValueOption -CommandLine $commandLine `
                    -Option '-CloudflaredConfigHash' -Value $CloudflaredConfigHash) -and
                (Test-PortaCommandLineValueOption -CommandLine $commandLine `
                    -Option '-TunnelMetricsPort' -Value ([string] $TunnelMetricsPort))
            )
        }

        return $true
    }
    catch {
        return $false
    }
}

function Find-PortaManagedRunner {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('porta', 'tunnel')]
        [string] $Component,

        [Parameter(Mandatory = $true)]
        [string] $InstanceId,

        [Parameter(Mandatory = $true)]
        [string] $RunnerScript,

        [Parameter(Mandatory = $true)]
        [string] $CommandScript,

        [string] $PortaRuntimeConfigHash = '',
        [string] $CloudflaredConfig = '',
        [string] $CloudflaredConfigHash = '',
        [int] $TunnelMetricsPort = 0
    )

    $candidates = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue
    foreach ($candidate in $candidates) {
        $commandLine = [string] $candidate.CommandLine
        if (-not (Test-PortaCommandLinePathOption -CommandLine $commandLine `
                -Option '-File' -Path $RunnerScript) -or
            -not (Test-PortaCommandLinePathOption -CommandLine $commandLine `
                -Option '-CommandScript' -Path $CommandScript) -or
            -not (Test-PortaCommandLineValueOption -CommandLine $commandLine `
                -Option '-InstanceId' -Value $InstanceId) -or
            -not (Test-PortaCommandLineValueOption -CommandLine $commandLine `
                -Option '-Component' -Value $Component)) {
            continue
        }
        if ($Component -eq 'tunnel' -and -not [string]::IsNullOrWhiteSpace($CloudflaredConfig) -and
            (-not (Test-PortaCommandLinePathOption -CommandLine $commandLine `
                    -Option '-CloudflaredConfig' -Path $CloudflaredConfig) -or
             -not (Test-PortaCommandLineValueOption -CommandLine $commandLine `
                    -Option '-CloudflaredConfigHash' -Value $CloudflaredConfigHash) -or
             -not (Test-PortaCommandLineValueOption -CommandLine $commandLine `
                    -Option '-TunnelMetricsPort' -Value ([string] $TunnelMetricsPort)))) {
            continue
        }
        if ($Component -eq 'porta' -and
            -not [string]::IsNullOrWhiteSpace($PortaRuntimeConfigHash) -and
            -not (Test-PortaCommandLineValueOption -CommandLine $commandLine `
                -Option '-PortaRuntimeConfigHash' -Value $PortaRuntimeConfigHash)) {
            continue
        }

        try {
            $process = Get-Process -Id ([int] $candidate.ProcessId) -ErrorAction Stop
            return [pscustomobject] @{
                component    = $Component
                instanceId   = $InstanceId
                runnerPid    = [int] $candidate.ProcessId
                startedAtUtc = $process.StartTime.ToUniversalTime().ToString('O')
                runnerScript = [System.IO.Path]::GetFullPath($RunnerScript)
                commandScript = [System.IO.Path]::GetFullPath($CommandScript)
                portaRuntimeConfigHash = $PortaRuntimeConfigHash
                cloudflaredConfig = $CloudflaredConfig
                cloudflaredConfigHash = $CloudflaredConfigHash
                tunnelMetricsPort = $TunnelMetricsPort
            }
        }
        catch {
            continue
        }
    }

    return $null
}

function Get-PortaManagedRunner {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $StateDirectory,

        [Parameter(Mandatory = $true)]
        [ValidateSet('porta', 'tunnel')]
        [string] $Component,

        [Parameter(Mandatory = $true)]
        [string] $InstanceId,

        [Parameter(Mandatory = $true)]
        [string] $RunnerScript,

        [Parameter(Mandatory = $true)]
        [string] $CommandScript,

        [string] $PortaRuntimeConfigHash = '',
        [string] $CloudflaredConfig = '',
        [string] $CloudflaredConfigHash = '',
        [int] $TunnelMetricsPort = 0
    )

    $state = Read-PortaComponentState -StateDirectory $StateDirectory -Component $Component
    if ($null -ne $state -and
        (Test-PortaManagedRunner -State $state -Component $Component -InstanceId $InstanceId `
            -RunnerScript $RunnerScript -CommandScript $CommandScript `
            -PortaRuntimeConfigHash $PortaRuntimeConfigHash `
            -CloudflaredConfig $CloudflaredConfig -CloudflaredConfigHash $CloudflaredConfigHash `
            -TunnelMetricsPort $TunnelMetricsPort)) {
        return $state
    }

    $discovered = Find-PortaManagedRunner -Component $Component -InstanceId $InstanceId `
        -RunnerScript $RunnerScript -CommandScript $CommandScript `
        -PortaRuntimeConfigHash $PortaRuntimeConfigHash `
        -CloudflaredConfig $CloudflaredConfig -CloudflaredConfigHash $CloudflaredConfigHash `
        -TunnelMetricsPort $TunnelMetricsPort
    if ($null -ne $discovered) {
        Write-PortaComponentState -StateDirectory $StateDirectory -Component $Component -State $discovered
        return $discovered
    }

    return $null
}

function Get-PortaUntrackedBatchLaunchers {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $ScriptDirectory,

        [Parameter(Mandatory = $true)]
        [string] $StateDirectory,

        [Parameter(Mandatory = $true)]
        [string] $InstanceId,

        [Parameter(Mandatory = $true)]
        [string] $RunnerScript
    )

    $cmdProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" `
        -ErrorAction SilentlyContinue)
    foreach ($component in @('porta', 'tunnel')) {
        $commandScript = Join-Path $ScriptDirectory "run-$component.bat"
        $runner = Get-PortaManagedRunner -StateDirectory $StateDirectory `
            -Component $component -InstanceId $InstanceId -RunnerScript $RunnerScript `
            -CommandScript $commandScript

        foreach ($candidate in $cmdProcesses) {
            $commandLine = [string] $candidate.CommandLine
            if (-not (Test-PortaCommandLinePathToken -CommandLine $commandLine `
                    -Path $commandScript)) {
                continue
            }

            $isManaged = $null -ne $runner -and
                (Test-PortaProcessDescendant -ProcessId ([int] $candidate.ProcessId) `
                    -AncestorProcessId ([int] $runner.runnerPid))
            if (-not $isManaged) {
                [pscustomobject] @{
                    Component = $component
                    ProcessId = [int] $candidate.ProcessId
                    Name = [string] $candidate.Name
                    CommandLine = $commandLine
                }
            }
        }
    }
}

function Stop-PortaManagedRunner {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $StateDirectory,

        [Parameter(Mandatory = $true)]
        [ValidateSet('porta', 'tunnel')]
        [string] $Component,

        [Parameter(Mandatory = $true)]
        [string] $InstanceId,

        [Parameter(Mandatory = $true)]
        [string] $RunnerScript,

        [Parameter(Mandatory = $true)]
        [string] $CommandScript,

        [string] $PortaRuntimeConfigHash = '',
        [string] $CloudflaredConfig = '',
        [string] $CloudflaredConfigHash = '',
        [int] $TunnelMetricsPort = 0
    )

    $state = Get-PortaManagedRunner -StateDirectory $StateDirectory -Component $Component `
        -InstanceId $InstanceId -RunnerScript $RunnerScript -CommandScript $CommandScript `
        -PortaRuntimeConfigHash $PortaRuntimeConfigHash `
        -CloudflaredConfig $CloudflaredConfig -CloudflaredConfigHash $CloudflaredConfigHash `
        -TunnelMetricsPort $TunnelMetricsPort
    if ($null -eq $state) {
        return $false
    }

    $runnerPid = [int] $state.runnerPid
    & taskkill.exe /PID $runnerPid /T /F 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not stop the managed $Component process tree (PID $runnerPid)."
    }

    $statePath = Get-PortaComponentStatePath -StateDirectory $StateDirectory -Component $Component
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    return $true
}

function Assert-PortaCloudflaredIngress {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $CloudflaredConfig,

        [Parameter(Mandatory = $true)]
        [string] $PublicOrigin,

        [Parameter(Mandatory = $true)]
        [ValidateRange(1, 65535)]
        [int] $OriginPort
    )

    if (-not (Test-Path -LiteralPath $CloudflaredConfig -PathType Leaf)) {
        throw "Cloudflared config does not exist: $CloudflaredConfig"
    }

    $cloudflared = Get-Command cloudflared -CommandType Application -ErrorAction Stop
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 turns native stderr into ErrorRecord objects.
        # Capture warnings without letting a benign stderr line terminate the script.
        $ErrorActionPreference = 'Continue'
        $validationOutput = & $cloudflared.Source --config $CloudflaredConfig `
            tunnel ingress validate 2>&1
        $validationExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($validationExitCode -ne 0) {
        throw "Cloudflared rejected the ingress configuration: $($validationOutput -join [Environment]::NewLine)"
    }

    try {
        $ErrorActionPreference = 'Continue'
        $ruleOutput = & $cloudflared.Source --config $CloudflaredConfig `
            tunnel ingress rule $PublicOrigin 2>&1
        $ruleExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    $expectedServicePattern = '(?im)^\s*service:\s*http://127\.0\.0\.1:' +
        $OriginPort + '\s*$'
    if ($ruleExitCode -ne 0 -or
        ($ruleOutput -join [Environment]::NewLine) -notmatch $expectedServicePattern) {
        throw "The first matching ingress rule for '$PublicOrigin' must route to http://127.0.0.1:$OriginPort."
    }
}

function Read-PortaEnvFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
            continue
        }

        $name = $Matches[1]
        $value = $Matches[2].Trim()
        if ($value.StartsWith('"')) {
            $closingQuote = $value.IndexOf('"', 1)
            if ($closingQuote -gt 0) {
                $value = $value.Substring(1, $closingQuote - 1)
            }
        }
        elseif ($value.StartsWith("'")) {
            $closingQuote = $value.IndexOf("'", 1)
            if ($closingQuote -gt 0) {
                $value = $value.Substring(1, $closingQuote - 1)
            }
        }
        else {
            $value = [Regex]::Replace($value, '\s+#.*$', '').Trim()
        }
        $values[$name] = $value
    }

    return $values
}
