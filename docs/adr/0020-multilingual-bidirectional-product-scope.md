# 0020 — Multilingual, bidirectional product scope; EU/EEA is regulatory scope, not a language restriction

## Status

Proposed

## Date

2026-09-20

## Phase

P5 — Knowledge base and AI (see [`docs/03-roadmap.md`](../03-roadmap.md)). This decision is
intentionally accepted before [ADR-0019](./0019-ai-provider-selection.md) (Proposed, drafted in
[PR #75](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/75)), because ADR-0019's
provider-selection criteria depend on this product-scope and language decision. It also corrects a
charter-level Product Principle (charter §3) that governs the product as a whole, not P5 alone —
every phase shipped so far (P1-P4) was built under the assumption this ADR now reconciles.

## Impact

One-way door (see [charter §10](../governance/project-charter.md)). This is the same cost shape
[ADR-0016](./0016-clinic-working-hours-iana-timezone.md) recorded for interpreting clinic working
hours: an assumption that is plausible-looking, wrong for the product's actual users, invisible
until real data exists, and expensive to correct once encoded into schemas, prompts, and UI. Here
the assumption is which language(s) and text direction(s) the product is built around. `layout.tsx`
currently hardcodes `lang="ar" dir="rtl"`, the fonts are Arabic-optimized, and direction is
hardcoded in config and types — none of that is wrong for a first clinic, but if the underlying
architecture is not built to allow more languages and both text directions from the outset,
correcting it after real clinics with different language needs are onboarded means reworking
schemas, prompts, and UI simultaneously, across live tenant data, not a config change.

## Context

[Charter §3](../governance/project-charter.md) states, as a Product Principle: "The product is
Arabic-first and RTL-first by design, not an English product translated afterward." Nothing in the
charter's subsequent history reconciled that bullet with the market scoping decided afterward:
[ADR-0009](./0009-data-residency.md) (Accepted) and the charter's own [issue #19](https://github.com/alarapioranse-dotcom/clinic-ai-platform/issues/19)
amendment fixed the served market for P2-P9 as EU/EEA clinics, GDPR as the sole governing regime,
with a Gulf-market product deferred to a future, separate system with its own charter and residency
regime. "EU/EEA clinics" is a geographic and regulatory scope; it does not itself imply Arabic as
the product's primary or first language — the EU/EEA is home to many language communities, and nothing
in ADR-0009 ties residency to any particular language. Charter §3's bullet and ADR-0009's scoping
were never explicitly reconciled with each other; they have stood side by side, unaddressed, since
ADR-0009 was accepted.

The shipped code encodes charter §3's original assumption directly, and this ADR records that as
the current state it governs going forward without changing any of it: `layout.tsx` hardcodes
`lang="ar" dir="rtl"`, the fonts selected are Arabic-optimized, and text direction is hardcoded in
both configuration and type definitions rather than being a per-clinic or per-locale setting.

Why this is being decided now, rather than left as an unreconciled assumption: [PR #75](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/75)
drafts [ADR-0019](./0019-ai-provider-selection.md) (Proposed), the AI-provider-selection ADR that
[ADR-0007](./0007-ai-provider-constraints.md) named as still missing. ADR-0019's own evaluation
carries forward "Arabic-language output quality" as a deciding factor "named by ADR-0007 and by
[`docs/technical/07-open-questions.md`](../technical/07-open-questions.md)" — both of which, in
turn, trace that framing back to charter §3's Arabic-first bullet. A vendor-selection ruling made on
that inherited framing, before the product-scope question underneath it is settled, would be
selecting a provider against a language criterion this ADR determines is not the sole or exclusive
one. That is why ADR-0020 is being decided, and accepted for drafting, before ADR-0019 is ruled on.

## Decision

The owner and architect have ruled on this ADR's substance directly. Status stays `Proposed`; the
owner writes the Accepted line himself, per the charter's ADR Policy.

1. **The product is multilingual and bidirectional by design.** This is a scope decision, not an
   implementation directive — it does not, by itself, require any code, UI, or configuration change
   today.
2. **EU/EEA is the initial geographic and regulatory scope, not a language restriction.**
   [ADR-0009](./0009-data-residency.md)'s EU/EEA residency and GDPR-governance decision stands
   exactly as accepted; it constrains where data resides and which regime governs it, not which
   language the product speaks.
3. **Clinics can configure the languages relevant to their own patients and operations.** Language
   is a per-clinic configuration concern, not a single fixed product-wide choice.
4. **Arabic remains an important supported language**, but is not the sole or exclusive language
   criterion the product is designed around.
5. **The architecture must allow additional EU and global languages without redesigning the product
   around a single language or text direction.** This is an architectural constraint on future work
   (P5 and beyond), not a commitment to build multi-language support now — per the charter's hard
   rule that nothing gets built before the roadmap phase that calls for it.

Separately, as a product and design principle rather than a technical commitment: the product aims
for premium, highly intuitive, visually distinctive healthcare UX, with accessibility,
responsiveness, clarity, trust, and ease of use treated as foundational product qualities. This is a
principle to be weighed in future design and implementation decisions, not a per-screen obligation
that any existing or future screen must individually satisfy.

**ADR-0020 is intentionally accepted before ADR-0019**, because ADR-0019's provider-selection
criteria depend on this product-scope and language decision.

## What this ADR does not decide

- **It does not say the system supports all EU languages, or commit to any specific language set
  now.** That is explicitly not the decision here. Which languages get implemented is decided
  incrementally, by market and customer need, in whatever future ADR or roadmap phase that work
  belongs to.
- **It does not commit that every screen is now "impressive."** The UX principle recorded above is
  a principle to weigh, not a per-screen obligation.
- **It does not change any application code, `layout.tsx`, RTL or direction configuration, fonts, or
  any UI.** The current hardcoded `lang="ar" dir="rtl"` state is recorded above as the state this
  ADR governs going forward, not altered by it.
- **It does not select an AI provider.** [ADR-0019](./0019-ai-provider-selection.md) remains a
  separate, still-Proposed record; this ADR does not touch it.
- **It does not change which languages the system actually implements today.**

## Consequences

- Charter §3, [`CLAUDE.md`](../../CLAUDE.md), and [`docs/technical/07-open-questions.md`](../technical/07-open-questions.md)
  Q2 are corrected in the same pull request that drafts this ADR, to stop stating or relying on
  Arabic-first/RTL-first as a hard product principle or as the sole vendor-evaluation criterion.
  [ADR-0007](./0007-ai-provider-constraints.md) and [ADR-0016](./0016-clinic-working-hours-iana-timezone.md)
  each reference the Arab-world market or Arabic-language quality in their own Accepted, immutable
  text; neither is touched by this ADR or the corrections above — an imprecise citation in a frozen
  record is the accepted cost of never rewriting Accepted ADRs.
- Once this ADR is Accepted, a future ruling on [ADR-0019](./0019-ai-provider-selection.md) is free
  to weigh Arabic-language quality as one relevant evaluation factor among several EU and global
  languages, rather than as the product's sole or defining language criterion — but that reweighing
  is ADR-0019's own future work, not performed here.
- Future language- and direction-handling architecture (in P5's AI pipeline and any UI work after
  it) must be designed to accommodate more than one language and both text directions from the
  outset, rather than special-casing Arabic/RTL as the only supported configuration. This is a
  constraint future implementation work must satisfy; per the charter's hard rules, none of that
  implementation is started by this ADR.
- The three limitations already recorded in `CLAUDE.md` (the deferred authenticated production
  click-throughs, and the unrehearsed production-rebuild runbook) are unaffected — this ADR touches
  no production system, migration, or verification status.

## Alternatives considered

- **Leave charter §3 as written and treat EU/EEA scoping as implicitly compatible with an
  Arabic-first principle.** Rejected by the owner and architect's ruling: Arabic is one language
  among the many the EU/EEA's clinic population may need, and "first" contradicts a product meant to
  be configurable per clinic. The two statements were genuinely unreconciled, not merely awkwardly
  worded side by side.
- **Commit now to a specific language set, or to completing multilingual UI work.** Rejected: this
  ADR is explicit that which languages are implemented is incremental, market-driven work for a
  future phase — committing to a set now would violate the charter's hard rule that nothing gets
  built before the phase that calls for it, and would overstate what this ADR decides.
- **Correct `CLAUDE.md` and the charter's wording without an ADR.** Rejected: charter §3 is a
  Product Principle, and reversing "Arabic-first and RTL-first by design" is a one-way-door product
  and architecture decision under the charter's own hard rules — it requires an ADR and the owner's
  approval, not a documentation-only wording fix.
- **Fold this decision into ADR-0019 as a preamble.** Rejected: ADR-0019 is the AI-provider-selection
  record, already drafted and pending its own owner ruling in PR #75; folding a product-scope and
  language decision into it would conflate two separable one-way-door decisions and require touching
  ADR-0019 itself, which this task is explicitly scoped not to do.
