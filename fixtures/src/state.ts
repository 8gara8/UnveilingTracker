// The weekly Pace state the metrics fixtures were computed from (SPEC §4.7, §5.4, §4.12 "Fixtures and tests"): `fixtures/state/pace-weekly.json`, in the
// layout of `content/state/pace-weekly.json`. It is the state as the weekday's run (2026-10-14) leaves it, every ISO week from 2015-01-05 to its data
// cutoff (the Sunday 2026-10-11), the newest 8 provisional and fetched that day, so it is the state `fixtures/metrics/weekday.json` was built from and the
// one P2's metrics tests (`npm run metrics -- --recompute`) read.
//
// It is NOT byte-identical to the sample content's copy (`fixtures/site-content/state/pace-weekly.json`, written by `site.ts`): that one is the state as
// the last run of the sample week (2026-10-18) leaves it, so its `updated` and the `fetched` date of its provisional weeks and newest firm week are 2026-10-18. The two hold
// the same weeks with the same counts (a week's counts depend only on its Monday, `paceWeeks()` in `inputs.ts`), and differ in the `fetched` date
// of the 8 provisional weeks and the newest firm week, which that morning refetched (`morningLeavesIt()`), as well as in `updated`.
//
// New for this project (Cyber's fixtures/src/ has no weekly state).

import { addDays } from "../../lib/dates";
import { jsonText } from "../../lib/json";
import { dataCutoff } from "../../lib/metrics/pace";
import { PaceWeeklyFile } from "../../lib/schema/metrics";
import type { Output } from "./build";
import { paceState } from "./inputs";
import { EDITIONS } from "./world";

/** The one file, relative to the repo root. */
export const PACE_STATE_PATH = "fixtures/state/pace-weekly.json";

/**
 * A weekly state as the morning it names (`updated`) leaves it, when the series has run every morning (SPEC §5.4). That morning refetched the
 * 8 provisional weeks and the newest firm week (36 requests, what `metrics/inputs/D.json` lists), so those carry its date. A week's last
 * morning is 64 days after its Sunday, 70 after its Monday, and the morning refetches any older firm week fetched before that day, so each
 * older firm week carries that day exactly: none was fetched too early and none is owed a refetch. (`paceWeeks()` of `inputs.ts` dates a firm
 * week 63 days after its Monday, the last morning it was provisional: a day short of the rule, which would send the morning after to refetch
 * up to 13 old weeks a day for months. Its provisional weeks are right, and its counts are used as they are.)
 */
export function morningLeavesIt(state: PaceWeeklyFile): PaceWeeklyFile {
  const newestFirm = state.weeks.filter((w) => !w.provisional).at(-1);
  return PaceWeeklyFile.parse({
    ...state,
    weeks: state.weeks.map((w) => ({ ...w, fetched: w.provisional || w === newestFirm ? state.updated : addDays(w.week_start, 70) })),
  });
}

/** The state as the weekday edition's run leaves it. */
export function weekdayPaceState(): PaceWeeklyFile {
  const date = EDITIONS.weekday.date;
  return morningLeavesIt(paceState(dataCutoff(date), date));
}

/** The builder's generator for `fixtures/state/`: the one file, byte-stable. */
export function stateOutputs(): Output[] {
  return [{ path: PACE_STATE_PATH, text: jsonText(weekdayPaceState(), PaceWeeklyFile) }];
}
