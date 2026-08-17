# Greyhaven Phone v2.4.0 — Life / Assets Update

This is an **overlay patch for the existing Greyhaven Phone v2.3.0 repository**.

Keep the existing files:

- `index.js`
- `bridge.js`
- `style.css`
- `README.md`

Add / replace the files from this package:

- `manifest.json` — updated to v2.4.0 and loads `loader.js`
- `loader.js` — loads the existing bridge and the new Life module
- `life-assets.js` — Vehicles, Property, marketplace state, rentals, repairs, agencies, phone manager
- `life-assets.css` — UI for the new module

`loader.js` imports the existing `bridge.js`, so none of the tested v2.3.0 core code has been copied or rewritten.

## Life folder

A new **Life** folder is inserted on every Greyhaven Phone home screen.

### Garage

Supports:

- cars
- motorcycles
- boats
- airplanes
- multiple vehicles per character
- manual owner assignment
- make / model / year / color / registration / mileage / condition / notes
- edit existing vehicles
- owner-only sale listings
- owner-only daily rental listings
- explicit ownership transfers
- realistic generated vehicle marketplace
- existing Greyhaven characters may appear as discovered sellers even without a social relationship
- when discovery introduces an asset, that asset is persisted immediately under the seller before the listing is published
- generated NPC sellers are supported
- rental start/end calendar
- overlapping bookings blocked
- 3-hour return reminder
- manual return completion
- mechanic character assignments
- repair issue description
- towing vs drivable service request
- repair status/history

No renter can sell the vehicle. No sale completes automatically.

### Property

Supports:

- house
- apartment
- villa
- land
- business/commercial property
- manual property creation
- persistent ownership
- existing-character owner
- unnamed external owner:
  - Parents
  - Friend
  - Relationship
  - Other
  - Untracked owner
- tracked tenants by exact character name
- untracked housemate count
- monthly rent
- no split / equal split / custom arrangement
- short-stay eligibility flag for the future Booking app
- long-term rental
- explicit tenancy ending
- owner-only sale / rental listing
- explicit property ownership transfer
- realistic generated property marketplace
- generated properties become persistent world locations/assets
- agencies can be existing Greyhaven identities or external agencies
- an agency may list a client's existing property without becoming its owner
- sellers / agency can be messaged through the Greyhaven world action bridge
- landlord can manually send a rent reminder from the Tenancy screen

This update intentionally does **not** build the short-term Booking app yet.
That is the planned second update.

## Universal state

Vehicles, properties, listings, agencies, mechanics, rentals and transactions
are stored in global SillyTavern extension settings rather than one chat's
metadata.

This is deliberate so an asset discovered in one roleplay chat remains the
same asset when another chat/persona sees it.

## Facebook Marketplace bridge

Active Life **sale** listings belonging to an existing Greyhaven identity are
cross-posted into the current chat's shared Facebook Marketplace.

The bridge only cross-posts a vehicle/property after:

1. the asset exists in Life state,
2. the seller is its recorded owner,
3. an active sale listing exists.

This prevents an existing character from appearing to sell a car or property
they do not actually own.

NPC Marketplace behavior already provided by Greyhaven Phone remains separate.

## Uber + Domino's

The Life module makes **Uber** and **Domino's** enabled on all stored phone
profiles by default.

## Greyhaven Phone Manager

A new **Greyhaven Phone Manager** entry is added to SillyTavern's Extensions
menu, outside the phone UI.

It can:

- inspect current-chat phone records
- identify likely duplicate phone records
- repair safe name → identity bindings
- create a missing phone for an existing identity
- reassign an orphan/wrong phone record to another character
- delete an obsolete duplicate phone record
- preserve the reassigned phone number by moving it to the new identity
- give the old identity a new unique number when necessary

Deleting a phone record is intentionally confirmed because it removes that
record's local phone history from the current chat.

## Pricing

AI-generated values are not trusted blindly.

Generated vehicle and property prices are clamped through internal realistic
ranges based on:

- vehicle type
- vehicle year
- vehicle condition
- sale vs rental
- property type
- property size
- sale vs monthly rent

Manual prices entered by the user remain under user control.

## Tests completed

Before packaging v2.4.0:

- `loader.js` syntax check — PASS
- `life-assets.js` syntax check — PASS
- vehicle ownership/listing/sale transfer unit test — PASS
- vehicle rental total + overlapping-date protection — PASS
- property tenancy creation — PASS
- mechanic assignment + towing repair request — PASS
- phone create/reassign/delete test — PASS
- phone-number transfer during reassignment — PASS
- agency client-listing ownership isolation — PASS
- Facebook Life-listing ownership bridge test — PASS
- generated-price clamping test — PASS
- static feature audit — PASS

Browser/device testing should still be done after installation because no
automated test can perfectly reproduce SillyTavern's live iPhone DOM.
