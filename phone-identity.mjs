/* Stable per-identity phone storage and loss-averse upgrade from legacy persona/latent keys.
 * Pure functions intentionally make it possible to test against chat exports offline.
 */

export const phoneKeyForIdentity = id => `phone-id:${encodeURIComponent(String(id))}`;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function itemKey(value) {
  if (!isObject(value)) return `primitive:${String(value)}`;
  if (value.mirrorId) return `mirror:${value.mirrorId}`;
  if (value.sharedEventId) return `shared:${value.sharedEventId}`;
  if (value.id) return `id:${value.id}`;
  // Preserve anonymous items with distinct content, while avoiding exact copies.
  return `value:${JSON.stringify(value)}`;
}

function mergeList(a, b) {
  const out = [...a], positions = new Map();
  out.forEach((value, index) => positions.set(itemKey(value), index));
  for (const value of b) {
    const key = itemKey(value), index = positions.get(key);
    if (index === undefined) { positions.set(key, out.length); out.push(value); }
    else if (isObject(out[index]) && isObject(value)) mergeObject(out[index], value);
  }
  return out;
}

function mergeObject(target, source) {
  if (!isObject(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (Array.isArray(value)) target[key] = Array.isArray(existing) ? mergeList(existing, value) : value;
    else if (isObject(value)) target[key] = isObject(existing) ? mergeObject(existing, value) : value;
    else if (existing === undefined || existing === null || existing === '') target[key] = value;
  }
  return target;
}

function sortHistory(rows) {
  // JavaScript stable sort preserves send order for all the messages in a frozen minute.
  rows.sort((a, b) => Number(a?.timeMs || 0) - Number(b?.timeMs || 0) ||
    Number(a?.realMs || 0) - Number(b?.realMs || 0));
}

function collapseThreads(store, app = false) {
  if (!isObject(store?.threads)) return;
  const canonical = new Map(), redirects = new Map();
  for (const [key, thread] of Object.entries(store.threads)) {
    const peer = app
      ? String(thread?.identityId || thread?.peerName || '').toLowerCase()
      : `${thread?.type || 'direct'}:${(thread?.contactIds || []).slice().sort().join(',')}`;
    if (!peer || (!app && peer.endsWith(':'))) continue;
    if (!canonical.has(peer)) { canonical.set(peer, key); continue; }
    const existingKey = canonical.get(peer);
    mergeObject(store.threads[existingKey], thread);
    redirects.set(key, existingKey);
    delete store.threads[key];
  }
  if (Array.isArray(store.threadOrder)) {
    store.threadOrder = [...new Set(store.threadOrder.map(key => redirects.get(key) || key))].filter(key => store.threads[key]);
  }
  for (const thread of Object.values(store.threads)) {
    if (Array.isArray(thread.messages)) sortHistory(thread.messages);
    if (Array.isArray(thread.videoTranscript)) sortHistory(thread.videoTranscript);
  }
}

function collapseContacts(phone) {
  if (!isObject(phone.contacts)) return;
  const canonical = new Map(), redirects = new Map();
  for (const [key, contact] of Object.entries(phone.contacts)) {
    const person = String(contact?.identityId || contact?.name || '').toLowerCase();
    if (!person) continue;
    if (!canonical.has(person)) { canonical.set(person, key); continue; }
    const original = canonical.get(person);
    mergeObject(phone.contacts[original], contact);
    redirects.set(key, original);
    delete phone.contacts[key];
  }
  phone.contactOrder = [...new Set((phone.contactOrder || []).map(key => redirects.get(key) || key))].filter(key => phone.contacts[key]);
  for (const thread of Object.values(phone.threads || {})) {
    if (Array.isArray(thread.contactIds)) thread.contactIds = [...new Set(thread.contactIds.map(key => redirects.get(key) || key))];
  }
  for (const notice of phone.notifications || []) {
    if (redirects.has(notice?.contactId)) notice.contactId = redirects.get(notice.contactId);
  }
}

function mergePhone(target, source) {
  mergeObject(target, source);
  collapseContacts(target);
  collapseThreads(target);
  for (const app of ['instagram', 'snapchat', 'facebook', 'onlyfans', 'darkweb']) collapseThreads(target[app], true);
  // Feed-like arrays are newest-first in the UI; retain their established order.
  target.updatedAt = Math.max(Number(target.updatedAt || 0), Number(source.updatedAt || 0));
  return target;
}

function activityWeight(phone) {
  let count = (phone?.posts?.length || 0) + (phone?.stories?.length || 0);
  for (const thread of Object.values(phone?.threads || {})) count += thread?.messages?.length || 0;
  for (const app of ['instagram', 'snapchat', 'facebook', 'onlyfans', 'darkweb']) {
    const store = phone?.[app];
    for (const thread of Object.values(store?.threads || {})) count += thread?.messages?.length || 0;
    count += (store?.posts?.length || 0) + (store?.stories?.length || 0);
  }
  return count;
}

/**
 * Resolve by an explicit identity ID first; legacy name fallback only if caller
 * can unambiguously map it to an identity. Unresolved records are left untouched.
 * Returns true only when keys were actually changed.
 */
export function reconcilePhoneIdentities(phones, resolveIdentityId) {
  if (!isObject(phones)) return false;
  const groups = new Map();
  for (const [key, phone] of Object.entries(phones)) {
    if (!isObject(phone)) continue;
    let identityId = String(phone.identityId || '');
    if (!identityId && (key.startsWith('latent-id:') || key.startsWith('phone-id:'))) {
      try { identityId = decodeURIComponent(key.slice(key.indexOf(':') + 1)); } catch {}
    }
    if (!identityId && phone.ownerName) identityId = String(resolveIdentityId(phone.ownerName) || '');
    if (!identityId) continue;
    const canon = phoneKeyForIdentity(identityId);
    if (!groups.has(canon)) groups.set(canon, []);
    groups.get(canon).push({ key, phone, identityId });
  }
  let changed = false;
  for (const [key, rows] of groups) {
    if (rows.length === 1 && rows[0].key === key) continue;
    // Choose the most complete copy as the starting point, then union distinct data.
    rows.sort((a, b) => activityWeight(b.phone) - activityWeight(a.phone));
    const main = rows[0].phone;
    for (const row of rows.slice(1)) if (row.phone !== main) mergePhone(main, row.phone);
    main.identityId = rows[0].identityId;
    collapseContacts(main);
    collapseThreads(main);
    for (const app of ['instagram', 'snapchat', 'facebook', 'onlyfans', 'darkweb']) collapseThreads(main[app], true);
    phones[key] = main;
    for (const row of rows) if (row.key !== key) delete phones[row.key];
    changed = true;
  }
  return changed;
}
