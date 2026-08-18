# Greyhaven Phone v2.7.0 — Timeline Scope + Service Characters

Install on top of Greyhaven Phone v2.6.0.

This update does NOT add another app and does NOT add AI-usage tracking.

## 1. Correct state scope

### Universal Greyhaven state stays universal
Greyhaven Life still stores these globally across chats:
- cars / motorcycles / boats / aircraft
- vehicle ownership
- properties
- property ownership
- tenants / occupants
- mechanics
- property agencies
- the five seeded service-character roles

A car or apartment does not disappear because you switch chat branches.

### Timeline state is now chat-specific
The following now live in the current SillyTavern chat metadata:
- Airbnb generated stays
- Airbnb searches
- reservations
- shared bookings
- participants / locks / auto-fill state
- trip itineraries
- plane / ferry / bus tickets
- destination-local Airbnb NPCs
- Airbnb saved stays
- Eventbrite generated events
- user-created Eventbrite events
- Eventbrite viewers
- travel reminders

So a Paris trip in one roleplay branch no longer appears in another unrelated chat.

### v2.6 migration
v2.6 stored travel/event state globally.

On first load of v2.7:
- the old v2.6 travel/event state is copied into the FIRST chat opened on v2.7
- a global safety backup is retained
- every other chat starts with a fresh travel/event timeline

This preserves the timeline you are currently using without copying it into every branch forever.

## 2. Airbnb host Messages fix

`Message host` is no longer a dead-end action.

After sending:
- the message is mirrored into the real Greyhaven Phone Messages system
- Airbnb exits back to the native Phone UI
- the matching Messages conversation is opened automatically

Once a thread exists, Airbnb also shows:
- `Open host chat`

### Full SillyTavern character hosts
If the host is a real imported SillyTavern character card:
- Greyhaven Phone's existing one-hop reply system is used
- the character card description/personality controls the reply
- the reply remains in the normal Messages thread

### Generated Airbnb NPC hosts
If the host is only an Airbnb-generated NPC:
- one short bounded host reply is generated only after the user explicitly sends a host message
- the reply is mirrored into the same normal Messages thread
- viewing a property does not generate anything
- no autonomous background conversation is started

## 3. Five full Greyhaven service characters

The ZIP includes importable Character Card V2 JSON files in `/characters`.

Import these exact names through SillyTavern Character Management:

1. Grant Harlow
   - male, 42
   - Harlow Auto & Tow
   - ordinary repairs, diagnostics, breakdowns and towing
   - practical, blunt, reliable, dry humor

2. Nico Russo
   - male, 30
   - Russo Motorworks
   - motorcycles, tuning, performance cars and diagnostics
   - energetic, sarcastic, social and more chaotic than Grant

3. Celeste Warren
   - female, 35
   - Warren Property
   - property agent, not the owner of client properties
   - polished, persuasive, observant and ambitious

4. Gordon Pike
   - male, 58
   - Park Area landlord
   - owns the older-but-decent Park Area apartment units
   - old-school, fair, private and firm about rent

5. Arben Kodra
   - male, 45
   - College Quarter landlord
   - owns student apartments near Greyhaven City College
   - relaxed, friendly, tolerant of normal student life, strict about damage

The cards intentionally contain NO character-specific system-prompt override, so your existing global RP prompt remains in control.

## 4. Automatic app linking after card import

The extension only seeds these roles after it sees an ACTUAL SillyTavern character card with the exact name.
Latent/duplicate Phone identities alone cannot trigger the seed.

After importing the cards:

### Garage mechanics
- Grant Harlow → Harlow Auto & Tow
- Nico Russo → Russo Motorworks

### Property agency
- Celeste Warren → Warren Property

### Park Area apartments — Gordon Pike
The building is older, not a modern luxury development, but is decent, clean and well maintained.

- Park Area Apartments · 3A
  - tenant: Aurora
  - €680/month

- Park Area Apartments · 3B
  - tenant: Eldin
  - €640/month

- Park Area Apartments · 3C
  - tenants: Liam + Evelyn
  - occupant: daughter Alina
  - €980/month total

### College Quarter apartments — Arben Kodra
- College Quarter Apartments · 2D
  - roommates: Leo + Rozafa
  - €900/month total
  - default equal split

- College Quarter Apartments · 4B
  - siblings: Alessa + Kevin
  - €880/month total
  - default equal split

All default split/rent/property details remain editable later.

The seed is idempotent:
- it does not create duplicate mechanics
- it does not create duplicate agencies
- it does not create duplicate apartments
- existing seeded properties are not repeatedly overwritten after you edit them

## 5. What stayed unchanged

- cars/properties remain universal
- Garage / Property / Airbnb v2.6 controls remain
- Eventbrite stays deliberately simple
- Eventbrite feature/UI block was verified unchanged from v2.6
- no AI-usage dashboard was added
- no new app was added

## Test pass

- loader.js syntax — PASS
- life-assets.js syntax — PASS
- travel-events.js syntax — PASS
- five Character Card V2 JSON files — PASS
- v2.6 travel migration into first chat — PASS
- bookings do not leak to second chat — PASS
- events do not leak to second chat — PASS
- new chats receive fresh Booking/Event state — PASS
- universal Life properties survive chat changes — PASS
- latent identities cannot seed service roles — PASS
- two male mechanic roles — PASS
- Celeste agency role — PASS
- Gordon Park Area ownership/tenancies — PASS
- Arben college ownership/tenancies — PASS
- repeated seeding creates no duplicates — PASS
- full-character host uses normal character reply route — PASS
- generated Airbnb host fallback reply route — PASS
- host Messages thread lookup — PASS
- Eventbrite feature/UI block unchanged — PASS

Live iPhone/PWA interaction should still be checked after installation because automated tests cannot reproduce every Safari touch/navigation detail.
