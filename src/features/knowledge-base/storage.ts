import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
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
 * Scaleway Object Storage. Uploads never pass through this process (ADR-0018
 * Decision 1): this module never issues `PutObject` itself, only signs a URL
 * the browser uses directly.
 *
 * Server-side reads of object contents are exactly two, each authorised by
 * its own decision:
 *   - `readObjectPrefix`: at most 1024 bytes at upload completion (ADR-0021).
 *   - `readObjectForExtraction`: the whole object (at most 10 MiB), only for
 *     text extraction after completion. ADR-0021 Decision 3 requires any
 *     full-body read to have its own decision; ADR-0026 section 3 (Accepted)
 *     is that decision (Owner ruling G1, PR D).
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
      // The SDK's default ('WHEN_SUPPORTED') adds flexible checksums this
      // upload flow cannot satisfy. On the presigned PUT it embeds
      // `x-amz-sdk-checksum-algorithm=CRC32` and `x-amz-checksum-crc32` of an
      // EMPTY body into the URL, so a store that verifies it would reject
      // every real file the browser uploads. On `readObjectPrefix`'s ranged
      // GET it sends `x-amz-checksum-mode: ENABLED`, inviting a whole-object
      // checksum to be validated against a 1024-byte partial body. Neither
      // checksum is required by the operations used here; integrity of the
      // stored object is still established at completion by HeadObject plus
      // the If-Match-bound prefix read (ADR-0021).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
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
  etag: string | undefined;
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
 * object at upload time, not that the bytes are actually a PDF — the
 * signature check in `readObjectPrefix` / `./pdf-signature` (ADR-0021) is
 * what establishes that.
 *
 * `etag` is returned exactly as Scaleway sends it (including its quotes) so
 * `readObjectPrefix` can bind its read to this same object with `IfMatch`.
 * It is `undefined` when the response carried none; the caller must then
 * fail closed rather than read without the precondition.
 */
export async function headObject(key: string): Promise<HeadObjectResult | null> {
  try {
    const result = await getClient().send(
      new HeadObjectCommand({ Bucket: getScalewayS3Bucket(), Key: key }),
    );
    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType,
      etag: result.ETag,
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

/**
 * The number of object bytes the completion-time signature check reads
 * (ADR-0021: at most the first 1024 bytes, completion only, solely for the
 * file-type signature check). A fixed constant on purpose — it is not a
 * parameter, so no caller can widen that read. The only other read,
 * `readObjectForExtraction`, has its own bound and its own decision
 * (ADR-0026 section 3).
 */
export const OBJECT_PREFIX_READ_BYTES = 1024;

export type ReadObjectPrefixResult =
  { outcome: 'ok'; bytes: Uint8Array } | { outcome: 'not_found' } | { outcome: 'changed' };

/**
 * Bounded prefix read for authoritative file-type validation (ADR-0021).
 * Issues a ranged GET (`Range: bytes=0-1023`) for `key`, conditioned on
 * `IfMatch: etag` where `etag` is the ETag HeadObject returned for the same
 * key — so the bytes read are guaranteed to belong to the very object whose
 * size and Content-Type were just checked. If the object was replaced in
 * between, the store answers 412 and this returns `{ outcome: 'changed' }`.
 *
 * Bounds, enforced in layers:
 * 1. The request carries `Range: bytes=0-1023`.
 * 2. If the store ignores `Range` and would send more than 1024 bytes
 *    (`ContentLength` absent or above the bound), the body is never
 *    consumed — the stream is discarded and an error is thrown.
 * 3. Whatever was read is cut to 1024 bytes before it is returned.
 *
 * The bytes are returned to the caller for the signature check only: they
 * are never logged, persisted, or placed in an error message. No parsing,
 * extraction, or AI happens here.
 */
export async function readObjectPrefix(key: string, etag: string): Promise<ReadObjectPrefixResult> {
  try {
    const result = await getClient().send(
      new GetObjectCommand({
        Bucket: getScalewayS3Bucket(),
        Key: key,
        Range: `bytes=0-${OBJECT_PREFIX_READ_BYTES - 1}`,
        IfMatch: etag,
      }),
    );

    const body = result.Body;
    if (
      !body ||
      result.ContentLength === undefined ||
      result.ContentLength > OBJECT_PREFIX_READ_BYTES
    ) {
      // Do not consume an unbounded body: release the connection instead.
      (body as { destroy?: () => void } | undefined)?.destroy?.();
      throw new Error('Object storage returned an unexpected response to a bounded ranged read.');
    }

    const bytes = await body.transformToByteArray();
    return {
      outcome: 'ok',
      bytes:
        bytes.length > OBJECT_PREFIX_READ_BYTES
          ? bytes.subarray(0, OBJECT_PREFIX_READ_BYTES)
          : bytes,
    };
  } catch (err) {
    if (isNotFoundError(err)) {
      return { outcome: 'not_found' };
    }
    if (isPreconditionFailedError(err)) {
      return { outcome: 'changed' };
    }
    throw err;
  }
}

function isPreconditionFailedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const name = 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'PreconditionFailed') {
    return true;
  }
  const metadata =
    '$metadata' in err ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata : undefined;
  return metadata?.httpStatusCode === 412;
}

/**
 * The most bytes `readObjectForExtraction` ever accepts: the same 10 MiB limit
 * as upload completion. A fixed constant, not a parameter.
 */
export const OBJECT_FULL_READ_MAX_BYTES = 10 * 1024 * 1024;

export type ReadObjectForExtractionResult =
  { outcome: 'ok'; bytes: Uint8Array } | { outcome: 'not_found' } | { outcome: 'changed' };

/**
 * Whole-object read for text extraction (ADR-0026 section 3, the full-body read
 * decision ADR-0021 Decision 3 requires). A GET conditioned on `IfMatch: etag`,
 * where `etag` and `expectedLength` come from a HeadObject of the same key just
 * before, so the bytes belong to the object whose size and Content-Type were
 * checked.
 *
 * Bounds, enforced in layers:
 * 1. `expectedLength` must be between 1 and OBJECT_FULL_READ_MAX_BYTES.
 * 2. The response's `ContentLength` must equal `expectedLength`; otherwise the
 *    body is never consumed.
 * 3. The body is read as a stream and abandoned as soon as more bytes arrive
 *    than `expectedLength`; a shorter body is treated the same way.
 * A store answering 412 (the object was replaced), a length mismatch or an
 * over-long body all return `{ outcome: 'changed' }`: extraction fails closed
 * rather than assume the object is unchanged.
 *
 * The bytes go to the extraction worker only: they are never logged, persisted,
 * returned to a client or placed in an error message.
 */
export async function readObjectForExtraction(
  key: string,
  etag: string,
  expectedLength: number,
): Promise<ReadObjectForExtractionResult> {
  if (
    !Number.isInteger(expectedLength) ||
    expectedLength < 1 ||
    expectedLength > OBJECT_FULL_READ_MAX_BYTES
  ) {
    throw new Error('readObjectForExtraction: expected length out of bounds.');
  }

  let body: unknown;
  try {
    const result = await getClient().send(
      new GetObjectCommand({ Bucket: getScalewayS3Bucket(), Key: key, IfMatch: etag }),
    );
    body = result.Body;
    if (!body || result.ContentLength !== expectedLength) {
      destroyBody(body);
      return { outcome: 'changed' };
    }

    const parts: Uint8Array[] = [];
    let total = 0;
    for await (const part of body as AsyncIterable<Uint8Array>) {
      total += part.byteLength;
      if (total > expectedLength) {
        destroyBody(body);
        return { outcome: 'changed' };
      }
      parts.push(part);
    }
    if (total !== expectedLength) {
      return { outcome: 'changed' };
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return { outcome: 'ok', bytes };
  } catch (err) {
    destroyBody(body);
    if (isNotFoundError(err)) {
      return { outcome: 'not_found' };
    }
    if (isPreconditionFailedError(err)) {
      return { outcome: 'changed' };
    }
    throw err;
  }
}

function destroyBody(body: unknown): void {
  (body as { destroy?: () => void } | undefined)?.destroy?.();
}
