# Sitemap

Roles referenced below: **owner**, **admin**, **practitioner**, **receptionist**. See
[`00-overview.md`](./00-overview.md) for why this spec uses four roles where
[`docs/03-roadmap.md`](../03-roadmap.md)'s P2 acceptance criterion names only a floor of two.

Access levels:

- **Public** — reachable without signing in.
- **Public, gated** — reachable without an existing session, but requires a valid, single-purpose
  token (an invite or verification link).
- **Authenticated** — any signed-in staff member of the clinic, regardless of role.
- **Role-restricted** — authenticated, and further limited to the roles listed.

## Marketing site

- `/` — **Public**. Marketing home.
- `/privacy` — **Public**. Data handling and patient-data notice — required before any clinic
  goes live processing patient data (charter §7); not tied to a feature phase.

## Signed-in app

- `/login` — **Public**. Redirects to `/dashboard` if already signed in.
- `/invite/[token]/accept` — **Public, gated**. Single-use invite acceptance.
- `/dashboard` — **Authenticated**. Overview/landing screen for all four roles.
  - `/dashboard/conversations` — **Authenticated**. Conversation list.
    - `/dashboard/conversations/[conversationId]` — **Authenticated**. One conversation; replying
      is **role-restricted** to owner, admin, receptionist (practitioner is read-only here).
  - `/dashboard/patients` — **Authenticated**. Patient list.
    - `/dashboard/patients/[patientId]` — **Authenticated**. One patient's record and history.
  - `/dashboard/appointments` — **Authenticated** to view. Booking, rescheduling, and cancelling
    are **role-restricted** to owner, admin, receptionist.
    - `/dashboard/appointments/new` — **Role-restricted**: owner, admin, receptionist.
    - `/dashboard/appointments/[appointmentId]` — **Authenticated** to view; edit
      **role-restricted**: owner, admin, receptionist.
  - `/dashboard/knowledge-base` — **Role-restricted**: owner, admin.
    - `/dashboard/knowledge-base/upload` — **Role-restricted**: owner, admin.
  - `/dashboard/staff` — **Role-restricted**: owner, admin.
    - `/dashboard/staff/invite` — **Role-restricted**: owner, admin.
  - `/dashboard/settings/clinic` — **Role-restricted**: owner, admin.

A practitioner never reaches `/dashboard/knowledge-base`, `/dashboard/staff`, or
`/dashboard/settings/clinic` — those govern what the clinic tells the assistant and who has
access, not clinical or scheduling work. A receptionist reaches every route except those three.
