@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required.
  pause
  exit /b 1
)
node src/cli.mjs doctor
if errorlevel 1 goto failure
node src/cli.mjs demo
if errorlevel 1 goto failure
echo.
echo Offline demo completed. Report: artifacts\last-report.json
echo No WeChat connection or production submission was performed.
pause
exit /b 0
:failure
echo.
echo Local demo failed. See the error above.
pause
exit /b 1
