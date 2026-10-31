import { getI18n } from '@/i18n/server';

import { PatientsList } from './PatientsList';

export default async function PatientsPage() {
  const { locale, t } = await getI18n();

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold">{t.patients.title}</h1>
      <p className="text-muted mt-2 text-sm">{t.patients.intro}</p>
      <PatientsList locale={locale} t={t.patients} />
    </div>
  );
}
