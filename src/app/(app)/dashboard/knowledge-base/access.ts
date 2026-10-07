import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { validateSession, SESSION_COOKIE_NAME } from '@/features/auth';
import { KNOWLEDGE_BASE_MANAGER_ROLES } from '@/features/knowledge-base';

/**
 * Roadmap P5 Slice 1C, Owner decision D3: the knowledge-base screens are
 * guarded server-side, before anything renders. docs/product/06-acceptance-criteria.md:
 * a practitioner or receptionist reaching either screen is denied access.
 *
 * The (app) layout already redirects a missing session to /login; this
 * repeats the check rather than assuming the layout ran first. The API
 * remains the authorization boundary for the data itself — this decides only
 * whether the screen is shown.
 */
export async function canManageKnowledgeBase(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = await validateSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!session) {
    redirect('/login');
  }

  return (KNOWLEDGE_BASE_MANAGER_ROLES as readonly string[]).includes(session.role);
}
