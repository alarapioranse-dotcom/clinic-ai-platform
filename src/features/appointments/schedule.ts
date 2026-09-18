/**
 * Pure computation only — no database access, no `withTenantContext`. Per
 * the P4 Slice 1 mandate's "Clearly separate: schedule persistence;
 * availability computation; authoritative appointment booking," this module
 * is the availability-computation layer; `repository.ts` is schedule
 * persistence (reading `clinics.working_hours` / `clinics.timezone` /
 * `staff_members.working_hours`) and appointment persistence; `index.ts`
 * orchestrates both behind the feature's public entry point.
 *
 * No new schedule table: `docs/domain/03-value-objects.md`'s WorkingHours
 * value object ("for each day, either a single open interval... or a marker
 * that the Clinic is closed that day") is already persisted JSONB on
 * `clinics.working_hours` and `staff_members.working_hours`
 * (0003_clinics.sql, 0005_staff_members.sql) — this module defines the JSON
 * shape those columns hold. That shape is a technical-design decision for
 * this slice (same status as ADR-0014's own "specific enforcement
 * mechanism... is a technical-design decision for the P4 migration"), not a
 * one-way-door decision requiring its own ADR: it only fixes how an already-
 * Accepted value object is encoded as JSON, not any new business rule.
 *
 * Day keys are lowercase English weekday names. Each value is either a
 * `{ start, end }` window in "HH:MM" 24-hour form, or `null`/absent for a
 * closed day.
 *
 * Per `docs/adr/0016-clinic-working-hours-iana-timezone.md` (ADR-0016,
 * Accepted): these start/end times are clinic-local wall-clock times, read
 * in the owning clinic's own IANA timezone (`clinics.timezone`,
 * 0012_clinic_timezone.sql) — never UTC-literal and never a fixed numeric
 * offset (ADR-0016 decision items 1, 2, 4). `localWindowToUtcInstants`
 * below is the conversion; `computeAvailableSlots` is the only caller that
 * needs it, since `getWindowForDate` only resolves which window (if any)
 * applies on a calendar date, which does not depend on timezone at all — a
 * given `YYYY-MM-DD` is the same weekday regardless of the reader's zone.
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
 *
 * Plain UTC-calendar-day boundaries, not clinic-local ones — kept as a
 * general-purpose utility and as `zonedDayBoundsUtc`'s own invalid-timezone
 * fallback below. The appointments read path uses `zonedDayBoundsUtc`, not
 * this function, for anything clinic-facing.
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
 *
 * Weekday-only, deliberately no timezone parameter: which weekday `date`
 * falls on does not depend on any reader's or clinic's timezone.
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
 * Same format/realness validation as `dayBoundsUtc`, but returns calendar
 * components instead of a `Date` pinned to UTC midnight — the zoned
 * conversion functions below need the former, not the latter. Deliberately
 * not shared with `dayBoundsUtc`'s own implementation, so that function's
 * existing behavior and tests stay untouched by anything below.
 */
function parseCalendarDate(date: string): { year: number; month: number; day: number } {
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`Invalid date: expected YYYY-MM-DD, got "${date}"`);
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date: "${date}" is not a real calendar date`);
  }
  return { year, month, day };
}

/** Pure calendar-date arithmetic (no timezone involved): the date after `year`-`month`-`day`. */
function nextCalendarDate(
  year: number,
  month: number,
  day: number,
): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

/**
 * True iff `timeZone` is a timezone identifier the platform's own ICU/tzdata
 * recognizes (`Intl.DateTimeFormat` throws `RangeError` for anything else) —
 * per ADR-0016 decision item 6, this is never a hand-maintained list.
 */
export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    void new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** `instant`'s wall-clock date/time as observed in `timeZone`. Assumes `timeZone` is valid. */
function zonedParts(instant: number, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(instant));
  const value = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

/** How far `timeZone`'s wall clock is ahead of UTC at real instant `instant`, in milliseconds. */
function offsetMsAt(instant: number, timeZone: string): number {
  const zp = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(zp.year, zp.month - 1, zp.day, zp.hour, zp.minute, 0);
  return asUtc - instant;
}

function zonedWallClockToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const naiveMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  return naiveMs - offsetMsAt(naiveMs, timeZone);
}

function wallClockMatches(
  candidateMs: number,
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): boolean {
  const zp = zonedParts(candidateMs, timeZone);
  return (
    zp.year === year &&
    zp.month === month &&
    zp.day === day &&
    zp.hour === hour &&
    zp.minute === minute
  );
}

/** Wider than any real single DST shift (the tzdata rules this platform ships all use one hour). */
const DST_TRANSITION_MARGIN_MS = 2 * 60 * 60 * 1000;

/**
 * Resolves a clinic-local wall-clock date+time to the single absolute
 * instant it denotes in `timeZone` (ADR-0016 decision items 2 and 6).
 * Returns `null` when there is no single well-defined instant:
 *  - the wall-clock time does not exist on this date in this zone (a
 *    spring-forward DST gap skips over it), or
 *  - the wall-clock time occurs twice (a fall-back DST overlap repeats it),
 *    or
 *  - `timeZone` isn't a recognized IANA identifier at all.
 *
 * A working-hours boundary landing exactly inside a DST transition is rare
 * but real; this module has no policy for choosing among ambiguous instants
 * or inventing one for a nonexistent one (that would be a new business rule
 * ADR-0016 does not cover), so — the same "malformed/unrepresentable
 * schedule data never crashes the read, it just yields no availability"
 * convention `getWindowForDate` already establishes — this fails closed
 * instead of guessing.
 */
function resolveZonedInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null {
  if (!isValidIanaTimeZone(timeZone)) return null;

  const naiveMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Ground the bracket on a rough estimate of the true instant (not on the
  // naive UTC misreading of the wall clock) so it correctly straddles any
  // nearby transition regardless of how large the zone's base offset is.
  const roughCandidate = naiveMs - offsetMsAt(naiveMs, timeZone);

  const offsetBefore = offsetMsAt(roughCandidate - DST_TRANSITION_MARGIN_MS, timeZone);
  const offsetAfter = offsetMsAt(roughCandidate + DST_TRANSITION_MARGIN_MS, timeZone);

  const candidateBefore = naiveMs - offsetBefore;
  const candidateAfter = naiveMs - offsetAfter;

  const validBefore = wallClockMatches(candidateBefore, timeZone, year, month, day, hour, minute);
  const validAfter = wallClockMatches(candidateAfter, timeZone, year, month, day, hour, minute);

  if (validBefore && validAfter) {
    // Same instant both ways (the ordinary case, no transition nearby) vs.
    // two genuinely different valid instants (fall-back overlap) — the
    // latter is exactly the "occurs twice" ambiguity this function refuses
    // to silently resolve.
    return candidateBefore === candidateAfter ? new Date(candidateBefore) : null;
  }
  if (validBefore) return new Date(candidateBefore);
  if (validAfter) return new Date(candidateAfter);
  return null; // Neither candidate round-trips: this wall-clock time does not exist (spring-forward gap).
}

/**
 * Converts a clinic-local wall-clock working-hours window on `date` into the
 * absolute UTC instants it denotes in `timeZone` (ADR-0016 decision items 1,
 * 2, and 6). Returns `null` when the window is malformed (same check
 * `getWindowForDate` already applies — kept here too since this is also
 * callable directly) or when either boundary has no single well-defined
 * instant on this date in this zone (see `resolveZonedInstant`).
 */
export function localWindowToUtcInstants(
  window: DayWindow,
  date: string,
  timeZone: string,
): TimeSlot | null {
  const { year, month, day } = parseCalendarDate(date);
  const startMinutes = parseHHMM(window.start);
  const endMinutes = parseHHMM(window.end);
  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    return null;
  }

  const startsAt = resolveZonedInstant(
    year,
    month,
    day,
    Math.floor(startMinutes / 60),
    startMinutes % 60,
    timeZone,
  );
  const endsAt = resolveZonedInstant(
    year,
    month,
    day,
    Math.floor(endMinutes / 60),
    endMinutes % 60,
    timeZone,
  );
  if (!startsAt || !endsAt) return null;
  return { startsAt, endsAt };
}

/**
 * Clinic-local calendar-day boundaries for `date` in `timeZone`, in UTC —
 * the range `index.ts` queries existing appointments against
 * (`listActiveAppointmentsForPractitionerOnDate`) before subtracting them
 * from the working-hours window. Unlike `localWindowToUtcInstants`, this
 * never returns `null`: it only needs to be *inclusive* enough to not miss a
 * real busy interval, not exact — `computeAvailableSlots` only ever offers
 * slots inside the strictly-resolved working-hours window, so a day
 * boundary landing inside a rare DST transition (or an unrecognized
 * `timeZone`, falling back to `dayBoundsUtc`'s plain UTC bounds) can only
 * fetch a few irrelevant extra rows, never produce a wrong slot.
 */
export function zonedDayBoundsUtc(
  date: string,
  timeZone: string,
): { dayStart: Date; dayEnd: Date } {
  if (!isValidIanaTimeZone(timeZone)) {
    return dayBoundsUtc(date);
  }
  const { year, month, day } = parseCalendarDate(date);
  const next = nextCalendarDate(year, month, day);
  return {
    dayStart: new Date(zonedWallClockToUtcMs(year, month, day, 0, 0, timeZone)),
    dayEnd: new Date(zonedWallClockToUtcMs(next.year, next.month, next.day, 0, 0, timeZone)),
  };
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
 *
 * `window`'s `start`/`end` are clinic-local wall-clock times (ADR-0016);
 * `timeZone` is what converts them into the absolute instants slots are
 * actually built from. Returns no slots (rather than throwing) when that
 * conversion is impossible — see `localWindowToUtcInstants`.
 */
export function computeAvailableSlots(
  window: DayWindow | null,
  date: string,
  timeZone: string,
  durationMinutes: number,
  busyIntervals: readonly TimeSlot[],
): TimeSlot[] {
  if (!window || !Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return [];
  }

  const instants = localWindowToUtcInstants(window, date, timeZone);
  if (!instants) return [];

  const stepMs = durationMinutes * 60_000;
  const endMs = instants.endsAt.getTime();

  const slots: TimeSlot[] = [];
  let cursor = instants.startsAt.getTime();
  while (cursor + stepMs <= endMs) {
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
