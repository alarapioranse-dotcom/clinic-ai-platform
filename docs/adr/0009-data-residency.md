# 0009 — Data residency and governing privacy regime

## Status

Accepted

## Date

2026-08-31

## Phase

P2 (blocker). Resolves issue #7.

## Context

Issue #7 blocks P2. ADR-0005 (patient erasure) was accepted with an explicit
assumption that GDPR is the sole governing privacy regime, and ADR-0003 recorded
that data residency remained open. The charter (§7) assumes EU residency, while
the stated long-term ambition is clinics worldwide. P2 introduces the first real
persistence layer, so residency can no longer stay open: hosting region, backup
region, AI inference region and sub-processor selection are all decided at that
point.

## Decision

1. **Market.** The MVP and phases P2-P9 target EU/EEA clinics only.
2. **Regime.** GDPR is the sole governing privacy regime. No design may assume a
   second regime without superseding this ADR.
3. **Residency.** All personal data is stored and processed exclusively in
   EU/EEA regions. Scope explicitly includes: primary Postgres, replicas and
   backups, pgvector embeddings, conversation transcripts, audit logs,
   application and error logs, monitoring, and AI inference calls.
4. **Sub-processors.** No sub-processor outside the EEA may process personal
   data. Every sub-processor requires a signed DPA and an entry in a public
   sub-processor register maintained in the repository.
5. **Roles.** The clinic is the controller; the platform is the processor. The
   platform ships a DPA template and Art. 30 records of processing.
6. **Retention.** Member-state medical retention law differs across the EU. The
   platform therefore enforces no default clinical retention period, exposes
   per-tenant retention configuration, and never auto-deletes clinical records
   absent explicit tenant configuration.
7. **Region-awareness.** Every tenant carries a `data_region` attribute, fixed
   to 'eu' for now. No code, migration or configuration may assume a single
   global database endpoint.
8. **Out of scope.** Gulf markets (Saudi PDPL, UAE) are deferred. Entering a
   second residency zone requires a new ADR covering region partitioning.

## Consequences

Easier:

- Unblocks P2; ADR-0005's GDPR assumption becomes a recorded decision.
- Narrows the ADR-0007 vendor shortlist to EU-endpoint providers, removing a
  large open variable before AI work begins.
- Article 9 special-category posture is inherited from a single regime rather
  than reconciled across two.

Harder:

- Excludes the Arab-world market from the MVP, despite the Arabic-first
  positioning being the intended moat.
- Restricts vendor and hosting choice, likely at higher cost and with fewer
  model options than US-region equivalents.
- Retention configurability adds tenant-level complexity a single-country launch
  would not need.

Forecloses:

- Any design assuming a single global database endpoint or a second privacy
  regime, without a superseding ADR.

Follow-ups (to open as issues):

- ADR-0010: audit-log erasure strategy (deferred out of ADR-0005).
- Sub-processor register + DPA template.
- Restrict ADR-0007 vendor evaluation to EU-region endpoints.
- Charter amendment: record the worldwide ambition as deferred, not dropped.

## Alternatives considered

- **Gulf-first residency.** Closer to the Arabic-first positioning, but PDPL
  localisation and mandatory retention obligations impose regulatory work before
  any customer validation exists.
- **Multi-region from day one.** Preserves every option, but multiplies
  infrastructure and operational cost for an unvalidated product.
- **Region-agnostic / US default.** Cheapest and fastest, but forecloses EU
  clinic sales and invalidates ADR-0005.
