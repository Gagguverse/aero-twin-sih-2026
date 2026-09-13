@echo off
title AERO-TWIN - Deploy Live Globally
echo ======================================================================
echo   AERO-TWIN: DRDO MALE UAV Aero Piston Engine Digital Twin
echo   Deploying to Global CDN (aerotwin-engine.surge.sh)
echo ======================================================================
echo.
echo [1/2] Bundling latest HTML, CSS, and JS files...
node scratch/bundle.js
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Bundling failed!
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo [2/2] Publishing dist folder to https://aerotwin-engine.surge.sh ...
npx --yes surge ./dist --domain aerotwin-engine.surge.sh
echo.
echo ======================================================================
echo   SUCCESS! Your website is live worldwide at:
echo   https://aerotwin-engine.surge.sh
echo ======================================================================
echo.
echo Opening live site in your browser...
start https://aerotwin-engine.surge.sh
pause
