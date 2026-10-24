-- 0020 — knowledge_document_chunks, the knowledge_document_processor role and
-- the two tenant-bound write functions (ADR-0026, Accepted; Owner rulings
-- D3, D5, D7 and PR B decisions E1-E6 of 2026-10-23).
--
-- What this migration adds, and nothing else:
--   1. A guard: the database must use UTF8, because chunk offsets are counted
--      in Unicode code points (PostgreSQL's length() on text) and the NFKC
--      check below needs it (E4).
--   2. A unique constraint on knowledge_documents (id, clinic_id), the target
--      of the chunks' same-clinic composite foreign key (same pattern as
--      patients_id_key, staff_members_id_key, conversations_id_key).
--   3. The knowledge_document_chunks table: RLS + FORCE RLS with the standard
--      tenant_isolation policy (ADR-0006, ADR-0008), row checks for the chunk
--      contract (ADR-0026 section 6, E5), and no embedding column.
--   4. app_user: SELECT on the chunks table and nothing else (D7). app_user
--      keeps no UPDATE on knowledge_documents (D3).
--   5. A dedicated NOLOGIN owner role, knowledge_document_processor (E1),
--      holding only the combined column privileges of the two functions.
--   6. Two SECURITY DEFINER functions, the only write paths:
--        store_knowledge_document_chunks  -- stores one complete chunk set
--        mark_knowledge_document_failed   -- processing -> failed
--      Both pin search_path = pg_catalog, public, pg_temp and schema-qualify
--      every table and function name (ADR-0024); EXECUTE is revoked from
--      PUBLIC and granted to app_user only.
--   7. The migrating role keeps SET but not INHERIT on the new owner role,
--      with the same fail-closed check as 0019 (ADR-0025).
--
-- Neither function changes a document to `ready`: that belongs to the
-- embeddings slice (ADR-0026 section 7).

-- 1. Encoding guard (E4).
DO $$
BEGIN
  IF pg_catalog.current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION
      '0020: the database encoding is %, not UTF8; chunk offsets and the NFKC check require UTF8',
      pg_catalog.current_setting('server_encoding');
  END IF;
END
$$;

-- 2. Composite-key target for the chunks' same-clinic foreign key.
ALTER TABLE knowledge_documents
  ADD CONSTRAINT knowledge_documents_id_key UNIQUE (id, clinic_id);

-- 3. The chunks table. Offsets are zero-based, half-open [char_start,
-- char_end) in Unicode code points of the document's canonical text
-- (ADR-0026 section 5). Continuity across rows (first chunk at 0, each chunk
-- starting where the previous ended, the set covering the whole text) cannot
-- be a row check; store_knowledge_document_chunks enforces it for the whole
-- set inside one statement, and is the only way rows get here.
CREATE TABLE knowledge_document_chunks (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id                uuid NOT NULL REFERENCES clinics(id),
  document_id              uuid NOT NULL,
  ordinal                  integer NOT NULL CHECK (ordinal >= 0),
  content                  text NOT NULL,
  char_start               integer NOT NULL CHECK (char_start >= 0),
  char_end                 integer NOT NULL,
  extractor_version        text NOT NULL,
  canonicalization_version text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT knowledge_document_chunk_range_nonempty CHECK (char_end > char_start),
  CONSTRAINT knowledge_document_chunk_content_matches_range
    CHECK (char_end - char_start = length(content)),
  -- E5: the hard maximum of ADR-0026 section 5, also enforced in the store function.
  CONSTRAINT knowledge_document_chunk_max_length CHECK (char_end - char_start <= 2000),
  CONSTRAINT knowledge_document_chunk_versions_present CHECK (
    btrim(extractor_version) <> '' AND length(extractor_version) <= 100
    AND btrim(canonicalization_version) <> '' AND length(canonicalization_version) <= 100
  ),
  CONSTRAINT knowledge_document_chunks_document_ordinal_key UNIQUE (document_id, ordinal),
  -- Same-clinic reference: a chunk can never point at another clinic's
  -- document. Deleting a document deletes its chunks
  -- (docs/technical/06-knowledge-document-storage.md).
  CONSTRAINT knowledge_document_chunks_document_same_clinic
    FOREIGN KEY (document_id, clinic_id) REFERENCES knowledge_documents (id, clinic_id)
    ON DELETE CASCADE
);

CREATE INDEX knowledge_document_chunks_clinic_id_idx ON knowledge_document_chunks (clinic_id);

ALTER TABLE knowledge_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_document_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_document_chunks
  USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- 4. app_user: read only (D7). The REVOKEs assert rather than assume.
GRANT SELECT ON knowledge_document_chunks TO app_user;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON knowledge_document_chunks FROM app_user;
REVOKE UPDATE, DELETE, TRUNCATE ON knowledge_documents FROM app_user;

-- 5. The owner role (E1). Same creation and hardening pattern as 0015.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'knowledge_document_processor') THEN
    CREATE ROLE knowledge_document_processor NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- ADR-0025: SET (needed to transfer function ownership) but never INHERIT,
-- so the migrating role does not gain this role's privileges ambiently.
GRANT knowledge_document_processor TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
-- The prospective owner of a function needs CREATE on its schema (checked at
-- ownership transfer; the role is NOLOGIN and never exercises it).
GRANT CREATE ON SCHEMA public TO knowledge_document_processor;

DO $$
DECLARE
  needs_fix boolean;
BEGIN
  SELECT rolsuper OR rolbypassrls OR rolcanlogin INTO needs_fix
  FROM pg_catalog.pg_roles WHERE rolname = 'knowledge_document_processor';

  IF NOT needs_fix THEN
    RETURN;
  END IF;

  BEGIN
    ALTER ROLE knowledge_document_processor NOLOGIN NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION
      'knowledge_document_processor already exists with elevated privileges (SUPERUSER, LOGIN, '
      'and/or BYPASSRLS), and the role running this migration (%) does not have the privilege to '
      'remove them. Fix it manually, connected as a superuser, then re-run migrations: '
      'ALTER ROLE knowledge_document_processor NOLOGIN NOSUPERUSER NOBYPASSRLS;', current_user;
  END;
END
$$;

-- The combined privileges of the two functions (ADR-0026 section 7), column
-- by column. Every referenced column needs a privilege, including those read
-- only by a WHERE clause. The column UPDATE on knowledge_documents is also
-- what allows SELECT ... FOR UPDATE on its rows.
GRANT SELECT (id, clinic_id, status) ON knowledge_documents TO knowledge_document_processor;
GRANT UPDATE (status, failed_reason) ON knowledge_documents TO knowledge_document_processor;
GRANT SELECT (document_id, clinic_id) ON knowledge_document_chunks TO knowledge_document_processor;
GRANT INSERT (clinic_id, document_id, ordinal, content, char_start, char_end,
              extractor_version, canonicalization_version)
  ON knowledge_document_chunks TO knowledge_document_processor;

-- 6a. Store one complete chunk set (E2, E3, E5, E6).
--
-- Takes the canonical text and the chunk contents in order; the function
-- derives every offset itself, so the caller cannot submit offsets that
-- disagree with the contents. The set is valid only if every chunk is
-- non-empty and at most 2,000 code points, and the chunks concatenated in
-- order equal the canonical text exactly -- which is the same as every chunk
-- equalling its derived half-open range. The canonical text must already be
-- NFKC-normalised (D5). One INSERT writes the whole set; any error raises
-- and rolls back everything the call wrote.
--
-- Errors (standard SQLSTATEs, E6):
--   25000 invalid_transaction_state  not READ COMMITTED
--   42501 insufficient_privilege     no tenant context
--   22023 invalid_parameter_value    invalid arguments or chunk set
--   P0002 no_data_found              no such document in the context clinic
--   55000 object_not_in_prerequisite_state
--                                    document not processing, or chunks exist
CREATE FUNCTION store_knowledge_document_chunks(
  p_document_id uuid,
  p_extractor_version text,
  p_canonicalization_version text,
  p_canonical_text text,
  p_chunks text[]
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_context text;
  v_clinic_id uuid;
  v_status text;
  v_chunk text;
  v_inserted integer;
BEGIN
  -- The serialisation argument of ADR-0026 section 7 holds only under READ
  -- COMMITTED, where each statement after the row lock sees rows committed
  -- by the transaction that held it.
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'store_knowledge_document_chunks: requires READ COMMITTED isolation'
      USING ERRCODE = 'invalid_transaction_state';
  END IF;

  v_context := pg_catalog.current_setting('app.current_clinic_id', true);
  IF v_context IS NULL OR v_context = '' THEN
    RAISE EXCEPTION 'store_knowledge_document_chunks: no tenant context (app.current_clinic_id is not set)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_clinic_id := v_context::uuid;

  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'store_knowledge_document_chunks: document id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_extractor_version IS NULL OR pg_catalog.btrim(p_extractor_version) = ''
     OR pg_catalog.length(p_extractor_version) > 100
     OR p_canonicalization_version IS NULL OR pg_catalog.btrim(p_canonicalization_version) = ''
     OR pg_catalog.length(p_canonicalization_version) > 100 THEN
    RAISE EXCEPTION 'store_knowledge_document_chunks: invalid version strings'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_canonical_text IS NULL OR p_canonical_text = '' THEN
    RAISE EXCEPTION 'store_knowledge_document_chunks: canonical text is empty'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT (p_canonical_text IS NFKC NORMALIZED) THEN
    RAISE EXCEPTION 'store_knowledge_document_chunks: canonical text is not NFKC-normalised'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_chunks IS NULL OR pg_catalog.cardinality(p_chunks) = 0 THEN
    RAISE EXCEPTION 'store_knowledge_document_chunks: chunk set is empty'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF pg_catalog.array_ndims(p_chunks) <> 1 THEN
    RAISE EXCEPTION 'store_knowledge_document_chunks: chunk set must be a one-dimensional array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Lock the document row first, so a concurrent mark_knowledge_document_failed
  -- (which locks the same row) serialises with this call. RLS also applies:
  -- the owner role has no BYPASSRLS, so only the context clinic's row is visible.
  SELECT d.status INTO v_status
    FROM public.knowledge_documents d
   WHERE d.id = p_document_id AND d.clinic_id = v_clinic_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store_knowledge_document_chunks: no such document for this clinic'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'processing' THEN
    RAISE EXCEPTION 'store_knowledge_document_chunks: document is not processing'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.knowledge_document_chunks c
     WHERE c.document_id = p_document_id AND c.clinic_id = v_clinic_id
  ) THEN
    RAISE EXCEPTION 'store_knowledge_document_chunks: document already has a chunk set'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  FOREACH v_chunk IN ARRAY p_chunks LOOP
    IF v_chunk IS NULL OR v_chunk = '' THEN
      RAISE EXCEPTION 'store_knowledge_document_chunks: empty chunk'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF pg_catalog.length(v_chunk) > 2000 THEN
      RAISE EXCEPTION 'store_knowledge_document_chunks: chunk longer than 2000 code points'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  -- No NULL element remains (checked above), so array_to_string drops nothing.
  IF pg_catalog.array_to_string(p_chunks, '') <> p_canonical_text THEN
    RAISE EXCEPTION 'store_knowledge_document_chunks: chunks do not reproduce the canonical text'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.knowledge_document_chunks
    (clinic_id, document_id, ordinal, content, char_start, char_end,
     extractor_version, canonicalization_version)
  SELECT v_clinic_id,
         p_document_id,
         (t.ord - 1)::integer,
         t.content,
         (t.running_end - pg_catalog.length(t.content))::integer,
         t.running_end::integer,
         p_extractor_version,
         p_canonicalization_version
    FROM (
      SELECT u.content,
             u.ord,
             pg_catalog.sum(pg_catalog.length(u.content)) OVER (ORDER BY u.ord) AS running_end
        FROM pg_catalog.unnest(p_chunks) WITH ORDINALITY AS u(content, ord)
    ) t
   ORDER BY t.ord;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION store_knowledge_document_chunks(uuid, text, text, text, text[]) IS
  'ADR-0026. The only write path for knowledge_document_chunks. Stores one complete chunk set for a '
  'processing document of the app.current_clinic_id clinic, deriving offsets itself; fails closed '
  'without tenant context or outside READ COMMITTED. Never changes document status. Do not add a '
  'clinic-id argument, accept caller-supplied offsets, or widen the EXECUTE grant.';

-- Privileges are set BEFORE ownership moves, while the migrating role still
-- owns the function. After 0019 (ADR-0025) the migrating role holds SET but
-- not INHERIT on the owner role, so once ownership is transferred it can no
-- longer revoke or grant on the function: PostgreSQL then only warns ("no
-- privileges could be revoked") and PUBLIC keeps EXECUTE. ALTER ... OWNER
-- carries these ACL entries over to the new owner as grantor.
REVOKE ALL ON FUNCTION store_knowledge_document_chunks(uuid, text, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION store_knowledge_document_chunks(uuid, text, text, text, text[]) TO app_user;
ALTER FUNCTION store_knowledge_document_chunks(uuid, text, text, text, text[])
  OWNER TO knowledge_document_processor;

-- 6b. Mark a document failed (E6). Only while it is processing and has no
-- chunk set: a complete chunk set can never be turned into a failure by a
-- duplicate schedule or a delayed timeout. The reason is one of the closed
-- set of ADR-0026 section 7; no free text is ever stored.
CREATE FUNCTION mark_knowledge_document_failed(p_document_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_context text;
  v_clinic_id uuid;
  v_status text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'mark_knowledge_document_failed: requires READ COMMITTED isolation'
      USING ERRCODE = 'invalid_transaction_state';
  END IF;

  v_context := pg_catalog.current_setting('app.current_clinic_id', true);
  IF v_context IS NULL OR v_context = '' THEN
    RAISE EXCEPTION 'mark_knowledge_document_failed: no tenant context (app.current_clinic_id is not set)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_clinic_id := v_context::uuid;

  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'mark_knowledge_document_failed: document id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN (
    'too_large', 'too_many_pages', 'too_much_text', 'extraction_timeout', 'extraction_error',
    'no_extractable_text', 'encrypted', 'object_missing', 'object_changed', 'not_a_pdf'
  ) THEN
    RAISE EXCEPTION 'mark_knowledge_document_failed: unknown reason code'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT d.status INTO v_status
    FROM public.knowledge_documents d
   WHERE d.id = p_document_id AND d.clinic_id = v_clinic_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_knowledge_document_failed: no such document for this clinic'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'processing' THEN
    RAISE EXCEPTION 'mark_knowledge_document_failed: document is not processing'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.knowledge_document_chunks c
     WHERE c.document_id = p_document_id AND c.clinic_id = v_clinic_id
  ) THEN
    RAISE EXCEPTION 'mark_knowledge_document_failed: document already has a chunk set'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE public.knowledge_documents
     SET status = 'failed', failed_reason = p_reason
   WHERE id = p_document_id AND clinic_id = v_clinic_id;
END;
$$;

COMMENT ON FUNCTION mark_knowledge_document_failed(uuid, text) IS
  'ADR-0026. The only path from processing to failed. Acts only on a processing document of the '
  'app.current_clinic_id clinic that has no chunk set; the reason must be one of the closed codes; '
  'fails closed without tenant context or outside READ COMMITTED. Do not add a clinic-id argument, '
  'free-text reasons, other target statuses, or widen the EXECUTE grant.';

-- Same order as above: privileges first, then ownership.
REVOKE ALL ON FUNCTION mark_knowledge_document_failed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_knowledge_document_failed(uuid, text) TO app_user;
ALTER FUNCTION mark_knowledge_document_failed(uuid, text) OWNER TO knowledge_document_processor;

-- 7. ADR-0025 fail-closed check for the new role, same shape as 0019's.
-- Skipped only for a superuser, for which role inheritance and row level
-- security mean nothing (CI migrates as one; the non-superuser path is
-- covered by tests/db/migration-full-chain-non-superuser.test.ts and
-- tests/db/knowledge-document-chunks.test.ts).
DO $$
DECLARE
  direct_inheriting text[];
BEGIN
  IF (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RETURN;
  END IF;

  SELECT pg_catalog.array_agg(g.rolname::text ORDER BY g.rolname)
    INTO direct_inheriting
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles g ON g.oid = m.grantor
   WHERE m.member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
     AND m.roleid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'knowledge_document_processor')
     AND m.inherit_option;

  IF direct_inheriting IS NOT NULL THEN
    RAISE EXCEPTION
      '0020: role % inherits knowledge_document_processor through a membership granted by %; that grantor (or a superuser) must run: GRANT knowledge_document_processor TO % WITH INHERIT FALSE GRANTED BY <grantor>',
      current_user, direct_inheriting, current_user;
  END IF;

  IF pg_catalog.pg_has_role(current_user, 'knowledge_document_processor', 'USAGE') THEN
    RAISE EXCEPTION
      '0020: role % has inherited access to knowledge_document_processor through another role membership; remove that inheritance chain, then re-run migrations',
      current_user;
  END IF;

  IF NOT pg_catalog.pg_has_role(current_user, 'knowledge_document_processor', 'SET') THEN
    RAISE EXCEPTION '0020: role % cannot SET ROLE to knowledge_document_processor', current_user;
  END IF;
END
$$;
