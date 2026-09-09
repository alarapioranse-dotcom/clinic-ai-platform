-- Schema per docs/technical/01-database-schema.md ("conversations" and
-- "messages" sections), scoped to roadmap P3-A ("Clinic-scoped inbound
-- conversation persistence") only. Two deliberate amendments to that
-- illustrative doc, both scope decisions for this slice, not schema
-- corrections:
--   - conversations has no `status` column and no `updated_at`. Status and
--     the escalation-agreement trigger that depends on it are P3-B/P3-C's
--     job (staff view/reply, escalations) — out of scope here.
--   - messages.sender_type only accepts 'patient' (not also 'assistant' /
--     'staff'), and carries no `sender_staff_id`. This slice only persists
--     inbound patient messages; the AI assistant and staff-reply paths that
--     would write the other sender types don't exist yet.
--
-- CONCURRENCY: find-or-create's race (two simultaneous inbound messages for
-- the same patient both observing "no conversation yet") is closed by
-- `SELECT ... FROM patients ... FOR UPDATE` inside the same transaction
-- (src/features/conversations/repository.ts), not by a schema constraint.
-- That requires app_user to hold the UPDATE privilege on `patients` —
-- Postgres's `FOR UPDATE` requires UPDATE (or DELETE), not merely SELECT —
-- which 0004_patients.sql already grants (`GRANT SELECT, INSERT, UPDATE ON
-- patients TO app_user;`) and no later migration revokes.

CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  patient_id       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT conversations_id_key UNIQUE (id, clinic_id),
  -- Same-clinic reference: a Conversation's Patient must belong to the same
  -- Clinic (docs/domain/04-relationships.md: "safe by construction"). Also
  -- what rejects a cross-clinic patient_id structurally — see repository.ts.
  CONSTRAINT conversations_patient_same_clinic
    FOREIGN KEY (patient_id, clinic_id) REFERENCES patients (id, clinic_id)
  -- Deliberately no UNIQUE (clinic_id, patient_id) (Architect ruling for
  -- P3-A): the domain has not established a one-conversation-per-patient
  -- invariant, and encoding it now would create migration debt later. The
  -- concurrency fix above serializes this slice's own find-or-create path
  -- without relying on such a constraint existing.
);

-- Same rationale as patients_clinic_id_idx (0004_patients.sql): Postgres
-- does not automatically index foreign-key columns, and every RLS-filtered
-- query on this table filters by clinic_id; find-or-create additionally
-- filters by patient_id (repository.ts), hence the composite shape.
CREATE INDEX conversations_clinic_patient_idx ON conversations (clinic_id, patient_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversations
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  conversation_id  uuid NOT NULL,
  sender_type      text NOT NULL CHECK (sender_type IN ('patient')),
  content          text NOT NULL CHECK (length(content) > 0),
  sent_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT messages_conversation_same_clinic
    FOREIGN KEY (conversation_id, clinic_id) REFERENCES conversations (id, clinic_id)
  -- Messages are immutable once sent (B, business rules): no UPDATE grant
  -- is exposed on this table below beyond insert.
);

CREATE INDEX messages_clinic_conversation_idx ON messages (clinic_id, conversation_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- Enforces "a Conversation always has >= 1 Message" (docs/technical/01-database-schema.md,
-- "messages" section) without forbidding the ordinary two-statement flow
-- (INSERT conversation, INSERT its first message) from happening in that
-- order within one transaction: the check runs once at COMMIT, not after
-- each individual statement. Architect ruling for P3-A: included exactly as
-- specified there, not a different trigger design.
CREATE FUNCTION assert_conversation_has_message() RETURNS trigger AS $$
DECLARE
  affected_conversation_id uuid := COALESCE(NEW.conversation_id, OLD.conversation_id);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM messages WHERE conversation_id = affected_conversation_id
  ) THEN
    RAISE EXCEPTION 'conversation % has no messages', affected_conversation_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER conversation_has_at_least_one_message
  AFTER INSERT OR DELETE ON messages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_conversation_has_message();

-- Least-privilege grants for the application role. No UPDATE, no DELETE on
-- either table: this slice never modifies or removes a committed
-- conversation or message (messages are immutable once sent; conversations
-- have no mutable field yet — status is P3-B/P3-C's job).
GRANT SELECT, INSERT ON conversations TO app_user;
GRANT SELECT, INSERT ON messages TO app_user;
