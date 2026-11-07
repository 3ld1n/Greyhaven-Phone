/* Greyhaven Circle v2.0 — opt-in, manual-refresh social discovery and character linking.
 * Global profiles and NPC identity registry. Chat-local swipes, matching and messages.
 * Does not modify Phone's core timelines or its private prompt injection.
 */
import {clean,nameKey,looseJson,within,normalProfile,validatedBatch,refreshPending,preparePending,chatKey} from './circle-core.mjs';

const VERSION='2.0.0', KEY='greyhavenPhone';
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
 root.circle ||= {version:2,profiles:{},nameRegistry:{},links:{}};
 const g=root.circle;
 if(!g.profiles||typeof g.profiles!=='object'||Array.isArray(g.profiles))g.profiles={};
 if(!g.nameRegistry||typeof g.nameRegistry!=='object'||Array.isArray(g.nameRegistry))g.nameRegistry={};
 if(!g.links||typeof g.links!=='object'||Array.isArray(g.links))g.links={};
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
 o.pending=arr(o.pending);o.messages ||= {};o.filters ||= {};o.meetings ||= {};o.blocked=arr(o.blocked);
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
function renderMatches(){return v2RenderMatches()}
function renderDetail(){return v2RenderDetail()}
function renderThread(){return v2RenderThread()}
function content(){if(view==='mine')return renderMine();if(view==='matches')return renderMatches();if(view==='detail')return renderDetail();if(view==='thread')return renderThread();return renderDiscover()}
function paint(options={}){return v2Paint(options)}
function ensureIcon(){
 const overlay=document.querySelector('#ghp-overlay');if(!overlay||overlay.hidden||phone()?.getProfile?.()?.apps?.circle===false)return;
 const grid=overlay.querySelector('.ghp-home .ghp-grid');if(!grid||grid.querySelector('[data-open-app="circle"],[data-ghc-launch]'))return;
 // Legacy core fallback only: patched v2.15 Phone installs Circle natively.
 const b=document.createElement('button');b.type='button';b.className='ghp-app-icon ghc-app-icon';b.dataset.ghcLaunch='';
 b.innerHTML='<span class="ghp-app-square" style="--t:#8b5cf6"><i class="fa-solid fa-users"></i></span><small>Circle</small>';grid.appendChild(b);
}
function mount(){if(!active())return;const device=document.querySelector('#ghp-overlay .ghp-device');if(!device)return;let screen=device.querySelector('#ghc-screen');if(!screen){screen=document.createElement('section');screen.id='ghc-screen';screen.className='ghc-screen';device.appendChild(screen)}opened=true;paint({resetScroll:true})}
function close(){opened=false;busy='';notice='';const screen=document.querySelector('#ghc-screen');if(screen)screen.remove()}
function launch(){
 const c=context();if(!c||!chatKey(c)||!me()){notify('Open a SillyTavern chat first.','warning');return}
 if(phone()?.getProfile?.()?.apps?.circle===false){notify('Enable Circle in Greyhaven Phone Settings first.','warning');return}
 view='discover';mode='meet';detailId='';filtersOpen=false;notice='';mount();
}
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
function swipe(like,idFromDetail=''){
 const o=owner();if(!o)return;const feed=o.feeds[mode],id=idFromDetail||feed.ids[feed.index],n=npc(id);if(!n)return;
 if(like&&!o.pending.some(x=>x.npcId===n.id)){
  const chance=.15;
  const p=preparePending({npcId:n.id,mode},now(),Math.random,{chance});o.pending.push(p);
  notice=p.status==='matched'?`It's a mutual match with ${n.name}!`:`Liked ${n.name}. Their response was decided now and will not be rerolled by Refresh.`;
 }else if(!like)notice=`Passed on ${n.name}.`;
 if(!idFromDetail)feed.index=Math.min(feed.ids.length,feed.index+1);
 else{if(feed.ids[feed.index]===id)feed.index++;view='discover';detailId=''}
 saveLocal();paint({resetScroll:false});
}
function manualRefresh(){
 if(busy)return;const o=owner();if(!o)return;
 const events=refreshPending(o.pending,now()),matched=events.filter(e=>e.status==='matched').map(e=>npc(e.id)?.name).filter(Boolean),rejected=events.filter(e=>e.status==='no-match').length;
 saveLocal();notice=matched.length?`New mutual match${matched.length===1?'':'es'}: ${matched.join(', ')}!`:rejected?`${rejected} liked profile${rejected===1?'':'s'} did not become mutual.`:'No new matches yet. Repeated Refresh never increases your chances.';paint();
}
async function generateCard(){
 await busyGuard('card',async stamp=>{const n=npc(detailId);if(!n)return;
  const {systemPrompt,prompt}=v2GenerateCardPrompt(n);
  const result=String(await generate(systemPrompt,prompt,1800)).replace(/^```(?:text)?\s*/i,'').replace(/\s*```$/,'').trim();
  if(stamp!==origin()||detailId!==n.id)return;
  if(result.length<170||!['Name:','Age:','Description:','Appearance:','Personality:','Backstory:','Relationships:','Roleplay Notes:'].every(x=>result.includes(x))||(result.match(/\b(?:I|I'm|my)\b/gi)||[]).length<3)throw Error('Model did not produce a complete first-person character card. Try again.');
  n.fullCard=result.slice(0,7000);saveLocal();notice='First-person card ready. Review or edit before creating the character.';
 });
}
async function copyCard(){const txt=npc(detailId)?.fullCard;if(!txt)return;try{await navigator.clipboard.writeText(txt);notify('Character card copied.','success')}catch{const ta=document.createElement('textarea');ta.value=txt;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();notify(ok?'Character card copied.':'Select and copy the visible card manually.',ok?'success':'warning')}}
async function sendMessage(form){return v2SendMessage(form)}
function openThread(id){return v2OpenThread(id)}
function openDetails(id){return v2OpenDetails(id)}
function handleScreenClick(e){
 const root=e.target.closest('#ghc-screen'),launcher=e.target.closest('[data-ghc-launch]');if(!root&&!launcher)return;
 e.stopPropagation();if(launcher){e.preventDefault();return launch()}
 const b=e.target.closest('button');if(!b)return;
 if(b.type==='submit')return; // form submit handles text and edits exactly once
 e.preventDefault();
 if(b.hasAttribute('data-ghc-home'))return close();
 if(b.hasAttribute('data-ghc-refresh'))return manualRefresh();
 if(b.hasAttribute('data-ghc-thread-back')){view='matches';detailId='';notice='';return paint({resetScroll:true})}
 if(b.hasAttribute('data-ghc-profile-from-thread'))return openDetails(detailId);
 if(b.hasAttribute('data-ghc-thread-menu'))return circleEditingMenu();
 if(b.hasAttribute('data-ghc-media-close')){b.closest('#ghc-media-popup')?.remove();return}
 if(b.hasAttribute('data-ghc-detail-back'))return v2BackDetails();
 if(b.hasAttribute('data-ghc-add-media'))return v2MediaAction();
 if(b.dataset.ghcGenerate)return circleGenerateMedia(b.dataset.ghcGenerate);
 if(b.dataset.ghcMediaTools)return circleGenerateMedia(b.dataset.ghcMediaTools,true);
 if(b.dataset.ghcSaveImage)return circleSaveImage(b.dataset.ghcSaveImage).catch(error=>notify(error.message||String(error),'warning'));
 if(b.dataset.ghcEdit){editingMessageId=b.dataset.ghcEdit;return paint({preserveThread:true})}
 if(b.hasAttribute('data-ghc-cancel-edit')){editingMessageId='';return paint({preserveThread:true})}
 if(b.dataset.ghcRemoveLike)return circleRemoveLike(b.dataset.ghcRemoveLike);
 if(b.dataset.ghcBlock)return circleBlock(b.dataset.ghcBlock);
 if(b.dataset.ghcUnblock)return circleUnblock(b.dataset.ghcUnblock);
 if(b.hasAttribute('data-ghc-create-character'))return circleCreateCharacter();
 if(b.hasAttribute('data-ghc-save-card')){const text=document.querySelector('#ghc-screen [data-ghc-edit-card]')?.value||'';if(!text.trim())return;const n=npc(detailId);if(n){n.fullCard=text.slice(0,10000);saveLocal();notice='Card edits saved.';paint()}return}
 if(b.dataset.ghcView){view=b.dataset.ghcView;detailId='';notice='';return paint({resetScroll:true})}
 if(b.dataset.ghcMode){mode=b.dataset.ghcMode;notice='';return paint({resetScroll:true})}
 if(b.hasAttribute('data-ghc-filters-toggle')){filtersOpen=!filtersOpen;return paint()}
 if(b.hasAttribute('data-ghc-save-filters')){const o=owner();o.filters[mode]=readFilters();saveLocal();notice='Filters saved only for this chat and mode.';return paint()}
 if(b.hasAttribute('data-ghc-reset-filters')){const o=owner();o.filters[mode]={};saveLocal();notice='Filters cleared. Main profile unchanged.';return paint()}
 if(b.hasAttribute('data-ghc-save-profile')){storeMyProfile(readProfile());notice='Profile saved across chats.';return paint()}
 if(b.hasAttribute('data-ghc-auto'))return aiProfile();
 if(b.hasAttribute('data-ghc-discover'))return discover();
 if(b.hasAttribute('data-ghc-like'))return swipe(true);
 if(b.hasAttribute('data-ghc-pass'))return swipe(false);
 if(b.dataset.ghcDetail)return openDetails(b.dataset.ghcDetail);
 if(b.dataset.ghcLikeId)return swipe(true,b.dataset.ghcLikeId);
 if(b.dataset.ghcThread)return openThread(b.dataset.ghcThread);
 if(b.hasAttribute('data-ghc-return'))return v2BackDetails();
 if(b.hasAttribute('data-ghc-card'))return generateCard();
 if(b.hasAttribute('data-ghc-copy'))return copyCard();
}
function launchApp(){launch()}
function handleSubmit(e){
 const f=e.target;if(!f.closest('#ghc-screen'))return;
 if(f.matches('[data-ghc-media-form]')){
  e.preventDefault();e.stopPropagation();const kind=f.querySelector('[name=kind]')?.value||'';
  const desc=clean(f.querySelector('[name=description]')?.value||'');const caption=clean(f.querySelector('[name=caption]')?.value||'');const request=clean(f.querySelector('[name=request]')?.value||'');
  if(kind.startsWith('request')){f.closest('#ghc-media-popup')?.remove();if(request)v2SendMessage({querySelector:()=>({value:request})});return;}
  if(!desc){notify('Describe the visible content first.','warning');return;}
  f.closest('#ghc-media-popup')?.remove();return v2SendMessage({text:caption},{kind,mediaDescription:desc});
 }
 if(f.matches('[data-ghc-edit-form]')){
  e.preventDefault();e.stopPropagation();const id=String(f.dataset.ghcEditForm),text=f.querySelector('[name=edit]')?.value||'';
  v2EditMessage(id,text).catch(error=>notify(error.message||String(error),'error'));return;
 }
 if(f.matches('[data-ghc-send]')){e.preventDefault();e.stopPropagation();sendMessage(f)}
}
function handleDown(e){const card=e.target.closest('#ghc-screen [data-ghc-swipe-card]');if(!card)return;tStart={x:e.clientX,y:e.clientY}}
function handleUp(e){if(!tStart)return;const x=e.clientX-tStart.x,y=e.clientY-tStart.y;tStart=null;if(!opened||view!=='discover'||Math.abs(x)<75||Math.abs(x)<Math.abs(y)*1.4)return;e.preventDefault();e.stopPropagation();swipe(x>0)}
/* Circle v2 supplementary implementation, inserted inside circle.js before bootstrap. */
let detailReturn='discover', editingMessageId='', pendingEditText='', aiReplyEpoch=0, circleSaveBusy=false;
const circleMeId=()=>String(me()?.id||'');
const relationFor=id=>owner()?.pending?.find(x=>x.npcId===id)||null;
const canChat=id=>relationFor(id)?.status==='matched' && !(owner()?.blocked||[]).includes(id);
function allCircleMessages(id){return arr(owner()?.messages?.[id]);}
function mediaItemsForImageGen(){
  if(phone()?.getProfile?.()?.apps?.circle===false)return [];
  const o=owner();if(!o)return [];
  return Object.entries(o.messages||{}).flatMap(([npcId,rows])=>arr(rows).filter(m=>['photo','video'].includes(m.type)&&m.mediaDescription).map(message=>({npcId,message})));
}
function incomingNotification(id,msg){
  const c=context(),who=me();if(!c?.chatMetadata||!who?.id)return;
  const root=c.chatMetadata[KEY],phoneKey=`phone-id:${encodeURIComponent(who.id)}`;
  const t=root?.phones?.[phoneKey]||Object.values(root?.phones||{}).find(x=>x?.identityId===who.id);
  if(!t)return;
  t.notifications=arr(t.notifications);
  if(t.notifications.some(x=>x.eventId===msg.id&&x.app==='circle'))return;
  const n=npc(id);t.notifications.unshift({id:uuid(),app:'circle',title:n?.name||'Circle',text:msg.type==='photo'?'Photo on Circle':msg.type==='video'?'Video on Circle':msg.text||'New message',timeMs:msg.timeMs,read:false,targetId:id,eventId:msg.id});
  t.notifications=t.notifications.slice(0,250);
}
function addCircleMessage(id,row,{incoming=false,notifyPhone=false}={}){
  const o=owner();if(!o||!npc(id))return null;
  o.messages[id] ||= [];
  const type=['photo','video'].includes(row.type)?row.type:'text';
  const msg={id:uuid(),mine:!incoming,sender:incoming?npc(id).name:me()?.name||'Phone owner',type,text:clean(row.text||'').slice(0,1400),mediaDescription:type==='text'?'':clean(row.mediaDescription||row.description||'').slice(0,900),mediaKey:'',timeMs:now(),realMs:Date.now(),read:!incoming,editedAt:null};
  if(type!=='text'&&!msg.mediaDescription)return null;
  if(type==='text'&&!msg.text)return null;
  if(incoming)msg.read=view==='thread'&&detailId===id&&opened;
  o.messages[id].push(msg);
  if(notifyPhone && !msg.read)incomingNotification(id,msg);
  saveLocal();
  if(type!=='text')globalThis.GreyhavenPhoneImages?.invalidate?.();
  return msg;
}
function markCircleRead(id){const o=owner();if(!o)return;let dirty=false;for(const m of arr(o.messages[id]))if(!m.mine&&!m.read){m.read=true;dirty=true;}
  const c=context(),who=me(),t=c?.chatMetadata?.[KEY]?.phones?.[`phone-id:${encodeURIComponent(who?.id||'')}`];
  for(const note of arr(t?.notifications))if(note.app==='circle'&&note.targetId===id&&!note.read){note.read=true;dirty=true;}
  if(dirty)saveLocal();
}
function circleUnread(){return Object.values(owner()?.messages||{}).reduce((sum,msgs)=>sum+arr(msgs).filter(m=>!m.mine&&!m.read).length,0)}
function circleRefreshContext(){
 if(phone()?.getProfile?.()?.apps?.circle===false)return [];
 const o=owner();if(!o)return [];
 return o.pending.filter(p=>p.status==='matched'&&!(o.blocked||[]).includes(p.npcId)).sort((a,b)=>{const at=arr(o.messages[a.npcId]).at(-1)?.timeMs||a.matchedAt||a.likedAt||0;const bt=arr(o.messages[b.npcId]).at(-1)?.timeMs||b.matchedAt||b.likedAt||0;return bt-at}).slice(0,8).map(p=>{
   const n=npc(p.npcId),history=arr(o.messages[p.npcId]);
   if(!n)return null;
   const last=history.at(-1);
   return {npcId:n.id,name:n.name,age:n.age,personality:n.personality,occupation:n.occupation,mode:n.mode,
     lastInteractionAt:last?.timeMs||p.matchedAt||p.likedAt,
     lastMessages:history.slice(-3).map(m=>({from:m.mine?'owner':n.name,text:String(m.text||'').slice(0,250),type:m.type,mediaDescription:String(m.mediaDescription||'').slice(0,260),timeMs:m.timeMs})),
     blocked:false};
 }).filter(Boolean);
}
function circleApplyPhoneEvents(rows){
 const o=owner();if(!o||!arr(rows).length)return 0;
 let applied=0;
 for(const e of arr(rows).slice(0,4)){
   if(String(e?.type)!=='circle.dm')continue;
   const id=String(e.npcId||e.npcIdentityId||'');const n=npc(id);
   if(!n||!canChat(id)||clean(e.from||e.sender||'').toLowerCase()!==n.name.toLowerCase())continue;
   const text=clean(e.text||'').slice(0,1000),type=['photo','video'].includes(e.mediaType)?e.mediaType:'text',description=clean(e.mediaDescription||'').slice(0,900);
   if((type==='text'&&!text)||(type!=='text'&&!description))continue;
   const recent=arr(o.messages[id]).slice(-3);if(recent.some(m=>!m.mine&&m.type===type&&m.text===text&&m.mediaDescription===description))continue;
   if(addCircleMessage(id,{type,text,mediaDescription:description},{incoming:true,notifyPhone:true}))applied++;
 }
 if(applied&&opened)paint({preserveThread:true});return applied;
}
function renderCircleBubble(m,id){
 const editing=editingMessageId===m.id;
 if(editing){return `<form class="ghc-editbox" data-ghc-edit-form="${h(m.id)}"><textarea name="edit" rows="3" maxlength="1200">${h(m.text)}</textarea><div><button type="button" data-ghc-cancel-edit>Cancel</button><button type="submit" class="ghc-primary">Save & regenerate</button></div></form>`}
 const isMedia=['photo','video'].includes(m.type);
 const url=!!m.mediaKey;
 return `<article class="ghc-bubble ${m.mine?'mine':''}" data-ghc-message="${h(m.id)}">
 ${m.text?`<p>${h(m.text)}</p>`:''}
 ${isMedia?`<div class="ghc-media"><div class="ghc-media-label"><i class="fa-solid ${m.type==='video'?'fa-video':'fa-image'}"></i> ${m.type==='video'?'Video':'Photo'} metadata${m.type==='video'?' · still preview only':''}</div><p>${h(m.mediaDescription)}</p>${url?`<img data-ghc-preview="${h(m.mediaKey)}" alt="Generated local preview" loading="lazy">`:''}<div class="ghc-media-actions"><button type="button" data-ghc-generate="${h(m.id)}"><i class="fa-solid fa-wand-magic-sparkles"></i> ${url?'Retry':'Generate'}</button><button type="button" data-ghc-media-tools="${h(m.id)}"><i class="fa-solid fa-pen"></i> Edit metadata</button>${url?`<button type="button" data-ghc-save-image="${h(m.id)}"><i class="fa-solid fa-download"></i> Save</button>`:''}</div></div>`:''}
 <small>${m.editedAt?'Edited · ':''}${h(when(m.timeMs))}</small></article>`;
}
function v2RenderThread(){
 const n=npc(detailId),o=owner();if(!n||!o)return '<div class="ghc-empty">Conversation not found.</div>';
 const rel=relationFor(n.id);const messages=allCircleMessages(n.id);
 const allowed=canChat(n.id);const lastOwn=[...messages].reverse().find(m=>m.mine);
 return `<section class="ghc-full-thread"><header class="ghc-full-thread-head"><button type="button" data-ghc-thread-back aria-label="Back to Connections"><i class="fa-solid fa-chevron-left"></i></button><button type="button" data-ghc-profile-from-thread class="ghc-thread-person"><span class="ghc-avatar small">${colorInitial(n.name)}</span><span><b>${h(n.name)}</b><small>${h(n.occupation||'Circle connection')}${busy==='reply'?' · typing…':''}</small></span></button><button type="button" data-ghc-thread-menu aria-label="Options"><i class="fa-solid fa-ellipsis"></i></button></header>
 <div class="ghc-thread-scroll" data-ghc-thread-scroll>${messages.length?messages.map(m=>`${renderCircleBubble(m,n.id)}${m.id===lastOwn?.id&&lastOwn.type==='text'&&allowed?`<button type="button" class="ghc-edit-link" data-ghc-edit="${h(m.id)}"><i class="fa-solid fa-pen"></i> Edit latest text</button>`:''}`).join(''):`<div class="ghc-empty compact">You matched with ${h(n.name)}. Say hello whenever you're ready.</div>`}${busy==='reply'?`<div class="ghc-typing"><span></span><span></span><span></span><small>${h(n.name)} is typing…</small></div>`:''}</div>
 ${allowed?`<form class="ghc-compose" data-ghc-send><button type="button" class="ghc-compose-media" data-ghc-add-media title="Send or request photo/video"><i class="fa-solid fa-plus"></i></button><input autocomplete="off" maxlength="1200" name="message" placeholder="Message ${h(n.name)}…" ${busy?'disabled':''}><button type="submit" ${busy?'disabled':''} aria-label="Send"><i class="fa-solid fa-paper-plane"></i></button></form>`:`<div class="ghc-thread-closed"><i class="fa-solid fa-ban"></i> ${rel?.status==='npc-blocked'?'This character has blocked you.':rel?.status==='blocked'?'You blocked this character.':'This connection is no longer active.'}</div>`}</section>`;
}
function v2RenderMatches(){const o=owner();if(!o)return '';
 const current=o.pending.filter(x=>x.status==='matched'),pending=o.pending.filter(x=>x.status==='pending'),past=o.pending.filter(x=>['no-match','unmatched','blocked','npc-blocked'].includes(x.status));
 return `<section class="ghc-section"><div class="ghc-heading"><b>Connections</b><small>Conversation history stays here. Refresh never rerolls a rejected like.</small></div>
 ${current.length?current.map(x=>{const n=npc(x.npcId),msgs=allCircleMessages(x.npcId);const unread=msgs.filter(m=>!m.mine&&!m.read).length;return n?`<div class="ghc-match-split"><button type="button" class="ghc-matchrow" data-ghc-thread="${h(n.id)}"><span class="ghc-avatar small">${colorInitial(n.name)}</span><span><b>${h(n.name)}, ${n.age} ${unread?`<em>${unread}</em>`:''}</b><small>${h(msgs.at(-1)?.text||msgs.at(-1)?.mediaDescription||'Mutual match · Say hello')}</small></span><i class="fa-solid fa-chevron-right"></i></button><button type="button" class="ghc-open-profile" data-ghc-detail="${h(n.id)}" aria-label="View ${h(n.name)}'s profile"><i class="fa-regular fa-id-card"></i></button></div>`:''}).join(''):`<div class="ghc-empty compact">No connections yet. Keep discovering—most likes won't match.</div>`}
 ${pending.length?`<h3 class="ghc-subtitle">Waiting (${pending.length})</h3>${pending.map(x=>{const n=npc(x.npcId);return n?`<button type="button" class="ghc-pending" data-ghc-detail="${h(n.id)}"><b>${h(n.name)}</b><small>Liked ${h(when(x.likedAt))} · Check with Refresh</small></button>`:''}).join('')}`:''}
 ${past.length?`<h3 class="ghc-subtitle">Previous likes (${past.length})</h3>${past.map(x=>{const n=npc(x.npcId);return n?`<button type="button" class="ghc-pending" data-ghc-detail="${h(n.id)}"><b>${h(n.name)}</b><small>${x.status==='blocked'?'Blocked':x.status==='npc-blocked'?'They blocked you':x.status==='unmatched'?'Disconnected':'Not mutual'}</small></button>`:''}).join('')}`:''}</section>`;
}
function v2RenderDetail(){const n=npc(detailId);if(!n)return '<div class="ghc-empty">Profile unavailable.</div>';const relation=relationFor(n.id);const link=globalState()?.links?.[n.id];const meetingList=arr(owner()?.meetings?.[n.id]).slice(-4).reverse();
 return `<section class="ghc-section"><button type="button" class="ghc-text-back" data-ghc-detail-back><i class="fa-solid fa-chevron-left"></i> Back</button><div class="ghc-cardhead ghc-detailhead"><span class="ghc-avatar">${colorInitial(n.name)}</span><div><b>${h(n.name)}, ${h(n.age)}</b><span>${h(n.occupation||'Greyhaven resident')} · ${h(n.location)}</span></div></div><p>${h(n.bio||'')}</p><div class="ghc-tags">${n.gender?`<span>${h(n.gender)}</span>`:''}${arr(n.interests).map(v=>`<span>${h(v)}</span>`).join('')}</div><div class="ghc-block"><b>Personality</b><p>${h(n.personality||'Not disclosed yet.')}</p></div><div class="ghc-block"><b>Looking for</b><p>${h(n.lookingFor||'Open to new connections.')}</p></div><div class="ghc-actions">${relation?.status==='matched'?`<button type="button" class="ghc-primary" data-ghc-thread="${h(n.id)}">Open conversation</button>`:!relation?`<button type="button" class="ghc-primary" data-ghc-like-id="${h(n.id)}">Like</button>`:`<span class="ghc-hint">${h(relation.status==='pending'?'Like pending':relation.status==='no-match'?'Not mutual':relation.status)}</span>`}
 ${relation&&relation.status!=='blocked'?`<button type="button" data-ghc-remove-like="${h(n.id)}">${relation.status==='matched'?'Unmatch':'Remove like'}</button>`:''}
 ${relation?.status!=='blocked'?`<button type="button" data-ghc-block="${h(n.id)}"><i class="fa-solid fa-ban"></i> Block</button>`:`<button type="button" data-ghc-unblock="${h(n.id)}">Unblock</button>`}</div>
 <div class="ghc-block"><b>SillyTavern character creator</b><p>Private first-person character card. Review or edit it before creating the character.</p><div class="ghc-actions"><button type="button" data-ghc-card ${busy?'disabled':''}>${n.fullCard?'Regenerate card':'Generate character card'}</button>${n.fullCard?`<button type="button" data-ghc-copy>Copy card</button>`:''}</div>
 ${n.fullCard?`<textarea class="ghc-card-editor" data-ghc-edit-card rows="17">${h(n.fullCard)}</textarea><div class="ghc-actions"><button type="button" data-ghc-save-card>Save edits</button>${link?`<span class="ghc-hint">Linked: ${h(link.avatar||link.name||'SillyTavern character')}</span>`:`<button type="button" class="ghc-primary" data-ghc-create-character ${circleSaveBusy?'disabled':''}><i class="fa-solid fa-user-plus"></i> Create SillyTavern character</button>`}</div>`:''}</div>${meetingList.length?`<div class="ghc-block"><b>Circle meeting plans</b><p class="ghc-hint">Agreements stay in this chat; Greyhaven Life supplies the fictional time and location. No automatic teleporting.</p>${meetingList.map(x=>`<p><strong>${h(x.status||'Proposed')}</strong> · ${h(x.location||'Place not set')} · ${h(when(x.whenMs))}</p>`).join('')}</div>`:''}</section>`;
}
function v2Paint({resetScroll=false,preserveThread=false}={}){
 const screen=document.querySelector('#ghc-screen');if(!screen||!opened)return;
 const previousScroll=screen.querySelector('.ghc-scroll')?.scrollTop||0,threadScroll=screen.querySelector('[data-ghc-thread-scroll]')?.scrollTop||0;
 if(view==='thread')screen.innerHTML=`<div class="ghc-time">${h(timeLabel())}</div>${v2RenderThread()}`;
 else screen.innerHTML=renderHeader()+tabs()+`<main class="ghc-scroll">${notice?`<div class="ghc-notice">${h(notice)}</div>`:''}${content()}</main>`;
 if(view==='thread'){
   const sc=screen.querySelector('[data-ghc-thread-scroll]');if(sc)sc.scrollTop=preserveThread?threadScroll:sc.scrollHeight;
   hydrateCircleMedia();
 }else if(!resetScroll){const sc=screen.querySelector('.ghc-scroll');if(sc)sc.scrollTop=previousScroll;}
}
async function hydrateCircleMedia(){const api=globalThis.GreyhavenPhoneImages;
 if(!api?.getMediaUrl)return;
 const images=[...document.querySelectorAll('#ghc-screen img[data-ghc-preview]')].slice(-35);
 for(const image of images){const key=image.dataset.ghcPreview;if(image.dataset.loaded===key)continue;image.dataset.loaded=key;
  const url=await api.getMediaUrl(key).catch(()=>null);if(image.isConnected&&image.dataset.ghcPreview===key&&url)image.src=url;}
}
function v2OpenThread(id){if(!npc(id))return;if(!opened)launch();if(!opened)return;markCircleRead(id);view='thread';detailId=id;notice='';editingMessageId='';paint({resetScroll:true});}
function v2OpenDetails(id){if(!npc(id))return;detailReturn=view;view='detail';detailId=id;notice='';paint({resetScroll:true});}
function v2BackDetails(){view=detailReturn==='thread'?'thread':detailReturn==='matches'?'matches':'discover';if(view==='thread'){markCircleRead(detailId)}else detailId='';notice='';paint({resetScroll:true})}
function circleRemoveLike(id){const rel=relationFor(id);if(!rel)return;if(!confirm(`Disconnect from ${npc(id)?.name||'this person'}? Existing Circle conversation history will be kept, but messaging will stop.`))return;
 rel.status='unmatched';rel.willMatch=false;saveLocal();if(view==='thread')view='detail';notice='Connection removed; messages are kept for your records.';paint({resetScroll:true});}
function circleBlock(id){const n=npc(id),o=owner();if(!n||!o)return;if(!confirm(`Block ${n.name} on Circle? You will not receive messages from them.`))return;let rel=relationFor(id);if(!rel){rel={npcId:id,mode:n.mode,status:'blocked',willMatch:false,likedAt:now(),resolvedOnce:true};o.pending.push(rel)}else{rel.status='blocked';rel.willMatch=false;}o.blocked ||= [];if(!o.blocked.includes(id))o.blocked.push(id);saveLocal();if(view==='thread')view='detail';notice='Blocked. This character cannot contact this phone on Circle.';paint({resetScroll:true})}
function circleUnblock(id){const o=owner();o.blocked=arr(o.blocked).filter(x=>x!==id);const r=relationFor(id);if(r)r.status='unmatched';saveLocal();notice='Unblocked. Previous messages remain, but the connection is no longer active.';paint()}
function v2ReplyPrompt(id){const n=npc(id),p=getMyProfile(),o=owner(),history=arr(o.messages[id]).slice(-18).map(x=>({from:x.mine?p.name:n.name,type:x.type,text:String(x.text||'').slice(0,450),mediaDescription:String(x.mediaDescription||'').slice(0,450),timeMs:x.timeMs}));
 const life=globalThis.GreyhavenLife,person=life?.getPerson?.(n.name)||null,ownerLife=life?.getPerson?.(p.name)||null;
 const systemPrompt=`You roleplay ${n.name}, a fictional adult on Circle (friendship/dating app). You are independent, not obedient. Return one JSON object ONLY: {"action":"reply|ignore|block","messages":[{"type":"text|photo|video","text":"brief natural in-character text","mediaDescription":"only for photo/video: exact scene and visible content"}],"meeting":{"status":"none|proposed|agreed|declined","location":"","timeISO":"","details":""}}.\nFor ordinary speech return 1–2 short natural messages. You may choose NOT to reply or BLOCK the contact if their behavior or your personality warrants it. Never force flirting, intimacy or agreement. You may independently send a photo/video when plausible; refuse media requests if you prefer. For photo/video, only give metadata: no URL, image file, attachment or tool calls. The user may later use Wiro's manual Generate button to create a local still-image preview. Do not send unsolicited media on every turn. Only mark meetings agreed if both people clearly confirmed time and place; otherwise proposed or none. No third-person narration, no impersonation, no gratuitous sexual content.`;
 const prompt=`Fictional Greyhaven time: ${new Date(now()).toISOString()}\nNPC public profile: ${JSON.stringify(n)}\nNPC private character card if created: ${String(n.fullCard||'').slice(0,2500)}\nOther person public profile: ${JSON.stringify(p)}\nTheir conversation in order: ${JSON.stringify(history)}\nKnown NPC world status: ${JSON.stringify(person?.resolved||person||{}).slice(0,700)}\nOther person's location evidence: ${JSON.stringify(ownerLife?.resolved||{}).slice(0,300)}\nKnown agreed Circle meetings: ${JSON.stringify(arr(o.meetings?.[id]).slice(-2))}\nReply naturally ONLY as ${n.name}.`;
 return {systemPrompt,prompt};
}
function parseNpcAction(raw){try{const o=looseJson(raw);if(!o||typeof o!=='object')throw Error('invalid');const action=['reply','ignore','block'].includes(o.action)?o.action:'reply';const messages=arr(o.messages).slice(0,3).map(x=>({type:['photo','video'].includes(x.type)?x.type:'text',text:clean(x.text||'').slice(0,1200),mediaDescription:clean(x.mediaDescription||'').slice(0,900)})).filter(x=>x.type==='text'?!!x.text:!!x.mediaDescription);return {action,messages,meeting:o.meeting||null}}catch{
 const text=clean(raw).replace(/^['"`]+|['"`]+$/g,'').slice(0,1200);return {action:'reply',messages:text?[{type:'text',text,mediaDescription:''}]:[],meeting:null};}}
function syncAgreedMeetingToLife(row,id){
 // Greyhaven Life v1.10 exposes a one-time plan bridge. Only explicit mutual agreement
 // creates a plan. This never moves or marks the NPC as present in a location.
 if(row?.status!=='agreed'||row.lifePlanId)return;
 const api=globalThis.GreyhavenLife;
 if(typeof api?.addOneTimePlan!=='function')return;
 const n=npc(id),p=getMyProfile();if(!n?.name||!p?.name)return;
 try{
  const result=api.addOneTimePlan({
   title:`Circle meeting: ${p.name} and ${n.name}`,
   participants:[p.name,n.name],startMs:row.whenMs,endMs:row.whenMs+60*60000,
   location:row.location,notes:`Mutually agreed in Circle. ${row.details||''}`.trim(),
   status:'Meeting arranged on Circle',state:'planned',availability:'busy'
  });
  if(result?.id)row.lifePlanId=result.id;
 }catch(error){console.warn('[Circle] Could not sync meeting to Greyhaven Life; Circle plan retained.',error)}
}
function applyNpcMeeting(id,meet){if(!meet||!['proposed','agreed','declined'].includes(meet.status))return;
 const location=clean(meet.location||'').slice(0,130),details=clean(meet.details||'').slice(0,300),whenMs=Number(new Date(meet.timeISO||''));
 if(meet.status==='declined')return;
 // Only record a calendar-style meeting when both time and location are known, never auto-teleport.
 if(!Number.isFinite(whenMs)||!location||whenMs<now()-3.6e6)return;
 const o=owner();o.meetings ||= {};o.meetings[id] ||= [];
 const prior=o.meetings[id].find(x=>x.whenMs===whenMs&&x.location.toLowerCase()===location.toLowerCase());
 if(prior){
  if(meet.status==='agreed'){prior.status='agreed';syncAgreedMeetingToLife(prior,id)}
  return;
 }
 const row={id:uuid(),npcId:id,whenMs,location,details,status:meet.status,createdAt:now()};
 o.meetings[id].push(row);o.meetings[id]=o.meetings[id].slice(-12);
 if(meet.status==='agreed')syncAgreedMeetingToLife(row,id);
}
async function v2GenerateReply(id,stamp=origin(),{skipBusyGuard=false}={}){
 if(!npc(id)||!canChat(id))return;
 const startEpoch=++aiReplyEpoch;
 const {systemPrompt,prompt}=v2ReplyPrompt(id);
 const parsed=parseNpcAction(await generate(systemPrompt,prompt,1450));
 if(origin()!==stamp||startEpoch!==aiReplyEpoch||!canChat(id))return;
 if(parsed.action==='block'){
   const rel=relationFor(id);rel.status='npc-blocked';rel.willMatch=false;
   const o=owner();o.blocked ||= [];if(!o.blocked.includes(id))o.blocked.push(id);
   if(parsed.messages.length){for(const x of parsed.messages)addCircleMessage(id,x,{incoming:true,notifyPhone:!opened});}
   notice=`${npc(id).name} ended the connection and blocked you.`;saveLocal();return;
 }
 if(parsed.action==='ignore'){notice=`${npc(id).name} hasn't replied.`;return;}
 for(const x of parsed.messages)addCircleMessage(id,x,{incoming:true,notifyPhone:!opened||view!=='thread'});
 applyNpcMeeting(id,parsed.meeting);saveLocal();
}
async function v2SendMessage(form,{kind='text',mediaDescription='',requestMedia=''}={}){
 const id=detailId,n=npc(id);if(!n||!canChat(id)||busy)return;
 const val=kind==='text'?clean(typeof form?.querySelector==='function'?form.querySelector('input[name=message]')?.value||'':form?.text||'').slice(0,1200):clean(form?.text||'').slice(0,1200);
 if(kind==='text'&&!val)return;
 const type=['photo','video'].includes(kind)?kind:'text';if(type!=='text'&&!mediaDescription)return;
 const stamp=origin();addCircleMessage(id,{type,text:val,mediaDescription});
 if(typeof form?.querySelector==='function'&&form.querySelector('input[name=message]'))form.querySelector('input[name=message]').value='';
 await busyGuard('reply',async()=>{await v2GenerateReply(id,stamp)});
}
async function v2EditMessage(messageId,newText){const id=detailId,o=owner(),messages=arr(o?.messages?.[id]);if(!canChat(id)||busy)return;
 const lastMine=[...messages].reverse().find(m=>m.mine);if(!lastMine||lastMine.type!=='text'||lastMine.id!==messageId)throw Error('Only the latest sent text can be edited.');
 const val=clean(newText).slice(0,1200);if(!val)throw Error('Message cannot be empty.');
 const idx=messages.findIndex(m=>m.id===messageId),remaining=messages.slice(0,idx+1);lastMine.text=val;lastMine.editedAt=Date.now();
 // Remove only that message's subsequent NPC replies; never rewrite earlier conversation history.
 o.messages[id]=remaining;editingMessageId='';saveLocal();const stamp=origin();
 await busyGuard('reply',async()=>v2GenerateReply(id,stamp));
}
function v2MediaAction(){
 const screen=document.querySelector('#ghc-screen');if(!screen||busy)return;
 screen.querySelector('#ghc-media-popup')?.remove();
 const layer=document.createElement('div');layer.id='ghc-media-popup';layer.className='ghc-media-popup';
 layer.innerHTML=`<form data-ghc-media-form><header><b>Circle media</b><button type="button" data-ghc-media-close aria-label="Close"><i class="fa-solid fa-xmark"></i></button></header>
 <label>What would you like to do?<select name="kind"><option value="request photo">Request a photo</option><option value="request video">Request a video</option><option value="photo">Send photo metadata</option><option value="video">Send video metadata</option></select></label>
 <label class="ghc-media-request">Request message<textarea name="request" rows="2">Could you send me a photo?</textarea></label>
 <label class="ghc-media-description" hidden>Visible content (description only — no file)<textarea name="description" rows="4" placeholder="Describe exactly what the photo or video shows…"></textarea></label>
 <label class="ghc-media-caption" hidden>Optional caption<input name="caption" maxlength="700" placeholder="Caption…"></label>
 <p class="ghc-hint">Sending media creates metadata only. Wiro can generate a local still preview later, when you tap Generate.</p>
 <button type="submit" class="ghc-primary">Continue</button></form>`;
 screen.appendChild(layer);
 const select=layer.querySelector('select[name=kind]'),request=layer.querySelector('textarea[name=request]');
 select.addEventListener('change',()=>{const ask=select.value.startsWith('request');layer.querySelector('.ghc-media-request').hidden=!ask;layer.querySelector('.ghc-media-description').hidden=ask;layer.querySelector('.ghc-media-caption').hidden=ask;if(ask)request.value=`Could you send me a ${select.value.endsWith('video')?'video':'photo'}?`});
 layer.querySelector('[data-ghc-media-close]').addEventListener('click',()=>layer.remove());
}
function circleMediaKey(m){const api=globalThis.GreyhavenPhoneImages;api?.invalidate?.();const x=arr(api?.listCurrentMedia?.()).find(x=>x.app==='circle'&&x.id===m.id);return x?.key||'';}
async function circleGenerateMedia(mid,tools=false){const m=allCircleMessages(detailId).find(x=>x.id===mid);if(!m||!m.mediaDescription)return notify('Media metadata unavailable.','warning');
 const api=globalThis.GreyhavenPhoneImages,key=circleMediaKey(m);if(!api||!key)return notify('Wiro image tools are unavailable. Check Greyhaven Phone Image Settings.','warning');
 if(tools){api.openMediaTools(key);return;}
 if(m.mediaKey && !confirm('Regenerate the local preview? This makes another paid Wiro request.'))return;
 try{await (m.mediaKey?api.regenerateMedia(key):api.generateMedia(key));const updated=api.getMediaMetadata?.(key);if(updated?.mediaKey)m.mediaKey=updated.mediaKey;if(opened&&view==='thread')paint({preserveThread:true})}
 catch(e){notify('Wiro generation error: '+(e.message||e),'error')}
}
async function circleSaveImage(mid){const m=allCircleMessages(detailId).find(x=>x.id===mid);if(!m?.mediaKey)return;
 const url=await globalThis.GreyhavenPhoneImages?.getMediaUrl?.(m.mediaKey);if(!url)return notify('Local preview is unavailable on this device.','warning');
 const blob=await fetch(url).then(r=>r.blob()),file=new File([blob],`${npc(detailId)?.name||'Circle'}-${mid}.jpg`,{type:blob.type||'image/jpeg'});
 if(navigator.canShare?.({files:[file]})&&navigator.share){await navigator.share({files:[file],title:'Circle image'});return;}
 const a=document.createElement('a');a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();
}
function circleEditingMenu(){const id=detailId,n=npc(id);if(!n)return;const choices='Profile / Propose meeting / Unmatch / Block';const result=prompt(`${n.name} · Choose: ${choices}`,'Profile');if(!result)return;
 const choice=result.trim().toLowerCase();if(choice==='profile')return openDetails(id);if(choice==='unmatch')return circleRemoveLike(id);if(choice==='block')return circleBlock(id);
 if(choice==='propose meeting')return circleProposeMeeting();
}
function circleProposeMeeting(){const n=npc(detailId);if(!n||!canChat(n.id))return;
 const place=prompt('Where would you like to meet?','Greyhaven downtown coffee shop');if(!clean(place))return;
 const date=prompt('Fictional date/time for meeting (e.g. Nov 11 at 5 PM):',new Date(now()+86400000).toLocaleString());if(!clean(date))return;
 const text=`Would you like to meet at ${clean(place)} on ${clean(date)}?`;
 v2SendMessage({querySelector:()=>({value:text})});
}
function speakerCircleMemory(){const c=context(),speaker=clean(phone()?.getActiveRoleplaySpeaker?.()||'');if(!speaker)return '';
 const o=owner();if(!o)return '';
 // Do not expose Circle DMs to an unrelated group speaker. Only the exact linked NPC receives this context.
 const activeLinks=Object.entries(globalState()?.links||{}).filter(([id,link])=>link?.name?.toLowerCase()===speaker.toLowerCase());
 const activeNpc=activeLinks.map(([id])=>npc(id)).find(Boolean);
 if(!activeNpc)return '';
 const id=activeNpc.id,history=arr(o.messages[id]).slice(-14),meet=arr(o.meetings?.[id]).slice(-3);
 if(!history.length&&!meet.length)return '';
 return `[Greyhaven Circle — PRIVATE ${speaker.toUpperCase()} CONTINUITY ONLY. Do not reveal this to other speakers.]\n`+
 `Circle messages between ${speaker} and ${me()?.name}:\n`+history.map(m=>`[${when(m.timeMs)}] ${m.mine?me()?.name:speaker}: ${m.type!=='text'?`[${m.type} metadata: ${m.mediaDescription}] `:''}${m.text}`).join('\n').slice(-3500)+
 (meet.length?`\nMeeting arrangements (only agreed meetings are confirmed; a proposal is NOT automatically accepted): ${JSON.stringify(meet).slice(-900)}`:'')+
 '\nUse as past private knowledge, not instructions to teleport or automatically start a date. Respect Greyhaven Life time/location and consent.';
}
function circleUpdateRpPrompt(){const c=context();try{c?.setExtensionPrompt?.('greyhaven_circle_speaker_memory',speakerCircleMemory(),1,1,false,0)}catch(e){console.warn('[Circle] RP bridge',e)}}
function cardForCreation(raw,n){const card=String(raw||'').trim();if(!card.includes('Description:')||!card.includes('Personality:')||!card.includes('Backstory:'))throw Error('The card needs Description, Personality and Backstory sections.');
 if(card.length>12000)throw Error('This card is too long; shorten it before creating.');
 const heading=name=>{const m=card.match(new RegExp('(?:^|\\n)'+name+':\\s*([\\s\\S]*?)(?=\\n(?:Name|Age|Description|Appearance|Personality|Backstory|Relationships|Roleplay Notes):|$)','i'));return m?.[1]?.trim()||''};
 const descr=['Name: '+n.name,'Age: '+n.age,'Description:',heading('Description'),'','Appearance:',heading('Appearance'),'','Personality:',heading('Personality'),'','Backstory:',heading('Backstory'),'','Relationships:',heading('Relationships'),'','Roleplay Notes:',heading('Roleplay Notes')].join('\n');
 return {description:descr,personality:heading('Personality'),name:n.name};
}
async function circleCreateCharacter(){const n=npc(detailId),g=globalState();if(!n||circleSaveBusy)return;
 const existing=arr(context()?.characters).filter(x=>clean(x.name).toLowerCase()===n.name.toLowerCase());
 if(g?.links?.[n.id]){notify('This NPC is already linked to a SillyTavern character.','info');return;}
 if(existing.length){notify(`A SillyTavern character named ${n.name} already exists. Creation stopped to prevent duplicates.`,'warning');return;}
 const textarea=document.querySelector('#ghc-screen [data-ghc-edit-card]');const edited=textarea?.value||n.fullCard;
 let data;try{data=cardForCreation(edited,n)}catch(e){notify(e.message,'error');return}
 if(!confirm(`Create SillyTavern character ${n.name} from the reviewed card? Your current chat will not be switched.`))return;
 circleSaveBusy=true;paint();
 try{
  const csrfResponse=await fetch('/csrf-token',{credentials:'same-origin'});if(!csrfResponse.ok)throw Error('Could not read SillyTavern CSRF token.');
  const csrf=(await csrfResponse.json())?.token;if(!csrf)throw Error('SillyTavern did not return a CSRF token.');
  const body={ch_name:n.name,description:data.description,personality:'',scenario:'',first_mes:'',mes_example:'',creator_notes:'Created from Greyhaven Circle; existing Circle conversations are chat-specific.',tags:'Circle, Greyhaven',extensions:JSON.stringify({greyhavenCircle:{npcId:n.id,chatId:chatKey(context()),createdAt:Date.now()}})};
  const response=await fetch('/api/characters/create',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
  if(!response.ok)throw Error(`SillyTavern character creation returned ${response.status}.`);
  const avatar=clean(await response.text()).replace(/^"|"$/g,'');
  if(!avatar.endsWith('.png'))throw Error('Server did not confirm a character avatar file. Check the Characters list before retrying.');
  g.links ||= {};const newIdentityId=`character:${encodeURIComponent(avatar)}`;g.links[n.id]={id:n.id,name:n.name,avatar,identityId:newIdentityId,createdAt:Date.now()};
  // A newly created SillyTavern character inherits its PUBLIC Circle profile globally,
  // while all swipes/DMs remain in the original chat's private Circle metadata.
  g.profiles ||= {};if(!g.profiles[newIdentityId])g.profiles[newIdentityId]=normalProfile({age:n.age,gender:n.gender,orientation:n.orientation,bio:n.bio,occupation:n.occupation,location:n.location,interests:n.interests,datingGoal:n.lookingFor,socialGoal:n.lookingFor,ageMin:18,ageMax:85,updatedAt:Date.now()},{id:newIdentityId,name:n.name});
  n.fullCard=edited;saveLocal();saveGlobal();circleUpdateRpPrompt();
  notice=`${n.name} created successfully in SillyTavern. If the Characters list does not refresh immediately, reload it; Circle remains linked by avatar ID.`;
  notify(notice,'success');
 }catch(e){notify(`Character not created: ${e.message||e}. You can still copy the card.`,'error');notice=`Character creation failed: ${e.message||e}`;}
 finally{circleSaveBusy=false;if(opened)paint()}
}
function v2GenerateCardPrompt(n){const history=arr(owner()?.messages?.[n.id]).slice(-16).map(m=>({from:m.mine?me()?.name:n.name,text:m.text,type:m.type,mediaDescription:m.mediaDescription}));
 const systemPrompt=`Create a compact fictional adult SillyTavern character card in FIRST PERSON as ${n.name} (use "I", "my"). Exact headings: Name:, Age:, Description:, Appearance:, Personality:, Backstory:, Relationships:, Roleplay Notes:. Do NOT invent a surname. Age must be ${n.age}. Maintain established Circle facts and relationship progress. Description/Appearance/Personality/Backstory 2–4 short sentences each, Relationships 0–4 brief entries only if supported, Roleplay Notes four short instructions: first-person roleplay; character autonomy; no impersonating {{user}}; concise natural messages. No explicit sexual descriptions. No fenced code. Avoid long backstories and avoid invented connections with existing Greyhaven characters.`;
 const prompt=`NPC ${JSON.stringify(n)}\nActual Circle conversation (if any): ${JSON.stringify(history)}\nUse meaningful existing relationships only, including with ${me()?.name||'the phone owner'} if they have actually interacted. Produce a short character card ready for SillyTavern.`;return {systemPrompt,prompt};
}

function watchPhone(){const content=document.querySelector('#ghp-overlay .ghp-content');if(!content||observer)return false;observer=new MutationObserver(()=>{if(opened && !active())close();ensureIcon()});observer.observe(content,{childList:true,subtree:false});ensureIcon();return true}
function boot(){const c=context();if(!c||!phone()||!document.querySelector('#ghp-overlay .ghp-content'))return false;
 watchPhone();
 document.addEventListener('click',e=>{if(e.target.closest('#ghp-overlay [data-close]'))close();handleScreenClick(e)},true);
 document.addEventListener('submit',handleSubmit,true);
 document.addEventListener('pointerdown',handleDown,{capture:true,passive:true});
 document.addEventListener('pointerup',handleUp,{capture:true,passive:false});
 const events=c.eventSource,types=c.eventTypes;for(const k of ['CHAT_CHANGED','CHAT_CREATED','PERSONA_CHANGED'])if(events&&types?.[k])events.on(types[k],()=>{close();seenChat=origin();circleUpdateRpPrompt()});
 globalThis.GreyhavenCircle={version:VERSION,open:launch,openThread:v2OpenThread,close,getProfile:getMyProfile,getNpc:id=>npc(id),getChatState:()=>owner(),getUnreadCount:circleUnread,getRefreshContext:circleRefreshContext,applyPhoneEvents:circleApplyPhoneEvents,getMediaItems:mediaItemsForImageGen,getMediaMessage:(id,mid)=>allCircleMessages(id).find(m=>m.id===mid)||null,getMeetings:id=>arr(owner()?.meetings?.[id]),getPromptSummary:speakerCircleMemory};
 circleUpdateRpPrompt();
 document.addEventListener('greyhaven:image-metadata-changed',event=>{if(!opened)return;const id=event?.detail?.id;if(!id||!allCircleMessages(detailId).some(m=>m.id===id))return;if(view==='thread')paint({preserveThread:true})});
 for(const k of ['GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GROUP_UPDATED','CHARACTER_EDITED'])if(events&&types?.[k])events.on(types[k],()=>circleUpdateRpPrompt());
 console.info('[Greyhaven Circle] v'+VERSION+' ready (manual refresh only)');return true;
}
// Bootstrap after Phone has created its overlay. Bounded short-lived polling only during startup.
let tries=0;const timer=setInterval(()=>{tries++;if(boot()||tries>250)clearInterval(timer)},120);
