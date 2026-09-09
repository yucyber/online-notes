param([switch]$CheckEnv)
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    if ($CheckEnv) { node scripts/check-production.mjs --env }
    else { node scripts/check-production.mjs }
    if ($LASTEXITCODE -ne 0) { throw 'Production configuration check failed' }
} finally { Pop-Location }
