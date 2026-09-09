import { describe, it, expect, afterAll } from 'vitest';
import { closePool, withTenantContext } from '@/lib/db';
import { createPatient } from '@/features/patients';
import { receiveInboundMessage } from '@/features/conversations';
import { createTestClinic } from '../../fixtures';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Feature-level coverage for `receiveInboundMessage` (roadmap P3-A). Runs
 * against a real Postgres instance through `app_user`, same precondition as
 * every other test here — see tests/db/tenant-isolation.test.ts.
 */
describe('receiveInboundMessage', () => {
  afterAll(async () => {
    await closePool();
  });

  it('creates exactly one conversation and one message on the first inbound message', async () => {
    const clinic = await createTestClinic('Receive1');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000301' });

    const result = await receiveInboundMessage(
      clinic.id,
      patient.id,
      'Hello, I need an appointment',
    );

    expect(result.conversationId).toMatch(UUID_PATTERN);
    expect(result.messageId).toMatch(UUID_PATTERN);

    const rows = await withTenantContext(clinic.id, (client) =>
      client.query(
        `SELECT c.id AS conversation_id, c.clinic_id AS conversation_clinic_id,
                m.id AS message_id, m.clinic_id AS message_clinic_id
         FROM conversations c
         JOIN messages m ON m.conversation_id = c.id
         WHERE c.patient_id = $1`,
        [patient.id],
      ),
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].conversation_id).toBe(result.conversationId);
    expect(rows.rows[0].message_id).toBe(result.messageId);
    expect(rows.rows[0].message_clinic_id).toBe(rows.rows[0].conversation_clinic_id);
  });

  it('a second inbound message from the same patient reuses the existing conversation', async () => {
    const clinic = await createTestClinic('Receive2');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000302' });

    const first = await receiveInboundMessage(clinic.id, patient.id, 'First message');
    const second = await receiveInboundMessage(clinic.id, patient.id, 'Second message');

    expect(second.conversationId).toBe(first.conversationId);
    expect(second.messageId).not.toBe(first.messageId);

    const conversations = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM conversations WHERE patient_id = $1', [patient.id]),
    );
    expect(conversations.rows).toHaveLength(1);

    const messages = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM messages WHERE conversation_id = $1', [first.conversationId]),
    );
    expect(messages.rows).toHaveLength(2);
  });

  it.each(['', '   ', '\n\t'])('rejects content %j before writing any row', async (content) => {
    const clinic = await createTestClinic('Receive3');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000303' });

    await expect(receiveInboundMessage(clinic.id, patient.id, content)).rejects.toThrow(
      /content is required/,
    );

    const conversations = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM conversations WHERE patient_id = $1', [patient.id]),
    );
    expect(conversations.rows).toHaveLength(0);
  });

  it('two simultaneous inbound messages for the same patient resolve to one conversation containing both messages', async () => {
    const clinic = await createTestClinic('ReceiveConcurrent');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000304' });

    const [a, b] = await Promise.all([
      receiveInboundMessage(clinic.id, patient.id, 'Concurrent message A'),
      receiveInboundMessage(clinic.id, patient.id, 'Concurrent message B'),
    ]);

    expect(a.conversationId).toBe(b.conversationId);
    expect(a.messageId).not.toBe(b.messageId);

    const conversations = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM conversations WHERE patient_id = $1', [patient.id]),
    );
    expect(conversations.rows).toHaveLength(1);

    const messages = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM messages WHERE conversation_id = $1', [a.conversationId]),
    );
    expect(messages.rows.map((row) => row.id).sort()).toEqual([a.messageId, b.messageId].sort());
  });
});
