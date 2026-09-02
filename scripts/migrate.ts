/**
 * Minimal migration runner: applies db/migrations/*.sql, in filename order,
 * that aren't already recorded in schema_migrations. Deliberately not an
 * ORM or migration framework (human decision for this slice) — just plain
 * SQL files and a transaction per file.
 *
 * Connects with DATABASE_URL (the owner/migration role): creating
 * extensions, roles, tables and RLS policies requires privileges the
 * least-privilege APP_DATABASE_URL role deliberately does not have.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: '.env.local' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

async function main(): Promise<void> {
  // Dynamic import, deliberately not a static one: static ES imports are
  // hoisted above the `config()` call above regardless of source order, so
  // a static import here would evaluate src/lib/env.ts (and its eager
  // NEXT_PUBLIC_* checks) before dotenv has populated process.env from
  // .env.local. Relative path, not the `@/*` alias: this script runs
  // standalone via `tsx`, outside Next.js's own module resolution.
  const { getDatabaseUrl } = await import('../src/lib/env');
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const appliedRows = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
    const applied = new Set(appliedRows.rows.map((row) => row.id));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`Applying migration: ${file}\n`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
        appliedCount += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }

    process.stdout.write(
      appliedCount > 0
        ? `Applied ${appliedCount} migration(s). Schema up to date.\n`
        : 'No pending migrations. Schema up to date.\n',
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
