# Changelog & LLM Context Log

This file records dated architectural decisions, features, bug fixes, and changes made to the **Flight Price Tracker** repository so future human developers and AI coding agents (Antigravity, Claude Code, OpenAI Codex, etc.) have full historical context.

> **Instruction for AI Agents:** Whenever you modify this repository, append a new dated section (`## YYYY-MM-DD — [Agent / Model Name] — Summary`) at the top of the log below documenting which agent/model made the changes, what changed, and why.

---

## 2026-10-31 — [Antigravity / Gemini 3.8 Flash] — Windows Environment Setup & Launcher Scripts

- **Agent / Tool:** Google Antigravity (`agy`)
- **Model:** Gemini 3.8 Flash

### Changes Made
1. **Full Potential Feature Suite:**
   - **Airport & Airline Autocomplete (`app/airports.py`, `GET /api/airports`, `GET /api/airlines`):** Added instant search for 7,800+ global airports and 1,000+ airlines with city alias mapping (e.g. typing "Toronto", "Ahmedabad", "Delhi", "London" instantly resolves and autocompletes the IATA code).
   - **Flight Details & Itinerary Modal (`flightDetailsModal`):** Added itinerary modal with full leg breakdown, operating airlines, flight numbers, departure/arrival times, durations, and layovers.
   - **Direct Google Flights Booking Links:** Added 1-click Google Flights direct search button on all date subcards and inside the flight details modal.
   - **Target Price Alerts (`routes.target_price`, `PATCH /api/routes/target-price`):** Added per-route target price threshold alerts with visual status badge (`🎯 Target Met: ₹...`).
   - **All-Time Low Deal Badges:** Added glowing `🔥 All-Time Low!` badge to cards when a flight price drops to or below its historical minimum.
   - **Multi-Channel Push Notifications (`app/pushover.py`):** Expanded notifications beyond Pushover to support **Discord Webhook** and **Telegram Bot** alerts.
   - **Price History CSV Export (`GET /api/export/csv`):** Added 1-click CSV download in the top navbar for offline tracking and spreadsheet analysis.
2. **Dynamic Currency Support & Fix:**
   - Fixed Google Flights search wrapper (`app/search.py`) to pass requested `currency` to `SearchFlights().search()` and return the actual retrieved currency rather than hardcoding `'USD'`.
   - Added selectable Currency setting (INR, USD, CAD, EUR, GBP, AUD) in Settings modal, persisted in SQLite `settings` table (`app/api.py`, `app/templates/index.html`).
   - Updated frontend (`app/static/js/app.js`) to dynamically format all prices, charts, combo banners, and Trip Builder using the appropriate currency symbol (`₹`, `$`, `CA$`, `€`, `£`, etc.).
   - Updated notifications in `app/scheduler.py` to use dynamic currency symbols and proper number formatting.
3. **Windows Local Setup & Scripts:**
   - Initialized Python 3.13 virtual environment (`.venv`) and installed all dependencies (`flask`, `apscheduler`, `flights`, `requests`, `gunicorn`, etc.).
   - Initialized local persistent SQLite database (`data/flights.db`).
   - Added `run_local.ps1` (PowerShell) and `run_local.bat` (Command Prompt) scripts for native Windows execution.
   - Added `.env.example` detailing configuration variables (`DB_PATH`, `TZ`, `POLL_INTERVAL_MINUTES`, `CURRENCY`, `PUSHOVER_TOKEN`, `PUSHOVER_USER`, `DISCORD_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).
4. **24/7 Cloud Deployment Configurations (Render & Railway):**
   - Configured `main.py` and `Dockerfile` to accept dynamic cloud `$PORT` routing.
   - Added `render.yaml` for 1-click Render deployment with persistent disk mounting (`/data`).
   - Added `railway.json` and `Procfile` for Railway container deployment.
   - Added `gunicorn` to `requirements.txt` for production WSGI serving with single-worker scheduler safety.

---

## 2026-10-17 — [Antigravity / Gemini 4 Argon (Medium)] — Renamed GitHub Repo to Flight-Price-Tracker & Added Agent Tracking Docs

- **Agent / Tool:** Google Antigravity (`agy`)
- **Model:** Gemini 4 Argon (Medium)

### Changes Made
1. **Repository Rename:**
   - Renamed the GitHub repository from `asaji/FP-tracker` to `asaji/Flight-Price-Tracker` (`https://github.com/asaji/Flight-Price-Tracker`) and updated the local `origin` remote URL.
   - Updated clone URLs and directory references in `README.md` and `UNRAID.md`.
2. **Standardized AI Agent & Change Tracking Documentation:**
   - Created `AGENTS.md` with full architecture, database schema (`trips`, `routes`, `price_history`, `settings`), REST API endpoints, route/trip mechanics, and agent housekeeping instructions.
   - Updated `CLAUDE.md` to point to `AGENTS.md` and `CHANGELOG.md` for unified cross-agent context.
   - Created `CHANGELOG.md` documenting today's changes and backfilling the full historical commit log of the project.

---

## 2026-06-22 — [Claude Code] — Fix Current Price Showing Blank When Latest Poll Found No Flights

- **Commit:** `afb86c3`

### Context & Changes Made
- `get_latest_price_for_routes` in `app/db.py` previously selected the row with `MAX(checked_at)` regardless of whether `price` was `NULL`. When the scheduler polled and found no available flights, it saved a `NULL` price entry, causing a blank price on the route card even when earlier non-null prices existed.
- Restricted the `MAX(checked_at)` subquery to rows `WHERE price IS NOT NULL` so route cards always display the most recent successfully fetched price.

---

## 2026-06-18 — [Claude Code] — Named Trips UI, Route Assignment Dropdown, Compact Cards & Unraid Setup Guide

- **Commits:** `745af15`, `ca9a08c`, `b3c8167`, `f3522bb`, `7a378a8`

### Changes Made
1. **Named Trips Frontend UI (`745af15`):**
   - Wired up frontend JS (`app/static/js/app.js`) for the `trips` table and `/api/named-trips` endpoints: trip chip filter bar with colored dots and inline editing, route grid filtering by selected trip, best-combo banner with budget tracking, color swatch picker, create/edit/delete trip modal workflow, and auto-assignment of the active trip when adding a new route.
2. **Trip Assignment Dropdown on Route Cards (`ca9a08c`):**
   - Added a tag button to each route card header opening a dropdown to assign or unassign a route group to any named trip (`PATCH /api/routes/assign-trip` and `assign_routes_to_trip` in `app/db.py`).
3. **Unraid Setup Guide (`b3c8167`):**
   - Added `UNRAID.md` with step-by-step instructions for Unraid deployment via Docker Compose Plus, environment configuration, updating, and troubleshooting.
4. **Compact Route Cards & Trip Filter Fixes (`f3522bb`, `7a378a8`):**
   - Compressed route card padding, chart height (`70px` → `48px`), and typography, and switched to `col-lg-6` for a 2-column layout at `992px`.
   - Fixed type coercion in trip filtering (`Number()`) and moved `#empty-state` outside `#routes-grid` so `grid.innerHTML = ''` does not remove it from the DOM and crash subsequent filter switches.

---

## 2026-05-02 — [Claude Code] — Per-Route Notification Toggle & Trip Filter Bar Styling

- **Commit:** `f6235a1`

### Changes Made
- Changed per-route notifications to opt-in (`notify = 0` by default) with a bell icon toggle on each leg group.
- Added `notify` column migration to `routes`, `PATCH /api/routes/notify` endpoint, and CSS styling for the trip filter bar.

---

## 2026-04-30 — [Claude Code] — Named Trips Backend with Budget Alerts & Tracked-Date Alert Filtering

- **Commit:** `b10b6f8`

### Changes Made
- Added `trips` table and `/api/named-trips` CRUD endpoints supporting optional trip budget caps and color tags.
- Added budget alert notifications when a named trip's best combination price drops under budget.
- Restricted Pushover price-change alerts to fire only for `day_offset = 0` routes (the primary chosen date).
- Added `run_local.sh` helper script for local macOS development.

---

## 2026-04-19 to 2026-04-24 — [Claude Code] — Initial Implementation, Date Flexibility, Trip Builder & Price Stats

- **Commits:** `f9fe1fd`, `f9f0501`, `f70a80f`, `4ed6934`

### Changes Made
1. **Initial Implementation (`f9fe1fd`):**
   - Built Flask + APScheduler + SQLite flight price tracker polling Google Flights via `fli`/`flights`, storing price history, plotting Chart.js line charts in a Bootstrap 5 dark-theme UI, and sending Pushover notifications on price changes. Containerized via Docker Compose on port `7002`.
2. **Date Flexibility, Trip Builder & Test Notification (`f9f0501`):**
   - Added automatic `-1 / 0 / +1` day tracking (`day_offset` column) for every added route leg so users can compare adjacent days.
   - Added sticky bottom Trip Builder bar to sum any checked combination of tracked flights.
   - Added `POST /api/notify/test` and `DELETE /api/routes/batch`, plus `README.md`.
3. **Trend Indicator, Price Stats & Stale Route Cleanup (`f70a80f`):**
   - Computed rising/falling/stable price trends from the last 5 checks and displayed all-time low, average, and high price statistics on each date sub-card.
   - Added `PAST` badges for routes past their departure date and one-click archiving (`POST /api/routes/archive-past`).
4. **Initial Project Context (`4ed6934`):**
   - Added initial `CLAUDE.md`.
