import { describe, it, expect } from 'vitest';
import { computeAvailableSlots, dayBoundsUtc, getWindowForDate } from '@/features/appointments';
import type { WorkingHoursJson } from '@/features/appointments';

/**
 * Pure-function coverage for `src/features/appointments/schedule.ts`
 * (roadmap P4 Slice 1). No database — these run against plain inputs, unlike
 * every other test in this repo, because this module deliberately has no
 * database access of its own (see that file's own top comment on why
 * availability computation is kept separate from schedule/appointment
 * persistence).
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

describe('computeAvailableSlots', () => {
  const window = { start: '09:00', end: '10:00' };

  it('produces contiguous 30-minute slots across a one-hour window with no busy intervals', () => {
    const slots = computeAvailableSlots(window, '2026-09-17', 30, []);
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

  it('returns an empty list for a closed day (null window)', () => {
    expect(computeAvailableSlots(null, '2026-09-17', 30, [])).toEqual([]);
  });

  it('excludes a slot that overlaps a busy interval', () => {
    const busy = [
      {
        startsAt: new Date('2026-09-17T09:00:00.000Z'),
        endsAt: new Date('2026-09-17T09:30:00.000Z'),
      },
    ];
    const slots = computeAvailableSlots(window, '2026-09-17', 30, busy);
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
    const slots = computeAvailableSlots(window, '2026-09-17', 30, busy);
    expect(slots).toHaveLength(2);
  });

  it('rejects a non-positive or non-integer duration by returning no slots', () => {
    expect(computeAvailableSlots(window, '2026-09-17', 0, [])).toEqual([]);
    expect(computeAvailableSlots(window, '2026-09-17', -30, [])).toEqual([]);
    expect(computeAvailableSlots(window, '2026-09-17', 15.5, [])).toEqual([]);
  });

  it('produces no slots when the duration is longer than the window', () => {
    expect(computeAvailableSlots(window, '2026-09-17', 90, [])).toEqual([]);
  });
});
