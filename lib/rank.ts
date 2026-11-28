// Candidate ranking (SPEC §5.9, §8.3): turns the candidates collect drafted into at most `candidates_max` ranked, numbered
// ones before the agent reads anything. Pure: no clock, file, network or randomness, and every sort has an explicit
// comparator that ends in the URL, so the same drafts in any order give byte-identical output.
//
// The steps are §5.9's: (1) drop what a brief, an Also noted line or a stored finding's sources already used in the last
// 30 days (by DOI; by arXiv id, read from a source's `arxiv.org/abs/` or `arxiv.org/pdf/` URL or its `10.48550/arxiv.` DOI, with
// no version; or by `normalizeUrl()`), and what fails `candidateRefusal()`; (2) merge duplicates (the same DOI, the same arXiv
// id, or titles with a Jaccard similarity of 0.6 or more), keeping every URL; (3) score; (4) keep the top `candidates_max`, at
// most 10 for each field, mark the top `deep_read_max`, at most 3 for each field, and number them `cand-01`, `cand-02`, ...
//
// Decisions this file makes where §5.9 is silent (each is in the report and in SPEC §0.4):
// - A merged candidate holds one `url`, the survivor's. The other copies' addresses go to `MergedEntry` (the cut list's `merged`,
//   `logs/D.candidates.json`), to the pack's Markdown as "also at" lines and to the run's evidence as pack URLs, so each still
//   counts as seen by the run (§4.12 SOURCE_SEEN; `packEvidence()` in lib/collect.ts).
// - The survivor is the copy with the best base score, then one with a DOI, then the newest, then the smaller URL. It takes the
//   other copies' fields, trial numbers, AI terms, flags and types, and a DOI, arXiv id, journal, abstract or stored finding it
//   lacks.
// - A reaction (a scientist's published reaction, kind `reaction`) is never merged. It is a candidate only when it covers a
//   candidate that is still in the pack (its text names that candidate's DOI, arXiv id or trial number), takes that candidate's
//   fields, scores 0 for its kind, and gives each candidate it covers its +2.
// - The drop in step 1 judges each draft on its own, before the merge, so a journal copy of a paper whose preprint a brief used
//   stays, and the rung watch joins the two (§5.8).
// - A bare date and a timestamp are compared as instants (a bare date is the start of that day in Taipei, as the window test
//   reads it, lib/collect.ts), so "newest first" does not depend on how a feed spells its dates.
//
// Cyber's lib/rank.ts at the fork commit 3ced1fb, adapted: its records, release bundles, vendor matching and its score of
// exploitation signals are gone; the drop, the merge by identifier and by title, the sort with an explicit tie-break, the cap and the
// numbering are Cyber's shape, with this project's scores (§5.9) and the per-field caps.

import { addDays, isValidDate } from "./dates";
import { byCodeUnit, compareFindingIds } from "./ids";
import { candidateRefusal, primaryKindsFor, type CandidateRefusal, type PrimaryConfig } from "./primary";
import type { Candidate } from "./schema/pack";
import { escapeRegExp, jaccard, wordsIn } from "./text";
import { normalizeDoi, normalizeUrl } from "./urls";
import type { FieldId, SourceKind } from "./vocab";

// ── Constants (§5.9) ─────────────────────────────────────────────────────────────────────────────

/** Titles with at least this Jaccard similarity are one candidate (§5.9 step 2). */
export const MERGE_JACCARD = 0.6;
/** The days before the edition whose briefs and sources a candidate may not repeat (§5.9 step 1). */
export const USED_DAYS = 30;
/** At most this many candidates of one field are kept, and at most `DEEP_FIELD_MAX` of them read closely (§5.9 step 4). */
export const FIELD_MAX = 10;
export const DEEP_FIELD_MAX = 3;
/** §5.9 step 3: what an AI term in the title and in the abstract add, and what a covering reaction adds. */
export const TITLE_TERM_BONUS = 2;
export const ABSTRACT_TERM_BONUS = 1;
export const REACTION_BONUS = 2;

/**
 * §5.9 step 3's base score of a kind: a leading-journal paper 5, another peer-reviewed paper 3, a checker's record 4, a lab's own
 * post 3, a preprint 2, an institution's release (`statement`) 2; every other kind (a notice, a registry page, a reaction, a dataset or a
 * proof) 0. `paper` is the one kind whose score depends on the journal.
 */
export function kindScore(kind: SourceKind, journalLeading: boolean): number {
  switch (kind) {
    case "paper": return journalLeading ? 5 : 3;
    case "checker": return 4;
    case "lab_post": return 3;
    case "preprint": return 2;
    case "statement": return 2;
    default: return 0;
  }
}

/** The base score of a candidate: the best of the kinds its URL passes for, `reaction` aside (a reaction is judged by its own rule). */
export function baseScore(url: string, journalLeading: boolean, config: PrimaryConfig, reaction = false): number {
  if (reaction) return 0;
  return primaryKindsFor(url, config).reduce((best, k) => Math.max(best, kindScore(k, journalLeading)), 0);
}

// ── Identifiers ──────────────────────────────────────────────────────────────────────────────────

const ARXIV_URL_RE = /^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?\/?(?:[?#].*)?$/i;
const ARXIV_DOI_RE = /^10\.48550\/arxiv\.(\d{4}\.\d{4,5})(?:v\d+)?$/i;

/** The arXiv id, with no version, of an `arxiv.org/abs/` or `arxiv.org/pdf/` URL or a `10.48550/arxiv.` DOI (any form `normalizeDoi()` reads); null for anything else. */
export function arxivIdOf(text: string): string | null {
  const url = ARXIV_URL_RE.exec(text.trim());
  if (url) return url[1]!;
  const doi = normalizeDoi(text);
  const m = doi === null ? null : ARXIV_DOI_RE.exec(doi);
  return m ? m[1]! : null;
}

/** What a brief, an Also noted line or a stored finding's source used in the last 30 days (§5.9 step 1), every key normalised. */
export interface UsedSources {
  dois: ReadonlySet<string>;
  arxiv: ReadonlySet<string>;
  urls: ReadonlySet<string>;
}

/** An empty `UsedSources`. */
export const noUsedSources = (): UsedSources => ({ dois: new Set(), arxiv: new Set(), urls: new Set() });

/** The part of a source that identifies it. */
interface SourceLike {
  url: string;
  doi: string | null;
  added?: string;
}

/** The part of the stored content the used sources are read from (`Content` of lib/content.ts satisfies it). */
export interface UsedContent {
  briefs: readonly {
    date: string;
    story: { finding_id: string } | null;
    items: readonly { finding_id: string }[];
    sources: readonly SourceLike[];
  }[];
  findings: readonly { id: string; sources: readonly (SourceLike & { added: string })[] }[];
}

/**
 * The sources used in the 30 days before `date` (§5.9 step 1): the sources of each brief dated in [date − 30, date − 1] (its Also
 * noted lines cite them), the sources of each finding such a brief shows as its story or an item, and every finding source added in
 * those days. A brief of `date` or later does not count, so a rerun or a dry run for a past date sees what that morning saw.
 */
export function usedSources(content: UsedContent, date: string, days: number = USED_DAYS): UsedSources {
  const from = addDays(date, -days);
  const used = { dois: new Set<string>(), arxiv: new Set<string>(), urls: new Set<string>() };
  const add = (s: SourceLike): void => {
    used.urls.add(normalizeUrl(s.url));
    const doi = s.doi === null ? null : normalizeDoi(s.doi);
    if (doi !== null) used.dois.add(doi);
    for (const text of [s.url, ...(doi === null ? [] : [doi])]) {
      const id = arxivIdOf(text);
      if (id !== null) used.arxiv.add(id);
    }
  };
  const briefed = new Set<string>();
  for (const b of content.briefs) {
    if (b.date < from || b.date >= date) continue;
    b.sources.forEach(add);
    if (b.story) briefed.add(b.story.finding_id);
    for (const item of b.items) briefed.add(item.finding_id);
  }
  for (const f of content.findings) {
    const shown = briefed.has(f.id);
    for (const s of f.sources) if (shown || (s.added >= from && s.added < date)) add(s);
  }
  return used;
}

// ── The drafts ───────────────────────────────────────────────────────────────────────────────────

/**
 * A candidate before ranking: the pack's `Candidate` without its id, score and `deep_read`, and with whether it is a scientist's
 * reaction. Every string is sanitised already. A reaction's `fields` is `[]` until ranking gives it its candidates' fields.
 */
export interface RankDraft extends Omit<Candidate, "id" | "score" | "deep_read"> {
  reaction: boolean;
}

/** Why step 1 or the reaction rule dropped a draft. */
export type DropReason = "used_doi" | "used_arxiv" | "used_url" | "reaction_alone" | `not_primary:${CandidateRefusal}`;

export interface DroppedEntry {
  source_id: string;
  url: string;
  title: string;
  reason: DropReason;
}

/** A copy folded into another candidate: its address, kept here so that the run still sees it (§5.9 step 2). */
export interface MergedEntry {
  /** The final id of the candidate it joined, or null when that candidate was cut after the merge. */
  into: string | null;
  into_url: string;
  source_id: string;
  url: string;
  title: string;
  doi: string | null;
  arxiv: string | null;
  published_at: string;
  types: string[];
  reason: "doi" | "arxiv" | "title";
}

export type CutReason = "below_cap" | "field_full";

export interface CutRecord {
  source_id: string;
  url: string;
  title: string;
  score: number;
  reason: CutReason;
  /** The first field that was full, for `field_full`; null for `below_cap`. */
  field: FieldId | null;
}

export interface RankLogLine {
  code: "CAP_REACHED" | "FIELD_FULL";
  detail: string;
}

export interface RankInput {
  drafts: readonly RankDraft[];
  used: UsedSources;
  config: PrimaryConfig;
  /** `config/ai-terms.json`'s phrases, all of them (candidate matching uses every phrase, §4.11). */
  aiPhrases: readonly string[];
  limits: { candidates_max: number; deep_read_max: number };
}

export interface RankResult {
  kept: Candidate[];
  /** How many drafts reached the scoring step (after the drops and the merges). */
  ranked: number;
  dropped: DroppedEntry[];
  merged: MergedEntry[];
  cut: CutRecord[];
  log: RankLogLine[];
}

// ── Comparison helpers ───────────────────────────────────────────────────────────────────────────

/** The instant of a `published_at` in epoch ms; a bare date is the start of that day in Taipei; −Infinity for text that does not read. */
export function instantOf(publishedAt: string): number {
  const ms = Date.parse(isValidDate(publishedAt) ? `${publishedAt}T00:00:00+08:00` : publishedAt);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** Newest first, then the URL in code-unit order, then the feed (so two feeds' copies of one URL never tie). */
const byNewest = (a: { published_at: string; url: string; source_id: string }, b: { published_at: string; url: string; source_id: string }): number => {
  const x = instantOf(a.published_at);
  const y = instantOf(b.published_at);
  return (x === y ? 0 : x > y ? -1 : 1) || byCodeUnit(a.url, b.url) || byCodeUnit(a.source_id, b.source_id);
};

/**
 * True when `text` (lower case) names `doi` as a whole DOI: not as the start of a longer one (`10.1038/x1` in `10.1038/x12`, or `10.1038/x-y`) or the tail of a word. A full stop
 * or a closing bracket after it is the sentence's, as long as no DOI character follows the stop.
 */
function doiMentioned(text: string, doi: string): boolean {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(doi)}(?![a-z0-9_/-]|\\.[a-z0-9])`).test(text);
}

/** The reaction's coverage of a candidate: its text holds one of the candidate's DOIs, arXiv ids or trial numbers. */
export function reactionCovers(
  reaction: { title: string; abstract: string; trial: readonly string[] },
  ids: { dois: readonly string[]; arxiv: readonly string[]; trial: readonly string[] },
): boolean {
  const text = `${reaction.title}\n${reaction.abstract}`.toLowerCase();
  if (ids.dois.some((d) => doiMentioned(text, d))) return true;
  if (ids.arxiv.some((a) => new RegExp(`(?<![\\d.])${escapeRegExp(a)}(?!\\d)`).test(text))) return true;
  return ids.trial.some((t) => reaction.trial.includes(t));
}

// ── The work in progress ─────────────────────────────────────────────────────────────────────────

interface Group {
  survivor: RankDraft;
  base: number;
  dois: string[];
  arxiv: string[];
  trial: string[];
  copies: MergedEntry[];
}

const union = <T>(a: readonly T[], b: readonly T[]): T[] => [...a, ...b.filter((x) => !a.includes(x))];

/** The survivor takes what the copy knows and it lacks. */
function absorb(g: Group, copy: RankDraft): void {
  const s = g.survivor;
  s.fields = union(s.fields, copy.fields);
  s.trial = union(s.trial, copy.trial);
  s.ai_terms_matched = union(s.ai_terms_matched, copy.ai_terms_matched);
  s.types = union(s.types, copy.types);
  s.flags = union(s.flags, copy.flags);
  s.journal_leading = s.journal_leading || copy.journal_leading;
  s.doi ??= copy.doi;
  s.arxiv ??= copy.arxiv;
  s.journal ??= copy.journal;
  if (s.abstract === "") s.abstract = copy.abstract;
  s.stored_finding ??= copy.stored_finding;
  g.dois = union(g.dois, copy.doi === null ? [] : [copy.doi]);
  g.arxiv = union(g.arxiv, copy.arxiv === null ? [] : [copy.arxiv]);
  g.trial = union(g.trial, copy.trial);
}

/** Which of §5.9 step 2's tests joins `d` to the group, or null. */
function mergeReason(g: Group, d: RankDraft): MergedEntry["reason"] | null {
  if (d.doi !== null && g.dois.includes(d.doi)) return "doi";
  if (d.arxiv !== null && g.arxiv.includes(d.arxiv)) return "arxiv";
  if (jaccard(g.survivor.title, d.title) >= MERGE_JACCARD) return "title";
  return null;
}

/** Steps 1 and 2: the drafts that pass the drops, merged into groups. Reactions come out apart. */
function dropAndMerge(input: RankInput): { groups: Group[]; reactions: RankDraft[]; dropped: DroppedEntry[] } {
  const dropped: DroppedEntry[] = [];
  const keep: RankDraft[] = [];
  for (const d of input.drafts) {
    const why = dropReason(d, input);
    if (why === null) keep.push(d);
    else dropped.push({ source_id: d.source_id, url: d.url, title: d.title, reason: why });
  }
  const reactions = keep.filter((d) => d.reaction).sort(byNewest);
  const papers = keep.filter((d) => !d.reaction).map((d) => ({ d, base: baseScore(d.url, d.journal_leading, input.config) }));
  // The best copy first, so it is the survivor of its group.
  papers.sort((a, b) => b.base - a.base || Number(b.d.doi !== null) - Number(a.d.doi !== null) || byNewest(a.d, b.d));
  const groups: Group[] = [];
  for (const { d, base } of papers) {
    let joined = false;
    for (const g of groups) {
      const reason = mergeReason(g, d);
      if (reason === null) continue;
      g.copies.push({
        into: null, into_url: g.survivor.url, source_id: d.source_id, url: d.url, title: d.title, doi: d.doi, arxiv: d.arxiv,
        published_at: d.published_at, types: [...d.types], reason,
      });
      absorb(g, d);
      joined = true;
      break;
    }
    if (!joined) {
      groups.push({
        survivor: { ...d, fields: [...d.fields], trial: [...d.trial], ai_terms_matched: [...d.ai_terms_matched], types: [...d.types], flags: [...d.flags] },
        base, dois: d.doi === null ? [] : [d.doi], arxiv: d.arxiv === null ? [] : [d.arxiv], trial: [...d.trial], copies: [],
      });
    }
  }
  return { groups, reactions, dropped };
}

/** Step 1 for one draft: a refusal, or a DOI, arXiv id or URL a brief or a stored finding used in the last 30 days. */
function dropReason(d: RankDraft, input: RankInput): DropReason | null {
  const refusal = candidateRefusal({ url: d.url, types: d.types, reaction: d.reaction }, input.config);
  if (refusal !== null) return `not_primary:${refusal}`;
  if (d.doi !== null && input.used.dois.has(d.doi)) return "used_doi";
  const arxiv = d.arxiv ?? arxivIdOf(d.url) ?? (d.doi === null ? null : arxivIdOf(d.doi));
  if (arxiv !== null && input.used.arxiv.has(arxiv)) return "used_arxiv";
  if (input.used.urls.has(normalizeUrl(d.url))) return "used_url";
  return null;
}

// ── Ranking ──────────────────────────────────────────────────────────────────────────────────────

interface Scored {
  draft: RankDraft;
  score: number;
  copies: MergedEntry[];
}

/** Steps 1 to 4 of §5.9. */
export function rankCandidates(input: RankInput): RankResult {
  const { groups, reactions, dropped } = dropAndMerge(input);
  const phrases = input.aiPhrases;
  const scored: Scored[] = [];
  const covered = new Set<number>();
  const covering: RankDraft[] = [];

  for (const r of reactions) {
    const coveredGroups = groups.flatMap((g, i) => (reactionCovers(r, g) ? [i] : []));
    if (coveredGroups.length === 0) {
      dropped.push({ source_id: r.source_id, url: r.url, title: r.title, reason: "reaction_alone" });
      continue;
    }
    for (const i of coveredGroups) covered.add(i);
    const fields = coveredGroups.reduce<FieldId[]>((all, i) => union(all, groups[i]!.survivor.fields), []);
    covering.push({ ...r, fields });
  }

  groups.forEach((g, i) => {
    const d = g.survivor;
    const score = g.base
      + (wordsIn(d.title, phrases).length > 0 ? TITLE_TERM_BONUS : 0)
      + (wordsIn(d.abstract, phrases).length > 0 ? ABSTRACT_TERM_BONUS : 0)
      + (covered.has(i) ? REACTION_BONUS : 0);
    scored.push({ draft: d, score, copies: g.copies });
  });
  for (const r of covering) {
    const score = (wordsIn(r.title, phrases).length > 0 ? TITLE_TERM_BONUS : 0) + (wordsIn(r.abstract, phrases).length > 0 ? ABSTRACT_TERM_BONUS : 0);
    scored.push({ draft: r, score, copies: [] });
  }
  scored.sort((a, b) => b.score - a.score || byNewest(a.draft, b.draft));

  const cut: CutRecord[] = [];
  const log: RankLogLine[] = [];
  const keptScored: Scored[] = [];
  const perField = new Map<FieldId, number>();
  const fullFields = new Set<FieldId>();
  let capReached = false;
  for (const s of scored) {
    const full = s.draft.fields.find((f) => (perField.get(f) ?? 0) >= FIELD_MAX);
    if (keptScored.length >= input.limits.candidates_max) {
      capReached = true;
      cut.push({ source_id: s.draft.source_id, url: s.draft.url, title: s.draft.title, score: s.score, reason: "below_cap", field: null });
    } else if (full !== undefined) {
      fullFields.add(full);
      cut.push({ source_id: s.draft.source_id, url: s.draft.url, title: s.draft.title, score: s.score, reason: "field_full", field: full });
    } else {
      keptScored.push(s);
      for (const f of s.draft.fields) perField.set(f, (perField.get(f) ?? 0) + 1);
    }
  }
  if (capReached) log.push({ code: "CAP_REACHED", detail: `${keptScored.length} candidates kept; the rest were cut below the cap of ${input.limits.candidates_max}.` });
  for (const f of [...fullFields].sort(byCodeUnit)) log.push({ code: "FIELD_FULL", detail: `${f} held its ${FIELD_MAX} candidates; the lower ones that also carry it were cut.` });

  const deepPerField = new Map<FieldId, number>();
  let deep = 0;
  const kept: Candidate[] = keptScored.map((s, i) => {
    const d = s.draft;
    const deepRead = deep < input.limits.deep_read_max && d.fields.every((f) => (deepPerField.get(f) ?? 0) < DEEP_FIELD_MAX);
    if (deepRead) {
      deep += 1;
      for (const f of d.fields) deepPerField.set(f, (deepPerField.get(f) ?? 0) + 1);
    }
    return {
      id: `cand-${String(i + 1).padStart(2, "0")}`, source_id: d.source_id, title: d.title, abstract: d.abstract, url: d.url, doi: d.doi,
      arxiv: d.arxiv, trial: [...d.trial], published_at: d.published_at, journal: d.journal, fields: [...d.fields],
      ai_terms_matched: [...d.ai_terms_matched], journal_leading: d.journal_leading, types: [...d.types], stored_finding: d.stored_finding,
      flags: [...d.flags], score: s.score, deep_read: deepRead,
    };
  });

  const idOfUrl = new Map(kept.map((c) => [c.url, c.id]));
  const merged = scored.flatMap((s) => s.copies).map((m) => ({ ...m, into: idOfUrl.get(m.into_url) ?? null }));
  merged.sort((a, b) => byCodeUnit(a.into_url, b.into_url) || byCodeUnit(a.url, b.url) || byCodeUnit(a.source_id, b.source_id));
  dropped.sort((a, b) => byCodeUnit(a.url, b.url) || byCodeUnit(a.source_id, b.source_id));
  return { kept, ranked: scored.length, dropped, merged, cut, log };
}

/** Finding ids in `compareFindingIds()` order, the smallest first: the stored finding a candidate matching several is given. */
export function firstFindingId(ids: readonly string[]): string | null {
  return [...ids].sort(compareFindingIds)[0] ?? null;
}
