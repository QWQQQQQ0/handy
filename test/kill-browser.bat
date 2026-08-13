@echo off
setlocal enabledelayedexpansion
echo ============================================
echo   Edge Lockfile — Occupancy Detection
echo ============================================

set "LOCKFILE=C:\Users\吴清\AppData\Local\Microsoft\Edge\User Data\lockfile"

echo.
echo [1/4] Lockfile status...
if exist "%LOCKFILE%" (
    echo   EXISTS:  %LOCKFILE%
    for %%F in ("%LOCKFILE%") do echo   Size: %%~zF bytes
) else (
    echo   NOT FOUND — nothing is locking it
)

echo.
echo [2/4] Edge / Chrome processes (PID ^| Name ^| CPU time ^| Memory):
tasklist /FI "IMAGENAME eq msedge.exe" /FO TABLE 2>nul
tasklist /FI "IMAGENAME eq chrome.exe" /FO TABLE 2>nul
tasklist /FI "IMAGENAME eq chromium.exe" /FO TABLE 2>nul

echo.
echo [3/4] WebView2 processes (these are the #1 cause of lockfile conflicts):
echo   WebView2 is embedded in: VS Code, Tauri apps, Teams, Outlook, Widgets, etc.
echo.
tasklist /FI "IMAGENAME eq msedgewebview2.exe" /FO TABLE /V 2>nul
echo.
echo   PowerShell: which apps host these WebView2 instances?
powershell -NoProfile -Command ^
  "$procs = Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" 2^>$null;" ^
  "if ($procs) {" ^
  "  foreach ($p in $procs) {" ^
  "    try { $parent = Get-Process -Id $p.ParentProcessId -ErrorAction Stop; Write-Host ('  PID ' + $p.ProcessId + ' (parent PID ' + $p.ParentProcessId + ': ' + $parent.ProcessName + ')  cmd:' + $p.CommandLine.Substring(0, [Math]::Min(200, $p.CommandLine.Length))) }" ^
  "    catch { Write-Host ('  PID ' + $p.ProcessId + ' (parent PID ' + $p.ParentProcessId + ': unknown)') }" ^
  "  }" ^
  "} else { Write-Host '  (no WebView2 processes found)' }"

echo.
echo [4/4] Which process holds the lockfile?

where handle.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo   Using Sysinternals handle.exe...
    echo.
    handle.exe -accepteula "%LOCKFILE%" 2>nul
    if %errorlevel% neq 0 echo   No process has an open handle to the lockfile right now.
) else (
    echo   handle.exe NOT INSTALLED (Sysinternals tool — best way to find lock holder)
    echo.
    echo   Install it:
    echo     winget install Microsoft.Sysinternals.Handle
    echo   Or download:
    echo     https://learn.microsoft.com/en-us/sysinternals/downloads/handle
    echo.
    echo   ── Manual check ──
    echo   Look at the WebView2 processes above. Each one likely holds a handle
    echo   to the Edge User Data folder. If you see any msedgewebview2.exe with
    echo   a parent process like "code.exe" (VS Code) or "Teams.exe", THAT is
    echo   what's locking your Edge profile.
    echo.
    echo   Quick fix: close VS Code / Teams / other Chromium-based apps,
    echo   then reopen your app. The lockfile should be free.
)

echo.
echo ============================================
echo Summary:
echo   - ^"msedge.exe^"    = Edge browser windows you opened
echo   - ^"msedgewebview2.exe^" = WebView2 runtime (embedded in apps)
echo   - If no msedge.exe is running but the lockfile is held,
echo     a WebView2 host app (VS Code, Teams, etc.) is the culprit.
echo ============================================
echo.
pause
