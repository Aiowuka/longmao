@echo off
setlocal
title Longmao One-Click Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\bootstrap.ps1" -InstallRoot "%~dp0" -LaunchAfterInstall
if errorlevel 1 (
  echo.
  echo Setup failed. Review the message above and run this file again.
  pause
)
