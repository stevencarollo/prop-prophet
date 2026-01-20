@echo off
echo ===================================================
echo     PUSHING TO GITHUB (Prop Prophet Robot)
echo ===================================================
echo.
echo Please authenticate if a popup appears...
echo.
"C:\Program Files\Git\cmd\git.exe" push -u origin main
echo.
echo ===================================================
if %ERRORLEVEL% EQU 0 (
    echo SUCCESS! Your code is now in the cloud.
) else (
    echo FAILED. Please try again or check your credentials.
)
echo ===================================================
pause
