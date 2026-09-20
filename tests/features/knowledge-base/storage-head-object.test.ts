import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `headObject`'s translation of the AWS SDK's HeadObject outcomes —
 * completion's authoritative check (ADR-0018 / human-approved decisions).
 * `@aws-sdk/client-s3` is mocked here (unlike storage-presign.test.ts):
 * unlike presigning, HeadObject is a real network call, so this file
 * proves our own not-found/found/rethrow translation logic against a
 * controlled fake client rather than exercising real Scaleway I/O.
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

import { headObject } from '@/features/knowledge-base/storage';

describe('headObject', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('returns null when the SDK reports NotFound (no object at this key)', async () => {
    const err = Object.assign(new Error('not found'), { name: 'NotFound' });
    sendMock.mockRejectedValueOnce(err);

    expect(await headObject('clinic-id/missing-document-id')).toBeNull();
  });

  it('returns null when the SDK reports NoSuchKey', async () => {
    const err = Object.assign(new Error('no such key'), { name: 'NoSuchKey' });
    sendMock.mockRejectedValueOnce(err);

    expect(await headObject('clinic-id/missing-document-id')).toBeNull();
  });

  it('returns null on a raw 404 $metadata response with no recognized error name', async () => {
    const err = Object.assign(new Error('gone'), { $metadata: { httpStatusCode: 404 } });
    sendMock.mockRejectedValueOnce(err);

    expect(await headObject('clinic-id/missing-document-id')).toBeNull();
  });

  it('returns the actual ContentLength/Content-Type when the object exists', async () => {
    sendMock.mockResolvedValueOnce({ ContentLength: 2048, ContentType: 'application/pdf' });

    await expect(headObject('clinic-id/document-id')).resolves.toEqual({
      contentLength: 2048,
      contentType: 'application/pdf',
    });
  });

  it('rethrows an unrecognized error, and neither its message nor its name contains the secret access key', async () => {
    const err = new Error('connection reset');
    sendMock.mockRejectedValueOnce(err);

    await expect(headObject('clinic-id/document-id')).rejects.toThrow('connection reset');
    try {
      await headObject('clinic-id/document-id');
    } catch (caught) {
      expect(String((caught as Error).message)).not.toContain(FAKE_SECRET_ACCESS_KEY);
      expect(String(caught)).not.toContain(FAKE_SECRET_ACCESS_KEY);
    }
  });
});
