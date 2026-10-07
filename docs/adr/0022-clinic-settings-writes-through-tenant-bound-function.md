# 0022 — Clinic settings are written only through a tenant-bound database function

## Status

Proposed

## Date

2026-10-07

## Phase

P2 — Authentication and authorization (see [`docs/03-roadmap.md`](../03-roadmap.md)).
`docs/product/05-screen-inventory.md` places `/dashboard/settings/clinic` at "P1 (data) / P2
(editable once authenticated)"; the data exists, the edit path does not. Building it now is pilot
readiness for an already-closed phase, not new scope.

## Context

A clinic's working hours (`clinics.working_hours`) and IANA timezone (`clinics.timezone`,
[ADR-0016](./0016-clinic-working-hours-iana-timezone.md)) drive availability and booking, but
nothing in the application can change them: today they are set only by migrations and test
fixtures. A real clinic needs its owner or admin to edit them
(`docs/product/06-acceptance-criteria.md`, `/dashboard/settings/clinic`).

`clinics` is the tenant itself and deliberately carries **no Row Level Security**
(`db/migrations/0003_clinics.sql`: a clinic must be able to find its own row before any
`app.current_clinic_id` context exists). `app_user` holds only a column-restricted `SELECT` on it;
`INSERT` was revoked in `0008_revoke_clinics_insert.sql`, and there is no `UPDATE`.

Every other tenant-scoped write in this schema is isolated by RLS + FORCE RLS
([ADR-0003](./0003-multi-tenancy-model.md), [ADR-0006](./0006-rls-tenant-context-propagation.md)): a bug in
application code cannot write another clinic's rows, because the database rejects it. A plain
`GRANT UPDATE` on `clinics` to `app_user` would be the first tenant-scoped write in the system with
no database-level isolation — isolation would rest entirely on every caller writing
`WHERE id = <session clinic>` correctly, forever. That is costly to reverse once relied on, and
security-relevant, so it is recorded here before any migration.

## Decision

1. **`app_user` gets no `UPDATE` privilege on `clinics`.** Not table-wide and not column-scoped.
2. **Clinic settings are written only through one database function**, for example
   `set_clinic_settings(p_working_hours jsonb, p_timezone text)`, that:
   - takes **no clinic identifier as an argument**: it derives the target row solely from
     `current_setting('app.current_clinic_id', true)`, the same transaction-local tenant context
     every RLS policy uses ([ADR-0006](./0006-rls-tenant-context-propagation.md));
   - raises an error, and updates nothing, when that context is absent or empty (fail closed);
   - updates exactly `working_hours`, `timezone` and `updated_at` on that one row, and nothing
     else;
   - is `SECURITY DEFINER` with a pinned `search_path`;
   - is owned by a dedicated `NOLOGIN` role that holds only column-scoped `UPDATE` on
     `working_hours`, `timezone` and `updated_at`, plus the `SELECT` it needs on `clinics` —
     never by `app_user`, and never by a role with `SUPERUSER` or `BYPASSRLS`;
   - has `EXECUTE` revoked from `PUBLIC` and granted to `app_user` only.
3. **Validation happens in both places.** The application validates the WorkingHours value object
   (`docs/domain/03-value-objects.md`: per day either one open interval with start before end and
   no midnight span, or closed; `HH:MM` 24-hour; lowercase English weekday keys) and the timezone
   (a valid IANA identifier). The function independently rejects a timezone PostgreSQL does not
   recognise, so a bad value cannot be stored through any caller.
4. **Scope of the settings write is working hours and timezone only.** Services, prices,
   per-practitioner hours, contact details, name and status are not writable through this
   function. Each would be its own decision; services in particular wait on the structured
   clinic-knowledge decision.
5. Changing a clinic's timezone is allowed. Appointments are stored as absolute UTC instants
   (ADR-0016), so existing bookings are unaffected; only the meaning of the working-hours
   wall-clock values changes, which is the intended effect.

## Consequences

- Cross-clinic writes to `clinics` are impossible at the database level: a request can only ever
  update the row matching the tenant context its own transaction set, and code that forgets to set
  the context fails instead of writing.
- One more reviewed `SECURITY DEFINER` function and one more `NOLOGIN` role exist, following the
  precedent of the authentication bootstrap functions
  (`db/migrations/0007_auth_bootstrap_functions.sql`). Both are defined only in version-controlled
  migrations.
- The implementing migration (`0015`) needs the Owner's approval before it is written, and its
  production application is a separate, Owner-approved step through the repository runner.
- Tests must prove, against PostgreSQL: the function updates only the context clinic's row; it
  fails with no context; `app_user` cannot `UPDATE clinics` directly; `PUBLIC` cannot execute it;
  an invalid timezone is rejected.
- `PATCH /api/clinic` in `docs/technical/03-api-contracts.md` is implemented for `workingHours`
  and `timezone` only; its `services` part stays unimplemented until a later decision.

## Alternatives considered

- **Column-scoped `GRANT UPDATE (working_hours, timezone)` to `app_user`, guarded in application
  code by `WHERE id = $sessionClinicId`.** Simplest, but isolation depends on every present and
  future caller; one missed or wrong predicate silently edits another clinic. Rejected as the only
  tenant write without a database backstop.
- **Enable RLS on `clinics` with an UPDATE policy keyed on `app.current_clinic_id`.** Would also
  constrain reads and conflicts with the documented need to look up a clinic before tenant context
  exists (`0003_clinics.sql`, the sign-in path). Rejected; the function achieves the same write
  isolation without changing how `clinics` is read.
- **Move settings into a separate RLS-protected table.** Duplicates columns that availability
  already reads from `clinics` (ADR-0016) and adds a migration of existing data for no isolation
  gain over the function. Rejected.
