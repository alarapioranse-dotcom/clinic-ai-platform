# AI Pipeline

Covers what [`docs/domain/00-overview.md`](../domain/00-overview.md) names as deferred to C: "The
AI pipeline: retrieval, prompting, grounding, model choice." Model/vendor choice is explicitly
**not** made here — see the last section of this document and Open Question 2 in
[`07-open-questions.md`](./07-open-questions.md). What this document fixes is the pipeline's
stages, what each stage is allowed to decide, and the interface boundary the roadmap already
requires.

## Constraints this pipeline must satisfy, restated (not re-decided)

- [Charter §3](../governance/project-charter.md): "The assistant answers administrative questions
  only... It never answers clinical questions, even when asked directly," and "A clinic's own data
  is the only source of truth for an answer. If the data isn't there, the answer isn't given."
- [Charter §6](../governance/project-charter.md): "An agent that cannot ground an answer in the
  clinic's own data hands off — it does not guess," and "Agent output is untrusted until a human
  reviews and approves it" — the last point is why every Assistant-authored reply is a `Message`
  row like any other, not a separate trusted channel.
- [Roadmap P5](../03-roadmap.md): "Automated replies to patients are grounded in that clinic's
  knowledge base," and "AI/LLM calls are isolated behind an interface so the provider can change
  without touching call sites."
- Escalation's four reasons are fixed by B, not this document:
  `clinical-question`, `medical-emergency`, `ungroundable-answer`, `patient-requested-human`
  ([`docs/domain/01-entities.md`](../domain/01-entities.md), Escalation).

## Pipeline stages

```text
Patient message arrives
        │
        ▼
1. INTAKE
   Persist the inbound Message (sender_type = 'patient') on the Patient's Conversation,
   creating both if this is the Patient's first contact (B: Patient/Conversation creation
   rules). Runs before any AI call — a failed AI call must never lose the patient's message.
        │
        ▼
2. PRE-CHECK (deterministic, no model call)
   - Medical emergency keyword/pattern match → skip directly to ESCALATE
     (reason = 'medical-emergency'). B: this is the one escalation reason where the Assistant
     acts alone, informationally, with no staff acknowledgement gating the reply — the
     pre-check's job is exactly to make this path fast and not dependent on model latency.
   - Explicit request for a human ("I want to talk to a person") → ESCALATE
     (reason = 'patient-requested-human').
        │ (neither matched)
        ▼
3. RETRIEVE
   Similarity search over this Clinic's KnowledgeDocuments WHERE status = 'ready' only
   (B, KnowledgeDocument aggregate: "may only draw on a document while Ready" — enforced here,
   at the one place B says it belongs, not in the KnowledgeDocument schema itself). Scoped by
   clinic_id like every other tenant-scoped read in this system — see
   06-knowledge-document-storage.md for what's actually being searched.
        │
        ▼
4. CLASSIFY + GENERATE (the one stage that calls the LLM, via the interface below)
   Given the retrieved passages and the conversation history, the model either:
     a) produces a grounded answer citing retrieved content, or
     b) determines the question is clinical (charter §3's hard refusal), or
     c) determines no retrieved content actually answers the question (ungroundable).
        │
        ├─ (a) grounded answer ──────────────► 5a. REPLY
        ├─ (b) clinical question ────────────► 5b. ESCALATE (reason = 'clinical-question')
        └─ (c) nothing grounds an answer ─────► 5b. ESCALATE (reason = 'ungroundable-answer')
        │
        ▼
5a. REPLY                                   5b. ESCALATE
    Persist a Message                           Persist an Escalation (raised) on the
    (sender_type = 'assistant').                Conversation; Conversation status →
    Conversation stays 'assistant_handling'.     'needs_staff' (enforced together by the
                                                  trigger in 01-database-schema.md — the
                                                  pipeline issues both writes in one
                                                  transaction and relies on the trigger to
                                                  reject a mismatched pair, not on its own
                                                  discipline alone).
```

Every arrow into `ESCALATE` lands on the same code path regardless of which stage produced it —
there is exactly one place in the codebase that raises an Escalation and flips Conversation status,
so the invariant in [`01-database-schema.md`](./01-database-schema.md) only ever has one caller to
reason about.

## Why classification and generation are one stage, not two

Stage 4 is deliberately a single model call rather than "classify, then generate": a two-call
design would let the classifier and generator disagree (e.g., classifier says "administrative,"
generator produces a clinical-sounding answer anyway), which is exactly the kind of daylight
charter §6's "agent output is untrusted until reviewed" is meant to catch downstream, not create
upstream. A single call that returns a structured decision (`{ outcome: 'answer' | 'clinical' |
'ungroundable', content?, citedDocumentIds? }`) keeps the refusal and the answer as one atomic
model decision.

## The provider-agnostic interface (roadmap P5's requirement)

```typescript
// Illustrative shape only — this is documentation, not a src/ file.
interface AssistantProvider {
  classifyAndRespond(input: {
    conversationHistory: MessageSummary[];
    retrievedPassages: RetrievedPassage[];
  }): Promise<
    | { outcome: 'answer'; content: string; citedDocumentIds: string[] }
    | { outcome: 'clinical' }
    | { outcome: 'ungroundable' }
  >;
}
```

Every call site in Stage 4 depends on `AssistantProvider`, never on a specific vendor's SDK
directly — this is the concrete realization of roadmap P5's "AI/LLM calls are isolated behind an
interface so the provider can change without touching call sites," and it is what makes Open
Question 2 genuinely deferrable: the pipeline above is fully specified without knowing which
implementation of this interface is chosen.

## What this document deliberately does not decide

- **Which model/vendor implements `AssistantProvider`.** Cost, Arabic-language quality, and the
  fact that Conversation/Message content is GDPR Article 9 Special Category Data by default
  ([`docs/domain/01-entities.md`](../domain/01-entities.md)) all bear on this choice, and none of
  them is settled by this document — see Open Question 2 in
  [`07-open-questions.md`](./07-open-questions.md).
- **Prompt content itself.** The interface above fixes what goes in and what comes out; the actual
  system prompt enforcing charter §3's administrative-only boundary is implementation detail behind
  `AssistantProvider`, reversible without touching this pipeline's shape, and not written here.
- **Retrieval's embedding/similarity mechanics** — see
  [`06-knowledge-document-storage.md`](./06-knowledge-document-storage.md) and Open Question 3.
