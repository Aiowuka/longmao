param([Parameter(Mandatory=$false)][string]$InstallRoot = '')
$ErrorActionPreference = 'Stop'
if (-not $InstallRoot) { $InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-LongmaoPaths -InstallRoot $InstallRoot
Write-Host 'Longmao local stack status' -ForegroundColor Cyan
foreach ($item in @(
  @{Name='Redis/Memurai'; Port=6379},
  @{Name='Totoro'; Port=3000},
  @{Name='Longmao'; Port=3210},
  @{Name='WMPF debug'; Port=9421},
  @{Name='WMPF CDP'; Port=62000}
)) {
  $ok = Test-LocalPort -Port $item.Port
  $mark = if ($ok) { 'UP  ' } else { 'DOWN' }
  Write-Host ("{0}  {1,-15}  127.0.0.1:{2}" -f $mark,$item.Name,$item.Port) -ForegroundColor $(if($ok){'Green'}else{'Yellow'})
}
Write-Host ''
Write-Host "Runtime: $($paths.RuntimeRoot)"
Write-Host "Logs:    $($paths.Logs)"
