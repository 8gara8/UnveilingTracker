// `loadContent()` and its helpers (SPEC §6 "Content loading", §4.12 "Stored records" and "Removed text", §4.10 `filedAs()`, §8.8, §8.9): the
// content folder re-checked with `validateAll(dir, { perFile: true })`, a file that fails its schema, FILE_LAYOUT or DATE_MISMATCH left out
// whole, a brief, a finding, or one glossary term, correction or report that carries a SITE_BLOCKING_CODES code at either severity left out
// alone, any other error a build warning with the record shown, and the records that survive left exactly as stored. Each case builds a
// folder on disk from the hand-built world of tests/helpers/stored-world.ts. Most cases run the three published rules or a probe rule that
// plants one issue at a chosen path, so that another group's change cannot turn them red and the loader's reading of the issues is tested on
// its own; the cases that run the whole registry say so, and assert only what they plant. A few cases hand the loader a validator result
// made by hand, for shapes the engine never gives it: another order, a frozen answer, an issue at a file's bare path. `leavesOut()`, the
// one decision on a single issue that re-check's safety flags read, is tested on its own and against the loader. The last cases load the
// sample and the empty folder under fixtures/ as the site's builds do.
//
// Cyber's tests/content.test.ts at the fork commit 3ced1fb, adapted: its copy-and-edit cases (a clean folder loads whole, a file that fails
// its schema is skipped and the rest loads, one record of a file is skipped, any other error is a warning, the log lines never hold the
// planted text) are the pattern, with this project's layout, codes, lists and filed views.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, loadConfig } from "@/lib/config";
import { SITE_BLOCKING_CODES, contentLogLines, filedFinding, filedFindings, findingById, leavesOut, loadContent, newestDate, type Content, type FileCodes } from "@/lib/content";
import { RULES, RULE_CODE_TABLE } from "@/lib/rules";
import { publishedRules } from "@/lib/rules/published";
import { defineRule, type ValidationIssue } from "@/lib/rules/types";
import { contentDir } from "@/lib/site";
import { validateAll, type AllResult } from "@/lib/validate";
import { REMOVED_TEXT } from "@/lib/vocab";
import {
  BLOCKED_URL, CANARY, SECRET, SEQUENCE, addFindingCopy, addRefiling, addReports, addTerms, cfg, issue, load, patchJson, plant, snapshot, withIssues, type Planted,
} from "./helpers/content-folder";
import {
  BILINGUAL, DATA_ONLY, EN_ONLY, FOLDING, LIGHT, PROOF, PROTEIN, addRemoval, deepFreeze, findingOf, removeTempDirs, removedHowSure, storedWorld, tempDir, termOf, worldDir,
  writeJson, writeRaw,
} from "./helpers/stored-world";

// `validateAll` and `loadConfig` are wrapped, so that a case can count the calls, change what the validator answers or make the config fail.
vi.mock("@/lib/validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/validate")>();
  return { ...actual, validateAll: vi.fn(actual.validateAll) };
});
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { ...actual, loadConfig: vi.fn(actual.loadConfig) };
});

// Each case builds a folder on disk and some run the whole registry, which takes seconds on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const validateSpy = vi.mocked(validateAll);
const REAL_VALIDATE = validateSpy.getMockImplementation()!;
const loadConfigSpy = vi.mocked(loadConfig);
const REAL_LOAD_CONFIG = loadConfigSpy.getMockImplementation()!;
const CONFIG = cfg();

/** A byte order mark, which no stored file may start with. */
const BOM = String.fromCharCode(0xfeff);

const VARIABLE = "UT_CONTENT_DIR";
const savedVariable = process.env[VARIABLE];

afterEach(() => {
  validateSpy.mockReset();
  validateSpy.mockImplementation(REAL_VALIDATE);
  loadConfigSpy.mockReset();
  loadConfigSpy.mockImplementation(REAL_LOAD_CONFIG);
  vi.restoreAllMocks();
  if (savedVariable === undefined) delete process.env[VARIABLE];
  else process.env[VARIABLE] = savedVariable;
});
afterAll(() => {
  removeTempDirs();
});

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

const BRIEF = `briefs/${BILINGUAL}.json`;
const FINDING = `findings/${PROOF}.json`;
const REGISTRY = { rules: RULES };

/** The base world on disk. */
const folder = (label = "content"): string => worldDir(storedWorld(), label);

/** The lists of a `Content` that hold records (everything but `dir`, `skipped` and `warnings`). */
const LISTS = ["briefs", "findings", "metrics", "pace", "status", "terms", "hiddenTerms", "corrections", "reports", "archive"] as const;
type ListName = (typeof LISTS)[number];

/** `damaged` holds exactly what `clean` holds in every list but the ones named: a record left out leaves the others as they were. */
function expectSameExcept(damaged: Content, clean: Content, ...except: ListName[]): void {
  for (const name of LISTS) if (!except.includes(name)) expect(damaged[name], name).toEqual(clean[name]);
}

const dates = (c: Content): string[] => c.briefs.map((b) => b.date);
const ids = (c: Content): string[] => c.findings.map((f) => f.id);

/** The next `validateAll()` call answers with the real result changed by `over`. */
function nextResult(over: (real: AllResult) => AllResult): void {
  validateSpy.mockImplementationOnce((dir, opts) => over(REAL_VALIDATE(dir, opts)));
}

/** The next `validateAll()` call runs for real, and then `after` changes the folder, as a write between the validator and the loader would. */
function changeAfterValidator(after: () => void): void {
  validateSpy.mockImplementationOnce((dir, opts) => {
    const result = REAL_VALIDATE(dir, opts);
    after();
    return result;
  });
}

/** Every call of `fs.readFileSync` for a path under `dir`, as paths relative to it. */
function trackReads(dir: string): () => string[] {
  const real = fs.readFileSync;
  const seen: string[] = [];
  vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (typeof file === "string" && file.startsWith(`${dir}${path.sep}`)) seen.push(path.relative(dir, file).split(path.sep).join("/"));
    return (real as (...args: unknown[]) => unknown)(file, ...rest);
  }) as typeof fs.readFileSync);
  return () => seen;
}

/** The validator's answer with its files and its combined issues listed in another order, and each file's own issues as they were. */
function reordered(real: AllResult): AllResult {
  return {
    ...real,
    files: [...real.files].reverse(),
    issues: [...real.issues].sort((a, b) => (a.path < b.path ? 1 : a.path > b.path ? -1 : 0)),
  };
}

/**
 * Issues of every kind, to lay over the answer for the base world: a brief and a finding left out whole, three records of two list
 * files left out, three files warned about, and three entries of what no file holds (one of them a skip).
 */
const MESS: readonly (readonly [file: string | null, issue: ValidationIssue])[] = [
  [BRIEF, issue("XREF", "story.finding_id")],
  [`briefs/${EN_ONLY}.json`, issue("CANARY", "lead[0].text.en")],
  [FINDING, issue("WORDS", "explainer.found.en")],
  [`findings/${LIGHT}.json`, issue("SECRET_LIKE", "title.en")],
  ["glossary.json", issue("DUAL_USE", "terms[2].en.term", "warning")],
  ["glossary.json", issue("CANARY", "terms[0].en.definition")],
  ["reports.json", issue("BLOCKED_HOST", "reports[1].reason.en", "warning")],
  ["corrections.json", issue("XREF", "corrections[0].finding_id")],
  [null, issue("SCHEMA", "(root)")],
  [null, issue("RULE_ERROR", "(engine)")],
  [null, issue("RULE_ERROR", "(rule WORDS)")],
];

const clean = load(folder("clean"));

// ── The codes ────────────────────────────────────────────────────────────────────────────────────

describe("SITE_BLOCKING_CODES", () => {
  it("is the seven codes of SPEC 4.12, in its order", () => {
    expect([...SITE_BLOCKING_CODES]).toEqual(["SCHEMA", "FILE_LAYOUT", "DATE_MISMATCH", "CANARY", "SECRET_LIKE", "DUAL_USE", "BLOCKED_HOST"]);
  });

  it("names only codes the validator reports", () => {
    const table = new Set(RULE_CODE_TABLE.map((row) => row.code));
    for (const code of SITE_BLOCKING_CODES) expect(table.has(code), code).toBe(true);
  });

  it("holds none of the codes that a stored record may carry and still be shown (XREF, LANG_PARITY, SOURCE_URL)", () => {
    for (const code of ["XREF", "LANG_PARITY", "SOURCE_URL", "WORDS", "RULE_ERROR"]) expect(SITE_BLOCKING_CODES as readonly string[], code).not.toContain(code);
  });
});

// ── A folder that passes ─────────────────────────────────────────────────────────────────────────

describe("loadContent(): a folder that passes", () => {
  it("loads every kind of file, each list in its order", () => {
    expect(dates(clean)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
    expect(ids(clean)).toEqual([PROTEIN, PROOF, LIGHT]);
    expect(clean.metrics.map((m) => m.date)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
    expect(clean.status.map((s) => s.date)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
    expect(clean.pace).not.toBeNull();
    expect(clean.terms.map((t) => t.id)).toEqual(["lattice", "proof-assistant", "protein-folding"]);
    expect(clean.corrections.map((c) => c.id)).toEqual(["C-0001"]);
    expect(clean.reports.map((r) => r.id)).toEqual(["R-0001", "R-0002"]);
    expect(clean.archive?.editions.map((e) => e.date)).toEqual([DATA_ONLY, BILINGUAL, EN_ONLY]);
  });

  it("returns each record as the schemas read its file, and nothing is skipped or warned about", () => {
    const world = storedWorld();
    expect(clean.briefs).toEqual(world.briefs);
    expect(clean.findings).toEqual(world.findings);
    expect(clean.metrics).toEqual(world.metrics);
    expect(clean.status).toEqual(world.status);
    expect(clean.pace).toEqual(world.pace);
    expect(clean.terms).toEqual(world.terms);
    expect(clean.corrections).toEqual(world.corrections);
    expect(clean.reports).toEqual(world.reports);
    expect(clean.archive).toEqual(world.archive);
    expect(clean.hiddenTerms).toEqual([]);
    expect(clean.skipped).toEqual([]);
    expect(clean.warnings).toEqual([]);
  });

  it("does not load the inputs manifests, which the validator checks and no page reads", () => {
    expect(fs.existsSync(path.join(folder(), "metrics", "inputs", `${DATA_ONLY}.json`))).toBe(true);
    expect(clean.metrics).toHaveLength(3);
    expect(Object.keys(clean).sort()).toEqual(["archive", "briefs", "corrections", "dir", "findings", "hiddenTerms", "metrics", "pace", "reports", "skipped", "status", "terms", "warnings"]);
  });

  it("keeps the folder as given, not resolved", () => {
    const dir = folder();
    const relative = path.relative(process.cwd(), dir);
    expect(relative).not.toBe(dir);
    expect(load(relative).dir).toBe(relative);
    expect(load(dir).dir).toBe(dir);
  });

  it("orders findings by the counter in their ids, not by file name, as compareFindingIds() does", () => {
    const world = storedWorld();
    addFindingCopy(world, PROTEIN, "bio-2026-0004");
    const dir = worldDir(world);
    expect(fs.readdirSync(path.join(dir, "findings")).map((f) => f.replace(".json", ""))).toEqual(["bio-2026-0001", "bio-2026-0004", "math-2026-0002", "phys-2026-0003"]);
    expect(ids(load(dir))).toEqual(["bio-2026-0001", "math-2026-0002", "phys-2026-0003", "bio-2026-0004"]);
  });

  it("does not depend on the order the files were written", () => {
    const world = storedWorld();
    const forward = worldDir(world, "forward");
    const backward = tempDir("backward");
    const files = [...fs.readdirSync(forward, { recursive: true, withFileTypes: true })].filter((e) => e.isFile()).map((e) => path.relative(forward, path.join(e.parentPath, e.name)));
    for (const rel of files.reverse()) writeRaw(backward, rel, fs.readFileSync(path.join(forward, rel)));
    const a = load(forward);
    const b = load(backward);
    expect({ ...b, dir: "" }).toEqual({ ...a, dir: "" });
  });

  it("does not depend on the order the validator lists its files and issues: what no file holds, then the files by path in code-unit order", () => {
    const dir = folder();
    // The two strays sort the other way round by locale: a capital letter comes before a lower-case one only by code unit.
    for (const stray of ["notes.txt", "Zebra.txt", "apple.txt"]) writeRaw(dir, stray, "x");
    nextResult((real) => withIssues(real, MESS));
    const natural = load(dir);
    expect(natural.skipped).toEqual([
      { file: "(root)", codes: ["SCHEMA"] },
      { file: "Zebra.txt", codes: ["FILE_LAYOUT"] },
      { file: "apple.txt", codes: ["FILE_LAYOUT"] },
      { file: `briefs/${EN_ONLY}.json`, codes: ["CANARY"] },
      { file: `findings/${LIGHT}.json`, codes: ["SECRET_LIKE"] },
      { file: "glossary.json terms[0]", codes: ["CANARY"] },
      { file: "glossary.json terms[2]", codes: ["DUAL_USE"] },
      { file: "notes.txt", codes: ["FILE_LAYOUT"] },
      { file: "reports.json reports[1]", codes: ["BLOCKED_HOST"] },
    ]);
    expect(natural.warnings).toEqual([
      { file: "(engine)", codes: ["RULE_ERROR"] },
      { file: "(rule WORDS)", codes: ["RULE_ERROR"] },
      { file: BRIEF, codes: ["XREF"] },
      { file: "corrections.json", codes: ["XREF"] },
      { file: FINDING, codes: ["WORDS"] },
    ]);
    expect(natural.hiddenTerms).toEqual([{ first_finding: PROTEIN, codes: ["DUAL_USE"] }]);
    nextResult((real) => reordered(withIssues(real, MESS)));
    expect(load(dir)).toEqual(natural);
  });

  it("changes nothing in the validator's answer, which it is given and may not edit", () => {
    const dir = folder();
    writeRaw(dir, "notes.txt", "x");
    nextResult((real) => withIssues(real, MESS));
    const natural = load(dir);
    let given: AllResult | undefined;
    nextResult((real) => (given = deepFreeze(withIssues(real, MESS))));
    // A frozen answer throws at the first write to it, so a loader that sorted or edited it in place would fail here.
    expect(load(dir)).toEqual(natural);
    expect(Object.isFrozen(given!.files) && Object.isFrozen(given!.issues) && given!.files.every((f) => Object.isFrozen(f.issues))).toBe(true);
  });

  it("is the same on every call", () => {
    const dir = folder();
    expect(load(dir)).toEqual(load(dir));
  });
});

// ── A file that fails its schema, FILE_LAYOUT or DATE_MISMATCH ───────────────────────────────────

describe("loadContent(): a file that fails its schema, FILE_LAYOUT or DATE_MISMATCH is left out whole", () => {
  /** Each file of the world, the list it feeds and what that list holds without it; a list file is broken in one record only. */
  const FILES: readonly (readonly [file: string, list: ListName | null, left: (c: Content) => unknown, expected: unknown])[] = [
    [BRIEF, "briefs", dates, [EN_ONLY, DATA_ONLY]],
    [FINDING, "findings", ids, [PROTEIN, LIGHT]],
    [`metrics/${BILINGUAL}.json`, "metrics", (c) => c.metrics.map((m) => m.date), [EN_ONLY, DATA_ONLY]],
    [`metrics/inputs/${DATA_ONLY}.json`, null, () => null, null],
    [`status/${BILINGUAL}.json`, "status", (c) => c.status.map((s) => s.date), [EN_ONLY, DATA_ONLY]],
    ["state/pace-weekly.json", "pace", (c) => c.pace, null],
    ["glossary.json", "terms", (c) => c.terms, []],
    ["corrections.json", "corrections", (c) => c.corrections, []],
    ["reports.json", "reports", (c) => c.reports, []],
    ["archive-index.json", "archive", (c) => c.archive, null],
  ];

  /** The record of a list file that a case breaks, so that the file fails as a whole although only one record is wrong. */
  const breakOne = (rel: string, record: Record<string, any>): void => {
    if (rel === "glossary.json") record.terms[1].made_up_key = 1;
    else if (rel === "corrections.json") record.corrections[0].made_up_key = 1;
    else if (rel === "reports.json") record.reports[1].made_up_key = 1;
    else record.made_up_key = 1;
  };

  it.each(FILES)("%s: a key the schema does not know leaves the file out with SCHEMA, and every other record loads", (file, list, left, expected) => {
    const dir = folder();
    patchJson(dir, file, (record) => breakOne(file, record));
    const content = load(dir);
    expect(content.skipped).toEqual([{ file, codes: ["SCHEMA"] }]);
    expect(left(content)).toEqual(expected);
    expectSameExcept(content, clean, ...(list === null ? [] : [list]));
  });

  it.each(FILES)("%s: the same file, damaged in any one way a file can be, is one skipped file with SCHEMA", (file) => {
    for (const bytes of ["", BOM + "{}", "{ not json", "[]", "null", "42", new Uint8Array([0xff, 0xfe, 0x7b, 0x7d])]) {
      const dir = folder();
      writeRaw(dir, file, bytes);
      const content = load(dir);
      expect(content.skipped, String(bytes)).toEqual([{ file, codes: ["SCHEMA"] }]);
    }
  });

  it("leaves a stray file out with FILE_LAYOUT wherever it lies, and never reads it", () => {
    const dir = folder();
    writeRaw(dir, "notes.txt", "not content");
    writeRaw(dir, "briefs/notes.json", "{}");
    writeRaw(dir, "findings/Bad_Name.json", "{}");
    writeRaw(dir, "metrics/inputs/extra/deeper.json", "{}");
    writeRaw(dir, "a: b.txt", "a name with a colon and a space");
    const reads = trackReads(dir);
    const content = load(dir);
    expect(content.skipped).toEqual([
      { file: "a: b.txt", codes: ["FILE_LAYOUT"] },
      { file: "briefs/notes.json", codes: ["FILE_LAYOUT"] },
      { file: "findings/Bad_Name.json", codes: ["FILE_LAYOUT"] },
      { file: "metrics/inputs/extra/deeper.json", codes: ["FILE_LAYOUT"] },
      { file: "notes.txt", codes: ["FILE_LAYOUT"] },
    ]);
    expectSameExcept(content, clean);
    expect(reads().filter((r) => ["notes.txt", "briefs/notes.json", "findings/Bad_Name.json", "a: b.txt"].includes(r))).toEqual([]);
  });

  it("leaves a finding file that is not named by its id out with FILE_LAYOUT, and the finding is on no page", () => {
    const dir = folder();
    fs.renameSync(path.join(dir, `findings/${PROTEIN}.json`), path.join(dir, "findings/bio-2026-0009.json"));
    const content = load(dir);
    expect(content.skipped).toEqual([{ file: "findings/bio-2026-0009.json", codes: ["FILE_LAYOUT"] }]);
    expect(ids(content)).toEqual([PROOF, LIGHT]);
    expect(findingById(content, PROTEIN)).toBeUndefined();
    expect(findingById(content, "bio-2026-0009")).toBeUndefined();
    expect(dates(content)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
    expect(content.warnings.map((w) => w.file)).toContain(BRIEF);
    expect(content.warnings.every((w) => w.codes.includes("XREF"))).toBe(true);
  });

  it("leaves a link out with FILE_LAYOUT, a folder where a file should be too, and follows no link", () => {
    const dir = folder();
    fs.symlinkSync(path.join(dir, "glossary.json"), path.join(dir, "glossary-link.json"));
    fs.symlinkSync(path.join(dir, BRIEF), path.join(dir, `briefs/2026-11-25.json`));
    fs.rmSync(path.join(dir, `status/${DATA_ONLY}.json`));
    writeRaw(dir, `status/${DATA_ONLY}.json/inside.json`, "{}");
    const content = load(dir);
    expect(content.skipped).toEqual([
      { file: "briefs/2026-11-25.json", codes: ["FILE_LAYOUT"] },
      { file: "glossary-link.json", codes: ["FILE_LAYOUT"] },
      { file: `status/${DATA_ONLY}.json/inside.json`, codes: ["FILE_LAYOUT"] },
    ]);
    expect(dates(content)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
    expect(content.status.map((s) => s.date)).toEqual([EN_ONLY, BILINGUAL]);
    expect(content.terms).toHaveLength(3);
  });

  it("never reads a link or special file, even when no rule names it", () => {
    const dir = folder();
    fs.symlinkSync(path.join(dir, BRIEF), path.join(dir, "briefs/2026-11-25.json"));
    fs.symlinkSync(path.join(dir, "glossary.json"), path.join(dir, "state/pace-weekly.json.bak"));
    fs.rmSync(path.join(dir, "reports.json"));
    fs.symlinkSync(path.join(dir, "corrections.json"), path.join(dir, "reports.json"));
    const reads = trackReads(dir);
    const content = load(dir, { rules: [] });
    expect(content.skipped).toEqual([
      { file: "briefs/2026-11-25.json", codes: ["FILE_LAYOUT"] },
      { file: "reports.json", codes: ["FILE_LAYOUT"] },
    ]);
    expect(dates(content)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
    expect(content.reports).toEqual([]);
    expect(reads().filter((r) => ["briefs/2026-11-25.json", "reports.json", "state/pace-weekly.json.bak"].includes(r))).toEqual([]);
  });

  it("never opens a named pipe, which would wait for ever for a writer", () => {
    const dir = folder();
    execFileSync("mkfifo", [path.join(dir, "briefs", "2026-11-25.json")]);
    execFileSync("mkfifo", [path.join(dir, "notes.fifo")]);
    const content = load(dir);
    expect(content.skipped).toEqual([{ file: "briefs/2026-11-25.json", codes: ["FILE_LAYOUT"] }, { file: "notes.fifo", codes: ["FILE_LAYOUT"] }]);
    expect(dates(content)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
    expectSameExcept(content, clean);
  });

  it("leaves a metrics, status or inputs file whose date is not its name out with DATE_MISMATCH", () => {
    // A metrics file whose date moves a week on fails its schema at `data_cutoff` instead, so the next edition's date is used for it.
    for (const [file, list, date] of [
      [`metrics/${BILINGUAL}.json`, "metrics", DATA_ONLY], [`status/${BILINGUAL}.json`, "status", "2026-11-26"], [`metrics/inputs/${DATA_ONLY}.json`, null, BILINGUAL],
    ] as const) {
      const dir = folder();
      patchJson(dir, file, (record) => { record.date = date; });
      const content = load(dir);
      expect(content.skipped, file).toEqual([{ file, codes: ["DATE_MISMATCH"] }]);
      expectSameExcept(content, clean, ...(list === null ? [] : [list]));
    }
  });

  it("is the same for each of the three codes, at either severity, on every file of the layout", () => {
    for (const code of ["SCHEMA", "FILE_LAYOUT", "DATE_MISMATCH"]) {
      for (const severity of ["error", "warning"] as const) {
        for (const [file, list] of FILES) {
          const content = load(folder(), { rules: [plant([code, `${file}: (file)`, severity])] });
          expect(content.skipped, `${code} ${severity} ${file}`).toEqual([{ file, codes: [code] }]);
          expectSameExcept(content, clean, ...(list === null ? [] : [list]));
          expect(content.warnings).toEqual([]);
        }
      }
    }
  });

  it("is left out whole even when the code is at a record: SCHEMA in one term leaves the glossary out, though other records are fine", () => {
    const dir = folder();
    const content = load(dir, { rules: [plant(["SCHEMA", "glossary.json: terms[1].fields"], ["DUAL_USE", "glossary.json: terms[0].en.definition"])] });
    expect(content.skipped).toEqual([{ file: "glossary.json", codes: ["SCHEMA"] }]);
    expect(content.terms).toEqual([]);
    expectSameExcept(content, clean, "terms");
  });

  it("lists every code of a file once, in the validator's order", () => {
    nextResult((real) => withIssues(real, [
      [BRIEF, issue("SCHEMA", "lead[0].text")],
      [BRIEF, issue("FILE_LAYOUT", "(file)", "warning")],
      [BRIEF, issue("SCHEMA", "story")],
      [BRIEF, issue("CANARY", "lead[1].text.en")],
      [BRIEF, issue("DATE_MISMATCH", "date")],
    ]));
    const content = load(folder(), { rules: [] });
    expect(content.skipped).toEqual([{ file: BRIEF, codes: ["SCHEMA", "FILE_LAYOUT", "CANARY", "DATE_MISMATCH"] }]);
  });
});

// ── A brief or a finding that carries a safety code ──────────────────────────────────────────────

describe("loadContent(): a brief or a finding that carries a safety code is left out, at either severity", () => {
  const CODES = ["CANARY", "SECRET_LIKE", "DUAL_USE", "BLOCKED_HOST"] as const;
  const CASES = [
    { name: "brief", file: BRIEF, at: "lead[0].text.en", list: "briefs", left: dates, expected: [EN_ONLY, DATA_ONLY] },
    { name: "finding", file: FINDING, at: "title.en", list: "findings", left: ids, expected: [PROTEIN, LIGHT] },
  ] as const;

  it.each(CASES.flatMap((c) => CODES.flatMap((code) => (["error", "warning"] as const).map((severity) => [c, code, severity] as const))))(
    "a %j carrying %s as %s",
    (c, code, severity) => {
      const content = load(folder(), { rules: [plant([code, `${c.file}: ${c.at}`, severity])] });
      expect(content.skipped).toEqual([{ file: c.file, codes: [code] }]);
      expect(c.left(content)).toEqual(c.expected);
      expectSameExcept(content, clean, c.list);
      expect(content.warnings).toEqual([]);
    },
  );

  it("is judged by the code, not by where it is: any path inside the record leaves it out", () => {
    for (const at of ["title.en", "explainer.found.en", "sources[3].title", "who[0].name", "(file)", "depth", "history", "rung_history[1].note.zh"]) {
      const content = load(folder(), { rules: [plant(["DUAL_USE", `${FINDING}: ${at}`])] });
      expect(content.skipped, at).toEqual([{ file: FINDING, codes: ["DUAL_USE"] }]);
    }
  });

  it("lists a record's codes once each, in the validator's order", () => {
    const content = load(folder(), {
      rules: [plant(["CANARY", `${FINDING}: title.en`], ["DUAL_USE", `${FINDING}: explainer.found.en`], ["DUAL_USE", `${FINDING}: explainer.matters.en`], ["SECRET_LIKE", `${FINDING}: sources[0].title`])],
    });
    expect(content.skipped).toEqual([{ file: FINDING, codes: ["DUAL_USE", "SECRET_LIKE", "CANARY"] }]);
  });

  it("leaves several out, each with its own codes, in path order", () => {
    const content = load(folder(), {
      rules: [plant(["CANARY", `${BRIEF}: lead[0].text.en`], ["SECRET_LIKE", `findings/${LIGHT}.json: title.en`], ["DUAL_USE", `findings/${PROTEIN}.json: title.en`], ["BLOCKED_HOST", `briefs/${EN_ONLY}.json: also[0].title`])],
    });
    expect(content.skipped).toEqual([
      { file: `briefs/${EN_ONLY}.json`, codes: ["BLOCKED_HOST"] },
      { file: BRIEF, codes: ["CANARY"] },
      { file: `findings/${PROTEIN}.json`, codes: ["DUAL_USE"] },
      { file: `findings/${LIGHT}.json`, codes: ["SECRET_LIKE"] },
    ]);
    expect(dates(content)).toEqual([DATA_ONLY]);
    expect(ids(content)).toEqual([PROOF]);
    expectSameExcept(content, clean, "briefs", "findings");
  });

  describe("with the whole registry, for what each rule really finds", () => {
    const FIELD = (c: (typeof CASES)[number]): string => (c.name === "brief" ? "lead[0].text.en" : "title.en");
    const PLANTED: readonly (readonly [code: string, text: (before: string) => string])[] = [
      ["DUAL_USE", (before) => `${before} ${SEQUENCE}`],
      ["CANARY", (before) => `${before} ${CANARY}`],
      ["SECRET_LIKE", (before) => `${before} ${SECRET}`],
      ["BLOCKED_HOST", (before) => `${before} see ${BLOCKED_URL} for more`],
    ];

    it.each(CASES.flatMap((c) => PLANTED.map(([code, text]) => [c, code, text] as const)))("a %j with %s planted in its text", (c, code, text) => {
      const dir = folder();
      patchJson(dir, c.file, (record) => {
        const segments = FIELD(c).split(/\.|\[|\]/).filter((s) => s !== "");
        let at = record;
        for (const s of segments.slice(0, -1)) at = at[s];
        const last = segments[segments.length - 1]!;
        at[last] = text(at[last]);
      });
      const content = load(dir, REGISTRY);
      // The rule says which codes it gives; the loader's part is to leave the record out for the planted one.
      expect(content.skipped.find((s) => s.file === c.file)?.codes, `${c.name} ${code}`).toContain(code);
      expect(c.left(content)).toEqual(c.expected);
      expect(JSON.stringify([content.skipped, content.warnings, contentLogLines(content)])).not.toMatch(new RegExp(`${SEQUENCE}|${CANARY}|${SECRET}|pastebin`));
    });
  });
});

// ── The severities the engine itself never gives a stored record ─────────────────────────────────

/**
 * The base world loaded with issues laid over the validator's own answer, severity as given and no rule run: the engine turns an
 * error of DUAL_USE or BLOCKED_HOST into a warning on a stored record, so a case that needs the error builds the result by hand.
 */
function loadWith(...added: readonly (readonly [file: string | null, code: string, at: string, severity?: "error" | "warning"])[]): Content {
  nextResult((real) => withIssues(real, added.map(([file, code, at, severity]) => [file, issue(code, at, severity)] as const)));
  return load(folder(), { rules: [] });
}

describe("loadContent(): the safety codes as errors, which only a record being published carries", () => {
  const TARGETS = [
    { name: "a brief", file: BRIEF, at: "lead[0].text.en", skip: BRIEF },
    { name: "a finding", file: FINDING, at: "title.en", skip: FINDING },
    { name: "a term", file: "glossary.json", at: "terms[1].en.definition", skip: "glossary.json terms[1]" },
    { name: "a correction", file: "corrections.json", at: "corrections[0].reason.en", skip: "corrections.json corrections[0]" },
    { name: "a report", file: "reports.json", at: "reports[1].reason.en", skip: "reports.json reports[1]" },
  ] as const;

  it.each(TARGETS.flatMap((t) => (["DUAL_USE", "BLOCKED_HOST"] as const).flatMap((code) => (["error", "warning"] as const).map((severity) => [t, code, severity] as const))))(
    "%j: %s as %s leaves it out",
    (t, code, severity) => {
      const content = loadWith([t.file, code, t.at, severity]);
      expect(content.skipped).toEqual([{ file: t.skip, codes: [code] }]);
      expect(content.warnings).toEqual([]);
    },
  );

  it("is the same for CANARY and SECRET_LIKE, which the engine leaves as errors", () => {
    for (const t of TARGETS) {
      for (const code of ["CANARY", "SECRET_LIKE"]) {
        for (const severity of ["error", "warning"] as const) {
          expect(loadWith([t.file, code, t.at, severity]).skipped, `${t.name} ${code} ${severity}`).toEqual([{ file: t.skip, codes: [code] }]);
        }
      }
    }
  });

  it("shows a record that fails a blocking code only at an address field, an error or not: it is a warning, never a skip", () => {
    const content = loadWith([FINDING, "BLOCKED_HOST", "sources[0].url"], [FINDING, "BLOCKED_HOST", "figure.image_url", "warning"], ["corrections.json", "BLOCKED_HOST", "corrections[0].source_url"]);
    expect(content.skipped).toEqual([]);
    expect(content.warnings).toEqual([{ file: "corrections.json", codes: ["BLOCKED_HOST"] }, { file: FINDING, codes: ["BLOCKED_HOST"] }]);
    expectSameExcept(content, clean);
  });

  it("still skips the record when the same error is at an address field and at text", () => {
    const content = loadWith([FINDING, "BLOCKED_HOST", "sources[0].url"], [FINDING, "BLOCKED_HOST", "explainer.found.en"]);
    expect(content.skipped).toEqual([{ file: FINDING, codes: ["BLOCKED_HOST"] }]);
    expect(content.warnings).toEqual([]);
  });

  it("hides a term for an error in its name just as for a warning", () => {
    const content = loadWith(["glossary.json", "DUAL_USE", "terms[0].en.term"], ["glossary.json", "BLOCKED_HOST", "terms[1].zh.official_url", "warning"]);
    expect(content.skipped).toEqual([{ file: "glossary.json terms[0]", codes: ["DUAL_USE"] }, { file: "glossary.json terms[1]", codes: ["BLOCKED_HOST"] }]);
    expect(content.hiddenTerms).toEqual([{ first_finding: PROOF, codes: ["BLOCKED_HOST"] }, { first_finding: LIGHT, codes: ["DUAL_USE"] }]);
  });
});

// ── BLOCKED_HOST on a field that is itself an address ────────────────────────────────────────────

describe("loadContent(): BLOCKED_HOST on an address field skips nothing", () => {
  const KEPT = [
    ["a finding's source url", FINDING, "sources[0].url"],
    ["a finding's tenth source url", FINDING, "sources[10].url"],
    ["a finding's figure image_url", `findings/${LIGHT}.json`, "figure.image_url"],
    ["a finding's Lean artefact", FINDING, "artefacts.lean[0]"],
    ["a brief's source url", BRIEF, "sources[0].url"],
    ["a correction's source_url", "corrections.json", "corrections[0].source_url"],
  ] as const;

  it.each(KEPT)("%s: kept, at either severity", (_name, file, at) => {
    for (const severity of ["error", "warning"] as const) {
      const content = load(folder(), { rules: [plant(["BLOCKED_HOST", `${file}: ${at}`, severity])] });
      expect(content.skipped).toEqual([]);
      expectSameExcept(content, clean);
      expect(content.warnings).toEqual([]);
    }
  });

  it("keeps a correction at a two-digit index for its source_url too", () => {
    const world = storedWorld();
    for (let i = 0; i < 11; i++) addRefiling(world, LIGHT, "significance", "watch", DATA_ONLY);
    const dir = worldDir(world);
    const base = load(dir);
    expect(base.corrections).toHaveLength(12);
    for (const severity of ["error", "warning"] as const) {
      const content = load(dir, { rules: [plant(["BLOCKED_HOST", "corrections.json: corrections[11].source_url", severity])] });
      expect(content.skipped, severity).toEqual([]);
      expect(content.corrections, severity).toEqual(base.corrections);
      expect(content.warnings, severity).toEqual([]);
    }
  });

  const SKIPPED = [
    ["a finding's source title", FINDING, "sources[0].title", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's source url, one level too deep", FINDING, "sources[0].url.en", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's whole sources list", FINDING, "sources.url", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's source key that only begins like url", FINDING, "sources[0].urls", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's figure credit", `findings/${LIGHT}.json`, "figure.credit", { file: `findings/${LIGHT}.json`, codes: ["BLOCKED_HOST"] }],
    ["a finding's DOI", FINDING, "artefacts.doi[0]", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's Lean list as a whole", FINDING, "artefacts.lean", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's explainer", FINDING, "explainer.found.en", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's text that follows a figure path", `findings/${LIGHT}.json`, "figure.image_url.en", { file: `findings/${LIGHT}.json`, codes: ["BLOCKED_HOST"] }],
    ["a finding's source url nested in another field", FINDING, "history.sources[0].url", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's source url with no index", FINDING, "sources[].url", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's source url with another character for the dot", FINDING, "sources[0]_url", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's figure image_url nested in another field", `findings/${LIGHT}.json`, "extra.figure.image_url", { file: `findings/${LIGHT}.json`, codes: ["BLOCKED_HOST"] }],
    ["a finding's figure image_url with another character for the dot", `findings/${LIGHT}.json`, "figure_image_url", { file: `findings/${LIGHT}.json`, codes: ["BLOCKED_HOST"] }],
    ["a finding's Lean artefact nested in another field", FINDING, "extra.artefacts.lean[0]", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's Lean artefact with another character for the dot", FINDING, "artefacts_lean[0]", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's Lean artefact with no index", FINDING, "artefacts.lean[]", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a finding's Lean artefact with text after the index", FINDING, "artefacts.lean[0].name", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a brief's source url nested in another field", BRIEF, "history.sources[0].url", { file: BRIEF, codes: ["BLOCKED_HOST"] }],
    ["a brief's source url with no index", BRIEF, "sources[].url", { file: BRIEF, codes: ["BLOCKED_HOST"] }],
    ["a brief's source url with another character for the dot", BRIEF, "sources[0]_url", { file: BRIEF, codes: ["BLOCKED_HOST"] }],
    ["a brief's source url with text after it", BRIEF, "sources[0].url.en", { file: BRIEF, codes: ["BLOCKED_HOST"] }],
    ["a brief's lead", BRIEF, "lead[0].text.en", { file: BRIEF, codes: ["BLOCKED_HOST"] }],
    ["a brief's figure.image_url, which a brief has not", BRIEF, "figure.image_url", { file: BRIEF, codes: ["BLOCKED_HOST"] }],
    ["a brief's Lean artefact, which a brief has not", BRIEF, "artefacts.lean[0]", { file: BRIEF, codes: ["BLOCKED_HOST"] }],
    ["a finding's correction source_url, which a finding has not", FINDING, "corrections[0].source_url", { file: FINDING, codes: ["BLOCKED_HOST"] }],
    ["a correction's after", "corrections.json", "corrections[0].after.en", { file: "corrections.json corrections[0]", codes: ["BLOCKED_HOST"] }],
    ["a correction's source_url that begins like one", "corrections.json", "corrections[0].source_urls", { file: "corrections.json corrections[0]", codes: ["BLOCKED_HOST"] }],
    ["a correction's source_url with text after it", "corrections.json", "corrections[0].source_url.en", { file: "corrections.json corrections[0]", codes: ["BLOCKED_HOST"] }],
    ["a correction's source_url with another character for the dot", "corrections.json", "corrections[0]_source_url", { file: "corrections.json corrections[0]", codes: ["BLOCKED_HOST"] }],
    ["a correction's source_url with no index, which names no record", "corrections.json", "corrections[].source_url", { file: "corrections.json", codes: ["BLOCKED_HOST"] }],
    ["a correction's source_url nested in another field, which names no record", "corrections.json", "extra.corrections[0].source_url", { file: "corrections.json", codes: ["BLOCKED_HOST"] }],
    ["a source_url in a report, which is not a correction", "reports.json", "reports[0].source_url", { file: "reports.json reports[0]", codes: ["BLOCKED_HOST"] }],
    ["a report's evidence_url", "reports.json", "reports[1].evidence_url", { file: "reports.json reports[1]", codes: ["BLOCKED_HOST"] }],
    ["a term's definition", "glossary.json", "terms[1].en.definition", { file: "glossary.json terms[1]", codes: ["BLOCKED_HOST"] }],
    ["a term's official_url", "glossary.json", "terms[0].zh.official_url", { file: "glossary.json terms[0]", codes: ["BLOCKED_HOST"] }],
  ] as const;

  it.each(SKIPPED)("%s: skipped", (_name, file, at, entry) => {
    const content = load(folder(), { rules: [plant(["BLOCKED_HOST", `${file}: ${at}`, "warning"])] });
    expect(content.skipped).toEqual([entry]);
  });

  it("still skips on any other code at an address field", () => {
    for (const [, file, at] of KEPT) {
      for (const code of ["DUAL_USE", "CANARY", "SECRET_LIKE"]) {
        const content = load(folder(), { rules: [plant([code, `${file}: ${at}`])] });
        expect(content.skipped, `${code} ${file} ${at}`).toHaveLength(1);
        expect(content.skipped[0]!.codes).toEqual([code]);
      }
    }
  });

  it("skips a record that holds the address in an address field and in its text", () => {
    const content = load(folder(), { rules: [plant(["BLOCKED_HOST", `${FINDING}: sources[0].url`], ["BLOCKED_HOST", `${FINDING}: explainer.found.en`])] });
    expect(content.skipped).toEqual([{ file: FINDING, codes: ["BLOCKED_HOST"] }]);
  });

  describe("with the whole registry, for the paths the rule really gives", () => {
    /** `shown` reads the planted address back off the loaded record, so that a record left out cannot pass for one kept. */
    const real = (label: string, file: string, plantIt: (record: Record<string, any>) => void, at: string, shown: (c: Content) => unknown): void => {
      it(`${label}: reported at ${at} and kept`, () => {
        const dir = folder();
        patchJson(dir, file, plantIt);
        const checked = REAL_VALIDATE(dir, { perFile: true, config: CONFIG });
        const found = checked.files.find((f) => f.file === file)!.issues.filter((i) => i.code === "BLOCKED_HOST");
        expect(found.map((i) => i.path), "the validator reports it where the loader expects").toEqual([at]);
        const content = load(dir, REGISTRY);
        expect(content.skipped).toEqual([]);
        expect(JSON.stringify(content.warnings)).not.toContain("BLOCKED_HOST");
        expect(shown(content)).toBe(BLOCKED_URL);
      });
    };
    real("a finding's source url", FINDING, (r) => { r.sources[0].url = BLOCKED_URL; }, "sources[0].url", (c) => findingById(c, PROOF)?.sources[0]?.url);
    real("a finding's figure image_url", `findings/${LIGHT}.json`, (r) => { r.figure.image_url = BLOCKED_URL; }, "figure.image_url", (c) => findingById(c, LIGHT)?.figure?.image_url);
    real("a finding's Lean artefact", FINDING, (r) => { r.artefacts.lean = [BLOCKED_URL]; }, "artefacts.lean[0]", (c) => findingById(c, PROOF)?.artefacts.lean[0]);
    real("a correction's source_url", "corrections.json", (r) => { r.corrections[0].source_url = BLOCKED_URL; }, "corrections[0].source_url", (c) => c.corrections[0]?.source_url);

    it("a brief's source url: reported at sources[n].url and kept", () => {
      const dir = folder();
      // The base world's briefs cite nothing, so one source is added, made from a finding's.
      patchJson(dir, BRIEF, (r) => { r.sources.push({ ...findingOf(storedWorld(), PROOF).sources[0], id: "b1", url: BLOCKED_URL }); });
      const found = REAL_VALIDATE(dir, { perFile: true, config: CONFIG }).files.find((f) => f.file === BRIEF)!.issues.filter((i) => i.code === "BLOCKED_HOST");
      expect(found.map((i) => i.path)).toEqual(["sources[0].url"]);
      const content = load(dir, REGISTRY);
      expect(content.skipped).toEqual([]);
      expect(dates(content)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
      expect(content.briefs[1]!.sources[0]!.url).toBe(BLOCKED_URL);
    });

    it("the same address in a finding's text is not an address field: the finding is skipped", () => {
      const dir = folder();
      patchJson(dir, FINDING, (r) => { r.sources[0].url = BLOCKED_URL; r.explainer.found.en = `${r.explainer.found.en} ${BLOCKED_URL}`; });
      expect(load(dir, REGISTRY).skipped).toContainEqual({ file: FINDING, codes: ["BLOCKED_HOST"] });
    });

    it("a report's evidence_url is not an address field: the report is skipped, the rest of reports.json loads", () => {
      const dir = folder();
      patchJson(dir, "reports.json", (r) => { r.reports[1].evidence_url = BLOCKED_URL; });
      const content = load(dir, REGISTRY);
      expect(content.skipped).toEqual([{ file: "reports.json reports[1]", codes: ["BLOCKED_HOST"] }]);
      expect(content.reports.map((r) => r.id)).toEqual(["R-0001"]);
    });
  });
});

// ── The same decision for one issue ──────────────────────────────────────────────────────────────

describe("leavesOut(): the loader's decision on one issue, which re-check's safety flags read (SPEC 4.12 'Stored records', 8.9)", () => {
  const FILE_CODES = ["SCHEMA", "FILE_LAYOUT", "DATE_MISMATCH"] as const;
  const SAFETY_CODES = ["CANARY", "SECRET_LIKE", "DUAL_USE", "BLOCKED_HOST"] as const;
  /** A file of each kind as the validator names it, and a path inside it that no address rule reads. */
  const KINDS = [
    ["a brief", BRIEF, "lead[0].text.en"],
    ["a finding", FINDING, "title.en"],
    ["a metrics file", `metrics/${BILINGUAL}.json`, "pace.value"],
    ["an inputs manifest", `metrics/inputs/${DATA_ONLY}.json`, "feeds[0]"],
    ["a status file", `status/${BILINGUAL}.json`, "feeds[0].note"],
    ["the pace file", "state/pace-weekly.json", "weeks[0]"],
    ["the glossary", "glossary.json", "terms[1].en.definition"],
    ["the corrections", "corrections.json", "corrections[0].reason.en"],
    ["the reports", "reports.json", "reports[1].reason.en"],
    ["the archive index", "archive-index.json", "editions[0].note"],
  ] as const;
  /** Where BLOCKED_HOST leaves nothing out: a field that is itself an address. */
  const ADDRESSES = [
    ["a brief's source url", BRIEF, "sources[0].url"],
    ["a brief's twelfth source url", BRIEF, "sources[11].url"],
    ["a finding's source url", FINDING, "sources[3].url"],
    ["a finding's figure image_url", FINDING, "figure.image_url"],
    ["a finding's Lean artefact", FINDING, "artefacts.lean[2]"],
    ["a correction's source_url", "corrections.json", "corrections[0].source_url"],
    ["a correction's source_url, with a two-digit index", "corrections.json", "corrections[11].source_url"],
  ] as const;
  /** Addresses that §4.12 does not exempt: another kind of file, or another field. */
  const NOT_ADDRESSES = [
    ["a brief's figure.image_url", BRIEF, "figure.image_url"],
    ["a finding's correction source_url", FINDING, "corrections[0].source_url"],
    ["a finding's source url, nested in another field", FINDING, "history.sources[0].url"],
    ["a report's evidence_url", "reports.json", "reports[0].evidence_url"],
    ["a term's official_url", "glossary.json", "terms[0].zh.official_url"],
    ["a source url in a metrics file", `metrics/${BILINGUAL}.json`, "sources[0].url"],
    ["a source url in a status file", `status/${BILINGUAL}.json`, "sources[0].url"],
    ["a source url in a file no rule names", "notes.txt", "sources[0].url"],
  ] as const;

  it("leaves a file out for each of the three file codes, at any path, in any kind of file", () => {
    for (const [name, file, at] of [...KINDS, ["a stray file", "notes.txt", "(file)"]] as const) {
      for (const code of FILE_CODES) {
        for (const where of [at, "(file)", ""]) expect(leavesOut(file, { code, path: where }), `${name} ${code} at ${where}`).toBe(true);
      }
    }
  });

  it("leaves a record out for each safety code, at a place that is no address, in any kind of file", () => {
    for (const [name, file, at] of [...KINDS, ["a stray file", "notes.txt", "(file)"]] as const) {
      for (const code of SAFETY_CODES) expect(leavesOut(file, { code, path: at }), `${name} ${code}`).toBe(true);
    }
  });

  it("leaves nothing out for any other code, wherever it is", () => {
    for (const code of ["XREF", "WORDS", "COUNTS", "RULE_ERROR", "SOURCE_URL", "LANG_PARITY", "MADE_UP", ""]) {
      for (const [name, file, at] of [...KINDS, ...ADDRESSES, ...NOT_ADDRESSES]) expect(leavesOut(file, { code, path: at }), `${name} ${code}`).toBe(false);
    }
  });

  it.each(ADDRESSES)("%s: BLOCKED_HOST leaves nothing out, and any other safety code does", (_name, file, at) => {
    expect(leavesOut(file, { code: "BLOCKED_HOST", path: at })).toBe(false);
    for (const code of ["CANARY", "SECRET_LIKE", "DUAL_USE"]) expect(leavesOut(file, { code, path: at }), code).toBe(true);
  });

  it.each(NOT_ADDRESSES)("%s: BLOCKED_HOST leaves it out", (_name, file, at) => {
    expect(leavesOut(file, { code: "BLOCKED_HOST", path: at })).toBe(true);
  });

  it("agrees with the loader at every place above, for each code at the severity the engine gives a stored record", () => {
    const dir = folder();
    for (const [name, file, at] of [...KINDS, ...ADDRESSES, ...NOT_ADDRESSES.filter(([, f]) => f !== "notes.txt")]) {
      for (const code of SAFETY_CODES) {
        const severity = code === "DUAL_USE" || code === "BLOCKED_HOST" ? "warning" : "error";
        const content = load(dir, { rules: [plant([code, `${file}: ${at}`, severity])] });
        expect(content.skipped.length > 0, `${name}: ${code} at ${at}`).toBe(leavesOut(file, { code, path: at }));
      }
    }
  });

  describe("a file of another kind than the five that hold text", () => {
    /** The files no rule reads text in: a safety code can only reach them from a validator result made by hand, and leaves each out whole. */
    const OTHERS = [
      ["a metrics file", `metrics/${BILINGUAL}.json`, "metrics", (c: Content) => c.metrics.map((m) => m.date), [EN_ONLY, DATA_ONLY]],
      ["an inputs manifest", `metrics/inputs/${DATA_ONLY}.json`, null, () => null, null],
      ["a status file", `status/${BILINGUAL}.json`, "status", (c: Content) => c.status.map((s) => s.date), [EN_ONLY, DATA_ONLY]],
      ["the pace file", "state/pace-weekly.json", "pace", (c: Content) => c.pace, null],
      ["the archive index", "archive-index.json", "archive", (c: Content) => c.archive, null],
    ] as const;

    it.each(OTHERS)("%s: each safety code leaves the whole file out, at either severity", (_name, file, list, left, expected) => {
      for (const code of SAFETY_CODES) {
        for (const severity of ["error", "warning"] as const) {
          const content = load(folder(), { rules: [plant([code, `${file}: (file)`, severity])] });
          expect(content.skipped, `${code} ${severity}`).toEqual([{ file, codes: [code] }]);
          expect(left(content)).toEqual(expected);
          expectSameExcept(content, clean, ...(list === null ? [] : [list]));
          expect(content.warnings).toEqual([]);
        }
      }
    });
  });
});

// ── One record of a file that lists several ──────────────────────────────────────────────────────

describe("loadContent(): one glossary term, correction or report is left out alone", () => {
  const FILES = [
    { file: "glossary.json", list: "terms", key: "terms", at: "en.definition" },
    { file: "corrections.json", list: "corrections", key: "corrections", at: "reason.en" },
    { file: "reports.json", list: "reports", key: "reports", at: "reason.en" },
  ] as const;
  const CODES = ["CANARY", "SECRET_LIKE", "DUAL_USE", "BLOCKED_HOST"] as const;
  const idOf = (c: Content, list: "terms" | "corrections" | "reports"): string[] => c[list].map((r) => r.id);

  it.each(FILES.flatMap((f) => CODES.flatMap((code) => (["error", "warning"] as const).map((severity) => [f, code, severity] as const))))(
    "%j: a record carrying %s as %s",
    (f, code, severity) => {
      const content = load(folder(), { rules: [plant([code, `${f.file}: ${f.key}[0].${f.at}`, severity])] });
      expect(content.skipped).toEqual([{ file: `${f.file} ${f.key}[0]`, codes: [code] }]);
      const all = idOf(clean, f.list);
      expect(idOf(content, f.list)).toEqual(all.slice(1));
      expectSameExcept(content, clean, f.list);
    },
  );

  it("names the record by its place in the file, never by its id, and leaves the others in the file's order", () => {
    const world = storedWorld();
    addTerms(world, 12, LIGHT);
    const dir = worldDir(world);
    const everyTerm = world.terms.map((t) => t.id);
    expect(everyTerm).toHaveLength(15);
    // The two codes at terms[10] are planted in the opposite order to the validator's, which sorts by path (`en.definition` before `en.term`).
    const content = load(dir, { rules: [plant(["CANARY", "glossary.json: terms[10].en.term"], ["DUAL_USE", "glossary.json: terms[10].en.definition"], ["CANARY", "glossary.json: terms[2].en.definition"], ["SECRET_LIKE", "glossary.json: terms[0].en.definition"])] });
    expect(content.skipped).toEqual([
      { file: "glossary.json terms[0]", codes: ["SECRET_LIKE"] },
      { file: "glossary.json terms[2]", codes: ["CANARY"] },
      { file: "glossary.json terms[10]", codes: ["DUAL_USE", "CANARY"] },
    ]);
    expect(content.terms.map((t) => t.id)).toEqual(everyTerm.filter((_, i) => ![0, 2, 10].includes(i)));
    expect(JSON.stringify(content.skipped)).not.toMatch(/lattice|protein|zz-/);
  });

  it("reads a two-digit index in each of the three files, and names the record by it", () => {
    const world = storedWorld();
    addTerms(world, 12, LIGHT);
    for (let i = 0; i < 11; i++) addRefiling(world, LIGHT, "significance", "watch", DATA_ONLY);
    addReports(world, 10);
    expect([world.terms.length, world.corrections.length, world.reports.length]).toEqual([15, 12, 12]);
    const content = load(worldDir(world), {
      rules: [plant(["CANARY", "glossary.json: terms[11].en.definition"], ["CANARY", "corrections.json: corrections[11].reason.en"], ["CANARY", "reports.json: reports[10].reason.en"], ["CANARY", "reports.json: reports[1].reason.en"])],
    });
    expect(content.skipped).toEqual([
      { file: "corrections.json corrections[11]", codes: ["CANARY"] },
      { file: "glossary.json terms[11]", codes: ["CANARY"] },
      { file: "reports.json reports[1]", codes: ["CANARY"] },
      { file: "reports.json reports[10]", codes: ["CANARY"] },
    ]);
    expect(content.terms.map((t) => t.id)).toEqual(world.terms.filter((_, i) => i !== 11).map((t) => t.id));
    expect(content.corrections.map((c) => c.id)).toEqual(world.corrections.filter((_, i) => i !== 11).map((c) => c.id));
    expect(content.reports.map((r) => r.id)).toEqual(world.reports.filter((_, i) => i !== 1 && i !== 10).map((r) => r.id));
  });

  it("orders the skipped records by their place in the file whatever order the validator listed them", () => {
    const world = storedWorld();
    addTerms(world, 12, LIGHT);
    nextResult((real) => withIssues(real, [
      ["glossary.json", issue("CANARY", "terms[11].en.term")],
      ["glossary.json", issue("CANARY", "terms[3].en.term")],
      ["glossary.json", issue("DUAL_USE", "terms[10].en.term", "warning")],
      ["glossary.json", issue("CANARY", "terms[9].en.term")],
      ["glossary.json", issue("SECRET_LIKE", "terms[3].id")],
    ]));
    const content = load(worldDir(world), { rules: [] });
    expect(content.skipped.map((s) => s.file)).toEqual(["glossary.json terms[3]", "glossary.json terms[9]", "glossary.json terms[10]", "glossary.json terms[11]"]);
    expect(content.skipped[0]!.codes).toEqual(["CANARY", "SECRET_LIKE"]);
  });

  it("lists each code of a left-out record once, however many places in it carry the code", () => {
    const content = load(folder(), {
      rules: [plant(["CANARY", "glossary.json: terms[1].zh.definition"], ["SECRET_LIKE", "glossary.json: terms[1].id"], ["CANARY", "glossary.json: terms[1].en.term"], ["CANARY", "glossary.json: terms[1].en.definition"])],
    });
    expect(content.skipped).toEqual([{ file: "glossary.json terms[1]", codes: ["CANARY", "SECRET_LIKE"] }]);
  });

  it("leaves several records of one file out and keeps the rest of the file", () => {
    const content = load(folder(), { rules: [plant(["CANARY", "reports.json: reports[0].reason.en"], ["CANARY", "reports.json: reports[1].reason.en"], ["CANARY", "corrections.json: corrections[0].reason.en"])] });
    expect(content.skipped.map((s) => s.file)).toEqual(["corrections.json corrections[0]", "reports.json reports[0]", "reports.json reports[1]"]);
    expect(content.reports).toEqual([]);
    expect(content.corrections).toEqual([]);
    expectSameExcept(content, clean, "reports", "corrections");
  });

  it("reads the index at the front of the path only, and a path with no index leaves the whole file out", () => {
    for (const [file, list, at] of [
      ["glossary.json", "terms", "terms"], ["corrections.json", "corrections", "schema_version"], ["reports.json", "reports", "(file)"],
      ["glossary.json", "terms", "terms[01].en.term"], ["corrections.json", "corrections", "corrections[01].reason.en"], ["reports.json", "reports", "reports[01].reason.en"],
      ["glossary.json", "terms", "terms[x].en.term"], ["corrections.json", "corrections", "corrections[x].reason.en"], ["reports.json", "reports", "reports[x].reason.en"],
      ["glossary.json", "terms", "terms[1x].en.term"], ["corrections.json", "corrections", "corrections[0x].reason.en"], ["reports.json", "reports", "reports[0x].reason.en"],
      ["glossary.json", "terms", "x.terms[0].en.term"], ["corrections.json", "corrections", "x.corrections[0].reason.en"], ["reports.json", "reports", "x.reports[0].reason.en"],
      ["reports.json", "reports", "terms[0].en.term"], ["glossary.json", "terms", "reports[0].reason.en"], ["corrections.json", "corrections", "reports[0].reason.en"],
    ] as const) {
      const content = load(folder(), { rules: [plant(["CANARY", `${file}: ${at}`])] });
      expect(content.skipped, at).toEqual([{ file, codes: ["CANARY"] }]);
      expect(content[list], at).toEqual([]);
    }
  });

  it("does not take a record out for a code that only looks like its path", () => {
    for (const at of ["terms[1]", "terms[1].en.definition", "terms[1].zh.definition", "terms[1].fields[0]"]) {
      const content = load(folder(), { rules: [plant(["DUAL_USE", `glossary.json: ${at}`])] });
      expect(content.skipped, at).toEqual([{ file: "glossary.json terms[1]", codes: ["DUAL_USE"] }]);
    }
  });

  it("leaves the whole file out when one record fails its schema", () => {
    for (const [file, key, index] of [["glossary.json", "terms", 1], ["corrections.json", "corrections", 0], ["reports.json", "reports", 1]] as const) {
      const dir = folder();
      patchJson(dir, file, (record) => { record[key][index].made_up_key = 1; });
      const content = load(dir);
      expect(content.skipped, file).toEqual([{ file, codes: ["SCHEMA"] }]);
    }
  });

  it("shows a record that fails any other code, and warns once for the file", () => {
    const content = load(folder(), { rules: [plant(["XREF", "glossary.json: terms[1].first_finding"], ["WORDS", "glossary.json: terms[1].en.definition"], ["XREF", "glossary.json: terms[2].first_finding"])] });
    expect(content.skipped).toEqual([]);
    expect(content.terms).toHaveLength(3);
    expect(content.warnings).toEqual([{ file: "glossary.json", codes: ["WORDS", "XREF"] }]);
  });

  it("gives a left-out record's other errors no warning, and keeps the warnings of the records that stay", () => {
    const content = load(folder(), { rules: [plant(["XREF", "glossary.json: terms[0].first_finding"], ["DUAL_USE", "glossary.json: terms[0].en.definition"], ["TERM_DEFINED", "glossary.json: terms[2].en.term"])] });
    expect(content.skipped).toEqual([{ file: "glossary.json terms[0]", codes: ["DUAL_USE"] }]);
    expect(content.warnings).toEqual([{ file: "glossary.json", codes: ["TERM_DEFINED"] }]);
    const onlyTheLeftOut = load(folder(), { rules: [plant(["XREF", "glossary.json: terms[0].first_finding"], ["DUAL_USE", "glossary.json: terms[0].en.definition"])] });
    expect(onlyTheLeftOut.warnings).toEqual([]);
  });

  it("with the whole registry: a term whose definition holds a made-up sequence, a correction with the canary, a report with the canary", () => {
    const dir = folder();
    patchJson(dir, "glossary.json", (r) => { r.terms[1].en.definition = `A line ${SEQUENCE}`; });
    patchJson(dir, "corrections.json", (r) => { r.corrections[0].reason.en = `A reason ${CANARY}`; });
    patchJson(dir, "reports.json", (r) => { r.reports[0].reason.en = `A reason ${CANARY}`; });
    const content = load(dir, REGISTRY);
    expect(content.skipped).toEqual([
      { file: "corrections.json corrections[0]", codes: ["CANARY"] },
      { file: "glossary.json terms[1]", codes: ["DUAL_USE"] },
      { file: "reports.json reports[0]", codes: ["CANARY"] },
    ]);
    expect(content.terms.map((t) => t.id)).toEqual(["lattice", "protein-folding"]);
    expect(content.corrections).toEqual([]);
    expect(content.reports.map((r) => r.id)).toEqual(["R-0002"]);
    expect(content.hiddenTerms).toEqual([]);
    expectSameExcept(content, clean, "terms", "corrections", "reports");
  });
});

// ── Terms hidden for their own name ──────────────────────────────────────────────────────────────

describe("loadContent(): a term whose own name fails DUAL_USE or BLOCKED_HOST is hidden (SPEC 8.9)", () => {
  const NAME_PATHS = ["id", "en.term", "zh.term", "zh.official", "zh.official_url"] as const;

  it.each(NAME_PATHS.flatMap((at) => (["DUAL_USE", "BLOCKED_HOST"] as const).map((code) => [at, code] as const)))(
    "a hit at terms[2].%s for %s is left out and reported by its first finding alone",
    (at, code) => {
      const content = load(folder(), { rules: [plant([code, `glossary.json: terms[2].${at}`, "warning"])] });
      expect(content.skipped).toEqual([{ file: "glossary.json terms[2]", codes: [code] }]);
      expect(content.hiddenTerms).toEqual([{ first_finding: PROTEIN, codes: [code] }]);
      expect(content.terms.map((t) => t.id)).toEqual(["lattice", "proof-assistant"]);
    },
  );

  it("a hit in the definition leaves the term out but does not hide it", () => {
    for (const code of ["DUAL_USE", "BLOCKED_HOST"]) {
      for (const at of ["en.definition", "zh.definition"]) {
        const content = load(folder(), { rules: [plant([code, `glossary.json: terms[2].${at}`])] });
        expect(content.skipped).toEqual([{ file: "glossary.json terms[2]", codes: [code] }]);
        expect(content.hiddenTerms, `${code} ${at}`).toEqual([]);
      }
    }
  });

  it("a term that fails CANARY or SECRET_LIKE in its name is left out and is not one of the hidden", () => {
    for (const code of ["CANARY", "SECRET_LIKE"]) {
      const content = load(folder(), { rules: [plant([code, "glossary.json: terms[2].en.term"])] });
      expect(content.skipped).toEqual([{ file: "glossary.json terms[2]", codes: [code] }]);
      expect(content.hiddenTerms).toEqual([]);
    }
  });

  it("lists both codes of a term, DUAL_USE first, whichever the validator named first", () => {
    const content = load(folder(), { rules: [plant(["BLOCKED_HOST", "glossary.json: terms[1].en.term"], ["DUAL_USE", "glossary.json: terms[1].zh.official_url"])] });
    expect(content.hiddenTerms).toEqual([{ first_finding: PROOF, codes: ["DUAL_USE", "BLOCKED_HOST"] }]);
    expect(content.skipped).toEqual([{ file: "glossary.json terms[1]", codes: ["BLOCKED_HOST", "DUAL_USE"] }]);
  });

  it("lists the hidden terms by their first finding as compareFindingIds() orders them, then in the file's order, and each term once", () => {
    const world = storedWorld();
    const LATER = "bio-2026-0004";
    addFindingCopy(world, PROTEIN, LATER);
    addTerms(world, 2, LATER);
    // The file's order: lattice (first used in phys-2026-0003), proof-assistant (math-2026-0002), protein-folding (bio-2026-0001), zz-00 and zz-01 (bio-2026-0004).
    // By first finding, the counter before the field code, they come math-2026-0002, phys-2026-0003, then the two of bio-2026-0004: neither the file's order nor the string order.
    const content = load(worldDir(world), {
      rules: [plant(
        ["DUAL_USE", "glossary.json: terms[0].id"],
        ["DUAL_USE", "glossary.json: terms[1].en.term"], ["BLOCKED_HOST", "glossary.json: terms[1].zh.term"],
        ["DUAL_USE", "glossary.json: terms[2].en.definition"],
        ["BLOCKED_HOST", "glossary.json: terms[3].en.term"], ["DUAL_USE", "glossary.json: terms[4].zh.official"],
      )],
    });
    expect(content.hiddenTerms).toEqual([
      { first_finding: PROOF, codes: ["DUAL_USE", "BLOCKED_HOST"] },
      { first_finding: LIGHT, codes: ["DUAL_USE"] },
      { first_finding: LATER, codes: ["BLOCKED_HOST"] },
      { first_finding: LATER, codes: ["DUAL_USE"] },
    ]);
    expect(content.terms.map((t) => t.id)).toEqual([]);
  });

  it("never holds the term's id or name: not in the hidden list, the skipped list, the warnings or the log lines", () => {
    const world = storedWorld();
    world.terms[2]!.id = "zq-hidden-name";
    world.terms[2]!.en.term = SEQUENCE;
    world.terms.sort((a, b) => (a.id < b.id ? -1 : 1));
    const dir = worldDir(world);
    const hidden = world.terms.findIndex((t) => t.id === "zq-hidden-name");
    const content = load(dir, { rules: [plant(["DUAL_USE", `glossary.json: terms[${hidden}].id`], ["DUAL_USE", `glossary.json: terms[${hidden}].en.term`])] });
    const printed = JSON.stringify([content.hiddenTerms, content.skipped, content.warnings, contentLogLines(content)]);
    expect(printed).not.toContain("zq-hidden-name");
    expect(printed).not.toContain(SEQUENCE);
    expect(content.hiddenTerms).toHaveLength(1);
    expect(content.terms.map((t) => t.id)).not.toContain("zq-hidden-name");
  });

  it("with the whole registry: a term whose `term` holds a made-up sequence is hidden, and its id is the one published for it", () => {
    const dir = folder();
    patchJson(dir, "glossary.json", (r) => { r.terms[2].en.term = SEQUENCE; });
    const content = load(dir, REGISTRY);
    expect(content.skipped).toContainEqual({ file: "glossary.json terms[2]", codes: ["DUAL_USE"] });
    expect(content.hiddenTerms).toEqual([{ first_finding: PROTEIN, codes: ["DUAL_USE"] }]);
    expect(content.terms.map((t) => t.id)).toEqual(["lattice", "proof-assistant"]);
  });

  it("is empty when the whole glossary is left out", () => {
    const content = load(folder(), { rules: [plant(["DUAL_USE", "glossary.json: terms[2].en.term"], ["SCHEMA", "glossary.json: (file)"])] });
    expect(content.skipped).toEqual([{ file: "glossary.json", codes: ["SCHEMA"] }]);
    expect(content.hiddenTerms).toEqual([]);
    expect(content.terms).toEqual([]);
  });
});

// ── Any other error is a build warning ───────────────────────────────────────────────────────────

describe("loadContent(): any other error is a build warning and the record is shown", () => {
  const EVERY_FILE = [
    BRIEF, FINDING, `metrics/${BILINGUAL}.json`, `metrics/inputs/${DATA_ONLY}.json`, `status/${BILINGUAL}.json`, "state/pace-weekly.json", "glossary.json", "corrections.json", "reports.json", "archive-index.json",
  ] as const;

  it.each(EVERY_FILE)("%s: an error of another code leaves the file loaded and gives one warning", (file) => {
    // Planted in the opposite order to the validator's (by path, then code), and with one code twice: each code is listed once, as the validator met it.
    const content = load(folder(), { rules: [plant(["WORDS", `${file}: date`], ["XREF", `${file}: title.en`], ["XREF", `${file}: (file)`])] });
    expect(content.skipped).toEqual([]);
    expectSameExcept(content, clean);
    expect(content.warnings).toEqual([{ file, codes: ["XREF", "WORDS"] }]);
  });

  it("lists the codes once each, in the validator's order, for each file in path order", () => {
    const content = load(folder(), {
      rules: [plant(["XREF", `${BRIEF}: story.finding_id`], ["WORDS", `${BRIEF}: lead[0].text.en`], ["XREF", `${BRIEF}: items[0].finding_id`], ["COUNTS", `briefs/${EN_ONLY}.json: items`], ["XREF", `findings/${LIGHT}.json: briefs`])],
    });
    expect(content.warnings).toEqual([
      { file: `briefs/${EN_ONLY}.json`, codes: ["COUNTS"] },
      { file: BRIEF, codes: ["XREF", "WORDS"] },
      { file: `findings/${LIGHT}.json`, codes: ["XREF"] },
    ]);
  });

  it("is not given by a warning-severity issue", () => {
    const content = load(folder(), { rules: [plant(["WORDS", `${BRIEF}: lead[0].text.en`, "warning"], ["READING_LEVEL", `${FINDING}: explainer.found.en`, "warning"])] });
    expect(content.warnings).toEqual([]);
    expect(content.skipped).toEqual([]);
  });

  it("is not given by a blocking code, which leaves the record out and says so in `skipped`", () => {
    const content = load(folder(), { rules: [plant(["WORDS", `${BRIEF}: lead[0].text.en`], ["CANARY", `${BRIEF}: lead[0].text.en`])] });
    expect(content.skipped).toEqual([{ file: BRIEF, codes: ["CANARY"] }]);
    expect(content.warnings).toEqual([]);
  });

  it("is given by an error of an address-field BLOCKED_HOST, which skips nothing", () => {
    nextResult((real) => withIssues(real, [[FINDING, issue("BLOCKED_HOST", "sources[0].url")]]));
    const content = load(folder(), { rules: [] });
    expect(content.skipped).toEqual([]);
    expect(content.warnings).toEqual([{ file: FINDING, codes: ["BLOCKED_HOST"] }]);
  });

  it("shows a brief that names a finding which is missing, with the validator's XREF as its warning", () => {
    const dir = folder();
    fs.rmSync(path.join(dir, `findings/${LIGHT}.json`));
    const content = load(dir);
    expect(dates(content)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
    expect(ids(content)).toEqual([PROTEIN, PROOF]);
    expect(content.warnings.find((w) => w.file === BRIEF)?.codes).toEqual(["XREF"]);
    expect(content.skipped).toEqual([]);
  });

  it("shows a missing archive index as a warning, with no archive and nothing skipped", () => {
    const dir = folder();
    fs.rmSync(path.join(dir, "archive-index.json"));
    const content = load(dir);
    expect(content.archive).toBeNull();
    expect(content.skipped).toEqual([]);
    expect(content.warnings).toEqual([{ file: "archive-index.json", codes: ["XREF"] }]);
    expectSameExcept(content, clean, "archive");
  });

  it("shows what no file holds as a warning, and a folder that cannot be read as a skip", () => {
    nextResult((real) => withIssues(real, [
      [null, issue("SCHEMA", "(root)")],
      [null, issue("RULE_ERROR", "(engine)")],
      [null, issue("RULE_ERROR", "(rule WORDS)")],
      [null, issue("RULE_ERROR", "(rule ZH_NO_DASH)", "warning")],
      [null, issue("RULE_ERROR", "(rule WORDS)")],
      [null, issue("XREF", "(engine)")],
    ]));
    const content = load(folder(), { rules: [] });
    expect(content.skipped).toEqual([{ file: "(root)", codes: ["SCHEMA"] }]);
    expect(content.warnings).toEqual([{ file: "(engine)", codes: ["RULE_ERROR", "XREF"] }, { file: "(rule WORDS)", codes: ["RULE_ERROR"] }]);
    expectSameExcept(content, clean);
  });

  it("lists what no file holds before the files, in `skipped` and in `warnings`", () => {
    nextResult((real) => withIssues(real, [
      [BRIEF, issue("CANARY", "lead[0].text.en")],
      [FINDING, issue("XREF", "related[0]")],
      [null, issue("SCHEMA", "(root)")],
      [null, issue("RULE_ERROR", "(engine)")],
    ]));
    const content = load(folder(), { rules: [] });
    expect(content.skipped).toEqual([{ file: "(root)", codes: ["SCHEMA"] }, { file: BRIEF, codes: ["CANARY"] }]);
    expect(content.warnings).toEqual([{ file: "(engine)", codes: ["RULE_ERROR"] }, { file: FINDING, codes: ["XREF"] }]);
    expect(contentLogLines(content)).toEqual([
      "content: skipped (root) (SCHEMA)", `content: skipped ${BRIEF} (CANARY)`, "content: warning (engine) (RULE_ERROR)", `content: warning ${FINDING} (XREF)`,
    ]);
  });

  it("shows a rule that throws as a warning, with the folder's records all loaded", () => {
    const throwing = defineRule({ code: "WORDS", scope: "published", check: () => { throw new Error("made up"); } });
    const content = load(folder(), { rules: [throwing] });
    expect(content.skipped).toEqual([]);
    expect(content.warnings).toEqual([{ file: "(rule WORDS)", codes: ["RULE_ERROR"] }]);
    expectSameExcept(content, clean);
  });

  it("with the whole registry: a stored record that fails a rule of another code loads", () => {
    const dir = folder();
    patchJson(dir, `findings/${LIGHT}.json`, (r) => { r.related = ["bio-2026-0099"]; });
    const content = load(dir, REGISTRY);
    expect(ids(content)).toEqual([PROTEIN, PROOF, LIGHT]);
    expect(content.skipped).toEqual([]);
    expect(content.warnings.find((w) => w.file === `findings/${LIGHT}.json`)?.codes).toContain("XREF");
  });
});

// ── A skipped record leaves the others as they are ───────────────────────────────────────────────

describe("loadContent(): a record that is left out leaves the others intact, and no reference is rewritten", () => {
  const world = storedWorld();

  it("a skipped finding is on no page: the brief that names it, a correction and a report about it, its term and the archive all load as stored", () => {
    const content = load(folder(), { rules: [plant(["DUAL_USE", `findings/${PROTEIN}.json: explainer.found.en`])] });
    expect(content.skipped).toEqual([{ file: `findings/${PROTEIN}.json`, codes: ["DUAL_USE"] }]);
    expect(ids(content)).toEqual([PROOF, LIGHT]);
    expect(findingById(content, PROTEIN)).toBeUndefined();
    expect(filedFindings(content).map((f) => f.id)).toEqual([PROOF, LIGHT]);
    expect(content.briefs).toEqual(world.briefs);
    expect(content.corrections).toEqual(world.corrections);
    expect(content.corrections[0]!.finding_id).toBe(PROTEIN);
    expect(content.reports).toEqual(world.reports);
    expect(content.terms).toEqual(world.terms);
    expect(content.archive).toEqual(world.archive);
    expect(content.briefs[1]!.story).toEqual(world.briefs[1]!.story);
    expect(JSON.stringify(content.briefs)).toContain(PROTEIN);
    expectSameExcept(content, clean, "findings");
  });

  it("the other findings are the stored ones, untouched by a neighbour's skip", () => {
    const content = load(folder(), { rules: [plant(["CANARY", `findings/${PROOF}.json: title.en`])] });
    expect(content.findings).toEqual([findingOf(world, PROTEIN), findingOf(world, LIGHT)]);
  });

  it("a skipped brief leaves the findings it names, the corrections and reports it lists, and the archive entry for its date", () => {
    const content = load(folder(), { rules: [plant(["CANARY", `${BRIEF}: lead[0].text.en`])] });
    expect(content.skipped).toEqual([{ file: BRIEF, codes: ["CANARY"] }]);
    expect(dates(content)).toEqual([EN_ONLY, DATA_ONLY]);
    expect(content.findings).toEqual(world.findings);
    expect(content.corrections).toEqual(world.corrections);
    expect(content.reports).toEqual(world.reports);
    expect(content.archive?.editions.map((e) => e.date)).toEqual([DATA_ONLY, BILINGUAL, EN_ONLY]);
    expect(findingById(content, LIGHT)?.briefs).toContain(BILINGUAL);
    expectSameExcept(content, clean, "briefs");
  });

  it("a skipped correction is not in the list and files nothing", () => {
    const w = storedWorld();
    addRefiling(w, PROOF, "significance", "watch", BILINGUAL);
    const dir = worldDir(w);
    const kept = load(dir);
    expect(findingById(kept, PROOF)!.significance).toBe(findingOf(w, PROOF).significance);
    expect(filedFinding(kept, findingById(kept, PROOF)!).significance).toBe("watch");
    const left = load(dir, { rules: [plant(["SECRET_LIKE", "corrections.json: corrections[1].reason.en"])] });
    expect(left.skipped).toEqual([{ file: "corrections.json corrections[1]", codes: ["SECRET_LIKE"] }]);
    expect(left.corrections.map((c) => c.id)).toEqual(["C-0001"]);
    expect(filedFinding(left, findingById(left, PROOF)!).significance).toBe(findingOf(w, PROOF).significance);
  });

  it("a correction whose target finding was skipped still loads, and so does a report about it", () => {
    const content = load(folder(), { rules: [plant(["DUAL_USE", `findings/${PROTEIN}.json: title.en`])] });
    expect(content.corrections.map((c) => [c.id, c.finding_id])).toEqual([["C-0001", PROTEIN]]);
    expect(content.reports.map((r) => [r.id, r.finding_id])).toEqual([["R-0001", PROTEIN], ["R-0002", PROOF]]);
  });
});

// ── The filed views ──────────────────────────────────────────────────────────────────────────────

describe("the filed views (SPEC 6, 4.10)", () => {
  /** The world with one refiling of each of the six filed values, dated across the three editions. */
  function refiledWorld() {
    const w = storedWorld();
    addRefiling(w, PROOF, "significance", "watch", BILINGUAL);
    addRefiling(w, PROOF, "field", "physics", DATA_ONLY);
    addRefiling(w, PROOF, "subfield", "a made-up subfield", DATA_ONLY);
    addRefiling(w, PROOF, "kind", "capability", DATA_ONLY);
    addRefiling(w, PROTEIN, "ai.role", "ai_tool", BILINGUAL);
    addRefiling(w, PROTEIN, "ai.confidence", "claimed", DATA_ONLY);
    return w;
  }

  describe("newestDate()", () => {
    it("is the newest loaded edition's date", () => {
      expect(newestDate(clean)).toBe(DATA_ONLY);
    });

    it("is null when no brief loaded", () => {
      expect(newestDate({ briefs: [] })).toBeNull();
      expect(newestDate(load(path.join(tempDir("nothing"), "not-there")))).toBeNull();
    });

    it("is the newest of the briefs wherever it lies in the list", () => {
      const brief = (date: string) => ({ ...storedWorld().briefs[0]!, date });
      expect(newestDate({ briefs: [brief("2026-11-19"), brief("2026-11-21"), brief("2026-11-18")] })).toBe("2026-11-21");
      expect(newestDate({ briefs: [brief("2026-11-21"), brief("2026-11-19")] })).toBe("2026-11-21");
      expect(newestDate({ briefs: [brief("2026-11-19"), brief("2026-11-21")] })).toBe("2026-11-21");
      expect(newestDate({ briefs: [brief("2026-11-19")] })).toBe("2026-11-19");
    });

    it("is the last good edition when the newest was left out", () => {
      const content = load(folder(), { rules: [plant(["CANARY", `briefs/${DATA_ONLY}.json: lead[0].text.en`])] });
      expect(newestDate(content)).toBe(BILINGUAL);
    });
  });

  describe("findingById()", () => {
    it("finds a loaded finding by its id, and nothing for any other id", () => {
      expect(findingById(clean, PROOF)).toBe(clean.findings[1]);
      expect(findingById(clean, PROTEIN)).toBe(clean.findings[0]);
      for (const id of ["", "bio-2026-0099", "BIO-2026-0001", `${PROTEIN} `, "2026-11-19"]) expect(findingById(clean, id), id).toBeUndefined();
    });
  });

  describe("filedFinding()", () => {
    const dir = worldDir(refiledWorld());
    const content = load(dir);
    const proof = findingById(content, PROOF)!;
    const protein = findingById(content, PROTEIN)!;

    it("files a finding on the newest edition's date: each of the six values as the latest correction at or before it says", () => {
      const filed = filedFinding(content, proof);
      expect(filed.significance).toBe("watch");
      expect(filed.field).toBe("physics");
      expect(filed.subfield).toBe("a made-up subfield");
      expect(filed.kind).toBe("capability");
      const refiled = filedFinding(content, protein);
      expect(refiled.ai.role).toBe("ai_tool");
      expect(refiled.ai.confidence).toBe("claimed");
    });

    it("files it on a date given: a correction dated later does not apply, one dated that day does", () => {
      expect(filedFinding(content, proof, EN_ONLY).significance).toBe(proof.significance);
      expect(filedFinding(content, proof, "2026-11-18").field).toBe(proof.field);
      expect(filedFinding(content, proof, BILINGUAL).significance).toBe("watch");
      expect(filedFinding(content, proof, BILINGUAL).field).toBe(proof.field);
      expect(filedFinding(content, proof, BILINGUAL).kind).toBe(proof.kind);
      expect(filedFinding(content, proof, DATA_ONLY).field).toBe("physics");
      expect(filedFinding(content, protein, BILINGUAL).ai.confidence).toBe(protein.ai.confidence);
      expect(filedFinding(content, protein, BILINGUAL).ai.role).toBe("ai_tool");
      expect(filedFinding(content, protein, "2026-12-31").ai.confidence).toBe("claimed");
    });

    it("applies no correction when the date is null, and none when no edition loaded", () => {
      expect(filedFinding(content, proof, null)).toEqual(proof);
      const none = load(dir, { rules: [plant(["CANARY", `briefs/${EN_ONLY}.json: lead[0].text.en`], ["CANARY", `briefs/${BILINGUAL}.json: lead[0].text.en`], ["CANARY", `briefs/${DATA_ONLY}.json: lead[0].text.en`])] });
      expect(none.briefs).toEqual([]);
      expect(none.corrections).toHaveLength(7);
      expect(newestDate(none)).toBeNull();
      expect(filedFinding(none, findingById(none, PROOF)!)).toEqual(findingById(none, PROOF));
      expect(filedFindings(none)).toEqual(none.findings);
    });

    it("changes nothing it was given, and returns a new finding", () => {
      const before = structuredClone(content);
      const filed = filedFinding(content, proof);
      expect(filed).not.toBe(proof);
      expect(proof.significance).not.toBe("watch");
      expect(content).toEqual(before);
      expect(filed.title).toEqual(proof.title);
      expect(filed.explainer).toEqual(proof.explainer);
      expect({ ...filed, significance: proof.significance, field: proof.field, subfield: proof.subfield, kind: proof.kind }).toEqual(proof);
    });

    it("files a finding that no correction names as stored", () => {
      const light = findingById(content, LIGHT)!;
      expect(filedFinding(content, light)).toEqual(light);
    });

    it("never refiles on a removed correction, nor on another finding's", () => {
      const w = storedWorld();
      addRemoval(w, { finding_id: PROOF }, "significance", BILINGUAL);
      addRefiling(w, PROTEIN, "significance", "watch", BILINGUAL);
      const c = load(worldDir(w));
      expect(filedFinding(c, findingById(c, PROOF)!).significance).toBe(findingOf(w, PROOF).significance);
      expect(filedFinding(c, findingById(c, PROTEIN)!).significance).toBe("watch");
      expect(filedFinding(c, findingById(c, LIGHT)!).significance).toBe(findingOf(w, LIGHT).significance);
    });

    it("files an AI role of none with no confidence", () => {
      const w = storedWorld();
      addRefiling(w, PROTEIN, "ai.role", "none", BILINGUAL);
      const c = load(worldDir(w));
      const filed = filedFinding(c, findingById(c, PROTEIN)!);
      expect(filed.ai.role).toBe("none");
      expect(filed.ai.confidence).toBeNull();
      expect(filed.ai.systems).toEqual(findingOf(w, PROTEIN).ai.systems);
    });

    it("takes the later of two corrections at one path, by date then id", () => {
      const w = storedWorld();
      addRefiling(w, PROOF, "significance", "watch", BILINGUAL);
      addRefiling(w, PROOF, "significance", "notable", BILINGUAL);
      addRefiling(w, PROOF, "significance", "landmark", EN_ONLY);
      const c = load(worldDir(w));
      expect(filedFinding(c, findingById(c, PROOF)!).significance).toBe("notable");
    });

    it("reads the corrections the loader kept: one it left out files nothing", () => {
      const left = load(dir, { rules: [plant(["CANARY", "corrections.json: corrections[1].reason.en"])] });
      expect(left.corrections.map((c) => c.id)).not.toContain("C-0002");
      expect(filedFinding(left, findingById(left, PROOF)!).significance).toBe(proof.significance);
      expect(filedFinding(left, findingById(left, PROOF)!).field).toBe("physics");
    });

    it("files any finding-shaped value, not only a loaded one", () => {
      const own = { id: PROOF, field: "social" as const, subfield: "x", kind: "result" as const, significance: "major" as const, ai: { role: "ai_ran" as const, confidence: "confirmed" as const } };
      const filed = filedFinding(content, own);
      expect(filed.significance).toBe("watch");
      expect(filed.field).toBe("physics");
      expect(own.significance).toBe("major");
    });
  });

  describe("filedFindings()", () => {
    const content = load(worldDir(refiledWorld()));

    it("files every loaded finding on the newest edition's date, in the loader's order", () => {
      const filed = filedFindings(content);
      expect(filed.map((f) => f.id)).toEqual([PROTEIN, PROOF, LIGHT]);
      expect(filed.map((f) => f.significance)).toEqual(["major", "watch", content.findings[2]!.significance]);
      expect(filed[1]!.field).toBe("physics");
      expect(filed[0]!.ai.role).toBe("ai_tool");
    });

    it("files them on a date given", () => {
      expect(filedFindings(content, EN_ONLY)).toEqual(content.findings);
      expect(filedFindings(content, BILINGUAL)[1]!.significance).toBe("watch");
      expect(filedFindings(content, BILINGUAL)[1]!.field).toBe(content.findings[1]!.field);
      expect(filedFindings(content, null)).toEqual(content.findings);
    });

    it("leaves out a finding the loader left out, and changes none of the stored ones", () => {
      const left = load(worldDir(refiledWorld()), { rules: [plant(["DUAL_USE", `findings/${PROOF}.json: title.en`])] });
      expect(filedFindings(left).map((f) => f.id)).toEqual([PROTEIN, LIGHT]);
      expect(left.findings.map((f) => f.significance)).toEqual([findingOf(storedWorld(), PROTEIN).significance, findingOf(storedWorld(), LIGHT).significance]);
    });
  });

  it("reads no clock: the same Content and the same filings whatever day it is", () => {
    const dir = worldDir(refiledWorld());
    const seen: unknown[] = [];
    vi.useFakeTimers();
    try {
      for (const day of ["2019-01-01T00:00:00Z", "2026-11-20T12:00:00Z", "2041-06-30T23:59:59Z"]) {
        vi.setSystemTime(new Date(day));
        const content = load(dir);
        seen.push([content, newestDate(content), filedFindings(content), filedFinding(content, content.findings[1]!)]);
      }
    } finally {
      vi.useRealTimers();
    }
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
    expect((seen[0] as [Content, string])[1]).toBe(DATA_ONLY);
  });
});

// ── A folder that cannot be loaded ───────────────────────────────────────────────────────────────

describe("loadContent(): never throws for a folder", () => {
  const EMPTY: Omit<Content, "dir"> = {
    briefs: [], findings: [], metrics: [], pace: null, status: [], terms: [], hiddenTerms: [], corrections: [], reports: [], archive: null, skipped: [], warnings: [],
  };
  const expectEmpty = (content: Content, skipped: FileCodes[] = []): void => {
    expect({ ...content, dir: "" }).toEqual({ ...EMPTY, dir: "", skipped });
  };

  it("gives an empty Content for a folder that does not exist, and reads no config", () => {
    const dir = path.join(tempDir("missing"), "not-there");
    loadConfigSpy.mockClear();
    const content = loadContent(dir, { fresh: true, log: () => {} });
    expectEmpty(content);
    expect(content.dir).toBe(dir);
    expect(loadConfigSpy).not.toHaveBeenCalled();
  });

  it("gives an empty Content for an empty folder, and for one that holds only what git ignores, and reads no config", () => {
    loadConfigSpy.mockClear();
    const dir = tempDir("empty");
    expectEmpty(loadContent(dir, { fresh: true, log: () => {} }));
    fs.writeFileSync(path.join(dir, ".DS_Store"), "x");
    fs.mkdirSync(path.join(dir, "briefs"));
    fs.writeFileSync(path.join(dir, "briefs", ".DS_Store"), "x");
    expectEmpty(loadContent(dir, { fresh: true, log: () => {} }));
    expect(loadConfigSpy).not.toHaveBeenCalled();
  });

  it("gives an empty Content and one skipped path for a folder that holds only a stray", () => {
    const dir = tempDir("stray");
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    expectEmpty(load(dir), [{ file: "notes.txt", codes: ["FILE_LAYOUT"] }]);
  });

  it("gives an empty Content and a skipped (root) for a path that is a file", () => {
    const dir = folder();
    expectEmpty(load(path.join(dir, "glossary.json")), [{ file: "(root)", codes: ["SCHEMA"] }]);
  });

  it("gives an empty Content for a folder that is not there when the folder's parent is a file", () => {
    const dir = folder();
    expectEmpty(load(path.join(dir, "glossary.json", "inside")));
  });

  it("loads the rest of a folder when one file cannot be parsed, and never throws", () => {
    for (const [rel, bytes] of [[BRIEF, ""], [FINDING, "{"], ["glossary.json", new Uint8Array([0xc3, 0x28])], ["archive-index.json", BOM + "{}"], ["state/pace-weekly.json", "[]"]] as const) {
      const dir = folder();
      writeRaw(dir, rel, bytes);
      expect(() => load(dir), rel).not.toThrow();
      expect(load(dir).skipped).toEqual([{ file: rel, codes: ["SCHEMA"] }]);
    }
  });

  it("reads a file that changed after the validator passed it: one that is gone is absent, one that no longer parses or is no longer a file is skipped", () => {
    const dir = folder();
    changeAfterValidator(() => {
      fs.rmSync(path.join(dir, FINDING));
      writeRaw(dir, `status/${DATA_ONLY}.json`, "{ no longer json");
      patchJson(dir, `metrics/${BILINGUAL}.json`, (r) => { r.made_up_key = 1; });
      fs.rmSync(path.join(dir, "briefs", `${EN_ONLY}.json`));
      fs.mkdirSync(path.join(dir, "briefs", `${EN_ONLY}.json`));
      fs.rmSync(path.join(dir, "glossary.json"));
      fs.symlinkSync(path.join(dir, "corrections.json"), path.join(dir, "glossary.json"));
    });
    const content = load(dir);
    expect(content.skipped).toEqual([
      { file: `briefs/${EN_ONLY}.json`, codes: ["FILE_LAYOUT"] },
      { file: "glossary.json", codes: ["FILE_LAYOUT"] },
      { file: `metrics/${BILINGUAL}.json`, codes: ["SCHEMA"] },
      { file: `status/${DATA_ONLY}.json`, codes: ["SCHEMA"] },
    ]);
    expect(ids(content)).toEqual([PROTEIN, LIGHT]);
    expect(dates(content)).toEqual([BILINGUAL, DATA_ONLY]);
    expect(content.terms).toEqual([]);
    expect(content.corrections).toEqual(clean.corrections);
  });

  describe("an issue at a path that is a file's bare path, or only looks like one", () => {
    const EVERY_FILE = [
      BRIEF, FINDING, `metrics/${BILINGUAL}.json`, `status/${BILINGUAL}.json`, "state/pace-weekly.json", "glossary.json", "corrections.json", "reports.json", "archive-index.json",
    ];

    it("is that file's own, and the file is never read a second time", () => {
      const dir = folder();
      const reads = trackReads(dir);
      const planted = EVERY_FILE.map((file): Planted => ["XREF", file]) as [Planted, ...Planted[]];
      const content = load(dir, { rules: [plant(...planted)] });
      expect(content.skipped).toEqual([]);
      expectSameExcept(content, clean);
      expect(content.warnings).toEqual([...EVERY_FILE].sort().map((file) => ({ file, codes: ["XREF"] })));
      // The validator reads each file once, and the loader once more.
      for (const file of EVERY_FILE) expect(reads().filter((r) => r === file), file).toHaveLength(2);
    });

    it("leaves the file out for a safety code at its bare path, as for a code at its (file)", () => {
      const LEFT_OUT = [
        [BRIEF, "briefs", dates, [EN_ONLY, DATA_ONLY]],
        [FINDING, "findings", ids, [PROTEIN, LIGHT]],
        [`metrics/${BILINGUAL}.json`, "metrics", (c: Content) => c.metrics.map((m) => m.date), [EN_ONLY, DATA_ONLY]],
        ["glossary.json", "terms", (c: Content) => c.terms, []],
        ["corrections.json", "corrections", (c: Content) => c.corrections, []],
        ["reports.json", "reports", (c: Content) => c.reports, []],
      ] as const;
      for (const [file, list, left, expected] of LEFT_OUT) {
        const content = load(folder(), { rules: [plant(["CANARY", file])] });
        expect(content.skipped, file).toEqual([{ file, codes: ["CANARY"] }]);
        expect(left(content), file).toEqual(expected);
        expectSameExcept(content, clean, list);
        expect(content.warnings).toEqual([]);
      }
    });

    it("reads only the files the validator lists: a path it names and does not list is no file, though it is one on disk", () => {
      const dir = folder();
      const reads = trackReads(dir);
      nextResult((real) => ({ ...withIssues(real, [[null, issue("XREF", "glossary.json")]]), files: real.files.filter((f) => f.file !== "glossary.json") }));
      const content = load(dir, { rules: [] });
      expect(content.terms).toEqual([]);
      expect(content.skipped).toEqual([]);
      expect(content.warnings).toEqual([{ file: "glossary.json", codes: ["XREF"] }]);
      // The validator's own run read it once, and the loader reads no more.
      expect(reads().filter((r) => r === "glossary.json")).toHaveLength(1);
      expectSameExcept(content, clean, "terms");
    });

    it("leaves a file out for BLOCKED_HOST at its bare path, which is no address field", () => {
      const content = load(folder(), { rules: [plant(["BLOCKED_HOST", FINDING, "warning"])] });
      expect(content.skipped).toEqual([{ file: FINDING, codes: ["BLOCKED_HOST"] }]);
    });

    it("is an entry of its own when no file holds the path, and reads nothing, though the path looks like a brief's or a finding's", () => {
      const content = load(folder(), { rules: [plant(["XREF", "briefs/2026-11-25.json"], ["CANARY", "findings/phys-2026-9999.json"], ["XREF", "glossary.json.bak"])] });
      expect(content.skipped).toEqual([{ file: "findings/phys-2026-9999.json", codes: ["CANARY"] }]);
      expect(content.warnings).toEqual([{ file: "briefs/2026-11-25.json", codes: ["XREF"] }, { file: "glossary.json.bak", codes: ["XREF"] }]);
      expectSameExcept(content, clean);
    });
  });

  it("lets a config that cannot be read throw its ConfigError, since that is the build's own fault and not the folder's", () => {
    loadConfigSpy.mockImplementationOnce(() => {
      throw new ConfigError([{ code: "CONFIG", severity: "error", path: "run.json", message: "made up", hint: null }]);
    });
    expect(() => loadContent(folder(), { fresh: true, rules: publishedRules, log: () => {} })).toThrow(ConfigError);
  });
});

// ── Purity, the cache and the log ────────────────────────────────────────────────────────────────

describe("loadContent(): reads and nothing else", () => {
  it("writes nothing and changes nothing in a damaged folder", () => {
    const dir = folder();
    writeRaw(dir, "notes.txt", "x");
    patchJson(dir, FINDING, (r) => { r.title.en = SEQUENCE; });
    patchJson(dir, "glossary.json", (r) => { r.terms[1].made_up_key = 1; });
    const before = snapshot(dir);
    const stats = fs.statSync(dir).mtimeMs;
    load(dir, REGISTRY);
    load(dir);
    expect(snapshot(dir)).toEqual(before);
    expect(fs.statSync(dir).mtimeMs).toBe(stats);
  });

  it("reads each file it keeps once, after the validator, and no file it leaves out", () => {
    const dir = folder();
    patchJson(dir, FINDING, (r) => { r.title.en = SEQUENCE; });
    writeRaw(dir, "notes.txt", "x");
    const everyFile = Object.keys(snapshot(dir));
    const reads = trackReads(dir);
    const content = load(dir, REGISTRY);
    expect(content.skipped.map((s) => s.file)).toEqual([FINDING, "notes.txt"]);
    const counts = new Map<string, number>();
    for (const r of reads()) counts.set(r, (counts.get(r) ?? 0) + 1);
    expect(everyFile).toEqual(expect.arrayContaining([BRIEF, FINDING, "notes.txt", "glossary.json", `metrics/inputs/${DATA_ONLY}.json`]));
    for (const rel of everyFile) {
      // The validator reads each file once; the loader reads again only a file it keeps and loads (not the inputs manifests).
      const loaded = rel !== FINDING && rel !== "notes.txt" && rel !== `metrics/inputs/${DATA_ONLY}.json`;
      expect(counts.get(rel) ?? 0, rel).toBe(rel === "notes.txt" ? 0 : loaded ? 2 : 1);
    }
  });

  it("hands the validator the resolved folder, perFile, the config and rules given, and publishing undefined", () => {
    const dir = folder();
    const relative = path.relative(process.cwd(), dir);
    load(relative);
    expect(validateSpy).toHaveBeenCalledTimes(1);
    const [calledDir, calledOptions] = validateSpy.mock.calls[0]!;
    expect(calledDir).toBe(path.resolve(dir));
    expect(calledOptions).toEqual({ perFile: true, config: CONFIG, rules: publishedRules, publishing: undefined });
    expect(calledOptions && "publishing" in calledOptions).toBe(true);
    expect(calledOptions!.publishing).toBeUndefined();
  });

  it("leaves the validator to choose its own config and rules when none are given", () => {
    const dir = folder();
    loadContent(dir, { fresh: true, log: () => {} });
    const calledOptions = validateSpy.mock.calls[0]![1]!;
    expect(calledOptions.config).toBeUndefined();
    expect(calledOptions.rules).toBeUndefined();
    expect(calledOptions.perFile).toBe(true);
  });

  it("takes the folder from contentDir() when none is given", () => {
    const dir = folder();
    process.env[VARIABLE] = dir;
    const content = loadContent(undefined, { fresh: true, config: CONFIG, rules: publishedRules, log: () => {} });
    expect(content.dir).toBe(dir);
    expect(dates(content)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
    expect(contentDir()).toBe(dir);
  });

  it("re-exports contentDir()", async () => {
    const mine = await import("@/lib/content");
    expect(mine.contentDir).toBe(contentDir);
  });
});

describe("loadContent(): the cache", () => {
  it("returns the same Content for the same folder, validating once, whichever way the folder is spelled", () => {
    const dir = folder();
    const first = loadContent(`${dir}${path.sep}.`, { config: CONFIG, rules: publishedRules, log: () => {} });
    const second = loadContent(dir, { config: CONFIG, rules: publishedRules, log: () => {} });
    const third = loadContent(path.relative(process.cwd(), dir), { config: CONFIG, rules: publishedRules, log: () => {} });
    const fourth = loadContent(`${dir}${path.sep}.${path.sep}`, { config: CONFIG, rules: publishedRules, log: () => {} });
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(fourth).toBe(first);
    expect(first.dir).toBe(`${dir}${path.sep}.`);
    expect(validateSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps one entry for each folder", () => {
    const a = folder("cache-a");
    const b = folder("cache-b");
    patchJson(b, "reports.json", (r) => { r.reports.pop(); });
    const loadedA = loadContent(a, { config: CONFIG, rules: publishedRules, log: () => {} });
    const loadedB = loadContent(b, { config: CONFIG, rules: publishedRules, log: () => {} });
    expect(loadedA).not.toBe(loadedB);
    expect(loadedA.reports).toHaveLength(2);
    expect(loadedB.reports).toHaveLength(1);
    expect(loadContent(a, { config: CONFIG, rules: publishedRules, log: () => {} })).toBe(loadedA);
    expect(loadContent(b, { config: CONFIG, rules: publishedRules, log: () => {} })).toBe(loadedB);
  });

  it("is skipped by `fresh`, which neither reads nor writes it", () => {
    const dir = folder();
    const cached = loadContent(dir, { config: CONFIG, rules: publishedRules, log: () => {} });
    patchJson(dir, "reports.json", (r) => { r.reports.pop(); });
    const fresh = load(dir);
    expect(fresh).not.toBe(cached);
    expect(fresh.reports).toHaveLength(1);
    expect(cached.reports).toHaveLength(2);
    expect(loadContent(dir, { config: CONFIG, rules: publishedRules, log: () => {} })).toBe(cached);
    expect(validateSpy).toHaveBeenCalledTimes(2);
  });

  it("does not store what a fresh load made", () => {
    const dir = folder();
    const fresh = load(dir);
    const next = loadContent(dir, { config: CONFIG, rules: publishedRules, log: () => {} });
    expect(next).not.toBe(fresh);
    expect(next).toEqual(fresh);
    expect(validateSpy).toHaveBeenCalledTimes(2);
  });
});

describe("loadContent(): the log", () => {
  /** A folder with one skipped file and one warning. */
  const damaged = (): string => folder();
  const rules = [plant(["CANARY", `${FINDING}: title.en`], ["XREF", `${BRIEF}: story.finding_id`])];

  it("hands each line of contentLogLines() to `log`, skipped files first, for each load", () => {
    const dir = damaged();
    const lines: string[] = [];
    const content = loadContent(dir, { fresh: true, config: CONFIG, rules, log: (line) => lines.push(line) });
    expect(lines).toEqual([`content: skipped ${FINDING} (CANARY)`, `content: warning ${BRIEF} (XREF)`]);
    expect(lines).toEqual(contentLogLines(content));
    loadContent(dir, { fresh: true, config: CONFIG, rules, log: (line) => lines.push(line) });
    expect(lines).toHaveLength(4);
  });

  it("prints with console.warn once for each folder in the process, when no `log` is given", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = damaged();
    loadContent(dir, { fresh: true, config: CONFIG, rules });
    expect(warn.mock.calls).toEqual([[`content: skipped ${FINDING} (CANARY)`], [`content: warning ${BRIEF} (XREF)`]]);
    loadContent(dir, { fresh: true, config: CONFIG, rules });
    loadContent(dir, { config: CONFIG, rules });
    expect(warn).toHaveBeenCalledTimes(2);
    loadContent(damaged(), { fresh: true, config: CONFIG, rules });
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("prints nothing for a folder with nothing to say, and does not count that as its one print", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = folder();
    loadContent(dir, { fresh: true, config: CONFIG, rules: publishedRules });
    expect(warn).not.toHaveBeenCalled();
    loadContent(dir, { fresh: true, config: CONFIG, rules });
    expect(warn.mock.calls).toEqual([[`content: skipped ${FINDING} (CANARY)`], [`content: warning ${BRIEF} (XREF)`]]);
  });

  it("does not use console.warn when `log` takes the lines", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadContent(folder(), { fresh: true, config: CONFIG, rules: publishedRules });
    loadContent(damaged(), { fresh: true, config: CONFIG, rules, log: () => {} });
    expect(warn).not.toHaveBeenCalled();
  });

  it("never holds the planted text, the matched text or a message", () => {
    const dir = folder();
    patchJson(dir, FINDING, (r) => { r.title.en = `${SEQUENCE} ${CANARY} ${SECRET}`; });
    patchJson(dir, BRIEF, (r) => { r.lead[0].text.en = `${BLOCKED_URL} ${SEQUENCE}`; });
    patchJson(dir, "glossary.json", (r) => { r.terms[0].en.term = SEQUENCE; });
    const lines: string[] = [];
    const content = loadContent(dir, { fresh: true, config: CONFIG, rules: RULES, log: (line) => lines.push(line) });
    expect(lines.length).toBeGreaterThan(0);
    const everything = JSON.stringify([lines, content.skipped, content.warnings, content.hiddenTerms]);
    for (const text of [SEQUENCE, CANARY, SECRET, "pastebin", "nucleotide", "planted", "lattice"]) expect(everything, text).not.toContain(text);
  });

  describe("contentLogLines()", () => {
    it("is a line for each skipped file and then one for each warning, with the codes joined by a comma and a space", () => {
      const lines = contentLogLines({
        skipped: [{ file: "briefs/2026-11-19.json", codes: ["SCHEMA"] }, { file: "glossary.json terms[2]", codes: ["CANARY", "DUAL_USE"] }],
        warnings: [{ file: "findings/x.json", codes: ["XREF", "WORDS", "COUNTS"] }],
      });
      expect(lines).toEqual([
        "content: skipped briefs/2026-11-19.json (SCHEMA)",
        "content: skipped glossary.json terms[2] (CANARY, DUAL_USE)",
        "content: warning findings/x.json (XREF, WORDS, COUNTS)",
      ]);
    });

    it("is empty when nothing was skipped or warned about", () => {
      expect(contentLogLines({ skipped: [], warnings: [] })).toEqual([]);
      expect(contentLogLines(clean)).toEqual([]);
    });
  });
});

// ── The whole registry on a folder that passes ───────────────────────────────────────────────────

describe("loadContent(): the whole registry on the base world", () => {
  it("passes every file of the stored world, so a skip in the cases above is the planted one", () => {
    const content = load(folder(), REGISTRY);
    expect(content.skipped).toEqual([]);
    expectSameExcept(content, clean);
  });
});

// ── The flows a probe rule cannot show ───────────────────────────────────────────────────────────

describe("loadContent(): the whole registry, for what the engine really does with a stored record", () => {
  it("shows a finding whose text a removed correction rewrote, with nothing skipped or warned about", () => {
    const content = load(worldDir(removedHowSure(storedWorld())), REGISTRY);
    expect(content.skipped).toEqual([]);
    expect(content.warnings).toEqual([]);
    expect(findingById(content, PROTEIN)!.explainer.how_sure).toEqual(REMOVED_TEXT);
    expect(content.corrections.at(-1)!.type).toBe("removed");
  });

  it("shows a term whose definition a removed correction rewrote, and does not hide it", () => {
    const world = storedWorld();
    const term = termOf(world, FOLDING);
    term.en.definition = REMOVED_TEXT.en;
    term.zh!.definition = REMOVED_TEXT.zh;
    addRemoval(world, { term_id: FOLDING }, "definition");
    const content = load(worldDir(world), REGISTRY);
    expect(content.skipped).toEqual([]);
    expect(content.warnings).toEqual([]);
    expect(content.terms.map((t) => t.id)).toContain(FOLDING);
    expect(content.hiddenTerms).toEqual([]);
  });

  it("leaves out a finding and a brief whose Chinese text holds the planted run, as it does for their English", () => {
    const dir = folder();
    patchJson(dir, FINDING, (r) => { r.explainer.found.zh = `${r.explainer.found.zh} ${SEQUENCE}`; });
    patchJson(dir, BRIEF, (r) => { r.lead[0].text.zh = `${r.lead[0].text.zh} ${SEQUENCE}`; });
    const content = load(dir, REGISTRY);
    expect(content.skipped).toEqual([{ file: BRIEF, codes: ["DUAL_USE"] }, { file: FINDING, codes: ["DUAL_USE"] }]);
    expect(dates(content)).toEqual([EN_ONLY, DATA_ONLY]);
    expect(ids(content)).toEqual([PROTEIN, LIGHT]);
  });

  it.each(["zh.term", "zh.official"])("hides a term whose %s holds the planted run, though it is in Chinese", (at) => {
    const dir = folder();
    patchJson(dir, "glossary.json", (r) => {
      const [side, key] = at.split(".") as [string, string];
      r.terms[2][side][key] = SEQUENCE;
    });
    const content = load(dir, REGISTRY);
    expect(content.skipped).toContainEqual({ file: "glossary.json terms[2]", codes: ["DUAL_USE"] });
    expect(content.hiddenTerms).toEqual([{ first_finding: PROTEIN, codes: ["DUAL_USE"] }]);
    expect(content.terms.map((t) => t.id)).toEqual(["lattice", "proof-assistant"]);
  });

  it("leaves a copy of a finding under another name out, and keeps the one that is named by its id", () => {
    const dir = folder();
    fs.copyFileSync(path.join(dir, FINDING), path.join(dir, "findings", "math-2026-0009.json"));
    const content = load(dir, REGISTRY);
    expect(content.skipped).toEqual([{ file: "findings/math-2026-0009.json", codes: ["FILE_LAYOUT"] }]);
    expect(ids(content)).toEqual([PROTEIN, PROOF, LIGHT]);
  });

  it("leaves a copy of a brief under another date out with DATE_MISMATCH, and keeps the one that is named by its date", () => {
    const dir = folder();
    fs.copyFileSync(path.join(dir, BRIEF), path.join(dir, "briefs", "2026-11-21.json"));
    const content = load(dir, REGISTRY);
    expect(content.skipped).toEqual([{ file: "briefs/2026-11-21.json", codes: ["DATE_MISMATCH"] }]);
    expect(dates(content)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
  });

  it("reads a content folder that is itself a link, since only what lies inside it is never followed", () => {
    const real = folder();
    const link = path.join(tempDir("link"), "content");
    fs.symlinkSync(real, link);
    const content = load(link, REGISTRY);
    expect(content.skipped).toEqual([]);
    expect(content.dir).toBe(link);
    expect({ ...content, dir: "" }).toEqual({ ...load(real, REGISTRY), dir: "" });
  });

  it("leaves out a whole folder that is a link, for it holds no file of its own", () => {
    const dir = folder();
    const other = tempDir("findings-elsewhere");
    fs.cpSync(path.join(dir, "findings"), other, { recursive: true });
    fs.rmSync(path.join(dir, "findings"), { recursive: true });
    fs.symlinkSync(other, path.join(dir, "findings"));
    const content = load(dir, REGISTRY);
    expect(content.skipped).toEqual([{ file: "findings", codes: ["FILE_LAYOUT"] }]);
    expect(content.findings).toEqual([]);
    expect(dates(content)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
    expect(findingById(content, PROOF)).toBeUndefined();
  });
});

// ── The folders the site builds from ─────────────────────────────────────────────────────────────

describe("loadContent(): the sample and the empty folder under fixtures/ (SPEC 6, 9.7)", () => {
  const SAMPLE = path.join(__dirname, "..", "fixtures", "site-content");
  const EMPTY = path.join(__dirname, "..", "fixtures", "empty-content");
  const named = (rel: string): string[] => fs.readdirSync(path.join(SAMPLE, rel)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)).sort();

  it("loads the sample whole: every file of its four folders is a record, nothing is skipped and nothing is warned about", () => {
    const content = load(SAMPLE, REGISTRY);
    expect(content.skipped).toEqual([]);
    expect(content.warnings).toEqual([]);
    expect(content.hiddenTerms).toEqual([]);
    expect(dates(content)).toEqual(named("briefs"));
    expect([...ids(content)].sort()).toEqual(named("findings"));
    expect(content.metrics.map((m) => m.date)).toEqual(named("metrics"));
    expect(content.status.map((s) => s.date)).toEqual(named("status"));
    expect(content.pace).not.toBeNull();
    expect(content.archive).not.toBeNull();
    expect(content.terms.length).toBeGreaterThan(0);
    expect(content.reports.length).toBeGreaterThan(0);
    expect(newestDate(content)).toBe(dates(content).at(-1));
  });

  it("loads the sample the same twice, and leaves it as it was", () => {
    const before = snapshot(SAMPLE);
    expect(load(SAMPLE, REGISTRY)).toEqual(load(SAMPLE, REGISTRY));
    expect(snapshot(SAMPLE)).toEqual(before);
  });

  it("loads the empty folder as nothing: every list empty, and no warning", () => {
    const content = load(EMPTY, REGISTRY);
    const nothing = load(tempDir("nothing"), REGISTRY);
    expect({ ...content, dir: "" }).toEqual({ ...nothing, dir: "" });
    // The folder holds one marker file, so that git keeps it: the validator's lister leaves a README.md at the folder's root out, so nothing is skipped.
    expect(content.skipped).toEqual([]);
    expect(content.warnings).toEqual([]);
  });
});
