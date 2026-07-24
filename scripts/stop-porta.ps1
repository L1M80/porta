param(
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\porta-process-lib.ps1"

$repoRoot = Get-PortaRepoRoot
$processes = @(Get-PortaDevProcesses -RepoRoot $repoRoot)

if ($processes.Count -eq 0) {
  if (-not $Quiet) {
    Write-Host "No Porta dev processes found."
  }
  exit 0
}

if (-not $Quiet) {
  Write-Host "Stopping Porta dev processes..."
  $processes |
    Select-Object ProcessId, ParentProcessId, CommandLine |
    Format-Table -AutoSize
}

Stop-PortaProcessTree -RootIds @($processes | ForEach-Object { [int]$_.ProcessId })

if (-not $Quiet) {
  Write-Host "Porta dev processes stopped."
}
