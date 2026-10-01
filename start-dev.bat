@echo off
REM Start the single new-api build (backend + embedded frontend) on port 1004.
REM There is only ONE version now: the compiled binary serves everything.

cd /d D:\Desktop\object\newapi
set PORT=1004

start "new-api (1004)" cmd /k new-api.exe

echo.
echo Official site: http://localhost:1004
echo A window will open and show live logs. Close it to stop the service.
echo.
echo NOTE: If frontend code (web/) was changed, run rebuild.bat first,
echo       then close the new-api window and run this script again.
echo.
pause
