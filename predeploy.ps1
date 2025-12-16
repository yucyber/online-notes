Param()
$ErrorActionPreference = 'Stop'

# Utilities
function Exec($cmd, $cwd) { if ($cwd) { Push-Location $cwd }; Write-Host "$cmd"; iex $cmd; if ($cwd) { Pop-Location } }
function WaitHttpStatus($url, $timeoutSec) {
  Write-Host "[hc] wait url=$url timeout=${timeoutSec}s"
  $start = Get-Date
  while ((New-TimeSpan -Start $start -End (Get-Date)).TotalSeconds -lt $timeoutSec) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      return [int]$r.StatusCode
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return 0
}
function GetBackendPort() {
  if ($env:PORT) { return [int]$env:PORT }
  $envFile = Join-Path 'notes-backend' '.env'
  if (Test-Path $envFile) {
    $m = Select-String -Path $envFile -Pattern '^PORT=(\d+)' | Select-Object -First 1
    if ($m) { return [int]($m.Matches[0].Groups[1].Value) }
  }
  return 3001
}
function FreePort($port) {
  try {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
      Write-Host "[hc] freeing port $port (PID=$($conn.OwningProcess))"
      Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  } catch {
    Write-Warning $_
  }
}
$nodev = (node -v) 2>$null; if (-not $nodev) { throw 'node not found' }
Exec 'npm ci' 'notes-backend'
if (Test-Path 'notes-backend/dist') { Remove-Item -Recurse -Force 'notes-backend/dist' }
Exec 'npm run build' 'notes-backend'
$wd = (Resolve-Path 'notes-backend').Path
$port = GetBackendPort
Write-Host "[hc] detected backend port=$port"
FreePort $port
$env:PORT = $port
$env:HOST = '0.0.0.0'
$env:CLIENT_URL = 'http://localhost:3000'
$p = Start-Process -FilePath 'powershell' -ArgumentList '-Command', 'npm start' -WorkingDirectory $wd -PassThru
Start-Sleep -Seconds 8
$sc = WaitHttpStatus "http://localhost:$port/api/health" 20
if ($sc -ne 200) {
  $sc = WaitHttpStatus "http://localhost:$port/api/dashboard/overview" 20
  if ($sc -eq 0) { $sc = 503 }
}
try { Stop-Process -Id $p.Id -Force } catch {}
if (@(200,401) -notcontains $sc) { throw "backend health check failed (port=$port, status=$sc)" }
Exec 'npm ci' 'notes-frontend'
Exec 'npm run build' 'notes-frontend'
Write-Host 'predeploy ok'
