$ErrorActionPreference = 'Stop'

$webRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskEndpoint = 'http://127.0.0.1:5173/api/background-worker'

# If a developer server is already listening, leave it alone. Otherwise this task
# owns the visible Vite console and keeps it alive for the duration of the Windows session.
try {
  Invoke-RestMethod -Uri $taskEndpoint -Method Get -TimeoutSec 2 | Out-Null
  exit 0
} catch {
  # No matching local bridge is serving port 5173; start the managed server below.
}

$npm = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if (-not $npm) {
  throw 'npm.cmd was not found in PATH.'
}

Set-Location -LiteralPath $webRoot
Write-Host "Démarrage de FoodRecorder sur http://127.0.0.1:5173"
& $npm.Source run dev -- --host 127.0.0.1 --strictPort
exit $LASTEXITCODE
