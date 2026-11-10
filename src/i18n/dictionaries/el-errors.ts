import type { enErrors } from './en-errors';

/**
 * The Greek `errors` namespace in its own module, typed against the English
 * `errors` contract (ADR-0027 slice 3).
 */
export const elErrors: typeof enErrors = {
  label: 'Απρόσμενο σφάλμα',
  title: 'Κάτι πήγε στραβά',
  body: 'Ζητούμε συγγνώμη για την ταλαιπωρία. Δοκιμάστε ξανά και, αν το πρόβλημα συνεχιστεί, επικοινωνήστε μαζί μας.',
  code: 'Κωδικός σφάλματος: {digest}',
  retry: 'Δοκιμάστε ξανά',
};
