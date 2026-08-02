'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-muted font-mono text-sm">خطأ غير متوقع</p>
        <h1 className="font-display mt-2 text-2xl font-bold">حدث خطأ ما</h1>
        <p className="text-muted mt-3 text-sm">
          نعتذر عن هذا الإزعاج. حاول مرة أخرى، وإذا استمرت المشكلة تواصل معنا.
        </p>
        {error.digest ? (
          <p className="text-muted mt-2 font-mono text-xs">رمز الخطأ: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="bg-pine mt-6 rounded-full px-6 py-2 text-sm font-medium text-white"
        >
          إعادة المحاولة
        </button>
      </div>
    </div>
  );
}
