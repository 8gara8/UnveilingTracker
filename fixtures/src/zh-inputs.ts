// The inputs the valid Chinese drafts are validated against (SPEC §4.6 "DraftZh and the Chinese edition", §4.12 "Fixtures and
// tests", §8.2 stage 8, §8.6): for each edition of the fixture world, the Chinese pass's context (`ZhContext`, which stage 8 writes
// to `drafts/D.zh-context.json`), its evidence (what stage 8 snapshots of the 樂詞網 pages the pass fetched, with an empty pack) and
// the English draft the pass translates. Everything is built from the one world (`world.ts`), the edition's English draft
// (`drafts.ts`) and the English contexts (`inputs.ts`), so a key, a cap, a term or a date is the one the Chinese draft
// (`zh-drafts.ts`) holds.
//
//   zhContextOf()   the one pure function that does what SPEC §4.6 says `buildZhContext()` will do: from the validated English
//                   draft, the stored findings, the glossary, the reports and the config, it lists every English string the
//                   edition shows (keyed by the grammar of §4.6), the backlog's strings (every untranslated finding the edition
//                   names, in the order of the brief's parts, then up to `zh_backlog_max` others, oldest `updated` first, then
//                   by id), the terms of both, the fixed translations that apply and the keys each applies to, the hype words,
//                   the names that hold one, the avoid list and the site's labels. The fixture builders call it with the sample
//                   world; tests/fixtures-zh.test.ts also calls it with a changed glossary, to show a term that already has
//                   Chinese leaves the pass's `terms` and a vocabulary id leaves the strings.
//   zhContext()     a fresh copy of an edition's context (`fixtures/drafts-zh/<edition>.zh-context.json`).
//   zhEvidence()    a fresh copy of an edition's evidence (`fixtures/drafts-zh/<edition>.zh-evidence.json`): one invented 樂詞網
//                   page for each `official_url` among the terms, seen as fetched; no pack.
//   zhInputs()      what `validateZh()` takes (lib/validate-zh.ts `ZhInputs`: the context, the evidence, the config and the stored records
//                   that stage 8 reads for the pass: every finding stored before the edition's date and the glossary's terms, no stored
//                   correction), with the English draft it translates and no file name: `validateZh(draft, i.english, i, { fileDate: i.fileDate })`.
//                   The records let ZH_HYPE know that a finding's text is a Landmark's or not (突破 may stand in a Landmark's only), as it does
//                   in the morning; a run given none judges only what the drafts and the context hold.
//
// Judgement calls (each is in the report too):
// - The sample world is English-only (every stored finding and glossary term has a null `zh`), so each edition's backlog is every
//   stored finding it names plus up to five others, and every term of the edition has a null `zh`: the pass writes all of them.
// - The clock. The Chinese context is built two minutes after the English draft's `generated_at` (the English draft has validated),
//   its deadline is `zh_minutes` (12) after that, and the Chinese draft's `generated_at` is nine minutes after it was built.
// - Kinds: a title, an explainer part, a Lead sentence, a figure's alt text, and a rung note have their own kinds (title, part,
//   lead, alt, note); the returning update, `since_then` text, idea, Also noted title, remarkable note, strongest evidence against
//   and the reasons are `line`; the deep dive, the big picture and a correction's `after` are `long`.
// - The field a fixed entry is read against is the field of the finding the string belongs to (a new finding's, a stored one's, the
//   correction's, the report's, the deep dive's or the remarkable note's); a Lead sentence, an idea, the big picture, the strongest
//   evidence against and a glossary term have none, so only entries that hold in every field apply to them (lib/zh.ts).
// - A string that is exactly `NONE_FOUND` or `REMOVED_TEXT`, and a correction's `after` that is an id of the vocabulary its path
//   holds, are left out of the strings (their Chinese is fixed, §4.6). The sample has none; the tests build one.
//
// Cyber's fixtures/src/build.ts at the fork commit 3ced1fb, adapted: the cached builders (one cached value for each edition, a deep
// copy for each caller) and the evidence's order of urls, fetched and texts are the pattern; the Chinese context itself is new.

import type { LoadedConfig } from "../../lib/config";
import { taipeiTimestamp } from "../../lib/dates";
import { byCodeUnit, compareFindingIds } from "../../lib/ids";
import type { DraftBrief } from "../../lib/schema/draft";
import { ZhContext, type ZhGroup, type ZhString, type ZhStringKind, type ZhTerm } from "../../lib/schema/draft-zh";
import type { StoredRecords } from "../../lib/rules/types";
import type { Finding } from "../../lib/schema/finding";
import type { GlossaryFile } from "../../lib/schema/glossary";
import { Evidence } from "../../lib/schema/misc";
import { normalizeUrl } from "../../lib/urls";
import type { ZhInputs } from "../../lib/validate-zh";
import {
  AI_CONFIDENCE, AI_ROLES, AI_ROLE_INFO, ALL_RUNGS, EXPLAINER_PARTS, FIELDS, FIELD_INFO, FINDING_KINDS, NONE_FOUND, REMOVED_TEXT,
  RUNG_INFO, SIGNIFICANCE, SIGNIFICANCE_INFO, type ExplainerPart, type FieldId,
} from "../../lib/vocab";
import { fixedApplies } from "../../lib/zh";
import { editionDraft } from "./drafts";
import { editionContext, fixtureConfig } from "./inputs";
import { EDITIONS, EDITION_NAMES, storedFindingsBefore, storedGlossary, termId, type EditionName } from "./world";
import { ZH_TERM_TABLE } from "./world-zh";

// ── The clock ────────────────────────────────────────────────────────────────────────────────────

/** When the Chinese pass of an edition ran. */
export interface ZhClock {
  /** The English draft validated, and stage 8 built the context: two minutes after the English draft's `generated_at`. */
  readonly contextAt: string;
  /** The Chinese draft's `generated_at`: nine minutes after the context. */
  readonly generatedAt: string;
  /** The context's `deadline`: `zh_minutes` (12) after the context. */
  readonly deadline: string;
}

const CONTEXT_AFTER_ENGLISH_MIN = 2;
const PASS_TAKES_MIN = 9;
/** The Chinese pass's own time limit (`budgets.zh_minutes`, 12): the context's deadline is that long after the context is built. */
const ZH_MINUTES = fixtureConfig().run.budgets.zh_minutes;

const minutesAfter = (at: string, minutes: number): string => taipeiTimestamp(new Date(Date.parse(at) + minutes * 60_000));

/** The Chinese pass's times for each edition, from the English draft's `generated_at`. */
export const ZH_CLOCK: Readonly<Record<EditionName, ZhClock>> = Object.fromEntries(EDITION_NAMES.map((name) => {
  const contextAt = minutesAfter(EDITIONS[name].generatedAt, CONTEXT_AFTER_ENGLISH_MIN);
  return [name, { contextAt, generatedAt: minutesAfter(contextAt, PASS_TAKES_MIN), deadline: minutesAfter(contextAt, ZH_MINUTES) }];
})) as Record<EditionName, ZhClock>;

// ── The English budgets (SPEC §4.12 "Word budgets"), in words ────────────────────────────────────

/** A story's six parts, each within its own cap and all six within `STORY_WORDS`. */
const STORY_PART_WORDS: Readonly<Record<ExplainerPart, number>> = { found: 55, matters: 50, ai_helped: 60, how_sure: 60, background: 35, could_lead: 35 };
const STORY_WORDS = 280;
/** Any other finding: its first four parts share `ITEM_WORDS`; its background and could-lead have `ITEM_TAIL_WORDS` each. */
const ITEM_WORDS = 100;
const ITEM_TAIL_WORDS = 40;
const LEAD_WORDS = 60;
const TITLE_WORDS = 12;
const NOTE_WORDS = 25;
const UPDATE_WORDS = 60;
const IDEA_WORDS = 40;
const ALSO_WORDS = 20;
const DEEP_DIVE_WORDS = 550;
const BIG_PICTURE_WORDS = 330;
const BIG_PICTURE_SHORT_WORDS = 120;
const REMARKABLE_WORDS = 30;
const AGAINST_WORDS = 50;
const DEFINITION_WORDS = 40;
const REASON_WORDS = 40;
const ALT_WORDS = 40;
/** A correction's `after` is capped in characters, not by a word budget (SPEC §4.12 ZH_CHARS). */
const CORRECTION_AFTER_CHARS = 300;
/** A week of fewer findings than this has the short big picture (SPEC §4.5). */
const SHORT_WEEK_BELOW = 3;

// ── What the builder reads ───────────────────────────────────────────────────────────────────────

/** A report of the English context: the finding it is about, which a decision on it names. */
export interface ZhReportRef {
  readonly id: string;
  readonly finding_id: string;
}

/** Everything stage 8 reads to build the Chinese context (SPEC §4.6). */
export interface ZhContextInput {
  /** The validated English draft the pass translates. */
  readonly draft: DraftBrief;
  /** The stored findings as of the edition, in any order. */
  readonly stored: readonly Finding[];
  /** The glossary as of the edition. */
  readonly glossary: GlossaryFile;
  /** The reports the English context holds, so that a report decision names its finding. */
  readonly reports: readonly ZhReportRef[];
  /** The number of findings of the Monday's week (the English context's `week`), null on any other day: it decides the big picture's cap. */
  readonly weekFindings: number | null;
  readonly config: LoadedConfig;
  /** By when the pass must have written its draft. */
  readonly deadline: string;
}

/** True for a string whose Chinese is fixed (§4.6): exactly `NONE_FOUND` or `REMOVED_TEXT`. */
const isFixedString = (en: string): boolean => en === NONE_FOUND.en || en === REMOVED_TEXT.en;

/**
 * True for a correction's `after` that is an id of the vocabulary its `path` holds (`field`, `subfield`, `kind`, `significance`,
 * `ai.role` or `ai.confidence`): publish fills its Chinese from `lib/vocab.ts` and `config/fields.json` (§4.6).
 */
function isVocabularyId(path: string, after: string, config: LoadedConfig): boolean {
  switch (path) {
    case "field": return (FIELDS as readonly string[]).includes(after);
    case "kind": return (FINDING_KINDS as readonly string[]).includes(after);
    case "significance": return (SIGNIFICANCE as readonly string[]).includes(after);
    case "ai.role": return (AI_ROLES as readonly string[]).includes(after);
    case "ai.confidence": return (AI_CONFIDENCE as readonly string[]).includes(after);
    case "subfield": return FIELDS.some((f) => config.index.subfields[f].some((s) => s.id === after));
    default: return false;
  }
}

/** The ceil(words × `zh_factor`) of an English budget (SPEC §4.12 ZH_CHARS); the products here are exact, so no rounding guard is needed. */
const capOf = (words: number, factor: number): number => Math.ceil(words * factor);

/**
 * The stored findings an edition names, in the order of the brief's parts that name them (§4.6): the Lead's refs, the story, the
 * items, the rung changes, the deep dive, the review's remarkable finding and the findings of its strongest evidence against, the
 * corrections and the reports it decides. A `new-N` ref names a finding of this draft, not a stored one. Each id once.
 */
function namedStoredIds(draft: DraftBrief, reports: readonly ZhReportRef[]): string[] {
  const fresh = new Set(draft.new_findings.map((f) => f.ref));
  const out: string[] = [];
  const add = (id: string): void => {
    if (!fresh.has(id) && !out.includes(id)) out.push(id);
  };
  for (const line of draft.lead) line.refs.forEach(add);
  if (draft.story !== null) add(draft.story);
  draft.items.forEach(add);
  for (const r of draft.rung_changes) add(r.finding_id);
  if (draft.deep_dive !== null) add(draft.deep_dive.finding_id);
  if (draft.review !== null) {
    if (draft.review.remarkable !== null) add(draft.review.remarkable.finding_id);
    draft.review.strongest_against.finding_ids.forEach(add);
  }
  for (const c of draft.corrections) if (c.finding_id !== null) add(c.finding_id);
  for (const d of draft.report_decisions) {
    const report = reports.find((r) => r.id === d.report_id);
    if (report === undefined) throw new Error(`The draft decides ${d.report_id}, which the context's reports do not hold`);
    add(report.finding_id);
  }
  return out;
}

/** A stored finding is untranslated while any of its strings or one of its terms has a null `zh` (§4.6). */
function isUntranslated(f: Finding, termHasZh: (id: string) => boolean): boolean {
  const texts = [
    f.title,
    ...EXPLAINER_PARTS.flatMap((p) => {
      const part = f.explainer[p];
      return part === null ? [] : [part];
    }),
    ...f.since_then.map((s) => s.text),
    ...f.rung_history.flatMap((r) => (r.note === null ? [] : [r.note])),
    ...(f.figure === null ? [] : [f.figure.alt]),
  ];
  return texts.some((t) => t.zh === null) || f.terms.some((id) => !termHasZh(id));
}

/** The backlog (§4.6): every untranslated finding the edition names, then up to `zh_backlog_max` other untranslated ones, oldest `updated` first, then by id. */
function backlogOf(input: ZhContextInput, termHasZh: (id: string) => boolean): Finding[] {
  const byId = new Map(input.stored.map((f) => [f.id, f]));
  const named = namedStoredIds(input.draft, input.reports);
  const namedFindings = named.map((id) => {
    const f = byId.get(id);
    if (f === undefined) throw new Error(`The draft names ${id}, which is neither a new finding of the draft nor a stored one`);
    return f;
  });
  const first = namedFindings.filter((f) => isUntranslated(f, termHasZh));
  const others = input.stored
    .filter((f) => !named.includes(f.id) && isUntranslated(f, termHasZh))
    .sort((a, b) => byCodeUnit(a.updated, b.updated) || compareFindingIds(a.id, b.id))
    .slice(0, input.config.run.budgets.zh_backlog_max);
  return [...first, ...others];
}

/**
 * The Chinese pass's context for an edition (SPEC §4.6): the reference `buildZhContext()` is built to agree with. The strings come in
 * the order of §4.6's key grammar: the Lead, each new finding (title, explainer parts, figure alt, rung notes), the returning
 * updates and their rung notes, the rung changes, the ideas, the Also noted titles, the deep dive, the review, the corrections, the
 * report reasons, then each backlog finding (title, explainer parts, `since_then` texts, figure alt, rung notes). The terms are
 * sorted by id.
 */
export function zhContextOf(input: ZhContextInput): ZhContext {
  const { draft, config } = input;
  const factor = config.run.budgets.zh_factor;
  const chars = (words: number): number => capOf(words, factor);

  const glossary = new Map(input.glossary.terms.map((t) => [t.id, t]));
  const termHasZh = (id: string): boolean => {
    const term = glossary.get(id);
    if (term === undefined) throw new Error(`The glossary holds no term ${id}`);
    return term.zh !== null;
  };
  const backlog = backlogOf(input, termHasZh);
  const stored = new Map(input.stored.map((f) => [f.id, f]));
  const storedField = (id: string): FieldId => {
    const f = stored.get(id);
    if (f === undefined) throw new Error(`The context holds no stored finding ${id}`);
    return f.field;
  };

  const strings: ZhString[] = [];
  /** The field of the finding each key belongs to; null when it belongs to none (§4.11 `fixed`). */
  const fieldOfKey = new Map<string, FieldId | null>();
  const add = (key: string, en: string, kind: ZhStringKind, cap_chars: number, group: ZhGroup | null, field: FieldId | null): void => {
    if (isFixedString(en)) return;
    strings.push({ key, en, kind, cap_chars, group: group === null ? null : { ...group } });
    fieldOfKey.set(key, field);
  };

  const explainer = (prefix: string, depth: "story" | "item", parts: Readonly<Record<ExplainerPart, string | null>>, field: FieldId): void => {
    const group: ZhGroup = { id: `${prefix}.explainer`, cap_chars: chars(depth === "story" ? STORY_WORDS : ITEM_WORDS) };
    for (const part of EXPLAINER_PARTS) {
      const en = parts[part];
      if (en === null) continue;
      const key = `${prefix}.explainer.${part}`;
      if (depth === "story") add(key, en, "part", chars(STORY_PART_WORDS[part]), group, field);
      else if (part === "background" || part === "could_lead") add(key, en, "part", chars(ITEM_TAIL_WORDS), null, field);
      else add(key, en, "part", group.cap_chars, group, field);
    }
  };

  // The Lead.
  const leadGroup: ZhGroup = { id: "lead", cap_chars: chars(LEAD_WORDS) };
  draft.lead.forEach((l, i) => add(`lead.${i}`, l.text, "lead", leadGroup.cap_chars, leadGroup, null));

  // The new findings.
  for (const f of draft.new_findings) {
    const prefix = `new.${f.ref}`;
    add(`${prefix}.title`, f.title, "title", chars(TITLE_WORDS), null, f.field);
    explainer(prefix, draft.story === f.ref ? "story" : "item", f.explainer, f.field);
    if (f.figure !== null) add(`${prefix}.figure.alt`, f.figure.alt, "alt", chars(ALT_WORDS), null, f.field);
    f.rung_history.forEach((r, i) => {
      if (r.note !== null) add(`${prefix}.rung.${i}`, r.note, "note", chars(NOTE_WORDS), null, f.field);
    });
  }

  // The returning findings and the rung changes.
  for (const r of draft.returning) {
    add(`returning.${r.finding_id}.update`, r.update, "line", chars(UPDATE_WORDS), null, storedField(r.finding_id));
    if (r.rung !== null && r.rung.note !== null) add(`returning.${r.finding_id}.rung`, r.rung.note, "note", chars(NOTE_WORDS), null, storedField(r.finding_id));
  }
  for (const c of draft.rung_changes) {
    if (c.rung.note !== null) add(`rung.${c.finding_id}`, c.rung.note, "note", chars(NOTE_WORDS), null, storedField(c.finding_id));
  }

  // Ideas, Also noted, the deep dive and the review.
  draft.ideas.forEach((idea, i) => add(`ideas.${i}`, idea.text, "line", chars(IDEA_WORDS), null, null));
  draft.also.forEach((a, i) => add(`also.${i}`, a.title, "line", chars(ALSO_WORDS), null, a.field));
  if (draft.deep_dive !== null) add("deep_dive", draft.deep_dive.text, "long", chars(DEEP_DIVE_WORDS), null, storedField(draft.deep_dive.finding_id));
  if (draft.review !== null) {
    const short = input.weekFindings !== null && input.weekFindings < SHORT_WEEK_BELOW;
    add("review.big_picture", draft.review.big_picture, "long", chars(short ? BIG_PICTURE_SHORT_WORDS : BIG_PICTURE_WORDS), null, null);
    if (draft.review.remarkable !== null) {
      add("review.remarkable", draft.review.remarkable.note, "line", chars(REMARKABLE_WORDS), null, storedField(draft.review.remarkable.finding_id));
    }
    add("review.strongest_against", draft.review.strongest_against.text, "line", chars(AGAINST_WORDS), null, null);
  }

  // The corrections and the report decisions.
  draft.corrections.forEach((c, i) => {
    const field = c.finding_id === null ? null : storedField(c.finding_id);
    if (!isVocabularyId(c.path, c.after, config)) add(`corrections.${i}.after`, c.after, "long", CORRECTION_AFTER_CHARS, null, field);
    add(`corrections.${i}.reason`, c.reason, "line", chars(REASON_WORDS), null, field);
  });
  for (const d of draft.report_decisions) {
    const report = input.reports.find((r) => r.id === d.report_id)!;
    add(`reports.${d.report_id}.reason`, d.reason, "line", chars(REASON_WORDS), null, storedField(report.finding_id));
  }

  // The backlog.
  for (const f of backlog) {
    const prefix = `backlog.${f.id}`;
    if (f.title.zh === null) add(`${prefix}.title`, f.title.en, "title", chars(TITLE_WORDS), null, f.field);
    const parts = Object.fromEntries(EXPLAINER_PARTS.map((p) => {
      const v = f.explainer[p];
      return [p, v === null || v.zh !== null ? null : v.en];
    })) as Record<ExplainerPart, string | null>;
    explainer(prefix, f.depth, parts, f.field);
    f.since_then.forEach((s, i) => {
      if (s.text.zh === null) add(`${prefix}.since.${i}`, s.text.en, "line", chars(UPDATE_WORDS), null, f.field);
    });
    if (f.figure !== null && f.figure.alt.zh === null) add(`${prefix}.figure.alt`, f.figure.alt.en, "alt", chars(ALT_WORDS), null, f.field);
    f.rung_history.forEach((r, i) => {
      if (r.note !== null && r.note.zh === null) add(`${prefix}.rung.${i}`, r.note.en, "note", chars(NOTE_WORDS), null, f.field);
    });
  }

  // The terms: each new finding's, then each backlog finding's, once each, sorted by id.
  const termsById = new Map<string, ZhTerm>();
  const addTerm = (id: string, fallback: { en: string; definition: string } | null): void => {
    if (termsById.has(id)) return;
    const known = glossary.get(id);
    if (known === undefined && fallback === null) throw new Error(`The glossary holds no term ${id}`);
    termsById.set(id, {
      id,
      en: known === undefined ? fallback!.en : known.en.term,
      definition: known === undefined ? fallback!.definition : known.en.definition,
      zh: known?.zh?.term ?? null,
      official: known?.zh?.official ?? null,
      cap_chars: chars(DEFINITION_WORDS),
    });
  };
  for (const f of draft.new_findings) {
    for (const t of f.terms) {
      if (t.new) addTerm(termId(t.term), { en: t.term, definition: t.definition });
      else addTerm(t.id, null);
    }
  }
  for (const f of backlog) f.terms.forEach((id) => addTerm(id, null));
  const terms = [...termsById.values()].sort((a, b) => byCodeUnit(a.id, b.id));

  // The fixed translations that apply, with the keys each applies to (a term's key is `terms.<id>`, for a term with no Chinese yet).
  const fixed = config.termsZh.fixed.flatMap((entry) => {
    const keys = [
      ...strings.filter((s) => fixedApplies(entry, s.en, fieldOfKey.get(s.key) ?? null)).map((s) => s.key),
      ...terms.filter((t) => t.zh === null && (fixedApplies(entry, t.en, null) || fixedApplies(entry, t.definition, null))).map((t) => `terms.${t.id}`),
    ];
    return keys.length > 0 ? [{ en: entry.en, zh: entry.zh, keys }] : [];
  });

  const labelled = [
    ...FIELDS.map((id) => FIELD_INFO[id]),
    ...ALL_RUNGS.map((id) => RUNG_INFO[id]),
    ...AI_ROLES.map((id) => AI_ROLE_INFO[id]),
    ...SIGNIFICANCE.map((id) => SIGNIFICANCE_INFO[id]),
  ];
  return ZhContext.parse({
    schema_version: 1,
    date: draft.date,
    deadline: input.deadline,
    strings,
    terms,
    fixed,
    hype: [...config.hypeWords.zh],
    hype_names: config.hypeWords.names.map((n) => ({ en: n.en, zh: n.zh })),
    avoid: Object.fromEntries(config.termsZh.avoid.map((a) => [a.term, a.taiwan])),
    labels: Object.fromEntries(labelled.map((l) => [l.en, l.zh])),
  });
}

// ── The sample world's inputs ────────────────────────────────────────────────────────────────────

/** The input of an edition's context, built from the world: its English draft, the findings and glossary stored before it, its English context's reports and week. */
export function zhContextInput(name: EditionName): ZhContextInput {
  const e = EDITIONS[name];
  const english = editionContext(name);
  return {
    draft: editionDraft(name),
    stored: storedFindingsBefore(e.date),
    glossary: storedGlossary(e.date),
    reports: english.reports.map((r) => ({ id: r.id, finding_id: r.finding_id })),
    weekFindings: english.week === null ? null : english.week.findings.length,
    config: fixtureConfig(),
    deadline: ZH_CLOCK[name].deadline,
  };
}

function cached<T>(build: (name: EditionName) => T): (name: EditionName) => T {
  const cache = new Map<EditionName, T>();
  return (name) => {
    let value = cache.get(name);
    if (value === undefined) {
      value = build(name);
      cache.set(name, value);
    }
    return structuredClone(value);
  };
}

/** A fresh copy of an edition's Chinese context (`fixtures/drafts-zh/<name>.zh-context.json`). */
export const zhContext: (name: EditionName) => ZhContext = cached((name) => zhContextOf(zhContextInput(name)));

// ── Evidence (SPEC §4.12 ZH_OFFICIAL, §8.2 stage 8) ──────────────────────────────────────────────

const SAMPLE_PAGE = "SAMPLE page, invented for tests and never fetched.";

/**
 * The text of the invented 樂詞網 page of a term whose entry the pass found: the SAMPLE mark, the term as the page shows it (its
 * `official`) and the English term. ZH_OFFICIAL looks for the `official` in it, both read as NFKC.
 */
export function officialPageText(en: string, official: string): string {
  return [SAMPLE_PAGE, `樂詞網詞彙頁（範例）：${official}`, `英文詞彙：${en}`].join("\n");
}

/**
 * An edition's evidence for the Chinese pass: for each term of the context that the pass writes and whose table entry has an
 * `official_url`, that page, among the urls the pass fetched, with its text, seen as fetched. No pack, no types, nothing resolved.
 */
function buildEvidence(name: EditionName): Evidence {
  const context = zhContext(name);
  const urls: string[] = [];
  const texts: Record<string, string> = {};
  const seenAs: Record<string, "fetched"> = {};
  for (const t of context.terms) {
    if (t.zh !== null) continue;
    const record = ZH_TERM_TABLE[t.id];
    if (record === undefined || record.official === null || record.official_url === null) continue;
    const key = normalizeUrl(record.official_url);
    if (key in texts) continue;
    urls.push(record.official_url);
    texts[key] = officialPageText(t.en, record.official);
    seenAs[key] = "fetched";
  }
  return Evidence.parse({ urls, fetched: [...urls], texts, seen_as: seenAs, types: {}, resolved: {} });
}

/** A fresh copy of an edition's Chinese evidence (`fixtures/drafts-zh/<name>.zh-evidence.json`). */
export const zhEvidence: (name: EditionName) => Evidence = cached(buildEvidence);

// ── What a Chinese validation takes ──────────────────────────────────────────────────────────────

/**
 * Everything `validateZh()` reads besides the Chinese draft: its `ZhInputs` (the context, the evidence, the config and the stored
 * records) and, as `validateZh()` takes them apart, the English draft it translates and the file name's date, which is null here.
 * The stored records are what stage 8 hands the pass (SPEC §8.2, §8.6): every finding stored before the edition's date, which holds
 * the findings the English draft names and every backlog finding, and the glossary's terms. No correction is stored: no case reads one.
 */
export interface ZhRunInputs extends ZhInputs {
  readonly english: DraftBrief;
  readonly context: ZhContext;
  readonly evidence: Evidence;
  readonly stored: StoredRecords;
  readonly config: LoadedConfig;
  readonly fileDate: string | null;
}

/** An edition's Chinese-validation inputs as fresh copies, with the stored records of the sample world, the repo's config and no file name. */
export function zhInputs(name: EditionName): ZhRunInputs {
  const date = EDITIONS[name].date;
  return {
    english: editionDraft(name), context: zhContext(name), evidence: zhEvidence(name),
    stored: { findings: storedFindingsBefore(date), corrections: [], terms: storedGlossary(date).terms },
    config: fixtureConfig(), fileDate: null,
  };
}
