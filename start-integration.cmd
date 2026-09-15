@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22 or newer is required.& exit /b 1)
where npm >nul 2>nul || (echo npm is required.& exit /b 1)
tasklist /FI "IMAGENAME eq WeChat.exe" 2>nul | find /I "WeChat.exe" >nul || tasklist /FI "IMAGENAME eq Weixin.exe" 2>nul | find /I "Weixin.exe" >nul || (echo PC WeChat is not running.& exit /b 1)
if not exist "..\Totoro\package.json" (echo Clone yuyuyudlc/Totoro next to longmao.& exit /b 1)
if not exist "..\WMPFDebugger\package.json" (echo Clone evi0s/WMPFDebugger next to longmao.& exit /b 1)
if not exist "node_modules\ws\package.json" call npm install || exit /b 1
if not exist "..\Totoro\node_modules\next\package.json" pushd "..\Totoro" && call corepack pnpm install --frozen-lockfile --ignore-scripts && popd || exit /b 1
if not exist "..\WMPFDebugger\node_modules\ws\package.json" pushd "..\WMPFDebugger" && call corepack yarn && popd || exit /b 1
start "longmao integration" cmd /k npm run integrate
endlocal
