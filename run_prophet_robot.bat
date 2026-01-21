@echo off
title 🤖 PROPHET ROBOT (Do Not Close)
color 0A
cls
echo ==================================================
echo         PROPHET AUTOMATION ROBOT ACTIVATE         
echo ==================================================
echo.
echo [1] Checking Dependencies...
call npm list node-cron >nul 2>&1 || call npm install node-cron
echo.
echo [2] Starting Scheduler...
echo    - 11:00 AM: Morning Recon
echo    - 3:00 PM - 8:00 PM: Crunch Time Updates (Every 30m)
echo    - 20 Mins Before Tip: OFFICIAL LOCK RUN
echo.
echo IMPORTANT: KEEP THIS WINDOW OPEN FOR AUTOMATION TO WORK.
echo.

node scheduler.js
pause
