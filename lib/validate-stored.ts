// The stored-record entry points of the validator (SPEC §4.12 "Stored records", §6 "Content loading", §8.6, §8.7): `validatePublished()`
// for one stored brief and the records it names, and `validateAll()` for a whole content folder. Both build the input of
// lib/rules/run.ts and run every registered published-mode rule on it; `validateAll()` also reads the folder.
//
// `validateAll(dir, opts)` reads each file of SPEC §3's layout (an empty or missing folder passes), checks it against its schema
// (SCHEMA; a file that is not valid JSON, is empty, starts with a byte order mark or is not UTF-8 is one SCHEMA issue at `(file)`),
// and then runs the rules, each record once:
//   - every brief, with the findings it names, as `validatePublished()` runs it, so a brief is judged as it was published;
//   - one run over every stored finding, glossary term, correction and report, whether or not a brief names it, with the
//     cross-file rules (XREF, LANG_PARITY, FILE_LAYOUT) reading every brief, the archive index and the list of files found
//     (`PublishedFolder`, lib/rules/types.ts).
// The records being published are the brief of `opts.publishing` and the findings first briefed on that date or given text by it, the
// terms first used on it, the corrections dated on it and the reports decided on it (`beingPublishedOf()`, lib/rules/run.ts). The tests that read
// `config/` run on them alone, and the safety codes are warnings on every other record (SPEC §4.12 "Stored records"). A `publishing`
// date with no brief in the folder is one XREF issue at `(publishing)`: nothing would be published, and every safety error of the
// folder would pass as a warning.
//
// An issue belongs to the file that holds the record it points at, by the file in its path (`briefs/2026-11-24.json: story.finding_id`);
// inside `glossary.json`, `corrections.json` and `reports.json` the path begins with the record's index (`terms[3].zh`,
// `corrections[1].after.zh`, `reports[0].finding_id`), so that `loadContent()` can skip one record. With `perFile` the result
// also holds each file's issues with the file taken off the paths; the combined issues keep the file in front.
//
// The walk reads every path under the folder but two names git keeps and no record is: `.DS_Store` anywhere, and a regular file named
// `README.md` in the folder's root, the placeholder that keeps an empty content folder in git (`fixtures/empty-content/`; SPEC §3). Both
// are never listed, so FILE_LAYOUT never sees them. A `README.md` in a subfolder, a `README.txt`, and a link or a folder named
// `README.md` are listed as any other path.
//
// Cyber's lib/validate.ts at the fork commit 3ced1fb, adapted: `validatePublished()`, `validateAll()` and their options and results
// (`AllOptions`, `AllResult`, `FileResult`), the sorted walk that ignores `.DS_Store` and a root `README.md`, the unparsable-file issue,
// the per-file issue map and the archive downgrade are Cyber's pattern; the layout, the records, the two-run structure, the term hiding and the
// reader's care with odd folders (links, empty files, byte order marks, bytes that are not UTF-8, deep paths) are this project's.

import fs from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";
import { loadConfig, type LoadedConfig } from "./config";
import { byCodeUnit, compareFindingIds } from "./ids";
import { RULES } from "./rules/index";
import { ARCHIVE_FILE, classifyPath, hiddenTermIds, namedFindingIds, type ContentKind } from "./rules/published";
import { buildPublishedInput, runRules, sortIssues } from "./rules/run";
import { error, type PublishedInput, type Rule, type StoredFile, type ValidationIssue } from "./rules/types";
import { Brief } from "./schema/brief";
import type { IsoDate } from "./schema/common";
import { Finding } from "./schema/finding";
import { GlossaryFile, type Term } from "./schema/glossary";
import { InputsManifest, MetricsFile, PaceWeeklyFile } from "./schema/metrics";
import { ArchiveIndex, CorrectionsFile, ReportsFile, type Correction, type Report } from "./schema/misc";
import { StatusFile } from "./schema/status";
import { schemaIssues, toResult, type ValidationResult } from "./validate";

// ── One stored brief ─────────────────────────────────────────────────────────────────────────────

/** What `validatePublished()` takes besides the brief: the stored records it names and the run's settings. */
export interface StoredInputs {
  /**
   * Every stored finding, as a list or by id. XREF cannot tell a record that does not exist from one that was not passed, so a
   * finding left out is reported missing wherever a brief, a finding, a term, a correction or a report names it (`related`, a
   * term's `first_finding`, a stored correction's or report's finding): a caller that wants no such issue passes the whole
   * `findings/` folder, as `validateAll()` does.
   */
  findings?: readonly Finding[] | ReadonlyMap<string, Finding>;
  /** The whole glossary, for the same reason. */
  terms?: readonly Term[];
  /** Every stored correction, oldest first: they file the findings as of a date (SPEC §4.10) and the brief lists some. */
  corrections?: readonly Correction[];
  /** Every stored report. */
  reports?: readonly Report[];
  config: LoadedConfig;
  /** The date in a `YYYY-MM-DD.json` file name, when a file is validated (structure's DATE_MISMATCH reads it). */
  fileDate?: string | null;
  /** The date being published: its brief, the findings first briefed or given text on it, the terms and corrections of it are judged against `config/`. */
  publishing?: IsoDate | null;
  /** The rules to run; default RULES (tests pass their own). */
  rules?: readonly Rule[];
}

const listOf = <T>(value: readonly T[] | ReadonlyMap<string, T> | undefined): readonly T[] =>
  value === undefined ? [] : value instanceof Map ? [...(value as ReadonlyMap<string, T>).values()] : (value as readonly T[]);

const engineFault = (err: unknown): ValidationIssue => {
  const why = (err instanceof Error ? err.message : String(err)).slice(0, 200);
  return error("RULE_ERROR", "(engine)", `The validator could not read its inputs (${why}).`,
    "This is a fault in the validator or its inputs, not in the content: report it.");
};

type BriefParse = { ok: true; brief: Brief } | { ok: false; issues: ValidationIssue[] };

/** The brief as the schema reads it, or the issues that say why not. Input that cannot even be read (a getter that throws) is one RULE_ERROR, never a throw. */
function parseBrief(input: unknown): BriefParse {
  try {
    const parsed = Brief.safeParse(input);
    return parsed.success ? { ok: true, brief: parsed.data } : { ok: false, issues: schemaIssues(parsed.error, input) };
  } catch (err) {
    return { ok: false, issues: [engineFault(err)] };
  }
}

/**
 * Validates one stored brief and the records it names (SPEC §4.12 "Stored records"). The brief is parsed with the Brief schema
 * first: one that fails is judged by its SCHEMA issues alone (paths relative to the brief) and no rule runs. A brief that parses
 * gets every registered published-mode rule, run on it with the records given: XREF and LANG_PARITY judge what was passed (an
 * edition other than the brief's, the archive index and the file list are a folder's facts, which `validateAll()` checks), and
 * the rest judge the brief and the findings. Issue paths on a stored record start with its file (`briefs/2026-11-24.json: lead[0].text.zh`).
 * A rule that throws gives one RULE_ERROR issue.
 */
export function validatePublished(input: unknown, inputs: StoredInputs): ValidationResult & { brief: Brief | null } {
  const read = parseBrief(input);
  if (!read.ok) return { ...toResult(sortIssues(read.issues)), brief: null };
  let issues: ValidationIssue[];
  try {
    const content = {
      findings: [...listOf(inputs.findings)].sort((a, b) => compareFindingIds(a.id, b.id)),
      terms: [...listOf(inputs.terms)].sort((a, b) => byCodeUnit(a.id, b.id)),
      corrections: inputs.corrections ?? [],
      reports: inputs.reports ?? [],
    };
    const built = buildPublishedInput(read.brief, content, { config: inputs.config, fileDate: inputs.fileDate ?? null, publishing: inputs.publishing ?? null });
    issues = runRules(built, inputs.rules ?? RULES);
  } catch (err) {
    issues = [engineFault(err)];
  }
  return { ...toResult(issues), brief: read.brief };
}

// ── The content folder ───────────────────────────────────────────────────────────────────────────

export interface AllOptions {
  /**
   * The edition publish is writing (SPEC §8.7): its brief and what it adds are judged against `config/`; every other record gets the
   * archive downgrade. Its brief must be in the folder: a date with no `briefs/<date>.json` is one XREF issue at `(publishing)`.
   */
  publishing?: IsoDate;
  /** The config the run loaded; default `loadConfig()`, read only when the folder holds something to judge (a bad config throws its ConfigError). */
  config?: LoadedConfig;
  /** Also return each file's issues, for `loadContent()` (SPEC §6). */
  perFile?: boolean;
  /** The rules to run; default RULES (tests pass their own). */
  rules?: readonly Rule[];
}

export interface FileResult extends ValidationResult {
  /** Relative to the content folder, "/"-separated: `briefs/2026-11-24.json`. The issues' paths are relative to the file. */
  file: string;
}

export interface AllResult extends ValidationResult {
  /** With `perFile`: every path under the folder, and `archive-index.json` when it is missing but needed, with its issues; else []. */
  files: FileResult[];
}

/** Names a filesystem walk can meet that git ignores (.gitignore `.DS_Store`): never content, never reported. */
const IGNORED_NAMES: ReadonlySet<string> = new Set([".DS_Store"]);

/** The placeholder that keeps an empty content folder in git: a regular file of exactly this name in the folder's root is never listed. */
const ROOT_PLACEHOLDER = "README.md";

interface Listed {
  path: string;
  regular: boolean;
}

/**
 * Every path under `root`, sorted by code unit: regular files, and each link, special file or unreadable folder as a path that is
 * not regular; but `.DS_Store` and a regular root file `README.md` (`ROOT_PLACEHOLDER`) are left out. Folders are walked without
 * recursion (a very deep tree cannot overflow the stack) and links are never followed. Null when `root` itself cannot be listed.
 */
function listContent(root: string): Listed[] | null {
  const out: Listed[] = [];
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(rel === "" ? root : path.join(/*turbopackIgnore: true*/ root, rel), { withFileTypes: true });
    } catch {
      if (rel === "") return null;
      out.push({ path: rel, regular: false });
      continue;
    }
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      if (rel === "" && entry.name === ROOT_PLACEHOLDER && entry.isFile()) continue;
      const entryPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) stack.push(entryPath);
      else out.push({ path: entryPath, regular: entry.isFile() });
    }
  }
  return out.sort((a, b) => byCodeUnit(a.path, b.path));
}

const unreadable = (file: string, message: string): ValidationIssue =>
  error("SCHEMA", `${file}: (file)`, message, "Every file of content/ is UTF-8 JSON, written by publish.");

/** Where a JSON parse failed, without the text around it (a message from the parser quotes the file). */
function parseFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (/end of JSON input/i.test(message)) return "the text ends early";
  const at = /position (\d+)/.exec(message);
  return at === null ? "unreadable text" : `at character ${at[1]}`;
}

/** What a file's bytes are as JSON: the parsed value, or `why` they are not, which completes "FILE ..." (no full stop). */
export type JsonBytes = { ok: true; value: unknown } | { ok: false; why: string };

/**
 * The bytes of a file as JSON (SPEC §4.12 SCHEMA, §6): the one reader of the four ways a file can be unreadable as text, shared by
 * `validateAll()` and the command line (scripts/validate.ts), so each says the same words. A file that is empty, starts with a byte order
 * mark, is not UTF-8, or is not JSON gives `why`; the text of a parse failure never appears in it (only where it failed).
 */
export function jsonFromBytes(bytes: Uint8Array): JsonBytes {
  if (bytes.length === 0) return { ok: false, why: "is empty; rewrite the whole file as valid JSON" };
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { ok: false, why: "starts with a byte order mark; save it as UTF-8 without one" };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, why: "is not valid UTF-8; rewrite the whole file as UTF-8 JSON" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, why: `is not valid JSON (${parseFailure(err)}); rewrite the whole file as valid JSON` };
  }
}

/** The parsed JSON of a file under `root`, or the one issue that says why it cannot be read. */
function readJson(root: string, file: string): { ok: true; raw: unknown } | { ok: false; issue: ValidationIssue } {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(/*turbopackIgnore: true*/ root, file));
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "an error";
    return { ok: false, issue: unreadable(file, `${file} could not be read (${code}); check that it is a readable file.`) };
  }
  const read = jsonFromBytes(bytes);
  return read.ok ? { ok: true, raw: read.value } : { ok: false, issue: unreadable(file, `${file} ${read.why}.`) };
}

const SCHEMAS: Readonly<Record<ContentKind, ZodType>> = {
  brief: Brief, finding: Finding, metrics: MetricsFile, inputs: InputsManifest, status: StatusFile, pace: PaceWeeklyFile,
  glossary: GlossaryFile, corrections: CorrectionsFile, reports: ReportsFile, archive: ArchiveIndex,
};

/** The three rules that read the whole folder, which `validateAll()` runs once, on its run over every record. */
const CROSS_FILE = ["XREF", "LANG_PARITY", "FILE_LAYOUT"] as const;
const isCrossFile = (rule: Rule): boolean => rule.codes.some((code) => (CROSS_FILE as readonly string[]).includes(code));
const readsParity = (rule: Rule): boolean => rule.codes.includes("LANG_PARITY");

/**
 * The file in front of a path (`findings/math-2026-0142.json: title.zh`) among the files known, else null. The longest one wins: a
 * stray file named `glossary.json: x.json` holds its own issue, which is not the glossary's.
 */
function fileOf(issuePath: string, known: ReadonlySet<string>): string | null {
  let found: string | null = null;
  for (let i = issuePath.indexOf(": "); i >= 0; i = issuePath.indexOf(": ", i + 1)) {
    const candidate = issuePath.slice(0, i);
    if (known.has(candidate)) found = candidate;
  }
  return found;
}

/** `date` when nothing else dates the records: the newest date any stored record carries, else a fixed one. */
function recordsDate(publishing: IsoDate | undefined, dates: readonly string[]): IsoDate {
  if (publishing !== undefined) return publishing;
  return dates.reduce((newest, d) => (d > newest ? d : newest), "2000-01-01");
}

/**
 * `publishing` names the edition being written, whose brief is the records being published (SPEC §4.12 "Stored records"). A date
 * that no file of the folder is named for gives no records being published, and every safety error of every record would pass as a
 * warning: a wrong date must be an error, not a quiet downgrade. A file that is there but unusable (a link, a bad schema, another
 * date inside) is reported on its own, so only an absent path is reported here.
 */
function publishingIssues(publishing: IsoDate | undefined, listing: readonly Listed[]): ValidationIssue[] {
  if (publishing === undefined) return [];
  const file = `briefs/${publishing}.json`;
  if (listing.some((entry) => entry.path === file)) return [];
  return [error("XREF", "(publishing)", `publishing names ${publishing}, but ${file} is not in the folder, so no record is being published and each is judged as one published before.`,
    "Pass the date of the edition publish wrote: its brief is in the folder.")];
}

/**
 * `validateAll()`: every file under `dir` against its schema, every brief with the findings it names, every stored record once,
 * and the rules that read the whole folder (SPEC §4.12 "Stored records", §6, §8.6, §8.7). An empty or missing folder passes, unless
 * `publishing` names an edition, whose brief it then lacks (one XREF at `(publishing)`). See the header for how the records are
 * judged and how an issue is attributed to a file.
 */
export function validateAll(dir: string, opts: AllOptions = {}): AllResult {
  const root = path.resolve(dir);
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(root);
  } catch {
    stat = null;
  }
  if (stat === null) return noFiles(publishingIssues(opts.publishing, []));
  if (!stat.isDirectory()) return noFiles([error("SCHEMA", "(root)", `${dir} is not a folder.`, "Give the content folder.")]);
  const listing = listContent(root);
  if (listing === null) return noFiles([error("SCHEMA", "(root)", `${dir} could not be read as a folder.`, "Check its permissions.")]);
  if (listing.length === 0) return noFiles(publishingIssues(opts.publishing, []));

  const issues: ValidationIssue[] = publishingIssues(opts.publishing, listing);
  const stored: StoredFile[] = [];
  const briefByDate = new Map<string, Brief>();
  const findings: Finding[] = [];
  let terms: Term[] = [];
  let corrections: Correction[] = [];
  let reports: Report[] = [];
  let archive: ArchiveIndex | null = null;
  const dates: string[] = [];

  for (const entry of listing) {
    const file = entry.path;
    if (!entry.regular) {
      stored.push({ path: file, regular: false, parsed: false, id: null });
      continue;
    }
    const kind = classifyPath(file);
    if (kind === null) {
      stored.push({ path: file, regular: true, parsed: false, id: null });
      continue;
    }
    const read = readJson(root, file);
    if (!read.ok) {
      issues.push(read.issue);
      stored.push({ path: file, regular: true, parsed: false, id: null });
      continue;
    }
    const parsed = SCHEMAS[kind.kind].safeParse(read.raw);
    if (!parsed.success) {
      issues.push(...schemaIssues(parsed.error, read.raw).map((i) => ({ ...i, path: `${file}: ${i.path}` })));
      stored.push({ path: file, regular: true, parsed: false, id: null });
      continue;
    }
    const data: unknown = parsed.data;
    let id: string | null = null;
    // A dated file holds the date of its name, or the site skips it (SPEC §6); one that does not is left out of the runs, so that no
    // issue is filed under a file it does not lie in.
    if (kind.key !== null && kind.kind !== "finding") {
      const date = (data as { date: string }).date;
      if (date !== kind.key) {
        issues.push(error("DATE_MISMATCH", `${file}: date`, `date is ${date} but the file is named ${kind.key}.json; they must match.`, "Rename the file to the date it holds, or correct the date."));
      } else if (kind.kind === "brief") {
        briefByDate.set(kind.key, data as Brief);
        dates.push(kind.key);
      }
    } else if (kind.kind === "finding") {
      const finding = data as Finding;
      id = finding.id;
      if (finding.id === kind.key) findings.push(finding);
      dates.push(finding.updated);
    } else if (kind.kind === "glossary") {
      terms = (data as { terms: Term[] }).terms;
      for (const term of terms) dates.push(term.first_date);
    } else if (kind.kind === "corrections") {
      corrections = (data as { corrections: Correction[] }).corrections;
      for (const c of corrections) dates.push(c.date);
    } else if (kind.kind === "reports") {
      reports = (data as { reports: Report[] }).reports;
    } else if (kind.kind === "archive") {
      archive = data as ArchiveIndex;
    }
    stored.push({ path: file, regular: true, parsed: true, id });
  }

  const config = opts.config ?? loadConfig();
  const rules = opts.rules ?? RULES;
  const briefs = [...briefByDate.values()]; // oldest first: the listing is sorted by path, and a brief's path is its date
  const findingBy = new Map(findings.map((f) => [f.id, f]));
  const sortedFindings = [...findings].sort((a, b) => compareFindingIds(a.id, b.id));
  const publishing = opts.publishing ?? null;

  // Each brief, with the findings it names and the glossary terms those list. A run for one brief holds only a part of the other
  // records, so only what points into the brief's own file and the findings it holds is taken from it; the run over every record
  // below judges those records whole.
  const perBriefRules = rules.filter((rule) => !isCrossFile(rule));
  for (const brief of briefs) {
    const named = namedFindingIds(brief).flatMap((id) => findingBy.get(id) ?? []).sort((a, b) => compareFindingIds(a.id, b.id));
    const listed = new Set(named.flatMap((f) => f.terms));
    const own = `briefs/${brief.date}.json: `;
    const held = new Set(named.map((f) => `findings/${f.id}.json: `));
    try {
      const input = buildPublishedInput(brief, { findings: named, terms: terms.filter((t) => listed.has(t.id)), corrections, reports }, { config, publishing });
      for (const issue of runRules(input, perBriefRules)) {
        const inFile = /^[A-Za-z0-9_./-]+\.json: /.exec(issue.path);
        if (inFile === null || issue.path.startsWith(own) || held.has(inFile[0])) issues.push(issue);
      }
    } catch (err) {
      issues.push(engineFault(err));
    }
  }

  // Every record once, and the folder's own facts. The terms hidden for their own name come from the safety rules' verdicts on
  // this run, so LANG_PARITY runs after it.
  try {
    const base = buildPublishedInput(null, { findings: sortedFindings, terms, corrections, reports }, { config, publishing, date: recordsDate(publishing ?? undefined, dates) });
    const folder = (hiddenTerms: ReadonlySet<string>): PublishedInput => ({ ...base, published: { ...base.published, folder: { files: stored, briefs, archive, hiddenTerms } } });
    const first = runRules(folder(new Set()), rules.filter((rule) => !readsParity(rule)));
    issues.push(...first);
    issues.push(...runRules(folder(hiddenTermIds(first, terms)), rules.filter(readsParity)));
  } catch (err) {
    issues.push(engineFault(err));
  }

  return assemble(stored.map((f) => f.path), issues, opts.perFile === true);
}

/** The result for a folder with nothing to read: one that is missing or empty passes, one that is not a folder or cannot be listed has its one issue. No file holds an issue, so `perFile` adds nothing. */
function noFiles(issues: readonly ValidationIssue[]): AllResult {
  return { ...toResult(issues), files: [] };
}

/** The result of a run: the combined issues, and with `perFile` each file's issues, a file's own path taken off the front. */
function assemble(filePaths: readonly string[], issues: readonly ValidationIssue[], perFile: boolean): AllResult {
  const sorted = sortIssues(issues);
  const combined = toResult(sorted);
  if (!perFile) return { ...combined, files: [] };
  const known = new Set([...filePaths, ARCHIVE_FILE]);
  const byFile = new Map<string, ValidationIssue[]>(filePaths.map((f) => [f, []]));
  for (const issue of sorted) {
    const file = fileOf(issue.path, known);
    if (file === null) continue;
    const list = byFile.get(file) ?? [];
    list.push({ ...issue, path: issue.path.slice(file.length + 2) });
    byFile.set(file, list);
  }
  const files = [...byFile.keys()].sort(byCodeUnit).map((file) => ({ file, ...toResult(byFile.get(file)!) }));
  return { ...combined, files };
}
