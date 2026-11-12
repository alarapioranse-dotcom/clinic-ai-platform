/**
 * Text of the public home page, header and footer (ADR-0029). This English
 * module defines the contract: the Arabic and Greek modules are typed against
 * it, so a missing or misspelled key fails `npm run typecheck`.
 *
 * Every statement must stay true of the deployed service. The phase statuses
 * in `launch.phases` follow the "Status" list in README.md.
 */
export const en = {
  nav: {
    label: 'Main navigation',
    howItWorks: 'How it works',
    capabilities: 'Capabilities',
    launchStatus: 'Launch status',
  },
  hero: {
    badge: 'Pre-launch',
    title: "From a patient's message to a booked appointment",
    subtitle:
      'A multi-clinic AI platform that answers patients, books appointments and manages the clinic knowledge base, all in one place.',
    demoLabel: 'Illustration: a patient message becoming a booked appointment',
    incomingLabel: 'Incoming patient message',
    incomingMessage: '“Hello, I need a dental appointment at the earliest available time, please.”',
    scheduleLabel: "Today's clinic schedule",
    slotTimes: ['09:00', '09:30', '10:00', '10:30', '11:00'],
    slotFree: 'Free',
    slotBooked: 'Booked',
  },
  how: {
    eyebrow: 'How it works',
    title: 'Three steps from message to appointment',
    description: 'A simplified view of the core flow the platform is being built around.',
    steps: [
      {
        number: '01',
        title: 'The patient writes',
        description:
          "The patient's message arrives through the clinic's channel and is kept in the conversation record.",
      },
      {
        number: '02',
        title: 'The need is understood',
        description:
          "The patient's intent is identified: a question, a booking request, or a question about a service answered from the clinic knowledge base.",
      },
      {
        number: '03',
        title: 'The appointment is booked',
        description:
          'The earliest available time in the clinic schedule is proposed and the appointment is confirmed with the patient.',
      },
    ],
  },
  capabilities: {
    eyebrow: 'Capabilities',
    title: 'What the platform offers your clinic',
    description: 'An overview of what the platform is designed to do as its phases are delivered.',
    items: [
      {
        title: 'Answering patients',
        description: 'Manage patient conversations from one place.',
      },
      {
        title: 'Booking appointments',
        description:
          "Connect patient requests to the clinic's real schedule and propose the earliest available time.",
      },
      {
        title: 'Clinic knowledge base',
        description: 'One source for each clinic’s services, prices and working hours.',
      },
      {
        title: 'Multi-clinic support',
        description:
          'Each clinic manages its own data and conversations separately inside the same platform.',
      },
    ],
  },
  launch: {
    eyebrow: 'Launch status',
    title: 'Where we are now',
    description:
      'The phases of building the platform, from the technical foundation to AI replies.',
    statusLabels: { done: 'Done', 'in-progress': 'In progress', planned: 'Planned' },
    phases: {
      p0: {
        title: 'Phase 0 — Technical foundation',
        description: 'Project structure, design and development tooling.',
      },
      p1: {
        title: 'Phase 1 — Multi-clinic data',
        description: 'A shared database with each clinic’s data isolated.',
      },
      p2: {
        title: 'Phase 2 — Sign-in and roles',
        description: 'Sign-in and role management for the clinic team.',
      },
      p3: {
        title: 'Phase 3 — Patient conversations',
        description: 'Receiving and answering patient messages in one conversation record.',
      },
      p4: {
        title: 'Phase 4 — Appointment booking',
        description: 'Connecting conversations to the clinic schedule and confirming appointments.',
      },
      p5: {
        title: 'Phase 5 — Knowledge base and AI',
        description:
          'Replies grounded in each clinic’s own knowledge. Document upload is built; AI replies are not yet.',
      },
    },
  },
  footer: {
    rights: 'All rights reserved.',
    privacy: 'Privacy notice',
  },
};

export type MarketingDictionary = typeof en;
