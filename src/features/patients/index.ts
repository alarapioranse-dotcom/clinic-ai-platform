/**
 * Public entry point for the `patients` feature (roadmap P1: "at least one
 * feature has real, tenant-scoped read/write operations behind its public
 * entry point"). Only this module — never `./repository` — is a valid
 * import target for other features or for `src/app/**` route/page code.
 *
 * No HTTP route is added in this slice: docs/technical/03-api-contracts.md's
 * `/api/patients` endpoints require an authenticated staff session and role
 * checks, which are explicitly out of scope until P2's auth work exists.
 * Exposing these functions over HTTP before then would be an unauthenticated
 * patient-data endpoint — the opposite of what this slice is proving.
 *
 * Every function here is tenant-scoped via `withTenantContext`: the caller
 * supplies `clinicId` (resolved elsewhere — a session, a test fixture — this
 * feature does not resolve it), and RLS is the actual isolation boundary,
 * not any filtering done here.
 */
import { withTenantContext } from '@/lib/db';
import { insertPatient, listPatients, type Patient, type CreatePatientInput } from './repository';

export type { Patient, CreatePatientInput };

export async function createPatient(clinicId: string, input: CreatePatientInput): Promise<Patient> {
  return withTenantContext(clinicId, (client) => insertPatient(client, clinicId, input));
}

export async function getPatientsForClinic(clinicId: string): Promise<Patient[]> {
  return withTenantContext(clinicId, (client) => listPatients(client));
}
