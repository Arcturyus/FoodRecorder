$ErrorActionPreference = 'Stop'

$taskName = 'FoodRecorder Codex Background Worker'
$userId = "$env:USERDOMAIN\$env:USERNAME"
$runner = (Resolve-Path (Join-Path $PSScriptRoot 'run-background-worker.ps1')).Path
$webRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$powershell = Join-Path $PSHOME 'powershell.exe'
$arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  $existingArguments = ($existing.Actions | ForEach-Object { $_.Arguments }) -join ' '
  if ($existingArguments -notlike "*$runner*") {
    throw "La tâche « $taskName » existe déjà et ne pointe pas vers ce projet ; elle n’a pas été modifiée."
  }
}

$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $webRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -Hidden

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Lance le serveur local FoodRecorder à la connexion Windows pour traiter les dictées et photos avec le Codex CLI déjà connecté.' `
  -Force | Out-Null

$configPath = Join-Path $env:LOCALAPPDATA 'FoodRecorder\background-worker\config.json'
$configDir = Split-Path -Parent $configPath
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$config = [ordered]@{ enabled = $false; profileConfigured = $false }
if (Test-Path -LiteralPath $configPath) {
  try {
    $existingConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $config['enabled'] = $existingConfig.enabled -eq $true
    $config['profileConfigured'] = $existingConfig.profileConfigured -eq $true
  } catch {
    # A damaged state file should not prevent registering the startup task.
  }
}
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

Start-ScheduledTask -TaskName $taskName
Write-Output "Tâche installée et démarrée pour $userId."
