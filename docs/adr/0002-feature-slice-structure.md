# 0002 — Feature-slice structure

## Status

Accepted

## Context

The product will grow four distinct capabilities — appointments, patients,
knowledge base, conversations — that need to evolve somewhat independently
(different data models, different owners over time) while sharing one Next.js
app. Without an enforced boundary, it's easy for logic to sprawl into route
files or for features to quietly couple to each other's internals, making
either hard to change in isolation later.

## Decision

- `src/features/<name>/` is the only place a feature's business logic lives.
  Each slice will eventually expose a small public entry point (e.g. an
  `index.ts`) that other code imports; internals stay private to the slice.
- **Routes compose, features compute.** `src/app/**` files (pages, layouts,
  route handlers) only assemble components and call feature functions — no
  business logic in route files.
- **A feature never imports another feature's internals.** Cross-feature
  needs go through `src/lib/` (shared, feature-agnostic utilities) or through
  a feature's public entry point once one exists — never a direct import into
  another feature's private files.
- In Phase 0 each `src/features/<name>/` directory contains only a `README.md`
  stating its future purpose and repeating these rules — deliberately no
  code, since Phase 0 excludes the database and logic these features need.

## Consequences

- Reviewers can reject a PR that puts computation in a route file or that
  reaches across feature boundaries, without needing tooling to catch it
  (tooling enforcement, e.g. an ESLint import-boundary rule, is a candidate
  for a later phase once the slices have real code to constrain).
- Extracting a feature into its own package later is a matter of moving a
  directory, not untangling cross-imports.
