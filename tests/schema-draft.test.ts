// lib/schema/draft.ts (SPEC §4.5): the English agent's draft, `DraftBrief`, and the JSON Schema generated from it. A full
// valid weekday draft, a Monday review, a Sunday deep dive and a quiet day, built by hand, and a failing value for each
// constraint, among them the SCHEMA checks of a draft correction's `path` and `after`; inline data.

import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { REMOVED_TEXT, type Kind } from "@/lib/vocab";
import { jsonText } from "@/lib/json";
import type { Rung } from "@/lib/schema/common";
import { Brief, BriefBase } from "@/lib/schema/brief";
import { Finding } from "@/lib/schema/finding";
import {
  DraftAlso, DraftBrief, DraftCorrection, DraftCorrectionBase, DraftDeepDive, DraftExplainer, DraftFigure, DraftFinding, DraftFindingBase,
  DraftFindingRung, DraftIdea, DraftLeadLine, DraftReportDecision, DraftReturning, DraftReview, DraftRung, DraftRungChange, DraftTerm,
  DraftTermKnown, DraftTermNew,
  FindingRef, REMOVABLE_PATHS, correctionProblems, correctionRecord, isRemovablePath,
  type DraftBrief as DraftBriefType, type DraftCorrection as DraftCorrectionType, type DraftFinding as DraftFindingType,
  type DraftFigure as DraftFigureType, type DraftReturning as DraftReturningType, type DraftRung as DraftRungType,
  type DraftTerm as DraftTermType,
} from "@/lib/schema/draft";
import { expectIssue, expectMutationFails, expectOnlyIssue, expectValid, issuesOf } from "./helpers/zod-issues";

const DRAFT_KEYS = [
  "schema_version", "date", "generated_at", "lead", "story", "items", "new_findings", "returning", "rung_changes", "ideas", "also",
  "deep_dive", "review", "corrections", "report_decisions", "sources",
];

const FINDING_KEYS = [
  "ref", "field", "subfield", "kind", "title", "explainer", "go_deeper", "ai", "significance", "rung_history", "sources", "reactions",
  "artefacts", "figure", "who", "terms", "related", "first_published",
];

const draftSource = (n: number) => ({
  id: `s${n}`, kind: "paper", title: "A made-up paper", publisher: "Example Journal", url: `https://example.org/paper/${n}`,
  doi: n === 1 ? "10.1234/example.1" : null, published_at: "2026-11-20",
});

const briefSource = (n: number) => ({
  id: `b${n}`, kind: "statement", title: "A made-up statement", publisher: "Example Institute", url: `https://example.org/statement/${n}`,
  doi: null, published_at: "2026-11-23",
});

/** A new finding with an AI role, as the English agent writes it. */
const newFinding = (ref = "new-1") => ({
  ref,
  field: "biology",
  subfield: "proteins",
  kind: "result",
  title: "A sample protein result",
  explainer: {
    found: "Sample found text.",
    matters: "Sample matters text.",
    ai_helped: "Sample System 3, from Example Lab, did the work.",
    how_sure: "Checked by Example Journal.",
    background: "Sample background text.",
    could_lead: "It could lead to sample uses.",
  },
  go_deeper: ["s1"],
  ai: {
    role: "ai_solved",
    confidence: "confirmed",
    systems: [{ name: "Sample System 3", maker: "Example Lab" }],
    evidence: [{ source_id: "s1", quote: "the system solved it", from_claimant: false }],
  },
  significance: "major",
  rung_history: [{ rung: "checked", date: "2026-11-20", source_id: "s1", note: null }],
  sources: [draftSource(1)],
  reactions: [],
  artefacts: { doi: ["10.1234/example.1"], arxiv: [], lean: [], trial: [], pdb: [] },
  figure: null,
  who: [{ name: "Example Lab", ror: null }],
  terms: [{ new: true, term: "protein folding", definition: "How a chain of amino acids curls into a shape." }, { new: false, id: "enzyme" }],
  related: ["bio-2026-0002"],
  first_published: "2026-11-20",
});

/** A new finding with no AI role: no confidence, no system, no evidence and no How AI helped. */
const noRole = (ref = "new-2") => {
  const f: any = newFinding(ref);
  f.kind = "check";
  f.ai = { role: "none", confidence: null, systems: [], evidence: [] };
  f.explainer.ai_helped = null;
  return f;
};

const correction = (over: Record<string, unknown> = {}) => ({
  finding_id: "chem-2026-0004", edition_date: null, term_id: null, type: "correction", path: "explainer.how_sure",
  after: "Checked by Example Journal.", reason: "The wording was wrong.", source_url: null, report_id: null, ...over,
});

/** A full Tuesday draft: a story and an item, both new, a returning finding, a rung change, an idea, an also-noted line, a correction and two report decisions. */
const weekday = () => ({
  schema_version: 1,
  date: "2026-11-24",
  generated_at: "2026-11-24T04:10:00+08:00",
  lead: [
    { text: "A sample protein result leads today.", refs: ["new-1", "new-2"] },
    { text: "A proof is now published.", refs: ["math-2026-0002"] },
  ],
  story: "new-1",
  items: ["new-2", "math-2026-0002"],
  new_findings: [newFinding("new-1"), noRole("new-2")],
  returning: [{
    finding_id: "math-2026-0002", update: "A journal published the proof.", source_ids: ["b1"],
    rung: { rung: "checked", date: "2026-11-23", source_id: "b1", note: null },
  }],
  rung_changes: [{ finding_id: "phys-2026-0003", rung: { rung: "disputed", date: "2026-11-23", source_id: "b2", note: "The lab posted a notice." } }],
  ideas: [{ text: "A made-up argument about method.", who: "A. Example", source_id: "b2" }],
  also: [{ title: "A made-up soil study", field: "earth", source_id: "b3" }],
  deep_dive: null,
  review: null,
  corrections: [correction({ report_id: "R-0002", after: "Checked by Example Journal, with one open question." })],
  report_decisions: [
    { report_id: "R-0001", outcome: "rejected", reason: "The source says this.", correction: null },
    { report_id: "R-0002", outcome: "upheld", reason: "The wording was unclear.", correction: 0 },
  ],
  sources: [briefSource(1), briefSource(2), briefSource(3)],
});

/** A Monday draft: the review, and at most two findings. */
const monday = () => ({
  ...weekday(),
  date: "2026-11-23",
  generated_at: "2026-11-23T04:10:00+08:00",
  lead: [{ text: "A sample protein result leads today.", refs: ["new-1"] }, { text: "A proof is now published.", refs: ["math-2026-0002"] }],
  items: ["math-2026-0002"],
  new_findings: [newFinding("new-1")],
  review: {
    big_picture: "This week the record moved on three fronts.",
    remarkable: { finding_id: "bio-2026-0001", note: "A made-up note." },
    strongest_against: { text: "One finding fell this week.", finding_ids: ["phys-2026-0003"], source_ids: ["b2"] },
  },
});

/** A Sunday draft: one new finding and the deep dive on one finding of the Ledger. */
const sunday = () => ({
  ...weekday(),
  date: "2026-11-22",
  generated_at: "2026-11-22T04:10:00+08:00",
  lead: [{ text: "A sample protein result leads today.", refs: ["new-1"] }],
  items: [],
  new_findings: [newFinding("new-1")],
  returning: [],
  deep_dive: { finding_id: "bio-2024-0007", text: "A made-up deep dive.", source_ids: ["b1"], why_today: "anniversary" },
});

/** A quiet day: nothing met the bar, and the Lead says so. */
const quiet = () => ({
  schema_version: 1, date: "2026-11-25", generated_at: "2026-11-25T04:10:00+08:00",
  lead: [{ text: "A quiet day: no new finding met the bar.", refs: [] }],
  story: null, items: [], new_findings: [], returning: [], rung_changes: [], ideas: [], also: [], deep_dive: null, review: null,
  corrections: [], report_decisions: [], sources: [],
});

describe("DraftBrief: the valid drafts", () => {
  it("accepts a weekday draft, a Monday review, a Sunday deep dive and a quiet day", () => {
    for (const d of [weekday(), monday(), sunday(), quiet()]) expectValid(DraftBrief, d);
  });

  it("keeps the keys in the spec's order, so the generated JSON Schema lists them as the spec does", () => {
    expect(Object.keys(DraftBrief.shape)).toEqual(DRAFT_KEYS);
    expect(Object.keys(DraftFinding.shape)).toEqual(FINDING_KEYS);
    const shuffled = Object.fromEntries(Object.entries(weekday()).reverse());
    expect(Object.keys(DraftBrief.parse(shuffled))).toEqual(DRAFT_KEYS);
    expect(JSON.parse(jsonText(shuffled, DraftBrief)).story).toBe("new-1");
  });

  it("has the types the spec gives: plain English strings, refs and the draft's own parts", () => {
    expectTypeOf<DraftBriefType["story"]>().toEqualTypeOf<string | null>();
    expectTypeOf<DraftBriefType["items"]>().toEqualTypeOf<string[]>();
    expectTypeOf<DraftBriefType["lead"][number]>().toEqualTypeOf<{ text: string; refs: string[] }>();
    expectTypeOf<DraftFindingType["kind"]>().toEqualTypeOf<Exclude<Kind, "idea">>();
    expectTypeOf<DraftFindingType["explainer"]["ai_helped"]>().toEqualTypeOf<string | null>();
    expectTypeOf<DraftFindingType["title"]>().toEqualTypeOf<string>();
    expectTypeOf<DraftFindingType["sources"][number]["id"]>().toEqualTypeOf<string>();
    expectTypeOf<DraftTermType>().toEqualTypeOf<{ new: true; term: string; definition: string } | { new: false; id: string }>();
    expectTypeOf<DraftRungType>().toEqualTypeOf<{ rung: Rung; date: string; source_id: string; note: string | null }>();
    expectTypeOf<DraftReturningType["rung"]>().toEqualTypeOf<DraftRungType | null>();
    expectTypeOf<DraftFigureType["alt"]>().toEqualTypeOf<string>();
    expectTypeOf<DraftCorrectionType["finding_id"]>().toEqualTypeOf<string | null>();
    expectTypeOf<DraftBriefType["report_decisions"][number]["correction"]>().toEqualTypeOf<number | null>();
  });

  it("is the brief's difference: refs and English strings, with none of the S fields", () => {
    for (const key of ["edition", "format", "languages", "published_at", "late", "pace", "disclosure", "status_note", "computed", "provenance"]) {
      expect(Object.keys(DraftBrief.shape)).not.toContain(key);
      expectMutationFails(DraftBrief, weekday(), (d) => { d[key] = null; }, "", "Unrecognized key");
    }
    for (const key of ["generated_at", "new_findings", "returning", "report_decisions"]) expect(Object.keys(BriefBase.shape)).not.toContain(key);
    // a Lead sentence is a plain string with refs here, an L10n with finding ids in a brief
    expectMutationFails(DraftBrief, weekday(), (d) => { d.lead[0].text = { en: "A sentence.", zh: null }; }, "lead.0.text");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.lead[0].finding_ids = []; }, "lead.0", "Unrecognized key");
    // and the other way round: a draft is not a brief
    expectIssue(Brief, weekday(), "story");
    expectIssue(Brief, weekday(), "lead.0.text");
  });
});

describe("DraftBrief: keys, nulls and unknown keys", () => {
  it("needs every key", () => {
    for (const key of DRAFT_KEYS) expectMutationFails(DraftBrief, weekday(), (d) => delete d[key], key);
    for (const key of FINDING_KEYS) expectMutationFails(DraftBrief, weekday(), (d) => delete d.new_findings[0][key], `new_findings.0.${key}`);
  });

  it("refuses null where the spec has no null", () => {
    const nullable = new Set(["story", "deep_dive", "review"]);
    for (const key of DRAFT_KEYS.filter((k) => !nullable.has(k))) expectMutationFails(DraftBrief, weekday(), (d) => { d[key] = null; }, key);
    const nullableFinding = new Set(["figure"]);
    for (const key of FINDING_KEYS.filter((k) => !nullableFinding.has(k))) {
      expectMutationFails(DraftBrief, weekday(), (d) => { d.new_findings[0][key] = null; }, `new_findings.0.${key}`);
    }
    expectMutationFails(DraftBrief, weekday(), (d) => { d.new_findings[0].explainer.found = null; }, "new_findings.0.explainer.found");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.returning[0].update = null; }, "returning.0.update");
    expectMutationFails(DraftBrief, monday(), (d) => { d.review.big_picture = null; }, "review.big_picture");
    expectValid(DraftBrief, { ...weekday(), story: null });
    expectValid(DraftBrief, { ...weekday(), returning: [{ ...weekday().returning[0], rung: null }] });
    expectValid(DraftBrief, { ...monday(), review: { ...monday().review, remarkable: null } });
  });

  it("refuses an unknown key at every level", () => {
    const places: [(d: any) => void, string][] = [
      [(d) => { d.extra = 1; }, ""],
      [(d) => { d.lead[0].extra = 1; }, "lead.0"],
      [(d) => { d.new_findings[0].extra = 1; }, "new_findings.0"],
      [(d) => { d.new_findings[0].explainer.extra = 1; }, "new_findings.0.explainer"],
      [(d) => { d.new_findings[0].ai.extra = 1; }, "new_findings.0.ai"],
      [(d) => { d.new_findings[0].rung_history[0].extra = 1; }, "new_findings.0.rung_history.0"],
      [(d) => { d.new_findings[0].sources[0].extra = 1; }, "new_findings.0.sources.0"],
      [(d) => { d.new_findings[0].artefacts.extra = 1; }, "new_findings.0.artefacts"],
      [(d) => { d.new_findings[0].terms[0].extra = 1; }, "new_findings.0.terms.0"],
      [(d) => { d.new_findings[0].terms[1].extra = 1; }, "new_findings.0.terms.1"],
      [(d) => { d.new_findings[0].who[0].extra = 1; }, "new_findings.0.who.0"],
      [(d) => { d.returning[0].extra = 1; }, "returning.0"],
      [(d) => { d.returning[0].rung.extra = 1; }, "returning.0.rung"],
      [(d) => { d.rung_changes[0].extra = 1; }, "rung_changes.0"],
      [(d) => { d.rung_changes[0].rung.extra = 1; }, "rung_changes.0.rung"],
      [(d) => { d.ideas[0].extra = 1; }, "ideas.0"],
      [(d) => { d.also[0].extra = 1; }, "also.0"],
      [(d) => { d.corrections[0].extra = 1; }, "corrections.0"],
      [(d) => { d.report_decisions[0].extra = 1; }, "report_decisions.0"],
      [(d) => { d.sources[0].extra = 1; }, "sources.0"],
    ];
    for (const [mutate, path] of places) expectMutationFails(DraftBrief, weekday(), mutate, path, "Unrecognized key");
    expectMutationFails(DraftBrief, monday(), (d) => { d.review.extra = 1; }, "review", "Unrecognized key");
    expectMutationFails(DraftBrief, monday(), (d) => { d.review.remarkable.extra = 1; }, "review.remarkable", "Unrecognized key");
    expectMutationFails(DraftBrief, monday(), (d) => { d.review.strongest_against.extra = 1; }, "review.strongest_against", "Unrecognized key");
    expectMutationFails(DraftBrief, sunday(), (d) => { d.deep_dive.extra = 1; }, "deep_dive", "Unrecognized key");
  });

  it("refuses a source's S keys, since publish adds them", () => {
    expectMutationFails(DraftBrief, weekday(), (d) => { d.sources[0].seen_as = "fetched"; }, "sources.0", "Unrecognized key");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.new_findings[0].sources[0].added = "2026-11-24"; }, "new_findings.0.sources.0", "Unrecognized key");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.new_findings[0].rung_history[0].recorded = "2026-11-24"; }, "new_findings.0.rung_history.0", "Unrecognized key");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.new_findings[0].rung_history[0].by = "agent"; }, "new_findings.0.rung_history.0", "Unrecognized key");
  });
});

describe("DraftBrief: the date and the refs", () => {
  it("takes a real date and a timestamp with an offset", () => {
    expectMutationFails(DraftBrief, weekday(), (d) => { d.date = "2026-02-30"; }, "date");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.generated_at = "2026-11-24T04:10:00"; }, "generated_at");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.schema_version = 2; }, "schema_version");
  });

  it("names a finding in the Lead, the story and the items by a new-N ref or an existing id", () => {
    for (const ref of ["new-1", "new-12", "math-2026-0142", "hum-2015-0001"]) expectValid(FindingRef, ref);
    for (const ref of ["new-0", "new-01", "new-", "NEW-1", "new-1x", "bio-2026-142", "bio-2026-0142x", "xyz-2026-0142", "", " new-1"]) {
      expect(issuesOf(FindingRef, ref).length, ref).toBeGreaterThan(0);
    }
    expectMutationFails(DraftBrief, weekday(), (d) => { d.story = "story-1"; }, "story");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.items = ["new-0"]; }, "items.0");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.lead[0].refs = ["first"]; }, "lead.0.refs.0");
    expectOnlyIssue(DraftLeadLine, { text: "A sentence.", refs: "new-1" }, "refs");
    expectOnlyIssue(DraftLeadLine, { text: "", refs: [] }, "text");
  });

  it("names a finding anywhere else by its stored id, since a stored finding cannot hold a draft's new-N", () => {
    expectMutationFails(DraftBrief, weekday(), (d) => { d.new_findings[0].related = ["new-2"]; }, "new_findings.0.related.0");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.returning[0].finding_id = "new-1"; }, "returning.0.finding_id");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.rung_changes[0].finding_id = "new-1"; }, "rung_changes.0.finding_id");
    expectMutationFails(DraftBrief, monday(), (d) => { d.review.remarkable.finding_id = "new-1"; }, "review.remarkable.finding_id");
    expectMutationFails(DraftBrief, monday(), (d) => { d.review.strongest_against.finding_ids = ["new-1"]; }, "review.strongest_against.finding_ids.0");
    expectMutationFails(DraftBrief, sunday(), (d) => { d.deep_dive.finding_id = "new-1"; }, "deep_dive.finding_id");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.corrections[0].finding_id = "new-1"; }, "corrections.0.finding_id");
  });
});

describe("DraftFinding: a new finding", () => {
  it("numbers it new-1, new-2 and so on, and gives it a field, a subfield id, a kind other than idea and a significance", () => {
    expectOnlyIssue(DraftFinding, { ...newFinding(), ref: "new-0" }, "ref");
    expectOnlyIssue(DraftFinding, { ...newFinding(), ref: "bio-2026-0001" }, "ref");
    expectOnlyIssue(DraftFinding, { ...newFinding(), field: "astronomy" }, "field");
    expectOnlyIssue(DraftFinding, { ...newFinding(), subfield: "Ancient Texts" }, "subfield");
    expectOnlyIssue(DraftFinding, { ...newFinding(), kind: "idea" }, "kind");
    expectOnlyIssue(DraftFinding, { ...newFinding(), significance: "huge" }, "significance");
    for (const kind of ["result", "capability", "check", "setback", "infrastructure", "policy_people"]) expectValid(DraftFinding, { ...newFinding(), kind });
  });

  it("makes ai_helped null exactly when the AI role is none", () => {
    expectValid(DraftFinding, newFinding());
    expectValid(DraftFinding, noRole());
    expectOnlyIssue(DraftFinding, { ...newFinding(), explainer: { ...newFinding().explainer, ai_helped: null } }, "explainer.ai_helped", "ai_helped is set");
    const withText = noRole();
    withText.explainer.ai_helped = "Some system helped.";
    expectOnlyIssue(DraftFinding, withText, "explainer.ai_helped", "ai_helped is null");
  });

  it("needs an evidence entry for an AI role, and none for no role", () => {
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.ai.evidence = []; }, "ai.evidence", "evidence entry");
    expectValid(DraftFinding, noRole());
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.ai.role = "magic"; }, "ai.role");
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.ai.confidence = "likely"; }, "ai.confidence");
  });

  it("takes at least one rung entry, with the source of one of its own", () => {
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.rung_history = []; }, "rung_history", "at least one");
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.rung_history[0].source_id = "b1"; }, "rung_history.0.source_id");
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.rung_history[0].rung = "verified"; }, "rung_history.0.rung");
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.rung_history[0].date = "last week"; }, "rung_history.0.date");
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.rung_history[0].note = ""; }, "rung_history.0.note");
    expectValid(DraftFinding, { ...newFinding(), rung_history: [{ rung: "preprint", date: "2026-10-01", source_id: "s2", note: "Posted first." }, newFinding().rung_history[0]] });
  });

  it("gives its sources s ids, and Go deeper s ids", () => {
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.sources[0].id = "b1"; }, "sources.0.id");
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.go_deeper = ["b1"]; }, "go_deeper.0");
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.ai.evidence[0].source_id = "b1"; }, "ai.evidence.0.source_id");
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.sources[0].url = ""; }, "sources.0.url");
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.sources[0].doi = "10.1234/UPPER"; }, "sources.0.doi");
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.sources[0].kind = "blog"; }, "sources.0.kind");
  });

  it("holds one to eight who entries", () => {
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.who = []; }, "who", "at least one");
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.who = Array.from({ length: 9 }, () => ({ name: "X", ror: null })); }, "who", "at most 8");
    expectValid(DraftFinding, { ...newFinding(), who: Array.from({ length: 8 }, () => ({ name: "X", ror: "05gq02987" })) });
    expectMutationFails(DraftFinding, newFinding(), (f) => { f.who[0].ror = "05GQ02987"; }, "who.0.ror");
  });

  it("takes the paper's own figure with its alt text in English", () => {
    const figure = {
      source_id: "s1", image_url: "https://example.org/fig.png", licence: "CC-BY-4.0", licence_quote: "licensed under CC BY 4.0",
      credit: "Figure 1 from a made-up paper, CC BY 4.0", alt: "A sample chart",
    };
    expectValid(DraftFinding, { ...newFinding(), figure });
    expectValid(DraftFigure, figure);
    expectOnlyIssue(DraftFigure, { ...figure, alt: { en: "A sample chart", zh: null } }, "alt");
    expectOnlyIssue(DraftFigure, { ...figure, licence: "CC-BY-NC-4.0" }, "licence");
    expectOnlyIssue(DraftFigure, { ...figure, credit: "c".repeat(121) }, "credit");
  });

  it("takes terms as a new term with its definition or an existing term by id", () => {
    expectValid(DraftTerm, { new: true, term: "protein folding", definition: "How a chain curls into a shape." });
    expectValid(DraftTerm, { new: false, id: "enzyme" });
    expectIssue(DraftTerm, { new: false, term: "enzyme" }, "id");
    expect(issuesOf(DraftTerm, { new: true, id: "enzyme" }).length).toBeGreaterThan(0);
    expect(issuesOf(DraftTerm, { new: "yes", id: "enzyme" }).length).toBeGreaterThan(0);
    expectOnlyIssue(DraftTerm, { new: true, term: "", definition: "A definition." }, "term");
    expectOnlyIssue(DraftTerm, { new: true, term: "t".repeat(61), definition: "A definition." }, "term");
    for (const term of ["x", "t".repeat(60)]) expectValid(DraftTerm, { new: true, term, definition: "A definition." });
    expectOnlyIssue(DraftTerm, { new: true, term: "enzyme", definition: "" }, "definition");
    expectOnlyIssue(DraftTerm, { new: false, id: "Protein Folding" }, "id");
    expect(Object.keys(DraftTermNew.shape)).toEqual(["new", "term", "definition"]);
    expect(Object.keys(DraftTermKnown.shape)).toEqual(["new", "id"]);
    expectOnlyIssue(DraftTerm, { new: false, id: "enzyme", extra: 1 }, "", "Unrecognized key");
    expectOnlyIssue(DraftTerm, { new: true, term: "enzyme", definition: "A definition.", extra: 1 }, "", "Unrecognized key");
  });

  it("keeps its unrefined shape for .pick() and .shape", () => {
    expect(() => DraftFinding.pick({ ref: true })).toThrow();
    expect(Object.keys(DraftFindingBase.pick({ ref: true, title: true }).shape)).toEqual(["ref", "title"]);
    expect(Object.keys(DraftFindingBase.shape)).toEqual(FINDING_KEYS);
    expectValid(DraftFindingBase, newFinding());
    expectValid(DraftFindingBase, { ...newFinding(), explainer: { ...newFinding().explainer, ai_helped: null } });
    expectValid(DraftExplainer, newFinding().explainer);
  });

  it("is also the finding's difference: a ref, English strings and no S field", () => {
    const stored = Object.keys(Finding.shape);
    for (const key of ["id", "schema_version", "depth", "rung", "since_then", "first_brief", "briefs", "history", "disclosure", "applications", "updated"]) {
      expect(stored).toContain(key);
      expect(FINDING_KEYS).not.toContain(key);
    }
    expect(FINDING_KEYS).toContain("ref");
    expect(stored).not.toContain("ref");
  });
});

describe("DraftBrief: returning findings and rung changes", () => {
  it("takes a returning entry with its update, its sources and a rung or null", () => {
    expectValid(DraftReturning, weekday().returning[0]);
    expectValid(DraftReturning, { ...weekday().returning[0], rung: null });
    expectOnlyIssue(DraftReturning, { ...weekday().returning[0], update: "" }, "update");
    expectOnlyIssue(DraftReturning, { ...weekday().returning[0], source_ids: ["1"] }, "source_ids.0");
    expectOnlyIssue(DraftReturning, { ...weekday().returning[0], finding_id: "math-26-2" }, "finding_id");
  });

  it("lets a returning entry and a rung change cite a finding's own source or a brief-level one", () => {
    for (const id of ["s1", "s12", "b1", "b3"]) {
      expectValid(DraftReturning, { ...weekday().returning[0], source_ids: [id], rung: { ...weekday().returning[0].rung!, source_id: id } });
      expectValid(DraftRungChange, { finding_id: "phys-2026-0003", rung: { ...weekday().rung_changes[0].rung, source_id: id } });
    }
    expectOnlyIssue(DraftRungChange, { finding_id: "phys-2026-0003", rung: { ...weekday().rung_changes[0].rung, source_id: "x1" } }, "rung.source_id");
  });

  it("takes a rung entry as the agent writes it: no recorded date and no author", () => {
    const rung = { rung: "preprint", date: "2026-10-01", source_id: "s2", note: "Posted first." };
    expectValid(DraftRung, rung);
    expectValid(DraftFindingRung, rung);
    expectOnlyIssue(DraftRung, { ...rung, rung: "verified" }, "rung");
    expectOnlyIssue(DraftRung, { ...rung, recorded: "2026-10-05" }, "", "Unrecognized key");
    expectOnlyIssue(DraftRung, { ...rung, by: "agent" }, "", "Unrecognized key");
    expectOnlyIssue(DraftRung, { ...rung, note: undefined }, "note");
    expectValid(DraftRung, { ...rung, source_id: "b1" });
    expectOnlyIssue(DraftFindingRung, { ...rung, source_id: "b1" }, "source_id");
  });
});

describe("DraftBrief: ideas, also-noted lines, the deep dive and the review", () => {
  it("cites brief-level sources (b ids) for an idea, an also-noted line, the deep dive and the strongest evidence against", () => {
    expectValid(DraftIdea, weekday().ideas[0]);
    expectOnlyIssue(DraftIdea, { ...weekday().ideas[0], source_id: "s1" }, "source_id");
    expectOnlyIssue(DraftIdea, { ...weekday().ideas[0], who: "" }, "who");
    expectValid(DraftIdea, { ...weekday().ideas[0], who: "X" });
    expectValid(DraftAlso, weekday().also[0]);
    expectOnlyIssue(DraftAlso, { ...weekday().also[0], source_id: "s1" }, "source_id");
    expectOnlyIssue(DraftAlso, { ...weekday().also[0], field: "astronomy" }, "field");
    expectValid(DraftDeepDive, sunday().deep_dive);
    expectOnlyIssue(DraftDeepDive, { ...sunday().deep_dive, source_ids: ["s1"] }, "source_ids.0");
    expectMutationFails(DraftBrief, monday(), (d) => { d.review.strongest_against.source_ids = ["s1"]; }, "review.strongest_against.source_ids.0");
  });

  it("takes one of the three reasons for the deep dive", () => {
    for (const why of ["news", "anniversary", "rotation"]) expectValid(DraftDeepDive, { ...sunday().deep_dive, why_today: why });
    expectOnlyIssue(DraftDeepDive, { ...sunday().deep_dive, why_today: "luck" }, "why_today");
    expectOnlyIssue(DraftDeepDive, { ...sunday().deep_dive, text: "" }, "text");
  });

  it("takes the review with a remarkable finding or null, and the strongest evidence against", () => {
    expectValid(DraftReview, monday().review);
    expectValid(DraftReview, { ...monday().review, remarkable: null });
    expectOnlyIssue(DraftReview, { ...monday().review, big_picture: "" }, "big_picture");
    expectOnlyIssue(DraftReview, { ...monday().review, remarkable: { finding_id: "bio-2026-0001" } }, "remarkable.note");
    expectValid(DraftReview, { ...monday().review, strongest_against: { text: "None found this week.", finding_ids: [], source_ids: [] } });
    expectOnlyIssue(DraftReview, { ...monday().review, strongest_against: { text: "", finding_ids: [], source_ids: [] } }, "strongest_against.text");
  });
});

describe("DraftBrief: report decisions", () => {
  it("decides a report as upheld or rejected, with a reason and the correction that answers it", () => {
    expectValid(DraftReportDecision, weekday().report_decisions[0]);
    expectValid(DraftReportDecision, weekday().report_decisions[1]);
    expectOnlyIssue(DraftReportDecision, { ...weekday().report_decisions[0], outcome: "open" }, "outcome");
    expectOnlyIssue(DraftReportDecision, { ...weekday().report_decisions[0], report_id: "R1" }, "report_id");
    expectOnlyIssue(DraftReportDecision, { ...weekday().report_decisions[0], reason: "" }, "reason");
    expectOnlyIssue(DraftReportDecision, { ...weekday().report_decisions[1], correction: -1 }, "correction");
    expectOnlyIssue(DraftReportDecision, { ...weekday().report_decisions[1], correction: 0.5 }, "correction");
    expectOnlyIssue(DraftReportDecision, { ...weekday().report_decisions[1], correction: "0" }, "correction");
  });
});

describe("DraftCorrection: the keys and the one target", () => {
  it("accepts a correction on a finding, on an edition's brief-level text and on a term", () => {
    expectValid(DraftCorrection, correction());
    expectValid(DraftCorrection, correction({ finding_id: null, edition_date: "2026-11-20", path: "lead.1.text" }));
    expectValid(DraftCorrection, correction({ finding_id: null, term_id: "enzyme", path: "definition" }));
    expectValid(DraftCorrectionBase, correction());
  });

  it("keeps the keys in the spec's order", () => {
    expect(Object.keys(DraftCorrection.shape)).toEqual(
      ["finding_id", "edition_date", "term_id", "type", "path", "after", "reason", "source_url", "report_id"],
    );
  });

  it("names exactly one record", () => {
    expectOnlyIssue(DraftCorrection, correction({ finding_id: null }), "", "Exactly one");
    expectOnlyIssue(DraftCorrection, correction({ edition_date: "2026-11-20" }), "", "Exactly one");
    expectOnlyIssue(DraftCorrection, correction({ term_id: "enzyme" }), "", "Exactly one");
    expectOnlyIssue(DraftCorrection, correction({ finding_id: null, edition_date: "2026-11-20", term_id: "enzyme" }), "", "Exactly one");
    expect(correctionRecord({ finding_id: "bio-2026-0001", edition_date: null, term_id: null })).toBe("finding");
    expect(correctionRecord({ finding_id: null, edition_date: "2026-11-20", term_id: null })).toBe("edition");
    expect(correctionRecord({ finding_id: null, edition_date: null, term_id: "enzyme" })).toBe("term");
    expect(correctionRecord({ finding_id: null, edition_date: null, term_id: null })).toBeNull();
    expect(correctionRecord({ finding_id: "bio-2026-0001", edition_date: "2026-11-20", term_id: null })).toBeNull();
  });

  it("needs every key and refuses null where the spec has none", () => {
    for (const key of Object.keys(correction())) expectMutationFails(DraftCorrection, correction(), (c) => delete c[key], key);
    for (const key of ["type", "path", "after", "reason"]) expectMutationFails(DraftCorrection, correction(), (c) => { c[key] = null; }, key);
    expectValid(DraftCorrection, correction({ source_url: "https://example.org/paper/1", report_id: "R-0001" }));
    expectMutationFails(DraftCorrection, correction(), (c) => { c.source_url = ""; }, "source_url");
    expectMutationFails(DraftCorrection, correction(), (c) => { c.report_id = "R1"; }, "report_id");
  });

  it("takes a type, a path of at most 60 characters and an after of at most 300", () => {
    for (const type of ["correction", "clarification", "update"]) expectValid(DraftCorrection, correction({ type }));
    expectMutationFails(DraftCorrection, correction(), (c) => { c.type = "retraction"; }, "type");
    expectMutationFails(DraftCorrection, correction(), (c) => { c.path = "Explainer.How_Sure"; }, "path");
    expectMutationFails(DraftCorrection, correction(), (c) => { c.path = `explainer.${"x".repeat(60)}`; }, "path");
    expectValid(DraftCorrection, correction({ after: "a".repeat(300) }));
    expectMutationFails(DraftCorrection, correction(), (c) => { c.after = "a".repeat(301); }, "after");
    expectMutationFails(DraftCorrection, correction(), (c) => { c.after = ""; }, "after");
    expectMutationFails(DraftCorrection, correction(), (c) => { c.reason = ""; }, "reason");
  });
});

describe("DraftCorrection: SCHEMA's checks of the path and the after", () => {
  const removed = (over: Record<string, unknown> = {}) => correction({ type: "removed", after: REMOVED_TEXT.en, ...over });
  const onTerm = (over: Record<string, unknown> = {}) => correction({ finding_id: null, term_id: "enzyme", ...over });
  const onEdition = (over: Record<string, unknown> = {}) => correction({ finding_id: null, edition_date: "2026-11-20", ...over });

  it("passes a removed correction on explainer.how_sure, on a brief source's url and on a term's definition", () => {
    expectValid(DraftCorrection, removed({ path: "explainer.how_sure" }));
    expectValid(DraftCorrection, removed({ finding_id: null, edition_date: "2026-11-20", path: "sources.0.url" }));
    expectValid(DraftCorrection, removed({ finding_id: null, term_id: "enzyme", path: "definition" }));
  });

  it("fails a removed correction on a term's term, on significance, and with any other after", () => {
    expectOnlyIssue(DraftCorrection, removed({ finding_id: null, term_id: "enzyme", path: "term" }), "path", "removed");
    expectOnlyIssue(DraftCorrection, removed({ path: "significance" }), "path", "removed");
    expectOnlyIssue(DraftCorrection, removed({ path: "explainer.how_sure", after: "Something else." }), "after", REMOVED_TEXT.en);
    expectIssue(DraftCorrection, removed({ path: "explainer.how_sure", after: "" }), "after");
    for (const path of ["field", "subfield", "kind", "ai.role", "ai.confidence", "id", "first_published", "go_deeper.0", "terms.0", "related.0", "sources.0.id", "sources.0.doi"]) {
      expectMutationFails(DraftCorrection, removed(), (c) => { c.path = path; }, "path", "removed");
    }
  });

  it("fails an update of significance to huge and a correction of kind to idea, and passes the vocabulary's ids", () => {
    expectOnlyIssue(DraftCorrection, correction({ type: "update", path: "significance", after: "huge" }), "after", "landmark, major, notable, watch");
    expectOnlyIssue(DraftCorrection, correction({ path: "kind", after: "idea" }), "after", "result");
    expectOnlyIssue(DraftCorrection, correction({ path: "field", after: "astronomy" }), "after", "mathematics");
    expectOnlyIssue(DraftCorrection, correction({ path: "ai.role", after: "ai_wrote" }), "after", "ai_solved");
    expectOnlyIssue(DraftCorrection, correction({ path: "ai.confidence", after: "likely" }), "after", "confirmed, claimed");
    for (const [path, after] of [["significance", "notable"], ["kind", "setback"], ["field", "physics"], ["ai.role", "none"], ["ai.confidence", "claimed"]] as const) {
      expectValid(DraftCorrection, correction({ type: "update", path, after }));
    }
  });

  it("fails a correction of rung, or of a rung entry's rung, since a rung changes only through a new dated entry", () => {
    expectOnlyIssue(DraftCorrection, correction({ path: "rung", after: "checked" }), "path", "rung entry");
    expectOnlyIssue(DraftCorrection, correction({ type: "update", path: "rung_history.0.rung", after: "checked" }), "path", "rung entry");
    expectOnlyIssue(DraftCorrection, removed({ path: "rung" }), "path", "rung entry");
    expectValid(DraftCorrection, correction({ path: "rung_history.0.note", after: "Published in Example Journal." }));
    expectValid(DraftCorrection, correction({ path: "explainer.how_sure" }));
  });

  it("makes the path name a value of its record's type", () => {
    expectOnlyIssue(DraftCorrection, correction({ path: "explainer.nope" }), "path", 'no key "nope"');
    expectOnlyIssue(DraftCorrection, correction({ path: "nope" }), "path", 'no key "nope"');
    expectOnlyIssue(DraftCorrection, correction({ path: "explainer" }), "path", "group of values");
    expectOnlyIssue(DraftCorrection, correction({ path: "sources" }), "path", "group of values");
    expectOnlyIssue(DraftCorrection, correction({ path: "sources.0" }), "path", "group of values");
    expectOnlyIssue(DraftCorrection, correction({ path: "sources.url" }), "path", "index");
    expectOnlyIssue(DraftCorrection, correction({ path: "constructor" }), "path", 'no key "constructor"');
    expectOnlyIssue(DraftCorrection, correction({ path: "explainer.constructor" }), "path", 'no key "constructor"');
    expectValid(DraftCorrection, correction({ path: "title" }));
  });

  it("tells the agent where in the path it went wrong, by the part of the record already walked", () => {
    const message = (c: ReturnType<typeof correction>) => {
      const problems = correctionProblems(c);
      expect(problems).toHaveLength(1);
      return problems[0]!.message;
    };
    expect(message(correction({ path: "nope" }))).toBe(`a finding has no key "nope" (its keys: ${Object.keys(Finding.shape).join(", ")})`);
    expect(message(correction({ path: "explainer.nope" })))
      .toBe('"explainer" has no key "nope" (its keys: found, matters, ai_helped, how_sure, background, could_lead)');
    expect(message(correction({ path: "ai.systems.0.zzz" }))).toBe('"ai.systems.0" has no key "zzz" (its keys: name, maker)');
    expect(message(onEdition({ path: "explainer.found" }))).toBe(`an edition's brief has no key "explainer" (its keys: ${Object.keys(Brief.shape).join(", ")})`);
    expect(message(correction({ path: "sources.url" }))).toBe('"sources" is a list: name an entry by its index from 0, not "url"');
    expect(message(correction({ path: "sources.0.nope" }))).toBe(`"sources.0" has no key "nope" (its keys: ${Object.keys(Finding.shape.sources.element.shape).join(", ")})`);
    expect(message(correction({ path: "explainer.found.zh" }))).toBe('"explainer.found" is a text in both languages: name it as a whole, not one language of it ("zh")');
    expect(message(correction({ path: "title.en" }))).toBe('"title" is a text in both languages: name it as a whole, not one language of it ("en")');
    expect(message(correction({ path: "go_deeper.0.x" }))).toBe('"go_deeper.0" holds one value and has no "x"');
    expect(message(correction({ path: "explainer" }))).toBe('"explainer" names a group of values: name one text or value inside it');
  });

  it("names an L10n whole, never one language of it", () => {
    expectValid(DraftCorrection, correction({ path: "title" }));
    expectValid(DraftCorrection, correction({ path: "explainer.found" }));
    expectOnlyIssue(DraftCorrection, correction({ path: "title.en" }), "path", "both languages");
    expectOnlyIssue(DraftCorrection, correction({ path: "explainer.found.zh" }), "path", "both languages");
    expectOnlyIssue(DraftCorrection, correction({ path: "explainer.found.en.x" }), "path", "both languages");
  });

  it("walks array indices from 0 and names a value past a list's elements", () => {
    expectValid(DraftCorrection, correction({ path: "sources.0.title" }));
    expectValid(DraftCorrection, correction({ path: "sources.12.title" }));
    expectValid(DraftCorrection, correction({ path: "ai.systems.0.name" }));
    expectValid(DraftCorrection, correction({ path: "go_deeper.0", type: "update" }));
    expectOnlyIssue(DraftCorrection, correction({ path: "go_deeper.0.x" }), "path", "holds one value");
    expectOnlyIssue(DraftCorrection, correction({ path: "sources.-1.title" }), "path");
  });

  it("walks an edition by the brief's own text and sources", () => {
    for (const path of ["lead.1.text", "pace.sentence", "ideas.0.who", "also.0.title", "deep_dive.text", "review.big_picture", "status_note", "sources.0.title"]) {
      expectValid(DraftCorrection, onEdition({ path }));
    }
    expectOnlyIssue(DraftCorrection, onEdition({ path: "explainer.found" }), "path", 'no key "explainer"');
    expectOnlyIssue(DraftCorrection, onEdition({ path: "lead.1" }), "path", "group of values");
    expectOnlyIssue(DraftCorrection, onEdition({ path: "lead.1.text.en" }), "path", "both languages");
    expectOnlyIssue(DraftCorrection, onEdition({ path: "review.field_counts" }), "path", "group of values");
    // `languages` has the keys of an L10n but holds flags, so it is a group of values, not a text in both languages
    expectOnlyIssue(DraftCorrection, onEdition({ path: "languages" }), "path", "group of values");
  });

  it("names on a term only its term or its definition", () => {
    expectValid(DraftCorrection, onTerm({ path: "term" }));
    expectValid(DraftCorrection, onTerm({ path: "definition" }));
    expectOnlyIssue(DraftCorrection, onTerm({ path: "title" }), "path", '"term" or "definition"');
    expectOnlyIssue(DraftCorrection, onTerm({ path: "definition.en" }), "path", '"term" or "definition"');
  });

  it("leaves a malformed path to its own format issue and never walks it", () => {
    expect(correctionProblems(correction({ path: "Explainer..how" }))).toEqual([]);
    expect(correctionProblems(correction({ path: "" }))).toEqual([]);
    expect(issuesOf(DraftCorrection, correction({ path: "Explainer..how" })).map((i) => i.path)).toEqual(["path"]);
  });

  it("reports a problem with its path relative to the correction", () => {
    expect(correctionProblems(correction({ path: "explainer.nope" })).map((p) => p.path.join("."))).toEqual(["path"]);
    expect(correctionProblems(correction({ path: "significance", after: "huge" })).map((p) => p.path.join("."))).toEqual(["after"]);
    expect(correctionProblems(correction({ finding_id: null }))).toEqual([{ path: [], message: "Exactly one of finding_id, edition_date and term_id is set" }]);
    expect(correctionProblems(removed({ path: "significance", after: "major" })).map((p) => p.path.join("."))).toEqual(["path", "after"]);
    expect(correctionProblems(correction())).toEqual([]);
  });

  it("runs inside a draft, at the correction's place", () => {
    expectMutationFails(DraftBrief, weekday(), (d) => { d.corrections[0].path = "rung"; }, "corrections.0.path", "rung entry");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.corrections[0].type = "removed"; d.corrections[0].path = "significance"; }, "corrections.0.path", "removed");
    expectMutationFails(DraftBrief, weekday(), (d) => { d.corrections[0].type = "removed"; }, "corrections.0.after", REMOVED_TEXT.en);
    expectMutationFails(DraftBrief, weekday(), (d) => { d.corrections[0].path = "explainer.nope"; }, "corrections.0.path", "no key");
  });
});

describe("DraftCorrection: which paths a removed correction may rewrite", () => {
  /** Every path from a schema's root to a leaf, array indices as 0, with each L10n as one leaf (the walk a correction's path follows). */
  function leaves(schema: z.ZodType, prefix: string[] = []): { path: string; l10n: boolean }[] {
    let at = schema;
    while (at instanceof z.ZodNullable || at instanceof z.ZodOptional) at = at.unwrap() as z.ZodType;
    if (at instanceof z.ZodObject) {
      // an L10n is what takes { en, zh: null }; a brief's `languages` has the same two keys and does not
      if (at.safeParse({ en: "x", zh: null }).success) return [{ path: prefix.join("."), l10n: true }];
      return Object.entries(at.shape).flatMap(([key, child]) => leaves(child as z.ZodType, [...prefix, key]));
    }
    if (at instanceof z.ZodArray) return leaves(at.element as z.ZodType, [...prefix, "0"]);
    return [{ path: prefix.join("."), l10n: false }];
  }

  it("lets every L10n of a finding and of a brief be removed", () => {
    for (const [record, schema] of [["finding", Finding], ["edition", Brief]] as const) {
      const l10n = leaves(schema).filter((leaf) => leaf.l10n);
      expect(l10n.length).toBeGreaterThan(8);
      for (const leaf of l10n) expect(isRemovablePath(record, leaf.path), `${record}: ${leaf.path}`).toBe(true);
    }
  });

  it("lets a removed correction rewrite each L10n, each plain string of free text, a source's url and a figure's image_url, and no other leaf", () => {
    // SPEC §4.10: the plain strings are the quotes, the credit and licence quote, titles, publishers, names and the
    // idea's author; everything else (an id, a vocabulary value, a date, a DOI, a number, a flag) is refused
    const freeText = {
      finding: [
        "ai.systems.0.name", "ai.systems.0.maker", "ai.evidence.0.quote", "sources.0.title", "sources.0.publisher", "sources.0.url",
        "reactions.0.who", "reactions.0.affiliation", "reactions.0.quote", "figure.image_url", "figure.licence_quote", "figure.credit", "who.0.name",
      ],
      edition: ["ideas.0.who", "sources.0.title", "sources.0.publisher", "sources.0.url"],
    };
    for (const [record, schema] of [["finding", Finding], ["edition", Brief]] as const) {
      const all = leaves(schema);
      const removable = all.filter((leaf) => isRemovablePath(record, leaf.path)).map((leaf) => leaf.path).sort();
      const expected = [...all.filter((leaf) => leaf.l10n).map((leaf) => leaf.path), ...freeText[record]].sort();
      expect(removable, record).toEqual(expected);
      for (const path of freeText[record]) expect(all.some((leaf) => leaf.path === path), `${record}: ${path}`).toBe(true);
    }
  });

  it("names, in each list, only paths that exist in the record's schema", () => {
    const target = { finding: { finding_id: "bio-2026-0001" }, edition: { edition_date: "2026-11-20" }, term: { term_id: "enzyme" } } as const;
    for (const record of ["finding", "edition", "term"] as const) {
      for (const generic of REMOVABLE_PATHS[record]) {
        const c = { finding_id: null, edition_date: null, term_id: null, ...target[record], type: "update", path: generic.replaceAll("*", "0"), after: "x" };
        expect(correctionProblems(c), `${record}: ${generic}`).toEqual([]);
      }
    }
  });

  it("refuses an id, a vocabulary value, a date, a list or a number", () => {
    for (const path of ["id", "field", "subfield", "kind", "significance", "ai.role", "ai.confidence", "go_deeper.0", "terms.0", "related.0",
      "first_published", "sources.0.id", "sources.0.kind", "sources.0.doi", "sources.0.published_at", "rung_history.0.date", "figure.licence",
      "who.0.ror", "artefacts.doi.0"]) {
      expect(isRemovablePath("finding", path), path).toBe(false);
    }
    for (const path of ["edition", "format", "story.finding_id", "also.0.field", "also.0.source_id", "sources.0.kind", "review.field_counts.0.field"]) {
      expect(isRemovablePath("edition", path), path).toBe(false);
    }
    expect(isRemovablePath("term", "term")).toBe(false);
    expect(isRemovablePath("term", "definition")).toBe(true);
  });

  it("reads an index as any index", () => {
    expect(isRemovablePath("finding", "sources.0.url")).toBe(true);
    expect(isRemovablePath("finding", "sources.7.url")).toBe(true);
    expect(isRemovablePath("finding", "sources.x.url")).toBe(false);
    expect(isRemovablePath("finding", "figure.image_url")).toBe(true);
    expect(isRemovablePath("finding", "ai.evidence.2.quote")).toBe(true);
    expect(isRemovablePath("edition", "corrections.3.reason")).toBe(true);
  });
});

describe("DraftBrief: the JSON Schema the agent reads", () => {
  const json = () => z.toJSONSchema(DraftBrief, { target: "draft-2020-12", unrepresentable: "throw" }) as any;

  it("generates without a transform or any type JSON Schema cannot show", () => {
    expect(() => json()).not.toThrow();
    expect(() => z.toJSONSchema(DraftFinding, { target: "draft-2020-12", unrepresentable: "throw" })).not.toThrow();
    expect(() => z.toJSONSchema(DraftCorrection, { target: "draft-2020-12", unrepresentable: "throw" })).not.toThrow();
  });

  it("requires every key of the draft and of a new finding, and refuses any other", () => {
    const schema = json();
    expect(schema.required).toEqual(DRAFT_KEYS);
    expect(schema.additionalProperties).toBe(false);
    const finding = schema.properties.new_findings.items;
    expect(finding.required).toEqual(FINDING_KEYS);
    expect(finding.additionalProperties).toBe(false);
    expect(schema.properties.corrections.items.required).toEqual(Object.keys(DraftCorrection.shape));
  });

  it("shows the structure and none of the Zod-only refinements", () => {
    const finding = json().properties.new_findings.items;
    // `ai_helped` may be a string or null whatever the AI role: only the Zod refinement ties it to the role
    expect(finding.properties.explainer.properties.ai_helped.anyOf).toEqual([{ type: "string", minLength: 1, description: expect.any(String) }, { type: "null" }]);
    // a correction names one record in the Zod schema; the JSON Schema has the three keys, each nullable
    expect(json().properties.corrections.items.required).toContain("finding_id");
    expect(JSON.stringify(json().properties.corrections.items)).not.toContain("allOf");
  });

  it("shows a term as one of two shapes", () => {
    const terms = json().properties.new_findings.items.properties.terms.items;
    expect(terms.oneOf ?? terms.anyOf).toHaveLength(2);
  });

  it("keeps every description short enough for the compact printer, whose lines stay under 1,000 characters", () => {
    const longest: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          if (key === "description" && typeof value === "string" && value.length >= 400) longest.push(value);
          else walk(value);
        }
      }
    };
    walk(json());
    expect(longest).toEqual([]);
  });

  it("describes the budgets the rules enforce, so the agent sees them", () => {
    const text = JSON.stringify(json());
    for (const part of ["At most 12 words", "230 to 280 words", "450 to 550 words", "270 to 330 words", "At most 40 words", "0 to 2", "0 to 5"]) {
      expect(text, part).toContain(part);
    }
  });

  it("gives the same JSON each time, so the generated file is stable", () => {
    expect(JSON.stringify(json())).toBe(JSON.stringify(json()));
  });
});
