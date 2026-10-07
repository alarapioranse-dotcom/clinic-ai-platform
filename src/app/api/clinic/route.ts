import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import {
  getClinicSettings,
  updateClinicSettings,
  parseTimeZone,
  parseWorkingHours,
  CLINIC_SETTINGS_MANAGER_ROLES,
  InvalidTimeZoneError,
  InvalidWorkingHoursError,
  type UpdateClinicSettingsInput,
} from '@/features/clinic';

function unauthorized() {
  return NextResponse.json(
    { error: { code: 'unauthorized', message: 'No valid session.' } },
    { status: 401 },
  );
}

function invalidRequest(message: string) {
  return NextResponse.json({ error: { code: 'invalid_request', message } }, { status: 400 });
}

const PATCHABLE_FIELDS = new Set(['workingHours', 'timezone']);

/**
 * GET /api/clinic — the caller's own clinic's settings
 * (docs/technical/03-api-contracts.md: any signed-in staff). `clinicId` comes
 * only from the validated session; the request carries no parameters.
 * Returns id, name, timezone and working hours only — no contact details,
 * owner email or status. "Active services" from the contract are not
 * returned: no services model exists yet (ADR-0022 decision 4).
 */
export async function GET(request: NextRequest) {
  const session = await validateSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return unauthorized();
  }

  const settings = await getClinicSettings(session.clinicId);
  return NextResponse.json({ data: settings });
}

/**
 * PATCH /api/clinic — owner/admin only (Owner decision S4). Body may include
 * `workingHours` and/or `timezone`; anything else, including `services`, is
 * rejected rather than ignored. Both values are validated here, and the
 * write goes through the tenant-bound database function from ADR-0022, so a
 * request can only change the clinic its own session belongs to.
 */
export async function PATCH(request: NextRequest) {
  const session = await validateSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return unauthorized();
  }

  try {
    requireRole(session, CLINIC_SETTINGS_MANAGER_ROLES);
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
    return invalidRequest('Request body must be valid JSON.');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalidRequest('Request body must be a JSON object.');
  }
  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!PATCHABLE_FIELDS.has(key)) {
      return invalidRequest(`"${key}" cannot be changed here. Allowed: workingHours, timezone.`);
    }
  }
  if (record.workingHours === undefined && record.timezone === undefined) {
    return invalidRequest('Provide workingHours and/or timezone.');
  }

  const input: UpdateClinicSettingsInput = {};
  try {
    if (record.workingHours !== undefined) {
      input.workingHours = parseWorkingHours(record.workingHours);
    }
    if (record.timezone !== undefined) {
      input.timezone = parseTimeZone(record.timezone);
    }
    const settings = await updateClinicSettings(session.clinicId, input);
    return NextResponse.json({ data: settings });
  } catch (err) {
    if (err instanceof InvalidWorkingHoursError || err instanceof InvalidTimeZoneError) {
      return invalidRequest(err.message);
    }
    throw err;
  }
}
