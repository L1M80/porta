$ErrorActionPreference = "Stop"

function Get-PortaRepoRoot {
  return (Split-Path -Parent $PSScriptRoot)
}

function Resolve-PortaTailscaleIp {
  param([string]$HostAddress)

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
  param([string]$RepoRoot = (Get-PortaRepoRoot))

  $repoPattern = [regex]::Escape($RepoRoot)
  Get-CimInstance Win32_Process | Where-Object {
    $cmd = $_.CommandLine
    if (-not $cmd) {
      return $false
    }

    $cmd -match "pnpm(?:\.mjs|\.cmd)?\s+dev:tailscale" -or
    $cmd -match "pnpm(?:\.mjs|\.cmd)?\s+serve:tailscale" -or
    $cmd -match "scripts[\\/]+dev-tailscale\.mjs" -or
    $cmd -match "scripts[\\/]+serve-tailscale\.mjs" -or
    ($cmd -match $repoPattern -and $cmd -match "packages[\\/]+web[\\/]+node_modules" -and $cmd -match "vite") -or
    ($cmd -match $repoPattern -and $cmd -match "packages[\\/]+proxy[\\/]+node_modules" -and $cmd -match "tsx") -or
    ($cmd -match $repoPattern -and $cmd -match "packages[\\/]+proxy[\\/]+dist[\\/]+index\.js")
  }
}

function Stop-PortaProcessTree {
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

  $targets = $all |
    Where-Object { $ids.Contains([int]$_.ProcessId) } |
    Sort-Object ProcessId -Descending

  foreach ($target in $targets) {
    try {
      Stop-Process -Id $target.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Warning "Could not stop PID $($target.ProcessId): $($_.Exception.Message)"
    }
  }
}

function Wait-PortaHttpOk {
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

function Get-PortaHealth {
  param(
    [string]$HostAddress,
    [int]$ProxyPort = 3170,
    [int]$TimeoutSeconds = 10
  )

  $url = "http://${HostAddress}:${ProxyPort}/api/health"
  Invoke-RestMethod -Uri $url -TimeoutSec $TimeoutSeconds
}
