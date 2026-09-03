import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { withTenantContext, withoutTenantContext, closePool } from '@/lib/db';

/**
 * Unit-level (mocked `pg`) coverage for `withTenantContext`'s failure path
 * and `withoutTenantContext`'s guard, as opposed to the real-Postgres
 * integration tests in tests/db/tenant-isolation.test.ts and
 * tests/db/pooling-guard.test.ts. A real ROLLBACK failure isn't reliably
 * reproducible against a live instance, so `pg`'s `Pool`/`PoolClient` are
 * mocked here to force exactly that failure and assert on it.
 */
const { mockConnect } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function MockPool() {
    return {
      connect: mockConnect,
      end: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

const { isTestEnvironmentMock } = vi.hoisted(() => ({
  isTestEnvironmentMock: vi.fn(() => true),
}));

vi.mock('@/lib/env', () => ({
  getAppDatabaseUrl: () => 'postgres://test-user:test-pass@localhost:5432/test',
  isTestEnvironment: isTestEnvironmentMock,
}));

const VALID_CLINIC_ID = '11111111-1111-1111-1111-111111111111';

function createMockClient() {
  return {
    query: vi.fn(),
    release: vi.fn(),
  };
}

describe('withTenantContext ROLLBACK failure handling', () => {
  beforeEach(() => {
    mockConnect.mockReset();
    isTestEnvironmentMock.mockReset();
    isTestEnvironmentMock.mockReturnValue(true);
  });

  afterAll(async () => {
    await closePool();
  });

  it('propagates the original error, not the rollback error, when ROLLBACK throws', async () => {
    const originalErr = new Error('fn failed');
    const rollbackErr = new Error('rollback failed');

    const client = createMockClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {};
      if (typeof sql === 'string' && sql.startsWith('SELECT set_config')) return {};
      if (sql === 'ROLLBACK') throw rollbackErr;
      throw new Error(`unexpected query: ${sql}`);
    });
    mockConnect.mockResolvedValueOnce(client);

    await expect(
      withTenantContext(VALID_CLINIC_ID, async () => {
        throw originalErr;
      }),
    ).rejects.toBe(originalErr);
  });

  it('calls client.release with an Error argument when ROLLBACK throws', async () => {
    const originalErr = new Error('fn failed');
    const rollbackErr = new Error('rollback failed');

    const client = createMockClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {};
      if (typeof sql === 'string' && sql.startsWith('SELECT set_config')) return {};
      if (sql === 'ROLLBACK') throw rollbackErr;
      throw new Error(`unexpected query: ${sql}`);
    });
    mockConnect.mockResolvedValueOnce(client);

    await expect(
      withTenantContext(VALID_CLINIC_ID, async () => {
        throw originalErr;
      }),
    ).rejects.toThrow();

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
    expect(client.release).toHaveBeenCalledWith(rollbackErr);
  });

  it('still propagates the original error when ROLLBACK succeeds normally', async () => {
    const originalErr = new Error('fn failed');

    const client = createMockClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {};
      if (typeof sql === 'string' && sql.startsWith('SELECT set_config')) return {};
      if (sql === 'ROLLBACK') return {};
      throw new Error(`unexpected query: ${sql}`);
    });
    mockConnect.mockResolvedValueOnce(client);

    await expect(
      withTenantContext(VALID_CLINIC_ID, async () => {
        throw originalErr;
      }),
    ).rejects.toBe(originalErr);

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith();
  });
});

describe('withoutTenantContext environment guard', () => {
  beforeEach(() => {
    mockConnect.mockReset();
    isTestEnvironmentMock.mockReset();
    isTestEnvironmentMock.mockReturnValue(true);
  });

  afterAll(async () => {
    await closePool();
  });

  it('throws when isTestEnvironment() returns false, without connecting to the pool', async () => {
    isTestEnvironmentMock.mockReturnValue(false);

    await expect(withoutTenantContext(async (client) => client.query('SELECT 1'))).rejects.toThrow(
      /withoutTenantContext must never be called outside the test suite/,
    );

    expect(mockConnect).not.toHaveBeenCalled();
  });
});
