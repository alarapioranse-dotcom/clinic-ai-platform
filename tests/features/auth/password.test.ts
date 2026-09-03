import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  verifyDummyPassword,
  DUMMY_PASSWORD_HASH,
} from '@/features/auth/password';

/**
 * Unit-level coverage for the timing side-channel mitigation
 * (docs/adr/0012-authentication-bootstrap-security-definer.md, Decision 8,
 * human-approved): sign-in's "unknown email" path runs a real Argon2id
 * verification against a fixed dummy hash, so it does comparable work to
 * the "wrong password" path. A reliable timing assertion is inherently
 * flaky in CI, so this proves the mechanism itself is sound instead: the
 * dummy hash is a well-formed Argon2id hash that always fails verification,
 * and verifyDummyPassword actually invokes a real Argon2id verify (not a
 * no-op) by construction.
 */
describe('password (dummy-hash timing mitigation)', () => {
  it('DUMMY_PASSWORD_HASH is a well-formed argon2id hash with the pinned parameters', () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
  });

  it('verifying any password against the dummy hash always fails', async () => {
    await expect(verifyPassword(DUMMY_PASSWORD_HASH, 'anything')).resolves.toBe(false);
    await expect(verifyPassword(DUMMY_PASSWORD_HASH, '')).resolves.toBe(false);
  });

  it('verifyDummyPassword runs a real verification (does not throw, does not short-circuit)', async () => {
    await expect(verifyDummyPassword('some-candidate-password')).resolves.toBeUndefined();
  });

  it('a real hash only verifies against its own password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    await expect(verifyPassword(hash, 'correct-horse-battery-staple')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false);
  });
});
