# Relationships

## Ownership and cardinality

| Relationship                                  | Cardinality | Ownership                                                                         |
| --------------------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| Clinic → Service                              | 1 to many   | Clinic owns Service (contained in the Clinic aggregate).                          |
| Clinic → StaffMember                          | 1 to many   | Clinic is referenced by StaffMember; StaffMember is its own aggregate.            |
| Clinic → Invitation                           | 1 to many   | Clinic is referenced by Invitation; Invitation is its own aggregate.              |
| Clinic → Patient                              | 1 to many   | Clinic is referenced by Patient; Patient is its own aggregate.                    |
| Clinic → KnowledgeDocument                    | 1 to many   | Clinic is referenced by KnowledgeDocument; its own aggregate.                     |
| Patient → Conversation                        | 1 to many   | Patient is referenced by Conversation; Conversation is its own aggregate.         |
| Patient → Appointment                         | 1 to many   | Patient is referenced by Appointment; Appointment is its own aggregate.           |
| Conversation → Message                        | 1 to many   | Conversation owns Message (contained internal entity).                            |
| Conversation → Escalation                     | 1 to many   | Conversation owns Escalation (contained internal entity, zero or more over time). |
| Service → Appointment                         | 1 to many   | Service is referenced by Appointment; not owned by it.                            |
| StaffMember (practitioner role) → Appointment | 1 to many   | StaffMember is referenced by Appointment; not owned by it.                        |

Every "1 to many" here is read as "one of the left side may be associated with many of the right
side, and each instance of the right side associates with exactly one of the left" — no
many-to-many relationship exists anywhere in this model. A many-to-many would most plausibly arise
if a Practitioner could deliver more than one Service per Appointment, or if an Appointment could
have more than one Practitioner; neither is described by any flow, so neither is modeled (see the
assumption on Appointment in [`01-entities.md`](./01-entities.md)).

## Relationships crossing tenant boundaries

**None.** Every relationship above pairs two entities that carry the same owning Clinic:

- Service, StaffMember, Invitation, Patient, and KnowledgeDocument all reference their Clinic
  directly.
- Conversation and Appointment don't reference Clinic directly, but inherit it transitively —
  through Patient. Message and Escalation inherit it again through Conversation.
- An Appointment's Service and its practitioner StaffMember must belong to the same Clinic as the
  Appointment's Patient; nothing in this model permits assembling an Appointment from parts
  belonging to different clinics.

This is safe by construction, not by a runtime check this document is describing: the model simply
never defines a relationship between two entities without a common Clinic ancestor. That is the
domain-level counterpart to [ADR-0003](../adr/0003-multi-tenancy-model.md)'s Row Level Security —
RLS is the database enforcing what this model already refuses to represent. See
[`06-multi-tenancy.md`](./06-multi-tenancy.md) for how tenant ownership propagates through these
relationships in more detail.
