import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import { getAvailableSlots, PractitionerNotFoundError } from '@/features/appointments';

/** Same pattern as every other route's own UUID_PATTERN constant. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Upper bound is a sanity guard, not a domain rule — no service catalog exists in P4 to derive a duration from. */
const MAX_DURATION_MINUTES = 8 * 60;

function invalidRequest(message: string) {
  return NextResponse.json({ error: { code: 'invalid_request', message } }, { status: 400 });
}

/**
 * roadmap P4 Slice 1: GET /api/appointments/availability. All four roles
 * (practitioner included, read-only — ADR-0004), matching GET
 * /api/conversations's matrix. Query params: `practitionerId`, `date`
 * (YYYY-MM-DD), `durationMinutes`. A malformed value in any of the three
 * returns `400` (this is request-body/query validation, not a path-segment
 * resource lookup, so it does not follow GET /api/conversations/:id's
 * malformed-ID-collapses-to-404 convention); a well-formed but
 * nonexistent/cross-clinic `practitionerId` returns `404`
 * (`PractitionerNotFoundError`), matching the existing 404-vs-403
 * cross-tenant rule. Performs zero writes — this is a pure read (P4 Design
 * Gate, Availability section).
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

  const { searchParams } = new URL(request.url);
  const practitionerId = searchParams.get('practitionerId') ?? '';
  const date = searchParams.get('date') ?? '';
  const durationMinutesRaw = searchParams.get('durationMinutes') ?? '';

  if (!UUID_PATTERN.test(practitionerId)) {
    return invalidRequest('practitionerId must be a valid UUID.');
  }
  if (!DATE_PATTERN.test(date)) {
    return invalidRequest('date must be in YYYY-MM-DD format.');
  }
  const durationMinutes = Number(durationMinutesRaw);
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    durationMinutes > MAX_DURATION_MINUTES
  ) {
    return invalidRequest(
      `durationMinutes must be a positive integer of at most ${MAX_DURATION_MINUTES}.`,
    );
  }

  try {
    const slots = await getAvailableSlots(session.clinicId, practitionerId, date, durationMinutes);
    return NextResponse.json({ data: { slots } });
  } catch (err) {
    if (err instanceof PractitionerNotFoundError) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Practitioner not found.' } },
        { status: 404 },
      );
    }
    if (err instanceof Error && /Invalid date/.test(err.message)) {
      return invalidRequest('date must be a real calendar date.');
    }
    throw err;
  }
}
