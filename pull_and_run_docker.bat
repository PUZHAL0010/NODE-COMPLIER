@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo   Node.js Web IDE - Pull & Run in Docker (End-to-End)
echo ===================================================
echo.
echo Choose an option:
echo [1] Pull base images and run complete stack with Docker Compose (Recommended)
echo [2] Pull published image from Docker Hub and run standalone container
echo.

set /p OPTION="Enter choice (1 or 2): "

if "%OPTION%"=="2" (
    set /p DOCKER_USER="Enter your Docker Hub username: "
    if "!DOCKER_USER!"=="" (
        echo [ERROR] Username cannot be empty.
        pause
        exit /b 1
    )
    set FULL_IMAGE=!DOCKER_USER!/node-compiler-platform:latest
    echo.
    echo [1/2] Pulling image: !FULL_IMAGE! ...
    docker pull !FULL_IMAGE!
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] Failed to pull image from Docker Hub.
        pause
        exit /b 1
    )
    echo.
    echo [2/2] Running container on port 3000...
    docker run -d -p 3000:3000 --name node-compiler-app !FULL_IMAGE!
    echo.
    echo ===================================================
    echo   SUCCESS! Node.js Web IDE is running at:
    echo   http://localhost:3000
    echo ===================================================
    pause
    exit /b 0
)

echo.
echo [1/3] Pulling required base Docker images...
docker pull node:20-alpine
docker pull redis:7-alpine

echo.
echo [2/3] Building and starting complete production container stack...
docker compose up --build -d 2>nul || docker-compose up --build -d
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker Compose failed to start.
    pause
    exit /b 1
)

echo.
echo ===================================================
echo   SUCCESS! Complete Docker environment is running:
echo   • Web IDE & API Gateway: http://localhost:3000
echo   • Redis 7 Queue:         localhost:6379
echo   • Worker Pool:           Active (8 workers)
echo ===================================================
echo.
pause
