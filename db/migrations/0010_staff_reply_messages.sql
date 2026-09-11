-- Roadmap P3-C ("Staff can view and reply to a conversation from the
-- `(app)` shell"). Widens `messages` to also accept staff-authored
-- messages, on top of the patient-only shape 0009_conversations.sql
-- established. Deliberately narrow, per the approved P3-C mandate:
--   - No `status`, `needs_staff`, `resolved`, escalation state, or
--     assignment anywhere — not in scope for this slice.
--   - `sender_type` becomes exactly ('patient', 'staff') — no 'assistant'.
--     The AI reply path does not exist yet.
--   - No message-length limit — `content`'s existing unbounded-text,
--     non-empty CHECK (`messages_content_check`, unchanged) is preserved.
--   - No RLS policy change and no trigger change: the existing
--     `tenant_isolation` policy and the "conversation has >= 1 message"
--     constraint triggers already cover a staff-authored row the same way
--     they cover a patient-authored one — nothing about this widening
--     requires touching either.

-- Widen the sender_type CHECK from ('patient') to ('patient', 'staff'),
-- using the constraint's existing (implicit, Postgres-assigned) name so
-- this is a true widening of the same constraint, not a parallel one.
ALTER TABLE messages DROP CONSTRAINT messages_sender_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_sender_type_check
  CHECK (sender_type IN ('patient', 'staff'));

-- Nullable: only staff-authored messages carry a sender. Patient-authored
-- messages (sender_type = 'patient') never populate this column — enforced
-- below, not merely documented here.
ALTER TABLE messages ADD COLUMN sender_staff_id uuid;

-- Bidirectional: sender_type = 'staff' requires a staff id, and every other
-- sender_type forbids one. Keeps the two columns from ever disagreeing
-- about whether this message has a staff author.
ALTER TABLE messages ADD CONSTRAINT messages_sender_staff_id_matches_sender_type
  CHECK (
    (sender_type = 'staff' AND sender_staff_id IS NOT NULL)
    OR (sender_type <> 'staff' AND sender_staff_id IS NULL)
  );

-- Composite FK to staff_members(id, clinic_id) (staff_members_id_key,
-- 0005_staff_members.sql) — the same "same-clinic reference, safe by
-- construction" pattern as conversations_patient_same_clinic and
-- messages_conversation_same_clinic in 0009_conversations.sql. A staff
-- member from a different clinic than this message's own clinic_id is
-- rejected structurally by this FK, not by an application-level check.
ALTER TABLE messages ADD CONSTRAINT messages_sender_staff_same_clinic
  FOREIGN KEY (sender_staff_id, clinic_id) REFERENCES staff_members (id, clinic_id);

-- No grant changes: the existing `GRANT SELECT, INSERT ON messages TO
-- app_user;` (0009_conversations.sql) already covers writing a staff
-- message row — this slice inserts, never updates or deletes.
