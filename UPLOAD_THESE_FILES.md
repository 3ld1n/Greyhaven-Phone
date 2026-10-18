# Greyhaven Phone v2.10.3 — Metadata Control & OnlyFans Prompt Fix

Upgrade from v2.10.1 / v2.10.2. This package is **frontend-only**: do not reinstall the Wiro VPS relay or change keys, payment setup, or Nginx.

## Install

In the `extension-patch` folder of this archive, upload **all eight files** to the ROOT of the existing **3ld1n/Greyhaven-Phone** GitHub repository, replacing the existing files:

- `manifest.json`
- `entry.js`
- `entry.css`
- `image-gen.js`
- `image-gen-core.js`
- `image-gen.css`
- `social-studio.js`
- `social-studio.css`

**Do not delete** existing `index.js`, `loader.js`, `bridge.js`, `style.css`, etc. Do not upload the `extension-patch` *folder* as a subfolder. Only its contents go into the extension root.

Then in SillyTavern → Extensions → Manage Extensions → Greyhaven Phone → Update. Fully close and reopen the iPhone PWA to clear cached JavaScript.

## What changed

1. **Wardrobe clothing is no longer auto-injected into the Seedream image prompt.** Clothing should now live in the editable image metadata description instead, so you can correct it manually before generating.
2. **Image metadata guidance now asks for age naturally** (for example, `20-year-old Eldin` or `woman in her early 30s`) plus concise visible clothing when relevant.
3. **Image metadata keeps the background brief** and prioritizes realism, camera choice, the person, and believable phone-photo language.
4. **OnlyFans settings now target only the creator-post refresh prompt**, not an unrelated whole-phone refresh prompt.
5. The OnlyFans prompt editor now stores a dedicated **creator-post override**, validates that it still contains the required `posts` JSON structure, and Reset restores the built-in creator prompt.
6. Existing chats, references, generated images, Wiro setup, and social posts remain intact.

## Testing

- `node --check extension-patch/image-gen.js`
- `node --check extension-patch/social-studio.js`
- `node tests/image-gen-core.test.mjs`
- `node tests/v2.10.1-fixes.test.mjs`

These pass in the packaged build.
