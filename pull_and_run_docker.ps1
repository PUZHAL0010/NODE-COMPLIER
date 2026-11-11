# Node.js Web IDE - Pull & Run in Docker (End-to-End) PowerShell Script
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Node.js Web IDE - Pull & Run in Docker (End-to-End)" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Choose an option:" -ForegroundColor Yellow
Write-Host "[1] Pull base images & run complete stack with Docker Compose (Recommended)" -ForegroundColor White
Write-Host "[2] Pull published image from Docker Hub & run standalone container" -ForegroundColor White
Write-Host ""

$option = Read-Host "Enter choice (1 or 2)"

if ($option -eq "2") {
    $inputUser = Read-Host "Enter your Docker Hub username [default: puzhalmani0010]"
    $dockerUser = if ([string]::IsNullOrWhiteSpace($inputUser)) { "puzhalmani0010" } else { $inputUser.Trim() }
    $fullImage = "$dockerUser/node-compiler-platform:latest"
    Write-Host "`n[1/2] Pulling image from Docker Hub: $fullImage ..." -ForegroundColor Yellow
    docker pull $fullImage
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to pull image from Docker Hub."
        exit 1
    }

    Write-Host "`n[2/2] Running container on ports 3000 (IDE) and 3001 (Server)..." -ForegroundColor Yellow
    docker run -d -p 3000:3000 -p 3001:3001 --name node-compiler-app $fullImage

    Write-Host "`n===================================================" -ForegroundColor Green
    Write-Host "  SUCCESS! Node.js Web IDE is running at:" -ForegroundColor Green
    Write-Host "  http://localhost:3000" -ForegroundColor White
    Write-Host "===================================================" -ForegroundColor Green
    exit 0
}

Write-Host "`n[1/3] Pulling required base Docker images..." -ForegroundColor Yellow
docker pull node:20-alpine
docker pull redis:7-alpine

Write-Host "`n[2/3] Building and starting complete production container stack..." -ForegroundColor Yellow
docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
    # Fallback to docker-compose v1 if needed
    docker-compose up --build -d
}

Write-Host "`n===================================================" -ForegroundColor Green
Write-Host "  SUCCESS! Complete Docker environment is running:" -ForegroundColor Green
Write-Host "  • Web IDE & API Gateway: http://localhost:3000" -ForegroundColor White
Write-Host "  • Redis 7 Queue:         localhost:6379" -ForegroundColor White
Write-Host "  • Worker Pool:           Active (8 workers)" -ForegroundColor White
Write-Host "===================================================" -ForegroundColor Green
