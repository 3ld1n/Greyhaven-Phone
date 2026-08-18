/*
 * Greyhaven Phone Life Assets v2.4.0
 *
 * Shared, persistent world-state layer for:
 * - vehicles / garage / sales / rentals / repairs
 * - properties / ownership / tenants / agencies / sales / long-term rentals
 * - phone identity / phone-record management outside the phone UI
 *
 * Design rule: authoritative state changes only after an explicit user action.
 * AI refreshes may DISCOVER a new asset/listing, but the discovered asset is
 * immediately persisted so a listing can never exist without an owner record.
 */

const GHLA_MODULE = 'greyhaven-phone-life-assets';
const GHLA_VERSION = '2.7.1';
const GHLA_SETTINGS_KEY = 'greyhavenPhoneLifeAssets';
const PHONE_SETTINGS_KEY = 'greyhavenPhone';
const PHONE_META_KEY = 'greyhavenPhone';

let initialized = false;
let uiObserver = null;
let reminderTimer = null;
let lifeOpen = false;
let lifeView = { app: 'home', tab: '', detailId: '' };
let vehicleRefreshBusy = false;
let propertyRefreshBusy = false;

const qs = (sel, root = document) => root?.querySelector?.(sel) || null;
const qsa = (sel, root = document) => [...(root?.querySelectorAll?.(sel) || [])];
const norm = v => String(v ?? '').trim().replace(/\s+/g, ' ');
const lc = v => norm(v).toLowerCase();
const esc = v => String(v ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function uid(prefix = 'ghla') {
  try { return `${prefix}:${crypto.randomUUID()}`; }
  catch { return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`; }
}

function clone(value) {
  if (value == null) return value;
  try { return structuredClone(value); }
  catch { return JSON.parse(JSON.stringify(value)); }
}

function ctx() {
  try { return globalThis.SillyTavern?.getContext?.() || null; }
  catch { return null; }
}

function phoneApi() {
  return globalThis.GreyhavenPhone || null;
}

function rpNow() {
  try {
    const d = globalThis.GreyhavenLife?.getTime?.();
    if (d) {
      const x = new Date(d);
      if (!Number.isNaN(x.getTime())) return x;
    }
  } catch {}
  return new Date();
}

function saveSettings() {
  try { ctx()?.saveSettingsDebounced?.(); }
  catch (error) { console.warn(`[${GHLA_MODULE}] save settings`, error); }
}

function state() {
  const c = ctx();
  if (!c?.extensionSettings) return null;

  if (!c.extensionSettings[GHLA_SETTINGS_KEY] || typeof c.extensionSettings[GHLA_SETTINGS_KEY] !== 'object') {
    c.extensionSettings[GHLA_SETTINGS_KEY] = {};
  }

  const s = c.extensionSettings[GHLA_SETTINGS_KEY];
  s.version = Math.max(1, Number(s.version || 1));

  for (const key of ['vehicles', 'properties', 'vehicleListings', 'propertyListings', 'vehicleRentals', 'serviceRequests']) {
    if (!s[key] || typeof s[key] !== 'object' || Array.isArray(s[key])) s[key] = {};
  }

  if (!Array.isArray(s.mechanics)) s.mechanics = [];
  if (!Array.isArray(s.agencies)) s.agencies = [];
  if (!Array.isArray(s.transactions)) s.transactions = [];
  if (!s.market || typeof s.market !== 'object') s.market = {};
  if (!s.market.vehicleRefresh || typeof s.market.vehicleRefresh !== 'object') s.market.vehicleRefresh = { lastAt: 0, city: 'Greyhaven', type: 'all', mode: 'all' };
  if (!['all', 'sale', 'rent'].includes(s.market.vehicleRefresh.mode)) s.market.vehicleRefresh.mode = 'all';
  if (!s.market.propertyRefresh || typeof s.market.propertyRefresh !== 'object') s.market.propertyRefresh = { lastAt: 0, city: 'Greyhaven', type: 'all', mode: 'all' };
  if (!s.favorites || typeof s.favorites !== 'object' || Array.isArray(s.favorites)) s.favorites = {};
  if (!s.favorites.vehicles || typeof s.favorites.vehicles !== 'object' || Array.isArray(s.favorites.vehicles)) s.favorites.vehicles = {};
  if (!s.favorites.properties || typeof s.favorites.properties !== 'object' || Array.isArray(s.favorites.properties)) s.favorites.properties = {};
  if (!s.defaultWorldSeeds || typeof s.defaultWorldSeeds !== 'object' || Array.isArray(s.defaultWorldSeeds)) s.defaultWorldSeeds = {};

  return s;
}

function identities() {
  const api = phoneApi();
  const rows = api?.listIdentities?.();
  if (Array.isArray(rows) && rows.length) {
    const activeIds = activeCharacterIdentityIds();
    const currentId = api?.getCurrentIdentity?.()?.id || '';
    return rows
      .filter(x =>
        x &&
        x.id &&
        x.kind !== 'provisional' &&
        (activeIds.size === 0 || activeIds.has(String(x.id)) || String(x.id) === String(currentId))
      )
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  const c = ctx();
  return (c?.characters || []).map((ch, index) => ({
    id: `character:${encodeURIComponent(ch?.avatar || ch?.name || index)}`,
    kind: 'character',
    name: norm(ch?.name || `Character ${index + 1}`),
    avatar: ch?.avatar || '',
    phoneNumber: '',
  }));
}

function identityById(identityId) {
  if (!identityId) return null;
  const direct = phoneApi()?.getIdentityById?.(identityId);
  if (direct) return direct;
  return identities().find(x => String(x.id) === String(identityId)) || null;
}

function identityByName(name) {
  const apiHit = phoneApi()?.getIdentityByName?.(name);
  if (apiHit) return apiHit;
  return identities().find(x => lc(x.name) === lc(name)) || null;
}

function currentIdentity() {
  return phoneApi()?.getCurrentIdentity?.() || phoneApi()?.getIdentityByName?.(ctx()?.name1 || '') || null;
}

function characterSummary(identity) {
  const c = ctx();
  const ch = (c?.characters || []).find(x => lc(x?.name) === lc(identity?.name));
  if (!ch) return { name: identity?.name || '', description: '' };

  const raw = String(ch.description || ch.data?.description || ch.personality || ch.data?.personality || '');
  return { name: identity.name, description: raw.replace(/\s+/g, ' ').slice(0, 420) };
}

function avatarUrl(identity) {
  if (!identity?.avatar) return '';
  try { return ctx()?.getThumbnailUrl?.('avatar', identity.avatar) || identity.avatar; }
  catch { return identity.avatar; }
}

function identityOptions(selected = '', includeNone = true) {
  const opts = identities().map(x =>
    `<option value="${esc(x.id)}"${String(x.id) === String(selected) ? ' selected' : ''}>${esc(x.name)}</option>`
  ).join('');

  return `${includeNone ? '<option value="">— Select character —</option>' : ''}${opts}`;
}

function ownerRefIdentity(identity) {
  return identity ? { kind: 'identity', identityId: identity.id, name: identity.name } : null;
}

function ownerName(owner) {
  if (!owner) return 'Unknown owner';
  if (owner.kind === 'identity') return identityById(owner.identityId)?.name || owner.name || 'Character';
  if (owner.kind === 'npc') return owner.name || 'Seller';
  if (owner.kind === 'external') {
    const rel = owner.relation || 'other';
    const labels = { parents: 'Parents', friend: 'Friend', relationship: 'Relationship', other: 'Other', untracked: 'Untracked owner' };
    return owner.label || labels[rel] || 'External owner';
  }
  return owner.name || 'Owner';
}

function isOwner(asset, identityId) {
  return asset?.owner?.kind === 'identity' && String(asset.owner.identityId) === String(identityId);
}

function exactIdentityNames(csv = '') {
  const tokens = String(csv).split(',').map(norm).filter(Boolean);
  const rows = [];
  for (const token of tokens) {
    const who = identities().find(x => lc(x.name) === lc(token));
    if (who && !rows.some(x => x.identityId === who.id)) {
      rows.push({ kind: 'identity', identityId: who.id, name: who.name });
    }
  }
  return rows;
}

function euro(value) {
  const n = Number(String(value ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function money(value) {
  return `€${Math.max(0, Math.round(Number(value) || 0)).toLocaleString()}`;
}

function propertyEqualRentPayers(property) {
  const tracked = Array.isArray(property?.tenants) ? property.tenants.length : 0;
  const untracked = property?.rentSplit === 'equal'
    ? Math.max(0, Number(property?.untrackedHousemates || 0))
    : 0;
  return Math.max(1, tracked + untracked);
}

function propertyTenantRentShare(property, tenant = null) {
  const total = Math.max(0, Number(property?.monthlyRent || 0));
  if (!total) return 0;
  if (property?.rentSplit === 'equal') return total / propertyEqualRentPayers(property);
  if (property?.rentSplit === 'custom') return Math.max(0, Number(tenant?.monthlyRent || 0));
  if ((property?.tenants || []).length <= 1) return total;
  return 0;
}

function syncPropertyRentShares(property) {
  if (!property || !Array.isArray(property.tenants)) return property;
  if (property.rentSplit === 'equal') {
    const share = propertyTenantRentShare(property);
    for (const tenant of property.tenants) {
      tenant.monthlyRent = share;
      tenant.splitMode = 'equal';
    }
  } else if (property.rentSplit === 'none' && property.tenants.length === 1) {
    property.tenants[0].monthlyRent = Math.max(0, Number(property.monthlyRent || 0));
    property.tenants[0].splitMode = 'none';
  }
  return property;
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) n = min;
  return Math.max(min, Math.min(max, n));
}

/* ---------------- realistic pricing ---------------- */

function vehicleSaleBounds(type = 'car', year = new Date().getFullYear(), condition = 'good') {
  const base = {
    car: [3500, 180000],
    motorcycle: [1200, 35000],
    boat: [8000, 450000],
    airplane: [90000, 8000000],
  }[type] || [3000, 150000];

  const age = Math.max(0, new Date().getFullYear() - Number(year || new Date().getFullYear()));
  let ageFactor = Math.max(0.35, 1 - Math.min(age, 25) * 0.025);
  if (condition === 'excellent') ageFactor *= 1.12;
  if (condition === 'fair') ageFactor *= 0.82;
  if (condition === 'poor') ageFactor *= 0.58;

  return [Math.round(base[0] * Math.max(0.55, ageFactor)), Math.round(base[1] * Math.max(0.58, ageFactor))];
}

function vehicleRentalBounds(type = 'car') {
  return {
    car: [25, 350],
    motorcycle: [18, 150],
    boat: [120, 3500],
    airplane: [650, 18000],
  }[type] || [25, 300];
}

function propertyUnitBounds(type = 'apartment', mode = 'sale') {
  if (mode === 'rent') {
    return {
      apartment: [7, 26],
      house: [6, 22],
      villa: [9, 38],
      land: [0.5, 5],
      business: [9, 34],
    }[type] || [7, 25];
  }

  return {
    apartment: [1200, 4800],
    house: [1000, 4200],
    villa: [1700, 7600],
    land: [70, 1200],
    business: [1300, 6500],
  }[type] || [1200, 4500];
}

function realisticVehiclePrice(row) {
  if (row.mode === 'rent') {
    const [min, max] = vehicleRentalBounds(row.type);
    return clamp(euro(row.dailyRate || row.price), min, max);
  }
  const [min, max] = vehicleSaleBounds(row.type, row.year, row.condition);
  return clamp(euro(row.price), min, max);
}

function realisticPropertyPrice(row) {
  const size = clamp(Number(row.sizeSqm || 70), 15, row.type === 'land' ? 20000 : 3000);
  const mode = row.mode === 'rent' ? 'rent' : 'sale';
  const [unitMin, unitMax] = propertyUnitBounds(row.type, mode);
  const raw = euro(mode === 'rent' ? row.monthlyRent || row.price : row.price);

  if (mode === 'rent') {
    const min = Math.max(180, Math.round(size * unitMin));
    const max = Math.max(min + 50, Math.round(size * unitMax));
    return clamp(raw, min, max);
  }

  const min = Math.max(8000, Math.round(size * unitMin));
  const max = Math.max(min + 1000, Math.round(size * unitMax));
  return clamp(raw, min, max);
}

/* ---------------- data normalization ---------------- */

function normalizeVehicle(v = {}) {
  const row = { ...v };
  row.id = String(row.id || uid('vehicle'));
  row.type = ['car', 'motorcycle', 'boat', 'airplane'].includes(row.type) ? row.type : 'car';
  row.make = norm(row.make);
  row.model = norm(row.model);
  row.year = clamp(Number(row.year || new Date().getFullYear()), 1950, new Date().getFullYear() + 2);
  row.color = norm(row.color);
  row.plate = norm(row.plate);
  row.mileage = Math.max(0, Number(row.mileage || 0));
  row.condition = ['excellent', 'good', 'fair', 'poor', 'damaged'].includes(row.condition) ? row.condition : 'good';
  row.notes = String(row.notes || '').trim();
  row.owner = row.owner || { kind: 'external', relation: 'other', label: '' };
  row.createdAt = Number(row.createdAt || Date.now());
  row.updatedAt = Number(row.updatedAt || Date.now());
  row.status = ['active', 'sold', 'retired'].includes(row.status) ? row.status : 'active';
  return row;
}

function normalizeProperty(p = {}) {
  const row = { ...p };
  row.id = String(row.id || uid('property'));
  row.type = ['house', 'apartment', 'villa', 'land', 'business'].includes(row.type) ? row.type : 'apartment';
  row.name = norm(row.name || `${row.type[0].toUpperCase()}${row.type.slice(1)}`);
  row.city = norm(row.city || 'Greyhaven');
  row.area = norm(row.area);
  row.address = norm(row.address);
  row.sizeSqm = Math.max(0, Number(row.sizeSqm || 0));
  row.rooms = Math.max(0, Number(row.rooms || 0));
  row.bedrooms = Math.max(0, Number(row.bedrooms || 0));
  row.bathrooms = Math.max(0, Number(row.bathrooms || 0));
  row.description = String(row.description || '').trim();
  row.owner = row.owner || { kind: 'external', relation: 'untracked', label: '' };
  row.tenants = Array.isArray(row.tenants) ? row.tenants.filter(Boolean) : [];
  row.occupants = Array.isArray(row.occupants) ? row.occupants.filter(Boolean) : [];
  row.untrackedHousemates = Math.max(0, Number(row.untrackedHousemates || 0));
  row.monthlyRent = Math.max(0, Number(row.monthlyRent || 0));
  row.rentSplit = ['none', 'equal', 'custom'].includes(row.rentSplit) ? row.rentSplit : 'none';
  row.shortTermEligible = row.shortTermEligible === true;
  row.longTermRentable = row.longTermRentable !== false;
  row.status = ['active', 'sold', 'inactive'].includes(row.status) ? row.status : 'active';
  row.createdAt = Number(row.createdAt || Date.now());
  row.updatedAt = Number(row.updatedAt || Date.now());
  syncPropertyRentShares(row);
  return row;
}

function normalizeAll() {
  const s = state();
  if (!s) return null;

  for (const [key, value] of Object.entries(s.vehicles)) s.vehicles[key] = normalizeVehicle({ ...value, id: key });
  for (const [key, value] of Object.entries(s.properties)) s.properties[key] = normalizeProperty({ ...value, id: key });

  return s;
}


function favoriteAssetIds(kind, identityId = currentIdentity()?.id) {
  const s = state();
  if (!s || !identityId || !['vehicles', 'properties'].includes(kind)) return [];
  if (!Array.isArray(s.favorites[kind][identityId])) s.favorites[kind][identityId] = [];
  return s.favorites[kind][identityId];
}

function isAssetFavorite(kind, assetId) {
  return favoriteAssetIds(kind).includes(assetId);
}

function toggleAssetFavorite(kind, assetId) {
  const s = normalizeAll();
  const me = currentIdentity();
  const store = kind === 'vehicles' ? s.vehicles : kind === 'properties' ? s.properties : null;
  if (!me || !store?.[assetId]) return false;

  const list = favoriteAssetIds(kind, me.id);
  const index = list.indexOf(assetId);
  if (index >= 0) list.splice(index, 1);
  else list.unshift(assetId);
  saveSettings();
  return index < 0;
}

function lifeFavoriteButton(kind, assetId) {
  const saved = isAssetFavorite(kind, assetId);
  return `<button type="button" class="ghla-favorite ${saved ? 'saved' : ''}" data-ghla-favorite-kind="${esc(kind)}" data-ghla-favorite-id="${esc(assetId)}" title="${saved ? 'Remove from saved' : 'Save'}"><i class="${saved ? 'fa-solid' : 'fa-regular'} fa-heart"></i></button>`;
}

function putVehicle(v) {
  const s = normalizeAll();
  const row = normalizeVehicle(v);
  row.updatedAt = Date.now();
  s.vehicles[row.id] = row;
  saveSettings();
  return row;
}

function putProperty(p) {
  const s = normalizeAll();
  const row = normalizeProperty(p);
  row.updatedAt = Date.now();
  s.properties[row.id] = row;
  saveSettings();
  return row;
}

/* ---------------- generated listing helpers ---------------- */

function parseJsonLoose(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw || '').trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  try { return JSON.parse(text); }
  catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw new Error('The model did not return valid JSON.');
  }
}

async function generateJson(systemPrompt, prompt, responseLength = 1500) {
  const c = ctx();
  if (typeof c?.generateRaw !== 'function') throw new Error('SillyTavern generateRaw is unavailable.');
  const raw = await c.generateRaw({ prompt, systemPrompt, responseLength, trimNames: false });
  return parseJsonLoose(raw);
}

function existingCharacterCandidates(limit = 28) {
  const currentId = currentIdentity()?.id || '';
  return identities()
    .filter(x => x.id !== currentId)
    .slice(0, limit)
    .map(x => ({
      id: x.id,
      name: x.name,
      character: characterSummary(x),
    }));
}

function createNpcOwner(name = 'Seller') {
  return { kind: 'npc', id: uid('npc-owner'), name: norm(name || 'Seller') };
}

function createVehicleAssetFromDiscovery(row) {
  let owner;
  if (row.sellerType === 'existing') {
    const who = identityById(row.sellerIdentityId) || identityByName(row.sellerName);
    owner = who ? ownerRefIdentity(who) : createNpcOwner(row.sellerName);
  } else {
    owner = createNpcOwner(row.sellerName || 'Seller');
  }

  return putVehicle({
    id: uid('vehicle'),
    type: row.type,
    make: row.make,
    model: row.model,
    year: row.year,
    color: row.color,
    condition: row.condition,
    mileage: row.mileage,
    notes: row.description,
    owner,
    discoveredBy: 'market',
    createdAt: Date.now(),
  });
}

function createPropertyAssetFromDiscovery(row) {
  let owner;
  if (row.sellerType === 'existing') {
    const who = identityById(row.sellerIdentityId) || identityByName(row.sellerName);
    owner = who ? ownerRefIdentity(who) : createNpcOwner(row.sellerName);
  } else {
    owner = createNpcOwner(row.sellerName || 'Owner');
  }

  return putProperty({
    id: uid('property'),
    type: row.type,
    name: row.name,
    city: row.city,
    area: row.area,
    address: row.address,
    sizeSqm: row.sizeSqm,
    rooms: row.rooms,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    description: row.description,
    owner,
    shortTermEligible: Boolean(row.shortTermEligible),
    longTermRentable: row.mode === 'rent' || Boolean(row.longTermRentable),
    monthlyRent: row.mode === 'rent' ? row.monthlyRent : 0,
    discoveredBy: 'market',
    createdAt: Date.now(),
  });
}

async function refreshVehicleMarket() {
  if (vehicleRefreshBusy) return;
  const s = normalizeAll();
  if (!s) return;

  vehicleRefreshBusy = true;
  renderLife();

  try {
    const city = norm(s.market.vehicleRefresh.city || 'Greyhaven');
    const filterType = s.market.vehicleRefresh.type || 'all';
    const filterMode = s.market.vehicleRefresh.mode || 'all';
    const candidates = existingCharacterCandidates();

    const systemPrompt = `You generate realistic vehicle marketplace listings for a fictional life simulator.
Return ONLY valid JSON, no markdown.

Rules:
- Generate exactly 6 listings.
- Vehicles may be cars, motorcycles, boats, or airplanes, but mostly cars unless TYPE FILTER requests otherwise.
- mode is "sale" or "rent".
- Existing sellers MUST use an exact identity id/name from ALLOWED EXISTING CHARACTERS.
- Otherwise use sellerType "npc" and ONLY a plausible first name or business/dealer name.
- Prices must be realistic whole-Euro prices. No ranges.
- Rental price means DAILY price.
- Keep descriptions concise and believable.
- Existing-character discoveries become persistent owned assets in the simulator, so do not assign wildly implausible luxury assets to a character whose description clearly conflicts.
- Do not claim a sale is completed.
JSON:
{"listings":[{"sellerType":"existing|npc","sellerIdentityId":"","sellerName":"","mode":"sale|rent","type":"car|motorcycle|boat|airplane","make":"","model":"","year":2024,"color":"","condition":"excellent|good|fair","mileage":0,"price":25000,"dailyRate":0,"city":"","description":""}]}`;

    const prompt = `LOCATION: ${city}
TYPE FILTER: ${filterType}
LISTING MODE FILTER: ${filterMode}
ALLOWED EXISTING CHARACTERS:
${JSON.stringify(candidates)}

Create fresh top choices. Respect LISTING MODE FILTER exactly unless it is "all".`;

    const result = await generateJson(systemPrompt, prompt, 1800);
    const rows = Array.isArray(result?.listings) ? result.listings.slice(0, 6) : [];

    for (const raw of rows) {
      const row = {
        id: uid('vehicle-listing'),
        sellerType: raw.sellerType === 'existing' ? 'existing' : 'npc',
        sellerIdentityId: String(raw.sellerIdentityId || ''),
        sellerName: norm(raw.sellerName || 'Seller'),
        mode: raw.mode === 'rent' ? 'rent' : 'sale',
        type: ['car', 'motorcycle', 'boat', 'airplane'].includes(raw.type) ? raw.type : 'car',
        make: norm(raw.make),
        model: norm(raw.model),
        year: clamp(Number(raw.year || new Date().getFullYear()), 1950, new Date().getFullYear() + 2),
        color: norm(raw.color),
        condition: ['excellent', 'good', 'fair'].includes(raw.condition) ? raw.condition : 'good',
        mileage: Math.max(0, Number(raw.mileage || 0)),
        city: norm(raw.city || city),
        description: String(raw.description || '').trim(),
        status: 'available',
        createdAt: Date.now(),
        source: 'generated',
      };

      if (filterType !== 'all' && row.type !== filterType) continue;
      if (filterMode !== 'all' && row.mode !== filterMode) continue;

      const asset = createVehicleAssetFromDiscovery(row);
      row.assetId = asset.id;
      if (asset.owner?.kind === 'identity') {
        row.sellerType = 'existing';
        row.sellerIdentityId = asset.owner.identityId;
        row.sellerName = ownerName(asset.owner);
      } else {
        row.sellerType = 'npc';
        row.sellerIdentityId = '';
        row.sellerName = ownerName(asset.owner);
      }
      if (row.mode === 'rent') row.dailyRate = realisticVehiclePrice({ ...row, dailyRate: raw.dailyRate || raw.price });
      else row.price = realisticVehiclePrice({ ...row, price: raw.price });

      s.vehicleListings[row.id] = row;
    }

    s.market.vehicleRefresh.lastAt = Date.now();
    saveSettings();
    syncFacebookAssetListings();
  } catch (error) {
    console.error(`[${GHLA_MODULE}] vehicle refresh`, error);
    globalThis.toastr?.error?.(error.message || 'Vehicle refresh failed.');
  } finally {
    vehicleRefreshBusy = false;
    renderLife();
  }
}

async function refreshPropertyMarket() {
  if (propertyRefreshBusy) return;
  const s = normalizeAll();
  if (!s) return;

  propertyRefreshBusy = true;
  renderLife();

  try {
    const city = norm(s.market.propertyRefresh.city || 'Greyhaven');
    const filterType = s.market.propertyRefresh.type || 'all';
    const filterMode = s.market.propertyRefresh.mode || 'all';
    const candidates = existingCharacterCandidates();
    const agencies = s.agencies.map(x => ({ id: x.id, identityId: x.identityId || '', name: x.name, type: x.kind }));

    const systemPrompt = `You generate realistic real-estate listings for a fictional life simulator.
Return ONLY valid JSON.

Rules:
- Generate exactly 6 listings.
- Types: house, apartment, villa, land, business.
- Modes: sale or rent. "rent" means LONG-TERM monthly rent, not holiday booking.
- Existing direct owners MUST use exact IDs/names from ALLOWED EXISTING CHARACTERS.
- Otherwise use an NPC owner.
- An agency may market a property without owning it. Use agencyName only when appropriate.
- Whole-Euro realistic prices only, no ranges.
- monthlyRent is monthly.
- Keep room counts and square meters believable.
- shortTermEligible can be true only for a property that could realistically be offered for short stays later.
- A generated listing becomes a persistent property with a real owner record, so do not create ownership-free listings.
JSON:
{"listings":[{"sellerType":"existing|npc","sellerIdentityId":"","sellerName":"","agencyName":"","mode":"sale|rent","type":"house|apartment|villa|land|business","name":"","city":"","area":"","address":"","sizeSqm":80,"rooms":4,"bedrooms":2,"bathrooms":1,"price":180000,"monthlyRent":900,"shortTermEligible":false,"description":""}]}`;

    const prompt = `CITY: ${city}
TYPE FILTER: ${filterType}
MODE FILTER: ${filterMode}
ALLOWED EXISTING CHARACTERS:
${JSON.stringify(candidates)}
REGISTERED AGENCIES:
${JSON.stringify(agencies)}

Generate fresh top choices matching the search.`;

    const result = await generateJson(systemPrompt, prompt, 1900);
    const rows = Array.isArray(result?.listings) ? result.listings.slice(0, 6) : [];

    for (const raw of rows) {
      const row = {
        id: uid('property-listing'),
        sellerType: raw.sellerType === 'existing' ? 'existing' : 'npc',
        sellerIdentityId: String(raw.sellerIdentityId || ''),
        sellerName: norm(raw.sellerName || 'Owner'),
        agencyName: norm(raw.agencyName),
        mode: raw.mode === 'rent' ? 'rent' : 'sale',
        type: ['house', 'apartment', 'villa', 'land', 'business'].includes(raw.type) ? raw.type : 'apartment',
        name: norm(raw.name || 'Property'),
        city: norm(raw.city || city),
        area: norm(raw.area),
        address: norm(raw.address),
        sizeSqm: Math.max(15, Number(raw.sizeSqm || 70)),
        rooms: Math.max(0, Number(raw.rooms || 0)),
        bedrooms: Math.max(0, Number(raw.bedrooms || 0)),
        bathrooms: Math.max(0, Number(raw.bathrooms || 0)),
        shortTermEligible: Boolean(raw.shortTermEligible),
        description: String(raw.description || '').trim(),
        status: 'available',
        source: 'generated',
        createdAt: Date.now(),
      };

      if (filterType !== 'all' && row.type !== filterType) continue;
      if (filterMode !== 'all' && row.mode !== filterMode) continue;

      const asset = createPropertyAssetFromDiscovery(row);
      row.assetId = asset.id;
      if (asset.owner?.kind === 'identity') {
        row.sellerType = 'existing';
        row.sellerIdentityId = asset.owner.identityId;
        row.sellerName = ownerName(asset.owner);
      } else {
        row.sellerType = 'npc';
        row.sellerIdentityId = '';
        row.sellerName = ownerName(asset.owner);
      }

      if (row.mode === 'rent') row.monthlyRent = realisticPropertyPrice({ ...row, monthlyRent: raw.monthlyRent || raw.price });
      else row.price = realisticPropertyPrice({ ...row, price: raw.price });

      s.propertyListings[row.id] = row;
    }

    s.market.propertyRefresh.lastAt = Date.now();
    saveSettings();
    syncFacebookAssetListings();
  } catch (error) {
    console.error(`[${GHLA_MODULE}] property refresh`, error);
    globalThis.toastr?.error?.(error.message || 'Property refresh failed.');
  } finally {
    propertyRefreshBusy = false;
    renderLife();
  }
}

/* ---------------- transaction / rental logic ---------------- */

function activeListingForAsset(kind, assetId) {
  const s = normalizeAll();
  const store = kind === 'vehicle' ? s.vehicleListings : s.propertyListings;
  return Object.values(store).find(x => x.assetId === assetId && x.status === 'available') || null;
}

function listVehicle(assetId, mode, amount) {
  const s = normalizeAll();
  const asset = s.vehicles[assetId];
  const owner = currentIdentity();
  if (!asset || !owner || !isOwner(asset, owner.id)) throw new Error('Only the recorded owner can list this vehicle.');
  if (activeListingForAsset('vehicle', assetId)) throw new Error('This vehicle already has an active listing.');

  const listing = {
    id: uid('vehicle-listing'),
    assetId,
    sellerType: 'existing',
    sellerIdentityId: owner.id,
    sellerName: owner.name,
    mode: mode === 'rent' ? 'rent' : 'sale',
    type: asset.type,
    make: asset.make,
    model: asset.model,
    year: asset.year,
    color: asset.color,
    condition: asset.condition,
    mileage: asset.mileage,
    city: 'Greyhaven',
    description: asset.notes,
    status: 'available',
    source: 'owner',
    createdAt: Date.now(),
  };

  if (listing.mode === 'rent') listing.dailyRate = Math.max(1, euro(amount));
  else listing.price = Math.max(1, euro(amount));

  s.vehicleListings[listing.id] = listing;
  saveSettings();
  syncFacebookAssetListings();
  return listing;
}

function listProperty(assetId, mode, amount, agencyId = '') {
  const s = normalizeAll();
  const asset = s.properties[assetId];
  const owner = currentIdentity();
  if (!asset || !owner || !isOwner(asset, owner.id)) throw new Error('Only the recorded owner can list this property.');
  if (activeListingForAsset('property', assetId)) throw new Error('This property already has an active listing.');

  const agency = s.agencies.find(x => x.id === agencyId) || null;
  const listing = {
    id: uid('property-listing'),
    assetId,
    sellerType: 'existing',
    sellerIdentityId: owner.id,
    sellerName: owner.name,
    agencyId: agency?.id || '',
    agencyName: agency?.name || '',
    mode: mode === 'rent' ? 'rent' : 'sale',
    type: asset.type,
    name: asset.name,
    city: asset.city,
    area: asset.area,
    address: asset.address,
    sizeSqm: asset.sizeSqm,
    rooms: asset.rooms,
    bedrooms: asset.bedrooms,
    bathrooms: asset.bathrooms,
    shortTermEligible: asset.shortTermEligible,
    description: asset.description,
    status: 'available',
    source: 'owner',
    createdAt: Date.now(),
  };

  if (listing.mode === 'rent') listing.monthlyRent = Math.max(1, euro(amount));
  else listing.price = Math.max(1, euro(amount));

  s.propertyListings[listing.id] = listing;
  saveSettings();
  syncFacebookAssetListings();
  return listing;
}


function agencyListProperty(assetId, mode, amount, agencyId) {
  const s = normalizeAll();
  const asset = s.properties[assetId];
  const agency = s.agencies.find(x => x.id === agencyId);
  const me = currentIdentity();

  if (!asset || !agency) throw new Error('Property or agency is missing.');
  if (agency.kind !== 'identity' || agency.identityId !== me?.id) {
    throw new Error('Open the registered agency character’s phone to list a client property.');
  }
  if (activeListingForAsset('property', assetId)) throw new Error('This property already has an active listing.');

  const ownerIdentity = asset.owner?.kind === 'identity' ? identityById(asset.owner.identityId) : null;
  const listing = {
    id: uid('property-listing'),
    assetId,
    sellerType: ownerIdentity ? 'existing' : 'npc',
    sellerIdentityId: ownerIdentity?.id || '',
    sellerName: ownerIdentity?.name || ownerName(asset.owner),
    agencyId: agency.id,
    agencyName: agency.name,
    mode: mode === 'rent' ? 'rent' : 'sale',
    type: asset.type,
    name: asset.name,
    city: asset.city,
    area: asset.area,
    address: asset.address,
    sizeSqm: asset.sizeSqm,
    rooms: asset.rooms,
    bedrooms: asset.bedrooms,
    bathrooms: asset.bathrooms,
    shortTermEligible: asset.shortTermEligible,
    description: asset.description,
    status: 'available',
    source: 'agency',
    createdAt: Date.now(),
  };

  if (listing.mode === 'rent') listing.monthlyRent = Math.max(1, euro(amount));
  else listing.price = Math.max(1, euro(amount));

  s.propertyListings[listing.id] = listing;
  saveSettings();
  syncFacebookAssetListings();
  return listing;
}

function removeListing(kind, listingId) {
  const s = normalizeAll();
  const store = kind === 'vehicle' ? s.vehicleListings : s.propertyListings;
  const row = store[listingId];
  if (!row) return false;

  const me = currentIdentity();
  if (row.sellerIdentityId && row.sellerIdentityId !== me?.id) throw new Error('Only the seller can remove this listing.');

  row.status = 'removed';
  row.closedAt = Date.now();
  saveSettings();
  syncFacebookAssetListings();
  return true;
}

function buyerOwnerRef(buyerIdentityId, buyerName) {
  const who = identityById(buyerIdentityId);
  if (who) return ownerRefIdentity(who);
  return createNpcOwner(buyerName || 'Buyer');
}

function completeVehicleSale(listingId, buyerIdentityId = '', buyerName = '') {
  const s = normalizeAll();
  const listing = s.vehicleListings[listingId];
  const asset = listing ? s.vehicles[listing.assetId] : null;
  if (!listing || !asset || listing.status !== 'available' || listing.mode !== 'sale') throw new Error('This sale listing is no longer available.');

  asset.owner = buyerOwnerRef(buyerIdentityId, buyerName);
  asset.updatedAt = Date.now();
  listing.status = 'sold';
  listing.soldAt = Date.now();
  listing.buyer = clone(asset.owner);

  s.transactions.unshift({
    id: uid('tx'),
    kind: 'vehicle-sale',
    assetId: asset.id,
    listingId,
    seller: { kind: listing.sellerType, identityId: listing.sellerIdentityId || '', name: listing.sellerName },
    buyer: clone(asset.owner),
    amount: listing.price,
    timeMs: Date.now(),
  });

  saveSettings();
  syncFacebookAssetListings();
  return asset;
}

function completePropertySale(listingId, buyerIdentityId = '', buyerName = '') {
  const s = normalizeAll();
  const listing = s.propertyListings[listingId];
  const asset = listing ? s.properties[listing.assetId] : null;
  if (!listing || !asset || listing.status !== 'available' || listing.mode !== 'sale') throw new Error('This sale listing is no longer available.');

  asset.owner = buyerOwnerRef(buyerIdentityId, buyerName);
  asset.tenants = [];
  asset.occupants = [];
  asset.updatedAt = Date.now();
  listing.status = 'sold';
  listing.soldAt = Date.now();
  listing.buyer = clone(asset.owner);

  s.transactions.unshift({
    id: uid('tx'),
    kind: 'property-sale',
    assetId: asset.id,
    listingId,
    seller: { kind: listing.sellerType, identityId: listing.sellerIdentityId || '', name: listing.sellerName },
    buyer: clone(asset.owner),
    amount: listing.price,
    timeMs: Date.now(),
  });

  saveSettings();
  syncFacebookAssetListings();
  return asset;
}

function rentVehicle(listingId, renterIdentityId, startAt, endAt) {
  const s = normalizeAll();
  const listing = s.vehicleListings[listingId];
  if (!listing || listing.status !== 'available' || listing.mode !== 'rent') throw new Error('This rental is unavailable.');

  const renter = identityById(renterIdentityId);
  if (!renter) throw new Error('Choose a renter.');
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Choose a valid rental start and end.');

  const conflict = Object.values(s.vehicleRentals).find(r =>
    r.assetId === listing.assetId &&
    ['booked', 'active'].includes(r.status) &&
    start < Number(r.endAt || 0) &&
    end > Number(r.startAt || 0)
  );
  if (conflict) {
    throw new Error(`This vehicle is already reserved from ${new Date(conflict.startAt).toLocaleString()} to ${new Date(conflict.endAt).toLocaleString()}.`);
  }

  const days = Math.max(1, Math.ceil((end - start) / 86400000));
  const rental = {
    id: uid('vehicle-rental'),
    listingId,
    assetId: listing.assetId,
    renterIdentityId: renter.id,
    renterName: renter.name,
    startAt: start,
    endAt: end,
    reminderAt: Math.max(start, end - 3 * 3600000),
    reminderDelivered: false,
    overdueDelivered: false,
    status: start > rpNow().getTime() ? 'booked' : 'active',
    dailyRate: listing.dailyRate,
    total: days * listing.dailyRate,
    createdAt: Date.now(),
  };

  s.vehicleRentals[rental.id] = rental;
  saveSettings();
  return rental;
}

function startPropertyTenancy(listingId, tenantIdentityId, startAt, splitMode = 'none', extraHousemates = 0) {
  const s = normalizeAll();
  const listing = s.propertyListings[listingId];
  if (!listing || listing.status !== 'available' || listing.mode !== 'rent') throw new Error('This rental listing is unavailable.');

  const tenant = identityById(tenantIdentityId);
  if (!tenant) throw new Error('Choose a tenant.');

  let property = s.properties[listing.assetId];
  if (!property) throw new Error('The listed property record is missing.');

  const existing = property.tenants.find(x => x.identityId === tenant.id);
  if (!existing) {
    property.tenants.push({
      kind: 'identity',
      identityId: tenant.id,
      name: tenant.name,
      startAt: new Date(startAt || Date.now()).getTime() || Date.now(),
      monthlyRent: listing.monthlyRent,
      splitMode,
    });
  }

  property.monthlyRent = listing.monthlyRent;
  property.rentSplit = ['equal', 'custom'].includes(splitMode) ? splitMode : 'none';
  property.untrackedHousemates = Math.max(property.untrackedHousemates, Number(extraHousemates || 0));
  syncPropertyRentShares(property);
  property.updatedAt = Date.now();

  listing.status = 'rented';
  listing.rentedAt = Date.now();
  listing.tenantIdentityId = tenant.id;
  listing.tenantName = tenant.name;

  s.transactions.unshift({
    id: uid('tx'),
    kind: 'property-tenancy',
    assetId: property.id,
    listingId,
    tenant: ownerRefIdentity(tenant),
    monthlyRent: listing.monthlyRent,
    timeMs: Date.now(),
  });

  saveSettings();
  syncFacebookAssetListings();
  return property;
}

function endTenancy(propertyId, tenantIdentityId) {
  const s = normalizeAll();
  const p = s.properties[propertyId];
  if (!p) return false;

  const before = p.tenants.length;
  p.tenants = p.tenants.filter(x => String(x.identityId) !== String(tenantIdentityId));
  syncPropertyRentShares(p);
  p.updatedAt = Date.now();
  saveSettings();
  return p.tenants.length !== before;
}

/* ---------------- repairs / mechanics ---------------- */

function addMechanic(identityId, label = '') {
  const s = normalizeAll();
  const who = identityById(identityId);
  if (!who) throw new Error('Choose an existing character.');
  if (s.mechanics.some(x => x.identityId === who.id)) return s.mechanics.find(x => x.identityId === who.id);

  const row = { id: uid('mechanic'), kind: 'identity', identityId: who.id, name: who.name, label: norm(label), active: true };
  s.mechanics.push(row);
  saveSettings();
  return row;
}

function removeMechanic(mechanicId) {
  const s = normalizeAll();
  s.mechanics = s.mechanics.filter(x => x.id !== mechanicId);
  saveSettings();
}

function requestRepair(vehicleId, mechanicId, issue, towing = false) {
  const s = normalizeAll();
  const vehicle = s.vehicles[vehicleId];
  const me = currentIdentity();
  if (!vehicle || !me || !isOwner(vehicle, me.id)) throw new Error('You can request service only for a vehicle you own.');

  const mechanic = s.mechanics.find(x => x.id === mechanicId);
  if (!mechanic) throw new Error('Choose a mechanic.');

  const row = {
    id: uid('repair'),
    vehicleId,
    ownerIdentityId: me.id,
    mechanicId: mechanic.id,
    mechanicIdentityId: mechanic.identityId,
    mechanicName: mechanic.name,
    issue: String(issue || '').trim(),
    towing: Boolean(towing),
    status: 'requested',
    quotedPrice: 0,
    finalPrice: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (!row.issue) throw new Error('Describe the vehicle problem.');

  s.serviceRequests[row.id] = row;
  saveSettings();

  dispatchWorldMessage(me.name, mechanic.name,
    `Hi, I need help with my ${vehicle.make} ${vehicle.model}. ${row.issue}${row.towing ? ' It needs towing.' : ' I can bring it in if needed.'}`
  );

  return row;
}

function updateRepairStatus(idValue, status, price = 0) {
  const s = normalizeAll();
  const row = s.serviceRequests[idValue];
  if (!row) return null;

  if (!['requested', 'accepted', 'in-progress', 'completed', 'cancelled'].includes(status)) return row;
  row.status = status;
  row.updatedAt = Date.now();
  if (status === 'accepted' && price > 0) row.quotedPrice = euro(price);
  if (status === 'completed' && price > 0) row.finalPrice = euro(price);
  saveSettings();
  return row;
}

function dispatchWorldMessage(from, to, text) {
  if (!from || !to || !text) return false;

  try {
    const action = { type: 'message.send', from, to, text, expectsReply: false };
    if (typeof phoneApi()?.actionBus?.dispatch === 'function') {
      return Boolean(phoneApi().actionBus.dispatch(action, {
        source: GHLA_MODULE,
        sourceKey: uid('life-message'),
        roleplayMs: rpNow().getTime(),
      }));
    }

    if (typeof globalThis.GreyhavenLife?.dispatchWorldAction === 'function') {
      return Boolean(globalThis.GreyhavenLife.dispatchWorldAction(action, {
        source: GHLA_MODULE,
        sourceKey: uid('life-message'),
        roleplayMs: rpNow().getTime(),
      }));
    }
  } catch (error) {
    console.warn(`[${GHLA_MODULE}] dispatch message`, error);
  }

  return false;
}

/* ---------------- agencies ---------------- */

function addAgency({ identityId = '', name = '', kind = 'identity' } = {}) {
  const s = normalizeAll();

  if (kind === 'identity') {
    const who = identityById(identityId);
    if (!who) throw new Error('Choose an existing character or business identity.');
    if (s.agencies.some(x => x.identityId === who.id)) return;
    s.agencies.push({ id: uid('agency'), kind: 'identity', identityId: who.id, name: who.name, active: true });
  } else {
    const clean = norm(name);
    if (!clean) throw new Error('Enter an agency name.');
    s.agencies.push({ id: uid('agency'), kind: 'external', identityId: '', name: clean, active: true });
  }

  saveSettings();
}

function removeAgency(idValue) {
  const s = normalizeAll();
  s.agencies = s.agencies.filter(x => x.id !== idValue);
  saveSettings();
}


/* ---------------- Greyhaven default service characters / homes ---------------- */

const DEFAULT_GREYHAVEN_SERVICES = Object.freeze({
  mechanics: [
    { name: 'Grant Harlow', label: 'Harlow Auto & Tow' },
    { name: 'Nico Russo', label: 'Russo Motorworks' },
  ],
  agent: { name: 'Celeste Warren' },
  landlords: {
    park: 'Gordon Pike',
    college: 'Arben Kodra',
  },
});

function cardIdentityByName(name) {
  const c = ctx();
  const ch = (c?.characters || []).find(x => lc(x?.name) === lc(name));
  if (!ch) return null;

  const stable = String(ch?.avatar || ch?.data?.avatar || '').trim();
  const expectedId = stable ? `character:${encodeURIComponent(stable)}` : '';
  return (expectedId ? identityById(expectedId) : null) ||
    identities().find(x => expectedId && x.id === expectedId) ||
    identities().find(x => lc(x.name) === lc(name)) ||
    null;
}

function tenantRef(name, monthlyRent = 0, splitMode = 'none') {
  const who = cardIdentityByName(name);
  if (!who) return null;
  return {
    kind: 'identity',
    identityId: who.id,
    name: who.name,
    startAt: Date.now() - 120 * 86400000,
    monthlyRent: Math.max(0, Number(monthlyRent || 0)),
    splitMode,
  };
}

function occupantRef(name) {
  const who = cardIdentityByName(name);
  if (!who) return null;
  return { kind: 'identity', identityId: who.id, name: who.name };
}

function ensureSeededProperty(definition) {
  const s = normalizeAll();
  const owner = cardIdentityByName(definition.ownerName);
  if (!owner) return false;

  let property = s.properties[definition.id];
  let changed = false;

  if (!property) {
    property = normalizeProperty({
      id: definition.id,
      type: 'apartment',
      name: definition.name,
      city: 'Greyhaven',
      area: definition.area,
      address: definition.address,
      sizeSqm: definition.sizeSqm,
      rooms: definition.rooms,
      bedrooms: definition.bedrooms,
      bathrooms: definition.bathrooms,
      description: definition.description,
      owner: ownerRefIdentity(owner),
      tenants: [],
      occupants: [],
      untrackedHousemates: 0,
      monthlyRent: definition.monthlyRent,
      rentSplit: definition.rentSplit,
      shortTermEligible: false,
      longTermRentable: true,
      status: 'active',
      seedKey: definition.id,
      seedManaged: true,
      rentDueDay: definition.rentDueDay || 1,
      landlordIdentityId: owner.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    s.properties[property.id] = property;
    changed = true;
  }

  // Do not overwrite later user edits. Only repair the original seed links.
  if (property.seedManaged === true || property.seedKey === definition.id) {
    if (property.owner?.kind !== 'identity' || property.owner.identityId !== owner.id) {
      property.owner = ownerRefIdentity(owner);
      property.landlordIdentityId = owner.id;
      changed = true;
    }

    property.tenants ||= [];
    for (const tenantDef of definition.tenants || []) {
      const ref = tenantRef(tenantDef.name, tenantDef.monthlyRent, definition.rentSplit);
      if (!ref) continue;
      if (!property.tenants.some(x => x.identityId === ref.identityId)) {
        property.tenants.push(ref);
        changed = true;
      }
    }

    property.occupants ||= [];
    for (const name of definition.occupants || []) {
      const ref = occupantRef(name);
      if (!ref) continue;
      if (!property.occupants.some(x => x.identityId === ref.identityId)) {
        property.occupants.push(ref);
        changed = true;
      }
    }

    if (changed) property.updatedAt = Date.now();
  }

  return changed;
}

function seedDefaultGreyhavenWorld() {
  const s = normalizeAll();
  if (!s) return false;

  let changed = false;

  for (const mechanicDef of DEFAULT_GREYHAVEN_SERVICES.mechanics) {
    const who = cardIdentityByName(mechanicDef.name);
    if (!who) continue;
    if (!s.mechanics.some(x => x.identityId === who.id)) {
      s.mechanics.push({
        id: uid('mechanic'),
        kind: 'identity',
        identityId: who.id,
        name: who.name,
        label: mechanicDef.label,
        active: true,
        seeded: true,
      });
      changed = true;
    }
  }

  const agent = cardIdentityByName(DEFAULT_GREYHAVEN_SERVICES.agent.name);
  if (agent && !s.agencies.some(x => x.identityId === agent.id)) {
    s.agencies.push({
      id: uid('agency'),
      kind: 'identity',
      identityId: agent.id,
      name: agent.name,
      active: true,
      seeded: true,
      label: 'Warren Property',
    });
    changed = true;
  }

  const propertyDefs = [
    {
      id: 'greyhaven:park-area:aurora',
      ownerName: DEFAULT_GREYHAVEN_SERVICES.landlords.park,
      name: 'Park Area Apartments · 3A',
      area: 'Park Area',
      address: 'Park Area Apartments, Building A, Apt 3A',
      sizeSqm: 58, rooms: 3, bedrooms: 1, bathrooms: 1,
      monthlyRent: 680, rentSplit: 'none', rentDueDay: 1,
      tenants: [{ name: 'Aurora', monthlyRent: 680 }],
      occupants: [],
      description: 'An older but well-kept one-bedroom apartment in Greyhaven’s Park Area. The building is not a new luxury development, but it is clean, decent, practical, and in a good neighborhood. Aurora rents this unit from Gordon Pike and pays monthly.',
    },
    {
      id: 'greyhaven:park-area:eldin',
      ownerName: DEFAULT_GREYHAVEN_SERVICES.landlords.park,
      name: 'Park Area Apartments · 3B',
      area: 'Park Area',
      address: 'Park Area Apartments, Building A, Apt 3B',
      sizeSqm: 54, rooms: 3, bedrooms: 1, bathrooms: 1,
      monthlyRent: 640, rentSplit: 'none', rentDueDay: 1,
      tenants: [{ name: 'Eldin', monthlyRent: 640 }],
      occupants: [],
      description: 'A modest, comfortable one-bedroom apartment beside Aurora’s unit in the older Park Area complex. It is maintained well rather than modern or luxurious. Eldin rents it from Gordon Pike and pays monthly.',
    },
    {
      id: 'greyhaven:park-area:liam-family',
      ownerName: DEFAULT_GREYHAVEN_SERVICES.landlords.park,
      name: 'Park Area Apartments · 3C',
      area: 'Park Area',
      address: 'Park Area Apartments, Building A, Apt 3C',
      sizeSqm: 82, rooms: 5, bedrooms: 2, bathrooms: 1,
      monthlyRent: 980, rentSplit: 'equal', rentDueDay: 1,
      tenants: [
        { name: 'Liam', monthlyRent: 490 },
        { name: 'Evelyn', monthlyRent: 490 },
      ],
      occupants: ['Alina'],
      description: 'A two-bedroom family apartment in the same Park Area building as Aurora and Eldin. Liam and Evelyn rent the unit from Gordon Pike and live here with their daughter Alina. The building is older, quiet, decent, and well maintained.',
    },
    {
      id: 'greyhaven:college:leo-rozafa',
      ownerName: DEFAULT_GREYHAVEN_SERVICES.landlords.college,
      name: 'College Quarter Apartments · 2D',
      area: 'College Quarter',
      address: 'College Quarter Apartments, Apt 2D',
      sizeSqm: 72, rooms: 4, bedrooms: 2, bathrooms: 1,
      monthlyRent: 900, rentSplit: 'equal', rentDueDay: 1,
      tenants: [
        { name: 'Leo', monthlyRent: 450 },
        { name: 'Rozafa', monthlyRent: 450 },
      ],
      occupants: [],
      description: 'A practical two-bedroom student apartment within walking distance of Greyhaven City College. Leo and Rozafa are roommates, know each other through living together, and split the rent equally. Arben Kodra is their landlord.',
    },
    {
      id: 'greyhaven:college:alessa-kevin',
      ownerName: DEFAULT_GREYHAVEN_SERVICES.landlords.college,
      name: 'College Quarter Apartments · 4B',
      area: 'College Quarter',
      address: 'College Quarter Apartments, Apt 4B',
      sizeSqm: 70, rooms: 4, bedrooms: 2, bathrooms: 1,
      monthlyRent: 880, rentSplit: 'equal', rentDueDay: 1,
      tenants: [
        { name: 'Alessa', monthlyRent: 440 },
        { name: 'Kevin', monthlyRent: 440 },
      ],
      occupants: [],
      description: 'A decent two-bedroom student apartment near Greyhaven City College. The siblings Alessa and Kevin rent the unit from Arben Kodra and split the rent equally by default; the arrangement can still be edited manually later.',
    },
  ];

  for (const definition of propertyDefs) {
    if (ensureSeededProperty(definition)) changed = true;
  }

  if (changed) {
    s.defaultWorldSeeds.serviceCharactersV1 = {
      seededAt: Date.now(),
      mechanics: DEFAULT_GREYHAVEN_SERVICES.mechanics.map(x => x.name),
      agent: DEFAULT_GREYHAVEN_SERVICES.agent.name,
      landlords: Object.values(DEFAULT_GREYHAVEN_SERVICES.landlords),
    };
    saveSettings();
    syncFacebookAssetListings();
  }

  return changed;
}

/* ---------------- phone notifications / reminders ---------------- */

function phoneMetadataRoot(create = false) {
  const c = ctx();
  if (!c?.chatMetadata) return null;

  let root = c.chatMetadata[PHONE_META_KEY];
  if ((!root || typeof root !== 'object') && create) {
    root = {
      version: 5,
      phones: {},
      continuity: { version: 1, seq: 0, events: [], rpCheckpoint: { seq: 0, roleplayMs: 0, realMs: 0, chatLength: 0 } },
      worldBridge: { processed: [] },
      services: {},
      onlyFans: {},
      darkWeb: {},
    };
    c.chatMetadata[PHONE_META_KEY] = root;
  }

  if (root && (!root.phones || typeof root.phones !== 'object')) root.phones = {};
  return root || null;
}

function savePhoneMetadata(root) {
  const c = ctx();
  if (!c?.chatMetadata || !root) return;
  c.chatMetadata[PHONE_META_KEY] = root;
  try {
    c.updateChatMetadata?.({ [PHONE_META_KEY]: root });
    if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced();
    else c.saveMetadata?.();
  } catch (error) {
    console.warn(`[${GHLA_MODULE}] save phone metadata`, error);
  }
}

function findPhoneTimeline(identityId, name = '') {
  const root = phoneMetadataRoot();
  if (!root?.phones) return null;

  const entries = Object.entries(root.phones);
  return entries.find(([, t]) => String(t?.identityId || '') === String(identityId)) ||
    entries.find(([, t]) => lc(t?.ownerName) === lc(name)) ||
    null;
}

function pushLifeNotification(identityId, title, text, eventId = '') {
  const who = identityById(identityId);
  const hit = findPhoneTimeline(identityId, who?.name || '');
  if (!hit) return false;

  const [key, timeline] = hit;
  if (!Array.isArray(timeline.notifications)) timeline.notifications = [];
  if (eventId && timeline.notifications.some(x => x.eventId === eventId)) return true;

  timeline.notifications.unshift({
    id: uid('notification'),
    app: 'life',
    title: String(title || 'Life'),
    text: String(text || ''),
    timeMs: rpNow().getTime(),
    read: false,
    eventId,
  });

  const root = phoneMetadataRoot();
  root.phones[key] = timeline;
  savePhoneMetadata(root);
  return true;
}

function checkReminders() {
  const s = normalizeAll();
  if (!s) return;

  const nowMs = rpNow().getTime();
  let changed = false;

  for (const rental of Object.values(s.vehicleRentals)) {
    if (!['booked', 'active'].includes(rental.status)) continue;

    if (nowMs >= rental.startAt && nowMs < rental.endAt && rental.status === 'booked') {
      rental.status = 'active';
      changed = true;
    }

    if (!rental.reminderDelivered && nowMs >= rental.reminderAt && nowMs < rental.endAt) {
      const asset = s.vehicles[rental.assetId];
      const title = 'Rental return soon';
      const text = `${asset?.make || ''} ${asset?.model || 'Vehicle'} is due back in about ${Math.max(1, Math.ceil((rental.endAt - nowMs) / 3600000))}h.`;
      if (pushLifeNotification(rental.renterIdentityId, title, text, `vehicle-rental-reminder:${rental.id}`)) {
        rental.reminderDelivered = true;
        changed = true;
      }
    }

    if (!rental.overdueDelivered && nowMs >= rental.endAt) {
      const asset = s.vehicles[rental.assetId];
      if (pushLifeNotification(rental.renterIdentityId, 'Rental return due', `${asset?.make || ''} ${asset?.model || 'Vehicle'} should now be returned.`, `vehicle-rental-due:${rental.id}`)) {
        rental.overdueDelivered = true;
        changed = true;
      }
    }
  }

  if (changed) saveSettings();
}

/* ---------------- Facebook Marketplace bridge ---------------- */

function syncFacebookAssetListings() {
  /*
   * Only cross-post SALE listings with an EXISTING recorded identity seller.
   * That guarantees an existing Greyhaven character never appears to sell a
   * vehicle/property that is not actually persisted as theirs.
   */
  const s = normalizeAll();
  const root = phoneMetadataRoot();
  if (!s || !root) return;

  if (!root.marketplace || typeof root.marketplace !== 'object') {
    root.marketplace = { version: 1, legacyMigrated: false, listings: [], archived: [], refresh: { lastAt: null, eventKeys: [], summary: '' } };
  }
  if (!Array.isArray(root.marketplace.listings)) root.marketplace.listings = [];

  const before = JSON.stringify(root.marketplace.listings.map(x => [
    x.lifeAssetListingId || '',
    x.status || '',
    x.sellerIdentityId || '',
    x.title || '',
    x.price || '',
  ]));

  const active = [];

  for (const listing of Object.values(s.vehicleListings)) {
    if (listing.status !== 'available' || listing.mode !== 'sale' || listing.sellerType !== 'existing') continue;
    const asset = s.vehicles[listing.assetId];
    if (!asset || !isOwner(asset, listing.sellerIdentityId)) continue;

    active.push({
      lifeAssetListingId: listing.id,
      sellerIdentityId: listing.sellerIdentityId,
      sellerName: listing.sellerName,
      sellerType: 'existing',
      title: `${asset.year} ${asset.make} ${asset.model}`.trim(),
      description: listing.description || asset.notes || `${asset.condition} condition`,
      price: money(listing.price),
      area: listing.city || 'Greyhaven',
      visual: `${asset.color ? `${asset.color} ` : ''}${asset.make} ${asset.model}`,
      type: 'photo',
      mediaKey: '',
      mediaWidth: 0,
      mediaHeight: 0,
      timeMs: listing.createdAt || Date.now(),
      status: 'available',
      linkedManually: true,
      ownerListing: listing.sellerIdentityId === currentIdentity()?.id,
      inquiries: [],
    });
  }

  for (const listing of Object.values(s.propertyListings)) {
    if (listing.status !== 'available' || listing.mode !== 'sale' || listing.sellerType !== 'existing') continue;
    const asset = s.properties[listing.assetId];
    if (!asset || !isOwner(asset, listing.sellerIdentityId)) continue;

    active.push({
      lifeAssetListingId: listing.id,
      sellerIdentityId: listing.sellerIdentityId,
      sellerName: listing.sellerName,
      sellerType: 'existing',
      title: `${asset.name} · ${asset.type}`,
      description: listing.description || asset.description || `${asset.sizeSqm || ''} m²`,
      price: money(listing.price),
      area: [asset.area, asset.city].filter(Boolean).join(', ') || 'Greyhaven',
      visual: `${asset.type} property in ${asset.city}`,
      type: 'photo',
      mediaKey: '',
      mediaWidth: 0,
      mediaHeight: 0,
      timeMs: listing.createdAt || Date.now(),
      status: 'available',
      linkedManually: true,
      ownerListing: listing.sellerIdentityId === currentIdentity()?.id,
      inquiries: [],
    });
  }

  const activeIds = new Set(active.map(x => x.lifeAssetListingId));
  root.marketplace.listings = root.marketplace.listings.filter(x => !x.lifeAssetListingId || activeIds.has(x.lifeAssetListingId));

  for (const row of active) {
    const existing = root.marketplace.listings.find(x => x.lifeAssetListingId === row.lifeAssetListingId);
    if (existing) Object.assign(existing, row);
    else root.marketplace.listings.unshift(row);
  }

  root.marketplace.listings = root.marketplace.listings.slice(0, 60);

  const after = JSON.stringify(root.marketplace.listings.map(x => [
    x.lifeAssetListingId || '',
    x.status || '',
    x.sellerIdentityId || '',
    x.title || '',
    x.price || '',
  ]));

  if (before !== after) savePhoneMetadata(root);
}

/* ---------------- required app defaults ---------------- */

function enableRequiredCoreApps() {
  const c = ctx();
  if (!c?.extensionSettings) return;

  try { phoneApi()?.getProfile?.(); } catch {}

  const root = c.extensionSettings[PHONE_SETTINGS_KEY];
  if (!root?.profiles || typeof root.profiles !== 'object') return;

  let changed = false;
  for (const profile of Object.values(root.profiles)) {
    if (!profile || typeof profile !== 'object') continue;
    if (!profile.apps || typeof profile.apps !== 'object') profile.apps = {};

    if (profile.apps.dominos !== true) { profile.apps.dominos = true; changed = true; }
    if (profile.apps.uber !== true) { profile.apps.uber = true; changed = true; }
  }

  if (changed) saveSettings();
}

/* ---------------- phone manager ---------------- */

function defaultPhoneTimeline(identity) {
  return {
    version: 5,
    ownerName: identity.name,
    ownerAvatar: identity.avatar || '',
    identityId: identity.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    contacts: {},
    contactOrder: [],
    suppressedContacts: [],
    relationships: {},
    threads: {},
    threadOrder: [],
    calls: [],
    posts: [],
    stories: [],
    instagram: { posts: [], stories: [], notifications: [], threads: {}, threadOrder: [] },
    snapchat: { stories: [], memories: [], eyesOnly: [], notifications: [], threads: {}, threadOrder: [] },
    facebook: { posts: [], notifications: [], friendRequests: [], marketplace: { listings: [] }, threads: {}, threadOrder: [] },
    dominos: { cart: [], notifications: [] },
    uber: { savedDestination: '', notifications: [] },
    onlyfans: { posts: [], notifications: [], threads: {}, threadOrder: [] },
    darkweb: { notifications: [], threads: {}, threadOrder: [] },
    notifications: [],
    photos: [],
    notes: [],
    mail: [],
    refresh: { lastAt: null, chatLength: 0, eventKeys: [], summary: '' },
  };
}

function phoneRecords() {
  const root = phoneMetadataRoot();
  if (!root?.phones) return [];
  return Object.entries(root.phones).map(([key, timeline]) => ({ key, timeline }));
}

function uniquePhoneNumber(excludeIdentityId = '') {
  const used = new Set(identities()
    .filter(x => x.id !== excludeIdentityId)
    .map(x => String(x.phoneNumber || '').replace(/\D/g, ''))
    .filter(x => /^\d{9}$/.test(x)));

  for (let i = 0; i < 500; i++) {
    const n = String(100000000 + Math.floor(Math.random() * 900000000));
    if (!used.has(n)) return n;
  }
  throw new Error('Could not generate a unique phone number.');
}

function createPhoneRecord(identityId) {
  const who = identityById(identityId);
  const root = phoneMetadataRoot(true);
  if (!who || !root) throw new Error('Open a chat and select a valid identity.');
  root.phones ||= {};

  if (Object.values(root.phones).some(t => String(t?.identityId || '') === String(who.id))) {
    throw new Error(`${who.name} already has a phone record in this chat.`);
  }

  const key = `latent-id:${encodeURIComponent(who.id)}`;
  root.phones[key] = defaultPhoneTimeline(who);
  savePhoneMetadata(root);
  return key;
}

function deletePhoneRecord(key) {
  const root = phoneMetadataRoot();
  if (!root?.phones?.[key]) return false;
  delete root.phones[key];
  savePhoneMetadata(root);
  return true;
}

function reassignPhoneRecord(key, targetIdentityId) {
  const root = phoneMetadataRoot();
  const api = phoneApi();
  const timeline = root?.phones?.[key];
  const target = identityById(targetIdentityId);

  if (!root || !timeline || !target) throw new Error('Phone or target identity is missing.');

  const duplicate = Object.entries(root.phones).find(([otherKey, t]) =>
    otherKey !== key && String(t?.identityId || '') === String(target.id)
  );
  if (duplicate) throw new Error(`${target.name} already has another phone record. Delete or repair that duplicate first.`);

  const oldIdentity = identityById(timeline.identityId);
  const oldNumber = oldIdentity?.phoneNumber || '';

  if (oldIdentity && oldIdentity.id !== target.id && /^\d{9}$/.test(String(oldNumber).replace(/\D/g, ''))) {
    if (typeof api?.setIdentityPhoneNumber === 'function') {
      const replacement = uniquePhoneNumber(oldIdentity.id);
      api.setIdentityPhoneNumber(oldIdentity.id, replacement);
      api.setIdentityPhoneNumber(target.id, String(oldNumber).replace(/\D/g, ''));
    }
  }

  timeline.identityId = target.id;
  timeline.ownerName = target.name;
  timeline.ownerAvatar = target.avatar || timeline.ownerAvatar || '';
  timeline.updatedAt = Date.now();

  const newKey = `latent-id:${encodeURIComponent(target.id)}`;
  delete root.phones[key];
  root.phones[newKey] = timeline;
  savePhoneMetadata(root);
  return newKey;
}

function repairPhoneBindings() {
  const root = phoneMetadataRoot();
  if (!root?.phones) return 0;

  let changed = 0;

  /*
   * First repair the exact situation visible in the manager:
   * a phone record is attached to an old same-name identity while the current
   * SillyTavern character has a newer canonical identity.
   */
  const duplicateMap = new Map();
  for (const group of identityDuplicateGroups()) {
    for (const duplicate of group.duplicates) {
      duplicateMap.set(duplicate.id, group.canonical.id);
    }
  }

  for (const { key, timeline } of phoneRecords()) {
    const replacementId = duplicateMap.get(String(timeline?.identityId || ''));
    if (!replacementId) continue;

    const alreadyClaimed = Object.entries(root.phones).some(([otherKey, other]) =>
      otherKey !== key && String(other?.identityId || '') === String(replacementId)
    );
    if (alreadyClaimed) continue;

    try {
      reassignPhoneRecord(key, replacementId);
      changed++;
    } catch (error) {
      console.warn(`[${GHLA_MODULE}] duplicate phone binding repair`, error);
    }
  }

  const refreshedRoot = phoneMetadataRoot();
  if (!refreshedRoot?.phones) return changed;

  const claimed = new Set(
    Object.values(refreshedRoot.phones).map(t => String(t?.identityId || '')).filter(Boolean)
  );

  /*
   * Then repair true orphan records whose identity ID no longer exists,
   * but only when one exact-name candidate is available and unclaimed.
   */
  const candidates = managerIdentityCandidates();

  for (const timeline of Object.values(refreshedRoot.phones)) {
    const current = identityById(timeline?.identityId);
    if (current) {
      timeline.ownerName = current.name;
      timeline.ownerAvatar = current.avatar || timeline.ownerAvatar || '';
      continue;
    }

    const matches = candidates.filter(x => lc(x.name) === lc(timeline?.ownerName));
    const exact = matches.length === 1 ? matches[0] : null;

    if (exact && !claimed.has(exact.id)) {
      timeline.identityId = exact.id;
      timeline.ownerName = exact.name;
      timeline.ownerAvatar = exact.avatar || timeline.ownerAvatar || '';
      claimed.add(exact.id);
      changed++;
    }
  }

  if (changed) savePhoneMetadata(refreshedRoot);
  return changed;
}


function phoneSettingsRoot(create = true) {
  const c = ctx();
  if (!c?.extensionSettings) return null;

  let root = c.extensionSettings[PHONE_SETTINGS_KEY];
  if ((!root || typeof root !== 'object') && create) {
    root = { profiles: {}, identities: {}, socialProfiles: {}, appRoles: {}, onlyFansAccounts: {} };
    c.extensionSettings[PHONE_SETTINGS_KEY] = root;
  }
  if (!root) return null;

  if (!root.identities || typeof root.identities !== 'object' || Array.isArray(root.identities)) root.identities = {};
  if (!root.socialProfiles || typeof root.socialProfiles !== 'object' || Array.isArray(root.socialProfiles)) root.socialProfiles = {};
  if (!root.appRoles || typeof root.appRoles !== 'object' || Array.isArray(root.appRoles)) root.appRoles = {};
  if (!root.onlyFansAccounts || typeof root.onlyFansAccounts !== 'object' || Array.isArray(root.onlyFansAccounts)) root.onlyFansAccounts = {};
  return root;
}

function activeCharacterIdentityIds() {
  const ids = new Set();
  const c = ctx();

  for (let index = 0; index < (c?.characters || []).length; index++) {
    const ch = c.characters[index];
    const stable = String(ch?.avatar || ch?.data?.avatar || '').trim();
    const name = norm(ch?.name || `character-${index}`);
    const identityId = stable
      ? `character:${encodeURIComponent(stable)}`
      : `character-name:${encodeURIComponent(name)}`;
    ids.add(identityId);
  }

  return ids;
}

function identityRegistryRows() {
  const root = phoneSettingsRoot(false);
  if (!root) return [];
  return Object.entries(root.identities || {})
    .map(([key, raw]) => ({
      key,
      id: String(raw?.id || key),
      kind: String(raw?.kind || 'character'),
      name: norm(raw?.name || 'Unknown'),
      avatar: String(raw?.avatar || ''),
      phoneNumber: String(raw?.phoneNumber || '').replace(/\D/g, '').slice(0, 9),
      createdAt: Number(raw?.createdAt || 0),
      updatedAt: Number(raw?.updatedAt || 0),
      raw,
    }))
    .filter(x => x.id && x.kind !== 'provisional');
}

function identityManagerScore(row, activeIds, assignedIds, currentId) {
  let score = 0;
  if (activeIds.has(row.id)) score += 1000;
  if (assignedIds.has(row.id)) score += 500;
  if (row.id === currentId) score += 300;
  if (row.kind === 'character') score += 40;
  if (/^\d{9}$/.test(row.phoneNumber)) score += 10;
  score += Math.min(9, Math.floor(Math.max(0, row.updatedAt) / 1e12));
  return score;
}

function identityDuplicateGroups() {
  // Ensure the current character cards have canonical identities before grouping.
  try { phoneApi()?.listIdentities?.(); } catch {}

  const rows = identityRegistryRows();
  const activeIds = activeCharacterIdentityIds();
  const phoneRows = phoneRecords();
  const assignedIds = new Set(phoneRows.map(x => String(x.timeline?.identityId || '')).filter(Boolean));
  const currentId = currentIdentity()?.id || '';
  const byName = new Map();

  for (const row of rows) {
    const key = lc(row.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }

  const groups = [];
  for (const rowsForName of byName.values()) {
    if (rowsForName.length < 2) continue;

    const ranked = [...rowsForName].sort((a, b) => {
      const diff = identityManagerScore(b, activeIds, assignedIds, currentId) -
        identityManagerScore(a, activeIds, assignedIds, currentId);
      return diff || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
    });

    const canonical = ranked[0];
    const duplicates = ranked.slice(1).map(row => ({
      ...row,
      activeCharacter: activeIds.has(row.id),
      hasPhoneRecord: assignedIds.has(row.id),
      deletable: !activeIds.has(row.id) && !assignedIds.has(row.id),
    }));

    groups.push({
      name: canonical.name,
      canonical: {
        ...canonical,
        activeCharacter: activeIds.has(canonical.id),
        hasPhoneRecord: assignedIds.has(canonical.id),
      },
      duplicates,
    });
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name));
}

function managerIdentityCandidates() {
  try { phoneApi()?.listIdentities?.(); } catch {}

  const rows = identityRegistryRows();
  const activeIds = activeCharacterIdentityIds();
  const currentId = String(currentIdentity()?.id || '');

  return rows
    .filter(row => activeIds.has(String(row.id)) || String(row.id) === currentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function orphanIdentityRows() {
  try { phoneApi()?.listIdentities?.(); } catch {}

  const activeIds = activeCharacterIdentityIds();
  const currentId = String(currentIdentity()?.id || '');
  const assignedIds = new Set(
    phoneRecords().map(x => String(x.timeline?.identityId || '')).filter(Boolean)
  );

  return identityRegistryRows()
    .filter(row =>
      !activeIds.has(String(row.id)) &&
      String(row.id) !== currentId &&
      !assignedIds.has(String(row.id))
    )
    .sort((a, b) => a.name.localeCompare(b.name) || b.updatedAt - a.updatedAt);
}

function removeExactIdentityReferences(value, oldId, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      if (value[i] === oldId) value.splice(i, 1);
      else removeExactIdentityReferences(value[i], oldId, seen);
    }
    return;
  }

  if (Object.prototype.hasOwnProperty.call(value, oldId)) delete value[oldId];

  for (const key of Object.keys(value)) {
    const current = value[key];
    if (current === oldId) {
      value[key] = '';
    } else {
      removeExactIdentityReferences(current, oldId, seen);
    }
  }
}

function detachIdentityFromLife(identityId, fallbackName = 'Deleted character') {
  const s = state();
  if (!s) return;

  s.mechanics = (s.mechanics || []).filter(x => String(x.identityId || '') !== String(identityId));
  s.agencies = (s.agencies || []).filter(x => String(x.identityId || '') !== String(identityId));

  for (const vehicle of Object.values(s.vehicles || {})) {
    if (vehicle?.owner?.kind === 'identity' && String(vehicle.owner.identityId) === String(identityId)) {
      vehicle.owner = { kind: 'external', relation: 'untracked', label: vehicle.owner.name || fallbackName };
      vehicle.updatedAt = Date.now();
    }
  }

  for (const property of Object.values(s.properties || {})) {
    if (property?.owner?.kind === 'identity' && String(property.owner.identityId) === String(identityId)) {
      property.owner = { kind: 'external', relation: 'untracked', label: property.owner.name || fallbackName };
      property.updatedAt = Date.now();
    }
    property.tenants = (property.tenants || []).filter(x => String(x.identityId || '') !== String(identityId));
    property.occupants = (property.occupants || []).filter(x => String(x.identityId || '') !== String(identityId));
    syncPropertyRentShares(property);
  }

  delete s.favorites?.vehicles?.[identityId];
  delete s.favorites?.properties?.[identityId];
}

function deleteOrphanIdentity(identityId) {
  const root = phoneSettingsRoot(false);
  const row = identityRegistryRows().find(x => String(x.id) === String(identityId));
  if (!root?.identities?.[identityId] || !row) throw new Error('That old identity no longer exists.');

  const activeIds = activeCharacterIdentityIds();
  const currentId = String(currentIdentity()?.id || '');
  const hasPhoneRecord = phoneRecords().some(x => String(x.timeline?.identityId || '') === String(identityId));

  if (activeIds.has(String(identityId)) || String(identityId) === currentId) {
    throw new Error('This identity belongs to a current SillyTavern character/persona and is protected.');
  }
  if (hasPhoneRecord) {
    throw new Error('This identity still has a phone record in this chat. Delete or reassign that phone first.');
  }

  const phoneRoot = phoneMetadataRoot(false);
  if (phoneRoot) {
    removeExactIdentityReferences(phoneRoot, identityId);
    savePhoneMetadata(phoneRoot);
  }

  detachIdentityFromLife(identityId, row.name);
  removeExactIdentityReferences(root.appRoles, identityId);

  delete root.socialProfiles?.[identityId];
  delete root.onlyFansAccounts?.[identityId];
  delete root.identities[identityId];

  saveSettings();
  return row;
}

function replaceExactIdentityReferences(value, oldId, newId, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (value[i] === oldId) value[i] = newId;
      else replaceExactIdentityReferences(value[i], oldId, newId, seen);
    }
    return;
  }

  // Some Greyhaven Phone stores (notably relationships/app roles) use an
  // identity ID as an object KEY rather than a value. Re-key that too.
  if (Object.prototype.hasOwnProperty.call(value, oldId)) {
    if (!Object.prototype.hasOwnProperty.call(value, newId)) {
      value[newId] = value[oldId];
    } else if (
      value[newId] && typeof value[newId] === 'object' &&
      value[oldId] && typeof value[oldId] === 'object' &&
      !Array.isArray(value[newId]) && !Array.isArray(value[oldId])
    ) {
      Object.assign(value[newId], value[oldId]);
    }
    delete value[oldId];
  }

  for (const key of Object.keys(value)) {
    const current = value[key];
    if (current === oldId) value[key] = newId;
    else replaceExactIdentityReferences(current, oldId, newId, seen);
  }
}

function deleteDuplicateIdentity(identityId) {
  const root = phoneSettingsRoot(false);
  if (!root?.identities?.[identityId]) throw new Error('That identity no longer exists.');

  const groups = identityDuplicateGroups();
  const group = groups.find(g => g.duplicates.some(x => x.id === identityId));
  const duplicate = group?.duplicates.find(x => x.id === identityId);

  if (!group || !duplicate) throw new Error('This identity is not currently classified as a duplicate.');
  if (!duplicate.deletable) {
    if (duplicate.activeCharacter) throw new Error('This identity belongs to a current SillyTavern character card. Delete or rename the duplicate card instead.');
    if (duplicate.hasPhoneRecord) throw new Error('This identity still owns a phone record. Delete or reassign that phone first.');
    throw new Error('This duplicate cannot be safely removed yet.');
  }

  const replacementId = group.canonical.id;

  // Preserve references in the current chat and in Life world state by moving
  // them to the canonical same-name identity before deleting the orphan ID.
  const phoneRoot = phoneMetadataRoot(false);
  if (phoneRoot) {
    replaceExactIdentityReferences(phoneRoot, identityId, replacementId);
    savePhoneMetadata(phoneRoot);
  }

  const life = state();
  if (life) replaceExactIdentityReferences(life, identityId, replacementId);

  replaceExactIdentityReferences(root.appRoles, identityId, replacementId);

  if (root.onlyFansAccounts?.[identityId]) {
    if (!root.onlyFansAccounts[replacementId]) {
      root.onlyFansAccounts[replacementId] = root.onlyFansAccounts[identityId];
      root.onlyFansAccounts[replacementId].identityId = replacementId;
    }
    delete root.onlyFansAccounts[identityId];
  }

  // Duplicate social counters are not merged: the canonical card has its own
  // deterministic profile. Removing the stale profile avoids double accounts.
  delete root.socialProfiles?.[identityId];
  delete root.identities[identityId];

  saveSettings();
  return { deleted: identityId, kept: replacementId, name: group.name };
}

function deleteAllSafeDuplicateIdentities() {
  let count = 0;
  while (true) {
    const next = identityDuplicateGroups()
      .flatMap(g => g.duplicates)
      .find(x => x.deletable);
    if (!next) break;
    deleteDuplicateIdentity(next.id);
    count++;
  }
  return count;
}

function duplicatePhoneKeys() {
  const rows = phoneRecords();
  const seen = new Map();
  const duplicates = new Set();

  for (const row of rows) {
    const t = row.timeline || {};
    const token = t.identityId ? `id:${t.identityId}` : `name:${lc(t.ownerName)}`;
    if (!token || token === 'name:') continue;
    if (seen.has(token)) {
      duplicates.add(row.key);
      duplicates.add(seen.get(token));
    } else seen.set(token, row.key);
  }

  return duplicates;
}

/* ---------------- UI primitives ---------------- */

function ensureCss() {
  if (document.querySelector('#ghla-stylesheet')) return;
  const link = document.createElement('link');
  link.id = 'ghla-stylesheet';
  link.rel = 'stylesheet';
  link.href = new URL('./life-assets.css', import.meta.url).href;
  document.head.appendChild(link);
}

function lifeIconMarkup() {
  return `<button class="ghp-app-icon ghla-life-folder-icon" data-ghla-open-life aria-label="Open Life folder">
    <span class="ghp-app-square ghla-folder-preview">
      <i class="fa-solid fa-car-side"></i>
      <i class="fa-solid fa-house"></i>
      <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
    </span>
    <small>Life</small>
  </button>`;
}

function injectLifeIcon() {
  const grid = qs('#ghp-overlay:not([hidden]) .ghp-home .ghp-grid');
  if (!grid) return;

  const existing = qs('[data-ghla-open-life]', grid);
  if (existing) return;

  const html = lifeIconMarkup();

  // Keep Life high on the first home-screen page: directly after Uber when
  // Uber exists, otherwise before Settings, otherwise at the start.
  const uber = qs('[data-open-app="uber"]', grid);
  if (uber) return uber.insertAdjacentHTML('afterend', html);

  const settings = qs('[data-open-app="settings"]', grid);
  if (settings) return settings.insertAdjacentHTML('beforebegin', html);

  grid.insertAdjacentHTML('afterbegin', html);
}

function injectManagerSettings() {
  // v2.4.0 placed this in the quick Extensions menu. Remove that old entry.
  qs('#ghla-manager-entry')?.remove();

  const installButton = qs('#third_party_extension_button');
  const block = installButton?.closest?.('.extensions_block');
  if (!installButton || !block || qs('#ghla-manager-settings-button', block)) return;

  const button = document.createElement('div');
  button.id = 'ghla-manager-settings-button';
  button.className = 'menu_button menu_button_icon ghla-manager-settings-button';
  button.tabIndex = 0;
  button.title = 'Open Greyhaven Phone Manager';
  button.innerHTML = '<i class="fa-solid fa-screwdriver-wrench"></i><span>Greyhaven Phone Manager</span>';
  button.addEventListener('click', openPhoneManager);
  button.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPhoneManager();
    }
  });

  installButton.insertAdjacentElement('afterend', button);
}

function ensureLifeLayer() {
  const content = qs('#ghp-overlay:not([hidden]) .ghp-content');
  if (!content) return null;

  let layer = qs('#ghla-layer', content);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'ghla-layer';
    layer.addEventListener('click', handleLifeClick);
    layer.addEventListener('submit', handleLifeSubmit);
    content.appendChild(layer);
  }

  return layer;
}


function syncLifeFolderBlur() {
  const overlay = qs('#ghp-overlay');
  if (!overlay) return;
  overlay.classList.toggle('ghla-folder-open', lifeOpen && lifeView.app === 'home');
}

function openLife(appName = 'home') {
  lifeOpen = true;
  lifeView = {
    app: appName,
    tab: appName === 'garage' ? 'owned' : appName === 'property' ? 'owned' : '',
    detailId: '',
  };
  syncLifeFolderBlur();
  renderLife();
}

function closeLife() {
  lifeOpen = false;
  lifeView = { app: 'home', tab: '', detailId: '' };
  syncLifeFolderBlur();
  qs('#ghla-layer')?.remove();
}

function lifeBack() {
  if (lifeView.detailId) {
    lifeView.detailId = '';
    return renderLife();
  }
  if (lifeView.app !== 'home') {
    lifeView = { app: 'home', tab: '', detailId: '' };
    syncLifeFolderBlur();
    return renderLife();
  }
  closeLife();
}

function personChip(owner) {
  const name = ownerName(owner);
  const identity = owner?.kind === 'identity' ? identityById(owner.identityId) : null;
  const av = avatarUrl(identity);
  return `<span class="ghla-person-chip">${av ? `<img src="${esc(av)}" alt="">` : '<i class="fa-solid fa-user"></i>'}<b>${esc(name)}</b></span>`;
}

function emptyState(icon, title, text) {
  return `<div class="ghla-empty"><i class="${icon}"></i><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
}

function tabs(items, selected) {
  return `<nav class="ghla-tabs">${items.map(([key, label]) =>
    `<button type="button" data-ghla-tab="${esc(key)}" class="${key === selected ? 'active' : ''}">${esc(label)}</button>`
  ).join('')}</nav>`;
}

function lifeHeader(title, subtitle = '') {
  return `<header class="ghla-header">
    <button type="button" data-ghla-back><i class="fa-solid fa-chevron-left"></i></button>
    <div><b>${esc(title)}</b>${subtitle ? `<small>${esc(subtitle)}</small>` : ''}</div>
    <span></span>
  </header>`;
}

function renderLifeHome() {
  const s = normalizeAll();
  const me = currentIdentity();
  const mineVehicles = Object.values(s.vehicles).filter(x => isOwner(x, me?.id)).length;
  const mineProperties = Object.values(s.properties).filter(x =>
    isOwner(x, me?.id) || x.tenants.some(t => t.identityId === me?.id) || x.occupants.some(t => t.identityId === me?.id)
  ).length;

  return `<div class="ghla-folder-overlay" data-ghla-folder-backdrop>
    <h1>Life</h1>
    <section class="ghla-ios-folder" aria-label="Life folder">
      <button type="button" class="ghla-ios-folder-app" data-ghla-app="garage">
        <span class="ghla-ios-app-icon vehicle"><i class="fa-solid fa-car-side"></i></span>
        <b>Garage</b>
        <small>${mineVehicles ? `${mineVehicles} mine` : ''}</small>
      </button>
      <button type="button" class="ghla-ios-folder-app" data-ghla-app="property">
        <span class="ghla-ios-app-icon property"><i class="fa-solid fa-house"></i></span>
        <b>Property</b>
        <small>${mineProperties ? `${mineProperties} linked` : ''}</small>
      </button>
    </section>
  </div>`;
}

function vehicleTitle(v) {
  return [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
}

function propertySubtitle(p) {
  return [p.type, p.area, p.city].filter(Boolean).join(' · ');
}

function renderGarage() {
  const s = normalizeAll();
  const me = currentIdentity();
  const tab = lifeView.tab || 'owned';

  let body = '';

  if (lifeView.detailId) {
    const v = s.vehicles[lifeView.detailId];
    if (!v) { lifeView.detailId = ''; return renderGarage(); }
    const mine = isOwner(v, me?.id);
    const listing = activeListingForAsset('vehicle', v.id);
    const repairs = Object.values(s.serviceRequests).filter(x => x.vehicleId === v.id).sort((a, b) => b.createdAt - a.createdAt);

    body = `<main class="ghla-detail">
      <section class="ghla-hero-card">
        <i class="${v.type === 'motorcycle' ? 'fa-solid fa-motorcycle' : v.type === 'boat' ? 'fa-solid fa-sailboat' : v.type === 'airplane' ? 'fa-solid fa-plane' : 'fa-solid fa-car-side'}"></i>
        <div><h2>${esc(vehicleTitle(v))}</h2><span>${esc(v.color || v.type)} · ${esc(v.condition)}</span></div>
        ${lifeFavoriteButton('vehicles', v.id)}
      </section>
      <div class="ghla-facts">
        <div><small>Owner</small>${personChip(v.owner)}</div>
        <div><small>Mileage</small><b>${Number(v.mileage || 0).toLocaleString()} km</b></div>
        <div><small>Plate / ID</small><b>${esc(v.plate || 'Not set')}</b></div>
        <div><small>Status</small><b>${esc(v.status)}</b></div>
      </div>
      ${v.notes ? `<section class="ghla-card"><p>${esc(v.notes)}</p></section>` : ''}
      <div class="ghla-actions">
        <button type="button" data-ghla-edit-vehicle="${esc(v.id)}"><i class="fa-solid fa-pen"></i> Edit</button>
        ${mine && !listing ? `<button type="button" data-ghla-list-vehicle="${esc(v.id)}"><i class="fa-solid fa-tag"></i> List / rent</button>` : ''}
        ${mine ? `<button type="button" data-ghla-repair-vehicle="${esc(v.id)}"><i class="fa-solid fa-screwdriver-wrench"></i> Repair service</button>` : ''}
      </div>
      ${listing ? `<section class="ghla-card"><b>Active listing</b><span>${listing.mode === 'rent' ? `${money(listing.dailyRate)}/day` : money(listing.price)}</span>${mine ? `<button type="button" data-ghla-remove-vehicle-listing="${esc(listing.id)}">Remove listing</button>` : ''}</section>` : ''}
      ${repairs.length ? `<section class="ghla-card"><b>Service history</b>${repairs.map(r => `<div class="ghla-mini-row"><span>${esc(r.issue)}</span><small>${esc(r.status)}${r.finalPrice ? ` · ${money(r.finalPrice)}` : ''}</small></div>`).join('')}</section>` : ''}
    </main>`;
  } else if (tab === 'owned') {
    const rows = Object.values(s.vehicles)
      .filter(x => x.status === 'active' && (isOwner(x, me?.id) || Object.values(s.vehicleRentals).some(r => r.assetId === x.id && r.renterIdentityId === me?.id && ['booked', 'active'].includes(r.status))))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    body = `<main>
      <div class="ghla-toolbar"><button type="button" data-ghla-add-vehicle class="primary"><i class="fa-solid fa-plus"></i> Add vehicle</button></div>
      ${rows.length ? rows.map(v => `<button type="button" class="ghla-row" data-ghla-vehicle="${esc(v.id)}">
        <i class="${v.type === 'motorcycle' ? 'fa-solid fa-motorcycle' : v.type === 'boat' ? 'fa-solid fa-sailboat' : v.type === 'airplane' ? 'fa-solid fa-plane' : 'fa-solid fa-car-side'}"></i>
        <span><b>${esc(vehicleTitle(v))}</b><small>${esc(ownerName(v.owner))} · ${esc(v.condition)}</small></span>
        <i class="fa-solid fa-chevron-right"></i>
      </button>`).join('') : emptyState('fa-solid fa-car', 'No vehicles yet', 'Add cars, motorcycles, boats or aircraft manually.')}
    </main>`;
  } else if (tab === 'market') {
    const vehicleCity = lc(s.market.vehicleRefresh.city || 'Greyhaven');
    const vehicleType = s.market.vehicleRefresh.type || 'all';
    const vehicleMode = s.market.vehicleRefresh.mode || 'all';
    const listings = Object.values(s.vehicleListings)
      .filter(x =>
        x.status === 'available' &&
        (!vehicleCity || lc(x.city) === vehicleCity) &&
        (vehicleType === 'all' || x.type === vehicleType) &&
        (vehicleMode === 'all' || x.mode === vehicleMode)
      )
      .sort((a, b) => b.createdAt - a.createdAt);

    body = `<main>
      <form class="ghla-market-search vehicle" data-ghla-vehicle-search>
        <input name="city" value="${esc(s.market.vehicleRefresh.city || 'Greyhaven')}" placeholder="City">
        <select name="type">
          ${['all', 'car', 'motorcycle', 'boat', 'airplane'].map(x => `<option value="${x}"${s.market.vehicleRefresh.type === x ? ' selected' : ''}>${x === 'all' ? 'All vehicles' : x}</option>`).join('')}
        </select>
        <select name="mode">
          <option value="all"${s.market.vehicleRefresh.mode === 'all' ? ' selected' : ''}>Sale or rental</option>
          <option value="sale"${s.market.vehicleRefresh.mode === 'sale' ? ' selected' : ''}>For sale</option>
          <option value="rent"${s.market.vehicleRefresh.mode === 'rent' ? ' selected' : ''}>Rental only</option>
        </select>
        <button type="submit" class="primary">${vehicleRefreshBusy ? 'Refreshing…' : '<i class="fa-solid fa-arrows-rotate"></i> Refresh'}</button>
      </form>
      <small class="ghla-muted">Discoveries become persistent owned assets first, so no character can sell a vehicle that does not exist in world state.</small>
      ${listings.length ? listings.map(l => {
        const v = s.vehicles[l.assetId];
        if (!v) return '';
        return `<article class="ghla-market-card">
          <div class="ghla-market-icon"><i class="${v.type === 'motorcycle' ? 'fa-solid fa-motorcycle' : v.type === 'boat' ? 'fa-solid fa-sailboat' : v.type === 'airplane' ? 'fa-solid fa-plane' : 'fa-solid fa-car-side'}"></i></div>
          <div class="ghla-market-main"><b>${esc(vehicleTitle(v))}</b><small>${esc(l.city)} · ${esc(ownerName(v.owner))}</small><p>${esc(l.description || v.notes || '')}</p></div>
          <strong>${l.mode === 'rent' ? `${money(l.dailyRate)}/day` : money(l.price)}</strong>
          <div class="ghla-market-actions">
            ${lifeFavoriteButton('vehicles', v.id)}
            <button type="button" data-ghla-message-vehicle="${esc(l.id)}">Message</button>
            ${l.mode === 'sale' ? `<button type="button" data-ghla-buy-vehicle="${esc(l.id)}">Buy</button>` : `<button type="button" data-ghla-rent-vehicle="${esc(l.id)}">Rent</button>`}
            ${l.sellerIdentityId === me?.id ? `<button type="button" data-ghla-complete-vehicle-sale="${esc(l.id)}">${l.mode === 'sale' ? 'Complete sale' : 'Manage'}</button>` : ''}
          </div>
        </article>`;
      }).join('') : emptyState('fa-solid fa-store', 'No market listings', 'Refresh to discover realistic vehicles from the wider world.')}
    </main>`;
  } else if (tab === 'saved') {
    const rows = favoriteAssetIds('vehicles')
      .map(idValue => s.vehicles[idValue])
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    body = `<main>
      <h3 class="ghla-section-title">Saved vehicles</h3>
      ${rows.length ? rows.map(v => `<div class="ghla-saved-asset">
        <button type="button" class="ghla-row" data-ghla-vehicle="${esc(v.id)}">
          <i class="${v.type === 'motorcycle' ? 'fa-solid fa-motorcycle' : v.type === 'boat' ? 'fa-solid fa-sailboat' : v.type === 'airplane' ? 'fa-solid fa-plane' : 'fa-solid fa-car-side'}"></i>
          <span><b>${esc(vehicleTitle(v))}</b><small>${esc(ownerName(v.owner))} · ${esc(v.condition)}</small></span>
          <i class="fa-solid fa-chevron-right"></i>
        </button>
        ${lifeFavoriteButton('vehicles', v.id)}
      </div>`).join('') : emptyState('fa-regular fa-heart', 'No saved vehicles', 'Heart a vehicle in Market or its detail page to keep it here.')}
    </main>`;
  } else if (tab === 'rentals') {
    const rows = Object.values(s.vehicleRentals)
      .filter(x => x.renterIdentityId === me?.id)
      .sort((a, b) => b.createdAt - a.createdAt);

    body = `<main>${rows.length ? rows.map(r => {
      const v = s.vehicles[r.assetId];
      return `<section class="ghla-card">
        <b>${esc(vehicleTitle(v || {}))}</b>
        <span>${new Date(r.startAt).toLocaleString()} → ${new Date(r.endAt).toLocaleString()}</span>
        <small>${money(r.total)} · ${esc(r.status)}</small>
        ${['booked', 'active'].includes(r.status) ? `<button type="button" data-ghla-return-rental="${esc(r.id)}">Mark returned</button>` : ''}
      </section>`;
    }).join('') : emptyState('fa-solid fa-calendar-check', 'No vehicle rentals', 'Rentals you book from the market appear here with return reminders.')}</main>`;
  } else if (tab === 'service') {
    const requests = Object.values(s.serviceRequests)
      .filter(x => x.ownerIdentityId === me?.id || x.mechanicIdentityId === me?.id)
      .sort((a, b) => b.createdAt - a.createdAt);

    body = `<main>
      <div class="ghla-toolbar"><button type="button" data-ghla-add-mechanic><i class="fa-solid fa-user-plus"></i> Add mechanic</button></div>
      <section class="ghla-card"><b>Assigned mechanics</b>${s.mechanics.length ? s.mechanics.map(m => `<div class="ghla-mini-row"><span>${esc(m.name)}${m.label ? ` · ${esc(m.label)}` : ''}</span><button type="button" data-ghla-remove-mechanic="${esc(m.id)}"><i class="fa-solid fa-xmark"></i></button></div>`).join('') : '<small>No mechanic characters assigned yet.</small>'}</section>
      ${requests.length ? requests.map(r => `<section class="ghla-card">
        <b>${esc(vehicleTitle(s.vehicles[r.vehicleId] || {}))}</b>
        <span>${esc(r.issue)}</span><small>${esc(r.mechanicName)} · ${esc(r.status)}${r.towing ? ' · towing' : ''}</small>
        <div class="ghla-inline">
          ${r.status !== 'completed' && r.status !== 'cancelled' ? `<button type="button" data-ghla-service-status="${esc(r.id)}" data-status="completed">Complete</button>` : ''}
          ${r.status === 'requested' ? `<button type="button" data-ghla-service-status="${esc(r.id)}" data-status="cancelled">Cancel</button>` : ''}
        </div>
      </section>`).join('') : emptyState('fa-solid fa-wrench', 'No repair requests', 'Open one of your vehicles and request service when RP damage happens.')}
    </main>`;
  }

  return `<div class="ghla-screen">
    ${lifeHeader('Garage', 'Vehicles & mobility')}
    ${tabs([['owned', 'My vehicles'], ['market', 'Market'], ['saved', 'Saved'], ['rentals', 'Rentals'], ['service', 'Service']], tab)}
    ${body}
  </div>`;
}

function renderProperty() {
  const s = normalizeAll();
  const me = currentIdentity();
  const tab = lifeView.tab || 'owned';

  let body = '';

  if (lifeView.detailId) {
    const p = s.properties[lifeView.detailId];
    if (!p) { lifeView.detailId = ''; return renderProperty(); }

    const mine = isOwner(p, me?.id);
    const tenant = p.tenants.some(x => x.identityId === me?.id);
    const listing = activeListingForAsset('property', p.id);

    body = `<main class="ghla-detail">
      <section class="ghla-hero-card property">
        <i class="${p.type === 'land' ? 'fa-solid fa-map' : p.type === 'business' ? 'fa-solid fa-building' : p.type === 'villa' ? 'fa-solid fa-house-chimney-window' : 'fa-solid fa-house'}"></i>
        <div><h2>${esc(p.name)}</h2><span>${esc(propertySubtitle(p))}</span></div>
        ${lifeFavoriteButton('properties', p.id)}
      </section>
      <div class="ghla-facts">
        <div><small>Owner</small>${personChip(p.owner)}</div>
        <div><small>Size</small><b>${p.sizeSqm ? `${p.sizeSqm.toLocaleString()} m²` : 'Not set'}</b></div>
        <div><small>Rooms</small><b>${p.rooms || '—'} · ${p.bedrooms || 0} bed</b></div>
        <div><small>Short stays</small><b>${p.shortTermEligible ? 'Eligible' : 'No'}</b></div>
      </div>
      ${p.address ? `<section class="ghla-card"><b>Address</b><span>${esc(p.address)}, ${esc(p.city)}</span></section>` : ''}
      ${p.description ? `<section class="ghla-card"><p>${esc(p.description)}</p></section>` : ''}
      <section class="ghla-card"><b>Household / tenancy</b>
        ${p.monthlyRent ? `<div class="ghla-mini-row ghla-rent-total"><span>Total monthly rent</span><strong>${money(p.monthlyRent)}/mo</strong></div>` : ''}
        ${p.tenants.length ? p.tenants.map(t => {
          const share = propertyTenantRentShare(p, t);
          const suffix = p.rentSplit === 'equal'
            ? `Tenant · ${money(share)}/mo share`
            : p.rentSplit === 'custom' && share
              ? `Tenant · ${money(share)}/mo`
              : p.tenants.length === 1 && share
                ? `Tenant · ${money(share)}/mo`
                : 'Tenant';
          return `<div class="ghla-mini-row"><span>${esc(identityById(t.identityId)?.name || t.name || 'Tenant')}</span><small>${suffix}</small></div>`;
        }).join('') : '<small>No tracked tenants.</small>'}
        ${p.rentSplit === 'equal' && p.monthlyRent ? `<small>Split equally between ${propertyEqualRentPayers(p)} rent payer${propertyEqualRentPayers(p) === 1 ? '' : 's'}.</small>` : ''}
        ${p.untrackedHousemates ? `<small>${p.untrackedHousemates} additional untracked household member${p.untrackedHousemates === 1 ? '' : 's'}.</small>` : ''}
      </section>
      <div class="ghla-actions">
        <button type="button" data-ghla-edit-property="${esc(p.id)}"><i class="fa-solid fa-pen"></i> Edit</button>
        ${mine && !listing ? `<button type="button" data-ghla-list-property="${esc(p.id)}"><i class="fa-solid fa-tag"></i> Sell / rent out</button>` : ''}
        ${tenant ? `<button type="button" data-ghla-end-tenancy="${esc(p.id)}">End my tenancy</button>` : ''}
      </div>
      ${listing ? `<section class="ghla-card"><b>Active listing</b><span>${listing.mode === 'rent' ? `${money(listing.monthlyRent)}/month` : money(listing.price)}</span>${listing.agencyName ? `<small>Agency: ${esc(listing.agencyName)}</small>` : ''}${mine ? `<button type="button" data-ghla-remove-property-listing="${esc(listing.id)}">Remove listing</button>` : ''}</section>` : ''}
    </main>`;
  } else if (tab === 'owned') {
    const rows = Object.values(s.properties)
      .filter(p => p.status === 'active' && (
        isOwner(p, me?.id) ||
        p.tenants.some(t => t.identityId === me?.id) ||
        p.occupants.some(t => t.identityId === me?.id)
      ))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    body = `<main>
      <div class="ghla-toolbar"><button type="button" data-ghla-add-property class="primary"><i class="fa-solid fa-plus"></i> Add property</button></div>
      ${rows.length ? rows.map(p => `<button type="button" class="ghla-row" data-ghla-property="${esc(p.id)}">
        <i class="${p.type === 'land' ? 'fa-solid fa-map' : p.type === 'business' ? 'fa-solid fa-building' : 'fa-solid fa-house'}"></i>
        <span><b>${esc(p.name)}</b><small>${esc(propertySubtitle(p))} · ${esc(ownerName(p.owner))}</small></span>
        <i class="fa-solid fa-chevron-right"></i>
      </button>`).join('') : emptyState('fa-solid fa-house', 'No linked properties', 'Add a home, apartment, villa, land or business and define who owns or rents it.')}
    </main>`;
  } else if (tab === 'market') {
    const listings = Object.values(s.propertyListings)
      .filter(x => x.status === 'available')
      .sort((a, b) => b.createdAt - a.createdAt);

    body = `<main>
      <form class="ghla-market-search property" data-ghla-property-search>
        <input name="city" value="${esc(s.market.propertyRefresh.city || 'Greyhaven')}" placeholder="City">
        <select name="type">${['all', 'house', 'apartment', 'villa', 'land', 'business'].map(x => `<option value="${x}"${s.market.propertyRefresh.type === x ? ' selected' : ''}>${x === 'all' ? 'All property' : x}</option>`).join('')}</select>
        <select name="mode">${['all', 'sale', 'rent'].map(x => `<option value="${x}"${s.market.propertyRefresh.mode === x ? ' selected' : ''}>${x === 'all' ? 'Buy or rent' : x}</option>`).join('')}</select>
        <button type="submit" class="primary">${propertyRefreshBusy ? 'Refreshing…' : '<i class="fa-solid fa-arrows-rotate"></i> Search'}</button>
      </form>
      <small class="ghla-muted">Long-term rentals only here. Holiday/short stays will belong to the Booking app in the next update.</small>
      ${listings.length ? listings.map(l => {
        const p = s.properties[l.assetId];
        if (!p) return '';
        return `<article class="ghla-market-card property">
          <div class="ghla-market-icon"><i class="${p.type === 'land' ? 'fa-solid fa-map' : p.type === 'business' ? 'fa-solid fa-building' : 'fa-solid fa-house'}"></i></div>
          <div class="ghla-market-main"><b>${esc(p.name)}</b><small>${esc(propertySubtitle(p))} · ${esc(ownerName(p.owner))}</small><p>${esc(l.description || p.description || '')}</p>${l.agencyName ? `<small>Listed by ${esc(l.agencyName)}</small>` : ''}</div>
          <strong>${l.mode === 'rent' ? `${money(l.monthlyRent)}/mo` : money(l.price)}</strong>
          <div class="ghla-market-actions">
            ${lifeFavoriteButton('properties', p.id)}
            <button type="button" data-ghla-message-property="${esc(l.id)}">Message</button>
            ${l.mode === 'sale' ? `<button type="button" data-ghla-buy-property="${esc(l.id)}">Buy</button>` : `<button type="button" data-ghla-rent-property="${esc(l.id)}">Rent</button>`}
            ${l.sellerIdentityId === me?.id && l.mode === 'sale' ? `<button type="button" data-ghla-complete-property-sale="${esc(l.id)}">Complete sale</button>` : ''}
          </div>
        </article>`;
      }).join('') : emptyState('fa-solid fa-building-circle-check', 'No property listings', 'Search Greyhaven or another city to discover persistent places.')}
    </main>`;
  } else if (tab === 'saved') {
    const rows = favoriteAssetIds('properties')
      .map(idValue => s.properties[idValue])
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    body = `<main>
      <h3 class="ghla-section-title">Saved properties</h3>
      ${rows.length ? rows.map(p => `<div class="ghla-saved-asset">
        <button type="button" class="ghla-row" data-ghla-property="${esc(p.id)}">
          <i class="${p.type === 'land' ? 'fa-solid fa-map' : p.type === 'business' ? 'fa-solid fa-building' : 'fa-solid fa-house'}"></i>
          <span><b>${esc(p.name)}</b><small>${esc(propertySubtitle(p))} · ${esc(ownerName(p.owner))}</small></span>
          <i class="fa-solid fa-chevron-right"></i>
        </button>
        ${lifeFavoriteButton('properties', p.id)}
      </div>`).join('') : emptyState('fa-regular fa-heart', 'No saved properties', 'Heart a property in Market or its detail page to keep it here.')}
    </main>`;
  } else if (tab === 'tenancies') {
    const tenantRows = Object.values(s.properties).filter(p => p.tenants.some(t => t.identityId === me?.id));
    const landlordRows = Object.values(s.properties).filter(p => isOwner(p, me?.id) && p.tenants.length);

    body = `<main>
      <h3 class="ghla-section-title">I rent</h3>
      ${tenantRows.length ? tenantRows.map(p => `<section class="ghla-card"><b>${esc(p.name)}</b><span>${esc(propertySubtitle(p))}</span><small>${p.monthlyRent ? `${money(p.monthlyRent)}/month` : 'Rent not set'} · owner ${esc(ownerName(p.owner))}</small><button type="button" data-ghla-property="${esc(p.id)}">Open</button></section>`).join('') : '<small class="ghla-muted">No active tracked tenancy.</small>'}
      <h3 class="ghla-section-title">My tenants</h3>
      ${landlordRows.length ? landlordRows.map(p => `<section class="ghla-card"><b>${esc(p.name)}</b>${p.tenants.map(t => `<div class="ghla-mini-row"><span>${esc(identityById(t.identityId)?.name || t.name)}</span><button type="button" data-ghla-rent-reminder="${esc(p.id)}" data-tenant="${esc(t.identityId)}">Remind</button></div>`).join('')}</section>`).join('') : '<small class="ghla-muted">No tracked tenants in properties you own.</small>'}
    </main>`;
  } else if (tab === 'agencies') {
    const myAgency = s.agencies.find(a => a.kind === 'identity' && a.identityId === me?.id);
    body = `<main>
      <div class="ghla-toolbar">
        <button type="button" data-ghla-add-agency><i class="fa-solid fa-plus"></i> Add agency</button>
        ${myAgency ? `<button type="button" data-ghla-agency-client-list="${esc(myAgency.id)}" class="primary"><i class="fa-solid fa-house-circle-check"></i> List client property</button>` : ''}
      </div>
      ${s.agencies.length ? s.agencies.map(a => `<section class="ghla-card"><b>${esc(a.name)}</b><small>${a.kind === 'identity' ? 'Existing Greyhaven identity' : 'External agency'}</small><button type="button" data-ghla-remove-agency="${esc(a.id)}">Remove</button></section>`).join('') : emptyState('fa-solid fa-building-user', 'No agencies assigned', 'Agencies can market properties without becoming the owner.')}
    </main>`;
  }

  return `<div class="ghla-screen">
    ${lifeHeader('Property', 'Homes, ownership & tenants')}
    ${tabs([['owned', 'My places'], ['market', 'Market'], ['saved', 'Saved'], ['tenancies', 'Tenancy'], ['agencies', 'Agencies']], tab)}
    ${body}
  </div>`;
}

function renderLife() {
  if (!lifeOpen) return;

  const layer = ensureLifeLayer();
  if (!layer) return;

  if (lifeView.app === 'garage') layer.innerHTML = renderGarage();
  else if (lifeView.app === 'property') layer.innerHTML = renderProperty();
  else layer.innerHTML = renderLifeHome();
}

/* ---------------- dialogs ---------------- */

function openDialog(html, setup) {
  const d = document.createElement('dialog');
  d.className = 'ghla-dialog';
  d.innerHTML = html;
  d.addEventListener('cancel', e => { e.preventDefault(); d.close(); });
  d.addEventListener('click', e => {
    const closeButton = e.target.closest?.('[data-ghla-dialog-close]');
    if (closeButton) {
      e.preventDefault();
      d.close();
      return;
    }

    if (e.target === d) {
      const panel = d.firstElementChild;
      const r = panel?.getBoundingClientRect?.();
      if (!r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    }
  });
  d.addEventListener('close', () => d.remove());
  document.body.appendChild(d);
  setup?.(d);
  try { d.showModal(); } catch { d.setAttribute('open', ''); }
  return d;
}

function vehicleFormDialog(existing = null) {
  const v = existing || {};
  const current = currentIdentity();

  return openDialog(`<form method="dialog" data-ghla-vehicle-form data-id="${esc(v.id || '')}">
    <header><b>${existing ? 'Edit vehicle' : 'Add vehicle'}</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <label>Owner<select name="ownerIdentityId" required>${identityOptions(v.owner?.kind === 'identity' ? v.owner.identityId : current?.id, false)}</select></label>
    <div class="ghla-form-grid">
      <label>Type<select name="type">${['car','motorcycle','boat','airplane'].map(x => `<option value="${x}"${v.type === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Year<input name="year" type="number" min="1950" max="${new Date().getFullYear()+2}" value="${esc(v.year || new Date().getFullYear())}"></label>
      <label>Make<input name="make" value="${esc(v.make || '')}" required></label>
      <label>Model<input name="model" value="${esc(v.model || '')}" required></label>
      <label>Color<input name="color" value="${esc(v.color || '')}"></label>
      <label>Plate / registration<input name="plate" value="${esc(v.plate || '')}"></label>
      <label>Mileage km<input name="mileage" type="number" min="0" value="${esc(v.mileage || 0)}"></label>
      <label>Condition<select name="condition">${['excellent','good','fair','poor','damaged'].map(x => `<option value="${x}"${v.condition === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
    </div>
    <label>Notes<textarea name="notes">${esc(v.notes || '')}</textarea></label>
    <button class="primary" type="submit">Save vehicle</button>
  </form>`);
}

function propertyFormDialog(existing = null) {
  const p = existing || {};
  const current = currentIdentity();
  const external = p.owner?.kind === 'external';

  return openDialog(`<form method="dialog" data-ghla-property-form data-id="${esc(p.id || '')}">
    <header><b>${existing ? 'Edit property' : 'Add property'}</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <div class="ghla-form-grid">
      <label>Type<select name="type">${['house','apartment','villa','land','business'].map(x => `<option value="${x}"${p.type === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Name<input name="name" value="${esc(p.name || '')}" placeholder="Home, Riverside Apartment..." required></label>
      <label>City<input name="city" value="${esc(p.city || 'Greyhaven')}" required></label>
      <label>Area / neighborhood<input name="area" value="${esc(p.area || '')}"></label>
      <label>Size m²<input name="sizeSqm" type="number" min="0" value="${esc(p.sizeSqm || '')}"></label>
      <label>Rooms<input name="rooms" type="number" min="0" value="${esc(p.rooms || '')}"></label>
      <label>Bedrooms<input name="bedrooms" type="number" min="0" value="${esc(p.bedrooms || '')}"></label>
      <label>Bathrooms<input name="bathrooms" type="number" min="0" value="${esc(p.bathrooms || '')}"></label>
    </div>
    <label>Address<input name="address" value="${esc(p.address || '')}"></label>
    <label>Owner type<select name="ownerKind">
      <option value="identity"${!external ? ' selected' : ''}>Existing character</option>
      <option value="external"${external ? ' selected' : ''}>Untracked / family / other</option>
    </select></label>
    <label>Existing owner<select name="ownerIdentityId">${identityOptions(p.owner?.kind === 'identity' ? p.owner.identityId : current?.id)}</select></label>
    <div class="ghla-form-grid">
      <label>External owner relationship<select name="ownerRelation">${['parents','friend','relationship','other','untracked'].map(x => `<option value="${x}"${p.owner?.relation === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Optional owner label<input name="ownerLabel" value="${esc(p.owner?.label || '')}" placeholder="Leave blank if unnamed"></label>
    </div>
    <label>Tenant character names <small>comma-separated exact names</small><input name="tenantNames" value="${esc((p.tenants || []).map(t => identityById(t.identityId)?.name || t.name).filter(Boolean).join(', '))}"></label>
    <div class="ghla-form-grid">
      <label>Monthly rent<input name="monthlyRent" type="number" min="0" value="${esc(p.monthlyRent || 0)}"></label>
      <label>Rent split<select name="rentSplit">${['none','equal','custom'].map(x => `<option value="${x}"${p.rentSplit === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Untracked housemates<input name="untrackedHousemates" type="number" min="0" value="${esc(p.untrackedHousemates || 0)}"></label>
      <label class="ghla-check"><input name="shortTermEligible" type="checkbox"${p.shortTermEligible ? ' checked' : ''}> Can be offered for short stays</label>
    </div>
    <label>Description<textarea name="description">${esc(p.description || '')}</textarea></label>
    <button class="primary" type="submit">Save property</button>
  </form>`);
}

function listingVehicleDialog(vehicleId) {
  const s = normalizeAll();
  const v = s.vehicles[vehicleId];
  if (!v) return;

  openDialog(`<form method="dialog" data-ghla-vehicle-list-form data-id="${esc(v.id)}">
    <header><b>List ${esc(vehicleTitle(v))}</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <label>Listing type<select name="mode"><option value="sale">Sell</option><option value="rent">Rent by day</option></select></label>
    <label>Price / daily rate (€)<input name="amount" type="number" min="1" required></label>
    <small>Only you as the recorded owner can publish this listing. Nothing sells automatically.</small>
    <button class="primary" type="submit">Publish listing</button>
  </form>`);
}

function listingPropertyDialog(propertyId) {
  const s = normalizeAll();
  const p = s.properties[propertyId];
  if (!p) return;

  openDialog(`<form method="dialog" data-ghla-property-list-form data-id="${esc(p.id)}">
    <header><b>List ${esc(p.name)}</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <label>Listing type<select name="mode"><option value="sale">Sell</option><option value="rent">Long-term rent</option></select></label>
    <label>Sale price / monthly rent (€)<input name="amount" type="number" min="1" required></label>
    <label>Agency<select name="agencyId"><option value="">No agency / direct</option>${normalizeAll().agencies.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></label>
    <small>The agency markets the property but never becomes its owner.</small>
    <button class="primary" type="submit">Publish listing</button>
  </form>`);
}

function vehicleRentalDialog(listingId) {
  const l = normalizeAll().vehicleListings[listingId];
  if (!l) return;
  const nowDate = rpNow();
  const tomorrow = new Date(nowDate.getTime() + 86400000);
  const val = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16);

  openDialog(`<form method="dialog" data-ghla-vehicle-rental-form data-id="${esc(listingId)}">
    <header><b>Rent vehicle</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <label>Renter<select name="renterIdentityId" required>${identityOptions(currentIdentity()?.id, false)}</select></label>
    <label>Start<input name="startAt" type="datetime-local" value="${val(nowDate)}" required></label>
    <label>Return<input name="endAt" type="datetime-local" value="${val(tomorrow)}" required></label>
    <small>A phone reminder is scheduled about 3 hours before return.</small>
    <button class="primary" type="submit">Book rental · ${money(l.dailyRate)}/day</button>
  </form>`);
}

function propertyRentalDialog(listingId) {
  const l = normalizeAll().propertyListings[listingId];
  if (!l) return;
  const today = rpNow().toISOString().slice(0,10);

  openDialog(`<form method="dialog" data-ghla-property-rental-form data-id="${esc(listingId)}">
    <header><b>Start tenancy</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <label>Tenant<select name="tenantIdentityId" required>${identityOptions(currentIdentity()?.id, false)}</select></label>
    <label>Move-in date<input name="startAt" type="date" value="${today}"></label>
    <label>Rent split<select name="splitMode"><option value="none">Not split</option><option value="equal">Split equally</option><option value="custom">Custom arrangement</option></select></label>
    <label>Additional untracked housemates<input name="housemates" type="number" min="0" value="0"></label>
    <small>There is no forced end date. End the tenancy manually when the character moves out.</small>
    <button class="primary" type="submit">Rent · ${money(l.monthlyRent)}/month</button>
  </form>`);
}

function repairDialog(vehicleId) {
  const s = normalizeAll();
  if (!s.mechanics.length) {
    globalThis.toastr?.info?.('Assign a mechanic character first in Garage → Service.');
    return;
  }

  openDialog(`<form method="dialog" data-ghla-repair-form data-id="${esc(vehicleId)}">
    <header><b>Repair service</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <label>Mechanic<select name="mechanicId" required><option value="">Choose mechanic</option>${s.mechanics.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label>
    <label>What is wrong?<textarea name="issue" required placeholder="Describe only what you know from the RP..."></textarea></label>
    <label class="ghla-check"><input name="towing" type="checkbox"> Vehicle needs towing</label>
    <button class="primary" type="submit">Request service</button>
  </form>`);
}

function mechanicDialog() {
  openDialog(`<form method="dialog" data-ghla-mechanic-form>
    <header><b>Add mechanic</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <label>Character<select name="identityId" required>${identityOptions('', true)}</select></label>
    <label>Optional note<input name="label" placeholder="Workshop, specialty..."></label>
    <button class="primary" type="submit">Assign mechanic</button>
  </form>`);
}


function agencyClientListingDialog(agencyId) {
  const s = normalizeAll();
  const agency = s.agencies.find(x => x.id === agencyId);
  if (!agency) return;

  const properties = Object.values(s.properties)
    .filter(p => p.status === 'active' && !activeListingForAsset('property', p.id));

  if (!properties.length) {
    globalThis.toastr?.info?.('There are no unlisted persistent properties available for this agency.');
    return;
  }

  openDialog(`<form method="dialog" data-ghla-agency-list-form data-agency="${esc(agencyId)}">
    <header><b>List client property</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <label>Property<select name="propertyId" required><option value="">Choose property</option>${properties.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · owner ${esc(ownerName(p.owner))}</option>`).join('')}</select></label>
    <label>Listing type<select name="mode"><option value="sale">For sale</option><option value="rent">Long-term rent</option></select></label>
    <label>Sale price / monthly rent (€)<input name="amount" type="number" min="1" required></label>
    <small>${esc(agency.name)} will be the marketing agency. The property owner stays unchanged.</small>
    <button class="primary" type="submit">Publish agency listing</button>
  </form>`);
}

function agencyDialog() {
  openDialog(`<form method="dialog" data-ghla-agency-form>
    <header><b>Add agency</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <label>Agency type<select name="kind"><option value="identity">Existing character/business</option><option value="external">External agency</option></select></label>
    <label>Existing identity<select name="identityId">${identityOptions()}</select></label>
    <label>External agency name<input name="name"></label>
    <button class="primary" type="submit">Save agency</button>
  </form>`);
}


function marketMessageDialog(kind, listingId) {
  const s = normalizeAll();
  const listing = kind === 'vehicle' ? s.vehicleListings[listingId] : s.propertyListings[listingId];
  if (!listing) return;

  const agency = kind === 'property' && listing.agencyId
    ? s.agencies.find(x => x.id === listing.agencyId)
    : null;

  const targetName = agency?.name || listing.sellerName || 'Seller';
  const asset = kind === 'vehicle' ? s.vehicles[listing.assetId] : s.properties[listing.assetId];
  const subject = kind === 'vehicle' ? vehicleTitle(asset || {}) : asset?.name || 'property';

  openDialog(`<form method="dialog" data-ghla-market-message data-target="${esc(targetName)}">
    <header><b>Message ${esc(targetName)}</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <textarea name="text" required>Hi, I'm interested in the ${esc(subject)}. Is it still available?</textarea>
    <button class="primary" type="submit">Send message</button>
  </form>`);
}

function completeSaleDialog(kind, listingId) {
  openDialog(`<form method="dialog" data-ghla-complete-sale data-kind="${esc(kind)}" data-id="${esc(listingId)}">
    <header><b>Complete sale</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <label>Existing buyer<select name="buyerIdentityId">${identityOptions()}</select></label>
    <label>Or external / NPC buyer<input name="buyerName" placeholder="Name if not a tracked character"></label>
    <small>Ownership transfers only when you press the button below.</small>
    <button class="primary" type="submit">Transfer ownership & mark sold</button>
  </form>`);
}

function phoneManagerHtml() {
  const rows = phoneRecords();
  const duplicateKeys = duplicatePhoneKeys();
  const identityGroups = identityDuplicateGroups();
  const assigned = new Set(rows.map(x => String(x.timeline?.identityId || '')).filter(Boolean));
  const missing = managerIdentityCandidates().filter(x => !assigned.has(x.id));
  const orphans = orphanIdentityRows();

  const duplicateCount = identityGroups.reduce((sum, group) =>
    sum + group.duplicates.filter(x => x.deletable).length, 0);
  const duplicateIdentityIds = new Set(
    identityGroups.flatMap(group => group.duplicates.map(x => x.id))
  );

  return `<div class="ghla-manager-panel">
    <header><div><b>Greyhaven Phone Manager</b><small>Phone records + global identity cleanup</small></div><button type="button" data-ghla-manager-close><i class="fa-solid fa-xmark"></i></button></header>
    <main>
      <div class="ghla-manager-actions">
        <button type="button" data-ghla-repair-bindings><i class="fa-solid fa-wand-magic-sparkles"></i> Repair bindings</button>
        <button type="button" data-ghla-create-phone><i class="fa-solid fa-plus"></i> Add missing phone</button>
        ${duplicateCount ? `<button type="button" data-ghla-delete-safe-identities class="warning"><i class="fa-solid fa-broom"></i> Delete ${duplicateCount} safe duplicate${duplicateCount === 1 ? '' : 's'}</button>` : ''}
      </div>

      <section class="ghla-manager-note"><i class="fa-solid fa-circle-info"></i><span>Current SillyTavern character cards and the active persona are protected. Deleted/replaced characters can now be removed even when they never had a phone record, so their old name and number disappear from selectors.</span></section>

      <h3>Phone records</h3>
      ${rows.length ? rows.map(({key,timeline}) => {
        const who = identityById(timeline.identityId);
        const registry = identityRegistryRows().find(x => String(x.id) === String(timeline.identityId || ''));
        const number = who?.phoneNumber || registry?.phoneNumber || 'no number';
        const identityIsDuplicate = duplicateIdentityIds.has(String(timeline.identityId || ''));
        return `<article class="ghla-phone-record ${duplicateKeys.has(key) || identityIsDuplicate ? 'duplicate' : ''}">
          <div><b>${esc(timeline.ownerName || who?.name || registry?.name || 'Orphan phone')}</b><small>${esc(number)} · ${esc(timeline.identityId || 'unassigned')}</small>${duplicateKeys.has(key) ? '<em>Possible duplicate phone</em>' : identityIsDuplicate ? '<em>Attached to an old duplicate identity — reassign this phone</em>' : ''}</div>
          <button type="button" data-ghla-reassign-phone="${esc(key)}">Assign</button>
          <button type="button" data-ghla-delete-phone="${esc(key)}"><i class="fa-solid fa-trash"></i></button>
        </article>`;
      }).join('') : '<small>No phone records in this chat yet.</small>'}

      <h3>Duplicate identity numbers</h3>
      ${identityGroups.length ? identityGroups.map(group => `
        <section class="ghla-identity-group">
          <div class="ghla-identity-keep">
            <span><b>${esc(group.name)}</b><small>Keep · ${esc(group.canonical.phoneNumber || 'no number')}</small></span>
            <em>${group.canonical.activeCharacter ? 'Current character' : group.canonical.hasPhoneRecord ? 'Has phone' : 'Canonical'}</em>
          </div>
          ${group.duplicates.map(row => `<div class="ghla-identity-duplicate">
            <span><b>${esc(row.phoneNumber || 'no number')}</b><small>${esc(row.id)}</small></span>
            ${row.deletable
              ? `<button type="button" data-ghla-delete-identity="${esc(row.id)}"><i class="fa-solid fa-trash"></i> Delete duplicate</button>`
              : `<em>${row.activeCharacter ? 'Current character card — protected' : 'Has phone record — reassign/delete phone first'}</em>`}
          </div>`).join('')}
        </section>
      `).join('') : '<small class="ghla-manager-empty">No duplicate global identities detected.</small>'}

      <h3>Old / deleted character identities</h3>
      <small class="ghla-manager-caption">These global numbers no longer belong to a current SillyTavern character card and have no phone record in this chat.</small>
      ${orphans.length ? orphans.slice(0,160).map(row => `<div class="ghla-mini-row ghla-orphan-row">
        <span><b>${esc(row.name)}</b><small>${esc(row.phoneNumber || 'no number')}</small></span>
        <button type="button" class="danger" data-ghla-delete-orphan-identity="${esc(row.id)}"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>`).join('') : '<small class="ghla-manager-empty">No removable old identities found.</small>'}

      <h3>Missing phones</h3>
      <small class="ghla-manager-caption">Only current character cards/personas are listed here now. Old deleted identities are kept out of all Life selectors.</small>
      ${missing.length ? missing.slice(0,100).map(x => `<div class="ghla-mini-row"><span>${esc(x.name)} · ${esc(x.phoneNumber || 'number will be created by Phone')}</span><button type="button" data-ghla-create-phone-for="${esc(x.id)}">Create</button></div>`).join('') : '<small>Every current character/persona already has a phone record in this chat.</small>'}
    </main>
  </div>`;
}

function openPhoneManager() {
  if (!ctx()?.chatMetadata) {
    globalThis.toastr?.warning?.('Open a chat first so there is a phone timeline to manage.');
    return;
  }

  const d = document.createElement('dialog');
  d.id = 'ghla-phone-manager';
  d.innerHTML = phoneManagerHtml();
  d.addEventListener('click', handleManagerClick);
  d.addEventListener('cancel', e => { e.preventDefault(); d.close(); });
  d.addEventListener('close', () => d.remove());
  document.body.appendChild(d);
  try { d.showModal(); } catch { d.setAttribute('open', ''); }
}

function rerenderManager() {
  const d = qs('#ghla-phone-manager');
  if (d) d.innerHTML = phoneManagerHtml();
}

function managerAssignDialog(key) {
  const row = phoneRecords().find(x => x.key === key);
  if (!row) return;
  openDialog(`<form method="dialog" data-ghla-phone-assign-form data-key="${esc(key)}">
    <header><b>Assign phone</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <p>Current record: <b>${esc(row.timeline.ownerName || 'Unknown')}</b></p>
    <label>Assign to<select name="identityId" required>${identityOptions(row.timeline.identityId, false)}</select></label>
    <button class="primary" type="submit">Reassign phone</button>
  </form>`);
}

function managerCreateDialog() {
  const assigned = new Set(phoneRecords().map(x => x.timeline?.identityId).filter(Boolean));
  const choices = identities().filter(x => !assigned.has(x.id));
  if (!choices.length) {
    globalThis.toastr?.info?.('No known identities are missing a phone in this chat.');
    return;
  }

  openDialog(`<form method="dialog" data-ghla-phone-create-form>
    <header><b>Create phone</b><button value="cancel" type="button" data-ghla-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <label>Identity<select name="identityId" required><option value="">Choose</option>${choices.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>
    <button class="primary" type="submit">Create phone record</button>
  </form>`);
}

/* ---------------- UI actions ---------------- */

function handleLifeClick(event) {
  if (event.target?.matches?.('[data-ghla-folder-backdrop]')) {
    event.preventDefault();
    event.stopPropagation();
    return closeLife();
  }

  const button = event.target.closest('button');
  if (!button) return;

  if (button.dataset.ghlaFavoriteKind && button.dataset.ghlaFavoriteId) {
    toggleAssetFavorite(button.dataset.ghlaFavoriteKind, button.dataset.ghlaFavoriteId);
    return renderLife();
  }

  if (button.matches('[data-ghla-dialog-close]')) return button.closest('dialog')?.close();
  if (button.matches('[data-ghla-back]')) return lifeBack();

  if (button.dataset.ghlaApp) {
    lifeView = { app: button.dataset.ghlaApp, tab: 'owned', detailId: '' };
    syncLifeFolderBlur();
    return renderLife();
  }

  if (button.dataset.ghlaTab) {
    lifeView.tab = button.dataset.ghlaTab;
    lifeView.detailId = '';
    return renderLife();
  }

  if (button.dataset.ghlaVehicle) {
    lifeView.detailId = button.dataset.ghlaVehicle;
    return renderLife();
  }

  if (button.dataset.ghlaProperty) {
    lifeView.detailId = button.dataset.ghlaProperty;
    return renderLife();
  }

  if (button.matches('[data-ghla-add-vehicle]')) return vehicleFormDialog();
  if (button.dataset.ghlaEditVehicle) return vehicleFormDialog(normalizeAll().vehicles[button.dataset.ghlaEditVehicle]);
  if (button.dataset.ghlaListVehicle) return listingVehicleDialog(button.dataset.ghlaListVehicle);
  if (button.dataset.ghlaRepairVehicle) return repairDialog(button.dataset.ghlaRepairVehicle);
  if (button.matches('[data-ghla-add-mechanic]')) return mechanicDialog();
  if (button.dataset.ghlaRemoveMechanic) {
    removeMechanic(button.dataset.ghlaRemoveMechanic);
    return renderLife();
  }
  if (button.dataset.ghlaRemoveVehicleListing) {
    if (confirm('Remove this vehicle listing?')) {
      try { removeListing('vehicle', button.dataset.ghlaRemoveVehicleListing); renderLife(); }
      catch (e) { globalThis.toastr?.error?.(e.message); }
    }
    return;
  }
  if (button.dataset.ghlaMessageVehicle) return marketMessageDialog('vehicle', button.dataset.ghlaMessageVehicle);
  if (button.dataset.ghlaRentVehicle) return vehicleRentalDialog(button.dataset.ghlaRentVehicle);
  if (button.dataset.ghlaBuyVehicle) {
    const listing = normalizeAll().vehicleListings[button.dataset.ghlaBuyVehicle];
    const me = currentIdentity();
    if (!listing || !me) return;
    if (listing.sellerIdentityId === me.id) return globalThis.toastr?.info?.('Use Complete sale to choose the buyer.');
    if (confirm(`Buy this vehicle for ${money(listing.price)}? Ownership will transfer to ${me.name}.`)) {
      try { completeVehicleSale(listing.id, me.id, ''); renderLife(); globalThis.toastr?.success?.('Vehicle ownership transferred.'); }
      catch (e) { globalThis.toastr?.error?.(e.message); }
    }
    return;
  }
  if (button.dataset.ghlaCompleteVehicleSale) return completeSaleDialog('vehicle', button.dataset.ghlaCompleteVehicleSale);
  if (button.dataset.ghlaReturnRental) {
    const r = normalizeAll().vehicleRentals[button.dataset.ghlaReturnRental];
    if (r) { r.status = 'returned'; r.returnedAt = Date.now(); saveSettings(); renderLife(); }
    return;
  }
  if (button.dataset.ghlaServiceStatus) {
    updateRepairStatus(button.dataset.ghlaServiceStatus, button.dataset.status);
    return renderLife();
  }

  if (button.matches('[data-ghla-add-property]')) return propertyFormDialog();
  if (button.dataset.ghlaEditProperty) return propertyFormDialog(normalizeAll().properties[button.dataset.ghlaEditProperty]);
  if (button.dataset.ghlaListProperty) return listingPropertyDialog(button.dataset.ghlaListProperty);
  if (button.dataset.ghlaRemovePropertyListing) {
    if (confirm('Remove this property listing?')) {
      try { removeListing('property', button.dataset.ghlaRemovePropertyListing); renderLife(); }
      catch (e) { globalThis.toastr?.error?.(e.message); }
    }
    return;
  }
  if (button.dataset.ghlaMessageProperty) return marketMessageDialog('property', button.dataset.ghlaMessageProperty);
  if (button.dataset.ghlaBuyProperty) {
    const listing = normalizeAll().propertyListings[button.dataset.ghlaBuyProperty];
    const me = currentIdentity();
    if (!listing || !me) return;
    if (listing.sellerIdentityId === me.id) return globalThis.toastr?.info?.('Use Complete sale to choose the buyer.');
    if (confirm(`Buy this property for ${money(listing.price)}? Ownership will transfer to ${me.name}.`)) {
      try { completePropertySale(listing.id, me.id, ''); renderLife(); globalThis.toastr?.success?.('Property ownership transferred.'); }
      catch (e) { globalThis.toastr?.error?.(e.message); }
    }
    return;
  }
  if (button.dataset.ghlaCompletePropertySale) return completeSaleDialog('property', button.dataset.ghlaCompletePropertySale);
  if (button.dataset.ghlaRentProperty) return propertyRentalDialog(button.dataset.ghlaRentProperty);
  if (button.dataset.ghlaEndTenancy) {
    const me = currentIdentity();
    if (me && confirm('End your tenancy here?')) {
      endTenancy(button.dataset.ghlaEndTenancy, me.id);
      lifeView.detailId = '';
      renderLife();
    }
    return;
  }
  if (button.matches('[data-ghla-add-agency]')) return agencyDialog();
  if (button.dataset.ghlaAgencyClientList) return agencyClientListingDialog(button.dataset.ghlaAgencyClientList);
  if (button.dataset.ghlaRemoveAgency) {
    if (confirm('Remove this agency assignment?')) { removeAgency(button.dataset.ghlaRemoveAgency); renderLife(); }
    return;
  }
  if (button.dataset.ghlaRentReminder) {
    const p = normalizeAll().properties[button.dataset.ghlaRentReminder];
    const tenant = identityById(button.dataset.tenant);
    const landlord = currentIdentity();
    if (p && tenant && landlord) {
      dispatchWorldMessage(landlord.name, tenant.name, `Hey, just a reminder about the rent for ${p.name}${p.monthlyRent ? ` (${money(p.monthlyRent)})` : ''}.`);
      pushLifeNotification(tenant.id, 'Rent reminder', `${p.name}${p.monthlyRent ? ` · ${money(p.monthlyRent)}` : ''}`, `manual-rent:${p.id}:${Date.now()}`);
      globalThis.toastr?.success?.(`Rent reminder sent to ${tenant.name}.`);
    }
    return;
  }
}

async function handleLifeSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.matches('[data-ghla-vehicle-search]')) {
    event.preventDefault();
    const fd = new FormData(form);
    const s = normalizeAll();
    s.market.vehicleRefresh.city = norm(fd.get('city') || 'Greyhaven');
    s.market.vehicleRefresh.type = String(fd.get('type') || 'all');
    s.market.vehicleRefresh.mode = String(fd.get('mode') || 'all');
    saveSettings();
    return refreshVehicleMarket();
  }

  if (form.matches('[data-ghla-property-search]')) {
    event.preventDefault();
    const fd = new FormData(form);
    const s = normalizeAll();
    s.market.propertyRefresh.city = norm(fd.get('city') || 'Greyhaven');
    s.market.propertyRefresh.type = String(fd.get('type') || 'all');
    s.market.propertyRefresh.mode = String(fd.get('mode') || 'all');
    saveSettings();
    return refreshPropertyMarket();
  }

  event.preventDefault();
  const fd = new FormData(form);

  try {
    if (form.matches('[data-ghla-vehicle-form]')) {
      const owner = identityById(fd.get('ownerIdentityId'));
      if (!owner) throw new Error('Choose a valid owner.');

      const existing = form.dataset.id ? normalizeAll().vehicles[form.dataset.id] : null;
      const row = putVehicle({
        ...(existing || {}),
        id: existing?.id || uid('vehicle'),
        owner: ownerRefIdentity(owner),
        type: fd.get('type'),
        year: fd.get('year'),
        make: fd.get('make'),
        model: fd.get('model'),
        color: fd.get('color'),
        plate: fd.get('plate'),
        mileage: fd.get('mileage'),
        condition: fd.get('condition'),
        notes: fd.get('notes'),
      });

      form.closest('dialog')?.close();
      lifeView.app = 'garage';
      lifeView.tab = 'owned';
      lifeView.detailId = row.id;
      renderLife();
      return;
    }

    if (form.matches('[data-ghla-property-form]')) {
      const ownerKind = String(fd.get('ownerKind') || 'identity');
      let owner;

      if (ownerKind === 'identity') {
        const who = identityById(fd.get('ownerIdentityId'));
        if (!who) throw new Error('Choose a valid owner.');
        owner = ownerRefIdentity(who);
      } else {
        owner = {
          kind: 'external',
          relation: String(fd.get('ownerRelation') || 'untracked'),
          label: norm(fd.get('ownerLabel')),
        };
      }

      const existing = form.dataset.id ? normalizeAll().properties[form.dataset.id] : null;
      const tenants = exactIdentityNames(fd.get('tenantNames'));

      const row = putProperty({
        ...(existing || {}),
        id: existing?.id || uid('property'),
        type: fd.get('type'),
        name: fd.get('name'),
        city: fd.get('city'),
        area: fd.get('area'),
        sizeSqm: fd.get('sizeSqm'),
        rooms: fd.get('rooms'),
        bedrooms: fd.get('bedrooms'),
        bathrooms: fd.get('bathrooms'),
        address: fd.get('address'),
        owner,
        tenants: tenants.map(t => {
          const oldTenant = existing?.tenants?.find(x => x.identityId === t.identityId);
          const splitMode = String(fd.get('rentSplit') || 'none');
          return {
            ...t,
            startAt: oldTenant?.startAt || Date.now(),
            monthlyRent: splitMode === 'custom'
              ? Math.max(0, Number(oldTenant?.monthlyRent || 0))
              : euro(fd.get('monthlyRent')),
            splitMode,
          };
        }),
        monthlyRent: euro(fd.get('monthlyRent')),
        rentSplit: fd.get('rentSplit'),
        untrackedHousemates: fd.get('untrackedHousemates'),
        shortTermEligible: fd.get('shortTermEligible') === 'on',
        description: fd.get('description'),
      });

      form.closest('dialog')?.close();
      lifeView.app = 'property';
      lifeView.tab = 'owned';
      lifeView.detailId = row.id;
      renderLife();
      return;
    }

    if (form.matches('[data-ghla-vehicle-list-form]')) {
      listVehicle(form.dataset.id, fd.get('mode'), fd.get('amount'));
      form.closest('dialog')?.close();
      renderLife();
      return;
    }

    if (form.matches('[data-ghla-property-list-form]')) {
      listProperty(form.dataset.id, fd.get('mode'), fd.get('amount'), String(fd.get('agencyId') || ''));
      form.closest('dialog')?.close();
      renderLife();
      return;
    }

    if (form.matches('[data-ghla-vehicle-rental-form]')) {
      rentVehicle(form.dataset.id, fd.get('renterIdentityId'), fd.get('startAt'), fd.get('endAt'));
      form.closest('dialog')?.close();
      lifeView.tab = 'rentals';
      renderLife();
      return;
    }

    if (form.matches('[data-ghla-property-rental-form]')) {
      startPropertyTenancy(form.dataset.id, fd.get('tenantIdentityId'), fd.get('startAt'), fd.get('splitMode'), fd.get('housemates'));
      form.closest('dialog')?.close();
      lifeView.tab = 'tenancies';
      renderLife();
      return;
    }

    if (form.matches('[data-ghla-repair-form]')) {
      requestRepair(form.dataset.id, fd.get('mechanicId'), fd.get('issue'), fd.get('towing') === 'on');
      form.closest('dialog')?.close();
      lifeView.tab = 'service';
      lifeView.detailId = '';
      renderLife();
      return;
    }

    if (form.matches('[data-ghla-mechanic-form]')) {
      addMechanic(fd.get('identityId'), fd.get('label'));
      form.closest('dialog')?.close();
      renderLife();
      return;
    }

    if (form.matches('[data-ghla-agency-form]')) {
      addAgency({ identityId: fd.get('identityId'), name: fd.get('name'), kind: fd.get('kind') });
      form.closest('dialog')?.close();
      renderLife();
      return;
    }

    if (form.matches('[data-ghla-agency-list-form]')) {
      agencyListProperty(
        String(fd.get('propertyId') || ''),
        String(fd.get('mode') || 'sale'),
        fd.get('amount'),
        form.dataset.agency
      );
      form.closest('dialog')?.close();
      lifeView.tab = 'market';
      renderLife();
      return;
    }

    if (form.matches('[data-ghla-market-message]')) {
      const from = currentIdentity();
      const target = norm(form.dataset.target);
      const text = String(fd.get('text') || '').trim();
      if (!from || !target || !text) throw new Error('Message details are missing.');
      dispatchWorldMessage(from.name, target, text);
      form.closest('dialog')?.close();
      globalThis.toastr?.success?.(`Message sent to ${target}.`);
      return;
    }

    if (form.matches('[data-ghla-complete-sale]')) {
      const buyerId = String(fd.get('buyerIdentityId') || '');
      const buyerName = norm(fd.get('buyerName'));
      if (!buyerId && !buyerName) throw new Error('Choose an existing buyer or enter an external/NPC buyer name.');

      if (form.dataset.kind === 'vehicle') completeVehicleSale(form.dataset.id, buyerId, buyerName);
      else completePropertySale(form.dataset.id, buyerId, buyerName);

      form.closest('dialog')?.close();
      lifeView.detailId = '';
      renderLife();
      globalThis.toastr?.success?.('Ownership transferred and listing marked sold.');
      return;
    }

    if (form.matches('[data-ghla-phone-assign-form]')) {
      reassignPhoneRecord(form.dataset.key, String(fd.get('identityId') || ''));
      form.closest('dialog')?.close();
      rerenderManager();
      globalThis.toastr?.success?.('Phone reassigned.');
      return;
    }

    if (form.matches('[data-ghla-phone-create-form]')) {
      createPhoneRecord(String(fd.get('identityId') || ''));
      form.closest('dialog')?.close();
      rerenderManager();
      globalThis.toastr?.success?.('Phone record created.');
      return;
    }
  } catch (error) {
    console.error(`[${GHLA_MODULE}] form`, error);
    globalThis.toastr?.error?.(error.message || String(error));
  }
}

function handleManagerClick(event) {
  const button = event.target.closest('button');
  if (!button) return;

  if (button.matches('[data-ghla-manager-close]')) return qs('#ghla-phone-manager')?.close();
  if (button.matches('[data-ghla-repair-bindings]')) {
    const count = repairPhoneBindings();
    rerenderManager();
    return globalThis.toastr?.success?.(count ? `Repaired ${count} binding${count === 1 ? '' : 's'}.` : 'No safe automatic repairs were needed.');
  }
  if (button.matches('[data-ghla-delete-safe-identities]')) {
    if (!confirm('Delete every safe orphan duplicate identity number? Current character cards and identities with phone records are protected.')) return;
    try {
      const count = deleteAllSafeDuplicateIdentities();
      rerenderManager();
      globalThis.toastr?.success?.(`Deleted ${count} safe duplicate identit${count === 1 ? 'y' : 'ies'}.`);
    } catch (error) {
      globalThis.toastr?.error?.(error.message || String(error));
    }
    return;
  }
  if (button.dataset.ghlaDeleteIdentity) {
    const row = identityRegistryRows().find(x => x.id === button.dataset.ghlaDeleteIdentity);
    if (!row) return;
    if (!confirm(`Delete the old ${row.name} identity number ${row.phoneNumber || '(no number)'}?`)) return;
    try {
      const result = deleteDuplicateIdentity(row.id);
      rerenderManager();
      globalThis.toastr?.success?.(`Deleted duplicate ${result.name} identity.`);
    } catch (error) {
      globalThis.toastr?.error?.(error.message || String(error));
    }
    return;
  }
  if (button.dataset.ghlaDeleteOrphanIdentity) {
    const row = identityRegistryRows().find(x => x.id === button.dataset.ghlaDeleteOrphanIdentity);
    if (!row) return;
    if (!confirm(`Permanently delete the old ${row.name} identity and number ${row.phoneNumber || '(no number)'} from Greyhaven Phone?`)) return;
    try {
      const deleted = deleteOrphanIdentity(row.id);
      rerenderManager();
      globalThis.toastr?.success?.(`Deleted old identity: ${deleted.name}.`);
    } catch (error) {
      globalThis.toastr?.error?.(error.message || String(error));
    }
    return;
  }
  if (button.matches('[data-ghla-create-phone]')) return managerCreateDialog();
  if (button.dataset.ghlaCreatePhoneFor) {
    try {
      createPhoneRecord(button.dataset.ghlaCreatePhoneFor);
      rerenderManager();
      globalThis.toastr?.success?.('Phone record created.');
    } catch (error) { globalThis.toastr?.error?.(error.message); }
    return;
  }
  if (button.dataset.ghlaReassignPhone) return managerAssignDialog(button.dataset.ghlaReassignPhone);
  if (button.dataset.ghlaDeletePhone) {
    if (confirm('Delete this phone record from the current chat? This removes its local phone history.')) {
      deletePhoneRecord(button.dataset.ghlaDeletePhone);
      rerenderManager();
    }
  }
}

function documentClick(event) {
  const target = event.target.closest?.('[data-ghla-open-life]');
  if (target) {
    event.preventDefault();
    event.stopPropagation();
    openLife('home');
  }
}

function documentSubmit(event) {
  if (event.target?.closest?.('.ghla-dialog')) handleLifeSubmit(event);
}

/* ---------------- boot / observers ---------------- */

function syncUi() {
  enableRequiredCoreApps();
  seedDefaultGreyhavenWorld();
  injectManagerSettings();

  const overlay = qs('#ghp-overlay');
  if (!overlay || overlay.hidden) {
    if (lifeOpen) {
      lifeOpen = false;
      syncLifeFolderBlur();
      qs('#ghla-layer')?.remove();
    }
    return;
  }

  injectLifeIcon();

  // Important: never re-render the Life layer just because our own DOM changed.
  // v2.4.0 did that from the global MutationObserver, creating a render ->
  // mutation -> render loop on iPhone and making the folder appear frozen.
  // Rebuild only if SillyTavern itself removed the layer while Life is open.
  if (lifeOpen && !qs('#ghla-layer')) renderLife();
}


function bindChatEvents() {
  const c = ctx();
  if (!c?.eventSource || !c?.eventTypes) return;

  const bind = (key, fn) => {
    const type = c.eventTypes[key];
    if (type) c.eventSource.on(type, fn);
  };

  for (const key of ['CHAT_CHANGED', 'CHAT_CREATED', 'PERSONA_CHANGED']) {
    bind(key, () => setTimeout(() => {
      lifeOpen = false;
      qs('#ghla-layer')?.remove();
      enableRequiredCoreApps();
      seedDefaultGreyhavenWorld();
      syncFacebookAssetListings();
      syncUi();
    }, 80));
  }

  for (const key of ['CHARACTER_EDITED', 'GROUP_UPDATED']) {
    bind(key, () => setTimeout(() => {
      seedDefaultGreyhavenWorld();
      syncUi();
    }, 120));
  }
}

function observeUi() {
  if (uiObserver || !document.body) return;

  let queued = false;
  uiObserver = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncUi();
    });
  });

  uiObserver.observe(document.body, { childList: true, subtree: true });
}

async function waitReady(timeout = 16000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (document.body && ctx()?.extensionSettings && phoneApi()) return true;
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  return false;
}

function expose() {
  globalThis.GreyhavenPhoneLifeAssets = {
    version: GHLA_VERSION,
    getState: () => clone(normalizeAll()),
    listVehicles: () => clone(Object.values(normalizeAll()?.vehicles || {})),
    listProperties: () => clone(Object.values(normalizeAll()?.properties || {})),
    listVehicleListings: () => clone(Object.values(normalizeAll()?.vehicleListings || {})),
    listPropertyListings: () => clone(Object.values(normalizeAll()?.propertyListings || {})),
    addVehicle: data => clone(putVehicle(data)),
    addProperty: data => clone(putProperty(data)),
    refreshVehicleMarket,
    refreshPropertyMarket,
    openLife,
    openPhoneManager,
    syncFacebookAssetListings,
  };
}

async function init() {
  if (initialized) return;
  ensureCss();
  if (!await waitReady()) {
    console.warn(`[${GHLA_MODULE}] Greyhaven Phone API was not ready in time.`);
    return;
  }

  normalizeAll();
  expose();
  try { if (phoneApi()) phoneApi().version = GHLA_VERSION; } catch {}
  enableRequiredCoreApps();
  bindChatEvents();
  seedDefaultGreyhavenWorld();
  syncFacebookAssetListings();

  document.addEventListener('click', documentClick, true);
  document.addEventListener('submit', documentSubmit, true);

  observeUi();
  syncUi();

  reminderTimer = setInterval(checkReminders, 30000);
  for (const delay of [200, 700, 1800, 4000]) setTimeout(syncUi, delay);

  initialized = true;
  console.info(`[${GHLA_MODULE}] v${GHLA_VERSION} loaded`);
}

void init().catch(error => console.error(`[${GHLA_MODULE}] boot`, error));
