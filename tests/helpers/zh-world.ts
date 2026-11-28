// A small hand-built world for the Chinese rules' tests (SPEC §4.6, §4.12): the English draft of the Tuesday 2026-11-24 edition, the
// Chinese pass's context for it (built by the same key grammar as §4.6, in `buildContext()`), a valid Chinese draft for that context,
// the pass's evidence (one invented 樂詞網 page) and the repo's config, and the stored records of a published Chinese edition. Every
// value is parsed through its schema, and every call returns a fresh copy, so a test may change it. The English strings are the
// frame's sample world (tests/helpers/rule-world.ts) with a few changes, so that the finding's explainer uses its glossary terms
// and a correction rewrites a `how_sure`; the Chinese is written by hand and the world fails to build when a key has no Chinese or
// a Chinese string has no key. The text is sample text: no real paper, lab or result.
//
// The Tuesday: a story (`new-1`, biology, whose `found` uses the new term "protein folding" and the existing term "enzyme"), a new
// item (`new-2`, no AI role, so no `ai_helped`), a returning finding, a rung change, an idea, an Also noted line, four corrections
// (three of them rewrite a vocabulary id, which the context leaves out, and one rewrites a `how_sure`) and two report decisions.
// `zhWorld({ review: true })` and `zhWorld({ deepDive: true })` add a Monday's review or a Sunday's deep dive to it.
//
// New for this project; Cyber had no Chinese pass.

import type { LoadedConfig } from "../../lib/config";
import { Brief } from "../../lib/schema/brief";
import { DraftBrief } from "../../lib/schema/draft";
import { DraftZh, ZhContext, type ZhGroup, type ZhString, type ZhStringKind, type ZhTerm } from "../../lib/schema/draft-zh";
import { Evidence } from "../../lib/schema/misc";
import { normalizeUrl } from "../../lib/urls";
import {
  AI_ROLES, AI_ROLE_INFO, ALL_RUNGS, EXPLAINER_PARTS, FIELDS, FIELD_INFO, FIELD_OF_CODE, RUNG_INFO, SIGNIFICANCE, SIGNIFICANCE_INFO,
  type ExplainerPart, type FieldCode, type FieldId,
} from "../../lib/vocab";
import { fixedApplies } from "../../lib/zh";
import { buildPublishedInput, runRules } from "../../lib/rules/run";
import { zhRules } from "../../lib/rules/zh";
import { buildZhInput, type ZhInputs, type ZhOptions } from "../../lib/validate-zh";
import type { PublishedInput, StoredRecords, ValidationIssue, ZhInput } from "../../lib/rules/types";
import { D, MONDAY, SUNDAY, clone, config, deepFreeze, landmarkDraft, lz, storedFinding, storedWorld, type Json } from "./rule-world";

export { D, MONDAY, SUNDAY, clone, deepFreeze, type Json };

export const OFFICIAL_URL = "https://terms.naer.edu.tw/detail/1234567/";
export const OFFICIAL_TERM = "蛋白質摺疊";
export const OFFICIAL_PAGE = `SAMPLE page, invented for tests and never fetched.\n樂詞網詞彙頁（範例）：${OFFICIAL_TERM}\n英文詞彙：protein folding`;

// ── The English draft ────────────────────────────────────────────────────────────────────────────

/** The sample world's Tuesday draft, with `math-2026-0002` filed as a Landmark, and the changes the Chinese tests need (see the header). */
function englishDraft(opts: { review: boolean; deepDive: boolean }): DraftBrief {
  const raw: Json = structuredClone(landmarkDraft());
  raw.new_findings[0].explainer.found = "The system worked out how protein folding goes in an enzyme.";
  raw.corrections.push({
    finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "correction", path: "explainer.how_sure",
    after: "Checked by Example Journal and by another lab.", reason: "The earlier version left out the other lab.", source_url: null, report_id: null,
  });
  if (opts.review) {
    raw.review = {
      big_picture: "The week held one sample result and one sample check.",
      remarkable: { finding_id: "math-2026-0002", note: "A sample proof stood out." },
      strongest_against: { text: "A sample lab disputed one result.", finding_ids: ["phys-2026-0003"], source_ids: ["b2"] },
    };
  }
  if (opts.deepDive) {
    raw.deep_dive = { finding_id: "bio-2024-0007", text: "A sample long text about an older sample result.", source_ids: ["b1"], why_today: "anniversary" };
  }
  return DraftBrief.parse(raw);
}

// ── The context ──────────────────────────────────────────────────────────────────────────────────

const STORY_PART_WORDS: Readonly<Record<ExplainerPart, number>> = { found: 55, matters: 50, ai_helped: 60, how_sure: 60, background: 35, could_lead: 35 };

/** The field of a stored finding, from its id (`math-2026-0002`). */
const fieldOfId = (id: string): FieldId => FIELD_OF_CODE[id.split("-")[0] as FieldCode];

const isVocabularyId = (path: string, after: string): boolean => {
  switch (path) {
    case "field": return (FIELDS as readonly string[]).includes(after);
    case "significance": return (SIGNIFICANCE as readonly string[]).includes(after);
    case "subfield": return ["catalysis", "proteins", "soils", "optics", "proofs"].includes(after);
    case "ai.role": return (AI_ROLES as readonly string[]).includes(after);
    default: return false;
  }
};

const GLOSSARY: readonly ZhTerm[] = [
  { id: "protein-folding", en: "protein folding", definition: "How a chain of amino acids curls into a shape.", zh: null, official: null, cap_chars: 72 },
  { id: "enzyme", en: "enzyme", definition: "A protein that speeds up a chemical reaction.", zh: "酵素", official: null, cap_chars: 72 },
];

/**
 * The Chinese context of an English draft by §4.6's key grammar: every string of the edition with its kind, cap and group, the terms
 * the findings use, the fixed translations that apply to each key, and the config's lists. A correction's `after` that is a
 * vocabulary id is left out, as `buildZhContext()` leaves it out. `weekFindings` decides the big picture's cap (216 in a week of
 * fewer than 3 findings, else 594).
 */
export function buildContext(english: DraftBrief, cfg: LoadedConfig, weekFindings: number | null = null): { context: ZhContext; fields: Map<string, FieldId | null> } {
  const factor = cfg.run.budgets.zh_factor;
  const chars = (words: number): number => Math.ceil(Math.round(words * factor * 1e6) / 1e6);
  const strings: ZhString[] = [];
  const fieldOf = new Map<string, FieldId | null>();
  const add = (key: string, en: string, kind: ZhStringKind, cap: number, group: ZhGroup | null, field: FieldId | null): void => {
    strings.push({ key, en, kind, cap_chars: cap, group });
    fieldOf.set(key, field);
  };
  const lead: ZhGroup = { id: "lead", cap_chars: chars(60) };
  english.lead.forEach((x, i) => add(`lead.${i}`, x.text, "lead", lead.cap_chars, lead, null));
  for (const f of english.new_findings) {
    const prefix = `new.${f.ref}`;
    const story = english.story === f.ref;
    add(`${prefix}.title`, f.title, "title", chars(12), null, f.field);
    const group: ZhGroup = { id: `${prefix}.explainer`, cap_chars: chars(story ? 280 : 100) };
    for (const part of EXPLAINER_PARTS) {
      const text: string | null = f.explainer[part];
      if (text === null) continue;
      if (story) add(`${prefix}.explainer.${part}`, text, "part", chars(STORY_PART_WORDS[part]), group, f.field);
      else if (part === "background" || part === "could_lead") add(`${prefix}.explainer.${part}`, text, "part", chars(40), null, f.field);
      else add(`${prefix}.explainer.${part}`, text, "part", group.cap_chars, group, f.field);
    }
    f.rung_history.forEach((r, i) => {
      if (r.note !== null) add(`${prefix}.rung.${i}`, r.note, "note", chars(25), null, f.field);
    });
  }
  for (const r of english.returning) {
    add(`returning.${r.finding_id}.update`, r.update, "line", chars(60), null, fieldOfId(r.finding_id));
    if (r.rung !== null && r.rung.note !== null) add(`returning.${r.finding_id}.rung`, r.rung.note, "note", chars(25), null, fieldOfId(r.finding_id));
  }
  for (const c of english.rung_changes) {
    if (c.rung.note !== null) add(`rung.${c.finding_id}`, c.rung.note, "note", chars(25), null, fieldOfId(c.finding_id));
  }
  english.ideas.forEach((x, i) => add(`ideas.${i}`, x.text, "line", chars(40), null, null));
  english.also.forEach((x, i) => add(`also.${i}`, x.title, "line", chars(20), null, x.field));
  if (english.deep_dive !== null) add("deep_dive", english.deep_dive.text, "long", chars(550), null, fieldOfId(english.deep_dive.finding_id));
  if (english.review !== null) {
    const short = weekFindings !== null && weekFindings < 3;
    add("review.big_picture", english.review.big_picture, "long", chars(short ? 120 : 330), null, null);
    if (english.review.remarkable !== null) add("review.remarkable", english.review.remarkable.note, "line", chars(30), null, fieldOfId(english.review.remarkable.finding_id));
    add("review.strongest_against", english.review.strongest_against.text, "line", chars(50), null, null);
  }
  english.corrections.forEach((c, i) => {
    const field = c.finding_id === null ? null : fieldOfId(c.finding_id);
    if (!isVocabularyId(c.path, c.after)) add(`corrections.${i}.after`, c.after, "long", 300, null, field);
    add(`corrections.${i}.reason`, c.reason, "line", chars(40), null, field);
  });
  const reportFinding: Readonly<Record<string, string>> = { "R-0001": "bio-2026-0001", "R-0002": "math-2026-0002" };
  for (const d of english.report_decisions) add(`reports.${d.report_id}.reason`, d.reason, "line", chars(40), null, fieldOfId(reportFinding[d.report_id]!));

  const terms = GLOSSARY.map((t) => ({ ...t }));
  const fixed = fixedOf(cfg, strings, terms, fieldOf);
  const labelled = [...FIELDS.map((f) => FIELD_INFO[f]), ...ALL_RUNGS.map((r) => RUNG_INFO[r]), ...AI_ROLES.map((r) => AI_ROLE_INFO[r]), ...SIGNIFICANCE.map((s) => SIGNIFICANCE_INFO[s])];
  const context = ZhContext.parse({
    schema_version: 1,
    date: english.date,
    deadline: "2026-11-24T04:27:00+08:00",
    strings,
    terms,
    fixed,
    hype: [...cfg.hypeWords.zh],
    hype_names: cfg.hypeWords.names.map((n) => ({ en: n.en, zh: n.zh })),
    avoid: Object.fromEntries(cfg.termsZh.avoid.map((a) => [a.term, a.taiwan])),
    labels: Object.fromEntries(labelled.map((l) => [l.en, l.zh])),
  });
  return { context, fields: fieldOf };
}

/** The `fixed` list of a context: each config entry that applies to a string by its field and its `except` phrases, with the keys it applies to (`terms.<id>` for a null-zh term). */
export function fixedOf(cfg: LoadedConfig, strings: readonly ZhString[], terms: readonly ZhTerm[], fields: ReadonlyMap<string, FieldId | null>): ZhContext["fixed"] {
  return cfg.termsZh.fixed.flatMap((entry) => {
    const keys = [
      ...strings.filter((s) => fixedApplies(entry, s.en, fields.get(s.key) ?? null)).map((s) => s.key),
      ...terms.filter((t) => t.zh === null && (fixedApplies(entry, t.en, null) || fixedApplies(entry, t.definition, null))).map((t) => `terms.${t.id}`),
    ];
    return keys.length > 0 ? [{ en: entry.en, zh: entry.zh, keys }] : [];
  });
}

// ── The Chinese ──────────────────────────────────────────────────────────────────────────────────

/** The Chinese of every key the world's drafts can have; a world uses the keys of its context, and none may be left over. */
const CHINESE: Readonly<Record<string, string>> = {
  "lead.0": "今天的重點是一項範例蛋白質成果。",
  "lead.1": "一項證明現已發表。",
  "new.new-1.title": "範例蛋白質成果",
  "new.new-1.explainer.found": "系統找出蛋白質摺疊（protein folding）在酵素（enzyme）中的運作方式。",
  "new.new-1.explainer.matters": "範例意義。",
  "new.new-1.explainer.ai_helped": "Sample System 3 是 Example Lab 的系統，完成了這項工作。",
  "new.new-1.explainer.how_sure": "已查核，來源是 Example Journal。",
  "new.new-1.explainer.background": "範例背景。",
  "new.new-1.explainer.could_lead": "它可能帶來範例用途。",
  "new.new-2.title": "範例土壤檢查",
  "new.new-2.explainer.found": "範例發現。",
  "new.new-2.explainer.matters": "範例意義。",
  "new.new-2.explainer.how_sure": "已查核，來源是 Example Journal。",
  "new.new-2.explainer.background": "範例背景。",
  "new.new-2.explainer.could_lead": "它可能帶來範例用途。",
  "new.new-2.rung.0": "由 Example Journal 發布。",
  "returning.math-2026-0002.update": "一家期刊刊出了這項證明。",
  "returning.math-2026-0002.rung": "由 Example Journal 刊出。",
  "rung.phys-2026-0003": "實驗室發出了一則通知。",
  "ideas.0": "一項關於方法的範例論點。",
  "also.0": "一項範例土壤研究",
  "deep_dive": "一篇關於較早範例成果的範例長文。",
  "review.big_picture": "這一週有一項範例成果和一項範例查證。",
  "review.remarkable": "一項範例證明格外突出。",
  "review.strongest_against": "一個範例實驗室對一項成果提出爭議。",
  "corrections.0.reason": "這項成果是里程碑。",
  "corrections.1.reason": "領域有誤。",
  "corrections.2.reason": "子領域有誤。",
  "corrections.3.after": "已查核，來源是 Example Journal 與另一個實驗室。",
  "corrections.3.reason": "先前的版本漏掉了另一個實驗室。",
  "reports.R-0001.reason": "來源確實這樣說。",
  "reports.R-0002.reason": "評等偏低。",
};

const CHINESE_TERMS = {
  "protein-folding": { zh: "蛋白質摺疊", definition: "一串胺基酸捲成立體形狀的過程。", official: null, official_url: null },
};

// ── The world ────────────────────────────────────────────────────────────────────────────────────

export interface ZhWorld {
  english: DraftBrief;
  context: ZhContext;
  /** The field of the finding each context key belongs to, null for none (what `ZhContext.fixed` was worked out against). */
  fields: Map<string, FieldId | null>;
  draft: DraftZh;
  /** The pass's evidence; null for a run that has none. */
  evidence: Evidence | null;
  config: LoadedConfig;
  /** What the validating stage reads from `content/`: none by default. */
  stored: StoredRecords | null;
}

export interface ZhWorldOptions {
  /** Add a Monday's review (big picture, remarkable note, strongest evidence against). */
  review?: boolean;
  /** Add a Sunday's deep dive. */
  deepDive?: boolean;
  /** The findings of the context's week, for the big picture's cap. */
  weekFindings?: number | null;
}

/** The evidence of the Chinese pass: the one invented 樂詞網 page, fetched. */
export function officialEvidence(): Evidence {
  const key = normalizeUrl(OFFICIAL_URL);
  return Evidence.parse({ urls: [OFFICIAL_URL], fetched: [OFFICIAL_URL], texts: { [key]: OFFICIAL_PAGE }, seen_as: { [key]: "fetched" }, types: {}, resolved: {} });
}

/** A valid Chinese edition: no rule gives an issue. Each call is a fresh copy. */
export function zhWorld(opts: ZhWorldOptions = {}): ZhWorld {
  const cfg = config();
  const english = englishDraft({ review: opts.review === true, deepDive: opts.deepDive === true });
  const { context, fields } = buildContext(english, cfg, opts.weekFindings ?? null);
  const keys = context.strings.map((s) => s.key);
  const missing = keys.filter((k) => !Object.hasOwn(CHINESE, k));
  if (missing.length > 0) throw new Error(`zh-world: no Chinese for ${missing.join(", ")}`);
  const draft = DraftZh.parse({
    schema_version: 1,
    date: english.date,
    generated_at: "2026-11-24T04:21:00+08:00",
    strings: Object.fromEntries(keys.map((k) => [k, CHINESE[k]!])),
    terms: structuredClone(CHINESE_TERMS),
  });
  return { english, context, fields, draft, evidence: officialEvidence(), config: cfg, stored: null };
}

/** The `ZhInputs` of a world, for `validateZh()` and `buildZhInput()`. */
export const inputsOf = (w: ZhWorld): ZhInputs => ({ context: w.context, evidence: w.evidence, stored: w.stored, config: w.config });

/** The zh-mode rule input of a world. */
export const zhInputOf = (w: ZhWorld, options: ZhOptions = {}): ZhInput => buildZhInput(w.draft, w.english, inputsOf(w), options);

/** Every issue of the Chinese rules on a world (the engine's INPUT_MISSING warnings included), in the engine's order. */
export const zhRun = (w: ZhWorld): ValidationIssue[] => runRules(zhInputOf(w), zhRules);

/** The issues of one code on a world, and every RULE_ERROR: a rule that threw is among them, so no test that expects no issue passes on a crash. */
export const zhIssues = (w: ZhWorld, code: string): ValidationIssue[] => zhRun(w).filter((i) => i.code === code || i.code === "RULE_ERROR");

// ── Editing a world ──────────────────────────────────────────────────────────────────────────────

/** Sets the Chinese of a key. */
export function setZh(w: ZhWorld, key: string, text: string): ZhWorld {
  w.draft.strings[key] = text;
  return w;
}

/** Sets the English of a context key (the Chinese is then judged against it). */
export function setEn(w: ZhWorld, key: string, text: string): ZhWorld {
  const s = w.context.strings.find((x) => x.key === key);
  if (s === undefined) throw new Error(`zh-world: no context key ${key}`);
  s.en = text;
  return w;
}

/** Adds a context string and its Chinese (a backlog string, say); `field` is the field of the finding it belongs to, for the fixed translations. */
export function addString(w: ZhWorld, s: { key: string; en: string; zh: string; kind?: ZhStringKind; cap?: number; group?: ZhGroup | null; field?: FieldId | null }): ZhWorld {
  w.context.strings.push({ key: s.key, en: s.en, kind: s.kind ?? "line", cap_chars: s.cap ?? 100, group: s.group ?? null });
  w.draft.strings[s.key] = s.zh;
  w.fields.set(s.key, s.field ?? null);
  return refreshFixed(w);
}

/** Works the context's `fixed` list out again, as `buildZhContext()` does, after a test changed an English string or a field. */
export function refreshFixed(w: ZhWorld): ZhWorld {
  w.context.fixed = fixedOf(w.config, w.context.strings, w.context.terms, w.fields);
  return w;
}

/** Sets a key's English and Chinese, and the field of its finding, and works the fixed list out again. */
export function setPair(w: ZhWorld, key: string, en: string, zh: string, field: FieldId | null = null): ZhWorld {
  setEn(w, key, en);
  setZh(w, key, zh);
  w.fields.set(key, field);
  return refreshFixed(w);
}

/** Removes a key from the context and the draft. */
export function dropKey(w: ZhWorld, key: string): ZhWorld {
  w.context.strings = w.context.strings.filter((s) => s.key !== key);
  delete w.draft.strings[key];
  return w;
}

// ── The stored Chinese edition (published mode) ──────────────────────────────────────────────────

export interface PublishedZhWorld {
  brief: Brief;
  findings: ReturnType<typeof storedWorld>["findings"];
  terms: ReturnType<typeof storedWorld>["terms"];
  corrections: ReturnType<typeof storedWorld>["corrections"];
  reports: ReturnType<typeof storedWorld>["reports"];
  config: LoadedConfig;
}

/**
 * The frame's stored Tuesday with Chinese that every published-mode rule of the group accepts: the biology story's explainer uses
 * its listed term "protein folding" with the English in brackets at the first use, and the physics item lists no term.
 */
export function publishedZhWorld(): PublishedZhWorld {
  const w = storedWorld();
  w.findings[0] = storedFinding("bio-2026-0001", {
    explainer: {
      found: lz("Sample found text.", "範例發現：蛋白質摺疊（protein folding）的結果。"),
      matters: lz("Sample matters text.", "範例意義。"),
      ai_helped: lz("Sample System 3, from Example Lab, did the work.", "範例系統三號完成了這項工作。"),
      how_sure: lz("Checked by Example Journal.", "已查核，來源是 Example Journal。"),
      background: lz("Sample background text.", "範例背景。"),
      could_lead: lz("It could lead to sample uses.", "它可能帶來範例用途。"),
    },
  });
  // last changed the day before D, as the frame's world has it, so that the Tuesday adds no text to it: not a record being published (F-17)
  w.findings[2] = storedFinding("phys-2026-0003", { depth: "item", first_brief: "2026-11-10", briefs: ["2026-11-10", D], terms: [], updated: "2026-11-23" });
  return w;
}

/** Runs the group's rules on a stored edition; `publishing` names the date being published (null: none is). */
export function publishedRun(w: PublishedZhWorld, publishing: string | null = D): ValidationIssue[] {
  const input: PublishedInput = buildPublishedInput(w.brief, w, { config: w.config, publishing });
  return runRules(input, zhRules);
}

/** The issues of one code on a stored edition, and every RULE_ERROR, as `zhIssues()` has them. */
export const publishedIssues = (w: PublishedZhWorld, code: string, publishing: string | null = D): ValidationIssue[] =>
  publishedRun(w, publishing).filter((i) => i.code === code || i.code === "RULE_ERROR");
