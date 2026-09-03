import { randomUUID } from 'node:crypto';
import { withoutTenantContext, withTenantContext } from '@/lib/db';
import { hashPassword } from '@/features/auth';

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

/**
 * Test-only staff account — P2-A has no invitation-acceptance flow (that's
 * P2-B, per the approved scope), so this is the sanctioned way to produce a
 * real, sign-in-able `staff_members` row for tests. Inserted through
 * `withTenantContext`, the ordinary tenant-scoped path — never through the
 * ADR-0012 bootstrap functions, which are read-only and reserved for
 * pre-tenant-context lookups.
 */
export interface TestStaffMember {
  id: string;
  clinicId: string;
  email: string;
  role: 'owner' | 'admin' | 'practitioner' | 'receptionist';
  status: 'active' | 'deactivated';
  password: string;
}

export interface CreateTestStaffMemberOptions {
  role?: TestStaffMember['role'];
  status?: TestStaffMember['status'];
  password?: string;
  email?: string;
}

export async function createTestStaffMember(
  clinicId: string,
  label: string,
  options: CreateTestStaffMemberOptions = {},
): Promise<TestStaffMember> {
  const id = randomUUID();
  const email = options.email ?? `${label.toLowerCase()}-${id.slice(0, 8)}@example.test`;
  const password = options.password ?? 'Correct-Horse-Battery-Staple-1!';
  const role = options.role ?? 'receptionist';
  const status = options.status ?? 'active';
  const passwordHash = await hashPassword(password);

  await withTenantContext(clinicId, (client) =>
    client.query(
      `INSERT INTO staff_members (id, clinic_id, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, clinicId, email, passwordHash, role, status],
    ),
  );

  return { id, clinicId, email, role, status, password };
}
