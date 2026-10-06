import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `readObjectPrefix`'s contract (ADR-0021): a ranged GET of at most the first
 * 1024 bytes, conditioned on `IfMatch` with HeadObject's ETag, never reading
 * an unbounded body, and translating not-found / precondition-failed outcomes
 * without leaking anything sensitive. `@aws-sdk/client-s3` is mocked, exactly
 * as in storage-head-object.test.ts — this proves our own request shape and
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
  class MockGetObjectCommand extends MockCommand {}
  return {
    S3Client: MockS3Client,
    HeadObjectCommand: MockCommand,
    PutObjectCommand: MockCommand,
    GetObjectCommand: MockGetObjectCommand,
  };
});

const FAKE_SECRET_ACCESS_KEY = 'fake-secret-access-key-for-tests-only-never-real';

vi.mock('@/lib/env', () => ({
  getScalewayS3Endpoint: () => 'https://s3.fr-par.scw.cloud',
  getScalewayS3Region: () => 'fr-par',
  getScalewayS3Bucket: () => 'clinic-ai-knowledge-docs-test',
  getScalewayAccessKeyId: () => 'fake-access-key-id-for-tests-only',
  getScalewaySecretAccessKey: () => FAKE_SECRET_ACCESS_KEY,
}));

import { readObjectPrefix, OBJECT_PREFIX_READ_BYTES } from '@/features/knowledge-base/storage';

const KEY = 'clinic-id/document-id';
const ETAG = '"9b2cf535f27731c974343645a3985328"';

function fakeBody(content: Uint8Array) {
  return {
    transformToByteArray: vi.fn().mockResolvedValue(content),
    destroy: vi.fn(),
  };
}

describe('readObjectPrefix', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('reads at most 1024 bytes: the bound is a fixed constant of 1024', () => {
    expect(OBJECT_PREFIX_READ_BYTES).toBe(1024);
  });

  it('sends Range bytes=0-1023, IfMatch with the given ETag, and the correct bucket and key', async () => {
    const body = fakeBody(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    sendMock.mockResolvedValueOnce({ Body: body, ContentLength: 4 });

    await readObjectPrefix(KEY, ETAG);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toEqual({
      Bucket: 'clinic-ai-knowledge-docs-test',
      Key: KEY,
      Range: 'bytes=0-1023',
      IfMatch: ETAG,
    });
  });

  it('returns the bytes read', async () => {
    const content = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    sendMock.mockResolvedValueOnce({ Body: fakeBody(content), ContentLength: content.length });

    const result = await readObjectPrefix(KEY, ETAG);

    expect(result).toEqual({ outcome: 'ok', bytes: content });
  });

  it('accepts a response of exactly 1024 bytes', async () => {
    const content = new Uint8Array(1024).fill(0x41);
    sendMock.mockResolvedValueOnce({ Body: fakeBody(content), ContentLength: 1024 });

    const result = await readObjectPrefix(KEY, ETAG);

    expect(result.outcome).toBe('ok');
    if (result.outcome === 'ok') {
      expect(result.bytes.length).toBe(1024);
    }
  });

  it('truncates to 1024 bytes as a last-resort cap if the stream yields more than it declared', async () => {
    const oversized = new Uint8Array(4096).fill(0x42);
    sendMock.mockResolvedValueOnce({ Body: fakeBody(oversized), ContentLength: 1024 });

    const result = await readObjectPrefix(KEY, ETAG);

    expect(result.outcome).toBe('ok');
    if (result.outcome === 'ok') {
      expect(result.bytes.length).toBe(1024);
    }
  });

  it('refuses without consuming the body when the store ignores Range and reports more than 1024 bytes', async () => {
    const body = fakeBody(new Uint8Array(1024));
    sendMock.mockResolvedValueOnce({ Body: body, ContentLength: 10485760 });

    await expect(readObjectPrefix(KEY, ETAG)).rejects.toThrow(
      'unexpected response to a bounded ranged read',
    );
    expect(body.transformToByteArray).not.toHaveBeenCalled();
    expect(body.destroy).toHaveBeenCalledTimes(1);
  });

  it('refuses without consuming the body when ContentLength is absent', async () => {
    const body = fakeBody(new Uint8Array(8));
    sendMock.mockResolvedValueOnce({ Body: body });

    await expect(readObjectPrefix(KEY, ETAG)).rejects.toThrow(
      'unexpected response to a bounded ranged read',
    );
    expect(body.transformToByteArray).not.toHaveBeenCalled();
    expect(body.destroy).toHaveBeenCalledTimes(1);
  });

  it('refuses when the response has no body', async () => {
    sendMock.mockResolvedValueOnce({ ContentLength: 8 });

    await expect(readObjectPrefix(KEY, ETAG)).rejects.toThrow(
      'unexpected response to a bounded ranged read',
    );
  });

  it('returns not_found when the SDK reports NoSuchKey', async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error('no such key'), { name: 'NoSuchKey' }));

    expect(await readObjectPrefix(KEY, ETAG)).toEqual({ outcome: 'not_found' });
  });

  it('returns not_found when the SDK reports NotFound', async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error('nf'), { name: 'NotFound' }));

    expect(await readObjectPrefix(KEY, ETAG)).toEqual({ outcome: 'not_found' });
  });

  it('returns not_found on a raw 404 $metadata response', async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('gone'), { $metadata: { httpStatusCode: 404 } }),
    );

    expect(await readObjectPrefix(KEY, ETAG)).toEqual({ outcome: 'not_found' });
  });

  it('returns changed when the SDK reports PreconditionFailed (If-Match did not match)', async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('precondition failed'), { name: 'PreconditionFailed' }),
    );

    expect(await readObjectPrefix(KEY, ETAG)).toEqual({ outcome: 'changed' });
  });

  it('returns changed on a raw 412 $metadata response with no recognized error name', async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('412'), { $metadata: { httpStatusCode: 412 } }),
    );

    expect(await readObjectPrefix(KEY, ETAG)).toEqual({ outcome: 'changed' });
  });

  it('rethrows an unrecognized error, and neither its message nor its name contains the secret access key', async () => {
    sendMock.mockRejectedValueOnce(new Error('connection reset'));
    await expect(readObjectPrefix(KEY, ETAG)).rejects.toThrow('connection reset');

    sendMock.mockRejectedValueOnce(new Error('connection reset'));
    try {
      await readObjectPrefix(KEY, ETAG);
    } catch (caught) {
      expect(String((caught as Error).message)).not.toContain(FAKE_SECRET_ACCESS_KEY);
      expect(String(caught)).not.toContain(FAKE_SECRET_ACCESS_KEY);
    }
  });

  it('never writes the bytes it read to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const content = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    sendMock.mockResolvedValueOnce({ Body: fakeBody(content), ContentLength: content.length });

    await readObjectPrefix(KEY, ETAG);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
