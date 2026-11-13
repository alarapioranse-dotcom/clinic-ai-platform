import { describe, expect, it } from 'vitest';

import { ar } from '@/i18n/dictionaries/ar';

import slice1 from '../../fixtures/ar-dictionary-slice-1.json';

/**
 * ADR-0027 slice 2, architect's condition: an Arabic user sees exactly the
 * text of slice 1, except for two intended changes. The fixture is the Arabic
 * dictionary as merged in slice 1 (#122, main e092e63), dumped verbatim.
 *
 * D2: `conversationDetail.replyFailed` was shown in English and is now Arabic.
 * D3: `conversationDetail.senderTypes` and `.appointmentStatuses` are new;
 * they label values that were shown raw before.
 * ADR-0030 decision 5: `knowledgeBase.statusReady` now says the document is
 * ready for search, because since migration 0021 a document is `ready` once it
 * is searchable, not once the assistant uses it.
 */
type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [p, v] of flatten(value, path)) out.set(p, v);
  }
  return out;
}

const before = flatten(slice1 as Tree);
const after = flatten(ar as unknown as Tree);

const D2 = 'conversationDetail.replyFailed';
const ADR_0030 = 'knowledgeBase.statusReady';
const D3_PREFIXES = ['conversationDetail.senderTypes.', 'conversationDetail.appointmentStatuses.'];
const isD3 = (path: string) => D3_PREFIXES.some((prefix) => path.startsWith(prefix));

describe('Arabic dictionary compared with slice 1', () => {
  it('reads a non-trivial slice 1 fixture', () => {
    expect(before.size).toBeGreaterThan(200);
  });

  it('keeps every slice 1 string byte for byte, except D2 and the ADR-0030 label', () => {
    for (const [path, text] of before) {
      if (path === D2 || path === ADR_0030) continue;
      expect(after.get(path), path).toBe(text);
    }
  });

  it('D2: translates the one string slice 1 showed in English', () => {
    expect(before.get(D2)).toBe('Message failed to send');
    expect(after.get(D2)).toBe('تعذّر إرسال الرسالة');
  });

  it('ADR-0030: the ready label says ready for search', () => {
    expect(before.get(ADR_0030)).toBe('جاهز');
    expect(after.get(ADR_0030)).toBe('جاهز للبحث');
  });

  it('adds only the D3 labels, and every one of them is Arabic', () => {
    const added = [...after.keys()].filter((path) => !before.has(path));
    expect(added.length).toBe(6);
    for (const path of added) {
      expect(isD3(path), path).toBe(true);
      expect(after.get(path), path).toMatch(/\p{Script=Arabic}/u);
    }
  });

  it('removes nothing', () => {
    for (const path of before.keys()) expect(after.has(path), path).toBe(true);
  });
});
