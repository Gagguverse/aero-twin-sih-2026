@echo off
title JetEngine - Live Server & Public Tunnel
echo ========================================================
echo   Starting JetEngine Local Server (Port 3000)...
echo ========================================================
start /b node server.js
timeout /t 2 >nul
echo.
echo ========================================================
echo   Starting Public Tunnel (localhost.run)...
echo   Your shareable HTTPS link will appear below:
echo ========================================================
echo.
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:3000 nokey@localhost.run
pause
