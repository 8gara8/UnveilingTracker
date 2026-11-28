// F and T fixtures for the safety rule group (SPEC §4.12 "Fixtures and tests"): DUAL_USE, SECRET_LIKE, CANARY and BLOCKED_HOST. Every
// code of the group is hard (H), so `safetySoft` is empty: no code of the group has a soft gate.
//
//   F (`safetyCases`)  one mutation of the weekday draft per code, written to fixtures/drafts/invalid--<CODE>.json. Each fails
//                      `validateDraft()` with the weekday's inputs on exactly that code, and no other error and no warning. Each
//                      changes one string that no other rule reads (a source's title or publisher, a figure's credit, an idea's
//                      author, an idea line), so no budget, number, quote or source test has a reason to speak.
//   T (`safetyNamed`)  the sub-conditions of each row that one F case cannot show, and the checks the weekday draft cannot reach: the
//                      numbered steps of the Sunday deep dive (SPEC §4.12 lists it) and of the Monday big picture, the sequence layouts,
//                      the sentence pairs, the steps of a finding that a draft correction refiles, and each place a blocked host may
//                      stand. Each states the exact set of error and warning codes.
//
// A case of the other modes works on a copy of the sample content (a stored record, the records being published or not, a `removed`
// correction) or on the Chinese draft, and is not here (SPEC §4.12 "Stored records" and "Removed text"; the Z fixtures are the Chinese
// stage's).
//
// Everything a case adds is invented, and nothing in it is dangerous (AGENTS rule 10): the sequences are made up and plainly artificial
// (the four DNA letters in repeats, the twenty amino-acid letters in the alphabet's order), the steps are the washing of a dish, an
// agent word stands beside a procedure word or a quantity in a sentence that says it is a sample and gives no method, and no case
// holds a real organism's sequence, a method, a dose or a route. The secrets are joined from pieces, so this file holds no secret-shaped
// literal (the generated invalid--SECRET_LIKE.json holds one SAMPLE string that matches no provider's real key). The addresses are
// link shorteners and an archive host with an invented path: no paste, leak, scan or shadow-library host stands in a fixture.
//
// Cyber's fixtures/src/invalid/naming-safety-computed.ts at the fork commit 3ced1fb, adapted: the file's role, a list of mutations of the
// weekday draft with a one-line reason for each, the SECRET_LIKE string joined at run time and the canary appended to a name are the
// same; its cases are this project's.

import type { DraftSource } from "../../../lib/schema/common";
import type { DraftBrief, DraftCorrection, DraftFinding } from "../../../lib/schema/draft";
import { CANARY_TOKEN } from "../../../lib/vocab";
import type { InvalidCase, NamedCase, SoftCase } from "../build";
import { WEEKDAY_ITEMS, newFindingOf } from "../drafts";

const I = WEEKDAY_ITEMS;

/** The set of codes a case must give: one error code, and no other error and no warning. */
const only = (code: string) => ({ errors: [code], warnings: [] as string[] });

/** A source of a finding or of the brief by its id; throws when the draft's shape changes, so a case never mutates the wrong source. */
function sourceIn(sources: DraftSource[], id: string): DraftSource {
  const s = sources.find((x) => x.id === id);
  if (s === undefined) throw new Error(`The draft has no source ${id}`);
  return s;
}

/** An idea line of the weekday draft, by its position; throws when the draft has fewer. */
function ideaAt(d: DraftBrief, index: number): DraftBrief["ideas"][number] {
  const idea = d.ideas[index];
  if (idea === undefined) throw new Error(`The draft has no idea ${index}`);
  return idea;
}

const story = (d: DraftBrief): DraftFinding => newFindingOf(d, I.story);
const result = (d: DraftBrief): DraftFinding => newFindingOf(d, I.result);
const setback = (d: DraftBrief): DraftFinding => newFindingOf(d, I.setback);

/** The brief-level source that only the last Also noted line cites: the one source no other test reads (its title, publisher and URL). */
const spare = (d: DraftBrief): DraftSource => sourceIn(d.sources, "b6");

// ── The strings the cases add ────────────────────────────────────────────────────────────────────

/** A SAMPLE string shaped like SECRET_LIKE's `sk-` pattern, joined at run time so no secret-shaped literal sits in this file. It matches no provider's real key. */
export function sampleSecret(): string {
  return ["s", "k", "-"].join("") + "UTSAMPLE".repeat(3);
}

/** The pieces of the other secret shapes (Cyber's patterns, SPEC §4.12), joined at run time for the same reason. Each is a SAMPLE and matches no real credential. */
export const SAMPLE_SECRETS = {
  /** An AWS access key id: AKIA and 16 capitals or digits. */
  aws: (): string => ["AK", "IA"].join("") + "UTSAMPLEUTSAMPLE",
  /** A GitHub token: ghp_ and 36 letters or digits. */
  github: (): string => ["gh", "p_"].join("") + "UTSAMPLE".repeat(4) + "UTSA",
  /** The first line of a private key block. */
  privateKey: (): string => ["-----BEGIN ", "RSA PRIVATE", " KEY-----"].join(""),
} as const;

/** A lower-case sequence in GenBank's layout: a label, then lines that start with a position number and hold blocks of ten letters. Made up: the four letters in repeats. */
export const GENBANK_SAMPLE = "SAMPLE: a sequence note\n        1 acgtacgtac gtacgtacgt\n       21 acgt";

/** A sequence in UniProt's layout: blocks of exactly ten capitals split by a single space. Made up: the twenty letters in the alphabet's order. */
export const UNIPROT_SAMPLE = "SAMPLE: a protein note\nACDEFGHIKL MNPQRSTVWY";

/** A row of twenty capitals of the amino-acid alphabet, in alphabetical order. */
export const AMINO_ROW_SAMPLE = "SAMPLE: a protein note ACDEFGHIKLMNPQRSTVWY";

/** A database line (a position number, then three blocks of ten letters) whose blocks are split by two spaces: a run of white space is one separator, so it is one nucleotide sequence of 30 letters, as GENBANK_SAMPLE's single spaces make one. Made up: the four letters in repeats. */
export const DATABASE_LINE_SAMPLE = "SAMPLE: a sequence note\n        1 acgtacgtac  gtacgtacgt  acgtacgtac";

/** Two numbered steps, as a made-up, harmless list of the kind DUAL_USE refuses in a biology or chemistry finding, the deep dive on one and the big picture. */
export const STEPS_SAMPLE = "SAMPLE steps for a test, not a method.\n1. Wash the dish.\n2. Count the dishes.";

// The next three samples hold a layout that only a model's own output can: page text never does, since lib/sanitize.ts makes each run of
// white space one space and strips the invisible characters. STYLE.md section 9 forbids a sequence "in any case or layout" all the same.
// Each odd character is built from its code point, so that none is typed in this file. None is an invisible character: the whole
// validator refuses such a character in any string of a draft before the rules run (its own code), so a case with one could not
// fail with the code it is about. The rule's reading of them is tested on the rules themselves (tests/rules-safety.test.ts).
const NO_BREAK_SPACE = String.fromCharCode(0xa0);
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const LIST_BULLET = String.fromCharCode(0x2022);

/** Twenty letters of the four DNA letters in repeats, split by a no-break space, a tab and a double space: one run, across any white space. */
export const SPLIT_NUCLEOTIDE_SAMPLE = `SAMPLE: a sequence note acgtacgtac${NO_BREAK_SPACE}gtac\tgtac  gt`;

/** The twenty capitals of the amino-acid alphabet in order, in blocks of five split by a space, a no-break space and an ideographic space. */
export const FIVE_BLOCKS_SAMPLE = `SAMPLE: a protein note\nACDEF GHIKL${NO_BREAK_SPACE}MNPQR${IDEOGRAPHIC_SPACE}STVWY`;

/** Two numbered steps behind list bullets, each after a line separator rather than a line feed: as short as the "(2) form" case's, since a finding's explainer has a word budget. */
export const BULLET_STEPS_SAMPLE = `${LINE_SEPARATOR}${LIST_BULLET} 1. Wash the dish.${LINE_SEPARATOR}${LIST_BULLET} 2. Count the dishes.`;

/** A sentence that names an agent and a procedure word, and says it is a sample: it gives no method. */
export const AGENT_PROCEDURE_SAMPLE = "SAMPLE sentence for a test: it names anthrax and a synthesis route.";

/** A sentence that names an agent and gives a quantity with a unit, and says it is a sample: it gives no method. */
export const AGENT_QUANTITY_SAMPLE = "SAMPLE sentence for a test: it names anthrax and 5 mg.";

/** The same, with the unit as most texts write it: millilitres in lower case. */
export const AGENT_QUANTITY_LOWER_SAMPLE = "SAMPLE sentence for a test: it names anthrax and 5 ml.";

// ── Draft corrections that refile a finding ──────────────────────────────────────────────────────

/** A correction on a stored finding, as the draft lists it (SPEC §4.5): no report, no source. */
function correction(finding_id: string, type: DraftCorrection["type"], path: string, after: string, reason: string): DraftCorrection {
  return { finding_id, edition_date: null, term_id: null, type, path, after, reason, source_url: null, report_id: null };
}

/** The stored physics finding of the weekday context (the plasma controller), the one the refile cases name. */
const PHYSICS_FINDING = "phys-2026-0147";

/** A correction of that finding's first source title, whose new text holds numbered steps (a title is no model prose, so no number test reads it). */
const stepsCorrection = (): DraftCorrection => correction(
  PHYSICS_FINDING, "update", "sources.0.title", "1. Wash the dish. 2. Count the dishes.", "SAMPLE: the first title was wrong, and this one is right.",
);

/** The two corrections that refile that finding as a biology finding with a biology subfield (a subfield is under one field, so they come together). */
const refileCorrections = (): DraftCorrection[] => [
  correction(PHYSICS_FINDING, "update", "field", "biology", "SAMPLE: the record was filed under the wrong field."),
  correction(PHYSICS_FINDING, "update", "subfield", "proteins", "SAMPLE: the record was filed under the wrong subfield."),
];

// ── F: one mutation of the weekday draft per code ────────────────────────────────────────────────

export const safetyCases: readonly InvalidCase[] = [
  {
    // A lower-case sequence in GenBank's layout (a position number, then blocks of ten), in the title of the source only the last Also noted line cites.
    code: "DUAL_USE", file: "invalid--DUAL_USE.json",
    mutate: (d) => {
      spare(d).title = GENBANK_SAMPLE;
    },
  },
  {
    // A SAMPLE string shaped like an `sk-` key in the story figure's credit (any string counts).
    code: "SECRET_LIKE", file: "invalid--SECRET_LIKE.json",
    mutate: (d) => {
      const figure = story(d).figure;
      if (figure === null) throw new Error("The story has no figure");
      figure.credit = `${figure.credit} ${sampleSecret()}`;
    },
  },
  {
    // The canary string, planted in an unsafe page for the test, in the second idea line's author (any string counts).
    code: "CANARY", file: "invalid--CANARY.json",
    mutate: (d) => {
      const idea = ideaAt(d, 1);
      idea.who = `${idea.who} ${CANARY_TOKEN}`;
    },
  },
  {
    // A link-shortener address in the first idea line: a host on BLOCKED_HOSTS, in prose, with its scheme.
    code: "BLOCKED_HOST", file: "invalid--BLOCKED_HOST.json",
    mutate: (d) => {
      const idea = ideaAt(d, 0);
      idea.text = `${idea.text} Read more at https://t.co/ut-sample-idea.`;
    },
  },
];

export const safetySoft: readonly SoftCase[] = [];

// ── T: the sub-conditions of each row, and the checks a weekday draft cannot reach ───────────────

export const safetyNamed: readonly NamedCase[] = [
  // ── DUAL_USE: the sequences ──
  {
    name: "DUAL_USE: a sequence in UniProt's layout, blocks of exactly ten capitals split by a single space",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      spare(d).title = UNIPROT_SAMPLE;
    },
  },
  {
    name: "DUAL_USE: a row of twenty amino-acid capitals inside a longer title",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      spare(d).title = AMINO_ROW_SAMPLE;
    },
  },
  {
    name: "DUAL_USE: a sequence of twenty nucleotide letters across a single space, in a source's publisher",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      spare(d).publisher = "SAMPLE acgtacgtac gtacgtacgt";
    },
  },
  {
    name: "DUAL_USE: a database line of the letters acgt whose blocks are split by two spaces, which the nucleotide pattern reads as one run",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      spare(d).title = DATABASE_LINE_SAMPLE;
    },
  },
  {
    name: "DUAL_USE: a sequence in prose, an idea line's text",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      const idea = ideaAt(d, 0);
      idea.text = `${idea.text} SAMPLE letters: acgtacgtac gtacgtacgt.`;
    },
  },
  {
    name: "DUAL_USE: a sequence in a figure's credit, which no budget reads",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      const figure = story(d).figure;
      if (figure === null) throw new Error("The story has no figure");
      figure.credit = `${figure.credit} acgtacgtacgtacgtacgt`;
    },
  },
  {
    name: "DUAL_USE: a sequence of twenty nucleotide letters split by a no-break space, a tab and a double space, in a source's publisher",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      spare(d).publisher = SPLIT_NUCLEOTIDE_SAMPLE;
    },
  },
  {
    name: "DUAL_USE: a sequence in capital blocks of five split by a no-break space and an ideographic space, in a source's title",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      spare(d).title = FIVE_BLOCKS_SAMPLE;
    },
  },

  // ── DUAL_USE: numbered steps ──
  {
    name: "DUAL_USE: numbered steps in the Sunday deep dive, on a biology candidate",
    code: "DUAL_USE", edition: "sunday", expect: only("DUAL_USE"),
    mutate: (d) => {
      if (d.deep_dive === null) throw new Error("The Sunday draft has no deep dive");
      d.deep_dive.text = `${d.deep_dive.text}\n\n${STEPS_SAMPLE}`;
    },
  },
  {
    name: "DUAL_USE: numbered steps in the Monday big picture (Step N)",
    code: "DUAL_USE", edition: "monday", expect: only("DUAL_USE"),
    mutate: (d) => {
      if (d.review === null) throw new Error("The Monday draft has no review");
      d.review.big_picture = `${d.review.big_picture}\n\nStep 1: Wash the dish.\nStep 2: Count the dishes.`;
    },
  },
  {
    name: "DUAL_USE: numbered steps (2) form in a biology finding's explainer",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      const f = result(d);
      f.explainer.background = `${f.explainer.background}\n(1) Wash the dish.\n(2) Count the dishes.`;
    },
  },
  {
    name: "DUAL_USE: numbered steps behind list bullets and a line separator, in a biology finding's explainer",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      const f = result(d);
      f.explainer.background = `${f.explainer.background}${BULLET_STEPS_SAMPLE}`;
    },
  },
  {
    name: "DUAL_USE: numbered steps 1) 2) in the publisher of a source of a chemistry finding",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      sourceIn(setback(d).sources, "s3").publisher = "1) Wash the dish. 2) Count the dishes.";
    },
  },
  {
    name: "DUAL_USE: numbered steps in the title of a source of a biology finding",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      sourceIn(result(d).sources, "s4").title = "1. Wash the dish. 2. Count the dishes.";
    },
  },
  {
    name: "DUAL_USE: numbered steps in a stored physics finding's correction, once the same draft refiles it as biology",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      d.corrections.push(stepsCorrection(), ...refileCorrections());
    },
  },

  // ── DUAL_USE: the sentence test ──
  {
    name: "DUAL_USE: an agent term and a procedure word in one sentence, in prose",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      const idea = ideaAt(d, 0);
      idea.text = `${idea.text} ${AGENT_PROCEDURE_SAMPLE}`;
    },
  },
  {
    name: "DUAL_USE: an agent term and a quantity with a unit in one sentence, in a source's title",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      spare(d).title = AGENT_QUANTITY_SAMPLE;
    },
  },
  {
    name: "DUAL_USE: an agent term and a quantity whose unit is written in lower case (5 ml), in a source's publisher (no number test reads it)",
    code: "DUAL_USE", edition: "weekday", expect: only("DUAL_USE"),
    mutate: (d) => {
      spare(d).publisher = AGENT_QUANTITY_LOWER_SAMPLE;
    },
  },

  // ── SECRET_LIKE: the other shapes, in strings of other kinds ──
  {
    name: "SECRET_LIKE: an AWS access key id in a source's publisher",
    code: "SECRET_LIKE", edition: "weekday", expect: only("SECRET_LIKE"),
    mutate: (d) => {
      spare(d).publisher = `Zenodo ${SAMPLE_SECRETS.aws()}`;
    },
  },
  {
    name: "SECRET_LIKE: a GitHub token in an idea line's author",
    code: "SECRET_LIKE", edition: "weekday", expect: only("SECRET_LIKE"),
    mutate: (d) => {
      const idea = ideaAt(d, 0);
      idea.who = `${idea.who} ${SAMPLE_SECRETS.github()}`;
    },
  },
  {
    name: "SECRET_LIKE: the first line of a private key block in a source's title",
    code: "SECRET_LIKE", edition: "weekday", expect: only("SECRET_LIKE"),
    mutate: (d) => {
      spare(d).title = `SAMPLE: ${SAMPLE_SECRETS.privateKey()}`;
    },
  },
  {
    name: "SECRET_LIKE: a key string in prose, an idea line's text",
    code: "SECRET_LIKE", edition: "weekday", expect: only("SECRET_LIKE"),
    mutate: (d) => {
      const idea = ideaAt(d, 1);
      idea.text = `${idea.text} Key: ${sampleSecret()}.`;
    },
  },

  // ── CANARY: any case, any string ──
  {
    name: "CANARY: the token in lower case, in a source's title",
    code: "CANARY", edition: "weekday", expect: only("CANARY"),
    mutate: (d) => {
      spare(d).title = `SAMPLE: ${CANARY_TOKEN.toLowerCase()}`;
    },
  },
  {
    name: "CANARY: the token in the Lead, a string of the brief",
    code: "CANARY", edition: "weekday", expect: only("CANARY"),
    mutate: (d) => {
      const line = d.lead[0];
      if (line === undefined) throw new Error("The draft has no Lead");
      if (!line.text.endsWith(".")) throw new Error("The first Lead line does not end with a full stop");
      line.text = `${line.text.slice(0, -1)} ${CANARY_TOKEN}.`;
    },
  },
  {
    name: "CANARY: the token in the Sunday deep dive",
    code: "CANARY", edition: "sunday", expect: only("CANARY"),
    mutate: (d) => {
      if (d.deep_dive === null) throw new Error("The Sunday draft has no deep dive");
      d.deep_dive.text = `${d.deep_dive.text} ${CANARY_TOKEN}`;
    },
  },

  // ── BLOCKED_HOST: each place and form of an address ──
  {
    name: "BLOCKED_HOST: a host written without a scheme, in prose",
    code: "BLOCKED_HOST", edition: "weekday", expect: only("BLOCKED_HOST"),
    mutate: (d) => {
      const idea = ideaAt(d, 0);
      idea.text = `${idea.text} Read more at bit.ly/ut-sample-idea.`;
    },
  },
  {
    name: "BLOCKED_HOST: an address with another scheme (http), in prose",
    code: "BLOCKED_HOST", edition: "weekday", expect: only("BLOCKED_HOST"),
    mutate: (d) => {
      const idea = ideaAt(d, 1);
      idea.text = `${idea.text} Read more at http://tinyurl.com/ut-sample-idea.`;
    },
  },
  {
    name: "BLOCKED_HOST: a host on a path entry (a redirect through google.com/url), in a figure's credit",
    code: "BLOCKED_HOST", edition: "weekday", expect: only("BLOCKED_HOST"),
    mutate: (d) => {
      const figure = story(d).figure;
      if (figure === null) throw new Error("The story has no figure");
      figure.credit = `${figure.credit} See www.google.com/url?q=ut-sample.`;
    },
  },
  {
    name: "BLOCKED_HOST: a source's address on a shortener, the finding's source list (PRIMARY_ONLY and SOURCE_SEEN skip it)",
    code: "BLOCKED_HOST", edition: "weekday", expect: only("BLOCKED_HOST"),
    mutate: (d) => {
      sourceIn(story(d).sources, "s4").url = "https://bit.ly/ut-sample-0003";
    },
  },
  {
    name: "BLOCKED_HOST: a brief source's address on a shortener",
    code: "BLOCKED_HOST", edition: "weekday", expect: only("BLOCKED_HOST"),
    mutate: (d) => {
      spare(d).url = "https://t.co/ut-sample-0003";
    },
  },
  {
    name: "BLOCKED_HOST: a correction's source address on a shortener (a redirect or an archive entry would be SOURCE_URL's, as for a source)",
    code: "BLOCKED_HOST", edition: "weekday", expect: only("BLOCKED_HOST"),
    mutate: (d) => {
      const c = d.corrections[0];
      if (c === undefined) throw new Error("The draft has no correction");
      c.source_url = "https://bit.ly/ut-sample-correction";
    },
  },
  {
    name: "BLOCKED_HOST: a figure's image on a shortener (a URL field: any entry fails)",
    code: "BLOCKED_HOST", edition: "weekday", expect: only("BLOCKED_HOST"),
    mutate: (d) => {
      const figure = story(d).figure;
      if (figure === null) throw new Error("The story has no figure");
      figure.image_url = "https://bit.ly/ut-sample-figure.png";
    },
  },
  {
    name: "BLOCKED_HOST: a blocked host in the Sunday deep dive",
    code: "BLOCKED_HOST", edition: "sunday", expect: only("BLOCKED_HOST"),
    mutate: (d) => {
      if (d.deep_dive === null) throw new Error("The Sunday draft has no deep dive");
      d.deep_dive.text = `${d.deep_dive.text} The notes are at https://t.co/ut-sample-notes.`;
    },
  },
  {
    name: "BLOCKED_HOST: a blocked host in the Monday big picture",
    code: "BLOCKED_HOST", edition: "monday", expect: only("BLOCKED_HOST"),
    mutate: (d) => {
      if (d.review === null) throw new Error("The Monday draft has no review");
      d.review.big_picture = `${d.review.big_picture} The notes are at https://t.co/ut-sample-notes.`;
    },
  },
];

