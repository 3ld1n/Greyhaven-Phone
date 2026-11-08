# Greyhaven Phone v2.15.2 — Circle History Preservation & Menu Repair

**Incremental patch for v2.15.1.** Does not replace your SillyTavern chat metadata, saved NPC profiles, Phone data, images, or Greyhaven Life.

## Fixed

1. **Circle no longer automatically destroys an existing conversation** when the NPC rejects a like, either person unmatches, either person blocks, or Refresh is pressed repeatedly. Saved meeting plans also protect the NPC from automatic cleanup.
2. **Archived chat access:** Connections now includes **Saved conversations** for disconnected, blocked, denied, or NPC-blocked contacts with actual chat history. Tap the person to reopen the chat in read-only mode; tap the profile icon to open their card.
3. **Prompt continuity:** For an NPC linked to a real SillyTavern character, their existing Circle conversation and meeting notes remain available to the **correct active speaker's** private continuity prompt even after disconnection or blocking. Other characters do not see the private conversation.
4. **Proper three-dot menu:** No more typing action names. The native text prompt is replaced by an iPhone-friendly action sheet containing the applicable actions: View profile, Propose meeting (connected only), Unmatch, Block / Unblock, and Delete conversation.
5. **Manual deletion only:** The **Delete conversation** button requests confirmation and removes only that person's Circle conversation, meeting notes, and Circle notifications in the active chat. It **does not delete** their SillyTavern character, global profile, character identity, or other chats. Saved images in device storage are not deleted.
6. **Cleanup remains:** Never-contacted / unlinked rejected or unmatched NPCs can still be pruned in accordance with the previous second-refresh rule, making their first names available again. Blocked people stay blocked until explicitly unblocked.

## Install

1. Back up your existing `Greyhaven-Phone` extension and export the active chat (`.jsonl`).
2. Inside this ZIP, open `Greyhaven-Phone-main/`.
3. In the root directory of your **existing** Greyhaven Phone extension, replace the following files with the bundled copies:
   - `circle.js`
   - `circle.css`
   - `circle-core.mjs` (unchanged from v2.15.1; included to keep versions consistent)
   - `manifest.json`
4. Do **not** delete or replace `index.js`, `image-gen.js`, `entry.js`, `entry.css`, Greyhaven Life, or your existing chat metadata.
5. Update the installed extension on your VPS using your normal workflow, reload SillyTavern, and fully refresh your iPhone PWA if it has cached JavaScript.

## Test on a copied chat

- Reopen a Circle conversation and use the three-dot menu. Confirm that the action sheet appears without a typed-choice prompt.
- Unmatch someone **with existing messages**; find the person under **Saved conversations** and reopen the read-only thread.
- Press Circle Refresh twice; confirm that the saved conversation and meeting notes are still present.
- Try the Block / Unblock options, then revisit the history.
- Avoid testing Delete conversation on someone important; its purpose is to permanently clear that chat's Circle messages and meeting notes.

**Important:** If an *older* release already deleted a conversation during a refresh, installing this patch cannot recreate that deleted data. You would need an earlier chat export or metadata backup. Existing conversations that are still present when you install this patch are retained.

## Validation

- JavaScript syntax checked in Node.
- Mobile Chromium: blocked, unmatched and denied conversations with history survived repeated refreshes; archived thread accessible; no horizontal overflow or uncaught JS errors.
- Menu action sheet opened and navigated; explicit deletion was limited to the chosen conversation.
- Linked-character private prompt retained history after unmatch and refresh, and cleared it after explicit deletion.
- Live iPhone / VPS still needs confirmation.
