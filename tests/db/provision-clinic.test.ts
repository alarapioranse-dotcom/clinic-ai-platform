import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

import { closePool } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { signIn } from '@/features/auth';
import {
  acceptInvitation,
  buildInvitationLink,
  generateInvitationToken,
  hashInvitationToken,
} from '@/features/invitations';
import {
  ProvisioningError,
  assertEnvironmentAllowed,
  normalizeEmail,
  parseProvisionArgs,
  provisionClinic,
  reissueOwnerInvitation,
  staffEmailExistsInAnyClinic,
} from '../../scripts/provision-clinic';
import { DEMO_CLINIC_ID } from '../../scripts/seed';
import { createTestClinic, createTestStaffMember } from '../fixtures';

/**
 * scripts/provision-clinic.ts (ADR-0023 decision 1; Owner decisions P1–P6).
 * Most cases run on the CI owner connection. The last block runs the script's
 * logic as a genuinely non-superuser owner role on a scratch database, because
 * the CI connection is a superuser that bypasses Row Level Security and would
 * hide a cross-clinic email check that silently sees nothing in production.
 */

const APP_URL = 'https://clinic.example.test';
const PASSWORD = 'a long enough passphrase';

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function tokenFrom(link: string): string {
  const token = link.split('#')[1];
  if (!token) throw new Error('no token in link');
  return token;
}

async function invitationsFor(clinicId: string) {
  return withAdmin(async (admin) => {
    const { rows } = await admin.query<{
      email: string;
      role: string;
      status: string;
      token_hash: string;
      invited_by: string | null;
    }>(
      `SELECT email, role, status, token_hash, invited_by FROM invitations
       WHERE clinic_id = $1 ORDER BY created_at`,
      [clinicId],
    );
    return rows;
  });
}

async function clinicCountNamed(name: string): Promise<number> {
  return withAdmin(async (admin) => {
    const { rows } = await admin.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM clinics WHERE name = $1',
      [name],
    );
    return Number(rows[0]!.n);
  });
}

function createArgs(overrides: Record<string, string> = {}): string[] {
  const values: Record<string, string> = {
    '--name': 'Argument Clinic',
    '--owner-email': 'Owner@Example.test',
    '--timezone': 'Europe/Athens',
    '--contact-phone': '+30 2310 000000',
    ...overrides,
  };
  return Object.entries(values).flatMap(([flag, value]) => (value === '' ? [] : [flag, value]));
}

afterAll(async () => {
  await closePool();
});

describe('invitation token helpers', () => {
  it('generates 43-character base64url tokens, all different', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateInvitationToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('builds /invite#<token> links, tolerating a trailing slash', () => {
    expect(buildInvitationLink('https://a.example/', 'tok')).toBe('https://a.example/invite#tok');
    expect(buildInvitationLink('https://a.example', 'tok')).toBe('https://a.example/invite#tok');
  });
});

describe('parseProvisionArgs (P1)', () => {
  it('parses create mode and normalises emails (E1)', () => {
    const command = parseProvisionArgs([
      ...createArgs({ '--owner-email': '  Owner@Example.TEST ' }),
      '--contact-email',
      ' Info@Clinic.TEST',
    ]);
    expect(command).toEqual({
      mode: 'create',
      input: {
        name: 'Argument Clinic',
        ownerEmail: 'owner@example.test',
        timezone: 'Europe/Athens',
        contactEmail: 'info@clinic.test',
        contactPhone: '+30 2310 000000',
      },
      dryRun: false,
      confirmProduction: false,
    });
  });

  it('parses --dry-run and --confirm-production', () => {
    const command = parseProvisionArgs([...createArgs(), '--dry-run', '--confirm-production']);
    expect(command).toMatchObject({ dryRun: true, confirmProduction: true });
  });

  it('parses reissue mode', () => {
    const id = randomUUID();
    expect(parseProvisionArgs(['--reissue', '--clinic-id', id.toUpperCase()])).toEqual({
      mode: 'reissue',
      clinicId: id,
      dryRun: false,
      confirmProduction: false,
    });
  });

  it.each([
    ['a missing name', createArgs({ '--name': '' }), /--name/],
    ['a blank name', createArgs({ '--name': '   ' }), /--name/],
    ['a missing owner email', createArgs({ '--owner-email': '' }), /--owner-email/],
    ['an invalid owner email', createArgs({ '--owner-email': 'not-an-email' }), /--owner-email/],
    ['a missing timezone', createArgs({ '--timezone': '' }), /--timezone/],
    ['a fixed offset', createArgs({ '--timezone': '+02:00' }), /--timezone/],
    ['an unknown timezone', createArgs({ '--timezone': 'Mars/Base' }), /--timezone/],
    ['no contact channel', createArgs({ '--contact-phone': '' }), /contact/],
    ['an invalid contact email', [...createArgs(), '--contact-email', 'x'], /--contact-email/],
    ['an unknown flag', [...createArgs(), '--password', 'secret'], /password/],
    [
      'working hours (not accepted, P1)',
      [...createArgs(), '--working-hours', '{}'],
      /working-hours/,
    ],
    ['a positional argument', [...createArgs(), 'extra'], /extra|positional/i],
    ['--clinic-id without --reissue', [...createArgs(), '--clinic-id', randomUUID()], /--reissue/],
    ['--reissue without a clinic id', ['--reissue'], /--clinic-id/],
    ['--reissue with a malformed id', ['--reissue', '--clinic-id', 'abc'], /--clinic-id/],
    [
      '--reissue with create flags',
      ['--reissue', '--clinic-id', randomUUID(), '--name', 'X'],
      /--name/,
    ],
  ])('rejects %s', (_label, argv, pattern) => {
    expect(() => parseProvisionArgs(argv)).toThrow(ProvisioningError);
    expect(() => parseProvisionArgs(argv)).toThrow(pattern);
  });
});

describe('assertEnvironmentAllowed (P2)', () => {
  it('refuses production without --confirm-production', () => {
    expect(() => assertEnvironmentAllowed('production', 'https://a.example', false)).toThrow(
      /--confirm-production/,
    );
  });

  it('refuses production with a non-https app URL even when confirmed', () => {
    expect(() => assertEnvironmentAllowed('production', 'http://a.example', true)).toThrow(/https/);
  });

  it('allows confirmed production with https, and any non-production environment', () => {
    expect(() => assertEnvironmentAllowed('production', 'https://a.example', true)).not.toThrow();
    expect(() =>
      assertEnvironmentAllowed('development', 'http://localhost:3000', false),
    ).not.toThrow();
  });
});

describe('provisionClinic', () => {
  it('creates an active clinic and exactly one pending owner invitation, storing only the token hash', async () => {
    const ownerEmail = uniqueEmail('prov-owner');
    const name = `Provisioned ${randomUUID().slice(0, 8)}`;
    const result = await withAdmin((admin) =>
      provisionClinic(
        admin,
        {
          name,
          ownerEmail: ownerEmail.toUpperCase(),
          timezone: 'Europe/Athens',
          contactPhone: '1',
        },
        { appUrl: APP_URL, dryRun: false },
      ),
    );

    expect(result.link).toMatch(/^https:\/\/clinic\.example\.test\/invite#[A-Za-z0-9_-]{43}$/);
    const rawToken = tokenFrom(result.link!);

    const clinic = await withAdmin(async (admin) => {
      const { rows } = await admin.query(
        `SELECT name, status, owner_email, timezone, working_hours, contact_phone, contact_email
         FROM clinics WHERE id = $1`,
        [result.clinicId],
      );
      return rows[0];
    });
    expect(clinic).toEqual({
      name,
      status: 'active',
      owner_email: ownerEmail,
      timezone: 'Europe/Athens',
      working_hours: {},
      contact_phone: '1',
      contact_email: null,
    });

    const invitations = await invitationsFor(result.clinicId);
    expect(invitations).toEqual([
      {
        email: ownerEmail,
        role: 'owner',
        status: 'pending',
        token_hash: hashInvitationToken(rawToken),
        invited_by: null,
      },
    ]);
    expect(JSON.stringify(invitations)).not.toContain(rawToken);

    const staffCount = await withAdmin(async (admin) => {
      const { rows } = await admin.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM staff_members WHERE clinic_id = $1',
        [result.clinicId],
      );
      return Number(rows[0]!.n);
    });
    expect(staffCount).toBe(0);
    expect(result.expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * 3600 * 1000);
  });

  it('end to end: the printed link is accepted and the owner then signs in to that clinic only', async () => {
    const ownerEmail = uniqueEmail('prov-e2e');
    const result = await withAdmin((admin) =>
      provisionClinic(
        admin,
        { name: 'E2E Clinic', ownerEmail, timezone: 'UTC', contactEmail: uniqueEmail('contact') },
        { appUrl: APP_URL, dryRun: false },
      ),
    );
    expect(await acceptInvitation(tokenFrom(result.link!), PASSWORD)).toEqual({
      outcome: 'accepted',
    });
    const session = await signIn(ownerEmail, PASSWORD);
    expect(session).toMatchObject({ clinicId: result.clinicId, role: 'owner' });
  });

  it('a dry run validates everything and saves nothing (P6)', async () => {
    const name = `Dry Run ${randomUUID().slice(0, 8)}`;
    const result = await withAdmin((admin) =>
      provisionClinic(
        admin,
        { name, ownerEmail: uniqueEmail('dry'), timezone: 'UTC', contactPhone: '1' },
        { appUrl: APP_URL, dryRun: true },
      ),
    );
    expect(result.link).toBeNull();
    expect(await clinicCountNamed(name)).toBe(0);
    expect(await invitationsFor(result.clinicId)).toEqual([]);
  });

  it('is all-or-nothing: if the invitation insert fails, no clinic is left behind', async () => {
    const name = `Atomic ${randomUUID().slice(0, 8)}`;
    await withAdmin(async (admin) => {
      await admin.query(`
        CREATE FUNCTION test_fail_invitation_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'injected failure'; END; $$;
        CREATE TRIGGER test_fail_invitation_insert BEFORE INSERT ON invitations
          FOR EACH ROW EXECUTE FUNCTION test_fail_invitation_insert();`);
    });
    try {
      await expect(
        withAdmin((admin) =>
          provisionClinic(
            admin,
            { name, ownerEmail: uniqueEmail('atomic'), timezone: 'UTC', contactPhone: '1' },
            { appUrl: APP_URL, dryRun: false },
          ),
        ),
      ).rejects.toThrow(/injected failure/);
    } finally {
      await withAdmin((admin) =>
        admin.query(`
          DROP TRIGGER test_fail_invitation_insert ON invitations;
          DROP FUNCTION test_fail_invitation_insert();`),
      );
    }
    expect(await clinicCountNamed(name)).toBe(0);
  });

  it('refuses an owner email that already belongs to a staff member of another clinic, case-insensitively', async () => {
    const other = await createTestClinic('ProvTaken');
    const existing = await createTestStaffMember(other.id, 'prov-taken');
    const name = `Refused ${randomUUID().slice(0, 8)}`;
    await expect(
      withAdmin((admin) =>
        provisionClinic(
          admin,
          { name, ownerEmail: existing.email.toUpperCase(), timezone: 'UTC', contactPhone: '1' },
          { appUrl: APP_URL, dryRun: false },
        ),
      ),
    ).rejects.toThrow(/already belongs to a staff account/);
    expect(await clinicCountNamed(name)).toBe(0);
  });

  it('finds an existing staff email stored with uppercase letters', async () => {
    const other = await createTestClinic('ProvUpper');
    const mixedCase = `Mixed.Case-${randomUUID().slice(0, 8)}@Example.test`;
    await createTestStaffMember(other.id, 'prov-upper', { email: mixedCase });
    const found = await withAdmin(async (admin) => {
      await admin.query('BEGIN');
      try {
        return await staffEmailExistsInAnyClinic(admin, normalizeEmail(mixedCase));
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    expect(found).toBe(true);
  });

  it('refuses an owner email that is already another clinic’s owner email (P5)', async () => {
    const ownerEmail = uniqueEmail('prov-dup');
    await withAdmin((admin) =>
      provisionClinic(
        admin,
        { name: 'First', ownerEmail, timezone: 'UTC', contactPhone: '1' },
        { appUrl: APP_URL, dryRun: false },
      ),
    );
    const name = `Second ${randomUUID().slice(0, 8)}`;
    await expect(
      withAdmin((admin) =>
        provisionClinic(
          admin,
          { name, ownerEmail: ` ${ownerEmail.toUpperCase()}`, timezone: 'UTC', contactPhone: '1' },
          { appUrl: APP_URL, dryRun: false },
        ),
      ),
    ).rejects.toThrow(/already the owner email of another clinic/);
    expect(await clinicCountNamed(name)).toBe(0);
  });

  it('refuses a time zone PostgreSQL does not know, even if it reaches the function', async () => {
    await expect(
      withAdmin((admin) =>
        provisionClinic(
          admin,
          {
            name: 'Bad TZ',
            ownerEmail: uniqueEmail('tz'),
            timezone: 'Not/A_Zone',
            contactPhone: '1',
          },
          { appUrl: APP_URL, dryRun: false },
        ),
      ),
    ).rejects.toThrow(/does not recognise the time zone/);
  });
});

describe('reissueOwnerInvitation', () => {
  async function provision(): Promise<{ clinicId: string; link: string; ownerEmail: string }> {
    const ownerEmail = uniqueEmail('reissue');
    const result = await withAdmin((admin) =>
      provisionClinic(
        admin,
        { name: 'Reissue Clinic', ownerEmail, timezone: 'UTC', contactPhone: '1' },
        { appUrl: APP_URL, dryRun: false },
      ),
    );
    return { clinicId: result.clinicId, link: result.link!, ownerEmail };
  }

  it('expires the old owner invitation and issues a new one that works', async () => {
    const { clinicId, link: oldLink, ownerEmail } = await provision();
    const reissued = await withAdmin((admin) =>
      reissueOwnerInvitation(admin, clinicId, { appUrl: APP_URL, dryRun: false }),
    );
    expect(reissued.link).not.toBe(oldLink);
    expect((await invitationsFor(clinicId)).map((row) => row.status)).toEqual([
      'expired',
      'pending',
    ]);
    expect(await acceptInvitation(tokenFrom(oldLink), PASSWORD)).toEqual({ outcome: 'invalid' });
    expect(await acceptInvitation(tokenFrom(reissued.link!), PASSWORD)).toEqual({
      outcome: 'accepted',
    });
    expect((await signIn(ownerEmail, PASSWORD)).clinicId).toBe(clinicId);
  });

  it('reissues when the old invitation is past its expiry but still pending', async () => {
    const { clinicId } = await provision();
    await withAdmin(async (admin) => {
      await admin.query('ALTER TABLE invitations DISABLE TRIGGER invitations_guard_update');
      try {
        await admin.query(
          `UPDATE invitations SET created_at = now() - interval '80 hours',
                                  expires_at = now() - interval '8 hours'
           WHERE clinic_id = $1`,
          [clinicId],
        );
      } finally {
        await admin.query('ALTER TABLE invitations ENABLE TRIGGER invitations_guard_update');
      }
    });
    const reissued = await withAdmin((admin) =>
      reissueOwnerInvitation(admin, clinicId, { appUrl: APP_URL, dryRun: false }),
    );
    expect(await acceptInvitation(tokenFrom(reissued.link!), PASSWORD)).toEqual({
      outcome: 'accepted',
    });
  });

  it('refuses once the owner has accepted', async () => {
    const { clinicId, link } = await provision();
    await acceptInvitation(tokenFrom(link), PASSWORD);
    await expect(
      withAdmin((admin) =>
        reissueOwnerInvitation(admin, clinicId, { appUrl: APP_URL, dryRun: false }),
      ),
    ).rejects.toThrow(/already has an owner account/);
  });

  it('a dry run leaves the existing invitation pending and creates nothing', async () => {
    const { clinicId, link } = await provision();
    const result = await withAdmin((admin) =>
      reissueOwnerInvitation(admin, clinicId, { appUrl: APP_URL, dryRun: true }),
    );
    expect(result.link).toBeNull();
    expect((await invitationsFor(clinicId)).map((row) => row.status)).toEqual(['pending']);
    expect(await acceptInvitation(tokenFrom(link), PASSWORD)).toEqual({ outcome: 'accepted' });
  });

  it('refuses an unknown clinic id and the demo clinic', async () => {
    await expect(
      withAdmin((admin) =>
        reissueOwnerInvitation(admin, randomUUID(), { appUrl: APP_URL, dryRun: false }),
      ),
    ).rejects.toThrow(/No clinic has this id/);
    await expect(
      withAdmin((admin) =>
        reissueOwnerInvitation(admin, DEMO_CLINIC_ID, { appUrl: APP_URL, dryRun: false }),
      ),
    ).rejects.toThrow(/demo clinic/);
  });
});

/**
 * The production shape: an owner role with neither SUPERUSER nor BYPASSRLS
 * (like Render's), owning a scratch database migrated from scratch. FORCE
 * ROW LEVEL SECURITY applies to it, so this is the only place the
 * cross-clinic email check is proven against real RLS.
 */
describe('provisioning as a non-superuser owner role (FORCE RLS applies)', () => {
  const MIGRATIONS_DIR = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'db',
    'migrations',
  );
  let admin: Client | undefined;
  let scratch: { owner: string; database: string; roles: string[] } | undefined;

  afterEach(async () => {
    if (admin && scratch) {
      await admin.query(`DROP DATABASE IF EXISTS ${scratch.database} WITH (FORCE)`);
      for (const role of [scratch.owner, ...scratch.roles]) {
        await admin.query(`DROP ROLE IF EXISTS ${role}`);
      }
    }
    await admin?.end();
    admin = undefined;
    scratch = undefined;
  });

  it('sees other clinics’ staff only through per-clinic context, refuses a taken email, and provisions', async () => {
    const suffix = randomUUID().replace(/-/g, '_');
    const owner = `test_prov_owner_${suffix}`;
    const database = `test_prov_db_${suffix}`;
    const password = `pw_${suffix}`;
    const substitutions: [string, string][] = [
      ['app_user', `test_pau_${suffix}`],
      ['auth_bootstrap', `test_pab_${suffix}`],
      ['clinic_settings_writer', `test_pcs_${suffix}`],
      ['invitation_acceptor', `test_pia_${suffix}`],
    ];
    admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    scratch = { owner, database, roles: substitutions.map(([, to]) => to) };

    await admin.query(
      `CREATE ROLE ${owner} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS CREATEROLE`,
    );
    await admin.query(`CREATE DATABASE ${database} OWNER ${owner}`);
    const scratchUrl = new URL(getDatabaseUrl());
    scratchUrl.pathname = `/${database}`;
    const scratchAdmin = new Client({ connectionString: scratchUrl.toString() });
    await scratchAdmin.connect();
    await scratchAdmin.query(`ALTER SCHEMA public OWNER TO ${owner}`);
    await scratchAdmin.end();

    const ownerUrl = new URL(scratchUrl.toString());
    ownerUrl.username = owner;
    ownerUrl.password = password;
    let ownerClient = new Client({ connectionString: ownerUrl.toString() });
    await ownerClient.connect();
    try {
      const roleFlags = await ownerClient.query(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      );
      expect(roleFlags.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);

      for (const file of readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort()) {
        let sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
        for (const [from, to] of substitutions) sql = sql.replaceAll(from, to);
        await ownerClient.query(sql);
      }

      // An existing clinic with a staff member, written under its own context.
      const existingClinic = randomUUID();
      const staffEmail = `Taken.Owner-${suffix.slice(0, 8)}@Example.test`;
      await ownerClient.query(
        `INSERT INTO clinics (id, name, owner_email, contact_email, timezone)
         VALUES ($1, 'Existing', 'someone@example.test', 'someone@example.test', 'UTC')`,
        [existingClinic],
      );
      await ownerClient.query('BEGIN');
      await ownerClient.query("SELECT set_config('app.current_clinic_id', $1, true)", [
        existingClinic,
      ]);
      await ownerClient.query(
        `INSERT INTO staff_members (clinic_id, email, password_hash, role, status)
         VALUES ($1, $2, 'irrelevant', 'owner', 'active')`,
        [existingClinic, staffEmail],
      );
      await ownerClient.query('COMMIT');

      const refuseTakenEmail = async (): Promise<void> => {
        await expect(
          provisionClinic(
            ownerClient,
            {
              name: 'Blocked',
              ownerEmail: staffEmail.toUpperCase(),
              timezone: 'UTC',
              contactPhone: '1',
            },
            { appUrl: APP_URL, dryRun: false },
          ),
        ).rejects.toThrow(/already belongs to a staff account/);
        const blocked = await ownerClient.query("SELECT 1 FROM clinics WHERE name = 'Blocked'");
        expect(blocked.rows).toHaveLength(0);
      };

      // Production shape: migrations made this role an inheriting member of the
      // bootstrap roles, so their role-scoped policies apply to it as well.
      const [, authBootstrapRole] = substitutions[1]!;
      const [, acceptorRole] = substitutions[3]!;
      await refuseTakenEmail();

      // Strict shape: without that inheritance FORCE RLS fully applies — with no
      // context the role sees no staff at all — and the per-clinic context
      // check (P4) must still find the email.
      // The inheriting grant is the one the migrations made (grantor: this role
      // itself), so this role is the one that can switch its inheritance off.
      await ownerClient.query(`GRANT ${authBootstrapRole} TO CURRENT_USER WITH INHERIT FALSE`);
      await ownerClient.query(`GRANT ${acceptorRole} TO CURRENT_USER WITH INHERIT FALSE`);
      const strictClient = new Client({ connectionString: ownerUrl.toString() });
      await strictClient.connect();
      try {
        const naive = await strictClient.query('SELECT 1 FROM staff_members');
        expect(naive.rows).toHaveLength(0);
      } finally {
        await strictClient.end();
      }
      await ownerClient.end();
      ownerClient = new Client({ connectionString: ownerUrl.toString() });
      await ownerClient.connect();
      await refuseTakenEmail();

      // A fresh owner email provisions successfully as this role.
      const result = await provisionClinic(
        ownerClient,
        {
          name: 'Allowed',
          ownerEmail: 'new.owner@example.test',
          timezone: 'UTC',
          contactPhone: '1',
        },
        { appUrl: APP_URL, dryRun: false },
      );
      await ownerClient.query('BEGIN');
      await ownerClient.query("SELECT set_config('app.current_clinic_id', $1, true)", [
        result.clinicId,
      ]);
      const invitations = await ownerClient.query(
        'SELECT role, status, token_hash FROM invitations WHERE clinic_id = $1',
        [result.clinicId],
      );
      await ownerClient.query('COMMIT');
      expect(invitations.rows).toEqual([
        {
          role: 'owner',
          status: 'pending',
          token_hash: hashInvitationToken(tokenFrom(result.link!)),
        },
      ]);
    } finally {
      await ownerClient.end();
    }
  });
});
