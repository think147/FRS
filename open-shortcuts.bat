@echo off
REM Open dev login to set admin session, then open admin and kiosk pages
REM Usage: double-click this file or run from cmd while server is running

setlocal
set HOST=http://localhost:3000

echo Opening dev login to set admin session...
start "" "%HOST%/dev/login"
timeout /t 2 /nobreak >nul
echo Opening Admin UI...
start "" "%HOST%/admin"
echo Opening Kiosk UI...
start "" "%HOST%/"
endlocal
exit /b 0
