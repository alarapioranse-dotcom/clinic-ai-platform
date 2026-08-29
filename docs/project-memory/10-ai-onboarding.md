# AI Onboarding

> This file holds pointers, never facts. If a statement here could go out of date, it belongs in
> its source document instead. Deleting this entire directory must lose no information.

## Purpose

The ordered reading list a new agent follows before doing any work on this project, and nothing
else. The order matches the source-of-truth hierarchy in
[`docs/operating-system/constitution.md`](../operating-system/constitution.md), §3. No fact about
the project appears below — only which document to read, in which order, and what question
reading it answers.

## Source of truth

The reading order itself (this file's content is the pointer list; each linked document remains
the source for its own content).

## Reading order

1. [`docs/governance/project-charter.md`](../governance/project-charter.md) — answers: what does
   this project value, and who has final authority over it?
2. [`docs/operating-system/constitution.md`](../operating-system/constitution.md) — answers: what
   may an AI agent do here, and in what order do sources of truth rank?
3. [`docs/adr/README.md`](../adr/README.md) and the Accepted records it indexes — answers: which
   decisions have already been made, and are therefore not open for re-litigation?
4. [`docs/03-roadmap.md`](../03-roadmap.md) — answers: what phase is this project in, and what
   comes next?
5. `docs/product/` and `docs/domain/` — answers: what is this product for, who uses it, and what
   are its concepts?
6. The repository itself (`src/`, CI configuration, package manifests) — answers: what has
   actually been built so far, as opposed to planned?
7. Notion — answers: what operational or planning context exists outside this repository?
8. AI Conversations — answers nothing on their own; per the Constitution, §3, they are never
   authoritative and are not a source to read for facts.

## After reading

TODO: point to wherever a new agent records that onboarding is complete, if that is tracked
anywhere — not a restated confirmation.
