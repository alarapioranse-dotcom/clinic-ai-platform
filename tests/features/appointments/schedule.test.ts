import { describe, it, expect } from 'vitest';
import {
  computeAvailableSlots,
  dayBoundsUtc,
  zonedDayBoundsUtc,
  getWindowForDate,
  isValidIanaTimeZone,
  localWindowToUtcInstants,
} from '@/features/appointments';
import type { WorkingHoursJson } from '@/features/appointments';

/**
 * Pure-function coverage for `src/features/appointments/schedule.ts`
 * (roadmap P4 Slice 1, then ADR-0016's clinic-local-timezone
 * implementation). No database — these run against plain inputs, unlike
 * every other test in this repo, because this module deliberately has no
 * database access of its own (see that file's own top comment on why
 * availability computation is kept separate from schedule/appointment
 * persistence).
 *
 * Africa/Cairo's real DST rule, as this platform's own tzdata reports it
 * (verified directly against Node's ICU before writing these dates, not
 * guessed): standard time UTC+2, daylight time UTC+3, switching 2026-04-23
 * 22:00 UTC (spring forward: local 00:00-00:59 on 2026-04-24 does not
 * exist) and 2026-10-29 21:00 UTC (fall back: local 23:00-23:59 on
 * 2026-10-29 occurs twice). Asia/Dubai carries no DST at all (constant
 * UTC+4) — used below as the "does not observe DST" comparison ADR-0016's
 * implementation task calls for.
 */
describe('dayBoundsUtc', () => {
  it('returns UTC midnight-to-midnight for a valid date', () => {
    const { dayStart, dayEnd } = dayBoundsUtc('2026-09-17');
    expect(dayStart.toISOString()).toBe('2026-09-17T00:00:00.000Z');
    expect(dayEnd.toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });

  it('throws for a malformed date string', () => {
    expect(() => dayBoundsUtc('17-09-2026')).toThrow(/Invalid date/);
  });

  it('throws for a non-existent calendar date', () => {
    expect(() => dayBoundsUtc('2026-02-30')).toThrow(/Invalid date/);
  });
});

describe('getWindowForDate', () => {
  const workingHours: WorkingHoursJson = {
    thursday: { start: '09:00', end: '17:00' },
    friday: null,
  };

  it('returns the window for a day with a configured open interval (2026-09-17 is a Thursday)', () => {
    expect(getWindowForDate(workingHours, '2026-09-17')).toEqual({ start: '09:00', end: '17:00' });
  });

  it('returns null for a day explicitly marked closed (2026-09-18 is a Friday)', () => {
    expect(getWindowForDate(workingHours, '2026-09-18')).toBeNull();
  });

  it('returns null for a day with no entry at all (2026-09-19 is a Saturday)', () => {
    expect(getWindowForDate(workingHours, '2026-09-19')).toBeNull();
  });

  it('returns null for a malformed window rather than throwing', () => {
    const malformed: WorkingHoursJson = { thursday: { start: '17:00', end: '09:00' } };
    expect(getWindowForDate(malformed, '2026-09-17')).toBeNull();
  });
});

describe('isValidIanaTimeZone', () => {
  it('accepts recognized IANA identifiers', () => {
    expect(isValidIanaTimeZone('UTC')).toBe(true);
    expect(isValidIanaTimeZone('Africa/Cairo')).toBe(true);
    expect(isValidIanaTimeZone('Asia/Dubai')).toBe(true);
  });

  it('rejects a string the platform does not recognize as any kind of timezone identifier', () => {
    expect(isValidIanaTimeZone('Not/AZone')).toBe(false);
    expect(isValidIanaTimeZone('')).toBe(false);
  });

  it('does not reject a fixed numeric offset, which the platform Intl still recognizes as a valid identifier', () => {
    // Not this function's job to enforce ADR-0016 decision item 4 ("never a
    // fixed numeric UTC offset") -- that's a policy about what this
    // codebase chooses to *store* on `clinics.timezone`, not about what
    // `Intl.DateTimeFormat` itself accepts as a timezone. Documented here so
    // the distinction is explicit rather than silently assumed.
    expect(isValidIanaTimeZone('+02:00')).toBe(true);
  });
});

describe('localWindowToUtcInstants', () => {
  it('is the identity conversion for a UTC clinic', () => {
    const instants = localWindowToUtcInstants(
      { start: '09:00', end: '17:00' },
      '2026-09-17',
      'UTC',
    );
    expect(instants).toEqual({
      startsAt: new Date('2026-09-17T09:00:00.000Z'),
      endsAt: new Date('2026-09-17T17:00:00.000Z'),
    });
  });

  it('converts a non-UTC, non-DST clinic (Asia/Dubai, constant UTC+4)', () => {
    const instants = localWindowToUtcInstants(
      { start: '09:00', end: '17:00' },
      '2026-09-17',
      'Asia/Dubai',
    );
    expect(instants).toEqual({
      startsAt: new Date('2026-09-17T05:00:00.000Z'),
      endsAt: new Date('2026-09-17T13:00:00.000Z'),
    });
  });

  it('converts a clinic in standard time (Africa/Cairo, UTC+2, before the spring DST transition)', () => {
    const instants = localWindowToUtcInstants(
      { start: '09:00', end: '17:00' },
      '2026-04-23',
      'Africa/Cairo',
    );
    expect(instants).toEqual({
      startsAt: new Date('2026-04-23T07:00:00.000Z'),
      endsAt: new Date('2026-04-23T15:00:00.000Z'),
    });
  });

  it('resolves the same clinic-local wall-clock window to a different UTC offset once DST is in effect (Africa/Cairo, UTC+3)', () => {
    const instants = localWindowToUtcInstants(
      { start: '09:00', end: '17:00' },
      '2026-04-25',
      'Africa/Cairo',
    );
    expect(instants).toEqual({
      startsAt: new Date('2026-04-25T06:00:00.000Z'),
      endsAt: new Date('2026-04-25T14:00:00.000Z'),
    });
  });

  it('returns null when the window start falls inside a spring-forward gap (2026-04-24 00:00-01:00 does not exist in Africa/Cairo)', () => {
    expect(
      localWindowToUtcInstants({ start: '00:30', end: '02:00' }, '2026-04-24', 'Africa/Cairo'),
    ).toBeNull();
  });

  it('returns null when the window end falls inside a fall-back overlap (2026-10-29 23:00-24:00 occurs twice in Africa/Cairo)', () => {
    expect(
      localWindowToUtcInstants({ start: '22:00', end: '23:30' }, '2026-10-29', 'Africa/Cairo'),
    ).toBeNull();
  });

  it('resolves normally on either side of a DST transition day, outside the transition hour itself', () => {
    expect(
      localWindowToUtcInstants({ start: '09:00', end: '10:00' }, '2026-04-24', 'Africa/Cairo'),
    ).toEqual({
      startsAt: new Date('2026-04-24T06:00:00.000Z'),
      endsAt: new Date('2026-04-24T07:00:00.000Z'),
    });
    expect(
      localWindowToUtcInstants({ start: '09:00', end: '10:00' }, '2026-10-29', 'Africa/Cairo'),
    ).toEqual({
      startsAt: new Date('2026-10-29T06:00:00.000Z'),
      endsAt: new Date('2026-10-29T07:00:00.000Z'),
    });
  });

  it('returns null for a malformed window (start not before end), same as getWindowForDate', () => {
    expect(
      localWindowToUtcInstants({ start: '17:00', end: '09:00' }, '2026-09-17', 'Africa/Cairo'),
    ).toBeNull();
  });

  it('returns null for an unrecognized timezone rather than throwing', () => {
    expect(
      localWindowToUtcInstants({ start: '09:00', end: '17:00' }, '2026-09-17', 'Not/AZone'),
    ).toBeNull();
  });
});

describe('zonedDayBoundsUtc', () => {
  it('matches dayBoundsUtc for a UTC clinic', () => {
    expect(zonedDayBoundsUtc('2026-09-17', 'UTC')).toEqual(dayBoundsUtc('2026-09-17'));
  });

  it('shifts day boundaries by the clinic offset for a non-UTC clinic', () => {
    const { dayStart, dayEnd } = zonedDayBoundsUtc('2026-09-17', 'Asia/Dubai');
    expect(dayStart.toISOString()).toBe('2026-09-16T20:00:00.000Z');
    expect(dayEnd.toISOString()).toBe('2026-09-17T20:00:00.000Z');
  });

  it('falls back to plain UTC day boundaries for an unrecognized timezone rather than throwing', () => {
    expect(zonedDayBoundsUtc('2026-09-17', 'Not/AZone')).toEqual(dayBoundsUtc('2026-09-17'));
  });
});

describe('computeAvailableSlots', () => {
  const window = { start: '09:00', end: '10:00' };

  it('produces contiguous 30-minute slots across a one-hour window with no busy intervals (UTC clinic)', () => {
    const slots = computeAvailableSlots(window, '2026-09-17', 'UTC', 30, []);
    expect(slots).toEqual([
      {
        startsAt: new Date('2026-09-17T09:00:00.000Z'),
        endsAt: new Date('2026-09-17T09:30:00.000Z'),
      },
      {
        startsAt: new Date('2026-09-17T09:30:00.000Z'),
        endsAt: new Date('2026-09-17T10:00:00.000Z'),
      },
    ]);
  });

  it('produces the same wall-clock slots shifted by the clinic offset for a non-UTC clinic', () => {
    const slots = computeAvailableSlots(window, '2026-09-17', 'Asia/Dubai', 30, []);
    expect(slots).toEqual([
      {
        startsAt: new Date('2026-09-17T05:00:00.000Z'),
        endsAt: new Date('2026-09-17T05:30:00.000Z'),
      },
      {
        startsAt: new Date('2026-09-17T05:30:00.000Z'),
        endsAt: new Date('2026-09-17T06:00:00.000Z'),
      },
    ]);
  });

  it('returns an empty list for a closed day (null window)', () => {
    expect(computeAvailableSlots(null, '2026-09-17', 'UTC', 30, [])).toEqual([]);
  });

  it('returns an empty list when the window cannot be resolved to instants (DST gap)', () => {
    expect(
      computeAvailableSlots({ start: '00:30', end: '02:00' }, '2026-04-24', 'Africa/Cairo', 30, []),
    ).toEqual([]);
  });

  it('excludes a slot that overlaps a busy interval', () => {
    const busy = [
      {
        startsAt: new Date('2026-09-17T09:00:00.000Z'),
        endsAt: new Date('2026-09-17T09:30:00.000Z'),
      },
    ];
    const slots = computeAvailableSlots(window, '2026-09-17', 'UTC', 30, busy);
    expect(slots).toEqual([
      {
        startsAt: new Date('2026-09-17T09:30:00.000Z'),
        endsAt: new Date('2026-09-17T10:00:00.000Z'),
      },
    ]);
  });

  it('does not exclude a slot that only touches a busy interval boundary (half-open [start, end))', () => {
    const busy = [
      {
        startsAt: new Date('2026-09-17T08:00:00.000Z'),
        endsAt: new Date('2026-09-17T09:00:00.000Z'),
      },
    ];
    const slots = computeAvailableSlots(window, '2026-09-17', 'UTC', 30, busy);
    expect(slots).toHaveLength(2);
  });

  it('rejects a non-positive or non-integer duration by returning no slots', () => {
    expect(computeAvailableSlots(window, '2026-09-17', 'UTC', 0, [])).toEqual([]);
    expect(computeAvailableSlots(window, '2026-09-17', 'UTC', -30, [])).toEqual([]);
    expect(computeAvailableSlots(window, '2026-09-17', 'UTC', 15.5, [])).toEqual([]);
  });

  it('produces no slots when the duration is longer than the window', () => {
    expect(computeAvailableSlots(window, '2026-09-17', 'UTC', 90, [])).toEqual([]);
  });
});
