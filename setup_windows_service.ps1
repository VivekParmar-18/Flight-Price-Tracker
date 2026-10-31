# Windows 24/7 Silent Background Service Installer for Flight Price Tracker
$TaskName = "FlightPriceTracker24x7"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe = Join-Path $ScriptDir ".venv\Scripts\pythonw.exe"
$MainPy = Join-Path $ScriptDir "main.py"

Write-Host "Setting up 24/7 background task for Flight Price Tracker..." -ForegroundColor Cyan

# Remove existing task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Create trigger: at user logon and system startup
$Trigger1 = New-ScheduledTaskTrigger -AtLogOn
$Trigger2 = New-ScheduledTaskTrigger -AtStartup

# Action: run pythonw.exe (completely silent, no command window)
$Action = New-ScheduledTaskAction -Execute $PythonExe -Argument "`"$MainPy`"" -WorkingDirectory $ScriptDir

# Settings: run perpetually, restart if failed
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($Trigger1, $Trigger2) -Settings $Settings -Description "Runs Flight Price Tracker perpetually in the background with 60-minute polling."

Write-Host "Starting task now..." -ForegroundColor Green
Start-ScheduledTask -TaskName $TaskName
Write-Host "Flight Price Tracker is now running 24/7 in the background!" -ForegroundColor Green
Write-Host "To stop or remove: Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false" -ForegroundColor Yellow
