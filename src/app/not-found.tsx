import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-muted font-mono text-sm">404</p>
        <h1 className="font-display mt-2 text-2xl font-bold">الصفحة غير موجودة</h1>
        <p className="text-muted mt-3 text-sm">
          الصفحة التي تبحث عنها غير متوفرة أو تم نقلها إلى مكان آخر.
        </p>
        <Link
          href="/"
          className="bg-pine mt-6 inline-block rounded-full px-6 py-2 text-sm font-medium text-white"
        >
          العودة إلى الصفحة الرئيسية
        </Link>
      </div>
    </div>
  );
}
