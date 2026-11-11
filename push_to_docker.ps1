# Node.js Web IDE - Docker Build & Push PowerShell Script
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Node.js Web IDE - Docker Build & Push Helper" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

$inputUser = Read-Host "Enter your Docker Hub username [default: puzhalmani0010]"
$dockerUser = if ([string]::IsNullOrWhiteSpace($inputUser)) { "puzhalmani0010" } else { $inputUser.Trim() }

$imageName = "$dockerUser/node-compiler-platform"

Write-Host "`n[1/3] Logging in to Docker Hub..." -ForegroundColor Yellow
docker login
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker login failed. Please check your credentials."
    exit 1
}

Write-Host "`n[2/3] Building production Docker image: $imageName:latest ..." -ForegroundColor Yellow
docker build -t "$imageName:latest" -t "$imageName:v1.0.0" .
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker build failed."
    exit 1
}

Write-Host "`n[3/3] Pushing image to Docker Hub..." -ForegroundColor Yellow
docker push "$imageName:latest"
docker push "$imageName:v1.0.0"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker push failed."
    exit 1
}

Write-Host "`n===================================================" -ForegroundColor Green
Write-Host "  SUCCESS! Image successfully pushed to Docker Hub:" -ForegroundColor Green
Write-Host "  $imageName:latest" -ForegroundColor White
Write-Host ""
Write-Host "  To run on any machine / cloud server:" -ForegroundColor Cyan
Write-Host "  docker run -d -p 3000:3000 $imageName:latest" -ForegroundColor White
Write-Host "===================================================" -ForegroundColor Green
