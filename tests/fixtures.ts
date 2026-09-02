import { randomUUID } from 'node:crypto';
import { withoutTenantContext } from '@/lib/db';

/**
 * Test-only fixture data — no real clinic or patient data, per the hard
 * rule in CLAUDE.md. `clinics` carries no RLS policy by design (see
 * db/migrations/0003_clinics.sql), so this can insert through the ordinary
 * app connection with no tenant context.
 */
export interface TestClinic {
  id: string;
  name: string;
}

export async function createTestClinic(label: string): Promise<TestClinic> {
  const id = randomUUID();
  const name = `Test Clinic ${label} ${id.slice(0, 8)}`;
  const email = `${label.toLowerCase()}-${id.slice(0, 8)}@example.test`;
  await withoutTenantContext((client) =>
    client.query(
      `INSERT INTO clinics (id, name, owner_email, contact_email) VALUES ($1, $2, $3, $3)`,
      [id, name, email],
    ),
  );
  return { id, name };
}
