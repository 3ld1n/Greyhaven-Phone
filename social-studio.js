const MODULE = 'greyhaven-phone-socialstudio';
const VERSION = '1.0.0';
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
  root.socialStudio.onlyFansRefreshGuide = String(root.socialStudio.onlyFansRefreshGuide || '');
  root.socialStudio.lastOnlyFansSystemPrompt = String(root.socialStudio.lastOnlyFansSystemPrompt || '');
  root.socialStudio.deletedPostIds = Array.isArray(root.socialStudio.deletedPostIds) ? root.socialStudio.deletedPostIds : [];
  root.socialStudioProfiles = root.socialStudioProfiles && typeof root.socialStudioProfiles==='object' && !Array.isArray(root.socialStudioProfiles) ? root.socialStudioProfiles : {};
  return root;
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
  for (const [key,t] of Object.entries(root.phones)) {
    if (String(t?.identityId||'')===String(owner.id) || lower(t?.ownerName)===lower(owner.name)) return {root,key,timeline:t,owner};
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
function renderProfileDialog(dialog,identityId,app='instagram') {
  const identity=identityById(identityId);if(!identity){dialog.close();return;}
  const profile=profileFor(identityId,true),mine=String(currentIdentity()?.id||'')===String(identityId),posts=[...(profile?.[app]?.posts||[])].sort((a,b)=>Number(b.timeMs||0)-Number(a.timeMs||0));
  const social=globalThis.GreyhavenPhone?.getSocialProfile?.(identity)||{};
  const handle=clean(app==='instagram'?(social.instagramUsername||social.instagram||social.handle||''):(social.facebookName||social.facebook||''));
  dialog.dataset.identityId=identityId;dialog.dataset.app=app;
  dialog.innerHTML=`<div class="ghsocial-dialog-card"><header><button type="button" data-ghsocial-close><i class="fa-solid fa-xmark"></i></button><div><b>${esc(identity.name)}</b><small>${app==='instagram'?'Instagram':'Facebook'} profile · global</small></div><span></span></header><main><section class="ghsocial-profile-head">${avatarHtml(identity,'hero')}<div><h2>${esc(identity.name)}</h2>${handle?`<small>${esc(handle)}</small>`:''}<p>${posts.length} persistent post${posts.length===1?'':'s'} · available across chats</p></div></section><div class="ghsocial-app-switch"><button type="button" data-ghsocial-switch="instagram" class="${app==='instagram'?'active':''}"><i class="fa-brands fa-instagram"></i> Instagram</button><button type="button" data-ghsocial-switch="facebook" class="${app==='facebook'?'active':''}"><i class="fa-brands fa-facebook-f"></i> Facebook</button></div>${mine?`<button type="button" class="ghsocial-new-post" data-ghsocial-new-post="${esc(app)}"><i class="fa-solid fa-plus"></i> New ${app==='instagram'?'Instagram':'Facebook'} post</button>`:''}<div class="ghsocial-profile-feed ${app}">${posts.length?posts.map(row=>profilePostCard(row,app,mine)).join(''):`<div class="ghsocial-empty"><i class="${app==='instagram'?'fa-brands fa-instagram':'fa-brands fa-facebook-f'}"></i><b>No persistent posts yet</b><span>Posts seen in Greyhaven will be collected here automatically.</span></div>`}</div></main></div>`;
  hydrateProfileMedia(dialog);
  globalThis.GreyhavenPhoneImages?.invalidate?.();
}
function openProfile(identityId,app='instagram') {
  let dialog=document.querySelector('#ghsocial-profile-dialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='ghsocial-profile-dialog';dialog.className='ghsocial-dialog';document.body.appendChild(dialog);}
  renderProfileDialog(dialog,identityId,app);
  if(!dialog.open)dialog.showModal();
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
    profile.updatedAt=Date.now();saveSettings();syncGlobalIntoCurrentTimeline();dialog.close();openProfile(identityId,app);document.dispatchEvent(new CustomEvent('greyhaven:social-changed'));globalThis.toastr?.success?.('Post saved globally.');
  };
  if(!dialog.open)dialog.showModal();
}
function deleteGlobalPost(identityId,app,postId) {
  const profile=profileFor(identityId,false);if(!profile)return;
  if(!confirm('Delete this post from the persistent Greyhaven profile?'))return;
  profile[app].posts=profile[app].posts.filter(x=>String(x.id)!==String(postId));profile.updatedAt=Date.now();addDeletedId(postId);saveSettings();syncGlobalIntoCurrentTimeline();openProfile(identityId,app);document.dispatchEvent(new CustomEvent('greyhaven:social-changed'));
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
    const root=settingsRoot(),box=document.createElement('section');box.className='ghsocial-of-guide';
    const captured=String(root?.socialStudio?.lastOnlyFansSystemPrompt||'').trim();
    box.innerHTML=`<h3><i class="fa-solid fa-sliders"></i> Creator refresh prompt</h3><p>Your custom text is appended to Greyhaven's built-in creator-post prompt. This lets you make refreshes bolder, more casual, more explicit, more location-aware, or otherwise fit the creator — without breaking the JSON format the Phone expects.</p><details class="ghsocial-original-prompt"><summary>Built-in generator prompt ${captured?'· captured':'· capture after next refresh'}</summary>${captured?`<textarea readonly>${esc(captured)}</textarea>`:'<small>Run one OnlyFans refresh after installing this version and Greyhaven will save the exact built-in system prompt here for reference.</small>'}</details><label><span><b>Additional refresh direction</b><small>Appended after the built-in prompt on every OnlyFans refresh.</small></span><textarea data-ghsocial-of-guide placeholder="Example: Make new posts bolder, more adult, varied and story-connected. Use each creator’s current location and avoid repeating the same mirror selfie, pose or room…">${esc(root?.socialStudio?.onlyFansRefreshGuide||'')}</textarea></label><button type="button" data-ghsocial-save-of-guide class="ghp-wide-action primary"><i class="fa-solid fa-floppy-disk"></i> Save refresh direction</button>`;
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
  if(igProfile&&!igProfile.querySelector('[data-ghsocial-own-profile]')){
    const button=document.createElement('button');button.type='button';button.className='ghsocial-open-own';button.dataset.ghsocialOwnProfile='instagram';button.innerHTML='<i class="fa-brands fa-instagram"></i><span><b>Persistent profile & posts</b><small>Add, edit or delete posts shared across chats</small></span><i class="fa-solid fa-chevron-right"></i>';igProfile.appendChild(button);
  }
  const fbMain=overlay.querySelector('.ghp-facebook > main');
  if(fbMain&&!fbMain.querySelector('[data-ghsocial-own-profile]')){
    const button=document.createElement('button');button.type='button';button.className='ghsocial-open-own';button.dataset.ghsocialOwnProfile='facebook';button.innerHTML='<i class="fa-brands fa-facebook-f"></i><span><b>My persistent profile</b><small>Add, edit or delete Facebook posts shared across chats</small></span><i class="fa-solid fa-chevron-right"></i>';fbMain.prepend(button);
  }
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
    const link=target.closest('[data-ghsocial-open-profile]');if(link){event.preventDefault();event.stopPropagation();openProfile(link.dataset.ghsocialOpenProfile,link.dataset.ghsocialOpenApp||'instagram');return;}
    const ownProfile=target.closest('[data-ghsocial-own-profile]');if(ownProfile){event.preventDefault();event.stopPropagation();const own=currentIdentity();if(own?.id)openProfile(own.id,ownProfile.dataset.ghsocialOwnProfile||'instagram');return;}
    if(target.closest('[data-ghsocial-close]')){target.closest('dialog')?.close();return;}
    const sw=target.closest('[data-ghsocial-switch]');if(sw){renderProfileDialog(sw.closest('dialog'),sw.closest('dialog').dataset.identityId,sw.dataset.ghsocialSwitch);return;}
    const create=target.closest('[data-ghsocial-new-post]');if(create){const d=create.closest('dialog');postEditor(create.dataset.ghsocialNewPost,d.dataset.identityId,'');return;}
    const edit=target.closest('[data-ghsocial-edit]');if(edit){const d=edit.closest('dialog');postEditor(edit.dataset.ghsocialEditApp,d.dataset.identityId,edit.dataset.ghsocialEdit);return;}
    const del=target.closest('[data-ghsocial-delete]');if(del){const d=del.closest('dialog');deleteGlobalPost(d.dataset.identityId,del.dataset.ghsocialDeleteApp,del.dataset.ghsocialDelete);return;}
    const ofEdit=target.closest('[data-ghsocial-of-edit]');if(ofEdit){event.preventDefault();event.stopPropagation();onlyFansPostEditor(ofEdit.dataset.ghsocialOfEdit);return;}
    const ofDelete=target.closest('[data-ghsocial-of-delete]');if(ofDelete){event.preventDefault();event.stopPropagation();deleteOnlyFansPost(ofDelete.dataset.ghsocialOfDelete);return;}
    const saveGuide=target.closest('[data-ghsocial-save-of-guide]');if(saveGuide){const root=settingsRoot(),value=saveGuide.closest('.ghsocial-of-guide')?.querySelector('[data-ghsocial-of-guide]')?.value||'';root.socialStudio.onlyFansRefreshGuide=value.trim();saveSettings();globalThis.toastr?.success?.('Creator refresh direction saved.');return;}
  },true);
  document.addEventListener('keydown',event=>{const target=event.target instanceof Element?event.target:null;if(!target||!target.matches('[data-ghsocial-open-profile]')||!['Enter',' '].includes(event.key))return;event.preventDefault();openProfile(target.dataset.ghsocialOpenProfile,target.dataset.ghsocialOpenApp||'instagram');},true);
  const c=ctx();if(c?.eventSource&&c?.eventTypes){const bind=key=>{const name=c.eventTypes[key];if(name)c.eventSource.on(name,()=>{lastScreenSignature='';scheduleSync();scheduleAugment();});};for(const key of ['CHAT_CHANGED','CHAT_CREATED','PERSONA_CHANGED','MESSAGE_SENT','CHARACTER_MESSAGE_RENDERED'])bind(key);}
}

function expose() {
  globalThis.GreyhavenSocialStudio={version:VERSION,openProfile,sync:syncNow,getProfile:identityId=>clone(profileFor(identityId,false)),getOnlyFansRefreshGuide:()=>settingsRoot()?.socialStudio?.onlyFansRefreshGuide||''};
}
async function waitReady(timeout=15000){const start=Date.now();while(Date.now()-start<timeout){if(globalThis.GreyhavenPhone&&ctx()?.extensionSettings&&document.body)return true;await new Promise(r=>setTimeout(r,100));}return false;}
async function init(){if(initialized)return;if(!await waitReady()){console.warn(`[${MODULE}] Greyhaven Phone was not ready.`);return;}settingsRoot();bindEvents();observeUi();expose();scheduleSync();scheduleAugment();initialized=true;console.info(`[${MODULE}] v${VERSION} loaded`);}
void init().catch(error=>console.error(`[${MODULE}] boot`,error));
