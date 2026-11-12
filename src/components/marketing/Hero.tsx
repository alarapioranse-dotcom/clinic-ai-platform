import { Container } from '@/components/ui/Container';
import { Badge } from '@/components/ui/Badge';

import type { MarketingDictionary } from '@/i18n/marketing';

/** Index of the slot shown as booked in the illustration. */
const BOOKED_SLOT = 2;

export function Hero({ t }: { t: MarketingDictionary['hero'] }) {
  const slots = t.slotTimes.map((time, index) => ({
    time,
    booked: index === BOOKED_SLOT,
    label: index === BOOKED_SLOT ? t.slotBooked : t.slotFree,
  }));
  return (
    <section className="border-line border-b py-20 sm:py-28">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <Badge>{t.badge}</Badge>
          <h1 className="font-display mt-5 text-4xl leading-tight font-extrabold text-balance sm:text-5xl">
            {t.title}
          </h1>
          <p className="text-muted mt-5 text-lg text-balance">{t.subtitle}</p>
        </div>

        <div
          className="border-line bg-mint/30 mx-auto mt-14 max-w-4xl rounded-2xl border p-4 sm:p-6"
          aria-label={t.demoLabel}
        >
          <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
            <div className="bg-paper border-line flex-1 rounded-xl border p-4 shadow-sm">
              <p className="text-muted font-mono text-xs">{t.incomingLabel}</p>
              <p className="text-ink mt-2 text-sm">{t.incomingMessage}</p>
            </div>

            <div className="text-muted hidden shrink-0 sm:block ltr:rotate-180" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path
                  d="M15 6l-6 6 6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <div className="flex-1">
              <p className="text-muted mb-2 font-mono text-xs">{t.scheduleLabel}</p>
              <ol className="flex items-stretch gap-1.5">
                {slots.map((slot) => (
                  <li
                    key={slot.time}
                    className={
                      slot.booked
                        ? 'bg-pine min-w-0 flex-1 rounded-lg px-1 py-3 text-center text-white shadow-sm'
                        : 'bg-paper border-line min-w-0 flex-1 rounded-lg border px-1 py-3 text-center'
                    }
                  >
                    <span
                      className={
                        slot.booked
                          ? 'block font-mono text-xs font-medium text-white'
                          : 'text-muted block font-mono text-xs'
                      }
                    >
                      {slot.time}
                    </span>
                    <span
                      className={
                        slot.booked
                          ? 'mt-1 block truncate text-[11px] font-medium'
                          : 'text-muted mt-1 block truncate text-[11px]'
                      }
                    >
                      {slot.label}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
