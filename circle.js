/* Greyhaven Circle v1.0 — opt-in, manual-refresh social discovery.
 * Global profiles and NPC identity registry. Chat-local swipes, matching and messages.
 * Does not modify Phone's core timelines or its private prompt injection.
 */
import {clean,nameKey,looseJson,within,normalProfile,validatedBatch,refreshPending,preparePending,chatKey} from './circle-core.mjs';

const VERSION='1.0.0', KEY='greyhavenPhone';
const h=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const uuid=()=>{try{return crypto.randomUUID()}catch{return `circle-${Date.now()}-${Math.random().toString(36).slice(2)}`}};
const context=()=>{try{return globalThis.SillyTavern?.getContext?.()||null}catch{return null}};
const phone=()=>globalThis.GreyhavenPhone;
const notify=(msg,type='info')=>{if(globalThis.toastr?.[type])globalThis.toastr[type](msg);else console.info('[Circle]',msg)};
const now=()=>{try{const x=globalThis.GreyhavenLife?.getTime?.();if(x && Number.isFinite(+new Date(x)))return +new Date(x)}catch{}return Date.now()};
const when=ms=>{try{return new Date(ms).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}catch{return ''}};
const timeLabel=()=>{try{return new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(now()))}catch{return ''}};
const me=()=>phone()?.getCurrentIdentity?.()||null;
const origin=()=>`${chatKey(context())}|${me()?.id||''}`;
const active=()=>!document.querySelector('#ghp-overlay')?.hidden;
const arr=v=>Array.isArray(v)?v:[];
function globalState(){
 const c=context();if(!c?.extensionSettings)return null;
 c.extensionSettings[KEY] ||= {};
 const root=c.extensionSettings[KEY];
 root.circle ||= {version:1,profiles:{},nameRegistry:{}};
 const g=root.circle;
 if(!g.profiles||typeof g.profiles!=='object'||Array.isArray(g.profiles))g.profiles={};
 if(!g.nameRegistry||typeof g.nameRegistry!=='object'||Array.isArray(g.nameRegistry))g.nameRegistry={};
 return g;
}
function localState(){
 const c=context();if(!c?.chatMetadata||!chatKey(c))return null;
 c.chatMetadata[KEY] ||= {};
 const root=c.chatMetadata[KEY];
 root.circle ||= {version:1,owners:{},npcs:{}};
 const s=root.circle;
 if(!s.owners||typeof s.owners!=='object'||Array.isArray(s.owners))s.owners={};
 if(!s.npcs||typeof s.npcs!=='object'||Array.isArray(s.npcs))s.npcs={};
 return s;
}
function saveGlobal(){const c=context();try{c?.saveSettingsDebounced?.()}catch(e){console.warn('[Circle] save profile',e)}}
function saveLocal(){const c=context();if(!c?.chatMetadata)return;try{c.updateChatMetadata?.({[KEY]:c.chatMetadata[KEY]});if(typeof c.saveMetadataDebounced==='function')c.saveMetadataDebounced();else c.saveMetadata?.()}catch(e){console.warn('[Circle] save chat',e)}}
function owner(){
 const who=me(),s=localState();if(!who?.id||!s)return null;
 if(!s.owners[who.id])s.owners[who.id]={feeds:{meet:{ids:[],index:0},dating:{ids:[],index:0}},pending:[],messages:{},filters:{},createdAt:now()};
 const o=s.owners[who.id];o.feeds ||= {};for(const m of ['meet','dating']){o.feeds[m] ||= {ids:[],index:0};o.feeds[m].ids=arr(o.feeds[m].ids);o.feeds[m].index=Math.max(0,Number(o.feeds[m].index||0))}
 o.pending=arr(o.pending);o.messages ||= {};o.filters ||= {};
 return o;
}
function getMyProfile(){const who=me(),g=globalState();if(!g||!who?.id)return null;return normalProfile(g.profiles[who.id]||{},who)}
function storeMyProfile(raw){const who=me(),g=globalState();if(!who?.id||!g)return;g.profiles[who.id]=normalProfile({...raw,updatedAt:Date.now()},who);saveGlobal()}
function npc(id){return localState()?.npcs?.[id]||null}
let opened=false,view='discover',mode='meet',detailId='',filtersOpen=false,busy='',notice='',observer=null,seenChat='',tStart=null,lockRender=false;
function filtered(){const o=owner();return o?.filters?.[mode]||{}}
function colorInitial(name){return h(String(name||'?')[0].toUpperCase())}
function tokenCheck(){return !!context()?.generateRaw}
function renderHeader(){return `<div class="ghc-time" aria-label="Greyhaven fictional time">${h(new Date(now()).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",hour12:false}))}</div><header class="ghc-header"><button type="button" data-ghc-home aria-label="Back to phone"><i class="fa-solid fa-chevron-left"></i></button><div class="ghc-brand"><b>Circle</b><small>Meet. Match. Connect.</small></div><button type="button" class="ghc-sync" data-ghc-refresh ${busy?'disabled':''} title="Check pending likes"><i class="fa-solid fa-arrows-rotate"></i><span>Refresh</span></button></header>`}
function tabs(){return `<nav class="ghc-tabs">${[['discover','Discover','compass'],['matches','Connections','heart'],['mine','My Profile','user']].map(([k,label,ico])=>`<button type="button" class="${view===k?'active':''}" data-ghc-view="${k}"><i class="fa-solid fa-${ico}"></i>${label}</button>`).join('')}</nav>`}
function modeTabs(){return `<div class="ghc-switch">${[['meet','Meet People'],['dating','Dating']].map(([k,label])=>`<button type="button" class="${mode===k?'active':''}" data-ghc-mode="${k}">${label}</button>`).join('')}</div>`}
function field(label,key,value='',kind='text',options=[]){const id=`ghc-${key}`;return `<label class="ghc-field"><span>${h(label)}</span>${kind==='select'?`<select id="${id}" data-ghc-field="${key}">${options.map(([v,n])=>`<option value="${h(v)}" ${String(value)===String(v)?'selected':''}>${h(n)}</option>`).join('')}</select>`:kind==='textarea'?`<textarea id="${id}" data-ghc-field="${key}" rows="3">${h(value)}</textarea>`:`<input id="${id}" data-ghc-field="${key}" type="${kind==='number'?'number':'text'}" ${kind==='number'?'min="18" max="85"':''} value="${h(value)}">`}</label>`}
const GENDERS=[['','Unspecified'],['Woman','Woman'],['Man','Man'],['Nonbinary','Nonbinary'],['Other','Other']];
const ORIENTATIONS=[['','Unspecified'],['Straight','Straight'],['Gay','Gay'],['Lesbian','Lesbian'],['Bisexual','Bisexual'],['Pansexual','Pansexual'],['Queer','Queer'],['Other','Other']];
const PREFERENCES=[['Any','Any gender'],['Women','Women'],['Men','Men'],['Nonbinary','Nonbinary'],['Women and men','Women and men']];
function renderMine(){const p=getMyProfile();if(!p)return `<div class="ghc-empty">Open a chat and select a persona first.</div>`;
 return `<div class="ghc-section"><div class="ghc-heading"><b>${h(p.name)}'s Circle profile</b><small>Shared across every chat and group chat for this identity.</small></div>
 <div class="ghc-actions"><button type="button" class="ghc-primary" data-ghc-auto ${busy?'disabled':''}><i class="fa-solid fa-wand-magic-sparkles"></i>${busy==='auto'?'Generating…':'AI complete profile'}</button></div>
 <div class="ghc-formgrid">${field('Age (18+)','age',p.age,'number')}${field('Gender','gender',p.gender,'select',GENDERS)}${field('Orientation','orientation',p.orientation,'select',ORIENTATIONS)}${field('Interested in meeting','genderPreference',p.genderPreference,'select',PREFERENCES)}</div>
 ${field('Job / occupation','occupation',p.occupation)}${field('Location','location',p.location)}${field('Bio','bio',p.bio,'textarea')}${field('Interests (comma separated)','interests',p.interests.join(', '))}
 ${field('Friendship goal','socialGoal',p.socialGoal)}${field('Dating goal','datingGoal',p.datingGoal)}
 <div class="ghc-formgrid">${field('Preferred minimum age','ageMin',p.ageMin,'number')}${field('Preferred maximum age','ageMax',p.ageMax,'number')}</div>
 <div class="ghc-actions"><button type="button" class="ghc-primary" data-ghc-save-profile><i class="fa-solid fa-floppy-disk"></i> Save profile</button></div>
 <p class="ghc-hint">Your profile changes everywhere. Discovery activity, matches and messages remain in this chat only. All Circle participants are adults.</p></div>`}
function renderFilters(){const f=filtered();return `<section class="ghc-filter"><button type="button" class="ghc-filter-toggle" data-ghc-filters-toggle><i class="fa-solid fa-sliders"></i><b>Optional discovery filters</b><i class="fa-solid fa-chevron-${filtersOpen?'up':'down'}"></i></button>${filtersOpen?`<div class="ghc-filter-body"><p>These affect only the next batch. They do not change your Circle profile.</p><div class="ghc-formgrid">${field('NPC gender','npcGender',f.npcGender||'','select',[['','Follow profile'],...GENDERS.filter(x=>x[0])])}${field('NPC minimum age','npcMin',f.npcMin||'','number')}${field('NPC maximum age','npcMax',f.npcMax||'','number')}</div>${field('Occupation / social background','occupationFilter',f.occupationFilter||'')}${field('Personality / traits','traits',f.traits||'')}${field('Interests / hobbies','hobbies',f.hobbies||'')}${field('Location / neighborhood','locationFilter',f.locationFilter||'')}${field('Other details (optional)','special',f.special||'','textarea')}<div class="ghc-actions"><button type="button" data-ghc-save-filters class="ghc-primary">Apply filters</button><button type="button" data-ghc-reset-filters>Clear</button></div></div>`:''}</section>`}
function renderDiscover(){const o=owner();if(!o)return `<div class="ghc-empty">Circle requires an open SillyTavern chat.</div>`;const p=getMyProfile(),feed=o.feeds[mode],id=feed.ids[feed.index],n=npc(id);return `${modeTabs()}<div class="ghc-intro"><b>${mode==='dating'?'Find a connection':'Discover new people'}</b><small>${mode==='dating'?'Potential romantic matches, each with their own preferences.':'Meet friends, new acquaintances and activity partners.'}</small></div>${renderFilters()}
 <div class="ghc-actions"><button type="button" class="ghc-primary" data-ghc-discover ${busy?'disabled':''}><i class="fa-solid fa-rotate"></i>${busy==='discover'?'Discovering…':'Discover 10 people'}</button><span class="ghc-count">${Math.max(0,feed.ids.length-feed.index)} left in batch</span></div>
 ${n?`<section class="ghc-card" data-ghc-swipe-card><div class="ghc-cardhead"><div class="ghc-avatar">${colorInitial(n.name)}</div><div><b>${h(n.name)}, ${h(n.age)}</b><span>${h(n.occupation||'Greyhaven resident')}</span></div></div><p>${h(n.bio||'Interested in meeting new people.')}</p><div class="ghc-tags">${n.gender?`<span>${h(n.gender)}</span>`:''}<span><i class="fa-solid fa-location-dot"></i> ${h(n.location)}</span>${n.interests.slice(0,3).map(v=>`<span>${h(v)}</span>`).join('')}</div><div class="ghc-actions ghc-swipe-actions"><button type="button" data-ghc-pass title="Pass"><i class="fa-solid fa-xmark"></i> Pass</button><button type="button" data-ghc-detail="${h(n.id)}" title="View details"><i class="fa-regular fa-id-card"></i> Profile</button><button type="button" class="ghc-like" data-ghc-like title="Like"><i class="fa-solid fa-heart"></i> Like</button></div></section>`:feed.ids.length?`<div class="ghc-empty"><i class="fa-solid fa-check-double"></i><b>You've viewed this batch</b><span>Discover another ten people whenever you want.</span></div>`:`<div class="ghc-empty"><i class="fa-solid fa-users"></i><b>Ready to meet someone new?</b><span>Tap Discover 10 people to generate profiles. The AI only runs when requested.</span></div>`}
 <p class="ghc-hint">Swipes are saved only in this chat. Pending likes are checked only when you tap Refresh—never on a background timer.</p>`}
function renderMatches(){const o=owner();if(!o)return '';const matched=o.pending.filter(x=>x.status==='matched'),pending=o.pending.filter(x=>x.status==='pending'),inactive=o.pending.filter(x=>x.status==='no-match');
 return `<div class="ghc-section"><div class="ghc-heading"><b>Connections</b><small>Local to this chat. Refresh checks for new mutual likes.</small></div>
 ${matched.length?matched.map(x=>{const n=npc(x.npcId),messages=arr(o.messages[x.npcId]);return n?`<button type="button" class="ghc-matchrow" data-ghc-thread="${h(n.id)}"><span class="ghc-avatar small">${colorInitial(n.name)}</span><span><b>${h(n.name)}, ${n.age}</b><small>${h(messages.at(-1)?.text|| (x.mode==='dating'?'Mutual match · Say hello':'Connected · Say hello'))}</small></span><i class="fa-solid fa-chevron-right"></i></button>`:''}).join(''):`<div class="ghc-empty compact">No matches yet. Discover people and like profiles you connect with.</div>`}
 ${pending.length?`<h3 class="ghc-subtitle">Waiting for a response (${pending.length})</h3>${pending.map(x=>{const n=npc(x.npcId);return n?`<div class="ghc-pending"><b>${h(n.name)}</b><small>Liked ${h(when(x.likedAt))} · ${x.mode==='dating'?'Dating':'Meet People'}</small></div>`:''}).join('')}`:''}
 ${inactive.length?`<p class="ghc-hint">${inactive.length} previous likes were not mutual. They remain in your history.</p>`:''}</div>`}
function renderDetail(){const n=npc(detailId);if(!n)return `<div class="ghc-empty">This profile is unavailable.</div>`;const o=owner();const relation=o?.pending.find(x=>x.npcId===n.id);return `<div class="ghc-section"><button class="ghc-text-back" type="button" data-ghc-return><i class="fa-solid fa-chevron-left"></i> Back</button><div class="ghc-cardhead ghc-detailhead"><div class="ghc-avatar">${colorInitial(n.name)}</div><div><b>${h(n.name)}, ${h(n.age)}</b><span>${h(n.occupation||'Greyhaven resident')} · ${h(n.location)}</span></div></div><p>${h(n.bio)}</p><div class="ghc-tags">${n.gender?`<span>${h(n.gender)}</span>`:''}${n.interests.map(v=>`<span>${h(v)}</span>`).join('')}</div><div class="ghc-block"><b>Personality</b><p>${h(n.personality||'Not disclosed yet.')}</p></div><div class="ghc-block"><b>Looking for</b><p>${h(n.lookingFor||'Open to new connections.')}</p></div>
 <div class="ghc-actions">${relation?.status==='matched'?`<button type="button" class="ghc-primary" data-ghc-thread="${h(n.id)}">Open conversation</button>`:relation?`<span class="ghc-hint">${relation.status==='pending'?'Your like is pending. Check Refresh later.':'Not matched.'}</span>`:`<button type="button" class="ghc-primary" data-ghc-like-id="${h(n.id)}"><i class="fa-solid fa-heart"></i> Like</button>`}</div>
 <div class="ghc-block"><b>Private character creator</b><p>Only you can see the full character card. It doesn't make the NPC a SillyTavern character yet.</p><div class="ghc-actions"><button type="button" data-ghc-card ${busy?'disabled':''}>${busy==='card'?'Generating…':n.fullCard?'Regenerate full card':'Generate full character card'}</button>${n.fullCard?`<button type="button" data-ghc-copy><i class="fa-regular fa-copy"></i> Copy card</button>`:''}</div>${n.fullCard?`<pre class="ghc-fullcard">${h(n.fullCard)}</pre>`:''}</div></div>`}
function renderThread(){const n=npc(detailId),o=owner();if(!n||!o)return '';const relation=o.pending.find(p=>p.npcId===detailId);if(relation?.status!=='matched')return `<div class="ghc-empty">Mutual match required before messaging.</div>`;
 const messages=arr(o.messages[n.id]);return `<div class="ghc-thread"><div class="ghc-threadhead"><button type="button" data-ghc-return><i class="fa-solid fa-chevron-left"></i></button><div class="ghc-avatar small">${colorInitial(n.name)}</div><div><b>${h(n.name)}</b><small>${h(n.occupation||'Circle connection')}</small></div></div><div class="ghc-messages" data-ghc-thread-scroll>${messages.length?messages.map(m=>`<div class="ghc-bubble ${m.mine?'mine':''}"><p>${h(m.text)}</p><small>${h(when(m.timeMs))}</small></div>`).join(''):`<div class="ghc-empty compact">You matched with ${h(n.name)}. Say hello whenever you're ready.</div>`}</div><form class="ghc-compose" data-ghc-send><input autocomplete="off" maxlength="1200" name="message" placeholder="Message ${h(n.name)}…" ${busy==='reply'?'disabled':''}><button type="submit" ${busy==='reply'?'disabled':''} aria-label="Send"><i class="fa-solid fa-paper-plane"></i></button></form></div>`}
function content(){if(view==='mine')return renderMine();if(view==='matches')return renderMatches();if(view==='detail')return renderDetail();if(view==='thread')return renderThread();return renderDiscover()}
function paint({resetScroll=false}={}){const screen=document.querySelector('#ghc-screen');if(!screen||!opened)return;const oldScroll=screen.querySelector('.ghc-scroll')?.scrollTop||0;screen.innerHTML=renderHeader()+tabs()+`<main class="ghc-scroll">${notice?`<div class="ghc-notice">${h(notice)}</div>`:''}${content()}</main>`;if(!resetScroll){const el=screen.querySelector('.ghc-scroll');if(el)el.scrollTop=oldScroll}if(view==='thread'){const el=screen.querySelector('[data-ghc-thread-scroll]');if(el)el.scrollTop=el.scrollHeight}}
function ensureIcon(){const overlay=document.querySelector('#ghp-overlay');if(!overlay||overlay.hidden)return;const grid=overlay.querySelector('.ghp-home .ghp-grid');if(!grid||grid.querySelector('[data-ghc-launch]'))return;const b=document.createElement('button');b.type='button';b.className='ghp-app-icon ghc-app-icon';b.dataset.ghcLaunch='';b.innerHTML='<span class="ghp-app-square" style="--t:#8b5cf6"><i class="fa-solid fa-users"></i></span><small>Circle</small>';grid.appendChild(b)}
function mount(){if(!active())return;const device=document.querySelector('#ghp-overlay .ghp-device');if(!device)return;let screen=device.querySelector('#ghc-screen');if(!screen){screen=document.createElement('section');screen.id='ghc-screen';screen.className='ghc-screen';device.appendChild(screen)}opened=true;paint({resetScroll:true})}
function close(){opened=false;busy='';notice='';const screen=document.querySelector('#ghc-screen');if(screen)screen.remove()}
function launch(){const c=context();if(!c||!chatKey(c)||!me()){notify('Open a SillyTavern chat first.','warning');return}view='discover';mode='meet';detailId='';filtersOpen=false;notice='';mount()}
function readProfile(){const root=document.querySelector('#ghc-screen');const value=k=>root?.querySelector(`[data-ghc-field="${k}"]`)?.value??'';return {age:Number(value('age')),gender:value('gender'),orientation:value('orientation'),genderPreference:value('genderPreference'),bio:value('bio'),occupation:value('occupation'),location:value('location'),interests:value('interests').split(','),socialGoal:value('socialGoal'),datingGoal:value('datingGoal'),ageMin:Number(value('ageMin')),ageMax:Number(value('ageMax'))}}
function readFilters(){const root=document.querySelector('#ghc-screen');const val=k=>root?.querySelector(`[data-ghc-field="${k}"]`)?.value||'';return {npcGender:val('npcGender'),npcMin:val('npcMin'),npcMax:val('npcMax'),occupationFilter:clean(val('occupationFilter')).slice(0,120),traits:clean(val('traits')).slice(0,200),hobbies:clean(val('hobbies')).slice(0,160),locationFilter:clean(val('locationFilter')).slice(0,120),special:clean(val('special')).slice(0,380)}}
async function generate(systemPrompt,prompt,responseLength=1400){const c=context();if(typeof c?.generateRaw!=='function')throw Error('SillyTavern generateRaw unavailable with this model.');const result=await c.generateRaw({prompt,systemPrompt,responseLength,trimNames:false});return typeof result==='string'?result:String(result?.content||result?.text||result?.mes||result||'')}
const busyGuard=async (key,task)=>{if(busy)return;busy=key;notice='';const stamp=origin();paint();try{await task(stamp)}catch(e){console.warn('[Circle]',key,e);notify(`Circle: ${e.message||e}`,'error');notice=`${e.message||e}`;}finally{busy='';if(opened)paint()}};
async function aiProfile(){await busyGuard('auto',async stamp=>{const p=getMyProfile(),person=phone()?.getActivePersona?.(),life=globalThis.GreyhavenLife?.getPerson?.(p.name);const brief=String(person?.description||'').slice(0,6000);const systemPrompt='Write a plausible social discovery profile for a fictional adult character (18+). Treat the provided character sheet as authoritative. Never identify or discuss the real user. Return only one JSON object with fields: age (18-85), gender, orientation, genderPreference (Any/Women/Men/Nonbinary/Women and men), bio (1-3 casual sentences), occupation, location, interests (array 3-6 strings), socialGoal, datingGoal, ageMin (18-85), ageMax (18-85). Prefer Unspecified orientation/gender if absent from the sheet. Do not invent detailed personal history or publish private secrets, affairs or confidential relationship details. This is a PUBLIC profile. Do not use explicit sexual language.';
 const prompt=`Character ${p.name}. Existing Circle profile: ${JSON.stringify(p)}\nCharacter description:\n${brief}\nKnown Greyhaven Life status: ${JSON.stringify(life?.resolved||{}).slice(0,500)}\nMake a natural, personality-consistent profile. Only JSON.`;
 const obj=looseJson(await generate(systemPrompt,prompt,1800));if(stamp!==origin())return;storeMyProfile({...p,...obj,interests:arr(obj.interests)});notice='AI profile saved globally. Review and edit anything you like.';view='mine'})}
function reservedNames(){const g=globalState(),names=new Set();for(const ch of context()?.characters||[])if(ch?.name)names.add(nameKey(ch.name.split(/\s+/)[0]));for(const x of Object.keys(g?.nameRegistry||{}))names.add(nameKey(x));for(const row of Object.values(localState()?.npcs||{}))names.add(nameKey(row.name));for(const x of phone()?.listIdentities?.()||[])names.add(nameKey(x.name.split(/\s+/)[0]));const name=me()?.name;if(name)names.add(nameKey(name.split(/\s+/)[0]));return names}
async function discover(){await busyGuard('discover',async stamp=>{const p=getMyProfile(),o=owner(),filters=filtered(),reserved=reservedNames(),ageMin=within(filters.npcMin||p.ageMin,18,85,18),ageMax=Math.max(ageMin,within(filters.npcMax||p.ageMax,18,85,85));
 const without=[...reserved].slice(-180).join(', ');
 const systemPrompt='Create 12 DISTINCT adult fictional NPCs for a contemporary, realistic town called Greyhaven. Respond as STRICT JSON only: {"people":[{"name":"FIRST NAME ONLY","age":27,"gender":"Woman","orientation":"Bisexual","occupation":"nurse","location":"Greyhaven","bio":"two short natural sentences","personality":"specific non-generic traits","interests":["..."],"lookingFor":"..."}]}. All ages MUST be 18-85. No surnames, no repeats within this response, no existing characters, no real-life people, no stock archetype repetition, no overly polished corporate bios, no invented ties to named existing Greyhaven characters. Reflect the requested dating/friendship mode and filters. Include twelve candidates to allow duplicate filtering; only ten will be displayed.';
 const prompt=`Mode: ${mode==='dating'?'DATING':'MEETING PEOPLE / FRIENDSHIPS'}.\nCurrent profile (not a request to change): ${JSON.stringify(p)}\nOptional filters for this batch ONLY: ${JSON.stringify(filters)}\nNPC age range: ${ageMin}–${ageMax}.\nNPC genders: ${filters.npcGender||p.genderPreference||'Any'}.\nDO NOT use any of these existing first names: ${without}.\nMake twelve unique adults with varied personalities, realistic occupations, hobbies, locations and believable short descriptions. Return JSON only.`;
 const reply=looseJson(await generate(systemPrompt,prompt,3600));if(stamp!==origin())return;const wantedGender=clean(filters.npcGender || (mode==='dating'?p.genderPreference:'Any')).toLowerCase();
 const genderOK=g=>{const v=clean(g).toLowerCase();if(!wantedGender||wantedGender==='any')return true;if(wantedGender==='women')return v==='woman'||v==='female';if(wantedGender==='men')return v==='man'||v==='male';if(wantedGender==='women and men')return ['woman','female','man','male'].includes(v);return v===wantedGender.toLowerCase()};
 const cards=validatedBatch(reply.people,reserved,uuid,mode).filter(x=>x.age>=ageMin && x.age<=ageMax && genderOK(x.gender));
 if(!cards.length)throw Error('The model returned no valid unique profiles. No cards were saved; try again.');
 // One owner and one chat only: generating a batch intentionally replaces an unviewed feed, not relationships.
 const g=globalState(),state=owner(),s=localState();for(const card of cards){s.npcs[card.id]=card;g.nameRegistry[nameKey(card.name)]={id:card.id,createdAt:Date.now()};}
 state.feeds[mode]={ids:cards.map(x=>x.id),index:0};saveGlobal();saveLocal();notice=`Found ${cards.length} new people${cards.length<10?' (some model results were filtered for age or duplicate names)':''}.`;view='discover';})}
function swipe(like,idFromDetail=''){const o=owner();if(!o)return;const f=o.feeds[mode],id=idFromDetail||f.ids[f.index],n=npc(id);if(!n)return;
 if(like && !o.pending.some(x=>x.npcId===n.id)) {const pending=preparePending({npcId:n.id,mode},now());o.pending.push(pending);notice=pending.status==='matched'?`It's a match with ${n.name}! Open Connections to chat.`:`Liked ${n.name}. Check for a response by pressing Refresh later.`;}
 else if(!like){notice=`Passed on ${n.name}.`;}
 if(!idFromDetail)f.index=Math.min(f.ids.length,f.index+1);else {if(f.ids[f.index]===id)f.index++;view='discover';detailId=''}
 saveLocal();paint({resetScroll:false})}
function manualRefresh(){if(busy)return;const o=owner();if(!o)return;const events=refreshPending(o.pending,now());saveLocal();const matched=events.filter(x=>x.status==='matched').map(x=>npc(x.id)?.name).filter(Boolean);const declined=events.filter(x=>x.status==='no-match').length;notice=matched.length?`New match${matched.length>1?'es':''}: ${matched.join(', ')}!`:declined?`${declined} pending like${declined===1?'':'s'} didn't become mutual.`:'No new matches yet. You can refresh again later.';paint()}
async function generateCard(){await busyGuard('card',async stamp=>{const n=npc(detailId);if(!n)return;const systemPrompt='Write one detailed first-person SillyTavern fictional adult character card. Keep exactly these headings: Name:, Age:, Description:, Appearance:, Personality:, Backstory:, Relationships:, Roleplay Notes:. No surname. Maintain all given facts including age, name, job, gender, orientation, location, interests and bio. Invent realistic, nuanced background and original supporting relationships but DO NOT imply existing Greyhaven characters know this person unless explicitly established. Do not invent a past romance with named established characters. In Roleplay Notes require first person, natural replies, character autonomy, not controlling {{user}}. Do not include sexual descriptions or graphic content.';
 const prompt=`Produce card for this Circle NPC:\n${JSON.stringify(n)}\nBrief realistic history, distinct flaws and social dynamics. No markdown fences.`;const result=String(await generate(systemPrompt,prompt,2600)).trim();if(stamp!==origin()||detailId!==n.id)return;if(result.length<180)throw Error('Character card generation returned too little text.');const s=localState();if(s?.npcs?.[n.id]){s.npcs[n.id].fullCard=result.slice(0,14000);saveLocal();notice='Full character card generated. You can copy it to SillyTavern.'}})}
async function copyCard(){const txt=npc(detailId)?.fullCard;if(!txt)return;try{await navigator.clipboard.writeText(txt);notify('Character card copied.','success')}catch{const ta=document.createElement('textarea');ta.value=txt;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();notify(ok?'Character card copied.':'Select and copy the visible card manually.',ok?'success':'warning')}}
async function sendMessage(form){const n=npc(detailId),o=owner();if(!n||!o||busy)return;const val=clean(form.querySelector('input[name=message]')?.value||'').slice(0,1200);if(!val)return;
 const ownName=me()?.name||'You',p=getMyProfile(),id=n.id,stamp=origin();o.messages[id] ||= [];o.messages[id].push({id:uuid(),mine:true,text:val,timeMs:now()});saveLocal();paint();
 await busyGuard('reply',async()=>{const history=arr(owner()?.messages[id]).slice(-18).map(m=>`${m.mine?ownName:n.name}: ${m.text}`).join('\n');const systemPrompt=`You are ${n.name}, a fictional ${n.age}-year-old adult using the Circle ${n.mode==='dating'?'dating':'friendship'} app. Write ONLY their next short, natural text reply (1-3 messages worth, combined as a single response). Stay true to their personality and boundaries. They may be warm, cautious, distracted, uninterested, or direct. Do not force flirting or acceptance of meetings. Don't write narration, headers, JSON or the other person's words. No explicit sexual content.`;
 const prompt=`Your public Circle profile: ${JSON.stringify(n)}\nOther person's Circle profile: ${JSON.stringify(p)}\nPrivate Circle conversation, in chronological order:\n${history}\nReply as ${n.name} only.`;const reply=clean(await generate(systemPrompt,prompt,1000)).replace(/^['"`]+|['"`]+$/g,'').slice(0,1500);if(stamp!==origin()||detailId!==id)return;if(!reply)throw Error('NPC returned an empty message. You can retry by sending another text.');const current=owner();current.messages[id] ||= [];current.messages[id].push({id:uuid(),mine:false,text:reply,timeMs:now()});saveLocal();})}
function openThread(id){if(!npc(id))return;view='thread';detailId=id;notice='';paint({resetScroll:true})}
function openDetails(id){if(!npc(id))return;view='detail';detailId=id;notice='';paint({resetScroll:true})}
function handleScreenClick(event){const root=event.target.closest('#ghc-screen');const launch=event.target.closest('[data-ghc-launch]');if(!root&&!launch)return;event.stopPropagation();
 if(launch){event.preventDefault();launchApp();return;}
 const target=event.target.closest('button');if(!target)return;event.preventDefault();
 if(target.type==='submit' && target.closest('[data-ghc-send]'))return sendMessage(target.closest('[data-ghc-send]'));
 if(target.hasAttribute('data-ghc-home'))return close();
 if(target.hasAttribute('data-ghc-refresh'))return manualRefresh();
 if(target.dataset.ghcView){view=target.dataset.ghcView;detailId='';notice='';return paint({resetScroll:true})}
 if(target.dataset.ghcMode){mode=target.dataset.ghcMode;notice='';return paint({resetScroll:true})}
 if(target.hasAttribute('data-ghc-filters-toggle')){filtersOpen=!filtersOpen;return paint()}
 if(target.hasAttribute('data-ghc-save-filters')){const o=owner();o.filters[mode]=readFilters();saveLocal();notice='Filters saved for this chat and this discovery mode.';return paint()}
 if(target.hasAttribute('data-ghc-reset-filters')){const o=owner();o.filters[mode]={};saveLocal();notice='Filters cleared. Your main profile is unchanged.';return paint()}
 if(target.hasAttribute('data-ghc-save-profile')){storeMyProfile(readProfile());notice='Profile saved across all chats.';return paint()}
 if(target.hasAttribute('data-ghc-auto'))return aiProfile();
 if(target.hasAttribute('data-ghc-discover'))return discover();
 if(target.hasAttribute('data-ghc-like'))return swipe(true);
 if(target.hasAttribute('data-ghc-pass'))return swipe(false);
 if(target.dataset.ghcDetail)return openDetails(target.dataset.ghcDetail);
 if(target.dataset.ghcLikeId)return swipe(true,target.dataset.ghcLikeId);
 if(target.dataset.ghcThread)return openThread(target.dataset.ghcThread);
 if(target.hasAttribute('data-ghc-return')){view='discover';detailId='';notice='';return paint({resetScroll:true})}
 if(target.hasAttribute('data-ghc-card'))return generateCard();
 if(target.hasAttribute('data-ghc-copy'))return copyCard();
}
function launchApp(){launch()}
function handleSubmit(e){if(!e.target.closest('#ghc-screen [data-ghc-send]'))return;e.preventDefault();e.stopPropagation();sendMessage(e.target)}
function handleDown(e){const card=e.target.closest('#ghc-screen [data-ghc-swipe-card]');if(!card)return;tStart={x:e.clientX,y:e.clientY}}
function handleUp(e){if(!tStart)return;const x=e.clientX-tStart.x,y=e.clientY-tStart.y;tStart=null;if(!opened||view!=='discover'||Math.abs(x)<75||Math.abs(x)<Math.abs(y)*1.4)return;e.preventDefault();e.stopPropagation();swipe(x>0)}
function watchPhone(){const content=document.querySelector('#ghp-overlay .ghp-content');if(!content||observer)return false;observer=new MutationObserver(()=>{if(opened && !active())close();ensureIcon()});observer.observe(content,{childList:true,subtree:false});ensureIcon();return true}
function boot(){const c=context();if(!c||!phone()||!document.querySelector('#ghp-overlay .ghp-content'))return false;
 watchPhone();
 document.addEventListener('click',e=>{if(e.target.closest('#ghp-overlay [data-close]'))close();handleScreenClick(e)},true);
 document.addEventListener('submit',handleSubmit,true);
 document.addEventListener('pointerdown',handleDown,{capture:true,passive:true});
 document.addEventListener('pointerup',handleUp,{capture:true,passive:false});
 const events=c.eventSource,types=c.eventTypes;for(const k of ['CHAT_CHANGED','CHAT_CREATED','PERSONA_CHANGED'])if(events&&types?.[k])events.on(types[k],()=>{close();seenChat=origin()});
 globalThis.GreyhavenCircle={version:VERSION,open:launch,close,getProfile:getMyProfile,getNpc:id=>npc(id),getChatState:()=>owner()};
 console.info('[Greyhaven Circle] v'+VERSION+' ready (manual refresh only)');return true;
}
// Bootstrap after Phone has created its overlay. Bounded short-lived polling only during startup.
let tries=0;const timer=setInterval(()=>{tries++;if(boot()||tries>250)clearInterval(timer)},120);
