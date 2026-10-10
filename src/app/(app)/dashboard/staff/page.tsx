import Link from 'next/link';

import { canManageInvitationFor, getStaffOverview, type StaffOverview } from '@/features/staff';

import { StaffAccessDenied } from './AccessDenied';
import { CancelInvitationButton } from './CancelInvitationButton';
import { staffPageAccess } from './access';
import { roleLabel } from './role-labels';

/** Never cache: the list changes with every invitation, and it is per clinic. */
export const dynamic = 'force-dynamic';

const dateFormatter = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * /dashboard/staff (docs/product/05-screen-inventory.md,
 * 06-acceptance-criteria.md; item 3 PR B). Owner and admin see their own
 * clinic's active staff and open invitations, and may cancel an invitation
 * for a role they are allowed to invite (Owner decisions S5, T2).
 */
export default async function StaffPage() {
  const { allowed, clinicId, role } = await staffPageAccess();

  if (!allowed) {
    return <StaffAccessDenied title="الطاقم" />;
  }

  let overview: StaffOverview | null = null;
  try {
    overview = await getStaffOverview(clinicId);
  } catch {
    overview = null;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">الطاقم</h1>
          <p className="text-muted mt-2 text-sm">من يملك حق الدخول إلى حساب العيادة.</p>
        </div>
        <Link
          href="/dashboard/staff/invite"
          className="bg-pine hover:bg-pine-deep inline-flex items-center justify-center rounded-full px-6 py-2 text-sm font-medium text-white"
        >
          دعوة عضو جديد
        </Link>
      </div>

      {overview === null ? (
        <div role="alert" className="mt-8 text-sm">
          <p className="font-medium text-red-700">تعذّر تحميل قائمة الطاقم.</p>
          <Link href="/dashboard/staff" className="text-pine mt-2 inline-block underline">
            إعادة المحاولة
          </Link>
        </div>
      ) : (
        <>
          <section className="mt-10">
            <h2 className="text-lg font-semibold">الأعضاء</h2>
            {overview.staff.length <= 1 && overview.invitations.length === 0 ? (
              <p className="text-muted mt-3 text-sm">
                أنت وحدك من يملك حق الدخول حاليًا — ادعُ فريقك.
              </p>
            ) : null}
            <ul className="mt-4 divide-y divide-[var(--color-line)]">
              {overview.staff.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center justify-between py-3">
                  <span className="text-sm" dir="ltr">
                    {member.email}
                  </span>
                  <span className="text-muted text-sm">{roleLabel(member.role)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold">دعوات بانتظار القبول</h2>
            {overview.invitations.length === 0 ? (
              <p className="text-muted mt-3 text-sm">لا توجد دعوات معلّقة.</p>
            ) : (
              <ul className="mt-4 divide-y divide-[var(--color-line)]">
                {overview.invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-sm" dir="ltr">
                        {invitation.email}
                      </p>
                      <p className="text-muted mt-1 text-xs">
                        {roleLabel(invitation.role)} · تنتهي{' '}
                        {dateFormatter.format(new Date(invitation.expiresAt))}
                      </p>
                    </div>
                    {canManageInvitationFor(role, invitation.role) ? (
                      <CancelInvitationButton invitationId={invitation.id} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
