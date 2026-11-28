// The shared world of the fixtures (SPEC §4.12 "Fixtures and tests"): the editions and their times, the invented sources
// and findings, and the functions that read each one as a draft's new finding, as a stored `Finding`, as a glossary
// term, as a stored report or as a stored correction. Every drafts, context, evidence, pack, Chinese-draft and sample
// site fixture reads this one world, so a fact (a date, a number, a quote, an id) is written once and agrees
// everywhere. The sources are `world-sources.ts` and the findings `world-findings.ts`; this file holds what ties them
// together.
//
// Dates are Taipei dates. The four editions of the valid drafts (SPEC §4.12):
//   weekday       Wednesday 2026-10-14: the story (a sealed scroll), three more new findings, a returning finding and a rung
//                 change, with two reports and two corrections
//   sunday        Sunday 2026-10-18: one new finding and a deep dive on a biology finding of the Ledger
//   monday        Monday 2026-10-12: one new finding and the review of the week 2026-10-05 to 2026-10-11 (a setback, a
//                 finding that fell)
//   monday-short  Monday 2026-11-02: the review of a week with no finding
//
// Cyber's fixtures/src/world.ts at the fork commit 3ced1fb, adapted: its EditionName/EDITIONS table of times (one
// `times()` builder, one place for windows, cutoffs and deadlines), its keyed source table with the text the run saw and its
// `draftSources()` are the pattern; the editions, the findings, the stored-record views, the glossary, the reports and the
// corrections are this project's (Cyber's flaw, exploit and region data are dropped).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, dataCutoffFor, lastSunday, weekday } from "../../lib/dates";
import { byCodeUnit } from "../../lib/ids";
import { normalizeUrl } from "../../lib/urls";
import { formatForWeekday, type Format } from "../../lib/vocab";
import type { DraftFinding, DraftTerm } from "../../lib/schema/draft";
import type { DraftSource, L10n, ReportKind, RungEntry } from "../../lib/schema/common";
import { Finding } from "../../lib/schema/finding";
import { GlossaryFile, Term } from "../../lib/schema/glossary";
import { Correction, Report } from "../../lib/schema/misc";
import { FINDING_KEYS, FINDING_TABLE, type FindingKey, type FindingSpec, type RungSpec } from "./world-findings";
import { SOURCE_TABLE, type SourceKey, type SourceSpec } from "./world-sources";

export { FINDING_KEYS, FINDING_TABLE, SOURCE_TABLE };
export type { FindingKey, FindingSpec, SourceKey, SourceSpec };

// ── Paths and editions ───────────────────────────────────────────────────────────────────────────

/** The repo root: fixtures/src/world.ts sits two folders below it. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURES_DIR = path.join(REPO_ROOT, "fixtures");

/** The four editions the valid drafts, contexts, evidence, packs and metrics are built for. */
export const EDITION_NAMES = ["weekday", "sunday", "monday", "monday-short"] as const;
export type EditionName = (typeof EDITION_NAMES)[number];

export interface EditionTimes {
  name: EditionName;
  /** The edition's Taipei date. */
  date: string;
  format: Format;
  /** The pack window: 24 hours ending at `pack.window_end` (03:15 Taipei) on `date`. */
  window: { start: string; end: string };
  /** The brief's `data_cutoff`: the last Sunday on or before `date` minus 2 (SPEC §4.1). */
  cutoff: string;
  /** When the feeds were collected, just after the window ends. */
  packAt: string;
  /** When the context was built; the deadline is half an hour after. */
  contextAt: string;
  /** The draft's `generated_at`: between the window's end and the deadline. */
  generatedAt: string;
  deadline: string;
  /** The arXiv announcement inside the window, null when the window holds none (no mailing on a Saturday or Sunday evening). */
  arxivAnnouncement: string | null;
  /** The week a Monday reviews (Monday to Sunday), null on the other days. */
  week: { start: string; end: string } | null;
}

function times(name: EditionName, date: string, generated: string, arxivAnnouncement: string | null): EditionTimes {
  const format = formatForWeekday(weekday(date));
  return {
    name,
    date,
    format,
    window: { start: `${addDays(date, -1)}T03:15:00+08:00`, end: `${date}T03:15:00+08:00` },
    cutoff: lastSunday(dataCutoffFor(date)),
    packAt: `${date}T03:16:20+08:00`,
    contextAt: `${date}T03:19:00+08:00`,
    generatedAt: `${date}T${generated}+08:00`,
    deadline: `${date}T03:49:00+08:00`,
    arxivAnnouncement,
    week: format === "monday_review" ? { start: addDays(date, -7), end: addDays(date, -1) } : null,
  };
}

export const EDITIONS: Readonly<Record<EditionName, EditionTimes>> = {
  weekday: times("weekday", "2026-10-14", "03:41:18", "2026-10-13T08:00:00+08:00"),
  sunday: times("sunday", "2026-10-18", "03:43:07", null),
  monday: times("monday", "2026-10-12", "03:44:52", null),
  "monday-short": times("monday-short", "2026-11-02", "03:36:40", null),
};

// ── Sources ──────────────────────────────────────────────────────────────────────────────────────

export const SOURCE_KEYS = Object.keys(SOURCE_TABLE) as SourceKey[];
export const sourceSpec = (key: SourceKey): SourceSpec => SOURCE_TABLE[key];

const KEY_OF_URL = new Map<string, SourceKey>(SOURCE_KEYS.map((k) => [normalizeUrl(SOURCE_TABLE[k].url), k]));

/** The key of the source at a URL (compared through `normalizeUrl()`), or undefined for an address the world does not hold. */
export const sourceKeyOfUrl = (url: string): SourceKey | undefined => KEY_OF_URL.get(normalizeUrl(url));

/** The text the run saw at a source's page: its title, then the page's own text (the pack candidate's title and abstract, or the fetched page). */
export const seenText = (key: SourceKey): string => `${SOURCE_TABLE[key].title}\n${SOURCE_TABLE[key].text}`;

/** The text the run saw at a URL the world holds, or undefined. */
export const seenTextOfUrl = (url: string): string | undefined => {
  const key = sourceKeyOfUrl(url);
  return key === undefined ? undefined : seenText(key);
};

/** A source as a draft carries it: `s1`, `s2`, ... in a finding and `b1`, `b2`, ... at brief level, in the order of `keys`. */
export function draftSources(keys: readonly SourceKey[], prefix: "s" | "b"): DraftSource[] {
  return keys.map((key, i) => {
    const s = SOURCE_TABLE[key];
    return { id: `${prefix}${i + 1}`, kind: s.kind, title: s.title, publisher: s.publisher, url: s.url, doi: s.doi, published_at: s.published_at };
  });
}

/** The ids `draftSources(keys, prefix)` gives, by key. */
export function sourceIds(keys: readonly SourceKey[], prefix: "s" | "b"): Record<string, string> {
  return Object.fromEntries(keys.map((key, i) => [key, `${prefix}${i + 1}`]));
}

// ── Findings ─────────────────────────────────────────────────────────────────────────────────────

export const FINDING_SPECS = FINDING_TABLE;
export const findingSpec = (key: FindingKey): FindingSpec => FINDING_TABLE[key];
export const findingId = (key: FindingKey): string => FINDING_TABLE[key].id;

const KEY_OF_ID = new Map<string, FindingKey>(FINDING_KEYS.map((k) => [FINDING_TABLE[k].id, k]));
/** The key of a finding id the world holds, or undefined. */
export const findingKeyOfId = (id: string): FindingKey | undefined => KEY_OF_ID.get(id);

/** The edition that first showed the finding. */
export const firstBrief = (key: FindingKey): string => FINDING_TABLE[key].briefs[0]!;

/** The findings stored before `date` (those whose first brief is earlier), in publication order. */
export const keysStoredBefore = (date: string): FindingKey[] => FINDING_KEYS.filter((k) => firstBrief(k) < date);

/** The findings whose first brief is `date`, in display order. */
export const keysFirstShownOn = (date: string): FindingKey[] => FINDING_KEYS.filter((k) => firstBrief(k) === date);

/** A glossary term's id: the English term in kebab case (SPEC §4.3). */
export const termId = (term: string): string => term.toLowerCase().replaceAll(" ", "-");

const l10n = (en: string): L10n => ({ en, zh: null });
const enOf = (note: string | L10n | null): string | null => (note === null ? null : typeof note === "string" ? note : note.en);

/** The finding as its draft carries it on its first brief: the sources, rung entries and notes the agent wrote that day. */
export function draftFinding(key: FindingKey, ref: string): DraftFinding {
  const spec = FINDING_TABLE[key];
  const first = firstBrief(key);
  const used = spec.sources.filter((s) => s.added === first).map((s) => s.key);
  const ids = sourceIds(used, "s");
  const id = (k: SourceKey): string => {
    const found = ids[k];
    if (found === undefined) throw new Error(`${key}: ${k} is not a source of its first brief`);
    return found;
  };
  return {
    ref,
    field: spec.field,
    subfield: spec.subfield,
    kind: spec.kind,
    title: spec.title,
    explainer: { ...spec.explainer },
    go_deeper: spec.go_deeper.map(id),
    ai: {
      role: spec.ai.role,
      confidence: spec.ai.confidence,
      systems: spec.ai.systems.map((s) => ({ ...s })),
      evidence: spec.ai.evidence.map((e) => ({ source_id: id(e.source), quote: e.quote, from_claimant: e.from_claimant })),
    },
    significance: spec.significance,
    rung_history: spec.rung_history.filter((r) => r.recorded === first)
      .map((r) => ({ rung: r.rung, date: r.date, source_id: id(r.source), note: enOf(r.note) })),
    sources: draftSources(used, "s"),
    reactions: spec.reactions.map((r) => ({ source_id: id(r.source), who: r.who, affiliation: r.affiliation, quote: r.quote })),
    artefacts: { doi: [...spec.artefacts.doi], arxiv: [...spec.artefacts.arxiv], lean: [...spec.artefacts.lean], trial: [...spec.artefacts.trial], pdb: [...spec.artefacts.pdb] },
    figure: spec.figure === null ? null : {
      source_id: id(spec.figure.source), image_url: spec.figure.image_url, licence: spec.figure.licence,
      licence_quote: spec.figure.licence_quote, credit: spec.figure.credit, alt: spec.figure.alt,
    },
    who: spec.who.map((w) => ({ ...w })),
    terms: spec.terms.map((t): DraftTerm => ({ new: true, term: t.term, definition: t.definition })),
    related: spec.related.map(findingId),
    first_published: spec.first_published,
  };
}

/** The later dated fact a returning entry of `date` wrote for a finding: its English text and the keys of the sources that show it. */
export function returningFact(key: FindingKey, date: string): { text: string; sources: readonly SourceKey[] } {
  const fact = FINDING_TABLE[key].since_then.find((s) => s.date === date);
  if (fact === undefined) throw new Error(`${key} has no later fact dated ${date}`);
  return { text: fact.text, sources: fact.sources };
}

/** The rung entry of a finding written on `recorded` for `rung`; throws when there is none. */
export function rungEntryOf(key: FindingKey, rung: RungSpec["rung"], recorded: string): RungSpec {
  const entry = FINDING_TABLE[key].rung_history.find((r) => r.rung === rung && r.recorded === recorded);
  if (entry === undefined) throw new Error(`${key} has no ${rung} entry recorded on ${recorded}`);
  return entry;
}

/**
 * The stored record of a finding as it was held before the edition `before` published (strictly earlier entries,
 * sources, notes and briefs), or as it stands at the end of the sample when `before` is omitted. Throws for a finding that
 * had no brief yet. Chinese text is null throughout (an English-only record); the Chinese pass adds its own.
 */
export function storedFinding(key: FindingKey, before?: string): Finding {
  const spec = FINDING_TABLE[key];
  const keep = (date: string): boolean => before === undefined || date < before;
  const briefs = spec.briefs.filter(keep);
  if (briefs.length === 0) throw new Error(`${key} is not stored before ${before}`);
  const sources = spec.sources.filter((s) => keep(s.added));
  const ids = sourceIds(sources.map((s) => s.key), "s");
  const id = (k: SourceKey): string => {
    const found = ids[k];
    if (found === undefined) throw new Error(`${key}: ${k} is not stored before ${before}`);
    return found;
  };
  const history = spec.rung_history.filter((r) => keep(r.recorded));
  const sinceThen = spec.since_then.filter((s) => keep(s.date));
  const e = spec.explainer;
  const updated = [
    ...briefs, ...history.map((r) => r.recorded), ...sinceThen.map((s) => s.date), ...sources.map((s) => s.added),
  ].sort(byCodeUnit).at(-1)!;
  return Finding.parse({
    schema_version: 1,
    id: spec.id,
    field: spec.field,
    subfield: spec.subfield,
    kind: spec.kind,
    title: l10n(spec.title),
    depth: spec.depth,
    explainer: {
      found: l10n(e.found), matters: l10n(e.matters), ai_helped: e.ai_helped === null ? null : l10n(e.ai_helped),
      how_sure: l10n(e.how_sure), background: l10n(e.background), could_lead: l10n(e.could_lead),
    },
    go_deeper: spec.go_deeper.map(id),
    ai: {
      role: spec.ai.role,
      confidence: spec.ai.confidence,
      systems: spec.ai.systems.map((s) => ({ ...s })),
      evidence: spec.ai.evidence.map((x) => ({ source_id: id(x.source), quote: x.quote, from_claimant: x.from_claimant })),
    },
    significance: spec.significance,
    rung: history.at(-1)!.rung,
    rung_history: history.map((r): RungEntry => ({
      rung: r.rung, date: r.date, recorded: r.recorded, source_id: id(r.source), by: r.by,
      note: r.note === null ? null : typeof r.note === "string" ? l10n(r.note) : r.note,
    })),
    since_then: sinceThen.map((s) => ({ date: s.date, text: l10n(s.text), source_ids: s.sources.map(id) })),
    sources: sources.map((s, i) => {
      const src = SOURCE_TABLE[s.key];
      return {
        id: `s${i + 1}`, kind: src.kind, title: src.title, publisher: src.publisher, url: src.url, doi: src.doi,
        published_at: src.published_at, seen_as: src.seen, added: s.added,
      };
    }),
    reactions: spec.reactions.map((r) => ({ source_id: id(r.source), who: r.who, affiliation: r.affiliation, quote: r.quote })),
    artefacts: { doi: [...spec.artefacts.doi], arxiv: [...spec.artefacts.arxiv], lean: [...spec.artefacts.lean], trial: [...spec.artefacts.trial], pdb: [...spec.artefacts.pdb] },
    figure: spec.figure === null ? null : {
      source_id: id(spec.figure.source), image_url: spec.figure.image_url, licence: spec.figure.licence,
      licence_quote: spec.figure.licence_quote, credit: spec.figure.credit, alt: l10n(spec.figure.alt),
    },
    who: spec.who.map((w) => ({ ...w })),
    terms: spec.terms.map((t) => termId(t.term)),
    related: spec.related.map(findingId),
    first_published: spec.first_published,
    first_brief: briefs[0]!,
    briefs,
    history: false,
    disclosure: false,
    applications: [],
    updated,
  });
}

/** Every finding stored before the edition `date` published, in publication order (the records its context and glossary read). */
export const storedFindingsBefore = (date: string): Finding[] => keysStoredBefore(date).map((k) => storedFinding(k, date));

/** The glossary as it stood before `date` published: the terms its earlier findings defined, sorted by id (SPEC §4.9). */
export function storedGlossary(before?: string): GlossaryFile {
  const terms = FINDING_KEYS.filter((k) => before === undefined || firstBrief(k) < before).flatMap((k) => {
    const spec = FINDING_TABLE[k];
    return spec.terms.map((t) => Term.parse({
      id: termId(t.term), en: { term: t.term, definition: t.definition }, zh: null, fields: [spec.field],
      first_finding: spec.id, first_date: firstBrief(k),
    }));
  }).sort((a, b) => byCodeUnit(a.id, b.id));
  return GlossaryFile.parse({ schema_version: 1, terms });
}

// ── Reports and corrections (the weekday) ────────────────────────────────────────────────────────

/** A correction the weekday draft writes, with the report it answers. `answers` is the report the stored correction names. */
export interface CorrectionSpec {
  /** The id publish gives it: sequential across all time. */
  readonly id: string;
  readonly finding: FindingKey;
  readonly type: "correction" | "clarification";
  readonly path: string;
  readonly after: string;
  readonly reason: string;
  /** The primary source that shows the correction is right. */
  readonly source: SourceKey;
  /** The draft's `report_id`: set only on the correction for a report JL upheld. */
  readonly draftReportId: string | null;
  /** The report it answers, as the stored correction records it. */
  readonly answers: string;
}

/** In the draft's order: the clarification that answers the open report first, the correction for JL's upheld report last (REPORT_UPHELD drops the last). */
export const WEEKDAY_CORRECTIONS: readonly CorrectionSpec[] = [
  {
    id: "C-0001", finding: "tilings", type: "clarification", path: "explainer.background",
    after: "A tiling covers a surface with copies of shapes and leaves no gaps. A floor of square tiles repeats one pattern. This proof is about tiles that never do that, on the flat plane only.",
    reason: "The paper proves the result for the flat plane only. The first text did not say so, and a reader reported it.",
    source: "tilings-paper", draftReportId: null, answers: "R-0002",
  },
  {
    id: "C-0002", finding: "weather", type: "correction", path: "explainer.how_sure",
    after: "Applied. The Meridian Weather Service says it runs the model alongside its own system and has not replaced that system. Science published the paper after peer review, and Larch Weather Systems, the maker, helped write it. The tests used past weather only, so live forecasts may differ.",
    reason: "The weather service's statement says the model runs alongside its own system and has not replaced it. The first text said the service relies on the model.",
    source: "weather-statement", draftReportId: "R-0001", answers: "R-0001",
  },
];

/** The agent's decision on the open report: upheld, with the correction at index 0 of `corrections`. */
export const WEEKDAY_DECISION = {
  report_id: "R-0002",
  outcome: "upheld" as const,
  reason: "The paper proves the result for the plane only. The first text did not say so, so we wrote a clarification.",
  correction: 0,
};

interface ReportSpec {
  readonly id: string;
  readonly received: string;
  readonly issue_number: number;
  readonly finding: FindingKey;
  readonly kind: ReportKind;
  readonly evidence: SourceKey;
}

const REPORT_SPECS: readonly ReportSpec[] = [
  { id: "R-0001", received: "2026-10-12T19:42:00+08:00", issue_number: 3, finding: "weather", kind: "fact", evidence: "weather-statement" },
  { id: "R-0002", received: "2026-10-13T21:10:00+08:00", issue_number: 4, finding: "tilings", kind: "fact", evidence: "tilings-paper" },
];

const reportBase = (r: ReportSpec) => ({
  id: r.id, received: r.received, issue_number: r.issue_number, finding_id: findingId(r.finding), kind: r.kind,
  evidence_url: SOURCE_TABLE[r.evidence].url,
});

/**
 * The reports as the weekday's context holds them (SPEC §4.15): R-0001 closed by JL as upheld on 2026-10-13, with no
 * correction yet, and R-0002 still open. REPORT_DECISION wants a decision for R-0002 alone, and REPORT_UPHELD a correction
 * with `report_id` "R-0001".
 */
export function reportsBeforeWeekday(): Report[] {
  const [one, two] = REPORT_SPECS as [ReportSpec, ReportSpec];
  return [
    Report.parse({ ...reportBase(one), status: "upheld", decided_by: "jl", resolved_on: "2026-10-13", reason: null, correction_id: null }),
    Report.parse({ ...reportBase(two), status: "open", decided_by: null, resolved_on: null, reason: null, correction_id: null }),
  ];
}

/** The same reports once the weekday published: R-0001 points at its correction, R-0002 is upheld by the agent with its reason. */
export function reportsAfterWeekday(): Report[] {
  const [one, two] = REPORT_SPECS as [ReportSpec, ReportSpec];
  return [
    Report.parse({
      ...reportBase(one), status: "upheld", decided_by: "jl", resolved_on: "2026-10-13", reason: null,
      correction_id: WEEKDAY_CORRECTIONS[1]!.id,
    }),
    Report.parse({
      ...reportBase(two), status: "upheld", decided_by: "claude", resolved_on: EDITIONS.weekday.date,
      reason: l10n(WEEKDAY_DECISION.reason), correction_id: WEEKDAY_CORRECTIONS[0]!.id,
    }),
  ];
}

/** The corrections as stored once the weekday published: `before` is the text just before, as the first publication wrote it. */
export function storedWeekdayCorrections(): Correction[] {
  return WEEKDAY_CORRECTIONS.map((c) => {
    const spec = FINDING_TABLE[c.finding];
    const part = c.path.replace("explainer.", "") as keyof FindingSpec["explainer"];
    const before = spec.explainer[part];
    if (before === null) throw new Error(`${c.finding} has no ${c.path} to correct`);
    return Correction.parse({
      id: c.id, date: EDITIONS.weekday.date, finding_id: spec.id, edition_date: null, term_id: null, type: c.type, path: c.path,
      before: l10n(before), after: l10n(c.after), reason: l10n(c.reason), source_url: SOURCE_TABLE[c.source].url,
      trigger: "reader_report", report_id: c.answers,
    });
  });
}
