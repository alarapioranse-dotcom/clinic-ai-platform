import { Container } from '@/components/ui/Container';
import { SectionHeading } from '@/components/ui/SectionHeading';
import type { MarketingDictionary } from '@/i18n/marketing';

export function HowItWorks({ t }: { t: MarketingDictionary['how'] }) {
  return (
    <section id="how-it-works" className="border-line border-b py-20">
      <Container>
        <SectionHeading eyebrow={t.eyebrow} title={t.title} description={t.description} />
        <ol className="mt-12 grid gap-6 sm:grid-cols-3">
          {t.steps.map((step) => (
            <li key={step.number} className="border-line bg-paper rounded-xl border p-6">
              <span className="text-pine font-mono text-sm font-semibold">{step.number}</span>
              <h3 className="font-display mt-3 text-lg font-bold">{step.title}</h3>
              <p className="text-muted mt-2 text-sm">{step.description}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
