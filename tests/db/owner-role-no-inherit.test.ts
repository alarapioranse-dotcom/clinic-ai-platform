import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { getDatabaseUrl } from '@/lib/env';

/**
 * Migration 0019 / ADR-0025: the migrating (owner) role must keep SET but lose INHERIT on
 * auth_bootstrap, clinic_settings_writer and invitation_acceptor.
 *
 * CI runs migrations as a superuser, for which neither role inheritance nor row level security
 * means anything, so every case here runs the real migration files against a scratch database
 * owned by a genuinely non-superuser, non-BYPASSRLS, CREATEROLE role — the shape of the managed
 * database's owner role — with the cluster-wide role names substituted for throwaway ones (same
 * technique as tests/db/migration-full-chain-non-superuser.test.ts). Synthetic data only.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');
const MIGRATION_0019 = '0019_owner_role_no_inherit.sql';

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8') }));

const BEFORE_0019 = MIGRATION_FILES.filter(({ file }) => file < MIGRATION_0019);
const FILE_0019 = MIGRATION_FILES.find(({ file }) => file === MIGRATION_0019);

/** The four SECURITY DEFINER functions and the role that must own each. */
const SECDEF_FUNCTIONS = [
  { signature: 'auth_lookup_staff_by_email(text)', ownerKey: 'authBootstrap' },
  { signature: 'auth_lookup_session_by_token_hash(text)', ownerKey: 'authBootstrap' },
  { signature: 'set_clinic_settings(jsonb,text)', ownerKey: 'clinicSettingsWriter' },
  { signature: 'accept_invitation(text,text)', ownerKey: 'invitationAcceptor' },
] as const;

interface Roles {
  appUser: string;
  authBootstrap: string;
  clinicSettingsWriter: string;
  invitationAcceptor: string;
}

interface Scratch {
  owner: string;
  ownerPassword: string;
  database: string;
  roles: Roles;
  /** Extra roles a test creates (dropped in cleanup). */
  extraRoles: string[];
}

function urlFor(database: string, username?: string, password?: string): string {
  const url = new URL(getDatabaseUrl());
  url.pathname = `/${database}`;
  if (username !== undefined) url.username = username;
  if (password !== undefined) url.password = password;
  return url.toString();
}

function substituted(sql: string, roles: Roles): string {
  return sql
    .replaceAll('app_user', roles.appUser)
    .replaceAll('auth_bootstrap', roles.authBootstrap)
    .replaceAll('clinic_settings_writer', roles.clinicSettingsWriter)
    .replaceAll('invitation_acceptor', roles.invitationAcceptor);
}

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

async function createScratch(admin: Client): Promise<Scratch> {
  const suffix = randomUUID().replace(/-/g, '_');
  const scratch: Scratch = {
    owner: `test_ni_owner_${suffix}`,
    ownerPassword: `pw_${suffix}`,
    database: `test_ni_db_${suffix}`,
    roles: {
      appUser: `test_ni_au_${suffix}`,
      authBootstrap: `test_ni_ab_${suffix}`,
      clinicSettingsWriter: `test_ni_cs_${suffix}`,
      invitationAcceptor: `test_ni_ia_${suffix}`,
    },
    extraRoles: [],
  };
  await admin.query(
    `CREATE ROLE ${scratch.owner} LOGIN PASSWORD '${scratch.ownerPassword}' NOSUPERUSER NOBYPASSRLS CREATEROLE`,
  );
  await admin.query(`CREATE DATABASE ${scratch.database} OWNER ${scratch.owner}`);
  const scratchAdmin = new Client({ connectionString: urlFor(scratch.database) });
  await scratchAdmin.connect();
  try {
    await scratchAdmin.query(`ALTER SCHEMA public OWNER TO ${scratch.owner}`);
  } finally {
    await scratchAdmin.end();
  }
  return scratch;
}

async function dropScratch(admin: Client, scratch: Scratch): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${scratch.database} WITH (FORCE)`);
  for (const role of [scratch.owner, ...Object.values(scratch.roles), ...scratch.extraRoles]) {
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
  }
}

async function connectOwner(scratch: Scratch): Promise<Client> {
  const client = new Client({
    connectionString: urlFor(scratch.database, scratch.owner, scratch.ownerPassword),
  });
  await client.connect();
  return client;
}

async function connectScratchAdmin(scratch: Scratch): Promise<Client> {
  const client = new Client({ connectionString: urlFor(scratch.database) });
  await client.connect();
  return client;
}

async function applyMigrations(
  scratch: Scratch,
  files: readonly { file: string; sql: string }[],
): Promise<void> {
  const owner = await connectOwner(scratch);
  try {
    for (const { sql } of files) await owner.query(substituted(sql, scratch.roles));
  } finally {
    await owner.end();
  }
}

async function apply0019AsOwner(scratch: Scratch): Promise<void> {
  if (!FILE_0019) throw new Error(`${MIGRATION_0019} not found`);
  const owner = await connectOwner(scratch);
  try {
    await owner.query(substituted(FILE_0019.sql, scratch.roles));
  } finally {
    await owner.end();
  }
}

interface Fixtures {
  clinicA: string;
  clinicB: string;
  staffEmailA: string;
  sessionTokenHashA: string;
  pendingInvitationTokenA: string;
}

/** Two clinics, each with one staff member, one session and one invitation. */
async function insertFixtures(scratch: Scratch): Promise<Fixtures> {
  const clinicA = randomUUID();
  const clinicB = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const fixtures: Fixtures = {
    clinicA,
    clinicB,
    staffEmailA: `staff-a-${tag}@example.test`,
    sessionTokenHashA: sha256Hex(`session-a-${tag}`),
    pendingInvitationTokenA: sha256Hex(`invitation-a-${tag}`),
  };
  const owner = await connectOwner(scratch);
  try {
    for (const [clinicId, label] of [
      [clinicA, 'a'],
      [clinicB, 'b'],
    ] as const) {
      await owner.query(
        `INSERT INTO clinics (id, name, owner_email, contact_email, timezone)
         VALUES ($1, $2, 'owner@example.test', 'owner@example.test', 'UTC')`,
        [clinicId, `No-inherit clinic ${label}`],
      );
      const staffId = randomUUID();
      await owner.query('BEGIN');
      await owner.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicId]);
      await owner.query(
        `INSERT INTO staff_members (id, clinic_id, email, password_hash, role, status)
         VALUES ($1, $2, $3, 'irrelevant-hash', 'owner', 'active')`,
        [staffId, clinicId, `staff-${label}-${tag}@example.test`],
      );
      await owner.query(
        `INSERT INTO staff_sessions (staff_member_id, clinic_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [staffId, clinicId, sha256Hex(`session-${label}-${tag}`)],
      );
      await owner.query(
        `INSERT INTO invitations (clinic_id, email, role, token_hash, invited_by)
         VALUES ($1, $2, 'receptionist', $3, $4)`,
        [
          clinicId,
          `invitee-${label}-${tag}@example.test`,
          sha256Hex(`invitation-${label}-${tag}`),
          staffId,
        ],
      );
      await owner.query('COMMIT');
    }
  } finally {
    await owner.end();
  }
  return fixtures;
}

type Counts = Record<'staff_members' | 'staff_sessions' | 'invitations', number>;

/** Rows the owner role can see in each table, under one clinic's context or none. */
async function visibleCounts(scratch: Scratch, clinicId: string | null): Promise<Counts> {
  const owner = await connectOwner(scratch);
  try {
    await owner.query('BEGIN');
    if (clinicId !== null) {
      await owner.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicId]);
    }
    const counts = {} as Counts;
    for (const table of ['staff_members', 'staff_sessions', 'invitations'] as const) {
      const { rows } = await owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      counts[table] = rows[0]!.n;
    }
    await owner.query('ROLLBACK');
    return counts;
  } finally {
    await owner.end();
  }
}

type ClinicIds = Record<'staff_members' | 'staff_sessions' | 'invitations', string[]>;

/** The clinic_id of every row the owner role can see, per table, under one context or none. */
async function visibleClinicIds(scratch: Scratch, clinicId: string | null): Promise<ClinicIds> {
  const owner = await connectOwner(scratch);
  try {
    await owner.query('BEGIN');
    if (clinicId !== null) {
      await owner.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicId]);
    }
    const ids = {} as ClinicIds;
    for (const table of ['staff_members', 'staff_sessions', 'invitations'] as const) {
      const { rows } = await owner.query<{ clinic_id: string }>(
        `SELECT clinic_id FROM ${table} ORDER BY clinic_id`,
      );
      ids[table] = rows.map((row) => row.clinic_id);
    }
    await owner.query('ROLLBACK');
    return ids;
  } finally {
    await owner.end();
  }
}

interface FunctionState {
  signature: string;
  owner: string;
  security_definer: boolean;
  config: string[] | null;
  source_md5: string;
  acl: string | null;
}

async function functionStates(scratch: Scratch): Promise<FunctionState[]> {
  const admin = await connectScratchAdmin(scratch);
  try {
    const states: FunctionState[] = [];
    for (const { signature } of SECDEF_FUNCTIONS) {
      const { rows } = await admin.query<FunctionState>(
        `SELECT $1::text AS signature, pg_get_userbyid(p.proowner)::text AS owner,
                p.prosecdef AS security_definer, p.proconfig AS config,
                md5(p.prosrc) AS source_md5, p.proacl::text AS acl
           FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [signature],
      );
      states.push(rows[0]!);
    }
    return states;
  } finally {
    await admin.end();
  }
}

interface MembershipRow {
  role: string;
  member: string;
  grantor: string;
  admin: boolean;
  inherit: boolean;
  set: boolean;
}

const rowKey = (row: MembershipRow): string => `${row.role}|${row.member}|${row.grantor}`;

/** Every membership row in the three function-owner roles, for any member and any grantor. */
async function membershipRows(scratch: Scratch): Promise<MembershipRow[]> {
  const admin = await connectScratchAdmin(scratch);
  try {
    const { rows } = await admin.query<MembershipRow>(
      `SELECT r.rolname::text AS role, mb.rolname::text AS member, g.rolname::text AS grantor,
              m.admin_option AS admin, m.inherit_option AS inherit, m.set_option AS set
         FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.roleid
         JOIN pg_roles mb ON mb.oid = m.member
         JOIN pg_roles g ON g.oid = m.grantor
        WHERE r.rolname = ANY($1)
        ORDER BY 1, 2, 3`,
      [
        [
          scratch.roles.authBootstrap,
          scratch.roles.clinicSettingsWriter,
          scratch.roles.invitationAcceptor,
        ],
      ],
    );
    return rows;
  } finally {
    await admin.end();
  }
}

describe('migration 0019: owner role keeps SET, loses INHERIT (ADR-0025)', () => {
  let admin: Client | undefined;
  let scratch: Scratch | undefined;

  afterEach(async () => {
    if (admin && scratch) await dropScratch(admin, scratch);
    await admin?.end();
    admin = undefined;
    scratch = undefined;
  });

  async function setUp(): Promise<Scratch> {
    admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    scratch = await createScratch(admin);
    return scratch;
  }

  it('closes the cross-clinic read: before 0019 the owner role sees every clinic, after it only the context clinic', async () => {
    const s = await setUp();
    await applyMigrations(s, BEFORE_0019);
    const f = await insertFixtures(s);

    // Precondition (proves this test can fail): through inherited role-scoped policies the owner
    // role sees both clinics' rows even inside clinic A's context, and with no context at all.
    const all: Counts = { staff_members: 2, staff_sessions: 2, invitations: 2 };
    expect(await visibleCounts(s, f.clinicA)).toEqual(all);
    expect(await visibleCounts(s, null)).toEqual(all);

    await apply0019AsOwner(s);

    const one: Counts = { staff_members: 1, staff_sessions: 1, invitations: 1 };
    expect(await visibleCounts(s, f.clinicA)).toEqual(one);
    expect(await visibleCounts(s, f.clinicB)).toEqual(one);
    expect(await visibleCounts(s, null)).toEqual({
      staff_members: 0,
      staff_sessions: 0,
      invitations: 0,
    });

    // Identity, not only counts: each context sees exactly its own clinic's rows, in every table.
    const only = (clinicId: string): ClinicIds => ({
      staff_members: [clinicId],
      staff_sessions: [clinicId],
      invitations: [clinicId],
    });
    expect(await visibleClinicIds(s, f.clinicA)).toEqual(only(f.clinicA));
    expect(await visibleClinicIds(s, f.clinicB)).toEqual(only(f.clinicB));
    expect(await visibleClinicIds(s, null)).toEqual({
      staff_members: [],
      staff_sessions: [],
      invitations: [],
    });
  });

  it('leaves INHERIT off and SET on for all three roles, directly and effectively', async () => {
    const s = await setUp();
    await applyMigrations(s, MIGRATION_FILES);

    const owner = await connectOwner(s);
    try {
      for (const role of [
        s.roles.authBootstrap,
        s.roles.clinicSettingsWriter,
        s.roles.invitationAcceptor,
      ]) {
        const { rows } = await owner.query<{ usage: boolean; set: boolean; member: boolean }>(
          `SELECT pg_has_role(current_user, $1, 'USAGE') AS usage,
                  pg_has_role(current_user, $1, 'SET') AS set,
                  pg_has_role(current_user, $1, 'MEMBER') AS member`,
          [role],
        );
        expect(rows[0], role).toEqual({ usage: false, set: true, member: true });

        const direct = await owner.query<{ inherit_option: boolean }>(
          `SELECT m.inherit_option FROM pg_auth_members m
            WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
              AND m.roleid = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
          [role],
        );
        expect(direct.rows.length, role).toBeGreaterThan(0);
        expect(
          direct.rows.every((row) => row.inherit_option === false),
          role,
        ).toBe(true);
      }
    } finally {
      await owner.end();
    }
  });

  it('changes exactly the migrating role’s own three membership rows, and no other role’s', async () => {
    const s = await setUp();
    await applyMigrations(s, BEFORE_0019);
    const before = await membershipRows(s);
    await apply0019AsOwner(s);
    const after = await membershipRows(s);

    // Same set of rows (nothing added or removed), only the inherit flag of some rows changed.
    expect(after.map(rowKey)).toEqual(before.map(rowKey));
    const changedIndexes = after.flatMap((row, i) =>
      row.inherit !== before[i]!.inherit ? [i] : [],
    );
    // Every changed row went from inheriting to not inheriting, never the other way.
    expect(changedIndexes.every((i) => before[i]!.inherit === true)).toBe(true);
    const changed = changedIndexes.map((i) => after[i]!);
    expect(changed).toEqual(
      [s.roles.authBootstrap, s.roles.clinicSettingsWriter, s.roles.invitationAcceptor]
        .sort()
        .map((role) => ({
          role,
          member: s.owner,
          grantor: s.owner,
          admin: false,
          inherit: false,
          set: true,
        })),
    );
    // The superuser the test harness connects as never became a member of these roles here.
    const adminUser = (await admin!.query<{ u: string }>('SELECT current_user AS u')).rows[0]!.u;
    expect(after.some((row) => row.member === adminUser)).toBe(false);
  });

  it('as a superuser: the guard is skipped, and the grants still land on that superuser only', async () => {
    const s = await setUp();
    // Run the whole chain as the superuser the harness connects as (the CI shape).
    const su = await connectScratchAdmin(s);
    try {
      const { rows } = await su.query<{ u: string; is_super: boolean }>(
        'SELECT current_user AS u, rolsuper AS is_super FROM pg_roles WHERE rolname = current_user',
      );
      expect(rows[0]!.is_super).toBe(true);
      const suName = rows[0]!.u;
      for (const { sql } of BEFORE_0019) await su.query(substituted(sql, s.roles));
      await expect(
        su.query(substituted(FILE_0019!.sql, s.roles)),
        'guard must not fail for a superuser',
      ).resolves.toBeDefined();

      const after = await membershipRows(s);
      const forSuperuser = after.filter((row) => row.member === suName);
      expect(forSuperuser).toHaveLength(3);
      expect(forSuperuser.every((row) => !row.inherit && row.set)).toBe(true);
      // CURRENT_USER is the executing role, not a fixed name: the non-superuser owner role of
      // this database got no membership at all from a superuser-run chain.
      expect(after.some((row) => row.member === s.owner)).toBe(false);
    } finally {
      await su.end();
    }
  });

  it('fails closed, leaving nothing changed, when another grantor still grants inheritance', async () => {
    const s = await setUp();
    await applyMigrations(s, BEFORE_0019);

    // A second, inheriting membership row from a grantor other than the owner role itself (here
    // the bootstrap superuser, which the owner role's own GRANT in 0019 cannot change).
    const scratchAdmin = await connectScratchAdmin(s);
    try {
      await scratchAdmin.query(
        `GRANT ${s.roles.invitationAcceptor} TO ${s.owner} WITH INHERIT TRUE`,
      );
      const { rows } = await scratchAdmin.query<{ inheriting_grantors: number }>(
        `SELECT count(DISTINCT grantor)::int AS inheriting_grantors FROM pg_auth_members
          WHERE member = $1::regrole AND roleid = $2::regrole AND inherit_option`,
        [s.owner, s.roles.invitationAcceptor],
      );
      expect(rows[0]!.inheriting_grantors).toBe(2);
    } finally {
      await scratchAdmin.end();
    }

    await expect(apply0019AsOwner(s)).rejects.toThrow(/still inherits .* granted by/);

    // The whole file ran as one implicit transaction: the owner role's own row is untouched too.
    const check = await connectScratchAdmin(s);
    try {
      const { rows } = await check.query<{ inherit_option: boolean }>(
        `SELECT inherit_option FROM pg_auth_members
          WHERE member = $1::regrole AND roleid = $2::regrole AND grantor = $1::regrole`,
        [s.owner, s.roles.authBootstrap],
      );
      expect(rows).toEqual([{ inherit_option: true }]);
    } finally {
      await check.end();
    }
  });

  it('fails closed when inheritance reaches a role indirectly through an intermediate role', async () => {
    const s = await setUp();
    await applyMigrations(s, BEFORE_0019);

    const intermediate = `${s.roles.authBootstrap}_via`;
    s.extraRoles.push(intermediate);
    const scratchAdmin = await connectScratchAdmin(s);
    try {
      await scratchAdmin.query(`CREATE ROLE ${intermediate} NOLOGIN`);
      await scratchAdmin.query(
        `GRANT ${s.roles.authBootstrap} TO ${intermediate} WITH INHERIT TRUE`,
      );
      await scratchAdmin.query(`GRANT ${intermediate} TO ${s.owner} WITH INHERIT TRUE`);
    } finally {
      await scratchAdmin.end();
    }

    await expect(apply0019AsOwner(s)).rejects.toThrow(
      /still has inherited access to .* through another role membership/,
    );
  });

  it('keeps the four SECURITY DEFINER functions identical and working', async () => {
    const s = await setUp();
    await applyMigrations(s, BEFORE_0019);
    const before = await functionStates(s);
    await apply0019AsOwner(s);
    const after = await functionStates(s);
    expect(after).toEqual(before);
    expect(after.map((state) => state.owner)).toEqual(
      SECDEF_FUNCTIONS.map(({ ownerKey }) => s.roles[ownerKey]),
    );
    expect(after.every((state) => state.security_definer)).toBe(true);
    expect(
      after.every((state) => state.config?.includes('search_path=pg_catalog, public, pg_temp')),
    ).toBe(true);

    const f = await insertFixtures(s);
    const appUserPassword = `pw_${randomUUID().replace(/-/g, '_')}`;
    await admin!.query(`ALTER ROLE ${s.roles.appUser} WITH PASSWORD '${appUserPassword}'`);
    const app = new Client({
      connectionString: urlFor(s.database, s.roles.appUser, appUserPassword),
    });
    await app.connect();
    try {
      const byEmail = await app.query('SELECT * FROM auth_lookup_staff_by_email($1)', [
        f.staffEmailA,
      ]);
      expect(byEmail.rows).toHaveLength(1);
      expect(byEmail.rows[0].clinic_id).toBe(f.clinicA);

      const bySession = await app.query('SELECT * FROM auth_lookup_session_by_token_hash($1)', [
        f.sessionTokenHashA,
      ]);
      expect(bySession.rows).toHaveLength(1);

      await app.query('BEGIN');
      await app.query("SELECT set_config('app.current_clinic_id', $1, true)", [f.clinicA]);
      await app.query('SELECT set_clinic_settings($1::jsonb, $2)', [
        JSON.stringify({ monday: { start: '09:00', end: '17:00' } }),
        'Europe/Athens',
      ]);
      await app.query('COMMIT');

      const accepted = await app.query<{ outcome: string; clinic_id: string }>(
        'SELECT outcome, clinic_id FROM accept_invitation($1, $2)',
        [f.pendingInvitationTokenA, '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA'],
      );
      expect(accepted.rows).toEqual([{ outcome: 'accepted', clinic_id: f.clinicA }]);
    } finally {
      await app.end();
    }

    const check = await connectScratchAdmin(s);
    try {
      const { rows } = await check.query('SELECT timezone FROM clinics WHERE id = $1', [f.clinicA]);
      expect(rows).toEqual([{ timezone: 'Europe/Athens' }]);
    } finally {
      await check.end();
    }
  });

  it('enforces the ADR-0025 convention: replacing a function needs SET ROLE to its owner', async () => {
    const s = await setUp();
    await applyMigrations(s, MIGRATION_FILES);
    const before = await functionStates(s);

    const owner = await connectOwner(s);
    try {
      for (const { signature, ownerKey } of SECDEF_FUNCTIONS) {
        const { rows } = await owner.query<{ def: string }>(
          'SELECT pg_get_functiondef($1::regprocedure) AS def',
          [signature],
        );
        const definition = rows[0]!.def;

        // Without SET ROLE the migrating role is no longer treated as the owner.
        await expect(owner.query(definition), signature).rejects.toThrow(
          /must be owner of function/,
        );

        // The convention: switch to the owning role for the replacement only.
        await owner.query('BEGIN');
        await owner.query(`SET LOCAL ROLE ${s.roles[ownerKey]}`);
        await owner.query(definition);
        await owner.query('COMMIT');
        const who = await owner.query<{ current_user: string }>('SELECT current_user');
        expect(who.rows[0]!.current_user, signature).toBe(s.owner);
      }

      // A failure while switched still returns the session to the migrating role.
      await owner.query('BEGIN');
      await owner.query(`SET LOCAL ROLE ${s.roles.authBootstrap}`);
      await expect(owner.query('SELECT 1 / 0')).rejects.toThrow(/division by zero/);
      await owner.query('ROLLBACK');
      const who = await owner.query<{ current_user: string }>('SELECT current_user');
      expect(who.rows[0]!.current_user).toBe(s.owner);
    } finally {
      await owner.end();
    }

    // Owners, EXECUTE grants, search_path and bodies are exactly as before the replacements.
    expect(await functionStates(s)).toEqual(before);
  });

  it('the ADR-0025 file pattern works inside the real runner shape; leaving the role switched does not', async () => {
    const s = await setUp();
    await applyMigrations(s, MIGRATION_FILES);
    const before = await functionStates(s);

    const owner = await connectOwner(s);
    try {
      // Stand-in for schema_migrations: a table only the migrating role can write.
      await owner.query('CREATE TABLE runner_log (id text PRIMARY KEY)');
      const { rows } = await owner.query<{ def: string }>(
        'SELECT pg_get_functiondef($1::regprocedure) AS def',
        ['auth_lookup_staff_by_email(text)'],
      );
      const definition = rows[0]!.def;

      // Exactly what scripts/migrate.ts does per file: BEGIN, the file as one query, then the
      // schema_migrations INSERT in the same transaction, then COMMIT (ROLLBACK on error).
      const runLikeMigrateTs = async (id: string, fileSql: string): Promise<void> => {
        await owner.query('BEGIN');
        try {
          await owner.query(fileSql);
          await owner.query('INSERT INTO runner_log (id) VALUES ($1)', [id]);
          await owner.query('COMMIT');
        } catch (err) {
          await owner.query('ROLLBACK');
          throw err;
        }
      };

      // 1. Switch left active until the runner's COMMIT: the runner's own bookkeeping INSERT then
      //    runs as the function-owner role and is refused, so the whole migration rolls back.
      await expect(
        runLikeMigrateTs(
          'left-switched',
          `SET LOCAL ROLE ${s.roles.authBootstrap};\n${definition};`,
        ),
      ).rejects.toThrow(/permission denied for table runner_log/);

      // 2. ADR-0025 decision 3: record the executing role, switch, replace, restore that exact
      //    role (not RESET ROLE, which returns to the session role).
      await runLikeMigrateTs(
        'adr-0025-pattern',
        `SELECT pg_catalog.set_config('migration.previous_role', current_user, true);
         SET LOCAL ROLE ${s.roles.authBootstrap};
         ${definition};
         DO $restore$
         BEGIN
           EXECUTE pg_catalog.format('SET LOCAL ROLE %I',
             pg_catalog.current_setting('migration.previous_role'));
         END
         $restore$;`,
      );

      const log = await owner.query<{ id: string }>('SELECT id FROM runner_log ORDER BY id');
      expect(log.rows).toEqual([{ id: 'adr-0025-pattern' }]);
      const who = await owner.query<{ current_user: string }>('SELECT current_user');
      expect(who.rows[0]!.current_user).toBe(s.owner);
    } finally {
      await owner.end();
    }
    expect(await functionStates(s)).toEqual(before);
  });
});
