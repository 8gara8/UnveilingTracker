import { taipeiTime } from "../../lib/dates";

// The run's clock (SPEC §8.2 "Clock rules"). Every record time, limit and budget is measured on one clock,
// `Deps.now` (Date.now in production). Code that measures with the real clock (git(), the metrics
// deadline, fetchFeed()) gets its deadline converted by realDeadline(). In tests the clock is testClock(),
// which starts at a chosen Taipei time and advances with real time, so a fixed 10 s timeout and a logical
// deadline stay comparable. Cyber's scripts/lib/clock.ts at the fork commit, adapted: the --no-deadline
// gaps are this project's (docs/PROVENANCE.md).

/** Epoch milliseconds. */
export type Clock = () => number;

export const MIN = 60_000;

/**
 * A deadline on clock `now`, converted for code that measures with Date.now():
 * Date.now() + (logical − now()). An infinite deadline stays infinite.
 */
export function realDeadline(now: Clock, logicalMs: number): number {
  if (logicalMs === Number.POSITIVE_INFINITY || logicalMs === Number.NEGATIVE_INFINITY) return logicalMs;
  return Date.now() + (logicalMs - now());
}

/** The test clock: starts at startMs and advances with real time; jump(ms) moves it forward, set(ms) sets it. */
export interface TestClock extends Clock {
  jump(ms: number): void;
  set(ms: number): void;
}

export function testClock(startMs: number): TestClock {
  let offset = startMs - Date.now();
  const clock = (() => Date.now() + offset) as TestClock;
  clock.jump = (ms: number) => {
    if (!Number.isFinite(ms) || ms < 0) throw new Error(`testClock.jump: expected a finite ms of 0 or more, got ${ms}`);
    offset += ms;
  };
  clock.set = (ms: number) => {
    if (!Number.isFinite(ms)) throw new Error(`testClock.set: expected a finite epoch ms, got ${ms}`);
    offset = ms - Date.now();
  };
  return clock;
}

/** "HH:MM" Taipei of an epoch ms. */
export function hhmm(ms: number): string {
  return taipeiTime(new Date(ms));
}

/**
 * §8.2's TIMEOUTS, which tests pin (P3's daily.ts re-exports them as TIMEOUTS): Cyber's values, except the
 * two --no-deadline gaps. The values config/run.json also holds (agent 30 min, the Chinese pass 12 min,
 * repairs, attempts, the publish reserve 4 min, the deploy wait 8 min, web fetches) are read from the
 * config at run time; these are the fixed ones. P3 checks each against SPEC §8.2 before daily.ts uses it.
 */
export const P3_LIMITS = {
  gitMs: 60_000,
  collectMs: 5 * MIN,
  metricsMs: 3 * MIN,
  snapshotRoundMs: 3 * MIN,
  snapshotReserveMs: 4 * MIN,
  repairMaxMs: 6 * MIN,
  repairFloorMs: 2 * MIN,
  publishReserveMs: 4 * MIN,
  agentMinMs: 10 * MIN,
  agentMaxMs: 30 * MIN,
  agentReserveMs: 10 * MIN,
  contextReserveMs: 5 * MIN,
  deployPollMs: 20_000,
  deployGetMs: 15_000,
  deployReserveMs: 90_000,
  linksMs: 3 * MIN,
  linksMinLeftMs: 6 * MIN,
  dataOnlyPublishMs: 3 * MIN,
  publishFullMarginMs: 30_000,
  finalCommitMs: 60_000,
  lockStaleMs: 2 * 60 * MIN,
  watchdogGraceMs: 2 * MIN,
  watchdogLateStartMs: 10 * MIN,
  /** --no-deadline: hardStop = start + 75 min, retryCutoff = hardStop − 35 min, zhStartBy = hardStop − 20 min (SPEC §8.2). */
  noDeadlineMs: 75 * MIN,
  noDeadlineRetryGapMs: 35 * MIN,
  noDeadlineZhGapMs: 20 * MIN,
  /** A run that starts at most this long before the news window ends (03:15) waits for it; earlier, it skips (SPEC §8.2 "Too early", Cyber's §0.4 row 185). */
  windowWaitMs: 15 * MIN,
  cliVersionMs: 30_000,
  keychainMs: 10_000,
  netProbeMs: 10_000,
  lsRemoteMs: 30_000,
  killGraceMs: 10_000,
  confirmMs: 15_000,
} as const;
