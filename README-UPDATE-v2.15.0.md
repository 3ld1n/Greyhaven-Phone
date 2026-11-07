# Greyhaven Phone v2.15.0 — Circle v2.0

**Use with your existing Greyhaven Phone v2.14.0 (Circle v1) and Greyhaven Life v1.10.0.** This ZIP contains only modified Phone files; it is **not** a fresh SillyTavern installation. Your saved Phone and Circle data remains in SillyTavern chat metadata and extension settings.

## Install safely

1. **Back up first:** export the active/group chat `.jsonl`, save the existing Greyhaven Phone extension directory or GitHub repository state, and back up your settings. Generated Wiro previews that live only in your iPhone browser/IndexedDB may need to be saved separately; don't clear Safari website data.
2. Extract the ZIP. Open `Greyhaven-Phone-main/` inside it, and upload its eight `.js`/`.css`/`.mjs`/`.json` files into the **root of your existing** Greyhaven Phone extension/repository, **replacing** those same files:
   - `index.js` (Phone core 2.15.0, native Circle app settings and unified refresh)
   - `image-gen.js` (Circle media registry in the existing Wiro system)
   - `circle.js`, `circle.css`, `circle-core.mjs` (Circle v2)
   - `entry.js`, `entry.css`, `manifest.json` (app loading/version)
3. Do **not** delete or overwrite any other Phone files: retain `bridge.js`, `loader.js`, `life-assets.js`, `travel-events.js`, `social-studio.js`, `style.css`, `image-gen-core.js`, `image-gen.css`, and the rest. Do **not** put a nested `Greyhaven-Phone-main/` folder inside an installed extension.
4. Update/pull the changed Phone files onto your VPS using the existing method, reload SillyTavern, and hard-refresh the Safari/PWA client. No separate Greyhaven Life update is needed.
5. Check **Phone > Settings > Installed apps > Circle**; the checkbox should be available. It is on by default, including for older saved profiles. Disabling the app hides it without deleting data.

## What's new

- **Profiles accessible anytime:** from Connections and by tapping the person's name/avatar in a full-screen chat. View profile, remove a like/unmatch, or block. Prior conversations are retained but messaging stops after disconnection or block.
- **Full-screen conversations**, back arrow, a typing indicator during AI replies, and profile/options controls. Characters can reply, ignore, decline a request, or block you based on personality and circumstances.
- **Photos/videos are metadata only:** you can send or request them, and NPCs can refuse or send them spontaneously. No local attachment is generated automatically. The media card exposes **Generate**, **Edit metadata**, **Retry** and **Save** via the existing Phone Wiro image pipeline. For a video, Wiro generates a **still-image preview only**, not a playable video.
- **Edit your latest sent text:** correct it and regenerate the reply or replies that followed it. Older messages cannot be edited this way, to avoid invalidating long histories.
- **Fixed matchmaking:** ~15% chance of eventual mutual interest, determined ONCE when you like a profile. Some successful matches are immediate; others become eligible after fictional time, but are revealed only by manually pressing **Circle Refresh**. Repeated Refresh cannot reroll a no-match. Existing matches remain untouched; old v1 pending likes receive a one-time fixed outcome on their first v2 Refresh.
- **Character creator:** generate a concise first-person card (Name, Age, Description, Appearance, Personality, Backstory, Relationships, Roleplay Notes), review/edit it, and explicitly confirm **Create SillyTavern character**. Creation uses SillyTavern's standard server endpoint, verifies the returned avatar file, and saves a permanent identity link. The newly created character also inherits a global **public** Circle profile. Your actual Circle swipes, messages and private cards remain chat-specific. If the server rejects creation, the chat/card remains; use **Copy card** to create manually. You may need to refresh the SillyTavern Characters list and add the character to your roleplay group yourself.
- **Roleplay privacy:** only the specifically linked character, when it is the active replying speaker, receives their own recent Circle conversation/meeting information. If the speaker cannot be identified, Circle injects no private chat. Existing Phone/Life scoping remains unchanged.
- **Greyhaven Life awareness:** uses fictional clock and available person/location context. Once both characters actually agree on a place/time, Circle can submit a one-time plan through the **existing v1.10 Life bridge** (which exposes `addOneTimePlan`). A scheduled plan expresses intent; it does not itself send anyone a message, enter the RP scene, or prove a meeting happened.
- **Phone Home Refresh:** existing mutual Circle matches can independently send text or photo/video descriptions through **the same existing Phone AI refresh call**. Circle's sender/ID is validated. Unread notifications can open the correct Circle chat. **Phone Home Refresh is separate from Circle's free matching Refresh.**
- **Data boundaries:** Circle profiles are shared across chats by stable identity. Discovery cards, swipes, matches, messages, blocks and meetings are saved to the individual chat. The global first-name registry prevents reusing names for newly generated NPCs.

## Costs

- Opening Circle, reading profiles/chats, liking/swiping and Circle **Refresh**: no AI calls.
- Discovering 10, AI-completing your profile, generating a card, messaging an NPC: a model request on demand.
- Home Phone Refresh: one usual Phone AI request; Circle context increases its input a little but does not require a second dedicated AI call.
- Wiro image Generate/Retry: user-initiated, may incur a Wiro charge. There is no automatic Wiro generation for Circle messages.

## Tests and limitations

Passed local tests: JS module syntax; immutable matchmaking/migration/block logic; headless Chromium mobile mock for profile, discovery, matching, full-screen chat, editing/regeneration, media metadata & manual tools, character creation (mock endpoint), preventing sender spoofing, chat separation, and no mobile horizontal overflow or runtime errors. The real SillyTavern `/api/characters/create` and Life bridge endpoints were checked against their upstream/current sources. **No live VPS, iPhone PWA, real OpenRouter generation or real Wiro charge was performed.** Test in a copied chat first.

**Rollback:** restore the eight replaced Phone files from your prior backup (the original v2.13 core plus working v2.14 Circle v1 files) and reload; do not reset chats or global settings. A character you already created remains a normal SillyTavern character.
