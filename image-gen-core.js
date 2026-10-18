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

// Seedream 4.5 does better with one coherent photographed moment than with long
// keyword stacks. Never mention an accessory that the scene/wardrobe did not.
export function buildImagePrompt({ description='', subjects=[], referenceAssignments=[], wardrobeLines=[], app='messages', scope='message', continuity='' }={}) {
  const scene = cleanText(description);
  const context = cleanText(continuity);
  const wardrobe = wardrobeLines.filter(Boolean);
  const text = `${scene} ${wardrobe.join(' ')}`;
  const socialPhoto = ['snapchat','messages','instagram','facebook','onlyfans'].includes(app);
  const professional = /(?:professional (?:camera|photo|portrait|shoot)|studio (?:camera|photograph|shoot)|dslr|mirrorless camera)/i.test(scene);
  const filter = /(?:snapchat|face|beauty|cat ears|dog ears|AR)\s+(?:filter|lens)|(?:filter|lens)\s+(?:on|with|showing)|filtered selfie/i.test(scene);
  const mirror = /mirror selfie|selfie in (?:a|the) mirror/i.test(scene);
  const front = /front[- ]facing|front camera|handheld selfie|selfie camera|selfie/i.test(scene);
  const rear = /rear camera|back camera|taken by (?:a friend|someone)|third[- ]person (?:phone|photo)/i.test(scene);
  const camera = professional
    ? 'Use the specifically requested professional camera and lighting, without exaggerated retouching.'
    : mirror ? 'Use an authentic handheld phone mirror selfie, with coherent mirror reflections and ordinary phone exposure.'
    : front ? `Use a believable front-facing smartphone selfie with slight natural phone-lens perspective and handheld composition.${filter?' Apply only the specific camera filter described in the metadata; otherwise keep the image unfiltered.':' Keep it unfiltered unless a filter is explicitly described.'}`
    : rear ? 'Use an authentic rear-camera phone snapshot taken by another person, with realistic framing and ordinary automatic exposure.'
    : socialPhoto ? 'Unless specified otherwise, frame it like a casual unedited smartphone photo taken for this app, not an editorial shoot.'
    : 'Use a plausible real camera angle and physically coherent lighting.';

  const lines = [
    'Create one genuine-looking photograph of the described person and moment. The person, pose, expression and framing are the priority; the setting is only quiet visual context.',
  ];
  if (scene) lines.push(`SCENE (follow the photographed action and camera type):\n${scene}`);
  if (context) lines.push(`LOCATION/TIME CONTINUITY (use only where not contradicted by the scene; do not invent scenery):\n${context}`);
  if (referenceAssignments.length) {
    const grouped = new Map();
    referenceAssignments.forEach((assignment,index) => {
      const list = grouped.get(assignment.subject.id) || { subject: assignment.subject, refs: [] };
      list.refs.push(`[Image ${index + 1}]`);
      grouped.set(assignment.subject.id,list);
    });
    lines.push('IDENTITY REFERENCES:');
    for (const {subject,refs} of grouped.values()) {
      lines.push(`${cleanText(subject.name)} = ${refs.join(', ')}. Maintain this person’s real facial proportions, hair, skin tone, apparent age and overall build. References establish identity, not the current outfit, scene, pose or camera.`);
    }
  }
  if (wardrobe.length) lines.push(`CURRENT WARDROBE (authoritative if explicitly known):\n${wardrobe.join('\n')}\nDo not copy clothing from reference photos over the current scene wardrobe.`);
  lines.push(camera);
  lines.push('Prioritize believable human photography: natural skin tone and modest skin texture, small real imperfections, facial asymmetry, naturally directed eyes, fine hair detail, consistent shadows, plausible depth of field and realistic fabric. Avoid plastic skin, excessive smoothing, fashion retouching, synthetic glow, HDR and artificial cinematic lighting unless the camera metadata specifically asks for it.');
  // Deliberately do NOT list possible jewelry (nose rings, belly piercings etc.)
  // in every prompt: Seedream can hallucinate those merely from the reminder.
  const accessoryRegex = /\b(?:nose (?:ring|stud|piercing)|navel (?:ring|piercing)|belly (?:ring|piercing)|earrings?|necklaces?|pendants?|bracelets?|rings?|watches?|piercings?)\b/gi;
  const explicitAccessories = [...new Set([...text.matchAll(accessoryRegex)]
    .filter(match => !/(?:\b(?:no|without|remove|removed|absent|not wearing|isn't wearing|not wearing:)\s*(?:any\s+)?[\w,; ]{0,25})$/i.test(text.slice(Math.max(0,match.index-50),match.index)))
    .map(match=>match[0].toLowerCase()))];
  if (explicitAccessories.length) lines.push(`Only if actually described: render the specified ${explicitAccessories.join(', ')} at normal real-world scale, never oversized or duplicated. Do not introduce extra accessories.`);
  lines.push('Keep attention on the subject; the background should be understated and consistent only with the named location, without elaborate invented scenery. Names identify characters; they are not instructions to print text. Natural hands, anatomy, perspective and reflections; no invented people, labels, watermarks or logos.');
  return lines.join('\n\n');
}
