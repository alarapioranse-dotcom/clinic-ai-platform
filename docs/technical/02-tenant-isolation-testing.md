# Tenant Isolation Testing

This is a required regression gate, not optional coverage: per
[charter §5](../governance/project-charter.md), "Tenant isolation is enforced at the data layer. A
UI check that hides another clinic's data is not isolation" — and per
[ADR-0003](../adr/0003-multi-tenancy-model.md), Row Level Security is the mechanism that makes that
true. A test suite that never actually exercises RLS could pass indefinitely after a policy is
accidentally dropped from a migration. This document specifies the shape that test must take so
that it _cannot_ pass that way.

**Illustrative only** — this is not a runnable file and nothing is added under `src/`. It is the
specification P1's migration tooling and test setup must implement.

## What makes a tenant-isolation test meaningful, not tautological

A test that creates data as Clinic A, queries as Clinic A, and asserts it can see its own data
proves nothing about isolation — it would pass identically with RLS disabled entirely. A meaningful
test must:

1. Create data belonging to **two different clinics**.
2. Query **as one clinic's context**.
3. Assert the **other clinic's rows are invisible** — not merely "not returned by this particular
   query shape," but invisible to an unscoped `SELECT *` against the table.
4. Be run against a database connection that does **not** bypass RLS (i.e., not as a superuser or
   table owner without `FORCE ROW LEVEL SECURITY` — see
   [`01-database-schema.md`](./01-database-schema.md)'s note on why `FORCE` is part of every
   policy).
5. **Fail if the policy is removed.** The way to be sure of this is to actually remove the policy
   in a throwaway transaction and confirm the test fails, at least once when the test is written —
   a test that was never seen to fail is not a verified regression gate.

## Illustrative test

```sql
-- Setup: two clinics, one patient each, using an application-equivalent low-privilege role
-- (not the table owner — table-owner connections bypass RLS regardless of FORCE).
BEGIN;

INSERT INTO clinics (id, name, owner_email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Clinic A', 'a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'Clinic B', 'b@example.test');

SET LOCAL app.current_clinic_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO patients (id, clinic_id, phone_number) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', '+201000000001');

SET LOCAL app.current_clinic_id = '22222222-2222-2222-2222-222222222222';
INSERT INTO patients (id, clinic_id, phone_number) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222', '+201000000002');

COMMIT;
```

```sql
-- Test 1: querying as Clinic A must never return Clinic B's patient.
BEGIN;
SET LOCAL app.current_clinic_id = '11111111-1111-1111-1111-111111111111';

SELECT count(*) AS visible_rows FROM patients
WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002';
-- ASSERT: visible_rows = 0

SELECT count(*) AS total_visible FROM patients;
-- ASSERT: total_visible = 1 (only Clinic A's own patient)
COMMIT;
```

```sql
-- Test 2: an unscoped context must see nothing, not "see everything" (fail-closed, matching
-- current_setting(..., true) returning NULL when app.current_clinic_id was never set —
-- see 01-database-schema.md).
BEGIN;
RESET app.current_clinic_id;

SELECT count(*) AS total_visible FROM patients;
-- ASSERT: total_visible = 0
COMMIT;
```

```sql
-- Test 3 (the self-check that makes Tests 1-2 meaningful): confirm the test actually exercises
-- RLS, by proving it fails once the policy is gone. Run only when authoring/reviewing this test,
-- against a disposable database — never in a normal CI run, since it deliberately weakens
-- isolation.
BEGIN;
DROP POLICY tenant_isolation ON patients;

SET LOCAL app.current_clinic_id = '11111111-1111-1111-1111-111111111111';
SELECT count(*) AS visible_rows FROM patients
WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002';
-- EXPECTED with the policy dropped: visible_rows = 1 (Test 1's assertion now fails, as intended)

ROLLBACK; -- never commit the DROP POLICY
```

## What this must become in CI, and how it fails if a policy is removed

- **As an automated test**, Tests 1 and 2 above are what P1's test suite runs on every CI build —
  written against the same low-privilege application role the running product uses, against a real
  Postgres instance (RLS cannot be meaningfully faked against an in-memory or mocked database).
  Parameterize over every tenant-scoped table from
  [`01-database-schema.md`](./01-database-schema.md), not only `patients` — a table added later
  without RLS should make this suite fail immediately, by table-list coverage, not just by luck of
  which table a hand-written test happened to check.
- **Test 3 is not part of the CI run** — it's the one-time proof, done when this test is written
  or changed, that the assertions in Tests 1–2 are not vacuously true. If a future migration
  accidentally drops a `tenant_isolation` policy (or a new tenant-scoped table is added without
  one), Test 1's equivalent for that table starts returning `visible_rows > 0` or
  `total_visible` including another clinic's rows, and the CI build goes red — this is the concrete
  mechanism by which "a tenant-isolation test that fails if an RLS policy is removed" is satisfied,
  not an aspiration.
- Coverage should include at least one table enforcing same-clinic composite foreign keys
  (`appointments`) to confirm cross-tenant isolation holds through a join-shaped query, not only a
  direct table scan.
