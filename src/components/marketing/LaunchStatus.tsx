import { Container } from '@/components/ui/Container';
import { SectionHeading } from '@/components/ui/SectionHeading';
import type { LaunchPhase } from '@/types';

const PHASES: LaunchPhase[] = [
  {
    id: 'p0',
    title: 'المرحلة صفر — الأساس التقني',
    description:
      'هيكلة المشروع، التصميم، وأدوات التطوير دون قاعدة بيانات أو مصادقة أو ذكاء اصطناعي.',
    status: 'done',
  },
  {
    id: 'p1',
    title: 'المرحلة الأولى — تعدد العيادات والبيانات',
    description: 'قاعدة بيانات مشتركة مع عزل بيانات كل عيادة.',
    status: 'planned',
  },
  {
    id: 'p2',
    title: 'المرحلة الثانية — المصادقة والصلاحيات',
    description: 'تسجيل الدخول وإدارة أدوار فريق العيادة.',
    status: 'planned',
  },
  {
    id: 'p3',
    title: 'المرحلة الثالثة — محادثات المرضى',
    description: 'استقبال رسائل المرضى والرد عليها ضمن سجل محادثة موحّد.',
    status: 'planned',
  },
  {
    id: 'p4',
    title: 'المرحلة الرابعة — حجز المواعيد',
    description: 'ربط المحادثات بجدول العيادة وتأكيد المواعيد.',
    status: 'planned',
  },
  {
    id: 'p5',
    title: 'المرحلة الخامسة — قاعدة المعرفة والذكاء الاصطناعي',
    description: 'إثراء الردود التلقائية بمعرفة كل عيادة الخاصة.',
    status: 'planned',
  },
];

const STATUS_LABEL: Record<LaunchPhase['status'], string> = {
  done: 'مكتملة',
  'in-progress': 'قيد التنفيذ',
  planned: 'مخطط لها',
};

export function LaunchStatus() {
  return (
    <section id="launch-status" className="py-20">
      <Container>
        <SectionHeading
          eyebrow="مراحل الإطلاق"
          title="أين نحن الآن"
          description="جدول تتبّع مراحل بناء المنصة من الأساس التقني وحتى الذكاء الاصطناعي الكامل."
        />

        <ol className="border-line mt-12 divide-y rounded-xl border">
          {PHASES.map((phase) => (
            <li key={phase.id} className="flex items-start justify-between gap-4 p-5">
              <div>
                <h3 className="font-display text-base font-bold">{phase.title}</h3>
                <p className="text-muted mt-1 text-sm">{phase.description}</p>
              </div>
              <span
                className={
                  phase.status === 'done'
                    ? 'bg-pine shrink-0 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap text-white'
                    : 'bg-mint text-pine-deep shrink-0 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap'
                }
              >
                {STATUS_LABEL[phase.status]}
              </span>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
