# 02 — Architecture

## Folder structure

```
src/
  app/
    (marketing)/        # public Arabic RTL landing page
      layout.tsx
      page.tsx
    (app)/               # signed-in shell, intentionally empty in Phase 0
      layout.tsx
      dashboard/
        page.tsx
    api/
      health/
        route.ts
    layout.tsx           # root layout: <html lang="ar" dir="rtl">, fonts, globals.css
    error.tsx
    not-found.tsx
    globals.css
    icon.svg
  components/
    ui/                  # generic primitives (Container, Badge, SectionHeading, ...)
    marketing/           # landing page sections
    app/                 # signed-in shell chrome
  features/
    appointments/        # README only — empty by design
    patients/
    knowledge-base/
    conversations/
  config/
    site.ts
    navigation.ts
  lib/
    env.ts               # the only file that reads process.env
    utils.ts
  types/
    index.ts             # shared, cross-cutting types only
```

## Route groups

`(marketing)` and `(app)` are Next.js route groups: the parentheses keep them
out of the URL path while letting each half of the product have its own root
layout. `(marketing)` is the public site; `(app)` is where the signed-in
product will live once authentication exists.

## Two rules

### Routes compose, features compute

Files under `src/app/**` — pages, layouts, route handlers — only assemble
components and call into feature logic. They hold no business logic
themselves. Anything that computes a result (matching a slot, validating a
booking, ranking a knowledge-base answer) belongs in `src/features/<name>/`,
not in a route file. This keeps route files readable as "what does this
screen show," while the actual behavior is testable in isolation inside its
feature.

### A feature never imports another feature's internals

`src/features/appointments/**` cannot reach into
`src/features/patients/**` (or vice versa, or any other feature pairing).
Each feature is a slice that owns its own logic; if two features need to
share behavior, that behavior moves to `src/lib/` or the feature exposes a
narrow public entry point that other features import instead of reaching
into internals. This keeps features independently understandable and
preps the codebase for splitting a feature out later without unwinding a web
of cross-imports.

## Configuration

`src/lib/env.ts` is the single place in the repo that reads `process.env`.
It validates every variable it reads and throws at module load if a required
one is missing or invalid, rather than silently falling back to a default.
Everything else — `src/config/site.ts` included — imports the typed `env`
object from there. This makes every environment dependency the app has
greppable from one file, and turns a misconfigured deployment into an
immediate, loud failure instead of a subtle runtime bug.

## Design tokens

Tailwind CSS v4 is configured with no `tailwind.config.*` file — tokens are
declared with `@theme` directly in `src/app/globals.css`, which is the
current Tailwind v4 convention and keeps design tokens next to the CSS that
consumes them. See [adr/0001-web-stack.md](./adr/0001-web-stack.md) for why.
