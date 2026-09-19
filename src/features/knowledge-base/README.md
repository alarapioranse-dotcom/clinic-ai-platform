# knowledge-base

Roadmap P5 Slice 1: owns each clinic's knowledge base — the services,
pricing, hours, and policies content used to ground automated replies to
patients. This slice implements only the "each clinic maintains its own
knowledge base" acceptance criterion: plain create/list/get/edit/delete of
clinic-owned `title`/`content` entries. No AI, no retrieval, no embeddings —
see `db/migrations/0013_knowledge_documents.sql` for the full reconciliation
against the design-only schema in
`docs/technical/01-database-schema.md`.

## Rules

- This feature computes; routes and components compose it, not the other way
  around.
- No other feature (`appointments`, `patients`, `conversations`) may import
  from this feature's internals. Only its public entry point (`./index.ts`)
  is a valid import target.
- `process.env` is never read here — configuration comes from `src/lib/env.ts`.
