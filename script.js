/**
 * Fuel Price Finder — script.js (Enhanced)
 *
 * Features:
 *  • Real petrol-station locations via OpenStreetMap Overpass API
 *  • Realistic estimated prices per brand (UK pence / litre)
 *  • Adjustable search radius (1–25 km)
 *  • Fuel-type filter: All / Unleaded / Premium / Diesel / E10 / Super Plus / LPG
 *  • Sort by cheapest price OR nearest first
 *  • Per-station "Get Directions" (Google Maps)
 *  • "Route Via Here" — open Google Maps routing through a chosen station
 *  • "Route to Cheapest" — one-click route to the cheapest station
 *  • Full route planner: origin → cheapest/chosen station → custom destination
 */

// ─────────────────────────────────────────────
// App state
// ─────────────────────────────────────────────
let userLat          = null;
let userLon          = null;
let allStations      = [];
let currentFuelFilter = 'all';
let currentSort      = 'price';
let searchRadius     = 5;    // km

// ─────────────────────────────────────────────
// DOM references
// ─────────────────────────────────────────────
const findBtn           = document.getElementById('findBtn');
const refreshBtn        = document.getElementById('refreshBtn');
const locationStatus    = document.getElementById('locationStatus');
const spinner           = document.getElementById('loadingSpinner');
const loadingText       = document.getElementById('loadingText');
const errorBox          = document.getElementById('errorBox');
const resultsSection    = document.getElementById('resultsSection');
const stationList       = document.getElementById('stationList');
const searchControls    = document.getElementById('searchControls');
const radiusSlider      = document.getElementById('radiusSlider');
const radiusLabel       = document.getElementById('radiusLabel');
const fuelFilterButtons = document.getElementById('fuelFilterButtons');
const sortSelect        = document.getElementById('sortSelect');
const summaryBar        = document.getElementById('summaryBar');
const stationCount      = document.getElementById('stationCount');
const cheapestPriceEl   = document.getElementById('cheapestPrice');
const cheapestLabelEl   = document.getElementById('cheapestLabel');
const avgPriceEl        = document.getElementById('avgPrice');
const routeCheapestBtn  = document.getElementById('routeCheapestBtn');
const routePlanner      = document.getElementById('routePlanner');
const destinationInput  = document.getElementById('destinationInput');
const planRouteBtn      = document.getElementById('planRouteBtn');
const closeRoutePlannerBtn = document.getElementById('closeRoutePlanner');
const routeNote         = document.getElementById('routeNote');

// ─────────────────────────────────────────────
// Fuel-type metadata
// ─────────────────────────────────────────────
const FUEL_TYPES = {
  unleaded: { label: 'Unleaded',   icon: '🟢', unit: 'p/L' },
  premium:  { label: 'Premium',    icon: '🔴', unit: 'p/L' },
  diesel:   { label: 'Diesel',     icon: '🟡', unit: 'p/L' },
  e10:      { label: 'E10',        icon: '🟤', unit: 'p/L' },
  super:    { label: 'Super Plus', icon: '🔵', unit: 'p/L' },
  lpg:      { label: 'LPG',        icon: '⚪', unit: 'p/L' },
};

// ─────────────────────────────────────────────
// Brand price premiums (pence vs. base price)
// ─────────────────────────────────────────────
const BRAND_DATA = {
  'Tesco':        { delta: -3.5, hasPremium: false, hasSuper: false, hasLpg: false },
  'Asda':         { delta: -4.0, hasPremium: false, hasSuper: false, hasLpg: false },
  "Sainsbury's":  { delta: -3.0, hasPremium: false, hasSuper: false, hasLpg: false },
  'Morrisons':    { delta: -2.5, hasPremium: false, hasSuper: false, hasLpg: false },
  'Aldi':         { delta: -4.5, hasPremium: false, hasSuper: false, hasLpg: false },
  'Costco':       { delta: -5.0, hasPremium: false, hasSuper: false, hasLpg: false },
  'BP':           { delta: +2.5, hasPremium: true,  hasSuper: true,  hasLpg: true  },
  'Shell':        { delta: +3.0, hasPremium: true,  hasSuper: true,  hasLpg: false },
  'Esso':         { delta: +1.5, hasPremium: true,  hasSuper: false, hasLpg: false },
  'Texaco':       { delta: +0.5, hasPremium: true,  hasSuper: false, hasLpg: false },
  'Jet':          { delta: -1.5, hasPremium: false, hasSuper: false, hasLpg: false },
  'Gulf':         { delta: -1.0, hasPremium: false, hasSuper: false, hasLpg: false },
  'Murco':        { delta: -0.5, hasPremium: false, hasSuper: false, hasLpg: false },
  'Total':        { delta: +1.0, hasPremium: true,  hasSuper: false, hasLpg: false },
  'Independent':  { delta:  0.0, hasPremium: false, hasSuper: false, hasLpg: false },
};

// Base UK pump prices (pence / litre) — approximate national average
const BASE_PRICES = {
  unleaded:  143.9,
  premium:   161.9,
  diesel:    148.9,
  e10:       140.9,
  super:     167.9,
  lpg:        80.9,
};

// ─────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');

function showError(msg) {
  hide(spinner);
  errorBox.textContent = msg;
  show(errorBox);
}

function formatPrice(p) {
  return typeof p === 'number' ? p.toFixed(1) + 'p' : 'N/A';
}

/** Haversine distance in km between two lat/lon pairs. */
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

// ─────────────────────────────────────────────
// Price generation
// ─────────────────────────────────────────────
function generatePrices(brand, lat, lon) {
  const bd      = BRAND_DATA[brand] || BRAND_DATA['Independent'];
  const seed    = Math.abs(Math.round(lat * 1000 + lon * 777));
  const jitter  = (seededRand(seed) - 0.5) * 3;   // ±1.5p station variance

  const p = {};

  p.unleaded = +(BASE_PRICES.unleaded + bd.delta + jitter + (seededRand(seed + 1) - 0.5)).toFixed(1);
  p.diesel   = +(BASE_PRICES.diesel   + bd.delta + jitter + (seededRand(seed + 2) - 0.5)).toFixed(1);
  p.e10      = +(BASE_PRICES.e10      + bd.delta + jitter + (seededRand(seed + 3) - 0.5)).toFixed(1);

  if (bd.hasPremium || seededRand(seed + 4) > 0.45) {
    p.premium = +(BASE_PRICES.premium + bd.delta + jitter + (seededRand(seed + 5) - 0.5)).toFixed(1);
  }
  if (bd.hasSuper || seededRand(seed + 6) > 0.65) {
    p.super = +(BASE_PRICES.super + bd.delta + jitter + (seededRand(seed + 7) - 0.5)).toFixed(1);
  }
  if (bd.hasLpg || seededRand(seed + 8) > 0.88) {
    p.lpg = +(BASE_PRICES.lpg + (seededRand(seed + 9) - 0.5) * 2).toFixed(1);
  }

  return p;
}

// ─────────────────────────────────────────────
// Brand detection from OSM tags
// ─────────────────────────────────────────────
function detectBrand(tags) {
  const raw = (tags.brand || tags.operator || tags.name || '').toLowerCase();
  for (const b of Object.keys(BRAND_DATA)) {
    if (b !== 'Independent' && raw.includes(b.toLowerCase())) return b;
  }
  return tags.brand || tags.operator || 'Independent';
}

// ─────────────────────────────────────────────
// Get the relevant price for the active filter
// ─────────────────────────────────────────────
function priceForFilter(prices, filter) {
  if (filter === 'all') {
    return prices.unleaded ?? prices.diesel ?? prices.e10 ?? null;
  }
  return prices[filter] ?? null;
}

// ─────────────────────────────────────────────
// Overpass API — fetch nearby petrol stations
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Process raw OSM elements → station objects
// ─────────────────────────────────────────────
function processStations(elements) {
  return elements
    .map(el => {
      const lat  = el.lat ?? el.center?.lat;
      const lon  = el.lon ?? el.center?.lon;
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

// ─────────────────────────────────────────────
// Find cheapest station for the active filter
// ─────────────────────────────────────────────
function findCheapest(stations) {
  let best = null, bestPrice = Infinity;
  for (const s of stations) {
    const p = priceForFilter(s.prices, currentFuelFilter);
    if (p != null && p < bestPrice) { bestPrice = p; best = s; }
  }
  return best;
}

// ─────────────────────────────────────────────
// Sort stations
// ─────────────────────────────────────────────
function sorted(stations) {
  return [...stations].sort((a, b) => {
    if (currentSort === 'distance') return a.distance - b.distance;
    const pa = priceForFilter(a.prices, currentFuelFilter) ?? Infinity;
    const pb = priceForFilter(b.prices, currentFuelFilter) ?? Infinity;
    return pa - pb;
  });
}

// ─────────────────────────────────────────────
// Update summary bar
// ─────────────────────────────────────────────
function updateSummary(stations) {
  const prices = stations
    .map(s => priceForFilter(s.prices, currentFuelFilter))
    .filter(p => p != null);

  stationCount.textContent = stations.length;

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

// ─────────────────────────────────────────────
// Render station list
// ─────────────────────────────────────────────
function renderStations(stations) {
  const list    = sorted(stations);
  const cheapest = findCheapest(stations);

  stationList.innerHTML = '';
  updateSummary(stations);

  if (list.length === 0) {
    stationList.innerHTML = `
      <div class="no-results">
        <p>No petrol stations found within <strong>${searchRadius} km</strong>.</p>
        <p>Try increasing the search radius using the slider above.</p>
      </div>`;
    return;
  }

  for (const station of list) {
    stationList.appendChild(buildStationCard(station, cheapest?.id === station.id));
  }
}

// ─────────────────────────────────────────────
// Build a single station card element
// ─────────────────────────────────────────────
function buildStationCard(station, isCheapest) {
  const card = document.createElement('div');
  card.className = 'station-card' + (isCheapest ? ' is-cheapest' : '');

  const distText = station.distance < 1
    ? Math.round(station.distance * 1000) + ' m'
    : station.distance.toFixed(1) + ' km';

  // Build price pills
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

  // Escape single quotes for inline onclick
  const safeName = station.name.replace(/'/g, "\\'");

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
      <button
        class="btn-directions"
        onclick="openDirections(${station.lat}, ${station.lon})">
        &#x1F5FA;&#xFE0F; Get Directions
      </button>
      <button
        class="btn-route-via"
        onclick="openRoutePlannerFor(${station.lat}, ${station.lon}, '${safeName}')">
        &#x1F6E3;&#xFE0F; Route Via Here
      </button>
    </div>`;

  return card;
}

// ─────────────────────────────────────────────
// Navigation helpers (exposed globally for inline onclick)
// ─────────────────────────────────────────────

/** Open Google Maps driving directions straight to a station. */
window.openDirections = function(lat, lon) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
  window.open(url, '_blank');
};

/** Pre-fill the route planner with this station as a waypoint. */
window.openRoutePlannerFor = function(lat, lon, name) {
  destinationInput.dataset.waypointLat = lat;
  destinationInput.dataset.waypointLon = lon;
  routeNote.textContent = `📍 Routing via: ${name}`;
  destinationInput.placeholder = 'Enter your final destination…';
  show(routePlanner);
  destinationInput.focus();
};

// ─────────────────────────────────────────────
// Route to cheapest station
// ─────────────────────────────────────────────
function routeToCheapest() {
  const best = findCheapest(allStations);
  if (!best) return;
  // Open route planner pre-filled with cheapest as waypoint
  window.openRoutePlannerFor(best.lat, best.lon, best.name);
}

// ─────────────────────────────────────────────
// Handle "Open in Maps" button in route planner
// ─────────────────────────────────────────────
function handlePlanRoute() {
  const dest        = destinationInput.value.trim();
  const waypointLat = destinationInput.dataset.waypointLat;
  const waypointLon = destinationInput.dataset.waypointLon;

  // If no destination entered, just go directly to the station
  if (!dest && waypointLat) {
    window.openDirections(waypointLat, waypointLon);
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
    // origin → petrol station → final destination
    url = `https://www.google.com/maps/dir/?api=1`
        + `&origin=${userLat},${userLon}`
        + `&waypoints=${waypointLat},${waypointLon}`
        + `&destination=${encodeURIComponent(dest)}`
        + `&travelmode=driving`;
  } else {
    // Find cheapest and route via it
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
}

// ─────────────────────────────────────────────
// Main search flow
// ─────────────────────────────────────────────
async function findFuelStations() {
  hide(errorBox);
  hide(resultsSection);
  hide(summaryBar);
  hide(routePlanner);
  show(spinner);
  findBtn.disabled = true;
  locationStatus.textContent = 'Detecting your location…';
  loadingText.textContent    = 'Detecting your location…';

  // 1. Get geolocation
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

  // 2. Fetch stations
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

  // 3. Render
  hide(spinner);
  show(searchControls);
  show(summaryBar);
  show(resultsSection);
  findBtn.disabled = false;
  renderStations(allStations);
}

// ─────────────────────────────────────────────
// Refresh (re-query with current radius)
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Event listeners
// ─────────────────────────────────────────────
findBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showError('Geolocation is not supported by your browser.');
    return;
  }
  findFuelStations();
});

refreshBtn.addEventListener('click', refreshStations);

// Radius slider — update label live, re-fetch on release
radiusSlider.addEventListener('input', () => {
  searchRadius = parseInt(radiusSlider.value, 10);
  radiusLabel.textContent = searchRadius;
});
radiusSlider.addEventListener('change', () => {
  if (userLat != null) refreshStations();
});

// Fuel type filter buttons
fuelFilterButtons.addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFuelFilter = btn.dataset.fuel;
  if (allStations.length) renderStations(allStations);
});

// Sort select
sortSelect.addEventListener('change', () => {
  currentSort = sortSelect.value;
  if (allStations.length) renderStations(allStations);
});

// Summary bar "Route to Cheapest"
routeCheapestBtn.addEventListener('click', routeToCheapest);

// Route planner
planRouteBtn.addEventListener('click', handlePlanRoute);
closeRoutePlannerBtn.addEventListener('click', closeRoutePlannerPanel);
destinationInput.addEventListener('keypress', e => {
  if (e.key === 'Enter') handlePlanRoute();
});
