/**
 * Public entry point for the `conversations` feature (roadmap P3-A:
 * "Clinic-scoped inbound conversation persistence"). Only this module —
 * never `./repository` — is a valid import target for other features or
 * for `src/app/**` route/page code.
 *
 * No HTTP route is added in this slice: nothing yet resolves an inbound
 * message's `clinicId`/`patientId` from an external channel (SMS/WhatsApp/
 * webhook) — that's a messaging/channel provider, explicitly out of scope
 * here. `receiveInboundMessage` exists so that integration can call it
 * later without this feature's persistence logic changing.
 *
 * Runs inside one `withTenantContext` transaction: the caller supplies
 * `clinicId` (resolved elsewhere — this feature does not resolve it), and
 * RLS plus the composite foreign keys in `db/migrations/0009_conversations.sql`
 * are the actual isolation and integrity boundary, not any filtering done
 * here.
 */
import { withTenantContext } from '@/lib/db';
import { receiveInboundMessageForPatient, type ReceiveInboundMessageResult } from './repository';

export type { ReceiveInboundMessageResult };

export async function receiveInboundMessage(
  clinicId: string,
  patientId: string,
  content: string,
): Promise<ReceiveInboundMessageResult> {
  return withTenantContext(clinicId, (client) =>
    receiveInboundMessageForPatient(client, clinicId, patientId, content),
  );
}
