// The Pace backfill (SPEC §5.4, §8.4, §10 P2 step 6):
//   tsx scripts/backfill.ts --pace [--refresh] [--to YYYY-MM-DD] [--out DIR] [--push]
//   tsx scripts/backfill.ts --save-reference DIR [--edition YYYY-MM-DD]
// `--pace` builds the whole weekly state from 2015-01-05 to D's `data_cutoff` (D is the run's Taipei date, or the earlier edition date `--to` names,
// whose cutoff must be on or after the baseline's end, 2019-12-29), fetching every week through the OpenAlex client, oldest week first, so a stop
// leaves the oldest weeks done and the newest, provisional ones for the last. It then writes `metrics/D.json` and `metrics/inputs/D.json` from
// that state without refetching or changing it (`runMetrics({ frozen })`), unless `content/metrics/D.json` exists (it then prints
// `metrics/D.json exists`). Before go-live it writes into a phase PR with `--out content`; the default folder is `cache/staged/backfill/`, emptied
// first. A rerun on the same Taipei date leaves the state byte-identical: every answer of that date is reused (§5.4), and an answer of an earlier
// date is reused only when it was fetched on or after its week's last morning (never with `--refresh`).
//
// A refused request stops the run cleanly (§5.1: the daily budget of a free key is 10,000 credits and the backfill needs about 13,600): the weeks
// done are in `cache/openalex/`, the message says when the budget resets, and the same command run again after that reads them from the cache. A
// resumed run never takes `--refresh`, which would refetch the first day's answers (§5.4).
//
// `--push` (after go-live; a usage error with `--out` or `--to`) is refused, before any work, in a worktree, off `main`, with uncommitted changes or
// from 02:00 to 04:30 Taipei, and writes no metrics file. After the build it stages the state in `cache/staged/backfill/`, takes the run lock
// (`logs/.lock`; refused while a run holds it) and has publish's `publishState()` (§8.7) commit it, unless the build ended from 03:00 to 04:30:
// then it publishes nothing (exit 1) and a rerun from 04:30 reuses that day's answers. `scripts/publish.ts` is P3's: `runBackfill()` takes
// `publishState` as a dependency, and P3 wires the real one into `main()` (marked there); without it `--push` is refused before any work.
//
// `--save-reference DIR` (run once on Kobol after the backfill, no network) writes the reference files of Appendix D from `content/` and the answer
// cache: `DIR/reference/pace-reference.json`, `DIR/openalex/index.json` and the 136 answers (`scripts/lib/reference.ts`); `DIR` is the fixtures folder.
// The edition is `--edition D`, else the newest one whose manifest holds the baseline's first week (a backfill's, not a morning's).
//
// Left out, and named: `--catch-up` and `--credits` (P3 and P5; the spec's sentence in §8.4 is for `--pace` only).
//
// Cyber's scripts/backfill.ts at the fork commit 3ced1fb, adapted: the shape of `runBackfill(options, deps)`, its exit codes (0 done, 1 failed or
// refused, 2 usage), the staged folder emptied first, `--out content` deleting nothing, `--push`'s guards and its run lock, and the commit through
// `publishState()` are Cyber's; the OpenAlex build, the stop on a refused request, `--to`'s rules and `--save-reference` are this project's.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CONFIG_DIR, loadConfig } from "../lib/config";
import { contentDir } from "../lib/content";
import { isValidDate, taipeiTime, taipeiToday } from "../lib/dates";
import { cachePaths } from "../lib/feeds/cache";
import { byCodeUnit } from "../lib/ids";
import { jsonText } from "../lib/json";
import { applyWeeks, paceVersions, weeksToFetch } from "../lib/metrics/index";
import { dataCutoff } from "../lib/metrics/pace";
import type { IsoDate } from "../lib/schema/common";
import { InputsManifest, PACE_BASELINE, PaceWeeklyFile, type OpenAlexRequest } from "../lib/schema/metrics";
import { git } from "./lib/git";
import { acquireLock, releaseLock } from "./lib/lock";
import type { FeedCtx } from "./lib/feeds";
import { OpenAlexError, createOpenAlexClient, paceQuery, readOpenAlexKey, weekInputs } from "./lib/openalex";
import { ReferenceBuildError, writeReference } from "./lib/reference";
import { runMetrics } from "./metrics";

/** The folder the build stages into unless `--out` names another (§8.4); `--push` commits from it. */
export const DEFAULT_OUT = cachePaths(".").stagedBackfill;

export const USAGE = "Usage: npm run backfill -- --pace [--refresh] [--to YYYY-MM-DD] [--out DIR] [--push]\n"
  + "       npm run backfill -- --save-reference DIR [--edition YYYY-MM-DD]";

export interface BackfillOptions {
  /** The repository root. */
  root: string;
  /** Build the weekly state (the one mode of this phase besides `saveReference`). */
  pace: boolean;
  /** Refetch every answer not fetched today, even one fetched on or after its week's last morning. Never on a resumed day. */
  refresh: boolean;
  /** An earlier edition date than today; null: today. */
  to: IsoDate | null;
  /** Where the files go, as given (relative to `root` or absolute); null: `DEFAULT_OUT`. */
  out: string | null;
  /** Publish the state through `publishState()` after the build (after go-live). */
  push: boolean;
  /** The fixtures folder to write the reference files into; null: not this mode. */
  saveReference: string | null;
  /** `--save-reference` only: the backfill's edition date; null: the newest edition whose manifest starts at the baseline. */
  edition: IsoDate | null;
}

/** What `publishState()` is asked (SPEC §8.7; P3's scripts/publish.ts writes it): the staged state, the edition date and the cutoff it ends with. */
export interface PublishStateOptions {
  root: string;
  /** The run's Taipei date. */
  date: IsoDate;
  /** `cache/staged/backfill/`: the state to commit is `state/pace-weekly.json` under it. */
  stagedDir: string;
  /** The state's `data_cutoff`: the commit's subject is `state: pace to <cutoff>`. */
  cutoff: IsoDate;
  deadline: number;
  now: () => number;
  dryRun: false;
  repo?: string;
  log: (line: string) => void;
}

/** `sha` null when `content/state/` already held this state; `files` the paths committed. */
export type PublishStateFn = (o: PublishStateOptions) => Promise<{ sha: string | null; files: string[] }>;

export interface BackfillDeps {
  print: (line: string) => void;
  /** The one clock: the run's Taipei date, `computed_at`, the push window checks. */
  now: () => Date;
  /** The OpenAlex key (added on the wire only); null: keyless. The command line passes the keychain's. */
  apiKey: string | null;
  /** publish's `publishState()`; null until P3 wires it, which refuses `--push`. */
  publishState: PublishStateFn | null;
  /** An origin URL besides GitHub's that `publishState()` accepts (tests: a bare remote's path). */
  repo?: string;
  /** The counters' readers' context (`runMetrics`). */
  feedCtx?: Partial<FeedCtx>;
}

/** A command line the backfill does not run (`parseBackfillArgs()` throws it; `runBackfill()` answers it with exit 2). */
export class UsageError extends Error {}
class Refused extends Error {}

const failed = (lines: string[], print: (l: string) => void): 1 => {
  for (const l of lines) print(l);
  return 1;
};

/** The first line of a message cut at 300 characters. */
const brief = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);

// ── Arguments ────────────────────────────────────────────────────────────────────────────────────

/** The command line as options; throws `UsageError` for any combination the backfill does not run (§8.4). */
export function parseBackfillArgs(argv: readonly string[], root: string): BackfillOptions {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv], strict: true, allowPositionals: false,
      options: {
        pace: { type: "boolean" }, refresh: { type: "boolean" }, to: { type: "string" }, out: { type: "string" }, push: { type: "boolean" },
        "save-reference": { type: "string" }, edition: { type: "string" },
      },
    }));
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const o: BackfillOptions = {
    root: path.resolve(root), pace: values.pace === true, refresh: values.refresh === true,
    to: (values.to as string | undefined) ?? null, out: (values.out as string | undefined) ?? null, push: values.push === true,
    saveReference: (values["save-reference"] as string | undefined) ?? null, edition: (values.edition as string | undefined) ?? null,
  };
  if (o.saveReference !== null) {
    if (o.saveReference === "") throw new UsageError("--save-reference takes the fixtures folder to write into.");
    if (o.pace || o.refresh || o.to !== null || o.out !== null || o.push) throw new UsageError("--save-reference is a run of its own: it goes with --edition only.");
    if (o.edition !== null && !isValidDate(o.edition)) throw new UsageError(`--edition takes a date, YYYY-MM-DD (got ${o.edition}).`);
    return o;
  }
  if (o.edition !== null) throw new UsageError("--edition goes with --save-reference.");
  if (!o.pace) throw new UsageError("--pace is required: it builds the weekly Pace state (--catch-up and --credits are not part of this phase).");
  if (o.push && (o.out !== null || o.to !== null)) throw new UsageError("--push publishes the default staging folder for today's edition: leave out --out and --to.");
  if (o.to !== null && !isValidDate(o.to)) throw new UsageError(`--to takes a date, YYYY-MM-DD (got ${o.to}).`);
  if (o.out === "") throw new UsageError("--out takes a folder.");
  return o;
}

/**
 * `--to`'s rule (§8.4): an edition date earlier than today whose `data_cutoff` is on or after the baseline's end. Anything else is a usage error:
 * the state it would build would not hold the baseline.
 */
function checkTo(to: IsoDate, today: IsoDate): void {
  if (to >= today) throw new UsageError(`--to names an earlier edition date than today (${today}); leave it out for today's.`);
  const cutoff = dataCutoff(to);
  if (cutoff < PACE_BASELINE.to) {
    throw new UsageError(`--to ${to} has data to ${cutoff}, before the baseline ends (${PACE_BASELINE.to}): the earliest edition date is the one whose data cutoff is ${PACE_BASELINE.to}.`);
  }
}

// ── --push's guards (§8.4) ───────────────────────────────────────────────────────────────────────

/** Refuses before any work: from 02:00 to 04:30 Taipei, in a worktree, off `main`, or with uncommitted changes. */
async function pushGuards(root: string, now: Date): Promise<void> {
  const t = taipeiTime(now);
  if (t >= "02:00" && t < "04:30") throw new Refused(`--push is refused from 02:00 to 04:30 Taipei (now ${t}): its hour of requests and its push must stay clear of 03:00 to 04:30.`);
  const g = git(root);
  let dir: string;
  let common: string;
  let branch: string;
  let status: string;
  try {
    [dir, common, branch, status] = await Promise.all([
      g(["rev-parse", "--absolute-git-dir"]), g(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      g(["rev-parse", "--abbrev-ref", "HEAD"]), g(["status", "--porcelain"]),
    ]);
  } catch (e) {
    throw new Refused(`--push needs the main checkout, and git could not be read here: ${brief(e)}`);
  }
  if (path.resolve(dir) !== path.resolve(common)) throw new Refused("--push runs in the main checkout, not a worktree.");
  if (branch !== "main") throw new Refused(`--push runs on main (this checkout is on ${branch}).`);
  if (status !== "") throw new Refused("--push needs a clean checkout: commit or stash the changes first.");
}

// ── The build ────────────────────────────────────────────────────────────────────────────────────

function writeFile(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

async function buildPace(o: BackfillOptions, d: BackfillDeps): Promise<0 | 1> {
  const root = o.root;
  const now = d.now();
  const today = taipeiToday(now);
  const date = o.to ?? today;
  const cutoff = dataCutoff(date);
  const config = loadConfig(path.join(root, CONFIG_DIR));
  const settings = config.run.pace;
  const plan = weeksToFetch(null, cutoff, settings, "backfill");
  const weeks = [...plan.weeks].reverse();

  const client = createOpenAlexClient({
    cacheDir: cachePaths(root).openalexDir, query: paceQuery(config.index), provisionalWeeks: settings.provisional_weeks, today, refresh: o.refresh,
    apiKey: d.apiKey, now: d.now,
  });
  d.print(`Backfill ${date}: ${weeks.length} weeks, ${weeks[0]} to ${weeks.at(-1)} (data to ${cutoff}).`);
  if (d.apiKey === null) {
    d.print("No OpenAlex key was found in the keychain, so the run is keyless: its budget is about 1,000 credits a day and the backfill needs about 13,600 (SPEC §5.1, §9.6).");
  }
  const requests: OpenAlexRequest[] = [];
  let done = 0;
  for (const monday of weeks) {
    try {
      requests.push(...weekInputs(await client.fetchWeek(monday)));
    } catch (e) {
      const s = client.stats();
      d.print(`Backfill stopped at the week of ${monday}: ${done} of ${weeks.length} weeks done (${s.requests} requests, ${s.cache_hits} cached, ${s.credits} credits this run).`);
      d.print(e instanceof OpenAlexError ? e.message : brief(e));
      d.print(e instanceof OpenAlexError && e.kind === "budget"
        ? "The answers fetched are kept in cache/openalex/. Run the same command again after the budget resets, without --refresh."
        : "The answers fetched are kept in cache/openalex/; run the same command again.");
      return 1;
    }
    done += 1;
    if (done % 52 === 0 && done < weeks.length) d.print(`Backfill: ${done} of ${weeks.length} weeks done, to the week of ${monday}.`);
  }
  const s = client.stats();
  d.print(`Pace: ${weeks.length} weeks fetched or read from the cache (${s.requests} requests, ${s.cache_hits} cached, ${s.credits} credits).`);
  const state = applyWeeks(null, requests, { cutoff, updated: today, versions: paceVersions(config.versions), settings });
  const stateText = jsonText(state, PaceWeeklyFile);

  const out = path.resolve(root, o.out ?? DEFAULT_OUT);
  if (out === cachePaths(root).stagedBackfill) fs.rmSync(out, { recursive: true, force: true });
  writeFile(path.join(out, "state", "pace-weekly.json"), stateText);
  const wrote = ["state/pace-weekly.json"];

  if (!o.push) {
    const r = await runMetrics({
      date, root, out: o.out ?? DEFAULT_OUT, frozen: { state, requests }, now, apiKey: null, ...(d.feedCtx === undefined ? {} : { feedCtx: d.feedCtx }),
    });
    for (const l of r.lines) d.print(l);
    if (r.code !== 0) return 1;
    wrote.push(...r.wrote);
    d.print(`Backfill wrote ${wrote.length} files to ${path.relative(root, out) || "."}.`);
    return 0;
  }

  d.print(`Backfill wrote ${wrote.length} state file to ${path.relative(root, out) || "."}.`);
  const t = taipeiTime(d.now());
  if (t >= "03:00" && t < "04:30") {
    return failed([`The build ended at ${t} Taipei, inside 03:00 to 04:30: nothing was published. Run the same command again from 04:30; today's answers are reused.`], d.print);
  }
  const lockFile = path.join(root, "logs", ".lock");
  const lock = acquireLock(lockFile, d.now().getTime());
  if (!lock.acquired) {
    return failed([`The run lock is held (pid ${lock.holder.pid} since ${lock.holder.started}): nothing was published.`], d.print);
  }
  try {
    const r = await d.publishState!({
      root, date: today, stagedDir: out, cutoff, deadline: Number.POSITIVE_INFINITY, now: () => d.now().getTime(), dryRun: false,
      ...(d.repo === undefined ? {} : { repo: d.repo }), log: d.print,
    });
    d.print(r.sha === null ? "Nothing was published: content/state/ already holds this state." : `Published ${r.files.length} state files to main as ${r.sha.slice(0, 7)}.`);
    return 0;
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    d.print(`Nothing was published: ${typeof code === "string" ? code : brief(e)}.`);
    return 1;
  } finally {
    releaseLock(lockFile);
  }
}

// ── --save-reference ─────────────────────────────────────────────────────────────────────────────

/** The newest edition in `content/metrics/` whose manifest holds the baseline's first week: a backfill's, not a morning's. Null when there is none. */
function backfillEdition(root: string): IsoDate | null {
  const content = path.resolve(root, contentDir());
  let names: string[];
  try {
    names = fs.readdirSync(path.join(content, "metrics", "inputs"));
  } catch {
    return null;
  }
  const dates = names.map((n) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(n)?.[1]).filter((n): n is string => n !== undefined).sort(byCodeUnit).reverse();
  for (const date of dates) {
    try {
      const m = InputsManifest.safeParse(JSON.parse(fs.readFileSync(path.join(content, "metrics", "inputs", `${date}.json`), "utf8")));
      if (m.success && m.data.openalex.some((r) => r.week_start === PACE_BASELINE.from)) return date;
    } catch {
      // A manifest that does not read is no backfill's.
    }
  }
  return null;
}

function saveReference(o: BackfillOptions, d: BackfillDeps): 0 | 1 {
  const date = o.edition ?? backfillEdition(o.root);
  if (date === null) return failed([`No edition in content/metrics/inputs/ starts at the baseline (${PACE_BASELINE.from}): run the backfill first, or name the edition with --edition.`], d.print);
  try {
    const r = writeReference({ root: o.root, date, out: o.saveReference! });
    d.print(`Reference of ${date}: ${r.answers} answers for ${r.weeks} weeks, and pace-reference.json (known_differences ${r.keptKnownDifferences ? "kept from the file there" : "the defaults of scripts/lib/reference.ts"}).`);
    d.print(`Wrote ${r.wrote.length} files to ${path.relative(o.root, path.resolve(o.root, o.saveReference!)) || "."}.`);
    return 0;
  } catch (e) {
    if (e instanceof ReferenceBuildError) return failed([e.message], d.print);
    throw e;
  }
}

// ── runBackfill and the CLI ──────────────────────────────────────────────────────────────────────

function defaults(d: Partial<BackfillDeps>): BackfillDeps {
  return {
    print: d.print ?? ((line) => process.stdout.write(`${line}\n`)),
    now: d.now ?? (() => new Date()),
    apiKey: d.apiKey ?? null,
    publishState: d.publishState ?? null,
    ...(d.repo === undefined ? {} : { repo: d.repo }),
    ...(d.feedCtx === undefined ? {} : { feedCtx: d.feedCtx }),
  };
}

/** Exit code: 0 done (or `metrics/D.json exists`), 1 failed, stopped or refused, 2 a usage error. */
export async function runBackfill(o: BackfillOptions, deps: Partial<BackfillDeps> = {}): Promise<0 | 1 | 2> {
  const d = defaults(deps);
  try {
    if (o.saveReference !== null) return saveReference(o, d);
    if (o.to !== null) checkTo(o.to, taipeiToday(d.now()));
    if (o.push) {
      await pushGuards(o.root, d.now());
      if (d.publishState === null) throw new Refused("--push needs publish's publishState() (scripts/publish.ts, P3), which is not wired here: nothing was done.");
    }
    return await buildPace(o, d);
  } catch (e) {
    if (e instanceof UsageError) {
      d.print(`${e.message}\n${USAGE}`);
      return 2;
    }
    d.print(brief(e));
    return 1;
  }
}

/**
 * The command line. The only place the keychain's OpenAlex key is read. P3 wires publish's `publishState()` into `deps` here (an import of
 * `./publish` and `publishState: publishState`); until then `--push` is refused before any work.
 */
export async function main(argv: string[] = process.argv.slice(2), deps: Partial<BackfillDeps> = {}, root: string = process.cwd()): Promise<number> {
  let o: BackfillOptions;
  try {
    o = parseBackfillArgs(argv, root);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    process.stderr.write(`${e.message}\n${USAGE}\n`);
    return 2;
  }
  return runBackfill(o, { apiKey: o.pace ? readOpenAlexKey() : null, ...deps });
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void main().then((code) => { process.exitCode = code; });
