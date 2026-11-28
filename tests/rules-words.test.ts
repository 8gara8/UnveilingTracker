// Tests of the words rules (SPEC §4.12): WORDS, SENTENCE_LENGTH, HYPE_WORDS, TERM_DEFINED, READING_LEVEL and NO_EM_DASH. Each sentence
// of each row, of "Word budgets", of "Stored records" and of "Removed text" is a test that fails if the rule is wrong, assigned to the
// modes the spec gives it:
//   draft mode                   every test: the fixed limits, and the tests that read `config/` or a `run.json` budget
//   published, being published   the same, on the records that the brief of the date names as first published on it
//   published, other records     only the fixed limits: the word budgets but the page total, SENTENCE_LENGTH, NO_EM_DASH and
//                                TERM_DEFINED's test that each listed term appears in the explainer (the tests that read the config
//                                files or a budget of `run.json` skip them, which a test of each code shows)
// A string that a stored `removed` correction rewrote is skipped by every rule; WORDS counts it as no words and drops the lower
// bound of the budget it counts in. The world is hand-built (tests/helpers/rule-world.ts for the Tuesday's draft, the contexts and
// the stored records) and sized so that every explainer, deep dive and big picture sits inside its budget; a test names what it
// changes. The text is made up: plain words in short sentences, so that no other word rule fires unless a test says so.

import { describe, expect, it } from "vitest";
import type { LoadedConfig } from "../lib/config";
import { editionDraft } from "../fixtures/src/drafts";
import { draftInputs as sampleInputs } from "../fixtures/src/inputs";
import { EDITION_NAMES } from "../fixtures/src/world";
import { readingGrade } from "../lib/readability";
import { codeInfo, codesOfGroup, RULES } from "../lib/rules/index";
import { buildDraftInput, buildPublishedInput, runRules } from "../lib/rules/run";
import { pageProseOf } from "../lib/rules/shared";
import type { Rule, StoredRecords, ValidationIssue } from "../lib/rules/types";
import { wordsRules } from "../lib/rules/words";
import { Brief } from "../lib/schema/brief";
import { AgentContext } from "../lib/schema/context";
import { DraftBrief } from "../lib/schema/draft";
import type { Finding } from "../lib/schema/finding";
import { Term } from "../lib/schema/glossary";
import { Correction } from "../lib/schema/misc";
import { countWords, splitSentences } from "../lib/text";
import { REMOVED_BEFORE, REMOVED_TEXT } from "../lib/vocab";
import {
  D, MONDAY, SUNDAY, clone, config, deepFreeze, draftInputs, holdRemoved, l, lz, mondayContext, storedFinding, storedTerm, storedWorld, sundayContext,
  weekdayContext, landmarkDraft, type Json,
} from "./helpers/rule-world";

// Characters built from their code points, so that no source line holds a dash or a curly quotation mark of its own.
const ch = (n: number): string => String.fromCharCode(n);
const EM = ch(0x2014);
const EN = ch(0x2013);
const HY = ch(0x2010);
const LDQ = ch(0x201c);
const RDQ = ch(0x201d);

const CODES = ["WORDS", "SENTENCE_LENGTH", "HYPE_WORDS", "TERM_DEFINED", "READING_LEVEL", "NO_EM_DASH"];
const rule = (code: string): Rule => wordsRules.find((r) => r.codes[0] === code)!;
const only = (issues: readonly ValidationIssue[], code: string): ValidationIssue[] => issues.filter((i) => i.code === code);
const at = (issues: readonly ValidationIssue[], path: string): ValidationIssue[] => issues.filter((i) => i.path === path);
const brief = (s: string): string => s.replace(/\s+/g, " ").trim();

/** One issue with the code at the path (and the severity, when given); the test fails with the list when there is not exactly one. */
function one(issues: readonly ValidationIssue[], code: string, path: string, severity: "error" | "warning" = "error"): ValidationIssue {
  const found = issues.filter((i) => i.code === code && i.path === path);
  expect(found, `${code} at ${path} in ${JSON.stringify(issues.map((i) => `${i.severity} ${i.code} ${i.path} ${i.message}`))}`).toHaveLength(1);
  expect(found[0]!.severity).toBe(severity);
  return found[0]!;
}

// ── Plain text of an exact length ────────────────────────────────────────────────────────────────

const PLAIN = ["the", "team", "ran", "a", "test", "and", "saw", "small", "gains", "in", "the", "work"];

/** `n` plain words in sentences of `per` words: no jargon word, no hype word and a very low reading grade. */
function plain(n: number, per = 8): string {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    let w = PLAIN[i % PLAIN.length]!;
    if (i % per === 0) w = w.charAt(0).toUpperCase() + w.slice(1);
    if (i % per === per - 1 || i === n - 1) w += ".";
    out.push(w);
  }
  return out.join(" ");
}

/** One sentence of each reading band (the Flesch-Kincaid grade of `readingGrade()` is 6.28, 12.27 and 15.69), none with a word the other word rules read. */
const EASY_S = "The team measured how the material changed under heat.";
const SOFT_S = "The team measured how the material changed under heat and found that its structure stayed stable through several repeated experiments.";
const HARD_S = "Researchers measured how quickly the material changed under extreme temperature and reported that its internal structure remained stable.";

/** `head` (a few words ending in a stop), then plain words: `n` words in all. */
function fill(n: number, head = ""): string {
  const k = head === "" ? 0 : countWords(head);
  if (n < k) throw new Error(`fill(${n}) cannot hold "${head}"`);
  return [head, n === k ? "" : plain(n - k)].filter((s) => s !== "").join(" ");
}

it("plain text has the words and the sentences it is asked for, and no word the word rules read", () => {
  for (const n of [1, 7, 8, 9, 24, 55, 280, 550]) {
    expect(countWords(plain(n))).toBe(n);
    expect(splitSentences(plain(n)).every((s) => countWords(s) <= 8)).toBe(true);
  }
  expect(splitSentences(plain(20, 20))).toHaveLength(1);
  expect(countWords(fill(45, "Protein folding."))).toBe(45);
  expect(countWords(fill(2, "Protein folding."))).toBe(2);
  expect(readingGrade(plain(300))).toBeLessThan(5);
  expect(readingGrade(EASY_S)).toBeLessThan(12);
  expect(readingGrade(SOFT_S)).toBeGreaterThan(12);
  expect(readingGrade(SOFT_S)).toBeLessThanOrEqual(14);
  expect(readingGrade(HARD_S)).toBeGreaterThan(14);
  for (const s of [EASY_S, SOFT_S, HARD_S]) expect(splitSentences(s)).toHaveLength(1);
});

// ── The draft world ──────────────────────────────────────────────────────────────────────────────

type Edit = (d: Json) => void;
type Edition = "weekday" | "sunday" | "monday" | "short-monday";

interface Scene {
  /** Changes the plain draft before it is parsed. */
  edit?: Edit;
  /** The edition: weekday (default), Sunday with a deep dive, Monday with a review, or a Monday of a week of fewer than 3 findings. */
  edition?: Edition;
  context?: AgentContext;
  config?: LoadedConfig;
  stored?: StoredRecords | null;
}

const TERMS = { protein: "protein folding", enzyme: "enzyme" };

/** The Tuesday's draft with math-2026-0002 filed as a Landmark (`landmarkDraft()`), sized: the story's six parts are 245 words, the other finding's first four 80, the Lead 11. */
function bigDraft(): Json {
  const d = clone(landmarkDraft()) as unknown as Json;
  const [story, item] = d.new_findings;
  story.explainer = {
    found: fill(45, "Protein folding."), matters: fill(40, "An enzyme."), ai_helped: fill(50), how_sure: fill(50), background: fill(30), could_lead: fill(30),
  };
  item.explainer = { found: fill(25), matters: fill(25), ai_helped: null, how_sure: fill(30), background: fill(20), could_lead: fill(20) };
  return d;
}

/** The draft of an edition: the Sunday's carries a deep dive of 500 words, a Monday's a review whose big picture is 300 words (100 in a short week). */
function draftOf(edition: Edition): Json {
  const d = bigDraft();
  if (edition === "sunday") {
    d.date = SUNDAY;
    d.deep_dive = { finding_id: "bio-2024-0007", text: fill(500), source_ids: ["b1"], why_today: "anniversary" };
  } else if (edition !== "weekday") {
    d.date = MONDAY;
    d.review = {
      big_picture: fill(edition === "monday" ? 300 : 100),
      remarkable: { finding_id: "math-2026-0002", note: fill(20) },
      strongest_against: { text: fill(30), finding_ids: ["chem-2026-0004"], source_ids: [] },
    };
  }
  return d;
}

const contextOf = (edition: Edition): AgentContext =>
  edition === "sunday" ? sundayContext() : edition === "monday" ? mondayContext(3) : edition === "short-monday" ? mondayContext(2) : weekdayContext();

function inputOf(scene: Scene = {}) {
  const edition = scene.edition ?? "weekday";
  const json = draftOf(edition);
  scene.edit?.(json);
  return buildDraftInput(DraftBrief.parse(json), {
    ...draftInputs(), context: scene.context ?? contextOf(edition), config: scene.config ?? config(), stored: scene.stored ?? null,
  });
}

/** The issues of one rule (a code), or of the whole group, on the draft of the scene. */
function draftRun(code: string | null, scene: Scene = {}): ValidationIssue[] {
  return runRules(inputOf(scene), code === null ? wordsRules : [rule(code)]);
}

const withBudgets = (over: Record<string, number>): LoadedConfig => {
  const c = config();
  return { ...c, run: { ...c.run, budgets: { ...c.run.budgets, ...over } } };
};
const withJargon = (words: string[]): LoadedConfig => {
  const c = config();
  return { ...c, jargon: { ...c.jargon, words: words.map((en) => ({ en, fields: [] })) } } as LoadedConfig;
};

/** A figure for the first new finding, whose alt text is the one a test changes. */
const FIGURE = {
  source_id: "s1", image_url: "https://example.org/fig/1.png", licence: "CC-BY-4.0", licence_quote: "released under CC BY 4.0",
  credit: "Figure 1 from a made-up paper", alt: "A made-up chart.",
};

// ── The stored world ─────────────────────────────────────────────────────────────────────────────

const ZH = "範例。";
const lzp = (en: string): { en: string; zh: string } => lz(en, ZH);
const EARLIER = "2026-11-10";

interface PubWorld {
  brief: Brief;
  findings: Finding[];
  terms: Term[];
  corrections: Correction[];
  reports: ReturnType<typeof storedWorld>["reports"];
}

/** The six parts of a stored finding, in both languages. */
function explainerOf(sizes: readonly [number, number, number, number, number, number], heads: readonly [string, string] = ["", ""]): Json {
  const [a, b, c, d, e, f] = sizes;
  return {
    found: lzp(fill(a, heads[0])), matters: lzp(fill(b, heads[1])), ai_helped: lzp(fill(c)), how_sure: lzp(fill(d)), background: lzp(fill(e)), could_lead: lzp(fill(f)),
  };
}

/**
 * The stored Tuesday, sized like the draft: the biology story (six parts of 245 words; it lists the glossary's term protein folding),
 * a new item and an older item that the brief of D names again (first four parts of 80 words each).
 */
function pubWorld(): PubWorld {
  const w = storedWorld();
  const bio = storedFinding("bio-2026-0001", { depth: "story", explainer: explainerOf([45, 40, 50, 50, 30, 30], ["Protein folding.", ""]) });
  const math = storedFinding("math-2026-0002", { depth: "item", title: l("A made-up proof"), first_brief: D, briefs: [D], terms: [], explainer: explainerOf([20, 20, 20, 20, 20, 20]) });
  const phys = storedFinding("phys-2026-0003", {
    depth: "item", first_brief: EARLIER, briefs: [EARLIER, D], terms: [], explainer: explainerOf([20, 20, 20, 20, 20, 20]), updated: EARLIER,
  });
  return { brief: w.brief, findings: [bio, math, phys], terms: w.terms, corrections: w.corrections, reports: w.reports };
}

interface PubScene {
  edit?: (w: PubWorld) => void;
  /** The date being published; null for a run that publishes nothing. */
  publishing?: string | null;
  config?: LoadedConfig;
}

function pubRun(code: string | null, scene: PubScene = {}): ValidationIssue[] {
  const w = pubWorld();
  scene.edit?.(w);
  const publishing = scene.publishing === undefined ? D : scene.publishing;
  const input = buildPublishedInput(
    w.brief, { findings: w.findings, terms: w.terms, corrections: w.corrections, reports: w.reports }, { config: scene.config ?? config(), publishing },
  );
  return runRules(input, code === null ? wordsRules : [rule(code)]);
}

/** The stored finding of an id in a world, loosely typed so that a test can rewrite a part of it. */
const finding = (w: PubWorld, id: string): Json => w.findings.find((f) => f.id === id) as unknown as Json;
const briefOf = (w: PubWorld): Json => w.brief as unknown as Json;

/** A `removed` correction as publish stores it, with the text it rewrote in place. */
const removal = (id: string, target: { finding?: string; edition?: string; term?: string }, path: string): Correction => Correction.parse({
  id, date: D, finding_id: target.finding ?? null, edition_date: target.edition ?? null, term_id: target.term ?? null, type: "removed", path,
  before: clone(REMOVED_BEFORE), after: clone(REMOVED_TEXT), reason: l("A safety check flagged the text."), source_url: null,
  trigger: "recheck", report_id: null,
});

/** A correction of a finding's text, with the text before it and after it. */
const rewrite = (id: string, date: string, findingId: string, path: string, before: string, after: string, type: "correction" | "update" = "correction"): Correction =>
  Correction.parse({
    id, date, finding_id: findingId, edition_date: null, term_id: null, type, path, before: l(before), after: l(after),
    reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
  });

// ── The rules as the registry sees them ──────────────────────────────────────────────────────────

describe("the words rules", () => {
  it("are six, one for each code of the group, in the table's order", () => {
    expect(codesOfGroup("words")).toEqual(CODES);
    expect(wordsRules.map((r) => r.codes)).toEqual(CODES.map((c) => [c]));
    for (const r of wordsRules) expect(RULES).toContain(r);
  });

  it("run in draft and published mode, never in the Chinese pass, and read no run input", () => {
    for (const r of wordsRules) {
      const info = codeInfo(r.codes[0])!;
      expect(r.severity).toBe("error");
      expect(r.scope).toEqual(["draft", "published"]);
      expect(info.scopes).toEqual(["draft", "published"]);
      expect(r.needs).toEqual([]);
      expect(r.uses).toEqual([]);
    }
  });

  it("agree with the table: five hard codes, and READING_LEVEL hard above one grade and soft above another", () => {
    expect(codeInfo("READING_LEVEL")).toMatchObject({ severity: "H/S", tests: ["F", "S"] });
    expect(codeInfo("WORDS")).toMatchObject({ severity: "H", tests: ["F", "T"] });
    for (const code of CODES.filter((c) => c !== "READING_LEVEL")) expect(codeInfo(code)!.severity).toBe("H");
  });

  it("pass the sized Tuesday of the draft world and of the stored world, in every mode", () => {
    expect(draftRun(null)).toEqual([]);
    expect(pubRun(null)).toEqual([]);
    expect(pubRun(null, { publishing: null })).toEqual([]);
    expect(pubRun(null, { publishing: EARLIER })).toEqual([]);
    for (const edition of ["sunday", "monday", "short-monday"] as const) expect(draftRun(null, { edition }), edition).toEqual([]);
  }, 30_000);

  it("report only their own codes on a draft that breaks all six", () => {
    const issues = draftRun(null, {
      edit: (d) => {
        d.new_findings[0].title = plain(13);
        d.lead[0].text = "A breakthrough here.";
        d.lead[1].text = plain(25, 25);
        d.ideas[0].text = `A made-up argument ${EM} here.`;
        d.new_findings[0].explainer.how_sure = fill(50, "A transformer helps.");
        Object.assign(d.new_findings[1].explainer, { found: HARD_S, matters: HARD_S, how_sure: HARD_S, background: HARD_S, could_lead: HARD_S });
      },
    });
    expect(new Set(issues.map((i) => i.code))).toEqual(new Set(CODES));
    expect(issues.map((i) => i.code).filter((c) => !CODES.includes(c))).toEqual([]);
  });

  it("are pure: a deeply frozen input gives the same issues twice, in both modes", () => {
    const input = deepFreeze(inputOf({
      edit: (d) => {
        d.new_findings[0].title = plain(13);
        d.lead[0].text = `A breakthrough ${EM} here.`;
      },
    }));
    const first = runRules(input, wordsRules);
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(runRules(input, wordsRules)).toEqual(first);
    expect(first.map((i) => i.code)).not.toContain("RULE_ERROR");

    const w = pubWorld();
    finding(w, "bio-2026-0001").explainer.found.en = plain(56);
    const pub = deepFreeze(buildPublishedInput(w.brief, { findings: w.findings, terms: w.terms, corrections: w.corrections, reports: w.reports }, { config: config(), publishing: D }));
    const second = runRules(pub, wordsRules);
    expect(second.length).toBeGreaterThanOrEqual(1);
    expect(runRules(pub, wordsRules)).toEqual(second);
    expect(second.map((i) => i.code)).not.toContain("RULE_ERROR");
  });
});

// ── WORDS: the fixed limits of the table, in draft mode ──────────────────────────────────────────

const wordsOf = (scene: Scene = {}): ValidationIssue[] => only(draftRun("WORDS", scene), "WORDS");
const pubWords = (scene: PubScene = {}): ValidationIssue[] => only(pubRun("WORDS", scene), "WORDS");

/** The message of a limit that `n` words break. */
const overMessage = (subject: string, n: number, max: number): string => `${subject} has ${n} words; the limit is ${max}. Cut at least ${n - max}.`;

/** A field with one cap on one string: `set` puts a text in it, `path` is where the issue points. */
interface Cap {
  label: string;
  path: string;
  subject: string;
  max: number;
  edition?: Edition;
  set: (d: Json, text: string) => void;
}

const STORY_PARTS: [string, string, number][] = [
  ["found", "The found part", 55], ["matters", "The matters part", 50], ["ai_helped", "The ai_helped part", 60],
  ["how_sure", "The how_sure part", 60], ["background", "The background part", 35], ["could_lead", "The could_lead part", 35],
];

const CAPS: Cap[] = [
  { label: "a new finding's title", path: "new_findings[0].title", subject: "The title", max: 12, set: (d, t) => { d.new_findings[0].title = t; } },
  { label: "a returning update", path: "returning[0].update", subject: "The returning update", max: 60, set: (d, t) => { d.returning[0].update = t; } },
  { label: "the rung note of a new finding", path: "new_findings[0].rung_history[0].note", subject: "The rung note", max: 25, set: (d, t) => { d.new_findings[0].rung_history[0].note = t; } },
  { label: "the rung note of a returning finding", path: "returning[0].rung.note", subject: "The rung note", max: 25, set: (d, t) => { d.returning[0].rung.note = t; } },
  { label: "the rung note of a rung change", path: "rung_changes[0].rung.note", subject: "The rung note", max: 25, set: (d, t) => { d.rung_changes[0].rung.note = t; } },
  { label: "an idea", path: "ideas[0].text", subject: "The idea", max: 40, set: (d, t) => { d.ideas[0].text = t; } },
  { label: "an Also noted title", path: "also[0].title", subject: "The Also noted title", max: 20, set: (d, t) => { d.also[0].title = t; } },
  { label: "a new term's definition", path: "new_findings[0].terms[0].definition", subject: "The definition", max: 40, set: (d, t) => { d.new_findings[0].terms[0].definition = t; } },
  { label: "a correction's reason", path: "corrections[0].reason", subject: "The reason", max: 40, set: (d, t) => { d.corrections[0].reason = t; } },
  { label: "a report decision's reason", path: "report_decisions[0].reason", subject: "The reason", max: 40, set: (d, t) => { d.report_decisions[0].reason = t; } },
  { label: "a figure's alt text", path: "new_findings[0].figure.alt", subject: "The figure's alt text", max: 40, set: (d, t) => { d.new_findings[0].figure = { ...FIGURE, alt: t }; } },
  { label: "the remarkable note", path: "review.remarkable.note", subject: "The remarkable note", max: 30, edition: "monday", set: (d, t) => { d.review.remarkable.note = t; } },
  { label: "the strongest evidence against", path: "review.strongest_against.text", subject: "The strongest evidence against", max: 50, edition: "monday", set: (d, t) => { d.review.strongest_against.text = t; } },
  ...STORY_PARTS.map(([part, subject, max]): Cap => ({
    label: `the ${part} of the story`, path: `new_findings[0].explainer.${part}`, subject, max, set: (d, t) => { d.new_findings[0].explainer[part] = t; },
  })),
  { label: "the background of an item", path: "new_findings[1].explainer.background", subject: "The background part", max: 40, set: (d, t) => { d.new_findings[1].explainer.background = t; } },
  { label: "the could_lead of an item", path: "new_findings[1].explainer.could_lead", subject: "The could_lead part", max: 40, set: (d, t) => { d.new_findings[1].explainer.could_lead = t; } },
];

describe("WORDS, draft mode: a cap on one string", () => {
  it.each(CAPS.map((c) => [c.label, c] as const))("%s: at the cap passes, one word over fails with the edit to make", (_label, c) => {
    const scene = (n: number): Scene => ({ edition: c.edition, edit: (d) => c.set(d, plain(n)) });
    expect(at(wordsOf(scene(c.max)), c.path)).toEqual([]);
    expect(at(wordsOf(scene(1)), c.path)).toEqual([]);
    const issue = one(wordsOf(scene(c.max + 1)), "WORDS", c.path);
    expect(issue.message).toBe(overMessage(c.subject, c.max + 1, c.max));
    expect(only(wordsOf(scene(c.max + 7)), "WORDS").find((i) => i.path === c.path)!.message).toBe(overMessage(c.subject, c.max + 7, c.max));
  });

  it("passes the strongest evidence against that is exactly NONE_FOUND, one word, and counts any other text word by word", () => {
    expect(countWords("NONE_FOUND")).toBe(1);
    const none: Edit = (d) => { d.review.strongest_against = { text: "NONE_FOUND", finding_ids: [], source_ids: [] }; };
    expect(at(wordsOf({ edition: "monday", edit: none }), "review.strongest_against.text")).toEqual([]);
    const issues = wordsOf({ edition: "monday", edit: (d) => { none(d); d.review.strongest_against.text = `NONE_FOUND ${plain(50)}`; } });
    expect(one(issues, "WORDS", "review.strongest_against.text").message).toBe(overMessage("The strongest evidence against", 51, 50));
  });

  it("a part of an item has no cap of its own but the background's and the could-lead's: one part may hold the whole 100", () => {
    const issues = wordsOf({ edit: (d) => Object.assign(d.new_findings[1].explainer, { found: plain(90), matters: plain(5), how_sure: plain(5) }) });
    expect(at(issues, "new_findings[1].explainer.found")).toEqual([]);
    expect(at(issues, "new_findings[1].explainer")).toEqual([]);
    const caps = wordsOf({ edit: (d) => Object.assign(d.new_findings[1].explainer, { found: plain(60), matters: plain(60), how_sure: plain(1) }) });
    expect(at(caps, "new_findings[1].explainer.found")).toEqual([]);
    expect(at(caps, "new_findings[1].explainer.matters")).toEqual([]);
    expect(at(caps, "new_findings[1].explainer")).toHaveLength(1);
  });

  it("a part of the story has its cap and no other: how_sure and ai_helped may hold 60, found 55 and matters 50", () => {
    for (const [part, , max] of STORY_PARTS) {
      expect(at(wordsOf({ edit: (d) => { d.new_findings[0].explainer[part] = plain(max); } }), `new_findings[0].explainer.${part}`)).toEqual([]);
      expect(at(wordsOf({ edit: (d) => { d.new_findings[0].explainer[part] = plain(max + 1); } }), `new_findings[0].explainer.${part}`)).toHaveLength(1);
    }
  });

  it("the caps of a finding's parts are by its depth: the first new finding is the story only while it is the brief's story", () => {
    const flipped = wordsOf({
      edit: (d) => {
        d.story = "new-2";
        d.items = ["new-1", "math-2026-0002"];
        d.new_findings[0].explainer.found = plain(56);
      },
    });
    expect(at(flipped, "new_findings[0].explainer.found")).toEqual([]);
    expect(at(flipped, "new_findings[0].explainer")).toHaveLength(1);
  });

  it("a string with no budget (a quote, a source's title, a name, an idea's author) never gives WORDS an issue", () => {
    const issues = wordsOf({
      edit: (d) => {
        d.new_findings[0].sources[0].title = plain(40);
        d.new_findings[0].reactions[0].quote = plain(25);
        d.new_findings[0].ai.evidence[0].quote = plain(25);
        d.new_findings[0].who[0].name = plain(12);
        d.ideas[0].who = plain(12);
        d.corrections[0].after = "landmark";
      },
    });
    expect(issues).toEqual([]);
  });
});

// ── WORDS: the ranges of a finding's parts, the Lead, the deep dive and the big picture ─────────

/** Sets the six parts of the story to these sizes; the first two keep the words of the finding's two listed terms. */
const setStory = (sizes: readonly number[]): Edit => (d) => {
  const [p1, p2, p3, p4, p5, p6] = sizes as [number, number, number, number, number, number];
  Object.assign(d.new_findings[0].explainer, {
    found: fill(p1, "Protein folding."), matters: fill(p2, "An enzyme."), ai_helped: fill(p3), how_sure: fill(p4), background: fill(p5), could_lead: fill(p6),
  });
};

/** A third new finding with an AI role, shown as an item, whose six parts have these sizes. */
const setAiItem = (sizes: readonly number[]): Edit => (d) => {
  const third = clone(d.new_findings[0]);
  third.ref = "new-3";
  d.new_findings.push(third);
  d.items.push("new-3");
  const [p1, p2, p3, p4, p5, p6] = sizes as [number, number, number, number, number, number];
  Object.assign(third.explainer, {
    found: fill(p1, "Protein folding."), matters: fill(p2, "An enzyme."), ai_helped: fill(p3), how_sure: fill(p4), background: fill(p5), could_lead: fill(p6),
  });
};

/** Sets the three counted parts of the item without an AI role. */
const setPlainItem = (found: number, matters: number, howSure: number): Edit => (d) => {
  Object.assign(d.new_findings[1].explainer, { found: fill(found), matters: fill(matters), how_sure: fill(howSure) });
};

const STORY_PATH = "new_findings[0].explainer";
const rangeMessage = (subject: string, n: number, range: string, fix: string): string => `${subject} have ${n} words; the budget is ${range}. ${fix}`;

describe("WORDS, draft mode: the story's six parts, 230 to 280 in all", () => {
  const AT_230 = [45, 40, 50, 45, 25, 25];
  const AT_280 = [55, 50, 60, 55, 30, 30];

  it("passes 230 and 280 and fails 229 and 281, telling how many words to add or cut", () => {
    expect(at(wordsOf({ edit: setStory(AT_230) }), STORY_PATH)).toEqual([]);
    expect(at(wordsOf({ edit: setStory(AT_280) }), STORY_PATH)).toEqual([]);
    const low = one(wordsOf({ edit: setStory([45, 40, 50, 44, 25, 25]) }), "WORDS", STORY_PATH);
    expect(low.message).toBe(rangeMessage("The story's six parts", 229, "230 to 280", "Add at least 1."));
    const high = one(wordsOf({ edit: setStory([55, 50, 60, 55, 30, 31]) }), "WORDS", STORY_PATH);
    expect(high.message).toBe(rangeMessage("The story's six parts", 281, "230 to 280", "Cut at least 1."));
    expect(one(wordsOf({ edit: setStory([30, 30, 30, 30, 30, 30]) }), "WORDS", STORY_PATH).message).toContain("have 180 words; the budget is 230 to 280. Add at least 50.");
    expect(wordsOf({ edit: setStory([55, 50, 60, 60, 35, 35]) }).filter((i) => i.path === STORY_PATH)[0]!.message).toContain("have 295 words; the budget is 230 to 280. Cut at least 15.");
  });

  it.each(STORY_PARTS.map(([part], i) => [part, i] as const))("counts the %s part in the six: one word fewer at 230 fails, one word more at 280 fails", (_part, i) => {
    const down = AT_230.map((n, k) => (k === i ? n - 1 : n));
    expect(one(wordsOf({ edit: setStory(down) }), "WORDS", STORY_PATH).message).toContain("have 229 words");
    const up = AT_280.map((n, k) => (k === i ? n + 1 : n));
    expect(one(wordsOf({ edit: setStory(up) }), "WORDS", STORY_PATH).message).toContain("have 281 words");
  });

  it("reads the range at the path of the explainer, whatever the parts hold", () => {
    expect(one(wordsOf({ edit: setStory([30, 30, 30, 30, 30, 30]) }), "WORDS", "new_findings[0].explainer").hint).toBeNull();
  });
});

describe("WORDS, draft mode: the first four parts of any other finding, 70 to 100 in all", () => {
  const ITEM = "new_findings[1].explainer";
  const AI_ITEM = "new_findings[2].explainer";

  it("passes 70 and 100 and fails 69 and 101 for a finding with no AI role (three parts)", () => {
    expect(at(wordsOf({ edit: setPlainItem(24, 23, 23) }), ITEM)).toEqual([]);
    expect(at(wordsOf({ edit: setPlainItem(34, 33, 33) }), ITEM)).toEqual([]);
    expect(one(wordsOf({ edit: setPlainItem(23, 23, 23) }), "WORDS", ITEM).message).toBe(rangeMessage("The first four parts", 69, "70 to 100", "Add at least 1."));
    expect(one(wordsOf({ edit: setPlainItem(34, 34, 33) }), "WORDS", ITEM).message).toBe(rangeMessage("The first four parts", 101, "70 to 100", "Cut at least 1."));
  });

  it("passes 70 and 100 and fails 69 and 101 for a finding with an AI role, whose ai_helped is the third part", () => {
    expect(at(wordsOf({ edit: setAiItem([17, 17, 18, 18, 20, 20]) }), AI_ITEM)).toEqual([]);
    expect(at(wordsOf({ edit: setAiItem([25, 25, 25, 25, 20, 20]) }), AI_ITEM)).toEqual([]);
    expect(one(wordsOf({ edit: setAiItem([17, 17, 17, 18, 20, 20]) }), "WORDS", AI_ITEM).message).toContain("have 69 words");
    expect(one(wordsOf({ edit: setAiItem([26, 25, 25, 25, 20, 20]) }), "WORDS", AI_ITEM).message).toContain("have 101 words");
  });

  it.each(["found", "matters", "ai_helped", "how_sure"].map((part, i) => [part, i] as const))("counts the %s part: one word fewer at 70 fails, one more at 100 fails", (_part, i) => {
    const low = [17, 17, 18, 18, 20, 20].map((n, k) => (k === i ? n - 1 : n));
    expect(one(wordsOf({ edit: setAiItem(low) }), "WORDS", AI_ITEM).message).toContain("have 69 words");
    const high = [25, 25, 25, 25, 20, 20].map((n, k) => (k === i ? n + 1 : n));
    expect(one(wordsOf({ edit: setAiItem(high) }), "WORDS", AI_ITEM).message).toContain("have 101 words");
  });

  it("does not count the background and the could-lead, which have caps of their own (40 each)", () => {
    expect(at(wordsOf({ edit: setAiItem([25, 25, 25, 25, 40, 40]) }), AI_ITEM)).toEqual([]);
    expect(at(wordsOf({ edit: setAiItem([17, 17, 18, 18, 40, 40]) }), AI_ITEM)).toEqual([]);
    expect(one(wordsOf({ edit: setAiItem([17, 17, 17, 18, 40, 40]) }), "WORDS", AI_ITEM).message).toContain("have 69 words");
  });

  it("holds a finding to the range of its depth: the story to 230 to 280 and an item to 70 to 100, whichever is longer", () => {
    // An item of 245 words fails the item range; the story of 80 words fails the story range.
    const swapped = wordsOf({ edit: (d) => { d.story = "new-2"; d.items = ["new-1", "math-2026-0002"]; } });
    expect(one(swapped, "WORDS", "new_findings[0].explainer").message).toContain("The first four parts have 185 words; the budget is 70 to 100. Cut at least 85.");
    expect(one(swapped, "WORDS", "new_findings[1].explainer").message).toContain("The story's six parts have 120 words; the budget is 230 to 280");
  });
});

const setLead = (...lines: string[]): Edit => (d) => { d.lead = lines.map((text) => ({ text, refs: ["new-1"] })); };

describe("WORDS, draft mode: the Lead, at most 60 words and 1 to 3 sentences", () => {
  it("passes 60 words in 3 sentences and fails 61, counting every line", () => {
    expect(at(wordsOf({ edit: setLead(plain(20, 20), plain(20, 20), plain(20, 20)) }), "lead")).toEqual([]);
    const issue = one(wordsOf({ edit: setLead(plain(21, 21), plain(20, 20), plain(20, 20)) }), "WORDS", "lead");
    expect(issue.message).toBe("The Lead has 61 words; the limit is 60. Cut at least 1.");
    expect(one(wordsOf({ edit: setLead(plain(24, 24), plain(24, 24), plain(24, 24)) }), "WORDS", "lead").message).toBe("The Lead has 72 words; the limit is 60. Cut at least 12.");
    expect(one(wordsOf({ edit: setLead(`${plain(30, 30)} ${plain(31, 31)}`) }), "WORDS", "lead").message).toContain("has 61 words");
    expect(at(wordsOf({ edit: setLead(plain(60, 20)) }), "lead")).toEqual([]);
  });

  it("passes 1, 2 and 3 sentences and fails 4, whether they stand in lines or in one line", () => {
    expect(at(wordsOf({ edit: setLead(plain(5)) }), "lead")).toEqual([]);
    expect(at(wordsOf({ edit: setLead(plain(5), plain(5)) }), "lead")).toEqual([]);
    expect(at(wordsOf({ edit: setLead(plain(15, 5)) }), "lead")).toEqual([]);
    const lines = wordsOf({ edit: setLead(plain(5), plain(5), plain(5), plain(5)) });
    expect(one(lines, "WORDS", "lead").message).toBe("The Lead has 4 sentences; the limit is 3. Join or drop at least 1.");
    const single = wordsOf({ edit: setLead(plain(20, 5)) });
    expect(one(single, "WORDS", "lead").message).toBe("The Lead has 4 sentences; the limit is 3. Join or drop at least 1.");
    expect(one(wordsOf({ edit: setLead(plain(10, 5), plain(10, 5), plain(10, 5)) }), "WORDS", "lead").message).toContain("has 6 sentences");
    expect(one(wordsOf({ edit: setLead(plain(5), plain(5), plain(10, 5)) }), "WORDS", "lead").message).toContain("has 4 sentences");
  });

  it("counts a sentence of one word as a sentence", () => {
    expect(at(wordsOf({ edit: setLead("Yes.") }), "lead")).toEqual([]);
    expect(at(wordsOf({ edit: setLead("One.", "Two.", "Three.") }), "lead")).toEqual([]);
    expect(one(wordsOf({ edit: setLead("One.", "Two.", "Three.", "Four.") }), "WORDS", "lead").message).toBe("The Lead has 4 sentences; the limit is 3. Join or drop at least 1.");
  });

  it("fails a Lead with no sentence, since a quiet day still says so", () => {
    expect(one(wordsOf({ edit: (d) => { d.lead = []; } }), "WORDS", "lead").message).toBe("The Lead has no sentence; write 1 to 3, at most 60 words in all.");
  });

  it("counts each line of the Lead as a sentence of its own, with or without a full stop", () => {
    expect(one(wordsOf({ edit: setLead("One", "Two", "Three", "Four") }), "WORDS", "lead").message).toBe("The Lead has 4 sentences; the limit is 3. Join or drop at least 1.");
    expect(at(wordsOf({ edit: setLead("One", "Two", "Three") }), "lead")).toEqual([]);
  });

  it("counts a line with no word in it, such as three dots, as no sentence", () => {
    expect(one(wordsOf({ edit: setLead("...") }), "WORDS", "lead").message).toBe("The Lead has no sentence; write 1 to 3, at most 60 words in all.");
    expect(one(wordsOf({ edit: setLead("...", "(...)") }), "WORDS", "lead").message).toContain("no sentence");
    expect(at(wordsOf({ edit: setLead(plain(5), plain(5), plain(5), "...") }), "lead")).toEqual([]);
  });

  it("is judged on the Sunday and the Monday too", () => {
    for (const edition of ["sunday", "monday", "short-monday"] as const) {
      expect(one(wordsOf({ edition, edit: (d) => { d.lead = []; } }), "WORDS", "lead").message).toContain("no sentence");
      expect(one(wordsOf({ edition, edit: setLead(plain(61, 61)) }), "WORDS", "lead").message).toContain("has 61 words");
    }
  });
});

describe("WORDS, draft mode: a new finding that neither the story nor an item names", () => {
  const unused: Edit = (d) => { d.items = ["math-2026-0002"]; };

  it("is judged as any other finding, by the first four parts alone: 70 to 100 words", () => {
    expect(at(wordsOf({ edit: unused }), "new_findings[1].explainer")).toEqual([]);
    const big: Edit = (d) => { unused(d); d.new_findings[1].explainer.found = plain(90); };
    expect(one(wordsOf({ edit: big }), "WORDS", "new_findings[1].explainer").message).toContain("The first four parts have 145 words; the budget is 70 to 100");
    const small: Edit = (d) => { unused(d); Object.assign(d.new_findings[1].explainer, { found: plain(10), matters: plain(10), how_sure: plain(10) }); };
    expect(one(wordsOf({ edit: small }), "WORDS", "new_findings[1].explainer").message).toContain("The first four parts have 30 words; the budget is 70 to 100");
  });
});

describe("WORDS, draft mode: the deep dive, 450 to 550 words", () => {
  const dive = (n: number): Scene => ({ edition: "sunday", edit: (d) => { d.deep_dive.text = plain(n); } });

  it("passes 450 and 550 and fails 449 and 551", () => {
    expect(at(wordsOf(dive(450)), "deep_dive.text")).toEqual([]);
    expect(at(wordsOf(dive(550)), "deep_dive.text")).toEqual([]);
    expect(one(wordsOf(dive(449)), "WORDS", "deep_dive.text").message).toBe("The deep dive has 449 words; the budget is 450 to 550. Add at least 1.");
    expect(one(wordsOf(dive(551)), "WORDS", "deep_dive.text").message).toBe("The deep dive has 551 words; the budget is 450 to 550. Cut at least 1.");
    expect(one(wordsOf(dive(100)), "WORDS", "deep_dive.text").message).toContain("Add at least 350.");
  });

  it("is judged where it stands: a draft with no deep dive has none to judge", () => {
    expect(wordsOf()).toEqual([]);
  });
});

describe("WORDS, draft mode: the big picture, 270 to 330 words, or at most 120 in a week of fewer than 3 findings", () => {
  const picture = (n: number, edition: Edition): Scene => ({ edition, edit: (d) => { d.review.big_picture = plain(n); } });
  const FULL = "The big picture has";

  it("in a week of 3 or more findings passes 270 and 330 and fails 269 and 331", () => {
    expect(at(wordsOf(picture(270, "monday")), "review.big_picture")).toEqual([]);
    expect(at(wordsOf(picture(330, "monday")), "review.big_picture")).toEqual([]);
    const low = one(wordsOf(picture(269, "monday")), "WORDS", "review.big_picture");
    expect(low.message).toBe(`${FULL} 269 words; the budget is 270 to 330. Add at least 1.`);
    expect(low.hint).toBe("This is a week of 3 or more findings: 270 to 330 words.");
    expect(one(wordsOf(picture(331, "monday")), "WORDS", "review.big_picture").message).toBe(`${FULL} 331 words; the budget is 270 to 330. Cut at least 1.`);
  });

  it("in a week of 3 or more findings fails the short big picture of 120 and of 100 words", () => {
    expect(one(wordsOf(picture(120, "monday")), "WORDS", "review.big_picture").message).toContain("has 120 words; the budget is 270 to 330. Add at least 150.");
    expect(one(wordsOf(picture(100, "monday")), "WORDS", "review.big_picture").message).toContain("Add at least 170.");
  });

  it("in a week of fewer than 3 findings passes up to 120 words and fails 121", () => {
    expect(at(wordsOf(picture(120, "short-monday")), "review.big_picture")).toEqual([]);
    expect(at(wordsOf(picture(1, "short-monday")), "review.big_picture")).toEqual([]);
    const issue = one(wordsOf(picture(121, "short-monday")), "WORDS", "review.big_picture");
    expect(issue.message).toBe(`${FULL} 121 words; the limit is 120. Cut at least 1.`);
    expect(issue.hint).toBe("This is a week of fewer than 3 findings: at most 120 words.");
  });

  it("in a week of fewer than 3 findings fails the full-length big picture", () => {
    expect(one(wordsOf(picture(270, "short-monday")), "WORDS", "review.big_picture").message).toContain("has 270 words; the limit is 120. Cut at least 150.");
    expect(one(wordsOf(picture(300, "short-monday")), "WORDS", "review.big_picture").message).toContain("Cut at least 180.");
  });

  it("takes the week from the context: 2 findings is short and 3 is not", () => {
    expect(at(wordsOf({ edition: "monday", context: mondayContext(2), edit: (d) => { d.review.big_picture = plain(100); } }), "review.big_picture")).toEqual([]);
    expect(at(wordsOf({ edition: "monday", context: mondayContext(3), edit: (d) => { d.review.big_picture = plain(100); } }), "review.big_picture")).toHaveLength(1);
    expect(at(wordsOf({ edition: "monday", context: mondayContext(3), edit: (d) => { d.review.big_picture = plain(300); } }), "review.big_picture")).toEqual([]);
    expect(at(wordsOf({ edition: "monday", context: mondayContext(2), edit: (d) => { d.review.big_picture = plain(300); } }), "review.big_picture")).toHaveLength(1);
  });
});

// ── WORDS: the page total ────────────────────────────────────────────────────────────────────────

/** The words of the page as WORDS counts them (the frame's `pageProseOf()`). */
const pageTotal = (scene: Scene = {}): number => pageProseOf(inputOf(scene)).reduce((n, e) => n + countWords(e.text), 0);

/** An edit that makes the page of an edition hold exactly `target` words, the first idea taking up the difference. */
function pageOf(target: number, edition: Edition = "weekday"): Edit {
  const base = pageTotal({ edition, edit: (d) => { d.ideas[0].text = plain(1); } });
  return (d) => { d.ideas[0].text = plain(target - base + 1); };
}

const rootOf = (issues: readonly ValidationIssue[]): ValidationIssue[] => at(issues, "(root)");

describe("WORDS, draft mode: the page total, a soft target of 1,000 words and a hard limit of 1,300", () => {
  it("counts the page of the sized Tuesday: the Lead, the two new findings as the page shows them, the update, the idea and the Also noted line", () => {
    // 11 (the Lead) + 249 (the story, its title included) + 84 (the item) + 5 (the update) + 5 (the idea) + 4 (the Also noted title)
    expect(pageTotal()).toBe(358);
  });

  it("passes 1,000 words, warns from 1,001 words to 1,300, and fails 1,301", () => {
    expect(rootOf(wordsOf({ edit: pageOf(1000) }))).toEqual([]);
    const soft = one(wordsOf({ edit: pageOf(1001) }), "WORDS", "(root)", "warning");
    expect(soft.message).toBe("The page has 1001 words; the target is 1000. Cut 1 to reach it.");
    expect(soft.hint).toContain("The target is soft");
    expect(one(wordsOf({ edit: pageOf(1300) }), "WORDS", "(root)", "warning").message).toBe("The page has 1300 words; the target is 1000. Cut 300 to reach it.");
    const hard = wordsOf({ edit: pageOf(1301) });
    expect(rootOf(hard)).toHaveLength(1);
    expect(one(hard, "WORDS", "(root)").message).toBe("The page has 1301 words; the limit is 1300. Cut at least 1.");
    expect(one(wordsOf({ edit: pageOf(1500) }), "WORDS", "(root)").message).toBe("The page has 1500 words; the limit is 1300. Cut at least 200.");
  });

  it("reads the target and the limit from the budgets of run.json, not from numbers of its own", () => {
    expect(rootOf(wordsOf({ config: withBudgets({ words_target: 358, words_max: 358 }) }))).toEqual([]);
    expect(one(wordsOf({ config: withBudgets({ words_target: 357 }) }), "WORDS", "(root)", "warning").message).toBe("The page has 358 words; the target is 357. Cut 1 to reach it.");
    expect(one(wordsOf({ config: withBudgets({ words_max: 357 }) }), "WORDS", "(root)").message).toBe("The page has 358 words; the limit is 357. Cut at least 1.");
    const both = wordsOf({ config: withBudgets({ words_target: 100, words_max: 200 }) });
    expect(rootOf(both)).toHaveLength(1);
    expect(rootOf(both)[0]!.severity).toBe("error");
  });

  // One word more in a string of the page moves a page of 1,000 words over its target; a string the page does not show does not.
  const bump = (get: (d: Json) => string, set: (d: Json, v: string) => void): Edit => (d) => { set(d, `${get(d)} Plus.`); };
  const COUNTED: [string, Edition, Edit][] = [
    ["a Lead sentence", "weekday", bump((d) => d.lead[0].text, (d, v) => { d.lead[0].text = v; })],
    ["a returning update", "weekday", bump((d) => d.returning[0].update, (d, v) => { d.returning[0].update = v; })],
    ["an idea", "weekday", bump((d) => d.ideas[1]?.text ?? "", (d, v) => { d.ideas.push({ text: v, who: "A. Example", source_id: "b2" }); })],
    ["an Also noted title", "weekday", bump((d) => d.also[0].title, (d, v) => { d.also[0].title = v; })],
    ["the title of the story", "weekday", bump((d) => d.new_findings[0].title, (d, v) => { d.new_findings[0].title = v; })],
    ...STORY_PARTS.map(([part]): [string, Edition, Edit] => [
      `the ${part} of the story`, "weekday", bump((d) => d.new_findings[0].explainer[part], (d, v) => { d.new_findings[0].explainer[part] = v; }),
    ]),
    ["the title of an item", "weekday", bump((d) => d.new_findings[1].title, (d, v) => { d.new_findings[1].title = v; })],
    ...(["found", "matters", "how_sure"] as const).map((part): [string, Edition, Edit] => [
      `the ${part} of an item`, "weekday", bump((d) => d.new_findings[1].explainer[part], (d, v) => { d.new_findings[1].explainer[part] = v; }),
    ]),
    ["the deep dive", "sunday", bump((d) => d.deep_dive.text, (d, v) => { d.deep_dive.text = v; })],
    ["the big picture", "monday", bump((d) => d.review.big_picture, (d, v) => { d.review.big_picture = v; })],
    ["the remarkable note", "monday", bump((d) => d.review.remarkable.note, (d, v) => { d.review.remarkable.note = v; })],
    ["the strongest evidence against", "monday", bump((d) => d.review.strongest_against.text, (d, v) => { d.review.strongest_against.text = v; })],
  ];
  const NOT_COUNTED: [string, Edition, Edit][] = [
    ["the background of an item", "weekday", bump((d) => d.new_findings[1].explainer.background, (d, v) => { d.new_findings[1].explainer.background = v; })],
    ["the could_lead of an item", "weekday", bump((d) => d.new_findings[1].explainer.could_lead, (d, v) => { d.new_findings[1].explainer.could_lead = v; })],
    ["the rung note of a new finding", "weekday", (d) => { d.new_findings[0].rung_history[0].note = plain(5); }],
    ["the rung note of a returning finding", "weekday", bump((d) => d.returning[0].rung.note, (d, v) => { d.returning[0].rung.note = v; })],
    ["the rung note of a rung change", "weekday", bump((d) => d.rung_changes[0].rung.note, (d, v) => { d.rung_changes[0].rung.note = v; })],
    ["a figure's alt text", "weekday", (d) => { d.new_findings[0].figure = { ...FIGURE, alt: plain(10) }; }],
    ["a new term's definition", "weekday", bump((d) => d.new_findings[0].terms[0].definition, (d, v) => { d.new_findings[0].terms[0].definition = v; })],
    ["a correction's reason", "weekday", bump((d) => d.corrections[0].reason, (d, v) => { d.corrections[0].reason = v; })],
    ["a report decision's reason", "weekday", bump((d) => d.report_decisions[0].reason, (d, v) => { d.report_decisions[0].reason = v; })],
  ];

  it.each(COUNTED.map((c) => [c[0], c] as const))("counts %s: one word more moves a page of 1,000 words past its target", (_label, [, edition, edit]) => {
    expect(rootOf(wordsOf({ edition, edit: (d) => { pageOf(1000, edition)(d); } }))).toEqual([]);
    const issues = wordsOf({ edition, edit: (d) => { pageOf(1000, edition)(d); edit(d); } });
    expect(one(issues, "WORDS", "(root)", "warning").message).toBe("The page has 1001 words; the target is 1000. Cut 1 to reach it.");
  });

  it.each(NOT_COUNTED.map((c) => [c[0], c] as const))("does not count %s in the page", (_label, [, edition, edit]) => {
    const issues = wordsOf({ edition, edit: (d) => { pageOf(1000, edition)(d); edit(d); } });
    expect(rootOf(issues)).toEqual([]);
  });

  it("is a check of the draft in every edition: a Sunday over its limit fails at the root too", () => {
    expect(one(wordsOf({ edition: "sunday", edit: pageOf(1301, "sunday") }), "WORDS", "(root)").message).toContain("has 1301 words; the limit is 1300");
    expect(one(wordsOf({ edition: "monday", edit: pageOf(1301, "monday") }), "WORDS", "(root)").message).toContain("has 1301 words; the limit is 1300");
  });
});

// ── WORDS: published mode ────────────────────────────────────────────────────────────────────────

const BIO = "bio-2026-0001";
const MATH = "math-2026-0002";
const PHYS = "phys-2026-0003";
const FILE = (id: string): string => `findings/${id}.json`;
const BRIEF_FILE = `briefs/${D}.json`;

/** The stored brief as a Sunday's, with a deep dive of `words` words. */
function asSunday(w: PubWorld, words = 500): void {
  const b = briefOf(w);
  b.format = "sunday_deep_dive";
  b.deep_dive = { finding_id: BIO, text: lzp(fill(words)), source_ids: ["b1"], why_today: "anniversary" };
}

/** The stored brief as a Monday's, with a review whose big picture is `words` words. */
function asMonday(w: PubWorld, words = 300): void {
  const b = briefOf(w);
  b.format = "monday_review";
  b.review = {
    big_picture: lzp(fill(words)), remarkable: { finding_id: MATH, note: lzp(fill(20)) },
    strongest_against: { text: lzp(fill(30)), finding_ids: [PHYS], source_ids: [] },
    field_counts: ["mathematics", "physics", "chemistry", "biology", "earth", "social_science", "theology_humanities"].map((field) => ({ field, reported: 1, counted: 1 })),
    fell: [], setbacks: [],
  };
}

/** The stored finding's six parts, set to these sizes (the first two parts keep the words of the listed term). */
const setStored = (id: string, sizes: readonly number[]) => (w: PubWorld): void => {
  const f = finding(w, id);
  const [p1, p2, p3, p4, p5, p6] = sizes as [number, number, number, number, number, number];
  const head = id === BIO ? "Protein folding." : "";
  Object.assign(f.explainer, {
    found: lzp(fill(p1, head)), matters: lzp(fill(p2)), ai_helped: lzp(fill(p3)), how_sure: lzp(fill(p4)), background: lzp(fill(p5)), could_lead: lzp(fill(p6)),
  });
};

interface PubCap {
  label: string;
  path: string;
  subject: string;
  max: number;
  /** True for a string of a record that is not being published on D: the brief of D names it again, but it was first published earlier. */
  older?: boolean;
  prepare?: (w: PubWorld) => void;
  set: (w: PubWorld, text: string) => void;
}

const PUB_CAPS: PubCap[] = [
  { label: "a stored finding's title", path: `${FILE(BIO)}: title.en`, subject: "The title", max: 12, set: (w, t) => { finding(w, BIO).title = lzp(t); } },
  ...STORY_PARTS.map(([part, subject, max]): PubCap => ({
    label: `the ${part} of a stored story`, path: `${FILE(BIO)}: explainer.${part}.en`, subject, max, set: (w, t) => { finding(w, BIO).explainer[part] = lzp(t); },
  })),
  { label: "the background of a stored item", path: `${FILE(PHYS)}: explainer.background.en`, subject: "The background part", max: 40, older: true, set: (w, t) => { finding(w, PHYS).explainer.background = lzp(t); } },
  { label: "the could_lead of a stored item", path: `${FILE(MATH)}: explainer.could_lead.en`, subject: "The could_lead part", max: 40, set: (w, t) => { finding(w, MATH).explainer.could_lead = lzp(t); } },
  { label: "a returning update kept in a finding (since_then)", path: `${FILE(BIO)}: since_then[0].text.en`, subject: "The returning update", max: 60, set: (w, t) => { finding(w, BIO).since_then[0].text = lzp(t); } },
  { label: "a stored rung note", path: `${FILE(BIO)}: rung_history[1].note.en`, subject: "The rung note", max: 25, set: (w, t) => { finding(w, BIO).rung_history[1].note = lzp(t); } },
  { label: "a stored figure's alt text", path: `${FILE(BIO)}: figure.alt.en`, subject: "The figure's alt text", max: 40, set: (w, t) => { finding(w, BIO).figure = { ...FIGURE, alt: lzp(t) }; } },
  { label: "the update of a stored item", path: `${BRIEF_FILE}: items[1].update.en`, subject: "The returning update", max: 60, set: (w, t) => { briefOf(w).items[1].update = lzp(t); } },
  { label: "a stored idea", path: `${BRIEF_FILE}: ideas[0].text.en`, subject: "The idea", max: 40, set: (w, t) => { briefOf(w).ideas[0].text = lzp(t); } },
  { label: "a stored Also noted title", path: `${BRIEF_FILE}: also[0].title.en`, subject: "The Also noted title", max: 20, set: (w, t) => { briefOf(w).also[0].title = lzp(t); } },
  { label: "a reason the brief lists for a correction", path: `${BRIEF_FILE}: corrections[0].reason.en`, subject: "The reason", max: 40, set: (w, t) => { briefOf(w).corrections[0].reason = lzp(t); } },
  { label: "a stored correction's reason", path: "corrections.json: corrections[1].reason.en", subject: "The reason", max: 40, set: (w, t) => { w.corrections[1]!.reason = lzp(t); } },
  { label: "an older stored correction's reason", path: "corrections.json: corrections[0].reason.en", subject: "The reason", max: 40, older: true, set: (w, t) => { w.corrections[0]!.reason = lzp(t); } },
  { label: "a stored report's reason", path: "reports.json: reports[0].reason.en", subject: "The reason", max: 40, set: (w, t) => { w.reports[0]!.reason = lzp(t); } },
  { label: "a glossary term's definition", path: "glossary.json: terms[0].en.definition", subject: "The definition", max: 40, set: (w, t) => { w.terms[0]!.en.definition = t; } },
  {
    label: "the remarkable note of a stored review", path: `${BRIEF_FILE}: review.remarkable.note.en`, subject: "The remarkable note", max: 30,
    prepare: (w) => asMonday(w), set: (w, t) => { briefOf(w).review.remarkable.note = lzp(t); },
  },
  {
    label: "the strongest evidence against of a stored review", path: `${BRIEF_FILE}: review.strongest_against.text.en`, subject: "The strongest evidence against", max: 50,
    prepare: (w) => asMonday(w), set: (w, t) => { briefOf(w).review.strongest_against.text = lzp(t); },
  },
];

describe("WORDS, published mode: the fixed limits run on every stored record, being published or not", () => {
  it.each(PUB_CAPS.map((c) => [c.label, c] as const))("%s: at the cap passes, one word over fails", (_label, c) => {
    for (const publishing of [D, null, EARLIER]) {
      const scene = (n: number): PubScene => ({ publishing, edit: (w) => { c.prepare?.(w); c.set(w, plain(n)); } });
      expect(at(pubWords(scene(c.max)), c.path), `at the cap, publishing ${publishing}`).toEqual([]);
      expect(one(pubWords(scene(c.max + 1)), "WORDS", c.path).message, `over the cap, publishing ${publishing}`).toBe(overMessage(c.subject, c.max + 1, c.max));
    }
  });

  it("holds the stored story to 230 to 280 words in its six parts, and a stored item to 70 to 100 in its first four", () => {
    for (const publishing of [D, null]) {
      const story = (sizes: number[]): PubScene => ({ publishing, edit: setStored(BIO, sizes) });
      const path = `${FILE(BIO)}: explainer`;
      expect(at(pubWords(story([45, 40, 50, 45, 25, 25])), path)).toEqual([]);
      expect(at(pubWords(story([55, 50, 60, 55, 30, 30])), path)).toEqual([]);
      expect(one(pubWords(story([45, 40, 50, 44, 25, 25])), "WORDS", path).message).toBe(rangeMessage("The story's six parts", 229, "230 to 280", "Add at least 1."));
      expect(one(pubWords(story([55, 50, 60, 55, 30, 31])), "WORDS", path).message).toBe(rangeMessage("The story's six parts", 281, "230 to 280", "Cut at least 1."));
      for (const id of [MATH, PHYS]) {
        const item = (sizes: number[]): PubScene => ({ publishing, edit: setStored(id, sizes) });
        const itemPath = `${FILE(id)}: explainer`;
        expect(at(pubWords(item([17, 17, 18, 18, 40, 40])), itemPath)).toEqual([]);
        expect(at(pubWords(item([25, 25, 25, 25, 40, 40])), itemPath)).toEqual([]);
        expect(one(pubWords(item([17, 17, 17, 18, 20, 20])), "WORDS", itemPath).message).toBe(rangeMessage("The first four parts", 69, "70 to 100", "Add at least 1."));
        expect(one(pubWords(item([26, 25, 25, 25, 20, 20])), "WORDS", itemPath).message).toBe(rangeMessage("The first four parts", 101, "70 to 100", "Cut at least 1."));
      }
    }
  });

  it("reads a stored finding's range by the depth it was first published at", () => {
    const issues = pubWords({ publishing: null, edit: (w) => { finding(w, BIO).depth = "item"; } });
    expect(one(issues, "WORDS", `${FILE(BIO)}: explainer`).message).toContain("The first four parts have 185 words; the budget is 70 to 100");
    const story = pubWords({ publishing: null, edit: (w) => { finding(w, PHYS).depth = "story"; } });
    expect(one(story, "WORDS", `${FILE(PHYS)}: explainer`).message).toContain("The story's six parts have 120 words; the budget is 230 to 280");
  });

  it("passes a stored strongest evidence against that is exactly NONE_FOUND", () => {
    for (const publishing of PUBLISHING) {
      const none = (w: PubWorld): void => { asMonday(w); briefOf(w).review.strongest_against = { text: lzp("NONE_FOUND"), finding_ids: [], source_ids: [] }; };
      expect(at(pubWords({ publishing, edit: none }), `${BRIEF_FILE}: review.strongest_against.text.en`), String(publishing)).toEqual([]);
    }
  });

  it("holds the stored Lead to 60 words and 1 to 3 sentences", () => {
    for (const publishing of [D, null]) {
      const lead = (...lines: string[]): PubScene => ({ publishing, edit: (w) => { briefOf(w).lead = lines.map((t) => ({ text: lzp(t), finding_ids: [BIO] })); } });
      const path = `${BRIEF_FILE}: lead`;
      expect(at(pubWords(lead(plain(20, 20), plain(20, 20), plain(20, 20))), path)).toEqual([]);
      expect(one(pubWords(lead(plain(21, 21), plain(20, 20), plain(20, 20))), "WORDS", path).message).toBe("The Lead has 61 words; the limit is 60. Cut at least 1.");
      expect(one(pubWords(lead(plain(5), plain(5), plain(5), plain(5))), "WORDS", path).message).toBe("The Lead has 4 sentences; the limit is 3. Join or drop at least 1.");
      expect(one(pubWords(lead(plain(20, 5))), "WORDS", path).message).toContain("has 4 sentences");
    }
  });

  it("has no Lead to judge in a data-only edition or in records no brief names, but fails a full edition's empty Lead", () => {
    const dataOnly = (w: PubWorld): void => { briefOf(w).edition = "data_only"; briefOf(w).lead = []; };
    expect(at(pubWords({ edit: dataOnly }), `${BRIEF_FILE}: lead`)).toEqual([]);
    expect(one(pubWords({ edit: (w) => { briefOf(w).lead = []; } }), "WORDS", `${BRIEF_FILE}: lead`).message).toContain("no sentence");
    const w = pubWorld();
    const input = buildPublishedInput(null, { findings: w.findings, terms: w.terms, corrections: w.corrections, reports: w.reports }, { config: config(), date: D, publishing: D });
    expect(runRules(input, [rule("WORDS")])).toEqual([]);
    finding(w, BIO).explainer.found = lzp(plain(56));
    const noBrief = runRules(
      buildPublishedInput(null, { findings: w.findings, terms: w.terms, corrections: w.corrections, reports: w.reports }, { config: config(), date: D, publishing: D }),
      [rule("WORDS")],
    );
    expect(noBrief.map((i) => i.path)).toEqual([`${FILE(BIO)}: explainer.found.en`]);
  });

  it("holds a stored deep dive to 450 to 550 words", () => {
    for (const publishing of [D, null]) {
      const dive = (n: number): PubScene => ({ publishing, edit: (w) => asSunday(w, n) });
      const path = `${BRIEF_FILE}: deep_dive.text.en`;
      expect(at(pubWords(dive(450)), path)).toEqual([]);
      expect(at(pubWords(dive(550)), path)).toEqual([]);
      expect(one(pubWords(dive(449)), "WORDS", path).message).toBe("The deep dive has 449 words; the budget is 450 to 550. Add at least 1.");
      expect(one(pubWords(dive(551)), "WORDS", path).message).toBe("The deep dive has 551 words; the budget is 450 to 550. Cut at least 1.");
    }
  });

  it("holds a stored big picture to either budget: 270 to 330 words, or at most 120", () => {
    for (const publishing of [D, null]) {
      const picture = (n: number): PubScene => ({ publishing, edit: (w) => asMonday(w, n) });
      const path = `${BRIEF_FILE}: review.big_picture.en`;
      for (const ok of [1, 100, 120, 270, 300, 330]) expect(at(pubWords(picture(ok)), path), `${ok} words`).toEqual([]);
      const mid = one(pubWords(picture(121)), "WORDS", path).message;
      expect(mid).toBe("The big picture has 121 words; the budget is 270 to 330, or at most 120 in a week of fewer than 3 findings. Cut at least 1 for a short week, or add at least 149 for a full one.");
      expect(one(pubWords(picture(269)), "WORDS", path).message).toContain("Cut at least 149 for a short week, or add at least 1 for a full one.");
      expect(one(pubWords(picture(331)), "WORDS", path).message).toBe("The big picture has 331 words; the budget is 270 to 330, or at most 120 in a week of fewer than 3 findings. Cut at least 1.");
    }
  });
});

describe("WORDS, published mode: the page total runs only on the brief being published", () => {
  const pubPageTotal = (edit?: (w: PubWorld) => void): number => {
    const w = pubWorld();
    edit?.(w);
    const input = buildPublishedInput(w.brief, { findings: w.findings, terms: w.terms, corrections: w.corrections, reports: w.reports }, { config: config(), publishing: D });
    return pageProseOf(input).reduce((n, e) => n + countWords(e.text), 0);
  };
  /** An edit that makes the stored page hold exactly `target` words, the first idea taking up the difference. */
  const pageOfStored = (target: number): ((w: PubWorld) => void) => {
    const base = pubPageTotal((w) => { briefOf(w).ideas[0].text = lzp(plain(1)); });
    return (w) => { briefOf(w).ideas[0].text = lzp(plain(target - base + 1)); };
  };
  const ROOT = `${BRIEF_FILE}: (root)`;

  it("counts the page of the stored Tuesday: the Lead, the two new findings, the update, the idea and the Also noted line", () => {
    // 6 (the Lead) + 249 (the story) + 83 (the new item: three words of title and 80) + 5 + 5 + 4
    expect(pubPageTotal()).toBe(352);
  });

  it("warns above 1,000 words and fails above 1,300 on the brief being published", () => {
    expect(at(pubWords({ edit: pageOfStored(1000) }), ROOT)).toEqual([]);
    expect(one(pubWords({ edit: pageOfStored(1001) }), "WORDS", ROOT, "warning").message).toBe("The page has 1001 words; the target is 1000. Cut 1 to reach it.");
    expect(one(pubWords({ edit: pageOfStored(1300) }), "WORDS", ROOT, "warning").message).toBe("The page has 1300 words; the target is 1000. Cut 300 to reach it.");
    expect(one(pubWords({ edit: pageOfStored(1301) }), "WORDS", ROOT).message).toBe("The page has 1301 words; the limit is 1300. Cut at least 1.");
  });

  it("never reads a brief that is not being published, since the budget it reads may change after its edition (SPEC §4.12 Stored records)", () => {
    for (const publishing of [null, EARLIER, "2026-12-01"]) {
      expect(at(pubWords({ publishing, edit: pageOfStored(1301) }), ROOT)).toEqual([]);
      expect(at(pubWords({ publishing, edit: pageOfStored(1100) }), ROOT)).toEqual([]);
    }
  });

  it("reads the budgets of run.json for the brief being published", () => {
    expect(one(pubWords({ config: withBudgets({ words_target: 351 }) }), "WORDS", ROOT, "warning").message).toBe("The page has 352 words; the target is 351. Cut 1 to reach it.");
    expect(one(pubWords({ config: withBudgets({ words_max: 351 }) }), "WORDS", ROOT).message).toBe("The page has 352 words; the limit is 351. Cut at least 1.");
    expect(at(pubWords({ publishing: null, config: withBudgets({ words_max: 1 }) }), ROOT)).toEqual([]);
  });
});

// ── Removed text ─────────────────────────────────────────────────────────────────────────────────

/** Rewrites a part of a stored finding as the removed text, and stores the `removed` correction that did it (or does not, for a test of the other way). */
const removePart = (id: string, part: string, stored = true, correctionId = "C-0003") => (w: PubWorld): void => {
  finding(w, id).explainer[part] = clone(REMOVED_TEXT);
  if (stored) w.corrections.push(removal(correctionId, { finding: id }, `explainer.${part}`));
};

/** The same for a string of the stored brief, at a dotted path such as `deep_dive.text`. */
const removeInBrief = (path: string, stored = true, correctionId = "C-0003") => (w: PubWorld): void => {
  const segments = path.split(".");
  let target: Json = briefOf(w);
  for (const segment of segments.slice(0, -1)) target = target[segment];
  target[segments[segments.length - 1]!] = clone(REMOVED_TEXT);
  if (stored) w.corrections.push(removal(correctionId, { edition: D }, path));
};

const ALL_PARTS = ["found", "matters", "ai_helped", "how_sure", "background", "could_lead"] as const;
const PUBLISHING = [D, null] as const;

describe("WORDS, removed text: it counts as no words and drops the lower bound of the budget it counts in", () => {
  const STORY = `${FILE(BIO)}: explainer`;
  const ITEM = `${FILE(PHYS)}: explainer`;
  const compose = (...edits: ((w: PubWorld) => void)[]): ((w: PubWorld) => void) => (w) => { for (const e of edits) e(w); };

  it.each(ALL_PARTS.map((part) => [part] as const))("a removed %s of the story drops the story's 230: the five parts left, 195 to 215 words, pass", (part) => {
    for (const publishing of PUBLISHING) expect(at(pubWords({ publishing, edit: removePart(BIO, part) }), STORY), `publishing ${publishing}`).toEqual([]);
  });

  it("is keyed on the stored correction: the removed text written with no correction counts as the four words it is", () => {
    for (const publishing of PUBLISHING) {
      const issue = one(pubWords({ publishing, edit: removePart(BIO, "how_sure", false) }), "WORDS", STORY);
      expect(issue.message).toBe(rangeMessage("The story's six parts", 199, "230 to 280", "Add at least 31."));
    }
  });

  it("is keyed on the record's text as well: a stored correction over text that is not REMOVED_TEXT in both languages counts the text as it is", () => {
    const filed = (w: PubWorld): void => { w.corrections.push(removal("C-0003", { finding: BIO }, "explainer.how_sure")); };
    const half = (en: string, zh: string | null) => (w: PubWorld): void => { finding(w, BIO).explainer.how_sure = { en, zh }; filed(w); };
    for (const publishing of PUBLISHING) {
      // the correction filed over the unchanged record: the story keeps its words, and the marker's four are not taken for them
      expect(at(pubWords({ publishing, edit: filed }), STORY)).toEqual([]);
      // the marker in one language only is the four words it is, as when no correction names it
      for (const edit of [half(REMOVED_TEXT.en, "別的文字。"), half(REMOVED_TEXT.en, null)]) {
        expect(one(pubWords({ publishing, edit }), "WORDS", STORY).message).toBe(rangeMessage("The story's six parts", 199, "230 to 280", "Add at least 31."));
      }
      // other English text with the Chinese marker counts its own five words, not none
      expect(at(pubWords({ publishing, edit: half("Other text that is held.", REMOVED_TEXT.zh) }), STORY).map((i) => i.message)).toEqual([
        rangeMessage("The story's six parts", 200, "230 to 280", "Add at least 30."),
      ]);
    }
  });

  it("still holds the upper bound: the parts left of the story over 280 words fail", () => {
    const edit = compose(setStored(BIO, [101, 50, 60, 50, 35, 35]), removePart(BIO, "how_sure"));
    for (const publishing of PUBLISHING) {
      expect(one(pubWords({ publishing, edit }), "WORDS", STORY).message).toBe(rangeMessage("The story's six parts", 281, "230 to 280", "Cut at least 1."));
    }
  });

  it.each(["found", "matters", "ai_helped", "how_sure"].map((part) => [part] as const))("a removed %s of an item drops the item's 70: the three parts left, 60 words, pass", (part) => {
    for (const publishing of PUBLISHING) {
      expect(at(pubWords({ publishing, edit: removePart(PHYS, part) }), ITEM)).toEqual([]);
      expect(one(pubWords({ publishing, edit: removePart(PHYS, part, false) }), "WORDS", ITEM).message).toContain("The first four parts have 64 words; the budget is 70 to 100. Add at least 6.");
    }
  });

  it.each(["background", "could_lead"].map((part) => [part] as const))("a removed %s of an item does not drop the 70, for it is not one of the first four parts", (part) => {
    const edit = compose(setStored(PHYS, [15, 15, 15, 15, 20, 20]), removePart(PHYS, part));
    for (const publishing of PUBLISHING) {
      expect(one(pubWords({ publishing, edit }), "WORDS", ITEM).message).toBe(rangeMessage("The first four parts", 60, "70 to 100", "Add at least 10."));
    }
  });

  it("still holds the upper bound of an item: the parts left over 100 words fail", () => {
    const edit = compose(setStored(PHYS, [40, 40, 40, 20, 20, 20]), removePart(PHYS, "how_sure"));
    for (const publishing of PUBLISHING) {
      expect(one(pubWords({ publishing, edit }), "WORDS", ITEM).message).toBe(rangeMessage("The first four parts", 120, "70 to 100", "Cut at least 20."));
    }
  });

  it("drops the 450 of a deep dive (only for the removal a stored correction made) and the 270 of a big picture", () => {
    for (const publishing of PUBLISHING) {
      const dive = `${BRIEF_FILE}: deep_dive.text.en`;
      expect(at(pubWords({ publishing, edit: compose((w) => asSunday(w), removeInBrief("deep_dive.text")) }), dive)).toEqual([]);
      expect(one(pubWords({ publishing, edit: compose((w) => asSunday(w), removeInBrief("deep_dive.text", false)) }), "WORDS", dive).message).toBe(
        "The deep dive has 4 words; the budget is 450 to 550. Add at least 446.",
      );
      const picture = `${BRIEF_FILE}: review.big_picture.en`;
      // A stored brief may have the short big picture, so the four words of removed text pass either way: the removal changes nothing a test can see.
      expect(at(pubWords({ publishing, edit: compose((w) => asMonday(w), removeInBrief("review.big_picture")) }), picture)).toEqual([]);
      expect(at(pubWords({ publishing, edit: compose((w) => asMonday(w), removeInBrief("review.big_picture", false)) }), picture)).toEqual([]);
    }
  });

  it("drops the Lead's one sentence when a stored correction removed its only line, and counts a removed line as no sentence and no word", () => {
    const path = `${BRIEF_FILE}: lead`;
    const only1 = (stored: boolean) => (w: PubWorld): void => {
      briefOf(w).lead = [{ text: lzp(plain(5)), finding_ids: [BIO] }];
      removeInBrief("lead.0.text", stored)(w);
    };
    for (const publishing of PUBLISHING) {
      expect(at(pubWords({ publishing, edit: only1(true) }), path)).toEqual([]);
      expect(at(pubWords({ publishing, edit: only1(false) }), path)).toEqual([]);
    }
    const four = (stored: boolean) => (w: PubWorld): void => {
      briefOf(w).lead = [plain(20, 20), plain(20, 20), plain(20, 20), plain(30, 30)].map((t) => ({ text: lzp(t), finding_ids: [BIO] }));
      if (stored) { w.corrections.push(removal("C-0003", { edition: D }, "lead.3.text")); holdRemoved(w as never); }
    };
    for (const publishing of PUBLISHING) {
      expect(at(pubWords({ publishing, edit: four(true) }), path)).toEqual([]);
      expect(at(pubWords({ publishing, edit: four(false) }), path).map((i) => i.message)).toEqual([
        "The Lead has 4 sentences; the limit is 3. Join or drop at least 1.", "The Lead has 90 words; the limit is 60. Cut at least 30.",
      ]);
    }
  });

  it("skips a removed string for a cap, whatever it holds, and counts it for no page total", () => {
    for (const publishing of PUBLISHING) {
      const long = (stored: boolean) => (w: PubWorld): void => {
        briefOf(w).ideas[0].text = lzp(plain(60));
        if (stored) { w.corrections.push(removal("C-0003", { edition: D }, "ideas.0.text")); holdRemoved(w as never); }
      };
      expect(at(pubWords({ publishing, edit: long(true) }), `${BRIEF_FILE}: ideas[0].text.en`)).toEqual([]);
      expect(one(pubWords({ publishing, edit: long(false) }), "WORDS", `${BRIEF_FILE}: ideas[0].text.en`).message).toBe(overMessage("The idea", 60, 40));
      const found = (stored: boolean) => (w: PubWorld): void => {
        finding(w, BIO).explainer.found = lzp(fill(60, "Protein folding."));
        if (stored) { w.corrections.push(removal("C-0003", { finding: BIO }, "explainer.found")); holdRemoved(w as never); }
      };
      expect(at(pubWords({ publishing, edit: found(true) }), `${FILE(BIO)}: explainer.found.en`)).toEqual([]);
      expect(one(pubWords({ publishing, edit: found(false) }), "WORDS", `${FILE(BIO)}: explainer.found.en`).message).toBe(overMessage("The found part", 60, 55));
    }
    const huge = (stored: boolean) => (w: PubWorld): void => {
      briefOf(w).ideas[0].text = lzp(plain(1400));
      if (stored) { w.corrections.push(removal("C-0003", { edition: D }, "ideas.0.text")); holdRemoved(w as never); }
    };
    expect(at(pubWords({ edit: huge(true) }), `${BRIEF_FILE}: (root)`)).toEqual([]);
    expect(one(pubWords({ edit: huge(false) }), "WORDS", `${BRIEF_FILE}: (root)`).message).toContain("The page has 1747 words; the limit is 1300");
  });

  it("skips a glossary definition that a stored correction removed", () => {
    const long = (stored: boolean) => (w: PubWorld): void => {
      w.terms[0]!.en.definition = plain(50);
      if (stored) { w.corrections.push(removal("C-0003", { term: "protein-folding" }, "definition")); holdRemoved(w as never); }
    };
    for (const publishing of PUBLISHING) {
      expect(at(pubWords({ publishing, edit: long(true) }), "glossary.json: terms[0].en.definition")).toEqual([]);
      expect(one(pubWords({ publishing, edit: long(false) }), "WORDS", "glossary.json: terms[0].en.definition").message).toBe(overMessage("The definition", 50, 40));
    }
  });
});

// ── WORDS: a correction's after ──────────────────────────────────────────────────────────────────

describe("WORDS, a correction's after: the budget of the string it replaces, in draft and in published mode", () => {
  const HINT = "A correction's new text has the budget of the string it replaces (SPEC §4.12 Word budgets).";
  const message = (subject: string, n: number, max: number): string => `${subject} as corrected has ${n} words; the limit is ${max}. Cut at least ${n - max}.`;
  const rows = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.path} | ${i.message}`);

  /** What a correction names: a finding, an edition's brief or a glossary term. */
  interface Target { finding_id?: string; edition_date?: string; term_id?: string }
  const FINDING: Target = { finding_id: "math-2026-0002" };
  const EDITION: Target = { edition_date: D };
  const TERM: Target = { term_id: "protein-folding" };
  const target = (t: Target) => ({ finding_id: t.finding_id ?? null, edition_date: t.edition_date ?? null, term_id: t.term_id ?? null });

  /** The strings that have a row of their own in the budget table, each by a path that names one: the row's subject and cap. */
  const ROWS: { label: string; target: Target; path: string; subject: string; max: number }[] = [
    { label: "a finding's title", target: FINDING, path: "title", subject: "The title", max: 12 },
    { label: "a finding's rung note", target: FINDING, path: "rung_history.1.note", subject: "The rung note", max: 25 },
    { label: "a returning update kept in a finding", target: FINDING, path: "since_then.0.text", subject: "The returning update", max: 60 },
    { label: "a finding's figure alt text", target: FINDING, path: "figure.alt", subject: "The figure's alt text", max: 40 },
    { label: "the brief's story update", target: EDITION, path: "story.update", subject: "The returning update", max: 60 },
    { label: "the brief's item update", target: EDITION, path: "items.0.update", subject: "The returning update", max: 60 },
    { label: "an idea line", target: EDITION, path: "ideas.1.text", subject: "The idea", max: 40 },
    { label: "an Also noted title", target: EDITION, path: "also.0.title", subject: "The Also noted title", max: 20 },
    { label: "the remarkable note", target: EDITION, path: "review.remarkable.note", subject: "The remarkable note", max: 30 },
    { label: "the strongest evidence against", target: EDITION, path: "review.strongest_against.text", subject: "The strongest evidence against", max: 50 },
    { label: "the reason a brief lists for a correction", target: EDITION, path: "corrections.0.reason", subject: "The reason", max: 40 },
    { label: "a term's definition", target: TERM, path: "definition", subject: "The definition", max: 40 },
  ];
  /** Paths whose strings have no per-string row: the Lead's budget is its total, the deep dive and the big picture are whole texts, a term's name is no prose. */
  const UNBUDGETED: { label: string; target: Target; path: string }[] = [
    { label: "a Lead line", target: EDITION, path: "lead.0.text" },
    { label: "the deep dive", target: EDITION, path: "deep_dive.text" },
    { label: "the big picture", target: EDITION, path: "review.big_picture" },
    { label: "a term's name", target: TERM, path: "term" },
  ];

  const NEXT = bigDraft().corrections.length;
  const PATH = `corrections[${NEXT}].after`;

  describe("in a draft", () => {
    /** The draft with one more correction after its own, the text at `path` of `t` being `after`. */
    const corrected = (t: Target, path: string, after: string, type = "correction"): Edit => (d) => {
      d.corrections.push({ ...target(t), type, path, after, reason: "The text was wrong.", source_url: null, report_id: null });
    };

    it.each(ROWS.map((r) => [r.label, r] as const))("passes a correction's after at %s at its budget and fails it one word over, once, at the after (DRAFT)", (_label, r) => {
      expect(wordsOf({ edit: corrected(r.target, r.path, plain(r.max)) })).toEqual([]);
      expect(wordsOf({ edit: corrected(r.target, r.path, plain(1)) })).toEqual([]);
      const issues = wordsOf({ edit: corrected(r.target, r.path, plain(r.max + 1)) });
      expect(rows(issues)).toEqual([`${PATH} | ${message(r.subject, r.max + 1, r.max)}`]);
      expect(issues[0]!.severity).toBe("error");
      expect(issues[0]!.hint).toBe(HINT);
    });

    it("counts the words of the after as everywhere else, and reads every correction of the draft, each at its own path (DRAFT)", () => {
      const edit: Edit = (d) => {
        corrected(FINDING, "title", plain(14))(d);
        corrected(FINDING, "title", plain(12))(d);
        corrected(EDITION, "also.0.title", plain(30))(d);
      };
      expect(rows(wordsOf({ edit }))).toEqual([
        `corrections[${NEXT}].after | ${message("The title", 14, 12)}`,
        `corrections[${NEXT + 2}].after | ${message("The Also noted title", 30, 20)}`,
      ]);
      expect(wordsOf({ edit: corrected(FINDING, "title", "One   two\nthree four five six seven eight nine ten eleven twelve") })).toEqual([]);
    });

    it("reads the first correction of a draft too, the only one or the first of several (DRAFT)", () => {
      const only: Edit = (d) => { d.corrections = []; corrected(FINDING, "title", plain(13))(d); };
      expect(rows(wordsOf({ edit: only }))).toEqual([`corrections[0].after | ${message("The title", 13, 12)}`]);
      const first: Edit = (d) => { d.corrections = []; corrected(FINDING, "title", plain(13))(d); corrected(EDITION, "also.0.title", plain(21))(d); };
      expect(rows(wordsOf({ edit: first }))).toEqual([`corrections[0].after | ${message("The title", 13, 12)}`, `corrections[1].after | ${message("The Also noted title", 21, 20)}`]);
    });

    it.each(UNBUDGETED.map((u) => [u.label, u] as const))("budgets no correction's after at %s, which has no per-string row (DRAFT)", (_label, u) => {
      expect(wordsOf({ edit: corrected(u.target, u.path, plain(60)) })).toEqual([]);
    });

    it("budgets no vocabulary value, and takes the removed text's four words as they are (DRAFT)", () => {
      expect(wordsOf({ edit: corrected(FINDING, "significance", "major") })).toEqual([]);
      expect(wordsOf({ edit: corrected(FINDING, "title", REMOVED_TEXT.en, "removed") })).toEqual([]);
      expect(wordsOf({ edit: corrected(EDITION, "also.0.title", REMOVED_TEXT.en, "removed") })).toEqual([]);
    });

    it("never reads the reason as the after: the reason keeps its own budget of 40 words, the after its row's (DRAFT)", () => {
      const edit: Edit = (d) => { corrected(FINDING, "title", plain(5))(d); d.corrections[NEXT].reason = plain(41); };
      expect(rows(wordsOf({ edit }))).toEqual([`corrections[${NEXT}].reason | ${overMessage("The reason", 41, 40)}`]);
    });

    describe("an explainer part, whose cap depends on the depth of the finding", () => {
      const recordsOf = (depth: "story" | "item" | null): StoredRecords => ({
        findings: depth === null ? [] : [storedFinding("math-2026-0002", { depth })], corrections: [], terms: [],
      });
      const part = (name: string, n: number, depth: "story" | "item" | null): Scene => ({ edit: corrected(FINDING, `explainer.${name}`, plain(n)), stored: recordsOf(depth) });

      it.each(STORY_PARTS)("caps %s at its story budget when the run holds the finding as a story (DRAFT)", (name, subject, max) => {
        expect(wordsOf(part(name, max, "story"))).toEqual([]);
        const issues = wordsOf(part(name, max + 1, "story"));
        expect(rows(issues)).toEqual([`${PATH} | ${message(subject, max + 1, max)}`]);
        expect(issues[0]!.hint).toBe(HINT);
      });

      it.each([["background", "The background part"], ["could_lead", "The could_lead part"]])("caps %s at 40 when the run holds the finding as an item (DRAFT)", (name, subject) => {
        expect(wordsOf(part(name, 40, "item"))).toEqual([]);
        expect(rows(wordsOf(part(name, 41, "item")))).toEqual([`${PATH} | ${message(subject, 41, 40)}`]);
      });

      it.each(["found", "matters", "ai_helped", "how_sure"])("gives %s of an item no cap of its own, only the range of the four parts together (DRAFT)", (name) => {
        expect(wordsOf(part(name, 60, "item"))).toEqual([]);
      });

      it("budgets no explainer part when the run does not hold the finding's record, so does not know its depth (DRAFT)", () => {
        for (const name of ["found", "background", "could_lead"]) expect(wordsOf(part(name, 60, null)), name).toEqual([]);
        // A record of another finding is no help.
        const other: StoredRecords = { findings: [storedFinding("phys-2026-0003", { depth: "story" })], corrections: [], terms: [] };
        expect(wordsOf({ edit: corrected(FINDING, "explainer.found", plain(60)), stored: other })).toEqual([]);
      });

      it("takes the depth from the record, and reads no other part of it: 38 words fit an item's background and not a story's (DRAFT)", () => {
        const record = (depth: "story" | "item"): StoredRecords => {
          const found = storedFinding("math-2026-0002", { depth });
          found.explainer.found.en = plain(150);
          return { findings: [found], corrections: [], terms: [] };
        };
        const scene = (depth: "story" | "item"): Scene => ({ edit: corrected(FINDING, "explainer.background", plain(38)), stored: record(depth) });
        expect(wordsOf(scene("item"))).toEqual([]);
        expect(rows(wordsOf(scene("story")))).toEqual([`${PATH} | ${message("The background part", 38, 35)}`]);
      });
    });
  });

  describe("in published mode", () => {
    /** A stored correction of `t` at `path`, dated `date`. */
    const stored = (t: Target, path: string, before: string, after: string, date = D, id = "C-0003", type: "correction" | "update" = "correction") =>
      (w: PubWorld): void => {
        w.corrections.push(Correction.parse({
          id, date, ...target(t), type, path, before: l(before), after: l(after), reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
        }));
      };
    const NEXT_STORED = pubWorld().corrections.length;
    const PUB_PATH = `corrections.json: corrections[${NEXT_STORED}].after.en`;
    /** Both runs of a publishing edition: the date it publishes, and none. */
    const RUNS: readonly (string | null)[] = [D, null];

    it.each(ROWS.map((r) => [r.label, r] as const))("passes a stored correction's after at %s at its budget and fails it one word over, being published or not (PUBLISHED, both record sets)", (_label, r) => {
      for (const publishing of RUNS) {
        for (const date of [D, EARLIER]) {
          const name = `${String(publishing)} / ${date}`;
          expect(pubWords({ publishing, edit: stored(r.target, r.path, plain(3), plain(r.max), date) }), name).toEqual([]);
          const issues = pubWords({ publishing, edit: stored(r.target, r.path, plain(3), plain(r.max + 1), date) });
          expect(rows(issues), name).toEqual([`${PUB_PATH} | ${message(r.subject, r.max + 1, r.max)}`]);
          expect(issues[0]!.severity).toBe("error");
          expect(issues[0]!.hint).toBe(HINT);
        }
      }
    });

    it.each(UNBUDGETED.map((u) => [u.label, u] as const))("budgets no stored correction's after at %s (PUBLISHED, both record sets)", (_label, u) => {
      for (const publishing of RUNS) expect(pubWords({ publishing, edit: stored(u.target, u.path, plain(3), plain(60)) }), String(publishing)).toEqual([]);
    });

    it("reads an index as a number from 0 with no leading zero, and a path that only starts like a row's as no row (PUBLISHED, both record sets)", () => {
      const named: [Target, string][] = [
        [EDITION, "ideas.01.text"], [EDITION, "ideas.x.text"], [EDITION, "ideas.text"], [EDITION, "ideas.0.text.en"], [EDITION, "xideas.0.text"], [EDITION, "story.update.en"],
        [FINDING, "title.en"], [FINDING, "explainer.found.en"], [FINDING, "explainer.found_x"], [FINDING, "xexplainer.found"], [FINDING, "figure.alt.en"],
        [{ finding_id: "bio-2026-0001" }, "explainer.how_sure.en"], [{ finding_id: "bio-2026-0001" }, "explainer"], [{ finding_id: "bio-2026-0001" }, "xexplainer.how_sure"],
      ];
      for (const publishing of RUNS) {
        for (const [t, path] of named) expect(pubWords({ publishing, edit: stored(t, path, plain(3), plain(80)) }), `${String(publishing)} ${path}`).toEqual([]);
        // The ordinary paths of the same kind are budgeted, so the paths above are no row by their form alone.
        expect(rows(pubWords({ publishing, edit: stored(EDITION, "ideas.10.text", plain(3), plain(41)) })), String(publishing)).toEqual([`${PUB_PATH} | ${message("The idea", 41, 40)}`]);
        expect(rows(pubWords({ publishing, edit: stored({ finding_id: "bio-2026-0001" }, "explainer.how_sure", plain(3), plain(61)) })), String(publishing)).toEqual([`${PUB_PATH} | ${message("The how_sure part", 61, 60)}`]);
      }
    });

    it("reads the first stored correction too, the only one or the first of several (PUBLISHED, both record sets)", () => {
      /** The file holds this correction alone, so it is the first. */
      const alone = (w: PubWorld): void => { w.corrections.length = 0; stored(FINDING, "title", plain(3), plain(13))(w); };
      for (const publishing of RUNS) {
        expect(rows(pubWords({ publishing, edit: alone })), String(publishing)).toEqual([`corrections.json: corrections[0].after.en | ${message("The title", 13, 12)}`]);
      }
    });

    it("never budgets a correction's before, which is text published earlier, whatever its length (PUBLISHED, both record sets)", () => {
      for (const publishing of RUNS) {
        for (const r of ROWS) {
          expect(pubWords({ publishing, edit: stored(r.target, r.path, plain(r.max + 20), plain(2)) }), `${String(publishing)} ${r.path}`).toEqual([]);
        }
      }
    });

    it("skips a string that a stored `removed` correction rewrote, which holds the removed text's four words (PUBLISHED, both record sets)", () => {
      for (const publishing of RUNS) {
        expect(pubWords({ publishing, edit: (w) => { w.corrections.push(removal("C-0003", { finding: BIO }, "title")); } }), String(publishing)).toEqual([]);
        expect(pubWords({ publishing, edit: (w) => { w.corrections.push(removal("C-0003", { edition: D }, "also.0.title")); } }), String(publishing)).toEqual([]);
      }
    });

    it("reads each stored correction at its own path, the older ones too (PUBLISHED, both record sets)", () => {
      const edit = (w: PubWorld): void => {
        stored(FINDING, "title", plain(3), plain(13), EARLIER, "C-0003")(w);
        stored(FINDING, "title", plain(3), plain(12), D, "C-0004")(w);
        stored(EDITION, "ideas.0.text", plain(3), plain(41), D, "C-0005")(w);
      };
      for (const publishing of RUNS) {
        expect(rows(pubWords({ publishing, edit })), String(publishing)).toEqual([
          `corrections.json: corrections[${NEXT_STORED}].after.en | ${message("The title", 13, 12)}`,
          `corrections.json: corrections[${NEXT_STORED + 2}].after.en | ${message("The idea", 41, 40)}`,
        ]);
      }
    });

    describe("an explainer part, whose cap depends on the depth of the finding", () => {
      const partOf = (id: string, name: string, n: number) => stored({ finding_id: id }, `explainer.${name}`, plain(3), plain(n));

      it.each(STORY_PARTS)("caps %s at its story budget on a stored story (PUBLISHED, both record sets)", (name, subject, max) => {
        for (const publishing of RUNS) {
          expect(pubWords({ publishing, edit: partOf(BIO, name, max) }), String(publishing)).toEqual([]);
          expect(rows(pubWords({ publishing, edit: partOf(BIO, name, max + 1) })), String(publishing)).toEqual([`${PUB_PATH} | ${message(subject, max + 1, max)}`]);
        }
      });

      it.each([["background", "The background part"], ["could_lead", "The could_lead part"]])("caps %s at 40 on a stored item (PUBLISHED, both record sets)", (name, subject) => {
        for (const publishing of RUNS) {
          expect(pubWords({ publishing, edit: partOf(MATH, name, 40) }), String(publishing)).toEqual([]);
          expect(rows(pubWords({ publishing, edit: partOf(MATH, name, 41) })), String(publishing)).toEqual([`${PUB_PATH} | ${message(subject, 41, 40)}`]);
        }
      });

      it("gives the other four parts of a stored item no cap of their own, and judges nothing of a finding the stored records do not hold (PUBLISHED, both record sets)", () => {
        for (const publishing of RUNS) {
          // No cap is none at all, however long the text: not a large one.
          for (const name of ["found", "matters", "ai_helped", "how_sure"]) for (const n of [60, 1_500]) expect(pubWords({ publishing, edit: partOf(MATH, name, n) }), `${String(publishing)} ${name} ${n}`).toEqual([]);
          for (const n of [60, 1_500]) expect(pubWords({ publishing, edit: partOf("bio-2020-0001", "background", n) }), `${String(publishing)} ${n}`).toEqual([]);
        }
      });

      it("judges the part a record holds and the correction of it each by its own cap, at its own path (PUBLISHED, both record sets)", () => {
        const edit = (w: PubWorld): void => {
          setStored(BIO, [56, 40, 50, 50, 30, 30])(w);
          partOf(BIO, "found", 56)(w);
        };
        for (const publishing of RUNS) {
          expect(rows(pubWords({ publishing, edit })), String(publishing)).toEqual([
            `${PUB_PATH} | ${message("The found part", 56, 55)}`,
            `${FILE(BIO)}: explainer.found.en | ${overMessage("The found part", 56, 55)}`,
          ]);
        }
      });
    });
  });
});

// ── SENTENCE_LENGTH ──────────────────────────────────────────────────────────────────────────────

const sentencesOf = (scene: Scene = {}): ValidationIssue[] => only(draftRun("SENTENCE_LENGTH", scene), "SENTENCE_LENGTH");
const pubSentences = (scene: PubScene = {}): ValidationIssue[] => only(pubRun("SENTENCE_LENGTH", scene), "SENTENCE_LENGTH");

/** The strings of model prose a draft holds, each with the way to put a text in it. */
const PROSE: { label: string; path: string; edition?: Edition; set: (d: Json, t: string) => void }[] = [
  ...CAPS.map(({ label, path, edition, set }) => ({ label, path, edition, set })),
  { label: "a Lead line", path: "lead[0].text", set: (d, t) => { d.lead[0].text = t; } },
  { label: "the deep dive", path: "deep_dive.text", edition: "sunday", set: (d, t) => { d.deep_dive.text = t; } },
  { label: "the big picture", path: "review.big_picture", edition: "monday", set: (d, t) => { d.review.big_picture = t; } },
  {
    label: "a correction's after, at a prose path", path: "corrections[0].after",
    set: (d, t) => {
      d.corrections[0] = {
        finding_id: "math-2026-0002", edition_date: null, term_id: null, type: "correction", path: "explainer.found", after: t,
        reason: "The text was wrong.", source_url: null, report_id: "R-0002",
      };
    },
  },
];

describe("SENTENCE_LENGTH, draft mode: every sentence of model prose has at most 24 words", () => {
  it.each(PROSE.map((c) => [c.label, c] as const))("%s: a sentence of 24 words passes, one of 25 fails", (_label, c) => {
    const scene = (n: number): Scene => ({ edition: c.edition, edit: (d) => c.set(d, plain(n, n)) });
    expect(sentencesOf(scene(24))).toEqual([]);
    const issue = one(sentencesOf(scene(25)), "SENTENCE_LENGTH", c.path);
    expect(issue.message).toBe(`${c.path} has a sentence of 25 words ("The team ran a test and saw small ..."); the limit is 24. Split it in two, or cut at least 1.`);
    expect(issue.hint).toContain("A semicolon or a colon does not end a sentence");
  });

  it("reports each long sentence of a string, with its own words and the words to cut", () => {
    const text = `${plain(30, 30)} ${plain(5)} Another ${plain(24, 24).toLowerCase()} Then ${plain(3)}`;
    const issues = sentencesOf({ edit: (d) => { d.lead[0].text = text; } });
    expect(issues.map((i) => i.message).sort()).toEqual([
      'lead[0].text has a sentence of 25 words ("Another the team ran a test and saw ..."); the limit is 24. Split it in two, or cut at least 1.',
      'lead[0].text has a sentence of 30 words ("The team ran a test and saw small ..."); the limit is 24. Split it in two, or cut at least 6.',
    ]);
  });

  it("says nothing of a string with several short sentences, however long it is", () => {
    expect(sentencesOf({ edit: (d) => { d.lead[0].text = `${plain(24, 24)} ${plain(24, 24)} ${plain(24, 24)}`; } })).toEqual([]);
    expect(sentencesOf({ edition: "sunday", edit: (d) => { d.deep_dive.text = plain(540, 24); } })).toEqual([]);
  });

  it("never splits a quotation: a quoted span with a stop in it is one sentence, so a long quote makes a long sentence", () => {
    const inside = `${plain(14, 14)} ${plain(14, 14)}`;
    for (const [open, close] of [['"', '"'], [LDQ, RDQ]]) {
      const quoted = sentencesOf({ edit: (d) => { d.lead[0].text = `The team said ${open}${inside}${close} and left.`; } });
      expect(one(quoted, "SENTENCE_LENGTH", "lead[0].text").message).toContain("a sentence of 33 words");
    }
    expect(sentencesOf({ edit: (d) => { d.lead[0].text = `The team said ${inside} and left.`; } })).toEqual([]);
  });

  it("does not end a sentence at a semicolon or a colon", () => {
    const joined = `${plain(15, 15).slice(0, -1)}; ${plain(15, 15).toLowerCase()}`;
    expect(one(sentencesOf({ edit: (d) => { d.lead[0].text = joined; } }), "SENTENCE_LENGTH", "lead[0].text").message).toContain("a sentence of 30 words");
    const colon = `${plain(15, 15).slice(0, -1)}: ${plain(15, 15).toLowerCase()}`;
    expect(one(sentencesOf({ edit: (d) => { d.lead[0].text = colon; } }), "SENTENCE_LENGTH", "lead[0].text").message).toContain("a sentence of 30 words");
    expect(sentencesOf({ edit: (d) => { d.lead[0].text = `${plain(15, 15)} ${plain(15, 15)}`; } })).toEqual([]);
  });

  it("counts a hyphenated word as one word", () => {
    const text = `A ${Array.from({ length: 23 }, () => "well-known").join(" ")}.`;
    expect(countWords(text)).toBe(24);
    expect(sentencesOf({ edit: (d) => { d.lead[0].text = text; } })).toEqual([]);
    expect(sentencesOf({ edit: (d) => { d.lead[0].text = `A ${Array.from({ length: 24 }, () => "well-known").join(" ")}.`; } })).toHaveLength(1);
  });

  it("does not read what is not model prose: a quote, a source's title, a name", () => {
    const long = plain(30, 30);
    const issues = sentencesOf({
      edit: (d) => {
        const f = d.new_findings[0];
        f.ai.evidence[0].quote = long;
        f.reactions[0].quote = long;
        f.sources[0].title = long;
        f.sources[0].publisher = plain(12, 12);
        f.who[0].name = plain(12, 12);
        d.ideas[0].who = plain(12, 12);
      },
    });
    expect(issues).toEqual([]);
  });
});

describe("SENTENCE_LENGTH, published mode: every record, being published or not", () => {
  const PUB_PROSE = PUB_CAPS;

  it.each(PUB_PROSE.map((c) => [c.label, c] as const))("%s: a sentence of 24 words passes, one of 25 fails, on every record", (_label, c) => {
    for (const publishing of [D, null, EARLIER]) {
      const scene = (n: number): PubScene => ({ publishing, edit: (w) => { c.prepare?.(w); c.set(w, plain(n, n)); } });
      expect(pubSentences(scene(24)), `24 words, publishing ${publishing}`).toEqual([]);
      const issue = one(pubSentences(scene(25)), "SENTENCE_LENGTH", c.path);
      expect(issue.message, `publishing ${publishing}`).toBe(`${c.path} has a sentence of 25 words ("The team ran a test and saw small ..."); the limit is 24. Split it in two, or cut at least 1.`);
    }
  });

  it("reads a stored correction's after at a prose path, and not its before", () => {
    const edit = (w: PubWorld): void => {
      w.corrections.push(rewrite("C-0003", D, BIO, "explainer.found", plain(30, 30), plain(30, 30)));
    };
    for (const publishing of [D, null]) {
      const issues = pubSentences({ publishing, edit });
      expect(issues.map((i) => i.path)).toEqual(["corrections.json: corrections[2].after.en"]);
    }
  });

  it("does not read the Chinese side of a record", () => {
    const edit = (w: PubWorld): void => { finding(w, BIO).explainer.found.zh = plain(60, 60); finding(w, BIO).title.zh = plain(60, 60); };
    expect(pubSentences({ edit })).toEqual([]);
  });

  it("skips a string that a stored correction removed, whatever it holds", () => {
    const edit = (stored: boolean) => (w: PubWorld): void => {
      finding(w, BIO).explainer.found = lzp(fill(50, "Protein folding."));
      finding(w, BIO).explainer.how_sure = lzp(plain(40, 40));
      if (stored) { w.corrections.push(removal("C-0003", { finding: BIO }, "explainer.how_sure")); holdRemoved(w as never); }
    };
    for (const publishing of PUBLISHING) {
      expect(pubSentences({ publishing, edit: edit(true) })).toEqual([]);
      expect(pubSentences({ publishing, edit: edit(false) }).map((i) => i.path)).toEqual([`${FILE(BIO)}: explainer.how_sure.en`]);
    }
  });
});

// ── NO_EM_DASH ───────────────────────────────────────────────────────────────────────────────────

const dashesOf = (scene: Scene = {}): ValidationIssue[] => only(draftRun("NO_EM_DASH", scene), "NO_EM_DASH");
const pubDashes = (scene: PubScene = {}): ValidationIssue[] => only(pubRun("NO_EM_DASH", scene), "NO_EM_DASH");

/** The hint every NO_EM_DASH issue carries. */
const DASH_HINT = "An en dash is allowed only between digits. Quotes, a source's title and the text of a correction at such a path keep their own dashes.";
const rewriteHint = 'Rewrite it with a comma, a colon or two sentences; write a range of numbers with "to".';

/** A draft correction of a stored finding's text at `path`, with the text after it. */
const draftCorrection = (path: string, after: string): Json => ({
  finding_id: "math-2026-0002", edition_date: null, term_id: null, type: "correction", path, after,
  reason: "The text was wrong.", source_url: null, report_id: "R-0002",
});

describe("NO_EM_DASH, draft mode: no U+2014, and no U+2013 except between digits", () => {
  it("fails an em dash in a finding's found part, and an en dash between letters in its title (the spec's examples)", () => {
    const found = dashesOf({ edit: (d) => { d.new_findings[0].explainer.found = `A sample ${EM} found text.`; } });
    const issue = one(found, "NO_EM_DASH", "new_findings[0].explainer.found");
    expect(issue.message).toBe(`new_findings[0].explainer.found has 1 em dash (U+2014), near "A sample ${EM} found text.". ${rewriteHint}`);
    expect(issue.hint).toBe(DASH_HINT);
    const title = dashesOf({ edit: (d) => { d.new_findings[0].title = `A sample${EN}protein result`; } });
    expect(one(title, "NO_EM_DASH", "new_findings[0].title").message).toBe(
      `new_findings[0].title has 1 en dash (U+2013) outside a range of digits, near "A sample${EN}protein result". ${rewriteHint}`,
    );
  });

  it("passes what is kept as published, holding an em dash and an en dash between letters: a source's title, an evidence quote, a reaction quote and a licence quote", () => {
    const both = `A${EM}b and c${EN}d`;
    const issues = dashesOf({
      edit: (d) => {
        const f = d.new_findings[0];
        f.sources[0].title = both;
        f.ai.evidence[0].quote = both;
        f.reactions[0].quote = both;
        f.figure = { ...FIGURE, licence_quote: both };
      },
    });
    expect(issues).toEqual([]);
  });

  it("passes a draft correction's after when its path names a quote or a source's title, and fails it at any other path", () => {
    const both = `A${EM}b and c${EN}d`;
    expect(dashesOf({ edit: (d) => { d.corrections[0] = draftCorrection("ai.evidence.0.quote", both); } })).toEqual([]);
    expect(dashesOf({ edit: (d) => { d.corrections[0] = draftCorrection("sources.0.title", both); } })).toEqual([]);
    expect(dashesOf({ edit: (d) => { d.corrections[0] = draftCorrection("reactions.0.quote", both); } })).toEqual([]);
    const prose = dashesOf({ edit: (d) => { d.corrections[0] = draftCorrection("explainer.found", both); } });
    expect(one(prose, "NO_EM_DASH", "corrections[0].after").message).toContain("has 1 em dash (U+2014), 1 en dash (U+2013) outside a range of digits");
    expect(one(dashesOf({ edit: (d) => { d.corrections[0] = draftCorrection("title", both); } }), "NO_EM_DASH", "corrections[0].after")).toBeDefined();
  });

  it("counts an en dash between two digits as a range, whatever the digits are", () => {
    const ok = ["from 2015" + EN + "2019", "the 10" + EN + "20% band", "pages 1" + EN + "2" + EN + "3", "in 0" + EN + "9", "an 8" + EN + "10 range", "gaps of 3" + EN + "4,5"];
    for (const text of ok) expect(dashesOf({ edit: (d) => { d.ideas[0].text = text; } }), text).toEqual([]);
    const arabic = `${String.fromCharCode(0x663)}${EN}${String.fromCharCode(0x665)}`;
    expect(dashesOf({ edit: (d) => { d.ideas[0].text = `A range ${arabic}.`; } })).toEqual([]);
  });

  it("fails an en dash with a digit on one side only, or on neither, or with a space beside it", () => {
    const bad = [
      `from 2015 ${EN} 2019`, `from 2015${EN} 2019`, `from 2015 ${EN}2019`, `a${EN}b`, `5${EN}`, `${EN}5`, `5${EN}a`, `a${EN}5`, `year${EN}2019`, `2019${EN}year`,
      `${EN}`, `x ${EN} y`, `1${EN}${EN}2`,
    ];
    for (const text of bad) {
      expect(one(dashesOf({ edit: (d) => { d.ideas[0].text = text; } }), "NO_EM_DASH", "ideas[0].text").message, text).toContain("en dash");
    }
  });

  it("fails an em dash anywhere, between digits and in a quoted word of the prose too", () => {
    for (const text of [`1${EM}2`, `${EM}`, `a ${EM}`, `say ${LDQ}a${EM}b${RDQ} now`, `${EM}${EM}`]) {
      expect(one(dashesOf({ edit: (d) => { d.ideas[0].text = text; } }), "NO_EM_DASH", "ideas[0].text").message, text).toContain("em dash");
    }
  });

  it("counts every dash of a string, em and en alike, and shows where the first one is", () => {
    const text = `Some words come before. Then ${EM} one, ${EM} two and a${EN}b and c${EN}d.`;
    const issue = one(dashesOf({ edit: (d) => { d.ideas[0].text = text; } }), "NO_EM_DASH", "ideas[0].text");
    // The snippet runs from 20 characters before the first dash to 20 after it.
    expect(issue.message).toBe(
      `ideas[0].text has 2 em dashes (U+2014), 2 en dashes (U+2013) outside a range of digits, near "s come before. Then ${EM} one, ${EM} two and a${EN}b ". ${rewriteHint}`,
    );
  });

  it("shows the text around the first dash even when it is the first character of the string, and not the next one", () => {
    const text = `${EM}A made-up opening with a long way to go and ${EM} another dash.`;
    const issue = one(dashesOf({ edit: (d) => { d.ideas[0].text = text; } }), "NO_EM_DASH", "ideas[0].text");
    expect(issue.message).toBe(`ideas[0].text has 2 em dashes (U+2014), near "${EM}A made-up opening wi". ${rewriteHint}`);
  });

  it("shows the text around the first dash with every run of white space as one space", () => {
    const text = `Two\nlines   here ${EM} then\ttabs.`;
    const issue = one(dashesOf({ edit: (d) => { d.ideas[0].text = text; } }), "NO_EM_DASH", "ideas[0].text");
    expect(issue.message).toBe(`ideas[0].text has 1 em dash (U+2014), near "Two lines here ${EM} then tabs.". ${rewriteHint}`);
  });

  it("reads a digit of any script and any plane: an en dash between two mathematical digits is a range, and the text shown starts at the right place after a letter outside the first plane", () => {
    const one2 = `${String.fromCodePoint(0x1d7cf)}${EN}${String.fromCodePoint(0x1d7d0)}`;
    expect(dashesOf({ edit: (d) => { d.ideas[0].text = `A range ${one2}.`; } })).toEqual([]);
    const smile = String.fromCodePoint(0x1f642);
    const text = `${smile.repeat(8)} then a short run of words ${EM} and a tail of more words that goes on.`;
    const issue = one(dashesOf({ edit: (d) => { d.ideas[0].text = text; } }), "NO_EM_DASH", "ideas[0].text");
    const at2 = text.indexOf(EM);
    expect(issue.message).toContain(`near "${text.slice(Math.max(0, at2 - 20), at2 + 21)}"`);
  });

  it("does not forbid the other dashes and minus signs: a hyphen, U+2010, U+2011, U+2012, U+2015, U+2212 and a double hyphen", () => {
    const text = ["a-b", `a${HY}b`, `a${ch(0x2011)}b`, `a${ch(0x2012)}b`, `a${ch(0x2015)}b`, `a${ch(0x2212)}b`, "a--b"].join(" ");
    expect(dashesOf({ edit: (d) => { d.ideas[0].text = text; } })).toEqual([]);
  });

  // The strings of every kind the rule reads, and the way to put a text in each.
  const READ: [string, string, (d: Json, t: string) => void, Edition?][] = [
    ...PROSE.filter((c) => c.label !== "a correction's after, at a prose path").map((c): [string, string, (d: Json, t: string) => void, Edition?] => [c.label, c.path, c.set, c.edition]),
    ["a correction's after, at a prose path", "corrections[0].after", (d, t) => { d.corrections[0] = draftCorrection("explainer.found", t); }],
    ["a source's publisher", "new_findings[0].sources[0].publisher", (d, t) => { d.new_findings[0].sources[0].publisher = t; }],
    ["a who entry's name", "new_findings[0].who[0].name", (d, t) => { d.new_findings[0].who[0].name = t; }],
    ["a reaction's who", "new_findings[0].reactions[0].who", (d, t) => { d.new_findings[0].reactions[0].who = t; }],
    ["a reaction's affiliation", "new_findings[0].reactions[0].affiliation", (d, t) => { d.new_findings[0].reactions[0].affiliation = t; }],
    ["an AI system's name", "new_findings[0].ai.systems[0].name", (d, t) => { d.new_findings[0].ai.systems[0].name = t; }],
    ["an AI system's maker", "new_findings[0].ai.systems[0].maker", (d, t) => { d.new_findings[0].ai.systems[0].maker = t; }],
    ["a figure's credit", "new_findings[0].figure.credit", (d, t) => { d.new_findings[0].figure = { ...FIGURE, credit: t }; }],
    ["a new term's name", "new_findings[0].terms[0].term", (d, t) => { d.new_findings[0].terms[0].term = t; }],
    ["an idea's author", "ideas[0].who", (d, t) => { d.ideas[0].who = t; }],
    ["a source's URL", "new_findings[0].sources[0].url", (d, t) => { d.new_findings[0].sources[0].url = `https://example.org/${t.replace(/\s+/g, "-")}`; }],
    ["a figure's image URL", "new_findings[0].figure.image_url", (d, t) => { d.new_findings[0].figure = { ...FIGURE, image_url: `https://example.org/${t.replace(/\s+/g, "-")}` }; }],
    ["a correction's source URL", "corrections[0].source_url", (d, t) => { d.corrections[0].source_url = `https://example.org/${t.replace(/\s+/g, "-")}`; }],
    ["a DOI", "new_findings[0].artefacts.doi[0]", (d, t) => { d.new_findings[0].artefacts.doi = [`10.1234/${t.replace(/\s+/g, "-")}`]; }],
  ];

  it.each(READ.map((r) => [r[0], r] as const))("reads %s", (_label, [, path, set, edition]) => {
    expect(dashesOf({ edition, edit: (d) => set(d, "A clean text.") })).toEqual([]);
    const issue = one(dashesOf({ edition, edit: (d) => set(d, `A ${EM} dash`) }), "NO_EM_DASH", path);
    expect(issue.message).toContain("has 1 em dash (U+2014)");
    one(dashesOf({ edition, edit: (d) => set(d, `A c${EN}d dash`) }), "NO_EM_DASH", path);
  });

  it("does not read ids, dates and vocabulary values, which hold no text", () => {
    expect(dashesOf({ edit: (d) => { d.new_findings[0].first_published = "2026-11-20"; d.corrections[0].path = "significance"; } })).toEqual([]);
  });
});

describe("NO_EM_DASH, published mode: every string of a stored record but the Chinese and the text kept as published", () => {
  it.each(PUB_CAPS.map((c) => [c.label, c] as const))("reads %s, being published or not", (_label, c) => {
    for (const publishing of [D, null, EARLIER]) {
      const scene = (text: string): PubScene => ({ publishing, edit: (w) => { c.prepare?.(w); c.set(w, text); } });
      expect(pubDashes(scene("A clean text.")), `clean, publishing ${publishing}`).toEqual([]);
      expect(one(pubDashes(scene(`A ${EM} dash`)), "NO_EM_DASH", c.path).message, `publishing ${publishing}`).toContain("has 1 em dash (U+2014)");
      one(pubDashes(scene(`A c${EN}d dash`)), "NO_EM_DASH", c.path);
    }
  });

  const OTHER: [string, string, (w: PubWorld, t: string) => void][] = [
    ["a stored brief's Pace sentence", `${BRIEF_FILE}: pace.sentence.en`, (w, t) => { briefOf(w).pace.sentence = lzp(t); }],
    ["a stored source's publisher", `${FILE(BIO)}: sources[0].publisher`, (w, t) => { finding(w, BIO).sources[0].publisher = t; }],
    ["a stored who entry's name", `${FILE(BIO)}: who[0].name`, (w, t) => { finding(w, BIO).who[0].name = t; }],
    ["a stored source's URL", `${FILE(BIO)}: sources[0].url`, (w, t) => { finding(w, BIO).sources[0].url = `https://example.org/${t.replace(/\s+/g, "-")}`; }],
    ["a glossary term's English name", "glossary.json: terms[0].en.term", (w, t) => { w.terms[0]!.en.term = t; }],
    ["a stored correction's source URL", "corrections.json: corrections[0].source_url", (w, t) => { w.corrections[0]!.source_url = `https://example.org/${t.replace(/\s+/g, "-")}`; }],
    ["a stored report's evidence URL", "reports.json: reports[0].evidence_url", (w, t) => { w.reports[0]!.evidence_url = `https://example.org/${t.replace(/\s+/g, "-")}`; }],
  ];

  it.each(OTHER.map((o) => [o[0], o] as const))("reads %s", (_label, [, path, set]) => {
    for (const publishing of [D, null]) {
      expect(pubDashes({ publishing, edit: (w) => set(w, `A ${EM} dash`) }).map((i) => i.path)).toEqual([path]);
    }
  });

  it("does not read the Chinese side of a record: a title, an explainer part, a glossary term's name, definition and official name", () => {
    const edit = (w: PubWorld): void => {
      finding(w, BIO).title.zh = `範例${EM}成果${EN}`;
      finding(w, BIO).explainer.found.zh = `範例${EM}發現`;
      finding(w, BIO).rung_history[1].note.zh = `範例${EM}`;
      w.terms[0]!.zh!.term = `蛋白質${EM}摺疊`;
      w.terms[0]!.zh!.definition = `一串${EN}胺基酸${EM}`;
      w.terms[0]!.zh!.official = `蛋白質${EM}摺疊${EN}`;
      briefOf(w).lead[0].text.zh = `今天${EM}重點`;
    };
    for (const publishing of [D, null]) expect(pubDashes({ publishing, edit })).toEqual([]);
  });

  it("passes a stored source title, evidence quote, reaction quote and licence quote that hold both dashes", () => {
    const both = `A${EM}b and c${EN}d`;
    const edit = (w: PubWorld): void => {
      const f = finding(w, BIO);
      f.sources[0].title = both;
      f.ai.evidence[0].quote = both;
      f.reactions[0].quote = both;
      f.figure = { ...FIGURE, licence_quote: both, alt: lzp("A made-up chart.") };
    };
    for (const publishing of [D, null]) expect(pubDashes({ publishing, edit })).toEqual([]);
  });

  const stored = (path: string, before: string, after: string, type: "correction" | "update" = "correction") => (w: PubWorld): void => {
    w.corrections.push(rewrite("C-0003", D, BIO, path, before, after, type));
  };

  it("passes a stored correction's before and after at a quote's path or a source title's, which hold both dashes", () => {
    const both = `A${EM}b and c${EN}d`;
    for (const path of ["ai.evidence.0.quote", "reactions.0.quote", "sources.0.title", "figure.licence_quote"]) {
      for (const publishing of [D, null]) expect(pubDashes({ publishing, edit: stored(path, both, both) }), `${path}, publishing ${publishing}`).toEqual([]);
    }
  });

  it("reads a stored correction's before and after at any other path, which keep the rule's dashes out", () => {
    const issues = pubDashes({ edit: stored("explainer.found", `A${EM}b`, `A${EM}c`) });
    expect(issues.map((i) => i.path).sort()).toEqual(["corrections.json: corrections[2].after.en", "corrections.json: corrections[2].before.en"]);
    const title = pubDashes({ publishing: null, edit: stored("title", `A${EN}b`, "Clean") });
    expect(title.map((i) => i.path)).toEqual(["corrections.json: corrections[2].before.en"]);
  });

  it("skips a string that a stored correction removed, whatever it holds", () => {
    const edit = (stored: boolean) => (w: PubWorld): void => {
      finding(w, BIO).explainer.how_sure = lzp(`Checked ${EM} by Example Journal.`);
      if (stored) { w.corrections.push(removal("C-0003", { finding: BIO }, "explainer.how_sure")); holdRemoved(w as never); }
    };
    for (const publishing of PUBLISHING) {
      expect(pubDashes({ publishing, edit: edit(true) })).toEqual([]);
      expect(pubDashes({ publishing, edit: edit(false) }).map((i) => i.path)).toEqual([`${FILE(BIO)}: explainer.how_sure.en`]);
    }
  });

  it("passes a term's official name, which holds both dashes and which the Chinese rule reads", () => {
    const edit = (w: PubWorld): void => { w.terms[0]!.zh!.official = `蛋白質${EM}摺疊${EN}a${EN}b`; };
    for (const publishing of [D, null]) expect(pubDashes({ publishing, edit })).toEqual([]);
  });
});

// ── HYPE_WORDS ───────────────────────────────────────────────────────────────────────────────────

const hypeOf = (scene: Scene = {}): ValidationIssue[] => only(draftRun("HYPE_WORDS", scene), "HYPE_WORDS");
const pubHype = (scene: PubScene = {}): ValidationIssue[] => only(pubRun("HYPE_WORDS", scene), "HYPE_WORDS");

const HYPE_EN = [
  "revolutionary", "game-changing", "groundbreaking", "paradigm shift", "unprecedented", "stunning", "mind-blowing", "changes everything", "breakthrough",
];
const HYPE_HINT = "A name that holds the word (the Breakthrough Prize), a quote and a source's title keep their own words.";
const LANDMARK_ONLY = ' "breakthrough" stands only in the text of a Landmark finding, its returning updates and corrections, and the deep dive or remarkable note on one.';
/** The message of a string that holds these words of the list (in the list's order). */
const hypeMessage = (path: string, words: readonly string[]): string =>
  `${path} uses ${words.map((w) => `"${w}"`).join(", ")}, which the brief does not use.${words.includes("breakthrough") ? LANDMARK_ONLY : ""} Say what happened and let the reader judge.`;

/** A config whose list holds these words and whose names hold these phrases. */
const withHype = (en: string[], names: string[] = []): LoadedConfig => {
  const c = config();
  return { ...c, hypeWords: { ...c.hypeWords, en }, index: { ...c.index, hypeNames: { en: names, zh: [] } } } as LoadedConfig;
};

/** A context of the edition with one change, parsed again. */
function contextWith(edition: Edition, edit: (c: Json) => void): AgentContext {
  const json = clone(contextOf(edition)) as unknown as Json;
  edit(json);
  return AgentContext.parse(json);
}
/** Sets the significance of every entry of the context that describes the finding: the recent list, a report's finding, a week's or a Sunday candidate. */
function setSignificance(node: unknown, id: string, value: string): void {
  if (Array.isArray(node)) {
    for (const n of node) setSignificance(n, id, value);
  } else if (typeof node === "object" && node !== null) {
    const o = node as Json;
    if (o.id === id && typeof o.significance === "string") o.significance = value;
    for (const v of Object.values(o)) setSignificance(v, id, value);
  }
}
const contextLandmark = (edition: Edition, id: string, value = "landmark"): AgentContext => contextWith(edition, (c) => setSignificance(c, id, value));

/** A correction of a stored finding's text, added after the draft's own three (it names no report). */
const addCorrection = (path: string, after: string, finding = "math-2026-0002"): Edit => (d) => {
  d.corrections.push({ ...draftCorrection(path, after), finding_id: finding, report_id: null });
};
/** The draft's first correction, which makes `math-2026-0002` a Landmark, filed as `after` instead. */
const fileMathAs = (after: string): Edit => (d) => { d.corrections[0].after = after; };

const A_BREAKTHROUGH = "It was a breakthrough for the field.";
const slug = (t: string): string => t.replace(/\s+/g, "-");
const HOW_SURE = "new_findings[0].explainer.how_sure";
const inHowSure = (text: string): Scene => ({ edit: (d) => { d.new_findings[0].explainer.how_sure = text; } });

describe("HYPE_WORDS, draft mode: no word of the list in the strings the spec names", () => {
  it("is the list and the names of config/hype-words.json", () => {
    // The nine seed words come first; the plurals, spellings and derived forms that follow them are tested below.
    expect(config().hypeWords.en.slice(0, HYPE_EN.length)).toEqual(HYPE_EN);
    expect(config().index.hypeNames.en).toEqual(expect.arrayContaining(["Breakthrough Prize", "Breakthrough Listen", "Breakthrough Therapy", "Breakthrough Device"]));
  });

  it.each(HYPE_EN.map((w) => [w] as const))('fails "%s" in a Major finding, with the path, the word and the edit to make', (w) => {
    const issues = hypeOf(inHowSure(`It was a ${w} for the field.`));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.path).toBe(HOW_SURE);
    expect(issues[0]!.message).toBe(hypeMessage(HOW_SURE, [w]));
    expect(issues[0]!.hint).toBe(HYPE_HINT);
  });

  it("fails each plural, spelling and derived form that follows the seed in config/hype-words.json, as it fails a seed word", () => {
    const forms = config().hypeWords.en.slice(HYPE_EN.length);
    expect(forms.length).toBeGreaterThanOrEqual(20);
    for (const form of forms) {
      const issues = hypeOf(inHowSure(`It was a ${form} for the field.`));
      expect(issues.map((i) => `${i.severity} | ${i.path} | ${i.message}`), form).toEqual([`error | ${HOW_SURE} | ${hypeMessage(HOW_SURE, [form])}`]);
    }
  });

  it("matches whole words in any case, with a space, a hyphen, U+2010 or U+2011 or a line break between the words of an entry", () => {
    const fail: [string, string][] = [
      ["BREAKTHROUGH", "breakthrough"], ["Breakthrough", "breakthrough"], ["bReAkThRoUgH", "breakthrough"], ["REVOLUTIONARY", "revolutionary"],
      ["Game Changing", "game-changing"], ["game  changing", "game-changing"], [`game${HY}changing`, "game-changing"], [`game${ch(0x2011)}changing`, "game-changing"],
      ["game-changing", "game-changing"], ["Mind blowing", "mind-blowing"], ["paradigm-shift", "paradigm shift"], ["Paradigm   Shift", "paradigm shift"],
      ["It changes\neverything", "changes everything"], ["Changes Everything", "changes everything"], ["(breakthrough)", "breakthrough"],
      ["a breakthrough.", "breakthrough"], ["the breakthrough's size", "breakthrough"], ["post-breakthrough", "breakthrough"], ["a breakthrough, then another", "breakthrough"],
      ["breakthroughs", "breakthroughs"], ["unprecedentedly", "unprecedentedly"], ["stunningly", "stunningly"], ["game changers", "game-changers"],
      ["ground breaking", "ground-breaking"], ["Paradigm Shifts", "paradigm shifts"], ["gamechanging", "gamechanging"], ["Revolutionize", "revolutionize"],
    ];
    for (const [text, word] of fail) expect(hypeOf(inHowSure(`A ${text} for us.`)).map((i) => i.message), text).toEqual([hypeMessage(HOW_SURE, [word])]);
    const pass = [
      "restunning", "revolutionaries", "everything changes", "a paradigm and a shift", "mind blown", "game changed",
      "the changes in everything", "breakthroughx", "xbreakthrough", "a break through", "breakthroughsx", "unprecedentedlyx",
    ];
    for (const text of pass) expect(hypeOf(inHowSure(`A ${text} for us.`)), text).toEqual([]);
  });

  it("gives one issue to a string, with each word it holds once in the list's order, and one to each string that holds one", () => {
    const text = "It was stunning, a breakthrough, and unprecedented; stunning again, a BREAKTHROUGH.";
    const one1 = hypeOf(inHowSure(text));
    expect(one1).toHaveLength(1);
    expect(one1[0]!.message).toBe(hypeMessage(HOW_SURE, ["unprecedented", "stunning", "breakthrough"]));
    const two = hypeOf({ edit: (d) => { d.new_findings[0].explainer.how_sure = "It was stunning."; d.new_findings[0].explainer.found = "It was stunning too."; d.lead[0].text = "It was stunning."; } });
    expect(two.map((i) => i.path)).toEqual(["lead[0].text", "new_findings[0].explainer.found", HOW_SURE]);
  });

  // The prose and the free text of a draft, each with the way to put a text in it.
  const READ: { label: string; path: string; edition?: Edition; set: (d: Json, t: string) => void }[] = [
    ...PROSE.filter((c) => !c.label.startsWith("a correction's after")),
    { label: "a correction's after, at a prose path", path: "corrections[3].after", set: (d, t) => addCorrection("explainer.found", t)(d) },
    { label: "a figure's credit", path: "new_findings[0].figure.credit", set: (d, t) => { d.new_findings[0].figure = { ...FIGURE, credit: t }; } },
    { label: "a new term's name", path: "new_findings[0].terms[0].term", set: (d, t) => { d.new_findings[0].terms[0].term = t; } },
  ];

  it.each(READ.map((r) => [r.label, r] as const))("reads %s", (_label, r) => {
    expect(hypeOf({ edition: r.edition, edit: (d) => r.set(d, "A clean text.") })).toEqual([]);
    const issues = hypeOf({ edition: r.edition, edit: (d) => r.set(d, "An unprecedented text.") });
    expect(issues.map((i) => `${i.path} | ${i.message}`)).toEqual([`${r.path} | ${hypeMessage(r.path, ["unprecedented"])}`]);
  });

  // What keeps its own words: a quote, a source's title, an address, a name, and a correction's text at the path of one of them.
  const BOTH = "A breakthrough and an unprecedented result.";
  const UNREAD: [string, Edit][] = [
    ["an evidence quote", (d) => { d.new_findings[0].ai.evidence[0].quote = BOTH; }],
    ["a reaction's quote", (d) => { d.new_findings[0].reactions[0].quote = BOTH; }],
    ["a licence quote", (d) => { d.new_findings[0].figure = { ...FIGURE, licence_quote: BOTH }; }],
    ["a finding source's title", (d) => { d.new_findings[0].sources[0].title = BOTH; }],
    ["a brief source's title", (d) => { d.sources[0].title = BOTH; }],
    ["a finding source's publisher", (d) => { d.new_findings[0].sources[0].publisher = BOTH; }],
    ["a brief source's publisher", (d) => { d.sources[0].publisher = BOTH; }],
    ["a who entry's name", (d) => { d.new_findings[0].who[0].name = BOTH; }],
    ["a reaction's who", (d) => { d.new_findings[0].reactions[0].who = BOTH; }],
    ["a reaction's affiliation", (d) => { d.new_findings[0].reactions[0].affiliation = "Breakthrough Institute"; }],
    ["an idea's author", (d) => { d.ideas[0].who = BOTH; }],
    ["an AI system's name", (d) => { d.new_findings[0].ai.systems[0].name = BOTH; }],
    ["an AI system's maker", (d) => { d.new_findings[0].ai.systems[0].maker = BOTH; }],
    ["the path of a source's URL", (d) => { d.new_findings[0].sources[0].url = `https://example.org/${slug("breakthrough-devices-program")}`; }],
    ["the path of a figure's image URL", (d) => { d.new_findings[0].figure = { ...FIGURE, image_url: "https://example.org/unprecedented-breakthrough.png" }; }],
    ["a correction's source URL", (d) => { d.corrections[0].source_url = "https://example.org/unprecedented-breakthrough"; }],
    ["a DOI", (d) => { d.new_findings[0].artefacts.doi = ["10.1234/unprecedented-breakthrough"]; }],
    ["a correction's after at a reaction's affiliation", addCorrection("reactions.0.affiliation", "Breakthrough Institute", "bio-2026-0001")],
    ["a correction's after at a reaction's who", addCorrection("reactions.0.who", BOTH)],
    ["a correction's after at a who entry's name", addCorrection("who.0.name", BOTH)],
    ["a correction's after at a source's publisher", addCorrection("sources.0.publisher", BOTH)],
    ["a correction's after at an AI system's name", addCorrection("ai.systems.0.name", BOTH)],
    ["a correction's after at an AI system's maker", addCorrection("ai.systems.0.maker", BOTH)],
    ["a correction's after at an evidence quote", addCorrection("ai.evidence.0.quote", BOTH)],
    ["a correction's after at a reaction's quote", addCorrection("reactions.0.quote", BOTH)],
    ["a correction's after at a licence quote", addCorrection("figure.licence_quote", BOTH)],
    ["a correction's after at a source's title", addCorrection("sources.0.title", BOTH)],
    ["a correction's after at a source's URL", addCorrection("sources.0.url", "https://example.org/unprecedented-breakthrough")],
  ];

  it("has a text that the rule rejects where it reads it", () => {
    expect(hypeOf(inHowSure(BOTH)).map((i) => i.message)).toEqual([hypeMessage(HOW_SURE, ["unprecedented", "breakthrough"])]);
  });

  it("keeps an idea's author as a name, such as the Breakthrough Institute, and still reads the idea's own text", () => {
    const attributed = (who: string, text: string): Edit => (d) => { d.ideas[0].who = who; d.ideas[0].text = text; };
    expect(hypeOf({ edit: attributed("Breakthrough Institute", "A clean text.") })).toEqual([]);
    expect(hypeOf({ edit: attributed("The Unprecedented Group", "A clean text.") })).toEqual([]);
    const issues = hypeOf({ edit: attributed("Breakthrough Institute", "A breakthrough for the field.") });
    expect(issues.map((i) => `${i.path} | ${i.message}`)).toEqual([`ideas[0].text | ${hypeMessage("ideas[0].text", ["breakthrough"])}`]);
    // A correction of the author is the same name: its after keeps its own words as well.
    const corrected: Edit = (d) => { d.corrections.push({ ...draftCorrection("ideas.0.who", "Breakthrough Institute"), finding_id: null, edition_date: "2026-11-23", report_id: null }); };
    expect(hypeOf({ edit: corrected })).toEqual([]);
  });

  it.each(UNREAD.map((u) => [u[0], u[1]] as const))("never reads %s, which keeps its own words", (_label, edit) => {
    expect(hypeOf({ edit })).toEqual([]);
  });

  it("reads the list that the config holds, not a list of its own", () => {
    const scene = (text: string): Scene => ({ config: withHype(["radical", "mind-blowing"]), edit: (d) => { d.new_findings[0].explainer.how_sure = text; } });
    expect(hypeOf(scene("A radical idea, and a mind blowing one."))[0]!.message).toBe(hypeMessage(HOW_SURE, ["radical", "mind-blowing"]));
    expect(hypeOf(scene("A stunning and unprecedented breakthrough."))).toEqual([]);
    expect(hypeOf({ config: withHype([]), edit: (d) => { d.new_findings[0].explainer.how_sure = "A stunning breakthrough."; } })).toEqual([]);
  });
});

describe("HYPE_WORDS, draft mode: the names that hold a hype word are masked first, as listed, case included", () => {
  const NAMES: [string, string][] = [
    ["Breakthrough Prize", "the Breakthrough Prize committee"], ["Breakthrough of the Year", "the Breakthrough of the Year list"],
    ["Breakthrough Listen", "Breakthrough Listen's data"], ["Breakthrough Starshot", "the Breakthrough Starshot plan"], ["Breakthrough T1D", "funding from Breakthrough T1D"],
    ["Breakthrough Energy", "Breakthrough Energy Ventures"], ["Breakthrough Therapy", "a Breakthrough Therapy designation"],
    ["Breakthrough Devices Program", "the Breakthrough Devices Program"], ["Breakthrough Device", "a Breakthrough Device designation"],
  ];
  const inFound = (edit: (d: Json) => void = () => undefined, text = ""): Scene => ({
    edit: (d) => { d.new_findings[1].explainer.found = text; edit(d); },
  });
  const NOTABLE_FOUND = "new_findings[1].explainer.found";

  it("lists the names of the file, whose entries the cases below use", () => {
    expect(config().index.hypeNames.en).toEqual(NAMES.map(([name]) => name));
  });

  it.each(NAMES.map(([name, text]) => [name, text] as const))('passes "%s" in a Notable finding\'s found, and fails a bare "breakthrough" beside it', (_name, text) => {
    expect(hypeOf(inFound(undefined, `We read ${text} today.`))).toEqual([]);
    const bare = hypeOf(inFound(undefined, `We read ${text} and a breakthrough today.`));
    expect(bare.map((i) => i.message)).toEqual([hypeMessage(NOTABLE_FOUND, ["breakthrough"])]);
  });

  it("passes the Breakthrough Prize committee in a Major finding's how_sure, and fails a breakthrough there (the spec's pair)", () => {
    expect(hypeOf(inHowSure("The Breakthrough Prize committee read it."))).toEqual([]);
    expect(hypeOf(inHowSure("It was a breakthrough."))).toHaveLength(1);
  });

  it("passes three names in a Notable finding's found and fails the breakthrough of the year there (the spec's trio)", () => {
    expect(hypeOf(inFound(undefined, "Breakthrough Listen's data, a Breakthrough Therapy designation and a Breakthrough Device designation."))).toEqual([]);
    expect(hypeOf(inFound(undefined, "Here is the breakthrough of the year."))).toHaveLength(1);
  });

  it("masks a name as it is listed, case included: another case is not the name", () => {
    for (const text of ["the breakthrough prize", "the BREAKTHROUGH PRIZE", "the Breakthrough prize", "the breakthrough Prize", "Breakthrough listen", "the Breakthrough of the year"]) {
      expect(hypeOf(inFound(undefined, `We read ${text} today.`)).map((i) => i.message), text).toEqual([hypeMessage(NOTABLE_FOUND, ["breakthrough"])]);
    }
  });

  it("masks every place that holds the name, and leaves a hype word beside it", () => {
    expect(hypeOf(inFound(undefined, "The Breakthrough Prize and the Breakthrough Prize again, and Breakthrough Starshot."))).toEqual([]);
    const issues = hypeOf(inFound(undefined, "The Breakthrough Prize was stunning and unprecedented."));
    expect(issues.map((i) => i.message)).toEqual([hypeMessage(NOTABLE_FOUND, ["unprecedented", "stunning"])]);
  });

  it("reads the names of the config's file, so a name of another file masks another word", () => {
    const cfg = withHype(["radical", "breakthrough"], ["Radical Prize"]);
    const scene = (text: string): Scene => ({ config: cfg, edit: (d) => { d.new_findings[1].explainer.found = text; } });
    expect(hypeOf(scene("The Radical Prize committee."))).toEqual([]);
    expect(hypeOf(scene("A radical idea."))).toHaveLength(1);
    expect(hypeOf(scene("The Breakthrough Prize committee."))).toHaveLength(1);
  });
});


describe("HYPE_WORDS, draft mode: \"breakthrough\" stands only in a Landmark's text", () => {
  const asLandmark: Edit = (d) => { d.new_findings[0].significance = "landmark"; };
  const asLandmarkWith = (edit: Edit): Edit => (d) => { asLandmark(d); edit(d); };

  // The strings of a new finding that carry its text: its title, explainer, figure alt and rung note.
  const OWN = CAPS.filter((c) => c.path.startsWith("new_findings[0]") && !c.label.includes("definition"));

  it("covers the finding's title, six explainer parts, figure alt and rung note", () => {
    expect(OWN.map((c) => c.path)).toEqual([
      "new_findings[0].title", "new_findings[0].rung_history[0].note", "new_findings[0].figure.alt",
      ...["found", "matters", "ai_helped", "how_sure", "background", "could_lead"].map((p) => `new_findings[0].explainer.${p}`),
    ]);
  });

  it.each(OWN.map((c) => [c.label, c] as const))("passes a breakthrough in a Landmark's %s and fails it in a Major finding's", (_label, c) => {
    expect(hypeOf({ edit: asLandmarkWith((d) => c.set(d, A_BREAKTHROUGH)) }), "Landmark").toEqual([]);
    for (const significance of ["major", "notable"]) {
      const issues = hypeOf({ edit: (d) => { d.new_findings[0].significance = significance; c.set(d, A_BREAKTHROUGH); } });
      expect(issues.map((i) => `${i.path} | ${i.message}`), significance).toEqual([`${c.path} | ${hypeMessage(c.path, ["breakthrough"])}`]);
    }
  });

  it.each(OWN.map((c) => [c.label, c] as const))("fails the plural breakthroughs in a Landmark's %s, which only the singular may stand in", (_label, c) => {
    const issues = hypeOf({ edit: asLandmarkWith((d) => c.set(d, "It was one of the breakthroughs of the year.")) });
    expect(issues.map((i) => `${i.path} | ${i.message}`)).toEqual([`${c.path} | ${hypeMessage(c.path, ["breakthroughs"])}`]);
  });

  it("reads the list entry breakthrough as the Landmark word whatever case the list writes it in", () => {
    const cfg = withHype(["Breakthrough"]);
    const edit = (significance: string): Edit => (d) => { d.new_findings[0].significance = significance; d.new_findings[0].explainer.found = A_BREAKTHROUGH; };
    expect(hypeOf({ config: cfg, edit: edit("landmark") })).toEqual([]);
    const issues = hypeOf({ config: cfg, edit: edit("major") });
    expect(issues.map((i) => i.message)).toEqual([`new_findings[0].explainer.found uses "Breakthrough", which the brief does not use.${LANDMARK_ONLY} Say what happened and let the reader judge.`]);
  });

  it.each(OWN.map((c) => [c.label, c] as const))("still fails every other word in a Landmark's %s, and lists it alone", (_label, c) => {
    const issues = hypeOf({ edit: asLandmarkWith((d) => c.set(d, "It was a breakthrough, and unprecedented.")) });
    expect(issues.map((i) => `${i.path} | ${i.message}`)).toEqual([`${c.path} | ${hypeMessage(c.path, ["unprecedented"])}`]);
  });

  it("fails a breakthrough in the Lead of a brief whose story is a Landmark (the spec's case), and in no other string of the brief", () => {
    const lead = hypeOf({ edit: asLandmarkWith((d) => { d.lead[0].text = "A breakthrough leads today."; }) });
    expect(lead.map((i) => `${i.path} | ${i.message}`)).toEqual([`lead[0].text | ${hypeMessage("lead[0].text", ["breakthrough"])}`]);
    const others: [string, string, Edit][] = [
      ["an idea", "ideas[0].text", (d) => { d.ideas[0].text = A_BREAKTHROUGH; }],
      ["an Also noted title", "also[0].title", (d) => { d.also[0].title = A_BREAKTHROUGH; }],
      ["a correction's reason", "corrections[0].reason", (d) => { d.corrections[0].reason = A_BREAKTHROUGH; }],
      ["a report decision's reason", "report_decisions[0].reason", (d) => { d.report_decisions[0].reason = A_BREAKTHROUGH; }],
    ];
    for (const [label, path, edit] of others) {
      expect(hypeOf({ edit: asLandmarkWith(edit) }).map((i) => i.path), label).toEqual([path]);
    }
  });

  it("does not let a Landmark finding's term, definition or figure credit carry the word: they are not its own strings (a judgement)", () => {
    const edits: [string, string, Edit][] = [
      ["a new term's definition", "new_findings[0].terms[0].definition", (d) => { d.new_findings[0].terms[0].definition = A_BREAKTHROUGH; }],
      ["a new term's name", "new_findings[0].terms[0].term", (d) => { d.new_findings[0].terms[0].term = "A breakthrough"; }],
      ["a figure's credit", "new_findings[0].figure.credit", (d) => { d.new_findings[0].figure = { ...FIGURE, credit: A_BREAKTHROUGH }; }],
    ];
    for (const [label, path, edit] of edits) expect(hypeOf({ edit: asLandmarkWith(edit) }).map((i) => i.path), label).toEqual([path]);
  });

  it("fails a breakthrough in the Lead and the big picture of a Monday whose story and review are about Landmarks", () => {
    const issues = hypeOf({
      edition: "monday",
      edit: (d) => {
        asLandmark(d);
        d.lead[0].text = "A breakthrough leads today.";
        d.review.big_picture = fill(300, A_BREAKTHROUGH);
        d.review.strongest_against.finding_ids = ["math-2026-0002"];
        d.review.strongest_against.text = A_BREAKTHROUGH;
      },
    });
    expect(issues.map((i) => i.path)).toEqual(["lead[0].text", "review.big_picture", "review.strongest_against.text"]);
  });

  describe("a returning update, filed on the edition's date with the draft's own corrections", () => {
    const update: Edit = (d) => { d.returning[0].update = "A breakthrough in the proof."; };
    const UPDATE = "returning[0].update";
    const failed = (issues: ValidationIssue[]): string[] => issues.map((i) => `${i.path} | ${i.message}`);

    it("passes on a finding that the draft makes a Landmark (the draft's first correction), fails when it does not", () => {
      expect(hypeOf({ edit: update })).toEqual([]);
      expect(failed(hypeOf({ edit: (d) => { update(d); fileMathAs("major")(d); } }))).toEqual([`${UPDATE} | ${hypeMessage(UPDATE, ["breakthrough"])}`]);
      expect(hypeOf({ edit: (d) => { update(d); fileMathAs("notable")(d); } })).toHaveLength(1);
    });

    it("passes on a Landmark that the context holds, fails on one that the same draft lowers to Major (the spec's case)", () => {
      const context = contextLandmark("weekday", "math-2026-0002");
      expect(hypeOf({ context, edit: (d) => { update(d); fileMathAs("landmark")(d); } })).toEqual([]);
      expect(failed(hypeOf({ context, edit: (d) => { update(d); fileMathAs("major")(d); } }))).toEqual([`${UPDATE} | ${hypeMessage(UPDATE, ["breakthrough"])}`]);
    });

    it("reads the Landmark of the finding the update is about, not of the story", () => {
      const edit: Edit = (d) => { update(d); asLandmark(d); fileMathAs("major")(d); };
      expect(hypeOf({ edit })).toHaveLength(1);
    });

    it("reads the rung note of a returning entry and of a rung change as the text of the finding it is about", () => {
      const note: Edit = (d) => { d.returning[0].rung.note = "Seen as a breakthrough."; };
      expect(hypeOf({ edit: note })).toEqual([]);
      expect(hypeOf({ edit: (d) => { note(d); fileMathAs("major")(d); } }).map((i) => i.path)).toEqual(["returning[0].rung.note"]);
      const change: Edit = (d) => { d.rung_changes[0].rung.note = "Seen as a breakthrough."; };
      expect(hypeOf({ edit: change }).map((i) => i.path)).toEqual(["rung_changes[0].rung.note"]);
      expect(hypeOf({ context: contextLandmark("weekday", "phys-2026-0003"), edit: change })).toEqual([]);
    });

    it("never lets an update carry another word", () => {
      const issues = hypeOf({ edit: (d) => { d.returning[0].update = "A breakthrough, and unprecedented."; } });
      expect(failed(issues)).toEqual([`${UPDATE} | ${hypeMessage(UPDATE, ["unprecedented"])}`]);
    });
  });

  describe("the deep dive and the remarkable note on a Landmark", () => {
    const DEEP = "deep_dive.text";
    it("passes the deep dive on a Sunday's candidate that the context lists as a Landmark, and fails it on one that it does not", () => {
      const text = (d: Json): void => { d.deep_dive.text = fill(500, A_BREAKTHROUGH); };
      expect(hypeOf({ edition: "sunday", edit: text })).toEqual([]);
      const other = hypeOf({ edition: "sunday", edit: (d) => { text(d); d.deep_dive.finding_id = "math-2025-0009"; } });
      expect(other.map((i) => `${i.path} | ${i.message}`)).toEqual([`${DEEP} | ${hypeMessage(DEEP, ["breakthrough"])}`]);
    });

    it("files the deep dive's finding on the edition's date with the draft's corrections", () => {
      const text = (d: Json): void => { d.deep_dive.text = fill(500, A_BREAKTHROUGH); };
      const lower: Edit = (d) => { addCorrection("significance", "major", "bio-2024-0007")(d); };
      expect(hypeOf({ edition: "sunday", edit: (d) => { text(d); lower(d); } }).map((i) => i.path)).toEqual([DEEP]);
      const raise: Edit = (d) => { d.deep_dive.finding_id = "math-2025-0009"; addCorrection("significance", "landmark", "math-2025-0009")(d); };
      expect(hypeOf({ edition: "sunday", edit: (d) => { text(d); raise(d); } })).toEqual([]);
    });

    it("never lets the deep dive carry another word", () => {
      const issues = hypeOf({ edition: "sunday", edit: (d) => { d.deep_dive.text = fill(500, "It was a breakthrough and stunning."); } });
      expect(issues.map((i) => i.message)).toEqual([hypeMessage(DEEP, ["stunning"])]);
    });

    const NOTE = "review.remarkable.note";
    it("passes the remarkable note on a finding that is a Landmark on the Monday, fails it on one that is not", () => {
      const note: Edit = (d) => { d.review.remarkable.note = A_BREAKTHROUGH; };
      expect(hypeOf({ edition: "monday", edit: note }), "math, a Landmark by the draft's correction").toEqual([]);
      const major = hypeOf({ edition: "monday", edit: (d) => { note(d); fileMathAs("major")(d); } });
      expect(major.map((i) => `${i.path} | ${i.message}`)).toEqual([`${NOTE} | ${hypeMessage(NOTE, ["breakthrough"])}`]);
      const chem: Edit = (d) => { note(d); d.review.remarkable.finding_id = "chem-2026-0004"; };
      expect(hypeOf({ edition: "monday", edit: chem }).map((i) => i.path)).toEqual([NOTE]);
      const landmark = contextWith("monday", (c) => { c.week.findings.find((f: Json) => f.id === "chem-2026-0004").significance = "landmark"; });
      expect(hypeOf({ edition: "monday", context: landmark, edit: chem })).toEqual([]);
    });

    it("fails the strongest evidence against, even when it names a Landmark", () => {
      const edit: Edit = (d) => { d.review.strongest_against.text = A_BREAKTHROUGH; d.review.strongest_against.finding_ids = ["math-2026-0002"]; };
      expect(hypeOf({ edition: "monday", edit }).map((i) => i.path)).toEqual(["review.strongest_against.text"]);
    });

    it("never lets the remarkable note carry another word", () => {
      const issues = hypeOf({ edition: "monday", edit: (d) => { d.review.remarkable.note = "A breakthrough, and revolutionary."; } });
      expect(issues.map((i) => i.message)).toEqual([hypeMessage(NOTE, ["revolutionary"])]);
    });
  });

  describe("a correction's after at the path of a Landmark finding's own text", () => {
    // The paths of a stored finding's own strings that a correction may name (SPEC §4.10), each with the part it names.
    const PATHS = [
      "title", "explainer.found", "explainer.matters", "explainer.ai_helped", "explainer.how_sure", "explainer.background", "explainer.could_lead",
      "figure.alt", "rung_history.0.note", "since_then.0.text",
    ];
    const AFTER = "corrections[3].after";

    it.each(PATHS.map((p) => [p] as const))("passes a breakthrough at %s of a Landmark (the draft makes math one), fails it when the draft files it as Major", (p) => {
      expect(hypeOf({ edit: addCorrection(p, A_BREAKTHROUGH) })).toEqual([]);
      const issues = hypeOf({ edit: (d) => { fileMathAs("major")(d); addCorrection(p, A_BREAKTHROUGH)(d); } });
      expect(issues.map((i) => `${i.path} | ${i.message}`)).toEqual([`${AFTER} | ${hypeMessage(AFTER, ["breakthrough"])}`]);
      const other = hypeOf({ edit: addCorrection(p, "A breakthrough and a stunning one.") });
      expect(other.map((i) => i.message)).toEqual([hypeMessage(AFTER, ["stunning"])]);
    });

    it("fails a breakthrough in a Landmark's correction that an earlier correction lowered to Major (the spec's case)", () => {
      const context = contextLandmark("weekday", "math-2026-0002");
      expect(hypeOf({ context, edit: (d) => { fileMathAs("landmark")(d); addCorrection("explainer.found", A_BREAKTHROUGH)(d); } })).toEqual([]);
      const lowered = hypeOf({ context, edit: (d) => { fileMathAs("major")(d); addCorrection("explainer.found", A_BREAKTHROUGH)(d); } });
      expect(lowered.map((i) => i.path)).toEqual(["corrections[3].after"]);
      const before = hypeOf({ context, edit: (d) => { addCorrection("explainer.found", A_BREAKTHROUGH)(d); fileMathAs("major")(d); } });
      expect(before.map((i) => i.path)).toEqual(["corrections[3].after"]);
    });

    it("passes a breakthrough in a correction of a Landmark that the context lists, with no correction of the draft's own about its significance", () => {
      const context = contextLandmark("weekday", "math-2026-0002");
      const edit: Edit = (d) => { d.corrections[0].path = "kind"; d.corrections[0].after = "result"; addCorrection("explainer.found", A_BREAKTHROUGH)(d); };
      expect(hypeOf({ context, edit })).toEqual([]);
      expect(hypeOf({ edit }).map((i) => i.path)).toEqual(["corrections[3].after"]);
    });

    it("fails a breakthrough in a correction of an edition's text or of a glossary term, which no Landmark owns", () => {
      const edition: Edit = (d) => {
        d.corrections.push({ finding_id: null, edition_date: "2026-11-20", term_id: null, type: "correction", path: "lead.0.text", after: A_BREAKTHROUGH, reason: "The text was wrong.", source_url: null, report_id: null });
      };
      const term: Edit = (d) => {
        d.corrections.push({ finding_id: null, edition_date: null, term_id: "protein-folding", type: "correction", path: "definition", after: A_BREAKTHROUGH, reason: "The text was wrong.", source_url: null, report_id: null });
      };
      for (const edit of [edition, term]) expect(hypeOf({ edit: (d) => { asLandmark(d); edit(d); } }).map((i) => i.path)).toEqual(["corrections[3].after"]);
    });
  });
});


describe("HYPE_WORDS, published mode: the records being published, and no other", () => {
  type PubRead = Pick<PubCap, "label" | "path" | "older" | "prepare" | "set">;
  const PUB_READ: PubRead[] = [
    ...PUB_CAPS,
    { label: "the Pace sentence", path: `${BRIEF_FILE}: pace.sentence.en`, set: (w, t) => { briefOf(w).pace.sentence = lzp(t); } },
    { label: "a stored figure's credit", path: `${FILE(BIO)}: figure.credit`, set: (w, t) => { finding(w, BIO).figure = { ...FIGURE, credit: t, alt: lzp("A made-up chart.") }; } },
    { label: "a glossary term's English name", path: "glossary.json: terms[0].en.term", set: (w, t) => { w.terms[0]!.en.term = t; } },
  ];
  const BAD = "An unprecedented text.";
  const issuesAt = (issues: ValidationIssue[]): string[] => issues.map((i) => `${i.path} | ${i.message}`);

  it.each(PUB_READ.map((c) => [c.label, c] as const))("reads %s of a record being published, and of no other", (_label, c) => {
    const run = (publishing: string | null, text: string): ValidationIssue[] => pubHype({ publishing, edit: (w) => { c.prepare?.(w); c.set(w, text); } });
    const message = [`${c.path} | ${hypeMessage(c.path, ["unprecedented"])}`];
    expect(run(D, "A clean text."), "clean").toEqual([]);
    expect(issuesAt(run(D, BAD)), "published on D").toEqual(c.older === true ? [] : message);
    expect(issuesAt(run(EARLIER, BAD)), "published earlier").toEqual(c.older === true ? message : []);
    expect(run(null, BAD), "nothing being published").toEqual([]);
  });

  it("reads each of the nine words in a stored explainer, as in a draft", () => {
    for (const w of HYPE_EN) {
      const issues = pubHype({ edit: (world) => { finding(world, BIO).explainer.how_sure = lzp(`It was a ${w} for the field.`); } });
      expect(issuesAt(issues), w).toEqual([`${FILE(BIO)}: explainer.how_sure.en | ${hypeMessage(`${FILE(BIO)}: explainer.how_sure.en`, [w])}`]);
    }
  });

  it("does not read the Chinese side of a record", () => {
    const edit = (w: PubWorld): void => {
      finding(w, BIO).title.zh = "A breakthrough, unprecedented";
      finding(w, BIO).explainer.found.zh = "A breakthrough, unprecedented";
      finding(w, BIO).rung_history[1].note.zh = "A breakthrough, unprecedented";
      briefOf(w).lead[0].text.zh = "A breakthrough, unprecedented";
      briefOf(w).pace.sentence.zh = "A breakthrough, unprecedented";
      w.terms[0]!.zh!.term = "A breakthrough";
      w.terms[0]!.zh!.definition = "A breakthrough, unprecedented";
      w.corrections[1]!.reason.zh = "A breakthrough, unprecedented";
    };
    for (const publishing of [D, null]) expect(pubHype({ publishing, edit })).toEqual([]);
  });

  const BOTH = "A breakthrough and an unprecedented result.";
  const UNREAD: [string, (w: PubWorld) => void][] = [
    ["an evidence quote", (w) => { finding(w, BIO).ai.evidence[0].quote = BOTH; }],
    ["a reaction's quote", (w) => { finding(w, BIO).reactions[0].quote = BOTH; }],
    ["a licence quote", (w) => { finding(w, BIO).figure = { ...FIGURE, licence_quote: BOTH, alt: lzp("A made-up chart.") }; }],
    ["a finding source's title", (w) => { finding(w, BIO).sources[0].title = BOTH; }],
    ["a brief source's title", (w) => { briefOf(w).sources[0].title = BOTH; }],
    ["a finding source's publisher", (w) => { finding(w, BIO).sources[0].publisher = BOTH; }],
    ["a brief source's publisher", (w) => { briefOf(w).sources[0].publisher = "Breakthrough Institute"; }],
    ["a who entry's name", (w) => { finding(w, BIO).who[0].name = BOTH; }],
    ["a reaction's who", (w) => { finding(w, BIO).reactions[0].who = BOTH; }],
    ["a reaction's affiliation", (w) => { finding(w, BIO).reactions[0].affiliation = "Breakthrough Institute"; }],
    ["a stored idea's author", (w) => { briefOf(w).ideas[0].who = BOTH; }],
    ["an AI system's name", (w) => { finding(w, BIO).ai.systems[0].name = BOTH; }],
    ["an AI system's maker", (w) => { finding(w, BIO).ai.systems[0].maker = BOTH; }],
    ["a source's URL", (w) => { finding(w, BIO).sources[0].url = "https://example.org/breakthrough-devices-program"; }],
    ["a DOI", (w) => { finding(w, BIO).artefacts.doi = ["10.1234/unprecedented-breakthrough"]; }],
    ["a correction's source URL", (w) => { w.corrections[1]!.source_url = "https://example.org/unprecedented-breakthrough"; }],
    ["a report's evidence URL", (w) => { w.reports[0]!.evidence_url = "https://example.org/unprecedented-breakthrough"; }],
  ];

  it.each(UNREAD.map((u) => [u[0], u[1]] as const))("never reads %s, which keeps its own words", (_label, edit) => {
    for (const publishing of [D, null]) expect(pubHype({ publishing, edit }), `publishing ${publishing}`).toEqual([]);
  });

  it("keeps a stored idea's author as a name, such as the Breakthrough Institute, and still reads the idea's own text", () => {
    const attributed = (text: string) => (w: PubWorld): void => { briefOf(w).ideas[0].who = "Breakthrough Institute"; briefOf(w).ideas[0].text = lzp(text); };
    const path = `${BRIEF_FILE}: ideas[0].text.en`;
    for (const publishing of [D, null]) expect(pubHype({ publishing, edit: attributed("A clean text.") }), `publishing ${publishing}`).toEqual([]);
    expect(issuesAt(pubHype({ edit: attributed("A breakthrough for the field.") }))).toEqual([`${path} | ${hypeMessage(path, ["breakthrough"])}`]);
    expect(pubHype({ publishing: null, edit: attributed("A breakthrough for the field.") })).toEqual([]);
    // A stored correction of the author is the same name: its after keeps its own words as well.
    const corrected = (w: PubWorld): void => {
      w.corrections.push(Correction.parse({
        id: "C-0003", date: D, finding_id: null, edition_date: D, term_id: null, type: "correction", path: "ideas.0.who", before: l("Oren Nominal"),
        after: l("Breakthrough Institute"), reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
      }));
    };
    for (const publishing of [D, null]) expect(pubHype({ publishing, edit: corrected }), `publishing ${publishing}`).toEqual([]);
  });

  const stored = (path: string, before: string, after: string, finding = BIO, date = D, id = "C-0003") => (w: PubWorld): void => {
    w.corrections.push(rewrite(id, date, finding, path, before, after));
  };
  /** The place of the stored correction that the test adds after the world's two. */
  const AFTER = "corrections.json: corrections[2].after.en";

  it("never reads a correction's before, which was copied from text published earlier, and reads its after at a prose path", () => {
    const edit = (before: string, after: string) => stored("explainer.found", before, after);
    expect(pubHype({ edit: edit(BOTH, "A clean text.") })).toEqual([]);
    expect(pubHype({ publishing: null, edit: edit(BOTH, "A clean text.") })).toEqual([]);
    expect(issuesAt(pubHype({ edit: edit(BOTH, "An unprecedented text.") }))).toEqual([`${AFTER} | ${hypeMessage(AFTER, ["unprecedented"])}`]);
  });

  it("passes a correction's after and before at the path of a name, a quote or a source's title, which hold the words", () => {
    for (const path of ["reactions.0.affiliation", "reactions.0.who", "who.0.name", "sources.0.publisher", "ai.systems.0.name", "ai.systems.0.maker", "ai.evidence.0.quote", "reactions.0.quote", "figure.licence_quote", "sources.0.title"]) {
      expect(pubHype({ edit: stored(path, BOTH, BOTH) }), path).toEqual([]);
    }
    expect(pubHype({ edit: stored("reactions.0.affiliation", "Breakthrough Institute", "Breakthrough Institute") })).toEqual([]);
    expect(pubHype({ edit: stored("sources.0.url", "https://example.org/unprecedented", "https://example.org/breakthrough") })).toEqual([]);
  });

  it("masks the names, as listed and case included, in a stored record as in a draft", () => {
    const how = (text: string): ((w: PubWorld) => void) => (w) => { finding(w, BIO).explainer.how_sure = lzp(text); };
    const path = `${FILE(BIO)}: explainer.how_sure.en`;
    expect(pubHype({ edit: how("The Breakthrough Prize committee read it.") })).toEqual([]);
    expect(pubHype({ edit: how("Breakthrough Listen's data, a Breakthrough Therapy designation and a Breakthrough Device designation.") })).toEqual([]);
    expect(issuesAt(pubHype({ edit: how("The Breakthrough Prize committee called it a breakthrough.") }))).toEqual([`${path} | ${hypeMessage(path, ["breakthrough"])}`]);
    expect(pubHype({ edit: how("the breakthrough prize committee") })).toHaveLength(1);
    expect(pubHype({ edit: how("the breakthrough of the year") })).toHaveLength(1);
  });

  it("reads the list and the names that the config holds", () => {
    const cfg = withHype(["radical"], ["Radical Prize"]);
    const how = (text: string): PubScene => ({ config: cfg, edit: (w) => { finding(w, BIO).explainer.how_sure = lzp(text); } });
    expect(pubHype(how("The Radical Prize committee."))).toEqual([]);
    expect(pubHype(how("A radical idea."))).toHaveLength(1);
    expect(pubHype(how("A stunning breakthrough."))).toEqual([]);
  });

  it("skips a string that a stored correction removed to REMOVED_TEXT, and judges text that the correction names but the record still holds", () => {
    const edit = (mode: "removed" | "filed" | "none") => (w: PubWorld): void => {
      finding(w, BIO).explainer.how_sure = lzp("An unprecedented text.");
      if (mode !== "none") w.corrections.push(removal("C-0003", { finding: BIO }, "explainer.how_sure"));
      if (mode === "removed") holdRemoved(w as never);
    };
    for (const publishing of PUBLISHING) {
      expect(pubHype({ publishing, edit: edit("removed") })).toEqual([]);
      const judged = publishing === D ? [`${FILE(BIO)}: explainer.how_sure.en`] : [];
      expect(pubHype({ publishing, edit: edit("none") }).map((i) => i.path)).toEqual(judged);
      expect(pubHype({ publishing, edit: edit("filed") }).map((i) => i.path)).toEqual(judged);
    }
  });
});


describe("HYPE_WORDS, published mode: a returning finding is read in what D added to it and in nothing else (F-55)", () => {
  // phys-2026-0003 was first briefed on EARLIER. Filed with `updated: D` it is a returning finding of D: its second rung entry (recorded D)
  // is the Tuesday's, its since-then note (dated 2026-11-23), its title, its explainer and its first rung entry are not.
  const BAD = "An unprecedented text.";
  const returning = (...edits: ((w: PubWorld) => void)[]) => (w: PubWorld): void => { finding(w, PHYS).updated = D; for (const edit of edits) edit(w); };
  const PHYS_FILE = FILE(PHYS);
  const failure = (path: string): string => `${path} | ${hypeMessage(path, ["unprecedented"])}`;
  const read = (edit: (w: PubWorld) => void, publishing: string | null = D): string[] => pubHype({ publishing, edit }).map((i) => `${i.path} | ${i.message}`);

  it("passes the word in the frozen title and explainer, and in a note of an earlier day, and fails it in the rung note recorded on D", () => {
    for (const part of ALL_PARTS) {
      expect(read(returning((w) => { finding(w, PHYS).explainer[part] = lzp(BAD); })), part).toEqual([]);
    }
    expect(read(returning((w) => { finding(w, PHYS).title = lzp(BAD); }))).toEqual([]);
    expect(read(returning((w) => { finding(w, PHYS).since_then[0].text = lzp(BAD); }))).toEqual([]);
    expect(read(returning((w) => { finding(w, PHYS).rung_history[0].note = lzp(BAD); }))).toEqual([]);
    expect(read(returning((w) => { finding(w, PHYS).rung_history[1].note = lzp(BAD); }))).toEqual([failure(`${PHYS_FILE}: rung_history[1].note.en`)]);
  });

  it("fails the word in a since-then note dated D, and in the same note when the finding was first briefed on the date being published", () => {
    const dated = (w: PubWorld): void => { finding(w, PHYS).since_then[0].date = D; finding(w, PHYS).since_then[0].text = lzp(BAD); };
    expect(read(returning(dated))).toEqual([failure(`${PHYS_FILE}: since_then[0].text.en`)]);
    // publishing EARLIER, the finding's first brief: the whole record is the edition's
    expect(read((w) => { finding(w, PHYS).explainer.found = lzp(BAD); }, EARLIER)).toEqual([failure(`${PHYS_FILE}: explainer.found.en`)]);
  });

  it("reads nothing of a finding last updated before D, whatever it holds", () => {
    expect(read((w) => { finding(w, PHYS).rung_history[1].note = lzp(BAD); })).toEqual([]);
  });

  it("keeps the fixed limits on the frozen text of a returning finding", () => {
    const edit = returning((w) => { finding(w, PHYS).explainer.found = lzp(plain(25, 25)); });
    expect(pubSentences({ edit }).map((i) => i.path)).toEqual([`${PHYS_FILE}: explainer.found.en`]);
  });
});

describe("HYPE_WORDS, published mode: \"breakthrough\" stands only in a Landmark's text, filed on the date of the text", () => {
  const TEXT = "It was a breakthrough for the field.";
  const NEXT = "2026-11-25";
  const PREV = "2026-11-22";
  const issuesAt = (issues: ValidationIssue[]): string[] => issues.map((i) => `${i.path} | ${i.message}`);
  const failure = (path: string): string => `${path} | ${hypeMessage(path, ["breakthrough"])}`;

  /** The finding as first published: a Landmark or the rest. */
  const filedFirst = (id: string, significance: string) => (w: PubWorld): void => { finding(w, id).significance = significance; };
  /** A stored correction of a finding's significance, as of a date. */
  const refile = (id: string, date: string, from: string, to: string, n = "C-0003") => (w: PubWorld): void => {
    w.corrections.push(rewrite(n, date, id, "significance", from, to));
  };
  const run = (...edits: ((w: PubWorld) => void)[]): ValidationIssue[] => pubHype({ edit: (w) => { for (const e of edits) e(w); } });

  // A finding's own text: the title, the explainer, the figure alt and the rung notes of the stored story, and what it keeps of its returning updates.
  const OWN = PUB_CAPS.filter((c) => c.path.startsWith(`${FILE(BIO)}:`) && /title|explainer|figure\.alt|rung_history|since_then/.test(c.path));

  it("covers the story's title, six explainer parts, figure alt, rung note and returning update", () => {
    expect(OWN.map((c) => c.path.slice(FILE(BIO).length + 2))).toEqual([
      "title.en", ...["found", "matters", "ai_helped", "how_sure", "background", "could_lead"].map((p) => `explainer.${p}.en`),
      "since_then[0].text.en", "rung_history[1].note.en", "figure.alt.en",
    ]);
  });

  it.each(OWN.map((c) => [c.label, c] as const))("passes a breakthrough in %s of a Landmark and fails it in one that is not", (_label, c) => {
    const put = (w: PubWorld): void => { c.set(w, TEXT); };
    expect(run(filedFirst(BIO, "landmark"), put)).toEqual([]);
    for (const significance of ["major", "notable"]) expect(issuesAt(run(filedFirst(BIO, significance), put)), significance).toEqual([failure(c.path)]);
    const other = (w: PubWorld): void => { c.set(w, "It was a breakthrough and a stunning one."); };
    expect(issuesAt(run(filedFirst(BIO, "landmark"), other))).toEqual([`${c.path} | ${hypeMessage(c.path, ["stunning"])}`]);
  });

  it("files the title, the explainer and the figure alt as first published, whatever a correction did to the finding since", () => {
    const strings = OWN.filter((c) => /title|explainer|figure/.test(c.path));
    for (const c of strings) {
      const put = (w: PubWorld): void => { c.set(w, TEXT); };
      for (const date of [PREV, D, NEXT]) {
        expect(run(filedFirst(BIO, "landmark"), refile(BIO, date, "landmark", "major"), put), `lowered ${date}, ${c.path}`).toEqual([]);
        expect(issuesAt(run(filedFirst(BIO, "major"), refile(BIO, date, "major", "landmark"), put)), `raised ${date}, ${c.path}`).toEqual([failure(c.path)]);
      }
    }
  });

  describe("a rung note, filed on the date it was recorded", () => {
    const NOTE = `${FILE(BIO)}: rung_history[1].note.en`;
    const note = (recorded: string) => (w: PubWorld): void => {
      finding(w, BIO).rung_history[1].recorded = recorded;
      finding(w, BIO).rung_history[1].note = lzp("Seen as a breakthrough.");
    };
    it("fails when a correction on or before that date lowered the finding, and passes when the correction came after it", () => {
      const cases: [string, string, boolean][] = [[D, PREV, true], [D, D, true], [D, NEXT, false], ["2026-11-21", PREV, false], [PREV, PREV, true], ["2026-11-21", "2026-11-21", true]];
      for (const [recorded, date, fails] of cases) {
        const issues = run(filedFirst(BIO, "landmark"), refile(BIO, date, "landmark", "major"), note(recorded));
        expect(issuesAt(issues), `recorded ${recorded}, lowered ${date}`).toEqual(fails ? [failure(NOTE)] : []);
      }
    });
    it("passes when a correction on or before that date raised the finding, and fails when the correction came after it", () => {
      const cases: [string, string, boolean][] = [[D, PREV, true], [D, D, true], [D, NEXT, false], ["2026-11-21", PREV, false], [PREV, PREV, true]];
      for (const [recorded, date, passes] of cases) {
        const issues = run(filedFirst(BIO, "major"), refile(BIO, date, "major", "landmark"), note(recorded));
        expect(issuesAt(issues), `recorded ${recorded}, raised ${date}`).toEqual(passes ? [] : [failure(NOTE)]);
      }
    });
    it("takes the latest correction in force on that date", () => {
      const twice = [refile(BIO, "2026-11-21", "major", "landmark", "C-0003"), refile(BIO, PREV, "landmark", "major", "C-0004")];
      expect(run(filedFirst(BIO, "major"), ...twice, note("2026-11-21"))).toEqual([]);
      expect(issuesAt(run(filedFirst(BIO, "major"), ...twice, note(PREV)))).toEqual([failure(NOTE)]);
      expect(issuesAt(run(filedFirst(BIO, "major"), ...twice, note(D)))).toEqual([failure(NOTE)]);
    });
    it("ignores a correction of another finding and a correction of another path", () => {
      expect(run(filedFirst(BIO, "landmark"), refile(MATH, PREV, "landmark", "major"), note(D))).toEqual([]);
      const field = (w: PubWorld): void => { w.corrections.push(rewrite("C-0003", PREV, BIO, "field", "biology", "chemistry")); };
      expect(run(filedFirst(BIO, "landmark"), field, note(D))).toEqual([]);
      expect(issuesAt(run(filedFirst(BIO, "major"), field, note(D)))).toEqual([failure(NOTE)]);
    });
  });

  describe("a returning update kept in a finding, filed on its own date", () => {
    const THEN = `${FILE(BIO)}: since_then[0].text.en`;
    const then = (w: PubWorld): void => { finding(w, BIO).since_then[0].text = lzp("A later breakthrough."); };
    it("follows the date of the entry: a correction of that day counts, a correction of the day after does not", () => {
      expect(run(filedFirst(BIO, "landmark"), refile(BIO, "2026-11-23", "landmark", "major"), then).map((i) => i.path)).toEqual([THEN]);
      expect(run(filedFirst(BIO, "landmark"), refile(BIO, D, "landmark", "major"), then)).toEqual([]);
      expect(run(filedFirst(BIO, "major"), refile(BIO, "2026-11-23", "major", "landmark"), then)).toEqual([]);
      expect(run(filedFirst(BIO, "major"), refile(BIO, D, "major", "landmark"), then).map((i) => i.path)).toEqual([THEN]);
    });
  });

  describe("the brief's update on a returning item, filed on the brief's date", () => {
    const UPDATE = `${BRIEF_FILE}: items[1].update.en`;
    const update = (w: PubWorld): void => { briefOf(w).items[1].update = lzp("A journal published the breakthrough."); };
    it("passes on a Landmark and fails on another finding", () => {
      expect(run(filedFirst(PHYS, "landmark"), update)).toEqual([]);
      expect(issuesAt(run(update))).toEqual([failure(UPDATE)]);
      expect(issuesAt(run(filedFirst(PHYS, "landmark"), (w) => { briefOf(w).items[1].update = lzp("A journal published the breakthrough, and a stunning one."); }))).toEqual([`${UPDATE} | ${hypeMessage(UPDATE, ["stunning"])}`]);
    });
    it("reads the finding the update is about, not the story's or another item's", () => {
      expect(issuesAt(run(filedFirst(BIO, "landmark"), filedFirst(MATH, "landmark"), update))).toEqual([failure(UPDATE)]);
    });
    it("files it with the corrections on or before the brief's date", () => {
      for (const date of [PREV, D]) {
        expect(issuesAt(run(filedFirst(PHYS, "landmark"), refile(PHYS, date, "landmark", "major"), update)), `lowered ${date}`).toEqual([failure(UPDATE)]);
        expect(run(filedFirst(PHYS, "major"), refile(PHYS, date, "major", "landmark"), update), `raised ${date}`).toEqual([]);
      }
      expect(run(filedFirst(PHYS, "landmark"), refile(PHYS, NEXT, "landmark", "major"), update), "lowered after").toEqual([]);
      expect(issuesAt(run(filedFirst(PHYS, "major"), refile(PHYS, NEXT, "major", "landmark"), update)), "raised after").toEqual([failure(UPDATE)]);
    });
  });

  describe("the deep dive and the remarkable note on a Landmark", () => {
    const DEEP = `${BRIEF_FILE}: deep_dive.text.en`;
    const NOTE = `${BRIEF_FILE}: review.remarkable.note.en`;
    const deep = (id: string) => (w: PubWorld): void => { asSunday(w); briefOf(w).deep_dive.finding_id = id; briefOf(w).deep_dive.text = lzp(TEXT); };
    const remark = (id: string) => (w: PubWorld): void => { asMonday(w); briefOf(w).review.remarkable.finding_id = id; briefOf(w).review.remarkable.note = lzp(TEXT); };

    it("passes the deep dive on a Landmark and fails it on another finding", () => {
      expect(run(filedFirst(BIO, "landmark"), deep(BIO))).toEqual([]);
      expect(issuesAt(run(deep(BIO)))).toEqual([failure(DEEP)]);
      expect(issuesAt(run(filedFirst(BIO, "landmark"), deep(MATH)))).toEqual([failure(DEEP)]);
      expect(issuesAt(run(filedFirst(BIO, "landmark"), (w) => { deep(BIO)(w); briefOf(w).deep_dive.text = lzp("A breakthrough, and a stunning one."); }))).toEqual([`${DEEP} | ${hypeMessage(DEEP, ["stunning"])}`]);
    });
    it("passes the remarkable note on a Landmark and fails it on another finding", () => {
      expect(run(filedFirst(PHYS, "landmark"), remark(PHYS))).toEqual([]);
      expect(issuesAt(run(remark(PHYS)))).toEqual([failure(NOTE)]);
      expect(issuesAt(run(filedFirst(PHYS, "landmark"), remark(BIO)))).toEqual([failure(NOTE)]);
      expect(issuesAt(run(filedFirst(PHYS, "landmark"), (w) => { remark(PHYS)(w); briefOf(w).review.remarkable.note = lzp("A breakthrough, and revolutionary."); }))).toEqual([`${NOTE} | ${hypeMessage(NOTE, ["revolutionary"])}`]);
    });
    it("files both on the brief's date: a correction of that day or before counts, a later one does not", () => {
      for (const [put, id, path] of [[deep(BIO), BIO, DEEP], [remark(PHYS), PHYS, NOTE]] as const) {
        for (const date of [PREV, D]) {
          expect(issuesAt(run(filedFirst(id, "landmark"), refile(id, date, "landmark", "major"), put)), `lowered ${date}`).toEqual([failure(path)]);
          expect(run(filedFirst(id, "major"), refile(id, date, "major", "landmark"), put), `raised ${date}`).toEqual([]);
        }
        expect(run(filedFirst(id, "landmark"), refile(id, NEXT, "landmark", "major"), put), "lowered after").toEqual([]);
        expect(issuesAt(run(filedFirst(id, "major"), refile(id, NEXT, "major", "landmark"), put)), "raised after").toEqual([failure(path)]);
      }
    });
    it("fails the strongest evidence against and the big picture, even on a Landmark's review", () => {
      const edit = (w: PubWorld): void => {
        asMonday(w);
        briefOf(w).review.strongest_against.text = lzp(TEXT);
        briefOf(w).review.strongest_against.finding_ids = [MATH];
        briefOf(w).review.big_picture = lzp(fill(300, TEXT));
      };
      expect(run(filedFirst(MATH, "landmark"), filedFirst(BIO, "landmark"), edit).map((i) => i.path)).toEqual([
        `${BRIEF_FILE}: review.big_picture.en`, `${BRIEF_FILE}: review.strongest_against.text.en`,
      ]);
    });
    it("fails the Lead, an idea and an Also noted line, even when the story is a Landmark", () => {
      const edit = (w: PubWorld): void => {
        briefOf(w).lead[0].text = lzp(TEXT);
        briefOf(w).ideas[0].text = lzp(TEXT);
        briefOf(w).also[0].title = lzp(TEXT);
      };
      expect(run(filedFirst(BIO, "landmark"), edit).map((i) => i.path)).toEqual([
        `${BRIEF_FILE}: also[0].title.en`, `${BRIEF_FILE}: ideas[0].text.en`, `${BRIEF_FILE}: lead[0].text.en`,
      ]);
    });
  });

  describe("a correction's after, filed on the date of the correction", () => {
    const PATHS: [string, string][] = [
      ["title", "title"], ["explainer.found", "found"], ["explainer.matters", "matters"], ["explainer.ai_helped", "ai_helped"], ["explainer.how_sure", "how_sure"],
      ["explainer.background", "background"], ["explainer.could_lead", "could_lead"], ["figure.alt", "alt"], ["rung_history.1.note", "note"], ["since_then.0.text", "since_then"],
    ];
    const text = (path: string, date = D, id = "C-0004") => (w: PubWorld): void => { w.corrections.push(rewrite(id, date, BIO, path, TEXT, TEXT)); };
    /** The `after` of the correction a test adds: the world has two, and a refiling pushed before it takes the third place. */
    const AFTER = "corrections.json: corrections[2].after.en";
    const AFTER_THIRD = "corrections.json: corrections[3].after.en";

    it.each(PATHS)("passes a breakthrough at %s of a Landmark, in its before and its after, and fails it on another finding", (path) => {
      expect(run(filedFirst(BIO, "landmark"), text(path)), "Landmark").toEqual([]);
      for (const significance of ["major", "notable"]) expect(issuesAt(run(filedFirst(BIO, significance), text(path))), significance).toEqual([failure(AFTER)]);
      const other = (w: PubWorld): void => { w.corrections.push(rewrite("C-0004", D, BIO, path, TEXT, "A breakthrough, and a stunning one.")); };
      expect(issuesAt(run(filedFirst(BIO, "landmark"), other))).toEqual([`${AFTER} | ${hypeMessage(AFTER, ["stunning"])}`]);
    });

    it("files the finding on the date of the correction, with the corrections in force on it", () => {
      for (const date of [PREV, D]) {
        const lower = refile(BIO, date, "landmark", "major", "C-0003");
        expect(issuesAt(run(filedFirst(BIO, "landmark"), lower, text("explainer.found"))), `lowered ${date}`).toEqual([failure(AFTER_THIRD)]);
        const raise = refile(BIO, date, "major", "landmark", "C-0003");
        expect(run(filedFirst(BIO, "major"), raise, text("explainer.found")), `raised ${date}`).toEqual([]);
      }
      const lowerAfter = refile(BIO, NEXT, "landmark", "major", "C-0003");
      expect(run(filedFirst(BIO, "landmark"), lowerAfter, text("explainer.found")), "lowered the day after").toEqual([]);
      const raiseAfter = refile(BIO, NEXT, "major", "landmark", "C-0003");
      expect(issuesAt(run(filedFirst(BIO, "major"), raiseAfter, text("explainer.found"))), "raised the day after").toEqual([failure(AFTER_THIRD)]);
    });

    it("fails a breakthrough in a correction of an edition's text or of a glossary term, which no Landmark owns", () => {
      const edition = (w: PubWorld): void => {
        w.corrections.push(Correction.parse({
          id: "C-0004", date: D, finding_id: null, edition_date: "2026-11-20", term_id: null, type: "correction", path: "lead.0.text", before: l(TEXT), after: l(TEXT),
          reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
        }));
      };
      const term = (w: PubWorld): void => {
        w.corrections.push(Correction.parse({
          id: "C-0004", date: D, finding_id: null, edition_date: null, term_id: "protein-folding", type: "correction", path: "definition", before: l(TEXT), after: l(TEXT),
          reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
        }));
      };
      for (const edit of [edition, term]) expect(issuesAt(run(filedFirst(BIO, "landmark"), edit)), "Landmark story").toEqual([failure(AFTER)]);
    });

    it("reads a correction of an older day only on the day it is published", () => {
      expect(run(filedFirst(BIO, "major"), text("explainer.found", EARLIER, "C-0003"))).toEqual([]);
      expect(issuesAt(pubHype({ publishing: EARLIER, edit: (w) => { filedFirst(BIO, "major")(w); text("explainer.found", EARLIER, "C-0003")(w); } }))).toEqual([
        "corrections.json: corrections[2].after.en | " + hypeMessage("corrections.json: corrections[2].after.en", ["breakthrough"]),
      ]);
    });
  });
});


// ── TERM_DEFINED ─────────────────────────────────────────────────────────────────────────────────

const termsOf = (scene: Scene = {}): ValidationIssue[] => only(draftRun("TERM_DEFINED", scene), "TERM_DEFINED");
const pubTerms = (scene: PubScene = {}): ValidationIssue[] => only(pubRun("TERM_DEFINED", scene), "TERM_DEFINED");

const quoted = (words: readonly string[]): string => words.map((w) => `"${w}"`).join(", ");
/** An explainer part that uses technical words no term lists. */
const usesMessage = (path: string, words: readonly string[]): string => {
  const alone = words.length === 1;
  return `${path} uses the technical ${alone ? "word" : "words"} ${quoted(words)} without defining ${alone ? "it" : "them"}. List ${alone ? "it" : "each"} in the finding's terms (a new term with a definition, or a glossary id), or use a plainer word.`;
};
/** A listed term that the explainer never uses. */
const unusedMessage = (where: string, name: string): string =>
  `${where} lists the term "${name}", but the explainer never uses it. Use it where the reader first meets it, or take it off the list.`;
/** A definition that uses technical words no term defines. */
const defineMessage = (path: string, words: readonly string[]): string => {
  const alone = words.length === 1;
  return `${path} explains a term with the technical ${alone ? "word" : "words"} ${quoted(words)}, which no listed term defines. Use a plainer word, or list ${alone ? "it" : "each"} as a term of this finding too.`;
};
const lines = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.path} | ${i.message}`);

/** A new term with a definition, and a term that the glossary already has. */
const newTerm = (term: string, definition = "A made-up definition."): Json => ({ new: true, term, definition });
const glossaryId = (id: string): Json => ({ new: false, id });

describe("TERM_DEFINED, draft mode: every jargon word of an explainer is a listed term", () => {
  const STORY_PARTS_ALL = ["found", "matters", "ai_helped", "how_sure", "background", "could_lead"];
  /** Adds a sentence to a part of a new finding, so that the terms already used in it stay used. */
  const addTo = (finding: number, part: string, text: string): Edit => (d) => { d.new_findings[finding].explainer[part] += ` ${text}`; };
  const listItem = (...terms: Json[]): Edit => (d) => { d.new_findings[1].terms = terms; };
  const both = (...edits: Edit[]): Edit => (d) => { for (const e of edits) e(d); };

  it("passes the sized Tuesday, whose story lists the two terms it uses and whose item uses none", () => {
    expect(termsOf()).toEqual([]);
  });

  it.each(STORY_PARTS_ALL.map((p) => [p] as const))("fails a jargon word in the story's %s that no term lists, once, with the way to fix it", (part) => {
    const path = `new_findings[0].explainer.${part}`;
    const issues = termsOf({ edit: addTo(0, part, "A genome was read.") });
    expect(lines(issues)).toEqual([`${path} | ${usesMessage(path, ["genome"])}`]);
    expect(issues[0]!.severity).toBe("error");
  });

  it.each(["found", "matters", "how_sure", "background", "could_lead"].map((p) => [p] as const))("fails a jargon word in an item's %s that its terms do not list", (part) => {
    const path = `new_findings[1].explainer.${part}`;
    expect(lines(termsOf({ edit: addTo(1, part, "A genome was read.") }))).toEqual([`${path} | ${usesMessage(path, ["genome"])}`]);
  });

  it("passes the word once the finding lists it, as a new term with a definition or as a glossary id", () => {
    for (const term of [newTerm("genome"), glossaryId("genome")]) {
      expect(termsOf({ edit: both(addTo(1, "found", "A genome was read."), listItem(term)) }), JSON.stringify(term)).toEqual([]);
    }
  });

  it("does not count a term that is another word: listing enzyme does not cover genome", () => {
    const path = "new_findings[1].explainer.found";
    expect(lines(termsOf({ edit: both(addTo(1, "found", "A genome and an enzyme."), listItem(glossaryId("enzyme"))) }))).toEqual([`${path} | ${usesMessage(path, ["genome"])}`]);
  });

  it("does not let one finding's terms cover another's: the item uses the enzyme that only the story lists", () => {
    const path = "new_findings[1].explainer.found";
    expect(lines(termsOf({ edit: addTo(1, "found", "An enzyme worked.") }))).toEqual([`${path} | ${usesMessage(path, ["enzyme"])}`]);
  });

  it("matches a word in any case and either number, says it as the part first writes it, and counts it once", () => {
    const path = "new_findings[1].explainer.found";
    expect(lines(termsOf({ edit: addTo(1, "found", "Genomes were read, and so was a GENOME.") }))).toEqual([`${path} | ${usesMessage(path, ["Genomes"])}`]);
    for (const text of ["GENOME", "Genomes", "genomes", "Genome"]) {
      expect(termsOf({ edit: both(addTo(1, "found", `The ${text} was read.`), listItem(newTerm("genome"))) }), text).toEqual([]);
    }
    expect(termsOf({ edit: both(addTo(1, "found", "The genome was read."), listItem(newTerm("Genome"))) })).toEqual([]);
  });

  it("takes a plural term as defining the singular word, and a term with a space around it as the term", () => {
    const path = "new_findings[1].explainer.found";
    const used = addTo(1, "found", "A genome was read.");
    expect(termsOf({ edit: both(used, listItem(newTerm("genomes"))) })).toEqual([]);
    expect(termsOf({ edit: both(used, listItem(newTerm(" genomes "))) })).toEqual([]);
    expect(termsOf({ edit: both(used, listItem(newTerm(" genome"))) })).toEqual([]);
    expect(at(termsOf({ edit: both(used, listItem(newTerm("genomic"))) }), path)).toHaveLength(1);
  });

  it("matches a word of the list that has a hyphen as the same word with a space, and says it as written", () => {
    const path = "new_findings[1].explainer.found";
    const text = "The NP hard problem and an NP-hard one.";
    expect(lines(termsOf({ edit: addTo(1, "found", text) }))).toEqual([`${path} | ${usesMessage(path, ["NP hard"])}`]);
    expect(termsOf({ edit: both(addTo(1, "found", text), listItem(newTerm("NP-hard"))) })).toEqual([]);
    expect(termsOf({ edit: both(addTo(1, "found", text), listItem(newTerm("NP hard"))) })).toEqual([]);
  });

  it("matches whole words only: a longer word that starts with one does not count", () => {
    expect(termsOf({ edit: addTo(1, "found", "Genomics, enzymatic work and polymerase work in isotopic form.") })).toEqual([]);
  });

  it("lists each word of one part once, the longest word of the list first", () => {
    const path = "new_findings[1].explainer.found";
    expect(lines(termsOf({ edit: addTo(1, "found", "A genome, an isotope and a genome again.") }))).toEqual([`${path} | ${usesMessage(path, ["isotope", "genome"])}`]);
    expect(lines(termsOf({ edit: addTo(1, "found", "A lemma, a genome and an isotope.") }))).toEqual([`${path} | ${usesMessage(path, ["isotope", "genome", "lemma"])}`]);
  });

  it("gives one issue to each part that holds a word", () => {
    const issues = termsOf({ edit: both(addTo(1, "found", "A genome."), addTo(1, "how_sure", "An isotope."), addTo(0, "background", "A lemma.")) });
    expect(issues.map((i) => i.path)).toEqual(["new_findings[0].explainer.background", "new_findings[1].explainer.found", "new_findings[1].explainer.how_sure"]);
  });

  it("reads a phrase of the list as one word: isotope dating is listed as itself, and the word inside it is no use of isotope", () => {
    const path = "new_findings[1].explainer.found";
    const text = addTo(1, "found", "Isotope dating was used.");
    expect(lines(termsOf({ edit: text }))).toEqual([`${path} | ${usesMessage(path, ["Isotope dating"])}`]);
    expect(termsOf({ edit: both(text, listItem(glossaryId("isotope-dating"))) })).toEqual([]);
    expect(lines(termsOf({ edit: both(text, listItem(newTerm("isotope"))) }))).toEqual([`${path} | ${usesMessage(path, ["Isotope dating"])}`]);
    const twice = addTo(1, "found", "Isotope dating and an isotope were used.");
    expect(lines(termsOf({ edit: both(twice, listItem(glossaryId("isotope-dating"))) }))).toEqual([`${path} | ${usesMessage(path, ["isotope"])}`]);
    expect(termsOf({ edit: both(twice, listItem(glossaryId("isotope-dating"), glossaryId("isotope"))) })).toEqual([]);
  });

  it("does not read what is not an explainer part: a title, a rung note, a Lead line, an idea, an Also noted title, a figure's alt text", () => {
    const issues = termsOf({
      edit: (d) => {
        d.new_findings[1].title = "A genome result";
        d.new_findings[1].rung_history[0].note = "The genome was read.";
        d.lead[0].text = "A genome leads today.";
        d.ideas[0].text = "An isotope argument.";
        d.also[0].title = "A lemma study";
        d.new_findings[0].figure = { ...FIGURE, alt: "A genome chart." };
        d.returning[0].update = "A genome update.";
      },
    });
    expect(issues).toEqual([]);
  });

  it("reads the list of the config: another list lets a word through and fails its own words", () => {
    const cfg = withJargon(["glimmer"]);
    const path = "new_findings[1].explainer.found";
    expect(lines(termsOf({ config: cfg, edit: addTo(1, "found", "A glimmer and a genome.") }))).toEqual([`${path} | ${usesMessage(path, ["glimmer"])}`]);
    expect(termsOf({ config: withJargon([]), edit: addTo(1, "found", "A glimmer and a genome.") })).toEqual([]);
    // the longest entry of the list wins whatever its place in the file
    const reversed = withJargon(["isotope", "isotope dating"]);
    expect(lines(termsOf({ config: reversed, edit: addTo(1, "found", "Isotope dating was used.") }))).toEqual([`${path} | ${usesMessage(path, ["Isotope dating"])}`]);
  });
});

describe("TERM_DEFINED, draft mode: every listed term appears in the explainer", () => {
  /** The story with no term in any part. */
  const bare: Edit = (d) => { for (const part of ALL_PARTS) d.new_findings[0].explainer[part] = plain(20); };
  const WHERE = (i: number): string => `new_findings[0].terms[${i}]`;

  it.each(ALL_PARTS.map((p) => [p] as const))("passes when the %s holds the two terms of the story", (part) => {
    expect(termsOf({ edit: (d) => { bare(d); d.new_findings[0].explainer[part] = "Protein folding and an enzyme."; } })).toEqual([]);
  });

  it("fails each term that no part uses, at the term, and says how to fix it", () => {
    const issues = termsOf({ edit: bare });
    expect(lines(issues)).toEqual([
      `${WHERE(0)} | ${unusedMessage(WHERE(0), "protein folding")}`,
      `${WHERE(1)} | ${unusedMessage(WHERE(1), "enzyme")}`,
    ]);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });

  it("fails only the term that is missing", () => {
    expect(lines(termsOf({ edit: (d) => { bare(d); d.new_findings[0].explainer.how_sure = "An enzyme."; } }))).toEqual([`${WHERE(0)} | ${unusedMessage(WHERE(0), "protein folding")}`]);
    expect(lines(termsOf({ edit: (d) => { bare(d); d.new_findings[0].explainer.how_sure = "Protein folding."; } }))).toEqual([`${WHERE(1)} | ${unusedMessage(WHERE(1), "enzyme")}`]);
  });

  it("takes the name of a glossary id as its words, hyphens read as spaces", () => {
    const edit: Edit = (d) => { bare(d); d.new_findings[0].terms = [glossaryId("virtual-unwrapping")]; d.new_findings[0].explainer.found = "A made-up virtual unwrapping."; };
    expect(termsOf({ edit })).toEqual([]);
    const missing: Edit = (d) => { bare(d); d.new_findings[0].terms = [glossaryId("virtual-unwrapping")]; };
    expect(lines(termsOf({ edit: missing }))).toEqual([`${WHERE(0)} | ${unusedMessage(WHERE(0), "virtual unwrapping")}`]);
  });

  it("matches a term in any case, with a hyphen for a space and a plural last word", () => {
    for (const text of ["PROTEIN FOLDING and enzymes.", "Protein-Folding and Enzyme.", "protein foldings and an ENZYME."]) {
      expect(termsOf({ edit: (d) => { bare(d); d.new_findings[0].explainer.found = text; } }), text).toEqual([]);
    }
  });

  it("takes a term named in the plural as used by its singular, with each regular ending, and the other way round", () => {
    const named = (name: string, text: string): Edit => (d) => { bare(d); d.new_findings[0].terms = [newTerm(name)]; d.new_findings[0].explainer.found = text; };
    const run = (name: string, text: string): ValidationIssue[] => termsOf({ config: withJargon([]), edit: named(name, text) });
    for (const [name, text] of [
      ["genomes", "A genome."], ["antibodies", "An antibody."], ["boxes", "A box."], ["Stem Cells", "A stem cell line."],
      ["GENOMES", "A genome."], ["ANTIBODIES", "An antibody."], ["BOXES", "A box."],
      ["genome", "Two genomes."], ["antibody", "Two antibodies."], ["box", "Two boxes."],
    ] as const) {
      expect(run(name, text), name).toEqual([]);
    }
    expect(lines(run("genomes", "A genomic study."))).toEqual([`${WHERE(0)} | ${unusedMessage(WHERE(0), "genomes")}`]);
    for (const name of ["s", "es"]) expect(lines(run(name, "A study."))).toEqual([`${WHERE(0)} | ${unusedMessage(WHERE(0), name)}`]);
  });

  it("cuts only the ending of the name to find its singular: a word with the ending cut from its middle is not the term", () => {
    const named = (name: string, text: string): Edit => (d) => { bare(d); d.new_findings[0].terms = [newTerm(name)]; d.new_findings[0].explainer.found = text; };
    for (const [name, text] of [["species richness", "A specy richness."], ["yes vote", "A y vote."], ["yes vote", "A ye vote."], ["stem cells", "A tem cell."]] as const) {
      expect(lines(termsOf({ config: withJargon([]), edit: named(name, text) })), name).toEqual([`${WHERE(0)} | ${unusedMessage(WHERE(0), name)}`]);
    }
  });

  it("matches whole words only: enzymatic is not enzyme, and a longer word is not the term", () => {
    const edit: Edit = (d) => { bare(d); d.new_findings[0].explainer.found = "Protein folder and enzymatic work and superenzyme."; };
    expect(termsOf({ edit }).map((i) => i.path)).toEqual([WHERE(0), WHERE(1)]);
  });

  it("counts a use in the explainer only: a title, a definition, a Lead line or a rung note is none", () => {
    const edit: Edit = (d) => {
      bare(d);
      d.new_findings[0].title = "Protein folding and an enzyme";
      d.new_findings[0].terms[0].definition = "Protein folding and an enzyme.";
      d.lead[0].text = "Protein folding and an enzyme.";
      d.new_findings[0].rung_history[0].note = "Protein folding and an enzyme.";
      d.ideas[0].text = "Protein folding and an enzyme.";
    };
    expect(termsOf({ edit }).map((i) => i.path)).toEqual([WHERE(0), WHERE(1)]);
  });

  it("does not join the parts: a term split between the end of one part and the start of the next is not used", () => {
    const edit: Edit = (d) => { bare(d); Object.assign(d.new_findings[0].explainer, { found: "We studied protein", matters: "folding in the lab." , how_sure: "An enzyme." }); };
    expect(lines(termsOf({ edit }))).toEqual([`${WHERE(0)} | ${unusedMessage(WHERE(0), "protein folding")}`]);
  });

  it("does not count another finding's explainer: the item uses the story's terms", () => {
    const edit: Edit = (d) => {
      bare(d);
      d.new_findings[1].terms = [glossaryId("protein-folding"), glossaryId("enzyme")];
      d.new_findings[1].explainer.found = "Protein folding and an enzyme.";
    };
    expect(termsOf({ edit }).map((i) => i.path)).toEqual([WHERE(0), WHERE(1)]);
  });

  it("holds an item to it too, whose AI part is null", () => {
    const edit: Edit = (d) => {
      Object.assign(d.new_findings[1], { terms: [newTerm("lemma")] });
      for (const part of ["found", "matters", "how_sure", "background", "could_lead"]) d.new_findings[1].explainer[part] = plain(15);
    };
    expect(lines(termsOf({ edit }))).toEqual([`new_findings[1].terms[0] | ${unusedMessage("new_findings[1].terms[0]", "lemma")}`]);
    const used: Edit = (d) => { edit(d); d.new_findings[1].explainer.could_lead = "A lemma was proved."; };
    expect(termsOf({ edit: used })).toEqual([]);
  });

  it("asks nothing of a finding that lists no term", () => {
    expect(termsOf({ edit: (d) => { d.new_findings[0].terms = []; d.new_findings[0].explainer.found = plain(20); d.new_findings[0].explainer.matters = plain(20); } })).toEqual([]);
  });
});

describe("TERM_DEFINED, draft mode: a definition uses no undefined jargon word", () => {
  const DEF = "new_findings[0].terms[0].definition";
  const define = (text: string): Edit => (d) => { d.new_findings[0].terms[0].definition = text; };

  it("fails a jargon word that no term of the finding lists, with the way to fix it", () => {
    const issues = termsOf({ edit: define("How a genome folds.") });
    expect(lines(issues)).toEqual([`${DEF} | ${defineMessage(DEF, ["genome"])}`]);
    expect(issues[0]!.severity).toBe("error");
  });

  it("passes the term itself and the finding's other terms, in any case and number", () => {
    for (const text of ["Protein folding shapes an enzyme.", "PROTEIN-FOLDING is how enzymes act.", "An Enzyme and a protein foldings."]) {
      expect(termsOf({ edit: define(text) }), text).toEqual([]);
    }
  });

  it("lists each unlisted word once, the longest first, in the plural form of the message", () => {
    expect(lines(termsOf({ edit: define("A genome, an isotope and a genome again.") }))).toEqual([`${DEF} | ${defineMessage(DEF, ["isotope", "genome"])}`]);
  });

  it("passes the word once the finding lists it and its explainer uses it", () => {
    const edit: Edit = (d) => {
      define("How a genome folds.")(d);
      d.new_findings[0].terms.push(glossaryId("genome"));
      d.new_findings[0].explainer.could_lead += " A genome was read.";
    };
    expect(termsOf({ edit })).toEqual([]);
  });

  it("looks at the finding's own terms: another finding's term does not define a word for it", () => {
    const edit: Edit = (d) => {
      d.new_findings[1].terms = [newTerm("lemma", "A step of a proof, as an enzyme is a step.")];
      d.new_findings[1].explainer.found += " A lemma was proved.";
    };
    const path = "new_findings[1].terms[0].definition";
    expect(lines(termsOf({ edit }))).toEqual([`${path} | ${defineMessage(path, ["enzyme"])}`]);
  });

  it("reads each new term's definition", () => {
    const edit: Edit = (d) => {
      d.new_findings[0].terms.push(newTerm("lemma", "A step, like a genome."));
      d.new_findings[0].explainer.could_lead += " A lemma was proved.";
    };
    const path = "new_findings[0].terms[2].definition";
    expect(lines(termsOf({ edit }))).toEqual([`${path} | ${defineMessage(path, ["genome"])}`]);
  });

  it("reads the list of the config", () => {
    expect(termsOf({ config: withJargon(["glimmer"]), edit: define("How a genome folds.") })).toEqual([]);
    expect(lines(termsOf({ config: withJargon(["glimmer"]), edit: define("How a glimmer folds.") }))).toEqual([`${DEF} | ${defineMessage(DEF, ["glimmer"])}`]);
  });
});


describe("TERM_DEFINED, draft mode: the terms defined once the draft is published are the glossary's and the draft's new terms", () => {
  /** A glossary term of the stored records a run was given, as the stored glossary holds it. */
  const entry = (id: string, name: string): Term => Term.parse({
    id, en: { term: name, definition: "A made-up definition." }, zh: { term: "範例術語", definition: "範例定義。", official: null, official_url: null },
    fields: ["biology"], first_finding: "bio-2026-0001", first_date: EARLIER,
  });
  /** The stored records of a run: the glossary holds `enzyme`, which the Tuesday's story lists as an id, and the given terms. */
  const glossary = (...terms: Term[]): StoredRecords => ({ findings: [], corrections: [], terms: [entry("enzyme", "enzyme"), ...terms] });
  /** Adds a sentence to a part of a new finding. */
  const addTo = (finding: number, part: string, text: string): Edit => (d) => { d.new_findings[finding].explainer[part] += ` ${text}`; };
  const both = (...edits: Edit[]): Edit => (d) => { for (const e of edits) e(d); };
  /** The item lists the id and uses it in its explainer. */
  const itemLists = (id: string, words = id.replaceAll("-", " ")): Edit => both((d) => { d.new_findings[1].terms = [glossaryId(id)]; }, addTo(1, "found", `The ${words} was read.`));
  /** The story defines the term as new and uses it in its explainer. */
  const storyDefines = (name: string): Edit => both((d) => { d.new_findings[0].terms.push(newTerm(name)); }, addTo(0, "found", `The ${name} was read.`));
  const UNKNOWN = "new_findings[1].terms[0]";
  const unknownMessage = (id: string): string =>
    `${UNKNOWN} lists the glossary id "${id}", which is no term of the glossary and which no finding of this draft defines as a new term. Use a new term with a definition, or an id from the glossary.`;
  const noJargon = withJargon([]);

  describe("a listed glossary id is a term of the glossary or one that a finding of the draft defines as new", () => {
    it("passes the Tuesday, whose story lists the id enzyme that the glossary holds", () => {
      expect(termsOf({ stored: glossary() })).toEqual([]);
    });

    it("fails an id that the glossary does not hold and no finding defines, once, at the term, with the way to fix it", () => {
      const issues = termsOf({ edit: itemLists("genome"), stored: glossary() });
      expect(lines(issues)).toEqual([`${UNKNOWN} | ${unknownMessage("genome")}`]);
      expect(issues[0]!.severity).toBe("error");
    });

    it("fails the story's id too when the glossary lacks it, and names each unknown id at its own term", () => {
      const edit: Edit = (d) => { d.new_findings[1].terms = [glossaryId("genome"), glossaryId("isotope")]; addTo(1, "found", "A genome and an isotope were read.")(d); };
      const none: StoredRecords = { findings: [], corrections: [], terms: [] };
      expect(lines(termsOf({ edit, stored: none, config: noJargon }))).toEqual([
        `new_findings[0].terms[1] | ${unknownMessage("enzyme").replace(UNKNOWN, "new_findings[0].terms[1]")}`,
        `${UNKNOWN} | ${unknownMessage("genome")}`,
        `new_findings[1].terms[1] | ${unknownMessage("isotope").replace(UNKNOWN, "new_findings[1].terms[1]")}`,
      ]);
    });

    describe("a listed glossary id is named by the glossary's own name when the run holds the glossary, else by its id read as words (F-48)", () => {
      const ITEM_TERM = "new_findings[1].terms[0]";
      const accented = entry("schrodinger-equation", "Schr\u00f6dinger equation");
      const apostrophe = entry("newtons-laws", "Newton's laws");
      const accentedText = "Schr\u00f6dinger equation";
      const unused = (name: string): string => `${ITEM_TERM} | ${unusedMessage(ITEM_TERM, name)}`;

      it("passes a term whose name has an accent, with the glossary, and fails it as its id read as words without", () => {
        const edit = itemLists("schrodinger-equation", accentedText);
        expect(termsOf({ edit, stored: glossary(accented), config: noJargon })).toEqual([]);
        expect(lines(termsOf({ edit, stored: glossary(accented, entry("newtons-laws", "Newton's laws")), config: noJargon }))).toEqual([]);
        expect(lines(termsOf({ edit, config: noJargon }))).toEqual([unused("schrodinger equation")]);
        expect(lines(termsOf({ edit, stored: null, config: noJargon }))).toEqual([unused("schrodinger equation")]);
      });

      it("passes a term whose name has an apostrophe, with the glossary, and fails it as its id read as words without", () => {
        const edit = itemLists("newtons-laws", "Newton's laws");
        expect(termsOf({ edit, stored: glossary(apostrophe), config: noJargon })).toEqual([]);
        expect(lines(termsOf({ edit, config: noJargon }))).toEqual([unused("newtons laws")]);
      });

      it("reads the id as words for an id the glossary does not hold, and says it unknown as well", () => {
        const edit = itemLists("schrodinger-equation", accentedText);
        expect(lines(termsOf({ edit, stored: glossary(apostrophe), config: noJargon }))).toEqual([`${ITEM_TERM} | ${unknownMessage("schrodinger-equation")}`, unused("schrodinger equation")]);
      });

      it("names the term the glossary's way in the unused-term message too: a name the explainer does not use is said as the glossary spells it", () => {
        const edit: Edit = (d) => { d.new_findings[1].terms = [glossaryId("schrodinger-equation")]; };
        expect(lines(termsOf({ edit, stored: glossary(accented), config: noJargon }))).toEqual([unused("Schr\u00f6dinger equation")]);
      });

      it("counts the glossary's name as listing the jargon word of that name, which the id read as words would not", () => {
        const jargon = withJargon([accentedText]);
        const edit = itemLists("schrodinger-equation", accentedText);
        expect(termsOf({ edit, stored: glossary(accented), config: jargon })).toEqual([]);
        const path = "new_findings[1].explainer.found";
        expect(lines(termsOf({ edit, config: jargon })).filter((l) => l.startsWith(path))).toEqual([`${path} | ${usesMessage(path, [accentedText])}`]);
      });

      it("leaves a new term and a glossary name that is its id read as words as they were", () => {
        expect(termsOf({ edit: itemLists("genome"), stored: glossary(entry("genome", "genome")) })).toEqual([]);
        expect(termsOf({ edit: itemLists("genome"), stored: glossary(entry("genome", "genome")), config: noJargon })).toEqual([]);
      });
    });

    it("passes the id once the glossary holds it, whatever the other terms are", () => {
      expect(termsOf({ edit: itemLists("genome"), stored: glossary(entry("genome", "genome")) })).toEqual([]);
      expect(lines(termsOf({ edit: itemLists("genome"), stored: glossary(entry("genomes", "genomes")) }))).toEqual([`${UNKNOWN} | ${unknownMessage("genome")}`]);
    });

    it("skips the check when the run holds no stored records: only a run given the glossary can tell", () => {
      expect(termsOf({ edit: itemLists("genome") })).toEqual([]);
      expect(termsOf({ edit: itemLists("genome"), stored: null })).toEqual([]);
    });

    it("passes an id that another finding of the same draft defines as a new term, and fails it when no finding does", () => {
      expect(termsOf({ edit: both(storyDefines("genome"), itemLists("genome")), stored: glossary() })).toEqual([]);
      expect(lines(termsOf({ edit: itemLists("genome"), stored: glossary() }))).toEqual([`${UNKNOWN} | ${unknownMessage("genome")}`]);
    });

    it("passes an id that the finding itself defines as new, and one that a finding other than the story defines", () => {
      const own: Edit = (d) => { d.new_findings[1].terms = [newTerm("genome"), glossaryId("genome")]; addTo(1, "found", "A genome was read.")(d); };
      expect(termsOf({ edit: own, stored: glossary() })).toEqual([]);
      const reverse: Edit = (d) => {
        d.new_findings[1].terms = [newTerm("genome")];
        addTo(1, "found", "A genome was read.")(d);
        d.new_findings[0].terms.push(glossaryId("genome"));
        addTo(0, "found", "A genome was read.")(d);
      };
      expect(termsOf({ edit: reverse, stored: glossary() })).toEqual([]);
    });

    it.each([
      ["Genome Assembly", "genome-assembly"],
      ["Schr\u00f6dinger's equation", "schrodinger-s-equation"],
      ["CRISPR/Cas9", "crispr-cas9"],
      ["p-value", "p-value"],
      ["cryo-electron   microscopy", "cryo-electron-microscopy"],
      ["R2D2 model", "r2d2-model"],
      ["(Q-)learning", "q-learning"],
      ["Nyquist limit.", "nyquist-limit"],
    ])("reads the new term %j as the id %j: its English term in kebab case", (name, id) => {
      // The id is checked, not the words of the explainer: noJargon keeps the other tests of the rule quiet.
      const edit = both(storyDefines(name), (d) => { d.new_findings[1].terms = [glossaryId(id)]; addTo(1, "found", `The ${id.replaceAll("-", " ")} was read.`)(d); });
      expect(termsOf({ edit, stored: glossary(), config: noJargon })).toEqual([]);
      expect(lines(termsOf({ edit: both(edit, (d) => { d.new_findings[1].terms = [glossaryId(`${id}-2`)]; addTo(1, "found", `The ${id.replaceAll("-", " ")} 2 was read.`)(d); }), stored: glossary(), config: noJargon }))).toEqual([
        `${UNKNOWN} | ${unknownMessage(`${id}-2`)}`,
      ]);
    });

    it("reads only the ids the draft lists for its new findings: a stored finding the run was given has none to check here", () => {
      const record = storedFinding("bio-2026-0070", { terms: ["not-in-the-glossary"], artefacts: { doi: [], arxiv: [], lean: [], trial: [], pdb: [] } });
      const edit: Edit = (d) => { d.corrections.push({ ...draftCorrection("explainer.background", "A clearer background."), finding_id: "bio-2026-0070", report_id: null, type: "clarification" }); };
      expect(termsOf({ edit, stored: { ...glossary(), findings: [record] } })).toEqual([]);
    });
  });

  describe("a new term gives publish an id it can store: not empty, at most 60 characters, not an earlier new term's and not the glossary's (F-60)", () => {
    /** The first term `storyDefines()` adds: the story lists its two terms first. */
    const FIRST = "new_findings[0].terms[2]";
    const SECOND = "new_findings[0].terms[3]";
    const ITEM = "new_findings[1].terms[0]";
    /** A glossary entry first defined on `date`. */
    const entryOn = (id: string, name: string, date: string): Term => Term.parse({ ...entry(id, name), first_date: date });
    const empty = (path: string, name: string): string =>
      `${path} | ${path} defines the term "${name}", which gives an empty id: a term's id is its English term in kebab case, made from the letters a to z and the digits 0 to 9 in it. Give the term an English name with at least one of them.`;
    const long = (path: string, name: string, n: number): string =>
      `${path} | ${path} defines the term "${name}", whose id (its English term in kebab case) has ${n} characters; the limit is 60. Give the term a shorter English name.`;
    const twice = (path: string, name: string, id: string, first: string): string =>
      `${path} | ${path} defines the term "${name}", whose id "${id}" is already the id of the new term at ${first}. List that term again with its id (new: false), or give this one another English name.`;
    const held = (path: string, name: string, id: string): string =>
      `${path} | ${path} defines the term "${name}", whose id "${id}" is already in the glossary. List the existing term (new: false, with its id), or give this one another English name.`;
    /** The issues about a new term's id, of a draft that defines the given names, the first in the story and the others after it. */
    const idIssues = (names: readonly string[], stored: StoredRecords | null | undefined = glossary()): string[] =>
      lines(termsOf({ edit: both(...names.map(storyDefines)), stored, config: noJargon })).filter((l) => l.includes(" defines the term "));

    describe("a term whose id is empty: its English term has no letter a to z and no digit", () => {
      it.each([["a Han character", "\u5149"], ["punctuation", "!!!"], ["a hyphen", "-"], ["spaces", "   "], ["the German sharp s", "\u00df"], ["a Greek letter", "\u03a9"]])(
        "fails %s, once, at the term, with the stored records or without",
        (_what, name) => {
          for (const stored of [glossary(), null, undefined]) {
            const issues = termsOf({ edit: storyDefines(name), stored, config: noJargon });
            expect(lines(issues).filter((l) => l.startsWith(FIRST) && l.includes("empty id")), String(stored)).toEqual([empty(FIRST, name)]);
            expect(issues.filter((i) => i.path === FIRST && i.message.includes("empty id")).map((i) => i.severity)).toEqual(["error"]);
          }
        },
      );

      it("fails each such term at its own path, and passes a name that keeps one letter or digit", () => {
        expect(idIssues(["\u5149", "\u03a9"])).toEqual([empty(FIRST, "\u5149"), empty(SECOND, "\u03a9")]);
        expect(idIssues(["\u5149", "a\u5149"])).toEqual([empty(FIRST, "\u5149")]);
        expect(idIssues(["\u5149 2"])).toEqual([]);
        expect(idIssues(["\u03a9-b"])).toEqual([]);
      });

      it("says nothing of such a term's id twice: two such terms are two empty ids, not one repeated id", () => {
        expect(idIssues(["\u5149", "!!!"])).toEqual([empty(FIRST, "\u5149"), empty(SECOND, "!!!")]);
      });
    });

    describe("a term whose id is over 60 characters: its English term is within 60, but its letters expand when read as kebab case", () => {
      const LIGATURE = "\ufb03";
      it("fails a name whose id has 61 characters or more, and passes 60 (a ligature reads as three letters)", () => {
        expect(idIssues([`${LIGATURE.repeat(20)}`])).toEqual([]);
        expect(idIssues([`${LIGATURE.repeat(20)}x`])).toEqual([long(FIRST, `${LIGATURE.repeat(20)}x`, 61)]);
        expect(idIssues([LIGATURE.repeat(21)])).toEqual([long(FIRST, LIGATURE.repeat(21), 63)]);
        expect(idIssues(["a".repeat(60)])).toEqual([]);
      });

      it("names the number of characters rather than the id, and fails it with or without the stored records", () => {
        for (const stored of [glossary(), null]) expect(idIssues([LIGATURE.repeat(60)], stored)).toEqual([long(FIRST, LIGATURE.repeat(60), 180)]);
      });

      it("does not read a too long id as a repeated one: two such terms are two long ids", () => {
        const name = LIGATURE.repeat(21);
        expect(idIssues([name, name])).toEqual([long(FIRST, name, 63), long(SECOND, name, 63)]);
      });
    });

    describe("two new terms of one draft that give one id", () => {
      it("fails the second, at its path, naming the first, in one finding and in two", () => {
        expect(idIssues(["genome", "Genome"])).toEqual([twice(SECOND, "Genome", "genome", FIRST)]);
        const apart: Edit = both(storyDefines("p-value"), (d) => { d.new_findings[1].terms = [newTerm("P value")]; addTo(1, "found", "A P value was read.")(d); });
        expect(lines(termsOf({ edit: apart, stored: glossary(), config: noJargon })).filter((l) => l.includes(" defines the term "))).toEqual([
          twice(ITEM, "P value", "p-value", FIRST),
        ]);
      });

      it("fails each term after the first, and names the first one, not the term before it", () => {
        expect(idIssues(["genome", "Genome", "GENOME!"])).toEqual([
          twice(SECOND, "Genome", "genome", FIRST), twice("new_findings[0].terms[4]", "GENOME!", "genome", FIRST),
        ]);
        expect(idIssues(["genome", "isotope", "Genome"])).toEqual([twice("new_findings[0].terms[4]", "Genome", "genome", FIRST)]);
      });

      it("reads two names that differ only in case, accents, spaces and punctuation as one id, and others as two", () => {
        expect(idIssues(["Schr\u00f6dinger equation", "schrodinger-equation"])).toEqual([twice(SECOND, "schrodinger-equation", "schrodinger-equation", FIRST)]);
        expect(idIssues(["cryo-electron microscopy", "cryo electron  microscopy"])).toHaveLength(1);
        expect(idIssues(["genome", "genomes"])).toEqual([]);
        expect(idIssues(["gene-ome", "geneome"])).toEqual([]);
      });

      it("fails with no stored records too: the draft alone tells", () => {
        expect(idIssues(["genome", "Genome"], null)).toEqual([twice(SECOND, "Genome", "genome", FIRST)]);
        expect(idIssues(["genome", "Genome"], undefined)).toEqual([twice(SECOND, "Genome", "genome", FIRST)]);
      });

      it("does not call a listed id a second definition: a term listed by its id, once defined, is no new term", () => {
        const edit: Edit = both(storyDefines("genome"), (d) => { d.new_findings[1].terms = [glossaryId("genome")]; addTo(1, "found", "A genome was read.")(d); });
        expect(lines(termsOf({ edit, stored: glossary(), config: noJargon })).filter((l) => l.includes(" defines the term "))).toEqual([]);
      });
    });

    describe("a new term whose id the glossary holds already, when the run holds the glossary", () => {
      it("fails it at the term, with the way out, for a term first defined on an earlier day", () => {
        expect(idIssues(["genome"], glossary(entry("genome", "genome")))).toEqual([held(FIRST, "genome", "genome")]);
        expect(idIssues(["Genome"], glossary(entry("genome", "the genome")))).toEqual([held(FIRST, "Genome", "genome")]);
        const issues = termsOf({ edit: storyDefines("genome"), stored: glossary(entry("genome", "genome")), config: noJargon });
        expect(issues.filter((i) => i.message.includes("already in the glossary")).map((i) => [i.severity, i.path])).toEqual([["error", FIRST]]);
      });

      it("fails a term of the next day or of any day but the edition's own, and passes the edition's own", () => {
        for (const date of [EARLIER, "2026-11-23", "2026-11-25", "2026-12-24", "2025-11-24"]) {
          expect(idIssues(["genome"], glossary(entryOn("genome", "genome", date))), date).toEqual([held(FIRST, "genome", "genome")]);
        }
        expect(idIssues(["genome"], glossary(entryOn("genome", "genome", D)))).toEqual([]);
      });

      it("takes the edition's own date from the draft's date, so that a term of another day fails whatever the clock says", () => {
        expect(D).toBe("2026-11-24");
        expect(idIssues(["genome"], glossary(entryOn("genome", "genome", D)))).toEqual([]);
        expect(idIssues(["genome"], glossary(entryOn("genome", "genome", "2026-11-23")))).toHaveLength(1);
      });

      it("fails each such term, and only the terms of the glossary: a name the glossary lacks passes", () => {
        const stored = glossary(entry("genome", "genome"), entry("isotope", "isotope"), entryOn("lemma", "lemma", D));
        expect(idIssues(["genome", "isotope", "lemma", "manifold"], stored)).toEqual([held(FIRST, "genome", "genome"), held(SECOND, "isotope", "isotope")]);
        // the glossary every test of this describe holds (`enzyme`) is read like any other entry
        expect(idIssues(["enzyme"])).toEqual([held(FIRST, "enzyme", "enzyme")]);
      });

      it("reports a repeated id once, as repeated: the first term is the glossary's case and the second the draft's, not both for one term", () => {
        expect(idIssues(["genome", "Genome"], glossary(entry("genome", "genome")))).toEqual([held(FIRST, "genome", "genome"), twice(SECOND, "Genome", "genome", FIRST)]);
      });

      it("is skipped when the run holds no stored records: only a run given the glossary can tell", () => {
        expect(idIssues(["genome"], null)).toEqual([]);
        expect(idIssues(["genome"], undefined)).toEqual([]);
      });

      it("leaves a term listed by its id alone: the glossary's id is what it names", () => {
        expect(lines(termsOf({ edit: itemLists("genome"), stored: glossary(entry("genome", "genome")), config: noJargon })).filter((l) => l.includes(" defines the term "))).toEqual([]);
      });

      it("reads the glossary of a long list quickly: a 10,000-term glossary and a handful of new terms", () => {
        const many = Array.from({ length: 10_000 }, (_, i) => entry(`many-${i}`, `many ${i}`));
        const started = performance.now();
        expect(idIssues(["genome", "many 7"], { findings: [], corrections: [], terms: [entry("enzyme", "enzyme"), ...many] })).toEqual([held(SECOND, "many 7", "many-7")]);
        expect(performance.now() - started).toBeLessThan(3000);
      });
    });

    it("fails each of the four kinds of id problem as an error, at the term's own path, and as nothing else", () => {
      const LONG = "\ufb03".repeat(21);
      const edit = both(...["\u5149", LONG, "genome", "Genome", "enzyme"].map(storyDefines));
      const issues = termsOf({ edit, stored: glossary(), config: noJargon }).filter((i) => i.message.includes(" defines the term "));
      expect(issues.map((i) => [i.severity, i.path, i.code])).toEqual([
        ["error", "new_findings[0].terms[2]", "TERM_DEFINED"], ["error", "new_findings[0].terms[3]", "TERM_DEFINED"],
        ["error", "new_findings[0].terms[5]", "TERM_DEFINED"], ["error", "new_findings[0].terms[6]", "TERM_DEFINED"],
      ]);
    });

    it("reports its own errors apart from the glossary-id check: both can stand in one draft", () => {
      const edit: Edit = both(storyDefines("genome"), (d) => { d.new_findings[1].terms = [glossaryId("isotope")]; addTo(1, "found", "An isotope was read.")(d); });
      expect(lines(termsOf({ edit, stored: glossary(entry("genome", "genome")), config: noJargon }))).toEqual([
        held(FIRST, "genome", "genome"),
        `${UNKNOWN} | ${unknownMessage("isotope")}`,
      ]);
    });
  });

  describe("a definition may use the name of any term the glossary will hold, and of every finding's own listed terms", () => {
    const DEF = "new_findings[0].terms[0].definition";
    const define = (text: string): Edit => (d) => { d.new_findings[0].terms[0].definition = text; };

    it("passes a word of a glossary term that the finding does not list, which it fails without the glossary or without that term", () => {
      const edit = define("How a genome folds.");
      expect(lines(termsOf({ edit }))).toEqual([`${DEF} | ${defineMessage(DEF, ["genome"])}`]);
      expect(lines(termsOf({ edit, stored: glossary() }))).toEqual([`${DEF} | ${defineMessage(DEF, ["genome"])}`]);
      expect(termsOf({ edit, stored: glossary(entry("genome-map", "genome")) })).toEqual([]);
    });

    it("takes the English name of a glossary term in any case and number, and no other string of it", () => {
      expect(termsOf({ edit: define("How GENOMES fold."), stored: glossary(entry("genome", "Genome")) })).toEqual([]);
      expect(termsOf({ edit: define("How a genome folds."), stored: glossary(entry("genomes", "genomes")) })).toEqual([]);
      const named = glossary(entry("genome", "the set of genes"));
      expect(lines(termsOf({ edit: define("How a genome folds."), stored: named }))).toEqual([`${DEF} | ${defineMessage(DEF, ["genome"])}`]);
    });

    it("passes a word that another finding of the draft defines as a new term, with no glossary, and fails it without that term", () => {
      const edit = both(define("How a genome folds."), (d) => { d.new_findings[1].terms = [newTerm("genome")]; addTo(1, "found", "A genome was read.")(d); });
      expect(termsOf({ edit })).toEqual([]);
      expect(termsOf({ edit, stored: glossary() })).toEqual([]);
      const without = both(define("How a genome folds."), (d) => { d.new_findings[1].terms = [newTerm("genome")]; addTo(1, "found", "A genome was read.")(d); d.new_findings[1].terms = [glossaryId("genome")]; });
      expect(lines(termsOf({ edit: without, stored: glossary() }))).toEqual([
        `${DEF} | ${defineMessage(DEF, ["genome"])}`,
        `${UNKNOWN} | ${unknownMessage("genome")}`,
      ]);
    });

    it("still takes the finding's own listed terms, with a glossary that lacks them", () => {
      expect(termsOf({ edit: define("Protein folding shapes an enzyme."), stored: glossary() })).toEqual([]);
      const unlisted = glossary(entry("genome", "genome"));
      expect(termsOf({ edit: define("Protein folding shapes an enzyme, and a genome."), stored: unlisted })).toEqual([]);
    });

    it("looks at the finding's own terms before the glossary, so that a glossary of 10,000 terms costs a definition that uses its own terms nothing", () => {
      const own = entry("enzyme", "enzyme");
      const unique = `zx${Math.random().toString(36).slice(2, 8)}`; // names that no earlier test compiled a pattern for
      const many = Array.from({ length: 10_000 }, (_, i) => ({ ...own, id: `many-${i}`, en: { term: `${unique} term ${i}`, definition: "A made-up definition." } }) as Term);
      const started = performance.now();
      expect(termsOf({ edit: define("Protein folding shapes an enzyme."), stored: { findings: [], corrections: [], terms: [own, ...many] } })).toEqual([]);
      expect(performance.now() - started).toBeLessThan(3000);
      // A word that only the glossary defines is found there, and one that nothing defines is still told.
      expect(termsOf({ edit: define("How a genome folds."), stored: { findings: [], corrections: [], terms: [own, entry("genome-map", "genome"), ...many] } })).toEqual([]);
      expect(lines(termsOf({ edit: define("How a genome folds."), stored: { findings: [], corrections: [], terms: [own, ...many.slice(0, 50)] } }))).toEqual([`${DEF} | ${defineMessage(DEF, ["genome"])}`]);
    });

    it("lists each unlisted word once, the longest first, though the glossary defines others", () => {
      const edit = define("A genome, an isotope, a lemma and a genome again.");
      expect(lines(termsOf({ edit, stored: glossary(entry("lemma", "lemma")) }))).toEqual([`${DEF} | ${defineMessage(DEF, ["isotope", "genome"])}`]);
    });
  });
});

describe("TERM_DEFINED, published mode: each listed term appears in every record, the jargon tests only in the records being published", () => {
  /** A glossary term of the world, first used on a date. */
  const glossaryTerm = (id: string, name: string, definition: string, date = EARLIER): Term => Term.parse({
    id, en: { term: name, definition }, zh: { term: "範例術語", definition: "範例定義。", official: null, official_url: null },
    fields: ["biology"], first_finding: BIO, first_date: date,
  });
  const WHERE = (id: string, i = 0): string => `${FILE(id)}: terms[${i}]`;
  const PART = (id: string, part: string): string => `${FILE(id)}: explainer.${part}.en`;
  const ALL = [D, null, EARLIER] as const;

  /** The stored story with the term of its glossary entry left out of every part. */
  const bio: (w: PubWorld) => void = (w) => { finding(w, BIO).explainer.found = lzp(fill(45)); };
  const usesGenome = (id: string, part = "how_sure"): ((w: PubWorld) => void) => (w) => { finding(w, id).explainer[part] = lzp(fill(50, "A genome was read.")); };
  const compose = (...edits: ((w: PubWorld) => void)[]): ((w: PubWorld) => void) => (w) => { for (const e of edits) e(w); };

  it("passes the sized stored Tuesday in every mode", () => {
    for (const publishing of ALL) expect(pubTerms({ publishing }), String(publishing)).toEqual([]);
  });

  describe("every listed term appears in the explainer, on every record", () => {
    it("fails a term the story never uses, being published or not", () => {
      for (const publishing of ALL) {
        const issues = pubTerms({ publishing, edit: bio });
        expect(lines(issues), `publishing ${publishing}`).toEqual([`${WHERE(BIO)} | ${unusedMessage(WHERE(BIO), "protein folding")}`]);
        expect(issues[0]!.severity).toBe("error");
      }
    });

    it("fails the same on an item that is not being published, and on an item that is", () => {
      for (const id of [MATH, PHYS]) {
        for (const publishing of ALL) {
          const edit = (w: PubWorld): void => { finding(w, id).terms = ["protein-folding"]; };
          expect(lines(pubTerms({ publishing, edit })), `${id}, publishing ${publishing}`).toEqual([`${WHERE(id)} | ${unusedMessage(WHERE(id), "protein folding")}`]);
        }
      }
    });

    it("passes when any part of the stored explainer uses it", () => {
      for (const part of ALL_PARTS) {
        const edit = compose(bio, (w) => { finding(w, BIO).explainer[part] = lzp("The protein folding was seen."); });
        for (const publishing of ALL) expect(pubTerms({ publishing, edit }), `${part}, publishing ${publishing}`).toEqual([]);
      }
    });

    it("names the term as the glossary does, and as its id read in words when the glossary has no such term", () => {
      const renamed = compose(bio, (w) => { w.terms[0]!.en.term = "folding of proteins"; });
      expect(lines(pubTerms({ edit: renamed }))).toEqual([`${WHERE(BIO)} | ${unusedMessage(WHERE(BIO), "folding of proteins")}`]);
      const used = compose((w) => { w.terms[0]!.en.term = "folding of proteins"; finding(w, BIO).explainer.found = lzp(fill(45, "Folding of proteins.")); });
      expect(pubTerms({ edit: used })).toEqual([]);
      const gone = compose(bio, (w) => { w.terms.length = 0; });
      expect(lines(pubTerms({ edit: gone }))).toEqual([`${WHERE(BIO)} | ${unusedMessage(WHERE(BIO), "protein folding")}`]);
    });

    it("reads one term at a time: the second term of a finding fails alone", () => {
      const edit = (w: PubWorld): void => {
        finding(w, BIO).terms = ["protein-folding", "enzyme"];
        w.terms.push(glossaryTerm("enzyme", "enzyme", "A made-up definition."));
      };
      expect(lines(pubTerms({ edit }))).toEqual([`${WHERE(BIO, 1)} | ${unusedMessage(WHERE(BIO, 1), "enzyme")}`]);
    });

    it("does not read the Chinese side of the explainer", () => {
      const edit = compose(bio, (w) => { finding(w, BIO).explainer.matters = { en: fill(40), zh: "Protein folding and an enzyme." }; });
      expect(pubTerms({ edit }).map((i) => i.path)).toEqual([WHERE(BIO)]);
    });
  });

  describe("every jargon word of an explainer is a listed term, in the records being published", () => {
    it("fails a stored explainer that uses a word no term lists, on the records being published only", () => {
      for (const id of [BIO, MATH]) {
        expect(lines(pubTerms({ edit: usesGenome(id) })), id).toEqual([`${PART(id, "how_sure")} | ${usesMessage(PART(id, "how_sure"), ["genome"])}`]);
        expect(pubTerms({ publishing: null, edit: usesGenome(id) }), `${id}, nothing published`).toEqual([]);
        expect(pubTerms({ publishing: EARLIER, edit: usesGenome(id) }), `${id}, published earlier`).toEqual([]);
      }
      expect(pubTerms({ edit: usesGenome(PHYS) })).toEqual([]);
      expect(pubTerms({ publishing: null, edit: usesGenome(PHYS) })).toEqual([]);
      expect(lines(pubTerms({ publishing: EARLIER, edit: usesGenome(PHYS) }))).toEqual([`${PART(PHYS, "how_sure")} | ${usesMessage(PART(PHYS, "how_sure"), ["genome"])}`]);
    });

    it("passes the word once the finding lists a glossary term for it, or an id the glossary does not hold", () => {
      const listed = compose(usesGenome(BIO), (w) => { finding(w, BIO).terms = ["protein-folding", "genome"]; w.terms.push(glossaryTerm("genome", "genome", "A made-up definition.")); });
      expect(pubTerms({ edit: listed })).toEqual([]);
      const unknown = compose(usesGenome(BIO), (w) => { finding(w, BIO).terms = ["protein-folding", "genome"]; });
      expect(pubTerms({ edit: unknown })).toEqual([]);
    });

    it("reads the list of the config: another list lets a word through and fails its own", () => {
      const glimmer = (w: PubWorld): void => { finding(w, BIO).explainer.how_sure = lzp(fill(50, "A glimmer was seen.")); };
      expect(pubTerms({ config: withJargon(["glimmer"]), edit: glimmer }).map((i) => i.message)).toEqual([usesMessage(PART(BIO, "how_sure"), ["glimmer"])]);
      expect(pubTerms({ config: withJargon(["glimmer"]), edit: usesGenome(BIO) })).toEqual([]);
      expect(pubTerms({ config: withJargon([]), edit: usesGenome(BIO) })).toEqual([]);
      expect(pubTerms({ edit: glimmer })).toEqual([]);
    });

    it("does not read the Chinese side of the explainer", () => {
      const edit = (w: PubWorld): void => { finding(w, BIO).explainer.how_sure = { en: fill(50), zh: "A genome was read." }; };
      expect(pubTerms({ edit })).toEqual([]);
    });
  });

  describe("a definition uses no undefined jargon word, in the terms being published", () => {
    const DEF = "glossary.json: terms[0].en.definition";
    const define = (text: string): ((w: PubWorld) => void) => (w) => { w.terms[0]!.en.definition = text; };

    it("fails a jargon word that no term of the glossary is, with the way to fix it", () => {
      const issues = pubTerms({ edit: define("How a genome folds.") });
      expect(lines(issues)).toEqual([`${DEF} | ${defineMessage(DEF, ["genome"])}`]);
      expect(issues[0]!.severity).toBe("error");
    });

    it("passes the term itself and every other term of the glossary, in any case and number, being published or not", () => {
      const edit = compose(define("Protein folding shapes an enzyme, and GENOMES are read."), (w) => {
        w.terms.push(glossaryTerm("enzyme", "enzyme", "A made-up definition."), glossaryTerm("genome", "genome", "A made-up definition."));
      });
      for (const publishing of ALL) expect(pubTerms({ publishing, edit }), String(publishing)).toEqual([]);
    });

    it("takes the English names of the glossary's terms as the words it defines, and no other string: an id, a definition or a finding's title is not one", () => {
      const edit = compose(define("How a genome folds."), (w) => {
        w.terms.push(glossaryTerm("genome", "the set of genes", "A made-up definition."));
        finding(w, MATH).title = lzp("genome");
      });
      expect(lines(pubTerms({ edit }))).toEqual([`${DEF} | ${defineMessage(DEF, ["genome"])}`]);
      const named = compose(define("How a genome folds."), (w) => { w.terms.push(glossaryTerm("genes-of-a-cell", "genome", "A made-up definition.")); });
      expect(pubTerms({ edit: named })).toEqual([]);
    });

    it("takes only the English name of a term as defining a word: a Chinese name written in Latin letters defines nothing", () => {
      const edit = compose(define("How a genome folds."), (w) => {
        const term = glossaryTerm("genes-of-a-cell", "the set of genes", "A made-up definition.");
        term.zh!.term = "genome";
        w.terms.push(term);
      });
      expect(lines(pubTerms({ edit }))).toEqual([`${DEF} | ${defineMessage(DEF, ["genome"])}`]);
    });

    it("reads only the terms being published: a term first used earlier is not read, and never fails the run", () => {
      const edit = (w: PubWorld): void => { w.terms[0]!.first_date = EARLIER; define("How a genome folds.")(w); };
      expect(pubTerms({ edit })).toEqual([]);
      expect(lines(pubTerms({ publishing: EARLIER, edit }))).toEqual([`${DEF} | ${defineMessage(DEF, ["genome"])}`]);
      expect(pubTerms({ publishing: null, edit: define("How a genome folds.") })).toEqual([]);
    });

    it("lists each unlisted word once, the longest first, in the plural form of the message", () => {
      expect(lines(pubTerms({ edit: define("A genome, an isotope and a genome again.") }))).toEqual([`${DEF} | ${defineMessage(DEF, ["isotope", "genome"])}`]);
    });

    it("gives the verdict that a draft run given the same glossary gives: one set of defined words in both modes", () => {
      const genome = glossaryTerm("genome", "genome", "A made-up definition.");
      // The glossary holds the enzyme the Tuesday's story lists, as well as the terms a row adds.
      const enzyme = glossaryTerm("enzyme", "enzyme", "A made-up definition.");
      const inDraft = (terms: Term[], text: string): ValidationIssue[] => termsOf({
        edit: (d) => { d.new_findings[0].terms[0].definition = text; }, stored: { findings: [], corrections: [], terms: [enzyme, ...terms] },
      });
      const inGlossary = (terms: Term[], text: string): ValidationIssue[] => pubTerms({ edit: compose(define(text), (w) => { w.terms.push(enzyme, ...terms); }) });
      const matrix: [Term[], string, boolean][] = [
        [[genome], "How a genome folds.", true], [[genome], "How GENOMES fold.", true], [[], "How a genome folds.", false], [[genome], "How an isotope folds.", false],
        [[genome], "How a genome and an isotope fold.", false], [[], "How a plain thing folds.", true],
      ];
      for (const [terms, text, passes] of matrix) {
        expect(inDraft(terms, text).length === 0, `draft: ${text} (${terms.length} terms)`).toBe(passes);
        expect(inGlossary(terms, text).length === 0, `stored: ${text} (${terms.length} terms)`).toBe(passes);
      }
    });

    it("reads the list of the config", () => {
      expect(pubTerms({ config: withJargon(["glimmer"]), edit: define("How a genome folds.") })).toEqual([]);
      expect(lines(pubTerms({ config: withJargon(["glimmer"]), edit: define("How a glimmer folds.") }))).toEqual([`${DEF} | ${defineMessage(DEF, ["glimmer"])}`]);
    });

    it("does not read the Chinese definition of a term, nor the name of a term as a definition", () => {
      const edit = (w: PubWorld): void => {
        w.terms[0]!.zh!.definition = "A genome folds.";
        w.terms[0]!.zh!.term = "A genome";
        // a term of its own, being published, whose name holds a jargon word that no term of the glossary is
        w.terms.push(glossaryTerm("genome-folding", "genome folding", "A made-up definition.", D));
      };
      expect(pubTerms({ edit })).toEqual([]);
      // the same words in the English definition are read
      const english = compose(edit, (w) => { w.terms[0]!.en.definition = "A genome folds."; });
      expect(lines(pubTerms({ edit: english }))).toEqual([`${DEF} | ${defineMessage(DEF, ["genome"])}`]);
    });
  });

  describe("removed text", () => {
    it("lifts the need for each listed term to appear in a finding with a removed explainer part, whichever part", () => {
      for (const part of ALL_PARTS) {
        for (const publishing of ALL) {
          expect(pubTerms({ publishing, edit: compose(bio, removePart(BIO, part)) }), `${part}, publishing ${publishing}`).toEqual([]);
        }
      }
    });

    it("is keyed on the stored correction: the removed text written with no correction leaves the term unused", () => {
      for (const publishing of ALL) {
        expect(lines(pubTerms({ publishing, edit: compose(bio, removePart(BIO, "how_sure", false)) }))).toEqual([`${WHERE(BIO)} | ${unusedMessage(WHERE(BIO), "protein folding")}`]);
      }
    });

    it("is lifted by a removed part of the same finding only, and by a removed explainer part only", () => {
      const other = (w: PubWorld): void => { finding(w, MATH).terms = ["protein-folding"]; };
      expect(lines(pubTerms({ edit: compose(other, removePart(BIO, "how_sure")) }))).toEqual([`${WHERE(MATH)} | ${unusedMessage(WHERE(MATH), "protein folding")}`]);
      const note = (w: PubWorld): void => {
        finding(w, BIO).rung_history[1].note = clone(REMOVED_TEXT);
        w.corrections.push(removal("C-0003", { finding: BIO }, "rung_history.1.note"));
      };
      expect(lines(pubTerms({ edit: compose(bio, note) }))).toEqual([`${WHERE(BIO)} | ${unusedMessage(WHERE(BIO), "protein folding")}`]);
    });

    it("leaves a removed explainer part unread by the jargon test, whatever it holds", () => {
      const edit = (stored: boolean) => (w: PubWorld): void => {
        finding(w, BIO).explainer.how_sure = lzp(fill(50, "A genome was read."));
        if (stored) { w.corrections.push(removal("C-0003", { finding: BIO }, "explainer.how_sure")); holdRemoved(w as never); }
      };
      expect(pubTerms({ edit: edit(true) })).toEqual([]);
      expect(lines(pubTerms({ edit: edit(false) }))).toEqual([`${PART(BIO, "how_sure")} | ${usesMessage(PART(BIO, "how_sure"), ["genome"])}`]);
    });

    it("leaves a removed definition unread, whatever it holds", () => {
      const edit = (stored: boolean) => (w: PubWorld): void => {
        w.terms[0]!.en.definition = "How a genome folds.";
        if (stored) { w.corrections.push(removal("C-0003", { term: "protein-folding" }, "definition")); holdRemoved(w as never); }
      };
      expect(pubTerms({ edit: edit(true) })).toEqual([]);
      expect(lines(pubTerms({ edit: edit(false) }))).toEqual([`glossary.json: terms[0].en.definition | ${defineMessage("glossary.json: terms[0].en.definition", ["genome"])}`]);
    });
  });
});


// ── READING_LEVEL ────────────────────────────────────────────────────────────────────────────────

const readingOf = (scene: Scene = {}): ValidationIssue[] => only(draftRun("READING_LEVEL", scene), "READING_LEVEL");
const pubReading = (scene: PubScene = {}): ValidationIssue[] => only(pubRun("READING_LEVEL", scene), "READING_LEVEL");

const FIX_READING = "Use shorter sentences and shorter, more common words.";
/** The message of a text above the soft grade, and above the hard one. */
const softMessage = (what: string, grade: number, soft = "12"): string => `${what} reads at grade ${grade.toFixed(2)}; the target is ${soft}. ${FIX_READING}`;
const hardMessage = (what: string, grade: number, max = "14"): string => `${what} reads at grade ${grade.toFixed(2)}; the limit is ${max}. ${FIX_READING}`;
const SOFT_HINT = "The target is soft: the draft is accepted as it is, but an easier read is better.";
const repeated = (text: string, n = 6): string => Array(n).fill(text).join(" ");
/** A text full of long words that a finding lists as its term: 18.7 with the word in the average, 4.4 without it. */
const TERMY = "The team measured electroencephalography and electroencephalography results today in the lab.";
/** The same sentence with its long words in lower case, as names (capitalised, inside the sentence) and as tokens with a digit. */
const LOWER_NAMES = "The team measured electroencephalography and characteristically and internationalization results today in the lab.";
const CAPITAL_NAMES = "The team measured Electroencephalography and Characteristically and Internationalization results today in the lab.";
const DIGIT_TOKENS = "The team measured electroencephalography2 and characteristically3 and internationalization4 results today in the lab.";
/** A long word that starts its sentence is not left out. */
const FIRST_WORD = "Electroencephalography characteristically internationalization uncharacteristically.";
/** A short text of long words, for a field with a short limit in characters: far above any grade limit. */
const HARD_SHORT = "Characteristically uncharacteristically internationalization considerations.";
/** One very long sentence of long words: it alone is far above any limit. */
const VERY_HARD = `${Array(30).fill("characteristically uncharacteristically internationalization").join(" ")}.`;

/** Sets every part of a new finding to one text (an item's AI part stays null). */
const setParts = (finding: number, text: string): Edit => (d) => {
  for (const part of ALL_PARTS) if (d.new_findings[finding].explainer[part] !== null) d.new_findings[finding].explainer[part] = text;
};

describe("READING_LEVEL, draft mode: the grade of each explainer, the Lead, the deep dive and the big picture", () => {
  const STORY = "new_findings[0].explainer";
  const ITEM = "new_findings[1].explainer";

  it("has texts at the grades the tests rely on: easy under 12, soft above 12 and up to 14, hard above 14", () => {
    expect(readingGrade(repeated(EASY_S))).toBeLessThan(12);
    expect(readingGrade(repeated(SOFT_S))).toBeGreaterThan(12);
    expect(readingGrade(repeated(SOFT_S))).toBeLessThanOrEqual(14);
    expect(readingGrade(repeated(HARD_S))).toBeGreaterThan(14);
    expect(readingGrade(repeated(TERMY))).toBeGreaterThan(14);
    expect(readingGrade(repeated(TERMY), { terms: ["electroencephalography"] })).toBeLessThan(12);
  });

  it("passes the sized Tuesday and an explainer at an easy grade", () => {
    expect(readingOf()).toEqual([]);
    expect(readingOf({ edit: setParts(0, EASY_S) })).toEqual([]);
  });

  it("warns above grade 12 and up to 14, and says the grade to two places, the target and what to do", () => {
    const g = readingGrade(repeated(SOFT_S));
    const issues = readingOf({ edit: setParts(0, SOFT_S) });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "READING_LEVEL", severity: "warning", path: STORY, message: softMessage("The explainer", g), hint: SOFT_HINT });
    expect(issues[0]!.message).toBe(`The explainer reads at grade ${g.toFixed(2)}; the target is 12. ${FIX_READING}`);
  });

  it("fails above grade 14, once, and says the grade, the limit and what to do", () => {
    const g = readingGrade(repeated(HARD_S));
    const issues = readingOf({ edit: setParts(0, HARD_S) });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "READING_LEVEL", severity: "error", path: STORY, message: hardMessage("The explainer", g) });
    expect(issues[0]!.hint ?? null).toBeNull();
  });

  it("compares the grade with the soft and the hard limit of run.json, strictly: a grade at a limit passes it", () => {
    const g = readingGrade(repeated(SOFT_S));
    const budgets = (soft: number, max: number): Scene => ({ config: withBudgets({ reading_grade_soft: soft, reading_grade_max: max }), edit: setParts(0, SOFT_S) });
    // With a soft limit of 0 every other text of the draft warns too, so these read the story's explainer alone.
    const story = (soft: number, max: number): ValidationIssue[] => at(readingOf(budgets(soft, max)), STORY);
    expect(readingOf(budgets(g, g))).toEqual([]);
    expect(readingOf(budgets(g, 100))).toEqual([]);
    const below = g - 0.001;
    expect(lines(readingOf(budgets(below, 100)))).toEqual([`${STORY} | ${softMessage("The explainer", g, String(below))}`]);
    expect(readingOf(budgets(below, 100))[0]!.severity).toBe("warning");
    expect(story(0, g).map((i) => i.severity)).toEqual(["warning"]);
    expect(lines(readingOf(budgets(below, below)))).toEqual([`${STORY} | ${hardMessage("The explainer", g, String(below))}`]);
    expect(readingOf(budgets(below, below))[0]!.severity).toBe("error");
    expect(story(0, below).map((i) => i.severity)).toEqual(["error"]);
  });

  it("takes the soft limit from the target and the hard from the limit, not the other way", () => {
    const g = readingGrade(repeated(SOFT_S));
    expect(readingOf({ config: withBudgets({ reading_grade_soft: 20, reading_grade_max: 30 }), edit: setParts(0, HARD_S) })).toEqual([]);
    expect(readingOf({ config: withBudgets({ reading_grade_soft: 5, reading_grade_max: 20 }), edit: setParts(0, SOFT_S) })[0]!.severity).toBe("warning");
    expect(readingOf({ config: withBudgets({ reading_grade_soft: 5, reading_grade_max: 10 }), edit: setParts(0, SOFT_S) })[0]!.message).toBe(hardMessage("The explainer", g, "10"));
  });

  it("judges the explainer as a whole: a hard part among easy ones reads at the grade of all of them", () => {
    const edit: Edit = (d) => { setParts(0, EASY_S)(d); d.new_findings[0].explainer.found = HARD_S; };
    const whole = readingGrade([HARD_S, ...Array(5).fill(EASY_S)].join(" "));
    expect(whole).toBeLessThan(12);
    expect(readingGrade(HARD_S)).toBeGreaterThan(14);
    expect(readingOf({ edit })).toEqual([]);
    const soft: Edit = (d) => { setParts(0, EASY_S)(d); d.new_findings[0].explainer.found = repeated(VERY_HARD, 1); };
    expect(readingOf({ edit: soft })[0]!.severity).toBe("error");
  });

  it("reads each explainer by itself: the item's grade is not the story's", () => {
    const hardItem = readingOf({ edit: (d) => { setParts(0, EASY_S)(d); setParts(1, HARD_S)(d); } });
    expect(lines(hardItem)).toEqual([`${ITEM} | ${hardMessage("The explainer", readingGrade(repeated(HARD_S, 5)))}`]);
    const hardStory = readingOf({ edit: (d) => { setParts(0, HARD_S)(d); setParts(1, EASY_S)(d); } });
    expect(lines(hardStory)).toEqual([`${STORY} | ${hardMessage("The explainer", readingGrade(repeated(HARD_S)))}`]);
    const softItem = readingOf({ edit: (d) => { setParts(0, EASY_S)(d); setParts(1, SOFT_S)(d); } });
    expect(softItem.map((i) => [i.path, i.severity])).toEqual([[ITEM, "warning"]]);
  });

  it("leaves capitalised names inside a sentence and tokens with digits out of the syllable average, as the row says", () => {
    expect(readingGrade(repeated(LOWER_NAMES))).toBeGreaterThan(14);
    for (const text of [CAPITAL_NAMES, DIGIT_TOKENS]) {
      expect(readingGrade(repeated(text)), text).toBeLessThan(12);
      expect(readingOf({ edit: setParts(0, text) }), text).toEqual([]);
    }
    expect(readingOf({ edit: setParts(0, LOWER_NAMES) }).map((i) => [i.path, i.severity])).toEqual([[STORY, "error"]]);
    // a capitalised word that starts its sentence is a word like any other
    expect(readingOf({ edit: setParts(0, FIRST_WORD) }).map((i) => i.severity)).toEqual(["error"]);
  });

  it("leaves the finding's own terms out of the syllable average, and no one else's", () => {
    const listed = (term: Json): Edit => (d) => { setParts(0, TERMY)(d); d.new_findings[0].terms = [term]; };
    expect(readingOf({ edit: listed({ new: true, term: "electroencephalography", definition: "A made-up definition." }) })).toEqual([]);
    expect(readingOf({ edit: listed({ new: false, id: "electroencephalography" }) })).toEqual([]);
    const g = readingGrade(repeated(TERMY));
    expect(lines(readingOf({ edit: (d) => { setParts(0, TERMY)(d); d.new_findings[0].terms = []; } }))).toEqual([`${STORY} | ${hardMessage("The explainer", g)}`]);
    const other = readingOf({ edit: (d) => { setParts(0, EASY_S)(d); setParts(1, TERMY)(d); d.new_findings[0].terms = [{ new: false, id: "electroencephalography" }]; } });
    expect(lines(other)).toEqual([`${ITEM} | ${hardMessage("The explainer", readingGrade(repeated(TERMY, 5)))}`]);
    const withTerm = readingGrade(repeated(TERMY), { terms: ["electroencephalography"] });
    expect(withTerm).toBeLessThan(readingGrade(repeated(TERMY)));
  });

  describe("the deep dive is graded with the terms of the finding it is about", () => {
    const DIVE = "bio-2024-0007";
    const OTHER = "math-2025-0009";
    const PATH = "deep_dive.text";
    const TEXT = repeated(TERMY, 3);
    /** A stored finding from an earlier year, as the Ledger holds it, listing these terms (ids of the glossary). */
    const record = (id: string, terms: string[]): Finding => {
      const year = id.slice(id.indexOf("-") + 1, id.indexOf("-") + 5);
      const day = (m: string): string => `${year}-${m}`;
      return storedFinding(id, {
        terms, first_published: day("05-01"), first_brief: day("05-02"), briefs: [day("05-02")], updated: day("05-02"), since_then: [],
        rung_history: [
          { rung: "preprint", date: day("04-01"), recorded: day("04-05"), source_id: "s2", by: "agent", note: null },
          { rung: "checked", date: day("05-01"), recorded: day("05-02"), source_id: "s1", by: "agent", note: lzp("Published in Example Journal.") },
        ],
      });
    };
    const sunday = (stored: StoredRecords | null, id = DIVE): Scene => ({
      edition: "sunday", stored, edit: (d) => { d.deep_dive.text = TEXT; d.deep_dive.finding_id = id; },
    });
    const given = (findings: Finding[], terms: Term[] = []): StoredRecords => ({ findings, corrections: [], terms });
    const HARD = `${PATH} | ${hardMessage("The deep dive", readingGrade(TEXT))}`;

    it("has a text that is hard with no term and easy with the finding's term", () => {
      expect(readingGrade(TEXT)).toBeGreaterThan(14);
      expect(readingGrade(TEXT, { terms: ["electroencephalography"] })).toBeLessThan(12);
    });

    it("leaves the terms of the deep dive's finding out of its grade", () => {
      expect(readingOf(sunday(given([record(DIVE, ["electroencephalography"])])))).toEqual([]);
    });

    it("fails the same text when the finding lists no such term, and when the run holds no record of the finding", () => {
      const listed = readingOf(sunday(given([record(DIVE, [])])));
      expect(lines(listed)).toEqual([HARD]);
      expect(listed[0]!.severity).toBe("error");
      expect(lines(readingOf(sunday(null)))).toEqual([HARD]);
      expect(lines(readingOf(sunday(given([]))))).toEqual([HARD]);
    });

    it("takes the terms of the finding the deep dive is about, not another finding's", () => {
      const records = given([record(DIVE, []), record(OTHER, ["electroencephalography"])]);
      expect(lines(readingOf(sunday(records)))).toEqual([HARD]);
      expect(readingOf(sunday(records, OTHER))).toEqual([]);
      const listed: Edit = (d) => { d.new_findings[0].terms = [{ new: true, term: "electroencephalography", definition: "A made-up definition." }]; };
      const scene = sunday(given([record(DIVE, [])]));
      expect(lines(readingOf({ ...scene, edit: (d) => { scene.edit!(d); listed(d); } }))).toEqual([HARD]);
    });

    it("names a term as the glossary does, and as its id reads where the glossary lacks it", () => {
      const eeg = Term.parse({
        id: "eeg-signals", en: { term: "electroencephalography", definition: "A made-up definition." },
        zh: { term: "範例術語", definition: "範例定義。", official: null, official_url: null }, fields: ["biology"], first_finding: DIVE, first_date: "2024-05-02",
      });
      expect(readingOf(sunday(given([record(DIVE, ["eeg-signals"])], [eeg])))).toEqual([]);
      expect(lines(readingOf(sunday(given([record(DIVE, ["eeg-signals"])]))))).toEqual([HARD]);
      expect(readingOf(sunday(given([record(DIVE, ["electroencephalography"])])))).toEqual([]);
    });

    it("grades a deep dive on a finding that the run knows nothing of with no terms, and does not fail to read it", () => {
      expect(lines(readingOf(sunday(given([record(DIVE, ["electroencephalography"])]), "bio-2099-0001")))).toEqual([HARD]);
    });

    it("leaves the explainer's own terms and the Lead and the big picture as they were", () => {
      const scene = sunday(given([record(DIVE, ["electroencephalography"])]));
      const hardLead: Edit = (d) => { scene.edit!(d); d.lead = [{ text: repeated(TERMY, 3), refs: ["new-1"] }]; };
      expect(lines(readingOf({ ...scene, edit: hardLead }))).toEqual([`lead | ${hardMessage("The Lead", readingGrade(TEXT))}`]);
    });

    it("grades the big picture with no terms, even in a draft that also carries a deep dive on a finding that lists them", () => {
      const edit: Edit = (d) => {
        d.deep_dive = { finding_id: DIVE, text: repeated(EASY_S, 3), source_ids: ["b1"], why_today: "anniversary" };
        d.review.big_picture = TEXT;
      };
      const scene: Scene = { edition: "monday", stored: given([record(DIVE, ["electroencephalography"])]), edit };
      expect(lines(readingOf(scene))).toEqual([`review.big_picture | ${hardMessage("The big picture", readingGrade(TEXT))}`]);
    });
  });

  // The text that is not an explainer: the Lead, the deep dive and the big picture are read as one text each.
  const OTHERS: [string, string, Edition | undefined, (d: Json, t: string) => void][] = [
    ["the Lead", "lead", undefined, (d, t) => { d.lead = [{ text: t, refs: ["new-1"] }]; }],
    ["the deep dive", "deep_dive.text", "sunday", (d, t) => { d.deep_dive.text = t; }],
    ["the big picture", "review.big_picture", "monday", (d, t) => { d.review.big_picture = t; }],
  ];
  const WHAT: Record<string, string> = { lead: "The Lead", "deep_dive.text": "The deep dive", "review.big_picture": "The big picture" };

  it.each(OTHERS.map((o) => [o[0], o] as const))("reads %s: an easy text passes, a soft one warns and a hard one fails", (_label, [, path, edition, set]) => {
    const scene = (text: string): Scene => ({ edition, edit: (d) => set(d, repeated(text, 3)) });
    expect(readingOf(scene(EASY_S))).toEqual([]);
    const soft = readingOf(scene(SOFT_S));
    expect(soft).toHaveLength(1);
    expect(soft[0]).toMatchObject({ severity: "warning", path, message: softMessage(WHAT[path]!, readingGrade(repeated(SOFT_S, 3))), hint: SOFT_HINT });
    const hard = readingOf(scene(HARD_S));
    expect(lines(hard)).toEqual([`${path} | ${hardMessage(WHAT[path]!, readingGrade(repeated(HARD_S, 3)))}`]);
    expect(hard[0]!.severity).toBe("error");
  });

  it("reads the Lead as one text, its lines joined, and passes a Lead with no line", () => {
    const lead = (...texts: string[]): Edit => (d) => { d.lead = texts.map((text) => ({ text, refs: ["new-1"] })); };
    expect(readingOf({ edit: lead(HARD_S, EASY_S, EASY_S) })).toEqual([]);
    expect(readingGrade(HARD_S)).toBeGreaterThan(14);
    const g = readingGrade([SOFT_S, SOFT_S].join(" "));
    expect(lines(readingOf({ edit: lead(SOFT_S, SOFT_S) }))).toEqual([`lead | ${softMessage("The Lead", g)}`]);
    expect(readingOf({ edit: (d) => { d.lead = []; } })).toEqual([]);
  });

  it("does not read what is not an explainer, the Lead, the deep dive or the big picture: a title, a note, an update, an idea, an Also noted line, a remarkable note", () => {
    const hard = repeated(HARD_S, 3);
    expect(readingGrade(HARD_SHORT)).toBeGreaterThan(14);
    const edit: Edit = (d) => {
      d.new_findings[0].title = hard;
      d.new_findings[0].rung_history[0].note = hard;
      d.new_findings[0].figure = { ...FIGURE, alt: hard, credit: HARD_SHORT };
      d.new_findings[0].terms[0].definition = hard;
      d.returning[0].update = hard;
      d.returning[0].rung.note = hard;
      d.rung_changes[0].rung.note = hard;
      d.ideas[0].text = hard;
      d.also[0].title = hard;
      d.corrections[0].reason = hard;
      d.report_decisions[0].reason = hard;
    };
    expect(readingOf({ edit })).toEqual([]);
    const review: Edit = (d) => { edit(d); d.review.remarkable.note = hard; d.review.strongest_against.text = hard; };
    expect(readingOf({ edition: "monday", edit: review })).toEqual([]);
  });

  it("does not read a correction's text, nor a quote, a source's title or a name", () => {
    const hard = HARD_S;
    const edit: Edit = (d) => {
      d.new_findings[0].ai.evidence[0].quote = hard;
      d.new_findings[0].reactions[0].quote = hard;
      d.new_findings[0].sources[0].title = hard;
      d.corrections.push({ ...draftCorrection("explainer.found", hard), report_id: null });
    };
    expect(readingOf({ edit })).toEqual([]);
  });

  it("reads each grade of one run on its own: an easy Lead beside a hard explainer fails the explainer only", () => {
    const issues = readingOf({ edit: (d) => { setParts(0, HARD_S)(d); d.lead = [{ text: EASY_S, refs: ["new-1"] }]; } });
    expect(issues.map((i) => i.path)).toEqual([STORY]);
  });

  it("is a soft fixture away from its limits: a story's explainer at a soft grade passes every other rule of the group", () => {
    // Eleven sentences of 5 to 23 words in the six parts, each part inside its own cap and the six inside the story's 230 to 280 words.
    const S23 = "The team measured how the material changed under heat and found that its structure stayed stable through several repeated experiments with different samples.";
    const S5 = "Independent laboratories reproduced the measurements.";
    const parts = [[S23, S23], [S23, S23], [S23, S23, S5], [S23, S23, S5], [S23, S5], [S23, S5]];
    const edit: Edit = (d) => {
      d.new_findings[0].terms = [];
      ALL_PARTS.forEach((part, i) => { d.new_findings[0].explainer[part] = parts[i]!.join(" "); });
    };
    const text = parts.flat().join(" ");
    expect(countWords(text)).toBe(250);
    const g = readingGrade(text);
    expect(g).toBeGreaterThan(12);
    expect(g).toBeLessThanOrEqual(14);
    const issues = draftRun(null, { edit });
    expect(issues.map((i) => `${i.severity} ${i.code} ${i.path}`)).toEqual([`warning READING_LEVEL ${STORY}`]);
    expect(issues[0]!.message).toBe(softMessage("The explainer", g));
  });
});

describe("READING_LEVEL, published mode: the records being published, and no other", () => {
  const STORY = `${FILE(BIO)}: explainer`;
  const setStoredParts = (id: string, text: string): ((w: PubWorld) => void) => (w) => { for (const part of ALL_PARTS) finding(w, id).explainer[part] = lzp(text); };
  const compose = (...edits: ((w: PubWorld) => void)[]): ((w: PubWorld) => void) => (w) => { for (const e of edits) e(w); };

  it("warns on a soft explainer and fails a hard one, with the grade of the English text", () => {
    const soft = pubReading({ edit: setStoredParts(BIO, SOFT_S) });
    expect(soft).toHaveLength(1);
    expect(soft[0]).toMatchObject({ severity: "warning", path: STORY, message: softMessage("The explainer", readingGrade(repeated(SOFT_S))), hint: SOFT_HINT });
    const hard = pubReading({ edit: setStoredParts(BIO, HARD_S) });
    expect(lines(hard)).toEqual([`${STORY} | ${hardMessage("The explainer", readingGrade(repeated(HARD_S)))}`]);
    expect(hard[0]!.severity).toBe("error");
    expect(pubReading({ edit: setStoredParts(BIO, EASY_S) })).toEqual([]);
  });

  it("reads the explainers of the findings being published only", () => {
    for (const id of [BIO, MATH]) {
      expect(pubReading({ edit: setStoredParts(id, HARD_S) }).map((i) => i.path), id).toEqual([`${FILE(id)}: explainer`]);
      expect(pubReading({ publishing: null, edit: setStoredParts(id, HARD_S) }), `${id}, nothing published`).toEqual([]);
      expect(pubReading({ publishing: EARLIER, edit: setStoredParts(id, HARD_S) }), `${id}, published earlier`).toEqual([]);
    }
    expect(pubReading({ edit: setStoredParts(PHYS, HARD_S) })).toEqual([]);
    expect(pubReading({ publishing: null, edit: setStoredParts(PHYS, HARD_S) })).toEqual([]);
    expect(pubReading({ publishing: EARLIER, edit: setStoredParts(PHYS, HARD_S) }).map((i) => i.path)).toEqual([`${FILE(PHYS)}: explainer`]);
  });

  it("leaves the frozen explainer of a returning finding out, and still reads one first briefed on the date being published (F-55)", () => {
    const returning = (w: PubWorld): void => { finding(w, PHYS).updated = D; };
    expect(pubReading({ edit: compose(returning, setStoredParts(PHYS, HARD_S)) })).toEqual([]);
    expect(pubReading({ edit: compose(returning, setStoredParts(PHYS, SOFT_S)) })).toEqual([]);
    expect(pubReading({ publishing: EARLIER, edit: compose(returning, setStoredParts(PHYS, HARD_S)) }).map((i) => i.path)).toEqual([`${FILE(PHYS)}: explainer`]);
  });

  it("reads the soft and the hard limit of the budgets", () => {
    const g = readingGrade(repeated(SOFT_S));
    const budgets = (soft: number, max: number): PubScene => ({ config: withBudgets({ reading_grade_soft: soft, reading_grade_max: max }), edit: setStoredParts(BIO, SOFT_S) });
    expect(pubReading(budgets(g, g))).toEqual([]);
    expect(pubReading(budgets(g - 0.001, 100))[0]!.severity).toBe("warning");
    // With a soft limit of 0 every other text of the world warns too, so this reads the story's explainer alone.
    expect(at(pubReading(budgets(0, g - 0.001)), STORY).map((i) => i.severity)).toEqual(["error"]);
    expect(at(pubReading(budgets(0, g)), STORY).map((i) => i.severity)).toEqual(["warning"]);
  });

  it("leaves capitalised names inside a sentence and tokens with digits out of the syllable average", () => {
    expect(pubReading({ edit: setStoredParts(BIO, CAPITAL_NAMES) })).toEqual([]);
    expect(pubReading({ edit: setStoredParts(BIO, DIGIT_TOKENS) })).toEqual([]);
    expect(pubReading({ edit: setStoredParts(BIO, LOWER_NAMES) }).map((i) => [i.path, i.severity])).toEqual([[STORY, "error"]]);
  });

  it("leaves the terms of the glossary that the finding lists out of the syllable average", () => {
    const named = compose(setStoredParts(BIO, TERMY), (w) => { w.terms[0]!.en.term = "electroencephalography"; });
    expect(pubReading({ edit: named })).toEqual([]);
    const unnamed = compose(setStoredParts(BIO, TERMY), (w) => { w.terms.length = 0; });
    expect(lines(pubReading({ edit: unnamed }))).toEqual([`${STORY} | ${hardMessage("The explainer", readingGrade(repeated(TERMY)))}`]);
    const another = compose(setStoredParts(MATH, TERMY), (w) => { w.terms[0]!.en.term = "electroencephalography"; });
    expect(pubReading({ edit: another }).map((i) => i.path)).toEqual([`${FILE(MATH)}: explainer`]);
  });

  describe("the deep dive is graded with the terms of the finding it is about", () => {
    const DEEP = `${BRIEF_FILE}: deep_dive.text.en`;
    const TEXT = repeated(TERMY, 3);
    const HARD = `${DEEP} | ${hardMessage("The deep dive", readingGrade(TEXT))}`;
    const dive = (id: string) => (w: PubWorld): void => { asSunday(w); briefOf(w).deep_dive.finding_id = id; briefOf(w).deep_dive.text = lzp(TEXT); };
    const renamed = (w: PubWorld): void => { w.terms[0]!.en.term = "electroencephalography"; };

    it("leaves the glossary names of the deep dive's finding's terms out of its grade", () => {
      expect(pubReading({ edit: compose(dive(BIO), renamed) })).toEqual([]);
    });

    it("fails the same text when the finding does not list that term, and when no term of the glossary has that name", () => {
      expect(lines(pubReading({ edit: dive(BIO) }))).toEqual([HARD]);
      expect(pubReading({ edit: dive(BIO) })[0]!.severity).toBe("error");
      expect(lines(pubReading({ edit: compose(dive(MATH), renamed) }))).toEqual([HARD]);
      const gone = compose(dive(BIO), renamed, (w) => { finding(w, BIO).terms = []; });
      expect(lines(pubReading({ edit: gone }))).toEqual([HARD]);
    });

    it("reads the explainer of a finding with its terms as before, beside a deep dive on another", () => {
      const edit = compose(dive(MATH), renamed, setStoredParts(BIO, TERMY));
      expect(lines(pubReading({ edit }))).toEqual([HARD]);
    });

    it("grades a deep dive on a finding that the stored records do not hold with no terms, and does not fail to read it", () => {
      expect(lines(pubReading({ edit: compose(dive("bio-2020-0001"), renamed) }))).toEqual([HARD]);
    });
  });

  it("reads the Lead, the deep dive and the big picture of the brief being published, and no other brief", () => {
    const lead = (w: PubWorld): void => { briefOf(w).lead[0].text = lzp(repeated(HARD_S, 3)); };
    const deep = (w: PubWorld): void => { asSunday(w); briefOf(w).deep_dive.text = lzp(repeated(HARD_S, 3)); };
    const big = (w: PubWorld): void => { asMonday(w); briefOf(w).review.big_picture = lzp(repeated(HARD_S, 3)); };
    const cases: [string, (w: PubWorld) => void, string, string][] = [
      ["lead", lead, `${BRIEF_FILE}: lead`, "The Lead"], ["deep dive", deep, `${BRIEF_FILE}: deep_dive.text.en`, "The deep dive"],
      ["big picture", big, `${BRIEF_FILE}: review.big_picture.en`, "The big picture"],
    ];
    for (const [label, edit, path, what] of cases) {
      expect(lines(pubReading({ edit })), label).toEqual([`${path} | ${hardMessage(what, readingGrade(repeated(HARD_S, 3)))}`]);
      expect(pubReading({ publishing: null, edit }), `${label}, nothing published`).toEqual([]);
      expect(pubReading({ publishing: EARLIER, edit }), `${label}, published earlier`).toEqual([]);
    }
    const soft = pubReading({ edit: (w) => { briefOf(w).lead[0].text = lzp(repeated(SOFT_S, 3)); } });
    expect(soft[0]).toMatchObject({ severity: "warning", path: `${BRIEF_FILE}: lead` });
  });

  it("reads the Lead as one text: the lines of a stored brief are joined", () => {
    const edit = (w: PubWorld): void => { briefOf(w).lead = [HARD_S, EASY_S, EASY_S].map((text) => ({ text: lzp(text), finding_ids: [BIO] })); };
    expect(pubReading({ edit })).toEqual([]);
    const soft = (w: PubWorld): void => { briefOf(w).lead = [SOFT_S, SOFT_S].map((text) => ({ text: lzp(text), finding_ids: [BIO] })); };
    expect(lines(pubReading({ edit: soft }))).toEqual([`${BRIEF_FILE}: lead | ${softMessage("The Lead", readingGrade([SOFT_S, SOFT_S].join(" ")))}`]);
  });

  it("does not read the Chinese side, a title, a note, an update, an idea or a definition", () => {
    const hard = repeated(HARD_S, 3);
    const edit = (w: PubWorld): void => {
      finding(w, BIO).explainer.found = { en: EASY_S, zh: hard };
      finding(w, BIO).title = lzp(hard);
      finding(w, BIO).rung_history[1].note = lzp(hard);
      finding(w, BIO).since_then[0].text = lzp(hard);
      briefOf(w).lead[0].text = { en: EASY_S, zh: hard };
      briefOf(w).items[1].update = lzp(hard);
      briefOf(w).ideas[0].text = lzp(hard);
      briefOf(w).also[0].title = lzp(hard);
      w.terms[0]!.en.definition = hard;
      w.corrections[1]!.reason = lzp(hard);
    };
    expect(pubReading({ edit })).toEqual([]);
  });

  it("reads the text without a string that a stored correction removed, whatever the string holds", () => {
    const edit = (stored: boolean) => (w: PubWorld): void => {
      setStoredParts(BIO, EASY_S)(w);
      finding(w, BIO).explainer.how_sure = lzp(VERY_HARD);
      if (stored) { w.corrections.push(removal("C-0003", { finding: BIO }, "explainer.how_sure")); holdRemoved(w as never); }
    };
    expect(pubReading({ edit: edit(true) })).toEqual([]);
    expect(pubReading({ edit: edit(false) }).map((i) => i.severity)).toEqual(["error"]);
    const deep = (stored: boolean) => (w: PubWorld): void => {
      asSunday(w);
      briefOf(w).deep_dive.text = lzp(repeated(HARD_S, 3));
      if (stored) { w.corrections.push(removal("C-0003", { edition: D }, "deep_dive.text")); holdRemoved(w as never); }
    };
    expect(pubReading({ edit: deep(true) })).toEqual([]);
    expect(pubReading({ edit: deep(false) })).toHaveLength(1);
  });
});

// ── The sample drafts and the soft fixtures ──────────────────────────────────────────────────────

describe("the words rules over the sample", () => {
  it.each(EDITION_NAMES.map((name) => [name] as const))("pass the valid %s draft with no error and no warning", (name) => {
    const input = buildDraftInput(editionDraft(name), sampleInputs(name));
    expect(runRules(input, wordsRules)).toEqual([]);
    expect(sumPage(input)).toBeLessThanOrEqual(1000);
  });
});

/** The words of the page total of a draft input: the model prose the page shows. */
const sumPage = (input: ReturnType<typeof buildDraftInput>): number => pageProseOf(input).reduce((n, e) => n + countWords(e.text), 0);

describe("the soft fixtures: a mutation of the sample that passes with exactly one warning of the group", () => {
  /** The draft input of a sample edition with `edit` applied to its JSON. */
  const mutated = (name: (typeof EDITION_NAMES)[number], edit: Edit) => {
    const json = clone(editionDraft(name)) as unknown as Json;
    edit(json);
    return buildDraftInput(DraftBrief.parse(json), sampleInputs(name));
  };
  const SENTENCE_23 = "The team measured how the material changed under heat and found that its structure stayed stable through several repeated experiments with different samples.";
  const SENTENCE_5 = "Independent laboratories reproduced the measurements.";
  const STORY_PARTS = [[SENTENCE_23, SENTENCE_23], [SENTENCE_23, SENTENCE_23], [SENTENCE_23, SENTENCE_23, SENTENCE_5], [SENTENCE_23, SENTENCE_23, SENTENCE_5], [SENTENCE_23, SENTENCE_5], [SENTENCE_23, SENTENCE_5]];

  it("READING_LEVEL above 12 and at most 14: the weekday's story, in sentences of up to 23 words, warns once and breaks no other rule of the group", () => {
    const input = mutated("weekday", (d) => {
      d.new_findings[0].terms = [];
      ALL_PARTS.forEach((part, i) => { d.new_findings[0].explainer[part] = STORY_PARTS[i]!.join(" "); });
    });
    const grade = readingGrade(STORY_PARTS.flat().join(" "));
    expect(grade).toBeGreaterThan(12);
    expect(grade).toBeLessThanOrEqual(14);
    expect(runRules(input, wordsRules).map((i) => `${i.severity} ${i.code} ${i.path}`)).toEqual(["warning READING_LEVEL new_findings[0].explainer"]);
  });

  /** Sizes of the strings of the largest page a weekday can have, by the caps of the budgets and of COUNTS. */
  const fullWeekday: Edit = (d) => {
    const wordsOf = (n: number): string => plain(n, 10);
    const newOnes = d.new_findings;
    while (newOnes.length < 5) newOnes.push({ ...clone(newOnes[newOnes.length - 1]), ref: `new-${newOnes.length + 1}` });
    d.story = "new-1";
    d.items = ["new-2", "new-3", "new-4", "new-5"];
    d.returning = [];
    d.lead = [20, 20, 20].map((n, i) => ({ text: plain(n, n), refs: [`new-${i + 1}`] }));
    newOnes.forEach((f: Json) => { f.terms = []; f.title = wordsOf(12); });
    Object.assign(newOnes[0].explainer, { found: wordsOf(55), matters: wordsOf(50), ai_helped: wordsOf(60), how_sure: wordsOf(60), background: wordsOf(30), could_lead: wordsOf(25) });
    for (const f of newOnes.slice(1)) Object.assign(f.explainer, { found: wordsOf(25), matters: wordsOf(25), ai_helped: wordsOf(25), how_sure: wordsOf(25) });
    d.ideas = [0, 1].map(() => ({ text: wordsOf(40), who: "A. Example", source_id: "b1" }));
    d.also = [0, 1, 2, 3, 4].map(() => ({ title: wordsOf(20), field: "earth", source_id: "b1" }));
  };

  it("WORDS over the 1,000 target: no weekday page can warn, the largest the caps allow has 980 words (the Lead 60, a story 292, four items 4 x 112, two ideas 80, five Also noted 100)", () => {
    const input = mutated("weekday", fullWeekday);
    expect(sumPage(input)).toBe(60 + 292 + 4 * 112 + 2 * 40 + 5 * 20);
    expect(sumPage(input)).toBe(980);
    expect(runRules(input, [rule("WORDS")])).toEqual([]);
  });

  it("WORDS over the 1,000 target: a Sunday page does warn, once, with the Lead, the story, the deep dive, the ideas and the Also noted lines at their caps", () => {
    const input = mutated("sunday", (d) => {
      fullWeekday(d);
      d.date = editionDraft("sunday").date;
      d.new_findings = [d.new_findings[0], d.new_findings[1]];
      d.items = ["new-2"];
      d.deep_dive = { ...clone(editionDraft("sunday").deep_dive), text: plain(550, 10) };
    });
    expect(sumPage(input)).toBe(60 + 292 + 112 + 550 + 2 * 40 + 5 * 20);
    expect(runRules(input, wordsRules).map((i) => `${i.severity} ${i.code} ${i.path} ${i.message}`)).toEqual([
      "warning WORDS (root) The page has 1194 words; the target is 1000. Cut 194 to reach it.",
    ]);
  });
});
