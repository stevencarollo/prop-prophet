@echo off
echo ===================================
echo 🤖 PROP PROPHET: DATA ROBOT 🤖
echo ===================================
echo.
echo Logging into BasketballMonster...
echo Downloading Daily Projections...
echo.
node scripts\download_bbm.js
echo.
echo [DONE] Check for the new Excel file in this folder!
pause
