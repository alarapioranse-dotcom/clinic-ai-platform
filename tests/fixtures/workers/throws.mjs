// Test-only worker: throws an uncaught error whose message must never surface.
import { parentPort } from 'node:worker_threads';
parentPort.once('message', () => {
  throw new Error('secret file text that must not leak');
});
