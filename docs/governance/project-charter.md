# Project Charter

**Last amended: 2026-08-02**

This is the highest-level reference for Clinic AI Platform. Where anything else in this
repository conflicts with it, this charter governs until it is amended.

## 1. Vision

Every clinic answers its patients in seconds, at any hour, without hiring a
second receptionist.

This charter governs the EU/EEA product only. Under ADR-0009 the served market
for P2-P9 is EU/EEA clinics, with GDPR as the sole governing privacy regime. A
future Gulf-market product is intended as a separate system with its own charter,
its own residency regime and its own ADR record — not as an expansion of this
one. Nothing in this charter should be read as committing this codebase to serve
both markets.

## 2. Mission

Close the gap between a patient's message and a booked appointment, using that clinic's own
data — not a generic assistant's guess.

## 3. Product Principles

- The assistant answers administrative questions only — hours, pricing, availability, policy. It
  never answers clinical questions, even when asked directly.
- A clinic's own data is the only source of truth for an answer. If the data isn't there, the
  answer isn't given.
- Handing a conversation to a human is a successful outcome, not a fallback to be minimized.
- The product is Arabic-first and RTL-first by design, not an English product translated
  afterward.
- The out-of-scope list in [`docs/01-project-plan.md`](../01-project-plan.md) is a contract with
  the reader, not a preference that yields to a good idea.

## 4. Engineering Principles

- Routes compose, features compute.
- Dependencies flow one way: routes depend on features, features depend on `lib`, never the
  reverse.
- A feature never imports another feature's internals.
- `process.env` is read in exactly one file.
- Tooling stays boring; novelty is spent on the assistant, not the build system.
- Nothing is built before the phase that calls for it, per [`docs/03-roadmap.md`](../03-roadmap.md).

Practical how-to for all of the above lives in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## 5. Security Principles

- Secrets live only in the deployment environment — never in the repository, never in Notion.
- Tenant isolation is enforced at the data layer. A UI check that hides another clinic's data is
  not isolation.
- Access defaults to the least privilege that lets the work get done.
- A security finding outranks a feature on the schedule, unconditionally.

## 6. AI Principles

- Every agent operates against an explicit allow-list of permitted actions and may not act outside
  it.
- Agents propose; humans decide.
- No agent runs on a schedule or unattended on this project.
- An agent that cannot ground an answer in the clinic's own data hands off — it does not guess.
- Agent output is untrusted until a human reviews and approves it.

## 7. Privacy by Design Principles

- Patients are records in the system, not authenticated users of it.
- Data collection is limited to what booking an appointment requires.
- Data resides in the EU/EEA only, per ADR-0009. This covers primary Postgres,
  replicas and backups, embeddings, transcripts, audit and application logs,
  monitoring, and AI inference calls.
- Patient health data is treated as GDPR Article 9 special category data, not ordinary personal
  data.
- Retention and erasure are designed before the first clinic goes live, not retrofitted after.
- No real patient or clinic data appears in the repository, fixtures, issues, Notion, or any AI
  prompt.

## 8. Definition of Ready

| Gate                | Requirement                                                 |
| ------------------- | ----------------------------------------------------------- |
| Acceptance criteria | Written down before work starts.                            |
| Phase               | The task names the roadmap phase it belongs to.             |
| Tracking            | A GitHub Issue exists for it.                               |
| Dependent decisions | Any one-way-door decision it relies on is already Accepted. |

## 9. Definition of Done

| Gate                | Requirement                                                 |
| ------------------- | ----------------------------------------------------------- |
| Acceptance criteria | Met, not reinterpreted.                                     |
| Checks              | `format:check`, `lint`, `typecheck`, and `build` all green. |
| Review              | Approved by a human.                                        |
| Documentation       | Updated in the same pull request.                           |
| Data hygiene        | No secrets or personal data committed.                      |

## 10. ADR Policy

| Class             | Handling                                                |
| ----------------- | ------------------------------------------------------- |
| Reversible        | No record required.                                     |
| Costly to reverse | Record required before the code.                        |
| One-way door      | Record required before the code, plus Ahmed's approval. |

Records are never edited after acceptance; superseding a decision means writing a new record.
Template and process: [`docs/adr/README.md`](../adr/README.md).

## 11. Documentation Policy

The repository is the source of truth. Notion indexes and plans; where the two disagree, the
repository wins. Documentation is updated in the same pull request as the change it describes —
not after. A document that no longer matches the code is deleted or fixed; it is never left
standing as a trap for the next reader.

## 12. Branch Strategy

`main` is always deployable. Work happens on short-lived branches prefixed `feat/`, `fix/`,
`docs/`, `chore/`, or `refactor/`. Merges are squash-and-merge, so `main`'s history reads as one
commit per task. Commit messages follow Conventional Commits.

## 13. Pull Request Rules

- No merge without green CI.
- No merge without human approval.
- Disabling or weakening a check to reach green is a defect, not a fix.
- A pull request that mixes unrelated concerns is split before review, not after.
- The author of the code is not its sole reviewer.

## 14. Release Strategy

A merge to `main` deploys to production automatically. Every pull request gets its own preview
deployment. A phase ships only when its acceptance criteria in
[`docs/03-roadmap.md`](../03-roadmap.md) are met — not when time runs out. Rollback is a revert
commit; the ability to revert is a release requirement, not something to figure out during an
incident.

## 15. Roles & Responsibilities

| Role                     | Access      | Responsibility                                                                    |
| ------------------------ | ----------- | --------------------------------------------------------------------------------- |
| Ahmed (owner)            | Full        | Final decisions. The only actor who may merge or grant an agent a new permission. |
| Lead Engineer agent      | Read + docs | Specifications, code review, architecture.                                        |
| Implementer agent        | Write       | Writes code, runs checks, opens pull requests. Never merges.                      |
| CI                       | N/A         | Blocks the merge. Has no judgement and is not consulted.                          |
| Review / Research agents | None        | Output is notes and opinions, not commits.                                        |

## 16. Decision-Making Process

Reversible decisions are made by whoever is doing the work, noted in the pull request, and not
otherwise escalated. Costly and one-way-door decisions require an ADR and Ahmed's approval before
work starts, not after. Disagreement is resolved by writing down what evidence would change each
side's position — not by seniority. Silence on a proposal is not agreement with it.

## 17. Risk Management Principles

A risk that has no owner and no mitigation is not being managed — it's being ignored.

| Severity | Meaning             |
| -------- | ------------------- |
| S1       | Data loss or leak   |
| S2       | Blocked workflow    |
| S3       | Degraded experience |
| S4       | Cosmetic            |

An S1 stops all other work until resolved. The standing risks themselves are listed in
[`docs/01-project-plan.md`](../01-project-plan.md); this section governs how any risk is handled,
not which risks exist today.

## 18. Change Management Process

The roadmap is a contract, not a suggestion. Adding scope requires a roadmap pull request or an
ADR explaining the trade-off. Removing scope is recorded the same way. A "while we're in here"
change discovered during unrelated work is refused and raised as its own task instead.

## Amending this charter

This charter is amended only by pull request. Each amendment states what changed and why in the
pull request description. The date of last amendment is kept current at the top of this document.
