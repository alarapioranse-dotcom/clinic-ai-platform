import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AVAILABLE_LOCALES, getDictionary } from '@/i18n/dictionaries';
import { labelOf } from '@/i18n/format';
import { getDatabaseUrl } from '@/lib/env';

/**
 * ADR-0027 slice 2, architect's ruling D3: the conversation screen labels
 * `messages.sender_type` and `appointments.status` from closed dictionary
 * maps. The permitted values are read from the CHECK constraints of the
 * migrated test database, so a new value added by a later migration fails
 * here until every dictionary labels it.
 */
let admin: Client;

beforeAll(async () => {
  admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
});

afterAll(async () => {
  await admin.end();
});

async function checkValues(table: string, column: string): Promise<string[]> {
  // The value-list constraint Postgres names `<table>_<column>_check`
  // (0010, 0011); other CHECKs may mention the column too.
  const { rows } = await admin.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conrelid = $1::regclass AND contype = 'c' AND conname = $2`,
    [table, `${table}_${column}_check`],
  );
  expect(rows, `${table}.${column} CHECK`).toHaveLength(1);
  return [...rows[0]!.def.matchAll(/'([a-z_]+)'::text/gu)].map((match) => match[1]!).sort();
}

describe('enum labels cover every value the database allows', () => {
  it('reads the expected CHECK values from the schema', async () => {
    expect(await checkValues('messages', 'sender_type')).toEqual(['patient', 'staff']);
    expect(await checkValues('appointments', 'status')).toEqual([
      'booked',
      'cancelled',
      'completed',
      'rescheduled',
    ]);
  });

  for (const locale of AVAILABLE_LOCALES) {
    it(`labels exactly the permitted values, each distinctly (${locale})`, async () => {
      const t = getDictionary(locale).conversationDetail;
      for (const [labels, values] of [
        [t.senderTypes, await checkValues('messages', 'sender_type')],
        [t.appointmentStatuses, await checkValues('appointments', 'status')],
      ] as const) {
        expect(Object.keys(labels).sort()).toEqual(values);
        const texts = values.map((value) => labelOf(labels, value));
        for (const [i, text] of texts.entries()) expect(text, values[i]).not.toBe(values[i]);
        expect(new Set(texts).size).toBe(values.length);
      }
    });
  }
});

describe('labelOf', () => {
  const labels = { booked: 'Booked', cancelled: 'Cancelled' };

  it('returns the label of a listed value', () => {
    expect(labelOf(labels, 'booked')).toBe('Booked');
  });

  it('shows an unlisted value as stored, never another value’s label, and never throws', () => {
    for (const value of ['no_show', '', 'Booked', 'BOOKED', 'booked ', 'toString', '__proto__']) {
      expect(labelOf(labels, value)).toBe(value);
    }
  });
});
