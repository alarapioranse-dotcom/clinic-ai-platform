import { describe, expect, it } from 'vitest';

import { roleLabel } from '@/app/(staff)/(app)/dashboard/staff/role-labels';
import { getDictionary } from '@/i18n/dictionaries';

/**
 * ADR-0027 slice 1 replaced the exported `ROLE_LABELS` map with
 * `roleLabel(role, t)`. The labels must be the ones the map held at
 * 87a66ca, and an unknown role is still shown as stored.
 */
const t = getDictionary('ar').staff;

describe('roleLabel', () => {
  it('gives each of the four roles the Arabic label it had before ADR-0027', () => {
    expect(roleLabel('owner', t)).toBe('مالك العيادة');
    expect(roleLabel('admin', t)).toBe('مسؤول');
    expect(roleLabel('practitioner', t)).toBe('ممارس صحي');
    expect(roleLabel('receptionist', t)).toBe('موظف استقبال');
  });

  it('shows an unknown role as stored, including names of Object.prototype members', () => {
    expect(roleLabel('janitor', t)).toBe('janitor');
    expect(roleLabel('constructor', t)).toBe('constructor');
    expect(roleLabel('toString', t)).toBe('toString');
  });
});
