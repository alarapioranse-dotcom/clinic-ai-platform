import { describe, it, expect, vi } from 'vitest';

import {
  INVITE_PASSWORD_MAX_LENGTH,
  INVITE_PASSWORD_MIN_LENGTH,
  codePointLength,
  takeInvitationToken,
} from '@/app/(auth)/invite/invite-token';
import { NEW_PASSWORD_MAX_LENGTH, NEW_PASSWORD_MIN_LENGTH } from '@/features/auth';
import nextConfig from '../../../next.config';

/**
 * Owner decision I2: the raw token is read from the URL fragment and removed
 * from the visible URL immediately; /invite sends no Referer.
 */
describe('takeInvitationToken', () => {
  it('returns the fragment and removes it from the URL, keeping path and query', () => {
    const replaceState = vi.fn();
    const token = takeInvitationToken(
      { hash: '#abcDEF_123-xyz', pathname: '/invite', search: '' },
      { replaceState },
    );
    expect(token).toBe('abcDEF_123-xyz');
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/invite');
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain('abcDEF_123-xyz');
  });

  it('keeps an existing query string but never the token', () => {
    const replaceState = vi.fn();
    takeInvitationToken({ hash: '#tok', pathname: '/invite', search: '?x=1' }, { replaceState });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/invite?x=1');
  });

  it('returns null and leaves history alone when there is no fragment', () => {
    const replaceState = vi.fn();
    expect(
      takeInvitationToken({ hash: '', pathname: '/invite', search: '' }, { replaceState }),
    ).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('returns null for an empty fragment and still clears the "#"', () => {
    const replaceState = vi.fn();
    expect(
      takeInvitationToken({ hash: '#', pathname: '/invite', search: '' }, { replaceState }),
    ).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/invite');
  });
});

describe('client-side password length mirror', () => {
  it('matches the server policy exactly', () => {
    expect(INVITE_PASSWORD_MIN_LENGTH).toBe(NEW_PASSWORD_MIN_LENGTH);
    expect(INVITE_PASSWORD_MAX_LENGTH).toBe(NEW_PASSWORD_MAX_LENGTH);
  });

  it('counts code points', () => {
    expect(codePointLength('🔒🔒')).toBe(2);
  });
});

describe('/invite headers (next.config.ts)', () => {
  it('sets Referrer-Policy: no-referrer for /invite after the catch-all rule', async () => {
    const rules = await nextConfig.headers!();
    const catchAll = rules.findIndex((rule) => rule.source === '/:path*');
    const invite = rules.findIndex((rule) => rule.source === '/invite');
    expect(catchAll).toBeGreaterThanOrEqual(0);
    expect(invite).toBeGreaterThan(catchAll);
    expect(rules[invite]!.headers).toEqual([{ key: 'Referrer-Policy', value: 'no-referrer' }]);
  });
});
