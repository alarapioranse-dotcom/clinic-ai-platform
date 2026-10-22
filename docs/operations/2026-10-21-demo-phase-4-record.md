# Operations Record — Demo Environment Phase 4 (Synthetic Clinic Provisioning)

**Date:** 2026-10-21 (verification completed 2026-10-22)
**Type:** Operations record (no code, schema, RLS or ADR change)
**Scope:** The separate demo environment of `2026-10-21-demo-environment-option-c.md` only. Production (`clinic-ai-platform`, `clinic-ai-db`) was not touched by any step below.

This record contains no invitation link, token, password or connection string. Times are UTC.

## Summary

`scripts/provision-clinic.ts` was run against `clinic-ai-demo-db` from the Owner's Termux terminal, as `clinic_ai_demo_user`, from main. It created one synthetic clinic and one owner invitation. The first invitation was not accepted (see "First invitation"), so it was reissued with `--reissue`; the reissued invitation was accepted and the owner signed in. The database's public-internet access was then closed. The demo readiness change (#104) was merged and verified on the demo; production was checked to show no environment notice.

## Provisioning

| Item                  | Value                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Clinic                | "Demo Dental Clinic (synthetic)", `Europe/Athens`, id `4d4e39b5-4a2e-419a-afe6-11181440fe52`                            |
| Owner email           | `clinicai.europe+demo-owner@gmail.com` (Owner-controlled plus-address)                                                  |
| Contact email         | `clinicai.europe+demo-contact@gmail.com`                                                                                |
| Repository            | main `0f7680b` (dry run), main `09a2d40` (real run and reissue); `scripts/provision-clinic.ts` identical in both        |
| Connection            | Demo external URL, `clinic_ai_demo_user`; `sslmode=require` for the dry run, `sslmode=verify-full` for every later step |
| `NEXT_PUBLIC_APP_ENV` | `staging`; `NEXT_PUBLIC_APP_URL` = the demo URL; no `.env.local` present                                                |

Before each write the operator ran a fail-closed pre-check that refused to continue unless all of these held: no `.env.local`; user `clinic_ai_demo_user`; host `dpg-dbb8jbjrjlhs73crqcdg-a.*`; `sslmode` exactly `verify-full`; `NEXT_PUBLIC_APP_ENV=staging`; `NEXT_PUBLIC_APP_URL` exactly the demo URL. The script's own production guard checks only `NEXT_PUBLIC_APP_ENV`, not the database host, so this operator check is what bound each run to the demo database. It stopped one reissue attempt (with `STOP`) when `DATABASE_URL` was unset, before any connection.

Steps:

1. **Dry run** (`--dry-run`): passed ("Dry run OK … Nothing was saved."). The script inserts inside a transaction and rolls back.
2. **Real run** (2026-10-21, about 17:31): clinic and owner invitation created; invitation valid until 2026-10-24T17:31:02.580Z.
3. **First invitation** was not accepted. A read-only check (a `BEGIN READ ONLY` transaction ending in `ROLLBACK`, under the clinic's tenant context) showed the invitation `pending` and no staff member. The cause was not established; the likely causes are a truncated link copy or a page reload losing the in-memory token (the `/invite` page removes the token from the URL on load by design).
4. **Reissue** (`--reissue --clinic-id …`): expired the first invitation and issued a new one.
5. **Acceptance**: the reissued link showed "تم إنشاء حسابك…"; the owner chose a password that exists only in the Owner's password manager.

## Post-acceptance checks (demo)

| Check                                            | Result                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Sign-in with the chosen password                 | Pass: `/dashboard` opened with the owner navigation                                                     |
| Staff page                                       | Pass: exactly one member, the owner email, role owner; "لا توجد دعوات معلّقة"                           |
| `/dashboard` in a private window with no session | Pass: redirected to `/login`                                                                            |
| Reuse of the accepted link                       | Not reported                                                                                            |
| Wrong password shows the generic error           | Not separately reported after acceptance (the generic error was seen earlier, while no account existed) |

## External database access

In `clinic-ai-demo-db` → Info → Networking, the only PostgreSQL inbound rule (`0.0.0.0/0`, "everywhere") was removed with Render's "Block All Inbound IPs" confirmation. The workspace-level inbound rule was not changed. Render then showed "All internet traffic is blocked by PostgreSQL inbound IP rules." and hid the external URL and PSQL command ("External traffic not allowed"). The demo web service, which uses the internal URL, kept working (`/dashboard` loaded afterwards). An independent connection attempt from outside was not made, because Render no longer exposes the external URL.

A later operator script needs external access reopened for one operation (a single `/32` source), then removed.

## Demo readiness change (#104)

Merged as `b4145fd`. Verified after Render's auto-deploy:

- Demo: the notice "بيئة تجريبية — لا تُدخل بيانات مرضى أو عيادات حقيقية." is on `/login` (fetched 2026-10-21); the sign-out button signed the owner out (Owner, 2026-10-22).
- Production: the service shows `b4145fd` live, and `/login` shows no environment notice (Owner, 2026-10-22).

## Not proven by this record

- Nothing here is evidence about production (rule 9 of the option C note). `scripts/provision-clinic.ts` remains unrun against production.
- Link reuse and the post-acceptance wrong-password message were not reported on the demo; both are covered by repository tests (`tests/db/invitations.test.ts`, `tests/api/auth-routes.test.ts`).
- No knowledge-document upload was attempted; the demo has no storage bucket.
