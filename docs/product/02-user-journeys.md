# User Journeys

Each journey below is a narrative walkthrough, not a technical flow — see
[`03-user-flows.md`](./03-user-flows.md) for the step-by-step mechanics and failure branches. Each
journey ends by naming the single moment where the product either earns the person's trust or
loses it for good.

## Onboarding a new clinic

The clinic owner hears about the product from another clinic owner, or finds it looking for a way
to stop losing patients to unanswered messages. They sign up, name their clinic, and are asked for
the handful of facts a patient asks about every day: hours, services, prices, location. They
connect the channel patients already message them on. Within the same session, they see what a
patient would see if they asked a question right now — before a single real patient has written
in.

**The trust moment:** the first time the owner sees the assistant answer _using the clinic's own
words_ — its actual hours, its actual prices — rather than something generic. If that first answer
feels off, generic, or wrong, the owner assumes every future answer will be too, and disengages
before the product gets a real chance.

## A receptionist's full working day

The receptionist opens the dashboard at the start of the day and sees what came in overnight:
questions the assistant already answered, plus a short list of conversations it flagged for a
person. She clears those first. Through the day, new messages arrive; most resolve themselves
without her, but she keeps a background eye on the flagged list, because that's the part of her
job the product hasn't taken over. When a patient calls instead of messaging, she can still see and
update the same schedule the assistant is booking into, so nothing she does by phone becomes
invisible to it.

**The trust moment:** the first time she notices the assistant handed off a conversation _it
should have_ handed off — a question it correctly recognized it couldn't safely answer — rather
than guessing. That's the moment she stops re-checking its work and starts treating the flagged
list as the whole job.

## A practitioner checking tomorrow's schedule

Before leaving for the day, or first thing in the morning, the practitioner opens the schedule for
tomorrow. They see who's booked, at what time, for what — including anything a patient booked
themselves through the assistant overnight, with no receptionist involved in getting it onto the
schedule.

**The trust moment:** the first time a booking they didn't personally see get made — one the
assistant closed with a patient directly — turns out to be exactly right when the patient shows
up. One wrong or missing booking here, and the practitioner goes back to confirming the schedule
with the front desk every single day, permanently.

## A patient asking a question at 11pm and getting a booked slot

A patient messages the clinic at 11pm, well after anyone is at the front desk, asking whether the
clinic has an opening this week for a specific service. The assistant checks the clinic's actual
schedule, confirms an opening, and offers the patient a specific time. The patient confirms. The
appointment exists on the clinic's schedule before the clinic opens the next morning — no one
stayed late, no one had to be woken up.

**The trust moment:** the moment between the patient confirming a time and receiving confirmation
back. If that confirmation is immediate and unambiguous, the patient has just learned this clinic
answers at any hour, which is the entire premise of the product. If it's slow, uncertain, or the
slot turns out not to have actually been held, the patient has just learned the opposite, and will
call to double-check every future booking instead of trusting the assistant again.
