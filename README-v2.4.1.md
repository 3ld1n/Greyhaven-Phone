# Greyhaven Phone v2.4.1 — Quick Fix

This patch is applied on top of v2.4.0.

## Fixed

- **Life no longer freezes when opened.**
  v2.4.0 was re-rendering the Life UI from its own MutationObserver changes,
  causing a render → DOM mutation → render loop on iPhone.

- **Life now looks and behaves like an iPhone folder.**
  The home-screen icon is a translucent 3×3 folder preview containing miniature
  Garage and Property icons. Opening it shows an iOS-style blurred folder panel.

- **Life is positioned higher on the phone home screen.**
  It is inserted immediately after Uber when Uber is present, instead of being
  appended at the bottom.

- **Greyhaven Phone Manager moved into the native Extensions settings panel.**
  The old quick-menu entry beneath Greyhaven Phone is removed automatically.

- **Duplicate global identities / phone numbers can now be cleaned up.**
  The manager separates:
  - actual phone records;
  - duplicate identity numbers;
  - missing phones.

  Missing Phones now shows one canonical identity per character instead of
  repeating every old same-name identity record.

- **Safe duplicate deletion.**
  Old same-name identity records can be deleted individually or in one safe
  cleanup action. Current SillyTavern character-card identities are protected.

- **Phone-bound old identities are protected until repaired.**
  "Repair bindings" can move an old same-name phone record to the current
  canonical character identity. After that, the orphan identity becomes safe
  to delete.

- **References are migrated before duplicate deletion.**
  Current-chat phone metadata, Life asset state, app-role identity references,
  OnlyFans identity records, and identity-keyed relationship/app-role entries
  are remapped to the canonical identity before an orphan duplicate is removed.

## Preserved

All v2.4.0 Life / Assets functionality remains:
Garage, Property, sales, rentals, mechanics, agencies, ownership rules,
Facebook Marketplace bridging, realistic pricing, Uber and Domino's defaults,
and persistent world-state behavior.
