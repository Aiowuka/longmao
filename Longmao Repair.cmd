@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\bootstrap.ps1" -InstallRoot "%~dp0"
if errorlevel 1 pause
