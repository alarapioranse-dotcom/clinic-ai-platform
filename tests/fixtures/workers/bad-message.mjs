// Test-only worker: replies with something outside the protocol.
import { parentPort } from 'node:worker_threads';
parentPort.once('message', () =>
  parentPort.postMessage({ type: 'failure', reason: 'Error: ENOENT /tmp/x.pdf' }),
);
