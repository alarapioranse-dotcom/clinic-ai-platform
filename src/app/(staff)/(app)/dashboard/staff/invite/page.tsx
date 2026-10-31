import { invitableRoles } from '@/features/staff';
import { getI18n } from '@/i18n/server';

import { StaffAccessDenied } from '../AccessDenied';
import { staffPageAccess } from '../access';
import { roleLabel } from '../role-labels';
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
  const { t } = await getI18n();

  if (!allowed) {
    return <StaffAccessDenied title={t.staffInvite.title} t={t.staff} />;
  }

  const roles = invitableRoles(role).map((value) => ({
    value,
    label: roleLabel(value, t.staff),
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold">{t.staffInvite.title}</h1>
      <p className="text-muted mt-2 text-sm">{t.staffInvite.intro}</p>
      <InviteStaffForm roles={roles} t={t.staffInvite} />
    </div>
  );
}
