import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Client } from 'pg';
import { getDatabaseUrl, getSeedStaffPassword } from '@/lib/env';
import { closePool } from '@/lib/db';
import { signIn, hashPassword } from '@/features/auth';
import {
  DEMO_CLINIC_ID,
  DEMO_CLINIC_NAME,
  DEMO_STAFF_ID,
  DEMO_STAFF_EMAIL,
  DEMO_STAFF_ROLE,
  assertNotProductionWithoutForce,
  seedDemoData,
} from '../../scripts/seed';

/**
 * Coverage for scripts/seed.ts's deployment-validation seed: refuses
 * production without an explicit force, is idempotent, never stores the
 * demo password in the clear, and produces exactly one demo clinic and one
 * demo staff identity. Runs against a real Postgres instance via
 * DATABASE_URL — the same owner/migration connection the script itself
 * uses — per docs/technical/02-tenant-isolation-testing.md's "RLS cannot be
 * meaningfully faked" precondition: staff_members carries FORCE ROW LEVEL
 * SECURITY even for this role (see seedDemoData's own comment), so reading
 * it back here needs the same set_config dance the seed itself performs.
 */
describe('scripts/seed.ts: production guard', () => {
  it('refuses to run against NEXT_PUBLIC_APP_ENV=production with no force flag', () => {
    expect(() => assertNotProductionWithoutForce('production', false)).toThrow(/SEED_FORCE/);
  });

  it('runs when forced, even in production', () => {
    expect(() => assertNotProductionWithoutForce('production', true)).not.toThrow();
  });

  it('runs unforced outside production', () => {
    expect(() => assertNotProductionWithoutForce('development', false)).not.toThrow();
    expect(() => assertNotProductionWithoutForce('staging', false)).not.toThrow();
  });
});

/**
 * BLOCKER B1 (PR #40 review): SEED_STAFF_PASSWORD mints a real credential
 * for an account whose identity is public in this repository, so its
 * strength must be enforced before scripts/seed.ts ever opens a database
 * connection -- see getSeedStaffPassword's own comment in src/lib/env.ts.
 */
describe('scripts/seed.ts: SEED_STAFF_PASSWORD minimum length (src/lib/env.ts)', () => {
  const ORIGINAL_VALUE = process.env.SEED_STAFF_PASSWORD;

  afterEach(() => {
    if (ORIGINAL_VALUE === undefined) {
      delete process.env.SEED_STAFF_PASSWORD;
    } else {
      process.env.SEED_STAFF_PASSWORD = ORIGINAL_VALUE;
    }
  });

  it('rejects a password shorter than 12 characters, without revealing it', () => {
    process.env.SEED_STAFF_PASSWORD = 'short1';
    let caught: Error | undefined;
    try {
      getSeedStaffPassword();
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toMatch(/at least 12 characters/);
    expect(caught?.message).not.toContain('short1');
  });

  it('rejects an empty password the same way as before (unchanged behavior)', () => {
    delete process.env.SEED_STAFF_PASSWORD;
    expect(() => getSeedStaffPassword()).toThrow(/Missing required environment variable/);
  });

  it('accepts a password at or above the minimum length', () => {
    process.env.SEED_STAFF_PASSWORD = 'exactly-twelve-chars-or-more';
    expect(getSeedStaffPassword()).toBe('exactly-twelve-chars-or-more');
  });
});

describe('scripts/seed.ts: seedDemoData', () => {
  let client: Client;

  beforeEach(async () => {
    client = new Client({ connectionString: getDatabaseUrl() });
    await client.connect();
  });

  afterEach(async () => {
    await client.end();
  });

  afterAll(async () => {
    await closePool();
  });

  it('produces exactly one demo clinic and one demo staff row, with the password hashed, never plaintext', async () => {
    const password = `SeedTestPassword-${randomUUID()}`;
    const passwordHash = await hashPassword(password);

    const result = await seedDemoData(client, passwordHash);

    expect(result).toEqual({
      clinicId: DEMO_CLINIC_ID,
      staffId: DEMO_STAFF_ID,
      staffEmail: DEMO_STAFF_EMAIL,
    });

    const clinicRows = await client.query('SELECT id, name FROM clinics WHERE id = $1', [
      DEMO_CLINIC_ID,
    ]);
    expect(clinicRows.rows).toHaveLength(1);
    expect(clinicRows.rows[0]).toMatchObject({ id: DEMO_CLINIC_ID, name: DEMO_CLINIC_NAME });

    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [DEMO_CLINIC_ID]);
    const staffRows = await client.query(
      `SELECT id, clinic_id, email, role, password_hash FROM staff_members WHERE id = $1`,
      [DEMO_STAFF_ID],
    );
    await client.query('COMMIT');

    expect(staffRows.rows).toHaveLength(1);
    const staffRow = staffRows.rows[0];
    expect(staffRow.email).toBe(DEMO_STAFF_EMAIL);
    expect(staffRow.role).toBe(DEMO_STAFF_ROLE);
    expect(staffRow.password_hash).toMatch(/^\$argon2id\$/);
    expect(staffRow.password_hash).not.toBe(password);
    expect(staffRow.password_hash).not.toContain(password);

    // Not merely well-formed — genuinely usable to sign in as this account.
    const signInResult = await signIn(DEMO_STAFF_EMAIL, password);
    expect(signInResult.clinicId).toBe(DEMO_CLINIC_ID);
    expect(signInResult.staffId).toBe(DEMO_STAFF_ID);
  });

  it('running the seed twice does not create duplicate rows and converges to the latest password', async () => {
    const passwordA = `SeedTestPasswordA-${randomUUID()}`;
    const passwordB = `SeedTestPasswordB-${randomUUID()}`;

    await seedDemoData(client, await hashPassword(passwordA));
    await seedDemoData(client, await hashPassword(passwordB));

    const clinicCount = await client.query('SELECT count(*)::int AS n FROM clinics WHERE id = $1', [
      DEMO_CLINIC_ID,
    ]);
    expect(clinicCount.rows[0].n).toBe(1);

    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [DEMO_CLINIC_ID]);
    const staffCount = await client.query(
      'SELECT count(*)::int AS n FROM staff_members WHERE id = $1',
      [DEMO_STAFF_ID],
    );
    await client.query('COMMIT');
    expect(staffCount.rows[0].n).toBe(1);

    // The row converged to the second run's password — the first run's
    // password no longer works, it wasn't merely left alongside it.
    await expect(signIn(DEMO_STAFF_EMAIL, passwordA)).rejects.toThrow();
    const result = await signIn(DEMO_STAFF_EMAIL, passwordB);
    expect(result.staffId).toBe(DEMO_STAFF_ID);
  });
});

/**
 * IMPORTANT I3 (PR #40 review): proves the transaction in seedDemoData is
 * genuinely atomic when the staff INSERT fails for a reason ON CONFLICT
 * (id) cannot catch -- a *different* id already owns DEMO_STAFF_EMAIL,
 * which only staff_members_email_key (a separate, globally-unique
 * constraint per ADR-0012 Decision 1) can reject.
 */
describe('scripts/seed.ts: seedDemoData rolls back atomically on failure', () => {
  let client: Client;

  beforeEach(async () => {
    client = new Client({ connectionString: getDatabaseUrl() });
    await client.connect();
  });

  afterEach(async () => {
    await client.end();
  });

  afterAll(async () => {
    await closePool();
  });

  it('leaves no partial data when the staff insert collides on the globally-unique email', async () => {
    // Start from a clean slate for the canonical demo ids specifically, so
    // "the clinic was not left behind" below is a meaningful assertion
    // rather than trivially true because it already existed. staff_sessions
    // has no ON DELETE CASCADE (db/migrations/0006_staff_sessions.sql) --
    // its rows (from earlier signIn() calls in this file) must go first.
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [DEMO_CLINIC_ID]);
    await client.query('DELETE FROM staff_sessions WHERE staff_member_id = $1', [DEMO_STAFF_ID]);
    await client.query('DELETE FROM staff_members WHERE id = $1', [DEMO_STAFF_ID]);
    await client.query('COMMIT');
    await client.query('DELETE FROM clinics WHERE id = $1', [DEMO_CLINIC_ID]);

    // A throwaway clinic hosts the colliding row, kept separate from
    // DEMO_CLINIC_ID so deleting the canonical clinic above stays
    // meaningful for the assertion below.
    const collidingClinicId = randomUUID();
    const collidingStaffId = randomUUID();
    const collidingPasswordHash = await hashPassword(`CollidingPassword-${randomUUID()}`);
    await client.query(
      `INSERT INTO clinics (id, name, contact_email, owner_email, status)
       VALUES ($1, 'Collision Test Clinic', $2, $2, 'active')`,
      [collidingClinicId, `collision-${collidingClinicId}@example.test`],
    );
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [collidingClinicId]);
    await client.query(
      `INSERT INTO staff_members (id, clinic_id, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, 'receptionist', 'active')`,
      [collidingStaffId, collidingClinicId, DEMO_STAFF_EMAIL, collidingPasswordHash],
    );
    await client.query('COMMIT');

    // The scenario under test: seedDemoData tries to insert DEMO_STAFF_ID
    // with DEMO_STAFF_EMAIL, which the row above already owns under a
    // different id -- ON CONFLICT (id) cannot catch this, since no existing
    // row has id = DEMO_STAFF_ID to conflict on; it fails as an ordinary
    // unique-constraint violation instead, inside the same transaction that
    // already upserted the clinic.
    await expect(
      seedDemoData(client, await hashPassword(`WouldBeSeedPassword-${randomUUID()}`)),
    ).rejects.toThrow(/staff_members_email_key|duplicate key/i);

    // The demo clinic must not have been left behind by the (rolled-back)
    // clinic upsert that ran earlier in the same failed transaction.
    const clinicRows = await client.query('SELECT id FROM clinics WHERE id = $1', [DEMO_CLINIC_ID]);
    expect(clinicRows.rows).toHaveLength(0);

    // Nor was the demo staff row created.
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [DEMO_CLINIC_ID]);
    const staffRows = await client.query('SELECT id FROM staff_members WHERE id = $1', [
      DEMO_STAFF_ID,
    ]);
    await client.query('COMMIT');
    expect(staffRows.rows).toHaveLength(0);

    // The pre-existing colliding row is untouched -- still present, same
    // clinic, same email, same password hash.
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [collidingClinicId]);
    const collidingRows = await client.query(
      'SELECT id, clinic_id, email, password_hash FROM staff_members WHERE id = $1',
      [collidingStaffId],
    );
    await client.query('COMMIT');
    expect(collidingRows.rows).toHaveLength(1);
    expect(collidingRows.rows[0]).toMatchObject({
      id: collidingStaffId,
      clinic_id: collidingClinicId,
      email: DEMO_STAFF_EMAIL,
      password_hash: collidingPasswordHash,
    });

    // Cleanup + restore: remove the throwaway collision fixture and put the
    // canonical demo rows back, so later tests and manual runs against this
    // shared database see the normal seeded state again.
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [collidingClinicId]);
    await client.query('DELETE FROM staff_members WHERE id = $1', [collidingStaffId]);
    await client.query('COMMIT');
    await client.query('DELETE FROM clinics WHERE id = $1', [collidingClinicId]);

    await seedDemoData(client, await hashPassword(`RestoredSeedPassword-${randomUUID()}`));
  });
});

/**
 * IMPORTANT I2 (PR #40 review): exercises the real `tsx scripts/seed.ts`
 * process and its src/lib/env.ts wiring end to end -- not just the pure
 * assertNotProductionWithoutForce function -- so a future change that
 * breaks how main() wires env.appEnv/isSeedForceEnabled() into that guard
 * would fail here even though the unit tests above would still pass.
 */
const REPO_ROOT = process.cwd();
const SEED_SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'seed.ts');
const TSX_BIN_PATH = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

interface SeedCliResult {
  status: number;
  output: string;
}

/** Runs the real CLI as a subprocess -- no shell involved, so no platform-specific quoting. */
function runSeedCli(envOverrides: Record<string, string>): SeedCliResult {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.SEED_FORCE;
  Object.assign(childEnv, envOverrides);

  try {
    const output = execFileSync(TSX_BIN_PATH, [SEED_SCRIPT_PATH], {
      cwd: REPO_ROOT,
      env: childEnv,
      encoding: 'utf8',
      timeout: 15_000,
    });
    return { status: 0, output };
  } catch (err) {
    const failure = err as { status?: number | null; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

async function snapshotDemoRows(
  client: Client,
): Promise<{ clinicRowCount: number; staffPasswordHash: string | null }> {
  const clinicResult = await client.query('SELECT count(*)::int AS n FROM clinics WHERE id = $1', [
    DEMO_CLINIC_ID,
  ]);
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [DEMO_CLINIC_ID]);
  const staffResult = await client.query('SELECT password_hash FROM staff_members WHERE id = $1', [
    DEMO_STAFF_ID,
  ]);
  await client.query('COMMIT');
  return {
    clinicRowCount: clinicResult.rows[0].n,
    staffPasswordHash: staffResult.rows[0]?.password_hash ?? null,
  };
}

describe('scripts/seed.ts: CLI entry point (main())', () => {
  let client: Client;

  beforeEach(async () => {
    client = new Client({ connectionString: getDatabaseUrl() });
    await client.connect();
  });

  afterEach(async () => {
    await client.end();
  });

  afterAll(async () => {
    await closePool();
  });

  it('refuses via the real CLI in production with no SEED_FORCE, and writes nothing', async () => {
    const before = await snapshotDemoRows(client);

    const result = runSeedCli({
      NEXT_PUBLIC_APP_ENV: 'production',
      SEED_STAFF_PASSWORD: 'ValidLengthPasswordForThisTest',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/SEED_FORCE/);

    const after = await snapshotDemoRows(client);
    expect(after).toEqual(before);
  });

  it('runs via the real CLI when SEED_FORCE=true in production, and the demo rows are usable', async () => {
    const password = `CliForceTestPassword-${randomUUID()}`;

    const result = runSeedCli({
      NEXT_PUBLIC_APP_ENV: 'production',
      SEED_FORCE: 'true',
      SEED_STAFF_PASSWORD: password,
    });

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/Seed complete/);
    expect(result.output).not.toContain(password);

    // Not just "exit 0" -- the demo rows this run wrote are genuinely
    // usable via the real signIn() path.
    const signInResult = await signIn(DEMO_STAFF_EMAIL, password);
    expect(signInResult.clinicId).toBe(DEMO_CLINIC_ID);
    expect(signInResult.staffId).toBe(DEMO_STAFF_ID);
  });
});
