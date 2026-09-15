/* Greyhaven Phone v2.8.0 — private personal asset knowledge */

const GHAC_KEY = 'greyhaven_phone_personal_assets';
const POSITION = 1;
const ROLE_SYSTEM = 0;
let bound = false;

const norm = v => String(v ?? '').trim();
const lc = v => norm(v).toLowerCase();
const ctx = () => {
  try { return globalThis.SillyTavern?.getContext?.() || null; }
  catch { return null; }
};
const phone = () => globalThis.GreyhavenPhone || null;
const assets = () => globalThis.GreyhavenPhoneLifeAssets || null;

function identityName(id, fallback = '') {
  try { return phone()?.getIdentityById?.(id)?.name || fallback || ''; }
  catch { return fallback || ''; }
}

function relevantNames() {
  const c = ctx();
  const rows = [];
  const seen = new Set();
  const add = name => {
    name = norm(name);
    if (!name || seen.has(lc(name))) return;
    seen.add(lc(name));
    rows.push(name);
  };
  add(c?.name1);

  if (c?.groupId && Array.isArray(c?.groups)) {
    const group = c.groups.find(g => String(g?.id) === String(c.groupId));
    for (const member of group?.members || []) {
      const raw = typeof member === 'string' ? member : (member?.avatar || member?.name || '');
      const ch = (c.characters || []).find(x => x?.avatar === raw || lc(x?.name) === lc(raw));
      add(ch?.name || (typeof member === 'object' ? member?.name : ''));
    }
  } else {
    const ch = Number.isInteger(Number(c?.characterId)) ? c?.characters?.[Number(c.characterId)] : null;
    add(ch?.name || c?.name2);
  }
  return rows;
}

function money(v) {
  const n = Math.max(0, Number(v || 0));
  return `€${Math.round(n).toLocaleString()}`;
}

function ownerName(owner) {
  if (!owner) return 'unknown owner';
  if (owner.kind === 'identity') return identityName(owner.identityId, owner.name || 'owner');
  return norm(owner.name || owner.label || owner.relation || 'external owner');
}

function tenantShare(property, tenant) {
  const total = Math.max(0, Number(property?.monthlyRent || 0));
  if (!total) return 0;
  if (property?.rentSplit === 'equal') {
    const count = Math.max(1, (property.tenants || []).length + Math.max(0, Number(property.untrackedHousemates || 0)));
    return total / count;
  }
  if (property?.rentSplit === 'custom') return Math.max(0, Number(tenant?.monthlyRent || 0));
  if ((property?.tenants || []).length <= 1) return total;
  return Math.max(0, Number(tenant?.monthlyRent || 0));
}

function factsFor(name, state) {
  const facts = [];
  const ownedVehicles = Object.values(state?.vehicles || {}).filter(v =>
    v?.status === 'active' && v?.owner?.kind === 'identity' && lc(identityName(v.owner.identityId, v.owner.name)) === lc(name)
  );
  for (const v of ownedVehicles.slice(0, 8)) {
    const title = [v.year, v.make, v.model].filter(Boolean).join(' ') || v.type || 'vehicle';
    facts.push(`owns ${title}${v.color ? ` (${v.color})` : ''}${v.plate ? `, plate ${v.plate}` : ''}`);
  }

  for (const rental of Object.values(state?.vehicleRentals || {})) {
    if (!['booked','active'].includes(rental?.status)) continue;
    const renter = identityName(rental.renterIdentityId, rental.renterName);
    if (lc(renter) !== lc(name)) continue;
    const v = state?.vehicles?.[rental.assetId];
    if (!v) continue;
    const title = [v.year, v.make, v.model].filter(Boolean).join(' ') || v.type || 'vehicle';
    facts.push(`currently rents ${title}${v.plate ? `, plate ${v.plate}` : ''}`);
  }

  for (const p of Object.values(state?.properties || {}).filter(x => x?.status === 'active')) {
    const place = [p.name, p.address, p.area, p.city].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · ');
    const owner = p?.owner?.kind === 'identity' ? identityName(p.owner.identityId, p.owner.name) : ownerName(p.owner);
    if (p?.owner?.kind === 'identity' && lc(owner) === lc(name)) {
      const tenants = (p.tenants || []).map(t => identityName(t.identityId, t.name)).filter(Boolean);
      facts.push(`owns ${place || p.type || 'property'}${tenants.length ? `; tenants: ${tenants.join(', ')}` : ''}`);
      continue;
    }
    const tenant = (p.tenants || []).find(t => lc(identityName(t.identityId, t.name)) === lc(name));
    if (tenant) {
      const share = tenantShare(p, tenant);
      const roommates = (p.tenants || []).map(t => identityName(t.identityId, t.name)).filter(x => x && lc(x) !== lc(name));
      facts.push(`lives at ${place || p.type || 'rental property'} as a tenant${owner ? `; landlord/owner: ${owner}` : ''}${share ? `; personal rent share ${money(share)}/month` : ''}${roommates.length ? `; co-tenants: ${roommates.join(', ')}` : ''}`);
      continue;
    }
    const occupant = (p.occupants || []).find(t => lc(identityName(t.identityId, t.name)) === lc(name));
    if (occupant) facts.push(`lives at ${place || p.type || 'property'} as an occupant${owner ? `; owner: ${owner}` : ''}`);
  }
  return facts;
}

function buildPrompt() {
  const api = assets();
  const c = ctx();
  if (!api?.getState || !c || !(c.getCurrentChatId?.() || c.chatId)) return '';
  let state;
  try { state = api.getState(); } catch { return ''; }
  const lines = [];
  for (const name of relevantNames()) {
    const facts = factsFor(name, state);
    if (facts.length) lines.push(`${name}: ${facts.join('; ')}.`);
  }
  if (!lines.length) return '';
  return `[Greyhaven private personal facts — authoritative world state. Each named person knows their own facts naturally. Do not treat another person's private facts as automatically known unless roleplay establishes that knowledge.]\n${lines.join('\n')}`;
}

function updatePrompt() {
  const c = ctx();
  if (!c?.setExtensionPrompt) return;
  try { c.setExtensionPrompt(GHAC_KEY, buildPrompt(), POSITION, 1, false, ROLE_SYSTEM); }
  catch (error) { console.warn('[greyhaven-phone-assets] prompt update failed', error); }
}

function bindEvents() {
  if (bound) return;
  const c = ctx();
  if (!c?.eventSource || !c?.eventTypes) return;
  const bind = (key, fn) => { const e = c.eventTypes[key]; if (e) c.eventSource.on(e, fn); };
  for (const key of ['GENERATION_STARTED','CHAT_CHANGED','CHAT_CREATED','PERSONA_CHANGED','GROUP_UPDATED','CHARACTER_EDITED']) {
    bind(key, () => setTimeout(updatePrompt, key === 'GENERATION_STARTED' ? 0 : 50));
  }
  window.addEventListener('greyhaven-life:changed', updatePrompt);
  window.addEventListener('greyhaven-world:event', updatePrompt);
  bound = true;
}

async function init() {
  for (let i=0;i<200;i++) {
    if (ctx()?.extensionSettings && globalThis.GreyhavenPhoneLifeAssets) break;
    await new Promise(r => setTimeout(r, 60));
  }
  bindEvents();
  updatePrompt();
  console.info('[greyhaven-phone-assets] personal asset context ready');
}

void init().catch(error => console.error('[greyhaven-phone-assets] init failed', error));
