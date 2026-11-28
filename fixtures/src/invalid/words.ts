// F, S and T fixtures for the words rule group (SPEC §4.12 "Fixtures and tests"): WORDS, SENTENCE_LENGTH, HYPE_WORDS, TERM_DEFINED,
// READING_LEVEL and NO_EM_DASH.
//
//   F (`wordsCases`)  one mutation of the weekday draft per hard code, written to fixtures/drafts/invalid--<CODE>.json. Each fails
//                     `validateDraft()` with the weekday's inputs on exactly that code, and no other error and no warning.
//   S (`wordsSoft`)   `soft--READING_LEVEL.json`: a Lead at a grade above 12 and at most 14, which passes with no error and exactly
//                     that one warning. WORDS has no S file: its soft gate is the page total over 1,000 words, and no weekday
//                     draft can reach that (see below).
//   T (`wordsNamed`)  the sub-conditions of each row that one F case cannot show, and the checks only a Sunday or a Monday draft
//                     reaches (SPEC §4.12 "Fixtures and tests": WORDS on the big picture at 100 words in the full week and 121 in the
//                     empty one). Each states the exact set of error and warning codes, so it also shows that no other rule reads
//                     the same fault.
//
// Why WORDS has no soft file. Every string has its own budget (the word budgets table), and the page total counts the model prose
// the brief's page shows. The most a weekday page can hold is the Lead (60 words), a story with its title (292), four more findings'
// titles and first four parts (4 x 112 = 448, when all four are new), two ideas (80) and five Also noted lines (100): 980 words,
// under the 1,000 target. So a weekday draft within its budgets is never over the target, and a draft over a budget fails WORDS as
// an error. A Sunday with a Major story, a second finding and a 550-word deep dive can pass 1,000, but the Sunday inputs hold no
// second source for it, so the soft page total is tested with a lowered `words_target` (tests/fixtures-words.test.ts) and the
// spec says so (§0.4). The same sum makes the hard page total a check that only a draft over a budget can reach: its T case below
// is a deep dive of 1,200 words, which also fails the deep dive's own budget, and the test file reads the two issues apart.
//
// A published-mode case (a stored brief, a removed string, the records being published or not) works on a copy of the sample
// content and is not here (SPEC §4.12 "Stored records", "Removed text").
//
// Every string a case adds is invented and marked SAMPLE, or is padding that says so (`padding()`, `longSentence()`). The dashes
// the NO_EM_DASH cases need are written with String.fromCharCode(), so this file holds none, and the files of the F cases hold
// them as \u escapes (`dashEscaped()`, fixtures/src/build.ts).

import type { DraftBrief, DraftCorrection, DraftFinding } from "../../../lib/schema/draft";
import { countWords, splitSentences } from "../../../lib/text";
import type { InvalidCase, NamedCase, SoftCase } from "../build";
import { MONDAY_ITEMS, newFindingOf, SUNDAY_ITEMS, WEEKDAY_ITEMS } from "../drafts";
import type { EditionName } from "../world";

const I = WEEKDAY_ITEMS;
const M = MONDAY_ITEMS;
const S = SUNDAY_ITEMS;

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

/** The set of codes a case must give: one error code, and no other error and no warning. */
const only = (code: string) => ({ errors: [code], warnings: [] as string[] });
/** The set of codes of a soft case: no error, and one warning. */
const softOnly = (code: string) => ({ errors: [] as string[], warnings: [code] });

/** A named case whose `name` starts with its code, as every T case's does. */
const T = (code: string, what: string, edition: EditionName, mutate: NamedCase["mutate"], expect: NamedCase["expect"] = only(code)): NamedCase => ({
  name: `${code}: ${what}`, code, edition, mutate, expect,
});

const scroll = (d: DraftBrief): DraftFinding => newFindingOf(d, I.story);
const protein = (d: DraftBrief): DraftFinding => newFindingOf(d, I.result);
const retraction = (d: DraftBrief): DraftFinding => newFindingOf(d, I.setback);
const proof = (d: DraftBrief): DraftFinding => newFindingOf(d, I.claimed);
const plasma = (d: DraftBrief): DraftFinding => newFindingOf(d, M.item);
const translation = (d: DraftBrief): DraftFinding => newFindingOf(d, S.item);

/** The element of a list, or a thrown error: a case never mutates the wrong part of a changed draft. */
export function at<T>(list: T[], index: number, what: string): T {
  const found = list[index];
  if (found === undefined) throw new Error(`The draft has no ${what}`);
  return found;
}

const lead = (d: DraftBrief, i: number) => at(d.lead, i, `Lead line ${i}`);
const idea = (d: DraftBrief, i: number) => at(d.ideas, i, `idea ${i}`);
const also = (d: DraftBrief, i: number) => at(d.also, i, `Also noted line ${i}`);
const correction = (d: DraftBrief, i: number) => at(d.corrections, i, `correction ${i}`);
const decision = (d: DraftBrief, i: number) => at(d.report_decisions, i, `report decision ${i}`);
const returning = (d: DraftBrief) => at(d.returning, 0, "returning entry");
const rungChange = (d: DraftBrief) => at(d.rung_changes, 0, "rung change");

/** What a draft correction names: a stored finding, an edition's brief or a glossary term (one of them). */
type CorrectionTarget = Partial<Pick<DraftCorrection, "finding_id" | "edition_date" | "term_id">>;

/** Adds a clarification (it answers no report) of the string at `path` of `target`, with `after` as its new text, after the draft's own corrections. */
export function addCorrection(d: DraftBrief, target: CorrectionTarget, path: string, after: string): void {
  d.corrections.push({
    finding_id: null, edition_date: null, term_id: null, type: "clarification", path, after,
    reason: "SAMPLE: the wording was unclear.", source_url: null, report_id: null, ...target,
  });
}
/** What the added corrections name: the stored finding that the draft's first correction names, an edition before the draft's, and a glossary term. */
export const correctedFinding = (d: DraftBrief): CorrectionTarget => ({ finding_id: correction(d, 0).finding_id });
export const CORRECTED_EDITION: CorrectionTarget = { edition_date: "2026-10-13" };
export const CORRECTED_TERM: CorrectionTarget = { term_id: "sample-term" };

function deepDive(d: DraftBrief): NonNullable<DraftBrief["deep_dive"]> {
  if (d.deep_dive === null) throw new Error("The draft has no deep dive");
  return d.deep_dive;
}

function review(d: DraftBrief): NonNullable<DraftBrief["review"]> {
  if (d.review === null) throw new Error("The draft has no week review");
  return d.review;
}

function remarkable(d: DraftBrief): NonNullable<NonNullable<DraftBrief["review"]>["remarkable"]> {
  const r = review(d).remarkable;
  if (r === null) throw new Error("The week review has no remarkable note");
  return r;
}

function figure(f: DraftFinding): NonNullable<DraftFinding["figure"]> {
  if (f.figure === null) throw new Error(`${f.ref} has no figure`);
  return f.figure;
}

/** A finding's new term: its `index`th term, which must be a new one (with a definition of its own). */
function newTerm(f: DraftFinding, index: number): { new: true; term: string; definition: string } {
  const t = at(f.terms, index, `term ${index} of ${f.ref}`);
  if (!t.new) throw new Error(`${f.ref} term ${index} is an existing glossary term`);
  return t;
}

/** `text` with the first `from` replaced by `to`, or a thrown error when the text does not hold it: a case never edits the wrong words. */
export function swap(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to);
  if (out === text) throw new Error(`The text has no ${String(from)}: ${text.slice(0, 60)}`);
  return out;
}

// ── Word counts ──────────────────────────────────────────────────────────────────────────────────

const FILL = ["SAMPLE", "padding", "fills", "the", "rest", "of", "this", "text"] as const;

/** `n` words of padding as whole sentences of eight words and one shorter, so no sentence of it is long. */
export function padding(n: number): string {
  const sentences: string[] = [];
  for (let left = n; left > 0; left -= FILL.length) sentences.push(`${FILL.slice(0, Math.min(left, FILL.length)).join(" ")}.`);
  return sentences.join(" ");
}

/** The text with whole sentences cut from its end while it is over `n` words, then padded to exactly `n` words. */
export function resize(text: string, n: number): string {
  const kept = splitSentences(text);
  while (kept.length > 0 && countWords(kept.join(" ")) > n) kept.pop();
  const have = countWords(kept.join(" "));
  const out = [...kept, ...(n > have ? [padding(n - have)] : [])].join(" ");
  if (countWords(out) !== n) throw new Error(`resize() made ${countWords(out)} words, not ${n}`);
  return out;
}

/** The sentence with `n` padding words added inside it, before its full stop, so one sentence stays one sentence. */
export function grow(sentence: string, n: number): string {
  const extra = Array.from({ length: n }, (_, i) => FILL[i % FILL.length]).join(" ");
  return `${sentence.replace(/\.$/, "")} ${extra}.`;
}

const CYCLE = ["this", "sentence", "is", "long", "on", "purpose"] as const;

/** One sentence of exactly `n` words, in short common words (a low reading grade): the first is SAMPLE, so it says what it is. */
export function longSentence(n: number): string {
  const text = `SAMPLE: ${Array.from({ length: n - 1 }, (_, i) => CYCLE[i % CYCLE.length]).join(" ")}.`;
  if (countWords(text) !== n) throw new Error(`longSentence() made ${countWords(text)} words, not ${n}`);
  return text;
}

/** The text with its last sentence replaced by a sentence of exactly `n` words. */
export function endWith(text: string, n: number): string {
  const sentences = splitSentences(text);
  sentences.pop();
  return [...sentences, longSentence(n)].join(" ");
}

// ── Texts at a reading grade ─────────────────────────────────────────────────────────────────────

/** The Lead's three sentences in long, Latin-rooted words: grade 17.7 as a whole and above 15 in each line (51 words). */
const LEAD_HARD = [
  "Scholars deciphered the writing inside an ancient scroll that nobody has ever unrolled, using computational reconstruction.",
  "A laboratory measured a protein structure that an artificial intelligence model had predicted earlier, and the measurement matched.",
  "A publisher withdrew numerous publications containing undisclosed generated material, and a research council finalised its disclosure requirement.",
] as const;

/** The same three sentences at grade 13.0 as a whole and 12.5 to 13.6 in each line (51 words): above the soft limit, under the hard one. */
const LEAD_SOFT = [
  "Scholars read the writing inside an ancient scroll that nobody has ever unrolled, using a computational method.",
  "A laboratory measured a protein that an artificial intelligence model had predicted, and the shape matched.",
  "A publisher withdrew many papers with undisclosed generated text, and a research council made its disclosure rule final.",
] as const;

/** A long text made of `lines` repeated `times`, so its reading grade is the lines' own and its length is `times` x the lines'. */
const repeated = (lines: readonly string[], times: number): string => Array.from({ length: times }, () => lines.join(" ")).join(" ");

/** The retraction finding's explainer (its first five parts; `how_sure` stays, since WHO_SAYS needs it) in heavy words: grade 16.5 (six parts), 15.5 (four). */
const EXPLAINER_HARD = {
  found: "Example Press formally retracted numerous publications across nine journals because undisclosed generated material had produced their illustrations.",
  matters: "Researchers throughout the discipline may already have cited these publications, so the consequences could propagate considerably beyond the affected journals.",
  ai_helped: "Unidentified software produced the text and illustrations, and the publisher's notices deliberately decline to identify the particular tool involved.",
  background: "A retraction notice informs readers that a publication should no longer be considered reliable evidence.",
  could_lead: "Publishers could systematically examine submissions for undisclosed generated material before accepting publication.",
} as const;

/** The same facts at grade 13.5 over the six parts and 12.7 over the first four: above the soft limit either way, under the hard one. */
const EXPLAINER_SOFT = {
  found: "Example Press retracted numerous publications in nine journals because undisclosed generated text and illustrations had been used in them.",
  matters: "Other researchers may already have cited these publications, so the consequences could propagate beyond the affected journals.",
  ai_helped: "An unidentified software tool produced the text and illustrations, and the publisher's notices decline to identify the particular tool involved.",
  background: "A retraction notice informs readers that a publication should no longer be considered reliable evidence.",
  could_lead: "Publishers could examine submissions for undisclosed generated material before they accept them.",
} as const;

function explainerAs(f: DraftFinding, parts: typeof EXPLAINER_HARD | typeof EXPLAINER_SOFT): void {
  Object.assign(f.explainer, parts);
}

// ── SENTENCE_LENGTH: each kind of model prose the rule reads ─────────────────────────────────────

/** A kind of model prose that SENTENCE_LENGTH reads, and how to make one of its strings one sentence of `n` words. */
export interface SentenceSurface {
  readonly what: string;
  readonly edition: EditionName;
  readonly set: (draft: DraftBrief, n: number) => void;
}

/** Each surface has a T case at 25 words and, in tests/fixtures-words.test.ts, a passing neighbour at 24. */
export const SENTENCE_SURFACES: readonly SentenceSurface[] = [
  { what: "a Lead sentence", edition: "weekday", set: (d, n) => { lead(d, 1).text = longSentence(n); } },
  { what: "an idea line", edition: "weekday", set: (d, n) => { idea(d, 0).text = longSentence(n); } },
  { what: "a returning update", edition: "weekday", set: (d, n) => { returning(d).update = longSentence(n); } },
  { what: "a story's `background`", edition: "weekday", set: (d, n) => { scroll(d).explainer.background = longSentence(n); } },
  { what: "a term's definition", edition: "weekday", set: (d, n) => { newTerm(proof(d), 0).definition = longSentence(n); } },
  { what: "a rung note", edition: "weekday", set: (d, n) => { rungChange(d).rung.note = longSentence(n); } },
  { what: "a correction's reason", edition: "weekday", set: (d, n) => { correction(d, 0).reason = longSentence(n); } },
  { what: "a report decision's reason", edition: "weekday", set: (d, n) => { decision(d, 0).reason = longSentence(n); } },
  { what: "a figure's alt text", edition: "weekday", set: (d, n) => { figure(scroll(d)).alt = longSentence(n); } },
  { what: "the last sentence of the Sunday deep dive", edition: "sunday", set: (d, n) => { deepDive(d).text = endWith(deepDive(d).text, n); } },
  { what: "the last sentence of the Monday big picture", edition: "monday", set: (d, n) => { review(d).big_picture = endWith(review(d).big_picture, n); } },
  { what: "a remarkable note", edition: "monday", set: (d, n) => { remarkable(d).note = longSentence(n); } },
  { what: "a strongest-evidence-against text", edition: "monday", set: (d, n) => { review(d).strongest_against.text = longSentence(n); } },
];

// ── F: one mutation of the weekday draft per code ────────────────────────────────────────────────

export const wordsCases: readonly InvalidCase[] = [
  {
    // The protein finding's title has 13 words: the limit is 12.
    code: "WORDS", file: "invalid--WORDS.json",
    mutate: (d) => {
      protein(d).title = "SAMPLE: A lab measures a protein that an AI had predicted weeks earlier";
    },
  },
  {
    // One sentence of the proof finding's `found` has 25 words: the limit is 24 (the first sentence, with "and posted the argument online").
    code: "SENTENCE_LENGTH", file: "invalid--SENTENCE_LENGTH.json",
    mutate: (d) => {
      proof(d).explainer.found = "Marlow Labs says its AI system found a proof of an open problem about sums of sets of whole numbers and posted the argument online.";
    },
  },
  {
    // "Breakthrough" in the Lead: the story is a Landmark, but the word stands only in a Landmark finding's own text, never in the Lead.
    code: "HYPE_WORDS", file: "invalid--HYPE_WORDS.json",
    mutate: (d) => {
      lead(d, 0).text = "A breakthrough lets scholars read the writing inside a sealed ancient scroll without opening it.";
    },
  },
  {
    // "Transformer" is on the jargon list for every field, and the finding does not list it as a term.
    code: "TERM_DEFINED", file: "invalid--TERM_DEFINED.json",
    mutate: (d) => {
      protein(d).explainer.ai_helped =
        "Halden Research built the model, Halden Fold, which is a transformer. It posted its prediction before anyone had measured the complex.";
    },
  },
  {
    // A Lead of long, Latin-rooted words: its reading grade is far above 14, the hard limit. The facts, the refs and the sentence count are the valid Lead's.
    code: "READING_LEVEL", file: "invalid--READING_LEVEL.json",
    mutate: (d) => {
      LEAD_HARD.forEach((text, i) => {
        lead(d, i).text = text;
      });
    },
  },
  {
    // An em dash where a comma stood, in the retraction finding's `matters`.
    code: "NO_EM_DASH", file: "invalid--NO_EM_DASH.json",
    mutate: (d) => {
      retraction(d).explainer.matters = `Other researchers may have cited these papers ${EM} so the harm can spread beyond the journals.`;
    },
  },
];

// ── S: soft gates ────────────────────────────────────────────────────────────────────────────────

export const wordsSoft: readonly SoftCase[] = [
  {
    // A Lead at grade 13: above the soft limit (12) and at most the hard one (14), in each line and as a whole.
    code: "READING_LEVEL", file: "soft--READING_LEVEL.json",
    mutate: (d) => {
      LEAD_SOFT.forEach((text, i) => {
        lead(d, i).text = text;
      });
    },
  },
];

// ── T: named cases ───────────────────────────────────────────────────────────────────────────────

/** The plain hype words of `config/hype-words.json` (every `en` entry but "breakthrough", which has its own cases), with a sentence that holds each. */
const HYPE_SENTENCES: readonly (readonly [string, string])[] = [
  ["revolutionary", "The result is revolutionary."],
  ["game-changing", "The result is game-changing."],
  ["groundbreaking", "The result is groundbreaking."],
  ["paradigm shift", "The result is a paradigm shift."],
  ["unprecedented", "The result is unprecedented."],
  ["stunning", "The result is stunning."],
  ["mind-blowing", "The result is mind-blowing."],
  ["changes everything", "The result changes everything."],
];

export const wordsNamed: readonly NamedCase[] = [
  // ── WORDS: the Lead ──
  T("WORDS", "a Lead of 61 words in three sentences (the limit is 60)", "weekday", (d) => {
    lead(d, 0).text = grow(lead(d, 0).text, 12);
    lead(d, 1).text = grow(lead(d, 1).text, 4);
  }),
  T("WORDS", "a Lead of four sentences, 50 words in all (the limit is 1 to 3 sentences)", "weekday", (d) => {
    d.lead.push({ text: "SAMPLE: a fourth lead sentence.", refs: [I.claimed] });
  }),
  T("WORDS", "a Lead of no sentence (the limit is 1 to 3 sentences)", "weekday", (d) => {
    d.lead = [];
  }),

  // ── WORDS: the story's six parts, each one word over its own cap, and the total at 229 and 281 ──
  T("WORDS", "the story's `found` at 56 words (the cap is 55)", "weekday", (d) => {
    scroll(d).explainer.found = resize(scroll(d).explainer.found, 56);
  }),
  T("WORDS", "the story's `matters` at 51 words (the cap is 50)", "weekday", (d) => {
    scroll(d).explainer.matters = resize(scroll(d).explainer.matters, 51);
  }),
  T("WORDS", "the story's `ai_helped` at 61 words (the cap is 60)", "weekday", (d) => {
    scroll(d).explainer.ai_helped = resize(scroll(d).explainer.ai_helped ?? "", 61);
  }),
  T("WORDS", "the story's `how_sure` at 61 words (the cap is 60)", "weekday", (d) => {
    scroll(d).explainer.how_sure = resize(scroll(d).explainer.how_sure, 61);
  }),
  T("WORDS", "the story's `background` at 36 words (the cap is 35)", "weekday", (d) => {
    scroll(d).explainer.background = resize(scroll(d).explainer.background, 36);
  }),
  T("WORDS", "the story's `could_lead` at 36 words (the cap is 35)", "weekday", (d) => {
    scroll(d).explainer.could_lead = resize(scroll(d).explainer.could_lead, 36);
  }),
  T("WORDS", "the story's six parts at 281 words together, each within its own cap (the limit is 280)", "weekday", (d) => {
    const e = scroll(d).explainer;
    e.found = resize(e.found, 55);
    e.matters = resize(e.matters, 50);
    e.ai_helped = resize(e.ai_helped ?? "", 60);
    e.how_sure = resize(e.how_sure, 59);
  }),
  T("WORDS", "the story's six parts at 229 words together (the lower bound is 230)", "weekday", (d) => {
    scroll(d).explainer.could_lead = resize(scroll(d).explainer.could_lead, 22);
  }),

  // ── WORDS: another finding's first four parts, 69 and 101 words, and its two last parts at 41 ──
  T("WORDS", "an item's first four parts at 101 words together (the limit is 100)", "weekday", (d) => {
    protein(d).explainer.found = resize(protein(d).explainer.found, 46);
  }),
  T("WORDS", "an item's first four parts at 69 words together (the lower bound is 70)", "weekday", (d) => {
    retraction(d).explainer.found = resize(retraction(d).explainer.found, 19);
  }),
  T("WORDS", "an item's `background` at 41 words (the cap is 40)", "weekday", (d) => {
    protein(d).explainer.background = resize(protein(d).explainer.background, 41);
  }),
  T("WORDS", "an item's `could_lead` at 41 words (the cap is 40)", "weekday", (d) => {
    protein(d).explainer.could_lead = resize(protein(d).explainer.could_lead, 41);
  }),

  // ── WORDS: the short strings, one word over ──
  T("WORDS", "a returning update of 61 words (the limit is 60)", "weekday", (d) => {
    returning(d).update = resize(returning(d).update, 61);
  }),
  T("WORDS", "an agent's rung change with a note of 26 words (the limit is 25)", "weekday", (d) => {
    rungChange(d).rung.note = resize(rungChange(d).rung.note ?? "", 26);
  }),
  T("WORDS", "a new finding's rung note of 26 words (the limit is 25)", "weekday", (d) => {
    const entry = at(protein(d).rung_history, 1, "second rung entry of the protein finding");
    entry.note = resize(entry.note ?? "", 26);
  }),
  T("WORDS", "an idea line of 41 words (the limit is 40)", "weekday", (d) => {
    idea(d, 0).text = resize(idea(d, 0).text, 41);
  }),
  T("WORDS", "an Also noted title of 21 words (the limit is 20)", "weekday", (d) => {
    also(d, 0).title = resize(also(d, 0).title, 21);
  }),
  T("WORDS", "a figure's alt text of 41 words (the limit is 40)", "weekday", (d) => {
    figure(scroll(d)).alt = resize(figure(scroll(d)).alt, 41);
  }),
  T("WORDS", "a new term's definition of 41 words (the limit is 40)", "weekday", (d) => {
    const term = newTerm(proof(d), 0);
    term.definition = resize(term.definition, 41);
  }),
  T("WORDS", "a correction's reason of 41 words (the limit is 40)", "weekday", (d) => {
    correction(d, 1).reason = resize(correction(d, 1).reason, 41);
  }),
  T("WORDS", "a report decision's reason of 41 words (the limit is 40)", "weekday", (d) => {
    decision(d, 0).reason = resize(decision(d, 0).reason, 41);
  }),

  // ── WORDS: a correction's `after` has the budget of the string it replaces (the cases a run needs the stored records for are tests) ──
  T("WORDS", "a correction's after at a finding's title of 13 words (the limit is 12)", "weekday", (d) => {
    addCorrection(d, correctedFinding(d), "title", padding(13));
  }),
  T("WORDS", "a correction's after at a finding's rung note of 26 words (the limit is 25)", "weekday", (d) => {
    addCorrection(d, correctedFinding(d), "rung_history.1.note", padding(26));
  }),
  T("WORDS", "a correction's after at an idea line of the brief, of 41 words (the limit is 40)", "weekday", (d) => {
    addCorrection(d, CORRECTED_EDITION, "ideas.0.text", padding(41));
  }),
  T("WORDS", "a correction's after at a glossary term's definition of 41 words (the limit is 40)", "weekday", (d) => {
    addCorrection(d, CORRECTED_TERM, "definition", padding(41));
  }),
  T("WORDS", "a correction's after at the reason a brief lists for a correction, of 41 words (the limit is 40)", "weekday", (d) => {
    addCorrection(d, CORRECTED_EDITION, "corrections.0.reason", padding(41));
  }),

  // ── WORDS: the Sunday deep dive, 449 and 551 words (the budget is 450 to 550), and a page over 1,300 ──
  T("WORDS", "a Sunday deep dive of 449 words (the lower bound is 450)", "sunday", (d) => {
    deepDive(d).text = resize(deepDive(d).text, 449);
  }),
  T("WORDS", "a Sunday deep dive of 551 words (the limit is 550)", "sunday", (d) => {
    deepDive(d).text = resize(deepDive(d).text, 551);
  }),
  T("WORDS", "a Sunday page over 1,300 words: a deep dive of 1,200 words (it also fails the deep dive's own budget)", "sunday", (d) => {
    deepDive(d).text = resize(deepDive(d).text, 1200);
  }),

  // ── WORDS: the Monday review ──
  T("WORDS", "a big picture of 100 words in the full week (the budget is 270 to 330)", "monday", (d) => {
    review(d).big_picture = resize(review(d).big_picture, 100);
  }),
  T("WORDS", "a big picture of 269 words in the full week (the lower bound is 270)", "monday", (d) => {
    review(d).big_picture = resize(review(d).big_picture, 269);
  }),
  T("WORDS", "a big picture of 331 words in the full week (the limit is 330)", "monday", (d) => {
    review(d).big_picture = resize(review(d).big_picture, 331);
  }),
  T("WORDS", "a big picture of 121 words in the empty week (the limit there is 120)", "monday-short", (d) => {
    review(d).big_picture = resize(review(d).big_picture, 121);
  }),
  T("WORDS", "a full-length big picture of 300 words in the empty week (the limit there is 120)", "monday-short", (d) => {
    review(d).big_picture = resize(review(d).big_picture, 300);
  }),
  T("WORDS", "a remarkable note of 31 words (the limit is 30)", "monday", (d) => {
    remarkable(d).note = resize(remarkable(d).note, 31);
  }),
  T("WORDS", "a strongest-evidence-against text of 51 words (the limit is 50)", "monday", (d) => {
    review(d).strongest_against.text = resize(review(d).strongest_against.text, 51);
  }),

  // ── SENTENCE_LENGTH: a sentence of 25 words in each kind of model prose ──
  ...SENTENCE_SURFACES.map((s) => T("SENTENCE_LENGTH", `${s.what} of 25 words`, s.edition, (d) => s.set(d, 25))),
  T("SENTENCE_LENGTH", "the second sentence of an idea line has 25 words, the first has 5", "weekday", (d) => {
    idea(d, 1).text = `SAMPLE: a short opening sentence. ${longSentence(25)}`;
  }),

  // ── HYPE_WORDS: each plain hype word, in a Notable finding's `found` ──
  ...HYPE_SENTENCES.map(([word, sentence]) =>
    T("HYPE_WORDS", `"${word}" in a Notable finding's found`, "weekday", (d) => {
      proof(d).explainer.found = `${proof(d).explainer.found} ${sentence}`;
    }),
  ),
  T("HYPE_WORDS", "a hype word in capitals", "weekday", (d) => {
    proof(d).explainer.found = `${proof(d).explainer.found} The result is REVOLUTIONARY.`;
  }),
  T("HYPE_WORDS", "a hype word at the start of a sentence", "weekday", (d) => {
    proof(d).explainer.matters = `${proof(d).explainer.matters} Unprecedented results like this are rare.`;
  }),
  T("HYPE_WORDS", "a hype word in a Notable finding's title", "weekday", (d) => {
    proof(d).title = "SAMPLE: An AI lab claims a stunning proof of an open problem";
  }),

  // ── HYPE_WORDS: "breakthrough" outside a Landmark finding's own text ──
  T("HYPE_WORDS", "\"a breakthrough\" in a Major finding's how_sure", "weekday", (d) => {
    protein(d).explainer.how_sure = `${protein(d).explainer.how_sure} Experts call the result a breakthrough.`;
  }),
  T("HYPE_WORDS", "\"the breakthrough of the year\" in a Notable finding's found (the name \"Breakthrough of the Year\" is masked, this is not it)", "weekday", (d) => {
    proof(d).explainer.found = `${proof(d).explainer.found} Some call it the breakthrough of the year.`;
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in a Notable finding's title", "weekday", (d) => {
    proof(d).title = "SAMPLE: An AI lab claims a breakthrough proof of an open problem";
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in a Notable finding's rung note", "weekday", (d) => {
    at(proof(d).rung_history, 0, "rung entry of the proof finding").note = "The lab calls its claim a breakthrough.";
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in a new term's definition on a Notable finding", "weekday", (d) => {
    newTerm(proof(d), 0).definition = `${newTerm(proof(d), 0).definition} It is a breakthrough tool.`;
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in a returning update on a Notable finding", "weekday", (d) => {
    returning(d).update = `${returning(d).update} Some call the final rule a breakthrough.`;
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in an idea line", "weekday", (d) => {
    idea(d, 0).text = `${idea(d, 0).text} The author calls this a breakthrough.`;
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in an Also noted title", "weekday", (d) => {
    also(d, 0).title = "SAMPLE: A breakthrough model predicts monsoon rainfall weeks ahead";
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in a correction's after on a Major finding's how_sure", "weekday", (d) => {
    const c = correction(d, 1);
    c.after = swap(c.after, "The tests used past weather only, so live forecasts may differ.", "The model is a breakthrough in forecasting.");
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in a correction's reason, even on a Landmark finding (its reason is not one of the finding's own paths)", "weekday", (d) => {
    correction(d, 0).reason = `${correction(d, 0).reason} It is a breakthrough.`;
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in a report decision's reason", "weekday", (d) => {
    decision(d, 0).reason = `${decision(d, 0).reason} It is a breakthrough.`;
  }),
  T("HYPE_WORDS", "a masked name does not shield a second use: \"the Breakthrough Prize committee called it a breakthrough\"", "weekday", (d) => {
    protein(d).explainer.how_sure = `${protein(d).explainer.how_sure} The Breakthrough Prize committee called it a breakthrough.`;
  }),
  T("HYPE_WORDS", "a name is masked as listed, case included: \"the breakthrough prize committee\"", "weekday", (d) => {
    protein(d).explainer.how_sure = `${protein(d).explainer.how_sure} The breakthrough prize committee has not weighed in.`;
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in the deep dive on a Major finding", "sunday", (d) => {
    deepDive(d).text = `${deepDive(d).text} It is a breakthrough.`;
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in a Sunday item's explainer (a Notable finding)", "sunday", (d) => {
    translation(d).explainer.matters = `${translation(d).explainer.matters} It could be a breakthrough.`;
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in the big picture", "monday", (d) => {
    review(d).big_picture = `${review(d).big_picture} It is a breakthrough.`;
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in the remarkable note on a Major finding", "monday", (d) => {
    remarkable(d).note = "The AI antibiotic is a breakthrough: an AI model proposed it, and it cleared a drug-resistant infection in mice.";
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in the strongest-evidence-against text", "monday", (d) => {
    review(d).strongest_against.text = `${review(d).strongest_against.text} It is a breakthrough.`;
  }),
  T("HYPE_WORDS", "\"a breakthrough\" in a Monday item's explainer (a Notable finding)", "monday", (d) => {
    plasma(d).explainer.could_lead = `${plasma(d).explainer.could_lead} It could be a breakthrough.`;
  }),

  // ── TERM_DEFINED: (a) a jargon word the finding does not list, (b) a listed term the explainer lacks, (c) a definition that uses jargon ──
  T("TERM_DEFINED", "(a) \"conjecture\" in a mathematics finding's background, not listed", "weekday", (d) => {
    proof(d).explainer.background = `${proof(d).explainer.background} The result settles a conjecture.`;
  }),
  T("TERM_DEFINED", "(a) \"protein folding\" in a biology finding's matters, not listed", "weekday", (d) => {
    protein(d).explainer.matters = `${protein(d).explainer.matters} Protein folding is hard to predict.`;
  }),
  T("TERM_DEFINED", "(a) \"diffusion model\", a word of every field, in a chemistry finding's could_lead", "weekday", (d) => {
    retraction(d).explainer.could_lead = "Publishers could check for undisclosed AI text with a diffusion model before they accept a paper.";
  }),
  T("TERM_DEFINED", "(a) a jargon word with a capital letter, at the start of a sentence", "weekday", (d) => {
    retraction(d).explainer.matters = `${retraction(d).explainer.matters} Transformer tools may be to blame.`;
  }),
  T("TERM_DEFINED", "(a) \"codex\" in the story's could_lead, not listed", "weekday", (d) => {
    scroll(d).explainer.could_lead = `${scroll(d).explainer.could_lead} Scholars may also study the codex.`;
  }),
  T("TERM_DEFINED", "(a) \"transformer\" in a Sunday item's matters", "sunday", (d) => {
    translation(d).explainer.matters = `${translation(d).explainer.matters} The Quill Translator is a transformer.`;
  }),
  T("TERM_DEFINED", "(a) \"neutrino\" in a Monday physics item's background, not listed (it lists only plasma)", "monday", (d) => {
    plasma(d).explainer.background = `${plasma(d).explainer.background} Some machines also study the neutrino.`;
  }),
  T("TERM_DEFINED", "(b) the listed term \"proof assistant\" is not in the explainer", "weekday", (d) => {
    proof(d).explainer.background = swap(proof(d).explainer.background, "a proof assistant", "a program");
  }),
  T("TERM_DEFINED", "(b) the listed term \"cryo-electron microscopy\" is not in the explainer", "weekday", (d) => {
    protein(d).explainer.background = swap(protein(d).explainer.background, "cryo-electron microscopy", "a frozen-sample imaging method");
  }),
  T("TERM_DEFINED", "(b) the story's listed term \"papyrus\" is nowhere in its explainer", "weekday", (d) => {
    const e = scroll(d).explainer;
    for (const part of ["found", "matters", "ai_helped", "how_sure", "background", "could_lead"] as const) {
      const text = e[part];
      if (text !== null) e[part] = text.replace(/papyrus/gi, "reed");
    }
  }),
  T("TERM_DEFINED", "(c) \"lemma\" in the definition of \"proof assistant\"", "weekday", (d) => {
    newTerm(proof(d), 0).definition = `${newTerm(proof(d), 0).definition} It checks each lemma.`;
  }),
  T("TERM_DEFINED", "(c) \"transformer\" in the definition of \"cryo-electron microscopy\"", "weekday", (d) => {
    newTerm(protein(d), 0).definition = "A way to see the shape of a molecule by imaging it frozen in ice, using a transformer to sharpen the images.";
  }),
  T("TERM_DEFINED", "(d) a new term whose English term has no letter a to z or digit, so its id is empty", "weekday", (d) => {
    protein(d).terms.push({ new: true, term: "\u5149", definition: "SAMPLE: the made-up word for a ray of light." });
    protein(d).explainer.matters = `${protein(d).explainer.matters} The \u5149 is a ray.`;
  }),
  T("TERM_DEFINED", "(d) two new terms of one draft, in two findings, that give one id", "weekday", (d) => {
    protein(d).terms.push({ new: true, term: "Papyrus", definition: "SAMPLE: a sheet of pressed reed." });
    protein(d).explainer.matters = `${protein(d).explainer.matters} A papyrus is a sheet.`;
  }),

  // ── READING_LEVEL: each text it reads, above the hard limit (14) and between the soft and the hard limit (12 and 14) ──
  T("READING_LEVEL", "a finding's explainer in heavy words, grade 16.5", "weekday", (d) => {
    explainerAs(retraction(d), EXPLAINER_HARD);
  }),
  T("READING_LEVEL", "a finding's explainer at grade 13.5 (six parts) and 12.7 (four)", "weekday", (d) => {
    explainerAs(retraction(d), EXPLAINER_SOFT);
  }, softOnly("READING_LEVEL")),
  T("READING_LEVEL", "a Sunday deep dive of 459 words in heavy words, grade 17.7", "sunday", (d) => {
    deepDive(d).text = repeated(LEAD_HARD, 9);
  }),
  T("READING_LEVEL", "a Sunday deep dive of 459 words at grade 13.0", "sunday", (d) => {
    deepDive(d).text = repeated(LEAD_SOFT, 9);
  }, softOnly("READING_LEVEL")),
  T("READING_LEVEL", "a Monday big picture of 306 words in heavy words, grade 17.7", "monday", (d) => {
    review(d).big_picture = repeated(LEAD_HARD, 6);
  }),
  T("READING_LEVEL", "a Monday big picture of 306 words at grade 13.0", "monday", (d) => {
    review(d).big_picture = repeated(LEAD_SOFT, 6);
  }, softOnly("READING_LEVEL")),

  // ── NO_EM_DASH: an em dash, or an en dash between letters, in each kind of text a case can reach ──
  T("NO_EM_DASH", "an em dash in a Lead line", "weekday", (d) => {
    lead(d, 2).text = swap(lead(d, 2).text, ", and", ` ${EM} and`);
  }),
  T("NO_EM_DASH", "an em dash in a finding's `found`", "weekday", (d) => {
    proof(d).explainer.found = swap(proof(d).explainer.found, "found a proof of", `found a proof ${EM} of`);
  }),
  T("NO_EM_DASH", "two em dashes in `how_sure` (the message counts both)", "weekday", (d) => {
    retraction(d).explainer.how_sure = swap(retraction(d).explainer.how_sure, ", the publisher of the papers,", ` ${EM} the publisher of the papers ${EM}`);
  }),
  T("NO_EM_DASH", "an en dash between letters in a finding's title", "weekday", (d) => {
    proof(d).title = `SAMPLE: An AI lab claims a proof ${EN} of an open problem`;
  }),
  T("NO_EM_DASH", "an en dash between letters, with no spaces, in a finding's found", "weekday", (d) => {
    proof(d).explainer.found = swap(proof(d).explainer.found, "found a proof of", `found a proof${EN}of`);
  }),
  T("NO_EM_DASH", "an em dash in an idea line", "weekday", (d) => {
    idea(d, 1).text = swap(idea(d, 1).text, "told plainly what", `told plainly ${EM} what`);
  }),
  T("NO_EM_DASH", "an em dash in an Also noted title", "weekday", (d) => {
    also(d, 0).title = swap(also(d, 0).title, "monsoon rainfall weeks", `monsoon rainfall ${EM} weeks`);
  }),
  T("NO_EM_DASH", "an em dash in a new term's definition", "weekday", (d) => {
    newTerm(protein(d), 0).definition = swap(newTerm(protein(d), 0).definition, "ice with", `ice ${EM} with`);
  }),
  T("NO_EM_DASH", "an em dash in a figure's alt text", "weekday", (d) => {
    figure(scroll(d)).alt = swap(figure(scroll(d)).alt, "layer, with", `layer ${EM} with`);
  }),
  T("NO_EM_DASH", "an em dash in an agent's rung note", "weekday", (d) => {
    rungChange(d).rung.note = swap(rungChange(d).rung.note ?? "", "the work and", `the work ${EM} and`);
  }),
  T("NO_EM_DASH", "an em dash in a correction's reason", "weekday", (d) => {
    correction(d, 1).reason = swap(correction(d, 1).reason, "own system and", `own system ${EM} and`);
  }),
  T("NO_EM_DASH", "an em dash in a correction's after at a prose path (explainer.background)", "weekday", (d) => {
    correction(d, 0).after = swap(correction(d, 0).after, "square tiles repeats", `square tiles ${EM} repeats`);
  }),
  T("NO_EM_DASH", "an em dash in a report decision's reason", "weekday", (d) => {
    decision(d, 0).reason = swap(decision(d, 0).reason, "plane only. The first text", `plane only ${EM} the first text`);
  }),
  T("NO_EM_DASH", "an em dash in a `who` name (a name is read, a quote and a source title are not)", "weekday", (d) => {
    at(scroll(d).who, 0, "who entry of the scroll finding").name += ` ${EM} SAMPLE`;
  }),
  T("NO_EM_DASH", "an em dash in a reaction's affiliation", "weekday", (d) => {
    at(scroll(d).reactions, 0, "reaction of the scroll finding").affiliation += ` ${EM} SAMPLE`;
  }),
  T("NO_EM_DASH", "an em dash in the Sunday deep dive", "sunday", (d) => {
    deepDive(d).text = swap(deepDive(d).text, "tested them.", `tested them ${EM} all of them.`);
  }),
  T("NO_EM_DASH", "an en dash between letters in the Sunday deep dive", "sunday", (d) => {
    deepDive(d).text = swap(deepDive(d).text, "Cell published", `Cell${EN}published`);
  }),
  T("NO_EM_DASH", "an em dash in the Monday big picture", "monday", (d) => {
    review(d).big_picture = swap(review(d).big_picture, "progress with warnings", `progress ${EM} with warnings`);
  }),
  T("NO_EM_DASH", "an em dash in the remarkable note", "monday", (d) => {
    remarkable(d).note = swap(remarkable(d).note, "antibiotic that", `antibiotic ${EM} that`);
  }),
  T("NO_EM_DASH", "an em dash in the strongest-evidence-against text", "monday", (d) => {
    review(d).strongest_against.text = swap(review(d).strongest_against.text, "chatbot.", `chatbot ${EM} in public.`);
  }),
  T("NO_EM_DASH", "an em dash in the short week's big picture", "monday-short", (d) => {
    review(d).big_picture = swap(review(d).big_picture, "Last week was quiet.", `Last week was ${EM} quiet.`);
  }),
];
