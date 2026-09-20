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

**ADR-0020 (Accepted) supersedes ADR-0007's Arabic-language-quality framing for this codebase.**
[ADR-0020](./0020-multilingual-bidirectional-product-scope.md) fixes that the product is
multilingual and bidirectional by design, that EU/EEA is geographic and regulatory scope rather than
a language restriction, that clinics configure the languages relevant to their own patients, and
that Arabic remains an important supported language but is not the sole or exclusive criterion the
product is designed around (ADR-0020 Decision, items 1-4). ADR-0020's own Consequences section
anticipated exactly this effect on this ADR: "a future ruling on ADR-0019 is free to weigh
Arabic-language quality as one relevant evaluation factor among several EU and global languages,
rather than as the product's sole or defining language criterion." This ADR's language-coverage
constraint, in the Decision section below, is written against that decision. ADR-0007's own
Decision-section prose (quoted above) is Accepted and immutable and is not rewritten by this
correction — its "Arabic-language quality" wording stands as historical text describing a criterion
ADR-0020 has since superseded for evaluation purposes on this codebase, not as a still-current
instruction to this ADR.

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

**The mandatory constraints.** A candidate failing any one of the following is ineligible outright —
these are not weighed against each other or traded off against the secondary factors further below:

1. **EU/EEA data residency**, per [ADR-0009](./0009-data-residency.md), which explicitly covers AI
   inference calls (§3).
2. **Structured output sufficient for ADR-0011's E1** closed intent schema — an unreliable
   structured-output path is a compliance gap under ADR-0011, not merely an engineering
   inconvenience (see Context above).
3. **Our data not used to train or improve models, as a contractual term** — not a product page's
   description of default behavior, a contractual bar.
4. **The remaining ADR-0007 constraints**: a signed DPA covering Article 9 data, and no patient
   identifiers in prompts. The second of these is enforced by our own Stage 4 caller in
   [`05-ai-pipeline.md`](../technical/05-ai-pipeline.md), not by any vendor — identically true for
   every candidate, so it does not distinguish between them.
5. **Language coverage**, per [ADR-0020](./0020-multilingual-bidirectional-product-scope.md): the
   quality and coverage of the languages a clinic can configure and use. Per Context above, ADR-0020
   supersedes ADR-0007's inherited "Arabic-language output quality" framing for this codebase — the
   criterion is that a candidate must not constrain which languages the product can add, and must
   produce usable output in the languages a clinic configures, not that it must support a named list
   today. Arabic remains an important supported language under ADR-0020, not the sole one.

**How evidence is classified.** Per the owner's explicit ruling on this pass: a secondary source
summarizing a contract is not the contract. Every mandatory-constraint claim below carries one of two
tags:

- **VERIFIED** — an official vendor document stating the term, which this pass opened and read.
  Cited by name.
- **VERIFICATION REQUIRED** — the answer lives in Terms, a DPA, an enterprise agreement, or a direct
  vendor confirmation this pass did not obtain. Each item states precisely what must be verified,
  what document would constitute evidence, and what vendor or customer action would obtain it. Per
  the owner's ruling, this ADR does not attempt to close these by further web searching where the
  real answer lives only in a commercial agreement — that is the correct boundary between repository
  evidence and commercial evidence, not a research failure, and the owner (or the clinic-platform's
  contracting party) handles the second.

A vendor help-center article, a product-documentation page, or a third-party analysis is evidence of
what a vendor says about itself — it is not the contract, and does not by itself mark a mandatory
constraint VERIFIED, however official the page. This reclassifies evidence already gathered for this
ADR: earlier passes cited Help Center and product-documentation pages as if they settled a
constraint; below, none of those citations is treated as sufficient on its own for a mandatory,
contractual constraint — they are repository evidence, marked accordingly.

**The distinction this ADR maintains throughout:** a provider's contractual offer (a DPA it signs, a
no-training clause, a region it operates in) is not the same thing as this product's regulatory
compliance. Signing any candidate's DPA does not, by itself, make this product GDPR- or AI-Act-
compliant — ADR-0011's E1–E7 enforcement mechanisms are still required regardless of vendor, and
ADR-0011 §5's external regulatory adviser verification gate still applies before the first paying
clinic goes live. Everything under "Provider contractual/technical posture" below is what the
vendor offers; everything under "What stays provider-independent" is what this system must still do
itself, no matter which vendor is chosen.

### Repository evidence gathered to date (not sufficient, by itself, to mark any cell VERIFIED)

The table below is the starting evidence base — issue #18's shortlist, refreshed with public
vendor-documentation and help-center pages found in this pass. Per the classification rules above,
none of it is a DPA, Enterprise Agreement, or Terms document read directly, so none of it settles a
mandatory constraint on its own; the classification subsection that follows the table states plainly
what remains VERIFICATION REQUIRED and why.

| Constraint                        | Mistral La Plateforme                                                                                                                                                                                                      | AWS Bedrock                                                                                                                                                                                     | Azure OpenAI                                                                                                                                                                    | Google Vertex AI                                                                                                                                                | OpenAI direct                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| EU-region inference endpoint      | EU by default (only EU-domiciled legal entity) — issue #18                                                                                                                                                                 | `eu.` inference profile pinned to `eu-central-1`; a Global profile silently breaks this — issue #18                                                                                             | EU Data Zone (Sweden/France Central); must not be a Global deployment — issue #18                                                                                               | `europe-west1` and other EU regions (Belgium, Netherlands, Finland, Warsaw) via region pinning [1]                                                              | `eu.api.openai.com`; requires per-project setup, cannot convert an existing project — issue #18, [2]                   |
| Signed DPA covering Art. 9 data   | DPA available via API; per issue #18's correction, no provider sells an Art.-9-specific tier — evaluate as "standard DPA + no special-category carve-out + documented Art. 32 measures" for every candidate, not literally | Standard AWS DPA; same correction applies                                                                                                                                                       | Microsoft Products and Services DPA covers Azure OpenAI [3]                                                                                                                     | Google Cloud DPA, auto-incorporated into commercial agreements, publicly available without a sales call [1]                                                     | Standard DPA; ZDR is a separate approval, not a DPA term — [2]                                                         |
| Contractual no-training           | Paid/Scale-tier customers opted out by default; **free "Experiment" tier trains on data by default and requires manual opt-out** [4]                                                                                       | AWS's general Bedrock terms state customer data is not used to train base models; this pass did not locate and read the specific contractual clause                                             | "Does not use customer prompts, completions, embeddings, uploaded files, or fine-tuning data to train, retrain, or improve OpenAI foundation models or Microsoft AI models" [3] | "Prompts/outputs are not used for model training by default" on Enterprise/Vertex AI products [1]                                                               | Standard API tier does not train on API data by contrast to consumer ChatGPT; no specific document opened in this pass |
| Structured output for E1          | JSON mode plus a JSON-Schema structured-output mode; function calling via a `tools` parameter — documented as available on La Plateforme, no specific reference doc cited                                                  | Tool use and JSON-schema outputs documented per-model; Batch mode does **not** support either (irrelevant to the synchronous pipeline in `05-ai-pipeline.md`) — no specific reference doc cited | Inherits OpenAI's structured-outputs and function-calling feature set; not re-verified region-by-region — no specific reference doc cited                                       | Function calling documented; structured-output (JSON-schema) support on `europe-west1` specifically not independently checked — no specific reference doc cited | Originates the structured-outputs/function-calling shape most other APIs mirror — no specific reference doc cited      |
| No patient identifiers in prompts | **Enforced by us, not the provider** — see "What stays provider-independent" below; true for every candidate                                                                                                               | same                                                                                                                                                                                            | same                                                                                                                                                                            | same                                                                                                                                                            | same                                                                                                                   |
| Language coverage                 | Not evaluated in this pass for any candidate — see classification below                                                                                                                                                    | same                                                                                                                                                                                            | same                                                                                                                                                                            | same                                                                                                                                                            | same                                                                                                                   |

Sources: [1] Google Cloud data-residency and DPA documentation; [2] OpenAI Help Center, "Data
residency for the OpenAI API"; [3] Microsoft Learn / Azure OpenAI data-privacy documentation;
[4] Mistral AI Help Center, "Can I opt out of my input or output data being used for training."
Sources [1]–[4] are the vendor's own published pages, opened and read in this pass — but per the
classification rules above, a documentation or help-center page is not the DPA/Terms/enterprise
agreement itself, so citing one here is repository evidence, not proof a mandatory constraint is
met.

### Classification: every mandatory constraint is VERIFICATION REQUIRED, for every candidate

**1. EU/EEA data residency.** Issue #18 is an internal shortlist, not a vendor document, and it says
so itself ("re-verify vendor pages before any contractual commitment; residency terms shifted
repeatedly across 2025-2026"). Even for Google Vertex AI and OpenAI direct, where this pass opened a
public vendor page ([1], [2]), that page describes an available deployment option, not a binding
commitment that our specific account's inference calls are pinned there. ADR-0009 §3 requires AI
inference calls processed in EU/EEA "exclusively" — a page describing an available region is not
proof the contracted deployment is pinned there and stays pinned there.
Classification, per candidate: **VERIFICATION REQUIRED.**

- What must be verified: that the specific inference endpoint/deployment configuration under our
  account is contractually and technically pinned to an EU/EEA region — not merely offered as an
  option — with no default or fallback to a non-EU region.
- What document would constitute evidence: the DPA's or enterprise agreement's data-processing-
  location/sub-processor annex, naming the specific region(s) our processing is contracted to use.
- What action would obtain it: during vendor onboarding/contracting, request and read that annex (or
  an equivalent written vendor confirmation) for the specific deployment tier being purchased.

**2. Structured output sufficient for E1.** No candidate's structured-output claim above cites a
specific, opened API reference document — the summaries describe general product documentation from
memory, not a document read and cited in this pass. **VERIFICATION REQUIRED**, for every candidate.
Unlike the other four constraints, this one is not commercial-agreement-locked:

- What must be verified: that the candidate's structured-output/tool-calling mode reliably produces
  output validating against a closed enum — E1's actual requirement — not merely "supports JSON,"
  specifically on the EU-region endpoint (a feature is sometimes region-gated separately from the
  base model).
- What document/evidence would constitute proof: the vendor's own API reference documentation for
  the EU endpoint, read directly, plus a small integration spike exercising the closed-enum shape
  against that endpoint.
- What action: closeable by engineering directly, ahead of or alongside the owner's commercial
  verification below — it does not need to wait on a vendor contract.

**3. Our data not used to train or improve models (contractual).** Every citation above ([1], [3],
[4]) is a vendor-published documentation or help-center page describing default behavior — not the
contract. Per the owner's ruling, a help-center article is not proof of a contractual term, however
officially the vendor published it; a page describing "default" behavior does not bind the vendor the
way a contractual no-training clause would, and a self-service tier's default can change. **VERIFICATION
REQUIRED**, for every candidate.

- What must be verified: that our specific account/contract tier carries a binding, explicit
  no-training-on-customer-data clause — not merely default behavior for an unspecified tier.
- What document would constitute evidence: the DPA or the vendor's Enterprise/Business Terms
  addendum containing that clause, read directly. For Mistral specifically, confirming our tier is
  Scale/paid (not the free "Experiment" tier, which trains by default per [4]) is itself part of the
  contract selection, not a page-read.
- What action: obtained during commercial negotiation — request the specific clause and confirm it
  in writing before any commitment. Not closeable by further web research.

**4. Remaining ADR-0007 constraints: DPA scope, and no patient identifiers.** For the DPA: the same
sources ([1], [3], [4]) plus issue #18's correction (no provider sells an Art.-9-specific DPA tier;
evaluate as "standard DPA + no special-category carve-out + documented Art. 32 measures") describe
that a DPA exists, not what its clauses actually say. **VERIFICATION REQUIRED**, for every candidate.

- What must be verified: the DPA's actual text for (a) absence of any clause excluding special-
  category/health-adjacent data from its protections, and (b) Article 32 technical/organizational
  security measures described concretely enough to assess.
- What document: the DPA itself — sometimes a self-service clickthrough (Mistral: "DPA available via
  API," per issue #18), sometimes gated behind a sales or compliance-team request for a smaller
  account.
- What action: request and read the DPA directly; for candidates offering self-service acceptance
  this may be closeable without a sales call, for others it may require account setup first.

For no patient identifiers in prompts: not a vendor-evidence question at all. Per ADR-0007's own
Consequences section, this is "an implementation requirement on the code that assembles
`AssistantProvider`'s input... not a mitigation the vendor is trusted to apply." Enforced identically
by our own Stage 4 caller for every candidate; no VERIFIED/VERIFICATION REQUIRED classification
applies since no vendor claim is being evaluated.

**5. Language coverage (ADR-0020).** Not evaluated in this pass for any candidate. **VERIFICATION
REQUIRED**, for every candidate.

- What must be verified: for each candidate, output quality and reliability across the range of
  languages the product intends to support per clinic — not one language — and confirmation the
  vendor does not itself constrain which languages can be added later.
- What document/evidence: hands-on evaluation output against representative clinic content in
  multiple configured languages — not a vendor claim.
- What action: vendor-specific evaluation work belonging to whichever ruling follows this ADR, as
  ADR-0007 already scoped this kind of evaluation out of the constraints ADR itself; closeable by
  engineering/product directly, not commercial-agreement-locked.

### Secondary, non-decisive factors (vendor-specific, per ADR-0007)

These do not gate eligibility the way the five constraints above do. Per the owner's framing, a detail
like an SLA percentage that is not itself an acceptance criterion can be recorded as unverified and
investigated later, rather than treated as selection-blocking.

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
  vendor is chosen — a design posture the `AssistantProvider` interface specified in
  [`05-ai-pipeline.md`](../technical/05-ai-pipeline.md) (documentation only; no code implements it
  yet) already accommodates without any change to that specification, and independent of which
  single provider this ADR's future ruling picks as first implementation.

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
- **Language coverage and quality**, per [ADR-0020](./0020-multilingual-bidirectional-product-scope.md)
  — superseding ADR-0007's inherited "Arabic-language output quality" framing for this codebase, per
  Context above and the mandatory-constraints list in the Decision section. Not evaluated in this
  pass; it requires hands-on model evaluation against real clinic content in the languages a clinic
  configures, which is vendor-specific work belonging to whichever ruling follows this ADR, not
  evidence this document could gather from public sources.
- **Sub-processor-register verification.** Issue #18 flagged Mistral's Google Cloud sub-processor
  expansion as a specific blocker to verify before any commitment; this ADR does not perform that
  verification and does not resolve it — it is carried forward as an open item in Consequences below.
- **Closing any of the VERIFICATION REQUIRED items in the Decision section.** This ADR classifies the
  evidence and states precisely what would close each item; it does not itself obtain the DPA,
  Enterprise Agreement, or Terms text needed to close the contractual ones, nor run the integration
  spike or language evaluation needed to close the technical ones.

## Consequences

**No candidate can be selected yet.** Every one of the five mandatory constraints is VERIFICATION
REQUIRED for every one of the five shortlisted candidates — no citation in this ADR is to an actual
DPA, Enterprise Agreement, or Terms document opened and read; the evidence gathered so far (issue
#18's shortlist, vendor help-center and product-documentation pages) is repository evidence, not
commercial evidence. Per the owner's explicit ruling, this is not recorded as an accepted residual
risk — an unverified hard constraint does not become acceptable by omission, and doing so would
reverse the decision logic a mandatory constraint exists to enforce.

The specific blocking verification items, per constraint, for every candidate:

1. **Residency** — the DPA/agreement's processing-location annex, naming the specific EU/EEA
   region our processing is contracted to use.
2. **Structured output (E1)** — primary API reference confirmation, plus an integration spike, that
   closed-enum output is reliable on the EU endpoint. Closeable by engineering directly.
3. **No-training** — the DPA/Enterprise Terms' explicit no-training-on-customer-data clause.
4. **DPA scope** — the DPA's own text confirming no special-category carve-out and documented
   Art. 32 measures.
5. **Language coverage** — hands-on evaluation output across the languages a clinic would configure.
   Closeable by engineering/product directly.

Items 1, 3, and 4 require the clinic-platform's contracting party to request and read the actual
DPA/Terms/enterprise agreement for each candidate under serious consideration — commercial evidence
this ADR cannot obtain by further web research, per the owner's explicit ruling that this is the
correct boundary between repository and commercial evidence. Items 2 and 5 are closeable by
engineering/product work directly, without waiting on a vendor contract.

Once those items are closed for at least one candidate that satisfies every mandatory constraint, a
future revision of this ADR's Decision section — or a superseding ADR — presents the candidates that
pass and requests the owner's selection among them, per Charter §10. Status stays `Proposed` until
then; this pass does not move it, and no application code, dependency, environment variable, or
migration follows from this ADR.

- The sub-processor-register item Issue #18 flagged for Mistral (its Google Cloud sub-processor's
  2025 expansion into US processing) is folded into blocking item 1 above for that candidate
  specifically — ADR-0009 §4 forbids any sub-processor outside the EEA, so this is part of what
  residency verification must confirm, not a separate open item.
- This ADR narrows the field to the five candidates issue #18 already shortlisted; it does not add or
  remove a candidate, and does not rule out that reading an actual DPA/Terms could disqualify one of
  the five once items 1, 3, and 4 are closed for it.

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
- **Recording the VERIFICATION REQUIRED items as accepted residual risk and presenting a leaning
  candidate anyway.** Considered and rejected per the owner's explicit ruling: a mandatory constraint
  that is unverified is not equivalent to a verified one carrying a known, accepted risk: recording it
  as accepted residual risk would reverse the decision logic the mandatory-constraint list exists to
  enforce. A candidate that has not been shown to meet a mandatory constraint is not presented as
  eligible, however strong its evidence looks on the secondary factors.
