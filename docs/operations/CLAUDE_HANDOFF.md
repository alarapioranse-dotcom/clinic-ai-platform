**NON-CANONICAL HANDOFF — source of truth remains ADRs, code, migrations, tests, charter, and STATUS.md.**

This file is a convenience summary and may become stale. Read the source-of-truth files when details conflict.

## 1. Project identity

Clinic AI Platform: healthcare SaaS, an administrative AI operating assistant for medical clinics. It is not a diagnostic system. EU/EEA first. Human control is mandatory, and unsafe or ambiguous requests need a human escalation path. New scope is decided only by the Owner.

## 2. Repository

https://github.com/alarapioranse-dotcom/clinic-ai-platform (public). GitHub is the source of truth. The Owner reviews and merges every PR. Agents never merge.

## 3. Current architecture

- Flow: patient, channel, conversation, AI intent, authorized tool, domain logic, database. The AI never touches the database directly.
- Shared database, tenant isolation by `clinic_id`, RLS with FORCE, `app_user` runtime role, transaction-local tenant context (ADR-0003, ADR-0006).
- Knowledge-document upload is direct browser to Scaleway Object Storage via presigned PUT (ADR-0018).
- Multilingual and bidirectional by design (ADR-0020).

## 4. Current stack

Next.js 16.2.12, React 19.2.8, TypeScript strict, Tailwind v4, PostgreSQL 16 with `pg` (no ORM) and pgvector, Vitest. Versions come from `package.json`.

## 5. Current production state

- Render web service (Free tier) and Render PostgreSQL (paid lowest tier), both in Frankfurt.
- Migrations applied: 0001 to 0014.
- No real patient or clinic data. No active staff identity, by design.
- Scaleway FR-PAR private bucket for knowledge documents.

## 6. Completed phases

P1, P2, P3 (A, B, C) and P4 are closed. See `CLAUDE.md` Status for the authoritative statement.

## 7. Current P5 state

- Slice 1A (schema) and Slice 1B (upload initiate and complete) are merged. P5 overall is not closed.
- Upload accepts PDF only, at most 10485760 bytes. Completion checks real ContentLength and Content-Type through HeadObject.
- Not built: PDF signature validation, extraction, chunking, embeddings, retrieval, any AI call.

## 8. Current blockers

- AI provider selection is blocked on contractual verification.
- PDF signature validation waits for the Owner to review and accept ADR-0021 (Proposed). It clarifies ADR-0018 Decision 1 for a bounded 1024-byte prefix read.

## 9. Current open issues

- PDF magic-byte validation (GitHub issue).
- Orphan-object reconciliation (GitHub issue).
- Full-database backup that works with FORCE RLS is unsolved. Never weaken RLS to fix it.
- ADR-0013 is still Proposed.
- Scaleway access key expires 2027-09-20. Object Storage free trial ends 2026-12-19.
- Three other high dependency advisories were deliberately left unchanged.
- `docs/STATUS.md` is partly stale.

## 10. Current ADR state

- Accepted: 0001 to 0009, 0011, 0012, 0014 to 0018, 0020.
- Proposed: 0013, 0021.
- 0010 is reserved and unwritten.
- 0019 (AI provider selection) is Proposed. Its draft is in PR #75 and is not on `main`.
- 0021 (bounded prefix read for file-type validation) is Proposed. It clarifies ADR-0018 Decision 1 without editing it.
- Accepted ADRs are never edited. A change is a new ADR (charter section 10).

## 11. AI provider status

No provider is selected. No AI SDK, API key or vendor environment variable exists in the repository. ADR-0007 sets constraints only and names no vendor.

## 12. Mistral status

Under contractual verification, not selected. Per the Owner's correspondence (not verifiable from the repository):

- No-training: partially verified.
- Strict EU/EEA residency: not fully verified.
- Health and Article 9 data cover: not verified.
- Zero Data Retention: verification required.

## 13. What must NOT be changed

- Do not weaken RLS, and do not use `NO FORCE ROW LEVEL SECURITY`.
- Do not edit ADR-0007 or ADR-0019, or accept ADR-0019.
- Do not add AI, RAG, embeddings or extraction code, or any AI dependency.
- Do not create a production demo or test staff identity or password.
- Do not put secrets, credentials or patient data in the repository.
- Do not apply ad-hoc production DDL. Use the repository migration runner.
- Do not add a structured Service entity or expand the roadmap silently.

## 14. Current next action

1. The Owner reviews and accepts ADR-0021.
2. The agent then presents an implementation plan for PDF signature validation at completion only (strict policy: `%PDF-1.0` to `%PDF-1.7` or `%PDF-2.0` at offset 0; `IfMatch` with the HeadObject ETag).
3. Nothing is implemented until the Owner authorizes the code change.

## 15. Last verified state and date

Verified by repository inspection on 2026-10-04. `main` was at `cb8c6b8` (2026-09-20). Test counts were not re-run; the last reported count was 319 at Slice 1B.

## CLAUDE CODE / EXECUTION READINESS

- Current need: OPTIONAL for documentation. STRONGLY RECOMMENDED for the PDF signature implementation.
- Reason: documentation and single-file changes are practical through the GitHub web editor. The PDF change touches several source files plus new and changed tests, and test results arrive only after pushing, through CI.
- Next point where a coding agent would materially save time: the PDF signature validation change (several source files plus new and changed test files), and any later slice with migrations or many files.
- Manual GitHub or browser execution: practical for documentation only. Not practical for multi-file code with test iteration.
- Should the next major phase wait for Claude Code: yes for P5 retrieval and AI work, which is also blocked by ADR-0019.
- A chat assistant cannot send reminders or alerts on its own. When a task needs a coding agent, it must say so at the start of its reply.
