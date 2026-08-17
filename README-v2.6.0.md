# Greyhaven Phone v2.6.0 — Existing App Refinements

Install this on top of Greyhaven Phone v2.5.0.

No new app was added in this update.
No AI-usage tracker was added.
Eventbrite's feature set was intentionally left simple and unchanged.

Replace/add:

- `manifest.json`
- `loader.js`
- `life-assets.js`
- `life-assets.css`
- `travel-events.js`
- `travel-events.css`

Keep the existing Greyhaven Phone core files such as `index.js`, `bridge.js`,
`style.css`, and the main repository README.

## Airbnb — shared booking controls

Every player-created shared stay now has:

- Open / Locked state
- optional Auto-fill open spots
- Check shared activity from Trips when Auto-fill is enabled
- Check for a new join from the booking detail page
- manual cross-phone joining still works exactly as before
- creator-only participant removal
- creator-only cancellation of the entire reservation

Auto-fill has a strict safety rule:

**Only existing Greyhaven character identities may auto-join a player-created
shared booking. Destination-local NPCs never auto-join the player's booking.**

Locking a booking:
- hides it from other phones' Shared tab
- blocks manual joining
- blocks Auto-fill
- preserves the current participant list

Unlocking reopens remaining spots when capacity is available.

## Destination-local NPC shared stays

`Refresh community` can now create shared stays belonging to persistent local
NPCs from the destination.

Examples:
- Paris can surface local French NPC names
- Santorini/Athens can surface local Greek NPC names
- Tokyo can surface local Japanese NPC names
- Rome/Milan and Barcelona/Madrid have their own local pools
- other locations use a generic local pool

These NPCs only appear in **their own community shared bookings**.

They never get inserted into a booking created by Jack, Aurora, Eldin, etc.

Existing Greyhaven characters can still appear beside locals in community
bookings, including characters the current phone owner does not know.

## Airbnb — full stay details

Search cards are now tappable.

Stay details show:
- name
- location / address
- property type
- quality
- guest capacity
- bedrooms / bathrooms
- description
- host
- nightly price
- total for the current search dates
- Reserve
- Create shared stay
- Message host
- Save / unsave

Persistent Greyhaven Life short-stay properties still use the same underlying
asset rather than becoming duplicate locations.

## Airbnb — trip / booking details

Trips are tappable.

Stay booking details show:
- accommodation
- check-in / checkout
- private/shared type
- current lifecycle status
- price / split
- participants
- open spots
- host
- shared controls when creator
- leave booking when participant
- cancel reservation when creator
- delete record after cancellation/completion

Shared creators can remove an individual joined Greyhaven character without
cancelling the entire booking.

## Airbnb — cancellation and deletion

### Stay
Creator:
- Cancel reservation
- Delete record once cancelled/completed

Shared participant who is not the creator:
- Leave shared booking

### Travel
Ticket buyer:
- Cancel tickets
- Delete ticket record after cancellation or completion

Cancelled/completed items are kept under **Past & cancelled** until explicitly
deleted.

## Airbnb — host messaging

Stay and booking detail pages include **Message host**.

Sending is explicit.

The message is passed through the existing Greyhaven Phone / Greyhaven Life
world-action bridge so an existing-character host uses that identity and an NPC
host can become a persistent conversation counterpart.

No message is generated merely by viewing a property.

## Airbnb — lifecycle

Reservations now derive a lifecycle from Greyhaven RP time:

- Upcoming
- Check-in soon — within 3 hours
- Currently staying
- Checkout soon — within 3 hours
- Completed
- Cancelled

A one-time Airbnb reminder toast appears when the current participant reaches
the 3-hour check-in or checkout window.

This adds no background AI generation.

## Airbnb — trip plans

Trips now derive simple itineraries.

A stay is grouped with booked Plane / Ferry / Bus tickets when the route and
dates match the stay's destination and check-in / checkout window.

Example:

`Santorini · Aug 29–31`
- Villa des Fleurs
- inbound flight
- return ferry

The underlying stay and ticket records remain independent, so cancellation is
still handled correctly per item.

## Saved / Favorites

### Airbnb
Stays can be hearted from:
- search results
- stay details

A new **Saved** tab keeps those properties available after search refreshes.

### Garage
Vehicle market listings and vehicle detail pages can be hearted.

Garage now has:
- My vehicles
- Market
- Saved
- Rentals
- Service

### Property
Property market listings and property detail pages can be hearted.

Property now has:
- My places
- Market
- Saved
- Tenancy
- Agencies

Favorites are per Greyhaven identity rather than universal across every phone.

## Eventbrite

No extra Eventbrite features were added.

The Eventbrite UI block from v2.5.0 was verified unchanged before packaging.

## Tests completed

### JavaScript / CSS
- `loader.js` syntax — PASS
- `life-assets.js` syntax — PASS
- `travel-events.js` syntax — PASS
- `life-assets.css` brace balance — PASS
- `travel-events.css` brace balance — PASS

### Airbnb state
- Booking still enabled by default — PASS
- Eventbrite still opt-in — PASS
- Airbnb favorites add/remove — PASS
- shared booking Open default — PASS
- Auto-fill default OFF — PASS
- Auto-fill adds only existing Greyhaven characters — PASS
- NPC auto-join prevention for player bookings — PASS
- creator participant removal — PASS
- lock hides booking from Shared discovery — PASS
- lock blocks manual join — PASS
- unlock restores manual cross-phone joining — PASS
- Jack → Aurora manual join — PASS
- destination-local NPC community booking — PASS
- community refresh does not alter player's booking — PASS
- host-message world action — PASS
- upcoming/check-in/staying/checkout/completed lifecycle — PASS
- transport-to-stay itinerary linking — PASS
- transport cancellation/deletion — PASS
- reservation cancellation/deletion — PASS

### Life regression
- vehicle favorites — PASS
- property favorites — PASS
- Garage Saved UI — PASS
- Property Saved UI — PASS
- vehicle ownership transfer — PASS
- mechanic repair workflow — PASS
- property tenancy workflow — PASS

### Eventbrite
- existing event creation regression — PASS
- v2.5 Eventbrite UI block unchanged — PASS
