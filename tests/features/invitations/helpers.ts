/**
 * Helpers for the invitation feature tests: auth is imported only through
 * its public entry point, and a stored hash is verified with argon2 directly
 * (the auth feature does not export its verify function).
 */
import * as argon2 from 'argon2';

export { InvalidNewPasswordError, signIn, validateSession } from '@/features/auth';

export async function verifyPasswordForTest(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
