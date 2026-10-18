import { getRequestHeaders } from '../../../../script.js';
import {
  GHIMG_MODELS,
  DEFAULT_IMAGE_MODEL,
  MAX_WIRO_REFERENCES,
  resolveImageSubjects,
  describeWardrobeForImage,
  selectReferenceAssignments,
  buildImagePrompt,
  cleanText,
  lower,
} from './image-gen-core.js';

const MODULE = 'greyhaven-phone-imagegen';
const VERSION = '2.0.0';
const SETTINGS_KEY = 'greyhavenPhone';
const META_KEY = 'greyhavenPhone';
const REF_DB_NAME = 'GreyhavenPhoneImageGen';
const REF_STORE = 'refs';
const PHONE_MEDIA_DB = 'GreyhavenPhoneMedia';
const PHONE_MEDIA_STORE = 'media';
const PLUGIN_BASE = '/api/plugins/greyhaven-image';
const MAX_PACK_REFS = 6;
const MAX_REF_EDGE = 1600;
const JPEG_QUALITY = 0.88;
const AUTO_APPS = ['messages','snapchat','instagram','facebook'];
const MANUAL_ONLY_APPS = new Set(['onlyfans','darkweb','marketplace','garage','properties','booking','events']);

let initialized = false;
let uiObserver = null;
let augmentQueued = false;
let generationQueue = Promise.resolve();
let registryCache = null;
let registryDirty = true;
const refreshStampByPhone = new Map();
const pending = new Set();
const pendingReason = new Map();
const failed = new Map();
const refUrls = new Map();
const generatedUrls = new Map();
const mediaKeyUrls = new Map();
let refDbPromise = null;
let phoneDbPromise = null;
let providerStatus = null;

const ctx = () => {
  try { return globalThis.SillyTavern?.getContext?.() || null; }
  catch { return null; }
};
const clone = value => {
  if (value === undefined) return undefined;
  try { return structuredClone(value); }
  catch { return JSON.parse(JSON.stringify(value)); }
};
const uuid = () => {
  try { return crypto.randomUUID(); }
  catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
};
const esc = value => String(value ?? '')
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#039;');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function hasPhone() {
  return !!globalThis.GreyhavenPhone;
}

function currentChatKey() {
  const c = ctx();
  const id = c?.getCurrentChatId?.() || c?.chatId || '';
  return c?.groupId ? `group:${c.groupId}:${id}` : `chat:${c?.characterId ?? ''}:${id}`;
}

function phoneSettingsRoot() {
  const c = ctx();
  if (!c?.extensionSettings) return null;
  c.extensionSettings[SETTINGS_KEY] ||= {};
  return c.extensionSettings[SETTINGS_KEY];
}


function continuityForItem(item) {
  const life = globalThis.GreyhavenLife;
  if (!life) return '';
  const pieces = [];
  try {
    const sender = item?.senderName ? life.getResolvedPerson?.(item.senderName) : null;
    const scene = life.getScene?.();
    const location = cleanText(sender?.location || sender?.area ? [sender?.location,sender?.area].filter(Boolean).join(', ') : '');
    const sceneLocation = cleanText([scene?.location || scene?.label,scene?.area].filter(Boolean).join(', '));
    if (location) pieces.push(`${cleanText(item.senderName || 'Sender')}'s tracked location: ${location}.`);
    else if (sceneLocation) pieces.push(`Current roleplay scene: ${sceneLocation}.`);
    // Scene notes describe the active RP location. Do not mix them into an
    // off-screen sender's photo when Greyhaven Life tracks that sender elsewhere.
    // Free-form scene notes often contain panoramic/set-dressing details that
    // distract Seedream from the person. Location and time are sufficient.
    const time = life.getTime?.();
    const d = time ? new Date(time) : null;
    if (d && !Number.isNaN(d.getTime())) {
      const clock = new Intl.DateTimeFormat(undefined,{weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
      const hour = d.getHours();
      const part = hour < 6 ? 'late night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
      pieces.push(`Roleplay time: ${clock} (${part}).`);
    }
  } catch (error) {
    console.warn(`[${MODULE}] continuity`, error);
  }
  return pieces.join(' ');
}

function imageSettings() {
  const c = ctx();
  if (!c?.extensionSettings) return null;
  c.extensionSettings[SETTINGS_KEY] ||= {};
  const root = c.extensionSettings[SETTINGS_KEY];
  root.imageGeneration ||= {};
  const s = root.imageGeneration;
  s.version = Math.max(1, Number(s.version || 1));
  s.model = GHIMG_MODELS[s.model] ? s.model : DEFAULT_IMAGE_MODEL;
  s.referencePacks = s.referencePacks && typeof s.referencePacks === 'object' && !Array.isArray(s.referencePacks) ? s.referencePacks : {};
  s.autoByPhone = s.autoByPhone && typeof s.autoByPhone === 'object' && !Array.isArray(s.autoByPhone) ? s.autoByPhone : {};
  s.seenByPhone = s.seenByPhone && typeof s.seenByPhone === 'object' && !Array.isArray(s.seenByPhone) ? s.seenByPhone : {};
  s.baselineChats = s.baselineChats && typeof s.baselineChats === 'object' && !Array.isArray(s.baselineChats) ? s.baselineChats : {};
  s.usage = s.usage && typeof s.usage === 'object' ? s.usage : { images:0, totalCost:0, chargedCost:0 };
  s.usage.images = Math.max(0, Number(s.usage.images || 0));
  s.usage.totalCost = Math.max(0, Number(s.usage.totalCost || 0));
  s.usage.chargedCost = Math.max(0, Number(s.usage.chargedCost || 0));
  return s;
}

function saveImageSettings() {
  try { ctx()?.saveSettingsDebounced?.(); }
  catch (error) { console.warn(`[${MODULE}] settings save`, error); }
}

function metadataRoot() {
  const c = ctx();
  const root = c?.chatMetadata?.[META_KEY];
  return root && typeof root === 'object' ? root : null;
}

function saveMetadata(root = metadataRoot()) {
  const c = ctx();
  if (!root || !c?.chatMetadata) return;
  c.chatMetadata[META_KEY] = root;
  try {
    c.updateChatMetadata?.({ [META_KEY]: root });
    if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced();
    else c.saveMetadata?.();
  } catch (error) {
    console.warn(`[${MODULE}] metadata save`, error);
  }
}

function identities() {
  const rows = globalThis.GreyhavenPhone?.listIdentities?.() || [];
  return Array.isArray(rows) ? rows.filter(x => x?.id && x?.name) : [];
}

function canonicalIdentities() {
  const currentId = currentIdentity()?.id || '';
  const rank = row => (row?.id === currentId ? 100 : 0) + (row?.kind === 'character' ? 20 : row?.kind === 'persona' ? 10 : 1);
  const map = new Map();
  for (const row of identities()) {
    const key = lower(row.name);
    const previous = map.get(key);
    if (!previous || rank(row) > rank(previous)) map.set(key,row);
  }
  return [...map.values()];
}

function currentIdentity() {
  return globalThis.GreyhavenPhone?.getCurrentIdentity?.() || null;
}

function identityById(id) {
  if (!id) return null;
  return globalThis.GreyhavenPhone?.getIdentityById?.(id) || identities().find(x => x.id === id) || null;
}

function identityByName(name) {
  if (!name) return null;
  return globalThis.GreyhavenPhone?.getIdentityByName?.(name) || identities().find(x => lower(x.name) === lower(name)) || null;
}

function currentTimelineBox() {
  const root = metadataRoot();
  const owner = currentIdentity();
  if (!root?.phones || !owner) return null;
  for (const [key,timeline] of Object.entries(root.phones)) {
    if (timeline?.identityId === owner.id || lower(timeline?.ownerName) === lower(owner.name)) return { root, key, timeline, owner };
  }
  return null;
}

function refDb() {
  if (refDbPromise) return refDbPromise;
  refDbPromise = new Promise((resolve,reject) => {
    const req = indexedDB.open(REF_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(REF_STORE)) db.createObjectStore(REF_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Reference database failed.'));
  });
  return refDbPromise;
}

function phoneMediaDb() {
  if (phoneDbPromise) return phoneDbPromise;
  phoneDbPromise = new Promise((resolve,reject) => {
    const req = indexedDB.open(PHONE_MEDIA_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHONE_MEDIA_STORE)) db.createObjectStore(PHONE_MEDIA_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Phone media database failed.'));
  });
  return phoneDbPromise;
}

async function dbPut(dbPromise, store, key, value) {
  const db = await dbPromise();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve(key);
    tx.onerror = () => reject(tx.error || new Error('Database write failed.'));
  });
}

async function dbGet(dbPromise, store, key) {
  if (!key) return null;
  const db = await dbPromise();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('Database read failed.'));
  });
}


async function mediaUrlForKey(mediaKey) {
  if (!mediaKey) return '';
  let url = mediaKeyUrls.get(mediaKey);
  if (url) return url;
  const blob = await dbGet(phoneMediaDb, PHONE_MEDIA_STORE, mediaKey).catch(() => null);
  if (!blob) return '';
  url = URL.createObjectURL(blob);
  mediaKeyUrls.set(mediaKey,url);
  return url;
}

async function dbDelete(dbPromise, store, key) {
  if (!key) return;
  const db = await dbPromise();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Database delete failed.'));
  });
}

async function blobHash(blob) {
  // Reference hashes are used only for local duplicate detection, not security.
  // Avoid WebCrypto here because Safari does not expose crypto.subtle in every
  // SillyTavern/PWA context (notably plain-HTTP/insecure origins).
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 ^= b;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (b + (i & 0xff));
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `gh1-${(h1 >>> 0).toString(16).padStart(8,'0')}${(h2 >>> 0).toString(16).padStart(8,'0')}-${bytes.length.toString(16)}`;
}

async function imageBitmapFromBlob(blob) {
  if (globalThis.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch {}
  }
  return new Promise((resolve,reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image.')); };
    img.src = url;
  });
}

async function compressReference(file) {
  const source = await imageBitmapFromBlob(file);
  const w = Number(source.width || source.naturalWidth || 0), h = Number(source.height || source.naturalHeight || 0);
  if (!w || !h) throw new Error('Invalid image dimensions.');
  const scale = Math.min(1, MAX_REF_EDGE / Math.max(w,h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d', { alpha:false });
  g.drawImage(source, 0, 0, width, height);
  try { source.close?.(); } catch {}
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('Could not compress reference image.');
  return { blob, width, height, hash: await blobHash(blob) };
}

async function blobDimensions(blob) {
  const source = await imageBitmapFromBlob(blob);
  const out = { width:Number(source.width || source.naturalWidth || 0), height:Number(source.height || source.naturalHeight || 0) };
  try { source.close?.(); } catch {}
  return out;
}

function referencePack(identityId) {
  const s = imageSettings();
  if (!s) return [];
  const rows = Array.isArray(s.referencePacks[identityId]) ? s.referencePacks[identityId] : [];
  return rows.filter(x => x?.id && x?.dbKey).slice(0, MAX_PACK_REFS);
}

async function addReferences(identityId, files) {
  const s = imageSettings();
  const identity = identityById(identityId);
  const result = { added:0, duplicates:0, errors:[] };
  if (!s || !identity) { result.errors.push('Character reference pack is unavailable.'); return result; }
  const pack = referencePack(identityId);
  if (pack.length >= MAX_PACK_REFS) return result;
  const existingHashes = new Set(pack.map(x => x.hash).filter(Boolean));
  const selected = [...files].slice(0, MAX_PACK_REFS - pack.length);
  for (const file of selected) {
    const label = String(file?.name || 'Selected image');
    const type = String(file?.type || '');
    if (type && !type.startsWith('image/')) { result.errors.push(`${label}: not an image file.`); continue; }
    try {
      const normalized = await compressReference(file);
      if (existingHashes.has(normalized.hash)) { result.duplicates += 1; continue; }
      const refId = `ref:${uuid()}`;
      const dbKey = `${identityId}|${refId}`;
      await dbPut(refDb, REF_STORE, dbKey, normalized.blob);
      pack.push({ id:refId, dbKey, hash:normalized.hash, width:normalized.width, height:normalized.height, createdAt:Date.now(), primary:pack.length === 0 });
      existingHashes.add(normalized.hash);
      result.added += 1;
    } catch (error) {
      console.warn(`[${MODULE}] reference upload`, error);
      result.errors.push(`${label}: ${error?.message || String(error)}`);
    }
  }
  s.referencePacks[identityId] = pack.slice(0, MAX_PACK_REFS);
  saveImageSettings();
  return result;
}

async function removeReference(identityId, refId) {
  const s = imageSettings();
  if (!s) return;
  const pack = referencePack(identityId);
  const ref = pack.find(x => x.id === refId);
  if (ref) {
    try { await dbDelete(refDb, REF_STORE, ref.dbKey); } catch {}
    const url = refUrls.get(ref.dbKey); if (url) { URL.revokeObjectURL(url); refUrls.delete(ref.dbKey); }
  }
  const next = pack.filter(x => x.id !== refId);
  if (next.length && !next.some(x => x.primary)) next[0].primary = true;
  s.referencePacks[identityId] = next;
  saveImageSettings();
}

function setPrimaryReference(identityId, refId) {
  const s = imageSettings();
  if (!s) return;
  const pack = referencePack(identityId).map(x => ({...x,primary:x.id === refId}));
  s.referencePacks[identityId] = pack;
  saveImageSettings();
}

async function hydrateReferenceImages(root=document) {
  for (const img of root.querySelectorAll?.('[data-ghimg-ref-db]') || []) {
    if (img.dataset.loaded === '1') continue;
    const key = img.dataset.ghimgRefDb;
    let url = refUrls.get(key);
    if (!url) {
      const blob = await dbGet(refDb, REF_STORE, key).catch(() => null);
      if (!blob) continue;
      url = URL.createObjectURL(blob);
      refUrls.set(key,url);
    }
    img.src = url;
    img.dataset.loaded = '1';
  }
}

function identityAvatarUrl(identity) {
  const c = ctx();
  const active = globalThis.GreyhavenPhone?.getActivePersona?.();
  if (identity?.id === currentIdentity()?.id && active?.avatar) return active.avatar;
  const characters = c?.characters || [];
  const found = characters.find(ch => lower(ch?.name) === lower(identity?.name));
  const avatar = found?.avatar || found?.data?.avatar || identity?.characterAvatar || identity?.avatar || '';
  if (!avatar) return '';
  try { return c?.getThumbnailUrl?.('avatar', avatar) || avatar; }
  catch { return avatar; }
}

async function avatarFallbackReference(identity) {
  const url = identityAvatarUrl(identity);
  if (!url) return null;
  try {
    const response = await fetch(url, { credentials:'same-origin' });
    if (!response.ok) return null;
    const source = await response.blob();
    if (!source.type.startsWith('image/')) return null;
    const normalized = await compressReference(source);
    return { id:`avatar:${identity.id}`, dbKey:'', hash:normalized.hash, primary:true, fallback:true, blob:normalized.blob };
  } catch { return null; }
}

function wardrobePersonKey(identity) {
  if (!identity) return '';
  if (String(identity.id).startsWith('character:') || String(identity.id).startsWith('character-name:')) return identity.id;
  return `persona:${lower(identity.name)}`;
}

function wardrobeLine(identity) {
  const api = globalThis.GreyhavenWardrobe;
  if (!api?.getOutfit || !api?.getCatalog) return '';
  try {
    const outfit = api.getOutfit(wardrobePersonKey(identity));
    const catalog = api.getCatalog();
    return describeWardrobeForImage({ identity, outfit, catalog });
  } catch (error) {
    console.warn(`[${MODULE}] wardrobe`, error);
    return '';
  }
}

function mediaDescription(row) {
  return String(row?.mediaDescription || row?.visual || row?.description || '').trim();
}

function itemKey(app, scope, row, ownerId='') {
  const stable = row?.mirrorId || row?.sharedEventId || row?.id || uuid();
  return `${currentChatKey()}|${ownerId}|${app}|${scope}|${stable}`;
}

function buildIdentityIndex() {
  // listIdentities() is one relatively expensive Greyhaven core call. Build
  // lookup maps once per registry refresh instead of calling getIdentityByName
  // for every photo in every app on every DOM mutation.
  const rows = identities();
  const byId = new Map();
  const byName = new Map();
  for (const row of rows) {
    if (row?.id) byId.set(String(row.id), row);
    const name = lower(row?.name);
    if (name && !byName.has(name)) byName.set(name, row);
  }
  return { rows, byId, byName };
}

function senderIdentity(row, identityIndex=null) {
  const id = String(row?.senderId || row?.identityId || row?.sellerIdentityId || row?.creatorIdentityId || '');
  const name = cleanText(row?.sender || row?.author || row?.sellerName || row?.creator || '');
  if (identityIndex) return identityIndex.byId.get(id) || identityIndex.byName.get(lower(name)) || null;
  return identityById(id) || identityByName(name);
}

function makeItem({app,scope,row,ownerId,manualOnly=false,source='metadata',threadId='',storeName='',getTarget=null,identityIndex=null}) {
  if (!row || row.type === 'video' || row.mediaType === 'video') return null;
  const description = mediaDescription(row);
  const isPhoto = row.type === 'photo' || row.mediaType === 'photo' || (!!description && !row.type && !row.mediaType) || (!!row.visual && row.type !== 'video');
  if (!isPhoto || !description || !row.id) return null;
  const sender = senderIdentity(row, identityIndex);
  return {
    key:itemKey(app,scope,row,ownerId), id:String(row.id), app, scope, row, ownerId,
    description, caption:String(row.text || row.caption || '').trim(), mediaKey:String(row.mediaKey || ''),
    senderName:sender?.name || cleanText(row.sender || row.author || row.sellerName || ''),
    senderIdentityId:sender?.id || '', mirrorId:String(row.mirrorId || ''), sharedEventId:String(row.sharedEventId || ''),
    manualOnly:manualOnly || MANUAL_ONLY_APPS.has(app), source, threadId, storeName, getTarget,
  };
}

function buildCurrentMediaRegistry(box=currentTimelineBox()) {
  if (!box) return [];
  const { timeline:t, owner } = box;
  const identityIndex = buildIdentityIndex();
  const items = [];
  const add = item => { if (item) items.push(item); };
  const common = { ownerId:owner.id, identityIndex };

  for (const [threadId,th] of Object.entries(t.threads || {})) {
    for (const row of th.messages || []) add(makeItem({ ...common, app:'messages',scope:'message',row,threadId,getTarget:() => currentTimelineBox()?.timeline?.threads?.[threadId]?.messages?.find(x => x.id === row.id) }));
  }

  for (const app of ['instagram','snapchat','facebook','onlyfans','darkweb']) {
    const store = t[app];
    if (!store) continue;
    for (const [threadId,th] of Object.entries(store.threads || {})) {
      for (const row of th.messages || []) add(makeItem({ ...common, app,scope:'dm',row,threadId,manualOnly:app==='onlyfans'||app==='darkweb',getTarget:() => currentTimelineBox()?.timeline?.[app]?.threads?.[threadId]?.messages?.find(x => x.id === row.id) }));
    }
  }

  for (const row of t.instagram?.posts || []) add(makeItem({...common,app:'instagram',scope:'post',row,getTarget:() => currentTimelineBox()?.timeline?.instagram?.posts?.find(x=>x.id===row.id)}));
  for (const row of t.instagram?.stories || []) add(makeItem({...common,app:'instagram',scope:'story',row,getTarget:() => currentTimelineBox()?.timeline?.instagram?.stories?.find(x=>x.id===row.id)}));
  for (const row of t.facebook?.posts || []) add(makeItem({...common,app:'facebook',scope:'post',row,getTarget:() => currentTimelineBox()?.timeline?.facebook?.posts?.find(x=>x.id===row.id)}));
  for (const row of t.snapchat?.stories || []) add(makeItem({...common,app:'snapchat',scope:'story',row,getTarget:() => currentTimelineBox()?.timeline?.snapchat?.stories?.find(x=>x.id===row.id)}));
  for (const row of t.snapchat?.memories || []) add(makeItem({...common,app:'snapchat',scope:'memory',row,manualOnly:true,getTarget:() => currentTimelineBox()?.timeline?.snapchat?.memories?.find(x=>x.id===row.id)}));
  for (const row of t.photos || []) add(makeItem({...common,app:'photos',scope:'library',row,manualOnly:true,getTarget:() => currentTimelineBox()?.timeline?.photos?.find(x=>x.id===row.id)}));

  const root = metadataRoot();
  for (const row of root?.marketplace?.listings || []) add(makeItem({...common,app:'marketplace',scope:'listing',row,manualOnly:true,getTarget:() => metadataRoot()?.marketplace?.listings?.find(x=>x.id===row.id)}));
  for (const row of root?.darkWeb?.listings || root?.darkweb?.listings || []) add(makeItem({...common,app:'darkweb',scope:'listing',row,manualOnly:true,getTarget:() => (metadataRoot()?.darkWeb?.listings || metadataRoot()?.darkweb?.listings || []).find(x=>x.id===row.id)}));

  const phoneSettings = ctx()?.extensionSettings?.[SETTINGS_KEY];
  for (const [identityId,account] of Object.entries(phoneSettings?.onlyFansAccounts || {})) {
    for (const row of account?.posts || []) add(makeItem({...common,app:'onlyfans',scope:'post',row,manualOnly:true,source:'settings',getTarget:() => ctx()?.extensionSettings?.[SETTINGS_KEY]?.onlyFansAccounts?.[identityId]?.posts?.find(x=>x.id===row.id)}));
  }
  for (const [identityId,profile] of Object.entries(phoneSettings?.socialStudioProfiles || {})) {
    for (const app of ['instagram','facebook']) {
      for (const row of profile?.[app]?.posts || []) add(makeItem({...common,app,scope:'post',row,manualOnly:true,source:'settings',getTarget:() => ctx()?.extensionSettings?.[SETTINGS_KEY]?.socialStudioProfiles?.[identityId]?.[app]?.posts?.find(x=>x.id===row.id)}));
    }
  }

  const unique = new Map();
  for (const item of items) if (!unique.has(item.key)) unique.set(item.key,item);
  return [...unique.values()];
}

function invalidateRegistry() {
  registryDirty = true;
}

function cacheRegistry(items, token) {
  const byKey = new Map(items.map(item => [item.key,item]));
  const byId = new Map();
  const byDescription = new Map();
  for (const item of items) {
    const idList = byId.get(item.id) || []; idList.push(item); byId.set(item.id,idList);
    const desc = cleanText(item.description);
    const descList = byDescription.get(desc) || []; descList.push(item); byDescription.set(desc,descList);
  }
  registryCache = { token, items, byKey, byId, byDescription };
  registryDirty = false;
  return registryCache;
}

function currentMediaRegistry({force=false}={}) {
  const box = currentTimelineBox();
  if (!box) { registryCache=null; registryDirty=true; return []; }
  const token = `${currentChatKey()}|${box.owner.id}`;
  if (!force && !registryDirty && registryCache?.token === token) return registryCache.items;
  return cacheRegistry(buildCurrentMediaRegistry(box), token).items;
}

function registryMaps(force=false) {
  const registry = currentMediaRegistry({force});
  if (registryCache?.items === registry) return registryCache;
  return cacheRegistry(registry, `${currentChatKey()}|${currentIdentity()?.id || ''}`);
}

function registryItem(key) {
  const maps = registryMaps(false);
  return maps.byKey.get(key) || null;
}

function saveItemSource(item) {
  if (item.source === 'settings') saveImageSettings();
  else saveMetadata();
}

function propagateGeneratedState(item, mediaKey, width, height) {
  const apply = obj => {
    if (!obj || typeof obj !== 'object') return;
    const sameMirror = item.mirrorId && obj.mirrorId === item.mirrorId;
    const sameShared = item.sharedEventId && obj.sharedEventId === item.sharedEventId;
    const sameId = obj.id === item.id && mediaDescription(obj) === item.description;
    if (sameMirror || sameShared || sameId) {
      obj.mediaKey = mediaKey;
      obj.mediaWidth = width;
      obj.mediaHeight = height;
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) value.forEach(apply); else apply(value);
      }
    }
  };
  const root = metadataRoot();
  if (root) apply(root);
  const phoneSettings = ctx()?.extensionSettings?.[SETTINGS_KEY];
  if (phoneSettings?.onlyFansAccounts) apply(phoneSettings.onlyFansAccounts);
  if (phoneSettings?.socialStudioProfiles) apply(phoneSettings.socialStudioProfiles);
  saveMetadata(root);
  saveImageSettings();
}

async function saveGeneratedBlob(blob, item) {
  const key = `${currentChatKey()}|ghimg|${item.id}|${uuid()}`;
  await dbPut(phoneMediaDb, PHONE_MEDIA_STORE, key, blob);
  return key;
}

function autoRulesFor(ownerId) {
  const s = imageSettings();
  s.autoByPhone[ownerId] ||= {};
  return s.autoByPhone[ownerId];
}

function setAutoRule(ownerId, app, identityId, enabled) {
  const s = imageSettings();
  if (!s || !ownerId || !app || !identityId) return;
  s.autoByPhone[ownerId] ||= {};
  s.autoByPhone[ownerId][app] ||= {};
  if (enabled) s.autoByPhone[ownerId][app][identityId] = true;
  else delete s.autoByPhone[ownerId][app][identityId];
  saveImageSettings();
}

function autoEnabled(item) {
  if (item.manualOnly || !AUTO_APPS.includes(item.app) || !item.senderIdentityId) return false;

  // Spend-safety: automatic generation is only for media sent directly to the
  // current phone (iMessage / Snapchat chat / Instagram DM / Messenger). Feed
  // posts, stories and discovery/listing media always keep a manual Generate
  // button, even if the author is enabled in that app.
  const direct = item.app === 'messages' ? item.scope === 'message' : item.scope === 'dm';
  if (!direct) return false;

  return autoRulesFor(item.ownerId)?.[item.app]?.[item.senderIdentityId] === true;
}

function seenSet(ownerId) {
  const s = imageSettings();
  s.seenByPhone[ownerId] ||= [];
  return new Set(s.seenByPhone[ownerId]);
}

function saveSeen(ownerId, set) {
  const s = imageSettings();
  s.seenByPhone[ownerId] = [...set].slice(-1800);
  saveImageSettings();
}

function baselineKey(ownerId) {
  return `${currentChatKey()}|${ownerId}`;
}

function phoneIsOpen() {
  const overlay = document.querySelector('#ghp-overlay');
  return !!overlay && overlay.hidden === false;
}

function processNewMediaAfterRefresh() {
  if (!phoneIsOpen() || !hasPhone()) return;
  const owner = currentIdentity();
  if (!owner) return;
  const registry = currentMediaRegistry({force:true});
  const s = imageSettings();
  const seen = seenSet(owner.id);
  const baseline = baselineKey(owner.id);

  if (!s.baselineChats[baseline]) {
    for (const item of registry) seen.add(item.key);
    s.baselineChats[baseline] = true;
    saveSeen(owner.id, seen);
    return;
  }

  let changed = false;
  for (const item of registry) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    changed = true;
    if (!item.mediaKey && autoEnabled(item)) queueGeneration(item, 'auto');
  }
  if (changed) saveSeen(owner.id, seen);
}

function refreshStampKey(box) {
  return `${currentChatKey()}|${box?.owner?.id || ''}`;
}

function maybeProcessPhoneRefresh() {
  const box = currentTimelineBox();
  if (!box) return;
  const key = refreshStampKey(box);
  const stamp = Number(box.timeline?.refresh?.lastAt || 0);
  if (!refreshStampByPhone.has(key)) {
    refreshStampByPhone.set(key, stamp);
    return;
  }
  const previous = Number(refreshStampByPhone.get(key) || 0);
  if (stamp && stamp !== previous) {
    refreshStampByPhone.set(key, stamp);
    invalidateRegistry();
    processNewMediaAfterRefresh();
  }
}

async function fileToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i=0;i<bytes.length;i+=chunk) binary += String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(binary);
}

async function loadReferencePayload(subjects,maxTotal=MAX_WIRO_REFERENCES) {
  const s = imageSettings();
  const packs = {};
  for (const subject of subjects) {
    let rows = referencePack(subject.id);
    if (!rows.length) {
      const fallback = await avatarFallbackReference(subject);
      rows = fallback ? [fallback] : [];
    }
    packs[subject.id] = rows;
  }

  const assignments = selectReferenceAssignments({ subjects, packs, maxTotal, maxPerSubject:3 });
  const payload = [];
  const usableAssignments = [];
  const seenHashes = new Set();

  for (const assignment of assignments) {
    const ref = assignment.reference;
    let blob = ref.blob || null;
    if (!blob && ref.dbKey) blob = await dbGet(refDb, REF_STORE, ref.dbKey).catch(() => null);
    if (!blob) continue;
    const hash = ref.hash || await blobHash(blob);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);
    payload.push({ name:assignment.subject.name, mime:blob.type || 'image/jpeg', base64:await fileToBase64(blob) });
    usableAssignments.push({ ...assignment, reference:{...ref,hash} });
  }
  return { payload, assignments:usableAssignments };
}

function aspectForItem(item) {
  if (item.app === 'snapchat' || item.scope === 'story') return '9:16';
  if (item.app === 'instagram' && item.scope === 'post') return '4:5';
  if (['marketplace','garage','properties','booking'].includes(item.app)) return '4:3';
  return '3:4';
}

async function pluginRequest(path, options={}) {
  const headers = { ...getRequestHeaders(), ...(options.headers || {}) };
  if (options.body && typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  const response = await fetch(`${PLUGIN_BASE}${path}`, { credentials:'same-origin', ...options, headers });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok || data?.ok === false) throw new Error(data?.error || text || `HTTP ${response.status}`);
  return data || {};
}

async function refreshProviderStatus() {
  try { providerStatus = await pluginRequest('/health', { method:'GET', body:undefined }); }
  catch (error) { providerStatus = { ok:false, configured:false, error:error?.message || String(error) }; }
  updateProviderStatusDom();
  return providerStatus;
}

function updateProviderStatusDom() {
  const el = document.querySelector('[data-ghimg-provider-status]');
  if (!el) return;
  if (providerStatus?.ok && providerStatus.configured) {
    const auth = providerStatus.authMode === 'signature' ? 'Signature auth · key + secret stored server-side.' : 'API-key-only auth · key stored server-side.';
    el.className = 'ghimg-provider-status good';
    el.innerHTML = `<i class="fa-solid fa-circle-check"></i><span><b>Wiro credentials saved</b><small>${esc(auth)}</small></span>`;
  } else if (providerStatus?.ok) {
    el.className = 'ghimg-provider-status warn';
    el.innerHTML = '<i class="fa-solid fa-key"></i><span><b>Wiro key not configured</b><small>Save your project credentials below before generating.</small></span>';
  } else {
    el.className = 'ghimg-provider-status bad';
    el.innerHTML = `<i class="fa-solid fa-server"></i><span><b>Image relay unavailable</b><small>${esc(providerStatus?.error || 'Install/restart the Greyhaven Image server plugin.')}</small></span>`;
  }
}

async function saveProviderConfig() {
  const section = document.querySelector('#ghimg-settings-section');
  if (!section) return;
  const apiKey = section.querySelector('[data-ghimg-api-key]')?.value?.trim() || '';
  const apiSecret = section.querySelector('[data-ghimg-api-secret]')?.value?.trim() || '';
  const model = section.querySelector('[data-ghimg-model]')?.value || DEFAULT_IMAGE_MODEL;
  const s = imageSettings();
  s.model = GHIMG_MODELS[model] ? model : DEFAULT_IMAGE_MODEL;
  saveImageSettings();
  const button = section.querySelector('[data-ghimg-save-provider]');
  if (button) { button.disabled=true; button.textContent='Saving…'; }
  try {
    providerStatus = await pluginRequest('/config', { method:'POST', body:JSON.stringify({ model:s.model, ...(apiKey?{apiKey}:{}), ...(apiSecret?{apiSecret}:{}) }) });
    const input = section.querySelector('[data-ghimg-api-key]'); if (input) input.value='';
    const secretInput = section.querySelector('[data-ghimg-api-secret]'); if (secretInput) secretInput.value='';
    globalThis.toastr?.success?.('Greyhaven image provider saved.');
  } catch (error) {
    globalThis.toastr?.error?.(error?.message || String(error));
    providerStatus = { ok:false, configured:false, error:error?.message || String(error) };
  } finally {
    if (button) { button.disabled=false; button.textContent='Save Wiro Settings'; }
    updateProviderStatusDom();
  }
}

async function clearProviderKey() {
  if (!confirm('Remove the saved Wiro API key from the SillyTavern server?')) return;
  try {
    providerStatus = await pluginRequest('/config', { method:'POST', body:JSON.stringify({ clearApiKey:true, clearApiSecret:true, model:imageSettings().model }) });
    globalThis.toastr?.success?.('Wiro API key removed.');
  } catch (error) { globalThis.toastr?.error?.(error?.message || String(error)); }
  updateProviderStatusDom();
}

function updateGenerationStateDom(key) {
  const isPending = pending.has(key);
  const error = failed.get(key) || '';
  for (const button of document.querySelectorAll('.ghimg-generate[data-ghimg-key]')) {
    if (button.dataset.ghimgKey !== key) continue;
    button.disabled = isPending;
    button.innerHTML = isPending
      ? '<i class="fa-solid fa-spinner fa-spin"></i> Generating…'
      : '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate';
    const host = button.closest('[data-ghimg-key]') || button.parentElement;
    if (host) {
      host.classList.toggle('ghimg-pending', isPending);
      host.classList.toggle('ghimg-auto-pending', isPending && pendingReason.get(key)==='auto');
      host.querySelectorAll(':scope > .ghimg-error').forEach(node => node.remove());
      if (error && !isPending) {
        const small=document.createElement('small'); small.className='ghimg-error'; small.textContent=error; host.appendChild(small);
      }
    }
  }
  for (const button of document.querySelectorAll('.ghimg-tools-chip[data-ghimg-tools-key]')) {
    if (button.dataset.ghimgToolsKey !== key) continue;
    button.disabled=isPending;
    button.innerHTML=isPending?'<i class="fa-solid fa-spinner fa-spin"></i><span>AI</span>':'<i class="fa-solid fa-wand-magic-sparkles"></i><span>AI</span>';
  }
}


function descriptionFieldFor(item,target) {
  if (!target || typeof target !== 'object') return '';
  if (Object.prototype.hasOwnProperty.call(target,'mediaDescription')) return 'mediaDescription';
  if (Object.prototype.hasOwnProperty.call(target,'visual')) return 'visual';
  if (Object.prototype.hasOwnProperty.call(target,'description')) return 'description';
  return ['message','dm'].includes(item?.scope) ? 'mediaDescription' : 'visual';
}

function saveItemDescription(item,value) {
  const next = String(value || '').trim();
  if (!item || !next) throw new Error('Image metadata cannot be empty.');
  const target = item.getTarget?.();
  if (!target) throw new Error('This media item is no longer available. Refresh the phone and try again.');
  const field = descriptionFieldFor(item,target);
  target[field] = next;
  item.description = next;
  saveItemSource(item);
  for (const details of document.querySelectorAll('.ghimg-metadata-details[data-ghimg-meta-key]')) {
    if (details.dataset.ghimgMetaKey !== item.key) continue;
    const body=details.querySelector(':scope > div'); if (body) body.textContent=next;
  }
  invalidateRegistry();
  document.dispatchEvent(new CustomEvent('greyhaven:image-metadata-changed',{detail:{key:item.key,id:item.id,description:next}}));
  scheduleAugment();
  return next;
}

async function generateItem(item, reason='manual', options={}) {
  const force = options?.force === true;
  if (!item || (item.mediaKey && !force)) return item?.mediaKey || '';
  const oldMediaKey = item.mediaKey || '';
  try {
    if (!providerStatus?.configured) await refreshProviderStatus();
    if (!providerStatus?.configured) throw new Error('Wiro is not configured in Greyhaven Phone Settings.');

    const allIdentities = canonicalIdentities();
    const rawSender = item.senderIdentityId ? identityById(item.senderIdentityId) : identityByName(item.senderName);
    const sender = allIdentities.find(x => x.id === rawSender?.id) || allIdentities.find(x => lower(x.name) === lower(rawSender?.name || item.senderName)) || rawSender;
    const subjects = resolveImageSubjects({ description:item.description, sender, identities:allIdentities });
    const wardrobeLines = subjects.map(wardrobeLine).filter(Boolean);
    const maxRefs = Number(GHIMG_MODELS[imageSettings().model]?.maxReferences || MAX_WIRO_REFERENCES);
    const { payload:references, assignments } = await loadReferencePayload(subjects,maxRefs);
    const prompt = buildImagePrompt({ description:item.description, subjects, referenceAssignments:assignments, wardrobeLines, app:item.app, scope:item.scope, continuity:continuityForItem(item) });
    const s = imageSettings();
    const response = await pluginRequest('/generate', {
      method:'POST',
      body:JSON.stringify({ prompt, references, model:s.model, aspectRatio:aspectForItem(item), resolution:GHIMG_MODELS[s.model]?.resolution || '2k' }),
    });
    const bytes = atob(String(response.base64 || ''));
    const array = new Uint8Array(bytes.length);
    for (let i=0;i<bytes.length;i++) array[i]=bytes.charCodeAt(i);
    const blob = new Blob([array], { type:String(response.mime || 'image/jpeg') });
    const dimensions = await blobDimensions(blob);
    const mediaKey = await saveGeneratedBlob(blob,item);
    const target = item.getTarget?.();
    if (target) {
      target.mediaKey = mediaKey;
      target.mediaWidth = dimensions.width;
      target.mediaHeight = dimensions.height;
      saveItemSource(item);
    }
    propagateGeneratedState(item, mediaKey, dimensions.width, dimensions.height);
    item.mediaKey = mediaKey;
    if (force && oldMediaKey && oldMediaKey !== mediaKey) {
      try { await dbDelete(phoneMediaDb, PHONE_MEDIA_STORE, oldMediaKey); } catch {}
      const oldUrl = mediaKeyUrls.get(oldMediaKey); if (oldUrl) { URL.revokeObjectURL(oldUrl); mediaKeyUrls.delete(oldMediaKey); }
    }
    invalidateRegistry();

    const usage = s.usage;
    usage.images += 1;
    usage.totalCost += Math.max(0, Number(response.task?.totalCost || 0));
    usage.chargedCost += Math.max(0, Number(response.task?.chargedCost || 0));
    saveImageSettings();

    const url = URL.createObjectURL(blob);
    generatedUrls.set(item.key,url);
    renderGeneratedIntoDom(item.key,url,dimensions);
    if (reason === 'manual') globalThis.toastr?.success?.('Image generated.');
    return mediaKey;
  } catch (error) {
    console.error(`[${MODULE}] generate`, error);
    failed.set(item.key, error?.message || String(error));
    if (reason === 'manual') globalThis.toastr?.error?.(error?.message || String(error));
    return '';
  } finally {
    pending.delete(item.key); pendingReason.delete(item.key);
    updateGenerationStateDom(item.key);
  }
}

function queueGeneration(itemOrKey, reason='auto', options={}) {
  const item = typeof itemOrKey === 'string' ? registryItem(itemOrKey) : itemOrKey;
  if (!item || (item.mediaKey && !options?.force) || pending.has(item.key)) return generationQueue;
  pending.add(item.key);
  pendingReason.set(item.key,reason);
  failed.delete(item.key);
  updateGenerationStateDom(item.key);
  generationQueue = generationQueue.then(() => generateItem(item,reason,options)).catch(error => {
    console.error(`[${MODULE}] queue`,error);
    pending.delete(item.key); pendingReason.delete(item.key);
    failed.set(item.key,error?.message || String(error));
    updateGenerationStateDom(item.key);
  });
  return generationQueue;
}

function inferItemForNode(node,maps) {
  let holder = node;
  for (let i=0;i<5 && holder;i++,holder=holder.parentElement) {
    const msg = holder.querySelector?.('[data-link-media]');
    if (msg?.dataset.linkMedia) {
      const rows = maps.byId.get(msg.dataset.linkMedia) || [];
      const hit = rows.find(x => x.app === 'messages'); if (hit) return hit;
    }
    const appMsg = holder.querySelector?.('[data-app-link-message]');
    if (appMsg?.dataset.appLinkMessage) {
      const rows = maps.byId.get(appMsg.dataset.appLinkMessage) || [];
      const app = appMsg.dataset.appLinkMedia;
      const hit = rows.find(x => !app || x.app === app); if (hit) return hit;
    }
    const market = holder.querySelector?.('[data-market-message]');
    if (market?.dataset.marketMessage) {
      const rows = maps.byId.get(market.dataset.marketMessage) || [];
      const hit = rows.find(x => x.app === 'marketplace'); if (hit) return hit;
    }
    for (const attr of ['data-instagram-like','data-facebook-like','data-onlyfans-post','data-open-onlyfans-post','data-ghsocial-post']) {
      const el = holder.querySelector?.(`[${attr}]`);
      const id = el?.getAttribute(attr);
      if (id) { const rows=maps.byId.get(id)||[]; if(rows.length===1)return rows[0]; }
    }
  }

  const text = cleanText(node.querySelector?.('p')?.textContent || node.querySelector?.('span')?.textContent || node.textContent || '');
  const candidates = maps.byDescription.get(text) || [];
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    const context = cleanText(node.parentElement?.textContent || '');
    const named = candidates.filter(x => x.senderName && lower(context).includes(lower(x.senderName)));
    if (named.length === 1) return named[0];
  }
  return null;
}

function openMediaTools(item) {
  if (!item) return;
  let dialog = document.querySelector('#ghimg-media-tools-dialog');
  if (!dialog) {
    dialog=document.createElement('dialog');
    dialog.id='ghimg-media-tools-dialog';
    dialog.className='ghimg-dialog';
    document.body.appendChild(dialog);
  }
  const model = GHIMG_MODELS[imageSettings()?.model] || {};
  const action = item.mediaKey ? 'Regenerate image' : 'Generate image';
  dialog.innerHTML=`<div class="ghimg-dialog-card ghimg-tools-card"><header><div><b>AI Image Tools</b><small>${esc(item.app)} · ${esc(item.scope)}</small></div><button type="button" data-ghimg-tools-close><i class="fa-solid fa-xmark"></i></button></header><main><label class="ghimg-editor-label"><span><b>Image metadata</b><small>Edit what Seedream should actually render. This is saved back to the Greyhaven media item.</small></span><textarea data-ghimg-edit-description>${esc(item.description)}</textarea></label><div class="ghimg-tools-context"><b>Current model</b><span>${esc(model.label || imageSettings()?.model || '')}</span></div><div class="ghimg-inline-actions"><button type="button" data-ghimg-save-description class="primary"><i class="fa-solid fa-floppy-disk"></i> Save metadata</button><button type="button" data-ghimg-regenerate class="primary"><i class="fa-solid fa-rotate"></i> ${esc(action)}</button></div>${item.mediaKey?'<small class="ghimg-muted">Regenerate makes a new paid Wiro request and replaces the current generated preview only after the new image succeeds.</small>':'<small class="ghimg-muted">Tip: hold the Generate button any time to reopen these tools before spending a credit.</small>'}</main></div>`;
  const textarea=dialog.querySelector('[data-ghimg-edit-description]');
  dialog.querySelector('[data-ghimg-tools-close]').onclick=()=>dialog.close();
  dialog.querySelector('[data-ghimg-save-description]').onclick=()=>{
    try {
      saveItemDescription(item,textarea.value);
      globalThis.toastr?.success?.('Image metadata saved.');
      dialog.close();
    } catch (error) { globalThis.toastr?.error?.(error?.message || String(error)); }
  };
  dialog.querySelector('[data-ghimg-regenerate]').onclick=()=>{
    try { saveItemDescription(item,textarea.value); }
    catch (error) { globalThis.toastr?.error?.(error?.message || String(error)); return; }
    const force=!!item.mediaKey;
    if (force && !confirm('Generate a new paid image and replace the current one if it succeeds?')) return;
    dialog.close();
    queueGeneration(item,'manual',{force});
  };
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(()=>textarea?.focus?.());
}

function bindToolsHold(button,item) {
  let timer=null,start=null;
  const clear=()=>{if(timer)clearTimeout(timer);timer=null;start=null};
  button.addEventListener('pointerdown',event=>{
    if (event.button!==undefined && event.button!==0) return;
    clear();start={x:Number(event.clientX||0),y:Number(event.clientY||0)};
    timer=setTimeout(()=>{
      timer=null;
      button.dataset.ghimgHeld='1';
      try { navigator.vibrate?.(20); } catch {}
      openMediaTools(item);
    },560);
  });
  button.addEventListener('pointermove',event=>{
    if (!timer||!start) return;
    if (Math.hypot(Number(event.clientX||0)-start.x,Number(event.clientY||0)-start.y)>12) clear();
  });
  const finish=()=>{clear();setTimeout(()=>delete button.dataset.ghimgHeld,80)};
  button.addEventListener('pointerup',finish);button.addEventListener('pointercancel',finish);button.addEventListener('pointerleave',clear);
}

function addMetadataDetails(node,item) {
  if (!node || !item || node.querySelector?.('.ghimg-metadata-details')) return;
  const preview=node.querySelector?.(':scope > p') || node.querySelector?.('p');
  if (preview) preview.classList.add('ghimg-metadata-preview');
  const details=document.createElement('details');
  details.className='ghimg-metadata-details';
  details.dataset.ghimgMetaKey=item.key;
  details.innerHTML=`<summary><i class="fa-solid fa-circle-info"></i> Image metadata</summary><div>${esc(item.description)}</div>`;
  const button=node.querySelector?.('.ghimg-generate');
  if (button) node.insertBefore(details,button); else node.appendChild(details);
}

function manualButton(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghimg-generate';
  button.dataset.ghimgKey = item.key;
  button.title = 'Tap to generate · hold to edit metadata or retry';
  const isPending = pending.has(item.key);
  button.disabled = isPending;
  button.innerHTML = isPending
    ? '<i class="fa-solid fa-spinner fa-spin"></i> Generating…'
    : '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate';
  bindToolsHold(button,item);
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.ghimgHeld==='1' || pending.has(item.key)) return;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating…';
    queueGeneration(item,'manual');
  });
  return button;
}

function generatedToolsButton(item) {
  const button=document.createElement('button');
  button.type='button';button.className='ghimg-tools-chip';button.dataset.ghimgToolsKey=item.key;
  button.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i><span>AI</span>';
  button.title='AI image tools · edit metadata or regenerate';
  bindToolsHold(button,item);
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(button.dataset.ghimgHeld==='1')return;openMediaTools(item)});
  return button;
}

function inferGeneratedItemForContainer(container,maps) {
  const direct=inferItemForNode(container,maps);if(direct?.mediaKey)return direct;
  if (container.matches?.('.ghp-of-post')) {
    const caption=cleanText(container.querySelector(':scope > p')?.textContent || '');
    const candidates=maps.items.filter(x=>x.app==='onlyfans'&&x.scope==='post'&&x.mediaKey&&cleanText(x.caption)===caption);
    if(candidates.length===1)return candidates[0];
  }
  return null;
}

function augmentGeneratedTools(maps) {
  const containers=[...document.querySelectorAll('#ghp-overlay .ghp-msg.has-media,#ghp-overlay .ghp-feed article,#ghp-overlay .ghp-of-post,#ghsocial-profile-page .ghsocial-post-card')];
  for (const container of containers) {
    if (container.querySelector(':scope > .ghimg-tools-chip')) continue;
    const item=inferGeneratedItemForContainer(container,maps);
    if (!item?.mediaKey) continue;
    container.classList.add('ghimg-tools-host');
    container.appendChild(generatedToolsButton(item));
  }
}

function augmentMediaButtons(maps) {
  const overlay = document.querySelector('#ghp-overlay');
  if (!overlay || overlay.hidden) return;

  const nodes = [
    ...overlay.querySelectorAll('.ghp-media-visual:not(.has-local) .ghp-media-placeholder'),
    ...overlay.querySelectorAll('.ghp-fake-photo'),
    ...overlay.querySelectorAll('.ghp-photos > div:not(:has(img)):not(:has(video))'),
    ...document.querySelectorAll('#ghsocial-profile-page .ghp-fake-photo'),
  ];

  for (const node of nodes) {
    if (node.querySelector?.('.ghimg-generate')) continue;
    const item = inferItemForNode(node,maps);
    if (!item || item.mediaKey) continue;
    node.dataset.ghimgKey = item.key;
    const isPending = pending.has(item.key);
    node.classList.toggle('ghimg-pending',isPending);
    node.classList.toggle('ghimg-auto-pending',isPending && pendingReason.get(item.key)==='auto');
    node.appendChild(manualButton(item));
    addMetadataDetails(node,item);
    const error = failed.get(item.key);
    if (error) {
      const small = document.createElement('small'); small.className='ghimg-error'; small.textContent=error; node.appendChild(small);
    }
  }
  augmentGeneratedTools(maps);
}

function renderGeneratedIntoDom(key,url,{width,height}={}) {
  const nodes = [...document.querySelectorAll('[data-ghimg-key]')].filter(node => node.dataset.ghimgKey === key);
  for (const node of nodes) {
    if (node.classList.contains('ghp-media-placeholder')) {
      const wrap = node.closest('.ghp-media-visual');
      if (!wrap) continue;
      let img = wrap.querySelector('img[data-ghimg-generated]');
      if (!img) { img=document.createElement('img'); img.dataset.ghimgGenerated='1'; wrap.prepend(img); }
      img.src=url; if(width)img.width=width;if(height)img.height=height; wrap.classList.add('has-local'); node.style.display='none';
    } else if (node.classList.contains('ghp-fake-photo')) {
      const img=document.createElement('img');img.className='ghp-social-media';img.dataset.ghimgGenerated='1';img.src=url;if(width)img.width=width;if(height)img.height=height;node.replaceWith(img);
    } else {
      const img=document.createElement('img');img.dataset.ghimgGenerated='1';img.src=url;node.replaceChildren(img);
    }
  }
  scheduleAugment();
}

function appCandidates(app) {
  const timeline = globalThis.GreyhavenPhone?.getTimeline?.() || {};
  const map = new Map();
  const add = identity => { if (identity?.id && identity.id !== currentIdentity()?.id) map.set(identity.id,identity); };

  if (app === 'messages') {
    for (const co of Object.values(timeline.contacts || {})) add(identityById(co.identityId) || identityByName(co.name));
  } else {
    for (const [id,reln] of Object.entries(timeline.relationships || {})) {
      const state = reln?.apps?.[app];
      if (!state) continue;
      const relevant = app === 'snapchat' ? state.friends : app === 'facebook' ? state.friends : app === 'instagram' ? (state.following || state.followedBy || state.incomingRequest || state.outgoingRequest) : false;
      if (relevant) add(identityById(id));
    }
    for (const th of Object.values(timeline?.[app]?.threads || {})) add(identityById(th.identityId) || identityByName(th.peerName));
  }

  // Keep previously enabled identities visible even if the relationship later
  // changes (unfriended, unfollowed, old thread removed). Otherwise the user
  // would have no way to turn an existing paid-generation rule back off.
  const ownerId = currentIdentity()?.id || '';
  const enabled = imageSettings()?.autoByPhone?.[ownerId]?.[app] || {};
  for (const identityId of Object.keys(enabled)) add(identityById(identityId));

  return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
}

function installedAutoApps() {
  const profile = globalThis.GreyhavenPhone?.getProfile?.() || {};
  return AUTO_APPS.filter(app => profile.apps?.[app] !== false);
}

function settingsSectionHtml() {
  const owner = currentIdentity();
  const s = imageSettings();
  const usage = s.usage;
  const apps = installedAutoApps();
  const appLabels = {messages:'Messages',snapchat:'Snapchat',instagram:'Instagram',facebook:'Facebook'};
  const auto = owner ? autoRulesFor(owner.id) : {};
  return `<section id="ghimg-settings-section">
    <h3><i class="fa-solid fa-wand-magic-sparkles"></i> AI Images</h3>
    <div data-ghimg-provider-status class="ghimg-provider-status"><i class="fa-solid fa-spinner fa-spin"></i><span><b>Checking image relay…</b></span></div>
    <label class="stack"><span><b>Wiro model</b><small>OpenRouter remains your text API. This model is used only for Greyhaven images.</small></span>
      <select data-ghimg-model>${Object.entries(GHIMG_MODELS).map(([id,m])=>`<option value="${esc(id)}" ${s.model===id?'selected':''}>${esc(m.label)}</option>`).join('')}</select>
    </label>
    <label class="stack"><span><b>Wiro API key</b><small>Your Wiro project key. It is saved only on the SillyTavern server.</small></span><input data-ghimg-api-key type="password" autocomplete="off" placeholder="Paste a new Wiro key"></label>
    <label class="stack"><span><b>Wiro API secret <em>(if your project uses Signature Based auth)</em></b><small>If Wiro gave you a secret, paste it here. Leave blank only for an API Key Only project.</small></span><input data-ghimg-api-secret type="password" autocomplete="off" placeholder="Paste Wiro secret (optional for key-only projects)"></label>
    <div class="ghimg-inline-actions"><button type="button" class="primary" data-ghimg-save-provider>Save Wiro Settings</button><button type="button" data-ghimg-clear-provider>Remove Credentials</button></div>
    <div class="ghimg-usage"><span><b>${usage.images}</b><small>generated</small></span><span><b>${usage.totalCost?`$${usage.totalCost.toFixed(3)}`:'—'}</b><small>Wiro reported cost</small></span></div>
    <button type="button" class="ghimg-wide" data-ghimg-open-references><i class="fa-regular fa-images"></i><span><b>Character Reference Packs</b><small>Manage every character from any phone.</small></span><i class="fa-solid fa-chevron-right"></i></button>
    <div class="ghimg-auto"><h4>Automatic generation · ${esc(owner?.name || 'this phone')}</h4><p>All switches start OFF. Automatic image checks run only when Refresh Phone finishes. New direct photo messages can generate automatically; opening apps, scrolling, feed posts, stories, listings and old photos never trigger paid generation scans.</p>
      ${apps.map(app=>`<details><summary><span><i class="${app==='messages'?'fa-solid fa-comment':app==='snapchat'?'fa-brands fa-snapchat':app==='instagram'?'fa-brands fa-instagram':'fa-brands fa-facebook-f'}"></i> ${appLabels[app]}</span><small>${appCandidates(app).filter(x=>auto?.[app]?.[x.id]).length} enabled</small></summary><div>${appCandidates(app).map(identity=>`<label class="ghimg-auto-row"><span>${avatarHtml(identity)}<b>${esc(identity.name)}</b></span><input type="checkbox" data-ghimg-auto-app="${esc(app)}" data-ghimg-auto-identity="${esc(identity.id)}" ${auto?.[app]?.[identity.id]?'checked':''}></label>`).join('')||'<small class="ghimg-muted">No eligible contacts/friends in this app yet.</small>'}</div></details>`).join('')}
      <div class="ghimg-manual-note"><i class="fa-solid fa-hand-pointer"></i><span><b>Manual by design</b><small>OnlyFans, Marketplace, Dark Web, Garage / Properties / Booking / Events media never spend credits automatically. Use Generate on the exact image you want.</small></span></div>
    </div>
  </section>`;
}

function avatarHtml(identity) {
  const url = identityAvatarUrl(identity);
  return url ? `<img class="ghimg-mini-avatar" src="${esc(url)}" alt="">` : `<span class="ghimg-mini-avatar fallback">${esc(cleanText(identity?.name).slice(0,1).toUpperCase())}</span>`;
}

function injectSettingsSection() {
  const settings = document.querySelector('#ghp-overlay .ghp-settings');
  if (!settings || settings.querySelector('#ghimg-settings-section')) return;
  const timelineSection = [...settings.querySelectorAll(':scope > section')].find(section => /Timeline/i.test(section.querySelector('h3')?.textContent || ''));
  const holder = document.createElement('div'); holder.innerHTML=settingsSectionHtml(); const section=holder.firstElementChild;
  if (timelineSection) timelineSection.before(section); else settings.querySelector('.ghp-save')?.before(section);
  refreshProviderStatus();
}

function renderReferenceManager(dialog,selectedId='') {
  const all = canonicalIdentities().filter(x => x.kind !== 'provisional').sort((a,b)=>a.name.localeCompare(b.name));
  if (!selectedId) {
    dialog.innerHTML = `<div class="ghimg-dialog-card"><header><div><b>Character Reference Packs</b><small>Global across every Greyhaven phone.</small></div><button type="button" data-ghimg-dialog-close><i class="fa-solid fa-xmark"></i></button></header><input class="ghimg-search" data-ghimg-ref-search placeholder="Search characters"><main class="ghimg-character-list">${all.map(identity=>`<button type="button" class="ghimg-character-row" data-ghimg-open-pack="${esc(identity.id)}">${avatarHtml(identity)}<span><b>${esc(identity.name)}</b><small>${referencePack(identity.id).length} reference${referencePack(identity.id).length===1?'':'s'}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join('')}</main></div>`;
  } else {
    const identity = identityById(selectedId); if (!identity) return renderReferenceManager(dialog,'');
    const pack = referencePack(selectedId);
    dialog.innerHTML = `<div class="ghimg-dialog-card"><header><button type="button" data-ghimg-back-references><i class="fa-solid fa-chevron-left"></i></button><div><b>${esc(identity.name)}</b><small>Reference Pack · ${pack.length}/${MAX_PACK_REFS}</small></div><button type="button" data-ghimg-dialog-close><i class="fa-solid fa-xmark"></i></button></header><main><div class="ghimg-ref-hero">${avatarHtml(identity)}<span><b>${esc(identity.name)}</b><small>These images can be used anywhere this character appears, even outside the current group/chat.</small></span></div><div class="ghimg-ref-grid">${pack.map(ref=>`<div class="ghimg-ref-card ${ref.primary?'primary':''}"><img data-ghimg-ref-db="${esc(ref.dbKey)}" alt="Reference"><button type="button" data-ghimg-primary-ref="${esc(ref.id)}" data-ghimg-ref-owner="${esc(identity.id)}" title="Use as primary"><i class="${ref.primary?'fa-solid':'fa-regular'} fa-star"></i></button><button type="button" data-ghimg-remove-ref="${esc(ref.id)}" data-ghimg-ref-owner="${esc(identity.id)}" title="Remove"><i class="fa-solid fa-trash"></i></button></div>`).join('')||'<div class="ghimg-ref-empty"><i class="fa-regular fa-images"></i><b>No custom references yet</b><span>The character avatar will be used as a fallback until you add some.</span></div>'}</div><div class="ghimg-ref-status" data-ghimg-ref-status hidden></div><input type="file" accept="image/*,.heic,.heif" multiple hidden data-ghimg-ref-input data-ghimg-ref-owner="${esc(identity.id)}"><button type="button" class="ghimg-wide primary" data-ghimg-add-ref="${esc(identity.id)}" ${pack.length>=MAX_PACK_REFS?'disabled':''}><i class="fa-solid fa-plus"></i><span><b>Add reference images</b><small>Up to ${MAX_PACK_REFS} per character. Duplicate images are ignored.</small></span></button></main></div>`;
    hydrateReferenceImages(dialog);
  }
}

function openReferenceManager() {
  let dialog = document.querySelector('#ghimg-reference-dialog');
  if (!dialog) { dialog=document.createElement('dialog');dialog.id='ghimg-reference-dialog';dialog.className='ghimg-dialog';document.body.appendChild(dialog); }
  renderReferenceManager(dialog,'');
  if (!dialog.open) dialog.showModal();
}

function filterReferenceList(dialog,query) {
  const q = lower(query);
  for (const row of dialog.querySelectorAll('.ghimg-character-row')) row.hidden = q && !lower(row.textContent).includes(q);
}

function autoRowChange(input) {
  const owner = currentIdentity(); if (!owner) return;
  setAutoRule(owner.id,input.dataset.ghimgAutoApp,input.dataset.ghimgAutoIdentity,input.checked);
  const details = input.closest('details');
  const count = details?.querySelectorAll('input[type=checkbox]:checked').length || 0;
  const small = details?.querySelector('summary small'); if (small) small.textContent=`${count} enabled`;
}

function installPromptDetailHook() {
  const st = globalThis.SillyTavern;
  if (!st || typeof st.getContext !== 'function' || st.getContext.__ghimgDetailHook) return;
  const originalGetContext = st.getContext.bind(st);
  const instruction = `\n\n[Greyhaven image metadata rule]\nFor any Greyhaven Phone photo/post/message, produce a short photographic description (normally 25–55 words, 1–3 concise sentences), prioritizing WHO is in the photo, their visible pose/action, expression/mood, what part of the person is in frame, and a simple credible setting. State the exact established character name. Clearly choose ONE camera mode for each image: (A) unedited raw front-facing phone selfie (default for casual self-sent direct photos), (B) front-facing phone selfie with a specific Snapchat/AR filter and EXACT description of its visible effects, only when a filter is intentionally chosen, (C) unedited rear/back camera phone photo taken by another person, or (D) professional camera photograph, only when context justifies it. Mirror selfies are fine when the scene suggests one. State believable lighting/time in a few words; identify the relevant room or place with at most one unobtrusive backdrop cue. The PERSON, not the architecture or view, is always the subject. Never invent city skylines, skyscrapers, oversized windows, ornate décor, or extraneous scene props. Prefer candid composition, real phone image flaws and unretouched skin. No arbitrary accessory or jewelry mentions. Clothing should match the established RP/Wardrobe, never be guessed when unknown; Wardrobe is authoritative. No extraneous people, internal thoughts or secrets. Preserve already-established exact camera filters, garments and objects if they matter to the scene.`;
  const wrapGenerate = context => {
    if (!context || typeof context.generateRaw !== 'function' || context.generateRaw.__ghimgDetailWrapped) return context;
    const originalGenerate = context.generateRaw.bind(context);
    const wrappedGenerate = async options => {
      if (!options || typeof options !== 'object') return originalGenerate(options);
      const system = String(options.systemPrompt || '');
      const phoneTask = /Greyhaven|Marketplace|OnlyFans|Snapchat|Instagram|Facebook|phone refresh|roleplay phone/i.test(system);
      let nextSystem = system;
      if (phoneTask && !nextSystem.includes('[Greyhaven image metadata rule]')) nextSystem += instruction;
      const onlyFansTask = /adults-only creator platform|one manual content refresh for a fictional|one dedicated OnlyFans refresh/i.test(system);
      if (onlyFansTask) {
        const root = phoneSettingsRoot();
        if (root) {
          root.socialStudio ||= {};
          // Capture the untouched built-in prompt, not a previously injected one.
          if (root.socialStudio.lastOnlyFansSystemPrompt !== system) {
            root.socialStudio.lastOnlyFansSystemPrompt = system;
            try { ctx()?.saveSettingsDebounced?.(); } catch {}
          }
          // This is a FULL prompt override, not appended weak guidance.
          const override = String(root.socialStudio.onlyFansFullPrompt || '').trim();
          if (override) nextSystem = override;
          // The photo metadata contract still applies after a full override.
          if (!nextSystem.includes('[Greyhaven image metadata rule]')) nextSystem += instruction;
        }
      }
      if (nextSystem === system) return originalGenerate(options);
      return originalGenerate({ ...options, systemPrompt:nextSystem });
    };
    Object.defineProperty(wrappedGenerate,'__ghimgDetailWrapped',{value:true});
    try { context.generateRaw = wrappedGenerate; } catch {}
    return context;
  };
  const wrappedGetContext = (...args) => wrapGenerate(originalGetContext(...args));
  Object.defineProperty(wrappedGetContext,'__ghimgDetailHook',{value:true});
  Object.defineProperty(wrappedGetContext,'__ghimgOriginal',{value:originalGetContext});
  try { st.getContext = wrappedGetContext; }
  catch (error) { console.warn(`[${MODULE}] getContext hook unavailable`,error); }
}
function augmentPhoneDom() {
  if (!phoneIsOpen()) return;
  maybeProcessPhoneRefresh();
  injectSettingsSection();
  const maps = registryMaps(false);
  augmentMediaButtons(maps);
}

function bindDomEvents() {
  document.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target : null; if (!target) return;
    if (target.closest('[data-ghimg-save-provider]')) { event.preventDefault();await saveProviderConfig();return; }
    if (target.closest('[data-ghimg-clear-provider]')) { event.preventDefault();await clearProviderKey();return; }
    if (target.closest('[data-ghimg-open-references]')) { event.preventDefault();openReferenceManager();return; }
    const close = target.closest('[data-ghimg-dialog-close]'); if (close) { close.closest('dialog')?.close();return; }
    const back = target.closest('[data-ghimg-back-references]'); if (back) { renderReferenceManager(back.closest('dialog'),'');return; }
    const openPack = target.closest('[data-ghimg-open-pack]'); if (openPack) { renderReferenceManager(openPack.closest('dialog'),openPack.dataset.ghimgOpenPack);return; }
    const addRef = target.closest('[data-ghimg-add-ref]'); if (addRef) {
      const input=addRef.closest('dialog')?.querySelector('[data-ghimg-ref-input]');
      if (input) {
        input.value='';
        try { if (typeof input.showPicker === 'function') input.showPicker(); else input.click(); }
        catch { input.click(); }
      }
      return;
    }
    const remove = target.closest('[data-ghimg-remove-ref]'); if (remove) { const d=remove.closest('dialog');await removeReference(remove.dataset.ghimgRefOwner,remove.dataset.ghimgRemoveRef);renderReferenceManager(d,remove.dataset.ghimgRefOwner);return; }
    const primary = target.closest('[data-ghimg-primary-ref]'); if (primary) { const d=primary.closest('dialog');setPrimaryReference(primary.dataset.ghimgRefOwner,primary.dataset.ghimgPrimaryRef);renderReferenceManager(d,primary.dataset.ghimgRefOwner);return; }
  }, true);

  document.addEventListener('change', async event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
    if (input.matches('[data-ghimg-auto-app]')) { autoRowChange(input); return; }
    if (input.matches('[data-ghimg-model]')) { const s=imageSettings();s.model=GHIMG_MODELS[input.value]?input.value:DEFAULT_IMAGE_MODEL;saveImageSettings();return; }
    if (input.matches('[data-ghimg-ref-input]')) {
      const ownerId=input.dataset.ghimgRefOwner,d=input.closest('dialog');
      const files=[...(input.files || [])];
      input.value='';
      if (!files.length) return;
      const button=d?.querySelector('[data-ghimg-add-ref]');
      const status=d?.querySelector('[data-ghimg-ref-status]');
      if (button) button.disabled=true;
      if (status) { status.hidden=false; status.className='ghimg-ref-status busy'; status.textContent=`Processing ${files.length} image${files.length===1?'':'s'}…`; }
      try {
        const result=await addReferences(ownerId,files);
        renderReferenceManager(d,ownerId);
        const nextStatus=d?.querySelector('[data-ghimg-ref-status]');
        if (nextStatus && (result.errors.length || result.duplicates)) {
          nextStatus.hidden=false;
          nextStatus.className=`ghimg-ref-status ${result.errors.length?'bad':'good'}`;
          nextStatus.textContent=[result.added?`${result.added} added.`:'',result.duplicates?`${result.duplicates} duplicate${result.duplicates===1?'':'s'} skipped.`:'',...result.errors].filter(Boolean).join(' ');
        } else if (result.added) {
          globalThis.toastr?.success?.(`${result.added} reference image${result.added===1?'':'s'} added.`);
        }
      } catch (error) {
        console.warn(`[${MODULE}] reference upload`, error);
        if (status) { status.hidden=false; status.className='ghimg-ref-status bad'; status.textContent=error?.message || String(error); }
      } finally {
        if (button?.isConnected) button.disabled=false;
      }
      return;
    }
  }, true);

  document.addEventListener('input', event => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.matches('[data-ghimg-ref-search]')) filterReferenceList(input.closest('dialog'),input.value);
  }, true);
}

function scheduleAugment() {
  if (augmentQueued) return;
  augmentQueued = true;
  requestAnimationFrame(() => {
    augmentQueued = false;
    if (phoneIsOpen()) augmentPhoneDom();
  });
}

function mutationTouchesPhone(mutation) {
  const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
  if (target?.closest?.('#ghp-overlay')) return true;
  for (const node of mutation.addedNodes || []) {
    if (!(node instanceof Element)) continue;
    if (node.id === 'ghp-overlay' || node.closest?.('#ghp-overlay') || node.querySelector?.('#ghp-overlay')) return true;
  }
  return false;
}

function observePhoneUi() {
  if (uiObserver) return;
  uiObserver = new MutationObserver(mutations => {
    if (!mutations.some(mutationTouchesPhone)) return;
    scheduleAugment();
  });
  uiObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
}

function bindSillyTavernEvents() {
  const c = ctx();
  if (!c?.eventSource || !c?.eventTypes) return;
  const bind = key => { const name=c.eventTypes[key];if(name)c.eventSource.on(name,()=>{installPromptDetailHook();invalidateRegistry();scheduleAugment()}); };
  for (const key of ['CHAT_CHANGED','CHAT_CREATED','PERSONA_CHANGED','CHARACTER_MESSAGE_RENDERED','MESSAGE_SENT','MESSAGE_EDITED','GROUP_UPDATED','CHARACTER_EDITED']) bind(key);
}

function exposeApi() {
  globalThis.GreyhavenPhoneImages = {
    version:VERSION,
    openReferenceManager,
    getSettings:()=>clone(imageSettings()),
    getReferencePack:identityId=>clone(referencePack(identityId)),
    generateMedia:key=>queueGeneration(key,'manual'),
    regenerateMedia:key=>queueGeneration(key,'manual',{force:true}),
    getMediaUrl:mediaKey=>mediaUrlForKey(mediaKey),
    openMediaTools:key=>{const item=registryItem(key);if(item)openMediaTools(item);return !!item;},
    invalidate:()=>{invalidateRegistry();scheduleAugment();},
    refreshUi:()=>scheduleAugment(),
    listCurrentMedia:()=>clone(currentMediaRegistry().map(({getTarget,row,...x})=>x)),
    getMediaMetadata:key=>{
      const item=currentMediaRegistry().find(x=>x.key===key);
      return item ? clone({key:item.key,app:item.app,scope:item.scope,description:item.description,caption:item.caption,senderName:item.senderName,mediaKey:item.mediaKey}) : null;
    },
    refreshProviderStatus,
  };
}

async function waitReady(timeout=15000) {
  const started=Date.now();
  while(Date.now()-started<timeout) {
    if (ctx()?.extensionSettings && document.body && hasPhone()) return true;
    await sleep(100);
  }
  return false;
}

async function init() {
  if (initialized) return;
  if (!await waitReady()) { console.warn(`[${MODULE}] Greyhaven Phone was not ready in time.`); return; }
  imageSettings();
  bindDomEvents();
  observePhoneUi();
  bindSillyTavernEvents();
  document.addEventListener('greyhaven:social-changed',()=>{invalidateRegistry();scheduleAugment()});
  installPromptDetailHook();
  exposeApi();
  // No polling. Greyhaven Phone data only needs an image-generation scan when
  // its own Refresh Phone cycle changes timeline.refresh.lastAt. Normal app
  // navigation only re-decorates the visible DOM using the cached registry.
  scheduleAugment();
  initialized=true;
  console.info(`[${MODULE}] v${VERSION} loaded`);
}

void init().catch(error=>console.error(`[${MODULE}] boot`,error));
