@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required.
  pause
  exit /b 1
)
echo Starting Longmao Local Web on http://127.0.0.1:3210
echo Press Ctrl+C to stop.
node srcweb.mjs
