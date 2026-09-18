/**
 * Pure computation only — no database access, no `withTenantContext`. Per
 * the P4 Slice 1 mandate's "Clearly separate: schedule persistence;
 * availability computation; authoritative appointment booking," this module
 * is the availability-computation layer; `repository.ts` is schedule
 * persistence (reading `clinics.working_hours` /
 * `staff_members.working_hours`) and appointment persistence; `index.ts`
 * orchestrates both behind the feature's public entry point.
 *
 * No new schedule table: `docs/domain/03-value-objects.md`'s WorkingHours
 * value object ("for each day, either a single open interval... or a marker
 * that the Clinic is closed that day") is already persisted JSONB on
 * `clinics.working_hours` and `staff_members.working_hours`
 * (0003_clinics.sql, 0005_staff_members.sql) — nothing in P1-P3 ever wrote
 * to either column, so this module is the first code to define the JSON
 * shape those columns hold. That shape is a technical-design decision for
 * this slice (same status as ADR-0014's own "specific enforcement
 * mechanism... is a technical-design decision for the P4 migration"), not a
 * one-way-door decision requiring its own ADR: it only fixes how an already-
 * Accepted value object is encoded as JSON, not any new business rule.
 *
 * Day keys are lowercase English weekday names. Each value is either a
 * `{ start, end }` window in "HH:MM" 24-hour form, or `null`/absent for a
 * closed day. These start/end times are currently interpreted directly as
 * UTC wall-clock times — this slice does not model an IANA zone per clinic
 * or convert between clinic-local and UTC time.
 *
 * That UTC-literal reading is interim behavior, not settled design:
 * `docs/adr/0016-clinic-working-hours-iana-timezone.md` (ADR-0016, Proposed
 * — not yet Accepted) records that a clinic-local IANA-timezone
 * interpretation is required instead, as a one-way-door decision this
 * module's current behavior does not yet implement. Nothing here changes
 * until ADR-0016 is Accepted and its implementation lands as its own,
 * separately authorized change.
 */

export type WeekdayKey =
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

const WEEKDAY_KEYS: readonly WeekdayKey[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export interface DayWindow {
  start: string;
  end: string;
}

export type WorkingHoursJson = Partial<Record<WeekdayKey, DayWindow | null>>;

export interface TimeSlot {
  startsAt: Date;
  endsAt: Date;
}

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseHHMM(value: string): number | null {
  const match = HHMM_PATTERN.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

/**
 * Returns the UTC day boundaries for a `YYYY-MM-DD` date string. Throws for
 * a malformed or non-existent (e.g. "2026-02-30") date — callers validate
 * the date format at the API boundary before reaching this, same convention
 * as `UUID_PATTERN` checks in the existing route handlers.
 */
export function dayBoundsUtc(date: string): { dayStart: Date; dayEnd: Date } {
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`Invalid date: expected YYYY-MM-DD, got "${date}"`);
  }
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dayStart.getTime()) || dayStart.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid date: "${date}" is not a real calendar date`);
  }
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

/**
 * Resolves which `DayWindow` (if any) applies on `date`, per the WorkingHours
 * value object's own invariant: either a single open interval or closed —
 * never ambiguous. Returns `null` for a closed day, a missing entry, or a
 * malformed window (fail closed to "no availability," never throw — a
 * clinic's own bad data should never crash the availability read).
 */
export function getWindowForDate(workingHours: WorkingHoursJson, date: string): DayWindow | null {
  const { dayStart } = dayBoundsUtc(date);
  const weekday = WEEKDAY_KEYS[dayStart.getUTCDay()];
  const window = workingHours[weekday!];
  if (!window) return null;

  const startMinutes = parseHHMM(window.start);
  const endMinutes = parseHHMM(window.end);
  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    return null;
  }
  return window;
}

/**
 * Walks a working-hours window in fixed `durationMinutes` steps starting
 * from the window's open time, skipping any candidate slot that overlaps a
 * busy interval. Deterministic and stateless — the same inputs always
 * produce the same slots — which is what makes this "advisory" (P4 Design
 * Gate's Booking section): it is a read of a snapshot, not a reservation,
 * and the caller (repository/index.ts) never treats its output as
 * authoritative. Half-open per ADR-0014 point 7: a candidate slot and a busy
 * interval overlap only when `slot.start < busy.end && slot.end >
 * busy.start`, so a slot butting exactly against a busy interval's boundary
 * is not excluded.
 */
export function computeAvailableSlots(
  window: DayWindow | null,
  date: string,
  durationMinutes: number,
  busyIntervals: readonly TimeSlot[],
): TimeSlot[] {
  if (!window || !Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return [];
  }

  const startMinutes = parseHHMM(window.start);
  const endMinutes = parseHHMM(window.end);
  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    return [];
  }

  const { dayStart } = dayBoundsUtc(date);
  const windowStart = new Date(dayStart.getTime() + startMinutes * 60_000);
  const windowEnd = new Date(dayStart.getTime() + endMinutes * 60_000);
  const stepMs = durationMinutes * 60_000;

  const slots: TimeSlot[] = [];
  let cursor = windowStart.getTime();
  while (cursor + stepMs <= windowEnd.getTime()) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(cursor + stepMs);
    const overlapsBusy = busyIntervals.some(
      (busy) => slotStart < busy.endsAt && slotEnd > busy.startsAt,
    );
    if (!overlapsBusy) {
      slots.push({ startsAt: slotStart, endsAt: slotEnd });
    }
    cursor += stepMs;
  }
  return slots;
}
