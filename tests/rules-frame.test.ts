// The validator frame's smaller parts (SPEC §4.12): the issue helpers and paths (lib/rules/types.ts), the helpers the rule
// groups share (shared.ts), the engine's inputs and `runRules()` (run.ts), and the registry with its table of every code, which
// is held to SPEC.md's own table and to what the rules declare (index.ts). The rules here are stubs, written in the tests: no
// group's rule is judged.
//
// New for this project; Cyber's tests/validate.test.ts exercised these through its own rules, which the groups' tests now do.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { draftFilings } from "@/lib/items";
import { ID_PATTERNS } from "@/lib/schema/common";
import { Correction, type Evidence } from "@/lib/schema/misc";
import { normalizeUrl } from "@/lib/urls";
import {
  RULES, RULE_CODE_TABLE, RULE_GROUPS, RULE_GROUP_NAMES, codeInfo, codesOfGroup, ruleCodes, uncoveredCodes,
  type RuleGroup, type RuleGroupName,
} from "@/lib/rules";
import { RULE_GROUPS as GROUPS_FROM_INDEX } from "@/lib/rules/index";
import {
  ARCHIVE_WARNING_CODES, ENGINE_CODES, beingPublishedOf, buildDraftInput, buildPublishedInput, comparePaths, runRules, sortIssues,
  type DraftInputs,
} from "@/lib/rules/run";
import {
  SHORT_WEEK, citations, draftRungEntries, editionKindOf, evidenceOf, extendPath, inEvidence, isBrief, isDraft, isLandmarkText,
  isMondayEdition, isNewRef, isPublished, isZh, lacksInput, newFindings, onlyPublishing, packDatesOf, pageProseOf, publishingFindings,
  resolveSource, seenText, shownDepthOf, shownFindings, shownItems, sourceContainers, stringsAbout, stringsOf,
} from "@/lib/rules/shared";
import { pageProse } from "@/lib/rules/strings";
import {
  defineRule, error, formatPath, list, plural, warning, type DraftInput, type PublishedInput, type Rule, type RuleInput, type RuleMode,
  type RuleNeed, type ValidationIssue,
} from "@/lib/rules/types";
import * as groundingModule from "@/lib/rules/grounding";
import * as historyModule from "@/lib/rules/history";
import * as ladderAiModule from "@/lib/rules/ladder-ai";
import * as publishedModule from "@/lib/rules/published";
import * as safetyModule from "@/lib/rules/safety";
import * as sourcesModule from "@/lib/rules/sources";
import * as structureModule from "@/lib/rules/structure";
import * as wordsModule from "@/lib/rules/words";
import * as zhModule from "@/lib/rules/zh";
import {
  D, deepFreeze, draftInputs, l, mondayContext, pack, storedWorld, sundayContext, weekdayContext, weekdayDraft,
} from "./helpers/rule-world";

const ALL_MODES: readonly RuleMode[] = ["draft", "published", "zh"];

const draftInput = (over: Partial<DraftInputs> = {}, draft = weekdayDraft()): DraftInput => buildDraftInput(draft, { ...draftInputs(), ...over });
const publishedInput = (publishing: string | null = D, world = storedWorld()): PublishedInput =>
  buildPublishedInput(world.brief, world, { config: world.config, publishing });

/** A Chinese-mode input for the engine's tests: it reads only the mode, the date and the evidence of the Chinese side. */
const zhInput = (evidence: Evidence | null): RuleInput =>
  ({ ...draftInput(), mode: "zh", zh: { draft: {}, context: {}, english: weekdayDraft(), evidence } }) as unknown as RuleInput;

const stub = (
  code: string | [string, ...string[]], check: Rule["check"] = () => [],
  over: { scope?: [RuleMode, ...RuleMode[]]; needs?: RuleNeed[]; uses?: RuleNeed[] } = {},
): Rule =>
  defineRule({
    code, scope: over.scope ?? ["draft", "published", "zh"], check,
    ...(over.needs === undefined ? {} : { needs: over.needs }), ...(over.uses === undefined ? {} : { uses: over.uses }),
  });

// ── Issues, paths and rules ──────────────────────────────────────────────────────────────────────

describe("error(), warning(), list() and plural()", () => {
  it("builds an issue with a severity, a path, a message and a hint that is null unless given", () => {
    expect(error("WORDS", "title", "Too long.")).toEqual({ code: "WORDS", severity: "error", path: "title", message: "Too long.", hint: null });
    expect(warning("WORDS", "title", "Long.", "Cut it.")).toEqual({ code: "WORDS", severity: "warning", path: "title", message: "Long.", hint: "Cut it." });
  });

  it("joins a list with commas and counts with the right plural", () => {
    expect(list([])).toBe("");
    expect(list(["a"])).toBe("a");
    expect(list(["a", "b", "c"])).toBe("a, b, c");
    expect(plural(0, "word")).toBe("0 words");
    expect(plural(1, "word")).toBe("1 word");
    expect(plural(2, "word")).toBe("2 words");
    expect(plural(1, "check")).toBe("1 check");
    expect(plural(2, "entry", "entries")).toBe("2 entries");
    expect(plural(1, "entry", "entries")).toBe("1 entry");
  });
});

describe("formatPath()", () => {
  it.each([
    [[], "(root)"],
    [["date"], "date"],
    [["items", 3, "summary"], "items[3].summary"],
    [[3], "[3]"],
    [["a", 0, 1, "b"], "a[0][1].b"],
    [["_private", "a1"], "_private.a1"],
    [["new.new-1.title"], '["new.new-1.title"]'],
    [["strings", "lead.0"], 'strings["lead.0"]'],
    [["terms", "protein-folding", "zh"], 'terms["protein-folding"].zh'],
    [["0"], '["0"]'],
    [["1a"], '["1a"]'],
    [["has space"], '["has space"]'],
    [["say \"hi\""], '["say \\"hi\\""]'],
    [["a", ""], 'a[""]'],
  ] as [PropertyKey[], string][])("writes %j as %s", (segments, written) => {
    expect(formatPath(segments)).toBe(written);
  });

  it("writes a symbol key in brackets, as its description", () => {
    expect(formatPath(["a", Symbol("x")])).toBe('a["Symbol(x)"]');
  });
});

describe("defineRule()", () => {
  const check = (): ValidationIssue[] => [];

  it("fills in an error severity, no needs, no uses and a list of codes and modes", () => {
    const rule = defineRule({ code: "COUNTS", scope: "draft", check });
    expect(rule).toEqual({ codes: ["COUNTS"], severity: "error", scope: ["draft"], needs: [], uses: [], check });
  });

  it("takes several codes and modes, a severity, needs and uses, and copies the lists it is given", () => {
    const codes: [string, ...string[]] = ["WORDS", "SENTENCE_LENGTH"];
    const scope: [RuleMode, ...RuleMode[]] = ["draft", "published"];
    const needs: RuleNeed[] = ["evidence"];
    const uses: RuleNeed[] = ["pack", "metrics"];
    const rule = defineRule({ code: codes, severity: "warning", scope, needs, uses, check });
    expect(rule).toEqual({ codes: ["WORDS", "SENTENCE_LENGTH"], severity: "warning", scope: ["draft", "published"], needs: ["evidence"], uses: ["pack", "metrics"], check });
    expect(rule.codes).not.toBe(codes);
    expect(rule.scope).not.toBe(scope);
    expect(rule.needs).not.toBe(needs);
    expect(rule.uses).not.toBe(uses);
  });
});

// ── The shared helpers ───────────────────────────────────────────────────────────────────────────

describe("editionKindOf(): which kind of edition the rules judge", () => {
  it.each([
    [{ format: null }, "none"],
    [{ format: null, dataOnly: true }, "none"],
    [{ format: "daily" }, "weekday"],
    [{ format: "daily", dataOnly: false }, "weekday"],
    [{ format: "daily", dataOnly: true }, "data-only"],
    [{ format: "monday_review", dataOnly: true }, "data-only"],
    [{ format: "sunday_deep_dive" }, "sunday"],
    [{ format: "sunday_deep_dive", dataOnly: true }, "data-only"],
    [{ format: "monday_review" }, "monday"],
    [{ format: "monday_review", weekFindings: null }, "monday"],
    [{ format: "monday_review", weekFindings: 3 }, "monday"],
    [{ format: "monday_review", weekFindings: 9 }, "monday"],
    [{ format: "monday_review", weekFindings: 2 }, "short-monday"],
    [{ format: "monday_review", weekFindings: 0 }, "short-monday"],
    [{ format: "daily", weekFindings: 0 }, "weekday"],
  ] as const)("reads %j as %s", (args, kind) => {
    expect(editionKindOf(args)).toBe(kind);
  });

  it("knows the short week is one of fewer than 3 findings, and which editions carry a review", () => {
    expect(SHORT_WEEK).toBe(3);
    expect(isMondayEdition("monday")).toBe(true);
    expect(isMondayEdition("short-monday")).toBe(true);
    for (const kind of ["weekday", "sunday", "data-only", "none"] as const) expect(isMondayEdition(kind)).toBe(false);
  });
});

describe("the guards and small tests", () => {
  it("tells a stored brief from a draft by the keys a draft never has", () => {
    const world = storedWorld();
    expect(isBrief(world.brief)).toBe(true);
    expect(isBrief(weekdayDraft())).toBe(false);
    expect(isBrief({ edition: "full" })).toBe(false);
    expect(isBrief({ computed: {} })).toBe(false);
    expect(isBrief({ edition: "full", computed: {} })).toBe(true);
    for (const value of [null, undefined, "edition", 5, [], true]) expect(isBrief(value)).toBe(false);
  });

  it("narrows an input by its mode", () => {
    const inputs: [RuleInput, boolean, boolean, boolean][] = [
      [draftInput(), true, false, false], [publishedInput(), false, true, false], [zhInput(null), false, false, true],
    ];
    for (const [input, d, p, z] of inputs) expect([isDraft(input), isPublished(input), isZh(input)]).toEqual([d, p, z]);
  });

  it("knows a new finding's ref from an id", () => {
    expect(isNewRef("new-1")).toBe(true);
    expect(isNewRef("new-12")).toBe(true);
    for (const key of ["math-2026-0002", "new-", "new-0", "new-x", "xnew-1", "new-1x", ""]) expect(isNewRef(key), key).toBe(false);
  });

  it("appends a path to a path, with a dot or a bracket as the next part needs", () => {
    expect(extendPath("returning[0]", "source_ids", 1)).toBe("returning[0].source_ids[1]");
    expect(extendPath("returning[0]", 2)).toBe("returning[0][2]");
    expect(extendPath("lead", "text")).toBe("lead.text");
    expect(extendPath("(root)", "date")).toBe("date");
    expect(extendPath("(root)", 3, "a")).toBe("[3].a");
    expect(extendPath("findings/x.json: sources[0]", "url")).toBe("findings/x.json: sources[0].url");
    expect(extendPath("new_findings[0]", "terms", "protein-folding")).toBe('new_findings[0].terms["protein-folding"]');
    expect(extendPath("a")).toBe("a");
    expect(extendPath("(root)")).toBe("(root)");
  });
});

describe("the findings a run shows", () => {
  const input = draftInput();
  const { views } = input;

  it("lists the story and then the items, new findings and returning ones alike", () => {
    expect(shownItems(views).map((i) => [i.slot, i.key, i.new, i.index])).toEqual([
      ["story", "new-1", true, null], ["item", "new-2", true, 0], ["item", "math-2026-0002", false, 1],
    ]);
    expect(shownFindings(views).map((f) => f.key)).toEqual(["new-1", "new-2", "math-2026-0002"]);
    expect(newFindings(views).map((f) => f.key)).toEqual(["new-1", "new-2"]);
  });

  it("lists items alone when there is no story, a finding the context does not know as an unknown view", () => {
    const draft = weekdayDraft();
    draft.items = ["new-2", "math-2026-0099"];
    draft.story = null;
    draft.lead = [];
    draft.new_findings = draft.new_findings.slice(1);
    const sparse = draftInput({}, draft).views;
    expect(shownItems(sparse).map((i) => [i.slot, i.key])).toEqual([["item", "new-2"], ["item", "math-2026-0099"]]);
    expect(shownFindings(sparse).map((f) => [f.key, f.known, f.detail])).toEqual([["new-2", true, "full"], ["math-2026-0099", false, "partial"]]);
  });

  it("says how the page shows a finding that is new, and nothing of any other", () => {
    const depth = shownDepthOf(views);
    expect(["new-1", "new-2", "math-2026-0002", "phys-2026-0003", "nope"].map(depth)).toEqual(["story", "item", null, null, null]);
    const stored = shownDepthOf(publishedInput().views);
    expect(["bio-2026-0001", "math-2026-0002", "phys-2026-0003"].map(stored)).toEqual(["story", "item", null]);
  });

  it("lists the rung entries a draft adds to a stored finding, the returning entry's before the rung changes'", () => {
    expect(draftRungEntries(views, "math-2026-0002").map((r) => [r.rung, r.where])).toEqual([["checked", "returning[0].rung"]]);
    expect(draftRungEntries(views, "phys-2026-0003").map((r) => [r.rung, r.where])).toEqual([["disputed", "rung_changes[0].rung"]]);
    expect(draftRungEntries(views, "new-1")).toEqual([]);
    const draft = weekdayDraft();
    draft.rung_changes.push({ finding_id: "math-2026-0002", rung: { rung: "confirmed", date: "2026-11-23", source_id: "b2", note: null } });
    expect(draftRungEntries(draftInput({}, draft).views, "math-2026-0002").map((r) => r.rung)).toEqual(["checked", "confirmed"]);
    expect(draftRungEntries(publishedInput().views, "bio-2026-0001")).toEqual([]);
  });

  it("lists the findings being judged against config/: new ones in a draft, stored ones being published in published mode", () => {
    expect(publishingFindings(views).map((f) => f.key)).toEqual(["new-1", "new-2"]);
    expect(publishingFindings(publishedInput(D).views).map((f) => f.key)).toEqual(["bio-2026-0001", "math-2026-0002"]);
    expect(publishingFindings(publishedInput(null).views)).toEqual([]);
    expect(publishingFindings(publishedInput("2026-11-10").views).map((f) => f.key)).toEqual(["phys-2026-0003"]);
  });
});

describe("source containers and citations", () => {
  it("lists a draft's containers: each new finding's own sources, then the brief's", () => {
    const containers = sourceContainers(draftInput().views);
    expect(containers.map((c) => [c.scope, c.prefix, c.owner?.key ?? null, c.sources?.length, c.where])).toEqual([
      ["finding", "s", "new-1", 2, "new_findings[0].sources"],
      ["finding", "s", "new-2", 1, "new_findings[1].sources"],
      ["brief", "b", null, 3, "sources"],
    ]);
  });

  it("lists a stored edition's: each stored finding's own sources, then the brief's", () => {
    const containers = sourceContainers(publishedInput().views);
    expect(containers.map((c) => [c.scope, c.prefix, c.owner?.key ?? null, c.sources?.length, c.where])).toEqual([
      ["finding", "s", "bio-2026-0001", 2, "findings/bio-2026-0001.json: sources"],
      ["finding", "s", "math-2026-0002", 2, "findings/math-2026-0002.json: sources"],
      ["finding", "s", "phys-2026-0003", 2, "findings/phys-2026-0003.json: sources"],
      ["brief", "b", null, 2, "briefs/2026-11-24.json: sources"],
    ]);
  });

  it("lists every citation of a draft in a fixed order, with the container each id must be found in", () => {
    expect(citations(draftInput().views).map((c) => [c.id, c.path, c.role, c.owner?.key ?? null, c.form])).toEqual([
      ["s1", "new_findings[0].go_deeper[0]", "go_deeper", "new-1", "finding"],
      ["s1", "new_findings[0].rung_history[0].source_id", "rung", "new-1", "finding"],
      ["s1", "new_findings[0].ai.evidence[0].source_id", "evidence", "new-1", "finding"],
      ["s2", "new_findings[0].reactions[0].source_id", "reaction", "new-1", "finding"],
      ["s1", "new_findings[1].go_deeper[0]", "go_deeper", "new-2", "finding"],
      ["s1", "new_findings[1].rung_history[0].source_id", "rung", "new-2", "finding"],
      ["b1", "returning[0].source_ids[0]", "returning", "math-2026-0002", "either"],
      ["b1", "returning[0].rung.source_id", "rung", "math-2026-0002", "either"],
      ["b2", "rung_changes[0].rung.source_id", "rung_change", "phys-2026-0003", "either"],
      ["b2", "ideas[0].source_id", "idea", null, "brief"],
      ["b3", "also[0].source_id", "also", null, "brief"],
    ]);
  });

  it("lists those of a stored edition, a finding's Since then and its rung entries included", () => {
    const got = citations(publishedInput().views).map((c) => `${c.role} ${c.owner?.key ?? "-"} ${c.path.replace(/^[^:]*: /, "")}`);
    expect(got.slice(0, 6)).toEqual([
      "go_deeper bio-2026-0001 go_deeper[0]", "rung bio-2026-0001 rung_history[0].source_id", "rung bio-2026-0001 rung_history[1].source_id",
      "evidence bio-2026-0001 ai.evidence[0].source_id", "reaction bio-2026-0001 reactions[0].source_id", "since_then bio-2026-0001 since_then[0].source_ids[0]",
    ]);
    expect(got.slice(-2)).toEqual(["idea - ideas[0].source_id", "also - also[0].source_id"]);
    expect(got).toHaveLength(6 * 3 + 2);
  });

  it("lists a figure's, the deep dive's and the strongest evidence against's citations", () => {
    const draft = weekdayDraft();
    draft.deep_dive = { finding_id: "bio-2024-0007", text: "A made-up deep dive.", source_ids: ["b1", "b3"], why_today: "anniversary" };
    draft.review = {
      big_picture: "This week.", remarkable: null, strongest_against: { text: "One fell.", finding_ids: ["phys-2026-0003"], source_ids: ["b2"] },
    };
    draft.new_findings[0]!.figure = {
      source_id: "s2", image_url: "https://example.org/figure.png", licence: "CC-BY-4.0", licence_quote: "Licensed under CC BY 4.0.", credit: "A. Artist", alt: "A made-up figure.",
    };
    const got = citations(draftInput({}, draft).views);
    const pick = (role: string) => got.filter((c) => c.role === role).map((c) => [c.id, c.path, c.form]);
    expect(pick("figure")).toEqual([["s2", "new_findings[0].figure.source_id", "finding"]]);
    expect(pick("deep_dive")).toEqual([["b1", "deep_dive.source_ids[0]", "brief"], ["b3", "deep_dive.source_ids[1]", "brief"]]);
    expect(pick("against")).toEqual([["b2", "review.strongest_against.source_ids[0]", "brief"]]);
  });

  it("finds the source an id names: a b id in the brief's, an s id in its owner's, and says when the owner's are not known", () => {
    const { views } = draftInput();
    const owner = views.find("new-1")!;
    expect(resolveSource(views, owner, "s1")).toMatchObject({ known: true, source: { id: "s1", url: "https://example.org/paper/1" } });
    expect(resolveSource(views, owner, "s2")).toMatchObject({ known: true, source: { id: "s2" } });
    expect(resolveSource(views, owner, "s9")).toEqual({ source: null, known: true });
    expect(resolveSource(views, owner, "x1")).toEqual({ source: null, known: true });
    expect(resolveSource(views, null, "s1")).toEqual({ source: null, known: true });
    // a b id is the brief's whoever asks, even when the owner holds a source of that id
    expect(resolveSource(views, owner, "b2")).toMatchObject({ known: true, source: { id: "b2", url: "https://example.org/statement/2" } });
    expect(resolveSource(views, null, "b1")).toMatchObject({ known: true, source: { id: "b1" } });
    expect(resolveSource(views, owner, "b9")).toEqual({ source: null, known: true });
    // a stored finding the context shows only in part has no sources to look in
    const partial = views.find("phys-2026-0003")!;
    expect(partial.sources).toBeNull();
    expect(resolveSource(views, partial, "s1")).toEqual({ source: null, known: false });
    expect(resolveSource(views, partial, "b1")).toMatchObject({ known: true, source: { id: "b1" } });
    // one the context shows in full has them
    expect(resolveSource(views, views.find("math-2026-0002")!, "s1")).toMatchObject({ known: true, source: { id: "s1", url: "https://example.org/preprint/1" } });
  });
});

describe("the run's evidence and pack", () => {
  const URL_1 = "https://example.org/paper/1";

  it("gives the evidence of a draft, of the Chinese pass, and none for a stored record", () => {
    const withEvidence = draftInput();
    expect(evidenceOf(withEvidence)).toBe(withEvidence.draft.evidence);
    expect(evidenceOf(withEvidence)).not.toBeNull();
    expect(evidenceOf(draftInput({ evidence: null }))).toBeNull();
    expect(evidenceOf(draftInput({ evidence: undefined }))).toBeNull();
    expect(evidenceOf(publishedInput())).toBeNull();
    const evidence = draftInputs().evidence;
    expect(evidenceOf(zhInput(evidence))).toBe(evidence);
    expect(evidenceOf(zhInput(null))).toBeNull();
  });

  it("reads the text the run saw at a URL, by its normal form, and nothing for a URL it did not see", () => {
    const input = draftInput();
    expect(seenText(input, URL_1)).toBe(`Page text of ${URL_1}. the system solved it.`);
    expect(seenText(input, "http://www.Example.org/paper/1/?utm_source=x#top")).toBe(`Page text of ${URL_1}. the system solved it.`);
    expect(seenText(input, "https://example.org/paper/9")).toBe("");
    expect(seenText(draftInput({ evidence: null }), URL_1)).toBe("");
    expect(seenText(publishedInput(), URL_1)).toBe("");
    expect(seenText(zhInput(draftInputs().evidence), URL_1)).toContain("Page text");
  });

  it("reads an own property only, and only a string", () => {
    const inherited = Object.create({ [normalizeUrl(URL_1)]: "from the prototype" }) as Record<string, string>;
    const base = draftInputs().evidence;
    const make = (texts: unknown): DraftInput => draftInput({ evidence: { ...base, texts: texts as Record<string, string> } });
    expect(seenText(make(inherited), URL_1)).toBe("");
    expect(seenText(make({ [normalizeUrl(URL_1)]: 5 }), URL_1)).toBe("");
    expect(seenText(make({ [normalizeUrl(URL_1)]: "fine" }), URL_1)).toBe("fine");
    expect(seenText(make({}), "constructor")).toBe("");
    expect(seenText(make({}), "__proto__")).toBe("");
  });

  it("says whether the evidence lists a URL, by its normal form", () => {
    const input = draftInput();
    expect(inEvidence(input, URL_1)).toBe(true);
    expect(inEvidence(input, "https://WWW.example.org/paper/1/#x")).toBe(true);
    expect(inEvidence(input, "https://example.org/paper/9")).toBe(false);
    expect(inEvidence(draftInput({ evidence: null }), URL_1)).toBe(false);
    expect(inEvidence(publishedInput(), URL_1)).toBe(false);
    const listed = draftInputs().evidence;
    expect(inEvidence(draftInput({ evidence: { ...listed, urls: ["https://EXAMPLE.org/other/?utm_medium=x"] } }), "https://example.org/other")).toBe(true);
  });

  it("dates each candidate of the pack by its URL, in a map with no inherited keys", () => {
    const dates = packDatesOf(pack());
    expect([...dates]).toEqual([[URL_1, "2026-11-23T09:00:00+08:00"]]);
    expect(dates.get("constructor")).toBeUndefined();
    expect(packDatesOf({ candidates: [] }).size).toBe(0);
    const two = pack();
    two.candidates.push({ ...two.candidates[0]!, id: "cand-02", url: "https://www.Example.org/other/#x", published_at: "2026-11-22T09:00:00+08:00" });
    expect([...packDatesOf(two).keys()]).toEqual([URL_1, "https://example.org/other"]);
  });
});

describe("the strings of a finding and of the brief about it", () => {
  const input = draftInput();

  it("lists a finding's own strings, and the brief-level strings about it", () => {
    const own = stringsOf(input, "new-1");
    expect(own.length).toBeGreaterThan(20);
    expect(own.every((e) => e.finding === "new-1")).toBe(true);
    expect(own).toEqual(input.inventory.entries.filter((e) => e.path.startsWith("new_findings[0]")));
    expect(stringsOf(input, "nope")).toEqual([]);
    expect(stringsOf(input, "math-2026-0002")).toEqual([]);
    expect(stringsAbout(input, "math-2026-0002").map((e) => e.path)).toEqual([
      "returning[0].update", "returning[0].rung.rung", "returning[0].rung.date", "returning[0].rung.source_id", "returning[0].rung.note", "corrections[0].after",
    ]);
    expect(stringsAbout(input, "new-1")).toEqual([]);
    const stored = publishedInput();
    expect(stringsOf(stored, "bio-2026-0001").every((e) => e.record.type === "finding")).toBe(true);
    // a stored correction is about a finding by its `after` alone, as in a draft: its `before`, reason and the rest are no one's text
    expect(stringsAbout(stored, "phys-2026-0003").map((e) => e.path)).toEqual([
      `briefs/${D}.json: items[1].update.en`, `briefs/${D}.json: items[1].update.zh`, "corrections.json: corrections[1].after.en",
    ]);
  });

  it("keeps the entries of the records being judged against config/", () => {
    const entries = publishedInput(D).inventory.entries;
    const mine = onlyPublishing(entries);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(entries.length);
    expect(mine.every((e) => e.publishing)).toBe(true);
    expect(mine.some((e) => e.finding === "bio-2026-0001")).toBe(true);
    expect(mine.some((e) => e.finding === "phys-2026-0003")).toBe(false);
    expect(onlyPublishing(publishedInput(null).inventory.entries)).toEqual([]);
    expect(onlyPublishing(input.inventory.entries)).toEqual(input.inventory.entries);
    expect(onlyPublishing([])).toEqual([]);
  });

  it("gives the page prose of an input with the depth each new finding has", () => {
    expect(pageProseOf(input)).toEqual(pageProse(input.inventory, shownDepthOf(input.views)));
    const stored = publishedInput();
    expect(pageProseOf(stored)).toEqual(pageProse(stored.inventory, shownDepthOf(stored.views)));
    expect(pageProseOf(input).map((e) => e.path)).toContain("new_findings[0].explainer.could_lead");
    expect(pageProseOf(input).map((e) => e.path)).not.toContain("new_findings[1].explainer.could_lead");
  });

  it("asks whether a string is a Landmark's text on the date it is filed on", () => {
    const entry = (i: RuleInput, p: string) => i.inventory.entries.find((e) => e.path === p)!;
    // the draft refiles math-2026-0002 as a Landmark, dated D: its returning update is a Landmark's text
    expect(isLandmarkText(input.views, entry(input, "returning[0].update"))).toBe(true);
    expect(isLandmarkText(input.views, entry(input, "new_findings[0].explainer.found"))).toBe(false);
    expect(isLandmarkText(input.views, entry(input, "lead[0].text"))).toBe(false);
    expect(isLandmarkText(input.views, entry(input, "ideas[0].text"))).toBe(false);

    // a stored Landmark that a correction dated D lowers: its own text is as first published, a returning update is filed on D
    const world = storedWorld();
    world.findings[0]!.significance = "landmark";
    world.findings[0]!.rung_history[0]!.note = l("Posted early.");
    world.corrections.push(Correction.parse({
      id: "C-0003", date: D, finding_id: "bio-2026-0001", edition_date: null, term_id: null, type: "correction", path: "significance",
      before: l("landmark"), after: l("major"), reason: l("Too high."), source_url: null, trigger: "editor", report_id: null,
    }));
    world.brief.story = { finding_id: "bio-2026-0001", new: false, update: l("A story update.") };
    const stored = publishedInput(D, world);
    const at = (p: string) => entry(stored, p);
    expect(isLandmarkText(stored.views, at("findings/bio-2026-0001.json: explainer.found.en"))).toBe(true);
    expect(isLandmarkText(stored.views, at(`briefs/${D}.json: story.update.en`))).toBe(false);
    expect(isLandmarkText(stored.views, at("findings/bio-2026-0001.json: rung_history[0].note.en"))).toBe(true);
    expect(isLandmarkText(stored.views, at("findings/bio-2026-0001.json: rung_history[1].note.en"))).toBe(false);
    expect(isLandmarkText(stored.views, at(`briefs/${D}.json: lead[0].text.en`))).toBe(false);
    expect(isLandmarkText(stored.views, at("findings/phys-2026-0003.json: explainer.found.en"))).toBe(false);
    // a string about a finding no view has is no one's
    const orphan = { ...entry(input, "returning[0].update"), about: "nope-2026-0001" };
    expect(isLandmarkText(input.views, orphan)).toBe(false);
  });
});

// ── The inputs the engine builds ─────────────────────────────────────────────────────────────────

describe("buildDraftInput()", () => {
  it("reads D from the context, files the draft's corrections as dated D with ids counted on from C-0001, and carries its inputs", () => {
    const inputs = draftInputs();
    const draft = weekdayDraft();
    const input = buildDraftInput(draft, inputs);
    expect(input.mode).toBe("draft");
    expect(input.date).toBe(D);
    expect(input.fileDate).toBeNull();
    expect(input.edition).toBe("weekday");
    expect(input.format).toBe("daily");
    expect(input.config).toBe(inputs.config);
    expect(input.filing.map((f) => [f.id, f.date, f.finding_id, f.type, f.path, f.after])).toEqual([
      ["C-0001", D, "math-2026-0002", "correction", "significance", { en: "landmark" }],
      ["C-0002", D, "phys-2026-0003", "correction", "field", { en: "chemistry" }],
      ["C-0003", D, "phys-2026-0003", "correction", "subfield", { en: "catalysis" }],
    ]);
    expect(input.filing).toEqual(draftFilings(draft.corrections, [], D));
    expect(input.draft.brief).toBe(draft);
    expect(input.draft.context).toBe(inputs.context);
    expect(input.draft.evidence).toBe(inputs.evidence);
    expect(input.draft.metrics).toBe(inputs.metrics);
    expect(input.draft.pack).toBe(inputs.pack);
    // views and inventory are built from them
    expect(input.views.find("math-2026-0002")!.latest.significance).toBe("landmark");
    expect(input.views.find("math-2026-0002")!.published.significance).toBe("notable");
    expect(input.views.find("phys-2026-0003")!.latest).toMatchObject({ field: "chemistry", subfield: "catalysis" });
    expect(input.inventory.unclassified).toEqual([]);
    expect(input.inventory.entries.some((e) => e.path === "new_findings[0].explainer.found")).toBe(true);
  });

  it("takes an absent or null evidence, metrics and pack as null, and a file date as given", () => {
    const { context, config } = draftInputs();
    const bare = buildDraftInput(weekdayDraft(), { context, config });
    expect([bare.draft.evidence, bare.draft.metrics, bare.draft.pack, bare.fileDate]).toEqual([null, null, null, null]);
    const nulls = buildDraftInput(weekdayDraft(), { context, config, evidence: null, metrics: null, pack: null, fileDate: "2026-11-24" });
    expect([nulls.draft.evidence, nulls.draft.metrics, nulls.draft.pack, nulls.fileDate]).toEqual([null, null, null, "2026-11-24"]);
  });

  it("reads the kind of edition from the context's format and, on a Monday, the number of findings in its week", () => {
    const inputs = draftInputs();
    const kind = (context: DraftInputs["context"]) => buildDraftInput(weekdayDraft(), { ...inputs, context }).edition;
    expect(kind(weekdayContext())).toBe("weekday");
    expect(kind(sundayContext())).toBe("sunday");
    expect(kind(mondayContext(4))).toBe("monday");
    expect(kind(mondayContext(3))).toBe("monday");
    expect(kind(mondayContext(2))).toBe("short-monday");
    expect(kind(mondayContext(0))).toBe("short-monday");
    const monday = buildDraftInput(weekdayDraft(), { ...inputs, context: mondayContext(3) });
    expect([monday.date, monday.format]).toEqual(["2026-11-23", "monday_review"]);
  });

  it("uses the context's date even when the draft's differs, and changes none of what it is given", () => {
    const draft = weekdayDraft();
    draft.date = "2026-11-25";
    const inputs = draftInputs();
    const frozen = { ...inputs, context: deepFreeze(inputs.context), evidence: deepFreeze(inputs.evidence), metrics: deepFreeze(inputs.metrics), pack: deepFreeze(inputs.pack) };
    const input = buildDraftInput(deepFreeze(draft), frozen);
    expect(input.date).toBe(D);
    expect(input.inventory.entries.some((e) => e.record.type === "draft" && e.record.id === "2026-11-25")).toBe(true);
  });
});

describe("beingPublishedOf() and buildPublishedInput()", () => {
  const world = storedWorld();

  it("names the records of the date being published: the brief, the findings first briefed, the terms, the corrections and the reports of that date", () => {
    const being = beingPublishedOf(world.brief, world, D);
    expect(being.brief).toBe(true);
    expect([...being.findings].sort()).toEqual(["bio-2026-0001", "math-2026-0002"]);
    expect([...being.terms]).toEqual(["protein-folding"]);
    expect([...being.corrections]).toEqual(["C-0002"]);
    expect([...being.reports]).toEqual(["R-0001"]);
  });

  it("names none when nothing is being published, or when the date is another's", () => {
    for (const being of [beingPublishedOf(world.brief, world, null), beingPublishedOf(world.brief, world, "2026-12-01")]) {
      expect([being.brief, being.findings.size, being.terms.size, being.corrections.size, being.reports.size]).toEqual([false, 0, 0, 0, 0]);
    }
    expect(beingPublishedOf(null, world, D).brief).toBe(false);
    const earlier = beingPublishedOf(world.brief, world, "2026-11-10");
    expect([earlier.brief, [...earlier.findings], [...earlier.corrections]]).toEqual([false, ["phys-2026-0003"], ["C-0001"]]);
    // a report decided on another date, a term first used on another
    const other = beingPublishedOf(world.brief, { ...world, reports: [{ ...world.reports[0]!, resolved_on: "2026-11-20" }], terms: [{ ...world.terms[0]!, first_date: "2026-11-20" }] }, D);
    expect([other.reports.size, other.terms.size]).toEqual([0, 0]);
  });

  it("builds the input of a stored brief: its date, the corrections as filed, the views and the inventory", () => {
    const input = buildPublishedInput(world.brief, world, { config: world.config, publishing: D, fileDate: D });
    expect(input.mode).toBe("published");
    expect([input.date, input.fileDate, input.edition, input.format]).toEqual([D, D, "weekday", "daily"]);
    expect(input.config).toBe(world.config);
    expect(input.filing).toBe(world.corrections);
    expect(input.published.brief).toBe(world.brief);
    expect(input.published.findings).toBe(world.findings);
    expect(input.published.terms).toBe(world.terms);
    expect(input.published.corrections).toBe(world.corrections);
    expect(input.published.reports).toBe(world.reports);
    expect(input.published.publishing).toBe(true);
    expect([...input.published.being.findings].sort()).toEqual(["bio-2026-0001", "math-2026-0002"]);
    expect(input.views.find("phys-2026-0003")!.latest.field).toBe("chemistry");
    expect(input.views.find("phys-2026-0003")!.publishing).toBe(false);
    expect(input.inventory.entries.find((e) => e.path === `briefs/${D}.json: lead[0].text.en`)!.publishing).toBe(true);
    expect(input.inventory.entries.find((e) => e.path === "findings/phys-2026-0003.json: explainer.found.en")!.publishing).toBe(false);
  });

  it("judges nothing as being published without a date, and reads the edition and format of the brief", () => {
    const idle = buildPublishedInput(world.brief, world, { config: world.config });
    expect([idle.published.publishing, idle.published.being.brief, idle.published.being.findings.size, idle.fileDate]).toEqual([false, false, 0, null]);
    const kind = (over: Partial<typeof world.brief>) => buildPublishedInput({ ...world.brief, ...over }, world, { config: world.config }).edition;
    expect(kind({})).toBe("weekday");
    expect(kind({ edition: "data_only" })).toBe("data-only");
    expect(kind({ format: "sunday_deep_dive" })).toBe("sunday");
    expect(kind({ format: "monday_review" })).toBe("monday");
    expect(kind({ format: "monday_review", edition: "data_only" })).toBe("data-only");
    expect(buildPublishedInput({ ...world.brief, format: "sunday_deep_dive" }, world, { config: world.config }).format).toBe("sunday_deep_dive");
  });

  it("builds an input for records no brief names, on the date given", () => {
    const input = buildPublishedInput(null, world, { config: world.config, date: "2026-11-30", publishing: D });
    expect([input.date, input.edition, input.format, input.published.brief, input.published.publishing]).toEqual(["2026-11-30", "none", null, null, false]);
    expect(input.published.being.brief).toBe(false);
    expect(input.published.being.findings.size).toBe(2);
    expect(input.views.brief).toMatchObject({ file: null, lead: [], story: null, items: [] });
    expect(input.inventory.entries.some((e) => e.record.type === "brief")).toBe(false);
    expect(input.inventory.entries.some((e) => e.record.type === "finding")).toBe(true);
  });
});

// ── The engine ───────────────────────────────────────────────────────────────────────────────────

describe("runRules(): which rules run", () => {
  it("runs a rule in the modes of its scope and no other", () => {
    const check = vi.fn((): ValidationIssue[] => []);
    for (const mode of ALL_MODES) {
      check.mockClear();
      const rule = stub("COUNTS", check, { scope: [mode] });
      const inputs: Record<RuleMode, RuleInput> = { draft: draftInput(), published: publishedInput(), zh: zhInput(null) };
      for (const run of ALL_MODES) {
        check.mockClear();
        runRules(inputs[run], [rule]);
        expect(check, `a ${mode} rule in ${run} mode`).toHaveBeenCalledTimes(run === mode ? 1 : 0);
      }
    }
  });

  it("passes the input itself, and runs every rule, in the order given", () => {
    const seen: string[] = [];
    const input = draftInput();
    const rules = ["A", "B", "C"].map((code) => stub(code, (i) => { seen.push(code); expect(i).toBe(input); return []; }));
    runRules(input, rules);
    expect(seen).toEqual(["A", "B", "C"]);
    expect(runRules(input, [])).toEqual([]);
  });

  it("skips a rule that needs an input the run lacks, and reports each missing input once, naming the checks it skipped", () => {
    const ran: string[] = [];
    const rules = [
      stub("A", () => { ran.push("A"); return []; }, { needs: ["evidence"] }),
      stub(["B", "C"], () => { ran.push("B"); return []; }, { needs: ["evidence", "pack"] }),
      stub("B2", () => { ran.push("B2"); return []; }, { needs: ["evidence"] }),
      stub("D", () => { ran.push("D"); return []; }, { needs: ["metrics"] }),
      stub("E", () => { ran.push("E"); return []; }),
    ];
    const full = runRules(draftInput(), rules);
    expect(full).toEqual([]);
    expect(ran).toEqual(["A", "B", "B2", "D", "E"]);

    ran.length = 0;
    const issues = runRules(draftInput({ evidence: null, metrics: null, pack: null }), rules);
    expect(ran).toEqual(["E"]);
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["INPUT_MISSING", "warning", "(evidence)"], ["INPUT_MISSING", "warning", "(metrics)"], ["INPUT_MISSING", "warning", "(pack)"],
    ]);
    expect(issues[0]!.message).toBe(`No evidence for ${D}, so 4 checks did not run: A, B, C, B2.`);
    expect(issues[1]!.message).toBe(`No metrics file for ${D}, so 1 check did not run: D.`);
    expect(issues[2]!.message).toBe(`No source pack for ${D}, so 2 checks did not run: B, C.`);
    for (const issue of issues) expect(issue.hint).toMatch(/validate again\.$/);
    expect(issues[0]!.hint).toContain("logs/D.evidence.json");
    expect(issues[1]!.hint).toContain("content/metrics/D.json");
    expect(issues[2]!.hint).toContain("packs/D.json");

    ran.length = 0;
    expect(runRules(draftInput({ pack: null }), rules).map((i) => i.path)).toEqual(["(pack)"]);
    expect(ran).toEqual(["A", "B2", "D", "E"]);
  });

  it("names each skipped code once, however many rules list it, and counts a rule's codes", () => {
    const rules = [stub(["A", "B"], () => [], { needs: ["pack"] }), stub(["B", "C"], () => [], { needs: ["pack"] })];
    const [issue] = runRules(draftInput({ pack: null }), rules);
    expect(issue!.message).toBe(`No source pack for ${D}, so 3 checks did not run: A, B, C.`);
    expect(runRules(draftInput({ pack: null }), [stub("A", () => [], { needs: ["pack"] })])[0]!.message).toBe(`No source pack for ${D}, so 1 check did not run: A.`);
  });

  it("does not report a missing input for a rule that does not run in the mode", () => {
    const rule = stub("A", () => [], { scope: ["published"], needs: ["evidence"] });
    expect(runRules(draftInput({ evidence: null }), [rule])).toEqual([]);
  });

  it("finds a stored record's inputs always there, and the Chinese pass's evidence alone a need", () => {
    const check = vi.fn((): ValidationIssue[] => []);
    const rule = stub("A", check, { needs: ["evidence", "metrics", "pack"] });
    runRules(publishedInput(), [rule]);
    expect(check).toHaveBeenCalledTimes(1);
    check.mockClear();
    expect(runRules(zhInput(draftInputs().evidence), [rule])).toEqual([]);
    expect(check).toHaveBeenCalledTimes(1);
    check.mockClear();
    const missing = runRules(zhInput(null), [rule]);
    expect(check).not.toHaveBeenCalled();
    expect(missing.map((i) => i.path)).toEqual(["(evidence)"]);
    expect(missing[0]!.message).toBe(`No evidence for ${D}, so 1 check did not run: A.`);
  });
});

describe("lacksInput() and runRules(): a rule that only uses an input", () => {
  it("tells which input a run lacks: a draft any of the three, the Chinese pass its evidence, a stored record none", () => {
    const needs: RuleNeed[] = ["evidence", "metrics", "pack"];
    for (const need of needs) {
      expect(lacksInput(draftInput(), need), need).toBe(false);
      expect(lacksInput(draftInput({ [need]: null }), need), need).toBe(true);
      for (const other of needs.filter((n) => n !== need)) expect(lacksInput(draftInput({ [need]: null }), other), `${need} null, ${other}`).toBe(false);
      expect(lacksInput(publishedInput(), need), need).toBe(false);
    }
    expect(lacksInput(zhInput(null), "evidence")).toBe(true);
    expect(lacksInput(zhInput(draftInputs().evidence), "evidence")).toBe(false);
    expect(lacksInput(zhInput(null), "metrics")).toBe(false);
    expect(lacksInput(zhInput(null), "pack")).toBe(false);
  });

  it("runs the rule whatever it uses, and says in one warning that it ran without the input", () => {
    const check = vi.fn((): ValidationIssue[] => []);
    const rule = stub(["PRIMARY_ONLY", "SOURCE_URL"], check, { uses: ["evidence"] });
    expect(runRules(draftInput(), [rule])).toEqual([]);
    expect(check).toHaveBeenCalledTimes(1);
    check.mockClear();
    const issues = runRules(draftInput({ evidence: null }), [rule]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([["INPUT_MISSING", "warning", "(evidence)"]]);
    expect(issues[0]!.message).toBe(`No evidence for ${D}, so 2 checks ran without it: PRIMARY_ONLY, SOURCE_URL.`);
    expect(issues[0]!.hint).toContain("logs/D.evidence.json");
    expect(runRules(draftInput({ evidence: null }), [stub("A", () => [], { uses: ["evidence"] })])[0]!.message).toBe(`No evidence for ${D}, so 1 check ran without it: A.`);
  });

  it("keeps the issues a rule reports without an input, and reports one warning for each input it lacks", () => {
    const rule = stub("A", () => [error("A", "title", "A found a problem.")], { uses: ["evidence", "pack", "metrics"] });
    const issues = runRules(draftInput({ evidence: null, pack: null }), [rule]);
    expect(issues.map((i) => [i.code, i.path])).toEqual([["INPUT_MISSING", "(evidence)"], ["INPUT_MISSING", "(pack)"], ["A", "title"]]);
  });

  it("tells the checks that did not run from those that ran without the input, in one message", () => {
    const rules = [
      stub("A", () => [], { uses: ["evidence"] }),
      stub(["B", "C"], () => [], { needs: ["evidence"] }),
      stub("D", () => [], { uses: ["evidence", "pack"] }),
    ];
    const issues = runRules(draftInput({ evidence: null, pack: null }), rules);
    expect(issues.map((i) => [i.path, i.message])).toEqual([
      ["(evidence)", `No evidence for ${D}, so 2 checks did not run: B, C, and 2 checks ran without it: A, D.`],
      ["(pack)", `No source pack for ${D}, so 1 check ran without it: D.`],
    ]);
  });

  it("counts a rule that needs and uses the same input as one that did not run, and names a code once", () => {
    const rules = [stub(["A", "B"], () => [], { needs: ["pack"], uses: ["pack"] }), stub(["B", "C"], () => [], { uses: ["pack"] })];
    expect(runRules(draftInput({ pack: null }), rules).map((i) => i.message)).toEqual([
      `No source pack for ${D}, so 2 checks did not run: A, B, and 1 check ran without it: C.`,
    ]);
  });

  it("says nothing when the input is there, in a mode the rule does not run in, or for a stored record", () => {
    expect(runRules(draftInput(), [stub("A", () => [], { uses: ["evidence", "metrics", "pack"] })])).toEqual([]);
    expect(runRules(draftInput({ evidence: null }), [stub("A", () => [], { scope: ["published"], uses: ["evidence"] })])).toEqual([]);
    expect(runRules(publishedInput(), [stub("A", () => [], { uses: ["evidence", "metrics", "pack"] })])).toEqual([]);
  });

  it("reads the Chinese pass's evidence alone, as it does for a need", () => {
    const rule = stub("A", () => [], { uses: ["evidence", "metrics"] });
    expect(runRules(zhInput(draftInputs().evidence), [rule])).toEqual([]);
    const issues = runRules(zhInput(null), [rule]);
    expect(issues.map((i) => i.message)).toEqual([`No evidence for ${D}, so 1 check ran without it: A.`]);
  });

  it("does not skip a rule built without the list, and still reads a `needs` it has", () => {
    const bare: Rule = { codes: ["A"], severity: "error", scope: ["draft"], needs: [], check: () => [error("A", "title", "x")] };
    expect(runRules(draftInput({ evidence: null }), [bare]).map((i) => i.code)).toEqual(["A"]);
  });
});

describe("runRules(): a rule that fails, and a rule that reports the wrong code", () => {
  it("turns a rule that throws into one RULE_ERROR and runs the others", () => {
    const rules = [
      stub("A", () => { throw new Error("it broke"); }),
      stub("B", () => [error("B", "title", "B found a problem.")]),
    ];
    const issues = runRules(draftInput(), rules);
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([["RULE_ERROR", "error", "(rule A)"], ["B", "error", "title"]]);
    const fault = issues.find((i) => i.code === "RULE_ERROR")!;
    expect(fault.message).toBe("The check A stopped with an error (it broke) and did not finish.");
    expect(fault.hint).toBe("This is a fault in the validator, not in the draft: report it. The other checks ran.");
  });

  it("reads a thrown value that is no Error as text, and cuts a long message", () => {
    const [thrown] = runRules(draftInput(), [stub("A", () => { throw "plain text"; })]);
    expect(thrown!.message).toBe("The check A stopped with an error (plain text) and did not finish.");
    const [long] = runRules(draftInput(), [stub("A", () => { throw new Error("x".repeat(300)); })]);
    expect(long!.message).toBe(`The check A stopped with an error (${"x".repeat(200)}) and did not finish.`);
  });

  it("names a rule by its first code", () => {
    const [issue] = runRules(draftInput(), [stub(["FIRST", "SECOND"], () => { throw new Error("x"); })]);
    expect(issue!.path).toBe("(rule FIRST)");
  });

  it("keeps the issues of the codes a rule declares, whatever their severity, and drops the others with one RULE_ERROR", () => {
    const rule = stub(["A", "B"], () => [
      error("A", "date", "A error."), warning("B", "title", "B warning."), error("C", "lead[0].text", "C was not declared."),
    ]);
    const issues = runRules(draftInput(), [rule]);
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["RULE_ERROR", "error", "(rule A)"], ["A", "error", "date"], ["B", "warning", "title"],
    ]);
    expect(issues.find((i) => i.code === "RULE_ERROR")!.message).toBe("The check A reported C, a code it does not declare; the issue was dropped.");
    expect(issues.some((i) => i.code === "C")).toBe(false);
  });
});

describe("runRules(): the order of the issues", () => {
  it("returns them by path, then code, errors before warnings, then message, and none twice", () => {
    const rule = stub(["A", "B"], () => [
      error("B", "title", "b"), error("A", "title", "z"), error("A", "title", "a"), warning("A", "title", "a"), error("A", "date", "d"),
      error("A", "title", "a"), error("A", "lead[10].text", "10"), error("A", "lead[2].text", "2"), warning("B", "date", "w"),
    ]);
    const issues = runRules(draftInput(), [rule]);
    expect(issues.map((i) => `${i.path} ${i.code} ${i.severity} ${i.message}`)).toEqual([
      "date A error d", "date B warning w", "lead[2].text A error 2", "lead[10].text A error 10",
      "title A error a", "title A error z", "title B error b",
    ]);
  });
});

describe("runRules(): safety codes on records that are not being published", () => {
  const SAFETY: [string, ...string[]] = ["DUAL_USE", "BLOCKED_HOST", "SOURCE_URL", "WORDS", "SECRET_LIKE", "CANARY"];
  const at = (code: string, path: string, hint: string | null = null) => error(code, path, `${code} at ${path}`, hint);
  const run = (input: RuleInput, ...issues: ValidationIssue[]) => runRules(input, [stub(SAFETY, () => issues, { scope: ["draft", "published"] })]);
  const severityAt = (input: RuleInput, path: string, code = "DUAL_USE") => run(input, at(code, path)).find((i) => i.code === code)!.severity;

  const PATHS = {
    brief: `briefs/${D}.json: lead[0].text.en`,
    bio: "findings/bio-2026-0001.json: explainer.found.en",
    phys: "findings/phys-2026-0003.json: explainer.found.en",
    termBeing: "glossary.json: terms[0].en.definition",
    correctionOld: "corrections.json: corrections[0].after.en",
    correctionNew: "corrections.json: corrections[1].reason.en",
    report: "reports.json: reports[0].reason.en",
  };

  it("keeps an error on a record being published, and turns it into a warning on any other", () => {
    const input = publishedInput(D);
    expect(Object.entries(PATHS).map(([key, p]) => [key, severityAt(input, p)])).toEqual([
      ["brief", "error"], ["bio", "error"], ["phys", "warning"], ["termBeing", "error"], ["correctionOld", "warning"], ["correctionNew", "error"], ["report", "error"],
    ]);
    const idle = publishedInput(null);
    for (const p of Object.values(PATHS)) expect(severityAt(idle, p), p).toBe("warning");
    const elsewhere = publishedInput("2026-11-10");
    expect(severityAt(elsewhere, PATHS.phys)).toBe("error");
    expect(severityAt(elsewhere, PATHS.bio)).toBe("warning");
    expect(severityAt(elsewhere, PATHS.brief)).toBe("warning");
  });

  it("demotes each code of ARCHIVE_WARNING_CODES and no other, and says why when the issue gave no hint", () => {
    const input = publishedInput(null);
    for (const code of ["DUAL_USE", "BLOCKED_HOST", "SOURCE_URL"]) expect(severityAt(input, PATHS.phys, code), code).toBe("warning");
    for (const code of ["WORDS", "SECRET_LIKE", "CANARY"]) expect(severityAt(input, PATHS.phys, code), code).toBe("error");
    const [plain] = run(input, at("DUAL_USE", PATHS.phys));
    expect(plain!.hint).toContain("a warning, not an error");
    const [hinted] = run(input, at("DUAL_USE", PATHS.phys, "Remove the steps."));
    expect(hinted!.hint).toBe("Remove the steps.");
    expect(hinted).toMatchObject({ code: "DUAL_USE", path: PATHS.phys, message: `DUAL_USE at ${PATHS.phys}`, severity: "warning" });
  });

  it("leaves a warning a warning and an issue on no record, an unknown file or an unknown index as an error", () => {
    const input = publishedInput(null);
    const [warn] = run(input, warning("DUAL_USE", PATHS.phys, "Already a warning.", "keep"));
    expect(warn).toMatchObject({ severity: "warning", hint: "keep" });
    for (const p of ["(root)", "date", "(file)", "other.json: x", "corrections.json: corrections[9].after.en", "corrections.json: after", "reports.json: reports[5].reason.en",
      "glossary.json: terms[3].en.term", "findings/x/y.json: a", "constructor.json: a"]) {
      expect(severityAt(input, p), p).toBe("error");
    }
    expect(severityAt(input, "briefs/2026-01-01.json: lead[0].text.en")).toBe("warning");
    // a finding file the content holds no record of is a stored record, and not one being published
    expect(severityAt(publishedInput(D), "findings/nope-2026-0001.json: explainer.found.en")).toBe("warning");
  });

  it("never demotes in draft mode, whatever the path says", () => {
    const input = draftInput();
    expect(severityAt(input, PATHS.phys)).toBe("error");
    expect(severityAt(input, "new_findings[0].explainer.found")).toBe("error");
  });

  it("lists exactly the codes that read the current safety lists, and the engine's own codes", () => {
    expect(ARCHIVE_WARNING_CODES).toEqual(["DUAL_USE", "BLOCKED_HOST", "SOURCE_URL"]);
    expect(ENGINE_CODES).toEqual(["SCHEMA", "INPUT_MISSING", "RULE_ERROR"]);
    for (const code of [...ARCHIVE_WARNING_CODES, ...ENGINE_CODES]) expect(ID_PATTERNS.ruleCode.test(code), code).toBe(true);
  });
});

describe("comparePaths() and sortIssues()", () => {
  it.each([
    ["items[2].x", "items[10].x", -1],
    ["items[10].x", "items[2].x", 1],
    ["a", "a.b", -1],
    ["a.b", "a", 1],
    ["x[0]", "x.y", -1],
    ["x.y", "x[0]", 1],
    ["a", "b", -1],
    ["b", "a", 1],
    ["same[1].path", "same[1].path", 0],
    ["lead[0]", "briefs/a.json: lead[0]", -1],
    ["briefs/a.json: x", "findings/a.json: x", -1],
    ["findings/a.json: z", "findings/a.json: a", 1],
    ["findings/a.json: x[2]", "findings/a.json: x[10]", -1],
    ['strings["a"]', 'strings["b"]', -1],
    ['terms["x"][2]', 'terms["x"][10]', -1],
    ["(root)", "date", -1],
  ] as [string, string, number][])("orders %s against %s", (a, b, sign) => {
    expect(Math.sign(comparePaths(a, b))).toBe(sign);
  });

  it("sorts a list of paths naturally", () => {
    const paths = ["new_findings[10].title", "new_findings[2].title", "lead[0].text", "(root)", "date", "new_findings[2].explainer.found"];
    expect([...paths].sort(comparePaths)).toEqual(["(root)", "date", "lead[0].text", "new_findings[2].explainer.found", "new_findings[2].title", "new_findings[10].title"]);
  });

  it("returns a new list, and keeps the first of two issues that differ only in severity or hint", () => {
    const issues = [warning("A", "x", "m", "later"), error("A", "x", "m", "first")];
    const sorted = sortIssues(issues);
    expect(sorted).toEqual([error("A", "x", "m", "first")]);
    expect(sorted).not.toBe(issues);
    expect(issues).toHaveLength(2);
    expect(sortIssues([error("B", "x", "m"), error("A", "x", "m")]).map((i) => i.code)).toEqual(["A", "B"]);
    expect(sortIssues([error("A", "x", "m2"), error("A", "x", "m1")]).map((i) => i.message)).toEqual(["m1", "m2"]);
    expect(sortIssues([])).toEqual([]);
  });
});

// ── The registry ─────────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "..");

/** The codes of each group as the task that built the groups assigned them (the table's `group` column). */
const GROUP_CODES: Record<RuleGroupName, string[]> = {
  structure: ["DATE_MISMATCH", "REF_UNKNOWN", "FORMAT_SECTIONS", "WEEK_AGAINST", "COUNTS", "FIELD_CAP", "STORY_PICK", "SOURCE_IDS"],
  history: ["SUBFIELD_UNKNOWN", "DUPLICATE", "RETURN_NEW_FACT", "REPORT_DECISION", "REPORT_UPHELD"],
  "ladder-ai": ["RUNG_EVIDENCE", "RUNG_ORDER", "CLAIMED_CAP", "LANDMARK_BASIS", "NON_AI_LANDMARK_ONLY", "SETBACK_MAJOR", "AI_CONFIDENCE", "AI_SYSTEM_NAMED", "WHO_SAYS", "POSSIBILITY"],
  sources: ["PRIMARY_ONLY", "SOURCE_SEEN", "SOURCE_URL", "GO_DEEPER", "FIGURE_LICENCE"],
  grounding: ["ARTEFACT_FORMAT", "QUOTE_VERBATIM", "NUMBER_SOURCED"],
  words: ["WORDS", "SENTENCE_LENGTH", "READING_LEVEL", "NO_EM_DASH", "TERM_DEFINED", "HYPE_WORDS"],
  safety: ["DUAL_USE", "SECRET_LIKE", "CANARY", "BLOCKED_HOST"],
  zh: ["ZH_KEYS", "ZH_PARITY", "ZH_TRADITIONAL", "ZH_AVOID", "ZH_TERMS", "ZH_RUNG_LABEL", "ZH_ENGLISH_ONCE", "ZH_CHARS", "ZH_OFFICIAL", "ZH_NO_DASH", "ZH_HYPE"],
  published: ["XREF", "LANG_PARITY", "FILE_LAYOUT"],
};

const MODULES: Record<RuleGroupName, [Record<string, unknown>, string]> = {
  structure: [structureModule, "structureRules"], history: [historyModule, "historyRules"], "ladder-ai": [ladderAiModule, "ladderAiRules"],
  sources: [sourcesModule, "sourcesRules"], grounding: [groundingModule, "groundingRules"], words: [wordsModule, "wordsRules"],
  safety: [safetyModule, "safetyRules"], zh: [zhModule, "zhRules"], published: [publishedModule, "publishedRules"],
};

describe("the rule groups", () => {
  it("are the nine of the spec, in the rule table's order, each a file of lib/rules/", () => {
    expect([...RULE_GROUP_NAMES]).toEqual(["structure", "history", "ladder-ai", "sources", "grounding", "words", "safety", "zh", "published"]);
    expect(RULE_GROUPS.map((g) => g.group)).toEqual([...RULE_GROUP_NAMES]);
    for (const name of RULE_GROUP_NAMES) expect(fs.existsSync(path.join(ROOT, "lib", "rules", `${name}.ts`)), name).toBe(true);
    expect(GROUPS_FROM_INDEX).toBe(RULE_GROUPS);
  });

  it("export their rules as <group>Rules, which the registry lists", () => {
    for (const group of RULE_GROUPS) {
      const [module, exportName] = MODULES[group.group];
      expect(module[exportName], `${group.group} exports ${exportName}`).toBe(group.rules);
    }
  });

  it("list in RULES every rule of every group, in order, and ruleCodes() the distinct codes", () => {
    expect(RULES).toEqual(RULE_GROUPS.flatMap((g) => [...g.rules]));
    const rules = [stub(["A", "B"]), stub("C"), stub(["B", "D"])];
    expect(ruleCodes(rules)).toEqual(["A", "B", "C", "D"]);
    expect(ruleCodes([])).toEqual([]);
    expect(ruleCodes()).toEqual(ruleCodes(RULES));
  });

  it("have no code in two rules, and rules that agree with the table", () => {
    const all = RULES.flatMap((r) => r.codes);
    expect(all.filter((c, i) => all.indexOf(c) !== i), "a code in two rules").toEqual([]);
    for (const { group, rules } of RULE_GROUPS) {
      for (const rule of rules) {
        expect(rule.scope.length, `${rule.codes[0]} has a mode`).toBeGreaterThan(0);
        expect(new Set(rule.scope).size).toBe(rule.scope.length);
        expect(new Set(rule.codes).size).toBe(rule.codes.length);
        for (const mode of rule.scope) expect(ALL_MODES).toContain(mode);
        for (const code of rule.codes) {
          const info = codeInfo(code);
          expect(info, `${code} is a code of the table`).toBeDefined();
          expect(info!.group, `${code} belongs to the ${group} group`).toBe(group);
          for (const mode of rule.scope) expect(info!.scopes, `${code} may run in ${mode} mode`).toContain(mode);
        }
        const usual = codeInfo(rule.codes[0])!.severity;
        if (usual === "H") expect(rule.severity, `${rule.codes[0]} is hard`).toBe("error");
        if (usual === "S") expect(rule.severity, `${rule.codes[0]} is soft`).toBe("warning");
      }
    }
  });
});

describe("the table of codes", () => {
  const spec = fs.readFileSync(path.join(ROOT, "SPEC.md"), "utf8");
  const start = spec.indexOf("| Code | H/S | Check |");
  const rows = spec.slice(start, spec.indexOf("**Word budgets**", start)).split("\n").filter((line) => line.startsWith("| `"));
  const specCodes = rows.flatMap((line) => {
    const cells = line.split("|");
    const severity = cells[2]!.trim();
    return [...cells[1]!.matchAll(/`([A-Z_]+)`/g)].map((m) => ({
      code: m[1]!,
      kind: severity.startsWith("S above") ? "H/S" : severity.startsWith("S") ? "S" : "H",
      only: /\((published|seed)\)/.exec(severity)?.[1] ?? null,
    }));
  });

  it("holds every code of SPEC.md's table, in its order, with its severity", () => {
    expect(start).toBeGreaterThan(0);
    expect(specCodes).toHaveLength(57);
    expect(RULE_CODE_TABLE.map((r) => r.code)).toEqual(specCodes.map((s) => s.code));
    expect(RULE_CODE_TABLE.map((r) => r.severity)).toEqual(specCodes.map((s) => s.kind));
  });

  it("limits the codes the spec marks (published) or (seed) to that mode, and no other code to one of them alone", () => {
    for (const s of specCodes) {
      const info = codeInfo(s.code)!;
      if (s.only !== null) expect(info.scopes, s.code).toEqual([s.only]);
      else expect(info.scopes.length, s.code).toBeGreaterThan(0);
    }
    expect(specCodes.filter((s) => s.only !== null).map((s) => s.code)).toEqual(["XREF", "LANG_PARITY", "FILE_LAYOUT", "SEED_SOURCES"]);
  });

  it("reads \"Stored records\" the way the spec does: which codes run in which modes", () => {
    const withMode = (mode: string) => RULE_CODE_TABLE.filter((r) => (r.scopes as readonly string[]).includes(mode)).map((r) => r.code);
    // the tests on the run's own inputs run in draft mode only
    const draftOnly = RULE_CODE_TABLE.filter((r) => r.scopes.length === 1 && r.scopes[0] === "draft").map((r) => r.code);
    expect(draftOnly).toEqual(["REF_UNKNOWN", "DUPLICATE", "RETURN_NEW_FACT", "SOURCE_SEEN", "NUMBER_SOURCED", "REPORT_DECISION", "REPORT_UPHELD"]);
    expect(RULE_CODE_TABLE.filter((r) => r.scopes.length === 1 && r.scopes[0] === "zh").map((r) => r.code)).toEqual(["ZH_KEYS", "ZH_PARITY", "ZH_OFFICIAL"]);
    expect(withMode("seed")).toEqual(["SUBFIELD_UNKNOWN", "ZH_RUNG_LABEL", "SEED_SOURCES"]);
    expect(withMode("published").filter((c) => !c.startsWith("ZH_"))).toHaveLength(RULE_CODE_TABLE.filter((r) => !r.code.startsWith("ZH_") && r.group !== "seed" && !draftOnly.includes(r.code)).length);
    // the Chinese codes that read no input also run on a stored record, but not the two that need the pass's own evidence and keys
    expect(withMode("published").filter((c) => c.startsWith("ZH_"))).toEqual(["ZH_TRADITIONAL", "ZH_AVOID", "ZH_TERMS", "ZH_ENGLISH_ONCE", "ZH_CHARS", "ZH_NO_DASH", "ZH_HYPE"]);
    // a Chinese draft is judged for the safety codes and the schema, and by every ZH code that is not stored-only
    expect(withMode("zh")).toEqual([
      "SCHEMA", "DUAL_USE", "SECRET_LIKE", "CANARY", "ZH_KEYS", "ZH_PARITY", "ZH_TRADITIONAL", "ZH_AVOID", "ZH_TERMS", "ZH_RUNG_LABEL", "ZH_ENGLISH_ONCE",
      "ZH_CHARS", "ZH_OFFICIAL", "ZH_NO_DASH", "ZH_HYPE",
    ]);
    // only the codes the spec names are checked on a stored record's safety lists
    expect(RULE_CODE_TABLE.filter((r) => r.group === "safety").map((r) => r.scopes)).toEqual([["draft", "published", "zh"], ["draft", "published", "zh"], ["draft", "published", "zh"], ["draft", "published"]]);
  });

  it("gives each code one group, as assigned, with SCHEMA the engine's and SEED_SOURCES the seeder's", () => {
    for (const group of RULE_GROUP_NAMES) expect(codesOfGroup(group).sort(), group).toEqual([...GROUP_CODES[group]].sort());
    expect(codesOfGroup("zh")).toEqual(GROUP_CODES.zh);
    expect(RULE_CODE_TABLE.filter((r) => r.group === "engine").map((r) => r.code)).toEqual(["SCHEMA"]);
    expect(RULE_CODE_TABLE.filter((r) => r.group === "seed").map((r) => r.code)).toEqual(["SEED_SOURCES"]);
    expect(Object.values(GROUP_CODES).flat()).toHaveLength(55);
    expect(RULE_CODE_TABLE).toHaveLength(55 + 2);
  });

  it("names each code once, in the form a rule code has, with the tests the spec's fixtures paragraph describes", () => {
    const codes = RULE_CODE_TABLE.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(ID_PATTERNS.ruleCode.test(code), code).toBe(true);
    for (const info of RULE_CODE_TABLE) {
      expect(info.tests.length, info.code).toBeGreaterThan(0);
      expect(info.severity === "S" ? info.tests : ["x"]).toEqual(info.severity === "S" ? ["S"] : ["x"]);
    }
    // soft gates have an S fixture: the three the spec names
    expect(RULE_CODE_TABLE.filter((r) => r.tests.includes("S")).map((r) => r.code)).toEqual(["WORDS", "READING_LEVEL", "REPORT_UPHELD"]);
    expect(RULE_CODE_TABLE.filter((r) => r.severity !== "H").map((r) => r.code)).toEqual(["READING_LEVEL", "REPORT_UPHELD"]);
    // the Chinese fixtures: the ZH codes, and the codes a Chinese draft is judged for besides
    expect(RULE_CODE_TABLE.filter((r) => r.tests.includes("Z")).map((r) => r.code)).toEqual([
      "SCHEMA", "DUAL_USE", "SECRET_LIKE", "CANARY", ...GROUP_CODES.zh,
    ]);
    // the stored-record codes and the seeder's are T cases
    for (const code of [...GROUP_CODES.published, "SEED_SOURCES"]) expect(codeInfo(code)!.tests, code).toEqual(["T"]);
    expect(codeInfo("NOT_A_CODE")).toBeUndefined();
    expect(codeInfo("SCHEMA")).toMatchObject({ code: "SCHEMA", severity: "H", group: "engine" });
    expect(codeInfo("READING_LEVEL")).toMatchObject({ severity: "H/S", tests: ["F", "S"], group: "words" });
  });
});

describe("uncoveredCodes()", () => {
  const fullGroups = (): RuleGroup[] => RULE_GROUP_NAMES.map((group) => ({ group, rules: GROUP_CODES[group].map((code) => stub(code)) }));

  it("lists the codes of the groups that no rule reports, and is empty when every group is written", () => {
    expect(uncoveredCodes(fullGroups())).toEqual([]);
    const groups = fullGroups();
    groups[5] = { group: "words", rules: groups[5]!.rules.filter((r) => r.codes[0] !== "HYPE_WORDS" && r.codes[0] !== "WORDS") };
    expect(uncoveredCodes(groups)).toEqual(["WORDS", "HYPE_WORDS"]);
    expect(uncoveredCodes(RULE_GROUP_NAMES.map((group): RuleGroup => ({ group, rules: [] })))).toHaveLength(55);
  });

  it("counts a code a rule reports whichever group holds it, and never lists SCHEMA or SEED_SOURCES", () => {
    const groups = fullGroups();
    groups[0] = { group: "structure", rules: [...groups[0]!.rules, stub(["SCHEMA", "SEED_SOURCES"])] };
    expect(uncoveredCodes(groups)).toEqual([]);
    const none = uncoveredCodes([]);
    expect(none).not.toContain("SCHEMA");
    expect(none).not.toContain("SEED_SOURCES");
    expect(none).toHaveLength(55);
    expect(none[0]).toBe("DATE_MISMATCH");
  });

  it("reads the registry's groups by default", () => {
    const reported = new Set(ruleCodes(RULES));
    expect(uncoveredCodes()).toEqual(RULE_CODE_TABLE.filter((r) => r.group !== "engine" && r.group !== "seed" && !reported.has(r.code)).map((r) => r.code));
  });
});
