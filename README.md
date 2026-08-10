# Greyhaven Phone v1.1.1

A fictional iPhone-style phone simulator for SillyTavern roleplay.

## v1.1.1

This release keeps the existing app set and focuses on making the working Phone feel more coherent and controllable.

### Contacts
- Remove a contact from the current phone timeline.
- Removed contacts are suppressed from automatic relationship/Life/chat discovery.
- Removed contacts therefore cannot be selected for automatic Phone Refresh activity.
- A Removed Contacts screen lets you restore them later.
- Manually adding a removed character restores them.

### Conversations
- Delete an entire conversation from the current phone.
- Deleted thread content is no longer supplied to Greyhaven Phone generation on that phone.
- Existing cross-persona mirroring remains intact for new direct messages/calls.

### Photo and video messages
Messages now support fictional photo/video attachments.

The sender always provides a text description of what the media contains. That description is what the AI understands.

Optional local files can be selected from the device. Local image/video blobs are stored in IndexedDB and replace the descriptive placeholder visually, while the AI still receives only the written description.

Media metadata mirrors across persona phones in the same RP timeline.

### Request Photo / Request Video
The Messages `+` menu can arm the next text as a photo or video request.

A request is not forced compliance. The contacted character may:
- send the requested media,
- send media plus text,
- reply with text only,
- tease,
- refuse.

Characters may also spontaneously send fictional photo/video messages when it makes sense.

### Better Phone Refresh continuity
AI Phone Refresh receives a bounded tail of each existing thread, including its last activity time.

Recent new messages should therefore continue a topic or feel like believable double texts instead of abruptly starting unrelated conversations.

### Stricter location evidence
A phone owner's location is never treated as evidence that unrelated contacts are in the same place.

Location-specific posts/messages require evidence belonging to that contact, such as:
- their Greyhaven Life state,
- scenario/recent RP mentioning them,
- their own world-state location evidence.

Without evidence, ambient content should stay geographically neutral.

### iPhone Home Indicator
The extension's fake white gesture bar is shown on Lock Screen/Home Screen only. It is no longer drawn inside apps, where it could overlap Messages or other controls.

## Architecture

- Phone history is isolated per SillyTavern chat.
- Each persona has a separate phone inside that chat.
- Direct messages/calls can be mirrored between persona-owned phones inside the same timeline.
- Wallpaper/apps/settings are global per persona.
- Greyhaven Phone reuses Greyhaven Life clock/world/schedule state when available.
- Phone Refresh remains a single optional AI pass.

## Existing apps

Messages, Phone, Contacts, Social, Snap Map, Calendar, Photos, Notes, Mail, Settings.

No new apps were added in v1.1.0.

## Installation

Repository root:

```text
manifest.json
index.js
style.css
README.md
```

Minimum SillyTavern version: 1.13.3.

## Suggested v1.1 test

1. Remove a relationship contact and run Discover + Phone Refresh. They should stay removed.
2. Restore the contact from Removed Contacts.
3. Delete a direct conversation and reopen that contact; it should start empty.
4. Send a fictional photo with description only.
5. Send another photo with a local image selected and confirm the image appears in the UI.
6. Request a photo, then write the actual request. Verify the character can comply or refuse naturally.
7. Refresh after an active texting conversation and check whether any double text follows the existing topic.
8. Put the phone owner on a trip while an unrelated contact remains elsewhere/unknown; refresh Social and verify the contact is not automatically teleported.
9. Open Messages with the iPhone keyboard and verify there is no extension-drawn white gesture bar overlapping the composer.


## v1.1.1 additions

### Better media willingness
- Direct-message media requests are no longer refusal-biased.
- Close romantic / intimate / mutually teasing relationships are now prompted to comply more often when it fits the mood.
- The parser can recover media replies when the model writes “Here’s a photo...” or “Here’s a video...” as plain text instead of using the PHOTO/VIDEO protocol.

### Correct aspect ratios for local files
- Local uploaded photos/videos now preserve their measured aspect ratio inside the chat bubble instead of being forced into the old generic frame.

### Attach a local preview to received media
- Any photo/video bubble now has a small paperclip/edit button.
- Use it to attach or replace a local file from your device for that exact message bubble.
- This is especially useful when a character “sends” a fictional image/video and you want to visually swap the placeholder for a real file on your phone.
- The AI still only knows the written media description.
