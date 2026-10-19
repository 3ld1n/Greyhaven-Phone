# Greyhaven Phone 2.11.0 — Recovery and stability update

Install with Greyhaven Life **1.9.0** for the slow RP clock. Keep a copy of your
entire current SillyTavern chat data and both installed extension folders first.

## Fixed

- One canonical phone storage key per stable Greyhaven identity. Switching
  between a character's persona and their character card no longer creates
  alternate `persona:`, `latent:` or `latent-id:` phone records.
- Existing duplicate phone records are merged on chat load. Distinct threads,
  contacts, messages and app data are unioned; messages with matching mirror IDs
  are not duplicated. Unrelated identities are never merged solely by name.
- Main Phone, Greyhaven RP-to-phone bridge, and Life phone manager now share the
  canonical identity key convention.
- Background replies, manual phone refreshes, Marketplace/OnlyFans/Dark Web
  refreshes, hidden RP relays, and image generation discard obsolete results
  when the active chat or persona changes. Generated-image costs are still tracked
  if a provider finished before the user switched context.
- RP time is considered when deciding if a phone is stale. A phone in
  `stale-open` mode can refresh after 120 fictional minutes even without many
  main chat messages. `Manual only` still triggers no automatic refresh.
- Frozen timestamps now use the real message timestamp to break ties in
  cross-app recent-history ordering.
- Repeated timeline normalization reuses message arrays; the two broad DOM
  observers now respond only to phone-related changes.

## Data compatibility and caveats

- Chat histories remain in their original SillyTavern JSONL format. The first
  phone access in each chat may save a smaller, merged metadata structure.
- Keep backup JSONL files before opening any chat with the new build.
- The migration merges copies carrying the same **identity ID**. It does not
  auto-merge two genuinely different character/persona identity IDs merely
  because their visible names happen to match. Use the Life phone manager to
  review ambiguous records carefully.
- Image reference packs and generated image blobs are still stored separately
  in that browser's IndexedDB; a JSONL backup does not contain the actual image
  bytes. Keep the original browser/PWA data if you need those images.
- Additional private cross-app conversation bodies were **not** inserted into
  new model prompts. The existing current-thread and continuity prompts remain
  in place. Extending AI memory beyond that needs an explicit privacy choice.
- This release was statically syntax-checked, run through local automated tests,
  and migration-tested against an offline copy of a recovered Greyhaven chat.
  It has not been live-tested on the user's VPS or Safari PWA.

## Safe upgrade

1. Download a full copy of your active chats and both installed extension dirs.
2. Replace the **contents** of the existing Greyhaven Phone extension folder
   with the contents of this folder. Do **not** keep two active installations.
3. Install Greyhaven Life 1.9.0 into its own existing extension folder.
4. Restart SillyTavern, then refresh the browser/PWA. Open a chat, select the
   same character persona twice, and verify that Life's phone manager shows
   only one phone record with the original messages preserved.
5. If anything looks wrong, stop and restore the saved chat JSONL and old
   extension folders before doing further cleanup.
