# Value Objects

A Value Object is defined by its attributes, not by identity: two instances with equal attributes
are interchangeable, and neither is "the original." That test is applied to each candidate below,
per the Domain Glossary's definitions.

## TimeSlot

- **Invariants** — a start point and an end point, with start strictly before end; represents the
  reservable span an Appointment occupies.
- **Why a Value Object, not an Entity** — two TimeSlots covering the same start and end are the
  same slot in every sense that matters to this domain; nothing distinguishes "this instance" of
  09:00–09:30 from "that instance" of 09:00–09:30 except which Appointment currently holds it.
  Identity belongs to the Appointment, not to the span of time itself.

## WorkingHours

- **Invariants** — for each day, either a single open interval (start strictly before end) or a
  marker that the Clinic is closed that day; open intervals do not span midnight (a flow never
  describes overnight hours, so this is out of scope rather than silently supported).
- **Why a Value Object, not an Entity** — a Clinic doesn't have "the same working hours it had
  last month, now changed" as a continuous thing to track — when the Owner edits hours
  (`docs/product/03-user-flows.md`), the old value is simply replaced by a new one. There is no
  flow that needs to ask "is this the same WorkingHours record as before," only "what are the
  Clinic's current hours."

## PhoneNumber

- **Invariants** — must be a dialable number including country code (conceptual — exact format
  validation is Deliverable C); the WhatsApp-oriented flows imply this is the primary channel
  identifier for a Patient.
- **Why a Value Object, not an Entity** — two PhoneNumbers with the same digits are the same
  phone number; nothing in any flow needs to distinguish "the phone number as first entered" from
  "the phone number as it is now" — it's replaced wholesale if it changes, exactly like an email
  address would be.

## ServiceDuration

- **Invariants** — a positive quantity of time (greater than zero); used to compute how much of
  the Clinic's schedule a Service's Appointments occupy.
- **Why a Value Object, not an Entity** — a duration of 30 minutes on one Service and 30 minutes
  on another are simply equal, not "the same duration reused" in any sense the domain needs to
  track — there's no flow that follows a duration's history independent of the Service it
  describes.

## Money

- **Invariants** — a non-negative amount paired with a currency; amount is never meaningful
  without its currency, so the two always travel together as one value, never separately.
- **Why a Value Object, not an Entity** — €50 on one Service and €50 on another are the same value
  in every sense; there is no flow (and, per `docs/01-project-plan.md`'s out-of-scope list, no
  patient-payments feature at all in v1) that needs to track a specific Money instance's history.
  This is a pricing display value only — it does not model a transaction, invoice, or payment.
