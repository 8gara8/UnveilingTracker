// The validator's command line (SPEC §8.6, §10 P1 milestone): the one way a person, a test or the milestone runs the validator on a
// file or on a folder, in three forms.
//
//   tsx scripts/validate.ts FILE [--context F] [--evidence F] [--metrics F] [--pack F] [--json]
//   tsx scripts/validate.ts FILE --zh EN_FILE [--zh-context F] [--zh-evidence F] [--json]
//   tsx scripts/validate.ts --all [--dir DIR] [--json]
//
// The first form runs `validateDraft()` on the English agent's draft, the second `validateZh()` on the Chinese pass's draft against the
// English draft EN_FILE it translates, the third `validateAll()` on a content folder (`--dir`, else `UT_CONTENT_DIR`, else `content/`;
// an empty or missing folder passes). Exit 0 valid, 1 invalid, 2 usage, an input that cannot be read or a report that cannot be written,
// so a run that could not judge is never taken for a draft that failed. The forms' flags do not mix, a flag is given once, and a flag
// needs a value.
//
// Inputs. A draft's inputs default to the run's files for its date D, the date in its file name (`D.json`, `D.zh.json`) or else its own
// `date`: `logs/D.context.json`, `logs/D.evidence.json`, `<content>/metrics/D.json` (else the staged copy `cache/staged/D/metrics/D.json`,
// SPEC §8.4) and `packs/D.json`; the Chinese form's are `logs/D.zh-context.json` and `logs/D.zh-evidence.json`. Paths are read from
// the repository root. An input that is missing, is not a file, is not JSON or fails its schema is a usage error that names its flag.
// The two copies of a context the drafting agents can write, `drafts/context.json` and `drafts/D.zh-context.json`, are never read: they
// are refused by name and as the same file under another name (a link, a hard link, a path through a linked folder).
//
// The draft itself is judged, not trusted: a file that is empty, starts with a byte order mark, is not UTF-8 or is not JSON is one
// SCHEMA error at `(file)` (the text `validateAll()` gives a stored file), exit 1; a file that is missing or is not a file is exit 2.
//
// Stored records. The English form reads the content folder (`contentDir()` of lib/site.ts: `UT_CONTENT_DIR`, else `content/`) and gives
// `validateDraft()` its `stored`: every stored finding briefed in the 90 days up to D (DUPLICATE's window), every older finding the
// context lists or a string of the draft names, every stored correction and every glossary term. The Chinese form gives `validateZh()`
// the findings the English draft names and every backlog finding its context lists (`zhBacklogIds()`), with the corrections and terms. A missing or empty folder, or one with none of these files,
// gives `stored: null` and no error; a path that is there but is not a folder, and a stored file that cannot be read or fails its schema,
// stop the run with exit 2 and the name, since the verdict would rest on records the run could not read. `readStoredRecords()`,
// `findingIdsIn()`, `readJsonFile()`, `problemsOf()`, `issueLine()`, `oneLine()`, `writeFailure()` and `STORED_WINDOW_DAYS` are exported
// for the tests.
//
// Output. Text: one `ERROR CODE path: message Hint: ...` or `WARN ...` line for each issue, errors first and then warnings, each in the
// engine's order, then `LABEL: N errors, M warnings.` With `--json`: one array of `{ code, path, message, severity }`, the same issues
// in the same order, `[]` for a clean run, and nothing else on standard output. A usage error and any other failure go to standard
// error, with the usage text for a mistake in the command line. A message can quote the draft (an unknown key, a string a rule judges),
// so each text line is one line whatever the draft holds: `oneLine()` writes a control character, a line or paragraph separator or a
// direction mark as its escape, and the `--json` text carries the message as it is. A reader that closes early (`| head -1`) does not
// change the exit code, which is the verdict; a report that cannot be written at all (a full disk) is exit 2 with one line on standard
// error, never a stack and never a pass. The script runs when it is started through a linked folder as well.
//
// Cyber's scripts/validate.ts at the fork commit 3ced1fb, adapted: the `UsageError` and `Io` seam (`main()` returns the exit code and
// never exits, a test passes its own `out`, `err` and root), strict `parseArgs`, `readInput()` naming the flag of an input that fails,
// the defaults from the draft's date, the refusal of the agent-writable context, the `ERROR` and `WARN` lines with the summary line,
// and the `isMain` guard are Cyber's pattern. The Chinese form, the stored records, the refusal of linked copies, the one array of
// findings, the usage errors for mixed flags and repeats, the unreadable-draft issue, the folder check of `--all`, the one-line
// messages, the broken-pipe and write-failure handling and the guard that compares real paths are this project's; Cyber's inputs that
// belong to its own domain (its published-edition, regions, advisory-cache and pack-date inputs) are not here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ZodError, ZodType } from "zod";
import { ConfigError, loadConfig, type LoadedConfig } from "../lib/config";
import { addDays, isValidDate } from "../lib/dates";
import { byCodeUnit, compareFindingIds } from "../lib/ids";
import { DRAFT_SCHEMA_PATH, DRAFT_ZH_SCHEMA_PATH } from "../lib/json-schema";
import { error } from "../lib/rules/types";
import { contextFindingIds } from "../lib/rules/views";
import { ID_PATTERNS } from "../lib/schema/common";
import { AgentContext } from "../lib/schema/context";
import { ZhContext } from "../lib/schema/draft-zh";
import { Finding } from "../lib/schema/finding";
import { GlossaryFile } from "../lib/schema/glossary";
import { MetricsFile } from "../lib/schema/metrics";
import { CorrectionsFile, Evidence } from "../lib/schema/misc";
import { Pack } from "../lib/schema/pack";
import { contentDir } from "../lib/site";
import { toResult, validateAll, validateDraft, validateZh, zhBacklogIds, type StoredRecords, type ValidationIssue, type ValidationResult } from "../lib/validate";
import { jsonFromBytes } from "../lib/validate-stored";

export const USAGE = `Usage:
  npm run validate -- FILE [--context F] [--evidence F] [--metrics F] [--pack F] [--json]
  npm run validate -- FILE --zh EN_FILE [--zh-context F] [--zh-evidence F] [--json]
  npm run validate -- --all [--dir DIR] [--json]`;

/** A mistake in the command line: exit 2 with the message and the usage text on standard error. */
export class UsageError extends Error {}

/** An input the run cannot use (missing, unreadable, not its schema, or refused): exit 2 with the message alone. */
export class InputError extends Error {}

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  /** The repository root the default paths and `config/` are read from; default the working directory. */
  root?: string;
}

const DEFAULT_IO: Io = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** The days before D that a stored finding may have been briefed on and still be read: DUPLICATE's title window (SPEC §4.12). */
export const STORED_WINDOW_DAYS = 90;

// ── Arguments ────────────────────────────────────────────────────────────────────────────────────

const OPTIONS = {
  all: { type: "boolean" },
  dir: { type: "string" },
  context: { type: "string" },
  evidence: { type: "string" },
  metrics: { type: "string" },
  pack: { type: "string" },
  zh: { type: "string" },
  "zh-context": { type: "string" },
  "zh-evidence": { type: "string" },
  json: { type: "boolean" },
} as const;

type Flag = keyof typeof OPTIONS;
type Form = "all" | "english" | "chinese";

/** The form each flag belongs to; `--json` goes with all three. */
const FLAG_FORM: Readonly<Record<Flag, Form | "any">> = {
  all: "all", dir: "all",
  context: "english", evidence: "english", metrics: "english", pack: "english",
  zh: "chinese", "zh-context": "chinese", "zh-evidence": "chinese",
  json: "any",
};

const FORM_NAME: Readonly<Record<Form, string>> = { all: "--all", english: "the English form (FILE alone)", chinese: "the Chinese form (FILE --zh EN_FILE)" };

type Values = { [K in Flag]?: (typeof OPTIONS)[K]["type"] extends "boolean" ? boolean : string };

// ── Files ────────────────────────────────────────────────────────────────────────────────────────

type JsonRead = { ok: true; value: unknown } | { ok: false; kind: "fs" | "content"; why: string };

/**
 * The parsed JSON of a file, or why it cannot be read. `fs`: there is no such file, or it is a folder or another thing that is not a
 * file, or it cannot be read (a problem of the run). `content`: it is a file that is empty, starts with a byte order mark, is not UTF-8
 * or is not JSON (a problem of the file; `jsonFromBytes()`, the reader that `validateAll()` uses too, so both say the same). `why` completes "FILE ...".
 */
export function readJsonFile(file: string): JsonRead {
  let bytes: Buffer;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { ok: false, kind: "fs", why: stat.isDirectory() ? "is a folder, not a file" : "is not a regular file" };
    bytes = fs.readFileSync(file);
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "an error";
    return { ok: false, kind: "fs", why: code === "ENOENT" || code === "ENOTDIR" ? "was not found" : `cannot be read (${code})` };
  }
  const read = jsonFromBytes(bytes);
  return read.ok ? read : { ok: false, kind: "content", why: read.why };
}

/**
 * The characters that cannot stand in a line of output as they are, as ranges of code points: the C0 controls (a line break and the
 * escape character among them), DEL and the C1 controls, the line and paragraph separators, and the marks that embed, override or
 * isolate the direction of text, which can make a line read differently from what it holds.
 */
const UNSAFE_RANGES: readonly (readonly [from: number, to: number])[] = [[0x00, 0x1f], [0x7f, 0x9f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069]];
const UNSAFE = new RegExp(`[${UNSAFE_RANGES.map(([from, to]) => `\\u{${from.toString(16)}}-\\u{${to.toString(16)}}`).join("")}]`, "gu");
const NAMED_ESCAPES: Readonly<Record<string, string>> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };

/**
 * `text` as one line of output: each character of `UNSAFE_RANGES` written as its escape (`\n`, `\r`, `\t`, else `\u001b` and the like).
 * A message that quotes the draft (an unknown key, a string a rule judges) can then neither break its line, nor start a line that
 * reads as another issue, nor move the cursor of the terminal that shows it. Everything else, Chinese text included, is as it was.
 */
export function oneLine(text: string): string {
  return text.replace(UNSAFE, (c) => NAMED_ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** The first problems of a schema failure as one line: `path: message; path: message; and 4 more`. The paths and messages can quote the file, so it is `oneLine()`. */
export function problemsOf(err: ZodError): string {
  const first = err.issues.slice(0, 3).map((i) => `${i.path.length === 0 ? "(root)" : i.path.join(".")}: ${i.message}`);
  const more = err.issues.length > 3 ? [`and ${err.issues.length - 3} more`] : [];
  return oneLine([...first, ...more].join("; "));
}

/** A file's stat, or null when there is none to take (missing, or a path through a file). Bigint, so an inode compares exactly. */
function statOrNull(file: string): fs.BigIntStats | null {
  try {
    return fs.statSync(file, { bigint: true });
  } catch {
    return null;
  }
}

/** An input file as the command line names it: the flag, the path as shown in messages, and where it is. */
interface Input {
  flag: string;
  shown: string;
  abs: string;
}

function inputOf(flag: string, given: string | undefined, root: string, fallback: () => string): Input {
  const shown = given ?? fallback();
  return { flag, shown, abs: path.resolve(root, shown) };
}

/** Reads an input through its schema; a missing, unreadable, unparsable or wrong file is an `InputError` naming the flag. */
function readInput<T>(input: Input, schema: ZodType<T>, what: string): T {
  const read = readJsonFile(input.abs);
  if (!read.ok) throw new InputError(`--${input.flag}: ${input.shown} ${read.why}.`);
  const parsed = schema.safeParse(read.value);
  if (!parsed.success) throw new InputError(`--${input.flag}: ${input.shown} is not ${what} (${problemsOf(parsed.error)}).`);
  return parsed.data;
}

// ── The agent-writable copies of a context ───────────────────────────────────────────────────────

const ZH_CONTEXT_COPY = /^\d{4}-\d{2}-\d{2}\.zh-context\.json$/;
const isContextCopyName = (name: string): boolean => name === "context.json" || ZH_CONTEXT_COPY.test(name);

/**
 * Refuses `drafts/context.json` and `drafts/D.zh-context.json` as the value of a context flag (SPEC §8.6): the drafting agents can write
 * `drafts/` (§9.5), so a validator that read its context there would judge a draft against what the draft's own writer chose. The path is
 * refused by name, so a copy that is gone is refused too, and then as the same file under another name: a link, a hard link or a path
 * through a linked folder, which the inode shows (a case-insensitive disk too).
 */
function refuseAgentCopy(flag: string, given: string, root: string): void {
  const dir = path.join(root, "drafts");
  const abs = path.resolve(root, given);
  let refused = path.dirname(abs) === dir && isContextCopyName(path.basename(abs));
  if (!refused) {
    const target = statOrNull(abs);
    if (target !== null) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        names = [];
      }
      refused = names.filter(isContextCopyName).some((name) => {
        const copy = statOrNull(path.join(dir, name));
        return copy !== null && copy.dev === target.dev && copy.ino === target.ino;
      });
    }
  }
  if (refused) {
    throw new InputError(`--${flag}: ${given} is the drafting agent's writable copy of a context and is never read; give the run's own copy in logs/ (logs/D.context.json or logs/D.zh-context.json).`);
  }
}

// ── Stored records ───────────────────────────────────────────────────────────────────────────────

/** Which stored findings to read: those briefed in the window up to `date` (null: no window), and those named, whatever their age. */
export interface StoredWanted {
  date: string | null;
  ids: ReadonlySet<string>;
}

/** The finding ids written anywhere in a parsed JSON value: every string that is a whole finding id, found without walking the schema. */
export function findingIdsIn(value: unknown): Set<string> {
  const out = new Set<string>();
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const v = pending.pop();
    if (typeof v === "string") {
      if (ID_PATTERNS.finding.test(v)) out.add(v);
    } else if (typeof v === "object" && v !== null) {
      for (const inner of Object.values(v)) pending.push(inner);
    }
  }
  return out;
}

const STORED_HELP = "The draft was not judged; repair or remove that file (npm run validate:all checks the whole content folder).";

/** What a stored path is, links not followed (as `validateAll()` does not follow them): nothing there, a regular file, or anything else. */
function kindOf(file: string): "missing" | "file" | "other" {
  try {
    return fs.lstatSync(file).isFile() ? "file" : "other";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "other";
  }
}

/** A stored file as JSON: null when it is not there, an `InputError` when it is not a regular file or cannot be read as JSON. */
function readStoredJson(dir: string, shown: string, rel: string): { at: string; value: unknown } | null {
  const kind = kindOf(path.join(dir, rel));
  if (kind === "missing") return null;
  const at = path.join(shown, rel);
  if (kind === "other") throw new InputError(`Stored records: ${at} is not a regular file (it is a link, a folder or another kind of entry). ${STORED_HELP}`);
  const read = readJsonFile(path.join(dir, rel));
  if (!read.ok) throw new InputError(`Stored records: ${at} ${read.why}. ${STORED_HELP}`);
  return { at, value: read.value };
}

/** `corrections.json` and `glossary.json` through their schemas: null when the file is not there. */
function readStoredFile<T>(dir: string, shown: string, rel: string, schema: ZodType<T>, what: string): T | null {
  const json = readStoredJson(dir, shown, rel);
  if (json === null) return null;
  const parsed = schema.safeParse(json.value);
  if (!parsed.success) throw new InputError(`Stored records: ${json.at} is not ${what} (${problemsOf(parsed.error)}). ${STORED_HELP}`);
  return parsed.data;
}

/** The file names in `findings/`, in code-unit order; none when there is no such folder, and an `InputError` when it cannot be listed. */
function findingFileNames(dir: string, shown: string): string[] {
  try {
    return fs.readdirSync(path.join(dir, "findings")).sort(byCodeUnit);
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "an error";
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw new InputError(`Stored records: ${path.join(shown, "findings")} cannot be listed (${code}). ${STORED_HELP}`);
  }
}

/**
 * The stored records a draft run reads from a content folder (`DraftInputs.stored`, `ZhInputs.stored`; SPEC §8.6): every stored
 * correction (`corrections.json`), every glossary term (`glossary.json`), and from `findings/` each finding the draft names or the
 * context lists (`wanted.ids`) and, with a date, each that a brief carried in the 90 days up to D (`STORED_WINDOW_DAYS`, both ends
 * included). A finding that is not wanted is not checked against its schema, so a bad old record cannot stop a run that never needs
 * it; one that is wanted must be a valid record of its own file name. Null when the folder is missing or holds none of these (the run
 * then sees the stored record through the context alone). A path that is there but is not a folder, and a file that is not a regular
 * file, cannot be read as JSON or fails its schema, are an `InputError` naming them, whether the file is wanted or not when it cannot
 * be read at all (what it holds is not known): a verdict given with no stored records, because the variable names a file, would pass
 * what the stored records would have failed. `shown` is the folder as the messages name it.
 */
export function readStoredRecords(dir: string, wanted: StoredWanted, shown: string = dir): StoredRecords | null {
  const folder = statOrNull(dir);
  if (folder === null) return null;
  if (!folder.isDirectory()) {
    throw new InputError(`Stored records: ${shown} is not a folder. The draft was not judged; give the content folder (UT_CONTENT_DIR, else content/).`);
  }
  const corrections = readStoredFile(dir, shown, "corrections.json", CorrectionsFile, "a corrections file");
  const glossary = readStoredFile(dir, shown, "glossary.json", GlossaryFile, "a glossary file");

  const findings: Finding[] = [];
  const to = wanted.date;
  const from = to === null ? null : addDays(to, -STORED_WINDOW_DAYS);
  for (const name of findingFileNames(dir, shown)) {
    const id = name.endsWith(".json") ? name.slice(0, -".json".length) : "";
    if (!ID_PATTERNS.finding.test(id)) continue;
    const json = readStoredJson(dir, shown, path.join("findings", name));
    if (json === null) continue;
    const briefs = typeof json.value === "object" && json.value !== null ? (json.value as { briefs?: unknown }).briefs : undefined;
    const recent = from !== null && to !== null && Array.isArray(briefs) && briefs.some((d) => typeof d === "string" && d >= from && d <= to);
    if (!recent && !wanted.ids.has(id)) continue;
    const parsed = Finding.safeParse(json.value);
    if (!parsed.success) throw new InputError(`Stored records: ${json.at} is not a finding (${problemsOf(parsed.error)}). ${STORED_HELP}`);
    if (parsed.data.id !== id) throw new InputError(`Stored records: ${json.at} holds the finding ${parsed.data.id}, not ${id}. ${STORED_HELP}`);
    findings.push(parsed.data);
  }
  if (corrections === null && glossary === null && findings.length === 0) return null;
  findings.sort((a, b) => compareFindingIds(a.id, b.id));
  return { findings, corrections: corrections?.corrections ?? [], terms: glossary?.terms ?? [] };
}

// ── Output ───────────────────────────────────────────────────────────────────────────────────────

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One issue as a line of the text output: `ERROR CODE path: message Hint: ...`, or `WARN ...`; always one line (`oneLine()`). */
export function issueLine(i: ValidationIssue): string {
  const head = `${i.severity === "error" ? "ERROR" : "WARN"} ${i.code} ${i.path}: ${i.message}`;
  return oneLine(i.hint ? `${head} Hint: ${i.hint}` : head);
}

/** Prints a result and returns the exit code: errors before warnings, each in the engine's order, in both outputs. */
function report(io: Io, label: string, result: ValidationResult, json: boolean): number {
  const ordered = [...result.errors, ...result.warnings];
  if (json) {
    io.out(JSON.stringify(ordered.map((i) => ({ code: i.code, path: i.path, message: i.message, severity: i.severity })), null, 2));
  } else {
    for (const i of ordered) io.out(issueLine(i));
    io.out(`${label}: ${plural(result.errors.length, "error")}, ${plural(result.warnings.length, "warning")}.`);
  }
  return result.ok ? 0 : 1;
}

function configProblems(e: ConfigError): string {
  return [`config/ cannot be used: ${plural(e.issues.length, "problem")}.`, ...e.issues.map((i) => `  ${i.code} ${i.path}: ${i.message}`)].join("\n");
}

// ── The forms ────────────────────────────────────────────────────────────────────────────────────

const ENGLISH_DATED_NAME = /^(\d{4}-\d{2}-\d{2})\.json$/;
const CHINESE_DATED_NAME = /^(\d{4}-\d{2}-\d{2})\.zh\.json$/;

/** The date in a draft's file name, when it is a real calendar date. */
function dateInName(file: string, pattern: RegExp): string | null {
  const m = pattern.exec(path.basename(file));
  return m !== null && isValidDate(m[1]!) ? m[1]! : null;
}

/** The draft's own `date`, when it is a real calendar date. */
function ownDate(value: unknown): string | null {
  const date = typeof value === "object" && value !== null ? (value as { date?: unknown }).date : undefined;
  return typeof date === "string" && isValidDate(date) ? date : null;
}

/** The draft file: its JSON, or the one SCHEMA issue that says why it is not JSON. A file that is not there is an `InputError`. */
function readDraft(file: string, abs: string, schemaPath: string): { value: unknown } | { issue: ValidationIssue } {
  const read = readJsonFile(abs);
  if (read.ok) return { value: read.value };
  if (read.kind === "fs") throw new InputError(`Cannot read ${file}: it ${read.why}.`);
  return { issue: error("SCHEMA", "(file)", `${file} ${read.why}.`, `A draft is one UTF-8 JSON file in the shape of ${schemaPath}.`) };
}

function loadConfigAt(root: string): LoadedConfig {
  return loadConfig(path.join(root, "config"));
}

function runEnglish(file: string, values: Values, root: string, io: Io): number {
  if (values.context !== undefined) refuseAgentCopy("context", values.context, root);
  const abs = path.resolve(root, file);
  const draft = readDraft(file, abs, DRAFT_SCHEMA_PATH);
  if ("issue" in draft) return report(io, file, toResult([draft.issue]), values.json === true);

  const fileDate = dateInName(file, ENGLISH_DATED_NAME);
  const dateOf = (): string => {
    const date = fileDate ?? ownDate(draft.value);
    if (date === null) throw new UsageError(`Cannot tell the edition date of ${file}: name the file YYYY-MM-DD.json, or give every input flag.`);
    return date;
  };
  const context = readInput(inputOf("context", values.context, root, () => path.join("logs", `${dateOf()}.context.json`)), AgentContext, "an agent context");
  const evidence = readInput(inputOf("evidence", values.evidence, root, () => path.join("logs", `${dateOf()}.evidence.json`)), Evidence, "an evidence file");
  const metrics = readInput(inputOf("metrics", values.metrics, root, () => {
    const committed = path.join(contentDir(), "metrics", `${dateOf()}.json`);
    const staged = path.join("cache", "staged", dateOf(), "metrics", `${dateOf()}.json`);
    return fs.existsSync(path.resolve(root, committed)) || !fs.existsSync(path.resolve(root, staged)) ? committed : staged;
  }), MetricsFile, "a metrics file");
  const pack = readInput(inputOf("pack", values.pack, root, () => path.join("packs", `${dateOf()}.json`)), Pack, "a source pack");

  const ids = new Set([...findingIdsIn(draft.value), ...contextFindingIds(context)]);
  const stored = readStoredRecords(path.resolve(root, contentDir()), { date: context.date, ids }, contentDir());
  const result = validateDraft(draft.value, { context, evidence, metrics, pack, stored, config: loadConfigAt(root), fileDate });
  return report(io, file, result, values.json === true);
}

function runChinese(file: string, englishFile: string, values: Values, root: string, io: Io): number {
  if (values["zh-context"] !== undefined) refuseAgentCopy("zh-context", values["zh-context"], root);
  const abs = path.resolve(root, file);
  const draft = readDraft(file, abs, DRAFT_ZH_SCHEMA_PATH);
  if ("issue" in draft) return report(io, file, toResult([draft.issue]), values.json === true);
  const english = readJsonFile(path.resolve(root, englishFile));
  if (!english.ok) throw new InputError(`--zh: ${englishFile} ${english.why}.`);

  const fileDate = dateInName(file, CHINESE_DATED_NAME);
  const dateOf = (): string => {
    const date = fileDate ?? ownDate(draft.value);
    if (date === null) throw new UsageError(`Cannot tell the edition date of ${file}: name the file YYYY-MM-DD.zh.json, or give every input flag.`);
    return date;
  };
  const context = readInput(inputOf("zh-context", values["zh-context"], root, () => path.join("logs", `${dateOf()}.zh-context.json`)), ZhContext, "a Chinese context");
  const evidence = readInput(inputOf("zh-evidence", values["zh-evidence"], root, () => path.join("logs", `${dateOf()}.zh-evidence.json`)), Evidence, "an evidence file");

  // The findings its English draft names and every backlog finding its context lists, so that DUAL_USE and ZH_HYPE can read the record of each.
  const ids = new Set([...findingIdsIn(english.value), ...zhBacklogIds(context.strings.map((s) => s.key))]);
  const stored = readStoredRecords(path.resolve(root, contentDir()), { date: null, ids }, contentDir());
  const result = validateZh(draft.value, english.value, { context, evidence, stored, config: loadConfigAt(root) }, { fileDate });
  return report(io, file, result, values.json === true);
}

/**
 * True when `dir` is a folder with something in it: only then does the engine read `config/`, so an empty or missing folder passes
 * whatever `config/` holds. `.DS_Store` and a regular root `README.md` (the placeholder that keeps an empty content folder in git)
 * are nothing, as they are to the engine's own listing.
 */
function holdsFiles(dir: string): boolean {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.name !== ".DS_Store" && !(e.name === "README.md" && e.isFile()));
  } catch {
    return false;
  }
}

function runAll(values: Values, root: string, io: Io): number {
  const shown = values.dir ?? contentDir();
  const abs = path.resolve(root, shown);
  const result = validateAll(abs, holdsFiles(abs) ? { config: loadConfigAt(root) } : {});
  return report(io, shown, result, values.json === true);
}

// ── The command ──────────────────────────────────────────────────────────────────────────────────

function run(argv: string[], io: Io): number {
  const root = path.resolve(io.root ?? process.cwd());
  const { values, positionals, tokens } = parseArgs({ args: argv, allowPositionals: true, strict: true, tokens: true, options: OPTIONS });

  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) throw new UsageError(`--${token.name} is given twice.`);
    seen.add(token.name);
    if (token.value === "") throw new UsageError(`--${token.name} needs a value.`);
  }
  if (positionals.some((p) => p === "")) throw new UsageError("A file name is empty.");

  const form: Form = values.all === true ? "all" : values.zh !== undefined ? "chinese" : "english";
  for (const flag of Object.keys(values) as Flag[]) {
    const own = FLAG_FORM[flag];
    if (own !== "any" && own !== form) throw new UsageError(`--${flag} belongs to ${FORM_NAME[own]}, not to ${FORM_NAME[form]}.`);
  }
  if (form === "all") {
    if (positionals.length > 0) throw new UsageError("--all takes no FILE: give the folder with --dir.");
    return runAll(values, root, io);
  }
  if (positionals.length !== 1) throw new UsageError("Give exactly one FILE to validate, or --all.");
  const file = positionals[0]!;
  return form === "english" ? runEnglish(file, values, root, io) : runChinese(file, values.zh!, values, root, io);
}

/** The command. Returns the exit code and never exits: 0 valid, 1 invalid, 2 usage or an input that cannot be used. */
export function main(argv: string[] = process.argv.slice(2), io: Io = DEFAULT_IO): number {
  try {
    return run(argv, io);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (e instanceof UsageError || (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS"))) {
      io.err(`${(e as Error).message}\n${USAGE}`);
    } else if (e instanceof InputError) {
      io.err(e.message);
    } else if (e instanceof ConfigError) {
      io.err(configProblems(e));
    } else {
      io.err(e instanceof Error ? (e.stack ?? e.message) : String(e));
    }
    return 2;
  }
}

/** The extensions `tsx` and Node add to a started name that has none: `tsx scripts/validate` runs `scripts/validate.ts`. */
const OMITTED_EXTENSIONS = ["", ".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs"] as const;

/** A file's real path (links followed), or null when there is no such file. */
function realPathOrNull(file: string): string | null {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

/**
 * True when this file is the script that was started, not one that imported it. The two are compared by their real names: Node gives
 * the module its real path, so a script started through a linked folder (`/alias/scripts/validate.ts`) or without its extension
 * (`tsx scripts/validate`) is the same file and must run, where a comparison of the name as typed would find a stranger, run nothing
 * and end with exit 0 and no output, which reads as valid. The started name is tried as given, then with each extension in turn; the
 * first that is a file is the one compared.
 */
function startedAsScript(): boolean {
  const started = process.argv[1];
  if (started === undefined) return false;
  const self = realPathOrNull(fileURLToPath(import.meta.url));
  for (const ext of OMITTED_EXTENSIONS) {
    const real = realPathOrNull(started + ext);
    if (real !== null) return real === self;
  }
  return false;
}

/**
 * The one line to tell the reader about a write error on standard output or standard error, or null when it is no failure of the run.
 * A reader that has gone away (`| head -1`, a broken pipe) is not one: the exit code stays the verdict, where the unhandled error would
 * end the process with a stack and exit 1, which reads as invalid. Any other write error (a full disk) means the report was lost.
 */
export function writeFailure(err: NodeJS.ErrnoException): string | null {
  return err.code === "EPIPE" ? null : `Cannot write the output (${err.code ?? "an error"}).`;
}

if (startedAsScript()) {
  // A report that could not be written ends the run with exit 2, never 0 (valid) or 1 (invalid), and with one line, never a stack.
  let told = false;
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (err: NodeJS.ErrnoException) => {
      const line = writeFailure(err);
      if (line === null) return;
      process.exitCode = 2;
      // Told once: when standard error is the stream that failed, the line fails too, and must not be written again.
      if (told) return;
      told = true;
      process.stderr.write(`${line}\n`);
    });
  }
  process.exitCode = main();
}
