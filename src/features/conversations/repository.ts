import type { PoolClient } from 'pg';

/**
 * Internal to this feature — not exported from `./index.ts`. Nothing outside
 * `src/features/conversations/**` may import this module directly (see
 * CONTRIBUTING.md, "a feature never imports another feature's internals").
 */

export interface ReceiveInboundMessageResult {
  conversationId: string;
  messageId: string;
}

export interface Conversation {
  id: string;
  clinicId: string;
  patientId: string;
  createdAt: Date;
}

export interface Message {
  id: string;
  clinicId: string;
  conversationId: string;
  senderType: string;
  content: string;
  sentAt: Date;
}

export interface ConversationWithMessages {
  conversation: Conversation;
  messages: Message[];
}

interface ConversationRow {
  id: string;
}

interface MessageRow {
  id: string;
}

interface ConversationDetailRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  created_at: Date;
}

interface MessageDetailRow {
  id: string;
  clinic_id: string;
  conversation_id: string;
  sender_type: string;
  content: string;
  sent_at: Date;
}

function toConversation(row: ConversationDetailRow): Conversation {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    createdAt: row.created_at,
  };
}

function toMessage(row: MessageDetailRow): Message {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    conversationId: row.conversation_id,
    senderType: row.sender_type,
    content: row.content,
    sentAt: row.sent_at,
  };
}

/**
 * Finds or creates the patient's conversation in this clinic, then inserts
 * their inbound message into it — all inside the transaction the caller
 * already opened via `withTenantContext`.
 *
 * CONCURRENCY (roadmap P3-A, mandatory requirement): find-or-create via
 * SELECT-then-INSERT has a race — two simultaneous inbound messages for the
 * same patient could each see "no conversation yet" and create two. This is
 * closed with `SELECT ... FOR UPDATE` on the patient's own row, which
 * serializes concurrent calls for the same patient: the second call's lock
 * acquisition blocks until the first call's transaction commits (or rolls
 * back), so by the time it proceeds, the conversation the first call created
 * (if any) is already visible to it. This relies on `app_user` holding the
 * UPDATE privilege on `patients` — Postgres's `FOR UPDATE` requires UPDATE
 * (or DELETE), not merely SELECT — granted by
 * `db/migrations/0004_patients.sql` and not revoked by any later migration.
 * No advisory lock, unique constraint, retry loop, or isolation-level change
 * is used (Architect ruling: those are inventing an alternative mechanism).
 *
 * A `patientId` from a different clinic locks nothing (RLS filters it to
 * zero rows) and is rejected downstream by the `conversations_patient_same_clinic`
 * composite foreign key on insert, not by an explicit existence check here —
 * the same "let RLS and the schema be the isolation boundary" pattern
 * `src/features/patients/repository.ts` already follows.
 */
export async function receiveInboundMessageForPatient(
  client: PoolClient,
  clinicId: string,
  patientId: string,
  content: string,
): Promise<ReceiveInboundMessageResult> {
  if (!content.trim()) {
    throw new Error('content is required to receive an inbound message');
  }

  await client.query('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [patientId]);

  const existing = await client.query<ConversationRow>(
    `SELECT id FROM conversations WHERE patient_id = $1 ORDER BY created_at LIMIT 1`,
    [patientId],
  );

  const conversationId = existing.rows[0]
    ? existing.rows[0].id
    : await insertConversation(client, clinicId, patientId);

  const message = await insertMessage(client, clinicId, conversationId, content);

  return { conversationId, messageId: message.id };
}

async function insertConversation(
  client: PoolClient,
  clinicId: string,
  patientId: string,
): Promise<string> {
  const { rows } = await client.query<ConversationRow>(
    `INSERT INTO conversations (clinic_id, patient_id)
     VALUES ($1, $2)
     RETURNING id`,
    [clinicId, patientId],
  );

  const row = rows[0];
  if (!row) {
    throw new Error('Insert into conversations returned no row');
  }
  return row.id;
}

async function insertMessage(
  client: PoolClient,
  clinicId: string,
  conversationId: string,
  content: string,
): Promise<MessageRow> {
  const { rows } = await client.query<MessageRow>(
    `INSERT INTO messages (clinic_id, conversation_id, sender_type, content)
     VALUES ($1, $2, 'patient', $3)
     RETURNING id`,
    [clinicId, conversationId, content],
  );

  const row = rows[0];
  if (!row) {
    throw new Error('Insert into messages returned no row');
  }
  return row;
}

/**
 * Lists every conversation visible in the caller's transaction. Deliberately
 * unfiltered by `clinic_id` in application code — RLS is the filter (charter
 * §5), same pattern as `src/features/patients/repository.ts`'s `listPatients`.
 */
export async function listConversations(client: PoolClient): Promise<Conversation[]> {
  const { rows } = await client.query<ConversationDetailRow>(
    `SELECT id, clinic_id, patient_id, created_at
     FROM conversations
     ORDER BY created_at`,
  );
  return rows.map(toConversation);
}

/**
 * Looks up one conversation by ID, plus its messages in chronological order.
 * Returns `null` when no such conversation is visible in the caller's
 * transaction — RLS makes "doesn't exist" and "exists, wrong clinic"
 * indistinguishable here, same as `getPatientsForClinic`'s pattern; this
 * function does not run any separate cross-clinic existence check.
 */
export async function getConversationWithMessages(
  client: PoolClient,
  conversationId: string,
): Promise<ConversationWithMessages | null> {
  const { rows: conversationRows } = await client.query<ConversationDetailRow>(
    `SELECT id, clinic_id, patient_id, created_at
     FROM conversations
     WHERE id = $1`,
    [conversationId],
  );

  const conversationRow = conversationRows[0];
  if (!conversationRow) {
    return null;
  }

  const { rows: messageRows } = await client.query<MessageDetailRow>(
    `SELECT id, clinic_id, conversation_id, sender_type, content, sent_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY sent_at`,
    [conversationId],
  );

  return {
    conversation: toConversation(conversationRow),
    messages: messageRows.map(toMessage),
  };
}
