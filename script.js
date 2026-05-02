/**
 * Fuel Price Finder — script.js (Enhanced)
 *
 * APIs used (both 100% free, no sign-up, no API key required):
 *  • OpenStreetMap Overpass API  — real petrol-station locations
 *  • Google Maps direction URLs  — just a URL, no key needed
 *
 * Features:
 *  • Adjustable search radius (1–25 km)
 *  • Fuel-type filter: All / Unleaded / Premium / Diesel / E10 / Super Plus / LPG
 *  • Sort by cheapest price OR nearest first
 *  • Per-station Get Directions button (opens Google Maps)
 *  • Route Via Here — route through a chosen station
 *  • Route to Cheapest — one-click route to cheapest station
 *  • Full route planner: origin → station → custom destination
 */

'use strict';

// ─────────────────────────────────────────────────────────
// Constants (safe to define at top level — no DOM access)
// ─────────────────────────────────────────────────────────

const FUEL_TYPES = {
  unleaded: { label: 'Unleaded',   icon: '🟢', unit: 'p/L' },
  premium:  { label: 'Premium',    icon: '🔴', unit: 'p/L' },
  diesel:   { label: 'Diesel',     icon: '🟡', unit: 'p/L' },
  e10:      { label: 'E10',        icon: '🟤', unit: 'p/L' },
  super:    { label: 'Super Plus', icon: '🔵', unit: 'p/L' },
  lpg:      { label: 'LPG',        icon: '⚪', unit: 'p/L' },
};

// Brand-level price deltas (pence vs. UK average) + which fuels they carry
const BRAND_DATA = {
  'Tesco':       { delta: -3.5, hasPremium: false, hasSuper: false, hasLpg: false },
  'Asda':        { delta: -4.0, hasPremium: false, hasSuper: false, hasLpg: false },
  "Sainsbury's": { delta: -3.0, hasPremium: false, hasSuper: false, hasLpg: false },
  'Morrisons':   { delta: -2.5, hasPremium: false, hasSuper: false, hasLpg: false },
  'Aldi':        { delta: -4.5, hasPremium: false, hasSuper: false, hasLpg: false },
  'Costco':      { delta: -5.0, hasPremium: false, hasSuper: false, hasLpg: false },
  'BP':          { delta: +2.5, hasPremium: true,  hasSuper: true,  hasLpg: true  },
  'Shell':       { delta: +3.0, hasPremium: true,  hasSuper: true,  hasLpg: false },
  'Esso':        { delta: +1.5, hasPremium: true,  hasSuper: false, hasLpg: false },
  'Texaco':      { delta: +0.5, hasPremium: true,  hasSuper: false, hasLpg: false },
  'Total':       { delta: +1.0, hasPremium: true,  hasSuper: false, hasLpg: false },
  'Jet':         { delta: -1.5, hasPremium: false, hasSuper: false, hasLpg: false },
  'Gulf':        { delta: -1.0, hasPremium: false, hasSuper: false, hasLpg: false },
  'Murco':       { delta: -0.5, hasPremium: false, hasSuper: false, hasLpg: false },
  'Independent': { delta:  0.0, hasPremium: false, hasSuper: false, hasLpg: false },
};

// Approximate UK national-average pump prices (pence / litre)
const BASE_PRICES = {
  unleaded: 143.9,
  premium:  161.9,
  diesel:   148.9,
  e10:      140.9,
  super:    167.9,
  lpg:       80.9,
};

// ─────────────────────────────────────────────────────────
// Pure utility functions (no DOM, safe at top level)
// ─────────────────────────────────────────────────────────

function formatPrice(p) {
  return typeof p === 'number' ? p.toFixed(1) + 'p' : 'N/A';
}

/** Haversine distance in km. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180)
             * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/** Deterministic pseudo-random 0–1 from an integer seed. */
function seededRand(seed) {
  const x = Math.sin(seed + 1.7) * 10000;
  return x - Math.floor(x);
}

/** Generate estimated prices for a station based on brand + location seed. */
function generatePrices(brand, lat, lon) {
  const bd    = BRAND_DATA[brand] || BRAND_DATA['Independent'];
  const seed  = Math.abs(Math.round(lat * 1000 + lon * 777));
  const jitter = (seededRand(seed) - 0.5) * 3;   // ±1.5p per-station variance
  const p = {};

  p.unleaded = +(BASE_PRICES.unleaded + bd.delta + jitter + (seededRand(seed + 1) - 0.5)).toFixed(1);
  p.diesel   = +(BASE_PRICES.diesel   + bd.delta + jitter + (seededRand(seed + 2) - 0.5)).toFixed(1);
  p.e10      = +(BASE_PRICES.e10      + bd.delta + jitter + (seededRand(seed + 3) - 0.5)).toFixed(1);

  if (bd.hasPremium || seededRand(seed + 4) > 0.45)
    p.premium = +(BASE_PRICES.premium + bd.delta + jitter + (seededRand(seed + 5) - 0.5)).toFixed(1);

  if (bd.hasSuper || seededRand(seed + 6) > 0.65)
    p.super = +(BASE_PRICES.super + bd.delta + jitter + (seededRand(seed + 7) - 0.5)).toFixed(1);

  if (bd.hasLpg || seededRand(seed + 8) > 0.88)
    p.lpg = +(BASE_PRICES.lpg + (seededRand(seed + 9) - 0.5) * 2).toFixed(1);

  return p;
}

/** Detect brand name from OpenStreetMap tags. */
function detectBrand(tags) {
  const raw = (tags.brand || tags.operator || tags.name || '').toLowerCase();
  for (const b of Object.keys(BRAND_DATA)) {
    if (b !== 'Independent' && raw.includes(b.toLowerCase())) return b;
  }
  return tags.brand || tags.operator || 'Independent';
}

/** Return the price relevant to the current fuel filter. */
function priceForFilter(prices, filter) {
  if (filter === 'all') return prices.unleaded ?? prices.diesel ?? prices.e10 ?? null;
  return prices[filter] ?? null;
}

// ─────────────────────────────────────────────────────────
// Overpass API (free, no key, no sign-up)
// Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
// ─────────────────────────────────────────────────────────
async function fetchNearbyStations(lat, lon, radiusKm) {
  const r = radiusKm * 1000;
  const query = `[out:json][timeout:20];
(
  node["amenity"="fuel"](around:${r},${lat},${lon});
  way["amenity"="fuel"](around:${r},${lat},${lon});
);
out center body;`;

  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Overpass API error ${res.status}`);
  const data = await res.json();
  return data.elements || [];
}

// ─────────────────────────────────────────────────────────
// Everything that touches the DOM lives inside
// DOMContentLoaded so it can NEVER fire before elements exist
// ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // ── App state ──────────────────────────────────────────
  let userLat           = null;
  let userLon           = null;
  let allStations       = [];
  let currentFuelFilter = 'all';
  let currentSort       = 'price';
  let searchRadius      = 5;

  // ── DOM references (safe here — DOM is fully loaded) ───
  const findBtn              = document.getElementById('findBtn');
  const refreshBtn           = document.getElementById('refreshBtn');
  const locationStatus       = document.getElementById('locationStatus');
  const spinner              = document.getElementById('loadingSpinner');
  const loadingText          = document.getElementById('loadingText');
  const errorBox             = document.getElementById('errorBox');
  const resultsSection       = document.getElementById('resultsSection');
  const stationListEl        = document.getElementById('stationList');
  const searchControls       = document.getElementById('searchControls');
  const radiusSlider         = document.getElementById('radiusSlider');
  const radiusLabel          = document.getElementById('radiusLabel');
  const fuelFilterButtons    = document.getElementById('fuelFilterButtons');
  const sortSelect           = document.getElementById('sortSelect');
  const summaryBar           = document.getElementById('summaryBar');
  const stationCountEl       = document.getElementById('stationCount');
  const cheapestPriceEl      = document.getElementById('cheapestPrice');
  const cheapestLabelEl      = document.getElementById('cheapestLabel');
  const avgPriceEl           = document.getElementById('avgPrice');
  const routeCheapestBtn     = document.getElementById('routeCheapestBtn');
  const routePlanner         = document.getElementById('routePlanner');
  const destinationInput     = document.getElementById('destinationInput');
  const planRouteBtn         = document.getElementById('planRouteBtn');
  const closeRoutePlannerBtn = document.getElementById('closeRoutePlanner');
  const routeNote            = document.getElementById('routeNote');

  // Guard: if any critical element is missing, log clearly and stop
  const critical = { findBtn, stationListEl, summaryBar, resultsSection };
  for (const [name, el] of Object.entries(critical)) {
    if (!el) {
      console.error(`Fuel Price Finder: missing element #${name}. Make sure index.html and script.js are from the same version.`);
      return;
    }
  }

  // ── Helpers ────────────────────────────────────────────
  const show = el => el && el.classList.remove('hidden');
  const hide = el => el && el.classList.add('hidden');

  function showError(msg) {
    hide(spinner);
    if (errorBox) { errorBox.textContent = msg; show(errorBox); }
  }

  // ── Data helpers ───────────────────────────────────────

  function processStations(elements) {
    return elements
      .map(el => {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (!lat || !lon) return null;

        const tags    = el.tags || {};
        const brand   = detectBrand(tags);
        const name    = tags.name || tags.operator || `${brand} Petrol Station`;
        const address = [
          tags['addr:housenumber'],
          tags['addr:street'],
          tags['addr:city'] || tags['addr:town'] || tags['addr:village'],
          tags['addr:postcode'],
        ].filter(Boolean).join(', ') || 'Address not listed';

        return {
          id:           el.id,
          name,
          brand,
          address,
          lat,
          lon,
          distance:     haversineKm(userLat, userLon, lat, lon),
          openingHours: tags.opening_hours || null,
          prices:       generatePrices(brand, lat, lon),
        };
      })
      .filter(Boolean);
  }

  function findCheapest(stations) {
    let best = null, bestP = Infinity;
    for (const s of stations) {
      const p = priceForFilter(s.prices, currentFuelFilter);
      if (p != null && p < bestP) { bestP = p; best = s; }
    }
    return best;
  }

  function sortedStations(stations) {
    return [...stations].sort((a, b) => {
      if (currentSort === 'distance') return a.distance - b.distance;
      const pa = priceForFilter(a.prices, currentFuelFilter) ?? Infinity;
      const pb = priceForFilter(b.prices, currentFuelFilter) ?? Infinity;
      return pa - pb;
    });
  }

  // ── Summary bar ────────────────────────────────────────

  function updateSummary(stations) {
    const prices = stations
      .map(s => priceForFilter(s.prices, currentFuelFilter))
      .filter(p => p != null);

    stationCountEl.textContent = stations.length;

    if (prices.length) {
      const min = Math.min(...prices);
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      cheapestPriceEl.textContent = min.toFixed(1) + 'p';
      avgPriceEl.textContent      = avg.toFixed(1) + 'p';
      const label = currentFuelFilter === 'all'
        ? 'unleaded'
        : (FUEL_TYPES[currentFuelFilter]?.label.toLowerCase() || currentFuelFilter);
      cheapestLabelEl.textContent = `cheapest ${label}`;
    } else {
      cheapestPriceEl.textContent = '—';
      avgPriceEl.textContent      = '—';
    }
  }

  // ── Station card builder ───────────────────────────────

  function buildStationCard(station, isCheapest) {
    const card = document.createElement('div');
    card.className = 'station-card' + (isCheapest ? ' is-cheapest' : '');

    const distText = station.distance < 1
      ? Math.round(station.distance * 1000) + ' m'
      : station.distance.toFixed(1) + ' km';

    let pillsHtml = '<div class="station-prices">';
    for (const [key, meta] of Object.entries(FUEL_TYPES)) {
      const price = station.prices[key];
      if (price == null) continue;
      const active = currentFuelFilter === key || currentFuelFilter === 'all';
      pillsHtml += `
        <div class="price-pill${active ? ' active-fuel' : ''}">
          <span class="pill-icon">${meta.icon}</span>
          <span class="pill-label">${meta.label}</span>
          <span class="pill-price">${formatPrice(price)}</span>
        </div>`;
    }
    pillsHtml += '</div>';

    const hoursHtml = station.openingHours
      ? `<div class="station-hours">&#x1F550; ${station.openingHours}</div>`
      : '';

    const badgeHtml = isCheapest
      ? `<span class="cheapest-badge">&#x2B50; Cheapest Nearby</span>`
      : '';

    // Use data attributes instead of inline JS with string escaping
    card.innerHTML = `
      <div class="card-top">
        <div class="station-meta">
          ${badgeHtml}
          <div class="station-name">${station.name}</div>
          <div class="station-brand-tag">${station.brand}</div>
          <div class="station-address">&#x1F4CD; ${station.address}</div>
          ${hoursHtml}
        </div>
        <div class="station-dist">
          <span class="dist-value">${distText}</span>
          <span class="dist-label">away</span>
        </div>
      </div>
      ${pillsHtml}
      <div class="card-actions">
        <button class="btn-directions btn-action"
          data-lat="${station.lat}" data-lon="${station.lon}">
          &#x1F5FA;&#xFE0F; Get Directions
        </button>
        <button class="btn-route-via btn-action"
          data-lat="${station.lat}" data-lon="${station.lon}"
          data-name="${station.name.replace(/"/g, '&quot;')}">
          &#x1F6E3;&#xFE0F; Route Via Here
        </button>
      </div>`;

    return card;
  }

  // ── Render list ────────────────────────────────────────

  function renderStations(stations) {
    const list     = sortedStations(stations);
    const cheapest = findCheapest(stations);

    stationListEl.innerHTML = '';
    updateSummary(stations);

    if (list.length === 0) {
      stationListEl.innerHTML = `
        <div class="no-results">
          <p>No petrol stations found within <strong>${searchRadius} km</strong>.</p>
          <p>Try increasing the search radius using the slider above.</p>
        </div>`;
      return;
    }

    for (const station of list) {
      stationListEl.appendChild(buildStationCard(station, cheapest?.id === station.id));
    }
  }

  // ── Navigation (Google Maps URL — free, no API key) ────

  function openDirections(lat, lon) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
    window.open(url, '_blank');
  }

  function openRoutePlannerFor(lat, lon, name) {
    destinationInput.dataset.waypointLat = lat;
    destinationInput.dataset.waypointLon = lon;
    routeNote.textContent = `📍 Routing via: ${name}`;
    destinationInput.placeholder = 'Enter your final destination…';
    show(routePlanner);
    destinationInput.focus();
  }

  function routeToCheapest() {
    const best = findCheapest(allStations);
    if (!best) return;
    openRoutePlannerFor(best.lat, best.lon, best.name);
  }

  function handlePlanRoute() {
    const dest        = destinationInput.value.trim();
    const waypointLat = destinationInput.dataset.waypointLat;
    const waypointLon = destinationInput.dataset.waypointLon;

    if (!dest && waypointLat) {
      openDirections(waypointLat, waypointLon);
      return;
    }
    if (!dest) {
      destinationInput.focus();
      destinationInput.classList.add('input-error');
      setTimeout(() => destinationInput.classList.remove('input-error'), 1000);
      return;
    }

    let url;
    if (waypointLat && waypointLon) {
      url = `https://www.google.com/maps/dir/?api=1`
          + `&origin=${userLat},${userLon}`
          + `&waypoints=${waypointLat},${waypointLon}`
          + `&destination=${encodeURIComponent(dest)}`
          + `&travelmode=driving`;
    } else {
      const best = findCheapest(allStations);
      if (best) {
        url = `https://www.google.com/maps/dir/?api=1`
            + `&origin=${userLat},${userLon}`
            + `&waypoints=${best.lat},${best.lon}`
            + `&destination=${encodeURIComponent(dest)}`
            + `&travelmode=driving`;
      } else {
        url = `https://www.google.com/maps/dir/?api=1`
            + `&destination=${encodeURIComponent(dest)}`
            + `&travelmode=driving`;
      }
    }
    window.open(url, '_blank');
  }

  function closeRoutePlannerPanel() {
    hide(routePlanner);
    destinationInput.value = '';
    routeNote.textContent  = '';
    delete destinationInput.dataset.waypointLat;
    delete destinationInput.dataset.waypointLon;
    destinationInput.placeholder = 'e.g. London Bridge, Manchester City Centre…';
  }

  // ── Main search flow ───────────────────────────────────

  async function findFuelStations() {
    hide(errorBox);
    hide(resultsSection);
    hide(summaryBar);
    hide(routePlanner);
    show(spinner);
    findBtn.disabled = true;
    locationStatus.textContent = 'Detecting your location…';
    loadingText.textContent    = 'Detecting your location…';

    // Step 1: Geolocation (browser built-in, no API needed)
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
        })
      );
      userLat = pos.coords.latitude;
      userLon = pos.coords.longitude;
      locationStatus.textContent = `${userLat.toFixed(4)}°, ${userLon.toFixed(4)}°`;
    } catch (err) {
      findBtn.disabled = false;
      const msgs = {
        1: 'Location access denied. Please allow location in your browser settings.',
        2: 'Location unavailable. Check your connection and try again.',
        3: 'Location request timed out. Please try again.',
      };
      showError(msgs[err.code] || 'Could not get your location.');
      locationStatus.textContent = '';
      return;
    }

    // Step 2: Overpass API (free, no key)
    loadingText.textContent = `Searching for petrol stations within ${searchRadius} km…`;
    try {
      const elements = await fetchNearbyStations(userLat, userLon, searchRadius);
      allStations    = processStations(elements);
    } catch (err) {
      showError('Could not fetch station data: ' + (err.message || 'Unknown error'));
      hide(spinner);
      findBtn.disabled = false;
      return;
    }

    // Step 3: Render
    hide(spinner);
    show(searchControls);
    show(summaryBar);
    show(resultsSection);
    findBtn.disabled = false;
    renderStations(allStations);
  }

  async function refreshStations() {
    if (!userLat || !userLon) return;
    hide(resultsSection);
    hide(summaryBar);
    hide(errorBox);
    show(spinner);
    loadingText.textContent = `Searching within ${searchRadius} km…`;

    try {
      const elements = await fetchNearbyStations(userLat, userLon, searchRadius);
      allStations    = processStations(elements);
      hide(spinner);
      show(summaryBar);
      show(resultsSection);
      renderStations(allStations);
    } catch (err) {
      showError('Refresh failed: ' + (err.message || 'Unknown error'));
    }
  }

  // ── Event listeners ────────────────────────────────────

  findBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showError('Geolocation is not supported by your browser.');
      return;
    }
    findFuelStations();
  });

  refreshBtn.addEventListener('click', refreshStations);

  radiusSlider.addEventListener('input', () => {
    searchRadius = parseInt(radiusSlider.value, 10);
    radiusLabel.textContent = searchRadius;
  });
  radiusSlider.addEventListener('change', () => {
    if (userLat != null) refreshStations();
  });

  fuelFilterButtons.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFuelFilter = btn.dataset.fuel;
    if (allStations.length) renderStations(allStations);
  });

  sortSelect.addEventListener('change', () => {
    currentSort = sortSelect.value;
    if (allStations.length) renderStations(allStations);
  });

  routeCheapestBtn.addEventListener('click', routeToCheapest);
  planRouteBtn.addEventListener('click', handlePlanRoute);
  closeRoutePlannerBtn.addEventListener('click', closeRoutePlannerPanel);
  destinationInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') handlePlanRoute();
  });

  // Delegate card button clicks (directions / route-via)
  // Using event delegation avoids any inline onclick issues
  stationListEl.addEventListener('click', e => {
    const btn = e.target.closest('.btn-action');
    if (!btn) return;
    const lat  = parseFloat(btn.dataset.lat);
    const lon  = parseFloat(btn.dataset.lon);
    const name = btn.dataset.name || '';

    if (btn.classList.contains('btn-directions')) {
      openDirections(lat, lon);
    } else if (btn.classList.contains('btn-route-via')) {
      openRoutePlannerFor(lat, lon, name);
    }
  });

}); // end DOMContentLoaded
