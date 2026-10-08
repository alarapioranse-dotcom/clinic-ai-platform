/**
 * Operator provisioning script (ADR-0023 decision 1; Owner decisions P1–P6).
 * The only way a clinic is created. Run by the operator from a trusted
 * terminal with DATABASE_URL (the owner/migration role), like
 * scripts/migrate.ts:
 *
 *   npx tsx scripts/provision-clinic.ts --name "…" --owner-email … \
 *     --timezone Europe/Athens [--contact-email …] [--contact-phone …] \
 *     [--dry-run] [--confirm-production]
 *
 *   npx tsx scripts/provision-clinic.ts --reissue --clinic-id <uuid> \
 *     [--dry-run] [--confirm-production]
 *
 * Create mode inserts one `clinics` row (status `active`, no working hours:
 * the owner sets them in /dashboard/settings/clinic) and one pending owner
 * invitation, in one transaction. Reissue mode expires the clinic's pending
 * owner invitation and issues a new one, in one transaction. Neither mode
 * ever creates a password or a staff member: the owner's account exists only
 * once the owner accepts the link and chooses their own password.
 *
 * The raw token exists only in memory and in the one link printed after the
 * transaction commits. Only SHA-256(token) is stored. Nothing is written to
 * a file or a log.
 *
 * A note on Row Level Security: on the managed database the owner role has
 * neither SUPERUSER nor BYPASSRLS, so FORCE ROW LEVEL SECURITY applies to it,
 * and writing `invitations` needs the clinic's tenant context. Reads are
 * subtler: migrations 0007 and 0016 make the migrating role a member (with
 * inheritance) of auth_bootstrap and invitation_acceptor, whose role-scoped
 * policies then also apply to it, so today it can read every clinic's staff
 * and invitations. The code relies on neither behaviour: the global "is this
 * email already a staff member?" check (ADR-0023: staff email is globally
 * unique) visits each clinic under its own context (Owner decision P4), and
 * every other query filters by clinic_id explicitly. Both shapes are tested.
 */
// Must stay the first import: loads .env.local before src/lib/env.ts is evaluated.
import './load-env';
import { parseArgs } from 'node:util';
import { Client } from 'pg';

import {
  buildInvitationLink,
  generateInvitationToken,
  hashInvitationToken,
} from '../src/features/invitations';
import { InvalidTimeZoneError, parseTimeZone } from '../src/features/clinic';
import { DEMO_CLINIC_ID } from './seed';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisioningError';
  }
}

export interface CreateClinicInput {
  name: string;
  ownerEmail: string;
  timezone: string;
  contactEmail?: string;
  contactPhone?: string;
}

export type ProvisionCommand =
  | { mode: 'create'; input: CreateClinicInput; dryRun: boolean; confirmProduction: boolean }
  | { mode: 'reissue'; clinicId: string; dryRun: boolean; confirmProduction: boolean };

/** Trims and lowercases an email (Owner decision E1; the invitations constraint requires it). */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Parses the command line (Owner decision P1: flags, no working hours).
 * Unknown flags are rejected rather than ignored.
 */
export function parseProvisionArgs(argv: string[]): ProvisionCommand {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        name: { type: 'string' },
        'owner-email': { type: 'string' },
        timezone: { type: 'string' },
        'contact-email': { type: 'string' },
        'contact-phone': { type: 'string' },
        reissue: { type: 'boolean', default: false },
        'clinic-id': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'confirm-production': { type: 'boolean', default: false },
      },
    }));
  } catch (err) {
    throw new ProvisioningError((err as Error).message);
  }

  const dryRun = values['dry-run'] === true;
  const confirmProduction = values['confirm-production'] === true;

  if (values.reissue === true) {
    for (const flag of ['name', 'owner-email', 'timezone', 'contact-email', 'contact-phone']) {
      if (values[flag] !== undefined) {
        throw new ProvisioningError(`--${flag} cannot be used with --reissue.`);
      }
    }
    const clinicId = String(values['clinic-id'] ?? '');
    if (!UUID_PATTERN.test(clinicId)) {
      throw new ProvisioningError('--reissue needs --clinic-id <uuid>.');
    }
    return { mode: 'reissue', clinicId: clinicId.toLowerCase(), dryRun, confirmProduction };
  }

  if (values['clinic-id'] !== undefined) {
    throw new ProvisioningError('--clinic-id is only valid with --reissue.');
  }

  const name = String(values.name ?? '').trim();
  if (!name) {
    throw new ProvisioningError('--name is required.');
  }

  const ownerEmail = normalizeEmail(String(values['owner-email'] ?? ''));
  if (!EMAIL_PATTERN.test(ownerEmail)) {
    throw new ProvisioningError('--owner-email must be a valid email address.');
  }

  let timezone: string;
  try {
    timezone = parseTimeZone(values.timezone);
  } catch (err) {
    if (err instanceof InvalidTimeZoneError) {
      throw new ProvisioningError('--timezone must be a valid IANA time zone, e.g. Europe/Athens.');
    }
    throw err;
  }

  const contactEmailRaw = values['contact-email'];
  const contactPhoneRaw = values['contact-phone'];
  const contactEmail =
    contactEmailRaw === undefined ? undefined : normalizeEmail(String(contactEmailRaw));
  const contactPhone =
    contactPhoneRaw === undefined ? undefined : String(contactPhoneRaw).trim() || undefined;

  if (contactEmail !== undefined && !EMAIL_PATTERN.test(contactEmail)) {
    throw new ProvisioningError('--contact-email must be a valid email address.');
  }
  if (contactEmail === undefined && contactPhone === undefined) {
    throw new ProvisioningError('At least one of --contact-email or --contact-phone is required.');
  }

  return {
    mode: 'create',
    input: { name, ownerEmail, timezone, contactEmail, contactPhone },
    dryRun,
    confirmProduction,
  };
}

/**
 * Owner decision P2: against production the script runs only with
 * --confirm-production (dry runs included), and only with an https app URL,
 * since that URL becomes the printed link.
 */
export function assertEnvironmentAllowed(
  appEnv: string,
  appUrl: string,
  confirmProduction: boolean,
): void {
  if (appEnv !== 'production') return;
  if (!confirmProduction) {
    throw new ProvisioningError(
      'Refusing to run against NEXT_PUBLIC_APP_ENV=production without --confirm-production.',
    );
  }
  if (!appUrl.startsWith('https://')) {
    throw new ProvisioningError(
      'In production NEXT_PUBLIC_APP_URL must start with https:// (it becomes the invitation link).',
    );
  }
}

export interface ProvisionResult {
  clinicId: string;
  clinicName: string;
  ownerEmail: string;
  expiresAt: Date;
  /** The one-time link. Null on a dry run: nothing was committed, so there is no link. */
  link: string | null;
}

async function setTenantContext(client: Client, clinicId: string): Promise<void> {
  await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicId]);
}

/**
 * Whether any staff member in any clinic already has this email (compared
 * case-insensitively, since older staff rows are not normalised). Must run
 * inside the caller's transaction: it switches the transaction-local tenant
 * context to each clinic in turn (Owner decision P4), because FORCE ROW
 * LEVEL SECURITY hides every other clinic's staff from the owner role.
 */
export async function staffEmailExistsInAnyClinic(client: Client, email: string): Promise<boolean> {
  const { rows: clinics } = await client.query<{ id: string }>('SELECT id FROM clinics');
  for (const clinic of clinics) {
    await setTenantContext(client, clinic.id);
    const { rows } = await client.query(
      'SELECT 1 FROM staff_members WHERE lower(email) = $1 LIMIT 1',
      [email],
    );
    if (rows.length > 0) return true;
  }
  return false;
}

async function ownerEmailUsedByAnotherClinic(
  client: Client,
  email: string,
  exceptClinicId?: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM clinics
     WHERE lower(btrim(owner_email)) = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    [email, exceptClinicId ?? null],
  );
  return rows.length > 0;
}

async function assertPostgresKnowsTimeZone(client: Client, timezone: string): Promise<void> {
  const { rows } = await client.query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [
    timezone,
  ]);
  if (rows.length === 0) {
    throw new ProvisioningError(`PostgreSQL does not recognise the time zone ${timezone}.`);
  }
}

async function insertOwnerInvitation(
  client: Client,
  clinicId: string,
  email: string,
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateInvitationToken();
  await setTenantContext(client, clinicId);
  const { rows } = await client.query<{ expires_at: Date }>(
    `INSERT INTO invitations (clinic_id, email, role, token_hash)
     VALUES ($1, $2, 'owner', $3)
     RETURNING expires_at`,
    [clinicId, email, hashInvitationToken(rawToken)],
  );
  return { rawToken, expiresAt: rows[0]!.expires_at };
}

/**
 * Create mode. Runs entirely in one transaction on `client` (an owner-role
 * connection): validates, inserts the clinic and its owner invitation, then
 * commits — or rolls back on a dry run or any error, leaving nothing behind.
 * The link is built only after a successful commit.
 */
export async function provisionClinic(
  client: Client,
  input: CreateClinicInput,
  options: { appUrl: string; dryRun: boolean },
): Promise<ProvisionResult> {
  const ownerEmail = normalizeEmail(input.ownerEmail);
  await client.query('BEGIN');
  try {
    await assertPostgresKnowsTimeZone(client, input.timezone);
    if (await ownerEmailUsedByAnotherClinic(client, ownerEmail)) {
      throw new ProvisioningError(
        'This owner email is already the owner email of another clinic (Owner decision P5).',
      );
    }
    if (await staffEmailExistsInAnyClinic(client, ownerEmail)) {
      throw new ProvisioningError('This owner email already belongs to a staff account.');
    }

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO clinics (name, contact_email, contact_phone, owner_email, status, timezone)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING id`,
      [
        input.name,
        input.contactEmail ?? null,
        input.contactPhone ?? null,
        ownerEmail,
        input.timezone,
      ],
    );
    const clinicId = rows[0]!.id;
    const { rawToken, expiresAt } = await insertOwnerInvitation(client, clinicId, ownerEmail);

    if (options.dryRun) {
      await client.query('ROLLBACK');
      return { clinicId, clinicName: input.name, ownerEmail, expiresAt, link: null };
    }
    await client.query('COMMIT');
    return {
      clinicId,
      clinicName: input.name,
      ownerEmail,
      expiresAt,
      link: buildInvitationLink(options.appUrl, rawToken),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

/**
 * Reissue mode (ADR-0023 decision 1): for a provisioned clinic whose owner has
 * not accepted yet, expire any pending owner invitation and issue a new one
 * for the clinic's owner email, in one transaction.
 */
export async function reissueOwnerInvitation(
  client: Client,
  clinicId: string,
  options: { appUrl: string; dryRun: boolean },
): Promise<ProvisionResult> {
  if (clinicId === DEMO_CLINIC_ID) {
    throw new ProvisioningError('The deployment-validation demo clinic is never reissued.');
  }
  await client.query('BEGIN');
  try {
    const { rows: clinics } = await client.query<{ name: string; owner_email: string }>(
      'SELECT name, owner_email FROM clinics WHERE id = $1 FOR UPDATE',
      [clinicId],
    );
    const clinic = clinics[0];
    if (!clinic) {
      throw new ProvisioningError('No clinic has this id.');
    }
    const ownerEmail = normalizeEmail(clinic.owner_email);

    // Explicit clinic filter: RLS alone is not relied on here, because the
    // owner role can read other clinics' staff rows (see the module comment).
    await setTenantContext(client, clinicId);
    const { rows: owners } = await client.query(
      "SELECT 1 FROM staff_members WHERE clinic_id = $1 AND role = 'owner' LIMIT 1",
      [clinicId],
    );
    if (owners.length > 0) {
      throw new ProvisioningError('This clinic already has an owner account; nothing to reissue.');
    }
    if (await staffEmailExistsInAnyClinic(client, ownerEmail)) {
      throw new ProvisioningError("The clinic's owner email already belongs to a staff account.");
    }

    await setTenantContext(client, clinicId);
    await client.query(
      `UPDATE invitations SET status = 'expired'
       WHERE clinic_id = $1 AND role = 'owner' AND status = 'pending'`,
      [clinicId],
    );
    const { rawToken, expiresAt } = await insertOwnerInvitation(client, clinicId, ownerEmail);

    if (options.dryRun) {
      await client.query('ROLLBACK');
      return { clinicId, clinicName: clinic.name, ownerEmail, expiresAt, link: null };
    }
    await client.query('COMMIT');
    return {
      clinicId,
      clinicName: clinic.name,
      ownerEmail,
      expiresAt,
      link: buildInvitationLink(options.appUrl, rawToken),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

async function main(): Promise<void> {
  const { env, getDatabaseUrl } = await import('../src/lib/env');

  const command = parseProvisionArgs(process.argv.slice(2));
  assertEnvironmentAllowed(env.appEnv, env.appUrl, command.confirmProduction);

  process.stdout.write(
    `Environment: ${env.appEnv}${command.dryRun ? ' (dry run: nothing will be saved)' : ''}\n`,
  );
  if (command.mode === 'create') {
    const { input } = command;
    process.stdout.write(
      `Create clinic "${input.name}" (${input.timezone}), owner ${input.ownerEmail}, ` +
        `contact ${[input.contactEmail, input.contactPhone].filter(Boolean).join(' / ')}\n`,
    );
  } else {
    process.stdout.write(`Reissue the owner invitation for clinic ${command.clinicId}\n`);
  }

  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const result =
      command.mode === 'create'
        ? await provisionClinic(client, command.input, {
            appUrl: env.appUrl,
            dryRun: command.dryRun,
          })
        : await reissueOwnerInvitation(client, command.clinicId, {
            appUrl: env.appUrl,
            dryRun: command.dryRun,
          });

    if (result.link === null) {
      process.stdout.write(
        `Dry run OK: clinic "${result.clinicName}" and an owner invitation for ` +
          `${result.ownerEmail} would be created. Nothing was saved.\n`,
      );
      return;
    }
    process.stdout.write(
      `Done. Clinic id: ${result.clinicId}\n` +
        `Owner invitation for ${result.ownerEmail}, valid until ${result.expiresAt.toISOString()} (single use).\n` +
        'Send this link to the owner privately. It is shown only once and is not stored:\n\n' +
        `${result.link}\n\n`,
    );
  } finally {
    await client.end();
  }
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof ProvisioningError ? err.message : (err as Error).message;
    process.stderr.write(`Provisioning failed: ${message}\n`);
    process.exitCode = 1;
  });
}
