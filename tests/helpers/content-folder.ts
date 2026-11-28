// Helpers for tests/content.test.ts: content folders on disk, built from tests/helpers/stored-world.ts and then damaged, the probe rule
// that plants one validator issue at a chosen place so that the loader's reading of the issues is tested on its own, and a way to hand
// the loader a validator result made by hand. Everything here is made up; the planted texts are the made-up kinds the safety rules read
// (a run of letters, a secret-shaped string, the canary) and each is built from pieces, so no file of the repository holds one whole.
//
// New for this project; Cyber's tests/content.test.ts copied its sample folder and edited it in place.

import fs from "node:fs";
import path from "node:path";
import { loadContent, type Content, type LoadContentOptions } from "../../lib/content";
import type { LoadedConfig } from "../../lib/config";
import { compareFindingIds } from "../../lib/ids";
import { publishedRules } from "../../lib/rules/published";
import { defineRule, error, warning, type Rule, type ValidationIssue } from "../../lib/rules/types";
import { Correction, Report } from "../../lib/schema/misc";
import { Term } from "../../lib/schema/glossary";
import { toResult, type AllResult } from "../../lib/validate";
import { CANARY_TOKEN } from "../../lib/vocab";
import { config, findingOf, readJson, writeJson, type Json, type StoredWorld } from "./stored-world";

// ── Planted text ─────────────────────────────────────────────────────────────────────────────────

/** Twenty letters of A, C, G and T: the shortest run DUAL_USE reads as a nucleotide sequence. Made up and meaningless. */
export const SEQUENCE: string = ["ACGT", "ACGT", "ACGT", "ACGT", "ACGT"].join("");

/** A string shaped like a GitHub token, which SECRET_LIKE reads. Made of repeated filler, never a real key. */
export const SECRET: string = ["gh", "p_", "UTSAMPLE".repeat(4), "0000"].join("");

/** The project's canary, which CANARY reads. */
export const CANARY: string = CANARY_TOKEN;

/** An address on the blocked list (a paste site), which BLOCKED_HOST reads. */
export const BLOCKED_URL: string = ["https://", "pastebin", ".com/ut-sample"].join("");

// ── The loader, as the tests call it ─────────────────────────────────────────────────────────────

let loaded: LoadedConfig | undefined;
/** The real config, read once. */
export function cfg(): LoadedConfig {
  loaded ??= config();
  return loaded;
}

/**
 * `loadContent()` for a test: never cached, the real config, no log, and the three published rules (the layout, XREF and LANG_PARITY),
 * so that another group's change cannot turn a case red. A case that wants the whole registry or a probe says so in `over`.
 */
export function load(dir: string, over: LoadContentOptions = {}): Content {
  return loadContent(dir, { fresh: true, config: cfg(), rules: publishedRules, log: () => {}, ...over });
}

// ── Damaging a folder ────────────────────────────────────────────────────────────────────────────

/** Reads the JSON file `rel` under `dir`, lets `edit` change it, and writes it back. */
export function patchJson(dir: string, rel: string, edit: (record: Json) => void): void {
  const record = readJson(dir, rel);
  edit(record);
  writeJson(dir, rel, record);
}

/** Every file under `dir` with its text (a link or special file as a marker), for proving that a load changed nothing. */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(entryRel);
      else out[entryRel] = entry.isFile() ? fs.readFileSync(path.join(dir, entryRel), "utf8") : "(not a file)";
    }
  };
  walk("");
  return out;
}

// ── Extra records for a world ────────────────────────────────────────────────────────────────────

/** A copy of the finding `from` under the new id `id`, added to the world in id order. The copy is a stored record the schema accepts. */
export function addFindingCopy(world: StoredWorld, from: string, id: string): void {
  world.findings.push({ ...structuredClone(findingOf(world, from)), id });
  world.findings.sort((a, b) => compareFindingIds(a.id, b.id));
}

/** `count` more glossary terms, `zz-00` and on, after the world's own (the file is sorted by id); each is first used by `first_finding`. */
export function addTerms(world: StoredWorld, count: number, first_finding: string): void {
  for (let i = 0; i < count; i++) {
    world.terms.push(Term.parse({
      id: `zz-${String(i).padStart(2, "0")}`,
      en: { term: `made-up term ${i}`, definition: "A made-up term for a test." },
      zh: null,
      fields: ["physics"],
      first_finding,
      first_date: "2026-11-19",
    }));
  }
}

/** `count` more reader reports, `R-0003` and on, each an open report on the world's second finding like the world's own `R-0002`. */
export function addReports(world: StoredWorld, count: number): void {
  const open = world.reports.find((r) => r.status === "open");
  if (open === undefined) throw new Error("the world has no open report to copy");
  for (let i = 0; i < count; i++) {
    world.reports.push(Report.parse({ ...structuredClone(open), id: `R-${String(world.reports.length + 1).padStart(4, "0")}`, issue_number: 100 + i }));
  }
}

/**
 * A correction that refiles `finding_id` at `filingPath` (`significance`, `field`, `subfield`, `kind`, `ai.role` or `ai.confidence`) to
 * `after`, dated `date`, the next in the sequence; filed in the world and returned.
 */
export function addRefiling(world: StoredWorld, finding_id: string, filingPath: string, after: string, date: string): Correction {
  const correction = Correction.parse({
    id: `C-${String(world.corrections.length + 1).padStart(4, "0")}`,
    date,
    finding_id,
    edition_date: null,
    term_id: null,
    type: "correction",
    path: filingPath,
    before: { en: "The earlier filing.", zh: null },
    after: { en: after, zh: null },
    reason: { en: "A made-up reason.", zh: null },
    source_url: null,
    trigger: "editor",
    report_id: null,
  });
  world.corrections.push(correction);
  return correction;
}

// ── Probe rules and hand-made results ────────────────────────────────────────────────────────────

/** One planted issue: its code, the path as the engine writes it (`findings/math-2026-0002.json: title.en`, or `(engine)`), and its severity (an error unless told). */
export type Planted = readonly [code: string, path: string, severity?: "error" | "warning"];

/**
 * A rule that reports each planted issue once, in `validateAll()`'s run over every record (its other runs, one for each brief, hold
 * no folder). The engine downgrades an error of DUAL_USE or BLOCKED_HOST to a warning, as it does on every stored record, so a case
 * that needs the severity itself gives `"warning"` or builds a result by hand.
 */
export function plant(...planted: [Planted, ...Planted[]]): Rule {
  const codes = [...new Set(planted.map(([code]) => code))] as [string, ...string[]];
  return defineRule({
    code: codes,
    scope: "published",
    check: (input) => {
      if (input.mode !== "published" || input.published.folder === undefined) return [];
      return planted.map(([code, at, severity]) => (severity === "warning" ? warning : error)(code, at, `${code} planted at ${at}`));
    },
  });
}

/**
 * `base` with more issues: each `[file, issue]` is added to that file's entry (the issue's path inside the file) and to the combined
 * list (the path with the file in front); a null file adds the issue to the combined list alone, as the folder-level issues are.
 */
export function withIssues(base: AllResult, added: readonly (readonly [file: string | null, issue: ValidationIssue])[]): AllResult {
  const files = base.files.map((f) => {
    const mine = added.filter(([file]) => file === f.file).map(([, issue]) => issue);
    return mine.length === 0 ? f : { file: f.file, ...toResult([...f.issues, ...mine]) };
  });
  const combined = [
    ...base.issues,
    ...added.map(([file, issue]) => (file === null ? issue : { ...issue, path: `${file}: ${issue.path}` })),
  ];
  return { ...toResult(combined), files };
}

/** An error or a warning with a made-up message, for `withIssues()`. */
export const issue = (code: string, path: string, severity: "error" | "warning" = "error"): ValidationIssue =>
  (severity === "error" ? error : warning)(code, path, `${code} at ${path}`);
