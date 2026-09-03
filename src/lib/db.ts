import { Pool, type PoolClient } from 'pg';
import { getAppDatabaseUrl, isTestEnvironment } from '@/lib/env';

/**
 * Tenant-context propagation, per ADR-0006 ("RLS tenant-context
 * propagation"): a per-request session variable, set inside the same
 * transaction as the request's queries via `SELECT set_config(...)`, which
 * is the parameterizable equivalent of `SET LOCAL app.current_clinic_id`
 * used illustratively in docs/technical/01-database-schema.md (see
 * docs/technical/04-auth-implementation.md's own note recommending
 * `set_config` for application code). `set_config`'s third argument
 * (`is_local = true`) gives it the same transaction-scoped revert behavior
 * as `SET LOCAL` — the value never survives past COMMIT/ROLLBACK, and never
 * leaks onto a connection this pool hands to a different request afterward.
 *
 * This connects as the least-privilege `app_user` role (APP_DATABASE_URL),
 * never as the migration/owner role — see docs/technical/02-tenant-isolation-testing.md's
 * precondition for a meaningful RLS test, and db/migrations/0002_app_role.sql.
 */
let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getAppDatabaseUrl() });
  }
  return pool;
}

const CLINIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside a single transaction with `app.current_clinic_id` set to
 * `clinicId` for that transaction only. This is the only sanctioned way for
 * application code to read or write a tenant-scoped table — RLS denies every
 * row when this hasn't run (fail-closed), so there is no separate
 * application-level tenant filter to keep in sync (charter §5: "Tenant
 * isolation is enforced at the data layer. A UI check that hides another
 * clinic's data is not isolation.").
 */
export async function withTenantContext<T>(
  clinicId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!CLINIC_ID_PATTERN.test(clinicId)) {
    throw new Error(`Invalid clinicId: expected a UUID, got "${clinicId}"`);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // clinicId is passed as a bind parameter, never interpolated into SQL.
    await client.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicId]);
    const result = await fn(client);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (err) {
    // PR #25 review: if ROLLBACK itself throws, the connection may still be
    // inside a transaction carrying this request's tenant context — never
    // let that go back into the pool for a later, unrelated request to
    // reuse. release(err) tells pg to destroy the connection instead of
    // pooling it. Either way, the *original* error is what's re-thrown, not
    // a rollback failure masking it.
    try {
      await client.query('ROLLBACK');
      client.release();
    } catch (rollbackErr) {
      client.release(rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr)));
    }
    throw err;
  }
}

/**
 * Runs `fn` against a bare pooled connection with no transaction opened and
 * no tenant context set. This exists only for the isolation test suite: it
 * is the "query path that opens no transaction" ADR-0006 requires a test
 * case for (docs/technical/02-tenant-isolation-testing.md, "What this must
 * become in CI" section).
 *
 * Application code must never call this directly — and per PR #25 review,
 * that is enforced here, not left as a comment: it throws outside a test
 * run (per ADR-0011 §6, a boundary "not satisfied by prompt instructions...
 * enforced by a structural mechanism with a test"). Vitest sets
 * `NODE_ENV=test` automatically, so the test suite is unaffected.
 */
export async function withoutTenantContext<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!isTestEnvironment()) {
    throw new Error(
      'withoutTenantContext must never be called outside the test suite — it exists only to prove RLS fails closed with no tenant context (see docs/technical/02-tenant-isolation-testing.md).',
    );
  }

  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * The two authentication-bootstrap lookups from ADR-0012
 * (docs/adr/0012-authentication-bootstrap-security-definer.md, human-approved):
 * each calls exactly one `SECURITY DEFINER` PostgreSQL function
 * (`auth_lookup_staff_by_email` / `auth_lookup_session_by_token_hash`,
 * db/migrations/0007_auth_bootstrap_functions.sql) that runs before
 * `app.current_clinic_id` can be known — sign-in and session validation
 * both need to resolve *which* clinic a request belongs to before that
 * setting can exist.
 *
 * These two functions are the only production-safe way to read
 * `staff_members` or `staff_sessions` pre-tenant-context. Deliberately two
 * fixed, named functions — each with a single typed scalar argument and a
 * hardcoded query calling one whitelisted database function — rather than a
 * general-purpose "run any query without tenant context" helper; that role
 * is, and remains, `withoutTenantContext()`'s test-only one. Application
 * code outside `src/features/auth/**` has no reason to call either of
 * these.
 */
export interface AuthBootstrapStaffRow {
  staff_id: string;
  clinic_id: string;
  role: string;
  status: string;
  password_hash: string;
}

export async function lookupStaffByEmailForAuth(
  email: string,
): Promise<AuthBootstrapStaffRow | null> {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query<AuthBootstrapStaffRow>(
      'SELECT * FROM auth_lookup_staff_by_email($1)',
      [email],
    );
    return rows[0] ?? null;
  } finally {
    client.release();
  }
}

export interface AuthBootstrapSessionRow {
  session_id: string;
  staff_id: string;
  clinic_id: string;
  role: string;
  status: string;
}

export async function lookupSessionByTokenHashForAuth(
  tokenHash: string,
): Promise<AuthBootstrapSessionRow | null> {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query<AuthBootstrapSessionRow>(
      'SELECT * FROM auth_lookup_session_by_token_hash($1)',
      [tokenHash],
    );
    return rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
