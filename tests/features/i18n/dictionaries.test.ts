import { describe, expect, it } from 'vitest';

import { LOCALES } from '@/i18n/config';
import { AVAILABLE_LOCALES, getDictionary, type Dictionary } from '@/i18n/dictionaries';
import { ar } from '@/i18n/dictionaries/ar';
import { arErrors } from '@/i18n/dictionaries/ar-errors';
import { el } from '@/i18n/dictionaries/el';
import { elErrors } from '@/i18n/dictionaries/el-errors';
import { en } from '@/i18n/dictionaries/en';
import { enErrors } from '@/i18n/dictionaries/en-errors';
import { placeholdersOf } from '@/i18n/format';

/**
 * ADR-0027 decision 4 and the architect's condition that every dictionary has
 * the same contract: the same nested keys, every value a string, and the same
 * `{placeholders}` in each value. English defines the contract (slice 2);
 * Arabic and Greek (slice 3) are checked against it.
 */

type Shape = Map<string, string[]>;

function shapeOf(value: unknown, path = ''): Shape {
  const shape: Shape = new Map();
  if (typeof value === 'string') {
    shape.set(path, placeholdersOf(value).sort());
    return shape;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path || '(root)'}: dictionary values must be strings or plain objects`);
  }
  for (const [key, child] of Object.entries(value)) {
    for (const [childPath, placeholders] of shapeOf(child, path ? `${path}.${key}` : key)) {
      shape.set(childPath, placeholders);
    }
  }
  return shape;
}

describe('dictionaries', () => {
  it('exist only for ADR-0027 locales', () => {
    for (const locale of AVAILABLE_LOCALES) expect(LOCALES).toContain(locale);
  });

  it('refuse a locale without a dictionary', () => {
    for (const locale of LOCALES.filter((l) => !AVAILABLE_LOCALES.includes(l))) {
      expect(() => getDictionary(locale)).toThrow();
    }
  });

  it('hold only strings and plain objects, with no empty text', () => {
    for (const locale of AVAILABLE_LOCALES) {
      const shape = shapeOf(getDictionary(locale));
      expect(shape.size).toBeGreaterThan(200);
      for (const path of shape.keys()) {
        const value = path
          .split('.')
          .reduce<unknown>(
            (node, key) => (node as Record<string, unknown>)[key],
            getDictionary(locale),
          );
        expect(String(value).trim(), `${locale}:${path}`).not.toBe('');
      }
    }
  });

  it('exist for all three locales since slice 3', () => {
    expect([...AVAILABLE_LOCALES]).toEqual(['ar', 'el', 'en']);
    expect(getDictionary('el')).toBe(el);
    expect(shapeOf(el)).toEqual(shapeOf(en));
  });

  it('share one contract: same keys and same placeholders in every locale', () => {
    const reference = shapeOf(en);
    expect(shapeOf(ar)).toEqual(reference);
    for (const locale of AVAILABLE_LOCALES) {
      expect(shapeOf(getDictionary(locale)), locale).toEqual(reference);
    }
  });

  it('use only named placeholders that the screens fill', () => {
    const allowed = new Set([
      'date',
      'start',
      'end',
      'min',
      'max',
      'digest',
      'size',
      'day',
      'from',
      'to',
      'role',
      'email',
    ]);
    for (const [path, placeholders] of shapeOf(en)) {
      for (const name of placeholders) expect(allowed.has(name), `${path}: {${name}}`).toBe(true);
    }
  });

  it("keep each errors module identical to its dictionary's errors namespace", () => {
    expect(ar.errors).toBe(arErrors);
    expect(en.errors).toBe(enErrors);
    const errors: Dictionary['errors'] = enErrors;
    expect(Object.keys(errors).sort()).toEqual(['body', 'code', 'label', 'retry', 'title']);
    expect(Object.keys(arErrors).sort()).toEqual(Object.keys(enErrors).sort());
    expect(el.errors).toBe(elErrors);
    expect(Object.keys(elErrors).sort()).toEqual(Object.keys(enErrors).sort());
  });

  it('write Greek text in Greek, without Arabic script or leftover English sentences', () => {
    // Values that are the same in every language: the working product name,
    // "Email", and the size units.
    const sameAsEnglish = new Set([
      'common.appName',
      'login.email',
      'staffInvite.email',
      'knowledgeBase.sizeMegabytes',
      'knowledgeBase.sizeKilobytes',
    ]);
    const valueAt = (tree: unknown, path: string) =>
      String(
        path
          .split('.')
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], tree),
      );
    for (const [path] of shapeOf(en)) {
      const value = valueAt(el, path);
      expect(value, path).not.toMatch(/\p{Script=Arabic}/u);
      if (sameAsEnglish.has(path)) {
        expect(value, path).toBe(valueAt(en, path));
      } else {
        expect(value, path).toMatch(/\p{Script=Greek}/u);
        expect(value, path).not.toBe(valueAt(en, path));
      }
    }
  });

  it('use one Greek term for every clinician, as English does (ruling D5)', () => {
    expect(el.booking.practitioner).toBe(el.staff.rolePractitioner);
  });

  it('write English text in English, without Arabic or Greek script', () => {
    for (const [path] of shapeOf(en)) {
      const value = path
        .split('.')
        .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], en);
      expect(String(value), path).not.toMatch(/[\p{Script=Arabic}\p{Script=Greek}]/u);
      expect(String(value), path).toMatch(/[A-Za-z]/);
    }
  });

  it('use "Practitioner" for every clinician in English (ruling D5)', () => {
    expect(en.booking.practitioner).toBe('Practitioner');
    expect(en.staff.rolePractitioner).toBe('Practitioner');
    expect(JSON.stringify(en)).not.toMatch(/\bdoctors?\b/i);
  });
});
