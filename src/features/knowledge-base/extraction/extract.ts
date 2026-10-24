import { Worker } from 'node:worker_threads';
import { CANONICALIZATION_VERSION, canonicalize, codePointLength, hasLetter } from './canonicalize';
import { chunkCanonicalText } from './chunker';
import {
  DEFAULT_EXTRACTION_LIMITS,
  type ExtractionFailureReason,
  type ExtractionLimits,
} from './limits';

/**
 * Extracts a PDF's text, canonicalises it and chunks it (ADR-0026 sections 1, 2, 4 and 5).
 *
 * PDF.js runs only inside a `worker_threads` worker (./pdf-worker.mjs) with a V8 old-generation
 * heap limit and a wall-clock timeout enforced here. This keeps synchronous parsing off the main
 * event loop, but it is NOT process isolation: the worker shares this process, its heap limit
 * does not bound total process memory or native allocations, and a hostile file can still put
 * the whole process under memory pressure (ADR-0026 section 1).
 *
 * Every outcome is either the extracted, canonical, chunked text or one closed failure reason:
 * no exception message, file-derived text or PDF.js output is ever returned, logged or thrown.
 * Not yet wired to any route (PR D) and touches no database or storage.
 */

/** The PDF.js version pinned in package.json plus this module's option set. */
export const EXTRACTOR_VERSION = 'pdfjs-dist@6.4.299;opts-1';

export interface ExtractionDiagnostics {
  /** Module loads the worker blocked (network modules, `@napi-rs/canvas`). */
  blockedModuleLoads: string[];
  /** Calls to the worker's blocked `fetch`. */
  fetchCalls: number;
}

export type ExtractionResult =
  | {
      ok: true;
      canonicalText: string;
      chunks: string[];
      extractorVersion: string;
      canonicalizationVersion: string;
      pageCount: number;
      diagnostics: ExtractionDiagnostics;
    }
  | { ok: false; reason: ExtractionFailureReason; diagnostics?: ExtractionDiagnostics };

/** Overrides for tests only (forcing the timeout and memory paths, or a fake worker). */
export interface ExtractionOptions {
  limits?: Partial<ExtractionLimits>;
  /** @internal */
  workerUrl?: URL;
}

/** Below this, starting the worker can abort the process rather than fail the worker. */
export const MIN_WORKER_OLD_GENERATION_MB = 16;

const DEFAULT_WORKER_URL = new URL('./pdf-worker.mjs', import.meta.url);

type WorkerMessage =
  | { type: 'pages'; pages: string[]; diagnostics: ExtractionDiagnostics }
  | { type: 'failure'; reason: ExtractionFailureReason; diagnostics: ExtractionDiagnostics };

const WORKER_FAILURE_REASONS: ReadonlySet<string> = new Set<ExtractionFailureReason>([
  'too_many_pages',
  'too_much_text',
  'extraction_error',
  'encrypted',
]);

export async function extractKnowledgeDocumentText(
  bytes: Uint8Array,
  options: ExtractionOptions = {},
): Promise<ExtractionResult> {
  const limits: ExtractionLimits = { ...DEFAULT_EXTRACTION_LIMITS, ...options.limits };
  // A heap limit far too small to even start a V8 isolate aborts the whole process instead of
  // failing the worker (reproduced with 2 MB on Node 22). Refuse such a configuration outright.
  if (limits.maxOldGenerationMb < MIN_WORKER_OLD_GENERATION_MB) {
    throw new Error(`maxOldGenerationMb must be at least ${MIN_WORKER_OLD_GENERATION_MB}`);
  }

  if (bytes.byteLength > limits.maxFileBytes) return { ok: false, reason: 'too_large' };

  const outcome = await runWorker(bytes, limits, options.workerUrl ?? DEFAULT_WORKER_URL);
  if (outcome.type === 'failure') {
    return { ok: false, reason: outcome.reason, diagnostics: outcome.diagnostics };
  }

  const canonicalText = canonicalize(outcome.pages);
  if (!hasLetter(canonicalText)) {
    return { ok: false, reason: 'no_extractable_text', diagnostics: outcome.diagnostics };
  }
  if (codePointLength(canonicalText) > limits.maxCanonicalCodePoints) {
    return { ok: false, reason: 'too_much_text', diagnostics: outcome.diagnostics };
  }

  return {
    ok: true,
    canonicalText,
    chunks: chunkCanonicalText(canonicalText),
    extractorVersion: EXTRACTOR_VERSION,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    pageCount: outcome.pages.length,
    diagnostics: outcome.diagnostics,
  };
}

type WorkerOutcome =
  | { type: 'pages'; pages: string[]; diagnostics: ExtractionDiagnostics }
  | { type: 'failure'; reason: ExtractionFailureReason; diagnostics?: ExtractionDiagnostics };

function runWorker(
  bytes: Uint8Array,
  limits: ExtractionLimits,
  workerUrl: URL,
): Promise<WorkerOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker;
    let timer: NodeJS.Timeout | undefined;

    const finish = (outcome: WorkerOutcome) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // Terminating also frees the worker's heap; its exit is not awaited by callers.
      void worker.terminate().catch(() => {});
      resolve(outcome);
    };

    try {
      worker = new Worker(workerUrl, {
        resourceLimits: { maxOldGenerationSizeMb: limits.maxOldGenerationMb },
        // Captured and discarded: nothing the worker prints reaches this process's output.
        stdout: true,
        stderr: true,
      });
    } catch {
      resolve({ type: 'failure', reason: 'extraction_error' });
      return;
    }
    worker.stdout.resume();
    worker.stderr.resume();

    timer = setTimeout(
      () => finish({ type: 'failure', reason: 'extraction_timeout' }),
      limits.timeoutMs,
    );

    worker.once('message', (message: WorkerMessage) => {
      if (message?.type === 'pages' && Array.isArray(message.pages)) {
        finish({ type: 'pages', pages: message.pages, diagnostics: message.diagnostics });
      } else if (message?.type === 'failure' && WORKER_FAILURE_REASONS.has(message.reason)) {
        finish({ type: 'failure', reason: message.reason, diagnostics: message.diagnostics });
      } else {
        finish({ type: 'failure', reason: 'extraction_error' });
      }
    });
    // A worker error (including ERR_WORKER_OUT_OF_MEMORY when the heap limit is hit) or an exit
    // before replying is an extraction error. Its message is never surfaced.
    worker.once('error', () => finish({ type: 'failure', reason: 'extraction_error' }));
    worker.once('exit', () => finish({ type: 'failure', reason: 'extraction_error' }));

    // The worker parses its own copy; `maxRawChars` lets it stop early (2x the canonical limit:
    // raw text carries extra whitespace, and the canonical length is checked again here).
    const copy = bytes.slice();
    worker.postMessage(
      { bytes: copy, maxPages: limits.maxPages, maxRawChars: limits.maxCanonicalCodePoints * 2 },
      [copy.buffer],
    );
  });
}
