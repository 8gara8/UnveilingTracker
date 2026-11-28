// The zh group (SPEC §4.12): the rules of the Chinese edition. ZH_KEYS, ZH_PARITY, ZH_TRADITIONAL, ZH_AVOID, ZH_TERMS,
// ZH_RUNG_LABEL, ZH_ENGLISH_ONCE, ZH_CHARS, ZH_OFFICIAL, ZH_NO_DASH and ZH_HYPE judge the Chinese pass's draft (zh mode, run by
// `validateZh()` in lib/validate-zh.ts) and the Chinese side of stored records (published mode). The text checks themselves are
// lib/zh.ts's (parity, characters, avoided terms, dashes, hype, fixed terms, the English once); a rule here only chooses which
// strings a check reads, in which mode, and writes the issue: its path, its message and how to fix it.
//
// Where each code runs (SPEC §4.12 "Stored records" and "Removed text"; RULE_CODE_TABLE has the same modes):
// - zh mode only, since each reads the pass's own inputs: ZH_KEYS (the context's keys), ZH_PARITY (the context's English),
//   ZH_RUNG_LABEL (drafts and seeds only: JL may change a label by PR, so a stored record keeps the label it was written with;
//   `rungLabelProblem()` is the check the seeder of P2 reads too) and ZH_OFFICIAL (the pass's fetches and snapshots; its host
//   check, `officialUrlProblem()`, is the seeder's too).
// - zh mode and published mode on the records being published alone, since each reads `config/` or a `run.json` budget:
//   ZH_TRADITIONAL, ZH_AVOID, ZH_TERMS, ZH_CHARS and ZH_HYPE. A stored record that is not being published is never judged
//   against them, so a change of config never turns a published edition red.
// - zh mode and published mode on every stored record, since each reads no config: ZH_NO_DASH and ZH_ENGLISH_ONCE.
// Every selector leaves out a string that a stored `removed` correction rewrote and a correction's `before`, which publish
// copies from text published earlier (strings.ts), and the Chinese of a null `zh` is never read, so an English-only record has
// nothing here to judge.
//
// What differs between the modes. In zh mode the context (`ZhContext`) says what each key is: its English, its cap and its
// group, the fixed translations that apply to it by field (`fixed[].keys`) and the glossary terms of the edition; a stored
// finding's own facts are not in it. A finding's terms are therefore read as STYLE-ZH.md §7 reads them for the pass: the
// context's terms whose English the finding's English explainer uses (`termsUsedBy()`). In published mode the same rule reads the
// finding's own `terms` and the glossary. The page total of ZH_CHARS counts the strings whose English counts in WORDS' page total
// (strings.ts `pageProse()`), found for a key by `parseZhKey()` in zh mode (`zhPageTotal()`) and, in published mode, by the English
// entry that each Chinese entry sits beside.
//
// New for this project; Cyber has no Chinese pass.

import { byCodeUnit } from "../ids";
import type { IsoDate } from "../schema/common";
import type { FixedTerm } from "../schema/config";
import type { ZhContext, ZhGroup } from "../schema/draft-zh";
import { hostOf, normalizeUrl } from "../urls";
import { RUNG_INFO, type FieldId, type Rung } from "../vocab";
import {
  LANDMARK_ONLY_ZH, avoidHits, countZhChars, dashHits, englishOnceProblems, fixedMissing, fixedOccurrences, hypeHits,
  parityProblems, traditionalHits, wordsOutsideLinks, type CharHit, type OnceProblem, type OnceTerm, type ParityProblems,
} from "../zh";
import { rungLabelAtStart } from "./ladder-ai";
import { evidenceOf, isLandmarkText, isZh, onlyPublishing, pageProseOf, seenText, shown, shownDepthOf } from "./shared";
import { EXPLAINER_FIELDS, parseZhKey, zhAll, zhKeyed, zhText, type Inventory, type StringEntry, type ZhKeyInfo } from "./strings";
import { defineRule, error, formatPath, list, plural, type PublishedInput, type Rule, type RuleInput, type ValidationIssue, type ZhInput } from "./types";
import type { FindingView } from "./views";

// ── What the rules share ─────────────────────────────────────────────────────────────────────────

/** The one host a term's `official_url` may be on (SPEC §4.12 ZH_OFFICIAL): 樂詞網, the National Academy for Educational Research's term bank. */
export const NAER_HOST = "terms.naer.edu.tw";

/** The cap of a correction's `after`, in Chinese characters: not a word budget, so no `zh_factor` (SPEC §4.6, §4.12 ZH_CHARS). */
export const CORRECTION_AFTER_CHARS = 300;

/** The Chinese cap of an English budget of `words`: ceil(words × `zh_factor`), without float drift (72.00000000000001 stays 72). */
export function zhCap(words: number, factor: number): number {
  return Math.ceil(Math.round(words * factor * 1e6) / 1e6);
}

/**
 * The first `max` characters of a Chinese string, for a message. Only the head of the text is read: a character is at most two UTF-16
 * units, so the first 2 * max + 1 units hold more than `max` characters whenever the text does, and a draft's string of 5 MB costs
 * a message no more than a short one (the draft is untrusted; F-70).
 */
export function excerpt(text: string, max = 40): string {
  const chars = Array.from(text.slice(0, 2 * max + 1));
  return chars.length <= max ? text : `${chars.slice(0, max).join("")}…`;
}

/**
 * The Chinese around a hit at UTF-16 offset `at`, for a message: the 10 characters before it and the 20 from it, with an ellipsis
 * where there are more. Only the units that can hold those and one more character on each side are read (22 before and 41 from `at`, since
 * a character is at most two units), so a 5 MB string costs no more than a short one (F-70).
 */
export function around(text: string, at: number): string {
  const head = Array.from(text.slice(Math.max(0, at - 22), at));
  const tail = Array.from(text.slice(at, at + 41));
  return `${head.length > 10 ? "…" : ""}${head.slice(-10).join("")}${tail.slice(0, 20).join("")}${tail.length > 20 ? "…" : ""}`;
}

const codePointOf = (char: string): string => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

/** "word" or "words" by the count, without the count: a message that lists the items names them. */
const noun = (n: number, word: string, many = `${word}s`): string => (n === 1 ? word : many);

/** "a, b, c and 2 more" for a long list in a message. */
function some(items: readonly string[], most = 6): string {
  return items.length <= most ? list(items) : `${list(items.slice(0, most))} and ${items.length - most} more`;
}

const keyPath = (key: string): string => formatPath(["strings", key]);
const termPath = (id: string): string => formatPath(["terms", id]);

/** The strings of the records being judged against `config/`: every string in zh mode, those of the records being published in published mode. */
const configEntries = (entries: readonly StringEntry[]): StringEntry[] => onlyPublishing(entries);

/** The place a string holds in its record: the same for the two sides of an `L10n`. */
const placeOf = (e: StringEntry): string => JSON.stringify([e.record.type, e.record.id, e.at]);

/** Each live English string of the inventory with the Chinese beside it (an `L10n` with both sides) and the place they share, in the Chinese side's document order. */
function pairsOf(inv: Inventory): { place: string; en: StringEntry; zh: StringEntry }[] {
  const live = inv.entries.filter((e) => !e.removed && e.correction !== "before");
  const english = new Map(live.filter((e) => e.lang === "en").map((e) => [placeOf(e), e]));
  return live.flatMap((zh) => {
    const place = placeOf(zh);
    const en = zh.lang === "zh" ? english.get(place) : undefined;
    return en === undefined ? [] : [{ place, en, zh }];
  });
}

// ── ZH_KEYS ──────────────────────────────────────────────────────────────────────────────────────

/**
 * ZH_KEYS (zh mode only: it reads the context): `strings` has exactly the context's keys and `terms` exactly the ids of its terms
 * whose `zh` is null. A key the pass left out is reported at the place it belongs, a key it added where it stands. The other rules
 * never report a missing or an extra key.
 */
const zhKeys = defineRule({
  code: "ZH_KEYS",
  scope: "zh",
  check(input: RuleInput): ValidationIssue[] {
    if (!isZh(input)) return [];
    const { draft, context } = input.zh;
    const out: ValidationIssue[] = [];
    const hint = "The pass writes exactly the context's keys: no key left out and none added.";
    const wanted = new Set(context.strings.map((s) => s.key));
    for (const s of context.strings) {
      if (!Object.hasOwn(draft.strings, s.key)) {
        out.push(error("ZH_KEYS", keyPath(s.key), `strings has no entry for the context key "${s.key}". Add its Chinese; the English is: "${excerpt(s.en, 60)}".`, hint));
      }
    }
    for (const key of Object.keys(draft.strings)) {
      if (!wanted.has(key)) {
        out.push(error("ZH_KEYS", keyPath(key), `"${shown(key)}" is not a key of the context. Remove it, or correct the key if it is a typo of one of the context's.`, hint));
      }
    }
    const termHint = "The pass gives the Chinese of exactly the context's terms whose zh is null.";
    const open = context.terms.filter((t) => t.zh === null);
    for (const t of open) {
      if (!Object.hasOwn(draft.terms, t.id)) {
        out.push(error("ZH_KEYS", termPath(t.id), `terms has no entry for "${t.id}" (${t.en}), whose Chinese the glossary does not hold. Add its zh, definition, official and official_url.`, termHint));
      }
    }
    const openIds = new Set(open.map((t) => t.id));
    const known = new Set(context.terms.map((t) => t.id));
    for (const id of Object.keys(draft.terms)) {
      if (openIds.has(id)) continue;
      const why = known.has(id) ? "the glossary already holds its Chinese" : "it is not a term of the context";
      out.push(error("ZH_KEYS", termPath(id), `terms has an entry for "${id}", but ${why}. Remove it.`, termHint));
    }
    return out;
  },
});

// ── ZH_PARITY ────────────────────────────────────────────────────────────────────────────────────

const PARITY_HINT = "The Chinese keeps every number of the English with the same value (a percentage as a percentage), and adds no number, link or Latin word of its own. The one exception is the English name of a glossary term of the edition, written alone in full-width brackets after its Chinese: 蛋白質摺疊（protein folding）.";

/**
 * The problems of one text against its English, in words. What the Chinese holds (a number, a link, a Latin word) is quoted through
 * `shown()`: the draft is untrusted, and a run of digits or letters as long as the draft would otherwise be printed whole. The English
 * numbers are quoted the same way: they come from a draft that passed the English rules, but a message never prints a value whole.
 */
function parityText(p: ParityProblems): string {
  const parts: string[] = [];
  if (p.missing.length > 0) parts.push(`the English has ${some(p.missing.map((n) => shown(n.text)))}, which the Chinese lacks`);
  if (p.extra.length > 0) parts.push(`the Chinese has ${some(p.extra.map((n) => shown(n.text)))}, which the English lacks`);
  if (p.urls.length > 0) parts.push(`the Chinese holds the ${noun(p.urls.length, "link")} ${some(p.urls.map(shown))}`);
  // The letters of a link are no Latin words of their own: the link is the problem.
  const latin = wordsOutsideLinks(p.latin, p.urls);
  if (latin.length > 0) parts.push(`the Chinese holds the Latin ${noun(latin.length, "word")} ${some(latin.map(shown))}, which the English lacks`);
  return parts.join("; ");
}

const hasProblems = (p: ParityProblems): boolean => p.missing.length + p.extra.length + p.urls.length + p.latin.length > 0;

/**
 * ZH_PARITY (zh mode only: the English is the context's): for each key, and for each term's `zh` and `definition` against its
 * context term's `en` and `definition`, the numbers match (read alike in both languages, `parityNumbers()`), with no URL and no
 * Latin word that the English lacks. A bracketed run is no exception unless it is the English name of one of the context's terms
 * (the glossary terms the edition's findings and the backlog's use): any other bracketed Latin word counts like one outside.
 * A key the context lacks has no English to compare and is ZH_KEYS's.
 */
const zhParity = defineRule({
  code: "ZH_PARITY",
  scope: "zh",
  check(input: RuleInput): ValidationIssue[] {
    if (!isZh(input)) return [];
    const out: ValidationIssue[] = [];
    const bracketable = input.zh.context.terms.map((t) => t.en);
    const terms = new Map<string, { zh?: StringEntry; definition?: StringEntry }>();
    for (const e of zhKeyed(input.inventory)) {
      const facts = e.zh;
      if (facts === null) continue;
      if (facts.term === null) {
        if (facts.en === null) continue;
        const p = parityProblems(facts.en, e.text, bracketable);
        if (hasProblems(p)) out.push(error("ZH_PARITY", e.path, `${facts.key}: ${parityText(p)}. Chinese: "${excerpt(e.text)}".`, PARITY_HINT));
      } else if (e.at === "zh" || e.at === "definition") {
        terms.set(facts.term, { ...terms.get(facts.term), [e.at]: e });
      }
    }
    for (const [id, t] of terms) {
      // The English of a term is set only on a term of the context, and then both of its entries exist.
      const name = t.zh?.zh?.en;
      const definition = t.definition?.zh?.en;
      if (name == null || definition == null) continue;
      const chinese = { zh: t.zh!.text, definition: t.definition!.text };
      const p = parityProblems([name, definition], [chinese.zh, chinese.definition], bracketable);
      if (hasProblems(p)) {
        out.push(error("ZH_PARITY", termPath(id), `terms.${id}: ${parityText(p)}. Chinese: "${excerpt(chinese.zh)}" and "${excerpt(chinese.definition)}".`, PARITY_HINT));
      }
    }
    return out;
  },
});

// ── ZH_TRADITIONAL ───────────────────────────────────────────────────────────────────────────────

/**
 * ZH_TRADITIONAL (zh mode; published mode on the records being published): no `simplified_only` or `japanese_only` character
 * (§4.11) anywhere in the Chinese, a term's `official` included.
 */
const zhTraditional = defineRule({
  code: "ZH_TRADITIONAL",
  scope: ["zh", "published"],
  check(input: RuleInput): ValidationIssue[] {
    if (input.mode === "draft") return [];
    const out: ValidationIssue[] = [];
    for (const e of configEntries(zhAll(input.inventory))) {
      const hits = traditionalHits(e.text, input.config.index);
      if (hits.length === 0) continue;
      const describe = (hit: CharHit): string => `${hit.char} (${codePointOf(hit.char)}) at ${hit.index}`;
      const simplified: string[] = [];
      const japanese: string[] = [];
      for (const hit of hits) (hit.list === "simplified_only" ? simplified : japanese).push(describe(hit));
      const parts: string[] = [];
      if (simplified.length > 0) parts.push(`the simplified-only ${noun(simplified.length, "character")} ${some(simplified)}`);
      if (japanese.length > 0) parts.push(`the Japanese-only ${noun(japanese.length, "character")} ${some(japanese)}`);
      out.push(error("ZH_TRADITIONAL", e.path, `The Chinese holds ${parts.join(" and ")}: Taiwan does not write ${hits.length === 1 ? "it" : "them"}. Write the traditional form that Taiwan uses. Chinese: "${around(e.text, hits[0]!.index)}".`,
        "Taiwan writes traditional characters (SPEC §4.11: config/terms-zh.json lists the ones it never uses)."));
    }
    return out;
  },
});

// ── ZH_AVOID ─────────────────────────────────────────────────────────────────────────────────────

/**
 * ZH_AVOID (zh mode; published mode on the records being published): no `avoid` term in the Chinese strings and in each term's
 * `zh` and `definition` (not `official`, which ZH_OFFICIAL checks against 樂詞網's own page), once every `fixed` translation
 * and every `allow_in` string is masked (§4.11). The message names the Taiwan term.
 */
const zhAvoid = defineRule({
  code: "ZH_AVOID",
  scope: ["zh", "published"],
  check(input: RuleInput): ValidationIssue[] {
    if (input.mode === "draft") return [];
    const out: ValidationIssue[] = [];
    for (const e of configEntries(zhText(input.inventory))) {
      const hits = avoidHits(e.text, input.config.termsZh);
      if (hits.length === 0) continue;
      const said = hits.map((h) => `"${h.term}" at ${h.index} (Taiwan writes "${h.taiwan}")`);
      out.push(error("ZH_AVOID", e.path, `The Chinese uses mainland wording: ${some(said)}. Write the Taiwan term instead. Chinese: "${around(e.text, hits[0]!.index)}".`,
        "config/terms-zh.json lists each mainland term with the Taiwan one; a fixed translation or an allow_in word that holds the term is not a hit."));
    }
    return out;
  },
});

// ── ZH_TERMS ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The entry of a context `fixed` item as `fixedMissing()` reads it: its `except` phrases from `config/terms-zh.json` (the file holds
 * each English term once), and no `fields`, since the context lists only the keys the entry applies to by field.
 */
function entryOf(input: ZhInput, fixed: ZhContext["fixed"][number]): FixedTerm {
  const listed = input.config.termsZh.fixed.find((c) => c.en === fixed.en);
  return { en: fixed.en, zh: fixed.zh, fields: [], except: listed?.except ?? [] };
}

const TERMS_HINT = "config/terms-zh.json fixes the Chinese of these terms (SPEC §4.11); a fixed term inside a name that the Chinese keeps in English, letter for letter, is left alone.";

function missingTerm(path: string, label: string, entry: FixedTerm, chinese: string): ValidationIssue {
  return error("ZH_TERMS", path, `${label}: the English has "${entry.en}", which config/terms-zh.json fixes as ${entry.zh} in Chinese, but the Chinese lacks ${entry.zh}. Use ${entry.zh} there. Chinese: "${excerpt(chinese)}".`, TERMS_HINT);
}

/** The field of the finding a stored string belongs to, as filed on the date of the string (as first published when the string names none); null for a string of no finding. */
function fieldOf(input: RuleInput, e: StringEntry): FieldId | null {
  const key = e.about ?? e.finding;
  if (key === null) return null;
  const view = input.views.find(key);
  if (view === null) return null;
  return (e.filedOn === null ? view.published : view.filedOn(e.filedOn)).field;
}

/**
 * ZH_TERMS (zh mode; published mode on the records being published): wherever a `fixed` entry applies (§4.11: by its `fields`,
 * outside its `except` phrases and outside a name kept in English), the Chinese contains the entry's `zh`: each string where
 * its English has the entry, and each term's `zh` and `definition` together where its English term or definition has it. In zh mode
 * the context's `fixed` says where each entry applies by field (`buildZhContext()`, SPEC §4.6) and the rule re-reads `except` and the
 * names; in published mode it reads the config's entries against each stored string and the field of its finding.
 */
const zhTerms = defineRule({
  code: "ZH_TERMS",
  scope: ["zh", "published"],
  check(input: RuleInput): ValidationIssue[] {
    if (input.mode === "draft") return [];
    return isZh(input) ? termsInZh(input) : termsInPublished(input as PublishedInput);
  },
});

function termsInZh(input: ZhInput): ValidationIssue[] {
  const { draft, context } = input.zh;
  const strings = new Map(context.strings.map((s) => [s.key, s]));
  const terms = new Map(context.terms.map((t) => [t.id, t]));
  const out: ValidationIssue[] = [];
  for (const fixed of context.fixed) {
    const entry = entryOf(input, fixed);
    for (const key of fixed.keys) {
      if (key.startsWith("terms.")) {
        const id = key.slice("terms.".length);
        const term = terms.get(id);
        const written = Object.hasOwn(draft.terms, id) ? draft.terms[id] : undefined;
        if (term === undefined || written === undefined) continue;
        if (fixedMissing([entry], [term.en, term.definition], [written.zh, written.definition], null).length > 0) {
          out.push(missingTerm(termPath(id), `terms.${id}`, entry, `${written.zh} / ${written.definition}`));
        }
      } else {
        const s = strings.get(key);
        const chinese = Object.hasOwn(draft.strings, key) ? draft.strings[key] : undefined;
        if (s === undefined || chinese === undefined) continue;
        if (fixedMissing([entry], s.en, chinese, null).length > 0) out.push(missingTerm(keyPath(key), key, entry, chinese));
      }
    }
  }
  return out;
}

function termsInPublished(input: PublishedInput): ValidationIssue[] {
  const fixed = input.config.termsZh.fixed;
  const out: ValidationIssue[] = [];
  const glossary = new Map<string, { en: StringEntry[]; zh: StringEntry[] }>();
  for (const { en, zh } of pairsOf(input.inventory)) {
    if (!zh.publishing) continue;
    if (zh.record.type === "term") {
      const unit = glossary.get(zh.record.id ?? "") ?? { en: [], zh: [] };
      unit.en.push(en);
      unit.zh.push(zh);
      glossary.set(zh.record.id ?? "", unit);
      continue;
    }
    for (const entry of fixedMissing(fixed, en.text, zh.text, fieldOf(input, zh))) out.push(missingTerm(zh.path, zh.at, entry, zh.text));
  }
  for (const [id, unit] of glossary) {
    // A glossary term has no finding of its own: only the entries whose `fields` is [] apply (lib/zh.ts `fixedApplies()`).
    for (const entry of fixedMissing(fixed, unit.en.map((e) => e.text), unit.zh.map((e) => e.text), null)) {
      out.push(missingTerm(unit.zh[0]!.path, `glossary term ${id}`, entry, unit.zh.map((e) => e.text).join(" / ")));
    }
  }
  return out;
}

// ── ZH_RUNG_LABEL ────────────────────────────────────────────────────────────────────────────────

/** What a rung label check found: the rung the English starts with and the Chinese label its Chinese must start with. */
export interface RungLabelProblem {
  rung: Rung;
  /** The English label the text starts with. */
  english: string;
  /** The zh label the Chinese must start with. */
  label: string;
}

/**
 * ZH_RUNG_LABEL's check on one pair (SPEC §4.12): where the English starts with a rung's label (`rungLabelAtStart()` of the ladder
 * group, WHO_SAYS's reading: "Checked", then no letter or digit), the Chinese starts with that rung's zh label from `RUNG_INFO`,
 * never a fresh translation. Returns the problem, or null when the English starts with no label or the Chinese starts with the
 * right one. Pure, so the seeder reads it too.
 */
export function rungLabelProblem(english: string, chinese: string): RungLabelProblem | null {
  const rung = rungLabelAtStart(english);
  if (rung === null) return null;
  const label = RUNG_INFO[rung].zh;
  return chinese.startsWith(label) ? null : { rung, english: RUNG_INFO[rung].en, label };
}

/**
 * ZH_RUNG_LABEL (zh mode only, as it is for drafts and seeds: JL may change a label by PR, §4.2): where an English `how_sure`
 * (a new finding's or a backlog finding's), or a correction's `after` on `explainer.how_sure`, starts with a rung's label, the
 * Chinese starts with that rung's zh label.
 */
const zhRungLabel = defineRule({
  code: "ZH_RUNG_LABEL",
  scope: "zh",
  check(input: RuleInput): ValidationIssue[] {
    if (!isZh(input)) return [];
    const { draft, context, english } = input.zh;
    const out: ValidationIssue[] = [];
    for (const s of context.strings) {
      const info = parseZhKey(s.key);
      if (info === null || !Object.hasOwn(draft.strings, s.key)) continue;
      const isHowSure = (info.section === "new" || info.section === "backlog") && info.field === "how_sure";
      const isCorrection = info.section === "corrections" && info.field === "after" && info.index !== null
        && english.corrections[info.index]?.path === "explainer.how_sure";
      if (!isHowSure && !isCorrection) continue;
      const chinese = draft.strings[s.key]!;
      const problem = rungLabelProblem(s.en, chinese);
      if (problem === null) continue;
      out.push(error("ZH_RUNG_LABEL", keyPath(s.key),
        `The English starts with the rung label "${problem.english}", so the Chinese must start with ${problem.label}, the site's word for it, not a fresh translation. It starts "${excerpt(chinese, 12)}".`,
        "The context's labels give the site's word for each rung (lib/vocab.ts); then the rest of the sentence follows."));
    }
    return out;
  },
});

// ── ZH_ENGLISH_ONCE ──────────────────────────────────────────────────────────────────────────────

/** The parts every explainer has (`ai_helped` is null for a finding with no AI role). */
const ALWAYS_PARTS = EXPLAINER_FIELDS.filter((p) => p !== "ai_helped");

const ONCE_HINT = "In a finding's Chinese explainer each of its terms appears by its zh; the first use is followed at once by the English term in full-width brackets, no later use is, and a title never carries one.";

/** What to write after a term's first use: its English in full-width brackets, unless the term's Chinese is its English. `zh` is the term's Chinese as a message prints it. */
const bracketed = (term: OnceTerm, zh: string): string =>
  term.zh.trim().toLowerCase() === term.en.trim().toLowerCase() ? zh : `${zh}（${term.en}）`;

/** The issue for one misuse of a term. A term's `zh` is the draft's own text when the glossary holds none, so a message prints it through `shown()`. */
function onceIssue(problem: OnceProblem, where: { part: (index: number) => string; title: string; first: string }): ValidationIssue {
  const { term } = problem;
  const zh = shown(term.zh);
  if (problem.kind === "unused") {
    return error("ZH_ENGLISH_ONCE", where.first, `The Chinese explainer never uses the term "${term.en}" (${zh}). Use ${bracketed(term, zh)} where the English explainer uses it.`, ONCE_HINT);
  }
  if (problem.kind === "first_unbracketed") {
    return error("ZH_ENGLISH_ONCE", where.part(problem.part), `The first use of ${zh} is not followed by the English term in full-width brackets. Write ${bracketed(term, zh)} there.`, ONCE_HINT);
  }
  if (problem.kind === "later_bracketed") {
    return error("ZH_ENGLISH_ONCE", where.part(problem.part), `A later use of ${zh} repeats the English term in brackets; only the first use carries it. Remove （${term.en}） here.`, ONCE_HINT);
  }
  return error("ZH_ENGLISH_ONCE", where.title, `The title carries the English term "${term.en}" in brackets; a title never does. Remove （${term.en}）.`, ONCE_HINT);
}

/** The context terms whose English the finding's English explainer uses (STYLE-ZH.md §7), the longest English first so that "protein" inside "protein folding" is no use of "protein". */
function termsUsedBy(terms: ZhContext["terms"], english: readonly string[]): ZhContext["terms"] {
  const masked = [...english];
  const used = new Set<string>();
  for (const term of [...terms].sort((a, b) => b.en.length - a.en.length)) {
    const entry: FixedTerm = { en: term.en, zh: term.zh ?? "", fields: [], except: [] };
    masked.forEach((text, i) => {
      const hits = fixedOccurrences(entry, text);
      if (hits.length === 0) return;
      used.add(term.id);
      let blanked = text;
      for (const h of [...hits].reverse()) blanked = blanked.slice(0, h.start) + " ".repeat(h.end - h.start) + blanked.slice(h.end);
      masked[i] = blanked;
    });
  }
  return terms.filter((t) => used.has(t.id));
}

/**
 * ZH_ENGLISH_ONCE (zh mode; published mode on every stored record, since it reads no config): in each finding whose explainer has
 * Chinese (in a Chinese draft, each new finding and each backlog finding whose explainer it translates), each of its terms appears in
 * its Chinese explainer, the first use there, in part order, is followed by the English term in full-width brackets (none is
 * needed when the term's Chinese is its English), no later use is, and its title never carries one. A finding with a removed
 * explainer part no longer needs each term to appear, nor the first remaining use to carry the English.
 */
const zhEnglishOnce = defineRule({
  code: "ZH_ENGLISH_ONCE",
  scope: ["zh", "published"],
  check(input: RuleInput): ValidationIssue[] {
    if (input.mode === "draft") return [];
    return isZh(input) ? onceInZh(input) : onceInPublished(input as PublishedInput);
  },
});

function onceInZh(input: ZhInput): ValidationIssue[] {
  const { draft, context } = input.zh;
  const strings = new Map(context.strings.map((s) => [s.key, s]));
  const prefixes = new Map<string, "new" | "backlog">();
  for (const s of context.strings) {
    const info = parseZhKey(s.key);
    if (info !== null && (info.section === "new" || info.section === "backlog") && (EXPLAINER_FIELDS as readonly string[]).includes(info.field)) {
      prefixes.set(`${info.section}.${info.finding}`, info.section);
    }
  }
  const out: ValidationIssue[] = [];
  for (const [prefix, section] of prefixes) {
    const keys = EXPLAINER_FIELDS.map((p) => `${prefix}.explainer.${p}`);
    const listed = keys.filter((k) => strings.has(k));
    // A part the draft lacks is ZH_KEYS's: the finding is judged once its explainer is whole.
    if (listed.some((k) => !Object.hasOwn(draft.strings, k))) continue;
    const terms: OnceTerm[] = termsUsedBy(context.terms, listed.map((k) => strings.get(k)!.en)).flatMap((t) => {
      const zh = t.zh ?? (Object.hasOwn(draft.terms, t.id) ? draft.terms[t.id]!.zh : null);
      return zh === null ? [] : [{ en: t.en, zh }];
    });
    const titleKey = `${prefix}.title`;
    // A backlog finding's context lists only the strings the pass writes: a part it lacks, an `ai_helped` apart, is one that a
    // `removed` correction rewrote (the context leaves out REMOVED_TEXT).
    const partRemoved = section === "backlog" && ALWAYS_PARTS.some((p) => !listed.includes(`${prefix}.explainer.${p}`));
    const problems = englishOnceProblems({
      parts: keys.map((k) => (listed.includes(k) ? draft.strings[k]! : "")),
      title: Object.hasOwn(draft.strings, titleKey) ? draft.strings[titleKey]! : "",
      terms,
      partRemoved,
    });
    const first = keyPath(listed[0]!);
    for (const p of problems) out.push(onceIssue(p, { part: (i) => keyPath(keys[i]!), title: keyPath(titleKey), first }));
  }
  return out;
}

function onceInPublished(input: PublishedInput): ValidationIssue[] {
  const glossary = new Map(input.published.terms.map((t) => [t.id, t]));
  const out: ValidationIssue[] = [];
  for (const f of input.views.findings) {
    if (f.basis !== "record" || f.explainer === null || f.title === null) continue;
    const explainer = f.explainer;
    const present = EXPLAINER_FIELDS.flatMap((p) => (explainer[p] === null ? [] : [{ part: p, text: explainer[p]! }]));
    if (present.some((p) => p.text.zh === null)) continue;
    const terms: OnceTerm[] = (f.terms ?? []).flatMap((use) => {
      const term = use.id === null ? undefined : glossary.get(use.id);
      return term === undefined || term.zh === null ? [] : [{ en: term.en.term, zh: term.zh.term }];
    });
    const problems = englishOnceProblems({
      parts: EXPLAINER_FIELDS.map((p) => explainer[p]?.zh ?? ""),
      title: f.title.zh ?? "",
      terms,
      partRemoved: present.some((p) => f.removed.has(`explainer.${p.part}`)),
    });
    const first = f.where("explainer.found", "zh");
    for (const p of problems) {
      out.push(onceIssue(p, { part: (i) => f.where(`explainer.${EXPLAINER_FIELDS[i]}`, "zh"), title: f.where("title", "zh"), first }));
    }
  }
  return out;
}

// ── ZH_CHARS ─────────────────────────────────────────────────────────────────────────────────────

/** A string to count, with the cap it must stay within and the combined budget it shares. */
interface Counted {
  path: string;
  label: string;
  text: string;
  cap: number;
  group: ZhGroup | null;
}

const PAGE_FINDING_FIELDS: readonly string[] = ["title", "found", "matters", "ai_helped", "how_sure"];
const PAGE_STORY_FIELDS: readonly string[] = ["background", "could_lead"];

/** Whether a finding's part counts in the page total: the title and the first four parts of each finding the edition shows as new, and the story's last two (strings.ts `pageProse()`). */
const countsForFinding = (field: string, depth: "story" | "item" | null): boolean =>
  depth !== null && (PAGE_FINDING_FIELDS.includes(field) || (depth === "story" && PAGE_STORY_FIELDS.includes(field)));

/** Whether a context key's English counts in WORDS' page total (never a backlog key, a rung note, a correction, a report or an item's background and could_lead). */
function inZhPageTotal(info: ZhKeyInfo, depthOf: (key: string) => "story" | "item" | null): boolean {
  if (info.section === "lead" || info.section === "ideas" || info.section === "also" || info.section === "deep_dive" || info.section === "review") return true;
  if (info.section === "returning") return info.field === "update";
  if (info.section === "new") return countsForFinding(info.field, info.finding === null ? null : depthOf(info.finding));
  return false;
}

/**
 * The Chinese page total of a Chinese draft (`computed.zh_chars`, SPEC §4.12 ZH_CHARS): `countZhChars()` over the strings whose
 * English counts in WORDS' page total, never a backlog key, an item's background or could_lead, a rung note, a correction or a
 * report. A key the context lacks or the draft lacks counts nothing (ZH_KEYS says so).
 */
export function zhPageTotal(input: ZhInput): number {
  const { draft, context } = input.zh;
  const depthOf = shownDepthOf(input.views);
  let total = 0;
  for (const s of context.strings) {
    const info = parseZhKey(s.key);
    if (info !== null && inZhPageTotal(info, depthOf)) total += countZhChars(draft.strings[s.key] ?? "");
  }
  return total;
}

function countedInZh(input: ZhInput): Counted[] {
  const out: Counted[] = [];
  for (const e of zhKeyed(input.inventory)) {
    const facts = e.zh;
    if (facts === null || facts.cap_chars === null) continue;
    out.push({ path: e.path, label: facts.term === null ? facts.key : `terms.${facts.term} definition`, text: e.text, cap: facts.cap_chars, group: facts.group });
  }
  return out;
}

/** SPEC §4.12 "Word budgets": the English caps of a story's six parts, in words. */
const STORY_PART_WORDS = { found: 55, matters: 50, ai_helped: 60, how_sure: 60, background: 35, could_lead: 35 } as const;
/** SPEC §4.12 "Word budgets": the English caps of the other prose, in words; the deep dive and the big picture take the top of their range. */
const BUDGET_WORDS: Readonly<Record<string, number>> = {
  title: 12, update: 60, since_then: 60, note: 25, idea: 40, also: 20, deep_dive: 550, big_picture: 330, remarkable: 30, against: 50,
  definition: 40, reason: 40, alt: 40,
};
const LEAD_WORDS = 60;
const STORY_WORDS = 280;
const ITEM_WORDS = 100;
const ITEM_TAIL_WORDS = 40;

/** The cap and group of a stored Chinese string, or null when it has no budget (a name, a Pace sentence, a status note). */
function capOfStored(input: PublishedInput, e: StringEntry): { cap: number; group: ZhGroup | null } | null {
  const words = (n: number): number => zhCap(n, input.config.run.budgets.zh_factor);
  if (e.correction === "after") return { cap: CORRECTION_AFTER_CHARS, group: null };
  const field = e.field;
  if (field === null) return null;
  if (field === "lead") return { cap: words(LEAD_WORDS), group: { id: "lead", cap_chars: words(LEAD_WORDS) } };
  if ((EXPLAINER_FIELDS as readonly string[]).includes(field)) {
    const depth = e.finding === null ? null : input.views.find(e.finding)?.depth ?? null;
    if (depth === null) return null;
    const part = field as keyof typeof STORY_PART_WORDS;
    const group = (n: number): ZhGroup => ({ id: `${e.finding}.explainer`, cap_chars: words(n) });
    if (depth === "story") return { cap: words(STORY_PART_WORDS[part]), group: group(STORY_WORDS) };
    return part === "background" || part === "could_lead" ? { cap: words(ITEM_TAIL_WORDS), group: null } : { cap: words(ITEM_WORDS), group: group(ITEM_WORDS) };
  }
  const budget = BUDGET_WORDS[field];
  return budget === undefined ? null : { cap: words(budget), group: null };
}

function countedInPublished(input: PublishedInput): Counted[] {
  const out: Counted[] = [];
  for (const e of configEntries(zhText(input.inventory))) {
    const budget = capOfStored(input, e);
    if (budget !== null) out.push({ path: e.path, label: e.path, text: e.text, ...budget });
  }
  return out;
}

/** The Chinese page total of the brief being published: the Chinese beside each English string of WORDS' page total (`pageProse()`). */
function publishedPageTotal(input: PublishedInput): number {
  const chinese = new Map(pairsOf(input.inventory).map(({ place, zh }) => [place, zh]));
  return pageProseOf(input).reduce((n, en) => n + countZhChars(chinese.get(placeOf(en))?.text ?? ""), 0);
}

/**
 * ZH_CHARS (zh mode; published mode on the records being published): each string within its `cap_chars`, and each group's strings
 * together within the group's `cap_chars` (§4.6), and the Chinese page total within `ceil(words_max × zh_factor)`. In zh mode the caps
 * are the context's; in published mode they are the word budgets of §4.12 times `zh_factor`, the story's six parts and an item's first
 * four sharing one cap, and the page total is the brief's (`computed.zh_chars`).
 */
const zhChars = defineRule({
  code: "ZH_CHARS",
  scope: ["zh", "published"],
  check(input: RuleInput): ValidationIssue[] {
    if (input.mode === "draft") return [];
    const counted = (isZh(input) ? countedInZh(input) : countedInPublished(input as PublishedInput))
      .map((c) => ({ ...c, chars: countZhChars(c.text) }))
      .sort((a, b) => byCodeUnit(a.path, b.path));
    const out: ValidationIssue[] = [];
    for (const c of counted) {
      if (c.chars <= c.cap) continue;
      out.push(error("ZH_CHARS", c.path, `${c.label} has ${c.chars} characters (Chinese length, SPEC §4.1); the limit is ${c.cap}. Cut at least ${c.chars - c.cap}. Chinese: "${excerpt(c.text)}".`,
        "A run of Latin letters or digits counts one character; punctuation and spaces count none."));
    }
    const groups = new Map<string, { cap: number; members: typeof counted }>();
    for (const c of counted) {
      if (c.group === null) continue;
      const g = groups.get(c.group.id) ?? { cap: c.group.cap_chars, members: [] };
      g.members.push(c);
      groups.set(c.group.id, g);
    }
    for (const [id, g] of groups) {
      const total = g.members.reduce((n, c) => n + c.chars, 0);
      if (total <= g.cap) continue;
      const parts = g.members.map((c) => `${c.label} ${c.chars}`);
      out.push(error("ZH_CHARS", g.members[0]!.path, `The strings of the group ${id} together have ${total} characters (${some(parts)}); the limit is ${g.cap}. Cut at least ${total - g.cap}.`,
        "These strings share one budget, as the English parts do."));
    }
    const budgets = input.config.run.budgets;
    const pageCap = zhCap(budgets.words_max, budgets.zh_factor);
    const total = isZh(input) ? zhPageTotal(input) : input.views.brief.publishing ? publishedPageTotal(input as PublishedInput) : 0;
    if (total > pageCap) {
      const where = isZh(input) ? formatPath(["strings"]) : input.views.brief.where("computed.zh_chars");
      out.push(error("ZH_CHARS", where, `The Chinese page text has ${total} characters (the strings whose English counts in the page total of WORDS); the limit is ${pageCap}. Cut at least ${total - pageCap}.`,
        "Never a backlog string, an item's background or could_lead, a rung note, a correction or a report counts."));
    }
    return out;
  },
});

// ── ZH_OFFICIAL ──────────────────────────────────────────────────────────────────────────────────

/**
 * The host check of ZH_OFFICIAL on one `official_url` (SPEC §4.12, §8.13 "without `--verify`, only its host is checked"): null when
 * it is an http(s) address on terms.naer.edu.tw, else what is wrong with it. Pure, so the seeder reads it too.
 */
export function officialUrlProblem(url: string): string | null {
  return /^https?:\/\//i.test(url) && hostOf(url) === NAER_HOST ? null : `is not an http(s) address on ${NAER_HOST}`;
}

const OFFICIAL_HINT = "A term's official comes from a 樂詞網 page the pass fetched (official_url) and shows that page's own wording; if no page shows the term, official and official_url are both null.";

/**
 * ZH_OFFICIAL (zh mode only: it reads the pass's fetches): a non-null `official` comes with an `official_url` on terms.naer.edu.tw
 * that the Chinese pass fetched, and appears in the text of that URL's snapshot (both NFKC). Without the pass's evidence the host
 * is still checked and the engine reports the checks that ran without it (`uses`). `validateZh()` fetches nothing. A null `official`
 * with an `official_url` of another host is an error too (the address would be published as written); one on the host passes.
 */
const zhOfficial = defineRule({
  code: "ZH_OFFICIAL",
  scope: "zh",
  uses: ["evidence"],
  check(input: RuleInput): ValidationIssue[] {
    if (!isZh(input)) return [];
    const evidence = evidenceOf(input);
    const out: ValidationIssue[] = [];
    for (const [id, term] of Object.entries(input.zh.draft.terms)) {
      const where = `terms.${id}`;
      const urlPath = formatPath(["terms", id, "official_url"]);
      if (term.official === null) {
        // No official, so no page to fetch or to read. The glossary keeps `official_url` as written and the file's one address is a
        // 樂詞網 page, so a stray address is held to the host check alone (STYLE-ZH §7 asks for null; a stray page on the host does no harm).
        const stray = term.official_url === null ? null : officialUrlProblem(term.official_url);
        if (stray !== null) {
          out.push(error("ZH_OFFICIAL", urlPath, `${where} has no official, but its official_url "${excerpt(term.official_url!, 80)}" ${stray}. Set official_url to null: the one address in the file is the 樂詞網 page that shows an official term.`, OFFICIAL_HINT));
        }
        continue;
      }
      if (term.official_url === null) {
        out.push(error("ZH_OFFICIAL", urlPath, `${where} has the official "${shown(term.official)}" but no official_url. Give the 樂詞網 page you fetched that shows it, or set official to null.`, OFFICIAL_HINT));
        continue;
      }
      const wrong = officialUrlProblem(term.official_url);
      if (wrong !== null) {
        out.push(error("ZH_OFFICIAL", urlPath, `${where}: the official_url "${excerpt(term.official_url, 80)}" ${wrong}. Give the 樂詞網 page that shows "${shown(term.official)}", or set official to null.`, OFFICIAL_HINT));
        continue;
      }
      if (evidence === null) continue;
      const url = normalizeUrl(term.official_url);
      if (!evidence.fetched.some((f) => normalizeUrl(f) === url)) {
        out.push(error("ZH_OFFICIAL", urlPath, `${where}: the Chinese pass did not fetch ${shown(term.official_url)}, so the page cannot show "${shown(term.official)}". Fetch the page and read the term from it, or set official to null.`, OFFICIAL_HINT));
        continue;
      }
      const page = seenText(input, term.official_url);
      if (!page.normalize("NFKC").includes(term.official.normalize("NFKC"))) {
        const why = page === "" ? "the evidence holds no text of that page" : "the page text does not hold it";
        out.push(error("ZH_OFFICIAL", formatPath(["terms", id, "official"]), `${where}: "${shown(term.official)}" is not in the page ${shown(term.official_url)}: ${why}. Copy the term character for character from the page, or set official to null.`, OFFICIAL_HINT));
      }
    }
    return out;
  },
});

// ── ZH_NO_DASH ───────────────────────────────────────────────────────────────────────────────────

/**
 * ZH_NO_DASH (zh mode; published mode on every stored record): no dash anywhere in the Chinese text (every string, and each term's
 * `zh` and `definition`; not `official`, quoted from 樂詞網), read as written, before any NFKC: no `\p{Pd}` character except the
 * hyphen-minus, the hyphens U+2010 and U+2011 and an en dash between digits, and no box-drawing line (U+2500, U+2501).
 */
const zhNoDash = defineRule({
  code: "ZH_NO_DASH",
  scope: ["zh", "published"],
  check(input: RuleInput): ValidationIssue[] {
    if (input.mode === "draft") return [];
    const out: ValidationIssue[] = [];
    for (const e of zhText(input.inventory)) {
      const hits = dashHits(e.text);
      if (hits.length === 0) continue;
      const found = hits.map((h) => `${h.codePoint} at ${h.index}`);
      out.push(error("ZH_NO_DASH", e.path, `The Chinese has ${plural(hits.length, "dash", "dashes")}: ${some(found)}. Write the sentence without ${hits.length === 1 ? "it" : "them"}: use a comma, a full stop or 、 instead. Chinese: "${around(e.text, hits[0]!.index)}".`,
        "No dash of any kind: not the em dash U+2014 (nor two in a row), the horizontal bar U+2015, U+2E3A, U+FE58 or the full-width hyphen U+FF0D; a hyphen-minus, U+2010, U+2011 and an en dash between digits (a range) are allowed."));
    }
    return out;
  },
});

// ── ZH_HYPE ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The finding a Chinese context key is about, for the Landmark question: the English draft names the deep dive's, the remarkable
 * note's and a correction's, and the key itself names a finding's own strings. Null for the Lead, an idea, an Also noted line, the
 * big picture and the strongest evidence against; a report's key names the report, which no finding has as its id, so no view holds it.
 */
function aboutOfKey(input: ZhInput, info: ZhKeyInfo): string | null {
  const { english } = input.zh;
  if (info.section === "deep_dive") return english.deep_dive?.finding_id ?? null;
  if (info.section === "review") return info.field === "remarkable" ? english.review?.remarkable?.finding_id ?? null : null;
  if (info.section === "corrections") return info.field === "after" && info.index !== null ? english.corrections[info.index]?.finding_id ?? null : null;
  return info.finding;
}

/**
 * The date a Chinese string files its finding on, to ask whether the finding is a Landmark (HYPE_WORDS' reading, SPEC §4.12): none,
 * as first published, for a new or backlog finding's own title, explainer and figure alt; for one of its rung notes, the date that
 * history entry was recorded on (a draft's own entry has none: D); and D, with the draft's own corrections, for every other string:
 * a `since` update, a returning update, a rung change, the deep dive, the remarkable note and a correction's `after`.
 */
function filedOnZh(input: ZhInput, info: ZhKeyInfo, view: FindingView): IsoDate | null {
  if ((info.section !== "new" && info.section !== "backlog") || info.field === "since_then") return input.date;
  if (info.field !== "note") return null;
  return view.rung_history?.find((r) => r.index === info.index)?.recorded ?? input.date;
}

/**
 * Whether 突破 may stand in a Chinese string of the draft (SPEC §4.12 ZH_HYPE, "as HYPE_WORDS reads it"): in a Landmark's text, that
 * is a new finding's or a backlog finding's own title, explainer and figure alt as first published, a rung note on the date it was
 * recorded, the returning update, the deep dive, the remarkable note and a correction's `after` on a finding as filed on D
 * (`filedOnZh()`), never the Lead, the big picture or another string of the brief. A finding the views know no significance of (a
 * stored finding whose record the run was not given, which the context's strings do not describe either) is neither: the rule
 * skips what it cannot know, so 突破 is not judged there, where a run that read the record would; nor in a rung note of a finding
 * whose rung history the run lacks, since a note is read on the day its entry was recorded and only the record holds that day.
 * The other hype words are judged wherever they stand. A key that names no finding of the run (a new finding or a returning one
 * the English draft lacks, an id that is no finding id) is no finding's text: every backlog finding of a key is in the views.
 */
function breakthroughMayStand(input: ZhInput, e: StringEntry): boolean {
  if (e.zh === null) return false;
  const info = parseZhKey(e.zh.key);
  if (info === null) return false;
  const about = aboutOfKey(input, info);
  if (about === null) return false;
  const view = input.views.find(about);
  if (view === null) return false;
  if (info.section === "backlog" && info.field === "note" && view.rung_history === null) return true;
  const filedOn = filedOnZh(input, info, view);
  const { significance } = filedOn === null ? view.published : view.filedOn(filedOn);
  return significance === null || significance === "landmark";
}

/**
 * ZH_HYPE (zh mode; published mode on the records being published): no `hype-words.json` `zh` word in a Chinese string or term
 * definition, matched anywhere since Chinese has no spaces between words; 突破 only in a Landmark's text, with each name's `zh`
 * that is not null (突破獎) masked first.
 */
const zhHype = defineRule({
  code: "ZH_HYPE",
  scope: ["zh", "published"],
  check(input: RuleInput): ValidationIssue[] {
    if (input.mode === "draft") return [];
    const out: ValidationIssue[] = [];
    for (const e of configEntries(zhText(input.inventory))) {
      const landmark = isZh(input) ? breakthroughMayStand(input, e) : isLandmarkText(input.views, e);
      const hits = hypeHits(e.text, input.config.hypeWords, { landmark });
      if (hits.length === 0) continue;
      const found = hits.map((h) => `"${h.word}" at ${h.index}`);
      const only = hits.some((h) => h.word === LANDMARK_ONLY_ZH)
        ? ` ${LANDMARK_ONLY_ZH} translates "breakthrough" and stands only in a Landmark finding's own text, a returning update, the deep dive or the remarkable note on one.`
        : "";
      out.push(error("ZH_HYPE", e.path, `The Chinese uses ${plural(hits.length, "hype word")}: ${some(found)}. Say what happened instead, with the figure if there is one.${only} Chinese: "${around(e.text, hits[0]!.index)}".`,
        "config/hype-words.json lists the words; a listed name keeps its own wording (the context's hype_names)."));
    }
    return out;
  },
});

/** The group's rules, in the order of the rule table. */
export const zhRules: Rule[] = [
  zhKeys, zhParity, zhTraditional, zhAvoid, zhTerms, zhRungLabel, zhEnglishOnce, zhChars, zhOfficial, zhNoDash, zhHype,
];
