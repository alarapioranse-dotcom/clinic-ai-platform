import { Container } from '@/components/ui/Container';
import { SectionHeading } from '@/components/ui/SectionHeading';

const CAPABILITIES = [
  {
    title: 'الرد على المرضى',
    description: 'إدارة محادثات المرضى عبر قنوات متعددة من مكان واحد.',
  },
  {
    title: 'حجز المواعيد',
    description: 'ربط طلبات المرضى بجدول العيادة الفعلي واقتراح أقرب وقت متاح.',
  },
  {
    title: 'قاعدة معرفة العيادة',
    description: 'مصدر موحّد لمعلومات الخدمات والأسعار وساعات العمل لكل عيادة.',
  },
  {
    title: 'دعم متعدد العيادات',
    description: 'كل عيادة تدير بياناتها ومحادثاتها بشكل مستقل داخل نفس المنصة.',
  },
];

export function CapabilitiesGrid() {
  return (
    <section id="capabilities" className="border-line border-b py-20">
      <Container>
        <SectionHeading
          eyebrow="الإمكانيات"
          title="ما تقدمه المنصة لعيادتك"
          description="نظرة عامة على قدرات المنصة المستهدفة عبر مراحل التطوير القادمة."
        />

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {CAPABILITIES.map((capability) => (
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
