# appointments

Roadmap P4 Slice 1: computes available slots from persisted schedule data
(`clinics.working_hours` / `staff_members.working_hours`) plus existing
appointment state, and owns booking an appointment — optionally linked to
its originating conversation.

- `schedule.ts` — pure availability computation (no database access).
- `repository.ts` — schedule reads and appointment persistence. Internal;
  not exported from `index.ts`.
- `index.ts` — the feature's only valid import target for other code:
  `getAvailableSlots`, `listPractitionersForClinic`, `bookAppointment`.

No `available_slots` table and no clinic-local timezone architecture (P4
addendum S1) — see `db/migrations/0011_appointments.sql` and `schedule.ts`
for what that does and doesn't mean.

## Rules

- This feature computes; routes and components compose it, not the other way
  around.
- No other feature (`patients`, `knowledge-base`, `conversations`) may import
  from this feature's internals. Only `./index.ts` is a valid import target.
- `process.env` is never read here — configuration comes from `src/lib/env.ts`.
