@echo off
setlocal

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -NoBrowser

if errorlevel 1 (
  echo.
  echo Airport Departure Board could not be started.
  echo See the error above, then press any key to close this window.
  pause >nul
  exit /b 1
)

start "" "http://localhost:4173/"

endlocal
