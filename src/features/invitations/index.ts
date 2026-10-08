/**
 * Public entry point for the `invitations` feature. Only this module is a
 * valid import target for other features or for `src/app/**` code.
 *
 * Scope (ADR-0023, Accepted; Owner decisions I1–I3 for PR B): accepting a
 * one-time invitation. Creating invitations (the provisioning script, the
 * staff page) is a later slice.
 *
 * Acceptance creates the staff member and nothing else: per ADR-0023
 * decision 3 it creates **no session**. The invitee then signs in through
 * the existing sign-in flow.
 */
import { createHash } from 'node:crypto';

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
