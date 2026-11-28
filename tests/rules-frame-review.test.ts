// The independent review of the validator frame (SPEC §4.10, §4.12): what the frame gives a rule beyond its first pass, and the
// inputs that must never make it throw. Part one runs a rule that reads everything a rule may read (every view field, helper
// and selector) over awkward inputs: mixed `new-N` and stored refs, a Monday with a stored week and no deep dive, a data-only
// stored brief, an English-only stored brief, a null figure, an empty `who`, an `L10n` whose `zh` is null, and the records
// frozen. Part two judges the facts added in review: which records are being published (`publishing`), which places a stored
// `removed` correction rewrote (`removed`), the finding as every correction files it (`current`), the stored records a draft
// run may be given (`DraftInputs.stored`), the English side of an `L10n` with no Chinese (`zhNull`), and what `about` names.
//
// New for this project; Cyber's rules had no stored records or second language to review.

import { describe, expect, it } from "vitest";
import { REMOVABLE_PATHS } from "@/lib/schema/draft";
import type { Brief } from "@/lib/schema/brief";
import type { DraftBrief } from "@/lib/schema/draft";
import { Brief as BriefSchema } from "@/lib/schema/brief";
import { DraftZh, ZhContext } from "@/lib/schema/draft-zh";
import { Finding } from "@/lib/schema/finding";
import { Correction } from "@/lib/schema/misc";
import { REMOVED_TEXT } from "@/lib/vocab";
import { buildDraftInput, buildPublishedInput, runRules, type DraftInputs } from "@/lib/rules/run";
import * as shared from "@/lib/rules/shared";
import * as strings from "@/lib/rules/strings";
import type { Inventory, StringEntry } from "@/lib/rules/strings";
import { defineRule, type DraftInput, type PublishedInput, type Rule, type RuleInput, type StoredRecords } from "@/lib/rules/types";
import { validateDraft } from "@/lib/validate";
import {
  D, MONDAY, clone, deepFreeze, draftInputs, holdRemoved, l, landmarkDraft, lz, mondayContext, storedCorrections, storedFinding, storedTerm, storedWorld, sundayContext,
  weekdayDraft,
} from "./helpers/rule-world";

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

const draftInputOf = (draft: DraftBrief = weekdayDraft(), over: Partial<DraftInputs> = {}): DraftInput =>
  buildDraftInput(draft, { ...draftInputs(), ...over });

type World = ReturnType<typeof storedWorld>;
const publishedInputOf = (world: World = storedWorld(), publishing: string | null = D): PublishedInput =>
  buildPublishedInput(world.brief, world, { config: world.config, publishing });

const SELECTORS: Readonly<Record<string, (inv: Inventory) => StringEntry[]>> = {
  modelProse: strings.modelProse, removedProse: strings.removedProse, dashStrings: strings.dashStrings, hypeStrings: strings.hypeStrings,
  dualUseStrings: strings.dualUseStrings, everyString: strings.everyString, blockedHostStrings: strings.blockedHostStrings,
  urlStrings: strings.urlStrings, explainerStrings: strings.explainerStrings, readingStrings: strings.readingStrings,
  definitionStrings: strings.definitionStrings, quoteStrings: strings.quoteStrings, zhAll: strings.zhAll, zhText: strings.zhText,
  zhKeyed: strings.zhKeyed,
};

/**
 * A rule that reads everything a rule may read, so a throw anywhere in the frame shows. `runs()` counts how often it ran, so a
 * test can tell that nothing was skipped.
 */
function sink(): { rule: Rule; runs: () => number } {
  let runs = 0;
  const rule = defineRule({
    code: "COUNTS",
    scope: ["draft", "published"],
    check(input: RuleInput) {
      runs += 1;
      const { views, inventory } = input;
      shared.shownItems(views);
      shared.shownFindings(views);
      shared.newFindings(views);
      shared.shownDepthOf(views)("x");
      shared.publishingFindings(views);
      shared.sourceContainers(views);
      for (const c of shared.citations(views)) shared.resolveSource(views, c.owner, c.id);
      for (const f of views.findings) {
        f.where();
        f.where("explainer.how_sure", "en");
        f.where("sources.0.url");
        for (const date of ["2000-01-01", input.date, "9999-12-31"]) f.filedOn(date);
        JSON.stringify([f.latest, f.published, f.current, [...f.removed], f.explainer, f.title]);
        shared.stringsOf(input, f.key);
        shared.stringsAbout(input, f.key);
        shared.draftRungEntries(views, f.key);
        f.sources?.map((s) => s.url);
        f.ai?.systems.map((s) => s.name);
        f.reactions?.map((r) => r.quote);
        f.who?.map((w) => w.name);
        f.terms?.map((t) => [t.name, t.definition?.en, t.removed]);
        f.figure?.alt.en;
        f.rung_history?.map((r) => r.note?.en);
        f.since_then?.map((s) => s.text.en);
      }
      for (const e of inventory.entries) shared.isLandmarkText(views, e);
      shared.pageProseOf(input);
      shared.onlyPublishing(inventory.entries);
      for (const select of Object.values(SELECTORS)) select(inventory);
      const b = views.brief;
      b.where();
      b.where("lead.0.text", "en");
      JSON.stringify([b.publishing, [...b.removed]]);
      for (const i of [...b.items, ...(b.story === null ? [] : [b.story])]) JSON.stringify([i.where, i.finding?.title]);
      for (const c of views.corrections) JSON.stringify([c.where, c.before?.en, c.after.en]);
      shared.seenText(input, "https://example.org/x");
      shared.inEvidence(input, "https://example.org/x");
      shared.evidenceOf(input);
      return [];
    },
  });
  return { rule, runs: () => runs };
}

/** Runs the sink on a parsed draft through the engine's own builders (so a draft the schema would refuse can be tried). */
function readDraft(draft: DraftBrief, over: Partial<DraftInputs> = {}): { codes: string[]; ran: number } {
  const { rule, runs } = sink();
  const issues = runRules(draftInputOf(draft, over), [rule]);
  return { codes: issues.map((i) => i.code), ran: runs() };
}

function readStored(brief: Brief | null, content: Omit<World, "brief" | "config">, publishing: string | null, date?: string): { codes: string[]; ran: number } {
  const { rule, runs } = sink();
  const config = storedWorld().config;
  const input = brief === null
    ? buildPublishedInput(null, content, { config, publishing, date: date ?? D })
    : buildPublishedInput(brief, content, { config, publishing });
  const issues = runRules(input, [rule]);
  return { codes: issues.map((i) => i.code), ran: runs() };
}

const content = (world: World): Omit<World, "brief" | "config"> => ({
  findings: world.findings, terms: world.terms, corrections: world.corrections, reports: world.reports,
});

// ── Part one: nothing throws ─────────────────────────────────────────────────────────────────────

describe("a rule that reads everything, on a draft", () => {
  it("runs on the weekday draft through the engine, with nothing reported", () => {
    const { rule, runs } = sink();
    const result = validateDraft(weekdayDraft(), { ...draftInputs(), rules: [rule] });
    expect(result.draft).not.toBeNull();
    expect(result.issues).toEqual([]);
    expect(runs()).toBe(1);
  });

  it("runs on frozen inputs and changes none of them", () => {
    const draft = deepFreeze(weekdayDraft());
    const inputs = deepFreeze(draftInputs());
    const before = JSON.stringify([draft, inputs.context, inputs.evidence, inputs.metrics, inputs.pack]);
    const { rule, runs } = sink();
    expect(validateDraft(draft, { ...inputs, rules: [rule] }).issues).toEqual([]);
    expect(runs()).toBe(1);
    expect(JSON.stringify([draft, inputs.context, inputs.evidence, inputs.metrics, inputs.pack])).toBe(before);
  });

  it("reads a draft whose refs mix new refs and stored ids, with some the draft and the context never name", () => {
    const draft = weekdayDraft();
    draft.lead[0]!.refs.push("new-9");
    draft.items = ["math-2026-0002", "new-2", "bio-2026-0999"];
    draft.returning.push({ finding_id: "bio-2026-0999", update: "A made-up update.", source_ids: ["b1"], rung: null });
    expect(readDraft(draft)).toEqual({ codes: [], ran: 1 });
    // refs the schema would refuse reach the rules only through the builders, and must not throw there either
    draft.items.push("not-a-ref");
    draft.lead[0]!.refs.push("");
    expect(readDraft(draft)).toEqual({ codes: [], ran: 1 });
  });

  it("reads a finding with no figure, no reactions, no terms, no relations and no who", () => {
    const draft = weekdayDraft();
    const f = draft.new_findings[0]!;
    Object.assign(f, { figure: null, reactions: [], terms: [], related: [], who: [] });
    expect(readDraft(draft)).toEqual({ codes: [], ran: 1 });
    draft.ideas[0]!.who = "";
    f.reactions = [{ source_id: "s1", who: "", affiliation: "", quote: "" }];
    expect(readDraft(draft)).toEqual({ codes: [], ran: 1 });
  });

  it.each([0, 1, 2, 3, 4])("reads a Monday whose week has %i findings, with the review", (n) => {
    const context = mondayContext(n);
    const draft = weekdayDraft();
    draft.date = context.date;
    const first = context.week!.findings[0]?.id ?? null;
    draft.review = {
      big_picture: "A quiet week.", remarkable: first === null ? null : { finding_id: first, note: "It stood out." },
      strongest_against: { text: "NONE_FOUND", finding_ids: [], source_ids: [] },
    };
    expect(readDraft(draft, { context })).toEqual({ codes: [], ran: 1 });
  });

  it("reads a Sunday's deep dive on a Ledger candidate, and on an id the context does not list", () => {
    const context = sundayContext();
    const draft = weekdayDraft();
    draft.date = context.date;
    draft.deep_dive = { finding_id: "bio-2024-0007", text: "A made-up deep dive.", source_ids: ["b1"], why_today: "anniversary" };
    expect(readDraft(draft, { context })).toEqual({ codes: [], ran: 1 });
    draft.deep_dive.finding_id = "bio-2020-0099";
    expect(readDraft(draft, { context })).toEqual({ codes: [], ran: 1 });
  });

  it("reads a draft with no evidence, no metrics and no pack", () => {
    expect(readDraft(weekdayDraft(), { evidence: null, metrics: null, pack: null })).toEqual({ codes: [], ran: 1 });
  });

  it("reads a draft given the stored records it names", () => {
    const world = storedWorld();
    const stored: StoredRecords = { findings: world.findings, corrections: world.corrections, terms: world.terms };
    expect(readDraft(weekdayDraft(), { stored })).toEqual({ codes: [], ran: 1 });
    expect(readDraft(weekdayDraft(), { stored: { findings: [], corrections: [], terms: [] } })).toEqual({ codes: [], ran: 1 });
    expect(readDraft(weekdayDraft(), { stored: null })).toEqual({ codes: [], ran: 1 });
  });
});

describe("a rule that reads everything, on stored records", () => {
  it("reads the stored Tuesday, whichever date is being published, and frozen", () => {
    for (const publishing of [D, null, "2026-11-10", "2020-01-01"]) {
      const world = storedWorld();
      expect(readStored(world.brief, content(world), publishing), String(publishing)).toEqual({ codes: [], ran: 1 });
    }
    const frozen = deepFreeze(storedWorld());
    expect(readStored(frozen.brief, content(frozen), D)).toEqual({ codes: [], ran: 1 });
  });

  it("reads records no brief names, on the date given", () => {
    const world = storedWorld();
    expect(readStored(null, content(world), D)).toEqual({ codes: [], ran: 1 });
    expect(readStored(null, content(world), null, "2026-12-01")).toEqual({ codes: [], ran: 1 });
    expect(readStored(null, { findings: [], terms: [], corrections: [], reports: [] }, D)).toEqual({ codes: [], ran: 1 });
  });

  it("reads a data-only stored brief with no findings", () => {
    const world = storedWorld();
    const brief = clone(world.brief);
    Object.assign(brief, { edition: "data_only", lead: [], story: null, items: [], rung_changes: [], ideas: [], also: [], deep_dive: null, review: null, corrections: [], reports: [], sources: [], disclosure: [] });
    expect(readStored(brief, { ...content(world), findings: [] }, D)).toEqual({ codes: [], ran: 1 });
    expect(publishedInputOf({ ...world, brief }).edition).toBe("data-only");
  });

  it("reads a stored brief that names findings the content lacks", () => {
    const world = storedWorld();
    expect(readStored(world.brief, { ...content(world), findings: [] }, D)).toEqual({ codes: [], ran: 1 });
    expect(readStored(world.brief, { ...content(world), findings: [], corrections: [], reports: [], terms: [] }, D)).toEqual({ codes: [], ran: 1 });
  });

  it("reads a stored Monday whose week has findings and no deep dive", () => {
    const world = storedWorld();
    const brief = clone(world.brief);
    brief.date = MONDAY;
    brief.format = "monday_review";
    brief.pace.metrics_file = `metrics/${MONDAY}.json`;
    brief.deep_dive = null;
    brief.review = {
      big_picture: l("A week of made-up results."), remarkable: null, strongest_against: { text: l("NONE_FOUND"), finding_ids: [], source_ids: [] },
      field_counts: mondayContext(3).week!.field_counts, fell: [], setbacks: [],
    };
    const out = readStored(brief, content(world), null);
    expect(out).toEqual({ codes: [], ran: 1 });
    expect(publishedInputOf({ ...world, brief }, null).edition).toBe("monday");
  });

  it("reads an English-only stored brief and findings, whose every `L10n` has a null `zh`", () => {
    const world = storedWorld();
    const only = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(only);
      if (value === null || typeof value !== "object") return value;
      const entries = Object.entries(value);
      if (entries.length === 2 && "en" in value && "zh" in value && typeof value.en === "string") return { en: value.en, zh: null };
      return Object.fromEntries(entries.map(([k, v]) => [k, only(v)]));
    };
    const brief = BriefSchema.parse({ ...(only(world.brief) as object), languages: { en: true, zh: false } });
    const findings = world.findings.map((f) => Finding.parse(only(f)));
    const out = readStored(brief, { ...content(world), findings }, D);
    expect(out).toEqual({ codes: [], ran: 1 });
    const inv = publishedInputOf({ ...world, brief, findings }).inventory;
    expect(inv.entries.some((e) => e.record.type === "finding" && e.lang === "zh")).toBe(false);
    expect(inv.entries.some((e) => e.record.type === "brief" && e.lang === "zh")).toBe(false);
  });
});

// ── Part two: what the frame gives a rule ────────────────────────────────────────────────────────

describe("which records are being published", () => {
  it("is true of everything in a draft, in its views and its source containers", () => {
    const input = draftInputOf();
    expect(input.views.brief.publishing).toBe(true);
    expect(input.views.findings.every((f) => f.publishing)).toBe(true);
    const containers = shared.sourceContainers(input.views);
    expect(containers.length).toBeGreaterThan(1);
    const sources = containers.flatMap((c) => c.sources ?? []);
    expect(sources.length).toBeGreaterThan(1);
    expect(sources.every((s) => s.publishing)).toBe(true);
    // the entries a draft writes are being published too, whatever finding they are written on
    const rungs = input.views.findings.flatMap((f) => f.rung_history ?? []).concat(input.views.brief.returning.flatMap((r) => (r.rung === null ? [] : [r.rung])));
    expect(rungs.length).toBeGreaterThan(1);
    expect(rungs.every((r) => r.publishing)).toBe(true);
  });

  it("follows the date being published in a stored run: the brief, then each finding by its first brief or the text it was given", () => {
    const tuesday = publishedInputOf(storedWorld(), D);
    expect(tuesday.views.brief.publishing).toBe(true);
    // each source says whether it is being published: the sources of each container, as a list of flags
    const flags = (input: PublishedInput): [string, boolean[]][] =>
      shared.sourceContainers(input.views).map((c) => [c.owner?.key ?? "brief", (c.sources ?? []).map((s) => s.publishing)]);
    // phys-2026-0003 was first briefed on another date and last changed the day before D
    expect(flags(tuesday)).toEqual([["bio-2026-0001", [true, true]], ["math-2026-0002", [true, true]], ["phys-2026-0003", [false, false]], ["brief", [true, true]]]);
    // changed on D, with a note, a source and a rung entry of D, the same finding returns with new text (F-17), and its sources and rung entry of D are the
    // text being published, not the finding (F-55): the finding itself is no finding judged whole
    const world = storedWorld();
    const returning = publishedInputOf({ ...world, findings: world.findings.map((f) => (f.id === "phys-2026-0003" ? { ...f, updated: D } : f)) });
    expect(flags(returning)).toEqual([["bio-2026-0001", [true, true]], ["math-2026-0002", [true, true]], ["phys-2026-0003", [true, true]], ["brief", [true, true]]]);
    expect(returning.views.find("phys-2026-0003")!.publishing).toBe(false);
    expect(returning.views.find("phys-2026-0003")!.rung_history!.map((r) => r.publishing)).toEqual([false, true]);
    const earlier = publishedInputOf(storedWorld(), "2026-11-10");
    expect(earlier.views.brief.publishing).toBe(false);
    expect(flags(earlier).map(([, f]) => f)).toEqual([[false, false], [false, false], [true, true], [false, false]]);
    const none = publishedInputOf(storedWorld(), null);
    expect(none.views.brief.publishing).toBe(false);
    expect(flags(none).every(([, f]) => f.every((x) => !x))).toBe(true);
    expect(none.views.findings.every((f) => !f.publishing && f.rung_history!.every((r) => !r.publishing))).toBe(true);
  });

  it("is false of the brief when no brief is judged", () => {
    const world = storedWorld();
    const input = buildPublishedInput(null, content(world), { config: world.config, publishing: D, date: D });
    expect(input.views.brief.publishing).toBe(false);
    expect(input.views.brief.removed.size).toBe(0);
    expect(input.published.publishing).toBe(false);
    expect(input.views.findings.filter((f) => f.publishing).map((f) => f.key)).toEqual(["bio-2026-0001", "math-2026-0002"]);
  });

  it("keeps the engine's own answer for the brief and the views in step: a finding view is judged whole when its finding is, and a returning one is not", () => {
    const world = storedWorld();
    const returning = { ...world, findings: world.findings.map((f) => (f.id === "phys-2026-0003" ? { ...f, updated: D } : f)) };
    for (const publishing of [D, null, "2026-11-10"]) {
      for (const kind of [world, returning]) {
        const input = publishedInputOf(kind, publishing);
        expect(input.views.brief.publishing, String(publishing)).toBe(input.published.publishing);
        const { findings, parts } = input.published.being;
        for (const f of input.views.findings) expect(f.publishing, `${publishing} ${f.key}`).toBe(findings.has(f.key) && !parts.has(f.key));
      }
    }
  });
});

describe("the places a stored removed correction rewrote", () => {
  const removal = (over: Partial<Correction>): Correction =>
    Correction.parse({
      ...storedCorrections()[0]!, id: "C-0003", date: D, finding_id: null, edition_date: null, term_id: null, type: "removed",
      before: l("The earlier text."), after: lz(REMOVED_TEXT.en, REMOVED_TEXT.zh), ...over,
    });
  /** The stored world with the corrections filed and, as publishing leaves it, REMOVED_TEXT written at the paths the removed ones name. */
  const worldWith = (...extra: Correction[]): World => {
    const world = storedWorld();
    const filed = { ...world, corrections: [...world.corrections, ...extra] };
    holdRemoved(filed);
    return filed;
  };
  const inputWith = (...extra: Correction[]): PublishedInput => publishedInputOf(worldWith(...extra), D);

  /** A world in which the removable path holds a text to rewrite: the stored world has none at a null or at a part a Tuesday lacks, so those get one first. */
  const seeded = (target: "finding" | "brief", path: string, ...more: Correction[]): World => {
    const world = storedWorld();
    const finding = world.findings[0]!;
    const brief = world.brief as any;
    if (target === "finding" && path === "rung_history.0.note") finding.rung_history[0]!.note = lz("A made-up note.", "範例註記。");
    if (target === "finding" && path.startsWith("figure.")) {
      finding.figure = { source_id: "s1", image_url: "https://example.org/figure.png", licence: "CC-BY-4.0", licence_quote: "Licensed under CC BY.", credit: "Figure 1, made up", alt: lz("A made-up figure.", "範例圖。") };
    }
    if (target === "brief" && path === "story.update") brief.story.update = lz("A made-up update.", "範例更新。");
    if (target === "brief" && path === "items.0.update") brief.items[0].update = lz("A made-up update.", "範例更新。");
    if (target === "brief" && path === "deep_dive.text") brief.deep_dive = { finding_id: finding.id, text: lz("A made-up deep dive.", "範例深入報導。"), source_ids: [], why_today: "rotation" };
    if (target === "brief" && path.startsWith("review.")) {
      brief.review = {
        big_picture: lz("A made-up picture.", "範例全貌。"), remarkable: { finding_id: finding.id, note: lz("A made-up note.", "範例註記。") },
        strongest_against: { text: lz("A made-up counter.", "範例反證。"), finding_ids: [], source_ids: [] }, field_counts: [], fell: [], setbacks: [],
      };
    }
    if (target === "brief" && path === "status_note") brief.status_note = "A made-up note.";
    world.corrections.push(...more);
    holdRemoved(world);
    return world;
  };

  const FINDING_PATHS = REMOVABLE_PATHS.finding.map((generic) => generic.replaceAll("*", "0"));
  const EDITION_PATHS = REMOVABLE_PATHS.edition.map((generic) => generic.replaceAll("*", "0"));

  it("is empty for every view when no correction removed anything, including a removed type on no target", () => {
    const input = inputWith(removal({ finding_id: "bio-2026-0001", type: "correction", path: "explainer.how_sure" }));
    expect(input.views.findings.every((f) => f.removed.size === 0)).toBe(true);
    expect(input.views.brief.removed.size).toBe(0);
    expect(input.views.findings.flatMap((f) => f.terms ?? []).every((t) => !t.removed)).toBe(true);
  });

  it.each(FINDING_PATHS)("names the place a removed correction of a finding rewrote, alone: %s", (path) => {
    const input = publishedInputOf(seeded("finding", path, removal({ finding_id: "bio-2026-0001", path })), D);
    expect([...input.views.find("bio-2026-0001")!.removed]).toEqual([path]);
    expect(input.views.find("math-2026-0002")!.removed.size).toBe(0);
    expect(input.views.brief.removed.size).toBe(0);
    // the inventory flags the same place, wherever the record holds a string there
    for (const e of input.inventory.entries.filter((x) => x.removed)) {
      expect(e.record, e.path).toEqual({ type: "finding", id: "bio-2026-0001" });
      expect(e.at, e.path).toBe(path);
    }
  });

  it.each(EDITION_PATHS)("names the place a removed correction of the brief rewrote, alone: %s", (path) => {
    const input = publishedInputOf(seeded("brief", path, removal({ edition_date: D, path })), D);
    expect([...input.views.brief.removed]).toEqual([path]);
    expect(input.views.findings.every((f) => f.removed.size === 0)).toBe(true);
    for (const e of input.inventory.entries.filter((x) => x.removed)) {
      expect(e.record, e.path).toEqual({ type: "brief", id: D });
      expect(e.at, e.path).toBe(path);
    }
  });

  it("names a place in both languages once, and each of several removals", () => {
    const input = inputWith(
      removal({ finding_id: "bio-2026-0001", path: "explainer.how_sure" }),
      removal({ id: "C-0004", finding_id: "bio-2026-0001", path: "sources.0.url" }),
      removal({ id: "C-0005", finding_id: "bio-2026-0001", path: "explainer.how_sure" }),
      removal({ id: "C-0006", edition_date: D, path: "lead.0.text" }),
    );
    expect([...input.views.find("bio-2026-0001")!.removed].sort()).toEqual(["explainer.how_sure", "sources.0.url"]);
    expect([...input.views.brief.removed]).toEqual(["lead.0.text"]);
    const flagged = input.inventory.entries.filter((e) => e.removed).map((e) => e.path);
    expect(flagged).toContain("findings/bio-2026-0001.json: explainer.how_sure.en");
    expect(flagged).toContain("findings/bio-2026-0001.json: explainer.how_sure.zh");
  });

  it("ignores a removed correction of another type, another finding, another brief or a record that is not in the run", () => {
    const input = inputWith(
      removal({ finding_id: "bio-2026-0001", type: "update", path: "explainer.found" }),
      removal({ id: "C-0004", finding_id: "bio-2026-0777", path: "explainer.found" }),
      removal({ id: "C-0005", edition_date: "2026-11-01", path: "lead.0.text" }),
    );
    expect(input.views.findings.every((f) => f.removed.size === 0)).toBe(true);
    expect(input.views.brief.removed.size).toBe(0);
  });

  it("names no place where the record holds other text or none: a removal counts only where the record holds REMOVED_TEXT", () => {
    const named = (path: string, edit: (w: World) => void = () => undefined): PublishedInput => {
      const world = storedWorld();
      world.corrections.push(removal({ finding_id: "bio-2026-0001", path }));
      edit(world);
      return publishedInputOf(world, D);
    };
    const none = (input: PublishedInput): void => {
      expect(input.views.find("bio-2026-0001")!.removed.size).toBe(0);
      expect(input.inventory.entries.filter((e) => e.removed)).toEqual([]);
    };
    // other text, a text removed in one language only or with no Chinese, a plain string that is the Chinese marker
    none(named("explainer.how_sure"));
    none(named("explainer.how_sure", (w) => { w.findings[0]!.explainer.how_sure = { en: REMOVED_TEXT.en, zh: "別的文字。" }; }));
    none(named("explainer.how_sure", (w) => { w.findings[0]!.explainer.how_sure = { en: "Other text.", zh: REMOVED_TEXT.zh }; }));
    none(named("explainer.how_sure", (w) => { w.findings[0]!.explainer.how_sure = { en: REMOVED_TEXT.en, zh: null }; }));
    none(named("sources.0.url", (w) => { w.findings[0]!.sources[0]!.url = REMOVED_TEXT.zh; }));
    // no text: a null part and a path the record has no value at
    none(named("figure.credit"));
    none(named("sources.9.url"));
    none(named("rung_history.0.note"));
    // and the marker beside the same correction is named
    const held = named("explainer.how_sure", (w) => { w.findings[0]!.explainer.how_sure = { ...REMOVED_TEXT }; });
    expect([...held.views.find("bio-2026-0001")!.removed]).toEqual(["explainer.how_sure"]);
    // a term that is removed in English only is not flagged on the findings that use it
    const half = storedWorld();
    half.corrections.push(removal({ term_id: "protein-folding", path: "definition" }));
    half.terms[0]!.en.definition = REMOVED_TEXT.en;
    const input = publishedInputOf(half, D);
    expect(input.views.findings.flatMap((f) => f.terms ?? []).every((t) => !t.removed)).toBe(true);
    expect(input.inventory.entries.filter((e) => e.removed)).toEqual([]);
  });

  it("flags a term's rewritten definition on each finding that uses the term, and on no other use", () => {
    const input = inputWith(removal({ term_id: "protein-folding", path: "definition" }));
    const uses = input.views.findings.flatMap((f) => (f.terms ?? []).map((t) => [f.key, t.id, t.removed] as const));
    expect(uses).toEqual([["bio-2026-0001", "protein-folding", true], ["phys-2026-0003", "protein-folding", true]]);
    expect(input.inventory.entries.filter((e) => e.removed).map((e) => [e.record.type, e.record.id, e.at])).toEqual([
      ["term", "protein-folding", "definition"], ["term", "protein-folding", "definition"],
    ]);
    const other = inputWith(removal({ term_id: "another-term", path: "definition" }));
    expect(other.views.find("bio-2026-0001")!.terms!.every((t) => !t.removed)).toBe(true);
    // a new term of a draft is never one
    expect(draftInputOf().views.findings.flatMap((f) => f.terms ?? []).every((t) => !t.removed)).toBe(true);
  });

  it("is empty in a draft, and for a stored finding a draft is given it is what the stored corrections rewrote", () => {
    expect(draftInputOf().views.findings.every((f) => f.removed.size === 0)).toBe(true);
    expect(draftInputOf().views.brief.removed.size).toBe(0);
    const world = worldWith(
      removal({ finding_id: "math-2026-0002", path: "explainer.how_sure" }), removal({ id: "C-0004", term_id: "protein-folding", path: "definition" }),
      removal({ id: "C-0005", edition_date: D, path: "lead.0.text" }),
    );
    const input = draftInputOf(weekdayDraft(), { stored: { findings: world.findings, corrections: world.corrections, terms: world.terms } });
    expect([...input.views.find("math-2026-0002")!.removed]).toEqual(["explainer.how_sure"]);
    expect(input.views.find("phys-2026-0003")!.removed.size).toBe(0);
    expect(input.views.find("bio-2026-0001")!.terms!.map((t) => t.removed)).toEqual([true]);
    // a draft's own brief is no stored brief: the correction of an edition names a stored one
    expect(input.views.brief.removed.size).toBe(0);
    expect(input.views.findings.filter((f) => f.origin === "new").every((f) => f.removed.size === 0)).toBe(true);
  });
});

describe("the finding as every correction files it", () => {
  const dated = (date: string, finding: string, path: string, after: string, id: string): Correction =>
    Correction.parse({ ...storedCorrections()[0]!, id, date, finding_id: finding, path, after: l(after) });

  it("counts a correction dated after the edition in `current` and not in `latest`", () => {
    const world = storedWorld();
    const later = dated("2026-12-01", "bio-2026-0001", "significance", "landmark", "C-0003");
    const input = publishedInputOf({ ...world, corrections: [...world.corrections, later] });
    const f = input.views.find("bio-2026-0001")!;
    expect(f.published.significance).toBe("major");
    expect(f.latest.significance).toBe("major");
    expect(f.filedOn("2026-12-01").significance).toBe("landmark");
    expect(f.current.significance).toBe("landmark");
    expect(f.current).toEqual(f.filedOn("9999-12-31"));
  });

  it("is the latest filing when no correction is dated after the edition", () => {
    const input = publishedInputOf(storedWorld());
    for (const f of input.views.findings) expect(f.current, f.key).toEqual(f.latest);
    expect(input.views.find("phys-2026-0003")!.current.field).toBe("chemistry");
    expect(input.views.find("math-2026-0002")!.current.significance).toBe("major");
  });

  it("is a new finding's own values, and what the stored and draft corrections file for a stored one", () => {
    const input = draftInputOf();
    expect(input.views.find("new-1")!.current).toEqual(input.views.find("new-1")!.published);
    expect(input.views.find("math-2026-0002")!.current.significance).toBe("major");
    expect(input.views.find("phys-2026-0003")!.current).toEqual(input.views.find("phys-2026-0003")!.latest);
  });
});

describe("the stored records a draft run may be given", () => {
  const given = (over: Partial<StoredRecords> = {}): StoredRecords => {
    const world = storedWorld();
    return { findings: world.findings, corrections: world.corrections, terms: world.terms, ...over };
  };

  it("makes a stored finding the draft names a full view, which the draft does not judge", () => {
    const without = draftInputOf().views.find("math-2026-0002")!;
    expect(without).toMatchObject({ basis: "context", detail: "full" });
    expect(without.reactions).toBeNull();
    expect(without.who).toBeNull();
    const view = draftInputOf(weekdayDraft(), { stored: given() }).views.find("math-2026-0002")!;
    expect(view).toMatchObject({ origin: "stored", basis: "context", detail: "full", known: true, file: null, publishing: true, isNew: false, depth: "item" });
    expect(view.reactions).toHaveLength(1);
    expect(view.who).toHaveLength(1);
    expect(view.ai).toMatchObject({ role: "ai_solved", confidence: "confirmed" });
    expect(view.published).toMatchObject({ kind: "result", role: "ai_solved", confidence: "confirmed" });
    expect(view.first_brief).toBe(D);
    expect(view.where("explainer.how_sure", "en")).toBe('findings["math-2026-0002"].explainer.how_sure.en');
    expect(view.where()).toBe('findings["math-2026-0002"]');
    // it is not one of the draft's own records: no container, no citation and no string of its own
    const input = draftInputOf(weekdayDraft(), { stored: given() });
    expect(shared.sourceContainers(input.views).map((c) => c.owner?.key ?? null)).toEqual(["new-1", "new-2", null]);
    const ofStored = shared.citations(input.views).filter((c) => c.owner?.basis === "context");
    expect(ofStored.length).toBeGreaterThan(0);
    expect(ofStored.every((c) => c.form === "either" && (c.role === "returning" || c.role === "rung" || c.role === "rung_change"))).toBe(true);
    expect(shared.publishingFindings(input.views).map((f) => f.key)).toEqual(["new-1", "new-2"]);
    expect(shared.stringsOf(input, "math-2026-0002")).toEqual([]);
  });

  it("files the stored corrections first, and gives the draft's own the ids publish will give them", () => {
    const input = draftInputOf(weekdayDraft(), { stored: given() });
    expect(input.filing.map((c) => c.id)).toEqual(["C-0001", "C-0002", "C-0003", "C-0004", "C-0005"]);
    expect(input.filing.map((c) => c.date)).toEqual(["2026-11-10", D, D, D, D]);
    const bare = draftInputOf();
    expect(bare.filing.map((c) => c.id)).toEqual(["C-0001", "C-0002", "C-0003"]);
    expect(draftInputOf(weekdayDraft(), { stored: given({ corrections: [] }) }).filing.map((c) => c.id)).toEqual(["C-0001", "C-0002", "C-0003"]);
  });

  it("files a stored finding by its own record, the stored corrections and the draft's, by date and then id", () => {
    const input = draftInputOf(landmarkDraft(), { stored: given() });
    const math = input.views.find("math-2026-0002")!;
    // the record says major, a stored correction of 2026-11-10 says major, the draft's own, dated D, says landmark
    expect(math.published.significance).toBe("major");
    expect(math.filedOn("2026-11-09").significance).toBe("major");
    expect(math.filedOn(D).significance).toBe("landmark");
    expect(math.latest.significance).toBe("landmark");
    const phys = input.views.find("phys-2026-0003")!;
    expect(phys.published.field).toBe("physics");
    expect(phys.latest).toMatchObject({ field: "chemistry", subfield: "catalysis" });
  });

  it("marks a stored finding the context does not list as unknown, though the record is given", () => {
    const draft = weekdayDraft();
    draft.returning.push({ finding_id: "bio-2026-0999", update: "A made-up update.", source_ids: ["b1"], rung: null });
    const stored = given({ findings: [...storedWorld().findings, storedFinding("bio-2026-0999")] });
    const view = draftInputOf(draft, { stored }).views.find("bio-2026-0999")!;
    expect(view).toMatchObject({ known: false, basis: "context", detail: "full" });
    expect(draftInputOf(draft).views.find("bio-2026-0999")).toMatchObject({ known: false, detail: "partial" });
  });

  it("leaves a finding the stored records do not give as the context shows it, and changes nothing without them", () => {
    const input = draftInputOf(weekdayDraft(), { stored: given({ findings: [storedFinding("math-2026-0002")] }) });
    expect(input.views.find("phys-2026-0003")).toMatchObject({ basis: "context", detail: "partial" });
    expect(input.views.find("math-2026-0002")!.reactions).not.toBeNull();
    const plain = draftInputOf();
    for (const stored of [undefined, null]) {
      const same = draftInputOf(weekdayDraft(), { stored });
      expect(same.filing).toEqual(plain.filing);
      expect(same.views.findings.map((f) => [f.key, f.basis, f.detail, f.reactions === null])).toEqual(plain.views.findings.map((f) => [f.key, f.basis, f.detail, f.reactions === null]));
    }
  });

  it("names a stored finding's terms by the glossary it is given, and by their ids read as words without it", () => {
    const draft = weekdayDraft();
    draft.returning.push({ finding_id: "bio-2026-0001", update: "A made-up update.", source_ids: ["b1"], rung: null });
    const named = draftInputOf(draft, { stored: given() }).views.find("bio-2026-0001")!.terms!;
    expect(named.map((t) => [t.id, t.name, t.definition?.en])).toEqual([["protein-folding", "protein folding", storedTerm().en.definition]]);
    const bare = draftInputOf(draft, { stored: given({ terms: [] }) }).views.find("bio-2026-0001")!.terms!;
    expect(bare.map((t) => [t.id, t.name, t.definition])).toEqual([["protein-folding", "protein folding", null]]);
  });

  it("reaches the rules through validateDraft(), which passes every input it is given to the input builder", () => {
    const seen: RuleInput[] = [];
    const rule = defineRule({ code: "COUNTS", scope: "draft", check: (input) => { seen.push(input); return []; } });
    expect(validateDraft(weekdayDraft(), { ...draftInputs(), stored: given(), rules: [rule] }).issues).toEqual([]);
    expect(validateDraft(weekdayDraft(), { ...draftInputs(), rules: [rule] }).issues).toEqual([]);
    const [withStored, without] = seen.map((i) => i.views.find("math-2026-0002")!);
    expect(withStored!.reactions).not.toBeNull();
    expect(without!.reactions).toBeNull();
  });

  it("changes none of the records it is given", () => {
    const stored = deepFreeze(given());
    const before = JSON.stringify(stored);
    const input = draftInputOf(deepFreeze(weekdayDraft()), { stored });
    expect(input.views.find("math-2026-0002")!.basis).toBe("context");
    expect(JSON.stringify(stored)).toBe(before);
  });
});

describe("the English side of an L10n with no Chinese", () => {
  // the stored world's `math-2026-0002` title, its corrections and its report are in English alone
  const ENGLISH_ONLY = [
    "findings/math-2026-0002.json: title.en",
    ...[0, 1].flatMap((i) => ["before", "after", "reason"].map((k) => `corrections.json: corrections[${i}].${k}.en`)),
    "reports.json: reports[0].reason.en",
  ];
  const marked = (inv: Inventory): string[] => inv.entries.filter((e) => e.zhNull).map((e) => e.path);

  it("is marked on each English entry whose `zh` is null, and on no other", () => {
    const inv = publishedInputOf().inventory;
    expect(marked(inv)).toEqual(ENGLISH_ONLY);
    for (const e of inv.entries.filter((x) => x.zhNull)) {
      expect(e.lang, e.path).toBe("en");
      expect(inv.entries.some((x) => x.path === e.path.replace(/\.en$/, ".zh")), e.path).toBe(false);
    }
    // an L10n with Chinese gives two entries, neither marked
    expect(inv.entries.find((e) => e.path === "findings/bio-2026-0001.json: title.en")?.zhNull).toBe(false);
    expect(inv.entries.find((e) => e.path === "findings/bio-2026-0001.json: title.zh")?.zhNull).toBe(false);
  });

  it("follows the record: a finding's title with no Chinese is marked, and a brief's text", () => {
    const world = storedWorld();
    world.findings[0] = storedFinding("bio-2026-0001", { title: l("An English-only title") });
    const brief = clone(world.brief);
    brief.lead[0]!.text = l("A made-up lead.");
    brief.ideas[0]!.text = l("A made-up idea.");
    const inv = publishedInputOf({ ...world, brief }).inventory;
    expect(marked(inv)).toEqual([
      `briefs/${D}.json: lead[0].text.en`, `briefs/${D}.json: ideas[0].text.en`, "findings/bio-2026-0001.json: title.en", ...ENGLISH_ONLY,
    ]);
    expect(inv.entries.some((e) => e.path === "findings/bio-2026-0001.json: title.zh")).toBe(false);
  });

  it("is never marked in a draft, whose strings are English text, or in the Chinese draft", () => {
    expect(marked(draftInputOf().inventory)).toEqual([]);
    const context = ZhContext.parse({
      schema_version: 1, date: D, deadline: "2026-11-24T04:15:00+08:00",
      strings: [{ key: "lead.0", en: "The lead.", kind: "lead", cap_chars: 60, group: null }],
      terms: [], fixed: [], hype: [], hype_names: [], avoid: {}, labels: {},
    });
    const draft = DraftZh.parse({ schema_version: 1, date: D, generated_at: "2026-11-24T04:00:00+08:00", strings: { "lead.0": "引言一。" }, terms: {} });
    const inv = strings.zhInventory(draft, context);
    expect(inv.entries.length).toBeGreaterThan(0);
    expect(marked(inv)).toEqual([]);
  });
});

describe("what a string is about", () => {
  it("is the finding for a correction's after in a stored record and a draft alike, and for no other string of a correction", () => {
    const stored = publishedInputOf();
    const aboutStored = stored.inventory.entries.filter((e) => e.record.type === "correction" && e.about !== null);
    expect(aboutStored.map((e) => [e.path, e.about])).toEqual([
      ["corrections.json: corrections[0].after.en", "math-2026-0002"], ["corrections.json: corrections[1].after.en", "phys-2026-0003"],
    ]);
    const draft = draftInputOf();
    const aboutDraft = draft.inventory.entries.filter((e) => e.path.startsWith("corrections[") && e.about !== null);
    expect(aboutDraft.map((e) => e.path)).toEqual(["corrections[0].after", "corrections[1].after", "corrections[2].after"]);
  });

  it("is no finding for a report's reason, whatever finding the report is about", () => {
    const stored = publishedInputOf();
    const reports = stored.inventory.entries.filter((e) => e.record.type === "report");
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every((e) => e.about === null && e.finding === null)).toBe(true);
  });
});

describe("a stored run with no brief and no date", () => {
  it("is refused with the reason, not read as a brief of an unknown date", () => {
    const world = storedWorld();
    // the types refuse it too: a run with no brief names its date
    // @ts-expect-error `options.date` is required when there is no brief
    expect(() => buildPublishedInput(null, content(world), { config: world.config })).toThrow(/need `options\.date`/);
  });
});
