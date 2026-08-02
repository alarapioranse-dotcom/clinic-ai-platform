# Acceptance Criteria

Written as behavior, not layout: no pixel positions, colors, or component names appear below. Each
screen states its unauthorized-access behavior, its empty state, and its behavior when the backend
is unavailable, even where the answer is "not applicable" — the case is still stated so nothing is
silently assumed. Screens are in the same order as
[`05-screen-inventory.md`](./05-screen-inventory.md).

## `/`

- **Static and public.** There is no unauthorized-access case (nothing is gated) and no
  backend-unavailable case (the page renders without a data dependency).

## `/privacy`

- **Static and public.** Same as above: no unauthorized-access case, no backend-unavailable case.

## `/login`

- Given a visitor with no session, when they submit a valid email and password, then they are
  taken to `/dashboard`.
- Given a visitor with no session, when they submit an email/password combination that doesn't
  match a clinic staff account, then they see "Invalid email or password" and remain on `/login`.
- Given a visitor who already has a valid session, when they navigate to `/login`, then they are
  redirected to `/dashboard` without seeing the login form.
- Given the backend is unavailable, when a visitor submits the login form, then they see "Couldn't
  sign you in — try again" and their entered email is preserved.

## `/invite/[token]/accept`

- Given a valid, unused invite token, when the invitee sets a password meeting the policy, then
  their account is created, scoped to the inviting clinic, and they are signed in.
- Given an expired or already-used token, when anyone opens the link, then they see "This invite
  link is no longer valid" and are told to ask an owner or admin for a new invite — there is no
  unauthorized-_role_ case here, since the token itself is the access control.
- Given the backend is unavailable, when the invitee submits their new password, then they see
  "Couldn't complete your account setup — try again" and the token is not consumed.

## `/dashboard`

- Given a signed-in staff member of any role, when they open `/dashboard`, then they see a summary
  scoped to their own clinic only.
- Given a newly onboarded clinic with no activity yet, when any role opens `/dashboard`, then they
  see "No activity yet" instead of an empty summary with no explanation.
- Given no session, when a visitor navigates to `/dashboard`, then they are redirected to `/login`.
- Given the backend is unavailable, when any role opens `/dashboard`, then they see "Couldn't load
  your overview" with a retry action, not a blank or broken screen.

## `/dashboard/conversations`

- Given a signed-in staff member, when they open the conversation list, then they see every
  conversation for their own clinic only, distinguishing those needing staff attention from those
  the assistant is handling.
- Given a clinic with no conversations yet, when any role opens this screen, then they see "No
  conversations yet".
- Given no session, when a visitor navigates here directly, then they are redirected to `/login`.
- Given the backend is unavailable, when any role opens this screen, then they see "Couldn't load
  conversations" with a retry action.

## `/dashboard/conversations/[id]`

- Given a conversation belonging to their clinic, when a practitioner opens it, then they can read
  the full conversation but see no way to send a reply.
- Given a conversation the assistant marked "needs staff" (per
  [`03-user-flows.md`](./03-user-flows.md)'s escalation flow), when a receptionist, admin, or owner
  opens it, then they can see why it was escalated and reply directly.
- Given a conversation belonging to a different clinic, when any staff member requests it directly
  by ID, then they see a not-found response, never the other clinic's conversation.
- Given the backend is unavailable, when a receptionist, admin, or owner tries to send a reply,
  then they see "Message failed to send" with a retry action, and the unsent message is not lost
  from their input.

## `/dashboard/patients`

- Given a signed-in staff member, when they open the patient list, then they see every patient
  record for their own clinic only — patients themselves never sign in to see this list
  (charter §7).
- Given a clinic with no patients yet, when any role opens this screen, then they see "No patients
  yet".
- Given no session, when a visitor navigates here directly, then they are redirected to `/login`.
- Given the backend is unavailable, when any role opens this screen, then they see "Couldn't load
  patients" with a retry action.

## `/dashboard/patients/[id]`

- Given a patient record belonging to their clinic, when any staff role opens it, then they see
  that patient's contact info, conversation history, and appointment history together.
- Given a patient with no conversation or appointment history yet, when any role opens their
  record, then they see "No conversation or appointment history yet" rather than an empty page.
- Given a patient record belonging to a different clinic, when any staff member requests it
  directly by ID, then they see a not-found response.
- Given the backend is unavailable, when any role opens this screen, then they see "Couldn't load
  this patient" with a retry action.

## `/dashboard/appointments`

- Given a signed-in staff member, when they open the schedule, then they see every appointment for
  their own clinic only, and a practitioner sees the same schedule as everyone else but without
  booking/reschedule/cancel actions.
- Given a clinic with nothing scheduled yet, when any role opens this screen, then they see "No
  appointments scheduled".
- Given no session, when a visitor navigates here directly, then they are redirected to `/login`.
- Given the backend is unavailable, when any role opens this screen, then they see "Couldn't load
  the schedule" with a retry action.

## `/dashboard/appointments/new`

- Given an owner, admin, or receptionist, when they select an available slot and confirm, then the
  appointment is created and the patient is notified of the confirmed time.
- Given a practitioner, when they navigate here directly, then they are denied and returned to
  `/dashboard/appointments` with a message that booking isn't available to their role.
- Given the slot they selected was taken by someone else before they confirmed, when they submit,
  then they see updated availability and are asked to choose again — the booking is not silently
  assigned to a different time.
- Given the backend is unavailable at confirmation, when owner, admin, or receptionist submits,
  then they see a retry action and no appointment is created.

## `/dashboard/appointments/[id]`

- Given an existing appointment for their clinic, when owner, admin, or receptionist reschedules it
  to a still-available slot, then the prior slot is released, the new slot is booked, and the
  patient is notified.
- Given a practitioner, when they open an appointment, then they can view it but see no
  reschedule or cancel action.
- Given an appointment that is already in the past or already cancelled, when owner, admin, or
  receptionist attempts to reschedule it, then the action is blocked with "cannot reschedule a
  past/cancelled appointment".
- Given the backend is unavailable, when owner, admin, or receptionist attempts to save a change,
  then they see "Couldn't update this appointment" with a retry action and no partial change is
  saved.

## `/dashboard/knowledge-base`

- Given an owner or admin, when they open this screen, then they see every knowledge document for
  their own clinic and its status (processing or ready).
- Given a practitioner or receptionist, when they navigate here directly, then they are denied
  access — this screen governs what the assistant is allowed to say, not day-to-day work.
- Given a clinic with no knowledge documents yet, when an owner or admin opens this screen, then
  they see "No knowledge documents yet — the assistant can't answer questions until you add one".
- Given the backend is unavailable, when an owner or admin opens this screen, then they see
  "Couldn't load knowledge base" with a retry action.

## `/dashboard/knowledge-base/upload`

- Given an owner or admin, when they upload a supported file within the size limit, then it
  appears in the knowledge base list as "Processing" and later "Ready".
- Given a practitioner or receptionist, when they navigate here directly, then they are denied
  access.
- Given an unsupported file type or a file over the size limit, when an owner or admin attempts to
  upload it, then it is rejected before upload with a specific reason, and nothing is added to the
  list.
- Given the backend is unavailable, when an owner or admin submits an otherwise valid file, then
  they see "Upload failed" with a retry action, and no partial document is left in the list.

## `/dashboard/staff`

- Given an owner or admin, when they open this screen, then they see every staff member and
  pending invite for their own clinic.
- Given a practitioner or receptionist, when they navigate here directly, then they are denied
  access — this screen governs who has access to the clinic's account.
- Given a clinic with only its owner so far, when the owner opens this screen, then they see "Only
  you have access — invite your team".
- Given the backend is unavailable, when an owner or admin opens this screen, then they see
  "Couldn't load staff list" with a retry action.

## `/dashboard/staff/invite`

- Given an owner or admin, when they invite a new email with a role, then an invitation is sent
  and the pending invite appears on `/dashboard/staff`.
- Given a practitioner or receptionist, when they navigate here directly, then they are denied
  access.
- Given an email that is already a staff member or already has a pending invite, when an owner or
  admin submits it, then they see "already invited" and no duplicate invitation is sent.
- Given the backend or the invitation email provider is unavailable, when an owner or admin
  submits a new invite, then they see "Couldn't send invite" with a retry action, and the invite is
  not marked as sent.

## `/dashboard/settings/clinic`

- Given an owner or admin, when they update the clinic's hours, services, prices, or location and
  save, then the change is reflected in both the booking screens and what the assistant tells
  patients.
- Given a practitioner or receptionist, when they navigate here directly, then they are denied
  access.
- Given a newly onboarded clinic, when an owner opens this screen, then the fields are pre-filled
  with what was entered during sign-up — there is no separate empty state, since sign-up
  (see [`03-user-flows.md`](./03-user-flows.md)) guarantees this data exists before the screen is
  reachable.
- Given the backend is unavailable, when an owner or admin saves a change, then they see "Couldn't
  save changes" with a retry action and their edits remain in the form, not discarded.
