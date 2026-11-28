// The status file, `content/status/D.json` (SPEC §4.8): one record per run for the date, oldest first. Notes come
// from fixed templates in scripts/lib/status.ts, never from raw error text.
//
// Cyber's lib/schema/status.ts at the fork commit 3ced1fb, adapted as §4.8 says: `RUN_STAGES` is `preflight`,
// `collect`, `metrics`, `recheck`, `data_only`, `draft`, `validate`, `zh`, `publish`, `deploy`, `links`; the Chinese
// pass has its own `zh` record (`attempted`, `repair_rounds`, `strings`, `backlog`, `outcome`); `budgets` adds
// `zh_agent_seconds`; Cyber's Gap-specific `data_cutoff_utc` goes and `pace_status` stands for it. Cyber's re-check
// and link-check records named items and its own kind of flag, which this project has not: the re-check record counts the
// rung watch and report intake and lists the safety flags (SPEC §8.9), and a broken link names the finding or
// edition that cites it (the archive index's refs). The run vocabularies Cyber keeps in lib/vocab.ts are here, since
// they belong to this file's records.

import { z } from "zod";
import {
  CommitSha, ConfigId, Count, DataStatus, Edition, ErrorCode, IsoDate, IsoTimestamp, PublishedAt, RuleCode, RunId,
} from "./common";
import { ArchiveRef, FlaggedRecord } from "./misc";

/** The status file's order, not the run's (SPEC §8.2): re-check comes before the data-only edition, which shows its script rung changes. */
export const RUN_STAGES = ["preflight", "collect", "metrics", "recheck", "data_only", "draft", "validate", "zh", "publish", "deploy", "links"] as const;
export const STAGE_STATUS = ["ok", "degraded", "failed", "skipped"] as const;
export const FEED_STATUS = ["ok", "stale", "failed", "skipped"] as const;
export const RUN_OUTCOMES = ["published_full", "published_partial", "published_data_only", "failed", "skipped", "dry_run"] as const;
export const RUN_TRIGGERS = ["schedule", "retry", "manual", "dry_run"] as const;
/**
 * How the Chinese pass ended: `ok`, `failed`, `skipped_late` (too late to start, SPEC §8.2), `skipped_flag` (`--no-zh`) or
 * `not_run` (no valid English draft). The run line shows the first as `Chinese done`, the second as `Chinese failed` and
 * the other three as `Chinese not run` (SPEC §8.8).
 */
export const ZH_OUTCOMES = ["ok", "failed", "skipped_late", "skipped_flag", "not_run"] as const;

export const RunStage = z.enum(RUN_STAGES);
export const StageStatus = z.enum(STAGE_STATUS);
export const FeedStatus = z.enum(FEED_STATUS);
export const RunOutcome = z.enum(RUN_OUTCOMES);
export const RunTrigger = z.enum(RUN_TRIGGERS);
export const ZhOutcome = z.enum(ZH_OUTCOMES);

export const StageRecord = z.strictObject({
  id: RunStage,
  status: StageStatus,
  started_at: IsoTimestamp.nullable(),
  ended_at: IsoTimestamp.nullable(),
  note: z.string().min(1).max(200).nullable(),
});

export const FeedRecord = z.strictObject({
  id: ConfigId,
  status: FeedStatus,
  newest: PublishedAt,
  checked_at: IsoTimestamp,
  stale_since: IsoDate.nullable().describe("First edition date the feed was stale or failed, carried from earlier status files"),
  records: Count.nullable(),
  note: z.string().min(1).max(200).nullable(),
});

/** The Chinese pass (SPEC §4.8): `strings` the strings of its context, `backlog` the stored findings it translated. */
export const ZhRecord = z.strictObject({
  attempted: z.boolean(),
  repair_rounds: Count,
  strings: Count,
  backlog: Count,
  outcome: ZhOutcome,
});

/**
 * The re-check stage (SPEC §8.9): the findings the rung watch followed, the script rung changes it applied and the
 * proposals it sent to the agent, the reports intake recorded and the ones JL's closes decided, and the records the
 * safety flags sent to the agent, each with its path and code and never the matched text.
 */
export const Recheck = z.strictObject({
  findings_checked: Count,
  rung_changes: Count,
  proposals: Count,
  reports_new: Count,
  reports_decided: Count,
  flagged: z.array(FlaggedRecord),
});

export const LinkCheck = z.strictObject({
  checked_at: IsoTimestamp,
  checked: Count,
  ok: Count,
  unknown: Count,
  broken: z.array(z.strictObject({
    url: z.string().min(1),
    ref: ArchiveRef.describe("The finding, or the edition's brief-level text, that cites the URL"),
    result: z.enum(["broken", "changed"]),
    http: z.int().min(100).max(599).nullable(),
  })),
});

export const RunRecord = z.strictObject({
  run_id: RunId,
  trigger: RunTrigger,
  attempt: z.int().min(1),
  started_at: IsoTimestamp,
  finished_at: IsoTimestamp.nullable(),
  outcome: RunOutcome.nullable(),
  edition: Edition.nullable(),
  error_code: ErrorCode.nullable(),
  code_commit: CommitSha,
  pace_status: DataStatus.nullable().describe("The Pace's state after the metrics stage; null before it"),
  data_only_published_at: IsoTimestamp.nullable(),
  full_published_at: IsoTimestamp.nullable(),
  late: z.boolean(),
  stages: z.array(StageRecord).refine((s) => s.length === RUN_STAGES.length && s.every((r, i) => r.id === RUN_STAGES[i]), {
    error: `stages must be exactly ${RUN_STAGES.join(", ")}, in that order`,
  }),
  feeds: z.array(FeedRecord).describe("One per feed in config/sources.yaml, registry order"),
  budgets: z.strictObject({
    agent_seconds: Count,
    zh_agent_seconds: Count,
    web_fetches: Count,
    web_searches: Count,
    repair_rounds: Count,
    tokens_in: Count.nullable(),
    tokens_out: Count.nullable(),
    usage: z.strictObject({ window: z.string().min(1), utilization: z.number().min(0) }).nullable(),
    safety_stops: Count,
  }),
  candidates: z.strictObject({ ranked: Count, kept: Count, deep_read: Count }).nullable(),
  validation: z.strictObject({ errors: Count, warnings: Count, codes: z.array(RuleCode) }).nullable()
    .describe("Rule codes only, no messages"),
  soft_gates: z.strictObject({ checked: Count, dropped: Count, by_code: z.record(RuleCode, Count) }).nullable(),
  zh: ZhRecord.nullable().describe("null when the run ended before the Chinese stage"),
  deploy: z.strictObject({
    triggered: z.boolean(),
    ready_at: IsoTimestamp.nullable(),
    shows_date: IsoDate.nullable(),
    shows_edition: Edition.nullable(),
  }),
  recheck: Recheck.nullable(),
  links: LinkCheck.nullable(),
});

/** content/status/D.json. */
export const StatusFile = z.strictObject({
  schema_version: z.literal(1),
  date: IsoDate,
  runs: z.array(RunRecord).describe("Oldest first"),
});

export type RunStage = z.infer<typeof RunStage>;
export type StageStatus = z.infer<typeof StageStatus>;
export type FeedStatus = z.infer<typeof FeedStatus>;
export type RunOutcome = z.infer<typeof RunOutcome>;
export type RunTrigger = z.infer<typeof RunTrigger>;
export type ZhOutcome = z.infer<typeof ZhOutcome>;
export type StageRecord = z.infer<typeof StageRecord>;
export type FeedRecord = z.infer<typeof FeedRecord>;
export type ZhRecord = z.infer<typeof ZhRecord>;
export type Recheck = z.infer<typeof Recheck>;
export type LinkCheck = z.infer<typeof LinkCheck>;
export type RunRecord = z.infer<typeof RunRecord>;
export type StatusFile = z.infer<typeof StatusFile>;
