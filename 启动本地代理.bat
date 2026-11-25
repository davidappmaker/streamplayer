@echo off
chcp 65001 >nul
title 直播源播放器 - 本地代理（请勿关闭此窗口）
mode con cols=80 lines=22
echo.
echo  ============================================================
echo    直播源播放器 - 本地代理服务
echo  ============================================================
echo.
echo   [1] 这个黑窗口必须一直开着，关掉后播放器就无法播放代理源。
echo   [2] 窗口里出现 "本地代理已启动" 就表示启动成功。
echo   [3] 电脑用：播放器「更多 - 代理设置」填 http://127.0.0.1:8787/?url=
echo       手机用：窗口会显示一个 192.168.x.x 的地址，手机连同一 WiFi
echo               后填那个地址，速度比走 Cloudflare 快很多
echo   [4] 用完后直接关掉这个窗口即可停止代理。
echo.
echo  ------------------------------------------------------------
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没有找到 Node.js，无法启动代理。
  echo   请先安装 Node.js：https://nodejs.org
  echo.
  pause
  exit /b 1
)
title 直播源播放器 - 代理运行中（请勿关闭）
node proxy-server.js
echo.
echo  代理服务已停止。如果是意外退出，请检查上面的报错信息。
echo.
pause
