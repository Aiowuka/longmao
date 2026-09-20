param([Parameter(Mandatory=$false)][string]$InstallRoot = '')
$ErrorActionPreference = 'Stop'
if (-not $InstallRoot) { $InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-LongmaoPaths -InstallRoot $InstallRoot
$state = Read-LongmaoState -Path $paths.State
if (-not $state) {
  Write-Host '没有发现 Longmao 运行状态。'
  exit 0
}
foreach ($entry in @($state.processes)) {
  if ($entry.pid) {
    Write-Host "停止 $($entry.name) (PID $($entry.pid))"
    Stop-LongmaoProcessTree -Pid ([int]$entry.pid)
  }
}
Remove-Item $paths.State -Force -ErrorAction SilentlyContinue
Write-Host 'Longmao/Totoro/WMPF 进程已停止。' -ForegroundColor Green
