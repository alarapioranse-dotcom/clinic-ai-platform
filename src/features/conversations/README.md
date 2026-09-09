# conversations

Owns patient message threads, scoped to a clinic. First real implementation
(roadmap **P3-A**, "Clinic-scoped inbound conversation persistence") — the
smallest slice proving inbound patient messages can be persisted safely,
under the same tenant-isolation guarantees as `patients`.

## Current scope (P3-A slice)

- `receiveInboundMessage(clinicId, patientId, content)` — inside one
  transaction scoped to `clinicId` via `withTenantContext`
  (`src/lib/db.ts`): finds the patient's existing conversation in this
  clinic if one exists, else creates it, then inserts the message
  (`sender_type = 'patient'`). Returns `{ conversationId, messageId }`.

Concurrency: two simultaneous inbound messages for the same patient are
serialized with `SELECT ... FOR UPDATE` on the patient's own row inside the
transaction, so they cannot both create a conversation — see
`repository.ts`'s own comment and `db/migrations/0009_conversations.sql`
for the grant evidence this relies on.

Row Level Security on `conversations` and `messages` is the actual tenant
isolation boundary, not application-side filtering (charter §5), exactly
like `patients`. The composite foreign keys `conversations_patient_same_clinic`
and `messages_conversation_same_clinic` make a cross-clinic reference a
structural impossibility rather than an application-code discipline.

**Not yet implemented** (later phases, not this slice):

- A `status` column, or anything that reads/writes conversation status
  (`assistant_handling` / `needs_staff` / `resolved`) — P3-B/P3-C's job.
- Escalations, and the conversation/escalation agreement invariant.
- Staff viewing or replying to a conversation from the `(app)` shell — P3-B.
- The AI assistant (automated replies, knowledge-base grounding) — P5.
- Any HTTP route or messaging/channel provider (SMS, WhatsApp, webhook)
  that would call `receiveInboundMessage` from outside this codebase — this
  slice only proves the persistence path, not how an inbound message
  physically arrives.

## Rules

- This feature computes; routes and components compose it, not the other
  way around.
- No other feature (`appointments`, `patients`, `knowledge-base`) may
  import from this feature's internals. `./index.ts` is the only valid
  import target — `./repository.ts` is internal.
- `process.env` is never read here — configuration comes from
  `src/lib/env.ts`, consumed indirectly via `src/lib/db.ts`.
