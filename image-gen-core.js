export const GHIMG_MODELS = Object.freeze({
  'seedream-v5-lite-uncensored': { label: 'Seedream v5 Lite Uncensored · $0.035/image', owner: 'ByteDance', resolution: '2k', maxReferences: 14 },
  'seedream-v5-pro-uncensored': { label: 'Seedream v5 Pro Uncensored · $0.045/image', owner: 'ByteDance', resolution: '2k', maxReferences: 10 },
  'seedream-v4-5-uncensored': { label: 'Seedream v4.5 Uncensored · $0.040/image', owner: 'ByteDance', resolution: '2k', maxReferences: 14 },
});

export const DEFAULT_IMAGE_MODEL = 'seedream-v5-lite-uncensored';
export const MAX_WIRO_REFERENCES = 14;
export const DEFAULT_REFS_PER_SUBJECT = 3;

export function cleanText(value='') {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function lower(value='') {
  return cleanText(value).toLocaleLowerCase();
}

function escapeRegExp(value='') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactNameRegex(name='') {
  const escaped = escapeRegExp(cleanText(name));
  if (!escaped) return null;
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
}

export function resolveImageSubjects({ description='', sender=null, identities=[] }={}) {
  const text = String(description ?? '');
  const uniqueByName = new Map();
  const uniqueIds = new Set();
  const add = identity => {
    if (!identity?.id) return;
    const nameKey = lower(identity.name);
    if (uniqueIds.has(identity.id) || (nameKey && uniqueByName.has(nameKey))) return;
    uniqueIds.add(identity.id);
    if (nameKey) uniqueByName.set(nameKey, identity);
  };

  // Canonicalize the sender against the supplied identity directory. Greyhaven
  // character names are unique, so this also protects older chats that may have
  // a duplicate/legacy phone identity for the same person.
  const senderIdentity = sender?.id
    ? identities.find(x => x?.id === sender.id)
      || identities.find(x => lower(x?.name) === lower(sender?.name))
      || sender
    : identities.find(x => lower(x?.name) === lower(sender?.name));

  // First-person wording always belongs to the sender of the media packet.
  if (senderIdentity && /\b(?:i|me|my|mine|myself)\b/iu.test(text)) add(senderIdentity);

  // Exact known names only. No fuzzy guessing, partial-name matching or
  // group-membership inference. Longer names are tested first.
  const sorted = [...identities]
    .filter(x => x?.id && cleanText(x?.name))
    .sort((a,b) => cleanText(b.name).length - cleanText(a.name).length);

  for (const identity of sorted) {
    const rx = exactNameRegex(identity.name);
    if (rx?.test(text)) add(identity);
  }

  return [...uniqueByName.values()];
}

export function describeWardrobeForImage({ identity, outfit, catalog }={}) {
  const name = cleanText(identity?.name || 'Person');
  if (!outfit || outfit.mode === 'unknown') return '';
  if (outfit.mode === 'naked') return `${name} is naked.`;
  if (outfit.mode !== 'set') return '';

  const worn = [];
  const categories = catalog && typeof catalog === 'object' ? catalog : {};
  const items = outfit.items && typeof outfit.items === 'object' ? outfit.items : {};

  for (const [categoryId, rows] of Object.entries(items)) {
    const category = categories[categoryId];
    for (const row of Array.isArray(rows) ? rows : []) {
      const itemId = cleanText(row?.id || row);
      if (!itemId) continue;
      const item = category?.items?.find(x => x?.id === itemId);
      const label = cleanText(item?.label || itemId.replaceAll('_',' '));
      const color = cleanText(row?.color);
      worn.push(color ? `${color} ${label}` : label);
    }
  }

  if (outfit.coverage !== 'partial') {
    if (!worn.length) return `${name} is naked.`;
    return `${name} is ONLY wearing: ${worn.join('; ')}. Nothing else is being worn.`;
  }

  const knownAbsent = (Array.isArray(outfit.knownAbsent) ? outfit.knownAbsent : [])
    .map(id => cleanText(categories[id]?.label || id.replaceAll('_',' ')))
    .filter(Boolean);

  const pieces = [];
  if (worn.length) pieces.push(`${name} is currently known to be wearing: ${worn.join('; ')}.`);
  if (knownAbsent.length) pieces.push(`${name} is explicitly not wearing: ${knownAbsent.join(', ')}.`);
  return pieces.join(' ');
}

export function selectReferenceAssignments({ subjects=[], packs={}, maxTotal=MAX_WIRO_REFERENCES, maxPerSubject=DEFAULT_REFS_PER_SUBJECT }={}) {
  const prepared = subjects.map(subject => {
    const rows = Array.isArray(packs?.[subject.id]) ? packs[subject.id] : [];
    const ordered = [...rows].sort((a,b) => Number(b?.primary === true) - Number(a?.primary === true) || Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
    return { subject, rows: ordered, selected: [] };
  });

  const seen = new Set();
  const assignments = [];
  let round = 0;
  while (assignments.length < maxTotal) {
    let added = false;
    for (const bucket of prepared) {
      if (bucket.selected.length >= maxPerSubject) continue;
      const row = bucket.rows[round];
      if (!row) continue;
      const fingerprint = cleanText(row.hash || row.dbKey || row.id);
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      bucket.selected.push(row);
      assignments.push({ subject: bucket.subject, reference: row });
      added = true;
      if (assignments.length >= maxTotal) break;
    }
    if (!added && prepared.every(bucket => !bucket.rows[round + 1])) break;
    round++;
    if (round > 20) break;
  }
  return assignments;
}

export function buildImagePrompt({ description='', subjects=[], referenceAssignments=[], wardrobeLines=[], app='messages', scope='message', continuity='' }={}) {
  const scene = cleanText(description);
  const context = cleanText(continuity);
  const socialPhonePhoto = ['snapchat','messages','instagram','facebook'].includes(app)
    && ['message','dm','story','post'].includes(scope);
  const appStyle = app === 'snapchat'
    ? 'Make it feel like a spontaneous Snapchat phone photo, casual and immediate.'
    : app === 'messages'
      ? 'Make it feel like a believable private phone photo genuinely taken and sent in chat.'
      : app === 'instagram'
        ? 'Make it feel like a believable Instagram photo: intentional enough to post, still natural.'
        : app === 'facebook'
          ? 'Make it feel like an everyday Facebook photo, natural rather than staged.'
          : app === 'onlyfans'
            ? 'Make it feel like an authentic creator photo from a phone or ordinary camera unless the scene explicitly describes a professional shoot.'
            : 'Use coherent real-world photography that matches the scene.';

  const lines = ['Create exactly one photorealistic image.'];
  if (scene) lines.push(`SCENE — follow this literally:\n${scene}`);
  if (context) lines.push(`CONTINUITY — use only to fill scene details that are not specified above:\n${context}`);

  if (referenceAssignments.length) {
    const grouped = new Map();
    referenceAssignments.forEach((assignment,index) => {
      const list = grouped.get(assignment.subject.id) || { subject: assignment.subject, refs: [] };
      list.refs.push(`[Image ${index + 1}]`);
      grouped.set(assignment.subject.id, list);
    });
    lines.push('IDENTITY REFERENCES:');
    for (const {subject,refs} of grouped.values()) {
      lines.push(`${cleanText(subject.name)} = ${refs.join(', ')}. Preserve this person’s face, hair, apparent age, build and stable distinguishing features. Use the references for identity only; use the current scene and wardrobe for pose, clothing, jewelry, background, lighting and camera.`);
    }
  }

  const wardrobe = wardrobeLines.filter(Boolean);
  if (wardrobe.length) {
    lines.push(`WARDROBE — authoritative:\n${wardrobe.join('\n')}\nThis overrides clothing visible in references. If it says ONLY wearing or naked, add no other garments.`);
  }

  lines.push(appStyle);
  lines.push(socialPhonePhoto
    ? 'Use normal smartphone optics and exposure, natural depth, realistic skin pores and fine facial detail, subtle asymmetry and ordinary imperfections; no beauty-filter or glossy CGI look.'
    : 'Use believable optics, natural skin/material texture and physically coherent lighting; keep retouching subtle and avoid glossy CGI skin.');
  lines.push('Keep jewelry and piercings realistic and small: nose jewelry tiny, navel jewelry small, earrings proportionate, necklace chains fine and pendants modest. Character names are identity labels, not visible necklace/tattoo/logo text unless the scene explicitly asks for that text.');
  lines.push('Keep hands, fingers, eyes, teeth, limbs, fabric contact, reflections, shadows and perspective physically coherent. Keep the stated location/background consistent and add no unrelated people or objects. No random text, watermark or signature.');
  return lines.join('\n\n');
}
