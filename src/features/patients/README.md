# patients

Owns patient records scoped to a clinic: identity and contact channel. This
is the first feature with a real implementation (roadmap P1's acceptance
criterion), added as the smallest slice proving tenant isolation at the data
layer — see `docs/adr/0006-rls-tenant-context-propagation.md` and
`docs/technical/02-tenant-isolation-testing.md`.

## Current scope (P1 foundation slice)

- `createPatient(clinicId, input)` — insert a patient for one clinic.
- `getPatientsForClinic(clinicId)` — list patients visible to one clinic.

Both run inside a transaction scoped to `clinicId` via `withTenantContext`
(`src/lib/db.ts`); Row Level Security on the `patients` table is the actual
isolation boundary, not application-side filtering (charter §5).

**Not yet implemented** (later phases, not this slice): update/delete,
search, the `/api/patients` HTTP endpoints in
`docs/technical/03-api-contracts.md` (they require an authenticated staff
session — P2), and Article 17 erasure (ADR-0005).

## Rules

- This feature computes; routes and components compose it, not the other way
  around.
- No other feature (`appointments`, `knowledge-base`, `conversations`) may
  import from this feature's internals. `./index.ts` is the only valid import
  target — `./repository.ts` is internal.
- `process.env` is never read here — configuration comes from `src/lib/env.ts`,
  consumed indirectly via `src/lib/db.ts`.
- No patient authentication: a Patient record is never granted a session or
  credentials (`docs/technical/04-auth-implementation.md`).
