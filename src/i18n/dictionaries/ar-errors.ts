import type { enErrors } from './en-errors';

/**
 * The Arabic `errors` namespace in its own module, typed against the English
 * `errors` contract. The marketing root layout passes it explicitly to the
 * error page (src/app/(marketing)/layout.tsx), so marketing errors stay
 * Arabic whatever the staff UI's fallback is.
 */
export const arErrors: typeof enErrors = {
  label: 'خطأ غير متوقع',
  title: 'حدث خطأ ما',
  body: 'نعتذر عن هذا الإزعاج. حاول مرة أخرى، وإذا استمرت المشكلة تواصل معنا.',
  code: 'رمز الخطأ: {digest}',
  retry: 'إعادة المحاولة',
};
