# Greyhaven Phone v2.13.0 — Character-private chronology, media menus and profiles

Works with Greyhaven Life **v1.10.0**. Both archives must be installed together.

## Major changes

- **Character-specific RP injection:** Main group RP receives only the current speaker's existing phone records. An unknown/ambiguous speaker injects no private phone history. The older whole-group phone summary fallback is not used. The corresponding Life world-events and plans prompts are also scoped to the active member.
- **Existing chats work immediately:** The chronology module reads the pre-existing `chat_metadata.greyhavenPhone.phones` records, including old `phone-id:...` keys via `identityId`. It does not delete, migrate, truncate, or rewrite phone messages when gathering prompt context.
- **Cross-app chronology:** iMessage, Instagram, Snapchat, Facebook, OnlyFans and Dark Web DMs, plus visible posts/stories and phone calls on the speaker's own phone, are sorted by fictional time and, for tied timestamps, event sequence or real timestamp. Up to 105 recent records / roughly 10,500 characters are supplied in a bounded group prompt; not all history can fit in 16K context. The separate pair-chat memory remains available for direct phone replies.
- **Always-on cross-app memory:** the checkbox is no longer displayed or honored as a disabling switch.
- **Boundary behavior:** joking or hypothetical “I'll block you 😂” is no longer automatically treated as a hard no-contact request. Implicit auto-blocking from model text is removed; explicit decisions and genuine repeated violations still matter.
- **Phone actions:** GH_ACTION now additionally recognizes character-made Instagram posts/stories/likes/comments, Facebook posts/likes/comments, Snapchat stories/remove-friend. Existing message, media, call, block, contacts, and friendship actions remain. Posts require image metadata and become text/image placeholders until an image is generated. Like/comment actions require an existing visible post by the recipient. Unsupported actions are not invented.
- **Photos:** existing image buttons don't display intrusive AI badges. Long-press photo messages, social photos, or use a desktop right-click for the menu. Existing message edit/unsend/delete actions remain. `Save to Photos` invokes the native share sheet on supported iPhones or a file-download fallback; on iOS you may need to select “Save Image” manually. AI metadata tools remain accessible.
- **Social profiles:** Instagram Profile and Facebook Profile now open the same persistent profile view as the social studio. People/Find search names can open profiles. Improved device-safe-area layout and back behavior. Existing legacy social posts are collected into the global profile on sync, rather than discarded.
- **Life folder:** closing the Clock view returns to an unlocked Phone home screen.

## Installation

1. Export a **fresh** backup of the active group chat (`.jsonl`) and the original Phone and Life extension folders. Also save any iPhone-local photos you can't afford to lose: generated image blobs may live in browser storage, not in the chat JSONL.
2. Unzip both archives. Upload the **contents** of `Greyhaven-Phone-main/` into your existing Greyhaven Phone GitHub repo/folder, and the **contents** of `Greyhaven-Life-main/` into Greyhaven Life. Do not nest those folders inside existing extension folders or install duplicate active copies.
3. Update/reload both extensions on the VPS. Restart SillyTavern and hard-refresh your Safari PWA. Keep the chat checkpoint untouched.
4. In the same restored group, select a *manual* reply from Jessy and inspect Prompt Itemization. Check that `Greyhaven Phone — PRIVATE MEMORY OF JESSY ONLY` appears and contains no Lexi/Eldin or Aurora/Jack-only private conversation. Repeat with Lexi to verify a different view. If the speaker cannot be resolved, Phone deliberately injects no private history; group handling should be **Swap character cards**.
5. Check photos, Instagram/Facebook profiles and actions on a copied chat before playing on the live one.

## Important limits

- Static/offline regression tests passed; actual SillyTavern + iPhone PWA interoperability has **not** been verified here. Exact older ordering is best-effort when legacy messages share timestamps and have neither real timestamp nor sequence metadata.
- This filters **extension-injected phone events** and character-scoped Life events. SillyTavern's existing main RP history and user-authored summaries remain visible; they can still disclose a secret if their prose explicitly contains it. It does not magically rewrite prior RP history.
- Expanded GH_ACTION support is deliberately validated. Not every possible UI interaction in every service app has an AI action type yet (e.g. buying products, editing old posts, completing complex rides), because executing unsupported actions could corrupt stored state.
- Browser APIs can't silently write to the iPhone camera roll. The native share sheet / download provides a supported user-controlled export.
- Existing photos that only live inside browser IndexedDB may not transfer to a different device with a JSONL backup alone.
