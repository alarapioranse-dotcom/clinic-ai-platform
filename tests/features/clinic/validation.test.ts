import { describe, it, expect } from 'vitest';

import {
  parseTimeZone,
  parseWorkingHours,
  supportedTimeZones,
  InvalidTimeZoneError,
  InvalidWorkingHoursError,
} from '@/features/clinic';

/**
 * ADR-0022 decision 3, application side: the WorkingHours value object
 * (docs/domain/03-value-objects.md) and the IANA timezone are validated
 * before anything reaches the database.
 */
describe('parseWorkingHours', () => {
  it('normalises to all seven weekdays, absent days becoming closed (null)', () => {
    expect(parseWorkingHours({ monday: { start: '09:00', end: '17:00' }, sunday: null })).toEqual({
      monday: { start: '09:00', end: '17:00' },
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    });
  });

  it('accepts an empty object as closed every day', () => {
    const result = parseWorkingHours({});
    expect(Object.values(result).every((day) => day === null)).toBe(true);
  });

  it.each([
    ['not an object', 'monday 9-5'],
    ['null', null],
    ['an array', []],
  ])('rejects %s', (_label, value) => {
    expect(() => parseWorkingHours(value)).toThrow(InvalidWorkingHoursError);
  });

  it.each([
    ['an unknown day', { Monday: { start: '09:00', end: '17:00' } }],
    ['a misspelled day', { mondy: { start: '09:00', end: '17:00' } }],
    ['an extra field in a day', { monday: { start: '09:00', end: '17:00', note: 'x' } }],
    ['a missing end', { monday: { start: '09:00' } }],
    ['a day that is a string', { monday: '09:00-17:00' }],
    ['12-hour time', { monday: { start: '9:00', end: '17:00' } }],
    ['an hour of 24', { monday: { start: '09:00', end: '24:00' } }],
    ['seconds', { monday: { start: '09:00:00', end: '17:00' } }],
    ['start equal to end', { monday: { start: '09:00', end: '09:00' } }],
    ['a midnight span', { monday: { start: '22:00', end: '02:00' } }],
    ['two intervals', { monday: [{ start: '09:00', end: '12:00' }] }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseWorkingHours(value)).toThrow(InvalidWorkingHoursError);
  });
});

describe('parseTimeZone', () => {
  it.each(['Europe/Athens', 'Africa/Cairo', 'UTC', 'America/New_York'])('accepts %s', (zone) => {
    expect(parseTimeZone(zone)).toBe(zone);
  });

  it.each(['+02:00', 'GMT+2', 'Mars/Olympus_Mons', 'europe/athens', '', 42, null])(
    'rejects %s',
    (zone) => {
      expect(() => parseTimeZone(zone)).toThrow(InvalidTimeZoneError);
    },
  );

  it('offers a sorted list that includes UTC and no fixed offsets', () => {
    const zones = supportedTimeZones();
    expect(zones).toContain('UTC');
    expect([...zones].sort()).toEqual([...zones]);
    expect(zones.some((zone) => /^[+-]\d/.test(zone))).toBe(false);
  });
});
