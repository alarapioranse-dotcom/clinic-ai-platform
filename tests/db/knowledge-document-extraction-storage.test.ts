import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { closePool, withTenantContext } from '@/lib/db';
import { getDatabaseUrl } from '@/lib/env';
import { extractKnowledgeDocumentText } from '@/features/knowledge-base/extraction/extract';
import { chunkCanonicalText } from '@/features/knowledge-base/extraction/chunker';
import { canonicalize } from '@/features/knowledge-base/extraction/canonicalize';
import { createTestClinic, createTestKnowledgeDocument, createTestStaffMember } from '../fixtures';

/**
 * The extraction module's output (PR C) is accepted, unchanged, by the database contract of
 * migration 0020 (PR B): PostgreSQL's NFKC check and code-point offsets agree with the
 * application's. Node and PostgreSQL ship different Unicode versions, so this is checked against
 * the real database rather than assumed. Nothing here is wired to a route (that is PR D).
 * Synthetic PDFs and text only.
 */

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/pdfs/${name}`, import.meta.url)));

async function newProcessingDocument(label: string) {
  const clinic = await createTestClinic(label);
  const staff = await createTestStaffMember(clinic.id, `${label}Owner`, { role: 'owner' });
  const document = await createTestKnowledgeDocument(clinic.id, staff.id);
  return { clinic, document };
}

async function store(
  clinicId: string,
  documentId: string,
  extracted: {
    canonicalText: string;
    chunks: string[];
    extractorVersion: string;
    canonicalizationVersion: string;
  },
) {
  return withTenantContext(clinicId, (client) =>
    client.query<{ n: number }>(
      'SELECT store_knowledge_document_chunks($1, $2, $3, $4, $5::text[]) AS n',
      [
        documentId,
        extracted.extractorVersion,
        extracted.canonicalizationVersion,
        extracted.canonicalText,
        extracted.chunks,
      ],
    ),
  );
}

async function storedText(documentId: string): Promise<{ text: string; lastEnd: number }> {
  const admin = new Client({ connectionString: getDatabaseUrl() });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ text: string; last_end: number }>(
      `SELECT string_agg(content, '' ORDER BY ordinal) AS text, max(char_end) AS last_end
         FROM knowledge_document_chunks WHERE document_id = $1`,
      [documentId],
    );
    return { text: rows[0]!.text, lastEnd: rows[0]!.last_end };
  } finally {
    await admin.end();
  }
}

describe('extraction output against the 0020 database contract', () => {
  afterAll(async () => {
    await closePool();
  });

  it.each([
    'english.pdf',
    'greek.pdf',
    'arabic-presentation-forms.pdf',
    'libreoffice-arabic-greek.pdf',
    'ligatures.pdf',
    'many-paragraphs.pdf',
    'pages-100.pdf',
  ])(
    '%s: the extracted chunk set is stored as-is and rebuilds the canonical text',
    async (name) => {
      const extracted = await extractKnowledgeDocumentText(fixture(name));
      if (!extracted.ok) throw new Error(`${name} failed with ${extracted.reason}`);
      const { clinic, document } = await newProcessingDocument(`Extract${name.replace(/\W/g, '')}`);

      const result = await store(clinic.id, document.id, extracted);
      expect(result.rows[0]!.n).toBe(extracted.chunks.length);

      const stored = await storedText(document.id);
      expect(stored.text).toBe(extracted.canonicalText);
      expect(stored.lastEnd).toBe([...extracted.canonicalText].length);
    },
  );

  it('PostgreSQL accepts canonical text across scripts, compatibility characters and non-BMP characters', async () => {
    const samples = [
      'Ωράριο λειτουργίας\u00A0· ΆΈΉΊΌΎΏ ϊϋ',
      'ﺳﺎﻋﺎﺕ ﷲ ﷺ',
      'ﬁﬂ ① ½ Ａ Ω Å',
      'e\u0301 a\u0308 ẛ\u0323',
      '𝄞 𝒜 😀 \u{1F1EC}\u{1F1F7}',
      'می\u200Cخواهم',
    ];
    const text = canonicalize(samples.map((sample) => `${sample}\n\n`));
    const { clinic, document } = await newProcessingDocument('ExtractUnicode');
    await store(clinic.id, document.id, {
      canonicalText: text,
      chunks: chunkCanonicalText(text, 20, 40),
      extractorVersion: 'test',
      canonicalizationVersion: 'canon-1',
    });
    expect((await storedText(document.id)).text).toBe(text);
  });
});
