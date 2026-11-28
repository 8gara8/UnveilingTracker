// The views (SPEC §4.12): the normal form that lets each rule be written once for a draft and for a stored brief. A
// `FindingView` stands for every finding the edition shows or creates (a new finding of a draft, or a stored finding named by
// the brief, the draft's returning entries, its rung changes, its deep dive or its review, which in draft mode is seen
// through the context's stored text); a `BriefView` holds the brief-level text and records (the Lead, the story and items
// with their updates, ideas, Also noted lines, the deep dive, the review, the corrections it lists, the brief's sources).
// Every reader-facing string is an `L10n` (`{ en, zh }`, `zh` null in a draft), every field keeps its schema name, and a field
// the record does not carry (a stored finding seen only through the context has no reactions) is null.
//
// Each finding view has its facts three ways, which §4.10 tells apart: `published`, the values the record itself holds, which
// stay as first published; `filedOn(date)`, the finding as `filedAs()` files it on that date with the corrections in force
// (the stored ones in published mode, the draft's own, dated D, in draft mode); and `latest`, `filedOn()` of the edition's
// date. Where a stored finding is seen only through the context, its `published` values are the context's, which the spec has
// already filed on D (§4.15); that is the one gap, and `basis` and `detail` say when it applies.
//
// Built once per validation by `buildViews()`. Nothing is changed in the records it reads; the result is plain data (with the
// two closures `where()` and `filedOn()`), so a test may deep-freeze it.
//
// New for this project; Cyber's lib/rules/shared.ts `derive()` built the lookups its rules shared, which this generalises to
// findings and to both modes.

import { latestFilings, type FilingCorrection } from "../items";
import type { Lang, L10n } from "../i18n";
import type { Brief } from "../schema/brief";
import { ID_PATTERNS, type AiConfidence, type AiRole, type Artefacts, type FieldId, type FindingKind, type IsoDate, type Rung, type RungBy, type SeenAs, type Significance, type SourceKind } from "../schema/common";
import type { AgentContext, LedgerCandidate, RecentFinding, StoredFinding, WeekFinding } from "../schema/context";
import type { DraftBrief, DraftFinding } from "../schema/draft";
import type { Finding } from "../schema/finding";
import type { Term } from "../schema/glossary";
import type { Correction } from "../schema/misc";
import { compareFindingIds } from "../ids";
import { files, judgedOf, judgesPart, removedPaths, type Judged, type PublishedStrings } from "./strings";
import { formatPath, type StoredRecords } from "./types";

// ── Facts ────────────────────────────────────────────────────────────────────────────────────────

/** The six values a correction may refile (SPEC §4.10), each null where the record does not carry it. */
export interface Facts {
  readonly field: FieldId | null;
  readonly subfield: string | null;
  readonly kind: FindingKind | null;
  readonly significance: Significance | null;
  readonly role: AiRole | null;
  readonly confidence: AiConfidence | null;
}

/**
 * `filedAs()` over facts that may be unknown (SPEC §4.10): each value is the `after.en` of the latest valid correction at its
 * path dated on or before `date`, else `base`'s; a role of `none` files with a null confidence. Agrees with `filedAs()` on a
 * full record (tests/rules-views.test.ts).
 */
export function filedFacts(base: Facts, id: string | null, corrections: readonly FilingCorrection[], date: IsoDate): Facts {
  if (id === null) return base;
  const filed = latestFilings(id, corrections, date);
  const role = (filed.get("ai.role") as AiRole | undefined) ?? base.role;
  return {
    field: (filed.get("field") as FieldId | undefined) ?? base.field,
    subfield: filed.get("subfield") ?? base.subfield,
    kind: (filed.get("kind") as FindingKind | undefined) ?? base.kind,
    significance: (filed.get("significance") as Significance | undefined) ?? base.significance,
    role,
    confidence: role === "none" ? null : ((filed.get("ai.confidence") as AiConfidence | undefined) ?? base.confidence),
  };
}

// ── The parts of a finding ───────────────────────────────────────────────────────────────────────

export interface SourceView {
  readonly id: string;
  readonly index: number;
  readonly kind: SourceKind;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly doi: string | null;
  readonly published_at: string | null;
  /** How the run saw the URL; null in a draft. */
  readonly seen_as: SeenAs | null;
  /** The edition that added the source; null in a draft. */
  readonly added: IsoDate | null;
  /**
   * True in draft mode, for a brief's source when the brief is being published, and for a stored finding's source when the finding was
   * first briefed on the date being published or the date added the source (SPEC §4.12 "Stored records"): the tests that read `config/` run on it.
   */
  readonly publishing: boolean;
  readonly where: string;
}

export interface RungView {
  readonly index: number;
  readonly rung: Rung;
  readonly date: IsoDate;
  /** The edition that recorded the entry; null in a draft, where it is D. */
  readonly recorded: IsoDate | null;
  readonly source_id: string;
  readonly by: RungBy | null;
  readonly note: L10n | null;
  /** True in draft mode, and in a stored finding for an entry the date being published recorded or of a finding first briefed on it: `checkers.json` is read for it. */
  readonly publishing: boolean;
  readonly where: string;
}

export interface SinceThenView {
  readonly index: number;
  readonly date: IsoDate;
  readonly text: L10n;
  readonly source_ids: readonly string[];
  readonly where: string;
}

export interface ReactionView {
  readonly index: number;
  readonly source_id: string;
  readonly who: string;
  readonly affiliation: string;
  readonly quote: string;
  readonly where: string;
}

export interface EvidenceView {
  readonly index: number;
  readonly source_id: string;
  readonly quote: string;
  readonly from_claimant: boolean;
  readonly where: string;
}

export interface AiView {
  readonly role: AiRole;
  readonly confidence: AiConfidence | null;
  readonly systems: readonly { readonly index: number; readonly name: string; readonly maker: string }[];
  readonly evidence: readonly EvidenceView[];
}

export interface FigureView {
  readonly source_id: string;
  readonly image_url: string;
  readonly licence: string;
  readonly licence_quote: string;
  readonly credit: string;
  readonly alt: L10n;
  readonly where: string;
}

export interface WhoView {
  readonly index: number;
  readonly name: string;
  readonly ror: string | null;
}

/** A glossary term a finding uses: `name` is the new term's own, the glossary's for a stored one, else its id read as words. */
export interface TermUse {
  readonly index: number;
  readonly id: string | null;
  readonly name: string;
  readonly definition: L10n | null;
  /** True when a stored `removed` correction rewrote the glossary's definition of this term: `definition` is then the removed text, which a rule skips (SPEC §4.12 "Removed text"). */
  readonly removed: boolean;
  readonly isNew: boolean;
  readonly where: string;
}

export interface ExplainerView {
  readonly found: L10n;
  readonly matters: L10n;
  readonly ai_helped: L10n | null;
  readonly how_sure: L10n;
  readonly background: L10n;
  readonly could_lead: L10n;
}

// ── A finding ────────────────────────────────────────────────────────────────────────────────────

/**
 * Why the edition names a finding; one finding may have several. `backlog` is the Chinese pass's: a stored finding whose own
 * strings the pass translates (a `backlog.<id>.*` key of its context or draft), named by the run's caller (`ViewSourceDraft.backlog`).
 */
export type FindingRole =
  | "story" | "item" | "returning" | "rung_change" | "deep_dive" | "remarkable" | "against" | "lead" | "correction"
  | "recent" | "week" | "ledger" | "report" | "backlog";

export interface FindingView {
  /** The finding's id, or `new-N` for a new finding of a draft. */
  readonly key: string;
  /** The stored id; null for a new finding. */
  readonly id: string | null;
  /** `new-N` for a new finding, else null. */
  readonly ref: string | null;
  readonly origin: "new" | "stored";
  /** False for an id a draft names that its context does not list (REF_UNKNOWN's); true for a new finding and for a stored record. */
  readonly known: boolean;
  /** Where its values come from: the draft, a stored record, or the context's stored text. */
  readonly basis: "draft" | "record" | "context";
  /** `partial` when only part of the record is known (a finding seen through the context's recent, week or report lists). */
  readonly detail: "full" | "partial";
  readonly roles: readonly FindingRole[];
  /** First published in this edition: a new finding of a draft, or a stored finding whose first brief is D. */
  readonly isNew: boolean;
  /**
   * True in draft mode and for a finding first briefed on the date being published, which is judged whole (SPEC §4.12 "Stored records").
   * A returning finding that the date gave text is false: only its new entries are being published, which `RungView.publishing` and
   * `SourceView.publishing` say, and the inventory's strings each.
   */
  readonly publishing: boolean;
  /** The file of a stored record (`findings/<id>.json`); null in draft mode. */
  readonly file: string | null;
  /** The issue path of a place inside the finding, in a correction's dotted form (`where("explainer.how_sure", "en")`); `lang` adds the side of an `L10n` on a stored record. */
  readonly where: (rel?: string, lang?: Lang) => string;
  /** The values the record itself holds: as first published. */
  readonly published: Facts;
  /** The finding as `filedAs()` files it on `date`, with the corrections in force. */
  readonly filedOn: (date: IsoDate) => Facts;
  /** `filedOn()` of the edition's date. */
  readonly latest: Facts;
  /** The finding as a check run now files it: every correction in force counts, whatever its date (DUAL_USE's numbered steps, SPEC §4.10). */
  readonly current: Facts;
  /**
   * The places in this finding's record that a stored `removed` correction rewrote, in a correction's dotted form
   * (`explainer.how_sure`, `sources.0.url`, `ai.evidence.1.quote`; the same as `StringEntry.at`): a rule that reads a value from
   * the view skips it when `removed.has(place)` (SPEC §4.12 "Removed text"). Empty for a new finding of a draft and for a finding
   * the run reads only through the context; a stored finding given to a draft run (`DraftInputs.stored`) has what the stored
   * corrections rewrote in it.
   */
  readonly removed: ReadonlySet<string>;
  readonly title: L10n | null;
  /** How the finding was first published: `story` or `item`. A draft's new finding is the story when `story` is its ref. */
  readonly depth: "story" | "item" | null;
  readonly explainer: ExplainerView | null;
  readonly go_deeper: readonly string[] | null;
  readonly ai: AiView | null;
  /** The current rung: the last `rung_history` entry's, or the context's. */
  readonly rung: Rung | null;
  readonly rung_history: readonly RungView[] | null;
  readonly since_then: readonly SinceThenView[] | null;
  readonly sources: readonly SourceView[] | null;
  readonly reactions: readonly ReactionView[] | null;
  readonly artefacts: Artefacts | null;
  readonly figure: FigureView | null;
  readonly who: readonly WhoView[] | null;
  readonly terms: readonly TermUse[] | null;
  readonly related: readonly string[] | null;
  readonly first_published: IsoDate | null;
  readonly first_brief: IsoDate | null;
  readonly briefs: readonly IsoDate[] | null;
  readonly history: boolean | null;
  readonly updated: IsoDate | null;
}

// ── The brief-level text ─────────────────────────────────────────────────────────────────────────

export interface LeadView {
  readonly index: number;
  readonly text: L10n;
  /** The findings it cites: refs in a draft, ids in a stored brief. */
  readonly refs: readonly string[];
  readonly where: string;
}

/** A draft's returning entry: an existing finding with new facts. */
export interface ReturningView {
  readonly index: number;
  readonly finding_id: string;
  readonly update: L10n;
  readonly source_ids: readonly string[];
  readonly rung: RungView | null;
  readonly where: string;
}

/** The story or one item. */
export interface ItemView {
  readonly slot: "story" | "item";
  /** The index in `items`; null for the story. */
  readonly index: number | null;
  /** The ref (`new-N`) or the id the draft or the brief names. */
  readonly key: string;
  readonly finding: FindingView | null;
  /** A new finding (a `new-N` ref, or a stored item whose `new` is true). */
  readonly new: boolean;
  /** The returning update; null on a new finding, or on a returning one the draft gives no entry. */
  readonly update: L10n | null;
  /** A draft's returning entry for it. */
  readonly returning: ReturningView | null;
  readonly where: string;
}

export interface RungChangeView {
  readonly index: number;
  readonly finding_id: string;
  /** A draft's change has only the new entry; a stored change has `from`, `to`, `date` and `by`. */
  readonly from: Rung | null;
  readonly to: Rung;
  readonly date: IsoDate;
  readonly by: "script" | "agent";
  /** The draft's rung entry, with its note. */
  readonly rung: RungView | null;
  readonly where: string;
}

export interface IdeaView {
  readonly index: number;
  readonly text: L10n;
  readonly who: string;
  readonly source_id: string;
  readonly where: string;
}

export interface AlsoView {
  readonly index: number;
  readonly title: L10n;
  readonly field: FieldId;
  readonly source_id: string;
  readonly where: string;
}

export interface DeepDiveView {
  readonly finding_id: string;
  readonly text: L10n;
  readonly source_ids: readonly string[];
  readonly why_today: string;
  readonly where: string;
}

export interface ReviewView {
  readonly big_picture: L10n;
  readonly remarkable: { readonly finding_id: string; readonly note: L10n } | null;
  readonly strongest_against: { readonly text: L10n; readonly finding_ids: readonly string[]; readonly source_ids: readonly string[] };
  /** The stored brief's computed counts; null in a draft. */
  readonly field_counts: readonly { readonly field: FieldId; readonly reported: number; readonly counted: number }[] | null;
  readonly fell: readonly string[] | null;
  readonly setbacks: readonly string[] | null;
  readonly where: string;
}

/** A correction line the brief or the draft lists. */
export interface CorrectionLine {
  readonly index: number;
  /** The stored id; null in a draft. */
  readonly id: string | null;
  readonly finding_id: string | null;
  readonly edition_date: IsoDate | null;
  readonly term_id: string | null;
  readonly type: "correction" | "clarification" | "update" | "removed";
  readonly reason: L10n;
  readonly where: string;
}

export interface DecisionView {
  readonly index: number;
  readonly report_id: string;
  readonly outcome: "upheld" | "rejected";
  readonly reason: L10n;
  readonly correction: number | null;
  readonly where: string;
}

export interface BriefView {
  /** `briefs/D.json` in published mode; null in draft mode. */
  readonly file: string | null;
  /** True in draft mode and for the brief being published (SPEC §4.12 "Stored records"); false for a stored brief that is not, and when no brief is judged. */
  readonly publishing: boolean;
  /** The places in the brief that a stored `removed` correction rewrote (`deep_dive.text`, `sources.1.url`; as `FindingView.removed`); empty in a draft. */
  readonly removed: ReadonlySet<string>;
  readonly where: (rel?: string, lang?: Lang) => string;
  readonly lead: readonly LeadView[];
  readonly story: ItemView | null;
  readonly items: readonly ItemView[];
  /** A draft's returning entries; [] in a stored brief, whose items carry `new: false` and an update. */
  readonly returning: readonly ReturningView[];
  readonly rung_changes: readonly RungChangeView[];
  readonly ideas: readonly IdeaView[];
  readonly also: readonly AlsoView[];
  readonly deep_dive: DeepDiveView | null;
  readonly review: ReviewView | null;
  readonly corrections: readonly CorrectionLine[];
  readonly report_decisions: readonly DecisionView[];
  /** The brief-level sources `b1...bN`. */
  readonly sources: readonly SourceView[];
}

/** A correction in full, as the rules read it: the draft's own, or every stored one. */
export interface CorrectionView {
  readonly index: number;
  readonly id: string | null;
  readonly date: IsoDate;
  readonly finding_id: string | null;
  readonly edition_date: IsoDate | null;
  readonly term_id: string | null;
  readonly type: "correction" | "clarification" | "update" | "removed";
  /** In a correction's dotted form, indices from 0. */
  readonly path: string;
  readonly before: L10n | null;
  readonly after: L10n;
  readonly reason: L10n;
  readonly source_url: string | null;
  readonly trigger: "recheck" | "reader_report" | "editor" | null;
  readonly report_id: string | null;
  readonly draft: boolean;
  readonly publishing: boolean;
  readonly where: string;
}

export interface Views {
  /** Every finding named or visible: new findings first, then the others in the order the edition names them. */
  readonly findings: readonly FindingView[];
  readonly find: (key: string) => FindingView | null;
  readonly brief: BriefView;
  /** The corrections in force: the draft's own (draft mode) or every stored one (published mode). */
  readonly corrections: readonly CorrectionView[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

const text = (en: string): L10n => ({ en, zh: null });
const INDEX = /^(?:0|[1-9][0-9]*)$/;

/** `sources.0.url` as `["sources", 0, "url"]`. */
function segmentsOf(rel: string): (string | number)[] {
  return rel === "" ? [] : rel.split(".").map((s) => (INDEX.test(s) ? Number(s) : s));
}

type Where = (rel?: string, lang?: Lang) => string;

/**
 * Builds a record's `where()`: `base` is the record's place in its file, `file` the file of a stored record (null in a draft),
 * and `sides` whether a string is an `L10n`, whose language is then appended when the caller names one.
 */
function whereOf(file: string | null, base: readonly (string | number)[], sides: boolean): Where {
  return (rel = "", lang) => {
    const path = formatPath([...base, ...segmentsOf(rel), ...(sides && lang !== undefined ? [lang] : [])]);
    return file === null ? path : `${file}: ${path}`;
  };
}

/**
 * A term id read as words (`virtual-unwrapping` as "virtual unwrapping"): all a view knows of an existing term when the run was
 * given no glossary entry for it. A name that is not its id (an accent, an apostrophe) is read from the glossary instead, so a
 * term that the explainer names correctly is never reported as missing.
 */
const nameOfId = (id: string): string => id.replace(/-/g, " ");

/** A date after every correction: `filedOn()` of it counts them all (`FindingView.current`). */
const END_OF_TIME: IsoDate = "9999-12-31";

// ── Findings from each source ────────────────────────────────────────────────────────────────────

interface Common {
  key: string;
  roles: readonly FindingRole[];
}

function sourceViews(
  sources: readonly { id: string; kind: SourceKind; title: string; publisher: string; url: string; doi: string | null; published_at: string | null; seen_as?: SeenAs; added?: IsoDate }[],
  where: Where, publishing: (index: number) => boolean,
): SourceView[] {
  return sources.map((s, index) => ({
    id: s.id, index, kind: s.kind, title: s.title, publisher: s.publisher, url: s.url, doi: s.doi, published_at: s.published_at,
    seen_as: s.seen_as ?? null, added: s.added ?? null, publishing: publishing(index), where: where(`sources.${index}`),
  }));
}

function aiView(
  ai: { role: AiRole; confidence: AiConfidence | null; systems: readonly { name: string; maker: string }[]; evidence: readonly { source_id: string; quote: string; from_claimant: boolean }[] },
  where: Where,
): AiView {
  return {
    role: ai.role,
    confidence: ai.confidence,
    systems: ai.systems.map((s, index) => ({ index, name: s.name, maker: s.maker })),
    evidence: ai.evidence.map((e, index) => ({ index, source_id: e.source_id, quote: e.quote, from_claimant: e.from_claimant, where: where(`ai.evidence.${index}`) })),
  };
}

function factsOf(f: { field: FieldId; subfield: string | null; kind: FindingKind | null; significance: Significance; ai: { role: AiRole; confidence: AiConfidence | null } | null }): Facts {
  return { field: f.field, subfield: f.subfield, kind: f.kind, significance: f.significance, role: f.ai?.role ?? null, confidence: f.ai?.confidence ?? null };
}

/**
 * A new finding of the draft. `names` is the stored glossary by term id (`DraftInputs.stored.terms`; empty without it): an
 * existing term of the finding takes its English name from there when the glossary has it, else its id read as words.
 */
function newFindingView(
  f: DraftFinding, index: number, common: Common, date: IsoDate, depth: "story" | "item" | null, names: ReadonlyMap<string, Term>,
): FindingView {
  const where = whereOf(null, ["new_findings", index], false);
  const published = factsOf(f);
  return {
    key: f.ref, id: null, ref: f.ref, origin: "new", known: true, basis: "draft", detail: "full", roles: common.roles, isNew: true, publishing: true,
    file: null, where, published, filedOn: () => published, latest: published, current: published, removed: new Set(), title: text(f.title), depth,
    explainer: {
      found: text(f.explainer.found), matters: text(f.explainer.matters), ai_helped: f.explainer.ai_helped === null ? null : text(f.explainer.ai_helped),
      how_sure: text(f.explainer.how_sure), background: text(f.explainer.background), could_lead: text(f.explainer.could_lead),
    },
    go_deeper: f.go_deeper, ai: aiView(f.ai, where), rung: f.rung_history[f.rung_history.length - 1]?.rung ?? null,
    rung_history: f.rung_history.map((r, i) => ({
      index: i, rung: r.rung, date: r.date, recorded: date, source_id: r.source_id, by: "agent", note: r.note === null ? null : text(r.note), publishing: true,
      where: where(`rung_history.${i}`),
    })),
    since_then: [], sources: sourceViews(f.sources, where, () => true),
    reactions: f.reactions.map((r, i) => ({ index: i, source_id: r.source_id, who: r.who, affiliation: r.affiliation, quote: r.quote, where: where(`reactions.${i}`) })),
    artefacts: f.artefacts,
    figure: f.figure === null ? null : {
      source_id: f.figure.source_id, image_url: f.figure.image_url, licence: f.figure.licence, licence_quote: f.figure.licence_quote,
      credit: f.figure.credit, alt: text(f.figure.alt), where: where("figure"),
    },
    who: f.who.map((w, i) => ({ index: i, name: w.name, ror: w.ror })),
    terms: f.terms.map((t, i) => t.new
      ? { index: i, id: null, name: t.term, definition: text(t.definition), removed: false, isNew: true, where: where(`terms.${i}`) }
      : { index: i, id: t.id, name: names.get(t.id)?.en.term ?? nameOfId(t.id), definition: null, removed: false, isNew: false, where: where(`terms.${i}`) }),
    related: f.related, first_published: f.first_published, first_brief: null, briefs: null, history: false, updated: null,
  };
}

/**
 * A stored finding record. `names` resolves each term id to its English name where the glossary has it, and `removedBy` is
 * what the stored `removed` corrections rewrote, by record (`removedPaths()`): in this finding, and in the glossary's term
 * definitions it uses. With `context` (a draft run that was given the record, `DraftInputs.stored`) the view is
 * the finding as the context names it, but full: `basis` is `context` (the draft does not judge it), `known` says whether the
 * context lists it, and its issue paths are `findings["<id>"]...`, since no file is judged.
 */
function recordView(
  f: Finding, common: Common, date: IsoDate, judged: Judged, filing: readonly FilingCorrection[], names: ReadonlyMap<string, Term>,
  removedBy: ReadonlyMap<string, ReadonlySet<string>>, context: { known: boolean } | null,
): FindingView {
  const file = context === null ? files.finding(f.id) : null;
  const where = whereOf(file, context === null ? [] : ["findings", f.id], true);
  const published = factsOf(f);
  const filedOn = (d: IsoDate): Facts => filedFacts(published, f.id, filing, d);
  const removed = new Set(removedBy.get(`finding:${f.id}`) ?? []);
  return {
    key: f.id, id: f.id, ref: null, origin: "stored", known: context?.known ?? true, basis: context === null ? "record" : "context", detail: "full",
    roles: common.roles, isNew: context === null && f.first_brief === date,
    publishing: judged === "whole", file, where, published, filedOn, latest: filedOn(date), current: filedOn(END_OF_TIME), removed, title: f.title, depth: f.depth,
    explainer: f.explainer, go_deeper: f.go_deeper, ai: aiView(f.ai, where), rung: f.rung,
    rung_history: f.rung_history.map((r, i) => ({
      index: i, rung: r.rung, date: r.date, recorded: r.recorded, source_id: r.source_id, by: r.by, note: r.note, publishing: judgesPart(judged, "rung_history", i),
      where: where(`rung_history.${i}`),
    })),
    since_then: f.since_then.map((s, i) => ({ index: i, date: s.date, text: s.text, source_ids: s.source_ids, where: where(`since_then.${i}`) })),
    sources: sourceViews(f.sources, where, (i) => judgesPart(judged, "sources", i)),
    reactions: f.reactions.map((r, i) => ({ index: i, source_id: r.source_id, who: r.who, affiliation: r.affiliation, quote: r.quote, where: where(`reactions.${i}`) })),
    artefacts: f.artefacts,
    figure: f.figure === null ? null : {
      source_id: f.figure.source_id, image_url: f.figure.image_url, licence: f.figure.licence, licence_quote: f.figure.licence_quote,
      credit: f.figure.credit, alt: f.figure.alt, where: where("figure"),
    },
    who: f.who.map((w, i) => ({ index: i, name: w.name, ror: w.ror })),
    terms: f.terms.map((id, i) => ({
      index: i, id, name: names.get(id)?.en.term ?? nameOfId(id), definition: names.get(id) === undefined ? null : text(names.get(id)!.en.definition),
      removed: removedBy.get(`term:${id}`)?.has("definition") ?? false, isNew: false, where: where(`terms.${i}`),
    })),
    related: f.related, first_published: f.first_published, first_brief: f.first_brief, briefs: f.briefs, history: f.history, updated: f.updated,
  };
}

interface ContextParts {
  recent?: RecentFinding;
  week?: WeekFinding;
  stored?: StoredFinding | LedgerCandidate;
}

/**
 * Every finding id the context lists, whatever the list (SPEC §4.12 REF_UNKNOWN: "a finding id in the context"): the recent
 * findings, the week's findings, setbacks and rung changes, the Sunday candidates, the reports, the rung proposals, the
 * standing stories, the flagged records, and the stored finding a pack candidate matches (`stored_finding`, §4.14). A week's
 * setback or fall and a candidate's `stored_finding` may name a finding older than 30 days that no other list holds, yet a
 * draft has to name it: in a returning entry for the finding a candidate matches by its trial number (DUPLICATE), and in a
 * `strongest_against` that lists a finding that fell this week (WEEK_AGAINST).
 */
export function contextFindingIds(context: AgentContext): Set<string> {
  const ids = new Set<string>();
  for (const f of context.recent_findings) ids.add(f.id);
  for (const f of context.week?.findings ?? []) ids.add(f.id);
  for (const id of context.week?.setbacks ?? []) ids.add(id);
  for (const r of context.week?.rung_changes ?? []) ids.add(r.finding_id);
  for (const c of context.candidates) if (c.stored_finding !== null) ids.add(c.stored_finding);
  for (const f of context.ledger_for_sunday) ids.add(f.id);
  for (const r of context.reports) ids.add(r.finding_id);
  for (const p of context.rung_proposals) ids.add(p.finding_id);
  for (const s of context.standing_stories) for (const id of s.finding_ids) ids.add(id);
  for (const f of context.corrections.flagged) if (f.finding_id !== null) ids.add(f.finding_id);
  return ids;
}

/**
 * A stored finding seen only through the context: the stored text where the context has it (a Sunday candidate, a report's
 * finding), else what the recent and week lists say, else nothing (every fact null). The context's field, kind and
 * significance are already filed on D (§4.15); the draft's own corrections are applied on top by `filedOn()`.
 */
function contextView(id: string, parts: ContextParts, known: boolean, common: Common, filing: readonly FilingCorrection[], date: IsoDate): FindingView {
  const where = whereOf(null, ["findings", id], false);
  const s = parts.stored;
  const title = s?.title ?? parts.week?.title ?? parts.recent?.title ?? null;
  const published: Facts = {
    field: s?.field ?? parts.week?.field ?? parts.recent?.field ?? null,
    subfield: null,
    kind: s?.kind ?? parts.week?.kind ?? null,
    significance: s?.significance ?? parts.week?.significance ?? parts.recent?.significance ?? null,
    role: s?.ai.role ?? null,
    confidence: s?.ai.confidence ?? null,
  };
  const filedOn = (d: IsoDate): Facts => filedFacts(published, id, filing, d);
  const last = s?.rung_history[s.rung_history.length - 1]?.rung;
  return {
    key: id, id, ref: null, origin: "stored", known, basis: "context", detail: s === undefined ? "partial" : "full", roles: common.roles,
    isNew: false, publishing: true, file: null, where, published, filedOn, latest: filedOn(date), current: filedOn(END_OF_TIME), removed: new Set(),
    title: title === null ? null : text(title), depth: null,
    explainer: s === undefined ? null : {
      found: text(s.explainer.found), matters: text(s.explainer.matters), ai_helped: s.explainer.ai_helped === null ? null : text(s.explainer.ai_helped),
      how_sure: text(s.explainer.how_sure), background: text(s.explainer.background), could_lead: text(s.explainer.could_lead),
    },
    go_deeper: null, ai: s === undefined ? null : aiView(s.ai, where), rung: last ?? parts.week?.rung ?? parts.recent?.rung ?? null,
    rung_history: s === undefined ? null : s.rung_history.map((r, i) => ({
      index: i, rung: r.rung, date: r.date, recorded: r.recorded, source_id: r.source_id, by: r.by, note: r.note === null ? null : text(r.note), publishing: true,
      where: where(`rung_history.${i}`),
    })),
    since_then: s === undefined ? null : s.since_then.map((x, i) => ({ index: i, date: x.date, text: text(x.text), source_ids: x.source_ids, where: where(`since_then.${i}`) })),
    sources: s === undefined ? null : sourceViews(s.sources, where, () => true),
    reactions: null, artefacts: parts.recent?.artefacts ?? null, figure: null, who: null, terms: null, related: null,
    first_published: s?.first_published ?? null, first_brief: null, briefs: null, history: null, updated: null,
  };
}

// ── The brief-level views ────────────────────────────────────────────────────────────────────────

export interface ViewSourceDraft {
  mode: "draft";
  /** D: the context's date, which the draft's own `date` must equal (DATE_MISMATCH); every finding is filed on it. */
  date: IsoDate;
  draft: DraftBrief;
  /** The context; null for a run that has none (the Chinese pass's rules read the English draft alone), which leaves a stored finding to `stored` and `backlog`. */
  context: AgentContext | null;
  /** The corrections in force: the draft's own, dated D, after the stored ones when the run was given them. */
  filing: readonly FilingCorrection[];
  /** The stored records the run was given (`DraftInputs.stored`); a finding among them is a full view, not the context's part of one. */
  stored?: StoredRecords | null;
  /**
   * Stored findings the run reads besides those the draft and the context name: the Chinese pass's backlog, whose `backlog.<id>.*`
   * keys name a finding the English draft may not. Each gets the role `backlog` and a view: a full one when `stored` holds its record,
   * else a partial one that knows no fact (the rules skip what they cannot know). `listed` says that the run's own context lists
   * it, for `FindingView.known`, which a run with no `context` cannot tell by itself. Absent for an English run, whose views stay as
   * they are.
   */
  backlog?: readonly { id: string; listed: boolean }[];
}

export interface ViewSourcePublished extends PublishedStrings {
  mode: "published";
  filing: readonly FilingCorrection[];
  /** D: the brief's date, or the date given for a run with no brief. */
  date: IsoDate;
}

export type ViewSource = ViewSourceDraft | ViewSourcePublished;

const ROLE_ORDER: readonly FindingRole[] = [
  "story", "item", "returning", "rung_change", "deep_dive", "remarkable", "against", "lead", "correction", "recent", "week", "ledger", "report", "backlog",
];

/** Collects which findings the edition names and why, in the order it names them. */
class Roster {
  private readonly roles = new Map<string, Set<FindingRole>>();

  add(key: string | null, role: FindingRole): void {
    if (key === null) return;
    const set = this.roles.get(key) ?? new Set<FindingRole>();
    set.add(role);
    this.roles.set(key, set);
  }

  keys(): string[] {
    return [...this.roles.keys()];
  }

  common(key: string): Common {
    const set = this.roles.get(key) ?? new Set<FindingRole>();
    return { key, roles: ROLE_ORDER.filter((r) => set.has(r)) };
  }
}

function rungView(r: { rung: Rung; date: IsoDate; source_id: string; note: string | null }, index: number, date: IsoDate, where: string): RungView {
  return { index, rung: r.rung, date: r.date, recorded: date, source_id: r.source_id, by: "agent", note: r.note === null ? null : text(r.note), publishing: true, where };
}

function buildDraftViews(src: ViewSourceDraft): Views {
  const { draft, context, filing, date } = src;
  const storedById = new Map((src.stored?.findings ?? []).map((f) => [f.id, f]));
  const termById = new Map((src.stored?.terms ?? []).map((t) => [t.id, t]));
  const removedBy = removedPaths(src.stored?.corrections ?? [], { findings: src.stored?.findings ?? [], briefs: [], terms: src.stored?.terms ?? [] });
  const root = whereOf(null, [], false);
  const roster = new Roster();

  // Who the draft names, in the order it names them.
  if (draft.story !== null) roster.add(draft.story, "story");
  for (const k of draft.items) roster.add(k, "item");
  for (const r of draft.returning) roster.add(r.finding_id, "returning");
  for (const r of draft.rung_changes) roster.add(r.finding_id, "rung_change");
  roster.add(draft.deep_dive?.finding_id ?? null, "deep_dive");
  roster.add(draft.review?.remarkable?.finding_id ?? null, "remarkable");
  for (const id of draft.review?.strongest_against.finding_ids ?? []) roster.add(id, "against");
  for (const l of draft.lead) for (const k of l.refs) roster.add(k, "lead");
  for (const c of draft.corrections) roster.add(c.finding_id, "correction");
  const newRefs = new Set(draft.new_findings.map((f) => f.ref));

  // The context's stored text, merged by id.
  const parts = new Map<string, ContextParts>();
  const part = (id: string): ContextParts => {
    const p = parts.get(id) ?? {};
    parts.set(id, p);
    return p;
  };
  if (context !== null) {
    for (const f of context.recent_findings) { part(f.id).recent = f; roster.add(f.id, "recent"); }
    for (const f of context.week?.findings ?? []) { part(f.id).week = f; roster.add(f.id, "week"); }
    for (const f of context.ledger_for_sunday) { part(f.id).stored = f; roster.add(f.id, "ledger"); }
    for (const r of context.reports) { part(r.finding_id).stored = r.finding; roster.add(r.finding_id, "report"); }
  }
  for (const b of src.backlog ?? []) roster.add(b.id, "backlog");

  const findings: FindingView[] = [];
  draft.new_findings.forEach((f, i) => {
    const depth = draft.story === f.ref ? "story" : draft.items.includes(f.ref) ? "item" : null;
    findings.push(newFindingView(f, i, roster.common(f.ref), date, depth, termById));
  });
  const listed = context === null ? new Set<string>() : contextFindingIds(context);
  for (const b of src.backlog ?? []) if (b.listed) listed.add(b.id);
  for (const key of roster.keys()) {
    if (newRefs.has(key) || ID_PATTERNS.newRef.test(key)) continue;
    const record = storedById.get(key);
    findings.push(record === undefined
      ? contextView(key, parts.get(key) ?? {}, listed.has(key), roster.common(key), filing, date)
      : recordView(record, roster.common(key), date, "whole", filing, termById, removedBy, { known: listed.has(key) }));
  }
  const byKey = new Map(findings.map((f) => [f.key, f]));
  const find = (key: string): FindingView | null => byKey.get(key) ?? null;

  const returning: ReturningView[] = draft.returning.map((r, i) => ({
    index: i, finding_id: r.finding_id, update: text(r.update), source_ids: r.source_ids,
    rung: r.rung === null ? null : rungView(r.rung, 0, date, root(`returning.${i}.rung`)), where: root(`returning.${i}`),
  }));
  // Indexed once, the first entry of a finding first: a draft that names thousands of findings is read in linear time.
  const returningBy = new Map<string, ReturningView>();
  for (const r of returning) if (!returningBy.has(r.finding_id)) returningBy.set(r.finding_id, r);
  const returningOf = (key: string): ReturningView | null => returningBy.get(key) ?? null;
  const item = (key: string, slot: "story" | "item", index: number | null): ItemView => {
    const r = returningOf(key);
    return {
      slot, index, key, finding: find(key), new: newRefs.has(key) || ID_PATTERNS.newRef.test(key), update: r?.update ?? null, returning: r,
      where: slot === "story" ? root("story") : root(`items.${index}`),
    };
  };

  const brief: BriefView = {
    file: null,
    publishing: true,
    removed: new Set(),
    where: root,
    lead: draft.lead.map((l, i) => ({ index: i, text: text(l.text), refs: l.refs, where: root(`lead.${i}`) })),
    story: draft.story === null ? null : item(draft.story, "story", null),
    items: draft.items.map((k, i) => item(k, "item", i)),
    returning,
    rung_changes: draft.rung_changes.map((c, i) => ({
      index: i, finding_id: c.finding_id, from: null, to: c.rung.rung, date: c.rung.date, by: "agent", rung: rungView(c.rung, 0, date, root(`rung_changes.${i}.rung`)),
      where: root(`rung_changes.${i}`),
    })),
    ideas: draft.ideas.map((x, i) => ({ index: i, text: text(x.text), who: x.who, source_id: x.source_id, where: root(`ideas.${i}`) })),
    also: draft.also.map((x, i) => ({ index: i, title: text(x.title), field: x.field, source_id: x.source_id, where: root(`also.${i}`) })),
    deep_dive: draft.deep_dive === null ? null : {
      finding_id: draft.deep_dive.finding_id, text: text(draft.deep_dive.text), source_ids: draft.deep_dive.source_ids, why_today: draft.deep_dive.why_today, where: root("deep_dive"),
    },
    review: draft.review === null ? null : {
      big_picture: text(draft.review.big_picture),
      remarkable: draft.review.remarkable === null ? null : { finding_id: draft.review.remarkable.finding_id, note: text(draft.review.remarkable.note) },
      strongest_against: {
        text: text(draft.review.strongest_against.text), finding_ids: draft.review.strongest_against.finding_ids,
        source_ids: draft.review.strongest_against.source_ids,
      },
      field_counts: null, fell: null, setbacks: null, where: root("review"),
    },
    corrections: draft.corrections.map((c, i) => ({
      index: i, id: null, finding_id: c.finding_id, edition_date: c.edition_date, term_id: c.term_id, type: c.type, reason: text(c.reason), where: root(`corrections.${i}`),
    })),
    report_decisions: draft.report_decisions.map((r, i) => ({
      index: i, report_id: r.report_id, outcome: r.outcome, reason: text(r.reason), correction: r.correction, where: root(`report_decisions.${i}`),
    })),
    sources: sourceViews(draft.sources, root, () => true),
  };

  const corrections: CorrectionView[] = draft.corrections.map((c, i) => ({
    index: i, id: null, date, finding_id: c.finding_id, edition_date: c.edition_date, term_id: c.term_id, type: c.type, path: c.path,
    before: null, after: text(c.after), reason: text(c.reason), source_url: c.source_url, trigger: null, report_id: c.report_id,
    draft: true, publishing: true, where: root(`corrections.${i}`),
  }));
  return { findings, find, brief, corrections };
}

function buildPublishedViews(src: ViewSourcePublished): Views {
  const { brief, filing, being } = src;
  const date = src.date;
  const file = brief === null ? null : files.brief(brief.date);
  const root = whereOf(file, [], true);
  const roster = new Roster();

  if (brief !== null) {
    roster.add(brief.story?.finding_id ?? null, "story");
    for (const it of brief.items) roster.add(it.finding_id, "item");
    for (const it of [...(brief.story === null ? [] : [brief.story]), ...brief.items]) if (!it.new) roster.add(it.finding_id, "returning");
    for (const r of brief.rung_changes) roster.add(r.finding_id, "rung_change");
    roster.add(brief.deep_dive?.finding_id ?? null, "deep_dive");
    roster.add(brief.review?.remarkable?.finding_id ?? null, "remarkable");
    for (const id of brief.review?.strongest_against.finding_ids ?? []) roster.add(id, "against");
    for (const l of brief.lead) for (const id of l.finding_ids) roster.add(id, "lead");
    for (const c of brief.corrections) roster.add(c.finding_id, "correction");
  }
  const termById = new Map(src.terms.map((t) => [t.id, t]));
  const removed = removedPaths(src.corrections, { findings: src.findings, briefs: brief === null ? [] : [brief], terms: src.terms });
  const removedOf = (key: string): ReadonlySet<string> => new Set(removed.get(key) ?? []);
  const named = new Map(src.findings.map((f) => [f.id, f]));
  const ordered = [
    ...roster.keys().flatMap((k) => (named.has(k) ? [named.get(k)!] : [])),
    ...src.findings.filter((f) => !roster.keys().includes(f.id)).sort((a, b) => compareFindingIds(a.id, b.id)),
  ];
  const findings = ordered.map((f) => recordView(f, roster.common(f.id), date, judgedOf(being, f.id), filing, termById, removed, null));
  const byKey = new Map(findings.map((f) => [f.key, f]));
  const find = (key: string): FindingView | null => byKey.get(key) ?? null;

  const item = (it: Brief["items"][number], slot: "story" | "item", index: number | null): ItemView => ({
    slot, index, key: it.finding_id, finding: find(it.finding_id), new: it.new, update: it.update, returning: null,
    where: slot === "story" ? root("story") : root(`items.${index}`),
  });

  const view: BriefView = brief === null ? emptyBriefView(root) : {
    file,
    publishing: being.brief,
    removed: removedOf(`brief:${brief.date}`),
    where: root,
    lead: brief.lead.map((l, i) => ({ index: i, text: l.text, refs: l.finding_ids, where: root(`lead.${i}`) })),
    story: brief.story === null ? null : item(brief.story, "story", null),
    items: brief.items.map((it, i) => item(it, "item", i)),
    returning: [],
    rung_changes: brief.rung_changes.map((c, i) => ({
      index: i, finding_id: c.finding_id, from: c.from, to: c.to, date: c.date, by: c.by, rung: null, where: root(`rung_changes.${i}`),
    })),
    ideas: brief.ideas.map((x, i) => ({ index: i, text: x.text, who: x.who, source_id: x.source_id, where: root(`ideas.${i}`) })),
    also: brief.also.map((x, i) => ({ index: i, title: x.title, field: x.field, source_id: x.source_id, where: root(`also.${i}`) })),
    deep_dive: brief.deep_dive === null ? null : {
      finding_id: brief.deep_dive.finding_id, text: brief.deep_dive.text, source_ids: brief.deep_dive.source_ids, why_today: brief.deep_dive.why_today, where: root("deep_dive"),
    },
    review: brief.review === null ? null : {
      big_picture: brief.review.big_picture, remarkable: brief.review.remarkable, strongest_against: brief.review.strongest_against,
      field_counts: brief.review.field_counts, fell: brief.review.fell, setbacks: brief.review.setbacks, where: root("review"),
    },
    corrections: brief.corrections.map((c, i) => ({
      index: i, id: c.id, finding_id: c.finding_id, edition_date: c.edition_date, term_id: c.term_id, type: c.type, reason: c.reason, where: root(`corrections.${i}`),
    })),
    report_decisions: [],
    sources: sourceViews(brief.sources, root, () => being.brief),
  };

  const corrections: CorrectionView[] = src.corrections.map((c: Correction, i) => ({
    index: i, id: c.id, date: c.date, finding_id: c.finding_id, edition_date: c.edition_date, term_id: c.term_id, type: c.type, path: c.path,
    before: c.before, after: c.after, reason: c.reason, source_url: c.source_url, trigger: c.trigger, report_id: c.report_id,
    draft: false, publishing: being.corrections.has(c.id), where: `${files.corrections}: ${formatPath(["corrections", i])}`,
  }));
  return { findings, find, brief: view, corrections };
}

function emptyBriefView(where: Where): BriefView {
  return {
    file: null, publishing: false, removed: new Set(), where, lead: [], story: null, items: [], returning: [], rung_changes: [], ideas: [], also: [], deep_dive: null, review: null,
    corrections: [], report_decisions: [], sources: [],
  };
}

/** Builds the views of a draft or of a stored brief with its records; the same normal form for both. */
export function buildViews(source: ViewSource): Views {
  return source.mode === "draft" ? buildDraftViews(source) : buildPublishedViews(source);
}
