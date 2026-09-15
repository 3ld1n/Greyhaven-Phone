# Greyhaven Phone v2.8.0 — Life Overhaul

This is a focused patch on top of Greyhaven Phone v2.7.1. It keeps the existing Phone, social apps, Airbnb shared-booking logic, Airbnb internal Chats, Garage/Property markets, identity cleanup, tenancy/rent splitting, and all other v2.7.1 behavior.

## 1. Consistent Phone chrome

Garage, Property, Airbnb and Eventbrite now use the same internal Phone status bar / Dynamic Island visual language as the original Phone apps such as Instagram and Messages.

The fictional RP clock appears in the add-on app status bar and updates from Greyhaven Life.

## 2. Life folder now contains Clock

The iPhone-style Life folder now contains:
- Clock
- Garage
- Property

Clock has three tabs:

### Now
- exact fictional time/date
- +15 minutes
- +1 hour
- +4 hours
- Next morning
- Next day
- direct date/time setting

### Schedules
- choose a SillyTavern character/persona
- view active schedule
- add/edit/delete global recurring routines or obligations
- schedule fields no longer require a location

### Exceptions
- Day off
- Vacation
- Sick day
- Leave
- Cancelled schedule
- Custom exception

These are per RP chat and can suppress normal recurring schedules.

Requires Greyhaven Life v1.7.0 for the Slim schedule APIs.

## 3. Characters know their own Garage / Property facts

`asset-context.js` adds a compact private self-knowledge prompt.

A character can naturally know their own:
- owned vehicle model/year/color/plate
- current vehicle rental
- owned properties and their tenants
- rental home/address
- landlord/owner
- personal monthly rent share
- co-tenants

This does **not** automatically give another character somebody else’s private car/property facts.

## 4. Existing v2.7.1 behavior preserved

This patch does not intentionally change:
- Airbnb internal host Chats
- shared stay locking/auto-fill/manual join
- chat-specific Booking/Trips/Eventbrite state
- universal vehicle/property state
- equal rent split
- stale Phone identity cleanup
- Garage/Property saved favorites
- service/repair workflows
- property tenancy/ownership transfers

## Important: this ZIP is a PATCH

Your repository already contains the large core files. Keep them.

Replace/add only:
- `manifest.json`
- `loader.js`
- `life-assets.js`
- `life-assets.css`
- `travel-events.js`
- `travel-events.css`
- `asset-context.js`
- `README.md`

KEEP these existing files in the repository:
- `index.js`
- `bridge.js`
- `style.css`

## Clean up the old README files

After confirming v2.8.0 is installed, you can delete these old update notes from the repository root:

- `README-v2.4.0.md`
- `README-v2.4.1.md`
- `README-v2.5.0.md`
- `README-v2.6.0.md`
- `README-v2.7.0.md`
- `README-v2.7.1.md`

Keep only the new `README.md`.

A clean Greyhaven-Phone root should contain the normal core files plus:

- `README.md`
- `manifest.json`
- `loader.js`
- `bridge.js`
- `index.js`
- `style.css`
- `life-assets.js`
- `life-assets.css`
- `travel-events.js`
- `travel-events.css`
- `asset-context.js`

Do not upload old ZIP files or extracted version folders into the extension repository.

## Tests completed

- `loader.js` syntax: PASS
- `life-assets.js` syntax: PASS
- `travel-events.js` syntax: PASS
- `asset-context.js` syntax: PASS
- Life Clock is wired into the Life folder: PASS
- Slim schedule/exception API is consumed: PASS
- Garage/Property add-on status bar exists: PASS
- Airbnb/Eventbrite add-on status bar exists: PASS
- CSS brace validation: PASS
- private self Garage/Property knowledge prompt: PASS

The final iPhone/PWA visual spacing still needs one real-device smoke test after installation because automated tests cannot reproduce every Safari safe-area behavior.
