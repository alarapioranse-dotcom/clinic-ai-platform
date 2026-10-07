import { describe, it, expect, vi } from 'vitest';

/**
 * Presigned-URL generation is a pure local computation (SigV4 signing) —
 * no network call, so this runs against the real `@aws-sdk/client-s3` /
 * `@aws-sdk/s3-request-presigner` against fake, clearly-non-production
 * credentials (never a real Scaleway secret — see CLAUDE.md's "no real...
 * data anywhere" hard rule, extended here to credentials).
 *
 * What this proves: SigV4 presigned URLs embed the access key ID (in
 * `X-Amz-Credential`) and an HMAC-derived signature (`X-Amz-Signature`) —
 * by construction, the raw secret access key is never part of the URL. This
 * test asserts that property holds for our own `createPresignedUploadUrl`
 * wrapper specifically, per the human-approved requirement that no output
 * of the presigned-URL path can contain the secret access key.
 */
const FAKE_SECRET_ACCESS_KEY = 'fake-secret-access-key-for-tests-only-never-real';

vi.mock('@/lib/env', () => ({
  getScalewayS3Endpoint: () => 'https://s3.fr-par.scw.cloud',
  getScalewayS3Region: () => 'fr-par',
  getScalewayS3Bucket: () => 'clinic-ai-knowledge-docs-test',
  getScalewayAccessKeyId: () => 'fake-access-key-id-for-tests-only',
  getScalewaySecretAccessKey: () => FAKE_SECRET_ACCESS_KEY,
}));

import { createPresignedUploadUrl } from '@/features/knowledge-base/storage';

describe('createPresignedUploadUrl', () => {
  it('never includes the secret access key in the returned URL', async () => {
    const url = await createPresignedUploadUrl('clinic-id/document-id', 'application/pdf', 300);

    expect(url).not.toContain(FAKE_SECRET_ACCESS_KEY);
    // Sanity check this is actually a SigV4 presigned URL, not an
    // accidentally-empty string the "not.toContain" above would pass
    // vacuously.
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Credential=');
  });

  it('binds the declared Content-Type into the signed query string', async () => {
    const url = await createPresignedUploadUrl('clinic-id/document-id', 'application/pdf', 300);

    // ContentType on PutObjectCommand is a signed header, not a query
    // param — SigV4 records it in X-Amz-SignedHeaders, forcing the
    // browser's PUT to send the identical Content-Type or the signature
    // check fails server-side.
    expect(decodeURIComponent(url)).toMatch(/X-Amz-SignedHeaders=[^&]*content-type/i);
  });

  it('produces a URL that expires in the requested window', async () => {
    const url = await createPresignedUploadUrl('clinic-id/document-id', 'application/pdf', 300);

    expect(url).toContain('X-Amz-Expires=300');
  });

  it('embeds no flexible-checksum parameters the browser upload could not satisfy', async () => {
    const url = await createPresignedUploadUrl('clinic-id/document-id', 'application/pdf', 300);

    // With the SDK default, the URL carries a CRC32 of an EMPTY body
    // (`x-amz-checksum-crc32=AAAAAA==`) plus the algorithm name, so a store
    // that verifies it rejects every real file. Query keys are compared
    // case-insensitively so a casing change cannot hide a regression.
    const keys = [...new URL(url).searchParams.keys()].map((key) => key.toLowerCase());
    expect(keys.filter((key) => key.startsWith('x-amz-checksum'))).toEqual([]);
    expect(keys).not.toContain('x-amz-sdk-checksum-algorithm');
    // The checksum fix must not loosen the Content-Type binding.
    expect(decodeURIComponent(url)).toMatch(/X-Amz-SignedHeaders=[^&]*content-type/i);
  });
});
