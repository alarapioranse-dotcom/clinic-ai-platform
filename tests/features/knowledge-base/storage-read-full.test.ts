import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `readObjectForExtraction`'s contract (ADR-0026 section 3, the full-body read ADR-0021 Decision 3
 * requires a decision for): a GET conditioned on `IfMatch` with HeadObject's ETag, bounded by
 * HeadObject's length and by 10 MiB, failing closed on any mismatch. `@aws-sdk/client-s3` is
 * mocked, exactly as in storage-read-prefix.test.ts — this proves our own request shape and
 * translation logic, not real Scaleway I/O.
 */
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    send = sendMock;
  }
  class MockCommand {
    constructor(public input: unknown) {}
  }
  return {
    S3Client: MockS3Client,
    HeadObjectCommand: MockCommand,
    PutObjectCommand: MockCommand,
    GetObjectCommand: MockCommand,
  };
});

vi.mock('@/lib/env', () => ({
  getScalewayS3Endpoint: () => 'https://s3.fr-par.scw.cloud',
  getScalewayS3Region: () => 'fr-par',
  getScalewayS3Bucket: () => 'clinic-ai-knowledge-docs-test',
  getScalewayAccessKeyId: () => 'fake-access-key-id-for-tests-only',
  getScalewaySecretAccessKey: () => 'fake-secret-access-key-for-tests-only-never-real',
}));

import {
  OBJECT_FULL_READ_MAX_BYTES,
  readObjectForExtraction,
} from '@/features/knowledge-base/storage';

const KEY = 'clinic-id/document-id';
const ETAG = '"9b2cf535f27731c974343645a3985328"';

/** An async-iterable body, like the SDK's Node stream, that records how far it was consumed. */
function streamBody(parts: Uint8Array[]) {
  const state = { yielded: 0, destroyed: false };
  return {
    state,
    destroy: () => {
      state.destroyed = true;
    },
    async *[Symbol.asyncIterator]() {
      for (const part of parts) {
        state.yielded += 1;
        yield part;
      }
    },
  };
}

const bytes = (length: number, fill = 0x41) => new Uint8Array(length).fill(fill);

describe('readObjectForExtraction', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('is bounded by a fixed 10 MiB constant', () => {
    expect(OBJECT_FULL_READ_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('sends a GET with IfMatch, the bucket and the key — no Range — and returns every byte', async () => {
    const body = streamBody([bytes(3, 0x25), bytes(5, 0x50)]);
    sendMock.mockResolvedValueOnce({ Body: body, ContentLength: 8 });

    const result = await readObjectForExtraction(KEY, ETAG, 8);

    const command = sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toEqual({
      Bucket: 'clinic-ai-knowledge-docs-test',
      Key: KEY,
      IfMatch: ETAG,
    });
    expect(result).toEqual({
      outcome: 'ok',
      bytes: Uint8Array.from([0x25, 0x25, 0x25, 0x50, 0x50, 0x50, 0x50, 0x50]),
    });
  });

  it('refuses an expected length outside 1..10 MiB without calling the store', async () => {
    for (const length of [0, -1, 1.5, OBJECT_FULL_READ_MAX_BYTES + 1]) {
      await expect(readObjectForExtraction(KEY, ETAG, length)).rejects.toThrow('out of bounds');
    }
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('a ContentLength that differs from HeadObject is "changed", and the body is never consumed', async () => {
    const body = streamBody([bytes(10)]);
    sendMock.mockResolvedValueOnce({ Body: body, ContentLength: 10 });

    expect(await readObjectForExtraction(KEY, ETAG, 8)).toEqual({ outcome: 'changed' });
    expect(body.state.yielded).toBe(0);
    expect(body.state.destroyed).toBe(true);
  });

  it('a body longer than declared is abandoned as soon as it passes the bound', async () => {
    const body = streamBody([bytes(4), bytes(4), bytes(4), bytes(4)]);
    sendMock.mockResolvedValueOnce({ Body: body, ContentLength: 8 });

    expect(await readObjectForExtraction(KEY, ETAG, 8)).toEqual({ outcome: 'changed' });
    expect(body.state.yielded).toBe(3);
    expect(body.state.destroyed).toBe(true);
  });

  it('a body shorter than declared is "changed"', async () => {
    sendMock.mockResolvedValueOnce({ Body: streamBody([bytes(5)]), ContentLength: 8 });
    expect(await readObjectForExtraction(KEY, ETAG, 8)).toEqual({ outcome: 'changed' });
  });

  it('a missing body is "changed"', async () => {
    sendMock.mockResolvedValueOnce({ Body: undefined, ContentLength: 8 });
    expect(await readObjectForExtraction(KEY, ETAG, 8)).toEqual({ outcome: 'changed' });
  });

  it('412 Precondition Failed (the object was replaced) is "changed"', async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('pre'), {
        name: 'PreconditionFailed',
        $metadata: { httpStatusCode: 412 },
      }),
    );
    expect(await readObjectForExtraction(KEY, ETAG, 8)).toEqual({ outcome: 'changed' });
  });

  it('404 / NoSuchKey is "not_found"', async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'NoSuchKey' }));
    expect(await readObjectForExtraction(KEY, ETAG, 8)).toEqual({ outcome: 'not_found' });
  });

  it('any other storage error is rethrown, for the caller to fail closed', async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } }),
    );
    await expect(readObjectForExtraction(KEY, ETAG, 8)).rejects.toThrow('boom');
  });
});
