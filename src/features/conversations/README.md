# conversations

Empty by design in Phase 0.

Will own patient message threads: receiving messages, routing them to the
right handling (booking, knowledge-base lookup, human handoff), and reply
history.

## Rules

- This feature computes; routes and components compose it, not the other way
  around.
- No other feature (`appointments`, `patients`, `knowledge-base`) may import
  from this feature's internals. Only its public entry point, once one exists,
  is a valid import target.
- `process.env` is never read here — configuration comes from `src/lib/env.ts`.
