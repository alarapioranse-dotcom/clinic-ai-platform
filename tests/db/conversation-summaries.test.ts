import { describe, it, expect, afterAll } from 'vitest';
import { closePool } from '@/lib/db';
import { createPatient } from '@/features/patients';
import {
  receiveInboundMessage,
  sendStaffReply,
  listConversationSummariesForClinic,
} from '@/features/conversations';
import { createTestClinic, createTestStaffMember } from '../fixtures';

/**
 * The staff conversation list (`listConversationSummariesForClinic`): patient
 * name, latest message preview, most recent activity first, and the same RLS
 * isolation as the rest of the read path. Runs through `app_user` like every
 * other database test.
 */
describe('conversation summaries for the staff list', () => {
  afterAll(async () => {
    await closePool();
  });

  it("lists each conversation with its patient's name and latest message, newest first", async () => {
    const clinic = await createTestClinic('ConvSummaryOrder');
    const staff = await createTestStaffMember(clinic.id, 'summary-staff', { role: 'receptionist' });
    const older = await createPatient(clinic.id, {
      phoneNumber: '+201000000501',
      displayName: 'Synthetic Older',
    });
    const newer = await createPatient(clinic.id, { phoneNumber: '+201000000502' });

    // Each call is its own transaction, so `now()` grows from one to the next.
    const first = await receiveInboundMessage(clinic.id, older.id, 'first question');
    const second = await receiveInboundMessage(clinic.id, newer.id, 'second question');

    // With no reply yet, the newer conversation comes first.
    const beforeReply = await listConversationSummariesForClinic(clinic.id);
    expect(beforeReply.map((s) => s.id)).toEqual([second.conversationId, first.conversationId]);

    // A later staff reply makes the older conversation the most recent one.
    const reply = await sendStaffReply(clinic.id, first.conversationId, staff.id, 'staff answer');

    const summaries = await listConversationSummariesForClinic(clinic.id);

    expect(summaries.map((s) => s.id)).toEqual([first.conversationId, second.conversationId]);
    expect(summaries[0]).toMatchObject({
      patientId: older.id,
      patientName: 'Synthetic Older',
      lastMessage: { preview: 'staff answer', senderType: 'staff' },
    });
    expect(summaries[0]?.lastMessage?.sentAt.getTime()).toBe(reply.sentAt.getTime());
    expect(summaries[1]).toMatchObject({
      patientId: newer.id,
      patientName: null,
      lastMessage: { preview: 'second question', senderType: 'patient' },
    });
  });

  it('cuts the preview to 140 characters', async () => {
    const clinic = await createTestClinic('ConvSummaryPreview');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000503' });
    const long = 'ά'.repeat(200);
    await receiveInboundMessage(clinic.id, patient.id, long);

    const summaries = await listConversationSummariesForClinic(clinic.id);

    expect(summaries[0]?.lastMessage?.preview).toBe('ά'.repeat(140));
  });

  it("never lists another clinic's conversations, names or messages", async () => {
    const clinicA = await createTestClinic('ConvSummaryIsoA');
    const clinicB = await createTestClinic('ConvSummaryIsoB');
    const patientB = await createPatient(clinicB.id, {
      phoneNumber: '+201000000504',
      displayName: 'Synthetic Clinic B Patient',
    });
    const { conversationId } = await receiveInboundMessage(
      clinicB.id,
      patientB.id,
      'clinic B secret',
    );

    const visibleToA = await listConversationSummariesForClinic(clinicA.id);

    expect(visibleToA.map((s) => s.id)).not.toContain(conversationId);
    expect(JSON.stringify(visibleToA)).not.toContain('Synthetic Clinic B Patient');
    expect(JSON.stringify(visibleToA)).not.toContain('clinic B secret');
  });
});
