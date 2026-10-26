/**
 * Limits and failure vocabulary for knowledge-document text extraction (ADR-0026 section 4).
 *
 * The values are product limits and test parameters, not demonstrated safety bounds (ADR-0026):
 * the V8 heap limit, in particular, bounds only the worker's old-generation heap, not total
 * process memory.
 */

/** Same 10 MiB limit as upload completion (`MAX_KNOWLEDGE_DOCUMENT_SIZE_BYTES`). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 100;
/** Counted in Unicode code points of the canonical text. */
export const MAX_CANONICAL_CODE_POINTS = 500_000;
export const WORKER_TIMEOUT_MS = 30_000;
/**
 * `resourceLimits.maxOldGenerationSizeMb` of the parsing worker. Owner ruling G2 (PR D): 128,
 * down from ADR-0026's initial 256, because production runs on a 512 MB instance where the
 * idle server alone uses about 137 MB; the highest worker heap measured on the fixtures was
 * about 31 MiB.
 */
export const WORKER_MAX_OLD_GENERATION_MB = 128;

/** Chunking (ADR-0026 section 5): target and hard maximum, in code points. */
export const CHUNK_TARGET_CODE_POINTS = 1500;
export const CHUNK_MAX_CODE_POINTS = 2000;

/**
 * The failure reasons extraction itself can produce. `object_missing`, `object_changed` and
 * `not_a_pdf` belong to the storage re-validation step of the route integration (PR D), so they
 * are not produced here; all of them are accepted by `mark_knowledge_document_failed`.
 */
export type ExtractionFailureReason =
  | 'too_large'
  | 'too_many_pages'
  | 'too_much_text'
  | 'extraction_timeout'
  | 'extraction_error'
  | 'no_extractable_text'
  | 'encrypted';

export interface ExtractionLimits {
  maxFileBytes: number;
  maxPages: number;
  maxCanonicalCodePoints: number;
  timeoutMs: number;
  maxOldGenerationMb: number;
}

export const DEFAULT_EXTRACTION_LIMITS: ExtractionLimits = {
  maxFileBytes: MAX_FILE_BYTES,
  maxPages: MAX_PAGES,
  maxCanonicalCodePoints: MAX_CANONICAL_CODE_POINTS,
  timeoutMs: WORKER_TIMEOUT_MS,
  maxOldGenerationMb: WORKER_MAX_OLD_GENERATION_MB,
};
