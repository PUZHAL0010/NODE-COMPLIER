@echo off
echo ==============================================
echo    Stopping Node.js Web IDE Docker Stack...
echo ==============================================
echo.

docker compose down 2>nul || docker-compose down

echo.
echo ==============================================
echo  STOPPED SUCCESSFULLY!
echo ==============================================
echo.
pause
