'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';

interface Practitioner {
  id: string;
  email: string;
}

interface SlotRow {
  startsAt: string;
  endsAt: string;
}

interface BookedAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
}

type PractitionersState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; practitioners: Practitioner[] };

type SlotsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; slots: SlotRow[] };

type BookingState =
  { status: 'idle' | 'booking' | 'error' } | { status: 'booked'; appointment: BookedAppointment };

const DEFAULT_DURATION_MINUTES = 30;

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * roadmap P4 Slice 1's minimal receptionist-facing flow: "conversation ->
 * find available slots -> select slot -> book -> show successful
 * appointment." Rendered only for the roles `POST /api/appointments`
 * actually allows (mirrors `ConversationDetailPage`'s own `REPLY_ROLES`
 * pattern for the reply form) — the API remains the real authorization
 * boundary regardless of this component's own gating.
 */
export function BookAppointment({
  conversationId,
  patientId,
  onBooked,
  locale,
  t,
}: {
  conversationId: string;
  patientId: string;
  /** Called after a successful booking so the parent can re-fetch the
   * conversation detail and pick up the now-persisted appointment via the
   * conversation-detail appointment readback — without this, the
   * confirmation below is the only place a freshly booked appointment is
   * visible until the next full reload. */
  onBooked?: () => void;
  locale: Locale;
  t: Dictionary['booking'];
}) {
  const [practitionersState, setPractitionersState] = useState<PractitionersState>({
    status: 'loading',
  });
  const [practitionerId, setPractitionerId] = useState('');
  const [date, setDate] = useState(todayUtcDateString());
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION_MINUTES);
  const [slotsState, setSlotsState] = useState<SlotsState>({ status: 'idle' });
  const [booking, setBooking] = useState<BookingState>({ status: 'idle' });

  const loadPractitioners = useCallback(async () => {
    try {
      const response = await fetch('/api/appointments/practitioners');
      if (!response.ok) {
        throw new Error(`GET /api/appointments/practitioners returned ${response.status}`);
      }
      const body: { data: Practitioner[] } = await response.json();
      setPractitionersState({ status: 'ready', practitioners: body.data });
      if (body.data[0]) {
        setPractitionerId((current) => current || body.data[0]!.id);
      }
    } catch {
      setPractitionersState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPractitioners();
  }, [loadPractitioners]);

  async function findSlots() {
    if (!practitionerId) return;
    setSlotsState({ status: 'loading' });
    setBooking({ status: 'idle' });
    try {
      const params = new URLSearchParams({
        practitionerId,
        date,
        durationMinutes: String(durationMinutes),
      });
      const response = await fetch(`/api/appointments/availability?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`GET /api/appointments/availability returned ${response.status}`);
      }
      const body: { data: { slots: SlotRow[] } } = await response.json();
      setSlotsState({ status: 'ready', slots: body.data.slots });
    } catch {
      setSlotsState({ status: 'error' });
    }
  }

  async function bookSlot(slot: SlotRow) {
    setBooking({ status: 'booking' });
    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          patientId,
          practitionerId,
          conversationId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
        }),
      });
      if (!response.ok) {
        setBooking({ status: 'error' });
        return;
      }
      const body: { data: BookedAppointment } = await response.json();
      setBooking({ status: 'booked', appointment: body.data });
      setSlotsState({ status: 'idle' });
      onBooked?.();
    } catch {
      setBooking({ status: 'error' });
    }
  }

  return (
    <div className="border-line mt-6 flex flex-col gap-3 border-t pt-6">
      <h2 className="font-display text-lg font-bold">{t.title}</h2>

      {booking.status === 'booked' && (
        <p role="status" className="text-sm font-medium text-emerald-700">
          {format(t.booked, {
            start: new Date(booking.appointment.startsAt).toLocaleString(locale),
            end: new Date(booking.appointment.endsAt).toLocaleString(locale),
          })}
        </p>
      )}

      {practitionersState.status === 'loading' && (
        <p role="status" className="text-muted text-sm">
          {t.loadingPractitioners}
        </p>
      )}

      {practitionersState.status === 'error' && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.practitionersError}
        </p>
      )}

      {practitionersState.status === 'ready' && practitionersState.practitioners.length === 0 && (
        <p className="text-muted text-sm">{t.noPractitioners}</p>
      )}

      {practitionersState.status === 'ready' && practitionersState.practitioners.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t.practitioner}
            <select
              value={practitionerId}
              onChange={(event) => setPractitionerId(event.target.value)}
              className="border-line bg-paper text-ink rounded-lg border px-3 py-2 text-sm"
            >
              {practitionersState.practitioners.map((practitioner) => (
                <option key={practitioner.id} value={practitioner.id}>
                  {practitioner.email}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            {t.date}
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="border-line bg-paper text-ink rounded-lg border px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            {t.duration}
            <input
              type="number"
              min={1}
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value))}
              className="border-line bg-paper text-ink w-24 rounded-lg border px-3 py-2 text-sm"
            />
          </label>

          <Button onClick={findSlots} disabled={slotsState.status === 'loading'}>
            {slotsState.status === 'loading' ? t.searching : t.showSlots}
          </Button>
        </div>
      )}

      {slotsState.status === 'error' && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.slotsError}
        </p>
      )}

      {slotsState.status === 'ready' && slotsState.slots.length === 0 && (
        <p className="text-muted text-sm">{t.noSlots}</p>
      )}

      {slotsState.status === 'ready' && slotsState.slots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {slotsState.slots.map((slot) => (
            <Button
              key={slot.startsAt}
              variant="secondary"
              onClick={() => bookSlot(slot)}
              disabled={booking.status === 'booking'}
            >
              {new Date(slot.startsAt).toLocaleTimeString(locale, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Button>
          ))}
        </div>
      )}

      {booking.status === 'error' && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.bookError}
        </p>
      )}
    </div>
  );
}
