import { getI18n } from '@/i18n/server';

export default async function DashboardPage() {
  const { t } = await getI18n();

  return (
    <div className="mx-auto max-w-2xl px-6 py-20 text-center">
      <h1 className="font-display text-2xl font-bold">{t.dashboard.title}</h1>
      <p className="text-muted mt-3 text-sm">{t.dashboard.welcome}</p>
      <p className="text-muted mt-2 text-sm">{t.dashboard.autoRepliesOff}</p>
    </div>
  );
}
