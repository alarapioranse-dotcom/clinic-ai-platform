import { describe, it, expect, afterAll } from 'vitest';
import { Client, type PoolClient, type QueryResult } from 'pg';
import { withTenantContext, withoutTenantContext, closePool } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { createPatient } from '@/features/patients';
import { receiveInboundMessage } from '@/features/conversations';
import { createTestClinic } from '../fixtures';

/**
 * Same fail-closed helper as tests/db/tenant-isolation.test.ts — see that
 * file's comment for why both outcomes (zero rows, or a uuid cast error)
 * count as passing.
 */
async function expectFailClosed(run: (client: PoolClient) => Promise<QueryResult>): Promise<void> {
  try {
    const result = await withoutTenantContext(run);
    expect(result.rows).toHaveLength(0);
  } catch (err) {
    expect((err as Error).message).toMatch(/invalid input syntax for type uuid/i);
  }
}

/**
 * Database-layer coverage for `conversations`/`messages` (roadmap P3-A):
 * RLS tenant isolation, the composite foreign keys, atomicity, and the
 * deferred "at least one message" constraint trigger. Every assertion here
 * runs against a real Postgres instance through the least-privilege
 * `app_user` role, per docs/technical/02-tenant-isolation-testing.md's
 * precondition for a meaningful RLS test.
 */
describe('tenant isolation: conversations and messages', () => {
  afterAll(async () => {
    await closePool();
  });

  it('Clinic A cannot see Clinic B conversations or messages', async () => {
    const clinicA = await createTestClinic('ConvIsoA');
    const clinicB = await createTestClinic('ConvIsoB');
    const patientB = await createPatient(clinicB.id, { phoneNumber: '+201000000401' });
    const { conversationId, messageId } = await receiveInboundMessage(
      clinicB.id,
      patientB.id,
      'hello from clinic B',
    );

    const conversationsVisibleToA = await withTenantContext(clinicA.id, (client) =>
      client.query('SELECT id FROM conversations'),
    );
    const messagesVisibleToA = await withTenantContext(clinicA.id, (client) =>
      client.query('SELECT id FROM messages'),
    );

    expect(conversationsVisibleToA.rows.map((row) => row.id)).not.toContain(conversationId);
    expect(messagesVisibleToA.rows.map((row) => row.id)).not.toContain(messageId);
  });

  it('no tenant context set fails closed for conversations', async () => {
    const clinicA = await createTestClinic('ConvIsoNoCtxConv');
    const patientA = await createPatient(clinicA.id, { phoneNumber: '+201000000402' });
    await receiveInboundMessage(clinicA.id, patientA.id, 'hello');

    await expectFailClosed((client) => client.query('SELECT id FROM conversations'));
  });

  it('no tenant context set fails closed for messages', async () => {
    const clinicA = await createTestClinic('ConvIsoNoCtxMsg');
    const patientA = await createPatient(clinicA.id, { phoneNumber: '+201000000403' });
    await receiveInboundMessage(clinicA.id, patientA.id, 'hello');

    await expectFailClosed((client) => client.query('SELECT id FROM messages'));
  });

  it('rejects a conversation whose patient_id belongs to a different clinic, via the composite FK', async () => {
    const clinicA = await createTestClinic('ConvIsoFkA');
    const clinicB = await createTestClinic('ConvIsoFkB');
    const patientB = await createPatient(clinicB.id, { phoneNumber: '+201000000404' });

    // Bypasses the conversations feature's own repository (which never lets
    // a caller do this) to prove the *database*, not application code, is
    // what rejects a cross-clinic patient_id — same pattern as
    // tests/db/tenant-isolation.test.ts's equivalent patients test.
    await expect(
      withTenantContext(clinicA.id, (client) =>
        client.query(`INSERT INTO conversations (clinic_id, patient_id) VALUES ($1, $2)`, [
          clinicA.id,
          patientB.id,
        ]),
      ),
    ).rejects.toThrow(/violates foreign key constraint|conversations_patient_same_clinic/i);

    const visibleToA = await withTenantContext(clinicA.id, (client) =>
      client.query('SELECT id FROM conversations WHERE patient_id = $1', [patientB.id]),
    );
    expect(visibleToA.rows).toHaveLength(0);
  });

  it('rolls back atomically: a forced failure on the message insert leaves no orphan conversation committed', async () => {
    const clinic = await createTestClinic('ConvIsoRollback');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000405' });

    await expect(
      withTenantContext(clinic.id, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO conversations (clinic_id, patient_id) VALUES ($1, $2) RETURNING id`,
          [clinic.id, patient.id],
        );
        const conversationId = rows[0]!.id;
        // Forced failure: 'assistant' is outside messages.sender_type's
        // allowed set for this slice ('patient' only), violating the CHECK
        // constraint at the database layer after the conversation insert
        // above has already run in this same transaction.
        await client.query(
          `INSERT INTO messages (clinic_id, conversation_id, sender_type, content)
           VALUES ($1, $2, 'assistant', 'forced failure')`,
          [clinic.id, conversationId],
        );
      }),
    ).rejects.toThrow(/violates check constraint/i);

    const conversations = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM conversations WHERE patient_id = $1', [patient.id]),
    );
    expect(conversations.rows).toHaveLength(0);
  });

  it("rejects committing a delete of a conversation's last message (deferred constraint trigger)", async () => {
    // The trigger fires AFTER INSERT OR DELETE ON messages (exactly as
    // specified in docs/technical/01-database-schema.md's "messages"
    // section) — it never fires for a bare `conversations` insert with no
    // message-table activity at all, only for a change to `messages` that
    // would leave some conversation with zero rows. app_user has no DELETE
    // grant on messages (Architect ruling: messages are immutable once
    // sent), so this exercises the trigger through the owner/migration
    // connection instead, the same way tests/db/seed.test.ts's atomicity
    // test uses DATABASE_URL directly.
    const clinic = await createTestClinic('ConvIsoTrigger');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000406' });
    const { messageId } = await receiveInboundMessage(clinic.id, patient.id, 'the only message');

    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      await admin.query('BEGIN');
      await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinic.id]);
      await admin.query('DELETE FROM messages WHERE id = $1', [messageId]);
      await expect(admin.query('COMMIT')).rejects.toThrow(/has no messages/i);
    } finally {
      await admin.query('ROLLBACK').catch(() => {});
      await admin.end();
    }
  });

  it('rejects a bare conversation insert with no message ever inserted for it (deferred constraint trigger)', async () => {
    // The other mutation path the deferred check must cover: a conversation
    // insert with no message INSERT or DELETE against `messages` at all in
    // the same transaction — the gap the `messages`-only trigger above
    // leaves open (Architect review on this migration's first draft).
    const clinic = await createTestClinic('ConvIsoBareInsert');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000407' });

    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query(`INSERT INTO conversations (clinic_id, patient_id) VALUES ($1, $2)`, [
          clinic.id,
          patient.id,
        ]),
      ),
    ).rejects.toThrow(/has no messages/i);

    const conversations = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM conversations WHERE patient_id = $1', [patient.id]),
    );
    expect(conversations.rows).toHaveLength(0);
  });

  it('the ordinary insert-conversation-then-insert-its-first-message transaction still succeeds', async () => {
    // Both deferred triggers fire at commit; the message row already exists
    // in the database by then, so neither trigger blocks the intended
    // "create conversation, then insert its first message" order.
    const clinic = await createTestClinic('ConvIsoNormalFlow');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000408' });

    const conversationId = await withTenantContext(clinic.id, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO conversations (clinic_id, patient_id) VALUES ($1, $2) RETURNING id`,
        [clinic.id, patient.id],
      );
      const id = rows[0]!.id;
      await client.query(
        `INSERT INTO messages (clinic_id, conversation_id, sender_type, content)
         VALUES ($1, $2, 'patient', 'first message')`,
        [clinic.id, id],
      );
      return id;
    });

    const conversations = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM conversations WHERE id = $1', [conversationId]),
    );
    expect(conversations.rows).toHaveLength(1);
  });

  it('a second message insert into an already-existing conversation still succeeds', async () => {
    const clinic = await createTestClinic('ConvIsoSecondMsg');
    const patient = await createPatient(clinic.id, { phoneNumber: '+201000000409' });
    const { conversationId } = await receiveInboundMessage(clinic.id, patient.id, 'first message');

    await withTenantContext(clinic.id, (client) =>
      client.query(
        `INSERT INTO messages (clinic_id, conversation_id, sender_type, content)
         VALUES ($1, $2, 'patient', 'second message')`,
        [clinic.id, conversationId],
      ),
    );

    const messages = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT id FROM messages WHERE conversation_id = $1', [conversationId]),
    );
    expect(messages.rows).toHaveLength(2);
  });
});
