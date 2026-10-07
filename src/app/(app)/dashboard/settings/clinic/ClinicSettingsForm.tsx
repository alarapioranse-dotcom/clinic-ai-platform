'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';

type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

/** `GET /api/clinic`'s normalised working hours: every weekday present, `null` = closed. */
export type WorkingHoursValue = Record<Weekday, { start: string; end: string } | null>;

const DAYS: { key: Weekday; label: string }[] = [
  { key: 'monday', label: 'الاثنين' },
  { key: 'tuesday', label: 'الثلاثاء' },
  { key: 'wednesday', label: 'الأربعاء' },
  { key: 'thursday', label: 'الخميس' },
  { key: 'friday', label: 'الجمعة' },
  { key: 'saturday', label: 'السبت' },
  { key: 'sunday', label: 'الأحد' },
];

const DEFAULT_OPEN = { start: '09:00', end: '17:00' };

interface DayState {
  open: boolean;
  start: string;
  end: string;
}

type DaysState = Record<Weekday, DayState>;

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'invalid'; message: string }
  | { status: 'forbidden' }
  | { status: 'error' };

function toDaysState(hours: WorkingHoursValue): DaysState {
  const result = {} as DaysState;
  for (const { key } of DAYS) {
    const window = hours[key];
    result[key] = window
      ? { open: true, start: window.start, end: window.end }
      : { open: false, ...DEFAULT_OPEN };
  }
  return result;
}

function toWorkingHours(days: DaysState): WorkingHoursValue {
  const result = {} as WorkingHoursValue;
  for (const { key } of DAYS) {
    const day = days[key];
    result[key] = day.open ? { start: day.start, end: day.end } : null;
  }
  return result;
}

/** Same rule the API enforces; checked here first so the message is in Arabic. */
function firstInvalidDay(days: DaysState): string | null {
  for (const { key, label } of DAYS) {
    const day = days[key];
    if (!day.open) continue;
    if (!/^\d{2}:\d{2}$/.test(day.start) || !/^\d{2}:\d{2}$/.test(day.end)) {
      return `أدخل وقت البداية والنهاية ليوم ${label}.`;
    }
    if (day.start >= day.end) {
      return `في يوم ${label} يجب أن يكون وقت البداية قبل وقت النهاية (بلا تجاوز منتصف الليل).`;
    }
  }
  return null;
}

/**
 * docs/product/06-acceptance-criteria.md's /dashboard/settings/clinic: fields
 * pre-filled from the server; on a failed save, "Couldn't save changes" with
 * a retry, and the edits stay in the form. Owner decision S3: changing the
 * timezone asks for explicit confirmation before saving.
 */
export function ClinicSettingsForm({
  initialWorkingHours,
  initialTimeZone,
  timeZones,
}: {
  initialWorkingHours: WorkingHoursValue;
  initialTimeZone: string;
  timeZones: string[];
}) {
  const router = useRouter();
  const [days, setDays] = useState<DaysState>(() => toDaysState(initialWorkingHours));
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [savedTimeZone, setSavedTimeZone] = useState(initialTimeZone);
  const [confirmingTimeZone, setConfirmingTimeZone] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

  function updateDay(key: Weekday, patch: Partial<DayState>) {
    setDays((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
    setSaveState({ status: 'idle' });
  }

  async function save() {
    setConfirmingTimeZone(false);
    setSaveState({ status: 'saving' });
    try {
      const response = await fetch('/api/clinic', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workingHours: toWorkingHours(days), timezone: timeZone }),
      });
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (response.status === 403) {
        setSaveState({ status: 'forbidden' });
        return;
      }
      if (response.status === 400) {
        setSaveState({
          status: 'invalid',
          message: 'لم تُقبل القيم المُدخلة. راجع ساعات العمل والمنطقة الزمنية ثم حاول مرة أخرى.',
        });
        return;
      }
      if (!response.ok) {
        throw new Error(`PATCH /api/clinic returned ${response.status}`);
      }
      const body: { data: { workingHours: WorkingHoursValue; timezone: string } } =
        await response.json();
      setDays(toDaysState(body.data.workingHours));
      setTimeZone(body.data.timezone);
      setSavedTimeZone(body.data.timezone);
      setSaveState({ status: 'saved' });
    } catch {
      // Edits stay in the form: nothing above resets `days` or `timeZone` on failure.
      setSaveState({ status: 'error' });
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const invalid = firstInvalidDay(days);
    if (invalid) {
      setSaveState({ status: 'invalid', message: invalid });
      return;
    }
    if (timeZone !== savedTimeZone) {
      setConfirmingTimeZone(true);
      return;
    }
    save();
  }

  const saving = saveState.status === 'saving';

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-10" noValidate>
      <fieldset>
        <legend className="text-lg font-semibold">ساعات العمل</legend>
        <p className="text-muted mt-1 text-sm">
          فترة واحدة لكل يوم، بتوقيت العيادة المحلي. اليوم غير المفعّل يعني أن العيادة مغلقة.
        </p>
        <div className="mt-4 divide-y divide-[var(--color-line)]">
          {DAYS.map(({ key, label }) => {
            const day = days[key];
            return (
              <div key={key} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <label className="flex w-32 items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={day.open}
                    onChange={(event) => updateDay(key, { open: event.target.checked })}
                    className="accent-[var(--color-pine)]"
                  />
                  {label}
                </label>
                {day.open ? (
                  <div className="flex items-center gap-2 text-sm" dir="ltr">
                    <input
                      type="time"
                      aria-label={`بداية ${label}`}
                      value={day.start}
                      onChange={(event) => updateDay(key, { start: event.target.value })}
                      className="border-line bg-paper rounded-lg border px-3 py-1.5"
                      required
                    />
                    <span aria-hidden="true">–</span>
                    <input
                      type="time"
                      aria-label={`نهاية ${label}`}
                      value={day.end}
                      onChange={(event) => updateDay(key, { end: event.target.value })}
                      className="border-line bg-paper rounded-lg border px-3 py-1.5"
                      required
                    />
                  </div>
                ) : (
                  <span className="text-muted text-sm">مغلق</span>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="clinic-timezone" className="text-lg font-semibold">
          المنطقة الزمنية
        </label>
        <p className="text-muted mt-1 text-sm">
          تُفسَّر ساعات العمل أعلاه بهذه المنطقة الزمنية، بما في ذلك التوقيت الصيفي.
        </p>
        <select
          id="clinic-timezone"
          dir="ltr"
          value={timeZone}
          onChange={(event) => {
            setTimeZone(event.target.value);
            setConfirmingTimeZone(false);
            setSaveState({ status: 'idle' });
          }}
          className="border-line bg-paper mt-3 w-full max-w-sm rounded-lg border px-3 py-2 text-sm"
        >
          {timeZones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </div>

      {confirmingTimeZone && (
        <div
          role="alertdialog"
          aria-labelledby="tz-confirm-title"
          className="border-line rounded-xl border bg-white p-4"
        >
          <p id="tz-confirm-title" className="text-sm font-semibold">
            تأكيد تغيير المنطقة الزمنية
          </p>
          <p className="text-muted mt-2 text-sm">
            ستتغير المنطقة الزمنية من <span dir="ltr">{savedTimeZone}</span> إلى{' '}
            <span dir="ltr">{timeZone}</span>. ستُفهم ساعات العمل بالتوقيت الجديد، فتتغير الأوقات
            المتاحة للحجز. المواعيد المحجوزة مسبقًا لا تتغير.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" onClick={save}>
              تأكيد وحفظ
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirmingTimeZone(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {!confirmingTimeZone && (
          <Button type="submit" disabled={saving}>
            {saving ? 'جارٍ الحفظ...' : 'حفظ التغييرات'}
          </Button>
        )}
        {saveState.status === 'saved' && (
          <p role="status" className="text-pine text-sm font-medium">
            تم حفظ التغييرات.
          </p>
        )}
        {saveState.status === 'invalid' && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {saveState.message}
          </p>
        )}
        {saveState.status === 'forbidden' && (
          <p role="alert" className="text-sm font-medium text-red-700">
            ليس لديك صلاحية لتعديل إعدادات العيادة.
          </p>
        )}
        {saveState.status === 'error' && (
          <div>
            <p role="alert" className="text-sm font-medium text-red-700">
              تعذر حفظ التغييرات
            </p>
            <Button type="button" variant="secondary" onClick={save} className="mt-3">
              إعادة المحاولة
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
