import { randomBytes, createHash } from 'node:crypto';

/**
 * Internal to this feature — not exported from `./index.ts`. Session token
 * strategy pinned per docs/adr/0012-authentication-bootstrap-security-definer.md
 * (Decision 3, human-approved): 32 random bytes, base64url-encoded, as the
 * raw token; only its SHA-256 hex digest is ever persisted. The raw token
 * itself already carries full entropy (it is never user-chosen), so a fast
 * cryptographic hash — not a slow password-hashing algorithm like
 * Argon2id — is the correct, sufficient choice for `token_hash`.
 */

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
