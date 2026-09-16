import { DatabaseError, type PoolClient } from 'pg';

import type { TimeSlot, WorkingHoursJson } from './schedule';

/**
 * Internal to this feature — not exported from `./index.ts`. Nothing outside
 * `src/features/appointments/**` may import this module directly (see
 * CONTRIBUTING.md, "a feature never imports another feature's internals").
 */

export type AppointmentStatus = 'booked' | 'rescheduled' | 'cancelled' | 'completed';

export interface Appointment {
  id: string;
  clinicId: string;
  patientId: string;
  practitionerId: string;
  conversationId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Practitioner {
  id: string;
  email: string;
}

interface AppointmentRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  practitioner_id: string;
  conversation_id: string | null;
  starts_at: Date;
  ends_at: Date;
  status: AppointmentStatus;
  created_at: Date;
  updated_at: Date;
}

function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    practitionerId: row.practitioner_id,
    conversationId: row.conversation_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Thrown when `practitionerId` doesn't resolve to an active `practitioner`-
 * role staff member in this clinic — covers "doesn't exist," "belongs to a
 * different clinic," and "exists but isn't a practitioner" identically
 * (same 404-collapsing rationale as `ConversationNotFoundError` in
 * `src/features/conversations/repository.ts`): none of those cases should
 * be distinguishable to a caller, cross-tenant or otherwise.
 */
export class PractitionerNotFoundError extends Error {
  constructor() {
    super('Practitioner not found');
    this.name = 'PractitionerNotFoundError';
  }
}

/**
 * Thrown by `insertAppointment` when `patientId` doesn't exist in this
 * clinic — surfaces the `appointments_patient_same_clinic` composite foreign
 * key violation (`db/migrations/0011_appointments.sql`), same "let the
 * schema be the isolation boundary" pattern as `ConversationNotFoundError`.
 */
export class PatientNotFoundError extends Error {
  constructor() {
    super('Patient not found');
    this.name = 'PatientNotFoundError';
  }
}

/**
 * Thrown by `insertAppointment` when `conversationId` is supplied but
 * doesn't belong to `patientId` — surfaces the
 * `appointments_conversation_same_patient` composite foreign key violation.
 * Also covers a nonexistent conversationId, indistinguishably (same
 * rationale as the errors above).
 */
export class ConversationPatientMismatchError extends Error {
  constructor() {
    super('Conversation does not belong to this patient');
    this.name = 'ConversationPatientMismatchError';
  }
}

/**
 * Thrown by `insertAppointment` when the `appointments_no_double_booking`
 * EXCLUDE constraint (`db/migrations/0011_appointments.sql`) rejects the
 * write — ADR-0014's hard invariant, enforced atomically by PostgreSQL, not
 * by an application-level check-then-insert. The feature's public entry
 * point (`index.ts`) is what the HTTP layer imports this through; the API
 * route translates it to `409` with the stable, user-facing message from
 * the P4 Design Gate's API conflict decision — never raw Postgres error
 * text.
 */
export class AppointmentConflictError extends Error {
  constructor() {
    super('The selected appointment slot is no longer available.');
    this.name = 'AppointmentConflictError';
  }
}

/**
 * Resolves the practitioner's own `staff_members.working_hours` override if
 * present, else the clinic's default `clinics.working_hours` — "when
 * present, it overrides the Clinic's default WorkingHours for that
 * Practitioner specifically... when absent, the Clinic default applies"
 * (docs/domain/01-entities.md, StaffMember #8) is a whole-value override,
 * not a per-day merge. Returns `null` if `practitionerId` isn't an active
 * `practitioner`-role staff member of this clinic — callers translate that
 * to `PractitionerNotFoundError`.
 */
export async function getEffectiveWorkingHours(
  client: PoolClient,
  clinicId: string,
  practitionerId: string,
): Promise<WorkingHoursJson | null> {
  const { rows } = await client.query<{
    role: string;
    status: string;
    working_hours: WorkingHoursJson | null;
  }>(`SELECT role, status, working_hours FROM staff_members WHERE id = $1 AND clinic_id = $2`, [
    practitionerId,
    clinicId,
  ]);

  const staff = rows[0];
  if (!staff || staff.role !== 'practitioner' || staff.status !== 'active') {
    return null;
  }
  if (staff.working_hours) {
    return staff.working_hours;
  }

  const { rows: clinicRows } = await client.query<{ working_hours: WorkingHoursJson }>(
    `SELECT working_hours FROM clinics WHERE id = $1`,
    [clinicId],
  );
  return clinicRows[0]?.working_hours ?? {};
}

/**
 * Lists every active (`booked`/`rescheduled`) appointment for this
 * practitioner overlapping `[dayStart, dayEnd)` — the busy intervals
 * `schedule.ts`'s `computeAvailableSlots` subtracts from the working-hours
 * window. `cancelled`/`completed` appointments are excluded here the same
 * way they're excluded from `appointments_no_double_booking`'s conflict set
 * (ADR-0014 points 3-4) — this is application code mirroring that
 * constraint's own WHERE clause for a read, not a separate invariant.
 */
export async function listActiveAppointmentsForPractitionerOnDate(
  client: PoolClient,
  clinicId: string,
  practitionerId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<TimeSlot[]> {
  const { rows } = await client.query<{ starts_at: Date; ends_at: Date }>(
    `SELECT starts_at, ends_at FROM appointments
     WHERE clinic_id = $1 AND practitioner_id = $2
       AND status IN ('booked', 'rescheduled')
       AND starts_at < $4 AND ends_at > $3`,
    [clinicId, practitionerId, dayStart, dayEnd],
  );
  return rows.map((row) => ({ startsAt: row.starts_at, endsAt: row.ends_at }));
}

/** Active practitioners (role = 'practitioner', status = 'active') in this clinic, for the booking UI's picker. */
export async function listPractitioners(
  client: PoolClient,
  clinicId: string,
): Promise<Practitioner[]> {
  const { rows } = await client.query<{ id: string; email: string }>(
    `SELECT id, email FROM staff_members
     WHERE clinic_id = $1 AND role = 'practitioner' AND status = 'active'
     ORDER BY email`,
    [clinicId],
  );
  return rows;
}

export interface BookAppointmentInput {
  patientId: string;
  practitionerId: string;
  conversationId: string | null;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Books one appointment. `practitionerId` is validated against
 * `staff_members` explicitly (role/status can't be expressed as a foreign
 * key target), matching `PractitionerNotFoundError`'s 404-collapsing
 * contract; `patient_id` and `conversation_id` are deliberately NOT
 * pre-checked here (same "let the schema be the isolation boundary" pattern
 * `src/features/conversations/repository.ts`'s `insertStaffMessage`
 * follows) — the composite foreign keys in
 * `db/migrations/0011_appointments.sql` are what reject them, caught below.
 *
 * The INSERT is the authoritative booking transaction (P4 Design Gate,
 * Booking section): nothing here re-validates the requested interval
 * against working hours — that check (`schedule.ts` /
 * `getAvailableSlots`) is advisory only, and the
 * `appointments_no_double_booking` EXCLUDE constraint is the sole
 * concurrency authority. No advisory-lock fallback exists in this design.
 */
export async function insertAppointment(
  client: PoolClient,
  clinicId: string,
  input: BookAppointmentInput,
): Promise<Appointment> {
  const { rows: staffRows } = await client.query<{ role: string; status: string }>(
    `SELECT role, status FROM staff_members WHERE id = $1 AND clinic_id = $2`,
    [input.practitionerId, clinicId],
  );
  const staff = staffRows[0];
  if (!staff || staff.role !== 'practitioner' || staff.status !== 'active') {
    throw new PractitionerNotFoundError();
  }

  try {
    const { rows } = await client.query<AppointmentRow>(
      `INSERT INTO appointments (clinic_id, patient_id, practitioner_id, conversation_id, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, clinic_id, patient_id, practitioner_id, conversation_id, starts_at, ends_at, status, created_at, updated_at`,
      [
        clinicId,
        input.patientId,
        input.practitionerId,
        input.conversationId,
        input.startsAt,
        input.endsAt,
      ],
    );

    const row = rows[0];
    if (!row) {
      throw new Error('Insert into appointments returned no row');
    }
    return toAppointment(row);
  } catch (err) {
    if (err instanceof DatabaseError) {
      if (err.constraint === 'appointments_no_double_booking') {
        throw new AppointmentConflictError();
      }
      if (err.constraint === 'appointments_patient_same_clinic') {
        throw new PatientNotFoundError();
      }
      if (err.constraint === 'appointments_conversation_same_patient') {
        throw new ConversationPatientMismatchError();
      }
      if (err.constraint === 'appointments_practitioner_same_clinic') {
        throw new PractitionerNotFoundError();
      }
    }
    throw err;
  }
}
