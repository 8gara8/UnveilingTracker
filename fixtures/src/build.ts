// Writes every generated validator fixture (SPEC §4.12 "Fixtures and tests", §8.1), as the fork base's builder does: the
// valid English drafts with their inputs (context, evidence, metrics and pack for each edition, `inputs.ts`, and the weekday's
// `flags.txt`), the invalid and soft drafts, the Chinese drafts and the sample content: each part has a generator in GENERATORS.
// One writer, one registry, two modes:
//   tsx fixtures/src/build.ts           write every file, remove any other file in FIXTURE_DIRS, then validate (fixtures:gen)
//   tsx fixtures/src/build.ts --check   write nothing; exit 1 listing stale, missing or added files (fixtures:check)
// Both exit 1 when a valid draft or one of its inputs fails `validDraftProblems()` (its schemas; tests/validate.test.ts runs the
// rules on every valid draft).
// The output is byte-stable: no timestamp, no machine path, and each JSON file is `jsonText(value, schema)` (SPEC §4.1),
// so its keys follow the schema's order, two-space indent and a closing newline.
//
// Cyber's fixtures/src/build.ts at the fork commit 3ced1fb, adapted: its JSON writer, its `Output` list, the registry of
// generators with the duplicate-path check, the owned-folder compare, write and `--check` modes and the CLI are the same;
// Cyber's binary outputs (its stored-method zips), its CVE and region inputs and its feed and state generators are dropped,
// and the Chinese cases are kept apart from the English ones (their drafts are not `DraftBrief`s).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { jsonText } from "../../lib/json";
import { AgentContext } from "../../lib/schema/context";
import { DraftBrief } from "../../lib/schema/draft";
import { DraftZh } from "../../lib/schema/draft-zh";
import { MetricsFile } from "../../lib/schema/metrics";
import { Evidence } from "../../lib/schema/misc";
import { Pack } from "../../lib/schema/pack";
import { editionDraft } from "./drafts";
import { FLAGS_LINE, editionContext, editionEvidence, editionMetrics, editionPack } from "./inputs";
import { injectionOutputs } from "./injection";
import {
  engineCases, groundingCases, groundingNamed, groundingSoft, historyCases, historyNamed, historySoft, ladderAiCases, ladderAiNamed, ladderAiSoft,
  safetyCases, safetyNamed, safetySoft, sourcesCases, sourcesNamed, sourcesSoft, structureCases, structureNamed, structureSoft,
  wordsCases, wordsNamed, wordsSoft, zhCases, zhNamed, zhSoft, type ZhInvalidCase, type ZhNamedCase, type ZhSoftCase,
} from "./invalid";
import { siteOutputs } from "./site";
import { stateOutputs } from "./state";
import { EDITION_NAMES, REPO_ROOT, type EditionName } from "./world";
import { zhDraft, zhOutputs } from "./zh-drafts";

// ── JSON ─────────────────────────────────────────────────────────────────────────────────────────

// jsonText() lives in lib/json.ts so scripts write content files exactly as the fixtures do (§4.1).
export { jsonText };

/** Writes `jsonText(value, schema)` to `file` (absolute, or relative to the repo root), creating folders. */
export function writeJson(file: string, value: unknown, schema?: z.ZodType): void {
  const abs = path.resolve(REPO_ROOT, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, jsonText(value, schema));
}

// ── Outputs ──────────────────────────────────────────────────────────────────────────────────────

/** A generated text file: its path relative to the repo root (with "/") and its exact UTF-8 text. */
export interface TextOutput {
  path: string;
  text: string;
}

/** One generated file. Every fixture of this project is text, so an output is a `TextOutput`. */
export type Output = TextOutput;

/** The inputs a valid draft is validated against, one file of each for every edition (`fixtures/<folder>/<edition>.json`). */
export type InputFolder = "context" | "evidence" | "metrics" | "packs";

/** The path of an edition's input in `folder`. */
export const inputPath = (folder: InputFolder, name: EditionName): string => `fixtures/${folder}/${name}.json`;

/** The path of an edition's valid draft. */
export const validDraftPath = (name: EditionName): string => `fixtures/drafts/valid-${name}.json`;

/** The path of the weekday's validator flags: one line naming its four inputs (SPEC §8.6). */
export const FLAGS_PATH = "fixtures/drafts/flags.txt";

/** Each input folder's builder and schema. */
const INPUTS: Readonly<Record<InputFolder, { build: (name: EditionName) => unknown; schema: z.ZodType }>> = {
  context: { build: editionContext, schema: AgentContext },
  evidence: { build: editionEvidence, schema: Evidence },
  metrics: { build: editionMetrics, schema: MetricsFile },
  packs: { build: editionPack, schema: Pack },
};

export const INPUT_FOLDERS = Object.keys(INPUTS) as InputFolder[];

/**
 * The valid drafts, then each edition's inputs (context, evidence, metrics and pack, `inputs.ts`), then `flags.txt`: the weekday's
 * flags on one line with a closing newline.
 */
export function validOutputs(): Output[] {
  return [
    ...EDITION_NAMES.map((name) => ({ path: validDraftPath(name), text: jsonText(editionDraft(name), DraftBrief) })),
    ...EDITION_NAMES.flatMap((name) => INPUT_FOLDERS.map((folder) => ({
      path: inputPath(folder, name), text: jsonText(INPUTS[folder].build(name), INPUTS[folder].schema),
    }))),
    { path: FLAGS_PATH, text: `${FLAGS_LINE}
` },
  ];
}

// ── Invalid drafts (F) ───────────────────────────────────────────────────────────────────────────

/**
 * One F fixture (SPEC §4.12 "Fixtures and tests"): a mutation of an edition's valid draft that fails `validateDraft()` with
 * exactly `code` and no other error and no warning. Each file in fixtures/src/invalid/ exports an array of these, spread
 * into INVALID_CASES below.
 */
export interface InvalidCase {
  code: string;
  /** `invalid--<CODE>.json`, written to fixtures/drafts/. */
  file: string;
  /** The valid draft mutated, and whose inputs validate it; default "weekday". */
  edition?: EditionName;
  /** Changes the fresh draft in place, or returns a replacement (a value past the schema is written as is). */
  mutate: (draft: DraftBrief) => unknown;
}

/** Every English invalid case, one spread per file in fixtures/src/invalid/ (one file for each rule group). */
export const INVALID_CASES: readonly InvalidCase[] = [
  ...engineCases,
  ...structureCases,
  ...historyCases,
  ...ladderAiCases,
  ...sourcesCases,
  ...groundingCases,
  ...wordsCases,
  ...safetyCases,
];

/**
 * One S fixture (SPEC §4.12 "Fixtures and tests"): a mutation of an edition's valid draft that passes `validateDraft()` with
 * no error and exactly one warning, `code`. Each file in fixtures/src/invalid/ exports an array of these, spread into
 * SOFT_CASES below.
 */
export interface SoftCase {
  code: string;
  /** `soft--<CODE>.json`, written to fixtures/drafts/. */
  file: string;
  /** The valid draft mutated, and whose inputs validate it; default "weekday". */
  edition?: EditionName;
  /** Changes the fresh draft in place, or returns a replacement (a value past the schema is written as is). */
  mutate: (draft: DraftBrief) => unknown;
}

/**
 * One T fixture (SPEC §4.12 "Fixtures and tests"): a named case for a check that the weekday draft cannot reach, a mutation
 * of the Sunday, Monday or short-Monday draft (or of the weekday's) run with that edition's own inputs. Nothing is written
 * to fixtures/: the group's test file and tests/validate.test.ts run each case and compare the exact result. The cases of
 * the published-mode codes (XREF, LANG_PARITY, FILE_LAYOUT and the stored-record sides of the other rules) work on a copy of
 * the sample content and live with the sample content's tests, not here.
 */
export interface NamedCase {
  /** A short unique description, such as "Sunday deep dive on no candidate". */
  name: string;
  /** The code the case is about (it must be among `expect.errors` or `expect.warnings`). */
  code: string;
  edition: EditionName;
  /** Changes the fresh draft in place, or returns a replacement (a value past the schema is run as is). */
  mutate: (draft: DraftBrief) => unknown;
  /** The exact result of `validateDraft()`: the set of error codes and the set of warning codes, each in sorted order. */
  expect: { errors: readonly string[]; warnings: readonly string[] };
}

/** Every English soft case, one spread per file in fixtures/src/invalid/. */
export const SOFT_CASES: readonly SoftCase[] = [
  ...structureSoft,
  ...historySoft,
  ...ladderAiSoft,
  ...sourcesSoft,
  ...groundingSoft,
  ...wordsSoft,
  ...safetySoft,
];

/** Every English named case (T), one spread per file in fixtures/src/invalid/. */
export const NAMED_CASES: readonly NamedCase[] = [
  ...structureNamed,
  ...historyNamed,
  ...ladderAiNamed,
  ...sourcesNamed,
  ...groundingNamed,
  ...wordsNamed,
  ...safetyNamed,
];

/** The Chinese invalid cases (`validateZh()`, §4.6), kept apart: their drafts are `DraftZh` files in fixtures/drafts-zh/, not `DraftBrief`s. */
export const ZH_INVALID_CASES: readonly ZhInvalidCase[] = zhCases;
/** The Chinese soft cases (none today: every ZH_ code is hard) and named cases, kept apart for the same reason. */
export const ZH_SOFT_CASES: readonly ZhSoftCase[] = zhSoft;
export const ZH_NAMED_CASES: readonly ZhNamedCase[] = zhNamed;

/** The draft a case produces: a fresh copy of its edition's valid draft, mutated. */
export function invalidDraft(c: InvalidCase): unknown {
  const draft = editionDraft(c.edition ?? "weekday");
  const out = c.mutate(draft);
  return out === undefined ? draft : out;
}

export const invalidDraftPath = (file: string): string => `fixtures/drafts/${file}`;

/** The files of the invalid drafts, with each dash written as an escape (dashEscaped): `cases` is INVALID_CASES unless a test brings its own. */
export function invalidOutputs(cases: readonly InvalidCase[] = INVALID_CASES): Output[] {
  return cases.map((c) => {
    if (c.file !== `invalid--${c.code}.json`) throw new Error(`${c.code}: its file is invalid--${c.code}.json, not ${c.file}`);
    const d = invalidDraft(c);
    return { path: invalidDraftPath(c.file), text: dashEscaped(DraftBrief.safeParse(d).success ? jsonText(d, DraftBrief) : jsonText(d)) };
  });
}

/** The draft a soft case produces: a fresh copy of its edition's valid draft, mutated. */
export function softDraft(c: SoftCase): unknown {
  const draft = editionDraft(c.edition ?? "weekday");
  const out = c.mutate(draft);
  return out === undefined ? draft : out;
}

export const softDraftPath = (file: string): string => `fixtures/drafts/${file}`;

/** The files of the soft drafts, with each dash written as an escape (dashEscaped): `cases` is SOFT_CASES unless a test brings its own. */
export function softOutputs(cases: readonly SoftCase[] = SOFT_CASES): Output[] {
  return cases.map((c) => {
    if (c.file !== `soft--${c.code}.json`) throw new Error(`${c.code}: its file is soft--${c.code}.json, not ${c.file}`);
    const d = softDraft(c);
    return { path: softDraftPath(c.file), text: dashEscaped(DraftBrief.safeParse(d).success ? jsonText(d, DraftBrief) : jsonText(d)) };
  });
}

// ── Chinese invalid and soft drafts ──────────────────────────────────────────────────────────────

/** The Chinese draft a case produces: a fresh copy of its edition's valid Chinese draft, mutated. */
export function zhInvalidDraft(c: ZhInvalidCase | ZhSoftCase): unknown {
  const draft = zhDraft(c.edition ?? "weekday");
  const out = c.mutate(draft);
  return out === undefined ? draft : out;
}

export const zhInvalidDraftPath = (file: string): string => `fixtures/drafts-zh/${file}`;

/** Every dash ZH_NO_DASH refuses and a few it lets through (the Unicode dashes, the hyphen-minus apart), and the box-drawing lines U+2500 and U+2501. */
const DASH_RE = new RegExp(`[\\p{Pd}${String.fromCodePoint(0x2500)}${String.fromCodePoint(0x2501)}]`, "gu");

/**
 * The text of a JSON file with each dash written as a `\uXXXX` escape (the hyphen-minus apart): JSON reads it back as the same
 * character, and no committed file holds a dash as a character, so a scan of the repo for the dashes the writing rules forbid finds
 * only the files that say so (the ZH_NO_DASH fixtures hold theirs this way).
 */
export function dashEscaped(text: string): string {
  return text.replace(DASH_RE, (ch) => (ch === "-" ? ch : ch.split("").map((u) => `\\u${u.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")));
}

/** The file text of a Chinese draft: its schema's `jsonText()` when it parses (a draft past the schema is written as is), with the dashes escaped. */
const zhDraftText = (d: unknown): string => dashEscaped(DraftZh.safeParse(d).success ? jsonText(d, DraftZh) : jsonText(d));

/** The files of the Chinese invalid drafts, `invalid--<CODE>.zh.json`: `cases` is ZH_INVALID_CASES unless a test brings its own. */
export function zhInvalidOutputs(cases: readonly ZhInvalidCase[] = ZH_INVALID_CASES): Output[] {
  return cases.map((c) => {
    if (c.file !== `invalid--${c.code}.zh.json`) throw new Error(`${c.code}: its file is invalid--${c.code}.zh.json, not ${c.file}`);
    return { path: zhInvalidDraftPath(c.file), text: zhDraftText(zhInvalidDraft(c)) };
  });
}

/** The files of the Chinese soft drafts, `soft--<CODE>.zh.json` (none today): `cases` is ZH_SOFT_CASES unless a test brings its own. */
export function zhSoftOutputs(cases: readonly ZhSoftCase[] = ZH_SOFT_CASES): Output[] {
  return cases.map((c) => {
    if (c.file !== `soft--${c.code}.zh.json`) throw new Error(`${c.code}: its file is soft--${c.code}.zh.json, not ${c.file}`);
    return { path: zhInvalidDraftPath(c.file), text: zhDraftText(zhInvalidDraft(c)) };
  });
}

// ── The registry ─────────────────────────────────────────────────────────────────────────────────

/** Every generator, in writing order. Each later part of the fixtures adds its own here. */
export const GENERATORS: readonly (() => Output[])[] = [
  validOutputs, invalidOutputs, softOutputs, injectionOutputs, zhOutputs, zhInvalidOutputs, zhSoftOutputs, siteOutputs, stateOutputs,
];

/**
 * The folders the builder owns (SPEC §3, §8.1): every file in them is one a generator writes, so any other file there is
 * "added" (fixtures:check fails; fixtures:gen removes it). The hand-made fixtures (agent/, recheck/, openalex/, reference/
 * and feeds/) live outside them.
 */
export const FIXTURE_DIRS: readonly string[] = [
  "fixtures/drafts", "fixtures/drafts-zh", "fixtures/context", "fixtures/evidence", "fixtures/metrics", "fixtures/packs",
  "fixtures/injection", "fixtures/site-content", "fixtures/empty-content", "fixtures/state",
];

const underOwnedFolder = (p: string): boolean => FIXTURE_DIRS.some((d) => p.startsWith(`${d}/`));

/** Every output of every generator; throws when two write one path, or one writes outside FIXTURE_DIRS (where `added` could never see it). */
export function allOutputs(generators: readonly (() => Output[])[] = GENERATORS): Output[] {
  const out = generators.flatMap((g) => g());
  const seen = new Set<string>();
  for (const o of out) {
    if (seen.has(o.path)) throw new Error(`Two generators write ${o.path}`);
    if (!underOwnedFolder(o.path)) throw new Error(`${o.path} is outside the folders the builder owns (${FIXTURE_DIRS.join(", ")})`);
    seen.add(o.path);
  }
  return out;
}

/** Every file under the owned folders of `root`, as repo-relative paths with "/", sorted. */
function ownedFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  for (const d of FIXTURE_DIRS) walk(d);
  return out.sort();
}

/** The outputs whose file is missing, those whose text differs from what the builder would write, and the files in the owned folders that no generator writes (added). */
export function compareOutputs(outputs: readonly Output[], root: string = REPO_ROOT): { missing: string[]; stale: string[]; added: string[] } {
  const missing: string[] = [];
  const stale: string[] = [];
  for (const o of outputs) {
    const abs = path.join(root, o.path);
    if (!fs.existsSync(abs)) missing.push(o.path);
    else if (fs.readFileSync(abs, "utf8") !== o.text) stale.push(o.path);
  }
  const written = new Set(outputs.map((o) => o.path));
  return { missing, stale, added: ownedFiles(root).filter((p) => !written.has(p)) };
}

/** Writes every output under `root`, then removes the files in the owned folders that no generator writes; returns those. */
export function writeOutputs(outputs: readonly Output[], root: string = REPO_ROOT): string[] {
  for (const o of outputs) {
    const abs = path.join(root, o.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, o.text);
  }
  const { added } = compareOutputs(outputs, root);
  for (const p of added) fs.rmSync(path.join(root, p));
  return added;
}

// ── Validation ───────────────────────────────────────────────────────────────────────────────────

/**
 * Every issue the valid drafts and their inputs have against their schemas (`SCHEMA`, the checks that need no other file), as
 * "valid-<name>.json: ERROR CODE path: message" for a draft and "<folder>/<name>.json: ERROR CODE path: message" for an input;
 * any such issue is a problem. The rules judge each valid draft with its edition's inputs in tests/validate.test.ts, not here.
 * `inputOf` lets a test bring a broken input.
 */
export function validDraftProblems(
  draftOf: (name: EditionName) => unknown = editionDraft,
  inputOf: (folder: InputFolder, name: EditionName) => unknown = (folder, name) => INPUTS[folder].build(name),
): string[] {
  const out: string[] = [];
  const report = (label: string, issues: readonly { path: PropertyKey[]; message: string }[]) => {
    for (const i of issues) out.push(`${label}: ERROR SCHEMA ${i.path.map(String).join(".")}: ${i.message}`);
  };
  for (const name of EDITION_NAMES) {
    const r = DraftBrief.safeParse(draftOf(name));
    if (!r.success) report(path.basename(validDraftPath(name)), r.error.issues);
    for (const folder of INPUT_FOLDERS) {
      const parsed = INPUTS[folder].schema.safeParse(inputOf(folder, name));
      if (!parsed.success) report(`${folder}/${name}.json`, parsed.error.issues);
    }
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

export function main(argv: string[] = process.argv.slice(2), log: (s: string) => void = (s) => console.log(s), root: string = REPO_ROOT): number {
  const unknown = argv.filter((a) => a !== "--check");
  if (unknown.length > 0) {
    log(`Unknown argument: ${unknown.join(" ")}. Usage: tsx fixtures/src/build.ts [--check]`);
    return 2;
  }
  const outputs = allOutputs();
  let code = 0;
  if (argv.includes("--check")) {
    const { missing, stale, added } = compareOutputs(outputs, root);
    for (const p of missing) log(`missing: ${p}`);
    for (const p of stale) log(`stale: ${p}`);
    for (const p of added) log(`added: ${p} (no generator writes it)`);
    if (missing.length > 0 || stale.length > 0 || added.length > 0) {
      log(`Fixture files differ from what the builder writes: ${missing.length} missing, ${stale.length} stale, ${added.length} added. Run npm run fixtures:gen.`);
      code = 1;
    } else {
      log(`All ${outputs.length} fixture files are up to date.`);
    }
  } else {
    for (const p of writeOutputs(outputs, root)) log(`removed: ${p} (no generator writes it)`);
    log(`Wrote ${outputs.length} fixture files.`);
  }
  const problems = validDraftProblems();
  for (const p of problems) log(p);
  if (problems.length > 0) {
    log(`${problems.length} validation issues in the valid drafts.`);
    code = 1;
  }
  return code;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main();
