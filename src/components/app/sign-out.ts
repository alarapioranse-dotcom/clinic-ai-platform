/**
 * What the sign-out button does with the status of POST /api/auth/sign-out
 * (docs/technical/03-api-contracts.md). Pure so it is unit-testable without a
 * browser.
 *
 * - 200: the session was revoked and the cookie cleared.
 * - 401: there was no valid session to revoke (already signed out or
 *   expired), so the visitor is signed out either way.
 * - Anything else: the session may still be valid, so the button must not
 *   pretend the sign-out worked.
 */
export type SignOutOutcome = 'signed_out' | 'error';

export function signOutOutcome(status: number): SignOutOutcome {
  return status === 200 || status === 401 ? 'signed_out' : 'error';
}
