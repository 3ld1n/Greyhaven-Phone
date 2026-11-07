/* Greyhaven Circle — pure, testable identity, discovery and matching helpers.
 * No DOM, no network, no access to other characters' private data.
 */
export const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
export const nameKey = value => clean(value).toLocaleLowerCase('en-US').normalize('NFKC');
export const validAge = n => Number.isInteger(Number(n)) && Number(n) >= 18 && Number(n) <= 85;
export const ageInRange = (age,min,max) => Number(age) >= Number(min) && Number(age) <= Number(max);
export const uniqueStrings = values => [...new Set((values || []).map(clean).filter(Boolean))];
export function looseJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  let raw = String(value ?? '').trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'');
  const first = raw.indexOf('{'), last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) raw = raw.slice(first,last+1);
  return JSON.parse(raw);
}
export const within = (n,low,high,fallback=low) => Number.isFinite(Number(n)) ? Math.max(low,Math.min(high,Number(n))) : fallback;
export function makePublicCard(row, makeId) {
  if (!row || typeof row !== 'object') return null;
  const firstName = clean(row.name || row.firstName).replace(/[\r\n|<>]/g,'').split(' ')[0].slice(0,32);
  const age = Number(row.age);
  if (!/^[\p{L}][\p{L}\p{M}'’\-]*$/u.test(firstName) || !validAge(age)) return null;
  return {
    id: makeId(), name:firstName, age,
    gender:clean(row.gender).slice(0,35), orientation:clean(row.orientation).slice(0,45),
    occupation:clean(row.occupation || row.job).slice(0,90),
    location:clean(row.location || 'Greyhaven').slice(0,80),
    bio:clean(row.bio).slice(0,260),
    personality:clean(row.personality).slice(0,170),
    interests:uniqueStrings(Array.isArray(row.interests)?row.interests:clean(row.interests).split(',')).slice(0,8),
    lookingFor:clean(row.lookingFor).slice(0,110),
    mode:row.mode === 'dating' ? 'dating' : 'meet',
    createdAt:Date.now(),
  };
}
export function validatedBatch(rows,reserved,makeId,mode='meet') {
  const accepted=[],used=new Set([...reserved].map(nameKey));
  for (const raw of Array.isArray(rows)?rows:[]) {
    const card=makePublicCard({...raw,mode},makeId);
    if (!card) continue;
    const key=nameKey(card.name);
    if (!key || used.has(key)) continue;
    used.add(key);accepted.push(card);
    if (accepted.length===10) break;
  }
  return accepted;
}
export function normalProfile(raw={},who={}) {
  const age=within(raw.age,18,85,25);
  const min=within(raw.ageMin,18,85,20),max=Math.max(min,within(raw.ageMax,18,85,45));
  return {
    identityId:String(who.id||raw.identityId||''),
    name:clean(who.name||raw.name||''),age:Math.round(age),gender:clean(raw.gender),orientation:clean(raw.orientation),
    bio:clean(raw.bio).slice(0,320),occupation:clean(raw.occupation).slice(0,95),location:clean(raw.location||'Greyhaven').slice(0,80),
    interests:uniqueStrings(Array.isArray(raw.interests)?raw.interests:String(raw.interests||'').split(',')).slice(0,16),
    socialGoal:clean(raw.socialGoal||'Friends, social activities'),datingGoal:clean(raw.datingGoal||'Open to meeting someone'),
    genderPreference:clean(raw.genderPreference||'Any'),ageMin:min,ageMax:max,
    updatedAt:Number(raw.updatedAt||0),
  };
}
/** One immutable eventual outcome per like. Never reroll on Refresh. */
export function preparePending(like, nowMs, random=Math.random, options={}) {
  const draw=typeof random==='function'?random:()=>Number(random);
  const chance=Math.max(.03,Math.min(.25,Number(options?.chance ?? .15)));
  const success=draw()<chance;
  const immediate=success && draw()<.34;
  const lagHours=2+Math.floor(draw()*46); // fictional hours; no timers
  return {...like,status:immediate?'matched':'pending',willMatch:success,
    resolvedOnce:true,attempts:0,likedAt:nowMs,matchChance:chance,
    resolveAt:immediate?nowMs:nowMs+lagHours*3600000,
    lastCheckedAt:null,matchedAt:immediate?nowMs:null};
}
/** For v1 data, establish the outcome ONCE, including already-pending likes. */
export function migratePending(pending, nowMs, random=Math.random){
  for(const p of pending||[]){
    if(p.status!=='pending'||typeof p.willMatch==='boolean')continue;
    p.willMatch=random()<.15;
    p.resolvedOnce=true;
    const base=Number(p.likedAt||nowMs);
    p.resolveAt=Math.max(base+2*3600000,Number(nowMs||base));
    p.matchChance=.15;
  }
  return pending;
}
/** Refresh reveals a predecided outcome only once the fictional time is eligible. */
export function refreshPending(pending, nowMs, random=Math.random) {
  const events=[];
  migratePending(pending,nowMs,random);
  for(const p of pending||[]){
    if(p.status!=='pending')continue;
    p.lastCheckedAt=nowMs;
    p.attempts=Number(p.attempts||0)+1;
    if(Number(nowMs)<Number(p.resolveAt||0))continue;
    p.status=p.willMatch===true?'matched':'no-match';
    if(p.status==='matched')p.matchedAt=nowMs;
    events.push({id:p.npcId,status:p.status});
  }
  return events;
}
/** A blocked/unmatched participant never becomes a match through a refresh. */
export function closeConnection(pending,id,status='unmatched'){
  const row=(pending||[]).find(x=>x.npcId===id);
  if(!row)return null;
  row.status=status==='blocked'?'blocked':'unmatched';
  row.willMatch=false;return row;
}
export function chatKey(ctx) {
  const raw=String(ctx?.getCurrentChatId?.()||ctx?.chatId||'');
  return raw && (ctx?.groupId ? `g:${ctx.groupId}:${raw}` : `c:${ctx.characterId??'unknown'}:${raw}`);
}
