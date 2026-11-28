// The pure half of collect (SPEC §4.14, §8.3): the pack window and the lookback, what a feed's items become on the way to drafts (sanitised
// strings, the `ai-terms.json` match, the field mapping with its fall-through, `isPrimary()`'s test, the stored finding a candidate
// matches, the journal and whether it leads, the injection flags), the feed states, the pack's `degraded` and each feed's `ok`, the pack,
// the pack's part of the run's evidence, the stdout summary and the schema of `logs/D.candidates.json`, the cut list. No clock, file or
// network: scripts/collect.ts does the reading and the writing and hands everything in. Ranking (§5.9) is lib/rank.ts and the Markdown
// is lib/pack-md.ts. Every string from a feed is sanitised before it is stored; nothing in a feed is ever an instruction.
//
// Decisions this file makes where §8.3 leaves a detail open (each is in the report and in SPEC §0.4):
// - The window is `[at(D, window_end) − window_hours, at(D, window_end)]` and an item is kept when its date is in
//   `[start − lookback_hours, end]`, both ends included, as RETURN_NEW_FACT reads the same range (lib/rules/history.ts). A bare date
//   is the Taipei day of that date and is kept when the day overlaps the range. An item with no readable date is dropped (it cannot
//   be placed), and counted.
// - `isDegraded()`: a priority-1 candidate feed failed, or 40% or more of the candidate feeds read failed. A stale feed degrades
//   nothing (the agent is told which feeds are stale). An arXiv feed that read no list (a Sunday or Monday morning, a skipped
//   announcement) has not failed.
// - The AI-phrase match (`must_match`, `ai_terms_matched`) reads the cleaned title and abstract before they are cut, so a phrase that stands
//   after the abstract's 1,000th character still counts (SPEC §4.13: "its title or abstract matches").
// - Candidates from a feed that gives `fields` take them. Any other candidate is mapped in §8.3's order: its OpenAlex topic (the
//   script's lookup, `topics`), its journal (only a journal that lists one field), its arXiv categories (`arxivCategoryField()`);
//   one that no mapping gives a field is dropped and counted. A reaction gets its fields from the candidates it covers (lib/rank.ts).
// - A candidate refused by `candidateRefusal()` (not primary, the wrong kind, a refused article type) is dropped here, before the
//   OpenAlex lookup spends a request on it, and again in ranking (§5.9 step 1).
// - `stored_finding` is matched by DOI, then arXiv id, then trial number, over every stored finding's sources and artefacts; when
//   several findings match, the one that comes first in `compareFindingIds()` order.
//
// Cyber's lib/collect.ts at the fork commit 3ced1fb, adapted: its window, item drafts, dedupe, caps, record builders, feed states, pack
// and Markdown for its own domain's items and records are gone. What stays is the shape: a window function, a draft step that
// sanitises and flags, `feedState()`-style verdicts (here B1's `feedVerdict()`), `isDegraded()`, `packFeeds()`, `buildPack()`, `emptyPack()`,
// `packEvidence()` and `summaryLines()`. The Markdown moved to lib/pack-md.ts and the ranking to lib/rank.ts.

import { z } from "zod";
import type { LoadedConfig } from "./config";
import { at, isValidDate, taipeiTimestamp } from "./dates";
import type { RawItem } from "./feeds/types";
import { byCodeUnit, compareFindingIds } from "./ids";
import { candidateRefusal } from "./primary";
import { arxivIdOf, instantOf, type MergedEntry, type RankDraft } from "./rank";
import { sanitize, sanitizeFlagged, sanitizeUncut } from "./sanitize";
import { ConfigId, Count, FieldId, IsoDate, IsoTimestamp } from "./schema/common";
import type { JournalEntry, RunFile } from "./schema/config";
import type { Evidence } from "./schema/misc";
import { Candidate, Pack, PackFeed, type TimeWindow } from "./schema/pack";
import type { FeedEntry } from "./schema/registry";
import { wordsIn } from "./text";
import { isHttpsUrl, normalizeDoi, normalizeUrl } from "./urls";

// ── Limits ───────────────────────────────────────────────────────────────────────────────────────

/** A sanitised title is cut to this many characters; the abstract's cap is the schema's, 1,000 (§4.14). */
export const TITLE_MAX = 300;
export const ABSTRACT_MAX = 1000;
/** A journal name and an article type are cut to these. */
export const JOURNAL_MAX = 200;
export const TYPE_MAX = 100;
/** The longest address a candidate may have (`safeHref()`'s cap, §7); a longer one is dropped with its item. */
export const URL_MAX = 2000;
/** §8.3's share of the candidate feeds that may fail before the pack is degraded. */
export const DEGRADED_SHARE = 0.4;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ── The window (§8.3) ────────────────────────────────────────────────────────────────────────────

/** `[at(D, window_end) − window_hours, at(D, window_end)]` as Taipei timestamps. */
export function packWindow(date: string, pack: Pick<RunFile["pack"], "window_end" | "window_hours">): TimeWindow {
  const end = at(date, pack.window_end);
  return { start: taipeiTimestamp(new Date(end - pack.window_hours * HOUR_MS)), end: taipeiTimestamp(new Date(end)) };
}

/**
 * True when `publishedAt` is in `[window.start − lookbackHours, window.end]`. A bare date is the Taipei day of that date and counts when
 * the day overlaps that range; a timestamp counts by its instant; text that is neither is out.
 */
export function inRange(publishedAt: string, window: TimeWindow, lookbackHours: number): boolean {
  const from = Date.parse(window.start) - lookbackHours * HOUR_MS;
  const to = Date.parse(window.end);
  if (isValidDate(publishedAt)) {
    const dayStart = instantOf(publishedAt);
    return dayStart + DAY_MS > from && dayStart <= to;
  }
  const t = instantOf(publishedAt);
  return Number.isFinite(t) && t >= from && t <= to;
}

/** A `published_at` as the pack holds it: a bare date stays a date; a timestamp becomes the same instant as Taipei time with its offset. Null when it does not read. */
export function packDate(publishedAt: string): string | null {
  if (isValidDate(publishedAt)) return publishedAt;
  const t = instantOf(publishedAt);
  if (!Number.isFinite(t)) return null;
  const out = taipeiTimestamp(new Date(t));
  return IsoTimestamp.safeParse(out).success ? out : null;
}

// ── The arXiv categories ─────────────────────────────────────────────────────────────────────────

/**
 * The field of an arXiv category (§8.3's last mapping), for a paper a feed with no `fields` gives (`arxiv-stat-ml`, whose papers are
 * mapped by their own categories). `cond-mat.mtrl-sci` and `physics.chem-ph` are chemistry and materials; the rest of `cond-mat`,
 * `astro-ph`, `hep-*`, `gr-qc`, `nucl-*`, `quant-ph`, `nlin` and the rest of `physics` are physics, but `physics.ao-ph` and
 * `physics.geo-ph` are earth, `physics.bio-ph` biology, `physics.soc-ph` social science and `physics.hist-ph` humanities; `math.*`,
 * `math-ph`, `cs.IT` and the statistics theory and methods categories are mathematics; `q-bio.*` is biology; `econ.*`, `q-fin.*` and
 * `cs.CY` are social science. A category of machine learning, computing or anything else maps to no field.
 */
export function arxivCategoryField(category: string): FieldId | null {
  const c = category.trim().toLowerCase();
  if (c === "physics.chem-ph" || c === "cond-mat.mtrl-sci") return "chemistry";
  if (c === "physics.ao-ph" || c === "physics.geo-ph") return "earth";
  if (c === "physics.bio-ph") return "biology";
  if (c === "physics.soc-ph") return "social";
  if (c === "physics.hist-ph") return "humanities";
  if (c === "math-ph" || c === "cs.it" || c === "stat.th" || c === "stat.me" || c === "stat.co" || /^math(?:\.|$)/.test(c)) return "mathematics";
  if (/^q-bio(?:\.|$)/.test(c)) return "biology";
  if (/^(?:econ|q-fin)(?:\.|$)/.test(c) || c === "cs.cy") return "social";
  if (/^(?:physics|cond-mat|astro-ph|nlin)(?:\.|$)/.test(c) || /^(?:hep-|nucl-)/.test(c) || c === "gr-qc" || c === "quant-ph") return "physics";
  return null;
}

/** The fields of some categories, each once, in the order the categories name them. */
export function arxivCategoryFields(categories: readonly string[]): FieldId[] {
  const out: FieldId[] = [];
  for (const c of categories) {
    const f = arxivCategoryField(c);
    if (f !== null && !out.includes(f)) out.push(f);
  }
  return out;
}

// ── Journals ─────────────────────────────────────────────────────────────────────────────────────

/** A journal name as compared: no accents, lower case, `&` as "and", punctuation as one space, no leading "the". */
export function foldJournal(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
}

/** The `journals.json` entry of an item: by the journal id its feed knows, else by the journal name it gives; null when it names none that the file lists. */
export function journalOf(name: string | null, journalId: string | null, journals: readonly JournalEntry[]): JournalEntry | null {
  if (journalId !== null) {
    const byId = journals.find((j) => j.id === journalId);
    if (byId) return byId;
  }
  if (name === null) return null;
  const folded = foldJournal(name);
  return folded === "" ? null : journals.find((j) => foldJournal(j.name) === folded) ?? null;
}

// ── Stored findings ──────────────────────────────────────────────────────────────────────────────

/** The part of a stored finding that identifies it (`Finding` of lib/schema/finding.ts satisfies it). */
export interface StoredFindingLike {
  id: string;
  sources: readonly { url: string; doi: string | null }[];
  artefacts: { doi: readonly string[]; arxiv: readonly string[]; trial: readonly string[] };
}

export interface StoredIndex {
  doi: ReadonlyMap<string, string>;
  arxiv: ReadonlyMap<string, string>;
  trial: ReadonlyMap<string, string>;
}

const TRIAL_IN_URL = /(?<![A-Za-z0-9])NCT\d{8}(?!\d)/gi;

/** The NCT numbers in a text, upper case, each once, in the order they appear. */
export function trialNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![A-Za-z0-9])NCT\d{8}(?!\d)/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

/** The DOIs, arXiv ids and trial numbers a stored finding names in its sources and artefacts, each key to the smallest finding id that names it. */
export function storedIndex(findings: readonly StoredFindingLike[]): StoredIndex {
  const doi = new Map<string, string>();
  const arxiv = new Map<string, string>();
  const trial = new Map<string, string>();
  const put = (map: Map<string, string>, key: string | null, id: string): void => {
    if (key === null) return;
    const have = map.get(key);
    if (have === undefined || compareFindingIds(id, have) < 0) map.set(key, id);
  };
  for (const f of findings) {
    for (const s of f.sources) {
      put(doi, s.doi === null ? null : normalizeDoi(s.doi), f.id);
      put(doi, s.url.includes("doi.org/") ? normalizeDoi(s.url) : null, f.id);
      put(arxiv, arxivIdOf(s.url), f.id);
      for (const n of s.url.match(TRIAL_IN_URL) ?? []) put(trial, n.toUpperCase(), f.id);
    }
    for (const d of f.artefacts.doi) put(doi, normalizeDoi(d), f.id);
    for (const a of f.artefacts.arxiv) put(arxiv, a.trim().replace(/v\d+$/i, ""), f.id);
    for (const t of f.artefacts.trial) put(trial, t.trim().toUpperCase(), f.id);
  }
  return { doi, arxiv, trial };
}

/** The finding a candidate matches by DOI, else arXiv id, else a trial number, or null (§4.14 `stored_finding`). */
export function storedFindingOf(c: { doi: string | null; arxiv: string | null; trial: readonly string[] }, index: StoredIndex): string | null {
  if (c.doi !== null && index.doi.has(c.doi)) return index.doi.get(c.doi)!;
  if (c.arxiv !== null && index.arxiv.has(c.arxiv)) return index.arxiv.get(c.arxiv)!;
  const hits = c.trial.flatMap((t) => (index.trial.has(t) ? [index.trial.get(t)!] : []));
  return hits.sort(compareFindingIds)[0] ?? null;
}

// ── Items to drafts ──────────────────────────────────────────────────────────────────────────────

/** What a feed reader gives collect for one candidate (`FeedItem` of scripts/lib/feeds.ts): the raw item and the two facts the feed's identity adds. */
export interface CollectItem extends RawItem {
  journal_id: string | null;
  kind: "reaction" | null;
}

/** A draft with what the field mapping still needs; `fields` is [] until `mapFields()` runs, unless the feed gave fields. */
export interface DraftWork extends RankDraft {
  categories: string[];
  journal_id: string | null;
  /** True when the feed's registry entry gives `fields` (the draft already has them). */
  own_fields: boolean;
}

/** How a feed's raw items fared on the way to drafts, for the cut list and the log. */
export interface FeedStats {
  id: string;
  items: number;
  undated: number;
  out_of_window: number;
  bad_link: number;
  no_title: number;
  no_ai_term: number;
  refused: number;
  drafted: number;
}

export interface DraftContext {
  window: TimeWindow;
  lookbackHours: number;
  config: Pick<LoadedConfig, "journals" | "sourceTiers" | "labs" | "checkers"> & { index: Pick<LoadedConfig["index"], "aiPhrases"> };
}

/** A feed's link as the pack keeps it: an https address with no space, control character, quote, backtick, angle bracket or backslash, within `URL_MAX`; else null. */
export function safeLink(raw: string): string | null {
  const u = raw.trim();
  if (u.length > URL_MAX || !isHttpsUrl(u) || /[\s\p{Cc}"'`<>\\]/u.test(u)) return null;
  return u;
}

/** An arXiv id with no version, from the id a reader gave or the item's URL or DOI; null when none reads. */
function arxivOf(item: RawItem, doi: string | null): string | null {
  const given = item.arxiv === null ? null : item.arxiv.trim().replace(/v\d+$/i, "");
  if (given !== null && /^\d{4}\.\d{4,5}$/.test(given)) return given;
  return arxivIdOf(item.url) ?? (doi === null ? null : arxivIdOf(doi));
}

/**
 * One registry feed's items as drafts. Each is dated (an undated one cannot be placed), in the lookback range, has an https link,
 * a title, an AI term when the feed has `must_match`, and passes `candidateRefusal()`; its strings are sanitised and flagged, its DOI
 * and arXiv id read, its journal found, and its fields taken from the feed when the registry gives them.
 */
export function toDrafts(entry: Pick<FeedEntry, "id" | "must_match" | "fields">, items: readonly CollectItem[], ctx: DraftContext): { drafts: DraftWork[]; stats: FeedStats } {
  const stats: FeedStats = { id: entry.id, items: items.length, undated: 0, out_of_window: 0, bad_link: 0, no_title: 0, no_ai_term: 0, refused: 0, drafted: 0 };
  const drafts: DraftWork[] = [];
  const phrases = ctx.config.index.aiPhrases;
  for (const raw of items) {
    if (raw.published_at === null) {
      stats.undated += 1;
      continue;
    }
    const published = packDate(raw.published_at);
    if (published === null) {
      stats.undated += 1;
      continue;
    }
    if (!inRange(published, ctx.window, ctx.lookbackHours)) {
      stats.out_of_window += 1;
      continue;
    }
    const url = safeLink(raw.url);
    if (url === null) {
      stats.bad_link += 1;
      continue;
    }
    const title = sanitizeFlagged(raw.title, { max: TITLE_MAX });
    if (title.text === "") {
      stats.no_title += 1;
      continue;
    }
    const abstract = sanitizeFlagged(raw.abstract, { max: ABSTRACT_MAX });
    // The match reads the whole cleaned text, not the cut one: an abstract is cut at 1,000 characters and its AI phrase may stand after the cut.
    const matched = wordsIn(`${sanitizeUncut(raw.title)}\n${sanitizeUncut(raw.abstract)}`, phrases);
    if (entry.must_match && matched.length === 0) {
      stats.no_ai_term += 1;
      continue;
    }
    const types = [...new Set(raw.types.map((t) => sanitize(t, { max: TYPE_MAX })).filter((t) => t !== ""))];
    const reaction = raw.kind === "reaction";
    if (candidateRefusal({ url, types, reaction }, ctx.config) !== null) {
      stats.refused += 1;
      continue;
    }
    const doi = raw.doi === null ? null : normalizeDoi(raw.doi);
    const journalName = raw.journal === null ? null : sanitize(raw.journal, { max: JOURNAL_MAX });
    const journal = journalOf(journalName === "" ? null : journalName, raw.journal_id, ctx.config.journals.journals);
    const flags = title.flags.length > 0 || abstract.flags.length > 0 ? (["injection_like"] as const) : ([] as const);
    drafts.push({
      source_id: entry.id, title: title.text, abstract: abstract.text, url, doi, arxiv: arxivOf(raw, doi),
      trial: trialNumbers(`${title.text}\n${abstract.text}`), published_at: published,
      journal: journalName === null || journalName === "" ? (journal?.name ?? null) : journalName, fields: [...entry.fields],
      ai_terms_matched: matched, journal_leading: journal !== null, types, stored_finding: null, flags: [...flags], reaction,
      categories: [...new Set(raw.categories.map((c) => sanitize(c, { max: TYPE_MAX })).filter((c) => c !== ""))],
      journal_id: raw.journal_id, own_fields: entry.fields.length > 0,
    });
    stats.drafted += 1;
  }
  return { drafts, stats };
}

/**
 * The fields of a draft (§8.3's mapping): a feed's own `fields` stand; else the OpenAlex topic's field when the lookup gave one, else the
 * field of the journal when `journals.json` lists exactly one for it, else the fields of the arXiv categories of an arXiv paper; else
 * none, and the draft is dropped. A reaction has none yet: ranking gives it the fields of the candidates it covers.
 */
export function mapFields(draft: DraftWork, topic: FieldId | undefined, journals: readonly JournalEntry[]): FieldId[] {
  if (draft.reaction) return [];
  if (draft.own_fields) return [...draft.fields];
  if (topic !== undefined) return [topic];
  const journal = journalOf(draft.journal, draft.journal_id, journals);
  if (journal !== null && journal.fields.length === 1) return [journal.fields[0]!];
  return draft.arxiv === null ? [] : arxivCategoryFields(draft.categories);
}

/** True when a draft still needs the OpenAlex lookup: its feed gives no fields, it is no reaction and it holds a DOI. */
export const needsTopic = (d: DraftWork): boolean => !d.own_fields && !d.reaction && d.doi !== null;

/**
 * Gives each draft its fields (and its stored finding) and splits the ones that no mapping gave a field to. `topics` is the lookup's answer
 * by DOI. The result is a `RankDraft` without the mapping's extras.
 */
export function mapDrafts(
  drafts: readonly DraftWork[],
  topics: ReadonlyMap<string, FieldId>,
  stored: StoredIndex,
  journals: readonly JournalEntry[],
): { mapped: RankDraft[]; noField: DraftWork[] } {
  const mapped: RankDraft[] = [];
  const noField: DraftWork[] = [];
  for (const d of drafts) {
    const fields = mapFields(d, d.doi === null ? undefined : topics.get(d.doi), journals);
    if (fields.length === 0 && !d.reaction) {
      noField.push(d);
      continue;
    }
    const { categories: _categories, journal_id: _journalId, own_fields: _own, ...draft } = d;
    mapped.push({ ...draft, fields, stored_finding: storedFindingOf(d, stored) });
  }
  return { mapped, noField };
}

// ── Feed states, degraded, the pack ──────────────────────────────────────────────────────────────

/** The part of `cache/feeds/index.json`'s row that the pack's `feeds` reads (`FeedIndexEntry` of scripts/lib/feed-cache.ts satisfies it). */
export interface IndexRow {
  id: string;
  kind: PackFeed["kind"];
  status: "ok" | "stale" | "failed" | "skipped";
  newest: string | null;
  items: number;
  records: number;
  error_class: string | null;
  sha256: string | null;
}

/**
 * §8.3: the pack is degraded when a priority-1 candidate feed failed, or 40% or more of the candidate feeds read failed. A feed that read nothing for want of
 * a list (an arXiv morning with no announcement) did not fail, and a stale feed degrades nothing.
 */
export function isDegraded(rows: readonly { status: IndexRow["status"]; priority: 1 | 2 | 3 }[]): boolean {
  const read = rows.filter((r) => r.status !== "skipped");
  if (read.some((r) => r.status === "failed" && r.priority === 1)) return true;
  return read.length > 0 && read.filter((r) => r.status === "failed").length / read.length >= DEGRADED_SHARE;
}

/** The pack's `feeds` from the index rows: each feed that was read, `ok` unless it failed, `stale` when it is stale; `items_kept` is how many of its candidates the pack kept. */
export function packFeeds(rows: readonly IndexRow[], keptBy: Readonly<Record<string, number>>): PackFeed[] {
  return rows.filter((r) => r.status !== "skipped").map((r) => ({
    id: r.id, kind: r.kind, ok: r.status !== "failed", stale: r.status === "stale", newest: r.newest, items_total: r.items,
    items_kept: keptBy[r.id] ?? 0, error: r.error_class, sha256: r.sha256,
  }));
}

/** How many of the candidates came from each feed. */
export function keptByFeed(candidates: readonly Pick<Candidate, "source_id">[]): Record<string, number> {
  const by: Record<string, number> = {};
  for (const c of candidates) by[c.source_id] = (by[c.source_id] ?? 0) + 1;
  return Object.fromEntries(Object.entries(by).sort(([a], [b]) => byCodeUnit(a, b)));
}

export interface PackInput {
  date: string;
  window: TimeWindow;
  generatedAt: string;
  /** The time of the arXiv announcement in the window, or null (§4.14). */
  arxivAnnouncement: string | null;
  degraded: boolean;
  feeds: PackFeed[];
  candidates: Candidate[];
}

/** `Pack.parse()` of the input; `injection_flags` counts the candidates that carry a flag. */
export function buildPack(input: PackInput): Pack {
  return Pack.parse({
    schema_version: 1, date: input.date, window: { ...input.window }, generated_at: input.generatedAt, arxiv_announcement: input.arxivAnnouncement,
    degraded: input.degraded, feeds: input.feeds, candidates: input.candidates,
    injection_flags: input.candidates.filter((c) => c.flags.length > 0).length,
  });
}

/** A schema-valid empty pack, degraded (collect failed or ran out of time, §8.2 stage 2). */
export function emptyPack(date: string, window: TimeWindow, generatedAt: string, feeds: PackFeed[] = []): Pack {
  return buildPack({ date, window, generatedAt, arxivAnnouncement: null, degraded: true, feeds, candidates: [] });
}

/** The one-line Markdown of an empty pack. */
export function emptyPackMd(date: string): string {
  return `# Source pack ${date}: DEGRADED, collect gathered nothing (it failed or ran out of time); rely on searches and say the pack was thin.\n`;
}

/** The time of the arXiv announcement of the window: the first feed's that read an entry (the feeds name one list, so they agree), else null. */
export function arxivAnnouncementOf(feeds: readonly { announcement: string | null }[]): string | null {
  return feeds.find((f) => f.announcement !== null)?.announcement ?? null;
}

// ── The pack's part of the run's evidence (§4.12) ────────────────────────────────────────────────

/** `PackEvidence` of scripts/lib/evidence.ts, declared here so that lib/ imports nothing from scripts/. */
export interface PackEvidence {
  urls: string[];
  fetched: string[];
  texts: Record<string, string>;
  seen_as: Record<string, Evidence["seen_as"][string]>;
  types: Record<string, string[]>;
}

/**
 * The pack's contribution to the evidence: every candidate's URL and every merged copy's URL (SPEC §5.9 step 2: a merged candidate keeps every
 * address), seen as "pack", with the candidate's title and abstract as its text and its types. Nothing is "fetched": the pack holds the
 * feed's own words, not the page. Every key is normalised, and a copy's text is its title, since the cut list keeps no more.
 */
export function packEvidence(pack: Pick<Pack, "candidates">, merged: readonly Pick<MergedEntry, "url" | "title" | "types">[] = []): PackEvidence {
  const out: PackEvidence = { urls: [], fetched: [], texts: {}, seen_as: {}, types: {} };
  const add = (rawUrl: string, text: string, types: readonly string[]): void => {
    const u = normalizeUrl(rawUrl);
    if (!(u in out.seen_as)) {
      out.urls.push(u);
      out.seen_as[u] = "pack";
    }
    if (text !== "") out.texts[u] = out.texts[u] === undefined ? text : `${out.texts[u]}\n${text}`;
    if (types.length > 0) out.types[u] = [...new Set([...(out.types[u] ?? []), ...types])];
  };
  for (const c of pack.candidates) add(c.url, [c.title, c.abstract].filter((t) => t !== "").join("\n"), c.types);
  for (const m of merged) add(m.url, m.title, m.types);
  return out;
}

// ── The cut list (logs/D.candidates.json) ────────────────────────────────────────────────────────

const DropReasonSchema = z.string().regex(/^(?:used_doi|used_arxiv|used_url|reaction_alone|not_primary:[a-z_]+)$/, { error: "Expected a drop reason" });

/**
 * `logs/D.candidates.json` (SPEC §8.3, "the cut list"): what ranking did with every candidate collect drafted, in a stable order, so a morning
 * can be explained afterwards. `kept` lists the pack's ids; `merged` holds each copy folded into another candidate (its address too, which
 * `packEvidence()` reads); `cut` those below the cap or in a full field; `dropped` those a brief or a refusal removed, and the reactions that
 * covered nothing; `feeds` how each feed's items fared before ranking, and `no_field` the drafts no mapping gave a field.
 */
export const CandidateLogFile = z.strictObject({
  schema_version: z.literal(1),
  date: IsoDate,
  ranked: Count,
  kept: z.array(z.string().regex(/^cand-\d{2,}$/)),
  merged: z.array(z.strictObject({
    into: z.string().regex(/^cand-\d{2,}$/).nullable(),
    into_url: z.string().min(1),
    source_id: ConfigId,
    url: z.string().min(1),
    title: z.string(),
    doi: z.string().nullable(),
    arxiv: z.string().nullable(),
    published_at: z.string().min(1),
    types: z.array(z.string()),
    reason: z.enum(["doi", "arxiv", "title"]),
  })),
  cut: z.array(z.strictObject({
    source_id: ConfigId,
    url: z.string().min(1),
    title: z.string(),
    score: z.number(),
    reason: z.enum(["below_cap", "field_full"]),
    field: FieldId.nullable(),
  })),
  dropped: z.array(z.strictObject({ source_id: ConfigId, url: z.string().min(1), title: z.string(), reason: DropReasonSchema })),
  no_field: z.array(z.strictObject({ source_id: ConfigId, url: z.string().min(1), title: z.string() })),
  feeds: z.array(z.strictObject({
    id: ConfigId, items: Count, undated: Count, out_of_window: Count, bad_link: Count, no_title: Count, no_ai_term: Count, refused: Count, drafted: Count,
  })),
  log: z.array(z.strictObject({ code: z.enum(["CAP_REACHED", "FIELD_FULL"]), detail: z.string().max(300) })),
});
export type CandidateLogFile = z.infer<typeof CandidateLogFile>;

// ── The stdout summary (§8.3) ────────────────────────────────────────────────────────────────────

/** The lines `collect` prints: the first line, then `Failed:` and `Stale:` when any feed is. */
export function summaryLines(r: { pack: Pack; feeds: readonly Pick<IndexRow, "id" | "status" | "error_class" | "newest">[] }): string[] {
  const read = r.feeds.filter((f) => f.status !== "skipped");
  const answered = read.filter((f) => f.status !== "failed").length;
  const deep = r.pack.candidates.filter((c) => c.deep_read).length;
  const lines = [
    `Pack ${r.pack.date}: ${r.pack.candidates.length} candidates (${deep} to read closely) from ${answered}/${read.length} feeds${r.pack.degraded ? " (DEGRADED)" : ""}.`,
  ];
  const failed = read.filter((f) => f.status === "failed");
  if (failed.length > 0) lines.push(`Failed: ${failed.map((f) => `${f.id} (${f.error_class ?? "error"})`).join(", ")}`);
  const stale = read.filter((f) => f.status === "stale");
  if (stale.length > 0) lines.push(`Stale: ${stale.map((f) => `${f.id} (newest ${f.newest === null ? "none" : f.newest.slice(0, 10)})`).join(", ")}`);
  return lines;
}
