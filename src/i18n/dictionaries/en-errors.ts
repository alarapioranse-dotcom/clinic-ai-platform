/**
 * The English `errors` namespace in its own module. It defines the `errors`
 * contract every dictionary satisfies, and src/i18n/ErrorsProvider.tsx (a
 * client component) imports it as the staff error page's fallback, so the
 * browser never receives the rest of a dictionary through that import.
 */
export const enErrors = {
  label: 'Unexpected error',
  title: 'Something went wrong',
  body: 'Sorry for the inconvenience. Please try again, and if the problem continues, contact us.',
  code: 'Error code: {digest}',
  retry: 'Try again',
};
