// The validator's command line, scripts/validate.ts (SPEC §8.6, §10 P1 milestone): its three forms and every flag, the exit codes
// (0 valid, 1 invalid, 2 usage or an input the run cannot use), every refusal, the defaults of each input, the stored records the
// English and Chinese forms hand the engine, the text and `--json` output and their order, `--all` on empty, missing, valid and
// invalid folders, and the milestone lines run over whatever fixtures exist (each invalid fixture exits 1 with exactly the code in its
// name, each soft one 0 with exactly its warning, each valid one 0 with nothing, the sample content 0). The engine's own rules are
// tested elsewhere: here the engine is the real one except where a case replaces its answer to see how the command prints it, and the
// cases that look at what the command gave the engine (which file an input came from, which stored records) read the call.
//
// Most cases call `main()` with an `Io` and a temporary root laid out as a run is (`drafts/`, `logs/`, `content/`, `packs/`, `config/`);
// a few spawn the real script, and `npm run` for the package scripts. `UT_CONTENT_DIR` is set in every case, so a case never reads the
// repository's own `content/` and the loops keep passing once real content is there.
//
// New for this project; Cyber's tests/validate-engine.test.ts at the fork commit 3ced1fb, adapted: the `cli()` helper over an `Io`, the
// usage errors, a missing input that names its flag, an unparsable draft that is one SCHEMA error and the `--all` cases (empty, missing,
// stray file) are Cyber's pattern; the Chinese form, the stored records, the refusal of linked copies, the output order and the fixture
// loops are this project's. The last block is the adversarial review's: the command writes nothing (the tree is the same after, and no
// writing call is made), names with spaces and Chinese characters, a 20 MB draft, keys named like members of Object.prototype and a
// value nested 100,000 levels deep are judged or refused without a stack, and the validate lines of SPEC §10 P1's milestone are run
// by a shell as the spec writes them (M7).

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import runConfig from "@/config/run.json";
import { CONFIG_FILES } from "@/lib/config";
import { AgentContext } from "@/lib/schema/context";
import { ZhContext } from "@/lib/schema/draft-zh";
import { Finding } from "@/lib/schema/finding";
import { MetricsFile } from "@/lib/schema/metrics";
import { Evidence } from "@/lib/schema/misc";
import { Pack } from "@/lib/schema/pack";
import { toResult, validateAll, validateDraft, validateZh, type DraftInputs, type ValidationIssue, type ValidationResult, type ZhInputs } from "@/lib/validate";
import { jsonFromBytes } from "@/lib/validate-stored";
import { EDITIONS, findingKeyOfId, storedFinding, storedFindingsBefore, storedGlossary, storedWeekdayCorrections, type EditionName } from "@/fixtures/src/world";
import {
  InputError, STORED_WINDOW_DAYS, USAGE, UsageError, findingIdsIn, issueLine, main, oneLine, problemsOf, readJsonFile, readStoredRecords, writeFailure, type Io,
} from "@/scripts/validate";
import { removeTempDirs, storedWorld, tempDir, worldDir, writeJson, writeRaw } from "./helpers/stored-world";

// The real engines, wrapped so a case can see what the command gave them or replace one answer.
vi.mock("@/lib/validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/validate")>();
  return { ...actual, validateDraft: vi.fn(actual.validateDraft), validateZh: vi.fn(actual.validateZh), validateAll: vi.fn(actual.validateAll) };
});

// A case that validates a draft loads the config and runs every rule, which takes seconds on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = path.join(__dirname, "..");
const EM_DASH = String.fromCharCode(0x2014);
const draftSpy = vi.mocked(validateDraft);
const zhSpy = vi.mocked(validateZh);
const allSpy = vi.mocked(validateAll);
const REAL_DRAFT = draftSpy.getMockImplementation()!;
const REAL_ZH = zhSpy.getMockImplementation()!;
const REAL_ALL = allSpy.getMockImplementation()!;

/** An empty folder every case points `UT_CONTENT_DIR` at unless it says otherwise. */
const QUIET = tempDir("vcli-quiet");

beforeEach(() => {
  vi.stubEnv("UT_CONTENT_DIR", QUIET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  draftSpy.mockReset().mockImplementation(REAL_DRAFT);
  zhSpy.mockReset().mockImplementation(REAL_ZH);
  allSpy.mockReset().mockImplementation(REAL_ALL);
});
afterAll(() => {
  removeTempDirs();
});

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
const readJ = (rel: string): any => JSON.parse(read(rel));
const flagsOf = (rel: string): string[] => read(rel).trim().split(/\s+/);

interface Ran {
  code: number;
  out: string[];
  err: string[];
}

/**
 * Runs the command in this process. The command never prints an em dash of its own, so every output is checked for one; `quotes` is
 * for a fixture that exists to break a rule about dashes, whose message quotes the draft's text.
 */
function cli(argv: string[], root: string = ROOT, quotes = false): Ran {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (s) => out.push(s), err: (s) => err.push(s), root };
  const code = main(argv, io);
  if (!quotes) expect([...out, ...err].join("\n")).not.toContain(EM_DASH);
  return { code, out, err };
}

interface Finding4 {
  code: string;
  path: string;
  message: string;
  severity: string;
}
/** The `--json` output of a run. */
const found = (r: Ran): Finding4[] => {
  expect(r.out).toHaveLength(1);
  return JSON.parse(r.out[0]!) as Finding4[];
};
const codesOf = (items: Finding4[], severity: "error" | "warning"): string[] => [...new Set(items.filter((i) => i.severity === severity).map((i) => i.code))].sort();

/** Copies a repository file to `rel` under `root`. */
function place(root: string, rel: string, from: string): void {
  const to = path.join(root, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), to);
}

interface Run {
  root: string;
  /** The edition's date. */
  date: string;
  edition: EditionName;
}

/** A temporary root with `config/` as a link to the repository's, for the cases that give every file themselves. */
function bareRoot(): string {
  const root = tempDir("vcli-root");
  fs.symlinkSync(path.join(ROOT, "config"), path.join(root, "config"), "dir");
  return root;
}

/**
 * A temporary root laid out as a morning is, for one edition: `drafts/D.json` and `drafts/D.zh.json`, the English inputs under `logs/`,
 * `content/metrics/` and `packs/`, the Chinese ones under `logs/`, and `config/` (a link to the repository's, or a copy, or none). Like
 * a morning it uses the default content folder, `content/` under the root (`UT_CONTENT_DIR` unset), until a case sets it.
 */
function makeRun(edition: EditionName = "weekday", config: "link" | "copy" | "none" = "link"): Run {
  vi.stubEnv("UT_CONTENT_DIR", "");
  const root = tempDir("vcli-run");
  const date = EDITIONS[edition].date;
  place(root, `drafts/${date}.json`, `fixtures/drafts/valid-${edition}.json`);
  place(root, `drafts/${date}.zh.json`, `fixtures/drafts-zh/valid-${edition}.zh.json`);
  place(root, `logs/${date}.context.json`, `fixtures/context/${edition}.json`);
  place(root, `logs/${date}.evidence.json`, `fixtures/evidence/${edition}.json`);
  place(root, `content/metrics/${date}.json`, `fixtures/metrics/${edition}.json`);
  place(root, `packs/${date}.json`, `fixtures/packs/${edition}.json`);
  place(root, `logs/${date}.zh-context.json`, `fixtures/drafts-zh/${edition}.zh-context.json`);
  place(root, `logs/${date}.zh-evidence.json`, `fixtures/drafts-zh/${edition}.zh-evidence.json`);
  if (config === "link") fs.symlinkSync(path.join(ROOT, "config"), path.join(root, "config"), "dir");
  if (config === "copy") fs.cpSync(path.join(ROOT, "config"), path.join(root, "config"), { recursive: true });
  return { root, date, edition };
}

/** The inputs of the last `validateDraft()` call. */
const draftCall = (): DraftInputs => {
  const call = draftSpy.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![1];
};
/** The inputs and options of the last `validateZh()` call. */
const zhCall = (): { zh: unknown; en: unknown; inputs: ZhInputs; options: { fileDate?: string | null } | undefined } => {
  const call = zhSpy.mock.calls.at(-1);
  expect(call).toBeDefined();
  return { zh: call![0], en: call![1], inputs: call![2], options: call![3] };
};

const issue = (severity: "error" | "warning", code: string, p: string, message: string, hint: string | null = null): ValidationIssue => ({ code, severity, path: p, message, hint });

/** The English run's own flags for an edition, as `flags.txt` writes the weekday's. */
const englishFlags = (edition: EditionName): string[] => [
  "--context", `fixtures/context/${edition}.json`, "--evidence", `fixtures/evidence/${edition}.json`,
  "--metrics", `fixtures/metrics/${edition}.json`, "--pack", `fixtures/packs/${edition}.json`,
];

const WEEKDAY = EDITIONS.weekday.date;
const WEEKDAY_FLAGS = flagsOf("fixtures/drafts/flags.txt");
const ZH_FLAGS = flagsOf("fixtures/drafts-zh/flags.txt");
/** The same flags with the paths made absolute, for a root other than the repository's. */
const absFlags = (flags: string[]): string[] => flags.map((f) => (f.startsWith("fixtures/") ? path.join(ROOT, f) : f));
const WEEKDAY_ABS = absFlags(WEEKDAY_FLAGS);

// ── The usage text and the package scripts ───────────────────────────────────────────────────────

describe("the usage text and the package scripts", () => {
  it("U1: USAGE shows SPEC §8.6's three forms, each with --json, and names every flag the command takes", () => {
    const spec = read("SPEC.md");
    const block = spec.slice(spec.indexOf("### 8.6 validate.ts"), spec.indexOf("### 8.7 publish.ts"));
    const forms = block.split("\n").filter((l) => l.startsWith("tsx scripts/validate.ts ")).map((l) => l.slice("tsx scripts/validate.ts ".length));
    expect(forms).toHaveLength(3);
    const usage = USAGE.split("\n").slice(1).map((l) => l.trim());
    expect(usage).toHaveLength(3);
    forms.forEach((form, i) => {
      const own = form.replace(/ \[--json\]$/, "");
      expect(usage[i]).toBe(`npm run validate -- ${own} [--json]`);
    });
    for (const flag of ["--all", "--dir", "--context", "--evidence", "--metrics", "--pack", "--zh", "--zh-context", "--zh-evidence", "--json"]) {
      expect(USAGE).toContain(flag);
    }
  });

  it("U2: package.json has the three scripts exactly as SPEC §8.1 prints them", () => {
    const spec = read("SPEC.md");
    const block = spec.slice(spec.indexOf("### 8.1 package.json scripts"));
    const scripts = JSON.parse(block.slice(block.indexOf("```json\n") + 8, block.indexOf("\n```", block.indexOf("```json\n")))).scripts as Record<string, string>;
    const own = JSON.parse(read("package.json")).scripts as Record<string, string>;
    expect(own.validate).toBe("tsx scripts/validate.ts");
    expect(own["validate:all"]).toBe("tsx scripts/validate.ts --all");
    expect(own["validate:sample"]).toBe("UT_CONTENT_DIR=fixtures/site-content tsx scripts/validate.ts --all");
    for (const name of ["validate", "validate:all", "validate:sample"]) expect(own[name]).toBe(scripts[name]);
  });

  it("U3: the content folder default is run.json's, which the stored records and --all read", () => {
    expect(runConfig.paths.content_dir).toBe("content");
  });
});

// ── Usage errors ─────────────────────────────────────────────────────────────────────────────────

describe("usage errors: exit 2, the message and the usage text on standard error, nothing on standard output", () => {
  const ENGLISH = "the English form (FILE alone)";
  const CHINESE = "the Chinese form (FILE --zh EN_FILE)";
  const cases: [string, string[], RegExp][] = [
    ["no arguments", [], /^Give exactly one FILE to validate, or --all\./],
    ["two files", ["a.json", "b.json"], /^Give exactly one FILE to validate, or --all\./],
    ["an unknown flag", ["a.json", "--nope"], /nope/],
    ["a short flag", ["-x"], /-x/],
    ["--help, which there is not", ["--help"], /help/],
    ["a flag with no value", ["a.json", "--context"], /--context/],
    ["a flag that would take the next flag as its value", ["a.json", "--context", "--json"], /--context/],
    ["a boolean flag given a value", ["--all=yes"], /--all/],
    ["--context given twice", ["a.json", "--context", "x", "--context", "y"], /^--context is given twice\./],
    ["--json given twice", ["a.json", "--json", "--json"], /^--json is given twice\./],
    ["--all given twice", ["--all", "--all"], /^--all is given twice\./],
    ["--zh given twice", ["a.json", "--zh", "e.json", "--zh", "f.json"], /^--zh is given twice\./],
    ["a flag given twice in both spellings", ["a.json", "--pack", "x", "--pack=y"], /^--pack is given twice\./],
    ["an empty value", ["a.json", "--pack", ""], /^--pack needs a value\./],
    ["an empty inline value", ["a.json", "--metrics="], /^--metrics needs a value\./],
    ["--dir with an empty value", ["--all", "--dir", ""], /^--dir needs a value\./],
    ["--zh with an empty value", ["a.json", "--zh", ""], /^--zh needs a value\./],
    ["an empty file name", [""], /^A file name is empty\./],
    ["--all with a file", ["--all", "a.json"], /^--all takes no FILE: give the folder with --dir\./],
    ["--all with --context", ["--all", "--context", "c.json"], new RegExp(`^--context belongs to ${escapeRe(ENGLISH)}, not to --all\\.`)],
    ["--all with --evidence", ["--all", "--evidence", "c.json"], new RegExp(`^--evidence belongs to ${escapeRe(ENGLISH)}, not to --all\\.`)],
    ["--all with --metrics", ["--all", "--metrics", "c.json"], new RegExp(`^--metrics belongs to ${escapeRe(ENGLISH)}, not to --all\\.`)],
    ["--all with --pack", ["--all", "--pack", "c.json"], new RegExp(`^--pack belongs to ${escapeRe(ENGLISH)}, not to --all\\.`)],
    ["--all with --zh", ["--all", "--zh", "e.json"], new RegExp(`^--zh belongs to ${escapeRe(CHINESE)}, not to --all\\.`)],
    ["--all with --zh-context", ["--all", "--zh-context", "c.json"], new RegExp(`^--zh-context belongs to ${escapeRe(CHINESE)}, not to --all\\.`)],
    ["--all with --zh-evidence", ["--all", "--zh-evidence", "c.json"], new RegExp(`^--zh-evidence belongs to ${escapeRe(CHINESE)}, not to --all\\.`)],
    ["--dir without --all", ["a.json", "--dir", "d"], new RegExp(`^--dir belongs to --all, not to ${escapeRe(ENGLISH)}\\.`)],
    ["--zh-context without --zh", ["a.json", "--zh-context", "c.json"], new RegExp(`^--zh-context belongs to ${escapeRe(CHINESE)}, not to ${escapeRe(ENGLISH)}\\.`)],
    ["--zh-evidence without --zh", ["a.json", "--zh-evidence", "c.json"], new RegExp(`^--zh-evidence belongs to ${escapeRe(CHINESE)}, not to ${escapeRe(ENGLISH)}\\.`)],
    ["--zh with --context", ["a.zh.json", "--zh", "e.json", "--context", "c.json"], new RegExp(`^--context belongs to ${escapeRe(ENGLISH)}, not to ${escapeRe(CHINESE)}\\.`)],
    ["--zh with --evidence", ["a.zh.json", "--zh", "e.json", "--evidence", "c.json"], new RegExp(`^--evidence belongs to ${escapeRe(ENGLISH)}, not to ${escapeRe(CHINESE)}\\.`)],
    ["--zh with --metrics", ["a.zh.json", "--zh", "e.json", "--metrics", "c.json"], new RegExp(`^--metrics belongs to ${escapeRe(ENGLISH)}, not to ${escapeRe(CHINESE)}\\.`)],
    ["--zh with --pack", ["a.zh.json", "--zh", "e.json", "--pack", "c.json"], new RegExp(`^--pack belongs to ${escapeRe(ENGLISH)}, not to ${escapeRe(CHINESE)}\\.`)],
    ["--zh with --dir", ["a.zh.json", "--zh", "e.json", "--dir", "d"], new RegExp(`^--dir belongs to --all, not to ${escapeRe(CHINESE)}\\.`)],
    ["--zh with no FILE", ["--zh", "e.json"], /^Give exactly one FILE to validate, or --all\./],
    ["--zh with two files", ["a.zh.json", "b.zh.json", "--zh", "e.json"], /^Give exactly one FILE to validate, or --all\./],
  ];

  it.each(cases)("%s", (_name, argv, message) => {
    // The same mistake with `--json` added is the same mistake (a case that has its own `--json` is run as it is).
    for (const extra of argv.includes("--json") ? [[]] : [[], ["--json"]]) {
      const r = cli([...argv, ...extra]);
      expect(r.code).toBe(2);
      expect(r.out).toEqual([]);
      expect(r.err).toHaveLength(1);
      expect(r.err[0]).toMatch(message);
      expect(r.err[0]!.endsWith(`\n${USAGE}`)).toBe(true);
    }
  });

  it("a file name that begins with a dash follows `--`, and is then an ordinary FILE", () => {
    const r = cli(["--", "-x.json"]);
    expect(r.code).toBe(2);
    expect(r.err).toEqual(["Cannot read -x.json: it was not found."]);
  });

  it("an option given after `--` is a file name, so two of them are two files", () => {
    const r = cli(["--", "--json", "--all"]);
    expect(r.code).toBe(2);
    expect(r.err[0]).toMatch(/^Give exactly one FILE/);
  });

  it("every usage check comes before any file is read", () => {
    const readFile = vi.spyOn(fs, "readFileSync");
    const stat = vi.spyOn(fs, "statSync");
    for (const argv of [["a.json", "--zh-context", "x"], ["--all", "--zh", "x"], []]) {
      expect(cli(argv).code).toBe(2);
    }
    expect(readFile).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });
});

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Other failures: an input the run cannot use is exit 2 with the message alone ─────────────────

describe("an input the run cannot use: exit 2 with the message alone (no usage text), nothing on standard output", () => {
  it("a failure that is not a usage or input problem is exit 2 with the stack, whatever was thrown", () => {
    const { root } = makeRun();
    draftSpy.mockImplementationOnce(() => {
      throw new Error("engine fault");
    });
    const first = cli([`drafts/${WEEKDAY}.json`, ...WEEKDAY_ABS], root);
    expect(first.code).toBe(2);
    expect(first.out).toEqual([]);
    expect(first.err).toHaveLength(1);
    expect(first.err[0]).toContain("engine fault");
    expect(first.err[0]).toContain("Error: engine fault\n    at ");
    expect(first.err[0]).not.toContain(USAGE);
    draftSpy.mockImplementationOnce(() => {
      throw "plain text"; // eslint-disable-line @typescript-eslint/only-throw-error
    });
    const second = cli([`drafts/${WEEKDAY}.json`, ...WEEKDAY_ABS], root);
    expect(second.code).toBe(2);
    expect(second.err).toEqual(["plain text"]);
    // An error that has a `code` of its own (a failed read deep in the engine) is no usage error either: the stack, not the usage text.
    draftSpy.mockImplementationOnce(() => {
      throw Object.assign(new Error("read fault"), { code: "EIO" });
    });
    const third = cli([`drafts/${WEEKDAY}.json`, ...WEEKDAY_ABS], root);
    expect(third.code).toBe(2);
    expect(third.err).toHaveLength(1);
    expect(third.err[0]).toContain("Error: read fault\n    at ");
    expect(third.err[0]).not.toContain(USAGE);
  });

  it("the default Io prints to the console: the report on standard output, a failure on standard error", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const errLog = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["--all", "--dir", QUIET])).toBe(0);
    expect(log.mock.calls).toEqual([[`${QUIET}: 0 errors, 0 warnings.`]]);
    expect(errLog).not.toHaveBeenCalled();
    expect(main(["--nope"])).toBe(2);
    expect(errLog).toHaveBeenCalledTimes(1);
    expect(String(errLog.mock.calls[0]![0])).toContain(USAGE);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("the default root is the working folder, which is the repository for `npm run`", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("UT_CONTENT_DIR", "fixtures/empty-content");
    expect(main(["--all", "--dir", "fixtures/site-content"])).toBe(0);
    expect(log.mock.calls[0]![0]).toBe("fixtures/site-content: 0 errors, 0 warnings.");
    expect(allSpy.mock.calls.at(-1)![0]).toBe(path.join(process.cwd(), "fixtures", "site-content"));
  });
});

// ── Reading a JSON file ──────────────────────────────────────────────────────────────────────────

describe("readJsonFile(): why a file cannot be read", () => {
  const dir = tempDir("vcli-json");
  const at = (name: string): string => path.join(dir, name);

  it("R1: reads valid JSON, a value of any kind, and a file with surrounding whitespace", () => {
    for (const [name, text, value] of [["a.json", '{"a":[1,2]}', { a: [1, 2] }], ["b.json", " null\n", null], ["c.json", "[]", []], ["d.json", '"text"', "text"], ["e.json", "7", 7]] as const) {
      fs.writeFileSync(at(name), text);
      expect(readJsonFile(at(name))).toEqual({ ok: true, value });
    }
    fs.writeFileSync(at("zh.json"), JSON.stringify({ zh: "你好" }));
    expect(readJsonFile(at("zh.json"))).toEqual({ ok: true, value: { zh: "你好" } });
  });

  it("R2: a file that is not there, a path through a file, a folder and a pipe are `fs` problems", () => {
    expect(readJsonFile(at("missing.json"))).toEqual({ ok: false, kind: "fs", why: "was not found" });
    fs.writeFileSync(at("plain.json"), "{}");
    expect(readJsonFile(at("plain.json/inside.json"))).toEqual({ ok: false, kind: "fs", why: "was not found" });
    fs.mkdirSync(at("folder.json"));
    expect(readJsonFile(at("folder.json"))).toEqual({ ok: false, kind: "fs", why: "is a folder, not a file" });
    execFileSync("mkfifo", [at("pipe.json")]);
    expect(readJsonFile(at("pipe.json"))).toEqual({ ok: false, kind: "fs", why: "is not a regular file" });
  });

  it("R2b: a link is followed to what it names: a link to a file is that file, a broken link is not found, a loop is a code", () => {
    fs.writeFileSync(at("real.json"), '{"a":1}');
    fs.symlinkSync(at("real.json"), at("link.json"));
    expect(readJsonFile(at("link.json"))).toEqual({ ok: true, value: { a: 1 } });
    fs.symlinkSync(at("link.json"), at("link-of-link.json"));
    expect(readJsonFile(at("link-of-link.json"))).toEqual({ ok: true, value: { a: 1 } });
    fs.mkdirSync(at("real-folder"));
    fs.symlinkSync(at("real-folder"), at("link-to-folder.json"));
    expect(readJsonFile(at("link-to-folder.json"))).toEqual({ ok: false, kind: "fs", why: "is a folder, not a file" });
    fs.symlinkSync(at("nowhere.json"), at("broken.json"));
    expect(readJsonFile(at("broken.json"))).toEqual({ ok: false, kind: "fs", why: "was not found" });
    fs.symlinkSync(at("loop-b.json"), at("loop-a.json"));
    fs.symlinkSync(at("loop-a.json"), at("loop-b.json"));
    expect(readJsonFile(at("loop-a.json"))).toEqual({ ok: false, kind: "fs", why: "cannot be read (ELOOP)" });
  });

  it("R3: a file that cannot be read is an `fs` problem with the error's code, or `an error` when it has none", () => {
    fs.writeFileSync(at("locked.json"), "{}");
    const real = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync");
    spy.mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (file === at("locked.json")) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return (real as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof fs.readFileSync);
    expect(readJsonFile(at("locked.json"))).toEqual({ ok: false, kind: "fs", why: "cannot be read (EACCES)" });
    spy.mockImplementation((() => {
      throw "not an error object";
    }) as typeof fs.readFileSync);
    expect(readJsonFile(at("locked.json"))).toEqual({ ok: false, kind: "fs", why: "cannot be read (an error)" });
  });

  it.each([
    ["an empty file", "", "is empty; rewrite the whole file as valid JSON"],
    ["a byte order mark", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]), "starts with a byte order mark; save it as UTF-8 without one"],
    ["bytes that are not UTF-8", Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]), "is not valid UTF-8; rewrite the whole file as UTF-8 JSON"],
    ["text that ends early", '{"a":', "is not valid JSON (the text ends early); rewrite the whole file as valid JSON"],
    ["a wrong character", '{"a" 1}', "is not valid JSON (at character 5); rewrite the whole file as valid JSON"],
    ["a message with no position", "undefined", "is not valid JSON (unreadable text); rewrite the whole file as valid JSON"],
  ])("R4: %s is a `content` problem", (_name, bytes, why) => {
    fs.writeFileSync(at("bad.json"), bytes);
    expect(readJsonFile(at("bad.json"))).toEqual({ ok: false, kind: "content", why });
  });

  it("R5: the message never quotes the file's text", () => {
    fs.writeFileSync(at("secret.json"), '{"token": SECRETWORD}');
    const r = readJsonFile(at("secret.json"));
    expect(r).toMatchObject({ ok: false, kind: "content" });
    expect(JSON.stringify(r)).not.toContain("SECRETWORD");
  });

  it.each([
    ["the first byte wrong", [0x20, 0xbb, 0xbf, 0x7b, 0x7d]],
    ["the second byte wrong", [0xef, 0x20, 0xbf, 0x7b, 0x7d]],
    ["the third byte wrong", [0xef, 0xbb, 0x20, 0x7b, 0x7d]],
    ["only the first two bytes", [0xef, 0xbb]],
    ["only the first byte", [0xef]],
  ])("R6: a file with the byte order mark's bytes but %s is not one: it is bytes that are not UTF-8", (_name, bytes) => {
    fs.writeFileSync(at("almost.json"), Buffer.from(bytes));
    expect(readJsonFile(at("almost.json"))).toEqual({ ok: false, kind: "content", why: "is not valid UTF-8; rewrite the whole file as UTF-8 JSON" });
  });

  it("R7 (F-53): says what the library's one reader says, word for word, for every file it cannot read, and holds no copy of its texts", () => {
    const cases: [string, string | Buffer][] = [
      ["empty", ""], ["mark", Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])], ["utf8", Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d])],
      ["early", '{"a":'], ["wrong", '{"a" 1}'], ["undefined", "undefined"],
    ];
    for (const [name, content] of cases) {
      fs.writeFileSync(at(`${name}.json`), content);
      const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
      const library = jsonFromBytes(bytes);
      expect(library.ok, name).toBe(false);
      expect(readJsonFile(at(`${name}.json`)), name).toEqual({ ok: false, kind: "content", why: library.ok ? "" : library.why });
    }
    fs.writeFileSync(at("good.json"), '{"a": 1}');
    expect(readJsonFile(at("good.json"))).toEqual({ ok: true, value: { a: 1 } });
    const source = fs.readFileSync(path.join(ROOT, "scripts/validate.ts"), "utf8");
    for (const text of ["save it as UTF-8 without one", "rewrite the whole file as UTF-8 JSON", "rewrite the whole file as valid JSON", "the text ends early", "unreadable text"]) {
      expect(source.includes(text), `scripts/validate.ts holds no copy of "${text}"`).toBe(false);
    }
    expect(source).toContain("jsonFromBytes");
  });

  it("R6b: the byte order mark in front of valid JSON is the mark, whatever follows it", () => {
    for (const rest of ["{}", "[]", "", "not json"]) {
      fs.writeFileSync(at("mark.json"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(rest)]));
      expect(readJsonFile(at("mark.json"))).toEqual({ ok: false, kind: "content", why: "starts with a byte order mark; save it as UTF-8 without one" });
    }
  });
});

describe("problemsOf(): the first problems of a schema failure", () => {
  const schema = z.strictObject({ a: z.string(), b: z.string(), c: z.string(), d: z.string(), nested: z.strictObject({ e: z.number() }) });
  const failure = (value: unknown): z.ZodError => {
    const r = schema.safeParse(value);
    if (r.success) throw new Error("expected a failure");
    return r.error;
  };

  it("P1: lists up to three, each as path and message, with the rest counted", () => {
    const five = failure({ a: 1, b: 2, c: 3, d: 4, nested: { e: "x" } });
    expect(five.issues).toHaveLength(5);
    expect(problemsOf(five)).toMatch(/^a: [^;]+; b: [^;]+; c: [^;]+; and 2 more$/);
    const four = failure({ a: 1, b: 2, c: 3, d: 4, nested: { e: 1 } });
    expect(four.issues).toHaveLength(4);
    expect(problemsOf(four)).toMatch(/^a: [^;]+; b: [^;]+; c: [^;]+; and 1 more$/);
    const three = failure({ a: 1, b: 2, c: 3, d: "ok", nested: { e: 1 } });
    expect(three.issues).toHaveLength(3);
    expect(problemsOf(three)).toMatch(/^a: [^;]+; b: [^;]+; c: [^;]+$/);
    expect(problemsOf(failure({ a: 1, b: "ok", c: "ok", d: "ok", nested: { e: 1 } }))).toMatch(/^a: [^;]+$/);
  });

  it("P1b: a nested path is written with dots, and an array index as a number", () => {
    expect(problemsOf(failure({ a: "ok", b: "ok", c: "ok", d: "ok", nested: { e: "x" } }))).toMatch(/^nested\.e: [^;]+$/);
    const list = z.strictObject({ items: z.array(z.strictObject({ n: z.number() })) });
    const r = list.safeParse({ items: [{ n: 1 }, { n: "x" }] });
    if (r.success) throw new Error("expected a failure");
    expect(problemsOf(r.error)).toMatch(/^items\.1\.n: [^;]+$/);
  });

  it("P2: a problem at the root is `(root)`", () => {
    expect(problemsOf(failure(7))).toMatch(/^\(root\): /);
  });

  it("P3: the paths and messages of a file's problems are one line, whatever keys the file holds", () => {
    const key = `a${ch(0x0a)}b`;
    const odd = z.strictObject({ [key]: z.number() }).safeParse({ [key]: "x", [`c${ch(0x1b)}[2J`]: 1 });
    if (odd.success) throw new Error("expected a failure");
    const text = problemsOf(odd.error);
    expect(text).toContain("a\\nb: ");
    expect(text).toContain(`c${escape(0x1b)}[2J`);
    for (const code of [0x0a, 0x1b]) expect(text.includes(ch(code)), `U+${code.toString(16)}`).toBe(false);
  });
});

describe("issueLine(): one issue as a line of the text output", () => {
  it("L1: ERROR or WARN, the code, the path, the message, and the hint when there is one", () => {
    expect(issueLine(issue("error", "WORDS", "story.found", "Too long.", "Cut it."))).toBe("ERROR WORDS story.found: Too long. Hint: Cut it.");
    expect(issueLine(issue("warning", "READING_LEVEL", "(root)", "Grade 13."))).toBe("WARN READING_LEVEL (root): Grade 13.");
    expect(issueLine(issue("error", "SCHEMA", "(file)", "No.", ""))).toBe("ERROR SCHEMA (file): No.");
  });

  it("L2: a message, path or hint that quotes the draft is one line: its line breaks, escapes and direction marks are written out", () => {
    const quoted = `a${ch(0x0a)}ERROR FAKE (root): forged${ch(0x1b)}[2J${ch(0x202e)}z`;
    const line = issueLine(issue("error", "SCHEMA", `p${ch(0x0d)}q`, `Unknown key "${quoted}"; remove it.`, `Hint${ch(0x09)}${ch(0x2028)}here`));
    expect(line).toBe(`ERROR SCHEMA p\\rq: Unknown key "a\\nERROR FAKE (root): forged${escape(0x1b)}[2J${escape(0x202e)}z"; remove it. Hint: Hint\\t${escape(0x2028)}here`);
    for (const code of [0x0a, 0x0d, 0x09, 0x1b, 0x2028, 0x202e]) expect(line.includes(ch(code)), `U+${code.toString(16)}`).toBe(false);
    // The same text as a warning without a hint.
    expect(issueLine(issue("warning", "WORDS", "x", `one${ch(0x0a)}two`))).toBe("WARN WORDS x: one\\ntwo");
  });
});

/** The character with this code point, and its escape as `oneLine()` writes it. */
function ch(code: number): string {
  return String.fromCodePoint(code);
}
function escape(code: number): string {
  return `${"\\"}u${code.toString(16).padStart(4, "0")}`;
}

describe("oneLine(): text as one line of output", () => {
  it("N1: a line break, a carriage return and a tab are written as \\n, \\r and \\t", () => {
    expect(oneLine(`a${ch(0x0a)}b${ch(0x0d)}${ch(0x0a)}c${ch(0x09)}d`)).toBe("a\\nb\\r\\nc\\td");
  });

  // Each end of every range of the set: the C0 controls, DEL and the C1 controls, the line and paragraph separators, and the
  // embedding, override and isolate marks of text direction.
  it.each([0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1b, 0x1f, 0x7f, 0x80, 0x85, 0x9f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map((c) => [c.toString(16), c] as const))(
    "N2: U+%s is written as its escape", (_hex, code) => {
      expect(oneLine(`x${ch(code)}y`)).toBe(`x${escape(code)}y`);
    });

  // Each character next to a range, and the kinds of text the project holds: nothing of these changes.
  it.each([0x20, 0x7e, 0xa0, 0xa1, 0x2027, 0x202f, 0x2065, 0x206a, 0xfeff, 0x4e2d, 0x300c, 0xff0c, 0x1f600].map((c) => [c.toString(16), c] as const))(
    "N3: U+%s is left as it is", (_hex, code) => {
      expect(oneLine(`x${ch(code)}y`)).toBe(`x${ch(code)}y`);
    });

  it("N4: ordinary text, Chinese text and a backslash are returned as they are, and every unsafe character of a long text is written out", () => {
    const plain = "ERROR WORDS story.found: \"title\" has 14 words; the limit is 12 (see C:\\x and \\n). 中文，標點「引號」。";
    expect(oneLine(plain)).toBe(plain);
    expect(oneLine("")).toBe("");
    expect(oneLine(`${ch(0x0a)}`.repeat(1000))).toBe("\\n".repeat(1000));
  });
});

// ── The draft file ───────────────────────────────────────────────────────────────────────────────

describe("the draft file", () => {
  it("D1: a draft that is not there is exit 2 with its name, and a folder is exit 2 too", () => {
    const { root } = makeRun();
    const missing = cli(["drafts/none.json"], root);
    expect(missing).toEqual({ code: 2, out: [], err: ["Cannot read drafts/none.json: it was not found."] });
    fs.mkdirSync(path.join(root, "drafts", "folder.json"));
    const folder = cli(["drafts/folder.json"], root);
    expect(folder).toEqual({ code: 2, out: [], err: ["Cannot read drafts/folder.json: it is a folder, not a file."] });
    const zh = cli(["drafts/none.zh.json", "--zh", `drafts/${WEEKDAY}.json`], root);
    expect(zh).toEqual({ code: 2, out: [], err: ["Cannot read drafts/none.zh.json: it was not found."] });
  });

  it("D2: a draft that cannot be read is exit 2 with the error's code", () => {
    const { root } = makeRun();
    const target = path.join(root, "drafts", `${WEEKDAY}.json`);
    const real = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (file === target) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return (real as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof fs.readFileSync);
    expect(cli([`drafts/${WEEKDAY}.json`], root)).toEqual({ code: 2, out: [], err: [`Cannot read drafts/${WEEKDAY}.json: it cannot be read (EACCES).`] });
  });

  const BAD: [string, Buffer | string, string][] = [
    ["empty", "", "is empty; rewrite the whole file as valid JSON"],
    ["with a byte order mark", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]), "starts with a byte order mark; save it as UTF-8 without one"],
    ["not UTF-8", Buffer.from([0xff, 0xfe, 0x7b, 0x7d]), "is not valid UTF-8; rewrite the whole file as UTF-8 JSON"],
    ["not JSON", '{"a":', "is not valid JSON (the text ends early); rewrite the whole file as valid JSON"],
  ];
  const EN_SCHEMA = "routine/schema/draft-brief.schema.json";
  const ZH_SCHEMA = "routine/schema/draft-zh.schema.json";

  it.each(BAD)("D3: a draft that is %s is one SCHEMA error at (file), exit 1, with no input and no config needed", (_name, bytes, why) => {
    const root = tempDir("vcli-bad"); // no logs, no packs, no config: nothing but the draft
    writeRaw(root, "drafts/x.json", bytes);
    writeRaw(root, "drafts/x.zh.json", bytes);
    const english = cli(["drafts/x.json"], root);
    expect(english).toEqual({
      code: 1,
      out: [`ERROR SCHEMA (file): drafts/x.json ${why}. Hint: A draft is one UTF-8 JSON file in the shape of ${EN_SCHEMA}.`, "drafts/x.json: 1 error, 0 warnings."],
      err: [],
    });
    // The Chinese draft is read before the English one it is checked against, so a bad Chinese draft is judged whatever EN_FILE is.
    const chinese = cli(["drafts/x.zh.json", "--zh", "drafts/not-there.json"], root);
    expect(chinese).toEqual({
      code: 1,
      out: [`ERROR SCHEMA (file): drafts/x.zh.json ${why}. Hint: A draft is one UTF-8 JSON file in the shape of ${ZH_SCHEMA}.`, "drafts/x.zh.json: 1 error, 0 warnings."],
      err: [],
    });
    const json = cli(["drafts/x.json", "--json"], root);
    expect(json.code).toBe(1);
    expect(found(json)).toEqual([{ code: "SCHEMA", path: "(file)", message: `drafts/x.json ${why}.`, severity: "error" }]);
    const zhJson = cli(["drafts/x.zh.json", "--zh", "drafts/x.json", "--json"], root);
    expect(zhJson.code).toBe(1);
    expect(found(zhJson)).toEqual([{ code: "SCHEMA", path: "(file)", message: `drafts/x.zh.json ${why}.`, severity: "error" }]);
  });

  it("D4: the message names the file and where the text went wrong, never the text", () => {
    const root = tempDir("vcli-bad");
    writeRaw(root, "drafts/x.json", '{"token": SECRETWORD}');
    const r = cli(["drafts/x.json"], root);
    expect(r.code).toBe(1);
    expect(r.out.join("\n")).toMatch(/^ERROR SCHEMA \(file\): drafts\/x\.json is not valid JSON \((at character \d+|the text ends early|unreadable text)\); rewrite the whole file as valid JSON\./);
    expect(r.out.join("\n")).not.toContain("SECRETWORD");
    expect(r.out.join("\n")).not.toContain("token");
  });

  it.each([["null", "null"], ["an array", "[]"], ["a string", '"text"'], ["a number", "7"], ["an empty object", "{}"]])("D5: valid JSON that is %s is judged by the schema alone: SCHEMA errors, exit 1", (_name, text) => {
    const root = bareRoot();
    writeRaw(root, "drafts/odd.json", text);
    const r = cli(["drafts/odd.json", ...WEEKDAY_ABS, "--json"], root);
    expect(r.code).toBe(1);
    const items = found(r);
    expect(items.length).toBeGreaterThan(0);
    expect(codesOf(items, "error")).toEqual(["SCHEMA"]);
    expect(codesOf(items, "warning")).toEqual([]);
  });
});

// ── The English form: inputs ─────────────────────────────────────────────────────────────────────

describe("the English form's inputs", () => {
  const NAMES: [flag: string, what: string][] = [["context", "an agent context"], ["evidence", "an evidence file"], ["metrics", "a metrics file"], ["pack", "a source pack"]];
  const FIXTURE: Record<string, string> = {
    context: "fixtures/context/weekday.json", evidence: "fixtures/evidence/weekday.json", metrics: "fixtures/metrics/weekday.json", pack: "fixtures/packs/weekday.json",
  };
  /** The weekday's four flags, with one input replaced. */
  const withInput = (flag: string, value: string): string[] =>
    Object.entries(FIXTURE).flatMap(([name, file]) => [`--${name}`, name === flag ? value : file]);

  const bad = tempDir("vcli-inputs");
  writeRaw(bad, "empty.json", "");
  writeRaw(bad, "not-json.json", '{"a":');
  writeRaw(bad, "wrong.json", "{}");
  fs.mkdirSync(path.join(bad, "folder.json"));

  it.each(NAMES)("I1: --%s that is missing, a folder, empty or not JSON is exit 2 naming the flag and the file, with no usage text", (flag) => {
    const run = (value: string) => cli(["fixtures/drafts/valid-weekday.json", ...withInput(flag, value)]);
    const rel = (name: string): string => path.relative(ROOT, path.join(bad, name));
    expect(run(rel("missing.json"))).toEqual({ code: 2, out: [], err: [`--${flag}: ${rel("missing.json")} was not found.`] });
    expect(run(rel("folder.json"))).toEqual({ code: 2, out: [], err: [`--${flag}: ${rel("folder.json")} is a folder, not a file.`] });
    expect(run(rel("empty.json"))).toEqual({ code: 2, out: [], err: [`--${flag}: ${rel("empty.json")} is empty; rewrite the whole file as valid JSON.`] });
    expect(run(rel("not-json.json"))).toEqual({
      code: 2, out: [], err: [`--${flag}: ${rel("not-json.json")} is not valid JSON (the text ends early); rewrite the whole file as valid JSON.`],
    });
  });

  it.each(NAMES)("I2: --%s that is JSON of the wrong shape is exit 2: `is not` what it should be, with its first problems", (flag, what) => {
    const rel = path.relative(ROOT, path.join(bad, "wrong.json"));
    const r = cli(["fixtures/drafts/valid-weekday.json", ...withInput(flag, rel)]);
    expect(r.code).toBe(2);
    expect(r.out).toEqual([]);
    expect(r.err).toHaveLength(1);
    expect(r.err[0]).toMatch(new RegExp(`^--${flag}: ${escapeRe(rel)} is not ${what} \\(.+\\)\\.$`));
    expect(r.err[0]).not.toContain(USAGE);
  });

  it("I3: the inputs are read in the order context, evidence, metrics, pack, and the first that fails is the only one reported", () => {
    const missing = (flag: string): string => `nope-${flag}.json`;
    const argv = ["fixtures/drafts/valid-weekday.json", "--context", missing("context"), "--evidence", missing("evidence"), "--metrics", missing("metrics"), "--pack", missing("pack")];
    const order = ["context", "evidence", "metrics", "pack"];
    for (let i = 0; i < order.length; i++) {
      const flags = order.flatMap((name, j) => [`--${name}`, j < i ? FIXTURE[name]! : missing(name)]);
      const r = cli(["fixtures/drafts/valid-weekday.json", ...flags]);
      expect(r.err).toEqual([`--${order[i]}: ${missing(order[i]!)} was not found.`]);
    }
    expect(cli(argv).err).toEqual([`--context: ${missing("context")} was not found.`]);
  });

  it("I4: every input is read from the root, a relative path or an absolute one, and each gives the engine its own file", () => {
    const { root } = makeRun();
    const own = path.join(root, "own");
    for (const name of ["context", "evidence", "metrics", "pack"]) place(root, `own/${name}.json`, FIXTURE[name]!);
    const relative = cli([`drafts/${WEEKDAY}.json`, "--context", "own/context.json", "--evidence", "own/evidence.json", "--metrics", "own/metrics.json", "--pack", "own/pack.json"], root);
    expect(relative.code).toBe(0);
    const absolute = cli([`drafts/${WEEKDAY}.json`, "--context", `${own}/context.json`, "--evidence", `${own}/evidence.json`, "--metrics", `${own}/metrics.json`, "--pack", `${own}/pack.json`], root);
    expect(absolute.code).toBe(0);
    const inputs = draftCall();
    expect(inputs.context).toEqual(AgentContext.parse(readJ(FIXTURE.context!)));
    expect(inputs.evidence).toEqual(Evidence.parse(readJ(FIXTURE.evidence!)));
    expect(inputs.metrics).toEqual(MetricsFile.parse(readJ(FIXTURE.metrics!)));
    expect(inputs.pack).toEqual(Pack.parse(readJ(FIXTURE.pack!)));
  });

  it("I5: an input flag replaces its default and the default is then not read at all", () => {
    const { root } = makeRun();
    for (const rel of [`logs/${WEEKDAY}.context.json`, `logs/${WEEKDAY}.evidence.json`, `packs/${WEEKDAY}.json`]) fs.writeFileSync(path.join(root, rel), "{ broken");
    fs.rmSync(path.join(root, "content"), { recursive: true });
    const r = cli([`drafts/${WEEKDAY}.json`, ...WEEKDAY_ABS], root);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`drafts/${WEEKDAY}.json: 0 errors, 0 warnings.`]);
  });

  it("I6: the engine is given the file's date, the loaded config and the stored records", () => {
    const { root } = makeRun();
    cli([`drafts/${WEEKDAY}.json`, ...WEEKDAY_ABS], root);
    const inputs = draftCall();
    expect(inputs.fileDate).toBe(WEEKDAY);
    expect(inputs.config.fields).toEqual(readJ("config/fields.json"));
    expect(inputs.stored).toBeNull();
    expect(draftSpy.mock.calls.at(-1)![0]).toEqual(readJ(`fixtures/drafts/valid-weekday.json`));
  });
});

// ── The English form: defaults ───────────────────────────────────────────────────────────────────

describe("the English form's defaults: the run's files for the draft's date D", () => {
  beforeEach(() => {
    vi.stubEnv("UT_CONTENT_DIR", ""); // the default folder, `content/`
  });

  it("F1: with no flag at all, a draft named D.json reads logs/D.context.json, logs/D.evidence.json, content/metrics/D.json and packs/D.json", () => {
    const { root } = makeRun();
    const r = cli([`drafts/${WEEKDAY}.json`, "--json"], root);
    expect(r).toEqual({ code: 0, out: ["[]"], err: [] });
    const inputs = draftCall();
    expect(inputs.context).toEqual(AgentContext.parse(readJ("fixtures/context/weekday.json")));
    expect(inputs.evidence).toEqual(Evidence.parse(readJ("fixtures/evidence/weekday.json")));
    expect(inputs.metrics).toEqual(MetricsFile.parse(readJ("fixtures/metrics/weekday.json")));
    expect(inputs.pack).toEqual(Pack.parse(readJ("fixtures/packs/weekday.json")));
    expect(inputs.fileDate).toBe(WEEKDAY);
  });

  it.each(EDITIONS_LIST())("F2: the %s edition validates with its defaults", (edition) => {
    const { root, date } = makeRun(edition);
    expect(cli([`drafts/${date}.json`, "--json"], root)).toEqual({ code: 0, out: ["[]"], err: [] });
  });

  it.each([
    ["context", `logs/${WEEKDAY}.context.json`],
    ["evidence", `logs/${WEEKDAY}.evidence.json`],
    ["metrics", `content/metrics/${WEEKDAY}.json`],
    ["pack", `packs/${WEEKDAY}.json`],
  ])("F3: a missing default --%s is exit 2 naming the flag and the default path", (flag, rel) => {
    const { root } = makeRun();
    fs.rmSync(path.join(root, rel));
    expect(cli([`drafts/${WEEKDAY}.json`], root)).toEqual({ code: 2, out: [], err: [`--${flag}: ${rel} was not found.`] });
  });

  it("F4: the date is the file name's when it has one, and then the draft's own `date`", () => {
    const { root } = makeRun();
    // Named for another day: the defaults are that day's, which are not there; the draft's own date is not looked at.
    fs.copyFileSync(path.join(root, "drafts", `${WEEKDAY}.json`), path.join(root, "drafts", "2026-10-15.json"));
    expect(cli(["drafts/2026-10-15.json"], root)).toEqual({ code: 2, out: [], err: ["--context: logs/2026-10-15.context.json was not found."] });
    // Not named for a day: the draft's own date.
    fs.copyFileSync(path.join(root, "drafts", `${WEEKDAY}.json`), path.join(root, "drafts", "draft.json"));
    expect(cli(["drafts/draft.json", "--json"], root)).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(draftCall().fileDate).toBeNull();
    // Named like a day that is not one: also not a name with a date.
    fs.copyFileSync(path.join(root, "drafts", `${WEEKDAY}.json`), path.join(root, "drafts", "2026-02-31.json"));
    expect(cli(["drafts/2026-02-31.json", "--json"], root)).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(draftCall().fileDate).toBeNull();
    // A name that only looks like one.
    for (const name of ["2026-10-14.json.bak.json", "x2026-10-14.json", "2026-10-14.zh.json"]) {
      fs.copyFileSync(path.join(root, "drafts", `${WEEKDAY}.json`), path.join(root, "drafts", name));
      expect(cli([`drafts/${name}`, "--json"], root)).toEqual({ code: 0, out: ["[]"], err: [] });
      expect(draftCall().fileDate).toBeNull();
    }
  });

  it("F5: a draft with no date of its own and no dated name needs every input flag, else it is a usage error", () => {
    const { root } = makeRun();
    const draft = readJ("fixtures/drafts/valid-weekday.json");
    for (const date of [undefined, "2026-02-31", "tomorrow", 20261014, null]) {
      const copy = { ...draft, date };
      fs.writeFileSync(path.join(root, "drafts", "undated.json"), JSON.stringify(copy));
      const r = cli(["drafts/undated.json"], root);
      expect(r.code).toBe(2);
      expect(r.out).toEqual([]);
      expect(r.err).toHaveLength(1);
      expect(r.err[0]).toMatch(/^Cannot tell the edition date of drafts\/undated\.json: name the file YYYY-MM-DD\.json, or give every input flag\./);
      expect(r.err[0]).toContain(USAGE);
      // Given every flag, no date is needed: the draft is judged, and it is not valid.
      const all = cli(["drafts/undated.json", ...WEEKDAY_ABS, "--json"], root);
      expect(all.code).toBe(1);
      expect(codesOf(found(all), "error").length).toBeGreaterThan(0);
    }
  });

  it("F6: giving one flag still needs the date for the defaults of the others", () => {
    const { root } = makeRun();
    fs.writeFileSync(path.join(root, "drafts", "undated.json"), JSON.stringify({ ...readJ("fixtures/drafts/valid-weekday.json"), date: "soon" }));
    const r = cli(["drafts/undated.json", "--context", path.join(ROOT, "fixtures/context/weekday.json")], root);
    expect(r.code).toBe(2);
    expect(r.err[0]).toMatch(/^Cannot tell the edition date/);
  });

  it("F7: the default metrics file is content/metrics/D.json, else the staged copy cache/staged/D/metrics/D.json, and the committed one wins", () => {
    const { root } = makeRun();
    const metrics = readJ("fixtures/metrics/weekday.json");
    const mark = (stamp: string) => JSON.stringify({ ...metrics, computed_at: stamp });
    const committed = `content/metrics/${WEEKDAY}.json`;
    const staged = `cache/staged/${WEEKDAY}/metrics/${WEEKDAY}.json`;
    const stampOf = (): string => (draftCall().metrics as { computed_at: string }).computed_at;
    const argv = [`drafts/${WEEKDAY}.json`];

    // Both: the committed one.
    writeRaw(root, committed, mark("2026-10-14T01:00:00Z"));
    writeRaw(root, staged, mark("2026-10-14T02:00:00Z"));
    expect(cli(argv, root).code).toBe(0);
    expect(stampOf()).toBe("2026-10-14T01:00:00Z");
    // Only the staged copy: that.
    fs.rmSync(path.join(root, committed));
    expect(cli(argv, root).code).toBe(0);
    expect(stampOf()).toBe("2026-10-14T02:00:00Z");
    // Neither: the committed path is the one the message names.
    fs.rmSync(path.join(root, staged));
    expect(cli(argv, root)).toEqual({ code: 2, out: [], err: [`--metrics: ${committed} was not found.`] });
    // A committed file that is not usable is not replaced by the staged copy.
    writeRaw(root, committed, "{ broken");
    writeRaw(root, staged, mark("2026-10-14T02:00:00Z"));
    const broken = cli(argv, root);
    expect(broken.code).toBe(2);
    expect(broken.err[0]).toMatch(new RegExp(`^--metrics: ${escapeRe(committed)} is not valid JSON`));
  });

  it("F8: the staged copy is the date's own, never another day's", () => {
    const { root } = makeRun();
    fs.rmSync(path.join(root, `content/metrics/${WEEKDAY}.json`));
    place(root, "cache/staged/2026-10-13/metrics/2026-10-13.json", "fixtures/metrics/weekday.json");
    place(root, `cache/staged/${WEEKDAY}/metrics/2026-10-13.json`, "fixtures/metrics/weekday.json");
    place(root, `cache/staged/${WEEKDAY}/${WEEKDAY}.json`, "fixtures/metrics/weekday.json");
    expect(cli([`drafts/${WEEKDAY}.json`], root)).toEqual({ code: 2, out: [], err: [`--metrics: content/metrics/${WEEKDAY}.json was not found.`] });
  });

  it("F9: UT_CONTENT_DIR moves the committed metrics file with the content folder, a relative one or an absolute one", () => {
    const { root } = makeRun();
    fs.renameSync(path.join(root, "content"), path.join(root, "elsewhere"));
    vi.stubEnv("UT_CONTENT_DIR", "elsewhere");
    expect(cli([`drafts/${WEEKDAY}.json`, "--json"], root)).toEqual({ code: 0, out: ["[]"], err: [] });
    vi.stubEnv("UT_CONTENT_DIR", path.join(root, "elsewhere"));
    expect(cli([`drafts/${WEEKDAY}.json`, "--json"], root)).toEqual({ code: 0, out: ["[]"], err: [] });
    vi.stubEnv("UT_CONTENT_DIR", "content");
    expect(cli([`drafts/${WEEKDAY}.json`], root)).toEqual({ code: 2, out: [], err: [`--metrics: content/metrics/${WEEKDAY}.json was not found.`] });
  });

  it("F10: a file named for a day reads that day's logs/ whatever the draft's own date is, and the engine is told the name's date", () => {
    const { root } = makeRun();
    const next = "2026-10-15";
    place(root, `logs/${next}.context.json`, "fixtures/context/weekday.json");
    place(root, `logs/${next}.evidence.json`, "fixtures/evidence/weekday.json");
    place(root, `content/metrics/${next}.json`, "fixtures/metrics/weekday.json");
    place(root, `packs/${next}.json`, "fixtures/packs/weekday.json");
    fs.copyFileSync(path.join(root, "drafts", `${WEEKDAY}.json`), path.join(root, "drafts", `${next}.json`));
    const r = cli([`drafts/${next}.json`, "--json"], root);
    expect(r.code).toBe(1);
    expect(found(r).map((i) => i.code)).toContain("DATE_MISMATCH");
    expect(draftCall().fileDate).toBe(next);
  });
});

function EDITIONS_LIST(): EditionName[] {
  return ["weekday", "sunday", "monday", "monday-short"];
}

// ── The agent-writable copies of a context ───────────────────────────────────────────────────────

describe("the refusal of drafts/context.json and drafts/D.zh-context.json", () => {
  const MESSAGE = (flag: string, given: string): string =>
    `--${flag}: ${given} is the drafting agent's writable copy of a context and is never read; give the run's own copy in logs/ (logs/D.context.json or logs/D.zh-context.json).`;

  /** A run whose `drafts/` also holds the agent's two copies, which are valid. */
  function withCopies(): Run {
    const run = makeRun();
    place(run.root, "drafts/context.json", "fixtures/context/weekday.json");
    place(run.root, `drafts/${WEEKDAY}.zh-context.json`, "fixtures/drafts-zh/weekday.zh-context.json");
    return run;
  }
  const english = (extra: string[]) => [`drafts/${WEEKDAY}.json`, ...extra];
  const chinese = (extra: string[]) => [`drafts/${WEEKDAY}.zh.json`, "--zh", `drafts/${WEEKDAY}.json`, ...extra];

  it.each([
    ["--context drafts/context.json", "context", "drafts/context.json"],
    ["--context ./drafts/context.json", "context", "./drafts/context.json"],
    ["--context drafts/../drafts/context.json", "context", "drafts/../drafts/context.json"],
    ["--context drafts//context.json", "context", "drafts//context.json"],
    ["--context drafts/D.zh-context.json", "context", `drafts/${WEEKDAY}.zh-context.json`],
    ["--context an older drafts/D.zh-context.json", "context", "drafts/2020-01-02.zh-context.json"],
  ])("X1: %s is refused, exit 2 with the message alone, even where the file is valid", (_name, flag, given) => {
    const { root } = withCopies();
    const r = cli(english(["--context", given]), root);
    expect(r).toEqual({ code: 2, out: [], err: [MESSAGE(flag, given)] });
  });

  it.each([
    ["--zh-context drafts/D.zh-context.json", `drafts/${WEEKDAY}.zh-context.json`],
    ["--zh-context drafts/context.json", "drafts/context.json"],
    ["--zh-context ./drafts/2031-12-31.zh-context.json", "./drafts/2031-12-31.zh-context.json"],
  ])("X2: %s is refused", (_name, given) => {
    const { root } = withCopies();
    expect(cli(chinese(["--zh-context", given]), root)).toEqual({ code: 2, out: [], err: [MESSAGE("zh-context", given)] });
  });

  it("X3: the path is refused by its name, so a copy that is gone is refused too, and an absolute path is refused", () => {
    const { root } = makeRun();
    expect(cli(english(["--context", "drafts/context.json"]), root).err).toEqual([MESSAGE("context", "drafts/context.json")]);
    const absolute = path.join(root, "drafts", "context.json");
    expect(cli(english(["--context", absolute]), root).err).toEqual([MESSAGE("context", absolute)]);
    const zh = path.join(root, "drafts", `${WEEKDAY}.zh-context.json`);
    expect(cli(chinese(["--zh-context", zh]), root).err).toEqual([MESSAGE("zh-context", zh)]);
  });

  it("X4: the refusal comes before the draft or any other input is read", () => {
    const { root } = withCopies();
    const r = cli(["drafts/nothing.json", "--context", "drafts/context.json", "--evidence", "no-such-file.json"], root);
    expect(r.err).toEqual([MESSAGE("context", "drafts/context.json")]);
    const zh = cli(["drafts/nothing.zh.json", "--zh", "drafts/nothing.json", "--zh-context", `drafts/${WEEKDAY}.zh-context.json`], root);
    expect(zh.err).toEqual([MESSAGE("zh-context", `drafts/${WEEKDAY}.zh-context.json`)]);
  });

  it("X5: a link, a hard link and a path through a linked folder to a copy are the same file, and refused", () => {
    const { root } = withCopies();
    fs.symlinkSync(path.join(root, "drafts", "context.json"), path.join(root, "logs", "soft.json"));
    expect(cli(english(["--context", "logs/soft.json"]), root).err).toEqual([MESSAGE("context", "logs/soft.json")]);
    fs.linkSync(path.join(root, "drafts", "context.json"), path.join(root, "logs", "hard.json"));
    expect(cli(english(["--context", "logs/hard.json"]), root).err).toEqual([MESSAGE("context", "logs/hard.json")]);
    fs.linkSync(path.join(root, "drafts", `${WEEKDAY}.zh-context.json`), path.join(root, "logs", "hard-zh.json"));
    expect(cli(chinese(["--zh-context", "logs/hard-zh.json"]), root).err).toEqual([MESSAGE("zh-context", "logs/hard-zh.json")]);
    expect(cli(english(["--context", "logs/hard-zh.json"]), root).err).toEqual([MESSAGE("context", "logs/hard-zh.json")]);
    // The drafts folder reached through another name.
    fs.symlinkSync(path.join(root, "drafts"), path.join(root, "alias"), "dir");
    expect(cli(english(["--context", "alias/context.json"]), root).err).toEqual([MESSAGE("context", "alias/context.json")]);
    // A link to a link.
    fs.symlinkSync(path.join(root, "logs", "soft.json"), path.join(root, "logs", "soft-of-soft.json"));
    expect(cli(english(["--context", "logs/soft-of-soft.json"]), root).err).toEqual([MESSAGE("context", "logs/soft-of-soft.json")]);
  });

  it("X6: a case-insensitive disk shows the same file under another spelling, which the inode refuses; a different file is not refused", () => {
    const { root } = withCopies();
    const spelling = path.join(root, "drafts", "CONTEXT.json");
    let sameFile = false;
    try {
      sameFile = fs.statSync(spelling).ino === fs.statSync(path.join(root, "drafts", "context.json")).ino;
    } catch {
      sameFile = false;
    }
    const r = cli(english(["--context", "drafts/CONTEXT.json"]), root);
    if (sameFile) expect(r.err).toEqual([MESSAGE("context", "drafts/CONTEXT.json")]);
    else expect(r).toEqual({ code: 2, out: [], err: ["--context: drafts/CONTEXT.json was not found."] });
  });

  it("X7: only the two named copies are refused: another file in drafts/, and a copy in logs/, are read", () => {
    const { root } = withCopies();
    place(root, "drafts/notes.json", "fixtures/context/weekday.json");
    place(root, "drafts/context.json.bak", "fixtures/context/weekday.json");
    place(root, "drafts/zh-context.json", "fixtures/context/weekday.json");
    place(root, `drafts/${WEEKDAY}.zh-context.json.bak`, "fixtures/context/weekday.json");
    place(root, "drafts/my-context.json", "fixtures/context/weekday.json");
    place(root, `drafts/old-${WEEKDAY}.zh-context.json`, "fixtures/context/weekday.json");
    place(root, `drafts/${WEEKDAY}.zh-contexts.json`, "fixtures/context/weekday.json");
    place(root, "drafts/20261014.zh-context.json", "fixtures/context/weekday.json");
    const others = [
      "drafts/notes.json", "drafts/context.json.bak", "drafts/zh-context.json", `drafts/${WEEKDAY}.zh-context.json.bak`, "drafts/my-context.json",
      `drafts/old-${WEEKDAY}.zh-context.json`, `drafts/${WEEKDAY}.zh-contexts.json`, "drafts/20261014.zh-context.json", `logs/${WEEKDAY}.context.json`,
    ];
    for (const given of others) {
      const r = cli(english(["--context", given]), root);
      expect(r.err, given).toEqual([]);
      expect(r.code, given).toBe(0);
    }
    place(root, `logs/${WEEKDAY}.zh-context.json`, "fixtures/drafts-zh/weekday.zh-context.json");
    expect(cli(chinese(["--zh-context", `logs/${WEEKDAY}.zh-context.json`]), root).code).toBe(0);
    // A file of another root's drafts folder is not this root's copy.
    const other = makeRun();
    place(other.root, "drafts/context.json", "fixtures/context/weekday.json");
    const given = path.join(other.root, "drafts", "context.json");
    expect(cli(english(["--context", given]), root).code).toBe(0);
  });

  it("X7b: a dangling link where a copy would be is no copy of anything: another file is read, and the link itself is refused by its name", () => {
    const { root } = makeRun();
    fs.symlinkSync(path.join(root, "nowhere"), path.join(root, "drafts", "context.json"));
    fs.symlinkSync(path.join(root, "nowhere"), path.join(root, "drafts", `${WEEKDAY}.zh-context.json`));
    expect(cli(english([]), root).code).toBe(0);
    expect(cli(english(["--context", `logs/${WEEKDAY}.context.json`]), root)).toEqual({ code: 0, out: [`drafts/${WEEKDAY}.json: 0 errors, 0 warnings.`], err: [] });
    expect(cli(chinese(["--zh-context", `logs/${WEEKDAY}.zh-context.json`]), root).code).toBe(0);
    expect(cli(english(["--context", "drafts/context.json"]), root).err).toEqual([MESSAGE("context", "drafts/context.json")]);
  });

  it("X10: inode numbers are compared exactly: two files whose numbers a double cannot tell apart are two files", () => {
    const { root } = withCopies();
    const given = path.join(root, "logs", `${WEEKDAY}.context.json`);
    const copy = path.join(root, "drafts", "context.json");
    const real = fs.statSync as (...a: unknown[]) => any;
    vi.spyOn(fs, "statSync").mockImplementation(((file: fs.PathLike, options?: { bigint?: boolean }) => {
      const stats = real(file, options);
      const ino = file === given ? 2n ** 62n : file === copy ? 2n ** 62n + 1n : null;
      if (ino === null) return stats;
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, { ino: options?.bigint === true ? ino : Number(ino) });
    }) as typeof fs.statSync);
    expect(Number(2n ** 62n)).toBe(Number(2n ** 62n + 1n));
    expect(cli(english(["--context", `logs/${WEEKDAY}.context.json`]), root)).toEqual({ code: 0, out: [`drafts/${WEEKDAY}.json: 0 errors, 0 warnings.`], err: [] });
  });

  it("X11: the same inode number on another device is another file, and the same device and number is the copy", () => {
    const { root } = withCopies();
    const given = path.join(root, "logs", `${WEEKDAY}.context.json`);
    const copy = path.join(root, "drafts", "context.json");
    const real = fs.statSync as (...a: unknown[]) => any;
    const spy = vi.spyOn(fs, "statSync");
    const withIdentity = (dev: bigint) => (file: fs.PathLike, options?: { bigint?: boolean }) => {
      const stats = real(file, options);
      if (file !== given && file !== copy) return stats;
      const same = options?.bigint === true ? { dev: file === given ? dev : 7n, ino: 12345n } : { dev: file === given ? Number(dev) : 7, ino: 12345 };
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, same);
    };
    spy.mockImplementation(withIdentity(8n) as unknown as typeof fs.statSync);
    expect(cli(english(["--context", `logs/${WEEKDAY}.context.json`]), root)).toEqual({ code: 0, out: [`drafts/${WEEKDAY}.json: 0 errors, 0 warnings.`], err: [] });
    spy.mockImplementation(withIdentity(7n) as unknown as typeof fs.statSync);
    expect(cli(english(["--context", `logs/${WEEKDAY}.context.json`]), root)).toEqual({ code: 2, out: [], err: [MESSAGE("context", `logs/${WEEKDAY}.context.json`)] });
  });

  it("X8: the default context is the run's copy in logs/, and the agent's copy in drafts/ is never read, whatever it holds", () => {
    const { root } = makeRun();
    writeRaw(root, "drafts/context.json", "{ not even json");
    writeRaw(root, `drafts/${WEEKDAY}.zh-context.json`, "{ not even json");
    expect(cli([`drafts/${WEEKDAY}.json`, "--json"], root)).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(cli([`drafts/${WEEKDAY}.zh.json`, "--zh", `drafts/${WEEKDAY}.json`, "--json"], root)).toEqual({ code: 0, out: ["[]"], err: [] });
  });
});

// ── The stored records ───────────────────────────────────────────────────────────────────────────

/** A finding of the fixture world for each id code, the field and the code of a finding's id having to agree. */
const BASE_OF: Readonly<Record<string, string>> = {
  math: "math-2026-0131", phys: "phys-2026-0134", chem: "chem-2026-0142", bio: "bio-2026-0143", earth: "earth-2026-0141", soc: "soc-2026-0145", hum: "hum-2026-0148",
};

/**
 * A valid stored finding of the fixture world, renamed and briefed on the given dates. The id's year is the first brief's, so a case
 * that gives a 2026 id gives dates in 2026.
 */
function finding(id: string, briefs: string[], over: Record<string, unknown> = {}): Finding {
  const base = JSON.parse(JSON.stringify(storedFinding(findingKeyOfId(BASE_OF[id.split("-")[0]!]!)!))) as Record<string, unknown>;
  return Finding.parse({ ...base, id, briefs, first_brief: briefs[0] ?? null, ...over });
}

/** A content folder holding these findings (and, when given, the corrections and glossary files). */
function contentWith(findings: Finding[], extra: { corrections?: unknown; glossary?: unknown } = {}): string {
  const dir = tempDir("vcli-content");
  for (const f of findings) writeJson(dir, `findings/${f.id}.json`, f);
  if (extra.corrections !== undefined) writeJson(dir, "corrections.json", extra.corrections);
  if (extra.glossary !== undefined) writeJson(dir, "glossary.json", extra.glossary);
  return dir;
}

const ids = (stored: { findings: readonly Finding[] } | null | undefined): string[] => (stored === null || stored === undefined ? [] : stored.findings.map((f) => f.id));
const NONE: ReadonlySet<string> = new Set();

/** The edition date the stored-record cases are written for, and the date n days from it (plain date arithmetic, not the script's). */
const D = "2026-10-14";
const day = (n: number): string => new Date(Date.parse(`${D}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("findingIdsIn(): the finding ids a parsed JSON value names", () => {
  it("S1: every string that is a whole finding id, anywhere in objects and arrays, and nothing else", () => {
    const value = {
      a: "math-2026-0142",
      list: ["bio-2026-0001", { deep: ["hum-2025-9999", { deeper: "soc-2026-0145" }] }],
      keys: { "phys-2026-0003": "not a key" },
      numbers: [1, null, true, 7],
      prose: "see math-2026-0142 and chem-2026-0001 in the text",
      new: "new-1",
      wrong: ["xyz-2026-0001", "math-26-0142", "math-2026-142", "MATH-2026-0142", "math-2026-0142 ", " math-2026-0142", "earth-2026-00001", "math-2026-0142\n"],
    };
    expect([...findingIdsIn(value)].sort()).toEqual(["bio-2026-0001", "hum-2025-9999", "math-2026-0142", "soc-2026-0145"]);
    expect(findingIdsIn(null).size + findingIdsIn(7).size + findingIdsIn([]).size + findingIdsIn({}).size + findingIdsIn("x").size).toBe(0);
    expect([...findingIdsIn("earth-2026-0001")]).toEqual(["earth-2026-0001"]);
  });

  it("S2: a very deep value and a very large array do not overflow the stack", () => {
    let deep: unknown = "bio-2026-0001";
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect([...findingIdsIn(deep)]).toEqual(["bio-2026-0001"]);
    const wide = Array.from({ length: 300_000 }, (_, i) => (i === 299_999 ? "chem-2026-0002" : i));
    expect([...findingIdsIn(wide)]).toEqual(["chem-2026-0002"]);
  });

  it("S3: names the draft writes in a real draft are found, new refs and prose are not", () => {
    const draft = readJ("fixtures/drafts/valid-weekday.json");
    const names = findingIdsIn(draft);
    for (const id of ["soc-2026-0145", "chem-2026-0142", "math-2026-0140", "earth-2026-0141"]) expect(names.has(id), id).toBe(true);
    expect([...names].every((id) => /^[a-z]+-\d{4}-\d{4}$/.test(id))).toBe(true);
  });
});

describe("readStoredRecords(): the stored records a draft run reads", () => {
  it("T1: the window is the 90 days up to D, both ends included, and a finding is in it by any one of its briefs", () => {
    expect(STORED_WINDOW_DAYS).toBe(90);
    const inside = [
      finding("soc-2026-0201", [day(-90)]),
      finding("soc-2026-0202", [day(0)]),
      finding("soc-2026-0203", [day(-30)]),
      finding("soc-2026-0204", [day(-200), day(-45)]),
      finding("soc-2026-0205", [day(-200), day(-10), day(0)]),
    ];
    const outside = [
      finding("soc-2026-0206", [day(-91)]),
      finding("soc-2026-0207", [day(1)]),
      finding("soc-2026-0208", [day(-200)]),
      finding("soc-2026-0209", [day(-200), day(-91)]),
      finding("soc-2026-0210", [day(-120), day(5)]),
    ];
    const dir = contentWith([...inside, ...outside]);
    expect(ids(readStoredRecords(dir, { date: D, ids: NONE }))).toEqual(inside.map((f) => f.id).sort());
  });

  it("T2: the window is DUPLICATE's own, 90 days", () => {
    expect(read("lib/rules/history.ts")).toMatch(/const TITLE_DAYS = 90;/);
  });

  it("T3: a finding the draft names or the context lists is read at any age, and one that is not named is not", () => {
    const old = finding("soc-2026-0220", [day(-200)]);
    const older = finding("soc-2026-0221", [day(-250)]);
    const ledger = finding("soc-2019-0001", [], { history: true, first_published: "2019-05-01" });
    const dir = contentWith([old, older, ledger]);
    expect(ids(readStoredRecords(dir, { date: D, ids: NONE }))).toEqual([]);
    expect(ids(readStoredRecords(dir, { date: D, ids: new Set([old.id]) }))).toEqual([old.id]);
    expect(ids(readStoredRecords(dir, { date: D, ids: new Set([ledger.id, older.id, old.id]) }))).toEqual([ledger.id, older.id, old.id].sort());
    // Named but not stored: nothing to read, no error.
    expect(ids(readStoredRecords(dir, { date: D, ids: new Set(["soc-2026-0999", old.id]) }))).toEqual([old.id]);
  });

  it("T4: with no date only the named findings are read (the Chinese form), in the order of finding ids whatever the folder's order", () => {
    const recent = finding("soc-2026-0230", [day(-1)]);
    const named = [finding("soc-2026-0232", [day(-5)]), finding("soc-2026-0231", [day(-250)]), finding("hum-2026-0233", [day(-3)])];
    const dir = contentWith([recent, ...named]);
    const got = readStoredRecords(dir, { date: null, ids: new Set(named.map((f) => f.id)) });
    expect(ids(got)).not.toContain(recent.id);
    // The order is compareFindingIds': by the year and counter, then the field code.
    expect(ids(got)).toEqual(["soc-2026-0231", "soc-2026-0232", "hum-2026-0233"]);
  });

  it("T5: the corrections and glossary of the folder come whole, in the file's order, with the findings", () => {
    const corrections = storedWeekdayCorrections();
    const glossary = storedGlossary();
    const dir = contentWith([finding("soc-2026-0240", [day(0)])], { corrections: { schema_version: 1, corrections }, glossary });
    const got = readStoredRecords(dir, { date: D, ids: NONE })!;
    expect(got.corrections).toEqual(corrections);
    expect(got.terms).toEqual(glossary.terms);
    expect(got.corrections.length).toBeGreaterThan(1);
    expect(got.terms.length).toBeGreaterThan(1);
    expect(got.findings.map((f) => f.id)).toEqual(["soc-2026-0240"]);
    // A reversed corrections file stays reversed: nothing is sorted.
    const reversed = contentWith([], { corrections: { schema_version: 1, corrections: [...corrections].reverse() } });
    expect(readStoredRecords(reversed, { date: D, ids: NONE })!.corrections).toEqual([...corrections].reverse());
  });

  it("T6: each file alone is enough, and the other parts are then empty", () => {
    const onlyCorrections = contentWith([], { corrections: { schema_version: 1, corrections: [] } });
    expect(readStoredRecords(onlyCorrections, { date: D, ids: NONE })).toEqual({ findings: [], corrections: [], terms: [] });
    const onlyGlossary = contentWith([], { glossary: storedGlossary() });
    expect(readStoredRecords(onlyGlossary, { date: D, ids: NONE })).toEqual({ findings: [], corrections: [], terms: storedGlossary().terms });
    const onlyFinding = contentWith([finding("soc-2026-0250", [day(0)])]);
    expect(readStoredRecords(onlyFinding, { date: D, ids: NONE })).toEqual({ findings: [finding("soc-2026-0250", [day(0)])], corrections: [], terms: [] });
  });

  it("T7: null when there is nothing to read: no folder, an empty folder, a folder with none of the three, findings none of which is wanted", () => {
    const base = tempDir("vcli-nothing");
    expect(readStoredRecords(path.join(base, "missing"), { date: D, ids: NONE })).toBeNull();
    writeRaw(base, "a-file", "x");
    // A path that runs through a file leads nowhere, like a folder that is not there.
    expect(readStoredRecords(path.join(base, "a-file", "inside"), { date: D, ids: NONE })).toBeNull();
    fs.mkdirSync(path.join(base, "empty"));
    expect(readStoredRecords(path.join(base, "empty"), { date: D, ids: NONE })).toBeNull();
    writeRaw(base, "other/briefs/2026-10-13.json", "{}");
    writeRaw(base, "other/reports.json", "{}");
    writeRaw(base, "other/README.md", "x");
    expect(readStoredRecords(path.join(base, "other"), { date: D, ids: NONE })).toBeNull();
    expect(readStoredRecords(contentWith([finding("soc-2026-0260", [day(-200)])]), { date: D, ids: NONE })).toBeNull();
    expect(readStoredRecords(contentWith([finding("soc-2026-0261", [day(-5)])]), { date: null, ids: NONE })).toBeNull();
  });

  it("T7b: a path that is there but is not a folder is an InputError naming it, wanted findings or not, as it is shown", () => {
    const base = tempDir("vcli-nothing");
    writeRaw(base, "a-file", "x");
    const message = (shown: string): string => `Stored records: ${shown} is not a folder. The draft was not judged; give the content folder (UT_CONTENT_DIR, else content/).`;
    expect(() => readStoredRecords(path.join(base, "a-file"), { date: D, ids: NONE }, "content")).toThrow(InputError);
    expect(() => readStoredRecords(path.join(base, "a-file"), { date: D, ids: NONE }, "content")).toThrow(message("content"));
    expect(() => readStoredRecords(path.join(base, "a-file"), { date: null, ids: new Set(["soc-2026-0001"]) })).toThrow(message(path.join(base, "a-file")));
    // A link to a folder is the folder, and a link to a file is a file.
    fs.mkdirSync(path.join(base, "real"));
    fs.symlinkSync(path.join(base, "real"), path.join(base, "to-folder"));
    fs.symlinkSync(path.join(base, "a-file"), path.join(base, "to-file"));
    expect(readStoredRecords(path.join(base, "to-folder"), { date: D, ids: NONE })).toBeNull();
    expect(() => readStoredRecords(path.join(base, "to-file"), { date: D, ids: NONE }, "link")).toThrow(message("link"));
  });

  it("T8: only files named for a finding id are findings: other names, other extensions and folders are left alone", () => {
    const dir = contentWith([finding("soc-2026-0270", [day(-1)])]);
    writeRaw(dir, "findings/notes.json", "not json at all");
    writeRaw(dir, "findings/README.md", "x");
    writeRaw(dir, "findings/soc-2026-0271.txt", "x");
    writeRaw(dir, "findings/soc-2026-0272.json.bak", "x");
    writeRaw(dir, "findings/SOC-2026-0273.json", "x");
    writeRaw(dir, "findings/.json", "x");
    writeRaw(dir, "findings/nested/soc-2026-0274.json", "x");
    writeRaw(dir, "findings/soc-2026-02750.json", "x");
    writeRaw(dir, "metrics/soc-2026-0276.json", "x");
    expect(ids(readStoredRecords(dir, { date: D, ids: NONE }))).toEqual(["soc-2026-0270"]);
  });

  it("T9: a finding that is wanted must be a valid record of its own file name, else an InputError naming the file", () => {
    const shown = "content-here";
    const wrongShape = contentWith([]);
    writeJson(wrongShape, "findings/soc-2026-0280.json", { id: "soc-2026-0280", briefs: [day(-1)] });
    expect(() => readStoredRecords(wrongShape, { date: D, ids: NONE }, shown)).toThrow(InputError);
    expect(() => readStoredRecords(wrongShape, { date: D, ids: NONE }, shown)).toThrow(new RegExp(`^Stored records: ${shown}/findings/soc-2026-0280\\.json is not a finding \\(.+\\)\\. The draft was not judged; repair or remove that file \\(npm run validate:all checks the whole content folder\\)\\.$`));
    // Named, with no briefs at all: wanted by name, so checked.
    const named = contentWith([]);
    writeJson(named, "findings/soc-2026-0281.json", { id: "soc-2026-0281" });
    expect(readStoredRecords(named, { date: D, ids: NONE })).toBeNull();
    expect(() => readStoredRecords(named, { date: D, ids: new Set(["soc-2026-0281"]) }, shown)).toThrow(/soc-2026-0281\.json is not a finding/);
    // A record of another id under this file's name.
    const swapped = contentWith([]);
    writeJson(swapped, "findings/soc-2026-0282.json", finding("soc-2026-0283", [day(-1)]));
    expect(() => readStoredRecords(swapped, { date: D, ids: NONE }, shown)).toThrow(new RegExp(`^Stored records: ${shown}/findings/soc-2026-0282\\.json holds the finding soc-2026-0283, not soc-2026-0282\\. `));
  });

  it("T10: a bad record that nothing wants is not checked, so it cannot stop a run that never needs it", () => {
    const dir = contentWith([finding("soc-2026-0290", [day(-1)])]);
    writeJson(dir, "findings/soc-2026-0291.json", { id: "soc-2026-0291", briefs: [day(-300)] }); // old, not named: not parsed
    writeJson(dir, "findings/soc-2026-0292.json", { not: "a finding" }); // no briefs: not parsed
    writeJson(dir, "findings/soc-2026-0293.json", { briefs: "2026-10-13" }); // briefs of the wrong kind
    writeJson(dir, "findings/soc-2026-0294.json", { briefs: [13, null, { a: 1 }] });
    writeJson(dir, "findings/soc-2026-0295.json", [day(-1)]);
    writeJson(dir, "findings/soc-2026-0296.json", null);
    writeJson(dir, "findings/soc-2026-0297.json", "2026-10-13");
    expect(ids(readStoredRecords(dir, { date: D, ids: NONE }))).toEqual(["soc-2026-0290"]);
  });

  it("T11: a bad record whose briefs are in the window is checked, since the window wants it", () => {
    const dir = contentWith([]);
    writeJson(dir, "findings/soc-2026-0300.json", { id: "soc-2026-0300", briefs: [day(-1)] });
    expect(() => readStoredRecords(dir, { date: D, ids: NONE })).toThrow(/soc-2026-0300\.json is not a finding/);
    // With no date there is no window.
    expect(readStoredRecords(dir, { date: null, ids: NONE })).toBeNull();
  });

  it.each([
    ["an empty file", "", "is empty; rewrite the whole file as valid JSON"],
    ["a file that is not JSON", '{"a":', "is not valid JSON (the text ends early); rewrite the whole file as valid JSON"],
    ["a byte order mark", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]), "starts with a byte order mark; save it as UTF-8 without one"],
    ["bytes that are not UTF-8", Buffer.from([0xff, 0xfe]), "is not valid UTF-8; rewrite the whole file as UTF-8 JSON"],
  ])("T12: %s among the findings is an InputError naming the file, wanted or not, since what it holds is not known", (_name, bytes, why) => {
    const dir = contentWith([]);
    writeRaw(dir, "findings/soc-2026-0310.json", bytes);
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow(`Stored records: c/findings/soc-2026-0310.json ${why}. The draft was not judged; repair or remove that file (npm run validate:all checks the whole content folder).`);
    expect(() => readStoredRecords(dir, { date: null, ids: new Set(["soc-2026-0310"]) }, "c")).toThrow(InputError);
  });

  it.each([
    ["corrections.json", "a corrections file", "{}"],
    ["glossary.json", "a glossary file", '{"schema_version": 1}'],
  ])("T13: %s that fails its schema is an InputError naming the file and what it should be", (name, what, text) => {
    const dir = contentWith([]);
    writeRaw(dir, name, text);
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow(new RegExp(`^Stored records: c/${escapeRe(name)} is not ${what} \\(.+\\)\\. The draft was not judged;`));
    writeRaw(dir, name, "{ nope");
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow(`Stored records: c/${name} is not valid JSON (at character 2); rewrite the whole file as valid JSON. The draft was not judged; repair or remove that file (npm run validate:all checks the whole content folder).`);
    writeRaw(dir, name, "");
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow(`Stored records: c/${name} is empty; rewrite the whole file as valid JSON. `);
  });

  it("T14: an entry that is not a regular file is an InputError: a link, a folder, for the two files and for a finding", () => {
    const dir = contentWith([finding("soc-2026-0320", [day(-1)])]);
    const target = path.join(dir, "real.json");
    writeJson(dir, "real.json", { schema_version: 1, corrections: [] });
    fs.symlinkSync(target, path.join(dir, "corrections.json"));
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow("Stored records: c/corrections.json is not a regular file (it is a link, a folder or another kind of entry). The draft was not judged;");
    fs.rmSync(path.join(dir, "corrections.json"));
    fs.mkdirSync(path.join(dir, "glossary.json"));
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow(/^Stored records: c\/glossary\.json is not a regular file/);
    fs.rmdirSync(path.join(dir, "glossary.json"));
    fs.symlinkSync(path.join(dir, "findings", "soc-2026-0320.json"), path.join(dir, "findings", "soc-2026-0321.json"));
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow(/^Stored records: c\/findings\/soc-2026-0321\.json is not a regular file/);
    fs.rmSync(path.join(dir, "findings", "soc-2026-0321.json"));
    fs.mkdirSync(path.join(dir, "findings", "soc-2026-0322.json"));
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow(/^Stored records: c\/findings\/soc-2026-0322\.json is not a regular file/);
    fs.rmdirSync(path.join(dir, "findings", "soc-2026-0322.json"));
    // A dangling link is a link too.
    fs.symlinkSync(path.join(dir, "gone"), path.join(dir, "findings", "soc-2026-0323.json"));
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow(/soc-2026-0323\.json is not a regular file/);
    fs.rmSync(path.join(dir, "findings", "soc-2026-0323.json"));
    expect(ids(readStoredRecords(dir, { date: D, ids: NONE }))).toEqual(["soc-2026-0320"]);
  });

  it("T15: an entry whose kind cannot be told is `not a regular file`, and a findings folder that cannot be listed is an InputError", () => {
    const dir = contentWith([finding("soc-2026-0330", [day(-1)])]);
    const real = fs.lstatSync;
    const lstat = vi.spyOn(fs, "lstatSync");
    lstat.mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
      if (file === path.join(dir, "corrections.json")) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return (real as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof fs.lstatSync);
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow(/^Stored records: c\/corrections\.json is not a regular file/);
    // An entry that is not there (ENOENT) and one whose path runs through a file (ENOTDIR) are the same: nothing to read, and no error.
    for (const code of ["ENOENT", "ENOTDIR"]) {
      lstat.mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
        if (file === path.join(dir, "corrections.json")) throw Object.assign(new Error("gone"), { code });
        return (real as (...a: unknown[]) => unknown)(file, ...rest);
      }) as typeof fs.lstatSync);
      expect(readStoredRecords(dir, { date: D, ids: NONE }, "c")?.corrections, code).toEqual([]);
    }
    lstat.mockRestore();

    const readdir = vi.spyOn(fs, "readdirSync");
    const realDir = fs.readdirSync;
    readdir.mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (p === path.join(dir, "findings")) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return (realDir as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.readdirSync);
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow("Stored records: c/findings cannot be listed (EACCES). The draft was not judged;");
    readdir.mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (p === path.join(dir, "findings")) throw "no code";
      return (realDir as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.readdirSync);
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow("Stored records: c/findings cannot be listed (an error).");
    readdir.mockRestore();
    // `findings` that is a file, not a folder, is no findings; the other files are still read.
    const flat = contentWith([], { corrections: { schema_version: 1, corrections: [] } });
    writeRaw(flat, "findings", "x");
    expect(readStoredRecords(flat, { date: D, ids: NONE })).toEqual({ findings: [], corrections: [], terms: [] });
  });

  it("T16: the folder is named in messages as the caller shows it, joined to the file by a slash", () => {
    const dir = contentWith([]);
    writeRaw(dir, "glossary.json", "");
    expect(() => readStoredRecords(dir, { date: D, ids: NONE })).toThrow(`Stored records: ${dir}${path.sep}glossary.json is empty`);
    expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "fixtures/site-content")).toThrow("Stored records: fixtures/site-content/glossary.json is empty");
  });

  it("T17: findings are read in the code-unit order of their file names, whatever order the folder lists them in, so the first broken one is the one reported", () => {
    const names = Array.from({ length: 10 }, (_, i) => `soc-2026-${String(i + 1).padStart(4, "0")}`);
    const real = fs.readdirSync;
    const listed: string[][] = [];
    vi.spyOn(fs, "readdirSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      const entries = (real as (...a: unknown[]) => string[])(p, ...rest);
      if (!String(p).endsWith("findings")) return entries;
      // Every order the folder could list them in: as they are, reversed, and shuffled by a fixed step (7 and 10 have no common factor, so the step visits every name).
      const order = [entries, [...entries].reverse(), entries.map((_, i) => entries[(i * 7 + 3) % entries.length]!)][listed.length % 3]!;
      listed.push([...order]); // a copy: the command sorts the array it is given
      return order;
    }) as typeof fs.readdirSync);
    for (let round = 0; round < 3; round++) {
      const dir = contentWith([]);
      for (const id of names) writeRaw(dir, `findings/${id}.json`, "");
      expect(() => readStoredRecords(dir, { date: D, ids: NONE }, "c")).toThrow("Stored records: c/findings/soc-2026-0001.json is empty;");
    }
    expect(listed).toHaveLength(3);
    expect(listed[1]![0]).toBe("soc-2026-0010.json");
    expect(listed[2]![0]).not.toBe("soc-2026-0001.json");
  });
});

describe("the stored records the command gives the engine", () => {
  /** The fixture world's own stored findings as they stood before the weekday, with its glossary, in a content folder. */
  function worldFolder(change: (f: Record<string, any>) => void = () => {}): string {
    const dir = tempDir("vcli-world");
    for (const f of storedFindingsBefore(WEEKDAY)) {
      const copy = JSON.parse(JSON.stringify(f)) as Record<string, any>;
      change(copy);
      writeJson(dir, `findings/${f.id}.json`, copy);
    }
    writeJson(dir, "glossary.json", storedGlossary(WEEKDAY));
    writeJson(dir, "corrections.json", { schema_version: 1, corrections: [] });
    return dir;
  }
  const weekdayArgs = (...extra: string[]): string[] => ["fixtures/drafts/valid-weekday.json", ...WEEKDAY_FLAGS, ...extra];

  it("E1: the fixture world as stored records leaves the valid weekday draft valid", () => {
    vi.stubEnv("UT_CONTENT_DIR", worldFolder());
    expect(cli(weekdayArgs("--json"))).toEqual({ code: 0, out: ["[]"], err: [] });
    const stored = draftCall().stored!;
    expect(stored.findings.length).toBeGreaterThan(5);
    expect(stored.terms).toEqual(storedGlossary(WEEKDAY).terms);
    expect(stored.corrections).toEqual([]);
  });

  it("E2: the verdict follows the stored record the draft names: a finding filed with no AI role as a Notable fails the draft that briefs it", () => {
    const dir = worldFolder((f) => {
      if (f.id !== "soc-2026-0145") return;
      f.ai = { role: "none", confidence: null, systems: [], evidence: [] };
      f.explainer.ai_helped = null;
      f.significance = "notable";
    });
    vi.stubEnv("UT_CONTENT_DIR", dir);
    const r = cli(weekdayArgs("--json"));
    expect(r.code).toBe(1);
    expect(codesOf(found(r), "error")).toEqual(["NON_AI_LANDMARK_ONLY"]);
    // The same draft with no stored records is not judged on a record it cannot see.
    vi.stubEnv("UT_CONTENT_DIR", QUIET);
    expect(cli(weekdayArgs("--json"))).toEqual({ code: 0, out: ["[]"], err: [] });
  });

  it("E3: the English form gives the findings of the last 90 days, the ones the draft names and the ones the context lists in any of its lists, and every correction and term", () => {
    const named = finding("soc-2026-0401", [day(-200)]);
    const inContext = JSON.parse(JSON.stringify(readJ("fixtures/context/weekday.json")));
    const listed = finding("soc-2026-0402", [day(-250)]);
    inContext.recent_findings = [...inContext.recent_findings, { ...inContext.recent_findings[0], id: listed.id }];
    const window = finding("soc-2026-0403", [day(-60)]);
    const unrelated = finding("soc-2026-0404", [day(-120)]);
    const matched = finding("soc-2026-0405", [day(-220)]);
    inContext.candidates[0].stored_finding = matched.id;
    const dir = contentWith([named, listed, window, unrelated, matched], { corrections: { schema_version: 1, corrections: storedWeekdayCorrections() }, glossary: storedGlossary() });
    const { root } = makeRun();
    vi.stubEnv("UT_CONTENT_DIR", dir);
    const draft = readJ("fixtures/drafts/valid-weekday.json");
    draft.new_findings[0].related = [named.id];
    writeJson(root, "drafts/named.json", draft);
    writeJson(root, "logs/context.json", inContext);
    cli(["drafts/named.json", "--context", "logs/context.json", "--evidence", `logs/${WEEKDAY}.evidence.json`, "--metrics", `content/metrics/${WEEKDAY}.json`, "--pack", `packs/${WEEKDAY}.json`], root);
    const stored = draftCall().stored!;
    expect(stored.findings.map((f) => f.id)).toEqual(["soc-2026-0401", "soc-2026-0402", "soc-2026-0403", "soc-2026-0405"]);
    expect(stored.corrections).toEqual(storedWeekdayCorrections());
    expect(stored.terms).toEqual(storedGlossary().terms);
    expect(stored.findings.find((f) => f.id === "soc-2026-0403")).toEqual(window);
  });

  it("E4: the window is D = the context's date, not the date of the file name or the clock", () => {
    const inside = finding("soc-2026-0410", [day(-90)]);
    const outside = finding("soc-2026-0411", [day(-91)]);
    const { root } = makeRun();
    vi.stubEnv("UT_CONTENT_DIR", contentWith([inside, outside]));
    const argv = (context: string): string[] => [
      `drafts/${WEEKDAY}.json`, "--context", context, "--evidence", `logs/${WEEKDAY}.evidence.json`,
      "--metrics", `content/metrics/${WEEKDAY}.json`, "--pack", `packs/${WEEKDAY}.json`,
    ];
    cli(argv(`logs/${WEEKDAY}.context.json`), root);
    expect(ids(draftCall().stored)).toEqual([inside.id]);
    // A context for the day after moves the window by a day: the finding briefed 90 days before D is out of it.
    writeJson(root, "logs/next.json", { ...readJ("fixtures/context/weekday.json"), date: day(1) });
    cli(argv("logs/next.json"), root);
    expect(ids(draftCall().stored)).toEqual([]);
    // A context for the day before moves it the other way: both are in.
    writeJson(root, "logs/previous.json", { ...readJ("fixtures/context/weekday.json"), date: day(-1) });
    cli(argv("logs/previous.json"), root);
    expect(ids(draftCall().stored)).toEqual([outside.id, inside.id].sort());
  });

  it("E5: a missing, empty or unrelated content folder gives the engine `stored: null`, and no error", () => {
    for (const dir of [path.join(QUIET, "nowhere"), QUIET]) {
      vi.stubEnv("UT_CONTENT_DIR", dir);
      expect(cli(weekdayArgs("--json"))).toEqual({ code: 0, out: ["[]"], err: [] });
      expect(draftCall().stored).toBeNull();
    }
  });

  it("E6: the content folder is UT_CONTENT_DIR, else content/ under the root", () => {
    const { root } = makeRun();
    writeRaw(root, "content/corrections.json", "{ broken");
    // UT_CONTENT_DIR names another folder: content/ is not read.
    vi.stubEnv("UT_CONTENT_DIR", QUIET);
    expect(cli([`drafts/${WEEKDAY}.json`, "--metrics", `content/metrics/${WEEKDAY}.json`], root).code).toBe(0);
    // Unset (or empty): content/ under the root is read, and it is broken.
    vi.stubEnv("UT_CONTENT_DIR", "");
    const r = cli([`drafts/${WEEKDAY}.json`], root);
    expect(r.code).toBe(2);
    expect(r.out).toEqual([]);
    expect(r.err).toEqual(["Stored records: content/corrections.json is not valid JSON (at character 2); rewrite the whole file as valid JSON. The draft was not judged; repair or remove that file (npm run validate:all checks the whole content folder)."]);
    // A relative UT_CONTENT_DIR is read from the root, an absolute one as it is.
    vi.stubEnv("UT_CONTENT_DIR", "content");
    expect(cli([`drafts/${WEEKDAY}.json`], root).err[0]).toContain("Stored records: content/corrections.json");
    vi.stubEnv("UT_CONTENT_DIR", path.join(root, "content"));
    expect(cli([`drafts/${WEEKDAY}.json`], root).err[0]).toContain(`Stored records: ${path.join(root, "content", "corrections.json")}`);
  });

  it("E6b: a content folder that is a file stops a draft run, in both forms, with exit 2 and its name, and the engines are not called", () => {
    const { root } = makeRun();
    writeRaw(root, "not-a-folder", "x");
    vi.stubEnv("UT_CONTENT_DIR", "not-a-folder");
    const message = "Stored records: not-a-folder is not a folder. The draft was not judged; give the content folder (UT_CONTENT_DIR, else content/).";
    draftSpy.mockClear();
    zhSpy.mockClear();
    expect(cli([`drafts/${WEEKDAY}.json`, "--metrics", `content/metrics/${WEEKDAY}.json`], root)).toEqual({ code: 2, out: [], err: [message] });
    expect(cli([`drafts/${WEEKDAY}.zh.json`, "--zh", `drafts/${WEEKDAY}.json`], root)).toEqual({ code: 2, out: [], err: [message] });
    expect(draftSpy).not.toHaveBeenCalled();
    expect(zhSpy).not.toHaveBeenCalled();
    // --all judges the same path as a folder that is not one: a verdict, as A5 shows.
    expect(cli(["--all"], root).code).toBe(1);
    // A path that runs through a file is a folder that is not there: no stored records, no error.
    vi.stubEnv("UT_CONTENT_DIR", "not-a-folder/inside");
    expect(cli([`drafts/${WEEKDAY}.json`, "--metrics", `content/metrics/${WEEKDAY}.json`, "--json"], root)).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(draftCall().stored).toBeNull();
  });

  it("E7: a stored file the run cannot read stops it with exit 2 and the file's name, before the engine is called", () => {
    const dir = worldFolder();
    writeRaw(dir, "glossary.json", '{"schema_version": 1, "terms": "none"}');
    vi.stubEnv("UT_CONTENT_DIR", dir);
    draftSpy.mockClear();
    const r = cli(weekdayArgs("--json"));
    expect(r.code).toBe(2);
    expect(r.out).toEqual([]);
    expect(r.err).toHaveLength(1);
    expect(r.err[0]).toMatch(new RegExp(`^Stored records: ${escapeRe(dir)}/glossary\\.json is not a glossary file \\(.+\\)\\. The draft was not judged;`));
    expect(draftSpy).not.toHaveBeenCalled();
  });

  it("E8: the Chinese form gives the findings the English draft names, with every correction and term, and no window", () => {
    const { root } = makeRun();
    const named = finding("soc-2026-0420", [day(-200)]);
    const recent = finding("soc-2026-0421", [day(-1)]);
    const dir = contentWith([named, recent], { corrections: { schema_version: 1, corrections: storedWeekdayCorrections() }, glossary: storedGlossary() });
    vi.stubEnv("UT_CONTENT_DIR", dir);
    const english = readJ("fixtures/drafts/valid-weekday.json");
    english.new_findings[0].related = [named.id];
    writeJson(root, "drafts/en.json", english);
    cli([`drafts/${WEEKDAY}.zh.json`, "--zh", "drafts/en.json"], root);
    const { inputs } = zhCall();
    expect(ids(inputs.stored ?? null)).toEqual([named.id]);
    expect(inputs.stored!.corrections).toEqual(storedWeekdayCorrections());
    expect(inputs.stored!.terms).toEqual(storedGlossary().terms);
  });

  it("E8b (F-54): the Chinese form also gives every backlog finding its context lists, whatever its age, so DUAL_USE reads a biology one's numbered steps only when the folder holds its record", () => {
    const id = "bio-2026-0150";
    const key = `backlog.${id}.title`;
    const english = readJ("fixtures/drafts/valid-weekday.json");
    // A backlog finding that only the Chinese context names: the English draft does not.
    expect(JSON.stringify(english)).not.toContain(id);
    const context = readJ("fixtures/drafts-zh/weekday.zh-context.json");
    context.strings.push({ key, en: "A sample sentence.", kind: "line", cap_chars: 100, group: null });
    const draft = readJ("fixtures/drafts-zh/valid-weekday.zh.json");
    draft.strings[key] = "步驟一：混合。步驟二：加熱。";
    const { root } = makeRun();
    writeJson(root, `logs/${WEEKDAY}.zh-context.json`, context);
    writeJson(root, `drafts/${WEEKDAY}.zh.json`, draft);
    const run = (): Ran => cli([`drafts/${WEEKDAY}.zh.json`, "--zh", `drafts/${WEEKDAY}.json`, "--json"], root);

    // No record in the folder: the field cannot be told, so the steps are not read.
    vi.stubEnv("UT_CONTENT_DIR", contentWith([finding("bio-2026-0151", [day(-200)])]));
    expect(run()).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(ids(zhCall().inputs.stored)).toEqual([]);

    // The record of the backlog finding, filed in biology and briefed 200 days before D, is given, and the steps are an error.
    vi.stubEnv("UT_CONTENT_DIR", contentWith([finding(id, [day(-200)]), finding("bio-2026-0151", [day(-200)])]));
    const r = run();
    expect(r.code).toBe(1);
    expect(found(r).map((i) => `${i.code} ${i.severity}`)).toEqual(["DUAL_USE error"]);
    expect(found(r)[0]!.path).toContain(key);
    expect(found(r)[0]!.message).toContain("2 numbered steps");
    expect(ids(zhCall().inputs.stored)).toEqual([id]);
  });

  it("E9: the Chinese form stops on a stored file it cannot read too, naming the folder as the content folder is set", () => {
    const { root } = makeRun();
    const dir = contentWith([], { corrections: { schema_version: 1, corrections: [] } });
    writeRaw(dir, "glossary.json", "");
    vi.stubEnv("UT_CONTENT_DIR", dir);
    zhSpy.mockClear();
    const r = cli([`drafts/${WEEKDAY}.zh.json`, "--zh", `drafts/${WEEKDAY}.json`], root);
    expect(r.code).toBe(2);
    expect(r.err).toEqual([`Stored records: ${dir}/glossary.json is empty; rewrite the whole file as valid JSON. The draft was not judged; repair or remove that file (npm run validate:all checks the whole content folder).`]);
    expect(zhSpy).not.toHaveBeenCalled();
    // The default folder is shown as `content`, as the English form shows it.
    vi.stubEnv("UT_CONTENT_DIR", "");
    writeRaw(root, "content/glossary.json", "");
    const dflt = cli([`drafts/${WEEKDAY}.zh.json`, "--zh", `drafts/${WEEKDAY}.json`], root);
    expect(dflt.code).toBe(2);
    expect(dflt.err[0]).toMatch(/^Stored records: content\/glossary\.json is empty;/);
  });
});

// ── Output: text, --json, order ──────────────────────────────────────────────────────────────────

describe("the output", () => {
  /** Makes the engine answer with these issues, in the order given. */
  function answer(issues: ValidationIssue[], over: Partial<ValidationResult> = {}): void {
    const base = toResult(issues);
    draftSpy.mockReturnValueOnce({ ...base, ...over, draft: null });
  }
  const IS: Record<string, ValidationIssue> = {
    e1: issue("error", "WORDS", "story.found", "First error.", "Fix the first."),
    w1: issue("warning", "READING_LEVEL", "story.matters", "First warning.", null),
    e2: issue("error", "COUNTS", "items", "Second error.", null),
    w2: issue("warning", "REPORT_UPHELD", "corrections[0]", "Second warning.", "Fix the second."),
  };
  const argv = (): string[] => ["fixtures/drafts/valid-weekday.json", ...WEEKDAY_FLAGS];

  it("O1: text output is the errors then the warnings, each in the engine's order, then the summary; the exit code follows the errors", () => {
    answer([IS.w1!, IS.e1!, IS.w2!, IS.e2!]);
    const r = cli(argv());
    expect(r.code).toBe(1);
    expect(r.err).toEqual([]);
    expect(r.out).toEqual([
      "ERROR WORDS story.found: First error. Hint: Fix the first.",
      "ERROR COUNTS items: Second error.",
      "WARN READING_LEVEL story.matters: First warning.",
      "WARN REPORT_UPHELD corrections[0]: Second warning. Hint: Fix the second.",
      "fixtures/drafts/valid-weekday.json: 2 errors, 2 warnings.",
    ]);
  });

  it("O2: --json is one array of {code, path, message, severity}, the same issues in the same order, with no hint and nothing else", () => {
    answer([IS.w1!, IS.e1!, IS.w2!, IS.e2!]);
    const r = cli([...argv(), "--json"]);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([]);
    expect(r.out).toHaveLength(1);
    const items = JSON.parse(r.out[0]!) as Finding4[];
    expect(items.map((i) => i.code)).toEqual(["WORDS", "COUNTS", "READING_LEVEL", "REPORT_UPHELD"]);
    expect(items.map((i) => i.severity)).toEqual(["error", "error", "warning", "warning"]);
    for (const item of items) expect(Object.keys(item)).toEqual(["code", "path", "message", "severity"]);
    expect(items[0]).toEqual({ code: "WORDS", path: "story.found", message: "First error.", severity: "error" });
    expect(r.out[0]).toBe(JSON.stringify(items, null, 2));
    expect(r.out[0]).not.toContain("hint");
    expect(r.out[0]).not.toContain("Hint");
  });

  it("O3: the order is that of `errors` and `warnings`, not of `issues`", () => {
    const base = toResult([IS.e1!, IS.w1!, IS.e2!, IS.w2!]);
    draftSpy.mockReturnValueOnce({ ...base, errors: [IS.e2!, IS.e1!], warnings: [IS.w2!, IS.w1!], issues: [IS.e1!, IS.w1!, IS.e2!, IS.w2!], draft: null });
    expect(found(cli([...argv(), "--json"])).map((i) => i.code)).toEqual(["COUNTS", "WORDS", "REPORT_UPHELD", "READING_LEVEL"]);
  });

  it("O4: warnings alone never change the exit code: the run is valid, with its warnings listed", () => {
    answer([IS.w1!, IS.w2!]);
    const text = cli(argv());
    expect(text.code).toBe(0);
    expect(text.out).toEqual([
      "WARN READING_LEVEL story.matters: First warning.",
      "WARN REPORT_UPHELD corrections[0]: Second warning. Hint: Fix the second.",
      "fixtures/drafts/valid-weekday.json: 0 errors, 2 warnings.",
    ]);
    answer([IS.w1!]);
    const json = cli([...argv(), "--json"]);
    expect(json.code).toBe(0);
    expect(found(json)).toEqual([{ code: "READING_LEVEL", path: "story.matters", message: "First warning.", severity: "warning" }]);
  });

  it("O5: the summary says `1 error` and `1 warning` in the singular and `0` and `2` in the plural", () => {
    answer([IS.e1!, IS.w1!]);
    expect(cli(argv()).out.at(-1)).toBe("fixtures/drafts/valid-weekday.json: 1 error, 1 warning.");
    answer([IS.e1!, IS.e2!]);
    expect(cli(argv()).out.at(-1)).toBe("fixtures/drafts/valid-weekday.json: 2 errors, 0 warnings.");
    answer([]);
    expect(cli(argv())).toEqual({ code: 0, out: ["fixtures/drafts/valid-weekday.json: 0 errors, 0 warnings."], err: [] });
  });

  it("O6: a clean run is `[]` with --json, and nothing else is printed on standard output", () => {
    expect(cli([...argv(), "--json"])).toEqual({ code: 0, out: ["[]"], err: [] });
  });

  it("O7: with --json the summary line is not printed, whatever the result", () => {
    answer([IS.e1!]);
    const r = cli([...argv(), "--json"]);
    expect(r.out.join("\n")).not.toContain("1 error");
    expect(r.out).toHaveLength(1);
  });

  it("O8: a real invalid fixture prints its issues as ERROR lines with the hint, the summary names the file as it was typed", () => {
    const r = cli(["fixtures/drafts/invalid--DATE_MISMATCH.json", ...WEEKDAY_FLAGS]);
    expect(r.code).toBe(1);
    expect(r.out.length).toBeGreaterThanOrEqual(2);
    expect(r.out[0]).toMatch(/^ERROR DATE_MISMATCH [^:]+: .+ Hint: .+$/);
    expect(r.out.at(-1)).toMatch(/^fixtures\/drafts\/invalid--DATE_MISMATCH\.json: [1-9]\d* errors?, \d+ warnings?\.$/);
    const absolute = cli([path.join(ROOT, "fixtures/drafts/invalid--DATE_MISMATCH.json"), ...WEEKDAY_FLAGS]);
    expect(absolute.out.at(-1)!.startsWith(`${path.join(ROOT, "fixtures/drafts/invalid--DATE_MISMATCH.json")}: `)).toBe(true);
  });

  it("O9: the Chinese form prints the same way, and --all prints the folder as it was given", () => {
    zhSpy.mockReturnValueOnce({ ...toResult([IS.e1!, IS.w2!]), draft: null });
    const zh = cli(["fixtures/drafts-zh/valid-weekday.zh.json", "--zh", "fixtures/drafts/valid-weekday.json", ...ZH_FLAGS]);
    expect(zh.code).toBe(1);
    expect(zh.out).toEqual([
      "ERROR WORDS story.found: First error. Hint: Fix the first.",
      "WARN REPORT_UPHELD corrections[0]: Second warning. Hint: Fix the second.",
      "fixtures/drafts-zh/valid-weekday.zh.json: 1 error, 1 warning.",
    ]);
    allSpy.mockReturnValueOnce({ ...toResult([IS.w1!, IS.e2!]), files: [] });
    const all = cli(["--all", "--dir", "some/folder", "--json"]);
    expect(all.code).toBe(1);
    expect(found(all).map((i) => i.code)).toEqual(["COUNTS", "READING_LEVEL"]);
    allSpy.mockReturnValueOnce({ ...toResult([IS.w1!]), files: [] });
    expect(cli(["--all", "--dir", "some/folder"])).toEqual({
      code: 0, out: ["WARN READING_LEVEL story.matters: First warning.", "some/folder: 0 errors, 1 warning."], err: [],
    });
  });

  it("O10: a draft key with a line break and an escape gives its issue on one line in the text, and --json keeps the message exactly", () => {
    const { root } = makeRun();
    const key = `bad${ch(0x0a)}ERROR FAKE (root): forged${ch(0x1b)}[31m`;
    writeJson(root, "drafts/quote.json", { ...readJ("fixtures/drafts/valid-weekday.json"), [key]: 1 });
    const text = cli(["drafts/quote.json", ...WEEKDAY_ABS], root);
    expect(text.code).toBe(1);
    expect(text.err).toEqual([]);
    expect(text.out).toHaveLength(2);
    expect(text.out[1]).toBe("drafts/quote.json: 1 error, 0 warnings.");
    expect(text.out[0]).toMatch(/^ERROR SCHEMA /);
    expect(text.out[0]).toContain("Unknown key \"bad\\nERROR FAKE (root): forged" + escape(0x1b) + "[31m\"; remove it.");
    for (const line of text.out) for (const code of [0x0a, 0x0d, 0x1b]) expect(line.includes(ch(code)), `U+${code.toString(16)}`).toBe(false);
    // In --json the message is the engine's, with the line break in it (JSON writes it as an escape).
    const json = cli(["drafts/quote.json", ...WEEKDAY_ABS, "--json"], root);
    expect(json.code).toBe(1);
    expect(found(json).map((i) => i.message)).toEqual([`Unknown key "${key}"; remove it.`]);
    expect(json.out[0]!.split("\n").every((l) => !l.includes(ch(0x1b)))).toBe(true);
  });

  it("O11: an input that fails its schema is told on one line, even when the file's keys hold line breaks", () => {
    const { root } = makeRun();
    const key = `a${ch(0x0a)}b${ch(0x1b)}`;
    writeJson(root, "logs/odd.json", { ...readJ("fixtures/context/weekday.json"), [key]: 1 });
    const r = cli([`drafts/${WEEKDAY}.json`, "--context", "logs/odd.json"], root);
    expect(r.code).toBe(2);
    expect(r.out).toEqual([]);
    expect(r.err).toHaveLength(1);
    expect(r.err[0]).toMatch(/^--context: logs\/odd\.json is not an agent context \(.*a\\nb\\u001b.*\)\.$/);
    for (const code of [0x0a, 0x0d, 0x1b]) expect(r.err[0]!.includes(ch(code)), `U+${code.toString(16)}`).toBe(false);
  });
});

// ── --all ────────────────────────────────────────────────────────────────────────────────────────

describe("--all", () => {
  it("A1: an empty folder, a missing folder and a folder holding only .DS_Store or a root README.md pass, and `--json` prints []", () => {
    const base = tempDir("vcli-all");
    fs.mkdirSync(path.join(base, "empty"));
    writeRaw(base, "dsstore/.DS_Store", "x");
    writeRaw(base, "readme/README.md", "x");
    for (const dir of ["empty", "missing", "dsstore", "readme"]) {
      expect(cli(["--all", "--dir", path.join(base, dir)])).toEqual({ code: 0, out: [`${path.join(base, dir)}: 0 errors, 0 warnings.`], err: [] });
      expect(cli(["--all", "--dir", path.join(base, dir), "--json"])).toEqual({ code: 0, out: ["[]"], err: [] });
    }
  });

  it("A2: the folder is --dir, else UT_CONTENT_DIR, else content/ under the root; --dir wins over the variable", () => {
    const base = bareRoot();
    fs.mkdirSync(path.join(base, "content"));
    writeRaw(base, "env/stray.txt", "x");
    writeRaw(base, "flag/stray.txt", "x");
    vi.stubEnv("UT_CONTENT_DIR", path.join(base, "env"));
    const fromEnv = cli(["--all", "--json"], base);
    expect(found(fromEnv).map((i) => i.path)).toEqual(["stray.txt: (file)"]);
    expect(allSpy.mock.calls.at(-1)![0]).toBe(path.join(base, "env"));
    const fromFlag = cli(["--all", "--dir", "flag", "--json"], base);
    expect(found(fromFlag).map((i) => i.path)).toEqual(["stray.txt: (file)"]);
    expect(allSpy.mock.calls.at(-1)![0]).toBe(path.join(base, "flag"));
    // The flag beats the variable: the empty folder given with --dir passes though the variable names a folder with a stray file.
    expect(cli(["--all", "--dir", "content", "--json"], base)).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(allSpy.mock.calls.at(-1)![0]).toBe(path.join(base, "content"));
    // No flag, no variable: content/ under the root.
    vi.stubEnv("UT_CONTENT_DIR", "");
    writeRaw(base, "content/stray.txt", "x");
    expect(found(cli(["--all", "--json"], base)).map((i) => i.path)).toEqual(["stray.txt: (file)"]);
    expect(allSpy.mock.calls.at(-1)![0]).toBe(path.join(base, "content"));
    // A relative UT_CONTENT_DIR is read from the root.
    vi.stubEnv("UT_CONTENT_DIR", "env");
    expect(found(cli(["--all", "--json"], base)).map((i) => i.path)).toEqual(["stray.txt: (file)"]);
    expect(allSpy.mock.calls.at(-1)![0]).toBe(path.join(base, "env"));
  });

  it("A3: the label of the text summary is the folder as it was given: --dir as typed, else the variable as set, else `content`", () => {
    const base = tempDir("vcli-all");
    fs.mkdirSync(path.join(base, "d"));
    expect(cli(["--all", "--dir", "d"], base).out).toEqual(["d: 0 errors, 0 warnings."]);
    vi.stubEnv("UT_CONTENT_DIR", "d");
    expect(cli(["--all"], base).out).toEqual(["d: 0 errors, 0 warnings."]);
    vi.stubEnv("UT_CONTENT_DIR", "");
    expect(cli(["--all"], base).out).toEqual(["content: 0 errors, 0 warnings."]);
  });

  it("A4: a folder with a file outside the layout is invalid: exit 1, the issue names the file, the summary counts it", () => {
    const base = tempDir("vcli-all");
    writeRaw(base, "d/stray.txt", "x");
    const r = cli(["--all", "--dir", path.join(base, "d")]);
    expect(r.code).toBe(1);
    expect(r.out[0]).toMatch(/^ERROR FILE_LAYOUT stray\.txt: \(file\): stray\.txt is outside content\/'s layout .+ Hint: .+$/);
    expect(r.out.at(-1)).toBe(`${path.join(base, "d")}: 1 error, 0 warnings.`);
    const json = cli(["--all", "--dir", path.join(base, "d"), "--json"]);
    expect(json.code).toBe(1);
    expect(found(json)).toEqual([expect.objectContaining({ code: "FILE_LAYOUT", path: "stray.txt: (file)", severity: "error" })]);
  });

  it("A5: a file given as the folder is invalid, not a crash", () => {
    const base = tempDir("vcli-all");
    writeRaw(base, "file", "x");
    const r = cli(["--all", "--dir", path.join(base, "file"), "--json"]);
    expect(r.code).toBe(1);
    expect(found(r)).toEqual([expect.objectContaining({ code: "SCHEMA", path: "(root)", severity: "error" })]);
  });

  it("A6: the config is read from the root only when the folder holds something: an empty or missing folder passes whatever config/ holds", () => {
    const { root } = makeRun("weekday", "none"); // no config/ at all
    fs.mkdirSync(path.join(root, "empty"));
    writeRaw(root, "dots/.DS_Store", "x");
    for (const dir of ["empty", "missing", "dots"]) {
      expect(cli(["--all", "--dir", dir], root).code).toBe(0);
      expect(allSpy.mock.calls.at(-1)![1]).toEqual({});
    }
    const r = cli(["--all", "--dir", "content"], root);
    expect(r.code).toBe(2);
    expect(r.out).toEqual([]);
    expect(r.err).toHaveLength(1);
    expect(r.err[0]).toMatch(/^config\/ cannot be used: [1-9]\d* problems?\.\n/);
  });

  it("A7: a folder with files is judged with the root's config, passed to the engine, and every config problem is listed", () => {
    const { root } = makeRun("weekday", "copy");
    cli(["--all", "--dir", "content", "--json"], root);
    const opts = allSpy.mock.calls.at(-1)![1]!;
    expect(opts.config!.fields).toEqual(readJ("config/fields.json"));
    expect(allSpy.mock.calls.at(-1)![0]).toBe(path.join(root, "content"));
    for (const name of Object.values(CONFIG_FILES)) fs.rmSync(path.join(root, "config", name), { force: true });
    const r = cli(["--all", "--dir", "content"], root);
    expect(r.code).toBe(2);
    const lines = r.err[0]!.split("\n");
    expect(lines[0]).toBe(`config/ cannot be used: ${Object.keys(CONFIG_FILES).length} problems.`);
    expect(lines.length - 1).toBe(Object.keys(CONFIG_FILES).length);
    expect(lines.slice(1).every((l) => /^ {2}CONFIG_FILE \S+: /.test(l))).toBe(true);
  });

  it("A8: --all runs the folder engine once and no other: a bad corrections.json is the engine's issue (exit 1), not a stop on stored records (exit 2)", () => {
    const root = bareRoot();
    writeRaw(root, "d/corrections.json", "{ broken");
    const r = cli(["--all", "--dir", "d", "--json"], root);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([]);
    expect(allSpy).toHaveBeenCalledTimes(1);
    expect(draftSpy).not.toHaveBeenCalled();
    expect(zhSpy).not.toHaveBeenCalled();
    expect(found(r).map((i) => `${i.severity} ${i.code}`)).toEqual(["error SCHEMA"]);
  });

  it("A9: a valid content folder passes, in both outputs, judged with the root's config", () => {
    const dir = worldDir(storedWorld());
    expect(cli(["--all", "--dir", dir, "--json"])).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(cli(["--all", "--dir", dir])).toEqual({ code: 0, out: [`${dir}: 0 errors, 0 warnings.`], err: [] });
    const call = allSpy.mock.calls.at(-1)!;
    expect(call[0]).toBe(dir);
    expect(call[1]!.config!.fields).toEqual(readJ("config/fields.json"));
  });

  it("A10: a folder with a stray file or a broken record is invalid: exit 1, the issue names the file, standard error stays empty", () => {
    const stray = worldDir(storedWorld());
    writeRaw(stray, "stray.txt", "x");
    const a = cli(["--all", "--dir", stray, "--json"]);
    expect(a.code).toBe(1);
    expect(a.err).toEqual([]);
    expect(found(a).map((i) => `${i.severity} ${i.code}`)).toEqual(["error FILE_LAYOUT"]);
    expect(found(a)[0]!.path).toContain("stray.txt");
    const broken = worldDir(storedWorld());
    writeJson(broken, "glossary.json", { schema_version: 1 });
    const b = cli(["--all", "--dir", broken, "--json"]);
    expect(b.code).toBe(1);
    expect(b.err).toEqual([]);
    expect(found(b).map((i) => `${i.severity} ${i.code}`)).toEqual(["error SCHEMA"]);
    expect(found(b)[0]!.path).toContain("glossary.json");
  });
});

// ── Config ───────────────────────────────────────────────────────────────────────────────────────

describe("the config", () => {
  it("C1: a draft is judged with config/ under the root, and a root without it is exit 2 listing every problem", () => {
    const { root } = makeRun("weekday", "none");
    const r = cli([`drafts/${WEEKDAY}.json`], root);
    expect(r.code).toBe(2);
    expect(r.out).toEqual([]);
    const lines = r.err[0]!.split("\n");
    expect(lines[0]).toBe(`config/ cannot be used: ${Object.keys(CONFIG_FILES).length} problems.`);
    expect(lines).toHaveLength(Object.keys(CONFIG_FILES).length + 1);
    expect(r.err[0]).not.toContain(USAGE);
  });

  it("C2: a config file that breaks its schema is listed with its code, path and message", () => {
    const { root } = makeRun("weekday", "copy");
    fs.writeFileSync(path.join(root, "config", "fields.json"), '{"version": "one"}');
    const r = cli([`drafts/${WEEKDAY}.json`], root);
    expect(r.code).toBe(2);
    expect(r.err[0]).toMatch(/^config\/ cannot be used: [1-9]\d* problems?\.\n {2}CONFIG_SCHEMA \S+: /);
  });

  it("C3: a draft that cannot be read, and a usage error, need no config", () => {
    const { root } = makeRun("weekday", "none");
    expect(cli(["drafts/none.json"], root).err).toEqual(["Cannot read drafts/none.json: it was not found."]);
    writeRaw(root, "drafts/empty.json", "");
    expect(cli(["drafts/empty.json"], root).code).toBe(1);
    expect(cli(["--bogus"], root).code).toBe(2);
  });
});

// ── The Chinese form ─────────────────────────────────────────────────────────────────────────────

describe("the Chinese form", () => {
  const zh = (edition: EditionName = "weekday") => `drafts/${EDITIONS[edition].date}.zh.json`;

  it("Z1: with its defaults it validates valid-<day>.zh.json against valid-<day>.json for each edition", () => {
    for (const edition of EDITIONS_LIST()) {
      const { root, date } = makeRun(edition);
      expect(cli([zh(edition), "--zh", `drafts/${date}.json`, "--json"], root), edition).toEqual({ code: 0, out: ["[]"], err: [] });
      const call = zhCall();
      expect(call.options).toEqual({ fileDate: date });
      expect(call.inputs.context).toEqual(ZhContext.parse(readJ(`fixtures/drafts-zh/${edition}.zh-context.json`)));
      expect(call.inputs.evidence).toEqual(Evidence.parse(readJ(`fixtures/drafts-zh/${edition}.zh-evidence.json`)));
      expect(call.inputs.config.fields).toEqual(readJ("config/fields.json"));
      expect(call.zh).toEqual(readJ(`fixtures/drafts-zh/valid-${edition}.zh.json`));
      expect(call.en).toEqual(readJ(`fixtures/drafts/valid-${edition}.json`));
    }
  });

  it("Z2: the defaults are logs/D.zh-context.json and logs/D.zh-evidence.json, and a missing one is exit 2 naming its flag and path", () => {
    const { root, date } = makeRun();
    for (const [flag, rel] of [["zh-context", `logs/${date}.zh-context.json`], ["zh-evidence", `logs/${date}.zh-evidence.json`]] as const) {
      fs.renameSync(path.join(root, rel), path.join(root, `${rel}.gone`));
      expect(cli([zh(), "--zh", `drafts/${date}.json`], root)).toEqual({ code: 2, out: [], err: [`--${flag}: ${rel} was not found.`] });
      fs.renameSync(path.join(root, `${rel}.gone`), path.join(root, rel));
    }
  });

  it("Z3: the date is the Chinese draft's file name, else its own `date`; the English draft's name is not looked at", () => {
    const { root, date } = makeRun();
    fs.copyFileSync(path.join(root, zh()), path.join(root, "drafts", "2026-10-15.zh.json"));
    expect(cli(["drafts/2026-10-15.zh.json", "--zh", `drafts/${date}.json`], root)).toEqual({ code: 2, out: [], err: ["--zh-context: logs/2026-10-15.zh-context.json was not found."] });
    fs.copyFileSync(path.join(root, zh()), path.join(root, "drafts", "chinese.json"));
    expect(cli(["drafts/chinese.json", "--zh", `drafts/${date}.json`, "--json"], root)).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(zhCall().options).toEqual({ fileDate: null });
    // A name that only looks like a dated Chinese one.
    fs.copyFileSync(path.join(root, zh()), path.join(root, "drafts", "2026-10-17.zh.json.bak"));
    expect(cli(["drafts/2026-10-17.zh.json.bak", "--zh", `drafts/${date}.json`, "--json"], root)).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(zhCall().options).toEqual({ fileDate: null });
    // The name of an English draft is not a Chinese draft's name.
    fs.copyFileSync(path.join(root, zh()), path.join(root, "drafts", "2026-10-16.json"));
    expect(cli(["drafts/2026-10-16.json", "--zh", `drafts/${date}.json`, "--json"], root)).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(zhCall().options).toEqual({ fileDate: null });
  });

  it("Z4: a Chinese draft with no usable date and no dated name needs both flags, else a usage error naming the file form", () => {
    const { root, date } = makeRun();
    const draft = readJ(`fixtures/drafts-zh/valid-weekday.zh.json`);
    for (const value of [undefined, "2026-13-01", "soon"]) {
      writeJson(root, "drafts/undated.json", { ...draft, date: value });
      const r = cli(["drafts/undated.json", "--zh", `drafts/${date}.json`], root);
      expect(r.code).toBe(2);
      expect(r.err[0]).toMatch(/^Cannot tell the edition date of drafts\/undated\.json: name the file YYYY-MM-DD\.zh\.json, or give every input flag\./);
      expect(r.err[0]).toContain(USAGE);
    }
  });

  it("Z5: --zh-context and --zh-evidence are read through their schemas, and a wrong file is exit 2 naming its flag", () => {
    const { root, date } = makeRun();
    writeRaw(root, "bad/wrong.json", "{}");
    writeRaw(root, "bad/empty.json", "");
    const base = [zh(), "--zh", `drafts/${date}.json`];
    const context = cli([...base, "--zh-context", "bad/wrong.json"], root);
    expect(context.code).toBe(2);
    expect(context.err[0]).toMatch(/^--zh-context: bad\/wrong\.json is not a Chinese context \(.+\)\.$/);
    const evidence = cli([...base, "--zh-evidence", "bad/wrong.json"], root);
    expect(evidence.err[0]).toMatch(/^--zh-evidence: bad\/wrong\.json is not an evidence file \(.+\)\.$/);
    expect(cli([...base, "--zh-evidence", "bad/empty.json"], root).err).toEqual(["--zh-evidence: bad/empty.json is empty; rewrite the whole file as valid JSON."]);
    // A context for the English form is not a Chinese context.
    expect(cli([...base, "--zh-context", `logs/${date}.context.json`], root).err[0]).toMatch(/^--zh-context: logs\/.+ is not a Chinese context/);
  });

  it("Z6: the English draft (the value of --zh) that is missing, a folder, empty or not JSON is exit 2 naming --zh", () => {
    const { root, date } = makeRun();
    fs.mkdirSync(path.join(root, "drafts", "folder"));
    writeRaw(root, "drafts/empty.json", "");
    writeRaw(root, "drafts/broken.json", '{"a":');
    const run = (en: string) => cli([zh(), "--zh", en], root);
    expect(run("drafts/none.json")).toEqual({ code: 2, out: [], err: ["--zh: drafts/none.json was not found."] });
    expect(run("drafts/folder")).toEqual({ code: 2, out: [], err: ["--zh: drafts/folder is a folder, not a file."] });
    expect(run("drafts/empty.json")).toEqual({ code: 2, out: [], err: ["--zh: drafts/empty.json is empty; rewrite the whole file as valid JSON."] });
    expect(run("drafts/broken.json").err).toEqual(["--zh: drafts/broken.json is not valid JSON (the text ends early); rewrite the whole file as valid JSON."]);
    expect(run(`drafts/${date}.json`).code).toBe(0);
  });

  it("Z7: an English draft that parses but breaks its schema is judged by the engine: SCHEMA errors with en. in front, exit 1", () => {
    const { root, date } = makeRun();
    writeJson(root, "drafts/en.json", { ...readJ("fixtures/drafts/valid-weekday.json"), surprise: true });
    const r = cli([zh(), "--zh", "drafts/en.json", "--json"], root);
    expect(r.code).toBe(1);
    expect(found(r).map((i) => `${i.code} ${i.path}`)).toEqual(["SCHEMA en.surprise"]);
    expect(date).toBe(WEEKDAY);
  });

  it("Z8: the Chinese draft's problems are the engine's: a Chinese draft with a key too many is SCHEMA, exit 1", () => {
    const { root, date } = makeRun();
    writeJson(root, "drafts/bad.zh.json", { ...readJ("fixtures/drafts-zh/valid-weekday.zh.json"), extra: 1 });
    const r = cli(["drafts/bad.zh.json", "--zh", `drafts/${date}.json`, "--json"], root);
    expect(r.code).toBe(1);
    expect(found(r).map((i) => `${i.code} ${i.path}`)).toEqual(["SCHEMA extra"]);
  });

  it("Z9: --zh-context may be given and read from any path; --zh-evidence likewise", () => {
    const { root, date } = makeRun();
    place(root, "own/context.json", "fixtures/drafts-zh/weekday.zh-context.json");
    place(root, "own/evidence.json", "fixtures/drafts-zh/weekday.zh-evidence.json");
    for (const rel of [`logs/${date}.zh-context.json`, `logs/${date}.zh-evidence.json`]) fs.writeFileSync(path.join(root, rel), "{ broken");
    expect(cli([zh(), "--zh", `drafts/${date}.json`, "--zh-context", "own/context.json", "--zh-evidence", path.join(root, "own/evidence.json")], root).code).toBe(0);
  });
});

// ── The milestone lines, over the fixtures that exist ────────────────────────────────────────────

describe("SPEC §10 P1's milestone lines, over every fixture that exists", () => {
  const list = (dir: string, pattern: RegExp): string[] => (fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => pattern.test(f)).sort() : []);
  const codeOf = (file: string): string => /^(?:invalid|soft)--(.+?)(?:\.zh)?\.json$/.exec(file)![1]!;

  const EN_INVALID = list("fixtures/drafts", /^invalid--.+\.json$/);
  const EN_SOFT = list("fixtures/drafts", /^soft--.+\.json$/);
  const EN_VALID = list("fixtures/drafts", /^valid-.+\.json$/);
  const ZH_INVALID = list("fixtures/drafts-zh", /^invalid--.+\.zh\.json$/);
  const ZH_VALID = list("fixtures/drafts-zh", /^valid-.+\.zh\.json$/);

  /** The text form of a run says what its `--json` form does: one line for each issue, in the same order, then the summary, and the same exit code. */
  const sameInText = (argv: string[], items: Finding4[], code: number): void => {
    const text = cli(argv, ROOT, true);
    expect(text.code).toBe(code);
    expect(text.err).toEqual([]);
    expect(text.out).toHaveLength(items.length + 1);
    items.forEach((item, i) => {
      expect(text.out[i]!.startsWith(`${item.severity === "error" ? "ERROR" : "WARN"} ${item.code} ${item.path}: `)).toBe(true);
    });
    const errors = items.filter((i) => i.severity === "error").length;
    const warnings = items.length - errors;
    expect(text.out.at(-1)).toBe(`${argv[0]}: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`);
  };

  it("M0: the fixtures the milestone needs are there", () => {
    expect(EN_VALID).toEqual(["valid-monday-short.json", "valid-monday.json", "valid-sunday.json", "valid-weekday.json"]);
    expect(ZH_VALID).toEqual(["valid-monday-short.zh.json", "valid-monday.zh.json", "valid-sunday.zh.json", "valid-weekday.zh.json"]);
    expect(EN_INVALID.length).toBeGreaterThan(0);
    expect(ZH_INVALID.length).toBeGreaterThan(0);
    expect(WEEKDAY_FLAGS).toHaveLength(8);
    expect(ZH_FLAGS).toHaveLength(4);
  });

  it.each(EN_INVALID)("M1: `validate fixtures/drafts/%s <flags.txt> --json` exits 1 with exactly the code in its name", (file) => {
    const r = cli([`fixtures/drafts/${file}`, ...WEEKDAY_FLAGS, "--json"], ROOT, true);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(1);
    const items = found(r);
    expect(codesOf(items, "error")).toEqual([codeOf(file)]);
    for (const item of items) expect(Object.keys(item)).toEqual(["code", "path", "message", "severity"]);
    sameInText([`fixtures/drafts/${file}`, ...WEEKDAY_FLAGS], items, 1);
  });

  it.each(EN_SOFT)("M2: `validate fixtures/drafts/%s <flags.txt> --json` exits 0 with no error and exactly its code's warning", (file) => {
    const r = cli([`fixtures/drafts/${file}`, ...WEEKDAY_FLAGS, "--json"], ROOT, true);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    const items = found(r);
    expect(codesOf(items, "error")).toEqual([]);
    expect(codesOf(items, "warning")).toEqual([codeOf(file)]);
    sameInText([`fixtures/drafts/${file}`, ...WEEKDAY_FLAGS], items, 0);
  });

  it.each(EN_VALID)("M3: %s validates with its own context, evidence, metrics and pack: exit 0 and nothing at all", (file) => {
    const edition = /^valid-(.+)\.json$/.exec(file)![1] as EditionName;
    expect(cli([`fixtures/drafts/${file}`, ...englishFlags(edition), "--json"])).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(cli([`fixtures/drafts/${file}`, ...englishFlags(edition)])).toEqual({ code: 0, out: [`fixtures/drafts/${file}: 0 errors, 0 warnings.`], err: [] });
  });

  it.each(ZH_VALID)("M4: %s validates against its English draft with its own Chinese context and evidence: exit 0 and nothing at all", (file) => {
    const edition = /^valid-(.+)\.zh\.json$/.exec(file)![1]!;
    const flags = edition === "weekday" ? ZH_FLAGS : ["--zh-context", `fixtures/drafts-zh/${edition}.zh-context.json`, "--zh-evidence", `fixtures/drafts-zh/${edition}.zh-evidence.json`];
    expect(cli([`fixtures/drafts-zh/${file}`, "--zh", `fixtures/drafts/valid-${edition}.json`, ...flags, "--json"])).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(cli([`fixtures/drafts-zh/${file}`, "--zh", `fixtures/drafts/valid-${edition}.json`, ...flags]).out).toEqual([`fixtures/drafts-zh/${file}: 0 errors, 0 warnings.`]);
  });

  it.each(ZH_INVALID)("M5: `validate fixtures/drafts-zh/%s --zh fixtures/drafts/valid-weekday.json <flags.txt> --json` exits 1 with exactly the code in its name", (file) => {
    const r = cli([`fixtures/drafts-zh/${file}`, "--zh", "fixtures/drafts/valid-weekday.json", ...ZH_FLAGS, "--json"], ROOT, true);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(1);
    const items = found(r);
    expect(codesOf(items, "error")).toEqual([codeOf(file)]);
    for (const item of items) expect(Object.keys(item)).toEqual(["code", "path", "message", "severity"]);
    sameInText([`fixtures/drafts-zh/${file}`, "--zh", "fixtures/drafts/valid-weekday.json", ...ZH_FLAGS], items, 1);
  });

  it("M6: the sample content passes `validate:sample`, and `--all` on a missing content/ passes `validate:all`", () => {
    const sample = path.join(ROOT, "fixtures", "site-content");
    const holds = fs.existsSync(sample) && fs.readdirSync(sample).length > 0;
    if (holds) {
      vi.stubEnv("UT_CONTENT_DIR", "fixtures/site-content");
      expect(cli(["--all", "--json"])).toEqual({ code: 0, out: ["[]"], err: [] });
      expect(cli(["--all"]).out).toEqual(["fixtures/site-content: 0 errors, 0 warnings."]);
    } else {
      expect(holds).toBe(false);
    }
    vi.stubEnv("UT_CONTENT_DIR", path.join(QUIET, "content-not-there-yet"));
    expect(cli(["--all", "--json"])).toEqual({ code: 0, out: ["[]"], err: [] });
  });
});

// ── The real script ──────────────────────────────────────────────────────────────────────────────

describe("the script run as a process", () => {
  const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const SCRIPT = path.join(ROOT, "scripts", "validate.ts");
  const spawn = (args: string[], env: Record<string, string> = {}, cwd: string = ROOT) => {
    const r = spawnSync(process.execPath, [TSX, SCRIPT, ...args], { cwd, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_CONTENT_DIR: QUIET, ...env } });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };

  it("P1: a valid draft exits 0 with `[]` on standard output and nothing on standard error", () => {
    expect(spawn(["fixtures/drafts/valid-weekday.json", ...WEEKDAY_FLAGS, "--json"])).toEqual({ code: 0, out: "[]\n", err: "" });
  });

  it("P2: an invalid draft exits 1 with its code on standard output, the text form too", () => {
    const json = spawn(["fixtures/drafts/invalid--DATE_MISMATCH.json", ...WEEKDAY_FLAGS, "--json"]);
    expect(json.code).toBe(1);
    expect(json.err).toBe("");
    expect(codesOf(JSON.parse(json.out) as Finding4[], "error")).toEqual(["DATE_MISMATCH"]);
    const text = spawn(["fixtures/drafts/invalid--DATE_MISMATCH.json", ...WEEKDAY_FLAGS]);
    expect(text.code).toBe(1);
    expect(text.out).toMatch(/^ERROR DATE_MISMATCH /);
    expect(text.out).toMatch(/invalid--DATE_MISMATCH\.json: \d+ errors?, \d+ warnings?\.\n$/);
  });

  it("P3: a usage error exits 2 with the usage text on standard error and nothing on standard output, whatever the flags", () => {
    for (const args of [[], ["--bogus"], ["--all", "--context", "x"], ["--all", "--json", "--json"]]) {
      const r = spawn(args);
      expect(r.code).toBe(2);
      expect(r.out).toBe("");
      expect(r.err).toContain(USAGE);
    }
  });

  it("P4: an input the run cannot use exits 2 with the message alone, and the Chinese form runs too", () => {
    const missing = spawn(["fixtures/drafts/valid-weekday.json", ...WEEKDAY_FLAGS.slice(0, 6), "--pack", "nope.json"]);
    expect(missing).toEqual({ code: 2, out: "", err: "--pack: nope.json was not found.\n" });
    expect(spawn(["fixtures/drafts-zh/valid-weekday.zh.json", "--zh", "fixtures/drafts/valid-weekday.json", ...ZH_FLAGS, "--json"])).toEqual({ code: 0, out: "[]\n", err: "" });
  });

  it("P5: --all reads UT_CONTENT_DIR, and passes on an empty, a missing and the sample folder", () => {
    expect(spawn(["--all"], { UT_CONTENT_DIR: QUIET })).toEqual({ code: 0, out: `${QUIET}: 0 errors, 0 warnings.\n`, err: "" });
    expect(spawn(["--all"], { UT_CONTENT_DIR: path.join(QUIET, "missing") }).code).toBe(0);
    const sample = path.join(ROOT, "fixtures", "site-content");
    if (fs.existsSync(sample) && fs.readdirSync(sample).length > 0) {
      expect(spawn(["--all", "--json"], { UT_CONTENT_DIR: "fixtures/site-content" })).toEqual({ code: 0, out: "[]\n", err: "" });
    }
    const stray = tempDir("vcli-stray");
    writeRaw(stray, "stray.txt", "x");
    const bad = spawn(["--all", "--json"], { UT_CONTENT_DIR: stray });
    expect(bad.code).toBe(1);
    expect(codesOf(JSON.parse(bad.out) as Finding4[], "error")).toEqual(["FILE_LAYOUT"]);
  });

  it("P6: the file is run from another working folder, with its root the working folder", () => {
    const { root, date } = makeRun();
    expect(spawn([`drafts/${date}.json`, "--json"], { UT_CONTENT_DIR: "content" }, root)).toEqual({ code: 0, out: "[]\n", err: "" });
    const away = spawn([`drafts/${date}.json`, "--json"], { UT_CONTENT_DIR: "content" }, QUIET);
    expect(away.code).toBe(2);
    expect(away.err).toMatch(/^Cannot read drafts\/.+: it was not found\./);
  });

  it("P7: `npm run` reaches the script through the three package scripts", () => {
    const npm = (args: string[], env: Record<string, string> = {}) => {
      const r = spawnSync("npm", ["run", "-s", ...args], { cwd: ROOT, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_CONTENT_DIR: QUIET, ...env } });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };
    expect(npm(["validate", "--", "fixtures/drafts/valid-weekday.json", ...WEEKDAY_FLAGS, "--json"])).toEqual({ code: 0, out: "[]\n", err: "" });
    expect(npm(["validate:all"], { UT_CONTENT_DIR: path.join(QUIET, "missing") })).toEqual({ code: 0, out: `${path.join(QUIET, "missing")}: 0 errors, 0 warnings.\n`, err: "" });
    const sample = path.join(ROOT, "fixtures", "site-content");
    if (fs.existsSync(sample) && fs.readdirSync(sample).length > 0) {
      expect(npm(["validate:sample"])).toEqual({ code: 0, out: "fixtures/site-content: 0 errors, 0 warnings.\n", err: "" });
    }
  });

  it("P8: importing the script runs nothing", () => {
    const r = spawnSync(process.execPath, [TSX, "-e", `import("${path.join(ROOT, "scripts", "validate.ts")}").then((m) => console.log(typeof m.main, process.exitCode ?? "unset"))`], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
    expect(r.stdout.trim()).toBe("function unset");
    expect(r.stderr).toBe("");
  });

  it("P8b: importing the script from a process whose started file cannot be found runs nothing either", () => {
    const r = spawnSync(process.execPath, [TSX, "-e", `process.argv[1] = "/no/such/started/file.mjs"; import("${path.join(ROOT, "scripts", "validate.ts")}").then((m) => console.log(typeof m.main, process.exitCode ?? "unset"))`], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
    expect(r.stdout.trim()).toBe("function unset");
    expect(r.stderr).toBe("");
  });

  it("P8c: a started file that is another file is a stranger, even where its name and an extension make this script", () => {
    const dir = tempDir("vcli-strangers");
    fs.symlinkSync(SCRIPT, path.join(dir, "validate.ts"));
    fs.writeFileSync(path.join(dir, "validate"), `import("${path.join(dir, "validate.ts")}").then((m) => console.log(typeof m.main, process.exitCode ?? "unset"));\n`);
    const r = spawnSync(process.execPath, ["--import", "tsx", path.join(dir, "validate")], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
    expect(r.stdout.trim()).toBe("function unset");
    expect(r.stderr).toBe("");
  });

  it("P9d: the script started with the names of links kept (`--preserve-symlinks-main`), where its own url is the linked name, runs too", () => {
    const stray = tempDir("vcli-stray");
    writeRaw(stray, "stray.txt", "x");
    const links = tempDir("vcli-links");
    fs.symlinkSync(ROOT, path.join(links, "repo"), "dir");
    const through = path.join(links, "repo", "scripts", "validate.ts");
    const r = spawnSync(process.execPath, ["--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx", through, "--all", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_CONTENT_DIR: stray } });
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("");
    expect(codesOf(JSON.parse(r.stdout) as Finding4[], "error")).toEqual(["FILE_LAYOUT"]);
  });

  it("P9c: the script started without its extension (`tsx scripts/validate`) runs, and does not end silently with exit 0", () => {
    const stray = tempDir("vcli-stray");
    writeRaw(stray, "stray.txt", "x");
    const bare = SCRIPT.slice(0, -".ts".length);
    for (const argv of [[TSX, bare], ["--import", "tsx", bare]]) {
      const r = spawnSync(process.execPath, [...argv, "--all", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_CONTENT_DIR: stray } });
      expect(r.status).toBe(1);
      expect(r.stderr).toBe("");
      expect(codesOf(JSON.parse(r.stdout) as Finding4[], "error")).toEqual(["FILE_LAYOUT"]);
    }
  });

  it("P9: the script started through a linked folder runs, and does not end silently with exit 0 as if every folder were valid", () => {
    const stray = tempDir("vcli-stray");
    writeRaw(stray, "stray.txt", "x");
    const links = tempDir("vcli-links");
    fs.symlinkSync(ROOT, path.join(links, "repo"), "dir");
    const through = path.join(links, "repo", "scripts", "validate.ts");
    const linked = spawnSync(process.execPath, [TSX, through, "--all", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_CONTENT_DIR: stray } });
    expect(linked.status).toBe(1);
    expect(linked.stderr).toBe("");
    expect(codesOf(JSON.parse(linked.stdout) as Finding4[], "error")).toEqual(["FILE_LAYOUT"]);
    // As typed, the same file, and a link to the file itself.
    fs.symlinkSync(SCRIPT, path.join(links, "validate-link.ts"));
    const direct = spawnSync(process.execPath, [TSX, SCRIPT, "--all", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_CONTENT_DIR: stray } });
    const alone = spawnSync(process.execPath, [TSX, path.join(links, "validate-link.ts"), "--all", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_CONTENT_DIR: stray } });
    expect([direct.status, alone.status]).toEqual([1, 1]);
    expect(alone.stdout).toBe(direct.stdout);
  });

  /**
   * Runs the script with the reader of one of its two output streams gone before it writes, as `script | true` does (a shell pipeline,
   * the way a `| head -1` ends a reader): its first write fails with a broken pipe. `seen` is what the other stream carried. Closing the
   * test's own end of a pipe is not used: it did not always fail the write. `pipefail` makes the exit status the script's.
   */
  function withReaderGone(gone: "stdout" | "stderr", args: string[], env: Record<string, string>): { code: number | null; seen: string } {
    const pipeline = gone === "stdout" ? 'set -o pipefail; "$@" | true' : 'set -o pipefail; { "$@" 2>&1 1>&3 3>&- | true; } 3>&1';
    const r = spawnSync("bash", ["-c", pipeline, "bash", process.execPath, TSX, SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_CONTENT_DIR: QUIET, ...env } });
    return { code: r.status, seen: gone === "stdout" ? r.stderr : r.stdout };
  }

  /** Runs the script with standard output, standard error or both on `/dev/full`, a device whose every write fails with ENOSPC. */
  function withFullDevice(full: ("stdout" | "stderr")[], args: string[], env: Record<string, string> = {}) {
    const fd = fs.openSync("/dev/full", "w");
    try {
      const r = spawnSync(process.execPath, [TSX, SCRIPT, ...args], {
        cwd: ROOT, encoding: "utf8", timeout: 60_000,
        stdio: ["ignore", full.includes("stdout") ? fd : "pipe", full.includes("stderr") ? fd : "pipe"],
        env: { ...process.env, UT_CONTENT_DIR: QUIET, ...env },
      });
      return { code: r.status, signal: r.signal, out: r.stdout ?? null, err: r.stderr ?? null };
    } finally {
      fs.closeSync(fd);
    }
  }
  const FULL = "Cannot write the output (ENOSPC).\n";
  const hasFullDevice = fs.existsSync("/dev/full");

  it("P9b: writeFailure() is null for a broken pipe and one line for every other write error", () => {
    expect(writeFailure(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))).toBeNull();
    expect(writeFailure(Object.assign(new Error("write ENOSPC"), { code: "ENOSPC" }))).toBe(FULL.trimEnd());
    expect(writeFailure(Object.assign(new Error("write EIO"), { code: "EIO" }))).toBe("Cannot write the output (EIO).");
    expect(writeFailure(new Error("no code"))).toBe("Cannot write the output (an error).");
  });

  it("P10: a reader that has gone away does not change the exit code, which is the verdict, and prints no stack", () => {
    const stray = tempDir("vcli-stray");
    writeRaw(stray, "stray.txt", "x");
    expect(withReaderGone("stdout", ["--all"], { UT_CONTENT_DIR: QUIET })).toEqual({ code: 0, seen: "" });
    expect(withReaderGone("stdout", ["--all", "--json"], { UT_CONTENT_DIR: QUIET })).toEqual({ code: 0, seen: "" });
    expect(withReaderGone("stdout", ["--all"], { UT_CONTENT_DIR: stray })).toEqual({ code: 1, seen: "" });
    expect(withReaderGone("stdout", ["--all", "--json"], { UT_CONTENT_DIR: stray })).toEqual({ code: 1, seen: "" });
  });

  it("P10b: the same holds for standard error: a usage error stays exit 2 and the other stream is as it was", () => {
    const stray = tempDir("vcli-stray");
    writeRaw(stray, "stray.txt", "x");
    expect(withReaderGone("stderr", ["--bogus"], {})).toEqual({ code: 2, seen: "" });
    expect(withReaderGone("stderr", ["--all", "--json"], { UT_CONTENT_DIR: QUIET })).toEqual({ code: 0, seen: "[]\n" });
    const invalid = withReaderGone("stderr", ["--all", "--json"], { UT_CONTENT_DIR: stray });
    expect(invalid.code).toBe(1);
    expect(codesOf(JSON.parse(invalid.seen) as Finding4[], "error")).toEqual(["FILE_LAYOUT"]);
  });

  it.skipIf(!hasFullDevice)("P10c: a report that cannot be written is exit 2 with one line and no stack, never 0 or 1", () => {
    const stray = tempDir("vcli-stray");
    writeRaw(stray, "stray.txt", "x");
    for (const [args, env] of [[["--all"], {}], [["--all", "--json"], {}], [["--all"], { UT_CONTENT_DIR: stray }], [["--all", "--json"], { UT_CONTENT_DIR: stray }]] as const) {
      expect(withFullDevice(["stdout"], [...args], env)).toEqual({ code: 2, signal: null, out: null, err: FULL });
    }
  });

  it.skipIf(!hasFullDevice)("P10d: when standard error cannot be written either, the run still ends, with exit 2, and says nothing twice", () => {
    expect(withFullDevice(["stdout", "stderr"], ["--all"])).toEqual({ code: 2, signal: null, out: null, err: null });
    // Standard error alone: a usage error is exit 2 as ever; a run that writes nothing there is not touched.
    expect(withFullDevice(["stderr"], ["--bogus"])).toEqual({ code: 2, signal: null, out: "", err: null });
    expect(withFullDevice(["stderr"], ["--all", "--json"])).toEqual({ code: 0, signal: null, out: "[]\n", err: null });
  });
});

// ── Exports ──────────────────────────────────────────────────────────────────────────────────────

// ── Hostile inputs and what the command leaves alone ─────────────────────────────────────────────

describe("odd names, odd sizes and hostile content: judged or refused, never a crash, and nothing written", () => {
  /** Every entry under `dir`, links not followed: its path, its size and modification time, and a hash of its bytes (a link: its target). */
  function treeOf(dir: string): string[] {
    const rows: string[] = [];
    const walk = (at: string): void => {
      for (const name of fs.readdirSync(at).sort()) {
        const full = path.join(at, name);
        const stat = fs.lstatSync(full);
        const rel = path.relative(dir, full);
        if (stat.isSymbolicLink()) {
          rows.push(`${rel} -> ${fs.readlinkSync(full)}`);
        } else if (stat.isDirectory()) {
          rows.push(`${rel}/ ${stat.mtimeMs}`);
          walk(full);
        } else {
          rows.push(`${rel} ${stat.size} ${stat.mtimeMs} ${createHash("sha256").update(fs.readFileSync(full)).digest("hex")}`);
        }
      }
    };
    walk(dir);
    return rows;
  }

  /** The repository's weekday draft by absolute path, for the cases that run in a root of their own. */
  const WEEKDAY_DRAFT = path.join(ROOT, "fixtures", "drafts", "valid-weekday.json");

  const WRITERS = [
    "writeFileSync", "appendFileSync", "mkdirSync", "mkdtempSync", "rmSync", "rmdirSync", "unlinkSync", "renameSync", "copyFileSync", "cpSync", "symlinkSync",
    "linkSync", "truncateSync", "ftruncateSync", "utimesSync", "futimesSync", "chmodSync", "chownSync", "createWriteStream", "writeSync",
  ] as const;

  /** A root where every form has something to read and something to say: a valid and a broken draft in each language, logs, a content folder. */
  function busyRoot(): { root: string; date: string; runs: string[][] } {
    const { root, date } = makeRun();
    writeRaw(root, "drafts/empty.json", "");
    writeRaw(root, "drafts/broken.zh.json", "{}");
    fs.copyFileSync(path.join(ROOT, "fixtures/context/weekday.json"), path.join(root, "drafts/context.json"));
    writeRaw(root, "content/stray.txt", "SAMPLE");
    const runs: string[][] = [
      [`drafts/${date}.json`, "--json"],
      [`drafts/${date}.json`],
      ["drafts/empty.json", ...WEEKDAY_ABS],
      [`drafts/${date}.json`, "--context", "drafts/context.json"],
      [`drafts/${date}.json`, "--pack", "packs/none.json"],
      [`drafts/${date}.zh.json`, "--zh", `drafts/${date}.json`],
      ["drafts/broken.zh.json", "--zh", `drafts/${date}.json`, "--zh-context", `logs/${date}.zh-context.json`, "--zh-evidence", `logs/${date}.zh-evidence.json`, "--json"],
      ["--all"],
      ["--all", "--json"],
      ["--bogus"],
      [],
    ];
    return { root, date, runs };
  }

  it("W1: no form, whatever its result, writes, creates, removes or touches a file (the tree is the same after, and no writing call is made)", () => {
    const { root, runs } = busyRoot();
    const before = treeOf(root);
    const fsFns = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
    const spies = WRITERS.filter((name) => typeof fsFns[name] === "function").map((name) => [name, vi.spyOn(fsFns, name)] as const);
    expect(spies.length).toBeGreaterThan(10);
    const codes = runs.map((argv) => cli(argv, root).code);
    expect(codes).toEqual([0, 0, 1, 2, 2, 0, 1, 1, 1, 2, 2]);
    expect(spies.filter(([, spy]) => spy.mock.calls.length > 0).map(([name]) => name)).toEqual([]);
    expect(treeOf(root)).toEqual(before);
  });

  it("W2: the real script writes nothing either (a process started in the root leaves the tree as it was)", () => {
    const { root, date } = busyRoot();
    const before = treeOf(root);
    const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    const script = path.join(ROOT, "scripts", "validate.ts");
    for (const [argv, code] of [[[`drafts/${date}.json`, "--json"], 0], [["--all"], 1], [[`drafts/${date}.json`, "--context", "drafts/context.json"], 2]] as const) {
      const r = spawnSync(process.execPath, [tsx, script, ...argv], { cwd: root, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_CONTENT_DIR: "content" } });
      expect(r.status).toBe(code);
    }
    expect(treeOf(root)).toEqual(before);
  });

  it("G1: a root, a draft and every input whose names hold spaces and Chinese characters are read as any other, in the text and in the JSON", () => {
    const { root, date } = makeRun();
    const spaced = path.join(tempDir("vcli-space"), "my run 根目錄");
    fs.cpSync(root, spaced, { recursive: true, verbatimSymlinks: true });
    const odd = (rel: string, to: string): string => {
      fs.renameSync(path.join(spaced, rel), path.join(spaced, to));
      return to;
    };
    const draft = odd(`drafts/${date}.json`, "drafts/the draft of today 草稿.json");
    const flags = [
      "--context", odd(`logs/${date}.context.json`, "logs/a context.json"), "--evidence", odd(`logs/${date}.evidence.json`, "logs/some evidence 證據.json"),
      "--metrics", odd(`content/metrics/${date}.json`, "content/metrics/the metrics.json"), "--pack", odd(`packs/${date}.json`, "packs/pack (1).json"),
    ];
    expect(cli([draft, ...flags, "--json"], spaced)).toEqual({ code: 0, out: ["[]"], err: [] });
    expect(cli([draft, ...flags], spaced)).toEqual({ code: 0, out: [`${draft}: 0 errors, 0 warnings.`], err: [] });
    const zh = odd(`drafts/${date}.zh.json`, "drafts/中文 draft.zh.json");
    const zhFlags = ["--zh-context", odd(`logs/${date}.zh-context.json`, "logs/zh context.json"), "--zh-evidence", odd(`logs/${date}.zh-evidence.json`, "logs/zh evidence.json")];
    expect(cli([zh, "--zh", draft, ...zhFlags, "--json"], spaced)).toEqual({ code: 0, out: ["[]"], err: [] });
    // The same names given as one shell word each by a real process.
    const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    const real = spawnSync(process.execPath, [tsx, path.join(ROOT, "scripts", "validate.ts"), draft, ...flags, "--json"], { cwd: spaced, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_CONTENT_DIR: "content" } });
    expect({ code: real.status, out: real.stdout, err: real.stderr }).toEqual({ code: 0, out: "[]\n", err: "" });
    // A missing input with such a name is named as it was typed.
    expect(cli([draft, ...flags.slice(0, 6), "--pack", "packs/nothing here.json"], spaced).err).toEqual(["--pack: packs/nothing here.json was not found."]);
  });

  it("G2: a draft of 20 MB is judged like any other: exit 1, an unknown key, and nothing of the file's text in the output", () => {
    const root = bareRoot();
    writeRaw(root, "drafts/big.json", `{"zzz":"${"x".repeat(20_000_000)}"}`);
    const r = cli(["drafts/big.json", ...WEEKDAY_ABS, "--json"], root);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([]);
    const items = found(r);
    expect(items.some((i) => i.code === "SCHEMA" && i.path === "zzz")).toBe(true);
    expect(codesOf(items, "error")).toEqual(["SCHEMA"]);
    expect(r.out.join("").length).toBeLessThan(20_000);
    // The same file as an input is exit 2, named by its flag, with no text of the file either.
    writeRaw(root, "big-context.json", `{"zzz":"${"x".repeat(5_000_000)}"}`);
    const input = cli([WEEKDAY_DRAFT, ...WEEKDAY_ABS.map((f) => (f === path.join(ROOT, "fixtures/context/weekday.json") ? path.join(root, "big-context.json") : f))], root);
    expect(input.code).toBe(2);
    expect(input.err).toHaveLength(1);
    expect(input.err[0]!.length).toBeLessThan(2_000);
  });

  it("G3: keys named like members of Object.prototype are unknown keys, not a way into the command", () => {
    const root = bareRoot();
    const base = readJ("fixtures/drafts/valid-weekday.json");
    writeRaw(root, "drafts/proto.json", `{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"toString":1,${JSON.stringify(base).slice(1)}`);
    const r = cli(["drafts/proto.json", ...WEEKDAY_ABS, "--json"], root);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([]);
    const items = found(r);
    expect(items.map((i) => `${i.code} ${i.path}`).sort()).toEqual(["SCHEMA __proto__", "SCHEMA constructor", "SCHEMA toString"]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    // The same keys in an input file are told as a wrong file, by flag.
    writeRaw(root, "ctx.json", '{"__proto__":{"polluted":true}}');
    const input = cli([WEEKDAY_DRAFT, "--context", path.join(root, "ctx.json"), ...WEEKDAY_ABS.slice(2)], root);
    expect(input.code).toBe(2);
    expect(input.err[0]).toMatch(/^--context: .*ctx\.json is not an agent context \(/);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("G4: a value nested 100,000 levels deep, in a draft, under an unknown key and in an input, is judged or refused without a stack", () => {
    const root = bareRoot();
    const depth = 100_000;
    const nested = `${"[".repeat(depth)}${"]".repeat(depth)}`;
    writeRaw(root, "drafts/deep.json", nested);
    const asDraft = cli(["drafts/deep.json", ...WEEKDAY_ABS, "--json"], root);
    expect(asDraft.code).toBe(1);
    expect(found(asDraft).map((i) => `${i.code} ${i.path}`)).toEqual(["SCHEMA (root)"]);
    const base = JSON.stringify(readJ("fixtures/drafts/valid-weekday.json")).slice(1);
    writeRaw(root, "drafts/deep-key.json", `{"zzz":${nested},${base}`);
    const underKey = cli(["drafts/deep-key.json", ...WEEKDAY_ABS, "--json"], root);
    expect(underKey.code).toBe(1);
    expect(underKey.err).toEqual([]);
    expect(found(underKey).map((i) => `${i.code} ${i.path}`)).toEqual(["SCHEMA zzz"]);
    writeRaw(root, "deep-ctx.json", nested);
    const asInput = cli([WEEKDAY_DRAFT, "--context", path.join(root, "deep-ctx.json"), ...WEEKDAY_ABS.slice(2)], root);
    expect(asInput.code).toBe(2);
    expect(asInput.err).toHaveLength(1);
    expect(asInput.err[0]).toMatch(/^--context: .*deep-ctx\.json is not an agent context \(\(root\): /);
    expect(asInput.err[0]).not.toMatch(/\n\s+at /);
  });

  it("M7: the validate lines of SPEC §10 P1's milestone, run by a shell as written (the glob, `$(cat flags.txt)`, `npm run`), exit as their comments say", () => {
    const spec = read("SPEC.md");
    const heading = spec.indexOf("### P1: Data contract");
    expect(heading).toBeGreaterThan(0);
    const section = spec.slice(heading, spec.indexOf("### P2:", heading));
    expect(section.length).toBeGreaterThan(1000);
    const lines = section.split("\n").filter((l) => /^(for |npm |export |UT_CONTENT_DIR=)/.test(l) && /npm run (-s )?validate -- /.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const firstOf = (pattern: string): string => {
      const star = path.basename(pattern).split("*");
      const hit = fs.readdirSync(path.join(ROOT, path.dirname(pattern))).sort().find((f) => f.startsWith(star[0]!) && f.endsWith(star[1]!));
      expect(hit, pattern).toBeDefined();
      return path.join(path.dirname(pattern), hit!);
    };
    for (const line of lines) {
      const [command, comment = ""] = line.split(/\s+#\s+/) as [string, string?];
      const wanted = /exit (\d)/.exec(comment ?? "");
      expect(wanted, `no exit code in the comment of: ${line}`).not.toBeNull();
      const glob = /for f in (\S+); do/.exec(command);
      const file = glob === null ? null : firstOf(glob[1]!);
      const one = glob === null ? command : command.replace(glob[1]!, file!);
      const r = spawnSync("bash", ["-c", one], { cwd: ROOT, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_CONTENT_DIR: QUIET } });
      expect({ line: one, code: r.status, err: r.stderr.includes("Usage:") }).toEqual({ line: one, code: Number(wanted![1]), err: false });
      const named = file === null ? null : /(invalid|soft)--(.+?)(?:\.zh)?\.json$/.exec(file);
      if (named !== null) {
        const items = JSON.parse(r.stdout) as Finding4[];
        expect(codesOf(items, named[1] === "invalid" ? "error" : "warning")).toEqual([named[2]]);
        if (named[1] === "soft") expect(codesOf(items, "error")).toEqual([]);
      } else {
        expect(r.stdout).toContain("0 errors, 0 warnings.");
      }
    }
  }, 240_000);
});

describe("the errors", () => {
  it("K1: UsageError and InputError are distinct errors with their own messages", () => {
    expect(new UsageError("a")).toBeInstanceOf(Error);
    expect(new InputError("b")).toBeInstanceOf(Error);
    expect(new UsageError("a")).not.toBeInstanceOf(InputError);
    expect(new InputError("b")).not.toBeInstanceOf(UsageError);
    expect(new UsageError("a").message).toBe("a");
  });
});
