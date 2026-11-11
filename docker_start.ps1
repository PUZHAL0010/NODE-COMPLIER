# Start Docker Server
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "   Starting Node.js Web IDE in Docker..." -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

docker pull node:20-alpine
docker pull redis:7-alpine

docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
    docker-compose up --build -d
}

Write-Host "`n==============================================" -ForegroundColor Green
Write-Host " STARTED SUCCESSFULLY!" -ForegroundColor Green
Write-Host " Open in browser: http://localhost:3000" -ForegroundColor White
Write-Host "==============================================" -ForegroundColor Green
