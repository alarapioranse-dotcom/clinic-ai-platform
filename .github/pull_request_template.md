## Summary

<!-- What does this change do, and why? -->

## Checklist

- [ ] `npm run format:check` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] Route files (`src/app/**`) only compose — no business logic added there
- [ ] No feature (`src/features/*`) imports another feature's internals
- [ ] `process.env` is not read outside `src/lib/env.ts`

## Test plan

<!-- How did you verify this change? -->
