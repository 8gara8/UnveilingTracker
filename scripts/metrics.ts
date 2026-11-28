// The metrics run (SPEC §5, §4.7, §8.4):
//   tsx scripts/metrics.ts --date YYYY-MM-DD [--recompute] [--counters] [--out DIR]
// stages `metrics/D.json`, `metrics/inputs/D.json` and `state/pace-weekly.json` in `cache/staged/D/` (or `--out`): §5.4's refetch of the
// weekly Pace state (the weeks `weeksToFetch()` names, fetched through the OpenAlex client one at a time, an answer cache reused by §5.4's
// rule), §5.2's sentence, C and D from the stored findings, and the counters (§5.7: read on Mondays or with `--counters`, else carried).
// `runMetrics()` is what stage 3 of the morning calls in-process, what the backfill calls at its end (`frozen`: the state it just built,
// unchanged, and the answers it came from), and what the command line wraps.
//
// Outcomes of the Pace (§8.4): when OpenAlex fails (the budget is spent, a request is refused, an answer is no usable answer, the deadline
// passes, or the state has a gap a morning cannot close) the file is `stale`: the last good state is reused, its own cutoff is the file's
// `data_cutoff`, and no state file is staged (the state is unchanged). With no state to reuse the file is `missing`. Either way the file is
// written, as it is whenever the stage runs to its end. A weekly state built with other config versions is `E_METRICS` (§5.4): nothing is
// staged, and a staged folder left by an earlier try for the same date is removed, so publish never finds one.
//
// `--recompute` rebuilds D's file from the inputs manifest and the cache and compares bytes (exit 1 on a difference). It reads the answers
// the manifest lists back from `cache/openalex/` by URL and SHA-256 and joins them to the weekly state that run left (the state at the commit
// that added `metrics/D.json`, else the working tree's), then rebuilds the state and the file; the counters read that run are read back from
// the bodies in `cache/feeds/` (`cachedCtgov()` and the others check each body's SHA-256), and a counter that run carried, or whose bodies
// the cache no longer holds, keeps its committed reading, which the output says. C, D and the ledger counter are computed from the findings
// as they are now (the record of D's day is not kept), which the output also says. The rebuilt files go to `logs/recompute/D/`.
// Nothing here fetches in a recompute.
//
// Cyber's scripts/metrics.ts at the fork commit 3ced1fb, adapted: `runMetrics()`'s shape (options, result, the staged folder emptied
// first, `--out content` deleting nothing, the one clock read, `metrics/D.json exists`), `firstDifference()` and the recompute's way of
// finding the commit that added the file are Cyber's; the OpenAlex stage, the counters' readers, the stale and missing outcomes and the
// version check are this project's.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CONFIG_DIR, loadConfig, type LoadedConfig } from "../lib/config";
import { loadContent, contentLogLines, contentDir } from "../lib/content";
import { addDays, isMonday, isValidDate, taipeiDateOf, taipeiTimestamp, taipeiToday } from "../lib/dates";
import { cachePaths } from "../lib/feeds/cache";
import { byCodeUnit } from "../lib/ids";
import { jsonText } from "../lib/json";
import {
  MetricsError, applyWeeks, checkStateVersions, computeMetrics, paceVersions, weeksToFetch,
  type CounterAttempt, type PreviousCounters, type WeeklyInput,
} from "../lib/metrics/index";
import { aiDrugs, aiRetractions, countersDue, mathlibTheorems, pdbStructures } from "../lib/metrics/counters";
import { dataCutoff } from "../lib/metrics/pace";
import type { IsoDate } from "../lib/schema/common";
import type { Counter } from "../lib/schema/config";
import {
  InputsManifest, MetricsFile, PaceWeeklyFile, type CounterInput, type CounterReading, type OpenAlexRequest, type RequestRecord,
} from "../lib/schema/metrics";
import { git, GitOutputCut } from "./lib/git";
import {
  cachedCtgov, cachedMathlib, cachedPdb, cachedRetractions,
} from "./lib/feed-cache";
import {
  feedCtx, readCtgov, readMathlib, readPdbStructures, readRetractionWatch, type FeedCtx,
} from "./lib/feeds";
import {
  createOpenAlexClient, inputsRecord, paceQuery, readCachedAnswer, readOpenAlexKey, weekInputs, type OpenAlexStats,
} from "./lib/openalex";

export interface RunMetricsOptions {
  /** The edition date D, a Taipei date. */
  date: IsoDate;
  /** The repository root; default the working folder. */
  root?: string;
  /** Where the files go; default `cache/staged/D/`, emptied first (a folder given is never emptied: `--out content` deletes nothing). */
  out?: string;
  /** Rebuild D's file from its manifest and the cache and compare bytes. Takes no `out` and no `counters`. */
  recompute?: boolean;
  /** Read the counters today although it is not a Monday (§5.7). */
  counters?: boolean;
  /** Epoch ms: nothing starts and nothing is written past it. */
  deadline?: number;
  /** The one clock read (injectable): `computed_at`, the run's Taipei date and the counters' fetch times. */
  now?: Date;
  /**
   * The backfill's own run: this state, as it built it, and the answers it came from (all weeks). Nothing is fetched, the weekly state is not
   * staged again (the backfill wrote it) and the counters are read (`counters` is implied).
   */
  frozen?: { state: PaceWeeklyFile; requests: readonly OpenAlexRequest[] };
  /** The OpenAlex key, added on the wire only; absent or null: keyless. The command line passes the keychain's; a library call never reads it. */
  apiKey?: string | null;
  /** The counters' readers' context (the fetcher, its budget and clock); default `feedCtx()`. */
  feedCtx?: Partial<FeedCtx>;
}

export interface RunMetricsResult {
  code: 0 | 1;
  firstLine: string;
  lines: string[];
  /** Files written, relative to the out folder. */
  wrote: string[];
  /** The status of the file written (`ok`, `stale` or `missing`); null when none was written. */
  status: MetricsFile["status"] | null;
  /** `E_METRICS` when the weekly state was built with other config versions (§5.4); null otherwise. */
  errorCode: "E_METRICS" | null;
}

export const REPRODUCED = "Reproduced.";
export const USAGE = "Usage: npm run metrics -- --date YYYY-MM-DD [--recompute] [--counters] [--out DIR]";

const STATE_FILE = "state/pace-weekly.json";

const done = (code: 0 | 1, lines: string[], wrote: string[] = [], status: MetricsFile["status"] | null = null, errorCode: "E_METRICS" | null = null): RunMetricsResult =>
  ({ code, firstLine: lines[0] ?? "", lines, wrote, status, errorCode });

/** The first line of a message cut at 300 characters: what a log line may quote of an error. */
const brief = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);

function writeFile(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** The weekly state under `content/`, or null when there is none. A file that does not parse is an error (exit 1), never "no state". */
function readState(content: string): PaceWeeklyFile | null {
  const file = path.join(content, STATE_FILE);
  if (!fs.existsSync(file)) return null;
  return parseState(fs.readFileSync(file, "utf8"));
}

function parseState(text: string): PaceWeeklyFile {
  const parsed = PaceWeeklyFile.safeParse(parseJson(text));
  if (!parsed.success) throw new Error(`${STATE_FILE} does not parse: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

/** The newest metrics file before `date` that parses, with its manifest's counter rows (none when the manifest is missing or does not parse). */
function readPrevious(content: string, date: IsoDate): PreviousCounters | null {
  let names: string[];
  try {
    names = fs.readdirSync(path.join(content, "metrics"));
  } catch {
    return null;
  }
  const dated = names.map((n) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(n)?.[1]).filter((d): d is string => d !== undefined && d < date).sort(byCodeUnit).reverse();
  for (const d of dated) {
    const metrics = MetricsFile.safeParse(parseJson(fs.readFileSync(path.join(content, "metrics", `${d}.json`), "utf8")));
    if (!metrics.success) continue;
    let inputs: CounterInput[] = [];
    try {
      const manifest = InputsManifest.safeParse(parseJson(fs.readFileSync(path.join(content, "metrics", "inputs", `${d}.json`), "utf8")));
      if (manifest.success) inputs = manifest.data.counters;
    } catch {
      // A manifest that is missing leaves the carried counters with no requests listed.
    }
    return { readings: metrics.data.counters, inputs };
  }
  return null;
}

// ── The counters (§5.7) ──────────────────────────────────────────────────────────────────────────

const failedAttempt: CounterAttempt = { outcome: "failed" };

const readAttempt = (reading: CounterReading, requests: readonly RequestRecord[]): CounterAttempt => ({ outcome: "read", reading, requests });

/** Every NCT id of `config/ai-drugs.json`, once each. */
const trialsOf = (config: LoadedConfig): string[] => [...new Set(config.aiDrugs.drugs.flatMap((d) => d.trials))];

/**
 * Reads each API counter's source today (§5.7), one after another: the attempt of each by id. A counter whose read fails, whose id has no reader or
 * whose registry feed is missing is a failed attempt (its last reading is kept as stale); the readers never throw, and a reading that cannot
 * be made from what they gave is a failed attempt too. Each reader's own log lines go to `log`.
 */
async function readApiCounters(config: LoadedConfig, ctx: FeedCtx, asOf: IsoDate, log: (line: string) => void): Promise<Record<string, CounterAttempt>> {
  const feed = (id: string) => config.sources.feeds.find((f) => f.id === id);
  const attempts: Record<string, CounterAttempt> = {};
  for (const counter of config.counters.counters) {
    if (counter.kind !== "api") continue;
    try {
      attempts[counter.id] = await readApiCounter(counter, config, feed, ctx, asOf);
      if (attempts[counter.id] === failedAttempt) log(`Counter ${counter.id}: its source gave no reading today.`);
    } catch (e) {
      log(`Counter ${counter.id}: ${brief(e)}`);
      attempts[counter.id] = failedAttempt;
    }
  }
  return attempts;
}

async function readApiCounter(
  counter: Counter, config: LoadedConfig, feed: (id: string) => LoadedConfig["sources"]["feeds"][number] | undefined, ctx: FeedCtx, asOf: IsoDate,
): Promise<CounterAttempt> {
  const need = (id: string) => {
    const entry = feed(id);
    if (entry === undefined) throw new Error(`the registry has no feed ${id}`);
    return entry;
  };
  switch (counter.id) {
    case "mathlib_theorems": {
      const r = await readMathlib(need("mathlib-stats"), ctx);
      return r.ok && r.data !== null ? readAttempt(mathlibTheorems(counter, r.data, asOf), r.fetched) : failedAttempt;
    }
    case "ai_drugs": {
      const r = await readCtgov(need("ctgov"), ctx, trialsOf(config));
      return r.ok && r.data !== null ? readAttempt(aiDrugs(counter, config.aiDrugs.drugs, r.data, asOf), r.fetched) : failedAttempt;
    }
    case "pdb_structures": {
      const r = await readPdbStructures(need("rcsb"), need("rcsb-unreleased"), ctx, asOf);
      return r.data !== null ? readAttempt(pdbStructures(counter, r.data, asOf), [...r.counts.fetched, ...r.unreleased.fetched]) : failedAttempt;
    }
    case "ai_retractions": {
      const r = await readRetractionWatch(need("retraction-watch"), ctx, asOf);
      return r.ok && r.data !== null ? readAttempt(aiRetractions(counter, r.data.rows, asOf), r.fetched) : failedAttempt;
    }
    default:
      throw new Error("no reader is written for this counter");
  }
}

/**
 * An API counter's reading read back from the cached bodies its manifest row lists (`--recompute`): null when a body is missing, changed (its
 * SHA-256 is not the one recorded) or does not parse, or when the counter has no reader.
 */
function readBack(counter: Counter, config: LoadedConfig, root: string, requests: readonly RequestRecord[], asOf: IsoDate): CounterReading | null {
  switch (counter.id) {
    case "mathlib_theorems": {
      const n = cachedMathlib(root, requests);
      return n === null ? null : mathlibTheorems(counter, n, asOf);
    }
    case "ai_drugs": {
      const lookup = cachedCtgov(root, requests);
      return lookup === null ? null : aiDrugs(counter, config.aiDrugs.drugs, lookup, asOf);
    }
    case "pdb_structures": {
      const data = cachedPdb(root, requests);
      return data === null ? null : pdbStructures(counter, data, asOf);
    }
    case "ai_retractions": {
      const data = cachedRetractions(root, requests, asOf);
      return data === null ? null : aiRetractions(counter, data.rows, asOf);
    }
    default:
      return null;
  }
}

// ── The Pace (§5.4) ──────────────────────────────────────────────────────────────────────────────

interface PaceStage {
  weekly: WeeklyInput;
  /** The state to stage: the one this run built; null when the state is unchanged (stale, missing, or the backfill's own). */
  built: PaceWeeklyFile | null;
  lines: string[];
}

/**
 * The weekly state of this run (§5.4): the weeks `weeksToFetch()` names, fetched through the client in its order; `applyWeeks()` joins them to
 * `state`. Any failure leaves the state as it was: `reused` (stale), or `none` (missing) without one. A gap the cap of `window_weeks` older
 * weeks cannot close spends nothing: the state cannot be made whole today.
 */
async function paceStage(config: LoadedConfig, root: string, state: PaceWeeklyFile | null, o: RunMetricsOptions, now: Date): Promise<PaceStage> {
  const fallback = (lines: string[]): PaceStage => ({ weekly: state === null ? { kind: "none" } : { kind: "reused", state }, built: null, lines });
  const settings = config.run.pace;
  const cutoff = dataCutoff(o.date);
  const plan = weeksToFetch(state, cutoff, settings);
  if (plan.uncovered.length > 0) {
    const oldest = plan.uncovered.at(-1)!;
    const newest = plan.uncovered[0]!;
    const lacking = plan.uncovered.length === 1 ? `1 week (${oldest})` : `${plan.uncovered.length} weeks (${oldest} to ${newest})`;
    return fallback([`Pace: the weekly state lacks ${lacking} that a morning cannot fetch, ${settings.window_weeks} older weeks at most: ` +
      "run npm run backfill -- --pace, with --push after go-live (SPEC §5.4)."]);
  }
  const client = createOpenAlexClient({
    cacheDir: cachePaths(root).openalexDir, query: paceQuery(config.index), provisionalWeeks: settings.provisional_weeks, today: taipeiToday(now),
    apiKey: o.apiKey ?? null, now: () => now, ...(o.deadline === undefined ? {} : { deadline: o.deadline }),
  });
  const requests: OpenAlexRequest[] = [];
  try {
    for (const monday of plan.weeks) {
      if (o.deadline !== undefined && Date.now() >= o.deadline) throw new Error("the run's deadline passed");
      requests.push(...weekInputs(await client.fetchWeek(monday)));
    }
    const built = applyWeeks(state, requests, { cutoff, updated: taipeiToday(now), versions: paceVersions(config.versions), settings });
    const s: OpenAlexStats = client.stats();
    const weeks = plan.weeks.length;
    return {
      weekly: { kind: "current", state: built, requests }, built,
      lines: [`Pace: ${weeks} weeks fetched or read from the cache (${s.requests} requests, ${s.cache_hits} cached, ${s.credits} credits).`,
        ...(plan.deferred.length > 0 ? [`Pace: ${plan.deferred.length} older weeks are owed a refetch and wait for a later morning.`] : [])],
    };
  } catch (e) {
    if (e instanceof MetricsError) throw e;
    return fallback([`Pace: OpenAlex was not read (${brief(e)})`]);
  }
}

// ── runMetrics ───────────────────────────────────────────────────────────────────────────────────

/** The outputs: `metrics/D.json`, `metrics/inputs/D.json` and, when the run built one, the state, each through its schema. */
function outputs(date: IsoDate, metrics: MetricsFile, manifest: InputsManifest, state: PaceWeeklyFile | null): [string, string][] {
  const files: [string, string][] = [
    [`metrics/${date}.json`, jsonText(metrics, MetricsFile)],
    [`metrics/inputs/${date}.json`, jsonText(manifest, InputsManifest)],
  ];
  if (state !== null) files.push([STATE_FILE, jsonText(state, PaceWeeklyFile)]);
  return files;
}

export async function runMetrics(o: RunMetricsOptions): Promise<RunMetricsResult> {
  const root = path.resolve(o.root ?? process.cwd());
  if (!isValidDate(o.date)) return done(1, [`Invalid date: ${o.date}`]);
  const staged = cachePaths(root).stagedMetrics(o.date);
  try {
    if (o.recompute) return await recompute(o, root);

    const content = path.resolve(root, contentDir());
    if (fs.existsSync(path.join(content, "metrics", `${o.date}.json`))) return done(0, [`metrics/${o.date}.json exists`]);

    const config = loadConfig(path.join(root, CONFIG_DIR));
    const now = o.now ?? new Date();
    const computedAt = taipeiTimestamp(now);
    const stored = loadContent(content, { fresh: true, config, log: () => {} });
    const lines: string[] = [];

    const state = o.frozen?.state ?? readState(content);
    if (state !== null) checkStateVersions(state, paceVersions(config.versions));

    const stage: PaceStage = o.frozen === undefined
      ? await paceStage(config, root, state, o, now)
      : { weekly: { kind: "current", state: o.frozen.state, requests: o.frozen.requests }, built: null, lines: [] };

    const readToday = o.frozen !== undefined || countersDue(o.date, o.counters === true);
    const attempts = readToday
      ? await readApiCounters(config, feedCtx(root, { now: () => now.getTime(), deadline: o.deadline ?? Number.POSITIVE_INFINITY, ...o.feedCtx }), taipeiDateOf(computedAt), (l) => lines.push(l))
      : {};
    const result = computeMetrics({
      date: o.date, computedAt, settings: config.run.pace, versions: config.versions, weekly: stage.weekly,
      findings: stored.findings, corrections: stored.corrections,
      counters: { config: config.counters.counters, readToday, attempts, previous: readPrevious(content, o.date) },
    });

    const out = o.out === undefined ? staged : path.resolve(root, o.out);
    if (o.deadline !== undefined && Date.now() >= o.deadline) return done(1, [`Metrics ${o.date}: the deadline passed before anything was written.`]);
    if (out === staged) fs.rmSync(out, { recursive: true, force: true });
    const files = outputs(o.date, result.metrics, result.manifest, stage.built);
    for (const [rel, text] of files) writeFile(path.join(out, rel), text);
    const wrote = files.map(([rel]) => rel);
    const status = result.metrics.status;
    return done(0, [
      `Metrics ${o.date}: Pace ${status}, data to ${result.metrics.data_cutoff}.`, ...stage.lines, ...lines, ...result.log, ...contentLogLines(stored),
      `Wrote ${wrote.length} files to ${path.relative(root, out) || "."}.`,
    ], wrote, status);
  } catch (e) {
    if (e instanceof MetricsError) {
      // A state built with other versions stages nothing (§5.4), and nothing an earlier try staged for this date may be published.
      if (o.out === undefined) fs.rmSync(staged, { recursive: true, force: true });
      return done(1, [e.message], [], null, e.code);
    }
    return done(1, [brief(e)]);
  }
}

// ── --recompute ──────────────────────────────────────────────────────────────────────────────────

/** The first JSON path where two values differ (null when equal), such as `pace.leading.pooled.window.k` or `counters[2].value`. */
export function firstDifference(a: unknown, b: unknown, at = ""): string | null {
  if (a === b) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = firstDifference(a[i], b[i], `${at}[${i}]`);
      if (d !== null) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at ? `${at}.${k}` : k);
      if (d !== null) return d;
    }
    return null;
  }
  return at || "(top level)";
}

/**
 * The weekly state the committed file of `date` was built from: the one at the commit that added `metrics/D.json` when git knows that commit, else the
 * working tree's. Null when there is none. A cut `git show` is never taken for a missing state.
 */
async function stateOf(root: string, content: string, date: IsoDate): Promise<PaceWeeklyFile | null> {
  const rel = path.relative(root, content).split(path.sep).join("/");
  const g = git(root);
  let commit: string | undefined;
  try {
    commit = (await g(["log", "--diff-filter=A", "--format=%H", "--", `${rel}/metrics/${date}.json`])).split("\n").filter(Boolean).at(-1);
  } catch (e) {
    if (e instanceof GitOutputCut) throw e;
  }
  if (commit === undefined) return readState(content);
  try {
    return parseState(`${await g(["show", `${commit}:${rel}/${STATE_FILE}`])}\n`);
  } catch (e) {
    if (e instanceof GitOutputCut || (e instanceof Error && e.message.startsWith(STATE_FILE))) throw e;
    return null;
  }
}

async function recompute(o: RunMetricsOptions, root: string): Promise<RunMetricsResult> {
  const D = o.date;
  const content = path.resolve(root, contentDir());
  const file = path.join(content, "metrics", `${D}.json`);
  if (!fs.existsSync(file)) return done(1, [`metrics/${D}.json does not exist: nothing to recompute.`]);
  const committedText = fs.readFileSync(file, "utf8");
  const committedParsed = MetricsFile.safeParse(parseJson(committedText));
  if (!committedParsed.success) return done(1, [`metrics/${D}.json does not parse: ${committedParsed.error.issues[0]?.message ?? "invalid"}`]);
  const committed = committedParsed.data;
  const manifestFile = path.join(content, "metrics", "inputs", `${D}.json`);
  const manifestText = fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile, "utf8") : null;
  const manifestParsed = manifestText === null ? null : InputsManifest.safeParse(parseJson(manifestText));
  if (manifestText === null || !manifestParsed?.success) return done(1, [`metrics/inputs/${D}.json is missing or does not parse: nothing to recompute from.`]);
  const manifest = manifestParsed.data;

  const config = loadConfig(path.join(root, CONFIG_DIR));
  const lines: string[] = [];
  const stored = loadContent(content, { fresh: true, config, log: () => {} });
  const after = await stateOf(root, content, D);
  const settings = config.run.pace;

  // The weekly state: ok joins the cached answers the manifest lists to the state the run left, and the result must be that state; stale reuses
  // it; missing has none.
  let weekly: WeeklyInput;
  if (committed.status === "ok") {
    if (after === null) return done(1, [`No weekly state is committed with metrics/${D}.json: nothing to recompute from.`]);
    const query = paceQuery(config.index);
    const requests: OpenAlexRequest[] = [];
    const lacking: string[] = [];
    for (const r of manifest.openalex) {
      const answer = readCachedAnswer(cachePaths(root).openalexDir, query.fields, r);
      if (answer === null) lacking.push(`${r.request} ${r.week_start}`);
      else requests.push(inputsRecord(answer));
    }
    if (lacking.length > 0) {
      return done(1, [`Not reproduced: ${lacking.length} of the ${manifest.openalex.length} OpenAlex answers the manifest lists are not in cache/openalex/ (first: ${lacking[0]}).`]);
    }
    const rebuilt = applyWeeks(after, requests, { cutoff: committed.data_cutoff, updated: after.updated, versions: paceVersions(config.versions), settings });
    const rebuiltText = jsonText(rebuilt, PaceWeeklyFile);
    if (rebuiltText !== jsonText(after, PaceWeeklyFile)) {
      return done(1, [`Not reproduced: the weekly state differs from the answers in the cache at ${firstDifference(after, rebuilt) ?? "(formatting only)"}.`]);
    }
    weekly = { kind: "current", state: rebuilt, requests };
  } else if (committed.status === "stale") {
    if (after === null) return done(1, [`No weekly state is committed with metrics/${D}.json: nothing to recompute from.`]);
    weekly = { kind: "reused", state: after };
  } else {
    weekly = { kind: "none" };
  }

  // The counters: those this run read come back from the cached bodies; the others keep the committed reading.
  const dayOf = taipeiDateOf(committed.computed_at);
  const attempts: Record<string, CounterAttempt> = {};
  const unread: string[] = [];
  for (const counter of config.counters.counters) {
    if (counter.kind !== "api") continue;
    const reading = committed.counters.find((c) => c.id === counter.id);
    const row = manifest.counters.find((c) => c.id === counter.id);
    const readThen = reading?.status === "ok" && row !== undefined && row.requests.length > 0 && row.requests.every((r) => taipeiDateOf(r.fetched_at) === dayOf);
    if (!readThen) continue;
    const back = readBack(counter, config, root, row.requests, taipeiDateOf(row.requests[0]!.fetched_at));
    if (back === null) unread.push(counter.id);
    else attempts[counter.id] = readAttempt(back, row.requests);
  }
  const ledger = committed.counters.find((c) => config.counters.counters.some((k) => k.id === c.id && k.kind === "ledger"));
  const readToday = isMonday(D) || (ledger !== undefined && ledger.as_of === addDays(D, -1));
  const result = computeMetrics({
    date: D, computedAt: committed.computed_at, settings, versions: config.versions, weekly,
    findings: stored.findings, corrections: stored.corrections,
    counters: { config: config.counters.counters, readToday, attempts, previous: { readings: committed.counters, inputs: manifest.counters } },
  });

  const out = cachePaths(root).recompute(D);
  fs.rmSync(out, { recursive: true, force: true });
  const files = outputs(D, result.metrics, result.manifest, weekly.kind === "current" ? weekly.state : null);
  for (const [rel, text] of files) writeFile(path.join(out, rel), text);
  const wrote = files.map(([rel]) => rel);

  if (unread.length > 0) lines.push(`Counters not read back (their bodies are not in cache/feeds/ as recorded): ${unread.join(", ")}; the committed readings are kept.`);
  lines.push("C, D and the ledger counter were computed from the findings as they are now.");
  const ours = files[0]![1];
  const theirs = files[1]![1];
  if (ours === committedText && theirs === manifestText) return done(0, [REPRODUCED, ...lines], wrote, committed.status);
  const diff = ours === committedText
    ? `metrics/inputs/${D}.json at ${firstDifference(JSON.parse(manifestText), JSON.parse(theirs)) ?? "(formatting only)"}`
    : `metrics/${D}.json at ${firstDifference(JSON.parse(committedText), JSON.parse(ours)) ?? "(formatting only)"}`;
  return done(1, [`Not reproduced: the first difference is in ${diff}.`, ...lines], wrote, committed.status);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

/** The command line: 0 done, 1 failed, 2 a usage error (§8.4). The only place the keychain's OpenAlex key is read. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let values: { date?: string; out?: string; recompute?: boolean; counters?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: { date: { type: "string" }, out: { type: "string" }, recompute: { type: "boolean" }, counters: { type: "boolean" } },
    }));
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (values.date === undefined || !isValidDate(values.date) || (values.recompute && (values.out !== undefined || values.counters))) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const r = await runMetrics({
    date: values.date, ...(values.out === undefined ? {} : { out: values.out }), recompute: values.recompute === true, counters: values.counters === true,
    ...(values.recompute ? {} : { apiKey: readOpenAlexKey() }),
  });
  (r.code === 0 ? process.stdout : process.stderr).write(`${r.lines.join("\n")}\n`);
  return r.code;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void main().then((code) => { process.exitCode = code; });
