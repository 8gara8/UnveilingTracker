// The structure rules (SPEC §4.12; lib/rules/structure.ts): DATE_MISMATCH, REF_UNKNOWN, FORMAT_SECTIONS, WEEK_AGAINST, COUNTS,
// FIELD_CAP, STORY_PICK and SOURCE_IDS. Every sentence of each row is at least one test that fails when the rule is wrong, and
// each rule is tried in the three places SPEC §4.12 "Stored records" tells apart: a draft (judged against the run's context),
// a stored brief that is being published (also judged against `config/`), and a stored record that is not (judged against what
// cannot change after it was published). A stored brief is built by hand, so the cases that no draft can reach are here too:
// FORMAT_SECTIONS' Sunday and Monday tests against a context, WEEK_AGAINST's `NONE_FOUND` beside a setback.
//
// The world is the validator frame's (tests/helpers/rule-world.ts: the Tuesday draft and its context, the stored Tuesday, and
// a Monday and a Sunday made from them); the four valid sample drafts of fixtures/src/ are run through the group as well.
//
// New for this project; Cyber's tests/validate.test.ts held its date, cap and id cases inside one file for every rule.

import { describe, expect, it } from "vitest";
import { dataCutoffFor, lastSunday, weekday } from "@/lib/dates";
import { RULE_CODE_TABLE, RULE_GROUPS, RULES, codeInfo, codesOfGroup } from "@/lib/rules";
import { buildDraftInput, buildPublishedInput, runRules, type DraftInputs } from "@/lib/rules/run";
import { isNewRef, shownItems } from "@/lib/rules/shared";
import { structureRules } from "@/lib/rules/structure";
import type { DraftInput, PublishedInput, Rule, RuleInput, ValidationIssue } from "@/lib/rules/types";
import { Brief } from "@/lib/schema/brief";
import { AgentContext } from "@/lib/schema/context";
import { DraftBrief } from "@/lib/schema/draft";
import { Correction } from "@/lib/schema/misc";
import { validateDraft } from "@/lib/validate";
import { FIELDS, NONE_FOUND, REMOVED_TEXT, SIGNIFICANCE, SIGNIFICANCE_INFO, formatForWeekday } from "@/lib/vocab";
import { editionDraft } from "../fixtures/src/drafts";
import { draftInputs as sampleInputs } from "../fixtures/src/inputs";
import { EDITION_NAMES } from "../fixtures/src/world";
import type { ZhOptions } from "@/lib/validate-zh";
import {
  D, MONDAY, SUNDAY, clone, config, deepFreeze, draftInputs, l, landmarkDraft, mondayContext, pack, storedBrief, storedCorrections, storedFinding, storedWorld,
  sundayContext, weekdayContext, weekdayDraft, type Json,
} from "./helpers/rule-world";
import { zhInputOf, zhWorld, type ZhWorld } from "./helpers/zh-world";

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

const CODES = ["DATE_MISMATCH", "REF_UNKNOWN", "FORMAT_SECTIONS", "WEEK_AGAINST", "COUNTS", "FIELD_CAP", "STORY_PICK", "SOURCE_IDS"] as const;
const OTHER_DAY = "2026-11-10";
/** What REF_UNKNOWN's message says the context lists (`contextFindingIds()`). */
const CONTEXT_LISTS = "recent_findings, the week, the Sunday candidates, the open reports, the rung proposals, the standing stories, the flagged corrections or a pack candidate's stored_finding";

const ruleOf = (code: string): Rule => structureRules.find((r) => r.codes.includes(code))!;
/** The structure rules on `input`. A rule that throws is a failure here, so that no test can pass while a code filter hides the crash. */
const run = (input: RuleInput): ValidationIssue[] => {
  const issues = runRules(input, structureRules);
  const crashed = issues.filter((i) => i.code === "RULE_ERROR");
  if (crashed.length > 0) throw new Error(`a structure rule threw: ${crashed.map((i) => i.message).join(" | ")}`);
  return issues;
};
const codesOf = (issues: ValidationIssue[]): string[] => issues.map((i) => i.code);
const placed = (issues: ValidationIssue[]): string[] => issues.map((i) => `${i.code} ${i.path}`);
const only = (issues: ValidationIssue[], code: string): ValidationIssue[] => issues.filter((i) => i.code === code);

const revise = (draft: DraftBrief, change: (d: Json) => void): DraftBrief => {
  const d = clone(draft) as Json;
  change(d);
  return DraftBrief.parse(d);
};
const withContext = (context: AgentContext, change: (c: Json) => void): AgentContext => {
  const c = clone(context) as Json;
  change(c);
  return AgentContext.parse(c);
};
const draftIn = (draft: DraftBrief, over: Partial<DraftInputs> = {}): DraftInput => buildDraftInput(draft, { ...draftInputs(), ...over });

const correction = (finding: string, path: string, after: string): Json => ({
  finding_id: finding, edition_date: null, term_id: null, type: "correction", path, after, reason: "The record was wrong.", source_url: null, report_id: null,
});

/** The frame's Tuesday draft, which every structure rule passes: its new findings relate to a finding the contexts list, and the item it refiles is Major, as the story is. */
const weekdayBase = (): DraftBrief => weekdayDraft();

/** A Monday of the frame's world: one new finding in the items, the review naming the week's setback and its fall. */
const mondayBase = (): DraftBrief => revise(weekdayDraft(), (d) => {
  d.date = MONDAY;
  d.lead = [{ text: "A made-up week.", refs: ["new-1"] }];
  d.story = null;
  d.items = ["new-1"];
  d.new_findings = [d.new_findings[0]];
  d.returning = [];
  d.rung_changes = [];
  d.ideas = [];
  d.also = [];
  d.corrections = [];
  d.report_decisions = [];
  d.sources = [];
  d.review = {
    big_picture: "A made-up big picture.",
    remarkable: { finding_id: "math-2026-0002", note: "A made-up note." },
    strongest_against: { text: "A made-up counterpoint.", finding_ids: ["chem-2026-0004", "phys-2026-0003"], source_ids: [] },
  };
});

/** A Sunday of the frame's world: one new finding in the items and a deep dive on the first candidate of the context. */
const sundayBase = (): DraftBrief => revise(weekdayDraft(), (d) => {
  d.date = SUNDAY;
  d.lead = [{ text: "A made-up Sunday.", refs: ["new-1"] }];
  d.story = null;
  d.items = ["new-1"];
  d.new_findings = [d.new_findings[0]];
  d.returning = [];
  d.rung_changes = [];
  d.ideas = [];
  d.also = [];
  d.corrections = [];
  d.report_decisions = [];
  d.sources = [d.sources[0]];
  d.deep_dive = { finding_id: "bio-2024-0007", text: "A made-up deep dive.", source_ids: ["b1"], why_today: "anniversary" };
});

/** The Monday context with `week` changed. */
const weekWith = (week: Json, n = 3): AgentContext => withContext(mondayContext(n), (c) => { Object.assign(c.week, week); });
const EMPTY_WEEK = { findings: [], rung_changes: [], setbacks: [] };
const weekFinding = (id: string, kind = "result"): Json => ({ id, title: `A made-up result of ${id}`, field: "mathematics", kind, significance: "notable", rung: "checked" });
const rungChange = (id: string, to: string): Json => ({ finding_id: id, from: "preprint", to, date: "2026-11-20", by: "agent" });
/** A Monday context whose week lists each of `entries` (id, kind) as filed, `setbacks` being those of kind setback, and `falls` as its rung changes. */
const weekOf = (entries: [string, string][], falls: Json[] = []): AgentContext => weekWith({
  findings: entries.map(([id, kind]) => weekFinding(id, kind)),
  setbacks: entries.filter(([, kind]) => kind === "setback").map(([id]) => id),
  rung_changes: falls,
});

const mondayIn = (draft = mondayBase(), context = mondayContext()): DraftInput => draftIn(draft, { context });
const sundayIn = (draft = sundayBase(), context = sundayContext()): DraftInput => draftIn(draft, { context });

/** A Monday draft whose `strongest_against` is `strongest`, its two lists empty unless the call gives them. */
const against = (strongest: Json, base = mondayBase()): DraftBrief => revise(base, (d) => {
  d.review.strongest_against = { text: "A made-up counterpoint.", finding_ids: [], source_ids: [], ...strongest };
});

// Stored records.

type World = ReturnType<typeof storedWorld>;
const publishedIn = (brief: Brief | null, opts: { publishing?: string | null; fileDate?: string | null; world?: World; date?: string } = {}): PublishedInput => {
  const world = opts.world ?? storedWorld();
  const options = {
    config: world.config, publishing: opts.publishing === undefined ? brief?.date ?? null : opts.publishing, fileDate: opts.fileDate ?? null,
  };
  return brief === null ? buildPublishedInput(null, world, { ...options, date: opts.date ?? D }) : buildPublishedInput(brief, world, options);
};
const storedOn = (date: string, change: (b: Json) => void = () => undefined): Brief => {
  const b = clone(storedBrief()) as Json;
  b.date = date;
  b.format = formatForWeekday(weekday(date));
  b.pace.metrics_file = `metrics/${date}.json`;
  b.provenance.data_cutoff = lastSunday(dataCutoffFor(date));
  change(b);
  return Brief.parse(b);
};
const revised = (brief: Brief, change: (b: Json) => void): Brief => {
  const b = clone(brief) as Json;
  change(b);
  return Brief.parse(b);
};
const quiet = (b: Json): void => {
  b.lead = [];
  b.story = null;
  b.items = [];
  b.rung_changes = [];
  b.ideas = [];
  b.also = [];
  b.deep_dive = null;
  b.review = null;
  b.corrections = [];
  b.reports = [];
  b.sources = [];
  b.disclosure = [];
};
const storedMonday = (review: Json = {}, change: (b: Json) => void = () => undefined): Brief => storedOn(MONDAY, (b) => {
  quiet(b);
  b.items = [{ finding_id: "math-2026-0002", new: true, update: null }];
  b.lead = [{ text: l("A made-up week."), finding_ids: ["math-2026-0002"] }];
  b.review = {
    big_picture: l("A made-up big picture."),
    remarkable: { finding_id: "math-2026-0002", note: l("A made-up note.") },
    strongest_against: { text: l("A made-up counterpoint."), finding_ids: ["chem-2026-0004", "phys-2026-0003"], source_ids: [] },
    field_counts: FIELDS.map((field) => ({ field, reported: 0, counted: 0 })),
    fell: ["phys-2026-0003"],
    setbacks: ["chem-2026-0004"],
    ...review,
  };
  change(b);
});
const storedSunday = (change: (b: Json) => void = () => undefined): Brief => storedOn(SUNDAY, (b) => {
  quiet(b);
  b.items = [{ finding_id: "math-2026-0002", new: true, update: null }];
  b.lead = [{ text: l("A made-up Sunday."), finding_ids: ["math-2026-0002"] }];
  b.sources = [clone(storedBrief().sources[0])];
  b.deep_dive = { finding_id: "bio-2026-0001", text: l("A made-up deep dive."), source_ids: ["b1"], why_today: "rotation" };
  change(b);
});
const storedDataOnly = (date: string): Brief => storedOn(date, (b) => {
  quiet(b);
  b.edition = "data_only";
  b.status_note = l("A made-up data-only note.");
});

const stored = (id: string, over: Json = {}) => storedFinding(id, { depth: "item", first_brief: D, briefs: [D], terms: [], ...over });
const worldWith = (extra: string[] = [], corrections: Correction[] = []): World => {
  const world = storedWorld();
  return { ...world, findings: [...world.findings, ...extra.map((id) => stored(id))], corrections: [...world.corrections, ...corrections] };
};
const filing = (id: string, date: string, finding: string, path: string, after: string): Correction => Correction.parse({
  id, date, finding_id: finding, edition_date: null, term_id: null, type: "correction", path,
  before: l("before"), after: l(after), reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
});

/** The three record sets of published mode: the brief being published, a stored brief, and a stored brief while another is published. */
const RECORD_SETS: [string, (brief: Brief) => string | null][] = [
  ["a brief being published", (b) => b.date],
  ["a stored brief", () => null],
  ["a stored brief while another edition is published", () => OTHER_DAY],
];

// ── The group ────────────────────────────────────────────────────────────────────────────────────

describe("the structure group", () => {
  it("exports one rule for each of its eight codes, in the table's order, as the registry holds them", () => {
    expect(structureRules.map((r) => r.codes)).toEqual(CODES.map((c) => [c]));
    expect(codesOfGroup("structure")).toEqual([...CODES]);
    expect(RULE_CODE_TABLE.filter((r) => r.group === "structure")).toHaveLength(8);
    expect(RULE_GROUPS.find((g) => g.group === "structure")!.rules).toBe(structureRules);
    expect(RULES.filter((r) => structureRules.includes(r))).toHaveLength(8);
  });

  it("makes each rule hard, with no run input it cannot work without, in exactly the modes the table gives it", () => {
    for (const rule of structureRules) {
      const info = codeInfo(rule.codes[0])!;
      expect(info.severity, rule.codes[0]).toBe("H");
      expect(rule.severity, rule.codes[0]).toBe("error");
      expect([...rule.scope].sort(), rule.codes[0]).toEqual([...info.scopes].sort());
      expect(rule.needs, rule.codes[0]).toEqual([]);
      expect(rule.uses ?? [], rule.codes[0]).toEqual([]);
    }
    expect(structureRules.filter((r) => r.scope.length === 1).map((r) => r.codes[0])).toEqual(["REF_UNKNOWN"]);
    expect(ruleOf("REF_UNKNOWN").scope).toEqual(["draft"]);
  });

  it("reports only its own codes as errors, and reads the Chinese pass for DATE_MISMATCH alone: no other structure rule gives anything on a Chinese input", () => {
    const zh = zhInputOf(zhWorld());
    expect(structureRules.filter((r) => r.scope.includes("zh")).map((r) => r.codes[0])).toEqual(["DATE_MISMATCH"]);
    for (const rule of structureRules) expect(rule.check(zh), rule.codes[0]).toEqual([]);
    const wrong = zhWorld();
    wrong.draft.date = "2026-11-23";
    for (const rule of structureRules.filter((r) => r.codes[0] !== "DATE_MISMATCH")) expect(rule.check(zhInputOf(wrong)), rule.codes[0]).toEqual([]);
    const issues = run(draftIn(revise(weekdayBase(), (d) => { d.story = "new-9"; d.date = "2026-01-01"; })));
    expect(issues.length).toBeGreaterThan(1);
    for (const issue of issues) {
      expect(issue.severity).toBe("error");
      expect(CODES).toContain(issue.code);
    }
  });

  it("passes the valid weekday, Monday and Sunday of this world and the stored Tuesday, Monday and Sunday", () => {
    expect(run(draftIn(weekdayBase()))).toEqual([]);
    expect(run(mondayIn())).toEqual([]);
    expect(run(sundayIn())).toEqual([]);
    for (const set of RECORD_SETS) {
      for (const brief of [storedBrief(), storedMonday(), storedSunday()]) expect(run(publishedIn(brief, { publishing: set[1](brief) })), `${set[0]} ${brief.date}`).toEqual([]);
    }
  });

  it.each(EDITION_NAMES)("passes the valid sample %s draft of the fixtures with its own inputs", (name) => {
    const input = buildDraftInput(editionDraft(name), sampleInputs(name));
    expect(run(input)).toEqual([]);
  });

  it("reads the four sample editions as a weekday, a Sunday, a Monday and a short Monday", () => {
    expect(EDITION_NAMES.map((name) => buildDraftInput(editionDraft(name), sampleInputs(name)).edition)).toEqual(["weekday", "sunday", "monday", "short-monday"]);
  });

  it("changes nothing it reads: a deep-frozen input gives the same issues as a fresh one, and no rule throws", () => {
    const drafts = [
      revise(weekdayBase(), (d) => { d.story = "new-9"; d.items = ["new-1", "new-1", "soc-2026-9001"]; d.sources[1].id = "b9"; d.deep_dive = clone(sundayBase().deep_dive); d.date = "2026-01-01"; }),
      revise(mondayBase(), (d) => { d.review.strongest_against = { text: NONE_FOUND.en, finding_ids: ["math-2026-0002"], source_ids: ["b7"] }; }),
    ];
    for (const draft of drafts) {
      const input = draftIn(draft, { context: draft.date === MONDAY ? mondayContext() : weekdayContext() });
      const fresh = run(input);
      expect(fresh.length).toBeGreaterThan(0);
      expect(run(deepFreeze(input))).toEqual(fresh);
    }
    const brief = revised(storedMonday(), (b) => { b.review.strongest_against.text = NONE_FOUND; b.sources = []; b.ideas = [1, 2, 3].map(() => clone(storedBrief().ideas[0])); });
    const input = publishedIn(brief);
    const fresh = run(input);
    expect(fresh.length).toBeGreaterThan(0);
    expect(run(deepFreeze(input))).toEqual(fresh);
  });
});

// ── DATE_MISMATCH ────────────────────────────────────────────────────────────────────────────────

describe("DATE_MISMATCH: `date` is the context's; `generated_at` within [window end, deadline]", () => {
  const WINDOW_END = "2026-11-24T03:00:00+08:00";
  const DEADLINE = "2026-11-24T04:15:00+08:00";
  const at = (generated: string, over: Partial<DraftInputs> = {}) => draftIn(revise(weekdayBase(), (d) => { d.generated_at = generated; }), over);

  it("passes a draft dated the context's date, finished inside the window", () => {
    expect(only(run(draftIn(weekdayBase())), "DATE_MISMATCH")).toEqual([]);
  });

  it("fails a draft dated another day, at date, and says both dates and the edit", () => {
    const issues = run(draftIn(revise(weekdayBase(), (d) => { d.date = "2026-11-23"; })));
    expect(placed(issues)).toEqual(["DATE_MISMATCH date"]);
    expect(issues[0]!.message).toBe(`date is 2026-11-23 but the run's Taipei date is ${D}; set "date" to "${D}".`);
    expect(issues[0]!.hint).toBe("The edition date is the context's date, never the date of the news.");
  });

  it("holds the date to the context even when the file's name agrees with the draft", () => {
    const input = buildDraftInput(revise(weekdayBase(), (d) => { d.date = "2026-11-23"; }), { ...draftInputs(), fileDate: "2026-11-23" });
    expect(run(input).map((i) => i.message)).toEqual([`date is 2026-11-23 but the run's Taipei date is ${D}; set "date" to "${D}".`]);
  });

  it("fails a draft whose file is named for another day, and passes one whose file is named for its date or has no name", () => {
    const named = (fileDate: string | null) => buildDraftInput(weekdayBase(), { ...draftInputs(), fileDate });
    const issues = run(named("2026-11-25"));
    expect(placed(issues)).toEqual(["DATE_MISMATCH date"]);
    expect(issues[0]!.message).toBe(`date is ${D} but the file is named 2026-11-25.json; they must match.`);
    expect(run(named(D))).toEqual([]);
    expect(run(named(null))).toEqual([]);
  });

  it("reports a wrong date once, whatever the file is named", () => {
    const input = buildDraftInput(revise(weekdayBase(), (d) => { d.date = "2026-11-23"; }), { ...draftInputs(), fileDate: "2026-11-25" });
    expect(run(input)).toHaveLength(1);
  });

  it("accepts generated_at at the window's end and at the deadline, to the second", () => {
    expect(run(at(WINDOW_END))).toEqual([]);
    expect(run(at(DEADLINE))).toEqual([]);
    expect(run(at("2026-11-24T03:30:00+08:00"))).toEqual([]);
  });

  it("fails generated_at one second before the window's end, naming the window and the deadline", () => {
    const issues = run(at("2026-11-24T02:59:59+08:00"));
    expect(placed(issues)).toEqual(["DATE_MISMATCH generated_at"]);
    expect(issues[0]!.message).toBe(
      `generated_at is 2026-11-24T02:59:59+08:00, before the news window ends at ${WINDOW_END} (Asia/Taipei); set it to when you finished, between ${WINDOW_END} and ${DEADLINE}.`,
    );
  });

  it("fails generated_at one second after the deadline", () => {
    const issues = run(at("2026-11-24T04:15:01+08:00"));
    expect(placed(issues)).toEqual(["DATE_MISMATCH generated_at"]);
    expect(issues[0]!.message).toBe(
      `generated_at is 2026-11-24T04:15:01+08:00, after the deadline ${DEADLINE} (Asia/Taipei); set it to when you finished, between ${WINDOW_END} and ${DEADLINE}.`,
    );
  });

  it("compares instants, not clock readings: the same moments in another offset", () => {
    expect(run(at("2026-11-23T19:00:00+00:00"))).toEqual([]);
    expect(run(at("2026-11-23T20:15:00+00:00"))).toEqual([]);
    expect(placed(run(at("2026-11-23T18:59:59+00:00")))).toEqual(["DATE_MISMATCH generated_at"]);
    expect(placed(run(at("2026-11-23T20:15:01+00:00")))).toEqual(["DATE_MISMATCH generated_at"]);
    expect(placed(run(at("2026-11-24T04:00:00+01:00")))).toEqual(["DATE_MISMATCH generated_at"]);
  });

  it("reads the window and the deadline of the context the run has", () => {
    const later = withContext(weekdayContext(), (c) => { c.window.end = "2026-11-24T03:30:00+08:00"; c.deadline = "2026-11-24T04:30:00+08:00"; });
    expect(placed(run(at("2026-11-24T03:15:00+08:00", { context: later })))).toEqual(["DATE_MISMATCH generated_at"]);
    expect(run(at("2026-11-24T04:25:00+08:00", { context: later }))).toEqual([]);
  });

  it("reports a wrong date and a wrong time as two issues", () => {
    const draft = revise(weekdayBase(), (d) => { d.date = "2026-11-23"; d.generated_at = "2026-11-24T05:00:00+08:00"; });
    expect(placed(run(draftIn(draft)))).toEqual(["DATE_MISMATCH date", "DATE_MISMATCH generated_at"]);
  });

  it("does not throw on a timestamp that is not a time: the schema reports it, not this rule", () => {
    const input = draftIn(weekdayBase());
    const odd = { ...input, draft: { ...input.draft, brief: { ...input.draft.brief, generated_at: "soon" } } } as DraftInput;
    expect(run(odd)).toEqual([]);
  });

  describe("in zh mode: the Chinese draft's `date` is the Chinese context's; its `generated_at` within [the English draft's, the context's deadline] (F-22)", () => {
    const ENGLISH_AT = "2026-11-24T04:10:00+08:00";
    const ZH_DEADLINE = "2026-11-24T04:27:00+08:00";
    const RANGE = `between ${ENGLISH_AT} and ${ZH_DEADLINE}`;
    const zhRun = (change: (w: ZhWorld) => void = () => undefined, options: ZhOptions = {}): ValidationIssue[] => {
      const w = zhWorld();
      change(w);
      return run(zhInputOf(w, options));
    };
    const zhAt = (generated: string, options: ZhOptions = {}) => zhRun((w) => { w.draft.generated_at = generated; }, options);
    const WRONG_DATE = `date is 2026-11-23 but the context's date is ${D}; set "date" to "${D}".`;

    it("is the world's own: the English draft finished at 04:10, the Chinese one at 04:21, the deadline 04:27, the date the context's", () => {
      const w = zhWorld();
      expect([w.english.generated_at, w.draft.generated_at, w.context.deadline, w.draft.date, w.context.date]).toEqual([ENGLISH_AT, "2026-11-24T04:21:00+08:00", ZH_DEADLINE, D, D]);
    });

    it("passes a Chinese draft dated the context's date and finished between the English draft and the deadline", () => {
      expect(zhRun()).toEqual([]);
    });

    it("fails a Chinese draft dated another day, at date, and says both dates and the edit", () => {
      const issues = zhRun((w) => { w.draft.date = "2026-11-23"; });
      expect(placed(issues)).toEqual(["DATE_MISMATCH date"]);
      expect(issues[0]!.message).toBe(WRONG_DATE);
      expect(issues[0]!.hint).toBe("The edition date is the context's date, never the date of the news.");
      expect(issues[0]!.severity).toBe("error");
    });

    it("holds the date to the context even when the file's name agrees with the draft", () => {
      expect(zhRun((w) => { w.draft.date = "2026-11-23"; }, { fileDate: "2026-11-23" }).map((i) => i.message)).toEqual([WRONG_DATE]);
    });

    it("fails a Chinese draft whose file is named for another day, and passes one whose file is named for its date or has no name", () => {
      const issues = zhRun(() => undefined, { fileDate: "2026-11-25" });
      expect(placed(issues)).toEqual(["DATE_MISMATCH date"]);
      expect(issues[0]!.message).toBe(`date is ${D} but the file is named 2026-11-25.json; they must match.`);
      expect(zhRun(() => undefined, { fileDate: D })).toEqual([]);
      expect(zhRun(() => undefined, { fileDate: null })).toEqual([]);
      expect(zhRun()).toEqual([]);
    });

    it("reports a wrong date once, whatever the file is named", () => {
      expect(zhRun((w) => { w.draft.date = "2026-11-23"; }, { fileDate: "2026-11-25" })).toHaveLength(1);
    });

    it("accepts generated_at at the English draft's own time and at the deadline, to the second", () => {
      expect(zhAt(ENGLISH_AT)).toEqual([]);
      expect(zhAt(ZH_DEADLINE)).toEqual([]);
      expect(zhAt("2026-11-24T04:20:00+08:00")).toEqual([]);
    });

    it("fails generated_at one second before the English draft's, naming the English draft and the deadline", () => {
      const issues = zhAt("2026-11-24T04:09:59+08:00");
      expect(placed(issues)).toEqual(["DATE_MISMATCH generated_at"]);
      expect(issues[0]!.message).toBe(
        `generated_at is 2026-11-24T04:09:59+08:00, before the English draft was written at ${ENGLISH_AT} (Asia/Taipei); set it to when you finished, ${RANGE}.`,
      );
    });

    it("fails generated_at one second after the deadline", () => {
      const issues = zhAt("2026-11-24T04:27:01+08:00");
      expect(placed(issues)).toEqual(["DATE_MISMATCH generated_at"]);
      expect(issues[0]!.message).toBe(
        `generated_at is 2026-11-24T04:27:01+08:00, after the deadline ${ZH_DEADLINE} (Asia/Taipei); set it to when you finished, ${RANGE}.`,
      );
    });

    it("compares instants, not clock readings: the same moments in another offset", () => {
      expect(zhAt("2026-11-23T20:10:00+00:00")).toEqual([]);
      expect(zhAt("2026-11-23T20:27:00+00:00")).toEqual([]);
      expect(placed(zhAt("2026-11-23T20:09:59+00:00"))).toEqual(["DATE_MISMATCH generated_at"]);
      expect(placed(zhAt("2026-11-23T20:27:01+00:00"))).toEqual(["DATE_MISMATCH generated_at"]);
      expect(placed(zhAt("2026-11-24T04:15:00+01:00"))).toEqual(["DATE_MISMATCH generated_at"]);
    });

    it("reads the English draft's time and the Chinese context's deadline of the run it has, not the world's own", () => {
      const later = (w: ZhWorld) => { w.english.generated_at = "2026-11-24T04:20:30+08:00"; w.context.deadline = "2026-11-24T04:40:00+08:00"; };
      expect(placed(zhRun((w) => { later(w); w.draft.generated_at = "2026-11-24T04:20:29+08:00"; }))).toEqual(["DATE_MISMATCH generated_at"]);
      expect(zhRun((w) => { later(w); w.draft.generated_at = "2026-11-24T04:20:30+08:00"; })).toEqual([]);
      expect(zhRun((w) => { later(w); w.draft.generated_at = "2026-11-24T04:40:00+08:00"; })).toEqual([]);
      expect(placed(zhRun((w) => { later(w); w.draft.generated_at = "2026-11-24T04:40:01+08:00"; }))).toEqual(["DATE_MISMATCH generated_at"]);
    });

    it("reads the context's date, not the English draft's: an English draft dated otherwise changes nothing", () => {
      expect(zhRun((w) => { w.english.date = "2026-11-23"; })).toEqual([]);
      expect(placed(zhRun((w) => { w.english.date = "2026-11-23"; w.draft.date = "2026-11-23"; }))).toEqual(["DATE_MISMATCH date"]);
    });

    it("reports a wrong date and a wrong time as two issues, the date first", () => {
      const issues = zhRun((w) => { w.draft.date = "2026-11-23"; w.draft.generated_at = "2026-11-24T05:00:00+08:00"; });
      expect(placed(issues)).toEqual(["DATE_MISMATCH date", "DATE_MISMATCH generated_at"]);
    });

    it("does not throw on a time that is not a time: the schema reports it, not this rule", () => {
      const odd = (w: ZhWorld) => { w.draft.generated_at = "soon"; };
      expect(zhRun(odd)).toEqual([]);
      expect(zhRun((w) => { w.english.generated_at = "soon"; })).toEqual([]);
      expect(zhRun((w) => { w.context.deadline = "soon"; w.draft.generated_at = "2026-11-25T00:00:00+08:00"; })).toEqual([]);
    });
  });

  describe("in published mode", () => {
    it("checks only that a brief's date is its file's name, on every record", () => {
      for (const [label, publishing] of RECORD_SETS) {
        const brief = storedBrief();
        const issues = run(publishedIn(brief, { publishing: publishing(brief), fileDate: "2026-11-25" }));
        expect(placed(issues), label).toEqual(["DATE_MISMATCH briefs/2026-11-25.json: date"]);
        expect(issues[0]!.message, label).toBe(`date is ${D} but the file is named 2026-11-25.json; they must match.`);
        expect(run(publishedIn(brief, { publishing: publishing(brief), fileDate: D })), label).toEqual([]);
        expect(run(publishedIn(brief, { publishing: publishing(brief), fileDate: null })), label).toEqual([]);
      }
    });

    it("holds a data-only edition to its file's name too", () => {
      const brief = storedDataOnly(MONDAY);
      expect(placed(run(publishedIn(brief, { fileDate: D })))).toEqual([`DATE_MISMATCH briefs/${D}.json: date`]);
      expect(run(publishedIn(brief, { fileDate: MONDAY }))).toEqual([]);
    });

    it("has nothing to check for records that no brief names", () => {
      expect(run(publishedIn(null, { fileDate: D }))).toEqual([]);
    });
  });
});

// ── REF_UNKNOWN ──────────────────────────────────────────────────────────────────────────────────

describe("REF_UNKNOWN: every ref is a `new-N` in `new_findings` or a finding id in the context; every `new-N` is used exactly once in `story` or `items`; every existing finding they show has one `returning` entry, every entry names one they show, every rung change one they do not, and none is shown twice", () => {
  const refs = (draft: DraftBrief) => run(draftIn(draft));
  const unknown = (issues: ValidationIssue[]) => only(issues, "REF_UNKNOWN");

  it("passes the weekday: new refs and context ids in the Lead, the story and the items", () => {
    expect(unknown(refs(weekdayBase()))).toEqual([]);
  });

  it("fails a finding id that the context does not list, in the Lead, the story and the items, at the place it is written", () => {
    const issues = unknown(refs(revise(weekdayBase(), (d) => {
      d.lead[1].refs = ["math-2026-0002", "soc-2026-9001"];
      d.items = ["new-2", "math-2026-0002", "hum-2026-9002"];
    })));
    expect(placed(issues)).toEqual(["REF_UNKNOWN items[2]", "REF_UNKNOWN lead[1].refs[1]"]);
    expect(issues[1]!.message).toContain("lead[1].refs[1] is soc-2026-9001, which is neither a new-N ref of new_findings nor a finding id the context lists");
    expect(issues[1]!.message).toContain("never invent an id");
    const story = unknown(refs(revise(weekdayBase(), (d) => { d.story = "soc-2026-9001"; d.items = ["new-1", "new-2", "math-2026-0002"]; })));
    expect(placed(story)).toEqual(["REF_UNKNOWN story"]);
    expect(story[0]!.message).toContain("story is soc-2026-9001, which is neither a new-N ref of new_findings nor a finding id the context lists");
  });

  it("passes an id that any list of the context names, and fails one that none does", () => {
    const listed = (id: string, change: (c: Json) => void) => {
      const context = withContext(weekdayContext(), (c) => { c.recent_findings = c.recent_findings.filter((f: Json) => f.id !== "math-2026-0002"); c.reports = []; c.standing_stories = []; change(c); });
      return unknown(run(draftIn(weekdayBase(), { context })));
    };
    expect(codesOf(listed("math-2026-0002", () => undefined))).toContain("REF_UNKNOWN");
    const entry = { id: "math-2026-0002", title: "t", field: "mathematics", rung: "preprint", significance: "notable", artefacts: weekdayContext().recent_findings[0]!.artefacts };
    expect(listed("math-2026-0002", (c) => { c.recent_findings.push(entry); })).toEqual([]);
    expect(listed("math-2026-0002", (c) => { c.standing_stories = [{ id: "erdos-problems", finding_ids: ["math-2026-0002"], rule: "r" }]; })).toEqual([]);
    expect(listed("math-2026-0002", (c) => { c.corrections.flagged = [{ finding_id: "math-2026-0002", edition_date: null, term_id: null, path: "title", code: "DUAL_USE" }]; })).toEqual([]);
    expect(listed("math-2026-0002", (c) => { c.rung_proposals = [{ finding_id: "math-2026-0002", kind: "journal_version", to: "confirmed", date: "2026-11-20", url: "https://example.org/journal/1", note: "n" }]; })).toEqual([]);
  });

  it("passes a Sunday candidate and a Monday week finding as refs", () => {
    const sunday = revise(sundayBase(), (d) => { d.lead[0].refs = ["new-1", "math-2025-0009"]; });
    expect(unknown(run(sundayIn(sunday)))).toEqual([]);
    const monday = revise(mondayBase(), (d) => { d.lead[0].refs = ["new-1", "math-2026-0002", "phys-2026-0003"]; });
    expect(unknown(run(mondayIn(monday, mondayContext())))).toEqual([]);
    const stranger = revise(monday, (d) => { d.lead[0].refs = ["new-1", "soc-2026-9001"]; });
    expect(placed(unknown(run(mondayIn(stranger))))).toEqual(["REF_UNKNOWN lead[0].refs[1]"]);
  });

  it("fails a `new-N` that new_findings does not define, in the Lead, the story and the items, and lists the refs it has", () => {
    const issues = unknown(refs(revise(weekdayBase(), (d) => {
      d.lead[0].refs = ["new-1", "new-7"];
      d.story = "new-8";
      d.items = ["new-1", "new-2", "new-9", "math-2026-0002"];
    })));
    const advice = (key: string): string => `, but new_findings has no finding with that ref (it has new-1, new-2). Add the finding to new_findings with ref "${key}", or cite a finding id from the context.`;
    expect(placed(issues)).toEqual(["REF_UNKNOWN items[2]", "REF_UNKNOWN lead[0].refs[1]", "REF_UNKNOWN story"]);
    expect(issues.map((i) => i.message)).toEqual([`items[2] is new-9${advice("new-9")}`, `lead[0].refs[1] is new-7${advice("new-7")}`, `story is new-8${advice("new-8")}`]);
  });

  it("says that new_findings has none when it is empty", () => {
    const issues = unknown(refs(revise(weekdayBase(), (d) => { d.new_findings = []; d.story = "new-1"; d.items = ["math-2026-0002"]; d.lead = [{ text: "t", refs: [] }]; })));
    expect(issues.map((i) => i.message)).toEqual([
      'story is new-1, but new_findings has no finding with that ref (it has none). Add the finding to new_findings with ref "new-1", or cite a finding id from the context.',
    ]);
  });

  it("fails a new finding that neither story nor items uses, at its ref, and does not count the Lead's refs", () => {
    const orphan = revise(weekdayBase(), (d) => { d.items = ["math-2026-0002"]; });
    const issues = unknown(refs(orphan));
    expect(placed(issues)).toEqual(["REF_UNKNOWN new_findings[1].ref"]);
    expect(issues[0]!.message).toBe(
      'new_findings[1].ref (new-2) is in new_findings, but neither story nor items names it (the Lead\'s refs do not count). Add "new-2" to items, or make it the story, or delete the finding.',
    );
    expect(orphan.lead.some((line) => line.refs.includes("new-2"))).toBe(true);
  });

  it("passes a new finding used as the story, and one used in the items, once", () => {
    const swapped = revise(weekdayBase(), (d) => { d.story = "new-2"; d.items = ["new-1", "math-2026-0002"]; });
    expect(unknown(refs(swapped))).toEqual([]);
  });

  it("fails a new finding used twice, at its second use, and says where both are", () => {
    const issues = unknown(refs(revise(weekdayBase(), (d) => { d.items = ["new-2", "new-1", "math-2026-0002"]; })));
    expect(placed(issues)).toEqual(["REF_UNKNOWN items[1]"]);
    expect(issues[0]!.message).toBe("new-1 is named 2 times in story and items (story, items[1]); a new finding appears once. Keep one and remove the rest.");
    const thrice = unknown(refs(revise(weekdayBase(), (d) => { d.items = ["new-2", "new-2", "new-2", "math-2026-0002"]; })));
    expect(placed(thrice)).toEqual(["REF_UNKNOWN items[1]"]);
    expect(thrice[0]!.message).toContain("new-2 is named 3 times in story and items (items[0], items[1], items[2])");
  });

  it("fails two new findings that share a ref, once, and not for their use", () => {
    const issues = unknown(refs(revise(weekdayBase(), (d) => { d.new_findings[1].ref = "new-1"; d.lead[0].refs = ["new-1"]; d.items = ["math-2026-0002"]; })));
    expect(placed(issues)).toEqual(["REF_UNKNOWN new_findings[1].ref"]);
    expect(issues[0]!.message).toBe(
      "new_findings[1].ref is new-1, which an earlier new finding already has; give each new finding its own ref (new-1, new-2, ...).",
    );
  });

  it("reports a ref that two new findings share at the second one alone, whether or not story and items use it", () => {
    const idle = unknown(refs(revise(weekdayBase(), (d) => { d.new_findings[1].ref = "new-1"; d.lead[0].refs = ["new-1"]; d.story = "math-2026-0002"; d.items = []; })));
    expect(placed(idle)).toEqual(["REF_UNKNOWN new_findings[0].ref", "REF_UNKNOWN new_findings[1].ref"]);
    expect(idle[0]!.message).toContain("new_findings[0].ref (new-1) is in new_findings, but neither story nor items names it");
    expect(idle[1]!.message).toContain("which an earlier new finding already has");
    const twice = unknown(refs(revise(weekdayBase(), (d) => { d.new_findings[1].ref = "new-1"; d.lead[0].refs = ["new-1"]; d.items = ["new-1", "math-2026-0002"]; })));
    expect(placed(twice)).toEqual(["REF_UNKNOWN items[0]", "REF_UNKNOWN new_findings[1].ref"]);
  });

  it("fails an existing id that the context does not list in a returning entry, a rung change and a correction, and passes a correction with no finding", () => {
    const draft = revise(weekdayBase(), (d) => {
      d.items = ["new-2"];
      d.returning[0].finding_id = "math-2026-9001";
      d.rung_changes[0].finding_id = "phys-2026-9002";
      d.corrections[1].finding_id = "phys-2026-9003";
      d.corrections.push({ finding_id: null, edition_date: "2026-11-23", term_id: null, type: "correction", path: "lead.0.text", after: "A made-up lead.", reason: "r", source_url: null, report_id: null });
    });
    const issues = unknown(refs(draft));
    const unlisted = (path: string, id: string): string => `${path} is ${id}, which the context does not list (${CONTEXT_LISTS}). Name a finding id from the context; never invent an id.`;
    expect(placed(issues)).toEqual(["REF_UNKNOWN corrections[1].finding_id", "REF_UNKNOWN returning[0].finding_id", "REF_UNKNOWN rung_changes[0].finding_id"]);
    expect(issues.map((i) => i.message)).toEqual([
      unlisted("corrections[1].finding_id", "phys-2026-9003"), unlisted("returning[0].finding_id", "math-2026-9001"), unlisted("rung_changes[0].finding_id", "phys-2026-9002"),
    ]);
    expect(placed(unknown(refs(weekdayBase())))).toEqual([]);
  });

  it("leaves the deep dive and the remarkable finding to FORMAT_SECTIONS, so that one fault has one code", () => {
    const deep = run(sundayIn(revise(sundayBase(), (d) => { d.deep_dive.finding_id = "bio-2099-0001"; })));
    expect(codesOf(deep)).toEqual(["FORMAT_SECTIONS"]);
    const remarkable = run(mondayIn(revise(mondayBase(), (d) => { d.review.remarkable.finding_id = "bio-2099-0001"; })));
    expect(codesOf(remarkable)).toEqual(["FORMAT_SECTIONS"]);
  });

  it("fails a related finding that the context does not list, at the place it is written, and passes a listed one", () => {
    const issues = unknown(refs(revise(weekdayBase(), (d) => { d.new_findings[1].related = ["math-2026-0002", "soc-2026-9001"]; d.new_findings[0].related = ["soc-2026-9002"]; })));
    expect(placed(issues)).toEqual(["REF_UNKNOWN new_findings[0].related[0]", "REF_UNKNOWN new_findings[1].related[1]"]);
    expect(issues[1]!.message).toBe(
      `new_findings[1].related[1] is soc-2026-9001, which the context does not list (${CONTEXT_LISTS}). Name a finding id from the context; never invent an id.`,
    );
    // publish's XREF refuses a related id that has no file, so the draft is held to the context as it is for every other id it names
    expect(unknown(refs(revise(weekdayBase(), (d) => { d.new_findings[0].related = ["math-2026-0002", "phys-2026-0003", "chem-2026-0004", "bio-2026-0001", "hum-2026-0005"]; })))).toEqual([]);
    expect(unknown(refs(revise(weekdayBase(), (d) => { d.new_findings.forEach((f: Json) => { f.related = []; }); })))).toEqual([]);
  });

  it("fails a finding that the strongest evidence against names and the context does not list, and passes the week's setback and fall", () => {
    const issues = unknown(run(mondayIn(against({ finding_ids: ["chem-2026-0004", "phys-2026-0003", "bio-2099-0001"] }))));
    expect(placed(issues)).toEqual(["REF_UNKNOWN review.strongest_against.finding_ids[2]"]);
    expect(issues[0]!.message).toBe(
      `review.strongest_against.finding_ids[2] is bio-2099-0001, which the context does not list (${CONTEXT_LISTS}). Name a finding id from the context; never invent an id.`,
    );
    // a finding that only the week's setbacks or its rung changes name is listed, so naming it there is no stranger
    const onlyWeek = withContext(mondayContext(), (c) => {
      c.recent_findings = [];
      c.week.findings = [];
      c.week.setbacks = ["chem-2026-0004"];
      c.week.rung_changes = [{ finding_id: "hum-2019-0001", from: "preprint", to: "retracted", date: "2026-11-20", by: "agent" }];
    });
    const quiet = revise(mondayBase(), (d) => {
      d.items = []; d.new_findings = []; d.lead = [{ text: "A quiet week.", refs: [] }]; d.review.remarkable = null;
      d.review.strongest_against = { text: "A made-up counterpoint.", finding_ids: ["chem-2026-0004", "hum-2019-0001"], source_ids: [] };
    });
    expect(run(mondayIn(quiet, onlyWeek))).toEqual([]);
  });

  it("passes an id that only a pack candidate's stored_finding names, such as an older finding that a trial number matches", () => {
    const matched = withContext(weekdayContext(), (c) => { c.candidates = [{ ...clone(pack().candidates[0]!), stored_finding: "bio-2025-0007" }]; });
    const returning = revise(weekdayBase(), (d) => {
      d.returning[0].finding_id = "bio-2025-0007"; d.items = ["new-2", "bio-2025-0007"]; d.lead[1].refs = ["bio-2025-0007"];
    });
    expect(unknown(run(draftIn(returning, { context: matched })))).toEqual([]);
    // without the candidate no list names it
    expect(placed(unknown(run(draftIn(returning))))).toEqual(["REF_UNKNOWN items[1]", "REF_UNKNOWN lead[1].refs[0]", "REF_UNKNOWN returning[0].finding_id"]);
  });

  describe("the existing findings a draft shows and holds (SPEC §4.5: `returning` is findings with new facts in the story or items; `rung_changes` is findings they do not show)", () => {
    const X = "math-2026-0002";
    const OTHER = "phys-2026-0003";
    const entry = (finding: string, over: Json = {}): Json => ({ finding_id: finding, update: "A made-up update.", source_ids: ["b1"], rung: null, ...over });
    const RUNG: Json = { rung: "checked", date: "2026-11-23", source_id: "b1", note: "A made-up note." };
    const rungChangeOf = (finding: string): Json => ({ finding_id: finding, rung: RUNG });
    /** A draft that shows no existing finding and holds no returning entry and no rung change, whatever its edition. */
    const bare = (draft: DraftBrief): DraftBrief => revise(draft, (d) => { d.returning = []; d.rung_changes = []; d.items = d.items.filter((k: string) => k !== X); });
    const quietMonday = (): DraftBrief => revise(mondayBase(), (d) => {
      d.items = [];
      d.new_findings = [];
      d.lead = [{ text: "A quiet week.", refs: [] }];
      d.review.remarkable = null;
      d.review.strongest_against = { text: NONE_FOUND.en, finding_ids: [], source_ids: [] };
    });
    /** The four kinds of edition, each with the context it is judged against. */
    const KINDS = [
      { name: "weekday", draft: bare(weekdayBase()), context: weekdayContext() },
      { name: "Sunday", draft: bare(sundayBase()), context: sundayContext() },
      { name: "Monday", draft: bare(mondayBase()), context: mondayContext() },
      { name: "short Monday", draft: quietMonday(), context: weekWith(EMPTY_WEEK) },
    ];
    type Kind = (typeof KINDS)[number];
    const inKind = (k: Kind, change: (d: Json) => void): DraftInput => draftIn(revise(k.draft, change), { context: k.context });
    const judge = (k: Kind, change: (d: Json) => void): ValidationIssue[] => unknown(run(inKind(k, change)));
    /** The refs of the draft's new findings, so that the story and the items together name each of them once. */
    const newRefs = (d: Json): string[] => d.new_findings.map((f: Json) => f.ref);

    const noEntry = (where: string): string =>
      `${where} is ${X}, an existing finding with no entry in returning; a finding comes back only with new facts. Add a returning entry for ${X} (an update of at most 60 words, and the sources added this run that show the new facts), or take it out of story and items.`;
    const notShownAt = (at: number): string =>
      `returning[${at}].finding_id is ${X}, but neither story nor items names that finding; a returning entry is for a finding they show. Add ${X} to items, or make it the story, or delete the entry (a rung change on a finding the brief does not show goes in rung_changes).`;
    const notShown = notShownAt(0);
    const copyOf = (at: number, first: string, id = X): string =>
      `returning[${at}].finding_id is ${id}, which ${first} already names; a finding has one returning entry. Merge the two into one (an update of at most 60 words, and every source that shows the new facts) and delete this one.`;
    const wrongPlace = (at: number, where: string): string =>
      `rung_changes[${at}].finding_id is ${X}, a finding that ${where} shows; rung_changes is for findings that story and items do not show. Move the rung change into the rung of ${X}'s returning entry (add the entry if it has none) and delete this one.`;
    const twice = (times: number, where: string[]): string => `${X} is named ${times} times in story and items (${where.join(", ")}); a finding appears once. Keep one and remove the rest.`;

    it.each(KINDS)("starts from a $name draft that shows no existing finding and passes", (k) => {
      expect(judge(k, () => undefined)).toEqual([]);
      expect(shownItems(inKind(k, () => undefined).views).filter((i) => !isNewRef(i.key))).toEqual([]);
    });

    it.each(KINDS)("in a $name edition: fails an existing finding in the items with no returning entry, at its place, and passes it with one", (k) => {
      const n = k.draft.items.length;
      const missing = judge(k, (d) => { d.items = [...d.items, X]; });
      expect(placed(missing)).toEqual([`REF_UNKNOWN items[${n}]`]);
      expect(missing[0]!.message).toBe(noEntry(`items[${n}]`));
      expect(judge(k, (d) => { d.items = [...d.items, X]; d.returning = [entry(X)]; })).toEqual([]);
      // an entry for another finding is no entry for this one
      const other = judge(k, (d) => { d.items = [...d.items, X, OTHER]; d.returning = [entry(OTHER)]; });
      expect(placed(other)).toEqual([`REF_UNKNOWN items[${n}]`]);
      expect(other[0]!.message).toBe(noEntry(`items[${n}]`));
    });

    it.each(KINDS)("in a $name edition: holds the story to the same rules, and says `story` where it is", (k) => {
      const asStory = (d: Json): void => { d.items = newRefs(d); d.story = X; };
      const missing = judge(k, asStory);
      expect(placed(missing)).toEqual(["REF_UNKNOWN story"]);
      expect(missing[0]!.message).toBe(noEntry("story"));
      expect(judge(k, (d) => { asStory(d); d.returning = [entry(X)]; })).toEqual([]);
    });

    it.each(KINDS)("in a $name edition: fails a returning entry for an existing finding that neither story nor items show, and passes it for one they show", (k) => {
      const stranded = judge(k, (d) => { d.returning = [entry(X)]; });
      expect(placed(stranded)).toEqual(["REF_UNKNOWN returning[0].finding_id"]);
      expect(stranded[0]!.message).toBe(notShown);
      expect(judge(k, (d) => { d.returning = [entry(X)]; d.items = [...d.items, X]; })).toEqual([]);
      expect(judge(k, (d) => { d.returning = [entry(X)]; d.items = newRefs(d); d.story = X; })).toEqual([]);
      // the entry is at fault, not the finding: a second entry for another finding that is shown passes beside it
      const beside = judge(k, (d) => { d.returning = [entry(OTHER), entry(X)]; d.items = [...d.items, OTHER]; });
      expect(placed(beside)).toEqual(["REF_UNKNOWN returning[1].finding_id"]);
    });

    it.each(KINDS)("in a $name edition: fails a rung change for a finding that story or items show, at the rung change, and passes it in the entry's rung", (k) => {
      const n = k.draft.items.length;
      const shown = (d: Json): void => { d.items = [...d.items, X]; d.returning = [entry(X)]; };
      const wrong = judge(k, (d) => { shown(d); d.rung_changes = [rungChangeOf(X)]; });
      expect(placed(wrong)).toEqual(["REF_UNKNOWN rung_changes[0].finding_id"]);
      expect(wrong[0]!.message).toBe(wrongPlace(0, `items[${n}]`));
      // the entry's own rung is its place, and a finding that story and items do not show keeps rung_changes
      expect(judge(k, (d) => { shown(d); d.returning[0].rung = RUNG; })).toEqual([]);
      expect(judge(k, (d) => { d.rung_changes = [rungChangeOf(X)]; })).toEqual([]);
      // a rung in the entry does not excuse a rung change as well
      expect(placed(judge(k, (d) => { shown(d); d.returning[0].rung = RUNG; d.rung_changes = [rungChangeOf(X)]; }))).toEqual(["REF_UNKNOWN rung_changes[0].finding_id"]);
      // each rung change on a shown finding is an issue, and the rung change of a finding they do not show stays valid
      const several = judge(k, (d) => { shown(d); d.rung_changes = [rungChangeOf(OTHER), rungChangeOf(X), rungChangeOf(X)]; });
      expect(placed(several)).toEqual(["REF_UNKNOWN rung_changes[1].finding_id", "REF_UNKNOWN rung_changes[2].finding_id"]);
      // the story shows a finding too
      const story = judge(k, (d) => { d.items = newRefs(d); d.story = X; d.returning = [entry(X)]; d.rung_changes = [rungChangeOf(X)]; });
      expect(placed(story)).toEqual(["REF_UNKNOWN rung_changes[0].finding_id"]);
      expect(story[0]!.message).toBe(wrongPlace(0, "story"));
      // a finding shown twice is named by its first place, and the repeat is its own issue
      const m = k.draft.new_findings.length;
      const repeated = judge(k, (d) => { d.items = [...newRefs(d), X]; d.story = X; d.returning = [entry(X)]; d.rung_changes = [rungChangeOf(X)]; });
      expect(placed(repeated)).toEqual([`REF_UNKNOWN items[${m}]`, "REF_UNKNOWN rung_changes[0].finding_id"]);
      expect(repeated[1]!.message).toBe(wrongPlace(0, "story"));
    });

    it.each(KINDS)("in a $name edition: fails an existing finding named twice in story and items, at its second place, and passes it named once", (k) => {
      const n = k.draft.items.length;
      const m = k.draft.new_findings.length;
      const items = judge(k, (d) => { d.items = [...d.items, X, X]; d.returning = [entry(X)]; });
      expect(placed(items)).toEqual([`REF_UNKNOWN items[${n + 1}]`]);
      expect(items[0]!.message).toBe(twice(2, [`items[${n}]`, `items[${n + 1}]`]));
      const both = judge(k, (d) => { d.items = [...newRefs(d), X]; d.story = X; d.returning = [entry(X)]; });
      expect(placed(both)).toEqual([`REF_UNKNOWN items[${m}]`]);
      expect(both[0]!.message).toBe(twice(2, ["story", `items[${m}]`]));
      const thrice = judge(k, (d) => { d.items = [...newRefs(d), X, X]; d.story = X; d.returning = [entry(X)]; });
      expect(placed(thrice)).toEqual([`REF_UNKNOWN items[${m}]`]);
      expect(thrice[0]!.message).toBe(twice(3, ["story", `items[${m}]`, `items[${m + 1}]`]));
      // two different findings are not each other's copies
      expect(judge(k, (d) => { d.items = [...d.items, X, OTHER]; d.returning = [entry(X), entry(OTHER)]; })).toEqual([]);
      // a finding that is named twice and has no entry has both faults, each at its own place
      const bothFaults = judge(k, (d) => { d.items = [...d.items, X, X]; });
      expect(placed(bothFaults)).toEqual([`REF_UNKNOWN items[${n}]`, `REF_UNKNOWN items[${n + 1}]`]);
      expect(bothFaults.map((i) => i.message)).toEqual([noEntry(`items[${n}]`), twice(2, [`items[${n}]`, `items[${n + 1}]`])]);
    });

    it("fails a second returning entry for one finding, at that entry, and every later one, and passes entries for two findings", () => {
      const k = KINDS[0]!;
      const shown = (d: Json): void => { d.items = [...d.items, X, OTHER]; };
      const second = judge(k, (d) => { shown(d); d.returning = [entry(X), entry(X, { update: "A second update." }), entry(OTHER)]; });
      expect(placed(second)).toEqual(["REF_UNKNOWN returning[1].finding_id"]);
      expect(second[0]!.message).toBe(copyOf(1, "returning[0]"));
      const later = judge(k, (d) => { shown(d); d.returning = [entry(X), entry(OTHER), entry(X), entry(OTHER), entry(X)]; });
      expect(placed(later)).toEqual(["REF_UNKNOWN returning[2].finding_id", "REF_UNKNOWN returning[3].finding_id", "REF_UNKNOWN returning[4].finding_id"]);
      expect(later.map((i) => i.message)).toEqual([copyOf(2, "returning[0]"), copyOf(3, "returning[1]", OTHER), copyOf(4, "returning[0]")]);
      expect(judge(k, (d) => { shown(d); d.returning = [entry(X), entry(OTHER)]; })).toEqual([]);
    });

    it("gives a returning entry at most one issue: two entries for a finding that is not shown say so once, and call the second a copy", () => {
      const stray = judge(KINDS[0]!, (d) => { d.returning = [entry(X), entry(X)]; });
      expect(placed(stray)).toEqual(["REF_UNKNOWN returning[0].finding_id", "REF_UNKNOWN returning[1].finding_id"]);
      expect(stray.map((i) => i.message)).toEqual([notShown, copyOf(1, "returning[0]")]);
    });

    it("says an id that the context does not list once, whatever it is used for, and leaves its use unjudged", () => {
      const k = KINDS[0]!;
      const U = "math-2026-9001";
      const unlisted = (path: string): string => `${path} is ${U}, which the context does not list (${CONTEXT_LISTS}). Name a finding id from the context; never invent an id.`;
      const unreadable = (path: string): string =>
        `${path} is ${U}, which is neither a new-N ref of new_findings nor a finding id the context lists (${CONTEXT_LISTS}). Cite a listed id or a new-N ref; never invent an id.`;
      const everywhere = judge(k, (d) => { d.items = [...d.items, U, U]; d.returning = [entry(U), entry(U)]; d.rung_changes = [rungChangeOf(U)]; });
      expect(placed(everywhere)).toEqual([
        "REF_UNKNOWN items[1]", "REF_UNKNOWN items[2]", "REF_UNKNOWN returning[0].finding_id", "REF_UNKNOWN returning[1].finding_id", "REF_UNKNOWN rung_changes[0].finding_id",
      ]);
      expect(everywhere.map((i) => i.message)).toEqual([
        unreadable("items[1]"), unreadable("items[2]"), unlisted("returning[0].finding_id"), unlisted("returning[1].finding_id"), unlisted("rung_changes[0].finding_id"),
      ]);
      // shown with no entry: the unlisted id, and no complaint of a missing entry
      expect(judge(k, (d) => { d.items = [...d.items, U]; }).map((i) => i.message)).toEqual([unreadable("items[1]")]);
      // an entry for it that nothing shows: the unlisted id, and no complaint that it is not shown
      expect(judge(k, (d) => { d.returning = [entry(U)]; }).map((i) => i.message)).toEqual([unlisted("returning[0].finding_id")]);
      // an unlisted id ends nothing: the entry after it is judged as before
      expect(judge(k, (d) => { d.returning = [entry(U), entry(X)]; }).map((i) => i.message)).toEqual([unlisted("returning[0].finding_id"), notShownAt(1)]);
    });

    it("reads a returning entry for a new-N as an id the context does not list, once, and the whole validator refuses it at the schema first", () => {
      const k = KINDS[0]!;
      const raw = clone(k.draft) as Json;
      raw.returning = [entry("new-2")];
      const issues = unknown(run(draftIn(raw as unknown as DraftBrief, { context: k.context })));
      expect(placed(issues)).toEqual(["REF_UNKNOWN returning[0].finding_id"]);
      expect(issues[0]!.message).toBe(`returning[0].finding_id is new-2, which the context does not list (${CONTEXT_LISTS}). Name a finding id from the context; never invent an id.`);
      const whole = validateDraft(raw, { ...draftInputs(), context: k.context });
      expect([...new Set(whole.issues.map((i) => i.code))]).toEqual(["SCHEMA"]);
    });

    it("does not count the Lead, the deep dive or the remarkable finding as showing a finding", () => {
      const [weekday, sunday, monday] = [KINDS[0]!, KINDS[1]!, KINDS[2]!];
      const cited = (d: Json): void => { d.lead[0].refs = [...d.lead[0].refs, X]; };
      expect(placed(judge(weekday, (d) => { cited(d); d.returning = [entry(X)]; }))).toEqual(["REF_UNKNOWN returning[0].finding_id"]);
      expect(judge(weekday, (d) => { cited(d); d.rung_changes = [rungChangeOf(X)]; })).toEqual([]);
      const dive = sunday.draft.deep_dive!.finding_id;
      expect(placed(judge(sunday, (d) => { d.returning = [entry(dive)]; }))).toEqual(["REF_UNKNOWN returning[0].finding_id"]);
      expect(judge(sunday, (d) => { d.rung_changes = [rungChangeOf(dive)]; })).toEqual([]);
      const remarkable = monday.draft.review!.remarkable!.finding_id;
      expect(placed(judge(monday, (d) => { d.returning = [entry(remarkable)]; }))).toEqual(["REF_UNKNOWN returning[0].finding_id"]);
      expect(judge(monday, (d) => { d.rung_changes = [rungChangeOf(remarkable)]; })).toEqual([]);
    });

    it("leaves every existing finding that it passes with an update, so that compose never meets one without (a stored item ties `update` to `new`)", () => {
      for (const k of KINDS) {
        const shown = inKind(k, (d) => { d.items = [...d.items, X]; d.returning = [entry(X)]; });
        const existing = shownItems(shown.views).filter((i) => !isNewRef(i.key));
        expect(existing.map((i) => [i.key, i.update !== null]), k.name).toEqual([[X, true]]);
        expect(unknown(run(shown)), k.name).toEqual([]);
        const missing = inKind(k, (d) => { d.items = [...d.items, X]; });
        expect(shownItems(missing.views).filter((i) => !isNewRef(i.key)).map((i) => [i.key, i.update !== null]), k.name).toEqual([[X, false]]);
        expect(placed(unknown(run(missing))), k.name).not.toEqual([]);
      }
      for (const name of EDITION_NAMES) {
        const input = buildDraftInput(editionDraft(name), sampleInputs(name));
        for (const item of shownItems(input.views).filter((i) => !isNewRef(i.key))) expect(item.update, `${name} ${item.key}`).not.toBeNull();
      }
    });

    it("changes nothing it reads: a deep-frozen draft with every fault gives the issues of a fresh one", () => {
      for (const k of KINDS) {
        const input = inKind(k, (d) => {
          d.items = [...d.items, X, X, OTHER];
          d.returning = [entry("chem-2026-0004"), entry(X), entry(X)];
          d.rung_changes = [rungChangeOf(X)];
        });
        const fresh = unknown(run(input));
        expect(fresh, k.name).toHaveLength(5);
        expect(unknown(run(deepFreeze(input))), k.name).toEqual(fresh);
      }
    });

    it("is not held to a stored brief: the stored Tuesday shows a finding that its rung_changes name, as the script's change, and its items tie `update` to `new`", () => {
      const brief = storedBrief();
      expect(brief.items.some((i) => i.finding_id === OTHER && !i.new)).toBe(true);
      expect(brief.rung_changes.some((c) => c.finding_id === OTHER && c.by === "script")).toBe(true);
      for (const [label, publishing] of RECORD_SETS) expect(run(publishedIn(brief, { publishing: publishing(brief) })), label).toEqual([]);
      expect(() => revised(brief, (b) => { b.items[1].update = null; })).toThrow();
    });

    it("lists at most six places of a ref that a draft names again and again, then how many more, so that a message stays short (an existing finding and a new one)", () => {
      const k = KINDS[0]!;
      const n = k.draft.items.length;
      const at = (i: number): string => `items[${n + i}]`;
      const repeated = (times: number): ValidationIssue[] => judge(k, (d) => { d.items = [...d.items, ...Array.from({ length: times }, () => X)]; d.returning = [entry(X)]; });
      const first = (count: number): string[] => Array.from({ length: count }, (_, i) => at(i));
      expect(repeated(6)[0]!.message).toBe(twice(6, first(6)));
      expect(repeated(7)[0]!.message).toBe(twice(7, [...first(6), "and 1 more"]));
      const many = repeated(40);
      expect(placed(many)).toEqual([`REF_UNKNOWN ${at(1)}`]);
      expect(many[0]!.message).toBe(twice(40, [...first(6), "and 34 more"]));
      // a new finding that story and items name too often is told the same way
      const newTwice = (times: number): string =>
        judge(k, (d) => { d.items = Array.from({ length: times }, () => "new-2"); })[0]!.message;
      const spelled = (times: number, where: string): string => `new-2 is named ${times} times in story and items (${where}); a new finding appears once. Keep one and remove the rest.`;
      expect(newTwice(6)).toBe(spelled(6, "items[0], items[1], items[2], items[3], items[4], items[5]"));
      expect(newTwice(7)).toBe(spelled(7, "items[0], items[1], items[2], items[3], items[4], items[5], and 1 more"));
      expect(newTwice(300)).toBe(spelled(300, "items[0], items[1], items[2], items[3], items[4], items[5], and 294 more"));
      // the field cap's list of findings is cut the same way
      const capped = (times: number): string => run(inKind(k, (d) => { d.items = [...d.items, ...Array.from({ length: times }, () => X)]; d.returning = [entry(X)]; }))
        .find((i) => i.code === "FIELD_CAP")!.message;
      const field = (times: number, ids: string): string => `${times} findings in story and items are filed under mathematics (${ids}); the limit is 2 per field. Replace or cut at least ${times - 2}.`;
      expect(capped(6)).toBe(field(6, Array.from({ length: 6 }, () => X).join(", ")));
      expect(capped(7)).toBe(field(7, `${Array.from({ length: 6 }, () => X).join(", ")}, and 1 more`));
    });

    it("reads a ref named 50,000 times in time linear in the draft: every structure rule, in a fraction of a second, with one short message for each fault", () => {
      const k = KINDS[0]!;
      const n = k.draft.items.length;
      const timed = (change: (d: Json) => void): { issues: ValidationIssue[]; ms: number } => {
        const input = inKind(k, change);
        const t0 = performance.now();
        const issues = run(input);
        return { issues, ms: performance.now() - t0 };
      };
      const existing = timed((d) => { d.items = [...d.items, ...Array.from({ length: 50_000 }, () => X)]; d.returning = [entry(X)]; });
      expect(placed(existing.issues).sort()).toEqual([`COUNTS items`, `FIELD_CAP items[${n + 2}]`, `REF_UNKNOWN items[${n + 1}]`]);
      const fresh = timed((d) => { d.items = Array.from({ length: 50_000 }, () => "new-2"); });
      expect(placed(fresh.issues).sort()).toEqual(["COUNTS items", "FIELD_CAP items[2]", "REF_UNKNOWN items[1]"]);
      for (const { issues } of [existing, fresh]) for (const i of issues) expect(i.message.length, i.path).toBeLessThan(400);
      expect(existing.issues.find((i) => i.code === "REF_UNKNOWN")!.message)
        .toBe(twice(50_000, [...Array.from({ length: 6 }, (_, i) => `items[${n + i}]`), "and 49994 more"]));
      // The quadratic reading (a copy of the list for each repeat) took 13 to 52 seconds for each of these; the linear one takes about a
      // tenth of a second, so 2 seconds tells the two apart and leaves a loaded machine its room.
      expect(existing.ms).toBeLessThan(2000);
      expect(fresh.ms).toBeLessThan(2000);
    });

    it("gives every fault of a draft with 150,000 of them its own issue, and no RULE_ERROR: the issues are not passed as arguments of a spread", () => {
      // `run()` throws on a RULE_ERROR. A rule that pushed its issues with `out.push(...issues)` overflows the stack from about 120,000
      // arguments, and then reports "a fault in the validator" in place of every issue the draft earned.
      const k = KINDS[0]!;
      const copies = 150_000;
      const issues = unknown(run(inKind(k, (d) => { d.items = [...d.items, X]; d.returning = Array.from({ length: copies }, () => entry(X)); })));
      expect(issues).toHaveLength(copies - 1);
      expect(new Set(issues.map((i) => i.path)).size).toBe(copies - 1);
      expect(issues.every((i) => i.message.includes("already names; a finding has one returning entry") && i.message.length < 400)).toBe(true);
    }, 120_000);
  });

  it("is not run in published mode, where the stored brief's ids are XREF's", () => {
    expect(ruleOf("REF_UNKNOWN").scope).toEqual(["draft"]);
    const brief = revised(storedBrief(), (b) => { b.story.finding_id = "bio-2099-0001"; b.lead[0].finding_ids = ["soc-2099-0001"]; });
    for (const [label, publishing] of RECORD_SETS) {
      const input = publishedIn(brief, { publishing: publishing(brief) });
      expect(run(input), label).toEqual([]);
      expect(ruleOf("REF_UNKNOWN").check(input), label).toEqual([]);
    }
  });
});

// ── FORMAT_SECTIONS ──────────────────────────────────────────────────────────────────────────────

describe("FORMAT_SECTIONS: `deep_dive` only on Sundays, `review` exactly on Mondays; the weekday story; at most 2 findings on a Monday or a Sunday", () => {
  const sections = (input: RuleInput) => only(run(input), "FORMAT_SECTIONS");
  const review = (): Json => ({
    big_picture: "A made-up big picture.", remarkable: null, strongest_against: { text: NONE_FOUND.en, finding_ids: [], source_ids: [] },
  });
  const diveOn = (finding: string, why = "news"): Json => ({ finding_id: finding, text: "A made-up deep dive.", source_ids: ["b1"], why_today: why });

  describe("in a draft", () => {
    it("fails a deep dive on a weekday and on a Monday, at deep_dive, and passes it on a Sunday", () => {
      const weekdayDive = sections(draftIn(revise(weekdayBase(), (d) => { d.deep_dive = diveOn("bio-2024-0007"); })));
      expect(placed(weekdayDive)).toEqual(["FORMAT_SECTIONS deep_dive"]);
      expect(weekdayDive[0]!.message).toBe("deep_dive is set, but this is a weekday edition; only a Sunday edition has a deep dive. Set deep_dive to null.");
      const mondayDive = sections(mondayIn(revise(mondayBase(), (d) => { d.deep_dive = diveOn("bio-2024-0007"); d.sources = [weekdayDraft().sources[0]]; })));
      expect(placed(mondayDive)).toEqual(["FORMAT_SECTIONS deep_dive"]);
      expect(mondayDive[0]!.message).toContain("this is a Monday edition");
      expect(sections(sundayIn())).toEqual([]);
    });

    it("fails a review on a weekday and on a Sunday, at review, and passes one on a Monday", () => {
      const weekdayReview = sections(draftIn(revise(weekdayBase(), (d) => { d.review = review(); })));
      expect(placed(weekdayReview)).toEqual(["FORMAT_SECTIONS review"]);
      expect(weekdayReview[0]!.message).toBe("review is set, but this is a weekday edition; only a Monday edition has a review. Set review to null.");
      const sundayReview = sections(sundayIn(revise(sundayBase(), (d) => { d.review = review(); })));
      expect(placed(sundayReview)).toEqual(["FORMAT_SECTIONS review"]);
      expect(sundayReview[0]!.message).toContain("this is a Sunday edition");
      expect(sections(mondayIn())).toEqual([]);
    });

    it("fails a Monday with no review, full week or short, at review", () => {
      for (const n of [3, 1, 0]) {
        const context = weekWith(n === 0 ? EMPTY_WEEK : {}, n);
        const issues = sections(mondayIn(revise(mondayBase(), (d) => { d.review = null; }), context));
        expect(placed(issues), `a week of ${n}`).toEqual(["FORMAT_SECTIONS review"]);
        expect(issues[0]!.message, `a week of ${n}`).toBe("review is null, but this is a Monday edition; a Monday edition has the week in review. Write the review.");
      }
    });

    it("fails a weekday whose story is null while items name findings, and passes a quiet day and a day with a story", () => {
      const noStory = sections(draftIn(revise(weekdayBase(), (d) => { d.story = null; d.items = ["new-1", "new-2", "math-2026-0002"]; })));
      expect(placed(noStory)).toEqual(["FORMAT_SECTIONS story"]);
      expect(noStory[0]!.message).toBe(
        "story is null, but items names 3 findings; a weekday edition has a story whenever it has a finding. Make the strongest finding the story.",
      );
      const one = sections(draftIn(revise(weekdayBase(), (d) => { d.story = null; d.items = ["math-2026-0002"]; d.new_findings = []; d.returning = []; d.lead = [{ text: "t", refs: ["math-2026-0002"] }]; })));
      expect(one[0]!.message).toContain("items names 1 finding;");
      const quietDay = revise(weekdayBase(), (d) => { d.story = null; d.items = []; d.new_findings = []; d.returning = []; d.lead = [{ text: "A quiet day.", refs: [] }]; });
      expect(sections(draftIn(quietDay))).toEqual([]);
      expect(sections(draftIn(weekdayBase()))).toEqual([]);
    });

    it("does not need a Monday or a Sunday story to be set", () => {
      expect(revise(mondayBase(), () => undefined).story).toBeNull();
      expect(sections(mondayIn())).toEqual([]);
      expect(sections(sundayIn())).toEqual([]);
    });

    it("fails a Monday or a Sunday with more than 2 findings, story included, and passes 2 and fewer", () => {
      const sunday = sections(sundayIn(revise(sundayBase(), (d) => { d.items = ["new-1", "math-2026-0002", "phys-2026-0003"]; })));
      expect(placed(sunday)).toEqual(["FORMAT_SECTIONS items"]);
      expect(sunday[0]!.message).toBe("a Sunday edition shows at most 2 findings besides the deep dive, story included; this one shows 3. Cut at least 1.");
      const monday = sections(mondayIn(revise(mondayBase(), (d) => { d.items = ["new-1", "math-2026-0002", "phys-2026-0003", "chem-2026-0004"]; })));
      expect(placed(monday)).toEqual(["FORMAT_SECTIONS items"]);
      expect(monday[0]!.message).toBe("a Monday edition shows at most 2 findings besides the review, story included; this one shows 4. Cut at least 2.");
      const withStory = sections(mondayIn(revise(mondayBase(), (d) => { d.story = "new-1"; d.items = ["math-2026-0002", "phys-2026-0003"]; })));
      expect(placed(withStory)).toEqual(["FORMAT_SECTIONS items"]);
      expect(withStory[0]!.message).toContain("this one shows 3. Cut at least 1.");
      expect(sections(mondayIn(revise(mondayBase(), (d) => { d.items = ["new-1", "math-2026-0002"]; })))).toEqual([]);
      expect(sections(mondayIn(revise(mondayBase(), (d) => { d.story = "new-1"; d.items = ["math-2026-0002"]; })))).toEqual([]);
      expect(sections(sundayIn(revise(sundayBase(), (d) => { d.items = ["new-1", "math-2026-0002"]; })))).toEqual([]);
    });

    it("fails a Monday or a Sunday story below Major as filed, and passes Major, Landmark and a null story", () => {
      const storyOf = (base: DraftBrief, significance: string) => revise(base, (d) => { d.story = "new-1"; d.items = []; d.new_findings[0].significance = significance; });
      for (const significance of ["watch", "notable"]) {
        const monday = sections(mondayIn(storyOf(mondayBase(), significance)));
        expect(placed(monday), significance).toEqual(["FORMAT_SECTIONS story"]);
        expect(monday[0]!.message, significance).toBe(
          `story is new-1, filed as ${significance}; on a Monday edition a story is set only for a Major or Landmark finding. Move it to items, or set story to null.`,
        );
        expect(placed(sections(sundayIn(storyOf(sundayBase(), significance)))), significance).toEqual(["FORMAT_SECTIONS story"]);
      }
      for (const significance of ["major", "landmark"]) {
        expect(sections(mondayIn(storyOf(mondayBase(), significance))), significance).toEqual([]);
        expect(sections(sundayIn(storyOf(sundayBase(), significance))), significance).toEqual([]);
      }
      expect(sections(draftIn(revise(weekdayBase(), (d) => { d.new_findings[0].significance = "watch"; })))).toEqual([]);
    });

    it("reads the story as filed with the draft's own corrections, whether the finding is new or the context's", () => {
      // The Monday context files phys-2026-0003 as Notable (the week's entry) and math-2026-0002 as Notable (its report).
      const issues = (id: string, corrections: Json[] = []) => placed(sections(mondayIn(revise(mondayBase(), (d) => {
        d.story = id; d.items = []; d.new_findings = []; d.lead = [{ text: "t", refs: [id] }]; d.corrections = corrections;
      }))));
      for (const id of ["phys-2026-0003", "math-2026-0002"]) {
        expect(issues(id), id).toEqual(["FORMAT_SECTIONS story"]);
        expect(issues(id, [correction(id, "significance", "watch")]), id).toEqual(["FORMAT_SECTIONS story"]);
        expect(issues(id, [correction(id, "significance", "major")]), id).toEqual([]);
        expect(issues(id, [correction(id, "significance", "landmark")]), id).toEqual([]);
        // the later of two corrections counts
        expect(issues(id, [correction(id, "significance", "major"), correction(id, "significance", "watch")]), id).toEqual(["FORMAT_SECTIONS story"]);
        expect(issues(id, [correction(id, "significance", "watch"), correction(id, "significance", "major")]), id).toEqual([]);
      }
      // a correction of another finding, or of another path, changes nothing about the story
      expect(issues("phys-2026-0003", [correction("math-2026-0002", "significance", "major")])).toEqual(["FORMAT_SECTIONS story"]);
      expect(issues("phys-2026-0003", [correction("phys-2026-0003", "field", "chemistry")])).toEqual(["FORMAT_SECTIONS story"]);
    });

    it("leaves a story whose finding the context does not know to REF_UNKNOWN", () => {
      const stranger = revise(mondayBase(), (d) => { d.story = "soc-2026-9001"; d.items = []; d.new_findings = []; d.lead = [{ text: "t", refs: [] }]; });
      expect(placed(run(mondayIn(stranger)))).toEqual(["REF_UNKNOWN story"]);
    });

    describe("on a Sunday, against the context's candidates", () => {
      const sunday = (change: (d: Json) => void, context = sundayContext()) => sections(sundayIn(revise(sundayBase(), change), context));
      const noCandidates = () => withContext(sundayContext(), (c) => { c.ledger_for_sunday = []; });

      it("fails a null deep dive when the ledger has candidates, and says which", () => {
        const issues = sunday((d) => { d.deep_dive = null; });
        expect(placed(issues)).toEqual(["FORMAT_SECTIONS deep_dive"]);
        expect(issues[0]!.message).toBe(
          "deep_dive is null, but ledger_for_sunday lists 2 candidates (bio-2024-0007, math-2025-0009). A Sunday edition has a deep dive: set it on one candidate, with a why_today among its reasons.",
        );
        const one = withContext(sundayContext(), (c) => { c.ledger_for_sunday = [c.ledger_for_sunday[0]]; });
        expect(sunday((d) => { d.deep_dive = null; }, one)[0]!.message).toContain("lists 1 candidate (bio-2024-0007)");
      });

      it("passes a null deep dive when the ledger is empty, and fails a deep dive then", () => {
        expect(sunday((d) => { d.deep_dive = null; }, noCandidates())).toEqual([]);
        const issues = sunday(() => undefined, noCandidates());
        expect(placed(issues)).toEqual(["FORMAT_SECTIONS deep_dive.finding_id"]);
        expect(issues[0]!.message).toBe("deep_dive is on bio-2024-0007, but ledger_for_sunday lists no candidate today. Set deep_dive to null.");
      });

      it("fails a deep dive on a finding that is not a candidate, at its finding_id, and passes each candidate", () => {
        for (const id of ["math-2026-0002", "bio-2099-0001"]) {
          const issues = sunday((d) => { d.deep_dive.finding_id = id; });
          expect(placed(issues), id).toEqual(["FORMAT_SECTIONS deep_dive.finding_id"]);
          expect(issues[0]!.message, id).toBe(
            `deep_dive is on ${id}, which is not one of the 2 candidates of ledger_for_sunday (bio-2024-0007, math-2025-0009). Set it on one of them.`,
          );
        }
        expect(sunday((d) => { d.deep_dive.finding_id = "math-2025-0009"; d.deep_dive.why_today = "rotation"; })).toEqual([]);
        expect(sunday(() => undefined)).toEqual([]);
      });

      it("fails a why_today that its candidate's reasons lack, at why_today, and passes each of its reasons", () => {
        const lacks = sunday((d) => { d.deep_dive.why_today = "news"; });
        expect(placed(lacks)).toEqual(["FORMAT_SECTIONS deep_dive.why_today"]);
        expect(lacks[0]!.message).toBe(
          'deep_dive.why_today is "news", but the reasons for bio-2024-0007 are anniversary, rotation. Use one of them.',
        );
        for (const why of ["anniversary", "rotation"]) expect(sunday((d) => { d.deep_dive.why_today = why; }), why).toEqual([]);
        // the reason belongs to the candidate the deep dive is on, not to another candidate
        expect(placed(sunday((d) => { d.deep_dive.finding_id = "math-2025-0009"; d.deep_dive.why_today = "anniversary"; }))).toEqual(["FORMAT_SECTIONS deep_dive.why_today"]);
      });
    });

    describe("on a Monday, against the context's week", () => {
      const monday = (change: (d: Json) => void, context = mondayContext()) => sections(mondayIn(revise(mondayBase(), change), context));

      it("fails a null remarkable finding when the week has findings, and says which", () => {
        for (const n of [3, 1]) {
          const issues = monday((d) => { d.review.remarkable = null; }, mondayContext(n));
          expect(placed(issues), `a week of ${n}`).toEqual(["FORMAT_SECTIONS review.remarkable"]);
          expect(issues[0]!.message, `a week of ${n}`).toContain(`review.remarkable is null, but the week has ${n === 1 ? "1 finding" : "3 findings"} (`);
        }
        expect(monday((d) => { d.review.remarkable = null; })[0]!.message).toBe(
          "review.remarkable is null, but the week has 3 findings (math-2026-0002, phys-2026-0003, chem-2026-0004). Name the week's most remarkable finding, one of them.",
        );
      });

      it("fails a remarkable finding that the week does not have, at its finding_id, and passes each finding of the week", () => {
        const issues = monday((d) => { d.review.remarkable.finding_id = "bio-2026-0001"; });
        expect(placed(issues)).toEqual(["FORMAT_SECTIONS review.remarkable.finding_id"]);
        expect(issues[0]!.message).toBe(
          "review.remarkable names bio-2026-0001, which is not a finding of the week (math-2026-0002, phys-2026-0003, chem-2026-0004). Name one of them.",
        );
        for (const id of ["math-2026-0002", "phys-2026-0003", "chem-2026-0004"]) expect(monday((d) => { d.review.remarkable.finding_id = id; }), id).toEqual([]);
      });

      it("passes a null remarkable finding when the week has none, and fails a set one", () => {
        const empty = weekWith(EMPTY_WEEK, 0);
        const quietDraft = (change: (d: Json) => void = () => undefined) => revise(mondayBase(), (d) => {
          d.items = []; d.new_findings = []; d.lead = [{ text: "A quiet week.", refs: [] }];
          d.review.remarkable = null; d.review.strongest_against = { text: NONE_FOUND.en, finding_ids: [], source_ids: [] };
          change(d);
        });
        expect(sections(mondayIn(quietDraft(), empty))).toEqual([]);
        const set = sections(mondayIn(quietDraft((d) => { d.review.remarkable = { finding_id: "math-2026-0002", note: "A made-up note." }; }), empty));
        expect(placed(set)).toEqual(["FORMAT_SECTIONS review.remarkable"]);
        expect(set[0]!.message).toBe("review.remarkable names math-2026-0002, but the week has no finding to name. Set remarkable to null.");
      });

      it("tests nothing against a context that has no week, which the schema never gives a Monday", () => {
        const noWeek: AgentContext = { ...mondayContext(), week: null };
        expect(sections(mondayIn(revise(mondayBase(), (d) => { d.review.remarkable = null; }), noWeek))).toEqual([]);
        expect(sections(mondayIn(mondayBase(), noWeek))).toEqual([]);
      });
    });
  });

  describe("in published mode", () => {
    for (const [label, publishing] of RECORD_SETS) {
      describe(`on ${label}`, () => {
        const check = (brief: Brief) => sections(publishedIn(brief, { publishing: publishing(brief) }));

        it("fails a deep dive off Sunday and a review off Monday, and a Monday with no review", () => {
          const dive = revised(storedBrief(), (b) => { b.deep_dive = { finding_id: "bio-2026-0001", text: l("A made-up deep dive."), source_ids: [], why_today: "news" }; });
          const issues = check(dive);
          expect(placed(issues)).toEqual([`FORMAT_SECTIONS briefs/${D}.json: deep_dive`]);
          expect(issues[0]!.message).toContain("this is a weekday edition");
          expect(placed(check(revised(storedMonday(), (b) => { b.deep_dive = clone(storedSunday().deep_dive); b.sources = clone(storedSunday().sources); })))).toEqual([`FORMAT_SECTIONS briefs/${MONDAY}.json: deep_dive`]);
          expect(placed(check(revised(storedBrief(), (b) => { b.review = clone(storedMonday().review); })))).toEqual([`FORMAT_SECTIONS briefs/${D}.json: review`]);
          expect(placed(check(revised(storedSunday(), (b) => { b.review = clone(storedMonday().review); })))).toEqual([`FORMAT_SECTIONS briefs/${SUNDAY}.json: review`]);
          const none = check(revised(storedMonday(), (b) => { b.review = null; }));
          expect(placed(none)).toEqual([`FORMAT_SECTIONS briefs/${MONDAY}.json: review`]);
          expect(none[0]!.message).toContain("this is a Monday edition");
        });

        it("fails a weekday story that is null with items, at story, and passes a quiet day", () => {
          const issues = check(revised(storedBrief(), (b) => { b.story = null; }));
          expect(placed(issues)).toEqual([`FORMAT_SECTIONS briefs/${D}.json: story`]);
          expect(issues[0]!.message).toContain("items names 2 findings");
          expect(check(storedOn(D, quiet))).toEqual([]);
        });

        it("fails a Monday or a Sunday with more than 2 findings, and a story below Major", () => {
          const items = ["math-2026-0002", "phys-2026-0003", "bio-2026-0001"].map((finding_id) => ({ finding_id, new: true, update: null }));
          expect(placed(check(revised(storedMonday(), (b) => { b.items = items; })))).toEqual([`FORMAT_SECTIONS briefs/${MONDAY}.json: items`]);
          expect(placed(check(revised(storedSunday(), (b) => { b.items = items; })))).toEqual([`FORMAT_SECTIONS briefs/${SUNDAY}.json: items`]);
          expect(check(revised(storedMonday(), (b) => { b.items = items.slice(0, 2); }))).toEqual([]);
          // the stored math finding is Major as filed on Monday, and Notable once a correction dated on or before it says so
          const monday = (change: (b: Json) => void) => revised(storedMonday(), (b) => { b.story = { finding_id: "math-2026-0002", new: true, update: null }; b.items = []; change(b); });
          expect(check(monday(() => undefined))).toEqual([]);
          const lowered = worldWith([], [filing("C-0003", MONDAY, "math-2026-0002", "significance", "notable")]);
          const issues = sections(publishedIn(monday(() => undefined), { publishing: publishing(monday(() => undefined)), world: lowered }));
          expect(placed(issues)).toEqual([`FORMAT_SECTIONS briefs/${MONDAY}.json: story`]);
          expect(issues[0]!.message).toBe(
            "story is math-2026-0002, filed as notable; on a Monday edition a story is set only for a Major or Landmark finding. Move it to items, or set story to null.",
          );
          const later = worldWith([], [filing("C-0003", "2026-11-24", "math-2026-0002", "significance", "notable")]);
          expect(sections(publishedIn(monday(() => undefined), { publishing: publishing(monday(() => undefined)), world: later }))).toEqual([]);
          // a Sunday's story is held to the same bar, as filed on the Sunday
          const sunday = revised(storedSunday(), (b) => { b.story = { finding_id: "math-2026-0002", new: true, update: null }; b.items = []; });
          expect(check(sunday)).toEqual([]);
          const sundayLowered = worldWith([], [filing("C-0003", SUNDAY, "math-2026-0002", "significance", "watch")]);
          const watched = sections(publishedIn(sunday, { publishing: publishing(sunday), world: sundayLowered }));
          expect(placed(watched)).toEqual([`FORMAT_SECTIONS briefs/${SUNDAY}.json: story`]);
          expect(watched[0]!.message).toContain("filed as watch; on a Sunday edition a story is set only for a Major or Landmark finding");
        });

        it("tests nothing against a context: a null deep dive and a null remarkable finding pass, whatever the week was", () => {
          expect(check(revised(storedSunday(), (b) => { b.deep_dive = null; }))).toEqual([]);
          expect(check(revised(storedSunday(), (b) => { b.deep_dive.finding_id = "math-2026-0002"; }))).toEqual([]);
          expect(check(storedMonday({ remarkable: null }))).toEqual([]);
          expect(check(storedMonday({ remarkable: { finding_id: "bio-2099-0001", note: l("A made-up note.") } }))).toEqual([]);
        });

        it("skips a data-only edition, which has none of these sections, on any day, and leaves a record that carries some to the schema", () => {
          for (const date of [SUNDAY, MONDAY, D]) expect(check(storedDataOnly(date)), date).toEqual([]);
          // The Brief schema refuses a data-only edition with a section, so these are built by hand: SCHEMA reports them, and this
          // rule neither reports them again nor judges them as the Sunday or the Monday that the date makes them.
          const carrying = (brief: Brief): Brief => ({ ...brief, edition: "data_only" });
          expect(check(carrying(storedSunday()))).toEqual([]);
          expect(check(carrying(storedMonday()))).toEqual([]);
          expect(check(carrying(revised(storedBrief(), (b) => { b.review = clone(storedMonday().review); })))).toEqual([]);
          expect(check(carrying(revised(storedBrief(), (b) => { b.deep_dive = clone(storedSunday().deep_dive); b.sources = clone(storedSunday().sources); })))).toEqual([]);
        });
      });
    }

    it("has no sections to judge for records that no brief names", () => {
      expect(sections(publishedIn(null))).toEqual([]);
    });
  });
});

// ── WEEK_AGAINST ─────────────────────────────────────────────────────────────────────────────────

describe("WEEK_AGAINST: `NONE_FOUND` only when the week has no setback and no finding that fell; otherwise `finding_ids` include every one", () => {
  const verdict = (input: RuleInput) => only(run(input), "WEEK_AGAINST");
  const SETBACK = "chem-2026-0004";
  const FALL = "phys-2026-0003";
  const TEXT = "A made-up counterpoint.";
  const fix = (id: string, why: string) => `${id} (${why})`;

  describe("in a draft", () => {
    /** The week the tests start from: a setback (chem-2026-0004), a finding that fell to Disputed (phys-2026-0003) and a plain result. */
    const WEEK = () => weekOf([["math-2026-0002", "result"], [FALL, "result"], [SETBACK, "setback"]], [rungChange(FALL, "disputed")]);
    const check = (strongest: Json, context = WEEK(), mutate: (d: Json) => void = () => undefined) =>
      verdict(mondayIn(revise(against(strongest), mutate), context));
    const NONE = { text: NONE_FOUND.en };
    const NEITHER = () => weekOf([["math-2026-0002", "result"]]);

    it("passes evidence that names the setback and the fall, and extra findings besides", () => {
      expect(check({ text: TEXT, finding_ids: [SETBACK, FALL] })).toEqual([]);
      expect(check({ text: TEXT, finding_ids: [FALL, "math-2026-0002", SETBACK] })).toEqual([]);
    });

    it("fails NONE_FOUND in a week with a setback and a fall, at the text, and names both", () => {
      const issues = check(NONE);
      expect(placed(issues)).toEqual(["WEEK_AGAINST review.strongest_against.text"]);
      expect(issues[0]!.message).toBe(
        'strongest_against.text is "None found this week.", but the week has 2 setbacks or falls: chem-2026-0004 (a setback), phys-2026-0003 (fell to disputed). Write the evidence against and list them in finding_ids.',
      );
    });

    it("fails NONE_FOUND in a week with only a setback, and in a week with only a fall", () => {
      const issues = check(NONE, weekOf([[SETBACK, "setback"]]));
      expect(placed(issues)).toEqual(["WEEK_AGAINST review.strongest_against.text"]);
      expect(issues[0]!.message).toBe(
        `strongest_against.text is "None found this week.", but the week has 1 setback or fall: ${fix(SETBACK, "a setback")}. Write the evidence against and list it in finding_ids.`,
      );
      const fallOnly = check(NONE, weekOf([[FALL, "result"]], [rungChange(FALL, "disputed")]));
      expect(placed(fallOnly)).toEqual(["WEEK_AGAINST review.strongest_against.text"]);
      expect(fallOnly[0]!.message).toContain(`1 setback or fall: ${fix(FALL, "fell to disputed")}.`);
    });

    it("passes NONE_FOUND with both lists empty in a week with neither, and passes evidence with no ids then", () => {
      expect(check(NONE, NEITHER())).toEqual([]);
      expect(check({ text: TEXT }, NEITHER())).toEqual([]);
      expect(check(NONE, weekWith(EMPTY_WEEK, 0))).toEqual([]);
    });

    it("fails NONE_FOUND with a finding id or a source id in it even when the week has neither, at strongest_against", () => {
      const ids = check({ ...NONE, finding_ids: ["math-2026-0002"] }, NEITHER());
      expect(placed(ids)).toEqual(["WEEK_AGAINST review.strongest_against"]);
      expect(ids[0]!.message).toBe(
        'strongest_against.text is "None found this week.", so finding_ids and source_ids are both []; they hold 1 id. Empty them, or write the evidence against.',
      );
      const withSource = revise(mondayBase(), (d) => {
        d.sources = [weekdayDraft().sources[0]];
        d.review.strongest_against = { text: NONE_FOUND.en, finding_ids: [], source_ids: ["b1"] };
      });
      const sources = verdict(mondayIn(withSource, NEITHER()));
      expect(placed(sources)).toEqual(["WEEK_AGAINST review.strongest_against"]);
      expect(sources[0]!.message).toContain("they hold 1 id.");
      const both = verdict(mondayIn(revise(withSource, (d) => { d.review.strongest_against.finding_ids = ["math-2026-0002", "phys-2026-0003"]; }), NEITHER()));
      expect(both[0]!.message).toContain("they hold 3 ids.");
    });

    it("fails evidence that leaves the setback out, the fall out, or both, at finding_ids, and names what is missing", () => {
      const noSetback = check({ text: TEXT, finding_ids: [FALL] });
      expect(placed(noSetback)).toEqual(["WEEK_AGAINST review.strongest_against.finding_ids"]);
      expect(noSetback[0]!.message).toBe(
        "strongest_against.finding_ids leaves out 1 finding of the week: chem-2026-0004 (a setback). Add its id.",
      );
      const noFall = check({ text: TEXT, finding_ids: [SETBACK] });
      expect(placed(noFall)).toEqual(["WEEK_AGAINST review.strongest_against.finding_ids"]);
      expect(noFall[0]!.message).toBe("strongest_against.finding_ids leaves out 1 finding of the week: phys-2026-0003 (fell to disputed). Add its id.");
      const neither = check({ text: TEXT });
      expect(placed(neither)).toEqual(["WEEK_AGAINST review.strongest_against.finding_ids"]);
      expect(neither[0]!.message).toBe(
        "strongest_against.finding_ids leaves out 2 findings of the week: chem-2026-0004 (a setback), phys-2026-0003 (fell to disputed). Add their ids.",
      );
    });

    it("reads a fall from a rung change to disputed or retracted, and never from another rung", () => {
      const falls = (to: string) => weekOf([[FALL, "result"]], [rungChange(FALL, to)]);
      for (const to of ["disputed", "retracted"]) {
        expect(check({ text: TEXT }, falls(to))[0]!.message, to).toContain(`${FALL} (fell to ${to})`);
        expect(check({ text: TEXT, finding_ids: [FALL] }, falls(to)), to).toEqual([]);
      }
      for (const to of ["claimed", "preprint", "checked", "confirmed", "applied"]) {
        expect(check(NONE, falls(to)), to).toEqual([]);
        expect(check({ text: TEXT }, falls(to)), to).toEqual([]);
      }
    });

    it("counts a finding that fell twice, or fell and is a setback, once", () => {
      const twice = weekOf([[FALL, "result"]], [rungChange(FALL, "disputed"), rungChange(FALL, "retracted")]);
      expect(check({ text: TEXT }, twice)[0]!.message).toBe(
        "strongest_against.finding_ids leaves out 1 finding of the week: phys-2026-0003 (fell to disputed, fell to retracted). Add its id.",
      );
      const both = weekOf([[FALL, "setback"]], [rungChange(FALL, "retracted")]);
      expect(check({ text: TEXT }, both)[0]!.message).toBe(
        "strongest_against.finding_ids leaves out 1 finding of the week: phys-2026-0003 (a setback, fell to retracted). Add its id.",
      );
      const repeated = weekWith({ findings: [weekFinding(SETBACK, "setback")], setbacks: [SETBACK, SETBACK], rung_changes: [] });
      expect(check({ text: TEXT }, repeated)[0]!.message).toBe(
        "strongest_against.finding_ids leaves out 1 finding of the week: chem-2026-0004 (a setback). Add its id.",
      );
    });

    it("reads the week of a short Monday and of an empty one the same way", () => {
      const short = weekOf([[SETBACK, "setback"], [FALL, "result"]], [rungChange(FALL, "disputed")]);
      expect(mondayIn(mondayBase(), short).edition).toBe("short-monday");
      expect(check({ text: TEXT, finding_ids: [SETBACK, FALL] }, short)).toEqual([]);
      expect(placed(check(NONE, short))).toEqual(["WEEK_AGAINST review.strongest_against.text"]);
      expect(placed(check({ text: TEXT }, short))).toEqual(["WEEK_AGAINST review.strongest_against.finding_ids"]);
      expect(mondayIn(mondayBase(), weekWith(EMPTY_WEEK, 0)).edition).toBe("short-monday");
      const quietFall = weekWith({ ...EMPTY_WEEK, rung_changes: [rungChange("math-2020-0001", "retracted")] }, 0);
      expect(check(NONE, quietFall)[0]!.message).toContain("math-2020-0001 (fell to retracted)");
      expect(check({ text: TEXT, finding_ids: ["math-2020-0001"] }, quietFall)).toEqual([]);
    });

    it("trusts the context's list of setbacks for a finding that its findings do not show as one, and for one the draft knows nothing of", () => {
      const listed = weekWith({ findings: [weekFinding(FALL)], setbacks: [SETBACK], rung_changes: [] });
      expect(check({ text: TEXT }, listed)[0]!.message).toContain(fix(SETBACK, "a setback"));
      const stranger = weekWith({ findings: [], setbacks: ["hum-2026-0005"], rung_changes: [] });
      expect(check({ text: TEXT }, stranger)[0]!.message).toContain("hum-2026-0005 (a setback)");
      const shown = weekWith({ findings: [weekFinding(SETBACK, "setback")], setbacks: [], rung_changes: [] });
      expect(check({ text: TEXT }, shown)[0]!.message).toContain(fix(SETBACK, "a setback"));
    });

    it("takes NONE_FOUND to be exactly its words, so a near miss is evidence that needs its ids", () => {
      const near = "None found this week";
      expect(placed(check({ text: near }))).toEqual(["WEEK_AGAINST review.strongest_against.finding_ids"]);
      expect(check({ text: near }, NEITHER())).toEqual([]);
      expect(placed(check({ text: `${NONE_FOUND.en} ` }))).toEqual(["WEEK_AGAINST review.strongest_against.finding_ids"]);
      expect(placed(check({ text: NONE_FOUND.en.toLowerCase() }))).toEqual(["WEEK_AGAINST review.strongest_against.finding_ids"]);
    });

    it("finds no setback and no fall in a context that has no week, which the schema never gives a Monday", () => {
      const noWeek: AgentContext = { ...mondayContext(), week: null };
      expect(check({ text: TEXT }, noWeek)).toEqual([]);
      expect(check(NONE, noWeek)).toEqual([]);
      expect(placed(check({ ...NONE, finding_ids: ["math-2026-0002"] }, noWeek))).toEqual(["WEEK_AGAINST review.strongest_against"]);
    });

    describe("with the draft's own corrections applied (SPEC §4.10)", () => {
      const corrected = (corrections: Json[], strongest: Json, context = WEEK()) =>
        verdict(mondayIn(revise(against(strongest), (d) => { d.corrections = corrections; }), context));

      it("drops a setback that a correction refiles to another kind, and keeps the fall", () => {
        const refiled = [correction(SETBACK, "kind", "result")];
        expect(corrected(refiled, { text: TEXT, finding_ids: [FALL] })).toEqual([]);
        expect(corrected(refiled, NONE)[0]!.message).toContain("1 setback or fall: phys-2026-0003 (fell to disputed)");
        expect(corrected(refiled, NONE, weekOf([[SETBACK, "setback"]]))).toEqual([]);
      });

      it("adds a finding of the week that a correction refiles as a setback", () => {
        const refiled = [correction("math-2026-0002", "kind", "setback")];
        const issues = corrected(refiled, { text: TEXT, finding_ids: [SETBACK, FALL] });
        expect(issues[0]!.message).toBe("strongest_against.finding_ids leaves out 1 finding of the week: math-2026-0002 (a setback). Add its id.");
        expect(corrected(refiled, { text: TEXT, finding_ids: [SETBACK, FALL, "math-2026-0002"] })).toEqual([]);
        expect(placed(corrected(refiled, NONE, NEITHER()))).toEqual(["WEEK_AGAINST review.strongest_against.text"]);
      });

      it("keeps a setback that a correction refiles on another path, and a fall whatever its kind", () => {
        expect(corrected([correction(SETBACK, "significance", "watch")], { text: TEXT, finding_ids: [FALL] })).toHaveLength(1);
        expect(corrected([correction(FALL, "kind", "setback")], { text: TEXT, finding_ids: [SETBACK] })[0]!.message).toContain(fix(FALL, "a setback, fell to disputed"));
        expect(corrected([correction(FALL, "kind", "result")], { text: TEXT, finding_ids: [SETBACK] })[0]!.message).toContain(fix(FALL, "fell to disputed"));
        expect(corrected([correction(SETBACK, "kind", "setback")], { text: TEXT, finding_ids: [FALL] })).toHaveLength(1);
      });

      it("applies the latest of two corrections of the same kind", () => {
        const twice = [correction(SETBACK, "kind", "result"), correction(SETBACK, "kind", "setback")];
        expect(corrected(twice, { text: TEXT, finding_ids: [FALL] })).toHaveLength(1);
        const back = [correction(SETBACK, "kind", "setback"), correction(SETBACK, "kind", "check")];
        expect(corrected(back, { text: TEXT, finding_ids: [FALL] })).toEqual([]);
      });

      it("drops a setback that only the list names when a correction refiles it to another kind", () => {
        const listed = weekWith({ findings: [], setbacks: ["hum-2026-0005"], rung_changes: [] });
        expect(corrected([], { text: TEXT }, listed)).toHaveLength(1);
        expect(corrected([correction("hum-2026-0005", "kind", "result")], { text: TEXT }, listed)).toEqual([]);
        expect(corrected([correction("hum-2026-0005", "kind", "setback")], { text: TEXT }, listed)).toHaveLength(1);
      });

      it("asks the draft's own corrections, not the record's published kind, when the run was given the stored finding", () => {
        // The record was published as a result and a stored correction refiled it as a setback, which is why the week lists it:
        // a draft that files it a result again takes it out of the list, though its kind is the one it was published with.
        const week = weekOf([["math-2026-0002", "result"], [SETBACK, "setback"]]);
        const given = { findings: [stored(SETBACK, { kind: "result" })], corrections: [filing("C-0003", "2026-11-21", SETBACK, "kind", "setback")], terms: [] };
        const given2 = { ...given, findings: [stored(SETBACK, { kind: "setback" })], corrections: [] };
        const verdictOf = (corrections: Json[], over: Partial<DraftInputs>) =>
          verdict(draftIn(revise(against({ text: TEXT }), (d) => { d.corrections = corrections; }), { context: week, ...over }));
        for (const over of [{ stored: given }, { stored: given2 }, {}]) {
          expect(verdictOf([], over)[0]!.message, JSON.stringify(Object.keys(over))).toContain(fix(SETBACK, "a setback"));
          expect(verdictOf([correction(SETBACK, "kind", "result")], over), JSON.stringify(Object.keys(over))).toEqual([]);
          // the later of two corrections counts, and one that files it a setback keeps it
          expect(verdictOf([correction(SETBACK, "kind", "result"), correction(SETBACK, "kind", "setback")], over)).toHaveLength(1);
          expect(verdictOf([correction(SETBACK, "kind", "setback"), correction(SETBACK, "kind", "check")], over)).toEqual([]);
          // a correction of another path, or of another finding, leaves it a setback
          expect(verdictOf([correction(SETBACK, "significance", "watch")], over)).toHaveLength(1);
          expect(verdictOf([correction("math-2026-0002", "kind", "check")], over)).toHaveLength(1);
        }
      });
    });

    it("judges only a Monday that has a review and a context that has a week", () => {
      const review = { big_picture: "b", remarkable: null, strongest_against: { text: NONE_FOUND.en, finding_ids: [], source_ids: [] } };
      expect(verdict(draftIn(revise(weekdayBase(), (d) => { d.review = review; })))).toEqual([]);
      expect(verdict(sundayIn(revise(sundayBase(), (d) => { d.review = review; })))).toEqual([]);
      expect(verdict(mondayIn(revise(mondayBase(), (d) => { d.review = null; })))).toEqual([]);
      const noWeek: AgentContext = { ...WEEK(), week: null };
      expect(verdict(mondayIn(against(NONE), noWeek))).toEqual([]);
    });
  });

  describe("in published mode", () => {
    for (const [label, publishing] of RECORD_SETS) {
      describe(`on ${label}`, () => {
        const check = (strongest: Json, review: Json = {}, world?: World, brief = storedMonday({ ...review, strongest_against: { ...storedMonday().review!.strongest_against, ...strongest } })) =>
          verdict(publishedIn(brief, { publishing: publishing(brief), ...(world === undefined ? {} : { world }) }));
        const PATH = `briefs/${MONDAY}.json: review.strongest_against`;

        it("fails NONE_FOUND beside a setback, beside a fall and beside both, at the text", () => {
          for (const lists of [{ setbacks: [SETBACK], fell: [] }, { setbacks: [], fell: [FALL] }, { setbacks: [SETBACK], fell: [FALL] }]) {
            const issues = check({ text: NONE_FOUND, finding_ids: [] }, lists);
            expect(placed(issues), JSON.stringify(lists)).toEqual([`WEEK_AGAINST ${PATH}.text.en`]);
          }
          expect(check({ text: NONE_FOUND, finding_ids: [] }, { setbacks: [SETBACK], fell: [] })[0]!.message).toBe(
            'strongest_against.text is "None found this week.", but the week has 1 setback or fall: chem-2026-0004 (a setback). Write the evidence against and list it in finding_ids.',
          );
          expect(check({ text: NONE_FOUND, finding_ids: [] }, { setbacks: [], fell: [FALL] })[0]!.message).toContain("phys-2026-0003 (fell)");
        });

        it("passes NONE_FOUND with both lists empty when the review lists no setback and no fall", () => {
          expect(check({ text: NONE_FOUND, finding_ids: [] }, { setbacks: [], fell: [] })).toEqual([]);
          expect(check({ text: l("A made-up counterpoint."), finding_ids: [] }, { setbacks: [], fell: [] })).toEqual([]);
        });

        it("fails NONE_FOUND with ids in its lists, at strongest_against", () => {
          const issues = check({ text: NONE_FOUND, finding_ids: ["math-2026-0002"], source_ids: [] }, { setbacks: [], fell: [] });
          expect(placed(issues)).toEqual([`WEEK_AGAINST ${PATH}`]);
          expect(issues[0]!.message).toContain("they hold 1 id.");
        });

        it("fails evidence that leaves out a setback or a fall the review lists, and passes evidence that names them", () => {
          const text = l("A made-up counterpoint.");
          const noSetback = check({ text, finding_ids: [FALL] });
          expect(placed(noSetback)).toEqual([`WEEK_AGAINST ${PATH}.finding_ids`]);
          expect(noSetback[0]!.message).toBe("strongest_against.finding_ids leaves out 1 finding of the week: chem-2026-0004 (a setback). Add its id.");
          expect(check({ text, finding_ids: [SETBACK] })[0]!.message).toContain("phys-2026-0003 (fell)");
          expect(check({ text, finding_ids: [] })[0]!.message).toContain("leaves out 2 findings of the week: chem-2026-0004 (a setback), phys-2026-0003 (fell)");
          expect(check({ text, finding_ids: [SETBACK, FALL] })).toEqual([]);
          expect(check({ text, finding_ids: [FALL, "math-2026-0002", SETBACK] })).toEqual([]);
        });

        it("reads the review's own setbacks and falls, not the stored corrections of today", () => {
          const refiled = worldWith([], [filing("C-0003", MONDAY, SETBACK, "kind", "result")]);
          expect(placed(check({ text: NONE_FOUND, finding_ids: [] }, { setbacks: [SETBACK], fell: [] }, refiled))).toEqual([`WEEK_AGAINST ${PATH}.text.en`]);
          const made = worldWith([], [filing("C-0003", MONDAY, "math-2026-0002", "kind", "setback")]);
          expect(check({ text: NONE_FOUND, finding_ids: [] }, { setbacks: [], fell: [] }, made)).toEqual([]);
        });

        it("skips a removed text: the words are gone, the ids still count", () => {
          const removed = { text: { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh } };
          expect(check({ ...removed, finding_ids: [SETBACK, FALL] })).toEqual([]);
          expect(check({ ...removed, finding_ids: [] }, { setbacks: [], fell: [] })).toEqual([]);
          expect(placed(check({ ...removed, finding_ids: [] }))).toEqual([`WEEK_AGAINST ${PATH}.finding_ids`]);
        });

        it("skips a data-only Monday, and a Monday's brief that has no review", () => {
          expect(verdict(publishedIn(storedDataOnly(MONDAY), { publishing: publishing(storedDataOnly(MONDAY)) }))).toEqual([]);
          const none = revised(storedMonday(), (b) => { b.review = null; });
          expect(verdict(publishedIn(none, { publishing: publishing(none) }))).toEqual([]);
        });

        it("judges no weekday or Sunday brief, whatever its review says", () => {
          const sunday = revised(storedSunday(), (b) => { b.review = clone(storedMonday({ setbacks: [SETBACK] }).review); b.review.strongest_against.text = NONE_FOUND; b.review.strongest_against.finding_ids = []; });
          expect(verdict(publishedIn(sunday, { publishing: publishing(sunday) }))).toEqual([]);
        });
      });
    }
  });
});

// ── COUNTS ───────────────────────────────────────────────────────────────────────────────────────

describe("COUNTS: story plus items ≤ `findings_max`; ideas ≤ 2; also ≤ 5; reactions ≤ 4; related ≤ 5", () => {
  const counted = (input: RuleInput) => only(run(input), "COUNTS");
  const EXISTING = ["math-2026-0002", "phys-2026-0003", "chem-2026-0004", "bio-2026-0001"];
  const withConfigMax = (max: number) => {
    const real = config();
    return { ...real, run: { ...real.run, budgets: { ...real.run.budgets, findings_max: max } } };
  };
  const idea = (): Json => ({ text: "A made-up argument about method.", who: "A. Example", source_id: "b2" });
  const aside = (): Json => ({ title: "A made-up soil study", field: "earth", source_id: "b3" });
  const reaction = (): Json => ({ source_id: "s2", who: "A. Reviewer", affiliation: "Example University", quote: "a careful result" });
  const related = (n: number): string[] => ["bio-2026-0002", "math-2026-0002", "phys-2026-0003", "chem-2026-0004", "earth-2026-0005", "soc-2026-0006", "hum-2026-0007"].slice(0, n);

  describe("in a draft", () => {
    const items = (n: number) => revise(weekdayBase(), (d) => {
      d.items = ["new-2", ...EXISTING].slice(0, n - 1);
      d.returning = [];
      d.lead = [{ text: "t", refs: ["new-1"] }];
    });

    it("passes story plus items up to findings_max and fails one more, at items, with the edit", () => {
      expect(counted(draftIn(items(5)))).toEqual([]);
      expect(counted(draftIn(items(4)))).toEqual([]);
      const issues = counted(draftIn(items(6)));
      expect(placed(issues)).toEqual(["COUNTS items"]);
      expect(issues[0]!.message).toBe("story plus items hold 6 findings; the limit is 5 (budgets.findings_max). Cut at least 1, starting with the lowest-ranked item.");
    });

    it("counts a story that is null as no finding, and the story as one", () => {
      const noStory = revise(weekdayBase(), (d) => { d.story = null; d.items = ["new-1", "new-2", ...EXISTING]; d.returning = []; });
      expect(placed(counted(draftIn(noStory)))).toEqual(["COUNTS items"]);
      expect(counted(draftIn(revise(noStory, (d) => { d.items = ["new-1", "new-2", ...EXISTING.slice(0, 3)]; })))).toEqual([]);
    });

    it("reads findings_max of the run's config", () => {
      expect(counted(draftIn(items(4), { config: withConfigMax(4) }))).toEqual([]);
      const issues = counted(draftIn(items(4), { config: withConfigMax(3) }));
      expect(issues[0]!.message).toBe("story plus items hold 4 findings; the limit is 3 (budgets.findings_max). Cut at least 1, starting with the lowest-ranked item.");
      expect(counted(draftIn(items(6), { config: withConfigMax(6) }))).toEqual([]);
    });

    it("passes 2 ideas and fails 3, at ideas", () => {
      expect(counted(draftIn(revise(weekdayBase(), (d) => { d.ideas = [idea(), idea()]; })))).toEqual([]);
      const issues = counted(draftIn(revise(weekdayBase(), (d) => { d.ideas = [idea(), idea(), idea()]; })));
      expect(placed(issues)).toEqual(["COUNTS ideas"]);
      expect(issues[0]!.message).toBe("ideas has 3 entries; the limit is 2. Cut at least 1.");
      expect(counted(draftIn(revise(weekdayBase(), (d) => { d.ideas = [idea(), idea(), idea(), idea()]; })))[0]!.message).toBe("ideas has 4 entries; the limit is 2. Cut at least 2.");
    });

    it("passes 5 Also noted lines and fails 6, at also", () => {
      expect(counted(draftIn(revise(weekdayBase(), (d) => { d.also = [1, 2, 3, 4, 5].map(aside); })))).toEqual([]);
      const issues = counted(draftIn(revise(weekdayBase(), (d) => { d.also = [1, 2, 3, 4, 5, 6].map(aside); })));
      expect(placed(issues)).toEqual(["COUNTS also"]);
      expect(issues[0]!.message).toBe("also has 6 entries; the limit is 5. Cut at least 1.");
    });

    it("passes 4 reactions on a new finding and fails 5, at that finding's reactions", () => {
      expect(counted(draftIn(revise(weekdayBase(), (d) => { d.new_findings[0].reactions = [1, 2, 3, 4].map(reaction); })))).toEqual([]);
      const issues = counted(draftIn(revise(weekdayBase(), (d) => { d.new_findings[1].reactions = [1, 2, 3, 4, 5].map(reaction); })));
      expect(placed(issues)).toEqual(["COUNTS new_findings[1].reactions"]);
      expect(issues[0]!.message).toBe(
        "new_findings[1].reactions has 5 entries; the limit is 4. Keep the most informative ones, cut at least 1.",
      );
    });

    it("passes 5 related findings on a new finding and fails 6, at that finding's related", () => {
      expect(counted(draftIn(revise(weekdayBase(), (d) => { d.new_findings[0].related = related(5); })))).toEqual([]);
      const issues = counted(draftIn(revise(weekdayBase(), (d) => { d.new_findings[0].related = related(7); })));
      expect(placed(issues)).toEqual(["COUNTS new_findings[0].related"]);
      expect(issues[0]!.message).toBe("new_findings[0].related has 7 entries; the limit is 5. Keep the closest findings, cut at least 2.");
    });

    it("reports each count that is over, and judges a stored finding the draft only names in published mode alone", () => {
      const draft = revise(weekdayBase(), (d) => { d.ideas = [idea(), idea(), idea()]; d.new_findings[0].reactions = [1, 2, 3, 4, 5].map(reaction); d.new_findings[1].related = related(6); });
      expect(placed(counted(draftIn(draft)))).toEqual(["COUNTS ideas", "COUNTS new_findings[0].reactions", "COUNTS new_findings[1].related"]);
      const many = storedFinding("math-2026-0002", { reactions: [1, 2, 3, 4, 5].map(reaction), related: related(7).filter((id) => id !== "math-2026-0002") });
      const given = { findings: [many], corrections: [], terms: [] };
      expect(counted(draftIn(weekdayBase(), { stored: given }))).toEqual([]);
      expect(counted(draftIn(weekdayBase()))).toEqual([]);
    });
  });

  describe("in published mode", () => {
    const six = (): Brief => revised(storedBrief(), (b) => {
      b.items = ["math-2026-0002", "phys-2026-0003", "chem-2026-0004", "earth-2026-0005", "soc-2026-0006"].map((finding_id) => ({ finding_id, new: true, update: null }));
    });

    it("holds story plus items to findings_max for the brief being published alone", () => {
      const brief = six();
      const being = counted(publishedIn(brief, { publishing: D }));
      expect(placed(being)).toEqual([`COUNTS briefs/${D}.json: items`]);
      expect(being[0]!.message).toBe("story plus items hold 6 findings; the limit is 5 (budgets.findings_max). Cut at least 1, starting with the lowest-ranked item.");
      expect(counted(publishedIn(brief, { publishing: null }))).toEqual([]);
      expect(counted(publishedIn(brief, { publishing: OTHER_DAY }))).toEqual([]);
    });

    it("reads findings_max of the config it is given, on the brief being published", () => {
      const world = { ...storedWorld(), config: withConfigMax(2) };
      const brief = storedBrief();
      expect(placed(counted(publishedIn(brief, { publishing: D, world })))).toEqual([`COUNTS briefs/${D}.json: items`]);
      expect(counted(publishedIn(brief, { publishing: null, world }))).toEqual([]);
      expect(counted(publishedIn(brief, { publishing: D }))).toEqual([]);
    });

    for (const [label, publishing] of RECORD_SETS) {
      describe(`on ${label}`, () => {
        const check = (brief: Brief, world?: World) => counted(publishedIn(brief, { publishing: publishing(brief), ...(world === undefined ? {} : { world }) }));

        it("passes 2 ideas and 5 Also noted lines and fails 3 and 6", () => {
          const tall = (n: number, line: Json) => Array.from({ length: n }, () => clone(line));
          const ideaLine = storedBrief().ideas[0];
          const alsoLine = storedBrief().also[0];
          expect(check(revised(storedBrief(), (b) => { b.ideas = tall(2, ideaLine); b.also = tall(5, alsoLine); }))).toEqual([]);
          const issues = check(revised(storedBrief(), (b) => { b.ideas = tall(3, ideaLine); b.also = tall(6, alsoLine); }));
          expect(placed(issues)).toEqual([`COUNTS briefs/${D}.json: also`, `COUNTS briefs/${D}.json: ideas`]);
          expect(issues.map((i) => i.message)).toEqual(["also has 6 entries; the limit is 5. Cut at least 1.", "ideas has 3 entries; the limit is 2. Cut at least 1."]);
        });

        it("fails a stored finding with 5 reactions or 6 related findings, at the finding's file", () => {
          const reactions = [1, 2, 3, 4, 5].map(reaction);
          const world = { ...storedWorld(), findings: [storedFinding("bio-2026-0001", { reactions, related: related(6) }), ...storedWorld().findings.slice(1)] };
          const issues = check(storedBrief(), world);
          expect(placed(issues)).toEqual(["COUNTS findings/bio-2026-0001.json: reactions", "COUNTS findings/bio-2026-0001.json: related"]);
          expect(issues[0]!.message).toBe(
            "findings/bio-2026-0001.json: reactions has 5 entries; the limit is 4. Keep the most informative ones, cut at least 1.",
          );
          const ok = { ...storedWorld(), findings: [storedFinding("bio-2026-0001", { reactions: reactions.slice(0, 4), related: related(5) }), ...storedWorld().findings.slice(1)] };
          expect(check(storedBrief(), ok)).toEqual([]);
        });

        it("judges a stored finding that the brief does not name, and records that no brief names", () => {
          const reactions = [1, 2, 3, 4, 5].map(reaction);
          const world = { ...storedWorld(), findings: [...storedWorld().findings, stored("math-2026-0009", { reactions })] };
          expect(placed(check(storedBrief(), world))).toEqual(["COUNTS findings/math-2026-0009.json: reactions"]);
          const input = publishedIn(null, { publishing: publishing(storedBrief()), world });
          expect(placed(counted(input))).toEqual(["COUNTS findings/math-2026-0009.json: reactions"]);
        });
      });
    }

    it("skips a data-only edition and a stored brief with nothing in it", () => {
      expect(counted(publishedIn(storedDataOnly(D), { publishing: D }))).toEqual([]);
      expect(counted(publishedIn(storedOn(D, quiet), { publishing: D }))).toEqual([]);
    });
  });
});

// ── FIELD_CAP ────────────────────────────────────────────────────────────────────────────────────

describe("FIELD_CAP: at most 2 findings per field in story and items, as filed", () => {
  const capped = (input: RuleInput) => only(run(input), "FIELD_CAP");
  /** Story new-1 (biology) and items new-2, then the context's four findings: mathematics, physics, chemistry and biology. */
  const fields = (items: string[], change: (d: Json) => void = () => undefined) => revise(weekdayBase(), (d) => {
    d.items = items;
    d.returning = [];
    change(d);
  });
  const as = (index: number, field: string) => (d: Json) => { d.new_findings[index].field = field; };

  describe("in a draft", () => {
    it("passes 2 findings of a field and fails a third, at the third's place, naming the findings", () => {
      expect(capped(draftIn(fields(["new-2", "bio-2026-0001"])))).toEqual([]);
      const three = fields(["new-2", "bio-2026-0001"], as(1, "biology"));
      const issues = capped(draftIn(three));
      expect(placed(issues)).toEqual(["FIELD_CAP items[1]"]);
      expect(issues[0]!.message).toBe(
        "3 findings in story and items are filed under biology (new-1, new-2, bio-2026-0001); the limit is 2 per field. Replace or cut at least 1.",
      );
      const four = fields(["new-2", "bio-2026-0001", "bio-2026-0010"], as(1, "biology"));
      const more = capped(draftIn(four, { context: withContext(weekdayContext(), (c) => { c.recent_findings.push({ ...c.recent_findings[3], id: "bio-2026-0010" }); }) }));
      expect(placed(more)).toEqual(["FIELD_CAP items[1]"]);
      expect(more[0]!.message).toContain("4 findings in story and items are filed under biology (new-1, new-2, bio-2026-0001, bio-2026-0010)");
      expect(more[0]!.message).toContain("Replace or cut at least 2.");
    });

    it("counts the story and the items alike, and the findings that are new and those that are not", () => {
      // the story new-1 and the items new-2 and bio-2026-0001 are all filed under biology
      const inItems = fields(["new-2", "bio-2026-0001"], as(1, "biology"));
      expect(placed(capped(draftIn(inItems)))).toEqual(["FIELD_CAP items[1]"]);
      // the story counts: without it the two items are two
      expect(capped(draftIn(revise(inItems, (d) => { d.story = null; })))).toEqual([]);
      // an item counts: without one the story and the other item are two
      expect(capped(draftIn(revise(inItems, (d) => { d.items = ["new-2"]; })))).toEqual([]);
      // an existing finding as the story counts as a new one does
      const storyElsewhere = revise(inItems, (d) => { d.story = "bio-2026-0001"; d.items = ["new-1", "new-2"]; });
      expect(placed(capped(draftIn(storyElsewhere)))).toEqual(["FIELD_CAP items[1]"]);
    });

    it("reports each field over the cap once, at its third finding", () => {
      // new-1 and bio-2026-0001 are biology, new-2 is earth; the corrections file math-2026-0002 under biology, phys-2026-0003 and chem-2026-0004 under earth
      const draft = fields(["new-2", "bio-2026-0001", "math-2026-0002", "phys-2026-0003", "chem-2026-0004"], (d) => {
        d.corrections = [correction("math-2026-0002", "field", "biology"), correction("phys-2026-0003", "field", "earth"), correction("chem-2026-0004", "field", "earth")];
      });
      const issues = capped(draftIn(draft));
      expect(placed(issues)).toEqual(["FIELD_CAP items[2]", "FIELD_CAP items[4]"]);
      expect(issues.map((i) => i.message)).toEqual([
        "3 findings in story and items are filed under biology (new-1, bio-2026-0001, math-2026-0002); the limit is 2 per field. Replace or cut at least 1.",
        "3 findings in story and items are filed under earth (new-2, phys-2026-0003, chem-2026-0004); the limit is 2 per field. Replace or cut at least 1.",
      ]);
    });

    it("holds the cap to 2 whatever the context's copy of the cap says", () => {
      // The cap is the constant 2; the context's `config.field_cap` is the agent's copy of it, which no rule reads (SPEC §4.15): not for
      // the verdict, nor for the limit the message names, the number to cut or the place it points at.
      const three = fields(["new-2", "bio-2026-0001"], as(1, "biology"));
      const higher = capped(draftIn(three, { context: withContext(weekdayContext(), (c) => { c.config.field_cap = 3; }) }));
      expect(placed(higher)).toEqual(["FIELD_CAP items[1]"]);
      expect(higher[0]!.message).toBe(
        "3 findings in story and items are filed under biology (new-1, new-2, bio-2026-0001); the limit is 2 per field. Replace or cut at least 1.",
      );
      // A lower copy does not make two findings of a field too many.
      const two = fields(["new-2", "bio-2026-0001"]);
      expect(capped(draftIn(two, { context: withContext(weekdayContext(), (c) => { c.config.field_cap = 1; }) }))).toEqual([]);
    });

    it("reads each field as filed with the draft's own corrections", () => {
      const refile = (id: string, field: string): Json => correction(id, "field", field);
      // the context files phys-2026-0003 under physics and chem-2026-0004 under chemistry: two corrections make three of biology
      const two = fields(["new-2", "bio-2026-0001"], (d) => { d.corrections = [refile("phys-2026-0003", "biology")]; d.items = ["new-2", "bio-2026-0001", "phys-2026-0003"]; });
      expect(placed(capped(draftIn(two)))).toEqual(["FIELD_CAP items[2]"]);
      const away = fields(["new-2", "bio-2026-0001"], (d) => { d.corrections = [refile("bio-2026-0001", "social")]; });
      expect(capped(draftIn(revise(away, (d) => { d.new_findings[1].field = "biology"; })))).toEqual([]);
      const later = fields(["new-2", "bio-2026-0001", "phys-2026-0003"], (d) => { d.corrections = [refile("phys-2026-0003", "biology"), refile("phys-2026-0003", "physics")]; });
      expect(capped(draftIn(later))).toEqual([]);
    });

    it("leaves a finding whose field is not known to REF_UNKNOWN", () => {
      const strange = fields(["new-2", "soc-2026-9001", "soc-2026-9002", "soc-2026-9003"]);
      expect(capped(draftIn(strange))).toEqual([]);
      expect(codesOf(run(draftIn(strange)))).toContain("REF_UNKNOWN");
      // it ends no count: the findings after it are counted as they are without it (new-1 as the story, new-2 and bio-2026-0001 after it)
      const before = fields(["soc-2026-9001", "new-2", "bio-2026-0001"], as(1, "biology"));
      expect(placed(capped(draftIn(before)))).toEqual(["FIELD_CAP items[2]"]);
    });
  });

  describe("in published mode", () => {
    const three = (): { brief: Brief; world: World } => {
      const world = worldWith(["math-2026-0010", "math-2026-0011"]);
      const brief = revised(storedBrief(), (b) => {
        b.items = ["math-2026-0002", "math-2026-0010", "math-2026-0011"].map((finding_id) => ({ finding_id, new: true, update: null }));
      });
      return { brief, world };
    };

    for (const [label, publishing] of RECORD_SETS) {
      describe(`on ${label}`, () => {
        const check = (brief: Brief, world: World) => capped(publishedIn(brief, { publishing: publishing(brief), world }));

        it("fails 3 stored findings of a field, at the third item, and passes 2", () => {
          const { brief, world } = three();
          const issues = check(brief, world);
          expect(placed(issues)).toEqual([`FIELD_CAP briefs/${D}.json: items[2]`]);
          expect(issues[0]!.message).toBe(
            "3 findings in story and items are filed under mathematics (math-2026-0002, math-2026-0010, math-2026-0011); the limit is 2 per field. Replace or cut at least 1.",
          );
          expect(check(storedBrief(), storedWorld())).toEqual([]);
        });

        it("reads each field as the stored corrections dated on or before the brief's date file it", () => {
          const { brief } = three();
          const refiled = worldWith(["math-2026-0010", "math-2026-0011"], [filing("C-0003", D, "math-2026-0011", "field", "physics")]);
          expect(check(brief, refiled)).toEqual([]);
          const earlier = worldWith(["math-2026-0010", "math-2026-0011"], [filing("C-0003", "2026-11-12", "math-2026-0011", "field", "physics")]);
          expect(check(brief, earlier)).toEqual([]);
          // a correction dated after the brief changes nothing about the brief as it was published
          const later = worldWith(["math-2026-0010", "math-2026-0011"], [filing("C-0003", "2026-11-25", "math-2026-0011", "field", "physics")]);
          expect(check(brief, later)).toHaveLength(1);
          const into = worldWith([], [filing("C-0003", "2026-11-25", "phys-2026-0003", "field", "mathematics"), filing("C-0004", "2026-11-25", "bio-2026-0001", "field", "mathematics")]);
          expect(check(storedBrief(), into)).toEqual([]);
          const now = worldWith([], [filing("C-0003", D, "bio-2026-0001", "field", "mathematics")]);
          expect(check(storedBrief(), now)).toEqual([]);
          const nowThree = worldWith([], [filing("C-0003", D, "bio-2026-0001", "field", "mathematics"), filing("C-0004", D, "phys-2026-0003", "field", "mathematics")]);
          expect(placed(check(storedBrief(), nowThree))).toEqual([`FIELD_CAP briefs/${D}.json: items[1]`]);
        });

        it("passes an edition with no findings, a data-only one among them, and leaves a finding that is not stored alone", () => {
          expect(check(storedOn(D, quiet), storedWorld())).toEqual([]);
          expect(check(storedDataOnly(D), storedWorld())).toEqual([]);
          const missing = revised(storedBrief(), (b) => { b.items = ["math-2099-0001", "math-2099-0002", "math-2099-0003"].map((finding_id) => ({ finding_id, new: true, update: null })); });
          expect(check(missing, storedWorld())).toEqual([]);
        });
      });
    }
  });
});

// ── STORY_PICK ───────────────────────────────────────────────────────────────────────────────────

describe("STORY_PICK: the story's significance is at least every item's, as filed", () => {
  const picked = (input: RuleInput) => only(run(input), "STORY_PICK");
  /** The weekday with new-1 as the story and new-2 as its one item, filed as `top` and `item`. */
  const story = (top: string, item: string): DraftBrief => revise(weekdayBase(), (d) => {
    d.items = ["new-2"];
    d.new_findings[0].significance = top;
    d.new_findings[1].significance = item;
  });

  describe("in a draft", () => {
    const RANK: Record<string, number> = { watch: 1, notable: 2, major: 3, landmark: 4 };
    const PAIRS = SIGNIFICANCE.flatMap((s) => SIGNIFICANCE.map((i): [string, string] => [s, i]));

    it("knows the order of the four levels it compares", () => {
      expect(SIGNIFICANCE.map((s) => SIGNIFICANCE_INFO[s].rank).sort()).toEqual([1, 2, 3, 4]);
      for (const s of SIGNIFICANCE) expect(SIGNIFICANCE_INFO[s].rank).toBe(RANK[s]);
    });

    it.each(PAIRS)("a %s story with a %s item", (top, item) => {
      const issues = picked(draftIn(story(top, item)));
      if (RANK[item]! > RANK[top]!) {
        expect(placed(issues)).toEqual(["STORY_PICK items[0]"]);
        expect(issues[0]!.message).toBe(
          `items[0] (new-2) is filed as ${item}, above the story new-1, which is filed as ${top}. The story is the finding with the highest significance: make new-2 the story and move new-1 to items.`,
        );
      } else {
        expect(issues).toEqual([]);
      }
    });

    it("reports each item that outranks the story, at its own place, and none that does not", () => {
      const draft = revise(weekdayBase(), (d) => {
        d.new_findings[0].significance = "notable";
        d.new_findings[1].significance = "landmark";
        d.items = ["new-2", "math-2026-0002", "phys-2026-0003", "bio-2026-0001"];
        d.returning = [];
        d.corrections = [];
      });
      // the context files math Notable, and physics, chemistry and biology Major
      expect(placed(picked(draftIn(draft)))).toEqual(["STORY_PICK items[0]", "STORY_PICK items[2]", "STORY_PICK items[3]"]);
    });

    it("passes a story that is null, and a story with no items", () => {
      expect(picked(draftIn(revise(weekdayBase(), (d) => { d.story = null; d.items = ["new-1", "new-2"]; d.new_findings[1].significance = "landmark"; })))).toEqual([]);
      expect(picked(draftIn(revise(weekdayBase(), (d) => { d.items = []; d.new_findings = [d.new_findings[0]]; d.returning = []; })))).toEqual([]);
    });

    it("reads an existing finding as filed with the draft's own corrections, and one the context shows as the context files it", () => {
      // the frame's draft files math-2026-0002 as Major, so it does not outrank the Major story; raised to Landmark by a correction, it does
      const raised = picked(draftIn(landmarkDraft()));
      expect(placed(raised)).toEqual(["STORY_PICK items[1]"]);
      expect(raised[0]!.message).toContain("items[1] (math-2026-0002) is filed as landmark, above the story new-1, which is filed as major.");
      expect(picked(draftIn(weekdayBase()))).toEqual([]);
      // the same correction lowered keeps it below
      expect(picked(draftIn(revise(weekdayDraft(), (d) => { d.corrections[0].after = "watch"; })))).toEqual([]);
      // a correction raises a story that is an existing finding above its items
      const existingStory = revise(weekdayBase(), (d) => { d.story = "math-2026-0002"; d.items = ["new-1", "new-2"]; d.returning = []; d.corrections[0].after = "notable"; });
      expect(placed(picked(draftIn(existingStory)))).toEqual(["STORY_PICK items[0]"]);
      const mended = revise(existingStory, (d) => { d.corrections[0].after = "landmark"; });
      expect(picked(draftIn(mended))).toEqual([]);
    });

    it("applies the latest of two corrections of one finding's significance", () => {
      const twice = revise(weekdayBase(), (d) => { d.corrections = [correction("math-2026-0002", "significance", "landmark"), correction("math-2026-0002", "significance", "notable")]; });
      expect(picked(draftIn(twice))).toEqual([]);
      const back = revise(weekdayBase(), (d) => { d.corrections = [correction("math-2026-0002", "significance", "notable"), correction("math-2026-0002", "significance", "landmark")]; });
      expect(placed(picked(draftIn(back)))).toEqual(["STORY_PICK items[1]"]);
    });

    it("leaves a finding whose significance is not known to REF_UNKNOWN", () => {
      const strangeItem = revise(weekdayBase(), (d) => { d.items = ["new-2", "soc-2026-9001"]; d.returning = []; });
      expect(picked(draftIn(strangeItem))).toEqual([]);
      const strangeStory = revise(weekdayBase(), (d) => { d.story = "soc-2026-9001"; d.items = ["new-1", "new-2"]; d.returning = []; });
      expect(picked(draftIn(strangeStory))).toEqual([]);
    });
  });

  describe("in published mode", () => {
    const world = (corrections: Correction[] = []): World => worldWith(["math-2026-0010"], corrections);
    const brief = (): Brief => revised(storedBrief(), (b) => {
      b.items = [{ finding_id: "math-2026-0010", new: true, update: null }];
    });
    const landmark = (id = "math-2026-0010"): World => ({
      ...world(), findings: [...storedWorld().findings, stored(id, { significance: "landmark" })],
    });

    for (const [label, publishing] of RECORD_SETS) {
      describe(`on ${label}`, () => {
        const check = (b: Brief, w: World) => picked(publishedIn(b, { publishing: publishing(b), world: w }));

        it("fails an item above the story, at the item, and passes an equal or lower one", () => {
          const issues = check(brief(), landmark());
          expect(placed(issues)).toEqual([`STORY_PICK briefs/${D}.json: items[0]`]);
          expect(issues[0]!.message).toBe(
            `briefs/${D}.json: items[0] (math-2026-0010) is filed as landmark, above the story bio-2026-0001, which is filed as major. The story is the finding with the highest significance: make math-2026-0010 the story and move bio-2026-0001 to items.`,
          );
          expect(check(brief(), world())).toEqual([]);
          expect(check(storedBrief(), storedWorld())).toEqual([]);
        });

        it("reads each finding as the stored corrections dated on or before the brief's date file it", () => {
          const lowered = { ...landmark(), corrections: [...storedCorrections(), filing("C-0003", D, "math-2026-0010", "significance", "major")] };
          expect(check(brief(), lowered)).toEqual([]);
          const earlier = { ...landmark(), corrections: [...storedCorrections(), filing("C-0003", "2026-11-12", "math-2026-0010", "significance", "notable")] };
          expect(check(brief(), earlier)).toEqual([]);
          // a correction dated after the brief does not change how the brief was filed
          const later = { ...landmark(), corrections: [...storedCorrections(), filing("C-0003", "2026-11-25", "math-2026-0010", "significance", "major")] };
          expect(check(brief(), later)).toHaveLength(1);
          const raisedLater = { ...world(), corrections: [...storedCorrections(), filing("C-0003", "2026-11-25", "math-2026-0010", "significance", "landmark")] };
          expect(check(brief(), raisedLater)).toEqual([]);
          // the story's own filing counts as well: a correction that lowers it makes the item outrank it
          const storyLowered = { ...world(), corrections: [...storedCorrections(), filing("C-0003", D, "bio-2026-0001", "significance", "notable"), filing("C-0004", D, "math-2026-0010", "significance", "major")] };
          expect(placed(check(brief(), storyLowered))).toEqual([`STORY_PICK briefs/${D}.json: items[0]`]);
        });

        it("passes a brief with no story and one with no findings in the world", () => {
          expect(check(revised(brief(), (b) => { b.story = null; }), landmark())).toEqual([]);
          expect(check(storedDataOnly(D), landmark())).toEqual([]);
          expect(check(revised(storedBrief(), (b) => { b.items = [{ finding_id: "math-2099-0001", new: true, update: null }]; }), storedWorld())).toEqual([]);
        });
      });
    }
  });
});

// ── SOURCE_IDS ───────────────────────────────────────────────────────────────────────────────────

describe("SOURCE_IDS: ids in order with no gaps; every cited id exists in its container", () => {
  const ids = (input: RuleInput) => only(run(input), "SOURCE_IDS");
  const source = (id: string, n = 1): Json => ({ ...clone(weekdayDraft().new_findings[0]!.sources[0]), id, url: `https://example.org/paper/${n}${id}`, doi: null });

  describe("the order of ids in a container, in a draft", () => {
    /** The weekday with new-1's sources replaced and its one reaction (which cites s2) taken out, so only the order is judged. */
    const sources = (finding: Json[]) => ids(draftIn(revise(weekdayBase(), (d) => { d.new_findings[0].sources = finding; d.new_findings[0].reactions = []; })));
    const briefSource = (id: string, n: number): Json => ({ ...clone(weekdayDraft().sources[0]), id, url: `https://example.org/statement/${n}${id}` });
    /** The weekday with nothing citing a brief source, and the brief's sources given by id. */
    const brief = (given: string[]) => ids(draftIn(revise(weekdayBase(), (d) => {
      d.returning = []; d.rung_changes = []; d.ideas = []; d.also = [];
      d.sources = given.map((id, i) => briefSource(id, i));
    })));

    it("passes s1 to sN in order, and fails the first id out of place, at its id", () => {
      expect(sources([source("s1"), source("s2")])).toEqual([]);
      const gap = sources([source("s1"), source("s3")]);
      expect(placed(gap)).toEqual(["SOURCE_IDS new_findings[0].sources[1].id"]);
      expect(gap[0]!.message).toBe(
        'new_findings[0].sources[1].id is "s3" but must be "s2": source ids run s1, s2, s3 in array order with no gaps or repeats. Renumber the sources and every id that cites them.',
      );
    });

    it("fails an order that is not 1, 2, 3, and a repeat, and counts the ids out of place", () => {
      const swapped = sources([source("s2"), source("s1")]);
      expect(placed(swapped)).toEqual(["SOURCE_IDS new_findings[0].sources[0].id"]);
      expect(swapped[0]!.message).toBe(
        'new_findings[0].sources[0].id is "s2" but must be "s1": source ids run s1, s2, s3 in array order with no gaps or repeats. 2 of the 2 sources are out of place. Renumber the sources and every id that cites them.',
      );
      const repeat = sources([source("s1"), source("s1", 2), source("s3")]);
      expect(placed(repeat)).toEqual(["SOURCE_IDS new_findings[0].sources[1].id"]);
      expect(repeat[0]!.message).toContain('is "s1" but must be "s2"');
      expect(repeat[0]!.message).not.toContain("out of place");
      const late = sources([source("s1"), source("s2"), source("s4"), source("s5"), source("s6")]);
      expect(placed(late)).toEqual(["SOURCE_IDS new_findings[0].sources[2].id"]);
      expect(late[0]!.message).toContain('is "s4" but must be "s3"');
      expect(late[0]!.message).toContain("3 of the 5 sources are out of place.");
    });

    it("fails the brief's sources that are not b1 to bN in order, at the brief's id", () => {
      expect(brief(["b1", "b2", "b3"])).toEqual([]);
      expect(brief([])).toEqual([]);
      const gap = brief(["b1", "b3"]);
      expect(placed(gap)).toEqual(["SOURCE_IDS sources[1].id"]);
      expect(gap[0]!.message).toBe(
        'sources[1].id is "b3" but must be "b2": source ids run b1, b2, b3 in array order with no gaps or repeats. Renumber the sources and every id that cites them.',
      );
      const swapped = brief(["b2", "b1", "b3"]);
      expect(placed(swapped)).toEqual(["SOURCE_IDS sources[0].id"]);
      expect(swapped[0]!.message).toContain("2 of the 3 sources are out of place.");
      expect(placed(brief(["b1", "b1"]))).toEqual(["SOURCE_IDS sources[1].id"]);
    });

    it("judges each container by itself: a finding's and the brief's, and the ids that cite them", () => {
      const both = ids(draftIn(revise(weekdayBase(), (d) => { d.new_findings[0].sources[1].id = "s3"; d.sources[2].id = "b4"; })));
      expect(placed(both)).toEqual([
        "SOURCE_IDS also[0].source_id", "SOURCE_IDS new_findings[0].reactions[0].source_id", "SOURCE_IDS new_findings[0].sources[1].id", "SOURCE_IDS sources[2].id",
      ]);
      const second = ids(draftIn(revise(weekdayBase(), (d) => { d.new_findings[1].sources[0].id = "s2"; })));
      expect(placed(second)).toEqual(["SOURCE_IDS new_findings[1].go_deeper[0]", "SOURCE_IDS new_findings[1].rung_history[0].source_id", "SOURCE_IDS new_findings[1].sources[0].id"]);
    });
  });

  describe("the ids a draft cites, in a draft", () => {
    const cite = (change: (d: Json) => void) => ids(draftIn(revise(weekdayBase(), change)));
    const MISSING = "is not in";

    it("passes the ids of this world, and fails each place that cites an id its container lacks, at the cite", () => {
      expect(ids(draftIn(weekdayBase()))).toEqual([]);
      const cases: [string, (d: Json) => void][] = [
        ["new_findings[0].go_deeper[0]", (d) => { d.new_findings[0].go_deeper = ["s7"]; }],
        ["new_findings[0].rung_history[0].source_id", (d) => { d.new_findings[0].rung_history[0].source_id = "s7"; }],
        ["new_findings[0].ai.evidence[0].source_id", (d) => { d.new_findings[0].ai.evidence[0].source_id = "s7"; }],
        ["new_findings[0].reactions[0].source_id", (d) => { d.new_findings[0].reactions[0].source_id = "s7"; }],
        ["ideas[0].source_id", (d) => { d.ideas[0].source_id = "b7"; }],
        ["also[0].source_id", (d) => { d.also[0].source_id = "b7"; }],
        ["returning[0].source_ids[0]", (d) => { d.returning[0].source_ids = ["b7"]; }],
        ["returning[0].rung.source_id", (d) => { d.returning[0].rung.source_id = "b7"; }],
        ["rung_changes[0].rung.source_id", (d) => { d.rung_changes[0].rung.source_id = "b7"; }],
      ];
      for (const [path, change] of cases) {
        const issues = cite(change);
        expect(placed(issues), path).toEqual([`SOURCE_IDS ${path}`]);
        expect(issues[0]!.message, path).toContain(`${path} cites ${path.includes("new_findings") ? "s7" : "b7"}, which ${MISSING}`);
      }
    });

    it("says where the id was looked for and what that container holds", () => {
      expect(cite((d) => { d.new_findings[0].go_deeper = ["s7"]; })[0]!.message).toBe(
        "new_findings[0].go_deeper[0] cites s7, which is not in new_findings[0].sources (s1, s2). Add the source or fix the id.",
      );
      expect(cite((d) => { d.ideas[0].source_id = "b7"; })[0]!.message).toBe(
        "ideas[0].source_id cites b7, which is not in sources (b1, b2, b3). Add the source or fix the id.",
      );
      expect(cite((d) => { d.new_findings[1].go_deeper = ["s2"]; })[0]!.message).toBe(
        "new_findings[1].go_deeper[0] cites s2, which is not in new_findings[1].sources (s1). Add the source or fix the id.",
      );
      const none = cite((d) => { d.sources = []; d.returning = []; d.rung_changes = []; });
      expect(none.find((i) => i.path === "ideas[0].source_id")!.message).toBe(
        "ideas[0].source_id cites b2, which is not in sources (none). Add the source or fix the id.",
      );
    });

    it("checks a figure's source, a deep dive's sources and the strongest evidence's sources", () => {
      const figure = (source_id: string): Json => ({
        source_id, image_url: "https://example.org/fig.png", licence: "CC-BY-4.0", licence_quote: "Licensed CC BY 4.0.", credit: "Figure 1 of a made-up paper", alt: "A made-up figure.",
      });
      expect(cite((d) => { d.new_findings[0].figure = figure("s2"); })).toEqual([]);
      expect(placed(cite((d) => { d.new_findings[0].figure = figure("s9"); }))).toEqual(["SOURCE_IDS new_findings[0].figure.source_id"]);
      const dive = (source_ids: string[]) => ids(sundayIn(revise(sundayBase(), (d) => { d.deep_dive.source_ids = source_ids; })));
      expect(dive(["b1"])).toEqual([]);
      expect(placed(dive(["b1", "b2"]))).toEqual(["SOURCE_IDS deep_dive.source_ids[1]"]);
      const evidence = (source_ids: string[]) => ids(mondayIn(against({ source_ids }, revise(mondayBase(), (d) => { d.sources = [weekdayDraft().sources[0]]; }))));
      expect(evidence(["b1"])).toEqual([]);
      expect(placed(evidence(["b1", "b3"]))).toEqual(["SOURCE_IDS review.strongest_against.source_ids[1]"]);
    });

    it("looks a b id up in the brief's sources and an s id in the finding's own, for a returning entry and a rung change", () => {
      // math-2026-0002 is a context finding whose report shows its one source, s1
      expect(cite((d) => { d.returning[0].source_ids = ["s1", "b2"]; d.returning[0].rung.source_id = "s1"; })).toEqual([]);
      const own = cite((d) => { d.returning[0].source_ids = ["s2"]; });
      expect(placed(own)).toEqual(["SOURCE_IDS returning[0].source_ids[0]"]);
      expect(own[0]!.message).toBe(
        'returning[0].source_ids[0] cites s2, which is not in findings["math-2026-0002"].sources (s1). Add the source or fix the id.',
      );
      expect(placed(cite((d) => { d.returning[0].rung.source_id = "s2"; }))).toEqual(["SOURCE_IDS returning[0].rung.source_id"]);
      const brief = cite((d) => { d.returning[0].source_ids = ["b9"]; });
      expect(placed(brief)).toEqual(["SOURCE_IDS returning[0].source_ids[0]"]);
      expect(brief[0]!.message).toBe("returning[0].source_ids[0] cites b9, which is not in sources (b1, b2, b3). Add the source or fix the id.");
      // a b id that the brief has is found, whichever finding the entry is about
      expect(cite((d) => { d.returning[0].source_ids = ["b3"]; })).toEqual([]);
    });

    it("cannot tell the sources of a stored finding that the context shows only in part, and passes whatever s id cites it", () => {
      // phys-2026-0003 is in the context's recent_findings alone
      expect(cite((d) => { d.rung_changes[0].rung.source_id = "s9"; })).toEqual([]);
      expect(placed(cite((d) => { d.rung_changes[0].rung.source_id = "b9"; }))).toEqual(["SOURCE_IDS rung_changes[0].rung.source_id"]);
    });

    it("reports each missing id at its own place, and nothing for an entry that cites no source of its own", () => {
      expect(cite((d) => { d.returning[0].source_ids = []; })).toEqual([]);
      const missing = cite((d) => { d.new_findings[0].go_deeper = ["s7", "s8"]; });
      expect(placed(missing)).toEqual(["SOURCE_IDS new_findings[0].go_deeper[0]", "SOURCE_IDS new_findings[0].go_deeper[1]"]);
    });

    it("leaves an id cited for a finding that the context does not list to REF_UNKNOWN", () => {
      const strange = revise(weekdayBase(), (d) => { d.returning[0].finding_id = "math-2026-9001"; d.returning[0].source_ids = ["s1", "s9"]; d.returning[0].rung.source_id = "s9"; });
      expect(ids(draftIn(strange))).toEqual([]);
      expect(codesOf(run(draftIn(strange)))).toContain("REF_UNKNOWN");
    });

    it("leaves an s id alone when the run holds no view of the finding the entry is about", () => {
      // The frame gives every finding a draft names a view, so this is the views' contract (`find` may return null) tried by hand.
      const input = draftIn(revise(weekdayBase(), (d) => { d.returning[0].source_ids = ["s9"]; }));
      const blind: DraftInput = { ...input, views: { ...input.views, find: (key) => (key === "math-2026-0002" ? null : input.views.find(key)) } };
      expect(only(run(blind), "SOURCE_IDS")).toEqual([]);
    });
  });

  describe("in published mode", () => {
    for (const [label, publishing] of RECORD_SETS) {
      describe(`on ${label}`, () => {
        const check = (brief: Brief, world: World = storedWorld()) => ids(publishedIn(brief, { publishing: publishing(brief), world }));
        const withFinding = (id: string, over: Json): World => {
          const world = storedWorld();
          return { ...world, findings: world.findings.map((f) => (f.id === id ? storedFinding(id, { ...clone(f), ...over }) : f)) };
        };
        const bio = (): Json => clone(storedWorld().findings[0]);

        it("passes the stored Tuesday", () => {
          expect(check(storedBrief())).toEqual([]);
        });

        it("fails a stored finding whose sources are out of order, at the id, in the finding's file", () => {
          const sources = bio().sources;
          const world = withFinding("bio-2026-0001", { sources: [{ ...sources[0], id: "s2" }, { ...sources[1], id: "s1" }] });
          const issues = check(storedBrief(), world).filter((i) => i.path.endsWith(".id"));
          expect(placed(issues)).toEqual(["SOURCE_IDS findings/bio-2026-0001.json: sources[0].id"]);
          expect(issues[0]!.message).toContain('findings/bio-2026-0001.json: sources[0].id is "s2" but must be "s1"');
          expect(issues[0]!.message).toContain("2 of the 2 sources are out of place.");
        });

        it("fails a stored brief whose sources are out of order, at the id", () => {
          const brief = revised(storedBrief(), (b) => { b.sources[0].id = "b2"; b.sources[1].id = "b3"; });
          const issues = check(brief).filter((i) => i.path.endsWith(".id"));
          expect(placed(issues)).toEqual([`SOURCE_IDS briefs/${D}.json: sources[0].id`]);
          expect(issues[0]!.message).toContain('is "b2" but must be "b1"');
        });

        it("fails an id a stored finding cites that its sources lack, in each place, in the finding's file", () => {
          const cases: [string, Json][] = [
            ["go_deeper[0]", { go_deeper: ["s7"] }],
            ["rung_history[1].source_id", { rung_history: bio().rung_history.map((r: Json, i: number) => (i === 1 ? { ...r, source_id: "s7" } : r)) }],
            ["ai.evidence[0].source_id", { ai: { ...bio().ai, evidence: [{ ...bio().ai.evidence[0], source_id: "s7" }] } }],
            ["reactions[0].source_id", { reactions: [{ ...bio().reactions[0], source_id: "s7" }] }],
            ["since_then[0].source_ids[0]", { since_then: [{ ...bio().since_then[0], source_ids: ["s7"] }] }],
          ];
          for (const [path, over] of cases) {
            const issues = check(storedBrief(), withFinding("bio-2026-0001", over));
            expect(placed(issues), path).toEqual([`SOURCE_IDS findings/bio-2026-0001.json: ${path}`]);
            expect(issues[0]!.message, path).toBe(
              `findings/bio-2026-0001.json: ${path} cites s7, which is not in findings/bio-2026-0001.json: sources (s1, s2). Add the source or fix the id.`,
            );
          }
        });

        it("fails a stored finding's figure that cites a source it lacks", () => {
          const figure = { source_id: "s9", image_url: "https://example.org/fig.png", licence: "CC-BY-4.0", licence_quote: "Licensed CC BY 4.0.", credit: "Figure 1 of a made-up paper", alt: l("A made-up figure.") };
          expect(placed(check(storedBrief(), withFinding("bio-2026-0001", { figure }))))
            .toEqual(["SOURCE_IDS findings/bio-2026-0001.json: figure.source_id"]);
        });

        it("fails an id the brief's text cites that its sources lack: ideas, Also noted, the deep dive and the strongest evidence against", () => {
          const brief = (change: (b: Json) => void, base = storedBrief()) => check(revised(base, change));
          expect(placed(brief((b) => { b.ideas[0].source_id = "b9"; }))).toEqual([`SOURCE_IDS briefs/${D}.json: ideas[0].source_id`]);
          expect(placed(brief((b) => { b.also[0].source_id = "b9"; }))).toEqual([`SOURCE_IDS briefs/${D}.json: also[0].source_id`]);
          expect(placed(brief((b) => { b.deep_dive.source_ids = ["b1", "b9"]; }, storedSunday()))).toEqual([`SOURCE_IDS briefs/${SUNDAY}.json: deep_dive.source_ids[1]`]);
          const monday = storedMonday({ strongest_against: { text: l("A made-up counterpoint."), finding_ids: [], source_ids: ["b9"] }, setbacks: [], fell: [] });
          expect(placed(check(monday))).toEqual([`SOURCE_IDS briefs/${MONDAY}.json: review.strongest_against.source_ids[0]`]);
          expect(brief((b) => { b.ideas[0].source_id = "b9"; })[0]!.message).toBe(
            `briefs/${D}.json: ideas[0].source_id cites b9, which is not in briefs/${D}.json: sources (b1, b2). Add the source or fix the id.`,
          );
        });

        it("judges the stored findings the brief does not name, and the findings of a run that has no brief", () => {
          const loose = { ...storedWorld(), findings: [...storedWorld().findings, stored("math-2026-0009", { go_deeper: ["s9"] })] };
          expect(placed(check(storedBrief(), loose))).toEqual(["SOURCE_IDS findings/math-2026-0009.json: go_deeper[0]"]);
          expect(placed(ids(publishedIn(null, { publishing: publishing(storedBrief()), world: loose })))).toEqual(["SOURCE_IDS findings/math-2026-0009.json: go_deeper[0]"]);
        });

        it("passes a data-only edition and a brief with no sources", () => {
          expect(check(storedDataOnly(D))).toEqual([]);
          expect(check(storedOn(D, quiet))).toEqual([]);
        });
      });
    }
  });
});

// ── The cases a weekday draft cannot reach (SPEC §4.12 T), on the sample editions ───────────────────

describe("the structure cases that only a Sunday or a Monday draft reaches, on the sample editions with their own inputs", () => {
  type Name = (typeof EDITION_NAMES)[number];
  const onSample = (name: Name, change: (d: Json) => void): ValidationIssue[] => run(buildDraftInput(revise(editionDraft(name), change), sampleInputs(name)));
  const contextOf = (name: Name): AgentContext => sampleInputs(name).context;

  it("fails a Sunday with a null deep dive, one on no candidate, and one whose why_today its candidate lacks, each by itself", () => {
    const candidates = contextOf("sunday").ledger_for_sunday;
    const why = editionDraft("sunday").deep_dive!.why_today;
    const lackingCandidate = candidates.find((c) => !(c.reasons as readonly string[]).includes(why))!;
    const outsider = "hum-2026-0100";
    expect(candidates.map((c) => c.id)).not.toContain(outsider);

    const none = onSample("sunday", (d) => { d.deep_dive = null; });
    expect(placed(none)).toEqual(["FORMAT_SECTIONS deep_dive"]);
    expect(none[0]!.message).toContain(`ledger_for_sunday lists ${candidates.length} candidates`);
    const stranger = onSample("sunday", (d) => { d.deep_dive.finding_id = outsider; });
    expect(placed(stranger)).toEqual(["FORMAT_SECTIONS deep_dive.finding_id"]);
    expect(stranger[0]!.message).toContain(`deep_dive is on ${outsider}, which is not one of the ${candidates.length} candidates of ledger_for_sunday`);
    const lacking = onSample("sunday", (d) => { d.deep_dive.finding_id = lackingCandidate.id; });
    expect(placed(lacking)).toEqual(["FORMAT_SECTIONS deep_dive.why_today"]);
    expect(lacking[0]!.message).toBe(`deep_dive.why_today is "${why}", but the reasons for ${lackingCandidate.id} are ${lackingCandidate.reasons.join(", ")}. Use one of them.`);
  });

  it("fails a Monday with a null remarkable finding in the full week, and one with a set remarkable finding in the empty week, each by itself", () => {
    const full = contextOf("monday").week!;
    expect(contextOf("monday-short").week!.findings).toHaveLength(0);

    const missing = onSample("monday", (d) => { d.review.remarkable = null; });
    expect(placed(missing)).toEqual(["FORMAT_SECTIONS review.remarkable"]);
    expect(missing[0]!.message).toContain(`the week has ${full.findings.length} findings`);
    const named = editionDraft("monday").review!.remarkable!.finding_id;
    const surplus = onSample("monday-short", (d) => { d.review.remarkable = { finding_id: named, note: "A made-up note." }; });
    expect(placed(surplus)).toEqual(["FORMAT_SECTIONS review.remarkable"]);
    expect(surplus[0]!.message).toBe(`review.remarkable names ${named}, but the week has no finding to name. Set remarkable to null.`);
  });

  it("fails NONE_FOUND in the full week, and finding_ids that leave out the setback or the fall, each by itself", () => {
    const week = contextOf("monday").week!;
    expect(week.setbacks).toHaveLength(1);
    expect(week.rung_changes).toHaveLength(1);
    const setback = week.setbacks[0]!;
    const fall = week.rung_changes[0]!;
    const setbackWhy = `${setback} (a setback)`;
    const fallWhy = `${fall.finding_id} (fell to ${fall.to})`;

    const none = onSample("monday", (d) => { d.review.strongest_against = { text: NONE_FOUND.en, finding_ids: [], source_ids: [] }; });
    expect(placed(none)).toEqual(["WEEK_AGAINST review.strongest_against.text"]);
    expect(none[0]!.message).toContain(`2 setbacks or falls: ${setbackWhy}, ${fallWhy}`);
    const noSetback = onSample("monday", (d) => { d.review.strongest_against.finding_ids = [fall.finding_id]; });
    expect(placed(noSetback)).toEqual(["WEEK_AGAINST review.strongest_against.finding_ids"]);
    expect(noSetback[0]!.message).toBe(`strongest_against.finding_ids leaves out 1 finding of the week: ${setbackWhy}. Add its id.`);
    const noFall = onSample("monday", (d) => { d.review.strongest_against.finding_ids = [setback]; });
    expect(placed(noFall)).toEqual(["WEEK_AGAINST review.strongest_against.finding_ids"]);
    expect(noFall[0]!.message).toBe(`strongest_against.finding_ids leaves out 1 finding of the week: ${fallWhy}. Add its id.`);
  });

  it("passes the empty week's NONE_FOUND and a Monday that names its setback and its fall", () => {
    expect(onSample("monday-short", () => undefined)).toEqual([]);
    expect(onSample("monday", () => undefined)).toEqual([]);
  });
});
