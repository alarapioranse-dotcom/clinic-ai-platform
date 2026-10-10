/** Shown instead of the staff screens to a role that does not manage staff. */
export function StaffAccessDenied({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      <p role="alert" className="mt-4 text-sm font-medium text-red-700">
        ليس لديك صلاحية للوصول إلى إدارة الطاقم.
      </p>
      <p className="text-muted mt-2 text-sm">
        إدارة الطاقم والدعوات متاحة لمالك العيادة والمسؤول فقط.
      </p>
    </div>
  );
}
