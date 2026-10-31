import type { Dictionary } from '@/i18n/dictionaries';

type StaffMessages = Dictionary['staff'];

/**
 * The label key of each of the four staff roles (ADR-0004) in the `staff`
 * namespace, shared by the staff screens.
 */
const ROLE_LABEL_KEYS: Readonly<Record<string, keyof StaffMessages>> = {
  owner: 'roleOwner',
  admin: 'roleAdmin',
  practitioner: 'rolePractitioner',
  receptionist: 'roleReceptionist',
};

/** A role's label in the active language; an unknown role is shown as stored. */
export function roleLabel(role: string, t: StaffMessages): string {
  const key = Object.hasOwn(ROLE_LABEL_KEYS, role) ? ROLE_LABEL_KEYS[role] : undefined;
  return key ? t[key] : role;
}
