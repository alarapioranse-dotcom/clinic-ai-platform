import type { Metadata } from 'next';

import { Container } from '@/components/ui/Container';

import { PRIVACY_LOCALE_ORDER, PRIVACY_NOTICES } from './content';

export const metadata: Metadata = {
  title: 'إشعار الخصوصية · Ενημέρωση προστασίας δεδομένων · Privacy notice',
};

/**
 * `/privacy` (docs/product/04-sitemap.md): static and public. One page holds
 * the notice in Arabic, Greek and English; each language is its own section
 * with its own `lang` and `dir`, reachable from the links at the top.
 */
export default function PrivacyPage() {
  return (
    <Container className="max-w-3xl py-12">
      <nav aria-label="Languages" className="flex flex-wrap gap-4 text-sm">
        {PRIVACY_LOCALE_ORDER.map((locale) => (
          <a key={locale} href={`#${locale}`} lang={locale} className="underline">
            {PRIVACY_NOTICES[locale].languageName}
          </a>
        ))}
      </nav>
      {PRIVACY_LOCALE_ORDER.map((locale) => {
        const notice = PRIVACY_NOTICES[locale];
        return (
          <article
            key={locale}
            id={locale}
            lang={locale}
            dir={notice.direction}
            className="border-line mt-10 border-t pt-10 first-of-type:border-t-0"
          >
            <h1 className="font-display text-3xl font-bold">{notice.title}</h1>
            <p className="text-muted mt-2 text-sm">{notice.updated}</p>
            {notice.sections.map((section) => (
              <section key={section.heading} className="mt-8">
                <h2 className="font-display text-xl font-bold">{section.heading}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mt-3 leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
          </article>
        );
      })}
    </Container>
  );
}
