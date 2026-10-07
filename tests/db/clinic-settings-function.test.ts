import { describe, it, expect, afterAll } from 'vitest';
import { Client } from 'pg';
import { closePool, withTenantContext, withoutTenantContext } from '@/lib/db';
import { getAppDatabaseUrl, getDatabaseUrl } from '@/lib/env';
import { createTestClinic } from '../fixtures';

/**
 * Database coverage for db/migrations/0015_clinic_settings_function.sql
 * (ADR-0022, Accepted). ADR-0022's Consequences section lists what must be
 * proven against PostgreSQL:
 *   - the function updates only the context clinic's row;
 *   - it fails with no context;
 *   - app_user cannot UPDATE clinics directly;
 *   - PUBLIC cannot execute it;
 *   - an invalid timezone is rejected.
 * Plus the structural properties decision 2 requires of the function and
 * its owner role.
 */

interface ClinicRow {
  name: string;
  working_hours: Record<string, unknown>;
  timezone: string;
  updated_at: Date;
}

async function readClinicAsAdmin(id: string): Promise<ClinicRow> {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    const { rows } = await admin.query<ClinicRow>(
      'SELECT name, working_hours, timezone, updated_at FROM clinics WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw new Error(`clinic ${id} not found`);
    return rows[0];
  } finally {
    await admin.end();
  }
}

async function asAppUser<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: getAppDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const MONDAY_ONLY = { monday: { start: '09:00', end: '17:00' } };

describe('set_clinic_settings (db/migrations/0015, ADR-0022)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('updates the clinic named by the tenant context and leaves every other clinic untouched', async () => {
    const clinicA = await createTestClinic('SettingsA', 'UTC');
    const clinicB = await createTestClinic('SettingsB', 'UTC');
    const beforeB = await readClinicAsAdmin(clinicB.id);

    await withTenantContext(clinicA.id, (client) =>
      client.query('SELECT set_clinic_settings($1::jsonb, $2)', [
        JSON.stringify(MONDAY_ONLY),
        'Europe/Athens',
      ]),
    );

    const afterA = await readClinicAsAdmin(clinicA.id);
    expect(afterA.working_hours).toEqual(MONDAY_ONLY);
    expect(afterA.timezone).toBe('Europe/Athens');

    const afterB = await readClinicAsAdmin(clinicB.id);
    expect(afterB).toEqual(beforeB);
  });

  it('takes no clinic identifier argument: its only signature is (jsonb, text)', async () => {
    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      const { rows } = await admin.query<{ signature: string }>(
        `SELECT p.oid::regprocedure::text AS signature
         FROM pg_proc p WHERE p.proname = 'set_clinic_settings'`,
      );
      expect(rows.map((row) => row.signature)).toEqual(['set_clinic_settings(jsonb,text)']);
    } finally {
      await admin.end();
    }
  });

  it('fails closed with no tenant context and changes nothing', async () => {
    const clinic = await createTestClinic('SettingsNoContext', 'UTC');
    const before = await readClinicAsAdmin(clinic.id);

    await expect(
      withoutTenantContext((client) =>
        client.query('SELECT set_clinic_settings($1::jsonb, $2)', [
          JSON.stringify(MONDAY_ONLY),
          'Europe/Athens',
        ]),
      ),
    ).rejects.toThrow(/no tenant context/);

    expect(await readClinicAsAdmin(clinic.id)).toEqual(before);
  });

  it('fails closed when the tenant context is an empty string', async () => {
    const clinic = await createTestClinic('SettingsEmptyContext', 'UTC');
    const before = await readClinicAsAdmin(clinic.id);

    await asAppUser(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query("SELECT set_config('app.current_clinic_id', '', true)");
        await expect(
          client.query('SELECT set_clinic_settings($1::jsonb, $2)', [
            JSON.stringify(MONDAY_ONLY),
            'Europe/Athens',
          ]),
        ).rejects.toThrow(/no tenant context/);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    expect(await readClinicAsAdmin(clinic.id)).toEqual(before);
  });

  it('raises when the tenant context names no existing clinic', async () => {
    await expect(
      withTenantContext('00000000-0000-4000-8000-00000000dead', (client) =>
        client.query('SELECT set_clinic_settings($1::jsonb, $2)', [
          JSON.stringify(MONDAY_ONLY),
          'UTC',
        ]),
      ),
    ).rejects.toThrow(/no clinic matches the tenant context/);
  });

  it('rejects a timezone PostgreSQL does not recognise and changes nothing', async () => {
    const clinic = await createTestClinic('SettingsBadTz', 'UTC');
    const before = await readClinicAsAdmin(clinic.id);

    for (const bad of ['Mars/Olympus_Mons', '+02:00', '']) {
      await expect(
        withTenantContext(clinic.id, (client) =>
          client.query('SELECT set_clinic_settings($1::jsonb, $2)', [
            JSON.stringify(MONDAY_ONLY),
            bad,
          ]),
        ),
      ).rejects.toThrow(/invalid timezone/);
    }

    expect(await readClinicAsAdmin(clinic.id)).toEqual(before);
  });

  it('rejects working hours that are not a JSON object', async () => {
    const clinic = await createTestClinic('SettingsBadHours', 'UTC');
    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query('SELECT set_clinic_settings($1::jsonb, NULL)', ['[]']),
      ),
    ).rejects.toThrow(/invalid working hours/);
  });

  it('rejects a call that would update nothing', async () => {
    const clinic = await createTestClinic('SettingsNothing', 'UTC');
    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query('SELECT set_clinic_settings(NULL, NULL)'),
      ),
    ).rejects.toThrow(/nothing to update/);
  });

  it('leaves the other setting unchanged when one argument is NULL', async () => {
    const clinic = await createTestClinic('SettingsPartial', 'Africa/Cairo');

    await withTenantContext(clinic.id, (client) =>
      client.query('SELECT set_clinic_settings($1::jsonb, NULL)', [JSON.stringify(MONDAY_ONLY)]),
    );
    let row = await readClinicAsAdmin(clinic.id);
    expect(row.working_hours).toEqual(MONDAY_ONLY);
    expect(row.timezone).toBe('Africa/Cairo');

    await withTenantContext(clinic.id, (client) =>
      client.query('SELECT set_clinic_settings(NULL, $1)', ['Europe/Berlin']),
    );
    row = await readClinicAsAdmin(clinic.id);
    expect(row.working_hours).toEqual(MONDAY_ONLY);
    expect(row.timezone).toBe('Europe/Berlin');
  });

  it('never changes the clinic name (only working_hours, timezone and updated_at are written)', async () => {
    const clinic = await createTestClinic('SettingsName', 'UTC');
    const before = await readClinicAsAdmin(clinic.id);

    await withTenantContext(clinic.id, (client) =>
      client.query('SELECT set_clinic_settings($1::jsonb, $2)', [
        JSON.stringify(MONDAY_ONLY),
        'Europe/Athens',
      ]),
    );

    const after = await readClinicAsAdmin(clinic.id);
    expect(after.name).toBe(before.name);
    expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
  });

  it('app_user cannot UPDATE clinics directly, even inside its own tenant context', async () => {
    const clinic = await createTestClinic('SettingsDirect', 'UTC');
    const before = await readClinicAsAdmin(clinic.id);

    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query("UPDATE clinics SET timezone = 'Europe/Athens' WHERE id = $1", [clinic.id]),
      ),
    ).rejects.toThrow(/permission denied for table clinics/);

    await expect(
      withTenantContext(clinic.id, (client) =>
        client.query("UPDATE clinics SET working_hours = '{}'::jsonb WHERE id = $1", [clinic.id]),
      ),
    ).rejects.toThrow(/permission denied for table clinics/);

    expect(await readClinicAsAdmin(clinic.id)).toEqual(before);
  });

  it('app_user holds no UPDATE privilege on clinics, table-wide or on any column', async () => {
    await asAppUser(async (client) => {
      const { rows } = await client.query<{ table_update: boolean; any_column_update: boolean }>(
        `SELECT has_table_privilege('clinics', 'UPDATE') AS table_update,
                has_any_column_privilege('clinics', 'UPDATE') AS any_column_update`,
      );
      expect(rows[0]).toEqual({ table_update: false, any_column_update: false });
    });
  });

  it('PUBLIC cannot execute the function; app_user can', async () => {
    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      const { rows } = await admin.query<{ public_can: boolean; app_user_can: boolean }>(
        `SELECT has_function_privilege('public', 'set_clinic_settings(jsonb,text)', 'EXECUTE') AS public_can,
                has_function_privilege('app_user', 'set_clinic_settings(jsonb,text)', 'EXECUTE') AS app_user_can`,
      );
      expect(rows[0]).toEqual({ public_can: false, app_user_can: true });
    } finally {
      await admin.end();
    }
  });

  it('is SECURITY DEFINER, plpgsql, with a pinned search_path, owned by clinic_settings_writer', async () => {
    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      const { rows } = await admin.query<{
        prosecdef: boolean;
        lang: string;
        proconfig: string[] | null;
        owner: string;
      }>(
        `SELECT p.prosecdef, l.lanname AS lang, p.proconfig, pg_get_userbyid(p.proowner) AS owner
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
         WHERE p.oid = 'set_clinic_settings(jsonb,text)'::regprocedure`,
      );
      expect(rows[0]).toEqual({
        prosecdef: true,
        lang: 'plpgsql',
        proconfig: ['search_path=public, pg_catalog'],
        owner: 'clinic_settings_writer',
      });
    } finally {
      await admin.end();
    }
  });

  it('its owner role is NOLOGIN, not SUPERUSER, not BYPASSRLS, and can update only the three settings columns', async () => {
    const admin = new Client({ connectionString: getDatabaseUrl() });
    await admin.connect();
    try {
      const role = await admin.query(
        `SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'clinic_settings_writer'`,
      );
      expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false, rolcanlogin: false }]);

      const { rows } = await admin.query<{ column_name: string }>(
        `SELECT a.attname AS column_name
         FROM pg_attribute a
         WHERE a.attrelid = 'clinics'::regclass AND a.attnum > 0 AND NOT a.attisdropped
           AND has_column_privilege('clinic_settings_writer', 'clinics', a.attname, 'UPDATE')
         ORDER BY a.attname`,
      );
      expect(rows.map((row) => row.column_name)).toEqual([
        'timezone',
        'updated_at',
        'working_hours',
      ]);

      const tableWide = await admin.query<{ update: boolean }>(
        `SELECT has_table_privilege('clinic_settings_writer', 'clinics', 'UPDATE') AS update`,
      );
      expect(tableWide.rows[0]?.update).toBe(false);
    } finally {
      await admin.end();
    }
  });
});
