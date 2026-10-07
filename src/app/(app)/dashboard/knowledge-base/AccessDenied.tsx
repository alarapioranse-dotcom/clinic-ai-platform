/**
 * Shown to a signed-in role that may not manage the knowledge base. Rendered
 * by the server page instead of the screen, so no client component or API
 * request is ever sent for that role.
 */
export function KnowledgeBaseAccessDenied() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold">قاعدة المعرفة</h1>
      <p role="alert" className="mt-4 text-sm font-medium text-red-700">
        ليس لديك صلاحية للوصول إلى قاعدة المعرفة.
      </p>
      <p className="text-muted mt-2 text-sm">
        إدارة ما يعتمد عليه المساعد متاحة لمالك العيادة والمسؤول فقط.
      </p>
    </div>
  );
}
