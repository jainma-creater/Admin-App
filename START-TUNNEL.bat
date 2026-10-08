@echo off
REM ============================================================
REM   SUPER ADMIN - PUBLIC LINK VIA CLOUDFLARE TUNNEL
REM   Double-click this file. Wait a few seconds and the
REM   public https link appears IN THIS WINDOW.
REM   Share that link. Keep this window open while in use.
REM
REM   Note: the link changes every time you run this file.
REM   The old link stops working once this window closes.
REM ============================================================
title Super Admin - Cloudflare Tunnel

echo.
echo  [1/2] Checking backend is running (port 8010)...
powershell -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port 8010 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }" > nul 2>&1
if errorlevel 1 (
    echo.
    echo  X Backend is NOT running.
    echo    Double-click START-HERE.bat first, wait for it to finish,
    echo    then run this file again.
    echo.
    pause
    exit /b 1
)
echo        Backend OK.

echo.
echo  [2/2] Starting secure tunnel...
echo.
echo  ============================================================
echo   YOUR PUBLIC LINK (copy the https:// line below):
echo  ============================================================
echo.

cloudflared tunnel --url http://localhost:8010

echo.
echo  Tunnel stopped - the old link no longer works.
echo  Run this file again to get a new link.
pause > nul
