import { DEFAULT_LOCALE, isLocale, type Locale } from './config';

/** One entry of an Accept-Language header, as RFC 9110 §12.5.4 defines it. */
export interface LanguageRange {
  /** Lower-cased language range, for example `el-gr`, `en` or `*`. */
  tag: string;
  /** Quality weight in [0, 1]; 1 when the entry has no `q` parameter. */
  q: number;
}

const LANGUAGE_RANGE = /^(?:\*|[a-z]{1,8}(?:-[a-z0-9]{1,8})*)$/;
const QUALITY = /^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/**
 * Parses an Accept-Language header into ranges ordered by preference: highest
 * `q` first, header order kept between equal weights. Malformed entries are
 * dropped, never guessed at; entries with `q=0` ("not acceptable") are dropped.
 */
export function parseAcceptLanguage(header: string | null | undefined): LanguageRange[] {
  if (!header) return [];
  const ranges: { tag: string; q: number; index: number }[] = [];

  for (const [index, part] of header.split(',').entries()) {
    const [rawTag, ...params] = part.split(';').map((piece) => piece.trim().toLowerCase());
    if (!rawTag || !LANGUAGE_RANGE.test(rawTag)) continue;

    let q = 1;
    let valid = true;
    for (const param of params) {
      const match = QUALITY.exec(param.replace(/\s+/g, ''));
      if (!match) {
        valid = false;
        break;
      }
      q = Number(match[1]);
    }
    if (!valid || q === 0) continue;
    ranges.push({ tag: rawTag, q, index });
  }

  return ranges.sort((a, b) => b.q - a.q || a.index - b.index).map(({ tag, q }) => ({ tag, q }));
}

/**
 * The first available locale the header asks for, matching on the primary
 * subtag (`el-GR` → `el`). `*` expresses no preference of its own and is
 * skipped, so it falls through to the default like a header with no match.
 */
export function matchAcceptLanguage(
  header: string | null | undefined,
  available: readonly Locale[],
): Locale | null {
  for (const { tag } of parseAcceptLanguage(header)) {
    if (tag === '*') continue;
    const primary = tag.split('-')[0];
    if (isLocale(primary) && available.includes(primary)) return primary;
  }
  return null;
}

/**
 * ADR-0027 decision 3, restricted to the locales that have a dictionary
 * (`available`, never empty): (a) a valid `locale` cookie, (b) the best
 * Accept-Language match, (c) the default locale. A locale without a
 * dictionary is never returned: when the default has none, the first
 * available locale is used. In slice 1 only `ar` is available, so every
 * request resolves to `ar`.
 */
export function resolveLocale({
  cookie,
  acceptLanguage,
  available,
}: {
  cookie: string | null | undefined;
  acceptLanguage: string | null | undefined;
  available: readonly Locale[];
}): Locale {
  const fallback = available[0];
  if (fallback === undefined) {
    throw new Error('resolveLocale: no locale has a dictionary');
  }
  if (isLocale(cookie) && available.includes(cookie)) return cookie;
  const fromHeader = matchAcceptLanguage(acceptLanguage, available);
  if (fromHeader) return fromHeader;
  return available.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : fallback;
}
