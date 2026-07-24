param(
  [string]$HostAddress,
  [int]$WebPort = 5173,
  [int]$ProxyPort = 3170,
  [switch]$Foreground,
  [switch]$RequireLanguageServer,
  [switch]$Stable
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\porta-process-lib.ps1"

$repoRoot = Get-PortaRepoRoot
Set-Location -LiteralPath $repoRoot

$tailscaleIp = Resolve-PortaTailscaleIp -HostAddress $HostAddress

Write-Host "Stopping existing Porta dev processes..."
$existing = @(Get-PortaDevProcesses -RepoRoot $repoRoot)
if ($existing.Count -gt 0) {
  $existing | Select-Object ProcessId, ParentProcessId, CommandLine | Format-Table -AutoSize
  Stop-PortaProcessTree -RootIds @($existing | ForEach-Object { [int]$_.ProcessId })
  Start-Sleep -Seconds 2
} else {
  Write-Host "No existing Porta dev processes found."
}

if ($Foreground) {
  if ($Stable) {
    Write-Host "Starting Porta stable server in the foreground..."
    pnpm serve:tailscale
  } else {
    Write-Host "Starting Porta dev server in the foreground..."
    pnpm dev:tailscale
  }
  exit $LASTEXITCODE
}

$scriptName = if ($Stable) { "serve:tailscale" } else { "dev:tailscale" }
$modeName = if ($Stable) { "stable" } else { "dev" }

Write-Host "Starting Porta $modeName server in the background..."
$launcher = Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  "Set-Location -LiteralPath '$repoRoot'; pnpm $scriptName"
) -WindowStyle Hidden -PassThru

Write-Host "Launcher PID: $($launcher.Id)"

$webUrl = "http://${tailscaleIp}:${WebPort}/"
$healthUrl = "http://${tailscaleIp}:${ProxyPort}/api/health"
$startupTimeoutSeconds = if ($Stable) { 180 } else { 45 }

Write-Host "Waiting for $webUrl ..."
if (-not (Wait-PortaHttpOk -Url $webUrl -TimeoutSeconds $startupTimeoutSeconds)) {
  throw "Web UI did not become healthy at $webUrl"
}

Write-Host "Waiting for $healthUrl ..."
if (-not (Wait-PortaHttpOk -Url $healthUrl -TimeoutSeconds $startupTimeoutSeconds)) {
  throw "Proxy health did not become healthy through Vite at $healthUrl"
}

$health = Get-PortaHealth -HostAddress $tailscaleIp -ProxyPort $ProxyPort
$languageServerCount = @($health.languageServers).Count

if ($RequireLanguageServer -and $languageServerCount -eq 0) {
  throw "Porta is running, but no Antigravity Language Server was discovered."
}

Write-Host "Porta is running:"
Write-Host "  Web UI:           $webUrl"
Write-Host "  Proxy:            http://${tailscaleIp}:${ProxyPort}"
Write-Host "  Mode:             $modeName"
Write-Host "  Language servers: $languageServerCount"
