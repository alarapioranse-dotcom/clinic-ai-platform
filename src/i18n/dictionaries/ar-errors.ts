/**
 * The Arabic `errors` namespace in its own module: src/app/(staff)/error.tsx
 * (a client component) imports it as its fallback, so the browser never
 * receives the rest of the Arabic dictionary through that import.
 */
export const arErrors = {
  label: 'خطأ غير متوقع',
  title: 'حدث خطأ ما',
  body: 'نعتذر عن هذا الإزعاج. حاول مرة أخرى، وإذا استمرت المشكلة تواصل معنا.',
  code: 'رمز الخطأ: {digest}',
  retry: 'إعادة المحاولة',
};
