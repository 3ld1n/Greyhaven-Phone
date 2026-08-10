# Greyhaven Phone v1.0.0

A fictional iPhone-style phone simulator for SillyTavern roleplay.

## Architecture

- **Phone history is isolated per SillyTavern chat.**
- **Each persona has a separate phone inside that chat.**
- Wallpaper/apps/settings are global per persona.
- Messages, calls, posts, stories, notes, mail and notifications remain timeline-specific.

Switching from Eldin to Aurora therefore opens Aurora's phone, while another SillyTavern chat gives both of them separate alternate phone histories.

## Greyhaven Life integration

When `window.GreyhavenLife` is available, Greyhaven Phone reuses:

- authoritative RP time
- scene
- Present / Off-screen
- structured place + city/area
- status and availability
- shared World Snapshot and freshness state
- current and upcoming schedules
- schedule exceptions and their end times

Phone never calls the Greyhaven Life analyzer automatically.

The optional AI Phone Refresh uses the existing Life snapshot/live state plus recent RP context in **one** batch request.

## Apps

### Messages
- Direct texting
- Group chats
- Unread badges
- Persistent threads
- AI replies as the selected character(s)
- Uses character card, persona relationship text, Greyhaven Life and recent main RP

### Phone
- Recents
- Incoming/missed calls from Refresh
- Outgoing calls
- Lightweight text-based live call mode

### Contacts
Contacts are discovered from:
1. character names explicitly present in the active persona description/relationship section
2. Greyhaven Life tracked people
3. current chat/group participants
4. manually selected SillyTavern characters

Per-contact options:
- nickname
- favorite
- mute
- block
- precise / approximate / disabled location sharing

### Social
Instagram-style fictional feed:
- AI-generated post text
- fictional photo descriptions (no actual image generation)
- captions
- likes/comments
- Stories

Content persists instead of changing every refresh.

### Snap Map
Text-first Snap Map powered primarily by Greyhaven Life.

### Calendar
Reads the active persona's Greyhaven Life current/upcoming schedules and exceptions, including exact exception end times when available.

### Photos
Collects fictional visual entries from posts and Stories.

### Notes
Local notes for the active persona in this timeline. AI does not invent secret notes automatically.

### Mail
Disabled by default. Refresh may create relevant fictional mail only when enabled and context supports it.

### Settings
- wallpaper presets
- optional custom wallpaper URL
- Lock Screen
- notification previews
- installed apps
- manual/stale-on-open AI refresh
- stale threshold
- max events per refresh
- quiet/normal/busy background activity
- reset current phone timeline

## UI

Modern iPhone-inspired UI:
- Dynamic Island
- Lock Screen
- fictional Greyhaven Life clock
- notification cards
- app grid
- translucent dock
- app badges
- edge-to-edge layout on iPhone
- framed device presentation on desktop

No Apple image assets are bundled.

## AI Refresh

Manual by default.

One request can generate zero or more new:
- messages
- calls
- Social posts
- Stories
- social/Snap notifications
- Mail

The model sees:
- allowed relevant contacts only
- Greyhaven Life World Snapshot + live world state
- recent main RP
- existing thread list
- compact recent phone history

It is instructed not to repeat events, and the extension also keeps a rolling duplicate-key cache.

Reading apps or old phone content costs no tokens.

AI is used only for:
- Phone Refresh
- direct fictional text replies
- fictional call replies

## Installation

Repository root:

```text
manifest.json
index.js
style.css
README.md
```

Minimum SillyTavern version: 1.13.3.

## Suggested first test

1. Keep Greyhaven Life enabled.
2. Open an RP chat with a useful Life state/World Snapshot.
3. Open Extensions -> Greyhaven Phone.
4. Unlock the phone.
5. Open Contacts -> Discover relevant contacts.
6. Open Snap Map and verify Life locations.
7. Open Calendar and verify schedules / exceptions.
8. Open Messages, create a direct chat with Aurora, and send a short message.
9. Return Home and press Phone Refresh.
10. Check Messages, Social and Phone for plausible new activity.
11. Switch SillyTavern persona to Aurora and reopen Phone. Aurora should have a separate phone timeline.

## Public API

```js
GreyhavenPhone.open()
GreyhavenPhone.close()
GreyhavenPhone.refresh()
GreyhavenPhone.getProfile()
GreyhavenPhone.getTimeline()
GreyhavenPhone.getContacts()
GreyhavenPhone.getActivePersona()
GreyhavenPhone.seedContacts()
```

## Cross-persona continuity

Greyhaven Phone keeps separate devices for each persona, but direct phone events remain coherent inside the same SillyTavern timeline.

Example:

1. Eldin opens his phone and texts Aurora.
2. Aurora replies.
3. Later you switch SillyTavern persona to Aurora.
4. Aurora's phone contains the same direct conversation from her side, including unread incoming messages where appropriate.

Direct call records are mirrored as well.

When Phone Refresh generates a Social post or Story authored by a character, that authored content is also stored on that character's latent phone so it can appear as their own content if you later switch to that persona.

A latent phone is created only when necessary. When that character is later selected as an actual SillyTavern persona, the latent phone is reused instead of starting a second blank device.

## Main-roleplay continuity

Phone conversations are not an isolated toy.

Greyhaven Phone injects a small, relevant continuity summary immediately before normal SillyTavern generation.

It includes only recent phone conversations/calls relevant to:
- the current character/group members
- contacts explicitly mentioned in the newest user message

This means a promise made by text can remain relevant when the characters meet physically later.

Private phone events are marked as knowledge for their participants only; they are not treated as universal knowledge.

This continuity injection does **not** make another AI request. It reuses the already stored phone state.

## Exception end dates

Greyhaven Phone does not require a Greyhaven Life update for v1.0.

The current Greyhaven Life public API already exposes each tracked person's schedule exceptions. Calendar therefore shows the exact exception end date/time when available.

A future Greyhaven Life polish release can separately make the main roleplay prompt state the exact exception end more explicitly.
