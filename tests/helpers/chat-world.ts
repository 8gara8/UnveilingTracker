// Inputs for tests/chat.test.ts (SPEC §8.8, §10 P1 step 6): the sample content as `loadContent()` returns it, the editions of the sample
// picked by what they hold rather than by date or title (so a regenerated sample cannot turn a case red), a deep copy to edit, hand-built
// run records for the formats the sample's status files cannot feed (a failed run, a skipped one, a dry run, a data-only edition with
// its error code), the planted text the loader-skip cases use, and `checkChat()`, the invariants every chat edition holds.
//
// New for this project; Cyber's tests/chat.test.ts built its briefs and run records inline.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import { loadContent, type Content } from "../../lib/content";
import { RunRecord, RUN_STAGES, type RunStage, type StageRecord } from "../../lib/schema/status";
import { CANARY_TOKEN } from "../../lib/vocab";

/** The sample folder, from the repository root. */
export const SAMPLE_DIR = path.join(__dirname, "..", "..", "fixtures", "site-content");

/** Twenty letters of A, C, G and T: the shortest run DUAL_USE reads as a nucleotide sequence. Made up and meaningless. */
export const SEQUENCE: string = ["ACGT", "ACGT", "ACGT", "ACGT", "ACGT"].join("");

let loaded: Content | undefined;

/** The sample as the site loads it: the whole registry, once. Treat it as read-only; `copyOfSample()` is the one to edit. */
export function sample(): Content {
  loaded ??= loadContent(SAMPLE_DIR, { fresh: true, log: () => {} });
  return loaded;
}

/** Freezes `value` and everything inside it, so that a write to it throws (the modules are strict): a renderer that changes its input fails. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** A deep copy of the sample, for a case that edits it. */
export function copyOfSample(): Content {
  return structuredClone(sample()) as Content;
}

const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`the sample has no ${what}`);
  return value;
};

type Brief = Content["briefs"][number];

/** The editions of the sample, each picked by what it holds. */
export function picks(content: Content = sample()): {
  monday: Brief; sunday: Brief; busiest: Brief; englishOnly: Brief; dataOnly: Brief; noFindings: Brief; alsoOnly: Brief;
} {
  const daily = content.briefs.filter((b) => b.format === "daily" && b.edition === "full");
  const size = (b: Brief) => b.items.length + (b.story === null ? 0 : 1) + b.corrections.length + b.reports.length + b.ideas.length + b.also.length;
  return {
    monday: must(content.briefs.find((b) => b.format === "monday_review"), "Monday edition"),
    sunday: must(content.briefs.find((b) => b.format === "sunday_deep_dive"), "Sunday edition"),
    busiest: must([...daily].sort((a, b) => size(b) - size(a))[0], "busy daily"),
    englishOnly: must(daily.find((b) => !b.languages.zh), "English-only daily"),
    dataOnly: must(content.briefs.find((b) => b.edition === "data_only"), "data-only edition"),
    noFindings: must(daily.find((b) => b.story === null && b.items.length === 0 && b.rung_changes.length > 0), "daily with no finding and a rung change"),
    alsoOnly: must(daily.find((b) => b.story === null && b.items.length === 0 && b.also.length > 0), "daily with Also noted lines only"),
  };
}

/** The status file's records of a sample date. */
export function statusRuns(content: Content, date: string): RunRecord[] {
  return [...must(content.status.find((s) => s.date === date), `status file for ${date}`).runs];
}

// ── Hand-built run records ───────────────────────────────────────────────────────────────────────

/** A Taipei timestamp on `date`. */
export const at = (date: string, hhmm: string, seconds = "00"): string => `${date}T${hhmm}:${seconds}+08:00`;

type StageOver = Partial<Omit<StageRecord, "id">>;

/** The eleven stage records, all `ok` with no times and no note, each changed by `over[id]`. */
export function stages(over: Partial<Record<RunStage, StageOver>> = {}): StageRecord[] {
  return RUN_STAGES.map((id) => ({ id, status: "ok", started_at: null, ended_at: null, note: null, ...over[id] }));
}

/** One valid run record for `date`: a normal full morning from 03:15 to 04:01, changed by `over`. */
export function runRecord(date: string, over: Partial<RunRecord> = {}): RunRecord {
  return RunRecord.parse({
    run_id: `${date.replaceAll("-", "")}-031502`,
    trigger: "schedule",
    attempt: 1,
    started_at: at(date, "03:15", "02"),
    finished_at: at(date, "04:01", "23"),
    outcome: "published_full",
    edition: "full",
    error_code: null,
    code_commit: "0123456789abcdef0123456789abcdef01234567",
    pace_status: "ok",
    data_only_published_at: at(date, "03:19", "50"),
    full_published_at: at(date, "03:56", "53"),
    late: false,
    stages: stages(),
    feeds: [],
    budgets: {
      agent_seconds: 1500, zh_agent_seconds: 540, web_fetches: 22, web_searches: 6, repair_rounds: 0, tokens_in: null, tokens_out: null, usage: null,
      safety_stops: 0,
    },
    candidates: { ranked: 40, kept: 16, deep_read: 8 },
    validation: { errors: 0, warnings: 0, codes: [] },
    soft_gates: { checked: 3, dropped: 0, by_code: {} },
    zh: { attempted: true, repair_rounds: 0, strings: 17, backlog: 0, outcome: "ok" },
    deploy: { triggered: true, ready_at: at(date, "03:58", "53"), shows_date: date, shows_edition: "full" },
    recheck: { findings_checked: 4, rung_changes: 0, proposals: 0, reports_new: 0, reports_decided: 0, flagged: [] },
    links: { checked_at: at(date, "04:01", "13"), checked: 4, ok: 4, unknown: 0, broken: [] },
    ...over,
  });
}

/** A date that no sample edition has: the runs of a failed, skipped or dry-run case are on it. */
export const OTHER_DATE = "2026-10-21";

// ── Planted text ─────────────────────────────────────────────────────────────────────────────────

/** A copy of the sample folder under the system's temporary folder; `removeCopies()` deletes every one made. */
const copies: string[] = [];
export function copyFolder(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-chat-"));
  copies.push(dir);
  fs.cpSync(SAMPLE_DIR, dir, { recursive: true });
  return dir;
}
export function removeCopies(): void {
  for (const dir of copies.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** Reads the JSON file `rel` under `dir`, lets `edit` change it, and writes it back as publish does. */
export function patchJson(dir: string, rel: string, edit: (record: any) => void): void {
  const file = path.join(dir, rel);
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  edit(record);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

/** The folder loaded as the site loads it (the whole registry, never cached, no log). */
export const loadFolder = (dir: string): Content => loadContent(dir, { fresh: true, log: () => {} });

// ── What every chat edition holds ────────────────────────────────────────────────────────────────

const EM_DASH = String.fromCharCode(0x2014);
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;

/**
 * The invariants of §8.8 on any chat edition: lines in number, no blank line (the reply file may have them: `blank`), no leading or
 * trailing space, no table, heading, quote, code block or rule at the start of a line, no emoji, no em dash, no canary, and every link starting with `site`.
 */
export function checkChat(text: string, site: string, opts: { cap?: number; blank?: boolean } = {}): string[] {
  expect(text.endsWith("\n")).toBe(true);
  expect(text.endsWith("\n\n")).toBe(false);
  const lines = text.slice(0, -1).split("\n");
  if (opts.cap !== undefined) expect(lines.length).toBeLessThanOrEqual(opts.cap);
  for (const line of lines) {
    if (opts.blank !== true) expect(line.trim(), "a blank line").not.toBe("");
    expect(line, `trailing space in ${line}`).toBe(line.trimEnd());
    expect(line, `a block start in ${line}`).not.toMatch(/^(?:\s|[|#>=]|```|~~~|\[[^\]]*\]:|[-*_](?:\s*[-*_])*\s*$)/);
    expect(line, `an emoji in ${line}`).not.toMatch(EMOJI);
    expect(line.includes(EM_DASH), `an em dash in ${line}`).toBe(false);
    expect(line.toLowerCase().includes(CANARY_TOKEN.toLowerCase()), `the canary in ${line}`).toBe(false);
    for (const url of line.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)>"']+/gi) ?? []) {
      expect(url === site || url.startsWith(`${site}/`), `an off-site link ${url}`).toBe(true);
    }
  }
  return lines;
}
