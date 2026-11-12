# 0029 — Public pages follow the visitor's language

## Status

Accepted — 2026-11-12. Approved by the owner in a comment on
[PR #132](https://github.com/alarapioranse-dotcom/clinic-ai-platform/pull/132#issuecomment-6834236244).

## Date

2026-11-12

## Phase

Pilot readiness. [ADR-0027](./0027-staff-ui-localization.md) localized the staff UI and left
"localizing the public marketing page" undecided. This ADR decides it.

## Context

The public pages are the home page (`/`) and the privacy notice (`/privacy`), both in the
`(marketing)` route group. Today the home page is Arabic for every visitor, and the privacy notice
shows its Arabic, Greek and English texts one after the other on a single page (#127).

The first target market is clinics in Greece (ADR-0009, ADR-0027 context). A Greek clinic owner who
opens the site sees an Arabic page, and a privacy notice three times as long as it needs to be. The
staff UI already picks one language per person: a `locale` cookie set by an explicit choice, then
the browser's `Accept-Language`, then Greek (ADR-0027 decision 3).

## Decision

1. **One language per visitor.** The home page and the privacy notice are shown in one of the three
   locales of ADR-0027 (`ar`, `el`, `en`), chosen by the same resolution order as the staff UI:
   the `locale` cookie, then `Accept-Language`, then `el`. `lang` and `dir` on `<html>` follow the
   chosen locale. No other locale is added.
2. **A language switcher on both public pages.** It is the switcher the staff UI uses, sets the
   same `locale` cookie, and only on the visitor's explicit choice. A language chosen on a public
   page therefore also applies to the sign-in page, and the reverse.
3. **The privacy notice shows one language.** The three texts stay in the repository
   (`src/app/(marketing)/privacy/content.ts`); the page renders the one for the active locale. The
   other two are reached through the switcher. The notice's cookie paragraph is updated in the same
   pull request to say the language cookie is set for any visitor who picks a language, not only
   for staff.
4. **Same technique, no new dependency.** The home page's text moves into typed per-locale
   modules checked by `npm run typecheck`, as in ADR-0027 decision 4. No URL changes: there are no
   `/el/...` or `/en/...` paths.
5. **Translation quality stays a release condition.** The Greek and English home-page text is
   drafted in the repository. ADR-0027 decision 8 applies to it unchanged: a native Greek speaker's
   review, recorded in a pull request, before the Greek text is shown to a clinic.

## What this ADR does not decide

- **Search-engine handling of the three languages** (per-language URLs, `hreflang`). With one URL
  per page and the language chosen per request, a search engine indexes one language, most likely
  the fallback. That is accepted for a pre-launch site and needs its own decision before marketing
  relies on search.
- **Invitation e-mails, patient-facing text and AI replies** (unchanged from ADR-0027).
- **Legal review of the privacy notice**, still required before the first clinic.

## Consequences

- A Greek, Arabic or English visitor sees the home page and the privacy notice in their language.
- With no cookie and no matching `Accept-Language`, a visitor now gets Greek instead of Arabic.
- The two public pages are no longer prerendered: they read the cookie and the request headers, so
  they are rendered on each request, like the staff pages. They make no database call.
- The un-reviewed Greek text becomes visible on the public site by default. Decision 5 keeps the
  rule; in practice the native-speaker review now also gates showing the public site to a clinic.
- Someone who needs the notice in another language must use the switcher, where today all three
  are on the page.

## Alternatives considered

- **Keep the home page Arabic-only.** Rejected: the first clinics are Greek.
- **Per-language URLs (`/el`, `/en`, `/ar`).** Better for search engines and keeps pages static,
  but changes every public link and adds routing that the staff UI does not have. Left to the
  search-engine decision above.
- **Keep all three privacy texts on one page.** Works without any cookie or header, but is long and
  confusing next to a home page shown in one language.
