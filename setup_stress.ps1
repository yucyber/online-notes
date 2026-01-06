$ErrorActionPreference = "Stop"
try {
    $body = @{ email = "stress_test_$(Get-Random)@test.com"; password = "password123" } | ConvertTo-Json -Compress
    $resp = Invoke-RestMethod -Uri "http://localhost:3001/api/auth/register" -Method Post -Body $body -ContentType "application/json"
    $token = $resp.data.token
    if (-not $token) {
        Write-Error "No token received"
    }
    Write-Host "Got token, running stress test..."
    $env:TOKEN = $token
    npx ts-node notes-backend/scripts/stress-notes.ts
}
catch {
    Write-Error $_
}