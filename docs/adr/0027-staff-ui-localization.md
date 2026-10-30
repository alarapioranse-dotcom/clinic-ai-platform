# 0027 — Staff UI localization: Arabic, Greek and English, chosen per staff member

## Status

Accepted — 2026-10-28. Approved by the owner in a comment on
[PR #120](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/120).

## Date

2026-10-27

## Phase

Staff UI localization (pilot readiness), a roadmap section added in the same pull request as this
ADR (see [`docs/03-roadmap.md`](../03-roadmap.md)). It is not part of P5's acceptance criteria and
does not close or reopen P5.

## Impact

Costly to reverse (see [charter §10](../governance/project-charter.md)). The mechanism chosen here
touches every staff screen: once every user-facing string is moved into per-locale dictionaries and
`lang`/`dir` are derived from a locale instead of hardcoded, changing the mechanism again means
editing every screen a second time. It changes no database schema, no API contract, no tenant
isolation rule and no production data, so it is not a one-way door in the sense of
[ADR-0016](./0016-clinic-working-hours-iana-timezone.md) or
[ADR-0020](./0020-multilingual-bidirectional-product-scope.md). The Owner's approval is still
required, because this ADR is the first implementation of ADR-0020 decision 5 and chooses which
languages the product implements.

## Context

[ADR-0020](./0020-multilingual-bidirectional-product-scope.md) (Accepted) decided that the product is
multilingual and bidirectional by design, that language is a per-clinic concern, and that "which
languages get implemented is decided incrementally, by market and customer need, in whatever future
ADR or roadmap phase that work belongs to". It changed no code. This ADR is that future record for
the staff-facing UI.

The current state, read from `main` at `a3d11aa` on 2026-10-27:

- `src/app/layout.tsx` hardcodes `<html lang="ar" dir="rtl">`; `src/config/site.ts` and
  `src/types/index.ts` hardcode `locale: 'ar'` and `direction: 'rtl'`.
- 278 non-test source lines in 39 files contain Arabic UI text: 174 in the staff screens under
  `src/app/(app)`, 22 in `src/app/(auth)` (login and invitation acceptance), 56 in the public
  marketing components, and the rest in navigation, the environment notice, `error.tsx`,
  `not-found.tsx` and `src/config/site.ts`.
- Dates and numbers are formatted with a hardcoded `'ar'` locale (`toLocaleString('ar')`,
  `toLocaleDateString('ar')`, `Intl.DateTimeFormat('ar', …)`) in 6 staff-screen files.
- The fonts loaded in `layout.tsx` (Tajawal, IBM Plex Sans Arabic) are Arabic-optimized.
- API routes return error codes, not Arabic text; screens map codes to messages (for example
  `src/app/(app)/dashboard/knowledge-base/failure-messages.ts`). No test asserts Arabic text.
- Only 2 direction-specific Tailwind classes exist (`mr-3`, `mr-2` in the conversation detail page);
  no logical (`ms-`/`me-`) classes are used yet.
- There is no i18n library, no locale configuration and no language column in the database.

The first target market is dental clinics in Greece (ADR-0009 scope), and the first pilot clinic's
staff are expected to work in Greek. A staff UI that exists only in Arabic blocks that pilot. The
Owner works in Arabic, so Arabic must stay available.

## Decision

1. **Languages.** The staff UI is implemented in three locales: Arabic (`ar`, right-to-left), Greek
   (`el`, left-to-right) and English (`en`, left-to-right). No other locale is implemented by this
   ADR.
2. **Scope.** Every screen under `src/app/(app)` and `src/app/(auth)`, the app navigation, the
   environment notice, `error.tsx` and `not-found.tsx`. The public marketing page under
   `src/app/(marketing)` and `src/components/marketing` stays Arabic-only for now (see "What this
   ADR does not decide").
3. **Choice of language, per staff member, without a schema change.** The active locale is chosen,
   in order: (a) a `locale` cookie holding `ar`, `el` or `en`, set only when the staff member picks
   a language from a language switcher shown on every in-scope screen, including the login page;
   (b) otherwise the best match for the browser's `Accept-Language` header among the three
   locales; (c) otherwise `el`. Any other cookie value is ignored. The cookie stores only that
   preference, no identifier, and is set only on the staff member's explicit request.
4. **No new dependency.** Strings live in one typed dictionary module per locale inside the
   repository, following the dictionary approach described in the Next.js App Router
   internationalization guide. The English dictionary defines the key set and its TypeScript type;
   the Arabic and Greek dictionaries must satisfy that type, so a missing or misspelled key fails
   `npm run typecheck`. Dictionaries are loaded on the server; client components receive only the
   strings they render.
5. **Direction follows the locale.** `lang` and `dir` on `<html>` come from the active locale (`ar`
   → `rtl`; `el` and `en` → `ltr`). New and touched layout classes use logical properties
   (`ms-`/`me-`, `ps-`/`pe-`, `text-start`/`text-end`), and the two existing `mr-` classes are
   converted.
6. **Formatting follows the locale.** Dates, times and numbers use `Intl` with the active locale
   instead of the hardcoded `'ar'`. Which time zone a date is displayed in is not changed by this
   ADR.
7. **Fonts.** In addition to the current Arabic fonts, a font family covering Greek and Latin is
   loaded the same way (`<link>`, so `next build` keeps no network dependency), selected for the
   active locale. The exact family is chosen during implementation and checked on real Greek text.
8. **Translation quality is a release condition, not a code condition.** English and Greek text is
   drafted in the repository. Greek text must be reviewed by a native Greek speaker, and that review
   recorded in the pull request, before any Greek screen is shown to a clinic. Until then, Greek may
   be shown only in the demo environment, to the Owner.
9. **Delivery in slices, each with its own Owner approval:** (1) the mechanism: dictionaries, locale
   resolution, `lang`/`dir`, the language switcher, fonts and `Intl` formatting, with Arabic moved
   into a dictionary and no visible change for an Arabic user; (2) English for every in-scope
   screen; (3) Greek for every in-scope screen, followed by the native-speaker review.

## What this ADR does not decide

- **A per-clinic default language.** ADR-0020 decision 3 makes language a per-clinic concern. A
  clinic-level default needs a new column and a migration, and is left to a later ADR; the
  per-staff-member choice here does not prevent it, since a clinic default would only change step
  (c) of the resolution order.
- **The language of patient-facing messages or AI replies.** No patient channel exists yet, and AI
  replies depend on [ADR-0019](./0019-ai-provider-selection.md), which is still Proposed.
- **Localizing the public marketing page**, invitation links or any e-mail text.
- **Any additional locale** beyond `ar`, `el` and `en`.
- **The time zone in which dates are displayed**, and any change to how appointments are stored or
  interpreted ([ADR-0016](./0016-clinic-working-hours-iana-timezone.md) and
  [ADR-0017](./0017-clinic-working-hours-dst-transitions.md) are unaffected).

## Consequences

- The first Greek pilot clinic can use the staff UI in Greek, once slice 3 and the native-speaker
  review are done; the Owner keeps an Arabic UI.
- Every new staff-facing string must be added to all three dictionaries; `npm run typecheck` enforces
  that the keys exist, not that the translations are correct.
- Screens become direction-aware, so later locales of either direction need only a new dictionary
  and, for a new script, a font.
- The language cookie is a preference cookie set at the user's explicit request; whether the privacy
  page must mention it is recorded as an input for the privacy page already listed as a pilot
  prerequisite, not decided here.
- Translation review becomes a recurring cost for every UI change, paid in the pull request that
  adds the string.

## Alternatives considered

- **An i18n library (for example `next-intl`).** Rejected for now: it adds a dependency and its own
  routing and message format to a codebase with about 280 lines of UI text and no other need for
  it. The typed-dictionary approach gives compile-time key checking with no dependency; a library can
  still be adopted later behind the same dictionary keys.
- **Locale in the URL (`/el/dashboard`).** Rejected: it changes every route, link and redirect in
  the staff app, and staff screens are not public pages that need language-specific URLs for search
  engines. A cookie keeps the routes unchanged.
- **Locale stored per staff member in the database.** Rejected for now: it needs a migration on a
  table protected by RLS and SECURITY DEFINER lookups for a preference that a cookie can hold; it
  can be added later if staff need the same language across devices.
- **Greek only, replacing Arabic.** Rejected: the Owner works in Arabic, and ADR-0020 keeps Arabic as
  an important supported language.
- **Machine-translate at runtime.** Rejected: it would send UI text to an external service, add an
  undecided provider dependency, and give no reviewed wording in a healthcare context.
