import { describe, it, expect, beforeAll } from 'vitest';
import {
  computeAvailableSlots,
  dayBoundsUtc,
  zonedDayBoundsUtc,
  getWindowForDate,
  isValidIanaTimeZone,
  localWindowToUtcInstants,
} from '@/features/appointments';
import type { WorkingHoursJson } from '@/features/appointments';
import {
  findNextDstTransitionOfKind,
  rawOffsetMinutes,
  rawWallClock,
  type DstTransition,
} from '../../dst-test-helpers';

/**
 * Pure-function coverage for `src/features/appointments/schedule.ts`
 * (roadmap P4 Slice 1, then ADR-0016's clinic-local-timezone
 * implementation). No database — these run against plain inputs, unlike
 * every other test in this repo, because this module deliberately has no
 * database access of its own (see that file's own top comment on why
 * availability computation is kept separate from schedule/appointment
 * persistence).
 *
 * The DST tests below use Africa/Cairo (a real zone that observes DST) and
 * Asia/Dubai (a real zone that does not, constant UTC+4) as ADR-0016's
 * implementation task calls for. They deliberately do NOT hardcode which
 * calendar dates Africa/Cairo's transitions fall on: DST rules are not
 * fixed (Egypt's own policy has changed more than once), and a version
 * shift in whatever tzdata a given CI run's Node/ICU ships with could move
 * those dates without any code change here. Instead, `../../dst-test-helpers`
 * discovers the actual transition in whatever tzdata is running the test,
 * using Intl calls independent of `schedule.ts`'s own offset-resolution
 * code (see that file's own header comment for why independence matters).
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

/**
 * DST-transition behavior, discovered dynamically per `../../dst-test-helpers`
 * rather than asserted against dates frozen at authoring time. Expected UTC
 * instants are computed here from `rawOffsetMinutes`/`rawWallClock` (a
 * separate Intl code path from `schedule.ts`'s own), never by calling
 * `localWindowToUtcInstants`/`resolveZonedInstant` to produce their own
 * expected value — asserting a function's output equals itself would prove
 * nothing.
 */
describe('localWindowToUtcInstants / computeAvailableSlots across a real DST transition (Africa/Cairo)', () => {
  const ZONE = 'Africa/Cairo';
  let gap: DstTransition;
  let overlap: DstTransition;

  beforeAll(() => {
    const yearStart = Date.UTC(2026, 0, 1);
    gap = findNextDstTransitionOfKind(yearStart, ZONE, 'gap');
    overlap = findNextDstTransitionOfKind(yearStart, ZONE, 'overlap');
    // Sanity on the discovery itself, independent of anything schedule.ts does.
    expect(gap.afterOffsetMinutes).toBeGreaterThan(gap.beforeOffsetMinutes);
    expect(overlap.afterOffsetMinutes).toBeLessThan(overlap.beforeOffsetMinutes);
  });

  function pad2(n: number): string {
    return String(n).padStart(2, '0');
  }
  function dateStr(wc: { year: number; month: number; day: number }): string {
    return `${wc.year}-${pad2(wc.month)}-${pad2(wc.day)}`;
  }
  function expectedInstant(
    wc: { year: number; month: number; day: number },
    hour: number,
    minute: number,
    offsetMinutes: number,
  ): Date {
    return new Date(
      Date.UTC(wc.year, wc.month - 1, wc.day, hour, minute, 0) - offsetMinutes * 60_000,
    );
  }

  it('resolves the same clinic-local wall-clock window to different UTC offsets on either side of the discovered transition', () => {
    const beforeDay = rawWallClock(gap.lastBeforeMs, ZONE); // a day still fully on the pre-transition offset
    const afterDay = rawWallClock(gap.firstAfterMs, ZONE); // a day already fully on the post-transition offset (this window, 09:00-17:00, is nowhere near the transition hour itself)

    const beforeOffset = rawOffsetMinutes(
      Date.UTC(beforeDay.year, beforeDay.month - 1, beforeDay.day, 9, 0, 0),
      ZONE,
    );
    const afterOffset = rawOffsetMinutes(
      Date.UTC(afterDay.year, afterDay.month - 1, afterDay.day, 9, 0, 0),
      ZONE,
    );
    expect(afterOffset).not.toBe(beforeOffset); // the property this test exists to prove

    expect(
      localWindowToUtcInstants({ start: '09:00', end: '17:00' }, dateStr(beforeDay), ZONE),
    ).toEqual({
      startsAt: expectedInstant(beforeDay, 9, 0, beforeOffset),
      endsAt: expectedInstant(beforeDay, 17, 0, beforeOffset),
    });
    expect(
      localWindowToUtcInstants({ start: '09:00', end: '17:00' }, dateStr(afterDay), ZONE),
    ).toEqual({
      startsAt: expectedInstant(afterDay, 9, 0, afterOffset),
      endsAt: expectedInstant(afterDay, 17, 0, afterOffset),
    });
  });

  it('returns null when the window start falls inside the discovered spring-forward gap (end stays outside it)', () => {
    const gapDay = rawWallClock(gap.firstAfterMs, ZONE);
    // The gap is [gapDay 00:00, gapDay <firstAfter time>) -- derive a midpoint minute inside it
    // (nonexistent) for `start`, and a minute comfortably after it (valid) for `end`, whatever
    // those actually are in this tzdata snapshot, rather than fixed "00:30"/"02:00" literals.
    const gapEndMinutes = gapDay.hour * 60 + gapDay.minute;
    const startMinutes = Math.floor(gapEndMinutes / 2); // inside the gap
    const endMinutes = gapEndMinutes + 60; // comfortably after the gap
    const start = `${pad2(Math.floor(startMinutes / 60))}:${pad2(startMinutes % 60)}`;
    const end = `${pad2(Math.floor(endMinutes / 60))}:${pad2(endMinutes % 60)}`;

    expect(localWindowToUtcInstants({ start, end }, dateStr(gapDay), ZONE)).toBeNull();
    expect(computeAvailableSlots({ start, end }, dateStr(gapDay), ZONE, 15, [])).toEqual([]);
  });

  it('returns null when the window end falls inside the discovered fall-back overlap (start stays outside it)', () => {
    const before = rawWallClock(overlap.lastBeforeMs, ZONE);
    const after = rawWallClock(overlap.firstAfterMs, ZONE);
    expect(before.year).toBe(after.year);
    expect(before.month).toBe(after.month);
    expect(before.day).toBe(after.day);

    // The overlap is [after HH:MM, before HH:MM] inclusive (both offsets produce that wall time).
    // `start` is derived a full hour before it opens (unambiguous); `end` lands inside it.
    const overlapStartMinutes = after.hour * 60 + after.minute;
    const overlapEndMinutesInclusive = before.hour * 60 + before.minute;
    const startMinutes = Math.max(0, overlapStartMinutes - 60);
    const endMinutes = Math.floor((overlapStartMinutes + overlapEndMinutesInclusive) / 2);
    const start = `${pad2(Math.floor(startMinutes / 60))}:${pad2(startMinutes % 60)}`;
    const end = `${pad2(Math.floor(endMinutes / 60))}:${pad2(endMinutes % 60)}`;

    expect(localWindowToUtcInstants({ start, end }, dateStr(after), ZONE)).toBeNull();
    expect(computeAvailableSlots({ start, end }, dateStr(after), ZONE, 15, [])).toEqual([]);
  });

  it('resolves normally on the gap/overlap calendar dates, outside the transition range itself', () => {
    const gapDay = rawWallClock(gap.firstAfterMs, ZONE);
    const overlapDay = rawWallClock(overlap.firstAfterMs, ZONE);

    const gapDayOffset = rawOffsetMinutes(
      Date.UTC(gapDay.year, gapDay.month - 1, gapDay.day, 9, 0, 0),
      ZONE,
    );
    const overlapDayOffset = rawOffsetMinutes(
      Date.UTC(overlapDay.year, overlapDay.month - 1, overlapDay.day, 9, 0, 0),
      ZONE,
    );

    expect(
      localWindowToUtcInstants({ start: '09:00', end: '10:00' }, dateStr(gapDay), ZONE),
    ).toEqual({
      startsAt: expectedInstant(gapDay, 9, 0, gapDayOffset),
      endsAt: expectedInstant(gapDay, 10, 0, gapDayOffset),
    });
    expect(
      localWindowToUtcInstants({ start: '09:00', end: '10:00' }, dateStr(overlapDay), ZONE),
    ).toEqual({
      startsAt: expectedInstant(overlapDay, 9, 0, overlapDayOffset),
      endsAt: expectedInstant(overlapDay, 10, 0, overlapDayOffset),
    });
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
