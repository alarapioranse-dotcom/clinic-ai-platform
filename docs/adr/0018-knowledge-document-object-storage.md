# 0018 — Knowledge-document raw-file object storage

## Status

Proposed

## Date

2026-09-19

## Phase

P5 — Knowledge base and AI (see [`docs/03-roadmap.md`](../03-roadmap.md)).

## Impact

One-way door (see [charter §10](../governance/project-charter.md)) — this decision is required
before code, plus Ahmed's approval, per the charter's ADR Policy table. Migrating a production
knowledge base's raw files from one object-storage vendor, region, or bucket layout to another
later means re-uploading and re-validating every live clinic's documents simultaneously — the same
class of cost [ADR-0008](./0008-embeddings-storage.md)'s Impact section names for embeddings
storage, one layer up: the file the embeddings were derived from.

## Context

[`docs/technical/06-knowledge-document-storage.md`](../technical/06-knowledge-document-storage.md)
fixes the shape of raw-file storage for `knowledge_documents` (one S3-compatible object per
`storage_key`, private, accessed only through short-lived server-generated URLs, deleted in the
same logical operation as the row) but explicitly declines to name a vendor or region, deferring
that to [issue #7](https://github.com/alarapioranse-dotcom/clinic-ai-platform/issues/7).
[ADR-0009](./0009-data-residency.md) (Accepted) resolved issue #7's residency question — EU/EEA
only, GDPR as the sole governing regime — but did not itself pick an object-storage vendor.
[ADR-0008](./0008-embeddings-storage.md) (Accepted) resolved where the _derived_ retrieval
representation lives (co-located pgvector); it explicitly does not touch raw-file storage.

[PR #66](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/66) (draft, not merged) is
a read-only investigation that traced every documented `knowledge_documents` endpoint back to what
it requires to exist, and found that all four depend, directly or indirectly, on real object-store
I/O — most directly `POST /api/knowledge-documents`, which cannot be written at all without a
vendor, region, and credential-acquisition path already decided. Its conclusion: no P5 Slice 1
exists that is both meaningful and buildable until this ADR is resolved. That conclusion is the
reason this ADR exists now, on the same footing as [ADR-0007](./0007-ai-provider-constraints.md)
(AI provider) and [ADR-0008](./0008-embeddings-storage.md) (embeddings storage) before it.

This ADR inherits, and does not reopen, the following constraints already fixed by
`06-knowledge-document-storage.md` and the Accepted ADRs above:

- S3-compatible object store (`06-knowledge-document-storage.md`, "Raw file storage").
- EU/EEA residency only, no sub-processor outside the EEA without a DPA
  ([ADR-0009](./0009-data-residency.md), items 3 and 4).
- Buckets and objects are always private; nothing is ever public
  (`06-knowledge-document-storage.md`, "Access is via short-lived, server-generated URLs — no
  bucket or object is ever public").
- Access is via short-lived, server-generated presigned URLs, re-deriving `storage_key` from an
  RLS-scoped row lookup so file access inherits tenant isolation rather than needing its own
  (`06-knowledge-document-storage.md`, same section).
- Embeddings live in co-located pgvector, tenant-scoped
  ([ADR-0008](./0008-embeddings-storage.md)) — **this ADR does not touch embedding storage.**

This ADR also does not decide extraction, chunking, or embedding generation — those are fixed
elsewhere in `06-knowledge-document-storage.md`'s "Processing lifecycle" section — nor the AI
provider, which is [ADR-0007](./0007-ai-provider-constraints.md)'s decision alone.

### Scope note — knowledge documents carry no patient data

Recorded per the owner's comment on this pull request: `knowledge_documents` hold clinic-authored
material — service descriptions, pricing, opening hours, and policies the clinic publishes about
itself — not patient data. [ADR-0009](./0009-data-residency.md)'s EU/EEA residency requirement
still applies in full to this content regardless; nothing in this scope note narrows items 3 or 4
of ADR-0009 (residency, sub-processor DPA requirement). What it does narrow is the _vendor
jurisdiction_ axis this ADR's original draft weighted heavily: a US-headquartered vendor's CLOUD
Act exposure is a materially smaller concern for clinic-authored, non-personal-data content than it
would be for patient records. That is why jurisdiction is treated below as a question the owner
settled directly, rather than as an open axis this ADR keeps weighing candidate-by-candidate.

## Decision

**Owner ruling required, partial so far.** This record sets out the remaining candidates and their
trade-offs against the inherited constraints; it does not select one. Status stays `Proposed` until
Ahmed rules on a specific provider, recorded as a human comment on the pull request, per charter
§10 and the pattern [ADR-0017](./0017-clinic-working-hours-dst-transitions.md) followed.

### Owner ruling so far — jurisdiction

Ahmed ruled directly on the jurisdiction axis, in a comment on this pull request: an
EU-headquartered provider is chosen regardless of how narrow the CLOUD Act exposure is for
non-personal-data content (see the scope note above) — "it closes the question outright rather
than requiring anyone to reason about how narrow the exposure is, and at our scale it costs
nothing." That ruling removes AWS S3, Cloudflare R2, and Backblaze B2 from further consideration —
not because any of the three fails an inherited constraint, but because the three EU-headquartered
candidates (Scaleway, OVHcloud, Hetzner) satisfy the same constraints without the jurisdiction
question existing at all. This is recorded as a settled sub-decision, not as this ADR's own
reasoning; the candidate comparison below reflects it. The provider itself among the three is still
open, blocked on the upload-path question below.

### What this ADR must decide (owner's call)

1. **Provider**, from the three EU-headquartered candidates below. Blocked on item 3.
2. **EU/EEA region** (Scaleway, OVHcloud, and Hetzner each offer more than one).
3. **Upload path** — browser-to-object-store direct via presigned PUT, or browser-to-our-Next.js-
   server-to-object-store — since this changes which of the three remains viable without a proxy
   workaround. See "Upload path" below; this is the question the owner's ruling identifies as
   blocking provider selection.
4. **Bucket and storage boundary** — one bucket for all clinics with key prefixing (e.g.
   `storage_key = clinic_id/document_id`), or a bucket per clinic. See "Bucket boundary" below.
5. **Encryption and retention assumptions** — only those genuinely required. No retention policy is
   invented here: [ADR-0009](./0009-data-residency.md) item 6 already established that this
   platform enforces no default clinical retention period and never auto-deletes clinical records
   absent explicit tenant configuration. The only retention-adjacent fact this ADR need record is
   whatever the chosen vendor does or does not require configuring by default (e.g. default
   lifecycle rules that must be explicitly disabled to avoid contradicting ADR-0009 item 6).
6. **The presigned-URL mechanism**, inheriting the private-object requirement above and the upload
   path chosen under item 3.
7. **How the application obtains storage credentials and configuration** — e.g. long-lived static
   keys in environment variables vs. some other credential-issuance path, and how that interacts
   with Render as the deployment target.

### Considered and set aside — AWS S3, Cloudflare R2, Backblaze B2

All three satisfy every constraint this ADR inherits: EU/EEA region, S3-API compatibility,
presigned-URL support, and an available DPA. They are set aside here solely on the owner's
jurisdiction ruling above — each is a US-headquartered company (AWS, Cloudflare, Backblaze), so
each carries a US-nexus CLOUD Act exposure that an EU-headquartered vendor does not, regardless of
where the data itself resides. Cloudflare R2 in particular would otherwise have been a strong
candidate on pricing (zero egress fees) and Backblaze B2 on raw storage cost; both are recorded
here for completeness, not because either failed a technical constraint. Not re-verified further
in this pass, since the owner ruling makes the distinction moot for provider selection.

### Candidate comparison — Scaleway, OVHcloud, Hetzner

Re-researched this pass, sourced individually, against: presigned-URL support, DPA availability and
document name, egress pricing, and CORS support for direct browser uploads (the specific item the
owner's own verification flagged for Hetzner).

| Candidate                                                                     | Presigned URLs                                                                                                                                                                     | DPA                                                                                                                                                                                                                                                                                                                                                                           | Egress pricing                                                                                                                                                                                                                                                                                                                                                                                  | CORS (for direct browser presigned uploads)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scaleway Object Storage** (Paris FR-PAR / Amsterdam NL-AMS / Warsaw PL-WAW) | Yes — `boto3`'s `generate_presigned_url`/`generate_presigned_post` work unchanged against Scaleway's endpoint (Scaleway's own "Adding objects to a bucket with POST object" docs). | Yes, named: **"Data Processing Agreement"**, a versioned, downloadable PDF (e.g. the June 2024 revision) published on Scaleway's Contracts page / Trust Center.                                                                                                                                                                                                               | ≈ €0.01/GB after a free allowance, intra-region transfer free; this figure is corroborated by two independent secondary sources in this pass but was not read directly off Scaleway's own live pricing page — **treat the exact current rate as approximately, not exactly, verified**.                                                                                                         | Supported and documented directly: Scaleway's "Setting CORS rules on Object Storage buckets" guide covers `AllowedOrigins`/`AllowedMethods` (including `PUT`, `POST`)/`AllowedHeaders` via a JSON CORS config applied through the API/CLI. Direct browser-to-Scaleway presigned uploads are a documented, supported path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **OVHcloud Object Storage** (France / Germany / Poland datacenters)           | Yes — OVHcloud's own docs describe generating and sharing objects via presigned URL (max 7-day expiry), and confirm `boto3`'s `generate_presigned_url` works against its endpoint. | Yes, named: **"Data Processing Agreement"** (OVHcloud's own "OVH Data Processing Agreement" document, versioned e.g. IE-6.2), published at OVHcloud's legal/DPA page with downloadable PDF revisions.                                                                                                                                                                         | **Free** — OVHcloud removed egress fees on standard Object Storage outbound traffic across all classes and regions, effective for consumption from December 2025 onward (per OVHcloud's own announcement). Its separate "High Performance Object Storage" product is a different, premium offering with its own egress pricing (~$0.015/GB) — not the standard product this comparison assumes. | Supported, with a caveat worth flagging rather than smoothing over: OVHcloud has a dedicated "Setting up CORS on Object Storage" guide, but at least one community report states the standard `aws s3api put-bucket-cors` CLI command is _not_ supported against OVHcloud's endpoint — CORS must be set through OVHcloud's own documented method instead of the generic AWS CLI command. Functionally supported; tooling is not a drop-in AWS CLI replacement for this one operation.                                                                                                                                                                                                                                                                                                                                                                   |
| **Hetzner Object Storage** (Falkenstein DE / Nuremberg DE / Helsinki FI)      | Yes, and this is now owner-verified directly (see the PR comment): Hetzner Object Storage supports presigned URLs with expiry.                                                     | Named and located precisely: **Hetzner's Data Processing Agreement**, downloadable from the customer's own account at `accounts.hetzner.com/account/dpa`, executed under GDPR Art. 28; Hetzner separately publishes its Technical and Organizational Measures (TOMs) document as a DPA appendix, and holds ISO/IEC 27001:2022 certification plus a BSI C5 Type 2 attestation. | Bundled, not pure pay-per-GB: ≈ €6.49/month includes 1 TB storage _and_ 1 TB egress; extra egress ≈ €1/TB beyond that. Cheapest absolute cost at small scale among the three, once the bundle is accounted for.                                                                                                                                                                                 | **Does not work out of the box for direct browser uploads**, confirmed both by the owner's own verification and independently in this pass: Hetzner Object Storage has no CORS-configuration UI (CORS must be set via the AWS CLI directly against the endpoint) and, per multiple independent reports including a documented engineering write-up ("How We Enabled Presigned Uploads to Hetzner Object Storage (Even Without CORS Support)"), presigned PUT uploads issued directly from a browser are blocked by missing CORS response headers even after CORS rules are configured — teams that need direct-from-browser uploads have had to build a small CORS-adding proxy in front of Hetzner's presigned URLs to make this work. **This is disqualifying only for the direct-upload path**, not for Hetzner generally — see "Upload path" below. |

All three satisfy the inherited constraints (EU/EEA region, S3-API compatibility, private
objects/presigned-URL access) and the owner's jurisdiction ruling. The differentiator the owner's
own comment identifies is CORS support for direct browser uploads, addressed next.

**Render fit, generally:** none of the three has a native Render marketplace integration today
(Render's own object storage offering is in alpha and is not itself a general-purpose S3 target
usable by this project yet). All three are reachable from a Render web service the same way —
S3-compatible SDK, credentials as environment variables — so this does not differentiate them from
each other; it only rules out "use Render's own storage" as a present-day option.

**Termux/phone fit, generally:** all three candidates' setup paths are a web dashboard plus an
API-key/access-key pair, workable from a phone browser without local heavy tooling. Hetzner's
absence of a CORS-configuration UI (AWS CLI only, per the table above) is the one point where a
phone-only workflow is more friction than the other two, if the direct-upload path is chosen.

### Upload path

Not settled here — this is the specific question the owner's comment identifies as blocking
provider selection. Recorded as two options with their implications, per the owner's instruction to
either settle it or state explicitly that it is deferred and what each path implies.

**Option A — direct browser-to-object-store, via presigned PUT.** The Next.js server issues a
short-lived presigned PUT URL (after the usual RLS-scoped authorization check) and returns it to
the browser, which uploads the file bytes straight to the object store; the server never sees the
file body.

- _CORS:_ the object store's bucket must serve correct CORS response headers for the browser's
  `PUT` to succeed. Scaleway: supported and documented directly. OVHcloud: supported, but not
  through the generic `aws s3api put-bucket-cors` command — OVHcloud's own CORS-configuration path
  must be used. Hetzner: does not work without extra effort — no CORS-configuration UI, and
  presigned PUTs from a browser are blocked by missing CORS headers even after CLI-based CORS rules
  are applied, per the owner's own verification and the independent reports in the table above; a
  small CORS-adding proxy in front of the presigned URL is the documented workaround.
- _Server memory / request limits:_ effectively zero — the file's bytes never pass through the
  Next.js process, so this path scales independently of Render's plan RAM (e.g. the Starter plan's
  512 MB, Standard's 2 GB — plan RAM figures from Render's public pricing, not independently
  re-verified against Render's own docs in this pass) and independently of any Next.js API route
  body-size configuration.
- _Which providers remain viable:_ Scaleway and OVHcloud, without extra work. Hetzner, only with an
  added CORS-proxy component the other two don't need.

**Option B — browser-to-Next.js-server-to-object-store, proxied.** The browser sends the file to a
Next.js API route as a normal multipart upload; the server then does the `PutObject` call to the
object store itself, using long-lived server-side credentials (never exposed to the browser).

- _CORS:_ irrelevant — the browser only ever talks to our own origin, never to the object store
  directly, so none of the three candidates' CORS behavior matters under this path. Hetzner's CORS
  gap stops being disqualifying.
- _Server memory / request limits:_ becomes the real cost. The standard Next.js Node.js API-route
  runtime buffers the request body before handler code runs, so each concurrent upload holds its
  full byte size in the server process's memory for the duration of the request — on Render's
  Starter plan (512 MB RAM, per Render's public pricing page), a handful of concurrent multi-
  megabyte clinic-document uploads is a real ceiling worth sizing against, not a theoretical one;
  Render's exact request-timeout figure per plan was not confirmed in this pass — **unverified**.
  This cost is unrelated to which of the three providers is chosen — it is a property of proxying
  through Next.js at all, not of any vendor.
- _Which providers remain viable:_ all three, including Hetzner without a proxy workaround of its
  own (the Next.js server _is_ the proxy, incidentally solving Hetzner's CORS gap as a side effect).

**Net effect on provider selection:** Option A rules out Hetzner without added engineering (a CORS
proxy). Option B removes CORS as a factor entirely for all three, at the cost of routing file bytes
through the Render web service's own memory and request-handling budget. Neither option is selected
here — this ADR states the implication of each rather than choosing, per the owner's instruction.

### Bucket boundary

One bucket for all clinics with `storage_key = clinic_id/document_id`-style key prefixing, versus
one bucket per clinic.

`06-knowledge-document-storage.md` already establishes that tenant isolation for file access comes
from the RLS-scoped row lookup — a request for another clinic's document ID never resolves to a
valid `storage_key` in the first place — not from bucket-level ACLs or any S3-side permission
boundary. Under that design, **a per-clinic bucket adds no isolation guarantee that the row lookup
doesn't already provide**: the application never constructs a raw `storage_key` from unvalidated
input and hands it to the object store without going through that lookup first, so there is no code
path where bucket-level separation would catch something the row lookup missed. What per-clinic
buckets add instead is operational cost that scales with clinic count: one bucket (and one set of
lifecycle/CORS/encryption settings) to create, configure, and keep consistent per clinic, versus
one bucket configured once. At the "one demo clinic, no customers" scale this ADR's research was
scoped against, that cost is invisible; it becomes a real provisioning-automation problem the moment
clinic onboarding needs to create infrastructure per signup rather than just database rows. A single
bucket with `clinic_id`-prefixed keys is the reading consistent with how every other tenant-scoped
resource in this platform works (ADR-0003, ADR-0006, ADR-0008 all isolate by a `clinic_id` column
under one shared schema, not by one physical resource per tenant) — but this ADR does not select it;
it states the trade-off for the owner as asked.

### MinIO stand-in — recommendation

The owner's own instinct, stated in the PR comment, is that a local S3-API stand-in (MinIO or
equivalent) is safe "precisely because it does not invent a model — it implements the documented one
against the same API." **This assessment agrees with that instinct and recommends it**, with the
reasoning restated here rather than left implicit: application code written against the S3 API
(`PutObject`, presigned URLs, bucket/key addressing) is identical whether the endpoint behind it is
MinIO running in a container or one of Scaleway/OVHcloud/Hetzner's real endpoints — switching later
is a configuration change (endpoint URL, credentials, bucket name), not a rewrite of any call site.
That is a different and narrower risk than the mistake [PR #66](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/66)
and this ADR's Context section are both reacting to, which was building against a storage model that
had no real specification behind it at all (PR #65's rejected title/content/edit-in-place model). A
recommendation, not a decision this ADR makes: Slice 1 development may use an S3-API-compatible
local stand-in (e.g. MinIO, per the documented Render deployment target found in this research)
while this ADR remains open, on the condition that it is never mistaken for a production-adjacent
environment — it carries no EU-residency guarantee of its own and is not a substitute for resolving
this ADR before any real clinic's documents are stored anywhere.

## Consequences

Deferred to the owner ruling. Recording here only what is already fixed regardless of which
candidate is chosen: retrieval and download must continue to go through the RLS-scoped row lookup
`06-knowledge-document-storage.md` already specifies (no candidate above changes that), and no
credential or configuration decision made under item 7 above may introduce a path to an object or
bucket that bypasses that lookup. Whichever upload path is chosen (see "Upload path" above) is
itself a consequence worth restating here: Option A trades CORS configuration work (and, for
Hetzner, a proxy component) for keeping file bytes off the Render web service entirely; Option B
trades that CORS work away in exchange for the Render service's own memory and request-handling
budget becoming a scaling factor for uploads.

## Alternatives considered

The candidate comparison tables above **are** the alternatives-considered analysis for this ADR —
six candidates originally researched, three (AWS S3, Cloudflare R2, Backblaze B2) set aside on the
owner's jurisdiction ruling without failing a technical constraint, three (Scaleway, OVHcloud,
Hetzner) compared in depth against the remaining open questions — with no single provider selected.
This section is included for template consistency only; see "Considered and set aside" and
"Candidate comparison — Scaleway, OVHcloud, Hetzner" above rather than duplicating them here.
