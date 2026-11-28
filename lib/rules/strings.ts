// The string inventory (SPEC §4.12): the one place that knows every string a draft, a stored brief, a stored finding, the
// glossary, the corrections, the reports and the Chinese draft can hold, and what each one is. The rule groups never walk a
// record: they call a selector (`modelProse()`, `dashStrings()`, `hypeStrings()`, ...) whose membership is exactly the set
// its §4.12 row names, so two rules that read "the same strings" cannot drift apart.
//
// Every record is walked generically. A leaf (a string, or one side of an `L10n`) is classified through ONE table of path
// patterns (array indices written `*`) per record type, so a schema key added later is either in the table or reported in
// `Inventory.unclassified` (treated as free text meanwhile, so it is read by more rules, never fewer; the tests require
// the list to be empty for every schema). A correction's `before` and `after` take the kind of the string their `path`
// names (SPEC §4.10, §4.12 NO_EM_DASH and HYPE_WORDS), and a string that a stored `removed` correction rewrote is marked
// `removed`, which every selector leaves out (SPEC §4.12 "Removed text"; `removedProse()` returns the removed prose, which
// WORDS counts as no words).
//
// An entry's `at` is its place inside its record in a correction's dotted form (`explainer.how_sure`, `lead.1.text`,
// indices from 0, an `L10n` named whole), which is what a `removed` correction writes; its `path` is where an issue points
// (`new_findings[0].explainer.how_sure`, or `findings/math-2026-0142.json: explainer.how_sure.en` on a stored record).
//
// New for this project; Cyber's lib/rules/shared.ts field walkers (`proseFields()`, `quotedFields()`, `titleFields()`)
// were one hand-written list per set, which this table replaces.

import type { Lang } from "../i18n";
import type { Brief } from "../schema/brief";
import type { IsoDate } from "../schema/common";
import type { DraftBrief } from "../schema/draft";
import type { DraftZh, ZhContext, ZhGroup, ZhStringKind } from "../schema/draft-zh";
import type { Finding } from "../schema/finding";
import type { Term } from "../schema/glossary";
import type { Correction, Report } from "../schema/misc";
import { REMOVED_TEXT } from "../vocab";
import type { BeingPublished, NewParts } from "./types";
import { formatPath } from "./types";

// ── What an entry says ───────────────────────────────────────────────────────────────────────────

/**
 * What a string is, for the rules that read a set of strings:
 * `prose` model-written text with a budget (a title, an explainer part, the Lead, an update, a deep dive, a reason, ...);
 * `quote` a verbatim quote (an evidence or reaction quote, a `licence_quote`);
 * `title` a source's title, kept as published;
 * `name` a name (a publisher, a `who` entry, a reaction's person and affiliation, an AI system or its maker);
 * `text` other free text (a figure's credit, a term's own name, the status note, the Pace sentence, an idea's author);
 * `url` an address (`urlKind` says which field);
 * `artefact` an identifier with a loose format (a DOI, an arXiv id, an NCT number, a PDB id);
 * `official` a term's name as 樂詞網 shows it (Chinese, quoted);
 * `value` an id, a date or a vocabulary value that no text rule reads.
 */
export type StringKind = "prose" | "quote" | "title" | "name" | "text" | "url" | "artefact" | "official" | "value";

/** Which prose a `prose` entry is, which fixes its word budget (§4.12). `after` and `before` are a correction's own text. */
export type ProseField =
  | "title" | "found" | "matters" | "ai_helped" | "how_sure" | "background" | "could_lead" | "lead" | "update" | "since_then"
  | "note" | "idea" | "also" | "deep_dive" | "big_picture" | "remarkable" | "against" | "definition" | "alt" | "reason"
  | "after" | "before";
/** Which other free text a `text` entry is. */
export type TextField = "credit" | "term" | "status_note" | "pace_sentence" | "idea_who";
export type StringField = ProseField | TextField;

export type NameKind = "publisher" | "who" | "reaction_who" | "affiliation" | "system" | "maker";
export type UrlKind = "source" | "image" | "correction_source" | "evidence" | "lean" | "official";

/** The six explainer parts, in order; a story shows all six, any other finding the first four (SPEC §4.4). */
export const EXPLAINER_FIELDS = ["found", "matters", "ai_helped", "how_sure", "background", "could_lead"] as const satisfies readonly ProseField[];

export type RecordType = "draft" | "new_finding" | "brief" | "finding" | "term" | "correction" | "report" | "zh";

/** The record that holds a string: a finding's id or `new-N` ref, a brief's date, a term's, correction's or report's id. */
export interface RecordRef {
  readonly type: RecordType;
  readonly id: string | null;
}

/** What the Chinese draft's entries know beyond a plain entry (SPEC §4.6): the context key and the English it translates. */
export interface ZhFacts {
  /** The context key (`new.new-1.title`), or `terms.<id>.<part>` for a term's Chinese. */
  readonly key: string;
  /** The English string of the context, or the term's English name or definition; null when the context has none for the key. */
  readonly en: string | null;
  /** The context's kind of string (`title`, `part`, `lead`, `note`, `line`, `long`, `alt`); null for a term. */
  readonly zhKind: ZhStringKind | null;
  readonly cap_chars: number | null;
  readonly group: ZhGroup | null;
  /** The glossary term id for a term's Chinese, else null. */
  readonly term: string | null;
}

export interface StringEntry {
  /** Where an issue points. */
  readonly path: string;
  /** The place inside its record, in a correction's dotted form. */
  readonly at: string;
  readonly text: string;
  readonly lang: Lang;
  readonly kind: StringKind;
  readonly field: StringField | null;
  readonly nameKind: NameKind | null;
  readonly urlKind: UrlKind | null;
  /** For a correction's `before` or `after`: the prose field its `path` names (`found`, `title`, `note`, ...), else null. */
  readonly pathField: ProseField | null;
  readonly record: RecordRef;
  /** The finding (id, or `new-N` for a new one) whose record holds the string. */
  readonly finding: string | null;
  /**
   * The finding a brief-level string is about: a returning or story or item update, a rung change, the deep dive, the remarkable
   * note, and a correction's `after` (never its `before`, `reason` or the rest), in a draft and in a stored record alike;
   * null for every other string, a finding's own included (those name the finding in `finding`).
   */
  readonly about: string | null;
  readonly correction: "before" | "after" | null;
  /** True when a stored `removed` correction rewrote this string; every selector leaves it out. */
  readonly removed: boolean;
  /** True on the English entry of an `L10n` whose `zh` is null, which has no Chinese entry (LANG_PARITY's null `zh`); false on every other entry. */
  readonly zhNull: boolean;
  /**
   * True in draft and zh modes, and in published mode for the records being published: a finding first briefed on the date
   * whole, a returning finding only in the entries the date gave it (`judgedOf()`).
   */
  readonly publishing: boolean;
  /** The date to file `about` (else `finding`) on to ask whether the text is a Landmark's; null: as first published (§4.10, HYPE_WORDS). */
  readonly filedOn: IsoDate | null;
  readonly zh: ZhFacts | null;
}

export interface Inventory {
  readonly entries: readonly StringEntry[];
  /** The issue paths of leaves that matched no pattern. Empty for every schema-valid record; the tests require it. */
  readonly unclassified: readonly string[];
}

// ── The path tables ──────────────────────────────────────────────────────────────────────────────

interface Spec {
  kind: StringKind;
  field?: StringField;
  name?: NameKind;
  url?: UrlKind;
  lang?: Lang;
}

const V: Spec = { kind: "value" };
const QUOTE: Spec = { kind: "quote" };
const TITLE: Spec = { kind: "title" };
const ARTEFACT: Spec = { kind: "artefact" };
const prose = (field: ProseField): Spec => ({ kind: "prose", field });
const text = (field: TextField): Spec => ({ kind: "text", field });
const nm = (name: NameKind): Spec => ({ kind: "name", name });
const url = (u: UrlKind): Spec => ({ kind: "url", url: u });
const FALLBACK: Spec = { kind: "text" };

type Table = ReadonlyMap<string, Spec>;

/** `under("sources.*", { id: V })` is `{ "sources.*.id": V }`. */
function under(prefix: string, specs: Record<string, Spec>): Record<string, Spec> {
  return Object.fromEntries(Object.entries(specs).map(([k, v]) => [`${prefix}.${k}`, v]));
}

const table = (...parts: Record<string, Spec>[]): Table => new Map(parts.flatMap((p) => Object.entries(p)));

const EXPLAINER = {
  found: prose("found"), matters: prose("matters"), ai_helped: prose("ai_helped"), how_sure: prose("how_sure"),
  background: prose("background"), could_lead: prose("could_lead"),
};
const AI = {
  role: V, confidence: V,
  "systems.*.name": nm("system"), "systems.*.maker": nm("maker"),
  "evidence.*.source_id": V, "evidence.*.quote": QUOTE,
};
const SOURCE = {
  id: V, kind: V, title: TITLE, publisher: nm("publisher"), url: url("source"), doi: ARTEFACT, published_at: V, seen_as: V, added: V,
};
const DRAFT_SOURCE = { id: V, kind: V, title: TITLE, publisher: nm("publisher"), url: url("source"), doi: ARTEFACT, published_at: V };
const REACTION = { source_id: V, who: nm("reaction_who"), affiliation: nm("affiliation"), quote: QUOTE };
const ARTEFACTS = { "doi.*": ARTEFACT, "arxiv.*": ARTEFACT, "lean.*": url("lean"), "trial.*": ARTEFACT, "pdb.*": ARTEFACT };
const FIGURE = {
  source_id: V, image_url: url("image"), licence: V, licence_quote: QUOTE, credit: text("credit"), alt: prose("alt"),
};
const WHO = { name: nm("who"), ror: V };
const STORED_RUNG = { rung: V, date: V, recorded: V, source_id: V, by: V, note: prose("note") };
const DRAFT_RUNG = { rung: V, date: V, source_id: V, note: prose("note") };

/** A stored finding (`content/findings/<id>.json`, SPEC §4.4). */
const FINDING_TABLE: Table = table(
  { id: V, field: V, subfield: V, kind: V, title: prose("title"), depth: V, "go_deeper.*": V, significance: V, rung: V },
  under("explainer", EXPLAINER), under("ai", AI),
  under("rung_history.*", STORED_RUNG),
  { "since_then.*.date": V, "since_then.*.text": prose("since_then"), "since_then.*.source_ids.*": V },
  under("sources.*", SOURCE), under("reactions.*", REACTION), under("artefacts", ARTEFACTS), under("figure", FIGURE), under("who.*", WHO),
  { "terms.*": V, "related.*": V, first_published: V, first_brief: V, "briefs.*": V, updated: V },
);

/** A new finding of a draft (SPEC §4.5 `DraftFinding`). */
const NEW_FINDING_TABLE: Table = table(
  { ref: V, field: V, subfield: V, kind: V, title: prose("title"), "go_deeper.*": V, significance: V },
  under("explainer", EXPLAINER), under("ai", AI),
  under("rung_history.*", DRAFT_RUNG),
  under("sources.*", DRAFT_SOURCE), under("reactions.*", REACTION), under("artefacts", ARTEFACTS), under("figure", FIGURE), under("who.*", WHO),
  { "terms.*.id": V, "terms.*.term": text("term"), "terms.*.definition": prose("definition"), "related.*": V, first_published: V },
);

/** The brief-level strings of a draft: everything but `new_findings`, and a correction's `after`, which its `path` classifies. */
const DRAFT_TABLE: Table = table(
  { date: V, generated_at: V, "lead.*.text": prose("lead"), "lead.*.refs.*": V, story: V, "items.*": V },
  { "returning.*.finding_id": V, "returning.*.update": prose("update"), "returning.*.source_ids.*": V },
  under("returning.*.rung", DRAFT_RUNG), { "rung_changes.*.finding_id": V }, under("rung_changes.*.rung", DRAFT_RUNG),
  { "ideas.*.text": prose("idea"), "ideas.*.who": text("idea_who"), "ideas.*.source_id": V },
  { "also.*.title": prose("also"), "also.*.field": V, "also.*.source_id": V },
  { "deep_dive.finding_id": V, "deep_dive.text": prose("deep_dive"), "deep_dive.source_ids.*": V, "deep_dive.why_today": V },
  {
    "review.big_picture": prose("big_picture"), "review.remarkable.finding_id": V, "review.remarkable.note": prose("remarkable"),
    "review.strongest_against.text": prose("against"), "review.strongest_against.finding_ids.*": V,
    "review.strongest_against.source_ids.*": V,
  },
  {
    "corrections.*.finding_id": V, "corrections.*.edition_date": V, "corrections.*.term_id": V, "corrections.*.type": V,
    "corrections.*.path": V, "corrections.*.reason": prose("reason"),
    "corrections.*.source_url": url("correction_source"), "corrections.*.report_id": V,
  },
  { "report_decisions.*.report_id": V, "report_decisions.*.outcome": V, "report_decisions.*.reason": prose("reason") },
  under("sources.*", DRAFT_SOURCE),
);

/** A stored brief (`content/briefs/D.json`, SPEC §4.5). */
const BRIEF_TABLE: Table = table(
  {
    date: V, edition: V, format: V, published_at: V, "pace.sentence": text("pace_sentence"), "pace.status": V, "pace.metrics_file": V,
    "lead.*.text": prose("lead"), "lead.*.finding_ids.*": V,
  },
  { "story.finding_id": V, "story.update": prose("update"), "items.*.finding_id": V, "items.*.update": prose("update") },
  { "rung_changes.*.finding_id": V, "rung_changes.*.from": V, "rung_changes.*.to": V, "rung_changes.*.date": V, "rung_changes.*.by": V },
  { "ideas.*.text": prose("idea"), "ideas.*.who": text("idea_who"), "ideas.*.source_id": V },
  { "also.*.title": prose("also"), "also.*.field": V, "also.*.source_id": V },
  { "deep_dive.finding_id": V, "deep_dive.text": prose("deep_dive"), "deep_dive.source_ids.*": V, "deep_dive.why_today": V },
  {
    "review.big_picture": prose("big_picture"), "review.remarkable.finding_id": V, "review.remarkable.note": prose("remarkable"),
    "review.strongest_against.text": prose("against"), "review.strongest_against.finding_ids.*": V,
    "review.strongest_against.source_ids.*": V, "review.field_counts.*.field": V, "review.fell.*": V, "review.setbacks.*": V,
  },
  {
    "corrections.*.id": V, "corrections.*.finding_id": V, "corrections.*.edition_date": V, "corrections.*.term_id": V,
    "corrections.*.type": V, "corrections.*.reason": prose("reason"),
  },
  { "reports.*.id": V, "reports.*.finding_id": V, "reports.*.status": V },
  under("sources.*", SOURCE),
  {
    "disclosure.*": V, status_note: text("status_note"), "provenance.run_id": V, "provenance.code_commit": V,
    "provenance.data_cutoff": V,
  },
);

/** A glossary term; `en.` and `zh.` give the language (SPEC §4.9). */
const TERM_TABLE: Table = table({
  id: V,
  "en.term": { kind: "text", field: "term", lang: "en" }, "en.definition": { kind: "prose", field: "definition", lang: "en" },
  "zh.term": { kind: "text", field: "term", lang: "zh" }, "zh.definition": { kind: "prose", field: "definition", lang: "zh" },
  "zh.official": { kind: "official", lang: "zh" }, "zh.official_url": { kind: "url", url: "official", lang: "zh" },
  "fields.*": V, first_finding: V, first_date: V,
});

/** The paths a correction on a term names: the term itself and its definition (SPEC §4.5). */
const TERM_PATHS: Table = table({ term: text("term"), definition: prose("definition") });

/** A stored correction (`content/corrections.json`, SPEC §4.10); `before` and `after` take the kind of the path. */
const CORRECTION_TABLE: Table = table({
  id: V, date: V, finding_id: V, edition_date: V, term_id: V, type: V, path: V, reason: prose("reason"),
  source_url: url("correction_source"), trigger: V, report_id: V,
});

/** A stored reader report (`content/reports.json`). */
const REPORT_TABLE: Table = table({
  id: V, received: V, finding_id: V, kind: V, evidence_url: url("evidence"), status: V, decided_by: V, resolved_on: V,
  reason: prose("reason"), correction_id: V,
});

/** The path tables by record type, for the schema-driven coverage test. */
export const PATH_TABLES: Readonly<Record<"new_finding" | "draft" | "brief" | "finding" | "term" | "correction" | "report", ReadonlyMap<string, Spec>>> = {
  new_finding: NEW_FINDING_TABLE, draft: DRAFT_TABLE, brief: BRIEF_TABLE, finding: FINDING_TABLE, term: TERM_TABLE,
  correction: CORRECTION_TABLE, report: REPORT_TABLE,
};

const genericOf = (segments: readonly (string | number)[]): string => segments.map((s) => (typeof s === "number" ? "*" : s)).join(".");
const dotted = (segments: readonly (string | number)[]): string => segments.join(".");
const INDEX = /^(?:0|[1-9][0-9]*)$/;

/** The spec of the string a correction's `path` names in the record it targets; free text when the path is in no table. */
function pathSpec(target: "finding" | "brief" | "term", path: string): Spec {
  const generic = path.split(".").map((s) => (INDEX.test(s) ? "*" : s)).join(".");
  const found = (target === "finding" ? FINDING_TABLE : target === "brief" ? BRIEF_TABLE : TERM_PATHS).get(generic);
  return found ?? FALLBACK;
}

// ── Walking a record ─────────────────────────────────────────────────────────────────────────────

interface Leaf {
  segments: readonly (string | number)[];
  text: string;
  /** "zh" for the Chinese side of an `L10n`, else "en". */
  lang: Lang;
  /** True for a side of an `L10n`, whose issue path names the side. */
  l10n: boolean;
  /** True for the `en` side of an `L10n` whose `zh` is null. */
  zhNull: boolean;
}

function isL10n(value: unknown): value is { en: string; zh: string | null } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const o = value as Record<string, unknown>;
  return keys.length === 2 && keys.includes("en") && keys.includes("zh") && typeof o.en === "string" && (o.zh === null || typeof o.zh === "string");
}

/** Every string leaf of `value`, in document order; an `L10n` gives its `en` and then its `zh` when it has one. */
function leavesOf(value: unknown, skip: ReadonlySet<string> | null = null): Leaf[] {
  const out: Leaf[] = [];
  const walk = (v: unknown, segments: (string | number)[], skipHere: ReadonlySet<string> | null): void => {
    if (typeof v === "string") {
      out.push({ segments, text: v, lang: "en", l10n: false, zhNull: false });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, [...segments, i], null));
    } else if (isL10n(v)) {
      out.push({ segments, text: v.en, lang: "en", l10n: true, zhNull: v.zh === null });
      if (v.zh !== null) out.push({ segments, text: v.zh, lang: "zh", l10n: true, zhNull: false });
    } else if (typeof v === "object" && v !== null) {
      for (const [k, x] of Object.entries(v)) if (!skipHere?.has(k)) walk(x, [...segments, k], null);
    }
  };
  walk(value, [], skip);
  return out;
}

/** What differs between the record types: where an issue points, and the facts a record gives about its strings. */
interface Ctx {
  record: RecordRef;
  table: Table;
  /** Whether the record's strings are being published: all or none, or decided by each string's place in the record (a returning finding's). */
  publishing: boolean | ((segments: readonly (string | number)[]) => boolean);
  finding: string | null;
  /** The issue path of a leaf, from its segments (the language is added for an `L10n` side). */
  where: (segments: readonly (string | number)[]) => string;
  /** The place inside the record: by default the segments joined with dots. */
  atOf?: (segments: readonly (string | number)[]) => string;
  filedOn: (segments: readonly (string | number)[]) => IsoDate | null;
  about: (segments: readonly (string | number)[]) => string | null;
  /** A leaf that is a correction's `before` or `after`: its spec comes from the correction's path. */
  correctionSpec?: (generic: string, segments: readonly (string | number)[]) => { spec: Spec; side: "before" | "after"; pathField: ProseField | null } | null;
  removedAt: ReadonlySet<string> | undefined;
  skip?: ReadonlySet<string>;
}

function emit(ctx: Ctx, value: unknown, entries: StringEntry[], unclassified: string[]): void {
  for (const leaf of leavesOf(value, ctx.skip ?? null)) {
    const generic = genericOf(leaf.segments);
    const at = ctx.atOf ? ctx.atOf(leaf.segments) : dotted(leaf.segments);
    const side = ctx.correctionSpec?.(generic, leaf.segments) ?? null;
    let spec = side?.spec ?? ctx.table.get(generic);
    const path = leaf.l10n ? `${ctx.where(leaf.segments)}.${leaf.lang}` : ctx.where(leaf.segments);
    if (spec === undefined) {
      unclassified.push(path);
      spec = FALLBACK;
    }
    let field: StringField | null = spec.field ?? null;
    if (side !== null && spec.kind === "prose") field = side.side;
    entries.push({
      path, at, text: leaf.text, lang: spec.lang ?? leaf.lang, kind: spec.kind, field,
      nameKind: spec.name ?? null, urlKind: spec.url ?? null, pathField: side?.pathField ?? null,
      record: ctx.record, finding: ctx.finding, about: ctx.about(leaf.segments), correction: side?.side ?? null,
      removed: ctx.removedAt?.has(at) ?? false, zhNull: leaf.zhNull, publishing: typeof ctx.publishing === "boolean" ? ctx.publishing : ctx.publishing(leaf.segments),
      filedOn: ctx.filedOn(leaf.segments), zh: null,
    });
  }
}

const NO_ABOUT = (): null => null;
const NO_DATE = (): null => null;
const PROSE_FIELDS_OF_PATH: ReadonlySet<string> = new Set([
  "title", "found", "matters", "ai_helped", "how_sure", "background", "could_lead", "note", "alt", "since_then", "definition",
]);
const proseFieldOf = (spec: Spec): ProseField | null =>
  spec.kind === "prose" && spec.field !== undefined && PROSE_FIELDS_OF_PATH.has(spec.field) ? (spec.field as ProseField) : null;

// ── The inventory of a draft ─────────────────────────────────────────────────────────────────────

/** Every string of an English draft, with its facts. Draft strings are all being published, and none is removed. */
export function draftInventory(draft: DraftBrief): Inventory {
  const entries: StringEntry[] = [];
  const unclassified: string[] = [];
  const date = draft.date;

  const aboutOf = (segments: readonly (string | number)[]): string | null => {
    const [head, index] = segments;
    if (typeof index === "number" && (head === "returning" || head === "rung_changes")) {
      const part = segments[2];
      if (head === "rung_changes" || part === "update" || part === "rung") return draft[head][index]?.finding_id ?? null;
    }
    if (head === "deep_dive" && segments[1] === "text") return draft.deep_dive?.finding_id ?? null;
    if (head === "review" && segments[1] === "remarkable" && segments[2] === "note") return draft.review?.remarkable?.finding_id ?? null;
    if (head === "corrections" && typeof index === "number" && segments[2] === "after") return draft.corrections[index]?.finding_id ?? null;
    return null;
  };

  const editionCtx: Ctx = {
    record: { type: "draft", id: date },
    table: DRAFT_TABLE,
    publishing: true,
    finding: null,
    where: (segments) => formatPath(segments),
    filedOn: () => date,
    about: aboutOf,
    removedAt: undefined,
    skip: new Set(["new_findings"]),
    correctionSpec: (generic, segments) => {
      if (generic !== "corrections.*.after") return null;
      const c = draft.corrections[segments[1] as number];
      if (c === undefined) return null;
      const target = c.finding_id !== null ? "finding" : c.edition_date !== null ? "brief" : "term";
      const spec = pathSpec(target, c.path);
      return { spec, side: "after", pathField: proseFieldOf(spec) };
    },
  };
  emit(editionCtx, draft, entries, unclassified);

  draft.new_findings.forEach((f, i) => {
    emit({
      record: { type: "new_finding", id: f.ref },
      table: NEW_FINDING_TABLE,
      publishing: true,
      finding: f.ref,
      where: (segments) => formatPath(["new_findings", i, ...segments]),
      // A new finding is first published today: its text is filed as first published, and a rung note on its recorded date.
      filedOn: (segments) => (segments[0] === "rung_history" ? date : null),
      about: NO_ABOUT,
      removedAt: undefined,
    }, f, entries, unclassified);
  });
  return { entries, unclassified };
}

// ── The inventory of stored records ──────────────────────────────────────────────────────────────

// ── Removed text ─────────────────────────────────────────────────────────────────────────────────
// One definition of a removed string, for the inventory, the views, the rules that skip a removed string and XREF (SPEC §4.12 "Removed
// text"): a string counts as removed only where a stored `removed` correction names its path AND the record's text there IS
// REMOVED_TEXT. Text at a removed path that is anything else is judged by every rule as usual, and XREF reports the mismatch.

/**
 * The value at a correction's dotted path (`explainer.how_sure`, `sources.1.url`; indices from 0), or `undefined` when the record has
 * none.
 */
function valueAt(record: unknown, path: string): { readonly value: unknown } | undefined {
  let cur: unknown = record;
  for (const key of path.split(".")) {
    if (Array.isArray(cur)) {
      if (!INDEX.test(key) || Number(key) >= cur.length) return undefined;
      cur = cur[Number(key)];
    } else if (typeof cur === "object" && cur !== null && Object.hasOwn(cur, key)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return { value: cur };
}

/** REMOVED_TEXT as a record holds it: an `L10n` that is it in both languages, or a plain string that is its English. */
export function isRemovedText(value: unknown): boolean {
  if (typeof value === "string") return value === REMOVED_TEXT.en;
  return isL10n(value) && value.en === REMOVED_TEXT.en && value.zh === REMOVED_TEXT.zh;
}

/**
 * What a `removed` correction left of its path in the record it names: "missing" (no value there, a null included), "other" (other
 * text, a half-removed `L10n` included), or null (REMOVED_TEXT). A term's `definition` is its English and, while the term has any
 * Chinese, its Chinese (a term whose `zh` is null has none to rewrite).
 */
export function removalProblem(record: Finding | Brief | Term, path: string): "missing" | "other" | null {
  if ("en" in record && "first_finding" in record && path === "definition") {
    const zh = record.zh === null ? null : record.zh.definition;
    const holds = record.en.definition === REMOVED_TEXT.en && (zh === null || zh === REMOVED_TEXT.zh);
    return holds ? null : "other";
  }
  const found = valueAt(record, path);
  if (found === undefined || found.value === null) return "missing";
  return isRemovedText(found.value) ? null : "other";
}

/** The stored records a `removed` correction can name, to read what each holds at the path (a record that is not given is not read). */
export interface RemovalRecords {
  readonly findings: readonly Finding[];
  readonly briefs: readonly Brief[];
  readonly terms: readonly Term[];
}

/**
 * The strings that stored `removed` corrections rewrote, by record (`finding:<id>`, `brief:<date>`, `term:<id>`): the `at` of each
 * correction whose path holds REMOVED_TEXT in the record it names (`removalProblem()` is null). A path that holds other text, or no
 * text, and a record that `records` does not hold, give no entry: that text is judged as any other, and XREF reports the correction
 * (SPEC §4.12 "Removed text"). Keyed on the correction and the record's text together, so `REMOVED_TEXT` written anywhere else is not a hit.
 */
export function removedPaths(
  corrections: readonly Pick<Correction, "finding_id" | "edition_date" | "term_id" | "type" | "path">[], records: RemovalRecords,
): ReadonlyMap<string, ReadonlySet<string>> {
  const findingBy = new Map(records.findings.map((f) => [f.id, f]));
  const briefBy = new Map(records.briefs.map((b) => [b.date, b]));
  const termBy = new Map(records.terms.map((t) => [t.id, t]));
  const out = new Map<string, Set<string>>();
  for (const c of corrections) {
    if (c.type !== "removed") continue;
    const [key, record] = c.finding_id !== null ? [`finding:${c.finding_id}`, findingBy.get(c.finding_id)] as const
      : c.edition_date !== null ? [`brief:${c.edition_date}`, briefBy.get(c.edition_date)] as const
      : c.term_id !== null ? [`term:${c.term_id}`, termBy.get(c.term_id)] as const : [null, undefined] as const;
    if (key === null || record === undefined || removalProblem(record, c.path) !== null) continue;
    const set = out.get(key) ?? new Set<string>();
    set.add(c.path);
    out.set(key, set);
  }
  return out;
}

// ── What a run judges of a stored finding ────────────────────────────────────────────────────────

/** The three lists of a stored finding that an edition adds entries to (SPEC §4.4, §8.7). */
export const NEW_PARTS = ["rung_history", "since_then", "sources"] as const satisfies readonly (keyof NewParts)[];

/**
 * How much of a stored finding the run judges as being published (SPEC §4.12 "Stored records"): `whole`, for a finding first briefed on
 * the date being published; `none`, for any other finding that the date left alone; and for a returning finding the date gave text,
 * only that text (its `NewParts`), while its title, explainer, figure and every older entry and source stay archived records.
 */
export type Judged = "whole" | "none" | NewParts;

export function judgedOf(being: BeingPublished, id: string): Judged {
  if (!being.findings.has(id)) return "none";
  return being.parts.get(id) ?? "whole";
}

/** Whether entry `index` of `part`, one of a finding's lists, is judged as being published. */
export const judgesPart = (judged: Judged, part: keyof NewParts, index: number): boolean =>
  typeof judged === "string" ? judged === "whole" : judged[part].has(index);

/** Whether the string at `segments` of a stored finding's record is judged as being published: any string of a whole finding, and in a returning one only those inside a new entry. */
function judgesSegments(judged: Judged, segments: readonly (string | number)[]): boolean {
  if (typeof judged === "string") return judged === "whole";
  const [part, index] = segments;
  const name = NEW_PARTS.find((n) => n === part);
  return name !== undefined && typeof index === "number" && judged[name].has(index);
}

export interface PublishedStrings {
  brief: Brief | null;
  findings: readonly Finding[];
  terms: readonly Term[];
  corrections: readonly Correction[];
  reports: readonly Report[];
  being: BeingPublished;
}

/** The file a stored record lives in, as an issue path names it. */
export const files = {
  brief: (date: string): string => `briefs/${date}.json`,
  finding: (id: string): string => `findings/${id}.json`,
  glossary: "glossary.json",
  corrections: "corrections.json",
  reports: "reports.json",
} as const;

const inFile = (file: string, segments: readonly (string | number)[]): string => `${file}: ${formatPath(segments)}`;

/** Every string of a stored brief, the findings, terms, corrections and reports a run reads, with its facts. */
export function publishedInventory(input: PublishedStrings): Inventory {
  const entries: StringEntry[] = [];
  const unclassified: string[] = [];
  const removed = removedPaths(input.corrections, { findings: input.findings, briefs: input.brief === null ? [] : [input.brief], terms: input.terms });

  const brief = input.brief;
  if (brief !== null) {
    const about = (segments: readonly (string | number)[]): string | null => {
      const [head, index] = segments;
      if (head === "story" && segments[1] === "update") return brief.story?.finding_id ?? null;
      if (head === "items" && typeof index === "number" && segments[2] === "update") return brief.items[index]?.finding_id ?? null;
      if (head === "deep_dive" && segments[1] === "text") return brief.deep_dive?.finding_id ?? null;
      if (head === "review" && segments[1] === "remarkable" && segments[2] === "note") return brief.review?.remarkable?.finding_id ?? null;
      return null;
    };
    emit({
      record: { type: "brief", id: brief.date }, table: BRIEF_TABLE, publishing: input.being.brief, finding: null,
      where: (segments) => inFile(files.brief(brief.date), segments), filedOn: () => brief.date, about,
      removedAt: removed.get(`brief:${brief.date}`),
    }, brief, entries, unclassified);
  }

  for (const f of input.findings) {
    const judged = judgedOf(input.being, f.id);
    emit({
      record: { type: "finding", id: f.id }, table: FINDING_TABLE, publishing: (segments) => judgesSegments(judged, segments), finding: f.id,
      where: (segments) => inFile(files.finding(f.id), segments),
      // A finding's text is as first published; a rung note is dated by its `recorded`, a returning update by its own date.
      filedOn: (segments) => {
        const index = segments[1];
        if (typeof index !== "number") return null;
        if (segments[0] === "rung_history" && segments[2] === "note") return f.rung_history[index]?.recorded ?? null;
        if (segments[0] === "since_then" && segments[2] === "text") return f.since_then[index]?.date ?? null;
        return null;
      },
      about: NO_ABOUT, removedAt: removed.get(`finding:${f.id}`),
    }, f, entries, unclassified);
  }

  input.terms.forEach((term, i) => {
    emit({
      record: { type: "term", id: term.id }, table: TERM_TABLE, publishing: input.being.terms.has(term.id), finding: null,
      where: (segments) => inFile(files.glossary, ["terms", i, ...segments]),
      // The correction paths on a term are `term` and `definition`, whichever language they rewrote.
      atOf: (segments) => dotted(segments[0] === "en" || segments[0] === "zh" ? segments.slice(1) : segments),
      filedOn: NO_DATE, about: NO_ABOUT, removedAt: removed.get(`term:${term.id}`),
    }, term, entries, unclassified);
  });

  input.corrections.forEach((c, i) => {
    const target = c.finding_id !== null ? "finding" : c.edition_date !== null ? "brief" : "term";
    const spec = pathSpec(target, c.path);
    emit({
      record: { type: "correction", id: c.id }, table: CORRECTION_TABLE, publishing: input.being.corrections.has(c.id), finding: null,
      where: (segments) => inFile(files.corrections, ["corrections", i, ...segments]),
      // Only its `after` is the finding's text, as in a draft; its `before` is exempt from every text test (§4.12 Stored
      // records) and its reason and the rest are the correction's own, so neither is a Landmark's text.
      filedOn: () => c.date, about: (segments) => (segments[0] === "after" ? c.finding_id : null), removedAt: undefined,
      correctionSpec: (generic) =>
        generic === "before" || generic === "after" ? { spec, side: generic, pathField: proseFieldOf(spec) } : null,
    }, c, entries, unclassified);
  });

  input.reports.forEach((r, i) => {
    emit({
      record: { type: "report", id: r.id }, table: REPORT_TABLE, publishing: input.being.reports.has(r.id), finding: null,
      where: (segments) => inFile(files.reports, ["reports", i, ...segments]),
      filedOn: NO_DATE, about: NO_ABOUT, removedAt: undefined,
    }, r, entries, unclassified);
  });
  return { entries, unclassified };
}

// ── The inventory of the Chinese draft ───────────────────────────────────────────────────────────

/** What a context key names (SPEC §4.6): its section, the finding it belongs to and the prose field it is. */
export interface ZhKeyInfo {
  readonly key: string;
  readonly section: "lead" | "new" | "returning" | "rung" | "ideas" | "also" | "deep_dive" | "review" | "corrections" | "reports" | "backlog";
  /** `new-N` for a new finding's key, a finding id for a returning, rung-change or backlog key; else null. */
  readonly finding: string | null;
  readonly field: ProseField;
  /** The list index in the key (`lead.0`, `new.new-1.rung.2`, `corrections.1.after`), else null. */
  readonly index: number | null;
}

const PARTS = new Set<string>(EXPLAINER_FIELDS);

/** Parses a key of the Chinese context (SPEC §4.6); null for a key no section of the spec has. */
export function parseZhKey(key: string): ZhKeyInfo | null {
  const p = key.split(".");
  const num = (s: string | undefined): number | null => (s !== undefined && INDEX.test(s) ? Number(s) : null);
  const mk = (section: ZhKeyInfo["section"], finding: string | null, field: ProseField, index: number | null = null): ZhKeyInfo => ({ key, section, finding, field, index });
  const [a, b, c, d] = p;
  if (a === "lead" && p.length === 2 && num(b) !== null) return mk("lead", null, "lead", num(b));
  if (a === "ideas" && p.length === 2 && num(b) !== null) return mk("ideas", null, "idea", num(b));
  if (a === "also" && p.length === 2 && num(b) !== null) return mk("also", null, "also", num(b));
  if (key === "deep_dive") return mk("deep_dive", null, "deep_dive");
  if (key === "review.big_picture") return mk("review", null, "big_picture");
  if (key === "review.remarkable") return mk("review", null, "remarkable");
  if (key === "review.strongest_against") return mk("review", null, "against");
  if (a === "corrections" && p.length === 3 && num(b) !== null && (c === "after" || c === "reason")) return mk("corrections", null, c, num(b));
  if (a === "reports" && p.length === 3 && b !== undefined && c === "reason") return mk("reports", b, "reason");
  if (a === "rung" && p.length === 2 && b !== undefined) return mk("rung", b, "note");
  if (a === "returning" && p.length === 3 && b !== undefined) {
    if (c === "update") return mk("returning", b, "update");
    if (c === "rung") return mk("returning", b, "note");
  }
  if ((a === "new" || a === "backlog") && b !== undefined) {
    const section = a;
    if (p.length === 3 && c === "title") return mk(section, b, "title");
    if (p.length === 4 && c === "explainer" && d !== undefined && PARTS.has(d)) return mk(section, b, d as ProseField);
    if (p.length === 4 && c === "figure" && d === "alt") return mk(section, b, "alt");
    if (p.length === 4 && c === "rung" && num(d) !== null) return mk(section, b, "note", num(d));
    if (section === "backlog" && p.length === 4 && c === "since" && num(d) !== null) return mk(section, b, "since_then", num(d));
  }
  return null;
}

/**
 * The Chinese draft's strings as entries: each `strings` value with its context key, English, kind, cap and group, and each
 * term's Chinese name, definition and official. A key the context lacks is still an entry (ZH_KEYS reports it); a string key
 * whose shape no section has is classified as free text and listed in `unclassified`.
 */
export function zhInventory(draft: DraftZh, context: ZhContext): Inventory {
  const entries: StringEntry[] = [];
  const unclassified: string[] = [];
  const byKey = new Map(context.strings.map((s) => [s.key, s]));
  const termById = new Map(context.terms.map((t) => [t.id, t]));
  const base = { at: "", nameKind: null, urlKind: null, pathField: null, correction: null, removed: false, zhNull: false, publishing: true, filedOn: null, about: null } as const;

  for (const [key, value] of Object.entries(draft.strings)) {
    const info = parseZhKey(key);
    const ctx = byKey.get(key);
    const path = formatPath(["strings", key]);
    if (info === null) unclassified.push(path);
    entries.push({
      ...base, path, at: key, text: value, lang: "zh", kind: info === null ? "text" : "prose", field: info?.field ?? null,
      record: { type: "zh", id: null }, finding: info?.finding ?? null,
      zh: { key, en: ctx?.en ?? null, zhKind: ctx?.kind ?? null, cap_chars: ctx?.cap_chars ?? null, group: ctx?.group ?? null, term: null },
    });
  }
  for (const [id, term] of Object.entries(draft.terms)) {
    const ctx = termById.get(id);
    const zh = (part: "zh" | "definition" | "official" | "official_url", en: string | null): Pick<StringEntry, "zh"> => ({
      zh: { key: `terms.${id}.${part}`, en, zhKind: null, cap_chars: part === "definition" ? ctx?.cap_chars ?? null : null, group: null, term: id },
    });
    const at = (part: string) => ({ at: part, path: formatPath(["terms", id, part]), record: { type: "zh", id } as RecordRef, finding: null });
    entries.push({ ...base, ...at("zh"), text: term.zh, lang: "zh", kind: "text", field: "term", ...zh("zh", ctx?.en ?? null) });
    entries.push({ ...base, ...at("definition"), text: term.definition, lang: "zh", kind: "prose", field: "definition", ...zh("definition", ctx?.definition ?? null) });
    if (term.official !== null) entries.push({ ...base, ...at("official"), text: term.official, lang: "zh", kind: "official", field: null, ...zh("official", null) });
    if (term.official_url !== null) entries.push({ ...base, ...at("official_url"), text: term.official_url, lang: "zh", kind: "url", field: null, ...{ urlKind: "official" as const }, ...zh("official_url", null) });
  }
  return { entries, unclassified };
}

// ── The selectors ────────────────────────────────────────────────────────────────────────────────
// One per set that a §4.12 row names. Each leaves out a removed string; `removedProse()` is the one that returns them.

const live = (inv: Inventory): StringEntry[] => inv.entries.filter((e) => !e.removed);
const TEXTUAL: ReadonlySet<StringKind> = new Set(["prose", "name", "text", "url", "artefact"]);

/**
 * Model prose (WORDS, SENTENCE_LENGTH, NUMBER_SOURCED): the English prose a model wrote, a correction's `after` and
 * `reason` included, never a correction's `before` (copied from text published earlier), a quote, a title or a name.
 */
export const modelProse = (inv: Inventory): StringEntry[] =>
  live(inv).filter((e) => e.kind === "prose" && e.lang === "en" && e.correction !== "before");

/** The model prose that a stored `removed` correction rewrote: WORDS counts it as no words and drops the lower bound it counts in. */
export const removedProse = (inv: Inventory): StringEntry[] =>
  inv.entries.filter((e) => e.removed && e.kind === "prose" && e.lang === "en" && e.correction !== "before");

/**
 * NO_EM_DASH: every English string of a draft or a stored record but the Chinese text and the text kept as published, which
 * are a quote, a source's title and a correction's `before` and `after` when its path names one of those. The ids, dates and
 * vocabulary values hold no dash, and a term's `official` is Chinese, so neither is here.
 */
export const dashStrings = (inv: Inventory): StringEntry[] =>
  live(inv).filter((e) => e.lang === "en" && TEXTUAL.has(e.kind));

/**
 * HYPE_WORDS: NO_EM_DASH's set without the addresses (a source's `url`, a figure's `image_url`, a correction's `source_url`,
 * a report's `evidence_url`, a Lean artefact), the identifiers (a DOI and its like are read as addresses), the names (a
 * publisher, a `who` entry, a reaction's `who` and `affiliation`, an AI system and its maker, and a correction's `after` at
 * one of those paths) and a correction's `before`. So it never reads a quote, a source's title, an address, a name or a `before`.
 */
export const hypeStrings = (inv: Inventory): StringEntry[] =>
  dashStrings(inv).filter((e) => e.kind !== "url" && e.kind !== "name" && e.kind !== "artefact" && e.correction !== "before");

/** DUAL_USE: every string of either draft, whatever its key and language, quotes, names, titles and addresses included. */
export const dualUseStrings = (inv: Inventory): StringEntry[] => live(inv).filter((e) => e.kind !== "value");

/** SECRET_LIKE and CANARY: every string there is, ids and vocabulary values included, in both languages. */
export const everyString = (inv: Inventory): StringEntry[] => live(inv);

/**
 * BLOCKED_HOST: every string of a draft, a stored record or the Chinese draft, in both languages (the Chinese side of an `L10n`, the
 * Chinese draft's strings and a term's `official_url` included: ZH_PARITY, which keeps a URL out of a Chinese string, does not read
 * an `official_url` and misses an address written against a Han character); the entry's `urlKind` and `kind` tell the rule which
 * test it gets (a source's `url`, a figure's `image_url`, a correction's `source_url` and a Lean artefact by entry type; every other
 * string by the URLs and bare hosts it holds).
 */
export const blockedHostStrings = (inv: Inventory): StringEntry[] => live(inv).filter((e) => e.kind !== "value");

/** Every address (a source's `url`, a figure's `image_url`, a correction's `source_url`, a report's `evidence_url`, a Lean artefact, a term's `official_url`). */
export const urlStrings = (inv: Inventory): StringEntry[] => live(inv).filter((e) => e.kind === "url");

/** The six explainer parts of every finding, in English (READING_LEVEL, TERM_DEFINED): group them by `finding`. A correction's text has the field `before` or `after`, so it is never one. */
export const explainerStrings = (inv: Inventory): StringEntry[] =>
  live(inv).filter((e) => e.kind === "prose" && e.lang === "en" && e.field !== null && (EXPLAINER_FIELDS as readonly string[]).includes(e.field));

/** READING_LEVEL: each explainer, the Lead, the deep dive and the big picture, without a removed string. */
export const readingStrings = (inv: Inventory): StringEntry[] =>
  live(inv).filter((e) => e.kind === "prose" && e.lang === "en"
    && e.field !== null && ((EXPLAINER_FIELDS as readonly string[]).includes(e.field) || e.field === "lead" || e.field === "deep_dive" || e.field === "big_picture"));

/** A term's definition, in English (TERM_DEFINED: a definition uses no undefined jargon word). */
export const definitionStrings = (inv: Inventory): StringEntry[] =>
  live(inv).filter((e) => e.kind === "prose" && e.lang === "en" && e.field === "definition");

/**
 * The quote strings of a finding or a stored record (evidence, reactions, `licence_quote`), never a correction's text at a quote path:
 * the inventory's statement of the set §4.12's QUOTE_VERBATIM row names, which tests/rules-strings.test.ts holds to that row. The rule
 * itself walks each finding view's quotes (`quotesOf()`, grounding.ts), since it needs the source each quote cites, and reads a
 * correction's text at a quote path through `rewritesAt()`; no rule reads this selector.
 */
export const quoteStrings = (inv: Inventory): StringEntry[] => live(inv).filter((e) => e.kind === "quote" && e.correction === null);

/**
 * WORDS' page total, by default: the model prose a brief's page shows. That is the Lead, an update, an idea, an Also noted
 * title, the deep dive, the big picture, the remarkable note and the strongest evidence against, and the title and first
 * four explainer parts of each finding the edition shows as new, with the background and could-lead of the story too.
 * `depthOf(finding)` says how the page shows a finding that is new in this edition (the story of the day or an item), or
 * null for any other, whose text the page does not repeat (SPEC §4.5).
 */
export function pageProse(inv: Inventory, depthOf: (finding: string) => "story" | "item" | null): StringEntry[] {
  const brief: readonly string[] = ["lead", "update", "idea", "also", "deep_dive", "big_picture", "remarkable", "against"];
  const shown: readonly string[] = ["title", "found", "matters", "ai_helped", "how_sure"];
  return modelProse(inv).filter((e) => {
    if (e.field === null) return false;
    if (e.record.type !== "finding" && e.record.type !== "new_finding") return brief.includes(e.field);
    const depth = e.finding === null ? null : depthOf(e.finding);
    if (depth === null) return false;
    return shown.includes(e.field) || (depth === "story" && (e.field === "background" || e.field === "could_lead"));
  });
}

// The Chinese sets. A `before` is never read (SPEC §4.12 "Stored records").
const zhLive = (inv: Inventory): StringEntry[] => live(inv).filter((e) => e.lang === "zh" && e.correction !== "before");

/** ZH_TRADITIONAL: every Chinese string, a term's `official` included. */
export const zhAll = (inv: Inventory): StringEntry[] => zhLive(inv).filter((e) => e.kind !== "value" && e.kind !== "url");

/** ZH_NO_DASH, ZH_AVOID, ZH_HYPE: the Chinese prose and names, and each term's Chinese and definition, but not an `official`. */
export const zhText = (inv: Inventory): StringEntry[] => zhLive(inv).filter((e) => e.kind === "prose" || e.kind === "text");

/** ZH_PARITY, ZH_KEYS and the length rules: the entries that carry a context key, strings and term parts. */
export const zhKeyed = (inv: Inventory): StringEntry[] => inv.entries.filter((e) => e.zh !== null);
