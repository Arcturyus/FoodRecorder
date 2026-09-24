$ErrorActionPreference = 'Stop'

$taskName = 'FoodRecorder Codex Background Worker'
$runner = (Resolve-Path (Join-Path $PSScriptRoot 'run-background-worker.ps1')).Path
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if (-not $existing) {
  Write-Output 'Aucune tâche FoodRecorder à retirer.'
  exit 0
}

$existingArguments = ($existing.Actions | ForEach-Object { $_.Arguments }) -join ' '
if ($existingArguments -notlike "*$runner*") {
  throw "La tâche « $taskName » ne pointe pas vers ce projet ; elle n’a pas été supprimée."
}

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Output 'Tâche FoodRecorder retirée.'
