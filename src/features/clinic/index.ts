/**
 * Public entry point for the `clinic` feature. Only this module — never
 * `./repository` or `./validation` — is a valid import target for other
 * features or for `src/app/**` route/page code.
 *
 * Scope (ADR-0022, Accepted; Owner decisions S1–S5): a clinic's working hours
 * and IANA timezone, read and written by its owner or admin. Services,
 * prices, per-practitioner hours, contact details, name and status are not
 * writable here.
 *
 * Writes go only through the database function `set_clinic_settings`
 * (db/migrations/0015), inside `withTenantContext`, so the only row a call
 * can change is the clinic its own tenant context names.
 */
import { withTenantContext } from '@/lib/db';
import {
  readClinicSettings,
  writeClinicSettings,
  DatabaseRejectedTimeZoneError,
} from './repository';
import {
  WEEKDAYS,
  parseTimeZone,
  parseWorkingHours,
  supportedTimeZones,
  InvalidTimeZoneError,
  InvalidWorkingHoursError,
  type ClinicWorkingHours,
  type DayHours,
  type Weekday,
} from './validation';

export {
  WEEKDAYS,
  parseTimeZone,
  parseWorkingHours,
  supportedTimeZones,
  InvalidTimeZoneError,
  InvalidWorkingHoursError,
};
export type { ClinicWorkingHours, DayHours, Weekday };

/**
 * Roles that may open `/dashboard/settings/clinic` and call
 * `PATCH /api/clinic` (docs/product/04-sitemap.md,
 * docs/technical/03-api-contracts.md; Owner decision S4). The API is the
 * authorization boundary; the page and the navigation link repeat it.
 */
export const CLINIC_SETTINGS_MANAGER_ROLES: ('owner' | 'admin')[] = ['owner', 'admin'];

export interface ClinicSettings {
  id: string;
  name: string;
  timezone: string;
  workingHours: ClinicWorkingHours;
}

export class ClinicNotFoundError extends Error {
  constructor() {
    super('Clinic not found.');
    this.name = 'ClinicNotFoundError';
  }
}

/**
 * Normalises whatever is stored for display. A day whose stored value is not
 * a valid window is shown as closed — the same fail-closed reading the
 * availability computation already applies to it
 * (`src/features/appointments/schedule.ts`'s `getWindowForDate`).
 */
function toDisplayWorkingHours(stored: unknown): ClinicWorkingHours {
  const source =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const result = {} as ClinicWorkingHours;
  for (const day of WEEKDAYS) {
    try {
      result[day] = parseWorkingHours({ [day]: source[day] ?? null })[day];
    } catch {
      result[day] = null;
    }
  }
  return result;
}

export async function getClinicSettings(clinicId: string): Promise<ClinicSettings> {
  const row = await withTenantContext(clinicId, (client) => readClinicSettings(client, clinicId));
  if (!row) {
    throw new ClinicNotFoundError();
  }
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    workingHours: toDisplayWorkingHours(row.workingHours),
  };
}

export interface UpdateClinicSettingsInput {
  workingHours?: ClinicWorkingHours;
  timezone?: string;
}

/**
 * Writes the given settings for `clinicId` and returns the stored result.
 * Inputs must already be validated (`parseWorkingHours` / `parseTimeZone`);
 * the database re-checks the timezone and rejects one it does not know with
 * `InvalidTimeZoneError`. The write and the read-back share one transaction.
 */
export async function updateClinicSettings(
  clinicId: string,
  input: UpdateClinicSettingsInput,
): Promise<ClinicSettings> {
  if (input.workingHours === undefined && input.timezone === undefined) {
    throw new Error('updateClinicSettings needs workingHours and/or timezone.');
  }

  try {
    const row = await withTenantContext(clinicId, async (client) => {
      await writeClinicSettings(client, input.workingHours ?? null, input.timezone ?? null);
      return readClinicSettings(client, clinicId);
    });
    if (!row) {
      throw new ClinicNotFoundError();
    }
    return {
      id: row.id,
      name: row.name,
      timezone: row.timezone,
      workingHours: toDisplayWorkingHours(row.workingHours),
    };
  } catch (err) {
    if (err instanceof DatabaseRejectedTimeZoneError) {
      throw new InvalidTimeZoneError();
    }
    throw err;
  }
}
