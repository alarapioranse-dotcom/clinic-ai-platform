import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import { createPatient, getPatientsForClinic } from '@/features/patients';

/**
 * docs/technical/03-api-contracts.md: GET /api/patients, all four roles
 * (practitioner included, read-only — this endpoint is a read). `clinicId`
 * comes only from the validated session, never a request parameter.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await validateSession(token);

  if (!session) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'No valid session.' } },
      { status: 401 },
    );
  }

  try {
    requireRole(session, ['owner', 'admin', 'practitioner', 'receptionist']);
  } catch (err) {
    if (err instanceof ForbiddenRoleError) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Your role does not permit this action.' } },
        { status: 403 },
      );
    }
    throw err;
  }

  const patients = await getPatientsForClinic(session.clinicId);
  return NextResponse.json({ data: patients });
}

/**
 * docs/technical/03-api-contracts.md: POST /api/patients ("Manual creation"),
 * owner/admin/receptionist only — practitioner is excluded, matching
 * ADR-0004's "read-only access to conversations and appointments; no access
 * to... clinic settings" pattern extended here to patient records. `clinicId`
 * comes only from the validated session (ADR-0003), never the request body;
 * the write itself goes through `createPatient`, which is already
 * tenant-scoped via `withTenantContext` (ADR-0006) with ordinary `app_user`
 * grants and full RLS enforcement — no new bypass, no new migration.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await validateSession(token);

  if (!session) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'No valid session.' } },
      { status: 401 },
    );
  }

  try {
    requireRole(session, ['owner', 'admin', 'receptionist']);
  } catch (err) {
    if (err instanceof ForbiddenRoleError) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Your role does not permit this action.' } },
        { status: 403 },
      );
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const phoneNumber =
    typeof body === 'object' &&
    body !== null &&
    'phoneNumber' in body &&
    typeof body.phoneNumber === 'string'
      ? body.phoneNumber
      : '';
  const displayName =
    typeof body === 'object' &&
    body !== null &&
    'displayName' in body &&
    typeof body.displayName === 'string'
      ? body.displayName
      : undefined;

  if (!phoneNumber) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'phoneNumber is required.' } },
      { status: 400 },
    );
  }

  const patient = await createPatient(session.clinicId, { phoneNumber, displayName });
  return NextResponse.json({ data: patient }, { status: 201 });
}
