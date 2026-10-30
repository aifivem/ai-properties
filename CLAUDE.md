# ai-properties

Houses and apartments bought at their door: a private copy of the interior per property (routing bucket), a stash, keys for other characters, selling back, police entry. Depends on ai-core (characters, money, metadata, menu, prompts); uses the active inventory through ai-core's inventory layer (lib `inventory`) for the stash. Research: `docs/research/ai-properties.md`.

## Decisions

- Ownership and keys live in server memory (loaded once) and the DB; the owned flag of each property is GlobalState `prop:<id>`; a player's own access is the `mine` snapshot, then `access` deltas.
- Routing buckets 5000 + n per property (ai-core and ai-appearance use 50000+).
- The property a character is inside is ai-core metadata `property`; at `playerLoaded` such a character is moved to the door in bucket 0.
- Only the owner (inside the property) manages keys and sells; key holders enter and open the stash `property_<id>`.

## Contracts

- Events and callbacks: `resource/common/property.ts`. GlobalState `prop:<id>`. Metadata `property`. Tables `ai_properties_owned`, `ai_properties_keys` (`sql/main.sql`).

## Entry points

- Actions and buckets `resource/server/index.ts`, ownership store `resource/server/store.ts`; doors, blips and the inside menu `resource/client/index.ts`.
