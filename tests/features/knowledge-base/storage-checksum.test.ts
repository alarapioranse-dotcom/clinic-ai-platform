import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression coverage for the S3 client's checksum configuration on
 * `readObjectPrefix`'s ranged GET (ADR-0021). Unlike
 * storage-read-prefix.test.ts, which replaces `@aws-sdk/client-s3`
 * entirely, this runs the real SDK middleware stack so the headers the SDK
 * itself adds are observable. The only substitution is the request handler:
 * it records the outgoing HTTP request and throws instead of sending it, so
 * no network call is ever made and no credential is ever real.
 *
 * With the SDK default (`responseChecksumValidation: 'WHEN_SUPPORTED'`) the
 * GET carries `x-amz-checksum-mode: ENABLED`, inviting a whole-object
 * checksum to be validated against a 1024-byte partial body.
 */
interface CapturedRequest {
  method: string;
  headers: Record<string, string>;
}

const { captured } = vi.hoisted(() => ({ captured: [] as CapturedRequest[] }));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  class CapturingS3Client extends actual.S3Client {
    constructor(config: ConstructorParameters<typeof actual.S3Client>[0]) {
      super({
        ...config,
        requestHandler: {
          handle: async (request: CapturedRequest) => {
            captured.push({ method: request.method, headers: { ...request.headers } });
            throw new Error('request captured by test handler; not sent');
          },
        } as unknown as NonNullable<
          ConstructorParameters<typeof actual.S3Client>[0]
        >['requestHandler'],
      });
    }
  }
  return { ...actual, S3Client: CapturingS3Client };
});

vi.mock('@/lib/env', () => ({
  getScalewayS3Endpoint: () => 'https://s3.fr-par.scw.cloud',
  getScalewayS3Region: () => 'fr-par',
  getScalewayS3Bucket: () => 'clinic-ai-knowledge-docs-test',
  getScalewayAccessKeyId: () => 'fake-access-key-id-for-tests-only',
  getScalewaySecretAccessKey: () => 'fake-secret-access-key-for-tests-only-never-real',
}));

import { readObjectPrefix } from '@/features/knowledge-base/storage';

const KEY = 'clinic-id/document-id';
const ETAG = '"9b2cf535f27731c974343645a3985328"';

function lowerCaseHeaders(request: CapturedRequest): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

describe('readObjectPrefix checksum behaviour (real SDK, captured request)', () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it('does not ask the store for a response checksum on the ranged GET', async () => {
    await expect(readObjectPrefix(KEY, ETAG)).rejects.toThrow();

    expect(captured).toHaveLength(1);
    const request = captured[0]!;
    expect(request.method).toBe('GET');
    const headers = lowerCaseHeaders(request);
    expect(Object.keys(headers).filter((name) => name.startsWith('x-amz-checksum'))).toEqual([]);
  });

  it('still sends the bounded Range and the If-Match precondition unchanged', async () => {
    await expect(readObjectPrefix(KEY, ETAG)).rejects.toThrow();

    const headers = lowerCaseHeaders(captured[0]!);
    expect(headers.range).toBe('bytes=0-1023');
    expect(headers['if-match']).toBe(ETAG);
  });
});
