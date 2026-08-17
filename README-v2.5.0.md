# Greyhaven Phone v2.5.0 — Booking + Events

Install this on top of Greyhaven Phone v2.4.1.

Replace/add:

- `manifest.json`
- `loader.js`
- `life-assets.js`
- `life-assets.css`
- `travel-events.js`
- `travel-events.css`

Existing Greyhaven Phone core files stay untouched.

## Tiny fixes included

### Life folder blur
The actual phone home screen now receives a slight blur + dim while the Life
folder is open. The folder itself stays sharp.

### Vehicle market filter
Garage → Market now has an additional mode filter:

- Sale or rental
- For sale
- Rental only

The selected mode is also respected by AI refresh.

## Airbnb-style Booking app

Booking is enabled by default on all stored phone profiles and appears on the
home screen outside the Life folder.

The UI intentionally uses a familiar Airbnb-like visual language while staying
inside the fictional Greyhaven simulator.

### Stays

Short-stay sections:

- Hotel
- Apartment
- Villa

Search supports:

- city
- area/neighborhood
- check-in
- check-out
- guest count
- property type

Search/refresh creates only a small set of relevant choices.

Existing Greyhaven Life properties can also appear when:

- property is active
- type is Apartment or Villa
- `shortTermEligible` is enabled

Normal private homes that are not marked for short stays do not leak into
Booking.

Generated accommodations become persistent once created.

Double-booking overlapping dates is blocked.

### Private group bookings

The current phone identity is always included.

The user may optionally select other tracked Greyhaven characters to travel
together.

The booking stores exactly who is traveling.

### Shared bookings

A character may book a stay as shared and deliberately leave empty slots.

Important rule:

**No random character is silently added to that booking.**

The booking persists globally.

This enables the requested workflow:

1. Jack opens Airbnb.
2. Jack creates a shared booking with empty slots.
3. Switch to Aurora's phone.
4. Aurora opens Airbnb → Shared.
5. Aurora sees Jack and his profile/avatar on the real open booking.
6. Aurora explicitly taps Join.

The price split is recalculated as people join.

Shared bookings can contain:

- one existing stranger
- a group of existing strangers
- open slots
- known characters

`Refresh community` is the explicit action that may seed additional shared
bookings from other existing Greyhaven characters. It does not automatically
join anyone to a user's existing booking.

### Travel

Booking also supports:

- Plane
- Ferry
- Bus

Flights are not AI marketplace listings.

Route + date generate deterministic schedule choices with:

- operator
- departure
- arrival
- price

You can buy a ticket:

- solo
- with selected Greyhaven characters

Travel bookings store the actual traveler list.

## Eventbrite-style Events app

Events is **not installed by default**.

Install it manually from:

Greyhaven Phone → Settings → Installed apps → Eventbrite

Once installed it appears as its own home-screen app outside the Life folder.

### Event discovery

Default location is Greyhaven.

Search supports another city and event type.

Categories include:

- Party
- House party
- Concert
- Festival
- Cultural
- Food
- Sports
- Community
- Business
- Beach party
- Other

Existing Greyhaven characters may appear as organizers even when the current
character has never interacted with them.

Discovered events are informational only.

Opening an event does **not** automatically make every other character know
about it.

### Create event

A character can create:

- house party
- party
- business event
- community event
- food event
- sports event
- cultural event
- beach party
- custom event

A venue can be:

- a custom location
- an existing Life property the character actually owns

The app tracks which Greyhaven characters viewed the created event.

It does not automatically message every viewer or add everyone to a chat.

## Pricing

The update keeps realistic internal price boundaries.

Booking:
- hotel/apartment/villa nightly rates
- guest-count adjustment

Transport:
- plane/ferry/bus ranges

Events:
- category-sensitive ticket prices

AI-generated accommodation/event values are bounded by the simulator rather
than blindly trusted.

## Tests completed

### Syntax
- loader.js — PASS
- life-assets.js — PASS
- travel-events.js — PASS

### Booking
- Booking default-enabled on stored phone profiles — PASS
- Events default-disabled — PASS
- Events manual install — PASS
- Life short-term property import — PASS
- non-short-term property exclusion — PASS
- private group booking — PASS
- shared empty-slot creation — PASS
- cross-phone shared-booking discovery — PASS
- explicit cross-phone join — PASS
- per-person split recalculation — PASS
- overlapping stay protection — PASS

### Transport
- flight schedule generation — PASS
- group traveler booking — PASS
- realistic transport price boundaries — PASS

### Events
- event creation on owned Life property — PASS
- persistent venue/property link — PASS
- realistic event price boundaries — PASS

### v2.4 Life regression
- vehicle sale ownership transfer — PASS
- vehicle rental collision protection — PASS
- property tenancy — PASS
- mechanic/towing logic — PASS

Device testing in the actual iPhone PWA is still recommended because browser
layout behavior cannot be reproduced perfectly by Node tests.
