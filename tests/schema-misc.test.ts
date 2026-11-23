// lib/schema/misc.ts (SPEC §4.10, §4.12): corrections, re-check's flagged records, reader reports, the archive index
// and the run's evidence file. Each schema has a valid value and a failing one for each constraint; inline data.

import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { REMOVED_BEFORE, REMOVED_TEXT, REPORT_KINDS } from "@/lib/vocab";
import {
  ARCHIVE_REFS_MAX, ArchiveEdition, ArchiveIndex, ArchiveLastCheck, ArchiveRef, ArchiveUrl, CORRECTION_TRIGGERS, CORRECTION_TYPES,
  Correction, CorrectionBase, CorrectionTarget, CorrectionTrigger, CorrectionType, CorrectionsFile, DECIDED_REPORT_STATUS,
  DecidedReportStatus, Evidence, FlaggedRecord, FlaggedRecordBase, LINK_RESULTS, LinkResult, REPORT_DECIDERS, REPORT_STATUS,
  Report, ReportBase, ReportDecider, ReportStatus, ReportsFile, SAFETY_FLAG_CODES, SafetyFlagCode, hasOneTarget,
} from "@/lib/schema/misc";
import type {
  ArchiveIndex as ArchiveIndexType, Correction as CorrectionT, FlaggedRecord as FlaggedRecordT, Report as ReportT,
} from "@/lib/schema/misc";
import { expectIssue, expectMutationFails, expectOnlyIssue, expectValid, issuesOf } from "./helpers/zod-issues";

const l = (en: string) => ({ en, zh: null });
const both = (en: string, zh: string) => ({ en, zh });
const sha = "b".repeat(64);

const correction = () => ({
  id: "C-0001",
  date: "2026-11-24",
  finding_id: "bio-2026-0001",
  edition_date: null,
  term_id: null,
  type: "clarification",
  path: "explainer.how_sure",
  before: both("Checked by Example Journal.", "由範例期刊查核。"),
  after: both("Checked by Example Journal and a second lab.", "由範例期刊與另一個實驗室查核。"),
  reason: both("A second lab repeated the result.", "另一個實驗室重複了這項結果。"),
  source_url: "https://example.org/notice/1",
  trigger: "editor",
  report_id: null,
});

describe("vocabularies of this file", () => {
  it("lists the values the spec gives", () => {
    expect([...CORRECTION_TYPES]).toEqual(["correction", "clarification", "update", "removed"]);
    expect([...CORRECTION_TRIGGERS]).toEqual(["recheck", "reader_report", "editor"]);
    expect([...REPORT_STATUS]).toEqual(["open", "upheld", "rejected"]);
    expect([...DECIDED_REPORT_STATUS]).toEqual(["upheld", "rejected"]);
    expect([...REPORT_DECIDERS]).toEqual(["claude", "jl"]);
    expect([...SAFETY_FLAG_CODES]).toEqual(["DUAL_USE", "BLOCKED_HOST"]);
    expect([...LINK_RESULTS]).toEqual(["ok", "broken", "changed", "unknown"]);
    expect(ARCHIVE_REFS_MAX).toBe(20);
  });

  it("has an enum for each, accepting its values and nothing else", () => {
    const enums: [z.ZodType, readonly string[]][] = [
      [CorrectionType, CORRECTION_TYPES], [CorrectionTrigger, CORRECTION_TRIGGERS], [ReportStatus, REPORT_STATUS],
      [DecidedReportStatus, DECIDED_REPORT_STATUS], [ReportDecider, REPORT_DECIDERS], [SafetyFlagCode, SAFETY_FLAG_CODES],
      [LinkResult, LINK_RESULTS],
    ];
    for (const [schema, values] of enums) {
      for (const v of values) expectValid(schema, v);
      for (const bad of ["", "Correction", "not-a-value", null, 3]) expect(schema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });

  it("types the decided statuses as the open ones without open", () => {
    expectTypeOf<z.infer<typeof DecidedReportStatus>>().toEqualTypeOf<Exclude<z.infer<typeof ReportStatus>, "open">>();
    expectTypeOf<ReportT["decided_by"]>().toEqualTypeOf<"claude" | "jl" | null>();
    expectTypeOf<CorrectionT["report_id"]>().toEqualTypeOf<string | null>();
    expectTypeOf<ArchiveIndexType["editions"][number]["edition"]>().toEqualTypeOf<"full" | "partial" | "data_only">();
  });
});

describe("hasOneTarget and CorrectionTarget", () => {
  it("counts exactly one non-null key", () => {
    expect(hasOneTarget({ finding_id: "bio-2026-0001", edition_date: null, term_id: null })).toBe(true);
    expect(hasOneTarget({ finding_id: null, edition_date: "2026-11-24", term_id: null })).toBe(true);
    expect(hasOneTarget({ finding_id: null, edition_date: null, term_id: "crispr" })).toBe(true);
    expect(hasOneTarget({ finding_id: null, edition_date: null, term_id: null })).toBe(false);
    expect(hasOneTarget({ finding_id: "bio-2026-0001", edition_date: "2026-11-24", term_id: null })).toBe(false);
    expect(hasOneTarget({ finding_id: "bio-2026-0001", edition_date: "2026-11-24", term_id: "crispr" })).toBe(false);
  });

  it("names the three keys in the spec's order, each nullable and formatted", () => {
    expect(Object.keys(CorrectionTarget)).toEqual(["finding_id", "edition_date", "term_id"]);
    expectValid(CorrectionTarget.finding_id, null);
    expectValid(CorrectionTarget.edition_date, null);
    expectValid(CorrectionTarget.term_id, null);
    expect(CorrectionTarget.finding_id.safeParse("bio-2026-1").success).toBe(false);
    expect(CorrectionTarget.edition_date.safeParse("2026-02-30").success).toBe(false);
    expect(CorrectionTarget.term_id.safeParse("Protein Folding").success).toBe(false);
  });
});

describe("Correction", () => {
  it("accepts a correction of a finding, of an edition and of a glossary term", () => {
    expectValid(Correction, correction());
    expectValid(CorrectionBase, correction());
    expectValid(Correction, { ...correction(), finding_id: null, edition_date: "2026-11-23", path: "lead.0.text" });
    expectValid(Correction, { ...correction(), finding_id: null, term_id: "protein-folding", path: "definition" });
  });

  it("keeps the keys in the spec's order", () => {
    const keys = ["id", "date", "finding_id", "edition_date", "term_id", "type", "path", "before", "after", "reason", "source_url", "trigger", "report_id"];
    expect(Object.keys(Correction.shape)).toEqual(keys);
    expect(Object.keys(Correction.parse(Object.fromEntries(Object.entries(correction()).reverse())))).toEqual(keys);
  });

  it("needs every key and refuses null where the spec has none", () => {
    for (const key of Object.keys(correction())) expectMutationFails(Correction, correction(), (c) => delete c[key], key);
    for (const key of ["id", "date", "type", "path", "before", "after", "reason", "trigger"]) {
      expectMutationFails(Correction, correction(), (c) => { c[key] = null; }, key);
    }
    expectValid(Correction, { ...correction(), source_url: null });
  });

  it("refuses an unknown key, also inside the L10n strings", () => {
    expectMutationFails(Correction, correction(), (c) => { c.extra = 1; }, "", "Unrecognized key");
    for (const key of ["before", "after", "reason"]) {
      expectMutationFails(Correction, correction(), (c) => { c[key].extra = 1; }, key, "Unrecognized key");
    }
  });

  it("names exactly one record", () => {
    expectMutationFails(Correction, correction(), (c) => { c.finding_id = null; }, "", "Exactly one");
    expectMutationFails(Correction, correction(), (c) => { c.edition_date = "2026-11-23"; }, "", "Exactly one");
    expectMutationFails(Correction, correction(), (c) => { c.term_id = "crispr"; }, "", "Exactly one");
    expectMutationFails(Correction, correction(), (c) => { c.edition_date = "2026-11-23"; c.term_id = "crispr"; }, "", "Exactly one");
  });

  it("has a report_id exactly when the trigger is reader_report", () => {
    const answering = { ...correction(), trigger: "reader_report", report_id: "R-0007" };
    expectValid(Correction, answering);
    expectMutationFails(Correction, answering, (c) => { c.report_id = null; }, "report_id", "exactly when its trigger");
    for (const trigger of ["editor", "recheck"]) {
      expectMutationFails(Correction, correction(), (c) => { c.trigger = trigger; c.report_id = "R-0007"; }, "report_id", "exactly when its trigger");
      expectValid(Correction, { ...correction(), trigger });
    }
  });

  it("holds the id, date, type, path, trigger and report id formats", () => {
    expectMutationFails(Correction, correction(), (c) => { c.id = "C-1"; }, "id");
    expectMutationFails(Correction, correction(), (c) => { c.id = "R-0001"; }, "id");
    expectMutationFails(Correction, correction(), (c) => { c.date = "2026-13-01"; }, "date");
    expectMutationFails(Correction, correction(), (c) => { c.finding_id = "bio-2026-1"; }, "finding_id");
    expectMutationFails(Correction, { ...correction(), finding_id: null, edition_date: "2026-11-23" }, (c) => { c.edition_date = "yesterday"; }, "edition_date");
    expectMutationFails(Correction, { ...correction(), finding_id: null, term_id: "crispr" }, (c) => { c.term_id = "CRISPR"; }, "term_id");
    expectMutationFails(Correction, correction(), (c) => { c.type = "retraction"; }, "type");
    expectMutationFails(Correction, correction(), (c) => { c.trigger = "reader"; }, "trigger");
    expectMutationFails(Correction, { ...correction(), trigger: "reader_report", report_id: "R-0007" }, (c) => { c.report_id = "R-7"; }, "report_id");
    for (const type of CORRECTION_TYPES) expectValid(Correction, { ...correction(), type });
  });

  it("holds a path as a dotted key of at most 60 characters", () => {
    for (const path of ["Title", "explainer.", ".title", "explainer..how", "a".repeat(61), ""]) {
      expectMutationFails(Correction, correction(), (c) => { c.path = path; }, "path");
    }
    for (const path of ["title", "lead.1.text", "sources.0.url", "a".repeat(60)]) expectValid(Correction, { ...correction(), path });
  });

  it("takes L10n strings, never plain ones or empty ones", () => {
    for (const key of ["before", "after", "reason"]) {
      expectMutationFails(Correction, correction(), (c) => { c[key] = "plain"; }, key);
      expectMutationFails(Correction, correction(), (c) => { c[key] = { en: "only English" }; }, `${key}.zh`);
      expectMutationFails(Correction, correction(), (c) => { c[key].en = ""; }, `${key}.en`);
      expectMutationFails(Correction, correction(), (c) => { c[key].zh = ""; }, `${key}.zh`);
      expectValid(Correction, { ...correction(), [key]: l("An English-only edition's text.") });
    }
  });

  it("holds the source URL as a plain string, so a removed correction keeps whatever the record then held", () => {
    expectMutationFails(Correction, correction(), (c) => { c.source_url = ""; }, "source_url");
    expectValid(Correction, { ...correction(), source_url: REMOVED_TEXT.en });
    expectValid(Correction, {
      ...correction(), type: "removed", path: "explainer.how_sure", before: both(REMOVED_BEFORE.en, REMOVED_BEFORE.zh),
      after: both(REMOVED_TEXT.en, REMOVED_TEXT.zh), source_url: null, trigger: "recheck",
    });
  });

  it("keeps .pick() available on the unrefined base only", () => {
    const Picked = CorrectionBase.pick({ id: true, type: true });
    expectValid(Picked, { id: "C-0001", type: "update" });
    expect(() => (Correction as unknown as z.ZodObject<z.ZodRawShape>).pick({ id: true })).toThrow();
  });
});

describe("CorrectionsFile", () => {
  const file = () => ({
    schema_version: 1,
    corrections: [correction(), { ...correction(), id: "C-0002", finding_id: null, term_id: "protein-folding", path: "definition" }],
  });

  it("holds the corrections in a list, which may be empty", () => {
    expectValid(CorrectionsFile, file());
    expectValid(CorrectionsFile, { schema_version: 1, corrections: [] });
    expect(Object.keys(CorrectionsFile.shape)).toEqual(["schema_version", "corrections"]);
  });

  it("is at schema version 1 with no other key", () => {
    expectMutationFails(CorrectionsFile, file(), (f) => { f.schema_version = 2; }, "schema_version");
    expectMutationFails(CorrectionsFile, file(), (f) => { delete f.corrections; }, "corrections");
    expectMutationFails(CorrectionsFile, file(), (f) => { f.corrections = null; }, "corrections");
    expectMutationFails(CorrectionsFile, file(), (f) => { f.extra = 1; }, "", "Unrecognized key");
  });

  it("judges each correction by the correction rules, naming its place in the list", () => {
    expectMutationFails(CorrectionsFile, file(), (f) => { f.corrections[1].term_id = null; }, "corrections.1", "Exactly one");
    expectMutationFails(CorrectionsFile, file(), (f) => { f.corrections[0].id = "C-1"; }, "corrections.0.id");
    expectMutationFails(CorrectionsFile, file(), (f) => { f.corrections[0].trigger = "reader_report"; }, "corrections.0.report_id");
  });
});

describe("FlaggedRecord", () => {
  const flagged = () => ({ finding_id: "bio-2026-0001", edition_date: null, term_id: null, path: "explainer.found", code: "DUAL_USE" });

  it("names a finding, an edition or a term with a path and a safety code", () => {
    expectValid(FlaggedRecord, flagged());
    expectValid(FlaggedRecordBase, flagged());
    expectValid(FlaggedRecord, { ...flagged(), finding_id: null, edition_date: "2026-11-23", path: "lead.0.text", code: "BLOCKED_HOST" });
    expectValid(FlaggedRecord, { ...flagged(), finding_id: null, term_id: "crispr", path: "definition" });
    expect(Object.keys(FlaggedRecord.shape)).toEqual(["finding_id", "edition_date", "term_id", "path", "code"]);
  });

  it("needs every key, refuses null where the spec has none and an unknown key", () => {
    for (const key of Object.keys(flagged())) expectMutationFails(FlaggedRecord, flagged(), (f) => delete f[key], key);
    for (const key of ["path", "code"]) expectMutationFails(FlaggedRecord, flagged(), (f) => { f[key] = null; }, key);
    expectMutationFails(FlaggedRecord, flagged(), (f) => { f.extra = 1; }, "", "Unrecognized key");
  });

  it("names exactly one record", () => {
    expectMutationFails(FlaggedRecord, flagged(), (f) => { f.finding_id = null; }, "", "Exactly one");
    expectMutationFails(FlaggedRecord, flagged(), (f) => { f.term_id = "crispr"; }, "", "Exactly one");
  });

  it("takes only the safety codes, a dotted path and formatted ids", () => {
    expectMutationFails(FlaggedRecord, flagged(), (f) => { f.code = "WORDS"; }, "code");
    expectMutationFails(FlaggedRecord, flagged(), (f) => { f.code = "dual_use"; }, "code");
    expectMutationFails(FlaggedRecord, flagged(), (f) => { f.path = "Explainer"; }, "path");
    expectMutationFails(FlaggedRecord, flagged(), (f) => { f.path = "a".repeat(61); }, "path");
    expectMutationFails(FlaggedRecord, flagged(), (f) => { f.finding_id = "bio-26-1"; }, "finding_id");
  });

  it("keeps .pick() available on the unrefined base only", () => {
    expectValid(FlaggedRecordBase.pick({ path: true, code: true }), { path: "title", code: "DUAL_USE" });
    expect(() => (FlaggedRecord as unknown as z.ZodObject<z.ZodRawShape>).pick({ path: true })).toThrow();
    expectTypeOf<FlaggedRecordT["code"]>().toEqualTypeOf<"DUAL_USE" | "BLOCKED_HOST">();
  });
});

describe("Report", () => {
  const open = () => ({
    id: "R-0001",
    received: "2026-11-23T10:15:00+08:00",
    issue_number: 12,
    finding_id: "bio-2026-0001",
    kind: "fact",
    evidence_url: "https://example.org/evidence",
    status: "open",
    decided_by: null,
    resolved_on: null,
    reason: null,
    correction_id: null,
  });
  const upheld = () => ({
    ...open(), status: "upheld", decided_by: "claude", resolved_on: "2026-11-24",
    reason: both("The paper gives 12, not 21.", "論文寫的是 12，不是 21。"), correction_id: "C-0001",
  });
  const rejected = () => ({ ...upheld(), status: "rejected", correction_id: null, reason: l("The source does say this.") });
  const closedByJl = (status: "upheld" | "rejected") => ({ ...open(), status, decided_by: "jl", resolved_on: "2026-11-24" });

  it("accepts an open report and each way a report ends", () => {
    expectValid(Report, open());
    expectValid(ReportBase, open());
    expectValid(Report, upheld());
    expectValid(Report, rejected());
    expectValid(Report, closedByJl("upheld"));
    expectValid(Report, closedByJl("rejected"));
    expectValid(Report, { ...open(), evidence_url: null });
  });

  it("keeps the keys in the spec's order, and needs all of them", () => {
    const keys = ["id", "received", "issue_number", "finding_id", "kind", "evidence_url", "status", "decided_by", "resolved_on", "reason", "correction_id"];
    expect(Object.keys(Report.shape)).toEqual(keys);
    for (const key of keys) expectMutationFails(Report, open(), (r) => delete r[key], key);
    expectMutationFails(Report, open(), (r) => { r.extra = 1; }, "", "Unrecognized key");
  });

  it("refuses null where the spec has none", () => {
    for (const key of ["id", "received", "issue_number", "finding_id", "kind", "status"]) {
      expectMutationFails(Report, open(), (r) => { r[key] = null; }, key);
    }
  });

  it("holds the formats of the id, the time, the issue number, the finding and the evidence", () => {
    expectMutationFails(Report, open(), (r) => { r.id = "R-1"; }, "id");
    expectMutationFails(Report, open(), (r) => { r.id = "C-0001"; }, "id");
    expectMutationFails(Report, open(), (r) => { r.received = "2026-11-23"; }, "received");
    expectMutationFails(Report, open(), (r) => { r.received = "2026-11-23T10:15:00"; }, "received");
    for (const n of [0, -3, 1.5, "12"]) expectMutationFails(Report, open(), (r) => { r.issue_number = n; }, "issue_number");
    expectMutationFails(Report, open(), (r) => { r.finding_id = "bio-2026-1"; }, "finding_id");
    expectMutationFails(Report, open(), (r) => { r.evidence_url = ""; }, "evidence_url");
    expectMutationFails(Report, open(), (r) => { r.evidence_url = `https://example.org/${"x".repeat(500)}`; }, "evidence_url");
    expectValid(Report, { ...open(), evidence_url: `https://example.org/${"x".repeat(470)}` });
  });

  it("takes only the report kinds, statuses and deciders of the spec", () => {
    for (const kind of REPORT_KINDS) expectValid(Report, { ...open(), kind });
    expectMutationFails(Report, open(), (r) => { r.kind = "typo"; }, "kind");
    expectMutationFails(Report, open(), (r) => { r.status = "closed"; }, "status");
    expectMutationFails(Report, upheld(), (r) => { r.decided_by = "codex"; }, "decided_by");
    expectMutationFails(Report, upheld(), (r) => { r.decided_by = "Claude"; }, "decided_by");
  });

  it("leaves an open report undecided", () => {
    expectMutationFails(Report, open(), (r) => { r.decided_by = "claude"; }, "decided_by", "no decider");
    expectMutationFails(Report, open(), (r) => { r.resolved_on = "2026-11-24"; }, "resolved_on", "no resolved_on");
    expectMutationFails(Report, open(), (r) => { r.reason = l("A reason."); }, "reason", "no reason");
    expectMutationFails(Report, open(), (r) => { r.correction_id = "C-0001"; }, "correction_id", "no correction");
  });

  it("gives a decided report its decider and its date", () => {
    for (const make of [upheld, rejected]) {
      expectMutationFails(Report, make(), (r) => { r.decided_by = null; }, "decided_by", "says who decided");
      expectMutationFails(Report, make(), (r) => { r.resolved_on = null; }, "resolved_on", "the date it was decided");
    }
    expectMutationFails(Report, upheld(), (r) => { r.resolved_on = "2026-02-30"; }, "resolved_on");
  });

  it("gives a rejected report no correction", () => {
    expectMutationFails(Report, rejected(), (r) => { r.correction_id = "C-0001"; }, "correction_id", "rejected report has no correction");
    expectMutationFails(Report, closedByJl("rejected"), (r) => { r.correction_id = "C-0001"; }, "correction_id");
    expectMutationFails(Report, upheld(), (r) => { r.correction_id = "C-1"; }, "correction_id");
    expectValid(Report, { ...upheld(), correction_id: null });
  });

  it("gives the agent's decision its reason and JL's close none", () => {
    for (const make of [upheld, rejected]) {
      expectMutationFails(Report, make(), (r) => { r.reason = null; }, "reason", "has its reason");
    }
    for (const status of ["upheld", "rejected"] as const) {
      expectMutationFails(Report, closedByJl(status), (r) => { r.reason = l("A reason."); }, "reason", "has no reason");
    }
  });

  it("takes a reason as an L10n", () => {
    expectMutationFails(Report, upheld(), (r) => { r.reason = "plain"; }, "reason");
    expectMutationFails(Report, upheld(), (r) => { r.reason.en = ""; }, "reason.en");
    expectMutationFails(Report, upheld(), (r) => { r.reason.extra = 1; }, "reason", "Unrecognized key");
  });

  it("keeps .pick() available on the unrefined base only", () => {
    expectValid(ReportBase.pick({ id: true, kind: true }), { id: "R-0001", kind: "link" });
    expect(() => (Report as unknown as z.ZodObject<z.ZodRawShape>).pick({ id: true })).toThrow();
  });

  it("reports every inconsistency of a record at once, never throws", () => {
    const found = issuesOf(Report, { ...open(), decided_by: "jl", resolved_on: "2026-11-24", reason: l("x"), correction_id: "C-0001" });
    expect(found.map((i) => i.path).sort()).toEqual(["correction_id", "decided_by", "reason", "resolved_on"]);
  });
});

describe("ReportsFile", () => {
  const report = () => ({
    id: "R-0001", received: "2026-11-23T10:15:00+08:00", issue_number: 12, finding_id: "bio-2026-0001", kind: "link",
    evidence_url: null, status: "open", decided_by: null, resolved_on: null, reason: null, correction_id: null,
  });

  it("holds the reports in a list, which may be empty", () => {
    expectValid(ReportsFile, { schema_version: 1, reports: [report(), { ...report(), id: "R-0002", issue_number: 13 }] });
    expectValid(ReportsFile, { schema_version: 1, reports: [] });
    expect(Object.keys(ReportsFile.shape)).toEqual(["schema_version", "reports"]);
  });

  it("is at schema version 1 with no other key, and judges each report", () => {
    const file = { schema_version: 1, reports: [report()] };
    expectMutationFails(ReportsFile, file, (f) => { f.schema_version = 0; }, "schema_version");
    expectMutationFails(ReportsFile, file, (f) => { delete f.reports; }, "reports");
    expectMutationFails(ReportsFile, file, (f) => { f.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(ReportsFile, file, (f) => { f.reports[0].status = "upheld"; }, "reports.0.decided_by", "says who decided");
    expectMutationFails(ReportsFile, file, (f) => { f.reports[0].issue_number = 0; }, "reports.0.issue_number");
  });
});

describe("ArchiveRef", () => {
  it("is a finding id or the brief-level text of an edition", () => {
    for (const ref of ["math-2026-0142", "hum-2015-0001", "2026-11-23/brief", "2026-02-28/brief"]) expectValid(ArchiveRef, ref);
  });

  it("refuses anything else, and a date that is not on the calendar", () => {
    for (const ref of ["", "brief", "bio-2026-1", "BIO-2026-0001", "2026-11-23", "2026-11-23/", "2026-11-23/Brief", "2026-11-23/brief/", "x2026-11-23/brief", "bio-2026-0001/brief", "s1"]) {
      expect(ArchiveRef.safeParse(ref).success, JSON.stringify(ref)).toBe(false);
    }
    expectIssue(ArchiveRef, "2026-02-30/brief", "", "real calendar date");
    expectIssue(ArchiveRef, "2026-13-01/brief", "", "real calendar date");
    expectIssue(ArchiveRef, "bio-2026-1", "", "math-2026-0142");
    // a ref that is no ref at all has the one shape issue, however it ends
    for (const bad of ["zzzz/brief", "bio-2026-1/brief", "2026-11-2/brief", "x2026-11-23/brief"]) expectOnlyIssue(ArchiveRef, bad, "", "math-2026-0142");
    for (const bad of [null, 7, ["bio-2026-0001"]]) expect(ArchiveRef.safeParse(bad).success).toBe(false);
  });
});

describe("ArchiveEdition and ArchiveLastCheck", () => {
  const edition = () => ({ date: "2026-11-23", edition: "full", published_at: "2026-11-23T04:12:00+08:00", finding_count: 5, corrected: false });

  it("accepts an edition entry in each edition kind", () => {
    expectValid(ArchiveEdition, edition());
    for (const kind of ["full", "partial", "data_only"]) expectValid(ArchiveEdition, { ...edition(), edition: kind });
    expect(Object.keys(ArchiveEdition.shape)).toEqual(["date", "edition", "published_at", "finding_count", "corrected"]);
    expectValid(ArchiveEdition, { ...edition(), finding_count: 0, corrected: true });
  });

  it("needs every key, refuses null, an unknown key and a bad value", () => {
    for (const key of Object.keys(edition())) {
      expectMutationFails(ArchiveEdition, edition(), (e) => delete e[key], key);
      expectMutationFails(ArchiveEdition, edition(), (e) => { e[key] = null; }, key);
    }
    expectMutationFails(ArchiveEdition, edition(), (e) => { e.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(ArchiveEdition, edition(), (e) => { e.edition = "english_only"; }, "edition");
    expectMutationFails(ArchiveEdition, edition(), (e) => { e.date = "2026-02-30"; }, "date");
    expectMutationFails(ArchiveEdition, edition(), (e) => { e.published_at = "2026-11-23"; }, "published_at");
    expectMutationFails(ArchiveEdition, edition(), (e) => { e.finding_count = -1; }, "finding_count");
    expectMutationFails(ArchiveEdition, edition(), (e) => { e.finding_count = 2.5; }, "finding_count");
    expectMutationFails(ArchiveEdition, edition(), (e) => { e.corrected = "no"; }, "corrected");
  });

  it("ArchiveLastCheck holds a date, a result and the HTTP status or null", () => {
    expectValid(ArchiveLastCheck, { date: "2026-11-23", result: "ok", http: 200 });
    expectValid(ArchiveLastCheck, { date: "2026-11-23", result: "unknown", http: null });
    for (const result of LINK_RESULTS) expectValid(ArchiveLastCheck, { date: "2026-11-23", result, http: null });
    expect(Object.keys(ArchiveLastCheck.shape)).toEqual(["date", "result", "http"]);
    const base = { date: "2026-11-23", result: "ok", http: 200 };
    expectMutationFails(ArchiveLastCheck, base, (c) => { c.result = "gone"; }, "result");
    expectMutationFails(ArchiveLastCheck, base, (c) => { c.http = 99; }, "http");
    expectMutationFails(ArchiveLastCheck, base, (c) => { c.http = 600; }, "http");
    expectMutationFails(ArchiveLastCheck, base, (c) => { c.http = 200.5; }, "http");
    expectMutationFails(ArchiveLastCheck, base, (c) => { delete c.http; }, "http");
    expectMutationFails(ArchiveLastCheck, base, (c) => { c.date = null; }, "date");
    expectMutationFails(ArchiveLastCheck, base, (c) => { c.extra = 1; }, "", "Unrecognized key");
  });
});

describe("ArchiveUrl", () => {
  const url = () => ({
    first_cited: "2026-11-23",
    refs: ["bio-2026-0001", "2026-11-23/brief"],
    sha256: sha,
    hashed_at: "2026-11-23T04:05:00+08:00",
    last_check: { date: "2026-11-24", result: "ok", http: 200 },
  });

  it("accepts a hashed and checked URL, and one not yet hashed or checked", () => {
    expectValid(ArchiveUrl, url());
    expectValid(ArchiveUrl, { ...url(), sha256: null, hashed_at: null, last_check: null });
    expectValid(ArchiveUrl, { ...url(), last_check: null });
    expectValid(ArchiveUrl, { ...url(), refs: [] });
  });

  it("needs every key, refuses an unknown key, and refuses null where the spec has none", () => {
    for (const key of Object.keys(url())) expectMutationFails(ArchiveUrl, url(), (u) => delete u[key], key);
    expectMutationFails(ArchiveUrl, url(), (u) => { u.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(ArchiveUrl, url(), (u) => { u.first_cited = null; }, "first_cited");
    expectMutationFails(ArchiveUrl, url(), (u) => { u.refs = null; }, "refs");
    expect(Object.keys(ArchiveUrl.shape)).toEqual(["first_cited", "refs", "sha256", "hashed_at", "last_check"]);
    expect(Object.keys(ArchiveUrl.parse(Object.fromEntries(Object.entries(url()).reverse())))).toEqual(Object.keys(ArchiveUrl.shape));
  });

  it("allows at most 20 refs, each once, each a finding id or an edition's brief", () => {
    const refsOf = (n: number) => Array.from({ length: n }, (_, i) => `bio-2026-${String(i + 1).padStart(4, "0")}`);
    expectValid(ArchiveUrl, { ...url(), refs: refsOf(ARCHIVE_REFS_MAX) });
    expectMutationFails(ArchiveUrl, url(), (u) => { u.refs = refsOf(ARCHIVE_REFS_MAX + 1); }, "refs", "At most 20");
    expectMutationFails(ArchiveUrl, url(), (u) => { u.refs = ["bio-2026-0001", "bio-2026-0001"]; }, "refs", "must not repeat");
    expectMutationFails(ArchiveUrl, url(), (u) => { u.refs = ["s1"]; }, "refs.0");
    expectMutationFails(ArchiveUrl, url(), (u) => { u.refs = ["2026-02-30/brief"]; }, "refs.0", "real calendar date");
  });

  it("sets the hash and the time it was read together, or neither", () => {
    expectMutationFails(ArchiveUrl, url(), (u) => { u.hashed_at = null; }, "hashed_at", "both set or both null");
    expectMutationFails(ArchiveUrl, url(), (u) => { u.sha256 = null; }, "hashed_at", "both set or both null");
  });

  it("holds the hash as 64 lower-case hex characters and the time as a timestamp", () => {
    for (const bad of [sha.slice(1), sha.toUpperCase(), `${sha}0`, "z".repeat(64), ""]) {
      expectMutationFails(ArchiveUrl, url(), (u) => { u.sha256 = bad; }, "sha256");
    }
    expectMutationFails(ArchiveUrl, url(), (u) => { u.hashed_at = "2026-11-23"; }, "hashed_at");
    expectMutationFails(ArchiveUrl, url(), (u) => { u.first_cited = "2026-02-30"; }, "first_cited");
  });

  it("judges its last check by the last-check schema", () => {
    expectMutationFails(ArchiveUrl, url(), (u) => { u.last_check.result = "gone"; }, "last_check.result");
    expectMutationFails(ArchiveUrl, url(), (u) => { u.last_check.http = 700; }, "last_check.http");
    expectMutationFails(ArchiveUrl, url(), (u) => { u.last_check.extra = 1; }, "last_check", "Unrecognized key");
  });
});

describe("ArchiveIndex", () => {
  const entry = (date: string) => ({ date, edition: "full", published_at: `${date}T04:12:00+08:00`, finding_count: 3, corrected: false });
  const url = () => ({ first_cited: "2026-11-23", refs: ["bio-2026-0001"], sha256: sha, hashed_at: "2026-11-23T04:05:00+08:00", last_check: null });
  const index = () => ({
    schema_version: 1,
    editions: [entry("2026-11-25"), entry("2026-11-24"), entry("2026-11-23")],
    urls: { "https://example.org/paper/1": url(), "https://example.org/paper/2": { ...url(), refs: ["2026-11-23/brief"], sha256: null, hashed_at: null } },
  });

  it("holds the editions newest first and the URLs keyed by address", () => {
    expectValid(ArchiveIndex, index());
    expectValid(ArchiveIndex, { schema_version: 1, editions: [], urls: {} });
    expectValid(ArchiveIndex, { ...index(), editions: [entry("2026-11-23")] });
    expect(Object.keys(ArchiveIndex.shape)).toEqual(["schema_version", "editions", "urls"]);
  });

  it("refuses editions out of order or with a date twice", () => {
    expectMutationFails(ArchiveIndex, index(), (a) => { a.editions.reverse(); }, "editions.1.date", "newest first");
    expectMutationFails(ArchiveIndex, index(), (a) => { a.editions[1].date = "2026-11-25"; }, "editions.1.date", "one per date");
    expectMutationFails(ArchiveIndex, index(), (a) => { a.editions[2].date = "2026-11-26"; }, "editions.2.date");
  });

  it("is at schema version 1 with no other key", () => {
    expectMutationFails(ArchiveIndex, index(), (a) => { a.schema_version = 2; }, "schema_version");
    expectMutationFails(ArchiveIndex, index(), (a) => { delete a.editions; }, "editions");
    expectMutationFails(ArchiveIndex, index(), (a) => { delete a.urls; }, "urls");
    expectMutationFails(ArchiveIndex, index(), (a) => { a.extra = 1; }, "", "Unrecognized key");
  });

  it("judges each edition and each URL, naming its place", () => {
    expectMutationFails(ArchiveIndex, index(), (a) => { a.editions[0].edition = "english_only"; }, "editions.0.edition");
    expectMutationFails(ArchiveIndex, index(), (a) => { a.urls["https://example.org/paper/1"].refs = ["s1"]; }, "urls.https://example.org/paper/1.refs.0");
    expectMutationFails(ArchiveIndex, index(), (a) => { a.urls["https://example.org/paper/1"].hashed_at = null; }, "urls.https://example.org/paper/1.hashed_at");
    expectMutationFails(ArchiveIndex, index(), (a) => { a.urls["https://example.org/paper/2"] = 1; }, "urls.https://example.org/paper/2");
  });

  it("refuses an empty address as a key, and a list in place of the keyed record", () => {
    expectMutationFails(ArchiveIndex, index(), (a) => { a.urls[""] = url(); }, "urls.");
    expectMutationFails(ArchiveIndex, index(), (a) => { a.urls = []; }, "urls");
  });
});

describe("Evidence", () => {
  const evidence = () => ({
    urls: ["https://example.org/paper/1"],
    fetched: ["https://example.org/paper/1"],
    texts: { "https://example.org/paper/1": "The system solved the problem." },
    seen_as: { "https://example.org/paper/1": "fetched" },
    types: { "https://example.org/paper/1": ["research-article"] },
    resolved: { "https://doi.org/10.1234/example.1": "https://example.org/paper/1" },
  });

  it("accepts the run's evidence, and an empty one", () => {
    expectValid(Evidence, evidence());
    expectValid(Evidence, { urls: [], fetched: [], texts: {}, seen_as: {}, types: {}, resolved: {} });
    expect(Object.keys(Evidence.shape)).toEqual(["urls", "fetched", "texts", "seen_as", "types", "resolved"]);
  });

  it("needs every key, refuses null and an unknown key", () => {
    for (const key of Object.keys(evidence())) {
      expectMutationFails(Evidence, evidence(), (e) => delete e[key], key);
      expectMutationFails(Evidence, evidence(), (e) => { e[key] = null; }, key);
    }
    expectMutationFails(Evidence, evidence(), (e) => { e.extra = 1; }, "", "Unrecognized key");
  });

  it("types each part", () => {
    expectMutationFails(Evidence, evidence(), (e) => { e.urls = "https://example.org"; }, "urls");
    expectMutationFails(Evidence, evidence(), (e) => { e.fetched = [1]; }, "fetched.0");
    expectMutationFails(Evidence, evidence(), (e) => { e.texts["https://example.org/paper/1"] = 5; }, "texts.https://example.org/paper/1");
    expectMutationFails(Evidence, evidence(), (e) => { e.seen_as["https://example.org/paper/1"] = "guessed"; }, "seen_as.https://example.org/paper/1");
    expectMutationFails(Evidence, evidence(), (e) => { e.types["https://example.org/paper/1"] = "research-article"; }, "types.https://example.org/paper/1");
    expectMutationFails(Evidence, evidence(), (e) => { e.types["https://example.org/paper/1"] = [3]; }, "types.https://example.org/paper/1.0");
    expectMutationFails(Evidence, evidence(), (e) => { e.resolved["https://doi.org/10.1234/example.1"] = null; }, "resolved.https://doi.org/10.1234/example.1");
    for (const seen of ["pack", "fetched", "search", "seed"]) {
      expectValid(Evidence, { ...evidence(), seen_as: { "https://example.org/paper/1": seen } });
    }
    expectOnlyIssue(Evidence, { ...evidence(), urls: [3] }, "urls.0");
  });
});

describe("the stored files as JSON Schema", () => {
  it("can be written out, since none of them holds a type JSON Schema lacks", () => {
    for (const schema of [CorrectionsFile, ReportsFile, ArchiveIndex, Evidence, CorrectionBase, ReportBase]) {
      const json = z.toJSONSchema(schema) as { type?: string; additionalProperties?: unknown };
      expect(json.type).toBe("object");
      expect(json.additionalProperties).toBe(false);
    }
  });
});
