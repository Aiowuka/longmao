@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\status.ps1" -InstallRoot "%~dp0"
pause
