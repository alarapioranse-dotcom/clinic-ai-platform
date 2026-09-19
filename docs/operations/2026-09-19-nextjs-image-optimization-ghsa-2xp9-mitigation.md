# Security/Dependency Maintenance Record — Next.js Image Optimization RCE (GHSA-2xp9-vwfh-vxw4)

**Date:** 2026-09-19
**Status:** Mitigated (dependency not upgraded)

## Advisory

[GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) — unauthenticated RCE in
the Next.js Image Optimization API when AVIF files are processed through libheif. Affected
versions include the `16.2.x` line this project runs; the vendor-patched version is `16.3.3`. The
companion advisory GHSA-p293-qw3h-jr36 is Windows-only and does not apply to this project's Linux
hosting.

## What was done

The vulnerable Next.js dependency **remains at its current version (`16.2.12`)** — it was not
upgraded. `src/` does not import or use `next/image` anywhere, but the production `/_next/image`
route was verified live (returns 400, not 404, on the URLs tested), meaning the Image Optimization
API is reachable despite being unused by the application.

`next.config.ts` was changed to add:

```ts
images: {
  unoptimized: true,
},
```

This **disables the Image Optimization API's affected image-processing functionality** at the
framework level, removing the unused attack surface rather than relying on the route's current
narrow configuration.

## What this is not

**This mitigation is NOT equivalent to upgrading to the vendor-patched version (`16.3.3`).** The
vulnerable code path in the `next` package itself is untouched; this change only prevents that
code path from being invoked in this deployment. Upgrading Next.js to `16.3.3` (or later) is
intentionally deferred to a separate dependency-maintenance slice, which will also need to
address the remaining `postcss`, `js-yaml`, and `sharp` advisories reported by `npm audit`
(out of scope for this record).

## Validation performed

- `npm run typecheck` — passes.
- `npm run lint` — passes.
- `npm test` — 257/257 tests passed (25/25 test files), run against a local Postgres 16 instance
  with migrations 0001–0012 applied.
- `npm run build` — succeeds; the built `required-server-files.json` confirms
  `config.images.unoptimized: true` is present in the resolved, effective Next.js configuration.
- `git diff` confirms `package.json` and `package-lock.json` are unchanged — no package versions
  were modified by this change.
- Confirmed no file under `src/**` imports `next/image`.

## Scope

This record covers `next.config.ts` only. No application code, database schema, migrations, RLS
policies, or production data were touched. No ADR was created or modified. No Render/production
configuration was changed.
