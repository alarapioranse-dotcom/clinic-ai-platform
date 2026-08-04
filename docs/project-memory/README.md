# Project Memory

## Purpose

This directory is the permanent AI memory for this project. It exists so that any AI agent
working on this repository — in this session or a future one — can orient itself without relying
on chat history, which is never authoritative (see
[`docs/operating-system/constitution.md`](../operating-system/constitution.md), §3).

## Rules for this directory

- No guesses: a file is left as a TODO placeholder until the real information is known and
  confirmed.
- No duplication: information that already has a canonical home elsewhere in the repository
  (the Charter, ADRs, product docs, roadmap) is referenced from here, never copied.
- No summaries standing in for the source: this directory records durable facts and current
  state, not a rewritten digest of other documents.
- Kept current: an entry that no longer matches reality is corrected or removed in the same pull
  request as the change that made it stale.

## Files in this directory

| File                                                             | Purpose                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`00-project-summary.md`](./00-project-summary.md)               | What this project is, at a glance.                                |
| [`01-current-status.md`](./01-current-status.md)                 | Where the project currently stands.                               |
| [`02-architecture-decisions.md`](./02-architecture-decisions.md) | Running index of key architecture decisions and their status.     |
| [`03-ai-agents.md`](./03-ai-agents.md)                           | Which AI agents work on this project and their roles.             |
| [`04-rules.md`](./04-rules.md)                                   | Durable, project-specific rules AI agents must follow.            |
| [`05-next-step.md`](./05-next-step.md)                           | The single next action to take on this project.                   |
| [`06-project-glossary.md`](./06-project-glossary.md)             | Project-specific terms and their definitions.                     |
| [`07-folder-map.md`](./07-folder-map.md)                         | Map of the repository's folder structure.                         |
| [`08-tech-stack.md`](./08-tech-stack.md)                         | The technologies, frameworks, and tools this project uses.        |
| [`09-history.md`](./09-history.md)                               | Chronological log of significant events in the project's history. |

## Status

This structure was created empty. Every file listed above currently contains only its title,
purpose, section headings, and TODO placeholders — no project information has been filled in yet.
