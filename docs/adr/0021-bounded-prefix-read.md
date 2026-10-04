# 0021 — Bounded prefix read for authoritative file-type validation (clarifies ADR-0018 Decision 1)

## Status

Accepted — 2026-10-04. Approved by the owner in a comment on
[PR #78](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/78).

## Date

2026-10-04

## Phase

P5 — Knowledge base and AI (see [`docs/03-roadmap.md`](../03-roadmap.md)).

## Context

[ADR-0018](./0018-knowledge-document-object-storage.md) Decision 1 states that the file's bytes
"must never pass through the Next.js process". Its stated rationale is the memory and
request-handling cost of buffering multi-megabyte uploads on Render's Free plan. Upload completion
currently trusts only HeadObject metadata (ContentLength, Content-Type). A stored Content-Type does
not prove the bytes are a PDF. An authoritative file-type check requires reading the first bytes of
the stored object, which the literal wording of Decision 1 does not permit.

## Decision

1. ADR-0018 Decision 1 is clarified, not reversed. Uploads remain direct browser-to-Scaleway via
   presigned PUT. No upload body is routed through the Next.js process and no whole file is ever
   buffered there.
2. This record is an explicit exception to the literal wording of Decision 1: during upload
   completion, after HeadObject succeeds and before the `knowledge_documents` row is inserted, the
   server may read at most the first 1024 bytes of the stored object (ranged GET, server-side
   credentials) solely to verify the file-type signature.
3. Bounds: at most 1024 bytes per completion; completion only; no parsing, extraction, chunking,
   embedding or AI call; the bytes are not persisted, logged, returned to the client or sent to any
   third party. This record authorizes no other server-side read of object contents. Any full-body
   read (extraction, download) requires its own decision.
4. The exact signature policy is specified by the implementing slice, not by this record.

## Consequences

- The type check becomes authoritative for the signature, at the cost of one small ranged read per
  completion and read permission on the application's storage key.
- It does not prove a file is safe. A signature check is not malware scanning or structural
  validation.
- The bound (1024 bytes) is a fixed constant, so memory cost does not scale with file size.

## Alternatives considered

- Leave Decision 1 literal and skip validation: rejected, Content-Type metadata is client-asserted.
- Edit ADR-0018 in place: not permitted (charter §10).
- Browser-side validation: not authoritative.
- Server-side full read: contradicts the purpose of ADR-0018 Decision 1.
