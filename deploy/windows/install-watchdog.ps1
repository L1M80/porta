# One-time setup for the always-on "Porta app + Cloudflare tunnel" deployment on Windows.
#
# This captures the three environmental things that are easy to get wrong and that caused a
# real outage (the tunnel silently went down and every restart attempt failed):
#
#   1. pnpm must be on PATH. If it isn't, `pnpm dev` and the watchdog's restart both fail
#      with "Windows cannot find 'pnpm'". We install a corepack pnpm shim into a PATH dir.
#   2. corepack's interactive download prompt must be disabled, or a hidden (background)
#      `pnpm` invocation hangs forever waiting for a [Y/n] that nobody can answer.
#   3. A scheduled task must actually run the watchdog (every few minutes + at logon).
#
# Safe to re-run (idempotent). Does NOT require admin.
[CmdletBinding()]
param(
    [string] $BinDir          = (Join-Path $env:USERPROFILE 'bin'),  # a user-writable dir we put on PATH
    [string] $PnpmVersion     = '11.15.1',
    [int]    $IntervalMinutes = 5,
    [string] $TaskName        = 'PortaWatchdog'
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot

Write-Host "==> 1/4  Ensuring '$BinDir' exists and is on your user PATH"
if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir | Out-Null }
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if (($userPath -split ';') -notcontains $BinDir) {
    [Environment]::SetEnvironmentVariable('PATH', ($userPath.TrimEnd(';') + ';' + $BinDir), 'User')
    Write-Host "    added $BinDir to user PATH (restart shells to pick it up)"
}
$env:PATH = "$BinDir;$env:PATH"

Write-Host '==> 2/4  Installing pnpm via corepack (no admin needed) and disabling the download prompt'
# Disable the interactive prompt everywhere: this session, the persisted user env, and by
# pre-activating the exact version so nothing needs downloading at runtime.
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
[Environment]::SetEnvironmentVariable('COREPACK_ENABLE_DOWNLOAD_PROMPT', '0', 'User')
& corepack enable --install-directory "$BinDir" pnpm
& corepack prepare "pnpm@$PnpmVersion" --activate
$pnpmVer = (& "$BinDir\pnpm" --version) 2>$null
Write-Host "    pnpm ready: $pnpmVer"

Write-Host '==> 3/4  Registering the PortaWatchdog scheduled task (every ' "$IntervalMinutes" ' min + at logon)'
$action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}\silent-watchdog.vbs"' -f $ScriptDir)
$tTime   = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$tLogon  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
                -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $tTime, $tLogon `
    -Settings $settings -Principal $principal -Force | Out-Null

Write-Host '==> 4/4  Kicking the watchdog once to bring the pipeline up now'
Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host 'Done. The pipeline will now self-heal every few minutes and after every logon.'
Write-Host "Logs:  $ScriptDir\watchdog.log  |  <repo>\logs\porta.log  |  %USERPROFILE%\.cloudflared\tunnel.log"
Write-Host "Uninstall with:  Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
