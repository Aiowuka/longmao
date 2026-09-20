param([Parameter(Mandatory=$false)][string]$InstallRoot = '')
$ErrorActionPreference = 'Stop'
if (-not $InstallRoot) { $InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-LongmaoPaths -InstallRoot $InstallRoot

if (-not (Test-Path $paths.Config) -or -not (Test-Path $paths.Totoro) -or -not (Test-Path $paths.Wmpf)) {
  Write-Host '检测到尚未完成首次安装，正在启动安装向导…' -ForegroundColor Yellow
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'bootstrap.ps1') -InstallRoot $InstallRoot
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-LocalPort -Port 6379)) {
  Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Memurai' } | ForEach-Object {
    if ($_.Status -ne 'Running') { try { Start-Service $_.Name } catch {} }
  }
}
if (-not (Wait-LocalPort -Port 6379 -TimeoutSeconds 10)) { throw 'Redis/Memurai 未运行（127.0.0.1:6379）。' }

$old = Read-LongmaoState -Path $paths.State
if ($old) {
  foreach ($entry in @($old.processes)) {
    if ($entry.pid) {
      try {
        $p = Get-Process -Id ([int]$entry.pid) -ErrorAction SilentlyContinue
        if ($p) { Stop-LongmaoProcessTree -Pid ([int]$entry.pid) }
      } catch {}
    }
  }
}
Remove-Item $paths.State -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $paths.Logs | Out-Null
$config = Get-Content $paths.Config -Raw | ConvertFrom-Json

$previousConfig = $env:LONGMAO_TOTORO_CONFIG
$env:LONGMAO_TOTORO_CONFIG = $paths.Config
$env:PORT = '3000'
$env:NODE_ENV = 'production'

$processes = @()
try {
  $processes += Start-LongmaoManagedProcess -Name 'totoro-web' -WorkingDirectory $paths.Totoro `
    -Command 'npx --yes pnpm@10 start' -LogDirectory $paths.Logs
  if (-not (Wait-LocalPort -Port 3000 -TimeoutSeconds 30)) { throw 'Totoro Web 启动失败，请查看 logs\totoro-web.err.log。' }

  $processes += Start-LongmaoManagedProcess -Name 'totoro-worker' -WorkingDirectory $paths.Totoro `
    -Command 'npx --yes pnpm@10 worker:run' -LogDirectory $paths.Logs

  $processes += Start-LongmaoManagedProcess -Name 'wmpf-debugger' -WorkingDirectory $paths.Wmpf `
    -Command 'npx ts-node src/index.ts --auto-detect' -LogDirectory $paths.Logs
  if (-not (Wait-LocalPort -Port 62000 -TimeoutSeconds 15)) {
    Write-Host 'WMPF CDP 62000 暂未就绪。打开微信并启动一个小程序后再看 Longmao 状态。' -ForegroundColor Yellow
  }

  $processes += Start-LongmaoManagedProcess -Name 'longmao-web' -WorkingDirectory $InstallRoot `
    -Command "set LONGMAO_TOTORO_CONFIG=$($paths.Config)&& node src\web.mjs" -LogDirectory $paths.Logs
  if (-not (Wait-LocalPort -Port 3210 -TimeoutSeconds 15)) { throw 'Longmao Web 启动失败，请查看 logs\longmao-web.err.log。' }

  $state = @{
    schemaVersion = 1
    startedAt = (Get-Date).ToString('o')
    backendOrigin = $config.capture.origin
    processes = $processes
  }
  Write-LongmaoState -Path $paths.State -State $state

  Write-Host ''
  Write-Host 'Longmao 已启动。' -ForegroundColor Green
  Write-Host '1. 打开微信。'
  Write-Host '2. 打开连接到你后台的小程序。'
  Write-Host '3. 浏览器进入 http://127.0.0.1:3210'
  Write-Host '4. 点“连接 CDP”，登录后点“用捕获 Token 同步 Totoro”。'
  Start-Process 'http://127.0.0.1:3210'
} catch {
  foreach ($entry in $processes) { Stop-LongmaoProcessTree -Pid ([int]$entry.pid) }
  throw
} finally {
  if ($null -eq $previousConfig) { Remove-Item Env:LONGMAO_TOTORO_CONFIG -ErrorAction SilentlyContinue }
  else { $env:LONGMAO_TOTORO_CONFIG = $previousConfig }
}
