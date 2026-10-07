@echo off
rem Double-click to update Floration from GitHub and open it.
cd /d "%~dp0"
call npm run app
if errorlevel 1 pause
