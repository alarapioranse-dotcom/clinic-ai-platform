import { describe, it, expect, afterAll } from 'vitest';
import { Client } from 'pg';

import { closePool } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import {
  getClinicSettings,
  updateClinicSettings,
  parseWorkingHours,
  ClinicNotFoundError,
  InvalidTimeZoneError,
} from '@/features/clinic';
import { createTestClinic } from '../../fixtures';

/**
 * Feature-level coverage for src/features/clinic against PostgreSQL
 * (ADR-0022): reads and writes go through `withTenantContext`, and the write
 * only reaches the clinic passed in.
 */
async function storedRow(id: string): Promise<{ working_hours: unknown; timezone: string }> {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ working_hours: unknown; timezone: string }>(
      'SELECT working_hours, timezone FROM clinics WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw new Error('missing clinic');
    return rows[0];
  } finally {
    await admin.end();
  }
}

const WEEKDAYS_9_TO_5 = parseWorkingHours({
  monday: { start: '09:00', end: '17:00' },
  tuesday: { start: '09:00', end: '17:00' },
  wednesday: { start: '09:00', end: '17:00' },
  thursday: { start: '09:00', end: '17:00' },
  friday: { start: '09:00', end: '13:00' },
});

describe('clinic settings feature', () => {
  afterAll(async () => {
    await closePool();
  });

  it('reads the clinic with every weekday present and closed days as null', async () => {
    const clinic = await createTestClinic('FeatureRead', 'Africa/Cairo');
    const settings = await getClinicSettings(clinic.id);
    expect(settings).toMatchObject({ id: clinic.id, name: clinic.name, timezone: 'Africa/Cairo' });
    expect(Object.keys(settings.workingHours).sort()).toEqual(
      ['friday', 'monday', 'saturday', 'sunday', 'thursday', 'tuesday', 'wednesday'].sort(),
    );
    expect(Object.values(settings.workingHours).every((day) => day === null)).toBe(true);
  });

  it('updates working hours and timezone together and returns the stored values', async () => {
    const clinic = await createTestClinic('FeatureWrite', 'UTC');
    const result = await updateClinicSettings(clinic.id, {
      workingHours: WEEKDAYS_9_TO_5,
      timezone: 'Europe/Athens',
    });
    expect(result.workingHours).toEqual(WEEKDAYS_9_TO_5);
    expect(result.timezone).toBe('Europe/Athens');
    expect(await storedRow(clinic.id)).toEqual({
      working_hours: WEEKDAYS_9_TO_5,
      timezone: 'Europe/Athens',
    });
  });

  it('a write for one clinic never changes another clinic', async () => {
    const clinicA = await createTestClinic('FeatureIsoA', 'UTC');
    const clinicB = await createTestClinic('FeatureIsoB', 'UTC');
    const beforeB = await storedRow(clinicB.id);

    await updateClinicSettings(clinicA.id, {
      workingHours: WEEKDAYS_9_TO_5,
      timezone: 'Europe/Lisbon',
    });

    expect(await storedRow(clinicB.id)).toEqual(beforeB);
  });

  it('updates only the timezone when only the timezone is given', async () => {
    const clinic = await createTestClinic('FeatureTzOnly', 'UTC');
    await updateClinicSettings(clinic.id, { workingHours: WEEKDAYS_9_TO_5 });
    await updateClinicSettings(clinic.id, { timezone: 'Europe/Madrid' });
    expect(await storedRow(clinic.id)).toEqual({
      working_hours: WEEKDAYS_9_TO_5,
      timezone: 'Europe/Madrid',
    });
  });

  it('maps a timezone the database rejects to InvalidTimeZoneError and writes nothing', async () => {
    const clinic = await createTestClinic('FeatureDbTz', 'UTC');
    const before = await storedRow(clinic.id);
    await expect(
      updateClinicSettings(clinic.id, { timezone: 'Not/A_Zone', workingHours: WEEKDAYS_9_TO_5 }),
    ).rejects.toThrow(InvalidTimeZoneError);
    expect(await storedRow(clinic.id)).toEqual(before);
  });

  it('shows a malformed stored day as closed, matching how availability reads it', async () => {
    const clinic = await createTestClinic('FeatureMalformed', 'UTC');
    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      await admin.query('UPDATE clinics SET working_hours = $1::jsonb WHERE id = $2', [
        JSON.stringify({
          monday: { start: '17:00', end: '09:00' },
          tuesday: { start: '10:00', end: '14:00' },
        }),
        clinic.id,
      ]);
    } finally {
      await admin.end();
    }
    const settings = await getClinicSettings(clinic.id);
    expect(settings.workingHours.monday).toBeNull();
    expect(settings.workingHours.tuesday).toEqual({ start: '10:00', end: '14:00' });
  });

  it('throws ClinicNotFoundError for a clinic id with no row', async () => {
    await expect(getClinicSettings('00000000-0000-4000-8000-0000000000aa')).rejects.toThrow(
      ClinicNotFoundError,
    );
  });
});
