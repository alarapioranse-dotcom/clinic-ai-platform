import { describe, it, expect, afterAll } from 'vitest';
import { closePool, withTenantContext } from '@/lib/db';
import { createPatient } from '@/features/patients';
import { receiveInboundMessage } from '@/features/conversations';
import {
  bookAppointment,
  getAvailableSlots,
  listPractitionersForClinic,
  PractitionerNotFoundError,
  PatientNotFoundError,
  ConversationPatientMismatchError,
  AppointmentConflictError,
} from '@/features/appointments';
import { createTestClinic, createTestStaffMember, setClinicWorkingHours } from '../../fixtures';

/**
 * Feature-level coverage for `src/features/appointments` (roadmap P4 Slice
 * 1): `bookAppointment`, `getAvailableSlots`, `listPractitionersForClinic`,
 * and the concurrency behavior the P4 Design Gate's Booking section
 * requires. Runs against a real Postgres instance through `app_user`, same
 * precondition as every other feature test in this repo.
 */
describe('bookAppointment', () => {
  afterAll(async () => {
    await closePool();
  });

  it('books an appointment with no conversation', async () => {
    const clinic = await createTestClinic('BookNoConv');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000002001' });
    const practitioner = await createTestStaffMember(clinic.id, 'BookNoConv', {
      role: 'practitioner',
    });

    const appointment = await bookAppointment(clinic.id, {
      patientId: patient.id,
      practitionerId: practitioner.id,
      conversationId: null,
      startsAt: new Date('2026-09-17T09:00:00.000Z'),
      endsAt: new Date('2026-09-17T09:30:00.000Z'),
    });

    expect(appointment.status).toBe('booked');
    expect(appointment.conversationId).toBeNull();
    expect(appointment.clinicId).toBe(clinic.id);
  });

  it('books an appointment linked to its originating conversation, preserving patient identity', async () => {
    const clinic = await createTestClinic('BookWithConv');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000002002' });
    const practitioner = await createTestStaffMember(clinic.id, 'BookWithConv', {
      role: 'practitioner',
    });
    const { conversationId } = await receiveInboundMessage(clinic.id, patient.id, 'I need a visit');

    const appointment = await bookAppointment(clinic.id, {
      patientId: patient.id,
      practitionerId: practitioner.id,
      conversationId,
      startsAt: new Date('2026-09-17T09:00:00.000Z'),
      endsAt: new Date('2026-09-17T09:30:00.000Z'),
    });

    expect(appointment.conversationId).toBe(conversationId);
    expect(appointment.patientId).toBe(patient.id);
  });

  it('throws PractitionerNotFoundError for a nonexistent practitionerId', async () => {
    const clinic = await createTestClinic('BookBadPractitioner');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000002003' });

    await expect(
      bookAppointment(clinic.id, {
        patientId: patient.id,
        practitionerId: '00000000-0000-0000-0000-000000000000',
        conversationId: null,
        startsAt: new Date('2026-09-17T09:00:00.000Z'),
        endsAt: new Date('2026-09-17T09:30:00.000Z'),
      }),
    ).rejects.toThrow(PractitionerNotFoundError);
  });

  it('throws PractitionerNotFoundError for a staff member who is not a practitioner', async () => {
    const clinic = await createTestClinic('BookNonPractitionerRole');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000002004' });
    const receptionist = await createTestStaffMember(clinic.id, 'BookNonPractitionerRole', {
      role: 'receptionist',
    });

    await expect(
      bookAppointment(clinic.id, {
        patientId: patient.id,
        practitionerId: receptionist.id,
        conversationId: null,
        startsAt: new Date('2026-09-17T09:00:00.000Z'),
        endsAt: new Date('2026-09-17T09:30:00.000Z'),
      }),
    ).rejects.toThrow(PractitionerNotFoundError);
  });

  it('throws PractitionerNotFoundError for a practitioner belonging to another clinic', async () => {
    const clinicA = await createTestClinic('BookCrossPractitionerA');
    const clinicB = await createTestClinic('BookCrossPractitionerB');
    const patientA = await createPatient(clinicA.id, { phoneNumber: '+201000002005' });
    const practitionerB = await createTestStaffMember(clinicB.id, 'BookCrossPractitionerB', {
      role: 'practitioner',
    });

    await expect(
      bookAppointment(clinicA.id, {
        patientId: patientA.id,
        practitionerId: practitionerB.id,
        conversationId: null,
        startsAt: new Date('2026-09-17T09:00:00.000Z'),
        endsAt: new Date('2026-09-17T09:30:00.000Z'),
      }),
    ).rejects.toThrow(PractitionerNotFoundError);
  });

  it('throws PatientNotFoundError for a patient belonging to another clinic', async () => {
    const clinicA = await createTestClinic('BookCrossPatientA');
    const clinicB = await createTestClinic('BookCrossPatientB');
    const patientB = await createPatient(clinicB.id, { phoneNumber: '+201000002006' });
    const practitionerA = await createTestStaffMember(clinicA.id, 'BookCrossPatientA', {
      role: 'practitioner',
    });

    await expect(
      bookAppointment(clinicA.id, {
        patientId: patientB.id,
        practitionerId: practitionerA.id,
        conversationId: null,
        startsAt: new Date('2026-09-17T09:00:00.000Z'),
        endsAt: new Date('2026-09-17T09:30:00.000Z'),
      }),
    ).rejects.toThrow(PatientNotFoundError);
  });

  it('throws ConversationPatientMismatchError when conversationId belongs to a different patient', async () => {
    const clinic = await createTestClinic('BookConvMismatch');
    const conversationPatient = await createPatient(clinic.id, { phoneNumber: '+201000002007' });
    const otherPatient = await createPatient(clinic.id, { phoneNumber: '+201000002008' });
    const practitioner = await createTestStaffMember(clinic.id, 'BookConvMismatch', {
      role: 'practitioner',
    });
    const { conversationId } = await receiveInboundMessage(
      clinic.id,
      conversationPatient.id,
      'hello',
    );

    await expect(
      bookAppointment(clinic.id, {
        patientId: otherPatient.id,
        practitionerId: practitioner.id,
        conversationId,
        startsAt: new Date('2026-09-17T09:00:00.000Z'),
        endsAt: new Date('2026-09-17T09:30:00.000Z'),
      }),
    ).rejects.toThrow(ConversationPatientMismatchError);
  });

  it('throws AppointmentConflictError for an overlapping booking, with the stable user-facing message', async () => {
    const clinic = await createTestClinic('BookConflict');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000002009' });
    const practitioner = await createTestStaffMember(clinic.id, 'BookConflict', {
      role: 'practitioner',
    });

    await bookAppointment(clinic.id, {
      patientId: patient.id,
      practitionerId: practitioner.id,
      conversationId: null,
      startsAt: new Date('2026-09-17T09:00:00.000Z'),
      endsAt: new Date('2026-09-17T09:30:00.000Z'),
    });

    await expect(
      bookAppointment(clinic.id, {
        patientId: patient.id,
        practitionerId: practitioner.id,
        conversationId: null,
        startsAt: new Date('2026-09-17T09:15:00.000Z'),
        endsAt: new Date('2026-09-17T09:45:00.000Z'),
      }),
    ).rejects.toThrow('The selected appointment slot is no longer available.');
  });

  it('two concurrent bookings for the same practitioner/overlapping interval: exactly one succeeds, the loser is AppointmentConflictError', async () => {
    const clinic = await createTestClinic('BookConcurrent');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000002010' });
    const practitioner = await createTestStaffMember(clinic.id, 'BookConcurrent', {
      role: 'practitioner',
    });

    const attempt = () =>
      bookAppointment(clinic.id, {
        patientId: patient.id,
        practitionerId: practitioner.id,
        conversationId: null,
        startsAt: new Date('2026-09-17T09:00:00.000Z'),
        endsAt: new Date('2026-09-17T09:30:00.000Z'),
      });

    const results = await Promise.allSettled([attempt(), attempt()]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AppointmentConflictError);

    const rows = await withTenantContext(clinic.id, (client) =>
      client.query(`SELECT id FROM appointments WHERE patient_id = $1 AND status = 'booked'`, [
        patient.id,
      ]),
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe('listPractitionersForClinic', () => {
  afterAll(async () => {
    await closePool();
  });

  it('lists only active practitioners in this clinic', async () => {
    const clinic = await createTestClinic('ListPractitioners');
    const active = await createTestStaffMember(clinic.id, 'ListPractitionersActive', {
      role: 'practitioner',
    });
    await createTestStaffMember(clinic.id, 'ListPractitionersReceptionist', {
      role: 'receptionist',
    });
    await createTestStaffMember(clinic.id, 'ListPractitionersDeactivated', {
      role: 'practitioner',
      status: 'deactivated',
    });

    const practitioners = await listPractitionersForClinic(clinic.id);

    expect(practitioners.map((p) => p.id)).toEqual([active.id]);
  });
});

describe('getAvailableSlots', () => {
  afterAll(async () => {
    await closePool();
  });

  it('produces slots from the clinic default WorkingHours when the practitioner has no override', async () => {
    const clinic = await createTestClinic('AvailClinicDefault');
    await setClinicWorkingHours(clinic.id, { thursday: { start: '09:00', end: '10:00' } });
    const practitioner = await createTestStaffMember(clinic.id, 'AvailClinicDefault', {
      role: 'practitioner',
    });

    // 2026-09-17 is a Thursday.
    const slots = await getAvailableSlots(clinic.id, practitioner.id, '2026-09-17', 30);

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

  it("a practitioner's own WorkingHours override replaces the clinic default entirely", async () => {
    const clinic = await createTestClinic('AvailPractitionerOverride');
    await setClinicWorkingHours(clinic.id, { thursday: { start: '09:00', end: '10:00' } });
    const practitioner = await createTestStaffMember(clinic.id, 'AvailPractitionerOverride', {
      role: 'practitioner',
      workingHours: { thursday: { start: '13:00', end: '14:00' } },
    });

    const slots = await getAvailableSlots(clinic.id, practitioner.id, '2026-09-17', 60);

    expect(slots).toEqual([
      {
        startsAt: new Date('2026-09-17T13:00:00.000Z'),
        endsAt: new Date('2026-09-17T14:00:00.000Z'),
      },
    ]);
  });

  it('an existing active appointment removes conflicting availability', async () => {
    const clinic = await createTestClinic('AvailActiveRemoves');
    await setClinicWorkingHours(clinic.id, { thursday: { start: '09:00', end: '10:00' } });
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000002011' });
    const practitioner = await createTestStaffMember(clinic.id, 'AvailActiveRemoves', {
      role: 'practitioner',
    });

    await bookAppointment(clinic.id, {
      patientId: patient.id,
      practitionerId: practitioner.id,
      conversationId: null,
      startsAt: new Date('2026-09-17T09:00:00.000Z'),
      endsAt: new Date('2026-09-17T09:30:00.000Z'),
    });

    const slots = await getAvailableSlots(clinic.id, practitioner.id, '2026-09-17', 30);

    expect(slots).toEqual([
      {
        startsAt: new Date('2026-09-17T09:30:00.000Z'),
        endsAt: new Date('2026-09-17T10:00:00.000Z'),
      },
    ]);
  });

  it('a cancelled appointment does not remove availability', async () => {
    const clinic = await createTestClinic('AvailCancelledKeeps');
    await setClinicWorkingHours(clinic.id, { thursday: { start: '09:00', end: '10:00' } });
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000002012' });
    const practitioner = await createTestStaffMember(clinic.id, 'AvailCancelledKeeps', {
      role: 'practitioner',
    });

    const appointment = await bookAppointment(clinic.id, {
      patientId: patient.id,
      practitionerId: practitioner.id,
      conversationId: null,
      startsAt: new Date('2026-09-17T09:00:00.000Z'),
      endsAt: new Date('2026-09-17T09:30:00.000Z'),
    });
    await withTenantContext(clinic.id, (client) =>
      client.query(
        `UPDATE appointments SET status = 'cancelled', updated_at = now() WHERE id = $1`,
        [appointment.id],
      ),
    );

    const slots = await getAvailableSlots(clinic.id, practitioner.id, '2026-09-17', 30);

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

  it('a completed appointment does not remove availability', async () => {
    const clinic = await createTestClinic('AvailCompletedKeeps');
    await setClinicWorkingHours(clinic.id, { thursday: { start: '09:00', end: '10:00' } });
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000002013' });
    const practitioner = await createTestStaffMember(clinic.id, 'AvailCompletedKeeps', {
      role: 'practitioner',
    });

    const appointment = await bookAppointment(clinic.id, {
      patientId: patient.id,
      practitionerId: practitioner.id,
      conversationId: null,
      startsAt: new Date('2026-09-17T09:00:00.000Z'),
      endsAt: new Date('2026-09-17T09:30:00.000Z'),
    });
    await withTenantContext(clinic.id, (client) =>
      client.query(
        `UPDATE appointments SET status = 'completed', updated_at = now() WHERE id = $1`,
        [appointment.id],
      ),
    );

    const slots = await getAvailableSlots(clinic.id, practitioner.id, '2026-09-17', 30);

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

  it('performs zero writes', async () => {
    const clinic = await createTestClinic('AvailNoWrites');
    await setClinicWorkingHours(clinic.id, { thursday: { start: '09:00', end: '10:00' } });
    const practitioner = await createTestStaffMember(clinic.id, 'AvailNoWrites', {
      role: 'practitioner',
    });

    await getAvailableSlots(clinic.id, practitioner.id, '2026-09-17', 30);

    const rows = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM appointments'),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('throws PractitionerNotFoundError for a nonexistent practitioner', async () => {
    const clinic = await createTestClinic('AvailBadPractitioner');

    await expect(
      getAvailableSlots(clinic.id, '00000000-0000-0000-0000-000000000000', '2026-09-17', 30),
    ).rejects.toThrow(PractitionerNotFoundError);
  });

  it('converts clinic-local working hours to UTC using the clinic timezone (ADR-0016), for a non-UTC clinic', async () => {
    const clinic = await createTestClinic('AvailNonUtcClinic', 'Asia/Dubai');
    await setClinicWorkingHours(clinic.id, { thursday: { start: '09:00', end: '10:00' } });
    const practitioner = await createTestStaffMember(clinic.id, 'AvailNonUtcClinic', {
      role: 'practitioner',
    });

    // 09:00-10:00 in Asia/Dubai (constant UTC+4, no DST) is 05:00-06:00 UTC.
    const slots = await getAvailableSlots(clinic.id, practitioner.id, '2026-09-17', 30);

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

  it('resolves the same clinic-local working hours to a different UTC offset on either side of a real DST transition (Africa/Cairo)', async () => {
    const clinic = await createTestClinic('AvailDstClinic', 'Africa/Cairo');
    await setClinicWorkingHours(clinic.id, {
      thursday: { start: '09:00', end: '10:00' }, // 2026-04-23 is a Thursday (standard time, UTC+2)
      saturday: { start: '09:00', end: '10:00' }, // 2026-04-25 is a Saturday (daylight time, UTC+3)
    });
    const practitioner = await createTestStaffMember(clinic.id, 'AvailDstClinic', {
      role: 'practitioner',
    });

    const beforeDst = await getAvailableSlots(clinic.id, practitioner.id, '2026-04-23', 60);
    const afterDst = await getAvailableSlots(clinic.id, practitioner.id, '2026-04-25', 60);

    expect(beforeDst).toEqual([
      {
        startsAt: new Date('2026-04-23T07:00:00.000Z'),
        endsAt: new Date('2026-04-23T08:00:00.000Z'),
      },
    ]);
    expect(afterDst).toEqual([
      {
        startsAt: new Date('2026-04-25T06:00:00.000Z'),
        endsAt: new Date('2026-04-25T07:00:00.000Z'),
      },
    ]);
  });

  it('returns no slots for a date whose window falls inside a DST spring-forward gap', async () => {
    const clinic = await createTestClinic('AvailDstGap', 'Africa/Cairo');
    // 2026-04-24 is a Friday; Cairo's local clock skips 00:00-01:00 that day.
    await setClinicWorkingHours(clinic.id, { friday: { start: '00:15', end: '01:15' } });
    const practitioner = await createTestStaffMember(clinic.id, 'AvailDstGap', {
      role: 'practitioner',
    });

    const slots = await getAvailableSlots(clinic.id, practitioner.id, '2026-04-24', 30);

    expect(slots).toEqual([]);
  });

  it("a practitioner's WorkingHours override is interpreted in the clinic's timezone, not a timezone of its own", async () => {
    const clinic = await createTestClinic('AvailOverrideClinicZone', 'Asia/Dubai');
    await setClinicWorkingHours(clinic.id, { thursday: { start: '01:00', end: '02:00' } });
    const practitioner = await createTestStaffMember(clinic.id, 'AvailOverrideClinicZone', {
      role: 'practitioner',
      workingHours: { thursday: { start: '09:00', end: '10:00' } },
    });

    // The override's 09:00-10:00 must still convert via the clinic's Asia/Dubai
    // (UTC+4) zone, exactly like the clinic default would -- 05:00-06:00 UTC.
    const slots = await getAvailableSlots(clinic.id, practitioner.id, '2026-09-17', 30);

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

  it('an existing active appointment near a clinic-local midnight boundary still removes conflicting availability for a non-UTC clinic', async () => {
    const clinic = await createTestClinic('AvailNonUtcActiveRemoves', 'Asia/Dubai');
    await setClinicWorkingHours(clinic.id, { thursday: { start: '09:00', end: '10:00' } });
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000002014' });
    const practitioner = await createTestStaffMember(clinic.id, 'AvailNonUtcActiveRemoves', {
      role: 'practitioner',
    });

    // 09:00-09:30 Asia/Dubai (UTC+4) is 05:00-05:30 UTC.
    await bookAppointment(clinic.id, {
      patientId: patient.id,
      practitionerId: practitioner.id,
      conversationId: null,
      startsAt: new Date('2026-09-17T05:00:00.000Z'),
      endsAt: new Date('2026-09-17T05:30:00.000Z'),
    });

    const slots = await getAvailableSlots(clinic.id, practitioner.id, '2026-09-17', 30);

    expect(slots).toEqual([
      {
        startsAt: new Date('2026-09-17T05:30:00.000Z'),
        endsAt: new Date('2026-09-17T06:00:00.000Z'),
      },
    ]);
  });
});
