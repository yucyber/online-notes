$ErrorActionPreference = "Stop"
Write-Host "== Predeploy Check: Online Notes ==" -ForegroundColor Cyan

Push-Location "$PSScriptRoot/../notes-backend"
Write-Host "[Backend] npm ci & build" -ForegroundColor Cyan
npm ci
npm run build
Write-Host "[Backend] Local smoke start (Ctrl+C to stop)" -ForegroundColor Yellow
Write-Host "Tip: ensure MongoDB(27017) & Redis(6379) are available or set MONGODB_URI/REDIS_URL."
Write-Host "Example: $env:MONGODB_URI='mongodb://localhost:27017/notes'; $env:REDIS_URL='redis://localhost:6379'"
Pop-Location

Push-Location "$PSScriptRoot/../notes-frontend"
Write-Host "[Frontend] npm ci & type-check & build" -ForegroundColor Cyan
npm ci
npm run type-check
npm run build
Pop-Location

Write-Host "Predeploy check completed. If no errors above, you can deploy with confidence." -ForegroundColor Green
