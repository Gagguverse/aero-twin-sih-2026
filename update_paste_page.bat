@echo off
echo ======================================================================
echo   AERO-TWIN: Updating paste.page/aerotwin-uav with Latest Code
echo ======================================================================
echo.
echo 1. Regenerating dist/index.html bundle...
node scratch/bundle.js
echo.
echo 2. Copying updated bundle directly into your Windows Clipboard...
powershell -Command "Get-Content -Raw 'dist/index.html' | Set-Clipboard"
echo    [DONE] Latest code (640 KB) is now copied in your clipboard!
echo.
echo 3. Opening https://paste.page/aerotwin-uav in your browser...
start https://paste.page/aerotwin-uav
echo.
echo ======================================================================
echo   NEXT STEP IN YOUR BROWSER:
echo   - Look at the bottom-left corner of the page: click "Edit this page ->"
echo   - Press Ctrl+A (Select All) and Ctrl+V (Paste)
echo   - Click "Save" / "Publish"
echo   The link https://paste.page/aerotwin-uav will be updated instantly!
echo ======================================================================
pause
