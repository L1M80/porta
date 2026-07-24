param(
  [string]$HostAddress,
  [int]$WebPort = 5173,
  [int]$ProxyPort = 3170,
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

function Resolve-TailscaleIp {
  if ($HostAddress) {
    return $HostAddress
  }

  $ip = (& tailscale ip -4 2>$null | Select-Object -First 1).Trim()
  if (-not $ip) {
    throw "Could not discover a Tailscale IPv4 address. Is Tailscale running?"
  }

  return $ip
}

function Get-PortaDevProcesses {
  $repoPattern = [regex]::Escape((Get-Location).Path)
  Get-CimInstance Win32_Process | Where-Object {
    $cmd = $_.CommandLine
    if (-not $cmd) {
      return $false
    }

    $cmd -match "pnpm(?:\.mjs|\.cmd)?\s+dev:tailscale" -or
    $cmd -match "scripts[\\/]+dev-tailscale\.mjs" -or
    ($cmd -match $repoPattern -and $cmd -match "packages[\\/]+web[\\/]+node_modules" -and $cmd -match "vite") -or
    ($cmd -match $repoPattern -and $cmd -match "packages[\\/]+proxy[\\/]+node_modules" -and $cmd -match "tsx")
  }
}

function Stop-ProcessTree {
  param([int[]]$RootIds)

  $all = Get-CimInstance Win32_Process
  $ids = [System.Collections.Generic.HashSet[int]]::new()

  foreach ($id in $RootIds) {
    if ($id -ne $PID) {
      [void]$ids.Add($id)
    }
  }

  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $all) {
      if (
        $ids.Contains([int]$process.ParentProcessId) -and
        -not $ids.Contains([int]$process.ProcessId) -and
        [int]$process.ProcessId -ne $PID
      ) {
        [void]$ids.Add([int]$process.ProcessId)
        $changed = $true
      }
    }
  }

  $targets = $all | Where-Object { $ids.Contains([int]$_.ProcessId) } | Sort-Object ProcessId -Descending
  foreach ($target in $targets) {
    try {
      Stop-Process -Id $target.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Warning "Could not stop PID $($target.ProcessId): $($_.Exception.Message)"
    }
  }
}

function Wait-HttpOk {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  return $false
}

$tailscaleIp = Resolve-TailscaleIp

Write-Host "Stopping existing Porta dev processes..."
$existing = @(Get-PortaDevProcesses)
if ($existing.Count -gt 0) {
  $existing | Select-Object ProcessId, ParentProcessId, CommandLine | Format-Table -AutoSize
  Stop-ProcessTree -RootIds @($existing | ForEach-Object { [int]$_.ProcessId })
  Start-Sleep -Seconds 2
} else {
  Write-Host "No existing Porta dev processes found."
}

if ($Foreground) {
  Write-Host "Starting Porta in the foreground..."
  pnpm dev:tailscale
  exit $LASTEXITCODE
}

Write-Host "Starting Porta in the background..."
$launcher = Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  "Set-Location -LiteralPath '$((Get-Location).Path)'; pnpm dev:tailscale"
) -WindowStyle Hidden -PassThru

Write-Host "Launcher PID: $($launcher.Id)"

$webUrl = "http://${tailscaleIp}:${WebPort}/"
$healthUrl = "http://${tailscaleIp}:${WebPort}/api/health"

Write-Host "Waiting for $webUrl ..."
if (-not (Wait-HttpOk -Url $webUrl)) {
  throw "Web UI did not become healthy at $webUrl"
}

Write-Host "Waiting for $healthUrl ..."
if (-not (Wait-HttpOk -Url $healthUrl)) {
  throw "Proxy health did not become healthy through Vite at $healthUrl"
}

Write-Host "Porta is running:"
Write-Host "  Web UI: $webUrl"
Write-Host "  Proxy:  http://${tailscaleIp}:${ProxyPort}"
