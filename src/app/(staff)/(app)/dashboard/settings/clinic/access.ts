import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { validateSession, SESSION_COOKIE_NAME } from '@/features/auth';
import { CLINIC_SETTINGS_MANAGER_ROLES } from '@/features/clinic';

/**
 * Owner decision S4: /dashboard/settings/clinic is for owner and admin only
 * (docs/product/04-sitemap.md). Guarded server-side before anything renders —
 * docs/product/06-acceptance-criteria.md: a practitioner or receptionist
 * navigating here directly is denied access. Returns the session's clinic id
 * so the page reads only that clinic. The API remains the authorization
 * boundary for the write itself.
 */
export async function clinicSettingsAccess(): Promise<{ allowed: boolean; clinicId: string }> {
  const cookieStore = await cookies();
  const session = await validateSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!session) {
    redirect('/login');
  }

  return {
    allowed: (CLINIC_SETTINGS_MANAGER_ROLES as readonly string[]).includes(session.role),
    clinicId: session.clinicId,
  };
}
