// Test-only worker: never replies, so only the parent's timeout can end it.
import { parentPort } from 'node:worker_threads';
parentPort.once('message', () => setInterval(() => {}, 1000));
