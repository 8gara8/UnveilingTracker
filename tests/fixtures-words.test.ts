// The fixtures of the words group (SPEC §4.12 "Fixtures and tests"; fixtures/src/invalid/words.ts): WORDS, SENTENCE_LENGTH, HYPE_WORDS,
// TERM_DEFINED, READING_LEVEL and NO_EM_DASH. It checks that the F cases are the ones the rule table lists, each filed as
// invalid--CODE.json, fail the whole validator with exactly their code at the string they are about, change that one string (the Lead's
// three lines for READING_LEVEL) of the weekday draft, and match the files in fixtures/drafts/ byte for byte; that the S list is the
// READING_LEVEL file alone, with no warning but its own, and that WORDS has no S file because no weekday draft can pass the page total
// target (the soft and the hard page total are tested with a lowered budget instead); that each T case gives its exact set of error and
// warning codes with its edition's own inputs, from the whole validator and from the group's rules alone; that each boundary a case names
// has a passing neighbour, so the case fails for that boundary and no other; that the four valid editions pass; and that the cases add
// nothing but invented text, with no link, no name the valid draft does not use and no dash of the wrong kind. The files of the English
// invalid and soft drafts hold their dashes as \u escapes (dashEscaped()), like the Chinese ones. Published-mode cases (a stored brief, a
// removed string, the records being published or not) work on a copy of the sample content and are not here.
// New for this project; Cyber's tests/validate.test.ts ran its F cases through its whole validator.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EDITION_NAMES, REPO_ROOT, type EditionName } from "@/fixtures/src/world";
import { invalidDraft, invalidOutputs, softDraft, softOutputs } from "@/fixtures/src/build";
import { editionDraft, newFindingOf, WEEKDAY_ITEMS } from "@/fixtures/src/drafts";
import { draftInputs, fixtureConfig } from "@/fixtures/src/inputs";
import {
  CORRECTED_EDITION, CORRECTED_TERM, SENTENCE_SURFACES, addCorrection, at, correctedFinding, grow, longSentence, padding, resize, swap, wordsCases, wordsNamed, wordsSoft,
} from "@/fixtures/src/invalid/words";
import type { LoadedConfig } from "@/lib/config";
import { RULE_CODE_TABLE, codesOfGroup } from "@/lib/rules";
import { buildDraftInput, runRules } from "@/lib/rules/run";
import type { ValidationIssue } from "@/lib/rules/types";
import { wordsRules } from "@/lib/rules/words";
import { readingGrade } from "@/lib/readability";
import { DraftBrief } from "@/lib/schema/draft";
import { countWords } from "@/lib/text";
import { validateDraft, type DraftInputs } from "@/lib/validate";

type Json = Record<string, unknown>;
type Budgets = LoadedConfig["run"]["budgets"];

const MINE = codesOfGroup("words");
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const I = WEEKDAY_ITEMS;

/** Where each F case fails: the one path pattern its code is reported at. */
const WHERE: Readonly<Record<string, RegExp>> = {
  WORDS: /^new_findings\[\d+\]\.title$/,
  SENTENCE_LENGTH: /^new_findings\[\d+\]\.explainer\.found$/,
  HYPE_WORDS: /^lead\[\d+\]\.text$/,
  TERM_DEFINED: /^new_findings\[\d+\]\.explainer\.ai_helped$/,
  READING_LEVEL: /^lead$/,
  NO_EM_DASH: /^new_findings\[\d+\]\.explainer\.matters$/,
};

/** The strings of the weekday draft that each F case changes, and no others: a small change, obviously about one rule. */
const CHANGES: Readonly<Record<string, readonly string[]>> = {
  WORDS: ["new_findings[1].title"],
  SENTENCE_LENGTH: ["new_findings[3].explainer.found"],
  HYPE_WORDS: ["lead[0].text"],
  TERM_DEFINED: ["new_findings[1].explainer.ai_helped"],
  READING_LEVEL: ["lead[0].text", "lead[1].text", "lead[2].text"],
  NO_EM_DASH: ["new_findings[2].explainer.matters"],
};

/** The most strings a T case may change. */
const T_CHANGES_MAX = 6;

type Mutating = { edition?: EditionName; mutate: (draft: DraftBrief) => unknown };

/** A case's draft: a fresh copy of its edition's valid draft, mutated (as the builder's `invalidDraft()` does for an F case). */
const mutated = (c: Mutating): unknown => {
  const draft = editionDraft(c.edition ?? "weekday");
  const out = c.mutate(draft);
  return out === undefined ? draft : out;
};

/** The inputs of an edition with some budgets of config/run.json changed (`fixtureConfig()` itself stays as it was). */
function inputsWith(edition: EditionName, patch: Partial<Budgets>): DraftInputs {
  const inputs = draftInputs(edition);
  return { ...inputs, config: { ...inputs.config, run: { ...inputs.config.run, budgets: { ...inputs.config.run.budgets, ...patch } } } };
}

/** The group's own rules on a draft with its edition's inputs, and the whole validator on it. */
const own = (draft: unknown, edition: EditionName, inputs: DraftInputs = draftInputs(edition)): ValidationIssue[] =>
  runRules(buildDraftInput(DraftBrief.parse(draft), inputs), wordsRules);
const whole = (draft: unknown, edition: EditionName, inputs: DraftInputs = draftInputs(edition)): ValidationIssue[] => validateDraft(draft, inputs).issues;
const tell = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.severity} ${i.code}`);
const codesOf = (issues: readonly ValidationIssue[], severity: string): string[] =>
  [...new Set(issues.filter((i) => i.severity === severity).map((i) => i.code))].sort();

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** The paths, written as the issues write them, of the strings in which two JSON values differ. */
function changedStrings(before: unknown, after: unknown, path = ""): string[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    const out: string[] = [];
    for (let i = 0; i < Math.max(before.length, after.length); i += 1) out.push(...changedStrings(before[i], after[i], `${path}[${i}]`));
    return out;
  }
  if (isObject(before) && isObject(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((k) => changedStrings(before[k], after[k], path === "" ? k : `${path}.${k}`));
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [path];
}

/** Every string in a JSON value. */
function leaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) leaves(v, out);
  return out;
}

/** The strings of `after` that `before` does not hold. */
function added(before: unknown, after: unknown): string[] {
  const had = new Set(leaves(before));
  return [...new Set(leaves(after))].filter((s) => !had.has(s));
}

/** The dashes of a text: every `\p{Pd}` character but the hyphen-minus. */
const dashesIn = (text: string): string[] => Array.from(text).filter((ch) => /^\p{Pd}$/u.test(ch) && ch !== "-");

/** The words of a string that start with a capital letter and a small one and are not its first word of a sentence: the names it brings. */
function namesIn(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?:])\s+/)) {
    const words = sentence.split(/\s+/).slice(1);
    for (const w of words) {
      const m = /^[("']*([A-Z][a-z][A-Za-z0-9-]*)/.exec(w);
      if (m) out.push(m[1]!);
    }
  }
  return out;
}

/**
 * The page total of SPEC §4.12's word budgets table, summed here from the draft and the table alone and not by the rule: the model
 * prose the brief's page shows. A finding shows its title and first four parts, the day's story also its last two; a returning entry its
 * update; then the ideas, the Also noted titles, the deep dive and the review.
 */
function pageTotal(d: DraftBrief): number {
  const w = (s: string | null | undefined): number => (s ? countWords(s) : 0);
  let n = 0;
  for (const l of d.lead) n += w(l.text);
  for (const f of d.new_findings) {
    const e = f.explainer;
    n += w(f.title) + w(e.found) + w(e.matters) + w(e.ai_helped) + w(e.how_sure);
    if (f.ref === d.story) n += w(e.background) + w(e.could_lead);
  }
  for (const r of d.returning) n += w(r.update);
  for (const i of d.ideas) n += w(i.text);
  for (const a of d.also) n += w(a.title);
  if (d.deep_dive !== null) n += w(d.deep_dive.text);
  if (d.review !== null) n += w(d.review.big_picture) + w(d.review.remarkable?.note) + w(d.review.strongest_against.text);
  return n;
}

// ── The F cases ──────────────────────────────────────────────────────────────────────────────────

describe("the words group's F cases", () => {
  it("has one F case for each code that the rule table lists an F fixture for, in the table's order, each filed as invalid--CODE.json", () => {
    const listed = RULE_CODE_TABLE.filter((r) => r.group === "words" && r.tests.includes("F")).map((r) => r.code);
    expect(listed).toEqual(["WORDS", "SENTENCE_LENGTH", "HYPE_WORDS", "TERM_DEFINED", "READING_LEVEL", "NO_EM_DASH"]);
    expect(wordsCases.map((c) => c.code)).toEqual(listed);
    for (const c of wordsCases) expect(c.file, c.code).toBe(`invalid--${c.code}.json`);
    expect(new Set(wordsCases.map((c) => c.file)).size).toBe(wordsCases.length);
  });

  it("makes each case from the weekday draft, the draft the spec says an F case mutates", () => {
    for (const c of wordsCases) expect(c.edition ?? "weekday", c.code).toBe("weekday");
  });

  it.each(wordsCases.map((c) => [c.code, c] as const))(
    "F %s: fails validateDraft() with exactly its code and no warning, at the string it is about, by changing nothing else",
    (code, c) => {
      const draft = invalidDraft(c);
      const issues = whole(draft, "weekday");
      expect(issues.length, code).toBeGreaterThan(0);
      expect([...new Set(tell(issues))], code).toEqual([`error ${code}`]);
      for (const issue of issues) expect(issue.path, `${code} at ${issue.path}`).toMatch(WHERE[code]!);
      // The group's own rules say the same, on the same paths: no other rule is needed to make the case fail
      const mine = own(draft, "weekday");
      expect([...new Set(tell(mine))], code).toEqual([`error ${code}`]);
      expect(mine.map((i) => i.path), code).toEqual(issues.map((i) => i.path));
      expect(changedStrings(editionDraft("weekday"), draft), code).toEqual(CHANGES[code]);
    },
  );

  it.each(wordsCases.map((c) => [c.code, c] as const))("F %s: its file in fixtures/drafts/ is the builder's output and fails the same way", (code, c) => {
    const { path, text } = invalidOutputs([c])[0]!;
    expect(path).toBe(`fixtures/drafts/invalid--${code}.json`);
    expect(readFileSync(join(REPO_ROOT, path), "utf8")).toBe(text);
    expect([...new Set(tell(whole(JSON.parse(text), "weekday")))]).toEqual([`error ${code}`]);
  });

  it("writes each dash of an English invalid or soft draft as a \\u escape, so no committed file holds a dash as a character", () => {
    const outputs = [...invalidOutputs(), ...softOutputs()];
    expect(outputs.length).toBeGreaterThan(40);
    for (const { path, text } of outputs) expect(dashesIn(text), path).toEqual([]);
    const file = readFileSync(join(REPO_ROOT, "fixtures/drafts/invalid--NO_EM_DASH.json"), "utf8");
    expect(file).toContain("\\u2014");
    const parsed = JSON.parse(file) as DraftBrief;
    const matters = parsed.new_findings[2]!.explainer.matters;
    expect(matters).toContain(EM);
    expect(dashesIn(matters)).toEqual([EM]);
  });
});

// ── The S cases ──────────────────────────────────────────────────────────────────────────────────

describe("the words group's S cases", () => {
  it("is the READING_LEVEL file alone: the table lists no S fixture for WORDS, whose soft gate no weekday draft reaches (see below)", () => {
    const listed = RULE_CODE_TABLE.filter((r) => r.group === "words" && r.tests.includes("S")).map((r) => r.code);
    expect(listed).toEqual(["READING_LEVEL"]);
    expect(wordsSoft.map((c) => c.code)).toEqual(["READING_LEVEL"]);
    for (const c of wordsSoft) {
      expect(c.file, c.code).toBe(`soft--${c.code}.json`);
      expect(c.edition ?? "weekday", c.code).toBe("weekday");
    }
  });

  it.each(wordsSoft.map((c) => [c.code, c] as const))("S %s: passes with no error and exactly one warning, its own, at the Lead, by changing the Lead alone", (code, c) => {
    const draft = softDraft(c);
    const result = validateDraft(draft, draftInputs("weekday"));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(tell(result.issues)).toEqual([`warning ${code}`]);
    expect(result.issues[0]!.path).toBe("lead");
    expect(changedStrings(editionDraft("weekday"), draft)).toEqual(CHANGES.READING_LEVEL);
    // Above the soft limit and at most the hard one, as a whole and in each of its three lines
    const { reading_grade_soft: soft, reading_grade_max: max } = fixtureConfig().run.budgets;
    const lines = (draft as DraftBrief).lead.map((l) => l.text);
    for (const text of [lines.join(" "), ...lines]) {
      const grade = readingGrade(text);
      expect(grade, text).toBeGreaterThan(soft);
      expect(grade, text).toBeLessThanOrEqual(max);
    }
    expect(own(draft, "weekday").map((i) => i.path)).toEqual(["lead"]);
  });

  it.each(wordsSoft.map((c) => [c.code, c] as const))("S %s: its file in fixtures/drafts/ is the builder's output and warns the same way", (code, c) => {
    const { path, text } = softOutputs([c])[0]!;
    expect(path).toBe(`fixtures/drafts/soft--${code}.json`);
    expect(readFileSync(join(REPO_ROOT, path), "utf8")).toBe(text);
    const result = validateDraft(JSON.parse(text), draftInputs("weekday"));
    expect([result.errors.length, tell(result.warnings)]).toEqual([0, [`warning ${code}`]]);
  });

  it("has no soft--WORDS.json, because no weekday draft within the budgets reaches the page total target of 1,000 words", () => {
    // The most a weekday page can hold, each string at its budget: the Lead (60), the story with its title and six parts (12 + 280), four
    // more findings with their titles and first four parts (4 x (12 + 100); the fifth finding of the five the day allows is the story),
    // two ideas (2 x 40) and five Also noted titles (5 x 20)
    const mostWeekday = 60 + (12 + 280) + 4 * (12 + 100) + 2 * 40 + 5 * 20;
    expect(mostWeekday).toBe(980);
    const { words_target: target, findings_max: findingsMax } = fixtureConfig().run.budgets;
    expect(findingsMax).toBe(5);
    expect(mostWeekday).toBeLessThan(target);
  });

  it.each(EDITION_NAMES.map((e) => [e] as const))(
    "WORDS soft and hard, on the %s draft with its page total as the limit: the total passes, one word over the target warns (no error), one word over the limit fails",
    (edition) => {
      const draft = editionDraft(edition);
      const total = pageTotal(draft);
      expect(total, "the page total, counted here from the spec's table").toBeGreaterThan(0);
      const pageIssues = (issues: readonly ValidationIssue[]): ValidationIssue[] => issues.filter((i) => i.code === "WORDS" && i.path === "(root)");
      // The rule reports the same total as the one counted here
      const probe = whole(draft, edition, inputsWith(edition, { words_target: 1, words_max: 1 }));
      expect(pageIssues(probe).map((i) => i.message)).toEqual([`The page has ${total} words; the limit is 1. Cut at least ${total - 1}.`]);
      // At the target and at the limit: nothing
      expect(whole(draft, edition, inputsWith(edition, { words_target: total, words_max: total }))).toEqual([]);
      // One word over the target: exactly one warning, and the draft is ok
      const soft = validateDraft(draft, inputsWith(edition, { words_target: total - 1 }));
      expect(tell(soft.issues)).toEqual(["warning WORDS"]);
      expect(soft.issues[0]!.path).toBe("(root)");
      expect(soft.issues[0]!.message).toBe(`The page has ${total} words; the target is ${total - 1}. Cut 1 to reach it.`);
      expect(soft.ok).toBe(true);
      // One word over the limit: exactly one error, and no warning beside it
      const hard = validateDraft(draft, inputsWith(edition, { words_target: total - 1, words_max: total - 1 }));
      expect(tell(hard.issues)).toEqual(["error WORDS"]);
      expect(hard.issues[0]!.path).toBe("(root)");
      expect(hard.issues[0]!.message).toBe(`The page has ${total} words; the limit is ${total - 1}. Cut at least 1.`);
      expect(hard.ok).toBe(false);
      // The group's own rules say the same
      expect(tell(own(draft, edition, inputsWith(edition, { words_target: total - 1 })))).toEqual(["warning WORDS"]);
      expect(tell(own(draft, edition, inputsWith(edition, { words_target: total - 1, words_max: total - 1 })))).toEqual(["error WORDS"]);
    },
  );

  it("does not change the shared config when a test lowers a budget", () => {
    const before = JSON.stringify(fixtureConfig().run.budgets);
    inputsWith("weekday", { words_target: 1, words_max: 1, reading_grade_soft: 1, reading_grade_max: 1 });
    expect(JSON.stringify(fixtureConfig().run.budgets)).toBe(before);
  });

  it("READING_LEVEL's soft and hard limits are exact: a grade equal to a limit passes it, a grade above it does not, whichever line of the Lead reads highest", () => {
    const draft = softDraft(wordsSoft[0]!) as DraftBrief;
    const grade = readingGrade(draft.lead.map((l) => l.text).join(" "));
    expect(grade).toBeGreaterThan(12);
    expect(grade).toBeLessThan(14);
    // The soft limit
    expect(whole(draft, "weekday", inputsWith("weekday", { reading_grade_soft: grade }))).toEqual([]);
    const justOver = whole(draft, "weekday", inputsWith("weekday", { reading_grade_soft: grade - 1e-9 }));
    expect(tell(justOver)).toEqual(["warning READING_LEVEL"]);
    // The hard limit: equal passes (with the soft warning), over fails (with no warning beside the error)
    const equal = whole(draft, "weekday", inputsWith("weekday", { reading_grade_max: grade }));
    expect(tell(equal)).toEqual(["warning READING_LEVEL"]);
    const over = whole(draft, "weekday", inputsWith("weekday", { reading_grade_max: grade - 1e-9 }));
    expect(tell(over)).toEqual(["error READING_LEVEL"]);
    // Neither limit is judged on the highest line alone: the Lead is read as one text, whose grade the message gives
    expect(over[0]!.message).toContain(grade.toFixed(2));
    const lines = draft.lead.map((l) => readingGrade(l.text));
    expect(Math.max(...lines)).not.toBeCloseTo(grade, 1);
  });
});

// ── The T cases ──────────────────────────────────────────────────────────────────────────────────

describe("the words group's T cases", () => {
  it("has named cases with unique names, each starting with the code it is about, which one of its errors (or, for a soft case, warnings) is", () => {
    expect(new Set(wordsNamed.map((c) => c.name)).size).toBe(wordsNamed.length);
    for (const c of wordsNamed) {
      expect(c.name.startsWith(`${c.code}: `), c.name).toBe(true);
      expect(MINE, c.name).toContain(c.code);
      expect([...c.expect.errors, ...c.expect.warnings], c.name).toContain(c.code);
      expect([...c.expect.errors], c.name).toEqual([...c.expect.errors].sort());
      expect([...c.expect.warnings], c.name).toEqual([...c.expect.warnings].sort());
      expect(EDITION_NAMES, c.name).toContain(c.edition);
    }
  });

  it("covers each code of the group in an F or a T case, each kind of case the table lists, and every edition", () => {
    for (const code of MINE) expect(wordsCases.some((c) => c.code === code) || wordsNamed.some((c) => c.code === code), code).toBe(true);
    for (const row of RULE_CODE_TABLE.filter((r) => r.group === "words")) {
      if (row.tests.includes("F")) expect(wordsCases.some((c) => c.code === row.code), `F ${row.code}`).toBe(true);
      if (row.tests.includes("T")) expect(wordsNamed.some((c) => c.code === row.code), `T ${row.code}`).toBe(true);
    }
    for (const edition of EDITION_NAMES) expect(wordsNamed.some((c) => c.edition === edition), edition).toBe(true);
  });

  it.each(wordsNamed.map((c) => [c.name, c] as const))("T %s", (_name, c) => {
    const draft = mutated(c);
    const issues = whole(draft, c.edition);
    expect({ errors: codesOf(issues, "error"), warnings: codesOf(issues, "warning") }).toEqual({ errors: [...c.expect.errors], warnings: [...c.expect.warnings] });
    // The group's own rules say the part that is theirs: all of it, since every code a T case expects is the group's
    const mine = own(draft, c.edition);
    expect(codesOf(mine, "error")).toEqual(c.expect.errors.filter((code) => MINE.includes(code)));
    expect(codesOf(mine, "warning")).toEqual(c.expect.warnings.filter((code) => MINE.includes(code)));
    // A small change of its edition's valid draft
    const changed = changedStrings(editionDraft(c.edition), draft);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThanOrEqual(T_CHANGES_MAX);
  });

  it("gives no issue of another code on any case: the whole validator and the group agree on every code", () => {
    for (const c of wordsNamed) {
      const issues = whole(mutated(c), c.edition);
      for (const i of issues) expect(MINE, `${c.name}: ${i.code} at ${i.path}`).toContain(i.code);
    }
  }, 60_000);
});

describe("the cases the spec names", () => {
  const monday = draftInputs("monday").context;
  const short = draftInputs("monday-short").context;
  const named = (needle: string): (typeof wordsNamed)[number] => {
    const hits = wordsNamed.filter((c) => c.name.includes(needle));
    expect(hits.length, needle).toBe(1);
    return hits[0]!;
  };

  it("has WORDS cases for the big picture at 100 words in the full week and 121 in the empty week, as SPEC §4.12 names them", () => {
    expect(monday.week!.findings.length).toBeGreaterThanOrEqual(3);
    expect(short.week!.findings).toEqual([]);
    const full = mutated(named("a big picture of 100 words in the full week")) as DraftBrief;
    const empty = mutated(named("a big picture of 121 words in the empty week")) as DraftBrief;
    expect(countWords(full.review!.big_picture)).toBe(100);
    expect(countWords(empty.review!.big_picture)).toBe(121);
    expect(named("a big picture of 100 words in the full week").edition).toBe("monday");
    expect(named("a big picture of 121 words in the empty week").edition).toBe("monday-short");
  });

  it("has a READING_LEVEL pair at the soft limit: the S file above 12 and at most 14, the F file above 14", () => {
    const { reading_grade_soft: soft, reading_grade_max: max } = fixtureConfig().run.budgets;
    const lead = (d: unknown): string => (d as DraftBrief).lead.map((l) => l.text).join(" ");
    const gradeOfS = readingGrade(lead(softDraft(wordsSoft[0]!)));
    const gradeOfF = readingGrade(lead(invalidDraft(wordsCases.find((c) => c.code === "READING_LEVEL")!)));
    expect(gradeOfS).toBeGreaterThan(soft);
    expect(gradeOfS).toBeLessThanOrEqual(max);
    expect(gradeOfF).toBeGreaterThan(max);
  });

  it("has NO_EM_DASH cases that fail an em dash in a finding's found and an en dash between letters in its title, as SPEC §4.12 names them", () => {
    const found = mutated(named("an em dash in a finding's `found`")) as DraftBrief;
    expect(found.new_findings.some((f) => f.explainer.found.includes(EM))).toBe(true);
    const title = mutated(named("an en dash between letters in a finding's title")) as DraftBrief;
    expect(title.new_findings.some((f) => f.title.includes(EN))).toBe(true);
  });

  it("has a HYPE_WORDS case for each plain hype word of config/hype-words.json, and the F case is the one word that is allowed in a Landmark's own text", () => {
    // The nine seed words come first; the plurals, spellings and derived forms after them are tested in tests/rules-words.test.ts and tests/config.test.ts.
    const words = fixtureConfig().hypeWords.en.slice(0, 9).filter((w) => w !== "breakthrough");
    expect(words.length).toBe(8);
    for (const word of words) {
      expect(wordsNamed.some((c) => c.code === "HYPE_WORDS" && c.name.includes(`"${word}" in`)), word).toBe(true);
    }
    expect(fixtureConfig().hypeWords.en).toContain("breakthrough");
    const f = invalidDraft(wordsCases.find((c) => c.code === "HYPE_WORDS")!) as DraftBrief;
    expect(f.lead[0]!.text).toContain("breakthrough");
    // The story is a Landmark, and the word is in the Lead, which no Landmark's own text includes
    expect(newFindingOf(f, I.story).significance).toBe("landmark");
  });

  it("has TERM_DEFINED cases for each of the rule's three tests: (a) an unlisted jargon word, (b) a listed term the explainer lacks, (c) a definition that uses jargon", () => {
    for (const test of ["(a)", "(b)", "(c)"]) expect(wordsNamed.some((c) => c.code === "TERM_DEFINED" && c.name.includes(` ${test} `)), test).toBe(true);
  });

  it("holds a jargon word of one field against a finding of another: the list is by field and the rule reads every word", () => {
    const jargon = fixtureConfig().jargon.words;
    const conjecture = jargon.find((w) => w.en === "conjecture")!;
    expect(conjecture.fields).toEqual(["mathematics"]);
    const draft = editionDraft("weekday");
    const biology = newFindingOf(draft, I.result);
    expect(biology.field).toBe("biology");
    biology.explainer.background = `${biology.explainer.background} A conjecture is a claim that nobody has proved.`;
    const issues = whole(draft, "weekday");
    expect(tell(issues)).toEqual(["error TERM_DEFINED"]);
    expect(issues[0]!.path).toBe("new_findings[1].explainer.background");
  });
});

// ── The boundary of each case ────────────────────────────────────────────────────────────────────

/** A draft that undoes a case's fault by the smallest change its own words name, and passes: the limit itself, the word as a Landmark's own, ... */
interface Neighbour {
  /** A needle that picks the T case it sits beside (its name holds it once). */
  of: string;
  name: string;
  edition: EditionName;
  mutate: (d: DraftBrief) => void;
  /** Inputs to change as well (a quote that is in the fetched text). */
  inputs?: (i: DraftInputs) => void;
  /** "words" for a neighbour that only the group's rules judge: another group's rule judges the quote it changes. Default: the whole validator. */
  judge?: "words";
}

const scroll = (d: DraftBrief) => newFindingOf(d, I.story);
const protein = (d: DraftBrief) => newFindingOf(d, I.result);
const retraction = (d: DraftBrief) => newFindingOf(d, I.setback);
const proof = (d: DraftBrief) => newFindingOf(d, I.claimed);

const NEIGHBOURS: readonly Neighbour[] = [
  // ── WORDS: each limit, met exactly ──
  { of: "a Lead of 61 words", name: "a Lead of 60 words in three sentences", edition: "weekday", mutate: (d) => { d.lead.forEach((l) => { l.text = grow(l.text, 5); }); } },
  { of: "a Lead of four sentences", name: "a Lead of three sentences", edition: "weekday", mutate: () => {} },
  { of: "a Lead of no sentence", name: "a Lead of one sentence", edition: "weekday", mutate: (d) => { d.lead = [d.lead[0]!]; } },
  { of: "`found` at 56 words", name: "the story's found at 55 words", edition: "weekday", mutate: (d) => { scroll(d).explainer.found = resize(scroll(d).explainer.found, 55); } },
  { of: "`matters` at 51 words", name: "the story's matters at 50 words", edition: "weekday", mutate: (d) => { scroll(d).explainer.matters = resize(scroll(d).explainer.matters, 50); } },
  { of: "`ai_helped` at 61 words", name: "the story's ai_helped at 60 words", edition: "weekday", mutate: (d) => { scroll(d).explainer.ai_helped = resize(scroll(d).explainer.ai_helped ?? "", 60); } },
  { of: "`how_sure` at 61 words", name: "the story's how_sure at 60 words", edition: "weekday", mutate: (d) => { scroll(d).explainer.how_sure = resize(scroll(d).explainer.how_sure, 60); } },
  { of: "story's `background` at 36 words", name: "the story's background at 35 words", edition: "weekday", mutate: (d) => { scroll(d).explainer.background = resize(scroll(d).explainer.background, 35); } },
  { of: "story's `could_lead` at 36 words", name: "the story's could_lead at 35 words", edition: "weekday", mutate: (d) => { scroll(d).explainer.could_lead = resize(scroll(d).explainer.could_lead, 35); } },
  {
    of: "six parts at 281 words", name: "the story's six parts at 280 words together", edition: "weekday",
    mutate: (d) => {
      const e = scroll(d).explainer;
      e.found = resize(e.found, 55);
      e.matters = resize(e.matters, 50);
      e.ai_helped = resize(e.ai_helped ?? "", 60);
      e.how_sure = resize(e.how_sure, 60);
      e.could_lead = resize(e.could_lead, 26);
    },
  },
  { of: "six parts at 229 words", name: "the story's six parts at 230 words together", edition: "weekday", mutate: (d) => { scroll(d).explainer.could_lead = resize(scroll(d).explainer.could_lead, 23); } },
  { of: "first four parts at 101 words", name: "an item's first four parts at 100 words", edition: "weekday", mutate: (d) => { protein(d).explainer.found = resize(protein(d).explainer.found, 45); } },
  { of: "first four parts at 69 words", name: "an item's first four parts at 70 words", edition: "weekday", mutate: (d) => { retraction(d).explainer.found = resize(retraction(d).explainer.found, 20); } },
  { of: "an item's `background` at 41 words", name: "an item's background at 40 words", edition: "weekday", mutate: (d) => { protein(d).explainer.background = resize(protein(d).explainer.background, 40); } },
  { of: "an item's `could_lead` at 41 words", name: "an item's could_lead at 40 words", edition: "weekday", mutate: (d) => { protein(d).explainer.could_lead = resize(protein(d).explainer.could_lead, 40); } },
  { of: "returning update of 61 words", name: "a returning update of 60 words", edition: "weekday", mutate: (d) => { d.returning[0]!.update = resize(d.returning[0]!.update, 60); } },
  { of: "an agent's rung change with a note of 26", name: "a rung note of 25 words", edition: "weekday", mutate: (d) => { d.rung_changes[0]!.rung.note = resize(d.rung_changes[0]!.rung.note ?? "", 25); } },
  {
    of: "a new finding's rung note of 26", name: "a rung note of 25 words in a new finding's history", edition: "weekday",
    mutate: (d) => { const entry = at(protein(d).rung_history, 1, "rung entry"); entry.note = resize(entry.note ?? "", 25); },
  },
  { of: "an idea line of 41 words", name: "an idea line of 40 words", edition: "weekday", mutate: (d) => { d.ideas[0]!.text = resize(d.ideas[0]!.text, 40); } },
  { of: "an Also noted title of 21 words", name: "an Also noted title of 20 words", edition: "weekday", mutate: (d) => { d.also[0]!.title = resize(d.also[0]!.title, 20); } },
  { of: "alt text of 41 words", name: "an alt text of 40 words", edition: "weekday", mutate: (d) => { scroll(d).figure!.alt = resize(scroll(d).figure!.alt, 40); } },
  {
    of: "definition of 41 words", name: "a definition of 40 words", edition: "weekday",
    mutate: (d) => { const t = at(proof(d).terms, 0, "term"); if (t.new) t.definition = resize(t.definition, 40); },
  },
  { of: "a correction's reason of 41 words", name: "a correction's reason of 40 words", edition: "weekday", mutate: (d) => { d.corrections[1]!.reason = resize(d.corrections[1]!.reason, 40); } },
  { of: "a report decision's reason of 41 words", name: "a report decision's reason of 40 words", edition: "weekday", mutate: (d) => { d.report_decisions[0]!.reason = resize(d.report_decisions[0]!.reason, 40); } },
  { of: "a correction's after at a finding's title of 13", name: "a correction's after at a finding's title of 12 words", edition: "weekday", mutate: (d) => { addCorrection(d, correctedFinding(d), "title", padding(12)); } },
  { of: "a correction's after at a finding's rung note of 26", name: "a correction's after at a rung note of 25 words", edition: "weekday", mutate: (d) => { addCorrection(d, correctedFinding(d), "rung_history.1.note", padding(25)); } },
  { of: "a correction's after at an idea line", name: "a correction's after at an idea line of 40 words", edition: "weekday", mutate: (d) => { addCorrection(d, CORRECTED_EDITION, "ideas.0.text", padding(40)); } },
  { of: "a correction's after at a glossary term's definition", name: "a correction's after at a definition of 40 words", edition: "weekday", mutate: (d) => { addCorrection(d, CORRECTED_TERM, "definition", padding(40)); } },
  { of: "a correction's after at the reason a brief lists", name: "a correction's after at a listed correction's reason of 40 words", edition: "weekday", mutate: (d) => { addCorrection(d, CORRECTED_EDITION, "corrections.0.reason", padding(40)); } },
  {
    of: "a correction's after at a finding's title of 13", name: "a correction's after at a Lead line of 40 words (the Lead's budget is its total: no row for one line)", edition: "weekday",
    mutate: (d) => { addCorrection(d, CORRECTED_EDITION, "lead.0.text", padding(40)); },
  },
  { of: "a Sunday deep dive of 449 words", name: "a Sunday deep dive of 450 words", edition: "sunday", mutate: (d) => { d.deep_dive!.text = resize(d.deep_dive!.text, 450); } },
  { of: "a Sunday deep dive of 551 words", name: "a Sunday deep dive of 550 words", edition: "sunday", mutate: (d) => { d.deep_dive!.text = resize(d.deep_dive!.text, 550); } },
  { of: "a big picture of 269 words", name: "a big picture of 270 words in the full week", edition: "monday", mutate: (d) => { d.review!.big_picture = resize(d.review!.big_picture, 270); } },
  { of: "a big picture of 331 words", name: "a big picture of 330 words in the full week", edition: "monday", mutate: (d) => { d.review!.big_picture = resize(d.review!.big_picture, 330); } },
  { of: "a big picture of 121 words", name: "a big picture of 120 words in the empty week", edition: "monday-short", mutate: (d) => { d.review!.big_picture = resize(d.review!.big_picture, 120); } },
  { of: "a remarkable note of 31 words", name: "a remarkable note of 30 words", edition: "monday", mutate: (d) => { d.review!.remarkable!.note = resize(d.review!.remarkable!.note, 30); } },
  { of: "a strongest-evidence-against text of 51 words", name: "a strongest-evidence-against text of 50 words", edition: "monday", mutate: (d) => { d.review!.strongest_against.text = resize(d.review!.strongest_against.text, 50); } },

  // ── SENTENCE_LENGTH: a sentence of 24 words, in each kind of model prose ──
  ...SENTENCE_SURFACES.map((s): Neighbour => ({ of: `${s.what} of 25 words`, name: `${s.what} of 24 words`, edition: s.edition, mutate: (d) => s.set(d, 24) })),

  // ── HYPE_WORDS: "breakthrough" in a Landmark's own text, and a name or a title that holds a hype word ──
  { of: "\"a breakthrough\" in a Notable finding's title", name: "the same word in a Landmark's title", edition: "weekday", mutate: (d) => { scroll(d).title = "SAMPLE: A breakthrough reads a sealed scroll without opening it"; } },
  { of: "\"the breakthrough of the year\" in a Notable finding's found", name: "the word in a Landmark's found", edition: "weekday", mutate: (d) => { scroll(d).explainer.found = `${scroll(d).explainer.found} It is a breakthrough.`; } },
  { of: "\"a breakthrough\" in a Major finding's how_sure", name: "the word in a Landmark's how_sure", edition: "weekday", mutate: (d) => { scroll(d).explainer.how_sure = `${scroll(d).explainer.how_sure} It is a breakthrough.`; } },
  { of: "\"a breakthrough\" in a Major finding's how_sure", name: "the word in a Landmark's matters", edition: "weekday", mutate: (d) => { scroll(d).explainer.matters = `${scroll(d).explainer.matters} A breakthrough result.`; } },
  { of: "\"a breakthrough\" in a Major finding's how_sure", name: "the word in a Landmark's could_lead", edition: "weekday", mutate: (d) => { scroll(d).explainer.could_lead = `${scroll(d).explainer.could_lead} It is a breakthrough.`; } },
  { of: "\"a breakthrough\" in a Notable finding's rung note", name: "the word in a Landmark's rung note", edition: "weekday", mutate: (d) => { at(scroll(d).rung_history, 0, "rung entry").note = "A breakthrough reading."; } },
  { of: "\"a breakthrough\" in a Major finding's how_sure", name: "the word in a Landmark's figure alt text", edition: "weekday", mutate: (d) => { scroll(d).figure!.alt = `${scroll(d).figure!.alt} A breakthrough.`; } },
  {
    of: "\"a breakthrough\" in a correction's after on a Major finding's how_sure", name: "the word in a correction's after at a Landmark's explainer.background", edition: "weekday",
    mutate: (d) => { d.corrections[0]!.after = `${d.corrections[0]!.after} It is a breakthrough.`; },
  },
  {
    of: "\"a breakthrough\" in a returning update on a Notable finding", name: "the word in a returning update on a Landmark finding", edition: "weekday",
    mutate: (d) => {
      d.items = d.items.map((id) => (id === "soc-2026-0145" ? "math-2026-0140" : id));
      for (const l of d.lead) l.refs = l.refs.map((id) => (id === "soc-2026-0145" ? "math-2026-0140" : id));
      d.returning[0]!.finding_id = "math-2026-0140";
      d.returning[0]!.update = `${d.returning[0]!.update} It is a breakthrough.`;
    },
  },
  {
    of: "\"a breakthrough\" in the deep dive on a Major finding", name: "the word in the deep dive on a Landmark finding", edition: "sunday",
    mutate: (d) => { d.deep_dive!.finding_id = "math-2026-0140"; d.deep_dive!.why_today = "rotation"; d.deep_dive!.text = `${d.deep_dive!.text} It is a breakthrough.`; },
  },
  {
    of: "\"a breakthrough\" in the remarkable note on a Major finding", name: "the word in the remarkable note on a Landmark finding", edition: "monday",
    mutate: (d) => {
      d.review!.remarkable!.finding_id = "math-2026-0140";
      d.review!.remarkable!.note = swap(d.review!.remarkable!.note, "new antibiotic", "breakthrough antibiotic");
    },
  },
  ...fixtureConfig().hypeWords.names.map((n): Neighbour => ({
    of: "a masked name does not shield a second use", name: `the name "${n.en}" in a Major finding's how_sure, masked before the words are read`, edition: "weekday",
    mutate: (d) => { protein(d).explainer.how_sure = `${protein(d).explainer.how_sure} The ${n.en} committee has not weighed in.`; },
  })),
  { of: "a hype word in capitals", name: "a hype word in a who name (a name keeps its own words)", edition: "weekday", mutate: (d) => { scroll(d).who[0]!.name = "Revolutionary Group (SAMPLE)"; } },
  { of: "a hype word in capitals", name: "a hype word in a reaction's affiliation", edition: "weekday", mutate: (d) => { scroll(d).reactions[0]!.affiliation = "Groundbreaking University (SAMPLE)"; } },
  { of: "a hype word in capitals", name: "a hype word in a source's title (a source's title keeps its own words)", edition: "weekday", mutate: (d) => { proof(d).sources[0]!.title = "SAMPLE: A stunning preprint, unprecedented in its scope"; } },

  // ── TERM_DEFINED: the jargon word listed and used ──
  {
    of: "(a) a jargon word with a capital letter", name: "the word listed as a term, with a definition, and used", edition: "weekday",
    mutate: (d) => {
      protein(d).explainer.ai_helped = "Halden Research built the model, Halden Fold, which is a transformer. It posted its prediction before anyone had measured the complex.";
      protein(d).terms.push({ new: true, term: "transformer", definition: "A kind of AI model that weighs every part of its input against every other part." });
    },
  },

  // ── NO_EM_DASH: the text kept as published, and the dashes that are not forbidden ──
  { of: "an em dash in a finding's `found`", name: "an em dash in a source's title (kept as published)", edition: "weekday", mutate: (d) => { proof(d).sources[0]!.title = `SAMPLE: A preprint ${EM} with a dash`; } },
  { of: "an en dash between letters in a finding's title", name: "an en dash between letters in a source's title (kept as published)", edition: "weekday", mutate: (d) => { proof(d).sources[0]!.title = `SAMPLE: A preprint${EN}with a dash`; } },
  { of: "an em dash in a finding's `found`", name: "an em dash in a reaction's quote (kept as published)", edition: "weekday", judge: "words", mutate: (d) => { scroll(d).reactions[0]!.quote = `${scroll(d).reactions[0]!.quote} ${EM} said`; } },
  { of: "an em dash in a finding's `found`", name: "an en dash between letters in a reaction's quote", edition: "weekday", judge: "words", mutate: (d) => { scroll(d).reactions[0]!.quote = `${scroll(d).reactions[0]!.quote} and${EN}so`; } },
  { of: "an em dash in a finding's `found`", name: "an em dash in an evidence quote (kept as published)", edition: "weekday", judge: "words", mutate: (d) => { const e = at(proof(d).ai.evidence, 0, "evidence entry"); e.quote = `${e.quote} ${EM} more`; } },
  { of: "an em dash in a finding's `found`", name: "an em dash in a figure's licence quote (kept as published)", edition: "weekday", judge: "words", mutate: (d) => { scroll(d).figure!.licence_quote = `${scroll(d).figure!.licence_quote} ${EM} more`; } },
  { of: "an en dash between letters in a finding's title", name: "an en dash between digits in a who name (a range of numbers)", edition: "weekday", mutate: (d) => { scroll(d).who[0]!.name += ` (2024${EN}2025)`; } },
  { of: "an em dash in an idea line", name: "a hyphen (U+2010), which is not a dash the rule reads", edition: "weekday", mutate: (d) => { d.ideas[0]!.text = `${d.ideas[0]!.text} A well${String.fromCharCode(0x2010)}known tool.`; } },
];

describe("the boundary of each case", () => {
  const needle = (n: Neighbour): (typeof wordsNamed)[number] => {
    const hits = wordsNamed.filter((c) => c.name.includes(n.of));
    expect(hits.length, `${n.of}: the cases it names`).toBeGreaterThan(0);
    return hits[0]!;
  };

  it("names, for each neighbour, a case that exists", () => {
    for (const n of NEIGHBOURS) expect(wordsNamed.some((c) => c.name.includes(n.of)), n.of).toBe(true);
    expect(NEIGHBOURS.length).toBeGreaterThan(60);
  });

  it("puts each neighbour in its case's own edition, or in the edition its words name", () => {
    for (const n of NEIGHBOURS) {
      const c = needle(n);
      if (!n.of.includes("a hype word in capitals") && !n.of.includes("a masked name")) expect(n.edition, `${n.name} (beside ${c.name})`).toBe(c.edition);
    }
  });

  it.each(NEIGHBOURS.map((n) => [`${n.name} (beside ${n.of})`, n] as const))("passes: %s", (_label, n) => {
    const draft = editionDraft(n.edition);
    n.mutate(draft);
    const inputs = draftInputs(n.edition);
    n.inputs?.(inputs);
    expect(own(draft, n.edition, inputs)).toEqual([]);
    if (n.judge !== "words") expect(whole(draft, n.edition, inputs)).toEqual([]);
  });

  it.each(EDITION_NAMES.map((e) => [e] as const))("the valid %s draft passes the group's rules and every rule", (edition) => {
    const draft = editionDraft(edition);
    expect(own(draft, edition)).toEqual([]);
    expect(whole(draft, edition)).toEqual([]);
  });

  it("holds the Landmark's exemption to the word it names: the neighbours say \"breakthrough\" and the cases beside them say it elsewhere", () => {
    const hype = NEIGHBOURS.filter((n) => n.name.includes("Landmark") || n.name.includes("correction's after at a Landmark"));
    expect(hype.length).toBeGreaterThanOrEqual(9);
    for (const n of hype) {
      const draft = editionDraft(n.edition);
      n.mutate(draft);
      expect(JSON.stringify(draft).toLowerCase(), n.name).toContain("breakthrough");
    }
  });
});

// ── What the cases add ───────────────────────────────────────────────────────────────────────────

describe("what the words cases add to a valid draft", () => {
  const all = [
    ...wordsCases.map((c) => ({ code: c.code, label: `F ${c.code}`, edition: c.edition ?? "weekday", draft: invalidDraft(c) })),
    ...wordsSoft.map((c) => ({ code: c.code, label: `S ${c.code}`, edition: c.edition ?? "weekday", draft: softDraft(c) })),
    ...wordsNamed.map((c) => ({ code: c.code, label: `T ${c.name}`, edition: c.edition, draft: mutated(c) })),
  ];
  /** The names a case may use: the valid draft's, and the proper names of config/hype-words.json (a name that holds a hype word). */
  const known = (edition: EditionName): Set<string> =>
    new Set([...namesIn(leaves(editionDraft(edition)).join(". ")), ...fixtureConfig().hypeWords.names.flatMap((n) => n.en.split(" "))]);

  it("is invented text only: no link, no name the valid draft does not use, nothing longer than a deep dive", () => {
    let count = 0;
    for (const { label, edition, draft } of all) {
      const names = known(edition);
      for (const s of added(editionDraft(edition), draft)) {
        count += 1;
        expect(s, label).not.toMatch(/https?:|www\.|\.(com|org|net|edu|io)\b/i);
        expect(countWords(s), label).toBeLessThanOrEqual(1200);
        for (const name of namesIn(s)) expect(names.has(name) || name === "SAMPLE", `${label}: ${name}`).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(120);
  });

  it("holds an em dash or an en dash only in the NO_EM_DASH cases, and in each of them", () => {
    for (const { code, label, draft } of all) {
      const dashes = dashesIn(JSON.stringify(draft));
      if (code === "NO_EM_DASH") expect(dashes.length, label).toBeGreaterThan(0);
      else expect(dashes, label).toEqual([]);
    }
  });

  it("holds no em dash and no lonely en dash in the fixture source or in this file", () => {
    for (const file of ["fixtures/src/invalid/words.ts", "tests/fixtures-words.test.ts"]) {
      const source = readFileSync(join(REPO_ROOT, file), "utf8");
      expect(source.includes(EM), file).toBe(false);
      // An en dash only between digits (a range)
      expect(source.replace(new RegExp(`(?<=\\d)${EN}(?=\\d)`, "g"), "").includes(EN), file).toBe(false);
    }
  });

  it("gives the same draft each time, and leaves each edition's valid draft as it was", () => {
    const before = EDITION_NAMES.map((e) => JSON.stringify(editionDraft(e)));
    for (const c of wordsCases) expect(JSON.stringify(invalidDraft(c)), c.code).toBe(JSON.stringify(invalidDraft(c)));
    for (const c of wordsSoft) expect(JSON.stringify(softDraft(c)), c.code).toBe(JSON.stringify(softDraft(c)));
    for (const c of wordsNamed) expect(JSON.stringify(mutated(c)), c.name).toBe(JSON.stringify(mutated(c)));
    expect(EDITION_NAMES.map((e) => JSON.stringify(editionDraft(e)))).toEqual(before);
  });

  it("builds its long sentences and paddings to the length it says", () => {
    expect(countWords(longSentence(24))).toBe(24);
    expect(countWords(longSentence(25))).toBe(25);
    expect(longSentence(25).startsWith("SAMPLE")).toBe(true);
    expect(countWords(resize("One two three. Four five six seven.", 12))).toBe(12);
    expect(() => swap("abc", "xyz", "q")).toThrow(/no xyz/);
    expect(() => at([1], 3, "thing")).toThrow(/no thing/);
  });
});
