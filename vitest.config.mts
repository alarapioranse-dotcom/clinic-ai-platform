import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // RLS is verified against a real Postgres instance per test (see
    // docs/technical/02-tenant-isolation-testing.md: "RLS cannot be
    // meaningfully faked against an in-memory or mocked database"); these
    // are integration tests, not unit tests, so a longer timeout than
    // vitest's default is warranted.
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
