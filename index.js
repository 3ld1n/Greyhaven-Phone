const GHP_MODULE = 'greyhaven-phone';
const GHP_VERSION = '1.2.0';
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
let longPressTimer=null,longPressTarget=null,longPressPoint=null;
let mediaDbPromise=null;
const mediaObjectUrls=new Map();
const mediaDimensionCache=new Map();
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
  m.text=String(m.text||'');m.timeMs=Number(m.timeMs||Date.now());m.realMs=Math.max(0,Number(m.realMs||0)||0);m.read=m.read!==false;
  m.type=['text','photo','video'].includes(m.type)?m.type:'text';
  m.mediaDescription=String(m.mediaDescription||m.description||'');
  m.mediaKey=String(m.mediaKey||'');
  m.mediaWidth=Math.max(0,Number(m.mediaWidth||0)||0);
  m.mediaHeight=Math.max(0,Number(m.mediaHeight||0)||0);
  m.requestMedia=['photo','video'].includes(m.requestMedia)?m.requestMedia:'';
  m.mirrorId=String(m.mirrorId||'');
  m.editedAt=Math.max(0,Number(m.editedAt||0)||0);
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
function normalizeContinuity(c={}){
  c=c&&typeof c==='object'?c:{};
  c.version=Math.max(1,Number(c.version||1));c.seq=Math.max(0,Number(c.seq||0));
  c.events=Array.isArray(c.events)?c.events.filter(Boolean).slice(-180):[];
  c.events=c.events.map(e=>({id:e.id||id(),seq:Math.max(0,Number(e.seq||0)),kind:['message','call','media','social'].includes(e.kind)?e.kind:'message',participants:[...new Set((Array.isArray(e.participants)?e.participants:[]).map(norm).filter(Boolean))],sender:norm(e.sender||''),summary:String(e.summary||''),threadTitle:String(e.threadTitle||''),mirrorId:String(e.mirrorId||''),roleplayMs:Math.max(0,Number(e.roleplayMs||0)),realMs:Math.max(0,Number(e.realMs||0)),persistent:e.persistent===true,transient:e.transient===true}));
  c.seq=Math.max(c.seq,...c.events.map(e=>e.seq||0),0);
  c.rpCheckpoint=c.rpCheckpoint&&typeof c.rpCheckpoint==='object'?c.rpCheckpoint:{};
  c.rpCheckpoint={seq:Math.max(0,Number(c.rpCheckpoint.seq||0)),roleplayMs:Math.max(0,Number(c.rpCheckpoint.roleplayMs||0)),realMs:Math.max(0,Number(c.rpCheckpoint.realMs||0)),chatLength:Math.max(0,Number(c.rpCheckpoint.chatLength||0))};
  return c;
}
function metadataRoot(){
  const c=ctx();if(!c?.chatMetadata||!hasChat())return null;let r=c.chatMetadata[GHP_META_KEY];
  if(!r||typeof r!=='object'){r={version:3,phones:{},continuity:normalizeContinuity()};c.chatMetadata[GHP_META_KEY]=r}
  r.version=Math.max(3,Number(r.version||1));if(!r.phones||typeof r.phones!=='object')r.phones={};r.continuity=normalizeContinuity(r.continuity);return r
}

function continuityRoot(){const r=metadataRoot();return r?{root:r,state:r.continuity}:null}
function looksLikePlan(text=''){
  const s=String(text||'');
  return /\b(?:tonight|tomorrow|later today|this evening|this morning|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week)|after work|before work|when (?:i|you|we) (?:finish|get off|leave)|pick (?:me|you) up|meet (?:me|you|at|up)|see you|come over|come by|call (?:me|you)|text (?:me|you)|i(?:'ll| will) (?:come|meet|call|text|pick|see)|we(?:'ll| will) (?:meet|go|see)|let'?s (?:meet|go|hang|grab)|plan(?:ning)? to|reservation|appointment|date at|at \d{1,2}(?::\d{2})?\s*(?:am|pm)?\b)/i.test(s);
}
function looksTransient(text=''){
  const s=String(text||'');
  return /\b(?:i(?:'m| am) (?:in|at|on|driving|walking|working|bathing|showering|sleeping|lying|sitting|getting|heading)|currently|right now|just got (?:in|to|home|back)|getting (?:in|into|out|ready)|in the (?:bath|bathtub|shower|car|bed)|at (?:home|work|the hospital|the gym|the beach)|on my way)\b/i.test(s);
}
function continuityParticipants(th,t,ownerName=''){
  const names=[ownerName,...(th?.contactIds||[]).map(k=>t?.contacts?.[k]?.name)].map(norm).filter(Boolean);return[...new Set(names)];
}
function recordContinuityEvent(data={}){
  const box=continuityRoot();if(!box)return null;const {root,state}=box,mirrorId=String(data.mirrorId||'');
  if(mirrorId&&state.events.some(e=>e.mirrorId===mirrorId))return state.events.find(e=>e.mirrorId===mirrorId)||null;
  const summary=String(data.summary||'').trim();if(!summary)return null;
  const event={id:id(),seq:++state.seq,kind:['message','call','media','social'].includes(data.kind)?data.kind:'message',participants:[...new Set((data.participants||[]).map(norm).filter(Boolean))],sender:norm(data.sender||''),summary,threadTitle:String(data.threadTitle||''),mirrorId,roleplayMs:Math.max(0,Number(data.roleplayMs||now().getTime())),realMs:Date.now(),persistent:data.persistent===true||looksLikePlan(summary),transient:data.transient===true||looksTransient(summary)};
  state.events.push(event);state.events=state.events.slice(-180);root.continuity=state;saveMetadataRoot(root);updatePrompt();try{window.dispatchEvent(new CustomEvent('greyhaven-phone-continuity',{detail:clone(event)}))}catch{}return event;
}
function recordMessageContinuity(th,t,msg,ownerName=''){
  if(!th||!msg)return null;return recordContinuityEvent({kind:msg.type==='text'?'message':'media',participants:continuityParticipants(th,t,ownerName),sender:msg.sender,summary:messageContext(msg),threadTitle:threadTitle(th,t),mirrorId:msg.mirrorId,roleplayMs:msg.timeMs});
}
function updateContinuityMirror(mirrorId,msg){
  if(!mirrorId||!msg)return;const box=continuityRoot();if(!box)return;let changed=false;
  for(const e of box.state.events)if(e.mirrorId===mirrorId){e.summary=messageContext(msg);e.sender=msg.sender;e.roleplayMs=msg.timeMs;e.persistent=looksLikePlan(e.summary);e.transient=looksTransient(e.summary);changed=true}
  if(changed){box.root.continuity=box.state;saveMetadataRoot(box.root);updatePrompt()}
}
function removeContinuityMirror(mirrorId){
  if(!mirrorId)return;const box=continuityRoot();if(!box)return;const before=box.state.events.length;box.state.events=box.state.events.filter(e=>e.mirrorId!==mirrorId);if(box.state.events.length!==before){box.root.continuity=box.state;saveMetadataRoot(box.root);updatePrompt()}
}
function markRoleplayCheckpoint(){
  const box=continuityRoot();if(!box)return;const c=ctx(),state=box.state;
  state.rpCheckpoint={seq:state.seq,roleplayMs:now().getTime(),realMs:Date.now(),chatLength:Array.isArray(c?.chat)?c.chat.length:0};box.root.continuity=state;saveMetadataRoot(box.root);updatePrompt();
}
function continuityTime(ms){if(!ms)return'unknown RP time';try{return new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ms))}catch{return new Date(ms).toISOString()}}
function continuitySnapshot(){
  const box=continuityRoot();if(!box)return{fresh:[],plans:[],history:[],checkpoint:{},nowMs:now().getTime()};const state=box.state,cp=state.rpCheckpoint||{},nowMs=now().getTime(),relevant=relevantPhoneNames(true),matches=e=>!relevant.size||e.participants.some(n=>relevant.has(lc(n)));
  const all=state.events.filter(matches),fresh=[],history=[];
  for(const e of all){
    const afterCheckpoint=e.seq>Number(cp.seq||0),backdated=cp.roleplayMs&&e.roleplayMs&&e.roleplayMs<cp.roleplayMs-5*60000,age=e.roleplayMs?nowMs-e.roleplayMs:0,staleTransient=e.transient&&age>120*60000;
    if(afterCheckpoint&&!backdated&&!staleTransient)fresh.push(e);else history.push(e);
  }
  const plans=all.filter(e=>e.persistent&&(!e.roleplayMs||nowMs-e.roleplayMs<8*86400000)).slice(-12);
  return{fresh:fresh.slice(-18),plans,history:history.slice(-10),checkpoint:clone(cp),nowMs};
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
async function probeMediaDimensions(blob,key='',kind=''){
  if(!blob)return null;
  if(key&&mediaDimensionCache.has(key))return mediaDimensionCache.get(key);
  try{
    const url=URL.createObjectURL(blob);
    const meta=await new Promise(resolve=>{
      const finalize=(width,height)=>{try{URL.revokeObjectURL(url)}catch{}const out=width&&height?{width:Number(width)||0,height:Number(height)||0}:null;if(key&&out)mediaDimensionCache.set(key,out);resolve(out)};
      const isVideo=kind==='video'||String(blob.type||'').startsWith('video/');
      if(isVideo){
        const video=document.createElement('video');video.preload='metadata';video.muted=true;video.onloadedmetadata=()=>finalize(video.videoWidth,video.videoHeight);video.onerror=()=>finalize(0,0);video.src=url;
      }else{
        const img=new Image();img.onload=()=>finalize(img.naturalWidth,img.naturalHeight);img.onerror=()=>finalize(0,0);img.src=url;
      }
    });
    return meta;
  }catch{return null}
}
async function hydrateMediaPreviews(){
  const o=document.querySelector('#ghp-overlay');if(!o||o.hidden)return;
  for(const el of o.querySelectorAll('[data-media-key]')){
    const key=el.dataset.mediaKey;if(!key)continue;let url=mediaObjectUrls.get(key),blob=null;
    if(!url){blob=await mediaBlob(key);if(blob){url=URL.createObjectURL(blob);mediaObjectUrls.set(key,url)}}
    else if(!mediaDimensionCache.has(key))blob=await mediaBlob(key);
    if(url){
      el.src=url;el.dataset.loaded='1';
      const wrap=el.closest('.ghp-media-visual');
      wrap?.classList.add('has-local');
      const kind=el.tagName==='VIDEO'?'video':'photo';
      const meta=mediaDimensionCache.get(key)||(blob?await probeMediaDimensions(blob,key,kind):null);
      if(meta?.width&&meta?.height)wrap?.style.setProperty('--ghp-media-ar',`${meta.width}/${meta.height}`);
    }
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
IDENTITY LOCK: every generated sender is that named contact, never the PHONE OWNER and never another contact. Do not swap names, biographies, relationships, homes, jobs or possessions between people.
Every message should sound like that contact's own private texting voice, using their character/personality and existing thread tail. Avoid generic formal customer-service/therapy language. Slang, lowercase, abbreviations, emojis, teasing, profanity, short double-texts and expressive punctuation are allowed when they fit that specific person; do not force the same style on everyone.
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
  const items=[],created=[];
  if(String(text||'').trim())items.push({type:'text',text:String(text).trim()});
  if(['photo','video'].includes(mediaType)&&String(mediaDescription||'').trim())items.push({type:mediaType,text:'',mediaDescription:String(mediaDescription).trim()});
  if(!items.length)return created;
  for(const item of items){
    const mirrorId=`mirror:${id()}`,msg=normalizeMessage({id:id(),mirrorId,sender:c.name,senderId:c.id,text:item.text,type:item.type,mediaDescription:item.mediaDescription||'',timeMs:stamp,realMs:Date.now(),read:!unreadFlag});
    th.messages.push(msg);created.push(msg);
    mirrorRichMessageToPhone({phoneOwner:c.name,phoneOwnerAvatar:c.avatar,peerName:persona().name,peerAvatar:persona().avatar,peerDescription:persona().description,senderName:c.name,message:msg,unread:false});
  }
  return created;
}
function applyRefresh(r){
  const t=timeline(),installed=profile().apps,allowed=new Map(Object.values(t.contacts).map(c=>[lc(c.name),c])),keys=new Set(t.refresh.eventKeys||[]),stamp=now().getTime(),max=profile().maxNewEvents,continuityEntries=[];let count=0;
  const addKey=k=>{keys.add(k);t.refresh.eventKeys=[...keys].slice(-80)};
  if(installed.messages)for(const x of Array.isArray(r?.messages)?r.messages:[]){
    if(count>=max)break;const c=allowed.get(lc(x.sender)),text=String(x.text||'').trim(),mediaType=['photo','video'].includes(x.mediaType)?x.mediaType:'',mediaDescription=String(x.mediaDescription||'').trim();
    if(!c||c.blocked||(!text&&!mediaDescription))continue;const key=`m:${c.name}:${text.toLowerCase().slice(0,80)}:${mediaType}:${mediaDescription.toLowerCase().slice(0,80)}`;if(keys.has(key))continue;
    let th=x.threadId&&t.threads[x.threadId]?t.threads[x.threadId]:Object.values(t.threads).find(v=>v.type==='direct'&&v.contactIds[0]===c.id);
    if(!th){th={id:`thread:${id()}`,type:'direct',title:c.nickname||c.name,contactIds:[c.id],createdAt:stamp,messages:[]};t.threads[th.id]=th;t.threadOrder.unshift(th.id)}
    if(th.type==='group'&&!th.contactIds.includes(c.id))continue;
    const created=appendIncomingMessage(t,th,c,{text,mediaType,mediaDescription},stamp,true);for(const msg of created)continuityEntries.push({th,msg,ownerName:persona().name});
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
  for(const e of continuityEntries)recordMessageContinuity(e.th,t,e.msg,e.ownerName);
}
function cleanPlainReply(raw){
  let text=String(raw||'').trim().replace(/^```(?:text|txt)?\s*/i,'').replace(/\s*```$/,'').trim();
  if(!text||text==='{}'||text==='[]')return'';text=text.replace(/^["“](.*)["”]$/s,'$1').trim();return text;
}
function inferMediaFromText(text,requested=''){
  const raw=String(text||'').trim();if(!raw)return null;
  if(/\b(?:not sending|won't send|would rather not|don't feel comfortable|not comfortable|not sure (?:i'm|i am) comfortable|not sure if (?:i'm|i am) comfortable|don't think (?:i'm|i am) comfortable|not ready|maybe later|wait until you|get home to see|not gonna send|i'm not sending|i am not sending|rather wait|rather not)\b/i.test(raw))return null;
  const kind=requested==='video'||(/\b(?:video|clip)\b/i.test(raw)&&!/\b(?:photo|picture|pic|selfie)\b/i.test(raw))?'video':'photo';
  const cue=kind==='video'?/\b(?:video|clip)\b/i:/\b(?:photo|picture|pic|selfie)\b/i;
  const positive=/(?:here(?:'s| is)|just sent|sending you|i(?:'m| am) sending|i(?:'ll| will) send|let me send|take this|another one|this one|selfie|clip)/i;
  if(!cue.test(raw)||!positive.test(raw))return null;
  let desc=raw
    .replace(/^(?:sure|okay|ok|fine|alright|haha|hehe|lol|lmao|well|mm+|mhm|yep|yeah|of course|definitely|i can|i could|i'll be happy to)\b[^.!?]*[.!?]?\s*/i,'')
    .replace(/^(?:here(?:'s| is)|sending you|i(?:'m| am) sending|i(?:'ll| will) send|let me send you)\s+(?:another\s+)?(?:a\s+)?(?:photo|picture|pic|selfie|video|clip)\s*(?:of)?\s*/i,'')
    .replace(/^(?:me|myself)\s+/i,'')
    .trim();
  desc=desc.replace(/^[:\-–]+\s*/,'').trim();
  if(!desc)return null;
  return {type:kind,mediaDescription:desc,text:''};
}
function parseDirectReply(raw,requested=''){
  const text=cleanPlainReply(raw);if(!text)return[];
  const out=[];
  for(const line of text.split(/\n+/)){
    const m=line.trim().match(/^(TEXT|PHOTO|VIDEO)\s*:\s*(.*)$/i);if(!m)continue;
    const kind=m[1].toLowerCase(),value=String(m[2]||'').trim();if(!value)continue;
    if(kind==='text')out.push({type:'text',text:value});else out.push({type:kind,mediaDescription:value,text:''});
  }
  if(out.length)return out.slice(0,4);
  const inferred=inferMediaFromText(text,requested);
  return inferred?[inferred]:[{type:'text',text}];
}
function parseGroupReply(raw,contacts){
  const allowed=new Map(contacts.map(c=>[lc(c.name),c])),out=[];
  for(const line of cleanPlainReply(raw).split(/\n+/)){const match=line.trim().match(/^([^:]{1,80}):\s*(.+)$/s);if(!match)continue;const c=allowed.get(lc(match[1])),text=String(match[2]||'').trim();if(c&&text)out.push({sender:c.name,type:'text',text})}
  return out.slice(0,4);
}
function conversationTail(conversation,n=24){return conversation.slice(-n).map(messageContext)}
function textingVoiceEvidence(contact,conversation=[]){
  const own=(conversation||[]).filter(m=>lc(m?.sender)===lc(contact?.name)).slice(-8).map(m=>m?.type==='text'?String(m.text||'').trim():String(m.text||m.mediaDescription||'').trim()).filter(Boolean);
  const d=cardData(contact||{});return{recentMessages:own,personality:String(d.personality||'').slice(0,1800),examples:String(d.mes_example||'').slice(0,2200),description:String(d.description||'').slice(0,2600)};
}
function replyIdentityConflict(raw,contact,owner){
  const text=cleanPlainReply(raw),cn=norm(contact?.name),on=norm(owner?.name);if(!text||!cn||!on||lc(cn)===lc(on))return false;
  const q=v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),cq=q(cn),oq=q(on);
  return new RegExp(`\\b(?:i\\s*am|i['’]?m|im|my\\s+name\\s+is)\\s+${oq}\\b`,'i').test(text)||
    new RegExp(`\\b(?:you\\s+are|you['’]?re|youre|ur)\\s+${cq}\\b`,'i').test(text);
}

async function generateReply(th,mode='text'){
  const t=timeline(),owner=persona(),contacts=th.contactIds.map(k=>t.contacts[k]).filter(Boolean);if(!contacts.length)return;
  replyBusy=true;islandText=mode==='call'?'On call…':'Typing…';islandIcon=mode==='call'?'fa-solid fa-phone':'fa-solid fa-ellipsis';render();
  const continuityToRecord=[];
  try{
    const w=world(),activeCall=mode==='call'&&callId?t.calls.find(x=>x.id===callId):null,conversation=mode==='call'?(activeCall?.transcript||[]):th.messages;let replies=[];
    if(th.type==='direct'){
      const c=contacts[0],latest=conversation.at(-1),requested=mode==='text'&&latest?.requestMedia,voice=textingVoiceEvidence(c,conversation);
      if(mode==='call'){
        const systemPrompt=`IDENTITY LOCK — authoritative:
You are ${c.name}. You are speaking to ${owner.name}. Never become ${owner.name}, never claim ${owner.name}'s name/identity/history as your own, and never tell ${owner.name} that they are ${c.name}.
Facts under CONTACT are about YOU. Facts under PHONE OWNER are about the other person.

You are ${c.name} on a private phone call inside an ongoing fictional roleplay.
Reply ONLY with what ${c.name} says aloud. No JSON, speaker label, narration or stage directions.
Preserve ${c.name}'s actual personality and relationship. Speak like a real person, not a formal assistant or therapist.
Use slang, teasing, profanity, warmth, hesitation, laughter, emojis-as-words only if they genuinely fit ${c.name}; do not force any one style.
Match established conversational rhythm and emotion.
Use Greyhaven Life as authoritative current world/time context when available.`;
        const prompt=`CONTACT — AUTHORITATIVE IDENTITY:
${JSON.stringify({name:c.name,character:cardData(c),life:w.people.find(p=>lc(p.name)===lc(c.name))||null})}

CONTACT VOICE EVIDENCE:
${JSON.stringify(voice)}

PHONE OWNER — THE OTHER PERSON:
${JSON.stringify({name:owner.name,relationshipContext:owner.description.slice(0,9000)||'(not found)'})}

GREYHAVEN LIFE:
${JSON.stringify({time:w.time,scene:w.scene,people:w.people,snapshot:w.snapshot})}

RECENT MAIN RP:
${recentChat()}

CALL TRANSCRIPT:
${JSON.stringify((activeCall?.transcript||[]).slice(-24).map(x=>`${x.sender}: ${x.text}`))}

Give ${c.name}'s next spoken reply now.`;
        let raw=await generate({prompt,systemPrompt,responseLength:500});
        if(replyIdentityConflict(raw,c,owner))raw=await generate({prompt:`${prompt}\n\nIDENTITY CORRECTION: Your previous attempt confused identities. You are ${c.name}. ${owner.name} is the other person. Reply again only as ${c.name}.`,systemPrompt,responseLength:500});
        let text=cleanPlainReply(raw);
        if(!text)raw=await generate({prompt:`Reply naturally as ${c.name} in this phone call. Return only one spoken reply.`,systemPrompt:`You are ${c.name}; ${owner.name} is the other person. Never swap identities.`,responseLength:300}),text=cleanPlainReply(raw);
        if(text)replies=[{sender:c.name,type:'text',text}];
      }else{
        const systemPrompt=`IDENTITY LOCK — authoritative:
You are CONTACT ${c.name}. The phone owner is ${owner.name}. Never become ${owner.name}; never say your name is ${owner.name}; never assign ${owner.name}'s identity, possessions or relationship facts to yourself. Never tell ${owner.name} that they are ${c.name}.
CONTACT CARD facts are about YOU. PHONE OWNER context is only background about the person you are texting.

You are ${c.name}, texting privately with ${owner.name} inside an ongoing fictional roleplay.
Write like ${c.name} actually texts — emotionally alive, personal and character-specific. Do NOT default to polished formal prose, customer-service language, therapy-speak, or repetitive "I'm not sure / can we talk about it" phrasing unless that genuinely matches ${c.name}.
Use the CONTACT VOICE EVIDENCE and existing thread as the strongest style reference. Short messages, multiple texts, lowercase, abbreviations, slang, emojis, teasing, dry humor, profanity, typos or expressive punctuation are all allowed when they fit this character. More mature/formal characters may naturally text differently.
Preserve established personality, relationship, knowledge and current mood.
Use Greyhaven Life as authoritative current world/time context when available.
You may reply with text, a fictional photo, a fictional video, or text plus one media item.
A media request is NOT automatic compliance and NOT automatic refusal. Decide from relationship, trust, mood, established boundaries and the conversation.
For close romantic/intimate partners or strongly mutual teasing dynamics, complying is normal when it fits. For strangers/low-trust contacts or mismatched mood, refusal can be completely natural.
If refusing, return TEXT only. Never fabricate a PHOTO/VIDEO card that contains refusal text.
If sending media, actually use PHOTO: or VIDEO: and describe only what the recipient would see.
Return 1-3 lines using ONLY these formats:
TEXT: message text
PHOTO: concise visual description of the photo
VIDEO: concise visual description of the video
No JSON, speaker labels, markdown or narration.`;
        const prompt=`CONTACT — AUTHORITATIVE IDENTITY:
${JSON.stringify({name:c.name,character:cardData(c),life:w.people.find(p=>lc(p.name)===lc(c.name))||null})}

CONTACT VOICE EVIDENCE:
${JSON.stringify(voice)}

PHONE OWNER — THE OTHER PERSON:
${JSON.stringify({name:owner.name,relationshipContext:owner.description.slice(0,9000)||'(not found)'})}

GREYHAVEN LIFE:
${JSON.stringify({time:w.time,scene:w.scene,people:w.people,snapshot:w.snapshot})}

RECENT MAIN RP:
${recentChat()}

TEXT THREAD:
${JSON.stringify(conversationTail(conversation,28))}

LATEST REQUEST MODE:
${requested?`The latest owner message explicitly requested a ${requested}. Judge it naturally from this exact relationship and mood. If ${c.name} chooses to comply, return an actual ${requested.toUpperCase()}: line. If ${c.name} refuses, return TEXT only.`:'No explicit media request.'}

Continue the conversation naturally in ${c.name}'s own texting voice.`;
        let raw=await generate({prompt,systemPrompt,responseLength:760});
        if(replyIdentityConflict(raw,c,owner))raw=await generate({prompt:`${prompt}\n\nIDENTITY CORRECTION: The last draft swapped identities. You are ${c.name}; ${owner.name} is the phone owner. Keep ${c.name}'s own personality and texting style and answer again.`,systemPrompt,responseLength:760});
        let items=parseDirectReply(raw,requested||'');
        if(!items.length){raw=await generate({prompt:`Reply as ${c.name} to the latest phone message. You are ${c.name}, not ${owner.name}. Match ${c.name}'s natural texting voice. Return TEXT: followed by the reply.`,systemPrompt:`You are ${c.name}. ${owner.name} is the other person. Never swap identities.`,responseLength:350});items=parseDirectReply(raw,requested||'')}
        replies=items.map(x=>({sender:c.name,...x}));
      }
    }else{
      const systemPrompt=`Simulate the next messages in this fictional group text thread.
Only these contacts may speak: ${contacts.map(c=>c.name).join(', ')}.
Each sender MUST remain themselves. Never make a sender adopt the phone owner's identity or another member's name/history.
Match each person's established personality and their existing texting style. Do not flatten everyone into formal, polite prose. Emojis, slang, abbreviations, teasing and different punctuation are welcome when character-appropriate.
Return 1-4 lines only. Every line MUST use exactly: Sender Name: message
No JSON, markdown or narration.`;
      const prompt=`PHONE OWNER (not an allowed generated speaker unless listed above): ${owner.name}
CONTACT DATA: ${JSON.stringify(contacts.map(c=>({name:c.name,character:compactCard(c),voice:textingVoiceEvidence(c,conversation),life:w.people.find(p=>lc(p.name)===lc(c.name))||null})))}
GREYHAVEN LIFE: ${JSON.stringify({time:w.time,scene:w.scene,people:w.people,snapshot:w.snapshot})}
THREAD:
${conversation.slice(-28).map(messageContext).join('\n')}
Continue naturally without swapping identities.`;
      replies=parseGroupReply(await generate({prompt,systemPrompt,responseLength:760}),contacts);
    }
    if(!replies.length)throw new Error('The model returned no usable phone reply.');
    const allowed=new Map(contacts.map(c=>[lc(c.name),c])),stamp=now().getTime();
    mutate(cur=>{
      const target=cur.threads[th.id];if(!target)return;
      for(const x of replies){
        const c=allowed.get(lc(x.sender));if(!c)continue;
        if(mode==='call'&&callId){
          const call=cur.calls.find(v=>v.id===callId);if(call){const entry={sender:c.name,text:String(x.text||'').trim(),timeMs:stamp,realMs:Date.now()};call.transcript.push(entry);continuityToRecord.push({kind:'call',participants:[owner.name,c.name],sender:c.name,summary:`${c.name} said on a phone call: ${entry.text}`,threadTitle:`Call with ${c.name}`,roleplayMs:stamp})}continue;
        }
        const text=String(x.text||'').trim(),mediaDescription=String(x.mediaDescription||'').trim(),type=['photo','video'].includes(x.type)?x.type:'text';
        if(type==='text'&&!text)continue;if(type!=='text'&&!mediaDescription)continue;
        const mirrorId=`mirror:${id()}`,msg=normalizeMessage({id:id(),mirrorId,sender:c.name,senderId:c.id,text,type,mediaDescription,timeMs:stamp,realMs:Date.now(),read:true});
        target.messages.push(msg);
        continuityToRecord.push({th:target,t:cur,msg,ownerName:owner.name});
        if(target.type==='direct')mirrorRichMessageToPhone({phoneOwner:c.name,phoneOwnerAvatar:c.avatar,peerName:owner.name,peerAvatar:owner.avatar,peerDescription:owner.description,senderName:c.name,message:msg,unread:false});
      }
    },false);
    for(const e of continuityToRecord){if(e.msg)recordMessageContinuity(e.th,e.t,e.msg,e.ownerName);else recordContinuityEvent(e)}
  }catch(e){console.error(`[${GHP_MODULE}] reply`,e);globalThis.toastr?.error?.(`Phone reply failed: ${e?.message||e}`)}
  finally{replyBusy=false;islandText='';islandIcon='';render()}
}
function sendThread(tid,text,mode='text',opts={}){
  text=String(text||'').trim();if((!text&&mode==='text')||replyBusy)return;const owner=persona(),stamp=now().getTime();let th,created=null,callEvent=null;
  mutate(t=>{
    th=t.threads[tid];if(!th)return;
    if(mode==='call'&&callId){const c=t.calls.find(v=>v.id===callId);if(c&&text){const entry={sender:owner.name,text,timeMs:stamp,realMs:Date.now()};c.transcript.push(entry);callEvent={kind:'call',participants:[owner.name,c.contactName],sender:owner.name,summary:`${owner.name} said on a phone call: ${text}`,threadTitle:`Call with ${c.contactName}`,roleplayMs:stamp}}return}
    const mirrorId=`mirror:${id()}`,msg=normalizeMessage({id:id(),mirrorId,sender:owner.name,senderId:owner.key,text,timeMs:stamp,realMs:Date.now(),read:true,type:'text',requestMedia:opts.requestMedia||''});
    th.messages.push(msg);created={th,t,msg,ownerName:owner.name};
    if(th.type==='direct'){const peer=t.contacts[th.contactIds[0]];if(peer)mirrorRichMessageToPhone({phoneOwner:peer.name,phoneOwnerAvatar:peer.avatar,peerName:owner.name,peerAvatar:owner.avatar,peerDescription:owner.description,senderName:owner.name,message:msg,unread:true})}
  },false);
  if(created)recordMessageContinuity(created.th,created.t,created.msg,created.ownerName);if(callEvent)recordContinuityEvent(callEvent);
  if(th)generateReply(th,mode);
}
function sendMediaMessage(tid,kind,description,caption='',mediaKey='',meta=null){
  if(replyBusy||!['photo','video'].includes(kind))return;description=String(description||'').trim();caption=String(caption||'').trim();if(!description)return;
  const owner=persona(),stamp=now().getTime();let th,created=null;
  mutate(t=>{
    th=t.threads[tid];if(!th)return;const mirrorId=`mirror:${id()}`,msg=normalizeMessage({sender:owner.name,senderId:'owner',type:kind,text:caption,mirrorId,mediaDescription:description,mediaKey,mediaWidth:meta?.width||0,mediaHeight:meta?.height||0,timeMs:stamp,realMs:Date.now(),read:true});
    th.messages.push(msg);created={th,t,msg,ownerName:owner.name};
    if(th.type==='direct'){const peer=t.contacts[th.contactIds[0]];mirrorRichMessageToPhone({phoneOwner:peer.name,phoneOwnerAvatar:peer.avatar,peerName:owner.name,peerAvatar:owner.avatar,peerDescription:owner.description,senderName:owner.name,message:msg,unread:true})}
  },false);
  if(created)recordMessageContinuity(created.th,created.t,created.msg,created.ownerName);
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
function header(title,sub='',right=''){return`<header class="ghp-app-header"><button data-back><i class="fa-solid fa-chevron-left"></i></button><div><b>${esc(title)}</b>${sub?`<small>${esc(sub)}</small>`:''}</div><span>${right}</span></header>`}
function empty(iconClass,title,text,action=''){return`<div class="ghp-empty"><i class="${iconClass}"></i><b>${esc(title)}</b><span>${esc(text)}</span>${action}</div>`}

function renderMessages(){
  const t=timeline(),ths=t.threadOrder.map(k=>t.threads[k]).filter(Boolean).sort((a,b)=>Number(b.messages.at(-1)?.timeMs||b.createdAt||0)-Number(a.messages.at(-1)?.timeMs||a.createdAt||0));
  return`<div class="ghp-app">${header('Messages','','<button data-new-thread><i class="fa-solid fa-pen-to-square"></i></button>')}<main>${ths.length?ths.map(th=>{const last=th.messages.at(-1),u=unread(th);return`<button class="ghp-row" data-thread="${esc(th.id)}">${threadAvatar(th,t)}<span><b>${esc(threadTitle(th,t))}</b><small>${last?`${last.sender===persona().name?'You: ':''}${esc(messagePreview(last))}`:'Start a conversation'}</small></span><em><time>${last?esc(rel(last.timeMs)):''}</time>${u?`<i>${u}</i>`:''}</em></button>`}).join(''):empty('fa-regular fa-comments','No conversations yet','Start a chat with a relevant contact.','<button data-new-thread>New message</button>')}</main></div>`;
}
function markRead(tid){mutate(t=>{const th=t.threads[tid];if(th)for(const m of th.messages)if(m.sender!==persona().name)m.read=true;for(const n of t.notifications)if(n.app==='messages'&&n.targetId===tid)n.read=true},false)}
function renderMediaVisual(m,tid='',mine=false){
  const icon=m.type==='video'?'fa-solid fa-video':'fa-regular fa-image',label=m.type==='video'?'Video':'Photo';
  const ratio=(m.mediaWidth&&m.mediaHeight)?` style="--ghp-media-ar:${m.mediaWidth}/${m.mediaHeight}"`:'';
  const local=m.mediaKey?(m.type==='video'?`<video data-media-key="${esc(m.mediaKey)}" controls playsinline preload="metadata"></video>`:`<img data-media-key="${esc(m.mediaKey)}" alt="${esc(m.mediaDescription||label)}">`):'';
  const attachLabel=m.mediaKey?`Replace local ${label.toLowerCase()} preview`:`Attach local ${label.toLowerCase()} preview`;
  const attach=tid&&m.id?`<button type="button" class="ghp-media-tool" data-link-thread="${esc(tid)}" data-link-media="${esc(m.id)}" data-link-kind="${esc(m.type)}" title="${esc(attachLabel)}"><i class="fa-solid ${m.mediaKey?'fa-pen':'fa-paperclip'}"></i></button>`:'';
  return`<div class="ghp-media-visual ${m.mediaKey?'has-key':''}"${ratio}>${local}<div class="ghp-media-placeholder"><i class="${icon}"></i><b>${label}</b><span>${esc(m.mediaDescription||`${label} attachment`)}</span>${m.mediaKey?'<small>Local preview</small>':''}</div>${attach}</div>${m.text?`<p class="ghp-media-caption">${esc(m.text)}</p>`:''}`;
}
function renderMessageBubble(m,th){
  const mine=lc(m.sender)===lc(persona().name),groupName=th.type==='group'&&!mine?`<small class="ghp-msg-sender">${esc(m.sender)}</small>`:'';
  const body=m.type==='photo'||m.type==='video'?renderMediaVisual(m,th.id,mine):`<p>${esc(m.text)}</p>`;
  const request=m.requestMedia?`<small class="ghp-msg-request"><i class="${m.requestMedia==='video'?'fa-solid fa-video':'fa-regular fa-image'}"></i> Requested a ${esc(m.requestMedia)}</small>`:'';
  const edited=m.editedAt?'<span class="ghp-edited">Edited</span>':'';
  return`<div class="ghp-msg ${mine?'mine':''} ${m.type!=='text'?'has-media':''}" data-thread-id="${esc(th.id)}" data-message-id="${esc(m.id)}" data-message-sender="${esc(m.sender)}">${groupName}${body}${request}<time>${edited}${esc(timeText(new Date(m.timeMs)))}</time></div>`;
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
  if(document.querySelector('#ghp-overlay'))return;const o=document.createElement('div');o.id='ghp-overlay';o.hidden=true;o.innerHTML=`<div class="ghp-backdrop" data-close></div><section class="ghp-device"><button class="ghp-close" data-close><i class="fa-solid fa-xmark"></i></button><div class="ghp-content"></div></section>`;o.addEventListener('click',click);o.addEventListener('change',change);o.addEventListener('submit',submit);o.addEventListener('pointerdown',messagePressStart);o.addEventListener('pointermove',messagePressMove);o.addEventListener('pointerup',messagePressEnd);o.addEventListener('pointercancel',messagePressEnd);o.addEventListener('contextmenu',messageContextMenu);document.body.appendChild(o);
}
function render(){
  const o=document.querySelector('#ghp-overlay');if(!o||o.hidden)return;seedContacts(false);o.querySelector('.ghp-content').innerHTML=!unlocked&&profile().lockScreen?renderLock():(app?renderApp():renderHome());
  requestAnimationFrame(()=>{for(const s of o.querySelectorAll('.ghp-thread main,.ghp-call-screen main'))s.scrollTop=s.scrollHeight;hydrateMediaPreviews()});
}
function goBack(){
  composeRequest={threadId:'',kind:''};
  if(app==='thread'){threadId='';app='messages';return render()}
  if(app==='contact'){contactId='';app='contacts';return render()}
  if(app==='story'){threadId='';app='social';return render()}
  if(app==='call'){callId='';app='phone';return render()}
  if(app){threadId='';contactId='';callId='';app='';return render()}
  render();
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

function findThreadMessage(tid,mid,t=timeline(false)){const th=t?.threads?.[tid],m=th?.messages?.find(x=>x.id===mid);return th&&m?{th,m}:null}
function editMirroredMessage(tid,mid,patch={}){
  const active=timeline(),hit=findThreadMessage(tid,mid,active);if(!hit)return false;const owner=persona();
  if(lc(hit.m.sender)!==lc(owner.name)){globalThis.toastr?.warning?.(`Switch to ${hit.m.sender}'s persona to edit this message.`);return false}
  const mirrorId=hit.m.mirrorId,editedAt=Date.now(),r=metadataRoot();if(!r)return false;let continuityMsg=null,changed=false;
  for(const phone of Object.values(r.phones||{})){
    const t=normalizeTimeline(phone);
    for(const th of Object.values(t.threads||{})){
      for(const m of th.messages||[]){
        if((mirrorId&&m.mirrorId===mirrorId)||(!mirrorId&&t===active&&th.id===tid&&m.id===mid)){
          if(m.type==='text'){if(patch.text!==undefined)m.text=String(patch.text||'').trim()}
          else{if(patch.mediaDescription!==undefined)m.mediaDescription=String(patch.mediaDescription||'').trim();if(patch.text!==undefined)m.text=String(patch.text||'').trim()}
          m.editedAt=editedAt;continuityMsg=clone(m);changed=true;
          for(const n of t.notifications||[])if(n.app==='messages'&&n.targetId===th.id&&Math.abs(Number(n.timeMs||0)-Number(m.timeMs||0))<1500)n.text=notificationTextForMessage(m);
        }
      }
    }
  }
  if(!changed)return false;saveMetadataRoot(r);if(mirrorId&&continuityMsg)updateContinuityMirror(mirrorId,continuityMsg);else updatePrompt();render();return true;
}
function deleteMessageLocal(tid,mid){
  let removed=false;mutate(t=>{const th=t.threads[tid];if(!th)return;const before=th.messages.length;th.messages=th.messages.filter(m=>m.id!==mid);removed=th.messages.length!==before},false);
  if(removed){render();globalThis.toastr?.success?.('Message deleted from this phone.')}return removed;
}
function unsendMessageEverywhere(tid,mid){
  const active=timeline(),hit=findThreadMessage(tid,mid,active);if(!hit)return false;const owner=persona();
  if(lc(hit.m.sender)!==lc(owner.name)){globalThis.toastr?.warning?.(`Switch to ${hit.m.sender}'s persona to unsend this message.`);return false}
  const mirrorId=hit.m.mirrorId,r=metadataRoot();if(!r)return false;let removed=false;
  for(const phone of Object.values(r.phones||{})){
    const t=normalizeTimeline(phone);
    for(const th of Object.values(t.threads||{})){
      const old=[...(th.messages||[])],gone=old.filter(m=>(mirrorId&&m.mirrorId===mirrorId)||(!mirrorId&&t===active&&th.id===tid&&m.id===mid));
      if(!gone.length)continue;removed=true;const times=new Set(gone.map(m=>Number(m.timeMs||0)));th.messages=old.filter(m=>!gone.includes(m));
      t.notifications=(t.notifications||[]).filter(n=>!(n.app==='messages'&&n.targetId===th.id&&times.has(Number(n.timeMs||0))));
    }
  }
  if(!removed)return false;saveMetadataRoot(r);if(mirrorId)removeContinuityMirror(mirrorId);else updatePrompt();render();globalThis.toastr?.success?.('Message unsent.');return true;
}
function editMessagePopup(tid,mid){
  const hit=findThreadMessage(tid,mid);if(!hit)return;const {m}=hit,owner=persona();if(lc(m.sender)!==lc(owner.name)){globalThis.toastr?.warning?.(`Switch to ${m.sender}'s persona to edit this message.`);return}
  const media=m.type!=='text';
  const fields=media?`<label><span><b>${m.type==='video'?'Video':'Photo'} description</b><small>This remains the AI-visible description.</small></span><textarea class="msg-media-desc">${esc(m.mediaDescription)}</textarea></label><label><span><b>Caption / message</b></span><textarea class="msg-edit-text">${esc(m.text)}</textarea></label>`:`<label><span><b>Message</b></span><textarea class="msg-edit-text">${esc(m.text)}</textarea></label>`;
  const d=popup(`<form method="dialog" class="ghp-message-edit"><header><b>Edit Message</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header>${fields}<button type="button" class="primary" data-save-message-edit>Save</button></form>`);
  d.querySelector('[data-save-message-edit]').onclick=()=>{const text=d.querySelector('.msg-edit-text')?.value??'',mediaDescription=d.querySelector('.msg-media-desc')?.value??m.mediaDescription;if((!media&&!String(text).trim())||(media&&!String(mediaDescription).trim())){globalThis.toastr?.warning?.(media?'Media description cannot be empty.':'Message cannot be empty.');return}if(editMirroredMessage(tid,mid,{text,mediaDescription}))d.close()};
}
function messageActionPopup(tid,mid){
  const hit=findThreadMessage(tid,mid);if(!hit)return;const {m}=hit,owner=persona(),mine=lc(m.sender)===lc(owner.name),canUnsend=mine&&!!m.mirrorId;
  const d=popup(`<div class="ghp-message-actions"><header><b>Message</b><button data-popup-close><i class="fa-solid fa-xmark"></i></button></header><small class="ghp-action-sender">${esc(m.sender)} · ${esc(timeText(new Date(m.timeMs)))}</small>${mine?`<button class="ghp-popup-action" data-edit-message><i class="fa-solid fa-pen"></i><span><b>Edit</b><small>Updates the mirrored message on both phones.</small></span></button>`:''}${canUnsend?`<button class="ghp-popup-action danger" data-unsend-message><i class="fa-solid fa-delete-left"></i><span><b>Unsend for everyone</b><small>Removes this mirrored message from both phones.</small></span></button>`:''}<button class="ghp-popup-action danger subtle" data-delete-local-message><i class="fa-solid fa-trash"></i><span><b>Delete from this phone</b><small>${mine?'Leaves the other phone copy intact.':`To edit or unsend, switch to ${esc(m.sender)}'s persona.`}</small></span></button></div>`);
  d.querySelector('[data-popup-close]').onclick=()=>d.close();
  d.querySelector('[data-edit-message]')?.addEventListener('click',()=>{d.close();editMessagePopup(tid,mid)});
  d.querySelector('[data-unsend-message]')?.addEventListener('click',()=>{if(confirm('Unsend this message for everyone?')){d.close();unsendMessageEverywhere(tid,mid)}});
  d.querySelector('[data-delete-local-message]').onclick=()=>{d.close();deleteMessageLocal(tid,mid)};
}
function cancelMessageLongPress(){if(longPressTimer)clearTimeout(longPressTimer);longPressTimer=null;longPressTarget=null;longPressPoint=null}
function messagePressStart(e){
  if(e.button!==undefined&&e.button!==0)return;const bubble=e.target.closest?.('.ghp-msg[data-message-id]');if(!bubble||e.target.closest?.('button,video,a,input,textarea,select'))return;cancelMessageLongPress();
  longPressTarget=bubble;longPressPoint={x:Number(e.clientX||0),y:Number(e.clientY||0)};longPressTimer=setTimeout(()=>{const b=longPressTarget;cancelMessageLongPress();if(b)messageActionPopup(b.dataset.threadId,b.dataset.messageId)},560);
}
function messagePressMove(e){if(!longPressTimer||!longPressPoint)return;const dx=Number(e.clientX||0)-longPressPoint.x,dy=Number(e.clientY||0)-longPressPoint.y;if(Math.hypot(dx,dy)>12)cancelMessageLongPress()}
function messagePressEnd(){cancelMessageLongPress()}
function messageContextMenu(e){const bubble=e.target.closest?.('.ghp-msg[data-message-id]');if(!bubble||e.target.closest?.('button,video,a,input,textarea,select'))return;e.preventDefault();cancelMessageLongPress();messageActionPopup(bubble.dataset.threadId,bubble.dataset.messageId)}

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
async function fileMediaMeta(file,kind=''){
  if(!file)return null;return await probeMediaDimensions(file,'',kind||((file.type||'').startsWith('video/')?'video':'photo'));
}
async function setLocalMessagePreview(tid,mid,file){
  if(!file)return;
  const key=await saveMediaBlob(file),meta=await fileMediaMeta(file,(file.type||'').startsWith('video/')?'video':'photo');
  mutate(t=>{const th=t.threads[tid],m=th?.messages?.find(x=>x.id===mid);if(!m)return;m.mediaKey=key;if(meta?.width&&meta?.height){m.mediaWidth=meta.width;m.mediaHeight=meta.height;}},false);
  render();
}
function clearLocalMessagePreview(tid,mid){
  mutate(t=>{const th=t.threads[tid],m=th?.messages?.find(x=>x.id===mid);if(!m)return;m.mediaKey='';m.mediaWidth=0;m.mediaHeight=0;},false);
  render();
}
function attachExistingMediaPopup(tid,mid,kind='photo'){
  const th=timeline().threads[tid],m=th?.messages?.find(x=>x.id===mid);if(!m)return;
  const label=kind==='video'?'Video':'Photo',accept=kind==='video'?'video/*':'image/*';
  const d=popup(`<form method="dialog" class="ghp-media-form"><header><b>${m.mediaKey?'Replace':'Attach'} local ${label} preview</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><p class="ghp-popup-copy">Pick a local ${label.toLowerCase()} from your phone to replace this bubble visually. The AI still only understands the written description already in the chat.</p><label class="ghp-file-label"><span><b>Choose ${label}</b><small>This only changes how this message looks on this device.</small></span><input class="media-file" type="file" accept="${accept}"></label><div class="ghp-inline-actions"><button type="button" class="primary" data-confirm-link>${m.mediaKey?'Replace':'Attach'} ${label}</button>${m.mediaKey?`<button type="button" data-clear-link>Remove local preview</button>`:''}</div></form>`);
  d.querySelector('[data-confirm-link]').onclick=async()=>{const file=d.querySelector('.media-file').files?.[0];if(!file){globalThis.toastr?.warning?.(`Choose a ${label.toLowerCase()} first.`);return}const btn=d.querySelector('[data-confirm-link]');btn.disabled=true;btn.textContent='Saving…';await setLocalMessagePreview(tid,mid,file);d.close();};
  d.querySelector('[data-clear-link]')?.addEventListener('click',()=>{clearLocalMessagePreview(tid,mid);d.close();});
}

function mediaComposerPopup(tid,kind){
  const accept=kind==='video'?'video/*':'image/*',label=kind==='video'?'Video':'Photo';
  const d=popup(`<form method="dialog" class="ghp-media-form"><header><b>Send ${label}</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><label><span><b>What does it show?</b><small>This description is what the AI can understand.</small></span><textarea class="media-description" placeholder="${kind==='video'?'A short video of me walking along the beach…':'A selfie of myself lying in bed…'}"></textarea></label><label><span><b>Caption / message</b><small>Optional text sent with it.</small></span><textarea class="media-caption" placeholder="Optional message…"></textarea></label><label class="ghp-file-label"><span><b>Optional local ${label.toLowerCase()}</b><small>Only changes what you see in the bubble; the AI still uses the written description above.</small></span><input class="media-file" type="file" accept="${accept}"></label><button type="button" class="primary" data-confirm-media>Send ${label}</button></form>`);
  d.querySelector('[data-confirm-media]').onclick=async()=>{const description=d.querySelector('.media-description').value.trim(),caption=d.querySelector('.media-caption').value.trim(),file=d.querySelector('.media-file').files?.[0];if(!description){globalThis.toastr?.warning?.('Describe what the media shows first.');return}const btn=d.querySelector('[data-confirm-media]');btn.disabled=true;btn.textContent='Sending…';let mediaKey='',meta=null;if(file){mediaKey=await saveMediaBlob(file);meta=await fileMediaMeta(file,kind)}sendMediaMessage(tid,kind,description,caption,mediaKey,meta);d.close();render()};
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
  if(x.matches('[data-close]'))return closePhone();if(x.matches('[data-unlock]')){unlocked=true;app='';return render()}if(x.matches('[data-back]'))return goBack()
  if(x.dataset.openApp)return openApp(x.dataset.openApp);if(x.matches('[data-refresh]'))return refreshPhone();if(x.matches('[data-new-thread]'))return newThreadPopup();
  if(x.dataset.thread){threadId=x.dataset.thread;app='thread';return render()}if(x.matches('[data-add-contact]'))return addContactPopup();if(x.matches('[data-discover]')){seedContacts(true);globalThis.toastr?.success?.('Relevant contacts refreshed.');return render()}if(x.matches('[data-removed-contacts]'))return restoreContactsPopup();
  if(x.dataset.contact){contactId=x.dataset.contact;app='contact';return render()}if(x.dataset.messageContact){const th=directThread(x.dataset.messageContact);threadId=th.id;app='thread';return render()}if(x.dataset.removeContact)return removeContact(x.dataset.removeContact);
  if(x.dataset.threadMenu)return threadMenuPopup(x.dataset.threadMenu);if(x.dataset.mediaMenu)return mediaMenuPopup(x.dataset.mediaMenu);if(x.dataset.linkMedia)return attachExistingMediaPopup(x.dataset.linkThread,x.dataset.linkMedia,x.dataset.linkKind||'photo');if(x.matches('[data-cancel-media-request]')){composeRequest={threadId:'',kind:''};return render()}
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
function continuityLine(e){return`[${continuityTime(e.roleplayMs)}] ${e.threadTitle?`${e.threadTitle} · `:''}${e.participants.length?`participants: ${e.participants.join(', ')} · `:''}${e.summary}`}
function legacyPhoneHistory(){
  const t=timeline(false),relevant=relevantPhoneNames(),out=[];if(!t)return out;
  for(const th of t.threadOrder.map(k=>t.threads[k]).filter(Boolean)){const memberNames=th.contactIds.map(k=>t.contacts[k]?.name).filter(Boolean);if(!memberNames.some(n=>relevant.has(lc(n))))continue;for(const m of(th.messages||[]).slice(-4))out.push(`[${continuityTime(m.timeMs)}] ${threadTitle(th,t)} · ${messageContext(m)}`)}
  return out.slice(-8);
}
function phonePromptSummary(){
  if(!hasChat())return'';const snap=continuitySnapshot(),legacy=legacyPhoneHistory(),fresh=snap.fresh,planIds=new Set(fresh.filter(e=>e.persistent).map(e=>e.id)),plans=snap.plans.filter(e=>!planIds.has(e.id)),older=snap.history.filter(e=>!e.persistent).slice(-5);
  if(!fresh.length&&!plans.length&&!older.length&&!legacy.length)return'';
  const sections=[],cp=snap.checkpoint||{};
  if(fresh.length)sections.push(`FRESH PHONE EVENTS — occurred after the last rendered main-roleplay output:\n${fresh.map(continuityLine).join('\n')}`);
  if(plans.length)sections.push(`OLDER PHONE PLANS / COMMITMENTS — historical but may still matter if the roleplay has not resolved or cancelled them:\n${plans.map(continuityLine).join('\n')}`);
  if(older.length)sections.push(`OLDER PHONE HISTORY — past facts only; do NOT treat transient locations/activities here as current:\n${older.map(continuityLine).join('\n')}`);
  if(!snap.fresh.length&&!snap.plans.length&&legacy.length)sections.push(`LEGACY PHONE HISTORY FROM BEFORE THE CHRONOLOGY LEDGER — chronology is uncertain, so use only as past conversational facts, not as current location/activity:\n${legacy.join('\n')}`);
  const body=sections.join('\n\n').slice(-8200);
  return`[Greyhaven Phone — chronological phone ↔ roleplay continuity.]
Current fictional time: ${continuityTime(snap.nowMs)}.
Last rendered main-RP checkpoint: ${cp.roleplayMs?continuityTime(cp.roleplayMs):'not established yet'}.

${body}

STRICT CHRONOLOGY RULES:
- Fresh phone events really happened after the last rendered main-RP output and may advance a participant's state. Example: if Aurora later texted that she got into the bath, the next RP output should not replay her getting out of bed first.
- The newest explicit message in the CURRENT SillyTavern roleplay still wins if it contradicts Phone. Do not fight the live scene.
- Once a newer main-RP character output happens, older transient phone states are history. Never keep someone stuck in an old bathtub, bed, car, workplace, etc. just because it is still the latest message in their phone thread.
- Use RP timestamps sensibly: a transient activity from hours ago is not automatically still happening.
- Plans/commitments can survive across later turns when they are still unresolved, but later cancellation, completion, time passage, Greyhaven Life state, or explicit RP overrides them.
- Private messages/calls/media are knowledge only for their participants unless somebody shares them. They may still affect a participant's actions without making the contents public.
- Media is known only through its written visual description.
- Do not mechanically recap phone history; use it only when it naturally affects the scene.`;
}
function markRoleplayCheckpointIfAdvanced(){
  const box=continuityRoot(),c=ctx();if(!box||!Array.isArray(c?.chat)||!c.chat.length)return;const len=c.chat.length,last=c.chat.at(-1),cp=box.state.rpCheckpoint||{};
  if(last?.is_user||len===Number(cp.chatLength||0))return;markRoleplayCheckpoint();
}

function updatePrompt(){const c=ctx();if(!c?.setExtensionPrompt)return;const summary=hasChat()?phonePromptSummary():'';try{c.setExtensionPrompt(GHP_PROMPT_KEY,summary,GHP_PROMPT_POSITION_IN_CHAT,1,false,GHP_PROMPT_ROLE_SYSTEM)}catch(e){console.error(`[${GHP_MODULE}] setExtensionPrompt`,e)}}
function buildMenu(){const m=document.querySelector('#extensionsMenu');if(!m||document.querySelector('#ghp-menu-entry'))return;const d=document.createElement('div');d.id='ghp-menu-entry';d.className='list-group-item flex-container flexGap5 interactable';d.tabIndex=0;d.innerHTML='<i class="fa-solid fa-mobile-screen-button"></i><span>Greyhaven Phone</span>';d.onclick=openPhone;d.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPhone()}};m.appendChild(d)}
function observeMenu(){if(menuObserver)return;const m=document.querySelector('#extensionsMenu');if(!m)return;let q=false;menuObserver=new MutationObserver(()=>{if(q)return;q=true;requestAnimationFrame(()=>{q=false;buildMenu()})});menuObserver.observe(m,{childList:true})}
function onChat(){const k=chatIdentity();if(k===currentChat)return;currentChat=k;app='';threadId='';contactId='';callId='';composeRequest={threadId:'',kind:''};unlocked=!profile().lockScreen;if(hasChat()){timeline();seedContacts(true)}if(!document.querySelector('#ghp-overlay')?.hidden)render()}
function bind(){
  if(bound)return;const c=ctx();if(!c?.eventSource||!c.eventTypes)return;const b=(k,fn)=>{const e=c.eventTypes[k];if(e)c.eventSource.on(e,fn)};
  b('CHAT_CHANGED',()=>setTimeout(()=>{onChat();updatePrompt()},30));b('CHAT_CREATED',()=>setTimeout(()=>{onChat();updatePrompt()},30));b('PERSONA_CHANGED',()=>setTimeout(()=>{app='';threadId='';contactId='';callId='';composeRequest={threadId:'',kind:''};unlocked=!profile().lockScreen;timeline();seedContacts(true);updatePrompt();render()},50));b('GENERATION_STARTED',()=>updatePrompt());b('GROUP_UPDATED',()=>setTimeout(()=>seedContacts(true),50));b('CHARACTER_EDITED',()=>setTimeout(()=>seedContacts(true),50));b('MESSAGE_SENT',()=>{if(!document.querySelector('#ghp-overlay')?.hidden)render()});b('CHARACTER_MESSAGE_RENDERED',()=>setTimeout(()=>{markRoleplayCheckpointIfAdvanced();if(!document.querySelector('#ghp-overlay')?.hidden)render()},20));bound=true;
}
function subscribeLife(){try{lifeUnsub?.()}catch{}lifeUnsub=null;if(typeof globalThis.GreyhavenLife?.subscribe==='function')lifeUnsub=globalThis.GreyhavenLife.subscribe(()=>{if(!document.querySelector('#ghp-overlay')?.hidden)render()})}
function startClock(){clearInterval(clockTimer);clockTimer=setInterval(()=>{const o=document.querySelector('#ghp-overlay');if(o?.hidden)return;o.querySelectorAll('.ghp-status>span:first-child').forEach(x=>x.textContent=timeText());o.querySelectorAll('.ghp-lock h1').forEach(x=>x.textContent=timeText())},15000)}
function expose(){globalThis.GreyhavenPhone={version:GHP_VERSION,open:openPhone,close:closePhone,refresh:refreshPhone,getProfile:()=>clone(profile()),getTimeline:()=>clone(timeline(false)),getContacts:()=>{const t=timeline(false);return clone(t?t.contactOrder.map(k=>t.contacts[k]).filter(Boolean):[])},getActivePersona:()=>clone(persona()),getContinuitySnapshot:()=>clone(continuitySnapshot()),getPromptSummary:()=>phonePromptSummary(),seedContacts:()=>clone(seedContacts(true)),removeContact}}
async function waitReady(ms=15000){const s=Date.now();while(Date.now()-s<ms){if(ctx()?.extensionSettings&&document.body)return true;await new Promise(r=>setTimeout(r,120))}return false}
async function init(){if(initialized)return;if(!await waitReady())return;try{buildOverlay();buildMenu();observeMenu();bind();expose();onChat();updatePrompt();subscribeLife();startClock();initialized=true;console.info(`[${GHP_MODULE}] v${GHP_VERSION} loaded`)}catch(e){console.error(`[${GHP_MODULE}] init`,e)}}
void init().catch(e=>console.error(`[${GHP_MODULE}] boot`,e));
