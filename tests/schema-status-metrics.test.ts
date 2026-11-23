// lib/schema/status.ts (SPEC §4.8) and lib/schema/metrics.ts (SPEC §4.7): the status file, the metrics file with its
// inputs manifest, and the weekly Pace state. Each schema has a valid value and a failing one for each constraint;
// inline data.

import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { FIELDS } from "@/lib/vocab";
import {
  COUNTER_KINDS, ConfigVersions, CounterBreakdownRow, CounterInput, CounterKind, CounterReading, CounterReadingBase, Hold,
  InputsManifest, LandmarkBaseline, LandmarkYear, Landmarks, MetricsFile, OPENALEX_REQUESTS, OpenAlexRequest, OpenAlexRequestKind,
  PACE_BASELINE, PaceBlock, PaceBlockBase, PaceCell, PaceSet, PaceVersions, PaceWeek, PaceWeeklyFile, RequestRecord, Share, ShareBase,
  VS_BASELINE, VS_YEAR_AGO, VsBaseline, VsYearAgo,
} from "@/lib/schema/metrics";
import type { MetricsFile as MetricsFileT, PaceWeeklyFile as PaceWeeklyFileT } from "@/lib/schema/metrics";
import {
  FEED_STATUS, FeedRecord, FeedStatus, LinkCheck, RUN_OUTCOMES, RUN_STAGES, RUN_TRIGGERS, Recheck, RunOutcome, RunRecord,
  RunStage, RunTrigger, STAGE_STATUS, StageRecord, StageStatus, StatusFile, ZH_OUTCOMES, ZhOutcome, ZhRecord,
} from "@/lib/schema/status";
import type { RunRecord as RunRecordT, StatusFile as StatusFileT } from "@/lib/schema/status";
import { copy, expectIssue, expectMutationFails, expectOnlyIssue, expectValid, issuesOf } from "./helpers/zod-issues";

const l = (en: string) => ({ en, zh: null });
const sha = "c".repeat(64);
const commit = "0123456789abcdef0123456789abcdef01234567";

// ── The status file ──────────────────────────────────────────────────────────────────────────────

const stage = (id: string, status = "ok") => ({
  id, status, started_at: "2026-11-23T03:15:30+08:00", ended_at: "2026-11-23T03:16:10+08:00", note: null,
});

const run = () => ({
  run_id: "20261123-031512",
  trigger: "schedule",
  attempt: 1,
  started_at: "2026-11-23T03:15:12+08:00",
  finished_at: "2026-11-23T04:08:40+08:00",
  outcome: "published_full",
  edition: "full",
  error_code: null,
  code_commit: commit,
  pace_status: "ok",
  data_only_published_at: "2026-11-23T03:34:00+08:00",
  full_published_at: "2026-11-23T04:08:00+08:00",
  late: false,
  stages: RUN_STAGES.map((id) => stage(id)),
  feeds: [{
    id: "openalex", status: "ok", newest: "2026-11-22T20:00:00Z", checked_at: "2026-11-23T03:15:40+08:00", stale_since: null, records: 120, note: null,
  }],
  budgets: {
    agent_seconds: 1500, zh_agent_seconds: 600, web_fetches: 40, web_searches: 12, repair_rounds: 0, tokens_in: null, tokens_out: null,
    usage: null, safety_stops: 0,
  },
  candidates: { ranked: 80, kept: 30, deep_read: 8 },
  validation: { errors: 0, warnings: 2, codes: ["WORDS", "ZH_NO_DASH"] },
  soft_gates: { checked: 30, dropped: 1, by_code: { PRIMARY_ONLY: 1 } },
  zh: { attempted: true, repair_rounds: 0, strings: 120, backlog: 3, outcome: "ok" },
  deploy: { triggered: true, ready_at: "2026-11-23T04:12:00+08:00", shows_date: "2026-11-23", shows_edition: "full" },
  recheck: { findings_checked: 40, rung_changes: 1, proposals: 0, reports_new: 0, reports_decided: 0, flagged: [] },
  links: {
    checked_at: "2026-11-23T04:20:00+08:00", checked: 25, ok: 24, unknown: 0,
    broken: [{ url: "https://example.org/x", ref: "bio-2026-0001", result: "broken", http: 404 }],
  },
});

describe("the run vocabularies", () => {
  it("list the values the spec gives, the stages in the status file's order", () => {
    expect([...RUN_STAGES]).toEqual(["preflight", "collect", "metrics", "recheck", "data_only", "draft", "validate", "zh", "publish", "deploy", "links"]);
    expect([...STAGE_STATUS]).toEqual(["ok", "degraded", "failed", "skipped"]);
    expect([...FEED_STATUS]).toEqual(["ok", "stale", "failed", "skipped"]);
    expect([...RUN_OUTCOMES]).toEqual(["published_full", "published_partial", "published_data_only", "failed", "skipped", "dry_run"]);
    expect([...RUN_TRIGGERS]).toEqual(["schedule", "retry", "manual", "dry_run"]);
    expect([...ZH_OUTCOMES]).toEqual(["ok", "failed", "skipped_late", "skipped_flag", "not_run"]);
  });

  it("have an enum each, accepting its values and nothing else", () => {
    const enums: [z.ZodType, readonly string[]][] = [
      [RunStage, RUN_STAGES], [StageStatus, STAGE_STATUS], [FeedStatus, FEED_STATUS], [RunOutcome, RUN_OUTCOMES],
      [RunTrigger, RUN_TRIGGERS], [ZhOutcome, ZH_OUTCOMES],
    ];
    for (const [schema, values] of enums) {
      for (const v of values) expectValid(schema, v);
      for (const bad of ["", "OK", "not-a-value", null, 1]) expect(schema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });

  it("type a run record as the spec does", () => {
    expectTypeOf<RunRecordT["trigger"]>().toEqualTypeOf<"schedule" | "retry" | "manual" | "dry_run">();
    expectTypeOf<RunRecordT["zh"]>().toEqualTypeOf<{ attempted: boolean; repair_rounds: number; strings: number; backlog: number; outcome: "ok" | "failed" | "skipped_late" | "skipped_flag" | "not_run" } | null>();
    expectTypeOf<RunRecordT["pace_status"]>().toEqualTypeOf<"ok" | "stale" | "missing" | null>();
    expectTypeOf<StatusFileT["schema_version"]>().toEqualTypeOf<1>();
  });
});

describe("StageRecord and FeedRecord", () => {
  it("accept a stage that ran and one that did not", () => {
    expectValid(StageRecord, stage("collect"));
    expectValid(StageRecord, { id: "zh", status: "skipped", started_at: null, ended_at: null, note: "Not run: too late to start." });
    expect(Object.keys(StageRecord.shape)).toEqual(["id", "status", "started_at", "ended_at", "note"]);
  });

  it("need every key and refuse an unknown key, a bad stage, a bad time and a note outside 1 to 200 characters", () => {
    for (const key of Object.keys(stage("collect"))) expectMutationFails(StageRecord, stage("collect"), (s) => delete s[key], key);
    expectMutationFails(StageRecord, stage("collect"), (s) => { s.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(StageRecord, stage("collect"), (s) => { s.id = "translate"; }, "id");
    expectMutationFails(StageRecord, stage("collect"), (s) => { s.status = "done"; }, "status");
    expectMutationFails(StageRecord, stage("collect"), (s) => { s.started_at = "2026-11-23"; }, "started_at");
    expectMutationFails(StageRecord, stage("collect"), (s) => { s.id = null; }, "id");
    expectMutationFails(StageRecord, stage("collect"), (s) => { s.note = ""; }, "note");
    expectMutationFails(StageRecord, stage("collect"), (s) => { s.note = "n".repeat(201); }, "note");
    expectValid(StageRecord, { ...stage("collect"), note: "n".repeat(200) });
  });

  const feed = () => run().feeds[0]!;

  it("FeedRecord holds a feed's state with the date it was last good", () => {
    expectValid(FeedRecord, feed());
    expectValid(FeedRecord, { ...feed(), status: "stale", newest: "2026-11-20", stale_since: "2026-11-21", note: "No new item for 3 days." });
    expectValid(FeedRecord, { ...feed(), newest: null, records: null });
    expect(Object.keys(FeedRecord.shape)).toEqual(["id", "status", "newest", "checked_at", "stale_since", "records", "note"]);
  });

  it("FeedRecord needs every key and refuses a bad id, status, date or count", () => {
    for (const key of Object.keys(feed())) expectMutationFails(FeedRecord, feed(), (f) => delete f[key], key);
    expectMutationFails(FeedRecord, feed(), (f) => { f.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(FeedRecord, feed(), (f) => { f.id = "OpenAlex"; }, "id");
    expectMutationFails(FeedRecord, feed(), (f) => { f.status = "late"; }, "status");
    expectMutationFails(FeedRecord, feed(), (f) => { f.newest = "yesterday"; }, "newest");
    expectMutationFails(FeedRecord, feed(), (f) => { f.checked_at = null; }, "checked_at");
    expectMutationFails(FeedRecord, feed(), (f) => { f.stale_since = "2026-02-30"; }, "stale_since");
    expectMutationFails(FeedRecord, feed(), (f) => { f.records = -1; }, "records");
    expectMutationFails(FeedRecord, feed(), (f) => { f.records = 1.5; }, "records");
  });
});

describe("ZhRecord", () => {
  const zh = () => run().zh!;

  it("accepts each way the Chinese pass ends", () => {
    for (const outcome of ZH_OUTCOMES) expectValid(ZhRecord, { ...zh(), outcome });
    expectValid(ZhRecord, { attempted: false, repair_rounds: 0, strings: 0, backlog: 0, outcome: "skipped_flag" });
    expect(Object.keys(ZhRecord.shape)).toEqual(["attempted", "repair_rounds", "strings", "backlog", "outcome"]);
  });

  it("needs every key and refuses an unknown key, a bad outcome and a bad count", () => {
    for (const key of Object.keys(zh())) {
      expectMutationFails(ZhRecord, zh(), (z0) => delete z0[key], key);
      expectMutationFails(ZhRecord, zh(), (z0) => { z0[key] = null; }, key);
    }
    expectMutationFails(ZhRecord, zh(), (z0) => { z0.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(ZhRecord, zh(), (z0) => { z0.outcome = "done"; }, "outcome");
    expectMutationFails(ZhRecord, zh(), (z0) => { z0.attempted = "yes"; }, "attempted");
    for (const key of ["repair_rounds", "strings", "backlog"]) {
      expectMutationFails(ZhRecord, zh(), (z0) => { z0[key] = -1; }, key);
      expectMutationFails(ZhRecord, zh(), (z0) => { z0[key] = 0.5; }, key);
    }
  });
});

describe("Recheck and LinkCheck", () => {
  const recheck = () => run().recheck!;
  const flagged = () => ({ finding_id: "bio-2026-0001", edition_date: null, term_id: null, path: "explainer.found", code: "DUAL_USE" });

  it("Recheck counts the rung watch and the reports, and lists the flagged records", () => {
    expectValid(Recheck, recheck());
    expectValid(Recheck, { ...recheck(), flagged: [flagged(), { ...flagged(), finding_id: null, term_id: "crispr", path: "definition", code: "BLOCKED_HOST" }] });
    expect(Object.keys(Recheck.shape)).toEqual(["findings_checked", "rung_changes", "proposals", "reports_new", "reports_decided", "flagged"]);
  });

  it("Recheck needs every key, refuses null and an unknown key, and holds each flagged record to its own rules", () => {
    for (const key of Object.keys(recheck())) {
      expectMutationFails(Recheck, recheck(), (r) => delete r[key], key);
      expectMutationFails(Recheck, recheck(), (r) => { r[key] = null; }, key);
    }
    expectMutationFails(Recheck, recheck(), (r) => { r.extra = 1; }, "", "Unrecognized key");
    for (const key of ["findings_checked", "rung_changes", "proposals", "reports_new", "reports_decided"]) {
      expectMutationFails(Recheck, recheck(), (r) => { r[key] = -1; }, key);
    }
    expectMutationFails(Recheck, { ...recheck(), flagged: [flagged()] }, (r) => { r.flagged[0].code = "WORDS"; }, "flagged.0.code");
    expectMutationFails(Recheck, { ...recheck(), flagged: [flagged()] }, (r) => { r.flagged[0].term_id = "crispr"; }, "flagged.0", "Exactly one");
    expectMutationFails(Recheck, { ...recheck(), flagged: [flagged()] }, (r) => { r.flagged[0].matched = "text"; }, "flagged.0", "Unrecognized key");
  });

  const links = () => run().links!;

  it("LinkCheck counts the URLs checked and names each broken one by the record that cites it", () => {
    expectValid(LinkCheck, links());
    expectValid(LinkCheck, { ...links(), broken: [] });
    expectValid(LinkCheck, { ...links(), broken: [{ url: "https://example.org/y", ref: "2026-11-22/brief", result: "changed", http: null }] });
    expect(Object.keys(LinkCheck.shape)).toEqual(["checked_at", "checked", "ok", "unknown", "broken"]);
  });

  it("LinkCheck needs every key and refuses an unknown key and a bad entry", () => {
    for (const key of Object.keys(links())) expectMutationFails(LinkCheck, links(), (c) => delete c[key], key);
    expectMutationFails(LinkCheck, links(), (c) => { c.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(LinkCheck, links(), (c) => { c.checked_at = "2026-11-23"; }, "checked_at");
    for (const key of ["checked", "ok", "unknown"]) expectMutationFails(LinkCheck, links(), (c) => { c[key] = -1; }, key);
    expectMutationFails(LinkCheck, links(), (c) => { c.broken[0].ref = "s1"; }, "broken.0.ref");
    expectMutationFails(LinkCheck, links(), (c) => { c.broken[0].ref = "2026-02-30/brief"; }, "broken.0.ref");
    expectMutationFails(LinkCheck, links(), (c) => { c.broken[0].result = "ok"; }, "broken.0.result");
    expectMutationFails(LinkCheck, links(), (c) => { c.broken[0].http = 99; }, "broken.0.http");
    expectMutationFails(LinkCheck, links(), (c) => { c.broken[0].http = 600; }, "broken.0.http");
    expectMutationFails(LinkCheck, links(), (c) => { c.broken[0].url = ""; }, "broken.0.url");
    expectMutationFails(LinkCheck, links(), (c) => { c.broken[0].item_id = "x"; }, "broken.0", "Unrecognized key");
    expectMutationFails(LinkCheck, links(), (c) => { delete c.broken[0].ref; }, "broken.0.ref");
  });
});

describe("RunRecord", () => {
  it("accepts a full run, and keeps the keys in the order of the record", () => {
    expectValid(RunRecord, run());
    expect(Object.keys(RunRecord.shape)).toEqual([
      "run_id", "trigger", "attempt", "started_at", "finished_at", "outcome", "edition", "error_code", "code_commit", "pace_status",
      "data_only_published_at", "full_published_at", "late", "stages", "feeds", "budgets", "candidates", "validation", "soft_gates",
      "zh", "deploy", "recheck", "links",
    ]);
    expect(Object.keys(RunRecord.parse(Object.fromEntries(Object.entries(run()).reverse())))).toEqual(Object.keys(RunRecord.shape));
  });

  it("accepts a run that failed early, with its later parts null", () => {
    expectValid(RunRecord, {
      ...run(), outcome: "failed", edition: null, error_code: "E_AUTH", pace_status: null, finished_at: null, data_only_published_at: null,
      full_published_at: null, candidates: null, validation: null, soft_gates: null, zh: null, recheck: null, links: null,
      stages: RUN_STAGES.map((id, i) => stage(id, i === 0 ? "failed" : "skipped")),
      deploy: { triggered: false, ready_at: null, shows_date: null, shows_edition: null },
    });
  });

  it("needs every key", () => {
    for (const key of Object.keys(run())) expectMutationFails(RunRecord, run(), (r) => delete r[key], key);
    expectMutationFails(RunRecord, run(), (r) => { r.extra = 1; }, "", "Unrecognized key");
  });

  it("refuses null where the spec has none", () => {
    for (const key of ["run_id", "trigger", "attempt", "started_at", "code_commit", "late", "stages", "feeds", "budgets", "deploy"]) {
      expectMutationFails(RunRecord, run(), (r) => { r[key] = null; }, key);
    }
    for (const key of [
      "finished_at", "outcome", "edition", "error_code", "pace_status", "data_only_published_at", "full_published_at", "candidates",
      "validation", "soft_gates", "zh", "recheck", "links",
    ]) expectValid(RunRecord, { ...run(), [key]: null });
  });

  it("holds the formats and the vocabularies", () => {
    expectMutationFails(RunRecord, run(), (r) => { r.run_id = "2026-11-23"; }, "run_id");
    expectMutationFails(RunRecord, run(), (r) => { r.trigger = "cron"; }, "trigger");
    expectMutationFails(RunRecord, run(), (r) => { r.attempt = 0; }, "attempt");
    expectMutationFails(RunRecord, run(), (r) => { r.attempt = 1.5; }, "attempt");
    expectMutationFails(RunRecord, run(), (r) => { r.started_at = "2026-11-23T03:15"; }, "started_at");
    expectMutationFails(RunRecord, run(), (r) => { r.outcome = "published"; }, "outcome");
    expectMutationFails(RunRecord, run(), (r) => { r.edition = "english_only"; }, "edition");
    expectMutationFails(RunRecord, run(), (r) => { r.error_code = "AUTH"; }, "error_code");
    expectMutationFails(RunRecord, run(), (r) => { r.code_commit = commit.slice(1); }, "code_commit");
    expectMutationFails(RunRecord, run(), (r) => { r.pace_status = "fresh"; }, "pace_status");
    expectMutationFails(RunRecord, run(), (r) => { r.late = "no"; }, "late");
    for (const trigger of RUN_TRIGGERS) expectValid(RunRecord, { ...run(), trigger });
    for (const outcome of RUN_OUTCOMES) expectValid(RunRecord, { ...run(), outcome });
  });

  it("lists exactly the eleven stages, in the status file's order", () => {
    expectMutationFails(RunRecord, run(), (r) => { r.stages.pop(); }, "stages", "exactly");
    expectMutationFails(RunRecord, run(), (r) => { r.stages.push(stage("links")); }, "stages", "exactly");
    expectMutationFails(RunRecord, run(), (r) => { r.stages.reverse(); }, "stages", "in that order");
    expectMutationFails(RunRecord, run(), (r) => { [r.stages[3], r.stages[4]] = [r.stages[4], r.stages[3]]; }, "stages", "in that order");
    expectMutationFails(RunRecord, run(), (r) => { r.stages[2] = stage("collect"); }, "stages", "in that order");
    expectMutationFails(RunRecord, run(), (r) => { r.stages = []; }, "stages");
    expectMutationFails(RunRecord, run(), (r) => { r.stages[0].status = "done"; }, "stages.0.status");
  });

  it("lists the feeds one record each, judged by the feed record", () => {
    expectValid(RunRecord, { ...run(), feeds: [] });
    expectMutationFails(RunRecord, run(), (r) => { r.feeds[0].status = "late"; }, "feeds.0.status");
    expectMutationFails(RunRecord, run(), (r) => { r.feeds = null; }, "feeds");
  });

  it("has the budgets the spec gives, with the Chinese pass's own", () => {
    expect(Object.keys(run().budgets)).toEqual([
      "agent_seconds", "zh_agent_seconds", "web_fetches", "web_searches", "repair_rounds", "tokens_in", "tokens_out", "usage", "safety_stops",
    ]);
    for (const key of Object.keys(run().budgets)) expectMutationFails(RunRecord, run(), (r) => delete r.budgets[key], `budgets.${key}`);
    for (const key of ["agent_seconds", "zh_agent_seconds", "web_fetches", "web_searches", "repair_rounds", "safety_stops"]) {
      expectMutationFails(RunRecord, run(), (r) => { r.budgets[key] = -1; }, `budgets.${key}`);
      expectMutationFails(RunRecord, run(), (r) => { r.budgets[key] = null; }, `budgets.${key}`);
    }
    expectMutationFails(RunRecord, run(), (r) => { r.budgets.extra = 1; }, "budgets", "Unrecognized key");
    expectMutationFails(RunRecord, run(), (r) => { r.budgets.tokens_in = -5; }, "budgets.tokens_in");
    expectValid(RunRecord, { ...run(), budgets: { ...run().budgets, tokens_in: 1200, tokens_out: 300 } });
  });

  it("has a usage window and a utilization, or null", () => {
    const withUsage = { ...run(), budgets: { ...run().budgets, usage: { window: "five_hour", utilization: 0.4 } } };
    expectValid(RunRecord, withUsage);
    expectMutationFails(RunRecord, withUsage, (r) => { r.budgets.usage.utilization = -0.1; }, "budgets.usage.utilization");
    expectMutationFails(RunRecord, withUsage, (r) => { r.budgets.usage.window = ""; }, "budgets.usage.window");
    expectMutationFails(RunRecord, withUsage, (r) => { delete r.budgets.usage.window; }, "budgets.usage.window");
    expectMutationFails(RunRecord, withUsage, (r) => { r.budgets.usage.extra = 1; }, "budgets.usage", "Unrecognized key");
  });

  it("holds the candidate, validation and soft-gate counts, with rule codes and never messages", () => {
    expectMutationFails(RunRecord, run(), (r) => { r.candidates.kept = -1; }, "candidates.kept");
    expectMutationFails(RunRecord, run(), (r) => { delete r.candidates.deep_read; }, "candidates.deep_read");
    expectMutationFails(RunRecord, run(), (r) => { r.candidates.extra = 1; }, "candidates", "Unrecognized key");
    expectMutationFails(RunRecord, run(), (r) => { r.validation.codes = ["words"]; }, "validation.codes.0");
    expectMutationFails(RunRecord, run(), (r) => { r.validation.codes = ["The quote is too long"]; }, "validation.codes.0");
    expectMutationFails(RunRecord, run(), (r) => { r.validation.errors = 1.5; }, "validation.errors");
    expectMutationFails(RunRecord, run(), (r) => { r.validation.message = "x"; }, "validation", "Unrecognized key");
    expectMutationFails(RunRecord, run(), (r) => { r.soft_gates.by_code = { primary_only: 1 }; }, "soft_gates.by_code.primary_only");
    expectMutationFails(RunRecord, run(), (r) => { r.soft_gates.by_code = { PRIMARY_ONLY: -1 }; }, "soft_gates.by_code.PRIMARY_ONLY");
    expectMutationFails(RunRecord, run(), (r) => { r.soft_gates.dropped = -1; }, "soft_gates.dropped");
    expectValid(RunRecord, { ...run(), soft_gates: { checked: 0, dropped: 0, by_code: {} } });
  });

  it("holds the Chinese record, the deploy record, the re-check record and the link check to their schemas", () => {
    expectMutationFails(RunRecord, run(), (r) => { r.zh.outcome = "done"; }, "zh.outcome");
    expectMutationFails(RunRecord, run(), (r) => { delete r.zh.backlog; }, "zh.backlog");
    expectMutationFails(RunRecord, run(), (r) => { r.deploy.triggered = null; }, "deploy.triggered");
    expectMutationFails(RunRecord, run(), (r) => { r.deploy.shows_edition = "english_only"; }, "deploy.shows_edition");
    expectMutationFails(RunRecord, run(), (r) => { r.deploy.shows_date = "2026-02-30"; }, "deploy.shows_date");
    expectMutationFails(RunRecord, run(), (r) => { r.deploy.ready_at = "soon"; }, "deploy.ready_at");
    expectMutationFails(RunRecord, run(), (r) => { delete r.deploy.ready_at; }, "deploy.ready_at");
    expectMutationFails(RunRecord, run(), (r) => { r.deploy.extra = 1; }, "deploy", "Unrecognized key");
    expectMutationFails(RunRecord, run(), (r) => { r.recheck.proposals = -1; }, "recheck.proposals");
    expectMutationFails(RunRecord, run(), (r) => { r.links.broken[0].ref = "x"; }, "links.broken.0.ref");
  });
});

describe("StatusFile", () => {
  const file = () => ({ schema_version: 1, date: "2026-11-23", runs: [run(), { ...run(), run_id: "20261123-051000", trigger: "retry", attempt: 2 }] });

  it("holds the runs of a date, which may be none", () => {
    expectValid(StatusFile, file());
    expectValid(StatusFile, { schema_version: 1, date: "2026-11-23", runs: [] });
    expect(Object.keys(StatusFile.shape)).toEqual(["schema_version", "date", "runs"]);
  });

  it("is at schema version 1, with a real date and no other key, and judges each run", () => {
    expectMutationFails(StatusFile, file(), (f) => { f.schema_version = 2; }, "schema_version");
    expectMutationFails(StatusFile, file(), (f) => { f.date = "2026-02-30"; }, "date");
    expectMutationFails(StatusFile, file(), (f) => { delete f.runs; }, "runs");
    expectMutationFails(StatusFile, file(), (f) => { f.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(StatusFile, file(), (f) => { f.runs[1].attempt = 0; }, "runs.1.attempt");
    expectMutationFails(StatusFile, file(), (f) => { f.runs[0].stages.pop(); }, "runs.0.stages");
  });
});

// ── The metrics file ─────────────────────────────────────────────────────────────────────────────

const share = (k: number, n: number, lo: number, hi: number) => ({ k, n, share: Math.round((k / n) * 10_000) / 10_000, ci80: [lo, hi] });

const cell = () => ({
  window: share(200, 1000, 0.18, 0.22),
  baseline: share(50, 1000, 0.04, 0.06),
  year_ago: share(150, 1000, 0.13, 0.17),
  vs_baseline: "higher",
  vs_year_ago: "up",
});

const paceSet = () => ({ pooled: cell(), by_field: Object.fromEntries(FIELDS.map((f) => [f, cell()])) });

const pace = () => ({
  window: { from: "2026-06-22", to: "2026-09-20" },
  provisional_from: "2026-09-21",
  baseline: { from: "2015-01-05", to: "2019-12-29" },
  year_ago: { from: "2025-06-23", to: "2025-09-21" },
  leading: paceSet(),
  all: paceSet(),
  sentence: { en: "AI methods made up 20% of papers in the leading journals.", zh: "在主要期刊的論文中，使用 AI 方法的占 20%。" },
  quotable: { "pace.leading.pooled.window": "20%" },
});

const reading = () => ({
  id: "erdos_ai", kind: "api", value: 12, as_of: "2026-11-20", breakdown: [{ key: "total", value: 12 }],
  source_url: "https://example.org/erdos", status: "ok",
});

const metrics = () => ({
  schema_version: 1,
  date: "2026-11-23",
  computed_at: "2026-11-23T03:20:00+08:00",
  data_cutoff: "2026-11-15",
  versions: { ai_terms: 1, journals: 1, fields: 1, counters: 1 },
  status: "ok",
  pace: pace(),
  landmarks: {
    by_year: [{ year: 2018, ai: 1, all: 5 }, { year: 2019, ai: 2, all: 6 }, { year: 2025, ai: 8, all: 12 }],
    baseline: { ai: 3, all: 11 },
  },
  hold: { cases: 10, held: 6, fell: 1, open: 3, too_few: false },
  counters: [reading(), { ...reading(), id: "pdb_structures", kind: "manual", value: null, as_of: null, breakdown: [], status: "missing" }],
});

describe("the metrics vocabularies", () => {
  it("list the values the spec gives", () => {
    expect([...VS_BASELINE]).toEqual(["higher", "lower", "no_clear_change", "too_few"]);
    expect([...VS_YEAR_AGO]).toEqual(["up", "level", "down", "too_few"]);
    expect([...COUNTER_KINDS]).toEqual(["api", "ledger", "manual"]);
    expect([...OPENALEX_REQUESTS]).toEqual(["leading_total", "leading_ai", "all_total", "all_ai"]);
    expect(PACE_BASELINE).toEqual({ from: "2015-01-05", to: "2019-12-29" });
    for (const [schema, values] of [[VsBaseline, VS_BASELINE], [VsYearAgo, VS_YEAR_AGO], [CounterKind, COUNTER_KINDS], [OpenAlexRequestKind, OPENALEX_REQUESTS]] as [z.ZodType, readonly string[]][]) {
      for (const v of values) expectValid(schema, v);
      for (const bad of ["", "not-a-value", null, 1]) expect(schema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });

  it("type the metrics file as the spec does", () => {
    expectTypeOf<MetricsFileT["status"]>().toEqualTypeOf<"ok" | "stale" | "missing">();
    expectTypeOf<MetricsFileT["pace"]["leading"]["pooled"]["vs_year_ago"]>().toEqualTypeOf<"up" | "level" | "down" | "too_few">();
    expectTypeOf<MetricsFileT["counters"][number]["value"]>().toEqualTypeOf<number | null>();
    expectTypeOf<PaceWeeklyFileT["weeks"][number]["leading"]["physics"]>().toEqualTypeOf<[number, number]>();
  });
});

describe("ConfigVersions and PaceVersions", () => {
  it("hold positive integers, the weekly state's without the counters' version", () => {
    expectValid(ConfigVersions, { ai_terms: 1, journals: 2, fields: 3, counters: 4 });
    expectValid(PaceVersions, { ai_terms: 1, journals: 2, fields: 3 });
    expect(Object.keys(ConfigVersions.shape)).toEqual(["ai_terms", "journals", "fields", "counters"]);
    expect(Object.keys(PaceVersions.shape)).toEqual(["ai_terms", "journals", "fields"]);
    expectIssue(PaceVersions, { ai_terms: 1, journals: 2, fields: 3, counters: 4 }, "", "Unrecognized key");
    for (const key of ["ai_terms", "journals", "fields", "counters"]) {
      expectMutationFails(ConfigVersions, { ai_terms: 1, journals: 2, fields: 3, counters: 4 }, (v) => { v[key] = 0; }, key);
      expectMutationFails(ConfigVersions, { ai_terms: 1, journals: 2, fields: 3, counters: 4 }, (v) => { v[key] = 1.5; }, key);
      expectMutationFails(ConfigVersions, { ai_terms: 1, journals: 2, fields: 3, counters: 4 }, (v) => delete v[key], key);
    }
  });
});

describe("Share", () => {
  it("is k papers of n, the share and its interval", () => {
    expectValid(Share, share(200, 1000, 0.18, 0.22));
    expectValid(ShareBase, share(200, 1000, 0.18, 0.22));
    expectValid(Share, { k: 0, n: 0, share: 0, ci80: [0, 1] });
    expectValid(Share, { k: 1, n: 3, share: 0.3333, ci80: [0.1, 0.7] });
    expectValid(Share, { k: 5, n: 5, share: 1, ci80: [0.7, 1] });
    expect(Object.keys(Share.shape)).toEqual(["k", "n", "share", "ci80"]);
  });

  it("needs every key and refuses an unknown key and bad numbers", () => {
    for (const key of ["k", "n", "share", "ci80"]) expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => delete s[key], key);
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.k = -1; }, "k");
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.n = 1000.5; }, "n");
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.share = 1.2; }, "share");
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.share = 0.12345; }, "share", "4 decimal");
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.ci80 = [0.22, 0.18]; }, "ci80", "lo <= hi");
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.ci80 = [0.18]; }, "ci80");
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.ci80 = [-0.1, 0.2]; }, "ci80.0");
  });

  it("states k at most n, and a share that is k over n to four decimals", () => {
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.k = 1001; s.share = 1; s.ci80 = [0.9, 1]; }, "k", "at most n");
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.share = 0.21; }, "share", "k / n");
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.share = 0.2001; }, "share", "k / n");
    expectValid(Share, { k: 1, n: 3, share: 0.3333, ci80: [0.1, 0.7] });
    expectValid(Share, { k: 2, n: 3, share: 0.6667, ci80: [0.1, 0.9] });
  });

  it("has a share of no papers be 0 with the interval [0, 1]", () => {
    expectMutationFails(Share, { k: 0, n: 0, share: 0, ci80: [0, 1] }, (s) => { s.share = 0.5; }, "share", "no papers");
    expectMutationFails(Share, { k: 0, n: 0, share: 0, ci80: [0, 1] }, (s) => { s.ci80 = [0, 0.5]; }, "ci80", "[0, 1]");
    expectMutationFails(Share, { k: 0, n: 0, share: 0, ci80: [0, 1] }, (s) => { s.ci80 = [0.1, 1]; }, "ci80", "[0, 1]");
    expectMutationFails(Share, { k: 1, n: 0, share: 0, ci80: [0, 1] }, (s) => s, "k", "at most n");
  });

  it("has the interval hold the share", () => {
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.ci80 = [0.21, 0.25]; }, "ci80", "holds the share");
    expectMutationFails(Share, share(200, 1000, 0.18, 0.22), (s) => { s.ci80 = [0.1, 0.19]; }, "ci80", "holds the share");
    expectValid(Share, share(200, 1000, 0.2, 0.2));
  });

  it("keeps .pick() available on the unrefined base only", () => {
    expectValid(ShareBase.pick({ k: true, n: true }), { k: 1, n: 2 });
    expect(() => (Share as unknown as z.ZodObject<z.ZodRawShape>).pick({ k: true })).toThrow();
  });
});

describe("PaceCell, PaceSet and PaceBlock", () => {
  it("PaceCell holds three shares and two verdicts", () => {
    expectValid(PaceCell, cell());
    expect(Object.keys(PaceCell.shape)).toEqual(["window", "baseline", "year_ago", "vs_baseline", "vs_year_ago"]);
    for (const key of Object.keys(cell())) expectMutationFails(PaceCell, cell(), (c) => delete c[key], key);
    expectMutationFails(PaceCell, cell(), (c) => { c.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(PaceCell, cell(), (c) => { c.vs_baseline = "up"; }, "vs_baseline");
    expectMutationFails(PaceCell, cell(), (c) => { c.vs_year_ago = "higher"; }, "vs_year_ago");
    expectMutationFails(PaceCell, cell(), (c) => { c.window.k = 2000; }, "window.k");
    for (const v of VS_BASELINE) expectValid(PaceCell, { ...cell(), vs_baseline: v });
    for (const v of VS_YEAR_AGO) expectValid(PaceCell, { ...cell(), vs_year_ago: v });
  });

  it("PaceSet has the pooled cell and one cell for each of the seven fields, no more and no fewer", () => {
    expectValid(PaceSet, paceSet());
    expect(Object.keys(PaceSet.shape)).toEqual(["pooled", "by_field"]);
    expect(FIELDS).toHaveLength(7);
    expectMutationFails(PaceSet, paceSet(), (s) => { delete s.by_field.physics; }, "by_field.physics");
    expectMutationFails(PaceSet, paceSet(), (s) => { s.by_field.astronomy = cell(); }, "by_field", "astronomy");
    expectMutationFails(PaceSet, paceSet(), (s) => { delete s.pooled; }, "pooled");
    expectMutationFails(PaceSet, paceSet(), (s) => { s.by_field.physics.vs_baseline = "up"; }, "by_field.physics.vs_baseline");
    expectMutationFails(PaceSet, paceSet(), (s) => { s.extra = 1; }, "", "Unrecognized key");
  });

  it("PaceBlock accepts the block as the spec gives it, and keeps its key order", () => {
    expectValid(PaceBlock, pace());
    expectValid(PaceBlockBase, pace());
    expect(Object.keys(PaceBlock.shape)).toEqual(["window", "provisional_from", "baseline", "year_ago", "leading", "all", "sentence", "quotable"]);
  });

  it("PaceBlock needs every key and refuses an unknown key", () => {
    for (const key of Object.keys(pace())) expectMutationFails(PaceBlock, pace(), (p) => delete p[key], key);
    expectMutationFails(PaceBlock, pace(), (p) => { p.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(PaceBlock, pace(), (p) => { p.window.extra = 1; }, "window", "Unrecognized key");
    expectMutationFails(PaceBlock, pace(), (p) => { delete p.window.to; }, "window.to");
  });

  it("PaceBlock fixes the baseline to 2015-01-05 to 2019-12-29", () => {
    expectMutationFails(PaceBlock, pace(), (p) => { p.baseline.from = "2015-01-12"; }, "baseline.from");
    expectMutationFails(PaceBlock, pace(), (p) => { p.baseline.to = "2020-01-05"; }, "baseline.to");
    expectMutationFails(PaceBlock, pace(), (p) => { p.baseline.extra = 1; }, "baseline", "Unrecognized key");
  });

  it("PaceBlock runs the window Monday to Sunday, its year-ago twin 52 weeks back, and the provisional weeks after it", () => {
    expectMutationFails(PaceBlock, pace(), (p) => { p.window.from = "2026-06-23"; p.year_ago.from = "2025-06-24"; }, "window.from", "Monday");
    expectMutationFails(PaceBlock, pace(), (p) => { p.window.to = "2026-09-19"; p.year_ago.to = "2025-09-20"; p.provisional_from = "2026-09-20"; }, "window.to", "Sunday");
    expectMutationFails(PaceBlock, pace(), (p) => { p.window.from = "2026-09-21"; p.window.to = "2026-09-13"; p.year_ago.from = "2025-09-22"; p.year_ago.to = "2025-09-14"; p.provisional_from = "2026-09-14"; }, "window.to", "after it starts");
    expectMutationFails(PaceBlock, pace(), (p) => { p.year_ago.from = "2025-06-30"; }, "year_ago.from", "52 weeks");
    expectMutationFails(PaceBlock, pace(), (p) => { p.year_ago.to = "2025-09-14"; }, "year_ago.to", "52 weeks");
    expectMutationFails(PaceBlock, pace(), (p) => { p.provisional_from = "2026-09-28"; }, "provisional_from", "day after");
    expectMutationFails(PaceBlock, pace(), (p) => { p.provisional_from = "2026-09-20"; }, "provisional_from", "day after");
  });

  it("PaceBlock leaves the window's length to config: a window of one week passes", () => {
    expectValid(PaceBlock, {
      ...pace(), window: { from: "2026-09-14", to: "2026-09-20" }, year_ago: { from: "2025-09-15", to: "2025-09-21" },
    });
  });

  it("PaceBlock does not throw on dates that are not real: it reports the date and no more", () => {
    const broken = { ...pace(), window: { from: "2026-02-30", to: "2026-09-20" } };
    const found = issuesOf(PaceBlock, broken);
    expect(found.map((i) => i.path)).toEqual(["window.from"]);
    expectMutationFails(PaceBlock, pace(), (p) => { p.provisional_from = "soon"; }, "provisional_from");
  });

  it("PaceBlock holds the sentence as L10n and the quotable figures as dotted keys to non-empty text", () => {
    expectMutationFails(PaceBlock, pace(), (p) => { p.sentence = "plain"; }, "sentence");
    expectMutationFails(PaceBlock, pace(), (p) => { p.sentence.en = ""; }, "sentence.en");
    expectMutationFails(PaceBlock, pace(), (p) => { p.quotable = { "Pace.Leading": "20%" }; }, "quotable.Pace.Leading");
    expectMutationFails(PaceBlock, pace(), (p) => { p.quotable = { "pace.leading": "" }; }, "quotable.pace.leading");
    expectMutationFails(PaceBlock, pace(), (p) => { p.quotable = { "pace.leading": 20 }; }, "quotable.pace.leading");
    expectValid(PaceBlock, { ...pace(), quotable: {} });
    expectValid(PaceBlock, { ...pace(), sentence: l("An English-only edition's sentence.") });
  });

  it("PaceBlockBase keeps .pick() available, and PaceBlock does not", () => {
    expectValid(PaceBlockBase.pick({ window: true, provisional_from: true }), { window: { from: "2026-06-22", to: "2026-09-20" }, provisional_from: "2026-09-21" });
    expect(() => (PaceBlock as unknown as z.ZodObject<z.ZodRawShape>).pick({ window: true })).toThrow();
  });
});

describe("Landmarks and Hold", () => {
  const landmarks = () => copy(metrics().landmarks);

  it("Landmarks holds the years oldest first and the baseline of 2015 to 2019 together", () => {
    expectValid(Landmarks, landmarks());
    expectValid(Landmarks, { by_year: [], baseline: { ai: 0, all: 0 } });
    expectValid(Landmarks, { by_year: [{ year: 2026, ai: 1, all: 1 }], baseline: { ai: 0, all: 0 } });
    expect(Object.keys(Landmarks.shape)).toEqual(["by_year", "baseline"]);
  });

  it("Landmarks refuses years out of order or twice", () => {
    expectMutationFails(Landmarks, landmarks(), (c) => { c.by_year.reverse(); }, "by_year.1.year", "oldest first");
    expectMutationFails(Landmarks, landmarks(), (c) => { c.by_year[1].year = 2018; }, "by_year.1.year", "one row a year");
  });

  it("Landmarks has the baseline add up the years 2015 to 2019, and only those", () => {
    expectMutationFails(Landmarks, landmarks(), (c) => { c.baseline.all = 12; }, "baseline", "adds up");
    expectMutationFails(Landmarks, landmarks(), (c) => { c.baseline.ai = 4; }, "baseline", "adds up");
    expectMutationFails(Landmarks, landmarks(), (c) => { c.by_year[2].year = 2019; c.by_year.splice(1, 1); }, "baseline", "adds up");
    expectValid(Landmarks, { by_year: [{ year: 2014 + 1, ai: 0, all: 2 }, { year: 2020, ai: 5, all: 7 }], baseline: { ai: 0, all: 2 } });
  });

  it("a year and the baseline have ai at most all, whole numbers, and a year from 2015", () => {
    expectMutationFails(Landmarks, landmarks(), (c) => { c.by_year[0].ai = 6; c.baseline.ai = 8; }, "by_year.0.ai", "at most all");
    expectMutationFails(Landmarks, landmarks(), (c) => { c.baseline.ai = 12; c.baseline.all = 11; }, "baseline.ai", "at most all");
    expectMutationFails(Landmarks, landmarks(), (c) => { c.by_year[0].year = 2014; }, "by_year.0.year");
    expectMutationFails(Landmarks, landmarks(), (c) => { c.by_year[0].year = 2018.5; }, "by_year.0.year");
    expectMutationFails(Landmarks, landmarks(), (c) => { c.by_year[0].all = -1; }, "by_year.0.all");
    expectMutationFails(Landmarks, landmarks(), (c) => { c.by_year[0].extra = 1; }, "by_year.0", "Unrecognized key");
    expectMutationFails(Landmarks, landmarks(), (c) => { c.baseline.extra = 1; }, "baseline", "Unrecognized key");
    expectValid(LandmarkYear, { year: 2026, ai: 1, all: 1 });
    expectValid(LandmarkBaseline, { ai: 0, all: 0 });
  });

  const hold = () => ({ ...metrics().hold });

  it("Hold has held, fell and open add up to the cases", () => {
    expectValid(Hold, hold());
    expectValid(Hold, { cases: 0, held: 0, fell: 0, open: 0, too_few: true });
    expect(Object.keys(Hold.shape)).toEqual(["cases", "held", "fell", "open", "too_few"]);
    expectMutationFails(Hold, hold(), (h) => { h.held = 7; }, "cases", "add up");
    expectMutationFails(Hold, hold(), (h) => { h.cases = 9; }, "cases", "add up");
  });

  it("Hold needs every key, whole non-negative counts and a boolean", () => {
    for (const key of Object.keys(hold())) expectMutationFails(Hold, hold(), (h) => delete h[key], key);
    expectMutationFails(Hold, hold(), (h) => { h.extra = 1; }, "", "Unrecognized key");
    for (const key of ["cases", "held", "fell", "open"]) {
      expectMutationFails(Hold, hold(), (h) => { h[key] = -1; }, key);
      expectMutationFails(Hold, hold(), (h) => { h[key] = null; }, key);
    }
    expectMutationFails(Hold, hold(), (h) => { h.too_few = "no"; }, "too_few");
  });
});

describe("CounterReading", () => {
  it("accepts a reading that is fresh, one carried as stale and one that is missing", () => {
    expectValid(CounterReading, reading());
    expectValid(CounterReadingBase, reading());
    expectValid(CounterReading, { ...reading(), status: "stale" });
    expectValid(CounterReading, { ...reading(), value: null, as_of: null, breakdown: [], status: "missing" });
    for (const kind of COUNTER_KINDS) expectValid(CounterReading, { ...reading(), kind });
    expect(Object.keys(CounterReading.shape)).toEqual(["id", "kind", "value", "as_of", "breakdown", "source_url", "status"]);
  });

  it("has no value exactly when its status is missing", () => {
    expectMutationFails(CounterReading, reading(), (c) => { c.value = null; }, "value", "exactly when its status is missing");
    expectMutationFails(CounterReading, reading(), (c) => { c.status = "missing"; }, "value", "exactly when its status is missing");
    expectMutationFails(CounterReading, { ...reading(), status: "stale" }, (c) => { c.value = null; }, "value");
  });

  it("needs every key and refuses an unknown key", () => {
    for (const key of Object.keys(reading())) expectMutationFails(CounterReading, reading(), (c) => delete c[key], key);
    expectMutationFails(CounterReading, reading(), (c) => { c.extra = 1; }, "", "Unrecognized key");
  });

  it("holds the id, kind, value, date and status formats", () => {
    expectMutationFails(CounterReading, reading(), (c) => { c.id = "Erdos-AI"; }, "id");
    expectMutationFails(CounterReading, reading(), (c) => { c.kind = "scraped"; }, "kind");
    expectMutationFails(CounterReading, reading(), (c) => { c.value = 1.5; }, "value");
    expectMutationFails(CounterReading, reading(), (c) => { c.as_of = "2026-02-30"; }, "as_of");
    expectMutationFails(CounterReading, reading(), (c) => { c.status = "fresh"; }, "status");
    expectMutationFails(CounterReading, reading(), (c) => { c.source_url = ""; }, "source_url");
    expectMutationFails(CounterReading, reading(), (c) => { c.source_url = null; }, "source_url");
  });

  it("holds the breakdown as rows of a key and a count", () => {
    expectValid(CounterBreakdownRow, { key: "approved", value: 3 });
    expectValid(CounterReading, { ...reading(), breakdown: [{ key: "1", value: 4 }, { key: "2", value: 3 }, { key: "approved", value: 1 }] });
    expectMutationFails(CounterReading, reading(), (c) => { c.breakdown[0].key = ""; }, "breakdown.0.key");
    expectMutationFails(CounterReading, reading(), (c) => { c.breakdown[0].value = -1; }, "breakdown.0.value");
    expectMutationFails(CounterReading, reading(), (c) => { c.breakdown[0].value = null; }, "breakdown.0.value");
    expectMutationFails(CounterReading, reading(), (c) => { c.breakdown[0].extra = 1; }, "breakdown.0", "Unrecognized key");
    expectMutationFails(CounterReading, reading(), (c) => { c.breakdown = null; }, "breakdown");
  });

  it("keeps .pick() available on the unrefined base only", () => {
    expectValid(CounterReadingBase.pick({ id: true, kind: true }), { id: "erdos_ai", kind: "api" });
    expect(() => (CounterReading as unknown as z.ZodObject<z.ZodRawShape>).pick({ id: true })).toThrow();
  });
});

describe("MetricsFile", () => {
  it("accepts a metrics file, and keeps the keys in the spec's order", () => {
    expectValid(MetricsFile, metrics());
    expect(Object.keys(MetricsFile.shape)).toEqual([
      "schema_version", "date", "computed_at", "data_cutoff", "versions", "status", "pace", "landmarks", "hold", "counters",
    ]);
    expect(Object.keys(MetricsFile.parse(Object.fromEntries(Object.entries(metrics()).reverse())))).toEqual(Object.keys(MetricsFile.shape));
  });

  it("needs every key and refuses null, an unknown key and a bad version", () => {
    for (const key of Object.keys(metrics())) {
      expectMutationFails(MetricsFile, metrics(), (m) => delete m[key], key);
      expectMutationFails(MetricsFile, metrics(), (m) => { m[key] = null; }, key);
    }
    expectMutationFails(MetricsFile, metrics(), (m) => { m.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(MetricsFile, metrics(), (m) => { m.schema_version = 2; }, "schema_version");
    expectMutationFails(MetricsFile, metrics(), (m) => { m.versions.counters = 0; }, "versions.counters");
    expectMutationFails(MetricsFile, metrics(), (m) => { delete m.versions.fields; }, "versions.fields");
    expectMutationFails(MetricsFile, metrics(), (m) => { m.status = "fresh"; }, "status");
    expectMutationFails(MetricsFile, metrics(), (m) => { m.computed_at = "2026-11-23"; }, "computed_at");
    expectMutationFails(MetricsFile, metrics(), (m) => { m.date = "2026-02-30"; }, "date");
  });

  it("holds the blocks to their own schemas, naming the place", () => {
    expectMutationFails(MetricsFile, metrics(), (m) => { m.pace.leading.pooled.window.k = 5000; }, "pace.leading.pooled.window.k");
    expectMutationFails(MetricsFile, metrics(), (m) => { m.landmarks.baseline.all = 99; }, "landmarks.baseline");
    expectMutationFails(MetricsFile, metrics(), (m) => { m.hold.cases = 99; }, "hold.cases");
    expectMutationFails(MetricsFile, metrics(), (m) => { m.counters[0].kind = "scraped"; }, "counters.0.kind");
    expectMutationFails(MetricsFile, metrics(), (m) => { m.counters[1].value = 4; }, "counters.1.value");
    expectOnlyIssue(MetricsFile, { ...metrics(), hold: { cases: 1, held: 0, fell: 0, open: 0, too_few: true } }, "hold.cases", "add up");
  });

  it("lists each counter once", () => {
    expectMutationFails(MetricsFile, metrics(), (m) => { m.counters[1].id = "erdos_ai"; }, "counters.1.id", "once");
    expectValid(MetricsFile, { ...metrics(), counters: [] });
  });

  it("ends its data on a Sunday, the newest Sunday on or before the date minus two days when the data is fresh", () => {
    expectMutationFails(MetricsFile, metrics(), (m) => { m.data_cutoff = "2026-11-14"; }, "data_cutoff", "Sunday");
    expectMutationFails(MetricsFile, metrics(), (m) => { m.data_cutoff = "2026-11-08"; }, "data_cutoff", "2026-11-15");
    expectMutationFails(MetricsFile, metrics(), (m) => { m.data_cutoff = "2026-11-22"; }, "data_cutoff", "2026-11-15");
    expectValid(MetricsFile, { ...metrics(), date: "2026-11-24", data_cutoff: "2026-11-22" });
    expectMutationFails(MetricsFile, { ...metrics(), date: "2026-11-24", data_cutoff: "2026-11-22" }, (m) => { m.data_cutoff = "2026-11-15"; }, "data_cutoff", "2026-11-22");
    expectValid(MetricsFile, { ...metrics(), date: "2026-11-25", data_cutoff: "2026-11-22" });
  });

  it("lets stale or missing data end earlier but never later", () => {
    for (const status of ["stale", "missing"]) {
      expectValid(MetricsFile, { ...metrics(), status, data_cutoff: "2026-11-08" });
      expectValid(MetricsFile, { ...metrics(), status, data_cutoff: "2026-11-15" });
      expectMutationFails(MetricsFile, { ...metrics(), status }, (m) => { m.data_cutoff = "2026-11-22"; }, "data_cutoff", "no later than");
      expectMutationFails(MetricsFile, { ...metrics(), status }, (m) => { m.data_cutoff = "2026-11-14"; }, "data_cutoff", "Sunday");
    }
  });

  it("ends its data after the window", () => {
    expectMutationFails(MetricsFile, { ...metrics(), status: "stale", data_cutoff: "2026-09-20" }, () => {}, "data_cutoff", "after the window");
    expectMutationFails(MetricsFile, { ...metrics(), status: "stale", data_cutoff: "2026-09-13" }, () => {}, "data_cutoff", "after the window");
    expectValid(MetricsFile, { ...metrics(), status: "stale", data_cutoff: "2026-09-27" });
  });

  it("does not throw on a date that is not real: it reports that date and leaves the cutoff rules out", () => {
    const found = issuesOf(MetricsFile, { ...metrics(), date: "2026-02-30" });
    expect(found.map((i) => i.path)).toEqual(["date"]);
    expect(issuesOf(MetricsFile, { ...metrics(), data_cutoff: "soon" }).map((i) => i.path)).toEqual(["data_cutoff"]);
  });
});

describe("RequestRecord, OpenAlexRequest, CounterInput and InputsManifest", () => {
  const url = "https://api.example.org/works?filter=from_publication_date:2026-11-09&group_by=primary_topic.field.id";
  const request = () => ({ url, fetched_at: "2026-11-23T03:18:00+08:00", sha256: sha });
  const openalex = () => ({
    request: "leading_ai", week_start: "2026-11-09", url, fetched_at: "2026-11-23T03:18:00+08:00", sha256: sha,
    counts: Object.fromEntries(FIELDS.map((f, i) => [f, i * 10])), excluded_n: 4, unmapped_n: 1,
  });
  const manifest = () => ({
    schema_version: 1,
    date: "2026-11-23",
    computed_at: "2026-11-23T03:20:00+08:00",
    data_cutoff: "2026-11-15",
    versions: { ai_terms: 1, journals: 1, fields: 1, counters: 1 },
    openalex: [openalex()],
    counters: [{ id: "erdos_ai", requests: [request()], value: 12 }, { id: "full_bibles", requests: [], value: null }],
    landmark_ids: ["bio-2026-0001", "math-2025-0010"],
    hold_case_ids: ["bio-2026-0001"],
  });

  it("RequestRecord holds a URL without a key or an e-mail address, the time and the SHA-256", () => {
    expectValid(RequestRecord, request());
    expect(Object.keys(RequestRecord.shape)).toEqual(["url", "fetched_at", "sha256"]);
    for (const key of Object.keys(request())) expectMutationFails(RequestRecord, request(), (r) => delete r[key], key);
    expectMutationFails(RequestRecord, request(), (r) => { r.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(RequestRecord, request(), (r) => { r.sha256 = sha.slice(1); }, "sha256");
    expectMutationFails(RequestRecord, request(), (r) => { r.fetched_at = "2026-11-23"; }, "fetched_at");
    expectMutationFails(RequestRecord, request(), (r) => { r.url = ""; }, "url");
  });

  it("RequestRecord refuses a URL that still holds a key or an e-mail address, in any case", () => {
    for (const bad of [
      "https://api.example.org/works?api_key=abc", "https://api.example.org/works?filter=x&api_key=abc",
      "https://api.example.org/works?mailto=a@example.org", "https://api.example.org/works?x=1&MAILTO=a%40example.org",
      "https://api.example.org/works?Api_Key=abc",
    ]) expectMutationFails(RequestRecord, request(), (r) => { r.url = bad; }, "url", "no key and no e-mail");
    expectValid(RequestRecord, { ...request(), url: "https://api.example.org/works?filter=x&per_page=200" });
    expectValid(RequestRecord, { ...request(), url: "https://api.example.org/works?mailtopic=1" });
  });

  it("OpenAlexRequest holds one of a week's four requests, with a count for each field", () => {
    expectValid(OpenAlexRequest, openalex());
    for (const kind of OPENALEX_REQUESTS) expectValid(OpenAlexRequest, { ...openalex(), request: kind });
    expect(Object.keys(OpenAlexRequest.shape)).toEqual(["request", "week_start", "url", "fetched_at", "sha256", "counts", "excluded_n", "unmapped_n"]);
    for (const key of Object.keys(openalex())) expectMutationFails(OpenAlexRequest, openalex(), (r) => delete r[key], key);
    expectMutationFails(OpenAlexRequest, openalex(), (r) => { r.request = "all_ai_papers"; }, "request");
    expectMutationFails(OpenAlexRequest, openalex(), (r) => { r.week_start = "2026-02-30"; }, "week_start");
    expectMutationFails(OpenAlexRequest, openalex(), (r) => { delete r.counts.physics; }, "counts.physics");
    expectMutationFails(OpenAlexRequest, openalex(), (r) => { r.counts.astronomy = 3; }, "counts", "astronomy");
    expectMutationFails(OpenAlexRequest, openalex(), (r) => { r.counts.physics = -1; }, "counts.physics");
    expectMutationFails(OpenAlexRequest, openalex(), (r) => { r.excluded_n = -1; }, "excluded_n");
    expectMutationFails(OpenAlexRequest, openalex(), (r) => { r.unmapped_n = 0.5; }, "unmapped_n");
    expectMutationFails(OpenAlexRequest, openalex(), (r) => { r.url = "https://api.example.org/works?api_key=abc"; }, "url");
    expectMutationFails(OpenAlexRequest, openalex(), (r) => { r.extra = 1; }, "", "Unrecognized key");
  });

  it("CounterInput holds a counter's requests and its value, or null", () => {
    const input = () => ({ id: "erdos_ai", requests: [request()], value: 12 });
    expectValid(CounterInput, input());
    expectValid(CounterInput, { id: "full_bibles", requests: [], value: null });
    expect(Object.keys(CounterInput.shape)).toEqual(["id", "requests", "value"]);
    expectMutationFails(CounterInput, input(), (c) => { c.id = "Erdos"; }, "id");
    expectMutationFails(CounterInput, input(), (c) => { c.value = 1.5; }, "value");
    expectMutationFails(CounterInput, input(), (c) => { delete c.value; }, "value");
    expectMutationFails(CounterInput, input(), (c) => { c.requests[0].url = "https://api.example.org/x?mailto=a@b.c"; }, "requests.0.url");
    expectMutationFails(CounterInput, input(), (c) => { c.requests = null; }, "requests");
  });

  it("InputsManifest accepts a manifest, and keeps the keys in order", () => {
    expectValid(InputsManifest, manifest());
    expectValid(InputsManifest, { ...manifest(), openalex: [], counters: [], landmark_ids: [], hold_case_ids: [] });
    expect(Object.keys(InputsManifest.shape)).toEqual([
      "schema_version", "date", "computed_at", "data_cutoff", "versions", "openalex", "counters", "landmark_ids", "hold_case_ids",
    ]);
  });

  it("InputsManifest needs every key and refuses null, an unknown key and a bad finding id", () => {
    for (const key of Object.keys(manifest())) {
      expectMutationFails(InputsManifest, manifest(), (m) => delete m[key], key);
      expectMutationFails(InputsManifest, manifest(), (m) => { m[key] = null; }, key);
    }
    expectMutationFails(InputsManifest, manifest(), (m) => { m.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(InputsManifest, manifest(), (m) => { m.schema_version = 2; }, "schema_version");
    expectMutationFails(InputsManifest, manifest(), (m) => { m.landmark_ids = ["bio-2026-1"]; }, "landmark_ids.0");
    expectMutationFails(InputsManifest, manifest(), (m) => { m.hold_case_ids = ["s1"]; }, "hold_case_ids.0");
    expectMutationFails(InputsManifest, manifest(), (m) => { m.data_cutoff = "2026-13-01"; }, "data_cutoff");
    expectMutationFails(InputsManifest, manifest(), (m) => { m.versions.extra = 1; }, "versions", "Unrecognized key");
    expectMutationFails(InputsManifest, manifest(), (m) => { m.openalex[0].excluded_n = -1; }, "openalex.0.excluded_n");
    expectMutationFails(InputsManifest, manifest(), (m) => { m.counters[0].value = "12"; }, "counters.0.value");
  });
});

describe("PaceWeeklyFile", () => {
  const week = (week_start: string, provisional = false) => ({
    week_start,
    fetched: "2026-11-23",
    provisional,
    leading: Object.fromEntries(FIELDS.map((f) => [f, [3, 40]])),
    all: Object.fromEntries(FIELDS.map((f) => [f, [30, 400]])),
  });
  const file = () => ({
    schema_version: 1,
    versions: { ai_terms: 1, journals: 1, fields: 1 },
    updated: "2026-11-23",
    weeks: [week("2015-01-05"), week("2015-01-12"), week("2015-01-19", true), week("2015-01-26", true)],
  });

  it("holds the weeks one by one from 2015-01-05, the newest ones provisional", () => {
    expectValid(PaceWeeklyFile, file());
    expectValid(PaceWeeklyFile, { ...file(), weeks: [week("2015-01-05")] });
    expectValid(PaceWeeklyFile, { ...file(), weeks: [week("2015-01-05", true)] });
    expect(Object.keys(PaceWeeklyFile.shape)).toEqual(["schema_version", "versions", "updated", "weeks"]);
    expect(Object.keys(PaceWeek.shape)).toEqual(["week_start", "fetched", "provisional", "leading", "all"]);
  });

  it("refuses a first week that is not 2015-01-05, a gap, a repeat and a week out of order", () => {
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks.shift(); }, "weeks.0.week_start", "2015-01-05");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks.splice(1, 1); }, "weeks.1.week_start", "2015-01-12");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[1].week_start = "2015-01-05"; }, "weeks.1.week_start", "2015-01-12");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { [f.weeks[0], f.weeks[1]] = [f.weeks[1], f.weeks[0]]; }, "weeks.0.week_start");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[3].week_start = "2015-02-03"; }, "weeks.3.week_start", "2015-01-26");
  });

  it("leaves every week after a provisional one provisional", () => {
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[3].provisional = false; }, "weeks.3.provisional", "provisional");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[0].provisional = true; }, "weeks.1.provisional");
    expectValid(PaceWeeklyFile, { ...file(), weeks: [week("2015-01-05", true), week("2015-01-12", true)] });
  });

  it("does not throw on a week that is not a real date: it reports the date alone", () => {
    const found = issuesOf(PaceWeeklyFile, { ...file(), weeks: [week("2015-02-30"), week("2015-01-12")] });
    expect(found.map((i) => i.path)).toEqual(["weeks.0.week_start"]);
  });

  it("holds the file's own keys, its version, its update date and the versions without counters", () => {
    for (const key of Object.keys(file())) expectMutationFails(PaceWeeklyFile, file(), (f) => delete f[key], key);
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.extra = 1; }, "", "Unrecognized key");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.schema_version = 2; }, "schema_version");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.updated = "2026-02-30"; }, "updated");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.versions.counters = 1; }, "versions", "Unrecognized key");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { delete f.versions.journals; }, "versions.journals");
  });

  it("holds a week as its date, its fetch date, a flag and [AI, all] for each field in both sets", () => {
    for (const key of Object.keys(week("2015-01-05"))) expectMutationFails(PaceWeeklyFile, file(), (f) => delete f.weeks[0][key], `weeks.0.${key}`);
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[0].extra = 1; }, "weeks.0", "Unrecognized key");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[0].provisional = "no"; }, "weeks.0.provisional");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[0].fetched = "yesterday"; }, "weeks.0.fetched");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { delete f.weeks[0].leading.physics; }, "weeks.0.leading.physics");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[0].all.astronomy = [1, 2]; }, "weeks.0.all", "astronomy");
  });

  it("holds each week's counts as two whole numbers with the AI papers among all the papers", () => {
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[0].leading.physics = [41, 40]; }, "weeks.0.leading.physics", "among all papers");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[0].all.biology = [5, 4]; }, "weeks.0.all.biology", "among all papers");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[0].leading.physics = [-1, 40]; }, "weeks.0.leading.physics.0");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[0].leading.physics = [1.5, 40]; }, "weeks.0.leading.physics.0");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[0].leading.physics = [1, 2, 3]; }, "weeks.0.leading.physics");
    expectMutationFails(PaceWeeklyFile, file(), (f) => { f.weeks[0].leading.physics = [1]; }, "weeks.0.leading.physics");
    expectValid(PaceWeeklyFile, { ...file(), weeks: [{ ...week("2015-01-05"), leading: Object.fromEntries(FIELDS.map((f) => [f, [0, 0]])) }] });
    expectValid(PaceWeeklyFile, { ...file(), weeks: [{ ...week("2015-01-05"), leading: Object.fromEntries(FIELDS.map((f) => [f, [40, 40]])) }] });
  });
});

describe("the stored files as JSON Schema", () => {
  it("can be written out, since none holds a type JSON Schema lacks", () => {
    for (const schema of [StatusFile, MetricsFile, InputsManifest, PaceWeeklyFile, RunRecord, PaceBlockBase, CounterReadingBase]) {
      const json = z.toJSONSchema(schema) as { type?: string; additionalProperties?: unknown };
      expect(json.type).toBe("object");
      expect(json.additionalProperties).toBe(false);
    }
  });
});
