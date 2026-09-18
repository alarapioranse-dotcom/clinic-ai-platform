/**
 * Public entry point for the `appointments` feature (roadmap P4 Slice 1:
 * "persisted schedule -> compute available slots at read time -> select a
 * slot -> book appointment -> persist appointment -> optionally link the
 * appointment to its originating conversation -> return the booked
 * appointment"). Only this module — never `./repository` or `./schedule` —
 * is a valid import target for other features or for `src/app/**`
 * route/page code.
 *
 * `getAvailableSlots`: the read path behind `GET
 * /api/appointments/availability`. Computes candidate slots from persisted
 * schedule data (`clinics.working_hours` / `staff_members.working_hours`)
 * plus existing active appointment state — read-only, performs zero writes,
 * and its output is advisory (P4 Design Gate, Availability section): no
 * `available_slots` table exists, and nothing here reserves a slot.
 *
 * `listPractitionersForClinic`: the minimal read the booking UI's
 * practitioner picker needs. Not a general staff-management feature — just
 * enough to enumerate who Slice 1's booking flow can book.
 *
 * `bookAppointment`: the write path behind `POST /api/appointments` — the
 * feature's own public entry point owns slot-matching/validation, booking
 * orchestration, and appointment persistence (P4 Design Gate, Booking
 * section). The final INSERT relies on the `appointments_no_double_booking`
 * EXCLUDE constraint as the sole concurrency authority; this function does
 * not re-check availability before writing.
 *
 * Every function here runs inside one `withTenantContext` transaction: the
 * caller supplies `clinicId` (resolved elsewhere — the session, in
 * production), and RLS plus the composite foreign keys and EXCLUDE
 * constraint in `db/migrations/0011_appointments.sql` are the actual
 * isolation and integrity boundary, not any filtering done here.
 */
import { withTenantContext } from '@/lib/db';
import {
  computeAvailableSlots,
  dayBoundsUtc,
  zonedDayBoundsUtc,
  getWindowForDate,
  isValidIanaTimeZone,
  localWindowToUtcInstants,
  type TimeSlot,
  type WorkingHoursJson,
  type DayWindow,
} from './schedule';
import {
  getEffectiveSchedule,
  listActiveAppointmentsForPractitionerOnDate,
  listPractitioners,
  insertAppointment,
  PractitionerNotFoundError,
  PatientNotFoundError,
  ConversationPatientMismatchError,
  AppointmentConflictError,
  type Appointment,
  type Practitioner,
  type BookAppointmentInput,
} from './repository';

export type {
  Appointment,
  Practitioner,
  BookAppointmentInput,
  TimeSlot,
  WorkingHoursJson,
  DayWindow,
};
export {
  computeAvailableSlots,
  dayBoundsUtc,
  zonedDayBoundsUtc,
  getWindowForDate,
  isValidIanaTimeZone,
  localWindowToUtcInstants,
};
export {
  PractitionerNotFoundError,
  PatientNotFoundError,
  ConversationPatientMismatchError,
  AppointmentConflictError,
};

/**
 * Computes available `durationMinutes`-long slots for `practitionerId` on
 * `date` (a `YYYY-MM-DD` string, interpreted as the practitioner's owning
 * clinic's own local calendar date — ADR-0016). Throws
 * `PractitionerNotFoundError` if `practitionerId` isn't an active
 * practitioner in this clinic.
 */
export async function getAvailableSlots(
  clinicId: string,
  practitionerId: string,
  date: string,
  durationMinutes: number,
): Promise<TimeSlot[]> {
  return withTenantContext(clinicId, async (client) => {
    const schedule = await getEffectiveSchedule(client, clinicId, practitionerId);
    if (!schedule) {
      throw new PractitionerNotFoundError();
    }
    const { workingHours, timeZone } = schedule;

    const window = getWindowForDate(workingHours, date);
    const { dayStart, dayEnd } = zonedDayBoundsUtc(date, timeZone);
    const busyIntervals = await listActiveAppointmentsForPractitionerOnDate(
      client,
      clinicId,
      practitionerId,
      dayStart,
      dayEnd,
    );

    return computeAvailableSlots(window, date, timeZone, durationMinutes, busyIntervals);
  });
}

export async function listPractitionersForClinic(clinicId: string): Promise<Practitioner[]> {
  return withTenantContext(clinicId, (client) => listPractitioners(client, clinicId));
}

/**
 * Books one appointment. `conversationId` is optional (owner decision 2, P4
 * Design Gate): when supplied, the database's
 * `appointments_conversation_same_patient` composite foreign key
 * structurally requires it to belong to `input.patientId`, translated here
 * to `ConversationPatientMismatchError`. Throws `PractitionerNotFoundError`
 * / `PatientNotFoundError` for a nonexistent or cross-clinic reference, and
 * `AppointmentConflictError` for a double-booking rejected by the
 * `appointments_no_double_booking` EXCLUDE constraint — the API layer maps
 * that specifically to `409` with the stable, user-facing conflict message.
 */
export async function bookAppointment(
  clinicId: string,
  input: BookAppointmentInput,
): Promise<Appointment> {
  return withTenantContext(clinicId, (client) => insertAppointment(client, clinicId, input));
}
