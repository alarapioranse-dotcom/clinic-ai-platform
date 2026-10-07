/**
 * Internal to this feature — not exported from `./index.ts` directly; the
 * public entry re-exports what other code may use. Pure functions only: no
 * database access.
 *
 * Application-side validation for ADR-0022 decision 3. The database function
 * (`set_clinic_settings`, db/migrations/0015) independently rejects a
 * timezone PostgreSQL does not recognise and any non-object working hours;
 * this module validates the full WorkingHours value object
 * (docs/domain/03-value-objects.md) before anything reaches the database.
 *
 * Encoding (the same one `src/features/appointments/schedule.ts` reads):
 * lowercase English weekday keys; each value is either `{ start, end }` in
 * 24-hour `HH:MM`, with start strictly before end (no midnight span), or
 * `null` for a closed day.
 */

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export interface DayHours {
  start: string;
  end: string;
}

/** Normalised form: every weekday key present, `null` meaning closed. */
export type ClinicWorkingHours = Record<Weekday, DayHours | null>;

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class InvalidWorkingHoursError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWorkingHoursError';
  }
}

export class InvalidTimeZoneError extends Error {
  constructor() {
    super('timezone must be a valid IANA time zone identifier.');
    this.name = 'InvalidTimeZoneError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates and normalises a WorkingHours value. Unknown keys (a day name
 * typo, an uppercase key, an extra field inside a day) are rejected rather
 * than ignored, so nothing the clinic did not intend is stored silently.
 * A weekday that is absent is treated as closed and normalised to `null`.
 */
export function parseWorkingHours(value: unknown): ClinicWorkingHours {
  if (!isPlainObject(value)) {
    throw new InvalidWorkingHoursError('workingHours must be an object keyed by weekday.');
  }

  for (const key of Object.keys(value)) {
    if (!(WEEKDAYS as readonly string[]).includes(key)) {
      throw new InvalidWorkingHoursError(`workingHours has an unknown day "${key}".`);
    }
  }

  const result = {} as ClinicWorkingHours;
  for (const day of WEEKDAYS) {
    const entry = value[day];
    if (entry === undefined || entry === null) {
      result[day] = null;
      continue;
    }
    if (!isPlainObject(entry)) {
      throw new InvalidWorkingHoursError(`${day} must be null (closed) or { start, end }.`);
    }
    const keys = Object.keys(entry).sort();
    if (keys.length !== 2 || keys[0] !== 'end' || keys[1] !== 'start') {
      throw new InvalidWorkingHoursError(`${day} must have exactly "start" and "end".`);
    }
    const { start, end } = entry;
    if (typeof start !== 'string' || !HHMM_PATTERN.test(start)) {
      throw new InvalidWorkingHoursError(`${day}.start must be HH:MM (24-hour).`);
    }
    if (typeof end !== 'string' || !HHMM_PATTERN.test(end)) {
      throw new InvalidWorkingHoursError(`${day}.end must be HH:MM (24-hour).`);
    }
    // Fixed-width HH:MM strings compare correctly as strings.
    if (start >= end) {
      throw new InvalidWorkingHoursError(`${day}.start must be before ${day}.end.`);
    }
    result[day] = { start, end };
  }
  return result;
}

let cachedTimeZones: readonly string[] | undefined;

/**
 * The IANA identifiers this server accepts, sorted: the runtime's own list
 * (`Intl.supportedValuesOf('timeZone')`) plus `UTC`, which that list omits.
 * Fixed numeric offsets such as `+02:00` are never accepted (ADR-0016). The
 * settings page receives this exact list from the server, so the choices
 * shown always match what the API accepts.
 */
export function supportedTimeZones(): readonly string[] {
  if (!cachedTimeZones) {
    cachedTimeZones = [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC'])].sort();
  }
  return cachedTimeZones;
}

export function parseTimeZone(value: unknown): string {
  if (typeof value !== 'string' || !supportedTimeZones().includes(value)) {
    throw new InvalidTimeZoneError();
  }
  return value;
}
