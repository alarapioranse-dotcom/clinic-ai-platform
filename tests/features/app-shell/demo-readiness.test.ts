import { describe, it, expect } from 'vitest';

import { environmentNotice } from '@/config/environment-notice';
import { signOutOutcome } from '@/components/app/sign-out';
import { AVAILABLE_LOCALES, getDictionary } from '@/i18n/dictionaries';

/**
 * docs/operations/2026-10-21-demo-environment-option-c.md, rule 3: every
 * non-production environment shows a "no real patient data" notice, and
 * production never does. Since ADR-0027 the notice text comes from the
 * dictionary of the active locale, so this is checked for every locale that
 * has one.
 */
describe('environmentNotice', () => {
  for (const locale of AVAILABLE_LOCALES) {
    const messages = getDictionary(locale).environmentNotice;

    it(`never shows a notice in production (${locale})`, () => {
      expect(environmentNotice('production', messages)).toBeNull();
    });

    it(`shows the dictionary's notice in staging and development (${locale})`, () => {
      expect(environmentNotice('staging', messages)).toBe(messages.staging);
      expect(environmentNotice('development', messages)).toBe(messages.development);
      expect(messages.staging).not.toBe(messages.development);
    });
  }

  // Rule 3's content requirement, checked on the Arabic text itself: both
  // notices must say not to enter real patient data, and name their environment.
  it('says "no real patient data" and names the environment in Arabic', () => {
    const messages = getDictionary('ar').environmentNotice;
    expect(messages.staging).toContain('لا تُدخل بيانات مرضى');
    expect(messages.development).toContain('لا تُدخل بيانات مرضى');
    expect(messages.staging).toContain('بيئة تجريبية');
    expect(messages.development).toContain('بيئة تطوير');
  });
});

/**
 * The sign-out button only reports success when POST /api/auth/sign-out says
 * the visitor is signed out (200 revoked, 401 no valid session); any other
 * status keeps the visitor on the page with an error instead of pretending.
 */
describe('signOutOutcome', () => {
  it('treats 200 (session revoked) as signed out', () => {
    expect(signOutOutcome(200)).toBe('signed_out');
  });

  it('treats 401 (no valid session) as signed out', () => {
    expect(signOutOutcome(401)).toBe('signed_out');
  });

  for (const status of [400, 403, 404, 429, 500, 502, 503]) {
    it(`treats ${status} as an error, not a sign-out`, () => {
      expect(signOutOutcome(status)).toBe('error');
    });
  }
});
