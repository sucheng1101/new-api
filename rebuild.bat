@echo off
REM Rebuild the official artifact after code changes:
REM   1. build frontend (web/dist)   2. build backend binary (new-api.exe)
REM After this finishes, close the new-api window and run start-dev.bat again.

cd /d D:\Desktop\object\newapi

echo [1/3] Building frontend (about 2-3 minutes) ...
rd /s /q web\dist 2>nul
cd web
call bun run build
if errorlevel 1 (
  echo FRONTEND BUILD FAILED.
  pause
  exit /b 1
)
cd ..

echo [2/3] Building backend binary ...
go build -o new-api.exe .
if errorlevel 1 (
  echo BACKEND BUILD FAILED.
  pause
  exit /b 1
)

echo [3/3] Done. Now close the new-api window and run start-dev.bat.
pause
