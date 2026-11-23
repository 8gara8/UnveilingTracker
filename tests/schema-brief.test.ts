// lib/schema/brief.ts (SPEC §4.5): the published brief, as publish stores it. A valid weekday edition, a Monday review,
// a Sunday deep dive, an English-only edition and a data-only one, built by hand, and a failing value for each
// constraint; inline data.

import { describe, expect, expectTypeOf, it } from "vitest";
import { FIELDS } from "@/lib/vocab";
import { jsonText } from "@/lib/json";
import type { L10n, Rung } from "@/lib/schema/common";
import {
  AlsoLine, Brief, BriefBase, BriefComputed, BriefCorrection, BriefDeepDive, BriefItem, BriefLanguages, BriefPace, BriefProvenance,
  BriefReport, FieldCount, FieldCountBase, FieldCounts, IdeaLine, LeadLine, RUNG_CHANGE_BY, RemarkableFinding, RungChange, StrongestAgainst, WHY_TODAY,
  WeekReview, type Brief as BriefType, type BriefItem as BriefItemType, type RungChange as RungChangeType, type WeekReview as WeekReviewType,
} from "@/lib/schema/brief";
import { copy, expectIssue, expectMutationFails, expectOnlyIssue, expectValid, issuesOf } from "./helpers/zod-issues";

const l = (en: string): L10n => ({ en, zh: null });

/** Both languages, for a full edition. */
const lz = (en: string, zh: string): L10n => ({ en, zh });

const KEYS = [
  "schema_version", "date", "edition", "format", "languages", "published_at", "late", "pace", "lead", "story", "items", "rung_changes",
  "ideas", "also", "deep_dive", "review", "corrections", "reports", "sources", "disclosure", "status_note", "computed", "provenance",
];

const source = (n: number) => ({
  id: `b${n}`, kind: "statement", title: "A made-up statement", publisher: "Example Institute", url: `https://example.org/statement/${n}`,
  doi: null, published_at: "2026-11-23", seen_as: "pack", added: "2026-11-24",
});

const fieldCounts = () => FIELDS.map((field) => ({ field, reported: 1, counted: 1 }));

/** A full Tuesday edition in both languages: a story, two items (one returning), a rung change, an idea, an also-noted line. */
const weekday = () => ({
  schema_version: 1,
  date: "2026-11-24",
  edition: "full",
  format: "daily",
  languages: { en: true, zh: true },
  published_at: "2026-11-24T04:12:30+08:00",
  late: false,
  pace: { sentence: lz("The Pace: 8.4% of papers named AI methods.", "進度：8.4% 的論文提到 AI 方法。"), status: "ok", metrics_file: "metrics/2026-11-24.json" },
  lead: [{ text: lz("A sample protein result leads today.", "今天的重點是一項範例蛋白質成果。"), finding_ids: ["bio-2026-0001"] }],
  story: { finding_id: "bio-2026-0001", new: true, update: null },
  items: [
    { finding_id: "math-2026-0002", new: true, update: null },
    { finding_id: "phys-2026-0003", new: false, update: lz("A journal published the paper.", "期刊刊出了這篇論文。") },
  ],
  rung_changes: [{ finding_id: "phys-2026-0003", from: "preprint", to: "checked", date: "2026-11-23", by: "script" }],
  ideas: [{ text: lz("A made-up argument about method.", "一項關於方法的範例論點。"), who: "A. Example", source_id: "b1" }],
  also: [{ title: lz("A made-up soil study", "一項範例土壤研究"), field: "earth", source_id: "b2" }],
  deep_dive: null,
  review: null,
  corrections: [{ id: "C-0001", finding_id: "chem-2026-0004", edition_date: null, term_id: null, type: "clarification", reason: lz("The wording was unclear.", "原本的說法不夠清楚。") }],
  reports: [{ id: "R-0001", finding_id: "chem-2026-0004", status: "rejected" }],
  sources: [source(1), source(2)],
  disclosure: [] as string[],
  status_note: null,
  computed: { word_count: 812, zh_chars: 1304, finding_count: 3, source_count: 2 },
  provenance: { run_id: "20261124-031500", code_commit: "a".repeat(40), data_cutoff: "2026-11-22" },
});

const week = () => ({
  big_picture: lz("This week the record moved on three fronts.", "本週的紀錄在三方面有進展。"),
  remarkable: { finding_id: "bio-2026-0001", note: lz("A made-up note.", "一則範例說明。") },
  strongest_against: { text: lz("One finding fell this week.", "本週有一項發現被推翻。"), finding_ids: ["phys-2026-0003"], source_ids: ["b1"] },
  field_counts: fieldCounts(),
  fell: ["phys-2026-0003"],
  setbacks: [] as string[],
});

/** A Monday edition: the review, and at most two findings. */
const monday = () => ({
  ...weekday(),
  date: "2026-11-23",
  format: "monday_review",
  pace: { ...weekday().pace, metrics_file: "metrics/2026-11-23.json" },
  items: [weekday().items[0]],
  review: week(),
  provenance: { ...weekday().provenance, data_cutoff: "2026-11-15" },
});

/** A Sunday edition: the deep dive on one finding of the Ledger. */
const sunday = () => ({
  ...weekday(),
  date: "2026-11-22",
  format: "sunday_deep_dive",
  pace: { ...weekday().pace, metrics_file: "metrics/2026-11-22.json" },
  items: [weekday().items[0]],
  deep_dive: { finding_id: "bio-2024-0007", text: lz("A made-up deep dive.", "一篇範例深入報導。"), source_ids: ["b1"], why_today: "news" },
  provenance: { ...weekday().provenance, data_cutoff: "2026-11-15" },
});

/** The English-only edition (SPEC §8.2 stage 8): no Chinese anywhere, and the English-only status note. */
const englishOnly = () => {
  const b: any = weekday();
  const plain = (v: any): any => (Array.isArray(v) ? v.map(plain) : v && typeof v === "object"
    ? ("en" in v && "zh" in v ? { en: v.en, zh: null } : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))) : v);
  const out = plain(b);
  out.languages = { en: true, zh: false };
  out.status_note = l("This edition is in English only.");
  out.computed.zh_chars = null;
  return out;
};

/** A data-only edition (stage 5): the Pace, the script's rung changes and the reports decided; nothing else. */
const dataOnly = () => ({
  ...weekday(),
  edition: "data_only",
  lead: [], story: null, items: [], ideas: [], also: [], deep_dive: null, review: null, corrections: [], sources: [], disclosure: [],
  status_note: lz("This is the data-only edition: the full brief did not finish.", "這是僅數據版：完整簡報未能完成。"),
  computed: { word_count: 40, zh_chars: 30, finding_count: 0, source_count: 0 },
});

describe("Brief: the valid editions", () => {
  it("accepts a weekday edition, a Monday review, a Sunday deep dive, an English-only edition and a data-only edition", () => {
    for (const b of [weekday(), monday(), sunday(), englishOnly(), dataOnly()]) {
      expectValid(Brief, b);
      expectValid(BriefBase, b);
    }
  });

  it("accepts a partial edition and one published late", () => {
    expectValid(Brief, { ...weekday(), edition: "partial", status_note: lz("Some feeds failed.", "部分資料來源失敗。") });
    expectValid(Brief, { ...weekday(), late: true, published_at: "2026-11-24T08:20:00+08:00" });
  });

  it("keeps the keys in the spec's order, so a file printed through the schema is stable", () => {
    expect(Object.keys(Brief.shape)).toEqual(KEYS);
    const shuffled = Object.fromEntries(Object.entries(weekday()).reverse());
    expect(Object.keys(Brief.parse(shuffled))).toEqual(KEYS);
    expect(JSON.parse(jsonText(shuffled, Brief)).date).toBe("2026-11-24");
  });

  it("has none of the draft's own keys", () => {
    for (const key of ["generated_at", "new_findings", "returning", "report_decisions"]) expect(Object.keys(Brief.shape)).not.toContain(key);
  });

  it("has the types the spec gives: L10n strings, ids, and the S fields", () => {
    expectTypeOf<BriefType["edition"]>().toEqualTypeOf<"full" | "partial" | "data_only">();
    expectTypeOf<BriefType["format"]>().toEqualTypeOf<"daily" | "monday_review" | "sunday_deep_dive">();
    expectTypeOf<BriefType["languages"]>().toEqualTypeOf<{ en: true; zh: boolean }>();
    expectTypeOf<BriefType["story"]>().toEqualTypeOf<BriefItemType | null>();
    expectTypeOf<BriefItemType>().toEqualTypeOf<{ finding_id: string; new: boolean; update: L10n | null }>();
    expectTypeOf<BriefType["status_note"]>().toEqualTypeOf<L10n | null>();
    expectTypeOf<BriefType["computed"]["zh_chars"]>().toEqualTypeOf<number | null>();
    expectTypeOf<BriefType["review"]>().toEqualTypeOf<WeekReviewType | null>();
    expectTypeOf<BriefType["lead"][number]["text"]>().toEqualTypeOf<L10n>();
    expectTypeOf<BriefType["pace"]["sentence"]>().toEqualTypeOf<L10n>();
    expectTypeOf<BriefType["deep_dive"]>().toEqualTypeOf<
      { finding_id: string; text: L10n; source_ids: string[]; why_today: "news" | "anniversary" | "rotation" } | null
    >();
    expectTypeOf<RungChangeType>().toEqualTypeOf<{ finding_id: string; from: Rung; to: Rung; date: string; by: "script" | "agent" }>();
    expectTypeOf<WeekReviewType["fell"]>().toEqualTypeOf<string[]>();
  });
});

describe("Brief: keys, nulls and unknown keys", () => {
  it("needs every key", () => {
    for (const key of KEYS) expectMutationFails(Brief, weekday(), (b) => delete b[key], key);
  });

  it("refuses null where the spec has no null", () => {
    const nullable = new Set(["story", "deep_dive", "review", "status_note"]);
    for (const key of KEYS.filter((k) => !nullable.has(k))) expectMutationFails(Brief, weekday(), (b) => { b[key] = null; }, key);
    expectMutationFails(Brief, weekday(), (b) => { b.lead[0].text.en = null; }, "lead.0.text.en");
    expectMutationFails(Brief, weekday(), (b) => { b.pace.sentence = null; }, "pace.sentence");
    expectMutationFails(Brief, weekday(), (b) => { b.items[0].update = undefined; }, "items.0.update");
    expectMutationFails(Brief, weekday(), (b) => { b.computed.word_count = null; }, "computed.word_count");
    expectMutationFails(Brief, monday(), (b) => { b.review.big_picture = null; }, "review.big_picture");
    expectValid(Brief, { ...weekday(), story: null });
    expectValid(Brief, { ...weekday(), status_note: null });
  });

  it("refuses an unknown key at every level", () => {
    const places: [(b: any) => void, string][] = [
      [(b) => { b.extra = 1; }, ""],
      [(b) => { b.languages.extra = 1; }, "languages"],
      [(b) => { b.pace.extra = 1; }, "pace"],
      [(b) => { b.lead[0].extra = 1; }, "lead.0"],
      [(b) => { b.story.extra = 1; }, "story"],
      [(b) => { b.items[0].extra = 1; }, "items.0"],
      [(b) => { b.rung_changes[0].extra = 1; }, "rung_changes.0"],
      [(b) => { b.ideas[0].extra = 1; }, "ideas.0"],
      [(b) => { b.also[0].extra = 1; }, "also.0"],
      [(b) => { b.corrections[0].extra = 1; }, "corrections.0"],
      [(b) => { b.reports[0].extra = 1; }, "reports.0"],
      [(b) => { b.sources[0].extra = 1; }, "sources.0"],
      [(b) => { b.computed.extra = 1; }, "computed"],
      [(b) => { b.provenance.extra = 1; }, "provenance"],
    ];
    for (const [mutate, path] of places) expectMutationFails(Brief, weekday(), mutate, path, "Unrecognized key");
    expectMutationFails(Brief, monday(), (b) => { b.review.extra = 1; }, "review", "Unrecognized key");
    expectMutationFails(Brief, monday(), (b) => { b.review.remarkable.extra = 1; }, "review.remarkable", "Unrecognized key");
    expectMutationFails(Brief, monday(), (b) => { b.review.strongest_against.extra = 1; }, "review.strongest_against", "Unrecognized key");
    expectMutationFails(Brief, monday(), (b) => { b.review.field_counts[0].extra = 1; }, "review.field_counts.0", "Unrecognized key");
    expectMutationFails(Brief, sunday(), (b) => { b.deep_dive.extra = 1; }, "deep_dive", "Unrecognized key");
  });

  it("refuses the keys of the draft, since a brief has none of them", () => {
    for (const key of ["generated_at", "new_findings", "returning", "report_decisions"]) {
      expectMutationFails(Brief, weekday(), (b) => { b[key] = []; }, "", "Unrecognized key");
    }
  });
});

describe("Brief: the day and the kind of edition", () => {
  it("takes a real calendar date and a schema version of 1", () => {
    expectMutationFails(Brief, weekday(), (b) => { b.date = "2026-02-30"; }, "date");
    expectMutationFails(Brief, weekday(), (b) => { b.date = "24 Nov 2026"; }, "date");
    expectMutationFails(Brief, weekday(), (b) => { b.schema_version = 2; }, "schema_version");
  });

  it("takes one of the three editions", () => {
    for (const edition of ["full", "partial", "data_only"]) expectValid(Brief, edition === "data_only" ? { ...dataOnly() } : { ...weekday(), edition });
    expectMutationFails(Brief, weekday(), (b) => { b.edition = "draft"; }, "edition");
  });

  it("makes the format that of the date's weekday", () => {
    expectValid(Brief, weekday());
    expectMutationFails(Brief, weekday(), (b) => { b.format = "monday_review"; }, "format", "daily");
    expectMutationFails(Brief, monday(), (b) => { b.format = "daily"; }, "format", "monday_review");
    expectMutationFails(Brief, sunday(), (b) => { b.format = "daily"; }, "format", "sunday_deep_dive");
    expectMutationFails(Brief, weekday(), (b) => { b.format = "weekly"; }, "format");
  });

  it("leaves the weekday check to Brief: BriefBase, the unrefined object, takes any format", () => {
    expectValid(BriefBase, { ...weekday(), format: "monday_review" });
    expectIssue(Brief, { ...weekday(), format: "monday_review" }, "format", "daily");
    expectIssue(BriefBase, { ...weekday(), format: "weekly" }, "format");
  });

  it("takes English as always present and Chinese as a flag", () => {
    expectValid(BriefLanguages, { en: true, zh: false });
    expectValid(BriefLanguages, { en: true, zh: true });
    expectOnlyIssue(BriefLanguages, { en: false, zh: true }, "en");
    expectOnlyIssue(BriefLanguages, { en: true, zh: "yes" }, "zh");
  });

  it("takes a timestamp with an offset for published_at and a flag for late", () => {
    expectMutationFails(Brief, weekday(), (b) => { b.published_at = "2026-11-24"; }, "published_at");
    expectMutationFails(Brief, weekday(), (b) => { b.published_at = "2026-11-24T25:00:00+08:00"; }, "published_at");
    expectMutationFails(Brief, weekday(), (b) => { b.late = "no"; }, "late");
  });
});

describe("Brief: the Pace line", () => {
  it("points at the metrics file of the edition's own date", () => {
    expectValid(BriefPace, weekday().pace);
    expectMutationFails(Brief, weekday(), (b) => { b.pace.metrics_file = "metrics/2026-11-23.json"; }, "pace.metrics_file", "metrics/2026-11-24.json");
    expectMutationFails(Brief, weekday(), (b) => { b.pace.metrics_file = "content/metrics/2026-11-24.json"; }, "pace.metrics_file");
    expectOnlyIssue(BriefPace, { ...weekday().pace, metrics_file: "metrics/today.json" }, "metrics_file");
    // The whole string is the path: nothing before it, nothing after it.
    for (const bad of ["x metrics/2026-11-24.json", "xmetrics/2026-11-24.json", "metrics/2026-11-24.json.bak", "metrics/2026-11-24.json\n"]) {
      expectOnlyIssue(BriefPace, { ...weekday().pace, metrics_file: bad }, "metrics_file");
    }
  });

  it("takes the metrics file's three statuses", () => {
    for (const status of ["ok", "stale", "missing"]) expectValid(BriefPace, { ...weekday().pace, status });
    expectOnlyIssue(BriefPace, { ...weekday().pace, status: "late" }, "status");
  });
});

describe("Brief: findings, items and rung changes", () => {
  it("gives a new finding no update and a returning finding an update", () => {
    expectValid(BriefItem, { finding_id: "bio-2026-0001", new: true, update: null });
    expectValid(BriefItem, { finding_id: "bio-2026-0001", new: false, update: lz("New facts.", "新的事實。") });
    expectOnlyIssue(BriefItem, { finding_id: "bio-2026-0001", new: true, update: l("New facts.") }, "update", "A new finding has no update");
    expectOnlyIssue(BriefItem, { finding_id: "bio-2026-0001", new: false, update: null }, "update", "A returning finding has an update");
    expectMutationFails(Brief, weekday(), (b) => { b.story.update = l("A story with an update."); }, "story.update");
    expectMutationFails(Brief, weekday(), (b) => { b.items[1].update = null; }, "items.1.update");
  });

  it("names a finding by its id, never by a draft ref", () => {
    expectMutationFails(Brief, weekday(), (b) => { b.story.finding_id = "new-1"; }, "story.finding_id");
    expectMutationFails(Brief, weekday(), (b) => { b.items[0].finding_id = "bio-26-1"; }, "items.0.finding_id");
    expectMutationFails(Brief, weekday(), (b) => { b.lead[0].finding_ids = ["new-1"]; }, "lead.0.finding_ids.0");
    expectMutationFails(Brief, weekday(), (b) => { b.items[0].finding_id = "cyber-2026-0001"; }, "items.0.finding_id");
  });

  it("gives a Lead sentence its text in both languages and the findings it cites", () => {
    expectValid(LeadLine, { text: lz("A sentence.", "一句話。"), finding_ids: [] });
    expectOnlyIssue(LeadLine, { text: "A sentence.", finding_ids: [] }, "text");
    expectOnlyIssue(LeadLine, { text: l("A sentence."), finding_ids: "bio-2026-0001" }, "finding_ids");
  });

  it("takes rung changes from one rung to another, by the script or the agent", () => {
    expect([...RUNG_CHANGE_BY]).toEqual(["script", "agent"]);
    expectValid(RungChange, { finding_id: "phys-2026-0003", from: "checked", to: "retracted", date: "2026-11-23", by: "agent" });
    expectOnlyIssue(RungChange, { finding_id: "phys-2026-0003", from: "checked", to: "fixed", date: "2026-11-23", by: "agent" }, "to");
    expectOnlyIssue(RungChange, { finding_id: "phys-2026-0003", from: "checked", to: "retracted", date: "2026-11-23", by: "seed" }, "by");
    expectOnlyIssue(RungChange, { finding_id: "phys-2026-0003", from: "checked", to: "retracted", date: "yesterday", by: "agent" }, "date");
  });

  it("runs the rung changes newest first", () => {
    const two = (first: string, second: string) => [
      { finding_id: "phys-2026-0003", from: "preprint", to: "checked", date: first, by: "script" },
      { finding_id: "math-2026-0002", from: "claimed", to: "preprint", date: second, by: "agent" },
    ];
    expectValid(Brief, { ...weekday(), rung_changes: two("2026-11-23", "2026-11-22") });
    expectValid(Brief, { ...weekday(), rung_changes: two("2026-11-23", "2026-11-23") });
    expectMutationFails(Brief, weekday(), (b) => { b.rung_changes = two("2026-11-22", "2026-11-23"); }, "rung_changes.1.date", "newest first");
  });
});

describe("Brief: ideas, also-noted lines and the deep dive", () => {
  it("cites a brief-level source (b1) for an idea and an also-noted line", () => {
    expectValid(IdeaLine, weekday().ideas[0]);
    expectOnlyIssue(IdeaLine, { ...weekday().ideas[0], source_id: "s1" }, "source_id");
    expectOnlyIssue(IdeaLine, { ...weekday().ideas[0], who: "" }, "who");
    expectValid(AlsoLine, weekday().also[0]);
    expectOnlyIssue(AlsoLine, { ...weekday().also[0], source_id: "s1" }, "source_id");
    expectOnlyIssue(AlsoLine, { ...weekday().also[0], field: "astronomy" }, "field");
  });

  it("gives the deep dive a finding, its text, brief-level sources and one of three reasons", () => {
    expect([...WHY_TODAY]).toEqual(["news", "anniversary", "rotation"]);
    for (const why of WHY_TODAY) expectValid(BriefDeepDive, { ...sunday().deep_dive, why_today: why });
    expectOnlyIssue(BriefDeepDive, { ...sunday().deep_dive, why_today: "luck" }, "why_today");
    expectOnlyIssue(BriefDeepDive, { ...sunday().deep_dive, source_ids: ["s1"] }, "source_ids.0");
    expectOnlyIssue(BriefDeepDive, { ...sunday().deep_dive, finding_id: "new-1" }, "finding_id");
  });
});

describe("Brief: corrections, reports and sources", () => {
  const target = (finding: string | null, edition: string | null, term: string | null) => ({
    ...weekday().corrections[0], finding_id: finding, edition_date: edition, term_id: term,
  });

  it("lists a correction that names exactly one record", () => {
    expectValid(BriefCorrection, target("chem-2026-0004", null, null));
    expectValid(BriefCorrection, target(null, "2026-11-20", null));
    expectValid(BriefCorrection, target(null, null, "protein-folding"));
    expectOnlyIssue(BriefCorrection, target(null, null, null), "", "Exactly one");
    expectOnlyIssue(BriefCorrection, target("chem-2026-0004", "2026-11-20", null), "", "Exactly one");
    expectOnlyIssue(BriefCorrection, target("chem-2026-0004", null, "protein-folding"), "", "Exactly one");
    expectMutationFails(Brief, weekday(), (b) => { b.corrections[0].term_id = "protein-folding"; }, "corrections.0", "Exactly one");
  });

  it("lists a correction with its id, type and reason, and none of the stored correction's other keys", () => {
    expectOnlyIssue(BriefCorrection, { ...target("chem-2026-0004", null, null), id: "C-1" }, "id");
    expectOnlyIssue(BriefCorrection, { ...target("chem-2026-0004", null, null), type: "retraction" }, "type");
    expectOnlyIssue(BriefCorrection, { ...target("chem-2026-0004", null, null), reason: "plain" }, "reason");
    expectOnlyIssue(BriefCorrection, { ...target("chem-2026-0004", null, null), path: "title" }, "", "Unrecognized key");
  });

  it("lists a report decided today, upheld or rejected", () => {
    expectValid(BriefReport, { id: "R-0002", finding_id: "bio-2026-0001", status: "upheld" });
    expectOnlyIssue(BriefReport, { id: "R-0002", finding_id: "bio-2026-0001", status: "open" }, "status");
    expectOnlyIssue(BriefReport, { id: "R2", finding_id: "bio-2026-0001", status: "upheld" }, "id");
  });

  it("gives the brief-level sources b ids and a source's own keys", () => {
    expectMutationFails(Brief, weekday(), (b) => { b.sources[0].id = "s1"; }, "sources.0.id");
    expectMutationFails(Brief, weekday(), (b) => { delete b.sources[0].seen_as; }, "sources.0.seen_as");
    expectMutationFails(Brief, weekday(), (b) => { b.sources[1].kind = "press"; }, "sources.1.kind");
  });
});

describe("Brief: the disclosure paths", () => {
  it("lists the brief-level lines that name Anthropic or Claude", () => {
    expectValid(Brief, { ...weekday(), disclosure: ["ideas.0", "also.0"] });
    expectValid(Brief, { ...sunday(), disclosure: ["deep_dive"] });
    expectValid(Brief, { ...monday(), disclosure: ["review"] });
  });

  it("refuses a path that is not one of the four forms", () => {
    for (const path of ["story", "items.0", "ideas", "ideas.-1", "ideas.01", "also.x", "lead.0", "deep_dive.text", "Review"]) {
      expectMutationFails(Brief, weekday(), (b) => { b.disclosure = [path]; }, "disclosure.0", "Expected ideas.<i>, also.<i>, deep_dive or review");
    }
  });

  it("refuses a path that names a line the brief does not have", () => {
    expectMutationFails(Brief, weekday(), (b) => { b.disclosure = ["ideas.1"]; }, "disclosure.0", "ideas.1");
    expectMutationFails(Brief, weekday(), (b) => { b.disclosure = ["also.1"]; }, "disclosure.0", "also.1");
    expectMutationFails(Brief, weekday(), (b) => { b.disclosure = ["deep_dive"]; }, "disclosure.0", "deep_dive");
    expectMutationFails(Brief, weekday(), (b) => { b.disclosure = ["review"]; }, "disclosure.0", "review");
  });

  it("lists a path once", () => {
    expectMutationFails(Brief, weekday(), (b) => { b.disclosure = ["also.0", "also.0"]; }, "disclosure", "must not repeat");
  });
});

describe("Brief: a data-only edition", () => {
  it("holds nothing a script did not compose", () => {
    const filled: Record<string, unknown> = {
      lead: weekday().lead, story: weekday().story, items: weekday().items, ideas: weekday().ideas, also: weekday().also,
      deep_dive: sunday().deep_dive, review: week(), corrections: weekday().corrections, sources: weekday().sources, disclosure: ["also.0"],
    };
    expect(Object.keys(filled)).toHaveLength(10);
    for (const [key, value] of Object.entries(filled)) {
      const found = issuesOf(Brief, { ...dataOnly(), [key]: value });
      expect(found.some((i) => i.path === key && i.message === `A data-only edition has no ${key}`), `${key}: ${JSON.stringify(found)}`).toBe(true);
    }
  });

  it("keeps the Pace, the script's rung changes and the reports decided", () => {
    expectValid(Brief, { ...dataOnly(), rung_changes: weekday().rung_changes, reports: [{ id: "R-0003", finding_id: "bio-2026-0001", status: "upheld" }] });
  });

  it("is checked as any other edition is", () => {
    expectMutationFails(Brief, dataOnly(), (b) => { b.format = "monday_review"; }, "format");
    expectMutationFails(Brief, dataOnly(), (b) => { b.pace.metrics_file = "metrics/2026-11-23.json"; }, "pace.metrics_file");
  });
});

describe("Brief: the counts and the provenance", () => {
  it("takes counts that are whole numbers, and a null zh_chars on an English-only edition", () => {
    expectValid(BriefComputed, weekday().computed);
    expectValid(BriefComputed, { ...weekday().computed, zh_chars: null });
    expectOnlyIssue(BriefComputed, { ...weekday().computed, word_count: -1 }, "word_count");
    expectOnlyIssue(BriefComputed, { ...weekday().computed, finding_count: 1.5 }, "finding_count");
    expectOnlyIssue(BriefComputed, { ...weekday().computed, source_count: "2" }, "source_count");
  });

  it("takes a run id, a 40-character commit and a date as the provenance", () => {
    expectValid(BriefProvenance, weekday().provenance);
    expectOnlyIssue(BriefProvenance, { ...weekday().provenance, run_id: "2026-11-24" }, "run_id");
    expectOnlyIssue(BriefProvenance, { ...weekday().provenance, code_commit: "abc123" }, "code_commit");
    expectOnlyIssue(BriefProvenance, { ...weekday().provenance, code_commit: "A".repeat(40) }, "code_commit");
    expectOnlyIssue(BriefProvenance, { ...weekday().provenance, data_cutoff: "2026-13-01" }, "data_cutoff");
  });

  it("makes the data cutoff a Sunday, whatever the status of the Pace", () => {
    expectMutationFails(Brief, weekday(), (b) => { b.provenance.data_cutoff = "2026-11-23"; }, "provenance.data_cutoff", "data_cutoff is a Sunday");
    expectMutationFails(Brief, weekday(), (b) => { b.provenance.data_cutoff = "2026-11-20"; }, "provenance.data_cutoff", "data_cutoff is a Sunday");
    // a stale or missing Pace may hold an older cutoff, but still a Sunday: a weekday earlier than the newest Sunday is no Sunday
    for (const status of ["stale", "missing"]) {
      for (const cutoff of ["2026-11-20", "2026-11-16", "2026-11-18"]) {
        expectMutationFails(Brief, { ...weekday(), pace: { ...weekday().pace, status } }, (b) => { b.provenance.data_cutoff = cutoff; }, "provenance.data_cutoff", "data_cutoff is a Sunday");
      }
    }
  });

  it("makes the cutoff the newest Sunday the date allows when the Pace is ok, and no later when it is not", () => {
    expectValid(Brief, weekday());
    expectMutationFails(Brief, weekday(), (b) => { b.provenance.data_cutoff = "2026-11-15"; }, "provenance.data_cutoff", "data_cutoff is the newest Sunday on or before the date minus 2 days (2026-11-22)");
    expectMutationFails(Brief, weekday(), (b) => { b.provenance.data_cutoff = "2026-11-29"; }, "provenance.data_cutoff", "data_cutoff is the newest Sunday on or before the date minus 2 days (2026-11-22)");
    for (const status of ["stale", "missing"]) {
      // the newest Sunday itself is as late as the cutoff may be
      expectValid(Brief, { ...weekday(), pace: { ...weekday().pace, status }, provenance: { ...weekday().provenance, data_cutoff: "2026-11-22" } });
      expectValid(Brief, { ...weekday(), pace: { ...weekday().pace, status }, provenance: { ...weekday().provenance, data_cutoff: "2026-11-15" } });
      expectMutationFails(Brief, { ...weekday(), pace: { ...weekday().pace, status } }, (b) => { b.provenance.data_cutoff = "2026-11-29"; }, "provenance.data_cutoff", "no later than");
    }
    expectMutationFails(Brief, monday(), (b) => { b.provenance.data_cutoff = "2026-11-22"; }, "provenance.data_cutoff", "2026-11-15");
  });
});

describe("WeekReview: the Monday review", () => {
  it("accepts a review of a week, and a short week with no finding", () => {
    expectValid(WeekReview, week());
    expectValid(WeekReview, {
      ...week(),
      big_picture: l("A quiet week."), remarkable: null,
      strongest_against: { text: l("None found this week."), finding_ids: [], source_ids: [] },
      fell: [],
    });
  });

  it("has the types the spec gives", () => {
    expectTypeOf<WeekReviewType["remarkable"]>().toEqualTypeOf<{ finding_id: string; note: L10n } | null>();
    expectTypeOf<WeekReviewType["strongest_against"]>().toEqualTypeOf<{ text: L10n; finding_ids: string[]; source_ids: string[] }>();
    expectTypeOf<WeekReviewType["field_counts"][number]>().toEqualTypeOf<{ field: (typeof FIELDS)[number]; reported: number; counted: number }>();
  });

  it("needs every key, with null only for the remarkable finding", () => {
    for (const key of Object.keys(week())) expectMutationFails(WeekReview, week(), (w) => delete w[key], key);
    for (const key of Object.keys(week()).filter((k) => k !== "remarkable")) expectMutationFails(WeekReview, week(), (w) => { w[key] = null; }, key);
    expectOnlyIssue(WeekReview, { ...week(), extra: 1 }, "", "Unrecognized key");
  });

  it("has seven field counts, one for each field in order", () => {
    expectValid(FieldCounts, fieldCounts());
    expectMutationFails(WeekReview, week(), (w) => { w.field_counts.pop(); }, "field_counts", "exactly");
    expectMutationFails(WeekReview, week(), (w) => { w.field_counts.reverse(); }, "field_counts", "in that order");
    expectMutationFails(WeekReview, week(), (w) => { w.field_counts[1].field = "mathematics"; }, "field_counts", "exactly");
    expectMutationFails(WeekReview, week(), (w) => { w.field_counts.push(copy(w.field_counts[0])); }, "field_counts", "exactly");
  });

  it("counts at most what was reported", () => {
    expectValid(FieldCount, { field: "physics", reported: 2, counted: 2 });
    expectValid(FieldCount, { field: "physics", reported: 2, counted: 0 });
    expectOnlyIssue(FieldCount, { field: "physics", reported: 1, counted: 2 }, "counted", "at most reported");
    expectOnlyIssue(FieldCount, { field: "physics", reported: 1.5, counted: 0 }, "reported");
    expectValid(FieldCountBase, { field: "physics", reported: 1, counted: 2 });
    expectMutationFails(WeekReview, week(), (w) => { w.field_counts[2].counted = 5; }, "field_counts.2.counted", "at most reported");
  });

  it("lists a fallen finding and a setback once", () => {
    expectMutationFails(WeekReview, week(), (w) => { w.fell = ["phys-2026-0003", "phys-2026-0003"]; }, "fell", "must not repeat");
    expectMutationFails(WeekReview, week(), (w) => { w.setbacks = ["bio-2026-0001", "bio-2026-0001"]; }, "setbacks", "must not repeat");
    expectMutationFails(WeekReview, week(), (w) => { w.fell = ["new-1"]; }, "fell.0");
  });

  it("names the remarkable finding and the strongest evidence against by finding and brief-level source", () => {
    expectValid(RemarkableFinding, week().remarkable);
    expectOnlyIssue(RemarkableFinding, { finding_id: "new-1", note: l("A note.") }, "finding_id");
    expectValid(StrongestAgainst, week().strongest_against);
    expectOnlyIssue(StrongestAgainst, { ...week().strongest_against, source_ids: ["s1"] }, "source_ids.0");
    expectOnlyIssue(StrongestAgainst, { ...week().strongest_against, finding_ids: ["x"] }, "finding_ids.0");
  });
});
