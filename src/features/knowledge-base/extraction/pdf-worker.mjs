// PDF text extraction worker (ADR-0026 sections 1, 2 and 4). Runs inside a
// `worker_threads` worker started by ./extract.ts, never in the main thread.
//
// Plain JavaScript on purpose: a worker is started from a file path, and this
// file must run unchanged under Node, the test runner and a built Next.js
// server. It is the only file that loads PDF.js.
//
// Before PDF.js is loaded, this worker:
//   - blocks every network module and `fetch`, so no PDF and no PDF.js code
//     path can reach the network (ADR-0026 section 2);
//   - blocks the optional native `@napi-rs/canvas` package (Owner ruling F2):
//     PDF.js loads it only for rendering polyfills, and text extraction does
//     not need it;
//   - silences console output, so nothing from the file can reach a log
//     (ADR-0026 section 8).
//
// Protocol: the parent posts { bytes: Uint8Array, maxPages, maxRawChars } and
// receives exactly one message:
//   { type: 'pages', pages: string[], diagnostics }
//   { type: 'failure', reason, diagnostics }
// `reason` is one of the closed ExtractionFailureReason codes. No exception
// message or file-derived text is ever sent back on failure.

import Module from 'node:module';
import { parentPort } from 'node:worker_threads';

const BLOCKED_MODULE =
  /^(node:)?(http|https|http2|net|tls|dgram|dns|dns\/promises|undici)$|^@napi-rs\/canvas/;

const diagnostics = { blockedModuleLoads: [], fetchCalls: 0 };

function blocked(request) {
  diagnostics.blockedModuleLoads.push(request);
  const error = new Error(`module blocked in the extraction worker: ${request}`);
  error.code = 'MODULE_NOT_FOUND';
  return error;
}

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (typeof request === 'string' && BLOCKED_MODULE.test(request)) throw blocked(request);
  return originalLoad.call(this, request, ...rest);
};

const originalGetBuiltinModule = process.getBuiltinModule?.bind(process);
if (originalGetBuiltinModule) {
  process.getBuiltinModule = (id) => {
    if (BLOCKED_MODULE.test(id)) throw blocked(id);
    return originalGetBuiltinModule(id);
  };
}

globalThis.fetch = async () => {
  diagnostics.fetchCalls += 1;
  throw new Error('network access is blocked in the extraction worker');
};

for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[method] = () => {};
}

function reply(message) {
  parentPort.postMessage({ ...message, diagnostics });
}

parentPort.once('message', async ({ bytes, maxPages, maxRawChars }) => {
  let loadingTask;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    loadingTask = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      disableAutoFetch: true,
      disableStream: true,
      stopAtErrors: true,
      verbosity: 0,
      // No cMapUrl, standardFontDataUrl, wasmUrl or iccUrl: no auxiliary resource is ever
      // loaded (ADR-0026 section 2).
    });

    let document;
    try {
      document = await loadingTask.promise;
    } catch (error) {
      reply({
        type: 'failure',
        reason: error?.name === 'PasswordException' ? 'encrypted' : 'extraction_error',
      });
      return;
    }

    // Owner ruling F3: every encrypted PDF fails, including one that opens without a password.
    const metadata = await document.getMetadata();
    if (metadata?.info?.EncryptFilterName) {
      reply({ type: 'failure', reason: 'encrypted' });
      return;
    }

    // The page count is known before any page is parsed.
    if (document.numPages > maxPages) {
      reply({ type: 'failure', reason: 'too_many_pages' });
      return;
    }

    const pages = [];
    let rawChars = 0;
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      page.cleanup();
      rawChars += text.length;
      // Early stop well before canonicalisation: raw text this long cannot fit the limit
      // (canonicalisation only shortens text, apart from NFKC expansions, which are checked
      // again on the canonical text by the parent).
      if (rawChars > maxRawChars) {
        reply({ type: 'failure', reason: 'too_much_text' });
        return;
      }
      pages.push(text);
    }
    reply({ type: 'pages', pages });
  } catch {
    reply({ type: 'failure', reason: 'extraction_error' });
  } finally {
    await loadingTask?.destroy().catch(() => {});
  }
});
