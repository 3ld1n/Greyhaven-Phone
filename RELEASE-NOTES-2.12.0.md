# Greyhaven Phone v2.12.0 — Private memory, Qwen messaging, image prompt editor

This version builds on 2.11.0 (canonical phone identity and duplicate-prevention)
and works with Greyhaven Life 1.9.0 (slow/frozen roleplay clock).

## Changes

- **Shared private memory by participant pair.** When Lexi chats with Eldin, the
  generated reply has a bounded chronological view of Lexi/Eldin's private DMs
  across iMessage, Instagram, Snapchat, Facebook Messenger, OnlyFans and Dark Web.
  Jessy's independent conversations are never included. The same feature works
  when controlling the other person's phone. It reads existing in-chat metadata
  and does not copy or combine chat histories or phone records.
- **Phone Settings → Private conversation memory** adds an on/off switch. It is
  enabled by default but can be disabled and saved per persona.
- **Qwen-friendly direct replies.** One natural `TEXT:` message is now the
  default; two are allowed occasionally, while model-generated runs of 3–4
  fragments are combined into one. Phone-only cleaning removes roleplay
  `*actions*` and unnatural word-by-word newlines. In-person RP still uses its
  original style. Actual phone calls retain a small allowance for brief actions.
- **Background incoming messages and one-hop phone relays** apply the same
  phone-text formatting; photo/video descriptions remain distinct attachments.
- **Phone Settings → AI Images → Final image-generation prompt** shows the
  complete ORIGINAL model prompt template for editing. The same dynamic
  placeholders are still filled for every real image request:
  `{scene}`, `{continuity}`, `{identity_references}`, `{camera}`,
  `{accessories}`. Save or restore the original. Your custom full prompt is
  preserved in extension settings.

## SillyTavern + Qwen 3 Instruct 2507 quick settings

Use **Chat Completion → OpenRouter**, model
`qwen/qwen3-235b-a22b-2507`. The Qwen model card recommends:

| Setting | Recommended |
| --- | --- |
| Temperature | `0.7` |
| Top P | `0.8` |
| Top K | `20` (if supported by current OpenRouter provider) |
| Min P | `0` |
| Frequency penalty | `0` |
| Presence penalty | `0` |
| Repetition penalty | `1` (neutral) |
| Context | `16,000`–`24,000` tokens to start |
| Max response length | `700` tokens for real-life RP; the Phone makes shorter raw requests |
| Reasoning | Disabled/unrequested for this non-thinking Instruct model |
| Custom stopping strings | `[]` unless explicitly needed |

The Mistral V7 Instruct/Context templates shown in the user's Advanced
Formatting screenshot generally **do not apply** to OpenRouter Chat Completion;
its Prompt Manager takes precedence. If using Text Completion instead, choose a
Qwen/ChatML-compatible template, not Mistral V7.

## Safety and data compatibility

- Export/back up your active chat JSONL before upgrading; never run two phone
  copies concurrently. Install this ZIP over the existing Phone extension
  contents. Keep Life 1.9.0; no Life update is required for these features.
- Existing DMs, contacts, images and roleplay messages are not deleted or
  rewritten by this version. Earlier visible awkward messages remain as sent;
  the new cleaner applies to **future AI-generated** phone texts.
- Automated regression tests cover pair-scoping, Qwen formatting, image-prompt
  editing, and the prior duplicate-phone migration. This was not tested against
  the live VPS or in the actual Safari PWA; verify in a disposable chat first.
