import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { withTenantContext } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { hashPassword } from '@/features/auth';
import type { WorkingHoursJson } from '@/features/appointments';

/**
 * Test-only fixture data — no real clinic or patient data, per the hard
 * rule in CLAUDE.md. `clinics` carries no RLS policy by design (see
 * db/migrations/0003_clinics.sql).
 */
export interface TestClinic {
  id: string;
  name: string;
  timeZone: string;
}

/** Default for tests that don't care about clinic-local timezone semantics: keeps every existing
 * UTC-literal test timestamp meaning what it already means, since UTC has no DST and a zero
 * offset. Tests that specifically exercise ADR-0016's clinic-local conversion pass their own
 * `timeZone`. */
const DEFAULT_TEST_CLINIC_TIMEZONE = 'UTC';

/**
 * Inserted over the admin/owner connection (getDatabaseUrl), not app_user
 * (getAppDatabaseUrl) — mirroring scripts/verify-isolation-meaningful.ts.
 * Creating a tenant is an administrative operation, not a runtime one:
 * app_user has no INSERT on `clinics` (see the migration revoking it), so
 * this fixture can no longer go through the ordinary app connection.
 */
export async function createTestClinic(
  label: string,
  timeZone: string = DEFAULT_TEST_CLINIC_TIMEZONE,
): Promise<TestClinic> {
  const id = randomUUID();
  const name = `Test Clinic ${label} ${id.slice(0, 8)}`;
  const email = `${label.toLowerCase()}-${id.slice(0, 8)}@example.test`;
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    await admin.query(
      `INSERT INTO clinics (id, name, owner_email, contact_email, timezone) VALUES ($1, $2, $3, $3, $4)`,
      [id, name, email, timeZone],
    );
  } finally {
    await admin.end();
  }
  return { id, name, timeZone };
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
  /** Per-practitioner WorkingHours override (roadmap P4 Slice 1) — see `src/features/appointments/schedule.ts`. Omitted = NULL = clinic default applies. */
  workingHours?: WorkingHoursJson;
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
      `INSERT INTO staff_members (id, clinic_id, email, password_hash, role, status, working_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        clinicId,
        email,
        passwordHash,
        role,
        status,
        options.workingHours ? JSON.stringify(options.workingHours) : null,
      ],
    ),
  );

  return { id, clinicId, email, role, status, password };
}

/**
 * Test-only `knowledge_documents` fixture row (roadmap P5 Slice 1A). Inserted
 * over the admin/owner connection with `app.current_clinic_id` explicitly
 * set for the transaction — not through `withTenantContext` (app_user) — because
 * `app_user` holds no `INSERT` grant on this table in this slice
 * (`db/migrations/0013_knowledge_documents.sql`: no code path creates a row
 * yet, since `storage_key` is only ever produced by the Slice 1B upload
 * flow). `FORCE ROW LEVEL SECURITY` applies even to the table owner, so the
 * tenant-context `set_config` call is still required for the row's
 * `clinic_id` to satisfy the policy's `WITH CHECK` clause — same pattern as
 * `tests/db/conversations-isolation.test.ts`'s admin-connection trigger test.
 */
export interface TestKnowledgeDocument {
  id: string;
  clinicId: string;
  uploadedBy: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  status: 'processing' | 'ready' | 'failed';
  failedReason: string | null;
  readyAt: Date | null;
}

export interface CreateTestKnowledgeDocumentOptions {
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  storageKey?: string;
  status?: 'processing' | 'ready' | 'failed';
  failedReason?: string;
  readyAt?: Date;
}

export async function createTestKnowledgeDocument(
  clinicId: string,
  uploadedBy: string,
  options: CreateTestKnowledgeDocumentOptions = {},
): Promise<TestKnowledgeDocument> {
  const id = randomUUID();
  const filename = options.filename ?? `policy-${id.slice(0, 8)}.pdf`;
  const mimeType = options.mimeType ?? 'application/pdf';
  const sizeBytes = options.sizeBytes ?? 1024;
  const storageKey = options.storageKey ?? `${clinicId}/${id}`;
  const status = options.status ?? 'processing';
  const readyAt = status === 'ready' ? (options.readyAt ?? new Date()) : null;
  const failedReason = status === 'failed' ? (options.failedReason ?? 'test failure') : null;

  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query("SELECT set_config('app.current_clinic_id', $1, true)", [clinicId]);
    await admin.query(
      `INSERT INTO knowledge_documents
         (id, clinic_id, uploaded_by, filename, mime_type, size_bytes, storage_key, status, failed_reason, ready_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        clinicId,
        uploadedBy,
        filename,
        mimeType,
        sizeBytes,
        storageKey,
        status,
        failedReason,
        readyAt,
      ],
    );
    await admin.query('COMMIT');
  } catch (err) {
    await admin.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await admin.end();
  }

  return {
    id,
    clinicId,
    uploadedBy,
    filename,
    mimeType,
    sizeBytes,
    storageKey,
    status,
    failedReason,
    readyAt,
  };
}

/**
 * Sets a test clinic's default WorkingHours (roadmap P4 Slice 1). Runs over
 * the admin/owner connection, same as `createTestClinic` — `app_user` has
 * only column-restricted SELECT on `clinics` (0003_clinics.sql,
 * 0008_revoke_clinics_insert.sql: INSERT revoked, UPDATE never granted), so
 * a test fixture cannot write this through the ordinary app connection.
 */
export async function setClinicWorkingHours(
  clinicId: string,
  workingHours: WorkingHoursJson,
): Promise<void> {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    await admin.query('UPDATE clinics SET working_hours = $1 WHERE id = $2', [
      JSON.stringify(workingHours),
      clinicId,
    ]);
  } finally {
    await admin.end();
  }
}
