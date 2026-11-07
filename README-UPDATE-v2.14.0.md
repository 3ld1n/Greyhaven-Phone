# Greyhaven Phone v2.14.0 — Circle v1 (Discovery & Messaging)

**Base:** Greyhaven Phone v2.13.0; retains its existing core and Greyhaven Life v1.10.0 integrations.

## Installation (incremental; IMPORTANT)

This is a **patch pack**, not a replacement for the whole extension. **Back up** the existing Greyhaven Phone extension folder and export your active SillyTavern group chat JSONL before updating.

From the archive's `Greyhaven-Phone-main/` directory, upload these six files into the **root** of your existing [Greyhaven-Phone GitHub repository](https://github.com/3ld1n/Greyhaven-Phone), alongside the current `index.js`, `bridge.js`, `social-studio.js`, etc.:

* **Replace** `entry.js`, `entry.css`, and `manifest.json`.
* **Add** `circle.js`, `circle.css`, and `circle-core.mjs`.

The optional `README-UPDATE-v2.14.0.md` is documentation only. **Do not delete or overwrite the original `index.js`, `bridge.js`, `social-studio.js`, `style.css`, or Greyhaven Life files.** Do not create a nested `Greyhaven-Phone-main` folder inside the installed extension.

Then update/pull the extension onto the SillyTavern VPS (or use your normal installed-extension updater), reload SillyTavern, and hard-refresh the iPhone Safari/PWA. Unlock the phone and look for the purple **Circle** icon on the home screen. The Phone core API still reports v2.13.0; the extension manifest becomes v2.14.0 and the Circle module reports v1.0.0.

**Rollback:** restore the original three files `entry.js`, `entry.css`, and `manifest.json` (or your backed-up extension directory), remove the three Circle files if desired, then refresh. Leave chat and settings data intact; no reset required.

## Features in Circle v1

- **Meet People** and **Dating** discovery modes. Each requested batch returns up to 10 unique adult profiles; the model is asked for 12 candidates so duplicates can be discarded. Names are single first names and checked against current SillyTavern characters, Phone identities, and every previously generated Circle name in the global name registry.
- **Profiles are global per stable Phone identity** via `extensionSettings.greyhavenPhone.circle.profiles[identityId]`, shared across individual chats and group chats for that character. Edit age, gender, sexuality, desired gender, age range, occupation, location, bio, interests, friendship/dating goals. **AI complete profile** uses the character description and Greyhaven Life status and writes only after an explicit button press. Its public-facing prompt tells the AI not to expose private secrets.
- **Filters separate from profile**: for each discovery mode in the current chat, optionally specify NPC gender, age range, occupation/background, traits, hobbies, neighborhood and detailed requirements. They affect a discovery batch, not the saved character profile.
- **Chat-scoped Circle activity** in `chatMetadata.greyhavenPhone.circle`: generated NPCs, swipe position, likes, pending/matched/non-mutual status and conversations. The global registry retains only reserved first names; generated NPC descriptions and character cards stay in the chat. Changes in one group chat do not silently affect another.
- **Manual refresh matching**: a right swipe can match immediately (~31% baseline) or remain pending. **Pending matches only resolve when the user explicitly taps Circle Refresh**. There are **no background timers, delayed tasks or passive automatic match updates**. Chance adjusts slightly with elapsed fictional time; after five unsuccessful explicit checks the like expires. Refresh checks are local and **cost zero AI tokens**.
- **NPC chats:** send a message to a mutual match and generate one short, character-consistent AI reply on demand. No messages from unmatched cards. This uses the current SillyTavern `generateRaw` model, which incurs normal API usage.
- **Full Character Card:** from any discovered NPC profile, generate a complete first-person SillyTavern-oriented card with Name, Age, Description, Appearance, Personality, Backstory, Relationships, and Roleplay Notes. Copy to clipboard. Cards are **not** auto-imported into SillyTavern in v1; that is a separate future integration feature.
- **Greyhaven Life clock** supplies fictional timestamps where available; otherwise Circle uses the device clock. Existing Phone/Life prompt injection is not modified in this release, preventing unrelated characters from seeing private Circle conversations.

## API calls / token costs

- AI complete profile: one model request **only on button press**.
- Discover 10: one model request **only on button press**. After filtering duplicate or out-of-range names, a batch can contain fewer than 10; it reports the count honestly.
- Full Character Card: one model request only on button press; saved until explicitly regenerated.
- NPC reply: one request when you send a message.
- Right/left swipes, matching refresh, viewing profiles, tabs and loading existing conversations: **no AI request**.

## Tests / limitations

Verified against the **v2.13.0 repository snapshot**: Node syntax checks, pure data-model tests, simulated SillyTavern persistence/identity integration, and headless Chromium mobile UI tests at 390×844 for launch, form AI generation, filtering, ten cards, card generation, match, reply, chat switch, horizontal overflow and runtime errors. Tests passed. Browser tests used mock model responses, **not the live VPS/SillyTavern API**. Before relying on the main storyline, try the new app on a copied group chat and confirm your real model completes generation successfully.

*No automatic SillyTavern character creation, main-RP meeting integration, or Circle-to-Life world events in v1; these are v2 tasks.*
