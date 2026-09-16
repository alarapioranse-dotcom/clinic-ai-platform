import { NextResponse, type NextRequest } from 'next/server';

import {
  validateSession,
  requireRole,
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
} from '@/features/auth';
import {
  bookAppointment,
  PractitionerNotFoundError,
  PatientNotFoundError,
  ConversationPatientMismatchError,
  AppointmentConflictError,
} from '@/features/appointments';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidRequest(message: string) {
  return NextResponse.json({ error: { code: 'invalid_request', message } }, { status: 400 });
}

function notFoundResponse() {
  return NextResponse.json(
    { error: { code: 'not_found', message: 'Patient, practitioner, or conversation not found.' } },
    { status: 404 },
  );
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * roadmap P4 Slice 1: POST /api/appointments. Owner/admin/receptionist only
 * — practitioner stays read-only (ADR-0004), same matrix as POST
 * /api/patients and POST /api/conversations/:id/messages. Body: `{
 * patientId, practitionerId, startsAt, endsAt, conversationId? }`.
 * `clinicId` comes only from the validated session, never the request body.
 *
 * A malformed field (bad UUID format, unparseable timestamp, `endsAt` not
 * after `startsAt`) is request-input validation, so it returns `400` here at
 * the API boundary, before the feature layer runs any query — distinct from
 * a well-formed but nonexistent/cross-clinic `patientId`/`practitionerId`/
 * `conversationId`, which the database's composite foreign keys reject and
 * this handler translates to `404` (`P4-appointments`'s 404-vs-403
 * cross-tenant rule, same as every other endpoint in this codebase).
 *
 * `409` is reserved specifically for `AppointmentConflictError` — the
 * `appointments_no_double_booking` EXCLUDE constraint rejecting the write —
 * with the stable, user-facing message the P4 Design Gate's API conflict
 * decision requires. Raw PostgreSQL constraint/error text is never exposed.
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

  if (typeof body !== 'object' || body === null) {
    return invalidRequest('Request body must be a JSON object.');
  }
  const record = body as Record<string, unknown>;

  const patientId = stringField(record, 'patientId') ?? '';
  const practitionerId = stringField(record, 'practitionerId') ?? '';
  const conversationIdRaw = record.conversationId;
  const startsAtRaw = stringField(record, 'startsAt') ?? '';
  const endsAtRaw = stringField(record, 'endsAt') ?? '';

  if (!UUID_PATTERN.test(patientId)) {
    return invalidRequest('patientId must be a valid UUID.');
  }
  if (!UUID_PATTERN.test(practitionerId)) {
    return invalidRequest('practitionerId must be a valid UUID.');
  }

  let conversationId: string | null = null;
  if (conversationIdRaw !== undefined && conversationIdRaw !== null) {
    if (typeof conversationIdRaw !== 'string' || !UUID_PATTERN.test(conversationIdRaw)) {
      return invalidRequest('conversationId must be a valid UUID.');
    }
    conversationId = conversationIdRaw;
  }

  const startsAt = new Date(startsAtRaw);
  const endsAt = new Date(endsAtRaw);
  if (Number.isNaN(startsAt.getTime())) {
    return invalidRequest('startsAt must be a valid ISO 8601 timestamp.');
  }
  if (Number.isNaN(endsAt.getTime())) {
    return invalidRequest('endsAt must be a valid ISO 8601 timestamp.');
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return invalidRequest('endsAt must be strictly after startsAt.');
  }

  try {
    const appointment = await bookAppointment(session.clinicId, {
      patientId,
      practitionerId,
      conversationId,
      startsAt,
      endsAt,
    });
    return NextResponse.json({ data: appointment }, { status: 201 });
  } catch (err) {
    if (
      err instanceof PractitionerNotFoundError ||
      err instanceof PatientNotFoundError ||
      err instanceof ConversationPatientMismatchError
    ) {
      return notFoundResponse();
    }
    if (err instanceof AppointmentConflictError) {
      return NextResponse.json(
        { error: { code: 'conflict', message: err.message } },
        { status: 409 },
      );
    }
    throw err;
  }
}
