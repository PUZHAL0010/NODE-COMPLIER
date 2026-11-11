@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo   Node.js Web IDE - Docker Build & Push Helper
echo ===================================================
echo.

set /p DOCKER_USER="Enter your Docker Hub username: "

if "%DOCKER_USER%"=="" (
    echo [ERROR] Docker Hub username cannot be empty.
    pause
    exit /b 1
)

set IMAGE_NAME=%DOCKER_USER%/node-compiler-platform

echo.
echo [1/3] Logging in to Docker Hub...
docker login
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker login failed. Please check credentials.
    pause
    exit /b 1
)

echo.
echo [2/3] Building production Docker image: %IMAGE_NAME%:latest ...
docker build -t %IMAGE_NAME%:latest -t %IMAGE_NAME%:v1.0.0 .
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker build failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Pushing image to Docker Hub...
docker push %IMAGE_NAME%:latest
docker push %IMAGE_NAME%:v1.0.0
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker push failed.
    pause
    exit /b 1
)

echo.
echo ===================================================
echo   SUCCESS! Image pushed to Docker Hub:
echo   %IMAGE_NAME%:latest
echo.
echo   To run anywhere:
echo   docker run -d -p 3000:3000 %IMAGE_NAME%:latest
echo ===================================================
pause
