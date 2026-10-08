/**
 * Internal to this feature — re-exported from `./index.ts`.
 *
 * ADR-0023 decision 6: a password set through invitation acceptance (and any
 * future password-setting path) must be 12 to 128 characters, counted as
 * Unicode code points, with no composition rules and no forced rotation
 * (NIST SP 800-63B). The upper bound limits request size and hashing input;
 * `hashPassword` itself imposes no length limit.
 *
 * No Unicode normalisation is applied: sign-in compares the password exactly
 * as typed, so normalising only here would make the new account unusable.
 * Existing sign-in does not enforce this policy on already-stored hashes.
 */
export const NEW_PASSWORD_MIN_LENGTH = 12;
export const NEW_PASSWORD_MAX_LENGTH = 128;

export class InvalidNewPasswordError extends Error {
  constructor() {
    super(
      `Password must be between ${NEW_PASSWORD_MIN_LENGTH} and ${NEW_PASSWORD_MAX_LENGTH} characters.`,
    );
    this.name = 'InvalidNewPasswordError';
  }
}

/** Length in Unicode code points (an emoji outside the BMP counts as one). */
export function passwordLength(password: string): number {
  return [...password].length;
}

export function validateNewPassword(password: string): void {
  const length = passwordLength(password);
  if (length < NEW_PASSWORD_MIN_LENGTH || length > NEW_PASSWORD_MAX_LENGTH) {
    throw new InvalidNewPasswordError();
  }
}
