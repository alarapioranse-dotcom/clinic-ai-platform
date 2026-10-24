// Test-only worker: loads the real extraction worker (which installs its blocks at module load),
// then tries every network path and the native canvas package and reports what happened.
import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';

await import('../../../src/features/knowledge-base/extraction/pdf-worker.mjs');
const require = createRequire(import.meta.url);
const attempt = async (fn) => {
  try {
    await fn();
    return 'allowed';
  } catch {
    return 'blocked';
  }
};
parentPort.postMessage({
  type: 'probe',
  results: {
    fetch: await attempt(() => fetch('https://example.invalid/')),
    requireHttps: await attempt(() => require('https')),
    requireNodeNet: await attempt(() => require('node:net')),
    requireTls: await attempt(() => require('tls')),
    requireDns: await attempt(() => require('dns')),
    builtinHttp: await attempt(() => process.getBuiltinModule('http')),
    builtinNodeHttp2: await attempt(() => process.getBuiltinModule('node:http2')),
    requireCanvas: await attempt(() => require('@napi-rs/canvas')),
    requireFs: await attempt(() => require('fs')),
    builtinPath: await attempt(() => process.getBuiltinModule('path')),
  },
});
