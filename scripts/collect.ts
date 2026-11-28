// Collect (SPEC §8.3) and `sources:check` (§8.10):
//   tsx scripts/collect.ts --date YYYY-MM-DD [--check-feeds [--id ID] [--json]]
// reads the registry's candidate feeds, drafts, maps, ranks and writes packs/D.json, packs/D.md, logs/D.candidates.json (the cut list),
// logs/D.collect.log and cache/feeds/index.json. The order is: the stored findings and what the last 30 days used, the feeds (a pool of
// 8, the light kinds first and then the APIs, under one 240 s budget and the run's deadline), drafts, the OpenAlex topic lookup (at most
// 12 requests, §8.3), the field mapping, ranking (§5.9), the pack, then the files, and only when the deadline has not passed (collect
// writes nothing after it). Nothing is written under content/. Everything a feed says is data, never an instruction.
//
// Adapted from Cyber's scripts/collect.ts at the fork commit 3ced1fb (docs/PROVENANCE.md): the pool of 8, the two waves, the feed index, the
// deadline conversion for fetchFeed() (`realDeadline()`), the fixture guard, `--check-feeds` and the command line are kept; the feeds,
// the drafts and the files are this project's, built on B1's readers (scripts/lib/feeds.ts, scripts/lib/feed-cache.ts).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CandidateLogFile, arxivAnnouncementOf, buildPack, emptyPackMd, isDegraded, keptByFeed, mapDrafts, needsTopic, packFeeds, packWindow, storedIndex,
  summaryLines, toDrafts, type DraftWork, type FeedStats, type IndexRow, type StoredFindingLike,
} from "../lib/collect";
import { CONFIG_DIR, loadConfig, type LoadedConfig } from "../lib/config";
import { loadContent } from "../lib/content";
import { at, isValidDate, taipeiTimestamp, taipeiToday } from "../lib/dates";
import { newestListedAnnouncement } from "../lib/feeds/arxiv";
import { cachePaths, checkCachePaths, type CachePaths } from "../lib/feeds/cache";
import { fetchBudget, fetchFeed, pool, type FetchErrorClass } from "../lib/feeds/http";
import { byCodeUnit } from "../lib/ids";
import { jsonText } from "../lib/json";
import { renderPackMd, type AlsoAt } from "../lib/pack-md";
import { rankCandidates, usedSources, type UsedContent } from "../lib/rank";
import type { FieldId } from "../lib/schema/common";
import { Pack } from "../lib/schema/pack";
import type { FeedEntry } from "../lib/schema/registry";
import { realDeadline } from "./lib/clock";
import {
  feedCtx, get, isCandidateFeed, probeDataFeed, readArxivList, readFeed, readerKind, spendOf, type FeedCtx, type FeedData, type FeedRun, type Read,
} from "./lib/feeds";
import {
  FeedIndexFile, candidateFacts, dataFacts, feedIndexEntry, pruneArxivLists, writeFeedIndex, type FeedFacts, type FeedIndexEntry,
} from "./lib/feed-cache";
import { createOpenAlexClient, lookupDois, paceQuery, readOpenAlexKey, type DoiLookup, type OpenAlexClient } from "./lib/openalex";

// ── The run ──────────────────────────────────────────────────────────────────────────────────────

/** The requests of `openalex`'s budget that stage 3 may make (§4.13): collect's DOI lookup may use what is left. */
export const STAGE3_REQUESTS = 88;
/** Feeds read at once (§8.3). */
export const POOL = 8;
/** The cap on one morning's fetching, from its first request (§8.3). */
export const BUDGET_MS = 240_000;
/** A standalone `npm run collect` gets 5 minutes; daily.ts passes its own deadline (P3). */
export const CLI_DEADLINE_MS = 5 * 60_000;
/** `sources:check` reads 60 or so feeds, some of them a request at a time: it gets 10 minutes. */
export const CHECK_BUDGET_MS = 600_000;

export interface CollectOptions {
  /** Taipei edition date. */
  date: string;
  /** Epoch ms on `deps.now`; past it collect throws `CollectTimeout` and writes nothing. */
  deadline: number;
  /** A P3 caller allowing UT_FIXTURE_FEEDS outside tests (dry runs). */
  fixtureOk?: boolean;
  root?: string;
  deps?: Partial<{
    fetch: typeof fetchFeed;
    now: () => number;
    log: (line: string) => void;
    /** The OpenAlex client for the DOI lookup; null reads no topic. Default: a client with the keychain's key (none in a fixture run). */
    openalex: Pick<OpenAlexClient, "request" | "query"> | null;
    /** The stored briefs and findings; default `loadContent()` of the content folder. */
    content: StoredContent;
  }>;
}

export interface CollectResult {
  pack: Pack;
  md: string;
  log: CandidateLogFile;
  index: FeedIndexFile;
  /** The DOI lookup's answer, null when none ran. */
  lookup: DoiLookup | null;
  /** The stdout lines (§8.3). */
  summary: string[];
}

/** Thrown when the deadline passes; nothing is written after it. */
export class CollectTimeout extends Error {
  constructor(message = "collect passed its deadline") {
    super(message);
    this.name = "CollectTimeout";
  }
}

/** UT_FIXTURE_FEEDS set outside a test run (the CLI exits 2). */
export class FixtureGuardError extends Error {
  constructor() {
    super("UT_FIXTURE_FEEDS is set outside a test run; unset it, or run under NODE_ENV=test.");
    this.name = "FixtureGuardError";
  }
}

/** Throws `FixtureGuardError` when UT_FIXTURE_FEEDS is set and this is neither a test run nor a caller that allows it. */
export function fixtureGuard(env: NodeJS.ProcessEnv = process.env, fixtureOk = false): void {
  if (env.UT_FIXTURE_FEEDS && env.NODE_ENV !== "test" && !fixtureOk) throw new FixtureGuardError();
}

/** What collect reads of the stored content (`Content` of lib/content.ts satisfies it): the briefs and findings that §5.9 step 1 and `stored_finding` need. */
export interface StoredContent {
  briefs: UsedContent["briefs"];
  findings: readonly { id: string; sources: readonly { url: string; doi: string | null; added: string }[]; artefacts: StoredFindingLike["artefacts"] }[];
}

/** A read that did not happen: a reader that threw (a bug, never a feed's fault) or a feed not started before the deadline. */
function failedRead(error: FetchErrorClass): Read<FeedData> {
  return {
    ok: false, error, urlUsed: null, triedFallback: false, fallbackUsed: false, sha256: null, bytes: 0, requests: 0, fetched: [], fetchedAt: null, note: null, data: null,
  };
}

/** One candidate feed's read, which never throws: a reader that does is logged and the feed counts as failed. */
async function readOne(entry: FeedEntry, ctx: FeedCtx, run: FeedRun): Promise<Read<FeedData>> {
  if (ctx.now() >= ctx.deadline) {
    ctx.log(`${entry.id}: not read, the deadline has passed`);
    return failedRead("timeout");
  }
  try {
    return await readFeed(entry, ctx, run);
  } catch (e) {
    ctx.log(`${entry.id}: the reader threw: ${(e as Error).message.slice(0, 300)}`);
    return failedRead("parse");
  }
}

/** The context every reader gets: the run's clock, its deadline on the real clock for `fetchFeed()`, one budget and the log. */
function contextFor(root: string, paths: CachePaths, o: {
  fetch: typeof fetchFeed; now: () => number; deadline: number; log: (line: string) => void; budgetMs: number;
}): FeedCtx {
  return feedCtx(root, {
    // The run's deadline and the budget are on `now`; fetchFeed measures its deadline with Date.now(), so it gets realDeadline().
    fetch: (url, opts) => o.fetch(url, opts?.deadline === undefined ? opts : { ...opts, deadline: realDeadline(o.now, opts.deadline) }),
    budget: fetchBudget(o.budgetMs), deadline: o.deadline, now: o.now, log: o.log, paths,
  });
}

/** The two waves (§8.3): the light kinds first, then the APIs, each a pool of 8; the results in the order given. */
async function inTwoWaves<T extends { kind: string }, R>(entries: readonly T[], fn: (entry: T) => Promise<R>): Promise<R[]> {
  const light = entries.filter((e) => e.kind !== "api");
  const heavy = entries.filter((e) => e.kind === "api");
  const done = new Map<T, R>();
  for (const wave of [light, heavy]) {
    const results = await pool(wave, POOL, fn);
    wave.forEach((e, i) => done.set(e, results[i]!));
  }
  return entries.map((e) => done.get(e)!);
}

/** The stored briefs and findings collect reads (§5.9 step 1, §4.14 `stored_finding`): injected, or the content folder as the site loads it. */
function storedContent(root: string, config: LoadedConfig, log: (line: string) => void): StoredContent {
  const dir = path.resolve(root, process.env.UT_CONTENT_DIR || config.run.paths.content_dir);
  const content = loadContent(dir, { config, fresh: true, log });
  return { briefs: content.briefs, findings: content.findings };
}

/** The OpenAlex client of the DOI lookup: the keychain's key outside a fixture run; null when the client cannot be made. */
function lookupClient(root: string, config: LoadedConfig, date: string, now: () => number, deadline: number, fixture: boolean, log: (line: string) => void): Pick<OpenAlexClient, "request" | "query"> | null {
  try {
    return createOpenAlexClient({
      cacheDir: cachePaths(root).openalexDir, query: paceQuery(config.index), provisionalWeeks: config.run.pace.provisional_weeks, today: date,
      apiKey: fixture ? null : readOpenAlexKey(), now: () => new Date(now()), deadline: realDeadline(now, deadline),
    });
  } catch (e) {
    log(`openalex: no client for the DOI lookup (${(e as Error).message.slice(0, 200)})`);
    return null;
  }
}


/** Where each kept candidate also stands: its merged copies' addresses, by the survivor's url. A copy whose survivor was cut has nowhere to be shown. */
export function alsoAtOf(merged: readonly { into: string | null; url: string; source_id: string }[]): Map<string, AlsoAt[]> {
  const out = new Map<string, AlsoAt[]>();
  for (const m of merged) {
    if (m.into === null) continue;
    out.set(m.into, [...(out.get(m.into) ?? []), { url: m.url, source_id: m.source_id }]);
  }
  return out;
}

/** §8.3's run. Throws `CollectTimeout` past the deadline, writing nothing then. */
export async function collect(o: CollectOptions): Promise<CollectResult> {
  if (!isValidDate(o.date)) throw new Error(`collect: invalid date ${o.date}`);
  fixtureGuard(process.env, o.fixtureOk);
  const now = o.deps?.now ?? Date.now;
  if (now() >= o.deadline) throw new CollectTimeout("collect started past its deadline; nothing written");
  const root = path.resolve(o.root ?? process.cwd());
  const lines: string[] = [];
  const log = (line: string): void => {
    lines.push(line);
    o.deps?.log?.(line);
  };
  const fixture = Boolean(process.env.UT_FIXTURE_FEEDS);
  const config = loadConfig(path.join(root, CONFIG_DIR));
  const run = config.run;
  const D = o.date;
  const window = packWindow(D, run.pack);
  const generatedAt = taipeiTimestamp(new Date(now()));
  const refMs = at(D, run.pack.window_end);
  const paths = cachePaths(root);

  // An index of an earlier run is removed first, so a run that dies leaves none rather than another run's; the new one is written last.
  fs.rmSync(paths.feedIndex, { force: true });
  fs.mkdirSync(paths.feedsDir, { recursive: true });

  const stored = o.deps?.content ?? storedContent(root, config, log);
  const storedKeys = storedIndex(stored.findings);
  const used = usedSources(stored, D);

  const ctx = contextFor(root, paths, { fetch: o.deps?.fetch ?? fetchFeed, now, deadline: o.deadline, log, budgetMs: BUDGET_MS });
  const feedRun: FeedRun = {
    date: D, window, arxivSkipped: config.sources.arxiv_skipped, aiPhrases: config.index.aiPhrases,
    journals: config.journals.journals.map((j) => ({ id: j.id, issn: j.issn })),
  };
  const entries = config.sources.feeds.filter((f) => isCandidateFeed(f));
  const reads = await inTwoWaves(entries, (entry) => readOne(entry, ctx, feedRun));

  // Feed states, from the reads: one row for each registry entry, in registry order (a feed collect does not read is `skipped`).
  const readOf = new Map(entries.map((e, i) => [e.id, reads[i]!]));
  const index: FeedIndexFile = {
    schema_version: 1, date: D, generated_at: generatedAt,
    feeds: config.sources.feeds.map((e): FeedIndexEntry => {
      const r = readOf.get(e.id);
      return feedIndexEntry(e, r === undefined ? null : candidateFacts(e, r, refMs), refMs);
    }),
  };

  // Drafts.
  const drafts: DraftWork[] = [];
  const stats: FeedStats[] = [];
  entries.forEach((entry, i) => {
    const data = reads[i]!.data;
    if (data === null) return;
    const made = toDrafts(entry, [...data.items, ...data.lookback], {
      window, lookbackHours: run.pack.lookback_hours, config,
    });
    drafts.push(...made.drafts);
    stats.push({ ...made.stats, items: data.total + data.lookback.length });
    for (const part of data.unread) log(`${entry.id}: not read, ${part}`);
  });

  // The OpenAlex topics of the DOIs of the drafts that need one (§8.3): at most what `openalex`'s budget leaves after stage 3's 88.
  let lookup: DoiLookup | null = null;
  const asking = drafts.filter(needsTopic);
  const alex = config.sources.feeds.find((f) => f.id === "openalex");
  const client = o.deps && "openalex" in o.deps ? o.deps.openalex ?? null : lookupClient(root, config, D, now, o.deadline, fixture, log);
  if (asking.length > 0 && alex !== undefined && client !== null && now() < o.deadline) {
    try {
      lookup = await lookupDois(client, asking, { maxRequests: Math.max(0, alex.budget - STAGE3_REQUESTS) });
      const s = lookup.stats;
      log(`openalex: ${s.asked} of ${s.askable} DOIs asked in ${s.requests} requests (${s.failed_requests} failed); ${s.mapped} took a field, ${s.not_indexed} not indexed yet.`);
    } catch (e) {
      log(`openalex: the DOI lookup failed (${(e as Error).message.slice(0, 200)}); its candidates fall to the journal and the arXiv category.`);
    }
  }

  const { mapped, noField } = mapDrafts(drafts, lookup?.fields ?? new Map<string, FieldId>(), storedKeys, config.journals.journals);
  const ranked = rankCandidates({
    drafts: mapped, used, config, aiPhrases: config.index.aiPhrases,
    limits: { candidates_max: run.budgets.candidates_max, deep_read_max: run.budgets.deep_read_max },
  });

  // The pack.
  const rows: IndexRow[] = index.feeds;
  const priority = new Map(config.sources.feeds.map((f) => [f.id, f.priority]));
  const degraded = isDegraded(rows.map((r) => ({ status: r.status, priority: priority.get(r.id) ?? 3 })));
  const arxivReads = entries.flatMap((e, i) => (e.id.startsWith("arxiv-") && reads[i]!.ok && reads[i]!.data !== null ? [reads[i]!.data!] : []));
  const pack = buildPack({
    date: D, window, generatedAt, arxivAnnouncement: arxivAnnouncementOf(arxivReads), degraded,
    feeds: packFeeds(rows, keptByFeed(ranked.kept)), candidates: ranked.kept,
  });
  const md = renderPackMd(pack, { alsoAt: alsoAtOf(ranked.merged), standingStories: config.standingStories.stories });
  const candidateLog = CandidateLogFile.parse({
    schema_version: 1, date: D, ranked: ranked.ranked, kept: ranked.kept.map((c) => c.id), merged: ranked.merged, cut: ranked.cut, dropped: ranked.dropped,
    no_field: noField.map((d) => ({ source_id: d.source_id, url: d.url, title: d.title })).sort((a, b) => byCodeUnit(a.url, b.url) || byCodeUnit(a.source_id, b.source_id)),
    feeds: stats.map((s) => ({ ...s })), log: ranked.log,
  });
  const summary = summaryLines({ pack, feeds: rows });

  // The files, unless the deadline has passed; the feed index last, so it exists only when everything before it was written.
  if (now() >= o.deadline) throw new CollectTimeout();
  const logs = path.join(root, run.paths.logs);
  const outputs: [string, string][] = [
    [path.join(root, run.paths.packs, `${D}.json`), jsonText(pack, Pack)],
    [path.join(root, run.paths.packs, `${D}.md`), md],
    [path.join(logs, `${D}.candidates.json`), jsonText(candidateLog, CandidateLogFile)],
  ];
  const pruned = pruneArxivLists(paths, now());
  if (pruned.length > 0) log(`arxiv: removed ${pruned.length} list${pruned.length === 1 ? "" : "s"} older than 60 days.`);
  outputs.push([path.join(logs, `${D}.collect.log`), `${[...lines, ...summary].join("\n")}\n`]);
  for (const [file, text] of outputs) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  writeFeedIndex(paths, index);
  return { pack, md, log: candidateLog, index, lookup, summary };
}

/** The pack Markdown of a collect that gathered nothing (`emptyPackMd()` of lib/collect.ts), re-exported for the morning run's stage 2 failure path. */
export { emptyPackMd };

// ── sources:check (§8.10) ────────────────────────────────────────────────────────────────────────

/** One row of §8.10's table. */
export interface CheckRow {
  id: string;
  kind: string;
  /** `OK`, `STALE`, `NODATE`, `FAIL` or `SKIP`. */
  state: FeedIndexEntry["label"];
  /** `ok`, or the error class (`http_503`, `timeout`, `dns`, ...); `-` for a feed not read. */
  status: string;
  bytes: number;
  items: number;
  records: number;
  newest: string | null;
  /** "yes", "no (N d)" or "-". */
  fresh: string;
  priority: 1 | 2 | 3;
  requests: number;
  /** How long the entry's read took on the run's clock, in ms: what its wait in a host's queue and its retries add is in it, so a feed's timeout can be judged from it (SPEC §4.13). */
  ms: number;
  /** The fixed note (never raw error text), or null. */
  problem: string | null;
}

const DAY_MS = 86_400_000;

/**
 * The `fresh` column: `yes` for a fresh feed, `no (N d)` for one whose newest item is N days old, `-` when there is no date or no judgement (`judged` false: the
 * feed has no `fresh_days`, so its newest date proves nothing).
 */
export function freshColumn(label: CheckRow["state"], newest: string | null, refMs: number, judged = true): string {
  if (!judged || newest === null || label === "SKIP" || label === "FAIL") return "-";
  if (label === "OK") return "yes";
  const ms = Date.parse(newest);
  return Number.isNaN(ms) ? "-" : `no (${Math.max(0, Math.floor((refMs - ms) / DAY_MS))} d)`;
}

/** True for a row that fails a check: a priority-1 feed that is `FAIL`, `NODATE` or `STALE`. */
export const isProblem = (row: Pick<CheckRow, "priority" | "state">): boolean => row.priority === 1 && (row.state === "FAIL" || row.state === "NODATE" || row.state === "STALE");

/** What `sources:check` asks a feed that gives no candidates: ids for the two that need them (a stable trial and a stable DOI), else nothing. */
export const CHECK_PROBE: { ncts: readonly string[]; dois: readonly string[] } = { ncts: ["NCT04280705"], dois: ["10.1038/nature14539"] };

/** The facts of one registry entry's check read, or null when there is nothing to read (`parser: none`, no reader). */
async function checkOne(entry: FeedEntry, ctx: FeedCtx, run: FeedRun, refMs: number, skipped: readonly string[]): Promise<FeedFacts | null> {
  const kind = readerKind(entry);
  if (kind === null || kind === "none") return null;
  try {
    if (kind === "arxiv") {
      // The newest announcement the API already lists: the one before the last midnight US Eastern (§4.13).
      const list = newestListedAnnouncement(refMs, skipped);
      const spend = spendOf(entry);
      const r = await readArxivList(entry, ctx, spend, list, { fallback: true });
      const read = {
        ok: r.ok, error: r.error, urlUsed: r.urlUsed, triedFallback: r.triedFallback, fallbackUsed: r.fallbackUsed, sha256: r.sha256, bytes: r.bytes, requests: spend.used,
        fetchedAt: r.fetched[0]?.fetched_at ?? null, note: r.note,
      };
      return { read, newest: r.ok && r.entries > 0 ? list.announcedAt : null, items: r.entries, records: r.items.length };
    }
    if (isCandidateFeed(entry)) return candidateFacts(entry, await readFeed(entry, ctx, run), refMs);
    if (kind === "openalex") {
      const spend = spendOf(entry);
      const r = await get(ctx, spend, `${entry.url}?per-page=1&select=id`);
      const read = {
        ok: r.ok, error: r.ok ? null : r.error, urlUsed: r.finalUrl, triedFallback: false, fallbackUsed: false, sha256: null, bytes: r.body?.length ?? 0, requests: spend.used,
        fetchedAt: taipeiTimestamp(new Date(ctx.now())), note: null,
      };
      return dataFacts(read, null, r.ok ? 1 : 0);
    }
    const r = await probeDataFeed(entry, ctx, run);
    if (r === null) return null;
    const data = r.data as { newest?: string | null; length?: number; size?: number; notices?: unknown[] } | null;
    const newest = data !== null && typeof data === "object" && typeof data.newest === "string" ? data.newest : null;
    const records = data === null ? 0 : Array.isArray(data) ? data.length : data instanceof Map ? data.size : Array.isArray(data.notices) ? data.notices.length : 1;
    return dataFacts(r, newest, records);
  } catch (e) {
    ctx.log(`${entry.id}: the check read threw: ${(e as Error).message.slice(0, 300)}`);
    const read = failedRead("parse");
    return { read, newest: null, items: 0, records: 0 };
  }
}

/**
 * §8.10: every registry entry (or `id`) read with collect's harness and parsers, no pack written; the bodies go to `cache/check/`, never to collect's
 * `cache/feeds/`. Freshness is judged at the clock. Exit code 1 when a priority-1 row is `FAIL`, `NODATE` or `STALE`.
 */
export async function checkFeeds(o: {
  id?: string; root?: string; now?: () => number;
  /** The trial and DOI numbers the two feeds that need some are asked for; default `CHECK_PROBE`. */
  probe?: { ncts: readonly string[]; dois: readonly string[] };
  deps?: Partial<{ fetch: typeof fetchFeed; log: (line: string) => void }>;
}): Promise<{ rows: CheckRow[]; exitCode: 0 | 1 }> {
  fixtureGuard(process.env, false);
  const root = path.resolve(o.root ?? process.cwd());
  const config = loadConfig(path.join(root, CONFIG_DIR));
  const now = o.now ?? Date.now;
  const refMs = now();
  const date = taipeiToday(new Date(refMs));
  const paths = checkCachePaths(root);
  const ctx = contextFor(root, paths, {
    fetch: o.deps?.fetch ?? fetchFeed, now, deadline: refMs + 10 * 60_000, log: o.deps?.log ?? (() => {}), budgetMs: CHECK_BUDGET_MS,
  });
  const run: FeedRun = {
    date, window: packWindow(date, config.run.pack), arxivSkipped: config.sources.arxiv_skipped, aiPhrases: config.index.aiPhrases,
    journals: config.journals.journals.map((j) => ({ id: j.id, issn: j.issn })), probe: { ncts: [...(o.probe ?? CHECK_PROBE).ncts], dois: [...(o.probe ?? CHECK_PROBE).dois] },
  };
  const entries = config.sources.feeds.filter((f) => o.id === undefined || f.id === o.id);
  if (o.id !== undefined && entries.length === 0) throw new Error(`sources:check: no registry entry "${o.id}"`);
  const rows = await inTwoWaves(entries, async (entry): Promise<CheckRow> => {
    const began = now();
    const facts = await checkOne(entry, ctx, run, refMs, config.sources.arxiv_skipped);
    const ms = Math.max(0, now() - began);
    const row = feedIndexEntry(entry, facts, refMs);
    return {
      id: row.id, kind: row.kind, state: row.label, status: facts === null ? "-" : row.status === "failed" ? (row.error_class ?? "network") : "ok",
      bytes: row.bytes, items: row.items, records: row.records, newest: row.newest, fresh: freshColumn(row.label, row.newest, refMs, entry.fresh_days !== null),
      priority: entry.priority, requests: row.requests, ms, problem: row.note,
    };
  });
  return { rows, exitCode: rows.some(isProblem) ? 1 : 0 };
}

const COLUMNS = ["id", "state", "status", "bytes", "items", "newest", "fresh", "time", "problem"] as const;

/** A time in ms as seconds with one decimal ("0.0", "12.3"), on integers (no toFixed): the tenth of a second is rounded half up. */
export function secondsText(ms: number): string {
  const tenths = Math.floor(ms / 100 + 0.5);
  return `${Math.floor(tenths / 10)}.${tenths % 10} s`;
}

/** §8.10's table: the nine columns padded to their widest cell, then "N of M entries ok; K priority-1 problems." (M counts the entries read). */
export function formatCheckTable(rows: readonly CheckRow[]): string {
  const cells = rows.map((r) => [r.id, r.state, r.status, String(r.bytes), String(r.items), r.newest ?? "-", r.fresh, r.state === "SKIP" ? "-" : secondsText(r.ms), r.problem ?? "-"]);
  const width = COLUMNS.map((name, i) => Math.max(name.length, ...cells.map((c) => c[i]!.length)));
  const line = (c: readonly string[]): string => c.map((cell, i) => (i === c.length - 1 ? cell : cell.padEnd(width[i]!))).join("  ");
  const read = rows.filter((r) => r.state !== "SKIP");
  const ok = read.filter((r) => r.state === "OK").length;
  const problems = rows.filter(isProblem).length;
  return `${[line(COLUMNS), ...cells.map(line), `${ok} of ${read.length} entries ok; ${problems} priority-1 problem${problems === 1 ? "" : "s"}.`].join("\n")}\n`;
}

// ── The command line ─────────────────────────────────────────────────────────────────────────────

const USAGE = "Usage: tsx scripts/collect.ts --date YYYY-MM-DD [--check-feeds [--id ID] [--json]]";

export interface MainOptions {
  env?: NodeJS.ProcessEnv;
  io?: { out: (s: string) => void; err: (s: string) => void };
  /** The repository root (default the working directory). */
  root?: string;
}

/**
 * The CLI: 0 when the pack was written (degraded or not), 1 when it could not be, 2 for usage and for UT_FIXTURE_FEEDS outside a test run.
 * `--check-feeds` exits 1 when a priority-1 row is `FAIL`, `NODATE` or `STALE`, and 2 for a usage error. Never calls process.exit.
 */
export async function main(argv: string[] = process.argv.slice(2), opts: MainOptions = {}): Promise<number> {
  const env = opts.env ?? process.env;
  const io = opts.io ?? { out: (s: string) => console.log(s), err: (s: string) => console.error(s) };
  const root = opts.root ?? process.cwd();
  let date: string | null = null;
  let check = false;
  let id: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--date") date = argv[++i] ?? "";
    else if (a === "--check-feeds") check = true;
    else if (a === "--id") id = argv[++i] ?? "";
    else if (a === "--json") json = true;
    else {
      io.err(`Unknown argument ${JSON.stringify(a)}. ${USAGE}`);
      return 2;
    }
  }
  if (date !== null && !isValidDate(date)) {
    io.err(`--date wants YYYY-MM-DD, got ${JSON.stringify(date)}. ${USAGE}`);
    return 2;
  }
  if (check && date !== null) {
    io.err(`--date does not go with --check-feeds: a check reads the clock's day. ${USAGE}`);
    return 2;
  }
  if (!check && (id !== undefined || json)) {
    io.err(`--id and --json go with --check-feeds. ${USAGE}`);
    return 2;
  }
  if (id === "") {
    io.err(`--id wants a registry id. ${USAGE}`);
    return 2;
  }
  try {
    fixtureGuard(env, false);
  } catch (e) {
    io.err((e as Error).message);
    return 2;
  }
  if (check) {
    try {
      const r = await checkFeeds({ id, root });
      io.out((json ? jsonText(r.rows) : formatCheckTable(r.rows)).trimEnd());
      return r.exitCode;
    } catch (e) {
      io.err((e as Error).message);
      return 2;
    }
  }
  try {
    const r = await collect({ date: date ?? taipeiToday(), deadline: Date.now() + CLI_DEADLINE_MS, root });
    for (const line of r.summary) io.out(line);
    return 0;
  } catch (e) {
    io.err(`collect: ${(e as Error).message}`);
    return 1;
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void main().then((code) => { process.exitCode = code; });
