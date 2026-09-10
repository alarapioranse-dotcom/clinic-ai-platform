/**
 * Public entry point for the `conversations` feature (roadmap P3-A:
 * "Clinic-scoped inbound conversation persistence"; roadmap P3-B: staff-facing
 * conversation list + detail read path). Only this module — never
 * `./repository` — is a valid import target for other features or for
 * `src/app/**` route/page code.
 *
 * `receiveInboundMessage`: no HTTP route is added for it in this slice —
 * nothing yet resolves an inbound message's `clinicId`/`patientId` from an
 * external channel (SMS/WhatsApp/webhook) — that's a messaging/channel
 * provider, explicitly out of scope here. It exists so that integration can
 * call it later without this feature's persistence logic changing.
 *
 * `listConversationsForClinic`/`getConversation`: the P3-B read path behind
 * `GET /api/conversations` and `GET /api/conversations/:id`. Read-only —
 * staff replies, AI, escalations, and status are explicitly out of scope
 * (P3-C and later).
 *
 * Every function here runs inside one `withTenantContext` transaction: the
 * caller supplies `clinicId` (resolved elsewhere — a session, in production;
 * this feature does not resolve it itself), and RLS plus the composite
 * foreign keys in `db/migrations/0009_conversations.sql` are the actual
 * isolation and integrity boundary, not any filtering done here.
 */
import { withTenantContext } from '@/lib/db';
import {
  receiveInboundMessageForPatient,
  listConversations,
  getConversationWithMessages,
  type ReceiveInboundMessageResult,
  type Conversation,
  type Message,
  type ConversationWithMessages,
} from './repository';

export type { ReceiveInboundMessageResult, Conversation, Message, ConversationWithMessages };

export async function receiveInboundMessage(
  clinicId: string,
  patientId: string,
  content: string,
): Promise<ReceiveInboundMessageResult> {
  return withTenantContext(clinicId, (client) =>
    receiveInboundMessageForPatient(client, clinicId, patientId, content),
  );
}

export async function listConversationsForClinic(clinicId: string): Promise<Conversation[]> {
  return withTenantContext(clinicId, (client) => listConversations(client));
}

export async function getConversation(
  clinicId: string,
  conversationId: string,
): Promise<ConversationWithMessages | null> {
  return withTenantContext(clinicId, (client) =>
    getConversationWithMessages(client, conversationId),
  );
}
