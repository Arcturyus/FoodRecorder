$ErrorActionPreference = 'Stop'

$webRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dataRoot = Join-Path $env:LOCALAPPDATA 'FoodRecorder\background-worker'
$logPath = Join-Path $dataRoot 'server.log'
$taskEndpoint = 'http://127.0.0.1:5173/api/background-worker'

New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null

# If a developer server is already listening, leave it alone. Otherwise this task
# owns the Vite process and keeps it alive for the duration of the Windows session.
try {
  Invoke-RestMethod -Uri $taskEndpoint -Method Get -TimeoutSec 2 | Out-Null
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) Existing FoodRecorder server found; no duplicate started."
  exit 0
} catch {
  # No matching local bridge is serving port 5173; start the managed server below.
}

$npm = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if (-not $npm) {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) npm.cmd was not found in PATH."
  exit 1
}

Set-Location -LiteralPath $webRoot
Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) Starting FoodRecorder Vite server."
& $npm.Source run dev -- --host 127.0.0.1 --strictPort *>> $logPath
exit $LASTEXITCODE
