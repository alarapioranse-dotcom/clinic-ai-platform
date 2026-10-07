import { DatabaseError, type PoolClient } from 'pg';

/**
 * Internal to this feature — not exported from `./index.ts`. Nothing outside
 * `src/features/clinic/**` may import this module directly (CONTRIBUTING.md:
 * a feature never imports another feature's internals).
 *
 * `clinics` carries no Row Level Security by design (0003_clinics.sql), so the
 * read below filters by `id` explicitly — the same pattern
 * `src/features/appointments/repository.ts` uses to read a clinic's schedule.
 * The write is different: it never names a clinic at all. ADR-0022 routes it
 * through `set_clinic_settings`, which takes its target from the
 * transaction's `app.current_clinic_id`, so it can only ever reach the clinic
 * whose context `withTenantContext` set.
 */

export interface ClinicSettingsRow {
  id: string;
  name: string;
  workingHours: unknown;
  timezone: string;
}

export async function readClinicSettings(
  client: PoolClient,
  clinicId: string,
): Promise<ClinicSettingsRow | null> {
  const { rows } = await client.query<{
    id: string;
    name: string;
    working_hours: unknown;
    timezone: string;
  }>('SELECT id, name, working_hours, timezone FROM clinics WHERE id = $1', [clinicId]);
  const row = rows[0];
  return row
    ? { id: row.id, name: row.name, workingHours: row.working_hours, timezone: row.timezone }
    : null;
}

/** The database function refused the timezone (ADR-0022 decision 3's second check). */
export class DatabaseRejectedTimeZoneError extends Error {
  constructor() {
    super('The database does not recognise this time zone.');
    this.name = 'DatabaseRejectedTimeZoneError';
  }
}

/**
 * Calls `set_clinic_settings`. `null` leaves that setting unchanged; the
 * function rejects a call with both `null`. Must run inside
 * `withTenantContext` — without a tenant context the function raises and
 * writes nothing.
 */
export async function writeClinicSettings(
  client: PoolClient,
  workingHours: object | null,
  timezone: string | null,
): Promise<void> {
  try {
    await client.query('SELECT set_clinic_settings($1::jsonb, $2)', [
      workingHours === null ? null : JSON.stringify(workingHours),
      timezone,
    ]);
  } catch (err) {
    if (
      err instanceof DatabaseError &&
      err.code === '22023' &&
      err.message.includes('invalid timezone')
    ) {
      throw new DatabaseRejectedTimeZoneError();
    }
    throw err;
  }
}
