import { Container } from '@/components/ui/Container';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { LAUNCH_PHASES, type MarketingDictionary } from '@/i18n/marketing';

export function LaunchStatus({ t }: { t: MarketingDictionary['launch'] }) {
  return (
    <section id="launch-status" className="py-20">
      <Container>
        <SectionHeading eyebrow={t.eyebrow} title={t.title} description={t.description} />
        <ol className="border-line mt-12 divide-y rounded-xl border">
          {LAUNCH_PHASES.map((phase) => (
            <li key={phase.id} className="flex items-start justify-between gap-4 p-5">
              <div>
                <h3 className="font-display text-base font-bold">{t.phases[phase.id].title}</h3>
                <p className="text-muted mt-1 text-sm">{t.phases[phase.id].description}</p>
              </div>
              <span
                className={
                  phase.status === 'done'
                    ? 'bg-pine shrink-0 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap text-white'
                    : 'bg-mint text-pine-deep shrink-0 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap'
                }
              >
                {t.statusLabels[phase.status]}
              </span>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
