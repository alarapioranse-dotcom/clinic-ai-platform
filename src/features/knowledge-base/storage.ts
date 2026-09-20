import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  getScalewayS3Endpoint,
  getScalewayS3Region,
  getScalewayS3Bucket,
  getScalewayAccessKeyId,
  getScalewaySecretAccessKey,
} from '@/lib/env';

/**
 * Internal to this feature — not exported from `./index.ts`. Nothing outside
 * `src/features/knowledge-base/**` may import this module directly (see
 * CONTRIBUTING.md, "a feature never imports another feature's internals").
 *
 * Roadmap P5 Slice 1B (ADR-0018, Accepted): the only module that talks to
 * Scaleway Object Storage. Two operations only, matching the upload flow's
 * two stages — a presigned PUT for initiation, a HeadObject for completion.
 * File bytes never pass through this process (ADR-0018 Decision 1): this
 * module never issues `PutObject` itself, only signs a URL the browser uses
 * directly.
 *
 * Credentials come only from `src/lib/env.ts`'s lazy Scaleway getters —
 * never read from `process.env` here, never logged, never included in a
 * thrown error's message.
 */

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: getScalewayS3Endpoint(),
      region: getScalewayS3Region(),
      // Path-style addressing works uniformly against both Scaleway and a
      // local MinIO stand-in (ADR-0018 Decision 7); virtual-hosted-style
      // buys nothing here and would need per-environment tuning instead.
      forcePathStyle: true,
      credentials: {
        accessKeyId: getScalewayAccessKeyId(),
        secretAccessKey: getScalewaySecretAccessKey(),
      },
    });
  }
  return client;
}

/**
 * Generates a presigned PUT URL for `key`, valid for `expiresInSeconds`.
 * `contentType` is bound into the signature (ADR-0018's completion-flow
 * design requires the actual uploaded object's Content-Type to be
 * checkable): the browser's PUT request must send the identical
 * `Content-Type` header, or Scaleway rejects the upload with a signature
 * mismatch before any bytes are accepted.
 *
 * `getSignedUrl` computes the SigV4 signature locally — no network call — so
 * this never touches the object store itself and never fails on a
 * misconfigured endpoint until the browser actually uses the URL.
 */
export async function createPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds: number,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getScalewayS3Bucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(), command, {
    expiresIn: expiresInSeconds,
    // The AWS SDK v3 presigner signs only the `host` header by default for
    // query-string (presigned-URL) signing — `ContentType` on the command
    // sets the header the browser must send, but does NOT bind it into the
    // signature unless explicitly listed here. Without this, a client could
    // PUT with any Content-Type and the signature would still validate.
    signableHeaders: new Set(['content-type']),
  });
}

export interface HeadObjectResult {
  contentLength: number;
  contentType: string | undefined;
}

/**
 * The completion flow's sole source of truth (ADR-0018 / human-approved
 * decisions): calls Scaleway's HeadObject for `key` and returns the actual
 * stored `ContentLength`/`Content-Type` — never a client-declared value.
 * Returns `null` when no object exists at `key` (the browser upload never
 * completed, the key is wrong, or a cross-clinic completion attempt derived
 * a key nothing was ever uploaded to) — the caller maps that to "missing
 * object at completion," never distinguishing those cases further.
 *
 * `Content-Type` proves only the stored metadata Scaleway recorded for the
 * object at upload time, not that the bytes are actually a PDF — magic-byte
 * validation is an explicit future follow-up, not this slice's job.
 */
export async function headObject(key: string): Promise<HeadObjectResult | null> {
  try {
    const result = await getClient().send(
      new HeadObjectCommand({ Bucket: getScalewayS3Bucket(), Key: key }),
    );
    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType,
    };
  } catch (err) {
    if (isNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const name = 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'NotFound' || name === 'NoSuchKey') {
    return true;
  }
  const metadata =
    '$metadata' in err ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata : undefined;
  return metadata?.httpStatusCode === 404;
}
