// F, S and T fixtures for the grounding rule group (SPEC §4.12 "Fixtures and tests"): ARTEFACT_FORMAT, QUOTE_VERBATIM and NUMBER_SOURCED.
// Every code of the group is hard (H), so `groundingSoft` is empty: no code of the group has a soft gate, and the warning that a run
// without an evidence file raises for these rules is the engine's INPUT_MISSING, not a code of the group.
//
//   F (`groundingCases`)  one mutation of the weekday draft per code, written to fixtures/drafts/invalid--<CODE>.json. Each fails
//                         `validateDraft()` with the weekday's inputs on exactly that code, and no other error and no warning. A
//                         mutation can change the draft only, never the weekday's evidence, so each one changes a value that the
//                         evidence's pages do not hold (a form, a quote, a figure) and leaves every word count and every other part
//                         of the finding as it was, so no other rule has a reason to fire.
//   T (`groundingNamed`)  the clauses of each row that one F case cannot show: every artefact kind's form and its appearance test, the
//                         three quote kinds and the 25-word limit, a quote taken from the wrong source of its finding, the text a
//                         correction puts at an artefact or a quote path (its form and its length, which no page is asked about), and a
//                         number in each kind of prose the weekday draft has, in the Lead, a returning update and the Sunday and Monday
//                         prose that only those editions carry. Each states the exact set of error and warning codes, so it also
//                         shows that no other rule reads the same fault. The passing sides of the rows ("2,000" and "2000", a number
//                         written as a word up to ten, a quote after Cyber's normalisation, an artefact found in a URL or in a page's
//                         text, an arXiv id matched without its version) are cases that must raise nothing, which a `NamedCase`
//                         cannot say, so `tests/rules-grounding.test.ts` holds them.
//
// A published-mode case (a stored finding's formats, a quote of more than 25 words in a stored record, a stored correction's text at an
// artefact or a quote path, a `removed` correction that rewrote a quote or an artefact) works on a copy of the sample content and is not
// here (SPEC §4.12 "Stored records", "Removed text").
//
// Every value a case writes is invented and marked SAMPLE where it is text, and none is a real identifier: the DOIs, arXiv ids,
// trial numbers and structure ids are the world's own (`world-sources.ts`) written wrongly, or invented in the same registrant and
// number ranges that the world uses for its pages (10.9999, 2610.99, NCT09999 and pdb_00009), and the Lean file sits under the
// invented repository the world already cites.
//
// Cyber's fixtures/src/invalid/cves-grounding-ai.ts at the fork commit 3ced1fb, adapted: the file's role, a list of mutations of the
// weekday draft with a one-line reason for each, and its helper that finds a part of the draft (and throws when its shape changes,
// so a case never mutates the wrong part) are the same; its cases are this project's.

import type { DraftBrief, DraftCorrection, DraftFinding } from "../../../lib/schema/draft";
import type { InvalidCase, NamedCase, SoftCase } from "../build";
import { MONDAY_ITEMS, SUNDAY_ITEMS, WEEKDAY_ITEMS, newFindingOf } from "../drafts";

const I = WEEKDAY_ITEMS;

/** The set of codes a case must give: one error code, and no other error and no warning. */
const only = (code: string) => ({ errors: [code], warnings: [] as string[] });

/** The scroll finding: the story, a Landmark with a figure, two reactions and a DOI (`new-1`). */
const scroll = (d: DraftBrief): DraftFinding => newFindingOf(d, I.story);
/** The protein finding: a Major result with a DOI, a trial number and a structure id (`new-2`). */
const protein = (d: DraftBrief): DraftFinding => newFindingOf(d, I.result);
/** The claimed proof: an AI lab's preprint with an arXiv id and a Lean file (`new-4`). */
const proof = (d: DraftBrief): DraftFinding => newFindingOf(d, I.claimed);

/** The element of a list, or a thrown error: a case never mutates the wrong part of a changed draft. */
function at<T>(list: T[], index: number, what: string): T {
  const found = list[index];
  if (found === undefined) throw new Error(`The draft has no ${what}`);
  return found;
}

/** `text` with `from` replaced by `to`; throws when `from` is not in it, so a case never changes nothing. */
function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`The text has no "${from}": ${text.slice(0, 60)}`);
  return text.replace(from, to);
}

// ── Mutations that more than one case uses ───────────────────────────────────────────────────────

/** Replaces the scroll finding's one DOI (the world's Nature DOI) with `doi`. */
function scrollDoi(d: DraftBrief, doi: string): void {
  const f = scroll(d);
  at(f.artefacts.doi, 0, "scroll DOI");
  f.artefacts.doi = [doi];
}

/** The protein finding's trial number, structure id and DOIs are the world's own; each case replaces one. */
function proteinTrial(d: DraftBrief, trial: string): void {
  const f = protein(d);
  at(f.artefacts.trial, 0, "protein trial");
  f.artefacts.trial = [trial];
}

function proteinPdb(d: DraftBrief, pdb: string): void {
  const f = protein(d);
  at(f.artefacts.pdb, 0, "protein structure id");
  f.artefacts.pdb = [pdb];
}

/** Replaces the claimed proof's arXiv id (`2610.99001`, the world's own page). */
function proofArxiv(d: DraftBrief, arxiv: string): void {
  const f = proof(d);
  at(f.artefacts.arxiv, 0, "proof arXiv id");
  f.artefacts.arxiv = [arxiv];
}

/** Replaces the claimed proof's Lean file URL (the world's `SumSets.lean` on an invented repository). */
function proofLean(d: DraftBrief, lean: string): void {
  const f = proof(d);
  at(f.artefacts.lean, 0, "proof Lean file");
  f.artefacts.lean = [lean];
}

/** A correction of a stored finding's text at `path`, with no source page and no reader report behind it. */
function correctionAt(finding: string, path: string, after: string, reason: string): DraftCorrection {
  return { finding_id: finding, edition_date: null, term_id: null, type: "correction", path, after, reason, source_url: null, report_id: null };
}

/** Fifty Han characters from U+4E00 on, built from code points: a made-up run of text that no one wrote, which counts as 25 words of a quote. */
const HAN_50 = Array.from({ length: 50 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("");

/** A quote of the weekday scroll's source s1 that is 26 words long and is in its page, in order, as the page has it. */
const SCROLL_PAGE_26 = "Hundreds of papyrus scrolls from the library at Herculaneum were charred by the eruption of Mount Vesuvius in AD 79 and cannot be unrolled. We scanned";
/** The Science Media Centre's expert quote on s3, which the finding's other sources do not hold. */
const SMC_QUOTE = "The model found ink traces that no human reader could see";
/** The News and Views page's reaction sentence and the next one, 26 words together, as page s2 has them. */
const NEWS_PAGE_26 = "This is the first time a sealed scroll has given up a whole passage of connected prose. The result rests on a careful reading by people";
/** The tail of page s1 that ends with its licence sentence, 26 words, so the licence quote is one word over the limit. */
const LICENCE_PAGE_26 = "group, checked the readings. The text is a prose work on friendship. Open access. This article is licensed under a Creative Commons Attribution 4.0 International License.";

// ── F: one mutation of the weekday draft per code ────────────────────────────────────────────────

export const groundingCases: readonly InvalidCase[] = [
  {
    // The scroll's DOI copied as the link that a reader clicks. §4.1 and §4.3 want the bare lower-case DOI, without https://doi.org/.
    code: "ARTEFACT_FORMAT", file: "invalid--ARTEFACT_FORMAT.json",
    mutate: (d) => {
      scrollDoi(d, "https://doi.org/10.1038/nature-ut-sample-0001");
    },
  },
  {
    // The first evidence quote with a word dropped: the Nature page says "trained a machine-learning model to detect ink".
    // A paraphrase in quotation marks is the commonest way a quote stops being verbatim.
    code: "QUOTE_VERBATIM", file: "invalid--QUOTE_VERBATIM.json",
    mutate: (d) => {
      at(scroll(d).ai.evidence, 0, "scroll evidence quote").quote = "trained a model to detect ink";
    },
  },
  {
    // One digit changed in the number of letters: the Nature page says 1,800 and no cited page holds 1,900. The sentence keeps its
    // word count, so only the number is wrong.
    code: "NUMBER_SOURCED", file: "invalid--NUMBER_SOURCED.json",
    mutate: (d) => {
      const e = scroll(d).explainer;
      e.found = swap(e.found, "1,800", "1,900");
    },
  },
];

export const groundingSoft: readonly SoftCase[] = [];

// ── T: the clauses one F case cannot show ────────────────────────────────────────────────────────

export const groundingNamed: readonly NamedCase[] = [
  // ── ARTEFACT_FORMAT: each kind's form (SPEC §4.3) ──
  {
    name: "ARTEFACT_FORMAT: a DOI in capitals",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      scrollDoi(d, "10.1038/NATURE-UT-SAMPLE-0001");
    },
  },
  {
    name: "ARTEFACT_FORMAT: a DOI whose registrant has three digits",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      scrollDoi(d, "10.103/nature-ut-sample-0001");
    },
  },
  {
    name: "ARTEFACT_FORMAT: an arXiv id written with its prefix",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proofArxiv(d, "arXiv:2610.99001");
    },
  },
  {
    name: "ARTEFACT_FORMAT: an arXiv id with a three-digit counter",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proofArxiv(d, "2610.990");
    },
  },
  {
    name: "ARTEFACT_FORMAT: a trial number in lower case",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proteinTrial(d, "nct09999002");
    },
  },
  {
    name: "ARTEFACT_FORMAT: a trial number with seven digits",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proteinTrial(d, "NCT0999900");
    },
  },
  {
    name: "ARTEFACT_FORMAT: a structure id in capitals",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proteinPdb(d, "PDB_00009ZZ1");
    },
  },
  {
    name: "ARTEFACT_FORMAT: a structure id with seven characters after pdb_",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proteinPdb(d, "pdb_0009zz1");
    },
  },
  {
    name: "ARTEFACT_FORMAT: a Lean file over http",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proofLean(d, "http://github.com/marlow-labs-sample/sumsets-proof/blob/main/SumSets.lean");
    },
  },
  {
    name: "ARTEFACT_FORMAT: a Lean file on a host other than github.com",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proofLean(d, "https://gitlab.com/marlow-labs-sample/sumsets-proof/-/blob/main/SumSets.lean");
    },
  },
  {
    name: "ARTEFACT_FORMAT: a Lean artefact that is a repository and not a .lean file",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proofLean(d, "https://github.com/marlow-labs-sample/sumsets-proof");
    },
  },
  // ── ARTEFACT_FORMAT: each kind appears in a cited source's URL or fetched text ──
  {
    name: "ARTEFACT_FORMAT: a DOI of the right form that no cited source holds",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      scrollDoi(d, "10.9999/ut-sample.0000");
    },
  },
  {
    name: "ARTEFACT_FORMAT: an arXiv id of the right form that no cited source holds",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proofArxiv(d, "2610.99888");
    },
  },
  {
    name: "ARTEFACT_FORMAT: a trial number of the right form that no cited source holds",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proteinTrial(d, "NCT09999888");
    },
  },
  {
    name: "ARTEFACT_FORMAT: a structure id of the right form that no cited source holds",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proteinPdb(d, "pdb_00009zz9");
    },
  },
  {
    name: "ARTEFACT_FORMAT: a Lean file of the right form that no cited source holds",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      proofLean(d, "https://github.com/marlow-labs-sample/sumsets-proof/blob/main/Other.lean");
    },
  },
  {
    name: "ARTEFACT_FORMAT: a second DOI that no cited source holds, beside a first that one does",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      scroll(d).artefacts.doi.push("10.9999/ut-sample.0000");
    },
  },
  // ── QUOTE_VERBATIM: each kind of quote is in its source's fetched text ──
  {
    name: "QUOTE_VERBATIM: a reaction quote with a word dropped",
    code: "QUOTE_VERBATIM", edition: "weekday", expect: only("QUOTE_VERBATIM"),
    mutate: (d) => {
      at(scroll(d).reactions, 0, "scroll reaction").quote = "This is the first time a sealed scroll has given up a passage of connected prose";
    },
  },
  {
    name: "QUOTE_VERBATIM: a licence quote that names the licence but is not the page's sentence",
    code: "QUOTE_VERBATIM", edition: "weekday", expect: only("QUOTE_VERBATIM"),
    mutate: (d) => {
      // The page's sentence ends "Creative Commons Attribution 4.0 International License": the quote still names CC BY 4.0
      // (FIGURE_LICENCE passes it) but its last words are the agent's own.
      const figure = scroll(d).figure;
      if (figure === null) throw new Error("The scroll finding has no figure");
      figure.licence_quote = "This article is licensed under a Creative Commons Attribution 4.0 licence";
    },
  },
  {
    name: "QUOTE_VERBATIM: a quote that another source of the finding holds, cited as a source whose page does not",
    code: "QUOTE_VERBATIM", edition: "weekday", expect: only("QUOTE_VERBATIM"),
    mutate: (d) => {
      // s3's own quote, put on the evidence entry that cites s1: s3's page holds it and s1's page does not.
      at(scroll(d).ai.evidence, 0, "scroll evidence quote").quote = SMC_QUOTE;
    },
  },
  // ── QUOTE_VERBATIM: at most 25 words, for each kind of quote, though the page holds the words ──
  {
    name: "QUOTE_VERBATIM: an evidence quote of 26 words that the page holds",
    code: "QUOTE_VERBATIM", edition: "weekday", expect: only("QUOTE_VERBATIM"),
    mutate: (d) => {
      at(scroll(d).ai.evidence, 0, "scroll evidence quote").quote = SCROLL_PAGE_26;
    },
  },
  {
    name: "QUOTE_VERBATIM: a reaction quote of 26 words that the page holds",
    code: "QUOTE_VERBATIM", edition: "weekday", expect: only("QUOTE_VERBATIM"),
    mutate: (d) => {
      at(scroll(d).reactions, 0, "scroll reaction").quote = NEWS_PAGE_26;
    },
  },
  {
    name: "QUOTE_VERBATIM: a licence quote of 26 words that the page holds",
    code: "QUOTE_VERBATIM", edition: "weekday", expect: only("QUOTE_VERBATIM"),
    mutate: (d) => {
      const figure = scroll(d).figure;
      if (figure === null) throw new Error("The scroll finding has no figure");
      figure.licence_quote = LICENCE_PAGE_26;
    },
  },
  // ── ARTEFACT_FORMAT and QUOTE_VERBATIM: the text a correction puts at an artefact or a quote path (its form and its length) ──
  {
    name: "ARTEFACT_FORMAT: a correction's new DOI written as a link",
    code: "ARTEFACT_FORMAT", edition: "weekday", expect: only("ARTEFACT_FORMAT"),
    mutate: (d) => {
      // The correction's `after` becomes the finding's DOI, so it is held to the stored form: the bare lower-case DOI, as §4.3 says.
      d.corrections.push(correctionAt("math-2026-0140", "artefacts.doi.0", "https://doi.org/10.9999/ut-sample.0001", "The first DOI named another paper."));
    },
  },
  {
    name: "QUOTE_VERBATIM: a correction's new reaction quote of 26 words",
    code: "QUOTE_VERBATIM", edition: "weekday", expect: only("QUOTE_VERBATIM"),
    mutate: (d) => {
      // No page is asked about a correction's quote, so only its length fails: 26 words.
      const after = "The service says the model runs beside its own system and has not replaced that system, and the tests used past weather only, so live forecasts";
      d.corrections.push(correctionAt("earth-2026-0141", "reactions.0.quote", after, "The first quote was cut off."));
    },
  },
  {
    name: "QUOTE_VERBATIM: a correction's new evidence quote of 26 words, written as 50 Han characters and one word",
    code: "QUOTE_VERBATIM", edition: "weekday", expect: only("QUOTE_VERBATIM"),
    mutate: (d) => {
      // A Chinese, Japanese or Korean character counts as half a word, so these 50 characters make 25 words, and the word before them one more.
      d.corrections.push(correctionAt("earth-2026-0141", "ai.evidence.0.quote", `SAMPLE: ${HAN_50}`, "The first quote was cut off."));
    },
  },
  // ── NUMBER_SOURCED: a number in each kind of model prose ──
  {
    name: "NUMBER_SOURCED: a count above ten written as a word",
    code: "NUMBER_SOURCED", edition: "weekday", expect: only("NUMBER_SOURCED"),
    mutate: (d) => {
      // The Example Press statement says "nine journals": "nine" is exempt, "eleven" is not and no page holds it.
      const e = newFindingOf(d, I.setback).explainer;
      e.found = swap(e.found, "nine journals", "eleven journals");
    },
  },
  {
    name: "NUMBER_SOURCED: a number in the Lead that no source holds",
    code: "NUMBER_SOURCED", edition: "weekday", expect: only("NUMBER_SOURCED"),
    mutate: (d) => {
      // "many papers" becomes "90 papers": the publisher's statement says 84, and no other page holds 90.
      const line = at(d.lead, 2, "third Lead line");
      line.text = swap(line.text, "pulled many papers", "pulled 90 papers");
    },
  },
  {
    name: "NUMBER_SOURCED: a number in a returning update that no source holds",
    code: "NUMBER_SOURCED", edition: "weekday", expect: only("NUMBER_SOURCED"),
    mutate: (d) => {
      const r = at(d.returning, 0, "returning entry");
      r.update = `${r.update} It affects 300 applicants.`;
    },
  },
  {
    name: "NUMBER_SOURCED: a number in a correction's new text that no source holds",
    code: "NUMBER_SOURCED", edition: "weekday", expect: only("NUMBER_SOURCED"),
    mutate: (d) => {
      // The weather service's page, the correction's `source_url`, holds no number: "12 years" is the agent's own.
      const c: DraftCorrection = at(d.corrections, 1, "second correction");
      c.after = swap(c.after, "The tests used past weather only", "The tests used 12 years of past weather only");
    },
  },
  {
    name: "NUMBER_SOURCED: a number in the Sunday deep dive that no source holds",
    code: "NUMBER_SOURCED", edition: "sunday", expect: only("NUMBER_SOURCED"),
    mutate: (d) => {
      if (d.deep_dive === null) throw new Error(`The Sunday draft has no deep dive on ${SUNDAY_ITEMS.deepDive}`);
      d.deep_dive.text = swap(d.deep_dive.text, "about 12 million molecules", "about 13 million molecules");
    },
  },
  {
    name: "NUMBER_SOURCED: a number in the Monday strongest evidence against that no source holds",
    code: "NUMBER_SOURCED", edition: "monday", expect: only("NUMBER_SOURCED"),
    mutate: (d) => {
      if (d.review === null) throw new Error(`The Monday draft has no review of ${MONDAY_ITEMS.remarkable}`);
      // The Sample Review page says 31 manuscripts; no cited page holds 41.
      const against = d.review.strongest_against;
      against.text = swap(against.text, "pasted unpublished manuscripts", "pasted 41 unpublished manuscripts");
    },
  },
];
