// The OpenAlex client (SPEC §5.1, §5.4, §8.3, §8.4, §9.6): the weekly group-by requests of the Pace, the answer cache under
// cache/openalex/, the DOI lookup that collect makes for its candidates' topics, the sampler that P2's precision and recall
// samples draw with, and the optional API key. Every request goes through `fetchFeed()` (lib/feeds/http.ts), which holds the
// per-host queue of one request a second for api.openalex.org, the timeouts, the body cap and the run's user agent; this file
// paces nothing itself, sends no `mailto` and no other personal data.
//
// What is here, by SPEC sentence:
// - Request builders (§5.1): the four group-by requests of an ISO week, `leading_total`, `leading_ai`, `all_total`, `all_ai`,
//   each `works?filter=<f>&group_by=primary_topic.field.id`, with the search terms quoted, joined with ` OR ` and URL-encoded.
// - The field mapping (§5.1): a group's key, an OpenAlex field id, maps to one of our fields through `fields.json`; excluded
//   and unmapped keys are dropped and their works counted for the inputs manifest (`excluded_n`, `unmapped_n`).
// - The answer cache (§5.4, §0.4 row 76): every answer is kept for good in `cache/openalex/<Monday>/<request>.<fetch date>.<hash>.json`
//   with its request URL (any key removed), the Taipei fetch time and the SHA-256 of the body as received. A cached answer is
//   reused only when it was fetched on the run's own Taipei date or, without `refresh`, on or after the week's last morning
//   (64 days after its Sunday, 7 x provisional_weeks + 8), and refetched otherwise; a reused answer is never rewritten, so a
//   rerun is byte-identical.
// - The key (§5.1, §9.6): when the keychain holds `unveiling-openalex-key` the caller reads it (`readOpenAlexKey()`) and passes it
//   in; the client adds `api_key=` on the wire only. The key is never in a recorded URL, a cache file, an error or a log line.
// - The budget (standing facts from the Kobol batch K1a, docs/reports/p2-kobol/K1a-openalex.md): OpenAlex charges credits (a
//   filter or list group_by 1, a request that holds a search 10) against a daily budget that resets at 00:00 UTC; a keyless
//   client has 1,000 credits a day and a key's first $1 is throttled. The client tallies the credits of each answered request
//   and turns an out-of-budget answer into `OpenAlexBudgetError`, whose message says when the budget resets, so a caller can stop
//   instead of retrying. The Pace backfill needs more credits than one day's budget (2,476 requests, half of them searches), so
//   it spans two days of budget: the answers cached before the refusal are kept, and the run after the reset fetches the rest.
// - The DOI lookup (§8.3): `works?filter=doi:<a>|<b>|...` with `per-page=100` and `select=doi,primary_topic`, at most 100 DOIs
//   to a request, oldest candidate first, at most the request cap the caller passes (12), the answers never cached.
// - The sampler (§10 P2 step 2): a draw from OpenAlex's own `sample` and `seed` parameters, and the fallback the spec names
//   (page through the matching works, compare ids, draw with the seed), both returning the same shape.
//
// Only the group-by answers are cached. fetchFeed() keeps neither the headers nor the body of a non-2xx answer, so an
// out-of-budget answer is told by its status alone (402, or 429) and no rate-limit or credit header is recorded; a page is 100
// works at most (200 is deprecated), and paging by cursor past the first page needs a key (the sampler's fallback path).
// New for this project; Cyber has no OpenAlex client. The cache's write-then-rename and its refusal of a damaged file follow the
// idiom of Cyber's scripts/lib/feed-cache.ts at the fork commit 3ced1fb.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ConfigIndex } from "../../lib/config";
import { addDays, isValidDate, taipeiDateOf, taipeiTimestamp, taipeiToday, weekday } from "../../lib/dates";
import { FEED_MAX_BYTES, FEED_TIMEOUTS, fetchFeed, type FetchOptions, type FetchResult } from "../../lib/feeds/http";
import { byCodeUnit } from "../../lib/ids";
import { jsonText, sha256Hex } from "../../lib/json";
import { cutText, sanitize } from "../../lib/sanitize";
import { IsoTimestamp, Sha256, type IsoDate } from "../../lib/schema/common";
import { OPENALEX_REQUESTS, OpenAlexRequest, PaceWeek, type OpenAlexRequestKind } from "../../lib/schema/metrics";
import { normalizeDoi, doiUrl } from "../../lib/urls";
import { FIELDS, type FieldId } from "../../lib/vocab";
import { readSecret } from "./keychain";

// ── Constants ────────────────────────────────────────────────────────────────────────────────────

export const OPENALEX_ORIGIN = "https://api.openalex.org";
/** The keychain item JL creates only if OpenAlex needs a key (SPEC §9.6). Not a secret: the name only. */
export const OPENALEX_KEY_SERVICE = "unveiling-openalex-key";
/** What an out-of-budget error tells a caller about the reset. */
export const BUDGET_RESET = "resets at 00:00 UTC (08:00 Taipei)";
/** Credits a request costs: one for a filter or a list group_by, ten for any request that holds a search. */
export const CREDITS = { plain: 1, search: 10 } as const;
/** `|` joins at most this many values in a filter (§5.1's Verify in P2; §8.3 for DOIs). */
export const FILTER_VALUES_MAX = 100;
/** The most one sample request or one page of works asks for: OpenAlex's supported maximum (200 still works but is deprecated, K1a). */
export const PER_PAGE_MAX = 100;
/** The seed OpenAlex accepts is a 32-bit signed integer. */
export const SEED_MAX = 2_147_483_647;
/** The fields a sampled work is read for. */
export const SAMPLE_SELECT = "id,doi,title,publication_date,abstract_inverted_index";

/** The order a week's four requests are fetched in: the AI-method count first, so that its total, fetched a moment later, can only be at least as large. */
const FETCH_ORDER: readonly OpenAlexRequestKind[] = ["leading_ai", "leading_total", "all_ai", "all_total"];

// ── Errors ───────────────────────────────────────────────────────────────────────────────────────

/** budget: out of credits (stop, do not retry); http: another HTTP status; network: no answer; answer: a body that is not a usable answer. */
export type OpenAlexErrorKind = "budget" | "http" | "network" | "answer";

/** A failed OpenAlex request. `url` is the request as recorded, never with a key; the message holds no key either. */
export class OpenAlexError extends Error {
  readonly kind: OpenAlexErrorKind;
  readonly url: string;
  readonly status: number | null;
  constructor(kind: OpenAlexErrorKind, message: string, url: string, status: number | null = null) {
    super(message);
    this.name = "OpenAlexError";
    this.kind = kind;
    this.url = url;
    this.status = status;
  }
}

/**
 * OpenAlex refused a request because the credit budget is spent (HTTP 402, or 429). The budget resets at 00:00 UTC, 08:00 Taipei.
 * The harness keeps neither the headers nor the body of a refusal, so the daily budget and the throttle on a new key's first
 * dollar (about $0.10 every 5 minutes, K1b) look the same; the message names both.
 */
export class OpenAlexBudgetError extends OpenAlexError {
  constructor(url: string, status: number) {
    super(
      "budget",
      `OpenAlex refused the request (HTTP ${status}): its credit budget is spent and ${BUDGET_RESET} (a new key's first $1 is released $0.10 every 5 minutes, so a short wait may be enough). Run again after that; the answers already cached are reused.`,
      url,
      status,
    );
    this.name = "OpenAlexBudgetError";
  }
}

// ── The query: journals, phrases and the field map ───────────────────────────────────────────────

/** A phrase is words of letters and digits joined by single spaces or hyphens (§4.11), so it is safe inside quotes and a filter. */
const PHRASE_RE = /^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u;
const SOURCE_RE = /^S\d+$/;

/** What the Pace asks OpenAlex, from the config (§5.1). */
export interface PaceQuery {
  /** `openalex_source` of the journals with `in_pace` true, in file order. */
  readonly sources: readonly string[];
  /** The phrases with `in_pace` true, in file order. */
  readonly phrases: readonly string[];
  /** An OpenAlex field id to our field, or to null for an excluded one; an id in neither is unmapped. */
  readonly fields: ReadonlyMap<number, FieldId | null>;
}

function assertPhrases(phrases: readonly string[]): void {
  for (const p of phrases) {
    if (!PHRASE_RE.test(p)) throw new RangeError(`A search phrase is words of letters and digits joined by single spaces or hyphens, got ${JSON.stringify(p)}`);
  }
}

/** The query of `config.index` (`loadConfig()`): the in_pace journals and phrases and the field map. Throws when none is left or a list is over the 100-value limit. */
export function paceQuery(index: Pick<ConfigIndex, "paceJournals" | "pacePhrases" | "openalexFields">): PaceQuery {
  const sources = index.paceJournals.map((j) => j.openalex_source);
  const phrases = [...index.pacePhrases];
  if (sources.length === 0) throw new RangeError("No journal has in_pace true: the Pace has nothing to count");
  if (sources.length > FILTER_VALUES_MAX) throw new RangeError(`The journal list holds at most ${FILTER_VALUES_MAX} values in one filter, got ${sources.length}`);
  if (phrases.length === 0) throw new RangeError("No AI phrase has in_pace true: the Pace has nothing to match");
  for (const s of sources) if (!SOURCE_RE.test(s)) throw new RangeError(`An OpenAlex source id looks like S137773608, got ${JSON.stringify(s)}`);
  assertPhrases(phrases);
  return { sources, phrases, fields: new Map(index.openalexFields) };
}

const quoted = (phrases: readonly string[]): string => phrases.map((p) => `"${p}"`).join(" OR ");

/**
 * A search expression: the phrases each in double quotes joined with ` OR ` (§5.1). With `exclude` it is
 * `("a" OR "b") NOT ("c" OR "d")`, the phrases that may match and the ones that must not (the form that finds a phrase
 * alone, §10 P2 step 2); with only `exclude`, `NOT ("c" OR "d")`. Not URL-encoded.
 */
export function searchExpression(include: readonly string[], exclude: readonly string[] = []): string {
  assertPhrases(include);
  assertPhrases(exclude);
  if (include.length === 0 && exclude.length === 0) throw new RangeError("A search expression needs a phrase");
  if (exclude.length === 0) return quoted(include);
  if (include.length === 0) return `NOT (${quoted(exclude)})`;
  return `(${quoted(include)}) NOT (${quoted(exclude)})`;
}

/** `title_and_abstract.search:<expression>`, the expression URL-encoded (§5.1: `<terms>` is URL-encoded). */
export function searchFilter(expression: string): string {
  return `title_and_abstract.search:${encodeURIComponent(expression)}`;
}

function assertProvisionalWeeks(weeks: number): void {
  if (!Number.isInteger(weeks) || weeks < 1) throw new RangeError(`provisional_weeks is a positive whole number, got ${weeks}`);
}

function assertMonday(weekStart: string): void {
  if (!isValidDate(weekStart) || weekday(weekStart) !== 1) throw new RangeError(`A week is named by its Monday, got ${weekStart}`);
}

/** A filter joins 1 to 100 journals with `|` (§5.1's 100-value limit). */
function assertSources(sources: readonly string[]): void {
  if (sources.length === 0 || sources.length > FILTER_VALUES_MAX) throw new RangeError(`A filter joins 1 to ${FILTER_VALUES_MAX} journals, got ${sources.length}`);
}

/** The Sunday of the ISO week that starts on `weekStart`. */
export const weekEnd = (weekStart: IsoDate): IsoDate => addDays(weekStart, 6);

/**
 * The filter `<f>` of one request (§5.1): the week's bounds, `type:article` and `has_abstract:true` (the numerator and the
 * denominator alike), for the journals' kinds `primary_location.source.id:<journals joined by |>`, for the AI kinds
 * `title_and_abstract.search:<terms>`.
 */
export function paceFilter(kind: OpenAlexRequestKind, weekStart: IsoDate, query: Pick<PaceQuery, "sources" | "phrases">): string {
  assertMonday(weekStart);
  if (!OPENALEX_REQUESTS.includes(kind)) throw new RangeError(`Not a request kind: ${String(kind)}`);
  const parts = [`from_publication_date:${weekStart}`, `to_publication_date:${weekEnd(weekStart)}`, "type:article", "has_abstract:true"];
  if (kind.startsWith("leading")) {
    assertSources(query.sources);
    parts.push(`primary_location.source.id:${query.sources.join("|")}`);
  }
  if (kind.endsWith("_ai")) parts.push(searchFilter(searchExpression(query.phrases)));
  return parts.join(",");
}

/** `https://api.openalex.org/works?filter=<f>&group_by=primary_topic.field.id` (§5.1), without any key. */
export const groupByUrl = (filter: string): string => `${OPENALEX_ORIGIN}/works?filter=${filter}&group_by=primary_topic.field.id`;

export interface WeekRequest {
  request: OpenAlexRequestKind;
  week_start: IsoDate;
  url: string;
}

/** The four requests of a week in the order of §5.1's table. */
export function weekRequests(weekStart: IsoDate, query: Pick<PaceQuery, "sources" | "phrases">): WeekRequest[] {
  return OPENALEX_REQUESTS.map((request) => ({ request, week_start: weekStart, url: groupByUrl(paceFilter(request, weekStart, query)) }));
}

/** The credits a request costs: 10 when its filter, its `search` or its group_by holds a search, else 1 (standing facts from K1a). */
export function requestCredits(url: string): number {
  const params = new URL(url).searchParams;
  const search = /\.search:/.test(params.get("filter") ?? "") || params.has("search") || /\.search$/.test(params.get("group_by") ?? "");
  return search ? CREDITS.search : CREDITS.plain;
}

// ── Reading an answer ────────────────────────────────────────────────────────────────────────────

/** OpenAlex's answer to a group-by: the total of works the filter matches and the groups. It may carry more; only these are read. */
const GroupByBody = z.looseObject({
  meta: z.looseObject({ count: z.int().min(0).optional() }).optional(),
  group_by: z.array(z.looseObject({ key: z.union([z.string(), z.number()]), count: z.int().min(0) })),
});

export interface Group {
  key: string;
  count: number;
}

/** The works the filter matches (`meta.count`, null when the answer has none) and each group. Throws `OpenAlexError` of kind "answer" on anything else. */
export function parseGroupBy(text: string, url: string = OPENALEX_ORIGIN): { total: number | null; groups: Group[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new OpenAlexError("answer", "OpenAlex's answer is not JSON", url);
  }
  const parsed = GroupByBody.safeParse(raw);
  if (!parsed.success) throw new OpenAlexError("answer", "OpenAlex's answer has no usable group_by list", url);
  return { total: parsed.data.meta?.count ?? null, groups: parsed.data.group_by.map((g) => ({ key: String(g.key), count: g.count })) };
}

/** `https://openalex.org/fields/17`, `fields/17` or `17`: the number, or null for any other key (a subfield, a domain, `unknown`). */
const FIELD_KEY_RE = /^(?:(?:https?:\/\/)?openalex\.org\/)?(?:fields\/)?(\d+)$/i;

export function openalexFieldNumber(key: string): number | null {
  const m = FIELD_KEY_RE.exec(key.trim());
  return m ? Number(m[1]) : null;
}

export interface FieldCounts {
  /** Works for each of our fields (every field present, 0 when no group maps to it). */
  counts: Record<FieldId, number>;
  /** Works in groups that fields.json excludes. */
  excluded_n: number;
  /** Works in groups that fields.json does not list. */
  unmapped_n: number;
}

/** Maps each group to one of our fields through `fields.json` (§5.1); several OpenAlex fields of one field are added up, excluded and unmapped groups are dropped and counted. */
export function mapGroups(groups: readonly Group[], fields: ReadonlyMap<number, FieldId | null>): FieldCounts {
  const counts = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<FieldId, number>;
  let excluded = 0;
  let unmapped = 0;
  for (const g of groups) {
    const id = openalexFieldNumber(g.key);
    const field = id === null ? undefined : fields.get(id);
    if (field === undefined) unmapped += g.count;
    else if (field === null) excluded += g.count;
    else counts[field] += g.count;
  }
  return { counts, excluded_n: excluded, unmapped_n: unmapped };
}

// ── The answer cache ─────────────────────────────────────────────────────────────────────────────

/** A request URL as it is recorded: no key and no e-mail address (SPEC §5.1, §4.7). */
const RecordedUrl = z.string().refine((u) => !/[?&](?:api_key|mailto)=/i.test(u), { error: "A recorded URL holds no key and no e-mail address" });

/** One cached answer: the request URL without any key, when it was fetched, and the body exactly as received with its SHA-256. */
const AnswerFile = z.strictObject({
  schema_version: z.literal(1),
  url: RecordedUrl,
  fetched_at: IsoTimestamp,
  sha256: Sha256,
  body: z.string(),
});

interface StoredAnswer {
  url: string;
  fetched_at: string;
  /** The Taipei date of `fetched_at`. */
  fetched: IsoDate;
  sha256: string;
  body: string;
}

const urlHash = (url: string): string => sha256Hex(url).slice(0, 10);

/** `<cacheDir>/<Monday>/<request>.<Taipei fetch date>.<first 10 hex of the URL's SHA-256>.json` */
export function answerPath(cacheDir: string, kind: OpenAlexRequestKind, weekStart: IsoDate, fetched: IsoDate, url: string): string {
  assertMonday(weekStart);
  if (!OPENALEX_REQUESTS.includes(kind)) throw new RangeError(`Not a request kind: ${String(kind)}`);
  if (!isValidDate(fetched)) throw new RangeError(`Not a date: ${fetched}`);
  return path.join(cacheDir, weekStart, `${kind}.${fetched}.${urlHash(url)}.json`);
}

/**
 * The cached answers for a request URL, newest fetch date first. A file that is damaged (not JSON, a wrong shape, another URL, a
 * body that is not the SHA-256 it records, a name that disagrees with its fetch time) or whose body is no usable answer is left
 * out as if it were absent.
 */
function storedAnswers(cacheDir: string, kind: OpenAlexRequestKind, weekStart: IsoDate, url: string): StoredAnswer[] {
  // `readCachedAnswer` is handed a manifest's week: only a calendar date names a folder under the cache, never a path.
  if (!isValidDate(weekStart)) return [];
  const dir = path.join(cacheDir, weekStart);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const hash = urlHash(url);
  const out: StoredAnswer[] = [];
  for (const name of names.sort(byCodeUnit).reverse()) {
    const m = /^([a-z_]+)\.(\d{4}-\d{2}-\d{2})\.([0-9a-f]{10})\.json$/.exec(name);
    if (!m || m[1] !== kind || m[3] !== hash) continue;
    try {
      const file = AnswerFile.parse(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
      if (file.url !== url || sha256Hex(file.body) !== file.sha256 || taipeiDateOf(file.fetched_at) !== m[2]) continue;
      parseGroupBy(file.body, url);
      out.push({ url: file.url, fetched_at: file.fetched_at, fetched: m[2]!, sha256: file.sha256, body: file.body });
    } catch {
      // A damaged file is as good as none.
    }
  }
  return out;
}

function writeAnswer(cacheDir: string, kind: OpenAlexRequestKind, weekStart: IsoDate, stored: StoredAnswer): void {
  const file = answerPath(cacheDir, kind, weekStart, stored.fetched, stored.url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, jsonText({ schema_version: 1, url: stored.url, fetched_at: stored.fetched_at, sha256: stored.sha256, body: stored.body }, AnswerFile));
    fs.renameSync(tmp, file);
  } catch (e) {
    // A write that fails leaves no half-written file behind, under the answer's name or another.
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * A week's last morning (§5.4): the last morning that refetches it as the newest firm week, 64 days after its Sunday
 * (7 x `provisional_weeks` + 8; the newest firm week is the one that ends 7 x `provisional_weeks` days before the data cutoff, and
 * the cutoff is the newest Sunday on or before D minus 2).
 */
export function lastMorning(weekStart: IsoDate, provisionalWeeks: number): IsoDate {
  assertMonday(weekStart);
  assertProvisionalWeeks(provisionalWeeks);
  return addDays(weekEnd(weekStart), 7 * provisionalWeeks + 8);
}

/**
 * Whether an answer fetched on `fetched` may be reused (§5.4): it was fetched on the run's own Taipei date `today`, or, without
 * `refresh`, on or after the week's last morning. Any other is refetched, so a catch-up never freezes a provisional count and a
 * rerun on the same date reuses everything.
 */
export function reusable(fetched: IsoDate, o: { weekStart: IsoDate; today: IsoDate; provisionalWeeks: number; refresh: boolean }): boolean {
  if (fetched === o.today) return true;
  return !o.refresh && fetched >= lastMorning(o.weekStart, o.provisionalWeeks);
}

// ── Answers ──────────────────────────────────────────────────────────────────────────────────────

/** One group-by answer of a week, with what it says for each of our fields. */
export interface GroupByAnswer {
  request: OpenAlexRequestKind;
  week_start: IsoDate;
  /** The request URL as made, without any key. */
  url: string;
  fetched_at: string;
  /** The Taipei date of `fetched_at`. */
  fetched: IsoDate;
  /** SHA-256 of the response body as received. */
  sha256: string;
  /** The works the filter matches (`meta.count`), to check that the groups add up to it; null when the answer has none. */
  total: number | null;
  /** Works that `total` counts and no group does: the works with no primary topic, when `total` is the ungrouped count (K1a, item 8); null when there is no total. The manifest has no place for it (a spec issue). */
  ungrouped_n: number | null;
  groups: Group[];
  counts: Record<FieldId, number>;
  excluded_n: number;
  unmapped_n: number;
  /** True when this run read it from the cache. */
  cached: boolean;
}

function answerOf(stored: StoredAnswer, request: OpenAlexRequestKind, weekStart: IsoDate, fields: ReadonlyMap<number, FieldId | null>, cached: boolean): GroupByAnswer {
  const { total, groups } = parseGroupBy(stored.body, stored.url);
  return {
    request, week_start: weekStart, url: stored.url, fetched_at: stored.fetched_at, fetched: stored.fetched, sha256: stored.sha256,
    total, ungrouped_n: total === null ? null : Math.max(0, total - groups.reduce((sum, g) => sum + g.count, 0)), groups,
    ...mapGroups(groups, fields), cached,
  };
}

/** The answer to `ref` from the cache: the one whose body has `ref.sha256` when it is given (what `--recompute` asks for, from a manifest), else the newest. Null when there is none. */
export function readCachedAnswer(
  cacheDir: string,
  fields: ReadonlyMap<number, FieldId | null>,
  ref: { request: OpenAlexRequestKind; week_start: IsoDate; url: string; sha256?: string },
): GroupByAnswer | null {
  const found = storedAnswers(cacheDir, ref.request, ref.week_start, ref.url).find((s) => ref.sha256 === undefined || s.sha256 === ref.sha256);
  return found ? answerOf(found, ref.request, ref.week_start, fields, true) : null;
}

/** The manifest record of an answer (`content/metrics/inputs/D.json`, §4.7): its URL without any key, when, the SHA-256 and the counts used. */
export function inputsRecord(a: GroupByAnswer): OpenAlexRequest {
  return OpenAlexRequest.parse({
    request: a.request, week_start: a.week_start, url: a.url, fetched_at: a.fetched_at, sha256: a.sha256,
    counts: a.counts, excluded_n: a.excluded_n, unmapped_n: a.unmapped_n,
  });
}

/** One week's four answers, and its counts as the weekly state keeps them: [AI-method papers, all papers] for each field. */
export interface WeekFetch {
  week_start: IsoDate;
  /** In `OPENALEX_REQUESTS` order. */
  answers: Record<OpenAlexRequestKind, GroupByAnswer>;
  /** The earliest fetch date of its four answers (`PaceWeek.fetched`). */
  fetched: IsoDate;
  leading: Record<FieldId, [number, number]>;
  all: Record<FieldId, [number, number]>;
}

/**
 * A week from its four answers. Throws `OpenAlexError` of kind "answer" when a field's AI-method count is above its total, and
 * `RangeError` when a slot holds another request's answer or another week's.
 */
export function weekFetch(answers: Record<OpenAlexRequestKind, GroupByAnswer>): WeekFetch {
  const week = answers.leading_total.week_start;
  for (const k of OPENALEX_REQUESTS) {
    const a = answers[k];
    if (a.request !== k || a.week_start !== week) throw new RangeError(`The ${k} slot holds the ${a.request} answer of the week of ${a.week_start}; a week is four answers of the week of ${week}`);
  }
  const pair = (ai: GroupByAnswer, total: GroupByAnswer): Record<FieldId, [number, number]> =>
    Object.fromEntries(FIELDS.map((f) => {
      if (ai.counts[f] > total.counts[f]) {
        throw new OpenAlexError("answer", `The AI-method count of ${f} in the week of ${week} (${ai.counts[f]}) is above its total (${total.counts[f]}); OpenAlex's counts changed between the two requests`, ai.url);
      }
      return [f, [ai.counts[f], total.counts[f]]];
    })) as Record<FieldId, [number, number]>;
  const ordered = Object.fromEntries(OPENALEX_REQUESTS.map((k) => [k, answers[k]])) as Record<OpenAlexRequestKind, GroupByAnswer>;
  return {
    week_start: week,
    answers: ordered,
    fetched: OPENALEX_REQUESTS.map((k) => ordered[k].fetched).reduce((a, b) => (b < a ? b : a)),
    leading: pair(answers.leading_ai, answers.leading_total),
    all: pair(answers.all_ai, answers.all_total),
  };
}

/** The week as `content/state/pace-weekly.json` keeps it (§4.7). */
export function paceWeek(w: WeekFetch, provisional: boolean): PaceWeek {
  return PaceWeek.parse({ week_start: w.week_start, fetched: w.fetched, provisional, leading: w.leading, all: w.all });
}

/** The four manifest records of a week, in `OPENALEX_REQUESTS` order. */
export function weekInputs(w: WeekFetch): OpenAlexRequest[] {
  return OPENALEX_REQUESTS.map((k) => inputsRecord(w.answers[k]));
}

// ── The client ───────────────────────────────────────────────────────────────────────────────────

export interface OpenAlexClientOptions {
  /** `cache/openalex/`: the group-by answers, kept for good (§0.4 row 76). */
  cacheDir: string;
  query: PaceQuery;
  /** `config/run.json` `pace.provisional_weeks`: sets a week's last morning. */
  provisionalWeeks: number;
  /** The run's own Taipei date. Default: today's. */
  today?: IsoDate;
  /** Refetch a cached answer even when it was fetched on or after its week's last morning (never one fetched on `today`). */
  refresh?: boolean;
  /** The API key, from `readOpenAlexKey()`; added to each request on the wire only, and never recorded. Null or absent: keyless. */
  apiKey?: string | null;
  /** The clock (injectable); read once for each fetch. */
  now?: () => Date;
  /** Epoch ms: no attempt starts after it (`fetchFeed()`'s deadline). */
  deadline?: number;
}

export interface OpenAlexStats {
  /** Requests answered by OpenAlex this run. */
  requests: number;
  /** Group-by answers read from the cache instead. */
  cache_hits: number;
  /** Credits the answered requests cost (`requestCredits()`). */
  credits: number;
}

export interface OpenAlexClient {
  readonly query: PaceQuery;
  readonly today: IsoDate;
  /** One GET to api.openalex.org with the key added; returns the body text and the Taipei time it arrived. Throws `OpenAlexError`. Never cached. */
  request(url: string, what?: string): Promise<{ text: string; fetched_at: string }>;
  /** One group-by answer: from the cache when §5.4's rule allows, else fetched and cached. */
  groupBy(kind: OpenAlexRequestKind, weekStart: IsoDate): Promise<GroupByAnswer>;
  /** The four answers of a week. */
  fetchWeek(weekStart: IsoDate): Promise<WeekFetch>;
  stats(): OpenAlexStats;
}

/**
 * Turns a failed fetch into an `OpenAlexError` that names no key: the class and the status only, never the harness's raw detail.
 * The harness drops the body and the headers of a non-2xx answer, so the budget is told by the status alone: `http_402` or `http_429`.
 */
function failed(r: FetchResult, url: string, what: string): OpenAlexError {
  const m = /^http_(\d+)$/.exec(r.error ?? "");
  const status = m ? Number(m[1]) : null;
  if (status === 402 || status === 429) return new OpenAlexBudgetError(url, status);
  if (status !== null) return new OpenAlexError("http", `OpenAlex answered HTTP ${status} to ${what}`, url, status);
  if (r.error === "too_large") return new OpenAlexError("answer", `OpenAlex's answer to ${what} is over the ${FEED_MAX_BYTES.default} byte cap`, url);
  return new OpenAlexError("network", `OpenAlex gave no usable answer to ${what} (${r.error ?? "network"})`, url);
}

export function createOpenAlexClient(o: OpenAlexClientOptions): OpenAlexClient {
  const now = o.now ?? (() => new Date());
  const today = o.today ?? taipeiToday(now());
  const refresh = o.refresh === true;
  const key = o.apiKey ? o.apiKey : null;
  const stats: OpenAlexStats = { requests: 0, cache_hits: 0, credits: 0 };
  if (!isValidDate(today)) throw new RangeError(`today is a Taipei date, got ${today}`);
  assertProvisionalWeeks(o.provisionalWeeks);

  async function request(url: string, what = "a request"): Promise<{ text: string; fetched_at: string }> {
    if (!url.startsWith(`${OPENALEX_ORIGIN}/`)) throw new RangeError("The client asks api.openalex.org only");
    if (/[?&]api_key=/i.test(url)) throw new RangeError("A request URL is built without its key; the client adds it");
    const wire = key ? `${url}&api_key=${encodeURIComponent(key)}` : url;
    // A redirect that kept the query would carry the key to another host: the client follows redirects within api.openalex.org only.
    const options: FetchOptions = {
      accept: "application/json", timeoutMs: FEED_TIMEOUTS.default, maxBytes: FEED_MAX_BYTES.default,
      refuseRedirect: (target) => (target.startsWith(`${OPENALEX_ORIGIN}/`) ? null : "the client follows redirects within api.openalex.org only"),
    };
    if (o.deadline !== undefined) options.deadline = o.deadline;
    const r = await fetchFeed(wire, options);
    if (!r.ok || r.body === null) throw failed(r, url, what);
    stats.requests += 1;
    stats.credits += requestCredits(url);
    return { text: r.body.toString("utf8"), fetched_at: taipeiTimestamp(now()) };
  }

  async function groupBy(kind: OpenAlexRequestKind, weekStart: IsoDate): Promise<GroupByAnswer> {
    const url = groupByUrl(paceFilter(kind, weekStart, o.query));
    const newest = storedAnswers(o.cacheDir, kind, weekStart, url)[0];
    if (newest && reusable(newest.fetched, { weekStart, today, provisionalWeeks: o.provisionalWeeks, refresh })) {
      stats.cache_hits += 1;
      return answerOf(newest, kind, weekStart, o.query.fields, true);
    }
    const { text, fetched_at } = await request(url, `${kind} for the week of ${weekStart}`);
    parseGroupBy(text, url);
    const stored: StoredAnswer = { url, fetched_at, fetched: taipeiDateOf(fetched_at), sha256: sha256Hex(text), body: text };
    writeAnswer(o.cacheDir, kind, weekStart, stored);
    return answerOf(stored, kind, weekStart, o.query.fields, false);
  }

  async function fetchWeek(weekStart: IsoDate): Promise<WeekFetch> {
    const got = {} as Record<OpenAlexRequestKind, GroupByAnswer>;
    for (const kind of FETCH_ORDER) got[kind] = await groupBy(kind, weekStart);
    return weekFetch(got);
  }

  return { query: o.query, today, request, groupBy, fetchWeek, stats: () => ({ ...stats }) };
}

/** The OpenAlex key from the login keychain (`unveiling-openalex-key`, §9.6), trimmed, or null when there is none. Never logged. */
export function readOpenAlexKey(o: { bin?: string; timeoutMs?: number } = {}): string | null {
  return readSecret(OPENALEX_KEY_SERVICE, o);
}

// ── The DOI lookup (§8.3) ────────────────────────────────────────────────────────────────────────

/** A candidate as the lookup reads it: its DOI as §4.1 stores it (or null) and when it was published, for the order. */
export interface DoiCandidate {
  doi: string | null;
  published_at: string | null;
}

/** `bare`: the filter takes DOIs in §4.1's form; `resolver`: it takes `https://doi.org/<doi>` (the fallback §8.3 names if the first does not work). */
export type DoiForm = "bare" | "resolver";

export const DOI_BATCH_MAX = FILTER_VALUES_MAX;

/** Milliseconds of a `published_at` (a timestamp with an offset, or a bare date, which reads as UTC midnight); Infinity for none or an unreadable one, so a candidate with no date is asked last. */
function publishedMs(value: string | null): number {
  const ms = value === null ? Number.NaN : Date.parse(value);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** A UTF-16 surrogate with no partner: `encodeURIComponent` throws on it, and a feed's DOI is untrusted text. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * The DOIs worth asking for, once each, oldest first (§8.3): ordered by their oldest candidate's `published_at`, ties by DOI. A
 * candidate with no DOI, one holding `,` or `|` (the filter's own syntax) or one holding an unpaired surrogate (which no URL can
 * carry) is left out.
 */
export function askableDois(candidates: readonly DoiCandidate[]): string[] {
  const oldest = new Map<string, number>();
  for (const c of candidates) {
    const doi = c.doi === null ? null : normalizeDoi(c.doi);
    if (doi === null || /[,|]/.test(doi) || LONE_SURROGATE.test(doi)) continue;
    const ms = publishedMs(c.published_at);
    const seen = oldest.get(doi);
    if (seen === undefined || ms < seen) oldest.set(doi, ms);
  }
  return [...oldest.keys()].sort((a, b) => {
    const x = oldest.get(a)!;
    const y = oldest.get(b)!;
    return x < y ? -1 : x > y ? 1 : byCodeUnit(a, b);
  });
}

/** `works?filter=doi:<a>|<b>|...&per-page=100&select=doi,primary_topic`, each DOI URL-encoded and the `|` between them literal. */
export function doiLookupUrl(dois: readonly string[], form: DoiForm = "bare"): string {
  if (dois.length === 0 || dois.length > DOI_BATCH_MAX) throw new RangeError(`A DOI request names 1 to ${DOI_BATCH_MAX} DOIs, got ${dois.length}`);
  const values = dois.map((d) => {
    if (normalizeDoi(d) !== d || /[,|]/.test(d)) throw new RangeError(`A DOI in a request is in §4.1's form without a comma or a bar, got ${JSON.stringify(d)}`);
    return encodeURIComponent(form === "bare" ? d : doiUrl(d));
  });
  return `${OPENALEX_ORIGIN}/works?filter=doi:${values.join("|")}&per-page=${DOI_BATCH_MAX}&select=doi,primary_topic`;
}

const DoiAnswer = z.looseObject({
  results: z.array(z.looseObject({
    doi: z.string().nullish(),
    primary_topic: z.looseObject({ field: z.looseObject({ id: z.union([z.string(), z.number()]).nullish() }).nullish() }).nullish(),
  })),
});

export interface DoiLookupStats {
  /** DOIs that could be asked (once each, `,` and `|` left out). */
  askable: number;
  /** DOIs put in a request that was made. */
  asked: number;
  /** DOIs left for want of requests (the cap, a failure that stopped the lookup). */
  not_asked: number;
  requests: number;
  failed_requests: number;
  /** Records returned for a DOI asked. */
  records: number;
  /** Asked DOIs in an answered request that OpenAlex returned no record for (not indexed yet). */
  not_indexed: number;
  /** Records with no primary topic or no field. */
  no_topic: number;
  /** Records whose field fields.json excludes. */
  excluded: number;
  /** Records whose field fields.json does not list. */
  unmapped: number;
  /** DOIs that took a field. */
  mapped: number;
}

export interface DoiLookup {
  /** DOI (§4.1's form) to our field, for each DOI whose record has a primary topic in a mapped field. Every other candidate falls to the next mapping. */
  fields: Map<string, FieldId>;
  stats: DoiLookupStats;
  /** True when the lookup stopped because OpenAlex's budget is spent. */
  stopped_on_budget: boolean;
}

/**
 * Asks OpenAlex for the topics of the candidates' DOIs (§8.3), `maxRequests` requests at most (what `openalex`'s budget leaves,
 * 12), the oldest DOIs first, 100 to a request. Never throws and caches nothing: a request that fails leaves its DOIs to the next
 * mapping and the next batch is still asked (unless the budget is spent, which stops the lookup). A record is matched to its DOI
 * by its `doi` read as §4.1 stores DOIs; its `primary_topic.field.id` maps through `fields.json` as in §5.1.
 */
export async function lookupDois(
  client: Pick<OpenAlexClient, "request" | "query">,
  candidates: readonly DoiCandidate[],
  o: { maxRequests: number; form?: DoiForm },
): Promise<DoiLookup> {
  if (!Number.isInteger(o.maxRequests) || o.maxRequests < 0) throw new RangeError(`maxRequests is a whole number of 0 or more, got ${o.maxRequests}`);
  const dois = askableDois(candidates);
  const stats: DoiLookupStats = { askable: dois.length, asked: 0, not_asked: 0, requests: 0, failed_requests: 0, records: 0, not_indexed: 0, no_topic: 0, excluded: 0, unmapped: 0, mapped: 0 };
  const fields = new Map<string, FieldId>();
  let stopped = false;
  for (let from = 0, batchNo = 0; from < dois.length && batchNo < o.maxRequests && !stopped; from += DOI_BATCH_MAX, batchNo += 1) {
    const batch = dois.slice(from, from + DOI_BATCH_MAX);
    stats.requests += 1;
    stats.asked += batch.length;
    const url = doiLookupUrl(batch, o.form);
    let answer: z.infer<typeof DoiAnswer>;
    try {
      const { text } = await client.request(url, "a DOI lookup");
      answer = DoiAnswer.parse(JSON.parse(text));
    } catch (e) {
      stats.failed_requests += 1;
      if (e instanceof OpenAlexBudgetError) stopped = true;
      continue;
    }
    const wanted = new Set(batch);
    const seen = new Set<string>();
    for (const record of answer.results) {
      const doi = record.doi ? normalizeDoi(record.doi) : null;
      if (doi === null || !wanted.has(doi)) continue;
      stats.records += 1;
      seen.add(doi);
      const id = record.primary_topic?.field?.id;
      if (id === undefined || id === null) {
        stats.no_topic += 1;
        continue;
      }
      const number = openalexFieldNumber(String(id));
      const field = number === null ? undefined : client.query.fields.get(number);
      if (field === undefined) stats.unmapped += 1;
      else if (field === null) stats.excluded += 1;
      else if (!fields.has(doi)) {
        fields.set(doi, field);
        stats.mapped += 1;
      }
    }
    stats.not_indexed += batch.length - seen.size;
  }
  stats.not_asked = dois.length - stats.asked;
  return { fields, stats, stopped_on_budget: stopped };
}

// ── The sampler (§10 P2 step 2) ──────────────────────────────────────────────────────────────────

/**
 * mulberry32, a 32-bit generator by Tommy Ettinger: from a seed it yields numbers in [0, 1) from a fixed formula, the same on every
 * platform (integer arithmetic only, one division by 2^32). The seed is taken as an unsigned 32-bit integer.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * `n` of `items`, drawn without repeats and in a random order by a partial Fisher-Yates shuffle that reads one `mulberry32(seed)`
 * number for each place: the same items, `n` and seed give the same draw. All of them when there are fewer than `n`. `items` is
 * not changed.
 */
export function seededDraw<T>(items: readonly T[], n: number, seed: number): T[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n is a whole number of 0 or more, got ${n}`);
  const pool = [...items];
  const rand = mulberry32(seed);
  const take = Math.min(n, pool.length);
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, take);
}

export interface SampleSpec {
  /** Publication dates, both ends included: the periods are 2015-01-05 to 2019-12-29 and the newest 52 firm weeks. */
  from: IsoDate;
  to: IsoDate;
  /** `leading`: the journals with in_pace true (A's papers); `all`: every paper (B's). */
  scope: "leading" | "all";
  /** Only papers whose primary topic is in these of our fields. */
  fields?: readonly FieldId[];
  /** The paper's title or abstract names at least one of these phrases. Absent: no search. */
  include?: readonly string[];
  /** ... and none of these (the NOT that finds a phrase alone, or the papers the terms did not match). */
  exclude?: readonly string[];
  /** At most this many papers (all of them when fewer match), 1 to 100. */
  n: number;
  /** The seed the report states, 0 to 2,147,483,647. */
  seed: number;
  /** `sample`: OpenAlex's own `sample` and `seed`; `page`: page through the matching works, compare ids and draw with the seed; `auto` (default): `sample`, and `page` when OpenAlex refuses the request with a 4xx. */
  method?: "auto" | "sample" | "page";
  /** The page path's most pages of 100 ids for one filter. Default 2,000. */
  maxPages?: number;
}

/** A sampled paper: its OpenAlex id, DOI (§4.1's form), title and abstract (sanitised: it is data, never instructions), and publication date. */
export interface SampledWork {
  id: string;
  doi: string | null;
  title: string | null;
  publication_date: IsoDate | null;
  abstract: string | null;
}

export interface SampleResult {
  /** The path that drew it. */
  method: "sample" | "page";
  /** Oldest id first, whichever path drew them. */
  works: SampledWork[];
  /** The page path: how many works matched (the draw's population). The sample path does not learn it: null. */
  matched: number | null;
  /** Requests made for the sample, the refused one that sent `auto` to the page path included. */
  requests: number;
  /** Every request URL made, without any key. */
  urls: string[];
}

/** `W123` before `W1234`: ids compared as numbers, without leading zeros. */
export const compareWorkIds = (a: string, b: string): number => a.length - b.length || byCodeUnit(a, b);

/** `https://openalex.org/W2741809807` or `W2741809807`: the short id, or null. */
function workId(id: string): string | null {
  const m = /(?:^|\/)(W\d+)$/.exec(id.trim());
  return m ? m[1]! : null;
}

/** The abstract of a work from OpenAlex's inverted index (word to its positions), words in position order; null when there is none. */
export function abstractText(index: Readonly<Record<string, readonly number[]>> | null | undefined): string | null {
  if (!index) return null;
  const words: [number, string][] = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words.push([p, word]);
  if (words.length === 0) return null;
  words.sort((a, b) => a[0] - b[0] || byCodeUnit(a[1], b[1]));
  return words.map((w) => w[1]).join(" ");
}

const TITLE_MAX = 300;
const ABSTRACT_MAX = 5_000;
const PIECE = 800;

/** `sanitize()` cuts at 1,000 characters, so a long text is cleaned in pieces of at most 800 at word breaks, then cut at `max`. */
function sanitizeLong(text: string, max: number): string | null {
  const pieces: string[] = [];
  let piece = "";
  for (const word of text.split(/\s+/)) {
    if (piece !== "" && piece.length + word.length + 1 > PIECE) {
      pieces.push(piece);
      piece = word;
    } else {
      piece = piece === "" ? word : `${piece} ${word}`;
    }
  }
  if (piece !== "") pieces.push(piece);
  const clean = pieces.map((p) => sanitize(p, { max: 1_000 })).filter((p) => p !== "").join(" ");
  return clean === "" ? null : cutText(clean, max);
}

const WorksAnswer = z.looseObject({
  meta: z.looseObject({ next_cursor: z.string().nullish() }).nullish(),
  results: z.array(z.looseObject({
    id: z.string(),
    doi: z.string().nullish(),
    title: z.string().nullish(),
    publication_date: z.string().nullish(),
    abstract_inverted_index: z.record(z.string(), z.array(z.int().min(0))).nullish(),
  })),
});

type WorksAnswer = z.infer<typeof WorksAnswer>;

function parseWorks(text: string, url: string): WorksAnswer {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new OpenAlexError("answer", "OpenAlex's answer is not JSON", url);
  }
  const parsed = WorksAnswer.safeParse(raw);
  if (!parsed.success) throw new OpenAlexError("answer", "OpenAlex's answer has no usable results list", url);
  return parsed.data;
}

function abstractOf(index: WorksAnswer["results"][number]["abstract_inverted_index"]): string | null {
  const text = abstractText(index);
  return text === null ? null : sanitizeLong(text, ABSTRACT_MAX);
}

function sampledWorks(answer: WorksAnswer, url: string): SampledWork[] {
  const works = answer.results.map((r): SampledWork => {
    const id = workId(r.id);
    if (id === null) throw new OpenAlexError("answer", "A work in OpenAlex's answer has no W id", url);
    return {
      id,
      doi: r.doi ? normalizeDoi(r.doi) : null,
      title: r.title ? sanitizeLong(r.title, TITLE_MAX) : null,
      publication_date: r.publication_date && isValidDate(r.publication_date) ? r.publication_date : null,
      abstract: abstractOf(r.abstract_inverted_index),
    };
  });
  return works.sort((a, b) => compareWorkIds(a.id, b.id));
}

function assertSpec(spec: SampleSpec): void {
  if (!isValidDate(spec.from) || !isValidDate(spec.to) || spec.from > spec.to) throw new RangeError(`A sample's dates run from one date to a later one, got ${spec.from} to ${spec.to}`);
  if (!Number.isInteger(spec.n) || spec.n < 1 || spec.n > PER_PAGE_MAX) throw new RangeError(`n is a whole number from 1 to ${PER_PAGE_MAX}, got ${spec.n}`);
  if (!Number.isInteger(spec.seed) || spec.seed < 0 || spec.seed > SEED_MAX) throw new RangeError(`seed is a whole number from 0 to ${SEED_MAX}, got ${spec.seed}`);
  // The phrases are checked by `searchExpression()` when `sampleFilter()` builds the search, the one place a sample uses them.
}

/** The filter of a sample with no search: the dates, `type:article`, `has_abstract:true`, the journals for A, the fields' OpenAlex ids. */
function sampleBase(query: PaceQuery, spec: SampleSpec): string {
  const parts = [`from_publication_date:${spec.from}`, `to_publication_date:${spec.to}`, "type:article", "has_abstract:true"];
  if (spec.scope === "leading") {
    assertSources(query.sources);
    parts.push(`primary_location.source.id:${query.sources.join("|")}`);
  }
  if (spec.fields !== undefined) {
    const wanted = new Set(spec.fields);
    const ids = [...query.fields].filter(([, f]) => f !== null && wanted.has(f)).map(([id]) => id).sort((a, b) => a - b);
    if (ids.length === 0) throw new RangeError("None of the sample's fields has an OpenAlex field id");
    parts.push(`primary_topic.field.id:${ids.join("|")}`);
  }
  return parts.join(",");
}

/** The whole filter of a sample: the base and, when it names phrases, the search (`include`, with `exclude` as NOT). */
export function sampleFilter(query: PaceQuery, spec: SampleSpec): string {
  assertSpec(spec);
  const base = sampleBase(query, spec);
  const include = spec.include ?? [];
  const exclude = spec.exclude ?? [];
  return include.length === 0 && exclude.length === 0 ? base : `${base},${searchFilter(searchExpression(include, exclude))}`;
}

/** The sample path's request: the filter with `sample`, `seed`, `per-page` and `select`. */
export function sampleUrl(filter: string, n: number, seed: number): string {
  return `${OPENALEX_ORIGIN}/works?filter=${filter}&sample=${n}&seed=${seed}&per-page=${n}&select=${SAMPLE_SELECT}`;
}

async function sampleByParameters(client: Pick<OpenAlexClient, "request">, spec: SampleSpec, filter: string): Promise<SampleResult> {
  const url = sampleUrl(filter, spec.n, spec.seed);
  const { text } = await client.request(url, "a sample");
  const works = sampledWorks(parseWorks(text, url), url);
  if (works.length > spec.n || new Set(works.map((w) => w.id)).size !== works.length) {
    throw new OpenAlexError("answer", `OpenAlex's sample is not at most ${spec.n} different works`, url);
  }
  return { method: "sample", works, matched: null, requests: 1, urls: [url] };
}

/** Every id the filter matches, paged 100 at a time by cursor (OpenAlex asks for a key to page past the first page). */
async function pageIds(client: Pick<OpenAlexClient, "request">, filter: string, maxPages: number, urls: string[]): Promise<string[]> {
  const ids = new Set<string>();
  let cursor = "*";
  for (let page = 0; page < maxPages; page += 1) {
    const url = `${OPENALEX_ORIGIN}/works?filter=${filter}&per-page=${PER_PAGE_MAX}&select=id&cursor=${encodeURIComponent(cursor)}`;
    urls.push(url);
    const { text } = await client.request(url, "a page of matching works");
    const answer = parseWorks(text, url);
    for (const r of answer.results) {
      const id = workId(r.id);
      if (id === null) throw new OpenAlexError("answer", "A work in OpenAlex's answer has no W id", url);
      ids.add(id);
    }
    const next = answer.meta?.next_cursor ?? null;
    if (next === null || next === "" || answer.results.length === 0) return [...ids];
    cursor = next;
  }
  throw new OpenAlexError("answer", `The matching works fill more than ${maxPages} pages of ${PER_PAGE_MAX}`, OPENALEX_ORIGIN);
}

/** `urls` starts with the requests made already (the sample request OpenAlex refused, when the paging is the fallback). */
async function sampleByPaging(client: Pick<OpenAlexClient, "request" | "query">, spec: SampleSpec, urls: string[] = []): Promise<SampleResult> {
  const maxPages = spec.maxPages ?? 2_000;
  const base = sampleBase(client.query, spec);
  const include = spec.include ?? [];
  const exclude = spec.exclude ?? [];
  const inBase = await pageIds(client, include.length === 0 ? base : `${base},${searchFilter(searchExpression(include))}`, maxPages, urls);
  const out = exclude.length === 0 ? new Set<string>() : new Set(await pageIds(client, `${base},${searchFilter(searchExpression(exclude))}`, maxPages, urls));
  const candidates = inBase.filter((id) => !out.has(id)).sort(compareWorkIds);
  const drawn = seededDraw(candidates, spec.n, spec.seed).sort(compareWorkIds);
  let works: SampledWork[] = [];
  if (drawn.length > 0) {
    // At most `n` of 100 ids: one request, under the filter's 100-value limit.
    const url = `${OPENALEX_ORIGIN}/works?filter=openalex:${drawn.join("|")}&per-page=${PER_PAGE_MAX}&select=${SAMPLE_SELECT}`;
    urls.push(url);
    const { text } = await client.request(url, "the drawn works");
    works = sampledWorks(parseWorks(text, url), url);
  }
  return { method: "page", works, matched: candidates.length, requests: urls.length, urls };
}

/**
 * A random sample of papers for the precision and recall samples (§10 P2 step 2), drawn with a seed the report states. By default it
 * asks OpenAlex for `sample` and `seed` with the filters of §5.1; when OpenAlex refuses that with a 4xx (the parameters or the
 * `NOT` do not work with these filters) it pages through the matching works, compares ids (the matches of `include`, less the
 * matches of `exclude`) and draws with `seededDraw()`. Both paths return the same shape, oldest id first. A budget error ends the
 * sample and is thrown, never answered with the other path.
 */
export async function sampleWorks(client: Pick<OpenAlexClient, "request" | "query">, spec: SampleSpec): Promise<SampleResult> {
  const filter = sampleFilter(client.query, spec);
  const method = spec.method ?? "auto";
  if (method === "page") return sampleByPaging(client, spec);
  try {
    return await sampleByParameters(client, spec, filter);
  } catch (e) {
    const refused = e instanceof OpenAlexError && e.kind === "http" && e.status !== null && e.status >= 400 && e.status < 500;
    if (method === "auto" && refused) return sampleByPaging(client, spec, [e.url]);
    throw e;
  }
}
