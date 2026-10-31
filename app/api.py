import json
import os
import threading
from datetime import datetime, timedelta
from flask import Blueprint, current_app, jsonify, render_template, request, Response

from .db import (
    add_route, archive_past_routes, assign_routes_to_trip, count_archived_routes,
    create_named_trip, delete_named_trip, delete_route, delete_routes_batch,
    export_price_history_csv, get_all_routes, get_best_combo, get_latest_price_for_routes,
    get_named_trips, get_previous_price_for_routes,
    get_price_history, get_price_stats_for_routes,
    get_setting, next_trip_id, set_routes_notify, set_routes_target_price,
    set_setting, update_named_trip,
)
from .airports import search_airports, search_airlines
from .pushover import send_pushover
from .scheduler import check_all_routes, reschedule

import re
import logging

logger = logging.getLogger(__name__)

bp = Blueprint('api', __name__)

_TODAY = lambda: datetime.now().strftime('%Y-%m-%d')


def _db():
    return current_app.config['DB_PATH']


def _clean_iata(code_str: str) -> str:
    if not code_str:
        return ''
    s = str(code_str).strip().upper()
    match = re.search(r'\b([A-Z]{3})\b', s)
    if match:
        return match.group(1)
    return s[:3]


def _parse_date(date_str: str) -> datetime:
    if not date_str:
        raise ValueError("Date is required")
    s = str(date_str).strip()
    formats = [
        '%Y-%m-%d',
        '%d-%m-%Y',
        '%m-%d-%Y',
        '%d/%m/%Y',
        '%m/%d/%Y',
        '%Y/%m/%d',
    ]
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"Invalid date format '{s}'. Please use YYYY-MM-DD or DD-MM-YYYY.")


def _date_variants(date_str: str) -> list[tuple[str, int]]:
    base = _parse_date(date_str)
    return [
        ((base + timedelta(days=offset)).strftime('%Y-%m-%d'), offset)
        for offset in (-1, 0, 1)
    ]


# ── Pages ──────────────────────────────────────────────────────────────────

@bp.route('/')
def index():
    return render_template('index.html')


# ── Routes ─────────────────────────────────────────────────────────────────

@bp.route('/api/routes', methods=['GET'])
def list_routes():
    include_archived = request.args.get('include_archived', '0') == '1'
    routes = get_all_routes(_db(), include_archived=include_archived)
    ids = [r['id'] for r in routes]
    latest = get_latest_price_for_routes(_db(), ids)
    prev   = get_previous_price_for_routes(_db(), ids)
    stats  = get_price_stats_for_routes(_db(), ids)
    today  = _TODAY()
    app_currency = get_setting(_db(), 'currency', os.environ.get('CURRENCY', 'INR'))

    result = []
    for r in routes:
        rid = r['id']
        lp  = latest.get(rid)
        entry = dict(r)
        entry['airlines'] = json.loads(r['airlines']) if r['airlines'] else []
        entry['is_past']  = r['departure_date'] < today
        if lp:
            entry['current_price']  = lp['price']
            entry['currency']       = lp.get('currency') or app_currency
            entry['last_checked']   = lp['checked_at']
            entry['flight_details'] = json.loads(lp['flight_details']) if lp['flight_details'] else None
        else:
            entry['current_price']  = None
            entry['currency']       = app_currency
            entry['last_checked']   = None
            entry['flight_details'] = None
        entry['prev_price'] = prev.get(rid)
        s = stats.get(rid, {})
        entry['price_min']   = s.get('price_min')
        entry['price_max']   = s.get('price_max')
        entry['price_avg']   = s.get('price_avg')
        entry['price_count'] = s.get('price_count', 0)
        entry['trend']       = s.get('trend', 'unknown')
        result.append(entry)

    return jsonify(result)


@bp.route('/api/routes', methods=['POST'])
def create_routes():
    try:
        data = request.get_json(force=True)
        trip_type     = data.get('trip_type', 'one_way')
        adults        = int(data.get('adults', 1))
        seat_type     = data.get('seat_type', 'ECONOMY').upper()
        non_stop      = bool(data.get('non_stop_only', False))
        airlines      = [a.strip().upper() for a in data.get('airlines', []) if a.strip()] or None
        raw_trip      = data.get('named_trip_id')
        named_trip_id = None
        if raw_trip is not None and str(raw_trip).strip():
            raw_trip_str = str(raw_trip).strip()
            if raw_trip_str.isdigit():
                named_trip_id = int(raw_trip_str)
            else:
                from .db import get_named_trips, create_named_trip
                existing = get_named_trips(_db())
                matched = next((t for t in existing if t['name'].lower() == raw_trip_str.lower()), None)
                if matched:
                    named_trip_id = matched['id']
                else:
                    named_trip_id = create_named_trip(_db(), raw_trip_str, None, None, '#6366f1')

        created = []
        tid = next_trip_id(_db())

        legs = [('outbound', data.get('outbound', data))]
        if trip_type == 'round_trip' and data.get('return'):
            legs.append(('return', data['return']))

        for leg_label, seg in legs:
            origin = _clean_iata(seg.get('origin', ''))
            destination = _clean_iata(seg.get('destination', ''))
            if len(origin) != 3 or len(destination) != 3:
                return jsonify({'error': f"Origin '{origin}' and destination '{destination}' must be valid 3-letter airport codes (e.g. YYZ, AMD)."}), 400
            for date_str, offset in _date_variants(seg['departure_date']):
                rid = add_route(
                    _db(), tid, leg_label,
                    origin, destination, date_str,
                    non_stop, airlines, adults, seat_type, offset,
                    named_trip_id=named_trip_id,
                )
                created.append(rid)

        return jsonify({'created': created, 'named_trip_id': named_trip_id}), 201
    except Exception as e:
        logger.exception("Error creating route: %s", e)
        return jsonify({'error': str(e)}), 400


@bp.route('/api/routes/<int:route_id>', methods=['DELETE'])
def remove_route(route_id: int):
    delete_route(_db(), route_id)
    return jsonify({'deleted': route_id})


@bp.route('/api/routes/notify', methods=['PATCH'])
def set_notify():
    data = request.get_json(force=True)
    ids = [int(i) for i in data.get('ids', [])]
    notify = 1 if data.get('notify') else 0
    set_routes_notify(_db(), ids, notify)
    return jsonify({'ok': True, 'notify': notify})


@bp.route('/api/routes/target-price', methods=['PATCH'])
def set_target_price():
    data = request.get_json(force=True)
    ids = [int(i) for i in data.get('ids', [])]
    target_price = data.get('target_price')
    if target_price is not None and str(target_price).strip() != '':
        target_price = float(target_price)
    else:
        target_price = None
    set_routes_target_price(_db(), ids, target_price)
    return jsonify({'ok': True, 'target_price': target_price})


@bp.route('/api/routes/batch', methods=['DELETE'])
def remove_routes_batch():
    data = request.get_json(force=True)
    ids = [int(i) for i in data.get('ids', [])]
    delete_routes_batch(_db(), ids)
    return jsonify({'deleted': ids})


@bp.route('/api/routes/assign-trip', methods=['PATCH'])
def assign_trip():
    data = request.get_json(force=True)
    ids = [int(i) for i in data.get('ids', [])]
    named_trip_id = data.get('named_trip_id')
    if named_trip_id is not None:
        named_trip_id = int(named_trip_id)
    assign_routes_to_trip(_db(), ids, named_trip_id)
    return jsonify({'ok': True})


@bp.route('/api/routes/archive-past', methods=['POST'])
def archive_past():
    count = archive_past_routes(_db())
    return jsonify({'archived': count})


@bp.route('/api/routes/archived-count', methods=['GET'])
def archived_count():
    return jsonify({'count': count_archived_routes(_db())})


# ── Price history ──────────────────────────────────────────────────────────

@bp.route('/api/routes/<int:route_id>/history', methods=['GET'])
def route_history(route_id: int):
    history = get_price_history(_db(), route_id)
    for h in history:
        h['flight_details'] = json.loads(h['flight_details']) if h['flight_details'] else None
    return jsonify(history)


# ── Named Trips ────────────────────────────────────────────────────────────

@bp.route('/api/named-trips', methods=['GET'])
def list_named_trips():
    trips = get_named_trips(_db())
    result = []
    for t in trips:
        entry = dict(t)
        combo = get_best_combo(_db(), t['id'])
        entry['best_combo'] = combo
        if t['budget'] and combo['has_prices']:
            entry['budget_remaining'] = round(t['budget'] - combo['total'], 2)
        else:
            entry['budget_remaining'] = None
        result.append(entry)
    return jsonify(result)


@bp.route('/api/named-trips', methods=['POST'])
def create_trip():
    data = request.get_json(force=True)
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    budget = data.get('budget')
    if budget is not None:
        budget = float(budget)
    trip_id = create_named_trip(
        _db(), name,
        notes=data.get('notes') or None,
        budget=budget,
        color=data.get('color', '#00cfe0'),
    )
    return jsonify({'id': trip_id}), 201


@bp.route('/api/named-trips/<int:trip_id>', methods=['PUT'])
def update_trip(trip_id: int):
    data = request.get_json(force=True)
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    budget = data.get('budget')
    if budget is not None:
        budget = float(budget)
    update_named_trip(
        _db(), trip_id, name,
        notes=data.get('notes') or None,
        budget=budget,
        color=data.get('color', '#00cfe0'),
    )
    return jsonify({'ok': True})


@bp.route('/api/named-trips/<int:trip_id>', methods=['DELETE'])
def remove_trip(trip_id: int):
    delete_named_trip(_db(), trip_id)
    return jsonify({'ok': True})


@bp.route('/api/named-trips/<int:trip_id>/combo', methods=['GET'])
def trip_combo(trip_id: int):
    combo = get_best_combo(_db(), trip_id)
    combo['currency'] = get_setting(_db(), 'currency', os.environ.get('CURRENCY', 'INR'))
    return jsonify(combo)


# ── Manual poll ────────────────────────────────────────────────────────────

@bp.route('/api/poll', methods=['POST'])
def manual_poll():
    db = _db()
    threading.Thread(target=check_all_routes, args=(db,), daemon=True).start()
    return jsonify({'status': 'started'})


@bp.route('/api/debug/test-search', methods=['GET'])
def debug_test_search():
    import traceback
    from .search import search_route
    origin = request.args.get('origin', 'YYZ').upper().strip()
    destination = request.args.get('destination', 'AMD').upper().strip()
    date = request.args.get('date', '2027-01-10').strip()
    currency = request.args.get('currency', 'INR').upper().strip()
    proxy = os.environ.get('PROXY_URL') or os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
    masked_proxy = (proxy.split('@')[-1] if '@' in proxy else proxy) if proxy else None
    try:
        res = search_route(origin=origin, destination=destination, departure_date=date, currency=currency)
        return jsonify({
            'ok': True,
            'proxy_configured': masked_proxy,
            'params': {'origin': origin, 'destination': destination, 'date': date, 'currency': currency},
            'result': res,
        })
    except Exception as e:
        return jsonify({'ok': False, 'proxy_configured': masked_proxy, 'error': str(e), 'traceback': traceback.format_exc()}), 500


# ── Airports & Airlines Search ─────────────────────────────────────────────

@bp.route('/api/airports', methods=['GET'])
def get_airports():
    q = request.args.get('q', '').strip()
    return jsonify(search_airports(q))


@bp.route('/api/airlines', methods=['GET'])
def get_airlines():
    q = request.args.get('q', '').strip()
    return jsonify(search_airlines(q))


# ── CSV Export ─────────────────────────────────────────────────────────────

@bp.route('/api/export/csv', methods=['GET'])
def export_csv():
    csv_data = export_price_history_csv(_db())
    return Response(
        csv_data,
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment; filename=flight_price_history.csv'}
    )


# ── Notifications ──────────────────────────────────────────────────────────

@bp.route('/api/notify/test', methods=['POST'])
def test_notification():
    ok = send_pushover(
        'Your Flight Price Tracker notifications are working correctly.',
        title='✈ Test Notification',
        db_path=_db()
    )
    if ok:
        return jsonify({'status': 'sent'})
    return jsonify({'status': 'error', 'detail': 'No notification channels succeeded. Configure Pushover, Discord Webhook, or Telegram in Settings.'}), 400


# ── Settings ───────────────────────────────────────────────────────────────

@bp.route('/api/settings', methods=['GET'])
def get_settings():
    db = _db()
    interval = int(get_setting(db, 'poll_interval_minutes', '480'))
    currency = get_setting(db, 'currency', os.environ.get('CURRENCY', 'INR'))
    pushover_token = get_setting(db, 'pushover_token', os.environ.get('PUSHOVER_TOKEN', ''))
    pushover_user = get_setting(db, 'pushover_user', os.environ.get('PUSHOVER_USER', ''))
    discord_webhook = get_setting(db, 'discord_webhook_url', os.environ.get('DISCORD_WEBHOOK_URL', ''))
    telegram_bot = get_setting(db, 'telegram_bot_token', os.environ.get('TELEGRAM_BOT_TOKEN', ''))
    telegram_chat = get_setting(db, 'telegram_chat_id', os.environ.get('TELEGRAM_CHAT_ID', ''))
    return jsonify({
        'poll_interval_minutes': interval,
        'currency': currency,
        'pushover_token': pushover_token,
        'pushover_user': pushover_user,
        'discord_webhook_url': discord_webhook,
        'telegram_bot_token': telegram_bot,
        'telegram_chat_id': telegram_chat,
    })


@bp.route('/api/settings', methods=['POST'])
def update_settings():
    data = request.get_json(force=True)
    db = _db()
    interval = int(data.get('poll_interval_minutes', 480))
    interval = max(15, min(interval, 10080))
    set_setting(db, 'poll_interval_minutes', str(interval))
    reschedule(db, interval)

    currency = data.get('currency')
    if currency:
        currency = str(currency).upper().strip()
        set_setting(db, 'currency', currency)
    else:
        currency = get_setting(db, 'currency', os.environ.get('CURRENCY', 'INR'))

    for k in ['pushover_token', 'pushover_user', 'discord_webhook_url', 'telegram_bot_token', 'telegram_chat_id']:
        if k in data:
            set_setting(db, k, str(data[k]).strip())

    return jsonify({'poll_interval_minutes': interval, 'currency': currency, 'ok': True})
