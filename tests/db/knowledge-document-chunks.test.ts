import { afterAll, describe, expect, it } from 'vitest';
import { Client, type PoolClient } from 'pg';
import { closePool, withTenantContext, withoutTenantContext } from '@/lib/db';
import { getAppDatabaseUrl, getDatabaseUrl } from '@/lib/env';
import { createTestClinic, createTestKnowledgeDocument, createTestStaffMember } from '../fixtures';

/**
 * Database coverage for db/migrations/0020_knowledge_document_chunks.sql (ADR-0026, Accepted;
 * PR B decisions E1-E6). ADR-0026's Consequences list what must be proven against PostgreSQL:
 * RLS isolation of chunks; no chunk for another clinic's document; app_user has no direct write;
 * PUBLIC cannot execute either function; both fail without tenant context and outside READ
 * COMMITTED; every invalid chunk set is rejected; a chunk write and a failure serialize in both
 * lock orders, and a delayed failure after a committed chunk set is rejected; offsets are code
 * points; nothing partial survives an error; RLS holds inside the functions. Synthetic data only.
 */

const STORE = 'SELECT store_knowledge_document_chunks($1, $2, $3, $4, $5::text[]) AS n';
const FAIL = 'SELECT mark_knowledge_document_failed($1, $2)';
const EXTRACTOR = 'pdfjs-test-1';
const CANON = 'canon-test-1';

const NOT_PROCESSING_OR_CHUNKED = '55000';
const INVALID = '22023';
const NOT_FOUND = 'P0002';
const NO_CONTEXT = '42501';
const WRONG_ISOLATION = '25000';

interface ChunkRow {
  ordinal: number;
  content: string;
  char_start: number;
  char_end: number;
  extractor_version: string;
  canonicalization_version: string;
}

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const withAdmin = <T>(fn: (client: Client) => Promise<T>) => withClient(getDatabaseUrl(), fn);
const asAppUser = <T>(fn: (client: Client) => Promise<T>) => withClient(getAppDatabaseUrl(), fn);

async function newDocument(
  label: string,
  status: 'processing' | 'ready' | 'failed' = 'processing',
) {
  const clinic = await createTestClinic(label);
  const staff = await createTestStaffMember(clinic.id, `${label}Owner`, { role: 'owner' });
  const document = await createTestKnowledgeDocument(clinic.id, staff.id, { status });
  return { clinic, staff, document };
}

function store(
  client: PoolClient | Client,
  documentId: string,
  text: string,
  chunks: (string | null)[],
  versions: [string, string] = [EXTRACTOR, CANON],
) {
  return client.query<{ n: number }>(STORE, [documentId, versions[0], versions[1], text, chunks]);
}

async function chunksAsAdmin(documentId: string): Promise<ChunkRow[]> {
  return withAdmin(async (admin) => {
    const { rows } = await admin.query<ChunkRow>(
      `SELECT ordinal, content, char_start, char_end, extractor_version, canonicalization_version
         FROM knowledge_document_chunks WHERE document_id = $1 ORDER BY ordinal`,
      [documentId],
    );
    return rows;
  });
}

async function documentStateAsAdmin(documentId: string) {
  return withAdmin(async (admin) => {
    const { rows } = await admin.query<{ status: string; failed_reason: string | null }>(
      'SELECT status, failed_reason FROM knowledge_documents WHERE id = $1',
      [documentId],
    );
    return rows[0];
  });
}

/** Resolves with the SQLSTATE the promise rejected with; fails the test if it resolved. */
async function sqlstate(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    return (err as { code?: string }).code;
  }
  throw new Error('expected the query to fail, but it succeeded');
}

/** Waits until some backend is blocked on a lock, so a race test proves real serialization. */
async function waitForLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = await withAdmin(async (admin) => {
      const { rows } = await admin.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE '%knowledge_document%'`,
      );
      return Number(rows[0]!.n);
    });
    if (waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the second transaction never blocked on the document row lock');
}

async function beginWithContext(client: Client, clinicId: string, isolation?: string) {
  await client.query(isolation ? `BEGIN ISOLATION LEVEL ${isolation}` : 'BEGIN');
  await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicId]);
}

describe('knowledge_document_chunks and its write functions (db/migrations/0020, ADR-0026)', () => {
  afterAll(async () => {
    await closePool();
  });

  // ── structure ─────────────────────────────────────────────────────────────

  it('the table has RLS and FORCE RLS with the standard tenant_isolation policy', async () => {
    const { flags, policies } = await withAdmin(async (admin) => {
      const flags = await admin.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
          WHERE oid = 'public.knowledge_document_chunks'::regclass`,
      );
      const policies = await admin.query(
        `SELECT policyname, cmd, roles::text AS roles, qual, with_check FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'knowledge_document_chunks'`,
      );
      return { flags: flags.rows, policies: policies.rows };
    });
    expect(flags).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const expr = "(clinic_id = (current_setting('app.current_clinic_id'::text, true))::uuid)";
    expect(policies).toEqual([
      {
        policyname: 'tenant_isolation',
        cmd: 'ALL',
        roles: '{public}',
        qual: expr,
        with_check: expr,
      },
    ]);
  });

  it('app_user can only read chunks, and still cannot update or delete documents', async () => {
    const rows = await withAdmin(async (admin) => {
      const { rows } = await admin.query(
        `SELECT p AS privilege,
                has_table_privilege('app_user', 'public.knowledge_document_chunks', p) AS chunks,
                has_table_privilege('app_user', 'public.knowledge_documents', p) AS documents
           FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) AS p ORDER BY 1`,
      );
      return rows;
    });
    expect(rows).toEqual([
      { privilege: 'DELETE', chunks: false, documents: false },
      { privilege: 'INSERT', chunks: false, documents: true },
      { privilege: 'SELECT', chunks: true, documents: true },
      { privilege: 'TRUNCATE', chunks: false, documents: false },
      { privilege: 'UPDATE', chunks: false, documents: false },
    ]);
  });

  it('app_user direct writes are refused even with tenant context', async () => {
    const { clinic, document } = await newDocument('ChunksDirect');
    await withTenantContext(clinic.id, (client) => store(client, document.id, 'abc', ['abc']));

    for (const statement of [
      `INSERT INTO knowledge_document_chunks
         (clinic_id, document_id, ordinal, content, char_start, char_end, extractor_version, canonicalization_version)
       VALUES ($1, $2, 5, 'x', 3, 4, 'v', 'v')`,
      `UPDATE knowledge_document_chunks SET content = content WHERE clinic_id = $1 AND document_id = $2`,
      `DELETE FROM knowledge_document_chunks WHERE clinic_id = $1 AND document_id = $2`,
      `UPDATE knowledge_documents SET status = 'ready', ready_at = now() WHERE clinic_id = $1 AND id = $2`,
      `DELETE FROM knowledge_documents WHERE clinic_id = $1 AND id = $2`,
    ]) {
      const code = await sqlstate(
        withTenantContext(clinic.id, (client) => client.query(statement, [clinic.id, document.id])),
      );
      expect(code, statement).toBe('42501');
    }
    expect(await chunksAsAdmin(document.id)).toHaveLength(1);
  });

  it('the owner role is NOLOGIN, NOSUPERUSER, NOBYPASSRLS and holds exactly the combined column privileges', async () => {
    const result = await withAdmin(async (admin) => {
      const attrs = await admin.query(
        `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
           FROM pg_roles WHERE rolname = 'knowledge_document_processor'`,
      );
      const columns = await admin.query(
        `SELECT table_name, column_name, privilege_type FROM information_schema.column_privileges
          WHERE grantee = 'knowledge_document_processor' ORDER BY 1, 2, 3`,
      );
      const tables = await admin.query(
        `SELECT table_name, privilege_type FROM information_schema.table_privileges
          WHERE grantee = 'knowledge_document_processor' ORDER BY 1, 2`,
      );
      const members = await admin.query(
        `SELECT m.inherit_option, m.set_option, pg_get_userbyid(m.member) AS member
           FROM pg_auth_members m WHERE m.roleid = 'knowledge_document_processor'::regrole`,
      );
      const memberOf = await admin.query(
        `SELECT count(*)::int AS n FROM pg_auth_members
          WHERE member = 'knowledge_document_processor'::regrole`,
      );
      return {
        attrs: attrs.rows,
        columns: columns.rows,
        tables: tables.rows,
        members: members.rows,
        memberOf: memberOf.rows[0].n,
      };
    });

    expect(result.attrs).toEqual([
      {
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
      },
    ]);
    const priv = (table_name: string, column_name: string, privilege_type: string) => ({
      table_name,
      column_name,
      privilege_type,
    });
    expect(result.columns).toEqual([
      priv('knowledge_document_chunks', 'canonicalization_version', 'INSERT'),
      priv('knowledge_document_chunks', 'char_end', 'INSERT'),
      priv('knowledge_document_chunks', 'char_start', 'INSERT'),
      priv('knowledge_document_chunks', 'clinic_id', 'INSERT'),
      priv('knowledge_document_chunks', 'clinic_id', 'SELECT'),
      priv('knowledge_document_chunks', 'content', 'INSERT'),
      priv('knowledge_document_chunks', 'document_id', 'INSERT'),
      priv('knowledge_document_chunks', 'document_id', 'SELECT'),
      priv('knowledge_document_chunks', 'extractor_version', 'INSERT'),
      priv('knowledge_document_chunks', 'ordinal', 'INSERT'),
      priv('knowledge_documents', 'clinic_id', 'SELECT'),
      priv('knowledge_documents', 'failed_reason', 'UPDATE'),
      priv('knowledge_documents', 'id', 'SELECT'),
      priv('knowledge_documents', 'status', 'SELECT'),
      priv('knowledge_documents', 'status', 'UPDATE'),
    ]);
    // No table-wide privilege on any table.
    expect(result.tables).toEqual([]);
    // It is a member of nothing, and no membership in it carries INHERIT (ADR-0025).
    expect(result.memberOf).toBe(0);
    expect(result.members.length).toBeGreaterThan(0);
    for (const m of result.members) {
      expect(m.inherit_option, `membership of ${m.member}`).toBe(false);
      expect(m.member).not.toBe('app_user');
    }
  });

  it('both functions are SECURITY DEFINER plpgsql, owned by the role, pinned, and executable by app_user only', async () => {
    const rows = await withAdmin(async (admin) => {
      const { rows } = await admin.query(
        `SELECT p.oid::regprocedure::text AS signature,
                pg_get_userbyid(p.proowner) AS owner,
                p.prosecdef AS secdef,
                l.lanname AS lang,
                p.provolatile AS volatility,
                p.proconfig AS config,
                p.proacl::text AS acl,
                has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
           FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.proname IN ('store_knowledge_document_chunks', 'mark_knowledge_document_failed')
          ORDER BY 1`,
      );
      return rows;
    });
    const common = {
      owner: 'knowledge_document_processor',
      secdef: true,
      lang: 'plpgsql',
      volatility: 'v',
      config: ['search_path=pg_catalog, public, pg_temp'],
      acl: '{knowledge_document_processor=X/knowledge_document_processor,app_user=X/knowledge_document_processor}',
      public_execute: false,
    };
    expect(rows).toEqual([
      { signature: 'mark_knowledge_document_failed(uuid,text)', ...common },
      { signature: 'store_knowledge_document_chunks(uuid,text,text,text,text[])', ...common },
    ]);
  });

  // ── storing a chunk set ───────────────────────────────────────────────────

  it('stores a chunk set with code-point offsets derived in the database, readable only by its clinic', async () => {
    const { clinic, document } = await newDocument('ChunksStore');
    const other = await createTestClinic('ChunksStoreOther');
    // 𝄞 (U+1D11E) is outside the Basic Multilingual Plane: one code point, two UTF-16 units.
    const text = 'Opening hours 𝄞\n\nΩράριο λειτουργίας\n\nساعات العمل';
    const chunks = ['Opening hours 𝄞\n\n', 'Ωράριο λειτουργίας\n\n', 'ساعات العمل'];

    const result = await withTenantContext(clinic.id, (client) =>
      store(client, document.id, text, chunks),
    );
    expect(result.rows).toEqual([{ n: 3 }]);

    const codePoints = (s: string) => [...s].length;
    let start = 0;
    const expected = chunks.map((content, ordinal) => {
      const row = {
        ordinal,
        content,
        char_start: start,
        char_end: start + codePoints(content),
        extractor_version: EXTRACTOR,
        canonicalization_version: CANON,
      };
      start = row.char_end;
      return row;
    });
    const stored = await chunksAsAdmin(document.id);
    expect(stored).toEqual(expected);
    // 'Opening hours ' (14) + 𝄞 (1) + '\n\n' (2): 17 code points, although 18 UTF-16 units.
    expect(chunks[0]!.length).toBe(18);
    expect(stored[0]!.char_end).toBe(17);
    expect(stored.map((c) => c.content).join('')).toBe(text);
    expect(stored.at(-1)!.char_end).toBe(codePoints(text));

    // The same offset convention in PostgreSQL and in application code.
    const sliced = await withAdmin(async (admin) => {
      const { rows } = await admin.query<{ s: string }>(
        `SELECT substr($1, char_start + 1, char_end - char_start) AS s
           FROM knowledge_document_chunks WHERE document_id = $2 ORDER BY ordinal`,
        [text, document.id],
      );
      return rows.map((r) => r.s);
    });
    expect(sliced).toEqual(chunks);

    // Status is untouched: the document stays processing (D9).
    expect(await documentStateAsAdmin(document.id)).toEqual({
      status: 'processing',
      failed_reason: null,
    });

    const visibleToOwner = await withTenantContext(clinic.id, (client) =>
      client.query('SELECT count(*)::int AS n FROM knowledge_document_chunks'),
    );
    expect(visibleToOwner.rows[0].n).toBe(3);
    const visibleToOther = await withTenantContext(other.id, (client) =>
      client.query(
        'SELECT count(*)::int AS n FROM knowledge_document_chunks WHERE document_id = $1',
        [document.id],
      ),
    );
    expect(visibleToOther.rows[0].n).toBe(0);
    // A fresh app_user session that never set a tenant context sees nothing.
    const visibleWithoutContext = await asAppUser((client) =>
      client.query('SELECT count(*)::int AS n FROM knowledge_document_chunks'),
    );
    expect(visibleWithoutContext.rows[0].n).toBe(0);
  });

  it('accepts a chunk of exactly 2,000 code points and rejects one of 2,001', async () => {
    const ok = await newDocument('ChunksMaxOk');
    const max = '𝄞'.repeat(2000); // 2,000 code points, 4,000 UTF-16 units
    await withTenantContext(ok.clinic.id, (client) => store(client, ok.document.id, max, [max]));
    expect((await chunksAsAdmin(ok.document.id))[0]!.char_end).toBe(2000);

    const tooLong = await newDocument('ChunksMaxTooLong');
    const text = 'a'.repeat(2001);
    expect(
      await sqlstate(
        withTenantContext(tooLong.clinic.id, (client) =>
          store(client, tooLong.document.id, text, [text]),
        ),
      ),
    ).toBe(INVALID);
    expect(await chunksAsAdmin(tooLong.document.id)).toEqual([]);
  });

  it('rejects every invalid chunk set, storing nothing', async () => {
    const { clinic, document } = await newDocument('ChunksInvalid');
    const cases: {
      name: string;
      text: string;
      chunks: (string | null)[];
      versions?: [string, string];
    }[] = [
      { name: 'empty canonical text', text: '', chunks: ['a'] },
      { name: 'empty chunk set', text: 'abc', chunks: [] },
      { name: 'NULL chunk', text: 'abc', chunks: ['ab', null, 'c'] },
      { name: 'empty chunk', text: 'abc', chunks: ['abc', ''] },
      { name: 'gap: chunks stop before the end', text: 'abcdef', chunks: ['abc', 'de'] },
      { name: 'overlap: chunks run past the end', text: 'abcdef', chunks: ['abcd', 'cdef'] },
      { name: 'right lengths, wrong content', text: 'abcdef', chunks: ['abc', 'xyz'] },
      { name: 'reordered chunks', text: 'abcdef', chunks: ['def', 'abc'] },
      { name: 'not NFKC-normalised (ligature)', text: 'ﬁle', chunks: ['ﬁle'] },
      { name: 'not NFKC-normalised (Arabic presentation form)', text: 'ﻼ', chunks: ['ﻼ'] },
      { name: 'empty extractor version', text: 'abc', chunks: ['abc'], versions: [' ', CANON] },
      {
        name: 'over-long canonicalization version',
        text: 'abc',
        chunks: ['abc'],
        versions: [EXTRACTOR, 'v'.repeat(101)],
      },
    ];
    for (const c of cases) {
      const code = await sqlstate(
        withTenantContext(clinic.id, (client) =>
          store(client, document.id, c.text, c.chunks, c.versions),
        ),
      );
      expect(code, c.name).toBe(INVALID);
    }

    const twoDimensional = await sqlstate(
      withTenantContext(clinic.id, (client) =>
        client.query(STORE, [document.id, EXTRACTOR, CANON, 'abcd', '{{ab,cd}}']),
      ),
    );
    expect(twoDimensional).toBe(INVALID);

    expect(await chunksAsAdmin(document.id)).toEqual([]);
    expect(await documentStateAsAdmin(document.id)).toEqual({
      status: 'processing',
      failed_reason: null,
    });
  });

  it('refuses a document that is not processing, or already has a chunk set', async () => {
    for (const status of ['ready', 'failed'] as const) {
      const { clinic, document } = await newDocument(`ChunksNotProcessing${status}`, status);
      expect(
        await sqlstate(
          withTenantContext(clinic.id, (client) => store(client, document.id, 'abc', ['abc'])),
        ),
        status,
      ).toBe(NOT_PROCESSING_OR_CHUNKED);
      expect(await chunksAsAdmin(document.id)).toEqual([]);
    }

    const { clinic, document } = await newDocument('ChunksTwice');
    await withTenantContext(clinic.id, (client) => store(client, document.id, 'first', ['first']));
    expect(
      await sqlstate(
        withTenantContext(clinic.id, (client) => store(client, document.id, 'second', ['second'])),
      ),
    ).toBe(NOT_PROCESSING_OR_CHUNKED);
    expect((await chunksAsAdmin(document.id)).map((c) => c.content)).toEqual(['first']);
  });

  it('cannot store chunks for another clinic’s document (RLS inside the function)', async () => {
    const a = await newDocument('ChunksClinicA');
    const b = await newDocument('ChunksClinicB');
    expect(
      await sqlstate(
        withTenantContext(a.clinic.id, (client) => store(client, b.document.id, 'abc', ['abc'])),
      ),
    ).toBe(NOT_FOUND);
    expect(await chunksAsAdmin(b.document.id)).toEqual([]);
  });

  it('nothing partial survives an error raised while the set is being inserted', async () => {
    const { clinic, document } = await newDocument('ChunksAtomic');
    // A test-only trigger that fails on the third row of this one document's insert, after
    // the first two rows of the same statement were written.
    const trigger = `test_chunks_fail_${document.id.replace(/-/g, '_')}`;
    await withAdmin(async (admin) => {
      await admin.query(
        `CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           IF NEW.document_id = '${document.id}' AND NEW.ordinal = 2 THEN
             RAISE EXCEPTION 'test-only failure on the third chunk';
           END IF;
           RETURN NEW;
         END $$`,
      );
      await admin.query(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON knowledge_document_chunks
           FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`,
      );
    });
    try {
      await expect(
        withTenantContext(clinic.id, (client) =>
          store(client, document.id, 'abcdef', ['ab', 'cd', 'ef']),
        ),
      ).rejects.toThrow('test-only failure on the third chunk');
    } finally {
      await withAdmin(async (admin) => {
        await admin.query(`DROP TRIGGER ${trigger} ON knowledge_document_chunks`);
        await admin.query(`DROP FUNCTION public.${trigger}()`);
      });
    }
    expect(await chunksAsAdmin(document.id)).toEqual([]);

    // The document is still usable afterwards.
    await withTenantContext(clinic.id, (client) =>
      store(client, document.id, 'abcdef', ['ab', 'cd', 'ef']),
    );
    expect(await chunksAsAdmin(document.id)).toHaveLength(3);
  });

  // ── marking a document failed ─────────────────────────────────────────────

  it('marks a processing document failed with a closed reason code, and nothing else', async () => {
    const { clinic, document } = await newDocument('FailOk');
    const other = await newDocument('FailOkOther');
    await withTenantContext(clinic.id, (client) => client.query(FAIL, [document.id, 'encrypted']));
    expect(await documentStateAsAdmin(document.id)).toEqual({
      status: 'failed',
      failed_reason: 'encrypted',
    });
    expect(await documentStateAsAdmin(other.document.id)).toEqual({
      status: 'processing',
      failed_reason: null,
    });

    // Forward-only: it is no longer processing.
    expect(
      await sqlstate(
        withTenantContext(clinic.id, (client) => client.query(FAIL, [document.id, 'too_large'])),
      ),
    ).toBe(NOT_PROCESSING_OR_CHUNKED);
    expect(await documentStateAsAdmin(document.id)).toEqual({
      status: 'failed',
      failed_reason: 'encrypted',
    });
  });

  it('accepts every reason code of ADR-0026 and rejects anything else', async () => {
    const reasons = [
      'too_large',
      'too_many_pages',
      'too_much_text',
      'extraction_timeout',
      'extraction_error',
      'no_extractable_text',
      'encrypted',
      'object_missing',
      'object_changed',
      'not_a_pdf',
    ];
    const clinic = await createTestClinic('FailReasons');
    const staff = await createTestStaffMember(clinic.id, 'FailReasonsOwner', { role: 'owner' });
    for (const reason of reasons) {
      const doc = await createTestKnowledgeDocument(clinic.id, staff.id);
      await withTenantContext(clinic.id, (client) => client.query(FAIL, [doc.id, reason]));
      expect(await documentStateAsAdmin(doc.id)).toEqual({
        status: 'failed',
        failed_reason: reason,
      });
    }

    const doc = await createTestKnowledgeDocument(clinic.id, staff.id);
    for (const reason of ['', 'TOO_LARGE', 'Error: ENOENT /tmp/file.pdf', 'ready', null]) {
      expect(
        await sqlstate(
          withTenantContext(clinic.id, (client) => client.query(FAIL, [doc.id, reason])),
        ),
        String(reason),
      ).toBe(INVALID);
    }
    expect(await documentStateAsAdmin(doc.id)).toEqual({
      status: 'processing',
      failed_reason: null,
    });
  });

  it('a delayed failure after a committed chunk set is rejected', async () => {
    const { clinic, document } = await newDocument('FailAfterChunks');
    await withTenantContext(clinic.id, (client) => store(client, document.id, 'abc', ['abc']));
    expect(
      await sqlstate(
        withTenantContext(clinic.id, (client) =>
          client.query(FAIL, [document.id, 'extraction_timeout']),
        ),
      ),
    ).toBe(NOT_PROCESSING_OR_CHUNKED);
    expect(await documentStateAsAdmin(document.id)).toEqual({
      status: 'processing',
      failed_reason: null,
    });
    expect(await chunksAsAdmin(document.id)).toHaveLength(1);
  });

  it('cannot fail another clinic’s document (RLS inside the function)', async () => {
    const a = await newDocument('FailClinicA');
    const b = await newDocument('FailClinicB');
    expect(
      await sqlstate(
        withTenantContext(a.clinic.id, (client) =>
          client.query(FAIL, [b.document.id, 'too_large']),
        ),
      ),
    ).toBe(NOT_FOUND);
    expect(await documentStateAsAdmin(b.document.id)).toEqual({
      status: 'processing',
      failed_reason: null,
    });
  });

  // ── fail-closed conditions, both functions ────────────────────────────────

  it('both functions fail closed with no tenant context, or an empty one', async () => {
    const { document } = await newDocument('NoContext');
    for (const call of [
      (c: PoolClient | Client) => store(c, document.id, 'abc', ['abc']),
      (c: PoolClient | Client) => c.query(FAIL, [document.id, 'too_large']),
    ]) {
      expect(await sqlstate(withoutTenantContext((client) => call(client)))).toBe(NO_CONTEXT);
      const empty = await asAppUser(async (client) => {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_clinic_id', '', true)");
        try {
          return await sqlstate(call(client));
        } finally {
          await client.query('ROLLBACK');
        }
      });
      expect(empty).toBe(NO_CONTEXT);
    }
    expect(await chunksAsAdmin(document.id)).toEqual([]);
    expect(await documentStateAsAdmin(document.id)).toEqual({
      status: 'processing',
      failed_reason: null,
    });
  });

  it('both functions refuse to run outside READ COMMITTED', async () => {
    const { clinic, document } = await newDocument('Isolation');
    for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
      for (const call of [
        (c: Client) => store(c, document.id, 'abc', ['abc']),
        (c: Client) => c.query(FAIL, [document.id, 'too_large']),
      ]) {
        const code = await asAppUser(async (client) => {
          await beginWithContext(client, clinic.id, isolation);
          try {
            return await sqlstate(call(client));
          } finally {
            await client.query('ROLLBACK');
          }
        });
        expect(code, isolation).toBe(WRONG_ISOLATION);
      }
    }
    expect(await chunksAsAdmin(document.id)).toEqual([]);
    expect(await documentStateAsAdmin(document.id)).toEqual({
      status: 'processing',
      failed_reason: null,
    });
  });

  it('PUBLIC cannot execute either function: a role without the grant is refused', async () => {
    const outcome = await withAdmin(async (admin) => {
      await admin.query('BEGIN');
      try {
        await admin.query('CREATE ROLE test_kdp_no_grant NOLOGIN');
        await admin.query('SET LOCAL ROLE test_kdp_no_grant');
        const results: (string | undefined)[] = [];
        for (const sql of [
          `SELECT store_knowledge_document_chunks(gen_random_uuid(), 'v', 'v', 'a', ARRAY['a'])`,
          `SELECT mark_knowledge_document_failed(gen_random_uuid(), 'too_large')`,
        ]) {
          await admin.query('SAVEPOINT s');
          results.push(await sqlstate(admin.query(sql)));
          await admin.query('ROLLBACK TO SAVEPOINT s');
        }
        return results;
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    expect(outcome).toEqual(['42501', '42501']);
  });

  // ── serialization: both lock orders ───────────────────────────────────────

  it('a chunk write that locks first wins; the failure waiting on it is rejected', async () => {
    const { clinic, document } = await newDocument('RaceStoreFirst');
    const first = new Client({ connectionString: getAppDatabaseUrl() });
    const second = new Client({ connectionString: getAppDatabaseUrl() });
    await first.connect();
    await second.connect();
    try {
      await beginWithContext(first, clinic.id);
      await store(first, document.id, 'abc', ['abc']);

      await beginWithContext(second, clinic.id);
      const failing = sqlstate(second.query(FAIL, [document.id, 'extraction_timeout']));
      await waitForLockWait();
      await first.query('COMMIT');

      expect(await failing).toBe(NOT_PROCESSING_OR_CHUNKED);
      await second.query('ROLLBACK');
    } finally {
      await first.end();
      await second.end();
    }
    expect(await documentStateAsAdmin(document.id)).toEqual({
      status: 'processing',
      failed_reason: null,
    });
    expect(await chunksAsAdmin(document.id)).toHaveLength(1);
  });

  it('a failure that locks first wins; the chunk write waiting on it is rejected', async () => {
    const { clinic, document } = await newDocument('RaceFailFirst');
    const first = new Client({ connectionString: getAppDatabaseUrl() });
    const second = new Client({ connectionString: getAppDatabaseUrl() });
    await first.connect();
    await second.connect();
    try {
      await beginWithContext(first, clinic.id);
      await first.query(FAIL, [document.id, 'extraction_timeout']);

      await beginWithContext(second, clinic.id);
      const storing = sqlstate(store(second, document.id, 'abc', ['abc']));
      await waitForLockWait();
      await first.query('COMMIT');

      expect(await storing).toBe(NOT_PROCESSING_OR_CHUNKED);
      await second.query('ROLLBACK');
    } finally {
      await first.end();
      await second.end();
    }
    expect(await documentStateAsAdmin(document.id)).toEqual({
      status: 'failed',
      failed_reason: 'extraction_timeout',
    });
    expect(await chunksAsAdmin(document.id)).toEqual([]);
  });

  it('two chunk writes racing on one document leave exactly one set', async () => {
    const { clinic, document } = await newDocument('RaceStoreTwice');
    const first = new Client({ connectionString: getAppDatabaseUrl() });
    const second = new Client({ connectionString: getAppDatabaseUrl() });
    await first.connect();
    await second.connect();
    try {
      await beginWithContext(first, clinic.id);
      await store(first, document.id, 'first', ['first']);

      await beginWithContext(second, clinic.id);
      const storing = sqlstate(store(second, document.id, 'second', ['second']));
      await waitForLockWait();
      await first.query('COMMIT');

      expect(await storing).toBe(NOT_PROCESSING_OR_CHUNKED);
      await second.query('ROLLBACK');
    } finally {
      await first.end();
      await second.end();
    }
    expect((await chunksAsAdmin(document.id)).map((c) => c.content)).toEqual(['first']);
  });

  // ── RLS under the owner role, and search_path hardening (ADR-0024) ────────

  it('RLS applies to the owner role itself: under one clinic’s context it sees only that clinic', async () => {
    const a = await newDocument('OwnerRlsA');
    const b = await newDocument('OwnerRlsB');
    const seen = await withAdmin(async (admin) => {
      await admin.query('BEGIN');
      try {
        await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [a.clinic.id]);
        await admin.query('SET LOCAL ROLE knowledge_document_processor');
        const { rows } = await admin.query<{ id: string }>(
          'SELECT id FROM knowledge_documents WHERE id = ANY($1)',
          [[a.document.id, b.document.id]],
        );
        return rows.map((r) => r.id);
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    expect(seen).toEqual([a.document.id]);
  });

  it('temporary tables cannot shadow the tables either function uses', async () => {
    const { clinic, document } = await newDocument('ShadowStore');
    const failDoc = await newDocument('ShadowFail');
    await asAppUser(async (client) => {
      await client.query(
        `CREATE TEMP TABLE knowledge_documents (id uuid, clinic_id uuid, status text, failed_reason text)`,
      );
      await client.query(
        `CREATE TEMP TABLE knowledge_document_chunks
           (document_id uuid, clinic_id uuid, ordinal integer, content text, char_start integer,
            char_end integer, extractor_version text, canonicalization_version text)`,
      );
      // Shadow rows claim the real documents are already failed and already chunked.
      await client.query(
        `INSERT INTO pg_temp.knowledge_documents VALUES ($1, $2, 'failed', 'x'), ($3, $4, 'failed', 'x')`,
        [document.id, clinic.id, failDoc.document.id, failDoc.clinic.id],
      );
      await client.query(
        `INSERT INTO pg_temp.knowledge_document_chunks VALUES ($1, $2, 0, 'x', 0, 1, 'v', 'v')`,
        [failDoc.document.id, failDoc.clinic.id],
      );
      await client.query(
        'GRANT ALL ON pg_temp.knowledge_documents, pg_temp.knowledge_document_chunks TO knowledge_document_processor',
      );

      await beginWithContext(client, clinic.id);
      await store(client, document.id, 'abc', ['abc']);
      await client.query('COMMIT');

      await beginWithContext(client, failDoc.clinic.id);
      await client.query(FAIL, [failDoc.document.id, 'too_large']);
      await client.query('COMMIT');

      const shadowChunks = await client.query(
        'SELECT count(*)::int AS n FROM pg_temp.knowledge_document_chunks WHERE document_id = $1',
        [document.id],
      );
      expect(shadowChunks.rows[0].n).toBe(0);
    });
    expect(await chunksAsAdmin(document.id)).toHaveLength(1);
    expect(await documentStateAsAdmin(failDoc.document.id)).toEqual({
      status: 'failed',
      failed_reason: 'too_large',
    });
  });

  // ── table-level constraints ───────────────────────────────────────────────

  it('the table itself rejects a cross-clinic chunk and rows breaking the row checks', async () => {
    const a = await newDocument('TableChecksA');
    const b = await newDocument('TableChecksB');
    const insert = (
      clinicId: string,
      documentId: string,
      content: string,
      start: number,
      end: number,
    ) =>
      withAdmin(async (admin) => {
        await admin.query('BEGIN');
        try {
          await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicId]);
          await admin.query(
            `INSERT INTO knowledge_document_chunks
               (clinic_id, document_id, ordinal, content, char_start, char_end, extractor_version, canonicalization_version)
             VALUES ($1, $2, 0, $3, $4, $5, 'v', 'v')`,
            [clinicId, documentId, content, start, end],
          );
        } finally {
          await admin.query('ROLLBACK');
        }
      });

    expect(await sqlstate(insert(b.clinic.id, a.document.id, 'abc', 0, 3))).toBe('23503');
    expect(await sqlstate(insert(a.clinic.id, a.document.id, 'abc', 0, 4))).toBe('23514');
    expect(await sqlstate(insert(a.clinic.id, a.document.id, 'abc', 3, 3))).toBe('23514');
    expect(await sqlstate(insert(a.clinic.id, a.document.id, 'a'.repeat(2001), 0, 2001))).toBe(
      '23514',
    );
    expect(await sqlstate(insert(a.clinic.id, a.document.id, 'abc', -1, 2))).toBe('23514');
  });

  it('deleting a document deletes its chunks', async () => {
    const { clinic, document } = await newDocument('Cascade');
    await withTenantContext(clinic.id, (client) => store(client, document.id, 'abc', ['abc']));
    await withAdmin(async (admin) => {
      await admin.query('BEGIN');
      await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinic.id]);
      await admin.query('DELETE FROM knowledge_documents WHERE id = $1', [document.id]);
      await admin.query('COMMIT');
    });
    expect(await chunksAsAdmin(document.id)).toEqual([]);
  });
});
