# 0001 — Web stack

## Status

Accepted

## Context

Phase 0 needs to lock in a web stack before any feature work starts, so that
later phases build on stable conventions instead of migrating mid-project.

## Decision

- **Next.js 16, App Router.** Route groups (`(marketing)`, `(app)`) let the
  public site and the future signed-in product share one repo with separate
  root layouts, without URL segments leaking the grouping. Route handlers
  (`src/app/api/**/route.ts`) cover the health check today and will host
  future API endpoints without a separate server.
- **TypeScript 5.7, strict mode, `noUncheckedIndexedAccess`.** Strict mode is
  non-negotiable for a codebase that will handle patient data. The
  `noUncheckedIndexedAccess` flag additionally forces every array/index
  access to be treated as possibly `undefined`, which matters once code is
  indexing into schedules, message lists, and search results.
- **Tailwind CSS v4, no `tailwind.config.*`.** v4 moved configuration into
  CSS via `@theme` in `globals.css`. Keeping design tokens as CSS custom
  properties next to the stylesheet that uses them avoids a second
  configuration surface and matches the current framework default.
- **Node 22** (pinned via `.nvmrc`), the active LTS at the time of this
  decision.
- **ESLint flat config via `eslint-config-next`.** `eslint-config-next@16`
  ships its recommended rules as a flat config array (its default export),
  so `eslint.config.mjs` spreads that array directly — no
  `FlatCompat`/`@eslint/eslintrc` compatibility shim is needed or used.
- **Prettier**, with `singleQuote: true` and `printWidth: 100`, run
  independently of ESLint (`format` / `format:check` scripts) so formatting
  and linting stay two separate, single-purpose checks.

## Consequences

- `next lint` is removed in Next.js 16; the `lint` script runs `eslint .`
  directly instead.
- `next build` normalizes `tsconfig.json` (sets `"jsx": "react-jsx"` and
  appends generated type paths to `include`). The committed `tsconfig.json`
  reflects that post-build state so `format:check` doesn't flag a file only
  `next build` touches.
- No font is loaded via `next/font`; fonts are loaded via `<link>` tags in
  the root layout so the production build has no network dependency at
  build time (see `docs/02-architecture.md`).
