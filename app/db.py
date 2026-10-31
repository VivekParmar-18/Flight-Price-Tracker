import sqlite3
import json
from collections import defaultdict
from datetime import datetime, timezone


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: str):
    with _connect(db_path) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS trips (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL,
                notes       TEXT,
                budget      REAL,
                color       TEXT    NOT NULL DEFAULT '#00cfe0',
                created_at  TEXT    NOT NULL,
                last_combo  REAL
            );

            CREATE TABLE IF NOT EXISTS routes (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                trip_id         INTEGER,
                named_trip_id   INTEGER REFERENCES trips(id),
                leg_label       TEXT    NOT NULL DEFAULT 'outbound',
                origin          TEXT    NOT NULL,
                destination     TEXT    NOT NULL,
                departure_date  TEXT    NOT NULL,
                non_stop_only   INTEGER NOT NULL DEFAULT 0,
                airlines        TEXT,
                adults          INTEGER NOT NULL DEFAULT 1,
                seat_type       TEXT    NOT NULL DEFAULT 'ECONOMY',
                active          INTEGER NOT NULL DEFAULT 1,
                created_at      TEXT    NOT NULL,
                day_offset      INTEGER NOT NULL DEFAULT 0,
                notify          INTEGER NOT NULL DEFAULT 0,
                target_price    REAL
            );

            CREATE TABLE IF NOT EXISTS price_history (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                route_id       INTEGER NOT NULL,
                price          REAL,
                currency       TEXT    NOT NULL DEFAULT 'USD',
                flight_details TEXT,
                checked_at     TEXT    NOT NULL,
                FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)
    _migrate(db_path)
    _seed_default_data(db_path)


def _seed_default_data(db_path: str):
    """
    Ensure the user's default trip and routes exist immediately after deployment,
    so even if deployed on a fresh container or without a persistent volume,
    the 'Karan' trip and YYZ <-> AMD routes are pre-populated automatically.
    """
    with _connect(db_path) as conn:
        route_count = conn.execute("SELECT COUNT(*) FROM routes").fetchone()[0]
        if route_count > 0:
            return  # Already populated

        # Check or create trip 'Karan'
        trip_row = conn.execute("SELECT id FROM trips WHERE name = ?", ("Karan",)).fetchone()
        if trip_row:
            trip_id = trip_row['id']
        else:
            cur = conn.execute(
                "INSERT INTO trips (name, notes, budget, color, created_at) VALUES (?, ?, ?, ?, ?)",
                ("Karan", "YYZ <-> AMD Trip", 100000.0, "#00cfe0", _now())
            )
            trip_id = cur.lastrowid

        # Insert Outbound YYZ -> AMD on 2027-01-10 (-1, 0, +1)
        # and Return AMD -> YYZ on 2027-02-13 (-1, 0, +1)
        legs = [
            ('outbound', 'YYZ', 'AMD', [('2027-01-09', -1), ('2027-01-10', 0), ('2027-01-11', 1)]),
            ('return', 'AMD', 'YYZ', [('2027-02-12', -1), ('2027-02-13', 0), ('2027-02-14', 1)]),
        ]
        trip_group_id = 1
        for leg_label, orig, dest, variants in legs:
            for date_str, offset in variants:
                conn.execute(
                    """INSERT INTO routes (
                        trip_id, named_trip_id, leg_label, origin, destination,
                        departure_date, non_stop_only, airlines, adults, seat_type,
                        active, created_at, day_offset, notify, target_price
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, 90000)""",
                    (trip_group_id, trip_id, leg_label, orig, dest, date_str, 0, None, 1, 'ECONOMY', _now(), offset)
                )

        # Set default settings: INR, 60 min poll
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('currency', 'INR')")
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('poll_interval_minutes', '60')")


def _migrate(db_path: str):
    with _connect(db_path) as conn:
        try:
            cols = {row['name'] for row in conn.execute("PRAGMA table_info(routes)").fetchall()}
            if 'day_offset' not in cols:
                conn.execute("ALTER TABLE routes ADD COLUMN day_offset INTEGER NOT NULL DEFAULT 0")
            if 'named_trip_id' not in cols:
                conn.execute("ALTER TABLE routes ADD COLUMN named_trip_id INTEGER REFERENCES trips(id)")
            if 'notify' not in cols:
                conn.execute("ALTER TABLE routes ADD COLUMN notify INTEGER NOT NULL DEFAULT 0")
            if 'target_price' not in cols:
                conn.execute("ALTER TABLE routes ADD COLUMN target_price REAL")
        except Exception:
            pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Routes ─────────────────────────────────────────────────────────────────

def get_active_routes(db_path: str) -> list[dict]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM routes WHERE active = 1 ORDER BY trip_id, leg_label, id"
        ).fetchall()
    return [dict(r) for r in rows]


def get_all_routes(db_path: str, include_archived: bool = False) -> list[dict]:
    where = "" if include_archived else "WHERE active = 1"
    with _connect(db_path) as conn:
        rows = conn.execute(
            f"SELECT * FROM routes {where} ORDER BY trip_id, leg_label, id"
        ).fetchall()
    return [dict(r) for r in rows]


def archive_past_routes(db_path: str) -> int:
    today = datetime.now().strftime('%Y-%m-%d')
    with _connect(db_path) as conn:
        cur = conn.execute(
            "UPDATE routes SET active = 0 WHERE departure_date < ? AND active = 1",
            (today,)
        )
    return cur.rowcount


def count_archived_routes(db_path: str) -> int:
    with _connect(db_path) as conn:
        row = conn.execute("SELECT COUNT(*) FROM routes WHERE active = 0").fetchone()
    return row[0]


def add_route(db_path: str, trip_id: int | None, leg_label: str, origin: str,
              destination: str, departure_date: str, non_stop_only: bool,
              airlines: list | None, adults: int, seat_type: str,
              day_offset: int = 0, named_trip_id: int | None = None) -> int:
    with _connect(db_path) as conn:
        cur = conn.execute(
            """INSERT INTO routes
               (trip_id, named_trip_id, leg_label, origin, destination, departure_date,
                non_stop_only, airlines, adults, seat_type, active, created_at, day_offset)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
            (trip_id, named_trip_id, leg_label, origin.upper(), destination.upper(),
             departure_date, int(non_stop_only),
             json.dumps(airlines) if airlines else None,
             adults, seat_type, _now(), day_offset)
        )
    return cur.lastrowid


def set_routes_notify(db_path: str, route_ids: list[int], notify: int):
    if not route_ids:
        return
    placeholders = ','.join('?' * len(route_ids))
    with _connect(db_path) as conn:
        conn.execute(
            f"UPDATE routes SET notify = ? WHERE id IN ({placeholders})",
            [notify] + list(route_ids)
        )


def set_routes_target_price(db_path: str, route_ids: list[int], target_price: float | None):
    if not route_ids:
        return
    _migrate(db_path)
    placeholders = ','.join('?' * len(route_ids))
    with _connect(db_path) as conn:
        conn.execute(
            f"UPDATE routes SET target_price = ? WHERE id IN ({placeholders})",
            [target_price] + list(route_ids)
        )


def assign_routes_to_trip(db_path: str, route_ids: list[int], named_trip_id: int | None):
    if not route_ids:
        return
    placeholders = ','.join('?' * len(route_ids))
    with _connect(db_path) as conn:
        conn.execute(
            f"UPDATE routes SET named_trip_id = ? WHERE id IN ({placeholders})",
            [named_trip_id] + list(route_ids)
        )


def delete_routes_batch(db_path: str, route_ids: list[int]):
    if not route_ids:
        return
    placeholders = ','.join('?' * len(route_ids))
    with _connect(db_path) as conn:
        conn.execute(f"DELETE FROM routes WHERE id IN ({placeholders})", route_ids)


def next_trip_id(db_path: str) -> int:
    with _connect(db_path) as conn:
        row = conn.execute("SELECT MAX(trip_id) FROM routes").fetchone()
    return (row[0] or 0) + 1


def delete_route(db_path: str, route_id: int):
    with _connect(db_path) as conn:
        conn.execute("DELETE FROM routes WHERE id = ?", (route_id,))


# ── Named Trips ─────────────────────────────────────────────────────────────

def create_named_trip(db_path: str, name: str, notes: str | None = None,
                      budget: float | None = None, color: str = '#00cfe0') -> int:
    with _connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO trips (name, notes, budget, color, created_at) VALUES (?, ?, ?, ?, ?)",
            (name.strip(), notes or None, budget, color, _now())
        )
    return cur.lastrowid


def get_named_trips(db_path: str) -> list[dict]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            """SELECT t.*, COUNT(r.id) AS route_count
               FROM trips t
               LEFT JOIN routes r ON r.named_trip_id = t.id AND r.active = 1
               GROUP BY t.id
               ORDER BY t.created_at ASC"""
        ).fetchall()
    return [dict(r) for r in rows]


def update_named_trip(db_path: str, trip_id: int, name: str,
                      notes: str | None, budget: float | None, color: str):
    with _connect(db_path) as conn:
        conn.execute(
            "UPDATE trips SET name=?, notes=?, budget=?, color=? WHERE id=?",
            (name.strip(), notes or None, budget, color, trip_id)
        )


def delete_named_trip(db_path: str, trip_id: int):
    with _connect(db_path) as conn:
        conn.execute("UPDATE routes SET named_trip_id = NULL WHERE named_trip_id = ?", (trip_id,))
        conn.execute("DELETE FROM trips WHERE id = ?", (trip_id,))


def update_trip_last_combo(db_path: str, trip_id: int, combo_total: float | None):
    with _connect(db_path) as conn:
        conn.execute("UPDATE trips SET last_combo = ? WHERE id = ?", (combo_total, trip_id))


def get_best_combo(db_path: str, named_trip_id: int) -> dict:
    """
    For each leg-group (trip_id) in this named trip, find the cheapest valid
    combination of date variants. For round-trips, outbound must precede return.
    Returns the overall best total and the specific route records chosen.
    """
    with _connect(db_path) as conn:
        rows = conn.execute(
            """SELECT r.id, r.trip_id, r.leg_label, r.origin, r.destination,
                      r.departure_date, r.day_offset,
                      (SELECT ph.price FROM price_history ph
                       WHERE ph.route_id = r.id AND ph.price IS NOT NULL
                       ORDER BY ph.checked_at DESC LIMIT 1) AS price
               FROM routes r
               WHERE r.named_trip_id = ? AND r.active = 1
               ORDER BY r.trip_id, r.leg_label, r.day_offset""",
            (named_trip_id,)
        ).fetchall()

    if not rows:
        return {'total': None, 'legs': [], 'has_prices': False}

    # Group by booking segment (trip_id), then by leg_label
    segments: dict[int, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        segments[r['trip_id']][r['leg_label']].append(dict(r))

    grand_total = 0.0
    best_legs: list[dict] = []
    has_prices = False

    for leg_groups in segments.values():
        labels = sorted(leg_groups.keys(), key=lambda l: (l != 'outbound', l))
        priced = [[v for v in leg_groups[lbl] if v['price'] is not None] for lbl in labels]

        best_total: float | None = None
        best_combo: list[dict] | None = None

        def _search(idx: int, chosen: list, running: float, last_date: str):
            nonlocal best_total, best_combo
            if idx == len(labels):
                if best_total is None or running < best_total:
                    best_total = running
                    best_combo = list(chosen)
                return
            for v in priced[idx]:
                if v['departure_date'] > last_date:
                    _search(idx + 1, chosen + [v], running + v['price'], v['departure_date'])

        _search(0, [], 0.0, '0000-00-00')

        if best_total is not None and best_combo is not None:
            grand_total += best_total
            best_legs.extend(best_combo)
            has_prices = True

    return {
        'total': round(grand_total, 2) if has_prices else None,
        'legs': best_legs,
        'has_prices': has_prices,
    }


# ── Price history ──────────────────────────────────────────────────────────

def save_price_history(db_path: str, route_id: int, price: float | None,
                       currency: str, flight_details: str | None):
    with _connect(db_path) as conn:
        conn.execute(
            """INSERT INTO price_history (route_id, price, currency, flight_details, checked_at)
               VALUES (?, ?, ?, ?, ?)""",
            (route_id, price, currency, flight_details, _now())
        )


def get_last_price(db_path: str, route_id: int) -> float | None:
    with _connect(db_path) as conn:
        row = conn.execute(
            """SELECT price FROM price_history
               WHERE route_id = ? AND price IS NOT NULL
               ORDER BY checked_at DESC LIMIT 1""",
            (route_id,)
        ).fetchone()
    return row['price'] if row else None


def get_price_history(db_path: str, route_id: int) -> list[dict]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            """SELECT price, currency, flight_details, checked_at
               FROM price_history
               WHERE route_id = ?
               ORDER BY checked_at ASC""",
            (route_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_latest_price_for_routes(db_path: str, route_ids: list[int]) -> dict[int, dict]:
    if not route_ids:
        return {}
    placeholders = ','.join('?' * len(route_ids))
    with _connect(db_path) as conn:
        rows = conn.execute(
            f"""SELECT ph.route_id, ph.price, ph.currency, ph.flight_details, ph.checked_at
                FROM price_history ph
                INNER JOIN (
                    SELECT route_id, MAX(checked_at) AS max_checked
                    FROM price_history
                    WHERE price IS NOT NULL
                    GROUP BY route_id
                ) latest ON ph.route_id = latest.route_id AND ph.checked_at = latest.max_checked
                WHERE ph.route_id IN ({placeholders})""",
            route_ids
        ).fetchall()
    return {r['route_id']: dict(r) for r in rows}


def get_previous_price_for_routes(db_path: str, route_ids: list[int]) -> dict[int, float | None]:
    if not route_ids:
        return {}
    result = {}
    with _connect(db_path) as conn:
        for rid in route_ids:
            rows = conn.execute(
                """SELECT price FROM price_history
                   WHERE route_id = ? AND price IS NOT NULL
                   ORDER BY checked_at DESC LIMIT 2""",
                (rid,)
            ).fetchall()
            result[rid] = rows[1]['price'] if len(rows) >= 2 else None
    return result


def get_price_stats_for_routes(db_path: str, route_ids: list[int]) -> dict[int, dict]:
    if not route_ids:
        return {}
    placeholders = ','.join('?' * len(route_ids))
    with _connect(db_path) as conn:
        stats_rows = conn.execute(
            f"""SELECT route_id,
                       MIN(price)          AS price_min,
                       MAX(price)          AS price_max,
                       ROUND(AVG(price),0) AS price_avg,
                       COUNT(price)        AS price_count
                FROM price_history
                WHERE route_id IN ({placeholders}) AND price IS NOT NULL
                GROUP BY route_id""",
            route_ids,
        ).fetchall()

        recent_rows = conn.execute(
            f"""SELECT route_id, price
                FROM price_history
                WHERE route_id IN ({placeholders}) AND price IS NOT NULL
                ORDER BY route_id, checked_at DESC""",
            route_ids,
        ).fetchall()

    stats = {r['route_id']: dict(r) for r in stats_rows}

    recent: dict[int, list[float]] = {}
    for row in recent_rows:
        rid = row['route_id']
        if rid not in recent:
            recent[rid] = []
        if len(recent[rid]) < 5:
            recent[rid].append(row['price'])

    result = {}
    for rid in route_ids:
        s = stats.get(rid, {})
        result[rid] = {
            'price_min':   s.get('price_min'),
            'price_max':   s.get('price_max'),
            'price_avg':   s.get('price_avg'),
            'price_count': s.get('price_count', 0),
            'trend':       _compute_trend(recent.get(rid, [])),
        }
    return result


def _compute_trend(prices: list[float]) -> str:
    if len(prices) < 3:
        return 'unknown'
    newest, oldest = prices[0], prices[-1]
    if oldest == 0:
        return 'unknown'
    pct = (newest - oldest) / oldest * 100
    if pct > 2:
        return 'rising'
    if pct < -2:
        return 'falling'
    return 'stable'


# ── Settings ───────────────────────────────────────────────────────────────

def get_setting(db_path: str, key: str, default: str) -> str:
    with _connect(db_path) as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row['value'] if row else default


def set_setting(db_path: str, key: str, value: str):
    with _connect(db_path) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value)
        )


def export_price_history_csv(db_path: str) -> str:
    import io, csv
    with _connect(db_path) as conn:
        rows = conn.execute("""
            SELECT r.origin, r.destination, r.departure_date, r.leg_label, r.seat_type,
                   ph.price, ph.currency, ph.checked_at, t.name AS trip_name
            FROM price_history ph
            JOIN routes r ON ph.route_id = r.id
            LEFT JOIN trips t ON r.named_trip_id = t.id
            ORDER BY ph.checked_at DESC
        """).fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Origin', 'Destination', 'Departure Date', 'Leg', 'Cabin', 'Price', 'Currency', 'Checked At', 'Trip'])
    for r in rows:
        writer.writerow([r['origin'], r['destination'], r['departure_date'], r['leg_label'], r['seat_type'], r['price'], r['currency'], r['checked_at'], r['trip_name'] or ''])
    return output.getvalue()
