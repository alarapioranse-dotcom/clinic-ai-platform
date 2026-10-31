import { describe, expect, it } from 'vitest';

import { LOCALES } from '@/i18n/config';
import { AVAILABLE_LOCALES, getDictionary, type Dictionary } from '@/i18n/dictionaries';
import { ar } from '@/i18n/dictionaries/ar';
import { arErrors } from '@/i18n/dictionaries/ar-errors';
import { placeholdersOf } from '@/i18n/format';

/**
 * ADR-0027 decision 4 and the architect's condition that every dictionary has
 * the same contract: the same nested keys, every value a string, and the same
 * `{placeholders}` in each value. In slice 1 only Arabic exists; slices 2 and
 * 3 add English and Greek, and every check below then runs against them too.
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

  it('share one contract: same keys and same placeholders in every locale', () => {
    const reference = shapeOf(ar);
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
    for (const [path, placeholders] of shapeOf(ar)) {
      for (const name of placeholders) expect(allowed.has(name), `${path}: {${name}}`).toBe(true);
    }
  });

  it("keep the client-side errors fallback identical to the dictionary's errors namespace", () => {
    expect(ar.errors).toBe(arErrors);
    const errors: Dictionary['errors'] = arErrors;
    expect(Object.keys(errors).sort()).toEqual(['body', 'code', 'label', 'retry', 'title']);
  });
});
