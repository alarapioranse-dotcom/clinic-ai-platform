# Architecture Decision Records

An ADR is required before the code for any decision that is costly to reverse or is a one-way
door (see [`docs/governance/project-charter.md`](../governance/project-charter.md), §10). Reversible
decisions don't need one.

## Index

| ID                                         | Title                    | Status   |
| ------------------------------------------ | ------------------------ | -------- |
| [0001](./0001-web-stack.md)                | Web stack                | Accepted |
| [0002](./0002-feature-slice-structure.md)  | Feature-slice structure  | Accepted |
| [0003](./0003-multi-tenancy-model.md)      | Multi-tenancy model      | Accepted |
| [0004](./0004-staff-role-model.md)         | Staff role model         | Accepted |
| [0005](./0005-patient-erasure-strategy.md) | Patient erasure strategy | Accepted |

## Template

```markdown
# NNNN — Title

## Status

Proposed | Accepted | Superseded by NNNN

## Date

YYYY-MM-DD

## Phase

Which roadmap phase (see `docs/03-roadmap.md`) this decision belongs to.

## Context

What problem forces this decision, and what constraints bound it.

## Decision

What was decided, stated plainly enough to act on.

## Consequences

What this makes easier, what it makes harder, and what it forecloses.

## Alternatives considered

What else was on the table, and why it lost.
```

Records are never edited after acceptance. A decision that changes is recorded as a new ADR; the
old record's Status line is updated to `Superseded by NNNN`, but its Context, Decision, and
Consequences are never rewritten — they stand as history.
