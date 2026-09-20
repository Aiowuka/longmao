@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\start.ps1" -InstallRoot "%~dp0"
if errorlevel 1 (
  echo.
  echo Longmao start failed. See %%LOCALAPPDATA%%\LongmaoRuntime\logs
  pause
)
