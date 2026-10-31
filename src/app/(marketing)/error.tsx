'use client';

/**
 * The marketing pages have their own root layout, so they need their own
 * error boundary; it renders the same error page as the staff UI, with the
 * Arabic `errors` namespace the marketing root layout provides.
 */
export { default } from '../(staff)/error';
