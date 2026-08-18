# Greyhaven Phone v2.7.1 — Identity, Rent Split & Airbnb Chat Fixes

This is a focused patch for v2.7.0. It adds no new apps and no AI-usage feature.

## 1. Deleted/stale Greyhaven Phone identities can be removed again

Greyhaven Phone Manager now separates current character/persona identities from stale global identity records.

A new section appears:

**Old / deleted character identities**

Each safe stale row shows its old name, old persistent 9-digit number, and a red **Delete** button.

Deleting one:
- removes the old global identity and number
- removes stale social/profile/service references
- removes stale mechanic/agency links
- removes it from Life selectors
- cleans current-chat phone metadata references
- does NOT delete or modify a current SillyTavern character/persona
- refuses deletion if the identity still owns an actual phone record; delete/reassign that phone first

Life dropdowns (agency, owner, mechanic, etc.) now show only current SillyTavern character-card identities plus the current persona. Deleted characters such as an old full-name version no longer remain selectable just because their Phone identity registry survived.

No character cards are bundled in v2.7.1, and this patch does not recreate the previously supplied last-name characters.

## 2. Equal rent really splits the total

`Monthly rent` is treated as the property/household total.

With:
- total rent = €900
- split = Equal
- tenants = Leo + Rozafa

the result is now:
- Leo = €450/month share
- Rozafa = €450/month share

The property detail also shows:
- total monthly rent
- each tenant's calculated share
- number of rent payers

Existing equal-split properties are normalized automatically when opened; you do not need to recreate them.

If untracked housemates are included in an equal rent split, they count as rent payers too.

## 3. Airbnb now has its own Chats tab

The v2.7 native Greyhaven Messages handoff has been removed because it could repeatedly open/close the phone Messages UI on iPhone.

Airbnb now contains a real **Chats** tab.

From a stay or booked trip:
- tap **Message host**
- Airbnb opens the internal host conversation immediately
- send/read messages there
- return to the Chats tab later to reopen the conversation
- the chat belongs to the current persona and current RP chat only

The old popup → Messages app → repeated reopen/close route is completely removed.

### Host replies

For a full SillyTavern character host:
- the normal character description/personality/scenario are supplied to the bounded host-chat generation

For a generated Airbnb NPC host:
- the stay/property facts are supplied instead

Each user message requests at most one short host reply.
There is no retry loop. If the currently selected AI returns an empty/error response, Airbnb inserts a small deterministic fallback host response instead of creating an empty chat message.

## Unchanged

- cars/properties/ownership remain universal across chats
- Booking/Trips/host chats/Eventbrite remain chat-specific timeline data
- shared-stay pricing/locking/auto-fill behavior is unchanged
- Eventbrite features remain unchanged
- Garage/Property markets remain unchanged
- no AI usage tracker
- no additional apps

## Regression tests

PASS:
- loader.js syntax
- life-assets.js syntax
- travel-events.js syntax
- stale deleted identity excluded from Life selectors
- stale identity appears in deletion list
- current character identity is protected
- stale global identity + number deletion
- stale mechanic reference cleanup
- €900 equal rent / 2 tenants = €450 each
- Airbnb internal host thread creation
- Airbnb Chats tab render
- bounded internal host reply generation
- old native Messages routing references removed
