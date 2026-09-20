param(
  [Parameter(Mandatory=$false)][string]$InstallRoot = '',
  [Parameter(Mandatory=$false)][string]$BackendOrigin = '',
  [switch]$LaunchAfterInstall
)
$ErrorActionPreference = 'Stop'
if (-not $InstallRoot) { $InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-LongmaoPaths -InstallRoot $InstallRoot

$TotoroRepo = 'https://github.com/yuyuyudlc/Totoro.git'
$TotoroCommit = 'c499040d52c6e1d45f06f7949419799ccc770db9'
$WmpfRepo = 'https://github.com/evi0s/WMPFDebugger.git'
$WmpfCommit = '8b1359fa282981a777eea72a4851a3e96674fa9c'

function Step([string]$text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }

function Ensure-WingetPackage([string]$CommandName, [string]$PackageId, [string]$DisplayName) {
  if (Get-Command $CommandName -ErrorAction SilentlyContinue) { return }
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw "$DisplayName 未安装，而且系统没有 winget。请先从 Microsoft Store 安装 App Installer。"
  }
  Step "安装 $DisplayName"
  & winget.exe install --id $PackageId --exact --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "$DisplayName 安装失败，winget exit=$LASTEXITCODE" }
  Refresh-ProcessPath
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "$DisplayName 已安装但当前终端尚未识别，请重新运行安装器。"
  }
}

function Ensure-Node22 {
  Ensure-WingetPackage 'node.exe' 'OpenJS.NodeJS.LTS' 'Node.js LTS'
  $major = [int]((& node.exe -p "process.versions.node.split('.')[0]").Trim())
  if ($major -lt 22) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Node.js 必须 >= 22。' }
    Step '升级 Node.js LTS'
    & winget.exe upgrade --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
    Refresh-ProcessPath
    $major = [int]((& node.exe -p "process.versions.node.split('.')[0]").Trim())
    if ($major -lt 22) { throw 'Node.js 必须 >= 22，请升级后重试。' }
  }
}

function Ensure-Memurai {
  if (Test-LocalPort -Port 6379) { return }
  if (-not (Get-Command memurai.exe -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
      throw '需要 Redis-compatible 本地服务。请安装 Memurai Developer 或让 Redis 监听 127.0.0.1:6379。'
    }
    Step '安装 Memurai Developer（本地 Redis-compatible 服务）'
    & winget.exe install --id Memurai.MemuraiDeveloper --exact --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Memurai 安装失败，winget exit=$LASTEXITCODE" }
    Refresh-ProcessPath
  }
  Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Memurai' } | ForEach-Object {
    if ($_.Status -ne 'Running') {
      try { Start-Service $_.Name } catch {}
    }
  }
  if (-not (Wait-LocalPort -Port 6379 -TimeoutSeconds 15)) {
    throw 'Memurai/Redis 没有在 127.0.0.1:6379 启动。请在 Windows 服务中启动 Memurai 后重试。'
  }
}

function Checkout-Pinned([string]$Repo, [string]$Commit, [string]$Destination, [string]$Name) {
  Step "准备 $Name"
  if (-not (Test-Path (Join-Path $Destination '.git'))) {
    if (Test-Path $Destination) { Remove-Item -Recurse -Force $Destination }
    & git.exe clone --filter=blob:none --no-checkout $Repo $Destination
    if ($LASTEXITCODE -ne 0) { throw "$Name clone 失败" }
  }
  & git.exe -C $Destination fetch origin $Commit --depth 1
  if ($LASTEXITCODE -ne 0) { throw "$Name fetch pinned commit 失败" }
  & git.exe -C $Destination checkout --detach --force $Commit
  if ($LASTEXITCODE -ne 0) { throw "$Name checkout pinned commit 失败" }
}

Step '检查运行环境'
Ensure-Node22
Ensure-WingetPackage 'git.exe' 'Git.Git' 'Git'
Ensure-Memurai

New-Item -ItemType Directory -Force -Path $paths.Upstreams | Out-Null
New-Item -ItemType Directory -Force -Path $paths.Logs | Out-Null

Checkout-Pinned $TotoroRepo $TotoroCommit $paths.Totoro 'Totoro'
Checkout-Pinned $WmpfRepo $WmpfCommit $paths.Wmpf 'WMPFDebugger'

Step '安装 Totoro 依赖'
Push-Location $paths.Totoro
try {
  & npx.cmd --yes pnpm@10 install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Totoro pnpm install 失败' }
} finally { Pop-Location }

Step '安装 WMPFDebugger 依赖'
Push-Location $paths.Wmpf
try {
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw 'WMPFDebugger npm install 失败' }
} finally { Pop-Location }

if (-not (Test-Path $paths.Config) -or $BackendOrigin) {
  Step '配置你的后台'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'configure.ps1') `
    -InstallRoot $InstallRoot -BackendOrigin $BackendOrigin
  if ($LASTEXITCODE -ne 0) { throw 'Longmao 配置失败' }
} else {
  $config = Get-Content $paths.Config -Raw | ConvertFrom-Json
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'configure.ps1') `
    -InstallRoot $InstallRoot -BackendOrigin $config.capture.origin
}

Step '构建 Totoro'
Push-Location $paths.Totoro
try {
  & npx.cmd --yes pnpm@10 build
  if ($LASTEXITCODE -ne 0) { throw 'Totoro build 失败' }
} finally { Pop-Location }

$runtimeInfo = [ordered]@{
  schemaVersion = 1
  installedAt = (Get-Date).ToString('o')
  installRoot = $InstallRoot
  totoro = [ordered]@{ repo = $TotoroRepo; commit = $TotoroCommit; path = $paths.Totoro }
  wmpf = [ordered]@{ repo = $WmpfRepo; commit = $WmpfCommit; path = $paths.Wmpf }
  redis = [ordered]@{ url = 'redis://127.0.0.1:6379'; provider = 'Memurai-or-compatible' }
}
$runtimeInfo | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $paths.RuntimeRoot 'runtime.json') -Encoding UTF8

Step '安装完成'
Write-Host "Runtime: $($paths.RuntimeRoot)" -ForegroundColor Green
Write-Host 'Totoro 和 WMPFDebugger 是从各自上游仓库拉取的独立副本，没有打包进 Longmao。'

if ($LaunchAfterInstall) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start.ps1') -InstallRoot $InstallRoot
}
