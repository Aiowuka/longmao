param([string]$Version = '0.5.0')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$iss = Join-Path $PSScriptRoot 'Longmao.iss'
$iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if (-not $iscc) {
  $candidate = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
  if (Test-Path $candidate) { $iscc = Get-Item $candidate }
}
if (-not $iscc) { throw 'Inno Setup 6 (ISCC.exe) not found.' }
& $iscc.Source "/DMyAppVersion=$Version" $iss
if ($LASTEXITCODE -ne 0) { throw "ISCC failed: $LASTEXITCODE" }
Write-Host "Installer output: $(Join-Path $PSScriptRoot 'output')" -ForegroundColor Green
