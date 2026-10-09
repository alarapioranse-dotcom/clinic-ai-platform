/** Arabic labels for the four staff roles (ADR-0004), shared by the staff screens. */
export const ROLE_LABELS: Record<string, string> = {
  owner: 'مالك العيادة',
  admin: 'مسؤول',
  practitioner: 'ممارس صحي',
  receptionist: 'موظف استقبال',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
