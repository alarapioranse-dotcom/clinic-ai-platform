import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMarketingDictionary, LAUNCH_PHASES } from '@/i18n/marketing';
import { ar } from '@/i18n/marketing/ar';
import { el } from '@/i18n/marketing/el';
import { en } from '@/i18n/marketing/en';

/** The public home page in the visitor's language (ADR-0029). */
const request = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  acceptLanguage: null as string | null,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'locale' && request.cookie !== undefined ? { value: request.cookie } : undefined,
  }),
  headers: async () => ({
    get: (name: string) => (name === 'accept-language' ? request.acceptLanguage : null),
  }),
}));

beforeEach(() => {
  request.cookie = undefined;
  request.acceptLanguage = null;
});

async function renderHome() {
  const { default: Home } = await import('@/app/(marketing)/page');
  return renderToStaticMarkup(await Home());
}

const dictionaries = { ar, el, en } as const;
const locales = ['ar', 'el', 'en'] as const;

/** Every string in a dictionary, with the path it sits at. */
function leaves(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, path ? `${path}.${key}` : key),
  );
}

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');

describe('home page', () => {
  for (const locale of locales) {
    it(`renders every home-page string of the ${locale} dictionary and none of another language`, async () => {
      request.cookie = locale;
      const html = await renderHome();
      const { hero, how, capabilities, launch } = dictionaries[locale];
      for (const [path, text] of leaves({ hero, how, capabilities, launch })) {
        if (path === 'launch.statusLabels.planned') continue; // no phase is planned today
        expect(html, path).toContain(escapeHtml(text));
      }
      for (const other of locales) {
        if (other !== locale)
          expect(html).not.toContain(escapeHtml(dictionaries[other].hero.title));
      }
    });
  }

  it('follows Accept-Language without a cookie and falls back to Greek', async () => {
    request.acceptLanguage = 'en-US,en;q=0.9';
    expect(await renderHome()).toContain(escapeHtml(en.hero.title));
    request.acceptLanguage = 'ar';
    expect(await renderHome()).toContain(ar.hero.title);
    request.acceptLanguage = null;
    expect(await renderHome()).toContain(el.hero.title);
  });

  it('lets the cookie win over Accept-Language', async () => {
    request.cookie = 'ar';
    request.acceptLanguage = 'el-GR,el;q=0.9';
    expect(await renderHome()).toContain(ar.hero.title);
  });

  it('marks exactly one schedule slot as booked', async () => {
    request.cookie = 'en';
    const html = await renderHome();
    expect(html.split(`>${en.hero.slotBooked}<`).length - 1).toBe(1);
    expect(html.split(`>${en.hero.slotFree}<`).length - 1).toBe(4);
  });
});

describe('home page text', () => {
  it('has the same number of steps, capabilities and slots in every language', () => {
    for (const locale of ['ar', 'el'] as const) {
      const d = dictionaries[locale];
      expect(d.how.steps.length).toBe(en.how.steps.length);
      expect(d.capabilities.items.length).toBe(en.capabilities.items.length);
      expect(d.hero.slotTimes.length).toBe(en.hero.slotTimes.length);
      expect(leaves(d).map(([path]) => path)).toEqual(leaves(en).map(([path]) => path));
    }
  });

  it('is written in its own language', () => {
    const digitsOnly = /^[\p{Nd}:]+$/u;
    for (const [path, text] of leaves(ar)) {
      if (!digitsOnly.test(text)) expect(text, path).toMatch(/\p{Script=Arabic}/u);
      expect(text, path).not.toMatch(/\p{Script=Greek}/u);
    }
    for (const [path, text] of leaves(el)) {
      if (!digitsOnly.test(text)) expect(text, path).toMatch(/\p{Script=Greek}/u);
      expect(text, path).not.toMatch(/\p{Script=Arabic}/u);
    }
    for (const [path, text] of leaves(en)) {
      expect(text, path).not.toMatch(/[\p{Script=Arabic}\p{Script=Greek}]/u);
    }
  });

  it('returns the dictionary for each locale', () => {
    for (const locale of locales) expect(getMarketingDictionary(locale)).toBe(dictionaries[locale]);
  });

  it('does not promise automatic confirmation or several channels, which are not built', () => {
    for (const [, text] of leaves(en)) {
      expect(text).not.toMatch(/automatic|multiple channels|WhatsApp/i);
    }
    for (const [, text] of leaves(ar)) expect(text).not.toMatch(/تلقائي|قنوات متعددة/);
  });
});

describe('launch phases', () => {
  it('matches the phase statuses in README.md', () => {
    const readme = readFileSync(join(__dirname, '..', '..', '..', 'README.md'), 'utf8');
    for (const phase of ['P2', 'P3', 'P4']) {
      expect(readme).toMatch(new RegExp(`\\*\\*${phase} — [^*]+:\\*\\* Done`));
    }
    expect(readme).toMatch(/\*\*P5 — [^*]+:\*\* In progress/);
    expect(LAUNCH_PHASES.map((phase) => phase.status)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'in-progress',
    ]);
  });
});
