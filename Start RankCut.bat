@echo off
set "APP_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%start.ps1"
if errorlevel 1 (
  echo.
  echo RankCut Studio could not start. Review the message above.
  pause
)

