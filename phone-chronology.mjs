// Greyhaven Phone 2.13: read-only, historical, owner-scoped chronological index.
// No migration or destructive rewrite: reads the currently stored timeline in any old chat.
const social=['instagram','snapchat','facebook','onlyfans','darkweb'];
const low=x=>String(x||'').trim().toLocaleLowerCase();
export function identifyReplySpeaker(context) {
  if(!context)return null;
  const characters=context.characters||[];
  const selected=context.characterId===null||context.characterId===undefined?null:characters[Number(context.characterId)];
  const chosen=String(context.name2||'').trim();
  if(context.groupId){
    const group=(context.groups||[]).find(g=>String(g.id)===String(context.groupId));
    const members=new Set((group?.members||[]).map(m=>typeof m==='string'?m:m?.avatar));
    // A generic group name, last user speaker, or selected persona isn't proof.
    // Require an exact identity of a group member in the CURRENT generation context.
    const matches=characters.filter(ch=>members.has(ch.avatar)&&low(ch.name)===low(chosen));
    if(chosen&&!['group','group chat'].includes(low(chosen))&&!matches.length)return null;
    if(selected && members.has(selected.avatar)){
      // Active characterId is SillyTavern's current generator target.
      // If name2 explicitly names a DIFFERENT valid member, fail closed.
      if(matches.length===1 && selected.avatar!==matches[0].avatar)return null;
      return selected.name;
    }
    return matches.length===1?matches[0].name:null;
  }
  return selected?.name || null;
}
export function ownedPhone(root,identityId,ownerName=''){
  if(!root?.phones||!identityId)return null;
  const canonical=root.phones[`identity:${identityId}`]||root.phones[`phone:${identityId}`];
  if(canonical?.identityId===identityId)return canonical;
  return Object.values(root.phones).find(t=>t?.identityId===identityId)||null;
}
export function collectOwnedChronology(phone,{ownerId,ownerName,maxEntries=105,maxChars=10700,nowMs=Infinity,sequenceByMirror={}}={}){
  if(!phone || (ownerId&&phone.identityId&&phone.identityId!==ownerId))return [];
  const rows=[],seen=new Set();let sequence=0;
  function add(app,th,m,peer){
    if(!m || (!m.text&&!m.mediaDescription))return;
    const timeMs=Number(m.timeMs||0),realMs=Number(m.realMs||0);
    if(timeMs&&timeMs>nowMs+60000)return; // No future phone knowledge.
    const key=app+':'+String(m.mirrorId||m.id||`${timeMs}:${m.sender}:${m.text}`);
    if(seen.has(key))return;seen.add(key);
    const kind=m.type&&m.type!=='text'?`[${m.type}: ${String(m.mediaDescription||'').slice(0,460)}] `:'';
    rows.push({app,who:String(m.sender||''),peer:String(peer||''),timeMs,realMs,order:sequence++,eventSeq:Number(sequenceByMirror[m.mirrorId]||0),text:(kind+String(m.text||'')).trim().slice(0,950)});
  }
  for(const th of Object.values(phone.threads||{})){
    const names=(th.contactIds||[]).map(x=>phone.contacts?.[x]?.name).filter(Boolean);
    for(const m of th.messages||[])add('iMessage',th,m,names.join(', '));
  }
  for(const app of social)for(const th of Object.values(phone[app]?.threads||{})){
    const peer=th.peerName||th.name||phone.contacts?.[th.contactId]?.name||'';
    for(const m of th.messages||[])add(app,th,m,peer);
  }
  // Non-message items are part of the person's real phone, too.
  function addActivity(app,when,text,source=''){
    if(!String(text||'').trim())return;
    const timeMs=Number(when||0);if(timeMs&&timeMs>nowMs+60000)return;
    const key=`activity:${app}:${timeMs}:${source}:${text}`;if(seen.has(key))return;seen.add(key);
    rows.push({app,who:String(source||ownerName||''),peer:'',timeMs,realMs:0,order:sequence++,eventSeq:0,text:String(text).slice(0,550)});
  }
  for(const call of phone.calls||[])addActivity('Phone',call.timeMs,`Call with ${call.contactName||'contact'} (${call.direction||''}; ${call.status||''})`,ownerName);
  for(const app of ['instagram','snapchat','facebook']){
    const store=phone[app]||{};
    for(const post of store.posts||[])addActivity(app,post.timeMs,`Post: ${post.visual||post.text||''} ${post.caption||''}`,post.author);
    for(const story of store.stories||[])addActivity(app,story.timeMs,`Story: ${story.visual||story.mediaDescription||''} ${story.caption||''}`,story.author);
  }
  rows.sort((a,b)=>a.timeMs-b.timeMs|| (a.eventSeq&&b.eventSeq?a.eventSeq-b.eventSeq:0) ||a.realMs-b.realMs||a.order-b.order);
  const recent=rows.slice(-Math.max(1,maxEntries)),out=[];let chars=0;
  for(let i=recent.length-1;i>=0;i--){
    const x=recent[i],when=x.timeMs?new Date(x.timeMs).toISOString().slice(0,16).replace('T',' '):'unknown';
    const line=`[${when} ${x.app}${x.peer?' · '+x.peer:''}] ${x.who}: ${x.text}`;
    if(chars+line.length>maxChars&&out.length)break;
    out.unshift(line);chars+=line.length;
  }
  return out;
}
export function scopeContinuityEvents(events=[],speaker='',limit=24){
  if(!speaker)return [];
  return events.filter(e=>(e.participants||[]).some(p=>low(p)===low(speaker))).slice(-limit);
}
