// The views (lib/rules/views.ts): one normal form for a draft and a stored brief, and `filedOn(date)` after SPEC §4.10. New
// for this project; Cyber's rules read their derived lookups through `derive()`, which had no counterpart to test.

import { describe, expect, it } from "vitest";
import { draftFilings, filedAs, type FilingCorrection } from "@/lib/items";
import { buildDraftInput, buildPublishedInput, beingPublishedOf } from "@/lib/rules/run";
import type { StoredRecords } from "@/lib/rules/types";
import { Term } from "@/lib/schema/glossary";
import { Correction } from "@/lib/schema/misc";
import { REMOVED_BEFORE, REMOVED_TEXT } from "@/lib/vocab";
import { buildViews, contextFindingIds, filedFacts, type Facts, type FindingView, type Views } from "@/lib/rules/views";
import {
  D, MONDAY, deepFreeze, holdRemoved, l, mondayContext, storedFinding, storedWorld, sundayContext, weekdayContext, weekdayDraft,
} from "./helpers/rule-world";

const NONE: Facts = { field: null, subfield: null, kind: null, significance: null, role: null, confidence: null };

const filing = (rows: [string, string, string, string, string][]): FilingCorrection[] =>
  rows.map(([id, date, finding_id, path, after]) => ({ id, date, finding_id, type: "correction", path, after: { en: after } }));

function draftViews(draft: any = weekdayDraft(), context: any = weekdayContext()): Views {
  return buildViews({ mode: "draft", date: context.date, draft, context, filing: draftFilings(draft.corrections, [], context.date) });
}

function publishedViews(world = storedWorld(), publishing: string | null = D): Views {
  const being = beingPublishedOf(world.brief, world, publishing);
  return buildViews({ mode: "published", date: world.brief.date, filing: world.corrections, being, ...world });
}

const keysOf = (v: object): string[] => Object.keys(v).sort();

describe("filedFacts() and filedOn(): SPEC §4.10", () => {
  const base = (over: Partial<Facts> = {}): Facts => ({
    field: "biology", subfield: "proteins", kind: "result", significance: "major", role: "ai_solved", confidence: "confirmed", ...over,
  });
  const record = (facts: Facts) => ({
    id: "bio-2026-0001", field: facts.field!, subfield: facts.subfield!, kind: facts.kind!, significance: facts.significance!,
    ai: { role: facts.role!, confidence: facts.confidence },
  });

  const CASES: Record<string, FilingCorrection[]> = {
    none: [],
    "one at each filing path": filing([
      ["C-0001", "2026-11-10", "bio-2026-0001", "significance", "notable"], ["C-0002", "2026-11-10", "bio-2026-0001", "field", "chemistry"],
      ["C-0003", "2026-11-10", "bio-2026-0001", "subfield", "catalysis"], ["C-0004", "2026-11-10", "bio-2026-0001", "kind", "check"],
      ["C-0005", "2026-11-10", "bio-2026-0001", "ai.confidence", "claimed"],
    ]),
    "the later date wins": filing([
      ["C-0009", "2026-11-05", "bio-2026-0001", "significance", "landmark"], ["C-0002", "2026-11-12", "bio-2026-0001", "significance", "notable"],
    ]),
    "the higher id wins on one date": filing([
      ["C-0004", "2026-11-12", "bio-2026-0001", "significance", "notable"], ["C-0003", "2026-11-12", "bio-2026-0001", "significance", "landmark"],
    ]),
    "role none files with no confidence": filing([
      ["C-0001", "2026-11-12", "bio-2026-0001", "ai.role", "none"], ["C-0002", "2026-11-13", "bio-2026-0001", "ai.confidence", "claimed"],
    ]),
    "a removed correction never refiles": [{ id: "C-0001", date: "2026-11-12", finding_id: "bio-2026-0001", type: "removed", path: "significance", after: { en: "landmark" } }],
    "a value outside the vocabulary is ignored": filing([["C-0001", "2026-11-12", "bio-2026-0001", "significance", "huge"], ["C-0002", "2026-11-12", "bio-2026-0001", "ai.role", "robot"]]),
    "another finding's correction is ignored": filing([["C-0001", "2026-11-12", "math-2026-0002", "significance", "landmark"]]),
    "a path that is not a filing path is ignored": filing([["C-0001", "2026-11-12", "bio-2026-0001", "explainer.found", "landmark"]]),
  };

  it.each(Object.entries(CASES))("agrees with filedAs() on a full record: %s", (_name, corrections) => {
    for (const date of ["2026-11-01", "2026-11-10", "2026-11-12", "2026-11-13", "2026-12-01"]) {
      for (const start of [base(), base({ role: "none", confidence: null, kind: "check" })]) {
        const expected = filedAs(record(start), corrections, date);
        expect(filedFacts(start, "bio-2026-0001", corrections, date)).toEqual({
          field: expected.field, subfield: expected.subfield, kind: expected.kind, significance: expected.significance,
          role: expected.ai.role, confidence: expected.ai.confidence,
        });
      }
    }
  });

  it("files only what a correction names when the record is partly unknown, and a role of none gives no confidence", () => {
    const corrections = filing([["C-0001", "2026-11-12", "x", "significance", "landmark"], ["C-0002", "2026-11-12", "x", "ai.role", "none"]]);
    expect(filedFacts(NONE, "x", corrections, "2026-11-12")).toEqual({ ...NONE, significance: "landmark", role: "none" });
    expect(filedFacts({ ...NONE, confidence: "claimed" }, "x", corrections, "2026-11-12").confidence).toBeNull();
    expect(filedFacts({ ...NONE, confidence: "claimed" }, "x", [], "2026-11-12").confidence).toBe("claimed");
    expect(filedFacts(NONE, "x", corrections, "2026-11-11")).toEqual(NONE);
  });

  it("returns the base itself for a finding with no id (a new finding is not corrected)", () => {
    const facts = base();
    expect(filedFacts(facts, null, filing([["C-0001", "2026-11-12", "bio-2026-0001", "significance", "landmark"]]), "2026-12-01")).toBe(facts);
  });
});

describe("the views of a draft", () => {
  const views = draftViews();

  it("lists the new findings first, then the findings the draft names or the context shows, once each", () => {
    expect(views.findings.map((f) => f.key)).toEqual(["new-1", "new-2", "math-2026-0002", "phys-2026-0003", "chem-2026-0004", "bio-2026-0001"]);
    expect(views.find("new-1")).toBe(views.findings[0]);
    expect(views.find("math-2026-0002")?.key).toBe("math-2026-0002");
    expect(views.find("new-9")).toBeNull();
    expect(views.find("earth-2026-0999")).toBeNull();
  });

  it("says why the edition names each finding", () => {
    const roles = Object.fromEntries(views.findings.map((f) => [f.key, f.roles]));
    expect(roles).toEqual({
      "new-1": ["story", "lead"],
      "new-2": ["item", "lead"],
      "math-2026-0002": ["item", "returning", "lead", "correction", "recent", "report"],
      "phys-2026-0003": ["rung_change", "correction", "recent"],
      "chem-2026-0004": ["recent"],
      "bio-2026-0001": ["recent", "report"],
    });
  });

  it("builds a new finding from the draft: its own values, English only, first published today", () => {
    const f = views.find("new-1")!;
    expect(f).toMatchObject({
      key: "new-1", id: null, ref: "new-1", origin: "new", known: true, basis: "draft", detail: "full", isNew: true, publishing: true, file: null,
      depth: "story", rung: "checked", first_published: "2026-11-20", first_brief: null, history: false, updated: null,
    });
    expect(f.title).toEqual({ en: "A sample protein result", zh: null });
    expect(f.explainer?.how_sure).toEqual({ en: "Checked by Example Journal.", zh: null });
    expect(f.explainer?.ai_helped).toEqual({ en: "Sample System 3, from Example Lab, did the work.", zh: null });
    expect(f.published).toEqual({ field: "biology", subfield: "proteins", kind: "result", significance: "major", role: "ai_solved", confidence: "confirmed" });
    expect(f.filedOn("2020-01-01")).toBe(f.published);
    expect(f.latest).toBe(f.published);
    expect(f.rung_history).toEqual([expect.objectContaining({ index: 0, rung: "checked", date: "2026-11-20", recorded: D, by: "agent", note: null, source_id: "s1" })]);
    expect(f.sources?.map((s) => [s.id, s.seen_as, s.added, s.index])).toEqual([["s1", null, null, 0], ["s2", null, null, 1]]);
    expect(f.reactions?.[0]).toMatchObject({ index: 0, source_id: "s2", who: "A. Reviewer", affiliation: "Example University" });
    expect(f.terms).toEqual([
      expect.objectContaining({ index: 0, id: null, name: "protein folding", isNew: true, definition: { en: "How a chain of amino acids curls into a shape.", zh: null } }),
      expect.objectContaining({ index: 1, id: "enzyme", name: "enzyme", isNew: false, definition: null }),
    ]);
    expect(f.ai?.systems).toEqual([{ index: 0, name: "Sample System 3", maker: "Example Lab" }]);
    expect(f.ai?.evidence[0]).toMatchObject({ index: 0, source_id: "s1", quote: "the system solved it", from_claimant: false });
    expect(f.go_deeper).toEqual(["s1"]);
    expect(f.since_then).toEqual([]);
  });

  it("reads the depth of a new finding from the story and the items", () => {
    expect(views.find("new-1")!.depth).toBe("story");
    expect(views.find("new-2")!.depth).toBe("item");
    const draft = weekdayDraft();
    draft.items = ["math-2026-0002"];
    expect(draftViews(draft).find("new-2")!.depth).toBeNull();
  });

  it("gives a new finding with no AI role no confidence, system or AI help", () => {
    const f = views.find("new-2")!;
    expect(f.published).toMatchObject({ role: "none", confidence: null });
    expect(f.explainer?.ai_helped).toBeNull();
    expect(f.ai).toMatchObject({ role: "none", systems: [], evidence: [] });
  });

  it("shows a stored finding through the context: its text where the context has it, else what the lists say", () => {
    const full = views.find("math-2026-0002")!;
    expect(full).toMatchObject({ origin: "stored", known: true, basis: "context", detail: "full", isNew: false, publishing: true, file: null, depth: null, rung: "preprint", first_published: "2026-10-02" });
    expect(full.explainer?.how_sure).toEqual({ en: "Checked by a proof assistant.", zh: null });
    expect(full.sources?.[0]).toMatchObject({ id: "s1", seen_as: "pack", added: "2026-10-02" });
    expect(full.rung_history?.[0]).toMatchObject({ rung: "preprint", recorded: "2026-10-02", by: "agent", note: null });
    const noted = weekdayContext();
    noted.reports[1]!.finding!.rung_history[0]!.note = "Posted early.";
    expect(draftViews(weekdayDraft(), noted).find("math-2026-0002")!.rung_history?.[0]?.note).toEqual({ en: "Posted early.", zh: null });
    expect(full.since_then?.[0]).toMatchObject({ date: "2026-10-20", source_ids: ["s1"] });
    expect(full.reactions).toBeNull();
    expect(full.figure).toBeNull();
    expect(full.who).toBeNull();
    expect(full.terms).toBeNull();
    expect(full.related).toBeNull();

    const partial = views.find("phys-2026-0003")!;
    expect(partial).toMatchObject({ basis: "context", detail: "partial", explainer: null, ai: null, rung_history: null, sources: null, rung: "preprint" });
    expect(partial.title).toEqual({ en: "A made-up result of phys-2026-0003", zh: null });
    expect(partial.published).toEqual({ field: "physics", subfield: null, kind: null, significance: "major", role: null, confidence: null });
    expect(partial.artefacts).toEqual({ doi: [], arxiv: [], lean: [], trial: [], pdb: [] });
  });

  it("files a stored finding with the draft's own corrections, dated D", () => {
    const math = views.find("math-2026-0002")!;
    expect(math.published.significance).toBe("notable");
    expect(math.latest.significance).toBe("major");
    expect(math.filedOn(D).significance).toBe("major");
    expect(math.filedOn(MONDAY).significance).toBe("notable");
    const phys = views.find("phys-2026-0003")!;
    expect(phys.latest).toEqual({ ...phys.published, field: "chemistry", subfield: "catalysis" });
    expect(views.find("chem-2026-0004")!.latest).toEqual(views.find("chem-2026-0004")!.published);
  });

  it("a later draft correction at a path beats an earlier one, and a removed one refiles nothing", () => {
    const draft = weekdayDraft();
    draft.corrections.push({
      finding_id: "math-2026-0002", edition_date: null, term_id: null, type: "correction", path: "significance", after: "major",
      reason: "The rating was changed again.", source_url: null, report_id: null,
    });
    expect(draftViews(draft).find("math-2026-0002")!.latest.significance).toBe("major");
    draft.corrections.push({
      finding_id: "math-2026-0002", edition_date: null, term_id: null, type: "removed", path: "explainer.how_sure", after: "[text removed]",
      reason: "Removed.", source_url: null, report_id: null,
    });
    expect(draftViews(draft).find("math-2026-0002")!.latest.significance).toBe("major");
  });

  it("finds no view for a key the draft and the context never name", () => {
    expect(views.find("earth-2026-0099")).toBeNull();
    expect(views.find("new-9")).toBeNull();
  });

  it("reads a key in the shape of a new ref as new, even with no new finding of that ref", () => {
    const draft = weekdayDraft();
    draft.items = ["new-2", "new-7"];
    const items = draftViews(draft).brief.items;
    expect(items.map((i) => [i.key, i.new, i.finding?.known ?? null])).toEqual([["new-2", true, true], ["new-7", true, null]]);
  });

  it("marks an id the context does not list as unknown, with nothing known about it", () => {
    const draft = weekdayDraft();
    draft.returning[0].finding_id = "earth-2026-0099";
    draft.items = ["new-2", "earth-2026-0099"];
    const found = draftViews(draft).find("earth-2026-0099")!;
    expect(found).toMatchObject({ known: false, basis: "context", detail: "partial", title: null, rung: null, explainer: null, sources: null });
    expect(found.artefacts).toBeNull();
    expect(found.first_published).toBeNull();
    expect(found.published).toEqual(NONE);
    expect(found.latest).toEqual(NONE);
  });

  it("counts a finding any context list names as known", () => {
    const context = weekdayContext();
    expect([...contextFindingIds(context)].sort()).toEqual(
      ["bio-2026-0001", "chem-2026-0004", "hum-2026-0005", "math-2026-0002", "phys-2026-0003"],
    );
    expect(contextFindingIds(sundayContext()).has("bio-2024-0007")).toBe(true);
    expect(contextFindingIds(sundayContext()).has("math-2025-0009")).toBe(true);
    expect(contextFindingIds(mondayContext()).has("chem-2026-0004")).toBe(true);
    // a flag on an edition or a term names no finding
    const flagged = weekdayContext();
    flagged.corrections.flagged.push({ ...flagged.corrections.flagged[0]!, finding_id: null, edition_date: "2026-11-20", path: "lead.0.text" });
    expect([...contextFindingIds(flagged)].sort()).toEqual([...contextFindingIds(context)].sort());
    const draft = weekdayDraft();
    draft.returning[0].finding_id = "hum-2026-0005";
    expect(draftViews(draft, context).find("hum-2026-0005")!.known).toBe(true);
  });

  it("counts the stored finding a pack candidate matches, and the week's setbacks and rung changes, even when no other list names them", () => {
    // a finding older than 30 days is in no list of recent findings, yet the candidate, the week and a returning entry name it
    const context: any = structuredClone(mondayContext());
    context.recent_findings = [];
    context.week.findings = [{ ...structuredClone(mondayContext().week!.findings[0]!), id: "soc-2025-0004" }];
    context.week.setbacks = ["chem-2025-0001"];
    context.week.rung_changes = [{ finding_id: "phys-2025-0002", from: "preprint", to: "retracted", date: "2026-11-20", by: "agent" }];
    context.candidates = [{ id: "cand-01", stored_finding: "bio-2025-0003" }, { id: "cand-02", stored_finding: null }];
    context.reports = [];
    context.rung_proposals = [];
    context.standing_stories = [];
    context.corrections.flagged = [];
    expect([...contextFindingIds(context)].sort()).toEqual(["bio-2025-0003", "chem-2025-0001", "phys-2025-0002", "soc-2025-0004"]);
    const draft: any = weekdayDraft();
    draft.returning[0].finding_id = "bio-2025-0003";
    const views = draftViews(draft, context);
    expect(views.find("bio-2025-0003")).toMatchObject({ known: true, basis: "context" });
    expect(views.find("math-2026-0002")!.known).toBe(false);
    // a candidate that matches no finding names none
    context.candidates = [{ id: "cand-02", stored_finding: null }];
    expect([...contextFindingIds(context)].sort()).toEqual(["chem-2025-0001", "phys-2025-0002", "soc-2025-0004"]);
  });

  it("builds the brief-level text: Lead, story and items with their updates, rung changes, ideas, Also noted, corrections, decisions, sources", () => {
    const b = views.brief;
    expect(b.file).toBeNull();
    expect(b.lead.map((x) => [x.text.en, x.refs])).toEqual([
      ["A sample protein result leads today.", ["new-1", "new-2"]], ["A proof is now published.", ["math-2026-0002"]],
    ]);
    expect(b.story).toMatchObject({ slot: "story", index: null, key: "new-1", new: true, update: null, returning: null, where: "story" });
    expect(b.story!.finding).toBe(views.find("new-1"));
    expect(b.items.map((i) => [i.key, i.index, i.new, i.update?.en ?? null, i.where])).toEqual([
      ["new-2", 0, true, null, "items[0]"], ["math-2026-0002", 1, false, "A journal published the proof.", "items[1]"],
    ]);
    expect(b.items[1]!.returning).toBe(b.returning[0]);
    expect(b.returning[0]).toMatchObject({ index: 0, finding_id: "math-2026-0002", source_ids: ["b1"], where: "returning[0]" });
    expect(b.returning[0]!.rung).toMatchObject({ index: 0, rung: "checked", date: "2026-11-23", recorded: D, by: "agent", source_id: "b1", where: "returning[0].rung" });
    expect(b.rung_changes).toEqual([expect.objectContaining({ finding_id: "phys-2026-0003", from: null, to: "disputed", date: "2026-11-23", by: "agent", where: "rung_changes[0]" })]);
    expect(b.rung_changes[0]!.rung).toMatchObject({ index: 0, rung: "disputed", source_id: "b2", note: { en: "The lab posted a notice.", zh: null } });
    expect(b.ideas).toEqual([expect.objectContaining({ index: 0, who: "A. Example", source_id: "b2", where: "ideas[0]" })]);
    expect(b.also).toEqual([expect.objectContaining({ field: "earth", source_id: "b3", where: "also[0]" })]);
    expect(b.deep_dive).toBeNull();
    expect(b.review).toBeNull();
    expect(b.corrections.map((c) => [c.index, c.id, c.finding_id, c.type, c.where])).toEqual([
      [0, null, "math-2026-0002", "correction", "corrections[0]"], [1, null, "phys-2026-0003", "correction", "corrections[1]"],
      [2, null, "phys-2026-0003", "correction", "corrections[2]"],
    ]);
    expect(b.report_decisions).toEqual([
      expect.objectContaining({ report_id: "R-0001", outcome: "rejected", correction: null, where: "report_decisions[0]" }),
      expect.objectContaining({ report_id: "R-0002", outcome: "upheld", correction: 0 }),
    ]);
    expect(b.sources.map((s) => [s.id, s.where])).toEqual([["b1", "sources[0]"], ["b2", "sources[1]"], ["b3", "sources[2]"]]);
  });

  it("lists the draft's own corrections as dated D, with the path and after", () => {
    expect(views.corrections).toHaveLength(3);
    expect(views.corrections[0]).toMatchObject({ index: 0, id: null, date: D, finding_id: "math-2026-0002", path: "significance", draft: true, publishing: true, before: null, trigger: null, report_id: "R-0002", where: "corrections[0]" });
    expect(views.corrections[0]!.after).toEqual({ en: "major", zh: null });
  });

  it("builds a Monday's review and a Sunday's deep dive", () => {
    const monday = weekdayDraft();
    monday.review = {
      big_picture: "This week the record moved on three fronts.", remarkable: { finding_id: "bio-2026-0001", note: "A made-up note." },
      strongest_against: { text: "One finding fell this week.", finding_ids: ["phys-2026-0003", "chem-2026-0004"], source_ids: ["b2"] },
    };
    const m = draftViews(monday, mondayContext()).brief.review!;
    expect(m.big_picture.en).toBe("This week the record moved on three fronts.");
    expect(m.remarkable).toEqual({ finding_id: "bio-2026-0001", note: { en: "A made-up note.", zh: null } });
    expect(m.strongest_against).toMatchObject({ finding_ids: ["phys-2026-0003", "chem-2026-0004"], source_ids: ["b2"] });
    expect([m.field_counts, m.fell, m.setbacks, m.where]).toEqual([null, null, null, "review"]);
    const roles = draftViews(monday, mondayContext()).find("chem-2026-0004")!.roles;
    expect(roles).toEqual(expect.arrayContaining(["against", "week"]));

    const sunday = weekdayDraft();
    sunday.deep_dive = { finding_id: "bio-2024-0007", text: "A made-up deep dive.", source_ids: ["b1"], why_today: "anniversary" };
    const views = draftViews(sunday, sundayContext());
    expect(views.brief.deep_dive).toMatchObject({ finding_id: "bio-2024-0007", why_today: "anniversary", source_ids: ["b1"], where: "deep_dive" });
    const candidate = views.find("bio-2024-0007")!;
    expect(candidate).toMatchObject({ basis: "context", detail: "full", known: true, roles: ["deep_dive", "ledger"] });
    expect(candidate.explainer?.found.en).toBe("A made-up system found a proof.");
    expect(candidate.published.significance).toBe("landmark");
  });

  it("builds views for a draft with no context: nothing about a stored finding is known", () => {
    const draft = weekdayDraft();
    const views = buildViews({ mode: "draft", date: D, draft, context: null, filing: [] });
    expect(views.find("new-1")!.known).toBe(true);
    expect(views.find("math-2026-0002")).toMatchObject({ known: false, detail: "partial", title: null });
    expect(views.findings.map((f) => f.key)).toEqual(["new-1", "new-2", "math-2026-0002", "phys-2026-0003"]);
  });

  it("points an issue at the string with where(): the draft's own paths", () => {
    const f = views.find("new-1")!;
    expect(f.where()).toBe("new_findings[0]");
    expect(f.where("explainer.how_sure")).toBe("new_findings[0].explainer.how_sure");
    expect(f.where("sources.1.url", "en")).toBe("new_findings[0].sources[1].url");
    expect(views.find("new-2")!.where("go_deeper.0")).toBe("new_findings[1].go_deeper[0]");
    expect(views.find("math-2026-0002")!.where("explainer.found")).toBe("findings[\"math-2026-0002\"].explainer.found");
    expect(views.brief.where("lead.0.text")).toBe("lead[0].text");
    expect(views.brief.where()).toBe("(root)");
  });
});

describe("the views of a stored brief", () => {
  const world = storedWorld();
  const views = publishedViews();

  it("lists the findings the brief names in the order it names them", () => {
    expect(views.findings.map((f) => f.key)).toEqual(["bio-2026-0001", "math-2026-0002", "phys-2026-0003"]);
    expect(views.findings.map((f) => f.roles)).toEqual([["story", "lead"], ["item"], ["item", "returning", "rung_change", "correction"]]);
  });

  it("lists the findings no brief names after those it does, by id", () => {
    const more = storedWorld();
    more.brief.story = null;
    more.brief.items = [];
    more.brief.lead = [];
    more.brief.rung_changes = [];
    more.brief.corrections = [];
    more.brief.reports = [];
    more.findings.reverse();
    const found = publishedViews(more).findings.map((f) => f.key);
    expect(found).toEqual(["bio-2026-0001", "math-2026-0002", "phys-2026-0003"]);
  });

  it("finds no view for an id no record has, even one the brief names", () => {
    const named = storedWorld();
    named.brief.items[1] = { ...named.brief.items[1]!, finding_id: "earth-2026-0099" };
    const v = publishedViews(named);
    expect(v.find("earth-2026-0099")).toBeNull();
    expect(v.brief.items[1]!.finding).toBeNull();
    expect(views.find("nope-2026-0001")).toBeNull();
  });

  it("builds a stored finding from its record: both languages, as first published", () => {
    const f = views.find("bio-2026-0001")!;
    expect(f).toMatchObject({
      key: "bio-2026-0001", id: "bio-2026-0001", ref: null, origin: "stored", known: true, basis: "record", detail: "full", isNew: true, publishing: true,
      file: "findings/bio-2026-0001.json", depth: "story", rung: "checked", first_brief: D, briefs: [D], history: false, updated: D,
    });
    expect(f.title).toEqual({ en: "A sample protein result", zh: "範例蛋白質成果" });
    expect(f.explainer?.how_sure.zh).toBe("範例期刊已查核。");
    expect(f.rung_history?.map((r) => [r.rung, r.recorded, r.by, r.note?.en ?? null])).toEqual([["preprint", "2026-10-05", "agent", null], ["checked", D, "agent", "Published in Example Journal."]]);
    expect(f.since_then?.[0]).toMatchObject({ date: "2026-11-23", text: { en: "A later sample fact.", zh: "後續範例事實。" }, source_ids: ["s1"] });
    expect(f.sources?.[1]).toMatchObject({ id: "s2", seen_as: "search", added: D });
    expect(f.terms).toEqual([expect.objectContaining({ id: "protein-folding", name: "protein folding", isNew: false, definition: { en: "How a chain of amino acids curls into a shape.", zh: null } })]);
  });

  it("names a term that is not in the glossary by its id read as words", () => {
    const more = storedWorld();
    more.terms = [];
    expect(publishedViews(more).find("bio-2026-0001")!.terms).toEqual([expect.objectContaining({ id: "protein-folding", name: "protein folding", definition: null })]);
  });

  it("marks the records being published and the finding that is new in this edition", () => {
    expect(views.findings.map((f) => [f.key, f.publishing, f.isNew])).toEqual([
      ["bio-2026-0001", true, true], ["math-2026-0002", true, true], ["phys-2026-0003", false, false],
    ]);
    const nothing = publishedViews(world, null);
    expect(nothing.findings.every((f) => !f.publishing)).toBe(true);
    expect(views.corrections.map((c) => [c.id, c.publishing, c.draft])).toEqual([["C-0001", false, false], ["C-0002", true, false]]);
  });

  it("files a stored finding by the stored corrections, by date and then id", () => {
    const more = storedWorld();
    more.findings[1].significance = "notable";
    const math = publishedViews(more).find("math-2026-0002")!;
    expect(math.published.significance).toBe("notable");
    expect(math.filedOn("2026-11-09").significance).toBe("notable");
    expect(math.filedOn("2026-11-10").significance).toBe("major");
    expect(math.latest.significance).toBe("major");
    const phys = views.find("phys-2026-0003")!;
    expect(phys.filedOn("2026-11-23").field).toBe("physics");
    expect(phys.filedOn(D).field).toBe("chemistry");
    expect(phys.latest.field).toBe("chemistry");
    expect(phys.published.field).toBe("physics");
  });

  it("builds the brief-level text of a stored brief in the draft's normal form", () => {
    const b = views.brief;
    expect(b.file).toBe(`briefs/${D}.json`);
    expect(b.lead).toEqual([expect.objectContaining({ refs: ["bio-2026-0001"], where: `briefs/${D}.json: lead[0]` })]);
    expect(b.lead[0]!.text.zh).toBe("今天的重點是一項範例蛋白質成果。");
    expect(b.story).toMatchObject({ slot: "story", key: "bio-2026-0001", new: true, update: null, returning: null, where: `briefs/${D}.json: story` });
    expect(b.items.map((i) => [i.key, i.new, i.update?.en ?? null])).toEqual([["math-2026-0002", true, null], ["phys-2026-0003", false, "A journal published the paper."]]);
    expect(b.returning).toEqual([]);
    expect(b.rung_changes).toEqual([expect.objectContaining({ finding_id: "phys-2026-0003", from: "preprint", to: "checked", by: "script", date: "2026-11-23", rung: null })]);
    expect(b.ideas[0]).toMatchObject({ who: "A. Example", source_id: "b1" });
    expect(b.corrections).toEqual([expect.objectContaining({ id: "C-0002", finding_id: "phys-2026-0003", type: "correction", reason: { en: "The field was wrong.", zh: "領域有誤。" } })]);
    expect(b.report_decisions).toEqual([]);
    expect(b.sources.map((s) => [s.id, s.added, s.seen_as])).toEqual([["b1", D, "pack"], ["b2", D, "pack"]]);
    expect(b.where("lead.0.text", "en")).toBe(`briefs/${D}.json: lead[0].text.en`);
  });

  it("builds a stored Monday's review with its computed counts, falls and setbacks", () => {
    const more = storedWorld();
    more.brief.format = "monday_review";
    more.brief.date = MONDAY;
    more.brief.review = {
      big_picture: { en: "This week the record moved.", zh: null }, remarkable: { finding_id: "bio-2026-0001", note: { en: "A note.", zh: null } },
      strongest_against: { text: { en: "None found.", zh: null }, finding_ids: [], source_ids: [] },
      field_counts: [{ field: "biology", reported: 1, counted: 1 }], fell: ["phys-2026-0003"], setbacks: [],
    };
    const review = buildViews({ mode: "published", date: MONDAY, filing: more.corrections, being: beingPublishedOf(null, more, null), ...more }).brief.review!;
    expect(review.fell).toEqual(["phys-2026-0003"]);
    expect(review.setbacks).toEqual([]);
    expect(review.field_counts).toEqual([{ field: "biology", reported: 1, counted: 1 }]);
    expect(review.remarkable?.finding_id).toBe("bio-2026-0001");
  });

  it("builds the views of records no brief names, on the date given", () => {
    const more = storedWorld();
    const records = buildViews({ mode: "published", date: D, filing: more.corrections, being: beingPublishedOf(null, more, null), ...more, brief: null });
    expect(records.brief).toMatchObject({ file: null, lead: [], story: null, items: [], returning: [], rung_changes: [], ideas: [], also: [], deep_dive: null, review: null, corrections: [], report_decisions: [], sources: [] });
    expect(records.findings.map((f) => f.key)).toEqual(["bio-2026-0001", "math-2026-0002", "phys-2026-0003"]);
    expect(records.findings.every((f) => f.roles.length === 0)).toBe(true);
  });
});

describe("which rung entries and sources are being published (F-55)", () => {
  const rungs = (f: FindingView): boolean[] => (f.rung_history ?? []).map((r) => r.publishing);
  const sources = (f: FindingView): boolean[] => (f.sources ?? []).map((x) => x.publishing);

  /** The stored world with phys-2026-0003 changed on D, its first source added the day before and its first rung entry recorded then. */
  const returningWorld = () => {
    const world = storedWorld();
    const phys = world.findings.find((f) => f.id === "phys-2026-0003")!;
    phys.updated = D;
    phys.rung_history[0]!.recorded = "2026-11-20";
    phys.sources[0]!.added = "2026-11-20";
    return world;
  };

  it("holds every entry and source of a draft, a new finding's, one a draft names through the context and the brief's, as being published", () => {
    const views = draftViews();
    for (const f of views.findings) {
      expect(f.publishing, f.key).toBe(true);
      expect([...rungs(f), ...sources(f)].every(Boolean), f.key).toBe(true);
    }
    expect(views.findings.filter((f) => f.origin === "new").map((f) => rungs(f).length).every((n) => n > 0)).toBe(true);
    expect(views.brief.sources.length).toBeGreaterThan(0);
    expect(views.brief.sources.every((x) => x.publishing)).toBe(true);
    expect(views.brief.returning.every((r) => r.rung === null || r.rung.publishing)).toBe(true);
    expect(views.brief.rung_changes.every((c) => c.rung!.publishing)).toBe(true);
    const sunday = weekdayDraft();
    sunday.deep_dive = { finding_id: "bio-2024-0007", text: "A made-up deep dive.", source_ids: ["b1"], why_today: "anniversary" };
    const candidate = draftViews(sunday, sundayContext()).find("bio-2024-0007")!;
    expect(candidate.basis).toBe("context");
    expect(rungs(candidate).length + sources(candidate).length).toBeGreaterThan(0);
    expect([...rungs(candidate), ...sources(candidate)].every(Boolean)).toBe(true);
  });

  it("holds every entry and source of a finding first briefed on D as being published, and none of one that D left alone", () => {
    const views = publishedViews();
    expect(rungs(views.find("bio-2026-0001")!)).toEqual([true, true]);
    expect(sources(views.find("bio-2026-0001")!)).toEqual([true, true]);
    expect(sources(views.find("math-2026-0002")!)).toEqual([true, true]);
    // phys-2026-0003 was last changed the day before D
    expect(rungs(views.find("phys-2026-0003")!)).toEqual([false, false]);
    expect(sources(views.find("phys-2026-0003")!)).toEqual([false, false]);
    const idle = publishedViews(storedWorld(), null);
    for (const f of idle.findings) expect([...rungs(f), ...sources(f)].some(Boolean), f.key).toBe(false);
  });

  it("holds only the entries and sources D gave a returning finding as being published, and the finding itself as not", () => {
    const views = publishedViews(returningWorld());
    const phys = views.find("phys-2026-0003")!;
    expect(phys.publishing).toBe(false);
    expect(rungs(phys)).toEqual([false, true]);
    expect(sources(phys)).toEqual([false, true]);
    // the entries of the finding first briefed on D are still all of them
    expect(rungs(views.find("bio-2026-0001")!)).toEqual([true, true]);
    // a note, alone, makes the finding a returning one with no entry or source being published
    const world = returningWorld();
    const f = world.findings.find((x) => x.id === "phys-2026-0003")!;
    f.rung_history[1]!.recorded = "2026-11-20";
    f.sources[1]!.added = "2026-11-20";
    f.since_then[0]!.date = D;
    const noted = publishedViews(world).find("phys-2026-0003")!;
    expect([rungs(noted), sources(noted)]).toEqual([[false, false], [false, false]]);
  });

  it("holds a stored brief's sources as being published only when the brief is", () => {
    expect(publishedViews().brief.sources.map((x) => x.publishing)).toEqual([true, true]);
    expect(publishedViews(storedWorld(), null).brief.sources.map((x) => x.publishing)).toEqual([false, false]);
    expect(publishedViews(storedWorld(), "2026-11-10").brief.sources.map((x) => x.publishing)).toEqual([false, false]);
  });
});

describe("one normal form for a draft and a stored brief", () => {
  it("gives every finding view the same keys, whatever it is built from", () => {
    const d = draftViews();
    const p = publishedViews();
    const all = [...d.findings, ...p.findings];
    const expected = keysOf(d.findings[0]!);
    for (const f of all) expect(keysOf(f)).toEqual(expected);
  });

  it("gives the same keys to the parts that both modes have", () => {
    const d = draftViews();
    const p = publishedViews();
    const pairs: [object | undefined | null, object | undefined | null][] = [
      [d.find("new-1")!.explainer, p.find("bio-2026-0001")!.explainer],
      [d.find("new-1")!.ai, p.find("bio-2026-0001")!.ai],
      [d.find("new-1")!.ai!.evidence[0], p.find("bio-2026-0001")!.ai!.evidence[0]],
      [d.find("new-1")!.ai!.systems[0], p.find("bio-2026-0001")!.ai!.systems[0]],
      [d.find("new-1")!.rung_history![0], p.find("bio-2026-0001")!.rung_history![0]],
      [d.find("new-1")!.sources![0], p.find("bio-2026-0001")!.sources![0]],
      [d.find("new-1")!.reactions![0], p.find("bio-2026-0001")!.reactions![0]],
      [d.find("new-1")!.who![0], p.find("bio-2026-0001")!.who![0]],
      [d.find("new-1")!.terms![0], p.find("bio-2026-0001")!.terms![0]],
      [d.find("math-2026-0002")!.since_then![0], p.find("bio-2026-0001")!.since_then![0]],
      [d.brief, p.brief],
      [d.brief.story, p.brief.story],
      [d.brief.items[0], p.brief.items[0]],
      [d.brief.lead[0], p.brief.lead[0]],
      [d.brief.rung_changes[0], p.brief.rung_changes[0]],
      [d.brief.ideas[0], p.brief.ideas[0]],
      [d.brief.also[0], p.brief.also[0]],
      [d.brief.corrections[0], p.brief.corrections[0]],
      [d.brief.sources[0], p.brief.sources[0]],
      [d.corrections[0], p.corrections[0]],
    ];
    for (const [a, b] of pairs) {
      expect(a).toBeTruthy();
      expect(b).toBeTruthy();
      expect(keysOf(a!)).toEqual(keysOf(b!));
    }
    for (const f of [...d.findings, ...p.findings]) {
      if (f.title !== null) expect(keysOf(f.title)).toEqual(["en", "zh"]);
    }
  });

  it("holds the same text in both, with Chinese only where the record has it", () => {
    const d = draftViews().find("new-1")!;
    const p = publishedViews().find("bio-2026-0001")!;
    expect(d.title!.en).toBe(p.title!.en);
    expect(d.explainer!.found.en).toBe(p.explainer!.found.en);
    expect(d.title!.zh).toBeNull();
    expect(p.title!.zh).toBe("範例蛋白質成果");
  });

  // A string that is one side of an L10n on a stored record has its language at the end of its path; a plain string has none.
  const sideOf = (e: { path: string; lang: "en" | "zh" }): "en" | "zh" | undefined => (e.path.endsWith(`.${e.lang}`) ? e.lang : undefined);

  it("agrees with the string inventory on where each string of a finding is", () => {
    const draft = buildDraftInput(weekdayDraft(), { context: weekdayContext(), config: storedWorld().config });
    const stored = buildPublishedInput(storedWorld().brief, storedWorld(), { config: storedWorld().config, publishing: D });
    for (const input of [draft, stored]) {
      const entries = input.inventory.entries.filter((e) => e.record.type === "finding" || e.record.type === "new_finding");
      expect(entries.length).toBeGreaterThan(40);
      for (const e of entries) expect(input.views.find(e.finding!)!.where(e.at, sideOf(e)), e.path).toBe(e.path);
    }
  });

  it("agrees with the string inventory on where each brief-level string is", () => {
    const draft = buildDraftInput(weekdayDraft(), { context: weekdayContext(), config: storedWorld().config });
    const stored = buildPublishedInput(storedWorld().brief, storedWorld(), { config: storedWorld().config, publishing: D });
    for (const input of [draft, stored]) {
      const entries = input.inventory.entries.filter((e) => e.record.type === "draft" || e.record.type === "brief");
      expect(entries.length).toBeGreaterThan(15);
      for (const e of entries) expect(input.views.brief.where(e.at, sideOf(e)), e.path).toBe(e.path);
    }
  });
});

describe("an existing term of a draft's new finding is named by the glossary's own name (F-48)", () => {
  const glossaryTerm = (id: string, name: string): Term => Term.parse({
    id, en: { term: name, definition: "A made-up definition." }, zh: { term: "範例術語", definition: "範例定義。", official: null, official_url: null },
    fields: ["biology"], first_finding: "bio-2026-0001", first_date: D,
  });
  const ACCENT = "Schr\u00f6dinger equation";
  const GLOSSARY = [glossaryTerm("schrodinger-equation", ACCENT), glossaryTerm("newtons-laws", "Newton's laws"), glossaryTerm("enzyme", "Enzyme, the made-up kind")];
  const drafted = (stored: StoredRecords | null) => {
    const draft = weekdayDraft();
    draft.new_findings[0]!.terms = [
      { new: true, term: "protein folding", definition: "How a chain of amino acids curls into a shape." },
      { new: false, id: "schrodinger-equation" }, { new: false, id: "newtons-laws" }, { new: false, id: "enzyme" }, { new: false, id: "virtual-unwrapping" },
    ];
    return buildViews({ mode: "draft", date: D, draft, context: weekdayContext(), filing: [], stored }).find("new-1")!.terms!;
  };
  const given = (terms: Term[]): StoredRecords => ({ findings: [], corrections: [], terms });

  it("takes the name from the stored glossary, accents and apostrophes kept, and the id read as words for a term the glossary lacks", () => {
    expect(drafted(given(GLOSSARY)).map((t) => [t.id, t.name, t.isNew, t.definition])).toEqual([
      [null, "protein folding", true, { en: "How a chain of amino acids curls into a shape.", zh: null }],
      ["schrodinger-equation", ACCENT, false, null],
      ["newtons-laws", "Newton's laws", false, null],
      ["enzyme", "Enzyme, the made-up kind", false, null],
      ["virtual-unwrapping", "virtual unwrapping", false, null],
    ]);
  });

  it("reads each id as words, byte for byte as before, when the run holds no glossary or one that lacks the term", () => {
    const words = [[null, "protein folding"], ["schrodinger-equation", "schrodinger equation"], ["newtons-laws", "newtons laws"], ["enzyme", "enzyme"], ["virtual-unwrapping", "virtual unwrapping"]];
    expect(drafted(null).map((t) => [t.id, t.name])).toEqual(words);
    expect(drafted(given([])).map((t) => [t.id, t.name])).toEqual(words);
    expect(drafted(given([GLOSSARY[2]!])).map((t) => [t.id, t.name])).toEqual([...words.slice(0, 3), ["enzyme", "Enzyme, the made-up kind"], words[4]]);
  });

  it("reads every hyphen of an id as a space, not the first alone", () => {
    const draft = weekdayDraft();
    draft.new_findings[0]!.terms = [{ new: false, id: "double-slit-experiment" }, { new: false, id: "a-b-c-d" }];
    const terms = buildViews({ mode: "draft", date: D, draft, context: weekdayContext(), filing: [], stored: null }).find("new-1")!.terms!;
    expect(terms.map((t) => t.name)).toEqual(["double slit experiment", "a b c d"]);
  });

  it("gives each term its own name when the glossary holds several, whatever their order", () => {
    expect(drafted(given([...GLOSSARY].reverse())).map((t) => t.name)).toEqual(drafted(given(GLOSSARY)).map((t) => t.name));
  });

  it("leaves a stored finding's terms to its own record, and a stored brief's views as they were", () => {
    const world = storedWorld();
    expect(publishedViews(world).find("bio-2026-0001")!.terms!.map((t) => t.name)).toEqual(["protein folding"]);
  });
});

describe("the views of a draft take a stored string as removed where a stored removed correction names it and its record holds REMOVED_TEXT (F-43)", () => {
  const removal = (id: string, target: { finding?: string; term?: string }, path: string): Correction => Correction.parse({
    id, date: "2026-11-23", finding_id: target.finding ?? null, edition_date: null, term_id: target.term ?? null, type: "removed", path,
    before: structuredClone(REMOVED_BEFORE), after: structuredClone(REMOVED_TEXT), reason: l("A safety check flagged the text."), source_url: null,
    trigger: "recheck", report_id: null,
  });
  /** The stored records a run is given, with a finding's string and a term's definition removed by corrections, the records holding the marker or not. */
  const view = (hold: boolean) => {
    const world = storedWorld();
    world.findings.find((f) => f.id === "math-2026-0002")!.terms = ["protein-folding"];
    world.corrections.push(removal("C-0003", { finding: "math-2026-0002" }, "explainer.how_sure"), removal("C-0004", { term: "protein-folding" }, "definition"));
    if (hold) holdRemoved(world);
    const stored: StoredRecords = { findings: world.findings, corrections: world.corrections, terms: world.terms };
    return buildViews({ mode: "draft", date: D, draft: weekdayDraft(), context: weekdayContext(), filing: [], stored }).find("math-2026-0002")!;
  };

  it("lists the removed path of the stored finding and its term's removed definition", () => {
    const found = view(true);
    expect([...found.removed]).toEqual(["explainer.how_sure"]);
    expect(found.terms!.map((t) => t.removed)).toEqual([true]);
  });

  it("lists nothing where the records hold other text, whatever the corrections say", () => {
    const found = view(false);
    expect([...found.removed]).toEqual([]);
    expect(found.terms!.map((t) => t.removed)).toEqual([false]);
  });
});

describe("the views of a large draft are built in linear time (F-57)", () => {
  const N = 10_000;
  // Long ids that differ at their ends: a search of the returning list for each item compares them in full
  const PREFIX = "x".repeat(150);
  const ids = Array.from({ length: N }, (_, i) => `${PREFIX}-${String(i).padStart(6, "0")}`);
  const large = (): any => {
    const draft: any = weekdayDraft();
    draft.items = ids;
    draft.returning = ids.map((id) => ({ finding_id: id, update: `A made-up update for ${id.slice(-6)}.`, source_ids: [], rung: null }));
    return draft;
  };

  it("builds the views of 10,000 items with 10,000 returning entries in well under a second, each item with its own entry", () => {
    const draft = large();
    const start = performance.now();
    const views = buildViews({ mode: "draft", date: D, draft, context: null, filing: [] });
    const took = performance.now() - start;
    expect(views.brief.items).toHaveLength(N);
    expect(views.brief.returning).toHaveLength(N);
    for (const i of [0, 1, 4_999, 5_000, N - 2, N - 1]) {
      const item = views.brief.items[i]!;
      expect(item.returning, String(i)).toBe(views.brief.returning[i]);
      expect(item.returning!.finding_id).toBe(ids[i]);
      expect(item.update).toEqual(views.brief.returning[i]!.update);
    }
    expect(views.brief.items.every((item, i) => item.returning === views.brief.returning[i] && item.update === views.brief.returning[i]!.update)).toBe(true);
    expect(took).toBeLessThan(600);
  });

  it("gives an item the first returning entry of its finding when the draft has two, and none when it has none", () => {
    const draft = weekdayDraft();
    draft.items = ["math-2026-0002", "phys-2026-0003", "chem-2026-0004"];
    draft.returning = [
      { finding_id: "phys-2026-0003", update: "The first update.", source_ids: [], rung: null },
      { finding_id: "math-2026-0002", update: "The only update.", source_ids: [], rung: null },
      { finding_id: "phys-2026-0003", update: "The second update.", source_ids: [], rung: null },
    ];
    const views = buildViews({ mode: "draft", date: D, draft, context: weekdayContext(), filing: [] });
    const [math, phys, chem] = views.brief.items;
    expect([math!.returning?.index, phys!.returning?.index, chem!.returning]).toEqual([1, 0, null]);
    expect([math!.update, phys!.update, chem!.update]).toEqual([views.brief.returning[1]!.update, views.brief.returning[0]!.update, null]);
    expect(views.brief.returning.map((r) => r.index)).toEqual([0, 1, 2]);
  });
});

describe("the views of a stored brief take a string as removed where a stored removed correction names it and its record holds REMOVED_TEXT (F-43)", () => {
  const removal = (id: string, target: { finding?: string; edition?: string; term?: string }, path: string): Correction => Correction.parse({
    id, date: D, finding_id: target.finding ?? null, edition_date: target.edition ?? null, term_id: target.term ?? null, type: "removed", path,
    before: structuredClone(REMOVED_BEFORE), after: structuredClone(REMOVED_TEXT), reason: l("A safety check flagged the text."), source_url: null,
    trigger: "recheck", report_id: null,
  });
  /** The stored world with three removals filed (a finding's string, the brief's string, a term's definition), the records holding the marker or not. */
  const views = (hold: boolean): Views => {
    const world = storedWorld();
    world.corrections.push(
      removal("C-0003", { finding: "bio-2026-0001" }, "explainer.how_sure"), removal("C-0004", { edition: D }, "lead.0.text"),
      removal("C-0005", { term: "protein-folding" }, "definition"),
    );
    if (hold) holdRemoved(world);
    return buildViews({ mode: "published", date: world.brief.date, filing: world.corrections, being: beingPublishedOf(world.brief, world, D), ...world });
  };

  it("lists each removed path of a finding, of the brief and of a term's definition", () => {
    const v = views(true);
    expect([...v.find("bio-2026-0001")!.removed]).toEqual(["explainer.how_sure"]);
    expect([...v.brief.removed]).toEqual(["lead.0.text"]);
    expect(v.find("bio-2026-0001")!.terms!.map((t) => t.removed)).toEqual([true]);
    expect([...v.find("math-2026-0002")!.removed]).toEqual([]);
    expect([...v.find("phys-2026-0003")!.removed]).toEqual([]);
  });

  it("lists nothing where the records hold other text, whatever the corrections say", () => {
    const v = views(false);
    for (const f of v.findings) expect([...f.removed], f.key).toEqual([]);
    expect([...v.brief.removed]).toEqual([]);
    expect(v.find("bio-2026-0001")!.terms!.map((t) => t.removed)).toEqual([false]);
  });
});

describe("the views change nothing they read", () => {
  it("builds a draft's views from frozen inputs, and the inputs are the same afterwards", () => {
    const draft = deepFreeze(weekdayDraft());
    const context = deepFreeze(weekdayContext());
    const before = JSON.stringify([draft, context]);
    const filings = draftFilings(draft.corrections, [], D);
    const views = buildViews({ mode: "draft", date: D, draft, context, filing: filings });
    views.findings.forEach((f) => { f.filedOn(D); f.where("title"); });
    expect(JSON.stringify([draft, context])).toBe(before);
    expect(views.findings).toHaveLength(6);
  });

  it("builds a stored brief's views from frozen records, and the records are the same afterwards", () => {
    const world = deepFreeze(storedWorld());
    const before = JSON.stringify(world);
    const views = publishedViews(world);
    views.findings.forEach((f) => { f.filedOn(D); f.where("title", "en"); });
    expect(JSON.stringify(world)).toBe(before);
    expect(views.findings).toHaveLength(3);
  });
});

describe("storedFinding() sanity", () => {
  it("makes distinct records for distinct ids", () => {
    expect(storedFinding("math-2026-0002").field).toBe("mathematics");
    expect(storedFinding("phys-2026-0003").field).toBe("physics");
    expect(storedFinding("chem-2026-0004").field).toBe("chemistry");
    expect(storedFinding().field).toBe("biology");
  });
});
