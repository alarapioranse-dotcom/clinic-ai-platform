# Contributing

## Branching and commits

- Branch names: `<type>/<short-description>` (e.g. `feat/appointment-slots`,
  `fix/health-route-status`).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- Keep commits scoped to one logical change.

## Architecture rules

These two rules are enforced by review, not (yet) by lint, so hold them when
reading or writing a diff:

1. **Routes compose, features compute.** Files under `src/app/**` (pages,
   layouts, route handlers) only assemble components and call feature
   functions — they don't contain business logic. Logic that computes
   something lives in `src/features/<name>/`.
2. **A feature never imports another feature's internals.** Code in
   `src/features/appointments/**` cannot reach into
   `src/features/patients/**` (or any other feature) directly. If two
   features need to share behavior, that behavior belongs in `src/lib/` or
   the feature exposes a public entry point other features import instead of
   reaching into internals.
3. **`process.env` is read only in `src/lib/env.ts`.** Every other module
   that needs configuration imports the typed `env` object from there. This
   keeps required variables validated in one place and makes it possible to
   grep for every environment dependency the app has.

## Running the checks locally

Copy `.env.example` to `.env.local` first (gitignored, never committed) so `NEXT_PUBLIC_APP_URL`
and `NEXT_PUBLIC_APP_ENV` are set — `src/lib/env.ts` throws if they're missing:

```bash
cp .env.example .env.local
```

CI runs these checks; run them in this order before pushing:

```bash
npm run build        # also normalizes tsconfig.json — run this first
npm run format        # if format:check below fails, this fixes it
npm run format:check
npm run lint
npm run typecheck
npm run db:migrate    # requires a local Postgres — see README.md "Database"
npm test
```

The last two need `DATABASE_URL`, `APP_DATABASE_URL`, and `APP_USER_PASSWORD` set in `.env.local`
and a local PostgreSQL 16+ instance running — see
[`README.md`](./README.md#database-p1-foundation). RLS cannot be meaningfully tested against a
mocked database, per
[`docs/technical/02-tenant-isolation-testing.md`](./docs/technical/02-tenant-isolation-testing.md),
so these are real integration tests, not unit tests.

**`FORCE ROW LEVEL SECURITY` applies to the migration/owner role too**, not only `app_user` (see
`db/migrations/0004_patients.sql`). A future migration that backfills or bulk-updates data in
`patients` runs as that same owner role and will silently affect zero rows unless it sets
`app.current_clinic_id` per tenant (or explicitly runs as a role with `BYPASSRLS`) — it will not
fail loudly, so this is easy to miss without knowing to look for it.

## Stack

See `docs/adr/` for the reasoning behind the stack and folder structure
choices, and `README.md` for the practical rundown (scripts, env vars,
deployment).
