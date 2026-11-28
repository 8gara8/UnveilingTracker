// arXiv's calendar and its Atom answers (SPEC §4.13 "arXiv's calendar", §4.14, §8.3). Pure: dates in, dates
// and strings out, plus a parser for the API's Atom text. No request is made here: `arxiv-<cat>` in
// scripts/lib/feeds.ts builds the query from `submittedDateClause()` and asks `fetchFeed()`, whose arXiv queue
// spaces the requests (lib/feeds/http.ts).
//
// The calendar. arXiv announces new submissions at 20:00 US Eastern (America/New_York, so US summer time is
// followed through Intl, never a fixed offset), Sunday to Thursday, except on the US dates in `arxiv_skipped`.
// Each announcement has a deadline at 14:00 US Eastern on its own day or, for a Sunday announcement, on the
// Friday before; its list is the submissions from the deadline of the previous announcement not skipped to
// its own, so a skipped announcement's submissions fall into the next list. The window of the Taipei edition
// date D holds the announcement of the US date D − 2 (08:00 or 09:00 Taipei on D − 1), and the 48-hour
// lookback before that window holds the announcements of the US dates D − 4 and D − 3: `windowAnnouncement()`
// and `lookbackAnnouncements()` read exactly that, and tests/arxiv.test.ts shows it agrees with the pack
// window and lookback of config/run.json on every day of the years it covers. Sunday and Monday mornings
// Taipei, and the morning a skipped announcement would have reached, have no list.
//
// New in this project (no Cyber source). The Atom reading uses cheerio, as §4.13 says; the date reading is
// `feedDate()` of lib/feeds/rss.ts.

import { load } from "cheerio";
import { addDays, isValidDate, taipeiTimestamp, weekday } from "../dates";
import { sha256Hex } from "../json";
import { normalizeDoi } from "../urls";
import { feedDate } from "./rss";
import { FeedParseError, latestOf, rawItem, type ArxivEntry, type ArxivPage, type Parsed, type RawItem } from "./types";

// ── Eastern time ─────────────────────────────────────────────────────────────────────────────────

const EASTERN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
});

interface Wall { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** The wall-clock fields of America/New_York at the instant `utcMs`. */
function easternWall(utcMs: number): Wall {
  const f: Record<string, number> = {};
  for (const p of EASTERN.formatToParts(new Date(utcMs))) if (p.type !== "literal") f[p.type] = Number(p.value);
  return { year: f.year!, month: f.month!, day: f.day!, hour: f.hour!, minute: f.minute!, second: f.second! };
}

/** The offset of America/New_York from UTC at `utcMs` (a whole number of seconds), in ms: −4 h in US summer time, −5 h in winter. */
function easternOffsetMs(utcMs: number): number {
  const w = easternWall(utcMs);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - utcMs;
}

/**
 * The instant, in epoch ms, of `hour`:`minute` America/New_York on the US calendar date `date`. The two-step
 * lookup is exact for every wall time that exists once, which holds for each time this file asks (00:00, 14:00
 * and 20:00: the clocks change at 02:00); a time inside the change itself is not defined here.
 */
export function usEasternMs(date: string, hour: number, minute = 0): number {
  if (!isValidDate(date) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error(`Invalid US Eastern time: ${date} ${hour}:${minute}`);
  }
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  return wall - easternOffsetMs(wall - easternOffsetMs(wall));
}

/** The US Eastern calendar date (`YYYY-MM-DD`) at the instant `utcMs`. */
export function usDateOf(utcMs: number): string {
  const w = easternWall(utcMs);
  return `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

// ── The calendar ─────────────────────────────────────────────────────────────────────────────────

/** An announcement is at 20:00 US Eastern on its US date. */
export const ARXIV_ANNOUNCE_HOUR = 20;
/** Its list ends at 14:00 US Eastern on the deadline day. */
export const ARXIV_DEADLINE_HOUR = 14;

/** True for a US date arXiv announces on: Sunday to Thursday, unless `arxiv_skipped` lists it. */
export function isAnnouncementDate(usDate: string, skipped: readonly string[]): boolean {
  return isValidDate(usDate) && weekday(usDate) <= 4 && !skipped.includes(usDate);
}

/** One announcement and the list of submissions it makes public. */
export interface ArxivList {
  /** The US date of the announcement. */
  usDate: string;
  /** The announcement's time in epoch ms (20:00 US Eastern on `usDate`). */
  announcedMs: number;
  /** The same time as a Taipei timestamp (`2026-11-11T09:00:00+08:00`): the pack's `arxiv_announcement` and the `published_at` of every entry (§4.14). */
  announcedAt: string;
  /** The US date of the previous announcement not in `arxiv_skipped`, whose deadline starts this list. */
  previousUsDate: string;
  /** The start of the list, the previous announcement's deadline, in epoch ms. */
  fromMs: number;
  /** This announcement's own deadline in epoch ms: the list ends at it, the deadline itself belonging to the next list. */
  deadlineMs: number;
  /** `fromMs` as `YYYYMMDDHHMM` in UTC (the API's `submittedDate` start, included). */
  from: string;
  /**
   * The deadline's own minute as `YYYYMMDDHHMM` in UTC: the API's `submittedDate` end, which it does NOT include
   * (`[A TO B]` reads from the first second of minute A to just before B:00, so a paper submitted at 18:59:26
   * is in `[1859 TO 1900]` and in neither `[1858 TO 1859]` nor `[1859 TO 1859]`; Kobol's K1c). The next list
   * starts at the same minute, so two lists meet and share no paper.
   */
  to: string;
  /** The hours from `fromMs` to `deadlineMs`: 24 on an ordinary day, 72 for a Monday list, 73 or 71 after a clock change. */
  hours: number;
}

/** The deadline of the announcement on `usDate`: 14:00 US Eastern on its own day, or on the Friday before for a Sunday. */
function deadlineOf(usDate: string): number {
  return usEasternMs(weekday(usDate) === 0 ? addDays(usDate, -2) : usDate, ARXIV_DEADLINE_HOUR);
}

/** The latest announcement date before `usDate` that is not skipped. */
function previousAnnouncementDate(usDate: string, skipped: readonly string[]): string {
  let day = addDays(usDate, -1);
  while (!isAnnouncementDate(day, skipped)) day = addDays(day, -1);
  return day;
}

/** An instant as `YYYYMMDDHHMM` in UTC, the form of `submittedDate`. */
function utcMinute(ms: number): string {
  return new Date(ms).toISOString().replace(/[-T:]/g, "").slice(0, 12);
}

/** The announcement on the US date `usDate` and its list, or null when arXiv makes none that day (a Friday or Saturday, or a skipped date). */
export function arxivListFor(usDate: string, skipped: readonly string[]): ArxivList | null {
  if (!isAnnouncementDate(usDate, skipped)) return null;
  const previousUsDate = previousAnnouncementDate(usDate, skipped);
  const fromMs = deadlineOf(previousUsDate);
  const deadlineMs = deadlineOf(usDate);
  const announcedMs = usEasternMs(usDate, ARXIV_ANNOUNCE_HOUR);
  return {
    usDate,
    announcedMs,
    announcedAt: taipeiTimestamp(new Date(announcedMs)),
    previousUsDate,
    fromMs,
    deadlineMs,
    from: utcMinute(fromMs),
    to: utcMinute(deadlineMs),
    hours: (deadlineMs - fromMs) / 3_600_000,
  };
}

/** The list announced inside the pack window of the Taipei edition date `date` (the US date `date` − 2), or null: Sunday, Monday and a skipped announcement's morning have none. */
export function windowAnnouncement(date: string, skipped: readonly string[]): ArxivList | null {
  return arxivListFor(addDays(date, -2), skipped);
}

/** The lists announced in the lookback before `date`'s window (the US dates `date` − 4 and `date` − 3, oldest first); a skipped or weekend date adds none. */
export function lookbackAnnouncements(date: string, skipped: readonly string[]): ArxivList[] {
  return [addDays(date, -4), addDays(date, -3)].flatMap((d) => arxivListFor(d, skipped) ?? []);
}

/**
 * The newest announcement made before the last midnight US Eastern at `nowMs` (the API adds each list at the
 * midnight after its announcement, so this is the newest list that `sources:check` can read, §4.13).
 */
export function newestListedAnnouncement(nowMs: number, skipped: readonly string[]): ArxivList {
  let day = addDays(usDateOf(nowMs), -1);
  while (!isAnnouncementDate(day, skipped)) day = addDays(day, -1);
  return arxivListFor(day, skipped)!;
}

/** The query clause of a list: `submittedDate:[<from> TO <to>]`, minutes in UTC, the start included and the end (the deadline's minute) excluded. */
export function submittedDateClause(list: ArxivList): string {
  return `submittedDate:[${list.from} TO ${list.to}]`;
}

const FEED_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** The file name of a list in `cache/feeds/arxiv/`: `<id>.<US date>.xml`. */
export function arxivListName(feedId: string, usDate: string): string {
  if (!FEED_ID_RE.test(feedId)) throw new Error(`arxivListName: not a valid feed id: ${JSON.stringify(feedId)}`);
  if (!isValidDate(usDate)) throw new Error(`arxivListName: not a valid date: ${JSON.stringify(usDate)}`);
  return `${feedId}.${usDate}.xml`;
}

// ── The API's Atom answer ────────────────────────────────────────────────────────────────────────

/** A new-style id (`2501.01234`) or an old-style one (`math/0211159`, `math.GT/0309136`), then an optional `v2`. */
const ARXIV_ID_RE = /^(\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7})(?:v(\d+))?$/;
const NEW_STYLE_RE = /^\d{4}\.\d{4,5}$/;
const ID_PREFIX_RE = /^(?:https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/|oai:arXiv\.org:|arXiv:)/i;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** An id as arXiv writes it in `<id>` or a link (an abstract or PDF address, an OAI id, `arXiv:…`), split into id and version; null when it is none. */
function idFrom(text: string): { id: string; version: number | null } | null {
  const m = ARXIV_ID_RE.exec(text.trim().replace(ID_PREFIX_RE, "").replace(/\.pdf$/i, ""));
  return m ? { id: m[1]!, version: m[2] === undefined ? null : Number(m[2]) } : null;
}

/**
 * The entries of an arXiv API answer. An answer with no entry is a valid answer (`entries` is `[]`): the
 * caller treats it as "no list" and never keeps it (§4.13). Not an Atom feed is `parse`; the API's error answer
 * (one entry whose id is under `arxiv.org/api/errors`) is `parse`; entries of which none has a title and an id
 * that reads is `schema`, since an answer that lists entries and gives none is a change of format, not a
 * quiet day. Versions are stripped from ids: `2501.01234v2` is `2501.01234`, version 2. Every string is raw.
 */
export function parseArxivEntries(body: Buffer): ArxivPage {
  const $ = load(body.toString("utf8"), { xml: true });
  if ($("feed").length === 0) throw new FeedParseError("parse", "arXiv: the answer is not an Atom feed");
  const nodes = $("feed > entry").toArray();
  const entries: ArxivEntry[] = [];
  for (const node of nodes) {
    const entry = $(node);
    const ids = [entry.children("id").first().text(), entry.children("link[rel=alternate]").first().attr("href") ?? "", entry.children("link").first().attr("href") ?? ""];
    const errorId = ids.find((i) => /arxiv\.org\/api\/errors/i.test(i));
    if (errorId !== undefined) throw new FeedParseError("parse", `arXiv: an error answer (${squash(entry.children("summary").first().text()).slice(0, 160)})`);
    const read = ids.map(idFrom).find((r) => r !== null);
    const title = squash(entry.children("title").first().text());
    if (!read || title === "") continue;
    const primary = entry.children("arxiv\\:primary_category").first().attr("term") ?? "";
    const categories = [...new Set([primary, ...entry.children("category").toArray().map((c) => $(c).attr("term") ?? "")].map((c) => c.trim()).filter((c) => c !== ""))];
    entries.push({
      id: read.id,
      version: read.version,
      title,
      summary: squash(entry.children("summary").first().text()),
      submitted_at: feedDate(entry.children("published").first().text()),
      categories,
      doi: normalizeDoi(entry.children("arxiv\\:doi").first().text()),
      url: `https://arxiv.org/abs/${read.id}`,
    });
  }
  if (nodes.length > 0 && entries.length === 0) {
    throw new FeedParseError("schema", `arXiv: ${nodes.length} ${nodes.length === 1 ? "entry" : "entries"} and none with a title and an id that reads`);
  }
  const total = Number.parseInt($("feed > opensearch\\:totalResults").first().text(), 10);
  return { newest: latestOf(entries.map((e) => e.submitted_at)), entries, version: null, sha256: sha256Hex(body), total: entries.length, total_results: Number.isFinite(total) && total >= 0 ? total : null };
}

/**
 * Entries as candidates' raw items: the title, the abstract page, the summary as the abstract, the DOI when
 * the entry has one, the categories (primary first) and the arXiv id without its version (null for an
 * old-style id, which no new submission has and `Candidate.arxiv` does not take). Every entry's `published_at`
 * is `announcedAt`, the time of the announcement its list belongs to, never the submission time (§4.14).
 */
export function arxivRawItems(entries: readonly ArxivEntry[], announcedAt: string): RawItem[] {
  return entries.map((e) =>
    rawItem({
      title: e.title, url: e.url, published_at: announcedAt, abstract: e.summary, doi: e.doi,
      arxiv: NEW_STYLE_RE.test(e.id) ? e.id : null, categories: e.categories,
    }));
}

/** An arXiv answer as items: `parseArxivEntries()` then `arxivRawItems()`; `newest` is `announcedAt` when there is an entry, else null. */
export function parseArxiv(body: Buffer, announcedAt: string): Parsed<RawItem> & { total_results: number | null } {
  const page = parseArxivEntries(body);
  const entries = arxivRawItems(page.entries, announcedAt);
  return { newest: entries.length > 0 ? announcedAt : null, entries, version: null, sha256: page.sha256, total: entries.length, total_results: page.total_results };
}
