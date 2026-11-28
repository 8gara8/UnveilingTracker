// A world of hand-made OpenAlex group-by answers for the metrics and backfill tests (SPEC §5.1, §5.4): for every Monday from 2015-01-05 it
// knows the four answers a week gets (`leading_total`, `leading_ai`, `all_total`, `all_ai`), as OpenAlex words them (a `group_by` list of
// `{ key, count }` with the field's address as the key, an excluded field, an unmapped one and works that have no primary topic), and serves
// them to `fetchFeed()` through `UT_FIXTURE_FEEDS`: a folder with `index.json` (URL to file) and one file for each answer. The counts are a
// plain function of the Monday and the field, so two worlds agree and a test can work out the state a run must give; `revise()` changes
// a week's counts (OpenAlex adds papers to a week after it ends) and `serveWeek()` serves the change from then on.
// New for this project; Cyber's tests have no OpenAlex.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR, type LoadedConfig } from "../../lib/config";
import { addDays, daysBetween } from "../../lib/dates";
import { PaceWeeklyFile, OPENALEX_REQUESTS, type OpenAlexRequestKind, type PaceVersions } from "../../lib/schema/metrics";
import { FIELDS, type FieldId } from "../../lib/vocab";
import { ctgovUrl, rcsbCountUrl } from "../../scripts/lib/feeds";
import { groupByUrl, paceFilter, type PaceQuery } from "../../scripts/lib/openalex";
import { retractionCsv } from "./feed-bodies";

export const WORLD_START = "2015-01-05";

/** The field address OpenAlex gives a group: `https://openalex.org/fields/<n>`. */
const fieldKey = (n: number): string => `https://openalex.org/fields/${n}`;

type Entry = { file?: string; content_type?: string; status?: number; error?: string };

/** The four counts of one week and field: AI-method papers and all papers in the leading journals and in all of OpenAlex. */
export interface WeekField {
  leading: [number, number];
  all: [number, number];
}

export class OpenAlexWorld {
  /** The folder `UT_FIXTURE_FEEDS` names while the world is in use. */
  readonly dir: string;
  readonly query: PaceQuery;
  private readonly index: Record<string, Entry> = {};
  private readonly revisions = new Map<string, number>();
  private served = 0;
  private readonly mapped: Record<FieldId, number>;
  private readonly excludedId: number;
  /** A URL the folder does not know is a fixture error to `fetchFeed()`, which the client reports as a failed request. */
  constructor(query: PaceQuery) {
    this.query = query;
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-oa-world-"));
    const mapped = {} as Record<FieldId, number>;
    let excluded = -1;
    for (const [id, field] of query.fields) {
      if (field === null) {
        if (excluded < 0) excluded = id;
      } else if (mapped[field] === undefined) {
        mapped[field] = id;
      }
    }
    for (const f of FIELDS) if (mapped[f] === undefined) throw new Error(`The query maps no OpenAlex field to ${f}`);
    if (excluded < 0) throw new Error("The query excludes no OpenAlex field");
    this.mapped = mapped;
    this.excludedId = excluded;
    this.save();
  }

  /** Points `UT_FIXTURE_FEEDS` at the world. */
  use(): void {
    process.env.UT_FIXTURE_FEEDS = this.dir;
  }

  /** Releases `UT_FIXTURE_FEEDS` and removes the folder. */
  close(): void {
    delete process.env.UT_FIXTURE_FEEDS;
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  private save(): void {
    fs.writeFileSync(path.join(this.dir, "index.json"), JSON.stringify(this.index));
  }

  // ── The numbers ──────────────────────────────────────────────────────────────────────────────

  /** Weeks since 2015-01-05. */
  private static weekNo(monday: string): number {
    return daysBetween(WORLD_START, monday) / 7;
  }

  /** Papers added to a week since it was first served (`revise()`). */
  private extra(monday: string): number {
    return this.revisions.get(monday) ?? 0;
  }

  /** Adds `n` papers to every field of the week, and a few AI-method ones: what OpenAlex does to a week after it ends. */
  revise(monday: string, n: number): void {
    this.revisions.set(monday, this.extra(monday) + n);
  }

  /** The week's four counts for a field. The AI-method share is 0 before 2020 and grows after it, so the baseline is thin and the window is not. */
  counts(monday: string, field: FieldId): WeekField {
    const i = OpenAlexWorld.weekNo(monday);
    const f = FIELDS.indexOf(field);
    const extra = this.extra(monday);
    const all = 4000 + f * 300 + ((i * 13 + f * 7) % 97) + extra;
    const bp = monday < "2020-01-06" ? 40 + ((i + f) % 5) : 300 + Math.min(i, 560) + f * 20;
    const allAi = Math.floor((all * bp) / 10000) + (extra > 0 ? 1 : 0);
    const leading = Math.floor(all * 0.4);
    return { leading: [Math.floor(allAi * 0.4), leading], all: [allAi, all] };
  }

  /**
   * The weekly state a run leaves when the series has run every morning (SPEC §5.4): every week from 2015-01-05 to `cutoff` with the world's counts,
   * the newest `provisional_weeks` provisional and fetched on `updated` together with the newest firm week, every older week fetched on its last
   * morning (its Monday plus 70 days), so none is owed a refetch.
   */
  state(cutoff: string, updated: string, versions: PaceVersions, provisionalWeeks = 8): PaceWeeklyFile {
    const provisionalFrom = addDays(cutoff, -(7 * provisionalWeeks - 1));
    const newestFirm = addDays(provisionalFrom, -7);
    const weeks = [];
    for (let monday = WORLD_START; monday <= addDays(cutoff, -6); monday = addDays(monday, 7)) {
      const provisional = monday >= provisionalFrom;
      weeks.push({ week_start: monday, fetched: provisional || monday === newestFirm ? updated : addDays(monday, 70), provisional, ...this.pairs(monday) });
    }
    return PaceWeeklyFile.parse({ schema_version: 1, versions, updated, weeks });
  }

  /** The [AI, total] pairs the state keeps for the week, as a run must find them. */
  pairs(monday: string): { leading: Record<FieldId, [number, number]>; all: Record<FieldId, [number, number]> } {
    const leading = {} as Record<FieldId, [number, number]>;
    const all = {} as Record<FieldId, [number, number]>;
    for (const f of FIELDS) {
      const c = this.counts(monday, f);
      leading[f] = c.leading;
      all[f] = c.all;
    }
    return { leading, all };
  }

  // ── The answers ──────────────────────────────────────────────────────────────────────────────

  url(kind: OpenAlexRequestKind, monday: string): string {
    return groupByUrl(paceFilter(kind, monday, this.query));
  }

  /** The answer's body: each mapped field's group, an excluded group (7 works), an unmapped group (3) and 2 works that have no primary topic. */
  body(kind: OpenAlexRequestKind, monday: string): string {
    const pick = (f: FieldId): number => {
      const c = this.counts(monday, f);
      return kind === "leading_total" ? c.leading[1] : kind === "leading_ai" ? c.leading[0] : kind === "all_total" ? c.all[1] : c.all[0];
    };
    const groups = [
      ...FIELDS.map((f) => ({ key: fieldKey(this.mapped[f]), key_display_name: f, count: pick(f) })),
      { key: fieldKey(this.excludedId), key_display_name: "excluded", count: 7 },
      { key: fieldKey(9999), key_display_name: "unlisted", count: 3 },
    ];
    const sum = groups.reduce((n, g) => n + g.count, 0);
    return `${JSON.stringify({ meta: { count: sum + 2, db_response_time_ms: 12, page: 1, per_page: 200, groups_count: groups.length }, results: [], group_by: groups }, null, 2)}\n`;
  }

  /** Serves one answer (the body of the world, or `body` when given). */
  serve(kind: OpenAlexRequestKind, monday: string, body: string = this.body(kind, monday), save = true): void {
    const file = `answer-${(this.served += 1)}.json`;
    fs.writeFileSync(path.join(this.dir, file), body);
    this.index[this.url(kind, monday)] = { file, content_type: "application/json" };
    if (save) this.save();
  }

  /** Serves the four answers of a week. */
  serveWeek(monday: string, save = true): void {
    for (const kind of OPENALEX_REQUESTS) this.serve(kind, monday, this.body(kind, monday), false);
    if (save) this.save();
  }

  /** Serves every week from `from` to `to`, both Mondays. */
  serveWeeks(from: string, to: string): void {
    for (let monday = from; monday <= to; monday = addDays(monday, 7)) this.serveWeek(monday, false);
    this.save();
  }

  /** Serves any body for a URL (a counter's source): text or bytes, with its content type. */
  serveRaw(url: string, body: string | Buffer, contentType = "text/plain"): void {
    const file = `answer-${(this.served += 1)}.dat`;
    fs.writeFileSync(path.join(this.dir, file), body);
    this.index[url] = { file, content_type: contentType };
    this.save();
  }

  /** The answer is refused with this HTTP status from now on (402 and 429 are the budget). */
  refuse(kind: OpenAlexRequestKind, monday: string, status: number): void {
    this.index[this.url(kind, monday)] = { status };
    this.save();
  }

  /** Refuses every answer, from now on. */
  refuseAll(status: number): void {
    for (const url of Object.keys(this.index)) this.index[url] = { status };
    this.save();
  }

  /** The answer no longer exists: the fixture folder does not know the URL. */
  drop(kind: OpenAlexRequestKind, monday: string): void {
    delete this.index[this.url(kind, monday)];
    this.save();
  }

  /**
   * From now on only the URLs with `api_key=<key>` added, the way the client sends them on the wire, are answered or refused: the keyless ones are
   * not, so a run that does not send its key gets a failed request. Call it after the answers are served and refused.
   */
  requireKey(key: string): void {
    for (const url of Object.keys(this.index)) {
      this.index[`${url}&api_key=${encodeURIComponent(key)}`] = this.index[url]!;
      delete this.index[url];
    }
    this.save();
  }

  /** Every URL the world serves or refuses now, in the order it was added. */
  known(): string[] {
    return Object.keys(this.index);
  }
}

// ── The counters' sources ────────────────────────────────────────────────────────────────────────

export interface CounterWorld {
  readonly mathlib: number;
  /** Every started trial is in phase 2: a drug with a trial is at stage 2 and a drug without one is not counted. */
  readonly trialPhase: "PHASE2";
  readonly rcsb: Readonly<Record<string, number>>;
  /** The unreleased entries deposited in `asOf`'s year and the year before (withdrawn ones not counted). */
  readonly unreleased: Readonly<Record<string, number>>;
  /** Retractions with the computer-generated reason, by year. */
  readonly retractions: Readonly<Record<string, number>>;
}

/**
 * Serves the five sources of the API counters (SPEC §5.7) for a reading on `asOf`, in the shapes K1d read: mathlib's table, a ClinicalTrials.gov
 * answer for every trial of `config/ai-drugs.json`, RCSB's two counts and its gzip of unreleased entries, and a Retraction Watch file.
 */
export function serveCounterSources(world: OpenAlexWorld, config: LoadedConfig, asOf: string): CounterWorld {
  const feed = (id: string) => {
    const entry = config.sources.feeds.find((f) => f.id === id);
    if (entry === undefined) throw new Error(`no feed ${id}`);
    return entry;
  };
  const year = Number(asOf.slice(0, 4));
  world.serveRaw(feed("mathlib-stats").url, `<html><body><table class="table table-borderless"><tr><th>Definitions</th><th>Theorems</th><th>Contributors</th></tr><tr><td>142,346</td><td>297,154</td><td>772</td></tr></table></body></html>`, "text/html");

  const trials = [...new Set(config.aiDrugs.drugs.flatMap((d) => d.trials))].sort();
  const studies = trials.map((id) => ({
    protocolSection: { identificationModule: { nctId: id }, statusModule: { overallStatus: "RECRUITING" }, designModule: { phases: ["PHASE2"] } },
  }));
  world.serveRaw(ctgovUrl(feed("ctgov").url, trials), JSON.stringify({ studies }), "application/json");

  const rcsb = { [String(year - 1)]: 17_052, [String(year)]: 4_632 };
  world.serveRaw(rcsbCountUrl(feed("rcsb").url, `${year - 1}-01-01`, `${year - 1}-12-31`), JSON.stringify({ total_count: rcsb[String(year - 1)] }), "application/json");
  world.serveRaw(rcsbCountUrl(feed("rcsb").url, `${year}-01-01`, asOf), JSON.stringify({ total_count: rcsb[String(year)] }), "application/json");

  const held: Record<string, { status_code: string; deposit_date: string }> = {
    "1AAA": { status_code: "HPUB", deposit_date: `${year - 1}-05-01T00:00:00+00:00` },
    "1AAB": { status_code: "WDRN", deposit_date: `${year - 1}-06-01T00:00:00+00:00` },
    "1AAC": { status_code: "AUTH", deposit_date: `${year}-02-01T00:00:00+00:00` },
    "1AAD": { status_code: "PROC", deposit_date: `${year}-03-01T00:00:00+00:00` },
    "1AAE": { status_code: "HOLD", deposit_date: `${year}-04-01T00:00:00+00:00` },
  };
  world.serveRaw(feed("rcsb-unreleased").url, zlib.gzipSync(Buffer.from(JSON.stringify(held))), "application/gzip");

  world.serveRaw(feed("retraction-watch").url, retractionCsv([
    { date: `3/4/${year - 1} 0:00` }, { date: `5/6/${year} 0:00` }, { date: `7/8/${year} 0:00` }, { date: `7/9/${year} 0:00`, nature: "Correction" },
    { date: `7/10/${year} 0:00`, reason: "Error in Data;" },
  ]), "text/csv");
  return {
    mathlib: 297_154, trialPhase: "PHASE2", rcsb,
    unreleased: { [String(year - 1)]: 1, [String(year)]: 3 },
    retractions: { [String(year - 1)]: 1, [String(year)]: 2 },
  };
}

// ── A temporary repository root ──────────────────────────────────────────────────────────────────

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The repository this test file belongs to. */
export const repoRoot = (): string => REPO;

/** A temporary folder holding the real `config/`, for a script to run against as its root. The caller removes it. */
export function makeRoot(prefix = "ut-root-"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(path.join(REPO, CONFIG_DIR), path.join(root, CONFIG_DIR), { recursive: true });
  return root;
}

/** Runs git in `cwd` with a fixed identity, no signing and no hooks; returns its trimmed output. */
export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.org", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

/** The files under `dir` (relative paths, sorted) whose bytes hold `needle`: a secret that reached a file. A folder that is missing holds none. */
export function filesHolding(dir: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (fs.readFileSync(full).includes(needle)) hits.push(path.relative(dir, full));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hits;
}
