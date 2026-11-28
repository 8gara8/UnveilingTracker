// RSS and Atom feeds (SPEC §4.13, §8.3): the journals' current-issue and online-first feeds, EurekAlert's
// releases, the labs' and the Scroll Prize's own feeds. The harness (rssParser, feedDate, zoneOf, itemZone,
// rssItems) is Cyber's lib/feeds/rss.ts at the fork commit 3ced1fb, adapted: an item is this project's `RawItem`
// (abstract, DOI, journal and subject terms in place of a snippet), the publishers' own elements are read
// (`dc:identifier`, `prism:doi`, `prism:publicationName`, `prism:publicationDate`, `content:encoded`), and the
// notes Cyber read from certain agencies' feeds are gone. Kept from Cyber: the RDF channel's dc:date, Atom's
// raw <published> and <updated>, dates in "YYYY-MM-DD HH:mm" form or with a named zone, and the zone rule
// (a date without a zone takes the channel's own offset, else the registry entry's `date_zone`, else UTC,
// never the machine's zone). Every string is raw feed data.

import Parser from "rss-parser";
import { sha256Hex } from "../json";
import { normalizeDoi } from "../urls";
import { FeedParseError, latestOf, rawItem, type Parsed, type RawItem } from "./types";

/**
 * Atom's <published> and <updated> (and the <updated> some RSS items carry) under names rss-parser does not
 * know, so it never turns them into dates itself: it would read a zone-less one in the machine's zone and
 * throw on one it cannot read, failing the whole feed. rssItems() reads the raw strings through feedDate().
 */
const RAW_PUBLISHED = "raw-published";
const RAW_UPDATED = "raw-updated";
const RAW_CATEGORY = "raw-category";
const RAW_IDENTIFIER = "raw-identifier";
const rawDateTag = (name: string): string => (name === "published" ? RAW_PUBLISHED : name === "updated" ? RAW_UPDATED : name);

/**
 * rss-parser set up for the registry's feeds: the RDF channel's dc:date, Atom's raw <published> and
 * <updated>, and the publishers' own item elements. Several `<category>` and `<dc:identifier>` elements are
 * all kept (rss-parser keeps only the first of an element unless told).
 */
export function rssParser(): Parser {
  return new Parser({
    customFields: {
      feed: ["dc:date", RAW_UPDATED],
      item: [
        "a10:updated", "atom:updated", RAW_PUBLISHED, RAW_UPDATED, "dc:date", "prism:doi", "prism:publicationName", "prism:publicationDate",
        ["category", RAW_CATEGORY, { keepArray: true }],
        ["dc:identifier", RAW_IDENTIFIER, { keepArray: true }],
      ],
    },
    xml2js: { tagNameProcessors: [rawDateTag] },
  });
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** A date string squashed, without the trailing comment that RFC 822 allows after its zone (`+0900 (JST)`). */
const dateText = (s: string) => squash(s).replace(/\s*\([^()]*\)$/, "");

/** An element's text: a string as is, xml2js's { _: text } for an element with attributes, else undefined. */
function textOf(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v !== null && typeof v === "object" && typeof (v as { _?: unknown })._ === "string") return (v as { _: string })._;
  return undefined;
}

/** Zone names seen on registry feeds and their neighbours, as numeric offsets. */
const NAMED_ZONES: Readonly<Record<string, string>> = {
  CET: "+0100", CEST: "+0200", MEZ: "+0100", MESZ: "+0200", EET: "+0200", EEST: "+0300", WET: "+0000", WEST: "+0100",
  BST: "+0100", JST: "+0900", KST: "+0900", HKT: "+0800", SGT: "+0800",
  // The US zones, as Date.parse reads them too (the AMS feed writes "12:53 EDT"): without them zoneOf() would call a
  // channel date in EST "Z" and read its zone-less items in UTC.
  EST: "-0500", EDT: "-0400", CST: "-0600", CDT: "-0500", MST: "-0700", MDT: "-0600", PST: "-0800", PDT: "-0700",
};
const NAMED_ZONE_RE = new RegExp(`\\s(${Object.keys(NAMED_ZONES).join("|")})$`, "i");
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:GMT|UTC|UT|[ECMP][SD]T))$/i;

/** Date.parse's legacy reader takes "Tuesday +0900" for the year 900, so a date outside these years is no date. */
const YEARS = { from: 1990, to: 2100 } as const;

/**
 * A feed's date as an ISO timestamp, or null. A date without a zone takes `zone` (an offset like "+09:00",
 * default UTC), because Date.parse would read it as the machine's local time. Also reads "YYYY-MM-DD HH:mm",
 * a two-digit-year "26-10-30 17:50", a bare date (read as the start of that day in `zone`) and a named zone
 * such as CEST. Text without a digit, or a year outside 1990 to 2100, is null.
 */
export function feedDate(raw: string | undefined, zone = "Z"): string | null {
  let s = typeof raw === "string" ? dateText(raw) : "";
  if (!/\d/.test(s)) return null;
  const named = NAMED_ZONE_RE.exec(s);
  if (named) s = `${s.slice(0, named.index)} ${NAMED_ZONES[named[1]!.toUpperCase()]}`;
  const short = /^(\d{2})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  if (short) s = `20${short[1]}-${short[2]}-${short[3]}T${short[4]}:${short[5]}:00`;
  const spaced = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(.*)/.exec(s);
  if (spaced) s = `${spaced[1]}T${spaced[2]}${spaced[3]!.replace(/^ /, "")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += "T00:00:00";
  if (!HAS_ZONE.test(s)) s = /^\d{4}-\d{2}-\d{2}T/.test(s) ? `${s}${zone}` : `${s} ${zone === "Z" ? "GMT" : zone.replace(":", "")}`;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const year = new Date(t).getUTCFullYear();
  return year < YEARS.from || year > YEARS.to ? null : new Date(t).toISOString();
}

/** The UTC offset a channel's own date is written in ("+09:00"), so its items' zone-less dates can use it; "Z" otherwise. */
export function zoneOf(date: string | undefined): string {
  const s = typeof date === "string" ? dateText(date) : "";
  const named = NAMED_ZONE_RE.exec(s);
  const offset = named ? NAMED_ZONES[named[1]!.toUpperCase()]! : s;
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(offset);
  return m ? `${m[1]}${m[2]}:${m[3]}` : "Z";
}

/**
 * What rssItems() reads from an rss-parser result. Values are unknown: an element with attributes comes
 * back as an object, and feed data is never trusted to be a string.
 */
export interface RssParsed {
  pubDate?: unknown;
  lastBuildDate?: unknown;
  "dc:date"?: unknown;
  "raw-updated"?: unknown;
  items?: {
    title?: unknown; link?: unknown; "rdf:about"?: unknown; guid?: unknown; id?: unknown;
    pubDate?: unknown; date?: unknown; "dc:date"?: unknown; "raw-published"?: unknown; "raw-updated"?: unknown;
    "a10:updated"?: unknown; "atom:updated"?: unknown; "prism:publicationDate"?: unknown;
    contentSnippet?: unknown; summary?: unknown; "content:encodedSnippet"?: unknown;
    "prism:doi"?: unknown; "raw-identifier"?: unknown; "prism:publicationName"?: unknown; source?: unknown; "raw-category"?: unknown;
  }[];
}

/** True when a date string ends in a zone: an offset, Z, GMT, UTC, a US zone or one of NAMED_ZONES. */
function hasZone(date: string): boolean {
  const s = dateText(date);
  return HAS_ZONE.test(s) || NAMED_ZONE_RE.test(s);
}

/**
 * The zone for an item's zone-less dates: the channel date's own offset when it writes one (zoneOf), else
 * `dateZone` (the registry entry's `date_zone`, "+08:00"), else UTC.
 */
export function itemZone(channelDate: string | undefined, dateZone: string | null = null): string {
  if (typeof channelDate === "string" && hasZone(channelDate)) return zoneOf(channelDate);
  return dateZone ?? "Z";
}

/** Every string an element can hold: a value, a list of values (a repeated element) or nothing. */
function textsOf(v: unknown): string[] {
  return (Array.isArray(v) ? v : [v]).flatMap((x) => {
    const t = textOf(x);
    return t === undefined ? [] : [t];
  });
}

/** A `<category>` or Atom `<category term="…"/>` as text: the element's text, else its `term`, else its `label`. */
function categoryText(c: unknown): string | undefined {
  const text = textOf(c);
  if (text !== undefined && text.trim() !== "") return text;
  const attrs = c !== null && typeof c === "object" ? (c as { $?: { term?: unknown; label?: unknown } }).$ : undefined;
  for (const v of [attrs?.term, attrs?.label]) if (typeof v === "string" && v.trim() !== "") return v;
  return undefined;
}

/**
 * Items from an rss-parser result: a title and a link each (the link is the `<link>`, else an RDF item's
 * `rdf:about`), the first readable date, and what the item gives of its abstract, DOI, journal and subject
 * terms. `dateZone` is the registry entry's `date_zone`, used only when the channel's date writes no zone.
 *
 * - **abstract:** the first of the item's `summary` (Atom), its description or Atom content, and
 *   `content:encoded`, whitespace squashed; the description wins over `content:encoded` because it is the
 *   abstract where `content:encoded` can be the whole article. Markup in it is left for `sanitize()`.
 * - **doi:** the first of `prism:doi`, each `dc:identifier`, the `guid` or Atom `id` and the link that reads as
 *   a DOI (`doi:10.…`, a bare DOI or a doi.org address), in §4.1's stored form.
 * - **journal:** `prism:publicationName`, else `dc:source`.
 * - **types:** `[]`: the pack's `types` come from PubMed's `pubtype` only (§4.14).
 */
export function rssItems(parsed: RssParsed, dateZone: string | null = null): RawItem[] {
  const channelDate = [parsed.pubDate, parsed.lastBuildDate, parsed["dc:date"], parsed["raw-updated"]].map(textOf).find((d) => d !== undefined);
  const zone = itemZone(channelDate, dateZone);
  return (Array.isArray(parsed.items) ? parsed.items : []).flatMap((i) => {
    const title = typeof i.title === "string" ? squash(i.title) : "";
    const url = [i.link, i["rdf:about"]].map((l) => (textOf(l) ?? "").trim()).find((l) => l !== "") ?? "";
    if (!title || !url) return [];
    // The first date that reads: an unreadable one is skipped, never the item or the feed.
    const published_at = [i.pubDate, i["raw-published"], i.date, i["dc:date"], i["prism:publicationDate"], i["raw-updated"], i["a10:updated"], i["atom:updated"]]
      .map((d) => feedDate(textOf(d), zone)).find((d) => d !== null) ?? null;
    const abstract = [i.summary, i.contentSnippet, i["content:encodedSnippet"]].map(textOf).map((t) => squash(t ?? "")).find((t) => t !== "") ?? "";
    const doi = [...textsOf(i["prism:doi"]), ...textsOf(i["raw-identifier"]), ...textsOf(i.guid), ...textsOf(i.id), url]
      .map((t) => normalizeDoi(t)).find((d) => d !== null) ?? null;
    const journal = [i["prism:publicationName"], i.source].map(textOf).map((t) => squash(t ?? "")).find((t) => t !== "") ?? null;
    const categories = [...new Set((Array.isArray(i["raw-category"]) ? i["raw-category"] : []).map(categoryText).map((t) => squash(t ?? "")).filter((t) => t !== ""))];
    return [rawItem({ title, url, published_at, abstract, doi, journal, categories })];
  });
}

/**
 * One RSS 2.0, RSS 1.0 (RDF) or Atom body. `newest` is the latest item date; a feed with items but no
 * readable dates has `newest` null (sources:check's NODATE). Anything rss-parser cannot read is "parse".
 * `dateZone` is the registry entry's `date_zone` (rssItems).
 */
export async function parseRss(body: Buffer, dateZone: string | null = null): Promise<Parsed<RawItem>> {
  let parsed: RssParsed;
  try {
    parsed = (await rssParser().parseString(body.toString("utf8"))) as unknown as RssParsed;
  } catch (e) {
    throw new FeedParseError("parse", `RSS: ${(e as Error).message.slice(0, 200)}`);
  }
  const entries = rssItems(parsed, dateZone);
  return { newest: latestOf(entries.map((e) => e.published_at)), entries, version: null, sha256: sha256Hex(body), total: entries.length };
}
