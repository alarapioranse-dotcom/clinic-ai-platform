import { Container } from '@/components/ui/Container';
import { SectionHeading } from '@/components/ui/SectionHeading';
import type { MarketingDictionary } from '@/i18n/marketing';

export function CapabilitiesGrid({ t }: { t: MarketingDictionary['capabilities'] }) {
  return (
    <section id="capabilities" className="border-line border-b py-20">
      <Container>
        <SectionHeading eyebrow={t.eyebrow} title={t.title} description={t.description} />
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {t.items.map((capability) => (
            <div key={capability.title} className="border-line bg-paper rounded-xl border p-6">
              <h3 className="font-display text-lg font-bold">{capability.title}</h3>
              <p className="text-muted mt-2 text-sm">{capability.description}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
