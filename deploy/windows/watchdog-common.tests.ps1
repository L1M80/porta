$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'watchdog-common.ps1')

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)]
        $Actual,

        [Parameter(Mandatory = $true)]
        $Expected,

        [Parameter(Mandatory = $true)]
        [string] $Message
    )

    if ($Actual -ne $Expected) {
        throw "$Message Expected '$Expected', got '$Actual'."
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool] $Condition,

        [Parameter(Mandatory = $true)]
        [string] $Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

$instanceLower = Get-PortaInstanceId -RepoRoot 'C:\repo\porta' `
    -TaskName 'portawatchdog'
$instanceMixed = Get-PortaInstanceId -RepoRoot 'C:\Repo\Porta' `
    -TaskName 'PortaWatchdog'
Assert-Equal $instanceMixed $instanceLower `
    'Instance identity must follow Windows path and task-name case semantics.'

$environmentHash = Get-PortaPinnedEnvironmentHash `
    -RequireAuth '1' -AccessToken 'token-a' -HostName '127.0.0.1' `
    -ProxyPort '3170' -WebPort '3070' -AllowedHosts 'porta.example.com' `
    -CorsOrigins 'https://porta.example.com'
$changedTokenHash = Get-PortaPinnedEnvironmentHash `
    -RequireAuth '1' -AccessToken 'token-b' -HostName '127.0.0.1' `
    -ProxyPort '3170' -WebPort '3070' -AllowedHosts 'porta.example.com' `
    -CorsOrigins 'https://porta.example.com'
Assert-True ($environmentHash -match '^[a-f0-9]{64}$') `
    'Pinned environment identity must be a lowercase SHA256.'
Assert-True ($environmentHash -ne $changedTokenHash) `
    'Changing a pinned security value must change the environment identity.'

$runnerScript = Join-Path $PSScriptRoot 'managed-runner.ps1'
$commandScript = Join-Path $PSScriptRoot 'run-porta.bat'
$runnerLine = (
    '"powershell.exe" -NoProfile -File "' + $runnerScript +
    '" -Component porta -InstanceId abc123 -CommandScript "' +
    $commandScript + '" -PortaRuntimeConfigHash ' + $environmentHash
)
Assert-True (Test-PortaCommandLinePathOption -CommandLine $runnerLine `
        -Option '-File' -Path $runnerScript) `
    'The exact managed runner -File argument must match.'
Assert-True (Test-PortaCommandLinePathOption -CommandLine $runnerLine `
        -Option '-CommandScript' -Path $commandScript) `
    'The exact managed command argument must match.'
Assert-True (Test-PortaCommandLineValueOption -CommandLine $runnerLine `
        -Option '-InstanceId' -Value 'abc123') `
    'The exact instance argument must match.'
Assert-True (-not (Test-PortaCommandLineValueOption -CommandLine $runnerLine `
        -Option '-InstanceId' -Value 'abc12')) `
    'A prefix of the instance id must not match.'

$diagnosticLine = (
    'powershell.exe -Command "Find-PortaManagedRunner -RunnerScript ' +
    $runnerScript + ' -Component porta -InstanceId abc123"'
)
Assert-True (-not (Test-PortaCommandLinePathOption -CommandLine $diagnosticLine `
        -Option '-File' -Path $runnerScript)) `
    'A diagnostic command mentioning the runner must not look like the runner.'

$configPath = 'C:\Users\Example User\.cloudflared\config.yml'
$cloudflaredLine = (
    'cloudflared.exe --config="' + $configPath +
    '" tunnel --metrics 127.0.0.1:20241 run'
)
Assert-True (Test-PortaCommandLinePathOption -CommandLine $cloudflaredLine `
        -Option '--config' -Path $configPath) `
    'The equals form of the cloudflared config argument must match.'

$watchdogScript = Join-Path $PSScriptRoot 'porta-watchdog.ps1'
$legacyScript = Join-Path $PSScriptRoot 'silent-watchdog.vbs'
$currentTask = [pscustomobject] @{
    Actions = @([pscustomobject] @{
        Execute = 'powershell.exe'
        Arguments = (
            '-NoProfile -File "' + $watchdogScript +
            '" -TaskName "PortaWatchdog"'
        )
    })
}
$legacyTask = [pscustomobject] @{
    Actions = @([pscustomobject] @{
        Execute = 'wscript.exe'
        Arguments = '"' + $legacyScript + '"'
    })
}
$foreignTask = [pscustomobject] @{
    Actions = @([pscustomobject] @{
        Execute = 'powershell.exe'
        Arguments = (
            '-NoProfile -File "C:\other\porta-watchdog.ps1" ' +
            '-TaskName "PortaWatchdog"'
        )
    })
}
Assert-Equal (
    Get-PortaScheduledTaskOwnership -Task $currentTask `
        -TaskName PortaWatchdog -WatchdogScript $watchdogScript `
        -LegacyWatchdogScript $legacyScript
) 'current' 'The current checkout task must be recognized.'
Assert-Equal (
    Get-PortaScheduledTaskOwnership -Task $legacyTask `
        -TaskName PortaWatchdog -WatchdogScript $watchdogScript `
        -LegacyWatchdogScript $legacyScript
) 'legacy' 'The exact legacy task must be recognized for safe migration.'
Assert-Equal (
    Get-PortaScheduledTaskOwnership -Task $foreignTask `
        -TaskName PortaWatchdog -WatchdogScript $watchdogScript `
        -LegacyWatchdogScript $legacyScript
) 'unowned' 'A task from another checkout must never be claimed.'

Write-Host 'watchdog-common tests passed.'
