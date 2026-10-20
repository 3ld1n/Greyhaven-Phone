// Phone-only reply hygiene; never apply these rules to the main RP transcript.
export function tidyPhoneText(input = '') {
  let value = String(input ?? '').replace(/\r\n?/g, '\n').trim();
  // Remove entire standalone stage-direction lines, including prose in asterisks.
  value = value.replace(/^\s*(?:\*[^*\n]{2,180}\*|\([^()\n]{3,150}\))\s*$/gm, match => {
    const inner = match.trim().replace(/^[*(]|[*)]$/g, '').trim();
    return /^(?:(?:i|she|he|they|we)\s+(?:do|write|check|think|breathe|pull|move|nod|giggle|wink|glance|tilt|type|tap|look|smile|laugh|stare|send|pick|turn|wait|scroll|read|grab|open|put|sit|stand|walk|lean|blink|pause)\b|(?:typing|sending|laughing|smiling|looks|grins|sighs|shrugs|pauses)\b)/i.test(inner) ? '' : match;
  });
  // Also remove typical inline narration, but preserve *emphasis* such as *me*.
  value = value.replace(/\*([^*\n]{3,180})\*/g, (full, inner) =>
    /^(?:(?:i|she|he|they|we)\s+(?:do|write|check|think|breathe|pull|move|nod|giggle|wink|glance|tilt|type|tap|look|smile|laugh|stare|send|pick|turn|wait|scroll|read|grab|open|put|sit|stand|walk|lean|blink|pause)\b|(?:typing|sending|laughing|smiling|looks|grins|sighs|shrugs|pauses)\b)/i.test(inner.trim()) ? '' : full);
  // Line-per-word or line-per-phrase completions are not separate speech acts.
  value = value.replace(/\*([^*\n]{1,60})\*/g, '$1').replace(/\n+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  return value;
}

export function limitPhonePackets(items = [], maxTexts = 2) {
  const out = [];
  const textRows = items.filter(entry => entry?.type === 'text' && tidyPhoneText(entry.text));
  // A model that emits 3–4 fragments has not intentionally written 3–4 bubbles.
  // Join that single thought into one SMS instead of flooding the conversation.
  if (textRows.length > 2 || (textRows.length === 2 && tidyPhoneText(textRows[0].text).length > 120)) maxTexts = 1;
  let texts = 0;
  let media = 0;
  for (const entry of items) {
    if (entry?.type === 'text') {
      const text = tidyPhoneText(entry.text);
      if (!text) continue;
      if (texts >= maxTexts) {
        const last = [...out].reverse().find(x => x.type === 'text');
        if (last) last.text += ` ${text}`;
        continue;
      }
      texts++;
      out.push({ ...entry, text });
    } else if (['photo','video'].includes(entry?.type) && media++ === 0) {
      out.push(entry);
    }
  }
  return out;
}
