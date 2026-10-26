# First-clinic pilot kit

**Status:** draft for the Owner's review. Nothing here has been sent, published or promised to
anyone. Every external message needs the Owner's approval first.

**Working name:** Clinic AI Platform (the brand name is not settled; do not use a candidate name in
outreach until it is chosen). Contact: `clinicai.europe@gmail.com`.

**Checked against:** `main` at `93f1b2e` (2026-10-25). PR #111 (text extraction after upload) is
open and not merged.

## One sentence

A secure, clinic-scoped workspace where a dental clinic's staff handle patient messages and turn
them into booked appointments, built so that an administrative AI assistant can later answer from
the clinic's own documents, with staff in control.

## The problem it aims to solve

A small dental practice receives questions about prices, opening hours, availability and
appointments by phone and message, often while the staff are with patients or after hours.
Questions that go unanswered can become appointments that never happen. The aim is to help the
front desk answer and book faster, without replacing the clinic's people or its judgement.

This is a hypothesis to test with clinics, not a measured result. We have no customers and no
figures yet, and the materials must not suggest otherwise.

## What exists today, and how sure we are

### 1. Implemented and verified

- **Per-clinic data isolation.** Every clinic table uses PostgreSQL row level security with
  `FORCE ROW LEVEL SECURITY`. This is tested (913 automated tests on the current code, including
  cross-clinic isolation tests) and the production database structure was verified read-only
  (migrations 0018, 0019 and 0020; 0020 verified on 2026-10-25).
- **EU hosting.** Database in Frankfurt (Render), file storage in Paris (Scaleway). GDPR is the
  governing regime (ADR-0009). Hosting location is a fact. Legal compliance is not a certification
  we hold.
- **Staff accounts.** Sign-in, roles, one-time invitations for staff.
- **Conversations inbox.** Staff see conversation threads and reply.
- **Appointments.** Staff book an appointment from a conversation. Practitioners' working hours and
  time zones are respected, and double-booking is prevented by the database.
- **Clinic knowledge documents.** An owner or admin uploads clinic PDFs (price list, opening hours,
  policies) and sees them listed. The upload is checked to be a real PDF.
- **Demo environment.** A separate demo service with one fictional clinic and synthetic data only,
  fully isolated from production.

### 2. Implemented but not verified against real production use

- **No real clinic has signed in to production.** By design, production has no staff account yet,
  so the full signed-in flow has only been exercised in tests and in the demo environment.
- **File reading from production storage.** The permission of the production storage key to read
  uploaded files is not proven.
- **Text extraction from uploaded PDFs** (PR #111). It is built and tested, but not merged or
  deployed. Known limit: Arabic text from some word processors does not extract verbatim. On the
  current hosting plan, a restart during processing can leave a document stuck in "processing"
  (review D6 is still open).

### 3. Planned, incomplete or not available

- **Automated or AI replies to patients.** Not built. No AI provider has been chosen (ADR-0019 is
  Proposed).
- **Answers grounded in the clinic's documents** (retrieval). Not built.
- **A channel for patients to write in**, such as a website chat, WhatsApp or Viber. Not built.
  Today, messages in the inbox come only from test data.
- **Automatic booking by the system.** Not built. Booking is done by staff.
- **Missed-call follow-up, reminders, waiting list.** Ideas only.
- **Medical advice of any kind.** Never. The product is administrative by design (ADR-0011).
  Clinical questions go to staff.

## Proposed value (to be tested, not promised)

- Staff can see patient questions in one place and reply without losing track.
- Bookings are made without double-booking, in the right time zone.
- Later, if the pilot shows it is wanted: draft replies from the clinic's own documents, which a
  staff member approves before anything is sent ("staff approve, AI drafts").

## 5-minute presentation outline

1. **(1 min)** Who I am, why I am building this, and that this is a discovery meeting, not a sale.
2. **(1 min)** The problem as I understand it. Ask them whether it matches their reality.
3. **(2 min)** A screen walk-through of the demo with the fictional clinic: inbox, staff reply,
   booking from a conversation, the knowledge-documents list. Say clearly that it is a demo with
   invented data. See `first-clinic-demo-script.md`.
4. **(1 min)** What is not built yet: AI replies and the patient channel. Ask which of these would
   matter to them, and how patients reach them today.
5. **Close.** Ask for feedback and a second, longer conversation.

## FAQ

**Is our patients' data safe?**
Each clinic's data is separated at the database level, and the system is hosted in the EU. No real
patient data is used before a written agreement on data processing exists. We do not claim a
certification.

**Where is the data stored?**
In the European Union: the database in Frankfurt, files in Paris.

**Does it give medical advice?**
No, never. It is administrative only, and clinical questions are passed to your staff.

**Which languages?**
The design is meant to support several languages (ADR-0020), but the staff interface today is in
Arabic only. Greek (and English) screens for clinic staff are not available yet and would be needed
before a Greek clinic could use it.

**Is there AI in it today?**
Not in the replies yet. AI-drafted answers from your own documents are the next planned step, and
they would be approved by your staff before sending. The choice of AI provider is still under
review.

**What does setup involve?**
For a pilot: an account for the clinic, the clinic's documents (price list, hours, policies), and
agreement on how patients would reach the system. None of this happens before a data-processing
agreement.

**What does it cost?**
Nothing during a pilot. Pricing is not decided, and we would discuss it only after the pilot shows
real value.

**What is not available yet?**
Automated replies, a patient chat channel (website, WhatsApp or Viber), automatic booking and
reminders.

## Pilot proposal

- **First step:** a 15-20 minute discovery meeting. No commitment and no cost.
- **If both sides want to continue:** a free pilot of about 2-3 months as a design partner, starting
  only after the prerequisites below are done and a data-processing agreement is signed.
- **What the clinic gives:** time for feedback (for example, 30 minutes every two weeks) and its
  public information and documents.
- **What the clinic gets:** a voice in what is built, and no cost during the pilot.

## Prerequisites before any real clinic uses the system

Technical:

- [ ] Greek (and English) staff interface. Today every screen is in Arabic only (checked at
      `93f1b2e`: Arabic text in 25 screen files, Greek in none). This is also the main obstacle to
      a convincing demo for a Greek clinic.
- [ ] PR #111 reviewed, merged and verified after deployment.
- [ ] AI provider decision (ADR-0019) recorded before any AI reply exists.
- [ ] Retrieval and staff-approved draft replies built, with their own ADR and gates.
- [ ] Patient channel decided (needs an ADR) and built.
- [ ] ADR-0026 D6 review: worker isolation and recovery of documents stuck in "processing".
- [ ] Production storage read permission verified.
- [ ] A restore from backup rehearsed (PITR drill, Phase 3), because backups are not proven yet.
- [ ] Production web service moved off the Free plan.
- [ ] The production-rebuild runbook rehearsed.

Operational and legal:

- [ ] Privacy page with an AI disclosure.
- [ ] Data-processing agreement (Art. 28 GDPR) with the clinic; advice from a professional adviser
      on health data (Art. 9 GDPR).
- [ ] Clinic provisioning in production (`scripts/provision-clinic.ts`), with its own Owner approval.
- [ ] Brand name chosen and checked.
- [ ] Separate Owner approval for showing the demo environment to someone outside the project
      (the demo is Owner-only until then).
