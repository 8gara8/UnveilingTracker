// The shapes every feed reader returns (SPEC §4.13, §4.14, §8.3), shared by lib/feeds/*, the readers in
// scripts/lib/feeds.ts, collect, rank, the metrics and the backfill. Types, FeedParseError and the one
// constructor `rawItem()`. Every string here is raw feed data: collect sanitises what it stores (§4.14),
// and nothing in a feed is ever an instruction.
//
// Cyber's lib/feeds/types.ts at the fork commit 3ced1fb, adapted: Cyber's domain parts (its catalog,
// record, advisory, score and notice shapes) are gone; `RawItem` is this project's candidate fields as a
// feed gives them (§4.14); `ArxivEntry` is new; `FeedParseError`, `Parsed`, `FeedState` and `CheckLabel` are
// Cyber's.

import { byCodeUnit } from "../ids";
import type { FeedStatus } from "../schema/status";
import type { FetchErrorClass } from "./http";

/** A feed's state in a run: the same four values as lib/schema/status.ts FeedStatus. */
export type FeedState = FeedStatus;
/** The `sources:check` label (§8.10); NODATE and STALE both map to the `stale` state. */
export type CheckLabel = "OK" | "STALE" | "NODATE" | "FAIL" | "SKIP";

/** The one error a parser throws for bad content; anything else a parser throws is a bug. */
export class FeedParseError extends Error {
  constructor(readonly errorClass: Extract<FetchErrorClass, "parse" | "schema" | "empty">, message: string) {
    super(message);
    this.name = "FeedParseError";
  }
}

/** §8.3 "each returns { newest, items | records, version, sha256 }". `sha256` is of the raw body; `total` counts what was read. */
export interface Parsed<T> {
  newest: string | null;
  entries: T[];
  version: string | null;
  sha256: string;
  total: number;
}

/**
 * One candidate as a feed reader gives it, before collect sanitises, maps and ranks it (§4.14's fields, the
 * ones a feed can supply). Strings are raw. A field a feed does not carry is null (or `[]`), never invented.
 * `url` is the record's own link as the feed writes it; collect keeps only an https one.
 */
export interface RawItem {
  title: string;
  url: string;
  /**
   * An ISO timestamp, or null when no date reads. The RSS reader gives a UTC one (`...Z`), and a feed that gives a day only is read as the
   * start of that day in its `date_zone`, UTC when it has none (so `2026-11-27` is `2026-11-27T00:00:00.000Z`); an arXiv entry's is its
   * announcement's Taipei time (§4.14). A reader of another kind (a JSON API) may give a bare `YYYY-MM-DD`. `latestOf()` takes all these forms.
   */
  published_at: string | null;
  /** The abstract or summary, in plain text where the reader can strip markup, else as given; "" when the feed gives none. */
  abstract: string;
  /** A DOI in §4.1's stored form (lower case, no resolver), or null. */
  doi: string | null;
  /** An arXiv id without its version (`2501.01234`), or null. */
  arxiv: string | null;
  /** The journal or venue the feed names for this item, or null. */
  journal: string | null;
  /** The article types the feed gives (PubMed's `pubtype`, §4.14); `[]` for a feed that gives none. */
  types: string[];
  /** The subject or category terms the feed gives (arXiv categories, a feed's `<category>` terms), in order, without repeats. */
  categories: string[];
}

/** A date or a timestamp with its own zone (`2026-10-13`, `2026-10-13T08:00:00Z`, `...+08:00`): the only forms read as an instant. */
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/** The instant of a date or timestamp in epoch ms (a bare date is its start in UTC), or −Infinity for any other text, which `Date.parse` would read in the machine's zone or not at all. */
function instantOf(text: string): number {
  if (!INSTANT_RE.test(text)) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * The latest of some timestamps (a `newest`), skipping the nulls; null when none is left. It compares instants,
 * not text, because `RawItem.published_at` may be a Taipei timestamp (`+08:00`, an arXiv entry's announcement) or a
 * bare date as well as a UTC one: `2026-10-13T01:00:00.000Z` is later than `2026-10-13T08:00:00+08:00`
 * although the text sorts before it. A bare date is the start of that day in UTC. Text that is none of these
 * forms ranks below every instant, and two spellings of one instant (or two such texts) go to the larger by code unit,
 * so the answer never depends on the order of `times`. It returns the text as it was given.
 */
export function latestOf(times: readonly (string | null)[]): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const t of times) {
    if (t === null) continue;
    const ms = instantOf(t);
    if (best === null || ms > bestMs || (ms === bestMs && byCodeUnit(t, best) > 0)) {
      best = t;
      bestMs = ms;
    }
  }
  return best;
}

/** A `RawItem` from its two required fields and whichever others a reader has; the rest take their empty values. */
export function rawItem(fields: Pick<RawItem, "title" | "url"> & Partial<RawItem>): RawItem {
  return {
    title: fields.title,
    url: fields.url,
    published_at: fields.published_at ?? null,
    abstract: fields.abstract ?? "",
    doi: fields.doi ?? null,
    arxiv: fields.arxiv ?? null,
    journal: fields.journal ?? null,
    types: fields.types ?? [],
    categories: fields.categories ?? [],
  };
}

/** One entry of an arXiv API answer (SPEC §4.13), read by `parseArxivEntries()` in lib/feeds/arxiv.ts. */
export interface ArxivEntry {
  /** The arXiv id without its version: `2501.01234`, or an old-style `math/0211159`. */
  id: string;
  /** The version the answer shows (`v2` is 2), or null when the id carries none. */
  version: number | null;
  title: string;
  summary: string;
  /** When this version was submitted (the Atom `<published>`), as an ISO timestamp; null when it does not read. */
  submitted_at: string | null;
  /** Every category the entry lists, the primary one first, without repeats. */
  categories: string[];
  /** The DOI of the published version when the entry has one, in §4.1's stored form. */
  doi: string | null;
  /** The entry's abstract page, `https://arxiv.org/abs/<id>` (no version). */
  url: string;
}

/** An arXiv API answer: the entries read, and the total the answer says matched (null when it names none). */
export interface ArxivPage extends Parsed<ArxivEntry> {
  /** The answer's `opensearch:totalResults`: more than `total` when the answer holds only a part of the list. */
  total_results: number | null;
}
