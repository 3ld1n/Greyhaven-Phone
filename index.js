const GHP_MODULE = 'greyhaven-phone';
const GHP_VERSION = '1.1.0';
const GHP_META_KEY = 'greyhavenPhone';
const GHP_SETTINGS_KEY = 'greyhavenPhone';
const GHP_PROMPT_KEY = 'greyhaven_phone_continuity';
const GHP_PROMPT_POSITION_IN_CHAT = 1;
const GHP_PROMPT_ROLE_SYSTEM = 0;
const MEDIA_DB_NAME = 'GreyhavenPhoneMedia';
const MEDIA_STORE = 'media';

const APPS = {
  messages:{label:'Messages',icon:'fa-solid fa-comment',tint:'#4cd964'},
  phone:{label:'Phone',icon:'fa-solid fa-phone',tint:'#48cf62'},
  contacts:{label:'Contacts',icon:'fa-solid fa-address-book',tint:'#aeb3bd'},
  social:{label:'Social',icon:'fa-solid fa-camera-retro',tint:'#c95a9b'},
  snap:{label:'Snap',icon:'fa-solid fa-location-dot',tint:'#f0d84e'},
  calendar:{label:'Calendar',icon:'fa-regular fa-calendar',tint:'#ef5e5e'},
  photos:{label:'Photos',icon:'fa-regular fa-images',tint:'#72bfff'},
  notes:{label:'Notes',icon:'fa-regular fa-note-sticky',tint:'#ecd257'},
  mail:{label:'Mail',icon:'fa-regular fa-envelope',tint:'#4d8df7'},
  settings:{label:'Settings',icon:'fa-solid fa-gear',tint:'#767b86'}
};

const WALLPAPERS = {
  aurora:'linear-gradient(145deg,#30245f 0%,#542f67 35%,#1e3d58 72%,#11131b 100%)',
  midnight:'radial-gradient(circle at 72% 18%,#263b68 0%,#11182a 31%,#080b13 69%,#050609 100%)',
  coast:'linear-gradient(160deg,#0e5360 0%,#268c93 35%,#8d7680 68%,#271c35 100%)',
  ember:'radial-gradient(circle at 24% 18%,#7b3f50 0%,#341f3f 34%,#131522 72%,#08090d 100%)',
  graphite:'linear-gradient(150deg,#34363d 0%,#181a20 44%,#090a0d 100%)'
};

const DEFAULT_PROFILE = {
  deviceName:'iPhone',
  wallpaper:'aurora',
  wallpaperUrl:'',
  lockScreen:true,
  notificationPreviews:true,
  refreshMode:'manual',
  staleAfterMessages:12,
  maxNewEvents:4,
  activityLevel:'normal',
  recentMessages:20,
  recentChars:12000,
  responseTokens:1600,
  apps:{messages:true,phone:true,contacts:true,social:true,snap:true,calendar:true,photos:true,notes:true,mail:false,settings:true}
};

let initialized=false, bound=false, menuObserver=null, lifeUnsub=null, clockTimer=null;
let currentChat='', unlocked=false, app='', threadId='', contactId='', callId='';
let refreshBusy=false, replyBusy=false, islandText='', islandIcon='';
let composeRequest={threadId:'',kind:''};
let mediaDbPromise=null;
const mediaObjectUrls=new Map();
const mediaMemoryFallback=new Map();

function ctx(){try{return globalThis.SillyTavern?.getContext?.()||null}catch(e){console.warn(`[${GHP_MODULE}] context`,e);return null}}
function clone(v){if(v===undefined)return undefined;try{return structuredClone(v)}catch{return JSON.parse(JSON.stringify(v))}}
function id(){try{return ctx()?.uuidv4?.()||crypto.randomUUID()}catch{return `ghp-${Date.now()}-${Math.random().toString(36).slice(2)}`}}
function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function norm(v){return String(v||'').trim().replace(/\s+/g,' ')}
function slug(v){return norm(v).toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'')||'persona'}
function hasChat(){const c=ctx();return !!(c&&(c.groupId||c.characterId!==undefined)&&(c.getCurrentChatId?.()||c.chatId))}
function chatIdentity(){const c=ctx();if(!c)return'';const chat=c.getCurrentChatId?.()||c.chatId||'';return chat?(c.groupId?`g:${c.groupId}:${chat}`:`c:${c.characterId}:${chat}`):''}
function now(){try{const d=globalThis.GreyhavenLife?.getTime?.();if(d){const x=new Date(d);if(!Number.isNaN(x.getTime()))return x}}catch{}return new Date()}
function timeText(d=now()){return new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',hour12:false}).format(d)}
function dateText(d=now(),short=false){return new Intl.DateTimeFormat(undefined,short?{weekday:'short',month:'short',day:'numeric'}:{weekday:'long',month:'long',day:'numeric'}).format(d)}
function rel(ms){const m=Math.max(0,Math.round((now().getTime()-Number(ms||0))/60000));if(m<1)return'now';if(m<60)return`${m}m`;const h=Math.round(m/60);return h<24?`${h}h`:`${Math.round(h/24)}d`}
function lc(v){return norm(v).toLowerCase()}

function personaAvatarId(){
  const c=ctx(),name=norm(c?.name1||'User'),p=c?.powerUserSettings||{},personas=p.personas||{},descs=p.persona_descriptions||p.personaDescriptions||{};
  const matches=Object.entries(personas).filter(([,personaName])=>lc(personaName)===lc(name));
  if(!matches.length)return'';
  const activeDescription=String(p.persona_description||'').trim();
  if(activeDescription){
    const exact=matches.find(([avatarId])=>{
      const value=descs?.[avatarId];
      const description=typeof value==='string'?value:String(value?.description||value?.prompt||value?.text||'');
      return description.trim()===activeDescription;
    });
    if(exact)return exact[0];
  }
  const chat=Array.isArray(c?.chat)?c.chat:[];
  for(let i=chat.length-1;i>=0;i--){
    const message=chat[i];
    if(!message?.is_user||lc(message?.name)!==lc(name))continue;
    const force=decodeURIComponent(String(message?.force_avatar||''));
    const found=matches.find(([avatarId])=>force.includes(avatarId));
    if(found)return found[0];
  }
  return matches[0][0];
}
function personaAvatar(){
  const c=ctx(),avatarId=personaAvatarId();if(!avatarId)return'';
  try{return c?.getThumbnailUrl?.('persona',avatarId)||`User Avatars/${avatarId}`}catch{return`User Avatars/${avatarId}`}
}
function personaDescription(){
  const c=ctx(),name=norm(c?.name1||'User'),p=c?.powerUserSettings||{},desc=p.persona_descriptions||p.personaDescriptions||{},personas=p.personas||{},active=personaAvatarId(),candidates=[];
  if(active)candidates.push(desc[active],desc[String(active).split('/').pop()]);
  for(const [k,v] of Object.entries(personas||{}))if(lc(v)===lc(name))candidates.push(desc[k]);
  for(const [k,v] of Object.entries(desc||{})){
    if(lc(k)===lc(name))candidates.push(v);
    if(v&&typeof v==='object'&&lc(v.name)===lc(name))candidates.push(v.description,v.prompt,v.text);
    if(typeof v==='string'&&v.toLowerCase().includes(`name: ${name.toLowerCase()}`))candidates.push(v);
  }
  for(const v of candidates.flat()){
    if(typeof v==='string'&&v.trim())return v.trim();
    if(v&&typeof v==='object')for(const k of ['description','prompt','text'])if(typeof v[k]==='string'&&v[k].trim())return v[k].trim();
  }
  return'';
}
function persona(){
  const c=ctx(),name=norm(c?.name1||'User'),avatarId=personaAvatarId(),avatar=personaAvatar();
  return{name,avatarId,avatar,description:personaDescription(),key:`persona:${slug(name)}${avatarId?`:${slug(avatarId)}`:''}`}
}

function settingsRoot(){
  const c=ctx();if(!c?.extensionSettings)return{profiles:{}};
  if(!c.extensionSettings[GHP_SETTINGS_KEY]||typeof c.extensionSettings[GHP_SETTINGS_KEY]!=='object')c.extensionSettings[GHP_SETTINGS_KEY]={profiles:{}};
  const r=c.extensionSettings[GHP_SETTINGS_KEY];if(!r.profiles||typeof r.profiles!=='object')r.profiles={};return r;
}
function normalizeProfile(raw={}){
  return{...DEFAULT_PROFILE,...raw,apps:{...DEFAULT_PROFILE.apps,...(raw.apps||{})},
    wallpaper:WALLPAPERS[raw.wallpaper]?raw.wallpaper:'aurora',
    staleAfterMessages:Math.max(3,Math.min(100,Number(raw.staleAfterMessages||12))),
    maxNewEvents:Math.max(1,Math.min(8,Number(raw.maxNewEvents||4))),
    recentMessages:Math.max(6,Math.min(50,Number(raw.recentMessages||20))),
    recentChars:Math.max(3000,Math.min(30000,Number(raw.recentChars||12000))),
    responseTokens:Math.max(600,Math.min(3000,Number(raw.responseTokens||1600))),
    activityLevel:['quiet','normal','busy'].includes(raw.activityLevel)?raw.activityLevel:'normal',
    refreshMode:['manual','stale-open'].includes(raw.refreshMode)?raw.refreshMode:'manual'
  };
}
function profile(){
  const c=ctx(),r=settingsRoot(),p=persona();let v=r.profiles[p.key];
  if(!v){const k=Object.keys(r.profiles).find(k=>lc(r.profiles[k]?.personaName)===lc(p.name));if(k)v=r.profiles[k]}
  if(!v&&c?.extensionSettings){v=normalizeProfile({personaName:p.name,personaAvatar:p.avatar});r.profiles[p.key]=v;c.saveSettingsDebounced?.()}
  return normalizeProfile(v||{});
}
function saveProfile(patch){
  const c=ctx();if(!c?.extensionSettings)return;const r=settingsRoot(),p=persona();
  r.profiles[p.key]=normalizeProfile({...profile(),...patch,personaName:p.name,personaAvatar:p.avatar});
  c.extensionSettings[GHP_SETTINGS_KEY]=r;c.saveSettingsDebounced?.();render();
}

function normalizeMessage(m={}){
  m.id||=id();m.sender=norm(m.sender||'Unknown');m.senderId||='';
  m.text=String(m.text||'');m.timeMs=Number(m.timeMs||Date.now());m.read=m.read!==false;
  m.type=['text','photo','video'].includes(m.type)?m.type:'text';
  m.mediaDescription=String(m.mediaDescription||m.description||'');
  m.mediaKey=String(m.mediaKey||'');
  m.requestMedia=['photo','video'].includes(m.requestMedia)?m.requestMedia:'';
  m.mirrorId=String(m.mirrorId||'');
  return m;
}
function defaultTimeline(ownerName='',ownerAvatar=''){return{version:2,ownerName:norm(ownerName),ownerAvatar:ownerAvatar||'',createdAt:Date.now(),updatedAt:Date.now(),contacts:{},contactOrder:[],suppressedContacts:[],threads:{},threadOrder:[],calls:[],posts:[],stories:[],notifications:[],photos:[],notes:[],mail:[],refresh:{lastAt:null,chatLength:0,eventKeys:[],summary:''}}}
function normalizeContact(x={}){x.id||=`contact:${id()}`;x.name=norm(x.name||'Unknown');x.avatar||='';x.characterId=Number.isInteger(Number(x.characterId))?Number(x.characterId):null;x.personaDescription=String(x.personaDescription||'');x.source||='manual';x.favorite=x.favorite===true;x.blocked=x.blocked===true;x.muted=x.muted===true;x.locationSharing=['precise','approximate','off'].includes(x.locationSharing)?x.locationSharing:'precise';x.nickname||='';return x}
function normalizeTimeline(t){
  t=t&&typeof t==='object'?t:defaultTimeline();t.version=Math.max(2,Number(t.version||1));t.ownerName=norm(t.ownerName||'');t.ownerAvatar=t.ownerAvatar||'';t.updatedAt||=Date.now();
  if(!t.contacts||typeof t.contacts!=='object')t.contacts={};if(!Array.isArray(t.contactOrder))t.contactOrder=[];if(!Array.isArray(t.suppressedContacts))t.suppressedContacts=[];
  t.suppressedContacts=[...new Set(t.suppressedContacts.map(lc).filter(Boolean))];
  for(const [k,v] of Object.entries(t.contacts))t.contacts[k]=normalizeContact({...v,id:k});
  t.contactOrder=t.contactOrder.filter(k=>t.contacts[k]);for(const k of Object.keys(t.contacts))if(!t.contactOrder.includes(k))t.contactOrder.push(k);
  if(!t.threads||typeof t.threads!=='object')t.threads={};if(!Array.isArray(t.threadOrder))t.threadOrder=[];
  for(const [k,v] of Object.entries(t.threads)){v.id=k;v.type=v.type==='group'?'group':'direct';v.title||='';v.contactIds=Array.isArray(v.contactIds)?v.contactIds.filter(Boolean):[];v.messages=Array.isArray(v.messages)?v.messages.map(normalizeMessage):[];v.createdAt||=Date.now()}
  t.threadOrder=t.threadOrder.filter(k=>t.threads[k]);for(const k of Object.keys(t.threads))if(!t.threadOrder.includes(k))t.threadOrder.push(k);
  for(const k of ['calls','posts','stories','notifications','photos','notes','mail'])if(!Array.isArray(t[k]))t[k]=[];
  t.refresh=t.refresh&&typeof t.refresh==='object'?t.refresh:{};t.refresh.chatLength=Math.max(0,Number(t.refresh.chatLength||0));t.refresh.eventKeys=Array.isArray(t.refresh.eventKeys)?t.refresh.eventKeys.slice(-80):[];t.refresh.summary||='';
  return t;
}
function metadataRoot(){
  const c=ctx();if(!c?.chatMetadata||!hasChat())return null;let r=c.chatMetadata[GHP_META_KEY];
  if(!r||typeof r!=='object'){r={version:2,phones:{}};c.chatMetadata[GHP_META_KEY]=r}
  r.version=Math.max(2,Number(r.version||1));if(!r.phones||typeof r.phones!=='object')r.phones={};return r
}
function saveMetadataRoot(r){const c=ctx();if(!c||!r)return;c.chatMetadata[GHP_META_KEY]=r;c.updateChatMetadata?.({[GHP_META_KEY]:r});c.saveMetadataDebounced?.()}
function timeline(create=true){
  const r=metadataRoot();if(!r)return create?defaultTimeline(persona().name,persona().avatar):null;
  const p=persona();let t=r.phones[p.key],oldKey='';
  if(!t){
    const hit=Object.entries(r.phones).find(([,v])=>lc(v?.ownerName)===lc(p.name));
    if(hit){oldKey=hit[0];t=hit[1];r.phones[p.key]=t;if(oldKey!==p.key&&oldKey.startsWith('latent:'))delete r.phones[oldKey]}
  }
  if(!t&&create){t=defaultTimeline(p.name,p.avatar);r.phones[p.key]=t;saveMetadataRoot(r)}
  if(t){t=normalizeTimeline(t);t.ownerName=p.name;t.ownerAvatar=p.avatar||t.ownerAvatar||'';r.phones[p.key]=t;if(oldKey)saveMetadataRoot(r)}
  return t||null;
}
function persist(t,doRender=true){
  const r=metadataRoot();if(!r)return;const p=persona();t=normalizeTimeline(t);t.ownerName=p.name;t.ownerAvatar=p.avatar||t.ownerAvatar||'';t.updatedAt=Date.now();r.phones[p.key]=t;saveMetadataRoot(r);updatePrompt();if(doRender)render()
}
function mutate(fn,doRender=true){const t=timeline();fn(t);persist(t,doRender);return t}

function thumb(ch){const c=ctx();try{if(c?.getThumbnailUrl&&ch?.avatar)return c.getThumbnailUrl('avatar',ch.avatar)}catch{}return ch?.avatar?`/thumbnail?type=avatar&file=${encodeURIComponent(ch.avatar)}`:''}
function findCharacter(name){const c=ctx(),l=lc(name);const i=c?.characters?.findIndex(x=>lc(x?.name)===l)??-1;return i>=0?{character:c.characters[i],index:i}:null}
function unsuppress(t,name){const key=lc(name);t.suppressedContacts=(t.suppressedContacts||[]).filter(x=>x!==key)}
function isSuppressed(t,name){return(t.suppressedContacts||[]).includes(lc(name))}
function upsertContact(t,d){
  const name=norm(d?.name);if(!name||isSuppressed(t,name)&&d?.source!=='manual')return null;
  let x=Object.values(t.contacts).find(c=>d.characterId!==null&&d.characterId!==undefined&&c.characterId!==null&&Number(c.characterId)===Number(d.characterId))||Object.values(t.contacts).find(c=>lc(c.name)===lc(name));
  if(x){x.avatar=d.avatar||x.avatar;if(d.characterId!==undefined&&d.characterId!==null)x.characterId=Number(d.characterId);if(d.personaDescription)x.personaDescription=String(d.personaDescription);return x}
  const cid=d.id||`contact:${id()}`;x=normalizeContact({...d,id:cid,name});t.contacts[cid]=x;t.contactOrder.push(cid);return x;
}
function relationshipDescriptors(){
  const c=ctx(),text=personaDescription(),out=[];if(!c?.characters?.length||!text)return out;
  for(let i=0;i<c.characters.length;i++){const ch=c.characters[i],name=norm(ch?.name);if(!name||name.length<3)continue;const q=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(new RegExp(`(^|[^\\p{L}\\p{N}])${q}([^\\p{L}\\p{N}]|$)`,'iu').test(text))out.push({name,avatar:thumb(ch),characterId:i,source:'relationship'})}
  return out;
}
function lifeDescriptors(){try{return(globalThis.GreyhavenLife?.getPeople?.()||[]).map(p=>{const m=findCharacter(p.name);return{p,m}}).filter(x=>x.m||x.p?.source==='character').map(({p,m})=>({name:p.name,avatar:p.avatar||thumb(m?.character),characterId:m?.index??null,source:'life'}))}catch{return[]}}
function chatDescriptors(){
  const c=ctx(),out=[];if(!c)return out;const add=i=>{i=Number(i);if(!Number.isInteger(i)||i<0)return;const ch=c.characters?.[i];if(ch)out.push({name:ch.name,avatar:thumb(ch),characterId:i,source:'chat'})};
  if(c.groupId){const g=c.groups?.find(x=>String(x?.id)===String(c.groupId)),disabled=new Set(Array.isArray(g?.disabled_members)?g.disabled_members:[]);for(const m of g?.members||[]){const a=typeof m==='string'?m:m?.avatar;if(a&&!disabled.has(a))add(c.characters?.findIndex(ch=>ch?.avatar===a))}}else add(c.characterId);return out;
}
function seedContacts(save=true){
  const t=timeline(),p=persona(),seen=new Set();
  for(const d of [...relationshipDescriptors(),...lifeDescriptors(),...chatDescriptors()]){
    if(!d.name||lc(d.name)===lc(p.name)||seen.has(lc(d.name))||isSuppressed(t,d.name))continue;
    seen.add(lc(d.name));upsertContact(t,d);
  }
  if(save)persist(t,false);return t.contactOrder.map(k=>t.contacts[k]).filter(Boolean);
}
function contact(x){const t=timeline(),l=lc(x);return t.contacts[x]||Object.values(t.contacts).find(c=>lc(c.name)===l||lc(c.nickname)===l)||null}
function directThread(cid){
  const t=timeline();if(!t.contacts[cid])return null;let th=Object.values(t.threads).find(x=>x.type==='direct'&&x.contactIds.length===1&&x.contactIds[0]===cid);if(th)return th;
  th={id:`thread:${id()}`,type:'direct',title:t.contacts[cid].nickname||t.contacts[cid].name,contactIds:[cid],createdAt:Date.now(),messages:[]};t.threads[th.id]=th;t.threadOrder.unshift(th.id);persist(t,false);return th;
}

function phoneForOwner(ownerName,ownerAvatar='',create=true){
  const r=metadataRoot();if(!r)return null;const name=norm(ownerName);if(!name)return null;
  let hit=Object.entries(r.phones).find(([,v])=>lc(v?.ownerName)===lc(name));
  if(hit){const t=normalizeTimeline(hit[1]);t.ownerName=name;t.ownerAvatar=ownerAvatar||t.ownerAvatar||'';return{root:r,key:hit[0],timeline:t}}
  if(!create)return null;
  const key=`latent:${slug(name)}`;const t=defaultTimeline(name,ownerAvatar);r.phones[key]=t;return{root:r,key,timeline:t};
}
function ensurePeerContact(t,name,avatar='',personaDescription=''){
  const match=findCharacter(name);return upsertContact(t,{name,avatar:avatar||thumb(match?.character),characterId:match?.index??null,personaDescription,source:'phone-peer'});
}
function ensureDirectThreadIn(t,cid){
  let th=Object.values(t.threads).find(x=>x.type==='direct'&&x.contactIds.length===1&&x.contactIds[0]===cid);
  if(!th){const c=t.contacts[cid];th={id:`thread:${id()}`,type:'direct',title:c?.nickname||c?.name||'Conversation',contactIds:[cid],createdAt:Date.now(),messages:[]};t.threads[th.id]=th;t.threadOrder.unshift(th.id)}
  return th;
}
function mirrorRichMessageToPhone({phoneOwner,phoneOwnerAvatar='',peerName,peerAvatar='',peerDescription='',senderName,message,unread=false}){
  if(!phoneOwner||!peerName||!message)return;const box=phoneForOwner(phoneOwner,phoneOwnerAvatar,true);if(!box)return;
  const peer=ensurePeerContact(box.timeline,peerName,peerAvatar,peerDescription);if(!peer)return;
  const th=ensureDirectThreadIn(box.timeline,peer.id),source=normalizeMessage(clone(message));
  if(source.mirrorId&&th.messages.some(m=>m.mirrorId===source.mirrorId))return;
  source.id=id();source.sender=senderName;source.senderId=lc(senderName)===lc(phoneOwner)?'owner':peer.id;source.read=!unread;
  th.messages.push(source);
  if(unread)box.timeline.notifications.unshift({id:id(),app:'messages',title:peer.nickname||peer.name,text:notificationTextForMessage(source),timeMs:source.timeMs,read:false,targetId:th.id});
  box.timeline.updatedAt=Date.now();box.root.phones[box.key]=box.timeline;saveMetadataRoot(box.root);
}
function mirrorMessageToPhone({phoneOwner,phoneOwnerAvatar='',peerName,peerAvatar='',peerDescription='',senderName,text,timeMs,unread=false,mirrorId=''}) {
  mirrorRichMessageToPhone({phoneOwner,phoneOwnerAvatar,peerName,peerAvatar,peerDescription,senderName,unread,message:{id:id(),mirrorId,sender:senderName,text,timeMs,read:!unread,type:'text'}});
}
function mirrorSocialToAuthor(kind,authorName,authorAvatar,item){
  const box=phoneForOwner(authorName,authorAvatar,true);if(!box)return;const list=kind==='story'?box.timeline.stories:box.timeline.posts,shared=item.sharedEventId||'';
  if(shared&&list.some(x=>x.sharedEventId===shared))return;
  list.unshift({...clone(item),contactId:'',ownerPost:true});box.timeline.updatedAt=Date.now();box.root.phones[box.key]=box.timeline;saveMetadataRoot(box.root);
}
function mirrorCallToOwner({phoneOwner,phoneOwnerAvatar='',peerName,peerAvatar='',peerDescription='',direction,status,timeMs,sharedCallId}){
  const box=phoneForOwner(phoneOwner,phoneOwnerAvatar,true);if(!box)return;const peer=ensurePeerContact(box.timeline,peerName,peerAvatar,peerDescription);if(!peer)return;
  let call=box.timeline.calls.find(x=>x.sharedCallId===sharedCallId);if(!call){call={id:id(),sharedCallId,contactId:peer.id,contactName:peer.name,direction,status,timeMs,durationSec:0,transcript:[]};box.timeline.calls.unshift(call)}else call.status=status;
  box.timeline.updatedAt=Date.now();box.root.phones[box.key]=box.timeline;saveMetadataRoot(box.root);
}
function updateSharedCallStatus(sharedCallId,status){if(!sharedCallId)return;const r=metadataRoot();if(!r)return;for(const t of Object.values(r.phones))for(const c of(t.calls||[]))if(c.sharedCallId===sharedCallId)c.status=status;saveMetadataRoot(r)}

function threadTitle(th,t=timeline()){if(th.type==='group')return th.title||'Group';const c=t.contacts[th.contactIds[0]];return c?.nickname||c?.name||th.title||'Conversation'}
function avatarHtml(x,cl=''){const n=x?.nickname||x?.name||'?';return x?.avatar?`<div class="ghp-avatar ${cl}"><img src="${esc(x.avatar)}" alt=""></div>`:`<div class="ghp-avatar ghp-avatar-fallback ${cl}">${esc(n[0]?.toUpperCase()||'?')}</div>`}
function threadAvatar(th,t=timeline(),cl=''){const cs=(th.contactIds||[]).map(k=>t.contacts[k]).filter(Boolean);if(th.type==='group'&&cs.length>1)return`<div class="ghp-avatar ghp-avatar-group ${cl}">${cs.slice(0,4).map(c=>c.avatar?`<img src="${esc(c.avatar)}">`:`<span>${esc(c.name[0])}</span>`).join('')}</div>`;return avatarHtml(cs[0],cl)}
function unread(th){const p=persona();return(th.messages||[]).filter(m=>lc(m.sender)!==lc(p.name)&&m.read===false).length}

function mediaDb(){
  if(mediaDbPromise)return mediaDbPromise;
  mediaDbPromise=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB)return reject(new Error('IndexedDB unavailable'));
    const req=indexedDB.open(MEDIA_DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(MEDIA_STORE))db.createObjectStore(MEDIA_STORE)};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('Media database failed'));
  });
  return mediaDbPromise;
}
async function saveMediaBlob(file){
  if(!file)return'';const key=`${chatIdentity()}|${persona().key}|${id()}`;
  try{
    const db=await mediaDb();await new Promise((resolve,reject)=>{const tx=db.transaction(MEDIA_STORE,'readwrite');tx.objectStore(MEDIA_STORE).put(file,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
  }catch(e){console.warn(`[${GHP_MODULE}] media db fallback`,e);mediaMemoryFallback.set(key,file)}
  return key;
}
async function mediaBlob(key){
  if(!key)return null;if(mediaMemoryFallback.has(key))return mediaMemoryFallback.get(key);
  try{const db=await mediaDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(MEDIA_STORE,'readonly'),req=tx.objectStore(MEDIA_STORE).get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)})}catch{return null}
}
async function hydrateMediaPreviews(){
  const o=document.querySelector('#ghp-overlay');if(!o||o.hidden)return;
  for(const el of o.querySelectorAll('[data-media-key]')){
    const key=el.dataset.mediaKey;if(!key||el.dataset.loaded==='1')continue;let url=mediaObjectUrls.get(key);
    if(!url){const blob=await mediaBlob(key);if(blob){url=URL.createObjectURL(blob);mediaObjectUrls.set(key,url)}}
    if(url){el.src=url;el.dataset.loaded='1';el.closest('.ghp-media-visual')?.classList.add('has-local')}
  }
}

function world(){
  const L=globalThis.GreyhavenLife;if(!L)return{available:false,time:now().toISOString(),scene:null,people:[],snapshot:null,status:null,prompt:''};
  try{return{available:true,version:L.version,time:L.getTimeISO?.()||new Date(L.getTime?.()||Date.now()).toISOString(),scene:L.getScene?.()||null,
    people:(L.getPeople?.()||[]).map(p=>({name:p.name,present:!!p.present,location:p.resolved?.location||p.base?.location||'',area:p.resolved?.area||p.base?.area||'',status:p.resolved?.status||p.base?.status||'',availability:p.resolved?.availability||p.base?.availability||'',exceptions:p.exceptions||[]})),
    snapshot:L.getWorldSnapshot?.()||null,status:L.getWorldSnapshotStatus?.()||null,prompt:L.getPromptSummary?.()||''}}catch(e){console.warn(`[${GHP_MODULE}] life`,e);return{available:false,time:now().toISOString(),scene:null,people:[],snapshot:null,status:null,prompt:''}}
}
function recentChat(){
  const c=ctx(),p=profile(),a=Array.isArray(c?.chat)?c.chat.slice(-p.recentMessages):[],lines=[];let chars=0;
  for(let i=a.length-1;i>=0;i--){const m=a[i],txt=String(m?.mes||m?.text||'').trim();if(!txt)continue;const s=m?.name||(m?.is_user?(c?.name1||'User'):(c?.name2||'Character')),line=`${s}: ${txt}`;if(chars+line.length>p.recentChars&&lines.length)break;lines.unshift(line);chars+=line.length}
  return lines.join('\n');
}
function messageContext(m){
  m=normalizeMessage({...m});
  const who=m.sender||'Unknown';
  if(m.type==='photo')return`${who} sent a photo containing: ${m.mediaDescription||'unspecified image'}${m.text?` | caption/message: ${m.text}`:''}`;
  if(m.type==='video')return`${who} sent a video containing: ${m.mediaDescription||'unspecified video'}${m.text?` | caption/message: ${m.text}`:''}`;
  if(m.requestMedia)return`${who} requested a ${m.requestMedia} and wrote: ${m.text}`;
  return`${who}: ${m.text}`;
}
function messagePreview(m){if(!m)return'';if(m.type==='photo')return`Photo${m.text?` · ${m.text}`:''}`;if(m.type==='video')return`Video${m.text?` · ${m.text}`:''}`;return m.text||''}
function notificationTextForMessage(m){if(m.type==='photo')return m.text||'Photo';if(m.type==='video')return m.text||'Video';return m.text||'New message'}
function recentPhone(){
  const t=timeline(),a=[];
  for(const th of Object.values(t.threads))for(const m of(th.messages||[]).slice(-4))a.push({ms:m.timeMs,text:`${threadTitle(th,t)} | ${messageContext(m).slice(0,180)}`});
  for(const x of t.posts.slice(-6))a.push({ms:x.timeMs,text:`Post ${x.author}: ${x.caption}`});
  for(const x of t.stories.slice(-6))a.push({ms:x.timeMs,text:`Story ${x.author}: ${x.caption}`});
  for(const x of t.calls.slice(-6))a.push({ms:x.timeMs,text:`Call ${x.contactName}: ${x.status}`});
  return a.sort((a,b)=>a.ms-b.ms).slice(-30).map(x=>x.text);
}
function recentMentions(name,limit=5){
  const q=lc(name),lines=recentChat().split('\n').filter(Boolean).filter(line=>lc(line).includes(q));
  return lines.slice(-limit);
}
function cardData(c){
  let ch=Number.isInteger(c.characterId)?ctx()?.characters?.[c.characterId]:null;if(!ch)ch=findCharacter(c.name)?.character;const o={};
  if(ch)for(const k of ['name','description','personality','scenario','mes_example']){const v=ch[k]??ch.data?.[k];if(typeof v==='string'&&v.trim())o[k]=v.slice(0,7000)}
  if(!o.description&&c?.personaDescription)o.description=String(c.personaDescription).slice(0,9000);return o;
}
function compactCard(c){const d=cardData(c);return{name:c.name,description:String(d.description||'').slice(0,1200),personality:String(d.personality||'').slice(0,800),scenario:String(d.scenario||'').slice(0,500)}}
function refreshContactContext(c,w){
  const life=w.people.find(p=>lc(p.name)===lc(c.name))||null;
  return{id:c.id,name:c.name,nickname:c.nickname||'',favorite:c.favorite,muted:c.muted,character:compactCard(c),locationEvidence:life?{location:life.location,area:life.area,present:life.present,status:life.status,availability:life.availability}:null,recentMentions:recentMentions(c.name)};
}
function threadRefreshContext(th,t){
  const recent=(th.messages||[]).slice(-8);
  return{id:th.id,title:threadTitle(th,t),type:th.type,members:th.contactIds.map(cid=>t.contacts[cid]?.name).filter(Boolean),lastActivityMs:Number(recent.at(-1)?.timeMs||th.createdAt||0),recent:recent.map(m=>messageContext(m))};
}
function parseJSON(raw){
  if(raw&&typeof raw==='object')return raw;let s=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a>=0&&b>a)s=s.slice(a,b+1);return JSON.parse(s.replace(/,\s*([}\]])/g,'$1'));
}
function emptyRefreshResult(){return{summary:'',messages:[],calls:[],posts:[],stories:[],notifications:[],mail:[]}}
function normalizeRefreshResult(raw){
  let value=raw;if(typeof raw==='string'){try{value=parseJSON(raw)}catch{value=null}}const out=emptyRefreshResult();if(!value||typeof value!=='object')return out;
  out.summary=String(value.summary||'');for(const key of ['messages','calls','posts','stories','notifications','mail'])out[key]=Array.isArray(value[key])?value[key]:[];return out;
}
function refreshEventCount(r){return['messages','calls','posts','stories','notifications','mail'].reduce((sum,key)=>sum+(Array.isArray(r?.[key])?r[key].length:0),0)}
async function generate({prompt,systemPrompt,responseLength=1200}){const c=ctx();if(typeof c?.generateRaw!=='function')throw new Error('SillyTavern generateRaw is unavailable.');return c.generateRaw({prompt,systemPrompt,responseLength,trimNames:false})}
function ensureAmbientRefreshActivity(result,contacts,p){
  const out=normalizeRefreshResult(result),target=p.activityLevel==='busy'?Math.min(p.maxNewEvents,Math.max(3,Math.ceil(p.maxNewEvents*.6))):p.activityLevel==='normal'?Math.min(1,p.maxNewEvents):0;
  let count=refreshEventCount(out);if(count>=target||!contacts.length)return out;
  const installed=p.apps||{},shuffled=[...contacts].sort(()=>Math.random()-.5);let cursor=0;
  const socialTexts=['liked your story','reacted to your story','shared a new post','posted something new'],snapTexts=['sent you a Snap','added to their Story','shared a new Snap'];
  while(count<target&&cursor<Math.max(target*4,contacts.length*3)){
    const c=shuffled[cursor%shuffled.length];cursor++;
    if(installed.snap&&Math.random()<.48){out.notifications.push({app:'snap',from:c.name,text:snapTexts[Math.floor(Math.random()*snapTexts.length)]});count++;continue}
    if(installed.social){out.notifications.push({app:'social',from:c.name,text:socialTexts[Math.floor(Math.random()*socialTexts.length)]});count++;continue}
    if(installed.messages){out.messages.push({threadId:'',sender:c.name,text:'You around?'});count++;continue}
    break;
  }
  if(!out.summary&&count)out.summary='Ambient phone activity';return out;
}

async function refreshPhone(){
  if(refreshBusy)return;if(!hasChat()){globalThis.toastr?.warning?.('Open a chat first.');return}
  refreshBusy=true;islandText='Refreshing phone…';islandIcon='fa-solid fa-satellite-dish';render();
  try{
    seedContacts(true);
    const t=timeline(),p=profile(),owner=persona(),w=world();
    const contacts=t.contactOrder.map(k=>t.contacts[k]).filter(c=>c&&!c.blocked).map(c=>refreshContactContext(c,w));
    if(!contacts.length){globalThis.toastr?.warning?.('No relevant contacts yet.');return}
    const threads=t.threadOrder.map(k=>t.threads[k]).filter(Boolean).map(th=>threadRefreshContext(th,t));
    const minEvents=p.activityLevel==='busy'?Math.min(p.maxNewEvents,Math.max(3,Math.ceil(p.maxNewEvents*.6))):p.activityLevel==='normal'?Math.min(1,p.maxNewEvents):0;
    const systemPrompt=`You simulate background activity on a fictional iPhone inside an ongoing roleplay.
Return ONLY one valid JSON object. No markdown and no commentary.
Use Greyhaven Life as authoritative current time/world state when available.
Use ONLY ALLOWED CONTACTS.
Never teleport contacts to the phone owner's location. The owner's current scene/location is NOT evidence that another contact is there.
A contact may mention/post a specific location only when that contact's own LOCATION EVIDENCE or RECENT MENTIONS clearly supports it. When there is no evidence, keep their post/message location-neutral.
Existing message threads matter. If a contact has a recent active conversation, new messages should usually continue it naturally, behave like a double-text, or follow the same topic. Do not abruptly reset to a generic unrelated invitation. If enough RP time has passed, a new topic is fine.
If you add a message to an existing thread, use that exact threadId when possible.
Do not repeat existing phone history.
Do not invent major plot developments, emergencies, betrayals, travel or secrets merely to create activity.
Harmless everyday activity is allowed even with little context.
A message can optionally contain fictional media. For a photo/video, set mediaType to "photo" or "video" and describe exactly what the recipient would see in mediaDescription. It may also include text, or mediaDescription may stand alone.
NORMAL should normally create at least ${minEvents} event. BUSY must create at least ${minEvents} unless installed apps prevent it. QUIET may return zero.
Maximum total events: ${p.maxNewEvents}.
Required JSON shape:
{"summary":"short note","messages":[{"threadId":"","sender":"Name","text":"optional text","mediaType":"","mediaDescription":""}],"calls":[{"contact":"Name","status":"missed"}],"posts":[{"author":"Name","visual":"photo description","caption":"caption","likes":12,"comments":2}],"stories":[{"author":"Name","visual":"story description","caption":"caption"}],"notifications":[{"app":"social","from":"Name","text":"liked your story"}],"mail":[]}
Use empty arrays where there is no activity.`;
    const prompt=`ROLEPLAY TIME:
${w.time}

PHONE OWNER:
${owner.name}

ACTIVITY LEVEL:
${p.activityLevel}

MINIMUM DESIRED EVENTS:
${minEvents}

MAXIMUM TOTAL EVENTS:
${p.maxNewEvents}

INSTALLED APPS:
${JSON.stringify(p.apps)}

ALLOWED CONTACTS WITH THEIR OWN LOCATION EVIDENCE:
${JSON.stringify(contacts)}

EXISTING THREADS WITH RECENT TAILS:
${JSON.stringify(threads)}

GREYHAVEN LIFE WORLD:
${JSON.stringify({scene:w.scene,people:w.people,snapshot:w.snapshot,snapshotStatus:w.status})}

RECENT MAIN RP:
${recentChat()||'(none)'}

RECENT PHONE HISTORY TO AVOID REPEATING:
${JSON.stringify(recentPhone())}

Generate plausible NEW activity now. Respect each person's own location evidence.`;
    const raw=await generate({prompt,systemPrompt,responseLength:p.responseTokens}),parsed=normalizeRefreshResult(raw),result=ensureAmbientRefreshActivity(parsed,contacts,p),before=refreshEventCount(parsed),after=refreshEventCount(result);
    applyRefresh(result);globalThis.toastr?.success?.(after?`Phone refreshed · ${after} new event${after===1?'':'s'}`:'Phone refreshed · nothing new this time');
    if(!before&&after)console.info(`[${GHP_MODULE}] AI returned no usable refresh events; ambient fallback supplied ${after}.`);
  }catch(e){
    console.error(`[${GHP_MODULE}] refresh`,e);
    try{const p=profile(),t=timeline(),w=world(),contacts=t.contactOrder.map(k=>t.contacts[k]).filter(c=>c&&!c.blocked).map(c=>refreshContactContext(c,w)),fallback=ensureAmbientRefreshActivity(emptyRefreshResult(),contacts,p);if(refreshEventCount(fallback)){applyRefresh(fallback);globalThis.toastr?.warning?.('AI refresh failed, so Phone added safe ambient activity instead.')}else globalThis.toastr?.error?.(`Phone refresh failed: ${e?.message||e}`)}catch{globalThis.toastr?.error?.(`Phone refresh failed: ${e?.message||e}`)}
  }finally{refreshBusy=false;islandText='';islandIcon='';render()}
}

function appendIncomingMessage(t,th,c,{text='',mediaType='',mediaDescription=''},stamp,unreadFlag=true){
  const items=[];
  if(String(text||'').trim())items.push({type:'text',text:String(text).trim()});
  if(['photo','video'].includes(mediaType)&&String(mediaDescription||'').trim())items.push({type:mediaType,text:'',mediaDescription:String(mediaDescription).trim()});
  if(!items.length)return 0;
  for(const item of items){
    const mirrorId=`mirror:${id()}`,msg=normalizeMessage({id:id(),mirrorId,sender:c.name,senderId:c.id,text:item.text,type:item.type,mediaDescription:item.mediaDescription||'',timeMs:stamp,read:!unreadFlag});
    th.messages.push(msg);
    mirrorRichMessageToPhone({phoneOwner:c.name,phoneOwnerAvatar:c.avatar,peerName:persona().name,peerAvatar:persona().avatar,peerDescription:persona().description,senderName:c.name,message:msg,unread:false});
  }
  return items.length;
}
function applyRefresh(r){
  const t=timeline(),installed=profile().apps,allowed=new Map(Object.values(t.contacts).map(c=>[lc(c.name),c])),keys=new Set(t.refresh.eventKeys||[]),stamp=now().getTime(),max=profile().maxNewEvents;let count=0;
  const addKey=k=>{keys.add(k);t.refresh.eventKeys=[...keys].slice(-80)};
  if(installed.messages)for(const x of Array.isArray(r?.messages)?r.messages:[]){
    if(count>=max)break;const c=allowed.get(lc(x.sender)),text=String(x.text||'').trim(),mediaType=['photo','video'].includes(x.mediaType)?x.mediaType:'',mediaDescription=String(x.mediaDescription||'').trim();
    if(!c||c.blocked||(!text&&!mediaDescription))continue;const key=`m:${c.name}:${text.toLowerCase().slice(0,80)}:${mediaType}:${mediaDescription.toLowerCase().slice(0,80)}`;if(keys.has(key))continue;
    let th=x.threadId&&t.threads[x.threadId]?t.threads[x.threadId]:Object.values(t.threads).find(v=>v.type==='direct'&&v.contactIds[0]===c.id);
    if(!th){th={id:`thread:${id()}`,type:'direct',title:c.nickname||c.name,contactIds:[c.id],createdAt:stamp,messages:[]};t.threads[th.id]=th;t.threadOrder.unshift(th.id)}
    if(th.type==='group'&&!th.contactIds.includes(c.id))continue;
    appendIncomingMessage(t,th,c,{text,mediaType,mediaDescription},stamp,true);
    if(!c.muted)t.notifications.unshift({id:id(),app:'messages',title:c.nickname||c.name,text:text||(mediaType==='video'?'Video':'Photo'),timeMs:stamp,read:false,targetId:th.id});
    addKey(key);count++;
  }
  if(installed.phone)for(const x of Array.isArray(r?.calls)?r.calls:[]){
    if(count>=max)break;const c=allowed.get(lc(x.contact));if(!c||c.blocked)continue;const st=x.status==='incoming'?'incoming':'missed',key=`c:${c.name}:${st}:${Math.floor(stamp/3600000)}`;if(keys.has(key))continue;
    const sharedCallId=`call:${id()}`,call={id:id(),sharedCallId,contactId:c.id,contactName:c.name,direction:'incoming',status:st,timeMs:stamp,durationSec:0,transcript:[]};t.calls.unshift(call);
    if(!c.muted)t.notifications.unshift({id:id(),app:'phone',title:st==='missed'?`Missed call · ${c.name}`:`${c.name} is calling`,text:st==='missed'?'Tap to call back':'Incoming call',timeMs:stamp,read:false,targetId:call.id});
    mirrorCallToOwner({phoneOwner:c.name,phoneOwnerAvatar:c.avatar,peerName:persona().name,peerAvatar:persona().avatar,peerDescription:persona().description,direction:'outgoing',status:st==='missed'?'no answer':'active',timeMs:stamp,sharedCallId});addKey(key);count++;
  }
  if(installed.social)for(const x of Array.isArray(r?.posts)?r.posts:[]){
    if(count>=max)break;const c=allowed.get(lc(x.author)),cap=String(x.caption||'').trim(),vis=String(x.visual||'').trim();if(!c||c.blocked||(!cap&&!vis))continue;
    const key=`p:${c.name}:${cap.toLowerCase().slice(0,80)}:${vis.toLowerCase().slice(0,60)}`;if(keys.has(key))continue;
    const sharedEventId=`post:${id()}`,post={id:id(),sharedEventId,author:c.name,contactId:c.id,visual:vis,caption:cap,likes:Math.max(0,Number(x.likes||0)),comments:Math.max(0,Number(x.comments||0)),timeMs:stamp};t.posts.unshift(post);mirrorSocialToAuthor('post',c.name,c.avatar,post);
    if(!c.muted)t.notifications.unshift({id:id(),app:'social',title:`${c.name} posted`,text:cap||vis,timeMs:stamp,read:false});addKey(key);count++;
  }
  if(installed.social)for(const x of Array.isArray(r?.stories)?r.stories:[]){
    if(count>=max)break;const c=allowed.get(lc(x.author)),cap=String(x.caption||'').trim(),vis=String(x.visual||'').trim();if(!c||c.blocked||(!cap&&!vis))continue;
    const key=`s:${c.name}:${cap.toLowerCase().slice(0,80)}:${vis.toLowerCase().slice(0,60)}`;if(keys.has(key))continue;
    const sharedEventId=`story:${id()}`,story={id:id(),sharedEventId,author:c.name,contactId:c.id,visual:vis,caption:cap,timeMs:stamp,expiresAt:stamp+86400000,viewed:false};t.stories.unshift(story);mirrorSocialToAuthor('story',c.name,c.avatar,story);addKey(key);count++;
  }
  for(const x of Array.isArray(r?.notifications)?r.notifications:[]){
    if(count>=max)break;const c=allowed.get(lc(x.from)),text=String(x.text||'').trim(),a=x.app==='snap'?'snap':'social';if(!installed[a]||!c||c.blocked||!text)continue;
    const key=`n:${a}:${c.name}:${text.toLowerCase().slice(0,100)}`;if(keys.has(key))continue;if(!c.muted)t.notifications.unshift({id:id(),app:a,title:c.nickname||c.name,text,timeMs:stamp,read:false});addKey(key);count++;
  }
  if(profile().apps.mail)for(const x of Array.isArray(r?.mail)?r.mail:[]){
    if(count>=max)break;const from=norm(x.from),sub=String(x.subject||'').trim(),body=String(x.body||'').trim();if(!from||!sub||!body)continue;
    const key=`e:${from}:${sub}`.toLowerCase();if(keys.has(key))continue;t.mail.unshift({id:id(),from,subject:sub,body,timeMs:stamp,read:false});t.notifications.unshift({id:id(),app:'mail',title:from,text:sub,timeMs:stamp,read:false});addKey(key);count++;
  }
  t.refresh.lastAt=Date.now();t.refresh.chatLength=Array.isArray(ctx()?.chat)?ctx().chat.length:0;t.refresh.summary=String(r?.summary||'').trim();persist(t,false);
}

function cleanPlainReply(raw){
  let text=String(raw||'').trim().replace(/^```(?:text|txt)?\s*/i,'').replace(/\s*```$/,'').trim();
  if(!text||text==='{}'||text==='[]')return'';text=text.replace(/^["“](.*)["”]$/s,'$1').trim();return text;
}
function parseDirectReply(raw){
  const text=cleanPlainReply(raw);if(!text)return[];
  const out=[];
  for(const line of text.split(/\n+/)){
    const m=line.trim().match(/^(TEXT|PHOTO|VIDEO)\s*:\s*(.*)$/i);if(!m)continue;
    const kind=m[1].toLowerCase(),value=String(m[2]||'').trim();if(!value)continue;
    if(kind==='text')out.push({type:'text',text:value});else out.push({type:kind,mediaDescription:value,text:''});
  }
  if(!out.length)out.push({type:'text',text});return out.slice(0,4);
}
function parseGroupReply(raw,contacts){
  const allowed=new Map(contacts.map(c=>[lc(c.name),c])),out=[];
  for(const line of cleanPlainReply(raw).split(/\n+/)){const match=line.trim().match(/^([^:]{1,80}):\s*(.+)$/s);if(!match)continue;const c=allowed.get(lc(match[1])),text=String(match[2]||'').trim();if(c&&text)out.push({sender:c.name,type:'text',text})}
  return out.slice(0,4);
}
function conversationTail(conversation,n=24){return conversation.slice(-n).map(messageContext)}

async function generateReply(th,mode='text'){
  const t=timeline(),owner=persona(),contacts=th.contactIds.map(k=>t.contacts[k]).filter(Boolean);if(!contacts.length)return;
  replyBusy=true;islandText=mode==='call'?'On call…':'Typing…';islandIcon=mode==='call'?'fa-solid fa-phone':'fa-solid fa-ellipsis';render();
  try{
    const w=world(),activeCall=mode==='call'&&callId?t.calls.find(x=>x.id===callId):null,conversation=mode==='call'?(activeCall?.transcript||[]):th.messages;let replies=[];
    if(th.type==='direct'){
      const c=contacts[0],latest=conversation.at(-1),requested=mode==='text'&&latest?.requestMedia;
      if(mode==='call'){
        const systemPrompt=`You are ${c.name}, having a private phone call with ${owner.name} inside an ongoing fictional roleplay.
Reply ONLY with what ${c.name} says aloud. No JSON, speaker label, narration or stage directions.
Preserve the established personality/relationship. Use Greyhaven Life as authoritative world/time context when available.`;
        const prompt=`PHONE OWNER:
${owner.name}

OWNER / RELATIONSHIP CONTEXT:
${owner.description.slice(0,10000)||'(not found)'}

CONTACT:
${JSON.stringify({name:c.name,character:cardData(c),life:w.people.find(p=>lc(p.name)===lc(c.name))||null})}

GREYHAVEN LIFE:
${JSON.stringify({time:w.time,scene:w.scene,people:w.people,snapshot:w.snapshot})}

RECENT MAIN RP:
${recentChat()}

CALL TRANSCRIPT:
${JSON.stringify((activeCall?.transcript||[]).slice(-24).map(x=>`${x.sender}: ${x.text}`))}

Give ${c.name}'s next spoken reply now.`;
        let raw=await generate({prompt,systemPrompt,responseLength:500}),text=cleanPlainReply(raw);
        if(!text)raw=await generate({prompt:`Reply naturally as ${c.name} in this phone call. Return only one spoken reply.`,systemPrompt:`You are ${c.name}. No JSON.`,responseLength:300}),text=cleanPlainReply(raw);
        if(text)replies=[{sender:c.name,type:'text',text}];
      }else{
        const systemPrompt=`You are ${c.name}, texting privately with ${owner.name} inside an ongoing fictional roleplay.
Preserve ${c.name}'s established personality, relationship and knowledge.
Use Greyhaven Life as authoritative current world/time context when available.
You may reply with text, a fictional photo, a fictional video, or text plus one media item.
If ${owner.name} explicitly requested a photo/video, you are NOT forced to send it. Decide in character. Refusal, teasing, delay, changing the subject, or sending something different are valid when appropriate.
If you send media, describe only what the recipient would actually see. Do not claim the AI viewed a real uploaded file.
Return 1-3 lines using ONLY these formats:
TEXT: message text
PHOTO: concise visual description of the photo
VIDEO: concise visual description of the video
No JSON, speaker labels, markdown or narration.`;
        const prompt=`PHONE OWNER:
${owner.name}

OWNER / RELATIONSHIP CONTEXT:
${owner.description.slice(0,10000)||'(not found)'}

CONTACT:
${JSON.stringify({name:c.name,character:cardData(c),life:w.people.find(p=>lc(p.name)===lc(c.name))||null})}

GREYHAVEN LIFE:
${JSON.stringify({time:w.time,scene:w.scene,people:w.people,snapshot:w.snapshot})}

RECENT MAIN RP:
${recentChat()}

TEXT THREAD:
${JSON.stringify(conversationTail(conversation,26))}

LATEST REQUEST MODE:
${requested?`The latest message explicitly requested a ${requested}. You may comply or refuse naturally.`:'No explicit media request.'}

Continue the conversation naturally.`;
        let raw=await generate({prompt,systemPrompt,responseLength:700}),items=parseDirectReply(raw);
        if(!items.length){raw=await generate({prompt:`Reply as ${c.name} to the latest phone message. Return TEXT: followed by a natural reply.`,systemPrompt:`You are ${c.name}.`,responseLength:350});items=parseDirectReply(raw)}
        replies=items.map(x=>({sender:c.name,...x}));
      }
    }else{
      const systemPrompt=`Simulate the next messages in this fictional group text thread.
Return 1-4 lines only. Every line MUST use exactly: Sender Name: message
Only these senders may respond: ${contacts.map(c=>c.name).join(', ')}
No JSON, markdown or narration.`;
      const prompt=`PHONE OWNER: ${owner.name}
CONTACT DATA: ${JSON.stringify(contacts.map(c=>({name:c.name,character:compactCard(c),life:w.people.find(p=>lc(p.name)===lc(c.name))||null})))}
GREYHAVEN LIFE: ${JSON.stringify({time:w.time,scene:w.scene,people:w.people,snapshot:w.snapshot})}
THREAD:
${conversation.slice(-24).map(messageContext).join('\n')}
Continue naturally.`;
      replies=parseGroupReply(await generate({prompt,systemPrompt,responseLength:700}),contacts);
    }
    if(!replies.length)throw new Error('The model returned no usable phone reply.');
    const allowed=new Map(contacts.map(c=>[lc(c.name),c])),stamp=now().getTime();
    mutate(cur=>{
      const target=cur.threads[th.id];if(!target)return;
      for(const x of replies){
        const c=allowed.get(lc(x.sender));if(!c)continue;
        if(mode==='call'&&callId){const call=cur.calls.find(v=>v.id===callId);if(call)call.transcript.push({sender:c.name,text:String(x.text||'').trim(),timeMs:stamp});continue}
        const text=String(x.text||'').trim(),mediaDescription=String(x.mediaDescription||'').trim(),type=['photo','video'].includes(x.type)?x.type:'text';
        if(type==='text'&&!text)continue;if(type!=='text'&&!mediaDescription)continue;
        const mirrorId=`mirror:${id()}`,msg=normalizeMessage({id:id(),mirrorId,sender:c.name,senderId:c.id,text,type,mediaDescription,timeMs:stamp,read:true});
        target.messages.push(msg);
        if(target.type==='direct')mirrorRichMessageToPhone({phoneOwner:c.name,phoneOwnerAvatar:c.avatar,peerName:owner.name,peerAvatar:owner.avatar,peerDescription:owner.description,senderName:c.name,message:msg,unread:false});
      }
    },false);
  }catch(e){console.error(`[${GHP_MODULE}] reply`,e);globalThis.toastr?.error?.(`Phone reply failed: ${e?.message||e}`)}
  finally{replyBusy=false;islandText='';islandIcon='';render()}
}
function sendThread(tid,text,mode='text',opts={}){
  text=String(text||'').trim();if((!text&&mode==='text')||replyBusy)return;const owner=persona(),stamp=now().getTime();let th;
  mutate(t=>{
    th=t.threads[tid];if(!th)return;
    if(mode==='call'&&callId){const c=t.calls.find(v=>v.id===callId);if(c&&text)c.transcript.push({sender:owner.name,text,timeMs:stamp});return}
    const mirrorId=`mirror:${id()}`,msg=normalizeMessage({id:id(),mirrorId,sender:owner.name,senderId:owner.key,text,timeMs:stamp,read:true,type:'text',requestMedia:opts.requestMedia||''});
    th.messages.push(msg);
    if(th.type==='direct'){const peer=t.contacts[th.contactIds[0]];if(peer)mirrorRichMessageToPhone({phoneOwner:peer.name,phoneOwnerAvatar:peer.avatar,peerName:owner.name,peerAvatar:owner.avatar,peerDescription:owner.description,senderName:owner.name,message:msg,unread:true})}
  },false);
  if(th)generateReply(th,mode);
}
function sendMediaMessage(tid,kind,description,caption='',mediaKey=''){
  if(replyBusy||!['photo','video'].includes(kind))return;description=String(description||'').trim();caption=String(caption||'').trim();if(!description)return;
  const owner=persona(),stamp=now().getTime();let th;
  mutate(t=>{
    th=t.threads[tid];if(!th)return;const mirrorId=`mirror:${id()}`,msg=normalizeMessage({id:id(),mirrorId,sender:owner.name,senderId:owner.key,text:caption,type:kind,mediaDescription:description,mediaKey,timeMs:stamp,read:true});
    th.messages.push(msg);
    if(th.type==='direct'){const peer=t.contacts[th.contactIds[0]];if(peer)mirrorRichMessageToPhone({phoneOwner:peer.name,phoneOwnerAvatar:peer.avatar,peerName:owner.name,peerAvatar:owner.avatar,peerDescription:owner.description,senderName:owner.name,message:msg,unread:true})}
  },false);
  if(th)generateReply(th,'text');
}


function stale(){const t=timeline(false),n=Array.isArray(ctx()?.chat)?ctx().chat.length:0,d=Math.max(0,n-Number(t?.refresh?.chatLength||0));return{stale:!t?.refresh?.lastAt||d>=profile().staleAfterMessages,newMessages:d}}
function wallpaper(){const p=profile();if(p.wallpaperUrl)return`background-image:linear-gradient(rgba(5,6,10,.12),rgba(5,6,10,.28)),url("${String(p.wallpaperUrl).replace(/["'()]/g,'')}");`;return`background:${WALLPAPERS[p.wallpaper]||WALLPAPERS.aurora};`}
function appUnread(a){const t=timeline(false);if(!t)return 0;if(a==='messages')return Object.values(t.threads).reduce((s,th)=>s+unread(th),0);if(a==='mail')return t.mail.filter(x=>!x.read).length;return t.notifications.filter(x=>x.app===a&&!x.read).length}
function icon(a,dock=false){const x=APPS[a],b=appUnread(a);return`<button class="ghp-app-icon ${dock?'is-dock':''}" data-open-app="${a}"><span class="ghp-app-square" style="--t:${x.tint}"><i class="${x.icon}"></i>${b?`<b class="ghp-badge">${b>99?'99+':b}</b>`:''}</span>${dock?'':`<small>${esc(x.label)}</small>`}</button>`}
function statusBar(){return`<div class="ghp-status"><span>${esc(timeText())}</span><button class="ghp-island ${islandText?'wide':''}" type="button"><i class="${islandIcon||'fa-solid fa-circle'}"></i><em>${esc(islandText)}</em></button><span><i class="fa-solid fa-signal"></i><i class="fa-solid fa-wifi"></i><i class="fa-solid fa-battery-three-quarters"></i></span></div>`}
function notifCards(){const t=timeline(),p=profile(),n=t.notifications.filter(x=>!x.read&&p.apps[x.app]!==false).slice(0,3);return n.length?n.map(x=>`<button class="ghp-lock-notif" data-notif="${esc(x.id)}"><i class="${APPS[x.app]?.icon||'fa-solid fa-bell'}"></i><span><b>${esc(x.title)}</b><small>${p.notificationPreviews?esc(x.text):'Notification'}</small></span><time>${esc(rel(x.timeMs))}</time></button>`).join(''):`<div class="ghp-lock-empty">No new notifications</div>`}
function renderLock(){return`<div class="ghp-screen ghp-lock" style="${wallpaper()}">${statusBar()}<main><i class="fa-solid fa-lock"></i><h1>${esc(timeText())}</h1><h2>${esc(dateText())}</h2><section>${notifCards()}</section></main><button class="ghp-unlock" data-unlock>Tap to unlock <i class="fa-solid fa-chevron-up"></i></button><div class="ghp-indicator"></div></div>`}
function renderHome(){
  const p=profile(),installed=Object.entries(p.apps).filter(([k,v])=>v&&k!=='settings').map(([k])=>k),dock=['phone','messages','social','snap'].filter(k=>p.apps[k]).slice(0,4),grid=installed.filter(k=>!dock.includes(k)),s=stale(),own=persona();
  return`<div class="ghp-screen ghp-home" style="${wallpaper()}">${statusBar()}<div class="ghp-widgets"><div><b>${esc(timeText())}</b><span>${esc(dateText(now(),true))}</span></div><button data-refresh class="${s.stale?'stale':''}"><i class="fa-solid fa-arrows-rotate"></i><span>${refreshBusy?'Refreshing…':s.stale?(s.newMessages>99?'Lots of new RP context':s.newMessages?`${s.newMessages} new RP messages`:'Phone needs refresh'):'Phone up to date'}</span></button></div><div class="ghp-grid">${grid.map(k=>icon(k)).join('')}${icon('settings')}</div><div class="ghp-owner">${avatarHtml({name:own.name,avatar:own.avatar},'small')}<span>${esc(own.name)}'s ${esc(p.deviceName)}</span></div><div class="ghp-dock">${dock.map(k=>icon(k,true)).join('')}</div><div class="ghp-indicator"></div></div>`;
}
function header(title,sub='',right=''){return`<header class="ghp-app-header"><button data-home><i class="fa-solid fa-chevron-left"></i></button><div><b>${esc(title)}</b>${sub?`<small>${esc(sub)}</small>`:''}</div><span>${right}</span></header>`}
function empty(iconClass,title,text,action=''){return`<div class="ghp-empty"><i class="${iconClass}"></i><b>${esc(title)}</b><span>${esc(text)}</span>${action}</div>`}

function renderMessages(){
  const t=timeline(),ths=t.threadOrder.map(k=>t.threads[k]).filter(Boolean).sort((a,b)=>Number(b.messages.at(-1)?.timeMs||b.createdAt||0)-Number(a.messages.at(-1)?.timeMs||a.createdAt||0));
  return`<div class="ghp-app">${header('Messages','','<button data-new-thread><i class="fa-solid fa-pen-to-square"></i></button>')}<main>${ths.length?ths.map(th=>{const last=th.messages.at(-1),u=unread(th);return`<button class="ghp-row" data-thread="${esc(th.id)}">${threadAvatar(th,t)}<span><b>${esc(threadTitle(th,t))}</b><small>${last?`${last.sender===persona().name?'You: ':''}${esc(messagePreview(last))}`:'Start a conversation'}</small></span><em><time>${last?esc(rel(last.timeMs)):''}</time>${u?`<i>${u}</i>`:''}</em></button>`}).join(''):empty('fa-regular fa-comments','No conversations yet','Start a chat with a relevant contact.','<button data-new-thread>New message</button>')}</main></div>`;
}
function markRead(tid){mutate(t=>{const th=t.threads[tid];if(th)for(const m of th.messages)if(m.sender!==persona().name)m.read=true;for(const n of t.notifications)if(n.app==='messages'&&n.targetId===tid)n.read=true},false)}
function renderMediaVisual(m){
  const icon=m.type==='video'?'fa-solid fa-video':'fa-regular fa-image',label=m.type==='video'?'Video':'Photo';
  const local=m.mediaKey?(m.type==='video'?`<video data-media-key="${esc(m.mediaKey)}" controls playsinline preload="metadata"></video>`:`<img data-media-key="${esc(m.mediaKey)}" alt="${esc(m.mediaDescription||label)}">`):'';
  return`<div class="ghp-media-visual ${m.mediaKey?'has-key':''}">${local}<div class="ghp-media-placeholder"><i class="${icon}"></i><b>${label}</b><span>${esc(m.mediaDescription||`${label} attachment`)}</span>${m.mediaKey?'<small>Local preview</small>':''}</div></div>${m.text?`<p class="ghp-media-caption">${esc(m.text)}</p>`:''}`;
}
function renderMessageBubble(m,th){
  const mine=m.sender===persona().name,groupName=th.type==='group'&&!mine?`<small class="ghp-msg-sender">${esc(m.sender)}</small>`:'';
  const body=m.type==='photo'||m.type==='video'?renderMediaVisual(m):`<p>${esc(m.text)}</p>`;
  const request=m.requestMedia?`<small class="ghp-msg-request"><i class="${m.requestMedia==='video'?'fa-solid fa-video':'fa-regular fa-image'}"></i> Requested a ${esc(m.requestMedia)}</small>`:'';
  return`<div class="ghp-msg ${mine?'mine':''} ${m.type!=='text'?'has-media':''}">${groupName}${body}${request}<time>${esc(timeText(new Date(m.timeMs)))}</time></div>`;
}
function renderThread(){
  const t=timeline(),th=t.threads[threadId];if(!th){app='messages';return renderMessages()}markRead(th.id);
  const direct=th.type==='direct',cid=direct?th.contactIds[0]:'';
  const tools=`<span class="ghp-thread-tools">${direct?`<button data-call="${esc(cid)}"><i class="fa-solid fa-phone"></i></button>`:''}<button data-thread-menu="${esc(th.id)}"><i class="fa-solid fa-ellipsis"></i></button></span>`;
  const armed=composeRequest.threadId===th.id&&composeRequest.kind;
  const requestBanner=armed?`<div class="ghp-request-banner"><i class="${armed==='video'?'fa-solid fa-video':'fa-regular fa-image'}"></i><span>Requesting a ${esc(armed)} · send your request next</span><button data-cancel-media-request><i class="fa-solid fa-xmark"></i></button></div>`:'';
  return`<div class="ghp-app ghp-thread">${header(threadTitle(th,t),th.type==='group'?`${th.contactIds.length} people`:'iMessage',tools)}<main>${th.messages.slice(-100).map(m=>renderMessageBubble(m,th)).join('')}${replyBusy?'<div class="ghp-typing"><i></i><i></i><i></i></div>':''}</main>${requestBanner}<form data-thread-form="${esc(th.id)}"><button type="button" class="ghp-plus" data-media-menu="${esc(th.id)}" ${replyBusy?'disabled':''}><i class="fa-solid fa-plus"></i></button><input placeholder="${armed?`Ask for the ${armed}…`:'iMessage'}" ${replyBusy?'disabled':''}><button ${replyBusy?'disabled':''}><i class="fa-solid fa-arrow-up"></i></button></form></div>`;
}

function renderPhone(){
  const t=timeline();return`<div class="ghp-app">${header('Phone')}<main>${t.calls.length?t.calls.slice(0,60).map(c=>{const co=t.contacts[c.contactId]||{name:c.contactName};return`<div class="ghp-call-row">${avatarHtml(co)}<button data-call="${esc(c.contactId)}"><b>${esc(c.contactName)}</b><small>${esc(c.status)}</small></button><time>${esc(rel(c.timeMs))}</time></div>`}).join(''):empty('fa-solid fa-phone','No recent calls','Calls in this timeline will appear here.')}</main></div>`;
}
function renderCall(){
  const t=timeline(),c=t.calls.find(x=>x.id===callId);if(!c){app='phone';return renderPhone()}const co=t.contacts[c.contactId]||{name:c.contactName},th=directThread(c.contactId);
  return`<div class="ghp-call-screen">${statusBar()}<section>${avatarHtml(co,'huge')}<h1>${esc(co.nickname||co.name)}</h1><small>${c.status==='active'?'call in progress':esc(c.status)}</small></section><main>${(c.transcript||[]).slice(-30).map(x=>`<div class="${x.sender===persona().name?'mine':''}"><b>${esc(x.sender)}</b><span>${esc(x.text)}</span></div>`).join('')}${replyBusy?'<div class="ghp-typing"><i></i><i></i><i></i></div>':''}</main><div class="ghp-call-actions"><button><i class="fa-solid fa-microphone-slash"></i><small>mute</small></button><button><i class="fa-solid fa-volume-high"></i><small>speaker</small></button><button data-end-call><i class="fa-solid fa-phone-slash"></i><small>end</small></button></div><form data-call-form="${esc(th?.id||'')}"><input placeholder="Say something…" ${replyBusy?'disabled':''}><button ${replyBusy?'disabled':''}><i class="fa-solid fa-arrow-up"></i></button></form></div>`;
}
function renderContacts(){
  const t=timeline(),cs=t.contactOrder.map(k=>t.contacts[k]).filter(Boolean).sort((a,b)=>Number(b.favorite)-Number(a.favorite)||a.name.localeCompare(b.name)),removed=t.suppressedContacts?.length||0;
  return`<div class="ghp-app">${header('Contacts','','<button data-add-contact><i class="fa-solid fa-plus"></i></button>')}<main><button class="ghp-discover" data-discover><i class="fa-solid fa-wand-magic-sparkles"></i> Discover relevant contacts</button>${removed?`<button class="ghp-removed-row" data-removed-contacts><i class="fa-solid fa-user-slash"></i><span><b>Removed Contacts</b><small>${removed} hidden from automatic discovery</small></span><i class="fa-solid fa-chevron-right"></i></button>`:''}${cs.map(c=>`<button class="ghp-row" data-contact="${esc(c.id)}">${avatarHtml(c)}<span><b>${esc(c.nickname||c.name)}</b><small>${c.favorite?'★ Favorite · ':''}${esc(c.source)}</small></span><em><i class="fa-solid fa-chevron-right"></i></em></button>`).join('')}</main></div>`;
}
function renderContact(){
  const c=contact(contactId);if(!c){app='contacts';return renderContacts()}let l=null;try{l=globalThis.GreyhavenLife?.getPerson?.(c.name)}catch{}const loc=l?.resolved?[l.resolved.location,l.resolved.area].filter(Boolean).join(' · '):'';
  return`<div class="ghp-app">${header(c.nickname||c.name)}<main class="ghp-contact-card">${avatarHtml(c,'hero')}<h1>${esc(c.nickname||c.name)}</h1>${c.nickname?`<small>${esc(c.name)}</small>`:''}<div class="ghp-contact-actions"><button data-message-contact="${esc(c.id)}"><i class="fa-solid fa-comment"></i><span>message</span></button><button data-call="${esc(c.id)}"><i class="fa-solid fa-phone"></i><span>call</span></button></div>${loc?`<div class="ghp-life-link"><i class="fa-solid fa-location-dot"></i><span><b>Greyhaven Life</b><small>${esc(loc)}</small></span></div>`:''}<div class="ghp-settings-list"><label><span><b>Nickname</b><small>Phone-only display name</small></span><input data-nickname="${esc(c.id)}" value="${esc(c.nickname||'')}"></label><label><span><b>Favorite</b></span><input type="checkbox" data-favorite="${esc(c.id)}" ${c.favorite?'checked':''}></label><label><span><b>Mute notifications</b></span><input type="checkbox" data-muted="${esc(c.id)}" ${c.muted?'checked':''}></label><label><span><b>Location sharing</b></span><select data-location-sharing="${esc(c.id)}"><option value="precise" ${c.locationSharing==='precise'?'selected':''}>Precise</option><option value="approximate" ${c.locationSharing==='approximate'?'selected':''}>Approximate</option><option value="off" ${c.locationSharing==='off'?'selected':''}>Off</option></select></label><label><span><b>Blocked</b></span><input type="checkbox" data-blocked="${esc(c.id)}" ${c.blocked?'checked':''}></label></div><button class="ghp-contact-remove" data-remove-contact="${esc(c.id)}"><i class="fa-solid fa-user-minus"></i> Remove Contact</button><small class="ghp-contact-remove-note">Removed contacts stay hidden from automatic discovery until you restore or manually add them.</small></main></div>`;
}

function renderSocial(){
  const t=timeline(),stories=t.stories.filter(x=>Number(x.expiresAt||0)>now().getTime()).slice(0,20);
  return`<div class="ghp-app">${header('Social','','<button data-new-post><i class="fa-solid fa-plus"></i></button>')}<main><div class="ghp-stories">${stories.map(s=>{const c=t.contacts[s.contactId]||{name:s.author};return`<button data-story="${esc(s.id)}" class="${s.viewed?'viewed':''}"><span>${avatarHtml(c)}</span><small>${esc(c.nickname||s.author)}</small></button>`}).join('')||'<small>No active stories</small>'}</div><div class="ghp-feed">${t.posts.length?t.posts.slice(0,40).map(p=>{const c=t.contacts[p.contactId]||{name:p.author};return`<article><header>${avatarHtml(c,'small')}<span><b>${esc(p.author)}</b><small>${esc(rel(p.timeMs))}</small></span></header><div class="ghp-fake-photo"><i class="fa-regular fa-image"></i><p>${esc(p.visual||'Photo')}</p></div><div class="ghp-social-icons"><i class="fa-regular fa-heart"></i><i class="fa-regular fa-comment"></i><i class="fa-regular fa-paper-plane"></i></div><b>${Number(p.likes||0).toLocaleString()} likes</b><p><strong>${esc(p.author)}</strong> ${esc(p.caption)}</p><small>${Number(p.comments||0)} comments</small></article>`}).join(''):empty('fa-solid fa-camera-retro','Your feed is quiet','Refresh Phone to let relevant contacts post naturally.')}</div></main></div>`;
}
function renderStory(){
  const t=timeline(),s=t.stories.find(x=>x.id===threadId);if(!s){app='social';return renderSocial()}s.viewed=true;persist(t,false);const c=t.contacts[s.contactId]||{name:s.author};return`<div class="ghp-story-view"><div class="ghp-progress"><i></i></div><header>${avatarHtml(c,'small')}<b>${esc(s.author)}</b><time>${esc(rel(s.timeMs))}</time><button data-open-app="social"><i class="fa-solid fa-xmark"></i></button></header><main><i class="fa-regular fa-image"></i><p>${esc(s.visual||'Story')}</p></main><footer>${esc(s.caption||'')}</footer></div>`;
}
function renderSnap(){
  const t=timeline();let people=[];try{people=globalThis.GreyhavenLife?.getPeople?.()||[]}catch{}const rows=[];
  for(const c of t.contactOrder.map(k=>t.contacts[k]).filter(Boolean)){if(c.locationSharing==='off'||c.blocked)continue;const p=people.find(x=>lc(x.name)===lc(c.name));if(!p)continue;const place=p.resolved?.location||p.base?.location||'',area=p.resolved?.area||p.base?.area||'',display=c.locationSharing==='approximate'?(area||place||'Location unavailable'):([place,area].filter(Boolean).join(' · ')||'Location unavailable');rows.push({c,p,display})}
  return`<div class="ghp-app">${header('Snap Map',globalThis.GreyhavenLife?'Powered by Greyhaven Life':'Greyhaven Life not detected')}<main class="ghp-map">${rows.length?rows.map(x=>`<div>${avatarHtml(x.c)}<span><b>${esc(x.c.nickname||x.c.name)}</b><small>${esc(x.display)}</small>${x.p.resolved?.status?`<em>${esc(x.p.resolved.status)}</em>`:''}</span><i class="${x.p.present?'here':''}">${x.p.present?'Here':'Off-screen'}</i></div>`).join(''):empty('fa-solid fa-location-dot','No shared locations yet','Track contacts in Greyhaven Life or enable location sharing.')}</main></div>`;
}
function scheduleText(x){const e=x?.entry||x;if(!e)return'';return`${e.label||'Schedule'} · ${e.start||''}–${e.end||''}${e.location||e.area?` · ${[e.location,e.area].filter(Boolean).join(' · ')}`:''}`}
function renderCalendar(){
  const p=persona();let cur=null,up=[],person=null;try{cur=globalThis.GreyhavenLife?.getCurrentSchedule?.(p.name)||null;up=globalThis.GreyhavenLife?.getUpcomingSchedules?.(p.name,72)||[];person=globalThis.GreyhavenLife?.getPerson?.(p.name)||null}catch{}
  const ex=(person?.exceptions||[]).filter(x=>(x.endMs?Number(x.endMs):Infinity)>=now().getTime()-86400000).sort((a,b)=>Number(a.startMs||0)-Number(b.startMs||0)),fmt=ms=>new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ms));
  return`<div class="ghp-app">${header('Calendar',globalThis.GreyhavenLife?'Synced with Greyhaven Life':'Greyhaven Life not detected')}<main><div class="ghp-date"><b>${now().getDate()}</b><span>${esc(dateText())}</span></div>${cur?`<section><h3>Now</h3><div class="ghp-event current"><i></i><span><b>${esc(cur.entry?.label||'Current schedule')}</b><small>${esc(scheduleText(cur))}</small></span></div></section>`:''}<section><h3>Upcoming</h3>${up.length?up.slice(0,12).map(x=>`<div class="ghp-event"><i></i><span><b>${esc(x.entry?.label||'Schedule')}</b><small>${esc(scheduleText(x))}</small></span></div>`).join(''):'<small class="ghp-muted">No upcoming schedules.</small>'}</section><section><h3>Exceptions & trips</h3>${ex.length?ex.map(x=>`<div class="ghp-event exception"><i></i><span><b>${esc(x.label||x.type||'Exception')}</b><small>${x.endMs?`Ends ${esc(fmt(x.endMs))}`:'No end set'}${x.suppressObligations?' · obligations excused':''}</small></span></div>`).join(''):'<small class="ghp-muted">No active/upcoming exceptions.</small>'}</section></main></div>`;
}
function renderPhotos(){
  const t=timeline(),messageMedia=[];
  for(const th of Object.values(t.threads))for(const m of th.messages||[])if(['photo','video'].includes(m.type))messageMedia.push({id:m.id,visual:m.mediaDescription,caption:m.text,timeMs:m.timeMs,source:`Messages · ${m.sender}`,type:m.type,mediaKey:m.mediaKey});
  const a=[...t.photos,...messageMedia,...t.posts.map(x=>({id:x.id,visual:x.visual,caption:x.caption,timeMs:x.timeMs,source:`Social · ${x.author}`,type:'photo'})),...t.stories.map(x=>({id:x.id,visual:x.visual,caption:x.caption,timeMs:x.timeMs,source:`Story · ${x.author}`,type:'photo'}))].sort((a,b)=>Number(b.timeMs||0)-Number(a.timeMs||0));
  return`<div class="ghp-app">${header('Photos')}<main><div class="ghp-photos">${a.length?a.slice(0,80).map(x=>`<div>${x.mediaKey?(x.type==='video'?`<video data-media-key="${esc(x.mediaKey)}" muted playsinline></video>`:`<img data-media-key="${esc(x.mediaKey)}" alt="${esc(x.visual||'Photo')}">`):`<i class="${x.type==='video'?'fa-solid fa-video':'fa-regular fa-image'}"></i><p>${esc(x.visual||x.caption||'Photo')}</p>`}<small>${esc(x.source||'Photos')}</small></div>`).join(''):empty('fa-regular fa-images','No photos yet','Message media, Social and Stories will appear here.')}</div></main></div>`;
}
function renderNotes(){const t=timeline();return`<div class="ghp-app">${header('Notes','','<button data-new-note><i class="fa-solid fa-square-plus"></i></button>')}<main>${t.notes.length?t.notes.map(n=>`<button class="ghp-note" data-note="${esc(n.id)}"><b>${esc(n.title||'Note')}</b><span>${esc(n.body||'')}</span><time>${esc(rel(n.updatedAt||n.timeMs))}</time></button>`).join(''):empty('fa-regular fa-note-sticky','No notes','Notes are private to this persona in this timeline.','<button data-new-note>New note</button>')}</main></div>`}
function renderMail(){const t=timeline();return`<div class="ghp-app">${header('Mail')}<main>${t.mail.length?t.mail.map(m=>`<button class="ghp-mail ${m.read?'':'unread'}" data-mail="${esc(m.id)}"><i></i><b>${esc(m.from)}</b><strong>${esc(m.subject)}</strong><small>${esc(m.body)}</small><time>${esc(rel(m.timeMs))}</time></button>`).join(''):empty('fa-regular fa-envelope','Inbox empty','Mail is generated only when it makes sense.')}</main></div>`}
function renderSettings(){
  const p=profile(),own=persona();return`<div class="ghp-app">${header('Settings')}<main class="ghp-settings"><div class="ghp-settings-owner">${avatarHtml({name:own.name,avatar:own.avatar},'large')}<span><b>${esc(own.name)}</b><small>${esc(p.deviceName)} · phone profile</small></span></div><section><h3>Appearance</h3><label><span><b>Wallpaper</b></span><select id="ghp-wall">${Object.keys(WALLPAPERS).map(k=>`<option value="${k}" ${p.wallpaper===k?'selected':''}>${esc(k[0].toUpperCase()+k.slice(1))}</option>`).join('')}</select></label><label class="stack"><span><b>Custom wallpaper URL</b><small>Optional; overrides the preset.</small></span><input id="ghp-wall-url" value="${esc(p.wallpaperUrl)}"></label><label><span><b>Lock Screen</b></span><input type="checkbox" id="ghp-lock-setting" ${p.lockScreen?'checked':''}></label><label><span><b>Notification previews</b></span><input type="checkbox" id="ghp-preview-setting" ${p.notificationPreviews?'checked':''}></label></section><section><h3>Installed apps</h3>${Object.entries(APPS).filter(([k])=>k!=='settings').map(([k,x])=>`<label><span><b><i class="${x.icon}"></i> ${esc(x.label)}</b></span><input type="checkbox" data-app-setting="${k}" ${p.apps[k]?'checked':''}></label>`).join('')}</section><section><h3>AI Phone Refresh</h3><label class="stack"><span><b>Refresh behavior</b><small>Manual spends no tokens until you tap Refresh.</small></span><select id="ghp-refresh-mode"><option value="manual" ${p.refreshMode==='manual'?'selected':''}>Manual only</option><option value="stale-open" ${p.refreshMode==='stale-open'?'selected':''}>Refresh on open when stale</option></select></label><label><span><b>Stale after RP messages</b></span><input id="ghp-stale" type="number" min="3" max="100" value="${p.staleAfterMessages}"></label><label><span><b>Max new events</b></span><input id="ghp-max-events" type="number" min="1" max="8" value="${p.maxNewEvents}"></label><label class="stack"><span><b>Background activity</b></span><select id="ghp-activity"><option value="quiet" ${p.activityLevel==='quiet'?'selected':''}>Quiet</option><option value="normal" ${p.activityLevel==='normal'?'selected':''}>Normal</option><option value="busy" ${p.activityLevel==='busy'?'selected':''}>Busy</option></select></label><div class="ghp-life-status"><i class="fa-solid fa-circle-nodes"></i>${globalThis.GreyhavenLife?'Greyhaven Life detected — World Snapshot and live state will be reused.':'Greyhaven Life not detected — Phone will use recent RP only.'}</div></section><section><h3>Timeline</h3><button class="danger" data-reset-phone>Reset this persona's phone in this chat</button><small>Wallpaper/apps stay global; messages and history reset only here.</small></section><button class="ghp-save" data-save-settings>Save Settings</button></main></div>`;
}
function renderApp(){
  if(app==='call')return renderCall();if(app==='story')return renderStory();
  const body=app==='messages'?renderMessages():app==='thread'?renderThread():app==='phone'?renderPhone():app==='contacts'?renderContacts():app==='contact'?renderContact():app==='social'?renderSocial():app==='snap'?renderSnap():app==='calendar'?renderCalendar():app==='photos'?renderPhotos():app==='notes'?renderNotes():app==='mail'?renderMail():app==='settings'?renderSettings():renderHome();
  return app?`<div class="ghp-screen ghp-app-host">${statusBar()}${body}</div>`:body;
}

function buildOverlay(){
  if(document.querySelector('#ghp-overlay'))return;const o=document.createElement('div');o.id='ghp-overlay';o.hidden=true;o.innerHTML=`<div class="ghp-backdrop" data-close></div><section class="ghp-device"><button class="ghp-close" data-close><i class="fa-solid fa-xmark"></i></button><div class="ghp-content"></div></section>`;o.addEventListener('click',click);o.addEventListener('change',change);o.addEventListener('submit',submit);document.body.appendChild(o);
}
function render(){
  const o=document.querySelector('#ghp-overlay');if(!o||o.hidden)return;seedContacts(false);o.querySelector('.ghp-content').innerHTML=!unlocked&&profile().lockScreen?renderLock():(app?renderApp():renderHome());
  requestAnimationFrame(()=>{for(const s of o.querySelectorAll('.ghp-thread main,.ghp-call-screen main'))s.scrollTop=s.scrollHeight;hydrateMediaPreviews()});
}
async function openPhone(){if(!hasChat()){globalThis.toastr?.warning?.('Open a SillyTavern chat first.');return}buildOverlay();seedContacts(true);unlocked=!profile().lockScreen;app='';threadId='';contactId='';callId='';composeRequest={threadId:'',kind:''};const o=document.querySelector('#ghp-overlay');o.hidden=false;document.body.classList.add('ghp-open');render();if(profile().refreshMode==='stale-open'&&stale().stale)setTimeout(refreshPhone,250)}
function closePhone(){const o=document.querySelector('#ghp-overlay');if(o)o.hidden=true;document.body.classList.remove('ghp-open');app='';threadId='';contactId='';callId='';composeRequest={threadId:'',kind:''};unlocked=false}
function openApp(a){if(a==='settings'||profile().apps[a]){if(['phone','social','snap'].includes(a))mutate(t=>{for(const n of t.notifications)if(n.app===a)n.read=true},false);unlocked=true;app=a;threadId='';contactId='';composeRequest={threadId:'',kind:''};render()}}
function startCall(cid){
  const t=timeline(),c=t.contacts[cid];if(!c||c.blocked)return;const stamp=now().getTime(),sharedCallId=`call:${id()}`,call={id:id(),sharedCallId,contactId:cid,contactName:c.name,direction:'outgoing',status:'active',timeMs:stamp,durationSec:0,transcript:[]};t.calls.unshift(call);mirrorCallToOwner({phoneOwner:c.name,phoneOwnerAvatar:c.avatar,peerName:persona().name,peerAvatar:persona().avatar,peerDescription:persona().description,direction:'incoming',status:'active',timeMs:stamp,sharedCallId});persist(t,false);callId=call.id;app='call';render();const th=directThread(cid);if(th&&!replyBusy)setTimeout(()=>generateReply(th,'call'),180);
}
function endCall(){let shared='';mutate(t=>{const c=t.calls.find(x=>x.id===callId);if(c){c.status='ended';shared=c.sharedCallId||''}},false);updateSharedCallStatus(shared,'ended');callId='';app='phone';render()}

function popup(html){const d=document.createElement('dialog');d.className='ghp-popup';d.innerHTML=html;document.body.appendChild(d);d.addEventListener('close',()=>d.remove());d.showModal();return d}
function newThreadPopup(){
  const t=timeline(),cs=t.contactOrder.map(k=>t.contacts[k]).filter(c=>c&&!c.blocked);if(!cs.length){globalThis.toastr?.warning?.('No contacts yet.');return}
  const d=popup(`<form method="dialog"><header><b>New Message</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><p>Select one person, or several for a group chat.</p><div class="ghp-picker">${cs.map(c=>`<label>${avatarHtml(c,'small')}<span>${esc(c.nickname||c.name)}</span><input type="checkbox" value="${esc(c.id)}"></label>`).join('')}</div><input class="group-name" placeholder="Group name (optional)"><button type="button" class="primary" data-create-thread>Create</button></form>`);
  d.querySelector('[data-create-thread]').onclick=()=>{const ids=[...d.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);if(!ids.length)return;if(ids.length===1){const th=directThread(ids[0]);threadId=th.id;app='thread'}else{const t=timeline(),tid=`thread:${id()}`;t.threads[tid]={id:tid,type:'group',title:d.querySelector('.group-name').value.trim()||ids.map(k=>t.contacts[k]?.name).filter(Boolean).join(', '),contactIds:ids,createdAt:Date.now(),messages:[]};t.threadOrder.unshift(tid);persist(t,false);threadId=tid;app='thread'}d.close();render()};
}
function addContactPopup(){
  const c=ctx(),t=timeline(),p=persona(),existing=new Set(Object.values(t.contacts).map(x=>lc(x.name))),choices=(c?.characters||[]).map((ch,i)=>({ch,i})).filter(x=>x.ch?.name&&lc(x.ch.name)!==lc(p.name)&&!existing.has(lc(x.ch.name))).sort((a,b)=>a.ch.name.localeCompare(b.ch.name));
  const d=popup(`<form method="dialog"><header><b>Add Contact</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><select class="contact-select"><option value="">Choose a SillyTavern character…</option>${choices.map(x=>`<option value="${x.i}">${esc(x.ch.name)}</option>`).join('')}</select><button type="button" class="primary" data-confirm-add>Add Contact</button></form>`);
  d.querySelector('[data-confirm-add]').onclick=()=>{const i=Number(d.querySelector('.contact-select').value),ch=c?.characters?.[i];if(!ch)return;mutate(t=>{unsuppress(t,ch.name);upsertContact(t,{name:ch.name,avatar:thumb(ch),characterId:i,source:'manual'})},false);d.close();render()};
}
function restoreContactsPopup(){
  const t=timeline(),removed=t.suppressedContacts||[];if(!removed.length){globalThis.toastr?.info?.('No removed contacts.');return}
  const c=ctx(),rows=removed.map(name=>{const ch=c?.characters?.find(x=>lc(x?.name)===name);return{name:ch?.name||name,ch}}).sort((a,b)=>a.name.localeCompare(b.name));
  const d=popup(`<div><header><b>Removed Contacts</b><button data-popup-close><i class="fa-solid fa-xmark"></i></button></header><p>These people stay hidden from automatic contact discovery and Phone Refresh.</p><div class="ghp-restore-list">${rows.map((x,i)=>`<button data-restore-index="${i}"><span><b>${esc(x.name)}</b><small>Restore to Contacts</small></span><i class="fa-solid fa-rotate-left"></i></button>`).join('')}</div></div>`);
  d.querySelector('[data-popup-close]').onclick=()=>d.close();
  d.querySelectorAll('[data-restore-index]').forEach(btn=>btn.onclick=()=>{const x=rows[Number(btn.dataset.restoreIndex)];mutate(t=>{unsuppress(t,x.name);if(x.ch){const i=c.characters.indexOf(x.ch);upsertContact(t,{name:x.ch.name,avatar:thumb(x.ch),characterId:i,source:'manual'})}},false);d.close();render()});
}
function removeContact(cid){
  const t=timeline(),c=t.contacts[cid];if(!c)return;if(!confirm(`Remove ${c.nickname||c.name} from this phone's contacts?`))return;
  mutate(t=>{
    const key=lc(c.name);if(!t.suppressedContacts.includes(key))t.suppressedContacts.push(key);
    delete t.contacts[cid];t.contactOrder=t.contactOrder.filter(k=>k!==cid);
    for(const [tid,th] of Object.entries(t.threads)){
      if(!th.contactIds.includes(cid))continue;
      if(th.type==='direct'||th.contactIds.length<=1){delete t.threads[tid];t.threadOrder=t.threadOrder.filter(k=>k!==tid)}
      else th.contactIds=th.contactIds.filter(k=>k!==cid);
    }
    t.calls=t.calls.filter(x=>x.contactId!==cid);
    t.notifications=t.notifications.filter(x=>!(x.contactId===cid));
  },false);
  contactId='';app='contacts';render();globalThis.toastr?.success?.(`${c.name} removed from Contacts.`);
}
function threadMenuPopup(tid){
  const t=timeline(),th=t.threads[tid];if(!th)return;const d=popup(`<div><header><b>${esc(threadTitle(th,t))}</b><button data-popup-close><i class="fa-solid fa-xmark"></i></button></header><button class="ghp-popup-action danger" data-delete-conversation><i class="fa-solid fa-trash"></i><span><b>Delete Conversation</b><small>Delete this chat from this phone and stop using it as Phone AI context.</small></span></button></div>`);
  d.querySelector('[data-popup-close]').onclick=()=>d.close();d.querySelector('[data-delete-conversation]').onclick=()=>{if(!confirm(`Delete the entire conversation with ${threadTitle(th,t)} from this phone?`))return;deleteConversation(tid);d.close()};
}
function deleteConversation(tid){
  mutate(t=>{delete t.threads[tid];t.threadOrder=t.threadOrder.filter(k=>k!==tid);t.notifications=t.notifications.filter(n=>!(n.app==='messages'&&n.targetId===tid))},false);
  if(composeRequest.threadId===tid)composeRequest={threadId:'',kind:''};threadId='';app='messages';render();globalThis.toastr?.success?.('Conversation deleted.');
}
function mediaMenuPopup(tid){
  const t=timeline(),th=t.threads[tid];if(!th)return;const direct=th.type==='direct';
  const d=popup(`<div><header><b>Message attachments</b><button data-popup-close><i class="fa-solid fa-xmark"></i></button></header><div class="ghp-media-actions"><button data-send-media="photo"><i class="fa-regular fa-image"></i><span><b>Send Photo</b><small>Describe what the picture contains.</small></span></button><button data-send-media="video"><i class="fa-solid fa-video"></i><span><b>Send Video</b><small>Describe what the video shows.</small></span></button>${direct?`<button data-request-media="photo"><i class="fa-regular fa-image"></i><span><b>Request Photo</b><small>Your next text asks for a photo; they can still refuse.</small></span></button><button data-request-media="video"><i class="fa-solid fa-video"></i><span><b>Request Video</b><small>Your next text asks for a video; they can still refuse.</small></span></button>`:''}</div></div>`);
  d.querySelector('[data-popup-close]').onclick=()=>d.close();
  d.querySelectorAll('[data-send-media]').forEach(b=>b.onclick=()=>{const kind=b.dataset.sendMedia;d.close();mediaComposerPopup(tid,kind)});
  d.querySelectorAll('[data-request-media]').forEach(b=>b.onclick=()=>{composeRequest={threadId:tid,kind:b.dataset.requestMedia};d.close();render()});
}
function mediaComposerPopup(tid,kind){
  const accept=kind==='video'?'video/*':'image/*',label=kind==='video'?'Video':'Photo';
  const d=popup(`<form method="dialog" class="ghp-media-form"><header><b>Send ${label}</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><label><span><b>What does it show?</b><small>This description is what the AI can understand.</small></span><textarea class="media-description" placeholder="${kind==='video'?'A short video of me walking along the beach…':'A selfie of myself lying in bed…'}"></textarea></label><label><span><b>Caption / message</b><small>Optional text sent with it.</small></span><textarea class="media-caption" placeholder="Optional message…"></textarea></label><label class="ghp-file-label"><span><b>Local ${label.toLowerCase()} preview</b><small>Optional. The AI does not receive the uploaded file — only your description above.</small></span><input class="media-file" type="file" accept="${accept}"></label><button type="button" class="primary" data-confirm-media>Send ${label}</button></form>`);
  d.querySelector('[data-confirm-media]').onclick=async()=>{const description=d.querySelector('.media-description').value.trim(),caption=d.querySelector('.media-caption').value.trim(),file=d.querySelector('.media-file').files?.[0];if(!description){globalThis.toastr?.warning?.('Describe what the media shows first.');return}const btn=d.querySelector('[data-confirm-media]');btn.disabled=true;btn.textContent='Sending…';let mediaKey='';if(file)mediaKey=await saveMediaBlob(file);sendMediaMessage(tid,kind,description,caption,mediaKey);d.close();render()};
}
function postPopup(){
  const d=popup(`<form method="dialog"><header><b>New Social Post</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><label>What does the photo show?<textarea class="visual"></textarea></label><label>Caption<textarea class="caption"></textarea></label><button type="button" class="primary" data-post>Post</button></form>`);
  d.querySelector('[data-post]').onclick=()=>{const vis=d.querySelector('.visual').value.trim(),cap=d.querySelector('.caption').value.trim();if(!vis&&!cap)return;mutate(t=>t.posts.unshift({id:id(),author:persona().name,contactId:'',visual:vis,caption:cap,likes:0,comments:0,timeMs:now().getTime(),ownerPost:true}),false);d.close();render()};
}
function notePopup(nid=''){
  const t=timeline(),n=t.notes.find(x=>x.id===nid),d=popup(`<form method="dialog"><header><b>${n?'Edit Note':'New Note'}</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><input class="note-title" value="${esc(n?.title||'')}" placeholder="Title"><textarea class="note-body" placeholder="Note…">${esc(n?.body||'')}</textarea><button type="button" class="primary" data-save-note>Save</button></form>`);
  d.querySelector('[data-save-note]').onclick=()=>{const title=d.querySelector('.note-title').value.trim(),body=d.querySelector('.note-body').value.trim();if(!title&&!body)return;mutate(t=>{let x=t.notes.find(v=>v.id===nid);if(x){x.title=title;x.body=body;x.updatedAt=Date.now()}else t.notes.unshift({id:id(),title,body,timeMs:now().getTime(),updatedAt:Date.now()})},false);d.close();render()};
}
function openMail(mid){const t=timeline(),m=t.mail.find(x=>x.id===mid);if(!m)return;m.read=true;persist(t,false);const d=popup(`<div><header><b>${esc(m.subject)}</b><button data-popup-close><i class="fa-solid fa-xmark"></i></button></header><small>From: ${esc(m.from)}</small><p>${esc(m.body)}</p></div>`);d.querySelector('[data-popup-close]').onclick=()=>d.close()}
function notification(nid){const t=timeline(),n=t.notifications.find(x=>x.id===nid);if(!n)return;n.read=true;unlocked=true;if(n.app==='messages'&&n.targetId){app='thread';threadId=n.targetId}else if(n.app==='phone'&&n.targetId){const c=t.calls.find(x=>x.id===n.targetId);if(c&&c.status==='incoming'){c.status='active';callId=c.id;app='call';updateSharedCallStatus(c.sharedCallId,'active')}else app='phone'}else if(n.app==='mail')app='mail';else app=n.app==='snap'?'snap':'social';persist(t,false);render()}
function saveSettings(){
  const o=document.querySelector('#ghp-overlay'),apps={...profile().apps,settings:true};o.querySelectorAll('[data-app-setting]').forEach(x=>apps[x.dataset.appSetting]=x.checked);
  saveProfile({wallpaper:o.querySelector('#ghp-wall')?.value||'aurora',wallpaperUrl:o.querySelector('#ghp-wall-url')?.value.trim()||'',lockScreen:o.querySelector('#ghp-lock-setting')?.checked??true,notificationPreviews:o.querySelector('#ghp-preview-setting')?.checked??true,refreshMode:o.querySelector('#ghp-refresh-mode')?.value||'manual',staleAfterMessages:Number(o.querySelector('#ghp-stale')?.value||12),maxNewEvents:Number(o.querySelector('#ghp-max-events')?.value||4),activityLevel:o.querySelector('#ghp-activity')?.value||'normal',apps});globalThis.toastr?.success?.('Phone settings saved.');
}
function click(e){
  const x=e.target.closest('button,[data-thread],[data-contact],[data-story],[data-note],[data-mail]');if(!x)return;
  if(x.matches('[data-close]'))return closePhone();if(x.matches('[data-unlock]')){unlocked=true;app='';return render()}if(x.matches('[data-home]')){app='';threadId='';contactId='';callId='';composeRequest={threadId:'',kind:''};return render()}
  if(x.dataset.openApp)return openApp(x.dataset.openApp);if(x.matches('[data-refresh]'))return refreshPhone();if(x.matches('[data-new-thread]'))return newThreadPopup();
  if(x.dataset.thread){threadId=x.dataset.thread;app='thread';return render()}if(x.matches('[data-add-contact]'))return addContactPopup();if(x.matches('[data-discover]')){seedContacts(true);globalThis.toastr?.success?.('Relevant contacts refreshed.');return render()}if(x.matches('[data-removed-contacts]'))return restoreContactsPopup();
  if(x.dataset.contact){contactId=x.dataset.contact;app='contact';return render()}if(x.dataset.messageContact){const th=directThread(x.dataset.messageContact);threadId=th.id;app='thread';return render()}if(x.dataset.removeContact)return removeContact(x.dataset.removeContact);
  if(x.dataset.threadMenu)return threadMenuPopup(x.dataset.threadMenu);if(x.dataset.mediaMenu)return mediaMenuPopup(x.dataset.mediaMenu);if(x.matches('[data-cancel-media-request]')){composeRequest={threadId:'',kind:''};return render()}
  if(x.dataset.call)return startCall(x.dataset.call);if(x.matches('[data-end-call]'))return endCall();if(x.dataset.story){threadId=x.dataset.story;app='story';return render()}
  if(x.matches('[data-new-post]'))return postPopup();if(x.matches('[data-new-note]'))return notePopup();if(x.dataset.note)return notePopup(x.dataset.note);if(x.dataset.mail)return openMail(x.dataset.mail);if(x.matches('[data-save-settings]'))return saveSettings();
  if(x.matches('[data-reset-phone]')){if(confirm(`Reset ${persona().name}'s phone timeline in this chat?`)){const r=metadataRoot();r.phones[persona().key]=defaultTimeline(persona().name,persona().avatar);saveMetadataRoot(r);app='';threadId='';contactId='';composeRequest={threadId:'',kind:''};render();globalThis.toastr?.success?.('Phone timeline reset.')}return}
  if(x.dataset.notif)return notification(x.dataset.notif);
}
function change(e){const x=e.target,k=x.dataset.favorite||x.dataset.muted||x.dataset.blocked||x.dataset.locationSharing||x.dataset.nickname;if(!k)return;mutate(t=>{const c=t.contacts[k];if(!c)return;if(x.dataset.favorite)c.favorite=x.checked;else if(x.dataset.muted)c.muted=x.checked;else if(x.dataset.blocked)c.blocked=x.checked;else if(x.dataset.locationSharing)c.locationSharing=x.value;else if(x.dataset.nickname)c.nickname=x.value.trim()},false)}
function submit(e){
  e.preventDefault();const f=e.target;
  if(f.dataset.threadForm){const input=f.querySelector('input'),v=input.value;input.value='';const request=composeRequest.threadId===f.dataset.threadForm?composeRequest.kind:'';composeRequest={threadId:'',kind:''};sendThread(f.dataset.threadForm,v,'text',{requestMedia:request})}
  if(f.dataset.callForm){const input=f.querySelector('input'),v=input.value;input.value='';sendThread(f.dataset.callForm,v,'call')}
}

function latestUserText(){const a=Array.isArray(ctx()?.chat)?ctx().chat:[];for(let i=a.length-1;i>=0;i--){const m=a[i];if(m?.is_user)return String(m.mes||m.text||'')}return''}
function relevantPhoneNames(){
  const c=ctx(),t=timeline(false),names=new Set(),add=n=>{n=norm(n);if(n)names.add(lc(n))};
  if(c?.groupId){const g=c.groups?.find(x=>String(x?.id)===String(c.groupId)),disabled=new Set(Array.isArray(g?.disabled_members)?g.disabled_members:[]);for(const m of g?.members||[]){const av=typeof m==='string'?m:m?.avatar;if(!av||disabled.has(av))continue;const ch=c.characters?.find(x=>x?.avatar===av);if(ch)add(ch.name)}}else{const ch=c?.characters?.[Number(c.characterId)];if(ch)add(ch.name)}
  const text=latestUserText();for(const co of Object.values(t?.contacts||{})){const q=co.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(new RegExp(`(^|[^\\p{L}\\p{N}])${q}([^\\p{L}\\p{N}]|$)`,'iu').test(text))add(co.name)}
  return names;
}
function phonePromptSummary(){
  const t=timeline(false);if(!t)return'';const relevant=relevantPhoneNames(),owner=persona(),lines=[];
  for(const th of t.threadOrder.map(k=>t.threads[k]).filter(Boolean)){const memberNames=th.contactIds.map(k=>t.contacts[k]?.name).filter(Boolean);if(!memberNames.some(n=>relevant.has(lc(n))))continue;const recent=(th.messages||[]).slice(-8);if(!recent.length)continue;lines.push(`Phone conversation "${threadTitle(th,t)}": ${recent.map(messageContext).join(' | ')}`)}
  for(const c of t.calls.slice(0,5)){if(!relevant.has(lc(c.contactName)))continue;const transcript=(c.transcript||[]).slice(-6);lines.push(`Phone call with ${c.contactName} (${c.status}): ${transcript.length?transcript.map(x=>`${x.sender}: ${x.text}`).join(' | '):'no transcript stored'}`)}
  if(!lines.length)return'';const body=lines.join('\n').slice(-6500);
  return`[Greyhaven Phone — factual phone continuity for ${owner.name}.]\n${body}\nContinuity rules: these phone interactions happened in this RP timeline. A sent/received photo or video is known through its stated visual description. Only participants should automatically know private messages/calls/media. Use them when relevant; do not mechanically recap them. Newer explicit roleplay overrides stale phone state.`;
}
function updatePrompt(){const c=ctx();if(!c?.setExtensionPrompt)return;const summary=hasChat()?phonePromptSummary():'';try{c.setExtensionPrompt(GHP_PROMPT_KEY,summary,GHP_PROMPT_POSITION_IN_CHAT,1,false,GHP_PROMPT_ROLE_SYSTEM)}catch(e){console.error(`[${GHP_MODULE}] setExtensionPrompt`,e)}}
function buildMenu(){const m=document.querySelector('#extensionsMenu');if(!m||document.querySelector('#ghp-menu-entry'))return;const d=document.createElement('div');d.id='ghp-menu-entry';d.className='list-group-item flex-container flexGap5 interactable';d.tabIndex=0;d.innerHTML='<i class="fa-solid fa-mobile-screen-button"></i><span>Greyhaven Phone</span>';d.onclick=openPhone;d.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPhone()}};m.appendChild(d)}
function observeMenu(){if(menuObserver)return;const m=document.querySelector('#extensionsMenu');if(!m)return;let q=false;menuObserver=new MutationObserver(()=>{if(q)return;q=true;requestAnimationFrame(()=>{q=false;buildMenu()})});menuObserver.observe(m,{childList:true})}
function onChat(){const k=chatIdentity();if(k===currentChat)return;currentChat=k;app='';threadId='';contactId='';callId='';composeRequest={threadId:'',kind:''};unlocked=!profile().lockScreen;if(hasChat()){timeline();seedContacts(true)}if(!document.querySelector('#ghp-overlay')?.hidden)render()}
function bind(){
  if(bound)return;const c=ctx();if(!c?.eventSource||!c.eventTypes)return;const b=(k,fn)=>{const e=c.eventTypes[k];if(e)c.eventSource.on(e,fn)};
  b('CHAT_CHANGED',()=>setTimeout(()=>{onChat();updatePrompt()},30));b('CHAT_CREATED',()=>setTimeout(()=>{onChat();updatePrompt()},30));b('PERSONA_CHANGED',()=>setTimeout(()=>{app='';threadId='';contactId='';callId='';composeRequest={threadId:'',kind:''};unlocked=!profile().lockScreen;timeline();seedContacts(true);updatePrompt();render()},50));b('GENERATION_STARTED',()=>updatePrompt());b('GROUP_UPDATED',()=>setTimeout(()=>seedContacts(true),50));b('CHARACTER_EDITED',()=>setTimeout(()=>seedContacts(true),50));b('MESSAGE_SENT',()=>{if(!document.querySelector('#ghp-overlay')?.hidden)render()});b('CHARACTER_MESSAGE_RENDERED',()=>{if(!document.querySelector('#ghp-overlay')?.hidden)render()});bound=true;
}
function subscribeLife(){try{lifeUnsub?.()}catch{}lifeUnsub=null;if(typeof globalThis.GreyhavenLife?.subscribe==='function')lifeUnsub=globalThis.GreyhavenLife.subscribe(()=>{if(!document.querySelector('#ghp-overlay')?.hidden)render()})}
function startClock(){clearInterval(clockTimer);clockTimer=setInterval(()=>{const o=document.querySelector('#ghp-overlay');if(o?.hidden)return;o.querySelectorAll('.ghp-status>span:first-child').forEach(x=>x.textContent=timeText());o.querySelectorAll('.ghp-lock h1').forEach(x=>x.textContent=timeText())},15000)}
function expose(){globalThis.GreyhavenPhone={version:GHP_VERSION,open:openPhone,close:closePhone,refresh:refreshPhone,getProfile:()=>clone(profile()),getTimeline:()=>clone(timeline(false)),getContacts:()=>{const t=timeline(false);return clone(t?t.contactOrder.map(k=>t.contacts[k]).filter(Boolean):[])},getActivePersona:()=>clone(persona()),seedContacts:()=>clone(seedContacts(true)),removeContact}}
async function waitReady(ms=15000){const s=Date.now();while(Date.now()-s<ms){if(ctx()?.extensionSettings&&document.body)return true;await new Promise(r=>setTimeout(r,120))}return false}
async function init(){if(initialized)return;if(!await waitReady())return;try{buildOverlay();buildMenu();observeMenu();bind();expose();onChat();updatePrompt();subscribeLife();startClock();initialized=true;console.info(`[${GHP_MODULE}] v${GHP_VERSION} loaded`)}catch(e){console.error(`[${GHP_MODULE}] init`,e)}}
void init().catch(e=>console.error(`[${GHP_MODULE}] boot`,e));
