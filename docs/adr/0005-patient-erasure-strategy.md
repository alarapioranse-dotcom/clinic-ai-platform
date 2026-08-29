# 0005 — Patient erasure strategy

## Status

Accepted

Accepted by: Ahmed (project owner)
Accepted on: 2026-08-29
Recorded in: PR #4
Note: decision content approved by the owner in session; status recorded retroactively.

## Date

2026-08-29

## Phase

Cross-cutting — governs erasure behavior for Patient, Conversation, Message, and Appointment,
entities introduced across P1, P3, and P4 (see [`docs/03-roadmap.md`](../03-roadmap.md)). Required
before the first clinic goes live, per [charter §7](../governance/project-charter.md).

## Impact

One-way door (see [charter §10](../governance/project-charter.md)) — approved directly by Ahmed.
Shapes the deletion/anonymisation behavior of every entity traceable to a Patient; reversing this
after real patient data exists is a migration under legal pressure, not a configuration change.

## Context

Charter §7 requires that retention and erasure be designed before the first clinic goes live, and
that patient health data be treated as GDPR Article 9 special category data, not ordinary personal
data. [Deliverable B](../domain/00-overview.md) (the domain model) identified this as Candidate ADR
4: on a GDPR Article 17 erasure request, are a patient's Conversations, Messages, and Appointments
deleted outright, or anonymized and retained for the clinic's own operational or legal record? The
entities most directly implicated are Patient, Conversation, Message, and Appointment
([`docs/domain/06-multi-tenancy.md`](../domain/06-multi-tenancy.md)). This can't be decided
per-entity in isolation: Conversation, Message, and Appointment carry different data
classifications relative to Patient (GDPR Article 9 Special Category Data vs. ordinary Personal
Data — [`docs/domain/01-entities.md`](../domain/01-entities.md)) and different legitimate-retention
arguments (Appointment: operational/legal record-keeping under Article 17(3); Conversation/Message:
patient-authored free text that is presumptively not safely anonymisable).

## Decision

Irreversible anonymisation, not full deletion, applied per entity — and only where it can be
justified; deletion remains the default everywhere it cannot.

- **Patient** — on an Article 17 erasure request, the Patient record's identifying attributes
  (contact information, and any other directly identifying attribute) are irreversibly replaced. No
  reversible mapping or recoverable key to the original identity is retained anywhere.
- **Appointment** — retained in de-identified form only where the Clinic has an independent legal
  and operational basis for retaining that appointment history under Article 17(3) (e.g., dispute
  or regulatory record-keeping). Absent that basis, an Appointment referencing an erased Patient is
  deleted, not merely de-identified.
- **Conversation and Message** — deletion is the default. A Conversation or Message may be retained
  only if it can be demonstrated to be irreversibly anonymised, such that no natural person can
  reasonably be re-identified from it. Otherwise, it is permanently deleted.

**Safeguard 1 — deletion is the default; retention is the exception and carries the burden of
proof.** Where there is uncertainty about whether a given piece of data can be irreversibly
anonymised, the data is deleted, not retained.

**Safeguard 2 — Patient free text is presumed non-anonymisable.** Removing names, phone numbers, or
other known identifiers from a Message is not sufficient on its own to call it anonymised. An
automated identifier scrub, by itself, is never sufficient grounds for retention.

This is a privacy-first strategy, not an analytics or data-retention strategy — it is not designed
to maximize what the platform or a clinic can keep; it is designed to minimize what survives an
erasure request to only what can be justified and demonstrated.

Pseudonymised data is still personal data. Replacing an identifier with a token, hash, or reference
is not anonymisation for the purposes of this decision, and data in that state remains fully in
scope of GDPR and this ADR's deletion default.

The clinic must be informed, at onboarding, what patient data is retained after an erasure request
and why — this is not a detail to surface only if asked.

Any decision to retain a specific Conversation or Message on the grounds that it is anonymised must
itself be recorded and demonstrable — the retaining party must be able to show, on request, why
that specific record was judged safe to keep.

## Consequences

- Every entity referencing a Patient (Conversation, Message, Appointment; and Escalation
  transitively, as an internal entity of the Conversation aggregate —
  [`docs/domain/02-aggregates.md`](../domain/02-aggregates.md)) now has a defined erasure behavior,
  recorded per-entity in [`docs/domain/01-entities.md`](../domain/01-entities.md).
- Because deletion is the default and retention is the justified exception, the common case for
  Conversation/Message on an erasure request is straightforward deletion; the anonymisation path
  exists for the genuine exception, not as the default outcome.
- Appointment retention under Article 17(3) requires the Clinic to have an actual, identifiable
  legal or operational basis at the time of the request — this is not a blanket allowance to keep
  appointment history by default.
- Implementing this (the mechanics of anonymisation, what "irreversible" means at the storage
  layer, how a retention justification is recorded and audited) is Deliverable C's and later work's
  responsibility; this ADR settles the strategy, not the mechanism. No schema, migration, or
  application code is introduced by this record.
- Retention-period design (Question Remaining #3 in
  [`docs/domain/00-overview.md`](../domain/00-overview.md)) is still open and unresolved by this
  ADR — this ADR governs what happens to data _on an erasure request_, not how long data is kept in
  the ordinary course before one is made.

## Alternatives considered

- **Full deletion of everything referencing the patient.** Simplest to reason about and closest to
  a strict reading of Article 17, but forecloses a clinic's legitimate, narrow retention needs
  (e.g., dispute records) even where Article 17(3) would permit them. Rejected as unnecessarily
  rigid.
- **Retain everything and rely on access controls.** Keeps the clinic's full operational history
  intact but does not satisfy Article 17's erasure right at all — access control restricts who can
  see data, it does not erase it. Rejected outright; not a compliant option.
- **Per-clinic configurable retention policy.** Maximum flexibility for each clinic's own legal
  situation, but pushes a GDPR compliance decision onto individual clinic operators who are not
  equipped to make it correctly, and makes the platform's own compliance posture dependent on every
  clinic's configuration choice. Rejected as disproportionate risk for a decision this
  consequential.
- **Pseudonymisation with a recoverable key.** Would let the platform reverse anonymisation later
  (e.g., for a legal hold), but a recoverable key means the data was never actually erased — it
  remains personal data under GDPR by definition, so this doesn't satisfy Article 17 either.
  Rejected.

## Assumptions and limits

- This ADR assumes GDPR is the sole governing privacy regime.
- It does NOT cover jurisdictions with mandatory minimum health-data retention or data
  localisation requirements. Serving such a jurisdiction requires a new ADR that supersedes or
  amends this one.
- Audit log records are OUT OF SCOPE of this ADR. Their erasure behaviour is undecided and
  requires a separate ADR.
