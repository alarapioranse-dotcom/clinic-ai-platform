# Project Memory

> This file holds pointers, never facts. If a statement here could go out of date, it belongs in
> its source document instead. Deleting this entire directory must lose no information.

## What this directory is

This directory is the permanent knowledge base every AI system reads before working on this
project: Claude, Claude Code, ChatGPT, Kimi, Gemini, and future agents. It exists so that any of
them can orient itself without relying on chat history, which is never authoritative (see
[`docs/operating-system/constitution.md`](../operating-system/constitution.md), §3).

## Where it sits

This directory sits **outside** the source-of-truth hierarchy in
[`docs/operating-system/constitution.md`](../operating-system/constitution.md), §3. It is an
index, not a source. Where anything here disagrees with any ranked source in that hierarchy, the
ranked source wins and this directory is corrected — it never wins a conflict, and it is never
cited as authority for a decision.

## The test for a correct file here

Does it tell a reader where to look, without telling them what they will find?

## Files in this directory

| File                                                             | Points to                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`00-project-summary.md`](./00-project-summary.md)               | Charter §1–§2, `docs/01-project-plan.md`                           |
| [`01-current-status.md`](./01-current-status.md)                 | GitHub (branches, open PRs, CI), Notion HQ                         |
| [`02-roadmap-status.md`](./02-roadmap-status.md)                 | `docs/03-roadmap.md`                                               |
| [`03-architecture-decisions.md`](./03-architecture-decisions.md) | `docs/adr/` (index only)                                           |
| [`04-ai-agents.md`](./04-ai-agents.md)                           | Constitution, Notion AI Agents Directory                           |
| [`05-rules.md`](./05-rules.md)                                   | Charter, Constitution, `CONTRIBUTING.md`                           |
| [`06-tech-stack.md`](./06-tech-stack.md)                         | `package.json`, `docs/02-architecture.md`, ADR 0001                |
| [`07-folder-map.md`](./07-folder-map.md)                         | The repository tree itself                                         |
| [`08-glossary.md`](./08-glossary.md)                             | `docs/domain/07-glossary.md` and other domain documents            |
| [`09-history.md`](./09-history.md)                               | Git log and merged pull requests                                   |
| [`10-ai-onboarding.md`](./10-ai-onboarding.md)                   | The reading order itself (this file's content is the pointer list) |
| [`11-prompts.md`](./11-prompts.md)                               | Reusable prompt patterns (no project specifics)                    |
| [`12-checklists.md`](./12-checklists.md)                         | Charter Definition of Ready and Definition of Done                 |
| [`13-faq.md`](./13-faq.md)                                       | Questions whose answers are pointers to other documents            |

## Templates

Blank forms for recurring work, under [`templates/`](./templates/): a feature template, an ADR
template (which links to and must match `docs/adr/README.md`'s canonical template), an issue
template, and a prompt template.

## Status

This structure was created empty. Every numbered file contains only its title, the governing-rule
banner above, a purpose statement, a source-of-truth line, empty section headings, and TODO
placeholders — no project information has been filled in, except `10-ai-onboarding.md`'s reading
order itself, which is a list of documents to read, not a fact about the project.
