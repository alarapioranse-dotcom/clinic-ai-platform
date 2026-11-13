-- 0021 — a document becomes `ready` when its chunk set is stored (ADR-0030,
-- Accepted 2026-11-13 by the Owner's comment on #135, decision 3).
--
-- What this migration does, and nothing else:
--   1. Grants knowledge_document_processor column UPDATE (ready_at) on
--      knowledge_documents. The knowledge_document_status_fields_match check
--      (0013) requires ready_at exactly when status = 'ready'.
--   2. Replaces store_knowledge_document_chunks so that, in the same call that
--      inserts the complete chunk set and under the same row lock, it sets
--      status = 'ready' and ready_at = now(). Every other line of the function
--      is unchanged from 0020 (ADR-0026 section 7). The replacement runs as the
--      function's owner for those statements only and then restores the exact
--      role that was executing, as ADR-0025 requires; CREATE OR REPLACE keeps
--      the owner, the EXECUTE grants, SECURITY DEFINER and the pinned
--      search_path, and the post-check below fails closed if any of them moved.
--   3. Moves every document that already has a chunk set and is still
--      `processing` to `ready`. knowledge_documents has FORCE RLS and clinics
--      has none, so this runs once per clinic under that clinic's tenant
--      context, then clears the context. Production held no documents when
--      last checked (2026-10-26), so there it is expected to change no row.
--
-- mark_knowledge_document_failed is not touched: it still acts only on a
-- `processing` document with no chunk set, so a ready document can never be
-- marked failed.

-- 1. The one new column privilege. Granted by the table owner (the migrating
-- role), before the function that uses it is replaced.
GRANT UPDATE (ready_at) ON knowledge_documents TO knowledge_document_processor;

-- 2. Replace the store function as its owner (ADR-0025 convention).
SELECT pg_catalog.set_config('migration.previous_role', current_user, true);
SET LOCAL ROLE knowledge_document_processor;

-- Errors (standard SQLSTATEs, unchanged from 0020):
--   25000 invalid_transaction_state  not READ COMMITTED
--   42501 insufficient_privilege     no tenant context
--   22023 invalid_parameter_value    invalid arguments or chunk set
--   P0002 no_data_found              no such document in the context clinic
--   55000 object_not_in_prerequisite_state
--                                    document not processing, or chunks exist
CREATE OR REPLACE FUNCTION store_knowledge_document_chunks(
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

  -- ADR-0030 decision 3: the document is searchable now, so it is ready. Same
  -- transaction and same row lock as the insert above: the chunk set and the
  -- status change commit or roll back together.
  UPDATE public.knowledge_documents
     SET status = 'ready', ready_at = pg_catalog.now()
   WHERE id = p_document_id AND clinic_id = v_clinic_id;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION store_knowledge_document_chunks(uuid, text, text, text, text[]) IS
  'ADR-0026, ADR-0030. The only write path for knowledge_document_chunks. Stores one complete chunk '
  'set for a processing document of the app.current_clinic_id clinic, deriving offsets itself, and '
  'in the same call moves the document to ready; fails closed without tenant context or outside '
  'READ COMMITTED. Do not add a clinic-id argument, accept caller-supplied offsets, or widen the '
  'EXECUTE grant.';

DO $restore$
BEGIN
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I',
    pg_catalog.current_setting('migration.previous_role'));
END
$restore$;

-- Fail closed if the replacement moved anything ADR-0026, ADR-0024 or
-- ADR-0025 depend on.
DO $$
DECLARE
  f record;
BEGIN
  SELECT p.prosecdef,
         pg_catalog.pg_get_userbyid(p.proowner) AS owner,
         p.proconfig,
         pg_catalog.has_function_privilege('app_user', p.oid, 'EXECUTE') AS app_user_exec,
         EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
         ) AS public_exec
    INTO f
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.store_knowledge_document_chunks(uuid, text, text, text, text[])'::pg_catalog.regprocedure;

  IF NOT f.prosecdef
     OR f.owner <> 'knowledge_document_processor'
     OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']
     OR NOT f.app_user_exec
     OR f.public_exec THEN
    RAISE EXCEPTION
      '0021: store_knowledge_document_chunks lost its owner, SECURITY DEFINER, search_path or grants';
  END IF;
END
$$;

-- 3. Backfill: documents that already have a chunk set become ready. One
-- clinic at a time under its own tenant context, because FORCE RLS applies to
-- the table owner too; the context is cleared afterwards.
DO $$
DECLARE
  v_clinic uuid;
BEGIN
  FOR v_clinic IN SELECT c.id FROM public.clinics c ORDER BY c.id LOOP
    PERFORM pg_catalog.set_config('app.current_clinic_id', v_clinic::text, true);
    UPDATE public.knowledge_documents d
       SET status = 'ready', ready_at = pg_catalog.now()
     WHERE d.clinic_id = v_clinic
       AND d.status = 'processing'
       AND EXISTS (
         SELECT 1 FROM public.knowledge_document_chunks k
          WHERE k.document_id = d.id AND k.clinic_id = d.clinic_id
       );
  END LOOP;
  PERFORM pg_catalog.set_config('app.current_clinic_id', '', true);
END
$$;
