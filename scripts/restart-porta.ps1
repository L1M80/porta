param(
  [string]$HostAddress,
  [int]$WebPort = 5173,
  [int]$ProxyPort = 3170,
  [switch]$Foreground,
  [switch]$RequireLanguageServer
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
  "Set-Location -LiteralPath '$repoRoot'; pnpm dev:tailscale"
) -WindowStyle Hidden -PassThru

Write-Host "Launcher PID: $($launcher.Id)"

$webUrl = "http://${tailscaleIp}:${WebPort}/"
$healthUrl = "http://${tailscaleIp}:${WebPort}/api/health"

Write-Host "Waiting for $webUrl ..."
if (-not (Wait-PortaHttpOk -Url $webUrl)) {
  throw "Web UI did not become healthy at $webUrl"
}

Write-Host "Waiting for $healthUrl ..."
if (-not (Wait-PortaHttpOk -Url $healthUrl)) {
  throw "Proxy health did not become healthy through Vite at $healthUrl"
}

$health = Get-PortaHealth -HostAddress $tailscaleIp -WebPort $WebPort
$languageServerCount = @($health.languageServers).Count

if ($RequireLanguageServer -and $languageServerCount -eq 0) {
  throw "Porta is running, but no Antigravity Language Server was discovered."
}

Write-Host "Porta is running:"
Write-Host "  Web UI:           $webUrl"
Write-Host "  Proxy:            http://${tailscaleIp}:${ProxyPort}"
Write-Host "  Language servers: $languageServerCount"
