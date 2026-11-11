import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PrivacyPage from '@/app/(marketing)/privacy/page';
import {
  PRIVACY_LOCALE_ORDER,
  PRIVACY_NOTICES,
  PRIVACY_OPERATOR,
} from '@/app/(marketing)/privacy/content';
import { Footer } from '@/components/marketing/Footer';

/**
 * `/privacy` (docs/product/04-sitemap.md and 06-acceptance-criteria.md):
 * static, public, and the same notice in Arabic, Greek and English.
 */
const html = renderToStaticMarkup(<PrivacyPage />);
const script = { ar: /\p{Script=Arabic}/u, el: /\p{Script=Greek}/u, en: /[A-Za-z]/ } as const;

describe('/privacy page', () => {
  it('renders one section per language with its own lang and dir, and a link to each', () => {
    expect(html).toContain('<article id="ar" lang="ar" dir="rtl"');
    expect(html).toContain('<article id="el" lang="el" dir="ltr"');
    expect(html).toContain('<article id="en" lang="en" dir="ltr"');
    for (const locale of PRIVACY_LOCALE_ORDER) {
      expect(html).toContain(`<a href="#${locale}" lang="${locale}"`);
      expect(html).toContain(PRIVACY_NOTICES[locale].title);
    }
  });

  it('is static: it reads no cookie, header, environment value or database', () => {
    for (const file of ['page.tsx', 'content.ts']) {
      const source = readFileSync(
        join(__dirname, '..', '..', '..', 'src', 'app', '(marketing)', 'privacy', file),
        'utf8',
      );
      expect(source).not.toMatch(/next\/headers|cookies\(|headers\(|process\.env|@\/lib\/(db|env)/);
      expect(source).not.toMatch(/['"]use client['"]/);
    }
  });

  it('is linked from the marketing footer', () => {
    expect(renderToStaticMarkup(<Footer />)).toContain('href="/privacy"');
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
