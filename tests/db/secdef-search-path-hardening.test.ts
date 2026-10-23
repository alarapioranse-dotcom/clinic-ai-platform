import { describe, it, expect, afterAll } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

import { closePool } from '@/lib/db';
import { getAppDatabaseUrl, getDatabaseUrl } from '@/lib/env';
import { createTestClinic, createTestStaffMember } from '../fixtures';
import { hashPassword } from '@/features/auth/password';

/**
 * Database coverage for db/migrations/0018_secdef_search_path_hardening.sql.
 *
 * Decision record: docs/adr/0024-security-definer-search-path-and-name-qualification.md.
 *
 * The four SECURITY DEFINER functions (0007 auth lookups, 0015 clinic
 * settings, 0016 accept_invitation) pinned `search_path = public, pg_catalog`:
 *   - pg_temp was not listed, so PostgreSQL searched it FIRST for relations
 *     and data types, and an app_user temp table or type could shadow an
 *     unqualified name;
 *   - public came before pg_catalog, and the owner roles hold CREATE on
 *     public, so an object in public could shadow a built-in function,
 *     operator or type.
 * 0018 pins `pg_catalog, public, pg_temp` and schema-qualifies every table
 * reference and function call in the four bodies.
 *
 * Groups below:
 *   1. configuration and privilege preservation (exact catalog values);
 *   2. temp-table shadowing for all four functions (run as app_user);
 *   3. built-in shadowing from public (function, operator, type), each run as
 *      the superuser inside a transaction that is always rolled back, so the
 *      shadow objects are never visible to any other session or test file;
 *   4. positive controls for all four legitimate paths;
 *   5. scope, on a scratch database owned by a non-superuser: 0018 applies
 *      only through the role memberships 0007/0015/0016 granted (a non-member
 *      is refused), changes nothing in the inventoried catalog except the four
 *      functions' search_path and source, and changes each source by exactly
 *      the intended schema qualifications and nothing else.
 *
 * Synthetic data only (charter: no real patient or clinic data).
 */

const SEARCH_PATH = 'search_path=pg_catalog, public, pg_temp';

/** The exact pre- and post-0018 attributes of the four functions (CREATE OR
 * REPLACE must not change any of them). Values equal the 0007/0015/0016
 * state; group 5 proves that on a scratch database. */
const EXPECTED_FUNCTIONS = [
  {
    signature: 'accept_invitation(text,text)',
    owner: 'invitation_acceptor',
    acl: '{invitation_acceptor=X/invitation_acceptor,app_user=X/invitation_acceptor}',
    volatility: 'v',
    result: 'TABLE(outcome text, staff_id uuid, clinic_id uuid, role text)',
  },
  {
    signature: 'auth_lookup_session_by_token_hash(text)',
    owner: 'auth_bootstrap',
    acl: '{auth_bootstrap=X/auth_bootstrap,app_user=X/auth_bootstrap}',
    volatility: 's',
    result: 'TABLE(session_id uuid, staff_id uuid, clinic_id uuid, role text, status text)',
  },
  {
    signature: 'auth_lookup_staff_by_email(text)',
    owner: 'auth_bootstrap',
    acl: '{auth_bootstrap=X/auth_bootstrap,app_user=X/auth_bootstrap}',
    volatility: 's',
    result: 'TABLE(staff_id uuid, clinic_id uuid, role text, status text, password_hash text)',
  },
  {
    signature: 'set_clinic_settings(jsonb,text)',
    owner: 'clinic_settings_writer',
    acl: '{clinic_settings_writer=X/clinic_settings_writer,app_user=X/clinic_settings_writer}',
    volatility: 'v',
    result: 'void',
  },
] as const;

/** SECURITY DEFINER functions added after 0018 (0020, ADR-0026), reviewed and added here
 * deliberately. They were created with the hardened configuration, so the same inventory
 * assertions apply to them; their own coverage is tests/db/knowledge-document-chunks.test.ts. */
const LATER_FUNCTIONS = [
  {
    signature: 'mark_knowledge_document_failed(uuid,text)',
    owner: 'knowledge_document_processor',
    acl: '{knowledge_document_processor=X/knowledge_document_processor,app_user=X/knowledge_document_processor}',
    volatility: 'v',
    result: 'void',
  },
  {
    signature: 'store_knowledge_document_chunks(uuid,text,text,text,text[])',
    owner: 'knowledge_document_processor',
    acl: '{knowledge_document_processor=X/knowledge_document_processor,app_user=X/knowledge_document_processor}',
    volatility: 'v',
    result: 'integer',
  },
] as const;

/** Every SECURITY DEFINER function in public on a fully migrated database, sorted by signature. */
const ALL_SECDEF_FUNCTIONS = [...EXPECTED_FUNCTIONS, ...LATER_FUNCTIONS].sort((a, b) =>
  a.signature.localeCompare(b.signature),
);

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Privileged (owner/migration) connection — the same role CI migrates with. */
function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  return withClient(getDatabaseUrl(), fn);
}

/** Raw app_user connection — the role an attacker would need to reach. */
function asAppUser<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  return withClient(getAppDatabaseUrl(), fn);
}

/**
 * Runs `fn` as the superuser inside a transaction that is ALWAYS rolled back,
 * after creating `shadowSql` objects in public. A fresh connection is used so
 * no previously cached PL/pgSQL plan can mask the name resolution under test.
 */
function withShadowObjects<T>(shadowSql: string[], fn: (client: Client) => Promise<T>): Promise<T> {
  return withAdmin(async (admin) => {
    await admin.query('BEGIN');
    try {
      for (const sql of shadowSql) await admin.query(sql);
      return await fn(admin);
    } finally {
      await admin.query('ROLLBACK');
    }
  });
}

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function newTokenHash(): string {
  return sha256Hex(randomBytes(32).toString('base64url'));
}

/** Writes a pending invitation the way the application does: over a
 * privileged connection with the clinic's tenant context set (app_user has
 * no INSERT on invitations). `ageHours` > 72 produces an expired one. */
async function insertInvitation(
  clinicId: string,
  tokenHash: string,
  role: 'owner' | 'receptionist',
  invitedBy: string | null,
  ageHours = 0,
): Promise<string> {
  const email = `invitee-${randomUUID().slice(0, 8)}@example.test`;
  await withAdmin(async (admin) => {
    await admin.query('BEGIN');
    try {
      await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicId]);
      await admin.query(
        `INSERT INTO invitations (clinic_id, email, role, token_hash, invited_by, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5,
                 now() - make_interval(hours => $6::int),
                 now() - make_interval(hours => $6::int) + interval '72 hours')`,
        [clinicId, email, role, tokenHash, invitedBy, ageHours],
      );
      await admin.query('COMMIT');
    } catch (err) {
      await admin.query('ROLLBACK');
      throw err;
    }
  });
  return email;
}

async function insertSession(
  staffId: string,
  clinicId: string,
  tokenHash: string,
): Promise<string> {
  return withAdmin(async (admin) => {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO staff_sessions (staff_member_id, clinic_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour') RETURNING id`,
      [staffId, clinicId, tokenHash],
    );
    return rows[0]!.id;
  });
}

async function clinicTimezone(clinicId: string): Promise<string> {
  return withAdmin(async (admin) => {
    const { rows } = await admin.query<{ timezone: string }>(
      'SELECT timezone FROM public.clinics WHERE id = $1',
      [clinicId],
    );
    return rows[0]!.timezone;
  });
}

/** Calls set_clinic_settings as app_user under the given tenant context. */
async function setClinicTimezoneAsAppUser(
  client: Client,
  contextClinicId: string,
  timezone: string,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [contextClinicId]);
    await client.query('SELECT set_clinic_settings(NULL, $1)', [timezone]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

describe('0018 SECURITY DEFINER search_path hardening', () => {
  afterAll(async () => {
    await closePool();
  });

  // ── 1. configuration and privilege preservation ─────────────────────────

  it('exactly the reviewed SECURITY DEFINER functions in public pin pg_catalog, public, pg_temp', async () => {
    const rows = await withAdmin(async (admin) => {
      const { rows } = await admin.query<{ signature: string; cfg: string[] | null }>(
        `SELECT p.oid::regprocedure::text AS signature, p.proconfig AS cfg
           FROM pg_proc p
          WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
          ORDER BY 1`,
      );
      return rows;
    });
    // Any further SECURITY DEFINER function in public must be reviewed and
    // added to LATER_FUNCTIONS deliberately.
    expect(rows.map((r) => r.signature)).toEqual(ALL_SECDEF_FUNCTIONS.map((f) => f.signature));
    for (const row of rows) {
      expect(row.cfg, `${row.signature} proconfig`).toEqual([SEARCH_PATH]);
    }
  });

  it('owners, EXECUTE grants, PUBLIC privilege, volatility and signatures are unchanged', async () => {
    const rows = await withAdmin(async (admin) => {
      const { rows } = await admin.query(
        `SELECT p.oid::regprocedure::text AS signature,
                pg_get_userbyid(p.proowner) AS owner,
                p.proacl::text AS acl,
                p.provolatile AS volatility,
                pg_get_function_result(p.oid) AS result,
                p.prosecdef AS secdef,
                l.lanname AS lang,
                p.prokind AS kind,
                p.proparallel AS parallel,
                p.proisstrict AS strict,
                p.proleakproof AS leakproof,
                has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
           FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
          ORDER BY 1`,
      );
      return rows;
    });
    expect(rows).toEqual(
      ALL_SECDEF_FUNCTIONS.map((f) => ({
        ...f,
        secdef: true,
        lang: 'plpgsql',
        kind: 'f',
        parallel: 'u',
        strict: false,
        leakproof: false,
        public_execute: false,
      })),
    );
  });

  // ── 2. temp-table shadowing, all four functions, as app_user ─────────────

  it('auth_lookup_staff_by_email: a temp staff_members table cannot forge an auth row', async () => {
    const clinic = await createTestClinic('SecdefAuthEmail');
    const real = await createTestStaffMember(clinic.id, 'SecdefAuthEmail', {
      role: 'receptionist',
    });

    const result = await asAppUser(async (client) => {
      await client.query(
        `CREATE TEMP TABLE staff_members
           (id uuid, clinic_id uuid, role text, status text, password_hash text, email text)`,
      );
      await client.query(
        `INSERT INTO pg_temp.staff_members
           VALUES ($1, $2, 'owner', 'active', '$argon2id$FORGED', $3)`,
        [randomUUID(), clinic.id, real.email],
      );
      await client.query('GRANT SELECT ON pg_temp.staff_members TO auth_bootstrap');
      const { rows } = await client.query<{
        staff_id: string;
        role: string;
        password_hash: string;
      }>('SELECT staff_id, role, password_hash FROM auth_lookup_staff_by_email($1)', [real.email]);
      return rows;
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.staff_id).toBe(real.id);
    expect(result[0]!.role).toBe('receptionist');
    expect(result[0]!.password_hash).not.toContain('FORGED');
  });

  it('auth_lookup_session_by_token_hash: temp staff_sessions/staff_members tables cannot forge a session', async () => {
    const clinic = await createTestClinic('SecdefAuthSession');
    const forgedHash = newTokenHash();
    const forgedStaffId = randomUUID();

    const rows = await asAppUser(async (client) => {
      await client.query(
        `CREATE TEMP TABLE staff_sessions
           (id uuid, staff_member_id uuid, clinic_id uuid, token_hash text,
            expires_at timestamptz, revoked_at timestamptz)`,
      );
      await client.query(
        `CREATE TEMP TABLE staff_members (id uuid, clinic_id uuid, role text, status text)`,
      );
      await client.query(
        `INSERT INTO pg_temp.staff_sessions
           VALUES ($1, $2, $3, $4, now() + interval '1 day', NULL)`,
        [randomUUID(), forgedStaffId, clinic.id, forgedHash],
      );
      await client.query(`INSERT INTO pg_temp.staff_members VALUES ($1, $2, 'owner', 'active')`, [
        forgedStaffId,
        clinic.id,
      ]);
      await client.query(
        'GRANT SELECT ON pg_temp.staff_sessions, pg_temp.staff_members TO auth_bootstrap',
      );
      const { rows } = await client.query('SELECT * FROM auth_lookup_session_by_token_hash($1)', [
        forgedHash,
      ]);
      return rows;
    });

    expect(rows).toEqual([]);
  });

  it('set_clinic_settings: a temp clinics table cannot absorb or fake the write', async () => {
    const clinic = await createTestClinic('SecdefSettingsTemp');
    const forgedClinicId = randomUUID();

    await asAppUser(async (client) => {
      await client.query(
        `CREATE TEMP TABLE clinics
           (id uuid, working_hours jsonb, timezone text, updated_at timestamptz)`,
      );
      await client.query(
        `INSERT INTO pg_temp.clinics VALUES ($1, '{}', 'UTC', now()), ($2, '{}', 'UTC', now())`,
        [forgedClinicId, clinic.id],
      );
      await client.query('GRANT SELECT, UPDATE ON pg_temp.clinics TO clinic_settings_writer');

      // A tenant context naming a clinic that exists only in pg_temp is still
      // refused: the function reads public.clinics.
      await expect(
        setClinicTimezoneAsAppUser(client, forgedClinicId, 'Asia/Tokyo'),
      ).rejects.toThrow('no clinic matches the tenant context');

      // And a real clinic's write lands in public.clinics, not in the shadow.
      await setClinicTimezoneAsAppUser(client, clinic.id, 'Asia/Tokyo');
      const shadow = await client.query<{ timezone: string }>(
        'SELECT timezone FROM pg_temp.clinics WHERE id = $1',
        [clinic.id],
      );
      expect(shadow.rows[0]!.timezone).toBe('UTC');
    });

    expect(await clinicTimezone(clinic.id)).toBe('Asia/Tokyo');
  });

  it('accept_invitation: a temp invitations table cannot forge an accepted invitation', async () => {
    const clinic = await createTestClinic('SecdefInvite');
    const forgedTokenHash = newTokenHash();
    const attackerEmail = `attacker-${randomUUID().slice(0, 8)}@example.test`;
    const attackerPasswordHash = await hashPassword('Attacker-Chosen-Password-1!');

    const outcome = await asAppUser(async (client) => {
      await client.query(
        `CREATE TEMP TABLE invitations
           (id uuid, clinic_id uuid, email text, role text, expires_at timestamptz,
            token_hash text, status text, accepted_at timestamptz)`,
      );
      await client.query(
        `INSERT INTO pg_temp.invitations
           VALUES ($1, $2, $4, 'owner', now() + interval '1 day',
                   $3, 'pending', NULL)`,
        [randomUUID(), clinic.id, forgedTokenHash, attackerEmail],
      );
      await client.query('GRANT SELECT, UPDATE ON pg_temp.invitations TO invitation_acceptor');
      const { rows } = await client.query<{ outcome: string }>(
        'SELECT outcome FROM accept_invitation($1, $2)',
        [forgedTokenHash, attackerPasswordHash],
      );
      return rows[0]!.outcome;
    });

    expect(outcome).toBe('invalid');
    // No real staff row was written for the attacker. The email is unique per
    // run, so a row left by an earlier (e.g. mutation-check) run cannot mask
    // or fake this result.
    const staff = await withAdmin((admin) =>
      admin.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM public.staff_members WHERE email = $1',
        [attackerEmail],
      ),
    );
    expect(staff.rows[0]!.n).toBe('0');
  });

  it('temporary types named uuid and text cannot change any of the four functions', async () => {
    const clinic = await createTestClinic('SecdefTempType');
    const staff = await createTestStaffMember(clinic.id, 'SecdefTempType', { role: 'admin' });
    const sessionHash = newTokenHash();
    await insertSession(staff.id, clinic.id, sessionHash);
    const passwordHash = await hashPassword('Temp-Type-Password-1!');

    await asAppUser(async (client) => {
      // Always-failing domains. Without pg_temp named last, PostgreSQL searches
      // the temporary schema first for type names too, so a body's `uuid` or
      // `text` would resolve here and every call would raise a check violation.
      await client.query('CREATE DOMAIN pg_temp.uuid AS pg_catalog.text CHECK (false)');
      await client.query('CREATE DOMAIN pg_temp.text AS pg_catalog.text CHECK (false)');

      const lookup = await client.query('SELECT staff_id FROM auth_lookup_staff_by_email($1)', [
        staff.email,
      ]);
      expect(lookup.rows).toEqual([{ staff_id: staff.id }]);

      const session = await client.query(
        'SELECT staff_id FROM auth_lookup_session_by_token_hash($1)',
        [sessionHash],
      );
      expect(session.rows).toEqual([{ staff_id: staff.id }]);

      const invite = await client.query<{ outcome: string }>(
        'SELECT outcome FROM accept_invitation($1, $2)',
        [newTokenHash(), passwordHash],
      );
      expect(invite.rows[0]!.outcome).toBe('invalid');

      await setClinicTimezoneAsAppUser(client, clinic.id, 'Europe/Lisbon');
    });

    expect(await clinicTimezone(clinic.id)).toBe('Europe/Lisbon');
  });

  // ── 3. built-in shadowing from public (rolled back, superuser) ────────────

  it('a public function shadowing a built-in is not called (jsonb_typeof in set_clinic_settings)', async () => {
    const clinic = await createTestClinic('SecdefShadowFn');
    await withShadowObjects(
      [
        `CREATE FUNCTION public.jsonb_typeof(jsonb) RETURNS text
           LANGUAGE sql IMMUTABLE AS $$ SELECT 'object'::text $$`,
      ],
      async (admin) => {
        await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinic.id]);
        // With the shadow honoured, a JSON array would pass the object check.
        await admin.query('SAVEPOINT s');
        await expect(admin.query(`SELECT set_clinic_settings('[]'::jsonb, NULL)`)).rejects.toThrow(
          'invalid working hours',
        );
        await admin.query('ROLLBACK TO SAVEPOINT s');
      },
    );
  });

  it('a public function shadowing a built-in is not called (left in accept_invitation)', async () => {
    await withShadowObjects(
      [
        `CREATE FUNCTION public.left(text, integer) RETURNS text
           LANGUAGE sql IMMUTABLE AS $$ SELECT '$argon2id$'::text $$`,
      ],
      async (admin) => {
        // With the shadow honoured, a plaintext password would pass the
        // Argon2id-format check.
        await expect(
          admin.query('SELECT * FROM accept_invitation($1, $2)', [
            newTokenHash(),
            'plaintext-password',
          ]),
        ).rejects.toThrow('must be an Argon2id hash');
      },
    );
  });

  it('a public operator shadowing a built-in is not used (<= on timestamptz in accept_invitation)', async () => {
    const clinic = await createTestClinic('SecdefShadowOp');
    const tokenHash = newTokenHash();
    // Created 100 hours ago => expired 28 hours ago.
    await insertInvitation(clinic.id, tokenHash, 'owner', null, 100);
    const passwordHash = await hashPassword('Expired-Invitee-Password-1!');

    const outcome = await withShadowObjects(
      [
        `CREATE FUNCTION public.rc_shadow_never_le(timestamptz, timestamptz) RETURNS boolean
           LANGUAGE sql IMMUTABLE AS $$ SELECT false $$`,
        `CREATE OPERATOR public.<= (LEFTARG = timestamptz, RIGHTARG = timestamptz,
           FUNCTION = public.rc_shadow_never_le)`,
      ],
      async (admin) => {
        const { rows } = await admin.query<{ outcome: string }>(
          'SELECT outcome FROM accept_invitation($1, $2)',
          [tokenHash, passwordHash],
        );
        return rows[0]!.outcome;
      },
    );
    // With the shadow honoured, the expired invitation would be accepted.
    expect(outcome).toBe('invalid');
  });

  it('a public type shadowing a built-in is not used (uuid in set_clinic_settings)', async () => {
    const clinic = await createTestClinic('SecdefShadowType');
    await withShadowObjects(
      // With the shadow honoured, `v_context::uuid` and the uuid variable
      // would resolve to this always-failing domain.
      [`CREATE DOMAIN public.uuid AS pg_catalog.text CHECK (false)`],
      async (admin) => {
        await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinic.id]);
        await admin.query(`SELECT set_clinic_settings(NULL, 'America/Lima')`);
        const { rows } = await admin.query<{ timezone: string }>(
          'SELECT timezone FROM public.clinics WHERE id = $1',
          [clinic.id],
        );
        expect(rows[0]!.timezone).toBe('America/Lima');
      },
    );
  });

  // ── 4. positive controls ─────────────────────────────────────────────────

  it('auth_lookup_staff_by_email still returns the real staff member', async () => {
    const clinic = await createTestClinic('SecdefPos');
    const staff = await createTestStaffMember(clinic.id, 'SecdefPos', { role: 'admin' });
    const rows = await asAppUser(async (client) => {
      const { rows } = await client.query<{ staff_id: string; role: string; status: string }>(
        'SELECT staff_id, role, status FROM auth_lookup_staff_by_email($1)',
        [staff.email],
      );
      return rows;
    });
    expect(rows).toEqual([{ staff_id: staff.id, role: 'admin', status: 'active' }]);
  });

  it('auth_lookup_session_by_token_hash still resolves a genuine session', async () => {
    const clinic = await createTestClinic('SecdefSessionPos');
    const staff = await createTestStaffMember(clinic.id, 'SecdefSessionPos', {
      role: 'practitioner',
    });
    const tokenHash = newTokenHash();
    const sessionId = await insertSession(staff.id, clinic.id, tokenHash);

    const rows = await asAppUser(async (client) => {
      const { rows } = await client.query(
        'SELECT session_id, staff_id, clinic_id, role, status FROM auth_lookup_session_by_token_hash($1)',
        [tokenHash],
      );
      return rows;
    });
    expect(rows).toEqual([
      {
        session_id: sessionId,
        staff_id: staff.id,
        clinic_id: clinic.id,
        role: 'practitioner',
        status: 'active',
      },
    ]);
  });

  it('set_clinic_settings still updates the tenant clinic', async () => {
    const clinic = await createTestClinic('SecdefSettingsPos');
    await asAppUser((client) => setClinicTimezoneAsAppUser(client, clinic.id, 'Pacific/Auckland'));
    expect(await clinicTimezone(clinic.id)).toBe('Pacific/Auckland');
  });

  it('accept_invitation still accepts a genuine pending invitation', async () => {
    const clinic = await createTestClinic('SecdefInvitePos');
    const tokenHash = newTokenHash();
    // A non-owner invitation must name its inviter
    // (invitation_inviter_required_unless_owner), so create an owner first.
    const inviter = await createTestStaffMember(clinic.id, 'SecdefInvitePosOwner', {
      role: 'owner',
    });
    await insertInvitation(clinic.id, tokenHash, 'receptionist', inviter.id);
    const passwordHash = await hashPassword('Genuine-Invitee-Password-1!');

    const result = await asAppUser(async (client) => {
      const { rows } = await client.query<{ outcome: string; role: string; clinic_id: string }>(
        'SELECT outcome, role, clinic_id FROM accept_invitation($1, $2)',
        [tokenHash, passwordHash],
      );
      return rows[0]!;
    });
    expect(result).toEqual({ outcome: 'accepted', role: 'receptionist', clinic_id: clinic.id });
  });

  // ── 5. scope of 0018 on a scratch database ────────────────────────────────

  it('the 0018 file contains exactly four statements, each CREATE OR REPLACE FUNCTION of a reviewed function', () => {
    const file = readdirSync(MIGRATIONS_DIR).find((f) => f.startsWith('0018_'));
    expect(file, '0018 migration file present').toBeDefined();
    const statements = topLevelStatements(readFileSync(join(MIGRATIONS_DIR, file!), 'utf8'));
    // Any other statement (GRANT, ALTER, CREATE TYPE/VIEW/OPERATOR, DO block,
    // SET ...) — or a fifth function — fails here, independent of how
    // complete the catalog snapshot below is.
    expect(
      statements.map(
        (s) => /^CREATE OR REPLACE FUNCTION (\w+)\s*\(/.exec(s)?.[1] ?? `<other> ${s.slice(0, 80)}`,
      ),
    ).toEqual([
      'auth_lookup_staff_by_email',
      'auth_lookup_session_by_token_hash',
      'set_clinic_settings',
      'accept_invitation',
    ]);
  });

  it('0018 applies as a non-superuser owner only through the memberships 0007/0015/0016 created', async () => {
    await withScratchMigrations(async (s) => {
      // Before any migration the owner holds no role memberships at all.
      expect(await membershipsOf(s.scratchAdmin, s.ownerRole)).toEqual([]);

      for (const file of s.filesBefore0018) await s.applyAsOwner(file);

      // The migrating role is a genuine non-superuser, non-BYPASSRLS login.
      const who = await s.owner.query<{ me: string; rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT current_user AS me, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(who.rows).toEqual([{ me: s.ownerRole, rolsuper: false, rolbypassrls: false }]);

      // Its only path to the function owners is the memberships the earlier
      // migrations granted it (GRANT <owner> TO CURRENT_USER WITH SET TRUE,
      // grantor = the owner itself). PostgreSQL 16 also records an ADMIN-only
      // membership for every role a CREATEROLE role creates; those rows carry
      // neither INHERIT nor SET, so they confer no privileges of the role.
      const memberships = await membershipsOf(s.scratchAdmin, s.ownerRole);
      expect(memberships.filter((m) => m.inherit || m.set)).toEqual(
        [s.role('auth_bootstrap'), s.role('clinic_settings_writer'), s.role('invitation_acceptor')]
          .sort()
          .map((granted) => ({
            granted,
            grantor: s.ownerRole,
            admin: false,
            inherit: true,
            set: true,
          })),
      );
      const adminOnly = memberships.filter((m) => !m.inherit && !m.set);
      expect(adminOnly.every((m) => m.admin && m.grantor !== s.ownerRole)).toBe(true);
      expect(adminOnly.map((m) => m.granted).sort()).toEqual(
        ['app_user', 'auth_bootstrap', 'clinic_settings_writer', 'invitation_acceptor']
          .map((name) => s.role(name))
          .sort(),
      );

      // Negative control: a non-member, non-superuser role — even one given
      // CREATE on public — cannot apply 0018.
      const blocked = await s.tryApply0018As(s.nonMemberRole, s.nonMemberPassword);
      expect(blocked).toMatch(/must be owner of function/);

      // The owner can, and the result is the hardened configuration.
      await s.applyAsOwner(s.file0018);
      const cfg = await s.scratchAdmin.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_proc
          WHERE prosecdef AND pronamespace = 'public'::regnamespace
            AND proconfig = ARRAY[$1]`,
        [SEARCH_PATH],
      );
      expect(cfg.rows[0]!.n).toBe('4');
    });
  });

  it('0018 changes only the four functions’ search_path and source, and the source exactly by the intended qualifications', async () => {
    const result = await withScratchMigrations(async (s) => {
      for (const file of s.filesBefore0018) await s.applyAsOwner(file);
      const before = await catalogSnapshot(s.scratchAdmin, s.roleNames);
      const sourcesBefore = await secdefSources(s.scratchAdmin);

      // A refused attempt leaves the catalog exactly as it was.
      await s.tryApply0018As(s.nonMemberRole, s.nonMemberPassword);
      const afterRefused = await catalogSnapshot(s.scratchAdmin, s.roleNames);

      await s.applyAsOwner(s.file0018);
      const after = await catalogSnapshot(s.scratchAdmin, s.roleNames);
      const sourcesAfter = await secdefSources(s.scratchAdmin);
      return { before, afterRefused, after, sourcesBefore, sourcesAfter };
    });

    expect(result.afterRefused).toEqual(result.before);

    const { before, after } = result;
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    const changed = keys.filter((k) => before[k] !== after[k]);
    expect(changed).toEqual(
      EXPECTED_FUNCTIONS.flatMap((f) => [
        `function:${f.signature}:config`,
        `function:${f.signature}:source`,
      ]).sort(),
    );

    for (const f of EXPECTED_FUNCTIONS) {
      expect(before[`function:${f.signature}:config`]).toBe('{"search_path=public, pg_catalog"}');
      expect(after[`function:${f.signature}:config`]).toBe(`{"${SEARCH_PATH}"}`);

      // Schema-sensitive: the 0017 body with exactly the intended
      // qualifications applied must equal the 0018 body (comments and
      // whitespace aside). Any other edit — a different schema such as
      // public.gen_random_uuid(), a missed or extra qualification, or a logic
      // change — makes these differ.
      const beforeSrc = result.sourcesBefore[f.signature]!;
      const afterSrc = result.sourcesAfter[f.signature]!;
      expect(beforeSrc, `${f.signature}: 0017 body has qualifications to add`).not.toBe(
        expectedQualified(beforeSrc),
      );
      expect(normalizeSource(afterSrc), f.signature).toBe(expectedQualified(beforeSrc));
    }
  });
});

// ── scratch-database helpers for group 5 ──────────────────────────────────

/** The only name changes 0018 is allowed to make inside the four bodies. */
const QUALIFY_AS_PUBLIC = ['staff_members', 'staff_sessions', 'invitations', 'clinics'];
const QUALIFY_AS_PG_CATALOG_RELATION = ['pg_timezone_names'];
const QUALIFY_AS_PG_CATALOG_FUNCTION = [
  'now',
  'set_config',
  'current_setting',
  'jsonb_typeof',
  'left',
  'gen_random_uuid',
];

/**
 * Splits a migration file into its top-level SQL statements. Dollar-quoted
 * bodies ($$...$$ or $tag$...$tag$) and comments are removed first, so a
 * semicolon inside a function body never splits a statement. A semicolon
 * inside a single-quoted string would add a fragment; that fails the caller's
 * exact match, so the split errs toward refusing, never toward accepting.
 */
function topLevelStatements(sql: string): string[] {
  return sql
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, '$$$$')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

/** Drops `--` comments and collapses whitespace. The four bodies contain no
 * `--` inside string literals. */
function normalizeSource(src: string): string {
  return src
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unqualified(names: string[], suffix = '(?![\\w$])'): RegExp {
  // Not preceded by a word character, `$` or `.` (so `public.x` and `sm.x`
  // are left alone) and not continued as a longer identifier.
  return new RegExp(`(?<![\\w$.])(${names.join('|')})${suffix}`, 'g');
}

/** Applies exactly the intended qualifications to a pre-0018 body. */
function expectedQualified(src: string): string {
  return normalizeSource(
    normalizeSource(src)
      .replace(unqualified(QUALIFY_AS_PUBLIC), 'public.$1')
      .replace(unqualified(QUALIFY_AS_PG_CATALOG_RELATION), 'pg_catalog.$1')
      .replace(unqualified(QUALIFY_AS_PG_CATALOG_FUNCTION, '\\s*\\('), 'pg_catalog.$1('),
  );
}

async function secdefSources(client: Client): Promise<Record<string, string>> {
  const { rows } = await client.query<{ signature: string; src: string }>(
    `SELECT p.oid::regprocedure::text AS signature, p.prosrc AS src
       FROM pg_proc p WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace`,
  );
  return Object.fromEntries(rows.map((r) => [r.signature, r.src]));
}

interface Membership {
  granted: string;
  grantor: string;
  admin: boolean;
  inherit: boolean;
  set: boolean;
}

async function membershipsOf(client: Client, member: string): Promise<Membership[]> {
  const { rows } = await client.query<Membership>(
    `SELECT m.roleid::regrole::text AS granted, m.grantor::regrole::text AS grantor,
            m.admin_option AS admin, m.inherit_option AS inherit, m.set_option AS set
       FROM pg_auth_members m WHERE m.member = $1::regrole ORDER BY 1, 2`,
    [member],
  );
  return rows;
}

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

interface Scratch {
  owner: Client;
  ownerRole: string;
  scratchAdmin: Client;
  nonMemberRole: string;
  nonMemberPassword: string;
  roleNames: string[];
  role: (name: string) => string;
  filesBefore0018: string[];
  file0018: string;
  applyAsOwner: (file: string) => Promise<void>;
  /** Runs 0018 as `role` in a rolled-back transaction; returns the error
   * message, or '' if it unexpectedly succeeded. */
  tryApply0018As: (role: string, password: string) => Promise<string>;
}

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'db',
  'migrations',
);

/**
 * Same shape as tests/db/migration-full-chain-non-superuser.test.ts: a scratch
 * database owned by a fresh LOGIN role that is NOSUPERUSER, NOBYPASSRLS and
 * CREATEROLE (mirroring a managed-Postgres owner), with the cluster-wide role
 * names the migrations manage swapped for throwaway per-test names so the
 * shared cluster's real roles are never touched. The superuser connection is
 * used only to create and drop the scratch objects, to read the catalog, and
 * to create the non-member control role. Everything is dropped afterwards.
 */
async function withScratchMigrations<T>(fn: (s: Scratch) => Promise<T>): Promise<T> {
  const suffix = randomUUID().replace(/-/g, '_');
  const ownerRole = `test_owner_${suffix}`;
  const ownerPassword = `pw_${suffix}`;
  const nonMemberRole = `test_nonmember_${suffix}`;
  const nonMemberPassword = `pwn_${suffix}`;
  const database = `test_db_${suffix}`;
  const swaps: Array<[string, string]> = [
    ['app_user', `test_app_user_${suffix}`],
    ['auth_bootstrap', `test_auth_bootstrap_${suffix}`],
    ['clinic_settings_writer', `test_csw_${suffix}`],
    ['invitation_acceptor', `test_ia_${suffix}`],
  ];
  const substitute = (sql: string) =>
    swaps.reduce((acc, [from, to]) => acc.replaceAll(from, to), sql);
  const roleNames = [ownerRole, nonMemberRole, ...swaps.map(([, to]) => to)];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f < '0019')
    .sort();
  const file0018 = files.find((f) => f.startsWith('0018_'));
  if (!file0018) throw new Error('0018 migration file not found');
  const scratchUrl = (user?: string, password?: string) => {
    const url = withDatabaseName(getDatabaseUrl(), database);
    return user && password ? withCredentials(url, user, password) : url;
  };
  const readMigration = (file: string) =>
    substitute(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));

  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  let scratchAdmin: Client | undefined;
  let owner: Client | undefined;
  try {
    await admin.query(
      `CREATE ROLE ${ownerRole} LOGIN PASSWORD '${ownerPassword}' NOSUPERUSER NOBYPASSRLS CREATEROLE`,
    );
    await admin.query(
      `CREATE ROLE ${nonMemberRole} LOGIN PASSWORD '${nonMemberPassword}' NOSUPERUSER NOBYPASSRLS`,
    );
    await admin.query(`CREATE DATABASE ${database} OWNER ${ownerRole}`);
    scratchAdmin = new Client({ connectionString: scratchUrl() });
    await scratchAdmin.connect();
    await scratchAdmin.query(`ALTER SCHEMA public OWNER TO ${ownerRole}`);
    await scratchAdmin.query(`GRANT CREATE ON SCHEMA public TO ${nonMemberRole}`);
    owner = new Client({ connectionString: scratchUrl(ownerRole, ownerPassword) });
    await owner.connect();
    const ownerClient = owner;

    return await fn({
      owner: ownerClient,
      ownerRole,
      scratchAdmin,
      nonMemberRole,
      nonMemberPassword,
      roleNames,
      role: (name) => swaps.find(([from]) => from === name)![1],
      filesBefore0018: files.filter((f) => f !== file0018),
      file0018,
      applyAsOwner: async (file) => {
        await ownerClient.query(readMigration(file));
      },
      tryApply0018As: async (role, password) => {
        const client = new Client({ connectionString: scratchUrl(role, password) });
        await client.connect();
        try {
          await client.query('BEGIN');
          await client.query(readMigration(file0018));
          return '';
        } catch (err) {
          return (err as Error).message;
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
          await client.end();
        }
      },
    });
  } finally {
    await owner?.end().catch(() => undefined);
    await scratchAdmin?.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    for (const role of [...roleNames].reverse()) {
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
    }
    await admin.end();
  }
}

/**
 * Flattens the scratch database's catalog into key -> value strings. Covered:
 * every function, procedure and aggregate outside pg_catalog (owner, ACL,
 * security, volatility, parallel, strict, leakproof, kind, language,
 * arguments with defaults, result, config, source); every relation (kind,
 * owner, ACL, RLS and FORCE RLS, persistence, options such as a view's
 * security_barrier / security_invoker); view and materialized-view
 * definitions; rewrite rules; columns of tables, views and foreign tables
 * (position, type, NOT NULL, default, identity, generated, dropped,
 * collation); sequences; column ACLs; constraints; index
 * definitions; schemas (owner, ACL); default ACLs; policies; triggers;
 * user-defined types, operators and casts; non-built-in languages; event
 * triggers; extensions; the database's owner and ACL; and the scratch roles'
 * attributes and memberships. Not covered: objects of other databases, and
 * cluster-wide settings.
 */
async function catalogSnapshot(
  client: Client,
  roleNames: string[],
): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  const add = async (sql: string, params: unknown[] = []) => {
    const { rows } = await client.query<{ k: string; v: string | null }>(sql, params);
    for (const row of rows) {
      if (row.k in snapshot) throw new Error(`duplicate snapshot key ${row.k}`);
      snapshot[row.k] = row.v ?? '<null>';
    }
  };
  const userNs = (alias: string) =>
    `${alias}.nspname NOT IN ('pg_catalog', 'information_schema') AND ${alias}.nspname NOT LIKE 'pg_toast%' AND ${alias}.nspname NOT LIKE 'pg_temp%'`;

  const fnFields: Array<[string, string]> = [
    ['owner', 'pg_get_userbyid(p.proowner)'],
    ['acl', 'p.proacl::text'],
    ['secdef', 'p.prosecdef::text'],
    ['volatility', 'p.provolatile::text'],
    ['parallel', 'p.proparallel::text'],
    ['strict', 'p.proisstrict::text'],
    ['leakproof', 'p.proleakproof::text'],
    ['kind', 'p.prokind::text'],
    ['language', '(SELECT lanname FROM pg_language WHERE oid = p.prolang)::text'],
    ['arguments', 'pg_get_function_arguments(p.oid)'],
    ['result', 'pg_get_function_result(p.oid)'],
    ['config', 'p.proconfig::text'],
    ['source', 'md5(p.prosrc)'],
  ];
  for (const [field, expr] of fnFields) {
    await add(
      `SELECT 'function:' || p.oid::regprocedure::text || ':${field}' AS k, ${expr} AS v
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE ${userNs('n')}`,
    );
  }
  // Relation options carry view security attributes (security_barrier,
  // security_invoker, check_option); coalesce keeps NULL distinct from ''.
  await add(
    `SELECT 'relation:' || c.oid::regclass::text AS k,
            concat_ws('|', c.relkind, pg_get_userbyid(c.relowner),
                      coalesce(c.relacl::text, '<null>'), c.relrowsecurity,
                      c.relforcerowsecurity, c.relpersistence,
                      coalesce(c.reloptions::text, '<null>')) AS v
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${userNs('n')}`,
  );
  await add(
    `SELECT 'view:' || c.oid::regclass::text AS k, pg_get_viewdef(c.oid, true) AS v
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('v', 'm') AND ${userNs('n')}`,
  );
  await add(
    `SELECT 'rule:' || r.ev_class::regclass::text || '.' || r.rulename AS k,
            r.ev_enabled::text || '|' || pg_get_ruledef(r.oid, true) AS v
       FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class
       JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${userNs('n')}`,
  );
  await add(
    `SELECT 'column:' || a.attrelid::regclass::text || '.' || a.attname AS k,
            concat_ws('|', a.attnum, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                      coalesce(pg_get_expr(d.adbin, d.adrelid), '<no default>'),
                      a.attidentity, a.attgenerated, a.attisdropped,
                      coalesce(co.collname, '<default>')) AS v
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       LEFT JOIN pg_collation co ON co.oid = a.attcollation AND a.attcollation <> 100
      WHERE a.attnum > 0 AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND ${userNs('n')}`,
  );
  await add(
    `SELECT 'sequence:' || s.seqrelid::regclass::text AS k,
            concat_ws('|', s.seqtypid::regtype::text, s.seqstart, s.seqincrement, s.seqmax,
                      s.seqmin, s.seqcache, s.seqcycle) AS v
       FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${userNs('n')}`,
  );
  await add(
    `SELECT 'column_acl:' || a.attrelid::regclass::text || '.' || a.attname AS k, a.attacl::text AS v
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE a.attacl IS NOT NULL AND ${userNs('n')}`,
  );
  await add(
    `SELECT 'constraint:' || coalesce(con.conrelid::regclass::text, con.contypid::regtype::text)
              || '.' || con.conname AS k,
            con.contype::text || '|' || pg_get_constraintdef(con.oid) AS v
       FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace WHERE ${userNs('n')}`,
  );
  await add(
    `SELECT 'index:' || i.indexrelid::regclass::text AS k, pg_get_indexdef(i.indexrelid) AS v
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${userNs('n')}`,
  );
  await add(
    `SELECT 'schema:' || n.nspname AS k, pg_get_userbyid(n.nspowner) || '|' || coalesce(n.nspacl::text, '') AS v
       FROM pg_namespace n WHERE ${userNs('n')}`,
  );
  await add(
    `SELECT 'default_acl:' || pg_get_userbyid(d.defaclrole) || '|' || d.defaclnamespace::text
              || '|' || d.defaclobjtype::text AS k,
            d.defaclacl::text AS v
       FROM pg_default_acl d`,
  );
  await add(
    `SELECT 'policy:' || pol.polrelid::regclass::text || '.' || pol.polname AS k,
            concat_ws('|', pol.polcmd, pol.polpermissive, pol.polroles::regrole[]::text,
                      pg_get_expr(pol.polqual, pol.polrelid),
                      pg_get_expr(pol.polwithcheck, pol.polrelid)) AS v
       FROM pg_policy pol`,
  );
  await add(
    `SELECT 'trigger:' || t.tgrelid::regclass::text || '.' || t.tgname AS k,
            t.tgenabled::text || '|' || pg_get_triggerdef(t.oid) AS v
       FROM pg_trigger t WHERE NOT t.tgisinternal`,
  );
  await add(
    `SELECT 'type:' || t.oid::regtype::text AS k,
            concat_ws('|', t.typtype, pg_get_userbyid(t.typowner), t.typacl::text) AS v
       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE ${userNs('n')}`,
  );
  await add(
    `SELECT 'operator:' || o.oid::regoperator::text AS k,
            pg_get_userbyid(o.oprowner) || '|' || o.oprcode::regproc::text AS v
       FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace WHERE ${userNs('n')}`,
  );
  await add(
    `SELECT 'cast:' || c.castsource::regtype::text || '->' || c.casttarget::regtype::text AS k,
            concat_ws('|', c.castfunc::regprocedure::text, c.castcontext, c.castmethod) AS v
       FROM pg_cast c WHERE c.oid >= 16384`,
  );
  await add(
    `SELECT 'language:' || l.lanname AS k,
            pg_get_userbyid(l.lanowner) || '|' || coalesce(l.lanacl::text, '') AS v
       FROM pg_language l WHERE l.oid >= 16384`,
  );
  await add(
    `SELECT 'event_trigger:' || e.evtname AS k, e.evtevent || '|' || e.evtfoid::regproc::text AS v
       FROM pg_event_trigger e`,
  );
  await add(
    `SELECT 'extension:' || e.extname AS k, e.extversion || '|' || e.extnamespace::regnamespace::text AS v
       FROM pg_extension e`,
  );
  await add(
    `SELECT 'database:' || d.datname AS k, pg_get_userbyid(d.datdba) || '|' || coalesce(d.datacl::text, '') AS v
       FROM pg_database d WHERE d.datname = current_database()`,
  );
  await add(
    `SELECT 'role:' || r.rolname AS k,
            concat_ws('|', r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb,
                      r.rolcanlogin, r.rolreplication, r.rolbypassrls) AS v
       FROM pg_roles r WHERE r.rolname = ANY($1)`,
    [roleNames],
  );
  await add(
    `SELECT 'membership:' || m.roleid::regrole::text || '>' || m.member::regrole::text
              || '>' || m.grantor::regrole::text AS k,
            concat_ws('|', m.admin_option, m.inherit_option, m.set_option) AS v
       FROM pg_auth_members m
      WHERE m.roleid::regrole::text = ANY($1) OR m.member::regrole::text = ANY($1)`,
    [roleNames],
  );
  return snapshot;
}
