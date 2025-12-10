$ErrorActionPreference = "Stop"
Write-Host "[1/4] Checking Node.js and npm versions..." -ForegroundColor Cyan
node -v
npm -v

Write-Host "[2/4] Installing dependencies (npm ci)..." -ForegroundColor Cyan
npm ci

Write-Host "[3/4] Building TypeScript (npm run build)..." -ForegroundColor Cyan
npm run build

Write-Host "[4/4] Starting server for smoke test..." -ForegroundColor Cyan
$env:PORT = $env:PORT -ne $null -and $env:PORT -ne "" ? $env:PORT : 3001
$env:HOST = "0.0.0.0"
if (-not $env:MONGODB_URI) { $env:MONGODB_URI = "mongodb://localhost:27017/notes" }
if (-not $env:REDIS_URL) { $env:REDIS_URL = "redis://localhost:6379" }
if (-not $env:JWT_SECRET) { $env:JWT_SECRET = "dev_secret" }
if (-not $env:CLIENT_URL) { $env:CLIENT_URL = "http://localhost:3000" }

Write-Host "Starting: PORT=$($env:PORT) HOST=$($env:HOST)" -ForegroundColor Green
node dist/main.js
