// Page snapshots (SPEC §4.11 "Where the types come from", §4.12 opening paragraph and step 1, §8.13): one GET per URL whose page the run
// has not read, through fetchFeed(), HTML to text with lib/html-text.ts, results in cache/snapshots/<sha256 of the normalised URL>.json.
// Snapshots stay on Kobol; content/ keeps only a URL and its text hash. Everything read from a page is data, never instructions.
//
// Cyber's scripts/lib/snapshot.ts at the fork commit 3ced1fb, adapted: `Snapshot` keeps `article_types` (what the `type_field` of the
// entry its `final_url` is on finds in the HTML before it becomes text, `articleTypesOf()`, §4.11); a GET that answered an error after
// its redirects writes no snapshot but its final URL is kept in the result's `resolved` (a `doi.org` landing the type check reads,
// even when the landing answered an error); `snapshotUrls()` can run in rounds until every URL has been started (`roundMs`, §8.13: the
// ledger seeder), a URL skipped as a blocked host or as not http(s) never being retried; `citedUnseen()` counts a cited URL whose text
// is only the pack's as unseen until it has a snapshot (§4.12); `citedUntyped()` and `snapshotTargets()` are the other URLs the step
// takes (a `doi.org` URL whose landing the evidence lacks, a typed publisher's or a record's whose types it lacks). The draft's cited
// URLs are the sources of the brief and of its new findings and the `source_url` of its corrections; Cyber's `draft.sources` alone
// is gone. `snapshotHashes()` takes the type `SnapshotHashes` from here, since this project has no lib/apply.ts yet.

import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";
import type { LoadedConfig } from "../../lib/config";
import { taipeiTimestamp } from "../../lib/dates";
import { fetchFeed as realFetchFeed, pool } from "../../lib/feeds/http";
import { htmlText, textSha256 } from "../../lib/html-text";
import { jsonText, sha256Hex } from "../../lib/json";
import { typeFieldFor, typePlanFor } from "../../lib/primary";
import { sanitizeChars } from "../../lib/sanitize";
import { typeFieldKind } from "../../lib/schema/config";
import type { Evidence } from "../../lib/schema/misc";
import { blockedEntry, normalizeUrl } from "../../lib/urls";
import type { Clock } from "./clock";

/** §4.12: 15 s per GET, 5 redirects, the body cut at 3 MB, 6 at a time, 3 minutes per round (`P3_LIMITS.snapshotRoundMs` is the morning's). */
export const SNAPSHOT_LIMITS = { timeoutMs: 15_000, redirects: 5, maxBytes: 3 * 1024 * 1024, concurrency: 6, roundMs: 3 * 60_000 } as const;

/** The browser-like Accept and Accept-Language a snapshot GET sends (§4.12), with run.json `user_agent`. */
export const SNAPSHOT_HEADERS = { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", acceptLanguage: "en-US,en;q=0.9" } as const;

/** At most this many article types a snapshot keeps, each at most `ARTICLE_TYPE_MAX` characters (a page is data: it cannot make a long list). */
export const ARTICLE_TYPES_MAX = 8;
export const ARTICLE_TYPE_MAX = 100;

/** cache/snapshots/<sha256(normalizeUrl(url))>.json */
export interface Snapshot {
  url: string;
  final_url: string;
  status: number;
  fetched_at: string;
  content_type: string;
  text_sha256: string;
  /** What the `type_field` of the entry `final_url` is on finds in the HTML (`articleTypesOf()`); [] when that entry has none or the page shows none. */
  article_types: string[];
  text: string;
}

/** Normalised URL to the text hash and fetch time of its snapshot, for the archive index (§4.10). */
export type SnapshotHashes = Record<string, { sha256: string; fetched_at: string }>;

/** cache/snapshots/ under the repository root `root`. */
function snapshotsDir(root: string): string {
  return path.join(path.resolve(root), "cache", "snapshots");
}

/** cache/snapshots/<sha256(normalizeUrl(url))>.json */
export function snapshotFile(root: string, url: string): string {
  return path.join(snapshotsDir(root), `${sha256Hex(normalizeUrl(url))}.json`);
}

const isSnapshot = (x: unknown): x is Omit<Snapshot, "article_types"> & { article_types?: unknown } => {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return ["url", "final_url", "fetched_at", "content_type", "text_sha256", "text"].every((k) => typeof o[k] === "string")
    && typeof o.status === "number" && Number.isInteger(o.status);
};

/**
 * The stored snapshot of `url` (matched on the normalised URL); null when absent, unreadable or not a snapshot. A file with no
 * `article_types` (or one that is no list of strings) reads as having none.
 */
export function readSnapshot(root: string, url: string): Snapshot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(snapshotFile(root, url), "utf8"));
  } catch {
    return null;
  }
  if (!isSnapshot(raw) || normalizeUrl(raw.url) !== normalizeUrl(url)) return null;
  const types = Array.isArray(raw.article_types) && raw.article_types.every((t) => typeof t === "string") ? (raw.article_types as string[]) : [];
  return {
    url: raw.url, final_url: raw.final_url, status: raw.status, fetched_at: raw.fetched_at, content_type: raw.content_type,
    text_sha256: raw.text_sha256, article_types: [...types], text: raw.text,
  };
}

// ── What a draft cites ───────────────────────────────────────────────────────────────────────────

/**
 * The URLs a draft cites (§4.11): the `url` of each source of the brief (`sources`), of each new finding (`new_findings[].sources`) and
 * the `source_url` of each correction that is not null, once for each normalised URL, each exactly as the draft stores it (the snapshot
 * requests that string), in that order. Reads unknown input defensively: a part that is no list, and an entry with no string URL,
 * adds nothing.
 */
export function citedUrls(draft: unknown): string[] {
  const d = draft && typeof draft === "object" ? (draft as Record<string, unknown>) : {};
  const urlOf = (x: unknown, key: string): unknown => (x && typeof x === "object" ? (x as Record<string, unknown>)[key] : undefined);
  const listOf = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  const raw: unknown[] = [
    ...listOf(d.sources).map((s) => urlOf(s, "url")),
    ...listOf(d.new_findings).flatMap((f) => listOf(urlOf(f, "sources")).map((s) => urlOf(s, "url"))),
    ...listOf(d.corrections).map((c) => urlOf(c, "source_url")),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of raw) {
    if (typeof url !== "string" || url.trim() === "") continue;
    const key = normalizeUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/**
 * The cited URLs whose normalised form has no text the run could read yet (Cyber's `citedUnseen()`): no evidence text, or a text that
 * is only the pack's, which counts as none until the URL has a snapshot (`snapshots`, §4.12), so the step takes it and a quote beyond
 * the pack's abstract can match. A URL is "only the pack's" when the evidence marks it `seen_as` "pack".
 */
export function citedUnseen(draft: unknown, evidence: Evidence | null, snapshots: readonly Pick<Snapshot, "url">[] = []): string[] {
  const texts = evidence?.texts ?? {};
  const seenAs = evidence?.seen_as ?? {};
  const snapped = new Set(snapshots.map((s) => normalizeUrl(s.url)));
  return citedUrls(draft).filter((url) => {
    const key = normalizeUrl(url);
    const text = Object.hasOwn(texts, key) ? texts[key] : undefined;
    if (typeof text !== "string" || text === "") return true;
    return Object.hasOwn(seenAs, key) && seenAs[key] === "pack" && !snapped.has(key);
  });
}

/**
 * The cited URLs the type check lacks input for (§4.11): a `doi.org` URL whose landing (`resolved`) the evidence lacks, and a URL on
 * PubMed, PMC or a publisher whose `type_field` is set, whose `types` the evidence lacks. A URL the type check ignores is never listed.
 */
export function citedUntyped(draft: unknown, evidence: Evidence | null, config: Pick<LoadedConfig, "sourceTiers">): string[] {
  return citedUrls(draft).filter((url) => {
    const key = normalizeUrl(url);
    const plan = typePlanFor(url, config);
    if (plan.branch === "none") return false;
    if (plan.branch === "doi") return evidence === null || !Object.hasOwn(evidence.resolved, key);
    return evidence === null || !Object.hasOwn(evidence.types, key) || evidence.types[key]!.length === 0;
  });
}

/** What the snapshot step requests: the cited URLs that `citedUnseen()` or `citedUntyped()` lists, once for each normalised URL, in the draft's order, each as the draft stores it. */
export function snapshotTargets(
  draft: unknown, evidence: Evidence | null, config: Pick<LoadedConfig, "sourceTiers">, snapshots: readonly Pick<Snapshot, "url">[] = [],
): string[] {
  const wanted = new Set([...citedUnseen(draft, evidence, snapshots), ...citedUntyped(draft, evidence, config)].map(normalizeUrl));
  return citedUrls(draft).filter((url) => wanted.has(normalizeUrl(url)));
}

// ── Article types ────────────────────────────────────────────────────────────────────────────────

/**
 * What the `type_field` of the entry `finalUrl` is on (`typeFieldFor()`) finds in `html`, before it becomes text (§4.11): for a
 * `<meta>` tag's name, the `content` of each tag of that name (compared without case); for a CSS selector, the text of each element it
 * matches. Each value is sanitised, its white space collapsed, cut at ARTICLE_TYPE_MAX characters and kept once, up to
 * ARTICLE_TYPES_MAX, in page order. [] when the URL is on no entry with a `type_field`, or the selector does not parse.
 */
export function articleTypesOf(html: string, finalUrl: string, config: Pick<LoadedConfig, "sourceTiers">): string[] {
  const field = typeFieldFor(finalUrl, config);
  if (field === null) return [];
  const $ = load(html);
  let found: string[];
  try {
    found = typeFieldKind(field) === "meta"
      ? $("meta").toArray().filter((el) => (el.attribs.name ?? "").toLowerCase() === field.toLowerCase()).map((el) => el.attribs.content ?? "")
      : $(field).toArray().map((el) => $(el).text());
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const value of found) {
    const type = sanitizeChars(value).replace(/\s+/gu, " ").trim().slice(0, ARTICLE_TYPE_MAX).trim();
    if (type === "" || out.includes(type)) continue;
    out.push(type);
    if (out.length === ARTICLE_TYPES_MAX) break;
  }
  return out;
}

// ── The GETs ─────────────────────────────────────────────────────────────────────────────────────

const HTML_TYPE = /^\s*(?:text\/html|application\/xhtml\+xml)\b/i;
const HTML_SNIFF = /^\s*(?:<!doctype\s+html|<html[\s>])/i;

/** The body as text in the charset its Content-Type names (UTF-8 when none or unknown). */
function decode(body: Buffer, contentType: string | null): string {
  const charset = /charset\s*=\s*"?([\w.-]+)/i.exec(contentType ?? "")?.[1];
  if (charset) {
    try {
      return new TextDecoder(charset).decode(body);
    } catch {
      // an unknown label: read as UTF-8
    }
  }
  return new TextDecoder("utf-8").decode(body);
}

export interface SnapshotOptions {
  root: string;
  urls: readonly string[];
  /** Epoch ms on the `Date.now()` clock (pass `realDeadline()`): no request starts at or after it. */
  deadline: number;
  config: Pick<LoadedConfig, "run" | "sourceTiers">;
  fetch?: typeof realFetchFeed;
  log?: (line: string) => void;
  /** The run's clock, for `fetched_at` (Taipei time). Default `Date.now`. */
  now?: Clock;
  /**
   * Run in rounds of this many ms (each ends at `min(deadline, start + roundMs)`) until every URL has been started or `deadline` has
   * passed; a URL not started in a round starts the next one. Absent: one round, and a URL it does not start is `skipped`.
   */
  roundMs?: number;
}

export interface SnapshotResult {
  /** The snapshots written. */
  taken: Snapshot[];
  /** The URLs whose GET was started and gave no snapshot: a fetch error, an error answer, or an answer that is not HTML (a PDF gets none, §4.12). */
  failed: string[];
  /**
   * The URLs never requested: a blocked host, a URL that is not http(s), a repeat of a normalised URL already in the call, and, in
   * the last round, one not started before the deadline. A blocked or non-http(s) URL is never retried.
   */
  skipped: string[];
  /** Normalised URL to the final URL of its GET, for every URL started (read or not) whose final URL differs from it (§4.11 `resolved`). */
  resolved: Record<string, string>;
}

interface Round {
  taken: Snapshot[];
  failed: string[];
  unstarted: string[];
  resolved: Record<string, string>;
}

async function oneRound(o: SnapshotOptions, queue: readonly string[], deadline: number): Promise<Round> {
  const fetch = o.fetch ?? realFetchFeed;
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  const results = await pool(queue, SNAPSHOT_LIMITS.concurrency, async (url): Promise<{ url: string; snap: Snapshot | null; started: boolean; final: string | null }> => {
    if (Date.now() >= deadline) return { url, snap: null, started: false, final: null };
    const r = await fetch(url, {
      accept: SNAPSHOT_HEADERS.accept,
      acceptLanguage: SNAPSHOT_HEADERS.acceptLanguage,
      userAgent: o.config.run.user_agent,
      timeoutMs: SNAPSHOT_LIMITS.timeoutMs,
      maxBytes: SNAPSHOT_LIMITS.maxBytes,
      truncate: true,
      // The call's own deadline cuts a request, never a round's end: a round only decides what starts, so a URL started late in a round is
      // given its 15 s (with `roundMs` the round's end would cut it short, and a started URL that gave no snapshot is never retried).
      deadline: o.deadline,
      // A redirect into a blocked host ends the fetch before that hop (§4.12 step 1: BLOCKED_HOSTS are never fetched).
      refuseRedirect: (hop) => blockedEntry(hop)?.reason ?? null,
    });
    if (!r.ok || !r.body || r.status === null) {
      log(`snapshot: ${url} not read (${r.error ?? "network"}${r.status ? `, HTTP ${r.status}` : ""}).`);
      return { url, snap: null, started: true, final: r.finalUrl };
    }
    const html = HTML_TYPE.test(r.contentType ?? "") || (!r.contentType && HTML_SNIFF.test(r.body.subarray(0, 512).toString("latin1")));
    if (!html) {
      log(`snapshot: ${url} is not HTML (${(r.contentType ?? "no content type").slice(0, 80)}); no snapshot.`);
      return { url, snap: null, started: true, final: r.finalUrl };
    }
    const source = decode(r.body, r.contentType);
    const text = htmlText(source);
    const snap: Snapshot = {
      url, final_url: r.finalUrl, status: r.status, fetched_at: taipeiTimestamp(new Date(now())),
      content_type: r.contentType || "text/html", text_sha256: textSha256(text), article_types: articleTypesOf(source, r.finalUrl, o.config), text,
    };
    const file = snapshotFile(o.root, url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, jsonText(snap));
    fs.renameSync(tmp, file);
    return { url, snap, started: true, final: r.finalUrl };
  });
  const round: Round = { taken: [], failed: [], unstarted: [], resolved: {} };
  for (const r of results) {
    if (!r.started) {
      round.unstarted.push(r.url);
      continue;
    }
    if (r.snap) round.taken.push(r.snap);
    else round.failed.push(r.url);
    if (r.final !== null && normalizeUrl(r.final) !== normalizeUrl(r.url)) round.resolved[normalizeUrl(r.url)] = r.final;
  }
  return round;
}

/**
 * GETs `urls` through fetchFeed() (SNAPSHOT_HEADERS, run.json `user_agent`), HTML only, 6 at a time, no request started at or after
 * the round's deadline. A blocked host is skipped, and a redirect into one fails the URL with `redirects` before that hop is requested.
 * Each URL is requested exactly as the draft stores it; normalizeUrl() is used only for keys and file names. Writes each snapshot file
 * (atomically). Without `roundMs` this is one round (Cyber's), and a URL it did not start is `skipped`; with it, the rounds of
 * `SnapshotOptions.roundMs`, until every URL has been started or the deadline has passed.
 */
export async function snapshotUrls(o: SnapshotOptions): Promise<SnapshotResult> {
  if (o.roundMs !== undefined && !(o.roundMs > 0)) throw new RangeError(`snapshotUrls: roundMs must be above 0, got ${o.roundMs}`);
  const log = o.log ?? (() => {});
  const skipped: string[] = [];
  let queue: string[] = [];
  const keys = new Set<string>();
  for (const url of o.urls) {
    const key = normalizeUrl(url);
    let ok: boolean;
    try {
      const u = new URL(url);
      ok = u.protocol === "https:" || u.protocol === "http:";
    } catch {
      ok = false;
    }
    if (!ok || keys.has(key)) {
      skipped.push(url);
      continue;
    }
    keys.add(key);
    const blocked = blockedEntry(url);
    if (blocked) {
      log(`snapshot: skipped a blocked host (${blocked.reason}).`);
      skipped.push(url);
      continue;
    }
    queue.push(url);
  }

  const taken: Snapshot[] = [];
  const failed: string[] = [];
  const resolved: Record<string, string> = {};
  for (;;) {
    const deadline = o.roundMs === undefined ? o.deadline : Math.min(o.deadline, Date.now() + o.roundMs);
    const round = await oneRound(o, queue, deadline);
    taken.push(...round.taken);
    failed.push(...round.failed);
    Object.assign(resolved, round.resolved);
    queue = round.unstarted;
    if (queue.length === 0) break;
    log(`snapshot: ${queue.length} URL${queue.length === 1 ? "" : "s"} not started before the round's deadline.`);
    if (o.roundMs === undefined || Date.now() >= o.deadline) {
      skipped.push(...queue);
      break;
    }
  }
  return { taken, failed, skipped, resolved };
}

/** Normalised URL to { sha256: text_sha256, fetched_at } for the archive index (§4.10); a later snapshot of a URL wins. */
export function snapshotHashes(snaps: readonly Snapshot[]): SnapshotHashes {
  const out: SnapshotHashes = {};
  for (const s of snaps) out[normalizeUrl(s.url)] = { sha256: s.text_sha256, fetched_at: s.fetched_at };
  return out;
}
