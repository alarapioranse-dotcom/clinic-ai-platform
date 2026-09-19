-- Roadmap P5 Slice 1 ("Knowledge base and AI" — first acceptance criterion
-- only: "each clinic maintains its own knowledge base (services, pricing,
-- hours, policies)"). No AI, no retrieval, no embeddings — see this PR's
-- description for the full column reconciliation against the design-only
-- schema in docs/technical/01-database-schema.md ("knowledge_documents").
--
-- That design-only schema models a file-upload + async processing pipeline
-- (filename, mime_type, size_bytes, storage_key, a processing/ready/failed
-- status, failed_reason, ready_at) built entirely to support the retrieval
-- architecture docs/technical/06-knowledge-document-storage.md describes
-- (extract text -> chunk -> embed -> mark ready). This slice implements none
-- of that pipeline, so none of those columns are implemented here — freezing
-- a `status` column with no process to ever move it off 'processing', or a
-- `storage_key` with nothing to write to it, would be dead schema, not
-- forward compatibility. See the PR description for the full grouping this
-- migration is derived from.
--
-- What IS implemented is the part of the KnowledgeDocument aggregate
-- (docs/domain/01-entities.md, docs/domain/02-aggregates.md) that the first
-- acceptance criterion actually requires: a clinic-owned, staff-authored
-- piece of knowledge-base content, with a title (for the list screen) and a
-- content body (the actual "services, pricing, hours, policies" text a later
-- slice's retrieval will read). Neither `title` nor `content` appears in the
-- design-only schema — that schema never needed them because it assumed the
-- knowledge lives inside an uploaded file's bytes, in object storage, not in
-- this table. Both are additive: a later slice that implements real file
-- upload can add its own columns (filename, storage_key, status, ...)
-- alongside these without touching or migrating away from what this slice
-- writes.
--
-- `updated_at` (also not in the design-only schema) exists because this
-- slice's UI is "create/edit" (task-specified), i.e. UPDATE-in-place —
-- unlike the file-upload model, where docs/domain/01-entities.md's point 5
-- treats a correction as a brand-new upload (a new row), never an edit of an
-- existing one. Same explicit `updated_at = now()` convention as
-- `appointments` (0011_appointments.sql): no trigger, set by the application
-- in the same UPDATE statement that changes title/content.
CREATE TABLE knowledge_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  title       text NOT NULL CHECK (length(title) > 0),
  content     text NOT NULL CHECK (length(content) > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Same rationale as every other clinic_id-prefixed index in this schema:
-- Postgres does not automatically index foreign-key columns, and every
-- RLS-filtered query on this table filters by clinic_id (this feature's only
-- query shape in this slice is "list/get this clinic's own documents").
CREATE INDEX knowledge_documents_clinic_id_idx ON knowledge_documents (clinic_id);

ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_documents
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- Least-privilege grants for the application role. Unlike conversations,
-- messages, and appointments (all withhold DELETE — they're audit-trail
-- records of things that happened), a knowledge-base entry is pure curated
-- content: a clinic must be able to remove an entry once it's wrong or
-- obsolete (e.g. stale pricing), and this slice has no status/soft-delete
-- column for that (see above — status is explicitly out of scope). DELETE is
-- therefore a genuine requirement of this resource's CRUD contract, not a
-- convenience grant.
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_documents TO app_user;
