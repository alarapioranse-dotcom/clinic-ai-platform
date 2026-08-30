# 0007 — AI provider constraints

## Status

Accepted — 2026-08-30. Approved by the owner in a comment on this pull request.

## Date

2026-08-30

## Phase

P5 — Knowledge base and AI (see [`docs/03-roadmap.md`](../03-roadmap.md)).

## Impact

One-way door (see [charter §10](../governance/project-charter.md)) for whichever vendor is
eventually selected against these constraints — see Context and Consequences. This ADR itself
does not select a vendor.

## Context

[`docs/technical/05-ai-pipeline.md`](../technical/05-ai-pipeline.md) defines the AI pipeline
behind a provider-agnostic `AssistantProvider` interface, per
[roadmap P5](../03-roadmap.md)'s requirement that "AI/LLM calls are isolated behind an interface
so the provider can change without touching call sites," and deliberately names no vendor.
[`docs/technical/07-open-questions.md`](../technical/07-open-questions.md) (Open Question 2)
named vendor selection as one-way-door: Conversation and Message content is GDPR Article 9 Special
Category Data by default
([`docs/domain/01-entities.md`](../domain/01-entities.md)), so sending it to a vendor is a
data-processing relationship needing a Data Processing Agreement suitable for special-category
data, and unwinding that relationship later is expensive even though the interface itself makes
swapping the implementation technically straightforward.

This ADR does not resolve [issue #7](https://github.com/alarapioranse-dotcom/clinic-ai-platform/issues/7)
(data residency / the governing privacy regime), open and blocking P2. The EU-region requirement
below is stated as consistent with the current assumption recorded in
[`docs/technical/00-overview.md`](../technical/00-overview.md) — "data resides in the EU, GDPR is
the sole governing regime" — not as a re-decision of it. If issue #7 changes that assumption, this
ADR's first constraint is exactly what would need revisiting, by a new ADR superseding this one.

## Decision

**No vendor is named at this phase.** The provider-agnostic `AssistantProvider` interface in
[`docs/technical/05-ai-pipeline.md`](../technical/05-ai-pipeline.md) stands as the integration
boundary; this ADR does not change it.

Any provider adopted in P2 must meet **all** of the following — not a subset, not "most":

- **EU-region inference endpoint.** The model call itself, not only data storage, runs in a region
  consistent with the residency assumption in
  [`docs/technical/00-overview.md`](../technical/00-overview.md).
- **A signed Data Processing Agreement covering Article 9 data.** Ordinary personal-data DPA terms
  are insufficient — Conversation/Message content is GDPR Article 9 Special Category Data by
  default ([`docs/domain/01-entities.md`](../domain/01-entities.md)), and the DPA must be scoped to
  that category explicitly.
- **Contractual no-training-on-customer-data.** The vendor must be contractually barred from using
  clinic/patient conversation content to train or fine-tune models outside this product's own use.
- **No patient identifiers in prompts.** Whatever content the pipeline sends to the model, direct
  patient identifiers (name, phone number, and similarly identifying fields) are excluded from the
  prompt itself — a constraint on how `AssistantProvider`'s caller assembles its input, enforceable
  independent of which vendor implements the interface.

Vendor selection itself is a separate ADR, written before P2, that cites this ADR and states how
the selected vendor satisfies each of the four constraints above — not a checklist item folded into
this one, since the evaluation (Arabic-language quality, cost per conversation against the standing
risk noted in [`docs/01-project-plan.md`](../01-project-plan.md), and the specific DPA terms
offered) is vendor-specific work this ADR does not do.

## Consequences

- Every call site behind `AssistantProvider` in
  [`docs/technical/05-ai-pipeline.md`](../technical/05-ai-pipeline.md) is unaffected by this ADR —
  no pipeline stage, prompt shape, or interface signature changes as a result of it.
- The future vendor-selection ADR is scoped by this one: a vendor failing any of the four
  constraints cannot be adopted without first superseding this ADR, not merely noting an exception
  in the selection ADR.
- Makes explicit that "no patient identifiers in prompts" is an implementation requirement on the
  code that assembles `AssistantProvider`'s input (Stage 4 in
  [`docs/technical/05-ai-pipeline.md`](../technical/05-ai-pipeline.md)), independent of vendor
  choice — this is not a mitigation the vendor is trusted to apply.
- Leaves [issue #7](https://github.com/alarapioranse-dotcom/clinic-ai-platform/issues/7) open and
  unresolved; the EU-region constraint above would need to be revisited by a superseding ADR if
  that issue changes the residency assumption.

## Alternatives considered

No candidate vendors are weighed against each other here — this ADR fixes the constraints a vendor
must satisfy, not a choice among named options. [`docs/technical/07-open-questions.md`](../technical/07-open-questions.md)'s
own framing of Open Question 2 already explains why a shortlist wasn't produced at the design-doc
stage: the deciding factors are evaluation criteria for Ahmed to weigh against specific vendors'
actual terms, not a technical tradeoff resolvable in the abstract. That evaluation belongs to the
vendor-selection ADR this one gates, not to this one.
