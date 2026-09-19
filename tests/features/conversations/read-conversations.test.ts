import { describe, it, expect, afterAll } from 'vitest';
import { closePool } from '@/lib/db';
import { createPatient } from '@/features/patients';
import {
  receiveInboundMessage,
  listConversationsForClinic,
  getConversation,
} from '@/features/conversations';
import { bookAppointment } from '@/features/appointments';
import { createTestClinic, createTestStaffMember } from '../../fixtures';

/**
 * Feature-level coverage for the P3-B read path (`listConversationsForClinic`,
 * `getConversation`). Runs against a real Postgres instance through
 * `app_user`, same precondition as every other test here — see
 * tests/db/tenant-isolation.test.ts. Uses only synthetic clinic/patient data
 * created by tests/fixtures.ts, never real patient data (CLAUDE.md hard
 * rule).
 */
describe('listConversationsForClinic', () => {
  afterAll(async () => {
    await closePool();
  });

  it('a clinic with conversations receives its conversations', async () => {
    const clinic = await createTestClinic('ReadConvList1');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000501' });
    const { conversationId } = await receiveInboundMessage(clinic.id, patient.id, 'hello');

    const conversations = await listConversationsForClinic(clinic.id);

    expect(conversations.map((c) => c.id)).toContain(conversationId);
  });

  it('a clinic with no conversations receives an empty list', async () => {
    const clinic = await createTestClinic('ReadConvList2');

    const conversations = await listConversationsForClinic(clinic.id);

    expect(conversations).toEqual([]);
  });
});

describe('getConversation', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns the conversation plus its messages in chronological order', async () => {
    const clinic = await createTestClinic('ReadConvDetail1');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000502' });
    const first = await receiveInboundMessage(clinic.id, patient.id, 'first message');
    const second = await receiveInboundMessage(clinic.id, patient.id, 'second message');

    const result = await getConversation(clinic.id, first.conversationId);

    expect(result).not.toBeNull();
    expect(result?.conversation.id).toBe(first.conversationId);
    expect(result?.messages.map((m) => m.id)).toEqual([first.messageId, second.messageId]);
    for (let i = 1; i < (result?.messages.length ?? 0); i++) {
      expect(result!.messages[i]!.sentAt.getTime()).toBeGreaterThanOrEqual(
        result!.messages[i - 1]!.sentAt.getTime(),
      );
    }
  });

  it('returns null for a nonexistent conversation ID', async () => {
    const clinic = await createTestClinic('ReadConvDetail2');

    const result = await getConversation(clinic.id, '00000000-0000-0000-0000-000000000000');

    expect(result).toBeNull();
  });

  it("returns null for another clinic's conversation under the calling clinic context", async () => {
    const clinicOwn = await createTestClinic('ReadConvDetail3Own');
    const clinicOther = await createTestClinic('ReadConvDetail3Other');
    const patientOther = await createPatient(clinicOther.id, { phoneNumber: '+201000000503' });
    const { conversationId } = await receiveInboundMessage(
      clinicOther.id,
      patientOther.id,
      'hello from the other clinic',
    );

    const result = await getConversation(clinicOwn.id, conversationId);

    expect(result).toBeNull();
  });

  /**
   * Conversation-detail appointment readback (roadmap P4 closure slice):
   * booking persists the appointment and its conversation link
   * (`bookAppointment`, `db/migrations/0011_appointments.sql`), but until
   * this slice `getConversation` never read it back — this is the read side.
   */
  it('includes an appointment booked from this conversation', async () => {
    const clinic = await createTestClinic('ReadConvApptLinked');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000504' });
    const practitioner = await createTestStaffMember(clinic.id, 'ReadConvApptLinked', {
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

    const result = await getConversation(clinic.id, conversationId);

    expect(result).not.toBeNull();
    expect(result?.appointments).toEqual([
      {
        id: appointment.id,
        practitionerId: practitioner.id,
        startsAt: new Date('2026-09-17T09:00:00.000Z'),
        endsAt: new Date('2026-09-17T09:30:00.000Z'),
        status: 'booked',
      },
    ]);
  });

  it('returns an empty appointments array when no appointment is linked to this conversation', async () => {
    const clinic = await createTestClinic('ReadConvApptNone');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000505' });
    const { conversationId } = await receiveInboundMessage(clinic.id, patient.id, 'hello');

    const result = await getConversation(clinic.id, conversationId);

    expect(result?.appointments).toEqual([]);
  });

  it("does not leak another clinic's conversation or its linked appointment (tenant isolation on the readback)", async () => {
    const clinicOwn = await createTestClinic('ReadConvApptIsoOwn');
    const clinicOther = await createTestClinic('ReadConvApptIsoOther');
    const patientOther = await createPatient(clinicOther.id, { phoneNumber: '+201000000506' });
    const practitionerOther = await createTestStaffMember(clinicOther.id, 'ReadConvApptIsoOther', {
      role: 'practitioner',
    });
    const { conversationId } = await receiveInboundMessage(
      clinicOther.id,
      patientOther.id,
      'other clinic message',
    );
    await bookAppointment(clinicOther.id, {
      patientId: patientOther.id,
      practitionerId: practitionerOther.id,
      conversationId,
      startsAt: new Date('2026-09-17T09:00:00.000Z'),
      endsAt: new Date('2026-09-17T09:30:00.000Z'),
    });

    const result = await getConversation(clinicOwn.id, conversationId);

    expect(result).toBeNull();
  });
});
