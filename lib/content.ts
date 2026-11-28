// Content loading for the site, the chat edition and the reply file (SPEC §6 "Content loading", §4.12 "Stored records", §8.8, §8.9).
// `loadContent(dir)` re-checks the content folder with `validateAll(dir, { perFile: true })` and returns the records that survive,
// each list in a fixed order, with what it left out (`skipped`) and the files it loaded in spite of errors (`warnings`). Nothing here
// fails the build: a missing or empty folder is an empty `Content`, and a file that cannot be read is a skipped file with a code
// (keep last good). The rules, from the validator's per-file issues:
//
//   - A file with a `SCHEMA`, `FILE_LAYOUT` or `DATE_MISMATCH` issue is left out whole, a stray or linked path too (it is never
//     read). So is a brief or a finding that carries a `CANARY`, `SECRET_LIKE`, `DUAL_USE` or `BLOCKED_HOST` issue, at either
//     severity (on a stored record `DUAL_USE` and `BLOCKED_HOST` are warnings, SPEC §4.12).
//   - In `glossary.json`, `corrections.json` and `reports.json` a record with one of those four codes is left out alone, found by
//     the index at the front of the issue's path (`terms[2].en.definition`), and the rest of the file loads. A file-level code or
//     a safety code that names no record leaves the whole file out. A record is named in `skipped` by that index (`glossary.json
//     terms[2]`), never by its id: a term's id can hold the name that failed.
//   - `BLOCKED_HOST` on a field that is itself an address (a source's `url`, a correction's `source_url`, a Lean artefact, a
//     figure's `image_url`) skips nothing: `safeHref()` renders such a URL unlinked and the figure block leaves the figure out (§7).
//   - A safety code in a file of any other kind (metrics, status, the pace file, the archive index, an inputs manifest) leaves that
//     file out whole. No rule reads text there, so only a validator result made by hand gets here, and leaving the file out is the
//     safe side.
//   - An issue at the bare path of a file, with no place inside it, is that file's own: no path makes the loader read a file twice,
//     and only the files the validator lists are read at all.
//   - Every other error is a build warning and the record is shown.
//
// Order: whatever order the validator lists its files in, every list, `skipped` and `warnings` come out in one order: what no file
// holds first, then the files by path in code-unit order (a dated file's path is its date, so editions run oldest first), and the
// records of a list file by their place in it. Within one file the codes are in the validator's order.
//
// Nothing is rewritten. A brief that names a skipped finding still loads, as does a correction or a report about one, so a page or a
// renderer finds a record absent by looking it up (`findingById()`), and `skipped` says why: a finding's file is named by its id, so
// `findings/<id>.json` in `skipped` is that finding, while a finding no file holds shows only as an XREF warning on what names it.
// `loadContent()` only reads the folder, each file it keeps once and after the validator; it never changes what it reads, nor the
// validator's result. A finding's `significance`, `field`, `subfield`, `kind`, `ai.role` and `ai.confidence` are read as `filedAs()`
// files them (§4.10) through `filedFinding()` and `filedFindings()`. `leavesOut()` is the one decision on a single issue, exported so
// that re-check's safety flags send the next agent exactly what the site skips (§4.12 "Stored records").
//
// What a caller may not do: change what it is given. Every call for a folder shares one `Content` through the cache, and its records
// are the parsed files, not frozen copies, so a page that wants another order or a subset makes its own list. The cache is keyed by
// the resolved folder alone: a second call with another `config` or `rules` answers the first (only tests pass them, with `fresh`).
// A file that changes between the validator's read and the loader's is not guarded against, since a build reads a checkout: one that
// no longer parses is `SCHEMA`, one that parses differently is read as it now is.
//
// Cyber's lib/content.ts at the fork commit 3ced1fb, adapted: `FileCodes`, `contentLogLines()`, the keep-last-good rule with
// `SITE_BLOCKING_CODES`, the per-folder cache with `fresh`, and the log that prints once per folder are Cyber's pattern. The layout,
// the files that list several records and skip one at a time, the findings, the hidden terms, `leavesOut()` and the filed views are
// this project's; Cyber's loader threw for a missing folder and read files of its own domain, none of which is here.

import fs from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";
import type { LoadedConfig } from "./config";
import { byCodeUnit, compareFindingIds } from "./ids";
import { filedAs, type Filable } from "./items";
import { classifyPath, hiddenTermIds, type ContentKind } from "./rules/published";
import type { Rule, ValidationIssue } from "./rules/types";
import { Brief } from "./schema/brief";
import type { IsoDate } from "./schema/common";
import { Finding } from "./schema/finding";
import { GlossaryFile, type Term } from "./schema/glossary";
import { MetricsFile, PaceWeeklyFile } from "./schema/metrics";
import { ArchiveIndex, CorrectionsFile, ReportsFile, type Correction, type Report } from "./schema/misc";
import { StatusFile } from "./schema/status";
import { contentDir } from "./site";
import { validateAll, type AllResult } from "./validate";

export { contentDir };

// ── The codes that leave a record out ────────────────────────────────────────────────────────────

/** The codes that leave a whole file out. */
const FILE_CODES = ["SCHEMA", "FILE_LAYOUT", "DATE_MISMATCH"] as const;
/** The codes that leave a brief, a finding or one glossary term, correction or report out. */
const RECORD_CODES = ["CANARY", "SECRET_LIKE", "DUAL_USE", "BLOCKED_HOST"] as const;

/**
 * The codes the site skips on (SPEC §4.12 "Stored records", §6): a brief, a finding, or one glossary term, correction or report
 * that carries one at either severity is left out, and so is a file with one of the first three. `BLOCKED_HOST` on a field that is
 * itself an address skips nothing (see the file's header).
 */
export const SITE_BLOCKING_CODES = [...FILE_CODES, ...RECORD_CODES] as const;

const isFileCode = (code: string): boolean => (FILE_CODES as readonly string[]).includes(code);
const isRecordCode = (code: string): boolean => (RECORD_CODES as readonly string[]).includes(code);

/**
 * The fields where `BLOCKED_HOST` leaves nothing out (§4.12), by the path the validator gives inside the file: a source's `url`
 * (a brief's and a finding's), a finding's figure and Lean artefacts, and a correction's `source_url`. A report's `evidence_url`
 * is not one of them.
 */
const ADDRESS_FIELDS: Readonly<Partial<Record<ContentKind, RegExp>>> = {
  brief: /^sources\[\d+\]\.url$/,
  finding: /^(?:sources\[\d+\]\.url|figure\.image_url|artefacts\.lean\[\d+\])$/,
  corrections: /^corrections\[\d+\]\.source_url$/,
};

/** What a table says about a kind of file: nothing for an entry that no file holds (`kind` null). */
function forKind<T>(table: Readonly<Partial<Record<ContentKind, T>>>, kind: ContentKind | null): T | undefined {
  return kind === null ? undefined : table[kind];
}

type Found = Pick<ValidationIssue, "code" | "path">;

/** True when `issue` leaves out the record or the file it is at. */
function blocks(kind: ContentKind | null, issue: Found): boolean {
  if (isFileCode(issue.code)) return true;
  if (!isRecordCode(issue.code)) return false;
  return issue.code !== "BLOCKED_HOST" || !(forKind(ADDRESS_FIELDS, kind)?.test(issue.path) ?? false);
}

/**
 * True when `issue` leaves out the file it is in, or the record of that file it is at: `file` is a path under the content folder as
 * `validateAll()` names it (`findings/math-2026-0142.json`) and `issue.path` the path inside it (`explainer.found.en`), either severity.
 * Re-check's safety flags read it, so that what it sends the next agent is exactly what the site skips (SPEC §4.12 "Stored records",
 * §8.9): a `BLOCKED_HOST` on an address field leaves nothing out, so it is never flagged.
 */
export function leavesOut(file: string, issue: Found): boolean {
  return blocks(classifyPath(file)?.kind ?? null, issue);
}

/** The three files that list several records, each with the index that an issue's path starts with. */
const RECORDS: Readonly<Partial<Record<ContentKind, { readonly list: string; readonly at: RegExp }>>> = {
  glossary: { list: "terms", at: /^terms\[(0|[1-9][0-9]*)\]/ },
  corrections: { list: "corrections", at: /^corrections\[(0|[1-9][0-9]*)\]/ },
  reports: { list: "reports", at: /^reports\[(0|[1-9][0-9]*)\]/ },
};

// ── What the loader returns ──────────────────────────────────────────────────────────────────────

/** A file or record the site did not load, or loaded with errors, and the codes that say why: distinct, in the validator's order, never the matched text. */
export interface FileCodes {
  /**
   * Relative to the content folder, "/"-separated: `briefs/2026-11-19.json`; one record of a file that lists several by its place
   * in the file, `glossary.json terms[2]`; `(root)`, `(engine)` or `(rule CODE)` for what no file holds (the folder that cannot
   * be read, a validator fault).
   */
  file: string;
  codes: string[];
}

/**
 * A glossary term left out for `DUAL_USE` or `BLOCKED_HOST` in its own name (its `id`, either `term`, `official` or `official_url`;
 * SPEC §8.9). The term itself is not kept, since its id holds the name: `first_finding` is the finding that first used it, and the
 * chat edition's Note names that.
 */
export interface HiddenTerm {
  first_finding: string;
  /** The codes it fails in its name, `DUAL_USE` before `BLOCKED_HOST`. */
  codes: ("DUAL_USE" | "BLOCKED_HOST")[];
}

/** The content folder as the site reads it: only what the validator let through, each list in a fixed order. Treat it as read-only. */
export interface Content {
  /** The folder as given (not resolved). */
  dir: string;
  /** Oldest first. */
  briefs: readonly Brief[];
  /** In `compareFindingIds()` order (year, then the counter). A skipped finding is not here. */
  findings: readonly Finding[];
  /** `metrics/D.json`, oldest first. The inputs manifests under `metrics/inputs/` are checked and reported but not loaded. */
  metrics: readonly MetricsFile[];
  /** `state/pace-weekly.json`; null when it is missing or left out. */
  pace: PaceWeeklyFile | null;
  /** Oldest first. */
  status: readonly StatusFile[];
  /** In the file's order (by id); a term left out is not here. */
  terms: readonly Term[];
  /** The terms left out for their own name, by `first_finding` (`compareFindingIds()`), then in the file's order. */
  hiddenTerms: readonly HiddenTerm[];
  /** In the file's order (`C-0001` first); a correction left out is not here, so it files nothing. */
  corrections: readonly Correction[];
  /** In the file's order (`R-0001` first). */
  reports: readonly Report[];
  /** Null when `archive-index.json` is missing or left out. */
  archive: ArchiveIndex | null;
  /** The files and records left out, with the codes that left them out: folder-level entries first, then by path, records by place. */
  skipped: readonly FileCodes[];
  /** The files loaded although they hold errors: the codes of those errors, outside the blocking ones, at records still shown. */
  warnings: readonly FileCodes[];
}

export interface LoadContentOptions {
  /** Skip the cache (tests). */
  fresh?: boolean;
  /** The config the validator judges against; default `loadConfig()`, read only when the folder holds something (a ConfigError propagates). */
  config?: LoadedConfig;
  /** The rules the validator runs; default the registry (tests pass their own). */
  rules?: readonly Rule[];
  /** Where the skip and warning lines go; default `console.warn`, once per folder per process. */
  log?: (line: string) => void;
}

/** The build log's lines for a loaded folder: `content: skipped briefs/2026-11-19.json (SCHEMA)`, then the warnings. */
export function contentLogLines(content: Pick<Content, "skipped" | "warnings">): string[] {
  return [
    ...content.skipped.map((s) => `content: skipped ${s.file} (${s.codes.join(", ")})`),
    ...content.warnings.map((w) => `content: warning ${w.file} (${w.codes.join(", ")})`),
  ];
}

// ── Reading one folder ───────────────────────────────────────────────────────────────────────────

/** What the validator found in one file, read for the loader. */
interface Verdict {
  /** The blocking codes that leave the whole file out; empty when it is read. */
  whole: string[];
  /** The blocking codes that leave one record of a list file out, by its place in the file. */
  dropped: Map<number, string[]>;
  /** The codes of the other errors, with the record each is at (null: not at a record). */
  others: { code: string; at: number | null }[];
}

function addDistinct(codes: string[], code: string): void {
  if (!codes.includes(code)) codes.push(code);
}

/** Sorts the issues of one file into the three kinds of verdict. */
function judge(kind: ContentKind | null, issues: readonly ValidationIssue[]): Verdict {
  const records = forKind(RECORDS, kind);
  const whole: string[] = [];
  const dropped = new Map<number, string[]>();
  const others: Verdict["others"] = [];
  for (const issue of issues) {
    const m = records === undefined ? null : records.at.exec(issue.path);
    const at = m === null ? null : Number(m[1]);
    if (!blocks(kind, issue)) {
      if (issue.severity === "error") others.push({ code: issue.code, at });
    } else if (at === null || isFileCode(issue.code)) {
      addDistinct(whole, issue.code);
    } else {
      const codes = dropped.get(at) ?? [];
      addDistinct(codes, issue.code);
      dropped.set(at, codes);
    }
  }
  return { whole, dropped, others };
}

/** True when `issuePath` starts with one of `known` and `: ` (`findings/math-2026-0142.json: title.zh`). */
function inFile(issuePath: string, known: ReadonlySet<string>): boolean {
  for (let i = issuePath.indexOf(": "); i >= 0; i = issuePath.indexOf(": ", i + 1)) {
    if (known.has(issuePath.slice(0, i))) return true;
  }
  return false;
}

/** A file of the folder, or an issue path that no file holds, with its issues (paths relative to the file). */
interface Entry {
  name: string;
  /** True for a file of the folder: only those are classified and read, whatever an issue path happens to look like. */
  isFile: boolean;
  issues: readonly ValidationIssue[];
}

const byName = (a: Entry, b: Entry): number => byCodeUnit(a.name, b.name);

/**
 * Every entry the verdicts are made on, in one order whatever the validator's: the issues that no file holds (`(root)`, `(engine)`,
 * `(rule CODE)`), grouped by path as entries of their own, then the files by path in code-unit order. An issue at the bare path of
 * a file, with no place inside it, is that file's own: it never makes a second entry that would read the file again.
 */
function entriesOf(result: AllResult): Entry[] {
  const known = new Set(result.files.map((f) => f.file));
  const bare = new Map<string, ValidationIssue[]>();
  const apart = new Map<string, ValidationIssue[]>();
  for (const issue of result.issues) {
    if (inFile(issue.path, known)) continue;
    const into = known.has(issue.path) ? bare : apart;
    const held = into.get(issue.path);
    if (held === undefined) into.set(issue.path, [issue]);
    else held.push(issue);
  }
  const folder = [...apart].map(([name, issues]): Entry => ({ name, isFile: false, issues })).sort(byName);
  const files = result.files
    .map((f): Entry => ({ name: f.file, isFile: true, issues: [...f.issues, ...(bare.get(f.file) ?? [])] }))
    .sort(byName);
  return [...folder, ...files];
}

/** The schema that reads each kind of file; the inputs manifests are checked by the validator and not loaded. */
const SCHEMAS: Readonly<Partial<Record<ContentKind, ZodType>>> = {
  brief: Brief, finding: Finding, metrics: MetricsFile, status: StatusFile, pace: PaceWeeklyFile,
  glossary: GlossaryFile, corrections: CorrectionsFile, reports: ReportsFile, archive: ArchiveIndex,
};

/**
 * The file parsed with its schema: null when nothing is there (the archive index the validator asks for when it is missing), else
 * the data, or the code that leaves the file out. A link or special file is never read (the validator names it FILE_LAYOUT); a read
 * or parse that fails after the validator passed the file, a change in between, is `SCHEMA`.
 */
function readFile(root: string, file: string, schema: ZodType): { data: unknown } | { skip: string } | null {
  const full = path.join(root, file);
  let info: fs.Stats;
  try {
    info = fs.lstatSync(full);
  } catch {
    return null;
  }
  if (!info.isFile()) return { skip: "FILE_LAYOUT" };
  try {
    const parsed = schema.safeParse(JSON.parse(fs.readFileSync(full, "utf8")));
    return parsed.success ? { data: parsed.data } : { skip: "SCHEMA" };
  } catch {
    return { skip: "SCHEMA" };
  }
}

/** The terms in `terms` whose own name fails DUAL_USE or BLOCKED_HOST, as `hiddenTermIds()` reads the issues of `glossary.json`. */
function hiddenTermsOf(issues: readonly ValidationIssue[], terms: readonly Term[]): HiddenTerm[] {
  const named = (["DUAL_USE", "BLOCKED_HOST"] as const).map((code) => ({
    code,
    ids: hiddenTermIds(issues.filter((i) => i.code === code).map((i) => ({ ...i, path: `glossary.json: ${i.path}` })), terms),
  }));
  return terms
    .flatMap((term) => {
      const codes = named.filter((n) => n.ids.has(term.id)).map((n) => n.code);
      return codes.length === 0 ? [] : [{ first_finding: term.first_finding, codes }];
    })
    .sort((a, b) => compareFindingIds(a.first_finding, b.first_finding));
}

function readContent(dir: string, root: string, opts: LoadContentOptions): Content {
  const result = validateAll(root, { perFile: true, config: opts.config, rules: opts.rules, publishing: undefined });
  const skipped: FileCodes[] = [];
  const warnings: FileCodes[] = [];
  const briefs: Brief[] = [];
  const findings: Finding[] = [];
  const metrics: MetricsFile[] = [];
  const status: StatusFile[] = [];
  let pace: PaceWeeklyFile | null = null;
  let terms: Term[] = [];
  let hiddenTerms: HiddenTerm[] = [];
  let corrections: Correction[] = [];
  let reports: Report[] = [];
  let archive: ArchiveIndex | null = null;

  // What no file holds first, then the files by path in code-unit order, so that every list, `skipped` and `warnings` come out in
  // one order whatever order the validator lists them in; a dated file's path is its date, so the lists of editions run oldest first.
  for (const { name, isFile, issues } of entriesOf(result)) {
    const kind = isFile ? classifyPath(name)?.kind ?? null : null;
    const verdict = judge(kind, issues);
    if (verdict.whole.length > 0) {
      skipped.push({ file: name, codes: verdict.whole });
      continue;
    }
    const schema = forKind(SCHEMAS, kind);
    const read = schema === undefined ? null : readFile(root, name, schema);
    if (read !== null && "skip" in read) {
      skipped.push({ file: name, codes: [read.skip] });
      continue;
    }
    if (read !== null) {
      const data = read.data;
      // A list file keeps each record the validator did not drop.
      const keep = <T>(all: readonly T[]): T[] => all.filter((_, i) => !verdict.dropped.has(i));
      if (kind === "brief") briefs.push(data as Brief);
      else if (kind === "finding") findings.push(data as Finding);
      else if (kind === "metrics") metrics.push(data as MetricsFile);
      else if (kind === "status") status.push(data as StatusFile);
      else if (kind === "pace") pace = data as PaceWeeklyFile;
      else if (kind === "archive") archive = data as ArchiveIndex;
      else if (kind === "glossary") {
        const all = (data as { terms: Term[] }).terms;
        terms = keep(all);
        hiddenTerms = hiddenTermsOf(issues, all);
      } else if (kind === "corrections") corrections = keep((data as { corrections: Correction[] }).corrections);
      else if (kind === "reports") reports = keep((data as { reports: Report[] }).reports);
      const list = forKind(RECORDS, kind)?.list;
      for (const at of [...verdict.dropped.keys()].sort((a, b) => a - b)) {
        skipped.push({ file: `${name} ${list}[${at}]`, codes: verdict.dropped.get(at)! });
      }
    }
    const codes: string[] = [];
    for (const other of verdict.others) {
      if (other.at === null || !verdict.dropped.has(other.at)) addDistinct(codes, other.code);
    }
    if (codes.length > 0) warnings.push({ file: name, codes });
  }

  return {
    dir,
    briefs,
    findings: findings.sort((a, b) => compareFindingIds(a.id, b.id)),
    metrics,
    pace,
    status,
    terms,
    hiddenTerms,
    corrections,
    reports,
    archive,
    skipped,
    warnings,
  };
}

const cache = new Map<string, Content>();
const logged = new Set<string>();

/**
 * The content folder, re-checked (SPEC §6 "Content loading"): what survives, and what was left out and why. Never throws for a
 * folder: a missing or empty one is an empty `Content`. Cached per folder unless `fresh`, and the skip and warning lines are
 * printed once per folder per process unless `log` takes them. Only a config that cannot be read (a ConfigError) throws.
 */
export function loadContent(dir: string = contentDir(), opts: LoadContentOptions = {}): Content {
  const root = path.resolve(dir);
  const hit = cache.get(root);
  if (hit !== undefined && opts.fresh !== true) return hit;
  const content = readContent(dir, root, opts);
  if (opts.fresh !== true) cache.set(root, content);
  const lines = contentLogLines(content);
  if (opts.log !== undefined) {
    for (const line of lines) opts.log(line);
  } else if (lines.length > 0 && !logged.has(root)) {
    logged.add(root);
    for (const line of lines) console.warn(line);
  }
  return content;
}

// ── Looking records up, and the filed views ──────────────────────────────────────────────────────

/** The finding with this id, or undefined when there is none or the loader left it out: a page or a renderer leaves out what it cannot find. */
export function findingById(content: Pick<Content, "findings">, id: string): Finding | undefined {
  return content.findings.find((f) => f.id === id);
}

/** The newest loaded edition's date, or null when no brief loaded. Every page files its findings on this date (SPEC §6). */
export function newestDate(content: Pick<Content, "briefs">): IsoDate | null {
  return content.briefs.reduce<IsoDate | null>((newest, b) => (newest === null || b.date > newest ? b.date : newest), null);
}

/** A date before every edition: no stored correction is dated on or before it. */
const BEFORE_ANY_EDITION: IsoDate = "0000-00-00";

/**
 * The finding as the loaded corrections file it on `date` (SPEC §4.10): `significance`, `field`, `subfield`, `kind`, `ai.role` and
 * `ai.confidence` as `filedAs()` reads them, every other value as stored. The date is the newest loaded edition's unless given (the
 * chat edition passes the date of the edition it renders); with no edition, no correction applies. A correction the loader left out
 * files nothing. Returns a new finding; the stored one is never changed.
 */
export function filedFinding<F extends Filable>(content: Pick<Content, "briefs" | "corrections">, finding: F, date: IsoDate | null = newestDate(content)): F {
  return filedAs(finding, content.corrections, date ?? BEFORE_ANY_EDITION);
}

/** Every loaded finding as `filedFinding()` files it on `date`, in `content.findings` order. */
export function filedFindings(content: Pick<Content, "briefs" | "corrections" | "findings">, date: IsoDate | null = newestDate(content)): Finding[] {
  return content.findings.map((finding) => filedFinding(content, finding, date));
}
