// `validateAll()`, the entry point for a whole content folder (SPEC §4.12 "Stored records" and "Removed text", §6 "Content loading", §8.6
// `--all`, §8.7 publish): the folder reader (an empty or missing folder, links, special files, empty files, byte order marks, bytes that
// are not UTF-8, a folder where a file should be, a very deep path), which records each run is given, how an issue is filed under one
// file (`perFile`), which records are being published, the hidden terms, and what a fault does. The rules' own cases are in
// tests/rules-published.test.ts and the single-brief entry point's in tests/validate-published.test.ts; here each case runs a folder
// built on disk from the hand-built world of tests/helpers/stored-world.ts. Most cases run the three published rules or a probe rule,
// so another group's change cannot turn them red; the cases that run the whole registry say so.
//
// New for this project; Cyber's tests/validate-engine.test.ts at the fork commit 3ced1fb, adapted: its content-folder cases (a missing
// folder passes, a stray file is FILE_UNEXPECTED, a file that does not parse is one issue, `perFile` lists each file) are Cyber's
// pattern, here with this project's layout, its two-run structure and its reader's care with odd folders.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ConfigError, loadConfig } from "@/lib/config";
import { RULES } from "@/lib/rules";
import { publishedRules } from "@/lib/rules/published";
import { buildPublishedInput, comparePaths } from "@/lib/rules/run";
import { defineRule, error, type PublishedInput, type Rule, type ValidationIssue } from "@/lib/rules/types";
import { validateAll, type AllOptions, type AllResult } from "@/lib/validate";
import { jsonFromBytes } from "@/lib/validate-stored";
import { Correction } from "@/lib/schema/misc";
import {
  BILINGUAL, DATA_ONLY, EN_ONLY, FOLDING, LATTICE, LIGHT, MONDAY, PROOF, PROTEIN, SUNDAY, addMonday, addRemoval, addSunday, briefOn, config,
  findingOf, lz, readJson, removeTempDirs, removedHowSure, storedWorld, tempDir, termOf, worldDir, worldFiles, writeJson, writeRaw, writeWorld,
  type Json, type StoredWorld,
} from "./helpers/stored-world";

// The real config, loaded once; `loadConfig` is wrapped so a case can count its calls or make it throw, and `buildPublishedInput` so a
// case can make the engine's input fail to build.
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { ...actual, loadConfig: vi.fn(actual.loadConfig) };
});
vi.mock("@/lib/rules/run", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rules/run")>();
  return { ...actual, buildPublishedInput: vi.fn(actual.buildPublishedInput) };
});

// Each case builds a folder on disk and some run the whole registry, which takes seconds on a busy machine; vitest's 5 s default must not
// turn them red.
vi.setConfig({ testTimeout: 30_000 });

const cfg = config();
const MISSING = "bio-2026-0099";
const loadConfigSpy = vi.mocked(loadConfig);
const buildSpy = vi.mocked(buildPublishedInput);
const REAL_BUILD = buildSpy.getMockImplementation()!;

afterAll(() => {
  removeTempDirs();
});
afterEach(() => {
  loadConfigSpy.mockClear();
  buildSpy.mockClear();
  buildSpy.mockImplementation(REAL_BUILD);
  vi.restoreAllMocks();
});
beforeAll(() => {
  loadConfigSpy.mockClear();
});

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

/** Runs `validateAll()` with the real config and the three published rules, the default unless a case says otherwise. */
const check = (dir: string, over: Partial<AllOptions> = {}): AllResult => validateAll(dir, { config: cfg, rules: publishedRules, ...over });

const pathsOf = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => i.path);
const triples = (issues: readonly ValidationIssue[]): string[][] => issues.map((i) => [i.code, i.path, i.message]);
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A rule that records each input it is given and reports nothing, under the codes given. */
function probe(...codes: [string, ...string[]]): { rule: Rule; seen: PublishedInput[] } {
  const seen: PublishedInput[] = [];
  const rule = defineRule({
    code: codes,
    scope: "published",
    check: (input) => {
      if (input.mode === "published") seen.push(input);
      return [];
    },
  });
  return { rule, seen };
}

/** A rule that reports `code` at the paths `paths(input)` gives, as errors. */
const reporting = (code: string, paths: (input: PublishedInput) => string[]): Rule =>
  defineRule({ code, scope: "published", check: (input) => (input.mode === "published" ? paths(input).map((p) => error(code, p, `${code} at ${p}`)) : []) });

const SORTED_WORLD_FILES = (world: StoredWorld): string[] => worldFiles(world).map(([rel]) => rel).sort(byCodeUnit);

/** The names of a folder's files, as the reader lists them (every path under it), for a snapshot. */
function snapshot(dir: string): Record<string, string> {
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

// ── The folder ───────────────────────────────────────────────────────────────────────────────────

describe("validateAll(): a missing, empty or unusable folder", () => {
  it("passes a folder that does not exist, with no files, and reads no config", () => {
    const dir = path.join(tempDir("missing"), "not-there");
    for (const perFile of [false, true]) {
      expect(validateAll(dir, { perFile })).toEqual({ ok: true, errors: [], warnings: [], issues: [], files: [] });
    }
    expect(loadConfigSpy).not.toHaveBeenCalled();
  });

  it("passes an empty folder, with no files, and reads no config", () => {
    const dir = tempDir("empty");
    for (const perFile of [false, true]) {
      expect(validateAll(dir, { perFile })).toEqual({ ok: true, errors: [], warnings: [], issues: [], files: [] });
    }
    expect(loadConfigSpy).not.toHaveBeenCalled();
  });

  it("passes a folder that holds only what git ignores (.DS_Store), however deep, and reads no config", () => {
    const dir = tempDir("ds-store");
    writeRaw(dir, ".DS_Store", "x");
    writeRaw(dir, "briefs/.DS_Store", "x");
    writeRaw(dir, "findings/sub/.DS_Store", "x");
    expect(validateAll(dir, { perFile: true })).toEqual({ ok: true, errors: [], warnings: [], issues: [], files: [] });
    expect(loadConfigSpy).not.toHaveBeenCalled();
  });

  it("passes a folder that holds only the placeholder README.md at its root (what git keeps an empty folder by), with no files, and reads no config", () => {
    const dir = tempDir("readme-only");
    writeRaw(dir, "README.md", "# Placeholder\n");
    for (const perFile of [false, true]) {
      expect(validateAll(dir, { perFile })).toEqual({ ok: true, errors: [], warnings: [], issues: [], files: [] });
    }
    expect(loadConfigSpy).not.toHaveBeenCalled();
  });

  it("takes a path that is a file as one SCHEMA issue at (root), with no files, and reads no config", () => {
    const dir = tempDir("file-root");
    writeRaw(dir, "content.json", "{}");
    const file = path.join(dir, "content.json");
    for (const perFile of [false, true]) {
      const result = validateAll(file, { perFile });
      expect(result.ok).toBe(false);
      expect(triples(result.issues)).toEqual([["SCHEMA", "(root)", `${file} is not a folder.`]]);
      expect(result.issues[0]!.hint).toBe("Give the content folder.");
      expect(result.files).toEqual([]);
    }
    expect(loadConfigSpy).not.toHaveBeenCalled();
  });

  it("takes a folder it cannot list as one SCHEMA issue at (root), with no files, and reads no config", () => {
    const dir = worldDir(storedWorld());
    const real = fs.readdirSync;
    vi.spyOn(fs, "readdirSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p) === path.resolve(dir)) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return (real as (...args: unknown[]) => unknown)(p, ...rest);
    }) as never);
    const result = validateAll(dir, { perFile: true });
    expect(result.ok).toBe(false);
    expect(triples(result.issues)).toEqual([["SCHEMA", "(root)", `${dir} could not be read as a folder.`]]);
    expect(result.issues[0]!.hint).toBe("Check its permissions.");
    expect(result.files).toEqual([]);
    expect(loadConfigSpy).not.toHaveBeenCalled();
  });

  it("takes a subfolder it cannot list as one FILE_LAYOUT issue at that folder, and judges the rest", () => {
    const world = storedWorld();
    const dir = worldDir(world);
    const real = fs.readdirSync;
    vi.spyOn(fs, "readdirSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p) === path.join(path.resolve(dir), "state")) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return (real as (...args: unknown[]) => unknown)(p, ...rest);
    }) as never);
    const result = check(dir);
    expect(triples(result.issues)).toEqual([[
      "FILE_LAYOUT", "state: (file)", "state is a link, a special file or a folder that could not be read, not a file of content/.",
    ]]);
  });

  it("reads the config once when the folder holds anything, and not at all when it is given", () => {
    const dir = worldDir(storedWorld());
    validateAll(dir, { rules: publishedRules });
    expect(loadConfigSpy).toHaveBeenCalledTimes(1);
    loadConfigSpy.mockClear();
    validateAll(dir, { rules: publishedRules, config: cfg });
    expect(loadConfigSpy).not.toHaveBeenCalled();
    const stray = tempDir("stray-only");
    writeRaw(stray, "notes.txt", "x");
    validateAll(stray, { rules: publishedRules });
    expect(loadConfigSpy).toHaveBeenCalledTimes(1);
  });

  it("lets a bad config fail the run: the validator cannot judge without it", () => {
    const dir = worldDir(storedWorld());
    loadConfigSpy.mockImplementationOnce(() => {
      throw new ConfigError([{ code: "CONFIG_FILE", severity: "error", path: "config/journals.json", message: "is missing", hint: null }]);
    });
    expect(() => validateAll(dir, { rules: publishedRules })).toThrow(ConfigError);
  });

  it("does not write to the folder it reads", () => {
    const dir = worldDir(addMonday(addSunday(storedWorld())));
    writeRaw(dir, "README.md", "x");
    const before = snapshot(dir);
    check(dir, { perFile: true });
    validateAll(dir, { config: cfg });
    expect(snapshot(dir)).toEqual(before);
  });
});

// ── A valid folder ───────────────────────────────────────────────────────────────────────────────

describe("validateAll(): a valid folder", () => {
  it("passes the three published rules on the base world: an English-only edition, a bilingual full one and a data-only one", () => {
    const result = check(worldDir(storedWorld()));
    expect(result).toEqual({ ok: true, errors: [], warnings: [], issues: [], files: [] });
  });

  it("passes with a Sunday deep dive and a Monday review added", () => {
    expect(check(worldDir(addMonday(addSunday(storedWorld())))).issues).toEqual([]);
  });

  it("lists every file, sorted, each ok with no issues, with `perFile`", () => {
    const world = storedWorld();
    const result = check(worldDir(world), { perFile: true });
    expect(result.ok).toBe(true);
    expect(result.files.map((f) => f.file)).toEqual(SORTED_WORLD_FILES(world));
    for (const file of result.files) expect(file, file.file).toEqual({ file: file.file, ok: true, errors: [], warnings: [], issues: [] });
    expect(result.files).toHaveLength(18);
  });

  it("leaves `files` empty without `perFile`", () => {
    expect(check(worldDir(storedWorld())).files).toEqual([]);
    expect(check(worldDir(storedWorld()), { perFile: false }).files).toEqual([]);
  });

  it("ignores .DS_Store anywhere, and nothing else: a dotfile is a stray", () => {
    const dir = worldDir(storedWorld());
    writeRaw(dir, ".DS_Store", "x");
    writeRaw(dir, "briefs/.DS_Store", "x");
    writeRaw(dir, "findings/.DS_Store", "x");
    expect(check(dir).issues).toEqual([]);
    writeRaw(dir, ".gitkeep", "");
    expect(pathsOf(check(dir).issues)).toEqual([".gitkeep: (file)"]);
  });

  it("passes a metrics file of a date no brief has: only the name and the date inside it are checked", () => {
    const dir = worldDir(storedWorld());
    writeJson(dir, "metrics/2026-11-21.json", { ...readJson<Record<string, unknown>>(dir, "metrics/2026-11-20.json"), date: "2026-11-21" });
    expect(pathsOf(check(dir).issues)).toEqual([]);
  });
});

describe("validateAll(): the whole registry on the base world (these depend on the other groups' rules)", () => {
  it("passes with the registry's rules and the config read from config/, archived and as each date is published", () => {
    const dir = worldDir(storedWorld());
    for (const publishing of [undefined, EN_ONLY, BILINGUAL, DATA_ONLY]) {
      const result = validateAll(dir, publishing === undefined ? {} : { publishing });
      expect(result.issues, `publishing ${String(publishing)}`).toEqual([]);
      expect(result.ok).toBe(true);
    }
    expect(RULES.length).toBeGreaterThan(publishedRules.length);
  });

  it("holds the world with a Sunday deep dive and a Monday review to every rule too, the deep dive's short text aside", () => {
    const dir = worldDir(addMonday(addSunday(storedWorld())));
    const result = validateAll(dir, { config: cfg });
    // The Sunday brief is a stub: its deep dive is shorter than the deep dive's word budget, which is all the registry may find in it.
    expect(result.errors.filter((i) => !i.path.startsWith(`briefs/${SUNDAY}.json: deep_dive.text`)).map((i) => [i.code, i.path])).toEqual([]);
    expect(result.issues.filter((i) => ["XREF", "LANG_PARITY", "FILE_LAYOUT", "SCHEMA", "DATE_MISMATCH", "RULE_ERROR"].includes(i.code))).toEqual([]);
  });

  it("judges a record by a hype word only while it is being published, a brief, a finding and a term alike", () => {
    const world = storedWorld();
    briefOn(world, BILINGUAL).pace.sentence.en += " A revolutionary week.";
    findingOf(world, PROTEIN).explainer.found.en += " A revolutionary result.";
    termOf(world, LATTICE).en.definition += " A revolutionary idea.";
    const dir = worldDir(world);
    const hype = (publishing?: string): string[] =>
      validateAll(dir, { config: cfg, ...(publishing === undefined ? {} : { publishing }) }).errors.filter((i) => i.code === "HYPE_WORDS").map((i) => i.path);
    expect(hype()).toEqual([]);
    expect(hype(DATA_ONLY)).toEqual([]);
    expect(hype(EN_ONLY)).toEqual([`findings/${PROTEIN}.json: explainer.found.en`]);
    // PROTEIN returns on BILINGUAL with a note of that date (F-17), but only that note is being published then, not its explainer, which is frozen (F-55)
    expect(hype(BILINGUAL)).toEqual([`briefs/${BILINGUAL}.json: pace.sentence.en`, "glossary.json: terms[0].en.definition"]);
  });

  it("judges only the new text of a returning finding by a hype word: the note dated D and the rung note recorded on D, never its frozen explainer or an older entry (F-55)", () => {
    const world = storedWorld();
    // PROTEIN is first briefed on EN_ONLY and returns on BILINGUAL: its note is dated then. Its two rung entries were recorded on EN_ONLY.
    const protein = findingOf(world, PROTEIN);
    protein.explainer.found.en += " A revolutionary result.";
    protein.since_then[0]!.text.en += " A revolutionary note.";
    protein.rung_history[1]!.note!.en += " A revolutionary rung.";
    const hype = (publishing: string | undefined, dir: string): string[] =>
      validateAll(dir, { config: cfg, ...(publishing === undefined ? {} : { publishing }) }).errors.filter((i) => i.code === "HYPE_WORDS").map((i) => i.path);
    const file = `findings/${PROTEIN}.json`;
    const frozen = `${file}: explainer.found.en`;
    const note = `${file}: since_then[0].text.en`;
    const rung = `${file}: rung_history[1].note.en`;
    const dir = worldDir(world);
    expect(hype(undefined, dir)).toEqual([]);
    // first briefed on EN_ONLY: judged whole, as before
    expect(hype(EN_ONLY, dir)).toEqual([frozen, rung, note]);
    // returning on BILINGUAL: its note alone is new
    expect(hype(BILINGUAL, dir)).toEqual([note]);
    expect(hype(DATA_ONLY, dir)).toEqual([]);
    // the same word in a rung note recorded on BILINGUAL fails, and in the note it no longer does once the note is dated earlier
    protein.rung_history[1]!.recorded = BILINGUAL;
    protein.since_then[0]!.date = EN_ONLY;
    const moved = worldDir(world);
    expect(hype(BILINGUAL, moved)).toEqual([rung]);
    expect(hype(EN_ONLY, moved)).toEqual([frozen, rung, note]);
  });

  it("fails a stored finding whose how_sure is the removed text with no removed correction beside it, and passes it with one", () => {
    const world = removedHowSure(storedWorld());
    expect(validateAll(worldDir(world), { config: cfg }).issues).toEqual([]);
    world.corrections = world.corrections.filter((c) => c.type !== "removed");
    const result = validateAll(worldDir(world), { config: cfg });
    expect(result.errors.map((i) => [i.code, i.path])).toContainEqual(["WHO_SAYS", `findings/${PROTEIN}.json: explainer.how_sure.en`]);
  });
});

// ── FILE_LAYOUT ──────────────────────────────────────────────────────────────────────────────────

describe("validateAll(): the paths of the folder", () => {
  const issuesOf = (dir: string): ValidationIssue[] => check(dir).issues;

  it("reports a path outside the layout at its (file): a file at the root, in a known folder, in an unknown one, a dotfile", () => {
    const dir = worldDir(storedWorld());
    const strays = ["notes.txt", "briefs/extra/x.json", "findings/readme.md", "state/other.json", "weird/a.json", ".gitkeep", "metrics/inputs/x/y.json"];
    for (const rel of strays) writeRaw(dir, rel, "x");
    expect(pathsOf(issuesOf(dir))).toEqual(strays.map((p) => `${p}: (file)`).sort(comparePaths));
    expect(issuesOf(dir).every((i) => i.code === "FILE_LAYOUT" && i.severity === "error")).toBe(true);
  });

  it("ignores a regular file named README.md at the folder's root, and reports every other path with that name or one like it", () => {
    const dir = worldDir(storedWorld());
    writeRaw(dir, "README.md", "# Placeholder\n");
    expect(issuesOf(dir)).toEqual([]);
    const { rule, seen } = probe("XREF");
    check(dir, { rules: [rule] });
    expect(seen.at(-1)!.published.folder!.files.map((f) => f.path)).not.toContain("README.md");
    for (const name of ["README.txt", "readme.md", "Readme.md", "README.md.bak", "README.MD", "README", "READ.md", " README.md", "README.md "]) {
      const other = worldDir(storedWorld());
      writeRaw(other, name, "x");
      expect(pathsOf(issuesOf(other)), name).toEqual([`${name}: (file)`]);
    }
    for (const rel of ["findings/README.md", "briefs/README.md", "weird/README.md", "state/README.md", "metrics/inputs/README.md", "a/b/README.md"]) {
      const other = worldDir(storedWorld());
      writeRaw(other, rel, "x");
      expect(pathsOf(issuesOf(other)), rel).toEqual([`${rel}: (file)`]);
    }
  });

  it("takes a README.md at the root that is a link or a folder for what it is, not for the placeholder", () => {
    const linked = worldDir(storedWorld());
    fs.symlinkSync("glossary.json", path.join(linked, "README.md"));
    expect(triples(issuesOf(linked))).toEqual([[
      "FILE_LAYOUT", "README.md: (file)", "README.md is a link, a special file or a folder that could not be read, not a file of content/.",
    ]]);
    const folder = worldDir(storedWorld());
    writeRaw(folder, "README.md/inner.json", "{}");
    expect(pathsOf(issuesOf(folder))).toEqual(["README.md/inner.json: (file)"]);
    const emptyFolder = worldDir(storedWorld());
    fs.mkdirSync(path.join(emptyFolder, "README.md"));
    expect(issuesOf(emptyFolder)).toEqual([]);
  });

  it("reports a dated name that is not a real date, in each dated folder, without reading the file", () => {
    const dir = worldDir(storedWorld());
    const names = ["briefs/latest.json", "briefs/2026-13-45.json", "metrics/2026-02-30.json", "metrics/inputs/draft.json", "status/2026-11-24.json.tmp"];
    for (const rel of names) writeRaw(dir, rel, "{not json");
    const issues = issuesOf(dir);
    expect(pathsOf(issues)).toEqual(names.map((p) => `${p}: (file)`).sort(comparePaths));
    expect(issues.every((i) => i.code === "FILE_LAYOUT")).toBe(true);
  });

  it("reports a file in findings/ that is not named by a finding id, and a finding named by an id other than the one it holds", () => {
    const world = storedWorld();
    const dir = worldDir(world);
    writeRaw(dir, "findings/odd.json", "{}");
    fs.copyFileSync(path.join(dir, `findings/${PROOF}.json`), path.join(dir, "findings/math-2026-0777.json"));
    const issues = issuesOf(dir);
    expect(triples(issues)).toEqual([
      ["FILE_LAYOUT", "findings/math-2026-0777.json: id", `findings/math-2026-0777.json holds the finding ${PROOF}, so it must be named ${PROOF}.json.`],
      ["FILE_LAYOUT", "findings/odd.json: (file)", "findings/odd.json must be named by the finding's id, such as math-2026-0142.json."],
    ]);
  });

  it("leaves a finding whose name is not its id out of the runs, and does not call it missing: its file is there", () => {
    const world = storedWorld();
    const dir = worldDir(world);
    const light = readJson<Record<string, unknown>>(dir, `findings/${LIGHT}.json`);
    writeJson(dir, `findings/${LIGHT}.json`, { ...light, id: "phys-2026-0004" });
    const { rule, seen } = probe("DUAL_USE");
    check(dir, { rules: [rule] });
    expect(seen[seen.length - 1]!.published.findings.map((f) => f.id)).toEqual([PROTEIN, PROOF]);
    expect(seen[seen.length - 1]!.published.folder!.files.find((f) => f.path === `findings/${LIGHT}.json`)).toEqual({
      path: `findings/${LIGHT}.json`, regular: true, parsed: true, id: "phys-2026-0004",
    });
    const result = check(dir, { perFile: true });
    const entry = result.files.find((f) => f.file === `findings/${LIGHT}.json`)!;
    expect(triples(entry.issues)).toEqual([[
      "FILE_LAYOUT", "id", `findings/${LIGHT}.json holds the finding phys-2026-0004, so it must be named phys-2026-0004.json.`,
    ]]);
    expect(result.issues.map((i) => i.code)).toEqual(["FILE_LAYOUT"]);
  });

  it("reports a link, to a file or a folder, dangling or looping, and never follows it", () => {
    const dir = worldDir(storedWorld());
    fs.symlinkSync(path.join(dir, "glossary.json"), path.join(dir, "linked.json"));
    fs.symlinkSync(dir, path.join(dir, "loop"));
    fs.symlinkSync("missing-target", path.join(dir, "dangling.json"));
    fs.symlinkSync("selflink", path.join(dir, "selflink"));
    fs.symlinkSync(path.join(dir, "briefs"), path.join(dir, "briefs-link"));
    const issues = issuesOf(dir);
    expect(triples(issues).map((t) => t.slice(0, 2))).toEqual(
      ["briefs-link", "dangling.json", "linked.json", "loop", "selflink"].map((p) => ["FILE_LAYOUT", `${p}: (file)`]).sort((a, b) => comparePaths(a[1]!, b[1]!)),
    );
    expect(issues[0]!.message).toMatch(/ is a link, a special file or a folder that could not be read, not a file of content\/\.$/);
    expect(issues[0]!.hint).toBe("Delete it; content/ holds regular files only.");
  });

  it("reports a link at a name of the layout, and counts the file as missing: a link is no file", () => {
    const world = storedWorld();
    const dir = worldDir(world);
    const target = path.join(tempDir("link-target"), "brief.json");
    fs.copyFileSync(path.join(dir, `briefs/${EN_ONLY}.json`), target);
    fs.rmSync(path.join(dir, `briefs/${EN_ONLY}.json`));
    fs.symlinkSync(target, path.join(dir, `briefs/${EN_ONLY}.json`));
    const issues = issuesOf(dir);
    expect(triples(issues)).toEqual([
      ["XREF", "archive-index.json: editions[2].date", `${EN_ONLY} is listed, but briefs/${EN_ONLY}.json does not exist.`],
      ["FILE_LAYOUT", `briefs/${EN_ONLY}.json: (file)`, `briefs/${EN_ONLY}.json is a link, a special file or a folder that could not be read, not a file of content/.`],
      ["XREF", `findings/${PROTEIN}.json: briefs[0]`, `Lists ${EN_ONLY}, but briefs/${EN_ONLY}.json does not exist.`],
      ["XREF", `findings/${PROOF}.json: briefs[0]`, `Lists ${EN_ONLY}, but briefs/${EN_ONLY}.json does not exist.`],
    ]);
  });

  it("reports a named pipe without opening it (a read of one would wait for ever)", () => {
    const dir = worldDir(storedWorld());
    execFileSync("mkfifo", [path.join(dir, "pipe.json"), path.join(dir, "briefs/2026-11-25.json")]);
    expect(triples(issuesOf(dir)).map((t) => t.slice(0, 2))).toEqual([
      ["FILE_LAYOUT", "briefs/2026-11-25.json: (file)"], ["FILE_LAYOUT", "pipe.json: (file)"],
    ]);
  });

  it("takes a folder where a file should be as a missing file, and a file inside it as a stray", () => {
    const dir = worldDir(storedWorld());
    fs.rmSync(path.join(dir, `briefs/${EN_ONLY}.json`));
    fs.mkdirSync(path.join(dir, `briefs/${EN_ONLY}.json`));
    expect(pathsOf(issuesOf(dir))).toEqual([`archive-index.json: editions[2].date`, `findings/${PROTEIN}.json: briefs[0]`, `findings/${PROOF}.json: briefs[0]`]);
    writeRaw(dir, `briefs/${EN_ONLY}.json/inner.txt`, "x");
    expect(pathsOf(issuesOf(dir))).toContain(`briefs/${EN_ONLY}.json/inner.txt: (file)`);
  });

  it("keeps a name with a colon and a space whole, in the issue and in the file's own results", () => {
    const dir = worldDir(storedWorld());
    writeRaw(dir, "README: x.md", "x");
    writeRaw(dir, "a: b/c: d.json", "x");
    const result = check(dir, { perFile: true });
    expect(pathsOf(result.issues)).toEqual(["README: x.md: (file)", "a: b/c: d.json: (file)"]);
    for (const name of ["README: x.md", "a: b/c: d.json"]) {
      const entry = result.files.find((f) => f.file === name)!;
      expect(pathsOf(entry.issues), name).toEqual(["(file)"]);
    }
  });

  it("files an issue whose own path holds a colon and a space under the file in front of it, and makes no file of the rest", () => {
    const world = storedWorld();
    const odd = reporting("XREF", () => ["glossary.json: terms[0].en.definition: odd", `findings/${LIGHT}.json: title.en: x: y`, "(somewhere): odd: path"]);
    const result = check(worldDir(world), { rules: [odd], perFile: true });
    expect(result.files.map((f) => f.file)).toEqual(SORTED_WORLD_FILES(world));
    expect(pathsOf(result.files.find((f) => f.file === "glossary.json")!.issues)).toEqual(["terms[0].en.definition: odd"]);
    expect(pathsOf(result.files.find((f) => f.file === `findings/${LIGHT}.json`)!.issues)).toEqual(["title.en: x: y"]);
    expect(result.files.reduce((n, f) => n + f.issues.length, 0)).toBe(2);
    expect(result.issues).toHaveLength(3);
  });

  it("files the issue of a stray whose name begins with a real file's name under the stray, never under the real file", () => {
    const dir = worldDir(storedWorld());
    const strays = ["glossary.json: x.json", `briefs/${BILINGUAL}.json: x.json`, `findings/${LIGHT}.json: y: z.json`, "archive-index.json: copy"];
    for (const stray of strays) writeRaw(dir, stray, "x");
    const result = check(dir, { perFile: true });
    expect(pathsOf(result.issues)).toEqual(strays.map((s) => `${s}: (file)`).sort(comparePaths));
    for (const stray of strays) expect(pathsOf(result.files.find((f) => f.file === stray)!.issues), stray).toEqual(["(file)"]);
    for (const real of ["glossary.json", `briefs/${BILINGUAL}.json`, `findings/${LIGHT}.json`, "archive-index.json"]) {
      const entry = result.files.find((f) => f.file === real)!;
      expect(entry.issues, real).toEqual([]);
      expect(entry.ok, real).toBe(true);
    }
  });

  it("does not fail on a very deep path, a very long name or a name with unusual characters", () => {
    const dir = worldDir(storedWorld());
    const deep = Array.from({ length: 120 }, () => "d").join("/");
    writeRaw(dir, `${deep}/x.json`, "x");
    writeRaw(dir, `${"n".repeat(200)}.json`, "x");
    writeRaw(dir, "ünïcode 文件 [1].json", "x");
    writeRaw(dir, "with\nnewline.json", "x");
    const issues = issuesOf(dir);
    expect(issues).toHaveLength(4);
    expect(issues.every((i) => i.code === "FILE_LAYOUT")).toBe(true);
    expect(pathsOf(issues)).toContain(`${deep}/x.json: (file)`);
    expect(pathsOf(issues)).toContain("ünïcode 文件 [1].json: (file)");
  });
});

// ── Reading a file ───────────────────────────────────────────────────────────────────────────────

describe("validateAll(): a file that cannot be read", () => {
  const readingProblem = (rel: string, content: string | Uint8Array): { dir: string; result: AllResult } => {
    const dir = worldDir(storedWorld());
    writeRaw(dir, rel, content);
    return { dir, result: check(dir, { perFile: true }) };
  };
  const schemaOf = (result: AllResult): ValidationIssue[] => result.issues.filter((i) => i.code === "SCHEMA");

  it("reports an empty file as one SCHEMA issue at (file)", () => {
    const { result } = readingProblem("glossary.json", "");
    expect(triples(schemaOf(result))).toEqual([["SCHEMA", "glossary.json: (file)", "glossary.json is empty; rewrite the whole file as valid JSON."]]);
    expect(schemaOf(result)[0]!.hint).toBe("Every file of content/ is UTF-8 JSON, written by publish.");
  });

  it("reports a byte order mark, even on a file that is otherwise valid", () => {
    const dir = worldDir(storedWorld());
    const file = path.join(dir, "reports.json");
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(file)]));
    expect(triples(schemaOf(check(dir)))).toEqual([["SCHEMA", "reports.json: (file)", "reports.json starts with a byte order mark; save it as UTF-8 without one."]]);
  });

  it("tells a byte order mark from other bytes that begin like one", () => {
    const messageFor = (bytes: number[]): string[][] => triples(schemaOf(readingProblem("glossary.json", Buffer.from(bytes)).result));
    const at = (message: string): string[][] => [["SCHEMA", "glossary.json: (file)", `glossary.json ${message}`]];
    const mark = "starts with a byte order mark; save it as UTF-8 without one.";
    const notUtf8 = "is not valid UTF-8; rewrite the whole file as UTF-8 JSON.";
    const notJson = "is not valid JSON (unreadable text); rewrite the whole file as valid JSON.";
    expect(messageFor([0xef, 0xbb, 0xbf])).toEqual(at(mark));
    expect(messageFor([0xef, 0xbb, 0xbf, 0x7b, 0x7d])).toEqual(at(mark));
    // Each is a different file: the mark is the three bytes together, at the very start.
    expect(messageFor([0xef, 0xbb, 0x7b])).toEqual(at(notUtf8));
    expect(messageFor([0xef, 0xbb])).toEqual(at(notUtf8));
    expect(messageFor([0xef])).toEqual(at(notUtf8));
    expect(messageFor([0xef, 0x7b, 0xbf])).toEqual(at(notUtf8));
    expect(messageFor([0xbb, 0xbf, 0x7b])).toEqual(at(notUtf8));
    expect(messageFor([0xef, 0xbf, 0xbd])).toEqual(at(notJson));
    expect(messageFor([0x20, 0xef, 0xbb, 0xbf])).toEqual(at(notJson));
  });

  it("reports bytes that are not UTF-8, even where the JSON around them is whole", () => {
    const { result } = readingProblem("corrections.json", Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]));
    expect(triples(schemaOf(result))).toEqual([["SCHEMA", "corrections.json: (file)", "corrections.json is not valid UTF-8; rewrite the whole file as UTF-8 JSON."]]);
  });

  it("reports text that is not JSON, saying where it fails and never quoting it", () => {
    const early = readingProblem("glossary.json", '{"schema_version": 1, "terms": [');
    expect(triples(schemaOf(early.result))).toEqual([["SCHEMA", "glossary.json: (file)", "glossary.json is not valid JSON (the text ends early); rewrite the whole file as valid JSON."]]);
    const at = readingProblem("corrections.json", '{"a" 1}');
    expect(triples(schemaOf(at.result))).toEqual([["SCHEMA", "corrections.json: (file)", "corrections.json is not valid JSON (at character 5); rewrite the whole file as valid JSON."]]);
    const quoted = readingProblem("reports.json", "fakeword");
    expect(triples(schemaOf(quoted.result))).toEqual([["SCHEMA", "reports.json: (file)", "reports.json is not valid JSON (unreadable text); rewrite the whole file as valid JSON."]]);
    // A parser that quotes the text it cannot read may quote numbers: none of them is a place in the file.
    const numbers = readingProblem("reports.json", "fakeword 4096");
    expect(triples(schemaOf(numbers.result))).toEqual([["SCHEMA", "reports.json: (file)", "reports.json is not valid JSON (unreadable text); rewrite the whole file as valid JSON."]]);
  });

  it("reports a file the system will not read as one SCHEMA issue naming the error's code, or a plain error when it has none", () => {
    const dir = worldDir(storedWorld());
    const real = fs.readFileSync;
    const failing = (rel: string, thrown: unknown): void => {
      vi.spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
        if (String(p) === path.join(path.resolve(dir), rel)) throw thrown;
        return (real as (...args: unknown[]) => unknown)(p, ...rest);
      }) as never);
    };
    failing("glossary.json", Object.assign(new Error("denied"), { code: "EACCES" }));
    expect(triples(schemaOf(check(dir)))).toEqual([["SCHEMA", "glossary.json: (file)", "glossary.json could not be read (EACCES); check that it is a readable file."]]);
    vi.restoreAllMocks();
    failing("reports.json", "just a string");
    expect(triples(schemaOf(check(dir)))).toEqual([["SCHEMA", "reports.json: (file)", "reports.json could not be read (an error); check that it is a readable file."]]);
    vi.restoreAllMocks();
    failing("corrections.json", null);
    expect(triples(schemaOf(check(dir)))).toEqual([["SCHEMA", "corrections.json: (file)", "corrections.json could not be read (an error); check that it is a readable file."]]);
  });

  it("files each problem under the file it came from, with the issue at (file) in that file's own results", () => {
    const { result } = readingProblem("glossary.json", "");
    const entry = result.files.find((f) => f.file === "glossary.json")!;
    expect(entry.ok).toBe(false);
    expect(triples(entry.errors)).toEqual([["SCHEMA", "(file)", "glossary.json is empty; rewrite the whole file as valid JSON."]]);
    expect(result.files.filter((f) => !f.ok).map((f) => f.file)).toEqual(["glossary.json"]);
  });

  it("leaves an unreadable file out of the runs, so what reads it is not reported as missing", () => {
    const { result } = readingProblem("glossary.json", "");
    expect(result.issues.filter((i) => i.code === "XREF")).toEqual([]);
    const brief = readingProblem(`briefs/${BILINGUAL}.json`, "");
    expect(brief.result.issues.map((i) => i.code)).toEqual(["SCHEMA"]);
    const finding = readingProblem(`findings/${LIGHT}.json`, "");
    expect(finding.result.issues.map((i) => i.code)).toEqual(["SCHEMA"]);
    const archive = readingProblem("archive-index.json", "");
    expect(archive.result.issues.map((i) => i.code)).toEqual(["SCHEMA"]);
  });

  it("reads each of the ten kinds of file against its own schema", () => {
    const dir = worldDir(addMonday(storedWorld()));
    const files = ["briefs/2026-11-19.json", `findings/${PROTEIN}.json`, "metrics/2026-11-19.json", "metrics/inputs/2026-11-20.json", "status/2026-11-19.json",
      "state/pace-weekly.json", "glossary.json", "corrections.json", "reports.json", "archive-index.json"];
    for (const rel of files) {
      const copy = tempDir("schema-kind");
      fs.cpSync(dir, copy, { recursive: true });
      const value = readJson<Record<string, unknown>>(copy, rel);
      writeJson(copy, rel, { ...value, an_unknown_key: 1 });
      const issues = check(copy).issues.filter((i) => i.code === "SCHEMA");
      expect(triples(issues), rel).toEqual([["SCHEMA", `${rel}: an_unknown_key`, 'Unknown key "an_unknown_key"; remove it.']]);
    }
  });

  it("takes JSON that is no object as the schema's issue at (root) of the file", () => {
    const dir = worldDir(storedWorld());
    writeRaw(dir, "glossary.json", "[]");
    writeRaw(dir, "reports.json", "null");
    writeRaw(dir, `briefs/${DATA_ONLY}.json`, "5");
    expect(triples(check(dir).issues.filter((i) => i.code === "SCHEMA")).map((t) => t.slice(0, 2))).toEqual([
      ["SCHEMA", `briefs/${DATA_ONLY}.json: (root)`], ["SCHEMA", "glossary.json: (root)"], ["SCHEMA", "reports.json: (root)"],
    ]);
  });
});

// ── Dates and schemas ────────────────────────────────────────────────────────────────────────────

describe("jsonFromBytes(): the one reader of a file's bytes as JSON, shared by validateAll() and the command line (F-53)", () => {
  const WHY = {
    empty: "is empty; rewrite the whole file as valid JSON",
    mark: "starts with a byte order mark; save it as UTF-8 without one",
    notUtf8: "is not valid UTF-8; rewrite the whole file as UTF-8 JSON",
    early: "is not valid JSON (the text ends early); rewrite the whole file as valid JSON",
  } as const;
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

  it("parses the bytes of any JSON value, Chinese text and white space around it included, and gives the value", () => {
    expect(jsonFromBytes(bytes('{"a": [1, 2], "b": null}'))).toEqual({ ok: true, value: { a: [1, 2], b: null } });
    expect(jsonFromBytes(bytes("[]"))).toEqual({ ok: true, value: [] });
    expect(jsonFromBytes(bytes("0"))).toEqual({ ok: true, value: 0 });
    expect(jsonFromBytes(bytes("null"))).toEqual({ ok: true, value: null });
    expect(jsonFromBytes(bytes('  \n{"zh": "\u7bc4\u4f8b"}\n'))).toEqual({ ok: true, value: { zh: "\u7bc4\u4f8b" } });
    expect(jsonFromBytes(Buffer.from('{"k": "v"}'))).toEqual({ ok: true, value: { k: "v" } });
  });

  it("says each of the four ways a file cannot be read, with no full stop: the caller completes the sentence", () => {
    expect(jsonFromBytes(new Uint8Array())).toEqual({ ok: false, why: WHY.empty });
    expect(jsonFromBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toEqual({ ok: false, why: WHY.mark });
    expect(jsonFromBytes(Uint8Array.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]))).toEqual({ ok: false, why: WHY.notUtf8 });
    expect(jsonFromBytes(bytes('{"a":'))).toEqual({ ok: false, why: WHY.early });
    expect(jsonFromBytes(bytes('{"a" 1}'))).toEqual({ ok: false, why: "is not valid JSON (at character 5); rewrite the whole file as valid JSON" });
    expect(jsonFromBytes(bytes("undefined"))).toEqual({ ok: false, why: "is not valid JSON (unreadable text); rewrite the whole file as valid JSON" });
  });

  it("takes the mark before anything that follows it, and only as the three bytes together at the very start", () => {
    for (const rest of ["{}", "[]", "not json", ""]) expect(jsonFromBytes(Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes(rest)]))).toEqual({ ok: false, why: WHY.mark });
    for (const almost of [[0xef, 0xbb], [0xef], [0xef, 0xbb, 0x7b], [0xef, 0x7b, 0xbf], [0xbb, 0xbf, 0x7b]]) {
      expect(jsonFromBytes(Uint8Array.from(almost)), almost.join(",")).toEqual({ ok: false, why: WHY.notUtf8 });
    }
    expect(jsonFromBytes(Uint8Array.from([0x20, 0xef, 0xbb, 0xbf]))).toMatchObject({ ok: false, why: expect.stringContaining("is not valid JSON") });
  });

  it("takes an empty file before the mark, UTF-8 before JSON, and never quotes the file's text", () => {
    expect(jsonFromBytes(Uint8Array.from([0x7b, 0xff, 0x7d]))).toEqual({ ok: false, why: WHY.notUtf8 });
    const read = jsonFromBytes(bytes('{"token": SECRETWORD}'));
    expect(read.ok).toBe(false);
    expect(JSON.stringify(read)).not.toContain("SECRETWORD");
  });

  it("is what validateAll() says of a file, word for word, with the file's name in front and a full stop after", () => {
    for (const [content, why] of [
      ["", WHY.empty],
      [Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), WHY.mark],
      [Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]), WHY.notUtf8],
      ['{"schema_version": 1, "terms": [', WHY.early],
    ] as const) {
      const dir = worldDir(storedWorld());
      writeRaw(dir, "glossary.json", content);
      const issues = check(dir).issues.filter((i) => i.code === "SCHEMA");
      expect(issues.map((i) => i.message)).toEqual([`glossary.json ${why}.`]);
      expect(jsonFromBytes(typeof content === "string" ? bytes(content) : content)).toEqual({ ok: false, why });
    }
  });
});

describe("validateAll(): a file that does not hold what its name says", () => {
  /** Writes `rel` again with the date `2026-11-21` in it (and, for a brief, the metrics file of that date its schema ties to it). */
  const redate = (dir: string, rel: string): void => {
    const value = readJson<Record<string, unknown> & { pace?: Record<string, unknown> }>(dir, rel);
    const pace = rel.startsWith("briefs/") ? { pace: { ...value.pace, metrics_file: "metrics/2026-11-21.json" } } : {};
    writeJson(dir, rel, { ...value, ...pace, date: "2026-11-21" });
  };

  it("reports a dated file whose `date` is not its name as DATE_MISMATCH at its date, for each dated kind", () => {
    for (const rel of ["briefs/2026-11-19.json", "metrics/2026-11-19.json", "metrics/inputs/2026-11-20.json", "status/2026-11-19.json"]) {
      const dir = worldDir(storedWorld());
      redate(dir, rel);
      const name = path.basename(rel);
      const issues = check(dir).issues;
      expect(triples(issues), rel).toEqual([["DATE_MISMATCH", `${rel}: date`, `date is 2026-11-21 but the file is named ${name}; they must match.`]]);
      expect(issues[0]!.hint).toBe("Rename the file to the date it holds, or correct the date.");
      expect(issues[0]!.severity).toBe("error");
    }
  });

  it("leaves a brief whose date is not its name out of every run: the date it holds is no other brief's", () => {
    const world = storedWorld();
    const dir = worldDir(world);
    redate(dir, `briefs/${BILINGUAL}.json`);
    const { rule, seen } = probe("DUAL_USE");
    check(dir, { rules: [rule] });
    expect(seen.map((i) => i.published.brief?.date ?? null)).toEqual([EN_ONLY, DATA_ONLY, null]);
    expect(seen[seen.length - 1]!.published.folder!.briefs.map((b) => b.date)).toEqual([EN_ONLY, DATA_ONLY]);
    // The file exists and was read, so nothing that names its edition says it is missing.
    expect(check(dir).issues.map((i) => i.code)).toEqual(["DATE_MISMATCH"]);
  });

  it("files a mismatch under the file, in the file's own results, at `date`", () => {
    const dir = worldDir(storedWorld());
    redate(dir, "status/2026-11-19.json");
    const result = check(dir, { perFile: true });
    const entry = result.files.find((f) => f.file === "status/2026-11-19.json")!;
    expect(triples(entry.issues)).toEqual([["DATE_MISMATCH", "date", "date is 2026-11-21 but the file is named 2026-11-19.json; they must match."]]);
    expect(result.files.filter((f) => !f.ok).map((f) => f.file)).toEqual(["status/2026-11-19.json"]);
  });

  it("does not read a date out of a file that fails its schema, and the schema's issues come with the file in front", () => {
    const dir = worldDir(storedWorld());
    const value = readJson<Record<string, unknown>>(dir, `briefs/${BILINGUAL}.json`);
    delete value.pace;
    value.date = "2026-11-21";
    value.extra_key = 1;
    writeJson(dir, `briefs/${BILINGUAL}.json`, value);
    expect(triples(check(dir).issues)).toEqual([
      ["SCHEMA", `briefs/${BILINGUAL}.json: extra_key`, 'Unknown key "extra_key"; remove it.'],
      ["SCHEMA", `briefs/${BILINGUAL}.json: pace`, "Missing key (expected object)."],
    ]);
  });

  it("keeps a brief that fails its schema out of the runs, and says nothing of what it would have named", () => {
    const dir = worldDir(storedWorld());
    const value = readJson<Record<string, unknown>>(dir, `briefs/${BILINGUAL}.json`);
    writeJson(dir, `briefs/${BILINGUAL}.json`, { ...value, story: 5 });
    const { rule, seen } = probe("DUAL_USE");
    check(dir, { rules: [rule] });
    expect(seen.map((i) => i.published.brief?.date ?? null)).toEqual([EN_ONLY, DATA_ONLY, null]);
    expect(check(dir).issues.map((i) => [i.code, i.path])).toEqual([["SCHEMA", `briefs/${BILINGUAL}.json: story`]]);
  });

  it("keeps a finding that fails its schema out of the runs: it is not given to the rules, and is not missing", () => {
    const dir = worldDir(storedWorld());
    const value = readJson<Record<string, unknown>>(dir, `findings/${LIGHT}.json`);
    writeJson(dir, `findings/${LIGHT}.json`, { ...value, significance: "huge" });
    const { rule, seen } = probe("DUAL_USE");
    check(dir, { rules: [rule] });
    expect(seen[seen.length - 1]!.published.findings.map((f) => f.id)).toEqual([PROTEIN, PROOF]);
    const issues = check(dir).issues;
    expect(issues.map((i) => i.code)).toEqual(["SCHEMA"]);
    expect(issues[0]!.path).toBe(`findings/${LIGHT}.json: significance`);
  });
});

// ── Which records each run is given ──────────────────────────────────────────────────────────────

describe("validateAll(): what each run is given", () => {
  const runs = (world: StoredWorld, over: Partial<AllOptions> = {}, codes: [string, ...string[]] = ["DUAL_USE"]): PublishedInput[] => {
    const { rule, seen } = probe(...codes);
    check(worldDir(world), { rules: [rule], ...over });
    return seen;
  };

  it("runs each brief with the findings it names, oldest brief first, then one run over every record", () => {
    const seen = runs(storedWorld());
    expect(seen.map((i) => i.published.brief?.date ?? null)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY, null]);
    expect(seen.map((i) => i.date)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY, DATA_ONLY]);
  });

  it("gives a brief's run the findings it names in id order and the terms they list, with every correction and report, and no folder", () => {
    const seen = runs(storedWorld());
    const [first, second, third] = seen;
    expect(first!.published.findings.map((f) => f.id)).toEqual([PROTEIN, PROOF]);
    expect(first!.published.terms.map((t) => t.id)).toEqual(["proof-assistant", "protein-folding"]);
    expect(second!.published.findings.map((f) => f.id)).toEqual([PROTEIN, LIGHT]);
    expect(second!.published.terms.map((t) => t.id)).toEqual(["lattice", "protein-folding"]);
    expect(third!.published.findings.map((f) => f.id)).toEqual([LIGHT]);
    expect(third!.published.terms.map((t) => t.id)).toEqual(["lattice"]);
    for (const input of [first!, second!, third!]) {
      expect(input.published.corrections.map((c) => c.id)).toEqual(["C-0001"]);
      expect(input.published.reports.map((r) => r.id)).toEqual(["R-0001", "R-0002"]);
      expect(input.published.folder).toBeUndefined();
      expect(input.config).toBe(cfg);
      expect(input.fileDate).toBeNull();
    }
  });

  it("names a finding by every part of a brief that names one, not only the ones that show it", () => {
    const world = storedWorld();
    // The data-only edition names LIGHT through its rung change alone.
    expect(briefOn(world, DATA_ONLY).story).toBeNull();
    expect(runs(world)[2]!.published.findings.map((f) => f.id)).toEqual([LIGHT]);
    const empty = storedWorld();
    briefOn(empty, DATA_ONLY).rung_changes = [];
    briefOn(empty, DATA_ONLY).lead = [];
    expect(runs(empty)[2]!.published.findings).toEqual([]);
  });

  it("gives the run over every record all findings in id order, all terms, corrections and reports, and the folder's facts, with no brief", () => {
    const world = storedWorld();
    const records = runs(world).at(-1)!;
    expect(records.published.brief).toBeNull();
    expect(records.published.publishing).toBe(false);
    expect(records.published.findings.map((f) => f.id)).toEqual([PROTEIN, PROOF, LIGHT]);
    expect(records.published.terms.map((t) => t.id)).toEqual(["lattice", "proof-assistant", "protein-folding"]);
    expect(records.published.corrections.map((c) => c.id)).toEqual(["C-0001"]);
    expect(records.published.reports.map((r) => r.id)).toEqual(["R-0001", "R-0002"]);
    const folder = records.published.folder!;
    expect(folder.files.map((f) => f.path)).toEqual(SORTED_WORLD_FILES(world));
    expect(folder.files.every((f) => f.regular && f.parsed)).toBe(true);
    expect(folder.files.filter((f) => f.id !== null).map((f) => [f.path, f.id])).toEqual([
      [`findings/${PROTEIN}.json`, PROTEIN], [`findings/${PROOF}.json`, PROOF], [`findings/${LIGHT}.json`, LIGHT],
    ]);
    expect(folder.briefs.map((b) => b.date)).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY]);
    expect(folder.archive).toEqual(world.archive);
    expect([...folder.hiddenTerms]).toEqual([]);
    expect(records.config).toBe(cfg);
  });

  it("gives the run over every record the findings in id order (year, number, then field), not in the order of their file names", () => {
    const world = storedWorld();
    const extra = structuredClone(findingOf(world, PROTEIN));
    extra.id = "bio-2026-0004";
    world.findings.push(extra);
    expect(runs(world).at(-1)!.published.findings.map((f) => f.id)).toEqual([PROTEIN, PROOF, LIGHT, "bio-2026-0004"]);
  });

  it("marks what each path of the folder is: a file that parsed, a stray, a file that failed its schema, a link", () => {
    const world = storedWorld();
    const dir = worldDir(world);
    writeRaw(dir, "notes.txt", "x");
    writeJson(dir, "reports.json", { schema_version: 1, reports: "none" });
    fs.symlinkSync("glossary.json", path.join(dir, "glossary-link.json"));
    const { rule, seen } = probe("XREF");
    check(dir, { rules: [rule] });
    const files = Object.fromEntries(seen.at(-1)!.published.folder!.files.map((f) => [f.path, [f.regular, f.parsed, f.id]]));
    expect(files["notes.txt"]).toEqual([true, false, null]);
    expect(files["reports.json"]).toEqual([true, false, null]);
    expect(files["glossary-link.json"]).toEqual([false, false, null]);
    expect(files["glossary.json"]).toEqual([true, true, null]);
    expect(files[`findings/${LIGHT}.json`]).toEqual([true, true, LIGHT]);
    expect(seen.at(-1)!.published.reports).toEqual([]);
  });

  it("gives the archive index as the file holds it, and null when it is missing or fails its schema", () => {
    const world = storedWorld();
    const missing = worldDir(world);
    fs.rmSync(path.join(missing, "archive-index.json"));
    const { rule, seen } = probe("XREF");
    check(missing, { rules: [rule] });
    expect(seen.at(-1)!.published.folder!.archive).toBeNull();
    const bad = worldDir(world);
    writeJson(bad, "archive-index.json", { schema_version: 1, editions: "none", urls: {} });
    const again = probe("XREF");
    check(bad, { rules: [again.rule] });
    expect(again.seen.at(-1)!.published.folder!.archive).toBeNull();
  });

  it("dates the run over every record by the date given, else the newest date a record carries, else a fixed one", () => {
    const world = storedWorld();
    expect(runs(world, { publishing: "2026-12-31" }).at(-1)!.date).toBe("2026-12-31");
    expect(runs(world).at(-1)!.date).toBe(DATA_ONLY);
    const withFinding = storedWorld();
    findingOf(withFinding, PROOF).updated = "2026-12-01";
    expect(runs(withFinding).at(-1)!.date).toBe("2026-12-01");
    const withTerm = storedWorld();
    termOf(withTerm, FOLDING).first_date = "2026-12-02";
    expect(runs(withTerm).at(-1)!.date).toBe("2026-12-02");
    const withCorrection = storedWorld();
    withCorrection.corrections[0] = Correction.parse({ ...withCorrection.corrections[0]!, date: "2026-12-03" });
    expect(runs(withCorrection).at(-1)!.date).toBe("2026-12-03");
    const withBrief = addMonday(storedWorld());
    expect(runs(withBrief).at(-1)!.date).toBe(MONDAY);
    const strays = tempDir("dates");
    writeRaw(strays, "notes.txt", "x");
    const { rule, seen } = probe("DUAL_USE");
    check(strays, { rules: [rule] });
    expect(seen.map((i) => [i.published.brief, i.date])).toEqual([[null, "2000-01-01"]]);
  });

  it("does not take a date from a file that was left out, a file that failed its schema included", () => {
    const world = storedWorld();
    const dir = worldDir(world);
    const value = readJson<Record<string, unknown>>(dir, `findings/${LIGHT}.json`);
    writeJson(dir, `findings/${LIGHT}.json`, { ...value, updated: "2027-01-01", significance: "huge" });
    const { rule, seen } = probe("DUAL_USE");
    check(dir, { rules: [rule] });
    expect(seen.at(-1)!.date).toBe(DATA_ONLY);
  });

  it("runs a rule on a brief or on the records according to its codes: a rule with any cross-file code runs once, on the records", () => {
    const world = storedWorld();
    const kinds: [string, ...string[]][] = [["XREF"], ["LANG_PARITY"], ["FILE_LAYOUT"], ["DUAL_USE", "XREF"], ["COUNTS", "LANG_PARITY"], ["WORDS", "FILE_LAYOUT"]];
    for (const codes of kinds) {
      const seen = runs(world, {}, codes);
      expect(seen.map((i) => i.published.brief), codes.join(",")).toEqual([null]);
    }
    for (const codes of [["DUAL_USE"], ["DUAL_USE", "BLOCKED_HOST"], ["SOURCE_URL"]] as [string, ...string[]][]) {
      expect(runs(world, {}, codes).map((i) => i.published.brief?.date ?? null), codes.join(",")).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY, null]);
    }
  });

  it("runs the rules it is given and no others: none gives no issues but the reader's, and a rule of another mode is skipped", () => {
    const dir = worldDir(storedWorld());
    writeRaw(dir, "notes.txt", "x");
    const none = check(dir, { rules: [] });
    expect(none.issues).toEqual([]);
    expect(none.ok).toBe(true);
    const draftOnly = defineRule({ code: "COUNTS", scope: "draft", check: () => [error("COUNTS", "x", "never")] });
    expect(check(dir, { rules: [draftOnly] }).issues).toEqual([]);
    expect(pathsOf(check(dir).issues)).toEqual(["notes.txt: (file)"]);
  });

  it("runs the registry's rules when it is given no `rules`", () => {
    const dir = worldDir(storedWorld());
    writeRaw(dir, "notes.txt", "x");
    expect(pathsOf(validateAll(dir, { config: cfg }).issues)).toEqual(["notes.txt: (file)"]);
  });
});

describe("validateAll(): the findings a brief's run keeps", () => {
  it("keeps only an issue at the brief's own file, at a finding the brief names, or at no file, from a brief's run", () => {
    // The rule reports in a brief's run only, at one path of each kind.
    const rule = reporting("DUAL_USE", (input) => {
      const brief = input.published.brief;
      if (brief === null) return [];
      return [
        `briefs/${brief.date}.json: pace.sentence.en`, `briefs/${EN_ONLY}.json: status_note.en`, `findings/${LIGHT}.json: title.en`, `findings/${PROOF}.json: title.en`,
        "glossary.json: terms[0].en.definition", "corrections.json: corrections[0].after.en", "reports.json: reports[0].reason.en", "(rule X)", "archive-index.json: editions[0].date",
      ];
    });
    const result = check(worldDir(storedWorld()), { rules: [rule] });
    // EN_ONLY names PROTEIN and PROOF, BILINGUAL names PROTEIN and LIGHT, DATA_ONLY names LIGHT; each brief keeps its own file and no other brief's.
    expect(pathsOf(result.issues)).toEqual([
      "(rule X)",
      `briefs/${EN_ONLY}.json: pace.sentence.en`, `briefs/${EN_ONLY}.json: status_note.en`,
      `briefs/${BILINGUAL}.json: pace.sentence.en`,
      `briefs/${DATA_ONLY}.json: pace.sentence.en`,
      `findings/${PROOF}.json: title.en`, `findings/${LIGHT}.json: title.en`,
    ]);
  });

  it("files a record by its place in the whole list: a term's index is its place in the glossary, not in a brief's shorter list", () => {
    // Each brief's run holds only the terms its findings list, so `terms[0]` there is another term than the glossary's first.
    const rule = reporting("DUAL_USE", (input) => input.published.terms.map((t, i) => `glossary.json: terms[${i}].en.definition ${t.id}`));
    const seen = check(worldDir(storedWorld()), { rules: [rule] }).issues;
    expect(pathsOf(seen)).toEqual([
      "glossary.json: terms[0].en.definition lattice", "glossary.json: terms[1].en.definition proof-assistant", "glossary.json: terms[2].en.definition protein-folding",
    ]);
  });
});

// ── Hidden terms ─────────────────────────────────────────────────────────────────────────────────

describe("validateAll(): terms hidden for their own name", () => {
  const second = (world: StoredWorld, flags: Rule): ReadonlySet<string> => {
    const first = probe("XREF");
    const parity = probe("LANG_PARITY");
    check(worldDir(world), { rules: [flags, first.rule, parity.rule] });
    expect([...first.seen.at(-1)!.published.folder!.hiddenTerms]).toEqual([]);
    return parity.seen.at(-1)!.published.folder!.hiddenTerms;
  };
  const flagging = (code: string, ...paths: string[]): Rule => reporting(code, (input) => (input.published.folder === undefined ? [] : paths));

  it("gives LANG_PARITY the terms whose own name a safety rule flagged in the same run, and the other rules none", () => {
    const hidden = second(storedWorld(), flagging("DUAL_USE", "glossary.json: terms[1].id", "glossary.json: terms[2].en.definition"));
    expect([...hidden]).toEqual(["proof-assistant"]);
    const blocked = second(storedWorld(), flagging("BLOCKED_HOST", "glossary.json: terms[0].zh.official_url", "glossary.json: terms[2].zh.term"));
    expect([...blocked].sort()).toEqual(["lattice", "protein-folding"]);
  });

  it("hides a term for a flag in its name only: not for its definition, or for any other code", () => {
    expect([...second(storedWorld(), flagging("DUAL_USE", "glossary.json: terms[0].en.definition", "glossary.json: terms[1].zh.definition"))]).toEqual([]);
    expect([...second(storedWorld(), flagging("SOURCE_URL", "glossary.json: terms[0].id"))]).toEqual([]);
    expect([...second(storedWorld(), flagging("SECRET_LIKE", "glossary.json: terms[0].id"))]).toEqual([]);
  });

  it("hides a term whether the flag is an error or, for a record already published, a warning", () => {
    const world = storedWorld();
    const flag = flagging("DUAL_USE", "glossary.json: terms[0].id");
    expect([...second(world, flag)]).toEqual(["lattice"]);
    const parity = probe("LANG_PARITY");
    const result = check(worldDir(world), { rules: [flag, parity.rule], publishing: BILINGUAL });
    expect(result.errors.map((i) => i.code)).toEqual(["DUAL_USE"]);
    expect([...parity.seen.at(-1)!.published.folder!.hiddenTerms]).toEqual(["lattice"]);
    const archived = probe("LANG_PARITY");
    const warned = check(worldDir(world), { rules: [flag, archived.rule], publishing: EN_ONLY });
    expect(warned.warnings.map((i) => i.code)).toEqual(["DUAL_USE"]);
    expect([...archived.seen.at(-1)!.published.folder!.hiddenTerms]).toEqual(["lattice"]);
  });

  it("asks no Chinese of a hidden term, and asks it again of a term no safety rule flagged", () => {
    const world = storedWorld();
    termOf(world, LATTICE).zh = null;
    const asked = check(worldDir(world));
    expect(triples(asked.issues).map((t) => t.slice(0, 2))).toEqual([["LANG_PARITY", "glossary.json: terms[0].zh"]]);
    const hidden = check(worldDir(world), { rules: [...publishedRules, flaggingRule("DUAL_USE", "glossary.json: terms[0].id")] });
    expect(hidden.issues.map((i) => i.code)).toEqual(["DUAL_USE"]);
    const other = check(worldDir(world), { rules: [...publishedRules, flaggingRule("DUAL_USE", "glossary.json: terms[1].id")] });
    expect(other.issues.map((i) => i.code).sort()).toEqual(["DUAL_USE", "LANG_PARITY"]);
  });

  it("runs LANG_PARITY once, after every other rule, and runs a world's rules once each when none reads parity", () => {
    const order: string[] = [];
    const tagged = (code: string): Rule => defineRule({ code, scope: "published", check: (input) => { if (input.mode === "published" && input.published.brief === null) order.push(code); return []; } });
    check(worldDir(storedWorld()), { rules: [tagged("LANG_PARITY"), tagged("XREF"), tagged("FILE_LAYOUT"), tagged("DUAL_USE")] });
    expect(order).toEqual(["XREF", "FILE_LAYOUT", "DUAL_USE", "LANG_PARITY"]);
    const none: string[] = [];
    const quiet = defineRule({ code: "XREF", scope: "published", check: () => { none.push("x"); return []; } });
    expect(check(worldDir(storedWorld()), { rules: [quiet] }).issues).toEqual([]);
    expect(none).toHaveLength(1);
  });
});

/** A rule that reports `code` at `paths`, in the run over every record only. */
function flaggingRule(code: string, ...paths: string[]): Rule {
  return reporting(code, (input) => (input.published.folder === undefined ? [] : paths));
}

// ── The records being published ──────────────────────────────────────────────────────────────────

describe("validateAll(): the records being published", () => {
  const severities = (world: StoredWorld, publishing: string | undefined, rule: Rule): Record<string, string> => {
    const result = check(worldDir(world), { rules: [rule], ...(publishing === undefined ? {} : { publishing }) });
    return Object.fromEntries(result.issues.map((i) => [i.path, i.severity]));
  };
  /**
   * One safety issue at each kind of record, in the run it belongs to. PROTEIN is first briefed on EN_ONLY and returns on BILINGUAL with a
   * note of that date, which makes that note the only text of it being published then (F-55); PROOF is briefed on EN_ONLY and never changes
   * again; LIGHT is first briefed on BILINGUAL and returns on DATA_ONLY with a rung entry and a source of that date.
   */
  const safety = (code: string): Rule => reporting(code, (input) => {
    const brief = input.published.brief;
    if (brief !== null) return [`briefs/${brief.date}.json: pace.sentence.en`];
    return [
      `findings/${LIGHT}.json: title.en`, `findings/${PROTEIN}.json: title.en`, `findings/${PROOF}.json: title.en`,
      "glossary.json: terms[0].en.definition", "glossary.json: terms[1].en.definition",
      "corrections.json: corrections[0].after.en", "reports.json: reports[0].reason.en", "reports.json: reports[1].reason.en",
    ];
  });

  it("makes the safety codes errors at the records of the date being published and warnings at every other", () => {
    for (const code of ["DUAL_USE", "BLOCKED_HOST", "SOURCE_URL"]) {
      expect(severities(storedWorld(), BILINGUAL, safety(code)), code).toEqual({
        [`briefs/${EN_ONLY}.json: pace.sentence.en`]: "warning",
        [`briefs/${BILINGUAL}.json: pace.sentence.en`]: "error",
        [`briefs/${DATA_ONLY}.json: pace.sentence.en`]: "warning",
        [`findings/${PROTEIN}.json: title.en`]: "warning",
        [`findings/${PROOF}.json: title.en`]: "warning",
        [`findings/${LIGHT}.json: title.en`]: "error",
        "glossary.json: terms[0].en.definition": "error",
        "glossary.json: terms[1].en.definition": "warning",
        "corrections.json: corrections[0].after.en": "error",
        "reports.json: reports[0].reason.en": "error",
        "reports.json: reports[1].reason.en": "warning",
      });
    }
  });

  it("makes the safety codes errors at the new text of a returning finding alone, and warnings at the rest of it (F-55)", () => {
    // PROTEIN returns on BILINGUAL with a note of that date; LIGHT, first briefed on BILINGUAL, returns on DATA_ONLY with a rung entry and a source of that date
    const protein = ["title.en", "explainer.found.en", "since_then[0].text.en", "since_then[0].text.zh", "rung_history[1].note.en", "sources[0].url", "sources[0].title"];
    const light = [
      "title.en", "explainer.found.zh", "figure.alt.en", "ai.evidence[0].quote", "rung_history[0].note.en", "rung_history[1].note.en", "rung_history[1].note.zh",
      "sources[0].url", "sources[0].title", "sources[1].url", "sources[1].title",
    ];
    const at = (code: string): Rule => reporting(code, (input) => (input.published.brief !== null ? [] : [
      ...protein.map((p) => `findings/${PROTEIN}.json: ${p}`), ...light.map((p) => `findings/${LIGHT}.json: ${p}`),
    ]));
    for (const code of ["DUAL_USE", "BLOCKED_HOST", "SOURCE_URL"]) {
      const on = (date: string, id: string): Record<string, string> =>
        Object.fromEntries(Object.entries(severities(storedWorld(), date, at(code))).filter(([p]) => p.startsWith(`findings/${id}.json: `)).map(([p, v]) => [p.split(": ")[1]!, v]));
      // on BILINGUAL: PROTEIN's note is new, the rest of it is not; LIGHT is first briefed, so it is judged whole
      expect(on(BILINGUAL, PROTEIN), code).toEqual({
        "title.en": "warning", "explainer.found.en": "warning", "since_then[0].text.en": "error", "since_then[0].text.zh": "error", "rung_history[1].note.en": "warning",
        "sources[0].url": "warning", "sources[0].title": "warning",
      });
      expect(Object.values(on(BILINGUAL, LIGHT)).every((v) => v === "error"), code).toBe(true);
      // on DATA_ONLY: LIGHT returns, and the rung entry and the source of that date are the new text
      expect(on(DATA_ONLY, LIGHT), code).toEqual({
        "title.en": "warning", "explainer.found.zh": "warning", "figure.alt.en": "warning", "ai.evidence[0].quote": "warning", "rung_history[0].note.en": "warning",
        "rung_history[1].note.en": "error", "rung_history[1].note.zh": "error", "sources[0].url": "warning", "sources[0].title": "warning", "sources[1].url": "error", "sources[1].title": "error",
      });
      expect(Object.values(on(DATA_ONLY, PROTEIN)).every((v) => v === "warning"), code).toBe(true);
    }
  });

  it("makes them warnings everywhere when no date is being published, and errors for the date of the brief that is", () => {
    for (const severity of Object.values(severities(storedWorld(), undefined, safety("DUAL_USE")))) expect(severity).toBe("warning");
    expect(severities(storedWorld(), EN_ONLY, safety("DUAL_USE"))).toMatchObject({
      [`briefs/${EN_ONLY}.json: pace.sentence.en`]: "error", [`briefs/${BILINGUAL}.json: pace.sentence.en`]: "warning",
      [`findings/${PROTEIN}.json: title.en`]: "error", [`findings/${PROOF}.json: title.en`]: "error", [`findings/${LIGHT}.json: title.en`]: "warning",
      "glossary.json: terms[1].en.definition": "error",
      "glossary.json: terms[0].en.definition": "warning", "corrections.json: corrections[0].after.en": "warning", "reports.json: reports[0].reason.en": "warning",
    });
    expect(severities(storedWorld(), DATA_ONLY, safety("DUAL_USE"))[`briefs/${DATA_ONLY}.json: pace.sentence.en`]).toBe("error");
  });

  it("never makes SECRET_LIKE or CANARY a warning: they read no list", () => {
    for (const code of ["SECRET_LIKE", "CANARY"]) {
      for (const publishing of [undefined, BILINGUAL]) {
        for (const severity of Object.values(severities(storedWorld(), publishing, safety(code)))) expect(severity, `${code} ${String(publishing)}`).toBe("error");
      }
    }
  });

  it("makes a warning of what a list change would flag in a record already published, so the run stays ok", () => {
    const world = storedWorld();
    const archived = check(worldDir(world), { rules: [safety("BLOCKED_HOST")] });
    expect(archived.ok).toBe(true);
    expect(archived.errors).toEqual([]);
    expect(archived.warnings).toHaveLength(11);
    const published = check(worldDir(world), { rules: [safety("BLOCKED_HOST")], publishing: BILINGUAL });
    expect(published.ok).toBe(false);
    expect(published.errors).toHaveLength(5);
    expect(published.warnings).toHaveLength(6);
  });

  it("files each warning and each error under its own file in the per-file results", () => {
    const result = check(worldDir(storedWorld()), { rules: [safety("DUAL_USE")], publishing: BILINGUAL, perFile: true });
    const entry = (file: string) => result.files.find((f) => f.file === file)!;
    expect(entry(`briefs/${BILINGUAL}.json`).ok).toBe(false);
    expect(entry(`briefs/${EN_ONLY}.json`).ok).toBe(true);
    expect(entry(`briefs/${EN_ONLY}.json`).warnings).toHaveLength(1);
    expect(entry("glossary.json").errors.map((i) => i.path)).toEqual(["terms[0].en.definition"]);
    expect(entry("glossary.json").warnings.map((i) => i.path)).toEqual(["terms[1].en.definition"]);
    expect(entry("corrections.json").errors.map((i) => i.path)).toEqual(["corrections[0].after.en"]);
    expect(entry("reports.json").errors.map((i) => i.path)).toEqual(["reports[0].reason.en"]);
    expect(entry("reports.json").warnings.map((i) => i.path)).toEqual(["reports[1].reason.en"]);
    expect(entry(`findings/${LIGHT}.json`).errors).toHaveLength(1);
    expect(entry(`findings/${PROTEIN}.json`).errors).toEqual([]);
    expect(entry(`findings/${PROTEIN}.json`).warnings).toHaveLength(1);
    expect(entry(`findings/${PROOF}.json`).warnings).toHaveLength(1);
    expect(entry(`findings/${PROOF}.json`).errors).toEqual([]);
  });

  it("gives each run the sets of the date: the brief only in its own run, and each run the records it holds that the date adds", () => {
    const { rule, seen } = probe("DUAL_USE");
    check(worldDir(storedWorld()), { rules: [rule], publishing: BILINGUAL });
    const sets = seen.map((i) => ({
      brief: i.published.brief?.date ?? null, publishing: i.published.publishing, being: i.published.being.brief,
      findings: [...i.published.being.findings], terms: [...i.published.being.terms], corrections: [...i.published.being.corrections], reports: [...i.published.being.reports],
    }));
    // A brief's run holds the findings it names and the terms they list, so it sees the date's findings and terms only if it names them.
    // BILINGUAL's findings are LIGHT, first briefed on it, and PROTEIN, which returns on it with a note of that date (F-17).
    expect(sets).toEqual([
      { brief: EN_ONLY, publishing: false, being: false, findings: [PROTEIN], terms: [], corrections: ["C-0001"], reports: ["R-0001"] },
      { brief: BILINGUAL, publishing: true, being: true, findings: [PROTEIN, LIGHT], terms: ["lattice"], corrections: ["C-0001"], reports: ["R-0001"] },
      { brief: DATA_ONLY, publishing: false, being: false, findings: [LIGHT], terms: ["lattice"], corrections: ["C-0001"], reports: ["R-0001"] },
      { brief: null, publishing: false, being: false, findings: [PROTEIN, LIGHT], terms: ["lattice"], corrections: ["C-0001"], reports: ["R-0001"] },
    ]);
    const none = probe("DUAL_USE");
    check(worldDir(storedWorld()), { rules: [none.rule] });
    expect(none.seen.every((i) => !i.published.publishing && !i.published.being.brief && i.published.being.findings.size === 0 && i.published.being.parts.size === 0)).toBe(true);
    // the findings the date gave text are a run's `parts` (F-55): PROTEIN, which returns on BILINGUAL; LIGHT, first briefed on it, is judged whole
    expect(seen.map((i) => [...i.published.being.parts.keys()])).toEqual([[PROTEIN], [PROTEIN], [], [PROTEIN]]);
  });
});

// ── A date to publish that has no brief ──────────────────────────────────────────────────────────

describe("validateAll(): `publishing` names an edition whose brief must be in the folder", () => {
  const NO_BRIEF = "2026-12-31";
  const NO_BRIEF_HINT = "Pass the date of the edition publish wrote: its brief is in the folder.";
  const noBrief = (date: string): string[] => [
    "XREF", "(publishing)",
    `publishing names ${date}, but briefs/${date}.json is not in the folder, so no record is being published and each is judged as one published before.`,
  ];
  const guardOf = (result: AllResult): ValidationIssue[] => result.issues.filter((i) => i.path === "(publishing)");

  it("reports a date that no brief is named for as one XREF error at (publishing), whatever rules run", () => {
    const dir = worldDir(storedWorld());
    for (const rules of [publishedRules, [probe("XREF").rule], []]) {
      const result = check(dir, { rules, publishing: NO_BRIEF });
      expect(result.ok).toBe(false);
      expect(triples(result.errors)).toEqual([noBrief(NO_BRIEF)]);
      expect(result.warnings).toEqual([]);
      expect(result.errors[0]!.severity).toBe("error");
      expect(result.errors[0]!.hint).toBe(NO_BRIEF_HINT);
    }
  });

  it("names the date it was given, and the path of the brief that date would have", () => {
    const dir = worldDir(storedWorld());
    for (const date of ["2026-11-21", "2030-01-01", "not-a-date", "../briefs/2026-11-19"]) {
      expect(triples(guardOf(check(dir, { rules: [], publishing: date as never }))), date).toEqual([noBrief(date)]);
    }
  });

  it("reports nothing for a date whose brief is there, an edition of each kind, or for no date", () => {
    const dir = worldDir(addMonday(addSunday(storedWorld())));
    for (const publishing of [undefined, EN_ONLY, BILINGUAL, DATA_ONLY, SUNDAY, MONDAY]) {
      expect(check(dir, { rules: [], ...(publishing === undefined ? {} : { publishing }) }).issues, String(publishing)).toEqual([]);
    }
  });

  it("is not a quiet downgrade: a safety error in a folder judged for a date with no brief is a warning, and the run still fails", () => {
    const dir = worldDir(storedWorld());
    const hit = reporting("DUAL_USE", (input) => (input.published.brief === null ? [`findings/${LIGHT}.json: title.en`] : [`briefs/${input.published.brief.date}.json: pace.sentence.en`]));
    const wrong = check(dir, { rules: [hit], publishing: NO_BRIEF });
    expect(wrong.ok).toBe(false);
    expect(wrong.errors.map((i) => i.code)).toEqual(["XREF"]);
    expect(wrong.warnings.map((i) => i.code)).toEqual(["DUAL_USE", "DUAL_USE", "DUAL_USE", "DUAL_USE"]);
    const right = check(dir, { rules: [hit], publishing: BILINGUAL });
    expect(right.errors.map((i) => [i.code, i.path])).toEqual([["DUAL_USE", `briefs/${BILINGUAL}.json: pace.sentence.en`], ["DUAL_USE", `findings/${LIGHT}.json: title.en`]]);
  });

  it("takes only briefs/<date>.json for the brief: a file of that name elsewhere, or under another name, is none", () => {
    const dir = worldDir(storedWorld());
    for (const stray of [`other/briefs/${NO_BRIEF}.json`, `briefs/${NO_BRIEF}.json.bak`, `briefs/${NO_BRIEF}.JSON`, `briefs/${NO_BRIEF}`, `${NO_BRIEF}.json`]) writeRaw(dir, stray, "x");
    expect(triples(guardOf(check(dir, { rules: [], publishing: NO_BRIEF })))).toEqual([noBrief(NO_BRIEF)]);
  });

  it("is judged for a missing folder, an empty one and one that holds only what git ignores, without reading the config", () => {
    const ignored = tempDir("pub-ignored");
    writeRaw(ignored, ".DS_Store", "x");
    writeRaw(ignored, "briefs/.DS_Store", "x");
    for (const dir of [path.join(tempDir("pub-missing"), "not-there"), tempDir("pub-empty"), ignored]) {
      for (const perFile of [false, true]) {
        const result = validateAll(dir, { publishing: BILINGUAL, perFile });
        expect(result.ok, dir).toBe(false);
        expect(triples(result.issues), dir).toEqual([noBrief(BILINGUAL)]);
        expect(result.issues[0]!.hint).toBe(NO_BRIEF_HINT);
        expect(result.files).toEqual([]);
      }
    }
    expect(loadConfigSpy).not.toHaveBeenCalled();
  });

  it("adds nothing to the one issue of a root that is no folder, or that cannot be listed", () => {
    const dir = tempDir("pub-file-root");
    writeRaw(dir, "content.json", "{}");
    const file = path.join(dir, "content.json");
    expect(triples(validateAll(file, { publishing: BILINGUAL }).issues)).toEqual([["SCHEMA", "(root)", `${file} is not a folder.`]]);
    const listed = worldDir(storedWorld());
    const real = fs.readdirSync;
    vi.spyOn(fs, "readdirSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p) === path.resolve(listed)) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return (real as (...args: unknown[]) => unknown)(p, ...rest);
    }) as never);
    expect(triples(validateAll(listed, { publishing: BILINGUAL }).issues)).toEqual([["SCHEMA", "(root)", `${listed} could not be read as a folder.`]]);
    expect(loadConfigSpy).not.toHaveBeenCalled();
  });

  it("names an absent path only: a brief that is there but unusable is reported by its own issue, not as missing", () => {
    const unusable: Record<string, (dir: string) => void> = {
      empty: (dir) => writeRaw(dir, `briefs/${BILINGUAL}.json`, ""),
      "fails its schema": (dir) => writeJson(dir, `briefs/${BILINGUAL}.json`, { date: BILINGUAL }),
      "holds another date": (dir) => writeJson(dir, `briefs/${BILINGUAL}.json`, { ...readJson(dir, `briefs/${EN_ONLY}.json`) as object }),
      "is a link": (dir) => {
        const target = path.join(tempDir("pub-link-target"), "brief.json");
        fs.copyFileSync(path.join(dir, `briefs/${BILINGUAL}.json`), target);
        fs.rmSync(path.join(dir, `briefs/${BILINGUAL}.json`));
        fs.symlinkSync(target, path.join(dir, `briefs/${BILINGUAL}.json`));
      },
    };
    for (const [name, spoil] of Object.entries(unusable)) {
      const dir = worldDir(storedWorld());
      spoil(dir);
      const result = check(dir, { publishing: BILINGUAL });
      expect(guardOf(result), name).toEqual([]);
      expect(result.ok, name).toBe(false);
      expect(result.issues.some((i) => i.path.startsWith(`briefs/${BILINGUAL}.json: `)), name).toBe(true);
    }
    const gone = worldDir(storedWorld());
    fs.rmSync(path.join(gone, `briefs/${BILINGUAL}.json`));
    expect(triples(guardOf(check(gone, { rules: [], publishing: BILINGUAL })))).toEqual([noBrief(BILINGUAL)]);
    const folder = worldDir(storedWorld());
    fs.rmSync(path.join(folder, `briefs/${BILINGUAL}.json`));
    fs.mkdirSync(path.join(folder, `briefs/${BILINGUAL}.json`));
    expect(triples(guardOf(check(folder, { rules: [], publishing: BILINGUAL })))).toEqual([noBrief(BILINGUAL)]);
  });

  it("belongs to no file: the per-file results are those of the same folder with no date, and every other issue stays where it was", () => {
    const dir = worldDir(storedWorld());
    const hit = reporting("DUAL_USE", (input) => (input.published.brief === null ? [`findings/${LIGHT}.json: title.en`] : []));
    const plain = check(dir, { rules: [hit], perFile: true });
    const wrong = check(dir, { rules: [hit], perFile: true, publishing: NO_BRIEF });
    expect(wrong.files.map((f) => [f.file, f.issues.length])).toEqual(plain.files.map((f) => [f.file, f.issues.length]));
    expect(wrong.files.every((f) => f.issues.every((i) => i.path !== "(publishing)"))).toBe(true);
    expect(wrong.issues.filter((i) => i.path !== "(publishing)")).toEqual(plain.issues);
    expect(guardOf(wrong)).toHaveLength(1);
  });

  it("is the same on every run, and sorts with the other issues of a folder", () => {
    const dir = worldDir(storedWorld());
    writeRaw(dir, "notes.txt", "x");
    const first = check(dir, { publishing: NO_BRIEF });
    expect(check(dir, { publishing: NO_BRIEF })).toEqual(first);
    expect(first.issues.map((i) => i.path)).toEqual([...first.issues.map((i) => i.path)].sort(comparePaths));
    expect(first.issues.map((i) => i.path)).toContain("(publishing)");
    expect(first.issues.map((i) => i.path)).toContain("notes.txt: (file)");
  });
});

// ── A stored finding refiled by a correction ─────────────────────────────────────────────────────

describe("validateAll(): the stored corrections refile the findings (SPEC §4.10)", () => {
  it("reads each brief's findings as filed on that brief's date, from corrections.json", () => {
    const world = storedWorld();
    world.corrections.push(Correction.parse({
      id: "C-0002", date: BILINGUAL, finding_id: PROTEIN, edition_date: null, term_id: null, type: "correction", path: "significance",
      before: lz("The old value.", "舊的值。"), after: lz("notable", "新的值。"), reason: lz("It was filed wrongly.", "歸類有誤。"), source_url: null, trigger: "editor", report_id: null,
    }));
    const { rule, seen } = probe("DUAL_USE");
    check(worldDir(world), { rules: [rule] });
    const significance = seen.map((i) => i.views.findings.find((v) => v.id === PROTEIN)?.latest.significance ?? null);
    expect(significance).toEqual(["major", "notable", null, "notable"]);
    expect(seen.map((i) => i.views.findings.find((v) => v.id === PROTEIN)?.published.significance ?? null)).toEqual(["major", "major", null, "major"]);
  });
});

// ── The per-file results ─────────────────────────────────────────────────────────────────────────

describe("validateAll(): each file's own results (`perFile`)", () => {
  /** A world with one fault in a term, a correction, a report and a finding, each naming a finding that does not exist. */
  const faulty = (): StoredWorld => {
    const world = storedWorld();
    termOf(world, FOLDING).first_finding = MISSING;
    world.corrections.push(Correction.parse({ ...world.corrections[0]!, id: "C-0002", finding_id: MISSING }));
    world.reports[1] = { ...world.reports[1]!, finding_id: MISSING };
    findingOf(world, PROOF).related = [MISSING];
    return world;
  };

  it("files an issue in a glossary term, a correction and a report under its file, the path starting with the record's index", () => {
    const result = check(worldDir(faulty()), { perFile: true });
    const entry = (file: string) => result.files.find((f) => f.file === file)!;
    expect(triples(entry("glossary.json").issues)).toEqual([[
      "XREF", "terms[2].first_finding", `Names ${MISSING} as the finding that first used it, but findings/${MISSING}.json does not exist.`,
    ]]);
    expect(triples(entry("corrections.json").issues)).toEqual([[
      "XREF", "corrections[1].finding_id", `C-0002 names ${MISSING}, but findings/${MISSING}.json does not exist.`,
    ]]);
    expect(triples(entry("reports.json").issues)).toEqual([[
      "XREF", "reports[1].finding_id", `R-0002 is about ${MISSING}, but findings/${MISSING}.json does not exist.`,
    ]]);
    expect(triples(entry(`findings/${PROOF}.json`).issues)).toEqual([[
      "XREF", "related[0]", `Names ${MISSING} as related, but findings/${MISSING}.json does not exist.`,
    ]]);
    expect(result.files.filter((f) => !f.ok).map((f) => f.file)).toEqual(["corrections.json", `findings/${PROOF}.json`, "glossary.json", "reports.json"]);
  });

  it("keeps the file in front of each path in the combined issues, and the same issues in both", () => {
    const result = check(worldDir(faulty()), { perFile: true });
    expect(pathsOf(result.issues)).toEqual([
      "corrections.json: corrections[1].finding_id", `findings/${PROOF}.json: related[0]`, "glossary.json: terms[2].first_finding", "reports.json: reports[1].finding_id",
    ]);
    const perFile = result.files.flatMap((f) => f.issues.map((i) => ({ ...i, path: `${f.file}: ${i.path}` })));
    expect(perFile).toEqual(result.issues);
    expect(check(worldDir(faulty())).issues).toEqual(result.issues);
  });

  it("never files an issue under two records, nor leaves one out", () => {
    const world = faulty();
    briefOn(world, BILINGUAL).pace.sentence.zh = null;
    briefOn(world, EN_ONLY).story!.finding_id = MISSING;
    world.archive.editions.pop();
    const dir = worldDir(world);
    writeRaw(dir, "notes.txt", "x");
    const result = check(dir, { perFile: true });
    expect(result.issues.length).toBeGreaterThan(6);
    const filed = result.files.flatMap((f) => f.issues.map((i) => `${f.file}: ${i.path}|${i.code}|${i.message}`));
    expect(filed.sort()).toEqual(result.issues.map((i) => `${i.path}|${i.code}|${i.message}`).sort());
    expect(new Set(filed).size).toBe(filed.length);
  });

  it("files an issue of the archive index under it, and under it when it is missing: its entry is there though the file is not", () => {
    const world = storedWorld();
    world.archive.editions = world.archive.editions.filter((e) => e.date !== BILINGUAL);
    const dir = worldDir(world);
    const listed = check(dir, { perFile: true });
    expect(triples(listed.files.find((f) => f.file === "archive-index.json")!.issues)).toEqual([["XREF", "editions", `briefs/${BILINGUAL}.json is not listed.`]]);
    fs.rmSync(path.join(dir, "archive-index.json"));
    const missing = check(dir, { perFile: true });
    // The entry is one of the files, in code-unit order like the rest: it comes first, though the folder does not hold it.
    expect(missing.files.map((f) => f.file)).toEqual(["archive-index.json", ...SORTED_WORLD_FILES(world).filter((f) => f !== "archive-index.json")]);
    expect(triples(missing.files.find((f) => f.file === "archive-index.json")!.issues)).toEqual([["XREF", "(file)", "archive-index.json is missing but 3 briefs exist."]]);
  });

  it("splits each file's issues into errors and warnings, and is ok when it has errors of none", () => {
    const result = check(worldDir(storedWorld()), { rules: [reporting("BLOCKED_HOST", (i) => (i.published.brief === null ? ["glossary.json: terms[0].en.definition"] : []))], perFile: true });
    const glossary = result.files.find((f) => f.file === "glossary.json")!;
    expect(glossary.ok).toBe(true);
    expect(glossary.errors).toEqual([]);
    expect(glossary.warnings.map((i) => i.path)).toEqual(["terms[0].en.definition"]);
    expect(glossary.issues).toEqual(glossary.warnings);
    expect(result.ok).toBe(true);
  });

  it("lists the files in code-unit order, whatever order they were written in", () => {
    const world = storedWorld();
    const files = worldFiles(world);
    const forward = tempDir("order-forward");
    for (const [rel, value] of files) writeJson(forward, rel, value);
    const backward = tempDir("order-backward");
    for (const [rel, value] of [...files].reverse()) writeJson(backward, rel, value);
    const a = check(forward, { perFile: true });
    const b = check(backward, { perFile: true });
    expect(b).toEqual(a);
    expect(a.files.map((f) => f.file)).toEqual(SORTED_WORLD_FILES(world));
  });

  it("has no files for a missing folder or an empty one", () => {
    expect(check(path.join(tempDir("none"), "x"), { perFile: true }).files).toEqual([]);
    expect(check(tempDir("none2"), { perFile: true }).files).toEqual([]);
  });
});

// ── Cross-file facts through the folder ──────────────────────────────────────────────────────────

describe("validateAll(): what the rules that read the whole folder find", () => {
  const found = (world: StoredWorld, over: Partial<AllOptions> = {}): string[][] => triples(check(worldDir(world), over).issues);

  it("finds a brief naming a finding no file holds, at each place, and what else names it: the archive's links and the glossary term", () => {
    const world = storedWorld();
    const dir = worldDir(world);
    fs.rmSync(path.join(dir, `findings/${LIGHT}.json`));
    const issues = check(dir).issues;
    expect(pathsOf(issues)).toEqual([
      'archive-index.json: urls["https://arxiv.org/abs/2611.00003"].refs[0]',
      'archive-index.json: urls["https://nature.com/articles/nature-ut-store-0003"].refs[0]',
      `briefs/${BILINGUAL}.json: lead[0].finding_ids[0]`, `briefs/${BILINGUAL}.json: story.finding_id`,
      `briefs/${DATA_ONLY}.json: rung_changes[0].finding_id`,
      "glossary.json: terms[0].first_finding",
    ]);
  });

  it("finds a finding listing a brief that no file holds, and one that does not name it", () => {
    const world = storedWorld();
    findingOf(world, PROOF).briefs = [EN_ONLY, DATA_ONLY, "2026-11-30"];
    expect(found(world)).toEqual([
      ["XREF", `findings/${PROOF}.json: briefs[1]`, `Lists ${DATA_ONLY}, but briefs/${DATA_ONLY}.json does not name this finding.`],
      ["XREF", `findings/${PROOF}.json: briefs[2]`, "Lists 2026-11-30, but briefs/2026-11-30.json does not exist."],
    ]);
  });

  it("finds a finding shown by two briefs that lists only one", () => {
    const world = storedWorld();
    findingOf(world, PROTEIN).briefs = [EN_ONLY];
    expect(found(world)).toEqual([[
      "XREF", `findings/${PROTEIN}.json: briefs`, `Its briefs list does not have ${BILINGUAL}, but briefs/${BILINGUAL}.json shows this finding in its items.`,
    ]]);
    const both = storedWorld();
    expect(findingOf(both, PROTEIN).briefs).toEqual([EN_ONLY, BILINGUAL]);
    expect(found(both)).toEqual([]);
  });

  it("finds a stored removed correction whose path still holds other text, and passes the one whose path was rewritten", () => {
    const world = removedHowSure(storedWorld());
    expect(found(world)).toEqual([]);
    findingOf(world, PROTEIN).explainer.how_sure = lz("Other text.", "別的文字。");
    expect(found(world).map((t) => t.slice(0, 2))).toEqual([["XREF", "corrections.json: corrections[1].path"]]);
    const edition = storedWorld();
    briefOn(edition, BILINGUAL).deep_dive = null;
    addRemoval(edition, { edition_date: BILINGUAL }, "deep_dive.text");
    expect(found(edition).map((t) => t.slice(0, 2))).toEqual([["XREF", "corrections.json: corrections[1].path"]]);
  });

  it("holds an English-only edition to no Chinese, and a bilingual one to it, including the archive of what it first published", () => {
    const world = storedWorld();
    expect(briefOn(world, EN_ONLY).languages.zh).toBe(false);
    briefOn(world, EN_ONLY).pace.sentence.zh = null;
    expect(found(world)).toEqual([]);
    findingOf(world, LIGHT).explainer.found.zh = null;
    briefOn(world, DATA_ONLY).pace.sentence.zh = null;
    expect(pathsOf(check(worldDir(world)).issues)).toEqual([`briefs/${DATA_ONLY}.json: pace.sentence.zh`, `findings/${LIGHT}.json: explainer.found.zh`]);
  });

  it("reports the archive index when it is missing though briefs exist, once, and not for a folder with no brief", () => {
    const world = storedWorld();
    const dir = worldDir(world);
    fs.rmSync(path.join(dir, "archive-index.json"));
    expect(triples(check(dir).issues)).toEqual([["XREF", "archive-index.json: (file)", "archive-index.json is missing but 3 briefs exist."]]);
    const bare = tempDir("no-briefs");
    writeJson(bare, "glossary.json", { schema_version: 1, terms: [] });
    expect(check(bare).issues).toEqual([]);
  });

  it("holds each correction line of a brief to corrections.json, in a brief's own run and in the folder's", () => {
    const world = storedWorld();
    briefOn(world, BILINGUAL).corrections[0]!.id = "C-0007";
    expect(found(world)).toEqual([["XREF", `briefs/${BILINGUAL}.json: corrections[0].id`, "C-0007 is listed here, but corrections.json has no such correction."]]);
  });
});

// ── Faults ───────────────────────────────────────────────────────────────────────────────────────

describe("validateAll(): faults", () => {
  it("turns a rule that throws into one RULE_ERROR at (rule CODE), once, though the rule ran in several runs, and still runs the others", () => {
    const dir = worldDir(storedWorld());
    const thrower = defineRule({ code: "DUAL_USE", scope: "published", check: () => { throw new Error("boom"); } });
    const crossing = defineRule({ code: "XREF", scope: "published", check: () => { throw new Error("bang"); } });
    const result = check(dir, { rules: [thrower, crossing, ...publishedRules.filter((r) => r.codes[0] === "LANG_PARITY")] });
    expect(triples(result.issues)).toEqual([
      ["RULE_ERROR", "(rule DUAL_USE)", "The check DUAL_USE stopped with an error (boom) and did not finish."],
      ["RULE_ERROR", "(rule XREF)", "The check XREF stopped with an error (bang) and did not finish."],
    ]);
    expect(result.ok).toBe(false);
  });

  it("turns inputs it cannot build for a brief into one RULE_ERROR at (engine), though three briefs failed, and still judges the records", () => {
    buildSpy.mockImplementation(((brief: unknown, ...rest: unknown[]) => {
      if (brief !== null) throw new Error("no brief input");
      return (REAL_BUILD as (...args: unknown[]) => unknown)(brief, ...rest);
    }) as never);
    const broken = storedWorld();
    findingOf(broken, PROOF).related = [MISSING];
    const result = check(worldDir(broken));
    expect(result.ok).toBe(false);
    expect(triples(result.issues)).toEqual([
      ["RULE_ERROR", "(engine)", "The validator could not read its inputs (no brief input)."],
      ["XREF", `findings/${PROOF}.json: related[0]`, `Names ${MISSING} as related, but findings/${MISSING}.json does not exist.`],
    ]);
    expect(result.issues[0]!.hint).toBe("This is a fault in the validator or its inputs, not in the content: report it.");
    expect(buildSpy.mock.calls.map((call) => (call[0] === null ? null : (call[0] as { date: string }).date))).toEqual([EN_ONLY, BILINGUAL, DATA_ONLY, null]);
  });

  it("turns inputs it cannot build for the records into one RULE_ERROR at (engine), and still judges each brief", () => {
    buildSpy.mockImplementation(((brief: unknown, ...rest: unknown[]) => {
      if (brief === null) throw "a plain text";
      return (REAL_BUILD as (...args: unknown[]) => unknown)(brief, ...rest);
    }) as never);
    const perBrief = reporting("DUAL_USE", (input) => (input.published.brief === null ? [] : [`briefs/${input.published.brief.date}.json: pace.sentence.en`]));
    const result = check(worldDir(storedWorld()), { rules: [perBrief, ...publishedRules] });
    expect(triples(result.issues).map((t) => t.slice(0, 2))).toEqual([
      ["RULE_ERROR", "(engine)"], ["DUAL_USE", `briefs/${EN_ONLY}.json: pace.sentence.en`], ["DUAL_USE", `briefs/${BILINGUAL}.json: pace.sentence.en`], ["DUAL_USE", `briefs/${DATA_ONLY}.json: pace.sentence.en`],
    ]);
    expect(result.issues[0]!.message).toBe("The validator could not read its inputs (a plain text).");
    expect(result.ok).toBe(false);
  });

  it("cuts what it quotes of a fault to 200 characters", () => {
    const dir = worldDir(storedWorld());
    buildSpy.mockImplementation((() => { throw new Error("y".repeat(300)); }) as never);
    const result = check(dir);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.message).toBe(`The validator could not read its inputs (${"y".repeat(200)}).`);
  });

  it("does not throw on a folder of nothing but odd files", () => {
    const dir = tempDir("odd");
    writeRaw(dir, "briefs/2026-11-19.json", "");
    writeRaw(dir, "findings/bio-2026-0001.json", Buffer.from([0xff, 0xfe, 0xfd]));
    writeRaw(dir, "glossary.json", "﻿{}");
    writeRaw(dir, "state/pace-weekly.json", "[1,2");
    fs.symlinkSync("nowhere", path.join(dir, "reports.json"));
    const result = check(dir, { perFile: true });
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code).sort()).toEqual(["FILE_LAYOUT", "SCHEMA", "SCHEMA", "SCHEMA", "SCHEMA"]);
  });
});

// ── Order ────────────────────────────────────────────────────────────────────────────────────────

describe("validateAll(): the order of what it returns", () => {
  it("returns the issues in the engine's order: by file, then by position in it, an index numerically", () => {
    const world = storedWorld();
    world.reports[1] = { ...world.reports[1]!, finding_id: MISSING };
    for (let i = 2; i <= 12; i++) world.corrections.push(Correction.parse({ ...world.corrections[0]!, id: `C-${String(i).padStart(4, "0")}`, finding_id: MISSING }));
    findingOf(world, PROTEIN).related = [MISSING];
    briefOn(world, BILINGUAL).story!.finding_id = MISSING;
    const result = check(worldDir(world));
    const corrections = pathsOf(result.issues).filter((p) => p.startsWith("corrections.json: "));
    expect(corrections).toEqual(Array.from({ length: 11 }, (_, i) => `corrections.json: corrections[${i + 1}].finding_id`));
    expect(pathsOf(result.issues)).toEqual([...pathsOf(result.issues)].sort(comparePaths));
    expect(pathsOf(result.issues)[0]).toBe(`briefs/${BILINGUAL}.json: story.finding_id`);
    expect(pathsOf(result.issues).at(-1)).toBe("reports.json: reports[1].finding_id");
  });

  it("returns the same result run after run, and from a folder written in another order", () => {
    const world = storedWorld();
    world.reports[1] = { ...world.reports[1]!, finding_id: MISSING };
    briefOn(world, BILINGUAL).story!.finding_id = MISSING;
    const dir = worldDir(world);
    const first = check(dir, { perFile: true });
    expect(check(dir, { perFile: true })).toEqual(first);
    const reversed = tempDir("reversed");
    for (const [rel, value] of [...worldFiles(world)].reverse()) writeJson(reversed, rel, value);
    expect(check(reversed, { perFile: true })).toEqual(first);
  });

  it("is not changed by the order the rules come in", () => {
    const world = storedWorld();
    findingOf(world, PROOF).related = [MISSING];
    briefOn(world, BILINGUAL).pace.sentence.zh = null;
    const dir = worldDir(world);
    expect(check(dir, { rules: [...publishedRules].reverse() })).toEqual(check(dir));
  });
});

// ── The files a brief points at, on the sample ───────────────────────────────────────────────────

describe("validateAll(): the files a brief points at, on a copy of the sample content (F-18)", () => {
  const SAMPLE = path.join(__dirname, "..", "fixtures", "site-content");
  const DATES = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
  const DATA_ONLY_DAY = "2026-10-15";
  const copy = (): string => {
    const dir = tempDir("sample");
    fs.cpSync(SAMPLE, dir, { recursive: true });
    return dir;
  };
  /** The codes the frame and the safety rules own: what a change to which records are being published, or to XREF, could newly raise. */
  const FRAME_CODES = ["XREF", "LANG_PARITY", "FILE_LAYOUT", "SCHEMA", "DATE_MISMATCH", "DUAL_USE", "BLOCKED_HOST", "SOURCE_URL", "SECRET_LIKE", "CANARY", "RULE_ERROR"];

  it("holds a data-only edition among its seven briefs, each with a metrics file, an inputs manifest and a status file", () => {
    expect(DATES.map((d) => readJson<Record<string, unknown>>(SAMPLE, `briefs/${d}.json`).edition)).toEqual(
      ["full", "full", "full", "data_only", "full", "full", "full"],
    );
    for (const d of DATES) for (const dir of ["metrics", "metrics/inputs", "status"]) expect(fs.statSync(path.join(SAMPLE, dir, `${d}.json`)).isFile(), `${dir}/${d}`).toBe(true);
  });

  it("is clean as it stands: no XREF, and none of the frame's or the safety codes, archived and as each date is published", () => {
    const dir = copy();
    expect(check(dir, { perFile: true }).issues).toEqual([]);
    for (const publishing of [undefined, ...DATES]) {
      const result = validateAll(dir, { config: cfg, ...(publishing === undefined ? {} : { publishing }) });
      expect(result.issues.filter((i) => FRAME_CODES.includes(i.code)), String(publishing)).toEqual([]);
    }
  });

  it("is clean of every code that reads config/ too, archived and as each date is published, with the returning findings the dates give text to (F-55)", () => {
    const dir = copy();
    const CONFIG_CODES = [
      "PRIMARY_ONLY", "RUNG_EVIDENCE", "WHO_SAYS", "HYPE_WORDS", "TERM_DEFINED", "READING_LEVEL", "FIGURE_LICENCE", "SUBFIELD_UNKNOWN", "COUNTS",
      "ZH_TRADITIONAL", "ZH_AVOID", "ZH_TERMS", "ZH_CHARS", "ZH_HYPE",
    ];
    const returning: string[] = [];
    for (const publishing of [undefined, ...DATES]) {
      const result = validateAll(dir, { config: cfg, ...(publishing === undefined ? {} : { publishing }) });
      expect(result.issues.filter((i) => CONFIG_CODES.includes(i.code)), String(publishing)).toEqual([]);
      const { rule, seen } = probe("DUAL_USE");
      check(dir, { rules: [rule], ...(publishing === undefined ? {} : { publishing }) });
      for (const i of seen) for (const id of i.published.being.parts.keys()) returning.push(`${String(publishing)} ${id}`);
    }
    // the sample has returning findings that the dates give text, so the test above judged their new entries alone
    expect(returning.length).toBeGreaterThan(0);
    expect(returning.every((r) => !r.startsWith("undefined "))).toBe(true);
  });

  it("reports a missing metrics file once, at the brief that points at it, for each of the seven briefs, a data-only one included", () => {
    for (const date of DATES) {
      const dir = copy();
      fs.rmSync(path.join(dir, `metrics/${date}.json`));
      const result = check(dir, { perFile: true });
      expect(result.ok, date).toBe(false);
      expect(triples(result.issues), date).toEqual([[
        "XREF", `briefs/${date}.json: pace.metrics_file`, `metrics/${date}.json holds this edition's Pace numbers (status ok), but it does not exist.`,
      ]]);
      expect(result.files.filter((f) => !f.ok).map((f) => [f.file, f.errors.map((i) => i.path)])).toEqual([[`briefs/${date}.json`, ["pace.metrics_file"]]]);
    }
  });

  it("reports a missing status file once, at the brief's (status), for each of the seven briefs", () => {
    for (const date of DATES) {
      const dir = copy();
      fs.rmSync(path.join(dir, `status/${date}.json`));
      const result = check(dir, { perFile: true });
      expect(triples(result.issues), date).toEqual([[
        "XREF", `briefs/${date}.json: (status)`, `status/${date}.json is the status file of this edition's run, but it does not exist.`,
      ]]);
      expect(result.files.filter((f) => !f.ok).map((f) => [f.file, f.errors.map((i) => i.path)])).toEqual([[`briefs/${date}.json`, ["(status)"]]]);
    }
  });

  it("reports both files of a data-only edition, which has them, and asks nothing for its inputs manifest, which no other edition needs either", () => {
    const dir = copy();
    fs.rmSync(path.join(dir, `metrics/${DATA_ONLY_DAY}.json`));
    fs.rmSync(path.join(dir, `status/${DATA_ONLY_DAY}.json`));
    expect(pathsOf(check(dir).issues)).toEqual([`briefs/${DATA_ONLY_DAY}.json: (status)`, `briefs/${DATA_ONLY_DAY}.json: pace.metrics_file`]);
    const manifests = copy();
    for (const date of DATES) fs.rmSync(path.join(manifests, `metrics/inputs/${date}.json`));
    expect(check(manifests).issues).toEqual([]);
  });

  it("asks nothing for the metrics file of a brief whose Pace is missing, and still asks for its status file", () => {
    const dir = copy();
    const brief = readJson<Json>(dir, "briefs/2026-10-16.json");
    brief.pace.status = "missing";
    writeJson(dir, "briefs/2026-10-16.json", brief);
    fs.rmSync(path.join(dir, "metrics/2026-10-16.json"));
    expect(check(dir).issues).toEqual([]);
    fs.rmSync(path.join(dir, "status/2026-10-16.json"));
    expect(pathsOf(check(dir).issues)).toEqual(["briefs/2026-10-16.json: (status)"]);
  });

  it("leaves a file that is there but is not valid JSON to its own SCHEMA issue: the brief's pair is not reported again", () => {
    for (const rel of ["metrics/2026-10-14.json", "status/2026-10-14.json", `metrics/${DATA_ONLY_DAY}.json`]) {
      const dir = copy();
      writeRaw(dir, rel, "{not json");
      const result = check(dir);
      expect(result.ok, rel).toBe(false);
      expect(result.issues.map((i) => [i.code, i.path]), rel).toEqual([["SCHEMA", `${rel}: (file)`]]);
    }
  });

  it("leaves a metrics file that parses but fails its schema to the schema's issues alone", () => {
    const dir = copy();
    const metrics = readJson<Json>(dir, "metrics/2026-10-14.json");
    delete metrics.hold;
    writeJson(dir, "metrics/2026-10-14.json", metrics);
    const result = check(dir);
    expect(result.issues.map((i) => i.code)).toEqual(["SCHEMA"]);
    expect(result.issues.every((i) => i.path.startsWith("metrics/2026-10-14.json: "))).toBe(true);
  });

  it("counts a folder where the metrics file belongs as missing, as FILE_LAYOUT names it too", () => {
    const dir = copy();
    fs.rmSync(path.join(dir, "metrics/2026-10-17.json"));
    writeRaw(dir, "metrics/2026-10-17.json/inside.json", "{}");
    const result = check(dir);
    expect(result.issues.map((i) => [i.code, i.path]).sort()).toEqual([
      ["FILE_LAYOUT", "metrics/2026-10-17.json/inside.json: (file)"], ["XREF", "briefs/2026-10-17.json: pace.metrics_file"],
    ].sort());
  });

  it("reports each brief that lacks a file, in the engine's order, when several do", () => {
    const dir = copy();
    for (const date of ["2026-10-13", "2026-10-16"]) fs.rmSync(path.join(dir, `metrics/${date}.json`));
    fs.rmSync(path.join(dir, "status/2026-10-12.json"));
    expect(pathsOf(check(dir).issues)).toEqual(["briefs/2026-10-12.json: (status)", "briefs/2026-10-13.json: pace.metrics_file", "briefs/2026-10-16.json: pace.metrics_file"]);
  });

  it("asks nothing in a run over a folder with no brief: the files of dates that no brief has are not asked for", () => {
    const dir = copy();
    for (const date of DATES) fs.rmSync(path.join(dir, `briefs/${date}.json`));
    expect(pathsOf(check(dir).issues).filter((p) => p.startsWith("briefs/"))).toEqual([]);
  });
});

describe("the world on disk", () => {
  it("holds eighteen files in the layout of SPEC §3, and a copy of it validates as the original does", () => {
    const world = storedWorld();
    const dir = tempDir("layout");
    expect(writeWorld(dir, world)).toEqual(worldFiles(world).map(([rel]) => rel));
    const copy = tempDir("layout-copy");
    fs.cpSync(dir, copy, { recursive: true });
    expect(check(copy)).toEqual(check(dir));
    expect(check(copy).issues).toEqual([]);
    expect(Object.keys(snapshot(dir))).toHaveLength(18);
  });
});
