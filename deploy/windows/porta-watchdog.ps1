# Porta watchdog — keeps an always-on "Porta app + Cloudflare tunnel" deployment alive.
#
# Registered as the "PortaWatchdog" scheduled task (see install-watchdog.ps1), it fires
# every few minutes and at logon. It heals each half of the pipeline INDEPENDENTLY, never
# force-kills a healthy tunnel, logs silently to a file (no modal pop-ups), and guards
# against stacking duplicate launches.
#
# Params let you reuse it unchanged for a different origin port or public hostname.
[CmdletBinding()]
param(
    [int]    $OriginPort      = 3000,          # web origin the tunnel forwards to
    [string] $PublicHost      = 'localhost',   # Host header used for the app-level health probe
    [int]    $CooldownSeconds = 180            # don't relaunch a component started this recently
)

$ErrorActionPreference = 'SilentlyContinue'
$ScriptDir = $PSScriptRoot
$Log       = Join-Path $ScriptDir 'watchdog.log'

function Write-Log([string]$m) {
    "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m |
        Out-File -FilePath $Log -Append -Encoding utf8
}

# Trim the log if it grows past ~1 MB so it never fills the disk.
if ((Test-Path $Log) -and ((Get-Item $Log).Length -gt 1MB)) {
    Get-Content $Log -Tail 500 | Set-Content $Log -Encoding utf8
}

# Per-component cooldown so a still-booting component isn't launched twice.
function Test-Cooldown([string]$name) {
    $marker = Join-Path $env:TEMP ("porta_wd_{0}.last" -f $name)
    if (Test-Path $marker) {
        $age = ((Get-Date) - (Get-Item $marker).LastWriteTime).TotalSeconds
        if ($age -lt $CooldownSeconds) { return $false }   # too soon, skip
    }
    New-Item -ItemType File -Path $marker -Force | Out-Null
    return $true
}

# Single-instance guard: if a previous watchdog run is still working, bail out.
$lockPath = Join-Path $env:TEMP 'porta_watchdog.lock'
try {
    $lock = [System.IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
    Write-Log 'Another watchdog instance is active; exiting.'
    return
}

try {
    # --- 1. Porta app (origin listening on $OriginPort) ---
    $portUp = [bool](Get-NetTCPConnection -LocalPort $OriginPort -State Listen -ErrorAction SilentlyContinue)
    if (-not $portUp) {
        if (Test-Cooldown 'porta') {
            Write-Log "Porta app DOWN (port $OriginPort not listening) -> launching run-porta.vbs"
            Start-Process wscript.exe -ArgumentList ('"{0}\run-porta.vbs"' -f $ScriptDir)
        } else {
            Write-Log 'Porta app not yet up but within cooldown; waiting.'
        }
    }

    # --- 2. Cloudflare tunnel (cloudflared process present) ---
    $cf = Get-Process cloudflared -ErrorAction SilentlyContinue
    if (-not $cf) {
        if (Test-Cooldown 'tunnel') {
            Write-Log 'Cloudflare tunnel DOWN (cloudflared not running) -> launching run-tunnel.vbs'
            Start-Process wscript.exe -ArgumentList ('"{0}\run-tunnel.vbs"' -f $ScriptDir)
        } else {
            Write-Log 'Tunnel not yet up but within cooldown; waiting.'
        }
    }

    # --- 3. App-level health note (logged only; does NOT trigger a restart, to avoid flapping) ---
    if ($portUp) {
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$OriginPort/" -Headers @{ Host = $PublicHost } `
                    -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -ge 500) { Write-Log "WARN: web origin responded HTTP $($r.StatusCode)." }
        } catch {
            Write-Log "WARN: web origin listening but not answering HTTP ($($_.Exception.Message))."
        }
    }

    if ($portUp -and $cf) { Write-Log "OK: porta(:$OriginPort) up, cloudflared up." }
}
finally {
    $lock.Close()
    Remove-Item $lockPath -ErrorAction SilentlyContinue
}
