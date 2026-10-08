import { describe, it, expect } from 'vitest';

import {
  validateNewPassword,
  passwordLength,
  InvalidNewPasswordError,
  NEW_PASSWORD_MIN_LENGTH,
  NEW_PASSWORD_MAX_LENGTH,
} from '@/features/auth';

/**
 * ADR-0023 decision 6: 12–128 Unicode code points, no composition rules.
 */
describe('new-password policy', () => {
  it('is 12 to 128 characters', () => {
    expect(NEW_PASSWORD_MIN_LENGTH).toBe(12);
    expect(NEW_PASSWORD_MAX_LENGTH).toBe(128);
  });

  it.each([
    ['11 characters', 'a'.repeat(11), false],
    ['12 characters', 'a'.repeat(12), true],
    ['128 characters', 'a'.repeat(128), true],
    ['129 characters', 'a'.repeat(129), false],
    ['empty', '', false],
  ])('%s → accepted: %s', (_label, password, accepted) => {
    if (accepted) {
      expect(() => validateNewPassword(password)).not.toThrow();
    } else {
      expect(() => validateNewPassword(password)).toThrow(InvalidNewPasswordError);
    }
  });

  it('requires no composition: lowercase letters only, digits only, spaces only are all accepted', () => {
    for (const password of ['abcdefghijkl', '123456789012', ' '.repeat(12)]) {
      expect(() => validateNewPassword(password)).not.toThrow();
    }
  });

  it('counts Unicode code points, not UTF-16 code units', () => {
    // Each emoji is one code point but two UTF-16 code units.
    const twelveEmoji = '🔒'.repeat(12);
    expect(twelveEmoji.length).toBe(24);
    expect(passwordLength(twelveEmoji)).toBe(12);
    expect(() => validateNewPassword(twelveEmoji)).not.toThrow();

    const elevenEmoji = '🔒'.repeat(11);
    expect(elevenEmoji.length).toBe(22);
    expect(() => validateNewPassword(elevenEmoji)).toThrow(InvalidNewPasswordError);

    const hundredTwentyNineEmoji = '🔒'.repeat(129);
    expect(() => validateNewPassword(hundredTwentyNineEmoji)).toThrow(InvalidNewPasswordError);
  });

  it('accepts Arabic passwords by code point count', () => {
    expect(() => validateNewPassword('كلمةمرورطويل')).not.toThrow();
    expect(passwordLength('كلمةمرورطويل')).toBe(12);
    expect(() => validateNewPassword('كلمةمرورطوي')).toThrow(InvalidNewPasswordError);
  });

  it('never includes the password in the error message', () => {
    const password = 'short-secret';
    try {
      validateNewPassword(password.slice(0, 5));
    } catch (err) {
      expect((err as Error).message).not.toContain('short');
    }
  });
});
