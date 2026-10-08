@echo off
REM ============================================================
REM   BRANCH VISIT - ONE CLICK START
REM   Double-click this file. Wait. Then scan the QR with Expo Go.
REM ============================================================
title Branch Visit - Starting...
cd /d "%~dp0"

echo.
echo  ============================================
echo   BRANCH VISIT - STARTING EVERYTHING
echo  ============================================
echo.

REM ---------- Step 1: Docker backend ----------
echo  [1/4] Starting the server (Docker)...
set TRY=0
:docker_retry
docker compose up -d backend
if not errorlevel 1 goto docker_ok
set /a TRY+=1
if %TRY% geq 3 goto docker_fail
echo    Retrying in 15 seconds... (attempt %TRY% of 3)
timeout /t 15 /nobreak >nul
goto docker_retry
:docker_fail
echo.
echo  X ERROR: Could not start Docker services.
echo    Open "Docker Desktop" first, wait for it to say "Running",
echo    then double-click this file again.
echo.
pause
exit /b 1
:docker_ok
echo    Server started.
echo.

REM ---------- Step 2: wait until API answers ----------
REM NOTE: on some Windows setups Docker's localhost proxy stalls, so we probe
REM the LAN IP(s) of this PC - the same path the phone will use.
set "PCIP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=* delims= " %%b in ("%%a") do if not defined PCIP set "PCIP=%%b"
)
echo  [2/4] Waiting for the server to be ready (first run takes ~1-2 min)...
set /a tries=0
:waitloop
set /a tries+=1
set ALIVE=0
if defined PCIP curl -s --max-time 5 -o nul http://%PCIP%:8010/docs && set ALIVE=1
curl -s --max-time 5 -o nul http://localhost:8010/docs && set ALIVE=1
if %ALIVE%==0 (
    if %tries% lss 40 (
        timeout /t 3 /nobreak >nul
        goto waitloop
    )
    echo    X WARNING: Server did not answer after 2 minutes.
    echo    Check it with:  docker compose logs backend
    echo.
) else (
    echo    Server is ready.
)
echo.

REM ---------- Step 3: seed data (admin user) ----------
echo  [3/4] Loading demo data (admin user, branches, checklist)...
docker compose exec -T backend python seed.py 2>nul
if errorlevel 1 (
    echo    (Skipped - maybe already seeded. That is fine.)
) else (
    echo    Demo data ready.
)
echo.

REM ---------- Step 4: show IP and start Expo ----------
echo  [4/4] Starting the mobile app (Expo)...
echo.

REM Show PC's Wi-Fi IP so user knows which one to use on the phone
echo    (The app will connect to port 8010 - already handled automatically)
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=* delims= " %%b in ("%%a") do echo    Your PC IP: %%b
)
echo.

echo    NEXT STEPS ON YOUR PHONE:
echo    1. Connect phone Wi-Fi to the SAME network as this PC
echo    2. Install "Expo Go" from Play Store
echo    3. Open Expo Go, tap "Scan QR code"
echo    4. Scan the QR code that appears below
echo    5. Login:  admin@company.com  /  change-this-password
echo.
echo    IF THE APP CANNOT CONNECT (esp. office / company Wi-Fi):
echo    Most office Wi-Fi BLOCKS phones from talking to PCs.
echo    FIX (always works): turn on your PHONE HOTSPOT,
echo    connect THIS PC's Wi-Fi to the phone hotspot, then
echo    double-click this file again and rescan the QR.
echo.
echo    (Firewall allow rules for ports 8081 + 8010 are already set up.)
echo.
echo  ============================================
echo   QR CODE COMING UP...  (keep this window open)
echo  ============================================
echo.

cd mobile
set NODE_OPTIONS=--max-old-space-size=4096
node --max-old-space-size=4096 node_modules/expo/bin/cli start --clear

echo.
echo  Expo stopped.
pause
