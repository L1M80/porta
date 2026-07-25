# Unregisters one watchdog task and stops only its identity-validated process trees.
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string] $TaskName = 'PortaWatchdog'
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir '..\..'))
$RunnerScript = Join-Path $ScriptDir 'managed-runner.ps1'
$WatchdogScript = Join-Path $ScriptDir 'porta-watchdog.ps1'
$LegacyWatchdogScript = Join-Path $ScriptDir 'silent-watchdog.vbs'

. (Join-Path $ScriptDir 'watchdog-common.ps1')

$InstanceId = Get-PortaInstanceId -RepoRoot $RepoRoot -TaskName $TaskName
$StateDirectory = Get-PortaStateDirectory -InstanceId $InstanceId
if (-not (Test-Path -LiteralPath $StateDirectory)) {
    New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
}

$task = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $task) {
    $ownership = Get-PortaScheduledTaskOwnership -Task $task -TaskName $TaskName `
        -WatchdogScript $WatchdogScript -LegacyWatchdogScript $LegacyWatchdogScript
    if ($ownership -eq 'unowned') {
        throw (
            "Scheduled task '\$TaskName' is not owned by this checkout. " +
            'No task or process was changed.'
        )
    }

    Stop-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction Stop
}
else {
    Write-Host "Scheduled task '$TaskName' was not registered."
}

$lockPath = Join-Path $StateDirectory 'watchdog.lock'
$lock = $null
$deadline = [DateTime]::UtcNow.AddSeconds(15)
while ($null -eq $lock -and [DateTime]::UtcNow -lt $deadline) {
    try {
        $lock = [System.IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
    }
    catch {
        Start-Sleep -Milliseconds 250
    }
}

if ($null -eq $lock) {
    $taskState = if ($null -ne $task) {
        "Task '$TaskName' was left registered"
    }
    else {
        'No task was registered'
    }
    throw (
        "Could not acquire the watchdog lock within 15 seconds. $taskState and " +
        'managed processes were not changed.'
    )
}

$stopErrors = New-Object 'System.Collections.Generic.List[string]'
try {
    if ($null -ne $task) {
        Unregister-ScheduledTask -TaskPath '\' -TaskName $TaskName -Confirm:$false `
            -ErrorAction Stop
        Write-Host "Unregistered scheduled task '$TaskName'."
    }

    foreach ($component in @('tunnel', 'porta')) {
        try {
            $commandScript = Join-Path $ScriptDir "run-$component.bat"
            $stopped = Stop-PortaManagedRunner -StateDirectory $StateDirectory `
                -Component $component -InstanceId $InstanceId -RunnerScript $RunnerScript `
                -CommandScript $commandScript
            if ($stopped) {
                Write-Host "Stopped the tracked $component process tree."
            }
            else {
                Write-Host "No identity-validated $component process was running."
            }
        }
        catch {
            $stopErrors.Add(
                "Could not stop the tracked $component process tree: $($_.Exception.Message)"
            )
        }
    }

    $untrackedLaunchers = @(Get-PortaUntrackedBatchLaunchers -ScriptDirectory $ScriptDir `
        -StateDirectory $StateDirectory -InstanceId $InstanceId -RunnerScript $RunnerScript)
    foreach ($launcher in $untrackedLaunchers) {
        $stopErrors.Add(
            "Untracked $($launcher.Component) launcher PID $($launcher.ProcessId) remains. " +
            'It was not killed because its ownership could not be validated.'
        )
    }

    foreach ($name in @('porta.last-start', 'tunnel.last-start')) {
        $path = Join-Path $StateDirectory $name
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
}
finally {
    $lock.Close()
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}

if ($stopErrors.Count -gt 0) {
    $details = ($stopErrors | ForEach-Object { "  - $_" }) -join [Environment]::NewLine
    throw (
        'The scheduled task was removed, but the stop was incomplete:' +
        [Environment]::NewLine + $details
    )
}
