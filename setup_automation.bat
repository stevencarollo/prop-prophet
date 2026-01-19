@echo off
echo ===================================
echo 🤖 INSTALLING AUTOMATION TOOLS 🤖
echo ===================================
echo.
echo Installing Check (Puppeteer)...
call npm install puppeteer
echo.
echo Installing Netlify Automation Tools...
call npm install netlify-cli -g
echo.
echo Installing Scheduler (node-cron)...
call npm install node-cron
echo.
echo Done! You can now use the automated download features.
pause
