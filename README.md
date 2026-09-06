# Clinic AI Platform

A multi-tenant SaaS for medical clinics: patient replies, appointment booking, and a per-clinic
knowledge base. See `docs/` for the full plan.

## Status

- **P0 — Foundation:** Done
- **P1 — Multi-tenancy and data:** Done (2e0875c)
- **P2 — Authentication and authorization:** P2a staff auth done (6a8a95b); roles and permissions per ADR-0004 still to do
- **P3 — Conversations:** Planned
- **P4 — Appointments:** Planned
- **P5 — Knowledge base and AI:** Planned

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
    appointments/ knowledge-base/ conversations/   # README only
    patients/  # real: repository.ts (internal) + index.ts (public entry point)
  config/
    site.ts, navigation.ts
  lib/
    env.ts, utils.ts, db.ts   # db.ts: tenant-context propagation (ADR-0006)
  types/
    index.ts
db/
  migrations/   # plain numbered SQL files, applied by scripts/migrate.ts
scripts/
  migrate.ts, seed.ts, verify-isolation-meaningful.ts
tests/
  db/   # tenant-isolation and pooler-configuration guard tests (vitest)
```

## Scripts

| Script                                   | Description                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                            | Start the dev server.                                                                                                      |
| `npm run build`                          | Production build.                                                                                                          |
| `npm run start`                          | Start the production server (after `build`).                                                                               |
| `npm run lint`                           | Run ESLint (`eslint .`).                                                                                                   |
| `npm run format`                         | Format the repo with Prettier.                                                                                             |
| `npm run format:check`                   | Check formatting without writing.                                                                                          |
| `npm run typecheck`                      | Run `tsc --noEmit`.                                                                                                        |
| `npm run db:migrate`                     | Apply pending SQL migrations in `db/migrations/`.                                                                          |
| `npm run db:seed`                        | Deployment-validation seed — one demo clinic + one demo staff account, idempotent. See "Deployment validation seed" below. |
| `npm test`                               | Run the automated test suite (requires migrations already applied).                                                        |
| `npm run db:verify-isolation-meaningful` | One-time manual check (not CI) — see the script's own comment.                                                             |

## Database (P1 foundation)

Requires a local PostgreSQL 16+ instance. Any way of getting one works, e.g.:

```bash
docker run --name clinic-ai-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
docker exec clinic-ai-postgres psql -U postgres -c "CREATE DATABASE clinic_ai_platform;"
```

Then, with `DATABASE_URL`, `APP_DATABASE_URL`, and `APP_USER_PASSWORD` set in `.env.local` (see
below):

```bash
npm run db:migrate
npm test
```

**Tenant context mechanism** (ADR-0006): every read/write to a tenant-scoped table runs inside a
transaction that calls `SELECT set_config('app.current_clinic_id', <clinicId>, true)` before any
query — see `src/lib/db.ts`'s `withTenantContext`. This is the parameterized equivalent of
`SET LOCAL app.current_clinic_id`: transaction-scoped, never leaks onto a pooled connection handed
to a later request.

**Row Level Security is the actual isolation boundary, not application code** (charter §5). Every
tenant-scoped table has a `tenant_isolation` RLS policy keyed on that session variable, and denies
all rows when it's unset — application code never adds its own `WHERE clinic_id = ...` filter as a
substitute. The application connects as a least-privilege `app_user` role, never as the
table-owning role migrations run as (`db/migrations/0002_app_role.sql`) — RLS is not a meaningful
guarantee against a connection that owns the tables it protects.

## Deployment validation seed

`scripts/seed.ts` (`npm run db:seed`) creates exactly one demo clinic and one demo staff account,
so a deployment's staff sign-in -> `app_user` -> RLS path (P2-A) can be exercised end-to-end when
there is no other data yet. It is for deployment validation only — never a source of real clinic
or patient data (CLAUDE.md hard rule) — and it never touches patients, conversations,
appointments, or any other clinical data.

**Idempotent.** Every identifier (clinic id, staff id, staff email) is a fixed constant in the
script, not read from the environment — rerunning it converges the same two rows to the same
values instead of creating duplicates. It connects with `DATABASE_URL` (the owner/migration role),
exactly like `db:migrate` — never `APP_DATABASE_URL`.

**Refuses to run when `NEXT_PUBLIC_APP_ENV=production`** unless `SEED_FORCE=true` is set
explicitly.

Local/CI, after `db:migrate`:

```bash
npm run db:seed
```

Against a deployed environment (e.g. Render Free, which has no Shell/One-Off Jobs — run this from
your own machine against the database's **External** Database URL from the Render dashboard, not
the Internal one):

```bash
NEXT_PUBLIC_APP_URL="https://<your-render-app>.onrender.com" \
NEXT_PUBLIC_APP_ENV=production \
SEED_FORCE=true \
DATABASE_URL="<External Database URL from Render>" \
SEED_STAFF_PASSWORD="<a strong password you choose now, never committed>" \
npx tsx scripts/seed.ts
```

`SEED_STAFF_PASSWORD` is hashed with the same Argon2id parameters the running application uses
(`src/features/auth/password.ts`) before it ever touches the database — the plaintext value is
never stored, logged, or committed; choose it at the command line each time and use it to sign in
at `/login` as `demo-staff@example.test`.

## Environment variables

Read exclusively by `src/lib/env.ts`, which throws at startup if a required variable is missing
or invalid — see [`.env.example`](./.env.example) for documentation. For local development, copy
it to a gitignored `.env.local`:

```bash
cp .env.example .env.local
```

| Variable              | Required                         | Description                                                                                                                                  |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL` | Yes                              | Public base URL of the deployed app.                                                                                                         |
| `NEXT_PUBLIC_APP_ENV` | Yes                              | One of `development` \| `staging` \| `production`.                                                                                           |
| `DATABASE_URL`        | Only for `db:migrate`            | Owner/migration connection. Never used by the running app.                                                                                   |
| `APP_DATABASE_URL`    | Only for DB-backed code/tests    | Least-privilege runtime connection — see "Database" above.                                                                                   |
| `APP_USER_PASSWORD`   | Only for `db:migrate`            | Sets `app_user`'s password via a parameterized statement; never embedded in a migration file. Must match the password in `APP_DATABASE_URL`. |
| `SEED_STAFF_PASSWORD` | Only for `db:seed`               | Plaintext password for the seed's one demo staff account, hashed before storage — see "Deployment validation seed" above. Never committed.   |
| `SEED_FORCE`          | Only for `db:seed` in production | Set to exactly `true` to let `db:seed` run when `NEXT_PUBLIC_APP_ENV=production`; otherwise it refuses.                                      |

## Deployment

Set `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_APP_ENV` for the target environment. As of this PR, a
deployment that uses the `patients` feature also needs `DATABASE_URL` (to run migrations) and
`APP_DATABASE_URL` (for the app itself) pointed at an EU/EEA-region PostgreSQL instance per
ADR-0009 — no vendor is chosen by this repository (see the PR description for why "Supabase" is
not assumed as-is). Authentication, and therefore the rest of the signed-in app, is not yet
implemented (P2, not started).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for branch/commit conventions and how to run the CI
checks locally before pushing.
