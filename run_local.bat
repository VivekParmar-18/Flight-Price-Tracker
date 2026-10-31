@echo off
setlocal
set DB_PATH=data\flights.db
set TZ=America/Los_Angeles
set POLL_INTERVAL_MINUTES=480

if not exist "data" mkdir data

echo Starting Flight Price Tracker on http://localhost:7002...
.venv\Scripts\python.exe main.py
endlocal
