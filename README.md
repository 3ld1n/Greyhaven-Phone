# Greyhaven Phone v1.2.1

Focused behavior hotfix for Greyhaven Phone v1.2.x.

## What changed

### 1. Media promises now have to become real media
Characters can still refuse a photo/video request when it makes sense.

But when a character has already agreed, offered, promised, taken, or claimed to send a requested photo/video, Greyhaven Phone now treats that as a pending media commitment.

If the user prompts them again:
- the character can genuinely change their mind and say so,
- or they should follow through with an actual `PHOTO:` / `VIDEO:` attachment,
- they should not endlessly repeat "okay I'll send it" without ever attaching anything.

An extra repair pass is used only when the model produces an ambiguous "I sent it / I'll send it" style response without the required media payload.

### 2. Same-line media protocol parsing
Replies like:

`TEXT: okay fine 😏 PHOTO: a selfie in a yellow dress`

are now parsed correctly even when the model puts both protocol items on one line.

### 3. No more fake photo cards made from promises/refusals
A line such as:

`omg okay fine, I'll send u a pic`

remains a text message unless the model actually supplies a photo description.

Refusals remain text-only.

Plain-text fallback media detection now requires wording that clearly indicates an attachment was delivered now, such as "here's..." or "just sent...".

### 4. Stronger social boundaries
Characters no longer have to keep a friendly conversation going forever.

The model can now react in-character to disrespect, harassment, creepy behavior, hostility, or repeatedly ignored boundaries.

Depending on the actual character and relationship, they may:
- become angry,
- swear,
- mock or insult back,
- become cold,
- give a warning,
- leave the owner on read,
- eventually block the owner.

Normal flirting, consensual teasing, disagreement, or one awkward message should not automatically trigger blocking.

### 5. Leave-on-read state
The model can return `ACTION: IGNORE`.

When that happens:
- no reply bubble is added,
- no typing indicator is shown,
- the character remains in an "ignoring" state,
- a later message can still cause them to keep ignoring, block, or re-engage if the situation changes.

### 6. Character-initiated blocking
The model can return `ACTION: BLOCK`.

When that happens:
- the contact becomes unavailable on the sender's phone,
- new messages are not delivered,
- calls do not connect,
- the blocking character's own mirrored phone records that they blocked the sender,
- switching to the blocking character's persona and manually unblocking the sender will synchronize the relationship back.

A final warning text can still be delivered immediately before the block if the model chooses.

### 7. Failed delivery UI
Messages sent after a character has blocked the current persona show a small `Not Delivered` state.

### 8. Phone ↔ RP chronology retained
The v1.2.0 continuity system is unchanged:
- newer phone state can advance the main RP,
- newer main-RP state overrides older phone state,
- unresolved plans can remain relevant,
- stale transient states do not drag characters backward in time.

## No new apps
v1.2.1 does not add any new phone apps. It only improves the existing messaging behavior.

## Recommended tests

1. Ask a character for a photo. Let them agree, then prompt them again. They should either actually attach it or clearly change their mind instead of stalling indefinitely.
2. Test a refusal. It should stay text-only.
3. Test a model response that contains `TEXT:` and `PHOTO:` on the same line.
4. Be rude to a low-trust contact. They should be allowed to react sharply rather than politely continuing forever.
5. Keep crossing a clearly stated boundary. The character should be able to leave you on read.
6. Continue pushing aggressively after that. Depending on the character, they may block you.
7. Switch to the blocking character's persona and manually unblock the other person; the mirrored phone state should synchronize.
