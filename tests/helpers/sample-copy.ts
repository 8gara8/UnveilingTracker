// Helpers for tests/validate.test.ts (SPEC §4.12 "Fixtures": the T cases of the published-mode codes run "on temporary copies of
// fixtures/site-content/"): a temporary copy of the sample content that one test may damage, read back, rewrite through its schema or
// as raw JSON, validate with `validateAll()` and remove, and the counts of the fixtures that the PR reports (`fixtureCounts()`).
//
// Every test works on a copy of its own (`withSampleCopy()` makes one, runs the test's function and always removes it, a throw
// included), so no test reads another's damage and none touches the real folder: `SAMPLE_DIR` is only ever copied from.
//
// New for this project; Cyber's tests copied its sample folder and edited it in place.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { INVALID_CASES, NAMED_CASES, SOFT_CASES, ZH_INVALID_CASES, ZH_NAMED_CASES, ZH_SOFT_CASES } from "../../fixtures/src/build";
import { EDITION_NAMES, type EditionName } from "../../fixtures/src/world";
import { loadConfig, type LoadedConfig } from "../../lib/config";
import { jsonText } from "../../lib/json";
import { RULE_CODE_TABLE, RULE_GROUP_NAMES, type RuleCodeInfo, type RuleSeverityKind } from "../../lib/rules/index";
import { validateAll, type AllOptions, type AllResult } from "../../lib/validate";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The sample content, the one folder every copy is made from. Tests never write to it. */
export const SAMPLE_DIR = path.join(REPO_ROOT, "fixtures", "site-content");
/** The empty sample (SPEC §3: only its placeholder `README.md`). */
export const EMPTY_DIR = path.join(REPO_ROOT, "fixtures", "empty-content");

let loaded: LoadedConfig | undefined;
/** The repo's `config/`, read once: every run of every copy judges against the same lists, and none changes them. */
export function sampleConfig(): LoadedConfig {
  loaded ??= loadConfig(path.join(REPO_ROOT, "config"));
  return loaded;
}

type Json = any;

/** A temporary copy of the sample content (or of any folder) with the ways a test damages and reads it. */
export class SampleCopy {
  /** The copy's folder, under the system's temporary folder. */
  readonly dir: string;
  private removed = false;

  constructor(from: string = SAMPLE_DIR) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-sample-copy-"));
    fs.cpSync(from, this.dir, { recursive: true });
  }

  /** The absolute path of `rel` ("/"-separated, under the copy). Refuses a path that leaves the copy, so a test can never write outside it. */
  abs(rel: string): string {
    const out = path.resolve(this.dir, rel);
    if (out !== this.dir && !out.startsWith(`${this.dir}${path.sep}`)) throw new Error(`${rel} leaves the sample copy`);
    return out;
  }

  /** Every path under the copy, files and folders, "/"-separated, sorted. */
  list(): string[] {
    const out: string[] = [];
    const walk = (rel: string): void => {
      for (const entry of fs.readdirSync(this.abs(rel === "" ? "." : rel), { withFileTypes: true })) {
        const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
        out.push(entryRel);
        if (entry.isDirectory()) walk(entryRel);
      }
    };
    walk("");
    return out.sort();
  }

  exists(rel: string): boolean {
    return fs.existsSync(this.abs(rel));
  }

  /** A file's text. */
  text(rel: string): string {
    return fs.readFileSync(this.abs(rel), "utf8");
  }

  /** A file's JSON as stored (raw: no schema, so a test may damage it past the schema). */
  read(rel: string): Json {
    return JSON.parse(this.text(rel));
  }

  /** A file's JSON read through its schema: the parsed value, which a schema that does not hold it throws on. */
  readParsed<S extends z.ZodType>(rel: string, schema: S): z.output<S> {
    return schema.parse(this.read(rel));
  }

  /** Writes a text or bytes at `rel`, making its folder. */
  writeRaw(rel: string, content: string | Uint8Array): void {
    fs.mkdirSync(path.dirname(this.abs(rel)), { recursive: true });
    fs.writeFileSync(this.abs(rel), content);
  }

  /** Writes a value as raw JSON (two-space indent, a closing newline, keys as given), or through `schema` as the stored files are written. */
  write(rel: string, value: unknown, schema?: z.ZodType): void {
    this.writeRaw(rel, schema === undefined ? `${JSON.stringify(value, null, 2)}\n` : jsonText(value, schema));
  }

  /** Reads `rel` as raw JSON, lets `edit` change it in place (or return a replacement) and writes it back as raw JSON. */
  editJson(rel: string, edit: (record: Json) => unknown): void {
    const record = this.read(rel);
    const out = edit(record);
    this.write(rel, out === undefined ? record : out);
  }

  /** Reads `rel` through `schema`, lets `edit` change the parsed value in place (or return a replacement) and writes it back through the same schema. */
  editParsed<S extends z.ZodType>(rel: string, schema: S, edit: (record: z.output<S>) => unknown): void {
    const record = this.readParsed(rel, schema);
    const out = edit(record);
    this.write(rel, out === undefined ? record : out, schema);
  }

  /** Removes a file or a folder (and all inside it). */
  remove(rel: string): void {
    fs.rmSync(this.abs(rel), { recursive: true, force: false });
  }

  /** Moves a file or a folder inside the copy. */
  rename(from: string, to: string): void {
    fs.mkdirSync(path.dirname(this.abs(to)), { recursive: true });
    fs.renameSync(this.abs(from), this.abs(to));
  }

  /** Makes a link at `rel` to `target` (a path as `fs.symlinkSync` takes it). */
  link(rel: string, target: string): void {
    fs.mkdirSync(path.dirname(this.abs(rel)), { recursive: true });
    fs.symlinkSync(target, this.abs(rel));
  }

  /** `validateAll()` on the copy with each file's own issues (`perFile`) and the repo's config, unless `opts` says otherwise. */
  validate(opts: AllOptions = {}): AllResult {
    return validateAll(this.dir, { perFile: true, config: sampleConfig(), ...opts });
  }

  /**
   * A string that changes when any file or folder of the copy changes: every path under the copy, folders and links with their kind,
   * files with their bytes. A published-mode case compares it before and after its edit, so an edit that changes nothing (a path
   * that was already null, a value already as set) is told from one that does, and a case whose point is "this edit is ignored"
   * cannot pass because the edit never happened.
   */
  fingerprint(): string {
    const lines: string[] = [];
    for (const rel of this.list()) {
      const info = fs.lstatSync(this.abs(rel));
      if (info.isSymbolicLink()) lines.push(`${rel}\tlink\t${fs.readlinkSync(this.abs(rel))}`);
      else if (info.isDirectory()) lines.push(`${rel}\tfolder`);
      else lines.push(`${rel}\tfile\t${createHash("sha256").update(fs.readFileSync(this.abs(rel))).digest("hex")}`);
    }
    return lines.join("\n");
  }

  /** Removes the copy. Safe to call twice. */
  dispose(): void {
    if (this.removed) return;
    this.removed = true;
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Makes a copy of the sample, runs `fn` on it and removes it whatever `fn` does: the way every test of the published-mode cases starts. */
export function withSampleCopy<T>(fn: (copy: SampleCopy) => T, from?: string): T {
  const copy = new SampleCopy(from);
  try {
    return fn(copy);
  } finally {
    copy.dispose();
  }
}

// ── The numbers the PR reports ───────────────────────────────────────────────────────────────────

export type SeverityCount = Record<RuleSeverityKind, number> & { total: number };

/** What `fixtureCounts()` returns: every number SPEC §10 P1's "In the PR" line asks for (rule codes and fixture counts), read from the code table, the builder and the files on disk. */
export interface FixtureCounts {
  /** The codes of SPEC §4.12's table, by severity and by the group that reports them (`engine`: SCHEMA; `seed`: SEED_SOURCES). */
  codes: { total: number; bySeverity: SeverityCount; byGroup: Record<string, SeverityCount> };
  /** How many codes the table lists each kind of test for (a code may list several). */
  tableTests: Record<"F" | "S" | "T" | "Z", number>;
  /** The fixture files under fixtures/drafts and fixtures/drafts-zh, by kind. */
  files: {
    validEnglish: number; validChinese: number; invalidEnglish: number; softEnglish: number; invalidChinese: number; softChinese: number;
    contexts: number; evidence: number; metrics: number; packs: number; chineseContexts: number; chineseEvidence: number;
  };
  /** The cases the builder holds: F and S files, and the named T cases (English, Chinese, and each edition's share). */
  cases: {
    invalidEnglish: number; softEnglish: number; invalidChinese: number; softChinese: number;
    namedEnglish: number; namedChinese: number; namedByEdition: Record<EditionName, number>; namedChineseByEdition: Record<EditionName, number>;
  };
  /** The sample content: its files by kind and its records. */
  sample: { files: number; briefs: number; findings: number; metrics: number; inputs: number; status: number; fixed: number };
}

const emptyCount = (): SeverityCount => ({ H: 0, S: 0, "H/S": 0, total: 0 });
const bump = (count: SeverityCount, row: RuleCodeInfo): void => {
  count[row.severity]++;
  count.total++;
};

function filesIn(rel: string, test: (name: string) => boolean): number {
  const dir = path.join(REPO_ROOT, rel);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(test).length : 0;
}

function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(entryRel);
      else out.push(entryRel);
    }
  };
  walk("");
  return out;
}

const perEdition = <T extends { edition: EditionName }>(cases: readonly T[]): Record<EditionName, number> =>
  Object.fromEntries(EDITION_NAMES.map((name) => [name, cases.filter((c) => c.edition === name).length])) as Record<EditionName, number>;

/**
 * The numbers the PR must report, computed (never printed): the table's codes by group and severity, the fixtures by kind as they lie
 * on disk and as the builder holds them, and the sample's records. A pure function of the repo's files and the builder's lists.
 */
export function fixtureCounts(): FixtureCounts {
  const bySeverity = emptyCount();
  const byGroup: Record<string, SeverityCount> = Object.fromEntries([...RULE_GROUP_NAMES, "engine", "seed"].map((g) => [g, emptyCount()]));
  for (const row of RULE_CODE_TABLE) {
    bump(bySeverity, row);
    bump(byGroup[row.group]!, row);
  }
  const tableTests = { F: 0, S: 0, T: 0, Z: 0 };
  for (const row of RULE_CODE_TABLE) for (const kind of row.tests) tableTests[kind]++;
  const sampleFiles = filesUnder(SAMPLE_DIR);
  return {
    codes: { total: RULE_CODE_TABLE.length, bySeverity, byGroup },
    tableTests,
    files: {
      validEnglish: filesIn("fixtures/drafts", (n) => /^valid-.*\.json$/.test(n)),
      validChinese: filesIn("fixtures/drafts-zh", (n) => /^valid-.*\.zh\.json$/.test(n)),
      invalidEnglish: filesIn("fixtures/drafts", (n) => /^invalid--.*\.json$/.test(n)),
      softEnglish: filesIn("fixtures/drafts", (n) => /^soft--.*\.json$/.test(n)),
      invalidChinese: filesIn("fixtures/drafts-zh", (n) => /^invalid--.*\.zh\.json$/.test(n)),
      softChinese: filesIn("fixtures/drafts-zh", (n) => /^soft--.*\.zh\.json$/.test(n)),
      contexts: filesIn("fixtures/context", (n) => n.endsWith(".json")),
      evidence: filesIn("fixtures/evidence", (n) => n.endsWith(".json")),
      metrics: filesIn("fixtures/metrics", (n) => n.endsWith(".json")),
      packs: filesIn("fixtures/packs", (n) => n.endsWith(".json")),
      chineseContexts: filesIn("fixtures/drafts-zh", (n) => n.endsWith(".zh-context.json")),
      chineseEvidence: filesIn("fixtures/drafts-zh", (n) => n.endsWith(".zh-evidence.json")),
    },
    cases: {
      invalidEnglish: INVALID_CASES.length,
      softEnglish: SOFT_CASES.length,
      invalidChinese: ZH_INVALID_CASES.length,
      softChinese: ZH_SOFT_CASES.length,
      namedEnglish: NAMED_CASES.length,
      namedChinese: ZH_NAMED_CASES.length,
      namedByEdition: perEdition(NAMED_CASES),
      namedChineseByEdition: perEdition(ZH_NAMED_CASES),
    },
    sample: {
      files: sampleFiles.length,
      briefs: sampleFiles.filter((f) => f.startsWith("briefs/")).length,
      findings: sampleFiles.filter((f) => f.startsWith("findings/")).length,
      metrics: sampleFiles.filter((f) => /^metrics\/\d{4}-\d{2}-\d{2}\.json$/.test(f)).length,
      inputs: sampleFiles.filter((f) => f.startsWith("metrics/inputs/")).length,
      status: sampleFiles.filter((f) => f.startsWith("status/")).length,
      fixed: sampleFiles.filter((f) => !/^(briefs|findings|metrics|status)\//.test(f)).length,
    },
  };
}
