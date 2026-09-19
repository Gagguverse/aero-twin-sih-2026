@echo off
title Deploy AERO-TWIN to Netlify (Permanent 100% Free Link)
echo ======================================================================
echo   AERO-TWIN: DRDO MALE UAV Digital Twin (SIH 2026)
echo   Deploy to Permanent Global CDN (Netlify - Never gets blocked!)
echo ======================================================================
echo.
echo 1. Bundling latest code into dist...
node scratch/bundle.js
echo.
echo 2. Opening dist folder in Windows File Explorer...
start explorer "%~dp0dist"
echo.
echo 3. Opening Netlify Drop in your web browser...
start https://app.netlify.com/drop
echo.
echo ======================================================================
echo   HOW TO GET YOUR PERMANENT LINK (Takes 10 seconds):
echo ======================================================================
echo   1. In your browser (app.netlify.com/drop), log in with Google/GitHub (Free)
echo   2. Drag and drop the "dist" folder from the Explorer window into the browser!
echo   3. Netlify will instantly create a permanent link like:
echo      https://aerotwin-uav.netlify.app
echo.
echo   * This link NEVER expires!
echo   * Opens on Jio, Airtel, Vi, College WiFi, Mobile, Laptop globally!
echo ======================================================================
pause
