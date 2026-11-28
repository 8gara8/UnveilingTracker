// C and D, computed from the stored findings alone (SPEC §5.5, §5.6, §4.7): C, AI's share of the Landmarks by calendar year from
// 2015, and D, the Hold rate. Both read each finding as `filedAs()` files it on D - 1 (§4.10), since stage 3 computes the metrics
// of D before publish writes D's corrections: a correction dated D counts from the next morning's file and not in D's. Pure: no
// file, no clock, no network; the findings, the corrections, the date and the settings are arguments, and the result holds the
// ids it counted for the inputs manifest (`landmark_ids`, `hold_case_ids`). The two Landmark counts and the Hold rate are shown
// as counts, never as a verdict (§5.5); `ledgerQuotable()` gives their `quotable` figures.
// Cyber's lib/metrics/ has no counterpart: its metrics read exploit and flaw data, not findings.

import { addDays, daysBetween } from "../dates";
import { compareFindingIds } from "../ids";
import { filedAs, hasAiRole, isCounted, type Filable, type FilingCorrection } from "../items";
import { isClaimedRung, isCountedRung, isFellRung, rungAt } from "../rungs";
import type { IsoDate } from "../schema/common";
import { PACE_BASELINE, type Hold, type LandmarkYear, type Landmarks } from "../schema/metrics";
import type { FindingKind, Rung } from "../vocab";
import { fmtInt } from "./stats";

/** The first calendar year of C: 2015, the baseline's first year and the Ledger's. */
export const FIRST_YEAR = Number(PACE_BASELINE.from.slice(0, 4));

/** The last year of the baseline, 2019: the baseline of C is 2015 to 2019 together. */
export const BASELINE_LAST_YEAR = Number(PACE_BASELINE.to.slice(0, 4));

/** The kinds D takes as cases (§5.6): a setback, an infrastructure item or a policy and people item is never one. */
export const HOLD_KINDS = ["result", "capability", "check"] as const satisfies readonly FindingKind[];

/** What C and D read of a stored finding; a `Finding` fits. */
export interface LedgerFinding extends Filable {
  readonly rung: Rung;
  readonly rung_history: readonly { readonly rung: Rung; readonly recorded: IsoDate }[];
  readonly first_published: IsoDate;
  readonly first_brief: IsoDate | null;
  readonly history: boolean;
}

// ── C: AI's share of the Landmarks (§5.5) ────────────────────────────────────────────────────────

/** C as the metrics file holds it, and the ids of the findings it counted. */
export interface LandmarkCount {
  readonly landmarks: Landmarks;
  /** Every finding counted, with or without an AI role, in id order. */
  readonly ids: string[];
}

/**
 * C (SPEC §5.5) for the metrics of `date`: each calendar year from 2015 to the year of `date` (a row for every one, oldest
 * first, even with no Landmark), by the year of `first_published`, counts the findings that `filedAs()` files on `date` - 1 as
 * Landmarks of a kind other than `setback` whose stored rung is counted (`all`), and of those the ones with an AI role (`ai`).
 * A finding first published before 2015 or after the year of `date` is in no row. The baseline is the rows of 2015 to 2019
 * added up.
 */
export function landmarkCounts(findings: readonly LedgerFinding[], corrections: readonly FilingCorrection[], date: IsoDate): LandmarkCount {
  const asOf = addDays(date, -1);
  const rows = new Map<number, { ai: number; all: number }>();
  for (let year = FIRST_YEAR; year <= Number(date.slice(0, 4)); year += 1) rows.set(year, { ai: 0, all: 0 });
  const ids: string[] = [];
  for (const finding of findings) {
    const filed = filedAs(finding, corrections, asOf);
    if (filed.significance !== "landmark" || !isCounted(filed)) continue;
    const row = rows.get(Number(filed.first_published.slice(0, 4)));
    if (row === undefined) continue;
    row.all += 1;
    if (hasAiRole(filed)) row.ai += 1;
    ids.push(filed.id);
  }
  const by_year = [...rows].map(([year, row]) => ({ year, ai: row.ai, all: row.all }));
  const baseline = { ai: 0, all: 0 };
  for (const row of by_year) {
    if (row.year > BASELINE_LAST_YEAR) continue;
    baseline.ai += row.ai;
    baseline.all += row.all;
  }
  return { landmarks: { by_year, baseline }, ids: ids.sort(compareFindingIds) };
}

/** The row of the year of `date` ("5 of 9 in 2026 so far"), or null when C has none. */
export function landmarksThisYear(landmarks: Landmarks, date: IsoDate): LandmarkYear | null {
  const year = Number(date.slice(0, 4));
  return landmarks.by_year.find((row) => row.year === year) ?? null;
}

// ── D: the Hold rate (§5.6) ──────────────────────────────────────────────────────────────────────

/** The settings D reads from `config/run.json`'s `pace` (SPEC §4.11): `min_cases` 30 and `hold_after_days` 182. */
export interface HoldSettings {
  readonly min_cases: number;
  readonly hold_after_days: number;
}

/** D as the metrics file holds it, and the ids of the cases it counted. */
export interface HoldCount {
  readonly hold: Hold;
  /** Every case, held, fell or open, in id order. */
  readonly case_ids: string[];
}

/**
 * True when a finding, already filed as of D - 1, is a case of D on `date` (SPEC §5.6): of kind `result`, `capability` or
 * `check`, with an AI role, not a history entry, first briefed at least `hold_after_days` days before `date`, and
 * claimed or preprint when first briefed, that is, at the last `rung_history` entry recorded on or before `first_brief`.
 */
export function isHoldCase(finding: LedgerFinding, date: IsoDate, settings: Pick<HoldSettings, "hold_after_days">): boolean {
  if (!(HOLD_KINDS as readonly string[]).includes(finding.kind) || !hasAiRole(finding) || finding.history) return false;
  if (finding.first_brief === null || daysBetween(finding.first_brief, date) < settings.hold_after_days) return false;
  const first = rungAt(finding.rung_history, finding.first_brief);
  return first !== null && isClaimedRung(first);
}

/**
 * D (SPEC §5.6) for the metrics of `date`: the cases among the findings as `filedAs()` files them on `date` - 1, and how they
 * stand now: `held` when the stored rung is counted, `fell` when it is disputed or retracted, `open` when it is still claimed or
 * preprint. `too_few` while there are fewer than `min_cases` cases.
 */
export function holdRate(
  findings: readonly LedgerFinding[], corrections: readonly FilingCorrection[], date: IsoDate, settings: HoldSettings,
): HoldCount {
  const asOf = addDays(date, -1);
  let held = 0;
  let fell = 0;
  let open = 0;
  const ids: string[] = [];
  for (const finding of findings) {
    const filed = filedAs(finding, corrections, asOf);
    if (!isHoldCase(filed, date, settings)) continue;
    ids.push(filed.id);
    if (isCountedRung(filed.rung)) held += 1;
    else if (isFellRung(filed.rung)) fell += 1;
    else open += 1;
  }
  const cases = ids.length;
  return { hold: { cases, held, fell, open, too_few: cases < settings.min_cases }, case_ids: ids.sort(compareFindingIds) };
}

// ── quotable (§5.2) ──────────────────────────────────────────────────────────────────────────────

/**
 * The counts of C and D that the agent may quote, by path (SPEC §5.2): `landmarks.this_year` ("5 of 9", the AI-role Landmarks
 * of the year of `date` among all), `landmarks.baseline` ("4 of 46", 2015 to 2019) and `hold` ("15 of 23", held among cases).
 * A count of no Landmark, or of no case, has no entry. Join these to `buildPace()`'s `extraQuotable`.
 */
export function ledgerQuotable(landmarks: Landmarks, hold: Hold, date: IsoDate): Record<string, string> {
  const out: Record<string, string> = {};
  const year = landmarksThisYear(landmarks, date);
  if (year !== null && year.all > 0) out["landmarks.this_year"] = `${fmtInt(year.ai)} of ${fmtInt(year.all)}`;
  if (landmarks.baseline.all > 0) out["landmarks.baseline"] = `${fmtInt(landmarks.baseline.ai)} of ${fmtInt(landmarks.baseline.all)}`;
  if (hold.cases > 0) out.hold = `${fmtInt(hold.held)} of ${fmtInt(hold.cases)}`;
  return out;
}
