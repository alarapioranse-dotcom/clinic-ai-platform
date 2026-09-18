/**
 * Independent DST-transition discovery for tests. Deliberately NOT built on
 * `src/features/appointments/schedule.ts`'s own offset-resolution logic
 * (`resolveZonedInstant`, its internal `zonedParts`/`offsetMsAt`) — using
 * that code to derive the values a test then asserts against it would make
 * the test tautological (it would only prove the function agrees with
 * itself). This uses a different `Intl` code path — `timeZoneName:
 * 'shortOffset'` string parsing, rather than full date-component
 * round-tripping — to read a zone's real UTC offset at a given instant, then
 * scans/binary-searches for where that offset changes.
 *
 * Tests built on this discover the *actual* transition in whatever tzdata
 * snapshot is running them, rather than asserting against a transition date
 * frozen at authoring time — the fix for the fragility a real DST rule
 * change (Egypt's own DST policy has changed more than once) or a different
 * Node/ICU version on CI would otherwise cause.
 */

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface DstTransition {
  /** Real instant, minute resolution: the last minute still on the "before" offset. */
  lastBeforeMs: number;
  /** Real instant, minute resolution, one minute later: the first minute on the "after" offset. */
  firstAfterMs: number;
  beforeOffsetMinutes: number;
  afterOffsetMinutes: number;
}

/**
 * `timeZone`'s real UTC offset in minutes (positive = ahead of UTC) at `instantMs`, read via
 * Intl's own offset-name formatting — a different code path from schedule.ts's approach of
 * formatting full date/time components and reconstructing the offset from them.
 */
export function rawOffsetMinutes(instantMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' });
  const part =
    formatter.formatToParts(instantMs).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /^GMT([+-]\d{1,2})(?::(\d{2}))?$/.exec(part);
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  return (hours < 0 ? -1 : 1) * (Math.abs(hours) * 60 + minutes);
}

/** `instantMs`'s wall-clock date/time in `timeZone`, via plain Intl date-part formatting. */
export function rawWallClock(instantMs: number, timeZone: string): WallClock {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = formatter.formatToParts(instantMs);
  const value = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

/**
 * Scans forward from `fromMs` in `timeZone`, day by day up to `maxDays`, for the first day whose
 * UTC offset differs from `fromMs`'s, then binary-searches down to minute resolution. Throws if
 * none is found within `maxDays` — callers pick a window generous enough to contain a real
 * transition (most DST-observing zones transition roughly every ~6 months, so 200 days
 * comfortably brackets the next one).
 */
export function findNextDstTransition(
  fromMs: number,
  timeZone: string,
  maxDays = 200,
): DstTransition {
  const dayMs = 24 * 60 * 60 * 1000;
  const startOffset = rawOffsetMinutes(fromMs, timeZone);
  let lowMs = fromMs;
  const loOffset = startOffset;
  let highMs: number | null = null;
  for (let day = 1; day <= maxDays; day++) {
    const candidateMs = fromMs + day * dayMs;
    if (rawOffsetMinutes(candidateMs, timeZone) !== startOffset) {
      highMs = candidateMs;
      break;
    }
    lowMs = candidateMs;
  }
  if (highMs === null) {
    throw new Error(
      `No DST transition found for ${timeZone} within ${maxDays} days of ${new Date(fromMs).toISOString()}`,
    );
  }

  const minuteMs = 60_000;
  let lo = lowMs;
  let hi = highMs;
  while (hi - lo > minuteMs) {
    const mid = lo + Math.floor((hi - lo) / minuteMs / 2) * minuteMs;
    if (rawOffsetMinutes(mid, timeZone) === loOffset) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return {
    lastBeforeMs: lo,
    firstAfterMs: hi,
    beforeOffsetMinutes: loOffset,
    afterOffsetMinutes: rawOffsetMinutes(hi, timeZone),
  };
}

/** Lowercase English weekday name for a `YYYY-MM-DD`-shaped date, matching the same
 * `getUTCDay()`-indexed convention `src/features/appointments/schedule.ts`'s `WEEKDAY_KEYS` uses.
 * Weekday-of-date is a pure calendar fact independent of timezone, so this needs no zone
 * parameter. */
const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export function weekdayKeyOf(wc: { year: number; month: number; day: number }): string {
  const index = new Date(Date.UTC(wc.year, wc.month - 1, wc.day)).getUTCDay();
  return WEEKDAY_NAMES[index]!;
}

/**
 * Like `findNextDstTransition`, but keeps searching past transitions of the wrong direction until
 * it finds one matching `kind` — `'gap'` (offset increases, a spring-forward-shaped transition) or
 * `'overlap'` (offset decreases, a fall-back-shaped transition). Needed because which kind comes
 * first after `fromMs` depends on where in the year `fromMs` falls, which this helper does not
 * assume.
 */
export function findNextDstTransitionOfKind(
  fromMs: number,
  timeZone: string,
  kind: 'gap' | 'overlap',
  maxDays = 200,
  maxTransitions = 6,
): DstTransition {
  let searchFrom = fromMs;
  for (let i = 0; i < maxTransitions; i++) {
    const transition = findNextDstTransition(searchFrom, timeZone, maxDays);
    const isGap = transition.afterOffsetMinutes > transition.beforeOffsetMinutes;
    if ((kind === 'gap') === isGap) {
      return transition;
    }
    searchFrom = transition.firstAfterMs;
  }
  throw new Error(
    `No '${kind}' DST transition found for ${timeZone} within ${maxTransitions} transitions of ${new Date(fromMs).toISOString()}`,
  );
}
