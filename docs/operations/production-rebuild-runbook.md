# Production Rebuild Runbook

The production Postgres (`clinic-ai-db`, Render Free) expires 6 October 2026 — Render deletes a
Free Postgres instance that isn't upgraded to a paid plan. Per the Architect's ruling, the rebuild
procedure must live here as a committed, reviewable document, independent of whether the current
database is ultimately kept alive by upgrading it before that date.

**This is operational continuity, not data recovery.** No real patient or clinic data exists
anywhere in this project (CLAUDE.md hard rule) — the only things a rebuild needs to reproduce are
infrastructure and an empty, correctly-shaped schema, and both are already fully described by this
repository. Losing the current database loses nothing that isn't already in Git.

## A. Preconditions and scope

- **GitHub `main` is the source of truth.** Every value this runbook derives — schema, migration
  history, build/start commands, required environment variable names — is read from `main` at
  rebuild time, never from the expiring database or from memory of how it was set up originally.
- **No real data exists.** There is nothing to export, dump, or migrate out of `clinic-ai-db`
  before it disappears. If a step below ever looks like it's trying to preserve data, that's a
  sign something has gone wrong — stop and re-read CLAUDE.md's hard rule.
- **ADR-0009 constrains hosting to EU/EEA.** The replacement Postgres instance and web service
  must both stay in an EU/EEA region — this covers primary storage, backups, and any future
  read replica, per ADR-0009 §3. Frankfurt (EU Central), the region the original setup used, is
  the obvious continuation but not the only compliant choice; any EU/EEA region satisfies the ADR.
- **Production access is Termux + TLS `psql` only.** There is no laptop, no Docker, and no Render
  Shell in this workflow. Render Free (and, per the recorded config below, the current paid tier
  under consideration) has **no Shell** and **no One-Off Jobs** — every command in this document
  must be runnable as one of: a Render dashboard action, a `git`/`npm` command from Termux, or a
  TLS `psql`/`curl` session from Termux. Where a step genuinely depends on the Render dashboard,
  this document describes the outcome required, not exact button labels it cannot verify.
- **Secrets never go in Git.** Every password and connection string below is typed into the
  Render dashboard's environment variable editor, or exported in the current Termux shell session
  only. None of them belong in this file, a commit, an issue, or Notion.
- **Scope.** Infrastructure recreation, schema bootstrap, and verification only. No code change,
  no migration change, no ADR change, no database connection is made by writing this document —
  everything in this file is a set of instructions to run later, by a human, against real
  infrastructure.

## B. Recorded configuration of the environment being replaced

Captured from the Render dashboard on 11 September 2026. Kept here verbatim as the reference for
what the replacement must reproduce — not as claims this document has independently verified.

**Web service**

- Name: `clinic-ai-platform`
- Service ID: `srv-daejfqv40ujc73fg36s0`
- Plan: Free, Node runtime
- Region: Frankfurt (EU Central)
- URL: `https://clinic-ai-platform.onrender.com`
- Render subdomain: enabled. Custom domains: none.
- Source: `github.com/alarapioranse-dotcom/clinic-ai-platform`, branch `main`
- Root directory: none
- Build command: `npm ci && npm run build`
- Build filters: none
- Pre-Deploy Command: **locked — paid feature only.** This is precisely why `db:migrate` cannot
  run automatically on deploy and must be applied manually (Section D).
- Start command: `npm run start`
- Auto-deploy: On Commit
- Health check path: none configured
- PR previews: off
- Notifications: workspace default, failures only

**Database**

- Name: `clinic-ai-db`
- Service ID: `dpg-daekbjmq1p3s739nc4og-a`
- PostgreSQL 16, Free plan, Frankfurt (EU Central)
- Expires 6 October 2026
- Storage 1 GB, autoscaling disabled, no read replicas

**Environment variable names** (values deliberately not recorded here — see `src/lib/env.ts` and
Section C below for what each one is and where its value comes from)

- `APP_DATABASE_URL`
- `APP_USER_PASSWORD`
- `DATABASE_URL`
- `NEXT_PUBLIC_APP_ENV`
- `NEXT_PUBLIC_APP_URL`
- `NODE_VERSION`
- `PORT`
- `SEED_STAFF_PASSWORD`

**Workspace**

- Hobby plan, no card on file

**A rebuilt service will not have the same URL unless the Render subdomain happens to be free
again.** If the rebuilt web service ends up at a different URL than
`https://clinic-ai-platform.onrender.com`, `NEXT_PUBLIC_APP_URL` **must** be set to the new URL —
if it's left pointing at the old one, the application will generate wrong absolute links (emails,
redirects, metadata) silently, with no error at build or deploy time. Set it once the new
service's actual URL is known, and re-check it any time the service is recreated again later.

## C. Infrastructure recreation

1. **Create a new Postgres instance**, EU/EEA region (Frankfurt for continuity, or any other
   EU/EEA region — ADR-0009 §3), PostgreSQL 16, on a plan the workspace is prepared to keep
   funded past the Free tier's own expiry problem — the entire point of this rebuild is to not
   repeat the situation that triggered it. The recorded workspace above has no card on file;
   provisioning a paid database requires adding billing to the workspace first. From the Render
   dashboard, this is a database-creation action in the same region as before; describe the
   outcome to yourself as "a running PostgreSQL 16 instance in an EU/EEA region, with an
   Internal Database URL and an External Database URL available in its dashboard" rather than a
   fixed sequence of button labels, since the dashboard's exact layout isn't something this
   repository can verify.

   This new instance will have a new Service ID — it is not, and cannot be, `dpg-daekbjmq1p3s739nc4og-a`,
   which belongs to the instance that expired. Do not assume the new ID; read it back from the
   Render dashboard once created.

   **Only the External Database URL is reachable from Termux** — the Internal one is only
   resolvable from inside Render's own private network. Every command in this document that
   connects from Termux uses the External URL.

2. **Derive `DATABASE_URL` and `APP_DATABASE_URL`** — don't guess these; they come from the code:
   - Per `src/lib/env.ts` (`getDatabaseUrl`), **`DATABASE_URL` is the owner/migration
     connection** — the role that creates the `app_user` and `auth_bootstrap` roles, every table,
     every RLS policy, and every grant (`scripts/migrate.ts` connects with this and only this).
     Its value is the database's own **External Database URL**, using whatever admin role Render
     provisions by default for a new Postgres instance (Render creates one automatically; read its
     name and password back from the dashboard, or from the connection string it hands you — this
     repository does not choose or hardcode it).
   - Per `src/lib/env.ts` (`getAppDatabaseUrl`), **`APP_DATABASE_URL` is the least-privilege
     runtime connection** — the role the running application and every automated test actually
     use (`src/lib/db.ts`'s connection pool). This must authenticate as `app_user`, a role created
     by `db/migrations/0002_app_role.sql` with `NOSUPERUSER NOBYPASSRLS`.
   - **Why they must differ, not just "should":** every tenant-scoped table in this schema has
     `FORCE ROW LEVEL SECURITY` set (see `docs/technical/01-database-schema.md` and ADR-0006) —
     specifically so that RLS applies even to the table's own owner. Connecting the running
     application as the owner/migration role (`DATABASE_URL`'s role) would make every RLS policy
     in this schema a no-op for it, silently. `APP_DATABASE_URL` must point at the same host, port,
     and database name as `DATABASE_URL`, but authenticate as `app_user` — same database, two
     different roles with two different privilege levels, by design.
   - `app_user` has no password until `scripts/migrate.ts` sets one — see step 3.

3. **Choose `APP_USER_PASSWORD`** — a fresh, strong password, generated now, never committed
   anywhere. Use it in two places:
   - As the value of the `APP_USER_PASSWORD` environment variable itself.
   - Embedded in the `APP_DATABASE_URL` connection string's credentials (`app_user:<that
password>@<host>...`).

   `scripts/migrate.ts` reads `APP_USER_PASSWORD` and, specifically when it applies
   `0002_app_role.sql`, runs a parameterized `ALTER ROLE app_user WITH PASSWORD $1` — the password
   is never interpolated into SQL text and never appears in a committed migration file (see the
   comments in `db/migrations/0002_app_role.sql` and `scripts/migrate.ts` for why). If
   `APP_USER_PASSWORD` and the password embedded in `APP_DATABASE_URL` ever diverge, the
   application's own connections will start failing to authenticate — keep them in sync any time
   either is rotated.

4. **Require TLS.** Render Postgres requires an encrypted connection; append `?sslmode=require` to
   any connection string here that doesn't already carry it. Confirm once you have a connection
   string:

   ```bash
   psql "$DATABASE_URL" -c '\conninfo'
   ```

   A successful TLS connection prints an `SSL connection (protocol: ..., cipher: ...)` line as
   part of `\conninfo`'s output. If it's absent, the connection fell back to plaintext — fix the
   connection string (`sslmode=require`) before doing anything else.

5. **Create the new web service.** Node runtime, EU/EEA region (matching the database), source
   `github.com/alarapioranse-dotcom/clinic-ai-platform` branch `main`, no root directory, build
   command `npm ci && npm run build`, start command `npm run start`, auto-deploy on commit — all
   reproducing the recorded configuration in Section B. The Pre-Deploy Command will again be
   unavailable unless the plan chosen genuinely includes it; if it does, that would let
   `db:migrate` run automatically on deploy in the future, but do not assume that going in —
   Section D's manual path is what to rely on regardless.

6. **Set every environment variable** from Section B's list on the new web service:

   | Variable              | Value                                                                                                                                                                           |
   | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `NEXT_PUBLIC_APP_URL` | The new web service's actual URL, once known (see the warning at the end of Section B — never the old one).                                                                     |
   | `NEXT_PUBLIC_APP_ENV` | `production`                                                                                                                                                                    |
   | `DATABASE_URL`        | From step 2, the owner/migration connection.                                                                                                                                    |
   | `APP_DATABASE_URL`    | From step 2/3, the `app_user` connection.                                                                                                                                       |
   | `APP_USER_PASSWORD`   | From step 3.                                                                                                                                                                    |
   | `NODE_VERSION`        | The value in this repository's `.nvmrc` (currently `22`) — read it fresh from `main`, don't hardcode it here.                                                                   |
   | `PORT`                | Render's Node runtime injects this automatically for web services; `next start` honors it. Do not hand-set it unless troubleshooting a bind failure.                            |
   | `SEED_STAFF_PASSWORD` | Only needed if you intend to run `npm run db:seed` for validation (Section F) — a fresh password chosen at that time, at least 12 characters, never committed. Omit until then. |

7. **Confirm the TLS connection again**, now as `app_user`, once its password is set (Section D
   applies the migration that sets it):

   ```bash
   psql "$APP_DATABASE_URL" -c '\conninfo'
   psql "$APP_DATABASE_URL" -c 'SELECT current_user, current_database();'
   ```

   Expect `current_user` to report `app_user`, and the TLS line to appear exactly as in step 4.

## D. Schema bootstrap

**Migration history comes from Git, never from the old database.** The old database's actual
applied state is irrelevant here — it's being replaced, not consulted. The authoritative list of
migrations is whatever exists under `db/migrations/*.sql` on `main` at the moment you run this,
not a list copied into this document (which would go stale the next time a migration is added).

**Primary path — the repository's own migration runner.** From a checkout of `main` in Termux,
with `DATABASE_URL` exported to the new database's External URL and `APP_USER_PASSWORD` exported
to the value chosen in Section C:

```bash
npm ci
npm run db:migrate
```

This runs `scripts/migrate.ts`, which:

- Creates `schema_migrations` (`id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT
now()`) if it doesn't already exist.
- Applies every `db/migrations/*.sql` file, in filename order, that isn't already recorded in
  `schema_migrations` — each inside its own transaction, rolled back and reported on failure.
- When applying `0002_app_role.sql` specifically, additionally sets `app_user`'s password from
  `APP_USER_PASSWORD` via a parameterized `ALTER ROLE` (Section C, step 3).
- Records each applied file's name in `schema_migrations` in the same transaction it was applied
  in.

Because the Pre-Deploy Command is unavailable on the plan recorded in Section B, this cannot run
automatically as part of a deploy — treat it as a manual step, run once against the fresh database
(before or shortly after the web service's first deploy), and again only when `main` gains new
migration files later.

**Manual fallback** (Pre-Deploy-hook unavailable, and this is the path to use if `npm`/`tsx` isn't
usable in the current Termux session, or to independently verify what the runner would do). It
must reproduce `scripts/migrate.ts`'s own behavior exactly, including its one filename-keyed
special case:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"

cd db/migrations
for f in $(ls *.sql | sort); do
  already=$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM schema_migrations WHERE id = '$f'")
  if [ "$already" = "1" ]; then
    echo "skip (already applied): $f"
    continue
  fi

  echo "applying: $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
\i $f
SQL

  if [ "$f" = "0002_app_role.sql" ]; then
    # Mirrors scripts/migrate.ts's own special case for this one file:
    # set app_user's password via a bind parameter, never interpolated into SQL text.
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v pw="$APP_USER_PASSWORD" <<'SQL'
SELECT set_config('migration.app_user_password', :'pw', true);
DO $do$
BEGIN
  EXECUTE format('ALTER ROLE app_user WITH PASSWORD %L', current_setting('migration.app_user_password'));
END
$do$;
SQL
  fi

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "INSERT INTO schema_migrations (id) VALUES ('$f'); COMMIT;"
done
```

(This runs the file's own `BEGIN` and `\i` in one `psql` invocation, then the recording `INSERT`
and `COMMIT` in a second, sharing the same open transaction via `psql`'s session — adjust to a
single heredoc per file if your Termux `psql` build's session handling differs; the requirement is
that the migration's own SQL and its `schema_migrations` bookkeeping row commit together, exactly
as `scripts/migrate.ts` does it.)

**Verify** either path reached the expected end state:

```bash
psql "$DATABASE_URL" -c "SELECT id, applied_at FROM schema_migrations ORDER BY applied_at;"
ls db/migrations | sort | tail -1   # from the main checkout — compare its name to the last row above
```

If the last `schema_migrations` row's `id` doesn't match the newest filename under
`db/migrations/` on `main`, do not proceed — see Section H.

## E. Security verification

Read-only. Run every check below before touching Section F. Each query derives what it checks
from the live database or from `main`'s own migration files — nothing here is a hardcoded
expectation that could silently drift from the schema.

**1. `app_user` is not superuser and does not bypass RLS:**

```sql
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname IN ('app_user', 'auth_bootstrap');
```

Expect `app_user`: `rolsuper = f`, `rolbypassrls = f`, `rolcanlogin = t`. Expect `auth_bootstrap`:
`rolsuper = f`, `rolbypassrls = f`, `rolcanlogin = f` (it is `NOLOGIN` — nothing connects as it
directly; its two `SECURITY DEFINER` functions run as it internally, per ADR-0012/ADR-0013).

**2. Row Level Security is enabled _and forced_ on every tenant-scoped table:**

```sql
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
```

Expect **every table except `clinics` and `schema_migrations`** to show `rls_enabled = t` and
`rls_forced = t`. `clinics` is expected to show `f`/`f` — it carries no `clinic_id` and no RLS by
design, because a clinic must be able to find its own row before any `app.current_clinic_id`
context exists (`docs/technical/01-database-schema.md`). Any _other_ table showing `f` in either
column is a defect — stop (Section H).

**3. `tenant_isolation` policies are present on every RLS-forced table:**

```sql
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Expect a `tenant_isolation` policy (applying to `app_user`, or to `public`/all roles) on every
table identified as RLS-forced in check 2. `staff_members` and `staff_sessions` are expected to
additionally show an `auth_bootstrap_select` policy scoped to the `auth_bootstrap` role only
(`db/migrations/0007_auth_bootstrap_functions.sql`, ADR-0012/ADR-0013) — that is the one deliberate,
narrow, reviewed RLS carve-out in this schema, restricted to two `SECURITY DEFINER` functions used
only for pre-tenant-context sign-in/session lookups. No other role should appear on any policy.

**4. Grants match what's actually committed — no `UPDATE`/`DELETE` beyond what's intended:**

```sql
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'app_user' AND table_schema = 'public'
ORDER BY table_name, privilege_type;

-- clinics is column-restricted (0003_clinics.sql) — check separately:
SELECT table_name, column_name, privilege_type
FROM information_schema.column_privileges
WHERE grantee = 'app_user' AND table_schema = 'public' AND table_name = 'clinics'
ORDER BY column_name;
```

Cross-check every row this returns against the `GRANT`/`REVOKE` statements actually committed
under `db/migrations/*.sql` on `main` — every grant `app_user` holds must trace to one of those
statements. As of the migrations on `main` at the time of writing: no `INSERT` on `clinics`
(revoked by `0008_revoke_clinics_insert.sql`), no `DELETE` anywhere, and `conversations`/`messages`
carry `SELECT, INSERT` only (no `UPDATE` — messages are immutable once sent). Don't take that
sentence as the check itself — read the actual migration files on the `main` you're rebuilding
from, since this list is exactly the kind of thing that goes stale.

**5. `schema_migrations` reaches the expected latest migration** — already covered at the end of
Section D; re-run it here as part of the same verification pass if it wasn't just run.

**6. No active staff identity exists unless one was deliberately created.** `staff_members` and
`staff_sessions` are RLS-forced, so a plain `SELECT` under `DATABASE_URL` (also subject to
`FORCE ROW LEVEL SECURITY`, since it is the table owner) returns nothing without a tenant context,
and a per-clinic context would only show one clinic at a time. The owner/migration role was
granted membership in `auth_bootstrap` "WITH SET TRUE" by `0007_auth_bootstrap_functions.sql`
specifically so it can assume that role's cross-clinic read policy for exactly this kind of check:

```sql
SET ROLE auth_bootstrap;
SELECT id, email, role, status, clinic_id FROM staff_members ORDER BY clinic_id;
SELECT id, staff_member_id, clinic_id, expires_at, revoked_at FROM staff_sessions ORDER BY clinic_id;
RESET ROLE;
```

Immediately after a fresh schema bootstrap, both queries must return **zero rows**. If they return
rows, they must all belong to a staff identity you deliberately created for Section F's
verification (and nothing else) — anything else is unexplained data and Section H applies.

## F. Application verification

Do not start this section unless every check in Section E passed. Confirm the deployment itself
first: the Render dashboard shows the new web service's latest deploy as successfully live, built
from the intended commit on `main`.

**Unauthenticated protected API returns `401`:**

```bash
curl -i https://<new-service-url>/api/patients
```

Expect `HTTP/2 401` with a body of the shape `{"error":{"code":"unauthorized","message":"No valid session."}}`.
If this doesn't hold, stop — the application is reachable but its auth boundary isn't; see
Section H.

**The rest of this section only applies if you deliberately create a synthetic staff identity.**
Skip straight to Section G if you don't need to validate the authenticated paths right now — the
`401` check above already confirms the deployment is up and its auth guard is in place.

1. **Create the deployment-validation seed**, from Termux, against the new database's External
   URL (mirrors the pattern already documented in `README.md`'s "Deployment validation seed"):

   ```bash
   NEXT_PUBLIC_APP_URL="https://<new-service-url>" \
   NEXT_PUBLIC_APP_ENV=production \
   SEED_FORCE=true \
   DATABASE_URL="<the External Database URL>" \
   SEED_STAFF_PASSWORD="<a fresh strong password, chosen now, never committed>" \
   npx tsx scripts/seed.ts
   ```

   This creates exactly one demo clinic and one demo staff account
   (`demo-staff@example.test`, `receptionist` role — the lowest-privilege role with any API
   access), idempotently, and nothing else — no patients, conversations, or appointments
   (`scripts/seed.ts`'s own module doc). This _is_ the "deliberate synthetic staff identity" this
   section is gated on.

2. **Authenticated flow and tenant isolation:**

   ```bash
   curl -i -c /tmp/cookies.txt -X POST https://<new-service-url>/api/auth/sign-in \
     -H 'Content-Type: application/json' \
     -d '{"email":"demo-staff@example.test","password":"<the SEED_STAFF_PASSWORD you chose>"}'
   ```

   Expect `200` with a `session` cookie set (`HttpOnly; Secure; SameSite=Lax`). Then:

   ```bash
   curl -i -b /tmp/cookies.txt https://<new-service-url>/api/patients
   ```

   Expect `200` with `{"data":[...]}` scoped to the demo clinic only. (The seed creates only one
   clinic, so this confirms the authenticated path and RLS engaging correctly, not cross-tenant
   exclusion by itself — that's what the check below is for.)

3. **P3-C staff reply, and practitioner cannot reply.** There is no HTTP route yet to create a
   conversation (P3-A's inbound-message path is internal only —
   `src/features/conversations`, no route file). To exercise `POST
/api/conversations/:id/messages`, insert one synthetic patient message directly, as
   `DATABASE_URL`, inside the demo clinic's tenant context — this is synthetic validation data
   under the same "never real, always cleaned up" rule as the seed's own account:

   ```sql
   BEGIN;
   SET LOCAL app.current_clinic_id = '00000000-0000-0000-0000-000000000001'; -- DEMO_CLINIC_ID
   INSERT INTO patients (id, clinic_id, phone_number)
     VALUES ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', '+20100000TEST');
   INSERT INTO conversations (id, clinic_id, patient_id)
     VALUES ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101');
   INSERT INTO messages (id, clinic_id, conversation_id, sender_type, content)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000201', 'patient', 'Rebuild validation message, not real patient data.');
   COMMIT;
   ```

   (Adjust the placeholder UUIDs to whatever you actually insert — they only need to be valid
   UUIDs.) Then, with the demo staff's session cookie from step 2:

   ```bash
   curl -i -b /tmp/cookies.txt -X POST \
     https://<new-service-url>/api/conversations/00000000-0000-0000-0000-000000000201/messages \
     -H 'Content-Type: application/json' \
     -d '{"content":"Rebuild validation reply."}'
   ```

   Expect `201`. The seeded account is `receptionist` — one of the three roles permitted to reply
   (`docs/technical/03-api-contracts.md`). To confirm a **practitioner** is correctly denied,
   create one more synthetic staff row in the same demo clinic (same tenant-context pattern as
   above, `role = 'practitioner'`, a password hash you generate the same way `scripts/seed.ts`
   does), sign in as it, and repeat the same `POST` — expect `403 Forbidden`, not `201`.

4. **Cross-clinic conversation access returns `404`.** Requires a second synthetic clinic. Insert
   one (same pattern: a second `clinics` row, a staff member, a patient, and a conversation, all
   under that second clinic's own tenant context) and, using the **first** clinic's staff session,
   request the **second** clinic's conversation:

   ```bash
   curl -i -b /tmp/cookies.txt \
     https://<new-service-url>/api/conversations/<second-clinic's-conversation-id>
   ```

   Expect `404`, not `403` — a `404` is what proves the RLS-backed "not found and wrong-clinic are
   indistinguishable" guarantee (`docs/technical/03-api-contracts.md`) actually holds in the
   rebuilt deployment, not merely on paper.

## G. Cleanup

Everything created for Section F is synthetic validation data and must not be left in the
database once verification is done — per CLAUDE.md's hard rule, this project keeps no real
identities lying around, and a synthetic one left active is exactly as much of a live credential
as a real one would be.

**Deactivating the account alone is not enough.** A session issued before deactivation stays valid
until it naturally expires (7 days, per `docs/technical/04-auth-implementation.md`) unless its
token is explicitly revoked — `auth_lookup_session_by_token_hash` only excludes a session if
`revoked_at` is set, checked independently of `staff_members.status`. Do both, for every synthetic
staff row created in Section F, in one transaction per staff member:

```sql
BEGIN;
SET LOCAL app.current_clinic_id = '<that staff member's clinic_id>';
UPDATE staff_members SET status = 'deactivated' WHERE id = '<that staff member's id>';
UPDATE staff_sessions SET revoked_at = now()
  WHERE staff_member_id = '<that staff member's id>' AND revoked_at IS NULL;
COMMIT;
```

Confirm no session for that staff member remains valid:

```sql
SET ROLE auth_bootstrap;
SELECT id, staff_member_id, expires_at, revoked_at FROM staff_sessions
  WHERE staff_member_id = '<that staff member's id>';
RESET ROLE;
```

Every row must show a non-null `revoked_at`.

If you inserted a second synthetic clinic for the cross-clinic check in Section F step 4, remove
that clinic's synthetic rows the same way (deactivate + revoke its staff, and note that the
patient/conversation/message rows are harmless to leave as inert synthetic data, or delete them if
you'd rather leave nothing behind — nothing in this schema currently exposes a `DELETE` path for
`conversations`/`messages` through `app_user`, so removing them, if you choose to, requires the
`DATABASE_URL` owner connection).

Re-run Section E, check 6, after cleanup — it must return zero rows again, exactly as it did
immediately after the fresh schema bootstrap.

## H. Failure rules

If **any** check in Section D (schema bootstrap), Section E (security verification), or the
authentication/authorization checks in Section F fails:

- **Stop.** Do not proceed to the next section.
- Do not continue on to application verification if schema bootstrap or security verification
  failed — a passing `curl` request against a misconfigured database proves nothing and must not
  be read as success.
- **Do not declare the rebuild successful.** A rebuild that skipped a failing check is not a
  smaller version of a successful rebuild — it is an unverified one, and per charter §5 ("A
  security finding outranks a feature on the schedule, unconditionally"), it stays unresolved
  until the failing check is understood and fixed, not worked around.
- Diagnose against `main` and the actual committed migrations, not against what this runbook
  expected — if the schema or grants have genuinely changed since this document was written, the
  fix is to re-derive the check from the current repository state (as every check above already
  instructs), not to lower the bar the check enforces.
