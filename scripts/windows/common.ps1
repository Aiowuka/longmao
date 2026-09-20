$ErrorActionPreference = 'Stop'

function Get-LongmaoRuntimeRoot {
  if ($env:LONGMAO_RUNTIME_ROOT) { return $env:LONGMAO_RUNTIME_ROOT }
  return (Join-Path $env:LOCALAPPDATA 'LongmaoRuntime')
}

function Get-LongmaoPaths {
  param([string]$InstallRoot)
  $runtime = Get-LongmaoRuntimeRoot
  [pscustomobject]@{
    InstallRoot = $InstallRoot
    RuntimeRoot = $runtime
    Upstreams = Join-Path $runtime 'upstreams'
    Totoro = Join-Path (Join-Path $runtime 'upstreams') 'Totoro'
    Wmpf = Join-Path (Join-Path $runtime 'upstreams') 'WMPFDebugger'
    Logs = Join-Path $runtime 'logs'
    Config = Join-Path $runtime 'totoro.json'
    State = Join-Path $runtime 'processes.json'
  }
}

function Refresh-ProcessPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Test-LocalPort {
  param([int]$Port)
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $task.Wait(700)) { $client.Dispose(); return $false }
    $ok = $client.Connected
    $client.Dispose()
    return $ok
  } catch {
    return $false
  }
}

function Wait-LocalPort {
  param([int]$Port, [int]$TimeoutSeconds = 20)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Test-LocalPort -Port $Port) { return $true }
    Start-Sleep -Milliseconds 350
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Write-LongmaoState {
  param([string]$Path, [hashtable]$State)
  $dir = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $State | ConvertTo-Json -Depth 6 | Set-Content -Path $Path -Encoding UTF8
}

function Read-LongmaoState {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  try { return Get-Content $Path -Raw | ConvertFrom-Json } catch { return $null }
}

function Start-LongmaoManagedProcess {
  param(
    [string]$Name,
    [string]$WorkingDirectory,
    [string]$Command,
    [string]$LogDirectory
  )
  New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
  $stdout = Join-Path $LogDirectory "$Name.out.log"
  $stderr = Join-Path $LogDirectory "$Name.err.log"
  $process = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d','/s','/c',$Command) `
    -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $stdout -RedirectStandardError $stderr `
    -WindowStyle Hidden -PassThru
  return [pscustomobject]@{
    name = $Name
    pid = $process.Id
    command = $Command
    workingDirectory = $WorkingDirectory
    startedAt = (Get-Date).ToString('o')
    stdout = $stdout
    stderr = $stderr
  }
}

function Stop-LongmaoProcessTree {
  param([int]$Pid)
  if ($Pid -le 0) { return }
  try {
    taskkill.exe /PID $Pid /T /F 2>$null | Out-Null
  } catch {}
}
