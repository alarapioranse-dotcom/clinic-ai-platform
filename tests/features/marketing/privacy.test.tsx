import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PRIVACY_LOCALE_ORDER,
  PRIVACY_NOTICES,
  PRIVACY_OPERATOR,
} from '@/app/(marketing)/privacy/content';
import { Footer } from '@/components/marketing/Footer';
import { getMarketingDictionary } from '@/i18n/marketing';

/**
 * `/privacy` (docs/product/04-sitemap.md and 06-acceptance-criteria.md):
 * public, and since ADR-0029 shown in the visitor's language only.
 */
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

async function renderPrivacy() {
  const { default: PrivacyPage } = await import('@/app/(marketing)/privacy/page');
  return renderToStaticMarkup(await PrivacyPage());
}

const script = { ar: /\p{Script=Arabic}/u, el: /\p{Script=Greek}/u, en: /[A-Za-z]/ } as const;

describe('/privacy page', () => {
  for (const locale of PRIVACY_LOCALE_ORDER) {
    it(`shows only the ${locale} notice to a visitor whose locale is ${locale}`, async () => {
      request.cookie = locale;
      const html = await renderPrivacy();
      expect(html.match(/<article/g)).toHaveLength(1);
      expect(html.match(/<h1/g)).toHaveLength(1);
      expect(html).toContain(`>${PRIVACY_NOTICES[locale].title}</h1>`);
      expect(html.match(/<h2/g)).toHaveLength(PRIVACY_NOTICES[locale].sections.length);
      for (const other of PRIVACY_LOCALE_ORDER) {
        if (other === locale) continue;
        expect(html).not.toContain(PRIVACY_NOTICES[other].sections[0]!.heading);
        expect(html).not.toContain(PRIVACY_NOTICES[other].updated);
      }
    });
  }

  it('follows Accept-Language without a cookie and falls back to Greek', async () => {
    request.acceptLanguage = 'ar-SA,ar;q=0.9';
    expect(await renderPrivacy()).toContain(PRIVACY_NOTICES.ar.updated);
    request.acceptLanguage = 'fr-FR,fr;q=0.9';
    expect(await renderPrivacy()).toContain(PRIVACY_NOTICES.el.updated);
  });

  it('titles the tab in the visitor language', async () => {
    const { generateMetadata } = await import('@/app/(marketing)/privacy/page');
    request.cookie = 'en';
    expect((await generateMetadata()).title).toBe('Privacy notice');
    request.cookie = 'ar';
    expect((await generateMetadata()).title).toBe(PRIVACY_NOTICES.ar.title);
  });

  it('reads no environment value or database, and is not a client component', () => {
    for (const file of ['page.tsx', 'content.ts']) {
      const source = readFileSync(
        join(__dirname, '..', '..', '..', 'src', 'app', '(marketing)', 'privacy', file),
        'utf8',
      );
      expect(source).not.toMatch(/process\.env|@\/lib\/(db|env)/);
      expect(source).not.toMatch(/['"]use client['"]/);
    }
  });

  it('is linked from the marketing footer in every language', () => {
    for (const locale of PRIVACY_LOCALE_ORDER) {
      const t = getMarketingDictionary(locale).footer;
      const html = renderToStaticMarkup(<Footer appName="X" t={t} />);
      expect(html).toContain('href="/privacy"');
      expect(html).toContain(t.privacy);
    }
  });

  it('says the language cookie is set for any visitor who picks a language', () => {
    const cookies = (locale: (typeof PRIVACY_LOCALE_ORDER)[number]) =>
      PRIVACY_NOTICES[locale].sections.find((s) => /cookies|الكوكيز/i.test(s.heading))!
        .paragraphs[0]!;
    expect(cookies('en')).toMatch(/any visitor or staff member/);
    expect(cookies('en')).toMatch(/only when that choice is made/);
    expect(cookies('ar')).toMatch(/أي زائر أو موظف/);
    expect(cookies('el')).toMatch(/οποιοσδήποτε επισκέπτης/);
  });
});

describe('privacy notice content', () => {
  it('has the same sections, in the same order and size, in every language', () => {
    const shape = (locale: (typeof PRIVACY_LOCALE_ORDER)[number]) =>
      PRIVACY_NOTICES[locale].sections.map((section) => section.paragraphs.length);
    expect(shape('ar')).toEqual(shape('en'));
    expect(shape('el')).toEqual(shape('en'));
    expect(shape('en').length).toBe(8);
  });

  for (const locale of PRIVACY_LOCALE_ORDER) {
    const notice = PRIVACY_NOTICES[locale];
    const text = notice.sections.flatMap((s) => [s.heading, ...s.paragraphs]).join('\n');

    it(`is written in its own language (${locale})`, () => {
      for (const section of notice.sections) {
        expect(section.heading, section.heading).toMatch(script[locale]);
        for (const paragraph of section.paragraphs) expect(paragraph).toMatch(script[locale]);
      }
      if (locale !== 'ar') expect(text).not.toMatch(script.ar);
      if (locale !== 'el') expect(text).not.toMatch(script.el);
    });

    it(`names the operator, the contact address, both sub-processors and the authority (${locale})`, () => {
      expect(text).toContain(PRIVACY_OPERATOR.name);
      expect(text).toContain(PRIVACY_OPERATOR.place[locale]);
      expect(text.split(PRIVACY_OPERATOR.email).length - 1).toBe(2);
      expect(text).toContain('Render Services, Inc.');
      expect(text).toContain('Scaleway SAS');
      expect(text).toContain('www.dpa.gr');
      expect(text).toContain('GDPR');
    });
  }

  it('makes the AI disclosures in every language', () => {
    const ai = (locale: (typeof PRIVACY_LOCALE_ORDER)[number]) =>
      PRIVACY_NOTICES[locale].sections[3]!.paragraphs.join('\n');
    // not switched on / staff approve / no medical advice / patients told / no training
    for (const pattern of [
      /not switched on/,
      /reviews and approves/,
      /does not give medical advice/,
      /Patients will be told/,
      /not used to train AI models/,
    ]) {
      expect(ai('en')).toMatch(pattern);
    }
    for (const pattern of [/غير مفعّلة/, /يوافق عليها/, /لا يقدّم نصائح طبية/, /لتدريب نماذج/]) {
      expect(ai('ar')).toMatch(pattern);
    }
    for (const pattern of [
      /δεν είναι ενεργοποιημένες/,
      /εγκρίνει/,
      /δεν παρέχει ιατρικές συμβουλές/,
      /εκπαίδευση μοντέλων/,
    ]) {
      expect(ai('el')).toMatch(pattern);
    }
  });
});
