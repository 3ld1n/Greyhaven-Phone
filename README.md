# Greyhaven Phone v1.2.0

A fictional iPhone-style phone simulator for SillyTavern roleplay.

## v1.2.0 — Behavior, identity, messaging controls and RP continuity

This release keeps the existing app set. It focuses on making conversations feel character-specific and making phone events participate in the main roleplay chronologically.

### Character identity lock
Phone generation now separates the two sides of a conversation explicitly:

- the active phone owner/persona,
- the contact who is replying.

A contact is told never to adopt the phone owner's identity, name, history, relationships or possessions. If a generated direct-message reply still appears to swap identities, Greyhaven Phone automatically retries once with a corrective identity prompt.

### Character-specific texting voice
Direct messages and Phone Refresh now ask the model to preserve the actual character's texting voice instead of defaulting to polished assistant-style prose.

The prompt can use:
- character card description/personality/example messages,
- recent messages written by that same contact,
- the current relationship and conversation mood.

Lowercase, abbreviations, slang, profanity, emojis, double-texting and short messages are allowed when they fit the character. Mature/formal characters can still naturally text more formally.

### Photo/video refusal bug fix
Explicit `TEXT:`, `PHOTO:` and `VIDEO:` protocol replies are now authoritative.

A refusal such as `TEXT: I'm not comfortable sending that` cannot also become a fake Photo card simply because the user's request mentioned a photo.

Plain-text media inference is kept only for genuinely positive send cues such as a character clearly saying they are sending/showing a photo or video.

### Balanced media willingness
Media requests are neither forced compliance nor forced refusal.

The prompt considers relationship, trust, consent, current mood, teasing level and recent conversation. Close romantic/intimate or mutually flirty dynamics may comply more naturally when it fits, while low-trust or mismatched requests can still be refused.

### Long-press message controls
Long-press a message bubble to open message actions.

For messages sent by the currently active persona:
- Edit
- Unsend for everyone
- Delete from this phone

For messages sent by another character:
- Delete from this phone

To edit/unsend the other character's message, switch to that character's persona first.

Edits and unsends use the shared mirrored-message ID so the change is synchronized across the corresponding persona phone copies.

### Better Messages navigation
The back arrow now behaves like an app navigation stack:

- Conversation -> Messages list
- Messages list -> Home

The same pattern is used for other nested screens such as Contacts and Social instead of immediately throwing the user back to the Home Screen.

### Phone <-> main roleplay continuity
Greyhaven Phone now keeps a small structured continuity ledger for important phone events.

The main SillyTavern generation prompt can receive:

#### Fresh phone events
Phone events that happened after the latest rendered main-RP character output.

Example:
1. Main RP last shows Aurora in bed.
2. On the phone, Aurora tells Jack she is getting into the bath and later says she is bathing.
3. The next main-RP generation receives that newer phone state and should treat Aurora as already being in the bath rather than replaying the older bed state.

#### Older plans / commitments
Concrete unresolved-looking plans can remain useful after the immediate phone state becomes historical.

Examples:
- "pick me up at 8"
- dinner plans
- "I'll call after work"
- an agreed meeting place

#### Older phone history
Older phone facts can remain historical context but are explicitly not treated as the character's current physical state.

### Chronology guard
Newer main roleplay always wins over older phone state.

So if:
1. Aurora says on the phone that she is in the bath,
2. a later main-RP message has her leave the bathroom and go to bed,

then the old bath message is historical. Future generations must not pull her back into the bathtub simply because it is still the latest message inside that phone thread.

The continuity system uses both RP timestamps and an RP-render checkpoint so stale transient states such as bathing, driving, sleeping or being at work do not remain permanently current.

Private phone information is also marked as participant-only context rather than knowledge every character automatically shares.

### Shared continuity API
Greyhaven Phone exposes structured continuity for Greyhaven Life or future extensions without requiring another AI analysis pass:

- `GreyhavenPhone.getContinuitySnapshot()`
- `GreyhavenPhone.getPromptSummary()`

This lets future world-state features reuse the same phone continuity instead of spending tokens to analyze it again.

## v1.1.x features retained

- Remove and restore contacts
- Delete whole conversations
- Photo/video send and request flows
- Local photo/video previews stored in IndexedDB
- Correct local media aspect ratios
- Attach/replace a local preview on fictional received media
- Cross-persona direct-message/call mirroring
- Thread-aware Phone Refresh
- Strict per-contact location evidence / anti-teleport rules
- Fake iPhone Home Indicator only on Lock/Home screens
- Greyhaven Life clock/world/schedule integration when available

## Existing apps

Messages, Phone, Contacts, Social, Snap Map, Calendar, Photos, Notes, Mail, Settings.

No new apps are introduced in v1.2.0.

## Architecture

- Phone history is isolated per SillyTavern chat.
- Each persona has a separate phone inside that chat.
- Direct messages/calls can mirror between persona-owned phones in the same timeline.
- Wallpaper/apps/settings are global per persona.
- Phone Refresh remains a bounded optional AI pass.
- Important phone continuity is stored structurally rather than requiring a second analysis call.

## Installation

Repository root:

```text
manifest.json
index.js
style.css
README.md
```

Minimum SillyTavern version: 1.13.3.

## Suggested v1.2.0 tests

1. Ask a low-trust contact for a photo and verify a refusal stays text-only.
2. Text Bianca/another character from Jack and verify the contact never starts claiming they are Jack.
3. Compare Chloe/Aurora/Jack texting styles and verify they do not all sound like the same formal assistant.
4. Long-press your own message, edit it, then switch persona and confirm the mirrored phone copy changed too.
5. Long-press your own message and test `Unsend for everyone`.
6. Open a conversation, press Back and confirm it returns to the Messages list; press Back again to return Home.
7. Main RP: leave Aurora in bed. Phone: have her explicitly move to the bath. Return to RP and verify the next generation knows the newer phone state.
8. Then move Aurora from the bath to bed in main RP. Generate again and confirm the older phone bath state does not override the newer RP.
9. Make a concrete phone plan such as meeting someone at 20:00. Generate later RP and verify the unresolved plan can still be remembered.
