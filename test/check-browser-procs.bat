@echo off
echo ============================================
echo   Checking browser-related processes
echo ============================================
echo.
echo --- msedge.exe ---
tasklist /FI "IMAGENAME eq msedge.exe" /FO TABLE 2>nul
echo.
echo --- chrome.exe ---
tasklist /FI "IMAGENAME eq chrome.exe" /FO TABLE 2>nul
echo.
echo --- chromium.exe ---
tasklist /FI "IMAGENAME eq chromium.exe" /FO TABLE 2>nul
echo.
echo --- msedgewebview2.exe (count only) ---
set /a count=0
for /f %%A in ('tasklist /FI "IMAGENAME eq msedgewebview2.exe" /FO CSV /NH 2^>nul ^| find /C /V ""') do set /a count=%%A
echo   %count% instances
echo.
echo --- Any process with "edge" or "chrome" in name ---
tasklist /FO CSV /NH 2>nul | findstr /I "chrome msedge chromium"
echo.
pause
