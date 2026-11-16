export const GHIMG_MODELS = Object.freeze({
  'seedream-v5-lite-uncensored': { label: 'Seedream v5 Lite Uncensored · $0.035/image', owner: 'ByteDance', resolution: '2k', maxReferences: 14 },
  'seedream-v5-pro-uncensored': { label: 'Seedream v5 Pro Uncensored · $0.045/image', owner: 'ByteDance', resolution: '2k', maxReferences: 10 },
  'seedream-v4-5-uncensored': { label: 'Seedream v4.5 Uncensored · $0.040/image', owner: 'ByteDance', resolution: '2k', maxReferences: 14 },
  'seedream-5-5-uncensored-advanced': { label: 'Seedream 5.5 Uncensored Advanced', owner: 'ByteDance', resolution: '2k', maxReferences: 10 },
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

  // Use one canonical character, even for legacy/duplicated phone identities.
  const senderIdentity = sender?.id
    ? identities.find(x => x?.id === sender.id)
      || identities.find(x => lower(x?.name) === lower(sender?.name))
      || sender
    : identities.find(x => lower(x?.name) === lower(sender?.name));

  // 'I / me / my' in an attachment refers to the person sending it.
  if (senderIdentity && /\b(?:i|me|my|mine|myself)\b/iu.test(text)) add(senderIdentity);

  // Add every explicitly named character; do not infer unrelated contacts.
  const sorted = [...identities]
    .filter(x => x?.id && cleanText(x?.name))
    .sort((a,b) => cleanText(b.name).length - cleanText(a.name).length);
  for (const identity of sorted) {
    const rx = exactNameRegex(identity.name);
    if (rx?.test(text)) add(identity);
  }

  // Even without a name in the caption, a sender's photo should use their pack.
  if (!uniqueIds.size && senderIdentity) add(senderIdentity);
  return [...uniqueByName.values()];
}

// Kept for backwards compatibility with other Greyhaven modules. Wardrobe
// details are NOT added to the Wiro prompt unless they already exist in metadata.
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

// Compatibility export. Previously this contained many extra descriptions;
// those instructions are intentionally NOT used for image generation anymore.
export const DEFAULT_IMAGE_PROMPT_TEMPLATE = '{scene}';

// The metadata itself is the entire image request. Its punctuation, spacing,
// line breaks and wording remain unchanged. Append ONLY reference-image labels,
// numbered in the exact sequence sent in the "references" request field.
// Additional legacy arguments (camera, location, continuity, template, etc.)
// are intentionally ignored.
export function buildImagePrompt({ description='', referenceAssignments=[] }={}) {
  const metadata = String(description ?? '');
  const referencesByName = new Map();
  for (const [index, assignment] of referenceAssignments.entries()) {
    const name = cleanText(assignment?.subject?.name);
    if (!name) continue;
    if (!referencesByName.has(name)) referencesByName.set(name, []);
    referencesByName.get(name).push(`[Image ${index + 1}]`);
  }
  if (!referencesByName.size) return metadata;
  const mapping = [...referencesByName]
    .map(([name, refs]) => `${name} = ${refs.join(', ')}.`)
    .join('\n');
  return `${metadata}\n\n${mapping}`;
}
