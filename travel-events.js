/*
 * Greyhaven Phone v2.5.0 — Airbnb-style Booking + Eventbrite-style Events
 *
 * Booking is enabled by default for every phone profile.
 * Events is opt-in per phone from Greyhaven Phone Settings.
 *
 * State-first rules:
 * - search/discovery may create persistent accommodation/event objects
 * - reservations and participants are explicit state
 * - nobody is auto-added to a shared booking just because another phone refreshed
 * - shared bookings are visible across phones, so another character can discover
 *   and deliberately join the exact open booking
 * - discovered events are NOT injected into every character's knowledge/prompt
 */

const GHTE_MODULE = 'greyhaven-phone-travel-events';
const GHTE_VERSION = '2.7.1';
const GHTE_STATE_KEY = 'greyhavenPhoneTravelEvents';
const GHTE_MIGRATION_KEY = 'greyhavenPhoneTravelEventsV27Migration';
const GHTE_LEGACY_BACKUP_KEY = 'greyhavenPhoneTravelEventsV26Backup';
const PHONE_SETTINGS_KEY = 'greyhavenPhone';

let initialized = false;
let observer = null;
let appOpen = '';
let view = { tab: '', detailId: '' };
let stayRefreshBusy = false;
let sharedRefreshBusy = false;
let eventRefreshBusy = false;
let hostReplyBusy = '';

const qs = (sel, root = document) => root?.querySelector?.(sel) || null;
const qsa = (sel, root = document) => [...(root?.querySelectorAll?.(sel) || [])];
const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const lc = value => norm(value).toLowerCase();
const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function uid(prefix = 'ghte') {
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

function lifeApi() {
  return globalThis.GreyhavenPhoneLifeAssets || null;
}

function rpNow() {
  try {
    const value = globalThis.GreyhavenLife?.getTime?.();
    if (value) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }
  } catch {}
  return new Date();
}

function currentChatKey() {
  const c = ctx();
  return String(c?.getCurrentChatId?.() || c?.chatId || c?.chatMetadata?.chat_id || c?.chatMetadata?.file_name || 'current-chat');
}

function saveSettings() {
  const c = ctx();
  try { c?.saveSettingsDebounced?.(); }
  catch (error) { console.warn(`[${GHTE_MODULE}] save settings`, error); }

  try {
    if (c?.chatMetadata?.[GHTE_STATE_KEY]) {
      c.updateChatMetadata?.({ [GHTE_STATE_KEY]: c.chatMetadata[GHTE_STATE_KEY] });
      if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced();
      else c.saveMetadata?.();
    }
  } catch (error) {
    console.warn(`[${GHTE_MODULE}] save chat travel state`, error);
  }
}

function freshTimelineState() {
  return {};
}

function migrateLegacyGlobalStateIntoCurrentChat(c) {
  if (!c?.extensionSettings || !c?.chatMetadata) return null;

  const marker = c.extensionSettings[GHTE_MIGRATION_KEY];
  const legacy = c.extensionSettings[GHTE_STATE_KEY];

  if (
    !marker?.done &&
    legacy &&
    typeof legacy === 'object' &&
    !Array.isArray(legacy) &&
    Object.keys(legacy).length
  ) {
    const copied = clone(legacy);
    copied.version = 2;
    copied.migratedFromGlobalV26 = true;
    copied.migratedIntoChatKey = currentChatKey();
    copied.migratedAt = Date.now();

    c.chatMetadata[GHTE_STATE_KEY] = copied;

    // Preserve a safety backup. v2.7 stops reading the global travel state.
    if (!c.extensionSettings[GHTE_LEGACY_BACKUP_KEY]) {
      c.extensionSettings[GHTE_LEGACY_BACKUP_KEY] = clone(legacy);
    }
    c.extensionSettings[GHTE_MIGRATION_KEY] = {
      done: true,
      chatKey: currentChatKey(),
      migratedAt: Date.now(),
    };

    try { c.saveSettingsDebounced?.(); } catch {}
    try {
      c.updateChatMetadata?.({ [GHTE_STATE_KEY]: copied });
      if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced();
      else c.saveMetadata?.();
    } catch {}

    return copied;
  }

  return null;
}

function state() {
  const c = ctx();
  if (!c?.chatMetadata) return null;

  let s = c.chatMetadata[GHTE_STATE_KEY];
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    s = migrateLegacyGlobalStateIntoCurrentChat(c) || freshTimelineState();
    c.chatMetadata[GHTE_STATE_KEY] = s;
  }

  s.version = 2;

  for (const key of ['accommodations', 'reservations', 'transportBookings', 'events', 'hostThreads']) {
    if (!s[key] || typeof s[key] !== 'object' || Array.isArray(s[key])) s[key] = {};
  }

  if (!s.search || typeof s.search !== 'object') s.search = {};
  if (!s.search.stays || typeof s.search.stays !== 'object') {
    const start = plusDays(rpNow(), 1);
    const end = plusDays(rpNow(), 3);
    s.search.stays = {
      city: 'Greyhaven',
      area: '',
      type: 'all',
      guests: 2,
      checkIn: dateInput(start),
      checkOut: dateInput(end),
      lastResultIds: [],
    };
  }
  if (!s.search.events || typeof s.search.events !== 'object') {
    s.search.events = {
      city: 'Greyhaven',
      category: 'all',
      lastResultIds: [],
    };
  }

  if (!s.localNpcs || typeof s.localNpcs !== 'object' || Array.isArray(s.localNpcs)) s.localNpcs = {};
  if (!s.favorites || typeof s.favorites !== 'object' || Array.isArray(s.favorites)) s.favorites = {};
  if (!s.favorites.accommodations || typeof s.favorites.accommodations !== 'object' || Array.isArray(s.favorites.accommodations)) s.favorites.accommodations = {};
  if (!s.reminderFlags || typeof s.reminderFlags !== 'object' || Array.isArray(s.reminderFlags)) s.reminderFlags = {};

  for (const thread of Object.values(s.hostThreads)) {
    if (!thread || typeof thread !== 'object') continue;
    thread.messages = Array.isArray(thread.messages) ? thread.messages.filter(Boolean) : [];
    thread.stayIds = Array.isArray(thread.stayIds) ? [...new Set(thread.stayIds.filter(Boolean).map(String))] : [];
    thread.ownerIdentityId = String(thread.ownerIdentityId || '');
    thread.hostName = norm(thread.hostName || participantName(thread.host) || 'Host');
    thread.updatedAt = Number(thread.updatedAt || thread.createdAt || Date.now());
  }

  for (const reservation of Object.values(s.reservations)) {
    if (!reservation || typeof reservation !== 'object') continue;
    reservation.participants = Array.isArray(reservation.participants) ? reservation.participants : [];
    reservation.maxGuests = Math.max(reservation.participants.length || 1, Number(reservation.maxGuests || reservation.participants.length || 1));
    reservation.locked = reservation.locked === true;
    reservation.autoFill = reservation.autoFill === true;
    reservation.source ||= 'user-booking';
    reservation.updatedAt = Number(reservation.updatedAt || reservation.createdAt || Date.now());

    if (reservation.mode === 'shared' && reservation.status !== 'cancelled') {
      if (reservation.locked || reservation.participants.length >= reservation.maxGuests) reservation.status = 'confirmed';
      else reservation.status = 'shared-open';
    }
  }

  for (const booking of Object.values(s.transportBookings)) {
    if (!booking || typeof booking !== 'object') continue;
    booking.travelers = Array.isArray(booking.travelers) ? booking.travelers : [];
    booking.status ||= 'confirmed';
    booking.updatedAt = Number(booking.updatedAt || booking.createdAt || Date.now());
  }

  return s;
}

function settingsRoot() {
  const c = ctx();
  if (!c?.extensionSettings) return null;
  if (!c.extensionSettings[PHONE_SETTINGS_KEY] || typeof c.extensionSettings[PHONE_SETTINGS_KEY] !== 'object') {
    c.extensionSettings[PHONE_SETTINGS_KEY] = { profiles: {} };
  }
  const root = c.extensionSettings[PHONE_SETTINGS_KEY];
  if (!root.profiles || typeof root.profiles !== 'object') root.profiles = {};
  return root;
}

function activePersona() {
  return phoneApi()?.getActivePersona?.() || {
    name: ctx()?.name1 || 'User',
    avatar: '',
    avatarId: '',
  };
}

function currentProfileEntry() {
  try { phoneApi()?.getProfile?.(); } catch {}
  const root = settingsRoot();
  if (!root) return null;

  const active = activePersona();
  const name = lc(active?.name);
  const avatar = String(active?.avatar || '');
  const avatarId = String(active?.avatarId || '');

  let pair = Object.entries(root.profiles).find(([, p]) =>
    lc(p?.personaName) === name &&
    (
      !avatar ||
      String(p?.personaAvatar || '') === avatar ||
      String(p?.personaAvatarId || '') === avatarId
    )
  );

  if (!pair) pair = Object.entries(root.profiles).find(([, p]) => lc(p?.personaName) === name);
  return pair ? { key: pair[0], profile: pair[1] } : null;
}

function syncAppDefaults() {
  try { phoneApi()?.getProfile?.(); } catch {}
  const root = settingsRoot();
  if (!root) return;

  let changed = false;

  for (const profile of Object.values(root.profiles)) {
    if (!profile || typeof profile !== 'object') continue;
    if (!profile.apps || typeof profile.apps !== 'object') profile.apps = {};

    if (profile.apps.booking !== true) {
      profile.apps.booking = true;
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(profile.apps, 'events')) {
      profile.apps.events = false;
      changed = true;
    }
  }

  if (changed) saveSettings();
}

function isEventsInstalled() {
  syncAppDefaults();
  return currentProfileEntry()?.profile?.apps?.events === true;
}

function setEventsInstalled(value) {
  const entry = currentProfileEntry();
  if (!entry) return false;
  entry.profile.apps ||= {};
  entry.profile.apps.events = Boolean(value);
  saveSettings();
  return true;
}

function identities() {
  const rows = phoneApi()?.listIdentities?.();
  if (!Array.isArray(rows)) return [];

  /*
   * Use current SillyTavern character-card identities for world discovery.
   * This prevents old deleted/re-added identity records (the duplicate-number
   * problem fixed by Phone Manager) from appearing as separate strangers.
   */
  const activeIds = new Set();
  for (let index = 0; index < (ctx()?.characters || []).length; index++) {
    const ch = ctx().characters[index];
    const stable = String(ch?.avatar || ch?.data?.avatar || '').trim();
    const name = norm(ch?.name || `character-${index}`);
    activeIds.add(stable
      ? `character:${encodeURIComponent(stable)}`
      : `character-name:${encodeURIComponent(name)}`);
  }

  const currentId = phoneApi()?.getCurrentIdentity?.()?.id || '';

  return rows
    .filter(x =>
      x?.id &&
      x.kind !== 'provisional' &&
      (activeIds.size === 0 || activeIds.has(x.id) || x.id === currentId)
    )
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function identityById(idValue) {
  return phoneApi()?.getIdentityById?.(idValue) || identities().find(x => x.id === idValue) || null;
}

function currentIdentity() {
  return phoneApi()?.getCurrentIdentity?.() || null;
}

function identityAvatar(identity) {
  return identity?.avatar || '';
}

function refForIdentity(identity) {
  return identity ? {
    kind: 'identity',
    identityId: identity.id,
    name: identity.name,
    avatar: identity.avatar || '',
  } : null;
}

function participantName(ref) {
  if (!ref) return 'Guest';
  if (ref.kind === 'identity') return identityById(ref.identityId)?.name || ref.name || 'Guest';
  return ref.name || 'Guest';
}

function participantAvatar(ref) {
  if (!ref) return '';
  if (ref.kind === 'identity') return identityById(ref.identityId)?.avatar || ref.avatar || '';
  return ref.avatar || '';
}

function participantExists(list, identityId) {
  return (list || []).some(x => x.kind === 'identity' && x.identityId === identityId);
}

function plusDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function dateInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function dateTimeInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function money(value) {
  return `€${Math.max(0, Math.round(Number(value) || 0)).toLocaleString()}`;
}

function clamp(value, min, max) {
  value = Number(value);
  if (!Number.isFinite(value)) value = min;
  return Math.max(min, Math.min(max, value));
}

function hashString(value = '') {
  let h = 2166136261;
  for (const ch of String(value)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededInt(seed, min, max) {
  const span = Math.max(1, max - min + 1);
  return min + (hashString(seed) % span);
}

function nightsBetween(checkIn, checkOut) {
  const a = new Date(`${checkIn}T14:00:00`).getTime();
  const b = new Date(`${checkOut}T11:00:00`).getTime();
  return Math.max(1, Math.ceil((b - a) / 86400000));
}

function stayNightlyBounds(type = 'apartment') {
  return {
    hotel: [55, 420],
    apartment: [40, 280],
    villa: [120, 1200],
  }[type] || [45, 320];
}

function realisticNightlyPrice(row) {
  const type = ['hotel', 'apartment', 'villa'].includes(row.type) ? row.type : 'apartment';
  const [min, max] = stayNightlyBounds(type);
  const cityFactor = 0.88 + (hashString(`${row.city}:${row.area}`) % 48) / 100;
  const quality = clamp(Number(row.quality || 3), 1, 5);
  const qualityFactor = 0.72 + quality * 0.13;
  const guests = clamp(Number(row.maxGuests || 2), 1, 14);
  const capacityFactor = 1 + Math.max(0, guests - 2) * 0.055;
  const target = Number(row.nightlyPrice || 0) || min * cityFactor * qualityFactor * capacityFactor;
  return Math.round(clamp(target, min * 0.72, max * cityFactor));
}

function reservationTotal(accommodation, checkIn, checkOut, guestCount) {
  const nights = nightsBetween(checkIn, checkOut);
  const occupancyFactor = guestCount <= 2 ? 1 : 1 + Math.min(0.42, (guestCount - 2) * 0.07);
  return Math.round(accommodation.nightlyPrice * nights * occupancyFactor);
}

function transportUnitPrice(mode, from, to, when) {
  const seed = `${mode}:${from}:${to}:${when}`;
  if (mode === 'flight') return seededInt(seed, 65, 420);
  if (mode === 'ferry') return seededInt(seed, 18, 165);
  return seededInt(seed, 8, 75);
}

function transportDurationMinutes(mode, from, to) {
  const seed = `${mode}:${from}:${to}`;
  if (mode === 'flight') return seededInt(seed, 55, 240);
  if (mode === 'ferry') return seededInt(seed, 70, 390);
  return seededInt(seed, 80, 620);
}

function transportOperators(mode) {
  if (mode === 'flight') return ['Aegean', 'Lufthansa', 'Ryanair', 'Wizz Air', 'easyJet', 'Air Serbia'];
  if (mode === 'ferry') return ['Blue Star Ferries', 'SeaJets', 'Adriatic Lines', 'Ionian Ferry'];
  return ['FlixBus', 'EuroBus', 'Greyhaven Coach', 'Balkan Lines'];
}

function eventPrice(category, seed) {
  if (['house-party', 'community', 'beach-party'].includes(category)) return seededInt(seed, 0, 25);
  if (category === 'concert') return seededInt(seed, 22, 145);
  if (category === 'festival') return seededInt(seed, 18, 95);
  if (category === 'business') return seededInt(seed, 0, 80);
  return seededInt(seed, 0, 55);
}

function normalizeAccommodation(row = {}) {
  const type = ['hotel', 'apartment', 'villa'].includes(row.type) ? row.type : 'apartment';
  const out = {
    ...row,
    id: String(row.id || uid('stay')),
    type,
    name: norm(row.name || `${type[0].toUpperCase()}${type.slice(1)} Stay`),
    city: norm(row.city || 'Greyhaven'),
    area: norm(row.area),
    address: norm(row.address),
    description: String(row.description || '').trim(),
    quality: clamp(Number(row.quality || 3), 1, 5),
    maxGuests: clamp(Number(row.maxGuests || 2), 1, 14),
    bedrooms: Math.max(0, Number(row.bedrooms || 0)),
    bathrooms: Math.max(0, Number(row.bathrooms || 0)),
    source: row.source || 'generated',
    sourcePropertyId: String(row.sourcePropertyId || ''),
    host: row.host || { kind: 'npc', name: norm(row.hostName || 'Host') },
    createdAt: Number(row.createdAt || Date.now()),
    updatedAt: Date.now(),
  };
  out.nightlyPrice = realisticNightlyPrice({ ...out, nightlyPrice: row.nightlyPrice });
  return out;
}

function putAccommodation(row) {
  const s = state();
  const value = normalizeAccommodation(row);
  s.accommodations[value.id] = value;
  saveSettings();
  return value;
}

function normalizeEvent(row = {}) {
  const categories = ['party', 'house-party', 'concert', 'festival', 'cultural', 'food', 'sports', 'community', 'business', 'beach-party', 'other'];
  const category = categories.includes(row.category) ? row.category : 'other';
  const startAt = Number(row.startAt || plusDays(rpNow(), 1).getTime());

  return {
    ...row,
    id: String(row.id || uid('event')),
    title: norm(row.title || 'Greyhaven Event'),
    category,
    city: norm(row.city || 'Greyhaven'),
    area: norm(row.area),
    venue: norm(row.venue || 'TBA'),
    description: String(row.description || '').trim(),
    organizer: row.organizer || { kind: 'npc', name: norm(row.organizerName || 'Organizer') },
    startAt,
    endAt: Number(row.endAt || (startAt + 3 * 3600000)),
    price: Math.max(0, Math.round(Number(row.price || 0))),
    capacity: Math.max(0, Number(row.capacity || 0)),
    source: row.source || 'generated',
    ownerIdentityId: String(row.ownerIdentityId || ''),
    sourcePropertyId: String(row.sourcePropertyId || ''),
    viewers: Array.isArray(row.viewers) ? row.viewers : [],
    createdAt: Number(row.createdAt || Date.now()),
    updatedAt: Date.now(),
  };
}

function putEvent(row) {
  const s = state();
  const value = normalizeEvent(row);
  s.events[value.id] = value;
  saveSettings();
  return value;
}

function lifeProperties() {
  try {
    const list = lifeApi()?.listProperties?.();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function propertyOwnerRef(property) {
  if (property?.owner?.kind === 'identity') {
    const who = identityById(property.owner.identityId);
    if (who) return refForIdentity(who);
  }
  return property?.owner || { kind: 'npc', name: 'Property host' };
}

function syncLifeShortTermProperties(city = '') {
  const s = state();
  const wantedCity = lc(city);

  for (const property of lifeProperties()) {
    if (!property?.shortTermEligible || property.status !== 'active') continue;

    const propertyText = lc(`${property.name || ''} ${property.description || ''}`);
    const businessHotel = property.type === 'business' && /\bhotel\b|\bresort\b|\binn\b|\bguesthouse\b/.test(propertyText);
    if (!['apartment', 'villa'].includes(property.type) && !businessHotel) continue;
    if (wantedCity && lc(property.city) !== wantedCity) continue;

    const idValue = `life-property:${property.id}`;
    const type = businessHotel ? 'hotel' : property.type === 'villa' ? 'villa' : 'apartment';

    s.accommodations[idValue] = normalizeAccommodation({
      ...(s.accommodations[idValue] || {}),
      id: idValue,
      type,
      name: property.name,
      city: property.city,
      area: property.area,
      address: property.address,
      description: property.description || `${property.rooms || ''} room ${type}`,
      quality: property.type === 'villa' ? 4 : 3,
      maxGuests: Math.max(1, property.bedrooms ? property.bedrooms * 2 : property.rooms || 2),
      bedrooms: property.bedrooms || 0,
      bathrooms: property.bathrooms || 0,
      source: 'life-property',
      sourcePropertyId: property.id,
      host: propertyOwnerRef(property),
      nightlyPrice: s.accommodations[idValue]?.nightlyPrice || 0,
      createdAt: s.accommodations[idValue]?.createdAt || Date.now(),
    });
  }
}

function reservationConflicts(accommodationId, checkIn, checkOut, ignoreReservationId = '') {
  const s = state();
  const start = new Date(`${checkIn}T00:00:00`).getTime();
  const end = new Date(`${checkOut}T23:59:59`).getTime();

  return Object.values(s.reservations).some(r => {
    if (r.id === ignoreReservationId || r.accommodationId !== accommodationId) return false;
    if (!['confirmed', 'shared-open', 'active'].includes(r.status)) return false;
    const otherStart = new Date(`${r.checkIn}T00:00:00`).getTime();
    const otherEnd = new Date(`${r.checkOut}T23:59:59`).getTime();
    return start < otherEnd && end > otherStart;
  });
}

function availableAccommodations(search) {
  syncLifeShortTermProperties(search.city);

  const s = state();
  const city = lc(search.city);
  const area = lc(search.area);
  const type = search.type || 'all';
  const guests = Math.max(1, Number(search.guests || 1));

  return Object.values(s.accommodations)
    .filter(a =>
      (!city || lc(a.city) === city) &&
      (!area || lc(a.area).includes(area)) &&
      (type === 'all' || a.type === type) &&
      a.maxGuests >= guests &&
      !reservationConflicts(a.id, search.checkIn, search.checkOut)
    )
    .sort((a, b) => b.quality - a.quality || a.nightlyPrice - b.nightlyPrice);
}

function openSharedReservations(search = null) {
  const s = state();
  const me = currentIdentity();
  const city = lc(search?.city || '');

  return Object.values(s.reservations)
    .filter(r => {
      if (r.mode !== 'shared' || r.status !== 'shared-open' || r.locked) return false;
      if (participantExists(r.participants, me?.id)) return false;
      if ((r.participants || []).length >= r.maxGuests) return false;
      const accommodation = s.accommodations[r.accommodationId];
      if (!accommodation) return false;
      if (city && lc(accommodation.city) !== city) return false;
      return true;
    })
    .sort((a, b) => a.createdAt - b.createdAt);
}

function createReservation({
  accommodationId,
  checkIn,
  checkOut,
  participantIds = [],
  mode = 'private',
  openSlots = 0,
}) {
  const s = state();
  const accommodation = s.accommodations[accommodationId];
  if (!accommodation) throw new Error('Accommodation is missing.');
  if (reservationConflicts(accommodationId, checkIn, checkOut)) {
    throw new Error('This stay is already booked for those dates.');
  }

  const me = currentIdentity();
  if (!me) throw new Error('No current Greyhaven phone identity.');

  const participants = [refForIdentity(me)];
  for (const identityId of participantIds) {
    const who = identityById(identityId);
    if (who && !participantExists(participants, who.id)) participants.push(refForIdentity(who));
  }

  const maxGuests = mode === 'shared'
    ? clamp(
        participants.length + Math.max(1, openSlots),
        Math.min(accommodation.maxGuests, participants.length + 1),
        accommodation.maxGuests
      )
    : participants.length;

  if (participants.length > accommodation.maxGuests) throw new Error('Too many guests for this stay.');

  const total = reservationTotal(accommodation, checkIn, checkOut, Math.max(participants.length, 1));
  const reservation = {
    id: uid('reservation'),
    accommodationId,
    checkIn,
    checkOut,
    mode,
    status: mode === 'shared' && participants.length < maxGuests ? 'shared-open' : 'confirmed',
    participants,
    maxGuests,
    total,
    perPerson: Math.ceil(total / participants.length),
    bookedByIdentityId: me.id,
    locked: false,
    autoFill: false,
    source: 'user-booking',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  s.reservations[reservation.id] = reservation;
  saveSettings();
  return reservation;
}

function joinSharedReservation(reservationId) {
  const s = state();
  const reservation = s.reservations[reservationId];
  const me = currentIdentity();

  if (!reservation || reservation.status !== 'shared-open' || reservation.locked) throw new Error('This shared stay is no longer open.');
  if (!me) throw new Error('No current phone identity.');
  if (participantExists(reservation.participants, me.id)) throw new Error('This character is already in the booking.');
  if (reservation.participants.length >= reservation.maxGuests) throw new Error('No open spots remain.');

  reservation.participants.push(refForIdentity(me));
  reservation.perPerson = Math.ceil(reservation.total / reservation.participants.length);
  reservation.updatedAt = Date.now();

  if (reservation.participants.length >= reservation.maxGuests) reservation.status = 'confirmed';

  saveSettings();
  return reservation;
}

function leaveSharedReservation(reservationId) {
  const s = state();
  const reservation = s.reservations[reservationId];
  const me = currentIdentity();
  if (!reservation || !me || reservation.mode !== 'shared') return false;

  reservation.participants = reservation.participants.filter(x =>
    !(x.kind === 'identity' && x.identityId === me.id)
  );

  if (!reservation.participants.length) {
    reservation.status = 'cancelled';
  } else {
    reservation.status = reservation.locked || reservation.participants.length >= reservation.maxGuests ? 'confirmed' : 'shared-open';
    reservation.perPerson = Math.ceil(reservation.total / reservation.participants.length);
  }

  reservation.updatedAt = Date.now();
  saveSettings();
  return true;
}

function bookingOwnedByCurrent(reservation) {
  const me = currentIdentity();
  return participantExists(reservation?.participants || [], me?.id);
}

function bookingCreatedByCurrent(reservation) {
  return Boolean(reservation && currentIdentity()?.id && reservation.bookedByIdentityId === currentIdentity().id);
}

function favoriteAccommodationIds(identityId = currentIdentity()?.id) {
  const s = state();
  if (!identityId) return [];
  if (!Array.isArray(s.favorites.accommodations[identityId])) s.favorites.accommodations[identityId] = [];
  return s.favorites.accommodations[identityId];
}

function isAccommodationFavorite(accommodationId) {
  return favoriteAccommodationIds().includes(accommodationId);
}

function toggleAccommodationFavorite(accommodationId) {
  const s = state();
  const me = currentIdentity();
  if (!me || !s.accommodations[accommodationId]) return false;
  const list = favoriteAccommodationIds(me.id);
  const index = list.indexOf(accommodationId);
  if (index >= 0) list.splice(index, 1);
  else list.unshift(accommodationId);
  saveSettings();
  return index < 0;
}

function savedAccommodations() {
  const s = state();
  return favoriteAccommodationIds()
    .map(idValue => s.accommodations[idValue])
    .filter(Boolean);
}

function reservationCheckInMs(reservation) {
  return new Date(`${reservation.checkIn}T15:00:00`).getTime();
}

function reservationCheckOutMs(reservation) {
  return new Date(`${reservation.checkOut}T11:00:00`).getTime();
}

function reservationLifecycle(reservation, nowMs = rpNow().getTime()) {
  if (!reservation) return 'unknown';
  if (reservation.status === 'cancelled') return 'cancelled';

  const checkIn = reservationCheckInMs(reservation);
  const checkOut = reservationCheckOutMs(reservation);

  if (nowMs >= checkOut) return 'completed';
  if (nowMs >= checkOut - 3 * 3600000 && nowMs < checkOut) return 'checkout-soon';
  if (nowMs >= checkIn) return 'staying';
  if (nowMs >= checkIn - 3 * 3600000) return 'checkin-soon';
  return 'upcoming';
}

function lifecycleLabel(value) {
  return {
    upcoming: 'Upcoming',
    'checkin-soon': 'Check-in soon',
    staying: 'Currently staying',
    'checkout-soon': 'Checkout soon',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }[value] || 'Booking';
}

function lockSharedReservation(reservationId, locked) {
  const s = state();
  const reservation = s.reservations[reservationId];
  if (!reservation || reservation.mode !== 'shared') throw new Error('Shared booking not found.');
  if (!bookingCreatedByCurrent(reservation)) throw new Error('Only the booking creator can lock it.');
  if (reservation.status === 'cancelled') throw new Error('This booking is cancelled.');

  reservation.locked = Boolean(locked);
  reservation.status = reservation.locked || reservation.participants.length >= reservation.maxGuests
    ? 'confirmed'
    : 'shared-open';
  reservation.updatedAt = Date.now();
  saveSettings();
  return reservation;
}

function setSharedAutoFill(reservationId, enabled) {
  const s = state();
  const reservation = s.reservations[reservationId];
  if (!reservation || reservation.mode !== 'shared') throw new Error('Shared booking not found.');
  if (!bookingCreatedByCurrent(reservation)) throw new Error('Only the booking creator can change auto-fill.');
  if (reservation.locked) throw new Error('Unlock the booking before enabling auto-fill.');

  reservation.autoFill = Boolean(enabled);
  reservation.updatedAt = Date.now();
  saveSettings();
  return reservation;
}

function removeSharedParticipant(reservationId, identityId) {
  const s = state();
  const reservation = s.reservations[reservationId];
  if (!reservation || reservation.mode !== 'shared') throw new Error('Shared booking not found.');
  if (!bookingCreatedByCurrent(reservation)) throw new Error('Only the booking creator can remove participants.');
  if (identityId === reservation.bookedByIdentityId) throw new Error('The booking creator cannot remove themselves.');

  const before = reservation.participants.length;
  reservation.participants = reservation.participants.filter(ref =>
    !(ref.kind === 'identity' && ref.identityId === identityId)
  );
  if (reservation.participants.length === before) return reservation;

  reservation.perPerson = Math.ceil(reservation.total / Math.max(1, reservation.participants.length));
  reservation.status = reservation.locked || reservation.participants.length >= reservation.maxGuests
    ? 'confirmed'
    : 'shared-open';
  reservation.updatedAt = Date.now();
  saveSettings();
  return reservation;
}

function cancelReservation(reservationId) {
  const s = state();
  const reservation = s.reservations[reservationId];
  if (!reservation) throw new Error('Booking not found.');
  if (!bookingCreatedByCurrent(reservation)) throw new Error('Only the booking creator can cancel the entire reservation.');

  reservation.status = 'cancelled';
  reservation.locked = true;
  reservation.autoFill = false;
  reservation.cancelledAt = Date.now();
  reservation.updatedAt = Date.now();
  saveSettings();
  return reservation;
}

function deleteReservationRecord(reservationId) {
  const s = state();
  const reservation = s.reservations[reservationId];
  if (!reservation) return false;
  if (!bookingCreatedByCurrent(reservation)) throw new Error('Only the booking creator can delete the reservation record.');

  const lifecycle = reservationLifecycle(reservation);
  if (!['cancelled', 'completed'].includes(lifecycle)) throw new Error('Cancel or complete the trip before deleting it.');

  delete s.reservations[reservationId];
  saveSettings();
  return true;
}

function cancelTransportBooking(bookingId) {
  const s = state();
  const booking = s.transportBookings[bookingId];
  if (!booking) throw new Error('Ticket booking not found.');
  if (booking.bookedByIdentityId !== currentIdentity()?.id) throw new Error('Only the ticket buyer can cancel it.');

  booking.status = 'cancelled';
  booking.cancelledAt = Date.now();
  booking.updatedAt = Date.now();
  saveSettings();
  return booking;
}

function deleteTransportBooking(bookingId) {
  const s = state();
  const booking = s.transportBookings[bookingId];
  if (!booking) return false;
  if (booking.bookedByIdentityId !== currentIdentity()?.id) throw new Error('Only the ticket buyer can delete it.');
  if (booking.status !== 'cancelled' && booking.arrivalAt > rpNow().getTime()) throw new Error('Cancel or complete this trip before deleting it.');

  delete s.transportBookings[bookingId];
  saveSettings();
  return true;
}

function autoFillCandidates(reservation) {
  const used = new Set((reservation.participants || []).filter(x => x.kind === 'identity').map(x => x.identityId));
  return identities().filter(identity =>
    !used.has(identity.id) &&
    identity.id !== reservation.bookedByIdentityId
  );
}

function processAutoFillReservation(reservationId, { forceOne = false } = {}) {
  const s = state();
  const reservation = s.reservations[reservationId];
  if (!reservation || reservation.mode !== 'shared' || reservation.locked || !reservation.autoFill || reservation.status === 'cancelled') return 0;

  const slots = Math.max(0, reservation.maxGuests - reservation.participants.length);
  if (!slots) return 0;

  const pool = autoFillCandidates(reservation);
  if (!pool.length) return 0;

  const wanted = forceOne ? 1 : seededInt(`${reservation.id}:${Date.now() >> 13}`, 0, Math.min(2, slots, pool.length));
  let added = 0;

  for (let index = 0; index < wanted; index++) {
    if (!pool.length || reservation.participants.length >= reservation.maxGuests) break;
    const pick = seededInt(`${reservation.id}:${Date.now()}:${index}`, 0, pool.length - 1);
    const who = pool.splice(pick, 1)[0];
    if (!who) continue;
    reservation.participants.push(refForIdentity(who));
    added++;
  }

  if (added) {
    reservation.perPerson = Math.ceil(reservation.total / reservation.participants.length);
    reservation.status = reservation.participants.length >= reservation.maxGuests ? 'confirmed' : 'shared-open';
    reservation.updatedAt = Date.now();
    saveSettings();
  }

  return added;
}

function checkOwnedSharedActivity() {
  const s = state();
  const me = currentIdentity();
  let added = 0;

  for (const reservation of Object.values(s.reservations)) {
    if (
      reservation.mode === 'shared' &&
      reservation.bookedByIdentityId === me?.id &&
      reservation.autoFill &&
      !reservation.locked &&
      reservation.status !== 'cancelled'
    ) {
      added += processAutoFillReservation(reservation.id);
    }
  }
  return added;
}

function localNpcNamePool(city) {
  const value = lc(city);
  if (/paris|france/.test(value)) return ['Camille', 'Julien', 'Manon', 'Théo', 'Léa', 'Hugo', 'Inès', 'Lucas'];
  if (/santorini|athens|greece|mykonos/.test(value)) return ['Nikos', 'Elena', 'Yannis', 'Sofia', 'Dimitris', 'Maria', 'Kostas', 'Irene'];
  if (/tokyo|japan/.test(value)) return ['Haru', 'Yuki', 'Ren', 'Aoi', 'Sora', 'Mio', 'Kaito', 'Rin'];
  if (/rome|italy|milan/.test(value)) return ['Luca', 'Giulia', 'Marco', 'Sofia', 'Matteo', 'Elena', 'Andrea', 'Chiara'];
  if (/barcelona|madrid|spain/.test(value)) return ['Lucía', 'Mateo', 'Sofía', 'Hugo', 'Paula', 'Álvaro', 'Marta', 'Diego'];
  return ['Maya', 'Leo', 'Nora', 'Eli', 'Sami', 'Lina', 'Alex', 'Mila'];
}

function localNpcRef(city, indexSeed = 0) {
  const s = state();
  const pool = localNpcNamePool(city);
  const index = seededInt(`${city}:${indexSeed}`, 0, pool.length - 1);
  const name = pool[index];
  const cityKey = lc(city).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'local';
  const idValue = `local:${cityKey}:${lc(name)}`;

  if (!s.localNpcs[idValue]) {
    s.localNpcs[idValue] = {
      id: idValue,
      kind: 'npc',
      name,
      city: norm(city || 'Unknown'),
      avatar: '',
      createdAt: Date.now(),
    };
  }

  return {
    kind: 'npc',
    npcId: idValue,
    name: s.localNpcs[idValue].name,
    avatar: s.localNpcs[idValue].avatar || '',
    city: s.localNpcs[idValue].city,
  };
}


function hasCharacterCard(name) {
  return (ctx()?.characters || []).some(ch => lc(ch?.name) === lc(name));
}

function characterCardData(name) {
  const ch = (ctx()?.characters || []).find(row => lc(row?.name) === lc(name));
  if (!ch) return null;
  const read = key => {
    const value = ch?.[key] ?? ch?.data?.[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  return {
    name: norm(ch.name || name),
    description: read('description').slice(0, 6500),
    personality: read('personality').slice(0, 3500),
    scenario: read('scenario').slice(0, 2500),
    examples: read('mes_example').slice(0, 3500),
  };
}

function hostRefKey(ref) {
  if (ref?.kind === 'identity' && ref.identityId) return `identity:${ref.identityId}`;
  return `npc:${lc(participantName(ref)) || 'host'}`;
}

function hostThreadKey(stay, ownerIdentityId = currentIdentity()?.id || '') {
  return `${ownerIdentityId}::${hostRefKey(stay?.host)}`;
}

function ensureHostThread(stay) {
  const s = state();
  const me = currentIdentity();
  if (!s || !stay || !me) return null;

  const key = hostThreadKey(stay, me.id);
  let thread = s.hostThreads[key];
  if (!thread || typeof thread !== 'object') {
    thread = {
      id: uid('host-thread'),
      key,
      ownerIdentityId: me.id,
      ownerName: me.name,
      host: clone(stay.host),
      hostName: participantName(stay.host),
      stayIds: [String(stay.id)],
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    s.hostThreads[key] = thread;
  }

  if (!thread.stayIds.includes(String(stay.id))) thread.stayIds.push(String(stay.id));
  thread.host = clone(stay.host);
  thread.hostName = participantName(stay.host);
  thread.ownerName = me.name;
  thread.updatedAt = Math.max(Number(thread.updatedAt || 0), Number(thread.createdAt || Date.now()));
  saveSettings();
  return thread;
}

function hostThreadsForCurrent() {
  const s = state();
  const me = currentIdentity();
  if (!s || !me) return [];
  return Object.values(s.hostThreads)
    .filter(thread => String(thread?.ownerIdentityId || '') === String(me.id))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function hostThreadForStay(stay) {
  const me = currentIdentity();
  if (!stay || !me) return null;
  return state()?.hostThreads?.[hostThreadKey(stay, me.id)] || null;
}

function openHostChat(accommodationId) {
  const stay = state()?.accommodations?.[accommodationId];
  if (!stay) return;
  ensureHostThread(stay);
  view.tab = 'chats';
  view.detailKind = 'host-chat';
  view.detailId = String(stay.id);
  render();
}

function hostFallbackReply(userText = '') {
  const text = lc(userText);
  if (/\b(check.?in|early|arrive)\b/.test(text)) return `Hi! I’ll check the arrival timing and let you know what we can do.`;
  if (/\b(check.?out|late)\b/.test(text)) return `Hi! I’ll check the checkout timing for you and confirm what’s possible.`;
  if (/\b(parking|car)\b/.test(text)) return `Hi! I’ll confirm the parking details for the property and get back to you.`;
  if (/\b(address|location|where)\b/.test(text)) return `Hi! The exact arrival details are tied to the booking, but I can clarify anything you need about the location.`;
  return `Hi! Thanks for the message. I’ll check that for you and get back to you shortly.`;
}

async function generateHostChatReply(stay, thread, userText) {
  const c = ctx();
  const me = currentIdentity();
  const hostName = participantName(stay?.host);
  if (!c || !me || !hostName) return '';

  const card = characterCardData(hostName);
  const recent = (thread?.messages || []).slice(-10)
    .map(message => `${message.senderName}: ${message.text}`)
    .join('\n');

  const systemPrompt = card
    ? `You are ${hostName}, a full Greyhaven character, replying in Airbnb's private host chat to ${me.name}.

CHARACTER:
${JSON.stringify(card)}

Rules:
- Write ONE natural private app message only.
- Preserve ${hostName}'s established personality, relationship style and vocabulary.
- This is a text chat, not prose roleplay: no action narration, no asterisks, no speaker label.
- Answer the guest's latest message directly.
- Stay consistent with the property facts below.
- Do not invent dramatic new events or control ${me.name}'s actions.
- Usually 1-4 short sentences.`
    : `You are ${hostName}, the host/contact for a fictional Airbnb-style short-stay property.

Rules:
- Write ONE natural private host-chat message only.
- No prose narration, no asterisks, no speaker label.
- Be helpful and concise, usually 1-4 short sentences.
- Answer only what the guest asked.
- Stay consistent with the property facts.
- Do not invent dramatic problems, relationships or extra events.`;

  const prompt = `PROPERTY
Name: ${stay.name}
Type: ${stay.type}
City: ${stay.city}
Area: ${stay.area || 'unspecified'}
Address: ${stay.address || 'provided with booking'}
Nightly price: ${money(stay.nightlyPrice)}
Description: ${stay.description || 'Short-stay accommodation'}

RECENT AIRBNB CHAT
${recent || '(new conversation)'}

LATEST MESSAGE FROM ${me.name}
${String(userText || '').trim()}

Reply as ${hostName}.`;

  try {
    if (typeof c.generateRaw !== 'function') return hostFallbackReply(userText);
    const raw = await c.generateRaw({
      prompt,
      systemPrompt,
      responseLength: 320,
      trimNames: false,
    });

    const reply = String(raw || '')
      .trim()
      .replace(/^```(?:text)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(new RegExp(`^${hostName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i'), '')
      .trim()
      .slice(0, 1000);

    return reply || hostFallbackReply(userText);
  } catch (error) {
    console.warn(`[${GHTE_MODULE}] Airbnb host reply`, error);
    return hostFallbackReply(userText);
  }
}

function renderHostChatList() {
  const s = state();
  const rows = hostThreadsForCurrent();

  return `<main class="ghte-main airbnb ghte-host-chat-list">
    <div class="ghte-section-heading"><div><b>Host chats</b><small>Private to this phone and this RP chat.</small></div></div>
    ${rows.length ? rows.map(thread => {
      const stayId = [...(thread.stayIds || [])].reverse().find(idValue => s.accommodations[idValue]);
      const stay = stayId ? s.accommodations[stayId] : null;
      const last = (thread.messages || []).at(-1);
      return `<button type="button" class="ghte-host-thread-row" data-ghte-host-thread="${esc(stay?.id || stayId || '')}" ${stay ? '' : 'disabled'}>
        ${avatar(thread.host, 'small')}
        <span><b>${esc(thread.hostName || participantName(thread.host))}</b><small>${esc(stay?.name || 'Previous stay')}</small>${last ? `<em>${esc(last.text)}</em>` : '<em>No messages yet</em>'}</span>
        <i class="fa-solid fa-chevron-right"></i>
      </button>`;
    }).join('') : empty('fa-regular fa-message', 'No host chats yet', 'Open a stay and tap Message host to start one.')}
  </main>`;
}

function renderHostChat(stay) {
  const thread = ensureHostThread(stay);
  const me = currentIdentity();
  if (!thread || !me) return empty('fa-regular fa-message', 'Chat unavailable', 'Open the stay again and retry.');

  const messages = (thread.messages || []).map(message => {
    const mine = message.senderType === 'guest';
    return `<div class="ghte-host-bubble ${mine ? 'mine' : 'theirs'}">
      <span>${esc(message.text).replace(/\n/g, '<br>')}</span>
      <small>${new Date(message.timeMs || Date.now()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</small>
    </div>`;
  }).join('');

  return `<main class="ghte-main airbnb ghte-host-chat-screen">
    <section class="ghte-host-chat-head">
      ${avatar(stay.host, 'small')}
      <span><b>${esc(participantName(stay.host))}</b><small>${esc(stay.name)} · ${esc(stay.city)}</small></span>
      <button type="button" data-ghte-stay-detail="${esc(stay.id)}"><i class="fa-solid fa-house"></i></button>
    </section>
    <section class="ghte-host-chat-messages">
      ${messages || '<div class="ghte-chat-intro">Ask the host about check-in, parking, the property, or anything else about the stay.</div>'}
      ${hostReplyBusy === thread.id ? '<div class="ghte-host-typing"><i></i><i></i><i></i></div>' : ''}
    </section>
    <form class="ghte-host-chat-compose" data-ghte-host-chat-form data-id="${esc(stay.id)}">
      <input name="text" autocomplete="off" placeholder="Message host…" ${hostReplyBusy === thread.id ? 'disabled' : ''}>
      <button type="submit" ${hostReplyBusy === thread.id ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
    </form>
  </main>`;
}

function itineraryBundlesForCurrent() {
  const s = state();
  const me = currentIdentity();
  const stays = Object.values(s.reservations)
    .filter(r => participantExists(r.participants, me?.id) && !['cancelled'].includes(r.status))
    .filter(r => reservationLifecycle(r) !== 'completed')
    .sort((a, b) => reservationCheckInMs(a) - reservationCheckInMs(b));

  const transport = Object.values(s.transportBookings)
    .filter(t => participantExists(t.travelers, me?.id) && t.status !== 'cancelled');

  return stays.map(reservation => {
    const stay = s.accommodations[reservation.accommodationId];
    const city = stay?.city || '';
    const checkIn = reservationCheckInMs(reservation);
    const checkOut = reservationCheckOutMs(reservation);

    const tickets = transport.filter(ticket => {
      const destinationMatch = lc(ticket.to) === lc(city) && ticket.departureAt >= checkIn - 2 * 86400000 && ticket.departureAt <= checkIn + 86400000;
      const returnMatch = lc(ticket.from) === lc(city) && ticket.departureAt >= checkOut - 86400000 && ticket.departureAt <= checkOut + 2 * 86400000;
      return destinationMatch || returnMatch;
    });

    return { reservation, stay, tickets };
  });
}

function processLifecycleReminders() {
  const s = state();
  const me = currentIdentity();
  if (!me) return;
  const nowMs = rpNow().getTime();

  for (const reservation of Object.values(s.reservations)) {
    if (!participantExists(reservation.participants, me.id) || reservation.status === 'cancelled') continue;

    const lifecycle = reservationLifecycle(reservation, nowMs);
    const stay = s.accommodations[reservation.accommodationId];
    const prefix = `${me.id}:${reservation.id}`;

    if (lifecycle === 'checkin-soon' && !s.reminderFlags[`${prefix}:checkin`]) {
      s.reminderFlags[`${prefix}:checkin`] = Date.now();
      globalThis.toastr?.info?.(`Airbnb · Check-in for ${stay?.name || 'your stay'} is within 3 hours.`);
      saveSettings();
    }

    if (lifecycle === 'checkout-soon' && !s.reminderFlags[`${prefix}:checkout`]) {
      s.reminderFlags[`${prefix}:checkout`] = Date.now();
      globalThis.toastr?.info?.(`Airbnb · Checkout from ${stay?.name || 'your stay'} is within 3 hours.`);
      saveSettings();
    }
  }
}

/* ---------------- AI discovery ---------------- */

function parseJsonLoose(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  try { return JSON.parse(text); }
  catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw new Error('The AI did not return valid JSON.');
  }
}

async function generateJson(systemPrompt, prompt, responseLength = 1700) {
  const c = ctx();
  if (typeof c?.generateRaw !== 'function') throw new Error('SillyTavern generateRaw is unavailable.');
  const raw = await c.generateRaw({ prompt, systemPrompt, responseLength, trimNames: false });
  return parseJsonLoose(raw);
}

function identityContext(limit = 34) {
  const me = currentIdentity();
  return identities()
    .filter(x => x.id !== me?.id)
    .slice(0, limit)
    .map(x => ({ id: x.id, name: x.name }));
}

async function refreshStays() {
  if (stayRefreshBusy) return;

  const s = state();
  const search = s.search.stays;
  stayRefreshBusy = true;
  render();

  try {
    syncLifeShortTermProperties(search.city);

    const systemPrompt = `You generate realistic SHORT-STAY accommodation discovery for a fictional life simulator.
Return ONLY valid JSON.

Rules:
- Exactly 5 results.
- Types only hotel, apartment, villa.
- These are short stays, NOT long-term rentals.
- Match city, area, guest capacity and requested type.
- Whole-Euro nightlyPrice only.
- Prices must be realistic, not luxury nonsense unless the property itself is luxury.
- maxGuests must be plausible.
- Existing Greyhaven property state is handled separately; do not pretend to know it.
- Host is an NPC/business name only. Keep it concise.
JSON:
{"stays":[{"type":"hotel|apartment|villa","name":"","city":"","area":"","address":"","quality":3,"maxGuests":4,"bedrooms":2,"bathrooms":1,"nightlyPrice":120,"hostName":"","description":""}]}`;

    const prompt = `SEARCH:
city=${search.city}
area=${search.area || 'any'}
type=${search.type}
guests=${search.guests}
check-in=${search.checkIn}
check-out=${search.checkOut}

Generate realistic top choices specifically for this search.`;

    const result = await generateJson(systemPrompt, prompt, 1700);
    const rows = Array.isArray(result?.stays) ? result.stays.slice(0, 5) : [];
    const newIds = [];

    for (const raw of rows) {
      const type = ['hotel', 'apartment', 'villa'].includes(raw.type) ? raw.type : 'apartment';
      if (search.type !== 'all' && type !== search.type) continue;

      const stay = putAccommodation({
        id: uid('stay'),
        type,
        name: raw.name,
        city: raw.city || search.city,
        area: raw.area || search.area,
        address: raw.address,
        quality: raw.quality,
        maxGuests: raw.maxGuests,
        bedrooms: raw.bedrooms,
        bathrooms: raw.bathrooms,
        nightlyPrice: raw.nightlyPrice,
        host: { kind: 'npc', name: norm(raw.hostName || 'Host') },
        description: raw.description,
        source: 'generated',
      });

      if (stay.maxGuests >= Number(search.guests || 1)) newIds.push(stay.id);
    }

    // Existing Life properties are intentionally mixed into the results.
    const existing = availableAccommodations(search)
      .filter(x => x.source === 'life-property')
      .slice(0, 3)
      .map(x => x.id);

    s.search.stays.lastResultIds = [...new Set([...existing, ...newIds])].slice(0, 8);
    saveSettings();
  } catch (error) {
    console.error(`[${GHTE_MODULE}] stay refresh`, error);
    globalThis.toastr?.error?.(error.message || 'Stay search failed.');
  } finally {
    stayRefreshBusy = false;
    render();
  }
}

function seedCommunityShares() {
  const s = state();
  const search = s.search.stays;
  const me = currentIdentity();
  const existingCandidates = identities().filter(x => x.id !== me?.id);

  const stays = availableAccommodations({
    ...search,
    guests: 1,
  }).filter(a => a.maxGuests >= 2);

  let created = 0;
  for (let i = 0; i < stays.length && created < 2; i++) {
    const stay = stays[i];
    if (Object.values(s.reservations).some(r =>
      r.accommodationId === stay.id &&
      r.mode === 'shared' &&
      r.status === 'shared-open'
    )) continue;

    const maxGuests = Math.min(stay.maxGuests, seededInt(`${stay.id}:capacity`, 2, Math.min(5, stay.maxGuests)));
    const party = [];

    // Destination-local NPCs are allowed in THEIR OWN community bookings.
    // They are never used by auto-fill for a booking created by the player.
    party.push(localNpcRef(stay.city, `${stay.id}:${Date.now()}`));

    const remainingBeforeOpenSlot = Math.max(0, maxGuests - party.length - 1);
    const existingCount = Math.min(
      remainingBeforeOpenSlot,
      existingCandidates.length,
      seededInt(`${stay.id}:existing-party:${Date.now() >> 12}`, 0, Math.min(2, remainingBeforeOpenSlot, existingCandidates.length))
    );
    const pool = [...existingCandidates];

    for (let personIndex = 0; personIndex < existingCount; personIndex++) {
      const pickIndex = seededInt(`${Date.now()}:${stay.id}:${personIndex}`, 0, pool.length - 1);
      const who = pool.splice(pickIndex, 1)[0];
      if (who) party.push(refForIdentity(who));
    }

    const total = reservationTotal(stay, search.checkIn, search.checkOut, Math.max(1, party.length));
    const reservationId = uid('community-share');

    s.reservations[reservationId] = {
      id: reservationId,
      accommodationId: stay.id,
      checkIn: search.checkIn,
      checkOut: search.checkOut,
      mode: 'shared',
      status: 'shared-open',
      participants: party,
      maxGuests,
      total,
      perPerson: Math.ceil(total / party.length),
      bookedByIdentityId: '',
      locked: false,
      autoFill: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: 'community-local',
    };
    created++;
  }

  saveSettings();
  return created;
}

async function refreshShared() {
  if (sharedRefreshBusy) return;
  sharedRefreshBusy = true;
  render();

  try {
    // This is the only action that creates random community shared bookings.
    // Opening/refreshing Stays never auto-adds strangers to a user's booking.
    const created = seedCommunityShares();
    if (!created) globalThis.toastr?.info?.('No new community shared stays appeared this time.');
  } catch (error) {
    globalThis.toastr?.error?.(error.message || 'Shared stay refresh failed.');
  } finally {
    sharedRefreshBusy = false;
    render();
  }
}


function matchingUserCreatedEvents(city, category = 'all') {
  const s = state();
  const nowMs = rpNow().getTime();
  return Object.values(s.events)
    .filter(event =>
      event.source === 'user-created' &&
      event.startAt >= nowMs &&
      lc(event.city) === lc(city) &&
      (category === 'all' || event.category === category)
    )
    .sort((a, b) => a.startAt - b.startAt);
}

function markEventViewed(eventId) {
  const s = state();
  const event = s.events[eventId];
  const me = currentIdentity();

  if (!event || !me || event.ownerIdentityId === me.id || event.source !== 'user-created') return false;

  event.viewers ||= [];
  if (event.viewers.some(x => x.identityId === me.id)) return false;

  event.viewers.push({
    identityId: me.id,
    name: me.name,
    viewedAt: Date.now(),
  });
  event.updatedAt = Date.now();
  saveSettings();
  return true;
}

async function refreshEvents() {
  if (eventRefreshBusy) return;

  const s = state();
  const search = s.search.events;
  eventRefreshBusy = true;
  render();

  try {
    const existing = identityContext();

    const systemPrompt = `You generate event discovery for a realistic fictional city/life simulator.
Return ONLY valid JSON.

Rules:
- Exactly 6 events.
- Categories: party, house-party, concert, festival, cultural, food, sports, community, business, beach-party, other.
- Match requested city and category.
- Events must start within the next 45 days.
- organizerType "existing" may ONLY use an exact ID/name from ALLOWED EXISTING CHARACTERS.
- Otherwise use organizerType "npc".
- Existing characters can appear even if the current character has never met them.
- Descriptions are information only. Do not imply the current character knows about an event until they discover it here.
- ticketPrice is a realistic whole-Euro information price; 0 means free.
JSON:
{"events":[{"title":"","category":"party","city":"","area":"","venue":"","dayOffset":3,"startHour":21,"durationHours":4,"organizerType":"existing|npc","organizerIdentityId":"","organizerName":"","ticketPrice":20,"capacity":120,"description":""}]}`;

    const prompt = `TODAY: ${dateInput(rpNow())}
CITY: ${search.city}
CATEGORY FILTER: ${search.category}
ALLOWED EXISTING CHARACTERS:
${JSON.stringify(existing)}

Generate the current top event discoveries.`;

    const result = await generateJson(systemPrompt, prompt, 1800);
    const rows = Array.isArray(result?.events) ? result.events.slice(0, 6) : [];
    const ids = [];

    for (const raw of rows) {
      const category = String(raw.category || 'other');
      if (search.category !== 'all' && category !== search.category) continue;

      const start = plusDays(rpNow(), clamp(Number(raw.dayOffset || 1), 0, 45));
      start.setHours(clamp(Number(raw.startHour || 19), 0, 23), 0, 0, 0);

      let organizer;
      if (raw.organizerType === 'existing') {
        const who = identityById(raw.organizerIdentityId) ||
          identities().find(x => lc(x.name) === lc(raw.organizerName));
        organizer = who ? refForIdentity(who) : { kind: 'npc', name: norm(raw.organizerName || 'Organizer') };
      } else {
        organizer = { kind: 'npc', name: norm(raw.organizerName || 'Organizer') };
      }

      const event = putEvent({
        id: uid('event'),
        title: raw.title,
        category,
        city: raw.city || search.city,
        area: raw.area,
        venue: raw.venue,
        startAt: start.getTime(),
        endAt: start.getTime() + clamp(Number(raw.durationHours || 3), 1, 16) * 3600000,
        organizer,
        price: eventPrice(category, `${raw.title}:${raw.ticketPrice}:${start.getTime()}`),
        capacity: raw.capacity,
        description: raw.description,
        source: 'generated',
      });

      ids.push(event.id);
    }

    const communityIds = matchingUserCreatedEvents(search.city, search.category)
      .map(event => event.id);

    s.search.events.lastResultIds = [...new Set([...communityIds, ...ids])].slice(0, 10);
    saveSettings();
  } catch (error) {
    console.error(`[${GHTE_MODULE}] events refresh`, error);
    globalThis.toastr?.error?.(error.message || 'Event refresh failed.');
  } finally {
    eventRefreshBusy = false;
    render();
  }
}


/* ---------------- transport ---------------- */

function transportChoices(mode, from, to, when) {
  const date = new Date(when);
  const operators = transportOperators(mode);
  const basePrice = transportUnitPrice(mode, from, to, when);
  const duration = transportDurationMinutes(mode, from, to);

  return [0, 1, 2].map(index => {
    const departure = new Date(date.getTime());
    departure.setHours(
      mode === 'flight' ? [7, 13, 19][index] : [8, 14, 20][index],
      [10, 35, 5][index],
      0,
      0
    );
    const arrival = new Date(departure.getTime() + duration * 60000 + index * 18 * 60000);
    const operator = operators[(hashString(`${from}:${to}:${index}`)) % operators.length];
    const price = Math.max(1, Math.round(basePrice * [0.92, 1, 1.14][index]));

    return {
      id: `${mode}:${hashString(`${from}:${to}:${when}:${index}`)}`,
      mode,
      from,
      to,
      departureAt: departure.getTime(),
      arrivalAt: arrival.getTime(),
      operator,
      price,
    };
  });
}

function bookTransport(choice, travelerIds = []) {
  const s = state();
  const me = currentIdentity();
  if (!me) throw new Error('No current identity.');

  const travelers = [refForIdentity(me)];
  for (const idValue of travelerIds) {
    const who = identityById(idValue);
    if (who && !participantExists(travelers, who.id)) travelers.push(refForIdentity(who));
  }

  const booking = {
    ...choice,
    id: uid('transport'),
    travelers,
    total: choice.price * travelers.length,
    status: 'confirmed',
    bookedByIdentityId: me.id,
    createdAt: Date.now(),
  };

  s.transportBookings[booking.id] = booking;
  saveSettings();
  return booking;
}

/* ---------------- own events ---------------- */

function ownEventVenueOptions() {
  const me = currentIdentity();
  return lifeProperties()
    .filter(p => p.status === 'active' && p.owner?.kind === 'identity' && p.owner.identityId === me?.id)
    .filter(p => ['house', 'villa', 'business', 'apartment'].includes(p.type));
}

function createOwnedEvent(data) {
  const me = currentIdentity();
  if (!me) throw new Error('No current identity.');

  const start = new Date(data.startAt);
  if (Number.isNaN(start.getTime())) throw new Error('Choose a valid event date/time.');

  const property = data.propertyId
    ? ownEventVenueOptions().find(p => p.id === data.propertyId)
    : null;

  const category = data.category || 'house-party';
  const event = putEvent({
    title: data.title,
    category,
    city: property?.city || data.city || 'Greyhaven',
    area: property?.area || data.area || '',
    venue: property?.name || data.venue || 'Private location',
    sourcePropertyId: property?.id || '',
    startAt: start.getTime(),
    endAt: start.getTime() + clamp(Number(data.durationHours || 4), 1, 18) * 3600000,
    organizer: refForIdentity(me),
    ownerIdentityId: me.id,
    price: Math.max(0, Math.round(Number(data.price || 0))),
    capacity: Math.max(0, Number(data.capacity || 0)),
    description: data.description,
    source: 'user-created',
    viewers: [],
  });

  return event;
}

/* ---------------- UI shell ---------------- */

function ensureCss() {
  if (qs('#ghte-stylesheet')) return;
  const link = document.createElement('link');
  link.id = 'ghte-stylesheet';
  link.rel = 'stylesheet';
  link.href = new URL('./travel-events.css', import.meta.url).href;
  document.head.appendChild(link);
}

function customAppIcon(appName) {
  if (appName === 'booking') {
    return `<button class="ghp-app-icon ghte-home-icon" data-ghte-open="booking">
      <span class="ghp-app-square ghte-airbnb-icon"><i class="fa-brands fa-airbnb"></i></span>
      <small>Airbnb</small>
    </button>`;
  }

  return `<button class="ghp-app-icon ghte-home-icon" data-ghte-open="events">
    <span class="ghp-app-square ghte-eventbrite-icon"><i class="fa-solid fa-ticket"></i></span>
    <small>Eventbrite</small>
  </button>`;
}

function injectHomeIcons() {
  syncAppDefaults();
  const grid = qs('#ghp-overlay:not([hidden]) .ghp-home .ghp-grid');
  if (!grid) return;

  let booking = qs('[data-ghte-open="booking"]', grid);
  if (!booking) {
    const life = qs('[data-ghla-open-life]', grid);
    if (life) life.insertAdjacentHTML('afterend', customAppIcon('booking'));
    else {
      const settings = qs('[data-open-app="settings"]', grid);
      if (settings) settings.insertAdjacentHTML('beforebegin', customAppIcon('booking'));
      else grid.insertAdjacentHTML('beforeend', customAppIcon('booking'));
    }
    booking = qs('[data-ghte-open="booking"]', grid);
  }

  // Life can be injected by another module a frame later. Once it exists,
  // keep Airbnb immediately after the folder rather than leaving it at the end.
  const life = qs('[data-ghla-open-life]', grid);
  if (life && booking && life.nextElementSibling !== booking) {
    life.insertAdjacentElement('afterend', booking);
  }

  if (isEventsInstalled()) {
    let events = qs('[data-ghte-open="events"]', grid);
    if (!events) {
      booking = qs('[data-ghte-open="booking"]', grid);
      if (booking) booking.insertAdjacentHTML('afterend', customAppIcon('events'));
      else grid.insertAdjacentHTML('beforeend', customAppIcon('events'));
      events = qs('[data-ghte-open="events"]', grid);
    }
    booking = qs('[data-ghte-open="booking"]', grid);
    if (booking && events && booking.nextElementSibling !== events) {
      booking.insertAdjacentElement('afterend', events);
    }
  } else {
    qs('[data-ghte-open="events"]', grid)?.remove();
  }
}

function injectSettingsToggle() {
  syncAppDefaults();

  const settingsMain = qs('#ghp-overlay:not([hidden]) .ghp-settings');
  if (!settingsMain) return;

  const heading = qsa('section h3', settingsMain).find(x => norm(x.textContent) === 'Installed apps');
  const section = heading?.closest('section');
  if (!section) return;

  if (!qs('[data-ghte-booking-setting]', section)) {
    const row = document.createElement('label');
    row.dataset.ghteBookingSetting = '1';
    row.innerHTML = `<span><b><i class="fa-brands fa-airbnb"></i> Airbnb</b><small>Default life-simulator booking app</small></span><input type="checkbox" checked disabled>`;
    section.appendChild(row);
  }

  if (!qs('[data-ghte-events-setting]', section)) {
    const row = document.createElement('label');
    row.dataset.ghteEventsSetting = '1';
    row.innerHTML = `<span><b><i class="fa-solid fa-ticket"></i> Eventbrite</b><small>Install manually on this phone</small></span><input type="checkbox" data-ghte-events-toggle ${isEventsInstalled() ? 'checked' : ''}>`;
    row.querySelector('[data-ghte-events-toggle]')?.addEventListener('change', handleChange);
    section.appendChild(row);
  }
}

function ensureLayer() {
  const content = qs('#ghp-overlay:not([hidden]) .ghp-content');
  if (!content) return null;

  let layer = qs('#ghte-layer', content);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'ghte-layer';
    layer.addEventListener('click', handleClick);
    layer.addEventListener('submit', handleSubmit);
    layer.addEventListener('change', handleChange);
    content.appendChild(layer);
  }

  return layer;
}

function openApp(name) {
  if (name === 'events' && !isEventsInstalled()) {
    globalThis.toastr?.info?.('Install Eventbrite from Greyhaven Phone Settings first.');
    return;
  }

  appOpen = name;
  view = {
    tab: name === 'booking' ? 'stays' : 'discover',
    detailId: '',
    detailKind: '',
    transportMode: 'flight',
    transportResults: [],
  };
  render();
}

function closeApp() {
  appOpen = '';
  view = { tab: '', detailId: '', detailKind: '' };
  qs('#ghte-layer')?.remove();
}

function back() {
  if (view.detailId) {
    view.detailId = '';
    view.detailKind = '';
    return render();
  }
  closeApp();
}

function appHeader(title, subtitle = '', brand = '') {
  return `<header class="ghte-header ${brand}">
    <button type="button" data-ghte-back><i class="fa-solid fa-chevron-left"></i></button>
    <div><b>${esc(title)}</b>${subtitle ? `<small>${esc(subtitle)}</small>` : ''}</div>
    <span></span>
  </header>`;
}

function tabs(items, active) {
  return `<nav class="ghte-tabs">${items.map(([key, label]) =>
    `<button type="button" data-ghte-tab="${esc(key)}" class="${key === active ? 'active' : ''}">${esc(label)}</button>`
  ).join('')}</nav>`;
}

function avatar(ref, size = '') {
  const src = participantAvatar(ref);
  const name = participantName(ref);

  if (src) return `<img class="ghte-avatar ${size}" src="${esc(src)}" alt="${esc(name)}">`;
  return `<span class="ghte-avatar ${size} fallback">${esc(name.slice(0, 1).toUpperCase())}</span>`;
}

function participantStack(list = [], max = 5) {
  const shown = list.slice(0, max);
  const more = list.length - shown.length;
  return `<div class="ghte-avatar-stack">${shown.map(x => avatar(x, 'small')).join('')}${more > 0 ? `<span class="ghte-more">+${more}</span>` : ''}</div>`;
}

function empty(icon, title, text) {
  return `<div class="ghte-empty"><i class="${icon}"></i><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
}

function stayIcon(type) {
  return type === 'hotel' ? 'fa-solid fa-hotel' : type === 'villa' ? 'fa-solid fa-house-chimney-window' : 'fa-solid fa-building';
}

function staySearchResults() {
  const s = state();
  const search = s.search.stays;
  const ids = Array.isArray(search.lastResultIds) ? search.lastResultIds : [];
  const rows = ids.map(idValue => s.accommodations[idValue]).filter(Boolean);

  if (rows.length) return rows.filter(a =>
    !reservationConflicts(a.id, search.checkIn, search.checkOut)
  );

  return availableAccommodations(search).slice(0, 7);
}


function favoriteButton(accommodationId, compact = false) {
  const saved = isAccommodationFavorite(accommodationId);
  return `<button type="button" class="ghte-favorite ${saved ? 'saved' : ''} ${compact ? 'compact' : ''}" data-ghte-favorite-stay="${esc(accommodationId)}" aria-label="${saved ? 'Remove from saved' : 'Save stay'}"><i class="${saved ? 'fa-solid' : 'fa-regular'} fa-heart"></i></button>`;
}

function renderAccommodationDetail(stay) {
  const s = state();
  const search = s.search.stays;
  const total = reservationTotal(stay, search.checkIn, search.checkOut, Number(search.guests || 1));
  const hostName = participantName(stay.host);

  return `<main class="ghte-main airbnb">
    <article class="ghte-stay-detail">
      <div class="ghte-stay-detail-hero ${esc(stay.type)}">
        <i class="${stayIcon(stay.type)}"></i>
        ${favoriteButton(stay.id)}
      </div>
      <div class="ghte-detail-kicker">${esc(stay.area || stay.city)} · ${esc(stay.type)}${stay.source === 'life-property' ? ' · Greyhaven property' : ''}</div>
      <h2>${esc(stay.name)}</h2>
      <div class="ghte-rating-row"><span>${'★'.repeat(Math.max(1, Math.round(stay.quality)))}</span><small>${stay.maxGuests} guests${stay.bedrooms ? ` · ${stay.bedrooms} bedrooms` : ''}${stay.bathrooms ? ` · ${stay.bathrooms} bathrooms` : ''}</small></div>
      ${stay.address ? `<div class="ghte-detail-fact"><i class="fa-solid fa-location-dot"></i><span>${esc(stay.address)}</span></div>` : ''}
      <div class="ghte-detail-fact"><i class="fa-solid fa-user"></i><span>Hosted by ${esc(hostName)}</span></div>
      <p>${esc(stay.description || 'Short-stay accommodation.')}</p>
      <section class="ghte-price-box"><b>${money(stay.nightlyPrice)} / night</b><span>${money(total)} for ${nightsBetween(search.checkIn, search.checkOut)} night(s) with current search dates</span></section>
      <div class="ghte-detail-actions">
        <button type="button" class="ghte-primary airbnb" data-ghte-book-private="${esc(stay.id)}">Reserve</button>
        ${stay.maxGuests >= 2 ? `<button type="button" data-ghte-book-shared="${esc(stay.id)}">Create shared stay</button>` : ''}
        <button type="button" data-ghte-open-host-chat="${esc(stay.id)}"><i class="fa-regular fa-message"></i> Message host</button>
      </div>
    </article>
  </main>`;
}

function sharedParticipantRows(reservation) {
  const creator = bookingCreatedByCurrent(reservation);
  return (reservation.participants || []).map(ref => {
    const name = participantName(ref);
    const identityId = ref.kind === 'identity' ? ref.identityId : '';
    const canRemove = creator && reservation.mode === 'shared' && identityId && identityId !== reservation.bookedByIdentityId;
    return `<div class="ghte-participant-row">
      <span class="ghte-person">${avatar(ref, 'small')}<b>${esc(name)}</b>${identityId === reservation.bookedByIdentityId ? '<small>Creator</small>' : ''}</span>
      ${canRemove ? `<button type="button" data-ghte-remove-participant="${esc(identityId)}" data-reservation-id="${esc(reservation.id)}"><i class="fa-solid fa-user-minus"></i></button>` : ''}
    </div>`;
  }).join('');
}

function renderReservationDetail(reservation) {
  const s = state();
  const stay = s.accommodations[reservation.accommodationId];
  if (!stay) return empty('fa-solid fa-triangle-exclamation', 'Stay missing', 'The accommodation record is unavailable.');

  const creator = bookingCreatedByCurrent(reservation);
  const lifecycle = reservationLifecycle(reservation);
  const spots = Math.max(0, reservation.maxGuests - reservation.participants.length);
  const canDelete = ['cancelled', 'completed'].includes(lifecycle) && creator;

  return `<main class="ghte-main airbnb">
    <article class="ghte-booking-detail">
      <button type="button" class="ghte-booking-stay-link" data-ghte-stay-detail="${esc(stay.id)}">
        <span class="ghte-mini-stay-icon ${esc(stay.type)}"><i class="${stayIcon(stay.type)}"></i></span>
        <span><small>${esc(stay.city)} · ${esc(stay.type)}</small><b>${esc(stay.name)}</b></span>
        <i class="fa-solid fa-chevron-right"></i>
      </button>

      <div class="ghte-status-line ${esc(lifecycle)}"><i class="fa-solid fa-circle"></i><b>${esc(lifecycleLabel(lifecycle))}</b></div>

      <section class="ghte-booking-facts">
        <div><small>Check in</small><b>${esc(reservation.checkIn)} · 15:00</b></div>
        <div><small>Check out</small><b>${esc(reservation.checkOut)} · 11:00</b></div>
        <div><small>Booking</small><b>${esc(reservation.mode === 'shared' ? 'Shared stay' : 'Private stay')}</b></div>
        <div><small>Price</small><b>${reservation.mode === 'shared' ? `${money(reservation.perPerson)} each` : money(reservation.total)}</b></div>
      </section>

      <section class="ghte-booking-section">
        <div class="ghte-section-row"><b>Guests</b>${reservation.mode === 'shared' ? `<small>${spots} open spot${spots === 1 ? '' : 's'}</small>` : ''}</div>
        <div class="ghte-participants">${sharedParticipantRows(reservation)}</div>
      </section>

      ${reservation.mode === 'shared' && creator && reservation.status !== 'cancelled' ? `
        <section class="ghte-booking-section">
          <div class="ghte-section-row"><b>Shared booking controls</b><small>${reservation.locked ? 'Locked' : 'Open'}</small></div>
          <div class="ghte-shared-controls">
            <button type="button" data-ghte-toggle-lock="${esc(reservation.id)}"><i class="fa-solid ${reservation.locked ? 'fa-lock' : 'fa-lock-open'}"></i> ${reservation.locked ? 'Unlock booking' : 'Lock booking'}</button>
            <label class="ghte-autofill-toggle"><span><b>Auto-fill open spots</b><small>Only existing Greyhaven characters can join automatically. Local NPCs never auto-join your booking.</small></span><input type="checkbox" data-ghte-auto-fill="${esc(reservation.id)}" ${reservation.autoFill ? 'checked' : ''} ${reservation.locked ? 'disabled' : ''}></label>
            ${reservation.autoFill && !reservation.locked && spots > 0 ? `<button type="button" data-ghte-check-one-share="${esc(reservation.id)}"><i class="fa-solid fa-arrows-rotate"></i> Check for a new join</button>` : ''}
          </div>
        </section>` : ''}

      <section class="ghte-booking-section">
        <div class="ghte-section-row"><b>Host</b><small>${esc(participantName(stay.host))}</small></div>
        <div class="ghte-host-actions">
          <button type="button" class="ghte-wide-secondary" data-ghte-open-host-chat="${esc(stay.id)}"><i class="fa-regular fa-message"></i> Message host</button>
        </div>
      </section>

      <div class="ghte-danger-zone">
        ${reservation.mode === 'shared' && !bookingOwnedByCurrent(reservation) && reservation.status === 'shared-open' && !reservation.locked ? `<button type="button" class="ghte-join-detail" data-ghte-join-share="${esc(reservation.id)}">Join this shared booking</button>` : ''}
        ${reservation.mode === 'shared' && bookingOwnedByCurrent(reservation) && !creator && lifecycle !== 'cancelled' ? `<button type="button" data-ghte-leave-share="${esc(reservation.id)}">Leave shared booking</button>` : ''}
        ${creator && lifecycle !== 'cancelled' && lifecycle !== 'completed' ? `<button type="button" data-ghte-cancel-reservation="${esc(reservation.id)}">Cancel reservation</button>` : ''}
        ${canDelete ? `<button type="button" class="danger" data-ghte-delete-reservation="${esc(reservation.id)}">Delete booking record</button>` : ''}
      </div>
    </article>
  </main>`;
}

function renderTransportDetail(booking) {
  const lifecycle = booking.status === 'cancelled' ? 'Cancelled' : booking.arrivalAt <= rpNow().getTime() ? 'Completed' : 'Upcoming';
  const creator = booking.bookedByIdentityId === currentIdentity()?.id;
  const canDelete = creator && (booking.status === 'cancelled' || booking.arrivalAt <= rpNow().getTime());

  return `<main class="ghte-main airbnb">
    <article class="ghte-booking-detail">
      <div class="ghte-transport-detail-head">
        <span class="ghte-transport-icon"><i class="${booking.mode === 'flight' ? 'fa-solid fa-plane' : booking.mode === 'ferry' ? 'fa-solid fa-ship' : 'fa-solid fa-bus'}"></i></span>
        <div><small>${esc(booking.mode)}</small><h2>${esc(booking.operator)}</h2></div>
      </div>
      <div class="ghte-status-line"><i class="fa-solid fa-circle"></i><b>${lifecycle}</b></div>
      <section class="ghte-booking-facts">
        <div><small>From</small><b>${esc(booking.from)}</b></div>
        <div><small>To</small><b>${esc(booking.to)}</b></div>
        <div><small>Departure</small><b>${new Date(booking.departureAt).toLocaleString()}</b></div>
        <div><small>Arrival</small><b>${new Date(booking.arrivalAt).toLocaleString()}</b></div>
      </section>
      <section class="ghte-booking-section"><div class="ghte-section-row"><b>Travelers</b><small>${money(booking.total)}</small></div>${sharedParticipantRows({participants:booking.travelers,bookedByIdentityId:booking.bookedByIdentityId,id:booking.id})}</section>
      <div class="ghte-danger-zone">
        ${creator && booking.status !== 'cancelled' && booking.arrivalAt > rpNow().getTime() ? `<button type="button" data-ghte-cancel-transport="${esc(booking.id)}">Cancel tickets</button>` : ''}
        ${canDelete ? `<button type="button" class="danger" data-ghte-delete-transport="${esc(booking.id)}">Delete ticket record</button>` : ''}
      </div>
    </article>
  </main>`;
}

function renderSavedStays() {
  const rows = savedAccommodations();
  return `<main class="ghte-main airbnb">
    <div class="ghte-section-heading"><div><b>Saved stays</b><small>Favorites stay here even after you refresh search results.</small></div></div>
    ${rows.length ? rows.map(stay => `<article class="ghte-saved-row">
      <button type="button" data-ghte-stay-detail="${esc(stay.id)}">
        <span class="ghte-mini-stay-icon ${esc(stay.type)}"><i class="${stayIcon(stay.type)}"></i></span>
        <span><small>${esc(stay.city)} · ${esc(stay.type)}</small><b>${esc(stay.name)}</b><em>${money(stay.nightlyPrice)} / night</em></span>
      </button>
      ${favoriteButton(stay.id, true)}
    </article>`).join('') : empty('fa-regular fa-heart', 'Nothing saved yet', 'Tap the heart on a stay you want to keep.')}
  </main>`;
}

function renderStays() {
  const s = state();
  const search = s.search.stays;
  const results = staySearchResults();

  return `<main class="ghte-main airbnb">
    <form class="ghte-search-card" data-ghte-stay-search>
      <div class="ghte-search-brand"><i class="fa-brands fa-airbnb"></i><span><b>Find a stay</b><small>Hotels, apartments & villas</small></span></div>
      <label>Where<input name="city" value="${esc(search.city)}" placeholder="City" required></label>
      <label>Area<input name="area" value="${esc(search.area || '')}" placeholder="Any neighborhood"></label>
      <div class="ghte-form-grid two">
        <label>Check in<input name="checkIn" type="date" value="${esc(search.checkIn)}" required></label>
        <label>Check out<input name="checkOut" type="date" value="${esc(search.checkOut)}" required></label>
      </div>
      <div class="ghte-form-grid two">
        <label>Guests<input name="guests" type="number" min="1" max="14" value="${esc(search.guests)}"></label>
        <label>Type<select name="type">
          <option value="all"${search.type === 'all' ? ' selected' : ''}>All stays</option>
          <option value="hotel"${search.type === 'hotel' ? ' selected' : ''}>Hotel</option>
          <option value="apartment"${search.type === 'apartment' ? ' selected' : ''}>Apartment</option>
          <option value="villa"${search.type === 'villa' ? ' selected' : ''}>Villa</option>
        </select></label>
      </div>
      <button class="ghte-primary airbnb" type="submit"><i class="fa-solid fa-magnifying-glass"></i>${stayRefreshBusy ? ' Searching…' : ' Search'}</button>
    </form>

    <div class="ghte-section-heading">
      <div><b>Top choices</b><small>Refresh gives a small rotating set; Search uses your exact filters.</small></div>
      <button type="button" data-ghte-refresh-stays>${stayRefreshBusy ? 'Refreshing…' : '<i class="fa-solid fa-arrows-rotate"></i> Refresh'}</button>
    </div>

    ${results.length ? results.map(stay => {
      const total = reservationTotal(stay, search.checkIn, search.checkOut, Number(search.guests || 1));
      return `<article class="ghte-stay-card">
        <button type="button" class="ghte-stay-open" data-ghte-stay-detail="${esc(stay.id)}">
          <div class="ghte-stay-photo ${esc(stay.type)}"><i class="${stayIcon(stay.type)}"></i><span>${stay.source === 'life-property' ? 'Greyhaven property' : `${stay.quality}★`}</span></div>
          <div class="ghte-stay-info">
            <small>${esc(stay.area || stay.city)} · ${esc(stay.type)}</small>
            <b>${esc(stay.name)}</b>
            <p>${esc(stay.description || '')}</p>
            <span>${stay.maxGuests} guests${stay.bedrooms ? ` · ${stay.bedrooms} bedrooms` : ''}</span>
            <strong>${money(stay.nightlyPrice)} night · ${money(total)} total</strong>
          </div>
        </button>
        <div class="ghte-card-actions">
          ${favoriteButton(stay.id, true)}
          <button type="button" data-ghte-book-private="${esc(stay.id)}">Reserve</button>
          ${stay.maxGuests >= 2 ? `<button type="button" data-ghte-book-shared="${esc(stay.id)}" class="outline">Share</button>` : ''}
        </div>
      </article>`;
    }).join('') : empty('fa-brands fa-airbnb', 'No stays yet', 'Search a city to generate a few realistic short-stay options.')}
  </main>`;
}

function renderShared() {
  const s = state();
  const search = s.search.stays;
  const rows = openSharedReservations(search);

  return `<main class="ghte-main airbnb">
    <section class="ghte-shared-intro">
      <i class="fa-solid fa-people-group"></i>
      <div><b>Shared stays</b><span>Open bookings from Greyhaven characters and destination locals.</span></div>
      <button type="button" data-ghte-refresh-shared>${sharedRefreshBusy ? 'Checking…' : 'Refresh community'}</button>
    </section>

    <p class="ghte-explainer">Manual cross-phone joining still works exactly as before. Local NPCs can host their own shared stays, but they never auto-join a booking you created.</p>

    ${rows.length ? rows.map(r => {
      const stay = s.accommodations[r.accommodationId];
      if (!stay) return '';
      const slots = Math.max(0, r.maxGuests - r.participants.length);
      return `<article class="ghte-share-card">
        <button type="button" class="ghte-share-open" data-ghte-reservation-detail="${esc(r.id)}">
          <div class="ghte-share-top">
            <div><small>${esc(stay.city)} · ${esc(stay.type)}</small><b>${esc(stay.name)}</b></div>
            <strong>${slots} open</strong>
          </div>
          <div class="ghte-share-people">${participantStack(r.participants)}<span>${r.participants.map(participantName).join(', ')}</span></div>
          <small>${esc(r.checkIn)} → ${esc(r.checkOut)} · ${money(r.perPerson)} each right now</small>
        </button>
        <button type="button" data-ghte-join-share="${esc(r.id)}" class="ghte-primary airbnb">Join this booking</button>
      </article>`;
    }).join('') : empty('fa-solid fa-people-arrows', 'No open shared stays', 'Create one from a stay, switch phones, or deliberately refresh the community pool.')}
  </main>`;
}

function renderTransport() {
  const results = Array.isArray(view.transportResults) ? view.transportResults : [];
  const mode = view.transportMode || 'flight';

  return `<main class="ghte-main airbnb">
    <form class="ghte-transport-search" data-ghte-transport-search>
      <div class="ghte-mode-segment">
        ${[['flight','Plane'], ['ferry','Ferry'], ['bus','Bus']].map(([key,label]) => `<button type="button" data-ghte-transport-mode="${key}" class="${mode === key ? 'active' : ''}">${label}</button>`).join('')}
      </div>
      <label>From<input name="from" placeholder="Greyhaven" value="${esc(view.transportFrom || 'Greyhaven')}" required></label>
      <label>To<input name="to" placeholder="Destination" value="${esc(view.transportTo || '')}" required></label>
      <label>Travel date<input name="when" type="date" value="${esc(view.transportWhen || dateInput(plusDays(rpNow(), 3)))}" required></label>
      <button type="submit" class="ghte-primary airbnb">Find ${esc(mode)} options</button>
    </form>

    <p class="ghte-explainer">${mode === 'flight' ? 'Flights are schedule choices, not AI marketplace listings. Route/date determine the options; only realistic price variation is simulated.' : 'Choose a route and date. These are travel schedules, not marketplace listings.'}</p>

    ${results.length ? results.map((choice, index) => `<article class="ghte-transport-card">
      <div class="ghte-transport-icon"><i class="${choice.mode === 'flight' ? 'fa-solid fa-plane' : choice.mode === 'ferry' ? 'fa-solid fa-ship' : 'fa-solid fa-bus'}"></i></div>
      <div><b>${esc(choice.operator)}</b><span>${new Date(choice.departureAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} → ${new Date(choice.arrivalAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span><small>${esc(choice.from)} → ${esc(choice.to)}</small></div>
      <strong>${money(choice.price)}</strong>
      <button type="button" data-ghte-book-transport="${index}">Book</button>
    </article>`).join('') : ''}
  </main>`;
}

function renderTrips() {
  const s = state();
  const me = currentIdentity();

  const allStays = Object.values(s.reservations)
    .filter(r => participantExists(r.participants, me?.id))
    .sort((a, b) => b.createdAt - a.createdAt);

  const activeStays = allStays.filter(r => !['cancelled', 'completed'].includes(reservationLifecycle(r)));
  const historyStays = allStays.filter(r => ['cancelled', 'completed'].includes(reservationLifecycle(r)));

  const allTransport = Object.values(s.transportBookings)
    .filter(r => participantExists(r.travelers, me?.id))
    .sort((a, b) => b.createdAt - a.createdAt);

  const activeTransport = allTransport.filter(r => r.status !== 'cancelled' && r.arrivalAt > rpNow().getTime());
  const historyTransport = allTransport.filter(r => r.status === 'cancelled' || r.arrivalAt <= rpNow().getTime());
  const itineraries = itineraryBundlesForCurrent();
  const ownsAutofill = activeStays.some(r => bookingCreatedByCurrent(r) && r.mode === 'shared' && r.autoFill && !r.locked && r.status !== 'cancelled');

  const stayCard = r => {
    const stay = s.accommodations[r.accommodationId];
    const lifecycle = reservationLifecycle(r);
    return `<button type="button" class="ghte-trip-card clickable" data-ghte-reservation-detail="${esc(r.id)}">
      <div><b>${esc(stay?.name || 'Stay')}</b><small>${esc(r.checkIn)} → ${esc(r.checkOut)} · ${esc(r.mode)} · ${esc(lifecycleLabel(lifecycle))}</small></div>
      ${participantStack(r.participants)}
      <strong>${r.mode === 'shared' ? `${money(r.perPerson)} each` : money(r.total)}</strong>
      <i class="fa-solid fa-chevron-right"></i>
    </button>`;
  };

  const transportCard = r => `<button type="button" class="ghte-trip-card clickable" data-ghte-transport-detail="${esc(r.id)}">
    <div><b>${esc(r.operator)} · ${esc(r.mode)}</b><small>${esc(r.from)} → ${esc(r.to)} · ${new Date(r.departureAt).toLocaleString()}</small></div>
    ${participantStack(r.travelers)}
    <strong>${money(r.total)}</strong>
    <i class="fa-solid fa-chevron-right"></i>
  </button>`;

  return `<main class="ghte-main airbnb">
    ${ownsAutofill ? `<button type="button" class="ghte-check-activity" data-ghte-check-shared-activity><i class="fa-solid fa-arrows-rotate"></i> Check shared activity</button>` : ''}

    ${itineraries.length ? `<h3 class="ghte-title">Trip plans</h3>${itineraries.map(bundle => `<button type="button" class="ghte-itinerary-card" data-ghte-reservation-detail="${esc(bundle.reservation.id)}">
      <span class="ghte-itinerary-icon"><i class="fa-solid fa-route"></i></span>
      <span><small>${esc(bundle.reservation.checkIn)} → ${esc(bundle.reservation.checkOut)}</small><b>${esc(bundle.stay?.city || bundle.stay?.name || 'Trip')}</b><em>${esc(bundle.stay?.name || '')}${bundle.tickets.length ? ` · ${bundle.tickets.length} linked ticket${bundle.tickets.length === 1 ? '' : 's'}` : ''}</em></span>
      <i class="fa-solid fa-chevron-right"></i>
    </button>`).join('')}` : ''}

    <h3 class="ghte-title">Stays</h3>
    ${activeStays.length ? activeStays.map(stayCard).join('') : '<small class="ghte-muted">No active stays.</small>'}

    <h3 class="ghte-title">Travel tickets</h3>
    ${activeTransport.length ? activeTransport.map(transportCard).join('') : '<small class="ghte-muted">No active transport.</small>'}

    ${(historyStays.length || historyTransport.length) ? `<details class="ghte-history">
      <summary>Past & cancelled</summary>
      <div>${historyStays.map(stayCard).join('')}${historyTransport.map(transportCard).join('')}</div>
    </details>` : ''}
  </main>`;
}

function renderBooking() {
  if (view.detailId) {
    if (view.detailKind === 'host-chat') {
      const stay = state().accommodations[view.detailId];
      return `<div class="ghte-screen">${appHeader('Airbnb', stay ? participantName(stay.host) : 'Host chat', 'airbnb')}${stay ? renderHostChat(stay) : empty('fa-regular fa-message', 'Chat unavailable', 'This stay no longer exists.')}</div>`;
    }
    if (view.detailKind === 'stay') {
      const stay = state().accommodations[view.detailId];
      return `<div class="ghte-screen">${appHeader('Airbnb', 'Stay details', 'airbnb')}${stay ? renderAccommodationDetail(stay) : empty('fa-solid fa-house', 'Stay unavailable', 'This accommodation no longer exists.')}</div>`;
    }
    if (view.detailKind === 'reservation') {
      const reservation = state().reservations[view.detailId];
      return `<div class="ghte-screen">${appHeader('Airbnb', 'Trip details', 'airbnb')}${reservation ? renderReservationDetail(reservation) : empty('fa-solid fa-suitcase', 'Booking unavailable', 'This reservation no longer exists.')}</div>`;
    }
    if (view.detailKind === 'transport') {
      const booking = state().transportBookings[view.detailId];
      return `<div class="ghte-screen">${appHeader('Airbnb', 'Ticket details', 'airbnb')}${booking ? renderTransportDetail(booking) : empty('fa-solid fa-ticket', 'Ticket unavailable', 'This booking no longer exists.')}</div>`;
    }
  }

  const tab = view.tab || 'stays';
  let body = '';
  if (tab === 'shared') body = renderShared();
  else if (tab === 'transport') body = renderTransport();
  else if (tab === 'trips') body = renderTrips();
  else if (tab === 'chats') body = renderHostChatList();
  else if (tab === 'saved') body = renderSavedStays();
  else body = renderStays();

  return `<div class="ghte-screen">
    ${appHeader('Airbnb', 'Greyhaven Booking', 'airbnb')}
    ${tabs([['stays','Stays'], ['shared','Shared'], ['transport','Travel'], ['trips','Trips'], ['chats','Chats'], ['saved','Saved']], tab)}
    ${body}
  </div>`;
}


function categoryLabel(category) {
  return {
    party: 'Party',
    'house-party': 'House party',
    concert: 'Concert',
    festival: 'Festival',
    cultural: 'Culture',
    food: 'Food',
    sports: 'Sports',
    community: 'Community',
    business: 'Business',
    'beach-party': 'Beach party',
    other: 'Other',
  }[category] || 'Event';
}

function renderEventDetail(event) {
  const owner = currentIdentity()?.id === event.ownerIdentityId;
  const viewers = (event.viewers || []).map(v => refForIdentity(identityById(v.identityId)) || { kind: 'npc', name: v.name }).filter(Boolean);

  return `<main class="ghte-main events">
    <article class="ghte-event-detail">
      <div class="ghte-event-hero ${esc(event.category)}"><i class="fa-solid fa-ticket"></i></div>
      <small>${esc(categoryLabel(event.category))} · ${esc(event.city)}</small>
      <h2>${esc(event.title)}</h2>
      <div class="ghte-event-fact"><i class="fa-regular fa-calendar"></i><span>${new Date(event.startAt).toLocaleString()}</span></div>
      <div class="ghte-event-fact"><i class="fa-solid fa-location-dot"></i><span>${esc(event.venue)}${event.area ? ` · ${esc(event.area)}` : ''}</span></div>
      <div class="ghte-event-fact"><i class="fa-solid fa-user"></i><span>${esc(participantName(event.organizer))}</span></div>
      <div class="ghte-event-fact"><i class="fa-solid fa-ticket"></i><span>${event.price ? money(event.price) : 'Free'}</span></div>
      <p>${esc(event.description)}</p>
      ${owner ? `<section class="ghte-viewers"><b>Viewed your event</b>${viewers.length ? `<div>${participantStack(viewers, 8)}<span>${viewers.map(participantName).join(', ')}</span></div>` : '<small>No tracked viewers yet. They appear when another Greyhaven phone discovers and opens this event.</small>'}</section>` : ''}
      <p class="ghte-explainer">Viewing this page does not automatically give other characters knowledge of this event. Tell them in RP if you want them to know.</p>
    </article>
  </main>`;
}

function renderEventsDiscover() {
  const s = state();
  const search = s.search.events;
  const ids = search.lastResultIds || [];
  const rows = ids.map(idValue => s.events[idValue]).filter(Boolean);

  return `<main class="ghte-main events">
    <form class="ghte-event-search" data-ghte-event-search>
      <label>Location<input name="city" value="${esc(search.city)}" placeholder="Greyhaven"></label>
      <label>Type<select name="category">
        ${['all','party','house-party','concert','festival','cultural','food','sports','community','business','beach-party','other'].map(x => `<option value="${x}"${search.category === x ? ' selected' : ''}>${x === 'all' ? 'All events' : categoryLabel(x)}</option>`).join('')}
      </select></label>
      <button type="submit" class="ghte-primary eventbrite"><i class="fa-solid fa-magnifying-glass"></i>${eventRefreshBusy ? ' Refreshing…' : ' Discover events'}</button>
    </form>

    ${rows.length ? rows.map(event => `<button type="button" class="ghte-event-card" data-ghte-event="${esc(event.id)}">
      <div class="ghte-event-date"><b>${new Date(event.startAt).getDate()}</b><span>${new Date(event.startAt).toLocaleDateString([], {month:'short'}).toUpperCase()}</span></div>
      <div><small>${esc(categoryLabel(event.category))} · ${esc(event.area || event.city)}</small><b>${esc(event.title)}</b><span>${esc(event.venue)} · ${event.price ? money(event.price) : 'Free'}</span></div>
      <i class="fa-solid fa-chevron-right"></i>
    </button>`).join('') : empty('fa-solid fa-ticket', 'Nothing loaded yet', 'Discover what is happening in Greyhaven or search another location.')}
  </main>`;
}

function renderMyEvents() {
  const s = state();
  const me = currentIdentity();
  const rows = Object.values(s.events)
    .filter(x => x.ownerIdentityId === me?.id)
    .sort((a, b) => b.createdAt - a.createdAt);

  return `<main class="ghte-main events">
    <button type="button" class="ghte-create-event" data-ghte-create-event><i class="fa-solid fa-plus"></i> Create an event</button>
    ${rows.length ? rows.map(event => `<button type="button" class="ghte-event-card" data-ghte-event="${esc(event.id)}">
      <div class="ghte-event-date"><b>${new Date(event.startAt).getDate()}</b><span>${new Date(event.startAt).toLocaleDateString([], {month:'short'}).toUpperCase()}</span></div>
      <div><small>${esc(categoryLabel(event.category))}</small><b>${esc(event.title)}</b><span>${event.viewers?.length || 0} tracked viewers</span></div>
      <i class="fa-solid fa-chevron-right"></i>
    </button>`).join('') : empty('fa-solid fa-calendar-plus', 'No events created', 'Post a house party, business event or other gathering.')}
  </main>`;
}

function renderEvents() {
  if (view.detailId) {
    const event = state().events[view.detailId];
    if (!event) {
      view.detailId = '';
      return renderEvents();
    }

    return `<div class="ghte-screen">
      ${appHeader('Eventbrite', 'Event details', 'eventbrite')}
      ${renderEventDetail(event)}
    </div>`;
  }

  const tab = view.tab || 'discover';
  return `<div class="ghte-screen">
    ${appHeader('Eventbrite', 'Events around you', 'eventbrite')}
    ${tabs([['discover','Discover'], ['mine','My events']], tab)}
    ${tab === 'mine' ? renderMyEvents() : renderEventsDiscover()}
  </div>`;
}

function render() {
  if (!appOpen) return;
  const layer = ensureLayer();
  if (!layer) return;
  layer.innerHTML = appOpen === 'events' ? renderEvents() : renderBooking();
}

/* ---------------- dialogs ---------------- */

function openDialog(html) {
  const dialog = document.createElement('dialog');
  dialog.className = 'ghte-dialog';
  dialog.innerHTML = html;

  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    dialog.close();
  });

  dialog.addEventListener('click', event => {
    if (event.target.closest?.('[data-ghte-dialog-close]')) {
      event.preventDefault();
      dialog.close();
      return;
    }

    if (event.target === dialog) {
      const panel = dialog.firstElementChild;
      const rect = panel?.getBoundingClientRect?.();
      if (!rect || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        dialog.close();
      }
    }
  });

  dialog.addEventListener('submit', handleDialogSubmit);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);

  try { dialog.showModal(); }
  catch { dialog.setAttribute('open', ''); }

  return dialog;
}

function identityCheckboxes(excludeCurrent = true) {
  const me = currentIdentity();
  return identities()
    .filter(x => !excludeCurrent || x.id !== me?.id)
    .map(x => `<label class="ghte-person-choice">
      <input type="checkbox" name="identityId" value="${esc(x.id)}">
      ${avatar(refForIdentity(x), 'small')}
      <span>${esc(x.name)}</span>
    </label>`)
    .join('');
}


function reservationDialog(accommodationId, shared = false) {
  const s = state();
  const stay = s.accommodations[accommodationId];
  const search = s.search.stays;
  if (!stay) return;

  openDialog(`<form method="dialog" data-ghte-reservation-form data-id="${esc(stay.id)}" data-mode="${shared ? 'shared' : 'private'}">
    <header><b>${shared ? 'Create shared stay' : 'Reserve stay'}</b><button type="button" data-ghte-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <p><b>${esc(stay.name)}</b><br><small>${esc(stay.city)} · ${money(stay.nightlyPrice)}/night · up to ${stay.maxGuests} guests</small></p>
    <div class="ghte-form-grid two">
      <label>Check in<input name="checkIn" type="date" value="${esc(search.checkIn)}" required></label>
      <label>Check out<input name="checkOut" type="date" value="${esc(search.checkOut)}" required></label>
    </div>
    ${shared
      ? `<label>How many total spots should this shared booking have?<input name="maxGuests" type="number" min="2" max="${stay.maxGuests}" value="${Math.min(stay.maxGuests, 4)}"></label>
         <p class="ghte-dialog-note">Only you are added now. Empty spots stay visible to other phones until somebody explicitly joins.</p>`
      : `<fieldset><legend>Travel with known characters (optional)</legend>${identityCheckboxes(true)}</fieldset>`}
    <button class="ghte-primary airbnb" type="submit">${shared ? 'Book & leave open spots' : 'Confirm reservation'}</button>
  </form>`);
}

function transportBookingDialog(index) {
  const choice = view.transportResults?.[index];
  if (!choice) return;

  openDialog(`<form method="dialog" data-ghte-transport-book-form data-index="${index}">
    <header><b>Book ${esc(choice.mode)}</b><button type="button" data-ghte-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <p><b>${esc(choice.operator)}</b><br><small>${esc(choice.from)} → ${esc(choice.to)} · ${money(choice.price)} per traveler</small></p>
    <fieldset><legend>Travel together (optional)</legend>${identityCheckboxes(true)}</fieldset>
    <button class="ghte-primary airbnb" type="submit">Buy tickets</button>
  </form>`);
}

function createEventDialog() {
  const venues = ownEventVenueOptions();
  const defaultStart = plusDays(rpNow(), 2);
  defaultStart.setHours(20, 0, 0, 0);

  openDialog(`<form method="dialog" data-ghte-create-event-form>
    <header><b>Create Eventbrite event</b><button type="button" data-ghte-dialog-close><i class="fa-solid fa-xmark"></i></button></header>
    <label>Title<input name="title" required placeholder="Friday House Party"></label>
    <label>Type<select name="category">
      ${['house-party','party','business','community','food','sports','cultural','beach-party','other'].map(x => `<option value="${x}">${esc(categoryLabel(x))}</option>`).join('')}
    </select></label>
    <label>Use a property you own<select name="propertyId">
      <option value="">Custom venue</option>
      ${venues.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.city)}</option>`).join('')}
    </select></label>
    <label>Custom venue<input name="venue" placeholder="Used only when no owned property is selected"></label>
    <div class="ghte-form-grid two">
      <label>City<input name="city" value="Greyhaven"></label>
      <label>Area<input name="area"></label>
    </div>
    <label>Starts<input name="startAt" type="datetime-local" value="${dateTimeInput(defaultStart)}" required></label>
    <div class="ghte-form-grid two">
      <label>Duration hours<input name="durationHours" type="number" min="1" max="18" value="5"></label>
      <label>Entry price €<input name="price" type="number" min="0" value="0"></label>
    </div>
    <label>Capacity<input name="capacity" type="number" min="0" value="30"></label>
    <label>Description<textarea name="description" required placeholder="What is happening, dress note, music, anything guests should know."></textarea></label>
    <button type="submit" class="ghte-primary eventbrite">Publish event</button>
  </form>`);
}

/* ---------------- actions ---------------- */

function handleClick(event) {
  if (event.target.closest?.('[data-ghte-back]')) {
    event.preventDefault();
    return back();
  }

  const button = event.target.closest?.('button');
  if (!button) return;

  if (button.dataset.ghteTab) {
    view.tab = button.dataset.ghteTab;
    view.detailId = '';
    return render();
  }

  if (button.matches('[data-ghte-refresh-stays]')) return refreshStays();

  if (button.dataset.ghteStayDetail) {
    view.detailId = button.dataset.ghteStayDetail;
    view.detailKind = 'stay';
    return render();
  }

  if (button.dataset.ghteReservationDetail) {
    view.detailId = button.dataset.ghteReservationDetail;
    view.detailKind = 'reservation';
    return render();
  }

  if (button.dataset.ghteTransportDetail) {
    view.detailId = button.dataset.ghteTransportDetail;
    view.detailKind = 'transport';
    return render();
  }

  if (button.dataset.ghteFavoriteStay) {
    toggleAccommodationFavorite(button.dataset.ghteFavoriteStay);
    return render();
  }

  if (button.dataset.ghteMessageHost) return openHostChat(button.dataset.ghteMessageHost);
  if (button.dataset.ghteOpenHostChat) return openHostChat(button.dataset.ghteOpenHostChat);
  if (button.dataset.ghteHostThread) return openHostChat(button.dataset.ghteHostThread);

  if (button.dataset.ghteBookPrivate) return reservationDialog(button.dataset.ghteBookPrivate, false);
  if (button.dataset.ghteBookShared) return reservationDialog(button.dataset.ghteBookShared, true);

  if (button.dataset.ghteJoinShare) {
    try {
      const reservation = joinSharedReservation(button.dataset.ghteJoinShare);
      globalThis.toastr?.success?.(`Joined shared stay. Current split: ${money(reservation.perPerson)} each.`);
      view.tab = 'trips';
      render();
    } catch (error) {
      globalThis.toastr?.error?.(error.message);
    }
    return;
  }

  if (button.dataset.ghteLeaveShare) {
    if (confirm('Leave this shared booking?')) {
      leaveSharedReservation(button.dataset.ghteLeaveShare);
      render();
    }
    return;
  }

  if (button.dataset.ghteToggleLock) {
    try {
      const reservation = state().reservations[button.dataset.ghteToggleLock];
      lockSharedReservation(reservation.id, !reservation.locked);
      render();
    } catch (error) {
      globalThis.toastr?.error?.(error.message);
    }
    return;
  }

  if (button.dataset.ghteCheckOneShare) {
    try {
      const added = processAutoFillReservation(button.dataset.ghteCheckOneShare, { forceOne: true });
      globalThis.toastr?.info?.(added ? 'A Greyhaven character joined the shared stay.' : 'No new join this time.');
      render();
    } catch (error) {
      globalThis.toastr?.error?.(error.message);
    }
    return;
  }

  if (button.matches('[data-ghte-check-shared-activity]')) {
    const added = checkOwnedSharedActivity();
    globalThis.toastr?.info?.(added ? `${added} new shared-stay join${added === 1 ? '' : 's'}.` : 'No new shared-stay joins this time.');
    return render();
  }

  if (button.dataset.ghteRemoveParticipant) {
    if (!confirm('Remove this person from the shared booking?')) return;
    try {
      removeSharedParticipant(button.dataset.reservationId, button.dataset.ghteRemoveParticipant);
      render();
    } catch (error) {
      globalThis.toastr?.error?.(error.message);
    }
    return;
  }

  if (button.dataset.ghteCancelReservation) {
    if (!confirm('Cancel this entire reservation for everyone in it?')) return;
    try {
      cancelReservation(button.dataset.ghteCancelReservation);
      globalThis.toastr?.success?.('Reservation cancelled.');
      render();
    } catch (error) {
      globalThis.toastr?.error?.(error.message);
    }
    return;
  }

  if (button.dataset.ghteDeleteReservation) {
    if (!confirm('Permanently delete this cancelled/completed booking record?')) return;
    try {
      deleteReservationRecord(button.dataset.ghteDeleteReservation);
      view.detailId = '';
      view.detailKind = '';
      view.tab = 'trips';
      render();
    } catch (error) {
      globalThis.toastr?.error?.(error.message);
    }
    return;
  }

  if (button.dataset.ghteCancelTransport) {
    if (!confirm('Cancel these travel tickets?')) return;
    try {
      cancelTransportBooking(button.dataset.ghteCancelTransport);
      globalThis.toastr?.success?.('Tickets cancelled.');
      render();
    } catch (error) {
      globalThis.toastr?.error?.(error.message);
    }
    return;
  }

  if (button.dataset.ghteDeleteTransport) {
    if (!confirm('Permanently delete this cancelled/completed ticket record?')) return;
    try {
      deleteTransportBooking(button.dataset.ghteDeleteTransport);
      view.detailId = '';
      view.detailKind = '';
      view.tab = 'trips';
      render();
    } catch (error) {
      globalThis.toastr?.error?.(error.message);
    }
    return;
  }

  if (button.matches('[data-ghte-refresh-shared]')) return refreshShared();

  if (button.dataset.ghteTransportMode) {
    view.transportMode = button.dataset.ghteTransportMode;
    view.transportResults = [];
    return render();
  }

  if (button.dataset.ghteBookTransport !== undefined) {
    return transportBookingDialog(Number(button.dataset.ghteBookTransport));
  }

  if (button.dataset.ghteEvent) {
    markEventViewed(button.dataset.ghteEvent);
    view.detailId = button.dataset.ghteEvent;
    return render();
  }

  if (button.matches('[data-ghte-create-event]')) return createEventDialog();
}

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  const fd = new FormData(form);

  try {
    if (form.matches('[data-ghte-host-chat-form]')) {
      const stay = state().accommodations[form.dataset.id];
      const me = currentIdentity();
      if (!stay || !me) throw new Error('Host chat is unavailable.');

      const text = String(fd.get('text') || '').trim();
      if (!text) return;

      const thread = ensureHostThread(stay);
      if (!thread || hostReplyBusy === thread.id) return;

      thread.messages.push({
        id: uid('host-message'),
        senderType: 'guest',
        senderName: me.name,
        text,
        timeMs: rpNow().getTime(),
      });
      thread.updatedAt = Date.now();
      saveSettings();

      hostReplyBusy = thread.id;
      render();

      try {
        const reply = await generateHostChatReply(stay, thread, text);
        if (reply) {
          thread.messages.push({
            id: uid('host-message'),
            senderType: 'host',
            senderName: participantName(stay.host),
            text: reply,
            timeMs: Math.max(rpNow().getTime(), Date.now()),
          });
          thread.updatedAt = Date.now();
          saveSettings();
        }
      } finally {
        hostReplyBusy = '';
        render();
      }
      return;
    }

    if (form.matches('[data-ghte-stay-search]')) {
      const s = state();
      const checkIn = String(fd.get('checkIn') || '');
      const checkOut = String(fd.get('checkOut') || '');
      if (new Date(checkOut).getTime() <= new Date(checkIn).getTime()) throw new Error('Check-out must be after check-in.');

      s.search.stays = {
        ...s.search.stays,
        city: norm(fd.get('city') || 'Greyhaven'),
        area: norm(fd.get('area')),
        checkIn,
        checkOut,
        guests: clamp(Number(fd.get('guests') || 1), 1, 14),
        type: String(fd.get('type') || 'all'),
      };
      saveSettings();
      return refreshStays();
    }

    if (form.matches('[data-ghte-transport-search]')) {
      const from = norm(fd.get('from'));
      const to = norm(fd.get('to'));
      const when = String(fd.get('when') || '');
      if (!from || !to || !when) throw new Error('Choose a route and date.');

      view.transportFrom = from;
      view.transportTo = to;
      view.transportWhen = when;
      view.transportResults = transportChoices(view.transportMode || 'flight', from, to, when);
      return render();
    }

    if (form.matches('[data-ghte-event-search]')) {
      const s = state();
      s.search.events.city = norm(fd.get('city') || 'Greyhaven');
      s.search.events.category = String(fd.get('category') || 'all');
      saveSettings();
      return refreshEvents();
    }
  } catch (error) {
    globalThis.toastr?.error?.(error.message || String(error));
  }
}

async function handleDialogSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const fd = new FormData(form);

  try {
    if (form.matches('[data-ghte-reservation-form]')) {
      const shared = form.dataset.mode === 'shared';
      const participantIds = shared ? [] : fd.getAll('identityId').map(String);
      const maxGuests = shared ? clamp(Number(fd.get('maxGuests') || 2), 2, 14) : 0;
      const reservation = createReservation({
        accommodationId: form.dataset.id,
        checkIn: String(fd.get('checkIn')),
        checkOut: String(fd.get('checkOut')),
        participantIds,
        mode: shared ? 'shared' : 'private',
        openSlots: shared ? Math.max(1, maxGuests - 1) : 0,
      });

      form.closest('dialog')?.close();
      view.tab = 'trips';
      render();
      globalThis.toastr?.success?.(shared
        ? `Shared booking created with ${reservation.maxGuests - reservation.participants.length} open spot(s).`
        : 'Stay reserved.');
      return;
    }

    if (form.matches('[data-ghte-transport-book-form]')) {
      const choice = view.transportResults?.[Number(form.dataset.index)];
      if (!choice) throw new Error('Travel option is no longer available.');
      const booking = bookTransport(choice, fd.getAll('identityId').map(String));
      form.closest('dialog')?.close();
      view.tab = 'trips';
      render();
      globalThis.toastr?.success?.(`Tickets booked for ${booking.travelers.length} traveler(s).`);
      return;
    }

    if (form.matches('[data-ghte-create-event-form]')) {
      const eventRecord = createOwnedEvent({
        title: fd.get('title'),
        category: fd.get('category'),
        propertyId: fd.get('propertyId'),
        venue: fd.get('venue'),
        city: fd.get('city'),
        area: fd.get('area'),
        startAt: fd.get('startAt'),
        durationHours: fd.get('durationHours'),
        price: fd.get('price'),
        capacity: fd.get('capacity'),
        description: fd.get('description'),
      });

      form.closest('dialog')?.close();
      view.tab = 'mine';
      view.detailId = eventRecord.id;
      render();
      globalThis.toastr?.success?.('Event published.');
    }
  } catch (error) {
    globalThis.toastr?.error?.(error.message || String(error));
  }
}

function handleChange(event) {
  if (event.target.matches?.('[data-ghte-auto-fill]')) {
    try {
      setSharedAutoFill(event.target.dataset.ghteAutoFill, event.target.checked);
      render();
    } catch (error) {
      event.target.checked = !event.target.checked;
      globalThis.toastr?.error?.(error.message);
    }
    return;
  }

  if (event.target.matches?.('[data-ghte-events-toggle]')) {
    setEventsInstalled(event.target.checked);
    injectHomeIcons();
    globalThis.toastr?.success?.(event.target.checked ? 'Eventbrite installed.' : 'Eventbrite removed from this phone.');
  }
}

function documentClick(event) {
  const opener = event.target.closest?.('[data-ghte-open]');
  if (!opener) return;

  event.preventDefault();
  event.stopPropagation();
  openApp(opener.dataset.ghteOpen);
}

/* ---------------- observer / boot ---------------- */

function syncUi() {
  syncAppDefaults();
  injectHomeIcons();
  injectSettingsToggle();
  processLifecycleReminders();

  const overlay = qs('#ghp-overlay');
  if (!overlay || overlay.hidden) {
    if (appOpen) {
      appOpen = '';
      qs('#ghte-layer')?.remove();
    }
    return;
  }

  // Never render because of our own DOM mutation. Only reconstruct if the
  // native phone renderer removed the custom layer.
  if (appOpen && !qs('#ghte-layer')) render();
}

function observeUi() {
  if (observer || !document.body) return;

  let queued = false;
  observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncUi();
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function bindEvents() {
  const c = ctx();
  if (!c?.eventSource || !c?.eventTypes) return;

  const bind = (key, fn) => {
    const type = c.eventTypes[key];
    if (type) c.eventSource.on(type, fn);
  };

  for (const key of ['PERSONA_CHANGED', 'CHAT_CHANGED', 'CHAT_CREATED']) {
    bind(key, () => setTimeout(() => {
      appOpen = '';
      qs('#ghte-layer')?.remove();
      state();
      syncAppDefaults();
      syncUi();
    }, 90));
  }
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
  globalThis.GreyhavenPhoneTravelEvents = {
    version: GHTE_VERSION,
    getState: () => clone(state()),
    listAccommodations: () => clone(Object.values(state()?.accommodations || {})),
    listReservations: () => clone(Object.values(state()?.reservations || {})),
    listTransportBookings: () => clone(Object.values(state()?.transportBookings || {})),
    listEvents: () => clone(Object.values(state()?.events || {})),
    openBooking: () => openApp('booking'),
    openEvents: () => openApp('events'),
    refreshStays,
    refreshEvents,
    refreshShared,
  };
}

async function init() {
  if (initialized) return;
  ensureCss();

  if (!await waitReady()) {
    console.warn(`[${GHTE_MODULE}] Greyhaven Phone was not ready in time.`);
    return;
  }

  state();
  syncAppDefaults();
  expose();
  bindEvents();

  document.addEventListener('click', documentClick, true);
  observeUi();

  for (const delay of [100, 400, 1000, 2200]) setTimeout(syncUi, delay);

  initialized = true;
  console.info(`[${GHTE_MODULE}] v${GHTE_VERSION} loaded`);
}

void init().catch(error => console.error(`[${GHTE_MODULE}] boot`, error));
