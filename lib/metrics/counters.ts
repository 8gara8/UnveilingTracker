// The counters (SPEC §5.7, §4.7, §4.10, §4.11): each of the seven readings worked out from the data a reader hands over, and the
// rules that settle a day's readings, carried from the last file when a counter was not read or its source failed. Pure: no file,
// no clock, no network. The readers of `scripts/lib/` fetch and parse (ClinicalTrials.gov, RCSB, the Retraction Watch file,
// mathlib's page, erdosproblems.com) and pass in what they got, the date of the reading and the request records; nothing here
// asks a host. Every function takes the counter's own entry from `config/counters.json` (or just its id, kind and `source_url`)
// and returns a `CounterReading` the schema accepts.
//
//   erdos_ai          problems the reader marks solved with AI credit (the data format is a Verify item, §5.7)
//   mathlib_theorems  the number the statistics page gives
//   ai_drugs          `config/ai-drugs.json` and each trial's status and phases: the highest stage each drug reached
//   pdb_structures    released entries by deposit date plus unreleased entries deposited that year, withdrawn ones left out
//   ai_retractions    Retraction Watch rows, per year up to the day of the reading, whose reason includes computer-generated content
//   full_bibles       the difference of the two newest annual figures in `counters.json`
//   ancient_texts_ai  the stored findings, as `filedAs()` files them on D - 1 (§4.10)
//
// `computeCounters()` is what `computeMetrics()` (index.ts) calls: it reads a manual counter from the config every day, the
// ledger counter and the attempts of the API counters on a day the counters are read (a Monday, or `metrics --counters`), and
// carries the rest from the previous file.
//
// New for this project; Cyber's lib/metrics/ has no counterpart (its metrics read exploit and flaw data).

import { addDays, isMonday, isValidDate } from "../dates";
import { filedAs, hasAiRole, isCounted, type Filable, type FilingCorrection } from "../items";
import { normalizeDoi } from "../urls";
import type { IsoDate } from "../schema/common";
import type { Counter, Drug } from "../schema/config";
import type { CounterBreakdownRow, CounterInput, CounterReading, RequestRecord } from "../schema/metrics";
import type { Rung } from "../vocab";

/** What a reading needs of a counter's own entry in `config/counters.json`. */
export type CounterIdentity = Pick<Counter, "id" | "kind" | "source_url">;

function assertDate(date: string, what: string): void {
  if (!isValidDate(date)) throw new RangeError(`${what} must be a calendar date, got ${JSON.stringify(date)}`);
}

function assertCount(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${what} must be a non-negative whole number, got ${value}`);
}

const yearOf = (date: IsoDate): number => Number(date.slice(0, 4));

/** The longest piece of a string from outside that an error message quotes: a file read wrongly must not flood the log with its text. */
const SHOWN_CHARS = 40;
const shown = (text: string): string => (text.length > SHOWN_CHARS ? `${text.slice(0, SHOWN_CHARS)}...` : text);

/** An `ok` reading dated `asOf`. */
function okReading(counter: CounterIdentity, value: number, asOf: IsoDate, breakdown: CounterBreakdownRow[]): CounterReading {
  assertDate(asOf, "A reading's date");
  return { id: counter.id, kind: counter.kind, value, as_of: asOf, breakdown, source_url: counter.source_url, status: "ok" };
}

/** A counter with no reading: no value, no date, no breakdown, status `missing` (§4.7). */
export function missingReading(counter: CounterIdentity): CounterReading {
  return { id: counter.id, kind: counter.kind, value: null, as_of: null, breakdown: [], source_url: counter.source_url, status: "missing" };
}

// ── ai_drugs ─────────────────────────────────────────────────────────────────────────────────────

/** The trial statuses that show a trial has started (§5.7): any other, such as NOT_YET_RECRUITING, WITHDRAWN or UNKNOWN, adds no phase. */
export const STARTED_STATUSES = [
  "RECRUITING", "ENROLLING_BY_INVITATION", "ACTIVE_NOT_RECRUITING", "SUSPENDED", "TERMINATED", "COMPLETED",
] as const;

/** The three phases that count, by ClinicalTrials.gov's name for them; EARLY_PHASE1, PHASE4 and NA count as none. */
const PHASE_NUMBER: Readonly<Record<string, 1 | 2 | 3>> = { PHASE1: 1, PHASE2: 2, PHASE3: 3 };

/** The stages `breakdown` lists, in this order: the phase a drug's trials reached, or `approved`. */
export const DRUG_STAGES = ["1", "2", "3", "approved"] as const;
export type DrugStage = (typeof DRUG_STAGES)[number];

/** What the counter reads of a ClinicalTrials.gov API v2 study: `protocolSection.statusModule.overallStatus` and `protocolSection.designModule.phases`. */
export interface TrialRecord {
  readonly protocolSection?: {
    readonly statusModule?: { readonly overallStatus?: string };
    readonly designModule?: { readonly phases?: readonly string[] };
  };
}

/** The study of each NCT id the reader asked for; `null` where the registry has no such study. */
export type TrialLookup = ReadonlyMap<string, TrialRecord | null>;

/**
 * The phase a trial counts toward (§5.7): null unless its status shows it started; PHASE1, PHASE2 and PHASE3 are 1, 2 and 3; a
 * trial listing two phases counts as the lower; EARLY_PHASE1, PHASE4 and NA count as none.
 */
export function trialPhase(trial: TrialRecord | null): 1 | 2 | 3 | null {
  const status = trial?.protocolSection?.statusModule?.overallStatus;
  if (status === undefined || !(STARTED_STATUSES as readonly string[]).includes(status)) return null;
  let lowest: 1 | 2 | 3 | null = null;
  for (const phase of trial?.protocolSection?.designModule?.phases ?? []) {
    const n = PHASE_NUMBER[phase];
    if (n !== undefined && (lowest === null || n < lowest)) lowest = n;
  }
  return lowest;
}

/**
 * A drug's stage (§5.7): `approved` when its `approved` is set, whatever its trials (and then no trial is looked up); else the
 * highest phase among its started trials; null when it has neither. Throws when a trial of an unapproved drug is not in `trials`:
 * the reader did not ask for it, and counting around it would undercount.
 */
export function drugStage(drug: Pick<Drug, "trials" | "approved">, trials: TrialLookup): DrugStage | null {
  if (drug.approved !== null) return "approved";
  let highest: 1 | 2 | 3 | null = null;
  for (const nct of drug.trials) {
    const record = trials.get(nct);
    if (record === undefined) throw new RangeError(`No ClinicalTrials.gov answer was given for ${nct}`);
    const phase = trialPhase(record);
    if (phase !== null && (highest === null || phase > highest)) highest = phase;
  }
  return highest === null ? null : (String(highest) as DrugStage);
}

/**
 * The `ai_drugs` reading (§5.7): `value` is the number of drugs with a stage, `breakdown` the number at each (`1`, `2`, `3`,
 * `approved`, always these four in this order). A drug with no approval and no started trial is left out until it has one.
 */
export function aiDrugs(counter: CounterIdentity, drugs: readonly Pick<Drug, "trials" | "approved">[], trials: TrialLookup, asOf: IsoDate): CounterReading {
  const tally: Record<DrugStage, number> = { "1": 0, "2": 0, "3": 0, approved: 0 };
  for (const drug of drugs) {
    const stage = drugStage(drug, trials);
    if (stage !== null) tally[stage] += 1;
  }
  const breakdown = DRUG_STAGES.map((key) => ({ key, value: tally[key] }));
  return okReading(counter, breakdown.reduce((sum, row) => sum + row.value, 0), asOf, breakdown);
}

// ── pdb_structures ───────────────────────────────────────────────────────────────────────────────

/** The status of a withdrawn entry in RCSB's record of unreleased entries: it is left out (§5.7). */
export const WITHDRAWN_STATUS = "WDRN";

/** One entry of RCSB's record of unreleased entries, as the reader normalises it: its deposit date (a date, or a timestamp that starts with one) and its status code. */
export interface UnreleasedEntry {
  readonly deposit_date: string;
  readonly status: string;
}

export interface PdbData {
  /** Released entries by deposit year, from the search API's `return_counts`: a count for each of the two years. */
  readonly released: Readonly<Record<string, number>>;
  /** Every unreleased entry the record lists, whatever its year. */
  readonly unreleased: readonly UnreleasedEntry[];
}

/**
 * The unreleased entries deposited in each of `years`, withdrawn ones (status WDRN, in any case) left out. Throws on a
 * non-withdrawn entry whose deposit date does not start with a real date: a record read wrongly must not be counted around.
 */
export function unreleasedByYear(entries: readonly UnreleasedEntry[], years: readonly number[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(years.map((y) => [String(y), 0]));
  for (const entry of entries) {
    if (entry.status.trim().toUpperCase() === WITHDRAWN_STATUS) continue;
    const day = /^\d{4}-\d{2}-\d{2}(?!\d)/.exec(entry.deposit_date.trim())?.[0];
    if (day === undefined || !isValidDate(day)) throw new RangeError(`An unreleased entry has no deposit date: ${JSON.stringify(shown(entry.deposit_date))}`);
    const year = day.slice(0, 4);
    if (year in out) out[year] = (out[year] as number) + 1;
  }
  return out;
}

/**
 * The `pdb_structures` reading (§5.7): for last year and this year (the year of `asOf`), the released entries that the search
 * API counts by deposit date plus the unreleased entries deposited that year, withdrawn ones left out. `value` is this year's
 * count and `breakdown` gives both years, oldest first, each keyed by its year.
 */
export function pdbStructures(counter: CounterIdentity, data: PdbData, asOf: IsoDate): CounterReading {
  assertDate(asOf, "A reading's date");
  const years = [yearOf(asOf) - 1, yearOf(asOf)];
  const unreleased = unreleasedByYear(data.unreleased, years);
  const breakdown = years.map((year) => {
    const released = data.released[String(year)];
    if (released === undefined) throw new RangeError(`No count of released entries was given for ${year}`);
    assertCount(released, `The released count for ${year}`);
    return { key: String(year), value: released + (unreleased[String(year)] as number) };
  });
  return okReading(counter, (breakdown[1] as CounterBreakdownRow).value, asOf, breakdown);
}

// ── ai_retractions ───────────────────────────────────────────────────────────────────────────────

/** The Retraction Watch columns the counter and the rung watch's Monday match read (§5.7, §5.8). */
export const RETRACTION_COLUMNS = ["RetractionNature", "Reason", "OriginalPaperDOI", "RetractionDOI", "RetractionDate"] as const;

/** The reason that makes a retraction count, as the file words it once hyphens and case are set aside (§5.7: "computer-generated content"). */
export const COMPUTER_GENERATED = "computer generated content";

/** A Retraction Watch row, read. */
export interface RetractionRow {
  /** `RetractionNature` as the file has it: Retraction, Correction, Expression of concern, Reinstatement. */
  readonly nature: string;
  /** `Reason` split at its semicolons, each part trimmed and without the leading plus sign the file puts on it. */
  readonly reasons: string[];
  /** `OriginalPaperDOI` as §4.1 stores DOIs; null when it is empty, "unavailable" or no DOI. */
  readonly original_doi: string | null;
  /** `RetractionDOI` as §4.1 stores DOIs; null when it is no DOI (the file then only points to the journal's own notice, §5.8). */
  readonly retraction_doi: string | null;
  /** The day of `RetractionDate`, read from `YYYY-MM-DD` or `M/D/YYYY` with or without a time; null when it is neither. */
  readonly retraction_date: IsoDate | null;
}

function retractionDay(text: string): IsoDate | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(text);
  const day = iso !== null
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : us !== null
      ? `${us[3]}-${(us[1] as string).padStart(2, "0")}-${(us[2] as string).padStart(2, "0")}`
      : null;
  return day !== null && isValidDate(day) ? day : null;
}

/**
 * One Retraction Watch row, as its header names its columns. Throws when one of the five columns is missing from the record (an
 * absent column would count nothing and say so with no error).
 */
export function parseRetractionRow(record: Readonly<Record<string, string | undefined>>): RetractionRow {
  const cell = (column: (typeof RETRACTION_COLUMNS)[number]): string => {
    const value = record[column];
    if (value === undefined) throw new RangeError(`The Retraction Watch row has no ${column} column`);
    return value.trim();
  };
  return {
    nature: cell("RetractionNature"),
    reasons: cell("Reason").split(";").map((r) => r.trim().replace(/^\+\s*/, "").trim()).filter((r) => r.length > 0),
    original_doi: normalizeDoi(cell("OriginalPaperDOI")),
    retraction_doi: normalizeDoi(cell("RetractionDOI")),
    retraction_date: retractionDay(cell("RetractionDate")),
  };
}

/** True when one of the reasons includes computer-generated content: case, hyphens and runs of spaces do not matter. */
export function isComputerGenerated(reasons: readonly string[]): boolean {
  return reasons.some((r) => r.toLowerCase().replace(/[\p{Pd}_]/gu, " ").replace(/\s+/g, " ").includes(COMPUTER_GENERATED));
}

/**
 * The retractions per year whose reason includes computer-generated content: rows whose `RetractionNature` is Retraction (any
 * case), by the year of `RetractionDate`, up to and including `through` (the day of the reading). A qualifying row whose date
 * cannot be read is counted apart, in `undated`, and one dated after `through`, in `future`: the file holds such a row (one is
 * dated in 2027), and a retraction that has not happened is no retraction of "this year so far".
 */
export function aiRetractionYears(rows: readonly RetractionRow[], through: IsoDate): { by_year: Record<string, number>; undated: number; future: number } {
  assertDate(through, "The last day counted");
  const by_year: Record<string, number> = {};
  let undated = 0;
  let future = 0;
  for (const row of rows) {
    if (row.nature.toLowerCase() !== "retraction" || !isComputerGenerated(row.reasons)) continue;
    if (row.retraction_date === null) undated += 1;
    else if (row.retraction_date > through) future += 1;
    else by_year[row.retraction_date.slice(0, 4)] = (by_year[row.retraction_date.slice(0, 4)] ?? 0) + 1;
  }
  return { by_year, undated, future };
}

/**
 * The `ai_retractions` reading (§5.7): `value` is this year's count so far (the year of `asOf`, rows dated after `asOf` left out)
 * and `breakdown` gives last year and this year, oldest first, each keyed by its year. A file with no rows is no reading: it throws.
 */
export function aiRetractions(counter: CounterIdentity, rows: readonly RetractionRow[], asOf: IsoDate): CounterReading {
  assertDate(asOf, "A reading's date");
  if (rows.length === 0) throw new RangeError("The Retraction Watch file holds no rows");
  const { by_year } = aiRetractionYears(rows, asOf);
  const breakdown = [yearOf(asOf) - 1, yearOf(asOf)].map((year) => ({ key: String(year), value: by_year[String(year)] ?? 0 }));
  return okReading(counter, (breakdown[1] as CounterBreakdownRow).value, asOf, breakdown);
}

// ── erdos_ai and mathlib_theorems ────────────────────────────────────────────────────────────────

/** An Erdős problem as the reader normalises erdosproblems.com's data: whether it is solved and whether the data credits AI with the solution. */
export interface ErdosProblem {
  readonly id: string;
  readonly solved: boolean;
  readonly ai_credit: boolean;
}

/** The `erdos_ai` reading when its kind is `api`: the problems solved with AI credit. A problem listed twice is a misread file and throws. */
export function erdosAi(counter: CounterIdentity, problems: readonly ErdosProblem[], asOf: IsoDate): CounterReading {
  const seen = new Set<string>();
  let value = 0;
  for (const problem of problems) {
    if (seen.has(problem.id)) throw new RangeError(`Erdős problem ${problem.id} is listed twice`);
    seen.add(problem.id);
    if (problem.solved && problem.ai_credit) value += 1;
  }
  return okReading(counter, value, asOf, []);
}

/** The `mathlib_theorems` reading: the number of theorems the statistics page gives. */
export function mathlibTheorems(counter: CounterIdentity, theorems: number, asOf: IsoDate): CounterReading {
  assertCount(theorems, "The number of theorems");
  return okReading(counter, theorems, asOf, []);
}

// ── full_bibles, manual counters and the ledger counter ──────────────────────────────────────────

/**
 * The `full_bibles` reading (§5.7): `value` is the newest annual total minus the one before it, `as_of` and `source_url` are the
 * newest figure's and `breakdown` holds its total (`total`). With fewer than two figures it is `missing`.
 */
export function fullBibles(counter: Pick<Counter, "id" | "kind" | "source_url" | "figures">): CounterReading {
  const figures = counter.figures;
  const newest = figures[figures.length - 1];
  const before = figures[figures.length - 2];
  if (newest === undefined || before === undefined) return missingReading(counter);
  return {
    id: counter.id, kind: counter.kind, value: newest.total - before.total, as_of: newest.as_of,
    breakdown: [{ key: "total", value: newest.total }], source_url: newest.source_url, status: "ok",
  };
}

/** A manual counter other than `full_bibles` shows its own value and date from the config (§4.11); with none it is `missing`. */
export function manualReading(counter: Pick<Counter, "id" | "kind" | "source_url" | "value" | "as_of">): CounterReading {
  if (counter.value === null || counter.as_of === null) return missingReading(counter);
  return okReading(counter, counter.value, counter.as_of, []);
}

/** What the ledger counter reads of a stored finding: the six values `filedAs()` refiles, and its stored rung. */
export type CounterFinding = Filable & { readonly rung: Rung };

/** The subfield the ledger counter counts, a humanities subfield (`fields.json` has it, CONFIG_REF). */
export const ANCIENT_TEXTS = "ancient-texts";

/**
 * The `ancient_texts_ai` reading (§5.7): the findings as `filedAs()` files them on `date` - 1 that are in the humanities, in the
 * subfield `ancient-texts`, of kind `result`, with an AI role and a counted rung. A setback, an infrastructure item, a capability,
 * a check and a preprint there are out. Dated `date` - 1, the day it reads the filing of.
 */
export function ancientTextsAi(
  counter: CounterIdentity, findings: readonly CounterFinding[], corrections: readonly FilingCorrection[], date: IsoDate,
): CounterReading {
  assertDate(date, "The date");
  const filingDay = addDays(date, -1);
  const value = findings.map((f) => filedAs(f, corrections, filingDay)).filter((f) =>
    f.field === "humanities" && f.subfield === ANCIENT_TEXTS && f.kind === "result" && hasAiRole(f) && isCounted(f)).length;
  return okReading(counter, value, filingDay, []);
}

// ── Settling a day's readings (§5.7: carried, stale) ─────────────────────────────────────────────

/** What the script got when it read an API counter: a reading it computed (status `ok`) and the requests it made, or a failure. */
export type CounterAttempt =
  | { readonly outcome: "read"; readonly reading: CounterReading; readonly requests: readonly RequestRecord[] }
  | { readonly outcome: "failed" };

/** The previous file's counters and its inputs manifest's, for what is carried. */
export interface PreviousCounters {
  readonly readings: readonly CounterReading[];
  readonly inputs: readonly CounterInput[];
}

/** True on the days the counters are read (§5.7): a Monday, or when `metrics --counters` forces it. */
export function countersDue(date: IsoDate, forced = false): boolean {
  return forced || isMonday(date);
}

export interface CountersRun {
  /** `config/counters.json`'s counters, in its order: the order of the result. */
  readonly counters: readonly Counter[];
  readonly date: IsoDate;
  /** Whether today is a day the counters are read (`countersDue()`): the ledger counter is read then, and carried otherwise. */
  readonly readToday: boolean;
  /** An API counter's attempt today, by id; one with no attempt was not read today and is carried. */
  readonly attempts: Readonly<Record<string, CounterAttempt | undefined>>;
  readonly previous: PreviousCounters | null;
  readonly findings: readonly CounterFinding[];
  readonly corrections: readonly FilingCorrection[];
}

export interface CountersResult {
  readonly readings: CounterReading[];
  /** The inputs manifest's row of each counter: its requests and its value. */
  readonly inputs: CounterInput[];
  readonly log: string[];
}

/**
 * One API or ledger counter's reading for today, in the three cases of §5.7. Read: the attempt's reading and requests. Failed: the
 * last reading kept with status `stale` and its own `as_of` (and, with no earlier reading, `missing`). Not read today: the last
 * reading carried as it was, its own status and `as_of` unchanged. The counter's kind and `source_url` are always today's config.
 */
export function settleCounter(
  counter: Counter, attempt: CounterAttempt | undefined, previous: PreviousCounters | null,
): { reading: CounterReading; input: CounterInput } {
  if (attempt?.outcome === "read") {
    const { reading, requests } = attempt;
    if (reading.id !== counter.id || reading.status !== "ok") throw new RangeError(`The attempt for ${counter.id} holds a reading that is not its own, ok reading`);
    return { reading, input: { id: counter.id, requests: [...requests], value: reading.value } };
  }
  const last = previous?.readings.find((r) => r.id === counter.id);
  const lastInput = previous?.inputs.find((i) => i.id === counter.id);
  const base = last === undefined ? missingReading(counter) : { ...last, kind: counter.kind, source_url: counter.source_url };
  const reading: CounterReading = attempt?.outcome === "failed" && base.status === "ok" ? { ...base, status: "stale" } : base;
  return { reading, input: { id: counter.id, requests: [...(lastInput?.requests ?? [])], value: reading.value } };
}

/**
 * The seven readings of `date`, in config order, with the manifest's row of each (SPEC §5.7). A manual counter is read from the
 * config every day (`full_bibles` from its figures, the others from their value and date), since a pull request changes them. The
 * ledger counter is computed on a day the counters are read and carried otherwise, so a correction counts from the first such
 * day after its date (§4.10). An API counter is settled from its attempt. `log` names each counter that has no reading or kept a
 * stale one.
 */
export function computeCounters(run: CountersRun): CountersResult {
  assertDate(run.date, "The date");
  const readings: CounterReading[] = [];
  const inputs: CounterInput[] = [];
  const log: string[] = [];
  for (const counter of run.counters) {
    let settled: { reading: CounterReading; input: CounterInput };
    if (counter.kind === "manual") {
      const reading = counter.id === "full_bibles" ? fullBibles(counter) : manualReading(counter);
      settled = { reading, input: { id: counter.id, requests: [], value: reading.value } };
    } else if (counter.kind === "ledger") {
      if (counter.id !== "ancient_texts_ai") throw new RangeError(`There is no ledger reading for ${counter.id}`);
      if (run.readToday) {
        const reading = ancientTextsAi(counter, run.findings, run.corrections, run.date);
        settled = { reading, input: { id: counter.id, requests: [], value: reading.value } };
      } else {
        settled = settleCounter(counter, undefined, run.previous);
      }
    } else {
      settled = settleCounter(counter, run.attempts[counter.id], run.previous);
    }
    readings.push(settled.reading);
    inputs.push(settled.input);
    if (settled.reading.status === "missing") log.push(`Counter ${counter.id}: no reading.`);
    else if (settled.reading.status === "stale") log.push(`Counter ${counter.id}: its source failed, the reading of ${settled.reading.as_of} is kept.`);
  }
  return { readings, inputs, log };
}
