@echo off
REM Start new-api official build (backend + embedded frontend) on port 1001.
REM There is only ONE version now: the compiled binary serves everything.

cd /d D:\Desktop\object\newapi
set PORT=1001

start "new-api (1001)" cmd /k new-api.exe

echo.
echo Official site: http://localhost:1001
echo A window will open and show live logs. Close it to stop the service.
echo.
echo NOTE: If frontend code (web/) was changed, run rebuild.bat first,
echo       then close the new-api window and run this script again.
echo.
pause
