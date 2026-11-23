// Shared helpers for the rule groups (SPEC §4.12): what several groups read the same way and none should write twice. No rule
// logic lives here and nothing is judged: each helper answers a question about the input (which edition is this, which
// findings does it show, where is the source `b2` of a returning entry, what does the run's evidence hold for a URL, which
// strings belong to this finding) from the views (views.ts) and the string inventory (strings.ts).
//
//   Guards and editions   isDraft(), isPublished(), isZh(), isBrief(), editionKindOf(), isMondayEdition(), SHORT_WEEK
//   Findings              shownItems(), shownFindings(), newFindings(), isNewRef(), shownDepthOf(), draftRungEntries(), publishingFindings()
//   Source containers     sourceContainers(), citations(), resolveSource(), extendPath()
//   Evidence and the pack lacksInput(), evidenceOf(), seenText(), inEvidence(), packDatesOf()
//   Strings               stringsOf(), stringsAbout(), onlyPublishing(), pageProseOf(), isLandmarkText()
//
// Cyber's lib/rules/shared.ts at the fork commit 3ced1fb, adapted: `isBrief()`, `editionKind()`, `seenText()`, `inEvidence()`
// and `packDatesOf()` (which was in Cyber's lib/validate.ts) are Cyber's, reading this project's inputs; Cyber's field walkers,
// `derive()`, publisher folding and known names belong to Cyber's domain parts and are replaced by the views and the inventory.

import { displayOrder } from "../items";
import type { Brief } from "../schema/brief";
import { ID_PATTERNS } from "../schema/common";
import type { Pack } from "../schema/pack";
import { normalizeUrl } from "../urls";
import type { Format } from "../vocab";
import { pageProse, type StringEntry } from "./strings";
import { formatPath, type DraftInput, type EditionKind, type Evidence, type PublishedInput, type RuleInput, type RuleNeed, type ZhInput } from "./types";
import type { FindingView, ItemView, RungView, SourceView, Views } from "./views";

export { contextFindingIds } from "./views";

// ── Guards and editions ──────────────────────────────────────────────────────────────────────────

export const isDraft = (input: RuleInput): input is DraftInput => input.mode === "draft";
export const isPublished = (input: RuleInput): input is PublishedInput => input.mode === "published";
export const isZh = (input: RuleInput): input is ZhInput => input.mode === "zh";

/** True for a stored `Brief`: it has the keys a draft never has (`edition` and `computed`, §4.5). */
export function isBrief(value: unknown): value is Brief {
  return typeof value === "object" && value !== null && "edition" in value && "computed" in value;
}

/** A Monday review of a week with fewer than this many findings has the short big picture (SPEC §4.5, §4.12's word budgets). */
export const SHORT_WEEK = 3;

/**
 * What kind of edition the rules judge. `format` is the weekday's format (null when no brief is judged, which gives `none`);
 * `dataOnly` is a stored brief whose `edition` is `data_only`; `weekFindings` is the number of findings of the context's
 * `week`, known in draft mode only, which tells a short Monday (fewer than SHORT_WEEK) from a full one; a stored Monday is
 * `monday` whichever big picture it has (SPEC §4.12: "a stored brief may have either").
 */
export function editionKindOf(args: { format: Format | null; dataOnly?: boolean; weekFindings?: number | null }): EditionKind {
  if (args.format === null) return "none";
  if (args.dataOnly === true) return "data-only";
  if (args.format === "daily") return "weekday";
  if (args.format === "sunday_deep_dive") return "sunday";
  return args.weekFindings !== undefined && args.weekFindings !== null && args.weekFindings < SHORT_WEEK ? "short-monday" : "monday";
}

/** A Monday review, full or short: the editions that carry a `review`. */
export const isMondayEdition = (edition: EditionKind): boolean => edition === "monday" || edition === "short-monday";

// ── Findings ─────────────────────────────────────────────────────────────────────────────────────

export const isNewRef = (key: string): boolean => ID_PATTERNS.newRef.test(key);

/** The story, then the items, as lib/items.ts `displayOrder()` orders them (SPEC §4.5). */
export const shownItems = (views: Views): ItemView[] => displayOrder(views.brief.story, views.brief.items);

/** The finding views of `shownItems()`, in display order; an item whose finding has no view (an unknown ref or id) is left out. */
export function shownFindings(views: Views): FindingView[] {
  return shownItems(views).flatMap((item) => (item.finding === null ? [] : [item.finding]));
}

/** The new findings of a draft, in `new_findings` order (none in a stored brief, whose findings are all stored records). */
export const newFindings = (views: Views): FindingView[] => views.findings.filter((f) => f.origin === "new");

/**
 * How the page shows each finding that is new in this edition, `story` or `item`; any other finding gets null, since the page
 * does not repeat a returning finding's text (WORDS' page total, SPEC §4.5). The argument of `pageProse()`.
 */
export function shownDepthOf(views: Views): (key: string) => "story" | "item" | null {
  const depth = new Map<string, "story" | "item">();
  for (const item of shownItems(views)) if (item.new) depth.set(item.key, item.slot);
  return (key) => depth.get(key) ?? null;
}

/**
 * The rung entries a draft adds to a stored finding, in the order it writes them: the returning entry's, then the rung
 * changes' (SPEC §4.5). A new finding's own entries are in its `rung_history`; a stored brief has none of these.
 */
export function draftRungEntries(views: Views, key: string): RungView[] {
  const entries: RungView[] = [];
  for (const r of views.brief.returning) if (r.finding_id === key && r.rung !== null) entries.push(r.rung);
  for (const c of views.brief.rung_changes) if (c.finding_id === key && c.rung !== null) entries.push(c.rung);
  return entries;
}

/** The findings whose records are being judged against `config/`: a new finding of a draft, or a stored finding being published. */
export const publishingFindings = (views: Views): FindingView[] => views.findings.filter((f) => f.publishing && f.basis !== "context");

// ── Source containers ────────────────────────────────────────────────────────────────────────────

/** A list of sources that cites by id: a finding's own `s1`... or the brief's `b1`... (SPEC §4.3). */
export interface SourceContainer {
  readonly scope: "finding" | "brief";
  readonly prefix: "s" | "b";
  /** The finding that owns it; null for the brief's. */
  readonly owner: FindingView | null;
  /** In listed order; null when the container is not known (a stored finding seen through a context that lacks its sources). */
  readonly sources: readonly SourceView[] | null;
  /** Where the list sits, for an issue path: `new_findings[0].sources`, `sources`, `findings/<id>.json: sources`. */
  readonly where: string;
  /** True in draft mode and for the record being published: the tests that read `config/` run on it alone (SPEC §4.12 "Stored records"). */
  readonly publishing: boolean;
}

/**
 * The containers the run judges: the sources of each new finding (draft) or stored record (published), then the brief's. A
 * stored finding that the draft only names, which the context shows, has no container of its own to judge.
 */
export function sourceContainers(views: Views): SourceContainer[] {
  const own = views.findings
    .filter((f) => f.basis !== "context")
    .map((f): SourceContainer => ({ scope: "finding", prefix: "s", owner: f, sources: f.sources, where: f.where("sources"), publishing: f.publishing }));
  return [...own, {
    scope: "brief", prefix: "b", owner: null, sources: views.brief.sources, where: views.brief.where("sources"), publishing: views.brief.publishing,
  }];
}

/** `base` with a path appended: `extendPath("returning[0]", "source_ids", 1)` is `returning[0].source_ids[1]`; with no segments, `base`. */
export function extendPath(base: string, ...segments: readonly (string | number)[]): string {
  if (segments.length === 0) return base;
  const tail = formatPath(segments);
  if (base === "(root)") return tail;
  return tail.startsWith("[") ? base + tail : `${base}.${tail}`;
}

export type CitationRole =
  | "go_deeper" | "rung" | "evidence" | "reaction" | "figure" | "since_then" | "returning" | "rung_change" | "idea" | "also"
  | "deep_dive" | "against";

/** One place that cites a source by id. */
export interface SourceCitation {
  readonly id: string;
  /** The issue path of the cited id. */
  readonly path: string;
  readonly role: CitationRole;
  /** The finding the citation is about: the one whose record cites, or a returning or rung entry's; null at brief level. */
  readonly owner: FindingView | null;
  /** Where the id must be found: a finding's own list, the brief's, or either (a draft's returning and rung entries, SPEC §4.5). */
  readonly form: "finding" | "brief" | "either";
}

/**
 * Every source id the run cites, in a fixed order: each new or stored finding's own record (Go deeper, rung entries, evidence,
 * reactions, figure, Since then), then the draft's returning and rung-change entries, then the brief-level text (ideas, Also
 * noted lines, the deep dive and the strongest evidence against).
 */
export function citations(views: Views): SourceCitation[] {
  const out: SourceCitation[] = [];
  for (const f of views.findings) {
    if (f.basis === "context") continue;
    const own = (id: string, path: string, role: CitationRole): void => {
      out.push({ id, path, role, owner: f, form: "finding" });
    };
    (f.go_deeper ?? []).forEach((id, i) => own(id, f.where(`go_deeper.${i}`), "go_deeper"));
    for (const r of f.rung_history ?? []) own(r.source_id, extendPath(r.where, "source_id"), "rung");
    for (const e of f.ai?.evidence ?? []) own(e.source_id, extendPath(e.where, "source_id"), "evidence");
    for (const r of f.reactions ?? []) own(r.source_id, extendPath(r.where, "source_id"), "reaction");
    if (f.figure !== null) own(f.figure.source_id, extendPath(f.figure.where, "source_id"), "figure");
    for (const s of f.since_then ?? []) s.source_ids.forEach((id, j) => own(id, extendPath(s.where, "source_ids", j), "since_then"));
  }
  const brief = views.brief;
  for (const r of brief.returning) {
    const owner = views.find(r.finding_id);
    r.source_ids.forEach((id, j) => out.push({ id, path: extendPath(r.where, "source_ids", j), role: "returning", owner, form: "either" }));
    if (r.rung !== null) out.push({ id: r.rung.source_id, path: extendPath(r.rung.where, "source_id"), role: "rung", owner, form: "either" });
  }
  for (const c of brief.rung_changes) {
    if (c.rung === null) continue;
    out.push({ id: c.rung.source_id, path: extendPath(c.rung.where, "source_id"), role: "rung_change", owner: views.find(c.finding_id), form: "either" });
  }
  const own = (id: string, path: string, role: CitationRole): void => {
    out.push({ id, path, role, owner: null, form: "brief" });
  };
  for (const x of brief.ideas) own(x.source_id, extendPath(x.where, "source_id"), "idea");
  for (const x of brief.also) own(x.source_id, extendPath(x.where, "source_id"), "also");
  if (brief.deep_dive !== null) {
    brief.deep_dive.source_ids.forEach((id, j) => own(id, extendPath(brief.deep_dive!.where, "source_ids", j), "deep_dive"));
  }
  if (brief.review !== null) {
    brief.review.strongest_against.source_ids.forEach((id, j) => own(id, extendPath(brief.review!.where, "strongest_against", "source_ids", j), "against"));
  }
  return out;
}

export interface ResolvedSource {
  readonly source: SourceView | null;
  /** False when the id's container is not known (an `s` id of a stored finding that the context does not show): `source` is then null whatever the id. */
  readonly known: boolean;
}

/**
 * Finds the source `id` names: a `b` id in the brief's sources, an `s` id in the owner's own. A returning or rung entry may
 * name either (SPEC §4.5), so the prefix decides, not the entry. With no owner an `s` id has no container and is not found.
 */
export function resolveSource(views: Views, owner: FindingView | null, id: string): ResolvedSource {
  if (ID_PATTERNS.briefSource.test(id)) return { source: views.brief.sources.find((s) => s.id === id) ?? null, known: true };
  if (owner === null) return { source: null, known: true };
  if (owner.sources === null) return { source: null, known: false };
  return { source: owner.sources.find((s) => s.id === id) ?? null, known: true };
}

// ── Evidence and the pack ────────────────────────────────────────────────────────────────────────

/**
 * True when the run lacks the input `need` names, so the part of a rule that reads it cannot run: a rule that declares it in
 * `uses` calls this and skips that part (the engine reports it). Only a draft carries all three inputs and the Chinese pass has
 * evidence alone; published mode never lacks one, because a rule that reads the run's inputs is a draft-mode check
 * (SPEC §4.12 "Stored records"): such a rule reads them under `isDraft(input)` and `uses` only.
 */
export function lacksInput(input: RuleInput, need: RuleNeed): boolean {
  if (input.mode === "draft") return input.draft[need] === null;
  if (input.mode === "zh") return need === "evidence" && input.zh.evidence === null;
  return false;
}

/** The run's evidence: the English draft's, or the Chinese pass's (null when there is none, and always in published mode). */
export function evidenceOf(input: RuleInput): Evidence | null {
  if (input.mode === "draft") return input.draft.evidence;
  if (input.mode === "zh") return input.zh.evidence;
  return null;
}

/**
 * The text the run saw at a URL: `evidence.texts[normalizeUrl(url)]` or "" (also with no evidence). The evidence already holds
 * a pack URL's text as the pack's followed by its snapshot's (SPEC §4.12), so a quote from the page beyond the pack's
 * abstract can match. An own property only, so a URL such as "constructor" never reads Object.prototype.
 */
export function seenText(input: RuleInput, url: string): string {
  const texts = evidenceOf(input)?.texts;
  const key = normalizeUrl(url);
  if (!texts || !Object.hasOwn(texts, key)) return "";
  const text: unknown = texts[key];
  return typeof text === "string" ? text : "";
}

/** True when the evidence lists the URL (`evidence.urls`, normalised); false with no evidence. */
export function inEvidence(input: RuleInput, url: string): boolean {
  const evidence = evidenceOf(input);
  if (evidence === null) return false;
  const want = normalizeUrl(url);
  return evidence.urls.some((u) => normalizeUrl(u) === want);
}

/**
 * The pack's date for each candidate URL, by `normalizeUrl()`: its `published_at`, which for an arXiv paper is the time of its
 * announcement (SPEC §4.14), so RETURN_NEW_FACT dates a pack URL by it. A Map, so no URL reads Object.prototype.
 */
export function packDatesOf(pack: Pick<Pack, "candidates">): ReadonlyMap<string, string> {
  const dates = new Map<string, string>();
  for (const c of pack.candidates) dates.set(normalizeUrl(c.url), c.published_at);
  return dates;
}

// ── Strings ──────────────────────────────────────────────────────────────────────────────────────

/** The strings of one finding's own record (a new finding's, or a stored finding's), by its `new-N` ref or id. */
export const stringsOf = (input: RuleInput, key: string): StringEntry[] => input.inventory.entries.filter((e) => e.finding === key);

/** The brief-level strings about one finding: its returning update, rung notes, the deep dive or remarkable note on it, a correction's `after` on it. */
export const stringsAbout = (input: RuleInput, key: string): StringEntry[] => input.inventory.entries.filter((e) => e.about === key);

/** The entries of the records being judged against `config/` (draft: all; published: the records being published). */
export const onlyPublishing = (entries: readonly StringEntry[]): StringEntry[] => entries.filter((e) => e.publishing);

/** WORDS' page total, by default (strings.ts `pageProse()`): the model prose the brief's page shows, given how it shows each new finding. */
export const pageProseOf = (input: RuleInput): StringEntry[] => pageProse(input.inventory, shownDepthOf(input.views));

/**
 * Whether a string is a Landmark's text, for the one word HYPE_WORDS lets a Landmark carry (SPEC §4.12): the finding it is
 * about (a returning update, a rung note, the deep dive or remarkable note, a correction's `after`) or belongs to, filed on
 * the date the entry names (`filedOn`: as `filedAs()` files it with the corrections in force), or as first published when
 * the entry names none. The Lead, the big picture and every other brief-level string are no one's.
 */
export function isLandmarkText(views: Views, entry: StringEntry): boolean {
  const key = entry.about ?? entry.finding;
  if (key === null) return false;
  const finding = views.find(key);
  if (finding === null) return false;
  const facts = entry.filedOn === null ? finding.published : finding.filedOn(entry.filedOn);
  return facts.significance === "landmark";
}
