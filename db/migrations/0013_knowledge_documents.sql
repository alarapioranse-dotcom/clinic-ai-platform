-- Roadmap P5 Slice 1A ("document persistence foundation"). Schema exactly per
-- docs/technical/01-database-schema.md's "knowledge_documents" section — a
-- file-upload record (identity, status, metadata pointing at an object-store
-- key), not the invented title/content/updated_at/edit-in-place model PR #65
-- proposed and was rejected for. This migration adds no column, table, or
-- lifecycle rule beyond what that document already specifies.
--
-- Doc-bug fix (same charter Definition of Done pattern as
-- db/migrations/0011_appointments.sql's tsrange/timestamptz correction):
-- 01-database-schema.md's `knowledge_document_status_fields_match` constraint
-- is written as `CONSTRAINT knowledge_document_status_fields_match (...)`,
-- missing the `CHECK` keyword before the parenthesized condition — invalid
-- SQL as written (PostgreSQL requires `CONSTRAINT <name> CHECK (<expr>)`).
-- This migration supplies the keyword; the doc is corrected in this same PR.
--
-- NO create/insert path exists yet: `storage_key` is `NOT NULL` and is only
-- ever produced by the upload flow (ADR-0018: browser-to-Scaleway presigned
-- PUT, `storage_key = clinic_id/document_id`), which is Slice 1B, entirely
-- out of scope here (no Scaleway SDK, no presigned URLs, no object bytes in
-- this slice). There is therefore no legitimate application code path that
-- can INSERT a row into this table in 1A without inventing a metadata-only
-- document the domain never intended — exactly what this slice's brief
-- forbids. Tests insert fixture rows directly over the admin/owner
-- connection (tests/fixtures.ts's own convention for administrative writes,
-- e.g. createTestClinic), not through app_user or a repository create
-- function, because no such function exists.
CREATE TABLE knowledge_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  -- 01-database-schema.md documented this column as a plain
  -- `REFERENCES staff_members(id)` — written before this schema adopted the
  -- same-clinic composite-FK pattern now used throughout (conversations,
  -- messages, appointments). Owner review on this PR requires the same
  -- pattern here too: the composite FK below, matching
  -- appointments_practitioner_same_clinic's shape, is what makes "an
  -- uploader belongs to the same clinic as the document" a structural
  -- impossibility to violate rather than an application-code discipline.
  -- Its target, staff_members_id_key UNIQUE (id, clinic_id), already exists
  -- (db/migrations/0005_staff_members.sql) — no new unique constraint is
  -- needed. The doc is corrected to match in this same PR.
  uploaded_by      uuid NOT NULL REFERENCES staff_members(id),
  filename         text NOT NULL,
  mime_type        text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes > 0),
  storage_key      text NOT NULL, -- see docs/technical/06-knowledge-document-storage.md; populated only by the Slice 1B upload flow
  status           text NOT NULL DEFAULT 'processing'
                     CHECK (status IN ('processing', 'ready', 'failed')),
  failed_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  ready_at         timestamptz,

  CONSTRAINT knowledge_document_status_fields_match CHECK (
    (status = 'ready' AND ready_at IS NOT NULL) OR
    (status <> 'ready' AND ready_at IS NULL)
  ),
  CONSTRAINT knowledge_document_failed_reason_matches_status
    CHECK (status = 'failed' OR failed_reason IS NULL),

  -- Same-clinic reference, same structural pattern as
  -- appointments_practitioner_same_clinic (0011) and
  -- messages_sender_staff_same_clinic (0010): a cross-clinic uploaded_by is
  -- rejected by the database itself, not trusted from application code.
  CONSTRAINT knowledge_documents_uploaded_by_same_clinic
    FOREIGN KEY (uploaded_by, clinic_id) REFERENCES staff_members (id, clinic_id)
);

-- Same rationale as every other clinic_id-prefixed index in this schema
-- (patients_clinic_id_idx, appointments_clinic_practitioner_idx, ...):
-- Postgres does not automatically index foreign-key columns, and every
-- RLS-filtered query on this table filters by clinic_id.
CREATE INDEX knowledge_documents_clinic_id_idx ON knowledge_documents (clinic_id);

ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_documents
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- Least-privilege grants for the application role, scoped to what this
-- slice's repository actually does (src/features/knowledge-base/repository.ts:
-- list/get reads only):
--
-- SELECT: required for the read operations this slice implements
-- (listKnowledgeDocumentsForClinic, getKnowledgeDocumentById). Table-wide,
-- not column-restricted, matching patients/conversations/appointments —
-- unlike `clinics` (0003_clinics.sql), this table carries RLS, so a
-- table-wide grant does not expose cross-tenant data the way an unscoped
-- grant on the RLS-less `clinics` table would.
--
-- No INSERT: the only documented way a row is created is the Slice 1B
-- upload flow (POST /api/knowledge-documents, populating storage_key from a
-- completed object-store upload) — no code in this slice ever issues that
-- INSERT, so granting it now would be a privilege with no corresponding
-- call site.
--
-- No UPDATE: the processing → ready/failed status transition
-- (docs/technical/06-knowledge-document-storage.md, "Processing lifecycle",
-- steps 4-6) is part of the same upload/extraction pipeline as the INSERT
-- above — out of scope for the same reason.
--
-- No DELETE: object deletion is explicitly Slice 1B
-- (docs/technical/06-knowledge-document-storage.md: "Deleting a
-- knowledge_documents row... deletes the corresponding object in the same
-- logical operation" — deleting the row without deleting the object would
-- orphan it, so this slice grants neither).
GRANT SELECT ON knowledge_documents TO app_user;
