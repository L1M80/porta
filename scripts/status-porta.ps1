param(
  [string]$HostAddress,
  [int]$WebPort = 5173,
  [int]$ProxyPort = 3170
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\porta-process-lib.ps1"

$repoRoot = Get-PortaRepoRoot
$tailscaleIp = Resolve-PortaTailscaleIp -HostAddress $HostAddress

Write-Host "Porta repository: $repoRoot"
Write-Host "Tailscale IP:     $tailscaleIp"

$processes = @(Get-PortaDevProcesses -RepoRoot $repoRoot)
Write-Host ""
Write-Host "Porta dev processes: $($processes.Count)"
if ($processes.Count -gt 0) {
  $processes |
    Select-Object ProcessId, ParentProcessId, CommandLine |
    Format-Table -AutoSize
}

Write-Host ""
Write-Host "TCP listeners:"
cmd /c "netstat -ano -p tcp | findstr /R "":$ProxyPort :$WebPort"""

Write-Host ""
Write-Host "Health:"
try {
  $health = Get-PortaHealth -HostAddress $tailscaleIp -ProxyPort $ProxyPort
  $health | ConvertTo-Json -Depth 8
} catch {
  Write-Warning $_.Exception.Message
  exit 1
}
