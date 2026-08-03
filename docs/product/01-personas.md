# Personas

Three of these four personas hold an account. The fourth does not, and that distinction is not
incidental — see the note at the end of this document.

## Clinic owner

**Goal:** Stop losing patients to unanswered messages and missed calls, without hiring or
managing another employee.

**Does today instead:** Answers WhatsApp messages personally between patients, or lets them pile
up until a receptionist has time, or loses the patient to a clinic that replied first.

**Fears:** That an automated system will say something wrong to a patient, embarrass the clinic,
or create a legal problem — and that they won't find out until it's already happened.

**Abandons if:** The assistant gives an answer that isn't grounded in what the clinic actually
told it (charter §3), or the owner can't tell, at a glance, what the assistant has been saying to
patients on the clinic's behalf.

## Receptionist

**Goal:** Get through the day's messages and phone-equivalent requests without every conversation
requiring her full attention.

**Does today instead:** Manually reads and replies to every message, keeps the appointment book in
a spreadsheet or paper diary, repeats the same answers (hours, prices, location) dozens of times a
day.

**Fears:** That the tool will make mistakes she has to clean up, or that patients will get worse
service than she would have given them herself.

**Abandons if:** She has to double-check every automated reply before it's safe to trust, because
then it hasn't saved her any work — it's added a review step.

## Practitioner

**Goal:** Walk into each day already knowing who's booked, when, and for what — without asking the
front desk.

**Does today instead:** Asks the receptionist or checks a shared paper/whiteboard schedule that's
sometimes out of date by the time they see it.

**Fears:** Being double-booked, or a patient showing up for a service or time the practitioner was
never told about.

**Abandons if:** The schedule they see isn't the schedule that's actually true — one stale sync and
they stop trusting it, back to asking the front desk directly.

## Patient

**Goal:** Get an answer or a booked appointment right now, without waiting for the clinic to be
open or a person to be free.

**Does today instead:** Calls during business hours and waits on hold, or sends a WhatsApp message
and waits — sometimes hours — for someone to see it and reply.

**Fears:** Being given wrong information about their care, or being stuck talking to something
that clearly can't help and won't let them reach a person.

**Abandons if:** The assistant guesses at anything resembling medical advice, or it can't complete
what should be a simple booking and offers no way to reach a human.

---

**Patients are records and message senders, never authenticated users of this system**
(charter §7). A patient never has a login, a password, or a session. Every other persona on this
page interacts with the product as a signed-in member of clinic staff; the patient interacts with
it only by sending and receiving messages, and by having those messages and the resulting
appointments recorded against their patient record.
