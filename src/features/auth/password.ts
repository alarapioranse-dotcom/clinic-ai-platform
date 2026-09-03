import * as argon2 from 'argon2';

/**
 * Internal to this feature — not exported from `./index.ts`. Argon2id
 * parameters pinned per docs/adr/0012-authentication-bootstrap-security-definer.md
 * (human-approved) / docs/technical/04-auth-implementation.md: OWASP's
 * first-listed (memory-optimized) Argon2id configuration. Change these only
 * alongside an update to that documentation — they are a deliberate,
 * reviewed choice, not left un-pinned.
 */
const ARGON2_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Fixed, precomputed Argon2id hash of a constant, non-secret string —
 * generated once with the exact parameters above, never a real credential
 * for any account. Verification against it is expected to always fail; its
 * only purpose is to make sign-in's "unknown email" path do comparable
 * Argon2id work to its "wrong password" path, per the timing side-channel
 * mitigation ADR-0012 requires (Decision 8, human-approved) — otherwise an
 * unknown-email response would return measurably faster than a
 * wrong-password response, letting a caller infer which case occurred
 * without the response body saying so.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$6GAKDdlXyFeLYwKY7zw64A$0pztHc/U494Jvl6yjxaVyf9pZJophq4+U3OCftYr9Cg';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_HASH_OPTIONS);
}

/**
 * `argon2.verify` reads its parameters back out of the encoded hash string
 * itself (self-describing format), so no options are passed here.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** See DUMMY_PASSWORD_HASH above. Return value is deliberately ignored by every caller. */
export async function verifyDummyPassword(password: string): Promise<void> {
  await verifyPassword(DUMMY_PASSWORD_HASH, password);
}
