# Clinic AI Platform

A multi-tenant SaaS for medical clinics: patient replies, appointment booking, and a per-clinic
knowledge base. This repository is currently at **Phase 0 — foundation only**: no database, no
authentication, no AI, no payments. See `docs/` for the full plan.

## Status

| Phase | Name                             | Status     |
| ----- | -------------------------------- | ---------- |
| P0    | Foundation                       | ✅ Done    |
| P1    | Multi-tenancy and data           | ⏳ Planned |
| P2    | Authentication and authorization | ⏳ Planned |
| P3    | Conversations (patient replies)  | ⏳ Planned |
| P4    | Appointments                     | ⏳ Planned |
| P5    | Knowledge base and AI            | ⏳ Planned |

Details and acceptance criteria per phase: [`docs/03-roadmap.md`](./docs/03-roadmap.md).

## Stack and why

| Choice                                              | Why                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Next.js 16, App Router                              | Route groups let the public site and future signed-in app share one repo cleanly. |
| TypeScript 5.7, strict + `noUncheckedIndexedAccess` | Non-negotiable for a codebase that will handle patient data.                      |
| Tailwind CSS v4, `@theme`-only                      | Tokens live in `globals.css`; no separate `tailwind.config.*` to keep in sync.    |
| Node 22                                             | Active LTS at the time this project started, pinned via `.nvmrc`.                 |
| ESLint flat config (`eslint-config-next`)           | v16 ships its rules as a flat config array — no compatibility shim needed.        |
| Prettier                                            | Formatting kept as its own check, separate from lint rules.                       |

Full reasoning: [`docs/adr/0001-web-stack.md`](./docs/adr/0001-web-stack.md) and
[`docs/adr/0002-feature-slice-structure.md`](./docs/adr/0002-feature-slice-structure.md).

## Architecture rules

1. **Routes compose, features compute.** `src/app/**` only assembles components and calls feature
   logic; it holds no business logic itself.
2. **A feature never imports another feature's internals.** `src/features/<name>/**` is private to
   that feature except for its (future) public entry point.
3. **`process.env` is read only in `src/lib/env.ts`.** Everything else imports the typed `env`
   object from there.

Full write-up: [`docs/02-architecture.md`](./docs/02-architecture.md).

## Structure

```
src/
  app/
    (marketing)/       # public Arabic RTL landing page
    (app)/              # signed-in shell, intentionally empty in Phase 0
    api/health/         # health check route
    layout.tsx, error.tsx, not-found.tsx, globals.css, icon.svg
  components/
    ui/                 # generic primitives
    marketing/          # landing page sections
    app/                # signed-in shell chrome
  features/
    appointments/ patients/ knowledge-base/ conversations/   # README only
  config/
    site.ts, navigation.ts
  lib/
    env.ts, utils.ts
  types/
    index.ts
```

## Scripts

| Script                 | Description                                  |
| ---------------------- | -------------------------------------------- |
| `npm run dev`          | Start the dev server.                        |
| `npm run build`        | Production build.                            |
| `npm run start`        | Start the production server (after `build`). |
| `npm run lint`         | Run ESLint (`eslint .`).                     |
| `npm run format`       | Format the repo with Prettier.               |
| `npm run format:check` | Check formatting without writing.            |
| `npm run typecheck`    | Run `tsc --noEmit`.                          |

## Environment variables

Read exclusively by `src/lib/env.ts`, which throws at startup if a required variable is missing
or invalid — see [`.env.example`](./.env.example) for documentation and `.env` for the committed,
non-secret local/CI defaults.

| Variable              | Required | Description                                        |
| --------------------- | -------- | -------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL` | Yes      | Public base URL of the deployed app.               |
| `NEXT_PUBLIC_APP_ENV` | Yes      | One of `development` \| `staging` \| `production`. |

## Deployment

Phase 0 has no infrastructure of its own — it's a static-friendly Next.js app suited to a
Vercel-style deployment (or any Node 22 host that can run `npm run build` followed by
`npm run start`). Set `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_APP_ENV` for the target environment;
there are no other required variables until later phases add a database, auth, and AI provider
configuration.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for branch/commit conventions and how to run the CI
checks locally before pushing.
