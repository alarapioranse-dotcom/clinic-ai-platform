# 0019 — AI provider selection

## Status

Proposed

## Date

2026-09-20

## Phase

P5 — Knowledge base and AI (see [`docs/03-roadmap.md`](../03-roadmap.md)), before the P5 work that
calls `AssistantProvider` begins.

## Impact

One-way door (see [charter §10](../governance/project-charter.md)). [ADR-0007](./0007-ai-provider-constraints.md)
already recorded why: Conversation and Message content is GDPR Article 9 Special Category Data by
default, so adopting a vendor is a data-processing relationship needing a DPA suitable for that
category, and unwinding it later (re-papering DPAs, migrating prompt/eval infrastructure,
re-validating output quality for live clinics) is expensive even though the `AssistantProvider`
interface itself makes swapping the _implementation_ technically straightforward. This ADR is the
vendor-selection ADR that ADR-0007 named as still missing and required before P2/P5 AI work begins.

**This ADR selects a dependency, not an abstraction.** The `AssistantProvider` interface in
[`docs/technical/05-ai-pipeline.md`](../technical/05-ai-pipeline.md) is already fixed and is not
reopened, redesigned, or extended here. Designing how a chosen provider's SDK is wired behind that
interface is later, separate implementation work, out of scope for this record.

## Context

[ADR-0007](./0007-ai-provider-constraints.md) (Accepted) fixed four constraints any AI provider
adopted in P2 must satisfy — quoted here exactly as written, since this ADR's job is to test
candidates against them:

> - **EU-region inference endpoint.** The model call itself, not only data storage, runs in a
>   region consistent with the residency assumption in
>   [`docs/technical/00-overview.md`](../technical/00-overview.md).
> - **A signed Data Processing Agreement covering Article 9 data.** Ordinary personal-data DPA
>   terms are insufficient — Conversation/Message content is GDPR Article 9 Special Category Data
>   by default ([`docs/domain/01-entities.md`](../domain/01-entities.md)), and the DPA must be
>   scoped to that category explicitly.
> - **Contractual no-training-on-customer-data.** The vendor must be contractually barred from
>   using clinic/patient conversation content to train or fine-tune models outside this product's
>   own use.
> - **No patient identifiers in prompts.** Whatever content the pipeline sends to the model, direct
>   patient identifiers (name, phone number, and similarly identifying fields) are excluded from
>   the prompt itself — a constraint on how `AssistantProvider`'s caller assembles its input,
>   enforceable independent of which vendor implements the interface.

ADR-0007 also fixed what this ADR is required to contain:

> Vendor selection itself is a separate ADR, written before P2, that cites this ADR and states how
> the selected vendor satisfies each of the four constraints above — not a checklist item folded
> into this one, since the evaluation (Arabic-language quality, cost per conversation against the
> standing risk noted in [`docs/01-project-plan.md`](../01-project-plan.md), and the specific DPA
> terms offered) is vendor-specific work this ADR does not do.

**ADR-0009's residency requirements**, as they bear on a provider: EU/EEA-only market
([ADR-0009](./0009-data-residency.md) §1); all personal data — explicitly including "AI inference
calls" — stored and processed exclusively in EU/EEA regions (§3); no sub-processor outside the EEA
may process personal data, and every sub-processor requires a signed DPA and a public
sub-processor-register entry (§4); the platform is processor, the clinic is controller (§5).
ADR-0009 §3's inclusion of "AI inference calls" in scope is what makes "EU-region inference
endpoint" a residency requirement, not merely an ADR-0007 preference — the two ADRs agree, and
ADR-0009's own Consequences section already anticipated this, naming as a direct effect: "Narrows
the ADR-0007 vendor shortlist to EU-endpoint providers."

**ADR-0011's E1–E7**, the enforcement mechanisms for the regulatory scope boundaries in that ADR,
bear directly on what reaches a model and what shape its output must take:

- **E1 — Closed intent schema.** "Model output MUST validate against a closed enum of intents...
  Any output failing validation is discarded and replaced by the escalation response." This is a
  structured-output requirement, not a prompting convention: an unreliable structured-output path
  is a compliance gap under ADR-0011, not merely an engineering inconvenience.
- **E2 — Verbatim-span check.** Quote responses must be exact-match spans of stored source
  documents — a constraint on the pipeline's verification step, not on the model call itself, but
  it depends on the model returning content the pipeline can locate a span for.
- **E3 — Pre-model input gate.** Symptom/emergency detection happens deterministically _before_ the
  model is invoked — provider-independent by construction.
- **E5 — CI boundary suite.** A red-team corpus must pass in CI regardless of provider.
- **E6/E7 — Change control and observability.** Provider-independent process and metrics
  requirements.

[`docs/technical/05-ai-pipeline.md`](../technical/05-ai-pipeline.md)'s `AssistantProvider.classifyAndRespond`
already returns a structured, closed-shape result (`outcome: 'answer' | 'clinical' | 'ungroundable'`
plus `content`/`citedDocumentIds`) — this is E1 given concrete form in the interface ADR-0007 and
this ADR both build on. A candidate's structured-output/tool-calling support is therefore load-
bearing for ADR-0011 compliance, not a nice-to-have evaluated in isolation.

**Existing candidate evidence in the repository:** [issue #18](https://github.com/alarapioranse-dotcom/clinic-ai-platform/issues/18)
("Restrict ADR-0007 vendor evaluation to EU-region endpoints"), closed 2026-08-31, carries exactly
one comment, from the owner, containing a shortlist. Quoted in full below because it is the
starting evidence base for this ADR, not paraphrased:

> ## Shortlist — EU-region inference endpoints
>
> Residency is a property of the endpoint, not the vendor. Same provider, different deployment
> type = different compliance outcome.
>
> | Provider              | EU path                                         | Note                                                  |
> | --------------------- | ----------------------------------------------- | ----------------------------------------------------- |
> | Mistral La Plateforme | EU by default                                   | Only EU-domiciled legal entity                        |
> | AWS Bedrock           | `eu.` inference profile, locked to eu-central-1 | Processing contract shifts to AWS                     |
> | Azure OpenAI          | Data Zone (EUR), Sweden/France Central          | Must not be a Global deployment                       |
> | Google Vertex AI      | europe-west1                                    | Same structure as Bedrock                             |
> | OpenAI direct         | eu.api.openai.com                               | Requires approval for ZDR / modified abuse monitoring |
>
> ## Blockers to verify before any commitment
>
> 1. **Mistral subprocessors.** Its Google Cloud subprocessor was expanded in Feb 2025 to include
>    US processing. ADR-0009 §4 forbids any subprocessor outside the EEA. Verify the current
>    subprocessor register before shortlisting Mistral as primary. Also: zero data retention is
>    Scale-plan only and stateless calls only.
> 2. **Bedrock cross-region inference.** Must be disabled or pinned to an EU geographic profile. A
>    Global profile silently breaks ADR-0009 §3.
> 3. **Embeddings are inference too.** ADR-0008 stores vectors in EU Postgres, but generating them
>    is an API call. It must use the same EU endpoint. Easiest condition to miss.
>
> ## Correction to ADR-0007's criterion
>
> "Signed DPA covering Article 9 data" is not literally verifiable — no provider sells an
> Article-9-specific DPA tier, and Art. 9 does not create distinct processor obligations. The
> lawful basis sits with the clinic as controller.
>
> Restate as: standard DPA + no carve-out excluding special-category data + documented Art. 32
> measures.
>
> ## Recommendation
>
> No vendor decision here — ADR-0007 defers that to a future P2 ADR, and this issue's deliverable
> is the shortlist only.
>
> For planning: Mistral first if its subprocessor register is clean, AWS Bedrock (eu-central-1) as
> the fallback. Simplest legal story vs. strongest operational story.
>
> All claims verified 2026-08-31. Re-verify vendor pages before any contractual commitment —
> residency terms shifted repeatedly across 2025-2026.

This ADR treats that comment as a starting shortlist and a correction to re-verify, not as a
decision already made — it explicitly disclaims making one, and its own "planning" language is a
lean, not a ruling, offered by the owner in the role of contributor rather than as an owner ruling
on this ADR itself.

**Whether any part of the repository already assumes a provider:** no. A repository-wide search for
vendor names (`openai`, `anthropic`, `claude`, `bedrock`, `vertex`, `gemini`, `mistral`, `cohere`)
turns up matches only in `CLAUDE.md`, `README.md`, `src/lib/env.ts`, `scripts/seed.ts`, and test
files — all incidental references to _Claude Code_, the tool this repository is developed with, or
to `CLAUDE.md` itself, never to an AI provider selected for the product. No dependency, environment
variable, migration, or interface implementation in the codebase names or assumes a vendor.

## Decision

**This ADR does not select a provider.** Per the owner's ruling on how this ADR is to be written —
matching how [ADR-0017](./0017-clinic-working-hours-dst-transitions.md) was written — the Decision
section here sets out evidence and trade-offs and requests an owner ruling, rather than choosing
among candidates. Status stays `Proposed`.

The acceptance criterion this ADR must satisfy, traceable to ADR-0007, is that whichever candidate
the owner selects satisfies all four ADR-0007 constraints with any exception or residual risk
recorded explicitly — not smoothed over. The candidate evidence below is organized against exactly
those four constraints, plus the secondary factors ADR-0007 named as vendor-specific evaluation
work (structured-output/tool-calling support, latency/reliability, pricing shape at current scale,
and exit difficulty).

**The distinction this ADR maintains throughout:** a provider's contractual offer (a DPA it signs, a
no-training clause, a region it operates in) is not the same thing as this product's regulatory
compliance. Signing any candidate's DPA does not, by itself, make this product GDPR- or AI-Act-
compliant — ADR-0011's E1–E7 enforcement mechanisms are still required regardless of vendor, and
ADR-0011 §5's external regulatory adviser verification gate still applies before the first paying
clinic goes live. Everything under "Provider contractual/technical posture" below is what the
vendor offers; everything under "What stays provider-independent" is what this system must still do
itself, no matter which vendor is chosen.

### Candidate comparison against ADR-0007's four constraints

| Constraint                        | Mistral La Plateforme                                                                                                                                                                                                      | AWS Bedrock                                                                                                                                                                                                      | Azure OpenAI                                                                                                                                                                    | Google Vertex AI                                                                                                                                                                         | OpenAI direct                                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EU-region inference endpoint      | EU by default (only EU-domiciled legal entity) — issue #18                                                                                                                                                                 | `eu.` inference profile pinned to `eu-central-1`; a Global profile silently breaks this — issue #18                                                                                                              | EU Data Zone (Sweden/France Central); must not be a Global deployment — issue #18                                                                                               | `europe-west1` and other EU regions (Belgium, Netherlands, Finland, Warsaw) via region pinning [1]                                                                                       | `eu.api.openai.com`; requires per-project setup, cannot convert an existing project — issue #18, [2]                                                        |
| Signed DPA covering Art. 9 data   | DPA available via API; per issue #18's correction, no provider sells an Art.-9-specific tier — evaluate as "standard DPA + no special-category carve-out + documented Art. 32 measures" for every candidate, not literally | Standard AWS DPA; same correction applies                                                                                                                                                                        | Microsoft Products and Services DPA covers Azure OpenAI [3]                                                                                                                     | Google Cloud DPA, auto-incorporated into commercial agreements, publicly available without a sales call [1]                                                                              | Standard DPA; ZDR is a separate approval, not a DPA term — [2]                                                                                              |
| Contractual no-training           | Paid/Scale-tier customers opted out by default; **free "Experiment" tier trains on data by default and requires manual opt-out** [4]                                                                                       | Not independently verified in this pass — AWS's general Bedrock terms state customer data is not used to train base models, but this ADR did not locate and read the specific contractual clause; **unverified** | "Does not use customer prompts, completions, embeddings, uploaded files, or fine-tuning data to train, retrain, or improve OpenAI foundation models or Microsoft AI models" [3] | "Prompts/outputs are not used for model training by default" on Enterprise/Vertex AI products [1]; **the exact contractual (not blog) source was not independently opened in this pass** | Standard API tier does not train on API data by contrast to consumer ChatGPT; **the specific contractual clause was not independently opened in this pass** |
| No patient identifiers in prompts | **Enforced by us, not the provider** — see "What stays provider-independent" below; true for every candidate                                                                                                               | same                                                                                                                                                                                                             | same                                                                                                                                                                            | same                                                                                                                                                                                     | same                                                                                                                                                        |

Sources: [1] Google Cloud data-residency and DPA documentation; [2] OpenAI Help Center, "Data
residency for the OpenAI API"; [3] Microsoft Learn / Azure OpenAI data-privacy documentation;
[4] Mistral AI Help Center, "Can I opt out of my input or output data being used for training."
Per this ADR's mandate, no claim above is stretched to fit a constraint it does not clearly meet;
where a source could not be independently opened and read (rather than summarized secondhand), that
is marked unverified rather than assumed.

### Secondary evaluation factors (vendor-specific, per ADR-0007)

**Structured output / tool-calling support** — bears directly on ADR-0011 E1 (closed intent
schema):

- **Mistral**: JSON mode (`response_format: {"type": "json_object"}`) plus a custom structured-
  output mode using JSON Schema; function calling via a `tools` parameter. Documented as available
  on La Plateforme.
- **AWS Bedrock**: tool use and structured (JSON-schema) outputs supported per-model (verified for
  Claude models served via Bedrock); tool definitions and arguments are billed as ordinary
  input/output tokens. Bedrock's Batch mode does **not** support tool calling or structured output —
  relevant only if a future batch-processing path were considered, not to the synchronous pipeline
  in `05-ai-pipeline.md`.
- **Azure OpenAI**: inherits OpenAI's structured-outputs and function-calling feature set; not
  independently re-verified region-by-region in this pass but no region-specific gap was found.
- **Google Vertex AI**: function calling documented; this pass did not independently verify
  structured-output (JSON-schema-constrained) support specifically on `europe-west1` — **unverified
  for that region**.
- **OpenAI direct**: originates the structured-outputs and function-calling feature set most other
  providers' APIs now mirror.

**Latency and reliability posture:**

- **Mistral**: no contractual latency SLA (true of every candidate below — "p95 latencies" providers
  publish are uncontracted estimates); a documented 99.5% uptime SLA on paid tiers; independent
  monitoring as of 2026-09-10 showed ~100ms p50 from Europe (Germany) and 100% observed uptime over
  the prior 30 days with one recorded incident that month.
  Source: independent LLM-uptime monitoring (llmlatency.dev, modeluptime.com), not a Mistral
  contractual document — treat the SLA percentage as contractual, the latency/uptime numbers as
  observational.
  A separate, higher-tier "Priority" offering with its own SLA/rate-limit terms exists; not
  evaluated here as it was not the subject of a focused pass.
- **AWS Bedrock**: covered by AWS's standard service-level commitments; specific Bedrock SLA
  percentage not independently pulled in this pass — **unverified**.
  Model-level performance (e.g., Claude on Bedrock) inherits the underlying model's characteristics
  plus AWS's own infrastructure.
- **Azure OpenAI**: "99.9% reliability SLA on both Pay-as-you-go and Provisioned" per Microsoft's
  own SLA documentation — a stronger contractual guarantee than OpenAI direct's, where a comparable
  99.9% SLA is reported as available only under enterprise contracts starting near $50K/year,
  meaning our current stage (one demo clinic, no customers) would likely fall back to OpenAI's
  standard (non-SLA) terms.
- **OpenAI direct**: no contractual SLA outside enterprise agreements, per the above; a publicly
  documented 2024 latency-spike incident (p95 ~50ms baseline, briefly 500ms+) illustrates that
  uptime percentage and latency are tracked separately and a provider can miss on one without
  breaching the other.
- **Google Vertex AI**: not independently pulled in this pass — **unverified**.

**Pricing shape at our current scale (one demo clinic, no customers):**

- All five candidates bill pay-as-you-go per token with no minimum spend commitment as the default
  tier, which fits a pre-revenue, single-demo-clinic stage — this held for every candidate this pass
  checked directly (Mistral, Azure OpenAI) and is standard practice for the others (Bedrock, Vertex
  AI, OpenAI direct), though not independently re-verified line-by-line for each.
- **OpenAI direct** is the one candidate where a _feature this ADR needs_ — EU data residency,
  and separately Zero Data Retention — sits behind an approval process for "eligible" customers, not
  automatic self-service enablement, and cannot be retrofitted onto an existing project (a new
  Europe-region project must be created from the start). This is a process cost, not a token-price
  cost, and it is worth naming because it could add lead time disproportionate to our current scale.
- **Azure OpenAI** and **AWS Bedrock** carry the general caveat, found in independent cost analyses,
  that actual spend commonly runs 15–40% above advertised token prices once deployment-type and
  routing choices are accounted for (Data Zone vs. Global; PTU vs. pay-as-you-go) — a configuration-
  discipline cost, not a scale-gated one.
- No candidate's standard tier requires a minimum multi-year commitment at our scale; enterprise SLA
  tiers (noted above for OpenAI direct) are the exception, and only for a feature, not baseline
  access.

**How hard each provider is to leave:**

- **OpenAI direct**'s request/response shape is the de facto API standard several other providers
  (including Azure OpenAI, which inherits it directly) mirror — migrating _to or from_ an
  OpenAI-shaped API is comparatively low-friction at the protocol level. The EU-residency project
  constraint above (cannot convert an existing project) is itself a migration cost specific to
  OpenAI direct.
- **Azure OpenAI** sits on the same request/response shape as OpenAI direct, so moving between the
  two is comparatively low-friction technically, though Azure-specific configuration (Data Zone
  deployment, content filters, Azure AD/IAM wiring) does not travel with it.
- **AWS Bedrock** and **Google Vertex AI** both front multiple model families (including, per public
  documentation, Anthropic and Mistral models) behind one platform API, so swapping the underlying
  _model_ without leaving the platform is comparatively easy; leaving the _platform_ itself carries
  the standard cloud-lock-in costs of IAM, networking, and billing integration built up around it.
- **Mistral** offers some open-weight models alongside its proprietary La Plateforme API, which is a
  structurally different exit path (self-hosting) not available in the same form from the other four
  candidates — though La Plateforme's own request shape is Mistral-specific, not OpenAI-compatible,
  so leaving _La Plateforme_ for another hosted API is not lower-friction than the others on that
  axis alone.
- General industry guidance surfaced in this pass recommends a model-agnostic gateway layer and a
  "two or more providers" posture specifically to keep switching costs down regardless of which
  vendor is chosen — a design posture available under the existing `AssistantProvider` interface
  without any change to it, and independent of which single provider this ADR's future ruling picks
  as first implementation.

## What stays provider-independent regardless of this ADR's outcome

- **No patient identifiers in prompts.** Per ADR-0007's own Consequences section, this is "an
  implementation requirement on the code that assembles `AssistantProvider`'s input... not a
  mitigation the vendor is trusted to apply." None of the five candidates evaluated here perform
  this stripping themselves; it is enforced by our own Stage 4 caller in
  [`docs/technical/05-ai-pipeline.md`](../technical/05-ai-pipeline.md), for every candidate alike.
- **ADR-0011's E1–E7 enforcement mechanisms** — the closed intent schema, verbatim-span check,
  pre-model input gate, CI boundary suite, change control, and observability — are all implemented
  in our own pipeline code, not delegated to any vendor's contractual promises.
- **The `AssistantProvider` interface itself**, fixed by [`docs/technical/05-ai-pipeline.md`](../technical/05-ai-pipeline.md),
  is unaffected by which candidate this ADR's ruling eventually selects — that is the interface's
  entire purpose and is not reopened here.
- **ADR-0011 §5's external regulatory-adviser verification gate** applies before the first paying
  clinic goes live, regardless of vendor.
- **The Article 9 DPA-language correction** from issue #18 — evaluate every candidate's DPA as
  "standard DPA + no special-category carve-out + documented Art. 32 measures," since no candidate
  sells an Article-9-specific DPA product — applies uniformly, not to one candidate over another.

## What this ADR explicitly does not decide

- **Which candidate is selected.** That is an owner ruling, not made here.
- **The `AssistantProvider` interface's shape or any code implementing it.** Fixed elsewhere, not
  reopened.
- **Retrieval, embeddings, chunking, or extraction** for the knowledge-base pipeline — governed by
  ADR-0008 and [`docs/technical/06-knowledge-document-storage.md`](../technical/06-knowledge-document-storage.md),
  untouched here.
- **Arabic-language output quality.** Named by ADR-0007 and by
  [`docs/technical/07-open-questions.md`](../technical/07-open-questions.md) as a deciding factor for
  the owner to weigh, but not evaluated in this pass — it requires hands-on model evaluation against
  real Arabic clinic content, which is vendor-specific work belonging to whichever ruling follows
  this ADR, not evidence this document could gather from public sources.
- **Sub-processor-register verification.** Issue #18 flagged Mistral's Google Cloud sub-processor
  expansion as a specific blocker to verify before any commitment; this ADR does not perform that
  verification and does not resolve it — it is carried forward as an open item below.
- **Final confirmation that "structured output" and "no-training" claims hold contractually** for
  every candidate — several rows above are marked unverified where this pass could not independently
  open and read the underlying contractual document rather than a secondary summary of it. Closing
  those gaps is required before any commitment, not before this ADR can be Proposed.

## Consequences

- Whichever candidate the owner selects still owes ADR-0007's exception-recording requirement: any
  residual risk (e.g., an unverified sub-processor claim, an SLA gap at current scale) must be
  written into the ruling, not smoothed over.
- This ADR narrows the field to the five candidates issue #18 already shortlisted, refreshed with
  the secondary-factor evidence above; it does not add or remove a candidate from that shortlist.
- The open verification items listed above (sub-processor register, several unverified DPA/SLA
  claims) are now explicit blockers a future ruling on this ADR must either close or explicitly
  accept as residual risk — they cannot be silently dropped.
- No application code, dependency, environment variable, or migration follows from this ADR. It
  remains Proposed until the owner rules; only that ruling — recorded as a human comment on this
  ADR's pull request, per charter §10 — can move Status to Accepted, and doing so is not part of
  this document.

## Alternatives considered

Per [ADR-0007](./0007-ai-provider-constraints.md)'s own framing, no candidate is weighed to a
conclusion here — the four candidates below (beyond the shortlist already fixed by issue #18) were
considered and set aside for the reasons stated, not ranked against one another as this ADR's
choice:

- **Adding candidates beyond issue #18's five.** Considered and rejected for this pass: the
  shortlist already reflects owner-directed EU-residency screening (issue #18's stated purpose), and
  widening it without a stated reason would dilute rather than sharpen the evidence this ADR is
  required to gather. A future ruling remains free to add a candidate if the owner wants one
  evaluated that issue #18 did not consider.
- **Deferring this ADR until every unverified item above is closed.** Considered and rejected: the
  task this ADR responds to was explicitly to produce the evidence-gathering record now, flagging
  unverified items rather than blocking on them, consistent with ADR-0007's own instruction that
  vendor-specific evaluation work happens in this separate ADR rather than being folded into
  ADR-0007 itself.
- **Selecting a provider in this document.** Considered and rejected per explicit instruction: this
  ADR requests an owner ruling rather than making the selection, the same pattern
  [ADR-0017](./0017-clinic-working-hours-dst-transitions.md) used for its own owner-ruling decision
  items.
