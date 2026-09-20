# API Contracts

REST/JSON over Next.js route handlers (`src/app/api/**/route.ts`), consistent with the stack
already Accepted in [ADR-0001](../adr/0001-web-stack.md). All request/response bodies are JSON.
Endpoints below are grouped by feature, matching
[`docs/02-architecture.md`](../02-architecture.md)'s feature slices — `appointments`, `patients`,
`knowledge-base`, `conversations` — plus auth/session and staff/clinic administration, which don't
map to a single existing feature slice and are treated as their own concern here.

Illustrative only: exact route paths and payload field names may be adjusted during
implementation; the contract this document fixes is the _shape_ — which data crosses the boundary,
which checks happen before a handler's own logic runs, and what every response status means.

## Two rules that apply to every endpoint below

1. **`clinic_id` is never a request parameter.** It is resolved server-side from the authenticated
   session (see [`04-auth-implementation.md`](./04-auth-implementation.md)) before a handler does
   anything else, and it is what gets set as the request's `app.current_clinic_id` for RLS to key
   on. No endpoint below accepts a `clinic_id` field in a request body or query string — accepting
   one would let a client simply ask for another clinic's data, which is exactly the class of bug
   ADR-0003's database-layer enforcement exists to make survivable even if this rule were violated,
   but this rule is the API-layer half of the same guarantee, not a redundant one.
2. **Role checks happen before the handler's own logic, uniformly.** Every endpoint states which of
   the four roles ([ADR-0004](../adr/0004-staff-role-model.md)) may call it. A request from a role
   not listed receives `403 Forbidden` before any business logic runs — the same shape regardless
   of which endpoint rejected it.

## Common response shapes

```jsonc
// Success
{ "data": { /* endpoint-specific */ } }

// Error
{ "error": { "code": "string_error_code", "message": "human-readable, safe to show staff" } }
```

| Status | Meaning                                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | Read or update succeeded.                                                                                                                |
| 201    | Resource created.                                                                                                                        |
| 400    | Request failed validation (e.g., malformed PhoneNumber, missing field).                                                                  |
| 401    | No valid session.                                                                                                                        |
| 403    | Valid session, but role does not permit this action.                                                                                     |
| 404    | Resource not found _or_ belongs to another clinic — see note below.                                                                      |
| 409    | Request conflicts with current state (double-booking, expired invite, already-accepted invite, non-Ready knowledge document referenced). |
| 422    | Well-formed request that violates a domain business rule (e.g., reschedule of a Cancelled Appointment).                                  |

**On 404 vs. 403 for cross-tenant access:** a request for another clinic's resource by ID returns
`404`, never `403` — a `403` would confirm the resource exists, which is itself a cross-tenant
information leak (even the row's _existence_ is another clinic's data). Because RLS means the query
underlying the handler simply returns no row for another clinic's ID, this falls out naturally
rather than needing a special case: "not found" and "found, wrong clinic" are indistinguishable at
the database layer, and the API layer preserves that indistinguishability rather than working
around it.

## Auth / session

| Method | Path                 | Roles     | Notes                                                                                                                                                                               |
| ------ | -------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/sign-in`  | any       | Body: `{ email, password }`. `200` sets the session; `401` on bad credentials — same message either way (unknown email vs. wrong password), to avoid confirming which emails exist. |
| POST   | `/api/auth/sign-out` | signed-in | Invalidates the current session.                                                                                                                                                    |
| GET    | `/api/auth/session`  | signed-in | Returns the caller's own `{ staffId, clinicId, role }` — used by the `(app)` shell's session check (roadmap P2).                                                                    |

Full mechanics in [`04-auth-implementation.md`](./04-auth-implementation.md).

## Clinic settings

| Method | Path          | Roles        | Notes                                                                                                                                                                                                                                                                        |
| ------ | ------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/clinic` | any staff    | Clinic profile, working hours, active services.                                                                                                                                                                                                                              |
| PATCH  | `/api/clinic` | owner, admin | Body may include `workingHours` and/or a `services` array (create/update/retire). Writes wrapped in one transaction — see [`01-database-schema.md`](./01-database-schema.md)'s Clinic aggregate section; a request touching both never leaves one applied without the other. |

## Staff & invitations

| Method | Path                                | Roles                                         | Notes                                                                                                                                                                                                                                                                                          |
| ------ | ----------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/staff`                        | owner, admin                                  | Lists active staff and pending invitations together (B: `/dashboard/staff` shows both).                                                                                                                                                                                                        |
| POST   | `/api/staff/invitations`            | owner, admin                                  | Body: `{ email, role }`. `409` if the email already has a Pending invitation or is already an active StaffMember for this clinic (the two checks named in [`01-database-schema.md`](./01-database-schema.md)'s `invitations` section).                                                         |
| POST   | `/api/staff/invitations/:id/accept` | invitee (unauthenticated, token-bearing link) | Body: `{ token, password }`. `409` if the invitation is not `pending` or is past `expires_at`. On success: creates the `staff_members` row and marks the invitation `accepted`, in one transaction.                                                                                            |
| PATCH  | `/api/staff/:id`                    | owner, admin                                  | Deactivate a StaffMember (`status = 'deactivated'`), or change role. `422` if this would leave the clinic with zero active `owner` staff (B: "a Clinic must always have at least one Owner") — checked inside the same transaction as the update, not as a separate pre-check that could race. |

## Patients

| Method | Path                | Roles                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/patients`     | owner, admin, receptionist, practitioner (read-only) | List/search within the clinic.                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/api/patients/:id` | owner, admin, receptionist, practitioner             |                                                                                                                                                                                                                                                                                                                                                                                                                |
| POST   | `/api/patients`     | owner, admin, receptionist                           | Manual creation (B: "select or create patient record" in the appointment flow). `400` if no contact channel provided (schema's `patient_has_contact_channel`).                                                                                                                                                                                                                                                 |
| DELETE | `/api/patients/:id` | owner, admin                                         | Article 17 erasure request. Implements [ADR-0005](../adr/0005-patient-erasure-strategy.md): anonymises the Patient row and cascades the per-entity behavior in the same ADR to Conversations/Messages/Appointments referencing it, in one transaction. Returns `200` with a summary of what was deleted vs. retained (and why), not a bare `204` — ADR-0005 requires this be demonstrable, not just performed. |

## Conversations, messages, escalations

| Method | Path                                                    | Roles                                                      | Notes                                                                                                                                                                                                                                                                                                                  |
| ------ | ------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/conversations`                                    | owner, admin, receptionist, practitioner (read-only)       | Filterable by status.                                                                                                                                                                                                                                                                                                  |
| GET    | `/api/conversations/:id`                                | owner, admin, receptionist, practitioner                   | Full Message + Escalation history.                                                                                                                                                                                                                                                                                     |
| POST   | `/api/conversations/:id/messages`                       | owner, admin, receptionist (never practitioner — ADR-0004) | Body: `{ content }`. `sender_type = 'staff'`. `422` if the Conversation has no open Escalation status permitting a staff reply outside the assistant flow — the assistant's own message-writing path is internal (see [`05-ai-pipeline.md`](./05-ai-pipeline.md)), not this endpoint.                                  |
| POST   | `/api/conversations/:id/escalations/:escId/acknowledge` | owner, admin, receptionist                                 | Sets `acknowledged_at`/`acknowledged_by`.                                                                                                                                                                                                                                                                              |
| POST   | `/api/conversations/:id/escalations/:escId/close`       | owner, admin, receptionist                                 | Closing the last open Escalation is what allows the Conversation to move to `resolved` — enforced by the database trigger in [`01-database-schema.md`](./01-database-schema.md), so this endpoint's own logic doesn't need to re-derive the rule, only surface the `409`/`422` if the trigger rejects the transaction. |

Practitioner's role check above is deliberately the same "read-only" pattern used everywhere
practitioners appear in this document — ADR-0004's "read-only access to conversations and
appointments; no access to... clinic settings" is enforced at every one of these endpoints
individually, not assumed from one central rule, so a new endpoint added later has to make the same
choice explicitly rather than inherit an assumption.

## Appointments

| Method | Path                    | Roles                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/appointments`     | owner, admin, receptionist, practitioner (read-only) | Filterable by date range, practitioner.                                                                                                                                                                                                                                                                                                                                                                                        |
| GET    | `/api/appointments/:id` | owner, admin, receptionist, practitioner             |                                                                                                                                                                                                                                                                                                                                                                                                                                |
| POST   | `/api/appointments`     | owner, admin, receptionist                           | Body: `{ patientId, serviceId, practitionerId, startsAt, endsAt }`. `409` if the `EXCLUDE` constraint in [`01-database-schema.md`](./01-database-schema.md) rejects it (double-booking) — the handler catches that specific constraint violation and translates it to a `409` with a clear message, rather than a generic `500`.                                                                                               |
| PATCH  | `/api/appointments/:id` | owner, admin, receptionist                           | Reschedule (`startsAt`/`endsAt`) or cancel (`status: 'cancelled'`). `422` if the Appointment is already `cancelled` or `completed`, or `startsAt` is in the past (B: "A Cancelled or past Appointment cannot be rescheduled") — checked before attempting the update, since this is a business-rule rejection, not a constraint violation. `409` on a rescheduled time that collides with another Appointment, same as `POST`. |

## Knowledge base

**Upload is two stages, not a multipart upload** (roadmap P5 Slice 1B,
[ADR-0018](../adr/0018-knowledge-document-object-storage.md), Accepted): the browser uploads
directly to Scaleway Object Storage via a server-issued presigned PUT — file bytes never pass
through this application. `POST /api/knowledge-documents` (initiation) and `POST
/api/knowledge-documents/:id/complete` (completion) replace the single-request multipart-upload
contract an earlier draft of this document described, which predated ADR-0018.

| Method | Path                                    | Roles        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | --------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/knowledge-documents`              | owner, admin | Lists documents with status. Not yet implemented as an HTTP route — the read functions behind it exist (`getKnowledgeDocumentsForClinic`, roadmap P5 Slice 1A), the route does not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| POST   | `/api/knowledge-documents`              | owner, admin | **Upload initiation.** Body: `{ filename, mimeType, sizeBytes }` — client-declared values, checked here only as a UX courtesy (`400` if `mimeType` isn't `application/pdf` or `sizeBytes` exceeds 10485760 bytes / 10 MiB), never as authoritative enforcement — see [`06-knowledge-document-storage.md`](./06-knowledge-document-storage.md#upload-is-two-validated-stages-not-one). On accept: `201` with `{ documentId, uploadUrl, expiresAt }` — `uploadUrl` is a short-lived presigned PUT bound to `clinicId/documentId` and to the declared `mimeType`. No database row is created at this stage.                                                                                      |
| POST   | `/api/knowledge-documents/:id/complete` | owner, admin | **Upload completion.** Body: `{ filename }`. Re-derives the storage key from `(session clinicId, :id)` — never from the client — and calls HeadObject: `404` if no object exists there (upload never completed, or `:id` belongs to another clinic — see the note below); `422` if the actual `ContentLength` exceeds 10485760 bytes or the actual `Content-Type` isn't `application/pdf`; `409` on a retried completion for an already-completed `:id`. Only on success does this insert the `processing` row and return `201` — see [`06-knowledge-document-storage.md`](./06-knowledge-document-storage.md) for why HeadObject, not the initiation-time declared values, is authoritative. |
| GET    | `/api/knowledge-documents/:id`          | owner, admin | Includes current `status`/`failedReason`. Not yet implemented as an HTTP route, same status as the list route above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| DELETE | `/api/knowledge-documents/:id`          | owner, admin | Deferred to a separate future slice (not Slice 1B) — removes the document and its retrieval-time representation together, see [`06-knowledge-document-storage.md`](./06-knowledge-document-storage.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

A malformed `:id` on the completion route returns the same `404` a genuinely missing upload
would — this endpoint's own instance of the general 404-vs-403 cross-tenant rule above: since the
storage key completion checks is derived from `(session clinicId, :id)` rather than accepted from
the client, a request naming a real document id that belongs to a different clinic can only ever
resolve to a key nothing was uploaded to, which is indistinguishable from "missing" by construction,
not by a special case.

No endpoint here lets the Assistant's own retrieval reach a document before it is `ready` —
that filter lives in the AI pipeline's retrieval step
([`05-ai-pipeline.md`](./05-ai-pipeline.md)), consistent with B's own placement of that rule
outside the KnowledgeDocument aggregate itself. (No code currently moves a document to `ready` —
that is a later slice's processing pipeline, not Slice 1B.)
