// The words rule group (SPEC §4.12): WORDS (the word budgets of the table and the page total with its soft target),
// SENTENCE_LENGTH, HYPE_WORDS, TERM_DEFINED, READING_LEVEL and NO_EM_DASH. Each code is one rule that reads the frame's string
// selectors (lib/rules/strings.ts) and views, so the strings it judges are the ones the spec names, in a draft and in a stored
// record alike; no rule walks a record, a file, the clock or the network. A message gives the value found, the limit and the edit.
//
// Where each runs (SPEC §4.12 "Stored records"), in a draft, on the records a published run is publishing, and on every other
// stored record:
//   - the fixed limits run in all three: the word budgets of the table (every one but the page total; a correction's `after` has
//     the budget of the string its path names), SENTENCE_LENGTH, NO_EM_DASH, and TERM_DEFINED's test that each listed term
//     appears in the explainer;
//   - the tests that read `config/` or a `run.json` budget run in a draft and on the records being published only: WORDS' page
//     total (hard and soft), READING_LEVEL, HYPE_WORDS, and TERM_DEFINED's jargon tests;
//   - a string that a stored `removed` correction rewrote is left out by every selector, so no rule reads it; WORDS counts it as
//     no words and drops the lower bound of the budget it counts in, and TERM_DEFINED no longer needs each listed term to appear
//     in a finding with a removed explainer part (SPEC §4.12 "Removed text").
// A correction's `before` is never read by a rule that reads `config/` (it is copied from text published earlier).
//
// Cyber's lib/rules/words.ts at the fork commit 3ced1fb, adapted: its WORDS_OVER and WORDS_UNDER become WORDS (a cap on each field
// and a range on each group of parts, with the lower bound dropped for removed text), its page total WORDS_OVER the hard limit and
// soft target of the page total, and its BANNED_WORDS (whole words in any case, a hyphen counting as a space, the quoted fields and
// source titles exempt) the matcher of HYPE_WORDS, with the names that hold a hype word masked first. SENTENCE_LENGTH,
// READING_LEVEL, NO_EM_DASH and TERM_DEFINED are new.

import { termIdOf } from "../ids";
import { readingGrade } from "../readability";
import { TERM_ID_MAX } from "../schema/common";
import { countWords, maskPhrases, splitSentences, wordRe, wordsIn } from "../text";
import { extendPath, isDraft, isLandmarkText, newFindings, onlyPublishing, pageProseOf } from "./shared";
import {
  EXPLAINER_FIELDS, dashStrings, definitionStrings, explainerStrings, hypeStrings, modelProse, readingStrings, removedProse,
  type StringEntry, type StringField,
} from "./strings";
import { defineRule, error, list, plural, warning, type Rule, type RuleInput, type ValidationIssue } from "./types";
import type { CorrectionView, FindingView } from "./views";

const MODES = ["draft", "published"] as const;

// ── The word budgets (SPEC §4.12 "Word budgets") ─────────────────────────────────────────────────

interface Range {
  min: number;
  max: number;
}

/** The fields whose budget is one cap on one string, with what a message calls them (the Lead, the explainer parts, the deep dive and the big picture have their own). */
const FIELD_BUDGET: ReadonlyMap<StringField, { max: number; label: string }> = new Map<StringField, { max: number; label: string }>([
  ["title", { max: 12, label: "The title" }],
  ["update", { max: 60, label: "The returning update" }],
  ["since_then", { max: 60, label: "The returning update" }],
  ["note", { max: 25, label: "The rung note" }],
  ["idea", { max: 40, label: "The idea" }],
  ["also", { max: 20, label: "The Also noted title" }],
  ["remarkable", { max: 30, label: "The remarkable note" }],
  ["against", { max: 50, label: "The strongest evidence against" }],
  ["definition", { max: 40, label: "The definition" }],
  ["reason", { max: 40, label: "The reason" }],
  ["alt", { max: 40, label: "The figure's alt text" }],
]);
/** The caps on the parts of a finding first published as the story of the day, and as any other finding. */
const STORY_PART_MAX: ReadonlyMap<string, number> = new Map<string, number>([
  ["found", 55], ["matters", 50], ["ai_helped", 60], ["how_sure", 60], ["background", 35], ["could_lead", 35],
]);
const ITEM_PART_MAX: ReadonlyMap<string, number> = new Map<string, number>([["background", 40], ["could_lead", 40]]);
/** The parts an item's range counts: its background and could-lead have caps of their own and are not in it. */
const FIRST_FOUR: readonly StringField[] = ["found", "matters", "ai_helped", "how_sure"];

const STORY_TOTAL: Range = { min: 230, max: 280 };
const ITEM_TOTAL: Range = { min: 70, max: 100 };
const DEEP_DIVE: Range = { min: 450, max: 550 };
const BIG_PICTURE: Range = { min: 270, max: 330 };
/** The big picture of a week of fewer than 3 findings has no lower bound. */
const BIG_PICTURE_SHORT: Range = { min: 0, max: 120 };
const LEAD_WORDS = 60;
const LEAD_SENTENCES: Range = { min: 1, max: 3 };
/** Every sentence of model prose has at most this many words (SENTENCE_LENGTH: under 25). */
const SENTENCE_MAX = 24;

const sumWords = (entries: readonly StringEntry[]): number => entries.reduce((n, e) => n + countWords(e.text), 0);
/** True for a budget with a lower bound: a range of words ("230 to 280"), as against a cap. */
const isRange = (range: Range): boolean => range.min !== 0;
const budgetOf = (range: Range): string => (isRange(range) ? `${range.min} to ${range.max}` : `${range.max}`);

interface RangeOptions {
  /** True for a count that has lost its lower bound to removed text. */
  lowerDropped?: boolean;
  hint?: string | null;
  /** "have" for a subject that is plural ("The first four parts"). */
  verb?: "has" | "have";
}

/** The WORDS issue for `subject` having `n` words against `range`: over its top, or under its bottom unless that was dropped. Null when it fits. */
function outOfRange(path: string, subject: string, n: number, range: Range, opts: RangeOptions = {}): ValidationIssue | null {
  const head = `${subject} ${opts.verb ?? "has"} ${plural(n, "word")}`;
  if (n > range.max) {
    return error("WORDS", path, `${head}; the ${isRange(range) ? "budget" : "limit"} is ${budgetOf(range)}. Cut at least ${n - range.max}.`, opts.hint ?? null);
  }
  if (opts.lowerDropped !== true && n < range.min) {
    return error("WORDS", path, `${head}; the budget is ${budgetOf(range)}. Add at least ${range.min - n}.`, opts.hint ?? null);
  }
  return null;
}

const isPart = (e: StringEntry): boolean => e.finding !== null && e.field !== null && (EXPLAINER_FIELDS as readonly string[]).includes(e.field);
const isFirstFour = (e: StringEntry): boolean => e.field !== null && FIRST_FOUR.includes(e.field);

/** The view of the finding whose record holds a string: every string with a `finding` has one, in a draft and in a stored run alike. */
const viewOf = (input: RuleInput, key: string): FindingView => input.views.find(key)!;

function byFinding(entries: readonly StringEntry[]): Map<string, StringEntry[]> {
  const out = new Map<string, StringEntry[]>();
  for (const e of entries) {
    if (e.finding === null) continue;
    out.set(e.finding, [...(out.get(e.finding) ?? []), e]);
  }
  return out;
}

/** The explainer parts of each finding: a cap on each, and the range of the six parts of a story or of the first four of any other finding. */
function explainerIssues(input: RuleInput, out: ValidationIssue[]): void {
  const live = byFinding(explainerStrings(input.inventory));
  const gone = byFinding(removedProse(input.inventory).filter(isPart));
  for (const [key, entries] of live) {
    const view = viewOf(input, key);
    const story = view.depth === "story";
    const caps = story ? STORY_PART_MAX : ITEM_PART_MAX;
    for (const e of entries) {
      const cap = e.field === null ? undefined : caps.get(e.field);
      const found = cap === undefined ? null : outOfRange(e.path, `The ${e.field} part`, countWords(e.text), { min: 0, max: cap });
      if (found !== null) out.push(found);
    }
    const found = outOfRange(
      view.where("explainer"), story ? "The story's six parts" : "The first four parts",
      sumWords(story ? entries : entries.filter(isFirstFour)), story ? STORY_TOTAL : ITEM_TOTAL,
      { verb: "have", lowerDropped: (gone.get(key) ?? []).some((e) => story || isFirstFour(e)) },
    );
    if (found !== null) out.push(found);
  }
}

/**
 * The string a correction's `after` replaces, by the path it names (indices written as `*`), for each path whose string has a
 * budget row of its own (SPEC §4.12 "Word budgets"). The explainer parts have theirs by depth (`correctedBudget()`); the Lead, the
 * deep dive and the big picture are budgeted as a whole, not by string, so a correction at one of them has no row.
 */
const CORRECTED_FIELD: ReadonlyMap<string, StringField> = new Map<string, StringField>([
  ["finding:title", "title"], ["finding:rung_history.*.note", "note"], ["finding:since_then.*.text", "since_then"], ["finding:figure.alt", "alt"],
  ["brief:story.update", "update"], ["brief:items.*.update", "update"], ["brief:ideas.*.text", "idea"], ["brief:also.*.title", "also"],
  ["brief:review.remarkable.note", "remarkable"], ["brief:review.strongest_against.text", "against"], ["brief:corrections.*.reason", "reason"],
  ["term:definition", "definition"],
]);
const INDEX = /^(?:0|[1-9][0-9]*)$/;
const EXPLAINER_PATH = /^explainer\.([a-z_]+)$/;

/**
 * The cap on a correction's `after` and what a message calls the string: the row of the string its path names. Null where that
 * string has no row, and where the part's cap depends on the finding's depth and the run does not know it (a stored finding the
 * draft run was not given).
 */
function correctedBudget(input: RuleInput, c: CorrectionView): { max: number; label: string } | null {
  const generic = c.path.split(".").map((part) => (INDEX.test(part) ? "*" : part)).join(".");
  if (c.finding_id !== null) {
    const part = EXPLAINER_PATH.exec(generic)?.[1];
    if (part !== undefined) {
      const depth = input.views.find(c.finding_id)?.depth;
      const max = depth === "story" ? STORY_PART_MAX.get(part) : depth === "item" ? ITEM_PART_MAX.get(part) : undefined;
      return max === undefined ? null : { max, label: `The ${part} part` };
    }
  }
  const target = c.finding_id !== null ? "finding" : c.edition_date !== null ? "brief" : "term";
  const field = CORRECTED_FIELD.get(`${target}:${generic}`);
  return field === undefined ? null : FIELD_BUDGET.get(field) ?? null;
}

/** A correction's `after` has the budget of the string it replaces, on every correction a run holds; its `before` is text published earlier and has none. */
function correctionIssues(input: RuleInput, out: ValidationIssue[]): void {
  for (const c of input.views.corrections) {
    const budget = correctedBudget(input, c);
    if (budget === null) continue;
    const found = outOfRange(extendPath(c.where, "after", ...(c.draft ? [] : ["en"])), `${budget.label} as corrected`, countWords(c.after.en), { min: 0, max: budget.max }, {
      hint: "A correction's new text has the budget of the string it replaces (SPEC §4.12 Word budgets).",
    });
    if (found !== null) out.push(found);
  }
}

/** The Lead: at most 60 words in all, and 1 to 3 sentences (a full edition's; a removed Lead line lifts the minimum). */
function leadIssues(input: RuleInput, prose: readonly StringEntry[], removed: readonly StringEntry[], out: ValidationIssue[]): void {
  const lead = prose.filter((e) => e.field === "lead");
  const path = input.views.brief.where("lead");
  const words = sumWords(lead);
  if (words > LEAD_WORDS) out.push(error("WORDS", path, `The Lead has ${plural(words, "word")}; the limit is ${LEAD_WORDS}. Cut at least ${words - LEAD_WORDS}.`));
  const sentences = lead.flatMap((e) => splitSentences(e.text)).filter((s) => countWords(s) > 0).length;
  if (sentences > LEAD_SENTENCES.max) {
    out.push(error("WORDS", path, `The Lead has ${plural(sentences, "sentence")}; the limit is ${LEAD_SENTENCES.max}. Join or drop at least ${sentences - LEAD_SENTENCES.max}.`));
  } else if (sentences < LEAD_SENTENCES.min && input.edition !== "data-only" && input.edition !== "none" && !removed.some((e) => e.field === "lead")) {
    out.push(error("WORDS", path, `The Lead has no sentence; write ${LEAD_SENTENCES.min} to ${LEAD_SENTENCES.max}, at most ${LEAD_WORDS} words in all.`));
  }
}

/** The big picture: 270 to 330 words in a full week and at most 120 in a week of fewer than 3 findings; a stored brief may have either. */
function bigPictureIssues(input: RuleInput, prose: readonly StringEntry[], out: ValidationIssue[]): void {
  for (const e of prose.filter((p) => p.field === "big_picture")) {
    const n = countWords(e.text);
    if (isDraft(input)) {
      const short = input.edition === "short-monday";
      const found = outOfRange(e.path, "The big picture", n, short ? BIG_PICTURE_SHORT : BIG_PICTURE, {
        hint: short ? "This is a week of fewer than 3 findings: at most 120 words." : "This is a week of 3 or more findings: 270 to 330 words.",
      });
      if (found !== null) out.push(found);
    } else {
      // A stored brief does not say which week it was: either budget passes.
      const over = n > BIG_PICTURE.max;
      if (over || (n > BIG_PICTURE_SHORT.max && n < BIG_PICTURE.min)) {
        const fix = over
          ? `Cut at least ${n - BIG_PICTURE.max}.`
          : `Cut at least ${n - BIG_PICTURE_SHORT.max} for a short week, or add at least ${BIG_PICTURE.min - n} for a full one.`;
        out.push(error("WORDS", e.path, `The big picture has ${plural(n, "word")}; the budget is ${budgetOf(BIG_PICTURE)}, or at most ${BIG_PICTURE_SHORT.max} in a week of fewer than 3 findings. ${fix}`));
      }
    }
  }
}

/** The page total: `words_max` is a hard limit and `words_target` a soft one, on a draft and on the brief being published. */
function pageTotalIssues(input: RuleInput, out: ValidationIssue[]): void {
  if (!isDraft(input) && !input.views.brief.publishing) return;
  const { words_target: target, words_max: max } = input.config.run.budgets;
  const total = sumWords(pageProseOf(input));
  const path = input.views.brief.where();
  if (total > max) {
    out.push(error("WORDS", path, `The page has ${plural(total, "word")}; the limit is ${max}. Cut at least ${total - max}.`,
      "The page total counts the Lead, the new findings as the page shows them, the updates, ideas, Also noted lines, the deep dive and the review."));
  } else if (total > target) {
    out.push(warning("WORDS", path, `The page has ${plural(total, "word")}; the target is ${target}. Cut ${total - target} to reach it.`,
      "The target is soft: the draft is accepted as it is, but a shorter page is better to read."));
  }
}

/** WORDS: the fixed budgets on every record, and the page total on a draft and on the brief being published. */
function checkWords(input: RuleInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const prose = modelProse(input.inventory);
  for (const e of prose) {
    const budget = e.field === null ? undefined : FIELD_BUDGET.get(e.field);
    const found = budget === undefined ? null : outOfRange(e.path, budget.label, countWords(e.text), { min: 0, max: budget.max });
    if (found !== null) out.push(found);
  }
  explainerIssues(input, out);
  correctionIssues(input, out);
  leadIssues(input, prose, removedProse(input.inventory), out);
  for (const e of prose.filter((p) => p.field === "deep_dive")) {
    const found = outOfRange(e.path, "The deep dive", countWords(e.text), DEEP_DIVE);
    if (found !== null) out.push(found);
  }
  bigPictureIssues(input, prose, out);
  pageTotalIssues(input, out);
  return out;
}

// ── SENTENCE_LENGTH ──────────────────────────────────────────────────────────────────────────────

/** The first words of a sentence of more than 24, for a message (`splitSentences()` trims each sentence). */
function preview(sentence: string): string {
  return `"${sentence.split(/\s+/).slice(0, 8).join(" ")} ..."`;
}

/** SENTENCE_LENGTH: every sentence of model prose has at most 24 words, on every record. */
function checkSentences(input: RuleInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const e of modelProse(input.inventory)) {
    for (const sentence of splitSentences(e.text)) {
      const n = countWords(sentence);
      if (n > SENTENCE_MAX) {
        out.push(error("SENTENCE_LENGTH", e.path, `${e.path} has a sentence of ${plural(n, "word")} (${preview(sentence)}); the limit is ${SENTENCE_MAX}. Split it in two, or cut at least ${n - SENTENCE_MAX}.`,
          "A semicolon or a colon does not end a sentence; a quotation is never split, so a long quote makes a long sentence."));
      }
    }
  }
  return out;
}

// ── NO_EM_DASH ───────────────────────────────────────────────────────────────────────────────────

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const DIGIT = /^\p{Nd}$/u;

/** The em dashes of `text`, its en dashes that do not stand between two digits, and where the first of either is (a code-unit index; null for none). */
function dashesIn(text: string): { em: number; en: number; first: number | null } {
  const chars = Array.from(text);
  let em = 0;
  let en = 0;
  let first: number | null = null;
  let at = 0;
  chars.forEach((c, i) => {
    const bad = c === EM_DASH || (c === EN_DASH && !(DIGIT.test(chars[i - 1] ?? "") && DIGIT.test(chars[i + 1] ?? "")));
    if (bad) {
      if (c === EM_DASH) em += 1;
      else en += 1;
      if (first === null) first = at;
    }
    at += c.length;
  });
  return { em, en, first };
}

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * The text around the code unit `at`, for a message: 20 code units before it and 20 after, every run of white space as one space,
 * and a window that would cut a character outside the Basic Multilingual Plane in two widened by that character's other half
 * (`charCodeAt()` past either end of the text is NaN, which is neither half).
 */
function around(text: string, at: number): string {
  let from = Math.max(0, at - 20);
  let to = at + 21;
  if (isLowSurrogate(text.charCodeAt(from)) && isHighSurrogate(text.charCodeAt(from - 1))) from -= 1;
  if (isHighSurrogate(text.charCodeAt(to - 1)) && isLowSurrogate(text.charCodeAt(to))) to += 1;
  return text.slice(from, to).replace(/\s+/g, " ");
}

const DASH_HINT = "An en dash is allowed only between digits. Quotes, a source's title and the text of a correction at such a path keep their own dashes.";
/** An address cannot be reworded: it holds the dash as its percent code instead. */
const URL_DASH_HINT = "In an address, write an em dash as %E2%80%94 and an en dash as %E2%80%93.";

/** NO_EM_DASH: no U+2014, and no U+2013 but between digits, in every English string but a quote, a source's title and the correction text kept as published. */
function checkDashes(input: RuleInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const e of dashStrings(input.inventory)) {
    const { em, en, first } = dashesIn(e.text);
    if (first === null) continue;
    const found = [
      ...(em > 0 ? [plural(em, "em dash (U+2014)", "em dashes (U+2014)")] : []),
      ...(en > 0 ? [plural(en, "en dash (U+2013) outside a range of digits", "en dashes (U+2013) outside a range of digits")] : []),
    ];
    out.push(error("NO_EM_DASH", e.path, `${e.path} has ${list(found)}, near "${around(e.text, first)}". Rewrite it with a comma, a colon or two sentences; write a range of numbers with "to".`,
      e.kind === "url" ? URL_DASH_HINT : DASH_HINT));
  }
  return out;
}

// ── HYPE_WORDS ───────────────────────────────────────────────────────────────────────────────────

/** The one word of `hype-words.json`'s `en` that a Landmark's text may carry (SPEC §4.11, §4.12 HYPE_WORDS). */
const LANDMARK_WORD = "breakthrough";
/**
 * The strings of a Landmark finding that carry its text: the title, the explainer, the figure's alt text and the rung notes,
 * the stored copy of a returning update, and the brief's lines on it (an update, the deep dive, the remarkable note). A
 * correction's `after` is read by the field its path names, so one at a finding's own paths is a Landmark's text too.
 */
const LANDMARK_FIELDS: ReadonlySet<string> = new Set<string>(["title", ...EXPLAINER_FIELDS, "alt", "note", "update", "since_then", "deep_dive", "remarkable"]);

/** True for the list entry "breakthrough", whatever case the list writes it in. */
const isLandmarkWord = (word: string): boolean => word.toLowerCase() === LANDMARK_WORD;

/** Whether the string is a Landmark's text, where "breakthrough" may stand (never the Lead, the big picture or another brief-level string). */
function inLandmarkText(input: RuleInput, e: StringEntry): boolean {
  const field = e.correction === "after" ? e.pathField : e.field;
  return field !== null && LANDMARK_FIELDS.has(field) && isLandmarkText(input.views, e);
}

/** HYPE_WORDS: no hype word in the strings the spec names, on a draft and on the records being published. */
function checkHype(input: RuleInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const { en } = input.config.hypeWords;
  const names = input.config.index.hypeNames.en;
  for (const e of onlyPublishing(hypeStrings(input.inventory))) {
    // An idea's author is a name, as a reaction's `who` is: it keeps its own words (an idea by the "Breakthrough Institute").
    if (e.field === "idea_who") continue;
    const hits = wordsIn(maskPhrases(e.text, names), en);
    const landmark = hits.some(isLandmarkWord) && inLandmarkText(input, e);
    const banned = hits.filter((w) => !(landmark && isLandmarkWord(w)));
    if (banned.length === 0) continue;
    const only = banned.some(isLandmarkWord) ? ` "${LANDMARK_WORD}" stands only in the text of a Landmark finding, its returning updates and corrections, and the deep dive or remarkable note on one.` : "";
    out.push(error("HYPE_WORDS", e.path, `${e.path} uses ${list(banned.map((w) => `"${w}"`))}, which the brief does not use.${only} Say what happened and let the reader judge.`,
      "A name that holds the word (the Breakthrough Prize), a quote and a source's title keep their own words."));
  }
  return out;
}

// ── TERM_DEFINED ─────────────────────────────────────────────────────────────────────────────────

const globalRes = new Map<string, RegExp>();
/** The pattern of one word list entry with a regular plural, global, so every use in a text is found. */
function globalRe(word: string): RegExp {
  let re = globalRes.get(word);
  if (re === undefined) {
    re = new RegExp(wordRe(word, { plurals: true }).source, "giu");
    globalRes.set(word, re);
  }
  return re;
}

/** The jargon words `text` uses, each once as the text first writes it, the longest word first so that a phrase (isotope dating) hides the word inside it (isotope). */
function jargonUsed(text: string, jargon: readonly string[]): string[] {
  const found: string[] = [];
  let rest = text;
  for (const word of jargon) {
    const re = globalRe(word);
    const first = rest.match(re)?.[0];
    if (first !== undefined) found.push(first);
    rest = rest.replace(re, (m) => " ".repeat(m.length));
  }
  return found;
}

/** True when `name` is `word`, in any case and with a regular plural either way ("manifolds" is the term "manifold"). */
function sameTerm(word: string, name: string): boolean {
  const whole = (re: RegExp, text: string): boolean => {
    const m = re.exec(text.trim());
    return m !== null && m.index === 0 && m[0].length === text.trim().length;
  };
  return whole(wordRe(name, { plurals: true }), word) || whole(wordRe(word, { plurals: true }), name);
}

/** True when `text` uses the term `name`: its words in any case, the last with a regular plural either way ("genomes" is used by "a genome"). */
function usesTerm(text: string, name: string): boolean {
  const term = name.trim();
  // The name (read as a word in y when it ends in "ies", which `wordRe()` matches in the plural) and its singular with each regular ending taken
  // off: "genomes" gives "genom" and "genome", and no text holds the wrong stem.
  const forms = [term.replace(/ies$/i, "y"), term.replace(/(?<=.)es$/i, ""), term.replace(/(?<=.)s$/i, "")];
  return forms.some((form) => wordRe(form, { plurals: true }).test(text));
}

/**
 * TERM_DEFINED: the jargon tests on a draft and on the records being published; each listed term appearing in the explainer, on every record.
 * The terms defined once the draft is published are the glossary's (the stored terms of a published run, and those a draft run was given,
 * `DraftInputs.stored`) and every new term of the whole draft: a listed glossary id is one of them, and a definition may use any of their names.
 * In a draft each new term must also give publish an id it can store: one that the Term schema takes (not empty, at most 60 characters), that
 * no earlier new term of the draft has, and that the glossary does not hold already, unless the glossary entry was first defined on the date
 * of this edition (a rerun of the edition, which replaces its own terms).
 */
function checkTerms(input: RuleInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const glossary = isDraft(input)
    ? (input.draft.stored?.terms.map((t) => t.en.term) ?? [])
    : input.inventory.entries.filter((e) => e.record.type === "term" && e.field === "term" && e.lang === "en").map((e) => e.text);
  const newTerms = isDraft(input) ? newFindings(input.views).flatMap((f) => f.terms!.filter((t) => t.isNew)) : [];
  // Longest word first, whatever the file's order, so that the phrase is found before the word inside it.
  const jargon = input.config.jargon.words.map((w) => w.en).sort((a, b) => b.length - a.length);
  const parts = explainerStrings(input.inventory);
  const gone = byFinding(removedProse(input.inventory).filter(isPart));

  for (const [key, entries] of byFinding(parts)) {
    const terms = viewOf(input, key).terms!;
    // Every listed term appears in the explainer, in one of its parts (a removed part may have held it).
    if (!gone.has(key)) {
      for (const t of terms) {
        if (!entries.some((e) => usesTerm(e.text, t.name))) {
          out.push(error("TERM_DEFINED", t.where, `${t.where} lists the term "${t.name}", but the explainer never uses it. Use it where the reader first meets it, or take it off the list.`));
        }
      }
    }
    // Every jargon word of the explainer is a listed term.
    for (const e of onlyPublishing(entries)) {
      const unlisted = jargonUsed(e.text, jargon).filter((w) => !terms.some((t) => sameTerm(w, t.name)));
      if (unlisted.length > 0) {
        out.push(error("TERM_DEFINED", e.path, `${e.path} uses the technical ${unlisted.length === 1 ? "word" : "words"} ${list(unlisted.map((w) => `"${w}"`))} without defining ${unlisted.length === 1 ? "it" : "them"}. List ${unlisted.length === 1 ? "it" : "each"} in the finding's terms (a new term with a definition, or a glossary id), or use a plainer word.`));
      }
    }
  }

  // Each new term must give publish an id it can store (SPEC §4.3: the English term in kebab case, 1 to 60 characters), one that no earlier new
  // term of the draft has and that the glossary does not hold, which would add a second term of that id. A glossary entry first defined on
  // the date of this edition is the edition's own from an earlier run of it (publish replaces it), so a rerun may define it again; only a
  // run that holds the glossary can tell the others.
  if (isDraft(input)) {
    const held = new Map((input.draft.stored?.terms ?? []).map((t) => [t.id, t]));
    const first = new Map<string, string>();
    for (const f of newFindings(input.views)) {
      for (const t of f.terms!.filter((x) => x.isNew)) {
        const id = termIdOf(t.name);
        if (id === "") {
          out.push(error("TERM_DEFINED", t.where, `${t.where} defines the term "${t.name}", which gives an empty id: a term's id is its English term in kebab case, made from the letters a to z and the digits 0 to 9 in it. Give the term an English name with at least one of them.`));
        } else if (id.length > TERM_ID_MAX) {
          out.push(error("TERM_DEFINED", t.where, `${t.where} defines the term "${t.name}", whose id (its English term in kebab case) has ${id.length} characters; the limit is ${TERM_ID_MAX}. Give the term a shorter English name.`));
        } else if (first.has(id)) {
          out.push(error("TERM_DEFINED", t.where, `${t.where} defines the term "${t.name}", whose id "${id}" is already the id of the new term at ${first.get(id)}. List that term again with its id (new: false), or give this one another English name.`));
        } else {
          first.set(id, t.where);
          if (held.has(id) && held.get(id)!.first_date !== input.date) {
            out.push(error("TERM_DEFINED", t.where, `${t.where} defines the term "${t.name}", whose id "${id}" is already in the glossary. List the existing term (new: false, with its id), or give this one another English name.`));
          }
        }
      }
    }
  }

  // A listed glossary id is a term of the glossary or one that a finding of this draft defines as new. Only a run that holds the
  // glossary can tell (a run given the stored records); the others skip it, and a stored finding's ids are XREF's.
  if (isDraft(input) && input.draft.stored !== null) {
    const ids = new Set([...input.draft.stored.terms.map((t) => t.id), ...newTerms.map((t) => termIdOf(t.name))]);
    for (const f of newFindings(input.views)) {
      for (const t of f.terms!) {
        if (t.id === null || ids.has(t.id)) continue;
        out.push(error("TERM_DEFINED", t.where, `${t.where} lists the glossary id "${t.id}", which is no term of the glossary and which no finding of this draft defines as a new term. Use a new term with a definition, or an id from the glossary.`));
      }
    }
  }

  // A definition uses no undefined jargon word: any term defined once the draft is published, and those listed with its own finding.
  for (const e of onlyPublishing(definitionStrings(input.inventory))) {
    // The finding's own terms first, then the draft's new terms and the glossary last: a word is nearly always one of the first, and the glossary is the long list.
    const defined = [...(e.finding === null ? [] : viewOf(input, e.finding).terms!.map((t) => t.name)), ...newTerms.map((t) => t.name), ...glossary];
    const unlisted = jargonUsed(e.text, jargon).filter((w) => !defined.some((name) => sameTerm(w, name)));
    if (unlisted.length > 0) {
      out.push(error("TERM_DEFINED", e.path, `${e.path} explains a term with the technical ${unlisted.length === 1 ? "word" : "words"} ${list(unlisted.map((w) => `"${w}"`))}, which no listed term defines. Use a plainer word, or list ${unlisted.length === 1 ? "it" : "each"} as a term of this finding too.`));
    }
  }
  return out;
}

// ── READING_LEVEL ────────────────────────────────────────────────────────────────────────────────

/**
 * What joins the strings that READING_LEVEL reads as one text (the explainer's parts, the Lead's lines): a stop of its own, so a
 * part or a line that lacks its final stop still ends its sentence, as WORDS and SENTENCE_LENGTH count it, and never runs into
 * the next one (three short Lead lines without stops are three sentences, not one of 20 words). It holds no letter, so it is no
 * word and no syllable; after a text that ends with a stop it adds nothing.
 */
const SENTENCE_BREAK = " . ";

/** The names of a finding's terms, which READING_LEVEL does not count as hard words in a text about it; none where the run does not hold them (a finding it knows only through the context, or not at all). */
const termNames = (input: RuleInput, key: string): string[] => input.views.find(key)?.terms?.map((t) => t.name) ?? [];

/** READING_LEVEL: the grade of each explainer (its parts in the record's order), the Lead, the deep dive and the big picture, soft above `reading_grade_soft`, hard above `reading_grade_max`. The explainer and the deep dive are graded with their finding's terms; the Lead and the big picture have none. */
function checkReading(input: RuleInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const { reading_grade_soft: soft, reading_grade_max: max } = input.config.run.budgets;
  const judge = (path: string, what: string, text: string, terms: readonly string[] = []): void => {
    const grade = readingGrade(text, { terms });
    if (grade > max) {
      out.push(error("READING_LEVEL", path, `${what} reads at grade ${grade.toFixed(2)}; the limit is ${max}. Use shorter sentences and shorter, more common words.`));
    } else if (grade > soft) {
      out.push(warning("READING_LEVEL", path, `${what} reads at grade ${grade.toFixed(2)}; the target is ${soft}. Use shorter sentences and shorter, more common words.`,
        "The target is soft: the draft is accepted as it is, but an easier read is better."));
    }
  };
  const entries = onlyPublishing(readingStrings(input.inventory));
  for (const [key, group] of byFinding(entries.filter(isPart))) {
    const view = viewOf(input, key);
    judge(view.where("explainer"), "The explainer", group.map((e) => e.text).join(SENTENCE_BREAK), view.terms!.map((t) => t.name));
  }
  judge(input.views.brief.where("lead"), "The Lead", entries.filter((e) => e.field === "lead").map((e) => e.text).join(SENTENCE_BREAK));
  for (const e of entries) {
    if (e.field === "deep_dive") judge(e.path, "The deep dive", e.text, termNames(input, input.views.brief.deep_dive!.finding_id));
    if (e.field === "big_picture") judge(e.path, "The big picture", e.text);
  }
  return out;
}

// ── The group ────────────────────────────────────────────────────────────────────────────────────

export const wordsRules: Rule[] = [
  defineRule({ code: "WORDS", scope: MODES, check: checkWords }),
  defineRule({ code: "SENTENCE_LENGTH", scope: MODES, check: checkSentences }),
  defineRule({ code: "HYPE_WORDS", scope: MODES, check: checkHype }),
  defineRule({ code: "TERM_DEFINED", scope: MODES, check: checkTerms }),
  defineRule({ code: "READING_LEVEL", scope: MODES, check: checkReading }),
  defineRule({ code: "NO_EM_DASH", scope: MODES, check: checkDashes }),
];
