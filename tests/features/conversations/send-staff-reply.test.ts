import { describe, it, expect, afterAll } from 'vitest';
import { closePool, withTenantContext, withoutTenantContext } from '@/lib/db';
import { createPatient } from '@/features/patients';
import {
  receiveInboundMessage,
  sendStaffReply,
  getConversation,
  ConversationNotFoundError,
} from '@/features/conversations';
import { createTestClinic, createTestStaffMember } from '../../fixtures';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Feature-level coverage for `sendStaffReply` (roadmap P3-C). Runs against a
 * real Postgres instance through `app_user`, same precondition as every
 * other test here — see tests/db/tenant-isolation.test.ts.
 */
describe('sendStaffReply', () => {
  afterAll(async () => {
    await closePool();
  });

  it('appends a staff message with the correct conversation_id and the authenticated staff ID as sender', async () => {
    const clinic = await createTestClinic('StaffReply1');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000701' });
    const staff = await createTestStaffMember(clinic.id, 'StaffReply1', { role: 'receptionist' });
    const { conversationId } = await receiveInboundMessage(clinic.id, patient.id, 'hello');

    const message = await sendStaffReply(
      clinic.id,
      conversationId,
      staff.id,
      'On our way, thanks!',
    );

    expect(message.id).toMatch(UUID_PATTERN);
    expect(message.conversationId).toBe(conversationId);
    expect(message.senderType).toBe('staff');
    expect(message.senderStaffId).toBe(staff.id);
    expect(message.content).toBe('On our way, thanks!');
  });

  it('the new staff message is retrievable through getConversation', async () => {
    const clinic = await createTestClinic('StaffReply2');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000702' });
    const staff = await createTestStaffMember(clinic.id, 'StaffReply2', { role: 'owner' });
    const { conversationId } = await receiveInboundMessage(clinic.id, patient.id, 'hello');

    const message = await sendStaffReply(clinic.id, conversationId, staff.id, 'reply text');

    const detail = await getConversation(clinic.id, conversationId);
    expect(detail).not.toBeNull();
    const found = detail!.messages.find((m) => m.id === message.id);
    expect(found).toBeDefined();
    expect(found!.senderType).toBe('staff');
    expect(found!.senderStaffId).toBe(staff.id);
    expect(found!.content).toBe('reply text');
  });

  it.each(['', '   ', '\n\t'])('rejects content %j before writing any row', async (content) => {
    const clinic = await createTestClinic('StaffReply3');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000703' });
    const staff = await createTestStaffMember(clinic.id, 'StaffReply3');
    const { conversationId } = await receiveInboundMessage(clinic.id, patient.id, 'hello');

    await expect(sendStaffReply(clinic.id, conversationId, staff.id, content)).rejects.toThrow(
      /content is required/,
    );

    const messages = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM messages WHERE conversation_id = $1', [conversationId]),
    );
    expect(messages.rows).toHaveLength(1); // only the original inbound message
  });

  it('rejects a nonexistent conversation with ConversationNotFoundError, writing no row', async () => {
    const clinic = await createTestClinic('StaffReply4');
    const staff = await createTestStaffMember(clinic.id, 'StaffReply4');

    await expect(
      sendStaffReply(clinic.id, NONEXISTENT_ID, staff.id, 'hello'),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);

    const messages = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM messages WHERE sender_staff_id = $1', [staff.id]),
    );
    expect(messages.rows).toHaveLength(0);
  });

  it("rejects another clinic's conversation with ConversationNotFoundError, writing no row", async () => {
    const clinicOwn = await createTestClinic('StaffReply5Own');
    const clinicOther = await createTestClinic('StaffReply5Other');
    const staffOwn = await createTestStaffMember(clinicOwn.id, 'StaffReply5Own');
    const patientOther = await createPatient(clinicOther.id, { phoneNumber: '+201000000705' });
    const { conversationId: otherConversationId } = await receiveInboundMessage(
      clinicOther.id,
      patientOther.id,
      'other clinic message',
    );

    await expect(
      sendStaffReply(clinicOwn.id, otherConversationId, staffOwn.id, 'hello'),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);

    const messages = await withTenantContext(clinicOwn.id, (client) =>
      client.query('SELECT id FROM messages WHERE sender_staff_id = $1', [staffOwn.id]),
    );
    expect(messages.rows).toHaveLength(0);
  });

  it('a forced failure later in the same transaction rolls back an already-inserted staff message', async () => {
    const clinic = await createTestClinic('StaffReply6');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000706' });
    const staff = await createTestStaffMember(clinic.id, 'StaffReply6');
    const { conversationId } = await receiveInboundMessage(clinic.id, patient.id, 'hello');

    await expect(
      withTenantContext(clinic.id, async (client) => {
        await client.query(
          `INSERT INTO messages (clinic_id, conversation_id, sender_type, sender_staff_id, content)
           VALUES ($1, $2, 'staff', $3, 'this insert should not survive')`,
          [clinic.id, conversationId, staff.id],
        );
        // Forced failure after the staff message insert above, in the same
        // transaction: 'assistant' is outside sender_type's allowed set
        // ('patient', 'staff'), violating messages_sender_type_check.
        await client.query(
          `INSERT INTO messages (clinic_id, conversation_id, sender_type, content)
           VALUES ($1, $2, 'assistant', 'forced failure')`,
          [clinic.id, conversationId],
        );
      }),
    ).rejects.toThrow(/violates check constraint/i);

    const messages = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM messages WHERE content = $1', [
        'this insert should not survive',
      ]),
    );
    expect(messages.rows).toHaveLength(0);
  });

  it('a raw staff-message insert with no tenant context set fails closed', async () => {
    const clinic = await createTestClinic('StaffReply7');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000707' });
    const staff = await createTestStaffMember(clinic.id, 'StaffReply7');
    const { conversationId } = await receiveInboundMessage(clinic.id, patient.id, 'hello');

    await expect(
      withoutTenantContext((client) =>
        client.query(
          `INSERT INTO messages (clinic_id, conversation_id, sender_type, sender_staff_id, content)
           VALUES ($1, $2, 'staff', $3, 'should never be written')`,
          [clinic.id, conversationId, staff.id],
        ),
      ),
      // No tenant context set means `app.current_clinic_id` is unset; the
      // RLS WITH CHECK clause casts it to uuid, which Postgres rejects as an
      // invalid empty-string uuid before it ever gets to compare against
      // clinic_id — same fail-closed outcome as an explicit RLS denial, and
      // the same two-shape assertion tests/db/*-isolation.test.ts use for
      // this exact case.
    ).rejects.toThrow(/row-level security policy|invalid input syntax for type uuid/i);

    const messages = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM messages WHERE content = $1', ['should never be written']),
    );
    expect(messages.rows).toHaveLength(0);
  });
});
