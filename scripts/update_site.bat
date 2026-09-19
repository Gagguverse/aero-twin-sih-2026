@echo off
title AERO-TWIN - Update Live Website
echo ======================================================================
echo   AERO-TWIN: Bundling latest code updates for GitHub
echo ======================================================================
echo.
node "%~dp0bundle.js"
echo.
echo ======================================================================
echo   [DONE] Latest code bundled into index.html!
echo.
echo   1. GitHub upload page is opening in your browser...
echo   2. Drag & drop the highlighted index.html file into the browser!
echo   3. Click "Commit changes"
echo ======================================================================
start https://github.com/panditharshpandey1-gif/aerotwin-uav/upload/main
explorer.exe /select,"C:\Users\dell\Desktop\aerotwin-uav-github\index.html"
pause
