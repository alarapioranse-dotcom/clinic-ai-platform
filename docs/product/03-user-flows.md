# User Flows

Each flow shows decision points and failure branches — a flow with only a happy path is
incomplete by definition for this document. These describe user-visible behavior only; no flow
here implies a particular database, API, or AI pipeline design (those are Deliverables B and C).

## Clinic sign-up and first-run setup

```mermaid
flowchart TD
    A["Owner visits marketing site"] --> B["Starts sign-up"]
    B --> C["Enters clinic name, contact, owner email"]
    C --> D{"Email already registered?"}
    D -->|"Yes"| E["Show 'an account already exists', link to login"]
    E --> Z1(("End: redirected to login"))
    D -->|"No"| F["Send verification email"]
    F --> G{"Owner verifies within link lifetime?"}
    G -->|"No, link expired"| H["Offer to resend verification email"]
    H --> F
    G -->|"Yes"| I["Owner sets password"]
    I --> J{"Password meets policy?"}
    J -->|"No"| K["Show inline requirement, ask again"]
    K --> I
    J -->|"Yes"| L["Owner enters clinic profile: hours, services, prices, location"]
    L --> M{"Profile save succeeds?"}
    M -->|"No, backend unavailable"| N["Show retry, preserve entered data"]
    N --> L
    M -->|"Yes"| O["Clinic record created; owner lands on empty dashboard"]
    O --> Z2(("End: clinic onboarded"))
```

## Inviting a staff member

```mermaid
flowchart TD
    A["Owner/Admin opens Staff page"] --> B["Selects 'Invite staff member'"]
    B --> C["Enters email and role"]
    C --> D{"Already invited or already a member?"}
    D -->|"Yes"| E["Show 'already invited/member', no duplicate sent"]
    E --> Z1(("End: no action taken"))
    D -->|"No"| F["Send invitation email"]
    F --> G{"Invitation email sends successfully?"}
    G -->|"No, provider/backend unavailable"| H["Show retry; invite not marked sent"]
    H --> F
    G -->|"Yes"| I["Invitee opens invite link"]
    I --> J{"Link still valid?"}
    J -->|"No, expired or already used"| K["Show 'invite no longer valid', ask admin to resend"]
    K --> Z2(("End: invite must be resent"))
    J -->|"Yes"| L["Invitee sets password"]
    L --> M["Invitee joins clinic, scoped to that clinic's data"]
    M --> Z3(("End: staff member active"))
```

## Creating and rescheduling an appointment

```mermaid
flowchart TD
    A["Staff opens Appointments"] --> B{"New or existing appointment?"}
    B -->|"New"| C["Select or create patient record"]
    C --> D["Select service and practitioner"]
    D --> E["Select an available slot"]
    B -->|"Reschedule existing"| F["Open the existing appointment"]
    F --> G{"Appointment already past or cancelled?"}
    G -->|"Yes"| H["Block action: 'cannot reschedule a past/cancelled appointment'"]
    H --> Z1(("End: no change made"))
    G -->|"No"| E
    E --> I{"Slot still available at confirmation?"}
    I -->|"No, taken concurrently"| J["Show updated availability, ask staff to pick again"]
    J --> E
    I -->|"Yes"| K{"Save succeeds?"}
    K -->|"No, backend unavailable"| L["Show retry, no booking made"]
    L --> E
    K -->|"Yes"| M["Appointment booked/updated; prior slot released if rescheduling"]
    M --> N["Patient notified of the confirmed time"]
    N --> Z2(("End: schedule updated"))
```

## Uploading a knowledge document

```mermaid
flowchart TD
    A["Owner/Admin opens Knowledge Base"] --> B["Selects 'Upload document'"]
    B --> C["Chooses a file"]
    C --> D{"File type supported?"}
    D -->|"No"| E["Reject: 'unsupported file type'"]
    E --> B
    D -->|"Yes"| F{"File within size limit?"}
    F -->|"No"| G["Reject: 'file too large'"]
    G --> B
    F -->|"Yes"| H["Upload document"]
    H --> I{"Upload succeeds?"}
    I -->|"No, backend unavailable"| J["Show retry; no partial document left in the list"]
    J --> H
    I -->|"Yes"| K["Document appears in list as 'Processing'"]
    K --> L["Document becomes 'Ready' for the assistant to use"]
    L --> Z(("End: assistant can draw on this document"))
```

## A patient conversation ending in a booking

```mermaid
flowchart TD
    A["Patient sends a message"] --> B["Assistant reads the clinic's own data to interpret intent"]
    B --> C{"Intent is a booking request?"}
    C -->|"No, different administrative question"| D["Assistant answers from clinic data"]
    D --> Z1(("End: question answered"))
    C -->|"Yes"| E{"Clinic has a matching available slot?"}
    E -->|"No"| F["Assistant offers next-best alternatives, or hands off to staff"]
    F --> Z2(("End: alternative offered or handed off"))
    E -->|"Yes"| G["Assistant proposes a specific slot"]
    G --> H{"Patient response?"}
    H -->|"No response within the clinic's inactivity window"| I["Conversation stays open; staff notified"]
    I --> Z3(("End: awaiting patient or staff"))
    H -->|"Asks a clinical question instead"| J["Assistant declines and hands off to staff"]
    J --> Z4(("End: escalated"))
    H -->|"Confirms the slot"| K{"Booking save succeeds?"}
    K -->|"No, backend unavailable"| L["Tell patient the booking could not be completed; offer to retry"]
    L --> G
    K -->|"Yes"| M["Appointment booked; confirmation sent to patient"]
    M --> Z5(("End: booked"))
```

## A patient conversation that must escalate to a human

```mermaid
flowchart TD
    A["Patient sends a message"] --> B{"Message indicates a medical emergency?"}
    B -->|"Yes"| C["Assistant immediately directs patient to emergency services"]
    C --> Z1(("End: emergency guidance given, no booking attempted"))
    B -->|"No"| D{"Clinical question, ungroundable in clinic data, or patient asks for a human?"}
    D -->|"No"| E["Assistant continues administrative handling"]
    E --> Z2(("End: handled without escalation"))
    D -->|"Yes"| F["Assistant declines to answer, marks conversation 'needs staff'"]
    F --> G["Patient receives acknowledgement that a team member will follow up"]
    G --> H{"Staff available now?"}
    H -->|"No, outside working hours"| I["Conversation queued; staff notified at next opening"]
    I --> Z3(("End: queued for staff"))
    H -->|"Yes"| J["Staff member opens the conversation and replies directly"]
    J --> Z4(("End: resolved by a human"))
```
