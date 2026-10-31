import type { Dictionary } from '@/i18n/dictionaries';

/** Shown instead of the staff screens to a role that does not manage staff. */
export function StaffAccessDenied({ title, t }: { title: string; t: Dictionary['staff'] }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      <p role="alert" className="mt-4 text-sm font-medium text-red-700">
        {t.deniedAlert}
      </p>
      <p className="text-muted mt-2 text-sm">{t.deniedHint}</p>
    </div>
  );
}
