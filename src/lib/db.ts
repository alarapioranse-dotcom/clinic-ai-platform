import { Pool, type PoolClient } from 'pg';
import { getAppDatabaseUrl } from '@/lib/env';

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
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` against a bare pooled connection with no transaction opened and
 * no tenant context set. This exists only for the isolation test suite: it
 * is the "query path that opens no transaction" ADR-0006 requires a test
 * case for (docs/technical/02-tenant-isolation-testing.md, "What this must
 * become in CI" section) — application code must never call this directly.
 */
export async function withoutTenantContext<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
