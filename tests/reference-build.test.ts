// scripts/lib/reference.ts (SPEC Appendix D, §10 P2 steps 2 and 6): the library behind `backfill.ts --save-reference`, which builds
// `fixtures/reference/pace-reference.json` and the 136 saved answers of `fixtures/openalex/` from the cache of a finished backfill. Here the cache is
// synthetic: the 34 weeks the edition of Thursday 2026-10-22 reads besides the baseline (13 weeks a year ago, 13 in the window, 8 provisional) are
// fetched from the hand-made world of tests/helpers/openalex-world.ts through the real client, and the edition's metrics files are made from the
// world's weekly state with `runMetrics({ frozen })`, as the backfill makes them. Every figure is checked against sums worked here from the world's
// counts, and against lib/schema/reference.ts (which the builder's own output must satisfy). `tests/reference.test.ts`, which reproduces Appendix D
// from the real files, is written after Kobol saves them.
// New for this project; Cyber's reference fixtures have another shape.
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/lib/config";
import { addDays } from "@/lib/dates";
import { jsonText } from "@/lib/json";
import { paceRanges } from "@/lib/metrics/pace";
import { InputsManifest, MetricsFile, OPENALEX_REQUESTS, type OpenAlexRequest } from "@/lib/schema/metrics";
import {
  OpenAlexFixtureIndex, PaceReferenceFile, openalexFixtureWeeks, paceRequestOf, referenceWeeks, type KnownDifference,
} from "@/lib/schema/reference";
import { FIELDS } from "@/lib/vocab";
import { createOpenAlexClient, paceQuery, weekInputs } from "@/scripts/lib/openalex";
import {
  REFERENCE_PATHS, ReferenceBuildError, answerIndex, buildPaceReference, defaultKnownDifferences, savedAnswers, writeReference,
} from "@/scripts/lib/reference";
import { runMetrics } from "@/scripts/metrics";
import { OpenAlexWorld, makeRoot, repoRoot } from "./helpers/openalex-world";

const config = loadConfig(path.join(repoRoot(), "config"));
const settings = config.run.pace;
const pv = { ai_terms: config.aiTerms.version, journals: config.journals.version, fields: config.fields.version };
const D = "2026-10-22";
const CUTOFF = "2026-10-18";
const NOW = new Date(`${D}T05:10:00+08:00`);
const read = (file: string): string => fs.readFileSync(file, "utf8");
const readJson = (file: string): unknown => JSON.parse(read(file));

const mondays = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let m = from; m <= to; m = addDays(m, 7)) out.push(m);
  return out;
};

const ranges = paceRanges(CUTOFF, settings);
const WINDOW = mondays(ranges.window.from, ranges.window.to);
const YEAR_AGO = mondays(ranges.yearAgo.from, ranges.yearAgo.to);
const PROVISIONAL = mondays(ranges.provisional.from, ranges.provisional.to);
const BASELINE = mondays("2015-01-05", "2019-12-23");
const REFERENCE_WEEKS = [...YEAR_AGO, ...WINDOW, ...PROVISIONAL];

const roots: string[] = [];
let world: OpenAlexWorld;
let root: string;

beforeEach(() => {
  world = new OpenAlexWorld(paceQuery(config.index));
  world.use();
  root = makeRoot();
  roots.push(root);
});
afterEach(() => world.close());
afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

/**
 * Makes the edition of `D` as a backfill leaves it: the 34 reference weeks fetched into `cache/openalex/` through the client, the weekly state of
 * the world, and `metrics/D.json` with its manifest written into `content/` by `runMetrics({ frozen })`.
 */
async function edition(): Promise<{ metrics: MetricsFile; manifest: InputsManifest }> {
  world.serveWeeks(YEAR_AGO[0]!, PROVISIONAL.at(-1)!);
  const client = createOpenAlexClient({
    cacheDir: path.join(root, "cache", "openalex"), query: world.query, provisionalWeeks: settings.provisional_weeks, today: D, now: () => NOW,
  });
  const requests: OpenAlexRequest[] = [];
  for (const monday of REFERENCE_WEEKS) requests.push(...weekInputs(await client.fetchWeek(monday)));
  const r = await runMetrics({ date: D, root, out: "content", frozen: { state: world.state(CUTOFF, D, pv), requests }, now: NOW, apiKey: null });
  expect(r.code, r.lines.join("\n")).toBe(0);
  return {
    metrics: MetricsFile.parse(readJson(path.join(root, "content", "metrics", `${D}.json`))),
    manifest: InputsManifest.parse(readJson(path.join(root, "content", "metrics", "inputs", `${D}.json`))),
  };
}

/** The k and n of one of the world's two series over some Mondays, for some fields, worked here. */
function sum(set: "leading" | "all", weeks: readonly string[], fields: readonly (typeof FIELDS)[number][] = FIELDS): { k: number; n: number } {
  let k = 0;
  let n = 0;
  for (const w of weeks) for (const f of fields) {
    const c = world.counts(w, f)[set];
    k += c[0];
    n += c[1];
  }
  return { k, n };
}

const pct1 = (k: number, n: number): string => {
  const tenths = Math.floor((2000 * k + n) / (2 * n));
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
};

describe("the edition's weeks", () => {
  it("are 13 a year ago, 13 in the window and 8 provisional: 34 weeks, 136 answers", () => {
    expect([YEAR_AGO.length, WINDOW.length, PROVISIONAL.length]).toEqual([13, 13, 8]);
    expect(REFERENCE_WEEKS).toHaveLength(34);
    expect(WINDOW[0]).toBe("2026-05-25");
    expect(YEAR_AGO[0]).toBe("2025-05-26");
    expect(PROVISIONAL[0]).toBe("2026-08-24");
  });
});

describe("buildPaceReference() (Appendix D.1 to D.5)", () => {
  it("builds the file from the edition's metrics file and manifest: inputs, baseline, window and year-ago, C and D, the sentence", async () => {
    const { metrics, manifest } = await edition();
    const ref = buildPaceReference(metrics, manifest);
    expect(PaceReferenceFile.safeParse(ref).success).toBe(true);
    // D.1
    expect(ref.inputs).toEqual({ edition_date: D, data_cutoff: CUTOFF, versions: config.versions, requests: 136 });
    // D.2: the baseline of A and B, pooled and for each field, from the world's weeks 2015 to 2019.
    for (const [set, part] of [["leading", ref.baseline.leading], ["all", ref.baseline.all]] as const) {
      const pooled = sum(set, BASELINE);
      expect(part.pooled, set).toEqual({ ...pooled, share: pct1(pooled.k, pooled.n) });
      for (const f of FIELDS) {
        const c = sum(set, BASELINE, [f]);
        expect(part.by_field[f], `${set} ${f}`).toEqual({ ...c, share: c.n === 0 ? null : pct1(c.k, c.n) });
      }
    }
    // D.3: the window and the year-ago window.
    expect(ref.pace.window).toEqual(ranges.window);
    expect(ref.pace.year_ago).toEqual(ranges.yearAgo);
    expect(ref.pace.provisional_from).toBe(PROVISIONAL[0]);
    for (const [set, cells] of [["leading", ref.pace.leading], ["all", ref.pace.all]] as const) {
      const win = sum(set, WINDOW);
      const ago = sum(set, YEAR_AGO);
      expect(cells.pooled.window, set).toEqual({ ...win, share: pct1(win.k, win.n) });
      expect(cells.pooled.year_ago, set).toEqual({ ...ago, share: pct1(ago.k, ago.n) });
      expect(cells.pooled.vs_baseline).toBe(metrics.pace[set].pooled.vs_baseline);
      expect(cells.pooled.vs_year_ago).toBe(metrics.pace[set].pooled.vs_year_ago);
      for (const f of FIELDS) {
        const w = sum(set, WINDOW, [f]);
        expect(cells.by_field[f]!.window, `${set} ${f}`).toEqual({ ...w, share: pct1(w.k, w.n) });
        expect(cells.by_field[f]!.vs_baseline).toBe(metrics.pace[set].by_field[f]!.vs_baseline);
      }
    }
    expect(ref.pace.sentence).toEqual({ en: metrics.pace.sentence.en, zh: metrics.pace.sentence.zh });
    expect(ref.pace.sentence.zh).toBeTruthy();
    // D.4
    expect(ref.landmarks).toEqual(metrics.landmarks);
    expect(ref.hold).toEqual(metrics.hold);
    // D.5
    expect(ref.known_differences).toEqual(defaultKnownDifferences());
    expect(ref.known_differences.map((d) => d.figure)).toEqual(["pace.leading.pooled.window", "pace.all.pooled.window"]);
  });

  it("prints no share for a field with no papers in a part (`share` null, SPEC §5.3): a humanities series with no paper in the leading journals", async () => {
    const original = world.counts.bind(world);
    world.counts = (monday, field) => (field === "humanities" ? { ...original(monday, field), leading: [0, 0] } : original(monday, field));
    const { metrics, manifest } = await edition();
    const ref = buildPaceReference(metrics, manifest);
    const none = { k: 0, n: 0, share: null };
    expect(ref.baseline.leading.by_field.humanities).toEqual(none);
    expect(ref.pace.leading.by_field.humanities).toMatchObject({ window: none, year_ago: none, vs_baseline: "too_few", vs_year_ago: "too_few" });
    expect(ref.baseline.all.by_field.humanities.share).not.toBeNull();
    expect(ref.baseline.leading.pooled.share).not.toBeNull();
  });

  it("holds only counts, printed shares, verdicts and sentences: no Wilson bound, no direction", async () => {
    const { metrics, manifest } = await edition();
    const text = JSON.stringify(buildPaceReference(metrics, manifest));
    expect(text).not.toContain("ci80");
    expect(text).not.toContain("direction");
    expect(Object.keys(buildPaceReference(metrics, manifest))).toEqual(["schema_version", "inputs", "baseline", "pace", "landmarks", "hold", "known_differences"]);
  });

  it("takes known differences it is given instead of the defaults, and holds them to the schema", async () => {
    const { metrics, manifest } = await edition();
    const mine: KnownDifference[] = [{ figure: "pace.all.pooled.year_ago", what: "w", why: "y" }];
    expect(buildPaceReference(metrics, manifest, mine).known_differences).toEqual(mine);
    expect(buildPaceReference(metrics, manifest, []).known_differences).toEqual([]);
    expect(() => buildPaceReference(metrics, manifest, [{ figure: "Not A Path", what: "w", why: "y" }])).toThrow();
  });

  it("refuses an edition that is not ok: a stale or missing file has no figures to freeze", async () => {
    const { metrics, manifest } = await edition();
    for (const status of ["stale", "missing"] as const) {
      expect(() => buildPaceReference({ ...metrics, status }, manifest)).toThrow(new ReferenceBuildError(`The reference is built from an ok edition: metrics/${D}.json is ${status}.`));
    }
  });

  it("refuses a manifest of another date or cutoff, and a sentence with no Chinese", async () => {
    const { metrics, manifest } = await edition();
    expect(() => buildPaceReference(metrics, { ...manifest, date: "2026-10-23" })).toThrow(ReferenceBuildError);
    expect(() => buildPaceReference(metrics, { ...manifest, data_cutoff: "2026-10-11" })).toThrow(/is not the metrics file's/);
    const noZh = { ...metrics, pace: { ...metrics.pace, sentence: { en: metrics.pace.sentence.en, zh: null } } };
    expect(() => buildPaceReference(noZh, manifest)).toThrow(`The Pace sentence of ${D} has no Chinese: Appendix D keeps both languages.`);
  });

  it("refuses figures that break a fact the schema holds a value to, with the schema's message: a share that is not its counts' share", async () => {
    const { metrics, manifest } = await edition();
    // A year-ago window of more A papers than B papers breaks "A's papers are among B's".
    const broken = structuredClone(metrics);
    broken.pace.leading.pooled.year_ago.k = broken.pace.all.pooled.year_ago.k + 1;
    broken.pace.leading.pooled.year_ago.n = Math.max(broken.pace.leading.pooled.year_ago.n, broken.pace.leading.pooled.year_ago.k);
    expect(() => buildPaceReference(broken, manifest)).toThrow(/The figures do not make a reference file/);
  });
});

describe("savedAnswers() and answerIndex()", () => {
  it("reads the 136 answers back from the cache by the manifest's records, oldest week first and a week's four requests in order", async () => {
    const { metrics, manifest } = await edition();
    const ref = buildPaceReference(metrics, manifest);
    const answers = savedAnswers(path.join(root, "cache", "openalex"), ref, manifest);
    expect(answers).toHaveLength(136);
    expect(answers.map((a) => [a.week_start, a.request])).toEqual(REFERENCE_WEEKS.flatMap((w) => OPENALEX_REQUESTS.map((k) => [w, k])));
    for (const a of answers) {
      expect(a.file).toBe(`${a.request}-${a.week_start}.json`);
      expect(a.url).toBe(world.url(a.request, a.week_start));
      expect(a.body, a.file).toBe(world.body(a.request, a.week_start));
    }
    const index = answerIndex(answers);
    expect(OpenAlexFixtureIndex.safeParse(index).success).toBe(true);
    expect(Object.keys(index)).toEqual(answers.map((a) => a.url));
    expect(Object.values(index)[0]).toEqual({ file: `leading_total-${YEAR_AGO[0]}.json`, content_type: "application/json" });
    expect(openalexFixtureWeeks(index)).toEqual(referenceWeeks(ref));
  });

  it("lists every answer the manifest or the cache lacks, and builds nothing", async () => {
    const { metrics, manifest } = await edition();
    const ref = buildPaceReference(metrics, manifest);
    const dir = path.join(root, "cache", "openalex", WINDOW[3]!);
    const victim = fs.readdirSync(dir).sort().find((f) => f.startsWith("all_ai."))!;
    fs.rmSync(path.join(dir, victim));
    const shorter = { ...manifest, openalex: manifest.openalex.filter((q) => !(q.week_start === PROVISIONAL[2] && q.request === "leading_ai")) };
    expect(() => savedAnswers(path.join(root, "cache", "openalex"), ref, shorter)).toThrow(
      `2 of the 136 answers cannot be saved (first: all_ai ${WINDOW[3]}: not in the cache as recorded).`,
    );
    expect(() => savedAnswers(path.join(root, "cache", "openalex"), ref, manifest)).toThrow("1 of the 136 answers cannot be saved");
  });

  it("refuses a body that is not the one the record's SHA-256 names, and a cached file damaged", async () => {
    const { metrics, manifest } = await edition();
    const ref = buildPaceReference(metrics, manifest);
    const cache = path.join(root, "cache", "openalex");
    const dir = path.join(cache, WINDOW[0]!);
    const file = path.join(dir, fs.readdirSync(dir).sort().find((f) => f.startsWith("leading_ai."))!);
    const original = read(file);
    const edited = JSON.parse(original) as { body: string };
    edited.body = edited.body.replace(/\d/, "9");
    fs.writeFileSync(file, JSON.stringify(edited));
    expect(() => savedAnswers(cache, ref, manifest)).toThrow(`first: leading_ai ${WINDOW[0]}: not in the cache as recorded`);
    fs.writeFileSync(file, "{");
    expect(() => savedAnswers(cache, ref, manifest)).toThrow(`first: leading_ai ${WINDOW[0]}: not in the cache as recorded`);
    fs.writeFileSync(file, original);
    expect(savedAnswers(cache, ref, manifest)).toHaveLength(136);
  });
});

describe("writeReference()", () => {
  const out = (...p: string[]): string => path.join(root, "fx", ...p);
  const tree = (): Record<string, string> => {
    const files: Record<string, string> = {};
    const walk = (d: string) => {
      for (const n of fs.readdirSync(d).sort()) {
        const f = path.join(d, n);
        if (fs.statSync(f).isDirectory()) walk(f);
        else files[path.relative(out(), f)] = read(f);
      }
    };
    walk(out());
    return files;
  };

  it("writes pace-reference.json, the 136 answers named by request and week, and the index, validated by the schema", async () => {
    await edition();
    const r = writeReference({ root, date: D, out: "fx" });
    expect(r).toMatchObject({ answers: 136, weeks: 34, keptKnownDifferences: false });
    expect(r.wrote[0]).toBe("reference/pace-reference.json");
    expect(r.wrote.at(-1)).toBe("openalex/index.json");
    expect(r.wrote).toHaveLength(138);
    const files = tree();
    expect(Object.keys(files)).toHaveLength(138);
    const ref = PaceReferenceFile.parse(JSON.parse(files[REFERENCE_PATHS.reference]!));
    expect(files[REFERENCE_PATHS.reference]).toBe(jsonText(ref, PaceReferenceFile));
    const index = OpenAlexFixtureIndex.parse(JSON.parse(files[REFERENCE_PATHS.index]!));
    expect(files[REFERENCE_PATHS.index]).toBe(jsonText(index, OpenAlexFixtureIndex));
    expect(Object.keys(index)).toHaveLength(136);
    for (const [url, entry] of Object.entries(index)) {
      const asked = paceRequestOf(url)!;
      expect(entry.file).toBe(`${asked.request}-${asked.week_start}.json`);
      expect(files[`openalex/${entry.file}`], url).toBe(world.body(asked.request, asked.week_start));
    }
    expect(ref.inputs.requests).toBe(136);
  });

  it("reads the content folder `UT_CONTENT_DIR` names", async () => {
    await edition();
    fs.renameSync(path.join(root, "content"), path.join(root, "elsewhere"));
    vi.stubEnv("UT_CONTENT_DIR", "elsewhere");
    try {
      expect(writeReference({ root, date: D, out: "fx" })).toMatchObject({ answers: 136 });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(() => writeReference({ root, date: D, out: "fx" })).toThrow(ReferenceBuildError);
  });

  it("is byte-identical on a rerun, and a run in an absolute folder gives the same files", async () => {
    await edition();
    writeReference({ root, date: D, out: "fx" });
    const first = tree();
    const again = writeReference({ root, date: D, out: "fx" });
    expect(again.keptKnownDifferences).toBe(true);
    expect(tree()).toEqual(first);
    writeReference({ root, date: D, out: path.join(root, "fx2") });
    const second: Record<string, string> = {};
    for (const name of Object.keys(first)) second[name] = read(path.join(root, "fx2", name));
    expect(second).toEqual(first);
  });

  it("keeps the known differences a person wrote in the file already there, and writes the rest as the data says", async () => {
    await edition();
    writeReference({ root, date: D, out: "fx" });
    const file = out(REFERENCE_PATHS.reference);
    const ref = PaceReferenceFile.parse(readJson(file));
    const mine: KnownDifference[] = [{ figure: "pace.all.pooled.window", what: "A later run reads a smaller count", why: "OpenAlex removed duplicates" }];
    fs.writeFileSync(file, jsonText({ ...ref, known_differences: mine }, PaceReferenceFile));
    const r = writeReference({ root, date: D, out: "fx" });
    expect(r.keptKnownDifferences).toBe(true);
    expect(PaceReferenceFile.parse(readJson(file)).known_differences).toEqual(mine);
    // Everything but the known differences is rebuilt from the data: a hand edit of a count does not survive.
    const edited = { ...ref, hold: { ...ref.hold, cases: 5, held: 5 } };
    fs.writeFileSync(file, jsonText({ ...edited, known_differences: mine }, PaceReferenceFile));
    writeReference({ root, date: D, out: "fx" });
    expect(PaceReferenceFile.parse(readJson(file)).hold).toEqual(ref.hold);
  });

  it("refuses a reference file already there that does not parse, and leaves it, with nothing else written", async () => {
    await edition();
    fs.mkdirSync(out("reference"), { recursive: true });
    fs.writeFileSync(out(REFERENCE_PATHS.reference), "{");
    expect(() => writeReference({ root, date: D, out: "fx" })).toThrow(ReferenceBuildError);
    expect(read(out(REFERENCE_PATHS.reference))).toBe("{");
    fs.writeFileSync(out(REFERENCE_PATHS.reference), JSON.stringify({ schema_version: 1 }));
    expect(() => writeReference({ root, date: D, out: "fx" })).toThrow(/does not parse .* remove it to build a new one/);
    expect(fs.existsSync(out("openalex"))).toBe(false);
  });

  it("replaces the answer files and the index of an earlier set and no other file", async () => {
    await edition();
    fs.mkdirSync(out("openalex"), { recursive: true });
    // An earlier set's file of each of the four requests, for a week this set does not hold.
    for (const kind of ["leading_ai", "leading_total", "all_ai", "all_total"]) fs.writeFileSync(out("openalex", `${kind}-2015-01-05.json`), "old");
    fs.writeFileSync(out("openalex", "index.json"), "old");
    fs.writeFileSync(out("openalex", "README.md"), "kept");
    fs.writeFileSync(out("openalex", "samples.json"), "kept");
    writeReference({ root, date: D, out: "fx" });
    for (const kind of ["leading_ai", "leading_total", "all_ai", "all_total"]) expect(fs.existsSync(out("openalex", `${kind}-2015-01-05.json`)), kind).toBe(false);
    expect(read(out("openalex", "README.md"))).toBe("kept");
    expect(read(out("openalex", "samples.json"))).toBe("kept");
    expect(read(out("openalex", "index.json"))).not.toBe("old");
  });

  it("writes nothing when an answer is missing, and says what is wrong when the edition's files are", async () => {
    await edition();
    const dir = path.join(root, "cache", "openalex", PROVISIONAL[0]!);
    fs.rmSync(path.join(dir, fs.readdirSync(dir).sort()[0]!));
    expect(() => writeReference({ root, date: D, out: "fx" })).toThrow("1 of the 136 answers cannot be saved");
    expect(fs.existsSync(out())).toBe(false);
    expect(() => writeReference({ root, date: "2026-10-23", out: "fx" })).toThrow("metrics/2026-10-23.json is missing");
    fs.mkdirSync(path.join(root, "content", "metrics"), { recursive: true });
    fs.writeFileSync(path.join(root, "content", "metrics", "2026-10-23.json"), "{");
    expect(() => writeReference({ root, date: "2026-10-23", out: "fx" })).toThrow("metrics/2026-10-23.json is not JSON");
    fs.writeFileSync(path.join(root, "content", "metrics", "2026-10-23.json"), "{}");
    expect(() => writeReference({ root, date: "2026-10-23", out: "fx" })).toThrow("metrics/2026-10-23.json does not parse");
    fs.writeFileSync(path.join(root, "content", "metrics", "2026-10-24.json"), read(path.join(root, "content", "metrics", `${D}.json`)));
    expect(() => writeReference({ root, date: "2026-10-24", out: "fx" })).toThrow("metrics/inputs/2026-10-24.json is missing");
    fs.writeFileSync(path.join(root, "content", "metrics", "inputs", "2026-10-24.json"), "{}");
    expect(() => writeReference({ root, date: "2026-10-24", out: "fx" })).toThrow("metrics/inputs/2026-10-24.json does not parse");
  });

  it("gives answers that reproduce the figures offline: the saved files, served through UT_FIXTURE_FEEDS, give the window's counts the reference holds", async () => {
    await edition();
    writeReference({ root, date: D, out: "fx" });
    const ref = PaceReferenceFile.parse(readJson(out(REFERENCE_PATHS.reference)));
    world.close();
    process.env.UT_FIXTURE_FEEDS = out("openalex");
    try {
      const fresh = fs.mkdtempSync(path.join(root, "replay-"));
      const client = createOpenAlexClient({ cacheDir: fresh, query: world.query, provisionalWeeks: settings.provisional_weeks, today: D, now: () => NOW });
      let k = 0;
      let n = 0;
      let kAll = 0;
      let nAll = 0;
      for (const monday of WINDOW) {
        const w = await client.fetchWeek(monday);
        for (const f of FIELDS) {
          k += w.leading[f][0];
          n += w.leading[f][1];
          kAll += w.all[f][0];
          nAll += w.all[f][1];
        }
      }
      expect(client.stats().requests).toBe(52);
      expect([ref.pace.leading.pooled.window.k, ref.pace.leading.pooled.window.n]).toEqual([k, n]);
      expect([ref.pace.all.pooled.window.k, ref.pace.all.pooled.window.n]).toEqual([kAll, nAll]);
    } finally {
      delete process.env.UT_FIXTURE_FEEDS;
    }
  });

  it("is case-safe: every file it writes has a lower-case name, so no two differ by case alone", async () => {
    await edition();
    writeReference({ root, date: D, out: "fx" });
    const names = Object.keys(tree());
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    for (const n of names) expect(n, n).toBe(n.toLowerCase());
  });
});
