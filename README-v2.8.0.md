# Greyhaven Phone v2.8.0 — Life Integration Overhaul

This is an OVERLAY update for the existing Greyhaven-Phone repository.

Keep:
- index.js
- bridge.js
- style.css

Replace/add:
- manifest.json
- loader.js
- life-assets.js
- life-assets.css
- travel-events.js
- travel-events.css
- asset-context.js

## Main changes

### Consistent Phone chrome
Garage, Property, Airbnb and Eventbrite now render the same Phone status area / Dynamic Island treatment as the original Phone apps.

### Life folder
The Life folder remains an iPhone-style folder and now contains:
- Clock
- Garage
- Property

Clock uses Greyhaven Life as its backend and provides:
- current fictional time/date
- +15m
- +1h
- +4h
- next morning
- next day
- recurring schedule management
- schedule exceptions

The existing floating Greyhaven Life clock can open this Clock app directly.

### Private personal asset knowledge
A compact AI context bridge now exposes each relevant person's OWN authoritative facts:
- owned vehicles
- make/model/year
- color and plate where present
- active rented vehicle
- property ownership
- tenants on property they own
- residence / tenancy
- landlord
- personal rent share
- co-tenants

Privacy rule:
A person naturally knows their own facts.
Another character does not automatically know someone else's private plate/rent/property facts unless RP establishes it.

### Existing features preserved
The update builds on the current Phone core and keeps Contacts, Messages, social apps,
Marketplace, Uber, Domino's, Dark Web, Photos, Calendar, Notes, settings, identity cleanup,
Garage markets/rentals/service, Property ownership/tenancy/agencies, Airbnb, Eventbrite,
chat-local travel/event state, universal vehicle/property state, host chats, and equal-rent split fixes.

## Dependency
Use together with Greyhaven Life v1.7.0 Slim.
