import { describe, it, expect, afterAll } from 'vitest';
import { closePool } from '@/lib/db';
import { createPatient } from '@/features/patients';
import {
  receiveInboundMessage,
  listConversationsForClinic,
  getConversation,
} from '@/features/conversations';
import { createTestClinic } from '../../fixtures';

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
});
