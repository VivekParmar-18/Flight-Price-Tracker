# Flight Price Tracker - Windows PowerShell Launcher
$ErrorActionPreference = "Stop"

$env:DB_PATH = "data/flights.db"
$env:TZ = "America/Los_Angeles"
$env:POLL_INTERVAL_MINUTES = "480"

if (-not (Test-Path "data")) {
    New-Item -ItemType Directory -Path "data" | Out-Null
}

Write-Host "Starting Flight Price Tracker on http://localhost:7002..." -ForegroundColor Cyan
& .venv\Scripts\python.exe main.py
