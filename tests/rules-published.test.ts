// The three published-mode rules that read stored records against each other (SPEC §4.12 XREF, LANG_PARITY and FILE_LAYOUT, and "Stored
// records" and "Removed text" where they say what those rules check) and the helpers beside them in lib/rules/published.ts: the paths of
// SPEC §3 (`classifyPath()`), the findings a brief names and shows, the terms hidden for their own name. Each rule is run through the
// engine's `runRules()` on an input that `buildPublishedInput()` builds from the hand-built world of tests/helpers/stored-world.ts: once
// the way `validatePublished()` runs it (one brief, no folder) and once the way `validateAll()` runs its run over every record (no
// brief, and the folder's own facts), so each case says which run it is. Every sentence of the three rows has a case that fails if the
// rule is wrong.
//
// New for this project; Cyber's tests/validate-engine.test.ts at the fork commit 3ced1fb checked its cross-file codes the same way,
// on small hand-built folders.

import { describe, expect, it, vi } from "vitest";
import { RULES, RULE_GROUPS } from "@/lib/rules";
import {
  ARCHIVE_FILE, classifyPath, findingRefs, hiddenTermIds, isL10nShape, namedFindingIds, publishedRules, shownFindingParts,
} from "@/lib/rules/published";
import { buildPublishedInput, comparePaths, runRules } from "@/lib/rules/run";
import { error, type PublishedFolder, type PublishedInput, type Rule, type RuleInput, type StoredFile, type ValidationIssue } from "@/lib/rules/types";
import type { Brief } from "@/lib/schema/brief";
import { Correction } from "@/lib/schema/misc";
import { REMOVED_TEXT } from "@/lib/vocab";
import {
  ASSISTANT, BILINGUAL, DATA_ONLY, EN_ONLY, FOLDING, LATTICE, LIGHT, MONDAY, PROOF, PROTEIN, SUNDAY, addBrief, addMonday, addRemoval, addSunday,
  briefOf, briefOn, clone, config, contentOf, deepFreeze, findingOf, l, lz, removedHowSure, storedWorld, termOf, worldFiles,
  type Json, type StoredWorld,
} from "./helpers/stored-world";

// A busy machine must not turn a case red on vitest's 5 s default (a few cases build a whole world and judge every brief of it).
vi.setConfig({ testTimeout: 30_000 });

// ── Running a rule ───────────────────────────────────────────────────────────────────────────────

const ruleOf = (code: string): Rule => {
  const found = publishedRules.find((r) => r.codes[0] === code);
  if (found === undefined) throw new Error(`no rule ${code}`);
  return found;
};

const fileEntry = (path: string, over: Partial<StoredFile> = {}): StoredFile => ({
  path, regular: true, parsed: true, id: path.startsWith("findings/") ? path.slice("findings/".length, -".json".length) : null, ...over,
});

/** The folder `validateAll()` reads from a world on disk: every file of the world, regular and parsed, and the world's briefs and archive. */
function folderOf(world: StoredWorld, over: Partial<PublishedFolder> = {}): PublishedFolder {
  return {
    files: worldFiles(world).map(([path]) => fileEntry(path)), briefs: world.briefs, archive: world.archive, hiddenTerms: new Set(), ...over,
  };
}

/** The input of `validateAll()`'s run over every record: no brief, the world's records, and the folder. */
function folderInput(world: StoredWorld, over: Partial<PublishedFolder> = {}): PublishedInput {
  const input = buildPublishedInput(null, contentOf(world), { config: config(), date: DATA_ONLY });
  return { ...input, published: { ...input.published, folder: folderOf(world, over) } };
}

/** The input of `validatePublished()`: one brief and the records given, and no folder. */
const briefInput = (world: StoredWorld, brief: Brief): PublishedInput => buildPublishedInput(brief, contentOf(world), { config: config() });

const run = (code: string, input: PublishedInput): ValidationIssue[] => runRules(input, [ruleOf(code)]);
const pathsOf = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => i.path);
const triples = (issues: readonly ValidationIssue[]): string[][] => issues.map((i) => [i.code, i.path, i.message]);

/** The issues of a run that point into one file. */
const inFile = (issues: readonly ValidationIssue[], file: string): ValidationIssue[] => issues.filter((i) => i.path.startsWith(`${file}: `));

const MISSING = "bio-2026-0099";

/** A brief that holds every kind of finding id and every L10n: a Monday review with a story, items, a rung change and a deep dive too. */
function fullBrief(over: Json = {}): Brief {
  const fieldCounts = ["mathematics", "physics", "chemistry", "biology", "earth", "social", "humanities"].map((field) => ({ field, reported: 1, counted: 1 }));
  return briefOf(MONDAY, {
    lead: [
      { text: lz("Lead one.", "引言一。"), finding_ids: [PROTEIN, PROOF] },
      { text: lz("Lead two.", "引言二。"), finding_ids: [LIGHT] },
    ],
    story: { finding_id: PROTEIN, new: false, update: lz("Update.", "更新。") },
    items: [{ finding_id: PROOF, new: true, update: null }, { finding_id: LIGHT, new: false, update: lz("Update two.", "更新二。") }],
    rung_changes: [{ finding_id: LIGHT, from: "preprint", to: "checked", date: "2026-11-22", by: "script" }],
    ideas: [{ text: lz("An idea.", "一個想法。"), who: "A. Example", source_id: "b1" }],
    also: [{ title: lz("An also line.", "一則補充。"), field: "earth", source_id: "b1" }],
    deep_dive: { finding_id: PROTEIN, text: lz("A deep dive.", "深度報導。"), source_ids: ["b1"], why_today: "news" },
    review: {
      big_picture: lz("A big picture.", "全局。"),
      remarkable: { finding_id: LIGHT, note: lz("Remarkable.", "值得注意。") },
      strongest_against: { text: lz("Against.", "反面。"), finding_ids: [PROOF], source_ids: ["b1"] },
      field_counts: fieldCounts,
      fell: [PROOF],
      setbacks: [PROTEIN],
    },
    corrections: [{ id: "C-0001", finding_id: PROTEIN, edition_date: null, term_id: null, type: "correction", reason: lz("Why.", "原因。") }],
    reports: [{ id: "R-0001", finding_id: PROTEIN, status: "upheld" }],
    sources: [{
      id: "b1", kind: "statement", title: "A made-up statement", publisher: "Example Institute", url: "https://example.org/statement/1", doi: null,
      published_at: "2026-11-22", seen_as: "pack", added: MONDAY,
    }],
    status_note: lz("A note.", "一則說明。"),
    ...over,
  });
}

/** The base world with `fullBrief()` added and each finding it shows listing its date, so the pair is clean. */
function fullWorld(): { world: StoredWorld; brief: Brief } {
  const world = storedWorld();
  const brief = fullBrief();
  for (const id of shownFindingParts(brief).keys()) findingOf(world, id).briefs.push(MONDAY);
  // The English-only edition first published PROOF with no Chinese title; a bilingual edition that names it needs one (LANG_PARITY).
  findingOf(world, PROOF).title.zh = "範例證明的標題";
  addBrief(world, brief);
  return { world, brief };
}

// ── The group ────────────────────────────────────────────────────────────────────────────────────

describe("the published group", () => {
  it("is XREF, LANG_PARITY and FILE_LAYOUT, each an error rule of published mode that needs no run input", () => {
    expect(publishedRules.map((r) => r.codes)).toEqual([["XREF"], ["LANG_PARITY"], ["FILE_LAYOUT"]]);
    for (const rule of publishedRules) {
      expect(rule.scope).toEqual(["published"]);
      expect(rule.severity).toBe("error");
      expect(rule.needs).toEqual([]);
      expect(rule.uses).toEqual([]);
    }
  });

  it("is the group the registry holds, in the registry's rules", () => {
    expect(RULE_GROUPS.find((g) => g.group === "published")!.rules).toBe(publishedRules);
    for (const rule of publishedRules) expect(RULES).toContain(rule);
  });

  it("judges nothing outside published mode", () => {
    for (const rule of publishedRules) {
      expect(rule.check({ mode: "draft" } as unknown as RuleInput)).toEqual([]);
      expect(rule.check({ mode: "zh" } as unknown as RuleInput)).toEqual([]);
    }
  });

  it("finds nothing in the base world: each brief on its own, and the whole folder", () => {
    const world = storedWorld();
    for (const brief of world.briefs) {
      for (const rule of publishedRules) expect(runRules(briefInput(world, brief), [rule]), `${brief.date} ${rule.codes[0]}`).toEqual([]);
    }
    expect(runRules(folderInput(world), publishedRules)).toEqual([]);
    const full = fullWorld();
    expect(runRules(briefInput(full.world, full.brief), publishedRules)).toEqual([]);
    expect(runRules(folderInput(full.world), publishedRules)).toEqual([]);
    const extra = addMonday(addSunday(storedWorld()));
    expect(runRules(folderInput(extra), publishedRules)).toEqual([]);
  });

  it("is a pure function of its input: the same issues twice, and a frozen input is not changed", () => {
    const { world, brief } = fullWorld();
    world.findings[0]!.related = [MISSING];
    const input = deepFreeze(folderInput(world));
    expect(runRules(input, publishedRules)).toEqual(runRules(input, publishedRules));
    const single = deepFreeze(briefInput(world, brief));
    expect(runRules(single, publishedRules)).toEqual(runRules(single, publishedRules));
  });
});

// ── The paths of SPEC §3 ─────────────────────────────────────────────────────────────────────────

describe("classifyPath()", () => {
  it("knows each file of SPEC §3 by kind, and the date or the id in its name", () => {
    const known: [string, string, string | null][] = [
      ["glossary.json", "glossary", null],
      ["corrections.json", "corrections", null],
      ["reports.json", "reports", null],
      ["archive-index.json", "archive", null],
      ["state/pace-weekly.json", "pace", null],
      ["briefs/2026-11-24.json", "brief", "2026-11-24"],
      ["metrics/2026-11-24.json", "metrics", "2026-11-24"],
      ["metrics/inputs/2026-11-24.json", "inputs", "2026-11-24"],
      ["status/2026-11-24.json", "status", "2026-11-24"],
      ["findings/math-2026-0142.json", "finding", "math-2026-0142"],
      ["findings/phys-2026-0003.json", "finding", "phys-2026-0003"],
      ["findings/hum-2025-0001.json", "finding", "hum-2025-0001"],
    ];
    for (const [rel, kind, key] of known) expect(classifyPath(rel), rel).toEqual({ kind, key });
    expect(ARCHIVE_FILE).toBe("archive-index.json");
  });

  it("refuses every other path", () => {
    const stray = [
      "README.md", "notes.txt", "briefs", "briefs/", "briefs/latest.json", "briefs/2026-13-45.json", "briefs/2026-02-30.json",
      "briefs/2026-11-24.JSON", "briefs/2026-11-24.json.bak", "briefs/2026-11-24", "briefs/x/2026-11-24.json", "briefs/2026-11-24.json/x",
      "metrics/inputs/draft.json", "metrics/inputs/2026-11-24.json/x", "metrics/inputs/x/2026-11-24.json", "metrics/2026-11-24.txt",
      "metrics/inputs", "status/2026-11-24.json.tmp", "status/latest.json", "state/other.json", "state/pace-weekly.json.bak",
      "findings/not-an-id.json", "findings/MATH-2026-0142.json", "findings/xyz-2026-0001.json", "findings/math-2026-142.json",
      "findings/math-2026-0142.json.bak", "findings/sub/math-2026-0142.json", "findings/math-2026-0142/x.json", "findings/.json",
      "Glossary.json", "glossary.json.bak", "content/glossary.json", "/glossary.json", "./glossary.json", "reports.json/x",
      "archive-index.json/x", "corrections", "", "constructor", "__proto__", "toString", "hasOwnProperty", "state/constructor",
      // The finding folder is `findings/` and nothing else: a name of another folder is no finding's, even where nine characters
      // in it reads as a finding's file name.
      "somedir_/math-2026-0142.json", "finding/math-2026-0142.json", "findings-/math-2026-0142.json", "xfindings/math-2026-0142.json",
    ];
    for (const rel of stray) expect(classifyPath(rel), JSON.stringify(rel)).toBeNull();
  });

  it("reads a dated name only when its date is a real calendar date", () => {
    expect(classifyPath("briefs/2024-02-29.json")).toEqual({ kind: "brief", key: "2024-02-29" });
    expect(classifyPath("briefs/2026-02-29.json")).toBeNull();
    expect(classifyPath("metrics/2026-04-31.json")).toBeNull();
    expect(classifyPath("status/2026-00-10.json")).toBeNull();
  });

  it("tells metrics/inputs/ from metrics/", () => {
    expect(classifyPath("metrics/inputs/2026-11-24.json")!.kind).toBe("inputs");
    expect(classifyPath("metrics/2026-11-24.json")!.kind).toBe("metrics");
  });
});

// ── What an L10n is ──────────────────────────────────────────────────────────────────────────────

describe("isL10nShape()", () => {
  it("is true for an object with exactly the keys en (text) and zh (text or null), in either order", () => {
    expect(isL10nShape({ en: "Hello.", zh: "你好。" })).toBe(true);
    expect(isL10nShape({ en: "Hello.", zh: null })).toBe(true);
    expect(isL10nShape({ zh: "你好。", en: "Hello." })).toBe(true);
    expect(isL10nShape({ en: "", zh: "" })).toBe(true);
  });

  it("is false for every other object: a key more or fewer, another key, an en or zh that is not text", () => {
    const other: unknown[] = [
      {}, { en: "x" }, { zh: "x" }, { en: "x", zh: "y", extra: 1 }, { en: "x", zh: undefined }, { en: null, zh: "x" }, { en: 1, zh: "x" },
      { en: "x", zh: 1 }, { en: "x", zh: {} }, { en: "x", zh: ["y"] }, { en: ["x"], zh: null }, { en: "x", zh_tw: "y" }, { EN: "x", ZH: "y" },
      { en: { en: "x", zh: null }, zh: null }, Object.assign(Object.create({ zh: "z" }), { en: "x", extra: 1 }),
    ];
    for (const value of other) expect(isL10nShape(value), JSON.stringify(value)).toBe(false);
  });

  it("is false, and never throws, for a value that is no object: null, undefined, text, a number, a flag, a list", () => {
    // A list that carries the two keys is a list, not an L10n.
    const listWithKeys = Object.assign([], { en: "x", zh: null });
    for (const value of [null, undefined, "en", "", 0, 1, true, false, [], ["en", "zh"], [{ en: "x", zh: null }], listWithKeys, () => ({ en: "x", zh: null })]) {
      expect(isL10nShape(value), String(value)).toBe(false);
    }
  });
});

// ── What a brief names and shows ─────────────────────────────────────────────────────────────────

describe("findingRefs(), namedFindingIds() and shownFindingParts()", () => {
  it("lists every finding id of a brief with its path, in the order of SPEC §4.6's list", () => {
    const brief = fullBrief({
      lead: [{ text: lz("a", "甲"), finding_ids: ["bio-2026-0101", "bio-2026-0102"] }, { text: lz("b", "乙"), finding_ids: ["bio-2026-0103"] }],
      story: { finding_id: "bio-2026-0104", new: true, update: null },
      items: [{ finding_id: "bio-2026-0105", new: true, update: null }],
      rung_changes: [{ finding_id: "bio-2026-0106", from: "preprint", to: "checked", date: "2026-11-22", by: "script" }],
      deep_dive: { finding_id: "bio-2026-0107", text: lz("t", "丁"), source_ids: [], why_today: "news" },
      review: {
        big_picture: lz("a", "甲"), remarkable: { finding_id: "bio-2026-0108", note: lz("n", "註") },
        strongest_against: { text: lz("a", "甲"), finding_ids: ["bio-2026-0109", "bio-2026-0110"], source_ids: [] },
        field_counts: fullBrief().review!.field_counts, fell: ["bio-2026-0111"], setbacks: ["bio-2026-0112"],
      },
      corrections: [
        { id: "C-0001", finding_id: "bio-2026-0113", edition_date: null, term_id: null, type: "correction", reason: lz("r", "因") },
        { id: "C-0002", finding_id: null, edition_date: "2026-11-18", term_id: null, type: "update", reason: lz("r", "因") },
        { id: "C-0003", finding_id: null, edition_date: null, term_id: "term", type: "update", reason: lz("r", "因") },
      ],
      reports: [{ id: "R-0001", finding_id: "bio-2026-0114", status: "rejected" }],
    });
    expect(findingRefs(brief).map((r) => [r.id, r.path])).toEqual([
      ["bio-2026-0101", "lead[0].finding_ids[0]"], ["bio-2026-0102", "lead[0].finding_ids[1]"], ["bio-2026-0103", "lead[1].finding_ids[0]"],
      ["bio-2026-0104", "story.finding_id"], ["bio-2026-0105", "items[0].finding_id"], ["bio-2026-0106", "rung_changes[0].finding_id"],
      ["bio-2026-0107", "deep_dive.finding_id"], ["bio-2026-0108", "review.remarkable.finding_id"],
      ["bio-2026-0109", "review.strongest_against.finding_ids[0]"], ["bio-2026-0110", "review.strongest_against.finding_ids[1]"],
      ["bio-2026-0111", "review.fell[0]"], ["bio-2026-0112", "review.setbacks[0]"], ["bio-2026-0113", "corrections[0].finding_id"],
      ["bio-2026-0114", "reports[0].finding_id"],
    ]);
  });

  it("skips the parts a brief leaves empty", () => {
    const empty = briefOf(MONDAY);
    expect(findingRefs(empty)).toEqual([]);
    expect(namedFindingIds(empty)).toEqual([]);
    expect(shownFindingParts(empty).size).toBe(0);
    const onlyStory = briefOf(BILINGUAL, { story: { finding_id: LIGHT, new: true, update: null } });
    expect(findingRefs(onlyStory).map((r) => r.path)).toEqual(["story.finding_id"]);
    const noRemarkable = fullBrief({ review: { ...fullBrief().review!, remarkable: null } });
    expect(findingRefs(noRemarkable).some((r) => r.path.startsWith("review.remarkable"))).toBe(false);
  });

  it("names each finding once, in the order its first mention comes", () => {
    const brief = fullBrief();
    expect(namedFindingIds(brief)).toEqual([PROTEIN, PROOF, LIGHT]);
    expect(findingRefs(brief).length).toBeGreaterThan(namedFindingIds(brief).length);
  });

  it("shows a finding by its story, its items or its deep dive, each finding once with the first part that shows it", () => {
    expect([...shownFindingParts(fullBrief())]).toEqual([[PROTEIN, "its story"], [PROOF, "its items"], [LIGHT, "its items"]]);
    const deep = briefOf(SUNDAY, { deep_dive: { finding_id: PROTEIN, text: lz("t", "丁"), source_ids: [], why_today: "news" } });
    expect([...shownFindingParts(deep)]).toEqual([[PROTEIN, "its deep dive"]]);
    const both = briefOf(BILINGUAL, {
      story: { finding_id: LIGHT, new: true, update: null },
      items: [{ finding_id: LIGHT, new: false, update: l("again") }, { finding_id: PROTEIN, new: true, update: null }],
      deep_dive: { finding_id: PROTEIN, text: l("t"), source_ids: [], why_today: "news" },
    });
    expect([...shownFindingParts(both)]).toEqual([[LIGHT, "its story"], [PROTEIN, "its items"]]);
  });

  it("does not count a lead line, a rung change, the review, a correction line or a report line as showing a finding", () => {
    const brief = briefOf(MONDAY, {
      lead: [{ text: l("x"), finding_ids: [PROTEIN] }],
      rung_changes: [{ finding_id: PROOF, from: "preprint", to: "checked", date: "2026-11-22", by: "script" }],
      review: { ...fullBrief().review!, remarkable: { finding_id: LIGHT, note: l("n") }, fell: [PROTEIN], setbacks: [PROOF] },
      corrections: [{ id: "C-0001", finding_id: PROTEIN, edition_date: null, term_id: null, type: "correction", reason: l("r") }],
      reports: [{ id: "R-0001", finding_id: LIGHT, status: "upheld" }],
    });
    expect(shownFindingParts(brief).size).toBe(0);
    expect(namedFindingIds(brief)).toEqual([PROTEIN, PROOF, LIGHT]);
  });
});

// ── Terms hidden for their own name ──────────────────────────────────────────────────────────────

describe("hiddenTermIds()", () => {
  const terms = [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }];
  const issue = (code: string, path: string, severity: "error" | "warning" = "error"): ValidationIssue => ({ code, severity, path, message: "m", hint: null });

  it("maps a DUAL_USE or BLOCKED_HOST issue at a term's name to the term, whatever the severity", () => {
    const issues = [
      issue("DUAL_USE", "glossary.json: terms[0].id"),
      issue("BLOCKED_HOST", "glossary.json: terms[1].zh.official_url", "warning"),
      issue("DUAL_USE", "glossary.json: terms[2].en.term", "warning"),
    ];
    expect([...hiddenTermIds(issues, terms)].sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("reads each of the five name paths: the id, the term in either language, the official form and its URL", () => {
    for (const rest of ["id", "en.term", "zh.term", "zh.official", "zh.official_url"]) {
      expect([...hiddenTermIds([issue("DUAL_USE", `glossary.json: terms[1].${rest}`)], terms)], rest).toEqual(["beta"]);
    }
  });

  it("does not hide a term for its definition or any other path, or for any other code", () => {
    const issues = [
      issue("DUAL_USE", "glossary.json: terms[0].en.definition"),
      issue("DUAL_USE", "glossary.json: terms[0].zh.definition"),
      issue("DUAL_USE", "glossary.json: terms[0].first_finding"),
      issue("DUAL_USE", "glossary.json: terms[0]"),
      issue("DUAL_USE", "glossary.json: terms[0].en.terms"),
      issue("DUAL_USE", "glossary.json: terms[0].id.x"),
      issue("SECRET_LIKE", "glossary.json: terms[0].id"),
      issue("SOURCE_URL", "glossary.json: terms[0].id"),
      issue("XREF", "glossary.json: terms[0].en.term"),
    ];
    expect(hiddenTermIds(issues, terms).size).toBe(0);
  });

  it("ignores a path in another file, a path with no index, a malformed index and an index past the end of the terms", () => {
    const issues = [
      issue("DUAL_USE", "findings/bio-2026-0001.json: terms[0].id"),
      issue("DUAL_USE", "corrections.json: terms[0].id"),
      issue("DUAL_USE", "terms[0].id"),
      issue("DUAL_USE", "glossary.json: terms[01].id"),
      issue("DUAL_USE", "glossary.json: terms[-1].id"),
      issue("DUAL_USE", "glossary.json: terms[x].id"),
      issue("DUAL_USE", "glossary.json: terms[3].id"),
      issue("DUAL_USE", "glossary.json: terms[99].id"),
      issue("DUAL_USE", "x glossary.json: terms[0].id"),
    ];
    expect(hiddenTermIds(issues, terms).size).toBe(0);
  });

  it("names a term once however many issues point at it, and finds the term by the index into the terms given", () => {
    const issues = [issue("DUAL_USE", "glossary.json: terms[2].id"), issue("BLOCKED_HOST", "glossary.json: terms[2].en.term"), issue("DUAL_USE", "glossary.json: terms[10].id")];
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}` }));
    expect([...hiddenTermIds(issues, many)].sort()).toEqual(["t10", "t2"]);
    expect(hiddenTermIds([], terms).size).toBe(0);
    expect(hiddenTermIds(issues, []).size).toBe(0);
  });
});

// ── XREF ─────────────────────────────────────────────────────────────────────────────────────────

/** The places a finding id stands in a brief, and how to set each. */
const POSITIONS: [string, (b: Brief, id: string) => void][] = [
  ["lead[0].finding_ids[0]", (b, id) => { b.lead[0]!.finding_ids[0] = id; }],
  ["lead[0].finding_ids[1]", (b, id) => { b.lead[0]!.finding_ids[1] = id; }],
  ["lead[1].finding_ids[0]", (b, id) => { b.lead[1]!.finding_ids[0] = id; }],
  ["story.finding_id", (b, id) => { b.story!.finding_id = id; }],
  ["items[0].finding_id", (b, id) => { b.items[0]!.finding_id = id; }],
  ["items[1].finding_id", (b, id) => { b.items[1]!.finding_id = id; }],
  ["rung_changes[0].finding_id", (b, id) => { b.rung_changes[0]!.finding_id = id; }],
  ["deep_dive.finding_id", (b, id) => { b.deep_dive!.finding_id = id; }],
  ["review.remarkable.finding_id", (b, id) => { b.review!.remarkable!.finding_id = id; }],
  ["review.strongest_against.finding_ids[0]", (b, id) => { b.review!.strongest_against.finding_ids[0] = id; }],
  ["review.fell[0]", (b, id) => { b.review!.fell[0] = id; }],
  ["review.setbacks[0]", (b, id) => { b.review!.setbacks[0] = id; }],
  ["reports[0].finding_id", (b, id) => { b.reports[0]!.finding_id = id; }],
];

describe("XREF: the findings a brief names (validatePublished's run: one brief, no folder)", () => {
  it.each(POSITIONS)("a finding id at %s that no finding has is one issue at that place", (place, set) => {
    const { world, brief } = fullWorld();
    set(brief, MISSING);
    const issues = inFile(run("XREF", briefInput(world, brief)), `briefs/${MONDAY}.json`).filter((i) => i.path.endsWith(place));
    expect(triples(issues)).toEqual([[
      "XREF", `briefs/${MONDAY}.json: ${place}`, `${MISSING} is named here, but findings/${MISSING}.json does not exist.`,
    ]]);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.hint).toContain("same commit");
  });

  it("reports the id of a correction line's finding at that line", () => {
    const { world, brief } = fullWorld();
    brief.corrections[0]!.finding_id = MISSING;
    const issues = run("XREF", briefInput(world, brief));
    expect(triples(inFile(issues, `briefs/${MONDAY}.json`).filter((i) => i.path.includes("finding_id")))).toEqual([
      ["XREF", `briefs/${MONDAY}.json: corrections[0].finding_id`, `${MISSING} is named here, but findings/${MISSING}.json does not exist.`],
    ]);
  });

  it("passes a brief whose every id names a finding that is given", () => {
    const { world, brief } = fullWorld();
    expect(run("XREF", briefInput(world, brief))).toEqual([]);
  });

  it("reports an id at each place it stands, each in its own issue, in the engine's order", () => {
    const { world, brief } = fullWorld();
    brief.lead[0]!.finding_ids = [MISSING, MISSING];
    brief.story!.finding_id = MISSING;
    const issues = inFile(run("XREF", briefInput(world, brief)), `briefs/${MONDAY}.json`).filter((i) => i.message.startsWith(MISSING));
    expect(pathsOf(issues)).toEqual([
      `briefs/${MONDAY}.json: lead[0].finding_ids[0]`, `briefs/${MONDAY}.json: lead[0].finding_ids[1]`, `briefs/${MONDAY}.json: story.finding_id`,
    ]);
  });

  it("finds a finding in the run by its id alone: a record the run was not given is missing, one it was given is not", () => {
    const world = storedWorld();
    const brief = briefOn(world, BILINGUAL);
    const without = { ...contentOf(world), findings: world.findings.filter((f) => f.id !== LIGHT) };
    const issues = runRules(buildPublishedInput(brief, without, { config: config() }), [ruleOf("XREF")]);
    expect(pathsOf(issues.filter((i) => i.message.includes(`${LIGHT} is named here`)))).toEqual([
      `briefs/${BILINGUAL}.json: lead[0].finding_ids[0]`, `briefs/${BILINGUAL}.json: story.finding_id`,
    ]);
  });
});

describe("XREF: what a brief lists of corrections and reports", () => {
  const correctionLine = (over: Json = {}): Json => ({
    id: "C-0001", finding_id: PROTEIN, edition_date: null, term_id: null, type: "correction", reason: lz("Why.", "原因。"), ...over,
  });

  it("reports a correction line that corrections.json does not hold, at the line's id", () => {
    const world = storedWorld();
    const brief = briefOn(world, BILINGUAL);
    brief.corrections[0]!.id = "C-0007";
    expect(triples(run("XREF", briefInput(world, brief)))).toEqual([[
      "XREF", `briefs/${BILINGUAL}.json: corrections[0].id`, "C-0007 is listed here, but corrections.json has no such correction.",
    ]]);
  });

  it("reports a correction line that names another record than the stored correction, for each pair of target kinds", () => {
    const world = storedWorld();
    // The stored correction C-0001 is on a finding; the brief's line names an edition, a term, or another finding.
    const cases: [Json, string][] = [
      [{ finding_id: null, edition_date: EN_ONLY }, `C-0001 is listed here for the edition ${EN_ONLY}, but corrections.json files it on the finding ${PROTEIN}.`],
      [{ finding_id: null, term_id: FOLDING }, `C-0001 is listed here for the term ${FOLDING}, but corrections.json files it on the finding ${PROTEIN}.`],
      [{ finding_id: PROOF }, `C-0001 is listed here for the finding ${PROOF}, but corrections.json files it on the finding ${PROTEIN}.`],
    ];
    for (const [over, message] of cases) {
      const brief = briefOn(world, BILINGUAL);
      brief.corrections = [correctionLine(over) as Brief["corrections"][number]];
      expect(triples(run("XREF", briefInput(world, brief))), JSON.stringify(over)).toEqual([["XREF", `briefs/${BILINGUAL}.json: corrections[0].id`, message]]);
    }
    // And the stored one on an edition or a term, the line on a finding.
    const onEdition = storedWorld();
    onEdition.corrections[0] = Correction.parse({ ...onEdition.corrections[0]!, finding_id: null, edition_date: EN_ONLY });
    const line = briefOn(onEdition, BILINGUAL);
    expect(run("XREF", briefInput(onEdition, line)).map((i) => i.message)).toContain(
      `C-0001 is listed here for the finding ${PROTEIN}, but corrections.json files it on the edition ${EN_ONLY}.`,
    );
    const onTerm = storedWorld();
    onTerm.corrections[0] = Correction.parse({ ...onTerm.corrections[0]!, finding_id: null, term_id: FOLDING });
    expect(run("XREF", briefInput(onTerm, briefOn(onTerm, BILINGUAL))).map((i) => i.message)).toContain(
      `C-0001 is listed here for the finding ${PROTEIN}, but corrections.json files it on the term ${FOLDING}.`,
    );
  });

  it("reports a correction line that names another edition, or another term, than the stored correction of the same kind", () => {
    const twoEditions = storedWorld();
    twoEditions.corrections[0] = Correction.parse({ ...twoEditions.corrections[0]!, finding_id: null, edition_date: EN_ONLY });
    briefOn(twoEditions, BILINGUAL).corrections = [correctionLine({ finding_id: null, edition_date: DATA_ONLY }) as Brief["corrections"][number]];
    expect(triples(run("XREF", briefInput(twoEditions, briefOn(twoEditions, BILINGUAL))))).toEqual([[
      "XREF", `briefs/${BILINGUAL}.json: corrections[0].id`,
      `C-0001 is listed here for the edition ${DATA_ONLY}, but corrections.json files it on the edition ${EN_ONLY}.`,
    ]]);
    const twoTerms = storedWorld();
    twoTerms.corrections[0] = Correction.parse({ ...twoTerms.corrections[0]!, finding_id: null, term_id: FOLDING });
    briefOn(twoTerms, BILINGUAL).corrections = [correctionLine({ finding_id: null, term_id: LATTICE }) as Brief["corrections"][number]];
    expect(triples(run("XREF", briefInput(twoTerms, briefOn(twoTerms, BILINGUAL))))).toEqual([[
      "XREF", `briefs/${BILINGUAL}.json: corrections[0].id`,
      `C-0001 is listed here for the term ${LATTICE}, but corrections.json files it on the term ${FOLDING}.`,
    ]]);
  });

  it("passes a correction line that names the same record as the stored one, of each kind", () => {
    for (const target of [{ finding_id: PROTEIN }, { edition_date: EN_ONLY }, { term_id: FOLDING }]) {
      const world = storedWorld();
      world.corrections[0] = Correction.parse({ ...world.corrections[0]!, finding_id: null, edition_date: null, term_id: null, ...target });
      const brief = briefOn(world, BILINGUAL);
      brief.corrections = [correctionLine({ finding_id: null, ...target }) as Brief["corrections"][number]];
      expect(run("XREF", briefInput(world, brief)), JSON.stringify(target)).toEqual([]);
    }
  });

  it("reports the edition and the term a correction line names when they do not exist, and passes when they do", () => {
    const world = storedWorld();
    world.corrections[0] = Correction.parse({ ...world.corrections[0]!, finding_id: null, edition_date: "2026-11-30" });
    const brief = briefOn(world, BILINGUAL);
    brief.corrections = [correctionLine({ finding_id: null, edition_date: "2026-11-30" }) as Brief["corrections"][number]];
    // One brief alone cannot know the other editions, so only the folder's run reports a missing one (see the next test).
    expect(run("XREF", briefInput(world, brief)).filter((i) => i.path.includes("edition_date"))).toEqual([]);
    const termWorld = storedWorld();
    termWorld.corrections[0] = Correction.parse({ ...termWorld.corrections[0]!, finding_id: null, term_id: "no-such-term" });
    const termBrief = briefOn(termWorld, BILINGUAL);
    termBrief.corrections = [correctionLine({ finding_id: null, term_id: "no-such-term" }) as Brief["corrections"][number]];
    expect(triples(inFile(run("XREF", briefInput(termWorld, termBrief)), `briefs/${BILINGUAL}.json`))).toEqual([[
      "XREF", `briefs/${BILINGUAL}.json: corrections[0].term_id`, "C-0001 names the term no-such-term, but glossary.json has no such term.",
    ]]);
    const fine = storedWorld();
    fine.corrections[0] = Correction.parse({ ...fine.corrections[0]!, finding_id: null, term_id: FOLDING });
    const fineBrief = briefOn(fine, BILINGUAL);
    fineBrief.corrections = [correctionLine({ finding_id: null, term_id: FOLDING }) as Brief["corrections"][number]];
    expect(run("XREF", briefInput(fine, fineBrief))).toEqual([]);
  });

  it("reports the edition a correction line names when no brief of the folder holds it, at the line's edition_date (the folder's run), and passes one that exists", () => {
    const world = storedWorld();
    world.corrections[0] = Correction.parse({ ...world.corrections[0]!, finding_id: null, edition_date: "2026-11-30" });
    briefOn(world, BILINGUAL).corrections = [correctionLine({ finding_id: null, edition_date: "2026-11-30" }) as Brief["corrections"][number]];
    const own = run("XREF", folderInput(world)).filter((i) => i.path.startsWith(`briefs/${BILINGUAL}.json: `));
    expect(triples(own)).toEqual([[
      "XREF", `briefs/${BILINGUAL}.json: corrections[0].edition_date`, "C-0001 names the edition 2026-11-30, but briefs/2026-11-30.json does not exist.",
    ]]);
    const fine = storedWorld();
    fine.corrections[0] = Correction.parse({ ...fine.corrections[0]!, finding_id: null, edition_date: EN_ONLY });
    briefOn(fine, BILINGUAL).corrections = [correctionLine({ finding_id: null, edition_date: EN_ONLY }) as Brief["corrections"][number]];
    expect(run("XREF", folderInput(fine))).toEqual([]);
  });

  it("reports a report line that reports.json does not hold, and one that names another finding", () => {
    const world = storedWorld();
    const brief = briefOn(world, BILINGUAL);
    brief.reports[0]!.id = "R-0009";
    expect(triples(run("XREF", briefInput(world, brief)))).toEqual([[
      "XREF", `briefs/${BILINGUAL}.json: reports[0].id`, "R-0009 is listed here, but reports.json has no such report.",
    ]]);
    const other = storedWorld();
    const line = briefOn(other, BILINGUAL);
    line.reports[0]!.finding_id = PROOF;
    expect(triples(run("XREF", briefInput(other, line)))).toEqual([[
      "XREF", `briefs/${BILINGUAL}.json: reports[0].id`, `R-0001 is listed here for ${PROOF}, but reports.json has it on ${PROTEIN}.`,
    ]]);
  });

  it("puts each line's issue at the line's own index", () => {
    const world = storedWorld();
    world.corrections.push(Correction.parse({ ...world.corrections[0]!, id: "C-0002" }));
    const brief = briefOn(world, BILINGUAL);
    brief.corrections = [correctionLine(), correctionLine({ id: "C-0002" }), correctionLine({ id: "C-0009" })] as Brief["corrections"];
    brief.reports = [...brief.reports, { id: "R-0003", finding_id: PROTEIN, status: "rejected" }, { id: "R-0002", finding_id: PROOF, status: "rejected" }];
    expect(pathsOf(run("XREF", briefInput(world, brief)))).toEqual([
      `briefs/${BILINGUAL}.json: corrections[2].id`, `briefs/${BILINGUAL}.json: reports[1].id`,
    ]);
  });
});

describe("XREF: each finding's briefs list the briefs that show it", () => {
  /** Dates of the finding the story (or items or deep dive) of the brief shows, as validatePublished's run reads them. */
  const missingDate = (world: StoredWorld, brief: Brief, id: string): ValidationIssue[] => {
    findingOf(world, id).briefs = findingOf(world, id).briefs.filter((d) => d !== brief.date);
    return run("XREF", briefInput(world, brief)).filter((i) => i.path === `findings/${id}.json: briefs`);
  };

  it("reports a finding that does not list the brief whose story shows it", () => {
    const world = storedWorld();
    const issues = missingDate(world, briefOn(world, BILINGUAL), LIGHT);
    expect(triples(issues)).toEqual([[
      "XREF", `findings/${LIGHT}.json: briefs`, `Its briefs list does not have ${BILINGUAL}, but briefs/${BILINGUAL}.json shows this finding in its story.`,
    ]]);
    expect(issues[0]!.hint).toContain("oldest first");
  });

  it("reports a finding that does not list the brief whose items show it", () => {
    const world = storedWorld();
    expect(triples(missingDate(world, briefOn(world, BILINGUAL), PROTEIN))).toEqual([[
      "XREF", `findings/${PROTEIN}.json: briefs`, `Its briefs list does not have ${BILINGUAL}, but briefs/${BILINGUAL}.json shows this finding in its items.`,
    ]]);
  });

  it("reports a finding that does not list the brief whose deep dive shows it", () => {
    const world = addSunday(storedWorld());
    expect(triples(missingDate(world, briefOn(world, SUNDAY), PROTEIN))).toEqual([[
      "XREF", `findings/${PROTEIN}.json: briefs`, `Its briefs list does not have ${SUNDAY}, but briefs/${SUNDAY}.json shows this finding in its deep dive.`,
    ]]);
  });

  it("says the first part that shows a finding when a brief shows it twice", () => {
    const world = storedWorld();
    const brief = briefOn(world, BILINGUAL);
    brief.items.push({ finding_id: LIGHT, new: false, update: lz("Again.", "再次。") });
    expect(missingDate(world, brief, LIGHT).map((i) => i.message)).toEqual([
      `Its briefs list does not have ${BILINGUAL}, but briefs/${BILINGUAL}.json shows this finding in its story.`,
    ]);
  });

  it("asks nothing of a finding a brief only points at: a lead line, a rung change, the review, a correction line or a report line", () => {
    const world = storedWorld();
    // F2 (PROOF) is shown only by the English-only edition; the bilingual edition names it in every pointing part, and its `briefs`
    // stays as it is.
    const brief = briefOn(world, BILINGUAL);
    brief.lead[0]!.finding_ids.push(PROOF);
    brief.rung_changes = [{ finding_id: PROOF, from: "claimed", to: "preprint", date: "2026-11-18", by: "script" }];
    brief.corrections[0]!.finding_id = PROOF;
    world.corrections[0]!.finding_id = PROOF;
    brief.reports[0]!.finding_id = PROOF;
    world.reports[0]!.finding_id = PROOF;
    expect(findingOf(world, PROOF).briefs).toEqual([EN_ONLY]);
    expect(run("XREF", briefInput(world, brief))).toEqual([]);
    const monday = briefOf(MONDAY, { review: { ...fullBrief().review!, remarkable: { finding_id: PROOF, note: l("n") }, fell: [PROOF], setbacks: [PROOF] } });
    expect(run("XREF", briefInput(world, monday))).toEqual([]);
  });

  it("holds each brief that shows the finding to the list: a finding shown by two briefs lists both", () => {
    const world = storedWorld();
    expect(findingOf(world, PROTEIN).briefs).toEqual([EN_ONLY, BILINGUAL]);
    findingOf(world, PROTEIN).briefs = [EN_ONLY];
    expect(triples(run("XREF", folderInput(world)))).toEqual([[
      "XREF", `findings/${PROTEIN}.json: briefs`, `Its briefs list does not have ${BILINGUAL}, but briefs/${BILINGUAL}.json shows this finding in its items.`,
    ]]);
    findingOf(world, PROTEIN).briefs = [BILINGUAL];
    expect(findingOf(world, PROTEIN).briefs).toEqual([BILINGUAL]);
    expect(triples(run("XREF", folderInput(world)))).toEqual([[
      "XREF", `findings/${PROTEIN}.json: briefs`, `Its briefs list does not have ${EN_ONLY}, but briefs/${EN_ONLY}.json shows this finding in its story.`,
    ]]);
    findingOf(world, PROTEIN).briefs = [];
    expect(run("XREF", folderInput(world)).filter((i) => i.path === `findings/${PROTEIN}.json: briefs`)).toHaveLength(2);
  });

  it("asks the briefs list of the findings the run was given only: one it was not given is reported missing where it is named, and asked nothing more", () => {
    const world = storedWorld();
    const brief = briefOn(world, BILINGUAL);
    const kept = { ...contentOf(world), findings: world.findings.filter((f) => f.id === LIGHT) };
    const issues = runRules(buildPublishedInput(brief, kept, { config: config() }), [ruleOf("XREF")]);
    expect(issues.filter((i) => i.message.startsWith("Its briefs list"))).toEqual([]);
    expect(pathsOf(inFile(issues, `briefs/${BILINGUAL}.json`))).toEqual([
      `briefs/${BILINGUAL}.json: corrections[0].finding_id`, `briefs/${BILINGUAL}.json: items[0].finding_id`,
      `briefs/${BILINGUAL}.json: lead[0].finding_ids[1]`, `briefs/${BILINGUAL}.json: reports[0].finding_id`,
    ]);
    // The finding it was given is asked: with its list lacking the date, only that finding is reported.
    findingOf(world, LIGHT).briefs = [];
    const asked = runRules(buildPublishedInput(brief, { ...contentOf(world), findings: world.findings.filter((f) => f.id === LIGHT) }, { config: config() }), [ruleOf("XREF")]);
    expect(asked.filter((i) => i.message.startsWith("Its briefs list")).map((i) => i.path)).toEqual([`findings/${LIGHT}.json: briefs`]);
  });
});

describe("XREF: what a finding names (the folder's run)", () => {
  it("reports a related id that no finding has, at its index", () => {
    const world = storedWorld();
    findingOf(world, PROTEIN).related = [PROOF, MISSING];
    expect(triples(run("XREF", folderInput(world)))).toEqual([[
      "XREF", `findings/${PROTEIN}.json: related[1]`, `Names ${MISSING} as related, but findings/${MISSING}.json does not exist.`,
    ]]);
  });

  it("reports a term the glossary does not hold, at its index", () => {
    const world = storedWorld();
    findingOf(world, PROTEIN).terms = ["no-such-term", FOLDING];
    expect(triples(run("XREF", folderInput(world)))).toEqual([[
      "XREF", `findings/${PROTEIN}.json: terms[0]`, "Lists the term no-such-term, but glossary.json has no such term.",
    ]]);
  });

  it("reports a brief in a finding's list that no file holds, and one that does not name the finding", () => {
    const world = storedWorld();
    findingOf(world, PROOF).briefs = [EN_ONLY, "2026-11-30"];
    findingOf(world, PROOF).first_brief = EN_ONLY;
    expect(triples(run("XREF", folderInput(world)))).toEqual([[
      "XREF", `findings/${PROOF}.json: briefs[1]`, "Lists 2026-11-30, but briefs/2026-11-30.json does not exist.",
    ]]);
    const naming = storedWorld();
    findingOf(naming, PROOF).briefs = [EN_ONLY, DATA_ONLY];
    const issues = run("XREF", folderInput(naming));
    expect(triples(issues)).toEqual([[
      "XREF", `findings/${PROOF}.json: briefs[1]`, `Lists ${DATA_ONLY}, but briefs/${DATA_ONLY}.json does not name this finding.`,
    ]]);
    expect(issues[0]!.hint).toContain("only the editions that reported it");
  });

  it("passes a brief in the list that only points at the finding", () => {
    const world = storedWorld();
    // DATA_ONLY names LIGHT through its rung change, and nothing shows it there.
    findingOf(world, LIGHT).briefs = [BILINGUAL, DATA_ONLY];
    expect(run("XREF", folderInput(world))).toEqual([]);
  });

  it("knows only the one brief in a run for one brief: another date in the list is not judged, the brief's own is", () => {
    const world = storedWorld();
    findingOf(world, PROOF).briefs = [EN_ONLY, "2026-11-30"];
    expect(run("XREF", briefInput(world, briefOn(world, EN_ONLY)))).toEqual([]);
    findingOf(world, PROOF).briefs = [EN_ONLY, BILINGUAL];
    const issues = run("XREF", briefInput(world, briefOn(world, BILINGUAL)));
    expect(triples(issues)).toEqual([[
      "XREF", `findings/${PROOF}.json: briefs[1]`, `Lists ${BILINGUAL}, but briefs/${BILINGUAL}.json does not name this finding.`,
    ]]);
  });

  it("reports a glossary term whose first finding does not exist, at the term's index", () => {
    const world = storedWorld();
    termOf(world, FOLDING).first_finding = MISSING;
    expect(triples(run("XREF", folderInput(world)))).toEqual([[
      "XREF", `glossary.json: terms[2].first_finding`, `Names ${MISSING} as the finding that first used it, but findings/${MISSING}.json does not exist.`,
    ]]);
  });
});

describe("XREF: what a stored correction and a stored report name (the folder's run)", () => {
  const stored = (over: Json): StoredWorld => {
    const world = storedWorld();
    world.corrections[0] = Correction.parse({ ...world.corrections[0]!, ...over });
    return world;
  };

  it("reports a correction's finding, edition, term and report that do not exist, each at its key", () => {
    const missing = (over: Json, key: string, message: string): void => {
      const issues = run("XREF", folderInput(stored(over))).filter((i) => i.path.startsWith("corrections.json: "));
      expect(triples(issues), key).toEqual([["XREF", `corrections.json: corrections[0].${key}`, message]]);
    };
    missing({ finding_id: MISSING }, "finding_id", `C-0001 names ${MISSING}, but findings/${MISSING}.json does not exist.`);
    missing({ finding_id: null, edition_date: "2026-11-30" }, "edition_date", "C-0001 names the edition 2026-11-30, but briefs/2026-11-30.json does not exist.");
    missing({ finding_id: null, term_id: "no-such-term" }, "term_id", "C-0001 names the term no-such-term, but glossary.json has no such term.");
    missing({ report_id: "R-0009" }, "report_id", "C-0001 answers R-0009, but reports.json has no such report.");
  });

  it("passes a correction whose finding, edition, term and report exist, of each target kind", () => {
    expect(run("XREF", folderInput(stored({})))).toEqual([]);
    for (const target of [{ edition_date: EN_ONLY }, { term_id: FOLDING }]) {
      const world = stored({ finding_id: null, ...target });
      // The brief that lists the correction names the same record.
      Object.assign(briefOn(world, BILINGUAL).corrections[0]!, { finding_id: null, edition_date: null, term_id: null, ...target });
      expect(run("XREF", folderInput(world)), JSON.stringify(target)).toEqual([]);
    }
  });

  it("puts the issue at the correction's own index in the file, not in its id", () => {
    const world = storedWorld();
    world.corrections.push(Correction.parse({ ...world.corrections[0]!, id: "C-0002", finding_id: MISSING, report_id: "R-0009" }));
    const issues = run("XREF", folderInput(world));
    expect(pathsOf(issues)).toEqual(["corrections.json: corrections[1].finding_id", "corrections.json: corrections[1].report_id"]);
  });

  it("reports a stored report whose finding or correction does not exist", () => {
    const world = storedWorld();
    world.reports[1] = { ...world.reports[1]!, finding_id: MISSING };
    world.reports[0] = { ...world.reports[0]!, correction_id: "C-0009" };
    expect(triples(run("XREF", folderInput(world)))).toEqual([
      ["XREF", "reports.json: reports[0].correction_id", "R-0001 names C-0009, but corrections.json has no such correction."],
      ["XREF", "reports.json: reports[1].finding_id", `R-0002 is about ${MISSING}, but findings/${MISSING}.json does not exist.`],
    ]);
  });
});

describe("XREF: a removed correction's path holds REMOVED_TEXT in the record it names (SPEC §4.12 'Removed text')", () => {
  const removalIssues = (world: StoredWorld): ValidationIssue[] => run("XREF", folderInput(world)).filter((i) => i.path.endsWith(".path"));

  it("passes a finding whose explainer.how_sure a removed correction rewrote", () => {
    const world = removedHowSure(storedWorld());
    expect(findingOf(world, PROTEIN).explainer.how_sure).toEqual(REMOVED_TEXT);
    expect(run("XREF", folderInput(world))).toEqual([]);
  });

  it("passes a brief whose deep_dive.text a removed correction rewrote", () => {
    const world = addSunday(storedWorld());
    briefOn(world, SUNDAY).deep_dive!.text = { ...REMOVED_TEXT };
    addRemoval(world, { edition_date: SUNDAY }, "deep_dive.text");
    expect(run("XREF", folderInput(world))).toEqual([]);
  });

  it("fails a removed correction whose path still holds other text, naming the correction, the path and the file but not the text", () => {
    const world = removedHowSure(storedWorld());
    findingOf(world, PROTEIN).explainer.how_sure = lz("Some other text.", "別的文字。");
    const issues = run("XREF", folderInput(world));
    expect(triples(issues)).toEqual([[
      "XREF", "corrections.json: corrections[1].path",
      `C-0002 removes explainer.how_sure in findings/${PROTEIN}.json, but the record still holds other text there; a removal rewrites the text with "${REMOVED_TEXT.en}".`,
    ]]);
    expect(issues[0]!.hint).toContain("never copied");
    expect(JSON.stringify(issues)).not.toContain("Some other text");
  });

  it("fails an L10n that is REMOVED_TEXT in one language only", () => {
    const world = removedHowSure(storedWorld());
    findingOf(world, PROTEIN).explainer.how_sure = { en: REMOVED_TEXT.en, zh: "別的文字。" };
    expect(pathsOf(removalIssues(world))).toEqual(["corrections.json: corrections[1].path"]);
    findingOf(world, PROTEIN).explainer.how_sure = { en: "Other.", zh: REMOVED_TEXT.zh };
    expect(pathsOf(removalIssues(world))).toEqual(["corrections.json: corrections[1].path"]);
    findingOf(world, PROTEIN).explainer.how_sure = { en: REMOVED_TEXT.en, zh: null };
    expect(pathsOf(removalIssues(world))).toEqual(["corrections.json: corrections[1].path"]);
    findingOf(world, PROTEIN).explainer.how_sure = { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh };
    expect(removalIssues(world)).toEqual([]);
  });

  it("fails a removed correction whose path the record lacks, in a finding and in a brief", () => {
    const world = storedWorld();
    addRemoval(world, { finding_id: PROTEIN }, "sources.5.url");
    addRemoval(world, { finding_id: PROTEIN }, "figure.alt");
    addRemoval(world, { edition_date: EN_ONLY }, "deep_dive.text");
    addRemoval(world, { edition_date: EN_ONLY }, "review.big_picture");
    const issues = removalIssues(world);
    expect(triples(issues)).toEqual([
      ["XREF", "corrections.json: corrections[1].path", `C-0002 removes sources.5.url in findings/${PROTEIN}.json, but the record has no value at that path.`],
      ["XREF", "corrections.json: corrections[2].path", `C-0003 removes figure.alt in findings/${PROTEIN}.json, but the record has no value at that path.`],
      ["XREF", "corrections.json: corrections[3].path", `C-0004 removes deep_dive.text in briefs/${EN_ONLY}.json, but the record has no value at that path.`],
      ["XREF", "corrections.json: corrections[4].path", `C-0005 removes review.big_picture in briefs/${EN_ONLY}.json, but the record has no value at that path.`],
    ]);
  });

  it("reads a path as the correction writes it: indices from 0, own keys only", () => {
    const world = storedWorld();
    const finding = findingOf(world, PROTEIN);
    finding.sources[1]!.url = REMOVED_TEXT.en;
    finding.ai.evidence[0]!.quote = REMOVED_TEXT.en;
    addRemoval(world, { finding_id: PROTEIN }, "sources.1.url");
    addRemoval(world, { finding_id: PROTEIN }, "ai.evidence.0.quote");
    expect(removalIssues(world)).toEqual([]);
    // Index 1 of the sources holds the removed text; index 0 does not; an index past the end, a leading zero, a word and a key the
    // record only inherits are all paths the record lacks.
    const bad = storedWorld();
    findingOf(bad, PROTEIN).sources[1]!.url = REMOVED_TEXT.en;
    // The finding has two sources and one term, so `sources.2` and `terms.1` are the first index past the end of each list: no value.
    const badPaths = ["sources.0.url", "sources.2.url", "sources.2", "terms.1", "sources.01.url", "sources.x.url", "sources.1.url.x", "explainer.constructor",
      "explainer.__proto__", "explainer.how_sure.en.x", "constructor", "sources.length", "terms.length"];
    expect(findingOf(bad, PROTEIN).sources).toHaveLength(2);
    expect(findingOf(bad, PROTEIN).terms).toHaveLength(1);
    for (const path of badPaths) addRemoval(bad, { finding_id: PROTEIN }, path);
    const got = removalIssues(bad).map((i) => i.message.replace(/^C-\d{4} removes /, "").split(" in ")[0] + (i.message.includes("other text") ? " (other)" : " (lacks)"));
    expect(got).toEqual([
      "sources.0.url (other)", "sources.2.url (lacks)", "sources.2 (lacks)", "terms.1 (lacks)", "sources.01.url (lacks)", "sources.x.url (lacks)",
      "sources.1.url.x (lacks)", "explainer.constructor (lacks)", "explainer.__proto__ (lacks)", "explainer.how_sure.en.x (lacks)", "constructor (lacks)",
      "sources.length (lacks)", "terms.length (lacks)",
    ]);
    // The last index of a list holds a value, so that path is judged by what it holds.
    const last = storedWorld();
    addRemoval(last, { finding_id: PROTEIN }, "sources.1");
    addRemoval(last, { finding_id: PROTEIN }, "terms.0");
    expect(removalIssues(last).map((i) => (i.message.includes("other text") ? "other" : "lacks"))).toEqual(["other", "other"]);
  });

  it("takes a plain string as removed when it is the English text, and a value that is not text, or not a pair, as other text", () => {
    const world = storedWorld();
    findingOf(world, PROTEIN).sources[0]!.url = REMOVED_TEXT.zh;
    addRemoval(world, { finding_id: PROTEIN }, "sources.0.url");
    findingOf(world, PROTEIN).sources[1]!.url = REMOVED_TEXT.en;
    addRemoval(world, { finding_id: PROTEIN }, "sources.1.url");
    addRemoval(world, { finding_id: PROTEIN }, "explainer");
    addRemoval(world, { finding_id: PROTEIN }, "terms");
    addRemoval(world, { finding_id: PROTEIN }, "figure");
    addRemoval(world, { finding_id: PROTEIN }, "sources");
    findingOf(world, PROTEIN).explainer.how_sure = { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh, extra: "x" } as never;
    addRemoval(world, { finding_id: PROTEIN }, "explainer.how_sure");
    const lines = removalIssues(world).map((i) => `${i.path.replace("corrections.json: ", "")} ${i.message.includes("other text") ? "other" : "lacks"}`);
    expect(lines).toEqual([
      "corrections[1].path other", "corrections[3].path other", "corrections[4].path other", "corrections[5].path lacks", "corrections[6].path other",
      "corrections[7].path other",
    ]);
  });

  it("reads a term's definition as its English, and its Chinese while it has any", () => {
    const withTerm = (en: string, zh: string | null, hasZh = true): StoredWorld => {
      const world = storedWorld();
      const term = termOf(world, FOLDING);
      term.en.definition = en;
      term.zh = hasZh ? { ...term.zh!, definition: zh! } : null;
      addRemoval(world, { term_id: FOLDING }, "definition");
      return world;
    };
    expect(removalIssues(withTerm(REMOVED_TEXT.en, REMOVED_TEXT.zh))).toEqual([]);
    expect(removalIssues(withTerm(REMOVED_TEXT.en, null, false))).toEqual([]);
    expect(pathsOf(removalIssues(withTerm(REMOVED_TEXT.en, "別的文字。")))).toEqual(["corrections.json: corrections[1].path"]);
    expect(pathsOf(removalIssues(withTerm("Other text.", REMOVED_TEXT.zh)))).toEqual(["corrections.json: corrections[1].path"]);
    expect(pathsOf(removalIssues(withTerm("Other text.", null, false)))).toEqual(["corrections.json: corrections[1].path"]);
    expect(removalIssues(withTerm(REMOVED_TEXT.en, REMOVED_TEXT.zh))).toEqual([]);
    const issues = removalIssues(withTerm("Other text.", "別的文字。"));
    expect(issues[0]!.message).toBe(`C-0002 removes definition in the term ${FOLDING}, but the record still holds other text there; a removal rewrites the text with "${REMOVED_TEXT.en}".`);
  });

  it("reads any other path of a term in the term's record: only `definition` is the term's own special case", () => {
    const world = storedWorld();
    addRemoval(world, { term_id: FOLDING }, "en.term");
    addRemoval(world, { term_id: FOLDING }, "term");
    addRemoval(world, { term_id: FOLDING }, "en.definition");
    termOf(world, FOLDING).en.definition = REMOVED_TEXT.en;
    const lines = removalIssues(world).map((i) => `${i.path.replace("corrections.json: ", "")} ${i.message.includes("other text") ? "other" : "lacks"}`);
    expect(lines).toEqual(["corrections[1].path other", "corrections[2].path lacks"]);
  });

  it("judges only a removed correction: a correction, a clarification or an update may leave any text at its path", () => {
    const world = storedWorld();
    for (const [i, type] of (["correction", "clarification", "update"] as const).entries()) {
      world.corrections.push(Correction.parse({ ...world.corrections[0]!, id: `C-000${i + 2}`, type, path: "explainer.how_sure" }));
    }
    findingOf(world, PROTEIN).explainer.how_sure = l("Text that stays.");
    expect(run("XREF", folderInput(world))).toEqual([]);
  });

  it("judges nothing of a removed correction whose record is not there, which its own key's issue already says", () => {
    const world = storedWorld();
    addRemoval(world, { finding_id: MISSING }, "explainer.how_sure");
    addRemoval(world, { edition_date: "2026-11-30" }, "deep_dive.text");
    addRemoval(world, { term_id: "no-such-term" }, "definition");
    expect(pathsOf(run("XREF", folderInput(world)))).toEqual([
      "corrections.json: corrections[1].finding_id", "corrections.json: corrections[2].edition_date", "corrections.json: corrections[3].term_id",
    ]);
  });

  it("applies in a run for one brief too, to the findings and the brief it was given", () => {
    const world = removedHowSure(storedWorld());
    findingOf(world, PROTEIN).explainer.how_sure = l("Other text.");
    expect(pathsOf(run("XREF", briefInput(world, briefOn(world, BILINGUAL))))).toEqual(["corrections.json: corrections[1].path"]);
    const repaired = removedHowSure(storedWorld());
    expect(run("XREF", briefInput(repaired, briefOn(repaired, BILINGUAL)))).toEqual([]);
  });
});

describe("XREF: correction ids and report ids run in sequence", () => {
  const withCorrections = (ids: string[]): StoredWorld => {
    const world = storedWorld();
    world.corrections = ids.map((id, i) => Correction.parse({ ...storedWorld().corrections[0]!, id, date: i === 0 ? BILINGUAL : BILINGUAL }));
    return world;
  };
  const withReports = (ids: string[]): StoredWorld => {
    const world = storedWorld();
    world.reports = ids.map((id) => ({ ...storedWorld().reports[1]!, id }));
    return world;
  };
  const sequence = (world: StoredWorld): ValidationIssue[] => run("XREF", folderInput(world)).filter((i) => i.message.includes("is due") || i.message.includes("used twice"));

  it("passes C-0001, C-0002 and on, and R-0001, R-0002 and on", () => {
    expect(sequence(withCorrections(["C-0001", "C-0002", "C-0003"]))).toEqual([]);
    expect(sequence(withReports(["R-0001", "R-0002", "R-0003"]))).toEqual([]);
    expect(sequence(withCorrections([]))).toEqual([]);
    expect(sequence(withReports([]))).toEqual([]);
  });

  it("reports a gap once, at the first id out of place, saying which id is due", () => {
    expect(triples(sequence(withCorrections(["C-0001", "C-0003", "C-0004"])))).toEqual([[
      "XREF", "corrections.json: corrections[1].id",
      "C-0003 stands where C-0002 is due; ids run C-0001, C-0002 and on in file order, with no gap and no repeat.",
    ]]);
    expect(triples(sequence(withReports(["R-0002"])))).toEqual([[
      "XREF", "reports.json: reports[0].id", "R-0002 stands where R-0001 is due; ids run R-0001, R-0002 and on in file order, with no gap and no repeat.",
    ]]);
  });

  it("reports a reordering once, and a first id that is not C-0001", () => {
    expect(pathsOf(sequence(withCorrections(["C-0002", "C-0001"])))).toEqual(["corrections.json: corrections[0].id"]);
    expect(pathsOf(sequence(withCorrections(["C-0001", "C-0003", "C-0002", "C-0005"])))).toEqual(["corrections.json: corrections[1].id"]);
    expect(pathsOf(sequence(withReports(["R-0005", "R-0002", "R-0003"])))).toEqual(["reports.json: reports[0].id"]);
  });

  it("reports an id used twice where it recurs, naming the first place, whatever the order", () => {
    expect(triples(sequence(withCorrections(["C-0001", "C-0001"])))).toEqual([[
      "XREF", "corrections.json: corrections[1].id", "C-0001 is used twice (also at corrections[0]); ids are unique.",
    ]]);
    expect(triples(sequence(withReports(["R-0001", "R-0002", "R-0001", "R-0001"])))).toEqual([
      ["XREF", "reports.json: reports[2].id", "R-0001 is used twice (also at reports[0]); ids are unique."],
      ["XREF", "reports.json: reports[3].id", "R-0001 is used twice (also at reports[0]); ids are unique."],
    ]);
    // A repeat is not also reported as a gap, and a gap before it is still reported once.
    expect(pathsOf(sequence(withCorrections(["C-0001", "C-0003", "C-0003"])))).toEqual(["corrections.json: corrections[1].id", "corrections.json: corrections[2].id"]);
  });

  it("holds the ids of the corrections file only in file order, whatever their dates", () => {
    const world = withCorrections(["C-0001", "C-0002"]);
    world.corrections[0] = Correction.parse({ ...world.corrections[0]!, date: DATA_ONLY });
    world.corrections[1] = Correction.parse({ ...world.corrections[1]!, date: EN_ONLY });
    expect(sequence(world)).toEqual([]);
  });
});

describe("XREF: the archive index (the folder's run)", () => {
  const archiveIssues = (world: StoredWorld, over: Partial<PublishedFolder> = {}): ValidationIssue[] =>
    run("XREF", folderInput(world, over)).filter((i) => i.path.startsWith("archive-index.json: "));

  it("lists exactly the stored briefs: the base index passes", () => {
    expect(archiveIssues(storedWorld())).toEqual([]);
    expect(archiveIssues(addMonday(addSunday(storedWorld())))).toEqual([]);
  });

  it("reports a missing index when briefs exist, and nothing when there are none or the file is there but unreadable", () => {
    const world = storedWorld();
    const none = archiveIssues(world, { archive: null, files: folderOf(world).files.filter((f) => f.path !== "archive-index.json") });
    expect(triples(none)).toEqual([[
      "XREF", "archive-index.json: (file)", "archive-index.json is missing but 3 briefs exist.",
    ]]);
    expect(none[0]!.hint).toContain("Publish writes archive-index.json");
    const one = storedWorld();
    one.briefs = [one.briefs[0]!];
    expect(archiveIssues(one, { archive: null, files: folderOf(one).files.filter((f) => f.path !== "archive-index.json") }).map((i) => i.message)).toEqual([
      "archive-index.json is missing but 1 brief exists.",
    ]);
    const empty = storedWorld();
    empty.briefs = [];
    expect(archiveIssues(empty, { archive: null, files: [] })).toEqual([]);
    const unreadable = folderOf(world).files.map((f) => (f.path === "archive-index.json" ? { ...f, parsed: false } : f));
    expect(archiveIssues(world, { archive: null, files: unreadable })).toEqual([]);
  });

  it("reports an edition of the index that no brief file holds, at its index", () => {
    const world = storedWorld();
    world.archive.editions.unshift({ date: "2026-11-30", edition: "full", published_at: "2026-11-30T04:00:00+08:00", finding_count: 0, corrected: false });
    expect(triples(archiveIssues(world))).toEqual([[
      "XREF", "archive-index.json: editions[0].date", "2026-11-30 is listed, but briefs/2026-11-30.json does not exist.",
    ]]);
  });

  it("passes an edition whose brief file exists but could not be read", () => {
    const world = storedWorld();
    world.briefs = world.briefs.filter((b) => b.date !== BILINGUAL);
    const file = `briefs/${BILINGUAL}.json`;
    expect(archiveIssues(world, { files: [...folderOf(world).files, fileEntry(file, { parsed: false })] })).toEqual([]);
    // With no file at all, or a link in its place, the edition is listed and missing.
    const missing = [["XREF", "archive-index.json: editions[1].date", `${BILINGUAL} is listed, but ${file} does not exist.`]];
    expect(triples(archiveIssues(world))).toEqual(missing);
    expect(triples(archiveIssues(world, { files: [...folderOf(world).files, fileEntry(file, { regular: false, parsed: false })] }))).toEqual(missing);
  });

  it("reports an edition or a publish time that differs from the brief's, and accepts the same instant written another way", () => {
    const world = storedWorld();
    world.archive.editions[1]!.edition = "partial";
    world.archive.editions[2]!.published_at = "2026-11-18T04:12:31+08:00";
    expect(triples(archiveIssues(world))).toEqual([
      ["XREF", "archive-index.json: editions[1].edition", `${BILINGUAL} is listed as partial, but briefs/${BILINGUAL}.json is a full edition.`],
      ["XREF", "archive-index.json: editions[2].published_at",
        `${EN_ONLY} is listed as published at 2026-11-18T04:12:31+08:00, but briefs/${EN_ONLY}.json says 2026-11-18T04:12:30+08:00.`],
    ]);
    const same = storedWorld();
    same.archive.editions[1]!.published_at = "2026-11-18T20:12:30Z";
    same.archive.editions[2]!.published_at = "2026-11-18T04:12:30.000+08:00";
    expect(archiveIssues(same)).toEqual([]);
    const later = storedWorld();
    later.archive.editions[1]!.published_at = "2026-11-18T20:12:30.5Z";
    expect(pathsOf(archiveIssues(later))).toEqual(["archive-index.json: editions[1].published_at"]);
  });

  it("reports a brief the index does not list, once, at the editions", () => {
    const world = storedWorld();
    world.archive.editions = world.archive.editions.filter((e) => e.date !== BILINGUAL);
    expect(triples(archiveIssues(world))).toEqual([[
      "XREF", "archive-index.json: editions", `briefs/${BILINGUAL}.json is not listed.`,
    ]]);
    const two = storedWorld();
    two.archive.editions = [];
    expect(archiveIssues(two).map((i) => i.message)).toEqual([
      `briefs/${EN_ONLY}.json is not listed.`, `briefs/${BILINGUAL}.json is not listed.`, `briefs/${DATA_ONLY}.json is not listed.`,
    ]);
  });

  it("reports each ref of a URL that names no finding and no edition, at the URL's key and the ref's index", () => {
    const world = storedWorld();
    const url = "https://arxiv.org/abs/2610.00001";
    world.archive.urls[url]!.refs = [PROTEIN, MISSING, "2026-11-30/brief", `${BILINGUAL}/brief`, EN_ONLY + "/brief"];
    expect(triples(archiveIssues(world))).toEqual([
      ["XREF", `archive-index.json: urls["${url}"].refs[1]`, `${MISSING} is cited here, but findings/${MISSING}.json does not exist.`],
      ["XREF", `archive-index.json: urls["${url}"].refs[2]`, "2026-11-30/brief names the brief-level text of 2026-11-30, but briefs/2026-11-30.json does not exist."],
    ]);
  });

  it("reads a ref as an edition's text only when the whole ref is a date and /brief, and judges any other ref as a finding id", () => {
    const world = storedWorld();
    const url = "https://arxiv.org/abs/2610.00001";
    const odd = [`x${EN_ONLY}/brief`, `${EN_ONLY}/brief/x`, `${EN_ONLY}/briefs`, `${EN_ONLY}/Brief`];
    world.archive.urls[url]!.refs = odd;
    expect(triples(archiveIssues(world))).toEqual(
      odd.map((ref, i) => ["XREF", `archive-index.json: urls["${url}"].refs[${i}]`, `${ref} is cited here, but findings/${ref}.json does not exist.`]),
    );
  });

  it("passes a ref to a finding or an edition whose file exists but could not be read", () => {
    const world = storedWorld();
    const url = "https://arxiv.org/abs/2610.00001";
    world.archive.urls[url]!.refs = ["math-2026-0777", "2026-11-30/brief"];
    const files = [...folderOf(world).files, fileEntry("findings/math-2026-0777.json", { parsed: false }), fileEntry("briefs/2026-11-30.json", { parsed: false })];
    expect(archiveIssues(world, { files })).toEqual([]);
    expect(archiveIssues(world)).toHaveLength(2);
  });
});

describe("XREF: the files a brief points at, its metrics file and its day's status file (the folder's run)", () => {
  /** The issues the XREF run over the folder reports in the brief files of `world`, with the files of the world left out as `gone` says. */
  const fileIssues = (world: StoredWorld, gone: readonly string[] = [], flags: Partial<StoredFile> = {}): ValidationIssue[] => {
    const input = folderInput(world);
    const files = input.published.folder!.files
      .filter((f) => !gone.includes(f.path) || Object.keys(flags).length > 0)
      .map((f) => (gone.includes(f.path) ? { ...f, ...flags } : f));
    return run("XREF", { ...input, published: { ...input.published, folder: { ...input.published.folder!, files } } }).filter((i) => i.path.startsWith("briefs/"));
  };
  const METRICS_HINT = (file: string): string => `Publish commits the day's metrics with the data-only edition. Restore ${file} from git history.`;
  const STATUS_HINT = (file: string): string => `Publish writes the day's status file before any edition. Restore ${file} from git history.`;

  it("passes every brief of the base world, a data-only one included, each with its metrics file and its status file", () => {
    expect(fileIssues(storedWorld())).toEqual([]);
    expect(fileIssues(addMonday(addSunday(storedWorld())))).toEqual([]);
  });

  it("reports a missing metrics file at the brief's pace.metrics_file, with the file to restore, for each brief", () => {
    for (const date of [EN_ONLY, BILINGUAL, DATA_ONLY]) {
      const issues = fileIssues(storedWorld(), [`metrics/${date}.json`]);
      expect(triples(issues), date).toEqual([[
        "XREF", `briefs/${date}.json: pace.metrics_file`, `metrics/${date}.json holds this edition's Pace numbers (status ok), but it does not exist.`,
      ]]);
      expect(issues[0]!.hint, date).toBe(METRICS_HINT(`metrics/${date}.json`));
      expect(issues[0]!.severity).toBe("error");
    }
  });

  it("reports a missing status file at the brief's (status), with the file to restore, for each brief", () => {
    for (const date of [EN_ONLY, BILINGUAL, DATA_ONLY]) {
      const issues = fileIssues(storedWorld(), [`status/${date}.json`]);
      expect(triples(issues), date).toEqual([[
        "XREF", `briefs/${date}.json: (status)`, `status/${date}.json is the status file of this edition's run, but it does not exist.`,
      ]]);
      expect(issues[0]!.hint, date).toBe(STATUS_HINT(`status/${date}.json`));
      expect(issues[0]!.severity).toBe("error");
    }
  });

  it("reports both when a brief lacks both, in the engine's order (the (status) first), and not the briefs that have their files", () => {
    const issues = fileIssues(storedWorld(), [`metrics/${BILINGUAL}.json`, `status/${BILINGUAL}.json`]);
    expect(pathsOf(issues)).toEqual([`briefs/${BILINGUAL}.json: (status)`, `briefs/${BILINGUAL}.json: pace.metrics_file`]);
    const world = storedWorld();
    const everything = worldFiles(world).map(([rel]) => rel).filter((rel) => /^(metrics|status)\/\d{4}-\d{2}-\d{2}\.json$/.test(rel));
    expect(everything).toHaveLength(6);
    expect(pathsOf(fileIssues(world, everything))).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY].flatMap((d) => [`briefs/${d}.json: (status)`, `briefs/${d}.json: pace.metrics_file`]));
  });

  it("asks for the file the brief points at, whatever its name: the schema pins it to the date, and the rule does not rely on that", () => {
    const world = storedWorld();
    const other = "metrics/2026-11-30.json";
    briefOn(world, BILINGUAL).pace.metrics_file = other;
    for (const gone of [[], [`metrics/${BILINGUAL}.json`]]) {
      const issues = fileIssues(world, gone);
      expect(triples(issues)).toEqual([["XREF", `briefs/${BILINGUAL}.json: pace.metrics_file`, `${other} holds this edition's Pace numbers (status ok), but it does not exist.`]]);
      expect(issues[0]!.hint).toBe(METRICS_HINT(other));
    }
  });

  it("names the Pace status the brief states: the metrics file of a stale Pace is asked for as well", () => {
    const world = storedWorld();
    briefOn(world, BILINGUAL).pace.status = "stale";
    expect(fileIssues(world, [`metrics/${BILINGUAL}.json`]).map((i) => i.message)).toEqual([
      `metrics/${BILINGUAL}.json holds this edition's Pace numbers (status stale), but it does not exist.`,
    ]);
  });

  it("does not ask for the metrics file of a brief whose Pace is missing, and still asks for its status file", () => {
    const world = storedWorld();
    briefOn(world, BILINGUAL).pace.status = "missing";
    expect(fileIssues(world, [`metrics/${BILINGUAL}.json`])).toEqual([]);
    expect(pathsOf(fileIssues(world, [`metrics/${BILINGUAL}.json`, `status/${BILINGUAL}.json`]))).toEqual([`briefs/${BILINGUAL}.json: (status)`]);
    // another brief of the same world, whose Pace is not missing, is still held to its file
    expect(pathsOf(fileIssues(world, [`metrics/${EN_ONLY}.json`]))).toEqual([`briefs/${EN_ONLY}.json: pace.metrics_file`]);
  });

  it("asks a data-only edition for the files it has, its metrics file and its status file, and not for an inputs manifest", () => {
    const world = storedWorld();
    expect(briefOn(world, DATA_ONLY).edition).toBe("data_only");
    expect(fileIssues(world, [`metrics/inputs/${DATA_ONLY}.json`])).toEqual([]);
    expect(fileIssues(world, [`metrics/inputs/${DATA_ONLY}.json`, `metrics/${DATA_ONLY}.json`])).toHaveLength(1);
    // the full editions of the world have no manifest at all
    expect(worldFiles(world).map(([rel]) => rel).filter((rel) => rel.startsWith("metrics/inputs/"))).toEqual([`metrics/inputs/${DATA_ONLY}.json`]);
  });

  it("counts a file that is there but did not parse as present: the file's own SCHEMA issue says why, and the pair is not reported twice", () => {
    for (const path of [`metrics/${BILINGUAL}.json`, `status/${BILINGUAL}.json`, `metrics/${DATA_ONLY}.json`, `status/${EN_ONLY}.json`]) {
      expect(fileIssues(storedWorld(), [path], { parsed: false }), path).toEqual([]);
    }
  });

  it("counts a path that is no regular file, a link or a folder where the file belongs, as missing", () => {
    expect(pathsOf(fileIssues(storedWorld(), [`metrics/${BILINGUAL}.json`], { regular: false, parsed: false }))).toEqual([`briefs/${BILINGUAL}.json: pace.metrics_file`]);
    expect(pathsOf(fileIssues(storedWorld(), [`status/${DATA_ONLY}.json`], { regular: false, parsed: false }))).toEqual([`briefs/${DATA_ONLY}.json: (status)`]);
  });

  it("does not ask for a file in a run for one brief, which has no folder, and asks nothing of a folder without briefs", () => {
    const world = storedWorld();
    for (const brief of world.briefs) expect(briefInput(world, brief).published.folder, brief.date).toBeUndefined();
    for (const brief of world.briefs) expect(run("XREF", briefInput(world, brief)), brief.date).toEqual([]);
    const empty = storedWorld();
    empty.briefs = [];
    expect(run("XREF", folderInput(empty, { files: [] })).filter((i) => i.path.startsWith("briefs/"))).toEqual([]);
  });

  it("asks only for those two files: a term's first_date, a correction's date, a report's resolved_on, the reverse references and the archive's counts are not checked", () => {
    const world = storedWorld();
    const stranger = "2026-11-30";
    world.terms[0]!.first_date = stranger;
    world.corrections[0] = Correction.parse({ ...world.corrections[0]!, date: stranger });
    world.reports[0]!.resolved_on = stranger;
    world.reports[0]!.correction_id = null;
    world.corrections[0] = Correction.parse({ ...world.corrections[0]!, report_id: "R-0002" });
    world.archive.editions[0]!.finding_count = 9;
    world.archive.editions[1]!.corrected = !world.archive.editions[1]!.corrected;
    expect(run("XREF", folderInput(world))).toEqual([]);
  });
});

describe("XREF: what the folder's run knows of files that could not be read", () => {
  const withFiles = (world: StoredWorld, edit: (files: readonly StoredFile[]) => readonly StoredFile[]): PublishedFolder => ({ ...folderOf(world), files: edit(folderOf(world).files) });
  const flag = (path: string, over: Partial<StoredFile>) => (files: readonly StoredFile[]): readonly StoredFile[] => files.map((f) => (f.path === path ? { ...f, ...over } : f));

  it("counts a finding whose file exists but did not parse as there, in a brief, a finding, a term, a correction and the archive", () => {
    const world = storedWorld();
    const gone = LIGHT;
    const remaining = world.findings.filter((f) => f.id !== gone);
    const input = (files: StoredFile[]): PublishedInput => {
      const base = buildPublishedInput(null, { ...contentOf(world), findings: remaining }, { config: config(), date: DATA_ONLY });
      return { ...base, published: { ...base.published, folder: { ...folderOf(world), files } } };
    };
    const files = folderOf(world).files;
    // With the file absent, every place that names the finding fails.
    const absent = run("XREF", input(files.filter((f) => f.path !== `findings/${gone}.json`)));
    expect(absent.filter((i) => i.message.includes(`findings/${gone}.json does not exist`)).length).toBeGreaterThanOrEqual(3);
    // With the file there but unparsed, none does (the file's own SCHEMA issue says why it is unreadable).
    const unparsed = run("XREF", input(files.map((f) => (f.path === `findings/${gone}.json` ? { ...f, parsed: false, id: null } : f))));
    expect(unparsed.filter((i) => i.message.includes(`findings/${gone}.json does not exist`))).toEqual([]);
    // A link in its place is no file: the finding is missing, and FILE_LAYOUT names the link.
    const link = run("XREF", input(files.map((f) => (f.path === `findings/${gone}.json` ? { ...f, regular: false, parsed: false, id: null } : f))));
    expect(link.filter((i) => i.message.includes(`findings/${gone}.json does not exist`)).length).toBeGreaterThanOrEqual(3);
  });

  it("counts an edition whose brief file exists but did not parse as there", () => {
    const world = storedWorld();
    world.corrections[0] = Correction.parse({ ...world.corrections[0]!, finding_id: null, edition_date: "2026-11-30" });
    const absent = run("XREF", folderInput(world));
    expect(absent.map((i) => i.path)).toContain("corrections.json: corrections[0].edition_date");
    const present = run("XREF", { ...folderInput(world), published: { ...folderInput(world).published, folder: withFiles(world, (f) => [...f, fileEntry("briefs/2026-11-30.json", { parsed: false })]) } });
    expect(present.map((i) => i.path)).not.toContain("corrections.json: corrections[0].edition_date");
  });

  it("counts an edition whose brief the run holds as there, whatever the list of files says of it", () => {
    const world = storedWorld();
    world.corrections[0] = Correction.parse({ ...world.corrections[0]!, finding_id: null, edition_date: EN_ONLY });
    const input = folderInput(world);
    const issues = (keep: (f: StoredFile) => boolean): ValidationIssue[] =>
      run("XREF", { ...input, published: { ...input.published, folder: withFiles(world, (f) => f.filter(keep)) } });
    const edition = "corrections.json: corrections[0].edition_date";
    expect(pathsOf(issues(() => true))).not.toContain(edition);
    expect(pathsOf(issues((f) => f.path !== `briefs/${EN_ONLY}.json`))).not.toContain(edition);
  });

  it("skips every check that reads the glossary when glossary.json did not parse, and still makes them when it did", () => {
    const world = storedWorld();
    findingOf(world, PROTEIN).terms = ["no-such-term"];
    world.corrections[0] = Correction.parse({ ...world.corrections[0]!, finding_id: null, term_id: "no-such-term" });
    briefOn(world, BILINGUAL).corrections = [{ id: "C-0001", finding_id: null, edition_date: null, term_id: "no-such-term", type: "correction", reason: lz("r", "因") }];
    const readable = run("XREF", { ...folderInput(world), published: { ...folderInput(world).published, folder: folderOf(world) } });
    expect(pathsOf(readable.filter((i) => i.message.includes("no-such-term")))).toEqual([
      `briefs/${BILINGUAL}.json: corrections[0].term_id`, "corrections.json: corrections[0].term_id", `findings/${PROTEIN}.json: terms[0]`,
    ]);
    const folder = withFiles(world, flag("glossary.json", { parsed: false }));
    const input = folderInput(world);
    const unreadable = run("XREF", { ...input, published: { ...input.published, folder } });
    expect(unreadable.filter((i) => i.message.includes("no-such-term"))).toEqual([]);
  });

  it("skips the checks that read the corrections and the reports when those files did not parse", () => {
    const world = storedWorld();
    briefOn(world, BILINGUAL).corrections[0]!.id = "C-0009";
    briefOn(world, BILINGUAL).reports[0]!.id = "R-0009";
    world.reports[0] = { ...world.reports[0]!, correction_id: "C-0008" };
    const input = folderInput(world);
    const messages = (folder: PublishedFolder): string[] => run("XREF", { ...input, published: { ...input.published, folder } }).map((i) => i.message);
    expect(messages(folderOf(world))).toEqual([
      "C-0009 is listed here, but corrections.json has no such correction.",
      "R-0009 is listed here, but reports.json has no such report.",
      "R-0001 names C-0008, but corrections.json has no such correction.",
    ]);
    expect(messages(withFiles(world, flag("corrections.json", { parsed: false })))).toEqual(["R-0009 is listed here, but reports.json has no such report."]);
    expect(messages(withFiles(world, flag("reports.json", { parsed: false })))).toEqual([
      "C-0009 is listed here, but corrections.json has no such correction.",
      "R-0001 names C-0008, but corrections.json has no such correction.",
    ]);
  });

  it("skips the checks that need the folder in a run for one brief: an edition other than the brief's, the file list, the archive index", () => {
    const world = storedWorld();
    world.corrections[0] = Correction.parse({ ...world.corrections[0]!, finding_id: null, edition_date: "2026-11-30" });
    const brief = briefOn(world, BILINGUAL);
    brief.corrections = [{ id: "C-0001", finding_id: null, edition_date: "2026-11-30", term_id: null, type: "correction", reason: lz("r", "因") }];
    const issues = run("XREF", briefInput(world, brief));
    expect(issues).toEqual([]);
    expect(issues.some((i) => i.path.startsWith("archive-index.json"))).toBe(false);
  });
});

// ── LANG_PARITY ──────────────────────────────────────────────────────────────────────────────────

/** The L10n of a brief of its own, with the path of each, and how to empty each one's Chinese. */
const OWN_L10N: [string, (b: Brief) => { zh: string | null }][] = [
  ["pace.sentence", (b) => b.pace.sentence],
  ["lead[0].text", (b) => b.lead[0]!.text],
  ["lead[1].text", (b) => b.lead[1]!.text],
  ["story.update", (b) => b.story!.update!],
  ["items[1].update", (b) => b.items[1]!.update!],
  ["ideas[0].text", (b) => b.ideas[0]!.text],
  ["also[0].title", (b) => b.also[0]!.title],
  ["deep_dive.text", (b) => b.deep_dive!.text],
  ["review.big_picture", (b) => b.review!.big_picture],
  ["review.remarkable.note", (b) => b.review!.remarkable!.note],
  ["review.strongest_against.text", (b) => b.review!.strongest_against.text],
  ["corrections[0].reason", (b) => b.corrections[0]!.reason],
  ["status_note", (b) => b.status_note!],
];

describe("LANG_PARITY: a brief in both languages has Chinese on each L10n of its own", () => {
  const bilingualFull = (): { world: StoredWorld; brief: Brief } => {
    const { world, brief } = fullWorld();
    expect(brief.languages.zh).toBe(true);
    return { world, brief };
  };

  it("passes a brief whose every L10n has its Chinese", () => {
    const { world, brief } = bilingualFull();
    expect(run("LANG_PARITY", briefInput(world, brief))).toEqual([]);
  });

  it.each(OWN_L10N)("reports a null Chinese at %s, at that place's zh", (place, pick) => {
    const { world, brief } = bilingualFull();
    pick(brief).zh = null;
    const issues = run("LANG_PARITY", briefInput(world, brief));
    expect(triples(issues)).toEqual([[
      "LANG_PARITY", `briefs/${MONDAY}.json: ${place}.zh`,
      `briefs/${MONDAY}.json is in both languages (languages.zh is true), so ${place} needs a Chinese string.`,
    ]]);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.hint).toContain("English-only, with languages.zh false");
  });

  it("asks nothing of an English-only edition, whatever it leaves null", () => {
    const { world, brief } = bilingualFull();
    for (const [, pick] of OWN_L10N) pick(brief).zh = null;
    brief.languages.zh = false;
    expect(run("LANG_PARITY", briefInput(world, brief))).toEqual([]);
  });

  it("reports every null of a brief, each once, in the engine's order", () => {
    const { world, brief } = bilingualFull();
    for (const [, pick] of OWN_L10N) pick(brief).zh = null;
    const issues = run("LANG_PARITY", briefInput(world, brief)).filter((i) => i.path.startsWith(`briefs/${MONDAY}.json: `));
    expect(issues).toHaveLength(OWN_L10N.length);
    expect(new Set(pathsOf(issues)).size).toBe(OWN_L10N.length);
    expect(pathsOf(issues)).toEqual([
      "also[0].title.zh", "corrections[0].reason.zh", "deep_dive.text.zh", "ideas[0].text.zh", "items[1].update.zh", "lead[0].text.zh", "lead[1].text.zh",
      "pace.sentence.zh", "review.big_picture.zh", "review.remarkable.note.zh", "review.strongest_against.text.zh", "status_note.zh", "story.update.zh",
    ].map((place) => `briefs/${MONDAY}.json: ${place}`));
  });

  it("does not ask for a Chinese string in a brief's plain strings, its ids or its flags", () => {
    const { world, brief } = bilingualFull();
    brief.ideas[0]!.who = "An author";
    brief.sources[0]!.title = "An English title";
    expect(run("LANG_PARITY", briefInput(world, brief))).toEqual([]);
  });
});

describe("LANG_PARITY: the corrections a brief lists, and the findings it names", () => {
  it("reports a null Chinese in the after text of a correction the brief lists, at the correction's index in corrections.json", () => {
    const world = storedWorld();
    world.corrections.unshift(Correction.parse({ ...world.corrections[0]!, id: "C-0000" }));
    world.corrections[1]!.after.zh = null;
    const brief = briefOn(world, BILINGUAL);
    const issues = run("LANG_PARITY", briefInput(world, brief));
    expect(triples(issues)).toEqual([[
      "LANG_PARITY", "corrections.json: corrections[1].after.zh",
      `briefs/${BILINGUAL}.json is in both languages (languages.zh is true), so the after text of C-0001, which it lists, needs a Chinese string.`,
    ]]);
  });

  it("does not ask for the before text, the reason, or any correction the brief does not list", () => {
    const world = storedWorld();
    world.corrections.push(Correction.parse({ ...world.corrections[0]!, id: "C-0002" }));
    world.corrections[0]!.before.zh = null;
    world.corrections[0]!.reason.zh = null;
    world.corrections[1]!.after.zh = null;
    const brief = briefOn(world, BILINGUAL);
    expect(run("LANG_PARITY", briefInput(world, brief))).toEqual([]);
  });

  it("skips a listed correction the corrections file does not hold, which XREF reports", () => {
    const world = storedWorld();
    briefOn(world, BILINGUAL).corrections[0]!.id = "C-0009";
    expect(run("LANG_PARITY", briefInput(world, briefOn(world, BILINGUAL)))).toEqual([]);
  });

  it.each(POSITIONS)("reports a null Chinese title of the finding named at %s", (place, set) => {
    const { world, brief } = fullWorld();
    // Name the finding that is not otherwise named anywhere: the others' titles stay translated.
    findingOf(world, PROOF).title.zh = null;
    for (const [, s] of POSITIONS) s(brief, PROTEIN);
    brief.lead[1]!.finding_ids = [PROTEIN];
    set(brief, PROOF);
    const issues = run("LANG_PARITY", briefInput(world, brief)).filter((i) => i.path === `findings/${PROOF}.json: title.zh`);
    expect(triples(issues), place).toEqual([[
      "LANG_PARITY", `findings/${PROOF}.json: title.zh`,
      `briefs/${MONDAY}.json is in both languages (languages.zh is true), so the title of ${PROOF}, which it names, needs a Chinese string.`,
    ]]);
  });

  it("does not ask for the title of a finding the brief does not name", () => {
    const world = storedWorld();
    findingOf(world, PROOF).title.zh = null;
    expect(findingOf(world, PROOF).title.zh).toBeNull();
    expect(run("LANG_PARITY", briefInput(world, briefOn(world, BILINGUAL)))).toEqual([]);
  });

  it("holds a data-only edition to the title of each finding it names: it is English-only when one is null, which is why SPEC says so", () => {
    const world = storedWorld();
    findingOf(world, LIGHT).title.zh = null;
    const dataOnly = briefOn(world, DATA_ONLY);
    expect(dataOnly.languages.zh).toBe(true);
    expect(triples(run("LANG_PARITY", briefInput(world, dataOnly)))).toEqual([[
      "LANG_PARITY", `findings/${LIGHT}.json: title.zh`,
      `briefs/${DATA_ONLY}.json is in both languages (languages.zh is true), so the title of ${LIGHT}, which it names, needs a Chinese string.`,
    ]]);
    dataOnly.languages.zh = false;
    expect(run("LANG_PARITY", briefInput(world, dataOnly))).toEqual([]);
  });

  it("skips a named finding the run was not given, which XREF reports", () => {
    const world = storedWorld();
    const brief = briefOn(world, BILINGUAL);
    const without = { ...contentOf(world), findings: [] };
    expect(runRules(buildPublishedInput(brief, without, { config: config() }), [ruleOf("LANG_PARITY")])).toEqual([]);
  });
});

describe("LANG_PARITY: the findings a brief first published, and the rung notes it recorded", () => {
  const lightWorld = (): { world: StoredWorld; brief: Brief } => {
    const world = storedWorld();
    return { world, brief: briefOn(world, BILINGUAL) };
  };
  const lines = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.path} ${i.message.replace(/^briefs\/[\d-]+\.json is in both languages \(languages\.zh is true\), so /, "")}`);

  it.each(["found", "matters", "ai_helped", "how_sure", "background", "could_lead"] as const)("reports a null Chinese in explainer.%s of a finding the brief first published", (part) => {
    const { world, brief } = lightWorld();
    const finding = findingOf(world, LIGHT);
    expect(finding.first_brief).toBe(BILINGUAL);
    finding.explainer[part]!.zh = null;
    expect(triples(run("LANG_PARITY", briefInput(world, brief)))).toEqual([[
      "LANG_PARITY", `findings/${LIGHT}.json: explainer.${part}.zh`,
      `briefs/${BILINGUAL}.json is in both languages (languages.zh is true), so the explainer part ${part} of ${LIGHT}, which it first published, needs a Chinese string.`,
    ]]);
  });

  it("passes an explainer part that is null because the finding has no AI role", () => {
    const { world, brief } = lightWorld();
    const finding = findingOf(world, LIGHT);
    finding.ai = { role: "none", confidence: null, systems: [], evidence: [] };
    finding.explainer.ai_helped = null;
    expect(run("LANG_PARITY", briefInput(world, brief))).toEqual([]);
  });

  it("reports a null Chinese in the alt text of a figure of a finding the brief first published, and passes a finding with no figure", () => {
    const { world, brief } = lightWorld();
    findingOf(world, LIGHT).figure!.alt.zh = null;
    expect(lines(run("LANG_PARITY", briefInput(world, brief)))).toEqual([
      `findings/${LIGHT}.json: figure.alt.zh the figure's alt text of ${LIGHT}, which it first published, needs a Chinese string.`,
    ]);
    findingOf(world, LIGHT).figure = null;
    expect(run("LANG_PARITY", briefInput(world, brief))).toEqual([]);
  });

  it("does not ask for the explainer or the figure of a finding an earlier edition first published", () => {
    const { world, brief } = lightWorld();
    const protein = findingOf(world, PROTEIN);
    expect(protein.first_brief).toBe(EN_ONLY);
    for (const part of Object.values(protein.explainer)) if (part !== null) part.zh = null;
    expect(run("LANG_PARITY", briefInput(world, brief))).toEqual([]);
  });

  it("asks for the explainer of a finding the brief first published even when no part of the brief names it", () => {
    const { world, brief } = lightWorld();
    brief.story = null;
    brief.lead = [];
    brief.items = [];
    findingOf(world, LIGHT).explainer.found.zh = null;
    expect(pathsOf(run("LANG_PARITY", briefInput(world, brief)))).toEqual([`findings/${LIGHT}.json: explainer.found.zh`]);
  });

  it("reports a term a first-published finding lists that the glossary holds without Chinese, at the term's index", () => {
    const { world, brief } = lightWorld();
    termOf(world, LATTICE).zh = null;
    expect(triples(run("LANG_PARITY", briefInput(world, brief)))).toEqual([[
      "LANG_PARITY", "glossary.json: terms[0].zh",
      `briefs/${BILINGUAL}.json is in both languages (languages.zh is true), so the term ${LATTICE}, which ${LIGHT} lists and it first published, needs a Chinese form.`,
    ]]);
  });

  it("does not ask for the Chinese of a term an earlier edition first published, of a term no finding lists or one the glossary lacks", () => {
    const { world, brief } = lightWorld();
    termOf(world, ASSISTANT).zh = null;
    expect(termOf(world, ASSISTANT).zh).toBeNull();
    findingOf(world, LIGHT).terms = [LATTICE, "no-such-term"];
    expect(run("LANG_PARITY", briefInput(world, brief))).toEqual([]);
    // A term of the finding the earlier edition published stays English until a bilingual edition names it.
    findingOf(world, PROTEIN).terms = [FOLDING];
    termOf(world, FOLDING).zh = null;
    expect(run("LANG_PARITY", briefInput(world, brief))).toEqual([]);
  });

  it("does not ask for the Chinese of a term hidden for its own name, where the folder's run says which are", () => {
    const world = storedWorld();
    termOf(world, LATTICE).zh = null;
    const hidden = runRules(folderInput(world, { hiddenTerms: new Set([LATTICE]) }), [ruleOf("LANG_PARITY")]);
    expect(hidden).toEqual([]);
    const shown = runRules(folderInput(world, { hiddenTerms: new Set([FOLDING, ASSISTANT]) }), [ruleOf("LANG_PARITY")]);
    expect(pathsOf(shown)).toEqual(["glossary.json: terms[0].zh"]);
    expect(pathsOf(runRules(folderInput(world), [ruleOf("LANG_PARITY")]))).toEqual(["glossary.json: terms[0].zh"]);
  });

  it("reports a null Chinese in a rung note recorded on the brief's date in a finding it names, at the entry's index", () => {
    const world = storedWorld();
    const dataOnly = briefOn(world, DATA_ONLY);
    const light = findingOf(world, LIGHT);
    expect(light.rung_history[1]!.recorded).toBe(DATA_ONLY);
    light.rung_history[1]!.note!.zh = null;
    expect(triples(run("LANG_PARITY", briefInput(world, dataOnly)))).toEqual([[
      "LANG_PARITY", `findings/${LIGHT}.json: rung_history[1].note.zh`,
      `briefs/${DATA_ONLY}.json is in both languages (languages.zh is true), so the rung note of ${LIGHT} recorded on ${DATA_ONLY} needs a Chinese string.`,
    ]]);
  });

  it("does not ask for a rung note recorded on another date, one that is null, or one in a finding the brief does not name", () => {
    const world = storedWorld();
    const light = findingOf(world, LIGHT);
    light.rung_history[1]!.note!.zh = null;
    // Recorded on the data-only date, the note is not asked of the bilingual edition (which names the finding), nor of an edition
    // that does not name it.
    expect(run("LANG_PARITY", briefInput(world, briefOn(world, BILINGUAL)))).toEqual([]);
    const unrelated = briefOf(DATA_ONLY, { edition: "data_only" });
    expect(run("LANG_PARITY", briefInput(world, unrelated))).toEqual([]);
    light.rung_history[1]!.note = null;
    expect(run("LANG_PARITY", briefInput(world, briefOn(world, DATA_ONLY)))).toEqual([]);
  });

  it("never fails an older brief for what a later English-only edition recorded, and holds a later bilingual edition to it", () => {
    const world = storedWorld();
    const light = findingOf(world, LIGHT);
    light.rung_history.push({ rung: "confirmed", date: "2026-11-24", recorded: "2026-11-25", source_id: "s2", by: "agent", note: l("Confirmed by a second lab.") });
    light.updated = "2026-11-25";
    const later = briefOf("2026-11-25", {
      languages: { en: true, zh: false },
      pace: { sentence: l("The Pace."), status: "ok", metrics_file: "metrics/2026-11-25.json" },
      lead: [{ text: l("Lead."), finding_ids: [LIGHT] }],
      rung_changes: [{ finding_id: LIGHT, from: "checked", to: "confirmed", date: "2026-11-24", by: "agent" }],
    });
    world.briefs.push(later);
    expect(run("LANG_PARITY", folderInput(world))).toEqual([]);
    for (const date of [EN_ONLY, BILINGUAL, DATA_ONLY]) expect(run("LANG_PARITY", briefInput(world, briefOn(world, date))), date).toEqual([]);
    later.languages.zh = true;
    later.pace.sentence.zh = "進度。";
    later.lead[0]!.text.zh = "引言。";
    expect(pathsOf(run("LANG_PARITY", folderInput(world)))).toEqual([`findings/${LIGHT}.json: rung_history[2].note.zh`]);
  });
});

describe("LANG_PARITY: the folder's run judges each brief", () => {
  it("holds every bilingual brief of the folder and none of the English-only ones, the one beside a full edition included", () => {
    const world = storedWorld();
    // The English-only edition (EN_ONLY) leaves every zh null and passes; the bilingual ones beside it must not.
    expect(briefOn(world, EN_ONLY).languages.zh).toBe(false);
    expect(briefOn(world, EN_ONLY).pace.sentence.zh).toBeNull();
    expect(run("LANG_PARITY", folderInput(world))).toEqual([]);
    briefOn(world, BILINGUAL).pace.sentence.zh = null;
    briefOn(world, DATA_ONLY).pace.sentence.zh = null;
    briefOn(world, EN_ONLY).pace.sentence.zh = null;
    expect(pathsOf(run("LANG_PARITY", folderInput(world)))).toEqual([`briefs/${BILINGUAL}.json: pace.sentence.zh`, `briefs/${DATA_ONLY}.json: pace.sentence.zh`]);
  });

  it("judges one brief only when it is given one, and none in a run with neither a brief nor a folder", () => {
    const world = storedWorld();
    briefOn(world, BILINGUAL).pace.sentence.zh = null;
    briefOn(world, DATA_ONLY).pace.sentence.zh = null;
    expect(pathsOf(run("LANG_PARITY", briefInput(world, briefOn(world, BILINGUAL))))).toEqual([`briefs/${BILINGUAL}.json: pace.sentence.zh`]);
    const bare = buildPublishedInput(null, contentOf(world), { config: config(), date: DATA_ONLY });
    expect(run("LANG_PARITY", bare)).toEqual([]);
    expect(run("XREF", bare).filter((i) => i.path.startsWith("briefs/"))).toEqual([]);
  });
});

// ── FILE_LAYOUT ──────────────────────────────────────────────────────────────────────────────────

describe("FILE_LAYOUT: only the paths of SPEC §3 under content/", () => {
  const layout = (world: StoredWorld, extra: StoredFile[] = []): ValidationIssue[] =>
    run("FILE_LAYOUT", folderInput(world, { files: [...folderOf(world).files, ...extra] }));

  it("passes every file of the layout, however many briefs and findings there are", () => {
    expect(layout(storedWorld())).toEqual([]);
    expect(layout(addMonday(addSunday(storedWorld())))).toEqual([]);
  });

  it("reports a path outside the layout at its (file), saying what the layout holds", () => {
    const stray = ["README.md", "notes.txt", "briefs/extra/x.json", "findings/sub/x.json", "state/other.json", "state/pace-weekly.json.bak", "metrics/inputs/x/y.json", "constructor", "state/__proto__"];
    const issues = layout(storedWorld(), stray.map((p) => fileEntry(p, { parsed: false })));
    expect(pathsOf(issues)).toEqual(stray.map((p) => `${p}: (file)`).sort(comparePaths));
    for (const issue of issues) {
      expect(issue.code).toBe("FILE_LAYOUT");
      expect(issue.severity).toBe("error");
      expect(issue.message).toBe(`${issue.path.slice(0, -": (file)".length)} is outside content/'s layout (briefs/, findings/, metrics/, metrics/inputs/, status/, state/pace-weekly.json, glossary.json, corrections.json, reports.json and archive-index.json).`);
      expect(issue.hint).toBe("Delete it or move it out of the content folder; publish never stages it.");
    }
  });

  it("reports a dated file whose name is not a real date, in each dated folder", () => {
    const names = ["briefs/latest.json", "briefs/2026-13-45.json", "metrics/2026-02-30.json", "metrics/inputs/draft.json", "status/2026-11-24.json.tmp"];
    const issues = layout(storedWorld(), names.map((p) => fileEntry(p, { parsed: false })));
    expect(triples(issues)).toEqual(names.map((p) => `${p}: (file)`).sort(comparePaths).map((path) => {
      const p = path.slice(0, -": (file)".length);
      return ["FILE_LAYOUT", path, `${p} must be named YYYY-MM-DD.json with a real calendar date.`];
    }));
    expect(issues.map((i) => i.hint)).toEqual(names.map(() => "Rename it to the date of its edition, or delete it."));
  });

  it("reports a file in findings/ that is not named by a finding id", () => {
    const issues = layout(storedWorld(), [fileEntry("findings/odd.json", { parsed: false }), fileEntry("findings/MATH-2026-0142.json", { parsed: false })]);
    expect(triples(issues)).toEqual([
      ["FILE_LAYOUT", "findings/MATH-2026-0142.json: (file)", "findings/MATH-2026-0142.json must be named by the finding's id, such as math-2026-0142.json."],
      ["FILE_LAYOUT", "findings/odd.json: (file)", "findings/odd.json must be named by the finding's id, such as math-2026-0142.json."],
    ]);
    expect(issues[0]!.hint).toBe("Rename it to the id the finding holds, or delete it.");
  });

  it("reports a finding file named by an id other than the one it holds, at its id", () => {
    const world = storedWorld();
    const files = folderOf(world).files.map((f) => (f.path === `findings/${PROOF}.json` ? { ...f, id: "math-2026-0778" } : f));
    const issues = run("FILE_LAYOUT", folderInput(world, { files }));
    expect(triples(issues)).toEqual([[
      "FILE_LAYOUT", `findings/${PROOF}.json: id`, `findings/${PROOF}.json holds the finding math-2026-0778, so it must be named math-2026-0778.json.`,
    ]]);
    expect(issues[0]!.hint).toBe("A finding's file is named by the id it holds.");
  });

  it("does not compare the name of a finding file that did not parse, or of a file of another kind, with an id", () => {
    const world = storedWorld();
    const files = folderOf(world).files.map((f) => (f.path === `findings/${PROOF}.json` ? { ...f, parsed: false, id: null } : { ...f, id: f.path.startsWith("findings/") ? f.id : "x-2026-0001" }));
    expect(run("FILE_LAYOUT", folderInput(world, { files }))).toEqual([]);
  });

  it("reports a link, a special file or a folder that could not be read at its (file), whatever its name", () => {
    const issues = layout(storedWorld(), [
      fileEntry("linked.json", { regular: false, parsed: false }),
      fileEntry("briefs/2026-11-21.json", { regular: false, parsed: false }),
      fileEntry("findings/math-2026-0777.json", { regular: false, parsed: false }),
    ]);
    expect(triples(issues)).toEqual([
      ["FILE_LAYOUT", "briefs/2026-11-21.json: (file)", "briefs/2026-11-21.json is a link, a special file or a folder that could not be read, not a file of content/."],
      ["FILE_LAYOUT", "findings/math-2026-0777.json: (file)", "findings/math-2026-0777.json is a link, a special file or a folder that could not be read, not a file of content/."],
      ["FILE_LAYOUT", "linked.json: (file)", "linked.json is a link, a special file or a folder that could not be read, not a file of content/."],
    ]);
    expect(issues[0]!.hint).toBe("Delete it; content/ holds regular files only.");
  });

  it("reports each problem of a path once, and nothing in a run with no folder or an empty one", () => {
    const world = storedWorld();
    expect(run("FILE_LAYOUT", briefInput(world, briefOn(world, BILINGUAL)))).toEqual([]);
    expect(run("FILE_LAYOUT", folderInput(world, { files: [] }))).toEqual([]);
    const issues = layout(world, [fileEntry("README.md", { parsed: false }), fileEntry("README.md", { parsed: false })]);
    expect(issues).toHaveLength(1);
  });

  it("is not read as an issue of a file that is in the layout and unreadable: that is SCHEMA's, from the reader", () => {
    const world = storedWorld();
    const files = folderOf(world).files.map((f) => (f.path === "glossary.json" ? { ...f, parsed: false } : f));
    expect(run("FILE_LAYOUT", folderInput(world, { files }))).toEqual([]);
  });
});

// ── The engine's own checks of the three rules' output ───────────────────────────────────────────

describe("the rules in the engine", () => {
  it("report only the codes they declare: no RULE_ERROR on any broken world below", () => {
    const world = storedWorld();
    world.findings[0]!.related = [MISSING];
    briefOn(world, BILINGUAL).pace.sentence.zh = null;
    const issues = runRules(folderInput(world, { files: [...folderOf(world).files, fileEntry("README.md", { parsed: false })] }), publishedRules);
    expect(new Set(issues.map((i) => i.code))).toEqual(new Set(["XREF", "LANG_PARITY", "FILE_LAYOUT"]));
  });

  it("do not turn into warnings for a record that is not being published: the codes are no safety codes", () => {
    const world = storedWorld();
    world.findings[0]!.related = [MISSING];
    const issues = runRules(buildPublishedInput(null, contentOf(world), { config: config(), date: DATA_ONLY, publishing: "2026-12-31" }), publishedRules);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
    expect(error("XREF", "x", "m").severity).toBe("error");
  });
});
