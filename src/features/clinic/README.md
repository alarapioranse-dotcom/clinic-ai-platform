# clinic

Owns the clinic's own settings: working hours and IANA timezone.

## Current scope (ADR-0022)

- `getClinicSettings(clinicId)` — id, name, timezone and the normalised
  working hours (every weekday present; `null` = closed).
- `updateClinicSettings(clinicId, { workingHours?, timezone? })` — writes
  through the database function `set_clinic_settings`
  (`db/migrations/0015_clinic_settings_function.sql`), never through a direct
  `UPDATE`. The function takes no clinic id: it targets the row named by the
  transaction's `app.current_clinic_id` and fails closed without it.
  `app_user` holds no `UPDATE` privilege on `clinics`.
- `parseWorkingHours` / `parseTimeZone` — application-side validation of the
  WorkingHours value object (`docs/domain/03-value-objects.md`) and of the
  timezone against `supportedTimeZones()`. The database re-checks the timezone
  independently.
- `CLINIC_SETTINGS_MANAGER_ROLES` — owner and admin.

HTTP: `GET /api/clinic` (any signed-in staff, per
`docs/technical/03-api-contracts.md`) and `PATCH /api/clinic` (owner, admin).
Screen: `/dashboard/settings/clinic` (owner, admin).

## Not in scope

Services, prices, per-practitioner hours, contact details, clinic name and
status. Each needs its own decision (ADR-0022 decision 4). `PATCH /api/clinic`
rejects a `services` field.
