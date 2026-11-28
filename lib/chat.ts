// The chat edition and the reply file (SPEC §8.8; the error codes and next steps of §8.2; the Notes of §8.8, §8.9 and §8.13; the content
// they read, §6 "Content loading"; the finding's filing, §4.10; the disclosure, §4.4; the brief's parts, §4.5; the run records, §4.8).
// `renderChat()` makes `logs/D.summary.md`, the scheduled task's reply, from the brief as committed, the findings as `filedAs()` files
// them on D and the run records, so it matches the site. `renderReply()` makes `logs/D.reply.md`, the one file a reader's reply to the
// chat edition is answered from. Both leave out every record `loadContent()` skips (a finding a safety code now fails, a term whose
// own name fails one, a correction or report that was left out), print only validated model text and fixed templates, and end each
// line in `chatGuard()`, so no link, address, emoji, table or HTML tag points off the site or renders. Also here: `NEXT_STEP` and
// `WHAT_HAPPENED` (§8.2's error-code table), the stage-note sentences that `scripts/lib/status.ts` writes and `chatInputFor()` reads back, and
// `chatInputFor()` itself, which `daily.ts` (at finish) and `scripts/chat.ts` both call. Pure apart from the `run.json` import: the
// clock, the files and the network are the caller's.
//
// Cyber's lib/chat.ts at the fork commit 3ced1fb, adapted: the error-code tables, the stage and chat notes with their order, the
// `ChatInput` and `ChatSource` split, `lastRunRecords()`, `runCounts()`, `runSpan()`, `safePath()`, the dry-run forms, the run and
// notes lines, `chatGuard()` as the last step, `heldLockLine()` and `fallbackChat()` are Cyber's pattern. Its Gap, regions, Taiwan and
// exploited-list lines go with its domain parts: the Pace sentence is the data line, the script rung changes ("Climbed or fell") take
// the place of its exploited-list line, and the finding kicker, the story's six parts, the More lines, the Monday review, the Sunday
// deep dive, the disclosure, the reply file, the notes for a hidden term and an upheld report, the two-step fit to 32 lines (a line for
// each paragraph of the big picture and the deep dive, else one line for each text, then the More lines trimmed) and the omission of
// records the loader skips are this project's. Cyber's texts for hiding an item, its indicator defanging and the error code for a
// hidden item are not here (the new E_ZH is).

import run from "../config/run.json";
import type { Content } from "./content";
import { dayMonth, taipeiTime } from "./format";
import { filedAs } from "./items";
import type { Brief, BriefItem, WeekReview } from "./schema/brief";
import type { Edition } from "./schema/common";
import type { Finding } from "./schema/finding";
import type { RunRecord, RunStage } from "./schema/status";
import { SITE_NAME, siteUrl as configuredSiteUrl } from "./site";
import { escapeRegExp, splitSentences } from "./text";
import {
  AI_ROLE_INFO, CANARY_TOKEN, DISCLOSURE, EXPLAINER_PARTS, EXPLAINER_PART_INFO, FIELD_INFO, NO_AI_PART, RUNG_INFO, SIGNIFICANCE_INFO,
} from "./vocab";
import type { ExplainerPart } from "./vocab";

/** The most lines a chat edition may have (§8.8). The reply file has no cap. */
export const CHAT_MAX_LINES = 32;

/** What the chat edition and the reply file read of the loaded content (`loadContent()`'s `Content` fits). */
export type ChatContent = Pick<Content, "briefs" | "findings" | "corrections" | "reports" | "terms" | "hiddenTerms">;

// ── Error codes, next steps and what happened (§8.2) ─────────────────────────────────────────────

/** Every run error code of §8.2's table, in its order (`E_ZH` is new, after `E_DATA_ONLY`). */
export const ERROR_CODES = [
  "E_ARCH", "E_NODE", "E_CONFIG", "E_NET", "E_GIT", "E_CLOCK", "E_CLI", "E_AUTH", "E_PUSH", "E_METRICS", "E_DATA_ONLY", "E_ZH", "E_SANDBOX",
  "E_LIMIT", "E_AGENT", "E_TIMEOUT", "E_VALIDATION", "E_PUBLISH", "E_TOO_LATE", "E_SIMULATED", "E_INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** The run.json times the texts name. */
export interface ChatSchedule { hard_stop: string; publish_until: string }
const SCHEDULE: ChatSchedule = run.schedule;

/** The checkout NEXT_STEP names: a code default, as §0.2 allows. */
export const CHECKOUT = "/Users/kobol/Projects/UnveilingTracker";

/** Cyber's morning run (Appendix C): the rerun starts when it ends, and its note is the skipped edition's reason (§8.2 "Cyber's run"). */
export const CYBER_RUN = { start: "04:30", end: "05:30" } as const;

/** The longest a `--no-deadline` run may last (§8.2): so the latest sensible start for a rerun is `publish_until` less this. */
const NO_DEADLINE_MINUTES = 75;

/** Minutes since midnight of an "HH:MM" time; throws on any other text. Exported for the tests. */
export function minutesOf(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Invalid time: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "HH:MM" of minutes since midnight, wrapped into one day (so -15 is 23:45). Exported for the tests. */
export function clockOf(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The rerun window's start: when Cyber's run ends (05:30), so a `--no-deadline` rerun never meets it (§8.2). */
export const RERUN_FROM = CYBER_RUN.end;
/** The rerun window's end: 75 minutes before `publish_until` (09:45 for 11:00). */
export const RERUN_BEFORE = clockOf(minutesOf(SCHEDULE.publish_until) - NO_DEADLINE_MINUTES);
/** The rerun command `<rerun>` names; `withForce()` adds `--force` to it for E_PUBLISH. */
const RERUN_CMD = `zsh ${CHECKOUT}/scripts/daily.sh --no-deadline`;
const RERUN = `rerun from ${RERUN_FROM} to ${RERUN_BEFORE}: ${RERUN_CMD}`;

/**
 * One line per code, from §8.2's table (`<rerun>` written out in full). `{date}` stands for the edition date: use `nextStepFor()`,
 * which fills it and gives an unknown code E_INTERNAL's line.
 */
export const NEXT_STEP: Readonly<Record<ErrorCode, string>> = {
  E_ARCH: `the run isn't native arm64 Node 22 or newer; check scripts/daily.sh's PATH and /opt/homebrew/bin/node (SPEC Appendix C), then ${RERUN}`,
  E_NODE: `the run isn't native arm64 Node 22 or newer; check scripts/daily.sh's PATH and /opt/homebrew/bin/node (SPEC Appendix C), then ${RERUN}`,
  E_CONFIG: `config/ on main fails its checks; fix it in a PR, then ${RERUN}`,
  E_NET: `Kobol had no network; ${RERUN}`,
  E_GIT: `the checkout can't be synced with GitHub; see docs/RUNBOOK.md, then ${RERUN}`,
  E_CLOCK: `run this date after ${run.pack.window_end} Taipei on that day`,
  E_CLI: `the agent CLI is missing; reinstall it (SPEC §9.4), then ${RERUN}`,
  E_AUTH: `the agent's sign-in token is missing or expired; JL renews it (SPEC §9.6), then ${RERUN}`,
  E_PUSH: `the run can't push to GitHub; check gh's login on Kobol (SPEC §9.6), then ${RERUN}`,
  E_METRICS: `run npm run backfill -- --pace --refresh --push in ${CHECKOUT}, started before 02:00 or from ${CYBER_RUN.start} (SPEC §5.4)`,
  E_DATA_ONLY: `read logs/{date}.daily.log, then ${RERUN}`,
  E_ZH: "nothing: the English edition is published and later runs translate its findings",
  E_SANDBOX: "the agent's sandbox is wrong; run npm run agent:check -- --sandbox and fix SPEC §9.5's settings before the next run",
  E_LIMIT: "the account's usage limit stopped the agent; the data-only edition stands; runs resume when the limit window resets",
  E_AGENT: RERUN,
  E_TIMEOUT: RERUN,
  E_VALIDATION: `${RERUN}; the draft is in needs-review/{date}/`,
  E_PUBLISH: `the draft is valid: in ${CHECKOUT} run PATH=/opt/homebrew/bin:$PATH npm run publish -- --date {date} before ${SCHEDULE.publish_until}`,
  E_TOO_LATE: `nothing: nothing is published after ${SCHEDULE.publish_until}; the next morning's run will publish`,
  E_SIMULATED: "nothing: this was a test of the failure path",
  E_INTERNAL: `read logs/{date}.daily.log, then ${RERUN}`,
};

function isErrorCode(code: string): code is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code);
}

/** NEXT_STEP[code] with every `{date}` replaced; an unknown code gets E_INTERNAL's line. */
export function nextStepFor(code: string, date: string): string {
  return NEXT_STEP[isErrorCode(code) ? code : "E_INTERNAL"].replaceAll("{date}", date);
}

/**
 * What a dry run's next step ends with: a dry run pushes nothing and writes no needs-review/D/, so there is nothing to rerun or
 * publish by hand, only its own files to read. `{date}` as in NEXT_STEP.
 */
export const DRY_RUN_FILES =
  "this was a dry run, so nothing needs rerunning: what it wrote is in logs/{date}.daily.log, drafts/{date}.json, logs/{date}.validation.json and logs/dry-run/{date}/";

/** A dry run's step: the fix the code still needs before the next run, if any, then DRY_RUN_FILES. */
const dry = (fix?: string) => (fix ? `${fix}; ${DRY_RUN_FILES}` : DRY_RUN_FILES);

/**
 * NEXT_STEP's dry-run form: no rerun command, needs-review path or hand publish command. A code whose cause outlives the dry run (the
 * arch, the config, the CLI, the sign-in, the sandbox) keeps its fix, "before the next run"; E_SIMULATED's line is the same in both.
 * `{date}` as in NEXT_STEP: use `dryRunNextStepFor()`.
 */
export const DRY_RUN_NEXT_STEP: Readonly<Record<ErrorCode, string>> = {
  E_ARCH: dry("the run isn't native arm64 Node 22 or newer; check scripts/daily.sh's PATH and /opt/homebrew/bin/node (SPEC Appendix C) before the next run"),
  E_NODE: dry("the run isn't native arm64 Node 22 or newer; check scripts/daily.sh's PATH and /opt/homebrew/bin/node (SPEC Appendix C) before the next run"),
  E_CONFIG: dry("config/ fails its checks; fix it in a PR before the next run"),
  E_NET: dry("Kobol had no network"),
  E_GIT: dry("the checkout can't be synced with GitHub; see docs/RUNBOOK.md before the next run"),
  E_CLOCK: dry(`the news window for this date closes at ${run.pack.window_end} Taipei on that day`),
  E_CLI: dry("the agent CLI is missing; reinstall it (SPEC §9.4) before the next run"),
  E_AUTH: dry("the agent's sign-in token is missing or expired; JL renews it (SPEC §9.6) before the next run"),
  E_PUSH: dry("the run can't push to GitHub; check gh's login on Kobol (SPEC §9.6) before the next run"),
  E_METRICS: dry("read logs/{date}.metrics.log; fix in a PR before the next run"),
  E_DATA_ONLY: dry(),
  E_ZH: dry(),
  E_SANDBOX: dry(NEXT_STEP.E_SANDBOX),
  E_LIMIT: dry("the account's usage limit stopped the agent; runs resume when the limit window resets"),
  E_AGENT: dry(),
  E_TIMEOUT: dry(),
  E_VALIDATION: dry(),
  E_PUBLISH: dry("the draft was valid, and logs/{date}.daily.log says why its edition was not written"),
  E_TOO_LATE: dry(),
  E_SIMULATED: NEXT_STEP.E_SIMULATED,
  E_INTERNAL: dry(),
};

/** DRY_RUN_NEXT_STEP[code] with every `{date}` replaced; an unknown code gets E_INTERNAL's line. */
export function dryRunNextStepFor(code: string, date: string): string {
  return DRY_RUN_NEXT_STEP[isErrorCode(code) ? code : "E_INTERNAL"].replaceAll("{date}", date);
}

/**
 * E_PUBLISH's lines after a draft that passed its own checks but whose edition failed whole-tree validation (§8.7): the publish stage
 * of the record that carries the code holds `STAGE_NOTES.notValid`. Publishing the same draft again fails the same way, so the next
 * step reads the Validation lines first. `{date}` as in NEXT_STEP.
 */
export const NOT_VALID = {
  what: "The draft was valid, but the full edition made from it failed whole-tree validation, so it was not pushed.",
  nextStep: `read the Validation lines in logs/{date}.daily.log: if they name only briefs/{date}.json, fix drafts/{date}.json, then in ${CHECKOUT} run PATH=/opt/homebrew/bin:$PATH npm run publish -- --date {date} before ${SCHEDULE.publish_until}; if they name another file under content/, today's full edition cannot publish and the fix goes through a PR`,
  /** A dry run's form (DRY_RUN_NEXT_STEP): no hand publish; another file under content/ still needs its PR. */
  dryRunStep: dry("read the Validation lines in logs/{date}.daily.log: if they name another file than briefs/{date}.json, the fix goes through a PR before the next run"),
} as const;

/**
 * The failed format's lines when the run published an edition but `loadContent()` leaves its brief out (a safety code or a schema
 * fault in the committed brief), so the site does not show it. The brief is never printed. `{date}` as in NEXT_STEP.
 */
export const BRIEF_LEFT_OUT = {
  what: "The edition was published, but the site's checks leave its brief out, so the site does not show it.",
  nextStep: `in ${CHECKOUT} run PATH=/opt/homebrew/bin:$PATH npm run validate:all and read its first errors; the fix goes through a PR`,
} as const;

/** The hand publish command E_PUBLISH's next steps give, `{date}` filled. */
const publishCommand = (date: string) => `npm run publish -- --date ${date}`;

/**
 * E_PUBLISH's next step when brief D as committed is a full or partial edition: a failed --force run left the earlier edition standing,
 * and publish replaces one only with --force (§8.7), so the hand command and the rerun take it. With brief D a data-only edition, or no
 * brief, the step is as given.
 */
export function withForce(nextStep: string, date: string, stored: Pick<Brief, "edition"> | null): string {
  if (!stored || stored.edition === "data_only") return nextStep;
  return nextStep.replaceAll(publishCommand(date), `${publishCommand(date)} --force`).replaceAll(RERUN_CMD, `${RERUN_CMD} --force`);
}

/** What WHAT_HAPPENED's templates are filled from: the run records (`chatInputFor()` builds it). */
export interface WhatFacts {
  date: string;
  /** Validation errors left: the issues given, else the last record's validation.errors. */
  errors: number;
  /** Repair rounds across the run's records. */
  repairs: number;
  /** Agent attempts: records whose draft stage ran. */
  attempts: number;
  /** The last record's agent time in whole minutes, null when the agent never ran. */
  agentMinutes: number | null;
  /** run.json schedule.hard_stop and publish_until, "HH:MM". */
  hardStop: string;
  publishUntil: string;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The per-code "What happened" sentence (§8.8); scripts/lib/status.ts takes its texts from here too. */
export const WHAT_HAPPENED: Readonly<Record<ErrorCode, (f: WhatFacts) => string>> = {
  E_ARCH: () => "The run was not on native arm64 Node, so it stopped in preflight.",
  E_NODE: () => "The run's Node was older than 22, so it stopped in preflight.",
  E_CONFIG: () => "The files in config/ failed their checks, so the run stopped in preflight.",
  E_NET: () => "GitHub did not answer within 10 seconds, so the run stopped in preflight.",
  E_GIT: () => "The checkout could not be synced with GitHub, so the run stopped in preflight.",
  E_CLOCK: (f) => `The news window for ${f.date} has not closed yet, so nothing was computed.`,
  E_CLI: () => "The agent CLI was missing or did not start, so no editorial pass ran.",
  E_AUTH: () => "The agent's sign-in token was missing or expired, so no editorial pass ran.",
  E_PUSH: () => "The start record could not be pushed to GitHub, so nothing else was tried.",
  E_METRICS: () => "The Pace's saved state does not match the config's version, so this edition has no Pace.",
  E_DATA_ONLY: () => "The data-only edition could not be composed, validated or pushed, and no full edition followed.",
  E_ZH: () => "The Chinese pass did not produce a valid edition; the English edition is published. Later runs translate its findings.",
  E_SANDBOX: () => "The agent started with tools beyond its sandbox and was stopped.",
  E_LIMIT: () => "The account's usage limit stopped the agent before it wrote a valid draft.",
  E_AGENT: (f) => `The agent wrote no draft in ${count(f.attempts, "attempt")}.`,
  E_TIMEOUT: (f) => f.agentMinutes
    ? `The agent timed out after ${count(f.agentMinutes, "minute")} without writing a draft.`
    : `The run had too little time left for an editorial pass before ${f.hardStop}.`,
  E_VALIDATION: (f) => `The draft still had ${count(f.errors, "validation error")} after ${count(f.repairs, "repair")} and ${count(f.attempts, "attempt")}.`,
  E_PUBLISH: () => "The draft was valid, but the full edition failed whole-tree validation or its push.",
  E_TOO_LATE: (f) => `The full edition was not published: nothing is published after ${f.publishUntil}.`,
  E_SIMULATED: () => "A simulated failure (--simulate-failure) stopped the run after a valid draft.",
  E_INTERNAL: () => "The run hit an unexpected error; the stack is in the run log.",
};

/** WHAT_HAPPENED[code](facts); an unknown code gets E_INTERNAL's sentence. */
export function whatHappened(code: string, facts: WhatFacts): string {
  return WHAT_HAPPENED[isErrorCode(code) ? code : "E_INTERNAL"](facts);
}

// ── Stage notes and chat notes ───────────────────────────────────────────────────────────────────

/**
 * Stage-note sentences that scripts/lib/status.ts writes into RunRecord.stages[].note (several may share one note, joined by a space)
 * and `chatInputFor()` reads back, so `npm run chat` rebuilds the chat edition from the status file alone. Times are "HH:MM" Taipei.
 */
export const STAGE_NOTES = {
  /** draft, validate, publish: skipped with --data-only (§8.2). */
  dataOnlyRequested: "Data-only run requested (--data-only).",
  /** draft, validate, publish: skipped after the hard stop (§8.2 clock rules). */
  startedAfterHardStop: (hhmm: string) => `Started after ${hhmm}: no editorial pass today.`,
  /** preflight: a skip at step 6 (§8.2). */
  alreadyPublished: (hhmm: string) => `The full edition was already published at ${hhmm}.`,
  tooLate: (hhmm: string) => `Too late: nothing is published after ${hhmm}.`,
  /** preflight: a skip at step 6, a start before the news window ends (§8.2 "Too early"). */
  tooEarly: (hhmm: string) => `Too early: the news window ends at ${hhmm}; start the run then.`,
  /** preflight: a skip at step 6, a `--no-deadline` start that would meet Cyber's run (§8.2 "Cyber's run"). */
  cyberRun: (start: string, end: string) => `Cyber's morning run is from ${start} to ${end}: start the rerun from ${end}.`,
  /** publish: a --force run that replaced an edition. */
  replaced: (hhmm: string) => `Replaced the ${hhmm} edition (--force).`,
  /** preflight step 5. */
  depsChanged: "Dependencies changed since the last npm ci.",
  /** publish: whole-tree validation failed on the full edition; on the publish stage it selects NOT_VALID. */
  notValid: "Not valid: the full edition failed whole-tree validation (see the Validation lines in the daily log).",
} as const;

const NOTE_RES = {
  dataOnlyRequested: /Data-only run requested \(--data-only\)\./,
  startedAfterHardStop: /Started after \d\d:\d\d: no editorial pass today\./,
  alreadyPublished: /The full edition was already published at \d\d:\d\d\./,
  tooLate: /Too late: nothing is published after \d\d:\d\d\./,
  tooEarly: /Too early: the news window ends at \d\d:\d\d; start the run then\./,
  cyberRun: /Cyber's morning run is from \d\d:\d\d to \d\d:\d\d: start the rerun from \d\d:\d\d\./,
  replaced: /Replaced the (\d\d:\d\d) edition \(--force\)/i,
  depsChanged: /Dependencies changed since the last npm ci/,
  notValid: /Not valid: the full edition failed whole-tree validation/,
} as const;

/** What a seed file's name may be in a Note (§3: `<first_published>-<nn>.json`): a plain file name, never a path or text. */
const SEED_FILE_RE = /^[0-9A-Za-z._-]{1,80}$/;

/** The Notes line's entries (§8.8), each in the spec's words. */
export const CHAT_NOTES = {
  dropped: (n: number) => `${count(n, "finding")} dropped (unverified)`,
  feedsStale: (ids: readonly string[]) => `feeds stale: ${ids.join(", ")}`,
  paceStale: (cutoff: string) => `Pace stale: data to ${dayMonth(cutoff)}`,
  chineseNotReady: "Chinese edition not ready (E_ZH)",
  links: (broken: number, changed: number) => `links: ${broken} broken, ${changed} changed`,
  siteNotShowing: "site not yet showing this edition",
  usage: (pct: number, window: string) => `usage ${pct}% of ${window} limit`,
  statusNotSaved: "status not saved",
  replaced: (hhmm: string) => `replaced the ${hhmm} edition (--force)`,
  depsChanged: "Dependencies changed since the last npm ci",
  /** One for each file `unremovedSeeds()` lists (§8.13); a name that is not a plain file name is not shown. */
  seedRemoved: (file: string) => `seed/ledger/${SEED_FILE_RE.test(file) ? file : "(name not shown)"} still holds removed text`,
  /** One for each code a term fails in its own name (§8.9); the finding that first used it stands for the term, whose id holds the name. */
  termHidden: (firstFinding: string, code: string) => `term first used in ${firstFinding} hidden: ${code} in its name; a PR removes it`,
  /** One for each report JL upheld that has no correction yet (§8.9). */
  reportUpheld: (id: string) => `report ${id} (upheld by JL) has no correction yet`,
} as const;

/** The Notes line's order (§8.8); a note matching none goes last. */
const NOTE_ORDER: readonly RegExp[] = [
  /^\d+ findings? dropped \(unverified\)$/, /^feeds stale: /, /^Pace stale: /, /^Chinese edition not ready/, /^links: /, /^site not yet showing/,
  /^usage \d+% of /, /^status not saved$/, /^replaced the \d\d:\d\d edition/, /^Dependencies changed/, /^seed\/ledger\//, /^term first used in /,
  /^report R-\d{4} \(upheld by JL\)/,
];

/** Notes deduplicated and put in §8.8's order (`sort` is stable, so notes of the same kind keep their order). */
export function orderNotes(notes: readonly string[]): string[] {
  const rank = (n: string) => {
    const i = NOTE_ORDER.findIndex((re) => re.test(n));
    return i < 0 ? NOTE_ORDER.length : i;
  };
  return [...new Set(notes.map(oneLine).filter(Boolean))]
    .map((note) => ({ note, r: rank(note) }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.note);
}

/** The rate-limit window's name as the usage note says it: seven_day windows are "weekly". */
function windowWord(window: string): string {
  if (/seven_day|weekly/i.test(window)) return "weekly";
  if (/five_hour/i.test(window)) return "5-hour";
  return window.replace(/_/g, " ");
}

// ── Chat input ───────────────────────────────────────────────────────────────────────────────────

export type ChatInput =
  | { kind: "published"; brief: Brief; content: ChatContent; runs: RunRecord[]; notes: string[]; dryRun: boolean }
  | { kind: "data_only"; brief: Brief; content: ChatContent; runs: RunRecord[]; code: string | null; what: string;
      nextStep: string | null; notes: string[]; dryRun: boolean }
  | { kind: "failed"; date: string; code: string; what: string; errors: { code: string; path: string }[];
      siteShows: { date: string; edition: Edition } | null; nextStep: string; runs: RunRecord[];
      needsReview: boolean; notes: string[]; dryRun: boolean }
  | { kind: "skipped"; date: string; reason: string; briefUrl: string | null; dryRun: boolean };

/** What `chatInputFor()` builds a ChatInput from. */
export interface ChatSource {
  /** The edition date D. */
  date: string;
  /** The content as `loadContent()` returns it (in a dry run, the copy's): D's brief is the one in `briefs` dated D, if it loaded. */
  content: ChatContent;
  /** This run's records and the retry's, oldest first (`lastRunRecords()` picks them from a status file). */
  runs: readonly RunRecord[];
  /** Notes only the caller knows, such as CHAT_NOTES.statusNotSaved; merged into §8.8's order. */
  notes?: readonly string[];
  /** The file names `unremovedSeeds()` lists (§8.13), each as it is under `seed/ledger/`. */
  unremovedSeeds?: readonly string[];
  /** A failed run's validator issues: only each code and path is kept, never a message. */
  issues?: readonly { code: string; path: string; severity?: "error" | "warning"; message?: string }[] | null;
  /** The newest brief on GitHub's main, for the failed format's "Site shows" line. */
  siteShows?: { date: string; edition: Edition } | null;
  /** Default: a failed run that is not a dry run (finish copies its files to needs-review/D/). */
  needsReview?: boolean;
  /** The code of a failure that left no record (preflight steps 1 to 5). */
  code?: string | null;
  /** A dry run, for a failure that left no record; otherwise the records say so. */
  dryRun?: boolean;
  /** Default siteUrl() (config/run.json). */
  siteUrl?: string;
  /** Default config/run.json schedule. */
  schedule?: ChatSchedule;
}

const RUN_STARTS: ReadonlySet<string> = new Set(["schedule", "manual", "dry_run"]);

/**
 * The last run's records in a status file (§8.8): the last `schedule`, `manual` or `dry_run` record and every `retry` record after it.
 * With no such record, every record.
 */
export function lastRunRecords(runs: readonly RunRecord[]): RunRecord[] {
  let start = -1;
  runs.forEach((r, i) => {
    if (RUN_STARTS.has(r.trigger)) start = i;
  });
  if (start < 0) return [...runs];
  return [runs[start]!, ...runs.slice(start + 1).filter((r) => r.trigger === "retry")];
}

function stage(r: RunRecord, id: RunStage) {
  return r.stages.find((s) => s.id === id);
}

/** Agent attempts (records whose draft stage ran) and repair rounds (summed over the records). */
export function runCounts(runs: readonly RunRecord[]): { attempts: number; repairs: number } {
  return {
    attempts: runs.filter((r) => (stage(r, "draft")?.status ?? "skipped") !== "skipped").length,
    repairs: runs.reduce((n, r) => n + r.budgets.repair_rounds, 0),
  };
}

/** Attempt 1's start to the last record's end (its latest stage end, else its start, while unfinished). */
export function runSpan(runs: readonly RunRecord[]): { start: string; end: string } | null {
  const last = runs.at(-1);
  if (last === undefined) return null;
  const ends = last.stages.map((s) => s.ended_at).filter((t): t is string => t !== null).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { start: runs[0]!.started_at, end: last.finished_at ?? ends.at(-1) ?? last.started_at };
}

function allStageNotes(runs: readonly RunRecord[]): string {
  return runs.flatMap((r) => r.stages.flatMap((s) => (s.note === null ? [] : [s.note]))).join(" ");
}

/** The notes rebuilt from the records, the brief and the content (§8.8), before the caller's own. */
function rebuiltNotes(
  date: string, brief: Brief | null, content: ChatContent, runs: readonly RunRecord[], kind: ChatInput["kind"], dryRun: boolean,
): string[] {
  const out: string[] = [];
  const last = runs.at(-1);
  const notes = allStageNotes(runs);

  const dropped = runs.reduce((n, r) => n + (r.soft_gates?.dropped ?? 0), 0);
  if (dropped > 0) out.push(CHAT_NOTES.dropped(dropped));

  // The first record's feeds: the attempt that collected (a retry reuses its pack).
  const stale = (runs[0]?.feeds ?? []).filter((f) => f.status === "stale" || f.status === "failed").map((f) => f.id);
  if (stale.length) out.push(CHAT_NOTES.feedsStale(stale));

  if (brief && brief.pace.status === "stale") out.push(CHAT_NOTES.paceStale(brief.provenance.data_cutoff));

  if (runs.some((r) => r.error_code === "E_ZH")) out.push(CHAT_NOTES.chineseNotReady);

  const links = [...runs].reverse().find((r) => r.links !== null)?.links ?? null;
  if (links) {
    const broken = links.broken.filter((b) => b.result === "broken").length;
    const changed = links.broken.filter((b) => b.result === "changed").length;
    if (broken || changed) out.push(CHAT_NOTES.links(broken, changed));
  }

  if (!dryRun && last && brief && (kind === "published" || kind === "data_only")
    && (last.deploy.shows_date !== date || last.deploy.shows_edition !== brief.edition)) {
    out.push(CHAT_NOTES.siteNotShowing);
  }

  const usage = [...runs].reverse().find((r) => r.budgets.usage !== null)?.budgets.usage;
  if (usage && usage.utilization >= 0.8) out.push(CHAT_NOTES.usage(Math.round(usage.utilization * 100), windowWord(usage.window)));

  const replaced = NOTE_RES.replaced.exec(notes);
  if (replaced) out.push(CHAT_NOTES.replaced(replaced[1]!));

  if (NOTE_RES.depsChanged.test(notes)) out.push(CHAT_NOTES.depsChanged);

  // A term whose own name fails a safety code is not loaded; its first finding stands for it (§8.9). One note for each code.
  for (const hidden of content.hiddenTerms) {
    for (const code of hidden.codes) out.push(CHAT_NOTES.termHidden(hidden.first_finding, code));
  }
  for (const report of content.reports) {
    if (report.status === "upheld" && report.decided_by === "jl" && report.correction_id === null) out.push(CHAT_NOTES.reportUpheld(report.id));
  }
  return out;
}

// formatPath()'s forms: "(root)", "(file)", "(run)", or keys (`[A-Za-z_][A-Za-z0-9_]*`, never a dot or a hyphen inside one) and `[n]`
// indices joined by dots; at most one "<file>.json: " prefix.
const PATH_KEY = "[A-Za-z_][A-Za-z0-9_]*(?:\\[\\d+\\])*";
const SAFE_PATH_RE = new RegExp(
  `^(?:[a-z0-9_-]+(?:/[a-z0-9_-]+)*\\.json: )?(?:\\((?:root|file|run)\\)|(?:${PATH_KEY}|(?:\\[\\d+\\])+)(?:\\.${PATH_KEY})*)$`);
const SAFE_CODE_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * An issue path as the chat edition may show it: schema keys and `[n]` indices joined by dots (with at most one "<file>.json: "
 * prefix), at most 100 characters and free of the canary; anything else, such as an unknown key the draft invented with a dot, hyphen
 * or space in it, becomes "(path not shown)".
 */
export function safePath(path: string): string {
  const p = path.trim();
  return p.length <= 100 && SAFE_PATH_RE.test(p) && !CANARY_RE.test(p) ? p : "(path not shown)";
}

/**
 * Builds the ChatInput (§8.8) from the content, the run records, the caller's notes and, for a failed run, the validator's issues (code
 * and path only). The format follows the last record: `skipped`; an edition this run left published (`published_full`,
 * `published_partial`: published; `published_data_only`: data-only; a dry run: the record's `edition`, what the copy shows); else failed.
 * An edition the run published whose brief the loader left out is the failed format, with `BRIEF_LEFT_OUT`'s lines.
 */
export function chatInputFor(src: ChatSource): ChatInput {
  const { date, content } = src;
  const runs = [...src.runs];
  const last = runs.at(-1) ?? null;
  const schedule = src.schedule ?? SCHEDULE;
  const site = (src.siteUrl ?? configuredSiteUrl()).replace(/\/+$/, "");
  const brief = content.briefs.find((b) => b.date === date) ?? null;
  const dryRun = src.dryRun === true || runs.some((r) => r.trigger === "dry_run" || r.outcome === "dry_run");
  const notes = allStageNotes(runs);
  const extra = [...(src.notes ?? []), ...(src.unremovedSeeds ?? []).map(CHAT_NOTES.seedRemoved)];

  // Skipped: the outcome says so; a dry run that stopped at preflight step 6 carries the reason as a note.
  const skipNote = NOTE_RES.alreadyPublished.exec(notes) ?? NOTE_RES.tooLate.exec(notes) ?? NOTE_RES.tooEarly.exec(notes) ?? NOTE_RES.cyberRun.exec(notes);
  if (last?.outcome === "skipped" || (dryRun && skipNote)) {
    let reason = skipNote?.[0];
    if (!reason) {
      reason = last && taipeiTime(last.started_at) > schedule.publish_until
        ? STAGE_NOTES.tooLate(schedule.publish_until)
        : STAGE_NOTES.alreadyPublished(brief ? taipeiTime(brief.published_at) : taipeiTime(last!.started_at));
    }
    return { kind: "skipped", date, reason, briefUrl: brief ? `${site}/brief/${date}` : null, dryRun };
  }

  const coded = [...runs].reverse().find((r) => r.error_code !== null) ?? null;
  const code = coded?.error_code ?? src.code ?? null;
  const { attempts, repairs } = runCounts(runs);
  const errorIssues = (src.issues ?? []).filter((i) => i.severity !== "warning");
  const agentSeconds = last?.budgets.agent_seconds ?? 0;
  const facts: WhatFacts = {
    date,
    errors: src.issues ? errorIssues.length : (last?.validation?.errors ?? 0),
    repairs,
    attempts,
    agentMinutes: agentSeconds > 0 ? Math.max(1, Math.round(agentSeconds / 60)) : null,
    hardStop: schedule.hard_stop,
    publishUntil: schedule.publish_until,
  };
  // E_PUBLISH from a draft whose edition failed whole-tree validation: only the publish stage's note says so. A push failure keeps
  // E_PUBLISH's own lines. After a failed --force run the earlier full edition stands, so the hand publish command takes --force.
  const publishNote = code === "E_PUBLISH" && coded !== null ? stage(coded, "publish")?.note : undefined;
  const special = publishNote != null && NOTE_RES.notValid.test(publishNote) ? NOT_VALID : null;
  const what = (c: string) => (special ? special.what : whatHappened(c, facts));
  // A dry run's next step names its own files: nothing to rerun or publish by hand, no needs-review/D/.
  const next = (c: string) => {
    if (dryRun) return special ? special.dryRunStep.replaceAll("{date}", date) : dryRunNextStepFor(c, date);
    const step = special ? special.nextStep.replaceAll("{date}", date) : nextStepFor(c, date);
    return c === "E_PUBLISH" ? withForce(step, date, brief) : step;
  };

  let left: Edition | null = null;
  if (last && dryRun) left = last.edition;
  else if (last?.outcome === "published_full" || last?.outcome === "published_partial") left = brief?.edition ?? last.edition;
  else if (last?.outcome === "published_data_only") left = brief?.edition ?? "data_only";

  if (brief && (left === "full" || left === "partial")) {
    return { kind: "published", brief, content, runs, notes: orderNotes([...rebuiltNotes(date, brief, content, runs, "published", dryRun), ...extra]), dryRun };
  }
  if (brief && left === "data_only") {
    let said: string;
    if (code) {
      said = what(code);
    } else {
      const noted = NOTE_RES.dataOnlyRequested.exec(notes) ?? NOTE_RES.startedAfterHardStop.exec(notes);
      said = noted?.[0]
        ?? (last && taipeiTime(last.started_at) > schedule.hard_stop ? STAGE_NOTES.startedAfterHardStop(schedule.hard_stop) : STAGE_NOTES.dataOnlyRequested);
    }
    return {
      kind: "data_only", brief, content, runs, code, what: said, nextStep: code ? next(code) : null,
      notes: orderNotes([...rebuiltNotes(date, brief, content, runs, "data_only", dryRun), ...extra]), dryRun,
    };
  }

  const failCode = code ?? "E_INTERNAL";
  const unfinished = last !== null && last.outcome === null && code === null;
  const leftOut = left !== null && !dryRun;
  let errors: { code: string; path: string }[];
  if (src.issues) errors = errorIssues.map((i) => ({ code: SAFE_CODE_RE.test(i.code) ? i.code : "UNKNOWN", path: safePath(i.path) }));
  else if (failCode === "E_SIMULATED") errors = [{ code: "SIMULATED", path: "(run)" }];
  else if (failCode === "E_VALIDATION") errors = (last?.validation?.codes ?? []).map((c) => ({ code: c, path: "" }));
  else errors = [];
  return {
    kind: "failed",
    date,
    code: failCode,
    what: leftOut ? BRIEF_LEFT_OUT.what : unfinished ? "The run left no end record; it may have been stopped before it finished." : what(failCode),
    errors,
    siteShows: src.siteShows ?? null,
    nextStep: leftOut ? BRIEF_LEFT_OUT.nextStep : next(failCode),
    runs,
    needsReview: src.needsReview ?? !dryRun,
    notes: orderNotes([...rebuiltNotes(date, brief, content, runs, "failed", dryRun), ...extra]),
    dryRun,
  };
}

// ── Reading the content as the site does ─────────────────────────────────────────────────────────

/** Collapses every run of whitespace (newlines included) to one space, so no field adds a line. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The first sentence of a text on one line (`splitSentences()`, §4.1). */
function firstSentence(text: string): string {
  return splitSentences(oneLine(text))[0] ?? "";
}

const EDITION_WORD: Record<Edition, string> = { full: "full", partial: "partial", data_only: "data-only" };

/** The finding with this id as the corrections file it on `date` (§4.10), or undefined when the loader left it out. */
function filedLookup(content: ChatContent, date: string): (id: string) => Finding | undefined {
  const byId = new Map(content.findings.map((f) => [f.id, f]));
  return (id) => {
    const f = byId.get(id);
    return f === undefined ? undefined : filedAs(f, content.corrections, date);
  };
}

/** A brief entry (the story or an item) with the finding it names, filed on the brief's date. */
interface Shown { f: Finding; entry: BriefItem }

function shownOf(entry: BriefItem | null, find: (id: string) => Finding | undefined): Shown | null {
  if (entry === null) return null;
  const f = find(entry.finding_id);
  return f === undefined ? null : { f, entry };
}

/** The pips and the word of a significance: `●●●○ MAJOR` (Appendix A.3). */
function pipsWord(f: Pick<Finding, "significance">): string {
  const s = SIGNIFICANCE_INFO[f.significance];
  return `${s.pips} ${s.en.toUpperCase()}`;
}

/**
 * The finding kicker (§8.8): significance pips and word, field, AI role and rung, as filed on the edition's date. The role carries
 * `(claimed by <maker>)` only with confidence `claimed` and a system in `ai.systems`, naming the first system's maker.
 */
export function kicker(f: Pick<Finding, "significance" | "field" | "rung" | "ai">): string {
  const system = f.ai.systems[0];
  const claimed = f.ai.confidence === "claimed" && system !== undefined ? ` (claimed by ${oneLine(system.maker)})` : "";
  return [pipsWord(f), FIELD_INFO[f.field].en, `${AI_ROLE_INFO[f.ai.role].en}${claimed}`, RUNG_INFO[f.rung].en].join(" · ");
}

/** One explainer part's English text; a finding whose AI role is none has no `ai_helped` part, and the missing part says so (§8.8). */
const partText = (f: Finding, part: ExplainerPart): string => f.explainer[part]?.en ?? NO_AI_PART.en;

const findingLink = (site: string, id: string) => `${site}/findings/${id}`;
const briefLink = (site: string, date: string) => `${site}/brief/${date}`;

/** The rung changes of a brief whose finding loaded, as "<title> Preprint → Checked". */
function changeEntries(brief: Brief, find: (id: string) => Finding | undefined): string[] {
  return brief.rung_changes.flatMap((c) => {
    const f = find(c.finding_id);
    return f === undefined ? [] : [`${oneLine(f.title.en)} ${RUNG_INFO[c.from].en} → ${RUNG_INFO[c.to].en}`];
  });
}

/** At most 3 entries, then "and k more", joined by "; ". */
function capped(entries: readonly string[]): string {
  return [...entries.slice(0, 3), ...(entries.length > 3 ? [`and ${entries.length - 3} more`] : [])].join("; ");
}

/** The "target" a correction names: its finding, edition date or term id. */
const targetOf = (c: { finding_id: string | null; edition_date: string | null; term_id: string | null }) =>
  c.finding_id ?? c.edition_date ?? c.term_id ?? "";

/**
 * The corrections of a brief that the site shows: one stored in `corrections.json` and whose target is an edition, a finding that
 * loaded or a term that loaded (a term's id holds its name, so a hidden term is never named, §8.9).
 */
function shownCorrections(brief: Brief, content: ChatContent, find: (id: string) => Finding | undefined): Brief["corrections"] {
  const stored = new Set(content.corrections.map((c) => c.id));
  const terms = new Set(content.terms.map((t) => t.id));
  return brief.corrections.filter((c) =>
    stored.has(c.id) && (c.finding_id === null || find(c.finding_id) !== undefined) && (c.term_id === null || terms.has(c.term_id)));
}

/** The decided reports of a brief that the site shows: one stored in `reports.json` about a finding that loaded. */
function shownReports(brief: Brief, content: ChatContent, find: (id: string) => Finding | undefined): Brief["reports"] {
  const stored = new Set(content.reports.map((r) => r.id));
  return brief.reports.filter((r) => stored.has(r.id) && find(r.finding_id) !== undefined);
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────

const dryRunLine = (date: string) => `Dry run: nothing was published; files in logs/dry-run/${date}/`;
const notesLine = (notes: readonly string[]) => (notes.length ? `Notes: ${notes.map(oneLine).join(" · ")}` : null);

/** "Chinese done", "Chinese failed" or "Chinese not run": the last record that has a Chinese record (§8.8). */
function chineseWord(runs: readonly RunRecord[]): string {
  const outcome = [...runs].reverse().find((r) => r.zh !== null)?.zh?.outcome;
  return outcome === "ok" ? "done" : outcome === "failed" ? "failed" : "not run";
}

/** The run line: the run's span, the data-only time, attempts and repairs, then (published) Chinese and sources, then the Pace's data. */
function runLine(runs: readonly RunRecord[], brief: Brief, withFull: boolean): string | null {
  const span = runSpan(runs);
  if (!span) return null;
  const { attempts, repairs } = runCounts(runs);
  const parts = [`Run ${taipeiTime(span.start)}–${taipeiTime(span.end)}`];
  const dataOnly = runs.map((r) => r.data_only_published_at).find((t) => t !== null) ?? null;
  if (dataOnly !== null) parts.push(`data-only ${taipeiTime(dataOnly)}`);
  parts.push(`${count(attempts, "attempt")}${repairs ? `, ${count(repairs, "repair")}` : ""}`);
  if (withFull) {
    parts.push(`Chinese ${chineseWord(runs)}`);
    parts.push(count(brief.computed.source_count, "source"));
  }
  parts.push(`Pace data to ${dayMonth(brief.provenance.data_cutoff)}`);
  return parts.join(" · ");
}

const isLine = (l: string | null): l is string => l !== null && l.trim() !== "";

/** A brief-level text's paragraphs, each on one line. */
const paragraphs = (text: string): string[] => text.split(/\n\s*\n/).map(oneLine).filter(Boolean);

/** A long brief-level text (the big picture, the deep dive) as lines: one for each paragraph when `spread`, else the whole text on one line. */
const body = (text: string, spread: boolean): string[] => (spread ? paragraphs(text) : [oneLine(text)]);

/** The review's most remarkable finding as filed on the edition's date, with its note, when the brief names one that loaded. */
function remarkableOf(review: WeekReview, find: (id: string) => Finding | undefined): { f: Finding; note: string } | undefined {
  const named = review.remarkable;
  const f = named === null ? undefined : find(named.finding_id);
  return f === undefined ? undefined : { f, note: named!.note.en };
}

/** The line groups of a published edition: what comes before the More list, the More lines, and what follows them. */
interface Layout { before: string[]; more: string[]; after: string[] }

function publishedLayout(input: Extract<ChatInput, { kind: "published" }>, site: string, spread: boolean): Layout {
  const { brief: b, content } = input;
  const D = b.date;
  const find = filedLookup(content, D);
  const english = b.languages.zh ? "" : ", English-only";
  const first = input.dryRun
    ? `**${SITE_NAME} ${D} · dry run (${EDITION_WORD[b.edition]} edition${english})**`
    : `**${SITE_NAME} ${D} · ${EDITION_WORD[b.edition]} edition${english}, published ${taipeiTime(b.published_at)}${b.late ? " (late)" : ""}**`;
  const disclosed = (path: string) => (b.disclosure.includes(path) ? [DISCLOSURE.en] : []);

  const before: string[] = [first, oneLine(b.pace.sentence.en), oneLine(b.lead.map((l) => l.text.en).join(" "))];
  if (b.story === null && b.items.length === 0) before.push("No new findings today.");

  // Monday: the week in review, in its short form when `remarkable` is null (§4.5).
  const review = b.review;
  if (review !== null) {
    const remarkable = remarkableOf(review, find);
    before.push(
      "**The week in review**",
      ...body(review.big_picture.en, spread),
      ...(remarkable === undefined
        ? []
        : [`Most remarkable: ${oneLine(remarkable.f.title.en)} · ${oneLine(remarkable.note)} ${findingLink(site, remarkable.f.id)}`]),
      `Strongest evidence against: ${oneLine(review.strongest_against.text.en)}`,
      ...disclosed("review"),
      `Charts: ${briefLink(site, D)}#review`,
    );
  }

  // Sunday: the deep dive in full, a line for each paragraph, when its finding loaded.
  const sunday = b.format === "sunday_deep_dive";
  const dive = b.deep_dive;
  const diveFinding = dive === null ? undefined : find(dive.finding_id);
  if (dive !== null && diveFinding !== undefined) {
    before.push(`**Sunday deep dive: ${oneLine(diveFinding.title.en)}**`, ...body(dive.text.en, spread), ...disclosed("deep_dive"));
  }

  // The story's six parts, except on a Sunday, where the findings are all More lines.
  const storyShown = sunday ? null : shownOf(b.story, find);
  if (storyShown !== null) {
    const f = storyShown.f;
    before.push(`**Story of the day: ${oneLine(f.title.en)}**`, kicker(f));
    if (!storyShown.entry.new && storyShown.entry.update !== null) before.push(`Back: ${firstSentence(storyShown.entry.update.en)}`);
    for (const part of EXPLAINER_PARTS) {
      before.push(`**${EXPLAINER_PART_INFO[part].en}.** ${oneLine(partText(f, part))}`);
    }
    if (f.disclosure) before.push(DISCLOSURE.en);
    before.push(`Read it: ${findingLink(site, f.id)}`);
  }

  const entries = [...(sunday ? [b.story] : []), ...b.items];
  const shown = entries.flatMap((e) => shownOf(e, find) ?? []);
  const more = shown.map((s, i) => {
    const f = s.f;
    const said = s.entry.new || s.entry.update === null ? firstSentence(f.explainer.found.en) : `Back: ${firstSentence(s.entry.update.en)}`;
    return `${i + 1}. ${oneLine(f.title.en)} · ${pipsWord(f)} · ${FIELD_INFO[f.field].en} · ${RUNG_INFO[f.rung].en} · ${said}${f.disclosure ? ` ${DISCLOSURE.en}` : ""} ${findingLink(site, f.id)}`;
  });
  if (more.length) before.push("**More:**");

  const changes = changeEntries(b, find);
  const corrections = shownCorrections(b, content, find);
  const reports = shownReports(b, content, find);
  const links = input.dryRun
    ? dryRunLine(D)
    : `Full brief: ${briefLink(site, D)}${b.languages.zh ? ` · 中文: ${site}/zh/brief/${D}` : ""}`;
  const after = [
    changes.length ? `Climbed or fell: ${capped(changes)}` : null,
    b.ideas.length || b.also.length ? `Ideas and debate (${b.ideas.length}) · Also noted (${b.also.length}): ${briefLink(site, D)}` : null,
    corrections.length ? `Corrections: ${capped(corrections.map((c) => `${c.id} ${c.type} to ${targetOf(c)}`))}` : null,
    reports.length ? `Reports: ${capped(reports.map((r) => `${r.id} ${r.status} (${r.finding_id})`))}` : null,
    links,
    notesLine(input.notes),
    runLine(input.runs, b, true),
  ].filter((l): l is string => l !== null);
  return { before, more, after };
}

/**
 * The lines of a published edition cut to `CHAT_MAX_LINES` (§8.8), in two steps that lose the least. First, when the lines (a line for
 * each paragraph of the big picture and the deep dive) do not fit, each of those texts is put on one line, which drops no word. Then,
 * when the lines still do not fit, the More lines at the end of the list are replaced by one `and k more: <brief link>` line, never
 * any other line. With each long text on one line every other group together is at most 29 lines, so the cap always holds.
 */
function fitLines(input: Extract<ChatInput, { kind: "published" }>, site: string): string[] {
  const all = (layout: Layout) => [...layout.before.filter(isLine), ...layout.more.filter(isLine), ...layout.after.filter(isLine)];
  const spread = all(publishedLayout(input, site, true));
  if (spread.length <= CHAT_MAX_LINES) return spread;
  const { before, more, after } = publishedLayout(input, site, false);
  const [head, list, tail] = [before.filter(isLine), more.filter(isLine), after.filter(isLine)];
  if (head.length + list.length + tail.length <= CHAT_MAX_LINES) return [...head, ...list, ...tail];
  const keep = Math.max(0, CHAT_MAX_LINES - head.length - tail.length - 1);
  return [...head, ...list.slice(0, keep), `and ${list.length - keep} more: ${briefLink(site, input.brief.date)}`, ...tail];
}

function dataOnlyLines(input: Extract<ChatInput, { kind: "data_only" }>, site: string): (string | null)[] {
  const { brief: b, content } = input;
  const D = b.date;
  const find = filedLookup(content, D);
  const code = input.code ? ` (${input.code})` : "";
  const first = input.dryRun
    ? `**${SITE_NAME} ${D} · dry run (data-only edition)**${code}`
    : `**${SITE_NAME} ${D} · data-only edition, published ${taipeiTime(b.published_at)}**${code}`;
  const changes = changeEntries(b, find);
  return [
    first,
    oneLine(b.pace.sentence.en),
    changes.length ? `Climbed or fell: ${capped(changes)}` : "Climbed or fell: none since the last edition.",
    `What happened: ${oneLine(input.what)}`,
    input.nextStep ? `Next step: ${oneLine(input.nextStep)}` : null,
    input.dryRun ? dryRunLine(D) : `Brief: ${briefLink(site, D)}`,
    notesLine(input.notes),
    runLine(input.runs, b, false),
  ];
}

function failedLines(input: Extract<ChatInput, { kind: "failed" }>): (string | null)[] {
  const D = input.date;
  const errors = input.errors.slice(0, 5).map((e) => `- ${e.code}${e.path ? ` at ${e.path}` : ""}`);
  const span = runSpan(input.runs);
  const { attempts, repairs } = runCounts(input.runs);
  return [
    input.dryRun ? `**${SITE_NAME} ${D} · dry run (failed)** (${input.code})` : `**${SITE_NAME} ${D} · failed** (${input.code})`,
    `What happened: ${oneLine(input.what)}`,
    ...(errors.length ? ["First errors:", ...errors] : []),
    input.dryRun
      ? "Dry run: nothing was published."
      : input.siteShows ? `Site shows: the ${input.siteShows.date} ${EDITION_WORD[input.siteShows.edition]} edition` : "Site shows: no edition yet.",
    input.needsReview ? `Draft and logs: needs-review/${D}/` : null,
    `Next step: ${oneLine(input.nextStep)}`,
    notesLine(input.notes),
    span ? `Run: started ${taipeiTime(span.start)}, ended ${taipeiTime(span.end)} · attempts ${attempts}, repairs ${repairs}` : null,
  ];
}

function skippedLines(input: Extract<ChatInput, { kind: "skipped" }>): (string | null)[] {
  const head = input.dryRun ? `**${SITE_NAME} ${input.date} · dry run (skipped).**` : `**${SITE_NAME} ${input.date} · skipped.**`;
  return [`${head} ${oneLine(input.reason)}`, input.briefUrl];
}

// ── The last step (§8.8) ─────────────────────────────────────────────────────────────────────────

// The characters that mark a placeholder or an emoji are built from code points, so no tool turns an escape in this file into the
// character itself.
const OPEN = String.fromCharCode(0xe000);
const CLOSE = String.fromCharCode(0xe001);
const DEFANGED_SCHEME_RE = /^hxxps?:\/\//i;
/** A character a URL may hold. A renderer may read on past one that is not (GFM ends a bare URL only at a space or "<"). */
const URL_CHAR_RE = /[^\s<>"'`\\]/;
/** The URL characters from `lastIndex` on. */
const URL_RUN_RE = /[^\s<>"'`\\]*/y;
const SCHEME_CHAR_RE = /[A-Za-z0-9+.-]/;
const ASCII_LETTER_RE = /[A-Za-z]/;
/** What ends a URL without belonging to it. */
const TRAILING_PUNCT = ".,;:!?)]}";
/** The spaces after "](", and a destination's own characters. */
const SPACES_RE = /\s*/y;
const DEST_RUN_RE = /[^\s)]*/y;
/** A CommonMark autolink, `<scheme:...>`: `<https:evil.example>` links without the slashes. */
const AUTOLINK_RE = /<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*)>/gi;
/** A protocol-relative URL, "//host...", which resolves to https on that host. */
const PROTOCOL_RELATIVE_RE = /(?<![\p{L}\p{N}_:/\\])\/\/(?=[\p{L}\p{N}])[^\s<>"'`]*/gu;
/** The "@" and domain of an e-mail address, which GFM links as `mailto:`; the local part is read backwards from the "@". */
const EMAIL_DOMAIN_RE = /@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const EMAIL_LOCAL_CHAR_RE = /[A-Za-z0-9._%+-]/;
/** A "www." host, which GFM auto-links whatever its TLD. */
const WWW_RE = /(?<![\p{L}\p{N}])www\.[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*/giu;
const PICTOGRAPHIC_RE = new RegExp(
  `[\\p{Extended_Pictographic}\\p{Regional_Indicator}${String.fromCharCode(0xfe0f, 0x200d, 0x20e3)}]`, "gu");
const PRIVATE_USE_RE = new RegExp(`[${OPEN}-${String.fromCharCode(0xf8ff)}]`, "g");
const CANARY_RE = new RegExp(escapeRegExp(CANARY_TOKEN), "i");
const CANARY_ALL_RE = new RegExp(escapeRegExp(CANARY_TOKEN), "gi");
const RESTORE_RE = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");
/**
 * A "<" that would open HTML in Markdown: one directly followed by a letter (a tag), "/" (a closing tag), "!" (a comment or declaration)
 * or "?" (a processing instruction). Group 1 holds the backslashes just before it, all of them (a start inside a run of backslashes
 * is refused, so a long run is read once): an odd number already escape it.
 */
const TAG_OPEN_RE = /(?<!\\)(\\*)<(?=[\p{L}/!?])/gu;
/** What a renderer may link: the "://" of a URL with a character after it that a host can start with, or "www.". */
const LINKISH_RE = /:\/\/(?=[^\s<>"'`\\])|www\./gi;
/** AUTOLINK_RE where it starts at `lastIndex`, to tell whether a "<" opens an autolink. */
const AUTOLINK_AT_RE = new RegExp(AUTOLINK_RE.source, "y");
/** The start of a string up to its first bracket, parenthesis, brace, "|" or "^": characters a URL parser may end a URL at. */
const BEFORE_BRACKET_RE = /^[^()[\]{}|^]*/;
/** A destination that the guard may keep: no space and no "<" inside, or just one `<...>` whose inside holds neither. */
const KEPT_DEST_RE = /^(?:<[^\s<>]*>|[^\s<]*)$/;
/** A link label and its colon, `[x]:`, whatever the label holds (a backslash escapes a bracket in it). */
const LABEL_COLON = String.raw`\[(?:[^\]\\]|\\.)*\]:`;
/**
 * A line that would open a table, heading, quote or code block, define a link reference ("[x]: dest"), or be a rule or the underline
 * that turns the line above it into a heading (a line of only "-", "*" or "_" with spaces between; "=" starts the line already).
 */
const BLOCK_START_RE = new RegExp(`^(?:[|#>=]|\`\`\`|~~~|${LABEL_COLON}|[-*_](?:\\s*[-*_])*\\s*$)`);
/**
 * The list or quote markers that start a line ("- ", "1. ", "> ", as many as nest) when a link reference definition follows them:
 * a definition inside a list item defines its label for the whole message, so a "[x]" in another line would link to it.
 */
const CONTAINED_DEFINITION_RE = new RegExp(`^((?:(?:[-+*]|\\d{1,9}[.)])[ \\t]+|>[ \\t]?)+)(?=${LABEL_COLON})`);

/** Where the punctuation that ends `text` up to `end` (the tail of "https://x/a).") starts, not before `lo`. */
function trailingPunctFrom(text: string, lo: number, end: number = text.length): number {
  let at = end;
  while (at > lo && TRAILING_PUNCT.includes(text.charAt(at - 1))) at--;
  return at;
}

/**
 * Where the next URL in `s` starts at or after `from`: [the start of its scheme, the start of what follows "://"], or null. A URL is a
 * scheme (a letter, then letters, digits, "+", "." or "-"), "://" and at least one URL character. A scheme starts at the first letter of
 * the run of those characters before "://", whatever comes before the run: some renderers link "1https://x" and "a_https://x" too. This
 * walks back from each "://" over the scheme characters, instead of trying every start in a long run of them, so a run costs one pass.
 */
function nextUrl(s: string, from: number): [number, number] | null {
  for (let at = s.indexOf("://", from); at !== -1; at = s.indexOf("://", at + 1)) {
    if (!URL_CHAR_RE.test(s.charAt(at + 3))) continue;
    let run = at;
    while (run > from && SCHEME_CHAR_RE.test(s.charAt(run - 1))) run--;
    for (let start = run; start < at; start++) {
      if (ASCII_LETTER_RE.test(s.charAt(start))) return [start, at + 3];
    }
  }
  return null;
}

/**
 * `text` with each e-mail address (local part, "@", domain) replaced by "[link removed]". The pattern [A-Za-z0-9._%+-]+@domain tried at
 * every start of a long run of local-part characters would read the run again for each; finding the "@" first and reading its local
 * part backwards (not before the end of the last address) reads each character once, and finds the same addresses.
 */
function removeEmails(text: string): string {
  let out = "";
  let pos = 0;
  for (const m of text.matchAll(EMAIL_DOMAIN_RE)) {
    let start = m.index;
    while (start > pos && EMAIL_LOCAL_CHAR_RE.test(text.charAt(start - 1))) start--;
    if (start === m.index) continue;
    out += `${text.slice(pos, start)}[link removed]`;
    pos = m.index + m[0].length;
  }
  return out + text.slice(pos);
}

/**
 * `text` with the destination of each Markdown link or image, "](dest" (`<dest>` too), whatever the link text holds, kept when it is one
 * plain site URL and otherwise made "[link removed]". "[link removed" is the guard's own text and stays: the "]" after it is read as
 * the start of the next "](". A "(" right after a destination that was made "[link removed]" gets a backslash, so the "]" it ends with
 * cannot open a link. Walks the text once (the pattern /\]\(\s*(<[^>]*>|...)/ tried at each "](<" with no ">" after it would read
 * to the end each time).
 */
function fixDests(text: string, isSite: (url: string) => boolean): string {
  let out = "";
  let pos = 0;
  let gt = -2; // where the first ">" at or after the last place looked from is: -1 for none, -2 before it is looked for
  for (let at = text.indexOf("](", 0); at !== -1; at = text.indexOf("](", pos)) {
    SPACES_RE.lastIndex = at + 2;
    const from = at + 2 + SPACES_RE.exec(text)![0].length;
    if (text.charAt(from) === "<" && (gt === -2 || (gt !== -1 && gt < from))) gt = text.indexOf(">", from + 1);
    let dest: string;
    if (text.charAt(from) === "<" && gt !== -1) {
      dest = text.slice(from, gt + 1);
    } else if (text.startsWith("[link removed]", from)) {
      out += `${text.slice(pos, at)}](${text.slice(from, from + 13)}`;
      pos = from + 13;
      continue;
    } else {
      DEST_RUN_RE.lastIndex = from;
      dest = DEST_RUN_RE.exec(text)![0];
    }
    const end = from + dest.length;
    const paren = text.charAt(end) === "("; // only after a `<...>` destination: a plain one reads on through a "("
    const keep = KEPT_DEST_RE.test(dest) && isSite(dest.replace(/^<|>$/g, ""));
    out += keep ? text.slice(pos, end + (paren ? 1 : 0)) : `${text.slice(pos, at)}]([link removed]${paren ? "\\(" : ""}`;
    pos = end + (paren ? 1 : 0);
  }
  return out + text.slice(pos);
}

/** Whether the "<" at `at` is not escaped: an even number of backslashes (none too) come before it. */
function isOpenAngle(text: string, at: number): boolean {
  if (text.charAt(at) !== "<") return false;
  let slashes = 0;
  while (at - slashes > 0 && text.charAt(at - slashes - 1) === "\\") slashes++;
  return slashes % 2 === 0;
}

/**
 * One token of a line (no space in it) with each "<" that would open HTML escaped by a backslash, unless an odd number of backslashes
 * already escape it or it opens a `<site url>` autolink. A renderer that links a bare URL (or a "www." host) before it reads a
 * backslash escape takes the backslash into the link ("https://site/a\\<b>" gives a link and a live tag), so when a "://" or a "www."
 * comes earlier in the token, the run of backslashes and the "<" start a new token: a space goes before them.
 */
function escapeTags(token: string): string {
  let out = "";
  let pos = 0;
  let from = 0; // the token's current part starts here: a link before it cannot swallow a backslash after it
  let link = -1; // where the first "://" or "www." at or after `from` starts, once looked for
  let looked = false;
  for (const m of token.matchAll(TAG_OPEN_RE)) {
    const at = m.index;
    const slashes = m[1]!.length;
    AUTOLINK_AT_RE.lastIndex = at + slashes;
    if (AUTOLINK_AT_RE.test(token)) {
      from = AUTOLINK_AT_RE.lastIndex; // an autolink ends at its own ">": a URL in it cannot swallow what comes after
      continue;
    }
    if (!looked || (link !== -1 && link < from)) {
      LINKISH_RE.lastIndex = from;
      link = LINKISH_RE.exec(token)?.index ?? -1;
      looked = true;
    }
    out += token.slice(pos, at) + (link !== -1 && link < at ? " " : "") + m[1]! + (slashes % 2 === 1 ? "<" : "\\<");
    pos = at + slashes + 1;
    from = pos;
  }
  return out + token.slice(pos);
}

/**
 * The last step of every line (§8.8), so nothing the Claude app's Markdown links points off-site or renders as HTML. In this order:
 * private-use characters, emoji and the canary (in any case) go first, so that taking them out cannot join the pieces of a link, a tag
 * or the canary; a `<scheme:...>` autolink, a URL of any scheme (the defanged hxxp(s) stays, but a URL inside it does not) and a
 * protocol-relative "//host" that do not start with `siteUrl` become "[link removed]". A kept site URL ends at its first bracket,
 * parenthesis, brace, "|" or "^" (a URL after one is read too) and holds no "@"; a bare `siteUrl` is kept only when a space, a "<", the
 * end of the line or the ">" of its own autolink follows it: a renderer may read on past a quote and take the host for part of a longer
 * name or for a user name, `siteUrl".evil.example` or `siteUrl"@host`. An e-mail address and a "www." host, which Markdown links on its
 * own, go too. Spaces around and inside the line are tidied (a line never starts with a space, which Markdown allows before a heading
 * marker). Then each Markdown link or image destination that is not one plain site URL becomes "[link removed]", read last so that one
 * a removal made is caught too (a "(" that follows a destination the guard removed gets a backslash, so the "]" it ends with cannot
 * open a link). A "<" that would open an HTML tag, comment, declaration or processing instruction (one directly followed by a letter,
 * "/", "!" or "?") gets a backslash, so the text shows as written and nothing renders, unless an odd number of backslashes already
 * escape it or it opens a kept `<site url>` autolink; a space goes before that backslash when a link comes earlier in its word, since
 * a renderer reads a bare URL to the next space or "<" and would take the backslash into the link. A line that would open a table,
 * heading, quote or code block, define a link reference (also inside a list item or quote), or be a rule, is escaped with a backslash.
 * Guarding a guarded line changes nothing, and every step reads the line once, so a long line costs a long pass, not a quadratic one.
 */
export function chatGuard(line: string, siteUrl: string): string {
  const site = siteUrl.replace(/\/+$/, "");
  const isSite = (u: string) => u === site || [`${site}/`, `${site}#`, `${site}?`].some((p) => u.startsWith(p));
  const kept: string[] = [];
  let s = line.replace(PRIVATE_USE_RE, "").replace(PICTOGRAPHIC_RE, "").replace(CANARY_ALL_RE, "[removed]");
  s = s.replace(AUTOLINK_RE, (m: string, url: string) => (isSite(url) ? m : "[link removed]"));
  // The URLs, one after another (not nested: a defanged URL, or a site URL up to a bracket, is kept and what follows it is read again).
  let out = "";
  let pos = 0;
  // The URL characters last read: where they start and end, where their trailing punctuation starts, and whether they hold an "@".
  let run = { from: 0, end: -1, trim: 0, at: false };
  for (let hit = nextUrl(s, pos); hit !== null; hit = nextUrl(s, pos)) {
    const [start, body] = hit;
    out += s.slice(pos, start);
    const scheme = s.slice(start, body);
    if (DEFANGED_SCHEME_RE.test(scheme)) {
      out += scheme;
      pos = body;
      continue;
    }
    if (body < run.from || body >= run.end) {
      URL_RUN_RE.lastIndex = body;
      const end = body + URL_RUN_RE.exec(s)![0].length;
      run = { from: body, end, trim: trailingPunctFrom(s, body, end), at: s.slice(body, end).includes("@") };
    }
    const url = s.slice(start, run.trim);
    // A bare site URL is the host alone: a renderer that reads on past the character after it (a quote, a backslash) can take it for part
    // of a longer host name, `siteUrl".evil.example`, or for a user name, `siteUrl"@host`. Only a space, a "<", the end of the line or the
    // ">" of the URL's own autolink ends it for every renderer, so only then is it kept.
    const after = s.charAt(run.end);
    const closed = after === "" || /[\s<]/.test(after) || (after === ">" && isOpenAngle(s, start - 1));
    // An "@" in a URL is kept out too: a renderer that ends a link at a "|" would link an address after it as `mailto:`.
    if (isSite(url) && !run.at && (url !== site || closed)) {
      // Only up to a bracket or parenthesis is kept: what follows one is read again, since a Markdown renderer may end the link there.
      const core = BEFORE_BRACKET_RE.exec(url)![0];
      kept.push(core);
      out += `${OPEN}${kept.length - 1}${CLOSE}`;
      pos = start + core.length;
    } else {
      out += "[link removed]";
      pos = run.trim;
    }
  }
  s = out + s.slice(pos);
  s = removeEmails(s);
  s = s.replace(WWW_RE, "[link removed]");
  s = s.replace(PROTOCOL_RELATIVE_RE, (match: string) => `[link removed]${match.slice(trailingPunctFrom(match, 0))}`);
  s = s.replace(/ {2,}/g, " ").trim();
  s = s.replace(RESTORE_RE, (_m, i: string) => kept[Number(i)]!);
  s = fixDests(s, isSite);
  // An autolink left by now is the site's: every other one is gone.
  s = s.replace(/\S+/g, (token: string) => escapeTags(token));
  s = s.replace(CONTAINED_DEFINITION_RE, (_m, markers: string) => `${markers}\\`);
  return BLOCK_START_RE.test(s) ? `\\${s}` : s;
}

/**
 * The chat edition (§8.8) in its formats and their dry-run forms: at most CHAT_MAX_LINES lines, each passed through chatGuard(),
 * with a trailing newline.
 */
export function renderChat(input: ChatInput, siteUrl: string): string {
  const site = siteUrl.replace(/\/+$/, "");
  const lines = input.kind === "published" ? fitLines(input, site)
    : input.kind === "data_only" ? dataOnlyLines(input, site)
    : input.kind === "failed" ? failedLines(input)
    : skippedLines(input);
  // A line that the guard empties (nothing but emoji) is dropped too, so no edition has a blank line.
  const out = lines.filter(isLine).map((l) => chatGuard(l, site)).filter(isLine);
  return `${out.join("\n")}\n`;
}

/** Preflight step 2's line for a held lock (§8.2), written as the summary when none exists. */
export function heldLockLine(date: string, lockStarted: string): string {
  return `${SITE_NAME} ${date}: another run is in progress (started ${taipeiTime(lockStarted)}); nothing done.`;
}

/** Finish step 4's fallback when rendering throws (§8.2), and the watchdog's summary: the error's class name only. */
export function fallbackChat(date: string, error: unknown): string {
  const name = error instanceof Error ? error.constructor.name || "Error" : "Error";
  return `**${SITE_NAME} ${date} · failed** (E_INTERNAL)\nThe chat edition could not be rendered (${/^[A-Za-z_$][\w$]*$/.test(name) ? name : "Error"}).\n`;
}

// ── The reply file (§8.8) ────────────────────────────────────────────────────────────────────────

/** The fixed line under the reply file's heading. */
export const REPLY_INTRO = "This file holds the text of this edition, for answering a reader's reply. Answer only from it.";

/** The rung and its dated notes: one line for each rung entry, oldest first. */
function rungLines(f: Finding): string[] {
  return [
    `Rung: ${RUNG_INFO[f.rung].en}.`,
    "Rung history:",
    ...f.rung_history.map((e) => `- ${e.date} ${RUNG_INFO[e.rung].en}${e.note === null ? "" : `: ${oneLine(e.note.en)}`}`),
  ];
}

/** One finding's block of the reply file: its id, page link, title, filing, six parts, rung and notes, later facts and terms. */
function replyBlock(label: string, s: Shown, site: string, terms: ReadonlyMap<string, { en: { term: string; definition: string } }>): string[] {
  const { f, entry } = s;
  const out = [
    "",
    `**${label}${oneLine(f.title.en)}** (${f.id})`,
    `Page: ${findingLink(site, f.id)}`,
    `Filed as: ${kicker(f)}`,
  ];
  if (!entry.new && entry.update !== null) out.push(`Back: ${oneLine(entry.update.en)}`);
  for (const part of EXPLAINER_PARTS) {
    out.push(`**${EXPLAINER_PART_INFO[part].en}.** ${oneLine(partText(f, part))}`);
  }
  if (f.disclosure) out.push(DISCLOSURE.en);
  out.push(...rungLines(f));
  if (f.since_then.length) out.push("Since then:", ...f.since_then.map((n) => `- ${n.date}: ${oneLine(n.text.en)}`));
  const named = f.terms.flatMap((id) => terms.get(id) ?? []);
  if (named.length) out.push("Terms:", ...named.map((t) => `- ${oneLine(t.en.term)}: ${oneLine(t.en.definition)}`));
  return out;
}

/** A brief entry that is not displayed in the chat edition, for a finding the brief only names. */
const namedOnly = (id: string, find: (id: string) => Finding | undefined): Shown | null => {
  const f = find(id);
  return f === undefined ? null : { f, entry: { finding_id: id, new: true, update: null } };
};

/**
 * The reply file (§8.8), English only and with no line cap: from the brief as committed and the findings, terms and reports it names,
 * each line through `chatGuard()`. It holds the Lead and the Pace, the week review (Mondays) or the deep dive (Sundays) when set, each
 * finding the brief names (the story and the More items numbered as the chat edition numbers them, then the others) with its id, page
 * link, title, filing, six parts, rung and dated notes, later facts and terms, the text of each Ideas and debate line and the title
 * of each Also noted line, the Climbed or fell entries, and the reasons of the corrections and report decisions the brief lists, with
 * `DISCLOSURE` under each part that carries it. Never a source's title, publisher or URL, a quote, a `who` name or a reaction.
 */
export function renderReply(brief: Brief, content: ChatContent, siteUrl: string): string {
  const site = siteUrl.replace(/\/+$/, "");
  const D = brief.date;
  const find = filedLookup(content, D);
  const terms = new Map(content.terms.map((t) => [t.id, t]));
  const disclosed = (path: string) => (brief.disclosure.includes(path) ? [DISCLOSURE.en] : []);
  const out: string[] = [`**${SITE_NAME} ${D} · reply file**`, REPLY_INTRO, ""];
  const lead = brief.lead.map((l) => oneLine(l.text.en)).filter(Boolean);
  if (lead.length) out.push("**Lead**", ...lead, "");
  out.push("**Pace**", oneLine(brief.pace.sentence.en));

  const review = brief.review;
  if (review !== null) {
    const remarkable = remarkableOf(review, find);
    out.push("", "**The week in review**");
    for (const p of paragraphs(review.big_picture.en)) out.push(p, "");
    if (remarkable !== undefined) out.push(`Most remarkable: ${oneLine(remarkable.f.title.en)} (${remarkable.f.id}) · ${oneLine(remarkable.note)}`);
    out.push(`Strongest evidence against: ${oneLine(review.strongest_against.text.en)}`, ...disclosed("review"));
  }
  const dive = brief.deep_dive;
  const diveFinding = dive === null ? undefined : find(dive.finding_id);
  if (dive !== null && diveFinding !== undefined) {
    out.push("", `**Sunday deep dive: ${oneLine(diveFinding.title.en)}** (${diveFinding.id})`);
    for (const p of paragraphs(dive.text.en)) out.push(p, "");
    out.push(...disclosed("deep_dive"));
  }

  // The findings in the chat edition's order and numbering, then the others the brief names, each once.
  const sunday = brief.format === "sunday_deep_dive";
  const story = sunday ? null : shownOf(brief.story, find);
  const items = [...(sunday ? [brief.story] : []), ...brief.items].flatMap((e) => shownOf(e, find) ?? []);
  const seen = new Set<string>();
  const block = (label: string, s: Shown) => {
    if (seen.has(s.f.id)) return;
    seen.add(s.f.id);
    out.push(...replyBlock(label, s, site, terms));
  };
  if (story !== null) block("Story of the day: ", story);
  items.forEach((s, i) => block(`Item ${i + 1}: `, s));
  const others = [
    ...brief.lead.flatMap((l) => l.finding_ids),
    ...brief.rung_changes.map((c) => c.finding_id),
    ...(dive === null ? [] : [dive.finding_id]),
    ...(review === null ? [] : [
      ...(review.remarkable === null ? [] : [review.remarkable.finding_id]),
      ...review.strongest_against.finding_ids, ...review.fell, ...review.setbacks,
    ]),
    ...brief.corrections.flatMap((c) => (c.finding_id === null ? [] : [c.finding_id])),
    ...brief.reports.map((r) => r.finding_id),
  ];
  for (const id of others) {
    const s = namedOnly(id, find);
    if (s !== null) block("Also named: ", s);
  }

  const changes = changeEntries(brief, find);
  if (changes.length) out.push("", "**Climbed or fell**", ...changes.map((c) => `- ${c}`));
  if (brief.ideas.length) {
    out.push("", "**Ideas and debate**");
    brief.ideas.forEach((idea, i) => out.push(`- ${oneLine(idea.text.en)}`, ...disclosed(`ideas.${i}`)));
  }
  if (brief.also.length) {
    out.push("", "**Also noted**");
    brief.also.forEach((line, i) => out.push(`- ${oneLine(line.title.en)} (${FIELD_INFO[line.field].en})`, ...disclosed(`also.${i}`)));
  }
  const corrections = shownCorrections(brief, content, find);
  if (corrections.length) {
    out.push("", "**Corrections**", ...corrections.map((c) => `- ${c.id} ${c.type} to ${targetOf(c)}: ${oneLine(c.reason.en)}`));
  }
  const reports = shownReports(brief, content, find);
  if (reports.length) {
    const reasons = new Map(content.reports.map((r) => [r.id, r.reason]));
    out.push("", "**Reports**", ...reports.map((r) => {
      const reason = reasons.get(r.id);
      return `- ${r.id} ${r.status} (${r.finding_id})${reason ? `: ${oneLine(reason.en)}` : ""}`;
    }));
  }
  return `${out.map((l) => chatGuard(l, site)).join("\n")}\n`;
}
