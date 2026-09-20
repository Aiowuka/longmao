param(
  [Parameter(Mandatory=$false)][string]$InstallRoot = '',
  [Parameter(Mandatory=$false)][string]$BackendOrigin = ''
)
$ErrorActionPreference = 'Stop'
if (-not $InstallRoot) { $InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-LongmaoPaths -InstallRoot $InstallRoot
New-Item -ItemType Directory -Force -Path $paths.RuntimeRoot | Out-Null

function Normalize-Origin([string]$value) {
  $value = $value.Trim().TrimEnd('/')
  try { $uri = [Uri]$value } catch { throw '后台地址不是有效 URL。' }
  if ($uri.Scheme -ne 'https') { throw '后台必须使用 HTTPS。' }
  if (-not $uri.Host) { throw '后台地址缺少主机名。' }
  if ($uri.AbsolutePath -ne '/') { throw '这里只填写 origin，例如 https://api.example.com，不要带 /wxxcx 路径。' }
  if ($uri.Query -or $uri.Fragment -or $uri.UserInfo) { throw '后台 origin 不能带 query、fragment 或用户名密码。' }
  return $uri.GetLeftPart([UriPartial]::Authority)
}

if (-not $BackendOrigin) {
  Write-Host ''
  Write-Host 'Longmao 首次配置' -ForegroundColor Cyan
  Write-Host '请输入你的 Totoro-compatible 后台 HTTPS origin。'
  Write-Host '示例: https://api.example.com'
  $BackendOrigin = Read-Host 'Backend origin'
}
$BackendOrigin = Normalize-Origin $BackendOrigin

$config = [ordered]@{
  schemaVersion = 1
  baseUrl = 'http://127.0.0.1:3000'
  capture = [ordered]@{
    origin = $BackendOrigin
    pathPrefixes = @('/wxxcx/')
    requestHeaderNames = @('authorization')
    responseJsonPaths = @('token','data.token')
  }
}
$config | ConvertTo-Json -Depth 6 | Set-Content -Path $paths.Config -Encoding UTF8

if (Test-Path $paths.Totoro) {
  $envFile = Join-Path $paths.Totoro '.env.local'
  @(
    "SUNRUN_MINIPROGRAM_BASE_URL=$BackendOrigin"
    "SUNRUN_MINIPROGRAM_FALLBACK_BASE_URL=$BackendOrigin"
    'REDIS_URL=redis://127.0.0.1:6379'
  ) | Set-Content -Path $envFile -Encoding UTF8
}

Write-Host ''
Write-Host '配置完成。' -ForegroundColor Green
Write-Host "后台: $BackendOrigin"
Write-Host "Longmao 配置: $($paths.Config)"
