import type { PoolClient } from 'pg';

/**
 * Internal to this feature — not exported from `./index.ts`. Nothing outside
 * `src/features/patients/**` may import this module directly (see
 * CONTRIBUTING.md, "a feature never imports another feature's internals").
 */

export interface Patient {
  id: string;
  clinicId: string;
  phoneNumber: string | null;
  displayName: string | null;
  createdAt: Date;
}

export interface CreatePatientInput {
  /**
   * Required: docs/technical/01-database-schema.md's `patient_has_contact_channel`
   * check only accepts phone_number as the contact channel at creation time
   * (anonymised_at is set later, only by erasure — ADR-0005, out of scope
   * here).
   */
  phoneNumber: string;
  displayName?: string;
}

interface PatientRow {
  id: string;
  clinic_id: string;
  phone_number: string | null;
  display_name: string | null;
  created_at: Date;
}

function toPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    phoneNumber: row.phone_number,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

/**
 * Inserts a patient row for the clinic the caller's transaction is already
 * scoped to (via `withTenantContext`). `clinicId` is passed explicitly and
 * used as a parameter — never string-interpolated — so a caller cannot
 * insert into a clinic other than the one RLS has scoped this transaction
 * to; RLS's `WITH CHECK` clause enforces that independently regardless.
 */
export async function insertPatient(
  client: PoolClient,
  clinicId: string,
  input: CreatePatientInput,
): Promise<Patient> {
  if (!input.phoneNumber) {
    throw new Error('phoneNumber is required to create a patient');
  }

  const { rows } = await client.query<PatientRow>(
    `INSERT INTO patients (clinic_id, phone_number, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, clinic_id, phone_number, display_name, created_at`,
    [clinicId, input.phoneNumber, input.displayName ?? null],
  );

  const row = rows[0];
  if (!row) {
    throw new Error('Insert into patients returned no row');
  }
  return toPatient(row);
}

/**
 * Lists every patient visible in the caller's transaction. Deliberately
 * unfiltered by `clinic_id` in application code — RLS is the filter (charter
 * §5); this query would return another clinic's rows too if RLS were ever
 * misconfigured, which is exactly what the isolation test suite checks for.
 */
export async function listPatients(client: PoolClient): Promise<Patient[]> {
  const { rows } = await client.query<PatientRow>(
    `SELECT id, clinic_id, phone_number, display_name, created_at
     FROM patients
     ORDER BY created_at`,
  );
  return rows.map(toPatient);
}
