// The impure per-feed readers collect, `sources:check` and the metrics share (SPEC §4.13, §4.14, §5.7, §8.3, §8.10):
// each builds its URLs from the registry or a fixed pattern, fetches through fetchFeed() under the run's budget, the
// feed's own request budget and the run's deadline, keeps the raw body in cache/feeds/ and parses it with
// lib/feeds/<kind>.ts or with the parsers of this file. A reader never throws for a feed's sake: a failure comes back as an
// error class and the raw message goes to the log only. A URL found inside feed content is data and is never fetched.
//
// Cyber's scripts/lib/feeds.ts at the fork commit 3ced1fb, adapted: its harness (`FeedCtx`, `get`, `cacheWrite`,
// `withFallback`, `Read`, `parseClass`) is kept, the readers of its domain feeds are gone, and this project's are new:
// arXiv's lists by announcement (§4.13: cached by name, reused, a bad file removed and fetched again, an empty answer
// never kept, the lookback read from the cache first), bioRxiv and medRxiv by cursor, PubMed (esearch, esummary, efetch),
// Crossref's journals and notices, the RSS and Atom feeds, the page feeds (EurekAlert!, the labs, the Science Media
// Centre's page, the Erdős problems' threads), and the counters' sources (ClinicalTrials.gov, RCSB's counts and
// holdings, the Retraction Watch file, mathlib's statistics page). Differences from Cyber's harness: `get` counts each
// request against the feed's own `budget` (a retry counts too, the last request of a budget is sent without one, and a request
// with a fallback behind it is sent without one when its retry would leave the fallback no request), a page feed that matches nothing is a `schema` failure, and a body the harness gave under a content type the reader
// cannot be reading (JSON or a PDF for a page) is refused as `parse`.
//
// Layout of what is kept (lib/feeds/cache.ts cachePaths()): the body a feed's accepted read gave, one for each feed,
// replaced at each read: cache/feeds/<id>.xml (RSS, Atom), <id>.html (pages), <id>.json (the first answer of an API),
// pubmed.summary.json and pubmed.fetch.xml, crossref-journals-<journal id>.json, and cache/feeds/arxiv/<id>.<US date>.xml
// for every arXiv list. The counters keep every body their reading came from, so `metrics --recompute` reads them back
// (scripts/lib/feed-cache.ts): ctgov.p<n>.json, rcsb.p<n>.json, rcsb-unreleased.json.gz (as received),
// retraction-watch.csv and mathlib-stats.html.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { isValidDate, taipeiTimestamp, utcDateOf } from "../../lib/dates";
import {
  arxivListFor, lookbackAnnouncements, parseArxivEntries, arxivRawItems, submittedDateClause, windowAnnouncement, type ArxivList,
} from "../../lib/feeds/arxiv";
import { cachePaths, type CachePaths } from "../../lib/feeds/cache";
import { parseCsv } from "../../lib/feeds/csv";
import { FEED_MAX_BYTES, FEED_TIMEOUTS, fetchBudget, fetchFeed, type FetchBudget, type FetchErrorClass, type FetchResult } from "../../lib/feeds/http";
import { feedDate, parseRss } from "../../lib/feeds/rss";
import { FeedParseError, latestOf, rawItem, type ArxivEntry, type RawItem } from "../../lib/feeds/types";
import { htmlText } from "../../lib/html-text";
import { byCodeUnit } from "../../lib/ids";
import { sha256Hex } from "../../lib/json";
import {
  RETRACTION_COLUMNS, parseRetractionRow, type PdbData, type RetractionRow, type TrialRecord, type UnreleasedEntry,
} from "../../lib/metrics/counters";
import type { FeedEntry } from "../../lib/schema/registry";
import type { RequestRecord } from "../../lib/schema/metrics";
import { normalizeDoi } from "../../lib/urls";

// ── The harness ──────────────────────────────────────────────────────────────────────────────────

/** What every reader needs: the fetcher, the shared budget, the run's deadline, the clock, the log and the cache. */
export interface FeedCtx {
  fetch: typeof fetchFeed;
  budget: FetchBudget;
  /** Epoch ms; nothing starts and nothing is written past it. */
  deadline: number;
  now: () => number;
  log: (line: string) => void;
  paths: CachePaths;
}

/** A context for the repo at `root`: the real fetcher (fixture mode answers it from UT_FIXTURE_FEEDS), a fresh 240 s budget, no deadline, the real clock, a silent log. */
export function feedCtx(root: string, over: Partial<FeedCtx> = {}): FeedCtx {
  return { fetch: fetchFeed, budget: fetchBudget(), deadline: Number.POSITIVE_INFINITY, now: () => Date.now(), log: () => {}, paths: cachePaths(root), ...over };
}

/** The requests one feed has made in a read against its `budget` (SPEC §4.13 "Budgets"). */
export interface Spend {
  readonly id: string;
  readonly max: number;
  used: number;
}

export const spendOf = (entry: Pick<FeedEntry, "id" | "budget">): Spend => ({ id: entry.id, max: entry.budget, used: 0 });

/** True while the feed may send another request. */
export const hasBudget = (spend: Spend): boolean => spend.used < spend.max;

type Limit = keyof typeof FEED_TIMEOUTS;
type MaxKey = keyof typeof FEED_MAX_BYTES;

export interface GetOptions {
  limit?: Limit;
  max?: MaxKey;
  /** Requests of the feed's budget this one leaves for a later request (a fallback): the retry is skipped when the retry would eat into them. */
  reserve?: number;
}

/**
 * The result `get()` gives when the feed's budget is spent: nothing was sent (`attempts` 0). Readers test `hasBudget()` before they
 * page, so this only ends a read that needed a request it may no longer make.
 */
const noBudget = (url: string): FetchResult =>
  ({ ok: false, status: null, finalUrl: url, body: null, contentType: null, error: "timeout", detail: "the feed's request budget is spent", durationMs: 0, attempts: 0 });

/**
 * A fetch under the run's budget (it starts at the first request), the run's deadline and the feed's own budget: each attempt
 * counts, and the last request left in the budget is sent with no retry, so a feed never makes more requests than its `budget`.
 * A request that has a fallback behind it (`reserve`) is sent with no retry when the retry would leave the fallback no request.
 * Failures are logged with their raw detail.
 */
export async function get(ctx: FeedCtx, spend: Spend, url: string, o: GetOptions = {}): Promise<FetchResult> {
  const left = spend.max - spend.used;
  if (left <= 0) {
    ctx.log(`${spend.id}: the request budget of ${spend.max} is spent; ${url} was not fetched`);
    return noBudget(url);
  }
  ctx.budget.begin(ctx.now());
  const deadline = Math.min(ctx.budget.deadline(), ctx.deadline);
  const r = await ctx.fetch(url, {
    timeoutMs: FEED_TIMEOUTS[o.limit ?? "default"], maxBytes: FEED_MAX_BYTES[o.max ?? "default"], deadline,
    ...(left - (o.reserve ?? 0) <= 1 ? { retryDelayMs: 0 } : {}),
  });
  spend.used += r.attempts;
  if (!r.ok) ctx.log(`fetch failed: ${url} (${r.error}${r.status ? `, HTTP ${r.status}` : ""})${r.detail ? `: ${r.detail}` : ""}`);
  return r;
}

/**
 * Writes a cache file unless the deadline has passed (collect writes nothing after it), through a temporary file renamed into
 * place, so a partial write never takes the final name. It never throws: when the write fails (a full disk), the line is logged
 * and neither the partial file nor an earlier one stays under the name, so nothing later reads bytes this run did not keep.
 */
export function cacheWrite(ctx: FeedCtx, file: string, data: string | Buffer): void {
  if (ctx.now() >= ctx.deadline) return;
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    ctx.log(`cache: could not write ${path.basename(file)}: ${(e as Error).message.slice(0, 300)}`);
    for (const f of [tmp, file]) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        // nothing more to do
      }
    }
  }
}

/** Removes a cache file unless the deadline has passed; never throws. */
function cacheRemove(ctx: FeedCtx, file: string): void {
  if (ctx.now() >= ctx.deadline) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // a file that cannot be removed stays; the next read tries again
  }
}

/** A failure a reader names itself, such as a gzip over its cap (`too_large`); a parser's own failure is a FeedParseError. */
export class ReadFail extends Error {
  constructor(readonly errorClass: FetchErrorClass, message: string) {
    super(message);
    this.name = "ReadFail";
  }
}

/** The error class of a parser throw: FeedParseError's and ReadFail's own, anything else "parse". */
export function parseClass(e: unknown): FetchErrorClass {
  return e instanceof FeedParseError || e instanceof ReadFail ? e.errorClass : "parse";
}

/** What a reader gives: whether it read, why not, where from, and what it read. `data` is null when `ok` is false (a few counters' readers say so where they differ). */
export interface Read<T> {
  ok: boolean;
  error: FetchErrorClass | null;
  /** The URL that answered (the last one tried when none did); null when no URL was tried. */
  urlUsed: string | null;
  triedFallback: boolean;
  fallbackUsed: boolean;
  /** SHA-256 of the body kept (the first, for a read of several). */
  sha256: string | null;
  /** The bytes of every body the read fetched. */
  bytes: number;
  /** The requests the feed spent from its budget (every attempt). */
  requests: number;
  /** Each body kept as a manifest row: its URL (never with a key), when it was fetched, its SHA-256. */
  fetched: RequestRecord[];
  /** When the first body was fetched, a Taipei timestamp. */
  fetchedAt: string | null;
  /** A fixed line for the status file when the read was partial, else null. */
  note: string | null;
  data: T | null;
}

/** The Taipei timestamp of the context's clock. */
const stamp = (ctx: FeedCtx): string => taipeiTimestamp(new Date(ctx.now()));

/** What a multi-request read keeps as it goes. */
interface Trace {
  fetched: RequestRecord[];
  bytes: number;
  /** Records a body that answered and is kept. */
  keep(r: FetchResult, body: Buffer): void;
}

function trace(ctx: FeedCtx): Trace {
  const t: Trace = {
    fetched: [], bytes: 0,
    keep(r, body) {
      t.bytes += body.length;
      t.fetched.push({ url: r.finalUrl, fetched_at: stamp(ctx), sha256: sha256Hex(body) });
    },
  };
  return t;
}

/** A finished read from its parts. */
function finished<T>(spend: Spend, t: Trace, data: T | null, o: Partial<Read<T>> = {}): Read<T> {
  return {
    ok: data !== null, error: null, urlUsed: null, triedFallback: false, fallbackUsed: false, sha256: t.fetched[0]?.sha256 ?? null,
    bytes: t.bytes, requests: spend.used, fetched: t.fetched, fetchedAt: t.fetched[0]?.fetched_at ?? null, note: null, data, ...o,
  };
}

const failedRead = <T>(spend: Spend, t: Trace, error: FetchErrorClass, urlUsed: string | null, o: Partial<Read<T>> = {}): Read<T> =>
  finished<T>(spend, t, null, { ok: false, error, urlUsed, sha256: null, ...o });

type ExpectBody = "html" | null;

const mimeOf = (contentType: string | null): string | null => (contentType === null ? null : (contentType.split(";")[0] ?? "").trim().toLowerCase() || null);

/** A page is read as HTML: a body that came as JSON, XML or a PDF is some other answer (an error, a file) and is not read as one. Text and an unnamed type pass. */
function wrongType(r: FetchResult, expect: ExpectBody): string | null {
  const mime = mimeOf(r.contentType);
  if (expect !== "html" || mime === null) return null;
  return mime === "text/html" || mime === "application/xhtml+xml" || mime === "text/plain" ? null : `a ${mime} body where a page was expected`;
}

interface FallbackOptions<T> extends GetOptions {
  expect?: ExpectBody;
  /** Keeps a body in cache/ once it is the one returned: parsed. `index` is 0 for the feed's URL, 1 for its fallback. */
  body?: (body: Buffer, data: T, index: number) => void;
}

/**
 * One URL, then the registry's fallback when the first fails to fetch, is a body of the wrong kind or fails to parse. The fallback
 * counts in the feed's budget, and the first URL's retry never takes its request (`get()`'s `reserve`). The read fails with the class of the last
 * URL tried. `parse` is given the index of the URL that answered, so a feed whose fallback is a page reads it as one.
 */
async function withFallback<T>(
  ctx: FeedCtx,
  entry: Pick<FeedEntry, "id" | "fallback_url">,
  spend: Spend,
  first: string,
  parse: (body: Buffer, r: FetchResult, index: number) => T | Promise<T>,
  o: FallbackOptions<T> = {},
): Promise<Read<T>> {
  const urls = [first, ...(entry.fallback_url ? [entry.fallback_url] : [])];
  const t = trace(ctx);
  let last: { error: FetchErrorClass; url: string } = { error: "network", url: first };
  let triedFallback = false;
  for (const [i, url] of urls.entries()) {
    // A fallback the budget no longer allows is not tried, and the first URL's own error stays the read's error.
    if (i > 0 && !hasBudget(spend)) {
      ctx.log(`${entry.id}: the request budget of ${spend.max} is spent; the fallback ${url} was not fetched`);
      break;
    }
    if (i > 0) triedFallback = true;
    const r = await get(ctx, spend, url, { ...o, reserve: i === 0 && urls.length > 1 ? 1 : 0 });
    if (!r.ok || !r.body) {
      last = { error: r.error ?? "network", url };
      continue;
    }
    const wrong = wrongType(r, o.expect ?? null);
    if (wrong !== null) {
      ctx.log(`${entry.id}: ${url} gave ${wrong}`);
      last = { error: "parse", url };
      continue;
    }
    let data: T;
    try {
      data = await parse(r.body, r, i);
    } catch (e) {
      ctx.log(`${entry.id}: ${url} did not parse: ${(e as Error).message.slice(0, 300)}`);
      last = { error: parseClass(e), url };
      continue;
    }
    o.body?.(r.body, data, i);
    t.keep(r, r.body);
    return finished(spend, t, data, { urlUsed: url, triedFallback, fallbackUsed: i > 0 });
  }
  return failedRead(spend, t, last.error, last.url, { triedFallback });
}

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────

const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asStr = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const firstStr = (v: unknown): string => asStr(asArr(v)[0]);

/** A JSON object from a body, or a `parse` failure. */
function jsonObject(body: Buffer, what: string): Record<string, unknown> {
  let v: unknown;
  try {
    v = JSON.parse(body.toString("utf8"));
  } catch {
    throw new FeedParseError("parse", `${what}: the answer is not JSON`);
  }
  if (!isObj(v)) throw new FeedParseError("parse", `${what}: the answer is not a JSON object`);
  return v;
}

/** Text from a feed or API field as plain text: markup taken out where there is any (JATS and HTML tags, entities), else the text squashed. */
export function plain(raw: unknown): string {
  const s = asStr(raw);
  if (s === "") return "";
  if (!/[<&]/.test(s)) return squash(s);
  return htmlText(s.replace(/<jats:title>[\s\S]*?<\/jats:title>/gi, " "));
}

const MONTHS = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const MONTH_NUMBER: Readonly<Record<string, number>> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAY_MONTH_YEAR = new RegExp(`\\b(\\d{1,2})[- ]${MONTHS}\\.?[- ,]+(\\d{4})\\b`, "i");
const MONTH_DAY_YEAR = new RegExp(`\\b${MONTHS}\\.? (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})\\b`, "i");
const YEAR_MONTH_DAY = new RegExp(`\\b(\\d{4}) ${MONTHS}\\.? (\\d{1,2})\\b`, "i");

const dayOf = (y: number, m: number, d: number): string | null => {
  const day = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidDate(day) ? day : null;
};

/**
 * The first calendar day written in some text, as `YYYY-MM-DD`, or null: `2026-11-27` (also when a time of day follows: `2026-11-27T09:30:00Z`), `27-Nov-2026` (EurekAlert!), `08 Oct 2026`
 * (the Erdős problems), `Nov 17, 2026` and `November 20, 2026` (the labs, the Science Media Centre) or `2026 Nov 27` (PubMed). A day
 * that does not exist (`31 Feb 2026`) is no date, and a month with no day (`2026 Nov`) is none either: a date is never invented.
 */
export function textDate(text: string): string | null {
  const iso = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(text);
  if (iso) {
    const d = dayOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (d) return d;
  }
  const dmy = DAY_MONTH_YEAR.exec(text);
  if (dmy) {
    const d = dayOf(Number(dmy[3]), MONTH_NUMBER[dmy[2]!.slice(0, 3).toLowerCase()]!, Number(dmy[1]));
    if (d) return d;
  }
  const mdy = MONTH_DAY_YEAR.exec(text);
  if (mdy) {
    const d = dayOf(Number(mdy[3]), MONTH_NUMBER[mdy[1]!.slice(0, 3).toLowerCase()]!, Number(mdy[2]));
    if (d) return d;
  }
  const ymd = YEAR_MONTH_DAY.exec(text);
  if (ymd) return dayOf(Number(ymd[1]), MONTH_NUMBER[ymd[2]!.slice(0, 3).toLowerCase()]!, Number(ymd[3]));
  return null;
}

/** A day as the start of that day in the feed's zone (`date_zone`, UTC when null), the form every reader gives a day-only date. */
const dayStamp = (day: string | null, zone: string | null): string | null => (day === null ? null : feedDate(day, zone ?? "Z"));

/** `[2026, 11, 24]` read from Crossref's `{ "date-parts": [[2026, 11, 24]] }` (a part may be missing: a year alone is `[2026]`). */
function dateParts(v: unknown): number[] {
  const first = isObj(v) ? asArr(v["date-parts"])[0] : null;
  const parts = asArr(first).map((n) => (typeof n === "number" && Number.isInteger(n) ? n : NaN));
  return parts.some((n) => Number.isNaN(n)) ? [] : parts;
}

/** The full day of some date parts, or null for a year alone, a year and a month, or a day that does not exist (§4.1: a date is never invented). */
const fullDay = (parts: readonly number[]): string | null => (parts.length >= 3 ? dayOf(parts[0]!, parts[1]!, parts[2]!) : null);

/** An item's `url` against the page it came from, when that is an http or https address; null for anything else (`mailto:`, `javascript:`, an unreadable one). */
function absolute(href: string | undefined, base: string): string | null {
  if (!href || href.trim() === "") return null;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ── What the readers give ────────────────────────────────────────────────────────────────────────

/**
 * A candidate as a reader gives it: `RawItem` with the two facts the feed's identity adds. `journal_id` is the id in
 * `config/journals.json` of the journal the item was read for (a `journal-<id>` feed, or the journal one Crossref request asked
 * about), null elsewhere: it maps a candidate whose feed gives no journal name (Annals, Language, HTS). `kind` is `reaction` for an
 * item of the Science Media Centre (§4.11 `reaction_sources`), null elsewhere.
 */
export interface FeedItem extends RawItem {
  journal_id: string | null;
  kind: "reaction" | null;
}

const feedItem = (r: RawItem, journalId: string | null = null, kind: "reaction" | null = null): FeedItem => ({ ...r, journal_id: journalId, kind });

/** What a candidate feed's read holds. */
export interface FeedData {
  /** The candidates the feed gave (arXiv: the window's list). */
  items: FeedItem[];
  /** arXiv only: the lookback lists' items, each dated by its own announcement. */
  lookback: FeedItem[];
  /** The latest item date (arXiv: the announcement of the newest list in the cache), or null when no item has a readable date. */
  newest: string | null;
  /** How many items the feed gave before the reader's own filter (the Science Media Centre's path test). */
  total: number;
  /** arXiv only: the time of the window's announcement when its list has an entry, else null. */
  announcement: string | null;
  /** Parts of the read that did not happen: journals without an answer, pages not read, lists not read for the budget. */
  unread: string[];
}

/** What a run asks of the readers. */
export interface FeedRun {
  /** The edition date D (Taipei). */
  date: string;
  /** The pack window (§8.3), timestamps with their offset. The date-ranged feeds read the UTC days it touches. */
  window: { start: string; end: string };
  /** `arxiv_skipped` of the registry. */
  arxivSkipped: readonly string[];
  /** The phrases of `ai-terms.json`, which PubMed's query searches in title and abstract. */
  aiPhrases: readonly string[];
  /** `config/journals.json`'s journals (id and ISSN), in file order: Crossref is asked once for each. */
  journals: readonly { id: string; issn: string }[];
  /** False reads no arXiv lookback list (default true). */
  lookback?: boolean;
  /** What `probeDataFeed()` asks of the feeds that need ids: trials for ClinicalTrials.gov, DOIs for Crossref's notices. */
  probe?: { ncts?: readonly string[]; dois?: readonly string[] };
}

/** `config/journals.json`'s id of a `journal-<id>` feed: the id after the prefix, except for the two the spec shortens (§4.13); null for any other feed. */
export function journalIdOfFeed(feedId: string): string | null {
  if (!feedId.startsWith("journal-")) return null;
  const id = feedId.slice("journal-".length);
  if (id === "") return null;
  return id === "grl" ? "geophysical-research-letters" : id === "hts" ? "hts-theological-studies" : id;
}

const baseData = (items: FeedItem[], o: Partial<FeedData> = {}): FeedData => ({
  items, lookback: [], newest: latestOf(items.map((i) => i.published_at)), total: items.length, announcement: null, unread: [], ...o,
});

/** Items from the RSS reader: markup out of the title and the abstract, and the journal the registry names. */
function cleanItem(r: RawItem, journalId: string | null, kind: "reaction" | null = null): FeedItem {
  return feedItem({ ...r, title: plain(r.title), abstract: plain(r.abstract) }, journalId, kind);
}

// ── arXiv ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Each `arxiv-<cat>` feed's category query (SPEC §4.13), held as code: `cat:` terms joined with OR, a wildcard matching every
 * category of an archive. The math feed names the aliases `cs.IT` and `math-ph`, which `math*` misses, and the physics feed
 * `hep*`, `gr-qc` and `nucl*` beside `physics*`.
 */
export const ARXIV_QUERIES: Readonly<Record<string, string>> = {
  "arxiv-math": "(cat:math* OR cat:cs.IT OR cat:math-ph)",
  "arxiv-physics": "(cat:physics* OR cat:hep* OR cat:gr-qc OR cat:nucl*)",
  "arxiv-astro-ph": "cat:astro-ph*",
  "arxiv-cond-mat": "cat:cond-mat*",
  "arxiv-quant-ph": "cat:quant-ph",
  "arxiv-q-bio": "cat:q-bio*",
  "arxiv-physics-chem-ph": "cat:physics.chem-ph",
  "arxiv-stat-ml": "cat:stat.ML",
};

/** The most entries one API request asks for: the API's own limit of one slice, far above the largest list (a Monday's, three days of submissions). */
export const ARXIV_MAX_RESULTS = 2000;

/** A query as K1c sent it: spaces as `+`, parentheses and brackets escaped, the rest (`:`, `*`, `.`, `-`) as written. */
const arxivEscape = (query: string): string => query.replace(/[ ()[\]]/g, (c) => (c === " " ? "+" : `%${c.charCodeAt(0).toString(16).toUpperCase()}`));

/** The API request for one list: the feed's category query and the list's `submittedDate` clause, in order of submission, from the first entry. */
export function arxivApiUrl(base: string, feedId: string, list: ArxivList): string {
  const query = Object.hasOwn(ARXIV_QUERIES, feedId) ? ARXIV_QUERIES[feedId] : undefined;
  if (query === undefined) throw new Error(`arXiv: no category query for ${feedId}`);
  return `${base}?search_query=${arxivEscape(`${query} AND ${submittedDateClause(list)}`)}&start=0&max_results=${ARXIV_MAX_RESULTS}&sortBy=submittedDate&sortOrder=ascending`;
}

/**
 * The listing feed (`rss.arxiv.org/atom/<category>`) begins every summary with its own header, "arXiv:<id>v<n> Announce Type: <type> Abstract: ", before the abstract (the API's summaries
 * have none). It is taken off, so the abstract the pack holds is the paper's own text. Written from arXiv's description of that feed, not from a capture: the list reads the same
 * with no header, and Kobol's first fallback read shows the real one (`kobol_verify`).
 */
const LISTING_HEADER = /^arXiv:\S+\s+Announce Type:\s*\S+\s+Abstract:\s*/i;

/**
 * A list's entries as candidates, each dated by the list's announcement, the listing feed's header taken off a summary. The API's
 * summaries have no header, so the strip changes nothing there; it is applied to every list because a cached list does not say which feed
 * wrote it, and a list read back must give the items the first read gave.
 */
const listItems = (entries: readonly ArxivEntry[], list: ArxivList): RawItem[] =>
  arxivRawItems(entries, list.announcedAt).map((i) => ({ ...i, abstract: i.abstract.replace(LISTING_HEADER, "") }));

/** The listing feed's facts that decide whether it holds a list: when it was last built, and the ids it marks as revisions of older papers. */
function listingFacts(body: Buffer): { updatedMs: number | null; revisions: Set<string> } {
  const $ = load(body.toString("utf8"), { xml: true });
  const updated = feedDate($("feed > updated").first().text());
  const revisions = new Set<string>();
  $("feed > entry").each((_, el) => {
    const e = $(el);
    if (!/^replace/i.test(e.children("arxiv\\:announce_type").first().text().trim())) return;
    const m = /(\d{4}\.\d{4,5})(?:v\d+)?\s*$/.exec(e.children("id").first().text().trim());
    if (m) revisions.add(m[1]!);
  });
  return { updatedMs: updated === null ? null : Date.parse(updated), revisions };
}

/** One arXiv list as read: where it came from and what it held. */
export interface ArxivListRead {
  list: ArxivList;
  ok: boolean;
  error: FetchErrorClass | null;
  items: FeedItem[];
  /** The entries the list held (before any reader filtering is counted: the listing feed's revisions are not entries). */
  entries: number;
  source: "cache" | "api" | "listing" | "none";
  urlUsed: string | null;
  sha256: string | null;
  bytes: number;
  triedFallback: boolean;
  fallbackUsed: boolean;
  note: string | null;
  fetched: RequestRecord[];
}

interface CachedList {
  body: Buffer;
  entries: number;
  items: RawItem[];
}

/**
 * The list a cache file holds, or null. A file that does not parse, or that holds no entry (an empty answer is never kept, so one is not
 * ours), is removed so that the list is fetched again (§4.13, as Cyber's `readZip()` treats a zip that no longer parses).
 */
function cachedList(ctx: FeedCtx, file: string, list: ArxivList): CachedList | null {
  let body: Buffer;
  try {
    body = fs.readFileSync(file);
  } catch {
    return null;
  }
  try {
    // A cached listing keeps the revisions it was received with (the file is the answer as received), so they are left out here as at the first read; an API answer marks none.
    const revisions = listingFacts(body).revisions;
    const page = listItems(parseArxivEntries(body).entries.filter((e) => !revisions.has(e.id)), list);
    if (page.length > 0) return { body, entries: page.length, items: page };
    ctx.log(`arxiv: the cached ${path.basename(file)} holds no entry; fetching it again.`);
  } catch (e) {
    ctx.log(`arxiv: the cached ${path.basename(file)} did not parse (${(e as Error).message.slice(0, 200)}); fetching it again.`);
  }
  cacheRemove(ctx, file);
  return null;
}

/**
 * One announcement's list (SPEC §4.13): the cached file `cache/feeds/arxiv/<id>.<US date>.xml` when it parses and holds an entry,
 * else the API's answer for the list's `submittedDate` range, and (`fallback` true) the feed's listing when the API fails, which must
 * have been built since the announcement. A list that answers with no entry is a valid empty list: it is not kept and not a failure. A
 * list the API gave in part (its `totalResults` is above the entries it holds) is used for the morning, noted, and not kept, so a later
 * morning's lookback fetches it again instead of reading half of it from the cache. The listing's revisions of older papers are not
 * new submissions and are left out.
 */
export async function readArxivList(entry: FeedEntry, ctx: FeedCtx, spend: Spend, list: ArxivList, o: { fallback: boolean }): Promise<ArxivListRead> {
  const file = ctx.paths.arxivList(entry.id, list.usDate);
  const base: ArxivListRead = {
    list, ok: true, error: null, items: [], entries: 0, source: "none", urlUsed: null, sha256: null, bytes: 0, triedFallback: false, fallbackUsed: false, note: null, fetched: [],
  };
  const cached = cachedList(ctx, file, list);
  if (cached) {
    return { ...base, items: cached.items.map((i) => feedItem(i)), entries: cached.entries, source: "cache", sha256: sha256Hex(cached.body), bytes: cached.body.length };
  }
  if (!hasBudget(spend)) {
    ctx.log(`${entry.id}: the list of ${list.usDate} is not cached and the request budget is spent`);
    return { ...base, ok: false, error: "timeout", note: `The arXiv list of ${list.usDate} was not read: the request budget is spent.` };
  }
  const feed = { id: entry.id, fallback_url: o.fallback ? entry.fallback_url : null };
  const r = await withFallback(ctx, feed, spend, arxivApiUrl(entry.url, entry.id, list), (body, _r, index) => {
    if (index === 0) {
      const page = parseArxivEntries(body);
      const partial = page.total_results !== null && page.total_results > page.entries.length;
      return { items: listItems(page.entries, list), partial: partial ? `${page.entries.length} of ${page.total_results} entries` : null };
    }
    const facts = listingFacts(body);
    if (facts.updatedMs === null || facts.updatedMs < list.announcedMs) {
      throw new FeedParseError("schema", "arXiv: the listing feed was built before the announcement, so it holds an earlier list");
    }
    const page = parseArxivEntries(body);
    return { items: listItems(page.entries.filter((e) => !facts.revisions.has(e.id)), list), partial: null };
  }, {
    limit: "arxivList", max: "arxivList",
    body: (body, data, index) => {
      // A list read in part (fewer entries than the answer says it holds) is not kept: a later morning's lookback would read it from the cache as the whole list.
      if (data.items.length > 0 && data.partial === null && (index === 0 || o.fallback)) cacheWrite(ctx, file, body);
    },
  });
  if (!r.ok || !r.data) {
    return { ...base, ok: false, error: r.error, urlUsed: r.urlUsed, triedFallback: r.triedFallback, bytes: r.bytes, fetched: r.fetched };
  }
  const items = r.data.items.map((i) => feedItem(i));
  return {
    ...base, items, entries: items.length, source: r.fallbackUsed ? "listing" : "api", urlUsed: r.urlUsed, sha256: r.sha256, bytes: r.bytes,
    triedFallback: r.triedFallback, fallbackUsed: r.fallbackUsed, fetched: r.fetched,
    note: r.data.partial === null ? null : `arXiv: the list of ${list.usDate} was read in part (${r.data.partial}).`,
  };
}

/**
 * The announcement time of the newest list the cache holds for a feed (a file that parses and holds an entry), or null: the `newest` of
 * an arXiv feed, since `fresh_days` is judged on the newest cached list, so a morning that reads no list after a holiday is not stale (§4.13).
 */
export function newestCachedArxiv(ctx: FeedCtx, feedId: string, skipped: readonly string[]): string | null {
  let names: string[];
  try {
    names = fs.readdirSync(ctx.paths.arxivDir);
  } catch {
    return null;
  }
  const dates = names.flatMap((n) => {
    const m = /^(.+)\.(\d{4}-\d{2}-\d{2})\.xml$/.exec(n);
    return m && m[1] === feedId && isValidDate(m[2]!) ? [m[2]!] : [];
  }).sort((a, b) => byCodeUnit(b, a));
  for (const usDate of dates) {
    const list = arxivListFor(usDate, skipped);
    if (!list) continue;
    try {
      if (parseArxivEntries(fs.readFileSync(ctx.paths.arxivList(feedId, usDate))).entries.length > 0) return list.announcedAt;
    } catch {
      // a list that does not parse is not the newest one; the next read removes it
    }
  }
  return null;
}

/**
 * An `arxiv-<cat>` feed's morning (SPEC §4.13): the window's announcement read in full (none on a Sunday or Monday morning, or the
 * morning a skipped announcement would have reached: no request, no failure), then the lookback's announcements from the cache and
 * fetched only when missing and within the feed's budget, never through the fallback. The feed fails only when the window's list
 * could not be read by the API or its listing; a lookback list that cannot be read is logged and noted.
 */
export async function readArxiv(entry: FeedEntry, ctx: FeedCtx, run: FeedRun): Promise<Read<FeedData>> {
  const spend = spendOf(entry);
  const win = windowAnnouncement(run.date, run.arxivSkipped);
  const lookbackLists = run.lookback === false ? [] : lookbackAnnouncements(run.date, run.arxivSkipped);
  const reads: ArxivListRead[] = [];
  const windowRead = win === null ? null : await readArxivList(entry, ctx, spend, win, { fallback: true });
  if (windowRead) reads.push(windowRead);
  const lookbackReads: ArxivListRead[] = [];
  for (const list of lookbackLists) {
    const lr = await readArxivList(entry, ctx, spend, list, { fallback: false });
    lookbackReads.push(lr);
    reads.push(lr);
  }
  const fetched = reads.flatMap((r) => r.fetched);
  const t: Trace = { fetched, bytes: reads.reduce((n, r) => n + r.bytes, 0), keep: () => {} };
  const unread = lookbackReads.filter((r) => !r.ok).map((r) => r.list.usDate);
  for (const r of lookbackReads) if (!r.ok) ctx.log(`${entry.id}: the lookback list of ${r.list.usDate} was not read (${r.error})`);
  const notes = [...reads.flatMap((r) => (r.note ? [r.note] : []))];
  const note = notes.length > 0 ? notes.join(" ").slice(0, 200) : null;
  if (windowRead && !windowRead.ok) {
    return failedRead(spend, t, windowRead.error ?? "network", windowRead.urlUsed, { triedFallback: windowRead.triedFallback, note });
  }
  const data: FeedData = {
    items: windowRead?.items ?? [],
    lookback: lookbackReads.flatMap((r) => r.items),
    newest: newestCachedArxiv(ctx, entry.id, run.arxivSkipped),
    total: windowRead?.entries ?? 0,
    announcement: windowRead && windowRead.entries > 0 && win ? win.announcedAt : null,
    unread,
  };
  return finished(spend, t, data, {
    urlUsed: windowRead?.urlUsed ?? null, triedFallback: windowRead?.triedFallback ?? false, fallbackUsed: windowRead?.fallbackUsed ?? false,
    sha256: windowRead?.sha256 ?? null, note,
  });
}

// ── bioRxiv and medRxiv ──────────────────────────────────────────────────────────────────────────

/** The items a page gives, with the page's own counts: `count` of this page, the `total` the days hold and this page's `cursor`. */
export interface BiorxivPage {
  items: (RawItem & { version: number })[];
  count: number;
  total: number | null;
  cursor: number | null;
}

/** The records per page of the details API, which pages by cursor (§4.13). */
export const BIORXIV_PAGE = 30;

const asInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/** `https://api.biorxiv.org/details/<server>/<from>/<to>/<cursor>`: both days included, UTC. */
export const biorxivUrl = (base: string, from: string, to: string, cursor: number): string => `${base}/${from}/${to}/${cursor}`;

/**
 * One page of the details API. An answer with no `collection` list is `schema`; a page that says it found no posts (`collection` empty) is a
 * valid empty page. A record with no DOI or no title is left out. A DOI is in §4.1's form (bioRxiv's begin 10.1101 or 10.64898).
 */
export function parseBiorxiv(body: Buffer, server: "biorxiv" | "medrxiv", zone: string | null = null): BiorxivPage {
  const root = jsonObject(body, "bioRxiv");
  if (!Array.isArray(root.collection)) throw new FeedParseError("schema", "bioRxiv: the answer has no collection");
  const message = isObj(asArr(root.messages)[0]) ? (asArr(root.messages)[0] as Record<string, unknown>) : {};
  const items = root.collection.flatMap((rec) => {
    if (!isObj(rec)) return [];
    const doi = normalizeDoi(asStr(rec.doi));
    const title = plain(rec.title);
    if (doi === null || title === "") return [];
    const version = asInt(rec.version) ?? 1;
    return [{
      ...rawItem({
        title, url: `https://www.${server}.org/content/${doi}v${version}`, published_at: dayStamp(textDate(asStr(rec.date)), zone), abstract: plain(rec.abstract), doi,
        categories: plain(rec.category) === "" ? [] : [plain(rec.category)],
      }),
      version,
    }];
  });
  return { items, count: asInt(message.count) ?? root.collection.length, total: asInt(message.total), cursor: asInt(message.cursor) };
}

/**
 * bioRxiv or medRxiv (SPEC §4.13): 30 records a page by cursor for the UTC days the window touches, at most the budget of pages (20 and 5);
 * the same DOI posted in two versions in the range is one item, the later version. A page that fails ends the read, and the feed has what the
 * pages before it gave (noted); the feed fails only when its first page does.
 */
export async function readBiorxiv(entry: FeedEntry, ctx: FeedCtx, run: FeedRun): Promise<Read<FeedData>> {
  const spend = spendOf(entry);
  const t = trace(ctx);
  const server = entry.id === "medrxiv" ? "medrxiv" : "biorxiv";
  const from = utcDateOf(run.window.start);
  const to = utcDateOf(run.window.end);
  const byDoi = new Map<string, RawItem & { version: number }>();
  let cursor = 0;
  let total: number | null = null;
  let pages = 0;
  let stopped: FetchErrorClass | null = null;
  let urlUsed: string | null = null;
  while (hasBudget(spend)) {
    const url = biorxivUrl(entry.url, from, to, cursor);
    const r = await get(ctx, spend, url);
    urlUsed = url;
    if (!r.ok || !r.body) {
      stopped = r.error ?? "network";
      break;
    }
    let page: BiorxivPage;
    try {
      page = parseBiorxiv(r.body, server, entry.date_zone);
    } catch (e) {
      ctx.log(`${entry.id}: ${url} did not parse: ${(e as Error).message.slice(0, 300)}`);
      stopped = parseClass(e);
      break;
    }
    t.keep(r, r.body);
    if (pages === 0) cacheWrite(ctx, ctx.paths.feedBody(entry.id, "json"), r.body);
    pages += 1;
    for (const item of page.items) {
      const known = item.doi === null ? undefined : byDoi.get(item.doi);
      if (item.doi !== null && (known === undefined || item.version > known.version)) byDoi.set(item.doi, item);
    }
    total = page.total ?? total;
    if (page.count <= 0) break;
    cursor += page.count;
    if (total === null || cursor >= total) break;
  }
  if (pages === 0) return failedRead(spend, t, stopped ?? "timeout", urlUsed);
  const items = [...byDoi.values()].map(({ version: _version, ...r }) => feedItem(r));
  const unread = stopped !== null || (total !== null && cursor < total) ? [`${Math.min(cursor, total ?? cursor)} of ${total ?? "?"} records read`] : [];
  const note = unread.length > 0 ? `${server}: ${unread[0]}.` : null;
  return finished(spend, t, baseData(items, { total: items.length, unread }), { urlUsed, note });
}

// ── PubMed ───────────────────────────────────────────────────────────────────────────────────────

export const PUBMED_RETMAX = 1000;
/** The PMIDs per `esummary` and `efetch` request (§4.13). */
export const PUBMED_BATCH = 200;

/** E-utilities' base: the registry's `esearch.fcgi` address without its file name. */
const eutilsBase = (url: string): string => url.replace(/[^/]*$/, "");

/** `esearch`: the phrases of `ai-terms.json` in title or abstract, entered into PubMed on the UTC days from `from` to `to`, up to 1,000 PMIDs, as JSON. */
export function pubmedSearchUrl(url: string, phrases: readonly string[], from: string, to: string): string {
  const term = `(${phrases.map((p) => `"${p}"[Title/Abstract]`).join(" OR ")})`;
  return `${url}?db=pubmed&retmode=json&retmax=${PUBMED_RETMAX}&datetype=edat&mindate=${from.replaceAll("-", "/")}&maxdate=${to.replaceAll("-", "/")}&term=${encodeURIComponent(term)}`;
}

/** `esummary`: the records of up to 200 PMIDs as JSON (title, dates, DOI and `pubtype`, but no abstract). */
export const pubmedSummaryUrl = (url: string, pmids: readonly string[]): string => `${eutilsBase(url)}esummary.fcgi?db=pubmed&retmode=json&id=${pmids.join(",")}`;

/** `efetch`: the full records of up to 200 PMIDs as XML (the abstracts). */
export const pubmedFetchUrl = (url: string, pmids: readonly string[]): string => `${eutilsBase(url)}efetch.fcgi?db=pubmed&retmode=xml&id=${pmids.join(",")}`;

export function parsePubmedSearch(body: Buffer): { count: number; ids: string[] } {
  const result = jsonObject(body, "PubMed").esearchresult;
  if (!isObj(result) || !Array.isArray(result.idlist)) throw new FeedParseError("schema", "PubMed: the answer has no esearchresult.idlist");
  const ids = result.idlist.filter((id): id is string => typeof id === "string" && /^\d{1,10}$/.test(id));
  return { count: asInt(result.count) ?? ids.length, ids };
}

/** One PubMed record as `esummary` gives it. */
export interface PubmedRecord {
  pmid: string;
  title: string;
  doi: string | null;
  journal: string | null;
  /** `sortpubdate`'s day, else `epubdate`'s or `pubdate`'s when it names a day; null otherwise. */
  day: string | null;
  /** `pubtype`, in order: the pack's `types` (§4.14). */
  types: string[];
}

/** The records of an `esummary` answer, by PMID. A uid whose record is an error or has no title is left out. */
export function parsePubmedSummary(body: Buffer): Map<string, PubmedRecord> {
  const result = jsonObject(body, "PubMed").result;
  if (!isObj(result) || !Array.isArray(result.uids)) throw new FeedParseError("schema", "PubMed: the answer has no result.uids");
  const out = new Map<string, PubmedRecord>();
  for (const uid of result.uids) {
    if (typeof uid !== "string") continue;
    const rec = result[uid];
    if (!isObj(rec) || typeof rec.error === "string") continue;
    const title = plain(rec.title);
    if (title === "") continue;
    const doiId = asArr(rec.articleids).find((a) => isObj(a) && asStr(a.idtype) === "doi");
    const sort = asStr(rec.sortpubdate).replace(/^(\d{4})\/(\d{2})\/(\d{2})/, "$1-$2-$3");
    out.set(uid, {
      pmid: uid, title, doi: isObj(doiId) ? normalizeDoi(asStr(doiId.value)) : null, journal: plain(rec.fulljournalname) || null,
      day: textDate(sort) ?? textDate(asStr(rec.epubdate)) ?? textDate(asStr(rec.pubdate)),
      types: asArr(rec.pubtype).flatMap((x) => (typeof x === "string" && x.trim() !== "" ? [squash(x)] : [])),
    });
  }
  return out;
}

/** The abstracts of an `efetch` answer, by PMID: its `AbstractText` parts joined by a space, markup out; a record with none is left out. */
export function parsePubmedAbstracts(body: Buffer): Map<string, string> {
  const $ = load(body.toString("utf8"), { xml: true });
  if ($("PubmedArticleSet").length === 0) throw new FeedParseError("parse", "PubMed: the answer is not a PubmedArticleSet");
  const out = new Map<string, string>();
  $("PubmedArticle").each((_, el) => {
    const article = $(el);
    const pmid = squash(article.find("MedlineCitation > PMID").first().text());
    const parts = article.find("Article > Abstract > AbstractText").toArray().map((p) => plain($(p).html() ?? ""));
    const text = squash(parts.filter((p) => p !== "").join(" "));
    if (/^\d+$/.test(pmid) && text !== "") out.set(pmid, text);
  });
  return out;
}

const chunk = <T>(items: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/**
 * PubMed (SPEC §4.13): `esearch` (JSON, `datetype=edat`, the AI terms, `retmax=1000`) for the UTC days the window touches, `esummary` and `efetch`
 * at 200 PMIDs a request, all inside the feed's budget of 12 (one search, five summaries, five fetches, one to spare). The search failing fails the
 * feed; a summary that fails leaves its PMIDs out and a fetch that fails leaves its abstracts empty, each noted.
 */
export async function readPubmed(entry: FeedEntry, ctx: FeedCtx, run: FeedRun): Promise<Read<FeedData>> {
  const spend = spendOf(entry);
  const t = trace(ctx);
  const searchUrl = pubmedSearchUrl(entry.url, run.aiPhrases, utcDateOf(run.window.start), utcDateOf(run.window.end));
  const search = await get(ctx, spend, searchUrl);
  if (!search.ok || !search.body) return failedRead(spend, t, search.error ?? "network", searchUrl);
  let found: { count: number; ids: string[] };
  try {
    found = parsePubmedSearch(search.body);
  } catch (e) {
    ctx.log(`${entry.id}: the search did not parse: ${(e as Error).message.slice(0, 300)}`);
    return failedRead(spend, t, parseClass(e), searchUrl);
  }
  t.keep(search, search.body);
  cacheWrite(ctx, ctx.paths.feedBody(entry.id, "json"), search.body);
  const unread: string[] = [];
  if (found.count > found.ids.length) unread.push(`${found.ids.length} of ${found.count} PMIDs`);
  const records = new Map<string, PubmedRecord>();
  const batches = chunk(found.ids, PUBMED_BATCH);
  for (const [i, ids] of batches.entries()) {
    if (!hasBudget(spend)) {
      unread.push(`summaries of ${found.ids.length - i * PUBMED_BATCH} PMIDs`);
      break;
    }
    const r = await get(ctx, spend, pubmedSummaryUrl(entry.url, ids));
    let got: Map<string, PubmedRecord> | null = null;
    if (r.ok && r.body) {
      try {
        got = parsePubmedSummary(r.body);
        t.keep(r, r.body);
        if (i === 0) cacheWrite(ctx, ctx.paths.feedBody(entry.id, "summary.json"), r.body);
      } catch (e) {
        ctx.log(`${entry.id}: a summary did not parse: ${(e as Error).message.slice(0, 300)}`);
      }
    }
    if (got === null) unread.push(`summaries of ${ids.length} PMIDs`);
    else for (const [k, v] of got) records.set(k, v);
  }
  const abstracts = new Map<string, string>();
  const known = found.ids.filter((id) => records.has(id));
  for (const [i, ids] of chunk(known, PUBMED_BATCH).entries()) {
    if (!hasBudget(spend)) {
      unread.push("abstracts past the budget");
      break;
    }
    const r = await get(ctx, spend, pubmedFetchUrl(entry.url, ids));
    let got: Map<string, string> | null = null;
    if (r.ok && r.body) {
      try {
        got = parsePubmedAbstracts(r.body);
        t.keep(r, r.body);
        if (i === 0) cacheWrite(ctx, ctx.paths.feedBody(entry.id, "fetch.xml"), r.body);
      } catch (e) {
        ctx.log(`${entry.id}: a fetch did not parse: ${(e as Error).message.slice(0, 300)}`);
      }
    }
    if (got === null) unread.push(`abstracts of ${ids.length} PMIDs`);
    else for (const [k, v] of got) abstracts.set(k, v);
  }
  const items = found.ids.flatMap((id) => {
    const rec = records.get(id);
    return rec === undefined ? [] : [feedItem(rawItem({
      title: rec.title, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, published_at: dayStamp(rec.day, entry.date_zone), abstract: abstracts.get(id) ?? "",
      doi: rec.doi, journal: rec.journal, types: rec.types,
    }))];
  });
  const note = unread.length > 0 ? `PubMed: ${unread.join("; ")} not read.`.slice(0, 200) : null;
  return finished(spend, t, baseData(items, { unread }), { urlUsed: searchUrl, note });
}

// ── Crossref: a journal's new articles, and notices ──────────────────────────────────────────────

/** The records of one Crossref request for a journal (rows per page). */
export const CROSSREF_ROWS = 100;

/** `works?filter=issn:<issn>,from-pub-date:<from>&rows=100`, with `&offset=<n>` for a later page. */
export const crossrefJournalUrl = (url: string, issn: string, from: string, offset = 0): string =>
  `${url}?filter=issn:${issn},from-pub-date:${from}&rows=${CROSSREF_ROWS}${offset > 0 ? `&offset=${offset}` : ""}`;

/** One work of a Crossref list, with the strings as the record gives them. */
export interface CrossrefWork {
  doi: string | null;
  title: string;
  url: string | null;
  /** The full day of `published-online`, else `published`, else `issued`; null when none gives one (a year alone is no day). */
  day: string | null;
  abstract: string;
  container: string | null;
}

/** The works of a Crossref list answer and the total it says it holds. A record with no title is left out. */
export function parseCrossrefWorks(body: Buffer): { total: number | null; works: CrossrefWork[] } {
  const message = jsonObject(body, "Crossref").message;
  if (!isObj(message) || !Array.isArray(message.items)) throw new FeedParseError("schema", "Crossref: the answer has no message.items");
  const works = message.items.flatMap((rec) => {
    if (!isObj(rec)) return [];
    const title = plain(firstStr(rec.title));
    if (title === "") return [];
    const day = [rec["published-online"], rec.published, rec.issued].map((p) => fullDay(dateParts(p))).find((d) => d !== null) ?? null;
    return [{
      doi: normalizeDoi(asStr(rec.DOI)), title, url: absolute(asStr(rec.URL), "https://doi.org/"), day, abstract: plain(rec.abstract),
      container: plain(firstStr(rec["container-title"])) || null,
    }];
  });
  return { total: asInt(message["total-results"]), works };
}

/**
 * Crossref's journals (SPEC §4.13): one request for each journal of `config/journals.json`, in order, for the works published since the window's first UTC
 * day; then, while the budget lasts, a second page for a journal that holds more than a page. Every journal gets its first request before any gets a second. Crossref
 * holds almost no abstract for the leading journals, so an item may hold a title only. The feed fails only when no journal answered; the journals that did not are
 * listed in `unread`.
 */
export async function readCrossrefJournals(entry: FeedEntry, ctx: FeedCtx, run: FeedRun): Promise<Read<FeedData>> {
  const spend = spendOf(entry);
  const t = trace(ctx);
  const from = utcDateOf(run.window.start);
  const items: FeedItem[] = [];
  const seen = new Set<string>();
  const unread: string[] = [];
  const more: { id: string; issn: string; offset: number }[] = [];
  let lastError: FetchErrorClass = "network";
  let answered = 0;
  let dropped = 0;
  const take = (id: string, works: CrossrefWork[]): void => {
    for (const w of works) {
      const key = w.doi ?? w.url ?? w.title;
      if (seen.has(key)) continue;
      seen.add(key);
      // A work with neither a DOI nor a web address has nothing to link to, as an RSS item with no web link has not (`webItems()`): left out, still counted in `total`.
      if (w.url === null && w.doi === null) {
        dropped += 1;
        continue;
      }
      items.push(feedItem(rawItem({
        title: w.title, url: w.url ?? `https://doi.org/${w.doi}`, published_at: dayStamp(w.day, entry.date_zone), abstract: w.abstract, doi: w.doi, journal: w.container,
      }), id));
    }
  };
  const page = async (j: { id: string; issn: string }, offset: number): Promise<boolean> => {
    const url = crossrefJournalUrl(entry.url, j.issn, from, offset);
    const r = await get(ctx, spend, url);
    if (!r.ok || !r.body) {
      lastError = r.error ?? "network";
      return false;
    }
    try {
      const parsed = parseCrossrefWorks(r.body);
      t.keep(r, r.body);
      if (offset === 0) cacheWrite(ctx, ctx.paths.feedBody(`${entry.id}-${j.id}`, "json"), r.body);
      take(j.id, parsed.works);
      if (parsed.total !== null && parsed.total > offset + CROSSREF_ROWS && parsed.works.length > 0) more.push({ ...j, offset: offset + CROSSREF_ROWS });
      return true;
    } catch (e) {
      ctx.log(`${entry.id}: ${url} did not parse: ${(e as Error).message.slice(0, 300)}`);
      lastError = parseClass(e);
      return false;
    }
  };
  for (const j of run.journals) {
    if (!hasBudget(spend)) {
      unread.push(j.id);
      continue;
    }
    if (await page(j, 0)) answered += 1;
    else unread.push(j.id);
  }
  for (let k = 0; k < more.length && hasBudget(spend); k++) {
    const next = more[k]!;
    if (!(await page(next, next.offset))) unread.push(`${next.id} (page ${next.offset / CROSSREF_ROWS + 1})`);
  }
  if (answered === 0) return failedRead(spend, t, lastError, entry.url, { note: run.journals.length === 0 ? "Crossref: no journal to ask." : null });
  const note = unread.length > 0 ? `Crossref: ${unread.length} request${unread.length === 1 ? "" : "s"} not answered.` : null;
  return finished(spend, t, baseData(items, { unread, total: items.length + dropped }), { urlUsed: entry.url, note });
}

/** One notice of Crossref's `updates:` filter: a work that updates another (a retraction, an expression of concern, a correction). Strings are raw. */
export interface CrossrefNotice {
  doi: string;
  title: string | null;
  container: string | null;
  publisher: string | null;
  url: string | null;
  /** The record's `published` date parts as `YYYY-MM-DD`; null for a year alone or a year and a month (§5.8: a date is never invented). */
  published: string | null;
  published_parts: number[];
  /** `update-to`: each update this work makes, with the DOI it updates. */
  updates: { doi: string; type: string; source: string | null; label: string | null; date: string | null }[];
}

/** The notices of an `updates:` answer, and `rows`, the records the answer holds (a record with no DOI is left out of `notices` only). */
export function parseCrossrefNotices(body: Buffer): { total: number | null; rows: number; notices: CrossrefNotice[] } {
  const message = jsonObject(body, "Crossref").message;
  if (!isObj(message) || !Array.isArray(message.items)) throw new FeedParseError("schema", "Crossref: the answer has no message.items");
  const notices = message.items.flatMap((rec) => {
    if (!isObj(rec)) return [];
    const doi = normalizeDoi(asStr(rec.DOI));
    if (doi === null) return [];
    const parts = dateParts(rec.published);
    return [{
      doi, title: firstStr(rec.title) || null, container: firstStr(rec["container-title"]) || null, publisher: asStr(rec.publisher) || null,
      url: absolute(asStr(rec.URL), "https://doi.org/"), published: fullDay(parts), published_parts: parts,
      updates: asArr(rec["update-to"]).flatMap((u) => {
        if (!isObj(u)) return [];
        const target = normalizeDoi(asStr(u.DOI));
        const type = asStr(u.type).trim().toLowerCase();
        const updated = isObj(u.updated) ? u.updated : {};
        return target === null || type === "" ? [] : [{
          doi: target, type, source: asStr(u.source) || null, label: asStr(u.label) || null,
          date: fullDay(dateParts(updated)) ?? textDate(asStr(updated["date-time"])),
        }];
      }),
    }];
  });
  return { total: asInt(message["total-results"]), rows: message.items.length, notices };
}

/** DOIs asked in one `updates:` request (SPEC §4.13: 50 filters answered as their OR). */
export const CROSSREF_UPDATES_BATCH = 50;
/** Notices asked for in one answer: a notice can name many works (one named 266), so an answer can exceed 50. */
export const CROSSREF_UPDATES_ROWS = 1000;

/** A DOI in a filter value: escaped for a URL, with the slash and colon left as written. A DOI holding a comma cannot be asked (the filter's own separator). */
const filterDoi = (doi: string): string => encodeURIComponent(doi).replaceAll("%2F", "/").replaceAll("%3A", ":");

/** `works?filter=updates:<doi>,updates:<doi>,...&rows=1000`. */
export const crossrefUpdatesUrl = (url: string, dois: readonly string[]): string => `${url}?filter=${dois.map((d) => `updates:${filterDoi(d)}`).join(",")}&rows=${CROSSREF_UPDATES_ROWS}`;

/** What `readCrossrefUpdates()` gives. */
export interface CrossrefUpdatesData {
  notices: CrossrefNotice[];
  /** DOIs whose batch answered: a DOI in no notice here has none. */
  answered: string[];
  /** DOIs whose batch failed, or lay past the budget; the watch leaves their check for another morning. */
  unanswered: string[];
  /** DOIs left out because they are no DOI or hold a comma. */
  skipped: string[];
  /** True when the answer for a single DOI held more notices than its page (`total-results` over the records returned): nothing narrower can be asked. */
  truncated: boolean;
}

/**
 * The notices that update some DOIs (SPEC §5.8, §8.9): the DOIs in §4.1's form, once each, in code-unit order, 50 to a request, each answer asked for up to 1,000 notices, inside the
 * feed's budget of 10 (500 DOIs). A batch whose answer says it holds more notices than it gave (`total-results` over the records returned) is split in halves, each asked again
 * in turn (the first half, and what it splits into, before the second) while the budget lasts, since a single notice can name hundreds of works (§5.8 "Settled in P2"); the
 * notices of the answer that was cut are kept, and a single DOI that still overflows is `truncated`. A batch that fails or lies past the budget leaves its DOIs in `unanswered`. The read
 * fails only when no batch answered. Only the reader is here; the rung watch calls it.
 */
export async function readCrossrefUpdates(entry: FeedEntry, ctx: FeedCtx, dois: readonly string[]): Promise<Read<CrossrefUpdatesData>> {
  const spend = spendOf(entry);
  const t = trace(ctx);
  const skipped: string[] = [];
  const clean = new Set<string>();
  for (const d of dois) {
    const doi = normalizeDoi(d);
    if (doi === null || doi.includes(",")) skipped.push(d);
    else clean.add(doi);
  }
  const sorted = [...clean].sort(byCodeUnit);
  const notices = new Map<string, CrossrefNotice>();
  const answered: string[] = [];
  const unanswered: string[] = [];
  let truncated = false;
  let lastError: FetchErrorClass = "network";
  let first = true;
  const queue = chunk(sorted, CROSSREF_UPDATES_BATCH);
  for (let batch = queue.shift(); batch !== undefined; batch = queue.shift()) {
    if (!hasBudget(spend)) {
      unanswered.push(...batch);
      continue;
    }
    const url = crossrefUpdatesUrl(entry.url, batch);
    const r = await get(ctx, spend, url);
    let ok = false;
    let overflow = false;
    if (r.ok && r.body) {
      try {
        const p = parseCrossrefNotices(r.body);
        t.keep(r, r.body);
        if (first) cacheWrite(ctx, ctx.paths.feedBody(entry.id, "json"), r.body);
        first = false;
        for (const n of p.notices) notices.set(n.doi, n);
        overflow = p.total !== null && p.total > p.rows;
        ok = true;
      } catch (e) {
        ctx.log(`${entry.id}: ${url} did not parse: ${(e as Error).message.slice(0, 300)}`);
        lastError = parseClass(e);
      }
    } else {
      lastError = r.error ?? "network";
    }
    // `overflow` is set only by an answer that parsed, so a failed batch is never split.
    if (overflow && batch.length > 1) {
      const half = Math.ceil(batch.length / 2);
      queue.unshift(batch.slice(0, half), batch.slice(half));
      continue;
    }
    if (overflow) truncated = true;
    (ok ? answered : unanswered).push(...batch);
  }
  const data: CrossrefUpdatesData = { notices: [...notices.values()].sort((a, b) => byCodeUnit(a.doi, b.doi)), answered, unanswered, skipped, truncated };
  if (sorted.length > 0 && answered.length === 0) return failedRead(spend, t, lastError, entry.url, { data });
  const note = unanswered.length > 0 ? `Crossref notices: ${unanswered.length} DOI${unanswered.length === 1 ? "" : "s"} not checked.` : null;
  return finished(spend, t, data, { urlUsed: entry.url, note });
}

// ── RSS and Atom feeds ───────────────────────────────────────────────────────────────────────────

/**
 * A journal's, lab's or other RSS or Atom feed (the registry's `rss` kind): the feed's URL, then its fallback when it fails or does not parse, each read by
 * `parseRss()` (RSS 1.0, RSS 2.0 and Atom). Items keep what the feed gives (types stay empty: only PubMed gives them, §4.14); markup is taken out of the title and the abstract.
 */
export async function readRssFeed(entry: FeedEntry, ctx: FeedCtx): Promise<Read<FeedData>> {
  const spend = spendOf(entry);
  const journalId = journalIdOfFeed(entry.id);
  const r = await withFallback(ctx, entry, spend, entry.url, async (body) => (await parseRss(body, entry.date_zone)).entries, {
    body: (body) => cacheWrite(ctx, ctx.paths.feedBody(entry.id, "xml"), body),
  });
  if (!r.ok || !r.data) return { ...r, data: null };
  return { ...r, data: baseData(webItems(r.data, r.urlUsed ?? entry.url).map((i) => cleanItem(i, journalId)), { total: r.data.length }) };
}

/**
 * The items whose link is a web address, each link written out in full against the page it came from: an item with a link that is not
 * http or https (`javascript:`, `mailto:`, `data:`) or cannot be read is data a reader has no use for and is left out (it still counts in `total`).
 */
function webItems(items: readonly RawItem[], base: string): RawItem[] {
  return items.flatMap((i) => {
    const url = absolute(i.url, base);
    return url === null ? [] : [{ ...i, url }];
  });
}

/** True for the path of a reaction: `/expert-reaction-to-...` or `/experts-react-...` (§4.13). */
export const isSmcReactionPath = (pathname: string): boolean => pathname.startsWith("/expert-reaction-to-") || pathname.startsWith("/experts-react-");

/** True for a reaction of the Science Media Centre: a reaction path on the feed's own host, so a link out to another site is never one. */
const smcReaction = (url: string, host: string): boolean => {
  try {
    const u = new URL(url);
    return u.hostname === host && isSmcReactionPath(u.pathname);
  } catch {
    return false;
  }
};

// ── Page feeds ───────────────────────────────────────────────────────────────────────────────────

type Sel = Cheerio<Element>;

/** One item of a page feed: the link, the title and the day the page prints (null when it prints none). */
export interface PageItem {
  title: string;
  url: string;
  day: string | null;
  categories: string[];
}

/** The text of an element without the text of its `time` elements and its date, squashed. */
function textWithout(sel: Sel, drop: string): string {
  const copy = sel.clone();
  copy.find(drop).remove();
  return squash(copy.text());
}

/**
 * The text of an element with a space round every element inside it, for finding a day in a card: minified markup has no whitespace between
 * `<h3>A title</h3><p>Nov 20, 2026</p>`, and plain `.text()` would read "titleNov 20, 2026", where no word boundary lets the day be found.
 */
function spacedText(sel: Sel): string {
  const copy = sel.clone();
  copy.find("*").prepend(" ").append(" ");
  return squash(copy.text());
}

/** A title: the first heading inside the element, else its own text without any `time`, else its `aria-label` or `title`. */
function titleOf(sel: Sel): string {
  const heading = squash(sel.find("h1, h2, h3, h4, h5, h6").first().text());
  if (heading !== "") return heading;
  const text = textWithout(sel, "time");
  return text !== "" ? text : squash(sel.attr("aria-label") ?? sel.attr("title") ?? "");
}

/** The day of a `time` element: its `datetime` attribute, else the date its text writes. */
function timeDay($: CheerioAPI, scope: Sel): string | null {
  const t = scope.find("time").first();
  if (t.length === 0) return null;
  return textDate(t.attr("datetime") ?? "") ?? textDate(squash(t.text()));
}

/**
 * The container of a link that holds no other post's link: the link itself, else the nearest ancestor (up to five levels) whose links to posts all lead to the same page.
 * A card holds its own date and heading; a list holds many.
 */
function cardOf($: CheerioAPI, a: Sel, postLinks: string, base: string): Sel {
  const mine = absolute(a.attr("href"), base);
  let card = a;
  for (let up = 0; up < 5; up++) {
    const parent = card.parent() as Sel;
    if (parent.length === 0 || parent.is("body, html")) break;
    const others = new Set(parent.find(postLinks).toArray().map((x) => absolute($(x).attr("href"), base)));
    if (others.size > 1 || (others.size === 1 && !others.has(mine))) break;
    card = parent;
  }
  return card;
}

interface Post {
  title: string;
  url: string;
  card: Sel;
}

/**
 * The posts behind some links: each page once (the first link with a title wins, and a link with a heading beats one without), with its card.
 * `keep` refuses a URL (an index page, a team page, an outside link).
 */
function posts($: CheerioAPI, links: string, base: string, keep: (url: URL) => boolean): Post[] {
  const byUrl = new Map<string, Post & { heading: boolean }>();
  const order: string[] = [];
  $(links).each((_, el) => {
    const a = $(el) as Sel;
    const url = absolute(a.attr("href"), base);
    if (url === null || !keep(new URL(url))) return;
    const title = titleOf(a);
    if (title === "") return;
    const heading = a.find("h1, h2, h3, h4, h5, h6").length > 0;
    const known = byUrl.get(url);
    if (known && (known.heading || !heading)) return;
    if (!known) order.push(url);
    byUrl.set(url, { title, url, card: cardOf($, a, links, base), heading });
  });
  return order.map((u) => byUrl.get(u)!);
}

const slugPath = (prefix: string) => (u: URL): boolean => {
  const rest = u.pathname.startsWith(prefix) ? u.pathname.slice(prefix.length) : "";
  return rest !== "" && !rest.includes("/") || (rest.endsWith("/") && rest.slice(0, -1) !== "" && !rest.slice(0, -1).includes("/"));
};

const toPageItem = (p: Post, day: string | null): PageItem => ({ title: p.title, url: p.url, day, categories: [] });

/** EurekAlert!'s browse page: `article.post` with `a[href^="/news-releases/"]` (not the browse pages themselves), and the date printed as "DD-Mon-YYYY" (§4.13). */
export function parseEurekAlert(html: string, base: string): PageItem[] {
  const $ = load(html);
  const seen = new Set<string>();
  const out: PageItem[] = [];
  $("article.post").each((_, el) => {
    const art = $(el) as Sel;
    const link = art.find('a[href^="/news-releases/"]').toArray().map((x) => $(x) as Sel).find((a) => !(a.attr("href") ?? "").startsWith("/news-releases/browse") && squash(a.text()) !== "");
    const url = link ? absolute(link.attr("href"), base) : null;
    if (!link || url === null || seen.has(url)) return;
    seen.add(url);
    out.push({ title: squash(link.text()), url, day: textDate(spacedText(art)), categories: [] });
  });
  return out;
}

/** The Science Media Centre's home page (its feed's fallback): every `article.article-list-item > header h3 a` and its `time`, in page order (the reader keeps the reaction paths). */
export function parseSmcPage(html: string, base: string): PageItem[] {
  const $ = load(html);
  const out: PageItem[] = [];
  const seen = new Set<string>();
  $("article.article-list-item").each((_, el) => {
    const art = $(el) as Sel;
    const a = art.find("header h3 a").first() as Sel;
    const url = absolute(a.attr("href"), base);
    const title = squash(a.text());
    if (url === null || title === "" || seen.has(url)) return;
    seen.add(url);
    out.push({ title, url, day: timeDay($, art) ?? textDate(spacedText(art)), categories: [] });
  });
  return out;
}

/** Anthropic's research page: `a[href^="/research/"]` (one slug, not the index) with the nearest `time`; the `/news` fallback: `article` with `a[href^="/news/"]`. */
export function parseAnthropic(html: string, base: string, fallback: boolean): PageItem[] {
  const $ = load(html);
  if (!fallback) return posts($, 'a[href^="/research/"]', base, slugPath("/research/")).map((p) => toPageItem(p, timeDay($, p.card)));
  const out: PageItem[] = [];
  const seen = new Set<string>();
  $("article").each((_, el) => {
    const art = $(el) as Sel;
    const a = art.find('a[href^="/news/"]').toArray().map((x) => $(x) as Sel).find((x) => titleOf(x) !== "" && slugPath("/news/")(new URL(absolute(x.attr("href"), base) ?? "https://invalid.invalid/")));
    const url = a ? absolute(a.attr("href"), base) : null;
    if (!a || url === null || seen.has(url)) return;
    seen.add(url);
    out.push({ title: titleOf(a), url, day: timeDay($, art), categories: [] });
  });
  return out;
}

/** Meta's AI blog page: `a[href*="/blog/"]` whose path has a slug, with the date text in its card ("July 9, 2026"). */
export function parseMetaFair(html: string, base: string): PageItem[] {
  const $ = load(html);
  return posts($, 'a[href*="/blog/"]', base, slugPath("/blog/")).map((p) => toPageItem(p, textDate(spacedText(p.card))));
}

/** FutureHouse's research page: `div.card a.u-link-cover[href^="/research/"]`: a link and a title, no date. */
export function parseFutureHouse(html: string, base: string): PageItem[] {
  const $ = load(html);
  const out: PageItem[] = [];
  const seen = new Set<string>();
  $('div.card a.u-link-cover[href^="/research/"]').each((_, el) => {
    const a = $(el) as Sel;
    const url = absolute(a.attr("href"), base);
    if (url === null || !slugPath("/research/")(new URL(url)) || seen.has(url)) return;
    const title = titleOf(a) || titleOf(a.closest("div.card") as Sel);
    if (title === "") return;
    seen.add(url);
    out.push({ title, url, day: null, categories: [] });
  });
  return out;
}

/** Periodic Labs' news page: `a[href^="./news/"]` holding a `time[datetime]`; its links are relative to the page. */
export function parsePeriodic(html: string, base: string): PageItem[] {
  const $ = load(html);
  const out: PageItem[] = [];
  const seen = new Set<string>();
  $('a[href^="./news/"]').each((_, el) => {
    const a = $(el) as Sel;
    const url = absolute(a.attr("href"), base);
    const time = a.find("time[datetime]").first();
    const title = titleOf(a);
    if (url === null || time.length === 0 || title === "" || seen.has(url)) return;
    seen.add(url);
    out.push({ title, url, day: textDate(time.attr("datetime") ?? ""), categories: [] });
  });
  return out;
}

/** Isomorphic Labs' news page: `a.news-card[href^="/articles/"]` and `a.news-featured_title[href^="/articles/"]`: a link and a title, no date. */
export function parseIsomorphic(html: string, base: string): PageItem[] {
  const $ = load(html);
  return posts($, 'a.news-card[href^="/articles/"], a.news-featured_title[href^="/articles/"]', base, () => true).map((p) => toPageItem(p, null));
}

/** Lila Sciences' news page: `div.news-list_item a[href^="/news/"]` and its date text ("November 20, 2026"); links to outside press are left to the primary-source check. */
export function parseLila(html: string, base: string): PageItem[] {
  const $ = load(html);
  const out: PageItem[] = [];
  const seen = new Set<string>();
  $("div.news-list_item").each((_, el) => {
    const item = $(el) as Sel;
    const a = item.find('a[href^="/news/"]').toArray().map((x) => $(x) as Sel).find((x) => titleOf(x) !== "");
    const url = a ? absolute(a.attr("href"), base) : null;
    if (!a || url === null || seen.has(url)) return;
    seen.add(url);
    out.push({ title: titleOf(a), url, day: textDate(spacedText(item)), categories: [] });
  });
  return out;
}

/** The Arc Institute's news page: `article[class*="PostList_postItem"] h3 a[href^="/news/"]` with the article's `time[datetime]`. */
export function parseArc(html: string, base: string): PageItem[] {
  const $ = load(html);
  const out: PageItem[] = [];
  const seen = new Set<string>();
  $('article[class*="PostList_postItem"]').each((_, el) => {
    const art = $(el) as Sel;
    const a = art.find('h3 a[href^="/news/"]').first() as Sel;
    const url = absolute(a.attr("href"), base);
    const title = squash(a.text());
    if (url === null || title === "" || seen.has(url)) return;
    seen.add(url);
    out.push({ title, url, day: timeDay($, art), categories: [] });
  });
  return out;
}

/** The Erdős problems' home page: `ul.thread-list li.thread-item a.thread-title` and the date its item prints ("08 Oct 2026"). */
export function parseErdos(html: string, base: string): PageItem[] {
  const $ = load(html);
  const out: PageItem[] = [];
  const seen = new Set<string>();
  $("ul.thread-list li.thread-item").each((_, el) => {
    const li = $(el) as Sel;
    const a = li.find("a.thread-title").first() as Sel;
    const url = absolute(a.attr("href"), base);
    const title = squash(a.text());
    if (url === null || title === "" || seen.has(url)) return;
    seen.add(url);
    out.push({ title, url, day: textDate(spacedText(li)), categories: [] });
  });
  return out;
}

interface PageSpec {
  parse(html: string, base: string, index: number): PageItem[];
  /** The URLs of the pages after the first (EurekAlert!: the second browse page). */
  more?(url: string): string[];
}

/** The page feeds' readers by registry id. A page feed with no entry here has no reader and the live-shapes test fails (tests/feeds-live-shapes.test.ts). */
export const PAGE_FEEDS: Readonly<Record<string, PageSpec>> = {
  eurekalert: { parse: parseEurekAlert, more: (url) => [`${url}${url.includes("?") ? "&" : "?"}page=2`] },
  "lab-anthropic": { parse: (html, base, i) => parseAnthropic(html, base, i > 0) },
  "lab-meta-fair": { parse: parseMetaFair },
  "lab-futurehouse": { parse: parseFutureHouse },
  "lab-periodic-labs": { parse: parsePeriodic },
  "lab-isomorphic-labs": { parse: parseIsomorphic },
  "lab-lila-sciences": { parse: parseLila },
  "lab-arc-institute": { parse: parseArc },
  erdos: { parse: parseErdos },
};

/**
 * A page feed (SPEC §4.13's selector table): the page, its fallback when it fails or matches nothing, and the pages after the first where the feed has them. A page that matches
 * no item is `schema` (the site changed its markup), never an empty feed. Each item's day is the start of that day in the feed's zone (UTC unless `date_zone` says); an item with no
 * date has none, and an undated item cannot enter the window (§4.13).
 */
export async function readPageFeed(entry: FeedEntry, ctx: FeedCtx): Promise<Read<FeedData>> {
  const spec = Object.hasOwn(PAGE_FEEDS, entry.id) ? PAGE_FEEDS[entry.id] : undefined;
  if (spec === undefined) throw new Error(`No page reader for ${entry.id}`);
  const spend = spendOf(entry);
  const toItems = (items: readonly PageItem[]): FeedItem[] => items.map((p) => feedItem(rawItem({
    title: p.title, url: p.url, published_at: dayStamp(p.day, entry.date_zone), categories: p.categories,
  })));
  const r = await withFallback(ctx, entry, spend, entry.url, (body, res, index) => {
    const items = spec.parse(body.toString("utf8"), res.finalUrl, index);
    if (items.length === 0) throw new FeedParseError("schema", "the page has no item that matches the selector");
    return items;
  }, { expect: "html", body: (body) => cacheWrite(ctx, ctx.paths.feedBody(entry.id, "html"), body) });
  if (!r.ok || !r.data) return { ...r, data: null };
  let items = toItems(r.data);
  const unread: string[] = [];
  if (spec.more && !r.fallbackUsed) {
    for (const url of spec.more(entry.url)) {
      if (!hasBudget(spend)) {
        unread.push(url);
        continue;
      }
      const page = await get(ctx, spend, url);
      let got: PageItem[] | null = null;
      if (page.ok && page.body && wrongType(page, "html") === null) {
        try {
          got = spec.parse(page.body.toString("utf8"), page.finalUrl, 0);
        } catch (e) {
          ctx.log(`${entry.id}: ${url} did not parse: ${(e as Error).message.slice(0, 300)}`);
        }
      }
      if (got === null || got.length === 0) {
        unread.push(url);
        continue;
      }
      r.bytes += page.body!.length;
      r.fetched.push({ url: page.finalUrl, fetched_at: stamp(ctx), sha256: sha256Hex(page.body!) });
      const known = new Set(items.map((i) => i.url));
      items = [...items, ...toItems(got).filter((i) => !known.has(i.url))];
    }
  }
  const note = unread.length > 0 ? `${entry.id}: ${unread.length} more page${unread.length === 1 ? "" : "s"} not read.` : null;
  return { ...r, requests: spend.used, note, data: baseData(items, { unread }) };
}

/**
 * The Science Media Centre (SPEC §4.13): its feed, which mixes post kinds, so only paths that begin `/expert-reaction-to-` or `/experts-react-` on the feed's own host are kept (a link out to another site is not a
 * reaction), each a `reaction`; the fallback is its home page, read as a page. `total` is what the feed or page gave before the path test.
 */
export async function readSmc(entry: FeedEntry, ctx: FeedCtx): Promise<Read<FeedData>> {
  const spend = spendOf(entry);
  const host = new URL(entry.url).hostname;
  const r = await withFallback(ctx, entry, spend, entry.url, async (body, res, index): Promise<{ items: RawItem[]; total: number }> => {
    if (index === 0) {
      const all = (await parseRss(body, entry.date_zone)).entries;
      return { items: webItems(all, res.finalUrl).filter((i) => smcReaction(i.url, host)), total: all.length };
    }
    const all = parseSmcPage(body.toString("utf8"), res.finalUrl);
    if (all.length === 0) throw new FeedParseError("schema", "the page has no item that matches the selector");
    const items = all.filter((p) => smcReaction(p.url, host)).map((p) => rawItem({ title: p.title, url: p.url, published_at: dayStamp(p.day, entry.date_zone) }));
    return { items, total: all.length };
  }, {
    body: (body, _data, index) => cacheWrite(ctx, ctx.paths.feedBody(entry.id, index === 0 ? "xml" : "html"), body),
  });
  if (!r.ok || !r.data) return { ...r, data: null };
  return { ...r, data: baseData(r.data.items.map((i) => cleanItem(i, null, "reaction")), { total: r.data.total }) };
}

// ── The counters' sources (SPEC §5.7) ────────────────────────────────────────────────────────────

/** The NCT ids one `filter.ids` request asks for (§4.13: up to 100, with `pageSize` set to their number). */
export const CTGOV_BATCH = 100;

const NCT_ID = /^NCT\d{8}$/;

/** `studies?filter.ids=<id>,<id>...&pageSize=<n>&fields=NCTId,OverallStatus,Phase`: the commas are written as they are. */
export const ctgovUrl = (url: string, ncts: readonly string[]): string => `${url}?filter.ids=${ncts.join(",")}&pageSize=${ncts.length}&fields=NCTId,OverallStatus,Phase`;

/**
 * The studies of a ClinicalTrials.gov API v2 answer, by NCT id, each as far as the counter reads it (status and phases). A study with no readable NCT
 * id is left out. An answer that has a `nextPageToken` is not the whole list (`pageSize` was set to the number asked for), so it is a `schema` failure.
 */
export function parseCtgov(body: Buffer): Map<string, TrialRecord> {
  const root = jsonObject(body, "ClinicalTrials.gov");
  if (!Array.isArray(root.studies)) throw new FeedParseError("schema", "ClinicalTrials.gov: the answer has no studies list");
  if (typeof root.nextPageToken === "string" && root.nextPageToken !== "") throw new FeedParseError("schema", "ClinicalTrials.gov: the answer is paged, so it is not the whole list");
  const out = new Map<string, TrialRecord>();
  for (const study of root.studies) {
    const section = isObj(study) && isObj(study.protocolSection) ? study.protocolSection : null;
    const id = section && isObj(section.identificationModule) ? asStr(section.identificationModule.nctId) : "";
    if (section === null || !NCT_ID.test(id)) continue;
    const status = isObj(section.statusModule) ? asStr(section.statusModule.overallStatus) : "";
    const phases = isObj(section.designModule) ? asArr(section.designModule.phases).filter((p): p is string => typeof p === "string") : [];
    out.set(id, { protocolSection: { statusModule: status === "" ? {} : { overallStatus: status }, designModule: { phases } } });
  }
  return out;
}

/**
 * The studies of some NCT ids (SPEC §5.7, §8.9): the ids once each in code-unit order, 100 to a request, inside the feed's budget of 10. Each id asked
 * is in the answer: its study, or null for an id the registry has no study for (and for an id that is no NCT id, which is not asked). A batch that fails
 * or lies past the budget leaves its ids out of the answer and fails the read, with the other batches' studies kept in `data` (it is never null here).
 * Each body kept is `cache/feeds/ctgov.p<k>.json`, k in the order of `fetched`.
 */
export async function readCtgov(entry: FeedEntry, ctx: FeedCtx, ncts: readonly string[]): Promise<Read<Map<string, TrialRecord | null>>> {
  const spend = spendOf(entry);
  const t = trace(ctx);
  const lookup = new Map<string, TrialRecord | null>();
  const ids = [...new Set(ncts)].sort(byCodeUnit);
  const asked: string[] = [];
  for (const id of ids) {
    if (NCT_ID.test(id)) asked.push(id);
    else {
      ctx.log(`${entry.id}: ${JSON.stringify(id.slice(0, 40))} is not an NCT id and is not asked`);
      lookup.set(id, null);
    }
  }
  let error: FetchErrorClass | null = null;
  let urlUsed: string | null = null;
  for (const batch of chunk(asked, CTGOV_BATCH)) {
    const url = ctgovUrl(entry.url, batch);
    urlUsed = url;
    const r = await get(ctx, spend, url);
    if (!r.ok || !r.body) {
      error = r.error ?? "network";
      continue;
    }
    try {
      const got = parseCtgov(r.body);
      cacheWrite(ctx, ctx.paths.feedBody(entry.id, `p${t.fetched.length}.json`), r.body);
      t.keep(r, r.body);
      for (const id of batch) lookup.set(id, got.get(id) ?? null);
    } catch (e) {
      ctx.log(`${entry.id}: ${url} did not parse: ${(e as Error).message.slice(0, 300)}`);
      error = parseClass(e);
    }
  }
  if (error !== null) return { ...failedRead<Map<string, TrialRecord | null>>(spend, t, error, urlUsed), data: lookup };
  return finished(spend, t, lookup, { urlUsed });
}

/** The query of RCSB's search API for the entries deposited between two days, both included, as K1d sent it (SPEC §5.7). */
export function rcsbQuery(from: string, to: string): string {
  return JSON.stringify({
    query: { type: "terminal", service: "text", parameters: { attribute: "rcsb_accession_info.deposit_date", operator: "range", value: { from, to, include_lower: true, include_upper: true } } },
    return_type: "entry",
    request_options: { return_counts: true },
  });
}

/** `query?json=<the query, URL-encoded>`: a GET, which `return_counts` answers with a count only. */
export const rcsbCountUrl = (url: string, from: string, to: string): string => `${url}?json=${encodeURIComponent(rcsbQuery(from, to))}`;

/** The `total_count` of a `return_counts` answer: a count, else a `schema` failure. */
export function parseRcsbCount(body: Buffer): number {
  const n = jsonObject(body, "RCSB").total_count;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw new FeedParseError("schema", "RCSB: the answer has no total_count");
  return n;
}

/**
 * The released entries deposited last year and this year so far (SPEC §5.7): one GET each, the year of `asOf` from 1 January to `asOf` and the year before in full,
 * keyed by year (`{"2025": 17052, "2026": 4632}`). Both must answer: one count is no reading. Each body kept is `cache/feeds/rcsb.p<k>.json`, last year's first.
 */
export async function readRcsbCounts(entry: FeedEntry, ctx: FeedCtx, asOf: string): Promise<Read<Record<string, number>>> {
  const spend = spendOf(entry);
  const t = trace(ctx);
  const year = Number(asOf.slice(0, 4));
  const ranges = [[year - 1, `${year - 1}-01-01`, `${year - 1}-12-31`], [year, `${year}-01-01`, asOf]] as const;
  const out: Record<string, number> = {};
  let urlUsed: string | null = null;
  for (const [y, from, to] of ranges) {
    const url = rcsbCountUrl(entry.url, from, to);
    urlUsed = url;
    const r = await get(ctx, spend, url);
    if (!r.ok || !r.body) return failedRead(spend, t, r.error ?? "network", url);
    try {
      out[String(y)] = parseRcsbCount(r.body);
    } catch (e) {
      ctx.log(`${entry.id}: ${url} did not parse: ${(e as Error).message.slice(0, 300)}`);
      return failedRead(spend, t, parseClass(e), url);
    }
    cacheWrite(ctx, ctx.paths.feedBody(entry.id, `p${t.fetched.length}.json`), r.body);
    t.keep(r, r.body);
  }
  return finished(spend, t, out, { urlUsed });
}

/** The most an RCSB holdings file may unzip to: 64 MiB, four times its size on 2026-11-28 (SPEC §4.13 "Body caps and timeouts"). */
export const UNZIPPED_CAP = 64 * 1024 * 1024;

/**
 * The text of a holdings body: unzipped when it starts with the gzip magic bytes, with the unzipped size capped, else read as it is (a server that
 * unzips in transit sends plain JSON). Over the cap is `too_large`, a gzip that does not unzip is `parse`.
 */
export function holdingsText(body: Buffer, cap: number = UNZIPPED_CAP): string {
  if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) {
    try {
      return zlib.gunzipSync(body, { maxOutputLength: cap }).toString("utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") throw new ReadFail("too_large", `RCSB holdings: the file unzips to more than ${cap} bytes`);
      throw new FeedParseError("parse", `RCSB holdings: the gzip does not unzip (${(e as Error).message.slice(0, 120)})`);
    }
  }
  if (body.length > cap) throw new ReadFail("too_large", `RCSB holdings: the file is over ${cap} bytes`);
  return body.toString("utf8");
}

/**
 * RCSB's holdings file of unreleased entries: a JSON object keyed by PDB id, each entry with a `status_code` and a `deposit_date`. Every entry is returned, withdrawn ones
 * included (the counter leaves them out). An entry that is no object is a `schema` failure, and a file with no entry is `empty`: a record read wrongly is not counted around.
 */
export function parseRcsbUnreleased(body: Buffer, cap: number = UNZIPPED_CAP): UnreleasedEntry[] {
  let root: unknown;
  try {
    root = JSON.parse(holdingsText(body, cap));
  } catch (e) {
    if (e instanceof FeedParseError || e instanceof ReadFail) throw e;
    throw new FeedParseError("parse", "RCSB holdings: the file is not JSON");
  }
  if (!isObj(root)) throw new FeedParseError("schema", "RCSB holdings: the file is not a JSON object");
  const out: UnreleasedEntry[] = [];
  for (const rec of Object.values(root)) {
    if (!isObj(rec)) throw new FeedParseError("schema", "RCSB holdings: an entry is not an object");
    out.push({ deposit_date: asStr(rec.deposit_date), status: asStr(rec.status_code) });
  }
  if (out.length === 0) throw new FeedParseError("empty", "RCSB holdings: the file has no entry");
  return out;
}

/** RCSB's unreleased entries (SPEC §5.7): the holdings file in one GET, kept as received (gzip) in `cache/feeds/rcsb-unreleased.json.gz`. */
export async function readRcsbUnreleased(entry: FeedEntry, ctx: FeedCtx): Promise<Read<UnreleasedEntry[]>> {
  const spend = spendOf(entry);
  return withFallback(ctx, entry, spend, entry.url, (body) => parseRcsbUnreleased(body), {
    body: (body) => cacheWrite(ctx, ctx.paths.feedBody(entry.id, "json.gz"), body),
  });
}

/** What `readPdbStructures()` gives: each feed's read, and the counter's data when both read. */
export interface PdbRead {
  counts: Read<Record<string, number>>;
  unreleased: Read<UnreleasedEntry[]>;
  data: PdbData | null;
}

/** `pdb_structures`' two reads (SPEC §5.7): the search API's counts, then the holdings file. The data is there only when both read. */
export async function readPdbStructures(rcsb: FeedEntry, unreleased: FeedEntry, ctx: FeedCtx, asOf: string): Promise<PdbRead> {
  const counts = await readRcsbCounts(rcsb, ctx, asOf);
  const holdings = await readRcsbUnreleased(unreleased, ctx);
  return { counts, unreleased: holdings, data: counts.data !== null && holdings.data !== null ? { released: counts.data, unreleased: holdings.data } : null };
}

/** What the Retraction Watch read gives. */
export interface RetractionData {
  /** Every row of the file, read, in file order, except those dated after the run date. */
  rows: RetractionRow[];
  /** Rows dated after the run date, left out (the file holds one dated 2027). */
  future: number;
  /** The rows the file holds. */
  total: number;
  /** The latest `RetractionDate` of the rows kept, a day, or null when none is dated. */
  newest: string | null;
}

/**
 * The Retraction Watch file (§4.13, §5.7): the five columns the counter and the rung watch read, each row through `parseRetractionRow()`, rows dated after `asOf`
 * left out and counted. A header with a trailing comma is read as `parseCsv()` reads it. A file with no row is `empty`.
 */
export function parseRetractionWatch(body: Buffer, asOf: string): RetractionData {
  const table = parseCsv(body, { columns: RETRACTION_COLUMNS });
  const rows: RetractionRow[] = [];
  let future = 0;
  let newest: string | null = null;
  for (const record of table.rows) {
    const row = parseRetractionRow(record);
    if (row.retraction_date !== null && row.retraction_date > asOf) {
      future += 1;
      continue;
    }
    if (row.retraction_date !== null && (newest === null || row.retraction_date > newest)) newest = row.retraction_date;
    rows.push(row);
  }
  if (table.rows.length === 0) throw new FeedParseError("empty", "Retraction Watch: the file has no row");
  return { rows, future, total: table.rows.length, newest };
}

/** The Retraction Watch file: one GET with the feed's own cap and timeout, kept whole as `cache/feeds/retraction-watch.csv` (SPEC §4.13). */
export async function readRetractionWatch(entry: FeedEntry, ctx: FeedCtx, asOf: string): Promise<Read<RetractionData>> {
  const spend = spendOf(entry);
  const r = await withFallback(ctx, entry, spend, entry.url, (body) => parseRetractionWatch(body, asOf), {
    limit: "retractionWatch", max: "retractionWatch",
    body: (body) => cacheWrite(ctx, ctx.paths.feedBody(entry.id, "csv"), body),
  });
  if (r.data && r.data.future > 0) ctx.log(`${entry.id}: ${r.data.future} row${r.data.future === 1 ? " is" : "s are"} dated after ${asOf} and left out`);
  return r;
}

/** An integer written with or without thousands commas. */
function countText(text: string): number | null {
  const s = squash(text);
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(s)) return null;
  const n = Number(s.replaceAll(",", ""));
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * mathlib's statistics page (SPEC §5.7): the first `table.table-borderless`, its second row and second cell, which the header row names Theorems. A page whose
 * table, row, cell or header is not there, or whose cell is no count, is a `schema` failure, so a page that changed is never read as another number.
 */
export function parseMathlibStats(html: string): number {
  const $ = load(html);
  const table = $("table.table-borderless").first();
  if (table.length === 0) throw new FeedParseError("schema", "mathlib: the page has no table.table-borderless");
  const rows = table.find("tr");
  const cell = (row: number): string => squash(rows.eq(row).children("th, td").eq(1).text());
  if (rows.length < 2 || cell(1) === "") throw new FeedParseError("schema", "mathlib: the table has no second cell in its second row");
  if (!/theorem/i.test(cell(0))) throw new FeedParseError("schema", "mathlib: the second column is not headed Theorems");
  const n = countText(cell(1));
  if (n === null) throw new FeedParseError("schema", "mathlib: the Theorems cell is no count");
  return n;
}

/** mathlib's theorem count: its statistics page in one GET, kept as `cache/feeds/mathlib-stats.html`. */
export async function readMathlib(entry: FeedEntry, ctx: FeedCtx): Promise<Read<number>> {
  const spend = spendOf(entry);
  return withFallback(ctx, entry, spend, entry.url, (body) => parseMathlibStats(body.toString("utf8")), {
    expect: "html", body: (body) => cacheWrite(ctx, ctx.paths.feedBody(entry.id, "html"), body),
  });
}

// ── Which reader a feed has ──────────────────────────────────────────────────────────────────────

/** The reader of a registry feed (`readerKind()`): `none` for `parser: none` (a feed that is never read), the others as named. */
export type ReaderKind =
  | "arxiv" | "biorxiv" | "pubmed" | "crossref-journals" | "rss" | "smc" | "page"
  | "crossref-updates" | "ctgov" | "rcsb" | "rcsb-unreleased" | "retraction-watch" | "mathlib" | "openalex" | "none";

/** The kinds that give candidates (`readFeed()` reads them); the others are data feeds read by their own function, or never. */
const CANDIDATE_READERS: ReadonlySet<ReaderKind> = new Set(["arxiv", "biorxiv", "pubmed", "crossref-journals", "rss", "smc", "page"]);

/**
 * The reader a registry feed has, or null when it has none: a feed added to `config/sources.yaml` with no reader fails
 * `tests/feeds-live-shapes.test.ts`. A feed with `parser: rss` is read as RSS or Atom whatever its id; an `html` page feed needs an entry of `PAGE_FEEDS`.
 */
export function readerKind(entry: Pick<FeedEntry, "id" | "parser">): ReaderKind | null {
  if (entry.parser === "none") return "none";
  if (entry.id.startsWith("arxiv-")) return Object.hasOwn(ARXIV_QUERIES, entry.id) && entry.parser === "atom" ? "arxiv" : null;
  switch (entry.id) {
    case "biorxiv":
    case "medrxiv": return entry.parser === "json" ? "biorxiv" : null;
    case "pubmed": return entry.parser === "json" ? "pubmed" : null;
    case "crossref-journals": return entry.parser === "json" ? "crossref-journals" : null;
    case "crossref-updates": return entry.parser === "json" ? "crossref-updates" : null;
    case "openalex": return entry.parser === "json" ? "openalex" : null;
    case "ctgov": return entry.parser === "json" ? "ctgov" : null;
    case "rcsb": return entry.parser === "json" ? "rcsb" : null;
    case "rcsb-unreleased": return entry.parser === "json" ? "rcsb-unreleased" : null;
    case "retraction-watch": return entry.parser === "csv" ? "retraction-watch" : null;
    case "mathlib-stats": return entry.parser === "html" ? "mathlib" : null;
    case "smc-reactions": return entry.parser === "rss" ? "smc" : null;
    default:
  }
  if (entry.parser === "rss") return "rss";
  if (entry.parser === "html" && Object.hasOwn(PAGE_FEEDS, entry.id)) return "page";
  return null;
}

/** True for a feed whose items are candidates, which `readFeed()` reads (the others are counters', the watch's and the Pace's sources, or none). */
export const isCandidateFeed = (entry: Pick<FeedEntry, "id" | "parser">): boolean => {
  const kind = readerKind(entry);
  return kind !== null && CANDIDATE_READERS.has(kind);
};

/**
 * Reads one candidate feed by its reader (SPEC §8.3 stage 2). It throws for a feed that gives no candidates (a counter's source, OpenAlex, `parser: none`) and for a
 * feed with no reader: those are calls that should never be made, not feed failures.
 */
export async function readFeed(entry: FeedEntry, ctx: FeedCtx, run: FeedRun): Promise<Read<FeedData>> {
  switch (readerKind(entry)) {
    case "arxiv": return readArxiv(entry, ctx, run);
    case "biorxiv": return readBiorxiv(entry, ctx, run);
    case "pubmed": return readPubmed(entry, ctx, run);
    case "crossref-journals": return readCrossrefJournals(entry, ctx, run);
    case "rss": return readRssFeed(entry, ctx);
    case "smc": return readSmc(entry, ctx);
    case "page": return readPageFeed(entry, ctx);
    default: throw new Error(`readFeed: ${entry.id} is not a candidate feed`);
  }
}

/**
 * What `sources:check` and the live-shape check ask of a feed that gives no candidates (SPEC §8.10): one small read of its own kind. Null when there is nothing to ask:
 * `parser: none`, OpenAlex (its client reads it), and a feed whose read needs ids the run did not give (`run.probe`). The counters ask for the date of `run.date`.
 */
export async function probeDataFeed(entry: FeedEntry, ctx: FeedCtx, run: FeedRun): Promise<Read<unknown> | null> {
  switch (readerKind(entry)) {
    case "crossref-updates": return run.probe?.dois?.length ? readCrossrefUpdates(entry, ctx, run.probe.dois.slice(0, CROSSREF_UPDATES_BATCH)) : null;
    case "ctgov": return run.probe?.ncts?.length ? readCtgov(entry, ctx, run.probe.ncts.slice(0, CTGOV_BATCH)) : null;
    case "rcsb": return readRcsbCounts(entry, ctx, run.date);
    case "rcsb-unreleased": return readRcsbUnreleased(entry, ctx);
    case "retraction-watch": return readRetractionWatch(entry, ctx, run.date);
    case "mathlib": return readMathlib(entry, ctx);
    default: return null;
  }
}
