import type { Metadata } from 'next';

import { Container } from '@/components/ui/Container';
import { getLocale } from '@/i18n/server';

import { PRIVACY_NOTICES } from './content';

export async function generateMetadata(): Promise<Metadata> {
  return { title: PRIVACY_NOTICES[await getLocale()].title };
}

/**
 * `/privacy` (docs/product/04-sitemap.md): public. It shows the notice in the
 * visitor's language only (ADR-0029 decision 3); the other two languages are
 * reached through the language switcher in the header.
 */
export default async function PrivacyPage() {
  const notice = PRIVACY_NOTICES[await getLocale()];
  return (
    <Container className="max-w-3xl py-12">
      <article>
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
    </Container>
  );
}
