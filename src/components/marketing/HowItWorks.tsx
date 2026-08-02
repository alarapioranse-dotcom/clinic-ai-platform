import { Container } from '@/components/ui/Container';
import { SectionHeading } from '@/components/ui/SectionHeading';

const STEPS = [
  {
    number: '٠١',
    title: 'يصل رد المريض',
    description: 'رسالة المريض تصل من قناة التواصل الخاصة بالعيادة وتُحفظ ضمن سجل المحادثة.',
  },
  {
    number: '٠٢',
    title: 'تُفهم الحاجة',
    description: 'تُحدَّد نية المريض — استفسار، حجز موعد، أو سؤال عن خدمة من قاعدة معرفة العيادة.',
  },
  {
    number: '٠٣',
    title: 'يُحجز الموعد',
    description: 'يُقترح أقرب وقت متاح في جدول العيادة، ويُؤكَّد الموعد مع المريض تلقائيًا.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-line border-b py-20">
      <Container>
        <SectionHeading
          eyebrow="كيف تعمل المنصة"
          title="ثلاث خطوات من الرسالة إلى الموعد"
          description="تصميم مبسّط يوضح مسار العملية الأساسي الذي ستُبنى عليه مراحل المنصة القادمة."
        />

        <ol className="mt-12 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step) => (
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
