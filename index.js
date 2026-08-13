const GHP_MODULE = 'greyhaven-phone';
const GHP_VERSION = '2.2.0';
const GHP_META_KEY = 'greyhavenPhone';
const GHP_SETTINGS_KEY = 'greyhavenPhone';
const GHP_PROMPT_KEY = 'greyhaven_phone_continuity';
const GHP_IDENTITY_PROMPT_KEY = 'greyhaven_phone_identities';
const GHP_PROMPT_POSITION_IN_CHAT = 1;
const GHP_PROMPT_ROLE_SYSTEM = 0;
const MEDIA_DB_NAME = 'GreyhavenPhoneMedia';
const MEDIA_STORE = 'media';
const MAX_MARKETPLACE_LISTINGS = 60;
const MAX_DARKWEB_LISTINGS = 80;
const PHONE_ACTION_RE = /<!--\s*GH_ACTION\s+([\s\S]*?)-->/gi;

const APPS = {
  messages:{label:'Messages',icon:'fa-solid fa-comment',tint:'#4cd964'},
  phone:{label:'Phone',icon:'fa-solid fa-phone',tint:'#48cf62'},
  contacts:{label:'Contacts',icon:'fa-solid fa-address-book',tint:'#aeb3bd'},
  instagram:{label:'Instagram',icon:'fa-brands fa-instagram',tint:'#c837ab'},
  snapchat:{label:'Snapchat',icon:'fa-brands fa-snapchat',tint:'#f6df36'},
  facebook:{label:'Facebook',icon:'fa-brands fa-facebook-f',tint:'#1877f2'},
  dominos:{label:"Domino's",icon:'fa-solid fa-pizza-slice',tint:'#d51f35'},
  uber:{label:'Uber',icon:'fa-solid fa-car-side',tint:'#202126'},
  onlyfans:{label:'OnlyFans',icon:'fa-solid fa-lock-open',tint:'#00a8e8'},
  darkweb:{label:'Dark Web',icon:'fa-solid fa-user-secret',tint:'#49206f'},
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
  apps:{messages:true,phone:true,contacts:true,instagram:true,snapchat:true,facebook:true,dominos:false,uber:false,onlyfans:false,darkweb:false,calendar:true,photos:true,notes:true,mail:false,settings:true}
};

const DOMINOS_MENU = [
  {id:'margherita',category:'Pizza',name:'Margherita',description:'Tomato sauce, mozzarella and oregano',price:8.5,icon:'fa-solid fa-pizza-slice'},
  {id:'pepperoni',category:'Pizza',name:'Pepperoni',description:'Mozzarella and plenty of pepperoni',price:11.5,icon:'fa-solid fa-pizza-slice'},
  {id:'bbq-chicken',category:'Pizza',name:'BBQ Chicken',description:'Chicken, red onion, mozzarella and BBQ sauce',price:12.5,icon:'fa-solid fa-pizza-slice'},
  {id:'veggie',category:'Pizza',name:'Veggie Supreme',description:'Peppers, mushrooms, onion, olives and mozzarella',price:10.5,icon:'fa-solid fa-pizza-slice'},
  {id:'four-cheese',category:'Pizza',name:'Four Cheese',description:'Mozzarella, cheddar, parmesan and blue cheese',price:12,icon:'fa-solid fa-pizza-slice'},
  {id:'garlic-bread',category:'Sides',name:'Garlic Bread',description:'Oven-baked garlic bread with herbs',price:4,icon:'fa-solid fa-bread-slice'},
  {id:'wings',category:'Sides',name:'Chicken Wings',description:'Eight wings with a choice of dip',price:7.5,icon:'fa-solid fa-drumstick-bite'},
  {id:'wedges',category:'Sides',name:'Potato Wedges',description:'Seasoned wedges with garlic dip',price:4.5,icon:'fa-solid fa-bowl-food'},
  {id:'lava-cake',category:'Dessert',name:'Chocolate Lava Cake',description:'Warm chocolate cake with a soft center',price:4.5,icon:'fa-solid fa-cake-candles'},
  {id:'cookies',category:'Dessert',name:'Chocolate Cookies',description:'Four soft chocolate-chip cookies',price:4,icon:'fa-solid fa-cookie-bite'},
  {id:'cola',category:'Drinks',name:'Cola',description:'500 ml bottle',price:2.5,icon:'fa-solid fa-bottle-water'},
  {id:'water',category:'Drinks',name:'Water',description:'500 ml bottle',price:1.5,icon:'fa-solid fa-bottle-water'}
];

let initialized=false, bound=false, menuObserver=null, lifeUnsub=null, clockTimer=null;
let currentChat='', unlocked=false, app='', threadId='', contactId='', callId='';
let refreshBusy=false, replyBusy=false, replyHidden=false, islandText='', islandIcon='';
let appView='', itemId='', appReplyBusy=false, marketplaceRefreshBusy=false, darkWebRefreshBusy=false;
let composeRequest={threadId:'',kind:''};
let longPressTimer=null,longPressTarget=null,longPressPoint=null;
let mediaDbPromise=null;
const mediaObjectUrls=new Map();
const mediaDimensionCache=new Map();
const mediaMemoryFallback=new Map();

function ctx(){try{return globalThis.SillyTavern?.getContext?.()||null}catch(e){console.warn(`[${GHP_MODULE}] context`,e);return null}}
function clone(v){if(v===undefined)return undefined;try{return structuredClone(v)}catch{return JSON.parse(JSON.stringify(v))}}
function id(){try{return ctx()?.uuidv4?.()||crypto.randomUUID()}catch{return `ghp-${Date.now()}-${Math.random().toString(36).slice(2)}`}}
function hashString(value=''){let h=2166136261;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
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
  const c=ctx();if(!c?.extensionSettings)return{profiles:{},identities:{},socialProfiles:{},appRoles:{},onlyFansAccounts:{}};
  if(!c.extensionSettings[GHP_SETTINGS_KEY]||typeof c.extensionSettings[GHP_SETTINGS_KEY]!=='object')c.extensionSettings[GHP_SETTINGS_KEY]={profiles:{}};
  const r=c.extensionSettings[GHP_SETTINGS_KEY];if(!r.profiles||typeof r.profiles!=='object')r.profiles={};
  if(!r.identities||typeof r.identities!=='object'||Array.isArray(r.identities))r.identities={};
  if(!r.socialProfiles||typeof r.socialProfiles!=='object'||Array.isArray(r.socialProfiles))r.socialProfiles={};
  if(!r.appRoles||typeof r.appRoles!=='object'||Array.isArray(r.appRoles))r.appRoles={};
  if(!r.onlyFansAccounts||typeof r.onlyFansAccounts!=='object'||Array.isArray(r.onlyFansAccounts))r.onlyFansAccounts={};
  if(!r.identityVersion)r.identityVersion=1;
  if(!r.socialProfileVersion)r.socialProfileVersion=1;
  if(!r.appRoleVersion)r.appRoleVersion=1;
  return r;
}
function phoneDigits(value){return String(value||'').replace(/\D/g,'')}
function cleanPhoneNumber(value){return phoneDigits(value).slice(0,9)}
function validPhoneNumber(value){return /^\d{9}$/.test(phoneDigits(value))}
function characterIdentityId(ch,index=-1){
  const stable=String(ch?.avatar||ch?.data?.avatar||'').trim();
  return stable?`character:${encodeURIComponent(stable)}`:`character-name:${encodeURIComponent(norm(ch?.name||`character-${index}`))}`;
}
function personaIdentityId(p=persona()){
  const match=(ctx()?.characters||[]).map((ch,index)=>({ch,index})).filter(x=>lc(x.ch?.name)===lc(p.name));
  if(match.length===1)return characterIdentityId(match[0].ch,match[0].index);
  return`persona:${encodeURIComponent(p.avatarId||p.name)}`;
}
function nextPhoneNumber(registry){
  const used=new Set(Object.values(registry||{}).map(x=>cleanPhoneNumber(x?.phoneNumber)).filter(validPhoneNumber));
  for(let attempt=0;attempt<300;attempt++){
    let n=0;
    try{const a=new Uint32Array(1);crypto.getRandomValues(a);n=100000000+(a[0]%900000000)}catch{n=100000000+Math.floor(Math.random()*900000000)}
    const value=String(n);if(!used.has(value))return value;
  }
  for(let n=100000000;n<=999999999;n++)if(!used.has(String(n)))return String(n);
  throw new Error('No phone numbers are available.');
}
function normalizeIdentity(raw={},idValue=''){
  const x=raw&&typeof raw==='object'?raw:{};x.id=String(x.id||idValue||`provisional:${id()}`);x.kind=['character','persona','provisional'].includes(x.kind)?x.kind:'character';x.name=norm(x.name||'Unknown');x.avatar=String(x.avatar||'');x.characterAvatar=String(x.characterAvatar||'');x.personaAvatarId=String(x.personaAvatarId||'');x.phoneNumber=cleanPhoneNumber(x.phoneNumber);x.createdAt=Math.max(0,Number(x.createdAt||Date.now()));x.updatedAt=Math.max(0,Number(x.updatedAt||Date.now()));x.metadata=x.metadata&&typeof x.metadata==='object'?x.metadata:{};return x;
}
function ensureIdentity(descriptor={},create=true){
  const c=ctx(),root=settingsRoot(),registry=root.identities;
  const identityId=String(descriptor.id||'');if(!identityId)return null;
  let x=registry[identityId];if(!x&&!create)return null;
  if(!x)x={id:identityId,kind:descriptor.kind||'character',name:norm(descriptor.name),createdAt:Date.now(),metadata:{}};
  x=normalizeIdentity({...x,...descriptor,id:identityId},identityId);
  if(x.kind!=='provisional'&&!validPhoneNumber(x.phoneNumber))x.phoneNumber=nextPhoneNumber(registry);
  x.updatedAt=Date.now();registry[identityId]=x;
  if(c?.extensionSettings){c.extensionSettings[GHP_SETTINGS_KEY]=root;c.saveSettingsDebounced?.()}
  return x;
}
function ensureAllIdentities(){
  const c=ctx(),root=settingsRoot();
  for(let index=0;index<(c?.characters||[]).length;index++){
    const ch=c.characters[index],name=norm(ch?.name);if(!name)continue;
    ensureIdentity({id:characterIdentityId(ch,index),kind:'character',name,avatar:thumb(ch),characterAvatar:String(ch?.avatar||'')});
  }
  const p=persona();ensureIdentity({id:personaIdentityId(p),kind:personaIdentityId(p).startsWith('character:')?'character':'persona',name:p.name,avatar:p.avatar,personaAvatarId:p.avatarId});
  for(const identity of Object.values(root.identities||{}))socialProfileFor(normalizeIdentity(identity,identity.id));
  return root.identities;
}
function identityById(identityId,create=false){
  const root=settingsRoot(),x=root.identities?.[identityId];return x?normalizeIdentity(x,identityId):(create?ensureIdentity({id:identityId,name:'Unknown'}):null);
}
function identityForCharacter(ch,index=-1,create=true){
  if(!ch)return null;return ensureIdentity({id:characterIdentityId(ch,index),kind:'character',name:norm(ch.name),avatar:thumb(ch),characterAvatar:String(ch.avatar||'')},create);
}
function identityForName(name,{create=false}={}){
  name=norm(name);if(!name)return null;const c=ctx(),matches=(c?.characters||[]).map((ch,index)=>({ch,index})).filter(x=>lc(x.ch?.name)===lc(name));
  if(matches.length===1)return identityForCharacter(matches[0].ch,matches[0].index,create);
  const existing=Object.values(settingsRoot().identities||{}).map(x=>normalizeIdentity(x,x.id)).filter(x=>lc(x.name)===lc(name));
  if(existing.length===1)return existing[0];
  if(lc(persona().name)===lc(name)){const p=persona();return ensureIdentity({id:personaIdentityId(p),kind:personaIdentityId(p).startsWith('character:')?'character':'persona',name:p.name,avatar:p.avatar,personaAvatarId:p.avatarId},create)}
  return existing[0]||null;
}
function currentIdentity(){const p=persona();return ensureIdentity({id:personaIdentityId(p),kind:personaIdentityId(p).startsWith('character:')?'character':'persona',name:p.name,avatar:p.avatar,personaAvatarId:p.avatarId})}
function identityByNumber(number){if(!validPhoneNumber(number))return null;const value=phoneDigits(number);ensureAllIdentities();return Object.values(settingsRoot().identities||{}).map(x=>normalizeIdentity(x,x.id)).find(x=>x.phoneNumber===value)||null}
function createProvisionalIdentity(name,metadata={}){
  // Marketplace-generated people intentionally use one first name only.
  const first=(norm(name).match(/[\p{L}\p{M}'’-]+/u)||[])[0]||'Seller';
  return ensureIdentity({id:`provisional:${id()}`,kind:'provisional',name:first,phoneNumber:'',metadata:{...metadata,provisional:true}},true);
}
function seededSocialNumber(identity,salt,min,max){
  const span=Math.max(1,max-min+1),seed=parseInt(hashString(`${identity?.id||identity?.name||'identity'}:${salt}`),36)||0;
  return min+(Math.abs(seed)%span);
}
function inferredSocialProfile(identity){
  const found=findCharacter(identity?.name),card=cardData({name:identity?.name||'',characterId:found?.index??null}),text=lc([identity?.name,card.description,card.personality,card.scenario,identity?.metadata?.bio,identity?.metadata?.source].filter(Boolean).join(' '));
  const provisional=identity?.kind==='provisional';
  const onlyFans=/\bonly\s*fans\b|\bonlyfans\b/.test(text),influencer=onlyFans||/\binfluencer\b|\bcontent creator\b|\bsocial media (?:star|personality)\b|\binstagram model\b|\bstreamer\b|\bcelebrity\b|\bfamous online\b/.test(text);
  const publicFacing=influencer||/\bmodel\b|\bmusician\b|\bartist\b|\bdancer\b|\bcreator\b|\bpublic figure\b|\bpopular\b/.test(text);
  const feminine=/\b(?:she|her|hers|woman|women|girl|female|girlfriend|wife|mother|nurse)\b/.test(text);
  const attractive=/\b(?:attractive|beautiful|gorgeous|pretty|stunning|hot|glamorous|sexy)\b/.test(text);
  let tier='ordinary',followers,following,snapFriends,facebookFriends;
  if(provisional){
    tier='provisional';followers=seededSocialNumber(identity,'ig-followers',35,420);following=seededSocialNumber(identity,'ig-following',45,520);snapFriends=seededSocialNumber(identity,'snap-friends',25,180);facebookFriends=seededSocialNumber(identity,'fb-friends',40,480);
  }else if(influencer){
    tier=onlyFans?'creator':'influencer';followers=seededSocialNumber(identity,'ig-followers',onlyFans?10000:6500,onlyFans?32000:24000);following=seededSocialNumber(identity,'ig-following',180,980);snapFriends=seededSocialNumber(identity,'snap-friends',320,1800);facebookFriends=seededSocialNumber(identity,'fb-friends',420,2200);
  }else if(publicFacing){
    tier='public';followers=seededSocialNumber(identity,'ig-followers',1800,7800);following=seededSocialNumber(identity,'ig-following',220,1100);snapFriends=seededSocialNumber(identity,'snap-friends',180,850);facebookFriends=seededSocialNumber(identity,'fb-friends',300,1600);
  }else if(feminine){
    tier=attractive?'social':'personal';followers=seededSocialNumber(identity,'ig-followers',attractive?550:420,attractive?1050:900);following=seededSocialNumber(identity,'ig-following',120,480);snapFriends=seededSocialNumber(identity,'snap-friends',90,430);facebookFriends=seededSocialNumber(identity,'fb-friends',180,920);
  }else{
    followers=seededSocialNumber(identity,'ig-followers',120,720);following=seededSocialNumber(identity,'ig-following',110,620);snapFriends=seededSocialNumber(identity,'snap-friends',45,260);facebookFriends=seededSocialNumber(identity,'fb-friends',110,720);
  }
  if((feminine||publicFacing)&&following>=followers)following=Math.max(60,Math.floor(followers*.58));
  return{version:1,identityId:identity?.id||'',tier,generatedAt:Date.now(),instagram:{followersBase:followers,followingBase:following},snapchat:{friendsBase:snapFriends},facebook:{friendsBase:facebookFriends}};
}
function normalizeSocialProfile(raw={},identity=null){
  const fallback=inferredSocialProfile(identity),x=raw&&typeof raw==='object'?raw:{};
  x.version=Math.max(1,Number(x.version||1));x.identityId=identity?.id||String(x.identityId||'');x.tier=String(x.tier||fallback.tier);x.generatedAt=Math.max(0,Number(x.generatedAt||fallback.generatedAt));
  x.instagram=x.instagram&&typeof x.instagram==='object'?x.instagram:{};x.instagram.followersBase=Math.max(0,Math.round(Number(x.instagram.followersBase??fallback.instagram.followersBase)));x.instagram.followingBase=Math.max(0,Math.round(Number(x.instagram.followingBase??fallback.instagram.followingBase)));
  x.snapchat=x.snapchat&&typeof x.snapchat==='object'?x.snapchat:{};x.snapchat.friendsBase=Math.max(0,Math.round(Number(x.snapchat.friendsBase??fallback.snapchat.friendsBase)));
  x.facebook=x.facebook&&typeof x.facebook==='object'?x.facebook:{};x.facebook.friendsBase=Math.max(0,Math.round(Number(x.facebook.friendsBase??fallback.facebook.friendsBase)));
  return x;
}
function socialProfileFor(identityRef){
  const identity=typeof identityRef==='string'?(identityById(identityRef)||identityForName(identityRef,{create:false})):identityRef;if(!identity?.id)return normalizeSocialProfile({},identity||null);
  const root=settingsRoot(),existed=!!root.socialProfiles[identity.id],value=normalizeSocialProfile(root.socialProfiles[identity.id],identity);root.socialProfiles[identity.id]=value;
  if(!existed)ctx()?.saveSettingsDebounced?.();return value;
}
function socialCounts(t,identity=currentIdentity()){
  const base=socialProfileFor(identity),rels=Object.values(t?.relationships||{}),namedFollowers=rels.filter(r=>r.apps?.instagram?.followedBy).length,namedFollowing=rels.filter(r=>r.apps?.instagram?.following).length,namedSnap=rels.filter(r=>r.apps?.snapchat?.friends).length,namedFacebook=rels.filter(r=>r.apps?.facebook?.friends).length;
  return{instagram:{followers:base.instagram.followersBase+namedFollowers,following:base.instagram.followingBase+namedFollowing,anonymousFollowers:base.instagram.followersBase,anonymousFollowing:base.instagram.followingBase},snapchat:{friends:base.snapchat.friendsBase+namedSnap,anonymousFriends:base.snapchat.friendsBase},facebook:{friends:base.facebook.friendsBase+namedFacebook,anonymousFriends:base.facebook.friendsBase},tier:base.tier};
}
function defaultAppRoles(){return{version:1,dominos:{deliveryWorkerId:''},uber:{driverIds:[]},onlyfans:{creatorIds:[]},darkweb:{dealers:{},escorts:{},crime:{},intel:{}}}}
function globalAppRoles(){
  const root=settingsRoot(),raw=root.appRoles&&typeof root.appRoles==='object'?root.appRoles:{},value={...defaultAppRoles(),...raw};value.version=Math.max(1,Number(value.version||1));
  value.dominos=value.dominos&&typeof value.dominos==='object'?value.dominos:{deliveryWorkerId:''};value.dominos.deliveryWorkerId=String(value.dominos.deliveryWorkerId||'');
  value.uber=value.uber&&typeof value.uber==='object'?value.uber:{driverIds:[]};value.uber.driverIds=[...new Set((Array.isArray(value.uber.driverIds)?value.uber.driverIds:[]).map(String).filter(Boolean))];
  value.onlyfans=value.onlyfans&&typeof value.onlyfans==='object'?value.onlyfans:{creatorIds:[]};value.onlyfans.creatorIds=[...new Set((Array.isArray(value.onlyfans.creatorIds)?value.onlyfans.creatorIds:[]).map(String).filter(Boolean))];
  value.darkweb=value.darkweb&&typeof value.darkweb==='object'?value.darkweb:{};for(const role of ['dealers','escorts','crime','intel'])if(!value.darkweb[role]||typeof value.darkweb[role]!=='object'||Array.isArray(value.darkweb[role]))value.darkweb[role]={};
  root.appRoles=value;return value;
}
function saveGlobalAppRoles(roles){const root=settingsRoot();root.appRoles=roles;ctx()?.saveSettingsDebounced?.();updatePrompt();return roles}
function identityAge(identity){
  if(!identity)return 0;const found=findCharacter(identity.name),card=cardData({name:identity.name,characterId:found?.index??null}),text=[card.description,card.personality,card.scenario,identity.metadata?.bio].filter(Boolean).join('\n'),match=text.match(/(?:^|\n)\s*Age\s*:\s*(\d{1,3})\b/i)||text.match(/\b(\d{1,2})[- ]year[- ]old\b/i);return match?Math.max(0,Number(match[1]||0)):0;
}
function adultRoleEligible(identity){return identityAge(identity)>=18}
function normalizeOnlyFansPost(row={},identity=null){
  row=row&&typeof row==='object'?row:{};row.id=String(row.id||id());row.identityId=String(row.identityId||identity?.id||'');row.author=norm(row.author||identity?.name||'Creator');row.type=row.type==='video'?'video':'photo';row.visual=String(row.visual||row.mediaDescription||'').trim();row.caption=String(row.caption||'').trim();row.mediaKey=String(row.mediaKey||'');row.mediaWidth=Math.max(0,Number(row.mediaWidth||0));row.mediaHeight=Math.max(0,Number(row.mediaHeight||0));row.timeMs=Math.max(0,Number(row.timeMs||Date.now()));row.likes=Math.max(0,Math.round(Number(row.likes||0)));row.comments=Math.max(0,Math.round(Number(row.comments||0)));row.seeded=row.seeded===true;return row;
}
function seedOnlyFansPosts(identity,joinedAt){
  const captions=['late-night members-only drop 💙','a little behind-the-scenes moment','you asked, so I finally posted it 😏','soft light, no rush, just me'],visuals=['A suggestive bedroom mirror selfie with carefully framed adult-only content','A tasteful lingerie photo in warm low lighting','A playful adult creator selfie taken from bed','A short teasing video filmed in a softly lit room'];
  return captions.map((caption,index)=>normalizeOnlyFansPost({id:`onlyfans-seed:${hashString(identity.id)}:${index}`,identityId:identity.id,author:identity.name,type:index===2?'video':'photo',caption,visual:visuals[index],timeMs:Math.max(joinedAt,Date.now()-(index+2)*86400000*11),likes:seededSocialNumber(identity,`of-like-${index}`,35,1800),comments:seededSocialNumber(identity,`of-comment-${index}`,2,95),seeded:true},identity));
}
function inferredOnlyFansAccount(identity){
  const social=socialProfileFor(identity),tier=social.tier||'ordinary',ranges=tier==='creator'||tier==='influencer'?[1800,18000]:tier==='public'?[700,6500]:tier==='social'?[280,2400]:[120,1300],subscribers=seededSocialNumber(identity,'of-subscribers',ranges[0],ranges[1]),price=Number((seededSocialNumber(identity,'of-price',8,24)+.99).toFixed(2)),historicalPosts=seededSocialNumber(identity,'of-posts',24,tier==='creator'||tier==='influencer'?190:95),months=seededSocialNumber(identity,'of-months',6,28),joinedAt=Date.now()-months*30*86400000,monthly=Math.round(subscribers*price*.8),posts=seedOnlyFansPosts(identity,joinedAt);
  return{version:1,identityId:identity.id,enabled:true,subscriptionPrice:price,subscribersBase:subscribers,historicalPostCount:historicalPosts,monthlyEarningsBase:monthly,totalEarningsBase:monthly*months,joinedAt,posts,activity:[{id:`of-activity:${hashString(identity.id)}:1`,text:'Your latest post is performing better than usual.',timeMs:Date.now()-2*86400000},{id:`of-activity:${hashString(identity.id)}:2`,text:`${seededSocialNumber(identity,'of-new-subs',3,38)} new subscribers this week.`,timeMs:Date.now()-5*86400000},{id:`of-activity:${hashString(identity.id)}:3`,text:'A returning subscriber sent a private message.',timeMs:Date.now()-9*86400000}]};
}
function normalizeOnlyFansAccount(raw={},identity){
  const fallback=inferredOnlyFansAccount(identity),x=raw&&typeof raw==='object'?raw:{};x.version=Math.max(1,Number(x.version||1));x.identityId=identity.id;x.enabled=x.enabled!==false;x.subscriptionPrice=Math.max(1,Math.min(500,Number(x.subscriptionPrice??fallback.subscriptionPrice)));x.subscribersBase=Math.max(1,Math.round(Number(x.subscribersBase??fallback.subscribersBase)));x.historicalPostCount=Math.max(1,Math.round(Number(x.historicalPostCount??fallback.historicalPostCount)));x.monthlyEarningsBase=Math.max(0,Math.round(Number(x.monthlyEarningsBase??fallback.monthlyEarningsBase)));x.totalEarningsBase=Math.max(x.monthlyEarningsBase,Math.round(Number(x.totalEarningsBase??fallback.totalEarningsBase)));x.joinedAt=Math.max(0,Number(x.joinedAt||fallback.joinedAt));x.posts=Array.isArray(x.posts)?x.posts.map(row=>normalizeOnlyFansPost(row,identity)):fallback.posts;x.activity=Array.isArray(x.activity)?x.activity.filter(Boolean).slice(0,80):fallback.activity;return x;
}
function onlyFansAccount(identityRef,create=false){
  const identity=typeof identityRef==='string'?(identityById(identityRef)||identityForName(identityRef,{create:false})):identityRef;if(!identity?.id)return null;const root=settingsRoot(),roles=globalAppRoles(),assigned=roles.onlyfans.creatorIds.includes(identity.id),raw=root.onlyFansAccounts[identity.id];if(!assigned&&!create)return null;const account=normalizeOnlyFansAccount(raw||{},identity);account.enabled=assigned;root.onlyFansAccounts[identity.id]=account;if(!raw)ctx()?.saveSettingsDebounced?.();return account;
}
function onlyFansCreators(){const roles=globalAppRoles();return roles.onlyfans.creatorIds.map(identityById).filter(Boolean).map(identity=>({identity,account:onlyFansAccount(identity,true)}))}
function setOnlyFansCreator(identityRef,enabled=true,price=null){
  const identity=resolveIdentityRef(identityRef,true);if(!identity)return false;if(enabled&&!adultRoleEligible(identity))throw new Error('Only adult characters with an Age of 18 or older can be assigned as creators.');const root=settingsRoot(),roles=globalAppRoles(),set=new Set(roles.onlyfans.creatorIds);if(enabled)set.add(identity.id);else set.delete(identity.id);roles.onlyfans.creatorIds=[...set];saveGlobalAppRoles(roles);let account;if(enabled)account=onlyFansAccount(identity,true);else if(root.onlyFansAccounts[identity.id])account=normalizeOnlyFansAccount(root.onlyFansAccounts[identity.id],identity);if(account){account.enabled=enabled;if(price!==null&&price!=='')account.subscriptionPrice=Math.max(1,Math.min(500,Number(price)||account.subscriptionPrice));root.onlyFansAccounts[identity.id]=account;ctx()?.saveSettingsDebounced?.()}return true;
}
function setGlobalServiceRole(appName,role,identityRef,enabled=true,data={}){
  const identity=resolveIdentityRef(identityRef,true);if(!identity)return false;const roles=globalAppRoles();
  if(appName==='dominos'){roles.dominos.deliveryWorkerId=enabled?identity.id:(roles.dominos.deliveryWorkerId===identity.id?'':roles.dominos.deliveryWorkerId)}
  else if(appName==='uber'){const set=new Set(roles.uber.driverIds);enabled?set.add(identity.id):set.delete(identity.id);roles.uber.driverIds=[...set]}
  else if(appName==='darkweb'&&['dealers','escorts','crime','intel'].includes(role)){if(enabled&&role==='escorts'&&!adultRoleEligible(identity))throw new Error('Only adult characters with an Age of 18 or older can be assigned to Escorts.');if(enabled)roles.darkweb[role][identity.id]={enabled:true,price:String(data.price||roles.darkweb[role][identity.id]?.price||''),duration:String(data.duration||roles.darkweb[role][identity.id]?.duration||''),description:String(data.description||roles.darkweb[role][identity.id]?.description||''),updatedAt:Date.now()};else delete roles.darkweb[role][identity.id]}
  else return false;saveGlobalAppRoles(roles);return true;
}
function updateIdentityNumber(identityId,number){
  if(!validPhoneNumber(number))throw new Error('Phone numbers must contain exactly 9 digits.');const value=phoneDigits(number);
  const root=settingsRoot(),duplicate=Object.values(root.identities||{}).find(x=>x?.id!==identityId&&cleanPhoneNumber(x?.phoneNumber)===value);if(duplicate)throw new Error('That phone number already belongs to another Greyhaven identity.');
  const x=identityById(identityId);if(!x)throw new Error('Identity not found.');x.phoneNumber=value;x.updatedAt=Date.now();root.identities[identityId]=x;ctx()?.saveSettingsDebounced?.();updatePrompt();return clone(x);
}
function normalizeProfile(raw={}){
  const legacyApps=raw.apps||{},migratedApps={...legacyApps};
  if(!('instagram'in migratedApps)&&'social'in migratedApps)migratedApps.instagram=migratedApps.social;
  if(!('snapchat'in migratedApps)&&'snap'in migratedApps)migratedApps.snapchat=migratedApps.snap;
  delete migratedApps.social;delete migratedApps.snap;
  return{...DEFAULT_PROFILE,...raw,apps:{...DEFAULT_PROFILE.apps,...migratedApps},
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
function profileForIdentity(identity){if(identity?.id&&identity.id===currentIdentity()?.id)return profile();const profiles=Object.values(settingsRoot().profiles||{}),match=profiles.find(p=>lc(p?.personaName)===lc(identity?.name)&&(identity?.avatar?!p?.personaAvatar||String(p.personaAvatar)===String(identity.avatar):true))||profiles.find(p=>lc(p?.personaName)===lc(identity?.name));return normalizeProfile(match||{})}
function identityAppEnabled(identity,appName){if(identity?.kind==='provisional'&&['onlyfans','darkweb'].includes(appName))return true;return profileForIdentity(identity).apps?.[appName]!==false}

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
  m.deliveryState=['sent','not-delivered'].includes(m.deliveryState)?m.deliveryState:'sent';
  return m;
}
function defaultAppThread(){return{threads:{},threadOrder:[]}}
function defaultInstagram(){return{posts:[],stories:[],notifications:[],...defaultAppThread()}}
function defaultSnapchat(){return{stories:[],memories:[],eyesOnly:[],notifications:[],...defaultAppThread()}}
function defaultFacebook(){return{posts:[],notifications:[],friendRequests:[],marketplace:{listings:[],refresh:{lastAt:null,eventKeys:[],summary:''}},...defaultAppThread()}}
function defaultDominos(){return{cart:[],lastCategory:'Pizza'}}
function defaultUber(){return{savedDestination:''}}
function defaultOnlyFans(){return{notifications:[],...defaultAppThread()}}
function defaultDarkWeb(){return{notifications:[],...defaultAppThread()}}
function defaultTimeline(ownerName='',ownerAvatar=''){return{version:5,ownerName:norm(ownerName),ownerAvatar:ownerAvatar||'',identityId:'',createdAt:Date.now(),updatedAt:Date.now(),contacts:{},contactOrder:[],suppressedContacts:[],relationships:{},threads:{},threadOrder:[],calls:[],posts:[],stories:[],instagram:defaultInstagram(),snapchat:defaultSnapchat(),facebook:defaultFacebook(),dominos:defaultDominos(),uber:defaultUber(),onlyfans:defaultOnlyFans(),darkweb:defaultDarkWeb(),notifications:[],photos:[],notes:[],mail:[],refresh:{lastAt:null,chatLength:0,eventKeys:[],summary:''}}}
function normalizeContact(x={}){
  const characterId=x.characterId;x.id||=`contact:${id()}`;x.name=norm(x.name||'Unknown');x.avatar||='';x.characterId=characterId!==null&&characterId!==undefined&&characterId!==''&&Number.isInteger(Number(characterId))?Number(characterId):null;x.personaDescription=String(x.personaDescription||'');x.source||='manual';x.identityId=String(x.identityId||'');x.phoneNumber=cleanPhoneNumber(x.phoneNumber);x.saved=x.saved!==false;x.socialSeedVersion=Math.max(0,Number(x.socialSeedVersion||0));x.favorite=x.favorite===true;x.blocked=x.blocked===true;x.blockedByContact=x.blockedByContact===true;x.ignoringOwner=x.ignoringOwner===true;x.boundaryLevel=Math.max(0,Number(x.boundaryLevel||0)||0);x.muted=x.muted===true;x.locationSharing=['precise','approximate','off'].includes(x.locationSharing)?x.locationSharing:'precise';x.nickname||='';return x
}
function normalizeAppRelationship(raw={},identity=null){
  const r=raw&&typeof raw==='object'?raw:{};r.identityId=String(r.identityId||identity?.id||'');r.name=norm(r.name||identity?.name||'Unknown');r.avatar=String(r.avatar||identity?.avatar||'');r.familiarity=String(r.familiarity||'');r.relationshipType=String(r.relationshipType||'');r.impression=String(r.impression||'');r.friendliness=String(r.friendliness||'');r.tension=String(r.tension||'');r.interest=String(r.interest||'');r.latestInteraction=r.latestInteraction&&typeof r.latestInteraction==='object'?r.latestInteraction:null;r.knownContactInfo=r.knownContactInfo&&typeof r.knownContactInfo==='object'?r.knownContactInfo:{phoneNumber:false};r.apps=r.apps&&typeof r.apps==='object'?r.apps:{};
  r.apps.messages={blocked:false,blockedBy:false,...(r.apps.messages||{})};
  r.apps.instagram={following:false,followedBy:false,blocked:false,blockedBy:false,requestedAt:0,...(r.apps.instagram||{})};
  r.apps.snapchat={friends:false,outgoingRequest:false,incomingRequest:false,requestedAt:0,blocked:false,blockedBy:false,mapSharing:'precise',...((r.apps.snapchat)||{})};
  r.apps.facebook={friends:false,outgoingRequest:false,incomingRequest:false,requestedAt:0,blocked:false,blockedBy:false,...(r.apps.facebook||{})};
  r.apps.onlyfans={subscribed:false,subscribedBy:false,blocked:false,blockedBy:false,...(r.apps.onlyfans||{})};
  r.apps.darkweb={blocked:false,blockedBy:false,...(r.apps.darkweb||{})};
  return r;
}
function normalizeAppMessage(raw={}){
  const m=normalizeMessage(raw);m.opened=m.opened===true;m.saved=m.saved===true;m.app=String(m.app||'');return m;
}
function normalizeAppThreads(store={}){
  store=store&&typeof store==='object'?store:{};if(!store.threads||typeof store.threads!=='object')store.threads={};if(!Array.isArray(store.threadOrder))store.threadOrder=[];
  for(const [key,value] of Object.entries(store.threads)){const th=value&&typeof value==='object'?value:{};th.id=key;th.identityId=String(th.identityId||'');th.peerName=norm(th.peerName||'Unknown');th.peerAvatar=String(th.peerAvatar||'');th.messages=Array.isArray(th.messages)?th.messages.map(normalizeAppMessage):[];th.createdAt=Math.max(0,Number(th.createdAt||Date.now()));th.videoActive=th.videoActive===true;th.videoStartedAt=Math.max(0,Number(th.videoStartedAt||0));store.threads[key]=th}
  store.threadOrder=store.threadOrder.filter(k=>store.threads[k]);for(const key of Object.keys(store.threads))if(!store.threadOrder.includes(key))store.threadOrder.push(key);return store;
}
function normalizeSocialEngagement(row={},viewerIdentityId=''){
  row.likedBy=Array.isArray(row.likedBy)?[...new Set(row.likedBy.map(String).filter(Boolean))]:[];
  if(row.likedByOwner&&viewerIdentityId&&!row.likedBy.includes(viewerIdentityId))row.likedBy.push(viewerIdentityId);
  row.likeBaseCount=Math.max(0,Math.round(Number(row.likeBaseCount??Math.max(0,Number(row.likes||0)-row.likedBy.length))));row.likes=row.likeBaseCount+row.likedBy.length;
  row.comments=Array.isArray(row.comments)?row.comments.map(c=>typeof c==='string'?{id:id(),author:'Someone',identityId:'',text:c,timeMs:Number(row.timeMs||Date.now())}:{id:c?.id||id(),author:norm(c?.author||'Someone'),identityId:String(c?.identityId||''),text:String(c?.text||''),timeMs:Number(c?.timeMs||row.timeMs||Date.now())}):[];
  row.commentBaseCount=Math.max(0,Math.round(Number(row.commentBaseCount??Math.max(0,Number(row.commentCount||0)-row.comments.length))));row.commentCount=row.commentBaseCount+row.comments.length;
  row.viewers=Array.isArray(row.viewers)?[...new Set(row.viewers.map(String).filter(Boolean))]:[];row.likedByOwner=!!viewerIdentityId&&row.likedBy.includes(viewerIdentityId);return row;
}
function normalizeTimeline(t){
  t=t&&typeof t==='object'?t:defaultTimeline();t.version=Math.max(5,Number(t.version||1));t.ownerName=norm(t.ownerName||'');t.ownerAvatar=t.ownerAvatar||'';t.identityId=String(t.identityId||identityForName(t.ownerName,{create:false})?.id||'');t.updatedAt||=Date.now();
  if(!t.contacts||typeof t.contacts!=='object')t.contacts={};if(!Array.isArray(t.contactOrder))t.contactOrder=[];if(!Array.isArray(t.suppressedContacts))t.suppressedContacts=[];
  t.suppressedContacts=[...new Set(t.suppressedContacts.map(lc).filter(Boolean))];
  if(!t.relationships||typeof t.relationships!=='object'||Array.isArray(t.relationships))t.relationships={};
  for(const [k,v] of Object.entries(t.contacts)){
    const co=normalizeContact({...v,id:k}),byId=co.identityId?identityById(co.identityId):null,byName=identityForName(co.name,{create:false}),identityMismatch=!!(byId&&byName&&byId.id!==byName.id&&lc(byId.name)!==lc(co.name)),match=identityMismatch?byName:(byId||byName);
    if(match){const character=match.kind==='character'?findCharacter(match.name):null;co.identityId=match.id;co.characterId=character?.index??null;co.phoneNumber=match.phoneNumber||co.phoneNumber;co.avatar=identityMismatch?(match.avatar||co.avatar):(co.avatar||match.avatar)}
    t.contacts[k]=co;
  }
  t.contactOrder=t.contactOrder.filter(k=>t.contacts[k]);for(const k of Object.keys(t.contacts))if(!t.contactOrder.includes(k))t.contactOrder.push(k);
  for(const [key,value] of Object.entries(t.relationships)){const identity=identityById(key)||identityForName(value?.name,{create:false});t.relationships[key]=normalizeAppRelationship(value,identity)}
  for(const co of Object.values(t.contacts)){if(!co.identityId)continue;const identity=identityById(co.identityId);t.relationships[co.identityId]=normalizeAppRelationship(t.relationships[co.identityId],identity||co);t.relationships[co.identityId].knownContactInfo.phoneNumber=co.saved&&validPhoneNumber(co.phoneNumber);t.relationships[co.identityId].apps.messages.blocked=!!co.blocked;t.relationships[co.identityId].apps.messages.blockedBy=!!co.blockedByContact}
  if(!t.threads||typeof t.threads!=='object')t.threads={};if(!Array.isArray(t.threadOrder))t.threadOrder=[];
  for(const [k,v] of Object.entries(t.threads)){v.id=k;v.type=v.type==='group'?'group':'direct';v.title||='';v.contactIds=Array.isArray(v.contactIds)?v.contactIds.filter(Boolean):[];v.messages=Array.isArray(v.messages)?v.messages.map(normalizeMessage):[];v.createdAt||=Date.now()}
  t.threadOrder=t.threadOrder.filter(k=>t.threads[k]);for(const k of Object.keys(t.threads))if(!t.threadOrder.includes(k))t.threadOrder.push(k);
  for(const k of ['calls','posts','stories','notifications','photos','notes','mail'])if(!Array.isArray(t[k]))t[k]=[];
  for(const n of t.notifications){if(n?.app==='social')n.app='instagram';if(n?.app==='snap')n.app='snapchat'}
  t.instagram=normalizeAppThreads(t.instagram||{});if(!Array.isArray(t.instagram.posts))t.instagram.posts=t.posts;if(!Array.isArray(t.instagram.stories))t.instagram.stories=t.stories;if(!Array.isArray(t.instagram.notifications))t.instagram.notifications=[];
  if(!t.instagram.posts.length&&t.posts.length)t.instagram.posts=t.posts;if(!t.instagram.stories.length&&t.stories.length)t.instagram.stories=t.stories;for(const p of t.instagram.posts){normalizeSocialEngagement(p,t.identityId);const legacyContact=t.contacts?.[p.contactId],identity=p.identityId?identityById(p.identityId):identityForName(p.author||legacyContact?.name,{create:false});if(identity){p.identityId=identity.id;p.author=identity.name}}for(const s of t.instagram.stories){normalizeSocialEngagement(s,t.identityId);const legacyContact=t.contacts?.[s.contactId],identity=s.identityId?identityById(s.identityId):identityForName(s.author||legacyContact?.name,{create:false});if(identity){s.identityId=identity.id;s.author=identity.name}}t.posts=t.instagram.posts;t.stories=t.instagram.stories;
  t.snapchat=normalizeAppThreads(t.snapchat||{});for(const k of ['stories','memories','eyesOnly','notifications'])if(!Array.isArray(t.snapchat[k]))t.snapchat[k]=[];
  t.facebook=normalizeAppThreads(t.facebook||{});for(const k of ['posts','notifications','friendRequests'])if(!Array.isArray(t.facebook[k]))t.facebook[k]=[];for(const p of t.facebook.posts)normalizeSocialEngagement(p,t.identityId);if(!t.facebook.marketplace||typeof t.facebook.marketplace!=='object')t.facebook.marketplace={listings:[],refresh:{lastAt:null,eventKeys:[],summary:''}};if(!Array.isArray(t.facebook.marketplace.listings))t.facebook.marketplace.listings=[];for(const row of t.facebook.marketplace.listings){row.price=normalizeMarketplacePrice(row.price)||'€0';row.signature=marketplaceListingSignature(row)}t.facebook.marketplace.refresh=t.facebook.marketplace.refresh&&typeof t.facebook.marketplace.refresh==='object'?t.facebook.marketplace.refresh:{lastAt:null,eventKeys:[],summary:''};t.facebook.marketplace.refresh.eventKeys=Array.isArray(t.facebook.marketplace.refresh.eventKeys)?t.facebook.marketplace.refresh.eventKeys.slice(-120):[];
  t.dominos=t.dominos&&typeof t.dominos==='object'?t.dominos:defaultDominos();t.dominos.cart=Array.isArray(t.dominos.cart)?t.dominos.cart.filter(Boolean).map(x=>({menuId:String(x.menuId||''),quantity:Math.max(1,Math.min(20,Number(x.quantity||1)))})).filter(x=>DOMINOS_MENU.some(row=>row.id===x.menuId)):[];t.dominos.lastCategory=String(t.dominos.lastCategory||'Pizza');
  t.uber=t.uber&&typeof t.uber==='object'?t.uber:defaultUber();t.uber.savedDestination=String(t.uber.savedDestination||'');
  t.onlyfans=normalizeAppThreads(t.onlyfans||{});if(!Array.isArray(t.onlyfans.notifications))t.onlyfans.notifications=[];
  t.darkweb=normalizeAppThreads(t.darkweb||{});if(!Array.isArray(t.darkweb.notifications))t.darkweb.notifications=[];
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
  if(!r||typeof r!=='object'){r={version:5,phones:{},continuity:normalizeContinuity()};c.chatMetadata[GHP_META_KEY]=r}
  r.version=Math.max(5,Number(r.version||1));if(!r.phones||typeof r.phones!=='object')r.phones={};r.continuity=normalizeContinuity(r.continuity);if(!r.services||typeof r.services!=='object')r.services={};if(!r.onlyFans||typeof r.onlyFans!=='object')r.onlyFans={};if(!r.darkWeb||typeof r.darkWeb!=='object')r.darkWeb={};return r
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
  if(t){t=normalizeTimeline(t);t.ownerName=p.name;t.ownerAvatar=p.avatar||t.ownerAvatar||'';t.identityId=currentIdentity()?.id||t.identityId||'';r.phones[p.key]=t;if(oldKey)saveMetadataRoot(r)}
  return t||null;
}
function persist(t,doRender=true){
  const r=metadataRoot();if(!r)return;const p=persona();t=normalizeTimeline(t);t.ownerName=p.name;t.ownerAvatar=p.avatar||t.ownerAvatar||'';t.identityId=currentIdentity()?.id||t.identityId||'';t.updatedAt=Date.now();r.phones[p.key]=t;saveMetadataRoot(r);updatePrompt();if(doRender)render()
}
function mutate(fn,doRender=true){const t=timeline();fn(t);persist(t,doRender);return t}

function thumb(ch){const c=ctx();try{if(c?.getThumbnailUrl&&ch?.avatar)return c.getThumbnailUrl('avatar',ch.avatar)}catch{}return ch?.avatar?`/thumbnail?type=avatar&file=${encodeURIComponent(ch.avatar)}`:''}
function findCharacter(name){const c=ctx(),l=lc(name);const i=c?.characters?.findIndex(x=>lc(x?.name)===l)??-1;return i>=0?{character:c.characters[i],index:i}:null}
function unsuppress(t,name){const key=lc(name);t.suppressedContacts=(t.suppressedContacts||[]).filter(x=>x!==key)}
function isSuppressed(t,name){return(t.suppressedContacts||[]).includes(lc(name))}
function ensureRelationship(t,identityOrName){
  let identity=typeof identityOrName==='string'?(identityById(identityOrName)||identityForName(identityOrName,{create:false})):identityOrName;
  if(!identity?.id)return null;t.relationships||={};t.relationships[identity.id]=normalizeAppRelationship(t.relationships[identity.id],identity);return t.relationships[identity.id];
}
function noteRelationshipInteraction(t,identityOrName,appName,summary,timeMs=now().getTime()){
  const reln=ensureRelationship(t,identityOrName);if(!reln)return;reln.latestInteraction={app:appName,summary:String(summary||'').slice(0,600),timeMs:Number(timeMs||now().getTime())};
}
function upsertContact(t,d){
  const name=norm(d?.name),explicit=['manual','number','exchange'].includes(d?.source);if(!name||isSuppressed(t,name)&&!explicit)return null;
  const identity=d.identityId?identityById(d.identityId):identityForName(name,{create:true});
  let x=Object.values(t.contacts).find(c=>identity?.id&&c.identityId===identity.id)||Object.values(t.contacts).find(c=>d.characterId!==null&&d.characterId!==undefined&&c.characterId!==null&&Number(c.characterId)===Number(d.characterId))||Object.values(t.contacts).find(c=>lc(c.name)===lc(name));
  if(x){x.avatar=d.avatar||identity?.avatar||x.avatar;if(d.characterId!==undefined&&d.characterId!==null)x.characterId=Number(d.characterId);if(d.personaDescription)x.personaDescription=String(d.personaDescription);if(identity){x.identityId=identity.id;x.phoneNumber=identity.phoneNumber||x.phoneNumber}if(d.saved===true)x.saved=true;if(d.source==='manual'||d.source==='number'||d.source==='exchange')x.source=d.source;const reln=ensureRelationship(t,identity);if(reln&&x.saved)reln.knownContactInfo.phoneNumber=validPhoneNumber(x.phoneNumber);return x}
  const cid=d.id||`contact:${id()}`;x=normalizeContact({...d,id:cid,name,identityId:identity?.id||'',phoneNumber:identity?.phoneNumber||d.phoneNumber||'',avatar:d.avatar||identity?.avatar||'',saved:d.saved===true});t.contacts[cid]=x;t.contactOrder.push(cid);const reln=ensureRelationship(t,identity);if(reln&&x.saved)reln.knownContactInfo.phoneNumber=validPhoneNumber(x.phoneNumber);return x;
}
function relationshipSections(text=''){
  const source=String(text||'').replace(/\r\n?/g,'\n'),sections=[];
  const re=/(?:^|\n)\s*(?:#{1,6}\s*)?Relationships?\s*:\s*([\s\S]*?)(?=\n\s*(?:#{1,6}\s*)?(?:Roleplay\s+Notes?|Scenario|Example\s+(?:Dialogue|Messages?)|Dialogue\s+Examples?|Writing\s+Style|System\s+Notes?)\s*:|$)/giu;
  for(const match of source.matchAll(re))if(String(match[1]||'').trim())sections.push(String(match[1]).trim());
  return sections;
}
function relationshipDescriptors(){
  const owner=currentIdentity(),found=findCharacter(owner?.name),texts=[personaDescription()];
  if(found?.character){for(const value of [found.character.description,found.character.data?.description])if(typeof value==='string')texts.push(value)}
  const section=relationshipSections(texts.filter(Boolean).join('\n')).join('\n');if(!section)return[];
  const identities=Object.values(settingsRoot().identities||{}).map(x=>normalizeIdentity(x,x.id)).filter(x=>x.kind!=='provisional'&&x.id!==owner?.id),firstCounts=new Map();
  for(const identity of identities){const first=(identity.name.match(/[\p{L}\p{M}'’-]+/u)||[])[0]||'';if(first)firstCounts.set(lc(first),(firstCounts.get(lc(first))||0)+1)}
  const mentioned=value=>{const q=String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return!!q&&new RegExp(`(^|[^\\p{L}\\p{N}])${q}(?=[^\\p{L}\\p{N}]|$)`,'iu').test(section)};
  const out=[];
  for(const identity of identities){const match=findCharacter(identity.name),first=(identity.name.match(/[\p{L}\p{M}'’-]+/u)||[])[0]||'',aliases=[identity.name];if(first.length>=3&&firstCounts.get(lc(first))===1)aliases.push(first);if(!aliases.some(mentioned))continue;out.push({name:identity.name,avatar:identity.avatar||thumb(match?.character),characterId:match?.index??null,identityId:identity.id,phoneNumber:identity.phoneNumber,source:'relationship',saved:true})}
  return out;
}
function lifeDescriptors(){try{return(globalThis.GreyhavenLife?.getPeople?.()||[]).map(p=>{const m=findCharacter(p.name);return{p,m}}).filter(x=>x.m||x.p?.source==='character').map(({p,m})=>({name:p.name,avatar:p.avatar||thumb(m?.character),characterId:m?.index??null,source:'life'}))}catch{return[]}}
function chatDescriptors(){
  const c=ctx(),out=[];if(!c)return out;const add=i=>{i=Number(i);if(!Number.isInteger(i)||i<0)return;const ch=c.characters?.[i];if(ch)out.push({name:ch.name,avatar:thumb(ch),characterId:i,source:'chat'})};
  if(c.groupId){const g=c.groups?.find(x=>String(x?.id)===String(c.groupId)),disabled=new Set(Array.isArray(g?.disabled_members)?g.disabled_members:[]);for(const m of g?.members||[]){const a=typeof m==='string'?m:m?.avatar;if(a&&!disabled.has(a))add(c.characters?.findIndex(ch=>ch?.avatar===a))}}else add(c.characterId);return out;
}
function seedContacts(save=true){
  // An explicit Relationships: card entry represents an established connection
  // and seeds a saved contact. Ordinary prose mentions, chat participation and
  // Life tracking still never reveal a number automatically.
  ensureAllIdentities();const t=timeline(),owner=currentIdentity();
  for(const descriptor of relationshipDescriptors())upsertContact(t,descriptor)
  for(const co of Object.values(t.contacts||{})){
    const identity=co.identityId?identityById(co.identityId):identityForName(co.name,{create:false});
    if(!identity)continue;co.identityId=identity.id;co.phoneNumber=identity.phoneNumber||co.phoneNumber;co.avatar=co.avatar||identity.avatar;co.saved=co.saved!==false;const reln=ensureRelationship(t,identity);if(reln&&co.saved)reln.knownContactInfo.phoneNumber=validPhoneNumber(co.phoneNumber);if(co.saved&&co.socialSeedVersion<1)seedSavedContactSocials(owner,t,co,identity);
  }
  if(save)persist(t,false);return t.contactOrder.map(k=>t.contacts[k]).filter(Boolean);
}
function saveContactForOwner(ownerRef,targetRef,{source='exchange'}={}){
  const owner=resolveIdentityRef(ownerRef,true),target=resolveIdentityRef(targetRef,true);if(!owner||!target||owner.id===target.id)return null;const box=phoneForIdentity(owner,true);if(!box)return null;unsuppress(box.timeline,target.name);const found=findCharacter(target.name),co=upsertContact(box.timeline,{name:target.name,avatar:target.avatar,characterId:found?.index??null,identityId:target.id,phoneNumber:target.phoneNumber,source:['number','exchange'].includes(source)?source:'exchange',saved:true});if(!co)return null;co.saved=true;co.phoneNumber=target.phoneNumber;const reln=ensureRelationship(box.timeline,target);if(reln)reln.knownContactInfo.phoneNumber=true;if(co.socialSeedVersion<1)seedSavedContactSocials(owner,box.timeline,co,target);box.root.phones[box.key]=box.timeline;saveMetadataRoot(box.root);return clone(co);
}
function contact(x){const t=timeline(),l=lc(x);return t.contacts[x]||Object.values(t.contacts).find(c=>lc(c.name)===l||lc(c.nickname)===l)||null}
function directThread(cid){
  const t=timeline();if(!t.contacts[cid])return null;let th=Object.values(t.threads).find(x=>x.type==='direct'&&x.contactIds.length===1&&x.contactIds[0]===cid);if(th)return th;
  th={id:`thread:${id()}`,type:'direct',title:t.contacts[cid].nickname||t.contacts[cid].name,contactIds:[cid],createdAt:Date.now(),messages:[]};t.threads[th.id]=th;t.threadOrder.unshift(th.id);persist(t,false);return th;
}

function phoneForOwner(ownerName,ownerAvatar='',create=true){
  const r=metadataRoot();if(!r)return null;const name=norm(ownerName);if(!name)return null;
  let hit=Object.entries(r.phones).find(([,v])=>lc(v?.ownerName)===lc(name));
  if(hit){const t=normalizeTimeline(hit[1]),identity=identityForName(name,{create:true});t.ownerName=name;t.ownerAvatar=ownerAvatar||identity?.avatar||t.ownerAvatar||'';t.identityId=identity?.id||t.identityId||'';return{root:r,key:hit[0],timeline:t}}
  if(!create)return null;
  const identity=identityForName(name,{create:true}),key=`latent:${slug(name)}`;const t=defaultTimeline(name,ownerAvatar||identity?.avatar||'');t.identityId=identity?.id||'';r.phones[key]=t;return{root:r,key,timeline:t};
}
function phoneForIdentity(identity,create=true){
  if(!identity?.id)return null;const r=metadataRoot();if(!r)return null;
  let hit=Object.entries(r.phones).find(([,value])=>String(value?.identityId||'')===identity.id);
  if(!hit&&identity.kind!=='provisional')hit=Object.entries(r.phones).find(([,value])=>lc(value?.ownerName)===lc(identity.name));
  if(hit){const t=normalizeTimeline(hit[1]);t.ownerName=identity.name;t.ownerAvatar=identity.avatar||t.ownerAvatar||'';t.identityId=identity.id;return{root:r,key:hit[0],timeline:t}}
  if(!create)return null;const key=`latent-id:${encodeURIComponent(identity.id)}`,t=defaultTimeline(identity.name,identity.avatar||'');t.identityId=identity.id;r.phones[key]=t;return{root:r,key,timeline:t};
}
function seedSavedContactSocials(owner,ownerTimeline,contactRow,target){
  if(!owner?.id||!target?.id||owner.id===target.id||!ownerTimeline||contactRow?.socialSeedVersion>=1)return false;
  const targetBox=phoneForIdentity(target,true),ownerState=ensureRelationship(ownerTimeline,target),targetState=targetBox?ensureRelationship(targetBox.timeline,owner):null;if(!ownerState||!targetState)return false;
  ownerState.apps.instagram.following=true;ownerState.apps.instagram.followedBy=true;ownerState.apps.instagram.requestedAt=0;
  targetState.apps.instagram.following=true;targetState.apps.instagram.followedBy=true;targetState.apps.instagram.requestedAt=0;
  for(const state of [ownerState.apps.snapchat,targetState.apps.snapchat]){state.friends=true;state.outgoingRequest=false;state.incomingRequest=false;state.requestedAt=0}
  for(const state of [ownerState.apps.facebook,targetState.apps.facebook]){state.friends=true;state.outgoingRequest=false;state.incomingRequest=false;state.requestedAt=0}
  contactRow.socialSeedVersion=1;contactRow.socialSeededAt=Date.now();
  if(targetBox){targetBox.root.phones[targetBox.key]=targetBox.timeline;syncVisibleSocialContentForPair(owner,ownerTimeline,target,targetBox.timeline,targetBox.root)}
  return true;
}
function ensurePeerContact(t,name,avatar='',personaDescription=''){
  const match=findCharacter(name),identity=identityForName(name,{create:true});return upsertContact(t,{name,avatar:avatar||identity?.avatar||thumb(match?.character),characterId:match?.index??null,identityId:identity?.id||'',phoneNumber:identity?.phoneNumber||'',personaDescription,source:'phone-peer',saved:false});
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
  th.messages.push(source);noteRelationshipInteraction(box.timeline,peer.identityId||peer.name,'messages',messageContext(source),source.timeMs);
  if(unread)box.timeline.notifications.unshift({id:id(),app:'messages',title:peer.nickname||peer.name,text:notificationTextForMessage(source),timeMs:source.timeMs,read:false,targetId:th.id});
  box.timeline.updatedAt=Date.now();box.root.phones[box.key]=box.timeline;saveMetadataRoot(box.root);
}

function appStore(t,appName){return t?.[appName]||null}
function ensureAppThreadIn(t,appName,identity){
  const store=appStore(t,appName);if(!store||!identity?.id)return null;let th=Object.values(store.threads||{}).find(x=>x.identityId===identity.id);
  if(!th){const key=`${appName}-thread:${id()}`;th={id:key,identityId:identity.id,peerName:identity.name,peerAvatar:identity.avatar||'',createdAt:Date.now(),messages:[]};store.threads[key]=th;store.threadOrder.unshift(key)}
  th.peerName=identity.name;th.peerAvatar=identity.avatar||th.peerAvatar||'';return th;
}
function pushAppNotification(t,appName,identity,text,targetId='',eventId=''){
  const notification={id:id(),app:appName,title:identity?.name||appName,text:String(text||'New activity'),timeMs:now().getTime(),read:false,targetId,eventId};t.notifications.unshift(notification);appStore(t,appName)?.notifications?.unshift?.(clone(notification));return notification;
}
function mirrorAppMessage({appName,fromName,toName,fromIdentityId='',toIdentityId='',type='text',text='',mediaDescription='',mediaKey='',mediaWidth=0,mediaHeight=0,timeMs=now().getTime(),mirrorId='',unread=true}){
  if(!['instagram','snapchat','facebook','onlyfans','darkweb'].includes(appName))return null;const fromIdentity=identityById(fromIdentityId)||identityForName(fromName,{create:true}),toIdentity=identityById(toIdentityId)||identityForName(toName,{create:true});if(!fromIdentity||!toIdentity)return null;
  if(!identityAppEnabled(toIdentity,appName))return{delivered:false,disabled:true};
  const sender=phoneForIdentity(fromIdentity,true),recipient=phoneForIdentity(toIdentity,true);if(!sender||!recipient)return null;
  const senderRel=ensureRelationship(sender.timeline,toIdentity),recipientRel=ensureRelationship(recipient.timeline,fromIdentity),appKey=appName==='snapchat'?'snapchat':appName;
  if(senderRel?.apps?.[appKey]?.blockedBy||recipientRel?.apps?.[appKey]?.blocked)return{delivered:false};
  const shared=mirrorId||`${appName}:${id()}`,message=normalizeAppMessage({id:id(),mirrorId:shared,sender:fromIdentity.name,senderId:fromIdentity.id,type,text,mediaDescription,mediaKey,mediaWidth,mediaHeight,timeMs,realMs:Date.now(),read:true,opened:appName!=='snapchat'||type==='text'});
  const senderThread=ensureAppThreadIn(sender.timeline,appName,toIdentity),recipientThread=ensureAppThreadIn(recipient.timeline,appName,fromIdentity);if(!senderThread||!recipientThread)return null;
  if(!senderThread.messages.some(x=>x.mirrorId===shared))senderThread.messages.push({...clone(message),id:id(),read:true,opened:true});
  if(!recipientThread.messages.some(x=>x.mirrorId===shared))recipientThread.messages.push({...clone(message),id:id(),read:!unread,opened:appName!=='snapchat'||type==='text'});
  noteRelationshipInteraction(sender.timeline,toIdentity,appName,`${fromIdentity.name}: ${text||mediaDescription}`,timeMs);noteRelationshipInteraction(recipient.timeline,fromIdentity,appName,`${fromIdentity.name}: ${text||mediaDescription}`,timeMs);
  if(unread)pushAppNotification(recipient.timeline,appName,fromIdentity,appName==='snapchat'&&type!=='text'?`${fromIdentity.name} sent you a Snap`:text||`${type==='video'?'Video':'Photo'} message`,recipientThread.id,shared);
  sender.timeline.updatedAt=Date.now();recipient.timeline.updatedAt=Date.now();sender.root.phones[sender.key]=sender.timeline;sender.root.phones[recipient.key]=recipient.timeline;saveMetadataRoot(sender.root);
  const appLabel=APPS[appName]?.label||appName,summary=type==='text'?`${fromIdentity.name} sent ${toIdentity.name} a private ${appLabel} message: ${text}`:`${fromIdentity.name} sent ${toIdentity.name} a private ${appLabel} ${type}: ${mediaDescription}${text?` | Caption: ${text}`:''}`;recordContinuityEvent({kind:type==='text'?'social':'media',participants:[fromIdentity.name,toIdentity.name],sender:fromIdentity.name,summary,threadTitle:`${appLabel} with ${toIdentity.name}`,mirrorId:shared,roleplayMs:timeMs});return{delivered:true,message,thread:recipientThread};
}
function appThread(appName,threadKey,t=timeline()){return appStore(t,appName)?.threads?.[threadKey]||null}
function appPeer(thread){return thread?.identityId?identityById(thread.identityId):identityForName(thread?.peerName,{create:false})}
function appRelationship(t,identity,appName,create=true){const reln=create?ensureRelationship(t,identity):t?.relationships?.[identity?.id||identity];return reln?.apps?.[appName]||null}
function openAppConversation(appName,identityId){
  const identity=identityById(identityId);if(!identity)return;const t=timeline(),th=ensureAppThreadIn(t,appName,identity);persist(t,false);app=appName;appView='thread';itemId=th.id;render();
}
function socialActionBlocked(t,identity,appName){const state=appRelationship(t,identity,appName);return !!(state?.blocked||state?.blockedBy)}
function appConversationLabel(appName,video=false){if(appName==='instagram')return'an Instagram DM';if(appName==='snapchat')return'a Snapchat chat';if(appName==='facebook')return'Facebook Messenger';if(appName==='onlyfans')return video?'a private OnlyFans video call':'an OnlyFans private message';if(appName==='darkweb')return'a fictional Dark Web private message';return'an app conversation'}
async function generateAppReply(appName,threadKey){
  if(appReplyBusy)return;let t=timeline(),th=appThread(appName,threadKey,t),peer=appPeer(th);if(!th||!peer||socialActionBlocked(t,peer,appName))return;
  const owner=persona(),ownerIdentity=currentIdentity(),last=th.messages.at(-1);if(!last||lc(last.sender)!==lc(owner.name))return;
  appReplyBusy=true;islandText=`${peer.name}…`;islandIcon=APPS[appName]?.icon||'fa-solid fa-ellipsis';render();
  try{
    const found=findCharacter(peer.name),w=world(),life=w.people.find(p=>lc(p.name)===lc(peer.name))||null,reln=t.relationships?.[peer.id]||null,listing=appName==='facebook'?sharedMarketplace().listings.find(x=>x.sellerIdentityId===peer.id)||null:null,darkListing=appName==='darkweb'?sharedDarkWeb().listings.find(x=>x.providerIdentityId===peer.id)||null:null,creatorAccount=appName==='onlyfans'?onlyFansAccount(peer,false):null,videoMode=appName==='onlyfans'&&th.videoActive;
    const systemPrompt=`IDENTITY LOCK: You are ${peer.name}. ${owner.name} is the other person. Never swap identities or invent/expand a surname.
You are replying in ${appConversationLabel(appName,videoMode)} inside an ongoing fictional roleplay.
Sound like ${peer.name}: preserve the character card, personality, relationship, mood, and established chat voice. Natural slang, emojis, teasing, profanity, abbreviations, short messages and silence are allowed when they fit. Do not default to robotic, formal, customer-service or therapy language.
The identity phoneNumber is authoritative. ${peer.name} knows their own number and must use that exact value if directly asked, never invent another.
Use Greyhaven Life as current context. Do not invent a location or claim to be with ${owner.name} without evidence.
You may refuse, tease, leave the message unanswered, or block when that is genuinely in character. Do not force compliance.
Return up to 3 protocol items using only TEXT:, PHOTO:, VIDEO:, or ACTION: IGNORE. If media is sent, PHOTO/VIDEO must be a concrete description of what the other person sees.
${videoMode?'This is a live fictional video call. TEXT may combine one brief *visible action* with natural spoken dialogue. Keep it as one bounded turn.':''}
${appName==='onlyfans'?'Every creator and subscriber in this app is an adult. Keep the response consensual and consistent with the creator’s stated boundaries; subscription never forces compliance.':''}
${appName==='darkweb'?'Keep everything inside fictional Greyhaven. Do not provide real vendor details, real-world sourcing, manufacturing, evasion, or operational instructions. The character can negotiate, refuse, set boundaries, or arrange a fictional RP meeting.':''}
If ${peer.name} genuinely completes a separate phone action now, you may append the same hidden <!--GH_ACTION {...}--> marker used by roleplay. This includes message.send, media.send, call.place, contact block/unblock/add/exchange, instagram.follow/unfollow, snapchat.add/accept/decline, and facebook.friend.request/accept/decline. The from field must be ${peer.name}, targets must be exact existing names, and no action marker is allowed for a request, refusal, hesitation, or promise for later. Never generate the target's response.`;
    const prompt=`PERSON REPLYING:
${JSON.stringify({identity:{id:peer.id,name:peer.name,kind:peer.kind,phoneNumber:peer.phoneNumber||'',metadata:peer.metadata},character:found?cardData({name:peer.name,characterId:found.index}):{},life,sharedRelationship:reln,marketplaceListing:listing,darkWebListing:darkListing,onlyFansCreator:creatorAccount?{subscriptionPrice:creatorAccount.subscriptionPrice,subscribers:creatorAccount.subscribersBase,posts:creatorAccount.historicalPostCount}:null,videoMode})}

PHONE OWNER:
${JSON.stringify({name:owner.name,relationshipContext:owner.description.slice(0,7000)})}

GREYHAVEN LIFE:
${JSON.stringify({time:w.time,scene:w.scene,snapshot:w.snapshot})}

RECENT MAIN RP:
${recentChat()}

THIS APP THREAD (independent from iMessage and other apps):
${JSON.stringify(th.messages.slice(-24).map(messageContext))}

Choose ${peer.name}'s one bounded response now. ACTION: IGNORE is valid.`;
    const packet=parseDirectPacket(await generate({prompt,systemPrompt,responseLength:680}));
    for(const row of packet.items.slice(0,3))mirrorAppMessage({appName,fromName:peer.name,toName:owner.name,fromIdentityId:peer.id,toIdentityId:ownerIdentity.id,type:row.type,text:row.text||'',mediaDescription:row.mediaDescription||'',timeMs:now().getTime(),unread:false});
    if(packet.actions?.length)dispatchGeneratedPhoneActions(packet.actions,peer.name,`app:${appName}:${last.mirrorId||last.id}`);
  }catch(e){console.error(`[${GHP_MODULE}] ${appName} reply`,e);globalThis.toastr?.error?.(`${APPS[appName]?.label||'App'} reply failed: ${e?.message||e}`)}
  finally{appReplyBusy=false;islandText='';islandIcon='';render()}
}
function sendAppMessage(appName,threadKey,{type='text',text='',mediaDescription='',mediaKey='',mediaWidth=0,mediaHeight=0}={}){
  const t=timeline(),th=appThread(appName,threadKey,t),peer=appPeer(th),owner=currentIdentity();text=String(text||'').trim();mediaDescription=String(mediaDescription||'').trim();if(!th||!peer||!owner||socialActionBlocked(t,peer,appName))return false;if(type==='text'&&!text||type!=='text'&&!mediaDescription)return false;
  const result=mirrorAppMessage({appName,fromName:owner.name,toName:peer.name,fromIdentityId:owner.id,toIdentityId:peer.id,type,text,mediaDescription,mediaKey,mediaWidth,mediaHeight,timeMs:now().getTime(),unread:true});render();if(result?.delivered)setTimeout(()=>generateAppReply(appName,threadKey),180);return !!result?.delivered;
}
function publishAppItem(appName,kind,row){
  const root=metadataRoot(),owner=currentIdentity();if(!root||!owner)return;const shared=row.sharedEventId||`${appName}-${kind}:${id()}`,source={...row,sharedEventId:shared,identityId:owner.id,author:owner.name,ownerPost:true};
  if(kind==='post')normalizeSocialEngagement(source,owner.id);
  const own=timeline(),ownStore=appStore(own,appName),ownList=kind==='story'?ownStore.stories:ownStore.posts;if(!ownList.some(x=>x.sharedEventId===shared))ownList.unshift(source);
  for(const [key,raw] of Object.entries(root.phones||{})){
    const phone=normalizeTimeline(raw),phoneIdentity=identityById(phone.identityId)||identityForName(phone.ownerName,{create:false});if(phone===own||phone.identityId===owner.id||phoneIdentity&&!identityAppEnabled(phoneIdentity,appName))continue;const reln=phone.relationships?.[owner.id]?.apps?.[appName],visible=appName==='instagram'?reln?.following:appName==='snapchat'?reln?.friends:reln?.friends;if(!visible||reln?.blocked||reln?.blockedBy)continue;
    const list=kind==='story'?appStore(phone,appName).stories:appStore(phone,appName).posts;if(!list.some(x=>x.sharedEventId===shared))list.unshift({...clone(source),ownerPost:false});root.phones[key]=phone;
  }
  root.phones[persona().key]=own;saveMetadataRoot(root);render();
}
function socialItemKey(row={}){return String(row.sharedEventId||row.id||'')}
function copyOwnedSocialContent(sourceIdentity,sourceTimeline,targetTimeline,appName,kinds=['post','story']){
  if(!sourceIdentity?.id||!sourceTimeline||!targetTimeline)return false;let changed=false;
  for(const kind of kinds){const sourceList=kind==='story'?appStore(sourceTimeline,appName)?.stories:appStore(sourceTimeline,appName)?.posts,targetList=kind==='story'?appStore(targetTimeline,appName)?.stories:appStore(targetTimeline,appName)?.posts;if(!Array.isArray(sourceList)||!Array.isArray(targetList))continue;for(const row of sourceList.filter(x=>x.identityId===sourceIdentity.id||x.ownerPost)){const key=socialItemKey(row);if(!key||targetList.some(x=>socialItemKey(x)===key))continue;targetList.push({...clone(row),ownerPost:false});changed=true}targetList.sort((a,b)=>Number(b.timeMs||0)-Number(a.timeMs||0))}
  return changed;
}
function syncVisibleSocialContentForPair(owner,ownerTimeline,target,targetTimeline,root=metadataRoot()){
  if(!owner?.id||!target?.id||!ownerTimeline||!targetTimeline)return false;let changed=false;
  changed=copyOwnedSocialContent(owner,ownerTimeline,targetTimeline,'instagram',['post','story'])||changed;changed=copyOwnedSocialContent(target,targetTimeline,ownerTimeline,'instagram',['post','story'])||changed;
  changed=copyOwnedSocialContent(owner,ownerTimeline,targetTimeline,'snapchat',['story'])||changed;changed=copyOwnedSocialContent(target,targetTimeline,ownerTimeline,'snapchat',['story'])||changed;
  changed=copyOwnedSocialContent(owner,ownerTimeline,targetTimeline,'facebook',['post'])||changed;changed=copyOwnedSocialContent(target,targetTimeline,ownerTimeline,'facebook',['post'])||changed;
  return changed;
}
function findSharedSocialItem(root,appName,kind,itemId){
  for(const [key,raw] of Object.entries(root?.phones||{})){const phone=normalizeTimeline(raw),list=kind==='story'?appStore(phone,appName)?.stories:appStore(phone,appName)?.posts,row=list?.find(x=>x.id===itemId||x.sharedEventId===itemId);if(row)return{key,phone,row,list,sharedKey:socialItemKey(row)}}return null;
}
function updateSharedSocialEngagement(appName,kind,itemId,{actor=currentIdentity(),action='',text='',notify=true}={}){
  const root=metadataRoot();if(!root||!actor?.id)return false;const found=findSharedSocialItem(root,appName,kind,itemId);if(!found)return false;const canonical=normalizeSocialEngagement(clone(found.row),found.phone.identityId),author=identityById(canonical.identityId)||identityForName(canonical.author,{create:false}),stamp=now().getTime();let changed=false;
  if(action==='toggle-like'||action==='like'){
    const has=canonical.likedBy.includes(actor.id),want=action==='like'?true:!has;if(want&&!has){canonical.likedBy.push(actor.id);changed=true}else if(!want&&has){canonical.likedBy=canonical.likedBy.filter(x=>x!==actor.id);changed=true}
  }else if(action==='comment'){
    const body=String(text||'').trim();if(!body)return false;canonical.comments.push({id:id(),author:actor.name,identityId:actor.id,text:body,timeMs:stamp});changed=true;
  }else if(action==='view'){
    if(!canonical.viewers.includes(actor.id)){canonical.viewers.push(actor.id);changed=true}
  }
  if(!changed)return false;normalizeSocialEngagement(canonical,found.phone.identityId);
  for(const [key,raw] of Object.entries(root.phones||{})){const phone=normalizeTimeline(raw),list=kind==='story'?appStore(phone,appName)?.stories:appStore(phone,appName)?.posts;if(!Array.isArray(list))continue;for(const row of list){if(socialItemKey(row)!==found.sharedKey&&row.id!==found.row.id)continue;row.likedBy=clone(canonical.likedBy);row.likeBaseCount=canonical.likeBaseCount;row.likes=canonical.likes;row.comments=clone(canonical.comments);row.commentBaseCount=canonical.commentBaseCount;row.commentCount=canonical.commentCount;row.viewers=clone(canonical.viewers);row.likedByOwner=phone.identityId?row.likedBy.includes(phone.identityId):false}root.phones[key]=phone}
  if(notify&&author?.id&&author.id!==actor.id){const authorBox=phoneForIdentity(author,true),label=appName==='instagram'?'Instagram':'Facebook',notice=action==='comment'?`${actor.name} commented: ${String(text||'').trim()}`:action==='view'?`${actor.name} viewed your story`:`${actor.name} liked your post`;if(authorBox&&identityAppEnabled(author,appName)){pushAppNotification(authorBox.timeline,appName,actor,notice,'',found.sharedKey);authorBox.root.phones[authorBox.key]=authorBox.timeline}}
  saveMetadataRoot(root);return true;
}
function resolveIdentityRef(value,create=true){if(value&&typeof value==='object'){const byId=identityById(String(value.id||''));if(byId)return byId;const byName=identityForName(value.name,{create});if(byName)return byName;return create&&value.id?ensureIdentity(value,true):null}return identityById(String(value||''))||identityForName(value,{create})}
function setInstagramFollowing(actorName,targetName,following=true,{notify=true}={}){
  const actor=resolveIdentityRef(actorName,true),target=resolveIdentityRef(targetName,true);if(!actor||!target||actor.id===target.id)return false;const a=phoneForIdentity(actor,true),b=phoneForIdentity(target,true);if(!a||!b)return false;
  const ar=ensureRelationship(a.timeline,target),br=ensureRelationship(b.timeline,actor);ar.apps.instagram.following=!!following;ar.apps.instagram.requestedAt=following?now().getTime():0;br.apps.instagram.followedBy=!!following;if(following)copyOwnedSocialContent(target,b.timeline,a.timeline,'instagram',['post','story']);if(notify&&identityAppEnabled(target,'instagram'))pushAppNotification(b.timeline,'instagram',actor,following?`${actor.name} started following you`:`${actor.name} unfollowed you`);
  a.root.phones[a.key]=a.timeline;a.root.phones[b.key]=b.timeline;saveMetadataRoot(a.root);recordContinuityEvent({kind:'social',participants:[actor.name,target.name],sender:actor.name,summary:`${actor.name} ${following?'followed':'unfollowed'} ${target.name} on Instagram.`,threadTitle:'Instagram',mirrorId:`instagram-rel:${id()}`,roleplayMs:now().getTime()});return true;
}
function removeInstagramFollower(ownerRef,followerRef){
  const owner=resolveIdentityRef(ownerRef,true),follower=resolveIdentityRef(followerRef,true);if(!owner||!follower||owner.id===follower.id)return false;const a=phoneForIdentity(owner,true),b=phoneForIdentity(follower,true);if(!a||!b)return false;const ar=ensureRelationship(a.timeline,follower),br=ensureRelationship(b.timeline,owner);ar.apps.instagram.followedBy=false;br.apps.instagram.following=false;br.apps.instagram.requestedAt=0;a.root.phones[a.key]=a.timeline;a.root.phones[b.key]=b.timeline;saveMetadataRoot(a.root);recordContinuityEvent({kind:'social',participants:[owner.name,follower.name],sender:owner.name,summary:`${owner.name} removed ${follower.name} from their Instagram followers.`,threadTitle:'Instagram',mirrorId:`instagram-remove-follower:${id()}`,roleplayMs:now().getTime()});return true;
}
function setSnapchatFriendRequest(actorName,targetName,action='request',{notify=true}={}){
  const actor=resolveIdentityRef(actorName,true),target=resolveIdentityRef(targetName,true);if(!actor||!target||actor.id===target.id)return false;const a=phoneForIdentity(actor,true),b=phoneForIdentity(target,true);if(!a||!b)return false;const ar=ensureRelationship(a.timeline,target),br=ensureRelationship(b.timeline,actor);
  if(action==='accept'){ar.apps.snapchat.friends=true;br.apps.snapchat.friends=true;ar.apps.snapchat.incomingRequest=false;ar.apps.snapchat.outgoingRequest=false;br.apps.snapchat.incomingRequest=false;br.apps.snapchat.outgoingRequest=false;ar.apps.snapchat.requestedAt=0;br.apps.snapchat.requestedAt=0;copyOwnedSocialContent(actor,a.timeline,b.timeline,'snapchat',['story']);copyOwnedSocialContent(target,b.timeline,a.timeline,'snapchat',['story']);if(notify&&identityAppEnabled(target,'snapchat'))pushAppNotification(b.timeline,'snapchat',actor,`${actor.name} added you back`)}
  else if(action==='decline'){ar.apps.snapchat.incomingRequest=false;br.apps.snapchat.outgoingRequest=false;ar.apps.snapchat.requestedAt=0;br.apps.snapchat.requestedAt=0}
  else if(action==='remove'||action==='unfriend'){for(const state of [ar.apps.snapchat,br.apps.snapchat]){state.friends=false;state.incomingRequest=false;state.outgoingRequest=false;state.requestedAt=0}}
  else{const requestedAt=now().getTime();ar.apps.snapchat.outgoingRequest=true;br.apps.snapchat.incomingRequest=true;ar.apps.snapchat.requestedAt=requestedAt;br.apps.snapchat.requestedAt=requestedAt;if(notify&&identityAppEnabled(target,'snapchat'))pushAppNotification(b.timeline,'snapchat',actor,`${actor.name} added you`)}
  a.root.phones[a.key]=a.timeline;a.root.phones[b.key]=b.timeline;saveMetadataRoot(a.root);const summary=action==='accept'?`${actor.name} added ${target.name} back on Snapchat.`:action==='decline'?`${actor.name} ignored ${target.name}'s Snapchat request.`:action==='remove'||action==='unfriend'?`${actor.name} removed ${target.name} as a Snapchat friend.`:`${actor.name} added ${target.name} on Snapchat.`;recordContinuityEvent({kind:'social',participants:[actor.name,target.name],sender:actor.name,summary,threadTitle:'Snapchat',mirrorId:`snapchat-rel:${id()}`,roleplayMs:now().getTime()});return true;
}
function setFacebookFriendRequest(actorName,targetName,action='request',{notify=true}={}){
  const actor=resolveIdentityRef(actorName,true),target=resolveIdentityRef(targetName,true);if(!actor||!target||actor.id===target.id)return false;const a=phoneForIdentity(actor,true),b=phoneForIdentity(target,true),ar=ensureRelationship(a.timeline,target),br=ensureRelationship(b.timeline,actor);
  if(action==='accept'){ar.apps.facebook.friends=true;br.apps.facebook.friends=true;ar.apps.facebook.incomingRequest=false;ar.apps.facebook.outgoingRequest=false;br.apps.facebook.incomingRequest=false;br.apps.facebook.outgoingRequest=false;ar.apps.facebook.requestedAt=0;br.apps.facebook.requestedAt=0;copyOwnedSocialContent(actor,a.timeline,b.timeline,'facebook',['post']);copyOwnedSocialContent(target,b.timeline,a.timeline,'facebook',['post']);if(notify&&identityAppEnabled(target,'facebook'))pushAppNotification(b.timeline,'facebook',actor,`${actor.name} accepted your friend request`)}
  else if(action==='decline'){ar.apps.facebook.incomingRequest=false;br.apps.facebook.outgoingRequest=false;ar.apps.facebook.requestedAt=0;br.apps.facebook.requestedAt=0}
  else{const requestedAt=now().getTime();ar.apps.facebook.outgoingRequest=true;br.apps.facebook.incomingRequest=true;ar.apps.facebook.requestedAt=requestedAt;br.apps.facebook.requestedAt=requestedAt;if(notify&&identityAppEnabled(target,'facebook'))pushAppNotification(b.timeline,'facebook',actor,`${actor.name} sent you a friend request`)}
  a.root.phones[a.key]=a.timeline;a.root.phones[b.key]=b.timeline;saveMetadataRoot(a.root);recordContinuityEvent({kind:'social',participants:[actor.name,target.name],sender:actor.name,summary:action==='accept'?`${actor.name} accepted ${target.name}'s Facebook friend request.`:action==='decline'?`${actor.name} declined ${target.name}'s Facebook friend request.`:`${actor.name} sent ${target.name} a Facebook friend request.`,threadTitle:'Facebook',mirrorId:`facebook-rel:${id()}`,roleplayMs:now().getTime()});return true;
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

function syncCrossPhoneBlock(blockerName,blockerAvatar='',blockedName='',blockedAvatar='',blockedDescription='',blocked=true){
  blockerName=norm(blockerName);blockedName=norm(blockedName);if(!blockerName||!blockedName||lc(blockerName)===lc(blockedName))return;
  const a=phoneForOwner(blockerName,blockerAvatar,true),b=phoneForOwner(blockedName,blockedAvatar,true);if(!a||!b)return;
  const blockedContact=ensurePeerContact(a.timeline,blockedName,blockedAvatar,blockedDescription),blockerContact=ensurePeerContact(b.timeline,blockerName,blockerAvatar,'');
  if(blockedContact){blockedContact.blocked=!!blocked;blockedContact.ignoringOwner=false}
  if(blockerContact){blockerContact.blockedByContact=!!blocked;blockerContact.ignoringOwner=false}
  const blockedIdentity=identityForName(blockedName,{create:true}),blockerIdentity=identityForName(blockerName,{create:true}),ar=ensureRelationship(a.timeline,blockedIdentity),br=ensureRelationship(b.timeline,blockerIdentity);if(ar)ar.apps.messages.blocked=!!blocked;if(br)br.apps.messages.blockedBy=!!blocked;
  a.timeline.updatedAt=Date.now();b.timeline.updatedAt=Date.now();a.root.phones[a.key]=a.timeline;a.root.phones[b.key]=b.timeline;saveMetadataRoot(a.root);
}

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
      if(meta?.width&&meta?.height){wrap?.style.setProperty('--ghp-media-ar',`${meta.width}/${meta.height}`);if(el.classList.contains('ghp-social-media')){el.style.aspectRatio=`${meta.width}/${meta.height}`;el.setAttribute('width',String(meta.width));el.setAttribute('height',String(meta.height))}}
    }
  }
}

function world(){
  const L=globalThis.GreyhavenLife;if(!L)return{available:false,time:now().toISOString(),scene:null,people:[],snapshot:null,status:null,prompt:''};
  try{return{available:true,version:L.version,time:L.getTimeISO?.()||new Date(L.getTime?.()||Date.now()).toISOString(),scene:L.getScene?.()||null,
    people:(L.getPeople?.()||[]).map(p=>({name:p.name,present:!!p.present,location:p.resolved?.location||p.base?.location||'',area:p.resolved?.area||p.base?.area||'',status:p.resolved?.status||p.base?.status||'',availability:p.resolved?.availability||p.base?.availability||'',exceptions:p.exceptions||[]})),
    snapshot:L.getWorldSnapshot?.()||null,status:L.getWorldSnapshotStatus?.()||null,prompt:L.getPromptSummary?.()||''}}catch(e){console.warn(`[${GHP_MODULE}] life`,e);return{available:false,time:now().toISOString(),scene:null,people:[],snapshot:null,status:null,prompt:''}}
}
function scopedWorld(w,names=[]){const wanted=new Set(names.map(lc)),people=(w.people||[]).filter(p=>wanted.has(lc(p.name))||p.present).slice(0,16);return{time:w.time,scene:w.scene,people,snapshot:w.snapshot,snapshotStatus:w.status}}
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
function recentPhone(enabledApps=profile().apps){
  const t=timeline(),a=[],addThreads=(store,label)=>{for(const th of Object.values(store?.threads||{}))for(const m of(th.messages||[]).slice(-4))a.push({ms:m.timeMs,text:`${label} · ${th.peerName} | ${messageContext(m).slice(0,180)}`})};
  if(enabledApps.messages)for(const th of Object.values(t.threads))for(const m of(th.messages||[]).slice(-4))a.push({ms:m.timeMs,text:`Messages · ${threadTitle(th,t)} | ${messageContext(m).slice(0,180)}`});
  if(enabledApps.phone)for(const x of t.calls.slice(-6))a.push({ms:x.timeMs,text:`Call ${x.contactName}: ${x.status}`});
  if(enabledApps.instagram){for(const x of t.instagram.posts.slice(-6))a.push({ms:x.timeMs,text:`Instagram post ${x.author}: ${x.caption}`});for(const x of t.instagram.stories.slice(-6))a.push({ms:x.timeMs,text:`Instagram story ${x.author}: ${x.caption}`});addThreads(t.instagram,'Instagram DM')}
  if(enabledApps.snapchat){for(const x of t.snapchat.stories.slice(-6))a.push({ms:x.timeMs,text:`Snapchat story ${x.author}: ${x.caption}`});addThreads(t.snapchat,'Snapchat')}
  if(enabledApps.facebook){for(const x of t.facebook.posts.slice(-6))a.push({ms:x.timeMs,text:`Facebook post ${x.author}: ${x.text||x.caption}`});addThreads(t.facebook,'Facebook Messenger')}
  if(enabledApps.onlyfans){for(const {identity,account} of onlyFansCreators())for(const x of account.posts.slice(0,3))a.push({ms:x.timeMs,text:`OnlyFans post ${identity.name}: ${x.caption||x.visual}`});addThreads(t.onlyfans,'OnlyFans')}
  if(enabledApps.mail)for(const x of t.mail.slice(-6))a.push({ms:x.timeMs,text:`Mail ${x.from}: ${x.subject}`});
  return a.sort((a,b)=>a.ms-b.ms).slice(-36).map(x=>x.text);
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
function emptyRefreshResult(){return{summary:'',events:[]}}
function normalizeRefreshResult(raw){
  let value=raw;if(typeof raw==='string'){try{value=parseJSON(raw)}catch{value=null}}const out=emptyRefreshResult();if(!value||typeof value!=='object')return out;out.summary=String(value.summary||'');out.events=Array.isArray(value.events)?value.events.filter(x=>x&&typeof x==='object'):[];
  // Backward compatibility with v1 refresh JSON if an older preset/model still returns it.
  for(const x of Array.isArray(value.messages)?value.messages:[])out.events.push({type:'message.receive',from:x.sender,threadId:x.threadId,text:x.text,mediaType:x.mediaType,mediaDescription:x.mediaDescription});
  for(const x of Array.isArray(value.calls)?value.calls:[])out.events.push({type:'phone.call',from:x.contact,status:x.status});
  for(const x of Array.isArray(value.posts)?value.posts:[])out.events.push({type:'instagram.post',from:x.author,...x});
  for(const x of Array.isArray(value.stories)?value.stories:[])out.events.push({type:'instagram.story',from:x.author,...x});
  for(const x of Array.isArray(value.mail)?value.mail:[])out.events.push({type:'mail.receive',...x});return out;
}
function refreshEventCount(r){return Array.isArray(r?.events)?r.events.length:0}
async function generate({prompt,systemPrompt,responseLength=1200}){const c=ctx();if(typeof c?.generateRaw!=='function')throw new Error('SillyTavern generateRaw is unavailable.');return c.generateRaw({prompt,systemPrompt,responseLength,trimNames:false})}
function refreshIdentityCandidates(t,w,apps=profile().apps){
  const map=new Map(),owner=currentIdentity(),add=identity=>{if(!identity?.id||identity.id===owner?.id)return;map.set(identity.id,identity)},activeState=(state,keys)=>keys.some(key=>state?.[key]===true)||(Number(state?.requestedAt||0)>0);
  if(apps.messages||apps.phone)for(const co of Object.values(t.contacts||{})){const identity=co.identityId?identityById(co.identityId):identityForName(co.name,{create:false});if(identity)add(identity)}
  for(const [key,reln] of Object.entries(t.relationships||{})){const relevant=(apps.instagram&&activeState(reln.apps?.instagram,['following','followedBy','blocked','blockedBy']))||(apps.snapchat&&activeState(reln.apps?.snapchat,['friends','outgoingRequest','incomingRequest','blocked','blockedBy']))||(apps.facebook&&activeState(reln.apps?.facebook,['friends','outgoingRequest','incomingRequest','blocked','blockedBy']))||((apps.messages||apps.phone)&&reln.latestInteraction?.app==='messages');if(!relevant)continue;const identity=identityById(key);if(identity)add(identity)}
  for(const d of [...chatDescriptors(),...lifeDescriptors()]){const identity=identityForName(d.name,{create:true});if(identity)add(identity)}
  if(apps.onlyfans){for(const {identity} of onlyFansCreators())add(identity);for(const th of Object.values(t.onlyfans?.threads||{})){const identity=appPeer(th);if(identity)add(identity)}}
  return [...map.values()].slice(0,24).map(identity=>{const found=findCharacter(identity.name),life=w.people.find(p=>lc(p.name)===lc(identity.name))||null,reln=t.relationships?.[identity.id]||null;return{identityId:identity.id,name:identity.name,kind:identity.kind,socialProfile:socialProfileFor(identity),character:compactCard({name:identity.name,characterId:found?.index??null}),sharedRelationship:reln?{familiarity:reln.familiarity,relationshipType:reln.relationshipType,impression:reln.impression,friendliness:reln.friendliness,tension:reln.tension,interest:reln.interest,latestInteraction:reln.latestInteraction,knownContactInfo:reln.knownContactInfo,apps:reln.apps}:null,locationEvidence:life?{location:life.location,area:life.area,present:life.present,status:life.status,availability:life.availability}:null,recentMentions:recentMentions(identity.name)}});
}
function compactAppThreads(store){return(store?.threadOrder||[]).map(key=>store.threads?.[key]).filter(Boolean).slice(0,18).map(th=>({threadId:th.id,peer:th.peerName,recent:(th.messages||[]).slice(-8).map(messageContext)}))}
function buildInstalledAppContext(t,p,candidates){
  const out={};
  if(p.apps.messages)out.messages={contacts:Object.values(t.contacts).filter(c=>!c.blocked).map(c=>refreshContactContext(c,world())),threads:t.threadOrder.map(k=>t.threads[k]).filter(Boolean).map(th=>threadRefreshContext(th,t))};
  if(p.apps.phone)out.phone={recentCalls:t.calls.slice(0,16).map(x=>({contact:x.contactName,status:x.status,timeMs:x.timeMs}))};
  if(p.apps.instagram)out.instagram={relationships:candidates.map(x=>({identityId:x.identityId,name:x.name,state:t.relationships?.[x.identityId]?.apps?.instagram||null})).filter(x=>x.state),posts:t.instagram.posts.slice(0,16),stories:t.instagram.stories.slice(0,12),dms:compactAppThreads(t.instagram)};
  if(p.apps.snapchat)out.snapchat={relationships:candidates.map(x=>({identityId:x.identityId,name:x.name,state:t.relationships?.[x.identityId]?.apps?.snapchat||null})).filter(x=>x.state),stories:t.snapchat.stories.slice(0,12),chats:compactAppThreads(t.snapchat)};
  if(p.apps.facebook)out.facebook={relationships:candidates.map(x=>({identityId:x.identityId,name:x.name,state:t.relationships?.[x.identityId]?.apps?.facebook||null})).filter(x=>x.state),posts:t.facebook.posts.slice(0,14),messenger:compactAppThreads(t.facebook)};
  if(p.apps.onlyfans)out.onlyfans={creators:onlyFansCreators().map(({identity,account})=>({identityId:identity.id,name:identity.name,subscriptionPrice:account.subscriptionPrice,stats:onlyFansAccountStats(identity,account),recentPosts:account.posts.slice(0,6)})),subscriptions:Object.values(sharedOnlyFans().subscriptions).filter(x=>x.active&&(x.viewerIdentityId===currentIdentity()?.id||x.creatorIdentityId===currentIdentity()?.id)),messages:compactAppThreads(t.onlyfans)};
  if(p.apps.mail)out.mail={recent:t.mail.slice(0,12)};
  return out;
}

async function refreshPhone(){
  if(refreshBusy)return;if(!hasChat()){globalThis.toastr?.warning?.('Open a chat first.');return}
  refreshBusy=true;islandText='Refreshing phone…';islandIcon='fa-solid fa-satellite-dish';render();
  try{
    seedContacts(true);
    const t=timeline(),p=profile(),owner=persona(),w=world(),refreshable=['messages','phone','instagram','snapchat','facebook','onlyfans','mail'],enabledApps=refreshable.filter(key=>p.apps[key]),enabledSocial=enabledApps.filter(key=>['instagram','snapchat','facebook'].includes(key)),rawCandidates=refreshIdentityCandidates(t,w,p.apps),candidates=rawCandidates.map(row=>{const copy=clone(row);if(copy.sharedRelationship?.apps)copy.sharedRelationship.apps=Object.fromEntries(Object.entries(copy.sharedRelationship.apps).filter(([key])=>enabledApps.includes(key)||key==='messages'&&enabledApps.includes('phone')));if(copy.sharedRelationship?.latestInteraction&&!enabledApps.includes(copy.sharedRelationship.latestInteraction.app)&&!(copy.sharedRelationship.latestInteraction.app==='messages'&&p.apps.phone))delete copy.sharedRelationship.latestInteraction;if(!p.apps.messages&&!p.apps.phone&&copy.sharedRelationship)delete copy.sharedRelationship.knownContactInfo;return copy}),appContext=buildInstalledAppContext(t,p,candidates),allowedLines=[],relationshipLabels=[...(p.apps.messages||p.apps.phone?['phone-number messaging']:[]),...enabledSocial.map(key=>APPS[key].label),...(p.apps.onlyfans?['OnlyFans subscriptions']:[])];
    if(p.apps.messages)allowedLines.push('- messages: message.receive');if(p.apps.phone)allowedLines.push('- phone: phone.call');if(p.apps.instagram)allowedLines.push('- instagram: instagram.follow, instagram.unfollow, instagram.post, instagram.story, instagram.dm, instagram.story.view, instagram.post.like, instagram.post.comment');if(p.apps.snapchat)allowedLines.push('- snapchat: snapchat.add, snapchat.accept, snapchat.decline, snapchat.snap, snapchat.story, snapchat.npc.request');if(p.apps.facebook)allowedLines.push('- facebook: facebook.friend.request, facebook.friend.accept, facebook.friend.decline, facebook.post, facebook.post.like, facebook.post.comment, facebook.messenger');if(p.apps.onlyfans)allowedLines.push('- onlyfans: onlyfans.post, onlyfans.dm, onlyfans.subscribe, onlyfans.npc.subscribe');if(p.apps.mail)allowedLines.push('- mail: mail.receive');
    if(!enabledApps.length){globalThis.toastr?.warning?.('No refresh-capable apps are installed.');return}if(!candidates.length&&!p.apps.mail&&!p.apps.snapchat&&!p.apps.onlyfans){globalThis.toastr?.warning?.('No relevant phone identities yet.');return}
    const minEvents=p.activityLevel==='busy'?Math.min(p.maxNewEvents,Math.max(3,Math.ceil(p.maxNewEvents*.6))):p.activityLevel==='normal'?Math.min(1,p.maxNewEvents):0;
    const systemPrompt=`You simulate ONE unified background refresh for a fictional Greyhaven Phone inside an ongoing roleplay.
Return ONLY one valid JSON object. No markdown and no commentary.
Use Greyhaven Life as authoritative current time/world state when available.
Use only ALLOWED IDENTITIES for named existing characters.${p.apps.snapchat?' snapchat.npc.request may introduce one provisional account using ONE first name only.':''}
IDENTITY LOCK: every generated sender is that named contact, never the PHONE OWNER and never another contact. Do not swap names, biographies, relationships, homes, jobs or possessions between people.
Never invent, expand, or guess surnames. Preserve every existing name exactly.${p.apps.snapchat?' A provisional Snapchat account must have one first name such as Daniel, Sara or Leo.':''}
Every message should sound like that contact's own private texting voice, using their character/personality and existing thread tail. Avoid generic formal customer-service/therapy language. Slang, lowercase, abbreviations, emojis, teasing, profanity, short double-texts and expressive punctuation are allowed when they fit that specific person; do not force the same style on everyone.
Never teleport contacts to the phone owner's location. The owner's current scene/location is NOT evidence that another contact is there.
A contact may mention/post a specific location only when that contact's own LOCATION EVIDENCE or RECENT MENTIONS clearly supports it. When there is no evidence, keep their post/message location-neutral.
Existing message threads matter. If a contact has a recent active conversation, new messages should usually continue it naturally, behave like a double-text, or follow the same topic. Do not abruptly reset to a generic unrelated invitation. If enough RP time has passed, a new topic is fine.
${relationshipLabels.length>1?`${relationshipLabels.join(', ')} relationships are separate. Never infer one merely from another.`:''}
${enabledSocial.length?'Pending follow/add/friend requests in the installed social apps are real context. Explicitly consider resolving at least one pending action when the relationship makes it natural. A trusted friend, partner or familiar person should not remain pending indefinitely without an in-character reason. Strangers, tension and selective/public accounts may still ignore or decline. Use familiarity, personality, impression, popularity, attraction/interest, tension, request age and recent interactions; do not impose hard morality rules.':''}
If you add a message to an existing app thread, use that exact threadId when possible.${enabledSocial.length?` ${enabledSocial.map(key=>key==='instagram'?'Instagram DMs':key==='snapchat'?'Snapchat Chats':'Facebook Messenger').join(', ')}${p.apps.messages?' and iMessage are':' are'} independent.`:''}
Do not repeat existing phone history.
Do not invent major plot developments, emergencies, betrayals, travel or secrets merely to create activity.
Harmless everyday activity is allowed even with little context.
A message${p.apps.snapchat?' or Snap':''} can contain fictional media. Set mediaType to "photo" or "video" and describe exactly what the recipient sees in mediaDescription.${p.apps.snapchat?' Notifications must correspond to a real stored event; never emit a fake standalone Snap notification without a snapchat.snap event. Snap Map locations require that person\'s own Greyhaven Life evidence.':''}
${p.apps.snapchat?'An established or popular account may occasionally receive snapchat.npc.request from a plausible first-name-only account. Use this sparingly, but do not make socially active phones permanently empty.':''}
${p.apps.onlyfans?'OnlyFans creators are explicitly assigned adults. A creator may post, receive a plausible subscription, or continue an existing private thread. Subscription never forces sexual compliance. onlyfans.npc.subscribe must use one first name only. Never assign a new creator during Refresh.':''}
NORMAL should normally create at least ${minEvents} event. BUSY must create at least ${minEvents} unless installed apps prevent it. QUIET may return zero.
Maximum total events: ${p.maxNewEvents}.
Required JSON shape:
{"summary":"short note","events":[{"type":"event.type","from":"Exact Name","to":"${owner.name}","text":"","mediaType":"","mediaDescription":""}]}
Allowed event types are limited by installed apps:
${allowedLines.join('\n')}
${p.apps.snapchat?'For snapchat.npc.request include firstName and a short accountBio. Never include a surname.':''}
Return an empty events array when nobody would naturally do anything.`;
    const prompt=`ROLEPLAY TIME:
${w.time}

PHONE OWNER:
${owner.name}

PHONE OWNER GLOBAL SOCIAL PROFILE:
${JSON.stringify(socialProfileFor(currentIdentity()))}

ACTIVITY LEVEL:
${p.activityLevel}

MINIMUM DESIRED EVENTS:
${minEvents}

MAXIMUM TOTAL EVENTS:
${p.maxNewEvents}

INSTALLED APPS — these are the ONLY apps that exist for this refresh:
${JSON.stringify(enabledApps)}

ALLOWED IDENTITIES WITH CHARACTER, RELATIONSHIP AND OWN LOCATION EVIDENCE:
${JSON.stringify(candidates)}

INSTALLED-APP STATE ONLY:
${JSON.stringify(appContext)}

GREYHAVEN LIFE WORLD:
${JSON.stringify({scene:w.scene,people:w.people,snapshot:w.snapshot,snapshotStatus:w.status})}

RECENT MAIN RP:
${recentChat()||'(none)'}

RECENT PHONE HISTORY TO AVOID REPEATING:
${JSON.stringify(recentPhone(p.apps))}

Generate plausible NEW activity now. Respect each person's own location evidence.`;
    const raw=await generate({prompt,systemPrompt,responseLength:p.responseTokens}),result=normalizeRefreshResult(raw),after=applyRefresh(result);
    globalThis.toastr?.success?.(after?`Phone refreshed · ${after} new event${after===1?'':'s'}`:'Phone refreshed · nothing new this time');
  }catch(e){
    console.error(`[${GHP_MODULE}] refresh`,e);
    globalThis.toastr?.error?.(`Phone refresh failed: ${e?.message||e}`)
  }finally{refreshBusy=false;islandText='';islandIcon='';render()}
}

function normalizeMarketplaceRefreshResult(raw){
  let value=raw;if(typeof raw==='string'){try{value=parseJSON(raw)}catch{value=null}}if(!value||typeof value!=='object')return{summary:'',listings:[],buyerMessages:[]};return{summary:String(value.summary||''),listings:Array.isArray(value.listings)?value.listings.filter(x=>x&&typeof x==='object').slice(0,8):[],buyerMessages:Array.isArray(value.buyerMessages)?value.buyerMessages.filter(x=>x&&typeof x==='object').slice(0,3):[]};
}
function marketplaceCandidateContext(){
  const w=world(),priority=refreshIdentityCandidates(timeline(),w,profile().apps),seen=new Set(priority.map(x=>x.identityId)),extra=[];
  for(const identity of identityDirectory()){if(seen.has(identity.id))continue;const found=findCharacter(identity.name);extra.push({identityId:identity.id,name:identity.name,kind:identity.kind,character:compactCard({name:identity.name,characterId:found?.index??null}),locationEvidence:w.people.find(p=>lc(p.name)===lc(identity.name))||null});if(extra.length>=12)break}
  return[...priority.slice(0,16),...extra];
}
function marketplaceListingSignature(row={}){return hashString(JSON.stringify([lc(row.sellerName||row.seller),lc(row.title),lc(row.price),lc(row.area)]))}
function normalizeMarketplacePrice(value){
  const source=String(value??'').trim();if(!source)return'';if(/^free$/iu.test(source))return'€0';
  const first=source.split(/\s*(?:-|–|—|\bto\b)\s*/iu)[0],match=first.match(/\d[\d\s.,]*/u);if(!match)return'';let token=match[0].replace(/\s/g,'').replace(/[.,]+$/u,'');
  const separators=[...token.matchAll(/[.,]/gu)];if(separators.length){const last=separators.at(-1).index,digitsAfter=token.length-last-1;if(digitsAfter===3||separators.length>1)token=token.replace(/[.,]/g,'');else token=token.replace(',','.')}
  const amount=Math.max(0,Math.round(Number(token)));return Number.isFinite(amount)?`€${amount}`:'';
}
function normalizeMarketplaceListing(row={}){
  row=row&&typeof row==='object'?row:{};row.id=String(row.id||id());row.sellerIdentityId=String(row.sellerIdentityId||'');row.sellerName=norm(row.sellerName||row.seller||'Seller');row.sellerType=row.sellerType==='provisional'?'provisional':'existing';row.title=String(row.title||'').trim();row.description=String(row.description||'').trim();row.price=normalizeMarketplacePrice(row.price)||'€0';row.area=String(row.area||'').trim();row.visual=String(row.visual||row.mediaDescription||'').trim();row.type=row.type==='video'?'video':'photo';row.mediaKey=String(row.mediaKey||'');row.mediaWidth=Math.max(0,Number(row.mediaWidth||0));row.mediaHeight=Math.max(0,Number(row.mediaHeight||0));row.timeMs=Math.max(0,Number(row.timeMs||Date.now()));row.status=['available','sold','removed'].includes(row.status)?row.status:'available';row.linkedManually=row.linkedManually===true;row.ownerListing=row.ownerListing===true;row.inquiries=Array.isArray(row.inquiries)?row.inquiries.filter(Boolean):[];row.signature=marketplaceListingSignature(row);return row;
}
function defaultSharedMarketplace(){return{version:1,legacyMigrated:false,listings:[],archived:[],refresh:{lastAt:null,eventKeys:[],summary:''}}}
function trimMarketplaceListings(market){market.listings=market.listings.filter(x=>x?.status==='available').sort((a,b)=>Number(b.timeMs||0)-Number(a.timeMs||0)).slice(0,MAX_MARKETPLACE_LISTINGS);return market}
function sharedMarketplace(){
  const root=metadataRoot();if(!root)return defaultSharedMarketplace();const before=JSON.stringify(root.marketplace||null),market=root.marketplace&&typeof root.marketplace==='object'?root.marketplace:defaultSharedMarketplace();market.version=Math.max(1,Number(market.version||1));market.listings=Array.isArray(market.listings)?market.listings:[];market.archived=Array.isArray(market.archived)?market.archived:[];market.refresh=market.refresh&&typeof market.refresh==='object'?market.refresh:{lastAt:null,eventKeys:[],summary:''};market.refresh.eventKeys=Array.isArray(market.refresh.eventKeys)?market.refresh.eventKeys.slice(-180):[];
  if(market.legacyMigrated!==true){
    const seenIds=new Set(market.listings.map(x=>String(x?.id||'')).filter(Boolean)),seenSignatures=new Set(market.listings.map(marketplaceListingSignature));
    for(const raw of Object.values(root.phones||{})){
      const legacy=raw?.facebook?.marketplace;if(!legacy||typeof legacy!=='object')continue;
      for(const source of Array.isArray(legacy.listings)?legacy.listings:[]){const row=normalizeMarketplaceListing(clone(source));if(seenIds.has(row.id)||seenSignatures.has(row.signature))continue;seenIds.add(row.id);seenSignatures.add(row.signature);market.listings.push(row)}
      const refresh=legacy.refresh;if(refresh&&typeof refresh==='object'){market.refresh.lastAt=Math.max(Number(market.refresh.lastAt||0),Number(refresh.lastAt||0))||null;if(!market.refresh.summary&&refresh.summary)market.refresh.summary=String(refresh.summary);market.refresh.eventKeys=[...new Set([...market.refresh.eventKeys,...(Array.isArray(refresh.eventKeys)?refresh.eventKeys:[])])].slice(-180)}
      legacy.listings=[];
    }
    market.legacyMigrated=true;
  }
  const ids=new Set(),signatures=new Set();market.listings=market.listings.map(x=>normalizeMarketplaceListing(x)).filter(row=>{if(ids.has(row.id)||signatures.has(row.signature))return false;ids.add(row.id);signatures.add(row.signature);return row.status==='available'});trimMarketplaceListings(market);market.archived=market.archived.map(x=>normalizeMarketplaceListing(x)).filter(x=>x.status!=='available').sort((a,b)=>Number(b.soldAt||b.removedAt||b.timeMs||0)-Number(a.soldAt||a.removedAt||a.timeMs||0)).slice(0,120);root.marketplace=market;if(before!==JSON.stringify(market))saveMetadataRoot(root);return market;
}
function saveSharedMarketplace(market){const root=metadataRoot();if(!root)return;trimMarketplaceListings(market);root.marketplace=market;saveMetadataRoot(root)}
function addMarketplaceListing(market,data,{ownerListing=false}={}){
  const owner=currentIdentity(),sellerType=ownerListing?'existing':data.sellerType==='existing'?'existing':'provisional';let seller=ownerListing?owner:null;
  if(!seller&&sellerType==='existing')seller=identityById(String(data.sellerIdentityId||''))||identityForName(data.seller,{create:false});
  if(!seller)seller=createProvisionalIdentity(data.seller||data.firstName||'Seller',{source:'marketplace',listingContext:String(data.title||'').trim()});
  const title=String(data.title||'').trim(),description=String(data.description||'').trim(),price=normalizeMarketplacePrice(data.price),area=String(data.area||'').trim(),visual=String(data.visual||data.mediaDescription||'').trim();if(!seller||!title||!price)return null;
  const row=normalizeMarketplaceListing({id:id(),sellerIdentityId:seller.id,sellerName:seller.name,sellerType:seller.kind==='provisional'?'provisional':'existing',title,description,price,area,visual,type:data.type==='video'?'video':'photo',mediaKey:String(data.mediaKey||''),mediaWidth:Math.max(0,Number(data.mediaWidth||0)),mediaHeight:Math.max(0,Number(data.mediaHeight||0)),timeMs:now().getTime(),status:'available',linkedManually:false,ownerListing:ownerListing||seller.id===owner?.id,inquiries:[]});if(market.listings.some(x=>x.id===row.id||x.signature===row.signature||marketplaceListingSignature(x)===row.signature))return null;return row;
}
function applyMarketplaceRefresh(result){
  const market=sharedMarketplace(),keys=new Set(market.refresh.eventKeys||[]),newRows=[];let count=0;
  for(const data of result.listings){const row=addMarketplaceListing(market,data);if(!row||keys.has(`listing:${row.signature}`))continue;keys.add(`listing:${row.signature}`);newRows.push(row);count++}
  if(newRows.length)market.listings.unshift(...newRows);trimMarketplaceListings(market);
  const candidates=marketplaceCandidateContext(),byId=new Map(candidates.map(x=>[x.identityId,identityById(x.identityId)])),byName=new Map(candidates.map(x=>[lc(x.name),identityById(x.identityId)]));
  for(const data of result.buyerMessages){const listing=market.listings.find(x=>x.ownerListing&&x.status==='available'&&(x.id===data.listingId||!data.listingId&&lc(x.title)===lc(data.listingTitle)))||market.listings.find(x=>x.ownerListing&&x.status==='available'),seller=listing?identityById(listing.sellerIdentityId):null;if(!listing||!seller)continue;const buyerType=data.buyerType==='existing'?'existing':'provisional',buyer=buyerType==='existing'?(byId.get(String(data.buyerIdentityId||''))||byName.get(lc(data.buyer))):createProvisionalIdentity(data.buyer||data.firstName||'Buyer',{source:'marketplace-buyer',interestedListingId:listing.id});const body=String(data.text||'').trim();if(!buyer||buyer.id===seller.id||!body)continue;const key=`buyer:${listing.id}:${buyer.id}:${hashString(body)}`;if(keys.has(key))continue;const delivered=mirrorAppMessage({appName:'facebook',fromName:buyer.name,toName:seller.name,fromIdentityId:buyer.id,toIdentityId:seller.id,type:'text',text:body,timeMs:now().getTime(),unread:true});if(!delivered?.delivered)continue;keys.add(key);listing.inquiries.push({identityId:buyer.id,name:buyer.name,timeMs:now().getTime(),message:body});count++}
  market.refresh.lastAt=Date.now();market.refresh.eventKeys=[...keys].slice(-180);market.refresh.summary=String(result.summary||'').trim();saveSharedMarketplace(market);return count;
}
async function refreshMarketplace(){
  if(marketplaceRefreshBusy||refreshBusy)return;if(!hasChat()){globalThis.toastr?.warning?.('Open a chat first.');return}if(!profile().apps.facebook){globalThis.toastr?.warning?.('Facebook is not installed on this phone.');return}
  marketplaceRefreshBusy=true;islandText='Refreshing Marketplace…';islandIcon='fa-solid fa-store';render();
  try{
    const owner=currentIdentity(),w=world(),candidates=marketplaceCandidateContext(),market=sharedMarketplace(),existing=market.listings.slice(0,MAX_MARKETPLACE_LISTINGS).map(x=>({id:x.id,seller:x.sellerName,title:x.title,price:x.price,area:x.area,status:x.status,ownerListing:x.ownerListing})),ownerListings=market.listings.filter(x=>x.ownerListing&&x.status==='available').map(x=>({id:x.id,sellerIdentityId:x.sellerIdentityId,seller:x.sellerName,title:x.title,description:x.description,price:x.price,area:x.area}));
    const systemPrompt=`You generate ONE dedicated Facebook Marketplace refresh for a fictional Greyhaven roleplay phone. Return ONLY valid JSON, with no markdown.
This request is Marketplace-only. Do not generate Facebook feed posts, friend requests, Messenger chatter unrelated to a listing, Instagram, Snapchat, iMessage, calls or mail.
Create 5 to 8 NEW plausible listings that do not duplicate EXISTING LISTINGS. Old listings remain until the shared Marketplace reaches ${MAX_MARKETPLACE_LISTINGS} active listings; only then are the oldest pruned.
Sellers may be exact ALLOWED EXISTING IDENTITIES or provisional NPCs. Every provisional NPC must use ONE first name only. Never invent, expand or guess a surname.
Choose items that make sense for the seller's age, work, lifestyle and location. Avoid absurd industrial equipment or constant joke listings unless the character context genuinely supports it.
Every listing must use one fixed whole-euro asking price such as "€10", "€30" or "€320". Never output a range, minimum/maximum, "€10-€30", negotiable text, or multiple prices. Areas should fit Greyhaven without claiming unsupported precise live locations.
If PERSONA-OWNED LISTINGS exist, you may also create 0 to 2 buyerMessages from a plausible interested existing identity or first-name-only provisional buyer. These listings can belong to any persona, not only the phone that initiated this refresh. A buyer may ask a question, negotiate, make an offer, arrange pickup or say they want to buy. Do not invent a completed sale.
Required JSON:
{"summary":"short note","listings":[{"sellerType":"existing|provisional","seller":"Exact Name or one first name","sellerIdentityId":"optional exact allowed id","title":"","description":"","price":"€0","area":"","visual":"what the listing photo shows"}],"buyerMessages":[{"buyerType":"existing|provisional","buyer":"Exact Name or one first name","buyerIdentityId":"optional","listingId":"exact owner listing id","text":"natural Marketplace message"}]}`;
    const prompt=`ROLEPLAY TIME:\n${w.time}\n\nREFRESH INITIATOR:\n${JSON.stringify({id:owner.id,name:owner.name,character:compactCard({name:owner.name}),socialProfile:socialProfileFor(owner)})}\n\nALLOWED EXISTING IDENTITIES:\n${JSON.stringify(candidates)}\n\nGREYHAVEN LIFE:\n${JSON.stringify({scene:w.scene,people:w.people.slice(0,24),snapshot:w.snapshot})}\n\nSHARED EXISTING LISTINGS — DO NOT REPLACE OR DUPLICATE:\n${JSON.stringify(existing)}\n\nPERSONA-OWNED LISTINGS THAT MAY ATTRACT BUYERS:\n${JSON.stringify(ownerListings)}\n\nGenerate the next append-only Marketplace batch now.`;
    const raw=await generate({prompt,systemPrompt,responseLength:Math.max(1700,profile().responseTokens)}),result=normalizeMarketplaceRefreshResult(raw),added=applyMarketplaceRefresh(result);globalThis.toastr?.success?.(added?`Marketplace refreshed · ${added} new event${added===1?'':'s'}`:'Marketplace refreshed · no new activity');
  }catch(e){console.error(`[${GHP_MODULE}] marketplace refresh`,e);globalThis.toastr?.error?.(`Marketplace refresh failed: ${e?.message||e}`)}finally{marketplaceRefreshBusy=false;islandText='';islandIcon='';render()}
}

function euro(value){const amount=Number(value||0);return new Intl.NumberFormat(undefined,{style:'currency',currency:'EUR',minimumFractionDigits:amount%1?2:0,maximumFractionDigits:2}).format(amount)}
function locationForIdentity(identity=currentIdentity()){
  let person=null;try{person=globalThis.GreyhavenLife?.getPerson?.(identity?.name)||null}catch{}const resolved=person?.resolved||person?.base||{},specific=[resolved.location,resolved.area].filter(Boolean).join(' · ');if(specific)return specific;const w=world(),ownerIsCurrent=identity?.id===currentIdentity()?.id,scene=ownerIsCurrent?w.scene:null;return[scene?.location,scene?.area].filter(Boolean).join(' · ')||'';
}
function currentChatIncludes(name){return lc(currentIdentity()?.name)===lc(name)||chatDescriptors().some(x=>lc(x.name)===lc(name))}
function normalizeDominosOrder(row={}){
  row=row&&typeof row==='object'?row:{};row.id=String(row.id||id());row.customerIdentityId=String(row.customerIdentityId||'');row.customerName=norm(row.customerName||'Customer');row.driverIdentityId=String(row.driverIdentityId||'');row.driverName=norm(row.driverName||'');row.items=Array.isArray(row.items)?row.items.filter(Boolean).map(x=>({menuId:String(x.menuId||''),name:String(x.name||''),price:Math.max(0,Number(x.price||0)),quantity:Math.max(1,Math.min(20,Number(x.quantity||1)))})):[];row.total=Math.max(0,Number(row.total||row.items.reduce((sum,x)=>sum+x.price*x.quantity,0)));row.location=String(row.location||'').trim();row.status=['placed','preparing','out_for_delivery','arrived','delivered','cancelled'].includes(row.status)?row.status:'placed';row.createdAt=Math.max(0,Number(row.createdAt||now().getTime()));row.readyAt=Math.max(row.createdAt,Number(row.readyAt||row.createdAt+20*60000));row.etaMs=Math.max(row.readyAt,Number(row.etaMs||row.createdAt+35*60000));row.updatedAt=Math.max(0,Number(row.updatedAt||Date.now()));row.arrivalCommitted=row.arrivalCommitted===true;row.completionCommitted=row.completionCommitted===true;return row;
}
function normalizeUberRide(row={}){
  row=row&&typeof row==='object'?row:{};row.id=String(row.id||id());row.riderIdentityId=String(row.riderIdentityId||'');row.riderName=norm(row.riderName||'Rider');row.driverIdentityId=String(row.driverIdentityId||'');row.driverName=norm(row.driverName||'Driver');row.pickup=String(row.pickup||'').trim();row.destination=String(row.destination||'').trim();row.status=['requested','en_route','arrived','in_progress','completed','cancelled'].includes(row.status)?row.status:'requested';row.createdAt=Math.max(0,Number(row.createdAt||now().getTime()));row.etaMs=Math.max(row.createdAt,Number(row.etaMs||row.createdAt+10*60000));row.updatedAt=Math.max(0,Number(row.updatedAt||Date.now()));row.arrivalCommitted=row.arrivalCommitted===true;row.completionCommitted=row.completionCommitted===true;return row;
}
function sharedServices(){
  const root=metadataRoot();if(!root)return{version:1,dominos:{orders:[]},uber:{rides:[]}};const state=root.services&&typeof root.services==='object'?root.services:{};state.version=Math.max(1,Number(state.version||1));state.dominos=state.dominos&&typeof state.dominos==='object'?state.dominos:{orders:[]};state.uber=state.uber&&typeof state.uber==='object'?state.uber:{rides:[]};state.dominos.orders=(Array.isArray(state.dominos.orders)?state.dominos.orders:[]).map(normalizeDominosOrder).sort((a,b)=>b.createdAt-a.createdAt).slice(0,80);state.uber.rides=(Array.isArray(state.uber.rides)?state.uber.rides:[]).map(normalizeUberRide).sort((a,b)=>b.createdAt-a.createdAt).slice(0,80);root.services=state;return state;
}
function saveSharedServices(state){const root=metadataRoot();if(!root)return;root.services=state;saveMetadataRoot(root)}
function serviceNotification(identityRef,appName,title,text,eventId=''){
  const identity=typeof identityRef==='string'?identityById(identityRef):identityRef;if(!identity||!identityAppEnabled(identity,appName))return;const box=phoneForIdentity(identity,true);if(!box)return;box.timeline.notifications.unshift({id:id(),app:appName,title:String(title||APPS[appName]?.label||'Update'),text:String(text||''),timeMs:now().getTime(),read:false,eventId});box.root.phones[box.key]=box.timeline;saveMetadataRoot(box.root);
}
function dispatchServiceText(fromIdentity,toIdentity,text,sourceKey){
  if(!fromIdentity||!toIdentity||!text)return false;const action={type:'message.send',from:fromIdentity.name,to:toIdentity.name,text,expectsReply:false};if(typeof globalThis.GreyhavenLife?.dispatchWorldAction==='function')return globalThis.GreyhavenLife.dispatchWorldAction(action,{source:'greyhaven-phone-service',sourceKey,roleplayMs:now().getTime()});window.dispatchEvent(new CustomEvent('greyhaven-world-action',{detail:{id:sourceKey,type:'message.send',actor:fromIdentity.name,from:fromIdentity.name,target:toIdentity.name,to:toIdentity.name,text,roleplayMs:now().getTime(),realMs:Date.now(),source:'greyhaven-phone-service',sourceKey,data:{...action,expectsReply:false}}}));return true;
}
function dominosCart(t=timeline()){return(t.dominos?.cart||[]).map(row=>{const menu=DOMINOS_MENU.find(x=>x.id===row.menuId);return menu?{...menu,quantity:row.quantity,lineTotal:menu.price*row.quantity}:null}).filter(Boolean)}
function updateDominosCart(menuId,delta){mutate(t=>{t.dominos||=defaultDominos();const row=t.dominos.cart.find(x=>x.menuId===menuId);if(row)row.quantity=Math.max(0,Math.min(20,row.quantity+Number(delta||0)));else if(delta>0)t.dominos.cart.push({menuId,quantity:1});t.dominos.cart=t.dominos.cart.filter(x=>x.quantity>0)},false);render()}
function placeDominosOrder(location=''){
  const t=timeline(),items=dominosCart(t),customer=currentIdentity();if(!items.length||!customer)return null;const roles=globalAppRoles(),assignedDriver=identityById(roles.dominos.deliveryWorkerId),driver=assignedDriver?.id===customer.id?null:assignedDriver,stamp=now().getTime(),order=normalizeDominosOrder({id:`dominos:${id()}`,customerIdentityId:customer.id,customerName:customer.name,driverIdentityId:driver?.id||'',driverName:driver?.name||'',items:items.map(x=>({menuId:x.id,name:x.name,price:x.price,quantity:x.quantity})),total:items.reduce((sum,x)=>sum+x.lineTotal,0),location:String(location||locationForIdentity(customer)||'Location to be confirmed'),status:'preparing',createdAt:stamp,readyAt:stamp+20*60000,etaMs:stamp+35*60000});const state=sharedServices();state.dominos.orders.unshift(order);t.dominos.cart=[];persist(t,false);saveSharedServices(state);recordContinuityEvent({kind:'social',participants:[customer.name,...(driver?[driver.name]:[])],sender:customer.name,summary:`${customer.name} placed a Domino's order for ${order.items.map(x=>`${x.quantity}× ${x.name}`).join(', ')} to ${order.location}.${driver?` ${driver.name} is assigned to deliver it.`:' No delivery worker is assigned yet.'}`,threadTitle:"Domino's",mirrorId:`dominos-order:${order.id}`,roleplayMs:stamp,persistent:true});serviceNotification(customer,'dominos','Order confirmed',`${euro(order.total)} · estimated delivery ${timeText(new Date(order.etaMs))}`,order.id);if(driver)serviceNotification(driver,'dominos','New delivery assigned',`${customer.name} · ${order.location} · ${euro(order.total)}`,order.id);render();return order;
}
function commitDominosArrival(order,state=sharedServices()){
  if(!order||order.arrivalCommitted)return false;order.arrivalCommitted=true;order.status='arrived';order.updatedAt=Date.now();saveSharedServices(state);const customer=identityById(order.customerIdentityId),driver=identityById(order.driverIdentityId);serviceNotification(customer,'dominos','Your order has arrived',driver?`${driver.name} is at ${order.location}.`:'Your delivery is at the requested location.',order.id);if(driver&&customer){if(currentChatIncludes(driver.name))recordContinuityEvent({kind:'social',participants:[customer.name,driver.name],sender:driver.name,summary:`${driver.name} has arrived at ${order.location} with ${customer.name}'s Domino's order and is ready to knock or meet them outside. This arrival belongs only to order ${order.id}.`,threadTitle:"Domino's delivery",mirrorId:`dominos-arrival:${order.id}`,roleplayMs:now().getTime(),persistent:true});else dispatchServiceText(driver,customer,`Pizza has arrived at ${order.location}. Where exactly should I bring it?`,`dominos-arrival:${order.id}`)}return true;
}
function setDominosOrderStatus(orderId,status){
  const state=sharedServices(),order=state.dominos.orders.find(x=>x.id===orderId);if(!order||['delivered','cancelled'].includes(order.status)||order.status===status)return false;const allowed={placed:['preparing','cancelled'],preparing:['out_for_delivery','cancelled'],out_for_delivery:['arrived','cancelled'],arrived:['delivered','cancelled']};if(!allowed[order.status]?.includes(status))return false;if(status==='arrived')return commitDominosArrival(order,state);order.status=status;order.updatedAt=Date.now();if(['delivered','cancelled'].includes(status)&&!order.completionCommitted){order.completionCommitted=true;const cancelled=status==='cancelled';recordContinuityEvent({kind:'social',participants:[order.customerName,order.driverName].filter(Boolean),sender:cancelled?order.customerName:(order.driverName||order.customerName),summary:`Domino's order for ${order.customerName} was ${cancelled?'cancelled':'delivered and completed'}. It must not be delivered again.`,threadTitle:"Domino's delivery",mirrorId:`dominos-complete:${order.id}`,roleplayMs:now().getTime(),persistent:false});if(cancelled&&order.driverIdentityId)serviceNotification(order.driverIdentityId,'dominos','Delivery cancelled',`${order.customerName}'s order was cancelled.`,order.id)}saveSharedServices(state);render();return true;
}
function requestUberRide(driverRef,pickup='',destination=''){
  const rider=currentIdentity(),driver=resolveIdentityRef(driverRef,false);if(!rider||!driver||rider.id===driver.id||!globalAppRoles().uber.driverIds.includes(driver.id)||!String(destination).trim())return null;const stamp=now().getTime(),ride=normalizeUberRide({id:`uber:${id()}`,riderIdentityId:rider.id,riderName:rider.name,driverIdentityId:driver.id,driverName:driver.name,pickup:String(pickup||locationForIdentity(rider)||'Pickup to be confirmed'),destination:String(destination).trim(),status:'en_route',createdAt:stamp,etaMs:stamp+(6+seededSocialNumber(rider,`uber-eta:${stamp}`,0,7))*60000}),state=sharedServices();state.uber.rides.unshift(ride);timeline().uber.savedDestination=ride.destination;persist(timeline(),false);saveSharedServices(state);recordContinuityEvent({kind:'social',participants:[rider.name,driver.name],sender:rider.name,summary:`${rider.name} requested an Uber ride with ${driver.name}, pickup at ${ride.pickup}, going to ${ride.destination}. ${driver.name} is currently driving to the pickup.`,threadTitle:'Uber',mirrorId:`uber-request:${ride.id}`,roleplayMs:stamp,persistent:true});serviceNotification(rider,'uber','Ride confirmed',`${driver.name} · arriving around ${timeText(new Date(ride.etaMs))}`,ride.id);serviceNotification(driver,'uber','New rider',`${rider.name} · ${ride.pickup} → ${ride.destination}`,ride.id);render();return ride;
}
function commitUberArrival(ride,state=sharedServices()){
  if(!ride||ride.arrivalCommitted)return false;ride.arrivalCommitted=true;ride.status='arrived';ride.updatedAt=Date.now();saveSharedServices(state);const rider=identityById(ride.riderIdentityId),driver=identityById(ride.driverIdentityId);serviceNotification(rider,'uber','Your driver has arrived',`${driver?.name||'Driver'} is at ${ride.pickup}.`,ride.id);if(driver&&rider){if(currentChatIncludes(driver.name))recordContinuityEvent({kind:'social',participants:[rider.name,driver.name],sender:driver.name,summary:`${driver.name} has arrived at ${ride.pickup} to collect ${rider.name} for the Uber ride to ${ride.destination}. This arrival belongs only to ride ${ride.id}.`,threadTitle:'Uber ride',mirrorId:`uber-arrival:${ride.id}`,roleplayMs:now().getTime(),persistent:true});else dispatchServiceText(driver,rider,`I'm outside at ${ride.pickup}. Ready when you are.`,`uber-arrival:${ride.id}`)}return true;
}
function setUberRideStatus(rideId,status){
  const state=sharedServices(),ride=state.uber.rides.find(x=>x.id===rideId);if(!ride||['completed','cancelled'].includes(ride.status)||ride.status===status)return false;const allowed={requested:['en_route','cancelled'],en_route:['arrived','cancelled'],arrived:['in_progress','cancelled'],in_progress:['completed','cancelled']};if(!allowed[ride.status]?.includes(status))return false;if(status==='arrived')return commitUberArrival(ride,state);ride.status=status;ride.updatedAt=Date.now();if(status==='in_progress')recordContinuityEvent({kind:'social',participants:[ride.riderName,ride.driverName],sender:ride.driverName,summary:`${ride.riderName}'s Uber ride with ${ride.driverName} is now travelling from ${ride.pickup} to ${ride.destination}.`,threadTitle:'Uber ride',mirrorId:`uber-start:${ride.id}`,roleplayMs:now().getTime(),persistent:true});if(['completed','cancelled'].includes(status)&&!ride.completionCommitted){ride.completionCommitted=true;const cancelled=status==='cancelled';recordContinuityEvent({kind:'social',participants:[ride.riderName,ride.driverName],sender:cancelled?ride.riderName:ride.driverName,summary:cancelled?`${ride.riderName}'s Uber ride with ${ride.driverName} was cancelled and must not arrive or run.`:`${ride.riderName}'s Uber ride with ${ride.driverName} reached ${ride.destination} and is complete. It must not arrive or run again.`,threadTitle:'Uber ride',mirrorId:`uber-complete:${ride.id}`,roleplayMs:now().getTime(),persistent:false});if(cancelled)serviceNotification(ride.driverIdentityId,'uber','Ride cancelled',`${ride.riderName} cancelled the ride.`,ride.id)}saveSharedServices(state);render();return true;
}
function reconcileServiceEvents(){
  const state=sharedServices(),stamp=now().getTime();let changed=false;for(const order of state.dominos.orders){if(['delivered','cancelled'].includes(order.status))continue;if(order.status==='preparing'&&stamp>=order.readyAt){order.status='out_for_delivery';order.updatedAt=Date.now();changed=true;serviceNotification(order.customerIdentityId,'dominos','Out for delivery',`${order.driverName||'Your courier'} is bringing your order.`,order.id)}if(order.status==='out_for_delivery'&&stamp>=order.etaMs){commitDominosArrival(order,state);changed=true}}
  for(const ride of state.uber.rides){if(['completed','cancelled'].includes(ride.status))continue;if(ride.status==='en_route'&&stamp>=ride.etaMs){commitUberArrival(ride,state);changed=true}}if(changed)saveSharedServices(state);return changed;
}
function activeServicePromptSummary(){
  if(!hasChat())return'';const state=sharedServices(),orders=state.dominos.orders.filter(x=>!['delivered','cancelled'].includes(x.status)).slice(0,6),rides=state.uber.rides.filter(x=>!['completed','cancelled'].includes(x.status)).slice(0,6);if(!orders.length&&!rides.length)return'';const lines=[];
  for(const order of orders)lines.push(`Domino's · ${serviceStatus(order.status)} · customer ${order.customerName} · delivery worker ${order.driverName||'not assigned'} · destination ${order.location} · ${order.items.map(x=>`${x.quantity}× ${x.name}`).join(', ')} · ETA ${continuityTime(order.etaMs)}`);
  for(const ride of rides)lines.push(`Uber · ${serviceStatus(ride.status)} · rider ${ride.riderName} · driver ${ride.driverName} · ${ride.pickup} → ${ride.destination} · pickup ETA ${continuityTime(ride.etaMs)}`);
  return`ACTIVE PHONE SERVICE STATE — authoritative for this chat until completed or cancelled:\n${lines.join('\n')}`;
}

function sharedOnlyFans(){
  const root=metadataRoot();if(!root)return{version:1,subscriptions:{}};const state=root.onlyFans&&typeof root.onlyFans==='object'?root.onlyFans:{};state.version=Math.max(1,Number(state.version||1));if(!state.subscriptions||typeof state.subscriptions!=='object'||Array.isArray(state.subscriptions))state.subscriptions={};for(const [key,row] of Object.entries(state.subscriptions)){if(!row||typeof row!=='object'){delete state.subscriptions[key];continue}row.viewerIdentityId=String(row.viewerIdentityId||'');row.creatorIdentityId=String(row.creatorIdentityId||'');row.active=row.active!==false;row.startedAt=Math.max(0,Number(row.startedAt||Date.now()));row.updatedAt=Math.max(0,Number(row.updatedAt||Date.now()))}root.onlyFans=state;return state;
}
function saveSharedOnlyFans(state){const root=metadataRoot();if(!root)return;root.onlyFans=state;saveMetadataRoot(root)}
function onlyFansSubscriptionKey(viewerId,creatorId){return`${viewerId}|${creatorId}`}
function isOnlyFansSubscribed(viewerId,creatorId){return sharedOnlyFans().subscriptions[onlyFansSubscriptionKey(viewerId,creatorId)]?.active===true}
function onlyFansAccountStats(identity,account=onlyFansAccount(identity,true)){
  const state=sharedOnlyFans(),named=Object.values(state.subscriptions).filter(x=>x.active&&x.creatorIdentityId===identity.id).length,manualPosts=(account.posts||[]).filter(x=>!x.seeded).length,subscribers=account.subscribersBase+named,monthly=account.monthlyEarningsBase+Math.round(named*account.subscriptionPrice*.8);return{subscribers,posts:account.historicalPostCount+manualPosts,monthly,total:account.totalEarningsBase+Math.round(named*account.subscriptionPrice)};
}
function setOnlyFansSubscription(viewerRef,creatorRef,active=true){
  const viewer=resolveIdentityRef(viewerRef,true),creator=resolveIdentityRef(creatorRef,true),account=onlyFansAccount(creator,false);if(!viewer||!creator||viewer.id===creator.id||!account)return false;const state=sharedOnlyFans(),key=onlyFansSubscriptionKey(viewer.id,creator.id),existing=state.subscriptions[key];state.subscriptions[key]={viewerIdentityId:viewer.id,creatorIdentityId:creator.id,active:!!active,startedAt:Number(existing?.startedAt||now().getTime()),updatedAt:Date.now()};const a=phoneForIdentity(viewer,true),b=phoneForIdentity(creator,true),ar=ensureRelationship(a.timeline,creator),br=ensureRelationship(b.timeline,viewer);ar.apps.onlyfans.subscribed=!!active;br.apps.onlyfans.subscribedBy=!!active;if(active&&identityAppEnabled(creator,'onlyfans'))pushAppNotification(b.timeline,'onlyfans',viewer,`${viewer.name} subscribed to your page`);a.root.phones[a.key]=a.timeline;a.root.phones[b.key]=b.timeline;saveSharedOnlyFans(state);saveMetadataRoot(a.root);recordContinuityEvent({kind:'social',participants:[viewer.name,creator.name],sender:viewer.name,summary:`${viewer.name} ${active?'subscribed to':'unsubscribed from'} ${creator.name}'s OnlyFans.`,threadTitle:'OnlyFans',mirrorId:`onlyfans-sub:${id()}`,roleplayMs:now().getTime()});render();return true;
}
function publishOnlyFansPostFor(creatorRef,data={},notify=true){
  const creator=resolveIdentityRef(creatorRef,false),account=onlyFansAccount(creator,false);if(!creator||!account)return null;const row=normalizeOnlyFansPost({...data,id:`onlyfans-post:${id()}`,identityId:creator.id,author:creator.name,timeMs:Number(data.timeMs||now().getTime()),seeded:false},creator);if(!row.visual&&!row.caption)return null;account.posts.unshift(row);account.activity.unshift({id:id(),text:`Published a new ${row.type}.`,timeMs:row.timeMs});settingsRoot().onlyFansAccounts[creator.id]=account;ctx()?.saveSettingsDebounced?.();if(notify){const state=sharedOnlyFans();for(const sub of Object.values(state.subscriptions)){if(!sub.active||sub.creatorIdentityId!==creator.id)continue;const viewer=identityById(sub.viewerIdentityId);if(viewer)serviceNotification(viewer,'onlyfans',`${creator.name} posted`,row.caption||`New ${row.type}`,row.id)}}recordContinuityEvent({kind:'social',participants:[creator.name],sender:creator.name,summary:`${creator.name} published a new adult-only OnlyFans ${row.type}: ${row.visual}${row.caption?` | Caption: ${row.caption}`:''}`,threadTitle:'OnlyFans',mirrorId:row.id,roleplayMs:row.timeMs});render();return row;
}
function publishOnlyFansPost(data={}){return publishOnlyFansPostFor(currentIdentity(),data,true)}

function darkWebSection(value){return['drugs','escorts','crime','intel'].includes(value)?value:'drugs'}
function normalizeDarkWebListing(row={}){
  row=row&&typeof row==='object'?row:{};row.id=String(row.id||id());row.section=darkWebSection(row.section);row.providerIdentityId=String(row.providerIdentityId||'');row.providerName=norm(row.providerName||row.provider||'Vendor');row.providerType=row.providerType==='existing'?'existing':'provisional';row.title=String(row.title||'').trim();row.description=String(row.description||'').trim();row.price=normalizeMarketplacePrice(row.price)||'€0';row.duration=String(row.duration||'').trim();row.area=String(row.area||'').trim();row.visual=String(row.visual||'').trim();row.timeMs=Math.max(0,Number(row.timeMs||now().getTime()));row.status=['available','closed','removed'].includes(row.status)?row.status:'available';row.signature=hashString(JSON.stringify([row.section,lc(row.providerName),lc(row.title),lc(row.price),lc(row.duration)]));return row;
}
function defaultSharedDarkWeb(){return{version:1,listings:[],archived:[],refresh:{lastAt:null,eventKeys:[],summary:''}}}
function sharedDarkWeb(){
  const root=metadataRoot();if(!root)return defaultSharedDarkWeb();const state=root.darkWeb&&typeof root.darkWeb==='object'?root.darkWeb:defaultSharedDarkWeb();state.version=Math.max(1,Number(state.version||1));state.listings=(Array.isArray(state.listings)?state.listings:[]).map(normalizeDarkWebListing).filter(x=>x.status==='available').sort((a,b)=>b.timeMs-a.timeMs);const seen=new Set();state.listings=state.listings.filter(x=>{if(seen.has(x.signature))return false;seen.add(x.signature);return true}).slice(0,MAX_DARKWEB_LISTINGS);state.archived=(Array.isArray(state.archived)?state.archived:[]).map(normalizeDarkWebListing).slice(0,120);state.refresh=state.refresh&&typeof state.refresh==='object'?state.refresh:{lastAt:null,eventKeys:[],summary:''};state.refresh.eventKeys=Array.isArray(state.refresh.eventKeys)?state.refresh.eventKeys.slice(-180):[];root.darkWeb=state;return state;
}
function saveSharedDarkWeb(state){const root=metadataRoot();if(!root)return;state.listings=state.listings.sort((a,b)=>b.timeMs-a.timeMs).slice(0,MAX_DARKWEB_LISTINGS);root.darkWeb=state;saveMetadataRoot(root)}
function darkWebRoleForSection(section){return section==='drugs'?'dealers':section==='escorts'?'escorts':section==='crime'?'crime':'intel'}
function darkWebAssigned(section){const map=globalAppRoles().darkweb[darkWebRoleForSection(section)]||{};return Object.entries(map).map(([identityId,config])=>({identity:identityById(identityId),config})).filter(x=>x.identity)}
function addDarkWebListing(state,data={}){
  const section=darkWebSection(data.section),role=darkWebRoleForSection(section),roles=globalAppRoles(),requestedExisting=data.providerType==='existing',existing=requestedExisting?(identityById(String(data.providerIdentityId||''))||identityForName(data.provider,{create:false})):null,allowed=existing&&roles.darkweb[role]?.[existing.id],provider=allowed?existing:createProvisionalIdentity(data.provider||data.firstName||'Vendor',{source:`darkweb-${section}`,adult:section==='escorts'}),title=String(data.title||'').trim(),price=normalizeMarketplacePrice(data.price);if(!provider||!title||!price)return null;const row=normalizeDarkWebListing({id:`darkweb:${id()}`,section,providerIdentityId:provider.id,providerName:provider.name,providerType:provider.kind==='provisional'?'provisional':'existing',title,description:String(data.description||'').trim(),price,duration:String(data.duration||'').trim(),area:String(data.area||'').trim(),visual:String(data.visual||'').trim(),timeMs:now().getTime(),status:'available'});if(state.listings.some(x=>x.signature===row.signature))return null;return row;
}
function normalizeDarkWebRefreshResult(raw){let value=raw;if(typeof raw==='string'){try{value=parseJSON(raw)}catch{value=null}}if(!value||typeof value!=='object')return{summary:'',listings:[]};return{summary:String(value.summary||''),listings:Array.isArray(value.listings)?value.listings.filter(Boolean).slice(0,12):[]}}
function applyDarkWebRefresh(result){const state=sharedDarkWeb(),keys=new Set(state.refresh.eventKeys||[]),fresh=[];for(const data of result.listings){const row=addDarkWebListing(state,data);if(!row||keys.has(row.signature))continue;keys.add(row.signature);fresh.push(row)}if(fresh.length)state.listings.unshift(...fresh);state.refresh.lastAt=Date.now();state.refresh.summary=String(result.summary||'');state.refresh.eventKeys=[...keys].slice(-180);saveSharedDarkWeb(state);return fresh.length}
async function refreshDarkWeb(){
  if(darkWebRefreshBusy||refreshBusy)return;if(!profile().apps.darkweb){globalThis.toastr?.warning?.('Dark Web is not installed on this phone.');return}darkWebRefreshBusy=true;islandText='Refreshing Dark Web…';islandIcon=APPS.darkweb.icon;render();try{const roles=globalAppRoles(),providers=[];for(const section of ['drugs','escorts','crime','intel'])for(const {identity,config} of darkWebAssigned(section))providers.push({section,identityId:identity.id,name:identity.name,character:compactCard({name:identity.name,characterId:findCharacter(identity.name)?.index??null}),profile:config});const state=sharedDarkWeb(),existing=state.listings.map(x=>({section:x.section,provider:x.providerName,title:x.title,price:x.price,duration:x.duration}));const systemPrompt=`You generate one manual refresh for a FICTIONAL Dark Web app inside Greyhaven roleplay. Return only valid JSON. No markdown.
Refresh all four sections: drugs, escorts, crime, and intel. Create 1 to 3 plausible new listings per section without duplicating existing listings.
Existing named characters may appear ONLY when they are explicitly included in ASSIGNED PROVIDERS for that same section. Never assign another real character. Provisional NPCs must use ONE first name only; never invent or expand a surname.
Every escort is an adult and every interaction is consensual. Include a fixed price, a duration such as 30 minutes, 1 hour, or one night, and clear fictional boundaries without coercion.
Crime and drug listings are fictional story hooks. Do not provide real vendor contacts, sourcing, manufacturing, evasion, weapon construction, or operational instructions. Keep descriptions high-level and narrative.
Use fixed whole-euro prices, never ranges. Required JSON: {"summary":"","listings":[{"section":"drugs|escorts|crime|intel","providerType":"existing|provisional","provider":"Exact assigned name or one first name","providerIdentityId":"optional assigned id","title":"","description":"","price":"€0","duration":"","area":"","visual":"listing image description"}]}`;const prompt=`ROLEPLAY TIME:\n${now().toISOString()}\n\nASSIGNED PROVIDERS — exact allowlist:\n${JSON.stringify(providers)}\n\nGREYHAVEN LIFE:\n${JSON.stringify(scopedWorld(world(),providers.map(x=>x.name)))}\n\nEXISTING LISTINGS TO AVOID:\n${JSON.stringify(existing)}\n\nGenerate a balanced new batch now.`;const raw=await generate({prompt,systemPrompt,responseLength:Math.max(1800,profile().responseTokens)}),added=applyDarkWebRefresh(normalizeDarkWebRefreshResult(raw));globalThis.toastr?.success?.(added?`Dark Web refreshed · ${added} new listings`:'Dark Web refreshed · nothing new')}catch(e){console.error(`[${GHP_MODULE}] dark web refresh`,e);globalThis.toastr?.error?.(`Dark Web refresh failed: ${e?.message||e}`)}finally{darkWebRefreshBusy=false;islandText='';islandIcon='';render()}
}

function appendIncomingMessage(t,th,c,{text='',mediaType='',mediaDescription=''},stamp,unreadFlag=true){
  const items=[],created=[];
  if(String(text||'').trim())items.push({type:'text',text:String(text).trim()});
  if(['photo','video'].includes(mediaType)&&String(mediaDescription||'').trim())items.push({type:mediaType,text:'',mediaDescription:String(mediaDescription).trim()});
  if(!items.length)return created;
  for(const item of items){
    const mirrorId=`mirror:${id()}`,msg=normalizeMessage({id:id(),mirrorId,sender:c.name,senderId:c.id,text:item.text,type:item.type,mediaDescription:item.mediaDescription||'',timeMs:stamp,realMs:Date.now(),read:!unreadFlag});
    th.messages.push(msg);created.push(msg);noteRelationshipInteraction(t,c.identityId||c.name,'messages',messageContext(msg),stamp);
    mirrorRichMessageToPhone({phoneOwner:c.name,phoneOwnerAvatar:c.avatar,peerName:persona().name,peerAvatar:persona().avatar,peerDescription:persona().description,senderName:c.name,message:msg,unread:false});
  }
  return created;
}
function mirrorOwnedAppItem(appName,authorIdentity,kind,item){
  const box=phoneForOwner(authorIdentity.name,authorIdentity.avatar,true);if(!box)return;const store=appStore(box.timeline,appName),list=kind==='story'?store.stories:store.posts;if(!Array.isArray(list))return;const shared=item.sharedEventId||'';if(shared&&list.some(x=>x.sharedEventId===shared))return;list.unshift({...clone(item),ownerPost:true});box.root.phones[box.key]=box.timeline;saveMetadataRoot(box.root);
}
function applyRefresh(r){
  const t=timeline(),installed=profile().apps,w=world(),candidateList=refreshIdentityCandidates(t,w,installed),allowedById=new Map(candidateList.map(x=>[x.identityId,identityById(x.identityId)])),allowedByName=new Map(candidateList.map(x=>[lc(x.name),identityById(x.identityId)])),contactsByName=new Map(Object.values(t.contacts).map(c=>[lc(c.name),c])),keys=new Set(t.refresh.eventKeys||[]),stamp=now().getTime(),max=profile().maxNewEvents,continuityEntries=[];let count=0;
  const addKey=k=>{keys.add(k);t.refresh.eventKeys=[...keys].slice(-80)};
  const owner=persona(),ownerIdentity=currentIdentity(),events=Array.isArray(r?.events)?r.events:[];
  for(const x of events){
    if(count>=max)break;const type=norm(x.type),identity=allowedById.get(String(x.identityId||x.fromIdentityId||''))||allowedByName.get(lc(x.from||x.actor||x.author||x.contact||x.seller));
    const appName=type.startsWith('instagram.')?'instagram':type.startsWith('snapchat.')?'snapchat':type.startsWith('facebook.')||type.startsWith('marketplace.')?'facebook':type.startsWith('onlyfans.')?'onlyfans':type.startsWith('message.')?'messages':type.startsWith('phone.')?'phone':type.startsWith('mail.')?'mail':'';
    if(!appName||!installed[appName]||type.startsWith('marketplace.'))continue;if(!['mail.receive','snapchat.npc.request','onlyfans.npc.subscribe'].includes(type)&&!identity)continue;
    const signature=JSON.stringify([type,identity?.id||lc(x.seller||x.firstName),x.text||x.caption||x.title||x.accountBio||'',x.mediaType||'',x.mediaDescription||x.visual||'',x.price||'']).slice(0,900),key=`u:${hashString(signature)}`;if(keys.has(key))continue;

    if(type==='message.receive'){
      const co=contactsByName.get(lc(identity.name)),text=String(x.text||'').trim(),mediaType=['photo','video'].includes(x.mediaType)?x.mediaType:'',mediaDescription=String(x.mediaDescription||'').trim();if(!co||co.blocked||co.blockedByContact||(!text&&!mediaDescription))continue;
      let th=x.threadId&&t.threads[x.threadId]?t.threads[x.threadId]:Object.values(t.threads).find(v=>v.type==='direct'&&v.contactIds[0]===co.id);if(!th){th={id:`thread:${id()}`,type:'direct',title:co.nickname||co.name,contactIds:[co.id],createdAt:stamp,messages:[]};t.threads[th.id]=th;t.threadOrder.unshift(th.id)}if(th.type==='group'&&!th.contactIds.includes(co.id))continue;
      const created=appendIncomingMessage(t,th,co,{text,mediaType,mediaDescription},stamp,true);for(const msg of created)continuityEntries.push({th,msg,ownerName:owner.name});if(!co.muted)t.notifications.unshift({id:id(),app:'messages',title:co.nickname||co.name,text:text||(mediaType==='video'?'Video':'Photo'),timeMs:stamp,read:false,targetId:th.id});
    }else if(type==='phone.call'){
      const co=contactsByName.get(lc(identity.name));if(!co||co.blocked||co.blockedByContact)continue;const st=x.status==='incoming'?'incoming':'missed',sharedCallId=`call:${id()}`,call={id:id(),sharedCallId,contactId:co.id,contactName:co.name,direction:'incoming',status:st,timeMs:stamp,durationSec:0,transcript:[]};t.calls.unshift(call);if(!co.muted)t.notifications.unshift({id:id(),app:'phone',title:st==='missed'?`Missed call · ${co.name}`:`${co.name} is calling`,text:st==='missed'?'Tap to call back':'Incoming call',timeMs:stamp,read:false,targetId:call.id});mirrorCallToOwner({phoneOwner:co.name,phoneOwnerAvatar:co.avatar,peerName:owner.name,peerAvatar:owner.avatar,peerDescription:owner.description,direction:'outgoing',status:st==='missed'?'no answer':'active',timeMs:stamp,sharedCallId});
    }else if(type==='instagram.follow'||type==='instagram.unfollow'){
      setInstagramFollowing(identity.name,owner.name,type==='instagram.follow',{notify:true});
    }else if(type==='instagram.post'||type==='instagram.story'){
      const state=t.relationships?.[identity.id]?.apps?.instagram;if(!state?.following&&!state?.followedBy)continue;const visual=String(x.visual||x.mediaDescription||'').trim(),caption=String(x.caption||x.text||'').trim();if(!visual&&!caption)continue;const sharedEventId=`instagram:${id()}`,row={id:id(),sharedEventId,identityId:identity.id,author:identity.name,contactId:contactsByName.get(lc(identity.name))?.id||'',visual,caption,likes:Math.max(0,Number(x.likes||0)),comments:Array.isArray(x.comments)?x.comments:[],commentCount:Math.max(0,Number(x.commentCount||x.comments||0)),timeMs:stamp,expiresAt:type.endsWith('.story')?stamp+86400000:0,viewed:false};const kind=type.endsWith('.story')?'story':'post';t.instagram[kind==='story'?'stories':'posts'].unshift(row);mirrorOwnedAppItem('instagram',identity,kind,row);if(kind==='post')pushAppNotification(t,'instagram',identity,`${identity.name} shared a post`);
    }else if(type==='instagram.dm'){
      const text=String(x.text||'').trim(),mediaType=['photo','video'].includes(x.mediaType)?x.mediaType:'text',mediaDescription=String(x.mediaDescription||'').trim();if(!text&&mediaType==='text'||mediaType!=='text'&&!mediaDescription)continue;mirrorAppMessage({appName:'instagram',fromName:identity.name,toName:owner.name,type:mediaType,text,mediaDescription,timeMs:stamp,unread:true});
    }else if(['instagram.story.view','instagram.post.like','instagram.post.comment'].includes(type)){
      const target=type==='instagram.story.view'?(t.instagram.stories.find(p=>p.id===x.storyId)||t.instagram.stories.find(p=>p.ownerPost)):(t.instagram.posts.find(p=>p.id===x.postId)||t.instagram.posts.find(p=>p.ownerPost));if(!target)continue;
      const action=type==='instagram.story.view'?'view':type==='instagram.post.like'?'like':'comment',comment=String(x.text||x.comment||'').trim();if(action==='comment'&&!comment)continue;if(!updateSharedSocialEngagement('instagram',action==='view'?'story':'post',target.id,{actor:identity,action,text:comment,notify:true}))continue;
    }else if(type==='snapchat.add'||type==='snapchat.accept'||type==='snapchat.decline'){
      setSnapchatFriendRequest(identity.name,owner.name,type==='snapchat.add'?'request':type==='snapchat.accept'?'accept':'decline',{notify:type!=='snapchat.decline'});
    }else if(type==='snapchat.npc.request'){
      const firstName=String(x.firstName||x.from||'').trim(),npc=createProvisionalIdentity(firstName||'Alex',{source:'snapchat',accountBio:String(x.accountBio||'').trim()});if(!npc)continue;setSnapchatFriendRequest(npc.id,ownerIdentity.id,'request',{notify:true});
    }else if(type==='snapchat.snap'){
      const state=t.relationships?.[identity.id]?.apps?.snapchat,mediaType=['photo','video'].includes(x.mediaType)?x.mediaType:'photo',description=String(x.mediaDescription||x.visual||'').trim();if(!state?.friends||!description)continue;mirrorAppMessage({appName:'snapchat',fromName:identity.name,toName:owner.name,type:mediaType,text:String(x.text||x.caption||'').trim(),mediaDescription:description,timeMs:stamp,unread:true});
    }else if(type==='snapchat.story'){
      const state=t.relationships?.[identity.id]?.apps?.snapchat,visual=String(x.visual||x.mediaDescription||'').trim();if(!state?.friends||!visual)continue;const row={id:id(),sharedEventId:`snap-story:${id()}`,identityId:identity.id,author:identity.name,visual,caption:String(x.caption||x.text||''),timeMs:stamp,expiresAt:stamp+86400000,viewed:false};t.snapchat.stories.unshift(row);mirrorOwnedAppItem('snapchat',identity,'story',row);
    }else if(type==='facebook.friend.request'||type==='facebook.friend.accept'||type==='facebook.friend.decline'){
      setFacebookFriendRequest(identity.name,owner.name,type.endsWith('.request')?'request':type.endsWith('.accept')?'accept':'decline',{notify:!type.endsWith('.decline')});
    }else if(type==='facebook.post'){
      const visual=String(x.visual||x.mediaDescription||'').trim(),body=String(x.text||x.caption||'').trim();if(!visual&&!body)continue;const row={id:id(),sharedEventId:`facebook-post:${id()}`,identityId:identity.id,author:identity.name,visual,text:body,likes:Math.max(0,Number(x.likes||0)),comments:Array.isArray(x.comments)?x.comments:[],timeMs:stamp};t.facebook.posts.unshift(row);mirrorOwnedAppItem('facebook',identity,'post',row);
    }else if(type==='facebook.post.like'||type==='facebook.post.comment'){
      const target=t.facebook.posts.find(p=>p.id===x.postId)||t.facebook.posts.find(p=>p.ownerPost),action=type.endsWith('.like')?'like':'comment',comment=String(x.text||x.comment||'').trim();if(!target||action==='comment'&&!comment)continue;if(!updateSharedSocialEngagement('facebook','post',target.id,{actor:identity,action,text:comment,notify:true}))continue;
    }else if(type==='facebook.messenger'){
      const text=String(x.text||'').trim(),mediaType=['photo','video'].includes(x.mediaType)?x.mediaType:'text',mediaDescription=String(x.mediaDescription||'').trim();if(!text&&mediaType==='text'||mediaType!=='text'&&!mediaDescription)continue;mirrorAppMessage({appName:'facebook',fromName:identity.name,toName:owner.name,type:mediaType,text,mediaDescription,timeMs:stamp,unread:true});
    }else if(type==='onlyfans.post'){
      if(!globalAppRoles().onlyfans.creatorIds.includes(identity.id))continue;const visual=String(x.visual||x.mediaDescription||'').trim(),caption=String(x.caption||x.text||'').trim();if(!visual&&!caption)continue;if(!publishOnlyFansPostFor(identity,{type:x.mediaType==='video'||x.type==='video'?'video':'photo',visual,caption,timeMs:stamp},true))continue;
    }else if(type==='onlyfans.dm'){
      const text=String(x.text||'').trim(),mediaType=['photo','video'].includes(x.mediaType)?x.mediaType:'text',mediaDescription=String(x.mediaDescription||'').trim(),state=sharedOnlyFans(),connected=globalAppRoles().onlyfans.creatorIds.includes(identity.id)||Object.values(state.subscriptions).some(s=>s.active&&((s.viewerIdentityId===identity.id&&s.creatorIdentityId===ownerIdentity.id)||(s.creatorIdentityId===identity.id&&s.viewerIdentityId===ownerIdentity.id)));if(!connected||!text&&mediaType==='text'||mediaType!=='text'&&!mediaDescription)continue;mirrorAppMessage({appName:'onlyfans',fromName:identity.name,toName:owner.name,type:mediaType,text,mediaDescription,timeMs:stamp,unread:true});
    }else if(type==='onlyfans.subscribe'){
      if(!onlyFansAccount(ownerIdentity,false)||!setOnlyFansSubscription(identity,ownerIdentity,true))continue;
    }else if(type==='onlyfans.npc.subscribe'){
      if(!onlyFansAccount(ownerIdentity,false))continue;const first=String(x.firstName||x.from||'').trim(),fan=createProvisionalIdentity(first||'Alex',{source:'onlyfans-subscriber',adult:true,accountBio:String(x.accountBio||'').trim()});if(!fan||!setOnlyFansSubscription(fan,ownerIdentity,true))continue;
    }else if(type==='mail.receive'){
      const from=norm(x.from),subject=String(x.subject||'').trim(),body=String(x.body||'').trim();if(!from||!subject||!body)continue;t.mail.unshift({id:id(),from,subject,body,timeMs:stamp,read:false});t.notifications.unshift({id:id(),app:'mail',title:from,text:subject,timeMs:stamp,read:false});
    }else continue;
    addKey(key);count++;
  }
  t.refresh.lastAt=Date.now();t.refresh.chatLength=Array.isArray(ctx()?.chat)?ctx().chat.length:0;t.refresh.summary=String(r?.summary||'').trim();persist(t,false);
  for(const e of continuityEntries)recordMessageContinuity(e.th,t,e.msg,e.ownerName);
  return count;
}
function cleanPlainReply(raw){
  let text=String(raw||'').trim().replace(/^```(?:text|txt)?\s*/i,'').replace(/\s*```$/,'').trim();
  if(!text||text==='{}'||text==='[]')return'';text=text.replace(/^["“](.*)["”]$/s,'$1').trim();return text;
}
function mediaRefusalText(text=''){
  return /\b(?:not sending|won't send|would rather not|don't feel comfortable|not comfortable|not sure (?:i'm|i am) comfortable|not sure if (?:i'm|i am) comfortable|don't think (?:i'm|i am) comfortable|not ready|maybe later|wait until you|get home to see|not gonna send|i'm not sending|i am not sending|rather wait|rather not|changed my mind|no(?:pe)?\b.{0,24}\b(?:photo|pic|picture|selfie|video|clip))\b/i.test(String(text||''));
}
function inferMediaFromText(text,requested=''){
  const raw=String(text||'').trim();if(!raw||mediaRefusalText(raw))return null;
  const kind=requested==='video'||(/\b(?:video|clip)\b/i.test(raw)&&!/\b(?:photo|picture|pic|selfie)\b/i.test(raw))?'video':'photo';
  const cue=kind==='video'?/\b(?:video|clip)\b/i:/\b(?:photo|picture|pic|selfie)\b/i;
  // Only infer media when the wording describes an attachment that is being delivered now.
  // Promises such as "I'll send one" are handled by the repair pass instead of becoming bogus media cards.
  const delivered=/\b(?:here(?:'s| is)|there you go|just sent(?: it| you)?|sent you|attached|this (?:one|photo|pic|picture|selfie|video|clip) is|take a look at this)\b/i;
  if(!cue.test(raw)||!delivered.test(raw))return null;
  let desc=raw
    .replace(/^(?:sure|okay|ok|fine|alright|haha|hehe|lol|lmao|well|mm+|mhm|yep|yeah|of course|definitely)\b[^.!?]*[.!?]?\s*/i,'')
    .replace(/^(?:here(?:'s| is)|there you go|just sent(?: it| you)?|sent you|attached)\s+(?:another\s+)?(?:a\s+)?(?:photo|picture|pic|selfie|video|clip)?\s*(?:of)?\s*/i,'')
    .replace(/^(?:me|myself)\s+/i,'')
    .trim().replace(/^[:\-–]+\s*/,'').trim();
  if(!desc)return null;
  return {type:kind,mediaDescription:desc,text:''};
}
function extractPhoneActionMarkers(raw){
  const actions=[],clean=String(raw||'').replace(PHONE_ACTION_RE,(full,payload)=>{try{const data=JSON.parse(String(payload||'').trim());if(data&&typeof data==='object')actions.push(data)}catch(e){console.warn(`[${GHP_MODULE}] invalid phone GH_ACTION`,payload,e)}return''}).replace(/\n{3,}/g,'\n\n').trim();return{clean,actions};
}
function parseDirectPacket(raw,requested=''){
  const extracted=extractPhoneActionMarkers(raw),text=cleanPlainReply(extracted.clean);if(!text)return{items:[],action:'',actions:extracted.actions};
  const markers=[...text.matchAll(/\b(TEXT|PHOTO|VIDEO|ACTION)\s*:\s*/gi)],items=[];let action='';
  if(markers.length){
    for(let i=0;i<markers.length;i++){
      const kind=markers[i][1].toLowerCase(),from=markers[i].index+markers[i][0].length,to=i+1<markers.length?markers[i+1].index:text.length,value=String(text.slice(from,to)||'').trim();
      if(!value)continue;
      if(kind==='action'){const a=value.match(/^(IGNORE|BLOCK)\b/i)?.[1]?.toLowerCase();if(a)action=a;continue}
      if(kind==='text')items.push({type:'text',text:value});else items.push({type:kind,mediaDescription:value,text:''});
    }
    if(items.length||action)return{items:items.slice(0,4),action,actions:extracted.actions};
  }
  const inferred=inferMediaFromText(text,requested);
  return{items:inferred?[inferred]:[{type:'text',text}],action:'',actions:extracted.actions};
}
function parseDirectReply(raw,requested=''){return parseDirectPacket(raw,requested).items}
function extractDirectAction(raw){return parseDirectPacket(raw,'').action}
function dispatchGeneratedPhoneActions(actions=[],actorName='',parentKey=''){
  const allowed=new Set(['message.send','media.send','call.place','contact.block','contact.unblock','contact.add','contact.exchange','instagram.follow','instagram.unfollow','snapchat.add','snapchat.accept','snapchat.decline','facebook.friend.request','facebook.friend.accept','facebook.friend.decline']),actor=norm(actorName);
  for(let index=0;index<actions.length;index++){
    const data=actions[index]&&typeof actions[index]==='object'?clone(actions[index]):{},type=norm(data.type),from=norm(data.from||actor),to=norm(data.to||data.target);if(!allowed.has(type)||lc(from)!==lc(actor)||!to||lc(to)===lc(actor))continue;
    const target=identityForName(to,{create:false});if(!target)continue;data.from=actor;data.to=target.name;const sourceKey=`phone-ai:${chatIdentity()}:${parentKey}:${index}:${hashString(JSON.stringify([type,lc(actor),target.id,data.text||'',data.mediaType||'',data.description||data.mediaDescription||'']))}`;
    if(typeof globalThis.GreyhavenLife?.dispatchWorldAction==='function')globalThis.GreyhavenLife.dispatchWorldAction(data,{source:'greyhaven-phone-ai',sourceKey,roleplayMs:now().getTime()});
    else window.dispatchEvent(new CustomEvent('greyhaven-world-action',{detail:{id:sourceKey,type,actor,from:actor,target:target.name,to:target.name,text:data.text||'',roleplayMs:now().getTime(),realMs:Date.now(),source:'greyhaven-phone-ai',sourceKey,data:{...data,mediaDescription:data.description||data.mediaDescription||'',caption:data.caption||'',expectsReply:data.expectsReply===true}}}));
  }
}
function hasExplicitMediaPacket(items=[],kind=''){return items.some(x=>['photo','video'].includes(x?.type)&&(!kind||x.type===kind))}
function recentMediaCommitment(conversation=[],contactName='',kind='photo'){
  const own=(conversation||[]).filter(m=>lc(m?.sender)===lc(contactName)).slice(-8);
  for(let i=own.length-1;i>=0;i--){
    const m=own[i];if(m?.type===kind)return'';
    const s=String(m?.text||m?.mediaDescription||'').trim();if(!s)continue;
    if(mediaRefusalText(s))return'';
    const mediaWord=kind==='video'?'(?:video|clip)':'(?:photo|pic|picture|selfie)';
    if(new RegExp(`\\b(?:i(?:'ll| will| can| could| am gonna|'m gonna| am going to|'m going to)\\s+(?:send|take|sneak|show)|let me\\s+(?:send|take|sneak)|i just took|i took|i have one|i got one|okay.{0,30}(?:send|take)|fine.{0,30}(?:send|take))\\b[^\\n]{0,90}\\b${mediaWord}\\b`,'i').test(s)||
       /\b(?:i(?:'ll| will) send (?:it|one|something)|i just took it|i took it|okay,? fine.{0,20}send|let me see what i can do|i(?:'ll| will) try to sneak one)\b/i.test(s))return s.slice(0,320);
  }
  return'';
}
function mediaSendClaim(text='',kind='photo'){
  const s=String(text||'');if(mediaRefusalText(s))return false;
  const mediaWord=kind==='video'?'(?:video|clip)':'(?:photo|pic|picture|selfie)';
  return new RegExp(`\\b(?:here(?:'s| is)|there you go|just sent|sent you|i just took|i took it|i(?:'ll| will|'m| am) sending|okay.{0,25}i(?:'ll| will) send|fine.{0,25}i(?:'ll| will) send)\\b[^\\n]{0,140}(?:${mediaWord}|it|one|something)?`,'i').test(s);
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


function boundaryMessageText(m){
  if(!m)return'';
  if(m.type==='text')return String(m.text||'').trim();
  return String(m.text||m.mediaDescription||'').trim();
}
function boundaryStatementKind(text=''){
  const s=String(text||'');
  if(/\b(?:i(?:'m| am) (?:going to )?block(?:ing)? you|i(?:'ll| will) block you|don't contact me again|do not contact me again|never (?:text|message|call|contact) me again|leave me alone|stay away from me|stop (?:texting|messaging|contacting|calling) me|don't (?:text|message|call|contact) me|do not (?:text|message|call|contact) me|back off|don't speak to me|do not speak to me)\b/i.test(s))return'hard';
  if(/\b(?:give me (?:some )?space|i need (?:some )?space|don't talk to me(?: right now)?|do not talk to me(?: right now)?|i don't want to talk(?: to you)?(?: right now)?|i do not want to talk(?: to you)?(?: right now)?|i(?:'m| am) not talking to you(?: right now)?|i(?:'m| am) done (?:talking|with this conversation|with this)|let me cool off|i(?:'m| am) too mad to talk)\b/i.test(s))return'temporary';
  return'';
}
function boundaryApology(text=''){
  const s=String(text||'');
  const apologetic=/\b(?:sorry|i apologize|i apologise|my bad|i was out of line|i crossed (?:a )?line|i shouldn't have|i should not have|i won't bother you|i will leave you alone|i'll leave you alone|i understand|i get it|i'll stop|i will stop|didn't mean to|did not mean to)\b/i.test(s);
  const continuedThreat=/\b(?:but i(?:'m| am) not stopping|but i won't stop|but i will keep|until you|you can't stop me|you cannot stop me)\b/i.test(s);
  return apologetic&&!continuedThreat;
}
function boundaryOwnerSeverity(text=''){
  const s=String(text||'');
  if(/\b(?:break(?:ing)? into|come to your (?:house|home)|find where you live|know where you live|hunt you down|hurt you|kill you|rape you|force myself|force you|make you (?:have sex|do it)|won't take no|will not take no|not gonna stop contacting|not going to stop contacting|won't stop contacting|will not stop contacting|don't care (?:about )?your boundaries|do not care (?:about )?your boundaries|you can't stop me|you cannot stop me)\b/i.test(s))return 3;
  if(/\b(?:fuck you|fuck u|fucking you|bend you over|bend u over|put (?:my|this) (?:cock|dick)|eat your pussy|eat ur pussy|your pussy|ur pussy|your tits|ur tits|your ass|ur ass|nude pic|nude selfie|send (?:me )?(?:a )?nude)\b/i.test(s))return 2;
  if(/\b(?:shut (?:the fuck )?up|fuck off|bitch|whore|slut|idiot|moron|piece of shit|worthless|disgusting)\b/i.test(s))return 1;
  return 0;
}
function boundaryThreadState(contact,owner,conversation=[]){
  const msgs=Array.isArray(conversation)?conversation:[];
  const latest=msgs.at(-1);
  const latestOwner=latest&&lc(latest.sender)===lc(owner?.name)?boundaryMessageText(latest):'';
  let boundaryIndex=-1,boundaryKind='',boundaryText='';
  for(let i=msgs.length-2;i>=0;i--){
    const m=msgs[i];if(lc(m?.sender)!==lc(contact?.name))continue;
    const text=boundaryMessageText(m),kind=boundaryStatementKind(text);
    if(kind){boundaryIndex=i;boundaryKind=kind;boundaryText=text;break}
  }
  let violations=0;
  if(boundaryIndex>=0){
    for(let i=boundaryIndex+1;i<msgs.length;i++){
      const m=msgs[i];if(lc(m?.sender)!==lc(owner?.name))continue;
      const text=boundaryMessageText(m);if(!text||boundaryApology(text))continue;
      violations++;
    }
  }
  return{
    latestOwner,
    boundaryIndex,
    boundaryKind,
    boundaryText,
    violations,
    severity:boundaryOwnerSeverity(latestOwner),
    apologizing:boundaryApology(latestOwner),
    ignoring:contact?.ignoringOwner===true,
    level:Math.max(0,Number(contact?.boundaryLevel||0)||0)
  };
}
function boundaryPreflight(contact,owner,conversation=[]){
  const s=boundaryThreadState(contact,owner,conversation);
  if(!s.latestOwner)return{action:'',reason:'',state:s};
  // Once somebody has chosen silence, ordinary persistence does not earn a fresh reply.
  // A believable apology can still be judged by the model so reconciliation is possible.
  if(s.ignoring){
    if(s.apologizing&&s.severity<2)return{action:'',reason:'apology-after-ignore',state:s};
    if(s.boundaryKind==='hard'){
      if(s.severity>=2||s.level>=2||s.violations>=2)return{action:'block',reason:'continued-after-hard-ignore',state:s};
      return{action:'ignore',reason:'continue-hard-leave-on-read',state:s};
    }
    if(s.boundaryKind==='temporary'){
      if(s.severity>=3||s.level>=4||s.violations>=4)return{action:'block',reason:'extreme-persistence-after-space',state:s};
      return{action:'ignore',reason:'continue-space-leave-on-read',state:s};
    }
    if(s.severity>=3||s.level>=4)return{action:'block',reason:'extreme-persistence-after-ignore',state:s};
    return{action:'ignore',reason:'continue-leave-on-read',state:s};
  }
  if(!s.boundaryKind)return{action:'',reason:'',state:s};
  if(s.apologizing&&s.severity<2)return{action:'',reason:'apology-after-boundary',state:s};
  if(s.boundaryKind==='hard'){
    // After a clear "leave me alone / stop contacting me", sexual pressure or a threat
    // should not require four more warning messages before the contact acts.
    if(s.severity>=2||s.violations>=2)return{action:'block',reason:'hard-boundary-violated',state:s};
    if(s.violations>=1)return{action:'ignore',reason:'hard-boundary-first-violation',state:s};
  }
  if(s.boundaryKind==='temporary'){
    if(s.severity>=3)return{action:'block',reason:'severe-threat-during-space',state:s};
    if(s.violations>=1)return{action:'ignore',reason:'requested-space',state:s};
  }
  return{action:'',reason:'',state:s};
}
function boundaryReplyLevel(replies=[]){
  const text=(replies||[]).filter(x=>x?.type==='text').map(x=>String(x.text||'')).join(' ');
  if(!text)return 0;
  if(/\b(?:i(?:'m| am) (?:going to )?block(?:ing)? you|i(?:'ll| will) block you|report(?:ing)? you|call(?:ing)? the police|harassment|threatening me|don't contact me again|do not contact me again|never contact me again)\b/i.test(text))return 2;
  if(boundaryStatementKind(text))return 1;
  return 0;
}
function boundaryReplyClaimsBlock(replies=[]){
  const text=(replies||[]).filter(x=>x?.type==='text').map(x=>String(x.text||'')).join(' ');
  return /\b(?:i(?:'m| am) (?:going to )?block(?:ing)? you|i(?:'ll| will) block you|i just blocked you|you're blocked|you are blocked)\b/i.test(text);
}

async function generateReply(th,mode='text'){
  const t=timeline(),owner=persona(),contacts=th.contactIds.map(k=>t.contacts[k]).filter(Boolean);if(!contacts.length)return;
  const preBoundary=th.type==='direct'&&mode==='text'?boundaryPreflight(contacts[0],owner,th.messages):{action:'',reason:'',state:null};
  const boundaryQuiet=th.type==='direct'&&(contacts[0]?.ignoringOwner===true||preBoundary.action==='ignore'||preBoundary.action==='block');
  if(th.type==='direct'&&contacts[0]?.blockedByContact)return;
  replyBusy=true;replyHidden=boundaryQuiet;islandText=replyHidden?'':(mode==='call'?'On call…':'Typing…');islandIcon=replyHidden?'':(mode==='call'?'fa-solid fa-phone':'fa-solid fa-ellipsis');render();
  const continuityToRecord=[];let directAction='',directContact=null,boundaryRecord=null,secondaryActions=[],actionParentKey=String(th.messages?.at(-1)?.mirrorId||th.messages?.at(-1)?.id||id());
  try{
    const w=world(),activeCall=mode==='call'&&callId?t.calls.find(x=>x.id===callId):null,conversation=mode==='call'?(activeCall?.transcript||[]):th.messages;let replies=[];
    if(th.type==='direct'){
      const c=contacts[0],latest=conversation.at(-1),requested=mode==='text'&&latest?.requestMedia,voice=textingVoiceEvidence(c,conversation),pendingMedia=requested?recentMediaCommitment(conversation,c.name,requested):'';directContact=c;
      if(mode==='text'&&preBoundary.action){
        directAction=preBoundary.action;
        replies=[];
      }else if(mode==='call'){
        const systemPrompt=`IDENTITY LOCK — authoritative:
You are ${c.name}. You are speaking to ${owner.name}. Never become ${owner.name}, never claim ${owner.name}'s name/identity/history as your own, and never tell ${owner.name} that they are ${c.name}.
Facts under CONTACT are about YOU. Facts under PHONE OWNER are about the other person.

You are ${c.name} on a private phone call inside an ongoing fictional roleplay.
Reply ONLY with what ${c.name} says aloud. No JSON, speaker label, narration or stage directions.
${c.name}'s authoritative stored 9-digit phone number is ${identityForName(c.name,{create:true})?.phoneNumber||'unavailable'}. If directly asked for their own number, use that exact value and never invent another.
Preserve ${c.name}'s actual personality and relationship. Speak like a real person, not a formal assistant or therapist.
Use slang, teasing, profanity, warmth, hesitation, laughter, emojis-as-words only if they genuinely fit ${c.name}; do not force any one style.
Match established conversational rhythm and emotion.
Use Greyhaven Life as authoritative current world/time context when available.`;
        const prompt=`CONTACT — AUTHORITATIVE IDENTITY:
${JSON.stringify({name:c.name,phoneNumber:identityForName(c.name,{create:true})?.phoneNumber||'',character:cardData(c),life:w.people.find(p=>lc(p.name)===lc(c.name))||null})}

CONTACT VOICE EVIDENCE:
${JSON.stringify(voice)}

PHONE OWNER — THE OTHER PERSON:
${JSON.stringify({name:owner.name,relationshipContext:owner.description.slice(0,9000)||'(not found)'})}

GREYHAVEN LIFE:
${JSON.stringify(scopedWorld(w,[c.name,owner.name]))}

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
${c.name}'s authoritative stored 9-digit phone number is ${identityForName(c.name,{create:true})?.phoneNumber||'unavailable'}. ${c.name} knows their own number; if directly asked, use that exact value and never invent another.
Use the CONTACT VOICE EVIDENCE and existing thread as the strongest style reference. Short messages, multiple texts, lowercase, abbreviations, slang, emojis, teasing, dry humor, profanity, typos or expressive punctuation are all allowed when they fit this character. More mature/formal characters may naturally text differently.
Preserve established personality, relationship, knowledge and current mood.
Use Greyhaven Life as authoritative current world/time context when available.
You may reply with text, a fictional photo, a fictional video, or text plus one media item.
A media request is NOT automatic compliance and NOT automatic refusal. Decide from relationship, trust, mood, established boundaries and the conversation.
For close romantic/intimate partners or strongly mutual teasing dynamics, complying is normal when it fits. For strangers/low-trust contacts or mismatched mood, refusal can be completely natural.
If you have ALREADY agreed/offered/promised to send the requested media in the recent thread, do not endlessly stall with "okay I'll send it" over and over. Unless you genuinely change your mind for an in-character reason, follow through when they prompt you again.
If refusing or changing your mind, return TEXT only and make the refusal/delay clear.
If sending media NOW — including if you say "I sent it", "here it is", "I just took it", "fine I'll send it", or similar — you MUST include the actual PHOTO: or VIDEO: line in the SAME response. Never claim an attachment was sent without the media line.
PHOTO:/VIDEO: must contain a concrete visual description of what the recipient sees, never conversational filler like "omg fine I'll send one".

PHONE-INSIDE-PHONE ACTIONS:
If ${c.name} genuinely decides to complete a separate phone action NOW while replying — for example texting/calling another person, forwarding them a photo/video, blocking/unblocking them, saving a number, or mutually exchanging numbers — append a hidden GH_ACTION HTML comment after the visible TEXT/PHOTO/VIDEO protocol.
Supported examples:
<!--GH_ACTION {"type":"message.send","from":"${c.name}","to":"Exact Existing Name","text":"the natural private message","expectsReply":true}-->
<!--GH_ACTION {"type":"media.send","from":"${c.name}","to":"Exact Existing Name","mediaType":"photo","description":"what the recipient sees","caption":"optional caption","expectsReply":true}-->
<!--GH_ACTION {"type":"call.place","from":"${c.name}","to":"Exact Existing Name"}-->
<!--GH_ACTION {"type":"contact.block","from":"${c.name}","to":"Exact Existing Name"}-->
<!--GH_ACTION {"type":"contact.unblock","from":"${c.name}","to":"Exact Existing Name"}-->
<!--GH_ACTION {"type":"contact.add","from":"${c.name}","to":"Exact Existing Name"}-->
<!--GH_ACTION {"type":"contact.exchange","from":"${c.name}","to":"Exact Existing Name"}-->
<!--GH_ACTION {"type":"instagram.follow","from":"${c.name}","to":"Exact Existing Name"}-->
<!--GH_ACTION {"type":"instagram.unfollow","from":"${c.name}","to":"Exact Existing Name"}-->
<!--GH_ACTION {"type":"snapchat.add","from":"${c.name}","to":"Exact Existing Name"}-->
<!--GH_ACTION {"type":"snapchat.accept","from":"${c.name}","to":"Exact Existing Name"}-->
<!--GH_ACTION {"type":"facebook.friend.request","from":"${c.name}","to":"Exact Existing Name"}-->
<!--GH_ACTION {"type":"facebook.friend.accept","from":"${c.name}","to":"Exact Existing Name"}-->
Use only exact known names and never invent/expand a surname. The from field MUST be ${c.name}. Only emit an action after ${c.name} actually agrees and performs it now; requests, promises for later, hesitation and refusal create no marker. Do not force compliance. Keep an exact third-party private message body out of the visible TEXT reply; the hidden marker owns it. Do not generate the third person's response.

SOCIAL BOUNDARIES:
Do not keep a pleasant, cooperative conversation alive merely because a response is expected.
If ${owner.name} is insulting, demeaning, creepy, hostile, or ignores a clearly stated boundary, react the way ${c.name} actually would: anger, sarcasm, swearing, mockery, a blunt warning, silence, or mirroring the disrespect are all allowed when in character.
Distinguish consensual teasing/flirting between close people from genuinely unwelcome behavior.

Silence is a NORMAL character choice. If ${c.name} is genuinely angry with ${owner.name}, has said they need space, is not speaking to them, or has clearly ended the conversation, ACTION: IGNORE can be more realistic than inventing another reply.
Do not repeat the same "leave me alone / stop messaging me" warning four or five times. After a clear boundary, the next pushy/disrespectful message should usually be ACTION: IGNORE. If ${owner.name} keeps contacting ${c.name} after being ignored, or violates the same boundary again, ACTION: BLOCK becomes normal.
A credible threat, forced-entry threat, coercive sexual threat, or severe harassment does NOT require several warnings. ${c.name} may ACTION: BLOCK immediately when that fits the situation.
For ordinary disagreement, one awkward message, or behavior this specific character would genuinely tolerate, do not overreact or block.
If currently ignoring ${owner.name}, the newest message does NOT automatically earn a response: keep ignoring, block, or re-engage only if there is a believable in-character reason such as a real apology or important new information.

Return up to 4 protocol items using ONLY:
TEXT: message text
PHOTO: concise visual description of the photo
VIDEO: concise visual description of the video
ACTION: IGNORE
ACTION: BLOCK
Optional completed GH_ACTION comments may follow those protocol lines.
No JSON, speaker labels, markdown or narration.`;
        const prompt=`CONTACT — AUTHORITATIVE IDENTITY:
${JSON.stringify({name:c.name,phoneNumber:identityForName(c.name,{create:true})?.phoneNumber||'',character:cardData(c),life:w.people.find(p=>lc(p.name)===lc(c.name))||null})}

CONTACT VOICE EVIDENCE:
${JSON.stringify(voice)}

PHONE OWNER — THE OTHER PERSON:
${JSON.stringify({name:owner.name,relationshipContext:owner.description.slice(0,9000)||'(not found)'})}

GREYHAVEN LIFE:
${JSON.stringify(scopedWorld(w,[c.name,owner.name]))}

RECENT MAIN RP:
${recentChat()}

TEXT THREAD:
${JSON.stringify(conversationTail(conversation,28))}

LATEST REQUEST MODE:
${requested?`The latest owner message explicitly requested a ${requested}. Judge it naturally from this exact relationship and mood. If ${c.name} sends it now, an actual ${requested.toUpperCase()}: line is mandatory. If ${c.name} refuses, return TEXT only.`:'No explicit media request.'}
${pendingMedia?`PENDING MEDIA COMMITMENT: ${c.name} recently indicated they would/likely would send this ${requested}: "${pendingMedia}". The owner is prompting again. Avoid repetitive stalling: follow through now if still willing, or clearly change your mind for a believable reason.`:''}

CURRENT BOUNDARY STATE:
${c.ignoringOwner?`${c.name} has been intentionally ignoring ${owner.name} after an earlier boundary problem. The newest message does NOT automatically earn a response. Choose ACTION: IGNORE, ACTION: BLOCK, or genuinely re-engage if it makes sense.`:'Normal — no active ignore state.'}
${preBoundary?.state?.boundaryKind?`Recent explicit boundary: ${preBoundary.state.boundaryKind}. Previous boundary text: "${String(preBoundary.state.boundaryText||'').slice(0,280)}". Continued owner messages after it: ${preBoundary.state.violations}.`:''}

Continue the conversation naturally in ${c.name}'s own texting voice.`;
        let raw=await generate({prompt,systemPrompt,responseLength:760});
        if(replyIdentityConflict(raw,c,owner))raw=await generate({prompt:`${prompt}\n\nIDENTITY CORRECTION: The last draft swapped identities. You are ${c.name}; ${owner.name} is the phone owner. Keep ${c.name}'s own personality and texting style and answer again.`,systemPrompt,responseLength:760});
        let packet=parseDirectPacket(raw,requested||''),items=packet.items;directAction=packet.action||'';secondaryActions=packet.actions||[];
        const hasRequestedMedia=requested&&hasExplicitMediaPacket(items,requested);
        const needsMediaRepair=requested&&!hasRequestedMedia&&!directAction&&!mediaRefusalText(raw)&&(pendingMedia||mediaSendClaim(raw,requested));
        if(needsMediaRepair){
          const repairPrompt=`You are ${c.name}, texting ${owner.name}. Your draft below either says/promises that you are sending a ${requested}, or follows an earlier commitment to send one, but it did not actually attach the media protocol correctly.

DRAFT:
${raw}

RECENT THREAD:
${JSON.stringify(conversationTail(conversation,14))}

Fix ONLY the delivery:
- If ${c.name} is still willing to send it NOW, return optional TEXT: plus a ${requested.toUpperCase()}: line with a concrete visual description of what ${owner.name} sees.
- If ${c.name} genuinely changes their mind or delays it for a believable in-character reason, return TEXT: only and say so clearly.
- Do not stall again with "I'll send it" / "I just sent it" without the ${requested.toUpperCase()}: attachment.
- Preserve ${c.name}'s texting voice and identity.
Return protocol lines only.`;
          raw=await generate({prompt:repairPrompt,systemPrompt:`You are ${c.name}; ${owner.name} is the other person. Preserve character voice. If media is sent, ${requested.toUpperCase()}: is mandatory.`,responseLength:520});
          packet=parseDirectPacket(raw,requested||'');items=packet.items;directAction=packet.action||'';secondaryActions=packet.actions||[];
        }
        if(!items.length&&!directAction&&!secondaryActions.length){raw=await generate({prompt:`Reply as ${c.name} to the latest phone message. You are ${c.name}, not ${owner.name}. Match ${c.name}'s natural texting voice. Return TEXT: followed by the reply, ACTION: IGNORE if ${c.name} chooses silence, or ACTION: BLOCK if ${c.name} is done with unwanted contact.`,systemPrompt:`You are ${c.name}. ${owner.name} is the other person. Never swap identities. Silence and blocking are valid in-character outcomes.`,responseLength:350});packet=parseDirectPacket(raw,requested||'');items=packet.items;directAction=packet.action||'';secondaryActions=packet.actions||[]}
        replies=items.map(x=>({sender:c.name,...x}));
        if(!directAction&&boundaryReplyClaimsBlock(replies))directAction='block';
        if(directAction==='ignore')replies=[];
      }
    }else{
      const systemPrompt=`Simulate the next messages in this fictional group text thread.
Only these contacts may speak: ${contacts.map(c=>c.name).join(', ')}.
Each sender MUST remain themselves. Never make a sender adopt the phone owner's identity or another member's name/history.
Match each person's established personality and their existing texting style. Do not flatten everyone into formal, polite prose. Emojis, slang, abbreviations, teasing and different punctuation are welcome when character-appropriate.
Each contact's provided phoneNumber is authoritative and known to that contact. If directly asked for their own number, use that exact value; never invent another number or surname.
Return 1-4 lines only. Every line MUST use exactly: Sender Name: message
No JSON, markdown or narration.`;
      const prompt=`PHONE OWNER (not an allowed generated speaker unless listed above): ${owner.name}
CONTACT DATA: ${JSON.stringify(contacts.map(c=>({name:c.name,phoneNumber:identityForName(c.name,{create:true})?.phoneNumber||'',character:compactCard(c),voice:textingVoiceEvidence(c,conversation),life:w.people.find(p=>lc(p.name)===lc(c.name))||null})))}
GREYHAVEN LIFE: ${JSON.stringify(scopedWorld(w,[owner.name,...contacts.map(c=>c.name)]))}
THREAD:
${conversation.slice(-28).map(messageContext).join('\n')}
Continue naturally without swapping identities.`;
      replies=parseGroupReply(await generate({prompt,systemPrompt,responseLength:760}),contacts);
    }
    if(!replies.length&&!directAction&&!secondaryActions.length)throw new Error('The model returned no usable phone reply.');
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
      if(target.type==='direct'&&directContact){
        const live=cur.contacts[directContact.id]||Object.values(cur.contacts).find(v=>lc(v.name)===lc(directContact.name));
        if(live){
          const warningLevel=boundaryReplyLevel(replies);
          if(warningLevel)live.boundaryLevel=Math.max(Number(live.boundaryLevel||0),warningLevel);
          if(directAction==='ignore'){
            live.ignoringOwner=true;
            live.boundaryLevel=Math.min(9,Math.max(Number(live.boundaryLevel||0)+1,1));
          }else if(directAction==='block'){
            live.blockedByContact=true;
            live.ignoringOwner=false;
            live.boundaryLevel=Math.min(9,Math.max(Number(live.boundaryLevel||0)+2,3));
            boundaryRecord={action:'block',contact:{...live}};
          }else if(replies.length&&live.ignoringOwner){
            live.ignoringOwner=false;
          }
        }
      }
    },false);
    for(const e of continuityToRecord){if(e.msg)recordMessageContinuity(e.th,e.t,e.msg,e.ownerName);else recordContinuityEvent(e)}
    if(directContact&&secondaryActions.length)dispatchGeneratedPhoneActions(secondaryActions,directContact.name,actionParentKey);
    if(boundaryRecord?.action==='block'&&directContact){
      syncCrossPhoneBlock(directContact.name,directContact.avatar,owner.name,owner.avatar,owner.description,true);
      recordContinuityEvent({kind:'message',participants:[owner.name,directContact.name],sender:directContact.name,summary:`${directContact.name} blocked ${owner.name} after the private phone conversation.`,threadTitle:`Messages with ${directContact.name}`,roleplayMs:now().getTime(),persistent:true});
    }
  }catch(e){console.error(`[${GHP_MODULE}] reply`,e);globalThis.toastr?.error?.(`Phone reply failed: ${e?.message||e}`)}
  finally{replyBusy=false;replyHidden=false;islandText='';islandIcon='';render()}
}
function sendThread(tid,text,mode='text',opts={}){
  text=String(text||'').trim();if((!text&&mode==='text')||replyBusy)return;const owner=persona(),stamp=now().getTime();let th,created=null,callEvent=null,blockedByPeer=false;
  mutate(t=>{
    th=t.threads[tid];if(!th)return;
    const peer=th.type==='direct'?t.contacts[th.contactIds[0]]:null;
    blockedByPeer=!!peer?.blockedByContact;
    if(mode==='call'&&callId){const c=t.calls.find(v=>v.id===callId);if(c&&text&&!blockedByPeer){const entry={sender:owner.name,text,timeMs:stamp,realMs:Date.now()};c.transcript.push(entry);callEvent={kind:'call',participants:[owner.name,c.contactName],sender:owner.name,summary:`${owner.name} said on a phone call: ${text}`,threadTitle:`Call with ${c.contactName}`,roleplayMs:stamp}}return}
    const mirrorId=`mirror:${id()}`,msg=normalizeMessage({id:id(),mirrorId,sender:owner.name,senderId:owner.key,text,timeMs:stamp,realMs:Date.now(),read:true,type:'text',requestMedia:opts.requestMedia||'',deliveryState:blockedByPeer?'not-delivered':'sent'});
    th.messages.push(msg);created={th,t,msg,ownerName:owner.name};
    if(th.type==='direct'&&peer&&!blockedByPeer)mirrorRichMessageToPhone({phoneOwner:peer.name,phoneOwnerAvatar:peer.avatar,peerName:owner.name,peerAvatar:owner.avatar,peerDescription:owner.description,senderName:owner.name,message:msg,unread:true});
  },false);
  if(created&&!blockedByPeer)recordMessageContinuity(created.th,created.t,created.msg,created.ownerName);if(callEvent)recordContinuityEvent(callEvent);
  if(blockedByPeer){render();return}
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
  const p=profile(),installed=Object.entries(p.apps).filter(([k,v])=>v&&k!=='settings'&&APPS[k]).map(([k])=>k),dock=['phone','messages','instagram','snapchat'].filter(k=>p.apps[k]).slice(0,4),grid=installed.filter(k=>!dock.includes(k)),s=stale(),own=persona();
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
  const edited=m.editedAt?'<span class="ghp-edited">Edited</span>':'',delivery=mine&&m.deliveryState==='not-delivered'?'<span class="ghp-not-delivered"><i class="fa-solid fa-circle-exclamation"></i> Not Delivered</span>':'';
  return`<div class="ghp-msg ${mine?'mine':''} ${m.type!=='text'?'has-media':''}" data-thread-id="${esc(th.id)}" data-message-id="${esc(m.id)}" data-message-sender="${esc(m.sender)}">${groupName}${body}${request}<time>${edited}${esc(timeText(new Date(m.timeMs)))}</time>${delivery}</div>`;
}
function renderThread(){
  const t=timeline(),th=t.threads[threadId];if(!th){app='messages';return renderMessages()}markRead(th.id);
  const direct=th.type==='direct',cid=direct?th.contactIds[0]:'',peer=direct?t.contacts[cid]:null,remoteBlocked=!!peer?.blockedByContact;
  const tools=`<span class="ghp-thread-tools">${direct?`<button data-call="${esc(cid)}" ${remoteBlocked?'disabled':''}><i class="fa-solid fa-phone"></i></button>`:''}<button data-thread-menu="${esc(th.id)}"><i class="fa-solid fa-ellipsis"></i></button></span>`;
  const armed=!remoteBlocked&&composeRequest.threadId===th.id&&composeRequest.kind;
  const requestBanner=armed?`<div class="ghp-request-banner"><i class="${armed==='video'?'fa-solid fa-video':'fa-regular fa-image'}"></i><span>Requesting a ${esc(armed)} · send your request next</span><button data-cancel-media-request><i class="fa-solid fa-xmark"></i></button></div>`:'';
  const disabled=replyBusy||remoteBlocked,placeholder=remoteBlocked?'This contact is unavailable':(armed?`Ask for the ${armed}…`:'iMessage');
  return`<div class="ghp-app ghp-thread">${header(threadTitle(th,t),remoteBlocked?'Contact unavailable':(th.type==='group'?`${th.contactIds.length} people`:'iMessage'),tools)}<main>${th.messages.slice(-100).map(m=>renderMessageBubble(m,th)).join('')}${replyBusy&&!replyHidden?'<div class="ghp-typing"><i></i><i></i><i></i></div>':''}</main>${requestBanner}<form data-thread-form="${esc(th.id)}"><button type="button" class="ghp-plus" data-media-menu="${esc(th.id)}" ${disabled?'disabled':''}><i class="fa-solid fa-plus"></i></button><input placeholder="${esc(placeholder)}" ${disabled?'disabled':''}><button ${disabled?'disabled':''}><i class="fa-solid fa-arrow-up"></i></button></form></div>`;
}

function renderPhone(){
  const t=timeline();return`<div class="ghp-app">${header('Phone')}<main>${t.calls.length?t.calls.slice(0,60).map(c=>{const co=t.contacts[c.contactId]||{name:c.contactName};return`<div class="ghp-call-row">${avatarHtml(co)}<button data-call="${esc(c.contactId)}"><b>${esc(c.contactName)}</b><small>${esc(c.status)}</small></button><time>${esc(rel(c.timeMs))}</time></div>`}).join(''):empty('fa-solid fa-phone','No recent calls','Calls in this timeline will appear here.')}</main></div>`;
}
function renderCall(){
  const t=timeline(),c=t.calls.find(x=>x.id===callId);if(!c){app='phone';return renderPhone()}const co=t.contacts[c.contactId]||{name:c.contactName},th=directThread(c.contactId);
  return`<div class="ghp-call-screen">${statusBar()}<section>${avatarHtml(co,'huge')}<h1>${esc(co.nickname||co.name)}</h1><small>${c.status==='active'?'call in progress':esc(c.status)}</small></section><main>${(c.transcript||[]).slice(-30).map(x=>`<div class="${x.sender===persona().name?'mine':''}"><b>${esc(x.sender)}</b><span>${esc(x.text)}</span></div>`).join('')}${replyBusy?'<div class="ghp-typing"><i></i><i></i><i></i></div>':''}</main><div class="ghp-call-actions"><button><i class="fa-solid fa-microphone-slash"></i><small>mute</small></button><button><i class="fa-solid fa-volume-high"></i><small>speaker</small></button><button data-end-call><i class="fa-solid fa-phone-slash"></i><small>end</small></button></div><form data-call-form="${esc(th?.id||'')}"><input placeholder="Say something…" ${replyBusy?'disabled':''}><button ${replyBusy?'disabled':''}><i class="fa-solid fa-arrow-up"></i></button></form></div>`;
}
function renderContacts(){
  const t=timeline(),cs=t.contactOrder.map(k=>t.contacts[k]).filter(c=>c?.saved).sort((a,b)=>Number(b.favorite)-Number(a.favorite)||a.name.localeCompare(b.name)),removed=t.suppressedContacts?.length||0;
  return`<div class="ghp-app">${header('Contacts','','<button data-add-contact><i class="fa-solid fa-plus"></i></button>')}<main>${cs.length?cs.map(c=>`<button class="ghp-row" data-contact="${esc(c.id)}">${avatarHtml(c)}<span><b>${esc(c.nickname||c.name)}</b><small>${c.favorite?'★ Favorite · ':''}${esc(c.phoneNumber||'Number unavailable')}</small></span><em><i class="fa-solid fa-chevron-right"></i></em></button>`).join(''):empty('fa-solid fa-address-book','No saved contacts','Tap + and enter an exact 9-digit phone number.')}${removed?`<button class="ghp-removed-row" data-removed-contacts><i class="fa-solid fa-user-slash"></i><span><b>Removed Contacts</b><small>${removed} removed from this phone</small></span><i class="fa-solid fa-chevron-right"></i></button>`:''}</main></div>`;
}
function renderContact(){
  const c=contact(contactId);if(!c){app='contacts';return renderContacts()}let l=null;try{l=globalThis.GreyhavenLife?.getPerson?.(c.name)}catch{}const loc=l?.resolved?[l.resolved.location,l.resolved.area].filter(Boolean).join(' · '):'';
  return`<div class="ghp-app">${header(c.nickname||c.name)}<main class="ghp-contact-card">${avatarHtml(c,'hero')}<h1>${esc(c.nickname||c.name)}</h1>${c.nickname?`<small>${esc(c.name)}</small>`:''}<div class="ghp-contact-number">${esc(c.phoneNumber||'Number unavailable')}</div>${c.blockedByContact?`<div class="ghp-remote-blocked"><i class="fa-solid fa-user-slash"></i><span><b>Contact unavailable</b><small>Messages and calls are not being delivered.</small></span></div>`:''}<div class="ghp-contact-actions"><button data-message-contact="${esc(c.id)}"><i class="fa-solid fa-comment"></i><span>message</span></button><button data-call="${esc(c.id)}" ${c.blockedByContact?'disabled':''}><i class="fa-solid fa-phone"></i><span>call</span></button></div>${loc?`<div class="ghp-life-link"><i class="fa-solid fa-location-dot"></i><span><b>Greyhaven Life</b><small>${esc(loc)}</small></span></div>`:''}<div class="ghp-settings-list"><label><span><b>Nickname</b><small>Phone-only display name</small></span><input data-nickname="${esc(c.id)}" value="${esc(c.nickname||'')}"></label><label><span><b>Favorite</b></span><input type="checkbox" data-favorite="${esc(c.id)}" ${c.favorite?'checked':''}></label><label><span><b>Mute notifications</b></span><input type="checkbox" data-muted="${esc(c.id)}" ${c.muted?'checked':''}></label><label><span><b>Location sharing</b></span><select data-location-sharing="${esc(c.id)}"><option value="precise" ${c.locationSharing==='precise'?'selected':''}>Precise</option><option value="approximate" ${c.locationSharing==='approximate'?'selected':''}>Approximate</option><option value="off" ${c.locationSharing==='off'?'selected':''}>Off</option></select></label><label><span><b>Blocked in Messages/Phone</b></span><input type="checkbox" data-blocked="${esc(c.id)}" ${c.blocked?'checked':''}></label></div><button class="ghp-contact-remove" data-remove-contact="${esc(c.id)}"><i class="fa-solid fa-user-minus"></i> Remove Contact</button><small class="ghp-contact-remove-note">This does not change Instagram, Snapchat or Facebook relationships.</small></main></div>`;
}

function identityDirectory({includeProvisional=false}={}){
  ensureAllIdentities();const own=currentIdentity();return Object.values(settingsRoot().identities||{}).map(x=>normalizeIdentity(x,x.id)).filter(x=>x.id!==own?.id&&(includeProvisional||x.kind!=='provisional')).sort((a,b)=>a.name.localeCompare(b.name));
}
function socialTabs(appName,tabs,current){
  return`<nav class="ghp-social-tabs" style="--ghp-tabs:${tabs.length}">${tabs.map(([key,iconClass,label])=>`<button data-app-view="${esc(key)}" class="${current===key?'active':''}" aria-label="${esc(label)}"><i class="${iconClass}"></i><small>${esc(label)}</small></button>`).join('')}</nav>`;
}
function socialIdentity(identityId,name='',avatar=''){
  return identityById(identityId)||identityForName(name,{create:false})||{id:identityId||'',name:norm(name)||'Unknown',avatar};
}
function socialMediaCard(row,label='Photo'){
  const type=row.type==='video'?'video':'photo',key=String(row.mediaKey||''),width=Math.max(0,Number(row.mediaWidth||0)),height=Math.max(0,Number(row.mediaHeight||0)),dimensions=width&&height?` width="${width}" height="${height}" style="aspect-ratio:${width}/${height}"`:'';
  if(key)return type==='video'?`<video class="ghp-social-media" data-media-key="${esc(key)}"${dimensions} controls playsinline preload="metadata"></video>`:`<img class="ghp-social-media" data-media-key="${esc(key)}"${dimensions} alt="${esc(row.visual||row.mediaDescription||label)}">`;
  return`<div class="ghp-fake-photo"><i class="${type==='video'?'fa-solid fa-video':'fa-regular fa-image'}"></i><p>${esc(row.visual||row.mediaDescription||label)}</p></div>`;
}
function appThreadRows(appName){
  const store=appStore(timeline(),appName),rows=store.threadOrder.map(key=>store.threads[key]).filter(Boolean).sort((a,b)=>Number(b.messages.at(-1)?.timeMs||b.createdAt)-Number(a.messages.at(-1)?.timeMs||a.createdAt));
  return rows.length?rows.map(th=>{const peer=appPeer(th)||{name:th.peerName,avatar:th.peerAvatar},last=th.messages.at(-1),unreadCount=th.messages.filter(m=>lc(m.sender)!==lc(persona().name)&&!m.read).length,streak=appName==='snapchat'?snapStreak(th):0;return`<button class="ghp-row" data-open-social-thread="${esc(appName)}" data-social-thread="${esc(th.id)}">${avatarHtml(peer)}<span><b>${esc(peer.name)}${streak?` <em class="ghp-streak">🔥 ${streak}</em>`:''}</b><small>${last?esc(messagePreview(last)):'Start a conversation'}</small></span><em><time>${last?esc(rel(last.timeMs)):''}</time>${unreadCount?`<i>${unreadCount}</i>`:''}</em></button>`}).join(''):empty('fa-regular fa-comments','No conversations yet',`${APPS[appName].label} chats stay separate from iMessage.`);
}
function renderAppThread(appName){
  const t=timeline(),th=appThread(appName,itemId,t);if(!th){appView=appName==='instagram'?'dms':appName==='facebook'?'messenger':appName==='onlyfans'||appName==='darkweb'?'messages':'chats';itemId='';return appName==='instagram'?renderInstagram():appName==='facebook'?renderFacebook():appName==='onlyfans'?renderOnlyFans():appName==='darkweb'?renderDarkWeb():renderSnapchat()}
  const peer=appPeer(th)||{name:th.peerName,avatar:th.peerAvatar},blocked=socialActionBlocked(t,peer,appName);for(const m of th.messages)if(lc(m.sender)!==lc(persona().name))m.read=true;for(const n of t.notifications)if(n.app===appName&&n.targetId===th.id)n.read=true;persist(t,false);
  const bubbles=th.messages.slice(-100).map(m=>{
    const mine=lc(m.sender)===lc(persona().name),media=['photo','video'].includes(m.type),closed=appName==='snapchat'&&media&&!mine&&!m.opened,edited=m.editedAt?'<span class="ghp-edited">Edited</span>':'';
    const content=closed?`<button class="ghp-unopened-snap" data-open-snap-thread="${esc(th.id)}" data-open-snap-message="${esc(m.id)}"><i class="${m.type==='video'?'fa-solid fa-video':'fa-solid fa-square'}"></i><span>Tap to view ${m.type==='video'?'video':'photo'} Snap</span></button>`:media?`${socialMediaCard(m,m.type)}${m.text?`<p class="ghp-media-caption">${esc(m.text)}</p>`:''}<button class="ghp-save-snap" data-app-link-media="${esc(appName)}" data-app-link-thread="${esc(th.id)}" data-app-link-message="${esc(m.id)}"><i class="fa-solid ${m.mediaKey?'fa-pen':'fa-paperclip'}"></i> ${m.mediaKey?'Replace':'Attach'} local preview</button>${appName==='snapchat'?`<button class="ghp-save-snap" data-save-snap-thread="${esc(th.id)}" data-save-snap-message="${esc(m.id)}"><i class="fa-regular fa-bookmark"></i> Save to Memories</button>`:''}`:`<p>${esc(m.text)}</p>`;
    return`<div class="ghp-msg ${mine?'mine':''} ${media?'has-media':''}" data-message-app="${esc(appName)}" data-thread-id="${esc(th.id)}" data-message-id="${esc(m.id)}" data-message-sender="${esc(m.sender)}">${content}<time>${edited}${esc(timeText(new Date(m.timeMs)))}</time></div>`;
  }).join('');
  const subtitle=appName==='instagram'?'Instagram DM':appName==='facebook'?'Messenger':appName==='snapchat'?'Snapchat Chat':appName==='onlyfans'?'OnlyFans Messages':'Encrypted chat',video=appName==='onlyfans'&&(onlyFansAccount(peer,false)||onlyFansAccount(currentIdentity(),false))?`<button data-onlyfans-video="${esc(peer.id)}" title="${th.videoActive?'Open':'Start'} video call"><i class="fa-solid fa-video"></i></button>`:'';
  return`<div class="ghp-app ghp-thread ghp-social-thread ghp-${esc(appName)}-thread">${header(peer.name,blocked?'Blocked in this app':subtitle,`<span class="ghp-thread-tools">${video}<button data-social-thread-menu="${esc(appName)}" data-social-thread-id="${esc(th.id)}"><i class="fa-solid fa-ellipsis"></i></button></span>`)}<main>${bubbles}${appReplyBusy?'<div class="ghp-typing"><i></i><i></i><i></i></div>':''}</main><form data-app-thread-form="${esc(appName)}" data-app-thread-id="${esc(th.id)}"><button type="button" class="ghp-plus" data-app-media="${esc(appName)}" data-app-media-thread="${esc(th.id)}" ${blocked||appReplyBusy?'disabled':''}><i class="fa-solid fa-plus"></i></button><input placeholder="${blocked?'Unavailable':'Message…'}" ${blocked||appReplyBusy?'disabled':''}><button ${blocked||appReplyBusy?'disabled':''}><i class="fa-solid fa-arrow-up"></i></button></form></div>`;
}
function renderInstagram(){
  const t=timeline(),view=appView||'feed',own=currentIdentity(),store=t.instagram,counts=socialCounts(t,own);
  if(view==='thread')return renderAppThread('instagram');
  if(view==='story'){
    const s=store.stories.find(x=>x.id===itemId);if(!s){appView='feed';itemId='';return renderInstagram()}s.viewed=true;persist(t,false);const who=socialIdentity(s.identityId,s.author);return`<div class="ghp-story-view"><div class="ghp-progress"><i></i></div><header>${avatarHtml(who,'small')}<b>${esc(who.name)}</b><time>${esc(rel(s.timeMs))}</time><button data-app-view="feed"><i class="fa-solid fa-xmark"></i></button></header><main>${socialMediaCard(s,'Instagram Story')}</main><footer>${esc(s.caption||'')}</footer></div>`;
  }
  const tabs=[['feed','fa-solid fa-house','Feed'],['people','fa-solid fa-user-group','People'],['dms','fa-regular fa-paper-plane','DMs'],['notifications','fa-regular fa-heart','Activity'],['profile','fa-regular fa-user','Profile']];let body='';
  if(view==='feed'){
    const stories=store.stories.filter(x=>Number(x.expiresAt||0)>now().getTime()).slice(0,24);
    body=`<div class="ghp-stories"><button data-instagram-create-story><span>${avatarHtml(own)}</span><small>Your story +</small></button>${stories.map(s=>{const who=socialIdentity(s.identityId,s.author);return`<button data-instagram-story="${esc(s.id)}" class="${s.viewed?'viewed':''}"><span>${avatarHtml(who)}</span><small>${esc(who.name)}</small></button>`}).join('')}</div><div class="ghp-feed">${store.posts.length?store.posts.slice(0,50).map(p=>{const who=socialIdentity(p.identityId,p.author,persona().avatar),comments=Array.isArray(p.comments)?p.comments:[],liked=Array.isArray(p.likedBy)&&p.likedBy.includes(own.id);return`<article><header>${avatarHtml(who,'small')}<span><b>${esc(who.name)}</b><small>${esc(rel(p.timeMs))}</small></span></header>${socialMediaCard(p,'Instagram post')}<div class="ghp-social-icons"><button data-instagram-like="${esc(p.id)}"><i class="${liked?'fa-solid':'fa-regular'} fa-heart"></i></button><button data-instagram-comment="${esc(p.id)}"><i class="fa-regular fa-comment"></i></button><button data-open-social-thread="instagram" data-social-identity="${esc(who.id)}"><i class="fa-regular fa-paper-plane"></i></button></div><b>${Number(p.likes||0).toLocaleString()} likes</b><p><strong>${esc(who.name)}</strong> ${esc(p.caption||'')}</p>${comments.slice(-3).map(c=>`<p class="ghp-comment"><strong>${esc(c.author||'Someone')}</strong> ${esc(c.text||c)}</p>`).join('')}<small>${Number(p.commentCount||comments.length).toLocaleString()} comments</small></article>`}).join(''):empty('fa-brands fa-instagram','Your feed is quiet','Follow people or use Refresh Phone for natural activity.')}</div>`;
  }else if(view==='people'){
    const rows=identityDirectory().map(who=>({who,state:appRelationship(t,who,'instagram',false)})),mode=itemId,filtered=rows.filter(x=>x.state&&(mode==='followers'?x.state.followedBy:mode==='following'?x.state.following:(x.state.following||x.state.followedBy))),anonymous=mode==='followers'?counts.instagram.anonymousFollowers:mode==='following'?counts.instagram.anonymousFollowing:0;
    body=`<div class="ghp-social-section"><button class="ghp-wide-action" data-find-social="instagram"><i class="fa-solid fa-magnifying-glass"></i> Find an exact character</button><h3>${mode==='followers'?'Followers':mode==='following'?'Following':'Instagram relationships'}</h3>${filtered.map(({who,state})=>{const relationButton=mode==='followers'&&state.followedBy?`<button class="ghp-social-remove" data-instagram-remove-follower="${esc(who.id)}">Remove</button>`:`<button data-instagram-follow="${esc(who.id)}">${state.following?'Unfollow':'Follow'}</button>`;return`<div class="ghp-row static">${avatarHtml(who)}<span><b>${esc(who.name)}</b><small>${state.following?'Following':''}${state.following&&state.followedBy?' · ':''}${state.followedBy?'Follows you':''}</small></span>${relationButton}<button data-open-social-thread="instagram" data-social-identity="${esc(who.id)}"><i class="fa-regular fa-paper-plane"></i></button></div>`}).join('')}${anonymous?`<div class="ghp-social-more"><i class="fa-solid fa-users"></i><span><b>${anonymous.toLocaleString()} more</b><small>Other Greyhaven accounts</small></span></div>`:''}${!filtered.length&&!anonymous?empty('fa-solid fa-user-plus','No connections yet','Following someone does not make them follow back.'):''}</div>`;
  }else if(view==='dms')body=appThreadRows('instagram');
  else if(view==='notifications')body=`<div class="ghp-social-section">${t.notifications.filter(n=>n.app==='instagram').slice(0,60).map(n=>`<button class="ghp-notification-row ${n.read?'':'unread'}" data-notif="${esc(n.id)}"><i class="fa-brands fa-instagram"></i><span><b>${esc(n.title)}</b><small>${esc(n.text)}</small></span><time>${esc(rel(n.timeMs))}</time></button>`).join('')||empty('fa-regular fa-heart','No activity yet','Follows, likes, comments, story views and DMs appear here.')}</div>`;
  else{
    body=`<section class="ghp-social-profile">${avatarHtml(own,'hero')}<h2>${esc(own.name)}</h2><div><button data-instagram-people="followers"><b>${counts.instagram.followers.toLocaleString()}</b><small>followers</small></button><button data-instagram-people="following"><b>${counts.instagram.following.toLocaleString()}</b><small>following</small></button><span><b>${store.posts.filter(p=>p.ownerPost||p.identityId===own.id).length}</b><small>posts</small></span></div><p>Public account totals persist globally. Named relationships can still change independently inside this phone world.</p></section>`;
  }
  return`<div class="ghp-app ghp-social-app ghp-instagram">${header('Instagram','',view==='feed'?'<button data-new-instagram-post><i class="fa-solid fa-plus"></i></button>':'')}<main>${body}</main>${socialTabs('instagram',tabs,view)}</div>`;
}
function snapStreak(th){
  const byDay=new Map();for(const m of th?.messages||[]){if(!['photo','video'].includes(m.type))continue;const day=new Date(m.timeMs).toISOString().slice(0,10),set=byDay.get(day)||new Set();set.add(lc(m.sender));byDay.set(day,set)}const mutual=[...byDay.entries()].filter(([,set])=>set.size>1).map(([day])=>day).sort().reverse();if(!mutual.length)return 0;let count=1,cursor=new Date(`${mutual[0]}T12:00:00Z`);for(let i=1;i<mutual.length;i++){cursor.setUTCDate(cursor.getUTCDate()-1);if(mutual[i]!==cursor.toISOString().slice(0,10))break;count++}return count;
}
function renderSnapMap(){
  const t=timeline(),rows=[];for(const [identityId,reln] of Object.entries(t.relationships)){if(!reln.apps?.snapchat?.friends||reln.apps.snapchat.blocked||reln.apps.snapchat.blockedBy||reln.apps.snapchat.mapSharing==='off')continue;const who=identityById(identityId);if(!who)continue;let person=null;try{person=globalThis.GreyhavenLife?.getPerson?.(who.name)||null}catch{}const resolved=person?.resolved||null,place=resolved?.location||'',area=resolved?.area||'';if(!place&&!area)continue;const display=reln.apps.snapchat.mapSharing==='approximate'?(area||place):[place,area].filter(Boolean).join(' · ');rows.push({who,person,display})}
  return`<div class="ghp-map">${rows.length?rows.map(x=>`<div>${avatarHtml(x.who)}<span><b>${esc(x.who.name)}</b><small>${esc(x.display)}</small>${x.person?.resolved?.status?`<em>${esc(x.person.resolved.status)}</em>`:''}</span><i class="${x.person?.present?'here':''}">${x.person?.present?'Here':'Off-screen'}</i></div>`).join(''):empty('fa-solid fa-location-dot','No evidenced locations','Only Snapchat friends with their own Greyhaven Life location evidence appear here.')}</div>`;
}
function renderSnapchat(){
  const t=timeline(),view=appView||'camera',store=t.snapchat,counts=socialCounts(t,currentIdentity());
  if(view==='thread')return renderAppThread('snapchat');
  if(view==='story'){
    const s=store.stories.find(x=>x.id===itemId);if(!s){appView='stories';itemId='';return renderSnapchat()}s.viewed=true;persist(t,false);const who=socialIdentity(s.identityId,s.author);return`<div class="ghp-story-view ghp-snap-story"><div class="ghp-progress"><i></i></div><header>${avatarHtml(who,'small')}<b>${esc(who.name)}</b><time>${esc(rel(s.timeMs))}</time><button data-app-view="stories"><i class="fa-solid fa-xmark"></i></button></header><main>${socialMediaCard(s,'Snap')}</main><footer>${esc(s.caption||'')}</footer></div>`;
  }
  const tabs=[['camera','fa-solid fa-camera','Camera'],['chats','fa-solid fa-comment','Chats'],['stories','fa-solid fa-play','Stories'],['map','fa-solid fa-location-dot','Map'],['memories','fa-solid fa-images','Memories']];let body='';
  if(view==='camera')body=`<section class="ghp-snap-camera"><i class="fa-solid fa-camera"></i><h2>Send a Snap</h2><p>Describe a photo or video for the recipient AI. A local upload can replace the placeholder visually.</p><button type="button" class="ghp-snap-shutter" data-compose-snap aria-label="Open Send a Snap"><span></span></button></section>`;
  else if(view==='chats')body=`<div class="ghp-social-count-strip"><b>${counts.snapchat.friends.toLocaleString()}</b><span>Snapchat friends</span></div>${appThreadRows('snapchat')}`;
  else if(view==='stories')body=`<div class="ghp-stories"><button data-snap-create-story><span>${avatarHtml(currentIdentity())}</span><small>Your story +</small></button>${store.stories.filter(x=>Number(x.expiresAt||0)>now().getTime()).map(s=>{const who=socialIdentity(s.identityId,s.author);return`<button data-snap-story="${esc(s.id)}" class="${s.viewed?'viewed':''}"><span>${avatarHtml(who)}</span><small>${esc(who.name)}</small></button>`}).join('')}</div>${store.stories.length?'':empty('fa-solid fa-play','No active Stories','Stories expire after 24 hours.')}`;
  else if(view==='map')body=renderSnapMap();
  else if(view==='add'){
    const rows=identityDirectory({includeProvisional:true}).map(who=>({who,state:appRelationship(t,who,'snapchat',false)}));body=`<div class="ghp-social-section"><div class="ghp-social-count-strip"><b>${counts.snapchat.friends.toLocaleString()}</b><span>friends · including ${counts.snapchat.anonymousFriends.toLocaleString()} other accounts</span></div><button class="ghp-wide-action" data-find-social="snapchat"><i class="fa-solid fa-magnifying-glass"></i> Find an exact character</button>${rows.filter(x=>x.state&&(x.state.friends||x.state.outgoingRequest||x.state.incomingRequest)).map(({who,state})=>`<div class="ghp-row static">${avatarHtml(who)}<span><b>${esc(who.name)}</b><small>${state.friends?'Friends':state.incomingRequest?'Added you':state.outgoingRequest?'Pending':'Not friends'}</small></span>${state.incomingRequest?`<button data-snap-accept="${esc(who.id)}">Accept</button><button data-snap-decline="${esc(who.id)}">Ignore</button>`:state.friends?`<button data-open-social-thread="snapchat" data-social-identity="${esc(who.id)}"><i class="fa-solid fa-comment"></i></button><button class="ghp-social-remove" data-snap-remove="${esc(who.id)}">Remove</button>`:`<button data-snap-add="${esc(who.id)}" ${state.outgoingRequest?'disabled':''}>${state.outgoingRequest?'Pending':'Add'}</button>`}</div>`).join('')||empty('fa-solid fa-user-plus','No friend activity','Adding someone is one-sided until they add you back.')}</div>`;
  }else{
    const eyes=appView==='eyes',items=eyes?store.eyesOnly:store.memories;body=`<div class="ghp-memory-switch"><button data-app-view="memories" class="${!eyes?'active':''}">Memories</button><button data-app-view="eyes" class="${eyes?'active':''}"><i class="fa-solid fa-lock"></i> My Eyes Only</button></div><button class="ghp-wide-action" data-upload-private="${eyes?'eyes':'memories'}"><i class="fa-solid fa-plus"></i> Add saved media</button><div class="ghp-memory-grid">${items.map(m=>`<article>${socialMediaCard(m,m.type==='video'?'Video':'Photo')}<p>${esc(m.caption||m.mediaDescription||m.visual||'Saved Snap')}</p><small>${esc(rel(m.timeMs))}</small><div><button data-send-saved-snap="${esc(m.id)}" data-saved-section="${eyes?'eyesOnly':'memories'}"><i class="fa-solid fa-paper-plane"></i></button>${eyes?'':`<button data-move-snap-eyes="${esc(m.id)}"><i class="fa-solid fa-lock"></i></button>`}<button data-delete-saved-snap="${esc(m.id)}" data-saved-section="${eyes?'eyesOnly':'memories'}"><i class="fa-solid fa-trash"></i></button></div></article>`).join('')||empty('fa-regular fa-images',eyes?'My Eyes Only is empty':'No Memories yet',eyes?'Private saved media stays in this section.':'Open a Snap and save it, or add media manually.')}</div>`;
  }
  return`<div class="ghp-app ghp-social-app ghp-snapchat">${header('Snapchat',view==='map'?'Greyhaven Life evidence only':'',view==='chats'?'<button data-app-view="add"><i class="fa-solid fa-user-plus"></i></button>':'')}<main>${body}</main>${socialTabs('snapchat',tabs,view)}</div>`;
}
function renderFacebook(){
  const t=timeline(),view=appView||'feed',store=t.facebook,market=sharedMarketplace(),own=currentIdentity(),counts=socialCounts(t,own);
  if(view==='thread')return renderAppThread('facebook');
  if(view==='listing'){
    const row=market.listings.find(x=>x.id===itemId);if(!row){appView='marketplace';itemId='';return renderFacebook()}const seller=identityById(row.sellerIdentityId)||{id:row.sellerIdentityId,name:row.sellerName},mine=row.sellerIdentityId===own.id;return`<div class="ghp-app ghp-social-app ghp-facebook">${header(row.title,'Marketplace')}<main class="ghp-market-detail">${socialMediaCard(row,'Marketplace listing')}<h2>${esc(row.title)}</h2><h3>${esc(row.price)}</h3><p>${esc(row.description||'')}</p><small><i class="fa-solid fa-location-dot"></i> ${esc(row.area||'Area not specified')}</small><div class="ghp-market-seller">${avatarHtml(seller)}<span><b>${esc(seller.name)}</b><small>${mine?'Your listing':row.sellerType==='provisional'?'Provisional Marketplace identity':'Existing Greyhaven identity'}${row.inquiries?.length?` · ${row.inquiries.length} interested`:''}</small></span></div>${mine?'<div class="ghp-market-owner-note"><i class="fa-solid fa-inbox"></i> Interested buyers will appear in Messenger after a Marketplace refresh.</div><div class="ghp-market-owner-actions"><button data-market-mark-sold><i class="fa-solid fa-circle-check"></i> Mark as sold</button><button data-market-remove-listing><i class="fa-solid fa-trash"></i> Remove listing</button></div>':`<button class="ghp-wide-action primary" data-market-message="${esc(row.id)}"><i class="fa-brands fa-facebook-messenger"></i> Message seller</button><div class="ghp-market-actions"><button data-market-action="question" data-market-action-listing="${esc(row.id)}">Ask</button><button data-market-action="offer" data-market-action-listing="${esc(row.id)}">Make offer</button><button data-market-action="buy" data-market-action-listing="${esc(row.id)}">Buy</button><button data-market-action="pickup" data-market-action-listing="${esc(row.id)}">Pickup</button></div>`}${row.sellerType==='provisional'?`<button class="ghp-wide-action" data-market-link="${esc(row.id)}"><i class="fa-solid fa-link"></i> Manually link to a character</button><small class="ghp-muted">Never linked automatically by matching a name.</small>`:''}</main></div>`;
  }
  const tabs=[['feed','fa-solid fa-house','Feed'],['friends','fa-solid fa-user-group','Friends'],['messenger','fa-brands fa-facebook-messenger','Messenger'],['marketplace','fa-solid fa-store','Marketplace'],['notifications','fa-solid fa-bell','Alerts']];let body='';
  if(view==='feed')body=`<div class="ghp-feed">${store.posts.length?store.posts.map(p=>{const who=socialIdentity(p.identityId,p.author),comments=Array.isArray(p.comments)?p.comments:[],liked=Array.isArray(p.likedBy)&&p.likedBy.includes(own.id);return`<article><header>${avatarHtml(who,'small')}<span><b>${esc(who.name)}</b><small>${esc(rel(p.timeMs))}</small></span></header><p>${esc(p.text||'')}</p>${p.visual?socialMediaCard(p,'Facebook post'):''}<small>${Number(p.likes||0).toLocaleString()} likes · ${Number(p.commentCount||comments.length).toLocaleString()} comments</small>${comments.slice(-3).map(c=>`<p class="ghp-comment"><strong>${esc(c.author||'Someone')}</strong> ${esc(c.text||c)}</p>`).join('')}<div class="ghp-social-icons"><button data-facebook-like="${esc(p.id)}"><i class="${liked?'fa-solid':'fa-regular'} fa-thumbs-up"></i> Like</button><button data-facebook-comment="${esc(p.id)}"><i class="fa-regular fa-comment"></i> Comment</button></div></article>`}).join(''):empty('fa-brands fa-facebook','Your Feed is quiet','Friends and Refresh Phone can add natural activity.')}</div>`;
  else if(view==='friends'){
    const rows=identityDirectory().map(who=>({who,state:appRelationship(t,who,'facebook',false)}));body=`<div class="ghp-social-section"><button class="ghp-wide-action" data-find-social="facebook"><i class="fa-solid fa-user-plus"></i> Find an exact character</button><h3>Friend requests</h3>${rows.filter(x=>x.state?.incomingRequest).map(({who})=>`<div class="ghp-row static">${avatarHtml(who)}<span><b>${esc(who.name)}</b><small>Sent you a request</small></span><button data-facebook-accept="${esc(who.id)}">Accept</button><button data-facebook-decline="${esc(who.id)}">Delete</button></div>`).join('')||'<small class="ghp-muted">No incoming requests.</small>'}<h3>Friends & pending</h3>${rows.filter(x=>x.state&&(x.state.friends||x.state.outgoingRequest)).map(({who,state})=>`<div class="ghp-row static">${avatarHtml(who)}<span><b>${esc(who.name)}</b><small>${state.friends?'Friends':'Request pending'}</small></span>${state.friends?`<button data-open-social-thread="facebook" data-social-identity="${esc(who.id)}"><i class="fa-brands fa-facebook-messenger"></i></button>`:''}</div>`).join('')||'<small class="ghp-muted">No friends or sent requests yet.</small>'}</div>`;
  }else if(view==='messenger')body=appThreadRows('facebook');
  else if(view==='marketplace')body=`<div class="ghp-market-tools"><button data-marketplace-refresh ${marketplaceRefreshBusy?'disabled':''}><i class="fa-solid fa-rotate"></i><span><b>${marketplaceRefreshBusy?'Refreshing…':'Refresh listings'}</b><small>Shared inventory · ${market.listings.length}/${MAX_MARKETPLACE_LISTINGS}</small></span></button><button data-new-market-listing><i class="fa-solid fa-tag"></i><span><b>Sell an item</b><small>Create your own listing</small></span></button></div><div class="ghp-market-grid">${market.listings.map(row=>`<button data-market-listing="${esc(row.id)}">${socialMediaCard(row,'Listing')}<b>${esc(row.price)}</b><span>${esc(row.title)}</span><small>${esc(row.area||row.sellerName)}${row.sellerIdentityId===own.id?' · Your listing':''}</small></button>`).join('')||empty('fa-solid fa-store','No listings yet','Tap Refresh listings to add a shared Marketplace batch visible from every persona phone.')}</div>`;
  else if(view==='notifications')body=t.notifications.filter(n=>n.app==='facebook').map(n=>`<button class="ghp-notification-row ${n.read?'':'unread'}" data-notif="${esc(n.id)}"><i class="fa-brands fa-facebook-f"></i><span><b>${esc(n.title)}</b><small>${esc(n.text)}</small></span><time>${esc(rel(n.timeMs))}</time></button>`).join('')||empty('fa-regular fa-bell','No notifications','Friend requests, Messenger and Marketplace activity appears here.');
  else body=`<section class="ghp-social-profile">${avatarHtml(own,'hero')}<h2>${esc(own.name)}</h2><div><span><b>${counts.facebook.friends.toLocaleString()}</b><small>friends</small></span><span><b>${store.posts.filter(p=>p.ownerPost||p.identityId===own.id).length}</b><small>posts</small></span></div><p>The public friend total persists globally. Named Facebook relationships remain editable in this phone world.</p></section>`;
  const right=`<span class="ghp-header-actions">${view==='feed'?'<button data-new-facebook-post><i class="fa-solid fa-plus"></i></button>':''}${view==='marketplace'?'<button data-new-market-listing title="Sell an item"><i class="fa-solid fa-tag"></i></button><button data-marketplace-refresh title="Refresh Marketplace"><i class="fa-solid fa-rotate"></i></button>':''}<button data-app-view="profile"><i class="fa-regular fa-user"></i></button></span>`;return`<div class="ghp-app ghp-social-app ghp-facebook">${header('Facebook','',right)}<main>${body}</main>${socialTabs('facebook',tabs,view)}</div>`;
}
function serviceStatus(value){return String(value||'').replaceAll('_',' ').replace(/\b\w/g,ch=>ch.toUpperCase())}
function renderDominos(){
  const t=timeline(),view=appView||'menu',cart=dominosCart(t),cartCount=cart.reduce((sum,x)=>sum+x.quantity,0),cartTotal=cart.reduce((sum,x)=>sum+x.lineTotal,0),identity=currentIdentity(),roles=globalAppRoles(),worker=identityById(roles.dominos.deliveryWorkerId),orders=sharedServices().dominos.orders.filter(x=>x.customerIdentityId===identity.id||x.driverIdentityId===identity.id),tabs=[['menu','fa-solid fa-pizza-slice','Menu'],['cart','fa-solid fa-bag-shopping','Cart'],['orders','fa-solid fa-receipt','Orders'],['settings','fa-solid fa-gear','Role']];let body='';
  if(view==='menu'){const categories=[...new Set(DOMINOS_MENU.map(x=>x.category))],selected=itemId&&categories.includes(itemId)?itemId:'Pizza',items=DOMINOS_MENU.filter(x=>x.category===selected);body=`<div class="ghp-category-pills">${categories.map(x=>`<button data-dominos-category="${esc(x)}" class="${x===selected?'active':''}">${esc(x)}</button>`).join('')}</div><div class="ghp-menu-grid">${items.map(x=>`<article><i class="${x.icon}"></i><span><b>${esc(x.name)}</b><small>${esc(x.description)}</small></span><strong>${esc(euro(x.price))}</strong><button data-dominos-add="${esc(x.id)}"><i class="fa-solid fa-plus"></i> Add</button></article>`).join('')}</div>`}
  else if(view==='cart')body=cart.length?`<div class="ghp-cart-list">${cart.map(x=>`<article><span><b>${esc(x.name)}</b><small>${esc(euro(x.price))} each</small></span><div><button data-dominos-quantity="-1" data-dominos-item="${esc(x.id)}">−</button><b>${x.quantity}</b><button data-dominos-quantity="1" data-dominos-item="${esc(x.id)}">+</button></div><strong>${esc(euro(x.lineTotal))}</strong></article>`).join('')}</div><div class="ghp-checkout-total"><span>Total</span><b>${esc(euro(cartTotal))}</b></div><button class="ghp-wide-action primary" data-dominos-checkout><i class="fa-solid fa-location-arrow"></i> Order to my location</button>`:empty('fa-solid fa-bag-shopping','Your cart is empty','Add food or drinks from the menu.','<button data-app-view="menu">View menu</button>')
  else if(view==='orders')body=orders.length?`<div class="ghp-service-orders">${orders.map(order=>{const customer=identityById(order.customerIdentityId),driver=identityById(order.driverIdentityId),isCustomer=order.customerIdentityId===identity.id,isDriver=order.driverIdentityId===identity.id,actions=isDriver?(order.status==='preparing'?'<button data-dominos-status="out_for_delivery">Out for delivery</button>':order.status==='out_for_delivery'?'<button data-dominos-status="arrived">Driver arrived</button>':order.status==='arrived'?'<button data-dominos-status="delivered">Mark delivered</button>':''):'';return`<article data-service-order="${esc(order.id)}"><header><i class="fa-solid fa-pizza-slice"></i><span><b>${esc(serviceStatus(order.status))}</b><small>${esc(rel(order.createdAt))} · ${esc(order.id.split(':').at(-1).slice(0,8))}</small></span><strong>${esc(euro(order.total))}</strong></header><p>${esc(order.items.map(x=>`${x.quantity}× ${x.name}`).join(', '))}</p><small><i class="fa-solid fa-location-dot"></i> ${esc(order.location)}</small><small>${isCustomer?`Courier: ${driver?.name||'Not assigned'}`:`Customer: ${customer?.name||order.customerName}`}</small>${!['delivered','cancelled'].includes(order.status)&&((isDriver&&actions)||isCustomer)?`<div class="ghp-service-actions">${actions}${isCustomer?`<button class="danger" data-dominos-status="cancelled">Cancel</button>`:''}</div>`:''}</article>`}).join('')}</div>`:empty('fa-solid fa-receipt','No orders yet','A placed order appears on both the customer and assigned worker phones.')
  else{const assigned=roles.dominos.deliveryWorkerId===identity.id;body=`<section class="ghp-role-settings"><i class="fa-solid fa-motorcycle"></i><h2>Delivery worker</h2><p>This hidden assignment is global for ${esc(identity.name)} in every chat. Assigning this phone replaces the previous Domino's worker.</p><button class="ghp-wide-action ${assigned?'danger':''}" data-toggle-dominos-worker>${assigned?'Stop being the delivery worker':'Assign me as delivery worker'}</button>${worker&&!assigned?`<small>Currently assigned: ${esc(worker.name)}</small>`:''}</section>`}
  const right=`<button data-app-view="cart" class="ghp-cart-button"><i class="fa-solid fa-bag-shopping"></i>${cartCount?`<b>${cartCount}</b>`:''}</button>`;return`<div class="ghp-app ghp-service-app ghp-dominos">${header("Domino's",worker?`Delivery by ${worker.name}`:'No worker assigned',right)}<main>${body}</main>${socialTabs('dominos',tabs,view)}</div>`;
}
function renderUber(){
  const identity=currentIdentity(),view=appView||'ride',roles=globalAppRoles(),drivers=roles.uber.driverIds.map(identityById).filter(Boolean),rides=sharedServices().uber.rides.filter(x=>x.riderIdentityId===identity.id||x.driverIdentityId===identity.id),assigned=roles.uber.driverIds.includes(identity.id),tabs=[['ride','fa-solid fa-location-arrow','Ride'],['trips','fa-solid fa-clock-rotate-left','Trips'],['driver','fa-solid fa-car','Driver'],['settings','fa-solid fa-gear','Role']];let body='';
  if(view==='ride'){const active=rides.find(x=>x.riderIdentityId===identity.id&&!['completed','cancelled'].includes(x.status)),available=drivers.some(x=>x.id!==identity.id);body=active?`<section class="ghp-uber-active" data-service-ride="${esc(active.id)}"><div class="ghp-route-line"><i></i><span><b>${esc(active.pickup)}</b><small>Pickup</small></span><i></i><span><b>${esc(active.destination)}</b><small>Destination</small></span></div><h2>${esc(serviceStatus(active.status))}</h2><p>${esc(active.driverName)} · ${active.status==='en_route'?`estimated ${esc(timeText(new Date(active.etaMs)))}`:'ride active'}</p><div class="ghp-service-actions">${active.status==='en_route'?'<button data-uber-status="arrived">Driver arrived</button>':active.status==='arrived'?'<button data-uber-status="in_progress">Start ride</button>':active.status==='in_progress'?'<button data-uber-status="completed">Complete ride</button>':''}<button class="danger" data-uber-status="cancelled">Cancel</button></div></section>`:`<section class="ghp-uber-request"><i class="fa-solid fa-car-side"></i><h2>Where to?</h2><p>Pickup uses Greyhaven Life when available. Choose one of the globally assigned drivers.</p><button class="ghp-wide-action primary" data-request-uber ${available?'':'disabled'}>${available?'Request a ride':'No other Uber driver assigned'}</button></section>`}
  else if(view==='trips')body=rides.length?`<div class="ghp-service-orders">${rides.map(ride=>`<article><header><i class="fa-solid fa-car"></i><span><b>${esc(serviceStatus(ride.status))}</b><small>${esc(rel(ride.createdAt))}</small></span></header><p>${esc(ride.pickup)} → ${esc(ride.destination)}</p><small>${ride.riderIdentityId===identity.id?`Driver: ${esc(ride.driverName)}`:`Rider: ${esc(ride.riderName)}`}</small></article>`).join('')}</div>`:empty('fa-solid fa-route','No rides yet','Requested and completed rides appear here.')
  else if(view==='driver'){const assignedRides=rides.filter(x=>x.driverIdentityId===identity.id&&!['completed','cancelled'].includes(x.status));body=assigned?`<div class="ghp-role-banner"><i class="fa-solid fa-circle-check"></i><span><b>You are an Uber driver</b><small>This assignment follows ${esc(identity.name)} across chats.</small></span></div>${assignedRides.length?`<div class="ghp-service-orders">${assignedRides.map(ride=>{const action=ride.status==='en_route'?'<button data-uber-status="arrived">Arrived</button>':ride.status==='arrived'?'<button data-uber-status="in_progress">Start ride</button>':ride.status==='in_progress'?'<button data-uber-status="completed">Complete</button>':'';return`<article data-service-ride="${esc(ride.id)}"><header><i class="fa-solid fa-user"></i><span><b>${esc(ride.riderName)}</b><small>${esc(serviceStatus(ride.status))}</small></span></header><p>${esc(ride.pickup)} → ${esc(ride.destination)}</p>${action?`<div class="ghp-service-actions">${action}</div>`:''}</article>`}).join('')}</div>`:'<small class="ghp-muted">No active assigned rides.</small>'}`:empty('fa-solid fa-id-card','Driver mode is off','Enable it in the hidden Role tab.')}
  else body=`<section class="ghp-role-settings"><i class="fa-solid fa-id-card"></i><h2>Uber driver</h2><p>Multiple characters may be assigned. The assignment is global, but each ride belongs only to the chat where it was requested.</p><button class="ghp-wide-action ${assigned?'danger':''}" data-toggle-uber-driver>${assigned?'Remove me as a driver':'Assign me as an Uber driver'}</button>${drivers.length?`<small>Assigned drivers: ${esc(drivers.map(x=>x.name).join(', '))}</small>`:''}</section>`;
  return`<div class="ghp-app ghp-service-app ghp-uber">${header('Uber',drivers.length?`${drivers.length} assigned driver${drivers.length===1?'':'s'}`:'No drivers assigned','')}<main>${body}</main>${socialTabs('uber',tabs,view)}</div>`;
}
function onlyFansPostCard(row,locked=false){return`<article class="ghp-of-post ${locked?'locked':''}">${socialMediaCard(row,row.type==='video'?'Video':'Photo')}${locked?'<div class="ghp-of-lock"><i class="fa-solid fa-lock"></i><b>Subscribers only</b></div>':''}<p>${locked?'Subscribe to unlock this post.':esc(row.caption||'')}</p>${locked?'':`<small>${Number(row.likes||0).toLocaleString()} likes · ${Number(row.comments||0).toLocaleString()} comments</small>`}</article>`}
function renderOnlyFansVideo(){
  const t=timeline(),th=appThread('onlyfans',itemId,t);if(!th){appView='messages';return renderOnlyFans()}const peer=appPeer(th)||{name:th.peerName,avatar:th.peerAvatar};return`<div class="ghp-of-video"><header><button data-end-onlyfans-video><i class="fa-solid fa-chevron-left"></i></button><span>${avatarHtml(peer,'small')}<b>${esc(peer.name)}</b><small>Private video call</small></span><i class="fa-solid fa-video"></i></header><div class="ghp-of-video-stage">${avatarHtml(peer,'huge')}<span>Live with ${esc(peer.name)}</span></div><main>${th.messages.slice(-40).map(m=>`<div class="${lc(m.sender)===lc(persona().name)?'mine':''}"><b>${esc(m.sender)}</b><p>${esc(m.text||m.mediaDescription||'')}</p></div>`).join('')}${appReplyBusy?'<div class="ghp-typing"><i></i><i></i><i></i></div>':''}</main><form data-app-thread-form="onlyfans" data-app-thread-id="${esc(th.id)}"><input placeholder="Say or do something…" ${appReplyBusy?'disabled':''}><button ${appReplyBusy?'disabled':''}><i class="fa-solid fa-arrow-up"></i></button></form><button class="ghp-of-hangup" data-end-onlyfans-video><i class="fa-solid fa-phone-slash"></i></button></div>`;
}
function renderOnlyFans(){
  const t=timeline(),view=appView||'featured',owner=currentIdentity(),ownAccount=onlyFansAccount(owner,false),creators=onlyFansCreators(),state=sharedOnlyFans(),tabs=[['featured','fa-solid fa-compass','Featured'],['messages','fa-solid fa-envelope','Messages'],['activity','fa-solid fa-bell','Activity'],['page','fa-solid fa-user','My Page'],['insights','fa-solid fa-chart-line','Income']];if(view==='thread')return renderAppThread('onlyfans');if(view==='video')return renderOnlyFansVideo();
  if(view==='creator'){const creator=identityById(itemId),account=onlyFansAccount(creator,false);if(!creator||!account){appView='featured';itemId='';return renderOnlyFans()}const mine=creator.id===owner.id,subscribed=mine||isOnlyFansSubscribed(owner.id,creator.id),stats=onlyFansAccountStats(creator,account);return`<div class="ghp-app ghp-onlyfans">${header(creator.name,`${stats.subscribers.toLocaleString()} subscribers`)}<main><section class="ghp-of-profile">${avatarHtml(creator,'hero')}<h2>${esc(creator.name)}</h2><p>${esc(euro(account.subscriptionPrice))} / month</p>${mine?'':`<button class="ghp-wide-action ${subscribed?'danger':'primary'}" data-onlyfans-subscribe="${esc(creator.id)}">${subscribed?'Unsubscribe':'Subscribe'}</button>`}${subscribed?`<div class="ghp-service-actions"><button data-open-social-thread="onlyfans" data-social-identity="${esc(creator.id)}"><i class="fa-solid fa-envelope"></i> Message</button><button data-onlyfans-video="${esc(creator.id)}"><i class="fa-solid fa-video"></i> Video call</button></div>`:''}</section><div class="ghp-of-grid">${account.posts.slice(0,30).map(row=>onlyFansPostCard(row,!subscribed)).join('')}</div></main></div>`}
  let body='';if(view==='featured')body=creators.length?`<div class="ghp-of-featured">${creators.map(({identity,account})=>{const stats=onlyFansAccountStats(identity,account),subscribed=isOnlyFansSubscribed(owner.id,identity.id);return`<button data-onlyfans-creator="${esc(identity.id)}">${avatarHtml(identity,'large')}<span><b>${esc(identity.name)}</b><small>${stats.posts.toLocaleString()} posts · ${stats.subscribers.toLocaleString()} subscribers</small><em>${subscribed?'Subscribed':`${esc(euro(account.subscriptionPrice))}/mo`}</em></span><i class="fa-solid fa-chevron-right"></i></button>`}).join('')}</div>`:empty('fa-solid fa-lock-open','No creators assigned','Install the app on an adult character’s phone and enable Creator account in its hidden settings.')
  else if(view==='messages')body=appThreadRows('onlyfans');
  else if(view==='activity'){const rows=[...(ownAccount?.activity||[]).map(x=>({title:'Creator activity',text:x.text,timeMs:x.timeMs})),...t.notifications.filter(x=>x.app==='onlyfans')].sort((a,b)=>Number(b.timeMs||0)-Number(a.timeMs||0));body=rows.length?rows.slice(0,60).map(x=>`<div class="ghp-notification-row"><i class="fa-solid fa-heart"></i><span><b>${esc(x.title||'OnlyFans')}</b><small>${esc(x.text||'')}</small></span><time>${esc(rel(x.timeMs))}</time></div>`).join(''):empty('fa-solid fa-bell','No activity yet','Subscriptions, posts and private interactions appear here.')}
  else if(view==='page')body=ownAccount?`<section class="ghp-of-profile">${avatarHtml(owner,'hero')}<h2>${esc(owner.name)}</h2><p>${esc(euro(ownAccount.subscriptionPrice))} / month</p><button class="ghp-wide-action primary" data-new-onlyfans-post><i class="fa-solid fa-plus"></i> New post</button></section><div class="ghp-of-grid">${ownAccount.posts.map(row=>onlyFansPostCard(row,false)).join('')}</div>`:empty('fa-solid fa-user-lock','Viewer account','This phone can discover and subscribe to assigned adult creators. Creator mode is enabled only from the hidden settings.')
  else if(view==='insights'){if(ownAccount){const stats=onlyFansAccountStats(owner,ownAccount);body=`<div class="ghp-of-insights"><article><i class="fa-solid fa-users"></i><span><b>${stats.subscribers.toLocaleString()}</b><small>Subscribers</small></span></article><article><i class="fa-solid fa-photo-film"></i><span><b>${stats.posts.toLocaleString()}</b><small>Total posts</small></span></article><article><i class="fa-solid fa-wallet"></i><span><b>${esc(euro(stats.monthly))}</b><small>Estimated this month</small></span></article><article><i class="fa-solid fa-sack-dollar"></i><span><b>${esc(euro(stats.total))}</b><small>Account earnings</small></span></article></div>`}else body=empty('fa-solid fa-chart-line','No creator insights','Enable a creator account first.')}
  else{const age=identityAge(owner),eligible=age>=18;body=`<section class="ghp-role-settings"><i class="fa-solid fa-user-shield"></i><h2>Creator account</h2><p>This manual adult-only assignment follows ${esc(owner.name)} globally across chats. New creators receive established subscriber, post, and earnings history instead of starting at zero.</p><label><span><b>Subscription price</b><small>Fictional monthly payment</small></span><input class="onlyfans-price" type="number" min="1" max="500" step="0.01" value="${esc(ownAccount?.subscriptionPrice||12.99)}"></label><button class="ghp-wide-action ${ownAccount?'danger':''}" data-toggle-onlyfans-creator ${!eligible&&!ownAccount?'disabled':''}>${ownAccount?'Disable creator account':'Enable creator account'}</button><small>${eligible?`Age on card: ${age}`:'An explicit Age of 18 or older is required in the character card.'}</small></section>`}
  const right='<button data-app-view="settings"><i class="fa-solid fa-gear"></i></button>';return`<div class="ghp-app ghp-social-app ghp-onlyfans">${header('OnlyFans','Adult creators only',right)}<main>${body}</main>${view==='settings'?'':socialTabs('onlyfans',tabs,view)}</div>`;
}
function darkWebListingCard(row){return`<button data-darkweb-listing="${esc(row.id)}">${socialMediaCard(row,row.title)}<b>${esc(row.price)}</b><span>${esc(row.title)}</span><small>${esc(row.providerName)}${row.duration?` · ${esc(row.duration)}`:''}</small></button>`}
function renderDarkWeb(){
  const t=timeline(),view=appView||'drugs',owner=currentIdentity(),market=sharedDarkWeb(),roles=globalAppRoles(),sections={drugs:['Drug Market','fa-solid fa-capsules'],escorts:['Escorts','fa-solid fa-heart'],crime:['Crime for Hire','fa-solid fa-user-ninja'],intel:['Intel','fa-solid fa-eye']};if(view==='thread')return renderAppThread('darkweb');if(view==='listing'){const row=market.listings.find(x=>x.id===itemId);if(!row){appView='drugs';itemId='';return renderDarkWeb()}const provider=identityById(row.providerIdentityId)||{id:row.providerIdentityId,name:row.providerName};return`<div class="ghp-app ghp-darkweb">${header(row.title,sections[row.section]?.[0]||'Dark Web')}<main class="ghp-market-detail">${socialMediaCard(row,row.title)}<h2>${esc(row.title)}</h2><h3>${esc(row.price)}${row.duration?` · ${esc(row.duration)}`:''}</h3><p>${esc(row.description)}</p><small>${esc(row.area||'Greyhaven')}</small><div class="ghp-market-seller">${avatarHtml(provider)}<span><b>${esc(provider.name)}</b><small>${row.providerType==='existing'?'Assigned Greyhaven provider':'Provisional identity · never auto-linked'}</small></span></div><button class="ghp-wide-action primary" data-darkweb-message="${esc(provider.id)}"><i class="fa-solid fa-comment-dots"></i> Message privately</button></main></div>`}
  const tabs=[['drugs','fa-solid fa-capsules','Market'],['escorts','fa-solid fa-heart','Escorts'],['crime','fa-solid fa-user-ninja','Hire'],['intel','fa-solid fa-eye','Intel'],['messages','fa-solid fa-comments','Messages']];let body='';if(sections[view]){const listings=market.listings.filter(x=>x.section===view),assigned=view==='escorts'?darkWebAssigned('escorts'):[];body=`${view==='escorts'&&assigned.length?`<h3>Assigned adult profiles</h3><div class="ghp-dark-profiles">${assigned.map(({identity,config})=>`<button data-darkweb-provider="${esc(identity.id)}">${avatarHtml(identity,'large')}<span><b>${esc(identity.name)}</b><small>${esc(config.description||'Private adult companion profile')}</small><em>${esc(config.price||'Price on request')}${config.duration?` · ${esc(config.duration)}`:''}</em></span></button>`).join('')}</div>`:''}<div class="ghp-dark-heading"><span><b>${sections[view][0]}</b><small>${listings.length} active listings</small></span><button data-darkweb-refresh ${darkWebRefreshBusy?'disabled':''}><i class="fa-solid fa-rotate"></i></button></div><div class="ghp-market-grid ghp-dark-grid">${listings.map(darkWebListingCard).join('')||empty(sections[view][1],'No listings yet','Use the dedicated refresh to populate every section.')}</div>`}
  else if(view==='messages')body=appThreadRows('darkweb');
  else{const cfg=role=>roles.darkweb[role]?.[owner.id],dealer=cfg('dealers'),escort=cfg('escorts'),crime=cfg('crime'),intel=cfg('intel'),eligible=adultRoleEligible(owner);body=`<section class="ghp-role-settings ghp-dark-settings"><i class="fa-solid fa-user-secret"></i><h2>Manual provider roles</h2><p>Assignments are global. Refresh can use ${esc(owner.name)} only in explicitly enabled sections; it never assigns real characters automatically.</p><label><span><b>Drug-market dealer</b></span><input type="checkbox" data-dark-role="dealers" ${dealer?'checked':''}></label><label><span><b>Adult escort</b><small>${eligible?'Eligible from character age':'Requires explicit Age 18+'}</small></span><input type="checkbox" data-dark-role="escorts" ${escort?'checked':''} ${eligible?'':'disabled'}></label><label><span><b>Crime-for-hire provider</b></span><input type="checkbox" data-dark-role="crime" ${crime?'checked':''}></label><label><span><b>Intel broker</b></span><input type="checkbox" data-dark-role="intel" ${intel?'checked':''}></label><label class="stack"><span><b>Escort price</b></span><input class="dark-price" value="${esc(escort?.price||'€150')}"></label><label class="stack"><span><b>Duration</b></span><input class="dark-duration" value="${esc(escort?.duration||'1 hour')}"></label><label class="stack"><span><b>Public description / boundaries</b></span><textarea class="dark-description">${esc(escort?.description||'')}</textarea></label><button class="ghp-wide-action primary" data-save-dark-roles>Save global roles</button></section>`}
  const right=`<span class="ghp-header-actions"><button data-darkweb-refresh title="Refresh all sections"><i class="fa-solid fa-rotate"></i></button><button data-app-view="settings" title="Hidden assignments"><i class="fa-solid fa-gear"></i></button></span>`;return`<div class="ghp-app ghp-social-app ghp-darkweb">${header('Dark Web','Fictional Greyhaven network',right)}<main>${body}</main>${view==='settings'?'':socialTabs('darkweb',tabs,view)}</div>`;
}
function renderStory(){return renderInstagram()}
function renderSocial(){return renderInstagram()}
function renderSnap(){return renderSnapchat()}
function scheduleText(x){const e=x?.entry||x;if(!e)return'';return`${e.label||'Schedule'} · ${e.start||''}–${e.end||''}${e.location||e.area?` · ${[e.location,e.area].filter(Boolean).join(' · ')}`:''}`}
function renderCalendar(){
  const p=persona();let cur=null,up=[],person=null;try{cur=globalThis.GreyhavenLife?.getCurrentSchedule?.(p.name)||null;up=globalThis.GreyhavenLife?.getUpcomingSchedules?.(p.name,72)||[];person=globalThis.GreyhavenLife?.getPerson?.(p.name)||null}catch{}
  const ex=(person?.exceptions||[]).filter(x=>(x.endMs?Number(x.endMs):Infinity)>=now().getTime()-86400000).sort((a,b)=>Number(a.startMs||0)-Number(b.startMs||0)),fmt=ms=>new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ms));
  return`<div class="ghp-app">${header('Calendar',globalThis.GreyhavenLife?'Synced with Greyhaven Life':'Greyhaven Life not detected')}<main><div class="ghp-date"><b>${now().getDate()}</b><span>${esc(dateText())}</span></div>${cur?`<section><h3>Now</h3><div class="ghp-event current"><i></i><span><b>${esc(cur.entry?.label||'Current schedule')}</b><small>${esc(scheduleText(cur))}</small></span></div></section>`:''}<section><h3>Upcoming</h3>${up.length?up.slice(0,12).map(x=>`<div class="ghp-event"><i></i><span><b>${esc(x.entry?.label||'Schedule')}</b><small>${esc(scheduleText(x))}</small></span></div>`).join(''):'<small class="ghp-muted">No upcoming schedules.</small>'}</section><section><h3>Exceptions & trips</h3>${ex.length?ex.map(x=>`<div class="ghp-event exception"><i></i><span><b>${esc(x.label||x.type||'Exception')}</b><small>${x.endMs?`Ends ${esc(fmt(x.endMs))}`:'No end set'}${x.suppressObligations?' · obligations excused':''}</small></span></div>`).join(''):'<small class="ghp-muted">No active/upcoming exceptions.</small>'}</section></main></div>`;
}
function renderPhotos(){
  const t=timeline(),messageMedia=[];
  for(const th of Object.values(t.threads))for(const m of th.messages||[])if(['photo','video'].includes(m.type))messageMedia.push({id:m.id,visual:m.mediaDescription,caption:m.text,timeMs:m.timeMs,source:`Messages · ${m.sender}`,type:m.type,mediaKey:m.mediaKey});
  for(const appName of ['instagram','snapchat','facebook','onlyfans','darkweb']){const store=appStore(t,appName);for(const th of Object.values(store.threads||{}))for(const m of th.messages||[])if(['photo','video'].includes(m.type)&&m.opened!==false)messageMedia.push({id:m.id,visual:m.mediaDescription,caption:m.text,timeMs:m.timeMs,source:`${APPS[appName].label} · ${m.sender}`,type:m.type,mediaKey:m.mediaKey})}
  const social=[...t.instagram.posts.map(x=>({...x,source:`Instagram · ${x.author}`,type:x.type||'photo'})),...t.instagram.stories.map(x=>({...x,source:`Instagram Story · ${x.author}`,type:x.type||'photo'})),...t.facebook.posts.filter(x=>x.visual).map(x=>({...x,source:`Facebook · ${x.author}`,type:x.type||'photo'})),...t.snapchat.memories.map(x=>({...x,source:'Snapchat Memories'}))];
  const a=[...t.photos,...messageMedia,...social].sort((a,b)=>Number(b.timeMs||0)-Number(a.timeMs||0));
  return`<div class="ghp-app">${header('Photos')}<main><div class="ghp-photos">${a.length?a.slice(0,100).map(x=>`<div>${x.mediaKey?(x.type==='video'?`<video data-media-key="${esc(x.mediaKey)}" muted playsinline></video>`:`<img data-media-key="${esc(x.mediaKey)}" alt="${esc(x.visual||x.mediaDescription||'Photo')}">`):`<i class="${x.type==='video'?'fa-solid fa-video':'fa-regular fa-image'}"></i><p>${esc(x.visual||x.mediaDescription||x.caption||'Photo')}</p>`}<small>${esc(x.source||'Photos')}</small></div>`).join(''):empty('fa-regular fa-images','No photos yet','Opened message media and social media will appear here.')}</div></main></div>`;
}
function renderNotes(){const t=timeline();return`<div class="ghp-app">${header('Notes','','<button data-new-note><i class="fa-solid fa-square-plus"></i></button>')}<main>${t.notes.length?t.notes.map(n=>`<button class="ghp-note" data-note="${esc(n.id)}"><b>${esc(n.title||'Note')}</b><span>${esc(n.body||'')}</span><time>${esc(rel(n.updatedAt||n.timeMs))}</time></button>`).join(''):empty('fa-regular fa-note-sticky','No notes','Notes are private to this persona in this timeline.','<button data-new-note>New note</button>')}</main></div>`}
function renderMail(){const t=timeline();return`<div class="ghp-app">${header('Mail')}<main>${t.mail.length?t.mail.map(m=>`<button class="ghp-mail ${m.read?'':'unread'}" data-mail="${esc(m.id)}"><i></i><b>${esc(m.from)}</b><strong>${esc(m.subject)}</strong><small>${esc(m.body)}</small><time>${esc(rel(m.timeMs))}</time></button>`).join(''):empty('fa-regular fa-envelope','Inbox empty','Mail is generated only when it makes sense.')}</main></div>`}
function renderSettings(){
  const p=profile(),own=persona();return`<div class="ghp-app">${header('Settings')}<main class="ghp-settings"><div class="ghp-settings-owner">${avatarHtml({name:own.name,avatar:own.avatar},'large')}<span><b>${esc(own.name)}</b><small>${esc(p.deviceName)} · phone profile</small></span></div><section><h3>Appearance</h3><label><span><b>Wallpaper</b></span><select id="ghp-wall">${Object.keys(WALLPAPERS).map(k=>`<option value="${k}" ${p.wallpaper===k?'selected':''}>${esc(k[0].toUpperCase()+k.slice(1))}</option>`).join('')}</select></label><label class="stack"><span><b>Custom wallpaper URL</b><small>Optional; overrides the preset.</small></span><input id="ghp-wall-url" value="${esc(p.wallpaperUrl)}"></label><label><span><b>Lock Screen</b></span><input type="checkbox" id="ghp-lock-setting" ${p.lockScreen?'checked':''}></label><label><span><b>Notification previews</b></span><input type="checkbox" id="ghp-preview-setting" ${p.notificationPreviews?'checked':''}></label></section><section><h3>Installed apps</h3>${Object.entries(APPS).filter(([k])=>k!=='settings').map(([k,x])=>`<label><span><b><i class="${x.icon}"></i> ${esc(x.label)}</b></span><input type="checkbox" data-app-setting="${k}" ${p.apps[k]?'checked':''}></label>`).join('')}</section><section><h3>AI Phone Refresh</h3><label class="stack"><span><b>Refresh behavior</b><small>Manual spends no tokens until you tap Refresh.</small></span><select id="ghp-refresh-mode"><option value="manual" ${p.refreshMode==='manual'?'selected':''}>Manual only</option><option value="stale-open" ${p.refreshMode==='stale-open'?'selected':''}>Refresh on open when stale</option></select></label><label><span><b>Stale after RP messages</b></span><input id="ghp-stale" type="number" min="3" max="100" value="${p.staleAfterMessages}"></label><label><span><b>Max new events</b></span><input id="ghp-max-events" type="number" min="1" max="8" value="${p.maxNewEvents}"></label><label class="stack"><span><b>Background activity</b></span><select id="ghp-activity"><option value="quiet" ${p.activityLevel==='quiet'?'selected':''}>Quiet</option><option value="normal" ${p.activityLevel==='normal'?'selected':''}>Normal</option><option value="busy" ${p.activityLevel==='busy'?'selected':''}>Busy</option></select></label><div class="ghp-life-status"><i class="fa-solid fa-circle-nodes"></i>${globalThis.GreyhavenLife?'Greyhaven Life detected — World Snapshot and live state will be reused.':'Greyhaven Life not detected — Phone will use recent RP only.'}</div></section><section><h3>Timeline</h3><button class="danger" data-reset-phone>Reset this persona's phone in this chat</button><small>Wallpaper/apps stay global; messages and history reset only here.</small></section><button class="ghp-save" data-save-settings>Save Settings</button></main></div>`;
}
function renderApp(){
  if(app==='call')return renderCall();if(app==='story')return renderStory();
  const body=app==='messages'?renderMessages():app==='thread'?renderThread():app==='phone'?renderPhone():app==='contacts'?renderContacts():app==='contact'?renderContact():app==='instagram'?renderInstagram():app==='snapchat'?renderSnapchat():app==='facebook'?renderFacebook():app==='dominos'?renderDominos():app==='uber'?renderUber():app==='onlyfans'?renderOnlyFans():app==='darkweb'?renderDarkWeb():app==='calendar'?renderCalendar():app==='photos'?renderPhotos():app==='notes'?renderNotes():app==='mail'?renderMail():app==='settings'?renderSettings():renderHome();
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
  if(['instagram','snapchat','facebook','dominos','uber','onlyfans','darkweb'].includes(app)&&appView){const from=appView;itemId='';if(app==='onlyfans')appView=from==='thread'||from==='video'?'messages':from==='creator'?'featured':from==='settings'?'featured':'';else if(app==='darkweb')appView=from==='thread'?'messages':from==='listing'||from==='settings'?'drugs':'';else if(app==='dominos')appView=from==='cart'||from==='orders'||from==='settings'?'menu':'';else if(app==='uber')appView=from==='trips'||from==='driver'||from==='settings'?'ride':'';else appView=from==='thread'?(app==='instagram'?'dms':app==='snapchat'?'chats':'messenger'):from==='story'?(app==='instagram'?'feed':'stories'):from==='listing'?'marketplace':from==='profile'?'feed':from==='add'?'camera':from==='eyes'?'memories':'';if(appView)return render()}
  if(app==='story'){threadId='';app='instagram';appView='feed';return render()}
  if(app==='call'){callId='';app='phone';return render()}
  if(app){threadId='';contactId='';callId='';appView='';itemId='';app='';return render()}
  render();
}

async function openPhone(){if(!hasChat()){globalThis.toastr?.warning?.('Open a SillyTavern chat first.');return}buildOverlay();seedContacts(true);reconcileServiceEvents();unlocked=!profile().lockScreen;app='';appView='';itemId='';threadId='';contactId='';callId='';composeRequest={threadId:'',kind:''};const o=document.querySelector('#ghp-overlay');o.hidden=false;document.body.classList.add('ghp-open');render();if(profile().refreshMode==='stale-open'&&stale().stale)setTimeout(refreshPhone,250)}
function closePhone(){const o=document.querySelector('#ghp-overlay');if(o)o.hidden=true;document.body.classList.remove('ghp-open');app='';appView='';itemId='';threadId='';contactId='';callId='';composeRequest={threadId:'',kind:''};unlocked=false}
function openApp(a){if(a==='settings'||profile().apps[a]){if(a==='phone')mutate(t=>{for(const n of t.notifications)if(n.app===a)n.read=true},false);unlocked=true;app=a;appView='';itemId='';threadId='';contactId='';composeRequest={threadId:'',kind:''};render()}}
function startCall(cid){
  const t=timeline(),c=t.contacts[cid];if(!c||c.blocked)return;if(c.blockedByContact){globalThis.toastr?.info?.('Call did not connect.');return;}const stamp=now().getTime(),sharedCallId=`call:${id()}`,call={id:id(),sharedCallId,contactId:cid,contactName:c.name,direction:'outgoing',status:'active',timeMs:stamp,durationSec:0,transcript:[]};t.calls.unshift(call);mirrorCallToOwner({phoneOwner:c.name,phoneOwnerAvatar:c.avatar,peerName:persona().name,peerAvatar:persona().avatar,peerDescription:persona().description,direction:'incoming',status:'active',timeMs:stamp,sharedCallId});persist(t,false);callId=call.id;app='call';render();const th=directThread(cid);if(th&&!replyBusy)setTimeout(()=>generateReply(th,'call'),180);
}
function endCall(){let shared='';mutate(t=>{const c=t.calls.find(x=>x.id===callId);if(c){c.status='ended';shared=c.sharedCallId||''}},false);updateSharedCallStatus(shared,'ended');callId='';app='phone';render()}

function popup(html){const d=document.createElement('dialog');d.className='ghp-popup';d.innerHTML=html;document.body.appendChild(d);d.addEventListener('close',()=>d.remove());d.showModal();return d}
function newThreadPopup(){
  const t=timeline(),cs=t.contactOrder.map(k=>t.contacts[k]).filter(c=>c&&c.saved&&!c.blocked);if(!cs.length){globalThis.toastr?.warning?.('Add a contact by phone number first.');return}
  const d=popup(`<form method="dialog"><header><b>New Message</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><p>Select one person, or several for a group chat.</p><div class="ghp-picker">${cs.map(c=>`<label>${avatarHtml(c,'small')}<span>${esc(c.nickname||c.name)}</span><input type="checkbox" value="${esc(c.id)}"></label>`).join('')}</div><input class="group-name" placeholder="Group name (optional)"><button type="button" class="primary" data-create-thread>Create</button></form>`);
  d.querySelector('[data-create-thread]').onclick=()=>{const ids=[...d.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);if(!ids.length)return;if(ids.length===1){const th=directThread(ids[0]);threadId=th.id;app='thread'}else{const t=timeline(),tid=`thread:${id()}`;t.threads[tid]={id:tid,type:'group',title:d.querySelector('.group-name').value.trim()||ids.map(k=>t.contacts[k]?.name).filter(Boolean).join(', '),contactIds:ids,createdAt:Date.now(),messages:[]};t.threadOrder.unshift(tid);persist(t,false);threadId=tid;app='thread'}d.close();render()};
}
function addContactPopup(){
  ensureAllIdentities();let match=null;const d=popup(`<form method="dialog" class="ghp-number-add"><header><b>Add Contact</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><p class="ghp-popup-copy">Enter the person's exact 9-digit Greyhaven phone number. Meeting somebody or knowing their name does not add them here.</p><label><span><b>Phone number</b><small>9 digits</small></span><input class="contact-number" inputmode="numeric" maxlength="9" autocomplete="off" placeholder="000000000"></label><div class="ghp-number-match"><i class="fa-solid fa-magnifying-glass"></i><span><b>Waiting for a number</b><small>No character list is exposed.</small></span></div><button type="button" class="primary" data-confirm-add disabled>Add Contact</button></form>`),input=d.querySelector('.contact-number'),row=d.querySelector('.ghp-number-match'),button=d.querySelector('[data-confirm-add]');
  const update=()=>{input.value=cleanPhoneNumber(input.value);match=validPhoneNumber(input.value)?identityByNumber(input.value):null;if(match&&match.id!==currentIdentity()?.id&&match.kind!=='provisional'){row.innerHTML=`${avatarHtml(match,'small')}<span><b>${esc(match.name)}</b><small>${esc(match.phoneNumber)}</small></span>`;button.disabled=false}else{row.innerHTML=`<i class="fa-solid ${validPhoneNumber(input.value)?'fa-user-slash':'fa-magnifying-glass'}"></i><span><b>${validPhoneNumber(input.value)?'No known character matches':'Enter all 9 digits'}</b><small>${validPhoneNumber(input.value)?'Check the number and try again.':'No character list is exposed.'}</small></span>`;button.disabled=true}};input.addEventListener('input',update);
  button.onclick=()=>{if(!match)return;mutate(t=>{unsuppress(t,match.name);const co=upsertContact(t,{name:match.name,avatar:match.avatar,identityId:match.id,phoneNumber:match.phoneNumber,source:'number',saved:true});if(co){co.saved=true;const reln=ensureRelationship(t,match);if(reln)reln.knownContactInfo.phoneNumber=true}},false);d.close();render()};
}
function dominosCheckoutPopup(){
  const items=dominosCart(),customer=currentIdentity(),assigned=identityById(globalAppRoles().dominos.deliveryWorkerId),driver=assigned?.id===customer?.id?null:assigned;if(!items.length)return;const total=items.reduce((sum,x)=>sum+x.lineTotal,0),d=popup(`<form method="dialog"><header><b>Confirm Domino's order</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><p class="ghp-popup-copy">${esc(items.map(x=>`${x.quantity}× ${x.name}`).join(', '))}</p><label><span><b>Delivery location</b><small>Detected from Greyhaven Life when available.</small></span><input class="dominos-location" value="${esc(locationForIdentity(customer)||'')}"></label><div class="ghp-checkout-total"><span>Total</span><b>${esc(euro(total))}</b></div><p class="ghp-popup-copy">${driver?`Assigned worker: ${esc(driver.name)}`:'No other worker is assigned yet. The order can still be placed and tracked.'}</p><button type="button" class="primary" data-confirm-dominos-order>Place order</button></form>`);d.querySelector('[data-confirm-dominos-order]').onclick=()=>{const location=d.querySelector('.dominos-location').value.trim();if(!location){globalThis.toastr?.warning?.('Confirm a delivery location first.');return}const order=placeDominosOrder(location);if(order){d.close();app='dominos';appView='orders';itemId=order.id;render()}};
}
function uberRequestPopup(){
  const roles=globalAppRoles(),rider=currentIdentity(),drivers=roles.uber.driverIds.map(identityById).filter(x=>x&&x.id!==rider?.id);if(!drivers.length){globalThis.toastr?.warning?.('Assign at least one other character as an Uber driver first.');return}const d=popup(`<form method="dialog"><header><b>Request Uber</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><label><span><b>Driver</b><small>Only globally assigned drivers appear.</small></span><select class="uber-driver">${drivers.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label><label><span><b>Pickup</b></span><input class="uber-pickup" value="${esc(locationForIdentity(rider)||'')}"></label><label><span><b>Destination</b></span><input class="uber-destination" value="${esc(timeline().uber.savedDestination||'')}" placeholder="Greyhaven Downtown"></label><button type="button" class="primary" data-confirm-uber>Request ride</button></form>`);d.querySelector('[data-confirm-uber]').onclick=()=>{const pickup=d.querySelector('.uber-pickup').value.trim(),destination=d.querySelector('.uber-destination').value.trim(),driverId=d.querySelector('.uber-driver').value;if(!pickup||!destination){globalThis.toastr?.warning?.('Add both pickup and destination.');return}const ride=requestUberRide(driverId,pickup,destination);if(ride){d.close();app='uber';appView='ride';itemId=ride.id;render()}};
}
function onlyFansPostPopup(){
  if(!onlyFansAccount(currentIdentity(),false))return;const d=popup(`<form method="dialog" class="ghp-media-form"><header><b>New OnlyFans post</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><label><span><b>Media type</b></span><select class="media-type"><option value="photo">Photo</option><option value="video">Video</option></select></label><label><span><b>What does it show?</b><small>This adult-only description is what the AI understands.</small></span><textarea class="media-description"></textarea></label><label><span><b>Caption</b></span><textarea class="media-caption"></textarea></label><label class="ghp-file-label"><span><b>Optional local media</b><small>Visual replacement only.</small></span><input class="media-file" type="file" accept="image/*,video/*"></label><button type="button" class="primary" data-publish-onlyfans>Post for subscribers</button></form>`);d.querySelector('[data-publish-onlyfans]').onclick=async()=>{const type=d.querySelector('.media-type').value,visual=d.querySelector('.media-description').value.trim(),caption=d.querySelector('.media-caption').value.trim(),file=d.querySelector('.media-file').files?.[0];if(!visual){globalThis.toastr?.warning?.('Describe the post media first.');return}const button=d.querySelector('[data-publish-onlyfans]');button.disabled=true;let mediaKey='',meta=null;if(file){mediaKey=await saveMediaBlob(file);meta=await fileMediaMeta(file,type)}if(publishOnlyFansPost({type,visual,caption,mediaKey,mediaWidth:meta?.width||0,mediaHeight:meta?.height||0})){d.close();app='onlyfans';appView='page';render()}};
}
function setOnlyFansVideoState(ownerRef,peerRef,active=true,startedAt=now().getTime()){
  const owner=resolveIdentityRef(ownerRef,false),peer=resolveIdentityRef(peerRef,false);if(!owner||!peer||owner.id===peer.id)return null;
  const ownerPhone=phoneForIdentity(owner,true),peerPhone=phoneForIdentity(peer,true);if(!ownerPhone||!peerPhone)return null;
  const ownerThread=ensureAppThreadIn(ownerPhone.timeline,'onlyfans',peer),peerThread=ensureAppThreadIn(peerPhone.timeline,'onlyfans',owner),wasActive=ownerThread.videoActive||peerThread.videoActive,stamp=wasActive?Number(ownerThread.videoStartedAt||peerThread.videoStartedAt||startedAt):Number(startedAt||now().getTime());
  for(const th of [ownerThread,peerThread]){th.videoActive=!!active;th.videoStartedAt=active?stamp:0}
  if(active&&!wasActive&&identityAppEnabled(peer,'onlyfans'))pushAppNotification(peerPhone.timeline,'onlyfans',owner,`${owner.name} started a private video call`,peerThread.id,`onlyfans-video:${stamp}`);
  ownerPhone.timeline.updatedAt=Date.now();peerPhone.timeline.updatedAt=Date.now();ownerPhone.root.phones[ownerPhone.key]=ownerPhone.timeline;ownerPhone.root.phones[peerPhone.key]=peerPhone.timeline;saveMetadataRoot(ownerPhone.root);
  return{ownerThread,peerThread,startedAt:stamp,wasActive};
}
function startOnlyFansVideo(identityId){
  const peer=identityById(identityId),owner=currentIdentity();if(!peer||!owner)return;
  const creator=onlyFansAccount(owner,false)?owner:onlyFansAccount(peer,false)?peer:null;if(!creator||!isOnlyFansSubscribed(owner.id===creator.id?peer.id:owner.id,creator.id)){globalThis.toastr?.warning?.('An active creator subscription is required for this private call.');return}
  if(!identityAppEnabled(peer,'onlyfans')){globalThis.toastr?.warning?.(`${peer.name} does not currently have OnlyFans enabled.`);return}
  const call=setOnlyFansVideoState(owner,peer,true);if(!call)return;app='onlyfans';appView='video';itemId=call.ownerThread.id;
  if(!call.wasActive)recordContinuityEvent({kind:'call',participants:[owner.name,peer.name],sender:owner.name,summary:`${owner.name} started a private OnlyFans video call with ${peer.name}.`,threadTitle:'OnlyFans video call',mirrorId:`onlyfans-video:${call.startedAt}`,roleplayMs:call.startedAt,transient:true});render();
}
function endOnlyFansVideo(){
  const t=timeline(),th=appThread('onlyfans',itemId,t),owner=currentIdentity(),peer=appPeer(th),startedAt=Number(th?.videoStartedAt||0);if(owner&&peer)setOnlyFansVideoState(owner,peer,false,startedAt);
  if(owner&&peer&&startedAt)recordContinuityEvent({kind:'call',participants:[owner.name,peer.name],sender:owner.name,summary:`The private OnlyFans video call between ${owner.name} and ${peer.name} ended.`,threadTitle:'OnlyFans video call',mirrorId:`onlyfans-video-end:${startedAt}`,roleplayMs:now().getTime(),transient:true});app='onlyfans';appView='messages';itemId='';render();
}
function saveDarkWebRolesFromUi(){
  const o=document.querySelector('#ghp-overlay'),owner=currentIdentity(),price=o.querySelector('.dark-price')?.value.trim()||'',duration=o.querySelector('.dark-duration')?.value.trim()||'',description=o.querySelector('.dark-description')?.value.trim()||'';try{for(const box of o.querySelectorAll('[data-dark-role]'))setGlobalServiceRole('darkweb',box.dataset.darkRole,owner,box.checked,box.dataset.darkRole==='escorts'?{price,duration,description}:{});globalThis.toastr?.success?.('Global Dark Web roles saved.');render()}catch(e){globalThis.toastr?.error?.(e.message||String(e))}
}
function restoreContactsPopup(){
  const t=timeline(),removed=t.suppressedContacts||[];if(!removed.length){globalThis.toastr?.info?.('No removed contacts.');return}
  const c=ctx(),rows=removed.map(name=>{const ch=c?.characters?.find(x=>lc(x?.name)===name),identity=identityForName(ch?.name||name,{create:false});return{name:ch?.name||identity?.name||name,ch,identity}}).sort((a,b)=>a.name.localeCompare(b.name));
  const d=popup(`<div><header><b>Removed Contacts</b><button data-popup-close><i class="fa-solid fa-xmark"></i></button></header><p>These numbers stay out of Contacts and new iMessage selection. Instagram, Snapchat and Facebook relationships remain separate.</p><div class="ghp-restore-list">${rows.map((x,i)=>`<button data-restore-index="${i}"><span><b>${esc(x.name)}</b><small>Restore to Contacts</small></span><i class="fa-solid fa-rotate-left"></i></button>`).join('')}</div></div>`);
  d.querySelector('[data-popup-close]').onclick=()=>d.close();
  d.querySelectorAll('[data-restore-index]').forEach(btn=>btn.onclick=()=>{const x=rows[Number(btn.dataset.restoreIndex)];mutate(t=>{unsuppress(t,x.name);if(x.identity){const co=upsertContact(t,{name:x.identity.name,avatar:x.identity.avatar,identityId:x.identity.id,phoneNumber:x.identity.phoneNumber,characterId:x.ch?c.characters.indexOf(x.ch):null,source:'manual',saved:true});if(co)co.saved=true}},false);d.close();render()});
}
function removeContact(cid){
  const t=timeline(),c=t.contacts[cid];if(!c)return;if(!confirm(`Remove ${c.nickname||c.name} from this phone's contacts?`))return;
  mutate(t=>{
    const key=lc(c.name);if(!t.suppressedContacts.includes(key))t.suppressedContacts.push(key);
    delete t.contacts[cid];t.contactOrder=t.contactOrder.filter(k=>k!==cid);
    const removedThreads=new Set();
    for(const [tid,th] of Object.entries(t.threads)){
      if(!th.contactIds.includes(cid))continue;
      if(th.type==='direct'||th.contactIds.length<=1){removedThreads.add(tid);delete t.threads[tid];t.threadOrder=t.threadOrder.filter(k=>k!==tid)}
      else th.contactIds=th.contactIds.filter(k=>k!==cid);
    }
    t.calls=t.calls.filter(x=>x.contactId!==cid);
    t.notifications=t.notifications.filter(x=>x.contactId!==cid&&!removedThreads.has(x.targetId));
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
function findAppThreadMessage(appName,tid,mid,t=timeline(false)){if(!['instagram','snapchat','facebook','onlyfans','darkweb'].includes(appName))return null;const th=appStore(t,appName)?.threads?.[tid],m=th?.messages?.find(x=>x.id===mid);return th&&m?{th,m}:null}
function editMirroredAppMessage(appName,tid,mid,patch={}){
  const active=timeline(),hit=findAppThreadMessage(appName,tid,mid,active);if(!hit)return false;const owner=persona();if(lc(hit.m.sender)!==lc(owner.name)){globalThis.toastr?.warning?.(`Switch to ${hit.m.sender}'s persona to edit this message.`);return false}const mirrorId=hit.m.mirrorId,editedAt=Date.now(),root=metadataRoot();if(!root)return false;let continuityMsg=null,changed=false;
  for(const [key,raw] of Object.entries(root.phones||{})){const phone=normalizeTimeline(raw),store=appStore(phone,appName);for(const th of Object.values(store?.threads||{})){for(const m of th.messages||[]){if(!((mirrorId&&m.mirrorId===mirrorId)||(!mirrorId&&phone===active&&th.id===tid&&m.id===mid)))continue;if(m.type==='text'){if(patch.text!==undefined)m.text=String(patch.text||'').trim()}else{if(patch.mediaDescription!==undefined)m.mediaDescription=String(patch.mediaDescription||'').trim();if(patch.text!==undefined)m.text=String(patch.text||'').trim()}m.editedAt=editedAt;continuityMsg=clone(m);changed=true;for(const list of [phone.notifications,store.notifications])for(const n of list||[])if(n.eventId===mirrorId||n.targetId===th.id&&Math.abs(Number(n.timeMs||0)-Number(m.timeMs||0))<1500)n.text=notificationTextForMessage(m)}}root.phones[key]=phone}
  if(!changed)return false;saveMetadataRoot(root);if(mirrorId&&continuityMsg)updateContinuityMirror(mirrorId,continuityMsg);else updatePrompt();render();return true;
}
function deleteAppMessageLocal(appName,tid,mid){
  const t=timeline(),store=appStore(t,appName),th=store?.threads?.[tid],message=th?.messages?.find(x=>x.id===mid);if(!message)return false;th.messages=th.messages.filter(x=>x.id!==mid);for(const holder of [t,store])holder.notifications=(holder.notifications||[]).filter(n=>!(n.eventId&&n.eventId===message.mirrorId)&&!(n.targetId===tid&&Math.abs(Number(n.timeMs||0)-Number(message.timeMs||0))<1500));persist(t,false);render();globalThis.toastr?.success?.('Message deleted from this phone.');return true;
}
function unsendAppMessageEverywhere(appName,tid,mid){
  const active=timeline(),hit=findAppThreadMessage(appName,tid,mid,active);if(!hit)return false;const owner=persona();if(lc(hit.m.sender)!==lc(owner.name)){globalThis.toastr?.warning?.(`Switch to ${hit.m.sender}'s persona to unsend this message.`);return false}const mirrorId=hit.m.mirrorId,root=metadataRoot();if(!root)return false;let removed=false;
  for(const [key,raw] of Object.entries(root.phones||{})){const phone=normalizeTimeline(raw),store=appStore(phone,appName);for(const th of Object.values(store?.threads||{})){const gone=(th.messages||[]).filter(m=>(mirrorId&&m.mirrorId===mirrorId)||(!mirrorId&&phone===active&&th.id===tid&&m.id===mid));if(!gone.length)continue;removed=true;const times=new Set(gone.map(m=>Number(m.timeMs||0)));th.messages=th.messages.filter(m=>!gone.includes(m));for(const holder of [phone,store])holder.notifications=(holder.notifications||[]).filter(n=>!(mirrorId&&n.eventId===mirrorId)&&!(n.targetId===th.id&&times.has(Number(n.timeMs||0))))}root.phones[key]=phone}
  if(!removed)return false;saveMetadataRoot(root);if(mirrorId)removeContinuityMirror(mirrorId);else updatePrompt();render();globalThis.toastr?.success?.('Message unsent.');return true;
}
function editAppMessagePopup(appName,tid,mid){
  const hit=findAppThreadMessage(appName,tid,mid);if(!hit)return;const {m}=hit,owner=persona();if(lc(m.sender)!==lc(owner.name)){globalThis.toastr?.warning?.(`Switch to ${m.sender}'s persona to edit this message.`);return}const media=m.type!=='text',fields=media?`<label><span><b>${m.type==='video'?'Video':'Photo'} description</b><small>This remains the AI-visible description.</small></span><textarea class="msg-media-desc">${esc(m.mediaDescription)}</textarea></label><label><span><b>Caption / message</b></span><textarea class="msg-edit-text">${esc(m.text)}</textarea></label>`:`<label><span><b>Message</b></span><textarea class="msg-edit-text">${esc(m.text)}</textarea></label>`,d=popup(`<form method="dialog" class="ghp-message-edit"><header><b>Edit ${esc(APPS[appName].label)} Message</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header>${fields}<button type="button" class="primary" data-save-app-message-edit>Save</button></form>`);d.querySelector('[data-save-app-message-edit]').onclick=()=>{const text=d.querySelector('.msg-edit-text')?.value??'',mediaDescription=d.querySelector('.msg-media-desc')?.value??m.mediaDescription;if((!media&&!String(text).trim())||(media&&!String(mediaDescription).trim())){globalThis.toastr?.warning?.(media?'Media description cannot be empty.':'Message cannot be empty.');return}if(editMirroredAppMessage(appName,tid,mid,{text,mediaDescription}))d.close()};
}
function appMessageActionPopup(appName,tid,mid){
  const hit=findAppThreadMessage(appName,tid,mid);if(!hit)return;const {m}=hit,owner=persona(),mine=lc(m.sender)===lc(owner.name),canUnsend=mine&&!!m.mirrorId,d=popup(`<div class="ghp-message-actions"><header><b>${esc(APPS[appName].label)} Message</b><button data-popup-close><i class="fa-solid fa-xmark"></i></button></header><small class="ghp-action-sender">${esc(m.sender)} · ${esc(timeText(new Date(m.timeMs)))}</small>${mine?'<button class="ghp-popup-action" data-edit-app-message><i class="fa-solid fa-pen"></i><span><b>Edit</b><small>Updates the mirrored app message on both phones.</small></span></button>':''}${canUnsend?'<button class="ghp-popup-action danger" data-unsend-app-message><i class="fa-solid fa-delete-left"></i><span><b>Unsend for everyone</b><small>Removes this message from both app conversations.</small></span></button>':''}<button class="ghp-popup-action danger subtle" data-delete-local-app-message><i class="fa-solid fa-trash"></i><span><b>Delete from this phone</b><small>${mine?'Leaves the other phone copy intact.':`To edit or unsend, switch to ${esc(m.sender)}'s persona.`}</small></span></button></div>`);d.querySelector('[data-popup-close]').onclick=()=>d.close();d.querySelector('[data-edit-app-message]')?.addEventListener('click',()=>{d.close();editAppMessagePopup(appName,tid,mid)});d.querySelector('[data-unsend-app-message]')?.addEventListener('click',()=>{if(confirm('Unsend this message for everyone?')){d.close();unsendAppMessageEverywhere(appName,tid,mid)}});d.querySelector('[data-delete-local-app-message]').onclick=()=>{d.close();deleteAppMessageLocal(appName,tid,mid)};
}
function cancelMessageLongPress(){if(longPressTimer)clearTimeout(longPressTimer);longPressTimer=null;longPressTarget=null;longPressPoint=null}
function messagePressStart(e){
  if(e.button!==undefined&&e.button!==0)return;const bubble=e.target.closest?.('.ghp-msg[data-message-id]');if(!bubble||e.target.closest?.('button,video,a,input,textarea,select'))return;cancelMessageLongPress();
  longPressTarget=bubble;longPressPoint={x:Number(e.clientX||0),y:Number(e.clientY||0)};longPressTimer=setTimeout(()=>{const b=longPressTarget;cancelMessageLongPress();if(b){const appName=b.dataset.messageApp;appName?appMessageActionPopup(appName,b.dataset.threadId,b.dataset.messageId):messageActionPopup(b.dataset.threadId,b.dataset.messageId)}},560);
}
function messagePressMove(e){if(!longPressTimer||!longPressPoint)return;const dx=Number(e.clientX||0)-longPressPoint.x,dy=Number(e.clientY||0)-longPressPoint.y;if(Math.hypot(dx,dy)>12)cancelMessageLongPress()}
function messagePressEnd(){cancelMessageLongPress()}
function messageContextMenu(e){const bubble=e.target.closest?.('.ghp-msg[data-message-id]');if(!bubble||e.target.closest?.('button,video,a,input,textarea,select'))return;e.preventDefault();cancelMessageLongPress();const appName=bubble.dataset.messageApp;appName?appMessageActionPopup(appName,bubble.dataset.threadId,bubble.dataset.messageId):messageActionPopup(bubble.dataset.threadId,bubble.dataset.messageId)}

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
function findSocialPopup(appName){
  const label=APPS[appName]?.label||appName,own=currentIdentity(),d=popup(`<div><header><b>Find on ${esc(label)}</b><button data-popup-close><i class="fa-solid fa-xmark"></i></button></header><p class="ghp-popup-copy">Search an existing Greyhaven identity. This does not add their phone number or change another app.</p><input class="social-search" placeholder="Exact character name"><div class="social-search-result"></div></div>`),input=d.querySelector('.social-search'),result=d.querySelector('.social-search-result');
  d.querySelector('[data-popup-close]').onclick=()=>d.close();
  const update=()=>{const q=lc(input.value),matches=q?identityDirectory().filter(x=>lc(x.name).includes(q)).slice(0,8):[];result.innerHTML=matches.map(who=>{const state=appRelationship(timeline(),who,appName,false),status=appName==='instagram'?(state?.following?'Following':state?.followedBy?'Follows you':'Not following'):appName==='snapchat'?(state?.friends?'Friends':state?.outgoingRequest?'Pending':state?.incomingRequest?'Added you':'Not friends'):(state?.friends?'Friends':state?.outgoingRequest?'Pending':state?.incomingRequest?'Requested you':'Not friends');return`<div class="ghp-row static">${avatarHtml(who)}<span><b>${esc(who.name)}</b><small>${esc(status)}</small></span><button data-social-result="${esc(who.id)}">${appName==='instagram'?(state?.following?'Unfollow':'Follow'):appName==='snapchat'?(state?.incomingRequest?'Accept':state?.friends?'Chat':state?.outgoingRequest?'Pending':'Add'):(state?.incomingRequest?'Accept':state?.friends?'Message':state?.outgoingRequest?'Pending':'Add')}</button></div>`}).join('')||(q?'<small class="ghp-muted">No matching existing identity.</small>':'')};
  input.addEventListener('input',update);result.addEventListener('click',e=>{const b=e.target.closest('[data-social-result]');if(!b)return;const who=identityById(b.dataset.socialResult);if(!who||who.id===own?.id)return;const state=appRelationship(timeline(),who,appName,false);if(appName==='instagram')setInstagramFollowing(own.id,who.id,!state?.following);else if(appName==='snapchat'){if(state?.friends){d.close();return openAppConversation('snapchat',who.id)}setSnapchatFriendRequest(own.id,who.id,state?.incomingRequest?'accept':'request')}else{if(state?.friends){d.close();return openAppConversation('facebook',who.id)}setFacebookFriendRequest(own.id,who.id,state?.incomingRequest?'accept':'request')}update();render()});
}
function createSocialPostPopup(appName,kind='post'){
  const isFacebook=appName==='facebook',isVideoAllowed=appName==='snapchat'||kind==='story',title=appName==='instagram'?(kind==='story'?'New Instagram Story':'New Instagram Post'):appName==='snapchat'?'New Snapchat Story':'New Facebook Post';
  const d=popup(`<form method="dialog" class="ghp-media-form"><header><b>${esc(title)}</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><label><span><b>${isFacebook?'Photo description (optional)':'What does it show?'}</b><small>This is what the AI can understand.</small></span><textarea class="visual"></textarea></label><label><span><b>${isFacebook?'Post text':'Caption'}</b></span><textarea class="caption"></textarea></label>${isVideoAllowed?'<label><span><b>Media type</b></span><select class="media-type"><option value="photo">Photo</option><option value="video">Video</option></select></label>':''}<label class="ghp-file-label"><span><b>Optional local media</b><small>Visual replacement only; AI uses the description.</small></span><input class="media-file" type="file" accept="image/*,video/*"></label><button type="button" class="primary" data-publish-social>Share</button></form>`);
  d.querySelector('[data-publish-social]').onclick=async()=>{const visual=d.querySelector('.visual').value.trim(),caption=d.querySelector('.caption').value.trim(),file=d.querySelector('.media-file').files?.[0],type=d.querySelector('.media-type')?.value||((file?.type||'').startsWith('video/')?'video':'photo');if(!isFacebook&&!visual){globalThis.toastr?.warning?.('Describe the media first.');return}if(isFacebook&&!visual&&!caption)return;const btn=d.querySelector('[data-publish-social]');btn.disabled=true;let mediaKey='',meta=null;if(file){mediaKey=await saveMediaBlob(file);meta=await fileMediaMeta(file,type)}const stamp=now().getTime(),row={id:id(),visual,caption:appName==='facebook'?'':caption,text:appName==='facebook'?caption:'',type,mediaKey,mediaWidth:meta?.width||0,mediaHeight:meta?.height||0,likes:0,comments:[],timeMs:stamp,expiresAt:kind==='story'?stamp+86400000:0};publishAppItem(appName,kind,row);d.close()};
}
function socialCommentPopup(appName,postId){
  const store=appStore(timeline(),appName),post=store.posts.find(x=>x.id===postId);if(!post)return;const d=popup(`<form method="dialog"><header><b>Add comment</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><textarea class="comment" placeholder="Comment as ${esc(persona().name)}"></textarea><button type="button" class="primary" data-save-comment>Post</button></form>`);d.querySelector('[data-save-comment]').onclick=()=>{const text=d.querySelector('.comment').value.trim();if(!text)return;if(updateSharedSocialEngagement(appName,'post',postId,{actor:currentIdentity(),action:'comment',text})){d.close();render()}};
}
function appMediaComposerPopup(appName,threadKey){
  const label=appName==='snapchat'?'Snap':'media message',d=popup(`<form method="dialog" class="ghp-media-form"><header><b>Send ${esc(label)}</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><label><span><b>Media type</b></span><select class="media-type"><option value="photo">Photo</option><option value="video">Video</option></select></label><label><span><b>What does it show?</b><small>This description remains AI-visible.</small></span><textarea class="media-description"></textarea></label><label><span><b>Caption</b><small>Optional.</small></span><textarea class="media-caption"></textarea></label><label class="ghp-file-label"><span><b>Optional local media</b><small>Replaces the placeholder visually.</small></span><input class="media-file" type="file" accept="image/*,video/*"></label><button type="button" class="primary" data-send-app-media>Send</button></form>`);d.querySelector('[data-send-app-media]').onclick=async()=>{const type=d.querySelector('.media-type').value,mediaDescription=d.querySelector('.media-description').value.trim(),text=d.querySelector('.media-caption').value.trim(),file=d.querySelector('.media-file').files?.[0];if(!mediaDescription){globalThis.toastr?.warning?.('Describe the media first.');return}const button=d.querySelector('[data-send-app-media]');button.disabled=true;let mediaKey='',meta=null;if(file){mediaKey=await saveMediaBlob(file);meta=await fileMediaMeta(file,type)}if(sendAppMessage(appName,threadKey,{type,text,mediaDescription,mediaKey,mediaWidth:meta?.width||0,mediaHeight:meta?.height||0}))d.close()};
}
function composeSnapPopup(saved=null){
  const t=timeline(),friends=identityDirectory({includeProvisional:true}).filter(who=>appRelationship(t,who,'snapchat',false)?.friends);if(!friends.length){const d=popup(`<div><header><b>Send a Snap</b><button data-popup-close><i class="fa-solid fa-xmark"></i></button></header><p class="ghp-popup-copy">No Snapchat friends are available yet. Add a friend from the Chats tab, then tap the camera circle again.</p></div>`);d.querySelector('[data-popup-close]').onclick=()=>d.close();return}
  const d=popup(`<form method="dialog" class="ghp-media-form"><header><b>Send a Snap</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><label><span><b>To</b></span><select class="snap-to">${friends.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label><label><span><b>Media type</b></span><select class="media-type"><option value="photo" ${saved?.type==='photo'?'selected':''}>Photo</option><option value="video" ${saved?.type==='video'?'selected':''}>Video</option></select></label><label><span><b>What does it show?</b></span><textarea class="media-description">${esc(saved?.mediaDescription||saved?.visual||'')}</textarea></label><label><span><b>Caption</b></span><textarea class="media-caption">${esc(saved?.caption||'')}</textarea></label>${saved?.mediaKey?'':`<label class="ghp-file-label"><span><b>Optional local media</b></span><input class="media-file" type="file" accept="image/*,video/*"></label>`}<button type="button" class="primary" data-send-snap>Send Snap</button></form>`);
  d.querySelector('[data-send-snap]').onclick=async()=>{const peer=identityById(d.querySelector('.snap-to').value),type=d.querySelector('.media-type').value,mediaDescription=d.querySelector('.media-description').value.trim(),text=d.querySelector('.media-caption').value.trim(),file=d.querySelector('.media-file')?.files?.[0];if(!peer||!mediaDescription)return;let mediaKey=saved?.mediaKey||'',meta={width:saved?.mediaWidth||0,height:saved?.mediaHeight||0};if(file){mediaKey=await saveMediaBlob(file);meta=await fileMediaMeta(file,type)||meta}const th=ensureAppThreadIn(timeline(),'snapchat',peer);persist(timeline(),false);if(sendAppMessage('snapchat',th.id,{type,text,mediaDescription,mediaKey,mediaWidth:meta.width||0,mediaHeight:meta.height||0})){app='snapchat';appView='thread';itemId=th.id;d.close();render()}};
}
function openSnapMessage(threadKey,messageId){
  const t=timeline(),th=appThread('snapchat',threadKey,t),m=th?.messages.find(x=>x.id===messageId);if(!m)return;m.opened=true;m.read=true;for(const n of t.notifications)if(n.app==='snapchat'&&(n.targetId===threadKey||n.eventId===m.mirrorId))n.read=true;persist(t,false);render();
}
function attachAppMediaPopup(appName,threadKey,messageId){
  const m=appThread(appName,threadKey,timeline())?.messages.find(x=>x.id===messageId);if(!m||!['photo','video'].includes(m.type))return;const label=m.type==='video'?'video':'photo',accept=m.type==='video'?'video/*':'image/*',d=popup(`<form method="dialog" class="ghp-media-form"><header><b>${m.mediaKey?'Replace':'Attach'} local preview</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><p class="ghp-popup-copy">The AI continues to use the existing written description. This changes only the phone's visual preview.</p><label class="ghp-local-file-picker"><input class="media-file" type="file" accept="${accept}"><span><i class="fa-solid fa-photo-film"></i><b>Choose ${label}</b><small data-local-file-name>No file selected</small></span></label><button type="button" class="primary" data-save-app-preview>Save preview</button></form>`),input=d.querySelector('.media-file'),fileName=d.querySelector('[data-local-file-name]');input.addEventListener('change',()=>fileName.textContent=input.files?.[0]?.name||'No file selected');d.querySelector('[data-save-app-preview]').onclick=async()=>{const file=input.files?.[0];if(!file){globalThis.toastr?.warning?.(`Choose a ${label} first.`);return}const button=d.querySelector('[data-save-app-preview]');button.disabled=true;button.textContent='Saving…';const mediaKey=await saveMediaBlob(file),meta=await fileMediaMeta(file,m.type),root=metadataRoot(),mirrorId=m.mirrorId,active=timeline();for(const raw of Object.values(root?.phones||{})){const phone=normalizeTimeline(raw);for(const th of Object.values(appStore(phone,appName)?.threads||{}))for(const row of th.messages||[])if((mirrorId&&row.mirrorId===mirrorId)||phone===active&&th.id===threadKey&&row.id===messageId){row.mediaKey=mediaKey;row.mediaWidth=meta?.width||0;row.mediaHeight=meta?.height||0}}if(root)saveMetadataRoot(root);d.close();render()};
}
function saveSnapMemory(threadKey,messageId){
  const t=timeline(),m=appThread('snapchat',threadKey,t)?.messages.find(x=>x.id===messageId);if(!m||!m.opened)return;const key=m.mirrorId||m.id;if(t.snapchat.memories.some(x=>x.originId===key)){globalThis.toastr?.info?.('Already saved to Memories.');return}t.snapchat.memories.unshift({id:id(),originId:key,type:m.type,mediaDescription:m.mediaDescription,caption:m.text,mediaKey:m.mediaKey,mediaWidth:m.mediaWidth,mediaHeight:m.mediaHeight,timeMs:m.timeMs,sender:m.sender});m.saved=true;persist(t,false);globalThis.toastr?.success?.('Saved to Memories.');render();
}
function moveSnapToEyes(savedId){mutate(t=>{const index=t.snapchat.memories.findIndex(x=>x.id===savedId);if(index<0)return;const [row]=t.snapchat.memories.splice(index,1);t.snapchat.eyesOnly.unshift({...row,id:id(),movedToEyesAt:Date.now()})},false);render()}
function deleteSavedSnap(section,savedId){mutate(t=>{const list=section==='eyesOnly'?t.snapchat.eyesOnly:t.snapchat.memories;t.snapchat[section]=list.filter(x=>x.id!==savedId)},false);render()}
function uploadPrivateMediaPopup(section='memories'){
  const eyes=section==='eyes',d=popup(`<form method="dialog" class="ghp-media-form"><header><b>Add to ${eyes?'My Eyes Only':'Memories'}</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><label><span><b>What does it show?</b><small>Private description stored on this phone.</small></span><textarea class="media-description"></textarea></label><label class="ghp-file-label"><span><b>Choose photo or video</b></span><input class="media-file" type="file" accept="image/*,video/*"></label><button type="button" class="primary" data-save-private>Save</button></form>`);d.querySelector('[data-save-private]').onclick=async()=>{const description=d.querySelector('.media-description').value.trim(),file=d.querySelector('.media-file').files?.[0];if(!description||!file){globalThis.toastr?.warning?.('Add a description and choose media.');return}const type=(file.type||'').startsWith('video/')?'video':'photo',mediaKey=await saveMediaBlob(file),meta=await fileMediaMeta(file,type),row={id:id(),type,mediaDescription:description,caption:'',mediaKey,mediaWidth:meta?.width||0,mediaHeight:meta?.height||0,timeMs:now().getTime(),manual:true};mutate(t=>(eyes?t.snapchat.eyesOnly:t.snapchat.memories).unshift(row),false);d.close();render()};
}
function socialThreadMenuPopup(appName,threadKey){
  const t=timeline(),th=appThread(appName,threadKey,t),peer=appPeer(th),state=peer?appRelationship(t,peer,appName):null;if(!th||!peer||!state)return;const blocked=!!state.blocked,unfriend=appName==='snapchat'&&state.friends?`<button class="ghp-popup-action danger subtle" data-unfriend-snapchat><i class="fa-solid fa-user-minus"></i><span><b>Remove friend</b><small>Removes the friendship on both Snapchat accounts only.</small></span></button>`:'',d=popup(`<div><header><b>${esc(peer.name)}</b><button data-popup-close><i class="fa-solid fa-xmark"></i></button></header>${unfriend}<button class="ghp-popup-action danger" data-toggle-social-block><i class="fa-solid fa-ban"></i><span><b>${blocked?'Unblock':'Block'} in ${esc(APPS[appName].label)}</b><small>Does not change Messages, Phone, or other apps.</small></span></button><button class="ghp-popup-action danger subtle" data-delete-social-thread><i class="fa-solid fa-trash"></i><span><b>Delete conversation</b><small>Only this app thread is removed from this phone.</small></span></button></div>`);d.querySelector('[data-popup-close]').onclick=()=>d.close();d.querySelector('[data-unfriend-snapchat]')?.addEventListener('click',()=>{if(!confirm(`Remove ${peer.name} as a Snapchat friend?`))return;setSnapchatFriendRequest(currentIdentity().id,peer.id,'remove',{notify:false});d.close();render()});d.querySelector('[data-toggle-social-block]').onclick=()=>{state.blocked=!blocked;const other=phoneForIdentity(peer,true),owner=currentIdentity(),otherState=other?ensureRelationship(other.timeline,owner)?.apps?.[appName]:null;if(otherState)otherState.blockedBy=!blocked;persist(t,false);if(other){other.root.phones[other.key]=other.timeline;saveMetadataRoot(other.root)}d.close();render()};d.querySelector('[data-delete-social-thread]').onclick=()=>{const store=appStore(t,appName);delete store.threads[threadKey];store.threadOrder=store.threadOrder.filter(x=>x!==threadKey);t.notifications=t.notifications.filter(n=>!(n.app===appName&&n.targetId===threadKey));persist(t,false);appView=appName==='instagram'?'dms':appName==='snapchat'?'chats':appName==='facebook'?'messenger':'messages';itemId='';d.close();render()};
}
function createMarketplaceListingPopup(){
  const d=popup(`<form method="dialog" class="ghp-media-form"><header><b>Sell on Marketplace</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><label><span><b>Title</b></span><input class="market-title" placeholder="Used PS5"></label><label><span><b>Description</b></span><textarea class="market-description" placeholder="Condition, what is included, reason for selling…"></textarea></label><label><span><b>Price</b></span><input class="market-price" placeholder="€320"></label><label><span><b>Area</b></span><input class="market-area" placeholder="Greyhaven Downtown"></label><label><span><b>Listing photo description</b><small>This is what buyer AI can understand.</small></span><textarea class="market-visual" placeholder="A black PS5 and controller on a wooden desk…"></textarea></label><label class="ghp-file-label"><span><b>Optional local photo</b><small>Visual replacement only.</small></span><input class="market-file" type="file" accept="image/*"></label><button type="button" class="primary" data-publish-market-listing>Publish listing</button></form>`);
  d.querySelector('[data-publish-market-listing]').onclick=async()=>{const title=d.querySelector('.market-title').value.trim(),description=d.querySelector('.market-description').value.trim(),price=d.querySelector('.market-price').value.trim(),area=d.querySelector('.market-area').value.trim(),visual=d.querySelector('.market-visual').value.trim(),file=d.querySelector('.market-file').files?.[0];if(!title||!price){globalThis.toastr?.warning?.('Add at least a title and price.');return}const button=d.querySelector('[data-publish-market-listing]');button.disabled=true;button.textContent='Publishing…';let mediaKey='',meta=null;if(file){mediaKey=await saveMediaBlob(file);meta=await fileMediaMeta(file,'photo')}const market=sharedMarketplace(),row=addMarketplaceListing(market,{title,description,price,area,visual,mediaKey,mediaWidth:meta?.width||0,mediaHeight:meta?.height||0},{ownerListing:true});if(!row){button.disabled=false;button.textContent='Publish listing';globalThis.toastr?.warning?.('That listing already exists.');return}market.listings.unshift(row);saveSharedMarketplace(market);d.close();app='facebook';appView='marketplace';itemId='';render();globalThis.toastr?.success?.('Marketplace listing published for every persona phone.')};
}
function marketMessagePopup(listingId,kind='question'){
  const row=sharedMarketplace().listings.find(x=>x.id===listingId),seller=row?identityById(row.sellerIdentityId):null;if(!row||!seller||row.status!=='available')return;const starters={question:`Hi, is the ${row.title} still available?`,offer:`Hi, would you take a lower offer for the ${row.title}?`,buy:`Hi, I'd like to buy the ${row.title}. Is it still available?`,pickup:`Hi, where and when could I pick up the ${row.title}?`},d=popup(`<form method="dialog"><header><b>Message ${esc(seller.name)}</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><textarea class="market-message">${esc(starters[kind]||starters.question)}</textarea><button type="button" class="primary" data-send-market-message>Send in Messenger</button></form>`);d.querySelector('[data-send-market-message]').onclick=()=>{const text=d.querySelector('.market-message').value.trim();if(!text)return;const th=ensureAppThreadIn(timeline(),'facebook',seller);persist(timeline(),false);if(sendAppMessage('facebook',th.id,{type:'text',text})){app='facebook';appView='thread';itemId=th.id;d.close();render()}};
}
function marketLinkPopup(listingId){
  const market=sharedMarketplace(),row=market.listings.find(x=>x.id===listingId);if(!row||row.sellerType!=='provisional')return;const d=popup(`<div><header><b>Link Marketplace identity</b><button data-popup-close><i class="fa-solid fa-xmark"></i></button></header><p class="ghp-popup-copy">This is a manual identity decision. Matching the seller's name is not enough.</p><input class="link-name" placeholder="Exact existing character name"><div class="link-result"></div></div>`),input=d.querySelector('.link-name'),result=d.querySelector('.link-result');d.querySelector('[data-popup-close]').onclick=()=>d.close();input.addEventListener('input',()=>{const q=lc(input.value),matches=identityDirectory().filter(x=>lc(x.name)===q);result.innerHTML=matches.map(x=>`<div class="ghp-row static">${avatarHtml(x)}<span><b>${esc(x.name)}</b><small>Existing identity</small></span><button data-confirm-market-link="${esc(x.id)}">Link</button></div>`).join('')||(q?'<small class="ghp-muted">Enter one exact existing name.</small>':'')});result.addEventListener('click',e=>{const b=e.target.closest('[data-confirm-market-link]'),who=identityById(b?.dataset.confirmMarketLink);if(!who)return;if(!confirm(`Link this provisional seller to ${who.name}?`))return;const old=row.sellerIdentityId;row.sellerIdentityId=who.id;row.sellerName=who.name;row.sellerType='existing';row.linkedManually=true;row.linkedFromIdentityId=old;row.signature=marketplaceListingSignature(row);saveSharedMarketplace(market);d.close();render()});
}
function closeOwnedMarketplaceListing(listingId,status='removed'){
  const market=sharedMarketplace(),index=market.listings.findIndex(x=>x.id===listingId),row=market.listings[index],owner=currentIdentity();if(index<0||!row||row.sellerIdentityId!==owner?.id)return false;market.listings.splice(index,1);const stamp=Date.now(),archived={...row,status:status==='sold'?'sold':'removed'};if(status==='sold')archived.soldAt=stamp;else archived.removedAt=stamp;market.archived.unshift(archived);market.archived=market.archived.slice(0,120);saveSharedMarketplace(market);itemId='';appView='marketplace';render();globalThis.toastr?.success?.(status==='sold'?'Listing marked as sold.':'Listing removed.');return true;
}
function postPopup(){return createSocialPostPopup('instagram','post')}
function notePopup(nid=''){
  const t=timeline(),n=t.notes.find(x=>x.id===nid),d=popup(`<form method="dialog"><header><b>${n?'Edit Note':'New Note'}</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><input class="note-title" value="${esc(n?.title||'')}" placeholder="Title"><textarea class="note-body" placeholder="Note…">${esc(n?.body||'')}</textarea><button type="button" class="primary" data-save-note>Save</button></form>`);
  d.querySelector('[data-save-note]').onclick=()=>{const title=d.querySelector('.note-title').value.trim(),body=d.querySelector('.note-body').value.trim();if(!title&&!body)return;mutate(t=>{let x=t.notes.find(v=>v.id===nid);if(x){x.title=title;x.body=body;x.updatedAt=Date.now()}else t.notes.unshift({id:id(),title,body,timeMs:now().getTime(),updatedAt:Date.now()})},false);d.close();render()};
}
function openMail(mid){const t=timeline(),m=t.mail.find(x=>x.id===mid);if(!m)return;m.read=true;persist(t,false);const d=popup(`<div><header><b>${esc(m.subject)}</b><button data-popup-close><i class="fa-solid fa-xmark"></i></button></header><small>From: ${esc(m.from)}</small><p>${esc(m.body)}</p></div>`);d.querySelector('[data-popup-close]').onclick=()=>d.close()}
function notification(nid){
  const t=timeline(),n=t.notifications.find(x=>x.id===nid);if(!n)return;n.read=true;unlocked=true;const appName=n.app==='social'?'instagram':n.app==='snap'?'snapchat':n.app;
  if(appName==='messages'&&n.targetId){app='thread';threadId=n.targetId}
  else if(appName==='phone'&&n.targetId){const c=t.calls.find(x=>x.id===n.targetId);if(c&&c.status==='incoming'){c.status='active';callId=c.id;app='call';updateSharedCallStatus(c.sharedCallId,'active')}else app='phone'}
  else if(appName==='mail')app='mail';
  else if(['instagram','snapchat','facebook','onlyfans','darkweb'].includes(appName)){app=appName;if(n.targetId&&appStore(t,appName)?.threads?.[n.targetId]){const target=appStore(t,appName).threads[n.targetId];appView=appName==='onlyfans'&&String(n.eventId||'').startsWith('onlyfans-video:')&&target.videoActive?'video':'thread';itemId=n.targetId}else if(appName==='facebook'&&n.eventId&&sharedMarketplace().listings.some(x=>x.id===n.eventId)){appView='listing';itemId=n.eventId}else appView=appName==='snapchat'?'chats':appName==='onlyfans'?'activity':appName==='darkweb'?'messages':'notifications'}
  else if(appName==='dominos'){app='dominos';appView='orders';itemId=n.eventId||''}
  else if(appName==='uber'){app='uber';appView='ride';itemId=n.eventId||''}
  persist(t,false);render();
}
function saveSettings(){
  const o=document.querySelector('#ghp-overlay'),apps={...profile().apps,settings:true};o.querySelectorAll('[data-app-setting]').forEach(x=>apps[x.dataset.appSetting]=x.checked);
  saveProfile({wallpaper:o.querySelector('#ghp-wall')?.value||'aurora',wallpaperUrl:o.querySelector('#ghp-wall-url')?.value.trim()||'',lockScreen:o.querySelector('#ghp-lock-setting')?.checked??true,notificationPreviews:o.querySelector('#ghp-preview-setting')?.checked??true,refreshMode:o.querySelector('#ghp-refresh-mode')?.value||'manual',staleAfterMessages:Number(o.querySelector('#ghp-stale')?.value||12),maxNewEvents:Number(o.querySelector('#ghp-max-events')?.value||4),activityLevel:o.querySelector('#ghp-activity')?.value||'normal',apps});globalThis.toastr?.success?.('Phone settings saved.');
}
function click(e){
  const x=e.target.closest('button,[data-thread],[data-contact],[data-story],[data-note],[data-mail]');if(!x)return;
  if(x.matches('[data-close]'))return closePhone();if(x.matches('[data-unlock]')){unlocked=true;app='';return render()}if(x.matches('[data-back]'))return goBack()
  if(x.dataset.openApp)return openApp(x.dataset.openApp);if(x.matches('[data-refresh]'))return refreshPhone();if(x.matches('[data-new-thread]'))return newThreadPopup();
  if(x.dataset.appView){appView=x.dataset.appView;itemId='';return render()}
  if(x.dataset.openSocialThread){const appName=x.dataset.openSocialThread,identityId=x.dataset.socialIdentity;if(identityId)return openAppConversation(appName,identityId);app=appName;appView='thread';itemId=x.dataset.socialThread||'';return render()}
  if(x.dataset.socialThreadMenu)return socialThreadMenuPopup(x.dataset.socialThreadMenu,x.dataset.socialThreadId);
  if(x.dataset.findSocial)return findSocialPopup(x.dataset.findSocial);
  if(x.dataset.instagramFollow){const who=identityById(x.dataset.instagramFollow),state=who?appRelationship(timeline(),who,'instagram',false):null;if(who)setInstagramFollowing(currentIdentity().id,who.id,!state?.following);return render()}
  if(x.dataset.instagramRemoveFollower){const who=identityById(x.dataset.instagramRemoveFollower);if(who&&confirm(`Remove ${who.name} from your Instagram followers?`))removeInstagramFollower(currentIdentity().id,who.id);return render()}
  if(x.dataset.instagramPeople){app='instagram';appView='people';itemId=x.dataset.instagramPeople;return render()}
  if(x.dataset.instagramStory){app='instagram';appView='story';itemId=x.dataset.instagramStory;return render()}
  if(x.dataset.instagramLike){updateSharedSocialEngagement('instagram','post',x.dataset.instagramLike,{actor:currentIdentity(),action:'toggle-like'});return render()}
  if(x.dataset.instagramComment)return socialCommentPopup('instagram',x.dataset.instagramComment);
  if(x.matches('[data-new-instagram-post]'))return createSocialPostPopup('instagram','post');if(x.matches('[data-instagram-create-story]'))return createSocialPostPopup('instagram','story');
  if(x.dataset.snapAdd){setSnapchatFriendRequest(currentIdentity().id,x.dataset.snapAdd,'request');return render()}if(x.dataset.snapAccept){setSnapchatFriendRequest(currentIdentity().id,x.dataset.snapAccept,'accept');return render()}if(x.dataset.snapDecline){setSnapchatFriendRequest(currentIdentity().id,x.dataset.snapDecline,'decline',{notify:false});return render()}if(x.dataset.snapRemove){const who=identityById(x.dataset.snapRemove);if(who&&confirm(`Remove ${who.name} as a Snapchat friend?`))setSnapchatFriendRequest(currentIdentity().id,who.id,'remove',{notify:false});return render()}
  if(x.matches('[data-compose-snap]'))return composeSnapPopup();if(x.dataset.snapStory){app='snapchat';appView='story';itemId=x.dataset.snapStory;return render()}if(x.matches('[data-snap-create-story]'))return createSocialPostPopup('snapchat','story');
  if(x.dataset.openSnapMessage)return openSnapMessage(x.dataset.openSnapThread,x.dataset.openSnapMessage);if(x.dataset.saveSnapMessage)return saveSnapMemory(x.dataset.saveSnapThread,x.dataset.saveSnapMessage);
  if(x.dataset.appLinkMedia)return attachAppMediaPopup(x.dataset.appLinkMedia,x.dataset.appLinkThread,x.dataset.appLinkMessage);if(x.dataset.moveSnapEyes)return moveSnapToEyes(x.dataset.moveSnapEyes);
  if(x.dataset.deleteSavedSnap)return deleteSavedSnap(x.dataset.savedSection,x.dataset.deleteSavedSnap);if(x.dataset.sendSavedSnap){const list=x.dataset.savedSection==='eyesOnly'?timeline().snapchat.eyesOnly:timeline().snapchat.memories;return composeSnapPopup(list.find(v=>v.id===x.dataset.sendSavedSnap))}if(x.dataset.uploadPrivate)return uploadPrivateMediaPopup(x.dataset.uploadPrivate);
  if(x.dataset.facebookAccept){setFacebookFriendRequest(currentIdentity().id,x.dataset.facebookAccept,'accept');return render()}if(x.dataset.facebookDecline){setFacebookFriendRequest(currentIdentity().id,x.dataset.facebookDecline,'decline',{notify:false});return render()}
  if(x.dataset.facebookLike){updateSharedSocialEngagement('facebook','post',x.dataset.facebookLike,{actor:currentIdentity(),action:'toggle-like'});return render()}if(x.dataset.facebookComment)return socialCommentPopup('facebook',x.dataset.facebookComment);if(x.matches('[data-new-facebook-post]'))return createSocialPostPopup('facebook','post');
  if(x.matches('[data-marketplace-refresh]'))return refreshMarketplace();if(x.matches('[data-new-market-listing]'))return createMarketplaceListingPopup();if(x.dataset.marketListing){app='facebook';appView='listing';itemId=x.dataset.marketListing;return render()}if(x.dataset.marketMessage){const row=sharedMarketplace().listings.find(v=>v.id===x.dataset.marketMessage);if(row)return openAppConversation('facebook',row.sellerIdentityId)}if(x.dataset.marketAction)return marketMessagePopup(x.dataset.marketActionListing,x.dataset.marketAction);if(x.dataset.marketLink)return marketLinkPopup(x.dataset.marketLink);if(x.matches('[data-market-mark-sold]')){if(confirm('Mark this listing as sold and remove it from the active Marketplace?'))closeOwnedMarketplaceListing(itemId,'sold');return}if(x.matches('[data-market-remove-listing]')){if(confirm('Remove this listing from Marketplace?'))closeOwnedMarketplaceListing(itemId,'removed');return}
  if(x.dataset.dominosCategory){app='dominos';appView='menu';itemId=x.dataset.dominosCategory;return render()}
  if(x.dataset.dominosAdd){updateDominosCart(x.dataset.dominosAdd,1);globalThis.toastr?.success?.('Added to cart.');return}
  if(x.dataset.dominosQuantity){updateDominosCart(x.dataset.dominosItem,Number(x.dataset.dominosQuantity));return}
  if(x.matches('[data-dominos-checkout]'))return dominosCheckoutPopup();
  if(x.matches('[data-toggle-dominos-worker]')){const identity=currentIdentity(),roles=globalAppRoles(),assigned=roles.dominos.deliveryWorkerId===identity.id,existing=identityById(roles.dominos.deliveryWorkerId);if(!assigned&&existing&&!confirm(`Replace ${existing.name} as the global Domino's delivery worker?`))return;setGlobalServiceRole('dominos','deliveryWorker',identity,!assigned);globalThis.toastr?.success?.(assigned?'Delivery-worker assignment removed.':`${identity.name} is now the global delivery worker.`);return render()}
  if(x.dataset.dominosStatus){const orderId=x.closest('[data-service-order]')?.dataset.serviceOrder||itemId;if(!orderId)return;if(x.dataset.dominosStatus==='cancelled'&&!confirm('Cancel this Domino\'s order?'))return;setDominosOrderStatus(orderId,x.dataset.dominosStatus);return}
  if(x.matches('[data-request-uber]'))return uberRequestPopup();
  if(x.matches('[data-toggle-uber-driver]')){const identity=currentIdentity(),assigned=globalAppRoles().uber.driverIds.includes(identity.id);setGlobalServiceRole('uber','driver',identity,!assigned);globalThis.toastr?.success?.(assigned?'Uber-driver assignment removed.':`${identity.name} is now an Uber driver in every chat.`);return render()}
  if(x.dataset.uberStatus){const rideId=x.closest('[data-service-ride]')?.dataset.serviceRide||itemId;if(!rideId)return;if(x.dataset.uberStatus==='cancelled'&&!confirm('Cancel this Uber ride?'))return;setUberRideStatus(rideId,x.dataset.uberStatus);return}
  if(x.dataset.onlyfansCreator){app='onlyfans';appView='creator';itemId=x.dataset.onlyfansCreator;return render()}
  if(x.dataset.onlyfansSubscribe){const creator=identityById(x.dataset.onlyfansSubscribe),owner=currentIdentity();if(creator&&owner)setOnlyFansSubscription(owner,creator,!isOnlyFansSubscribed(owner.id,creator.id));return}
  if(x.matches('[data-new-onlyfans-post]'))return onlyFansPostPopup();
  if(x.matches('[data-toggle-onlyfans-creator]')){const identity=currentIdentity(),active=!!onlyFansAccount(identity,false),price=document.querySelector('#ghp-overlay .onlyfans-price')?.value||null;if(active&&!confirm('Disable this creator account? Its established history will be preserved for later re-enabling.'))return;try{setOnlyFansCreator(identity,!active,price);globalThis.toastr?.success?.(active?'Creator account disabled.':'Creator account enabled globally with an established history.')}catch(error){globalThis.toastr?.error?.(error?.message||String(error))}return render()}
  if(x.dataset.onlyfansVideo)return startOnlyFansVideo(x.dataset.onlyfansVideo);if(x.matches('[data-end-onlyfans-video]'))return endOnlyFansVideo();
  if(x.matches('[data-darkweb-refresh]'))return refreshDarkWeb();
  if(x.dataset.darkwebListing){app='darkweb';appView='listing';itemId=x.dataset.darkwebListing;return render()}
  if(x.dataset.darkwebMessage)return openAppConversation('darkweb',x.dataset.darkwebMessage);if(x.dataset.darkwebProvider)return openAppConversation('darkweb',x.dataset.darkwebProvider);if(x.matches('[data-save-dark-roles]'))return saveDarkWebRolesFromUi();
  if(x.dataset.appMedia)return appMediaComposerPopup(x.dataset.appMedia,x.dataset.appMediaThread);
  if(x.dataset.thread){threadId=x.dataset.thread;app='thread';return render()}if(x.matches('[data-add-contact]'))return addContactPopup();if(x.matches('[data-discover]')){seedContacts(true);globalThis.toastr?.success?.('Relevant contacts refreshed.');return render()}if(x.matches('[data-removed-contacts]'))return restoreContactsPopup();
  if(x.dataset.contact){contactId=x.dataset.contact;app='contact';return render()}if(x.dataset.messageContact){const th=directThread(x.dataset.messageContact);threadId=th.id;app='thread';return render()}if(x.dataset.removeContact)return removeContact(x.dataset.removeContact);
  if(x.dataset.threadMenu)return threadMenuPopup(x.dataset.threadMenu);if(x.dataset.mediaMenu)return mediaMenuPopup(x.dataset.mediaMenu);if(x.dataset.linkMedia)return attachExistingMediaPopup(x.dataset.linkThread,x.dataset.linkMedia,x.dataset.linkKind||'photo');if(x.matches('[data-cancel-media-request]')){composeRequest={threadId:'',kind:''};return render()}
  if(x.dataset.call)return startCall(x.dataset.call);if(x.matches('[data-end-call]'))return endCall();if(x.dataset.story){itemId=x.dataset.story;app='instagram';appView='story';return render()}
  if(x.matches('[data-new-post]'))return postPopup();if(x.matches('[data-new-note]'))return notePopup();if(x.dataset.note)return notePopup(x.dataset.note);if(x.dataset.mail)return openMail(x.dataset.mail);if(x.matches('[data-save-settings]'))return saveSettings();
  if(x.matches('[data-reset-phone]')){if(confirm(`Reset ${persona().name}'s phone timeline in this chat?`)){const r=metadataRoot();r.phones[persona().key]=defaultTimeline(persona().name,persona().avatar);saveMetadataRoot(r);app='';threadId='';contactId='';composeRequest={threadId:'',kind:''};render();globalThis.toastr?.success?.('Phone timeline reset.')}return}
  if(x.dataset.notif)return notification(x.dataset.notif);
}
function change(e){
  const x=e.target,k=x.dataset.favorite||x.dataset.muted||x.dataset.blocked||x.dataset.locationSharing||x.dataset.nickname;if(!k)return;let blockPeer=null;
  mutate(t=>{const c=t.contacts[k];if(!c)return;if(x.dataset.favorite)c.favorite=x.checked;else if(x.dataset.muted)c.muted=x.checked;else if(x.dataset.blocked){c.blocked=x.checked;blockPeer={...c}}else if(x.dataset.locationSharing)c.locationSharing=x.value;else if(x.dataset.nickname)c.nickname=x.value.trim()},false);
  if(blockPeer&&x.dataset.blocked){const own=persona();syncCrossPhoneBlock(own.name,own.avatar,blockPeer.name,blockPeer.avatar,blockPeer.personaDescription,x.checked);render()}
}
function submit(e){
  e.preventDefault();const f=e.target;
  if(f.dataset.threadForm){const input=f.querySelector('input'),v=input.value;input.value='';const request=composeRequest.threadId===f.dataset.threadForm?composeRequest.kind:'';composeRequest={threadId:'',kind:''};sendThread(f.dataset.threadForm,v,'text',{requestMedia:request})}
  if(f.dataset.callForm){const input=f.querySelector('input'),v=input.value;input.value='';sendThread(f.dataset.callForm,v,'call')}
  if(f.dataset.appThreadForm){const input=f.querySelector('input'),value=input.value;input.value='';sendAppMessage(f.dataset.appThreadForm,f.dataset.appThreadId,{type:'text',text:value})}
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
  if(!hasChat())return'';const snap=continuitySnapshot(),legacy=legacyPhoneHistory(),fresh=snap.fresh,planIds=new Set(fresh.filter(e=>e.persistent).map(e=>e.id)),plans=snap.plans.filter(e=>!planIds.has(e.id)),older=snap.history.filter(e=>!e.persistent).slice(-5),services=activeServicePromptSummary();
  if(!fresh.length&&!plans.length&&!older.length&&!legacy.length&&!services)return'';
  const sections=[],cp=snap.checkpoint||{};
  if(services)sections.push(services);
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
- Active Domino's and Uber state above is authoritative: an arrival belongs to exactly one order or ride, and a completed/cancelled service must never arrive or run again. Do not expose internal service identifiers in visible roleplay.
- Do not mechanically recap phone history; use it only when it naturally affects the scene.`;
}
function markRoleplayCheckpointIfAdvanced(){
  const box=continuityRoot(),c=ctx();if(!box||!Array.isArray(c?.chat)||!c.chat.length)return;const len=c.chat.length,last=c.chat.at(-1),cp=box.state.rpCheckpoint||{};
  if(last?.is_user||len===Number(cp.chatLength||0))return;markRoleplayCheckpoint();
}

function identityPromptSummary(){
  if(!hasChat())return'';ensureAllIdentities();const identities=new Map(),add=x=>{if(x?.id&&validPhoneNumber(x.phoneNumber))identities.set(x.id,x)};add(currentIdentity());for(const descriptor of chatDescriptors())add(identityForName(descriptor.name,{create:true}));
  const latest=latestUserText();for(const identity of Object.values(settingsRoot().identities||{})){const name=norm(identity?.name);if(!name)continue;const q=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(new RegExp(`(^|[^\\p{L}\\p{N}])${q}([^\\p{L}\\p{N}]|$)`,'iu').test(latest))add(normalizeIdentity(identity,identity.id))}
  const rows=[...identities.values()].slice(0,14).map(x=>`${x.name}: ${x.phoneNumber}`);if(!rows.length)return'';
  return`[Greyhaven Phone — authoritative identity and phone-number facts.]
${rows.join('\n')}

RULES:
- These exact 9-digit values are persistent Greyhaven phone numbers. A person always remembers their own number and must use it if directly asked; never invent a different number.
- Do not invent, expand, or guess surnames. Preserve the exact character names above.
- Knowing or meeting somebody does not mean possessing their number. A person may reveal their own number or explicitly exchange numbers when it fits the relationship and scene.
- An explicit mutual number exchange can use a hidden GH_ACTION contact.exchange marker; merely mentioning, following, or meeting somebody cannot.
- Do not expose technical identity IDs or action syntax in visible roleplay.`;
}
function updatePrompt(){
  const c=ctx();if(!c?.setExtensionPrompt)return;const summary=hasChat()?phonePromptSummary():'',identities=hasChat()?identityPromptSummary():'';
  try{c.setExtensionPrompt(GHP_PROMPT_KEY,summary,GHP_PROMPT_POSITION_IN_CHAT,1,false,GHP_PROMPT_ROLE_SYSTEM);c.setExtensionPrompt(GHP_IDENTITY_PROMPT_KEY,identities,GHP_PROMPT_POSITION_IN_CHAT,1,false,GHP_PROMPT_ROLE_SYSTEM)}catch(e){console.error(`[${GHP_MODULE}] setExtensionPrompt`,e)}
}
function characterManagementIdentity(){
  const c=ctx(),name=document.querySelector('#character_name_pole')?.value?.trim();if(!c?.characters?.length)return null;let index=name?c.characters.findIndex(ch=>norm(ch?.name)===norm(name)):-1;if(index<0&&Number.isInteger(Number(c.characterId)))index=Number(c.characterId);return index>=0&&c.characters[index]?identityForCharacter(c.characters[index],index,true):null;
}
function propagateIdentityNumber(identity){
  const root=metadataRoot();if(!root||!identity)return;for(const [key,raw] of Object.entries(root.phones||{})){const t=normalizeTimeline(raw);for(const co of Object.values(t.contacts||{}))if(co.identityId===identity.id){co.phoneNumber=identity.phoneNumber;const reln=ensureRelationship(t,identity);if(reln)reln.knownContactInfo.phoneNumber=co.saved===true}root.phones[key]=t}saveMetadataRoot(root);
}
function characterPhonePopup(identity){
  const d=popup(`<form method="dialog"><header><b>Greyhaven Phone · ${esc(identity.name)}</b><button value="cancel"><i class="fa-solid fa-xmark"></i></button></header><p class="ghp-popup-copy">One persistent number is shared by Contacts, Messages and every enabled social app identity. It does not automatically add this character to anyone's contacts.</p><label><span><b>Phone number</b><small>Exactly 9 digits</small></span><input class="character-phone-number" inputmode="numeric" maxlength="9" value="${esc(identity.phoneNumber)}"></label><div class="ghp-inline-actions"><button type="button" data-save-character-phone class="primary">Save number</button><button type="button" data-generate-character-phone>Generate new number</button></div></form>`),input=d.querySelector('.character-phone-number');input.addEventListener('input',()=>input.value=cleanPhoneNumber(input.value));d.querySelector('[data-save-character-phone]').onclick=()=>{try{const updated=updateIdentityNumber(identity.id,input.value);propagateIdentityNumber(updated);d.close();installCharacterPhoneEditor();globalThis.toastr?.success?.(`${updated.name}'s phone number saved.`)}catch(e){globalThis.toastr?.error?.(e.message)}};d.querySelector('[data-generate-character-phone]').onclick=()=>{if(identity.phoneNumber&&!confirm(`Replace ${identity.name}'s current phone number everywhere?`))return;try{const updated=updateIdentityNumber(identity.id,nextPhoneNumber(settingsRoot().identities));input.value=updated.phoneNumber;identity=updated;propagateIdentityNumber(updated);installCharacterPhoneEditor();globalThis.toastr?.success?.('New unique number generated.')}catch(e){globalThis.toastr?.error?.(e.message)}};
}
function installCharacterPhoneEditor(){
  const panel=document.querySelector('#rm_ch_create_block');if(!panel)return;let button=panel.querySelector('#ghp-character-phone-button');if(!button){button=document.createElement('button');button.type='button';button.id='ghp-character-phone-button';button.className='menu_button interactable';button.innerHTML='<i class="fa-solid fa-mobile-screen-button"></i><span>Greyhaven Phone</span>';button.title='View, generate or edit this character\'s persistent Greyhaven phone number';button.addEventListener('click',()=>{const identity=characterManagementIdentity();if(!identity){globalThis.toastr?.warning?.('Select an existing character first.');return}characterPhonePopup(identity)});const lifeButton=panel.querySelector('#gh-life-character-defaults-button'),anchor=lifeButton||panel.querySelector('#avatar-and-name-block');if(anchor?.parentElement)anchor.insertAdjacentElement('afterend',button);else panel.prepend(button)}const identity=characterManagementIdentity(),label=identity?`Greyhaven Phone · ${identity.phoneNumber}`:'Greyhaven Phone',span=button.querySelector('span');button.disabled=!identity;if(span&&span.textContent!==label)span.textContent=label;
}
function buildMenu(){const m=document.querySelector('#extensionsMenu');if(!m||document.querySelector('#ghp-menu-entry'))return;const d=document.createElement('div');d.id='ghp-menu-entry';d.className='list-group-item flex-container flexGap5 interactable';d.tabIndex=0;d.innerHTML='<i class="fa-solid fa-mobile-screen-button"></i><span>Greyhaven Phone</span>';d.onclick=openPhone;d.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPhone()}};m.appendChild(d)}
function observeMenu(){if(menuObserver)return;const m=document.querySelector('#extensionsMenu');if(!m)return;let q=false;menuObserver=new MutationObserver(()=>{if(q)return;q=true;requestAnimationFrame(()=>{q=false;buildMenu()})});menuObserver.observe(m,{childList:true})}
function onChat(){const k=chatIdentity();if(k===currentChat)return;currentChat=k;app='';appView='';itemId='';threadId='';contactId='';callId='';composeRequest={threadId:'',kind:''};unlocked=!profile().lockScreen;if(hasChat()){timeline();seedContacts(true);reconcileServiceEvents()}if(!document.querySelector('#ghp-overlay')?.hidden)render()}
function bind(){
  if(bound)return;const c=ctx();if(!c?.eventSource||!c.eventTypes)return;const b=(k,fn)=>{const e=c.eventTypes[k];if(e)c.eventSource.on(e,fn)};
  b('CHAT_CHANGED',()=>setTimeout(()=>{onChat();updatePrompt()},30));b('CHAT_CREATED',()=>setTimeout(()=>{onChat();updatePrompt()},30));b('PERSONA_CHANGED',()=>setTimeout(()=>{app='';appView='';itemId='';threadId='';contactId='';callId='';composeRequest={threadId:'',kind:''};unlocked=!profile().lockScreen;timeline();seedContacts(true);reconcileServiceEvents();updatePrompt();render()},50));b('GENERATION_STARTED',()=>updatePrompt());b('GROUP_UPDATED',()=>setTimeout(()=>seedContacts(true),50));b('CHARACTER_EDITED',()=>setTimeout(()=>{seedContacts(true);installCharacterPhoneEditor()},50));b('CHARACTER_EDITOR_OPENED',()=>setTimeout(installCharacterPhoneEditor,30));b('MESSAGE_SENT',()=>{if(!document.querySelector('#ghp-overlay')?.hidden)render()});b('CHARACTER_MESSAGE_RENDERED',()=>setTimeout(()=>{markRoleplayCheckpointIfAdvanced();reconcileServiceEvents();if(!document.querySelector('#ghp-overlay')?.hidden)render()},20));bound=true;
}
function subscribeLife(){try{lifeUnsub?.()}catch{}lifeUnsub=null;if(typeof globalThis.GreyhavenLife?.subscribe==='function')lifeUnsub=globalThis.GreyhavenLife.subscribe(()=>{const changed=hasChat()?reconcileServiceEvents():false;if(changed||!document.querySelector('#ghp-overlay')?.hidden)render()})}
function startClock(){clearInterval(clockTimer);clockTimer=setInterval(()=>{const changed=hasChat()?reconcileServiceEvents():false,o=document.querySelector('#ghp-overlay');if(o?.hidden)return;if(changed)return render();o.querySelectorAll('.ghp-status>span:first-child').forEach(x=>x.textContent=timeText());o.querySelectorAll('.ghp-lock h1').forEach(x=>x.textContent=timeText())},15000)}
function expose(){
  globalThis.GreyhavenPhone={
    version:GHP_VERSION,open:openPhone,close:closePhone,refresh:refreshPhone,refreshMarketplace,refreshDarkWeb,
    getProfile:()=>clone(profile()),getTimeline:()=>clone(timeline(false)),getMarketplace:()=>clone(sharedMarketplace()),getServices:()=>clone(sharedServices()),getOnlyFansState:()=>clone(sharedOnlyFans()),getDarkWeb:()=>clone(sharedDarkWeb()),getGlobalAppRoles:()=>clone(globalAppRoles()),
    getContacts:()=>{const t=timeline(false);return clone(t?t.contactOrder.map(k=>t.contacts[k]).filter(Boolean):[])},getActivePersona:()=>clone(persona()),getContinuitySnapshot:()=>clone(continuitySnapshot()),getPromptSummary:()=>phonePromptSummary(),getIdentityPromptSummary:()=>identityPromptSummary(),
    listIdentities:()=>clone(Object.values(ensureAllIdentities())),getIdentityById:key=>clone(identityById(key)),getIdentityByName:name=>clone(identityForName(name,{create:true})),getIdentityByNumber:number=>clone(identityByNumber(number)),getCurrentIdentity:()=>clone(currentIdentity()),
    getSocialProfile:identity=>clone(socialProfileFor(resolveIdentityRef(identity,false)||currentIdentity())),getSocialCounts:()=>clone(socialCounts(timeline(),currentIdentity())),getOnlyFansAccount:identity=>clone(onlyFansAccount(resolveIdentityRef(identity,false)||currentIdentity(),false)),getOnlyFansCreators:()=>clone(onlyFansCreators()),
    setIdentityPhoneNumber:(identityId,number)=>{const updated=updateIdentityNumber(identityId,number);propagateIdentityNumber(updated);return clone(updated)},saveContactForOwner:(owner,target,options)=>saveContactForOwner(owner,target,options),seedContacts:()=>clone(seedContacts(true)),removeContact,
    actionBus:{dispatch:(action,options)=>globalThis.GreyhavenLife?.dispatchWorldAction?.(action,options)||false},
    apps:{
      sendMessage:mirrorAppMessage,editMessage:editMirroredAppMessage,unsendMessage:unsendAppMessageEverywhere,deleteMessageLocal:deleteAppMessageLocal,followInstagram:setInstagramFollowing,removeInstagramFollower,requestSnapchat:setSnapchatFriendRequest,requestFacebook:setFacebookFriendRequest,engagePost:updateSharedSocialEngagement,publishItem:publishAppItem,
      createMarketplaceListing:data=>{const market=sharedMarketplace(),row=addMarketplaceListing(market,data,{ownerListing:true});if(!row)return null;market.listings.unshift(row);saveSharedMarketplace(market);return clone(row)},closeMarketplaceListing:closeOwnedMarketplaceListing,
      setGlobalRole:setGlobalServiceRole,setOnlyFansCreator,setOnlyFansSubscription,publishOnlyFansPost:publishOnlyFansPostFor,updateDominosCart,placeDominosOrder,setDominosOrderStatus,requestUberRide,setUberRideStatus,reconcileServices:reconcileServiceEvents,
      createDarkWebListing:data=>{const state=sharedDarkWeb(),row=addDarkWebListing(state,data);if(!row)return null;state.listings.unshift(row);saveSharedDarkWeb(state);return clone(row)},
    },
  };
}
async function waitReady(ms=15000){const s=Date.now();while(Date.now()-s<ms){if(ctx()?.extensionSettings&&document.body)return true;await new Promise(r=>setTimeout(r,120))}return false}
async function init(){if(initialized)return;if(!await waitReady())return;try{buildOverlay();buildMenu();observeMenu();installCharacterPhoneEditor();bind();expose();onChat();updatePrompt();subscribeLife();startClock();for(const delay of [250,900,2200])setTimeout(installCharacterPhoneEditor,delay);initialized=true;console.info(`[${GHP_MODULE}] v${GHP_VERSION} loaded`)}catch(e){console.error(`[${GHP_MODULE}] init`,e)}}
void init().catch(e=>console.error(`[${GHP_MODULE}] boot`,e));
