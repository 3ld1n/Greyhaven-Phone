const MODULE = 'greyhaven-phone-socialstudio';
const VERSION = '1.1.0';
const SETTINGS_KEY = 'greyhavenPhone';
const META_KEY = 'greyhavenPhone';

let initialized = false;
let observer = null;
let augmentQueued = false;
let syncQueued = false;
let lastScreenSignature = '';

const ctx = () => {
  try { return globalThis.SillyTavern?.getContext?.() || null; }
  catch { return null; }
};
const clone = value => {
  if (value === undefined) return undefined;
  try { return structuredClone(value); }
  catch { return JSON.parse(JSON.stringify(value)); }
};
const uid = () => {
  try { return crypto.randomUUID(); }
  catch { return `ghsocial-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
};
const clean = value => String(value ?? '').trim().replace(/\s+/g,' ');
const lower = value => clean(value).toLowerCase();
const esc = value => String(value ?? '')
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#039;');

function phoneOpen() {
  const overlay=document.querySelector('#ghp-overlay');
  return !!overlay && !overlay.hidden;
}
function currentIdentity() { return globalThis.GreyhavenPhone?.getCurrentIdentity?.() || null; }
function identities() {
  const rows=globalThis.GreyhavenPhone?.listIdentities?.() || [];
  return Array.isArray(rows)?rows:[];
}
function identityById(id) {
  if (!id) return null;
  return globalThis.GreyhavenPhone?.getIdentityById?.(id) || identities().find(x=>String(x?.id)===String(id)) || null;
}
function identityByName(name) {
  if (!name) return null;
  return globalThis.GreyhavenPhone?.getIdentityByName?.(name) || identities().find(x=>lower(x?.name)===lower(name)) || null;
}
function settingsRoot() {
  const c=ctx();
  if (!c?.extensionSettings) return null;
  c.extensionSettings[SETTINGS_KEY] ||= {};
  const root=c.extensionSettings[SETTINGS_KEY];
  root.socialStudio ||= {};
  root.socialStudio.onlyFansFullPrompt = String(root.socialStudio.onlyFansFullPrompt || '');
  root.socialStudio.onlyFansCreatorPrompt = String(root.socialStudio.onlyFansCreatorPrompt || '');
  root.socialStudio.lastOnlyFansSystemPrompt = String(root.socialStudio.lastOnlyFansSystemPrompt || '');
  root.socialStudio.deletedPostIds = Array.isArray(root.socialStudio.deletedPostIds) ? root.socialStudio.deletedPostIds : [];
  root.socialStudioProfiles = root.socialStudioProfiles && typeof root.socialStudioProfiles==='object' && !Array.isArray(root.socialStudioProfiles) ? root.socialStudioProfiles : {};
  return root;
}
// Fallback only until a refresh captures the actual source prompt from Greyhaven Phone.
// Reset always returns to the CURRENT built-in source prompt if it has been captured.
const DEFAULT_ONLYFANS_MAIN_PROMPT = `You generate ONE manual OnlyFans content refresh for a fictional Greyhaven roleplay phone. Return ONLY valid JSON, no markdown or commentary.
Use only the ASSIGNED 18+ creators supplied in the user prompt. Never invent a creator, identity ID or surname. Match each creator's established personality, current situation, aesthetic and prior posts; vary camera mode, poses, wardrobe, background and tone organically. New posts may be bolder or ordinary as appropriate to that creator; do not make every image an innocent mirror selfie. Give each image a compact photographic description: exact creator name, expression, action, frame, and one chosen camera mode (raw front-facing phone selfie; explicitly described Snapchat-style filter; rear-camera phone snapshot; or justified professional photo), with only a short plausible location/lighting cue. Do not embellish rooms or invent accessories.
Return {"summary":"short text","posts":[{"creatorIdentityId":"exact supplied ID","creator":"exact supplied name","type":"photo","visual":"clear, concise image metadata","caption":"short in-character caption","likes":0,"comments":0}]}.
Create 1–4 plausible new posts total from the supplied creator roster. Keep output compatible with Greyhaven Phone's JSON post parser. No minors, coercion or non-consensual content.`;
function looksLikeOnlyFansPrompt(value) {
  const text = String(value || '').trim();
  return /creatorIdentityId/.test(text) && /\"posts\"/.test(text);
}
function onlyFansDefaultPrompt() {
  const captured = String(settingsRoot()?.socialStudio?.lastOnlyFansSystemPrompt || '').trim();
  return looksLikeOnlyFansPrompt(captured) ? captured : DEFAULT_ONLYFANS_MAIN_PROMPT;
}
function onlyFansSavedPrompt() {
  const root = settingsRoot();
  const saved = String(root?.socialStudio?.onlyFansCreatorPrompt || root?.socialStudio?.onlyFansFullPrompt || '').trim();
  return looksLikeOnlyFansPrompt(saved) ? saved : '';
}
function saveSettings() {
  try { ctx()?.saveSettingsDebounced?.(); }
  catch (error) { console.warn(`[${MODULE}] save settings`,error); }
}
function profileFor(identityId,create=true) {
  const root=settingsRoot();
  if (!root || !identityId) return null;
  let profile=root.socialStudioProfiles[identityId];
  if (!profile && !create) return null;
  if (!profile) profile={identityId,createdAt:Date.now(),updatedAt:Date.now(),instagram:{posts:[]},facebook:{posts:[]}};
  profile.identityId=identityId;
  profile.updatedAt=Math.max(0,Number(profile.updatedAt||Date.now()));
  for (const app of ['instagram','facebook']) {
    profile[app]=profile[app]&&typeof profile[app]==='object'?profile[app]:{};
    profile[app].posts=Array.isArray(profile[app].posts)?profile[app].posts:[];
  }
  root.socialStudioProfiles[identityId]=profile;
  return profile;
}
function deletedIds() { return new Set(settingsRoot()?.socialStudio?.deletedPostIds || []); }
function addDeletedId(id) {
  if (!id) return;
  const root=settingsRoot(); if (!root) return;
  const list=new Set(root.socialStudio.deletedPostIds || []);list.add(id);
  root.socialStudio.deletedPostIds=[...list].slice(-500);saveSettings();
}
function normalizePost(row,app,identity) {
  const source=row&&typeof row==='object'?row:{};
  const out={...clone(source)};
  out.id=String(out.id||`ghsocial:${uid()}`);
  out.identityId=String(identity?.id||out.identityId||'');
  out.author=clean(identity?.name||out.author||'Unknown');
  out.type=out.type==='video'?'video':'photo';
  out.visual=String(out.visual||out.mediaDescription||'').trim();
  if (app==='instagram') out.caption=String(out.caption||out.text||'').trim();
  else out.text=String(out.text||out.caption||'').trim();
  out.likes=Math.max(0,Number(out.likes||0));
  out.comments=Array.isArray(out.comments)?out.comments:[];
  out.likedBy=Array.isArray(out.likedBy)?out.likedBy:[];
  out.timeMs=Math.max(1,Number(out.timeMs||Date.now()));
  out.ghGlobalSocial=true;
  return out;
}
function mergePost(existing,incoming,app,identity) {
  const next=normalizePost({...existing,...incoming},app,identity);
  if (existing?.mediaKey && !incoming?.mediaKey) next.mediaKey=existing.mediaKey;
  if (existing?.mediaWidth && !incoming?.mediaWidth) next.mediaWidth=existing.mediaWidth;
  if (existing?.mediaHeight && !incoming?.mediaHeight) next.mediaHeight=existing.mediaHeight;
  return next;
}

function timelineRef() {
  const c=ctx(),root=c?.chatMetadata?.[META_KEY],owner=currentIdentity();
  if (!root?.phones || !owner) return null;
  const canonical=`phone-id:${encodeURIComponent(owner.id)}`;
  if(root.phones[canonical])return{root,key:canonical,timeline:root.phones[canonical],owner};
  for (const [key,t] of Object.entries(root.phones)) {
    if (String(t?.identityId||'')===String(owner.id)) return {root,key,timeline:t,owner};
  }
  return null;
}
function saveMetadata(root) {
  const c=ctx(); if (!root||!c?.chatMetadata) return;
  c.chatMetadata[META_KEY]=root;
  try {
    c.updateChatMetadata?.({[META_KEY]:root});
    if (typeof c.saveMetadataDebounced==='function') c.saveMetadataDebounced(); else c.saveMetadata?.();
  } catch (error) { console.warn(`[${MODULE}] save metadata`,error); }
}

function collectCurrentPostsIntoGlobal() {
  const root=settingsRoot(),t=globalThis.GreyhavenPhone?.getTimeline?.();
  if (!root||!t) return false;
  const tomb=deletedIds();
  let changed=false;
  for (const app of ['instagram','facebook']) {
    for (const raw of t?.[app]?.posts || []) {
      if (!raw?.id || tomb.has(String(raw.id))) continue;
      const identity=identityById(raw.identityId)||identityByName(raw.author);
      if (!identity?.id || identity.kind==='provisional') continue;
      const profile=profileFor(identity.id,true),posts=profile[app].posts;
      const index=posts.findIndex(x=>String(x.id)===String(raw.id));
      if (index<0) { posts.push(normalizePost(raw,app,identity)); changed=true; }
      else {
        const merged=mergePost(posts[index],raw,app,identity);
        if (JSON.stringify(merged)!==JSON.stringify(posts[index])) { posts[index]=merged;changed=true; }
      }
      profile.updatedAt=Date.now();
    }
  }
  if (changed) saveSettings();
  return changed;
}

function allowedGlobalIdentityIds(t,app,owner) {
  const ids=new Set(owner?.id?[String(owner.id)]:[]);
  for (const [identityId,reln] of Object.entries(t?.relationships||{})) {
    const state=reln?.apps?.[app];
    if (app==='instagram' && state?.following) ids.add(identityId);
    if (app==='facebook' && state?.friends) ids.add(identityId);
  }
  return ids;
}
function syncGlobalIntoCurrentTimeline() {
  const rootSettings=settingsRoot(),box=timelineRef();
  if (!rootSettings||!box) return false;
  const tomb=deletedIds();let changed=false;
  for (const app of ['instagram','facebook']) {
    const store=box.timeline[app];if(!store)continue;
    store.posts=Array.isArray(store.posts)?store.posts:[];
    const before=store.posts.length;
    store.posts=store.posts.filter(row=>!tomb.has(String(row?.id||'')));
    if (store.posts.length!==before) changed=true;
    const allowed=allowedGlobalIdentityIds(box.timeline,app,box.owner);
    const global=[];
    for (const identityId of allowed) {
      const profile=rootSettings.socialStudioProfiles?.[identityId];
      for (const raw of profile?.[app]?.posts||[]) if(!tomb.has(String(raw.id))) global.push(raw);
    }
    for (const raw of global) {
      const identity=identityById(raw.identityId)||identityByName(raw.author);if(!identity)continue;
      const index=store.posts.findIndex(x=>String(x.id)===String(raw.id));
      const row=normalizePost(raw,app,identity);
      if(index<0){store.posts.push(row);changed=true;}
      else {const merged=mergePost(store.posts[index],row,app,identity);if(JSON.stringify(merged)!==JSON.stringify(store.posts[index])){store.posts[index]=merged;changed=true;}}
    }
    store.posts.sort((a,b)=>Number(b?.timeMs||0)-Number(a?.timeMs||0));
    if(store.posts.length>100){store.posts=store.posts.slice(0,100);changed=true;}
  }
  if(changed){box.root.phones[box.key]=box.timeline;saveMetadata(box.root);document.dispatchEvent(new CustomEvent('greyhaven:social-changed'));}
  return changed;
}
function syncNow() {
  const collected=collectCurrentPostsIntoGlobal();
  const injected=syncGlobalIntoCurrentTimeline();
  return collected||injected;
}

function avatarUrl(identity) {
  if (!identity) return '';
  if (identity.avatar) return String(identity.avatar);
  const c=ctx();const ch=(c?.characters||[]).find(x=>lower(x?.name)===lower(identity.name));const avatar=ch?.avatar||ch?.data?.avatar||'';
  if(!avatar)return'';try{return c?.getThumbnailUrl?.('avatar',avatar)||avatar}catch{return avatar}
}
function avatarHtml(identity,cls='') {
  const url=avatarUrl(identity);const name=clean(identity?.name||'?');
  return url?`<span class="ghsocial-avatar ${esc(cls)}"><img src="${esc(url)}" alt=""></span>`:`<span class="ghsocial-avatar fallback ${esc(cls)}">${esc(name.slice(0,1).toUpperCase())}</span>`;
}
function rel(ms) {
  const d=Math.max(0,Date.now()-Number(ms||0)),m=Math.round(d/60000);if(m<1)return'now';if(m<60)return`${m}m`;const h=Math.round(m/60);if(h<24)return`${h}h`;return`${Math.round(h/24)}d`;
}

async function hydrateProfileMedia(dialog) {
  const api=globalThis.GreyhavenPhoneImages;if(!api?.getMediaUrl)return;
  for(const img of dialog.querySelectorAll('[data-ghsocial-media-key]')){
    const key=img.dataset.ghsocialMediaKey;if(!key||img.dataset.loaded==='1')continue;
    const url=await api.getMediaUrl(key).catch(()=> '');if(url){img.src=url;img.dataset.loaded='1';}
  }
}
function profilePostCard(row,app,mine) {
  const media=row.mediaKey
    ? `<img class="ghp-social-media ghsocial-media" data-ghsocial-media-key="${esc(row.mediaKey)}" alt="${esc(row.visual||'Post image')}">`
    : row.visual
      ? `<div class="ghp-fake-photo"><i class="fa-regular fa-image"></i><p>${esc(row.visual)}</p></div>`
      : '';
  const copy=app==='instagram'?row.caption:row.text;
  return `<article class="ghsocial-post-card" data-ghsocial-app="${esc(app)}"><span hidden data-ghsocial-post="${esc(row.id)}"></span>${media}<div class="ghsocial-post-copy"><small>${esc(rel(row.timeMs))}</small>${copy?`<p>${esc(copy)}</p>`:''}</div>${mine?`<div class="ghsocial-owner-controls"><button type="button" data-ghsocial-edit="${esc(row.id)}" data-ghsocial-edit-app="${esc(app)}" title="Edit"><i class="fa-solid fa-pen"></i></button><button type="button" data-ghsocial-delete="${esc(row.id)}" data-ghsocial-delete-app="${esc(app)}" title="Delete"><i class="fa-solid fa-trash"></i></button></div>`:''}</article>`;
}
function socialRelationship(identityId,app) {
  const t=globalThis.GreyhavenPhone?.getTimeline?.();
  return t?.relationships?.[identityId]?.apps?.[app] || {};
}
function socialMetrics(identity,app,posts) {
  const profile=globalThis.GreyhavenPhone?.getSocialProfile?.(identity) || {};
  const own=String(currentIdentity()?.id||'')===String(identity.id);
  if (app==='instagram') {
    const counts=own ? globalThis.GreyhavenPhone?.getSocialCounts?.()?.instagram : null;
    const info=profile.instagram && typeof profile.instagram==='object' ? profile.instagram : {};
    return {posts:posts.length,followers:Math.max(0,Number(counts?.followers??info.followersBase??0)),following:Math.max(0,Number(counts?.following??info.followingBase??0))};
  }
  const counts=own ? globalThis.GreyhavenPhone?.getSocialCounts?.()?.facebook : null;
  return {posts:posts.length,friends:Math.max(0,Number(counts?.friends??profile.facebook?.friendsBase??0))};
}
function socialHandle(identity,app) {
  const profile=globalThis.GreyhavenPhone?.getSocialProfile?.(identity) || {};
  const section=profile[app];
  const candidates=app==='instagram'
    ? [profile.instagramUsername,section?.username,section?.handle,profile.handle]
    : [profile.facebookName,section?.name,section?.username];
  return candidates.find(x=>typeof x==='string'&&x.trim())?.trim()||'';
}
function profileRoot() { return document.querySelector('#ghsocial-profile-page'); }
function closeProfile() { const page=profileRoot(),mine=page?.dataset.identityId===currentIdentity()?.id,app=page?.dataset.app;page?.remove();if(mine&&(app==='instagram'||app==='facebook')){const feed=document.querySelector(`#ghp-overlay .ghp-${app} [data-app-view="feed"]`);feed?.click()}}
function renderProfilePage(page,identityId,app='instagram') {
  if (!page) return;
  const identity=identityById(identityId); if(!identity){closeProfile();return;}
  const profile=profileFor(identityId,true),mine=String(currentIdentity()?.id||'')===String(identityId);
  const posts=[...(profile?.[app]?.posts||[])].sort((a,b)=>Number(b.timeMs||0)-Number(a.timeMs||0));
  const metrics=socialMetrics(identity,app,posts),handle=socialHandle(identity,app),relationship=socialRelationship(identityId,app);
  page.dataset.identityId=identityId;page.dataset.app=app;
  const followButton = app==='instagram' && !mine
    ? `<button type="button" data-ghsocial-follow="${esc(identityId)}" class="ghsocial-action primary">${relationship.following?'Following ▾':'Follow'}</button>`
    : app==='facebook' && !mine
      ? `<button type="button" data-ghsocial-facebook-connect="${esc(identityId)}" class="ghsocial-action primary">${relationship.friends?'Friends':relationship.outgoingRequest?'Request sent':relationship.incomingRequest?'Accept request':'Add friend'}</button>` : '';
  const messageButton=!mine?`<button type="button" data-ghsocial-message="${esc(identityId)}" class="ghsocial-action">Message</button>`:'';
  const stats=app==='instagram'
    ? `<div class="ghsocial-profile-stats"><span><b>${metrics.posts.toLocaleString()}</b><small>posts</small></span><span><b>${metrics.followers.toLocaleString()}</b><small>followers</small></span><span><b>${metrics.following.toLocaleString()}</b><small>following</small></span></div>`
    : `<div class="ghsocial-profile-stats"><span><b>${metrics.posts.toLocaleString()}</b><small>posts</small></span><span><b>${metrics.friends.toLocaleString()}</b><small>friends</small></span></div>`;
  page.innerHTML=`<div class="ghsocial-native-screen ${esc(app)}">
    <header class="ghsocial-native-header"><button type="button" data-ghsocial-back aria-label="Back"><i class="fa-solid fa-chevron-left"></i></button><b>${esc(handle?app==='instagram'?handle.replace(/^@/,''):handle:identity.name)}</b><button type="button" data-ghsocial-refresh="${esc(identityId)}" aria-label="Generate one new profile post" title="Refresh: generate one new post's metadata"><i class="fa-solid fa-rotate"></i></button></header>
    <main class="ghsocial-native-main"><div class="ghsocial-account-head">${avatarHtml(identity,'hero')}${stats}</div><div class="ghsocial-bio"><b>${esc(identity.name)}</b>${handle&&app==='facebook'?`<small>${esc(handle)}</small>`:''}</div>
    ${followButton||messageButton?`<div class="ghsocial-account-actions">${followButton}${messageButton}</div>`:''}
    ${mine?`<button type="button" class="ghsocial-new-post" data-ghsocial-new-post="${esc(app)}"><i class="fa-solid fa-plus"></i> New ${app==='instagram'?'Instagram':'Facebook'} post</button>`:''}
    <div class="ghsocial-gallery-title"><i class="${app==='instagram'?'fa-solid fa-table-cells':'fa-brands fa-facebook-f'}"></i> Posts</div>
    <div class="ghsocial-profile-feed ${esc(app)}">${posts.length?posts.map(row=>profilePostCard(row,app,mine)).join(''):`<div class="ghsocial-empty"><i class="${app==='instagram'?'fa-brands fa-instagram':'fa-brands fa-facebook-f'}"></i><b>No posts yet</b><span>Posts will be shared across chats and groups.</span></div>`}</div></main></div>`;
  hydrateProfileMedia(page);
  globalThis.GreyhavenPhoneImages?.invalidate?.();
}
function openProfile(identityId,app='instagram') {
  // An app-local, full-page screen inside Greyhaven Phone, never a browser dialog.
  if (!['instagram','facebook'].includes(app) || !phoneOpen()) return;
  const host=document.querySelector('#ghp-overlay .ghp-device');if(!host)return;
  let page=profileRoot();
  if(!page){page=document.createElement('section');page.id='ghsocial-profile-page';page.className='ghsocial-profile-page';host.appendChild(page);}
  renderProfilePage(page,identityId,app);
}
function refreshCurrentProfile() {
  const page=profileRoot();if(page)renderProfilePage(page,page.dataset.identityId,page.dataset.app);
}
function parsePostResult(raw) {
  const text=typeof raw==='string'?raw:JSON.stringify(raw||{});
  const stripped=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  try { return JSON.parse(stripped); } catch {}
  const pos=stripped.indexOf('{'),end=stripped.lastIndexOf('}');
  if(pos>=0&&end>pos)return JSON.parse(stripped.slice(pos,end+1));
  throw new Error('The post creator did not return valid JSON. Try again.');
}
async function refreshSingleProfile(identityId,app,button) {
  const identity=identityById(identityId),profile=profileFor(identityId,true),c=ctx();
  if(!identity||!profile||typeof c?.generateRaw!=='function'){
    globalThis.toastr?.error?.('An active Greyhaven chat and text model are required.');return;
  }
  const life=globalThis.GreyhavenLife,person=life?.getResolvedPerson?.(identity.name),scene=life?.getScene?.();
  const knownLocation=clean([person?.location,person?.area].filter(Boolean).join(', ')) || clean(scene?.location||scene?.label||'');
  const past=profile[app].posts.slice(0,5).map(x=>({visual:String(x.visual||'').slice(0,170),caption:String(x.caption||x.text||'').slice(0,90)}));
  const systemPrompt=`Create exactly ONE new fictional ${app==='instagram'?'Instagram':'Facebook'} profile post for a known Greyhaven roleplay character. Return ONLY one JSON object, no markdown. The object must be {"visual":"one image description or empty for a Facebook text-only post","caption":"Instagram caption (if Instagram)","text":"Facebook post text (if Facebook)"}. Keep the account owner's established personality and history. Describe a candid photo of the OWNER when appropriate, focusing on subject and expression, not background architecture. For a photo identify the camera explicitly: raw front-camera phone selfie; front-camera selfie with a clearly described filter only if intentional; raw rear-camera phone shot by someone else; or justified professional photo. Default to unedited phone imagery and never add unexplained jewelry. Keep scene metadata compact (25–50 words), camera realistic and background limited to one location cue. Vary content versus previous posts. Preserve known setting/time when appropriate but do not force a photo inside an unrelated active scene.`;
  const prompt=JSON.stringify({creator:{name:identity.name,identityId:identity.id,kind:identity.kind},location:knownLocation||'unknown',recentPosts:past,app});
  const original=button?.innerHTML||'';
  if(button){button.disabled=true;button.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';}
  try {
    const raw=await c.generateRaw({prompt,systemPrompt,responseLength:450,trimNames:false});
    const parsed=parsePostResult(raw);
    const visual=String(parsed.visual||'').trim();
    const caption=String(app==='instagram'?parsed.caption||parsed.text||'':parsed.text||parsed.caption||'').trim();
    if(!visual&&(app==='instagram'||!caption))throw new Error('The generated post was empty.');
    const next=normalizePost({id:`ghsocial:${uid()}`,identityId:identity.id,author:identity.name,visual,caption:app==='instagram'?caption:'',text:app==='facebook'?caption:'',type:'photo',timeMs:Date.now()},app,identity);
    profile[app].posts.unshift(next);profile.updatedAt=Date.now();saveSettings();syncGlobalIntoCurrentTimeline();
    refreshCurrentProfile();document.dispatchEvent(new CustomEvent('greyhaven:social-changed'));
    globalThis.toastr?.success?.('One new post created. Use Generate if you want its image.');
  } catch(error){globalThis.toastr?.error?.(`Post refresh: ${error?.message||error}`);}
  finally{if(button?.isConnected){button.disabled=false;button.innerHTML=original;}}
}

function publishProfilePost(actor,app,{visual='',caption='',text=''}={}){
  if(!['instagram','facebook'].includes(app))return false;const identity=identityByName(actor);if(!identity?.id)return false;
  const profile=profileFor(identity.id,true),copy=app==='instagram'?caption:text;
  if(app==='instagram'&&!visual||app==='facebook'&&!visual&&!copy)return false;
  const post=normalizePost({id:`ghsocial:${uid()}`,identityId:identity.id,author:identity.name,visual,caption:app==='instagram'?caption:'',text:app==='facebook'?text:'',type:'photo',timeMs:Number(new Date(globalThis.GreyhavenLife?.getTime?.()||Date.now()))},app,identity);
  profile[app].posts.unshift(post);profile.updatedAt=Date.now();saveSettings();syncGlobalIntoCurrentTimeline();refreshCurrentProfile();document.dispatchEvent(new CustomEvent('greyhaven:social-changed'));return true;
}
function postEditor(app,identityId,postId='') {
  const identity=identityById(identityId);if(!identity)return;
  const profile=profileFor(identityId,true),posts=profile[app].posts,row=postId?posts.find(x=>String(x.id)===String(postId)):null;
  let dialog=document.querySelector('#ghsocial-post-editor');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='ghsocial-post-editor';dialog.className='ghsocial-dialog';document.body.appendChild(dialog);}
  const copy=app==='instagram'?String(row?.caption||''):String(row?.text||'');
  dialog.innerHTML=`<form method="dialog" class="ghsocial-editor-card"><header><b>${row?'Edit':'New'} ${app==='instagram'?'Instagram':'Facebook'} post</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><label><span><b>Image description / metadata</b><small>Leave blank for a text-only Facebook post. Use concrete scene details if you want AI generation.</small></span><textarea class="ghsocial-visual">${esc(row?.visual||'')}</textarea></label><label><span><b>${app==='instagram'?'Caption':'Post text'}</b></span><textarea class="ghsocial-copy">${esc(copy)}</textarea></label><button type="button" class="primary" data-ghsocial-save-post>Save post</button></form>`;
  dialog.querySelector('[data-ghsocial-save-post]').onclick=()=>{
    const visual=dialog.querySelector('.ghsocial-visual').value.trim(),text=dialog.querySelector('.ghsocial-copy').value.trim();
    if(app==='instagram'&&!visual){globalThis.toastr?.warning?.('Instagram posts need image metadata.');return;}
    if(app==='facebook'&&!visual&&!text){globalThis.toastr?.warning?.('Add text or image metadata.');return;}
    const next=normalizePost({...row,id:row?.id||`ghsocial:${uid()}`,visual,identityId:identity.id,author:identity.name,timeMs:row?.timeMs||Date.now(),...(app==='instagram'?{caption:text}:{text})},app,identity);
    const index=posts.findIndex(x=>String(x.id)===String(next.id));if(index>=0)posts[index]=next;else posts.unshift(next);
    profile.updatedAt=Date.now();saveSettings();syncGlobalIntoCurrentTimeline();dialog.close();refreshCurrentProfile();document.dispatchEvent(new CustomEvent('greyhaven:social-changed'));globalThis.toastr?.success?.('Post saved globally.');
  };
  if(!dialog.open)dialog.showModal();
}
function deleteGlobalPost(identityId,app,postId) {
  const profile=profileFor(identityId,false);if(!profile)return;
  if(!confirm('Delete this post from the persistent Greyhaven profile?'))return;
  profile[app].posts=profile[app].posts.filter(x=>String(x.id)!==String(postId));profile.updatedAt=Date.now();addDeletedId(postId);saveSettings();syncGlobalIntoCurrentTimeline();refreshCurrentProfile();document.dispatchEvent(new CustomEvent('greyhaven:social-changed'));
}

function onlyFansAccount(identityId) { return settingsRoot()?.onlyFansAccounts?.[identityId] || null; }
function onlyFansPostEditor(postId) {
  const owner=currentIdentity(),account=onlyFansAccount(owner?.id);if(!owner||!account)return;
  const row=account.posts?.find(x=>String(x.id)===String(postId));if(!row)return;
  let dialog=document.querySelector('#ghsocial-of-editor');if(!dialog){dialog=document.createElement('dialog');dialog.id='ghsocial-of-editor';dialog.className='ghsocial-dialog';document.body.appendChild(dialog);}
  dialog.innerHTML=`<form method="dialog" class="ghsocial-editor-card"><header><b>Edit creator post</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><label><span><b>Image description / metadata</b><small>Changing this does not spend a credit until you choose Regenerate from AI tools.</small></span><textarea class="ghsocial-visual">${esc(row.visual||row.mediaDescription||'')}</textarea></label><label><span><b>Caption</b></span><textarea class="ghsocial-copy">${esc(row.caption||'')}</textarea></label><button type="button" class="primary" data-ghsocial-save-of>Save post</button></form>`;
  dialog.querySelector('[data-ghsocial-save-of]').onclick=()=>{row.visual=dialog.querySelector('.ghsocial-visual').value.trim();row.caption=dialog.querySelector('.ghsocial-copy').value.trim();saveSettings();dialog.close();forceOnlyFansRerender();document.dispatchEvent(new CustomEvent('greyhaven:social-changed'));globalThis.toastr?.success?.('Creator post updated.');};
  if(!dialog.open)dialog.showModal();
}
function deleteOnlyFansPost(postId) {
  const owner=currentIdentity(),account=onlyFansAccount(owner?.id);if(!owner||!account)return;if(!confirm('Delete this creator post?'))return;
  account.posts=(account.posts||[]).filter(x=>String(x.id)!==String(postId));saveSettings();forceOnlyFansRerender();document.dispatchEvent(new CustomEvent('greyhaven:social-changed'));
}
function forceOnlyFansRerender() {
  const page=[...document.querySelectorAll('#ghp-overlay .ghp-onlyfans [data-app-view="page"]')].at(-1);if(page)page.click();else scheduleAugment();
}

function augmentOnlyFansControls() {
  const app=document.querySelector('#ghp-overlay .ghp-onlyfans');if(!app)return;
  const role=app.querySelector('.ghp-role-settings');
  if(role&&!app.querySelector('.ghsocial-of-guide')){
    const box=document.createElement('section');box.className='ghsocial-of-guide';
    const saved=onlyFansSavedPrompt();
    const captured=onlyFansDefaultPrompt();
    box.innerHTML=`<h3><i class="fa-solid fa-sliders"></i> OnlyFans creator post refresh prompt</h3><p>Edit only the dedicated prompt used when OnlyFans refresh creates new creator posts. Keep the required JSON output structure and 18+ restrictions so Greyhaven Phone can parse it. This replaces the built-in creator-post refresh prompt, not the whole phone refresh prompt.</p><label><span><b>Creator refresh prompt</b><small>${saved?'Custom creator prompt is active':'Built-in creator prompt is active'} · reset restores the current default.</small></span><textarea data-ghsocial-of-main spellcheck="false">${esc(saved||captured)}</textarea></label><div class="ghsocial-of-controls"><button type="button" data-ghsocial-save-of-main class="ghp-wide-action primary"><i class="fa-solid fa-floppy-disk"></i> Save creator prompt</button><button type="button" data-ghsocial-reset-of-main class="ghp-wide-action"><i class="fa-solid fa-rotate-left"></i> Reset to default</button></div>`;
    role.insertAdjacentElement('afterend',box);
  }
  const newPost=app.querySelector('[data-new-onlyfans-post]'),grid=newPost?.closest('main')?.querySelector('.ghp-of-grid');
  if(!newPost||!grid)return;
  const account=onlyFansAccount(currentIdentity()?.id),posts=account?.posts||[],cards=[...grid.querySelectorAll(':scope > .ghp-of-post')];
  cards.forEach((card,index)=>{
    const row=posts[index];if(!row||card.querySelector(':scope > .ghsocial-owner-controls'))return;
    const controls=document.createElement('div');controls.className='ghsocial-owner-controls';controls.innerHTML=`<button type="button" data-ghsocial-of-edit="${esc(row.id)}" title="Edit"><i class="fa-solid fa-pen"></i></button><button type="button" data-ghsocial-of-delete="${esc(row.id)}" title="Delete"><i class="fa-solid fa-trash"></i></button>`;card.appendChild(controls);
  });
}

function augmentOwnProfileLaunchers() {
  const overlay=document.querySelector('#ghp-overlay');if(!overlay||overlay.hidden)return;
  const own=currentIdentity();if(!own?.id)return;
  const igProfile=overlay.querySelector('.ghp-instagram .ghp-social-profile');
  // The native Instagram profile tab IS the persistent profile. Do not add a redundant launcher.
  if(igProfile&&!profileRoot())openProfile(own.id,'instagram');
  const fbProfile=overlay.querySelector('.ghp-facebook .ghp-social-profile');
  if(fbProfile&&!profileRoot())openProfile(own.id,'facebook');
}

function makeNameClickable(node,app) {
  if(!node||node.dataset.ghsocialOpenProfile)return;
  const identity=identityByName(node.textContent);if(!identity?.id)return;
  node.dataset.ghsocialOpenProfile=identity.id;node.dataset.ghsocialOpenApp=app;node.classList.add('ghsocial-profile-link');node.setAttribute('role','button');node.tabIndex=0;
}
function augmentProfileLinks() {
  const overlay=document.querySelector('#ghp-overlay');if(!overlay||overlay.hidden)return;
  for(const article of overlay.querySelectorAll('.ghp-instagram .ghp-feed article'))makeNameClickable(article.querySelector('header span b'),'instagram');
  for(const article of overlay.querySelectorAll('.ghp-facebook .ghp-feed article'))makeNameClickable(article.querySelector('header span b'),'facebook');
  for(const header of overlay.querySelectorAll('.ghp-instagram-thread .ghp-app-header>div b'))makeNameClickable(header,'instagram');
  for(const header of overlay.querySelectorAll('.ghp-facebook-thread .ghp-app-header>div b'))makeNameClickable(header,'facebook');
  for(const row of overlay.querySelectorAll('.ghp-instagram .ghp-row.static>span>b'))makeNameClickable(row,'instagram');
  for(const row of overlay.querySelectorAll('.ghp-facebook .ghp-row.static>span>b'))makeNameClickable(row,'facebook');
  for(const row of overlay.querySelectorAll('.ghp-instagram .ghp-social-section .ghp-row>span>b'))makeNameClickable(row,'instagram');
  for(const row of overlay.querySelectorAll('.ghp-facebook .ghp-social-section .ghp-row>span>b'))makeNameClickable(row,'facebook');
  const story=overlay.querySelector('.ghp-story-view header b');if(story)makeNameClickable(story,'instagram');
}

function forceCurrentSocialRerender() {
  const active=document.querySelector('#ghp-overlay .ghp-social-tabs button.active');if(active)setTimeout(()=>active.click(),0);
}
function screenSignature() {
  const overlay=document.querySelector('#ghp-overlay');if(!overlay||overlay.hidden)return'closed';
  const app=overlay.querySelector('.ghp-app');const header=app?.querySelector('.ghp-app-header b')?.textContent||'';const cls=app?.className||'';return `${cls}|${clean(header)}`;
}
function scheduleSync() {
  if(syncQueued)return;syncQueued=true;
  setTimeout(()=>{syncQueued=false;if(!phoneOpen())return;const changed=syncNow();if(changed)forceCurrentSocialRerender();},80);
}
function scheduleAugment() {
  if(augmentQueued)return;augmentQueued=true;
  requestAnimationFrame(()=>{augmentQueued=false;if(!phoneOpen())return;augmentProfileLinks();augmentOnlyFansControls();augmentOwnProfileLaunchers();});
}
function mutationTouchesPhone(mutation) {
  const target=mutation.target instanceof Element?mutation.target:mutation.target?.parentElement;if(target?.closest?.('#ghp-overlay'))return true;
  for(const node of mutation.addedNodes||[])if(node instanceof Element&&(node.id==='ghp-overlay'||node.closest?.('#ghp-overlay')||node.querySelector?.('#ghp-overlay')))return true;return false;
}
function observeUi() {
  if(observer)return;observer=new MutationObserver(mutations=>{
    if(!mutations.some(mutationTouchesPhone))return;
    const sig=screenSignature();scheduleAugment();if(sig!==lastScreenSignature){lastScreenSignature=sig;scheduleSync();}
  });observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
}

function bindEvents() {
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    if(target.closest('#ghp-overlay [data-close]')) closeProfile();
    const link=target.closest('[data-ghsocial-open-profile]');if(link){event.preventDefault();event.stopPropagation();link.closest('dialog')?.close();openProfile(link.dataset.ghsocialOpenProfile,link.dataset.ghsocialOpenApp||'instagram');return;}
    const ownProfile=target.closest('[data-ghsocial-own-profile]');if(ownProfile){event.preventDefault();event.stopPropagation();const own=currentIdentity();if(own?.id)openProfile(own.id,ownProfile.dataset.ghsocialOwnProfile||'instagram');return;}
    if(target.closest('[data-ghsocial-back]')){event.preventDefault();event.stopPropagation();closeProfile();return;}
    if(target.closest('[data-ghsocial-close]')){target.closest('dialog')?.close();return;}
    const follow=target.closest('[data-ghsocial-follow]');if(follow){event.preventDefault();event.stopPropagation();const mine=currentIdentity(),target=follow.dataset.ghsocialFollow;const on=!!socialRelationship(target,'instagram').following;globalThis.GreyhavenPhone?.apps?.followInstagram?.(mine?.id,target,!on);syncGlobalIntoCurrentTimeline();refreshCurrentProfile();return;}
    const fbConnect=target.closest('[data-ghsocial-facebook-connect]');if(fbConnect){event.preventDefault();event.stopPropagation();const mine=currentIdentity(),target=fbConnect.dataset.ghsocialFacebookConnect,state=socialRelationship(target,'facebook');if(!state.friends&&!state.outgoingRequest){globalThis.GreyhavenPhone?.apps?.requestFacebook?.(mine?.id,target,state.incomingRequest?'accept':'request');refreshCurrentProfile();}return;}
    const message=target.closest('[data-ghsocial-message]');if(message){event.preventDefault();event.stopPropagation();const id=message.dataset.ghsocialMessage,app=profileRoot()?.dataset.app;closeProfile();const overlay=document.querySelector('#ghp-overlay');if(overlay){const b=document.createElement('button');b.dataset.openSocialThread=app;b.dataset.socialIdentity=id;b.style.display='none';overlay.appendChild(b);b.click();b.remove();}return;}
    const refresh=target.closest('[data-ghsocial-refresh]');if(refresh){event.preventDefault();event.stopPropagation();void refreshSingleProfile(refresh.dataset.ghsocialRefresh,profileRoot()?.dataset.app,refresh);return;}
    const page=profileRoot();
    const create=target.closest('[data-ghsocial-new-post]');if(create&&page){event.preventDefault();event.stopPropagation();postEditor(page.dataset.app,page.dataset.identityId,'');return;}
    const edit=target.closest('[data-ghsocial-edit]');if(edit&&page){event.preventDefault();event.stopPropagation();postEditor(page.dataset.app,page.dataset.identityId,edit.dataset.ghsocialEdit);return;}
    const del=target.closest('[data-ghsocial-delete]');if(del&&page){event.preventDefault();event.stopPropagation();deleteGlobalPost(page.dataset.identityId,page.dataset.app,del.dataset.ghsocialDelete);return;}
    const ofEdit=target.closest('[data-ghsocial-of-edit]');if(ofEdit){event.preventDefault();event.stopPropagation();onlyFansPostEditor(ofEdit.dataset.ghsocialOfEdit);return;}
    const ofDelete=target.closest('[data-ghsocial-of-delete]');if(ofDelete){event.preventDefault();event.stopPropagation();deleteOnlyFansPost(ofDelete.dataset.ghsocialOfDelete);return;}
    const savePrompt=target.closest('[data-ghsocial-save-of-main]');if(savePrompt){const root=settingsRoot(),value=savePrompt.closest('.ghsocial-of-guide')?.querySelector('[data-ghsocial-of-main]')?.value?.trim()||'';if(!looksLikeOnlyFansPrompt(value)){globalThis.toastr?.warning?.('Keep a valid OnlyFans creator-post prompt with the required posts JSON structure.');return;}root.socialStudio.onlyFansCreatorPrompt=value;saveSettings();globalThis.toastr?.success?.('OnlyFans creator prompt saved.');return;}
    const resetPrompt=target.closest('[data-ghsocial-reset-of-main]');if(resetPrompt){const root=settingsRoot();root.socialStudio.onlyFansCreatorPrompt='';root.socialStudio.onlyFansFullPrompt='';saveSettings();const box=resetPrompt.closest('.ghsocial-of-guide');if(box){const input=box.querySelector('[data-ghsocial-of-main]');if(input)input.value=onlyFansDefaultPrompt();const hint=box.querySelector('small');if(hint)hint.textContent='Built-in creator prompt is active · reset restores the current default.';}globalThis.toastr?.success?.('OnlyFans creator prompt reset.');return;}

  },true);
  document.addEventListener('keydown',event=>{const target=event.target instanceof Element?event.target:null;if(!target||!target.matches('[data-ghsocial-open-profile]')||!['Enter',' '].includes(event.key))return;event.preventDefault();openProfile(target.dataset.ghsocialOpenProfile,target.dataset.ghsocialOpenApp||'instagram');},true);
  const c=ctx();if(c?.eventSource&&c?.eventTypes){const bind=key=>{const name=c.eventTypes[key];if(name)c.eventSource.on(name,()=>{lastScreenSignature='';scheduleSync();scheduleAugment();});};for(const key of ['CHAT_CHANGED','CHAT_CREATED','PERSONA_CHANGED','MESSAGE_SENT','CHARACTER_MESSAGE_RENDERED'])bind(key);const clear=key=>{const name=c.eventTypes[key];if(name)c.eventSource.on(name,closeProfile);};for(const key of ['CHAT_CHANGED','PERSONA_CHANGED'])clear(key);}
}

function expose() {
  globalThis.GreyhavenSocialStudio={version:VERSION,openProfile,publishPost:publishProfilePost,sync:syncNow,getProfile:identityId=>clone(profileFor(identityId,false)),getOnlyFansMainPrompt:()=>onlyFansSavedPrompt()||onlyFansDefaultPrompt()};
}
async function waitReady(timeout=15000){const start=Date.now();while(Date.now()-start<timeout){if(globalThis.GreyhavenPhone&&ctx()?.extensionSettings&&document.body)return true;await new Promise(r=>setTimeout(r,100));}return false;}
async function init(){if(initialized)return;if(!await waitReady()){console.warn(`[${MODULE}] Greyhaven Phone was not ready.`);return;}settingsRoot();bindEvents();observeUi();expose();scheduleSync();scheduleAugment();initialized=true;console.info(`[${MODULE}] v${VERSION} loaded`);}
void init().catch(error=>console.error(`[${MODULE}] boot`,error));
