import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { validateSession, SESSION_COOKIE_NAME } from '@/features/auth';
import { STAFF_MANAGER_ROLES } from '@/features/staff';

/**
 * /dashboard/staff and /dashboard/staff/invite are for owner and admin only
 * (docs/product/04-sitemap.md). Guarded server-side before anything renders —
 * docs/product/06-acceptance-criteria.md: a practitioner or receptionist
 * navigating here directly is denied access. The API remains the
 * authorization boundary for every read and write.
 */
export async function staffPageAccess(): Promise<{
  allowed: boolean;
  clinicId: string;
  role: string;
}> {
  const cookieStore = await cookies();
  const session = await validateSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!session) {
    redirect('/login');
  }

  return {
    allowed: (STAFF_MANAGER_ROLES as readonly string[]).includes(session.role),
    clinicId: session.clinicId,
    role: session.role,
  };
}
