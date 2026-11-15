# Greek native-speaker review record — 2026-11-15

This records the native-speaker review that ADR-0027 decision 8 and ADR-0029 decision 5 require
before any Greek screen, or the public site, is shown to a clinic.

## What was reviewed

Every Greek string the application shows, as on main at `a55eda7` (the text is unchanged from
`52b4c8b`, where the review page was built):

| Source                                                  | sha256 at `a55eda7`                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/i18n/dictionaries/el.ts`                           | `00f7a0b8534e00d73db647a422ed40f16011ce80b936cc6ced1e0f2648305ef4` |
| `src/i18n/dictionaries/el-errors.ts`                    | `01aa6b84ec1e2996a20ef997d4279b11ac96dced8284b8c9343473a3a559e312` |
| `src/i18n/marketing/el.ts`                              | `6954b541a8cb1d6b05efea6b4377b827513a46a4bdfc1c6349e1554646655999` |
| `src/app/(marketing)/privacy/content.ts` (Greek notice) | `ac2600b0e9b4686221fb11f9e5f6a5bfa35d3651f3881672efedf9c828514fa0` |

312 strings: 229 staff-screen strings, 53 public home-page strings and 30 privacy-notice strings.
Strings identical in Greek and English (the product name, "Email", size units, slot times, step
numbers and the text direction) were not listed.

## How

The strings were shown one by one on a private review page, each with its English and Arabic
meaning underneath. Instructions in Greek asked the reviewer to check spelling and accents, grammar,
natural clinic wording, formal plural address, consistent terms across screens, unchanged
placeholders such as `{day}`, and that the meaning matches. For the privacy notice the reviewer
checked the language only.

## Result

Reported to the Owner on 2026-11-15 and relayed verbatim:

```
EL-REVIEW v1
reviewer: -
native: yes
date: 2026-11-15
total: 312 | ok: 312 | fix: 0 | open: 0
```

The reviewer states Greek is their mother tongue and marked all 312 strings correct, with no
corrections. The reviewer is known to the Owner; the name is not recorded in this public
repository.

## What this does not cover

- The strings were read out of context, not on rendered screens.
- The legal content of the privacy notice. Its legal review is still required before the first
  clinic.
- Any Greek text added or changed after `a55eda7`. A pull request that changes Greek text needs its
  own native-speaker review (ADR-0027, Consequences).
