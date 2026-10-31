'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let routes = [];
const miniCharts = {};
let expandedChart = null;
let showArchived = false;

let namedTrips = [];
let selectedNamedTripId = null;
let _tripFromRouteModal = false;

// trip builder: map of route_id -> {label, price}
const tripSelection = new Map();

const CURRENCY_SYMBOLS = {
  USD: '$',
  INR: '₹',
  EUR: '€',
  GBP: '£',
  CAD: 'CA$',
  AUD: 'A$',
  JPY: '¥',
};
let appCurrency = 'INR';

function getCurrencySymbol(curr = appCurrency) {
  return CURRENCY_SYMBOLS[curr] || (curr ? curr + ' ' : '₹');
}

function formatMoney(amount, curr = appCurrency) {
  if (amount == null) return '—';
  const sym = getCurrencySymbol(curr);
  return `${sym}${Math.round(amount).toLocaleString()}`;
}

function formatMinutes(mins) {
  if (!mins) return 'n/a';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(dtStr) {
  if (!dtStr) return '—';
  try {
    const d = new Date(dtStr);
    return isNaN(d.getTime()) ? dtStr : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return dtStr;
  }
}

function getMinutesDiff(startStr, endStr) {
  if (!startStr || !endStr) return 0;
  try {
    const s = new Date(startStr);
    const e = new Date(endStr);
    return Math.max(0, Math.round((e - s) / 60000));
  } catch {
    return 0;
  }
}

function getGoogleFlightsUrl(origin, destination, date, returnDate = null, seat = 'ECONOMY', nonStop = false) {
  const nonStopParam = nonStop ? '%20nonstop' : '';
  if (returnDate) {
    return `https://www.google.com/travel/flights?q=Flights%20from%20${origin}%20to%20${destination}%20departing%20${date}%20returning%20${returnDate}${nonStopParam}`;
  }
  return `https://www.google.com/travel/flights?q=Flights%20to%20${destination}%20from%20${origin}%20on%20${date}%20one-way${nonStopParam}`;
}

// ── Airport Autocomplete ───────────────────────────────────────────────────
let airportDebounce = null;
async function handleAirportInput(input, listId) {
  const listEl = document.getElementById(listId);
  const q = input.value.trim();
  if (q.length < 2) {
    listEl.classList.add('d-none');
    listEl.innerHTML = '';
    return;
  }
  clearTimeout(airportDebounce);
  airportDebounce = setTimeout(async () => {
    try {
      const res = await fetch(`/api/airports?q=${encodeURIComponent(q)}`);
      const airports = await res.json();
      if (!airports.length) {
        listEl.classList.add('d-none');
        return;
      }
      listEl.innerHTML = airports.map(a => `
        <div class="airport-item" onclick="selectAirport('${input.id}', '${listId}', '${a.code}')">
          <span class="airport-code-badge">${a.code}</span>
          <div class="airport-info">
            <div class="airport-name">${a.name}</div>
            ${a.city ? `<div class="airport-city">${a.city}</div>` : ''}
          </div>
        </div>
      `).join('');
      listEl.classList.remove('d-none');
    } catch (e) {
      console.error('Airport search error:', e);
    }
  }, 200);
}

function selectAirport(inputId, listId, code) {
  const input = document.getElementById(inputId);
  if (input) input.value = code;
  const list = document.getElementById(listId);
  if (list) {
    list.classList.add('d-none');
    list.innerHTML = '';
  }
  autoFillReturn();
}

document.addEventListener('click', e => {
  if (!e.target.closest('.position-relative')) {
    document.querySelectorAll('.airport-autocomplete-dropdown').forEach(d => d.classList.add('d-none'));
  }
});

const TRIP_COLORS = [
  '#00cfe0', '#00e09a', '#f0b22a', '#ff4f4f',
  '#a78bfa', '#fb923c', '#38bdf8', '#f472b6',
];

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadRoutes();
  loadSettings();
  loadNamedTrips();

  document.querySelectorAll('input[name="tripType"]').forEach(radio => {
    radio.addEventListener('change', e => {
      const isRound = e.target.value === 'round_trip';
      document.getElementById('return-segment').classList.toggle('d-none', !isRound);
      document.getElementById('outbound-label').textContent = isRound ? 'Outbound' : 'Flight';
      if (isRound) autoFillReturn();
    });
  });

  document.getElementById('out-origin').addEventListener('input', autoFillReturn);
  document.getElementById('out-dest').addEventListener('input', autoFillReturn);
});

function autoFillReturn() {
  if (document.getElementById('typeRoundTrip').checked) {
    document.getElementById('ret-origin').value = document.getElementById('out-dest').value;
    document.getElementById('ret-dest').value   = document.getElementById('out-origin').value;
  }
}

// ── Named trips ────────────────────────────────────────────────────────────
async function loadNamedTrips() {
  try {
    const res = await fetch('/api/named-trips');
    namedTrips = await res.json();
    renderTripChips();
    populateTripDropdown();
  } catch (e) {
    console.error('Failed to load named trips:', e);
  }
}

function renderTripChips() {
  const container = document.getElementById('trip-chips');
  container.innerHTML = '';
  for (const t of namedTrips) {
    const chip = document.createElement('button');
    chip.className = `trip-chip${selectedNamedTripId === t.id ? ' active' : ''}`;
    chip.innerHTML = `
      <span class="trip-chip-dot" style="background:${t.color}"></span>
      ${t.name}
      ${t.route_count > 0 ? `<span class="trip-chip-count">${t.route_count}</span>` : ''}
      <span class="trip-chip-edit" onclick="event.stopPropagation();openEditTripModal(${t.id})">
        <i class="bi bi-pencil-fill"></i>
      </span>`;
    chip.onclick = () => selectTrip(t.id);
    container.appendChild(chip);
  }
  document.getElementById('chip-all').classList.toggle('active', selectedNamedTripId === null);
}

function populateTripDropdown() {
  const select = document.getElementById('opt-trip');
  const currentVal = select.value;
  select.innerHTML = '<option value="">— No trip —</option>';
  for (const t of namedTrips) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    select.appendChild(opt);
  }
  if (currentVal && namedTrips.some(t => String(t.id) === currentVal)) {
    select.value = currentVal;
  }
}

function selectTrip(id) {
  selectedNamedTripId = id;
  renderTripChips();
  applyTripFilter();
}

function applyTripFilter() {
  if (selectedNamedTripId === null) {
    renderRoutes(routes, null);
    document.getElementById('combo-banner').classList.add('d-none');
    return;
  }
  const filtered = routes.filter(r => Number(r.named_trip_id) === selectedNamedTripId);
  renderRoutes(filtered, selectedNamedTripId);
  renderComboBanner(selectedNamedTripId);
}

async function renderComboBanner(tripId) {
  try {
    const res   = await fetch(`/api/named-trips/${tripId}/combo`);
    const combo = await res.json();
    const banner = document.getElementById('combo-banner');

    if (!combo.has_prices) {
      banner.classList.add('d-none');
      return;
    }

    const curr = combo.currency || appCurrency;
    document.getElementById('combo-legs').innerHTML = combo.legs
      .map(l => `<span class="combo-leg">${l.origin}→${l.destination} <strong>${formatMoney(l.price, curr)}</strong><span class="combo-leg-date">${l.departure_date}</span></span>`)
      .join('');
    document.getElementById('combo-total').textContent = formatMoney(combo.total, curr);

    const trip    = namedTrips.find(t => t.id === tripId);
    const budgetEl = document.getElementById('combo-budget-row');
    if (trip?.budget) {
      const remaining = trip.budget - combo.total;
      const color = remaining >= 0 ? 'var(--c-green)' : 'var(--c-red)';
      budgetEl.innerHTML = `Budget ${formatMoney(trip.budget, curr)} · <span style="color:${color}">${remaining < 0 ? '−' : ''}${formatMoney(Math.abs(remaining), curr)} ${remaining >= 0 ? 'under budget' : 'over budget'}</span>`;
      budgetEl.classList.remove('d-none');
    } else {
      budgetEl.classList.add('d-none');
    }

    banner.classList.remove('d-none');
  } catch (e) {
    console.error('Combo banner error:', e);
  }
}

function buildColorSwatches(selectedColor) {
  const container = document.getElementById('trip-color-swatches');
  container.innerHTML = '';
  for (const color of TRIP_COLORS) {
    const swatch = document.createElement('div');
    swatch.className = `color-swatch${color === selectedColor ? ' selected' : ''}`;
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.onclick = () => {
      container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    };
    container.appendChild(swatch);
  }
}

function openTripModal() {
  _tripFromRouteModal = false;
  document.getElementById('trip-modal-title').innerHTML = '<i class="bi bi-map me-2"></i>New Trip';
  document.getElementById('trip-edit-id').value = '';
  document.getElementById('trip-name').value = '';
  document.getElementById('trip-budget').value = '';
  document.getElementById('trip-notes').value = '';
  document.getElementById('trip-delete-btn').style.display = 'none';
  document.getElementById('trip-error').classList.add('d-none');
  buildColorSwatches(TRIP_COLORS[0]);
  new bootstrap.Modal(document.getElementById('tripModal')).show();
}

function openTripModalFromRoute() {
  _tripFromRouteModal = true;
  openTripModal();
}

function openEditTripModal(tripId) {
  const trip = namedTrips.find(t => t.id === tripId);
  if (!trip) return;
  _tripFromRouteModal = false;
  document.getElementById('trip-modal-title').innerHTML = '<i class="bi bi-pencil me-2"></i>Edit Trip';
  document.getElementById('trip-edit-id').value = tripId;
  document.getElementById('trip-name').value = trip.name;
  document.getElementById('trip-budget').value = trip.budget ?? '';
  document.getElementById('trip-notes').value = trip.notes ?? '';
  document.getElementById('trip-delete-btn').style.display = '';
  document.getElementById('trip-error').classList.add('d-none');
  buildColorSwatches(trip.color || TRIP_COLORS[0]);
  new bootstrap.Modal(document.getElementById('tripModal')).show();
}

async function saveTrip() {
  const errEl = document.getElementById('trip-error');
  errEl.classList.add('d-none');
  const name = document.getElementById('trip-name').value.trim();
  if (!name) {
    errEl.textContent = 'Trip name is required.';
    errEl.classList.remove('d-none');
    return;
  }
  const editId = document.getElementById('trip-edit-id').value;
  const budget = document.getElementById('trip-budget').value;
  const notes  = document.getElementById('trip-notes').value.trim();
  const swatch = document.querySelector('#trip-color-swatches .color-swatch.selected');
  const color  = swatch?.dataset.color || TRIP_COLORS[0];

  const body = { name, budget: budget ? parseFloat(budget) : null, notes: notes || null, color };
  try {
    let tripId;
    if (editId) {
      await fetch(`/api/named-trips/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      tripId = parseInt(editId);
    } else {
      const res  = await fetch('/api/named-trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      tripId = data.id;
    }
    bootstrap.Modal.getInstance(document.getElementById('tripModal')).hide();
    await loadNamedTrips();
    if (_tripFromRouteModal) {
      document.getElementById('opt-trip').value = tripId;
      _tripFromRouteModal = false;
    }
  } catch (e) {
    errEl.textContent = 'Failed to save trip. Please try again.';
    errEl.classList.remove('d-none');
  }
}

async function confirmDeleteTrip() {
  const editId = parseInt(document.getElementById('trip-edit-id').value);
  if (!editId) return;
  const trip = namedTrips.find(t => t.id === editId);
  if (!confirm(`Delete "${trip?.name || 'this trip'}"? Routes will stay but become unassigned.`)) return;
  try {
    await fetch(`/api/named-trips/${editId}`, { method: 'DELETE' });
    bootstrap.Modal.getInstance(document.getElementById('tripModal')).hide();
    if (selectedNamedTripId === editId) {
      selectedNamedTripId = null;
      document.getElementById('combo-banner').classList.add('d-none');
    }
    await loadNamedTrips();
    await loadRoutes();
  } catch (e) {
    alert('Failed to delete trip.');
  }
}

// ── Load & render routes ───────────────────────────────────────────────────
async function loadRoutes() {
  try {
    const url = showArchived ? '/api/routes?include_archived=1' : '/api/routes';
    const res  = await fetch(url);
    routes = await res.json();
    updateLastChecked(routes);
    updatePastAlert(routes);
    applyTripFilter();
  } catch (e) {
    console.error('Failed to load routes:', e);
  }
}

function updateLastChecked(routes) {
  const timestamps = routes.map(r => r.last_checked).filter(Boolean).sort().reverse();
  const el = document.getElementById('last-checked-text');
  if (timestamps.length) {
    el.textContent = `Last checked ${timeAgo(timestamps[0])}`;
    el.classList.remove('d-none');
  }
}

function updatePastAlert(routes) {
  const today = new Date().toISOString().slice(0, 10);
  const pastActive = routes.filter(r => r.active !== 0 && r.departure_date < today);
  const alertEl    = document.getElementById('past-alert');
  const textEl     = document.getElementById('past-alert-text');
  const toggleBtn  = document.getElementById('btn-show-archived');

  if (pastActive.length > 0) {
    const routeWord = pastActive.length === 1 ? 'route has' : 'routes have';
    textEl.textContent = `${pastActive.length} tracked ${routeWord} passed their departure date.`;
    alertEl.classList.remove('d-none');
  } else {
    alertEl.classList.add('d-none');
  }

  fetch('/api/routes/archived-count')
    .then(r => r.json())
    .then(data => {
      if (data.count > 0) {
        toggleBtn.textContent = showArchived
          ? `Hide archived (${data.count})`
          : `Show archived (${data.count})`;
        toggleBtn.classList.remove('d-none');
        if (!showArchived && pastActive.length === 0) {
          alertEl.classList.remove('d-none');
          textEl.textContent = '';
        }
      } else {
        toggleBtn.classList.add('d-none');
      }
    })
    .catch(() => {});
}

async function archivePast() {
  try {
    const res  = await fetch('/api/routes/archive-past', { method: 'POST' });
    const data = await res.json();
    if (data.archived > 0) {
      await loadRoutes();
    }
  } catch (e) {
    alert('Failed to archive past routes.');
  }
}

function toggleArchived() {
  showArchived = !showArchived;
  loadRoutes();
}

// ── Grouping ───────────────────────────────────────────────────────────────
function buildTripGroups(routes) {
  const byTrip = new Map();

  for (const r of routes) {
    const tid = r.trip_id ?? `solo_${r.id}`;
    if (!byTrip.has(tid)) byTrip.set(tid, new Map());
    const legMap = byTrip.get(tid);
    if (!legMap.has(r.leg_label)) legMap.set(r.leg_label, []);
    legMap.get(r.leg_label).push(r);
  }

  const tripGroups = [];
  for (const [, legMap] of byTrip) {
    const legs = [];
    for (const [leg_label, dateRoutes] of legMap) {
      dateRoutes.sort((a, b) => a.day_offset - b.day_offset);
      const ref = dateRoutes[0];
      legs.push({
        leg_label,
        origin:        ref.origin,
        destination:   ref.destination,
        seat_type:     ref.seat_type,
        non_stop_only: ref.non_stop_only,
        airlines:      ref.airlines,
        adults:        ref.adults,
        named_trip_id: ref.named_trip_id,
        dates:         dateRoutes,
        ids:           dateRoutes.map(r => r.id),
        is_archived:   dateRoutes.every(r => r.active === 0),
      });
    }
    legs.sort((a, b) => a.leg_label === 'outbound' ? -1 : 1);
    tripGroups.push({ legs, isRoundTrip: legs.length > 1 });
  }

  return tripGroups;
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderRoutes(routes, activeTripId = null) {
  const grid  = document.getElementById('routes-grid');
  const empty = document.getElementById('empty-state');

  Object.values(miniCharts).forEach(c => c.destroy());
  Object.keys(miniCharts).forEach(k => delete miniCharts[k]);

  if (!routes.length) {
    if (activeTripId) {
      const trip = namedTrips.find(t => t.id === activeTripId);
      empty.querySelector('.fp-empty-title').textContent = `No routes in "${trip?.name || 'this trip'}"`;
      empty.querySelector('.fp-empty-sub').textContent   = 'Use the tag button on any route card to assign it to this trip.';
    } else {
      empty.querySelector('.fp-empty-title').textContent = 'No routes tracked';
      empty.querySelector('.fp-empty-sub').textContent   = 'Add a flight route to start monitoring prices';
    }
    grid.innerHTML = '';
    empty.classList.remove('d-none');
    return;
  }

  empty.classList.add('d-none');
  grid.innerHTML = '';

  for (const group of buildTripGroups(routes)) {
    const col = document.createElement('div');
    col.className = 'col-12 col-lg-6';
    col.appendChild(buildGroupCard(group));
    grid.appendChild(col);
  }

  routes.forEach(r => loadMiniChart(r.id));
}

function buildGroupCard(group) {
  const isArchived = group.legs.every(l => l.is_archived);
  const card = document.createElement('div');
  card.className = `group-card p-3 ${group.isRoundTrip ? 'round-trip-group' : ''} ${isArchived ? 'is-archived' : ''}`;

  group.legs.forEach((leg, i) => {
    if (i > 0) {
      const hr = document.createElement('hr');
      hr.className = 'border-secondary my-3';
      card.appendChild(hr);
    }
    card.appendChild(buildLegSection(leg, group.isRoundTrip));
  });

  return card;
}

function buildLegSection(leg, isRoundTrip) {
  const section    = document.createElement('div');
  const seatLabel  = { ECONOMY: 'Economy', PREMIUM_ECONOMY: 'Prem. Eco', BUSINESS: 'Business', FIRST: 'First' }[leg.seat_type] || leg.seat_type;
  const airlinesStr = leg.airlines?.length ? leg.airlines.join(', ') : 'Any airline';
  const adults     = leg.adults > 1 ? ` · ${leg.adults} adults` : '';
  const nonstop    = leg.non_stop_only ? ' · Non-stop' : '';
  const legBadge   = isRoundTrip
    ? `<span class="badge bg-secondary me-2" style="font-size:0.65rem">${leg.leg_label.toUpperCase()}</span>`
    : '';

  const today    = new Date().toISOString().slice(0, 10);
  const isPast   = leg.dates.every(r => r.departure_date < today);
  const pastBadge = isPast ? `<span class="past-badge me-2">PAST</span>` : '';

  const notifyOn = leg.dates.some(r => r.notify === 1);
  const bellClass = notifyOn ? 'btn-warning' : 'btn-outline-secondary';
  const bellIcon  = notifyOn ? 'bi-bell-fill' : 'bi-bell';
  const bellTitle = notifyOn ? 'Notifications on — click to disable' : 'Notifications off — click to enable';

  const targetPrice = leg.dates[0]?.target_price;
  const hasTarget   = targetPrice != null;
  const targetMet   = hasTarget && leg.dates.some(r => r.current_price != null && r.current_price <= targetPrice);
  const targetClass = hasTarget ? (targetMet ? 'target-badge met' : 'target-badge') : 'btn btn-sm btn-outline-secondary py-0 px-1';

  const assignedTrip = namedTrips.find(t => t.id === leg.named_trip_id);
  const tagStyle = assignedTrip ? `color:${assignedTrip.color};border-color:${assignedTrip.color}40` : '';
  const tagIcon  = assignedTrip ? 'bi-tag-fill' : 'bi-tag';
  const tripMenuItems = namedTrips.map(t =>
    `<li><a class="dropdown-item${leg.named_trip_id === t.id ? ' active' : ''}" href="#"
            onclick="event.preventDefault();assignLegToTrip([${leg.ids.join(',')}],${t.id})">
       <span class="trip-assign-dot" style="background:${t.color}"></span>${t.name}
     </a></li>`
  ).join('');

  section.innerHTML = `
    <div class="d-flex justify-content-between align-items-start mb-2">
      <div>
        ${pastBadge}${legBadge}
        <span class="fw-bold fs-5">${leg.origin} → ${leg.destination}</span>
        <div class="text-secondary small mt-1">${seatLabel}${adults}${nonstop} · ${airlinesStr}</div>
      </div>
      <div class="d-flex gap-1 align-items-center">
        <button class="${targetClass}"
                onclick="openTargetPriceModal([${leg.ids.join(',')}], ${targetPrice ?? 'null'}, '${leg.origin} → ${leg.destination}')"
                title="${hasTarget ? `Target: ${formatMoney(targetPrice, leg.dates[0]?.currency || appCurrency)}` : 'Set price target alert'}">
          <i class="bi bi-bullseye small"></i>
          ${hasTarget ? `<span class="small ms-1">${targetMet ? '✓ ' : ''}${formatMoney(targetPrice, leg.dates[0]?.currency || appCurrency)}</span>` : ''}
        </button>
        <div class="dropdown">
          <button class="btn btn-sm btn-outline-secondary py-0 px-1" style="${tagStyle}"
                  data-bs-toggle="dropdown" title="${assignedTrip ? `Trip: ${assignedTrip.name}` : 'Assign to trip'}">
            <i class="bi ${tagIcon} small"></i>
          </button>
          <ul class="dropdown-menu dropdown-menu-end fp-dropdown">
            <li><span class="dropdown-header">Assign to trip</span></li>
            ${tripMenuItems}
            ${namedTrips.length ? '<li><hr class="dropdown-divider fp-dd-divider"></li>' : ''}
            <li><a class="dropdown-item${!leg.named_trip_id ? ' active' : ''}" href="#"
                   onclick="event.preventDefault();assignLegToTrip([${leg.ids.join(',')}],null)">
              <i class="bi bi-x-circle me-1" style="font-size:0.7rem"></i>No trip
            </a></li>
          </ul>
        </div>
        <button class="btn btn-sm ${bellClass} py-0 px-1 notify-btn"
                id="notify-btn-${leg.ids[0]}"
                data-ids="${leg.ids.join(',')}"
                data-notify="${notifyOn ? '1' : '0'}"
                onclick="toggleLegNotify(this)" title="${bellTitle}">
          <i class="bi ${bellIcon} small"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger py-0 px-1"
                onclick="deleteLegGroup([${leg.ids.join(',')}])" title="Remove">
          <i class="bi bi-trash3 small"></i>
        </button>
      </div>
    </div>
    <div class="row g-2" id="dates-${leg.ids[0]}"></div>
  `;

  const datesRow = section.querySelector(`#dates-${leg.ids[0]}`);
  const colWidth = leg.dates.length === 3 ? 'col-4' : 'col-6';
  leg.dates.forEach(r => {
    const col = document.createElement('div');
    col.className = colWidth;
    col.appendChild(buildDateSubcard(r));
    datesRow.appendChild(col);
  });

  return section;
}

function buildDateSubcard(r) {
  const isTarget   = r.day_offset === 0;
  const offsetLabel = r.day_offset === -1 ? '← Day Before' : r.day_offset === 1 ? 'Day After →' : 'Selected';
  const offsetClass = r.day_offset === -1 ? 'offset-badge-neg' : r.day_offset === 1 ? 'offset-badge-pos' : 'offset-badge-mid';
  const isSelected  = tripSelection.has(r.id);

  const card = document.createElement('div');
  card.className = `date-subcard p-2${isTarget ? ' is-target-date' : ''}${isSelected ? ' selected' : ''}`;
  card.id = `subcard-${r.id}`;

  const rCurr = r.currency || appCurrency;
  const priceHtml   = formatPrice(r.current_price, r.prev_price, rCurr);
  const trendHtml   = renderTrend(r.trend);
  const statsHtml   = renderStats(r.price_min, r.price_avg, r.price_max, r.price_count, rCurr);
  const lastChecked = r.last_checked ? timeAgo(r.last_checked) : 'never';
  const isHistoricLow = r.current_price != null && r.price_min != null && r.current_price <= r.price_min && r.price_count >= 2;
  const dealBadge   = isHistoricLow ? `<div class="text-center mb-1"><span class="badge-deal"><i class="bi bi-fire"></i>All-Time Low!</span></div>` : '';
  const gfUrl       = getGoogleFlightsUrl(r.origin, r.destination, r.departure_date, null, r.seat_type, r.non_stop_only);

  card.innerHTML = `
    <input type="checkbox" class="route-checkbox" id="chk-${r.id}"
           ${isSelected ? 'checked' : ''}
           onchange="toggleTripSelection(${r.id}, '${r.origin}→${r.destination} ${r.departure_date}', event)">
    <div class="text-center mb-1">
      <span class="badge ${offsetClass} rounded-pill">${offsetLabel}</span>
    </div>
    <div class="text-center small mb-1">${r.departure_date}</div>
    ${dealBadge}
    <div class="text-center mb-0">${priceHtml}</div>
    <div class="text-center mb-1">${trendHtml}</div>
    <div class="text-center mb-1">${statsHtml}</div>
    <div class="chart-area" style="height:48px"
         title="checked ${lastChecked} — click to view history graph"
         onclick="openChartModal(${r.id}, '${r.origin}→${r.destination} · ${r.departure_date}')">
      <canvas id="chart-${r.id}"></canvas>
    </div>
    <div class="subcard-actions">
      <button class="subcard-btn" onclick="openFlightDetails(${r.id})" title="View Itinerary & Layovers">
        <i class="bi bi-info-circle me-1"></i>Details
      </button>
      <a href="${gfUrl}" target="_blank" rel="noopener" class="subcard-btn" title="Open on Google Flights">
        <i class="bi bi-box-arrow-up-right me-1"></i>Google
      </a>
    </div>
  `;

  return card;
}

function renderTrend(trend) {
  if (!trend || trend === 'unknown') return '';
  const map = {
    rising:  `<span class="trend-rising">▲ Rising</span>`,
    falling: `<span class="trend-falling">▼ Falling</span>`,
    stable:  `<span class="trend-stable">→ Stable</span>`,
  };
  return map[trend] || '';
}

function renderStats(min, avg, max, count, curr = appCurrency) {
  if (!count || count < 2) return `<span class="price-stats">No history yet</span>`;
  const fmt = n => n != null ? formatMoney(n, curr) : '—';
  return `<span class="price-stats">
    <span class="stat-low" title="All-time low">↓${fmt(min)}</span>
    <span class="mx-1 text-secondary">·</span>
    <span title="Average">avg ${fmt(avg)}</span>
    <span class="mx-1 text-secondary">·</span>
    <span class="stat-high" title="All-time high">↑${fmt(max)}</span>
  </span>`;
}

function formatPrice(current, prev, curr = appCurrency) {
  if (current == null) return `<span class="price-none" style="font-size:1rem">—</span>`;
  const fmt = n => formatMoney(n, curr);
  let changeHtml = '';
  if (prev != null && prev !== current) {
    const diff = current - prev;
    const cls  = diff < 0 ? 'price-down' : 'price-up';
    const icon = diff < 0 ? '↓' : '↑';
    changeHtml = `<span class="${cls}" style="font-size:0.7rem"> ${icon}${fmt(Math.abs(diff))}</span>`;
  }
  const mainCls = prev == null || prev === current ? '' : (current < prev ? 'price-down' : 'price-up');
  return `<span class="price-display ${mainCls}">${fmt(current)}</span>${changeHtml}`;
}

// ── Mini charts ────────────────────────────────────────────────────────────
async function loadMiniChart(routeId) {
  try {
    const res     = await fetch(`/api/routes/${routeId}/history`);
    const history = await res.json();
    renderMiniChart(routeId, history);
  } catch (e) {
    console.error(`Chart load failed for route ${routeId}:`, e);
  }
}

function buildChartData(history) {
  return history.filter(h => h.price != null).map(h => ({ x: new Date(h.checked_at), y: h.price }));
}

function renderMiniChart(routeId, history) {
  const canvas = document.getElementById(`chart-${routeId}`);
  if (!canvas) return;
  if (miniCharts[routeId]) miniCharts[routeId].destroy();

  const data = buildChartData(history);
  if (!data.length) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#263d52';
    ctx.font = "10px 'Barlow Condensed', sans-serif";
    ctx.textAlign = 'center';
    ctx.fillText('NO DATA YET', canvas.width / 2, 30);
    return;
  }

  miniCharts[routeId] = new Chart(canvas, chartConfig(data, true));
}

function chartConfig(data, mini = false) {
  const prices = data.map(d => d.y);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const pad  = Math.max((maxP - minP) * 0.2, 10);

  return {
    type: 'line',
    data: {
      datasets: [{
        data,
        borderColor: '#00cfe0',
        backgroundColor: 'rgba(0,207,224,0.06)',
        borderWidth: mini ? 1.5 : 2,
        pointRadius: mini ? 0 : 3,
        pointHoverRadius: mini ? 3 : 5,
        pointBackgroundColor: '#00cfe0',
        fill: true,
        tension: 0.35,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0a1828',
          borderColor: '#193860',
          borderWidth: 1,
          titleColor: '#4a7090',
          bodyColor: '#f0b22a',
          bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
          callbacks: { label: ctx => formatMoney(ctx.parsed.y, appCurrency) }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'MMM d, h:mm a' },
          grid: { color: mini ? 'transparent' : '#0f2035' },
          ticks: { display: !mini, color: '#4a7090', maxRotation: 0, maxTicksLimit: 6, font: { size: 10 } }
        },
        y: {
          min: minP - pad,
          max: maxP + pad,
          grid: { color: mini ? 'transparent' : '#0f2035' },
          ticks: { display: !mini, color: '#4a7090', callback: v => formatMoney(v, appCurrency), font: { size: 10 } }
        }
      }
    }
  };
}

// ── Expanded chart modal ───────────────────────────────────────────────────
async function openChartModal(routeId, title) {
  document.getElementById('chart-modal-title').textContent = title;
  const modal = new bootstrap.Modal(document.getElementById('chartModal'));
  modal.show();

  document.getElementById('chartModal').addEventListener('shown.bs.modal', async () => {
    if (expandedChart) { expandedChart.destroy(); expandedChart = null; }
    try {
      const res     = await fetch(`/api/routes/${routeId}/history`);
      const history = await res.json();
      const data    = buildChartData(history);
      const canvas  = document.getElementById('chart-modal-canvas');
      if (data.length) {
        expandedChart = new Chart(canvas, chartConfig(data, false));
      } else {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#263d52';
        ctx.font = "13px 'Barlow Condensed', sans-serif";
        ctx.textAlign = 'center';
        ctx.fillText('NO PRICE DATA YET', canvas.width / 2, 60);
      }
    } catch (e) { console.error('Chart modal error:', e); }
  }, { once: true });
}

// ── Trip Builder ───────────────────────────────────────────────────────────
function toggleTripSelection(routeId, label, event) {
  event.stopPropagation();
  const route = routes.find(r => r.id === routeId);
  const price = route?.current_price ?? null;

  if (tripSelection.has(routeId)) {
    tripSelection.delete(routeId);
  } else {
    tripSelection.set(routeId, { label, price });
  }

  const subcard = document.getElementById(`subcard-${routeId}`);
  if (subcard) subcard.classList.toggle('selected', tripSelection.has(routeId));

  renderTripBuilder();
}

function renderTripBuilder() {
  const bar      = document.getElementById('trip-builder');
  const itemsEl  = document.getElementById('trip-builder-items');
  const totalEl  = document.getElementById('trip-builder-total');
  const countEl  = document.getElementById('trip-builder-count');

  if (tripSelection.size === 0) { bar.classList.add('d-none'); return; }

  bar.classList.remove('d-none');
  itemsEl.innerHTML = '';
  let total = 0, hasNull = false;

  for (const [id, { label, price }] of tripSelection) {
    const span = document.createElement('span');
    span.className = 'trip-item-badge';
    span.innerHTML = `${label} ${price != null
      ? `<strong>${formatMoney(price, appCurrency)}</strong>`
      : '<em class="text-secondary">no price</em>'}
      <button class="btn-close ms-1" style="font-size:0.5rem" onclick="removeTripItem(${id})"></button>`;
    itemsEl.appendChild(span);
    if (price != null) total += price;
    else hasNull = true;
  }

  countEl.textContent = `${tripSelection.size} flight${tripSelection.size > 1 ? 's' : ''} selected`;
  totalEl.innerHTML = hasNull
    ? `<span class="text-secondary">Total: n/a</span>`
    : `Total: <span class="text-success">${formatMoney(total, appCurrency)}</span>`;
}

function removeTripItem(routeId) {
  tripSelection.delete(routeId);
  const chk = document.getElementById(`chk-${routeId}`);
  if (chk) chk.checked = false;
  const sub = document.getElementById(`subcard-${routeId}`);
  if (sub) sub.classList.remove('selected');
  renderTripBuilder();
}

function clearTripBuilder() {
  for (const id of tripSelection.keys()) {
    const chk = document.getElementById(`chk-${id}`);
    if (chk) chk.checked = false;
    const sub = document.getElementById(`subcard-${id}`);
    if (sub) sub.classList.remove('selected');
  }
  tripSelection.clear();
  renderTripBuilder();
}

// ── Notify toggle ──────────────────────────────────────────────────────────
async function toggleLegNotify(btn) {
  const ids    = btn.dataset.ids.split(',').map(Number);
  const notify = btn.dataset.notify === '1' ? 0 : 1;
  try {
    await fetch('/api/routes/notify', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, notify }),
    });
    btn.dataset.notify = notify ? '1' : '0';
    btn.className = `btn btn-sm ${notify ? 'btn-warning' : 'btn-outline-secondary'} py-0 px-1 notify-btn`;
    btn.title     = notify ? 'Notifications on — click to disable' : 'Notifications off — click to enable';
    btn.querySelector('i').className = `bi ${notify ? 'bi-bell-fill' : 'bi-bell'} small`;
  } catch (e) {
    console.error('Failed to update notify setting:', e);
  }
}

// ── Trip assignment ────────────────────────────────────────────────────────
async function assignLegToTrip(ids, namedTripId) {
  try {
    await fetch('/api/routes/assign-trip', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, named_trip_id: namedTripId }),
    });
    await loadRoutes();
    await loadNamedTrips();
  } catch (e) {
    alert('Failed to assign trip.');
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────
async function deleteLegGroup(ids) {
  if (!confirm(`Remove this route group (${ids.length} date variants) and all price history?`)) return;
  ids.forEach(id => tripSelection.delete(id));
  renderTripBuilder();
  try {
    await fetch('/api/routes/batch', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    await loadRoutes();
    await loadNamedTrips();
  } catch (e) {
    alert('Failed to delete route group.');
  }
}

// ── Add route ──────────────────────────────────────────────────────────────
function openAddModal() {
  document.getElementById('add-error').classList.add('d-none');
  document.getElementById('typeOneWay').checked = true;
  document.getElementById('return-segment').classList.add('d-none');
  document.getElementById('outbound-label').textContent = 'Flight';
  ['out-origin','out-dest','out-date','ret-origin','ret-dest','ret-date','opt-airlines'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('opt-adults').value = 1;
  document.getElementById('opt-seat').value   = 'ECONOMY';
  document.getElementById('opt-nonstop').checked = false;
  populateTripDropdown();
  document.getElementById('opt-trip').value = selectedNamedTripId || '';
  new bootstrap.Modal(document.getElementById('addModal')).show();
}

async function addRoute() {
  const errEl    = document.getElementById('add-error');
  errEl.classList.add('d-none');

  const tripType = document.querySelector('input[name="tripType"]:checked').value;
  const outOrigin = document.getElementById('out-origin').value.trim().toUpperCase();
  const outDest   = document.getElementById('out-dest').value.trim().toUpperCase();
  const outDate   = document.getElementById('out-date').value;
  const adults    = parseInt(document.getElementById('opt-adults').value) || 1;
  const seatType  = document.getElementById('opt-seat').value;
  const nonStop   = document.getElementById('opt-nonstop').checked;
  const airlinesRaw = document.getElementById('opt-airlines').value;
  const airlines  = airlinesRaw ? airlinesRaw.split(',').map(a => a.trim().toUpperCase()).filter(Boolean) : [];
  const namedTripIdVal = document.getElementById('opt-trip').value;
  const namedTripId = namedTripIdVal ? parseInt(namedTripIdVal) : null;

  if (!outOrigin || !outDest || !outDate) { showAddError('Origin, destination, and departure date are required.'); return; }
  if (outOrigin.length !== 3 || outDest.length !== 3) { showAddError('Origin and destination must be 3-letter IATA codes (e.g. JFK, LHR).'); return; }

  const body = {
    trip_type: tripType,
    outbound: { origin: outOrigin, destination: outDest, departure_date: outDate },
    adults, seat_type: seatType, non_stop_only: nonStop, airlines,
    named_trip_id: namedTripId,
  };

  if (tripType === 'round_trip') {
    const retOrigin = document.getElementById('ret-origin').value.trim().toUpperCase();
    const retDest   = document.getElementById('ret-dest').value.trim().toUpperCase();
    const retDate   = document.getElementById('ret-date').value;
    if (!retOrigin || !retDest || !retDate) { showAddError('Return origin, destination, and date are required for round trips.'); return; }
    body.return = { origin: retOrigin, destination: retDest, departure_date: retDate };
  }

  const btn = document.getElementById('btn-add-route');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Adding…';

  try {
    const res = await fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Server error');
    bootstrap.Modal.getInstance(document.getElementById('addModal')).hide();
    await loadRoutes();
    await loadNamedTrips();
  } catch (e) {
    showAddError('Failed to add route. Please try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-plus-lg me-1"></i>Add Route';
  }
}

function showAddError(msg) {
  const el = document.getElementById('add-error');
  el.textContent = msg;
  el.classList.remove('d-none');
}

// ── Check now ──────────────────────────────────────────────────────────────
async function checkNow() {
  const btn = document.getElementById('btn-check-now');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Checking…';
  try {
    await fetch('/api/poll', { method: 'POST' });
    let attempts = 0;
    const refresh = setInterval(async () => {
      await loadRoutes();
      if (++attempts >= 6) {
        clearInterval(refresh);
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i>Check Now';
      }
    }, 5000);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i>Check Now';
  }
}

// ── Settings ───────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const res  = await fetch('/api/settings');
    const data = await res.json();
    document.getElementById('setting-interval').value = data.poll_interval_minutes;
    if (data.currency) {
      appCurrency = data.currency;
      const curSelect = document.getElementById('setting-currency');
      if (curSelect) curSelect.value = data.currency;
      const prefixEl = document.getElementById('trip-budget-prefix');
      if (prefixEl) prefixEl.textContent = getCurrencySymbol(appCurrency);
      const targetPrefix = document.getElementById('target-price-prefix');
      if (targetPrefix) targetPrefix.textContent = getCurrencySymbol(appCurrency);
    }
    if (document.getElementById('setting-discord-webhook')) {
      document.getElementById('setting-discord-webhook').value = data.discord_webhook_url || '';
    }
    if (document.getElementById('setting-telegram-token')) {
      document.getElementById('setting-telegram-token').value = data.telegram_bot_token || '';
    }
    if (document.getElementById('setting-telegram-chat')) {
      document.getElementById('setting-telegram-chat').value = data.telegram_chat_id || '';
    }
    if (document.getElementById('setting-pushover-user')) {
      document.getElementById('setting-pushover-user').value = data.pushover_user || '';
    }
    if (document.getElementById('setting-pushover-token')) {
      document.getElementById('setting-pushover-token').value = data.pushover_token || '';
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function openSettingsModal() {
  document.getElementById('notify-result').classList.add('d-none');
  new bootstrap.Modal(document.getElementById('settingsModal')).show();
}

async function saveSettings() {
  const interval = parseInt(document.getElementById('setting-interval').value);
  const currency = document.getElementById('setting-currency')?.value || appCurrency;
  const body = {
    poll_interval_minutes: interval,
    currency,
    discord_webhook_url: document.getElementById('setting-discord-webhook')?.value.trim() || '',
    telegram_bot_token: document.getElementById('setting-telegram-token')?.value.trim() || '',
    telegram_chat_id: document.getElementById('setting-telegram-chat')?.value.trim() || '',
    pushover_user: document.getElementById('setting-pushover-user')?.value.trim() || '',
    pushover_token: document.getElementById('setting-pushover-token')?.value.trim() || '',
  };
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.currency) {
      appCurrency = data.currency;
      const prefixEl = document.getElementById('trip-budget-prefix');
      if (prefixEl) prefixEl.textContent = getCurrencySymbol(appCurrency);
      const targetPrefix = document.getElementById('target-price-prefix');
      if (targetPrefix) targetPrefix.textContent = getCurrencySymbol(appCurrency);
    }
    bootstrap.Modal.getInstance(document.getElementById('settingsModal')).hide();
    await loadRoutes();
    await loadNamedTrips();
  } catch (e) {
    alert('Failed to save settings.');
  }
}

// ── Target Price Modal ─────────────────────────────────────────────────────
function openTargetPriceModal(ids, currentTarget, routeTitle) {
  document.getElementById('target-price-ids').value = ids.join(',');
  document.getElementById('target-price-val').value = currentTarget != null ? Math.round(currentTarget) : '';
  document.getElementById('target-price-desc').textContent = `Set price alert for ${routeTitle}. When price drops to or below target, you'll be notified.`;
  const targetPrefix = document.getElementById('target-price-prefix');
  if (targetPrefix) targetPrefix.textContent = getCurrencySymbol(appCurrency);
  new bootstrap.Modal(document.getElementById('targetPriceModal')).show();
}

async function saveTargetPrice() {
  const idsStr = document.getElementById('target-price-ids').value;
  const ids = idsStr ? idsStr.split(',').map(Number) : [];
  const valStr = document.getElementById('target-price-val').value.trim();
  const target_price = valStr ? parseFloat(valStr) : null;
  try {
    await fetch('/api/routes/target-price', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, target_price }),
    });
    bootstrap.Modal.getInstance(document.getElementById('targetPriceModal')).hide();
    await loadRoutes();
  } catch (e) {
    alert('Failed to save target price.');
  }
}

// ── Flight Details Modal ───────────────────────────────────────────────────
function openFlightDetails(routeId) {
  const r = routes.find(x => x.id === routeId);
  if (!r) return;
  const titleEl = document.getElementById('flight-details-title');
  const subEl   = document.getElementById('flight-details-subtitle');
  const bodyEl  = document.getElementById('flight-details-content');
  const gfBtn   = document.getElementById('btn-open-google-flights');
  const durEl   = document.getElementById('flight-details-duration');

  const rCurr = r.currency || appCurrency;
  titleEl.innerHTML = `${r.origin} → ${r.destination} <span class="badge bg-secondary ms-2" style="font-size:0.7rem">${r.leg_label.toUpperCase()}</span>`;
  subEl.textContent = `Departure: ${r.departure_date} · Current Best Price: ${formatMoney(r.current_price, rCurr)}`;

  const gfUrl = getGoogleFlightsUrl(r.origin, r.destination, r.departure_date, null, r.seat_type, r.non_stop_only);
  gfBtn.href = gfUrl;

  const details = r.flight_details;
  if (!details || !details.legs || !details.legs.length) {
    bodyEl.innerHTML = `
      <div class="text-center text-secondary py-4">
        <i class="bi bi-airplane me-1 fs-4 d-block mb-2 text-cyan"></i>
        Detailed airline and itinerary segments will appear on the next price check.
      </div>`;
    durEl.textContent = '';
  } else {
    let html = '';
    const stopsText = details.stops === 0 ? 'Non-stop' : `${details.stops} stop${details.stops > 1 ? 's' : ''}`;
    durEl.textContent = `Total Flight Time: ${formatMinutes(details.duration)} · ${stopsText}`;

    for (let i = 0; i < details.legs.length; i++) {
      const leg = details.legs[i];
      html += `
        <div class="itinerary-leg-card">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div>
              <span class="itinerary-airline"><i class="bi bi-airplane-engines me-1"></i>${leg.airline || 'Flight'}</span>
              <span class="itinerary-flight-num">#${leg.flight_number || ''}</span>
            </div>
            <span class="badge bg-dark border border-secondary text-secondary small">${formatMinutes(leg.duration)}</span>
          </div>
          <div class="d-flex justify-content-between align-items-center">
            <div>
              <div class="itinerary-time">${formatTime(leg.departure_time)}</div>
              <div class="itinerary-airport">${leg.departure_airport || r.origin}</div>
            </div>
            <div class="text-center text-secondary small px-3">
              <i class="bi bi-arrow-right fs-5 text-cyan"></i>
            </div>
            <div class="text-end">
              <div class="itinerary-time">${formatTime(leg.arrival_time)}</div>
              <div class="itinerary-airport">${leg.arrival_airport || r.destination}</div>
            </div>
          </div>
        </div>
      `;
      if (i < details.legs.length - 1) {
        const nextLeg = details.legs[i + 1];
        const layoverMins = getMinutesDiff(leg.arrival_time, nextLeg.departure_time);
        html += `
          <div class="itinerary-layover">
            <i class="bi bi-hourglass-split"></i>
            <span>Layover in <strong>${leg.arrival_airport}</strong>: ${formatMinutes(layoverMins)}</span>
          </div>
        `;
      }
    }
    bodyEl.innerHTML = html;
  }

  new bootstrap.Modal(document.getElementById('flightDetailsModal')).show();
}

async function testNotification() {
  const btn      = document.getElementById('btn-test-notify');
  const resultEl = document.getElementById('notify-result');
  btn.disabled   = true;
  btn.innerHTML  = '<span class="spinner-border spinner-border-sm me-1"></span>Sending…';

  try {
    const res  = await fetch('/api/notify/test', { method: 'POST' });
    const data = await res.json();
    resultEl.classList.remove('d-none', 'text-danger', 'text-success');
    if (res.ok) {
      resultEl.className  = 'mt-2 small text-success';
      resultEl.textContent = '✓ Test notification sent successfully.';
    } else {
      resultEl.className  = 'mt-2 small text-danger';
      resultEl.textContent = `✗ ${data.detail || 'Failed. Check PUSHOVER_TOKEN and PUSHOVER_USER.'}`;
    }
  } catch (e) {
    resultEl.className  = 'mt-2 small text-danger';
    resultEl.textContent = '✗ Request failed.';
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '<i class="bi bi-bell me-1"></i>Send Test';
    resultEl.classList.remove('d-none');
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────
function timeAgo(isoStr) {
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
