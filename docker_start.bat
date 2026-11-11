@echo off
echo ==============================================
echo    Starting Node.js Web IDE in Docker...
echo ==============================================
echo.

docker pull node:20-alpine
docker pull redis:7-alpine

docker compose up --build -d 2>nul || docker-compose up --build -d

echo.
echo ==============================================
echo  STARTED SUCCESSFULLY!
echo  Open in browser: http://localhost:3000
echo ==============================================
echo.
pause
