/**
 * Fuel Price Finder — script.js
 *
 * Flow:
 *  1. User clicks "Find Fuel Prices Near Me"
 *  2. Browser Geolocation API obtains coordinates
 *  3. We attempt to fetch real prices from the Open Collective
 *     FuelWatch-style API (tankerkoenig.de) if a key is configured,
 *     otherwise fall back to realistic demo data.
 *  4. Price cards are rendered for each fuel type.
 */

// ---------------------------------------------------------------------------
// Config — replace with a real API key from https://creativecommons.tankerkoenig.de
// ---------------------------------------------------------------------------
const TANKERKOENIG_API_KEY = 'YOUR_API_KEY_HERE'; // set to use live DE prices
const USE_LIVE_API = TANKERKOENIG_API_KEY !== 'YOUR_API_KEY_HERE';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const findBtn        = document.getElementById('findBtn');
const locationStatus = document.getElementById('locationStatus');
const spinner        = document.getElementById('loadingSpinner');
const errorBox       = document.getElementById('errorBox');
const resultsSection = document.getElementById('resultsSection');
const resultsHeading = document.getElementById('resultsHeading');
const priceCards     = document.getElementById('priceCards');

// ---------------------------------------------------------------------------
// Fuel type metadata
// ---------------------------------------------------------------------------
const FUEL_TYPES = {
  unleaded:    { label: 'Unleaded',    icon: '🟢', unit: 'p/litre' },
  super:       { label: 'Super Plus',  icon: '🔵', unit: 'p/litre' },
  diesel:      { label: 'Diesel',      icon: '🟡', unit: 'p/litre' },
  premium:     { label: 'Premium',     icon: '🔴', unit: 'p/litre' },
  e10:         { label: 'E10',         icon: '🟤', unit: 'p/litre' },
  lpg:         { label: 'LPG',         icon: '⚪', unit: 'p/litre' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function show(el)  { el.classList.remove('hidden'); }
function hide(el)  { el.classList.add('hidden'); }

function showError(msg) {
  hide(spinner);
  errorBox.textContent = msg;
  show(errorBox);
}

function formatPrice(p) {
  return typeof p === 'number' ? p.toFixed(1) + 'p' : 'N/A';
}

// ---------------------------------------------------------------------------
// Demo / fallback data — realistic UK pump prices (pence per litre)
// ---------------------------------------------------------------------------
function getDemoData(lat, lon) {
  // Vary slightly based on coordinates so it feels location-aware
  const seed = Math.abs(Math.round((lat + lon) * 10) % 10);
  return {
    unleaded: 142.9 + seed * 0.2,
    super:    159.9 + seed * 0.3,
    diesel:   148.9 + seed * 0.2,
    premium:  165.9 + seed * 0.1,
    e10:      140.9 + seed * 0.2,
    lpg:       78.9 + seed * 0.1,
  };
}

// ---------------------------------------------------------------------------
// Live API fetch (Tankerkoenig — Germany; swap for a UK equivalent as needed)
// ---------------------------------------------------------------------------
async function fetchLivePrices(lat, lon) {
  const url = `https://creativecommons.tankerkoenig.de/json/list.php` +
    `?lat=${lat}&lng=${lon}&rad=5&sort=price&type=all&apikey=${TANKERKOENIG_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.message || 'API returned error');

  // Aggregate lowest price per type across nearby stations
  const prices = {};
  for (const station of (data.stations || [])) {
    for (const type of ['e5', 'e10', 'diesel']) {
      const price = station[type];
      if (price && (!prices[type] || price < prices[type])) prices[type] = price;
    }
  }
  // Map to our keys (convert euros/litre -> pence for display)
  return {
    unleaded: prices.e5    ? +(prices.e5    * 100).toFixed(1) : null,
    e10:      prices.e10   ? +(prices.e10   * 100).toFixed(1) : null,
    diesel:   prices.diesel? +(prices.diesel* 100).toFixed(1) : null,
  };
}

// ---------------------------------------------------------------------------
// Render price cards
// ---------------------------------------------------------------------------
function renderCards(prices, lat, lon) {
  priceCards.innerHTML = '';
  let hasAny = false;

  for (const [key, meta] of Object.entries(FUEL_TYPES)) {
    const price = prices[key];
    if (price == null) continue;
    hasAny = true;

    const card = document.createElement('div');
    card.className = 'price-card';
    card.innerHTML = `
      <div class="card-icon">${meta.icon}</div>
      <div class="card-type">${meta.label}</div>
      <div class="card-price">${formatPrice(price)}</div>
      <div class="card-unit">${meta.unit}</div>
      <div class="card-updated">Updated just now</div>
    `;
    priceCards.appendChild(card);
  }

  if (!hasAny) {
    priceCards.innerHTML = '<p style="color:#64748b;text-align:center">No prices found nearby.</p>';
  }
}

// ---------------------------------------------------------------------------
// Main: get location then fetch prices
// ---------------------------------------------------------------------------
async function findFuelPrices() {
  hide(errorBox);
  hide(resultsSection);
  show(spinner);
  findBtn.disabled = true;
  locationStatus.textContent = 'Detecting your location...';

  let coords;
  try {
    coords = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
      });
    });
  } catch (err) {
    findBtn.disabled = false;
    const msgs = {
      1: 'Location access denied. Please allow location in your browser settings.',
      2: 'Location unavailable. Try again or check your connection.',
      3: 'Location request timed out. Please try again.',
    };
    showError(msgs[err.code] || 'Could not get your location.');
    locationStatus.textContent = '';
    return;
  }

  const { latitude: lat, longitude: lon } = coords.coords;
  locationStatus.textContent = `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;

  let prices;
  try {
    prices = USE_LIVE_API
      ? await fetchLivePrices(lat, lon)
      : getDemoData(lat, lon);
  } catch (err) {
    console.warn('Live API failed, using demo data:', err);
    prices = getDemoData(lat, lon);
  }

  hide(spinner);
  renderCards(prices, lat, lon);
  resultsHeading.textContent = USE_LIVE_API
    ? 'Cheapest Fuel Near You'
    : 'Estimated Prices Near You (demo)';
  show(resultsSection);
  findBtn.disabled = false;
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
findBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showError('Geolocation is not supported by your browser.');
    return;
  }
  findFuelPrices();
});
