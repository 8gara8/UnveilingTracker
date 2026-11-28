// Review tests of the words rules (SPEC §4.12): what the independent review of lib/rules/words.ts found that the author's tests
// (tests/rules-words.test.ts) did not pin, each as a test that fails on the rule as it was. They run the whole validator on the
// valid drafts of the fixtures (fixtures/src/drafts.ts) with one change and look at the issues of the group alone, so each one reads
// as a sentence about the rule:
//   READING_LEVEL reads a Lead line or an explainer part that lacks its final stop as a sentence of its own, as WORDS and
//     SENTENCE_LENGTH count it, instead of running it into the next line or part;
//   NO_EM_DASH shows the text around the first dash without cutting a character outside the Basic Multilingual Plane in two, and
//     tells the agent what to do with a dash in an address, which cannot be reworded;
//   and the whole group is pure on every case of fixtures/src/invalid/words.ts: the same issues on a deeply frozen input, none twice,
//     none with half a character in its message, and no rule error.
// A mutation run of the rule file (one-line mutants of every comparison, limit, exemption and clause) left only mutants that change no
// behaviour: those tests and the author's kill every other one.
// New for this project.

import { describe, expect, it } from "vitest";
import { editionDraft, newFindingOf, WEEKDAY_ITEMS } from "@/fixtures/src/drafts";
import { draftInputs } from "@/fixtures/src/inputs";
import { wordsCases, wordsNamed, wordsSoft } from "@/fixtures/src/invalid/words";
import { codesOfGroup } from "@/lib/rules";
import { buildDraftInput, runRules } from "@/lib/rules/run";
import type { ValidationIssue } from "@/lib/rules/types";
import { wordsRules } from "@/lib/rules/words";
import { DraftBrief } from "@/lib/schema/draft";
import { validateDraft } from "@/lib/validate";
import { deepFreeze } from "./helpers/rule-world";

type Json = Record<string, any>;

const MINE: readonly string[] = codesOfGroup("words");
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const SMILE = String.fromCodePoint(0x1f642);
const I = WEEKDAY_ITEMS;

/** One new finding of the weekday draft, as loose JSON a test can change. */
const finding = (draft: Json, item: string): Json => newFindingOf(draft as unknown as DraftBrief, item) as unknown as Json;

/**
 * The issues of the words group on the weekday draft after `mutate` changed it. A draft that fails the schema is judged by SCHEMA
 * alone, which would leave every test of "no issue" true for the wrong reason, so the run must have none.
 */
function wordsIssues(mutate: (draft: Json) => void): ValidationIssue[] {
  const draft = editionDraft("weekday") as unknown as Json;
  mutate(draft);
  const { issues } = validateDraft(draft, draftInputs("weekday"));
  expect(issues.filter((i) => i.code === "SCHEMA" || i.code === "RULE_ERROR")).toEqual([]);
  return issues.filter((i) => MINE.includes(i.code));
}

const only = (issues: readonly ValidationIssue[], code: string): ValidationIssue[] => issues.filter((i) => i.code === code);

/** `n` plain words of one short syllable each, the first with a capital and none with a stop: a sentence a child could read, and no word that any word rule reads. */
function sentence(n: number): string {
  const words = ["the", "team", "ran", "a", "test", "and", "saw", "small", "gains", "in", "the", "work"];
  return Array.from({ length: n }, (_, i) => (i === 0 ? "The" : words[i % words.length]!)).join(" ");
}

/** True for a string that holds half of a character outside the Basic Multilingual Plane. */
const hasLoneSurrogate = (text: string): boolean => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);

describe("READING_LEVEL reads a Lead line or a part that lacks its stop as a sentence of its own", () => {
  it("passes three short Lead lines without final stops: they are three sentences for WORDS, so they are three for the reading grade", () => {
    const issues = wordsIssues((d) => {
      d.lead = [0, 1, 2].map((i) => ({ ...d.lead[i], text: sentence(18) }));
    });
    expect(issues).toEqual([]);
  });

  it("passes the same lines with their stops: the stop that joins them adds no word and no sentence", () => {
    const issues = wordsIssues((d) => {
      d.lead = [0, 1, 2].map((i) => ({ ...d.lead[i], text: `${sentence(18)}.` }));
    });
    expect(issues).toEqual([]);
  });

  it("passes the six parts of the story without final stops, each one a sentence", () => {
    const issues = wordsIssues((d) => {
      const story = finding(d, I.story);
      for (const part of ["found", "matters", "ai_helped", "how_sure", "background", "could_lead"]) story.explainer[part] = sentence(22);
    });
    expect(only(issues, "READING_LEVEL")).toEqual([]);
  });

  it("still fails one long sentence as one sentence: the break only ends a sentence that was already over", () => {
    const issues = wordsIssues((d) => {
      d.lead = [{ ...d.lead[0], text: sentence(60) }];
    });
    expect(only(issues, "READING_LEVEL").map((i) => i.severity)).toEqual(["error"]);
    expect(only(issues, "SENTENCE_LENGTH")).toHaveLength(1);
  });
});

describe("NO_EM_DASH shows the text around the first dash whole", () => {
  const setIdea = (text: string) => (d: Json) => { d.ideas[0].text = text; };
  const near = (text: string): string => {
    const issue = only(wordsIssues(setIdea(text)), "NO_EM_DASH")[0]!;
    return /near "([^"]*)"/.exec(issue.message)![1]!;
  };
  /** A character outside the Basic Multilingual Plane at each end of the range: its halves are 0xd800 0xdc00, 0xd83d 0xde42 and 0xdbff 0xdfff. */
  const ASTRAL = [String.fromCodePoint(0x10000), SMILE, String.fromCodePoint(0x10ffff)];
  const LOW = String.fromCharCode(0xdc00);
  const HIGH = String.fromCharCode(0xd800);

  it.each(ASTRAL)("takes in the second half of a character that the window of 20 code units before the dash starts inside (%s)", (c) => {
    // The character is the first two code units, the dash is the 22nd, so the window starts at the second half of the character.
    const text = `${c}${"b".repeat(19)}${EM}`;
    expect(near(text)).toBe(text);
  });

  it.each(ASTRAL)("takes in the first half of a character that the window of 20 code units after the dash ends inside (%s)", (c) => {
    // The dash is the 2nd code unit and the character the 22nd and 23rd, so the window ends between its halves.
    const text = `b${EM}${"c".repeat(19)}${c}d`;
    expect(near(text)).toBe(`b${EM}${"c".repeat(19)}${c}`);
  });

  it("never reaches for a character it was not cutting: a lone half at the edge of the window stays as the text has it", () => {
    // A lone low half where the window starts, with no high half before it.
    expect(near(`xx${LOW}${"b".repeat(19)}${EM}`)).toBe(`${LOW}${"b".repeat(19)}${EM}`);
    // A lone high half just before the window, with no low half after it.
    expect(near(`x${HIGH}${"b".repeat(20)}${EM}`)).toBe(`${"b".repeat(20)}${EM}`);
    // A lone high half where the window ends, with no low half after it.
    expect(near(`b${EM}${"c".repeat(19)}${HIGH}d`)).toBe(`b${EM}${"c".repeat(19)}${HIGH}`);
    // A lone low half just after the window, with no high half before it.
    expect(near(`b${EM}${"c".repeat(20)}${LOW}`)).toBe(`b${EM}${"c".repeat(20)}`);
  });

  it("leaves a window that cuts nothing as it was: 20 code units before the dash, 20 after", () => {
    expect(near(`${"a".repeat(30)}${EN}${"b".repeat(30)}`)).toBe(`${"a".repeat(20)}${EN}${"b".repeat(20)}`);
  });

  it("has no half character in a message about text that holds whole ones", () => {
    const text = `${SMILE}${"b".repeat(19)}${EM}${"c".repeat(19)}${SMILE}d`;
    const issue = only(wordsIssues(setIdea(text)), "NO_EM_DASH")[0]!;
    expect(hasLoneSurrogate(`${issue.message} ${issue.hint ?? ""}`)).toBe(false);
  });
});

describe("NO_EM_DASH tells the agent what to do with a dash in an address", () => {
  const PROSE_HINT = "An en dash is allowed only between digits. Quotes, a source's title and the text of a correction at such a path keep their own dashes.";
  const URL_HINT = "In an address, write an em dash as %E2%80%94 and an en dash as %E2%80%93.";

  it("gives the percent codes for a source's address, and the rule for prose everywhere else", () => {
    const issues = only(wordsIssues((d) => {
      finding(d, I.story).sources[0].url = `https://example.org/a${EM}b`;
      d.ideas[0].text = `A text ${EM} with a dash.`;
    }), "NO_EM_DASH");
    const byPath = new Map(issues.map((i) => [i.path, i]));
    expect(byPath.get("new_findings[0].sources[0].url")?.hint).toBe(URL_HINT);
    expect(byPath.get("ideas[0].text")?.hint).toBe(PROSE_HINT);
  });

  it("gives the rule for prose for a name, which is no address", () => {
    const issues = only(wordsIssues((d) => { finding(d, I.story).who[0].name = `A${EM}B Lab`; }), "NO_EM_DASH");
    expect(issues.map((i) => [i.path, i.hint])).toEqual([["new_findings[0].who[0].name", PROSE_HINT]]);
  });

  it("gives the rule for prose for a DOI, which is no address either", () => {
    const issues = only(wordsIssues((d) => { finding(d, I.story).artefacts.doi = [`10.1234/a${EM}b`]; }), "NO_EM_DASH");
    expect(issues.map((i) => [i.path, i.hint])).toEqual([["new_findings[0].artefacts.doi[0]", PROSE_HINT]]);
  });

  it("gives them for a figure's image address and a correction's source address too", () => {
    const issues = only(wordsIssues((d) => {
      const story = finding(d, I.story);
      story.figure = { ...story.figure, image_url: `https://example.org/fig${EN}1.png` };
      d.corrections[0].source_url = `https://example.org/c${EM}d`;
    }), "NO_EM_DASH");
    expect(issues.map((i) => i.hint)).toEqual([URL_HINT, URL_HINT]);
  });
});

describe("the words rules are pure on every case of the group", () => {
  const WORDS_CASES = [
    ...wordsCases.map((c) => ({ name: `F ${c.code}`, edition: c.edition ?? "weekday", mutate: c.mutate })),
    ...wordsSoft.map((c) => ({ name: `S ${c.code}`, edition: c.edition ?? "weekday", mutate: c.mutate })),
    ...wordsNamed.map((c) => ({ name: `T ${c.name}`, edition: c.edition, mutate: c.mutate })),
  ];

  it("has the cases it runs: six F, one S and the T cases", () => {
    expect(wordsCases).toHaveLength(6);
    expect(wordsSoft).toHaveLength(1);
    expect(wordsNamed.length).toBeGreaterThan(100);
  });

  it("gives the same issues, in the same order, on a deeply frozen input as on a plain one, with no rule error", () => {
    for (const c of WORDS_CASES) {
      const draft = editionDraft(c.edition);
      const out = c.mutate(draft);
      const parsed = DraftBrief.safeParse(out === undefined ? draft : out);
      expect(parsed.success, c.name).toBe(true);
      if (!parsed.success) continue;
      const plain = runRules(buildDraftInput(parsed.data, draftInputs(c.edition)), wordsRules);
      const frozen = runRules(deepFreeze(buildDraftInput(parsed.data, draftInputs(c.edition))), wordsRules);
      expect(frozen, c.name).toEqual(plain);
      expect(plain.map((i) => i.code).filter((code) => !MINE.includes(code)), c.name).toEqual([]);
    }
  });

  it("reports no issue twice and none with half a character in its message", () => {
    for (const c of WORDS_CASES) {
      const draft = editionDraft(c.edition);
      const out = c.mutate(draft);
      const issues = validateDraft(out === undefined ? draft : out, draftInputs(c.edition)).issues;
      const keys = issues.map((i) => `${i.severity} ${i.code} ${i.path} ${i.message}`);
      expect(new Set(keys).size, c.name).toBe(keys.length);
      for (const i of issues) expect(hasLoneSurrogate(`${i.path} ${i.message} ${i.hint ?? ""}`), `${c.name}: ${i.code}`).toBe(false);
    }
  });
});
