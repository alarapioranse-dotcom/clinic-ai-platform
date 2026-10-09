import { invitableRoles } from '@/features/staff';

import { StaffAccessDenied } from '../AccessDenied';
import { staffPageAccess } from '../access';
import { ROLE_LABELS } from '../role-labels';
import { InviteStaffForm } from './InviteStaffForm';

/** Never cache: the one-time link must not be stored by any cache. */
export const dynamic = 'force-dynamic';

/**
 * /dashboard/staff/invite (docs/product/05-screen-inventory.md; ADR-0023
 * decisions 5 and 7; Owner decision T2). The role list offered here is the
 * server's own rule for the caller's role; the API enforces it again.
 */
export default async function InviteStaffPage() {
  const { allowed, role } = await staffPageAccess();

  if (!allowed) {
    return <StaffAccessDenied title="دعوة عضو جديد" />;
  }

  const roles = invitableRoles(role).map((value) => ({
    value,
    label: ROLE_LABELS[value] ?? value,
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold">دعوة عضو جديد</h1>
      <p className="text-muted mt-2 text-sm">
        ستحصل على رابط دعوة صالح لمدة 72 ساعة ولاستخدام واحد. انسخه وأرسله إلى الشخص بنفسك؛ لا يُرسل
        أي بريد تلقائيًا.
      </p>
      <InviteStaffForm roles={roles} />
    </div>
  );
}
