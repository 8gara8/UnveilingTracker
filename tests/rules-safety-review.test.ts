// Tests added by the independent review of the safety rules (SPEC §4.12; lib/rules/safety.ts). tests/rules-safety.test.ts holds the author's
// tests of each sentence of the four rows; this file holds what the review adds and what the author's file does not run:
//   the fixtures of the group    each F and T case of fixtures/src/invalid/safety.ts, run through the whole validator and through the
//                                group's own rules, with the clause each one is meant to reach and the place it fails at
//   the fixtures are safe        what every case adds is made up and marked: sequences are repeats or the alphabet in order, an agent
//                                word stands only in a sentence that says it is a sample, an address is a shortener, a secret is a sample
//   a case of each reading       the readings the review settled that the spec leaves open (the case of a unit, a sequence in any
//                                layout), run through the whole validator
//   a long string                every code of the group on a string of 100,000 characters of each kind that once made a pattern backtrack
// The worlds are the sample editions of fixtures/src (the weekday, Sunday and Monday drafts with their own inputs), and each test runs the
// group's own rules unless it says the whole validator, so another group's rules cannot change a result. Everything a test writes is
// invented. Dashes in text are built from code points, so that none is typed in this file.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EDITION_NAMES, REPO_ROOT, type EditionName } from "../fixtures/src/world";
import { invalidDraft, invalidOutputs } from "../fixtures/src/build";
import {
  AGENT_PROCEDURE_SAMPLE, AGENT_QUANTITY_LOWER_SAMPLE, AGENT_QUANTITY_SAMPLE, AMINO_ROW_SAMPLE, BULLET_STEPS_SAMPLE, DATABASE_LINE_SAMPLE,
  FIVE_BLOCKS_SAMPLE, GENBANK_SAMPLE, SPLIT_NUCLEOTIDE_SAMPLE, STEPS_SAMPLE, UNIPROT_SAMPLE, safetyCases, safetyNamed, safetySoft,
} from "../fixtures/src/invalid/safety";
import { editionDraft } from "../fixtures/src/drafts";
import { draftInputs } from "../fixtures/src/inputs";
import { RULE_CODE_TABLE, codesOfGroup } from "../lib/rules/index";
import { buildDraftInput, runRules } from "../lib/rules/run";
import { blockedUrlsIn, dualUseForms, pairsIn, safetyRules, secretsIn, sequencesIn, stepMarkersIn } from "../lib/rules/safety";
import type { ValidationIssue } from "../lib/rules/types";
import { DraftBrief } from "../lib/schema/draft";
import { splitSentences } from "../lib/text";
import { validateDraft } from "../lib/validate";
import { CANARY_TOKEN } from "../lib/vocab";
import { config, type Json } from "./helpers/rule-world";

// ── The sample world ─────────────────────────────────────────────────────────────────────────────

/** Characters of a layout that only a model's own output holds, built from code points so that none is typed in this file. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const BULLET = String.fromCharCode(0x2022);

/** The valid draft of an edition as plain JSON. */
const plain = (edition: EditionName): Json => JSON.parse(JSON.stringify(editionDraft(edition))) as Json;

/** A case's draft: a fresh copy of its edition's valid draft, mutated. */
const mutated = (c: { edition?: EditionName; mutate: (draft: ReturnType<typeof editionDraft>) => unknown }): Json => {
  const draft = editionDraft(c.edition ?? "weekday");
  const out = c.mutate(draft);
  return JSON.parse(JSON.stringify(out === undefined ? draft : out)) as Json;
};

/** The group's own rules on a draft, and the whole validator on it: a result of the first never holds another group's code. */
const own = (draft: unknown, edition: EditionName): ValidationIssue[] =>
  runRules(buildDraftInput(DraftBrief.parse(draft), draftInputs(edition)), safetyRules);
const whole = (draft: unknown, edition: EditionName): ValidationIssue[] => validateDraft(draft, draftInputs(edition)).issues;

const ofCode = (issues: readonly ValidationIssue[], code: string): ValidationIssue[] => issues.filter((i) => i.code === code);
const tell = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.severity} ${i.code}`);
const codesOf = (issues: readonly ValidationIssue[], severity: string): string[] =>
  [...new Set(issues.filter((i) => i.severity === severity).map((i) => i.code))].sort();

/** The paths at which two JSON values differ, as `a.b[0].c`; an array's missing element counts as a difference. */
function changedPaths(a: unknown, b: unknown, path = ""): string[] {
  if (Array.isArray(a) && Array.isArray(b)) {
    return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => changedPaths(a[i], b[i], `${path}[${i}]`)).flat();
  }
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => changedPaths((a as Json)[k], (b as Json)[k], path === "" ? k : `${path}.${k}`));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [path];
}

/** Every string of a JSON value that a base value does not hold, whole: what a case adds, with the base text it extends. */
function addedStrings(base: unknown, changed: unknown): string[] {
  const leaves = (v: unknown): string[] => {
    if (typeof v === "string") return [v];
    if (Array.isArray(v)) return v.flatMap(leaves);
    if (typeof v === "object" && v !== null) return Object.values(v).flatMap(leaves);
    return [];
  };
  const before = new Map<string, number>();
  for (const s of leaves(base)) before.set(s, (before.get(s) ?? 0) + 1);
  const out: string[] = [];
  for (const s of leaves(changed)) {
    const n = before.get(s) ?? 0;
    if (n > 0) before.set(s, n - 1);
    else out.push(s);
  }
  return out;
}

// ── The fixtures of the group ────────────────────────────────────────────────────────────────────

describe("the fixtures of the safety group", () => {
  const MINE = codesOfGroup("safety");
  /** The issue path an F case fails at, one pattern for each code. */
  const WHERE: Record<string, RegExp> = {
    DUAL_USE: /^sources\[\d+\]\.title$/,
    SECRET_LIKE: /^new_findings\[\d+\]\.figure\.credit$/,
    CANARY: /^ideas\[\d+\]\.who$/,
    BLOCKED_HOST: /^ideas\[\d+\]\.text$/,
  };
  /** A fragment of the message of the clause an F case is meant to reach. */
  const F_CLAUSE: Record<string, string> = {
    DUAL_USE: "holds a nucleotide sequence of 24 letters",
    SECRET_LIKE: "holds a string shaped like an sk- secret key",
    CANARY: "holds the canary string planted in a test page",
    BLOCKED_HOST: "whose host is on the blocked list (t.co: a link shortener)",
  };
  /** The clause a T case is meant to reach, by its name; the first pattern that matches is the case's. */
  const T_CLAUSE: [RegExp, string][] = [
    [/^DUAL_USE: a sequence in UniProt's layout/, "holds an amino-acid sequence of 20 letters"],
    [/^DUAL_USE: a row of twenty amino-acid capitals/, "holds an amino-acid sequence of 20 letters"],
    [/^DUAL_USE: a sequence of twenty nucleotide letters across a single space/, "holds a nucleotide sequence of 20 letters"],
    [/^DUAL_USE: a sequence of twenty nucleotide letters split by a no-break space/, "holds a nucleotide sequence of 20 letters"],
    // The nucleotide pattern reads a database line whose blocks are split by two spaces too, since a run of white space is one separator
    [/^DUAL_USE: a database line of the letters acgt whose blocks are split by two spaces/, "holds a nucleotide sequence of 30 letters"],
    [/^DUAL_USE: a sequence in capital blocks of five/, "holds an amino-acid sequence of 20 letters"],
    [/^DUAL_USE: a sequence in /, "holds a nucleotide sequence of 20 letters"],
    [/^DUAL_USE: numbered steps in the Sunday deep dive/, "holds 2 numbered steps (1., 2.), which the deep dive on a biology or chemistry finding may not hold"],
    [/^DUAL_USE: numbered steps in the Monday big picture/, "holds 2 numbered steps (Step 1, Step 2), which the big picture may not hold"],
    [/^DUAL_USE: numbered steps in a stored physics finding's correction/, "which text about a biology or chemistry finding may not hold"],
    [/^DUAL_USE: numbered steps/, "which a biology or chemistry finding may not hold"],
    [/^DUAL_USE: an agent term and a procedure word/, 'holds "anthrax" with the method word "synthesis route"'],
    [/^DUAL_USE: an agent term and a quantity whose unit is written in lower case/, 'holds "anthrax" with the quantity "5 ml"'],
    [/^DUAL_USE: an agent term and a quantity/, 'holds "anthrax" with the quantity "5 mg"'],
    [/^SECRET_LIKE: an AWS/, "holds a string shaped like an AWS access key id"],
    [/^SECRET_LIKE: a GitHub/, "holds a string shaped like a GitHub token"],
    [/^SECRET_LIKE: the first line of a private key/, "holds a string shaped like a private key block"],
    [/^SECRET_LIKE: a key string/, "holds a string shaped like an sk- secret key"],
    [/^CANARY: /, "holds the canary string planted in a test page"],
    [/^BLOCKED_HOST: /, "whose host is on the blocked list ("],
  ];

  it("has one F case for each code of the group, in the table's order, each filed as invalid--CODE.json", () => {
    expect(safetyCases.map((c) => c.code)).toEqual(MINE);
    for (const c of safetyCases) expect(c.file, c.code).toBe(`invalid--${c.code}.json`);
    expect(new Set(safetyCases.map((c) => c.file)).size).toBe(safetyCases.length);
  });

  it("has no S case, because every code of the group is hard and the table lists no S fixture for any of them", () => {
    expect(safetySoft).toEqual([]);
    for (const code of MINE) {
      const info = RULE_CODE_TABLE.find((r) => r.code === code)!;
      expect(info.severity, code).toBe("H");
      expect(info.tests, code).toContain("F");
      expect(info.tests, code).not.toContain("S");
    }
  });

  it("has a T case for each code the table lists a T fixture for, and for the others too (the table's Z fixtures are the Chinese stage's)", () => {
    for (const code of MINE) {
      const info = RULE_CODE_TABLE.find((r) => r.code === code)!;
      if (info.tests.includes("T")) expect(safetyNamed.some((c) => c.code === code), code).toBe(true);
    }
    expect(RULE_CODE_TABLE.find((r) => r.code === "DUAL_USE")!.tests).toContain("T");
  });

  it.each(safetyCases.map((c) => [c.code, c] as const))("F %s: fails validateDraft() with exactly its code, at the place it names, by a small change", (code, c) => {
    const edition = c.edition ?? "weekday";
    const draft = invalidDraft(c);
    const issues = whole(draft, edition);
    expect(tell(issues)).toEqual([`error ${code}`]);
    expect(issues[0]!.path).toMatch(WHERE[code]!);
    expect(issues[0]!.message).toContain(F_CLAUSE[code]!);
    expect(tell(own(draft, edition))).toEqual([`error ${code}`]);
    expect(changedPaths(editionDraft(edition), draft).length).toBeLessThanOrEqual(3);
  });

  it.each(safetyCases.map((c) => [c.code, c] as const))("F %s: its file in fixtures/drafts/ is the builder's output and fails the same way", (code, c) => {
    const { path, text } = invalidOutputs([c])[0]!;
    expect(readFileSync(join(REPO_ROOT, path), "utf8")).toBe(text);
    expect(tell(whole(JSON.parse(text), c.edition ?? "weekday"))).toEqual([`error ${code}`]);
  });

  it("has named cases with unique names, each starting with the code it is about, which one of its results holds", () => {
    expect(new Set(safetyNamed.map((c) => c.name)).size).toBe(safetyNamed.length);
    for (const c of safetyNamed) {
      expect(c.name.startsWith(`${c.code}: `), c.name).toBe(true);
      expect(MINE, c.name).toContain(c.code);
      expect([...c.expect.errors, ...c.expect.warnings], c.name).toContain(c.code);
      expect([...c.expect.errors], c.name).toEqual([...c.expect.errors].sort());
      expect([...c.expect.warnings], c.name).toEqual([...c.expect.warnings].sort());
      expect(EDITION_NAMES, c.name).toContain(c.edition);
    }
  });

  it("covers each code of the group, and the Sunday and the Monday, whose prose only those editions carry", () => {
    for (const code of MINE) expect(safetyNamed.some((c) => c.code === code), code).toBe(true);
    for (const edition of ["weekday", "sunday", "monday"]) expect(safetyNamed.some((c) => c.edition === edition), edition).toBe(true);
  });

  it("holds a case for each kind of sequence, each form of a numbered step, both halves of the sentence test and each kind of place", () => {
    const names = safetyNamed.map((c) => c.name).join("\n");
    for (const part of [
      "UniProt's layout", "row of twenty amino-acid", "across a single space", "split by two spaces", "a figure's credit",
      "split by a no-break space, a tab and a double space", "capital blocks of five split by a no-break space and an ideographic space",
      "list bullets and a line separator", "Sunday deep dive", "Monday big picture (Step N)", "(2) form", "1) 2)", "stored physics finding's correction",
      "a procedure word", "a quantity with a unit", "written in lower case (5 ml)",
      "an AWS access key id", "a GitHub token", "a private key block", "a key string in prose",
      "the token in lower case", "the token in the Lead", "the token in the Sunday deep dive",
      "without a scheme", "another scheme (http)", "a path entry", "a source's address on a shortener", "a brief source's address",
      "a correction's source address", "a figure's image", "Sunday deep dive", "Monday big picture",
    ]) expect(names, part).toContain(part);
  });

  it.each(safetyNamed.map((c) => [c.name, c] as const))("T %s", (_name, c) => {
    const draft = mutated(c);
    const issues = whole(draft, c.edition);
    expect({ errors: codesOf(issues, "error"), warnings: codesOf(issues, "warning") }).toEqual({ errors: [...c.expect.errors], warnings: [...c.expect.warnings] });
    // The group's own rules say the part that is theirs: the code of the case, once, and nothing else
    const mine = own(draft, c.edition);
    expect(codesOf(mine, "error")).toEqual([c.code]);
    expect(codesOf(mine, "warning")).toEqual([]);
    const found = ofCode(mine, c.code);
    expect(found.map((i) => `${i.path}: ${i.message}`)).toHaveLength(1);
    const clause = T_CLAUSE.find(([pattern]) => pattern.test(c.name));
    expect(clause, `no clause for ${c.name}`).toBeDefined();
    expect(found[0]!.message).toContain(clause![1]);
    // A small change of a valid draft: a few strings and a few corrections at most
    expect(changedPaths(editionDraft(c.edition), draft).length).toBeLessThanOrEqual(5);
  });

  it("puts each T case's fault at the place the case names, and no other string of the draft changes its result", () => {
    const places: [RegExp, RegExp][] = [
      [/^DUAL_USE: numbered steps in the Sunday deep dive/, /^deep_dive\.text$/],
      [/^DUAL_USE: numbered steps in the Monday big picture/, /^review\.big_picture$/],
      [/^DUAL_USE: numbered steps in a stored physics finding's correction/, /^corrections\[\d+\]\.after$/],
      [/^CANARY: the token in the Lead/, /^lead\[0\]\.text$/],
      [/^CANARY: the token in the Sunday deep dive/, /^deep_dive\.text$/],
      [/^BLOCKED_HOST: a correction's source address/, /^corrections\[0\]\.source_url$/],
      [/^BLOCKED_HOST: a figure's image/, /^new_findings\[0\]\.figure\.image_url$/],
      [/^BLOCKED_HOST: a brief source's address/, /^sources\[\d+\]\.url$/],
      [/^BLOCKED_HOST: a source's address on a shortener/, /^new_findings\[0\]\.sources\[\d+\]\.url$/],
      [/^BLOCKED_HOST: a blocked host in the Sunday deep dive/, /^deep_dive\.text$/],
      [/^BLOCKED_HOST: a blocked host in the Monday big picture/, /^review\.big_picture$/],
    ];
    for (const [name, where] of places) {
      const c = safetyNamed.find((n) => name.test(n.name))!;
      expect(own(mutated(c), c.edition).map((i) => i.path)[0], c.name).toMatch(where);
    }
  });
});

// ── What the fixtures add is safe ────────────────────────────────────────────────────────────────

describe("what the fixtures of the safety group add is made up, marked and harmless (AGENTS rule 10)", () => {
  const forms = dualUseForms(config().dualUse);
  const ALLOWED_HOSTS = ["t.co", "bit.ly", "tinyurl.com", "www.google.com"];
  const cases = [
    ...safetyCases.map((c) => ({ name: `F ${c.code}`, edition: c.edition ?? ("weekday" as EditionName), draft: mutated(c) })),
    ...safetyNamed.map((c) => ({ name: `T ${c.name}`, edition: c.edition, draft: mutated(c) })),
  ];
  const wordsOf = (text: string): string[] => text.split(/[^A-Za-z]+/).filter((w) => w !== "").map((w) => w.toLowerCase());
  const baseWords = (edition: EditionName): Set<string> => new Set(addedStrings({}, plain(edition)).flatMap(wordsOf));
  const added = cases.flatMap((c) => {
    const known = baseWords(c.edition);
    return addedStrings(plain(c.edition), c.draft).map((text) => ({ name: c.name, text, known }));
  });

  it("adds something in every case, and only a little: a few strings, and in each a short part that the valid draft does not hold", () => {
    for (const c of cases) {
      const strings = addedStrings(plain(c.edition), c.draft);
      expect(strings.length, c.name).toBeGreaterThan(0);
      // Three corrections of the refile case are five strings each: the most any case adds
      expect(strings.length, c.name).toBeLessThanOrEqual(15);
    }
    // A case that extends a string of the draft adds its new part: the string without the longest base string it begins with
    const bases = cases.flatMap((c) => addedStrings({}, plain(c.edition)));
    for (const { name, text } of added) {
      const base = bases.filter((b) => text.startsWith(b)).sort((a, b) => b.length - a.length)[0] ?? "";
      expect(text.length - base.length, `${name}: ${text.slice(base.length, base.length + 60)}`).toBeLessThan(400);
    }
  });

  it("writes a sequence only as a stretch of an endless repeat of the four DNA letters or of the twenty amino-acid letters in the alphabet's order", () => {
    const stretchOf = (letters: string, unit: string): boolean => unit.repeat(Math.ceil(letters.length / unit.length) + 1).includes(letters);
    const DNA = "acgt";
    const ALPHABET = "acdefghiklmnpqrstvwy";
    const bare = (text: string): string => text.replace(/[^A-Za-z]/g, "").toLowerCase();
    const body = (sample: string): string => sample.replace(/^SAMPLE: a (?:sequence|protein) note/, "");
    for (const sample of [GENBANK_SAMPLE, DATABASE_LINE_SAMPLE, SPLIT_NUCLEOTIDE_SAMPLE]) expect(stretchOf(bare(body(sample)), DNA), sample).toBe(true);
    for (const sample of [UNIPROT_SAMPLE, AMINO_ROW_SAMPLE, FIVE_BLOCKS_SAMPLE]) expect(stretchOf(bare(body(sample)), ALPHABET), sample).toBe(true);
    // And no string a case adds holds a new word of 10 letters or more, all of them letters of a sequence, that is not one of these
    // (an ordinary word can spell ten such letters, "resistance", and the valid draft's own words are left out)
    for (const { name, text, known } of added) {
      for (const letters of wordsOf(text)) {
        if (!/^[acdefghiklmnpqrstvwy]{10,}$/.test(letters) || known.has(letters)) continue;
        expect(stretchOf(letters, DNA) || stretchOf(letters, ALPHABET), `${name}: ${letters}`).toBe(true);
      }
    }
  });

  it("names an agent beside a procedure word or a quantity only in a sentence that says it is a sample and gives no method", () => {
    expect(AGENT_PROCEDURE_SAMPLE).toMatch(/^SAMPLE sentence for a test: /);
    expect(AGENT_QUANTITY_SAMPLE).toMatch(/^SAMPLE sentence for a test: /);
    expect(AGENT_QUANTITY_LOWER_SAMPLE).toMatch(/^SAMPLE sentence for a test: /);
    for (const { name, text } of added) {
      for (const sentence of splitSentences(text)) {
        if (pairsIn(sentence, forms).length === 0) continue;
        expect(sentence, name).toMatch(/^SAMPLE sentence for a test: it names \w+ and (?:a synthesis route|5 mg|5 ml)\.$/);
      }
    }
  });

  it("lists the numbered steps of a case as the washing of a dish", () => {
    expect(STEPS_SAMPLE).toBe("SAMPLE steps for a test, not a method.\n1. Wash the dish.\n2. Count the dishes.");
    expect(BULLET_STEPS_SAMPLE).toBe(`${LINE_SEPARATOR}${BULLET} 1. Wash the dish.${LINE_SEPARATOR}${BULLET} 2. Count the dishes.`);
    // A first marker starts the text, a line, a sentence or a list item: after a line feed, a line separator, a full stop or a bullet
    const first = new RegExp(`(?:^|\\n|${LINE_SEPARATOR}|\\. |${BULLET} )(?:1[.)]|\\(1\\)|Step 1)`);
    for (const { name, text } of added) {
      if (!first.test(text)) continue;
      expect(text, name).toMatch(/Wash the dish/);
      expect(text, name).toMatch(/Count the dishes/);
    }
  });

  it("puts only link shorteners, a redirect through google.com/url and the sample's own pages in an address", () => {
    for (const { name, text } of added) {
      for (const hit of blockedUrlsIn(text)) {
        const host = hit.url.replace(/^[a-z]+:\/\//i, "").split(/[/?:]/)[0]!.toLowerCase();
        expect(ALLOWED_HOSTS, `${name}: ${hit.url}`).toContain(host);
        expect(hit.entry.reason, `${name}: ${hit.url}`).toMatch(/^(?:shortener|redirect)$/);
      }
    }
    for (const { name, text } of added) expect(text, name).not.toMatch(/sci-hub|libgen|annas-archive|pastebin|shodan|\.onion|t\.me/i);
  });

  it("holds a secret only as a SAMPLE string joined at run time, and the canary only as the planted token", () => {
    const secrets = added.filter((a) => secretsIn(a.text).length > 0);
    expect(secrets.length).toBeGreaterThanOrEqual(5);
    for (const { name, text } of secrets) {
      // the header is joined here so that no secret-shaped literal sits in this file
      if (/PRIVATE KEY-----/.test(text)) expect(text, name).toBe(`SAMPLE: ${["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ")}`);
      else expect(text, name).toMatch(/UTSAMPLE/);
    }
    for (const { name, text } of added) {
      if (!text.toLowerCase().includes(CANARY_TOKEN.toLowerCase())) continue;
      expect(text.replace(new RegExp(CANARY_TOKEN, "gi"), ""), name).not.toMatch(/UT-CANARY/i);
    }
  });

  it("is plain English with no dash of the long kind, and en dashes only between digits", () => {
    const EM = String.fromCharCode(0x2014);
    const EN_NOT_BETWEEN_DIGITS = new RegExp(`(?<!\\d)${String.fromCharCode(0x2013)}|${String.fromCharCode(0x2013)}(?!\\d)`);
    for (const { name, text } of added) {
      expect(text, name).not.toContain(EM);
      expect(text, name).not.toMatch(EN_NOT_BETWEEN_DIGITS);
    }
  });
});

// ── Readings the spec leaves open, settled by the review ─────────────────────────────────────────

describe("the readings the review settled, through the whole validator", () => {
  const SOURCE_PUBLISHER = (text: string) => (d: Json): void => { d.sources[5].publisher = text; };
  const run = (edit: (d: Json) => void, edition: EditionName = "weekday"): ValidationIssue[] => {
    const d = plain(edition);
    edit(d);
    return whole(d, edition);
  };

  it("fails an agent beside a quantity in lower case, in capitals or with the micro sign: a unit has no one case in running text", () => {
    for (const text of [
      "SAMPLE sentence for a test: it names anthrax and 5 ml.",
      "SAMPLE sentence for a test: it names anthrax and 5 ML.",
      "SAMPLE sentence for a test: it names anthrax and 5 MG.",
      `SAMPLE sentence for a test: it names anthrax and 5 ${String.fromCharCode(0xb5)}l.`,
      "SAMPLE sentence for a test: it names anthrax and 37 degrees celsius.",
      "SAMPLE sentence for a test: it names anthrax and 10^6 cfu.",
    ]) {
      expect(tell(run(SOURCE_PUBLISHER(text))), text).toEqual(["error DUAL_USE"]);
    }
  });

  it("fails a symbol agent in any case beside a quantity: vx, Vx and VX are the one agent", () => {
    for (const agent of ["VX", "vx", "Vx", "H5N1", "h5n1"]) {
      expect(tell(run(SOURCE_PUBLISHER(`SAMPLE sentence for a test: it names ${agent} and 5 mg.`))), agent).toEqual(["error DUAL_USE"]);
    }
  });

  it("passes an agent beside a unit that is part of a longer word, or a number that is part of a name", () => {
    for (const text of [
      "SAMPLE sentence for a test: it names anthrax and 5 mgs.",
      "SAMPLE sentence for a test: it names anthrax and 5 genes.",
      "SAMPLE sentence for a test: it names anthrax and the H5 mg.",
    ]) {
      expect(tell(run(SOURCE_PUBLISHER(text))), text).toEqual([]);
    }
  });

  // The review first settled these two the other way: a double space or a tab broke a nucleotide run, so a database line split by them was
  // the database pattern's alone and two blocks split by two spaces passed. STYLE.md section 9 forbids a sequence "in any case or layout",
  // so the reading changed on purpose: each run of white space is one separator, and the nucleotide pattern reads both.
  it("fails a database line of the letters acgt whose blocks are split by two spaces or tabs: a run of white space is one separator, as the nucleotide pattern reads it", () => {
    for (const blank of ["  ", "\t", " \t"]) {
      const line = `SAMPLE: a sequence note\n        1 acgtacgtac${blank}gtacgtacgt${blank}acgtacgtac`;
      const issues = run((d) => { d.sources[5].title = line; });
      expect(tell(issues), JSON.stringify(blank)).toEqual(["error DUAL_USE"]);
      expect(issues[0]!.message, JSON.stringify(blank)).toContain("a nucleotide sequence of 30 letters");
    }
  });

  it("fails two blocks of ten letters split by two spaces, which the first reading let pass: the layout of a run is no way round the rule", () => {
    expect(tell(run((d) => { d.sources[5].title = "SAMPLE: a note acgtacgtac  gtacgtacgt"; }))).toEqual(["error DUAL_USE"]);
  });

  it("fails a sequence split by any white space a model's output can hold, with no other code speaking", () => {
    const blanks: readonly [name: string, text: string][] = [
      ["a no-break space", NO_BREAK_SPACE], ["a tab", "\t"], ["a thin space", String.fromCharCode(0x2009)], ["an ideographic space", String.fromCharCode(0x3000)],
      ["a line separator", LINE_SEPARATOR], ["a paragraph separator", String.fromCharCode(0x2029)],
      ["a Windows line break", "\r\n"], ["a blank line", "\n\n"], ["a mix", `${NO_BREAK_SPACE}\t `],
    ];
    for (const [name, blank] of blanks) {
      const nucleotide = run((d) => { d.sources[5].title = `SAMPLE: a note acgtacgtac${blank}gtacgtacgt`; });
      expect(tell(nucleotide), name).toEqual(["error DUAL_USE"]);
      expect(nucleotide[0]!.message, name).toContain("a nucleotide sequence of 20 letters");
      const amino = run((d) => { d.sources[5].title = `SAMPLE: a note ACDEFGHIKL${blank}MNPQRSTVWY`; });
      expect(tell(amino), name).toEqual(["error DUAL_USE"]);
      expect(amino[0]!.message, name).toContain("an amino-acid sequence of 20 letters");
    }
  });

  // The whole validator refuses an invisible character or a control in any string of a draft (its own code, before the rules run), so a
  // sequence split by one fails there with that code. The rules still read such a character as no character, for the records that
  // never met the draft's door (a stored record, a hand edit), so the group's own rules are run here.
  it("fails a sequence split by an invisible character or a control, in the group's own rules, with no other code speaking", () => {
    const blanks: readonly [name: string, text: string][] = [
      ["a next-line control", String.fromCharCode(0x85)], ["a form feed", "\f"], ["a vertical tab", "\v"],
      ["a zero-width space", ZERO_WIDTH_SPACE], ["a word joiner", String.fromCharCode(0x2060)], ["a byte order mark", String.fromCharCode(0xfeff)],
      ["a soft hyphen", String.fromCharCode(0xad)], ["a mix", `${NO_BREAK_SPACE}\t${ZERO_WIDTH_SPACE} `],
    ];
    const ownRun = (title: string): ValidationIssue[] => {
      const d = plain("weekday");
      d.sources[5].title = title;
      return own(d, "weekday");
    };
    for (const [name, blank] of blanks) {
      const nucleotide = ownRun(`SAMPLE: a note acgtacgtac${blank}gtacgtacgt`);
      expect(tell(nucleotide), name).toEqual(["error DUAL_USE"]);
      expect(nucleotide[0]!.message, name).toContain("a nucleotide sequence of 20 letters");
      const amino = ownRun(`SAMPLE: a note ACDEFGHIKL${blank}MNPQRSTVWY`);
      expect(tell(amino), name).toEqual(["error DUAL_USE"]);
      expect(amino[0]!.message, name).toContain("an amino-acid sequence of 20 letters");
    }
  });

  it("passes a sentence in capitals whose words are all letters of the amino-acid alphabet, and nineteen letters in any layout", () => {
    for (const text of [
      "SAMPLE: THIS IS A SHIFT IN THE FIELD", "SAMPLE: SHIFT THE FIELD IN THIS AIM AND SEE THE LIGHT",
      `SAMPLE: a note acgtacgtac${NO_BREAK_SPACE}gtacgtacg`, `SAMPLE: a note ACDEF${NO_BREAK_SPACE}GHIKL MNPQR STVW`,
    ]) {
      expect(tell(run((d) => { d.sources[5].title = text; })), text).toEqual([]);
    }
  });

  it("reads a host after a label of 64 characters, which no host has, and a scheme of more than 32 characters from its last 32", () => {
    // The letter x, which no sequence pattern reads, so that only the address is found
    expect(tell(run((d) => { d.ideas[0].text = `${d.ideas[0].text} Read more at ${"x".repeat(64)}.bit.ly/ut-sample-idea.`; }))).toEqual(["error BLOCKED_HOST"]);
    expect(tell(run((d) => { d.ideas[0].text = `${d.ideas[0].text} Read more at ${"x".repeat(40)}://bit.ly/ut-sample-idea.`; }))).toEqual(["error BLOCKED_HOST"]);
  });
});

// ── Invisible characters and bullets: what the second review of the layout reading settled ─────────

describe("an invisible character is read both ways, as no character and as a blank", () => {
  const chars = (...codes: number[]): string => String.fromCharCode(...codes);
  const ZW = ZERO_WIDTH_SPACE;
  const nuc = (letters: number) => ({ kind: "nucleotide", letters });
  const amino = (letters: number) => ({ kind: "amino-acid", letters });
  /** Every character the sanitiser strips from page text and that is no white space, one string each. */
  const INVISIBLES = [ZW, chars(0x200c), chars(0x200d), chars(0x2060), chars(0xfeff), chars(0xad), chars(0x200e), chars(0x200f), chars(0x180e), chars(0xfe0f), chars(1), chars(0x7f)];

  // The first reading took an invisible character as no character alone, and so a zero-width space put where a space would stand, in a
  // line that starts with a position number, hid a lower-case database line and a GenBank line from the rule.
  it.each(INVISIBLES.map((c) => [`U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`, c] as const))(
    "fails a database line and a GenBank layout whose blocks and position numbers are set off by %s alone",
    (_name, c) => {
      expect(sequencesIn(`1 acdefghikl${c}mnpqrstvwy${c}acdefghikl`)).toEqual([amino(30)]);
      expect(sequencesIn(`1${c}acdefghikl mnpqrstvwy acdefghikl`)).toEqual([amino(30)]);
      expect(sequencesIn(`1${c}acgtacgtac\n11${c}gtacgtacgt`)).toEqual([nuc(20)]);
      expect(sequencesIn(`${c}1${c}acgtacgtac${c}\n${c}11${c}gtacgtacgt`)).toEqual([nuc(20)]);
    },
  );

  it("keeps the reading as no character: it joins the pieces of a row and of a word, whatever their widths", () => {
    expect(sequencesIn(`ACDEFGHIK${ZW}LMNPQRSTVW${ZW}Y`)).toEqual([amino(20)]);
    expect(sequencesIn(`A${ZW}CDEFGHIKLMNPQRSTVWY`)).toEqual([amino(20)]);
    expect(sequencesIn(`ACDEFGHIKLMNPQRSTVW${ZW} Y`)).toEqual([amino(20)]);
    expect(stepMarkersIn(`St${ZW}ep 4 mix\nSt${ZW}ep 5 heat`)).toEqual(["Step 4", "Step 5"]);
    expect(stepMarkersIn(`1${ZW}0. Mix\n1${ZW}1. Heat`)).toEqual(["10.", "11."]);
  });

  it("reports the reading that finds more letters, and both hits of it, when the two readings find different things", () => {
    // as no character the database line is one word of thirty letters, so only the row is a hit; as a blank it is three blocks of ten as well
    const line = `1 acdefghikl${ZW}mnpqrstvwy${ZW}acdefghikl`;
    expect(sequencesIn(`${line}\n${"ACDEFGHIKLMNPQRSTVWY"}`)).toEqual([amino(30), amino(20)]);
    // the same two readings of a text with no database line: the first (as no character) is kept, and a blank would find fewer
    expect(sequencesIn(`ACDEFGHIK${ZW}LMNPQRSTVW${ZW}Y`)).toEqual([amino(20)]);
    // the same hits on both readings are one set of hits, not two
    expect(sequencesIn(`acgtacgtac${ZW}gtacgtacgt`)).toEqual([nuc(20)]);
    expect(sequencesIn(`acgtacgtac${ZW} gtacgtacgt`)).toEqual([nuc(20)]);
    expect(stepMarkersIn(`1.${ZW}Mix\n2.${ZW}Heat`)).toEqual(["1.", "2."]);
  });

  // A tie is not a matter of taste: it is the order the two readings are tried in, so a change of that order, or of ">" to ">=", or of
  // letters to a count of hits, changes what the rule's message names. Sequences try "no character" first, step markers "a blank".
  it("keeps the first reading on a tie: as no character for sequences (a row against two rows of as many letters), as a blank for markers", () => {
    const row = "ACDEFGHIKL";
    const pieces = `${row}${row}A${ZW}${row}${row}AC`;
    // as no character one row of 43 letters; as a blank a row of 21 and a row of 22 (blocks of 21, then 22: a longer word starts a run)
    expect(sequencesIn(pieces)).toEqual([amino(43)]);
    expect(sequencesIn(pieces.split(ZW).join(" "))).toEqual([amino(21), amino(22)]);
    // the markers: as a blank "Step 4" and the number is no part of it; as no character it is "Step 41", and each reading has one marker
    expect(stepMarkersIn(`Step 4${ZW}1. Mix`)).toEqual(["Step 4"]);
    expect(stepMarkersIn(`Step 4${ZW}0. Mix`)).toEqual(["Step 4"]);
    expect(stepMarkersIn(`Step 4${ZW}1)`)).toEqual(["Step 4"]);
    expect(stepMarkersIn(`Step 4${ZW}1. Mix`.split(ZW).join(""))).toEqual(["Step 41"]);
  });

  it("reads a text with no invisible character once, and gives the same answer on a second call in any order (no pattern keeps a position)", () => {
    const texts = [`${"ACGT".repeat(5)}`, "THIS IS A SHIFT IN THE FIELD", "1 acdefghikl mnpqrstvwy acdefghikl", `a${ZW}b ${"ACDEF ".repeat(4)}`, "1. Mix\n2. Heat", "Step 1 x. Step 2 y.", ""];
    const first = texts.map((t) => [sequencesIn(t), stepMarkersIn(t)]);
    for (const order of [[...texts].reverse(), [...texts, ...texts]]) {
      for (const t of order) expect([sequencesIn(t), stepMarkersIn(t)], t).toEqual(first[texts.indexOf(t)]);
    }
  });

  it("fails a sequence set off by invisible characters alone, in the group's own rules for a stored record, naming the kind and length", () => {
    const d = plain("weekday");
    d.sources[5].title = `SAMPLE: a note\n1${ZW}acdefghikl${ZW}mnpqrstvwy${ZW}acdefghikl`;
    const found = own(d, "weekday");
    expect(tell(found)).toEqual(["error DUAL_USE"]);
    expect(found[0]!.message).toContain("an amino-acid sequence of 30 letters");
  });
});

describe("a list bullet is any dash, dot or shape that starts a line", () => {
  const chars = (...codes: number[]): string => String.fromCharCode(...codes);
  const code = (c: string): string => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
  /** The whole Geometric Shapes block, and the other marks Chinese, Japanese and plain-text lists use. */
  const SHAPES = Array.from({ length: 0x25ff - 0x25a0 + 1 }, (_, i) => chars(0x25a0 + i));
  const OTHERS = [chars(0xb7), chars(0x2027), chars(0x2043), chars(0x2219), chars(0x30fb), "-", "*", "+", chars(0x2022), chars(0x2013), chars(0x2014)];
  // the full stop is no bullet, but it ends a sentence, so a step after it is read; a digit is a position number, not a bullet
  const NOT_BULLETS = [chars(0x259f), chars(0x2600), chars(0x2713), ">", "|", "#", "~", "=", ":", "x", "(", chars(0xff0d), chars(0x3001)];

  it.each([...SHAPES, ...OTHERS].map((c) => [code(c), c] as const))("reads %s before a position number or a numbered step as a bullet", (_name, mark) => {
    expect(sequencesIn(`${mark} 1 acgtacgtac\n${mark} 11 gtacgtacgt`)).toEqual([{ kind: "nucleotide", letters: 20 }]);
    expect(sequencesIn(`  ${mark}  1  acdefghikl mnpqrstvwy acdefghikl`)).toEqual([{ kind: "amino-acid", letters: 30 }]);
    expect(stepMarkersIn(`${mark} 1. Mix\n${mark} 2. Heat`)).toEqual(["1.", "2."]);
    expect(stepMarkersIn(`${mark} Step 1: Mix\n${mark} Step 2: Heat`)).toEqual(["Step 1", "Step 2"]);
  });

  it.each(NOT_BULLETS.map((c) => [code(c), c] as const))("reads %s before a line as no bullet: it breaks a run and starts no step", (_name, mark) => {
    expect(sequencesIn(`acgtacgtac\n${mark} gtacgtacgt`)).toEqual([]);
    expect(stepMarkersIn(`${mark} 1. Mix\n${mark} 2. Heat`)).toEqual([]);
  });
});

describe("what the sequence patterns do not read, written down so that a change of it is a choice", () => {
  const chars = (...codes: number[]): string => String.fromCharCode(...codes);
  const NUC = "ACGT".repeat(5);
  const AMINO = "ACDEFGHIKLMNPQRSTVWY";

  it("does not read letters of another form: the rule reads a string as written, as it does its word lists (NFKC is the sanitiser's, for page text)", () => {
    const fullWidth = (text: string): string => [...text].map((c) => chars(c.charCodeAt(0) + 0xfee0)).join("");
    expect(sequencesIn(fullWidth(NUC))).toEqual([]);
    expect(sequencesIn(fullWidth(AMINO))).toEqual([]);
    expect(sequencesIn(String.fromCodePoint(...[...NUC].map((c) => 0x1d400 + c.charCodeAt(0) - 65)))).toEqual([]);
    expect(sequencesIn(`${NUC.slice(0, 10)}${chars(0xff21)}${NUC.slice(10)}`)).toEqual([]);
  });

  it("does not read a digit between the blocks of a run, a position number at the end of a line or a list number in front of a line", () => {
    expect(sequencesIn("acgtacgtac 10 gtacgtacgt 20")).toEqual([]);
    expect(sequencesIn("acgtacgtac 10\ngtacgtacgt 20")).toEqual([]);
    expect(sequencesIn("1. acgtacgtac\n2. gtacgtacgt")).toEqual([]);
    expect(sequencesIn("1) acgtacgtac\n2) gtacgtacgt")).toEqual([]);
  });

  it("does not read capital words of two widths as blocks, in whatever order they come, so that a line-wrapped run with ragged lines is read by its long lines alone", () => {
    expect(sequencesIn("MKTAYIAKQRQ\nKSHFSRQLEERL")).toEqual([]);
    expect(sequencesIn("MKTAYIAKQRQL\nKSHFSRQLEER")).toEqual([{ kind: "amino-acid", letters: 23 }]);
  });

  it("does not read lower-case amino-acid codes outside the database line, in a row or in blocks of any width", () => {
    expect(sequencesIn(AMINO.toLowerCase())).toEqual([]);
    expect(sequencesIn("acdefghikl mnpqrstvwy")).toEqual([]);
    expect(sequencesIn("acdef ghikl mnpqr stvwy")).toEqual([]);
    expect(sequencesIn("1 acdef ghikl mnpqr stvwy")).toEqual([]);
  });
});

// ── A long string ────────────────────────────────────────────────────────────────────────────────

describe("a string of 100,000 characters is read by every rule of the group in a pass", () => {
  const LONG = 100_000;
  const KINDS: readonly [name: string, text: () => string][] = [
    ["letters", () => "a".repeat(LONG)],
    ["capitals", () => "ACGT".repeat(LONG / 4)],
    ["letters and hyphens", () => "a-".repeat(LONG / 2)],
    ["labels", () => "a.".repeat(LONG / 2)],
    ["a scheme", () => `${"x".repeat(LONG)}://`],
    ["marks", () => `https://example.org/${"?!.".repeat(LONG / 3)}x`],
    ["digits", () => `ricin ${"1".repeat(LONG)} mg`],
    ["numbers", () => `ricin ${"1.".repeat(LONG / 2)} mg`],
    ["units", () => `ricin${" mg".repeat(LONG / 3)}`],
    ["blanks", () => `${" ".repeat(LONG)}\n${" ".repeat(LONG)}x`],
    ["line starts", () => "\n1 ".repeat(LONG / 3)],
    ["dashes", () => "sk-".repeat(LONG / 3)],
    ["no-break spaces", () => `A${NO_BREAK_SPACE.repeat(LONG - 2)}C`],
    ["letters and no-break spaces", () => `A${NO_BREAK_SPACE}`.repeat(LONG / 2)],
    ["zero-width spaces", () => ZERO_WIDTH_SPACE.repeat(LONG)],
    ["letters and zero-width spaces", () => `A${ZERO_WIDTH_SPACE}`.repeat(LONG / 2)],
    ["line separators", () => LINE_SEPARATOR.repeat(LONG)],
    ["blank lines", () => "\n".repeat(LONG)],
    ["bullets", () => "- ".repeat(LONG / 2)],
    ["bullets and numbers", () => "\n- 1 ".repeat(LONG / 5)],
    ["capital blocks", () => "ACDEF ".repeat(LONG / 6)],
    ["single capitals", () => "A D ".repeat(LONG / 4)],
    ["capital sentences", () => "THIS IS A SHIFT IN THE FIELD ".repeat(LONG / 29)],
    ["database lines", () => "1 acdefghikl mnpqrstvwy acdefghikl\n".repeat(LONG / 35)],
    ["blocks of ten and zero-width spaces", () => `ACDEFGHIKL${ZERO_WIDTH_SPACE}`.repeat(LONG / 11)],
    ["database lines and zero-width spaces", () => `1${ZERO_WIDTH_SPACE}acdefghikl${ZERO_WIDTH_SPACE}mnpqrstvwy${ZERO_WIDTH_SPACE}acdefghikl\n`.repeat(LONG / 37)],
    ["numbered lines and zero-width spaces", () => `1.${ZERO_WIDTH_SPACE}Mix\n`.repeat(LONG / 7)],
    ["black circles and numbers", () => `\n${String.fromCharCode(0x25cf)} 1 `.repeat(LONG / 5)],
    ["sentences of capitals and zero-width spaces", () => `A. B${ZERO_WIDTH_SPACE}. `.repeat(LONG / 8)],
  ];

  it.each(KINDS)("reads %s in under two seconds, and raises no error of its own", (_name, text) => {
    const d = plain("weekday");
    d.ideas[0].text = text().slice(0, LONG);
    const start = performance.now();
    const issues = runRules(buildDraftInput(DraftBrief.parse(d), draftInputs("weekday")), safetyRules);
    expect(performance.now() - start).toBeLessThan(2_000);
    expect(ofCode(issues, "RULE_ERROR")).toEqual([]);
    for (const i of issues) expect(i.message.length, i.message.slice(0, 80)).toBeLessThan(700);
  });
});
