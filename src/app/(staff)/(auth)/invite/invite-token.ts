/**
 * Browser-side helpers for /invite (ADR-0023; Owner decision I2). Pure and
 * dependency-free so they are unit-testable without a browser and safe to
 * import from a client component.
 */

/**
 * Mirrors NEW_PASSWORD_MIN_LENGTH / NEW_PASSWORD_MAX_LENGTH in
 * `@/features/auth` (which cannot be imported into client code: it pulls in
 * argon2). A unit test keeps the two equal. The server is the authority;
 * this only gives an early message.
 */
export const INVITE_PASSWORD_MIN_LENGTH = 12;
export const INVITE_PASSWORD_MAX_LENGTH = 128;

export function codePointLength(value: string): number {
  return [...value].length;
}

interface LocationLike {
  hash: string;
  pathname: string;
  search: string;
}

interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string): void;
}

/**
 * Reads the raw token from the URL fragment (`/invite#<token>`) and removes
 * it from the visible URL and the current history entry at once, so it does
 * not stay in the address bar or browser history. The caller keeps the
 * returned value in memory only — never localStorage, sessionStorage or a
 * cookie. The fragment is never sent to the server by the browser.
 *
 * Returns null when there is no token.
 */
export function takeInvitationToken(location: LocationLike, history: HistoryLike): string | null {
  const fragment = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (location.hash !== '') {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
  return fragment === '' ? null : fragment;
}
