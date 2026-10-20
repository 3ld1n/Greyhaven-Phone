// Shared private history for a SINGLE pair of participants within one RP chat.
// Unlike the group continuity prompt, this does not reveal conversations with third parties.
const SOCIAL_APPS = Object.freeze(['instagram','snapchat','facebook','onlyfans','darkweb']);

export function collectPairMemory(timeline, ownerId, peerId, { maxEntries=36, maxChars=5000, excludeApp='' }={}) {
  if (!timeline || !ownerId || !peerId || ownerId === peerId || timeline.identityId !== ownerId) return [];
  const entries = [];
  const seen = new Set();
  const include = (app, message) => {
    if (!message || (!message.text && !message.mediaDescription)) return;
    // The same mirror exists on both participants' phones; only read one owner phone.
    const key = `${app}:${message.mirrorId || message.id || entries.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    const text = String(message.text || '').trim();
    const visual = String(message.mediaDescription || '').trim();
    entries.push({app, speaker:String(message.sender || 'Unknown'),
      timeMs:Number(message.timeMs || 0),realMs:Number(message.realMs || 0),
      text:message.type && message.type !== 'text' ? `[${message.type}: ${visual}]${text ? ` ${text}` : ''}` : text});
  };
  if (excludeApp !== 'messages') {
    for (const th of Object.values(timeline.threads || {})) {
      if (th?.type !== 'direct' || th.contactIds?.length !== 1) continue;
      const contact = timeline.contacts?.[th.contactIds[0]];
      if (contact?.identityId !== peerId) continue;
      for (const m of th.messages || []) include('iMessage',m);
    }
  }
  for (const app of SOCIAL_APPS) {
    if (app === excludeApp) continue;
    for (const thread of Object.values(timeline[app]?.threads || {})) {
      if (thread?.identityId !== peerId) continue;
      for (const m of thread.messages || []) include(app,m);
    }
  }
  entries.sort((a,b)=>a.timeMs-b.timeMs || a.realMs-b.realMs);
  const recent = entries.slice(-Math.max(1,maxEntries));
  const output = [];
  let chars = 0;
  for (let i=recent.length-1;i>=0;i--) {
    const e=recent[i],rendered=`[${e.app} ${Number.isFinite(e.timeMs) && e.timeMs > 0 ? new Date(e.timeMs).toISOString() : 'unknown time'}] ${e.speaker}: ${e.text}`;
    if (chars + rendered.length > maxChars && output.length) break;
    output.unshift(rendered.slice(0,Math.max(80,maxChars-chars)));
    chars += rendered.length;
  }
  return output;
}
