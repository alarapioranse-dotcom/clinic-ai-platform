import { describe, it, expect, afterAll } from 'vitest';
import { Client, type PoolClient, type QueryResult } from 'pg';
import { withTenantContext, withoutTenantContext, closePool } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { createPatient } from '@/features/patients';
import { receiveInboundMessage } from '@/features/conversations';
import { createTestClinic, createTestStaffMember } from '../fixtures';

/**
 * Database/domain coverage for `db/migrations/0011_appointments.sql`
 * (roadmap P4 Slice 1): ADR-0014's no-double-booking EXCLUDE constraint,
 * ADR-0015's update-in-place reschedule, the composite foreign keys, RLS,
 * and `app_user`'s grants. These exercise the schema directly with SQL,
 * bypassing `src/features/appointments`'s own repository — same convention
 * as tests/db/conversations-isolation.test.ts uses for schema-level
 * behavior (its own FK/trigger tests query `conversations`/`messages`
 * directly rather than through the feature layer).
 */

async function insertBooked(
  client: PoolClient,
  clinicId: string,
  patientId: string,
  practitionerId: string,
  startsAt: string,
  endsAt: string,
  conversationId: string | null = null,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO appointments (clinic_id, patient_id, practitioner_id, conversation_id, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [clinicId, patientId, practitionerId, conversationId, startsAt, endsAt],
  );
  return rows[0]!.id;
}

async function expectFailClosed(run: (client: PoolClient) => Promise<QueryResult>): Promise<void> {
  try {
    const result = await withoutTenantContext(run);
    expect(result.rows).toHaveLength(0);
  } catch (err) {
    expect((err as Error).message).toMatch(/invalid input syntax for type uuid/i);
  }
}

describe('appointments: schema invariants', () => {
  afterAll(async () => {
    await closePool();
  });

  it('accepts a valid appointment creation', async () => {
    const clinic = await createTestClinic('ApptValid');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000001001' });
    const practitioner = await createTestStaffMember(clinic.id, 'ApptValid', {
      role: 'practitioner',
    });

    const id = await withTenantContext(clinic.id, (client) =>
      insertBooked(
        client,
        clinic.id,
        patient.id,
        practitioner.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T09:30:00.000Z',
      ),
    );

    const rows = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT status FROM appointments WHERE id = $1', [id]),
    );
    expect(rows.rows[0]?.status).toBe('booked');
  });

  it('rejects an overlapping interval for the same clinic + practitioner (ADR-0014)', async () => {
    const clinic = await createTestClinic('ApptOverlapSame');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000001002' });
    const practitioner = await createTestStaffMember(clinic.id, 'ApptOverlapSame', {
      role: 'practitioner',
    });

    await withTenantContext(clinic.id, (client) =>
      insertBooked(
        client,
        clinic.id,
        patient.id,
        practitioner.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T10:00:00.000Z',
      ),
    );

    await expect(
      withTenantContext(clinic.id, (client) =>
        insertBooked(
          client,
          clinic.id,
          patient.id,
          practitioner.id,
          '2026-09-17T09:30:00.000Z',
          '2026-09-17T10:30:00.000Z',
        ),
      ),
    ).rejects.toThrow(/appointments_no_double_booking|conflicting key value/i);
  });

  it('allows an overlapping interval for a different practitioner in the same clinic', async () => {
    const clinic = await createTestClinic('ApptDiffPractitioner');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000001003' });
    const practitionerA = await createTestStaffMember(clinic.id, 'ApptDiffPractA', {
      role: 'practitioner',
    });
    const practitionerB = await createTestStaffMember(clinic.id, 'ApptDiffPractB', {
      role: 'practitioner',
    });

    await withTenantContext(clinic.id, (client) =>
      insertBooked(
        client,
        clinic.id,
        patient.id,
        practitionerA.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T10:00:00.000Z',
      ),
    );

    await expect(
      withTenantContext(clinic.id, (client) =>
        insertBooked(
          client,
          clinic.id,
          patient.id,
          practitionerB.id,
          '2026-09-17T09:00:00.000Z',
          '2026-09-17T10:00:00.000Z',
        ),
      ),
    ).resolves.toEqual(expect.any(String));
  });

  it('allows the same overlapping interval in a different clinic (EXCLUDE key includes clinic_id)', async () => {
    const clinicA = await createTestClinic('ApptDiffClinicA');
    const clinicB = await createTestClinic('ApptDiffClinicB');
    // staff_members.id is only unique per-clinic (0005_staff_members.sql's
    // staff_members_id_key is (id, clinic_id)) — two independently created
    // rows naturally have distinct ids, so this test proves clinic_id's
    // presence in the exclusion key using two genuinely different
    // practitioner rows, same as any other cross-clinic isolation test here.
    const patientA = await createPatient(clinicA.id, { phoneNumber: '+201000001004' });
    const patientB = await createPatient(clinicB.id, { phoneNumber: '+201000001005' });
    const practitionerA = await createTestStaffMember(clinicA.id, 'ApptDiffClinicA', {
      role: 'practitioner',
    });
    const practitionerB = await createTestStaffMember(clinicB.id, 'ApptDiffClinicB', {
      role: 'practitioner',
    });

    await withTenantContext(clinicA.id, (client) =>
      insertBooked(
        client,
        clinicA.id,
        patientA.id,
        practitionerA.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T10:00:00.000Z',
      ),
    );

    await expect(
      withTenantContext(clinicB.id, (client) =>
        insertBooked(
          client,
          clinicB.id,
          patientB.id,
          practitionerB.id,
          '2026-09-17T09:00:00.000Z',
          '2026-09-17T10:00:00.000Z',
        ),
      ),
    ).resolves.toEqual(expect.any(String));
  });

  it('allows back-to-back appointments sharing a boundary (half-open [start, end))', async () => {
    const clinic = await createTestClinic('ApptBackToBack');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000001006' });
    const practitioner = await createTestStaffMember(clinic.id, 'ApptBackToBack', {
      role: 'practitioner',
    });

    await withTenantContext(clinic.id, (client) =>
      insertBooked(
        client,
        clinic.id,
        patient.id,
        practitioner.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T09:30:00.000Z',
      ),
    );

    await expect(
      withTenantContext(clinic.id, (client) =>
        insertBooked(
          client,
          clinic.id,
          patient.id,
          practitioner.id,
          '2026-09-17T09:30:00.000Z',
          '2026-09-17T10:00:00.000Z',
        ),
      ),
    ).resolves.toEqual(expect.any(String));
  });

  it('rejects a zero-duration appointment', async () => {
    const clinic = await createTestClinic('ApptZeroDuration');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000001007' });
    const practitioner = await createTestStaffMember(clinic.id, 'ApptZeroDuration', {
      role: 'practitioner',
    });

    await expect(
      withTenantContext(clinic.id, (client) =>
        insertBooked(
          client,
          clinic.id,
          patient.id,
          practitioner.id,
          '2026-09-17T09:00:00.000Z',
          '2026-09-17T09:00:00.000Z',
        ),
      ),
    ).rejects.toThrow(/appointments_ends_after_starts|violates check constraint/i);
  });

  it('a cancelled appointment does not conflict with a new overlapping booking', async () => {
    const clinic = await createTestClinic('ApptCancelledNoConflict');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000001008' });
    const practitioner = await createTestStaffMember(clinic.id, 'ApptCancelledNoConflict', {
      role: 'practitioner',
    });

    const id = await withTenantContext(clinic.id, (client) =>
      insertBooked(
        client,
        clinic.id,
        patient.id,
        practitioner.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T10:00:00.000Z',
      ),
    );
    await withTenantContext(clinic.id, (client) =>
      client.query(
        `UPDATE appointments SET status = 'cancelled', updated_at = now() WHERE id = $1`,
        [id],
      ),
    );

    await expect(
      withTenantContext(clinic.id, (client) =>
        insertBooked(
          client,
          clinic.id,
          patient.id,
          practitioner.id,
          '2026-09-17T09:00:00.000Z',
          '2026-09-17T10:00:00.000Z',
        ),
      ),
    ).resolves.toEqual(expect.any(String));
  });

  it('a completed appointment does not conflict with a new overlapping booking', async () => {
    const clinic = await createTestClinic('ApptCompletedNoConflict');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000001009' });
    const practitioner = await createTestStaffMember(clinic.id, 'ApptCompletedNoConflict', {
      role: 'practitioner',
    });

    const id = await withTenantContext(clinic.id, (client) =>
      insertBooked(
        client,
        clinic.id,
        patient.id,
        practitioner.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T10:00:00.000Z',
      ),
    );
    await withTenantContext(clinic.id, (client) =>
      client.query(
        `UPDATE appointments SET status = 'completed', updated_at = now() WHERE id = $1`,
        [id],
      ),
    );

    await expect(
      withTenantContext(clinic.id, (client) =>
        insertBooked(
          client,
          clinic.id,
          patient.id,
          practitioner.id,
          '2026-09-17T09:00:00.000Z',
          '2026-09-17T10:00:00.000Z',
        ),
      ),
    ).resolves.toEqual(expect.any(String));
  });

  describe('rescheduling (ADR-0015: UPDATE-in-place)', () => {
    it('updates the same row in place — id and row count are unchanged', async () => {
      const clinic = await createTestClinic('ApptRescheduleInPlace');
      const patient = await createPatient(clinic.id, { phoneNumber: '+201000001010' });
      const practitioner = await createTestStaffMember(clinic.id, 'ApptRescheduleInPlace', {
        role: 'practitioner',
      });

      const id = await withTenantContext(clinic.id, (client) =>
        insertBooked(
          client,
          clinic.id,
          patient.id,
          practitioner.id,
          '2026-09-17T09:00:00.000Z',
          '2026-09-17T09:30:00.000Z',
        ),
      );

      await withTenantContext(clinic.id, (client) =>
        client.query(
          `UPDATE appointments SET starts_at = $1, ends_at = $2, status = 'rescheduled', updated_at = now() WHERE id = $3`,
          ['2026-09-18T11:00:00.000Z', '2026-09-18T11:30:00.000Z', id],
        ),
      );

      const rows = await withTenantContext(clinic.id, (client) =>
        client.query(
          `SELECT id, starts_at, ends_at, status FROM appointments WHERE patient_id = $1`,
          [patient.id],
        ),
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.id).toBe(id);
      expect(rows.rows[0]?.status).toBe('rescheduled');
      expect(new Date(rows.rows[0]?.starts_at as string).toISOString()).toBe(
        '2026-09-18T11:00:00.000Z',
      );
    });

    it("the new interval is rechecked by the database, and doesn't conflict with the row's own prior interval", async () => {
      const clinic = await createTestClinic('ApptRescheduleSelf');
      const patient = await createPatient(clinic.id, { phoneNumber: '+201000001011' });
      const practitioner = await createTestStaffMember(clinic.id, 'ApptRescheduleSelf', {
        role: 'practitioner',
      });

      const id = await withTenantContext(clinic.id, (client) =>
        insertBooked(
          client,
          clinic.id,
          patient.id,
          practitioner.id,
          '2026-09-17T09:00:00.000Z',
          '2026-09-17T09:30:00.000Z',
        ),
      );

      // Reschedule to an interval that overlaps the appointment's own prior
      // interval — must succeed: an appointment never conflicts with its own
      // earlier interval (ADR-0014 point 5), which for UPDATE-in-place
      // (ADR-0015) falls out of there only ever being one row to compare.
      await expect(
        withTenantContext(clinic.id, (client) =>
          client.query(
            `UPDATE appointments SET starts_at = $1, ends_at = $2, status = 'rescheduled', updated_at = now() WHERE id = $3`,
            ['2026-09-17T09:15:00.000Z', '2026-09-17T09:45:00.000Z', id],
          ),
        ),
      ).resolves.toBeDefined();

      // A genuinely different, unrelated appointment for the same
      // practitioner overlapping the *new* interval is still rejected — the
      // recheck is real, not merely skipped for this row.
      await expect(
        withTenantContext(clinic.id, (client) =>
          insertBooked(
            client,
            clinic.id,
            patient.id,
            practitioner.id,
            '2026-09-17T09:20:00.000Z',
            '2026-09-17T09:40:00.000Z',
          ),
        ),
      ).rejects.toThrow(/appointments_no_double_booking|conflicting key value/i);
    });

    it('a reschedule that would overlap a different active appointment is rejected', async () => {
      const clinic = await createTestClinic('ApptRescheduleConflict');
      const patient = await createPatient(clinic.id, { phoneNumber: '+201000001012' });
      const practitioner = await createTestStaffMember(clinic.id, 'ApptRescheduleConflict', {
        role: 'practitioner',
      });

      await withTenantContext(clinic.id, (client) =>
        insertBooked(
          client,
          clinic.id,
          patient.id,
          practitioner.id,
          '2026-09-17T13:00:00.000Z',
          '2026-09-17T13:30:00.000Z',
        ),
      );
      const movingId = await withTenantContext(clinic.id, (client) =>
        insertBooked(
          client,
          clinic.id,
          patient.id,
          practitioner.id,
          '2026-09-17T09:00:00.000Z',
          '2026-09-17T09:30:00.000Z',
        ),
      );

      await expect(
        withTenantContext(clinic.id, (client) =>
          client.query(
            `UPDATE appointments SET starts_at = $1, ends_at = $2, status = 'rescheduled', updated_at = now() WHERE id = $3`,
            ['2026-09-17T13:15:00.000Z', '2026-09-17T13:45:00.000Z', movingId],
          ),
        ),
      ).rejects.toThrow(/appointments_no_double_booking|conflicting key value/i);
    });
  });

  it('conversation/patient composite FK rejects a conversation belonging to a different patient (S2)', async () => {
    const clinic = await createTestClinic('ApptConvMismatch');
    const patientWithConversation = await createPatient(clinic.id, {
      phoneNumber: '+201000001013',
    });
    const otherPatient = await createPatient(clinic.id, { phoneNumber: '+201000001014' });
    const practitioner = await createTestStaffMember(clinic.id, 'ApptConvMismatch', {
      role: 'practitioner',
    });
    const { conversationId } = await receiveInboundMessage(
      clinic.id,
      patientWithConversation.id,
      'hello',
    );

    await expect(
      withTenantContext(clinic.id, (client) =>
        insertBooked(
          client,
          clinic.id,
          otherPatient.id,
          practitioner.id,
          '2026-09-17T09:00:00.000Z',
          '2026-09-17T09:30:00.000Z',
          conversationId,
        ),
      ),
    ).rejects.toThrow(/appointments_conversation_same_patient|violates foreign key constraint/i);
  });

  it('a booking with no conversation succeeds (S2: MATCH SIMPLE skips the check when conversation_id IS NULL)', async () => {
    const clinic = await createTestClinic('ApptNoConversation');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000001015' });
    const practitioner = await createTestStaffMember(clinic.id, 'ApptNoConversation', {
      role: 'practitioner',
    });

    const id = await withTenantContext(clinic.id, (client) =>
      insertBooked(
        client,
        clinic.id,
        patient.id,
        practitioner.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T09:30:00.000Z',
        null,
      ),
    );
    expect(id).toEqual(expect.any(String));
  });

  it('a booking with a conversation belonging to the same patient succeeds', async () => {
    const clinic = await createTestClinic('ApptWithConversation');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000001016' });
    const practitioner = await createTestStaffMember(clinic.id, 'ApptWithConversation', {
      role: 'practitioner',
    });
    const { conversationId } = await receiveInboundMessage(clinic.id, patient.id, 'hello');

    const id = await withTenantContext(clinic.id, (client) =>
      insertBooked(
        client,
        clinic.id,
        patient.id,
        practitioner.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T09:30:00.000Z',
        conversationId,
      ),
    );

    const rows = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT conversation_id FROM appointments WHERE id = $1', [id]),
    );
    expect(rows.rows[0]?.conversation_id).toBe(conversationId);
  });

  it('rejects a patient_id belonging to a different clinic (appointments_patient_same_clinic)', async () => {
    const clinicA = await createTestClinic('ApptPatientCrossA');
    const clinicB = await createTestClinic('ApptPatientCrossB');
    const patientB = await createPatient(clinicB.id, { phoneNumber: '+201000001017' });
    const practitionerA = await createTestStaffMember(clinicA.id, 'ApptPatientCrossA', {
      role: 'practitioner',
    });

    await expect(
      withTenantContext(clinicA.id, (client) =>
        insertBooked(
          client,
          clinicA.id,
          patientB.id,
          practitionerA.id,
          '2026-09-17T09:00:00.000Z',
          '2026-09-17T09:30:00.000Z',
        ),
      ),
    ).rejects.toThrow(/appointments_patient_same_clinic|violates foreign key constraint/i);
  });

  it('rejects a practitioner_id belonging to a different clinic (appointments_practitioner_same_clinic)', async () => {
    const clinicA = await createTestClinic('ApptPractitionerCrossA');
    const clinicB = await createTestClinic('ApptPractitionerCrossB');
    const patientA = await createPatient(clinicA.id, { phoneNumber: '+201000001018' });
    const practitionerB = await createTestStaffMember(clinicB.id, 'ApptPractitionerCrossB', {
      role: 'practitioner',
    });

    await expect(
      withTenantContext(clinicA.id, (client) =>
        insertBooked(
          client,
          clinicA.id,
          patientA.id,
          practitionerB.id,
          '2026-09-17T09:00:00.000Z',
          '2026-09-17T09:30:00.000Z',
        ),
      ),
    ).rejects.toThrow(/appointments_practitioner_same_clinic|violates foreign key constraint/i);
  });

  it('Clinic A cannot see Clinic B appointments (RLS tenant isolation)', async () => {
    const clinicA = await createTestClinic('ApptIsoA');
    const clinicB = await createTestClinic('ApptIsoB');
    const patientB = await createPatient(clinicB.id, { phoneNumber: '+201000001019' });
    const practitionerB = await createTestStaffMember(clinicB.id, 'ApptIsoB', {
      role: 'practitioner',
    });

    const id = await withTenantContext(clinicB.id, (client) =>
      insertBooked(
        client,
        clinicB.id,
        patientB.id,
        practitionerB.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T09:30:00.000Z',
      ),
    );

    const visibleToA = await withTenantContext(clinicA.id, (client) =>
      client.query('SELECT id FROM appointments'),
    );
    expect(visibleToA.rows.map((row) => row.id)).not.toContain(id);
  });

  it('rejects an insert whose clinic_id does not match the transaction tenant context (FORCE RLS WITH CHECK)', async () => {
    const clinicA = await createTestClinic('ApptForceRlsA');
    const clinicB = await createTestClinic('ApptForceRlsB');
    const patientB = await createPatient(clinicB.id, { phoneNumber: '+201000001020' });
    const practitionerB = await createTestStaffMember(clinicB.id, 'ApptForceRlsB', {
      role: 'practitioner',
    });

    await expect(
      withTenantContext(clinicA.id, (client) =>
        insertBooked(
          client,
          clinicB.id,
          patientB.id,
          practitionerB.id,
          '2026-09-17T09:00:00.000Z',
          '2026-09-17T09:30:00.000Z',
        ),
      ),
    ).rejects.toThrow(/row-level security policy/i);
  });

  it('no tenant context set fails closed for appointments', async () => {
    const clinic = await createTestClinic('ApptNoCtx');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000001021' });
    const practitioner = await createTestStaffMember(clinic.id, 'ApptNoCtx', {
      role: 'practitioner',
    });
    await withTenantContext(clinic.id, (client) =>
      insertBooked(
        client,
        clinic.id,
        patient.id,
        practitioner.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T09:30:00.000Z',
      ),
    );

    await expectFailClosed((client) => client.query('SELECT id FROM appointments'));
  });

  it('app_user has no DELETE grant on appointments', async () => {
    const clinic = await createTestClinic('ApptNoDelete');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000001022' });
    const practitioner = await createTestStaffMember(clinic.id, 'ApptNoDelete', {
      role: 'practitioner',
    });
    const id = await withTenantContext(clinic.id, (client) =>
      insertBooked(
        client,
        clinic.id,
        patient.id,
        practitioner.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T09:30:00.000Z',
      ),
    );

    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query('DELETE FROM appointments WHERE id = $1', [id]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('app_user has UPDATE on appointments (required for cancel/complete/reschedule)', async () => {
    const clinic = await createTestClinic('ApptHasUpdate');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000001023' });
    const practitioner = await createTestStaffMember(clinic.id, 'ApptHasUpdate', {
      role: 'practitioner',
    });
    const id = await withTenantContext(clinic.id, (client) =>
      insertBooked(
        client,
        clinic.id,
        patient.id,
        practitioner.id,
        '2026-09-17T09:00:00.000Z',
        '2026-09-17T09:30:00.000Z',
      ),
    );

    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query(
          `UPDATE appointments SET status = 'completed', updated_at = now() WHERE id = $1`,
          [id],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it('conversations exposes UNIQUE (id, patient_id) (S5)', async () => {
    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      const rows = await admin.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'conversations'::regclass AND conname = 'conversations_id_patient_key'`,
      );
      expect(rows.rows).toHaveLength(1);
    } finally {
      await admin.end();
    }
  });
});
