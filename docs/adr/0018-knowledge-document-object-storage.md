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
[ADR-0008](./0008-embeddings-storage.md) (Accepted) resolved where the *derived* retrieval
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

## Decision

**Owner ruling required.** This record sets out the candidates and their trade-offs against the
inherited constraints; it does not select one. Status stays `Proposed` until Ahmed rules, recorded
as a human comment on the pull request, per charter §10 and the pattern
[ADR-0017](./0017-clinic-working-hours-dst-transitions.md) followed.

### What this ADR must decide (owner's call)

1. **Provider or service.**
2. **EU/EEA region.**
3. **Bucket and storage boundary** — one bucket for all clinics with key prefixing (e.g.
   `storage_key = clinic_id/document_id`), or a bucket per clinic — and what that means for tenant
   isolation in practice, given that `06-knowledge-document-storage.md` already routes all access
   through the RLS-scoped row lookup rather than through bucket-level ACLs.
4. **Encryption and retention assumptions** — only those genuinely required. No retention policy is
   invented here: [ADR-0009](./0009-data-residency.md) item 6 already established that this
   platform enforces no default clinical retention period and never auto-deletes clinical records
   absent explicit tenant configuration. The only retention-adjacent fact this ADR need record is
   whatever the chosen vendor does or does not require configuring by default (e.g. default
   lifecycle rules that must be explicitly disabled to avoid contradicting ADR-0009 item 6).
5. **The presigned-URL mechanism**, inheriting the private-object requirement above.
6. **How the application obtains storage credentials and configuration** — e.g. long-lived static
   keys in environment variables vs. some other credential-issuance path, and how that interacts
   with Render as the deployment target.

### Candidate comparison

Researched against: EU/EEA region availability, S3-API compatibility, presigned-URL support, DPA
availability, pricing shape at current scale (one demo clinic, no paying customers), and
operational fit with Render (which offers no object storage of its own as a first-party product)
and with a phone/Termux-only workflow (dashboard/CLI setup, no local heavy tooling required).

| Candidate | EU/EEA region | S3-API compatible | Presigned URLs | DPA | Pricing shape (demo scale) | Operational fit (Render + Termux) |
| --- | --- | --- | --- | --- | --- | --- |
| **AWS S3** (`eu-central-1` Frankfurt or `eu-west-1` Ireland) | Yes — both are EU regions. | Yes — reference implementation of the API every other candidate targets. | Yes, native (`GetObject`/`PutObject` presigned URLs; AWS's own docs describe the pattern). | Yes — AWS DPA is incorporated into AWS Service Terms and applies automatically wherever AWS processes customer data. | Storage ≈ $0.023–0.025/GB-month; egress to the internet ≈ $0.09/GB after a small free tier; PUT/GET request costs on top. At demo-clinic scale (a handful of documents) this is cents/month, but egress pricing is the least favorable of the candidates researched if download volume ever grows. | No native Render integration (feature-requested, not shipped); setup is standard AWS console/CLI — workable from a phone browser, but AWS's console and IAM policy surface is the most complex of any candidate to drive one-handed. |
| **Cloudflare R2** | Yes — bucket-level "EU jurisdiction" setting pins the bucket to EU member-state data centers with no transparent replication outside the EU. | Yes — S3-compatible API; Cloudflare's own docs recommend using the jurisdiction setting together with the S3 API. | Yes, documented directly (`developers.cloudflare.com/r2/api/s3/presigned-urls/`). | Yes — Cloudflare's DPA (EU SCCs, Module Two/Three depending on controller/processor role) covers R2. | $0.015/GB-month storage, **zero egress fees**, Class A (write/list) ops $4.50/million, Class B (read) ops $0.36/million, with a free tier (10 GB storage, 1M Class A, 10M Class B ops/month) that likely covers this project's current scale entirely. | No native Render integration; dashboard-based setup, S3-compatible SDK works unchanged. Best egress economics of the group if patient-facing document downloads ever scale. One honest caveat found in research: Cloudflare is a US-headquartered company, so the EU-jurisdiction setting keeps *data* in the EU but does not remove the vendor's own US-nexus CLOUD Act exposure — the same caveat that applies to AWS and Backblaze below, not unique to R2. |
| **Scaleway Object Storage** | Yes — Paris (FR-PAR), Amsterdam (NL-AMS), Warsaw (PL-WAW); Scaleway is a French/EU company. | Yes — implements the S3 API for common operations including presigned URLs; boto3/aws-cli/rclone work with only an endpoint change. | Yes. | DPA available through the dashboard. | ≈ €0.0105/GB-month storage (roughly half AWS's rate), intra-region transfer free, inter-region and out-of-EU egress charged separately (≈ €0.01/GB out-of-EU egress cited in research, unverified against Scaleway's own pricing page directly). | No native Render integration; standard dashboard/API-key setup. EU-headquartered vendor removes the US CLOUD Act question entirely, which none of the US-headquartered candidates can offer. |
| **OVHcloud Object Storage** | Yes — datacenters in France, Germany, Poland; OVHcloud is a French/EU company. | Yes — S3-compatible API described in OVHcloud's own compatibility guide. | Supported as part of the S3-compatible feature set (not independently verified against OVHcloud's own presigned-URL docs in this research pass — **unverified**). | GDPR-compliance stated by the vendor; specific DPA document terms not independently confirmed in this research pass — **unverified**. | Storage priced per GiB/month, billed hourly; comparable order of magnitude to Scaleway/Hetzner. Exact current-tier numbers not pinned down precisely enough to state a confident figure here — **partially unverified**. | No native Render integration; standard dashboard/API-key setup. EU-headquartered, same CLOUD Act advantage as Scaleway. |
| **Hetzner Object Storage** | Yes — Falkenstein (DE), Nuremberg (DE), Helsinki (FI); Hetzner is a German company. | Yes, with a caveat: one source in this research flagged that Hetzner Object Storage (GA since 2024, newer than the other candidates) has had edge-case incompatibilities with S3 presigned URLs under certain conditions — not confirmed first-hand, flagged here rather than smoothed over. | Documented as supported (pre-signed URLs, object locking, server-side encryption, versioning, expiry rules); see the compatibility caveat above. | Vendor states GDPR-compliant handling as a German data-center operator; a named, downloadable DPA document was not independently confirmed in this research pass — **unverified**. | Cheapest bundled pricing found: ≈ €6.49/month includes 1 TB storage + 1 TB egress; extra storage ≈ €8.70/TB-month, extra egress ≈ €1/TB, S3 API calls and intra-`eu-central` traffic free. At true demo-clinic scale this is likely cheaper in absolute euros than any pay-per-GB candidate, though the bundle is sized for much higher usage than one demo clinic needs. | No native Render integration; standard dashboard/API-key setup. EU-headquartered. Newest product in this comparison — least operational track record of the group. |
| **Backblaze B2** | Yes — Amsterdam EU region available. | Yes — B2's S3-compatible API implements the most commonly used S3 actions; endpoint form `s3.<region>.backblazeb2.com`. | Presigned-URL support not directly confirmed against Backblaze's own S3-compatible API docs in this research pass — B2 supports time-limited download authorization tokens natively, and the S3-compatible layer is expected to support standard S3 presigned URLs, but this specific claim is **unverified** here. | Yes — Backblaze publishes a DPA specifically for EEA/EU residents (Backblaze company policy page). | Cheapest storage rate found: $0.005/GB-month, $0.01/GB download. Best raw storage price of any candidate. | No native Render integration; standard dashboard/API-key setup. Backblaze is US-headquartered (San Mateo, CA) — same CLOUD Act caveat as AWS and Cloudflare, despite the EU region keeping data resident in the EU. |

None of the six fail any inherited constraint outright. AWS, Cloudflare, and Backblaze are
US-headquartered companies offering EU-resident storage under GDPR DPAs, which satisfies
ADR-0009's residency and DPA requirements as written but leaves a US-nexus CLOUD Act
exposure that Scaleway, OVHcloud, and Hetzner — as EU-headquartered companies — do not carry. Since
ADR-0009 does not rule on vendor jurisdiction (only on where data is *processed*), this ADR treats
that distinction as an open question for the owner rather than a disqualifying constraint.

**Render fit, generally:** none of the six candidates has a native Render marketplace integration
today (Render's own object storage offering is in alpha and is not itself a general-purpose S3
target usable by this project yet). All six are reachable from a Render web service the same way —
S3-compatible SDK, credentials as environment variables — so this does not differentiate the
candidates from each other; it only rules out "use Render's own storage" as a present-day option.

**Termux/phone fit, generally:** every candidate's setup path is a web dashboard plus an
API-key/access-key pair, which works from a phone browser without needing local heavy tooling.
AWS's IAM console is the most involved of the six to drive one-handed; the other five have a
flatter, single-page bucket-and-key setup.

### What happens if the decision is deferred

Can a local or filesystem-backed implementation carry Slice 1 in development while the production
choice waits? Reasoning, not a ruling — the owner decides:

A filesystem-backed store *would* satisfy the S3-API-compatible constraint in letter only if it
sits behind an S3-compatible interface (e.g. a local MinIO container, which several of the Render
search results above surface as a documented Render deployment target) — application code would
then be written against the same S3 API regardless of which real backend eventually gets picked,
and switching backends later would be a configuration change, not a rewrite. That is a materially
different thing from writing a bespoke filesystem-path storage layer with no S3 API at all, which
is what [PR #66](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/66) and this ADR's
own Context section are reacting to: the earlier mistake this repo is explicitly trying not to
repeat was building against an *invented* model of what the storage boundary looks like, before a
real one was chosen. An S3-API-shaped local stand-in (MinIO or equivalent) does not invent that
boundary — it is the same boundary every candidate above already implements — so it reads as a
narrower risk than the invented-model mistake, but it is still a second thing to keep working (a
container to run, its own credentials, its own EU-residency question if it were ever mistaken for
production-adjacent) for as long as the real decision stays open. Whether that risk is acceptable
for Slice 1 development, and whether it should gate on this ADR being *Proposed* vs. *Accepted*, is
the owner's call.

## Consequences

Deferred to the owner ruling. Recording here only what is already fixed regardless of which
candidate is chosen: retrieval and download must continue to go through the RLS-scoped row lookup
`06-knowledge-document-storage.md` already specifies (no candidate above changes that), and no
credential or configuration decision made under item 6 above may introduce a path to an object or
bucket that bypasses that lookup.

## Alternatives considered

The candidate comparison table above **is** the alternatives-considered analysis for this ADR — six
candidates evaluated against six inherited constraints, with no selection made. This section is
included for template consistency only; see "Candidate comparison" above rather than duplicating it
here.
