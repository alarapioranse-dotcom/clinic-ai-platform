# appointments

Empty by design in Phase 0.

Will own scheduling logic: matching a patient's request to available clinic
slots, holding/confirming bookings, and cancellation/rescheduling rules.

## Rules

- This feature computes; routes and components compose it, not the other way
  around.
- No other feature (`patients`, `knowledge-base`, `conversations`) may import
  from this feature's internals. Only its public entry point, once one exists,
  is a valid import target.
- `process.env` is never read here — configuration comes from `src/lib/env.ts`.
