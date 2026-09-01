# ADR-0011: Regulatory Scope Boundaries

- Status: Proposed
- Date: 2026-09-01
- Deciders: Ahmed (owner)
- Related: ADR-0005, ADR-0007, ADR-0009; charter §1 and §7; issues #16, #17

## Context

ADR-0009 fixed EU/EEA-only residency with GDPR as the sole privacy regime, and the
charter amendment (#19, merged in #21) scoped this codebase to the EU/EEA market.
What remains undefined is which EU regulatory regimes apply to the product itself,
and which product behaviours would move it into a regime this project is not
equipped to enter. Without a written and enforced boundary, incremental scope creep
during P5 (knowledge base and AI) could silently change the product's legal
classification.

## Decision

### 1. Applicable regimes

| Regime | Our role | Note |
|---|---|---|
| GDPR (EU) 2016/679 | Processor; the clinic is controller | Art. 9 health data; Art. 28 DPA required (#17) |
| AI Act (EU) 2024/1689 | Provider of a non-high-risk AI system | Art. 50(1) transparency duty applies now |
| ePrivacy + national cookie rules | Operator | Web chat widget and marketing site |
| Member State health-secrecy law (via GDPR Art. 9(4)) | Processor | e.g. §203 StGB in DE; open item |

### 1a. AI Act timeline (as of 2026-09-01)

Article 50 transparency obligations have applied since 2 August 2026 and are
enforceable by national competent authorities. They were not amended by the AI
Omnibus, Regulation (EU) 2026/1744 (in force 27 July 2026), which deferred only
the high-risk regime: Annex III to 2 December 2027, Annex I to 2 August 2028.
Article 50 applies regardless of risk classification. Penalties reach EUR 15
million or 3% of worldwide annual turnover, whichever is higher.

Consequence: the Annex III deferral gives headroom only if a one-way door in
section 4 is ever opened. It gives none for disclosure, which is due now.

### 2. Explicitly out of scope

- **MDR (EU) 2017/745.** The software has no medical purpose: it does not
  diagnose, triage, monitor, predict, prognose, or recommend treatment. Per
  MDCG 2019-11, software limited to administrative and scheduling functions and
  to retrieving stored records is not a medical device.
- **AI Act Annex III (high-risk)**, including point 5(d) emergency triage: the
  system performs no triage, no urgency scoring, and no dispatch decisions.
- **HIPAA, UK GDPR, and Gulf regimes**: no market presence. Gulf market is a
  separate future product per #19.
- **NIS2**: not applicable at current size. Revisit if the company exceeds
  medium-enterprise thresholds or a Member State designates it.

### 3. Product boundaries that keep section 2 true (normative)

- **B1** No collection of symptoms for clinical purposes; no severity or urgency
  scoring; no triage ordering of patients.
- **B2** No generated medical content. The AI returns clinic-authored content as
  quoted material with attribution, or escalates. It never composes health advice.
- **B3** A human escalation path is available in every channel at all times.
- **B4** AI identity is disclosed at the start of every patient conversation and
  whenever asked (AI Act Art. 50(1)).
- **B5** No emergency handling. Emergency signals return a fixed, non-generated
  message plus immediate escalation.
- **B6** No clinical decision support to staff.

### 4. One-way doors

Each of the following requires its own ADR, approved before any code:
symptom triage, urgency scoring, any generated (non-quoted) health advice,
integration with diagnostic devices or clinical EHR modules, or entry into a
non-EU market. These would likely trigger MDR Rule 11 (Class IIa, notified body
plus QMS) and/or AI Act high-risk obligations.

### 5. Verification gate

Before the first paying clinic goes live, an external EU regulatory adviser must
confirm the MDR exclusion and the AI Act classification in writing. This ADR is
engineering scope-setting, not legal advice.

### 6. Enforcement mechanisms (normative)

The boundaries in section 3 are not satisfied by prompt instructions. A prompt is
persuasion, not a constraint, and leaves no evidence of compliance. Each boundary
MUST be enforced by a structural mechanism with a test:

- **E1 Closed intent schema.** Model output MUST validate against a closed enum
  of intents: book, reschedule, cancel, hours, price, location, quote, escalate.
  Any output failing validation is discarded and replaced by the escalation
  response. No intent representing assessment, ranking, or advice may exist.
- **E2 Verbatim-span check.** A `quote` response MUST be a contiguous span of a
  clinic-authored source document, verified by exact match against the stored
  source, with the source id returned. Non-matching spans are blocked.
- **E3 Pre-model input gate.** A deterministic detector routes symptom and
  emergency signals to a fixed non-generated message plus escalation before the
  model is invoked.
- **E4 Transport-level disclosure.** The AI disclosure required by Art. 50(1) is
  emitted by the channel adapter as the first message of every patient session.
  A session cannot open without it. Emission is logged with a timestamp and
  retained as compliance evidence.
- **E5 CI boundary suite.** A red-team corpus of patient messages attempting to
  elicit triage, dosage, diagnosis, or urgency ranking MUST pass in CI. A failing
  case blocks merge.
- **E6 Change control.** The
