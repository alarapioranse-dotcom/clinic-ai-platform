import { getClinicSettings, supportedTimeZones } from '@/features/clinic';

import { ClinicSettingsForm } from './ClinicSettingsForm';
import { clinicSettingsAccess } from './access';

/**
 * /dashboard/settings/clinic (docs/product/05-screen-inventory.md; ADR-0022).
 * Owner and admin edit the clinic's working hours and IANA timezone; every
 * other role gets the access-denied message from the server, never the form.
 *
 * The form is pre-filled from the server (acceptance criteria: no separate
 * empty state), and receives the exact list of time zones the API accepts.
 */
export default async function ClinicSettingsPage() {
  const { allowed, clinicId } = await clinicSettingsAccess();

  if (!allowed) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-2xl font-bold">إعدادات العيادة</h1>
        <p role="alert" className="mt-4 text-sm font-medium text-red-700">
          ليس لديك صلاحية للوصول إلى إعدادات العيادة.
        </p>
        <p className="text-muted mt-2 text-sm">
          تعديل ساعات العمل والمنطقة الزمنية متاح لمالك العيادة والمسؤول فقط.
        </p>
      </div>
    );
  }

  const settings = await getClinicSettings(clinicId);
  const zones = supportedTimeZones();
  // A stored zone the runtime does not list (for example an old alias) is
  // still shown, so the select never silently displays a different value.
  const timeZones = zones.includes(settings.timezone) ? zones : [settings.timezone, ...zones];

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold">إعدادات العيادة</h1>
      <p className="text-muted mt-2 text-sm">
        ساعات العمل والمنطقة الزمنية التي تعتمد عليها مواعيد الحجز المتاحة.
      </p>
      <ClinicSettingsForm
        initialWorkingHours={settings.workingHours}
        initialTimeZone={settings.timezone}
        timeZones={[...timeZones]}
      />
    </div>
  );
}
