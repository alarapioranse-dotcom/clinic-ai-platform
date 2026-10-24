import { withTenantContext } from '@/lib/db';
import { extractKnowledgeDocumentText } from './extraction/extract';
import { hasPdfSignature, PDF_SIGNATURE_LENGTH } from './pdf-signature';
import { markKnowledgeDocumentFailed, storeKnowledgeDocumentChunks } from './repository';
import {
  headObject,
  OBJECT_FULL_READ_MAX_BYTES,
  OBJECT_PREFIX_READ_BYTES,
  readObjectForExtraction,
} from './storage';

/**
 * Processes one uploaded knowledge document after its completion response has
 * been sent (ADR-0026; PR D). Scheduled by the completion route with Next.js
 * `after()`; never called inside a request's critical path.
 *
 *   1. Re-validates the object as it now stands (ADR-0026 section 3):
 *      HeadObject size and Content-Type, a whole-object read conditioned on
 *      `If-Match` and bounded by HeadObject's length, then the ADR-0021
 *      signature check on the bytes actually read.
 *   2. Extracts, canonicalises and chunks the text in the worker (PR C).
 *   3. Stores the chunk set, or records the failure, through the 0020
 *      tenant-bound functions. The document stays `processing` after a
 *      successful store (Owner ruling D9).
 *
 * Owner ruling G3: one document at a time per process, so at most one
 * parsing worker exists at once. Owner ruling G4: the only log line is the
 * document id and an outcome code — never text, a filename, bytes, a storage
 * key or an exception message.
 *
 * Never throws. If the process stops, or the database cannot record the
 * outcome, the document stays `processing` (an accepted limitation, ADR-0026
 * section 1); nothing claims otherwise.
 */

export type ProcessingOutcome =
  /** The chunk set was stored; the document stays `processing` (D9). */
  | 'stored'
  /** A failure reason was recorded: the document is now `failed`. */
  | 'too_large'
  | 'too_many_pages'
  | 'too_much_text'
  | 'extraction_timeout'
  | 'extraction_error'
  | 'no_extractable_text'
  | 'encrypted'
  | 'object_missing'
  | 'object_changed'
  | 'not_a_pdf'
  /** The document had already left `processing` or had a chunk set: nothing was overwritten. */
  | 'stale'
  /** The outcome could not be recorded (for example, the database was unavailable). */
  | 'unrecorded';

type FailureReason = Exclude<ProcessingOutcome, 'stored' | 'stale' | 'unrecorded'>;

let queueTail: Promise<unknown> = Promise.resolve();

/** Runs `task` after every previously queued task has settled (G3). */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(task, task);
  queueTail = run.catch(() => undefined);
  return run;
}

export function processKnowledgeDocument(
  clinicId: string,
  documentId: string,
): Promise<ProcessingOutcome> {
  return enqueue(async () => {
    const outcome = await processNow(clinicId, documentId);
    logOutcome(documentId, outcome);
    return outcome;
  });
}

async function processNow(clinicId: string, documentId: string): Promise<ProcessingOutcome> {
  let bytes: Uint8Array;
  try {
    const reread = await rereadObject(`${clinicId}/${documentId}`);
    if (typeof reread === 'string') return recordFailure(clinicId, documentId, reread);
    bytes = reread;
  } catch {
    // Storage unreachable or an unexpected response: fail closed (ADR-0026 section 3).
    return recordFailure(clinicId, documentId, 'extraction_error');
  }

  let extracted: Awaited<ReturnType<typeof extractKnowledgeDocumentText>>;
  try {
    extracted = await extractKnowledgeDocumentText(bytes);
  } catch {
    return recordFailure(clinicId, documentId, 'extraction_error');
  }
  if (!extracted.ok) return recordFailure(clinicId, documentId, extracted.reason);

  try {
    const stored = await withTenantContext(clinicId, (client) =>
      storeKnowledgeDocumentChunks(client, documentId, extracted),
    );
    return stored;
  } catch {
    // The database refused the set (or is unavailable). Try to record a failure; if that
    // also fails, the document stays processing.
    return recordFailure(clinicId, documentId, 'extraction_error');
  }
}

/** The object's bytes, or the failure reason that ends processing. */
async function rereadObject(key: string): Promise<Uint8Array | FailureReason> {
  const head = await headObject(key);
  if (!head) return 'object_missing';
  if (head.contentLength > OBJECT_FULL_READ_MAX_BYTES) return 'too_large';
  if (head.contentType !== 'application/pdf') return 'not_a_pdf';
  if (head.contentLength < PDF_SIGNATURE_LENGTH) return 'not_a_pdf';
  // Without an ETag the read cannot be bound to this object: fail closed.
  if (!head.etag) return 'extraction_error';

  const read = await readObjectForExtraction(key, head.etag, head.contentLength);
  if (read.outcome === 'not_found') return 'object_missing';
  if (read.outcome === 'changed') return 'object_changed';
  // The same prefix the completion check saw (ADR-0021), now on the bytes actually read.
  if (!hasPdfSignature(read.bytes.subarray(0, OBJECT_PREFIX_READ_BYTES))) return 'not_a_pdf';
  return read.bytes;
}

async function recordFailure(
  clinicId: string,
  documentId: string,
  reason: FailureReason,
): Promise<ProcessingOutcome> {
  try {
    const result = await withTenantContext(clinicId, (client) =>
      markKnowledgeDocumentFailed(client, documentId, reason),
    );
    return result === 'stale' ? 'stale' : reason;
  } catch {
    return 'unrecorded';
  }
}

function logOutcome(documentId: string, outcome: ProcessingOutcome): void {
  const line = `knowledge_document_processing document=${documentId} outcome=${outcome}`;
  if (outcome === 'unrecorded') {
    console.error(line);
  } else {
    console.info(line);
  }
}
