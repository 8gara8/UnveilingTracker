// scripts/ledger-seed.ts (SPEC §8.13, §10 P2 step 4, §4.10 "removed", §4.12 SEED_SOURCES, SUBFIELD_UNKNOWN, ZH_RUNG_LABEL, ZH_OFFICIAL): the
// Landmark history's seeder. Every sentence of §8.13 is a test here: the files and their names, the ids (by `first_published` then file name),
// the stored `removed` corrections applied on a rerun and `unremovedSeeds()`, `--verify` (stored snapshots read, the rest taken in rounds, a
// blocked or non-http(s) address never retried, the evidence from snapshots alone, SEED_SOURCES in place of SOURCE_SEEN), the checks the rule
// engine has no mode for (subfield, rung label, the 樂詞網 address, an invisible character), what is written and that a rerun is
// byte-identical, and the command (its flags, its exit codes and its output). Offline: the seed files are written to a temporary root that
// holds a copy of `config/`, and every page they cite is answered from `fixtures/feeds/` through `UT_FIXTURE_FEEDS`.
// New for this project; Cyber has no Ledger (its `Io` seam, usage errors and tests of `main()` follow tests/validate-cli.test.ts).
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { loadConfig } from "@/lib/config";
import { fetchFeed, type FetchOptions, type FetchResult } from "@/lib/feeds/http";
import { htmlText, textSha256 } from "@/lib/html-text";
import { jsonText } from "@/lib/json";
import { Finding } from "@/lib/schema/finding";
import { ArchiveIndex, Correction } from "@/lib/schema/misc";
import { normalizeUrl } from "@/lib/urls";
import { GlossaryFile } from "@/lib/schema/glossary";
import { SEED_FILE_RE, seedFileName, SeedFinding, SeedL10n } from "@/lib/schema/seed";
import { validateAll, type ValidationIssue } from "@/lib/validate";
import { REMOVED_BEFORE, REMOVED_TEXT } from "@/lib/vocab";
import {
  InputError, USAGE, applyRemovals, bracketed, chineseOf, disclosureOf, exitWith, findingOf, frameDate, identifySeeds, ledgerSeed, main, newTermId, orderSeeds, readSeedFiles, slot,
  unremovedSeeds, watchWriteErrors, writeFailure, type Io, type LoadedSeed, type SeedOptions,
} from "@/scripts/ledger-seed";
import { snapshotFile } from "@/scripts/lib/snapshot";
import { FEEDS_DIR, MISSING_URL, PAPER_URL, PDF_URL, PREPRINT_URL, TERM, TERM_URL, TRIAL_URL, sampleSeeds, seedBio1, seedBio2, seedPhys, writeSeeds } from "./helpers/ledger-seeds";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = path.join(__dirname, "..");
const config = loadConfig(path.join(ROOT, "config"));
const NOW = (): number => Date.parse("2026-11-20T01:00:00Z");
const FETCHED_AT = "2026-11-20T09:00:00+08:00";
const PHYS = "2018-03-02-01.json";
const BIO1 = "2019-05-01-01.json";
const BIO2 = "2019-05-01-02.json";
const FIVE = ["findings/phys-2018-0001.json", "findings/bio-2019-0001.json", "findings/bio-2019-0002.json", "glossary.json", "archive-index.json"];
const ZWSP = "​";

// ── A temporary root laid out as a run is: `config/`, `seed/ledger/`, `content/` ─────────────────────────────

const roots: string[] = [];
const saved = process.env.UT_FIXTURE_FEEDS;
const savedContent = process.env.UT_CONTENT_DIR;
beforeEach(() => {
  process.env.UT_FIXTURE_FEEDS = FEEDS_DIR;
});
afterEach(() => {
  if (saved === undefined) delete process.env.UT_FIXTURE_FEEDS;
  else process.env.UT_FIXTURE_FEEDS = saved;
  if (savedContent === undefined) delete process.env.UT_CONTENT_DIR;
  else process.env.UT_CONTENT_DIR = savedContent;
});
afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

interface World {
  root: string;
  seeds: string;
  content: string;
}

/** A root with a copy of `config/` and the seeds written to `seed/ledger/` (none when `seeds` is null). */
function world(seeds: Record<string, unknown> | null = sampleSeeds()): World {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ut-ledger-"));
  roots.push(root);
  fs.cpSync(path.join(ROOT, "config"), path.join(root, "config"), { recursive: true });
  const w = { root, seeds: path.join(root, "seed", "ledger"), content: path.join(root, "content") };
  if (seeds !== null) writeSeeds(w.seeds, seeds);
  return w;
}

/** One run of the seeder over the world, `--verify --out content` unless `over` says otherwise. */
const seed = (w: World, over: Partial<SeedOptions> = {}) =>
  ledgerSeed({ inDir: "seed/ledger", verify: true, outDir: "content", root: w.root, now: NOW, ...over });

const errorsOf = (issues: readonly ValidationIssue[]): ValidationIssue[] => issues.filter((i) => i.severity === "error");
const codes = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => i.code);
const readText = (w: World, rel: string): string => fs.readFileSync(path.join(w.content, rel), "utf8");
const readJson = (w: World, rel: string): any => JSON.parse(readText(w, rel));
const exists = (w: World, rel: string): boolean => fs.existsSync(path.join(w.content, rel));
const filesIn = (w: World): string[] => (fs.existsSync(w.content) ? fs.readdirSync(w.content, { recursive: true, encoding: "utf8" }).filter((f) => fs.statSync(path.join(w.content, f)).isFile()).sort() : []);

/** `sampleSeeds()` with one file changed. */
function edited(name: string, change: (s: SeedFinding) => void): Record<string, SeedFinding> {
  const seeds = sampleSeeds();
  change(seeds[name]!);
  return seeds;
}

/** A fetch that counts every URL it is asked for, answers from `fixtures/feeds/` (UT_FIXTURE_FEEDS) and may change an answer. */
function counting(change: Record<string, (r: FetchResult) => FetchResult> = {}) {
  const urls: string[] = [];
  const fn = (async (url: string, options?: FetchOptions) => {
    urls.push(url);
    const real = await fetchFeed(url, options);
    return change[url] ? change[url]!(real) : real;
  }) as typeof fetchFeed;
  return { urls, fn };
}

const l = (s: string) => ({ en: s, zh: s });
/** A stored `removed` correction, as publish writes it (§4.10). */
const removal = (n: number, over: Partial<{ finding_id: string | null; term_id: string | null; edition_date: string | null; path: string }>): Correction =>
  Correction.parse({
    id: `C-${String(n).padStart(4, "0")}`, date: "2026-11-21", finding_id: null, edition_date: null, term_id: null, type: "removed", path: "explainer.found",
    before: REMOVED_BEFORE, after: REMOVED_TEXT, reason: l("A safety check flagged the text."), source_url: null, trigger: "recheck", report_id: null, ...over,
  });
const forFinding = (n: number, id: string, p: string): Correction => removal(n, { finding_id: id, path: p });
const forTerm = (n: number, id: string): Correction => removal(n, { term_id: id, path: "definition" });

function putCorrections(w: World, corrections: Correction[]): void {
  fs.mkdirSync(w.content, { recursive: true });
  fs.writeFileSync(path.join(w.content, "corrections.json"), `${JSON.stringify({ schema_version: 1, corrections }, null, 2)}\n`);
}

const loaded = (name: string, s: SeedFinding): LoadedSeed => ({ name, seed: s });

// ── The files ────────────────────────────────────────────────────────────────────────────────────

describe("the seed schema and the file name", () => {
  it("N1 a seed file is <first_published>-<nn>.json with nn from 01 to 99", () => {
    for (const ok of ["2019-05-01-01.json", "2019-05-01-09.json", "2019-05-01-10.json", "2019-05-01-99.json"]) expect(SEED_FILE_RE.test(ok), ok).toBe(true);
    for (const bad of ["2019-05-01-00.json", "2019-05-01-100.json", "2019-05-01-1.json", "2019-5-01-01.json", "2019-05-01-01.JSON", "2019-05-01-01.json.bak", "x2019-05-01-01.json", "2019-05-01.json", "README.md", ".gitkeep"]) {
      expect(SEED_FILE_RE.test(bad), bad).toBe(false);
    }
    expect(SEED_FILE_RE.exec("2019-05-01-07.json")![1]).toBe("2019-05-01");
    expect(seedFileName("2019-05-01", 7)).toBe("2019-05-01-07.json");
  });

  it("N2 the sample seeds parse as SeedFinding and carry `by: seed` and a `seeded` date", () => {
    for (const s of Object.values(sampleSeeds())) {
      expect(SeedFinding.safeParse(s).success).toBe(true);
      expect(s.rung_history.every((r) => r.by === "seed")).toBe(true);
      expect(s.seeded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("N3 a seed's L10n has both languages, each at least one character, and no other key", () => {
    expect(SeedL10n.safeParse({ en: "A", zh: "甲" }).success).toBe(true);
    for (const bad of [{ en: "", zh: "甲" }, { en: "A", zh: "" }, { en: "A", zh: null }, { en: "A" }, { zh: "甲" }, { en: "A", zh: "甲", fr: "B" }, "A", null]) {
      expect(SeedL10n.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("readSeedFiles", () => {
  it("R1 reads every seed file, in code-unit order of the names, with no issue for a valid folder", () => {
    const w = world({ [BIO2]: seedBio2(), [PHYS]: seedPhys(), [BIO1]: seedBio1() });
    const r = readSeedFiles(w.seeds);
    expect(r.issues).toEqual([]);
    expect(r.files.map((f) => f.name)).toEqual([PHYS, BIO1, BIO2]);
    expect(r.files[1]!.seed).toEqual(seedBio1());
  });

  it("R2 skips a name that starts with a dot; any other name that is not a seed file name is a SCHEMA issue that names it", () => {
    const w = world();
    for (const name of [".DS_Store", ".gitkeep"]) fs.writeFileSync(path.join(w.seeds, name), "x");
    const bad = ["README.md", "2019-05-01.json", "2019-05-01-00.json", "2019-05-01-100.json", "2019-5-01-01.json", "2019-05-01-01.json.bak"];
    for (const name of bad) fs.writeFileSync(path.join(w.seeds, name), "{}");
    const r = readSeedFiles(w.seeds);
    expect(r.files.map((f) => f.name)).toEqual([PHYS, BIO1, BIO2]);
    expect(r.issues.map((i) => [i.code, i.severity, i.path])).toEqual(bad.slice().sort().map((name) => ["SCHEMA", "error", name]));
    for (const i of r.issues) expect(i.message).toContain(i.path);
  });

  it("R3 a directory named like a seed file is refused too", () => {
    const w = world();
    fs.mkdirSync(path.join(w.seeds, "2019-06-01-01.json"));
    const r = readSeedFiles(w.seeds);
    expect(r.files).toHaveLength(3);
    expect(r.issues.map((i) => [i.code, i.path])).toEqual([["SCHEMA", "2019-06-01-01.json"]]);
  });

  it("R4 a file that is not JSON is one SCHEMA issue, and the other files still load", () => {
    const w = world();
    fs.writeFileSync(path.join(w.seeds, "2019-06-01-01.json"), "{not json");
    const r = readSeedFiles(w.seeds);
    expect(r.files).toHaveLength(3);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: "SCHEMA", severity: "error", path: "2019-06-01-01.json" });
    expect(r.issues[0]!.message).toContain("not valid JSON");
  });

  it("R4b each kind of bad file is reported and none stops the files after it: bad JSON, a schema failure and a wrong date, all before the good files", () => {
    const w = world();
    fs.writeFileSync(path.join(w.seeds, "2017-01-01-01.json"), "{not json");
    fs.writeFileSync(path.join(w.seeds, "2017-01-01-02.json"), "{}");
    fs.writeFileSync(path.join(w.seeds, "2017-01-01-03.json"), JSON.stringify(seedPhys()));
    const r = readSeedFiles(w.seeds);
    expect(r.files.map((f) => f.name)).toEqual([PHYS, BIO1, BIO2]);
    const where = r.issues.map((i) => i.path.split(":")[0]);
    expect(where.filter((p) => p === "2017-01-01-01.json")).toHaveLength(1);
    expect(where.includes("2017-01-01-02.json")).toBe(true);
    expect(r.issues.filter((i) => i.path === "2017-01-01-03.json: first_published")).toHaveLength(1);
    expect(r.issues.some((i) => i.path === "2017-01-01-01.json" && i.message.includes("not valid JSON"))).toBe(true);
  });

  it("R5 the file name's date must be the seed's own first_published", () => {
    const seed = seedBio1();
    const w = world({ "2019-05-02-01.json": seed });
    const r = readSeedFiles(w.seeds);
    expect(r.files).toEqual([]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: "SCHEMA", path: "2019-05-02-01.json: first_published" });
    expect(r.issues[0]!.message).toContain("2019-05-02");
    expect(r.issues[0]!.message).toContain("2019-05-01");
  });

  it("R5b a file with the wrong date is skipped, not a stop: the files after it still load", () => {
    const wrong = seedBio1();
    wrong.first_published = "2019-05-02";
    const w = world({ [BIO1]: wrong, [BIO2]: seedBio2() });
    const r = readSeedFiles(w.seeds);
    expect(r.files.map((f) => f.name)).toEqual([BIO2]);
    expect(r.issues.map((i) => i.path)).toEqual([`${BIO1}: first_published`]);
  });

  it("R6 a schema failure names the file first and the path in it: <name>: explainer.found.zh", () => {
    const seed: any = seedBio1();
    delete seed.explainer.found.zh;
    const w = world({ [BIO1]: seed });
    const r = readSeedFiles(w.seeds);
    expect(r.files).toEqual([]);
    expect(r.issues.map((i) => i.path)).toContain(`${BIO1}: explainer.found.zh`);
    expect(r.issues.every((i) => i.code === "SCHEMA")).toBe(true);
  });

  it("R7 the schema is strict: an unknown key, a rung entry not by `seed`, a missing `seeded` and an empty language are each refused", () => {
    const cases: [string, (s: any) => void][] = [
      ["an unknown key", (s) => { s.extra = 1; }],
      ["by agent", (s) => { s.rung_history[0].by = "agent"; }],
      ["no seeded", (s) => { delete s.seeded; }],
      ["an empty zh", (s) => { s.title.zh = ""; }],
      ["a null zh", (s) => { s.title.zh = null; }],
      ["a malformed seeded", (s) => { s.seeded = "20 Nov 2026"; }],
    ];
    for (const [name, change] of cases) {
      const seed: any = seedBio1();
      change(seed);
      const r = readSeedFiles(world({ [BIO1]: seed }).seeds);
      expect(r.files, name).toEqual([]);
      expect(r.issues.length, name).toBeGreaterThan(0);
      expect(r.issues.every((i) => i.code === "SCHEMA" && i.path.startsWith(BIO1)), name).toBe(true);
    }
  });

  it("R8 a string with an invisible character is a SCHEMA issue at its path, one for each such string (§4.1), though the schema passes", () => {
    const seed = seedBio1();
    seed.explainer.found.en = `${ZWSP}${seed.explainer.found.en}`;
    seed.title.zh = `${seed.title.zh}‍`;
    const r = readSeedFiles(world({ [BIO1]: seed }).seeds);
    expect(r.files).toEqual([]);
    expect(r.issues.every((i) => i.code === "SCHEMA" && i.severity === "error")).toBe(true);
    expect(r.issues.map((i) => i.path).sort()).toEqual([`${BIO1}: explainer.found.en`, `${BIO1}: title.zh`]);
    expect(r.issues.some((i) => i.message.includes("U+200B"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("U+200D"))).toBe(true);
  });

  it("R9 at most 50 such strings are listed, and one more issue, at the file's name, counts the rest", () => {
    const seed: any = seedBio1();
    seed.who = Array.from({ length: 60 }, (_, i) => ({ name: `Name ${i}${ZWSP}`, ror: null }));
    const r = readSeedFiles(world({ [BIO1]: seed }).seeds);
    const invisible = r.issues.filter((i) => i.message.includes("invisible character"));
    expect(invisible.filter((i) => i.path !== BIO1)).toHaveLength(50);
    const summary = invisible.filter((i) => i.path === BIO1);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.message).toMatch(/10 more strings hold an invisible character; only the first 50 strings are listed/);
  });

  it("R10 a folder that cannot be read is an InputError", () => {
    const w = world(null);
    expect(() => readSeedFiles(path.join(w.root, "no-such-folder"))).toThrow(InputError);
    expect(() => readSeedFiles(path.join(w.root, "no-such-folder"))).toThrow(/Cannot read the seed folder/);
  });
});

// ── The ids ──────────────────────────────────────────────────────────────────────────────────────

describe("identifySeeds and orderSeeds", () => {
  const as = (field: SeedFinding["field"], first_published: string, subfield: string): SeedFinding => ({ ...seedBio1(), field, subfield, first_published });

  it("I1 ids follow first_published, then the file name; the counter runs across fields within a year and restarts in a new year", () => {
    const files = [
      loaded("2020-01-01-01.json", as("biology", "2020-01-01", "drugs")),
      loaded("2019-05-01-02.json", as("biology", "2019-05-01", "drugs")),
      loaded("2019-05-01-01.json", as("physics", "2019-05-01", "condensed-matter")),
      loaded("2019-03-04-01.json", as("mathematics", "2019-03-04", "proofs")),
      loaded("2018-12-31-01.json", as("earth", "2018-12-31", "climate")),
    ];
    expect(identifySeeds(files).map((s) => [s.name, s.id])).toEqual([
      ["2018-12-31-01.json", "earth-2018-0001"],
      ["2019-03-04-01.json", "math-2019-0001"],
      ["2019-05-01-01.json", "phys-2019-0002"],
      ["2019-05-01-02.json", "bio-2019-0003"],
      ["2020-01-01-01.json", "bio-2020-0001"],
    ]);
  });

  it("I2 file names compare by code unit: -02 before -10, and a date before any later one whatever its file number", () => {
    const files = [
      loaded("2019-05-01-10.json", as("biology", "2019-05-01", "drugs")),
      loaded("2019-05-01-02.json", as("biology", "2019-05-01", "drugs")),
      loaded("2019-05-02-01.json", as("biology", "2019-05-02", "drugs")),
      loaded("2019-05-01-09.json", as("biology", "2019-05-01", "drugs")),
    ];
    expect(orderSeeds(files).map((f) => f.name)).toEqual(["2019-05-01-02.json", "2019-05-01-09.json", "2019-05-01-10.json", "2019-05-02-01.json"]);
    expect(identifySeeds(files).map((s) => s.id)).toEqual(["bio-2019-0001", "bio-2019-0002", "bio-2019-0003", "bio-2019-0004"]);
  });

  it("I3 the order does not depend on the order given, and the input list is not changed", () => {
    const a = [loaded(BIO2, seedBio2()), loaded(PHYS, seedPhys()), loaded(BIO1, seedBio1())];
    const copy = [...a];
    const ids = identifySeeds(a).map((s) => [s.name, s.id]);
    expect(a).toEqual(copy);
    expect(identifySeeds([...a].reverse()).map((s) => [s.name, s.id])).toEqual(ids);
    expect(ids).toEqual([[PHYS, "phys-2018-0001"], [BIO1, "bio-2019-0001"], [BIO2, "bio-2019-0002"]]);
  });

  it("I4 the counter is four digits, zero-padded", () => {
    const files = Array.from({ length: 12 }, (_, i) => loaded(seedFileName("2019-05-01", i + 1), as("biology", "2019-05-01", "drugs")));
    const ids = identifySeeds(files).map((s) => s.id);
    expect(ids[0]).toBe("bio-2019-0001");
    expect(ids[11]).toBe("bio-2019-0012");
  });
});

// ── Removed text ─────────────────────────────────────────────────────────────────────────────────

describe("applyRemovals", () => {
  const ID = "bio-2019-0001";
  const gone = { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh };

  it("A1 an L10n path gets REMOVED_TEXT in both languages, and the seed given is not changed", () => {
    const seed = seedBio1();
    const out = applyRemovals(seed, ID, [forFinding(1, ID, "explainer.found"), forFinding(2, ID, "title")]);
    expect(out.explainer.found).toEqual(gone);
    expect(out.title).toEqual(gone);
    expect(out.explainer.matters).toEqual(seedBio1().explainer.matters);
    expect(seed).toEqual(seedBio1());
  });

  it("A2 a plain string path gets REMOVED_TEXT's English; an index in the path is a list place", () => {
    const out = applyRemovals(seedBio1(), ID, [
      forFinding(1, ID, "who.0.name"), forFinding(2, ID, "sources.1.title"), forFinding(3, ID, "ai.systems.0.maker"), forFinding(4, ID, "ai.evidence.0.quote"), forFinding(5, ID, "sources.0.url"),
    ]);
    expect(out.who[0]!.name).toBe(REMOVED_TEXT.en);
    expect(out.sources[1]!.title).toBe(REMOVED_TEXT.en);
    expect(out.sources[0]!.url).toBe(REMOVED_TEXT.en);
    expect(out.ai.systems[0]!.maker).toBe(REMOVED_TEXT.en);
    expect(out.ai.evidence[0]!.quote).toBe(REMOVED_TEXT.en);
    expect(out.sources[0]!.title).toBe(seedBio1().sources[0]!.title);
  });

  it("A3 a rung note that is an L10n is rewritten; a null note holds no text and stays null", () => {
    const withNote = applyRemovals(seedBio2(), "bio-2019-0002", [forFinding(1, "bio-2019-0002", "rung_history.0.note")]);
    expect(withNote.rung_history[0]!.note).toEqual(gone);
    const noNote = applyRemovals(seedBio1(), ID, [forFinding(1, ID, "rung_history.0.note")]);
    expect(noNote.rung_history[0]!.note).toBeNull();
  });

  it("A4 only a `removed` correction on this finding's removable path rewrites anything: another finding's, an edition's, another type and another path do not", () => {
    const wrongType = Correction.parse({
      id: "C-0009", date: "2026-11-21", finding_id: ID, edition_date: null, term_id: null, type: "correction", path: "explainer.found",
      before: l("old"), after: l("new"), reason: l("The record was wrong."), source_url: null, trigger: "editor", report_id: null,
    });
    const edition = removal(8, { edition_date: "2026-11-20", path: "pace.sentence" });
    const other = forFinding(7, "bio-2019-0002", "explainer.found");
    const notRemovable = forFinding(6, ID, "significance");
    const notRemovable2 = forFinding(5, ID, "rung_history.0.rung");
    const out = applyRemovals(seedBio1(), ID, [wrongType, edition, other, notRemovable, notRemovable2]);
    expect(out).toEqual(seedBio1());
  });

  it("A5 a removable path the file does not hold, or that holds no text, changes nothing and never throws", () => {
    const seed = seedBio1();
    const out = applyRemovals(seed, ID, [
      forFinding(1, ID, "sources.9.url"), forFinding(2, ID, "figure.alt"), forFinding(3, ID, "reactions.0.quote"), forFinding(4, ID, "since_then.0.text"), forFinding(5, ID, "figure.image_url"),
    ]);
    expect(out).toEqual(seedBio1());
  });

  it("A6 a correction of a term rewrites the definition, in both languages, of each new term the seed adds under that id", () => {
    const tid = "antimicrobial-resistance";
    const out = applyRemovals(seedBio1(), ID, [forTerm(1, tid)]);
    const t = out.terms[0]!;
    expect(t.new).toBe(true);
    if (t.new) {
      expect(t.definition).toBe(REMOVED_TEXT.en);
      expect(t.zh.definition).toBe(REMOVED_TEXT.zh);
      expect(t.term).toBe(TERM.term);
      expect(t.zh.term).toBe(TERM.zh.term);
    }
    // A seed that only lists the term (`new: false`) holds no definition to rewrite, and another term's id is not this one.
    expect(applyRemovals(seedBio2(), "bio-2019-0002", [forTerm(1, tid)])).toEqual(seedBio2());
    expect(applyRemovals(seedBio1(), ID, [forTerm(1, "another-term")])).toEqual(seedBio1());
  });

  it("A7 a term correction applies whatever finding the seed has, and a path other than `definition` on a term is no removal", () => {
    const wrongPath = removal(2, { term_id: "antimicrobial-resistance", path: "en.term" });
    expect(applyRemovals(seedBio1(), "bio-2019-0009", [wrongPath])).toEqual(seedBio1());
    const out = applyRemovals(seedBio1(), "bio-2019-0009", [forTerm(1, "antimicrobial-resistance")]);
    expect(out.terms[0]).not.toEqual(seedBio1().terms[0]);
  });

  it("A8 slot() walks a dotted path to the container of its last key, and leads nowhere through a null, a text, a missing key or a list place that is not there", () => {
    const root = { a: { b: { c: "x" } }, n: null, t: "text", list: [{ k: 1 }, { k: 2 }] };
    expect(slot(root, "a.b.c")).toEqual({ holder: root.a.b, key: "c" });
    expect(slot(root, "list.1.k")).toEqual({ holder: root.list[1], key: "k" });
    expect(slot(root, "a")).toEqual({ holder: root, key: "a" });
    for (const path of ["title", "n.b.c", "n.b", "t.length.x", "t.length", "a.x.c", "a.b.x", "list.2.k", "list.0.z"]) expect(slot(root, path), path).toBeNull();
    expect(slot(null, "a.b")).toBeNull();
    expect(slot("text", "a")).toBeNull();
  });

  it("A9 bracketed() writes a list place of a removable path as the rules do: ai.evidence.0.quote is ai.evidence[0].quote, after the prefix", () => {
    expect(bracketed("new_findings[0]", "title")).toBe("new_findings[0].title");
    expect(bracketed("new_findings[0]", "explainer.found")).toBe("new_findings[0].explainer.found");
    expect(bracketed("new_findings[0]", "ai.evidence.0.quote")).toBe("new_findings[0].ai.evidence[0].quote");
    for (const n of ["0", "1", "2", "5", "9", "10", "11", "19", "20", "99", "100", "1234"]) expect(bracketed("p", `sources.${n}.url`), n).toBe(`p.sources[${n}].url`);
    // Not a list place: a leading zero, a letter or a sign.
    for (const seg of ["01", "00", "1a", "a1", "-1"]) expect(bracketed("p", `sources.${seg}.url`), seg).toBe(`p.sources.${seg}.url`);
  });
});

describe("unremovedSeeds", () => {
  const opts = (w: World) => ({ root: w.root, seedDir: "seed/ledger", contentDir: "content" });

  it("M1 is empty with no corrections file, or with one that holds no `removed` correction of a finding or a term the seeds make", () => {
    const w = world();
    expect(unremovedSeeds(opts(w))).toEqual([]);
    putCorrections(w, []);
    expect(unremovedSeeds(opts(w))).toEqual([]);
    putCorrections(w, [removal(1, { edition_date: "2026-11-20", path: "pace.sentence" }), forFinding(2, "bio-2019-0009", "explainer.found")]);
    expect(unremovedSeeds(opts(w))).toEqual([]);
  });

  it("M2 names the file of a finding until it holds REMOVED_TEXT at the path (an L10n in both languages)", () => {
    const w = world();
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.found")]);
    expect(unremovedSeeds(opts(w))).toEqual([BIO1]);
    // Only the English marker: still holding removed text.
    const half = seedBio1();
    half.explainer.found.en = REMOVED_TEXT.en;
    writeSeeds(w.seeds, { [BIO1]: half });
    expect(unremovedSeeds(opts(w))).toEqual([BIO1]);
    // Both languages: no longer listed.
    half.explainer.found.zh = REMOVED_TEXT.zh;
    writeSeeds(w.seeds, { [BIO1]: half });
    expect(unremovedSeeds(opts(w))).toEqual([]);
  });

  it("M3 a plain string needs REMOVED_TEXT's English alone", () => {
    const w = world();
    putCorrections(w, [forFinding(1, "bio-2019-0001", "who.0.name")]);
    expect(unremovedSeeds(opts(w))).toEqual([BIO1]);
    const edit = seedBio1();
    edit.who[0]!.name = REMOVED_TEXT.en;
    writeSeeds(w.seeds, { [BIO1]: edit });
    expect(unremovedSeeds(opts(w))).toEqual([]);
  });

  it("M4 a path the file does not hold is neither applied nor listed (a later since_then note, an absent figure)", () => {
    const w = world();
    putCorrections(w, [forFinding(1, "bio-2019-0001", "since_then.0.text"), forFinding(2, "bio-2019-0001", "figure.alt"), forFinding(3, "bio-2019-0001", "sources.7.url"), forFinding(4, "bio-2019-0001", "rung_history.0.note")]);
    expect(unremovedSeeds(opts(w))).toEqual([]);
  });

  it("M5 a correction of a term lists the files that add it until their definition is REMOVED_TEXT in both languages; a file that only lists it is never named", () => {
    const w = world();
    putCorrections(w, [forTerm(1, "antimicrobial-resistance")]);
    expect(unremovedSeeds(opts(w))).toEqual([BIO1]);
    const edit = seedBio1();
    const t = edit.terms[0]!;
    if (!t.new) throw new Error("the sample term is new");
    t.definition = REMOVED_TEXT.en;
    writeSeeds(w.seeds, { [BIO1]: edit });
    expect(unremovedSeeds(opts(w))).toEqual([BIO1]);
    t.zh.definition = REMOVED_TEXT.zh;
    writeSeeds(w.seeds, { [BIO1]: edit });
    expect(unremovedSeeds(opts(w))).toEqual([]);
  });

  it("M6 lists every such file, in code-unit order of the names", () => {
    const w = world();
    putCorrections(w, [forFinding(1, "bio-2019-0002", "title"), forFinding(2, "phys-2018-0001", "explainer.found"), forFinding(3, "bio-2019-0001", "explainer.matters")]);
    expect(unremovedSeeds(opts(w))).toEqual([PHYS, BIO1, BIO2]);
  });

  it("M7 ids are the script's, not the file's: a correction on an id no file has names nothing", () => {
    const w = world();
    putCorrections(w, [forFinding(1, "bio-2019-0003", "title"), forFinding(2, "bio-2018-0001", "title")]);
    expect(unremovedSeeds(opts(w))).toEqual([]);
  });

  it("M8 defaults: `seed/ledger` and the content folder of UT_CONTENT_DIR, both read from `root`", () => {
    const w = world();
    putCorrections(w, [forFinding(1, "bio-2019-0001", "title")]);
    process.env.UT_CONTENT_DIR = w.content;
    expect(unremovedSeeds({ root: w.root })).toEqual([BIO1]);
    process.env.UT_CONTENT_DIR = path.join(w.root, "elsewhere");
    expect(unremovedSeeds({ root: w.root })).toEqual([]);
    delete process.env.UT_CONTENT_DIR;
    expect(unremovedSeeds({ root: w.root })).toEqual([BIO1]);
  });

  it("M9 a corrections file that does not parse reads as none (the seeder reports it); an unreadable seed folder throws InputError", () => {
    const w = world();
    fs.mkdirSync(w.content, { recursive: true });
    fs.writeFileSync(path.join(w.content, "corrections.json"), "{nope");
    expect(unremovedSeeds(opts(w))).toEqual([]);
    putCorrections(w, [forFinding(1, "bio-2019-0001", "title")]);
    expect(() => unremovedSeeds({ ...opts(w), seedDir: "no-such-folder" })).toThrow(InputError);
  });
});

// ── The run ──────────────────────────────────────────────────────────────────────────────────────

describe("a valid Ledger", () => {
  it("V1 writes each finding, the glossary and the archive index, and reports no issue at all", async () => {
    const w = world();
    const r = await seed(w);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.seeds).toEqual([{ id: "phys-2018-0001", file: PHYS }, { id: "bio-2019-0001", file: BIO1 }, { id: "bio-2019-0002", file: BIO2 }]);
    expect(r.written).toEqual(FIVE);
    expect(filesIn(w)).toEqual([...FIVE].sort());
  });

  it("V2 each finding is the stored form of §4.4: a Ledger record whose dates are all the file's `seeded`", async () => {
    const w = world();
    await seed(w);
    const f = Finding.parse(readJson(w, "findings/bio-2019-0001.json"));
    const s = seedBio1();
    expect(f).toMatchObject({
      id: "bio-2019-0001", field: "biology", subfield: "drugs", depth: "item", history: true, first_brief: null, briefs: [], since_then: [], applications: [],
      rung: "checked", first_published: "2019-05-01", updated: "2026-11-20", disclosure: false, terms: ["antimicrobial-resistance"], related: [],
    });
    expect(f.rung_history).toEqual([{ rung: "checked", date: "2019-05-01", recorded: "2026-11-20", source_id: "s1", by: "seed", note: null }]);
    expect(f.sources.map((x) => [x.id, x.seen_as, x.added])).toEqual([["s1", "seed", "2026-11-20"], ["s2", "seed", "2026-11-20"]]);
    expect(f.title).toEqual(s.title);
    expect(f.explainer).toEqual(s.explainer);
    expect(f.ai).toEqual(s.ai);
    // The physics finding has its own `seeded`.
    expect(readJson(w, "findings/phys-2018-0001.json")).toMatchObject({ updated: "2026-11-18", id: "phys-2018-0001", field: "physics" });
    expect(readJson(w, "findings/phys-2018-0001.json").sources[0].added).toBe("2026-11-18");
  });

  it("V3 the written files are in the stored form: each is its schema's jsonText, and validateAll() gives no error on the folder", async () => {
    const w = world();
    await seed(w);
    for (const id of ["phys-2018-0001", "bio-2019-0001", "bio-2019-0002"]) {
      const text = readText(w, `findings/${id}.json`);
      expect(text).toBe(jsonText(Finding.parse(JSON.parse(text)), Finding));
    }
    expect(readText(w, "glossary.json")).toBe(jsonText(GlossaryFile.parse(readJson(w, "glossary.json")), GlossaryFile));
    expect(readText(w, "archive-index.json")).toBe(jsonText(ArchiveIndex.parse(readJson(w, "archive-index.json")), ArchiveIndex));
    expect(errorsOf(validateAll(w.content, { config }).issues)).toEqual([]);
  });

  it("V4 the glossary holds each new term once: the Chinese as written, `fields`, and the first finding and its `seeded` date", async () => {
    const w = world();
    await seed(w);
    expect(readJson(w, "glossary.json")).toEqual({
      schema_version: 1,
      terms: [{
        id: "antimicrobial-resistance",
        en: { term: TERM.term, definition: TERM.definition },
        zh: { term: TERM.zh.term, definition: TERM.zh.definition, official: TERM.zh.official, official_url: TERM_URL },
        fields: ["biology"],
        first_finding: "bio-2019-0001",
        first_date: "2026-11-20",
      }],
    });
  });

  it("V5 the archive index has an entry for each source URL, keyed by the normalised URL in code-unit order, with the snapshots' hashes", async () => {
    const w = world();
    await seed(w);
    const hash = (file: string) => textSha256(htmlText(fs.readFileSync(path.join(FEEDS_DIR, "pages", file), "utf8")));
    expect(readJson(w, "archive-index.json")).toEqual({
      schema_version: 1,
      editions: [],
      urls: {
        "https://arxiv.org/abs/2901.99003": { first_cited: "2026-11-18", refs: ["phys-2018-0001", "bio-2019-0002"], sha256: hash("ledger-physics.html"), hashed_at: FETCHED_AT, last_check: null },
        "https://cell.com/cell/abstract/ut-sample-ledger-0001": { first_cited: "2026-11-20", refs: ["bio-2019-0001"], sha256: hash("ledger-paper.html"), hashed_at: FETCHED_AT, last_check: null },
        "https://clinicaltrials.gov/study/NCT09990101": { first_cited: "2026-11-20", refs: ["bio-2019-0001"], sha256: hash("ledger-trial.html"), hashed_at: FETCHED_AT, last_check: null },
      },
    });
    expect(Object.keys(readJson(w, "archive-index.json").urls)).toEqual([...Object.keys(readJson(w, "archive-index.json").urls)].sort());
  });

  it("V6 `first_cited` is the earliest `seeded` of the findings that cite the URL, and `refs` are in compareFindingIds() order, at most 20", async () => {
    const seeds: Record<string, SeedFinding> = {};
    for (let i = 1; i <= 25; i++) {
      const s = seedBio2();
      s.seeded = i === 7 ? "2026-11-05" : "2026-11-20";
      s.terms = i === 1 ? [clone(TERM)] : [{ new: false, id: "antimicrobial-resistance" }];
      seeds[seedFileName("2019-05-01", i)] = s;
    }
    const w = world(seeds);
    const r = await seed(w);
    expect(errorsOf(r.issues).map((x) => [x.code, x.path])).toEqual([]);
    const entry = readJson(w, "archive-index.json").urls["https://arxiv.org/abs/2901.99003"];
    expect(entry.first_cited).toBe("2026-11-05");
    expect(entry.refs).toHaveLength(20);
    expect(entry.refs[0]).toBe("bio-2019-0001");
    expect(entry.refs[19]).toBe("bio-2019-0020");
  });

  it("V7 a rerun on the same files writes nothing, and every file is byte-identical", async () => {
    const w = world();
    await seed(w);
    const before = Object.fromEntries(FIVE.map((f) => [f, readText(w, f)]));
    const again = await seed(w);
    expect(again.ok).toBe(true);
    expect(again.written).toEqual([]);
    for (const f of FIVE) expect(readText(w, f), f).toBe(before[f]);
  });

  it("V8 the stored snapshots are read, not taken again: a rerun with no content folder and a later clock gives the same bytes and asks for no page", async () => {
    const w = world();
    await seed(w);
    const before = Object.fromEntries(FIVE.map((f) => [f, readText(w, f)]));
    fs.rmSync(w.content, { recursive: true });
    const probe = counting();
    const later = () => Date.parse("2027-02-03T01:00:00Z");
    const again = await seed(w, { fetch: probe.fn, now: later });
    expect(again.written).toEqual(FIVE);
    expect(probe.urls).toEqual([]);
    for (const f of FIVE) expect(readText(w, f), f).toBe(before[f]);
  });

  it("V9 a change to one seed rewrites only what it changes", async () => {
    const w = world();
    await seed(w);
    const edit = seedBio2();
    edit.who = [{ name: "Another sample academic team", ror: null }];
    writeSeeds(w.seeds, { [BIO2]: edit });
    const again = await seed(w);
    expect(again.ok).toBe(true);
    expect(again.written).toEqual(["findings/bio-2019-0002.json"]);
  });

  it("V10 without --out nothing is written and the content folder is not made", async () => {
    const w = world();
    const r = await seed(w, { outDir: null });
    expect(r.ok).toBe(true);
    expect(r.written).toEqual([]);
    expect(r.seeds).toHaveLength(3);
    expect(fs.existsSync(w.content)).toBe(false);
    // The snapshots are still cached, for the run that writes.
    expect(fs.existsSync(snapshotFile(w.root, PAPER_URL))).toBe(true);
  });

  it("V11 nothing is written when any seed is invalid, and the content folder is not made", async () => {
    const w = world(edited(BIO1, (s) => { s.subfield = "no-such-subfield"; }));
    const r = await seed(w);
    expect(r.ok).toBe(false);
    expect(r.written).toEqual([]);
    expect(fs.existsSync(w.content)).toBe(false);
  });

  it("V12 an empty seed folder is valid and writes an empty glossary and an empty archive index", async () => {
    const w = world({});
    const r = await seed(w);
    expect(r).toEqual({ ok: true, issues: [], seeds: [], written: ["glossary.json", "archive-index.json"] });
    expect(readJson(w, "glossary.json")).toEqual({ schema_version: 1, terms: [] });
    expect(readJson(w, "archive-index.json")).toEqual({ schema_version: 1, editions: [], urls: {} });
  });

  it("V13 a seed folder that cannot be read is an InputError", async () => {
    const w = world(null);
    await expect(seed(w, { inDir: "no-such-folder" })).rejects.toThrow(InputError);
  });
});

describe("what is stored already in the content folder", () => {
  it("S1 the archive index keeps the other entries and `editions`, and replaces the entries of the URLs the seeds cite", async () => {
    const w = world();
    await seed(w);
    const index = readJson(w, "archive-index.json");
    index.editions = [{ date: "2026-11-24", edition: "full", published_at: "2026-11-24T04:10:00+08:00", finding_count: 2, corrected: false }];
    index.urls["https://example.org/ut-sample/other"] = { first_cited: "2026-11-24", refs: ["2026-11-24/brief"], sha256: "a".repeat(64), hashed_at: "2026-11-24T05:00:00+08:00", last_check: null };
    index.urls["https://arxiv.org/abs/2901.99003"] = { first_cited: "2020-01-01", refs: ["bio-2019-0009"], sha256: "b".repeat(64), hashed_at: "2020-01-01T00:00:00+08:00", last_check: null };
    fs.writeFileSync(path.join(w.content, "archive-index.json"), jsonText(ArchiveIndex.parse(index), ArchiveIndex));
    const r = await seed(w);
    expect(r.ok).toBe(true);
    expect(r.written).toEqual(["archive-index.json"]);
    const after = readJson(w, "archive-index.json");
    expect(after.editions).toEqual(index.editions);
    expect(after.urls["https://example.org/ut-sample/other"]).toEqual(index.urls["https://example.org/ut-sample/other"]);
    expect(after.urls["https://arxiv.org/abs/2901.99003"].refs).toEqual(["phys-2018-0001", "bio-2019-0002"]);
    expect(after.urls["https://arxiv.org/abs/2901.99003"].first_cited).toBe("2026-11-18");
    expect(Object.keys(after.urls)).toEqual([...Object.keys(after.urls)].sort());
  });

  it("S2 the glossary keeps the other terms, replaces a stored term the seeds define, and is sorted by id", async () => {
    const w = world();
    await seed(w);
    const glossary = readJson(w, "glossary.json");
    const base = glossary.terms[0];
    const extra = (id: string, term: string) => ({ ...base, id, en: { term, definition: `About ${term}.` }, first_finding: "bio-2019-0001", first_date: "2026-11-01" });
    glossary.terms = [extra("aaa-term", "aaa term"), { ...base, en: { term: base.en.term, definition: "A stale definition." } }, extra("zeta-term", "zeta term")];
    fs.writeFileSync(path.join(w.content, "glossary.json"), jsonText(GlossaryFile.parse(glossary), GlossaryFile));
    const r = await seed(w);
    expect(r.ok).toBe(true);
    expect(r.written).toEqual(["glossary.json"]);
    const after = readJson(w, "glossary.json");
    expect(after.terms.map((t: any) => t.id)).toEqual(["aaa-term", "antimicrobial-resistance", "zeta-term"]);
    expect(after.terms[1].en.definition).toBe(TERM.definition);
  });

  it("S3 a term that a seed lists as existing may be one the stored glossary holds; the glossary is then left as it is", async () => {
    const w = world();
    await seed(w);
    const glossary = readText(w, "glossary.json");
    const w2 = world({ [BIO1]: edited(BIO1, (s) => { s.terms = [{ new: false, id: "antimicrobial-resistance" }]; })[BIO1], [BIO2]: seedBio2() });
    fs.mkdirSync(w2.content, { recursive: true });
    fs.writeFileSync(path.join(w2.content, "glossary.json"), glossary);
    const r = await seed(w2);
    expect(errorsOf(r.issues)).toEqual([]);
    expect(r.written).not.toContain("glossary.json");
    expect(readText(w2, "glossary.json")).toBe(glossary);
  });

  it("S4 a corrections file, a glossary or an archive index that does not parse is an error, and nothing is written", async () => {
    for (const [file, label] of [["corrections.json", "corrections"], ["glossary.json", "glossary"], ["archive-index.json", "archive-index"]] as const) {
      const w = world();
      fs.mkdirSync(w.content, { recursive: true });
      fs.writeFileSync(path.join(w.content, file), "{nope");
      const r = await seed(w);
      expect(r.ok, label).toBe(false);
      expect(errorsOf(r.issues).map((i) => [i.code, i.path]), label).toEqual([["SCHEMA", file]]);
      expect(r.written, label).toEqual([]);
    }
  });

  it("S5 a corrections, glossary or archive-index file that parses as JSON but fails its schema names the file and the path in it", async () => {
    const cases: [string, unknown][] = [["corrections.json", { schema_version: 1, corrections: [{}] }], ["glossary.json", { schema_version: 1, terms: [{}] }], ["archive-index.json", { schema_version: 2 }]];
    for (const [file, value] of cases) {
      const w = world();
      fs.mkdirSync(w.content, { recursive: true });
      fs.writeFileSync(path.join(w.content, file), JSON.stringify(value));
      const r = await seed(w);
      expect(r.ok, file).toBe(false);
      const errs = errorsOf(r.issues);
      expect(errs.length, file).toBeGreaterThan(0);
      expect(errs.every((i) => i.code === "SCHEMA" && i.path.startsWith(`${file}: `)), file).toBe(true);
    }
  });

  it("S6 without --out the stored corrections are read from run.json's content folder", async () => {
    const w = world();
    fs.mkdirSync(path.join(w.root, config.run.paths.content_dir), { recursive: true });
    fs.writeFileSync(path.join(w.root, config.run.paths.content_dir, "corrections.json"), "{nope");
    const r = await seed(w, { outDir: null });
    expect(errorsOf(r.issues).map((i) => i.path)).toEqual(["corrections.json"]);
  });
});

describe("a stored `removed` correction on a rerun (§4.10, §8.13)", () => {
  it("X1 is applied: the finding is written with REMOVED_TEXT at the path, in both languages of an L10n", async () => {
    const w = world();
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.background"), forFinding(2, "bio-2019-0001", "who.0.name")]);
    const r = await seed(w);
    expect(r.issues).toEqual([]);
    const f = readJson(w, "findings/bio-2019-0001.json");
    expect(f.explainer.background).toEqual({ en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh });
    expect(f.who[0].name).toBe(REMOVED_TEXT.en);
    expect(f.explainer.found.en).toBe(seedBio1().explainer.found.en);
    expect(unremovedSeeds({ root: w.root, contentDir: "content" })).toEqual([BIO1]);
  });

  it("X2 text that would fail a rule is not judged once it is removed, and the same text fails without the correction", async () => {
    const hype = (s: SeedFinding) => { s.explainer.background.en += " It is a revolutionary result."; };
    const bad = world(edited(BIO1, hype));
    const r1 = await seed(bad);
    expect(errorsOf(r1.issues).map((i) => i.code)).toContain("HYPE_WORDS");
    const w = world(edited(BIO1, hype));
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.background")]);
    const r2 = await seed(w);
    expect(r2.issues).toEqual([]);
    expect(readJson(w, "findings/bio-2019-0001.json").explainer.background.en).toBe(REMOVED_TEXT.en);
  });

  it("X3 a removed quote is not looked for in the page, and the same quote fails without the correction", async () => {
    const bad = (s: SeedFinding) => { s.ai.evidence[0]!.quote = "A sentence that the page does not hold at all"; };
    expect(errorsOf((await seed(world(edited(BIO1, bad)))).issues).map((i) => i.code)).toEqual(["QUOTE_VERBATIM"]);
    const w = world(edited(BIO1, bad));
    putCorrections(w, [forFinding(1, "bio-2019-0001", "ai.evidence.0.quote")]);
    const r = await seed(w);
    expect(r.issues).toEqual([]);
    expect(readJson(w, "findings/bio-2019-0001.json").ai.evidence[0].quote).toBe(REMOVED_TEXT.en);
  });

  it("X4 a removed explainer part counts as no words and lifts the lower bound of the first four parts (§4.12 'Removed text')", async () => {
    const w = world();
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.found"), forFinding(2, "bio-2019-0001", "explainer.matters"), forFinding(3, "bio-2019-0001", "explainer.ai_helped")]);
    const r = await seed(w);
    expect(r.issues).toEqual([]);
    expect(readJson(w, "findings/bio-2019-0001.json").explainer.matters).toEqual({ en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh });
    // The same parts with no correction and far too few words are an error.
    const short = world(edited(BIO1, (s) => {
      s.explainer.found = { en: "A model proposed a drug.", zh: "一個模型提出了一種藥。" };
      s.explainer.matters = { en: "Antimicrobial resistance is a problem.", zh: "抗微生物抗藥性（antimicrobial resistance）是個問題。" };
    }));
    expect(codes(errorsOf((await seed(short)).issues))).toContain("WORDS");
  });

  /** The first biology seed with the term used twice: in `matters` (the first use, with the English in brackets) and again in `could_lead`. */
  const twoUses = (s: SeedFinding): void => {
    s.explainer.could_lead = {
      en: "If later trials go well, it could become a treatment for antimicrobial resistance. Other labs must repeat the tests first.",
      zh: "如果後續試驗順利，它可能成為對抗抗微生物抗藥性的治療方法。不過其他實驗室必須先重複這些實驗。",
    };
  };
  const plainMatters = (s: SeedFinding): void => {
    s.explainer.matters = { en: "Some infections are hard to treat, so doctors need new antibiotics. A first safety trial in people is registered as NCT09990101.", zh: "某些感染難以治療，所以醫師需要新的抗生素。第一項人體安全性試驗已登記為 NCT09990101。" };
  };

  it("X4b the lift of a removed part: TERM_DEFINED no longer needs a listed term to appear, and fails without the removal", async () => {
    // The term appears only in `matters`. Rewritten (not removed) so that it does not, the term is listed and unused: an error.
    const unused = await seed(world(edited(BIO1, plainMatters)));
    expect(errorsOf(unused.issues).map((i) => [i.code, i.path])).toEqual([["TERM_DEFINED", "seeds[1].terms[0]"]]);
    // Removed, the same term is not asked for.
    const w = world();
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.matters")]);
    expect((await seed(w)).issues).toEqual([]);
  });

  it("X4c the lift of a removed part: ZH_ENGLISH_ONCE no longer needs the first remaining use of a term to carry the English", async () => {
    const base = await seed(world(edited(BIO1, twoUses)), { outDir: null });
    expect(errorsOf(base.issues)).toEqual([]);
    // `matters` rewritten without the term (not removed): the first Chinese use is now in `could_lead`, with no English in brackets.
    const rewritten = await seed(world(edited(BIO1, (s) => { twoUses(s); plainMatters(s); })), { outDir: null });
    expect(errorsOf(rewritten.issues).map((i) => i.code)).toEqual(["ZH_ENGLISH_ONCE"]);
    expect(errorsOf(rewritten.issues)[0]!.message).toContain("The first use of");
    // `matters` removed: the first remaining use needs none.
    const w = world(edited(BIO1, twoUses));
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.matters")]);
    const r = await seed(w);
    expect(r.issues).toEqual([]);
    expect(readJson(w, "findings/bio-2019-0001.json").explainer.matters).toEqual({ en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh });
  });

  it("X4d a removed part lifts only those checks: a later use that repeats the English in brackets is still an error", async () => {
    const w = world(edited(BIO1, (s) => {
      twoUses(s);
      s.explainer.could_lead.zh = s.explainer.could_lead.zh.replace("抗微生物抗藥性", "抗微生物抗藥性（antimicrobial resistance）");
    }));
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.matters")]);
    const r = await seed(w, { outDir: null });
    // `matters` is removed, so `could_lead` holds the first remaining use, which may carry the English: no error.
    expect(errorsOf(r.issues)).toEqual([]);
    const both = world(edited(BIO1, (s) => {
      twoUses(s);
      s.explainer.could_lead.zh = s.explainer.could_lead.zh.replace("抗微生物抗藥性", "抗微生物抗藥性（antimicrobial resistance）");
    }));
    const r2 = await seed(both, { outDir: null });
    expect(errorsOf(r2.issues).map((i) => i.code)).toEqual(["ZH_ENGLISH_ONCE"]);
    expect(errorsOf(r2.issues)[0]!.message).toContain("repeats the English term in brackets");
  });

  it("X4e a lifted ZH_ENGLISH_ONCE issue is dropped and the Chinese issues after it are kept", async () => {
    // `matters` is removed and `could_lead` holds the first remaining use, which needs no English; a simplified character after it is still an error.
    const w = world(edited(BIO1, (s) => {
      twoUses(s);
      s.explainer.could_lead.zh = s.explainer.could_lead.zh.replace("不過", "不过");
    }));
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.matters")]);
    const r = await seed(w, { outDir: null });
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["ZH_TRADITIONAL", 'seeds[1] (Chinese) strings["new.new-1.explainer.could_lead"]']]);
  });

  it("X10 an issue at a removed path is dropped and the issues after it are kept", async () => {
    // Two quotes the page does not hold. The first is removed, so its QUOTE_VERBATIM issue is dropped; the second's is not.
    const bad = (s: SeedFinding) => {
      s.ai.evidence[0]!.quote = "A sentence that the page does not hold at all";
      s.ai.evidence.push({ source_id: "s1", quote: "Another sentence that the page does not hold either", from_claimant: true });
    };
    const none = await seed(world(edited(BIO1, bad)), { outDir: null });
    expect(errorsOf(none.issues).map((i) => [i.code, i.path])).toEqual([["QUOTE_VERBATIM", "seeds[1].ai.evidence[0].quote"], ["QUOTE_VERBATIM", "seeds[1].ai.evidence[1].quote"]]);
    const w = world(edited(BIO1, bad));
    putCorrections(w, [forFinding(1, "bio-2019-0001", "ai.evidence.0.quote")]);
    const r = await seed(w, { outDir: null });
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["QUOTE_VERBATIM", "seeds[1].ai.evidence[1].quote"]]);
  });

  it("X11 a lifted TERM_DEFINED issue is dropped and the issues after it are kept", async () => {
    // The term appears only in `matters`; with `matters` removed its "never uses it" issue is lifted. Its duplicate, listed after it, is still an error.
    const twice = (s: SeedFinding) => { s.terms.push(clone(TERM)); };
    const w = world(edited(BIO1, twice));
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.matters")]);
    const r = await seed(w, { outDir: null });
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["TERM_DEFINED", "seeds[1].terms[1]"]]);
    expect(errorsOf(r.issues)[0]!.message).toContain("already the id");
  });

  it("X12 a correction of one finding lifts nothing for another, even one whose file holds REMOVED_TEXT at the same path", async () => {
    // The second biology file holds REMOVED_TEXT in `matters`, where it uses the term it lists; only the first biology finding has a correction.
    const w = world(edited(BIO2, (s) => { s.explainer.matters = { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh }; }));
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.matters")]);
    const r = await seed(w, { outDir: null });
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["TERM_DEFINED", "seeds[2].terms[0]"]]);
    // With a correction of its own, the same file is judged as removed text and is clean.
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.matters"), forFinding(2, "bio-2019-0002", "explainer.matters")]);
    expect(errorsOf((await seed(w, { outDir: null })).issues)).toEqual([]);
  });

  it("X5 a removed title is written as REMOVED_TEXT and its Chinese is not asked for", async () => {
    const w = world();
    putCorrections(w, [forFinding(1, "bio-2019-0001", "title")]);
    const r = await seed(w);
    expect(r.issues).toEqual([]);
    expect(readJson(w, "findings/bio-2019-0001.json").title).toEqual({ en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh });
  });

  it("X6 a removed term definition is written to the glossary in both languages", async () => {
    const w = world();
    putCorrections(w, [forTerm(1, "antimicrobial-resistance")]);
    const r = await seed(w);
    expect(r.issues).toEqual([]);
    const t = readJson(w, "glossary.json").terms[0];
    expect(t.en).toEqual({ term: TERM.term, definition: REMOVED_TEXT.en });
    expect(t.zh.definition).toBe(REMOVED_TEXT.zh);
    expect(t.zh.term).toBe(TERM.zh.term);
  });

  it("X7 a removed source address has no page to read: no GET for it, no SEED_SOURCES, no archive entry, and one warning that the page-text checks were skipped", async () => {
    const w = world();
    putCorrections(w, [forFinding(1, "bio-2019-0001", "sources.1.url")]);
    const probe = counting();
    const r = await seed(w, { fetch: probe.fn });
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => [i.severity, i.code, i.path])).toEqual([["warning", "INPUT_MISSING", "seeds[1]"]]);
    expect(r.issues[0]!.message).toContain("removed");
    expect(probe.urls).not.toContain(REMOVED_TEXT.en);
    expect(probe.urls).not.toContain(TRIAL_URL);
    expect(readJson(w, "findings/bio-2019-0001.json").sources[1].url).toBe(REMOVED_TEXT.en);
    expect(Object.keys(readJson(w, "archive-index.json").urls)).toEqual(["https://arxiv.org/abs/2901.99003", "https://cell.com/cell/abstract/ut-sample-ledger-0001"]);
  });

  it("X8 a rerun with a stored removal is byte-identical to the run before it", async () => {
    const w = world();
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.background")]);
    await seed(w);
    const before = Object.fromEntries(FIVE.map((f) => [f, readText(w, f)]));
    const again = await seed(w);
    expect(again.written).toEqual([]);
    for (const f of FIVE) expect(readText(w, f), f).toBe(before[f]);
  });

  it("X9 once the file holds REMOVED_TEXT at the path itself, the run is clean and unremovedSeeds() no longer names it", async () => {
    const w = world(edited(BIO1, (s) => { s.explainer.background = { en: REMOVED_TEXT.en, zh: REMOVED_TEXT.zh }; }));
    putCorrections(w, [forFinding(1, "bio-2019-0001", "explainer.background")]);
    const r = await seed(w);
    expect(r.issues).toEqual([]);
    expect(unremovedSeeds({ root: w.root, contentDir: "content" })).toEqual([]);
  });
});

// ── --verify ─────────────────────────────────────────────────────────────────────────────────────

describe("--verify and the pages", () => {
  it("P1 asks for each source URL once, then each term's 樂詞網 page, exactly as the seed gives them; a URL two seeds cite is one GET", async () => {
    const w = world();
    const probe = counting();
    const r = await seed(w, { fetch: probe.fn });
    expect(r.ok).toBe(true);
    expect(probe.urls).toEqual([PREPRINT_URL, PAPER_URL, TRIAL_URL, TERM_URL]);
  });

  it("P2 a snapshot already in cache/snapshots/ is read and not asked for again", async () => {
    const w = world();
    await seed(w, { outDir: null });
    expect(fs.readdirSync(path.join(w.root, "cache", "snapshots"))).toHaveLength(4);
    const probe = counting();
    const r = await seed(w, { fetch: probe.fn, outDir: null });
    expect(r.ok).toBe(true);
    expect(probe.urls).toEqual([]);
    fs.rmSync(snapshotFile(w.root, TRIAL_URL));
    const probe2 = counting();
    await seed(w, { fetch: probe2.fn, outDir: null });
    expect(probe2.urls).toEqual([TRIAL_URL]);
  });

  it("P3 a source that answers 404 fails with SEED_SOURCES alone, at its place in its file, and the seed's page-text checks are skipped", async () => {
    const w = world(edited(BIO1, (s) => { s.sources[0]!.url = MISSING_URL; }));
    const r = await seed(w);
    expect(r.ok).toBe(false);
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["SEED_SOURCES", "seeds[1].sources[0].url"]]);
    expect(errorsOf(r.issues)[0]!.message).toContain(MISSING_URL);
    expect(r.issues.filter((i) => i.severity === "warning").map((i) => [i.code, i.path])).toEqual([["INPUT_MISSING", "seeds[1]"]]);
    expect(r.written).toEqual([]);
  });

  it("P4 a source that is a PDF fails with SEED_SOURCES alone", async () => {
    const w = world(edited(BIO1, (s) => { s.sources[0]!.url = PDF_URL; }));
    const r = await seed(w);
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["SEED_SOURCES", "seeds[1].sources[0].url"]]);
    expect(errorsOf(r.issues)[0]!.message).toContain("PDF");
    expect(fs.existsSync(snapshotFile(w.root, PDF_URL))).toBe(false);
  });

  it("P5 only the source that has no snapshot is named (here the registry page, which answers 503), and the seeds that read all their pages are judged as usual", async () => {
    const down = counting({ [TRIAL_URL]: (r) => ({ ...r, ok: false, status: 503, body: null, error: "http_503", contentType: null }) });
    const w = world();
    const r = await seed(w, { fetch: down.fn });
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["SEED_SOURCES", "seeds[1].sources[1].url"]]);
    expect(errorsOf(r.issues)[0]!.message).toContain(TRIAL_URL);
    // The other seeds are untouched: no warning for them, and their pages were read.
    expect(r.issues.filter((i) => i.severity === "warning").map((i) => i.path)).toEqual(["seeds[1]"]);
    expect(r.issues.find((i) => i.severity === "warning")!.message).toContain("the page-text checks were skipped, since a source has no snapshot.");
    expect(fs.existsSync(snapshotFile(w.root, PREPRINT_URL))).toBe(true);
    expect(fs.existsSync(snapshotFile(w.root, TRIAL_URL))).toBe(false);
  });

  it("P5b two sources with no snapshot are two SEED_SOURCES errors and one warning that says `some sources have`", async () => {
    const down = counting({
      [TRIAL_URL]: (r) => ({ ...r, ok: false, status: 503, body: null, error: "http_503", contentType: null }),
      [PAPER_URL]: (r) => ({ ...r, ok: false, status: 503, body: null, error: "http_503", contentType: null }),
    });
    const r = await seed(world(), { fetch: down.fn });
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["SEED_SOURCES", "seeds[1].sources[0].url"], ["SEED_SOURCES", "seeds[1].sources[1].url"]]);
    const warnings = r.issues.filter((i) => i.severity === "warning");
    expect(warnings.map((i) => i.path)).toEqual(["seeds[1]"]);
    expect(warnings[0]!.message).toContain("the page-text checks were skipped, since some sources have no snapshot.");
  });

  it("P6 a blocked host is never requested, and the seed fails with SEED_SOURCES and with BLOCKED_HOST", async () => {
    const w = world(edited(BIO1, (s) => { s.sources[1]!.url = "https://pastebin.com/ut-sample"; s.artefacts.trial = []; }));
    const probe = counting();
    const r = await seed(w, { fetch: probe.fn });
    expect(probe.urls).not.toContain("https://pastebin.com/ut-sample");
    expect(codes(errorsOf(r.issues))).toEqual(expect.arrayContaining(["SEED_SOURCES", "BLOCKED_HOST"]));
  });

  it("P7 a quote that is not in its source's page is QUOTE_VERBATIM at its place; without --verify the same seed passes", async () => {
    const bad = (s: SeedFinding) => { s.ai.evidence[0]!.quote = "Our model ranked about 12 million molecules for killing germs"; };
    const checked = await seed(world(edited(BIO1, bad)));
    expect(errorsOf(checked.issues).map((i) => [i.code, i.path])).toEqual([["QUOTE_VERBATIM", "seeds[1].ai.evidence[0].quote"]]);
    const unchecked = await seed(world(edited(BIO1, bad)), { verify: false, outDir: null });
    expect(errorsOf(unchecked.issues)).toEqual([]);
  });

  it("P8 a number that no cited page shows is NUMBER_SOURCED at its explainer part", async () => {
    const w = world(edited(BIO1, (s) => {
      s.explainer.found.en = s.explainer.found.en.replace("40 of", "47 of");
      s.explainer.found.zh = s.explainer.found.zh.replace("40 個", "47 個");
    }));
    const r = await seed(w);
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["NUMBER_SOURCED", "seeds[1].explainer.found"]]);
  });

  it("P9 an artefact that no cited page shows is ARTEFACT_FORMAT's page test", async () => {
    const w = world(edited(BIO1, (s) => { s.artefacts.doi = ["10.1016/ut-sample-ledger-9999"]; }));
    const r = await seed(w);
    expect(errorsOf(r.issues).map((i) => i.code)).toEqual(["ARTEFACT_FORMAT"]);
    expect(errorsOf(r.issues)[0]!.path).toContain("seeds[1]");
  });

  it("P10 PRIMARY_ONLY's type check reads the types the snapshot found: a page typed as a news piece fails, the saved page's own type passes", async () => {
    const news = counting({
      [PAPER_URL]: (r) => ({ ...r, body: Buffer.from(r.body!.toString("utf8").replace('content="Article"', 'content="News &amp; Views"')) }),
    });
    const w = world();
    const r = await seed(w, { fetch: news.fn });
    expect(r.ok).toBe(false);
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["PRIMARY_ONLY", "seeds[1].sources[0].url"]]);
    const ok = await seed(world());
    expect(ok.ok).toBe(true);
  });

  it("P11 a page that gave no article type fails PRIMARY_ONLY's type check as a typed publisher's page with no type", async () => {
    const untyped = counting({
      [PAPER_URL]: (r) => ({ ...r, body: Buffer.from(r.body!.toString("utf8").replace(/<meta name="citation_article_type"[^>]*>/, "")) }),
    });
    const r = await seed(world(), { fetch: untyped.fn });
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["PRIMARY_ONLY", "seeds[1].sources[0].url"]]);
  });

  const DOI_URL = "https://doi.org/10.1016/ut-sample-ledger-0001";
  /** A fetch that answers `DOI_URL` with the paper's saved page, as if doi.org had redirected to `landing`; every other URL is answered as usual. */
  const landing = (to: string) => {
    const urls: string[] = [];
    const fn = (async (url: string, options?: FetchOptions) => {
      urls.push(url);
      return url === DOI_URL ? { ...(await fetchFeed(PAPER_URL, options)), finalUrl: to } : fetchFeed(url, options);
    }) as typeof fetchFeed;
    return { urls, fn };
  };

  it("P11b a doi.org source is judged through the page it landed on: the snapshot keeps the landing and its article type, and the archive index keys the DOI's own address", async () => {
    const w = world(edited(BIO1, (s) => { s.sources[0]!.url = DOI_URL; }));
    const probe = landing(PAPER_URL);
    const r = await seed(w, { fetch: probe.fn });
    expect(errorsOf(r.issues)).toEqual([]);
    expect(probe.urls).toContain(DOI_URL);
    expect(probe.urls).not.toContain(PAPER_URL);
    const snap = JSON.parse(fs.readFileSync(snapshotFile(w.root, DOI_URL), "utf8"));
    expect(snap).toMatchObject({ url: DOI_URL, final_url: PAPER_URL, article_types: ["Article"] });
    const urls = readJson(w, "archive-index.json").urls;
    expect(urls[normalizeUrl(DOI_URL)]).toMatchObject({ refs: ["bio-2019-0001"], sha256: snap.text_sha256, hashed_at: FETCHED_AT });
  });

  it("P11c a doi.org source whose landing is no primary source fails PRIMARY_ONLY, whatever its page says", async () => {
    const w = world(edited(BIO1, (s) => { s.sources[0]!.url = DOI_URL; }));
    const r = await seed(w, { fetch: landing("https://example.org/ut-sample/landing").fn });
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["PRIMARY_ONLY", "seeds[1].sources[0].url"]]);
    expect(r.written).toEqual([]);
  });

  it("P11d a doi.org source whose landing page shows a news type fails the type check through the landing's types", async () => {
    const w = world(edited(BIO1, (s) => { s.sources[0]!.url = DOI_URL; }));
    const probe = landing(PAPER_URL);
    const news = (async (url: string, options?: FetchOptions) => {
      const real = await probe.fn(url, options);
      return url === DOI_URL ? { ...real, body: Buffer.from(real.body!.toString("utf8").replace('content="Article"', 'content="News &amp; Views"')) } : real;
    }) as typeof fetchFeed;
    const r = await seed(w, { fetch: news });
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["PRIMARY_ONLY", "seeds[1].sources[0].url"]]);
  });

  it("P12 ZH_OFFICIAL's page test: an official form that the term's page does not hold is an error at the term's key", async () => {
    const w = world(edited(BIO1, (s) => { const t = s.terms[0]!; if (t.new) t.zh.official = "抗藥性微生物"; }));
    const r = await seed(w);
    const errs = errorsOf(r.issues);
    expect(errs.map((i) => i.code)).toEqual(["ZH_OFFICIAL"]);
    expect(errs[0]!.path).toContain("seeds[1] (Chinese)");
    expect(errs[0]!.path).toContain("antimicrobial-resistance");
    // Without --verify no page is read, so the same seed has no such error.
    const unchecked = await seed(world(edited(BIO1, (s) => { const t = s.terms[0]!; if (t.new) t.zh.official = "抗藥性微生物"; })), { verify: false, outDir: null });
    expect(errorsOf(unchecked.issues)).toEqual([]);
  });

  it("P13 ZH_OFFICIAL's host test: an `official_url` off terms.naer.edu.tw is an error and its page is never fetched", async () => {
    const w = world(edited(BIO1, (s) => { const t = s.terms[0]!; if (t.new) t.zh.official_url = "https://example.org/ut-sample/term"; }));
    const probe = counting();
    const r = await seed(w, { fetch: probe.fn });
    expect(errorsOf(r.issues).map((i) => i.code)).toEqual(["ZH_OFFICIAL"]);
    expect(probe.urls).not.toContain("https://example.org/ut-sample/term");
    expect(probe.urls).not.toContain(TERM_URL);
  });

  it("P14 a term with no `official` may have no `official_url`, or a 樂詞網 one that is never fetched; one with an `official` and no address fails", async () => {
    const none = world(edited(BIO1, (s) => { const t = s.terms[0]!; if (t.new) { t.zh.official = null; t.zh.official_url = null; } }));
    const probe = counting();
    const r = await seed(none, { fetch: probe.fn });
    expect(errorsOf(r.issues)).toEqual([]);
    expect(probe.urls).not.toContain(TERM_URL);
    const withUrl = world(edited(BIO1, (s) => { const t = s.terms[0]!; if (t.new) t.zh.official = null; }));
    const probe2 = counting();
    expect(errorsOf((await seed(withUrl, { fetch: probe2.fn })).issues)).toEqual([]);
    expect(probe2.urls).not.toContain(TERM_URL);
    const missing = world(edited(BIO1, (s) => { const t = s.terms[0]!; if (t.new) t.zh.official_url = null; }));
    expect(errorsOf((await seed(missing)).issues).map((i) => i.code)).toContain("ZH_OFFICIAL");
  });

  it("P15 without --verify no page is read, one warning says so, the hashes in the archive index are null, and the seeds are written", async () => {
    const w = world();
    const probe = counting();
    const r = await seed(w, { verify: false, fetch: probe.fn });
    expect(probe.urls).toEqual([]);
    expect(fs.existsSync(path.join(w.root, "cache", "snapshots"))).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => [i.severity, i.code, i.path])).toEqual([["warning", "INPUT_MISSING", "(verify)"]]);
    for (const code of ["SEED_SOURCES", "QUOTE_VERBATIM", "NUMBER_SOURCED", "ARTEFACT_FORMAT", "PRIMARY_ONLY", "ZH_OFFICIAL"]) expect(r.issues[0]!.message).toContain(code);
    for (const entry of Object.values(readJson(w, "archive-index.json").urls) as any[]) expect([entry.sha256, entry.hashed_at]).toEqual([null, null]);
    expect(r.written).toEqual(FIVE);
  });

  it("P16 --verify uses the clock it is given for each snapshot's `fetched_at`", async () => {
    const w = world();
    await seed(w, { outDir: null, now: () => Date.parse("2026-11-22T02:30:15Z") });
    const snap = JSON.parse(fs.readFileSync(snapshotFile(w.root, PAPER_URL), "utf8"));
    expect(snap.fetched_at).toBe("2026-11-22T10:30:15+08:00");
    expect(snap.article_types).toEqual(["Article"]);
  });
});

// ── The checks the engine has no mode for ────────────────────────────────────────────────────────

describe("the checks the seeder runs itself", () => {
  it("C1 SUBFIELD_UNKNOWN is at seeds[<i>].subfield, i the file's place in the order that gives ids", async () => {
    const r = await seed(world(edited(BIO1, (s) => { s.subfield = "no-such-subfield"; })), { verify: false, outDir: null });
    const errs = errorsOf(r.issues);
    expect(errs.map((i) => [i.code, i.path])).toEqual([["SUBFIELD_UNKNOWN", "seeds[1].subfield"]]);
    expect(errs[0]!.message).toContain("no-such-subfield");
    expect(errs[0]!.message).toContain(BIO1);
    const first = await seed(world(edited(PHYS, (s) => { s.subfield = "no-such-subfield"; })), { verify: false, outDir: null });
    expect(errorsOf(first.issues).map((i) => i.path)).toEqual(["seeds[0].subfield"]);
  });

  it("C2 the index is the place in the order that gives ids, not the file's place in the folder listing", async () => {
    const w = world({ [PHYS]: seedPhys(), "2017-01-01-01.json": { ...seedBio1(), first_published: "2017-01-01", subfield: "no-such-subfield" }, [BIO2]: seedBio2() });
    const r = await seed(w, { verify: false, outDir: null });
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["SUBFIELD_UNKNOWN", "seeds[0].subfield"]]);
  });

  it("C3 ZH_RUNG_LABEL is on the Chinese of explainer.how_sure, which must start with the site's word for the English rung label", async () => {
    const wrong = edited(BIO1, (s) => { s.explainer.how_sure.zh = s.explainer.how_sure.zh.replace(/^已查核。/, "確認。"); });
    const r = await seed(world(wrong), { verify: false, outDir: null });
    const errs = errorsOf(r.issues);
    expect(errs.map((i) => [i.code, i.path])).toEqual([["ZH_RUNG_LABEL", "seeds[1].explainer.how_sure.zh"]]);
    expect(errs[0]!.message).toContain("已查核");
    expect(errs[0]!.message).toContain("Checked");
  });

  it("C4 an invisible character in a seed is turned back before any rule runs: SCHEMA at the file's path, and nothing else", async () => {
    const w = world(edited(PHYS, (s) => { s.title.en = `${ZWSP}${s.title.en}`; }));
    const r = await seed(w);
    expect(r.ok).toBe(false);
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["SCHEMA", `${PHYS}: title.en`]]);
    // The file is not loaded, so it has no id; no file is given one until every file loads.
    expect(r.seeds).toEqual([]);
    expect(r.written).toEqual([]);
  });

  it("C4b a file that does not load stops the run: ids and places `seeds[<i>]` follow the files that load, so nothing else is judged or written, and no check of another file can blame it", async () => {
    // BIO1 defines the term that BIO2 lists as existing, and both are in 2019: without BIO1, BIO2 would be the first of the year.
    const w = world(edited(BIO1, (s) => { s.who = []; }));
    const r = await seed(w);
    expect(r.ok).toBe(false);
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["SCHEMA", `${BIO1}: who`]]);
    expect(r.seeds).toEqual([]);
    expect(r.written).toEqual([]);
    expect(exists(w, "findings")).toBe(false);
    // The files fixed, the same folder is judged and written whole.
    const fixed = await seed(world());
    expect(fixed.ok).toBe(true);
    expect(fixed.seeds.map((x) => x.file)).toEqual([PHYS, BIO1, BIO2]);
  });

  it("C4d a seed with no rung entry does not load: a finding has at least one, and the message says so", async () => {
    const r = await seed(world(edited(PHYS, (s) => { s.rung_history = []; })));
    const errs = errorsOf(r.issues);
    expect(errs.map((i) => [i.code, i.path])).toEqual([["SCHEMA", `${PHYS}: rung_history`]]);
    expect(errs[0]!.message).toContain("at least one rung entry");
    expect(r.seeds).toEqual([]);
  });

  it("C4e a fault only the stored finding's schema finds is an issue at the seed's place, not a crash; anything that is not a schema error is rethrown", async () => {
    const parse = vi.spyOn(Finding, "parse");
    try {
      parse.mockImplementationOnce(() => { throw new ZodError([{ code: "custom", message: "no such date", path: ["first_published"], input: "x" }]); });
      const w = world();
      const r = await seed(w);
      expect(errorsOf(r.issues).map((i) => [i.code, i.path, i.message])).toEqual([["SCHEMA", "seeds[0].first_published", `${PHYS} does not make a finding: no such date`]]);
      expect(r.written).toEqual([]);
      expect(exists(w, "findings")).toBe(false);
      parse.mockImplementationOnce(() => { throw new Error("boom"); });
      await expect(seed(world())).rejects.toThrow("boom");
    } finally {
      parse.mockRestore();
    }
  });

  it("C4f a seed that an earlier check blamed is not built (its own error stops the run), while one with only a warning still is", async () => {
    const parse = vi.spyOn(Finding, "parse");
    try {
      const bad = await seed(world(edited(BIO1, (s) => { s.terms = [...s.terms, ...s.terms]; })), { verify: false, outDir: null });
      expect(errorsOf(bad.issues).map((i) => [i.code, i.path])).toEqual([["TERM_DEFINED", "seeds[1].terms[1]"]]);
      expect(parse.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(["phys-2018-0001", "bio-2019-0002"]);
      parse.mockClear();
      // Index 10 blames only itself: `seeds[1]` is not the start of `seeds[10]`.
      const many = sampleSeeds();
      for (let n = 2; n <= 11; n++) many[`2018-03-02-${String(n).padStart(2, "0")}.json`] = structuredClone(many[PHYS]!);
      many["2018-03-02-11.json"]!.title = { en: many[PHYS]!.title.en.replace("proposes", "revolutionary"), zh: many[PHYS]!.title.zh };
      const wide = await seed(world(many), { verify: false, outDir: null });
      expect(errorsOf(wide.issues).map((i) => [i.code, i.path])).toEqual([["HYPE_WORDS", "seeds[10].title"]]);
      expect(parse).toHaveBeenCalledTimes(12);
      parse.mockClear();
      const w = world();
      putCorrections(w, [forFinding(1, "bio-2019-0001", "sources.1.url")]);
      const warned = await seed(w, { outDir: null });
      expect(warned.issues.map((i) => [i.severity, i.path])).toEqual([["warning", "seeds[1]"]]);
      expect(parse.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(["phys-2018-0001", "bio-2019-0001", "bio-2019-0002"]);
    } finally {
      parse.mockRestore();
    }
  });

  it("C4c a stored file that cannot be read is reported with the seed files' own issues, and still nothing else is judged", async () => {
    const w = world(edited(BIO1, (s) => { s.who = []; }));
    fs.mkdirSync(w.content, { recursive: true });
    fs.writeFileSync(path.join(w.content, "corrections.json"), "not json");
    const r = await seed(w);
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["SCHEMA", `${BIO1}: who`], ["SCHEMA", "corrections.json"]]);
    expect(r.seeds).toEqual([]);
  });

  it("C5 the English rules judge each seed as the finding it will be, at seeds[<i>] paths: hype words, the word budget", async () => {
    const r = await seed(world(edited(BIO1, (s) => { s.explainer.found.en += " It is a revolutionary result."; })), { verify: false, outDir: null });
    const errs = errorsOf(r.issues);
    expect(errs.map((i) => i.code).sort()).toEqual(["HYPE_WORDS", "WORDS"]);
    expect(errs.find((i) => i.code === "HYPE_WORDS")!.path).toBe("seeds[1].explainer.found");
    expect(errs.every((i) => i.path.startsWith("seeds[1]"))).toBe(true);
  });

  it("C6 the rules of a brief or a run (the Lead, the day's counts, DUPLICATE) judge no single seed: the sample is clean though no brief exists", async () => {
    const r = await seed(world(), { verify: false, outDir: null });
    expect(errorsOf(r.issues)).toEqual([]);
    expect(codes(r.issues)).toEqual(["INPUT_MISSING"]);
  });

  it("C7 the Chinese rules run on the file's own Chinese: a length over the cap, a simplified character, at `seeds[<i>] (Chinese) <key>`", async () => {
    const long = await seed(world(edited(BIO1, (s) => { s.explainer.found.zh += "這是一段額外加上去的文字，用來讓字數超過上限。"; })), { verify: false, outDir: null });
    const e1 = errorsOf(long.issues);
    expect(e1.map((i) => i.code)).toEqual(["ZH_CHARS"]);
    expect(e1[0]!.path.startsWith("seeds[1] (Chinese) ")).toBe(true);
    const simplified = await seed(world(edited(BIO1, (s) => { s.explainer.found.zh = s.explainer.found.zh.replace("團隊", "团队"); })), { verify: false, outDir: null });
    const e2 = errorsOf(simplified.issues);
    expect(e2.map((i) => i.code)).toEqual(["ZH_TRADITIONAL"]);
    expect(e2[0]!.path).toContain("new.new-1.explainer.found");
  });

  it("C8 a seed whose source is a blocked host is BLOCKED_HOST in both runs, whatever else", async () => {
    const r = await seed(world(edited(BIO1, (s) => { s.sources[1]!.url = "https://pastebin.com/ut-sample"; s.artefacts.trial = []; })), { verify: false, outDir: null });
    expect(codes(errorsOf(r.issues))).toContain("BLOCKED_HOST");
  });

  it("C9 a fixed translation that applies to one string only is checked: ZH_TERMS at that string, and met once the Chinese holds it", async () => {
    const withTerm = (zh: string) => (s: SeedFinding) => {
      s.explainer.could_lead.en += " It builds on deep learning.";
      s.explainer.could_lead.zh += zh;
    };
    const r = await seed(world(edited(BIO1, withTerm("它建立在別的方法上。"))), { verify: false, outDir: null });
    const terms = errorsOf(r.issues).filter((i) => i.code === "ZH_TERMS");
    expect(terms.map((i) => i.path)).toEqual(['seeds[1] (Chinese) strings["new.new-1.explainer.could_lead"]']);
    expect(terms[0]!.message).toContain("深度學習");
    const met = await seed(world(edited(BIO1, withTerm("它建立在深度學習上。"))), { verify: false, outDir: null });
    expect(errorsOf(met.issues).filter((i) => i.code === "ZH_TERMS")).toEqual([]);
  });

  it("C10 the Chinese length caps are 1.8 characters a word: 72 for a 40-word part, a note, an alt text or a term's definition (45 for a 25-word note)", async () => {
    const figure = (s: SeedFinding): void => {
      s.figure = {
        source_id: "s1", image_url: "https://www.cell.com/ut-sample/ledger-figure-1.png", licence: "CC-BY-4.0", licence_quote: "Sample licence line",
        credit: "Figure 1 from the SAMPLE paper", alt: { en: "A sample figure.", zh: "一張範例圖。" },
      };
    };
    const tooLong = async (change: (s: SeedFinding, zh: string) => void, n: number): Promise<string[]> => {
      const r = await seed(world(edited(BIO1, (s) => { figure(s); change(s, "測".repeat(n)); })), { verify: false, outDir: null });
      return errorsOf(r.issues).filter((i) => i.code === "ZH_CHARS").map((i) => i.path);
    };
    const cases: [string, number, (s: SeedFinding, zh: string) => void, string][] = [
      ["background", 72, (s, zh) => { s.explainer.background.zh = zh; }, 'seeds[1] (Chinese) strings["new.new-1.explainer.background"]'],
      ["could_lead", 72, (s, zh) => { s.explainer.could_lead.zh = zh; }, 'seeds[1] (Chinese) strings["new.new-1.explainer.could_lead"]'],
      ["a rung note", 45, (s, zh) => { s.rung_history[0]!.note = { en: "A short note.", zh }; }, 'seeds[1] (Chinese) strings["new.new-1.rung.0"]'],
      ["the figure alt", 72, (s, zh) => { s.figure!.alt.zh = zh; }, 'seeds[1] (Chinese) strings["new.new-1.figure.alt"]'],
      ["a term definition", 72, (s, zh) => { s.terms[0] = { ...TERM, zh: { ...TERM.zh, definition: zh } }; }, 'seeds[1] (Chinese) terms["antimicrobial-resistance"].definition'],
    ];
    for (const [name, cap, change, path] of cases) {
      expect(await tooLong(change, cap), `${name} at ${cap}`).toEqual([]);
      expect(await tooLong(change, cap + 1), `${name} at ${cap + 1}`).toEqual([path]);
    }
  });
});

describe("terms and related findings", () => {
  it("T1 a term that two files define differently is one SCHEMA error at the later file's term", async () => {
    const w = world(edited(BIO2, (s) => { s.terms = [{ ...clone(TERM), definition: "A different definition." }]; }));
    const r = await seed(w, { verify: false, outDir: null });
    const errs = errorsOf(r.issues).filter((i) => i.code === "SCHEMA");
    expect(errs.map((i) => i.path)).toEqual(["seeds[2].terms[0]"]);
    expect(errs[0]!.message).toContain(BIO1);
  });

  it("T2 a term that two files define alike is one glossary term, first_finding the first by first_published then file name", async () => {
    const w = world(edited(BIO2, (s) => { s.terms = [clone(TERM)]; s.explainer.matters = { ...s.explainer.matters }; }));
    const r = await seed(w, { verify: false });
    expect(errorsOf(r.issues).filter((i) => i.code === "SCHEMA")).toEqual([]);
    const terms = readJson(w, "glossary.json").terms;
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ first_finding: "bio-2019-0001", first_date: "2026-11-20", fields: ["biology"] });
  });

  it("T3 `fields` lists each field of the findings that list the term, in the order of the field list", async () => {
    const phys = seedPhys();
    phys.explainer.matters = { en: `${phys.explainer.matters.en} Antimicrobial resistance is another matter.`, zh: `${phys.explainer.matters.zh}抗微生物抗藥性（antimicrobial resistance）則是另一回事。` };
    phys.terms = [{ new: false, id: "antimicrobial-resistance" }];
    const w = world({ [PHYS]: phys, [BIO1]: seedBio1(), [BIO2]: seedBio2() });
    await seed(w, { verify: false });
    const t = readJson(w, "glossary.json").terms[0];
    expect(t.fields).toEqual(["physics", "biology"]);
    // The physics file is the first by first_published that lists the term.
    expect(t.first_finding).toBe("phys-2018-0001");
    expect(t.first_date).toBe("2026-11-18");
  });

  it("T4 a term listed as existing that no seed defines and the glossary lacks is a SCHEMA error at its id", async () => {
    const w = world(edited(BIO2, (s) => { s.terms = [{ new: false, id: "no-such-term" }]; }));
    const r = await seed(w, { verify: false, outDir: null });
    const errs = errorsOf(r.issues).filter((i) => i.code === "SCHEMA");
    expect(errs.map((i) => i.path)).toEqual(["seeds[2].terms[0].id"]);
    expect(errs[0]!.message).toContain("no-such-term");
  });

  it("T5 `related` may name another seed's id; its own id and an id no seed has are SCHEMA errors at their place", async () => {
    const good = await seed(world(edited(BIO2, (s) => { s.related = ["phys-2018-0001", "bio-2019-0001"]; })), { verify: false, outDir: null });
    expect(errorsOf(good.issues)).toEqual([]);
    const w = world(edited(BIO1, (s) => { s.related = ["bio-2019-0001", "bio-2019-0009", "phys-2018-0001"]; }));
    const r = await seed(w, { verify: false, outDir: null });
    const errs = errorsOf(r.issues).filter((i) => i.code === "SCHEMA" && i.path.includes(".related["));
    expect(errs.map((i) => i.path)).toEqual(["seeds[1].related[0]", "seeds[1].related[1]"]);
    expect(errs[0]!.message).toContain("its own id");
    expect(errs[1]!.message).toContain("bio-2019-0009");
    // The stored schema's own "never related to itself" is the same fault, and is not reported a second time.
    expect(errorsOf(r.issues).filter((i) => i.path === "seeds[1].related")).toEqual([]);
  });

  it("T5b an issue of the English run names the seed in its message too, never the draft it was judged as", async () => {
    const r = await seed(world(edited(BIO1, (s) => { s.terms = [...s.terms, ...s.terms]; })), { verify: false, outDir: null });
    const dup = errorsOf(r.issues).find((i) => i.code === "TERM_DEFINED")!;
    expect(dup.path).toBe("seeds[1].terms[1]");
    expect(dup.message.startsWith("seeds[1].terms[1] defines the term")).toBe(true);
    expect(r.issues.some((i) => `${i.message} ${i.hint ?? ""}`.includes("new_findings"))).toBe(false);
    const ids = await seed(world(edited(BIO1, (s) => { s.sources = [...s.sources, ...s.sources]; })), { verify: false, outDir: null });
    const wrong = errorsOf(ids.issues).find((i) => i.code === "SOURCE_IDS")!;
    expect(wrong.message.startsWith("seeds[1].sources[2].id is")).toBe(true);
    expect(ids.issues.some((i) => `${i.message} ${i.hint ?? ""}`.includes("new_findings"))).toBe(false);
  });

  /** A second new term for the first biology seed, with a use in `background` that carries its English in brackets (SPEC §4.11). */
  const efflux = (definitionEn: string, definitionZh: string) => (s: SeedFinding): void => {
    s.terms.push({ new: true, term: "efflux pump", definition: definitionEn, zh: { term: "外排幫浦", definition: definitionZh, official: null, official_url: null } });
    s.explainer.background = {
      en: "An efflux pump is one way germs resist medicines, so computers help to rank molecules before anyone makes one.",
      zh: "外排幫浦（efflux pump）是細菌抗藥的方式之一，所以電腦能在有人製作之前先替分子排名。",
    };
  };

  it("T6 a term a seed defines twice is one TERM_DEFINED error at the second, and the terms listed after it are still judged in Chinese", async () => {
    const w = world(edited(BIO1, (s) => {
      s.terms.push(clone(TERM));
      efflux("A part of a germ that pushes medicines back out.", "细菌身上把藥物推出去的構造。")(s);
    }));
    const r = await seed(w, { verify: false, outDir: null });
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([
      ["TERM_DEFINED", "seeds[1].terms[1]"],
      ["ZH_TRADITIONAL", 'seeds[1] (Chinese) terms["efflux-pump"].definition'],
    ]);
  });

  it("T7 a fixed translation is asked of a new term's definition as well: ZH_TERMS at the term, and met once its Chinese holds it", async () => {
    const english = "A part of a germ that pushes medicines back out, which deep learning tools often miss.";
    const short = await seed(world(edited(BIO1, efflux(english, "細菌身上把藥物推出去的構造。"))), { verify: false, outDir: null });
    const terms = errorsOf(short.issues).filter((i) => i.code === "ZH_TERMS");
    expect(terms.map((i) => i.path)).toEqual(['seeds[1] (Chinese) terms["efflux-pump"]']);
    expect(terms[0]!.message).toContain("深度學習");
    const met = await seed(world(edited(BIO1, efflux(english, "細菌身上把藥物推出去的構造，深度學習工具常常看不出來。"))), { verify: false, outDir: null });
    expect(errorsOf(met.issues)).toEqual([]);
  });

  it("T8 a term the stored glossary holds, listed before a term the seeds define, leaves both in the glossary: the stored one as it was, the new one with its first finding and fields", async () => {
    const first = world();
    await seed(first);
    const stored = readText(first, "glossary.json");
    const w = world(edited(BIO1, (s) => {
      s.terms = [{ new: false, id: "antimicrobial-resistance" }];
      efflux("A part of a germ that pushes medicines back out.", "細菌身上把藥物推出去的構造。")(s);
    }));
    fs.mkdirSync(w.content, { recursive: true });
    fs.writeFileSync(path.join(w.content, "glossary.json"), stored);
    const r = await seed(w);
    expect(errorsOf(r.issues)).toEqual([]);
    const terms = readJson(w, "glossary.json").terms;
    expect(terms.map((t: any) => t.id)).toEqual(["antimicrobial-resistance", "efflux-pump"]);
    expect(terms[0]).toEqual(JSON.parse(stored).terms[0]);
    expect(terms[1]).toMatchObject({ first_finding: "bio-2019-0001", first_date: "2026-11-20", fields: ["biology"] });
  });

  it("T9 a term listed as existing is a term of the Chinese run too: its first Chinese use carries the English, as a new term's does", async () => {
    const w = world(edited(BIO2, (s) => { s.explainer.matters.zh = s.explainer.matters.zh.replace("（antimicrobial resistance）", ""); }));
    const r = await seed(w, { outDir: null });
    expect(errorsOf(r.issues).map((i) => [i.code, i.path])).toEqual([["ZH_ENGLISH_ONCE", 'seeds[2] (Chinese) strings["new.new-1.explainer.matters"]']]);
  });

  it("T9b a known term listed after a new one is still a term of the Chinese run, and listed twice it is one", async () => {
    const afterNew = (twice: boolean) => (s: SeedFinding): void => {
      s.explainer.matters.zh = s.explainer.matters.zh.replace("（antimicrobial resistance）", "");
      const known = s.terms;
      s.terms = [];
      efflux("A part of a germ that pushes medicines back out.", "細菌身上把藥物推出去的構造。")(s);
      s.terms.push(...known, ...(twice ? known : []));
    };
    for (const twice of [false, true]) {
      const r = await seed(world(edited(BIO2, afterNew(twice))), { verify: false, outDir: null });
      expect(errorsOf(r.issues).map((i) => [i.code, i.path]), `twice ${twice}`).toEqual([["ZH_ENGLISH_ONCE", 'seeds[2] (Chinese) strings["new.new-1.explainer.matters"]']]);
    }
  });

  it("T10 a term the glossary holds with no Chinese cannot be listed as existing: a SCHEMA error at its id, and no crash", async () => {
    const first = world();
    await seed(first);
    const stored = readJson(first, "glossary.json");
    stored.terms[0].zh = null;
    const w = world(edited(BIO1, (s) => { s.terms = [{ new: false, id: "antimicrobial-resistance" }]; }));
    fs.mkdirSync(w.content, { recursive: true });
    fs.writeFileSync(path.join(w.content, "glossary.json"), `${JSON.stringify(stored, null, 2)}\n`);
    const r = await seed(w, { outDir: null });
    const schema = errorsOf(r.issues).filter((i) => i.code === "SCHEMA");
    expect(schema.map((i) => i.path)).toEqual(["seeds[1].terms[0].id", "seeds[2].terms[0].id"]);
    expect(schema[0]!.message).toContain("holds it with no Chinese yet");
    expect(r.written).toEqual([]);
    // The same glossary, with the term defined by the seeds, is replaced and valid.
    const fixed = world();
    fs.mkdirSync(fixed.content, { recursive: true });
    fs.writeFileSync(path.join(fixed.content, "glossary.json"), `${JSON.stringify(stored, null, 2)}\n`);
    expect(errorsOf((await seed(fixed)).issues)).toEqual([]);
    expect(readJson(fixed, "glossary.json").terms[0].zh).not.toBeNull();
  });
});

describe("a term that has no valid id", () => {
  it("N4 newTermId() is termIdOf() when that is a valid term id (a pattern and at most 60 characters), else null", () => {
    expect(newTermId("Q-learning")).toBe("q-learning");
    expect(newTermId("Schrödinger equation")).toBe("schrodinger-equation");
    expect(newTermId("光")).toBeNull();
    expect(newTermId("")).toBeNull();
    // The ligature ffi is three letters: 20 of them make exactly 60 characters, 21 make 63.
    expect(newTermId("\ufb03".repeat(20))).toBe("ffi".repeat(20));
    expect(newTermId("\ufb03".repeat(21))).toBeNull();
  });

  const none = (term: string) => ({ new: true as const, term, definition: "Light, as a physicist means it.", zh: { term: "光", definition: "物理學家所指的光。", official: null, official_url: null } });

  it("N5 a term with no letter a to z or digit is TERM_DEFINED, never a crash: the run goes on, writes nothing and adds no glossary entry or Chinese key for it", async () => {
    const w = world(edited(BIO1, (s) => { s.terms.push(none("光")); }));
    const r = await seed(w);
    expect(r.ok).toBe(false);
    expect(new Set(codes(errorsOf(r.issues)))).toEqual(new Set(["TERM_DEFINED"]));
    expect(errorsOf(r.issues).map((i) => i.path)).toEqual(["seeds[1].terms[1]", "seeds[1].terms[1]"]);
    expect(errorsOf(r.issues)[0]!.message).toContain("empty id");
    expect(r.written).toEqual([]);
  });

  it("N6 a term whose id passes 60 characters is TERM_DEFINED too, and the others of its file are still judged", async () => {
    const w = world(edited(BIO1, (s) => { s.terms.push(none("\ufb03".repeat(21))); s.explainer.found.en = s.explainer.found.en.replace("a new antibiotic", "a revolutionary antibiotic"); }));
    const r = await seed(w);
    expect(new Set(codes(errorsOf(r.issues)))).toEqual(new Set(["TERM_DEFINED", "HYPE_WORDS"]));
    expect(r.written).toEqual([]);
  });

  it("N7 findingOf() and chineseOf() leave such a term out instead of failing on it", () => {
    const seed = seedBio1();
    seed.terms.push(none("光"));
    const [item] = identifySeeds([loaded(BIO1, seed)]);
    expect(findingOf(item!, config).terms).toEqual(["antimicrobial-resistance"]);
    const { context, draft } = chineseOf(seed, config, "2026-11-20", new Map());
    expect(context.terms.map((t) => t.id)).toEqual(["antimicrobial-resistance"]);
    expect(Object.keys(draft.terms)).toEqual(["antimicrobial-resistance"]);
  });
});

// ── The finding, disclosure and the frame ────────────────────────────────────────────────────────

describe("findingOf, disclosureOf and frameDate", () => {
  it("D1 findingOf makes the stored finding of an identified seed and parses as Finding", () => {
    const [item] = identifySeeds([loaded(BIO1, seedBio1())]);
    const f = findingOf(item!, config);
    expect(Finding.safeParse(f).success).toBe(true);
    expect(f).toMatchObject({ id: "bio-2019-0001", history: true, first_brief: null, depth: "item", disclosure: false });
    expect(f.terms).toEqual(["antimicrobial-resistance"]);
  });

  it("D2 findingOf takes the rung from the last rung entry and gives every entry `recorded` the seed's date", () => {
    const seed = seedBio1();
    seed.rung_history = [
      { rung: "preprint", date: "2018-09-01", source_id: "s1", by: "seed", note: null },
      { rung: "checked", date: "2019-05-01", source_id: "s1", by: "seed", note: null },
    ];
    const f = findingOf(identifySeeds([loaded(BIO1, seed)])[0]!, config);
    expect(f.rung).toBe("checked");
    expect(f.rung_history.map((r) => [r.rung, r.recorded])).toEqual([["preprint", "2026-11-20"], ["checked", "2026-11-20"]]);
  });

  const finding = (over: object) => ({ sources: [{ url: "https://example.org/ut-sample", title: "A page" }], ...over }) as unknown as Parameters<typeof disclosureOf>[0];

  it("D3 disclosure is true when Anthropic or Claude is a whole word in any English string, a source's title or URL or an AI system's maker", () => {
    expect(disclosureOf(finding({ title: { en: "A study of Claude", zh: "x" } }), config)).toBe(true);
    expect(disclosureOf(finding({ ai: { systems: [{ name: "Sample Network", maker: "Anthropic" }] } }), config)).toBe(true);
    expect(disclosureOf(finding({ sources: [{ url: "https://example.org/ut-sample", title: "Notes from Anthropic researchers" }] }), config)).toBe(true);
    expect(disclosureOf(finding({ sources: [{ url: "https://example.org/claude-notes", title: "A page" }] }), config)).toBe(true);
  });

  it("D4 only the English half of an L10n counts, whole words only, and a named person or phrase is masked", () => {
    expect(disclosureOf(finding({ title: { en: "A study", zh: "Claude 的研究" } }), config)).toBe(false);
    expect(disclosureOf(finding({ title: { en: "Claudette and Anthropic", zh: "x" } }), config)).toBe(true);
    expect(disclosureOf(finding({ title: { en: "Claudette wrote it", zh: "x" } }), config)).toBe(false);
    expect(disclosureOf(finding({ title: { en: "Anthropically speaking", zh: "x" } }), config)).toBe(false);
    expect(disclosureOf(finding({ title: { en: "The theory of Claude Shannon", zh: "x" } }), config)).toBe(false);
    expect(disclosureOf(finding({}), config)).toBe(false);
  });

  it("D5 a cited source on a host of labs.json's `anthropic` entry sets it", () => {
    const hosts = config.labs.labs.find((l) => l.id === "anthropic")!.hosts;
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) expect(disclosureOf(finding({ sources: [{ url: `https://${host}/research/ut-sample`, title: "A page" }] }), config), host).toBe(true);
    expect(disclosureOf(finding({ sources: [{ url: "https://notanthropic.example/ut-sample", title: "A page" }] }), config)).toBe(false);
  });

  it("D5b the host test reads the `anthropic` entry and no other, whatever the hosts are called (every host in the seed config also holds the word)", () => {
    const labs = {
      schema_version: 1 as const,
      labs: [{ id: "other-lab", name: "Other", hosts: ["other.example"], paths: [] }, { id: "anthropic", name: "Anthropic", hosts: ["lab.example"], paths: [] }],
    };
    const on = (host: string) => disclosureOf(finding({ sources: [{ url: `https://${host}/ut-sample`, title: "A page" }] }), { labs });
    expect(on("lab.example")).toBe(true);
    expect(on("other.example")).toBe(false);
    expect(on("elsewhere.example")).toBe(false);
  });

  it("D6 a seed that names Anthropic is written with `disclosure: true`", async () => {
    const w = world(edited(PHYS, (s) => { s.ai.systems = [{ name: "Sample Network", maker: "Anthropic" }]; for (const part of [s.explainer.ai_helped!, s.explainer.how_sure]) { part.en = part.en.replace("Sample Lab", "Anthropic"); part.zh = part.zh.replace("Sample Lab", "Anthropic"); } }));
    const r = await seed(w, { verify: false });
    expect(errorsOf(r.issues)).toEqual([]);
    expect(readJson(w, "findings/phys-2018-0001.json").disclosure).toBe(true);
    expect(readJson(w, "findings/bio-2019-0001.json").disclosure).toBe(false);
  });

  it("D7 frameDate moves a Sunday or a Monday to the Tuesday after it and leaves Tuesday to Saturday as they are", () => {
    // 2026-11-22 is a Sunday.
    expect(frameDate("2026-11-22")).toBe("2026-11-24");
    expect(frameDate("2026-11-23")).toBe("2026-11-24");
    for (const d of ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"]) expect(frameDate(d)).toBe(d);
    expect(frameDate("2026-12-27")).toBe("2026-12-29");
    expect(frameDate("2026-12-31")).toBe("2026-12-31");
  });

  it("D8 chineseOf() lists a fixed translation only where it applies, with the keys of the strings it applies to", () => {
    const keysOf = (seed: SeedFinding) => chineseOf(seed, config, "2026-11-24", new Map()).context.fixed;
    expect(keysOf(seedBio1())).toEqual([
      { en: "model", zh: "模型", keys: ["new.new-1.title", "new.new-1.explainer.found", "new.new-1.explainer.how_sure"] },
      { en: "peer review", zh: "同儕審查", keys: ["new.new-1.explainer.how_sure"] },
    ]);
    expect(keysOf(seedBio2())).toEqual([
      { en: "preprint", zh: "預印本", keys: ["new.new-1.explainer.how_sure"] },
      { en: "journal", zh: "期刊", keys: ["new.new-1.explainer.how_sure"] },
      { en: "protein", zh: "蛋白質", keys: ["new.new-1.title", "new.new-1.explainer.found", "new.new-1.explainer.matters", "new.new-1.explainer.background"] },
    ]);
  });
});

// ── The command ──────────────────────────────────────────────────────────────────────────────────

describe("main", () => {
  async function cli(argv: string[], w: World, over: Partial<Io> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(argv, { out: (x) => out.push(x), err: (x) => err.push(x), root: w.root, now: NOW, ...over });
    return { code, out, err };
  }

  it("M1 --in is required, and every flag is strict: an unknown flag, a value that is missing, a flag given twice and a stray argument are exit 2 with the usage", async () => {
    const w = world();
    const cases: [string[], string][] = [
      [[], "--in DIR is required."],
      [["--in"], "--in"],
      [["--in", ""], "--in needs a value."],
      [["--in", "seed/ledger", "--in", "seed/ledger"], "--in is given twice."],
      [["--in", "seed/ledger", "--out", ""], "--out needs a value."],
      [["--in", "seed/ledger", "--verify", "--verify"], "--verify is given twice."],
      [["--in", "seed/ledger", "--json", "--json"], "--json is given twice."],
      [["--in", "seed/ledger", "--bogus"], "--bogus"],
      [["--in", "seed/ledger", "extra"], "Unexpected argument \"extra\"."],
      [["extra", "--in", "seed/ledger", "--in", "seed/ledger"], "--in is given twice."],
      [["--in=seed/ledger", "--verify=yes"], "verify"],
    ];
    for (const [argv, message] of cases) {
      const r = await cli(argv, w);
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.out, argv.join(" ")).toEqual([]);
      expect(r.err.join("\n"), argv.join(" ")).toContain(message);
      expect(r.err.join("\n"), argv.join(" ")).toContain(USAGE);
    }
    expect(USAGE).toBe("Usage: npm run ledger:seed -- --in DIR [--verify] [--out DIR] [--json]");
    expect(fs.existsSync(w.content)).toBe(false);
  });

  it("M2 a seed folder that cannot be read is exit 2 with the message alone, and a root with no config is exit 2", async () => {
    const w = world(null);
    const r = await cli(["--in", "no-such-folder"], w);
    expect(r).toEqual({ code: 2, out: [], err: [`Cannot read the seed folder ${path.join(w.root, "no-such-folder")}.`] });
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "ut-ledger-bare-"));
    roots.push(bare);
    const noConfig = await cli(["--in", "seed/ledger"], { root: bare, seeds: "", content: "" });
    expect(noConfig.code).toBe(2);
    expect(noConfig.out).toEqual([]);
    expect(noConfig.err.length).toBeGreaterThan(0);
  });

  it("M3 valid files with --out are exit 0 and say how many seeds and files; a rerun says it wrote none", async () => {
    const w = world();
    const first = await cli(["--in", "seed/ledger", "--verify", "--out", "content"], w);
    expect(first).toEqual({ code: 0, out: ["3 seeds valid; wrote 5 files."], err: first.err });
    const again = await cli(["--in", "seed/ledger", "--verify", "--out", "content"], w);
    expect(again.code).toBe(0);
    expect(again.out).toEqual(["3 seeds valid; wrote 0 files."]);
    expect(filesIn(w)).toEqual([...FIVE].sort());
  });

  it("M4 without --out nothing is written and the line says only that the seeds are valid; one seed and one file read singular", async () => {
    const w = world();
    const r = await cli(["--in", "seed/ledger", "--verify"], w);
    expect(r).toEqual({ code: 0, out: ["3 seeds valid."], err: r.err });
    expect(fs.existsSync(w.content)).toBe(false);
    const one = world({ [PHYS]: seedPhys() });
    const r1 = await cli(["--in", "seed/ledger", "--verify", "--out", "content"], one);
    expect(r1.out).toEqual(["1 seed valid; wrote 3 files."]);
    const empty = world({});
    const r0 = await cli(["--in", "seed/ledger", "--out", "content"], empty);
    expect(r0.out.at(-1)).toBe("0 seeds valid; wrote 2 files.");
  });

  it("M5 without --verify the warning is printed first, and the run still exits 0", async () => {
    const w = world();
    const r = await cli(["--in", "seed/ledger"], w);
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(2);
    expect(r.out[0]).toMatch(/^warning INPUT_MISSING \(verify\): Without --verify no page is read/);
    expect(r.out[0]).toContain("(Run it with --verify on Kobol");
    expect(r.out[1]).toBe("3 seeds valid.");
  });

  it("M6 an invalid seed is exit 1: each issue as `ERROR CODE path: message (hint)`, then the count, and nothing is written", async () => {
    const w = world(edited(BIO1, (s) => { s.subfield = "no-such-subfield"; }));
    const r = await cli(["--in", "seed/ledger", "--out", "content"], w);
    expect(r.code).toBe(1);
    expect(r.out.some((line) => line.startsWith("ERROR SUBFIELD_UNKNOWN seeds[1].subfield: "))).toBe(true);
    expect(r.out.at(-1)).toBe("1 error: nothing was written.");
    expect(fs.existsSync(w.content)).toBe(false);
    const two = world(edited(BIO1, (s) => { s.subfield = "no-such-subfield"; s.explainer.how_sure.zh = s.explainer.how_sure.zh.replace(/^已查核。/, "確認。"); }));
    const r2 = await cli(["--in", "seed/ledger"], two);
    expect(r2.code).toBe(1);
    expect(r2.out.at(-1)).toBe("2 errors: nothing was written.");
  });

  it("M7 the snapshot log goes to standard error, never to standard output", async () => {
    const w = world(edited(BIO1, (s) => { s.sources[0]!.url = MISSING_URL; }));
    const r = await cli(["--in", "seed/ledger", "--verify"], w);
    expect(r.code).toBe(1);
    expect(r.err.some((line) => line.includes(`snapshot: ${MISSING_URL} not read (http_404, HTTP 404).`))).toBe(true);
    expect(r.out.some((line) => line.startsWith("snapshot:"))).toBe(false);
  });

  it("M8 --json prints one JSON document: ok, seeds, written, errors and warnings", async () => {
    const w = world();
    const r = await cli(["--in", "seed/ledger", "--verify", "--out", "content", "--json"], w);
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(1);
    expect(r.out[0]).toBe(JSON.stringify(JSON.parse(r.out[0]!), null, 2));
    expect(JSON.parse(r.out[0]!)).toEqual({
      ok: true, seeds: [{ id: "phys-2018-0001", file: PHYS }, { id: "bio-2019-0001", file: BIO1 }, { id: "bio-2019-0002", file: BIO2 }], written: FIVE, errors: [], warnings: [],
    });
    const bad = world(edited(BIO1, (s) => { s.subfield = "no-such-subfield"; }));
    const r2 = await cli(["--in", "seed/ledger", "--json"], bad);
    expect(r2.code).toBe(1);
    const doc = JSON.parse(r2.out[0]!);
    expect(doc.ok).toBe(false);
    expect(doc.written).toEqual([]);
    expect(doc.errors.map((e: ValidationIssue) => e.code)).toEqual(["SUBFIELD_UNKNOWN"]);
    expect(doc.warnings.map((e: ValidationIssue) => e.code)).toEqual(["INPUT_MISSING"]);
  });

  it("M9 `--in` and `--out` are read from the root of the run, and `--out` may be any folder", async () => {
    const w = world();
    const r = await cli(["--in", "seed/ledger", "--verify", "--out", "elsewhere/tree"], w);
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(w.root, "elsewhere", "tree", "findings", "bio-2019-0001.json"))).toBe(true);
    expect(fs.existsSync(w.content)).toBe(false);
  });

  it("M10 a failure to write standard output is told to standard error, except a reader that has gone away", () => {
    expect(writeFailure(Object.assign(new Error("x"), { code: "EPIPE" }))).toBeNull();
    expect(writeFailure(Object.assign(new Error("x"), { code: "ENOSPC" }))).toBe("Cannot write the output (ENOSPC).");
    expect(writeFailure(new Error("x"))).toBe("Cannot write the output (an error).");
  });

  it("M10b watchWriteErrors() fails the run on every write error but a reader that has gone away, and tells it once", () => {
    const out = new EventEmitter();
    const err = new EventEmitter();
    const fails: number[] = [];
    const told: string[] = [];
    watchWriteErrors([out, err], () => fails.push(1), (text) => told.push(text));
    out.emit("error", Object.assign(new Error("x"), { code: "EPIPE" }));
    err.emit("error", Object.assign(new Error("x"), { code: "EPIPE" }));
    expect([fails.length, told]).toEqual([0, []]);
    out.emit("error", Object.assign(new Error("x"), { code: "ENOSPC" }));
    expect([fails.length, told]).toEqual([1, ["Cannot write the output (ENOSPC)."]]);
    err.emit("error", new Error("y"));
    out.emit("error", Object.assign(new Error("x"), { code: "EPIPE" }));
    expect([fails.length, told]).toEqual([2, ["Cannot write the output (ENOSPC)."]]);
  });

  it("M10c exitWith() sets the exit code to the larger of the verdict and one already set", () => {
    const saved = process.exitCode;
    try {
      for (const [before, code, after] of [[undefined, 0, 0], [undefined, 1, 1], [undefined, 2, 2], [0, 1, 1], [1, 0, 1], [2, 0, 2], [2, 1, 2], [1, 2, 2]] as const) {
        process.exitCode = before;
        exitWith(code);
        expect(process.exitCode, `${before} then ${code}`).toBe(after);
      }
    } finally {
      process.exitCode = saved;
    }
  });
});

describe("the script run as a process", () => {
  const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const SCRIPT = path.join(ROOT, "scripts", "ledger-seed.ts");
  const spawn = (args: string[], cwd: string) => {
    const r = spawnSync(process.execPath, [TSX, SCRIPT, ...args], { cwd, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_FIXTURE_FEEDS: FEEDS_DIR } });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };

  it("B1 `--in seed/ledger --verify --out content` run from a root exits 0 and writes the Ledger", () => {
    const w = world();
    const r = spawn(["--in", "seed/ledger", "--verify", "--out", "content"], w.root);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/3 seeds valid; wrote 5 files\.\n$/);
    expect(filesIn(w)).toEqual([...FIVE].sort());
  });

  it("B2 a usage error exits 2 with the usage on standard error and nothing on standard output; an invalid seed exits 1", () => {
    const w = world(edited(BIO1, (s) => { s.subfield = "no-such-subfield"; }));
    const usage = spawn([], w.root);
    expect(usage.code).toBe(2);
    expect(usage.out).toBe("");
    expect(usage.err).toContain("--in DIR is required.");
    expect(usage.err).toContain(USAGE);
    const bad = spawn(["--in", "seed/ledger"], w.root);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("ERROR SUBFIELD_UNKNOWN");
  });

  it("B3 importing the module runs nothing: only the script that was started runs its command", () => {
    const w = world();
    const probe = path.join(w.root, "probe.mts");
    fs.writeFileSync(probe, `import ${JSON.stringify(SCRIPT)};\nconsole.log("imported");\n`);
    const r = spawnSync(process.execPath, [TSX, probe], { cwd: w.root, encoding: "utf8", timeout: 120_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("imported\n");
    expect(r.stderr).toBe("");
  });

  it("B4 a start name that matches no file is no start of the script: the module imported under it runs nothing", () => {
    const w = world();
    const probe = path.join(w.root, "probe.mts");
    fs.writeFileSync(probe, `process.argv[1] = "no-such-script-name";\nawait import(${JSON.stringify(SCRIPT)});\nconsole.log("imported");\n`);
    const r = spawnSync(process.execPath, [TSX, probe], { cwd: w.root, encoding: "utf8", timeout: 120_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("imported\n");
    expect(r.stderr).toBe("");
  });

  it("B5 with no start name at all (argv has no script) the module imported runs nothing", () => {
    const w = world();
    const probe = path.join(w.root, "probe.mts");
    fs.writeFileSync(probe, `process.argv.length = 1;\nawait import(${JSON.stringify(SCRIPT)});\nconsole.log("imported");\n`);
    const r = spawnSync(process.execPath, [TSX, probe], { cwd: w.root, encoding: "utf8", timeout: 120_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("imported\n");
    expect(r.stderr).toBe("");
  });

  const hasFullDevice = fs.existsSync("/dev/full");
  /** The seeds valid, with standard output on `/dev/full` (a device whose every write fails with ENOSPC). */
  const onFullDevice = (cwd: string) => {
    const fd = fs.openSync("/dev/full", "w");
    try {
      const r = spawnSync(process.execPath, [TSX, SCRIPT, "--in", "seed/ledger"], { cwd, encoding: "utf8", timeout: 120_000, stdio: ["ignore", fd, "pipe"], env: { ...process.env, UT_FIXTURE_FEEDS: FEEDS_DIR } });
      return { code: r.status, err: r.stderr };
    } finally {
      fs.closeSync(fd);
    }
  };

  it.skipIf(!hasFullDevice)("B6 a report that cannot be written is exit 2 and one line on standard error, never 0", () => {
    expect(onFullDevice(world().root)).toEqual({ code: 2, err: "Cannot write the output (ENOSPC).\n" });
  });

  it("B7 a reader that has gone away does not change the exit code, and prints nothing", () => {
    const w = world();
    const r = spawnSync("bash", ["-c", 'set -o pipefail; "$@" | true', "bash", process.execPath, TSX, SCRIPT, "--in", "seed/ledger"], { cwd: w.root, encoding: "utf8", timeout: 120_000, env: { ...process.env, UT_FIXTURE_FEEDS: FEEDS_DIR } });
    expect([r.status, r.stderr]).toEqual([0, ""]);
  });
});

function clone<T>(x: T): T {
  return structuredClone(x);
}
