import { env } from '@/lib/env';
import type { SiteConfig } from '@/types';

export const siteConfig: SiteConfig = {
  name: 'منصة العيادة الذكية',
  description: 'منصة ذكاء اصطناعي متعددة العيادات للرد على المرضى وحجز المواعيد وإدارة المعرفة.',
  locale: 'ar',
  direction: 'rtl',
  url: env.appUrl,
};
