import { Container } from '@/components/ui/Container';
import { Badge } from '@/components/ui/Badge';

const SCHEDULE_SLOTS = [
  { time: '٠٩:٠٠', label: 'شاغر' },
  { time: '٠٩:٣٠', label: 'شاغر' },
  { time: '١٠:٠٠', label: 'محجوز', booked: true },
  { time: '١٠:٣٠', label: 'شاغر' },
  { time: '١١:٠٠', label: 'شاغر' },
];

export function Hero() {
  return (
    <section className="border-line border-b py-20 sm:py-28">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <Badge>المرحلة صفر — الأساس التقني</Badge>
          <h1 className="font-display mt-5 text-4xl leading-tight font-extrabold text-balance sm:text-5xl">
            من رسالة المريض إلى موعد محجوز، تلقائيًا
          </h1>
          <p className="text-muted mt-5 text-lg text-balance">
            منصة ذكاء اصطناعي متعددة العيادات تتولى الرد على المرضى، وحجز المواعيد، وإدارة قاعدة
            معرفة العيادة — في مكان واحد.
          </p>
        </div>

        <div
          className="border-line bg-mint/30 mx-auto mt-14 max-w-4xl rounded-2xl border p-4 sm:p-6"
          aria-label="عرض توضيحي: تحول رسالة مريض إلى موعد محجوز"
        >
          <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
            <div className="bg-paper border-line flex-1 rounded-xl border p-4 shadow-sm">
              <p className="text-muted font-mono text-xs">رسالة واردة من مريض</p>
              <p className="text-ink mt-2 text-sm">
                &ldquo;السلام عليكم، أحتاج موعد أسنان أقرب وقت متاح من فضلكم&rdquo;
              </p>
            </div>

            <div className="text-muted hidden shrink-0 sm:block" aria-hidden="true">
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
              <p className="text-muted mb-2 font-mono text-xs">جدول العيادة اليوم</p>
              <ol className="flex items-stretch gap-1.5" dir="rtl">
                {SCHEDULE_SLOTS.map((slot) => (
                  <li
                    key={slot.time}
                    className={
                      slot.booked
                        ? 'bg-pine flex-1 rounded-lg px-2 py-3 text-center text-white shadow-sm'
                        : 'bg-paper border-line flex-1 rounded-lg border px-2 py-3 text-center'
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
                          ? 'mt-1 block text-[11px] font-medium'
                          : 'text-muted mt-1 block text-[11px]'
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
