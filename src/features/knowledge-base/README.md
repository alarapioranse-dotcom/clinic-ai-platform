# knowledge-base

Empty by design in Phase 0.

Will own each clinic's knowledge source — services, pricing, hours, and
policies — used to ground automated replies to patients.

## Rules

- This feature computes; routes and components compose it, not the other way
  around.
- No other feature (`appointments`, `patients`, `conversations`) may import
  from this feature's internals. Only its public entry point, once one exists,
  is a valid import target.
- `process.env` is never read here — configuration comes from `src/lib/env.ts`.
