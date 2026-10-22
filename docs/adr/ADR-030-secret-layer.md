# ADR-030: Keeping the secret layer away from players

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tasks:** T-0503
- **Refines:** specs §9.1, §9.3, NFR-08, FR-SHEET-04

## Context

Secret fields live in a separate `actor:<id>:secret` document, which only GMs and assistants can open (§9.3, ADR-028). Since T-0502, though, a store merges both layers into the `actors.system` projection. That projection is read by more than the collab socket:

- the REST actor and item views send `system` to every member who can see the entity;
- typed roll formulas read the actor's data.

Without a filter, a player could read secret fields through either path.

## Decision

1. **Secret documents exist only where the schema declares secret fields (§9.1).** For a type with no `x-layer: "secret"` field, `actor:<id>:secret` is refused like a document the user cannot open. While the system cannot describe the type, the document stays reachable, read-only, for GMs and assistants.
2. **Views filter by role.** `toActorView` and `toItemView` take a `DataFilter`, built by `dataFilter(definition, role)`:
   - GMs and assistants see everything.
   - Everyone else sees the `main` part of `splitLayers(documentLayout(schema), system)`.
   - When the system no longer declares the type, nobody knows which fields are secret, so non-GMs get `{}`.

   Every route has to pass a filter, so a new route can't forget it.

3. **A player's typed formulas cannot reach secret fields.**
   - They run against the visible data.
   - They also run against `playerDefinition(plugin)`, the plugin with secret fields removed from every type schema (`withoutSecrets`). Without that step, `withDefaults` would fill a secret field back in with its default.
   - `@gmNotes` from a player is therefore an `unknown_reference`, the same error as a field that doesn't exist, so it reveals nothing.
4. **Wire-level test.** In `apps/server/test/secrets.test.ts`:
   - a player socket opens the main document and tries the secret one before and after the GM writes a marker into it;
   - the test asserts that no frame the player receives contains the marker's bytes;
   - a second GM socket does receive the marker, which proves the check would catch a leak.

## Consequences

- Tables whose system is unavailable show players no plugin data in listings. Their sheets are read-only anyway (FR-PLUGIN-07).
- `entity.changed` events carry only ids, so they need no filter.
- Plugin-defined recipes run with the full definition for anyone. Recipes are the author's code and may read secret fields on purpose, for example a hidden DC. What the card shows is the plugin's choice.
