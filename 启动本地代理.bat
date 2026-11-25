@echo off
chcp 65001 >nul
title Stream Player Proxy - Keep This Window Open
echo.
echo  ============================================================
echo    Stream Player - Local Proxy Server
echo  ============================================================
echo.
echo  Keep this window open. Closing it stops the proxy.
echo  Use the address printed below in the player's proxy settings.
echo.
echo  ------------------------------------------------------------
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js not found. Install it from https://nodejs.org
  echo.
  pause
  exit /b 1
)
title Stream Player - Proxy Running (Do Not Close)
node proxy-server.js
echo.
echo  Proxy stopped. Check the messages above if this was unexpected.
echo.
pause
