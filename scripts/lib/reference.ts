// The reference files of SPEC Appendix D and §10 P2 steps 2 and 6, built from the cache of a finished backfill:
//   fixtures/reference/pace-reference.json   the figures of the backfill's edition (D.1 to D.5), in the shape of lib/schema/reference.ts
//   fixtures/openalex/                       the 136 group-by answers (34 weeks, four requests each) that the edition's window, year-ago window
//                                            and provisional weeks were read from, named `<request>-<Monday>.json`, and the `index.json` that
//                                            `fetchFeed()` serves them by (`UT_FIXTURE_FEEDS`)
// so `tests/reference.test.ts` can reproduce every figure offline. The command is `backfill.ts --save-reference DIR` (scripts/backfill.ts),
// run once on Kobol after a backfill whose files are in `content/`; this file is the library behind it and is run with no network.
//
// What is stored, and where each figure comes from (D.1 to D.5):
// - D.1 `inputs`: the edition date and its cutoff, the config versions, and the number of OpenAlex requests the edition's manifest lists.
// - D.2 `baseline`, D.3 `pace`: the metrics file's own k and n for the baseline, the window and the year-ago window of A and B, pooled and for each
//   field; a share is printed as `fmtPct1` of its counts (the schema holds a share to that); the verdicts and the Pace sentence in both languages
//   are the file's own. No Wilson bound, direction or clause is stored: the code under test works those out (lib/schema/reference.ts).
// - D.4 `landmarks` and `hold`: C by year and D as the metrics file has them.
// - D.5 `known_differences`: what the file already holds when one is there (a person writes these after reading the first figures, "do not fix
//   these"), else the two the spec itself gives (§5.4: a recent week's counts move as OpenAlex re-indexes it).
// - The answers: for each week of `referenceWeeks()` and each request kind, the body the manifest's record names (its URL, its SHA-256 and the
//   time it was fetched), read back from `cache/openalex/` (`readCachedBody()` holds a body to the SHA-256 of the record) and written byte for byte. A body the
//   cache lacks, damaged or changed since it was cached is an error that lists every one missing; nothing is written then.
//
// A second run writes the same bytes, and a run replaces the generated answer files (`<request>-<Monday>.json` and the index) and no other file.
// New for this project; Cyber's reference fixtures have another shape (docs/PROVENANCE.md).

import fs from "node:fs";
import path from "node:path";
import { jsonText } from "../../lib/json";
import { contentDir } from "../../lib/content";
import { cachePaths } from "../../lib/feeds/cache";
import { fmtPct1 } from "../../lib/metrics/stats";
import type { IsoDate } from "../../lib/schema/common";
import {
  InputsManifest, MetricsFile, OPENALEX_REQUESTS, type PaceCell, type PaceSet, type OpenAlexRequestKind, type Share,
} from "../../lib/schema/metrics";
import {
  KnownDifference, OpenAlexFixtureIndex, PaceReferenceFile, ReferenceCell, ReferenceCellSet, ReferenceTally, ReferenceTallySet, referenceWeeks,
  type KnownDifference as KnownDifferenceType,
} from "../../lib/schema/reference";
import { FIELDS } from "../../lib/vocab";
import { readCachedBody } from "./openalex";

/** Where the reference file and the saved answers go under the fixtures folder. */
export const REFERENCE_PATHS = {
  reference: path.join("reference", "pace-reference.json"),
  openalexDir: "openalex",
  index: path.join("openalex", "index.json"),
} as const;

/** A reference that cannot be built; the message names what is missing or wrong, never a key. */
export class ReferenceBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceBuildError";
  }
}

/** The two differences the spec gives (§5.4, §5.3): a later run's counts for the newest firm weeks, and a year-ago window that has since moved. */
export function defaultKnownDifferences(): KnownDifferenceType[] {
  return [
    {
      figure: "pace.leading.pooled.window",
      what: "A later run reads other counts for the window's newest weeks",
      why: "OpenAlex changes a work's topic or abstract after it is indexed, so a week's counts move for about two months (§5.4)",
    },
    {
      figure: "pace.all.pooled.window",
      what: "A later run reads other counts for the window's newest weeks",
      why: "OpenAlex changes a work's topic or abstract after it is indexed, so a week's counts move for about two months (§5.4)",
    },
  ].map((d) => KnownDifference.parse(d));
}

// ── The reference file ───────────────────────────────────────────────────────────────────────────

const tally = (s: Pick<Share, "k" | "n">): ReferenceTally => ({ k: s.k, n: s.n, share: s.n === 0 ? null : fmtPct1(s.k, s.n) });

const tallySet = (set: PaceSet, part: "window" | "baseline" | "year_ago"): ReferenceTallySet => ({
  pooled: tally(set.pooled[part]),
  by_field: Object.fromEntries(FIELDS.map((f) => [f, tally(set.by_field[f]![part])])) as ReferenceTallySet["by_field"],
});

const cell = (c: PaceCell): ReferenceCell => ({ window: tally(c.window), year_ago: tally(c.year_ago), vs_baseline: c.vs_baseline, vs_year_ago: c.vs_year_ago });

const cellSet = (set: PaceSet): ReferenceCellSet => ({
  pooled: cell(set.pooled),
  by_field: Object.fromEntries(FIELDS.map((f) => [f, cell(set.by_field[f]!)])) as ReferenceCellSet["by_field"],
});

/**
 * `pace-reference.json` from a backfill edition's metrics file and its inputs manifest. The file must be `ok` (a stale or missing one has no figures
 * to freeze), the two must be of one date and cutoff, and the Pace sentence must have its Chinese (Appendix D keeps both languages). The result is
 * validated by `PaceReferenceFile` (a printed share is `fmtPct1` of its counts, a pooled cell is its fields added up, A is among B), so a metrics file
 * that breaks one of those facts is refused here with the schema's message.
 */
export function buildPaceReference(metrics: MetricsFile, manifest: InputsManifest, knownDifferences: readonly KnownDifferenceType[] = defaultKnownDifferences()): PaceReferenceFile {
  if (metrics.status !== "ok") throw new ReferenceBuildError(`The reference is built from an ok edition: metrics/${metrics.date}.json is ${metrics.status}.`);
  if (manifest.date !== metrics.date || manifest.data_cutoff !== metrics.data_cutoff) {
    throw new ReferenceBuildError(`The manifest (${manifest.date}, data to ${manifest.data_cutoff}) is not the metrics file's (${metrics.date}, data to ${metrics.data_cutoff}).`);
  }
  const { pace } = metrics;
  if (pace.sentence.zh === null) throw new ReferenceBuildError(`The Pace sentence of ${metrics.date} has no Chinese: Appendix D keeps both languages.`);
  const parsed = PaceReferenceFile.safeParse({
    schema_version: 1,
    inputs: { edition_date: metrics.date, data_cutoff: metrics.data_cutoff, versions: metrics.versions, requests: manifest.openalex.length },
    baseline: { from: pace.baseline.from, to: pace.baseline.to, leading: tallySet(pace.leading, "baseline"), all: tallySet(pace.all, "baseline") },
    pace: {
      window: pace.window, provisional_from: pace.provisional_from, year_ago: pace.year_ago,
      leading: cellSet(pace.leading), all: cellSet(pace.all), sentence: { en: pace.sentence.en, zh: pace.sentence.zh },
    },
    landmarks: metrics.landmarks,
    hold: metrics.hold,
    known_differences: knownDifferences,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ReferenceBuildError(`The figures do not make a reference file: ${first?.path.join(".") ?? ""}: ${first?.message ?? "invalid"}`);
  }
  return parsed.data;
}

// ── The saved answers ────────────────────────────────────────────────────────────────────────────

/** One answer to save: the request it answers, its URL as recorded, its file name and its body exactly as OpenAlex sent it. */
export interface SavedAnswer {
  request: OpenAlexRequestKind;
  week_start: IsoDate;
  url: string;
  file: string;
  body: string;
}

/**
 * The 136 answers of the edition's reference weeks (`referenceWeeks()`), oldest week first and each week's four requests in `OPENALEX_REQUESTS` order,
 * read from `cacheDir` by the records of `manifest`. Throws `ReferenceBuildError` listing every answer the manifest lacks or the cache cannot give back
 * (missing, damaged, or not the body the record's SHA-256 names).
 */
export function savedAnswers(cacheDir: string, reference: PaceReferenceFile, manifest: InputsManifest): SavedAnswer[] {
  const out: SavedAnswer[] = [];
  const lacking: string[] = [];
  for (const week of referenceWeeks(reference)) {
    for (const request of OPENALEX_REQUESTS) {
      const record = manifest.openalex.find((r) => r.week_start === week && r.request === request);
      if (record === undefined) {
        lacking.push(`${request} ${week}: not in the manifest`);
        continue;
      }
      const body = readCachedBody(cacheDir, record);
      if (body === null) {
        lacking.push(`${request} ${week}: not in the cache as recorded`);
        continue;
      }
      out.push({ request, week_start: week, url: record.url, file: `${request}-${week}.json`, body });
    }
  }
  if (lacking.length > 0) {
    throw new ReferenceBuildError(`${lacking.length} of the ${referenceWeeks(reference).length * OPENALEX_REQUESTS.length} answers cannot be saved (first: ${lacking[0]}).`);
  }
  return out;
}

/** The index of `fixtures/openalex/`: each answer's URL to its file, in the order `OpenAlexFixtureIndex` requires. */
export function answerIndex(answers: readonly SavedAnswer[]): OpenAlexFixtureIndex {
  return OpenAlexFixtureIndex.parse(Object.fromEntries(answers.map((a) => [a.url, { file: a.file, content_type: "application/json" }])));
}

// ── Writing ──────────────────────────────────────────────────────────────────────────────────────

export interface WriteReferenceOptions {
  /** The repository root. */
  root: string;
  /** The backfill's edition date: its `metrics/D.json` and manifest are read from the content folder. */
  date: IsoDate;
  /** The fixtures folder to write into (`reference/` and `openalex/` go under it); relative to `root` or absolute. */
  out: string;
}

export interface WriteReferenceResult {
  /** Files written, relative to `out`, in the order written. */
  wrote: string[];
  /** Answer files written (the index not counted). */
  answers: number;
  /** The weeks the answers cover. */
  weeks: number;
  /** Whether `known_differences` came from the file already there. */
  keptKnownDifferences: boolean;
}

const GENERATED = /^(?:leading_total|leading_ai|all_total|all_ai)-\d{4}-\d{2}-\d{2}\.json$/;

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readJsonFile(file: string, what: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new ReferenceBuildError(`${what} is missing: ${file}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ReferenceBuildError(`${what} is not JSON: ${file}`);
  }
}

/**
 * Builds and writes both reference files for the edition `date` from `content/metrics/D.json`, its manifest and `cache/openalex/`. Nothing is written
 * unless every figure and every answer is whole. The answer files and the index the folder held before are replaced (only files named
 * `<request>-<Monday>.json`, and `index.json`); `known_differences` of a reference file already there are kept as they are, and a file there that
 * does not parse is an error rather than something to overwrite.
 */
export function writeReference(o: WriteReferenceOptions): WriteReferenceResult {
  const root = path.resolve(o.root);
  const out = path.resolve(root, o.out);
  const content = path.resolve(root, contentDir());
  const metrics = MetricsFile.safeParse(readJsonFile(path.join(content, "metrics", `${o.date}.json`), `metrics/${o.date}.json`));
  if (!metrics.success) throw new ReferenceBuildError(`metrics/${o.date}.json does not parse: ${metrics.error.issues[0]?.message ?? "invalid"}`);
  const manifest = InputsManifest.safeParse(readJsonFile(path.join(content, "metrics", "inputs", `${o.date}.json`), `metrics/inputs/${o.date}.json`));
  if (!manifest.success) throw new ReferenceBuildError(`metrics/inputs/${o.date}.json does not parse: ${manifest.error.issues[0]?.message ?? "invalid"}`);

  const referenceFile = path.join(out, REFERENCE_PATHS.reference);
  let known: KnownDifferenceType[] = defaultKnownDifferences();
  let kept = false;
  if (fs.existsSync(referenceFile)) {
    const before = PaceReferenceFile.safeParse(readJsonFile(referenceFile, "The reference file already there"));
    if (!before.success) throw new ReferenceBuildError(`The reference file already there does not parse (${before.error.issues[0]?.message ?? "invalid"}): remove it to build a new one.`);
    known = before.data.known_differences;
    kept = true;
  }

  const reference = buildPaceReference(metrics.data, manifest.data, known);
  const answers = savedAnswers(cachePaths(root).openalexDir, reference, manifest.data);
  const index = answerIndex(answers);

  const dir = path.join(out, REFERENCE_PATHS.openalexDir);
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).sort()) if (GENERATED.test(name) || name === "index.json") fs.rmSync(path.join(dir, name), { force: true });
  }
  const wrote: string[] = [];
  const put = (rel: string, text: string) => {
    writeAtomic(path.join(out, rel), text);
    wrote.push(rel.split(path.sep).join("/"));
  };
  put(REFERENCE_PATHS.reference, jsonText(reference, PaceReferenceFile));
  for (const a of answers) put(path.join(REFERENCE_PATHS.openalexDir, a.file), a.body);
  put(REFERENCE_PATHS.index, jsonText(index, OpenAlexFixtureIndex));
  return { wrote, answers: answers.length, weeks: answers.length / OPENALEX_REQUESTS.length, keptKnownDifferences: kept };
}
