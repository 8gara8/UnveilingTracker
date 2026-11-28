// What collect leaves in cache/feeds/ and what reads it back (SPEC §4.13 "arXiv's calendar", §5.7, §8.3, §8.4, §8.10, §9.8): the feed
// index `cache/feeds/index.json` (one row for each registry entry, in registry order) with the judgement behind its `status` and its
// `sources:check` label, the counters' bodies read back for `metrics --recompute` and the backfill, and the arXiv lists' 60-day prune.
// The readers that write the bodies are in scripts/lib/feeds.ts, and every body here is parsed by the parser that collect used, so the
// metrics see exactly the facts collect saw. A body that is missing, does not parse or is not the bytes the manifest recorded (another
// SHA-256) is left out and the caller gets null; nothing here throws for a cache's sake. Only `readFeedIndex()` throws, on a file that is
// not an index (its callers say what to do).
//
// Cyber's scripts/lib/feed-cache.ts at the fork commit 3ced1fb, adapted: its metrics feeds (its vulnerability catalogues and scores) are gone and
// the counters' sources take their place; the index schema is this project's (Cyber kept it in lib/schema/pack.ts, which here holds the pack
// alone), and the freshness judgement is Cyber's `feedState()` for every registry kind.
//
// Layout read (lib/feeds/cache.ts cachePaths()), each file the first body of its feed or, for a counter, the body of the manifest request
// at that position:
//   cache/feeds/index.json
//   cache/feeds/ctgov.p<k>.json              the k-th body `readCtgov()` kept, k from 0
//   cache/feeds/rcsb.p<k>.json               the k-th count body (last year, then this year)
//   cache/feeds/rcsb-unreleased.json.gz      the holdings file as received
//   cache/feeds/retraction-watch.csv         the file whole
//   cache/feeds/mathlib-stats.html
//   cache/feeds/arxiv/<id>.<US date>.xml     one list for each announcement, pruned after 60 days

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { daysBetween, isValidDate } from "../../lib/dates";
import { usDateOf } from "../../lib/feeds/arxiv";
import { cachePaths, type CachePaths } from "../../lib/feeds/cache";
import { latestOf, type CheckLabel, type FeedState } from "../../lib/feeds/types";
import { jsonText, sha256Hex } from "../../lib/json";
import type { PdbData, TrialRecord } from "../../lib/metrics/counters";
import { ConfigId, Count, IsoDate, IsoTimestamp, PublishedAt, Sha256 } from "../../lib/schema/common";
import type { RequestRecord } from "../../lib/schema/metrics";
import { FeedKind, type FeedEntry } from "../../lib/schema/registry";
import { FeedStatus } from "../../lib/schema/status";
import {
  parseCtgov, parseMathlibStats, parseRcsbCount, parseRcsbUnreleased, parseRetractionWatch, type FeedData, type Read, type RetractionData,
} from "./feeds";

// ── The feed index ───────────────────────────────────────────────────────────────────────────────

/** The `sources:check` label (§8.10): the schema of lib/feeds/types.ts `CheckLabel`. */
export const CheckLabelSchema = z.enum(["OK", "STALE", "NODATE", "FAIL", "SKIP"]);

/** One registry entry's outcome in a run (`status` is the pack's and the status file's word, `label` is `sources:check`'s). */
export const FeedIndexEntry = z.strictObject({
  id: ConfigId,
  kind: FeedKind,
  status: FeedStatus,
  label: CheckLabelSchema,
  error_class: z.string().min(1).nullable().describe("A fetch or parse error class, never raw error text"),
  url_used: z.string().min(1).nullable(),
  fallback_used: z.boolean(),
  newest: PublishedAt.describe("The newest item the feed gave, a day or a timestamp, and not later than the judging time; null when none is dated"),
  items: Count.describe("What the feed gave, before the reader's own filter"),
  records: Count.describe("What the reader kept"),
  bytes: Count,
  requests: Count,
  sha256: Sha256.nullable().describe("Of the first body kept, or null when none was"),
  fetched_at: IsoTimestamp.nullable(),
  note: z.string().min(1).max(200).nullable().describe("A fixed template, never raw error text"),
});

/** cache/feeds/index.json: one row for each registry entry, in registry order. */
export const FeedIndexFile = z.strictObject({
  schema_version: z.literal(1),
  date: IsoDate,
  generated_at: IsoTimestamp,
  feeds: z.array(FeedIndexEntry),
});

export type FeedIndexEntry = z.infer<typeof FeedIndexEntry>;
export type FeedIndexFile = z.infer<typeof FeedIndexFile>;

const DAY_MS = 86_400_000;

/** The facts of one feed's read that the index records: the read, what it counted and the newest item the judgement uses. */
export interface FeedFacts {
  read: Pick<Read<unknown>, "ok" | "error" | "urlUsed" | "triedFallback" | "fallbackUsed" | "sha256" | "bytes" | "requests" | "fetchedAt" | "note">;
  newest: string | null;
  items: number;
  records: number;
}

/** The time of an item date in epoch ms, or null when it does not read. */
const instant = (published: string): number | null => {
  const ms = Date.parse(published);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * The newest date of a candidate feed for the freshness judgement (§4.13): an arXiv feed's is the announcement of the newest list in the cache (a morning
 * that reads no list after a holiday is not stale); any other feed's is the latest item dated no later than `refMs`, so a row dated in the future cannot keep
 * a feed fresh for ever. Null when no item has a readable date.
 */
export function freshNewest(feedId: string, data: Pick<FeedData, "items" | "newest">, refMs: number): string | null {
  if (feedId.startsWith("arxiv-")) return data.newest;
  return latestOf(data.items.map((i) => {
    const ms = i.published_at === null ? null : instant(i.published_at);
    return ms !== null && ms <= refMs ? i.published_at : null;
  }));
}

/** The facts of a candidate feed's read. A failed read has none of the data's. */
export function candidateFacts(entry: Pick<FeedEntry, "id">, r: Read<FeedData>, refMs: number): FeedFacts {
  return {
    read: r, newest: r.data === null ? null : freshNewest(entry.id, r.data, refMs),
    items: r.data?.total ?? 0, records: r.data?.items.length ?? 0,
  };
}

/** The facts of a data feed's read (a counter's, the watch's): what it counted and the newest day it holds, if it has dates. */
export const dataFacts = (r: FeedFacts["read"], newest: string | null, records: number): FeedFacts => ({ read: r, newest, items: records, records });

/**
 * A feed's state and label against the judging time `refMs` (at(D, window_end) in collect, the clock in `sources:check`; SPEC §4.13): `skipped` [SKIP] for a
 * feed that is never read; `failed` [FAIL] when it was not read; `stale` [NODATE] when it has `fresh_days` and no item has a readable date and `stale` [STALE]
 * when its newest is older than `fresh_days`; else `ok` [OK]. The notes are fixed templates: the reader's own, then the fallback line.
 */
export function feedVerdict(
  entry: Pick<FeedEntry, "fresh_days">,
  facts: FeedFacts | null,
  refMs: number,
): { state: FeedState; label: CheckLabel; note: string | null } {
  if (facts === null) return { state: "skipped", label: "SKIP", note: null };
  const r = facts.read;
  const notes = r.note === null ? [] : [r.note];
  if (!r.ok) {
    return { state: "failed", label: "FAIL", note: [`Failed: ${r.error ?? "network"}${r.triedFallback ? " on both URLs" : ""}.`, ...notes].join(" ").slice(0, 200) };
  }
  if (r.fallbackUsed) notes.unshift("Fallback URL used.");
  if (entry.fresh_days !== null) {
    if (facts.newest === null || instant(facts.newest) === null) return { state: "stale", label: "NODATE", note: ["Stale: no readable dates.", ...notes].join(" ").slice(0, 200) };
    if (refMs - (instant(facts.newest) as number) > entry.fresh_days * DAY_MS) {
      return { state: "stale", label: "STALE", note: [`Stale: newest item ${facts.newest.slice(0, 10)}.`, ...notes].join(" ").slice(0, 200) };
    }
  }
  return { state: "ok", label: "OK", note: notes.length > 0 ? notes.join(" ").slice(0, 200) : null };
}

/** The index row of one registry entry: `facts` null for a feed that is never read. */
export function feedIndexEntry(entry: FeedEntry, facts: FeedFacts | null, refMs: number): FeedIndexEntry {
  const v = feedVerdict(entry, facts, refMs);
  const r = facts?.read;
  return {
    id: entry.id, kind: entry.kind, status: v.state, label: v.label, error_class: r && !r.ok ? (r.error ?? "network") : null,
    url_used: r?.urlUsed ?? null, fallback_used: r?.fallbackUsed ?? false,
    newest: facts?.newest ?? null, items: facts?.items ?? 0, records: facts?.records ?? 0, bytes: r?.bytes ?? 0, requests: r?.requests ?? 0,
    sha256: r?.sha256 ?? null, fetched_at: r?.fetchedAt ?? null, note: v.note,
  };
}

/** Writes `cache/feeds/index.json` (a temporary file renamed into place, so a partial write never takes the name); the rows are checked against the schema. */
export function writeFeedIndex(paths: Pick<CachePaths, "feedIndex">, file: FeedIndexFile): void {
  const text = jsonText(file, FeedIndexFile);
  fs.mkdirSync(path.dirname(paths.feedIndex), { recursive: true });
  const tmp = `${paths.feedIndex}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, paths.feedIndex);
}

/** Reads `cache/feeds/index.json`: null when it is missing, a throw when it is not an index (the file is rewritten at every collect). */
export function readFeedIndex(paths: Pick<CachePaths, "feedIndex">): FeedIndexFile | null {
  let text: string;
  try {
    text = fs.readFileSync(paths.feedIndex, "utf8");
  } catch {
    return null;
  }
  return FeedIndexFile.parse(JSON.parse(text));
}

// ── The counters' bodies, read back ──────────────────────────────────────────────────────────────

/** A cached body, or null when it is missing or is not the bytes the manifest request recorded. */
function verified(file: string, request: RequestRecord | undefined): Buffer | null {
  if (request === undefined) return null;
  let body: Buffer;
  try {
    body = fs.readFileSync(file);
  } catch {
    return null;
  }
  return sha256Hex(body) === request.sha256 ? body : null;
}

/** The query value `name` of a request URL, or null. */
function queryOf(url: string, name: string): string | null {
  try {
    return new URL(url).searchParams.get(name);
  } catch {
    return null;
  }
}

/**
 * The studies `ai_drugs` read: the lookup of every NCT id the manifest's requests asked for (from their `filter.ids`), the study from the body of that request or null
 * when the answer holds none. Null when a body is missing, changed or does not parse, or no request is listed.
 */
export function cachedCtgov(root: string, requests: readonly RequestRecord[]): Map<string, TrialRecord | null> | null {
  if (requests.length === 0) return null;
  const p = cachePaths(root);
  const lookup = new Map<string, TrialRecord | null>();
  for (const [k, request] of requests.entries()) {
    const body = verified(p.feedBody("ctgov", `p${k}.json`), request);
    const ids = queryOf(request.url, "filter.ids");
    if (body === null || ids === null) return null;
    try {
      const got = parseCtgov(body);
      for (const id of ids.split(",")) if (id !== "") lookup.set(id, got.get(id) ?? null);
    } catch {
      return null;
    }
  }
  return lookup;
}

/** The year a count request asked about, from the range in its `json` query; null when the URL is not a count request. */
function countYear(url: string): string | null {
  const json = queryOf(url, "json");
  if (json === null) return null;
  try {
    const from = (JSON.parse(json) as { query?: { parameters?: { value?: { from?: unknown } } } }).query?.parameters?.value?.from;
    return typeof from === "string" && isValidDate(from) ? from.slice(0, 4) : null;
  } catch {
    return null;
  }
}

/**
 * The data `pdb_structures` read: the counts of the manifest's two count requests (by the year of each range) and the holdings file. The requests are the
 * counts first, the holdings last, as `readPdbStructures()` kept them. Null when a body is missing, changed or does not parse, or a request is not one of these.
 */
export function cachedPdb(root: string, requests: readonly RequestRecord[]): PdbData | null {
  const p = cachePaths(root);
  const released: Record<string, number> = {};
  let unreleased: PdbData["unreleased"] | null = null;
  let counts = 0;
  for (const request of requests) {
    const year = countYear(request.url);
    try {
      if (year !== null) {
        const body = verified(p.feedBody("rcsb", `p${counts}.json`), request);
        if (body === null) return null;
        released[year] = parseRcsbCount(body);
        counts += 1;
      } else {
        const body = verified(p.feedBody("rcsb-unreleased", "json.gz"), request);
        if (body === null || unreleased !== null) return null;
        unreleased = parseRcsbUnreleased(body);
      }
    } catch {
      return null;
    }
  }
  return counts === 0 || unreleased === null ? null : { released, unreleased };
}

/** The file `ai_retractions` read, parsed as it was (rows dated after `asOf` left out); null when it is missing, changed or does not parse. */
export function cachedRetractions(root: string, requests: readonly RequestRecord[], asOf: string): RetractionData | null {
  const body = verified(cachePaths(root).feedBody("retraction-watch", "csv"), requests[0]);
  if (body === null) return null;
  try {
    return parseRetractionWatch(body, asOf);
  } catch {
    return null;
  }
}

/** The theorem count `mathlib_theorems` read; null when the page is missing, changed or does not parse. */
export function cachedMathlib(root: string, requests: readonly RequestRecord[]): number | null {
  const body = verified(cachePaths(root).feedBody("mathlib-stats", "html"), requests[0]);
  if (body === null) return null;
  try {
    return parseMathlibStats(body.toString("utf8"));
  } catch {
    return null;
  }
}

// ── arXiv's lists ────────────────────────────────────────────────────────────────────────────────

/** How long a list stays in `cache/feeds/arxiv/` (SPEC §9.8: 60 days, as every body of the cache). */
export const ARXIV_KEEP_DAYS = 60;

const ARXIV_LIST_FILE = /^([a-z0-9][a-z0-9-]*)\.(\d{4}-\d{2}-\d{2})\.xml$/;

/**
 * The lists of `cache/feeds/arxiv/` older than `ARXIV_KEEP_DAYS` days, by the US date in their name (not by the file's age, so a list that was fetched again is
 * kept for the announcement's own 60 days): the file names, in code-unit order. A file with another name is never listed, and a missing folder lists none.
 */
export function staleArxivLists(paths: Pick<CachePaths, "arxivDir">, nowMs: number, keepDays: number = ARXIV_KEEP_DAYS): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(paths.arxivDir);
  } catch {
    return [];
  }
  const today = usDateOf(nowMs);
  return names
    .filter((n) => {
      const m = ARXIV_LIST_FILE.exec(n);
      return m !== null && isValidDate(m[2]!) && daysBetween(m[2]!, today) > keepDays;
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Removes the lists `staleArxivLists()` names and returns them; a file that cannot be removed stays (the next run tries again). */
export function pruneArxivLists(paths: Pick<CachePaths, "arxivDir">, nowMs: number, keepDays: number = ARXIV_KEEP_DAYS): string[] {
  const removed: string[] = [];
  for (const name of staleArxivLists(paths, nowMs, keepDays)) {
    try {
      fs.rmSync(path.join(paths.arxivDir, name));
      removed.push(name);
    } catch {
      // stays until the next prune
    }
  }
  return removed;
}
