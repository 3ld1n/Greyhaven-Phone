# Greyhaven Phone v2.15.1 — Circle v2.1 Media & Match UX

This is an **incremental patch** to the working Greyhaven Phone **v2.15.0 (Circle v2)**. It does not replace the complete extension and does not require a Greyhaven Life update.

## Changed files (copy into the existing Phone extension root)

- `circle.js` — message UI, long-press actions, edit UI, match review/cleanup, optional local media upload
- `circle.css` — clean photo/video cards, timestamps below bubbles, mobile context menu layout
- `circle-core.mjs` — single immutable match decision per like; results on FIRST manual refresh
- `image-gen.js` — adds an explicit `attachLocalMedia()` API to existing Wiro/image registry using the same IndexedDB media store (no automatic Wiro call)
- `index.js` — version identification only; preserves v2.15 Phone core
- `manifest.json` — extension version 2.15.1

All other v2.15 files, especially `bridge.js`, `phone-identity.mjs`, `social-studio.js`, `image-gen-core.js`, etc., remain as currently installed. **Do not delete files that aren't in this ZIP.**

## Improvements

1. **Media cards** show a generated/local preview or a simple Photo/Video placeholder with a `Generate` button. Raw image description metadata is no longer shown as chat text. Captions are shown as captions. **Long-press** (or right-click) the media card for Generate/Regenerate with Wiro, Edit description, Replace local preview, Save to Photos/Files, and View description.
2. **Timestamps** and Edited labels are now below the image/text bubble, not inside it.
3. **Message editing:** the always-visible "Edit latest text" link was removed. Long-press the latest message you sent to edit it; saving removes the old downstream NPC reply and generates a replacement.
4. **Outgoing media:** Choose Photo or Video from the `+` menu, add a text description and optional caption, then optionally choose a **local image/video file** to attach as the preview. The file is saved on **this device** in the existing Greyhaven Phone IndexedDB store. Sending it does NOT automatically call Wiro. Videos can be played as local videos. Wiro's Generate action still generates a **still preview** based on the metadata, not an AI video.
5. **Matching:** swiping right determines a 15% eventual mutual match **once** (without immediate match). On the **next Circle Refresh**, the result is revealed as either **Matched** or **Denied**, even when Greyhaven Life's time is frozen. Refreshing again never rerolls. Denied/Disconnected profiles are visible for review in their own sections until the **following** Circle Refresh.
6. **Cleanup:** after that following refresh, denied or disconnected Circle NPCs that haven't been converted into SillyTavern characters are deleted from this chat's Circle state and their names are released for future discovery. **This also discards the old Circle conversation for disconnected, unlinked NPCs.** If you want to keep a card, **generate/create the SillyTavern character before the cleanup refresh.** Already-created character profiles and their chat history are kept. Blocked NPCs stay blocked and are not automatically deleted, so they can't reappear under a reused name.
7. **No rude warning:** the empty notice is simply "No new matches yet."

## Install

1. Export/back up your active chat (`.jsonl`) and back up the current Greyhaven Phone extension folder. Save iPhone-local previews you want to keep in Photos first; JSONL backups do not include browser IndexedDB blobs.
2. Extract this ZIP and copy the **six changed files** from `Greyhaven-Phone-main/` into the **root** of your existing Phone repository or installed extension folder, replacing the same-named files.
3. If you deploy through GitHub, push the six files, then update/pull the Phone extension on the SillyTavern VPS by your usual method. Do **not** install an additional duplicate copy of Greyhaven Phone.
4. Restart/reload SillyTavern and perform an iPhone Safari/PWA hard refresh.
5. Test in a **copied chat** first. Open a Circle conversation; verify no text metadata, long-press edit/media menu, a local preview upload, and first/second match refresh behavior.

## Data and limitations

- Existing matches, profiles, linked SillyTavern characters, original Phone apps and Greyhaven Life records are not reset during installation.
- Local photos/videos are stored in the browser's IndexedDB, on the device where attached. They do not automatically appear on another device or in a chat JSONL export. No file is automatically attached or generated when an NPC sends photo/video metadata.
- A request to Wiro is made **only** when you explicitly select Generate or Regenerate.
- Actual SillyTavern + live Wiro integration has not been run against the user's VPS. Static syntax checks, pure matchmaking tests and a mobile browser mock passed. If the UI freezes or a preview fails, revert these six files to v2.15.0; do not erase chats, browser data, or Greyhaven Life data.
