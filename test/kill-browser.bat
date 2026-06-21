@echo off
setlocal enabledelayedexpansion
echo ============================================
echo   Killing all Chrome / Edge browser processes
echo ============================================

echo.
echo [1/4] Checking current browser state (before kill)...
echo --- msedge.exe ---
tasklist /FI "IMAGENAME eq msedge.exe" /FO CSV /NH 2>nul | findstr /I "msedge.exe"
if %errorlevel% neq 0 echo   (none)
echo --- chrome.exe ---
tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH 2>nul | findstr /I "chrome.exe"
if %errorlevel% neq 0 echo   (none)
echo --- chromium.exe ---
tasklist /FI "IMAGENAME eq chromium.exe" /FO CSV /NH 2>nul | findstr /I "chromium.exe"
if %errorlevel% neq 0 echo   (none)

echo.
echo [2/4] Killing browser processes...
taskkill /F /IM chrome.exe 2>nul && echo   chrome.exe killed || echo   chrome.exe not running
taskkill /F /IM msedge.exe 2>nul && echo   msedge.exe killed || echo   msedge.exe not running
taskkill /F /IM chromium.exe 2>nul && echo   chromium.exe killed || echo   chromium.exe not running

echo.
echo [3/4] Killing background helpers (skip WebView2 — it's used by apps)...
for %%P in (
    GoogleUpdate.exe
    GoogleCrashHandler.exe
    GoogleCrashHandler64.exe
    MicrosoftEdgeUpdate.exe
    MicrosoftEdgeCrashHandler.exe
) do (
    taskkill /F /IM %%P 2>nul && echo   %%P killed || echo   %%P not running
)

echo.
echo [4/4] Verifying browser processes (after kill)...
set "found=0"
for %%B in (msedge.exe chrome.exe chromium.exe) do (
    tasklist /FI "IMAGENAME eq %%B" /FO CSV /NH 2>nul | findstr /I "%%B" >nul 2>&1
    if !errorlevel! equ 0 (
        echo   WARNING: %%B is still running!
        set "found=1"
    )
)
if "%found%"=="0" (
    echo   All browser processes terminated successfully.
) else (
    echo.
    echo   Some processes survived. Try running as Administrator.
)

echo.
echo NOTE: msedgewebview2.exe is WebView2 runtime (used by Tauri and other apps).
echo       It will respawn automatically — this is normal and does NOT affect
echo       the browser detection in python-engine (only checks msedge.exe/chrome.exe).
echo.
pause
