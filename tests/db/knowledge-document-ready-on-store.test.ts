import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { closePool } from '@/lib/db';
import { getAppDatabaseUrl, getDatabaseUrl } from '@/lib/env';
import { createTestClinic, createTestKnowledgeDocument, createTestStaffMember } from '../fixtures';

/**
 * Migration 0021 (ADR-0030 decision 3): storing a document's chunk set makes it `ready` in the same
 * call, and the migration moves documents that already had a chunk set to `ready`.
 *
 * The status change is covered end to end in knowledge-document-chunks.test.ts (the store function,
 * both race orders and the owner role's exact column privileges). This file proves the two things
 * those tests cannot: that the chunk set and the status change roll back together, and that the
 * backfill works under FORCE RLS for a genuinely non-superuser, non-BYPASSRLS migrating role
 * (production's shape; CI otherwise migrates as a superuser, for which RLS never applies).
 * Synthetic data only.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8') }));
const MIGRATION_0021 = '0021_knowledge_document_ready_on_store.sql';

const STORE = 'SELECT store_knowledge_document_chunks($1, $2, $3, $4, $5::text[]) AS n';

function withDatabaseName(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function withCredentials(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

/** The cluster-wide roles the migrations manage, swapped for per-test names (as in the chain test). */
interface Scratch {
  owner: string;
  password: string;
  database: string;
  roles: Record<string, string>;
}

function substituted(sql: string, scratch: Scratch): string {
  let out = sql;
  for (const [name, replacement] of Object.entries(scratch.roles)) {
    out = out.replaceAll(name, replacement);
  }
  return out;
}

async function createScratch(admin: Client): Promise<Scratch> {
  const suffix = randomUUID().replace(/-/g, '_');
  const scratch: Scratch = {
    owner: `test_owner_${suffix}`,
    password: `pw_${suffix}`,
    database: `test_db_${suffix}`,
    // Short names: role names truncate at 63 bytes.
    roles: {
      app_user: `test_app_user_${suffix}`,
      auth_bootstrap: `test_auth_bootstrap_${suffix}`,
      clinic_settings_writer: `test_csw_${suffix}`,
      invitation_acceptor: `test_ia_${suffix}`,
      knowledge_document_processor: `test_kdp_${suffix}`,
    },
  };
  await admin.query(
    `CREATE ROLE ${scratch.owner} LOGIN PASSWORD '${scratch.password}' NOSUPERUSER NOBYPASSRLS CREATEROLE`,
  );
  await admin.query(`CREATE DATABASE ${scratch.database} OWNER ${scratch.owner}`);
  const scratchAdmin = new Client({
    connectionString: withDatabaseName(getDatabaseUrl(), scratch.database),
  });
  await scratchAdmin.connect();
  await scratchAdmin.query(`ALTER SCHEMA public OWNER TO ${scratch.owner}`);
  await scratchAdmin.end();
  return scratch;
}

async function dropScratch(admin: Client, scratch: Scratch): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${scratch.database} WITH (FORCE)`);
  await admin.query(`DROP ROLE IF EXISTS ${scratch.owner}`);
  for (const role of Object.values(scratch.roles)) {
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
  }
}

describe('migration 0021: ready on store (ADR-0030)', () => {
  let admin: Client | undefined;
  let scratch: Scratch | undefined;

  afterEach(async () => {
    if (admin && scratch) await dropScratch(admin, scratch);
    scratch = undefined;
    await admin?.end();
    admin = undefined;
  });

  afterAll(async () => {
    await closePool();
  });

  it('rolls the chunk set and the ready status back together', async () => {
    const clinic = await createTestClinic('ReadyRollback');
    const staff = await createTestStaffMember(clinic.id, 'ReadyRollbackOwner', { role: 'owner' });
    const document = await createTestKnowledgeDocument(clinic.id, staff.id);

    const app = new Client({ connectionString: getAppDatabaseUrl() });
    await app.connect();
    try {
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinic.id]);
      const stored = await app.query(STORE, [document.id, 'test', 'test', 'abc', ['abc']]);
      expect(stored.rows).toEqual([{ n: 1 }]);
      // Inside the transaction the document is already ready...
      const inside = await app.query<{ status: string }>(
        'SELECT status FROM knowledge_documents WHERE id = $1',
        [document.id],
      );
      expect(inside.rows).toEqual([{ status: 'ready' }]);
      await app.query('ROLLBACK');
    } finally {
      await app.end();
    }

    // ...and after the rollback neither the chunks nor the status change survive.
    const db = new Client({ connectionString: getDatabaseUrl() });
    await db.connect();
    try {
      const state = await db.query(
        `SELECT d.status, d.ready_at,
                (SELECT count(*)::int FROM knowledge_document_chunks c WHERE c.document_id = d.id) AS chunks
           FROM knowledge_documents d WHERE d.id = $1`,
        [document.id],
      );
      expect(state.rows).toEqual([{ status: 'processing', ready_at: null, chunks: 0 }]);
    } finally {
      await db.end();
    }
  });

  it('backfills only documents with a chunk set, per clinic, as a non-superuser owner under FORCE RLS', async () => {
    admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    scratch = await createScratch(admin);
    const s = scratch;

    const owner = new Client({
      connectionString: withCredentials(
        withDatabaseName(getDatabaseUrl(), s.database),
        s.owner,
        s.password,
      ),
    });
    const scratchAdmin = new Client({
      connectionString: withDatabaseName(getDatabaseUrl(), s.database),
    });
    await owner.connect();
    await scratchAdmin.connect();
    try {
      // Everything before 0021, as the non-superuser owner.
      for (const { file, sql } of MIGRATION_FILES) {
        if (file >= MIGRATION_0021) break;
        await owner.query(substituted(sql, s));
      }

      // The pre-0021 state, written by the scratch superuser: in two clinics, documents that are
      // processing with a chunk set, processing without one, and already failed.
      const clinicA = randomUUID();
      const clinicB = randomUUID();
      const doc = {
        aChunked: randomUUID(),
        aUnchunked: randomUUID(),
        aFailed: randomUUID(),
        bChunked: randomUUID(),
      };
      for (const [clinic, label] of [
        [clinicA, 'A'],
        [clinicB, 'B'],
      ] as const) {
        await scratchAdmin.query(
          `INSERT INTO clinics (id, name, owner_email, contact_email, timezone)
           VALUES ($1, $2, $3, $3, 'Europe/Athens')`,
          [clinic, `Synthetic clinic ${label}`, `owner-${label.toLowerCase()}@example.test`],
        );
      }
      const staffA = randomUUID();
      const staffB = randomUUID();
      for (const [staff, clinic] of [
        [staffA, clinicA],
        [staffB, clinicB],
      ] as const) {
        await scratchAdmin.query(
          `INSERT INTO staff_members (id, clinic_id, email, password_hash, role, status)
           VALUES ($1, $2, $3, 'not-a-real-hash', 'owner', 'active')`,
          [staff, clinic, `${staff}@example.test`],
        );
      }
      const insertDocument = (id: string, clinic: string, staff: string, failed = false) =>
        scratchAdmin.query(
          `INSERT INTO knowledge_documents
             (id, clinic_id, uploaded_by, filename, mime_type, size_bytes, storage_key, status, failed_reason)
           VALUES ($1, $2, $3, 'synthetic.pdf', 'application/pdf', 1024, $4, $5, $6)`,
          [
            id,
            clinic,
            staff,
            `${clinic}/${id}`,
            failed ? 'failed' : 'processing',
            failed ? 'encrypted' : null,
          ],
        );
      await insertDocument(doc.aChunked, clinicA, staffA);
      await insertDocument(doc.aUnchunked, clinicA, staffA);
      await insertDocument(doc.aFailed, clinicA, staffA, true);
      await insertDocument(doc.bChunked, clinicB, staffB);
      for (const [id, clinic] of [
        [doc.aChunked, clinicA],
        [doc.bChunked, clinicB],
      ] as const) {
        await scratchAdmin.query(
          `INSERT INTO knowledge_document_chunks
             (clinic_id, document_id, ordinal, content, char_start, char_end, extractor_version, canonicalization_version)
           VALUES ($1, $2, 0, 'abc', 0, 3, 'test', 'test')`,
          [clinic, id],
        );
      }

      // 0021 itself, as the non-superuser owner, with no tenant context set.
      const result = await owner.query(substituted(MIGRATION_FILES.at(-1)!.sql, s));
      expect(MIGRATION_FILES.at(-1)!.file).toBe(MIGRATION_0021);
      expect(result).toBeDefined();
      // The per-clinic context the backfill set was transaction-local and is gone.
      const context = await owner.query<{ c: string | null }>(
        "SELECT current_setting('app.current_clinic_id', true) AS c",
      );
      expect(context.rows[0]!.c ?? '').toBe('');

      const { rows } = await scratchAdmin.query<{
        id: string;
        status: string;
        has_ready_at: boolean;
        failed_reason: string | null;
      }>(
        `SELECT id, status, ready_at IS NOT NULL AS has_ready_at, failed_reason
           FROM knowledge_documents WHERE id = ANY($1)`,
        [Object.values(doc)],
      );
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[doc.aChunked]).toMatchObject({ status: 'ready', has_ready_at: true });
      expect(byId[doc.bChunked]).toMatchObject({ status: 'ready', has_ready_at: true });
      expect(byId[doc.aUnchunked]).toMatchObject({ status: 'processing', has_ready_at: false });
      expect(byId[doc.aFailed]).toMatchObject({
        status: 'failed',
        has_ready_at: false,
        failed_reason: 'encrypted',
      });

      // The owner role gained exactly UPDATE (ready_at) on knowledge_documents.
      const kdp = s.roles.knowledge_document_processor!;
      const privileges = await scratchAdmin.query<{ column_name: string; privilege_type: string }>(
        `SELECT column_name, privilege_type FROM information_schema.column_privileges
          WHERE grantee = $1 AND table_name = 'knowledge_documents'
          ORDER BY column_name, privilege_type`,
        [kdp],
      );
      expect(privileges.rows).toEqual([
        { column_name: 'clinic_id', privilege_type: 'SELECT' },
        { column_name: 'failed_reason', privilege_type: 'UPDATE' },
        { column_name: 'id', privilege_type: 'SELECT' },
        { column_name: 'ready_at', privilege_type: 'UPDATE' },
        { column_name: 'status', privilege_type: 'SELECT' },
        { column_name: 'status', privilege_type: 'UPDATE' },
      ]);
    } finally {
      await owner.end();
      await scratchAdmin.end();
    }
  });

  it('refuses to run if the function would lose its owner (post-check fails closed)', async () => {
    // The post-check is what stops a replacement that ran as the wrong role from being committed.
    // Removing the ADR-0025 role switch makes CREATE OR REPLACE fail outright for a non-superuser
    // ("must be owner of function"), which the chain test covers; here the check itself is proven
    // by running it against a function whose owner was moved away first.
    admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    const sql = MIGRATION_FILES.find((m) => m.file === MIGRATION_0021)!.sql;
    const postCheck = sql.slice(
      sql.indexOf('-- Fail closed if the replacement moved anything'),
      sql.indexOf('-- 3. Backfill'),
    );
    expect(postCheck).toContain('RAISE EXCEPTION');

    await admin.query('BEGIN');
    try {
      await admin.query(
        'ALTER FUNCTION store_knowledge_document_chunks(uuid, text, text, text, text[]) OWNER TO CURRENT_USER',
      );
      await expect(admin.query(postCheck)).rejects.toThrow(/lost its owner/);
    } finally {
      await admin.query('ROLLBACK');
    }
  });
});
