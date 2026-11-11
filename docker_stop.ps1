# Stop Docker Server
Write-Host "==============================================" -ForegroundColor Yellow
Write-Host "   Stopping Node.js Web IDE Docker Stack..." -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Yellow

docker compose down
if ($LASTEXITCODE -ne 0) {
    docker-compose down
}

Write-Host "`n==============================================" -ForegroundColor Green
Write-Host " STOPPED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
