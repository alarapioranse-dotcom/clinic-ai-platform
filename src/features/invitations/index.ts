/**
 * Public entry point for the `invitations` feature. Only this module is a
 * valid import target for other features or for `src/app/**` code.
 *
 * Scope (ADR-0023, Accepted): accepting a one-time invitation (PR B), and the
 * token and link helpers the operator provisioning script uses to issue one
 * (PR C, scripts/provision-clinic.ts). The staff page is a later slice.
 *
 * Acceptance creates the staff member and nothing else: per ADR-0023
 * decision 3 it creates **no session**. The invitee then signs in through
 * the existing sign-in flow.
 */
import { createHash, randomBytes } from 'node:crypto';

import { acceptInvitationInDatabase } from '@/lib/db';
import { hashPassword, validateNewPassword } from '@/features/auth';

/**
 * The raw token is 32 random bytes encoded base64url without padding: always
 * exactly 43 characters from this alphabet (ADR-0023 decision 2).
 */
const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * `SHA-256(raw token)` as lowercase hex — the only form of the token that is
 * ever stored or sent to the database (ADR-0023 decision 2; the same scheme
 * as session tokens, src/features/auth/token.ts).
 */
export function hashInvitationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * A new raw invitation token: 32 bytes from the cryptographically secure
 * generator, base64url without padding (43 characters). The caller stores
 * only `hashInvitationToken(token)` and shows the raw value once.
 */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The one-time link for a raw token: `<app url>/invite#<token>`. The token is
 * in the URL fragment so browsers never send it to the server (ADR-0023
 * decision 2).
 */
export function buildInvitationLink(appUrl: string, rawToken: string): string {
  return `${appUrl.replace(/\/+$/, '')}/invite#${rawToken}`;
}

export type AcceptInvitationResult =
  { outcome: 'accepted' } | { outcome: 'invalid' } | { outcome: 'email_taken' };

/**
 * Validates the new password (12–128 code points; throws
 * `InvalidNewPasswordError` from `@/features/auth`), then, for a token of the
 * right shape, hashes the password with the existing Argon2id `hashPassword`
 * and the token with SHA-256, and calls the database function with those two
 * hashes only.
 *
 * A token of the wrong shape is `invalid`, the same outcome as an unknown,
 * used or expired one, and costs no Argon2id work or database call.
 * The raw token and password are never returned, logged or stored.
 */
export async function acceptInvitation(
  rawToken: string,
  password: string,
): Promise<AcceptInvitationResult> {
  validateNewPassword(password);

  if (!RAW_TOKEN_PATTERN.test(rawToken)) {
    return { outcome: 'invalid' };
  }

  const passwordHash = await hashPassword(password);
  const tokenHash = hashInvitationToken(rawToken);
  const row = await acceptInvitationInDatabase(tokenHash, passwordHash);

  switch (row.outcome) {
    case 'accepted':
      return { outcome: 'accepted' };
    case 'email_taken':
      return { outcome: 'email_taken' };
    default:
      return { outcome: 'invalid' };
  }
}
