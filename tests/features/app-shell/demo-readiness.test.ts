import { describe, it, expect } from 'vitest';

import { environmentNotice } from '@/config/environment-notice';
import { signOutOutcome } from '@/components/app/sign-out';

/**
 * docs/operations/2026-10-21-demo-environment-option-c.md, rule 3: every
 * non-production environment shows a "no real patient data" notice, and
 * production never does.
 */
describe('environmentNotice', () => {
  it('never shows a notice in production', () => {
    expect(environmentNotice('production')).toBeNull();
  });

  for (const appEnv of ['staging', 'development'] as const) {
    it(`shows a no-real-patient-data notice in ${appEnv}`, () => {
      const notice = environmentNotice(appEnv);
      expect(notice).not.toBeNull();
      expect(notice).toContain('لا تُدخل بيانات مرضى');
    });
  }

  it('labels staging as the demo environment and development as development', () => {
    expect(environmentNotice('staging')).toContain('بيئة تجريبية');
    expect(environmentNotice('development')).toContain('بيئة تطوير');
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
