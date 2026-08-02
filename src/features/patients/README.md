# patients

Empty by design in Phase 0.

Will own patient records scoped to a clinic: identity, contact channels, and
history needed by appointments and conversations.

## Rules

- This feature computes; routes and components compose it, not the other way
  around.
- No other feature (`appointments`, `knowledge-base`, `conversations`) may
  import from this feature's internals. Only its public entry point, once one
  exists, is a valid import target.
- `process.env` is never read here — configuration comes from `src/lib/env.ts`.
