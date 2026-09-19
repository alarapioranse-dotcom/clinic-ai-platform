# P4 Slice 2 — Design Gate

Not an ADR. This is a design-gate report only: no ADR Status line appears anywhere in this
document, and nothing here is Proposed, Accepted, or otherwise a decision record. Written on
branch `docs/p4-slice-2-design-gate`, base `origin/main` at `4abc69c1f03aef6b7d5e0cf448fcc39a64e27f21`
("P4 Slice 1 is closed and deployed to production... Production schema is at migrations
0001–0012").

## 0. Headline finding

**The vertical path Slice 2 is asked to design already exists, shipped and merged as P4 Slice 1.**
`conversation → trusted clinic/patient context → availability → selected slot → booking →
appointment linked to conversation → response` is not a gap in `main` at `4abc69c` — it is the
literal feature `src/features/appointments/index.ts` already implements, wired through
`POST /api/appointments`, `GET /api/appointments/availability`, `GET
/api/appointments/practitioners`, and rendered in
`src/app/(app)/dashboard/conversations/[id]/BookAppointment.tsx` on the conversation detail page.
Every one of this brief's eight design questions has a concrete, already-shipped, already-tested
answer, cited below. Sections A–K describe what is already built, using the same file/symbol
citations the questions asked for; section L records the one real gap found and the smallest
follow-up that would close it — which is additive to the existing design, not a redesign, and
raises no new one-way-door decision.

This finding is itself worth flagging as a process observation, not a decision: whatever produced
this task's premise — that Slice 2 is still to be designed — did not match the state of `main`.
Recommend confirming with Ahmed whether "Slice 2" names a different scope than what's described
below before opening any implementation work against this brief.

## A. Current architecture relevant to Slice 2

- **`src/features/appointments/`** — the appointments feature. `schedule.ts` (pure availability
  computation, no DB access), `repository.ts` (schedule reads + appointment persistence, internal),
  `index.ts` (the feature's only valid import target: `getAvailableSlots`,
  `listPractitionersForClinic`, `bookAppointment`). Its own header comment already states the
  exact pipeline this brief asks to design: "persisted schedule -> compute available slots at read
  time -> select a slot -> book appointment -> persist appointment -> optionally link the
  appointment to its originating conversation -> return the booked appointment"
  (`src/features/appointments/index.ts:1-8`).
- **`src/features/conversations/`** — owns `getConversation(clinicId, conversationId)`
  (`src/features/conversations/index.ts:64-71`), the read the booking UI uses to obtain a
  conversation's `patientId`.
- **`db/migrations/0011_appointments.sql`** — the `appointments` table: composite FKs to
  `patients`/`staff_members`/`conversations`, RLS + FORCE RLS, and the
  `appointments_no_double_booking` EXCLUDE constraint (ADR-0014).
- **`db/migrations/0012_clinic_timezone.sql`** — `clinics.timezone`, ADR-0016.
- **API routes**: `src/app/api/appointments/route.ts` (`POST`, booking),
  `src/app/api/appointments/availability/route.ts` (`GET`, availability),
  `src/app/api/appointments/practitioners/route.ts` (`GET`, picker data).
- **UI**: `src/app/(app)/dashboard/conversations/[id]/page.tsx` renders
  `src/app/(app)/dashboard/conversations/[id]/BookAppointment.tsx` below the conversation's
  message thread and reply form, gated to `BOOK_ROLES` (`page.tsx:42`).
- **Auth**: `src/features/auth` — `validateSession`, `requireRole`, `ForbiddenRoleError`,
  `SESSION_COOKIE_NAME` (imported identically by every route above and by
  `src/app/api/conversations/[id]/route.ts`).

## B. Proposed request/data flow

No new flow to propose — the shipped flow, traced end to end:

1. Staff opens `/dashboard/conversations/[id]` (existing conversation). `page.tsx` calls
   `GET /api/conversations/:id` → `getConversation(session.clinicId, id)` → returns
   `{ conversation: { id, patientId, ... }, messages }`.
2. `BookAppointment` (child component, receives `conversationId` + `patientId` as props from the
   parent's already-fetched, already-tenant-scoped conversation) calls
   `GET /api/appointments/practitioners` to populate the picker
   (`BookAppointment.tsx:65-79`).
3. Staff picks a practitioner/date/duration; `GET /api/appointments/availability` is called
   (`BookAppointment.tsx:86-105`) → `getAvailableSlots(clinicId, practitionerId, date,
   durationMinutes)` → computed, advisory slot list.
4. Staff selects a slot; `POST /api/appointments` is called with `{ patientId, practitionerId,
   conversationId, startsAt, endsAt }` (`BookAppointment.tsx:107-131`) → `bookAppointment(clinicId,
   input)` → `insertAppointment` → `201` with the persisted `Appointment`, or `409` on conflict.
5. UI renders the booked appointment's time inline (`BookAppointment.tsx:137-142`).

## C. Existing authorities being reused

- **Booking authority**: `bookAppointment` in `src/features/appointments/index.ts:132-137` is the
  single public entry point for creating an appointment. There is exactly one — no
  conversation-specific booking path exists or is proposed. The same function, same route
  (`POST /api/appointments`), serves booking regardless of whether it originates from a
  conversation (`conversationId` present) or not (`conversationId: null`,
  `book-appointment.test.ts:34-52`).
- **Availability authority**: `getAvailableSlots` (`index.ts:90-115`), backed by pure
  `computeAvailableSlots` (`schedule.ts:376-407`) — one computation, reused identically by the
  conversation-linked booking flow and any non-conversation booking.
- **Session/tenant authority**: `validateSession` / `requireRole` from `src/features/auth`, used
  identically across `appointments` and `conversations` routes — no second auth mechanism.
- **Concurrency authority**: PostgreSQL's `appointments_no_double_booking` EXCLUDE constraint
  (`db/migrations/0011_appointments.sql:172-177`) — not re-implemented or duplicated anywhere.

**Confirmed: there is one booking authority, not a second conversation-specific implementation.**
`BookAppointment.tsx` calls the same `POST /api/appointments` any other booking caller would; it
adds no parallel booking code path.

## D. Exact files/modules/routes — current state

All already implemented; no changes required for the scope this brief describes:

| Concern | File | Symbol |
|---|---|---|
| Booking orchestration | `src/features/appointments/index.ts` | `bookAppointment` |
| Availability computation | `src/features/appointments/index.ts`, `schedule.ts` | `getAvailableSlots`, `computeAvailableSlots` |
| Persistence | `src/features/appointments/repository.ts` | `insertAppointment`, `getEffectiveSchedule`, `listActiveAppointmentsForPractitionerOnDate` |
| Conversation read (patientId source) | `src/features/conversations/index.ts` | `getConversation` |
| HTTP: book | `src/app/api/appointments/route.ts` | `POST` |
| HTTP: availability | `src/app/api/appointments/availability/route.ts` | `GET` |
| HTTP: practitioner picker | `src/app/api/appointments/practitioners/route.ts` | `GET` |
| HTTP: conversation detail | `src/app/api/conversations/[id]/route.ts` | `GET` |
| UI: booking widget | `src/app/(app)/dashboard/conversations/[id]/BookAppointment.tsx` | `BookAppointment` |
| UI: conversation detail | `src/app/(app)/dashboard/conversations/[id]/page.tsx` | `ConversationDetailPage` |
| Schema | `db/migrations/0011_appointments.sql`, `0012_clinic_timezone.sql` | — |

Section L names the one file that would need a change for the gap identified there.

## E. Authorization model

Reuses ADR-0004's four-role matrix exactly, with no new permission model:

- `POST /api/appointments` (booking): `owner`, `admin`, `receptionist`
  (`src/app/api/appointments/route.ts:67`). `practitioner` is excluded — same rationale ADR-0004
  gives for `practitioner` being read-only on conversations ("a practitioner's job is clinical
  care, not managing patient communication"); booking a patient into a slot is the same class of
  administrative action as replying to a patient, not clinical care.
- `GET /api/appointments/availability`, `GET /api/appointments/practitioners`: all four roles,
  read-only, matching `GET /api/conversations`'s matrix.
- `tests/api/appointments-routes.test.ts` already exercises every role × every route combination,
  including the explicit "practitioner is excluded from booking" case (`BOOKING_ROLES` constant,
  `appointments-routes.test.ts:57`) and unauthenticated (`401`) cases for each route.
- The UI's `BOOK_ROLES` set (`page.tsx:42`) is documented in its own comment as "convenience only";
  the API is the actual authorization boundary — consistent with `REPLY_ROLES`'s identical pattern
  for staff replies.

**No new appointment-specific permission model is proposed or needed.**

## F. Conversation-to-patient/clinic linkage approach

- **`clinic_id`**: never derived from the conversation or from request input. Every route resolves
  it from `session.clinicId` after `validateSession(token)` (e.g. `route.ts:127`: `bookAppointment(
  session.clinicId, ...)`). The client cannot override tenant identity — there is no `clinicId`
  field anywhere in `POST /api/appointments`'s accepted body
  (`src/app/api/appointments/route.ts:93-112` only reads `patientId`, `practitionerId`,
  `conversationId`, `startsAt`, `endsAt`).
- **`patient_id`**: the UI derives it from the already-fetched, already-tenant-scoped conversation
  (`state.detail.conversation.patientId`, `page.tsx:210`) — not requested fresh from the client
  independently of the conversation. The API itself does not special-case "derive patientId from
  conversationId" — it accepts `patientId` directly and separately validates `conversationId`
  (if present) belongs to that same `patientId`.
- **Structural enforcement, not application logic**: `appointments_conversation_same_patient`
  (`db/migrations/0011_appointments.sql:123-124`), a composite FK on
  `(conversation_id, patient_id) REFERENCES conversations (id, patient_id)`, makes "this
  appointment's conversation belongs to this appointment's patient" a database-enforced
  impossibility to violate, exactly as `docs/adr/0014-appointment-no-double-booking-invariant.md`'s
  sibling decisions do for the practitioner/patient/clinic references. A mismatch is caught in
  `insertAppointment` (`repository.ts:277-279`) and surfaced as `ConversationPatientMismatchError`
  → HTTP `404` (`route.ts:139-141`, same 404-collapsing convention as every other cross-tenant
  case in this codebase).
- **Composite FKs and RLS remain part of the enforcement chain**: confirmed — `clinic_id` on
  `appointments` is FORCE RLS-enforced (`0011_appointments.sql:134-138`, verified directly by
  `tests/db/appointments-invariants.test.ts:565-610`, both the plain-isolation and the
  FORCE-RLS-WITH-CHECK cases), and `appointments_patient_same_clinic` /
  `appointments_practitioner_same_clinic` are the same structural pattern used throughout this
  schema (`conversations_patient_same_clinic`, `messages_conversation_same_clinic`). Nothing in
  this design introduces an alternative isolation mechanism.

## G. Availability-to-booking flow

- Availability is computed at read time by `getAvailableSlots`
  (`src/features/appointments/index.ts:90-115`) from persisted `working_hours` +
  `clinics.timezone` (ADR-0016) plus currently-active appointments, and is explicitly advisory: the
  feature's own module comment states "it is advisory: no `available_slots` table exists, and
  nothing here reserves a slot" (`index.ts:14-16`), and `getAvailableSlots` "performs zero writes"
  is a directly tested property (`book-appointment.test.ts:395-408`).
- PostgreSQL remains the sole concurrency authority via `appointments_no_double_booking`
  (`0011_appointments.sql:172-177`) — `insertAppointment`'s own comment states this explicitly:
  "nothing here re-validates the requested interval against working hours... the
  `appointments_no_double_booking` EXCLUDE constraint is the sole concurrency authority. No
  advisory-lock fallback exists in this design" (`repository.ts:228-233`). Proven under real
  concurrency by `book-appointment.test.ts:195-225` (two concurrent identical bookings: exactly one
  fulfilled, one rejected, exactly one row persisted).
- **Conflict response for a stale slot**: already established, not invented here.
  `AppointmentConflictError` (`repository.ts:111-116`) → HTTP `409` with the stable, fixed
  user-facing message `"The selected appointment slot is no longer available."`
  (`route.ts:143-147`), documented in `insertAppointment`'s own comment as "the API layer maps that
  specifically to `409` with the stable, user-facing conflict message" (`repository.ts:129-130`).
  This is the existing, established semantic — Slice 2 (or any future slice reusing this booking
  authority) should reuse `409` + `AppointmentConflictError` verbatim rather than inventing a new
  conflict shape.

## H. Duplicate submission behavior, based on existing architecture

No new idempotency semantics are needed or proposed. Tracing what actually happens on a duplicate
submission through the existing design:

- **Same slot submitted twice** (the realistic "double-click" case — a UI has one slot selected;
  clicking twice sends two structurally identical `POST /api/appointments` requests): the two
  requests target the same `(clinic_id, practitioner_id, overlapping interval)` key. The first
  commits; the second collides with `appointments_no_double_booking` and receives
  `AppointmentConflictError` → `409`. This is exactly the concurrent-booking case
  `book-appointment.test.ts:195-225` already proves deterministically (exactly one fulfilled,
  exactly one rejected, exactly one row persisted) — a duplicate submission for the same slot *is*
  a double-booking attempt under this schema, and the existing invariant already resolves it
  correctly with no additional mechanism.
- **A genuinely new idempotency-key/dedup mechanism** (e.g., a client-supplied request ID that
  makes a literal retry of the identical request return the original `201` instead of a `409`) is
  **not** part of the existing design and is **not proposed here** — inventing one would be new,
  durable, cross-request state (a dedup table or key column) that nothing in P4's roadmap
  acceptance criteria requires and no ADR authorizes. Per this brief's own instruction ("do not
  invent durable idempotency semantics without an ADR") and per the charter's ADR policy (§10):
  if a future need for true request-level idempotency is identified (e.g., an unreliable client
  retrying over a lossy connection, needing "retry returns the same result" rather than "retry
  correctly detects the same slot is gone"), that is a candidate ADR, not something to build under
  this design gate. Nothing observed while reviewing this codebase makes that case today — the
  EXCLUDE constraint's existing behavior is sufficient for the flows this brief scopes into Slice
  2 (a receptionist clicking a slot in the existing UI).

## I. Conflict/concurrency behavior

Fully covered by C, G, and H above — reiterated for the section this brief explicitly asks for:
availability is advisory (read of a snapshot); the EXCLUDE constraint is the sole authority at
write time; a losing concurrent request receives `AppointmentConflictError` → `409` with a stable
message; no advisory locks, no check-then-insert race, no additional mechanism. This is the
existing, already-Accepted (ADR-0014) and already-implemented behavior — nothing here should
reopen or reinterpret it, consistent with this brief's own guardrails.

## J. Minimal UI flow

Already built exactly to this brief's own minimal spec, in
`src/app/(app)/dashboard/conversations/[id]/BookAppointment.tsx`, rendered inside
`ConversationDetailPage` (`page.tsx:207-212`):

1. Open existing conversation → `ConversationDetailPage` (existing route,
   `/dashboard/conversations/[id]`).
2. View available slots → practitioner/date/duration picker + "عرض الأوقات المتاحة" button
   (`BookAppointment.tsx:160-202`).
3. Select a slot → one of the rendered slot buttons (`BookAppointment.tsx:214-230`).
4. Book appointment → `bookSlot` (`BookAppointment.tsx:107-131`).
5. Show the resulting appointment/linkage → a confirmation line with the booked start/end time
   (`BookAppointment.tsx:137-142`).

Everything this brief lists as explicitly excluded (full calendar, recurring appointments,
reminders, services, waitlists, multi-site scheduling, practitioner timezones, appointment
history, new scheduling engines) is, in fact, absent from the shipped UI — there is no calendar
view, no recurrence, no reminder, no service picker, no waitlist, and no history view anywhere in
`BookAppointment.tsx` or `ConversationDetailPage`. The shipped scope matches this brief's own
minimum exactly.

## K. Required tests — current coverage

Every category this brief lists already has direct coverage on `main` at `4abc69c`:

| Category | Coverage |
|---|---|
| Unauthenticated access | `tests/api/appointments-routes.test.ts` — `401` cases for all three routes |
| Role authorization | Same file — every role × every route, including practitioner excluded from booking |
| Tenant isolation | `tests/db/appointments-invariants.test.ts:565-610` (RLS visibility + FORCE RLS WITH CHECK) |
| Patient/conversation consistency | `tests/features/appointments/book-appointment.test.ts:54-72,145-167`; `tests/db/appointments-invariants.test.ts:444-519` |
| Successful booking | `book-appointment.test.ts:34-72` (with and without conversation) |
| Stale-slot conflict | `book-appointment.test.ts:169-193` |
| Concurrent booking | `book-appointment.test.ts:195-225` |
| Malformed/nonexistent/cross-clinic conversation | Partial — see gap below |
| RLS enforcement | `appointments-invariants.test.ts:565-630` (isolation, FORCE RLS, fail-closed with no tenant context) |
| Appointment persistence | `appointments-invariants.test.ts:52-74`; `book-appointment.test.ts` throughout |
| Conversation linkage | `book-appointment.test.ts:54-72`; `appointments-invariants.test.ts:495-519` |

**Gap in "malformed/nonexistent/cross-clinic conversation"**: existing tests cover a
`conversationId` that is well-formed but belongs to a *different patient in the same clinic*
(`ConversationPatientMismatchError`). No test currently exercises a `conversationId` belonging to
a *different clinic entirely* through the booking path, nor a malformed (non-UUID)
`conversationId` at the HTTP boundary specifically for `POST /api/appointments` (the route does
validate `conversationId`'s UUID shape — `route.ts:107-112` — but this specific case isn't asserted
by name in `appointments-routes.test.ts`). This is a test-coverage gap, not a design gap: the
existing mechanism (RLS-scoped composite FK lookup, same pattern already proven for
patient/practitioner cross-clinic cases) is expected to reject it identically via
`ConversationPatientMismatchError` → `404`, consistent with every other cross-tenant reference in
this schema. No architectural change is implied — just two additional test cases to add before or
alongside any Slice 2 implementation PR.

## L. Unresolved architectural decisions

**None found that require an ADR.** Every design question this brief poses (booking authority,
trusted context, availability, authorization, conversation state, idempotency) resolves to an
already-Accepted decision or an already-shipped, non-one-way-door technical design, cited above.
Specifically on the two questions this brief calls out as possible ADR gates:

- **Conversation lifecycle/state**: `conversations` has no `status` column at all
  (`db/migrations/0009_conversations.sql:6-8`, explicit comment: "conversations has no `status`
  column... Status and the escalation-agreement trigger that depends on it are P3-B/P3-C's job...
  out of scope"). P3-B and P3-C shipped without ever adding one. Booking an appointment from a
  conversation does not read or write any conversation-lifecycle field, because none exists to
  read or write — there is nothing to invent here, and nothing durable to gate on an ADR. This
  brief's own instruction not to "invent a new conversation state merely for UI convenience" is
  already satisfied by the shipped design doing nothing to conversation state.
- **Idempotency**: covered in full in section H — the existing EXCLUDE-constraint-based conflict
  response already resolves the realistic duplicate-submission case; no durable idempotency-key
  mechanism is invented, proposed, or required by anything in this brief's scope.

**One open item, not an ADR gate**: section L's own finding — `GET /api/conversations/:id`
(`src/features/conversations/repository.ts:259-287`, `getConversationWithMessages`) returns only
`{ conversation, messages }`, with no linked-appointments list. `BookAppointment.tsx`'s
"show the resulting appointment/linkage" (section J, step 5) is client-side-only state
(`booking.status === 'booked'`, `BookAppointment.tsx:32-33,137-142`): it disappears on page reload,
and nothing on the conversation detail page today shows a staff member that a conversation already
has a booked appointment if they navigate back to it later. This is a genuine, if small, gap
against this brief's own stated minimum ("show the resulting appointment/linkage") when read as
"durably visible," not merely "confirmed once, in the moment." Closing it is an ordinary additive
read (a query for `appointments WHERE conversation_id = $1`, surfaced alongside the existing
conversation/messages read) — reversible, no schema change, no new invariant, not costly to
reverse, and therefore not a one-way-door decision under charter §10. It does not require an ADR;
it requires an ordinary implementation PR, which this design-gate turn does not open.
