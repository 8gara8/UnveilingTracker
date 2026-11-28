// What the feed readers' tests share (SPEC §4.13, §8.3, §8.13): the fixture run that `fixtures/feeds/index.json` answers (the morning of 2026-10-22,
// whose URLs the readers' builders make), a run built from the real config, bodies that cannot be committed (the Retraction Watch file, a gzip),
// a temporary fixture folder, and a fake `fetchFeed()` for the failure cases. New for this project; no Cyber source.
//
// The fixture morning is Thursday 2026-10-22: its window is 2026-10-21 03:15 to 2026-10-22 03:15 Taipei (UTC days 2026-10-20 and 2026-10-21), its arXiv
// list is the announcement of the US date 2026-10-20, and its lookback holds the announcements of 2026-10-18 (Sunday) and 2026-10-19 (Monday).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { loadConfig } from "../../lib/config";
import type { FetchResult } from "../../lib/feeds/http";
import type { FeedEntry } from "../../lib/schema/registry";
import type { FeedRun } from "../../scripts/lib/feeds";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** `UT_FIXTURE_FEEDS` for a test: the folder `fixtures/feeds/` of the repository. */
export const FEEDS_DIR = path.join(ROOT, "fixtures", "feeds");

export const FIXTURE_DATE = "2026-10-22";
export const FIXTURE_WINDOW = { start: "2026-10-21T03:15:00+08:00", end: "2026-10-22T03:15:00+08:00" } as const;

let config: ReturnType<typeof loadConfig> | null = null;
/** The repository's real config, loaded once. */
export function realConfig(): ReturnType<typeof loadConfig> {
  config ??= loadConfig(path.join(ROOT, "config"));
  return config;
}

/** The registry entry with this id, from the real config. */
export function feedEntry(id: string): FeedEntry {
  const entry = realConfig().sources.feeds.find((f) => f.id === id);
  if (!entry) throw new Error(`no feed ${id}`);
  return entry;
}

/** The run `fixtures/feeds/` answers: the real config's skipped dates, phrases and journals, on the fixture morning. */
export function fixtureRun(over: Partial<FeedRun> = {}): FeedRun {
  const c = realConfig();
  return {
    date: FIXTURE_DATE, window: { ...FIXTURE_WINDOW }, arxivSkipped: c.sources.arxiv_skipped, aiPhrases: c.aiTerms.phrases.map((p) => p.phrase),
    journals: c.journals.journals.map((j) => ({ id: j.id, issn: j.issn })), probe: { ncts: ["NCT09990201", "NCT09990202", "NCT09990203"], dois: ["10.1000/ut-sample-rw-0001", "10.1000/ut-sample-rw-0002"] },
    ...over,
  };
}

const made: string[] = [];

/** A new temporary folder, under the real path of the temporary root (a symlinked /tmp would otherwise make two names for it). */
export function tempDir(prefix = "ut-feeds-"): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  made.push(dir);
  return dir;
}

/** Removes every folder `tempDir()` made (call it from afterAll). */
export function removeTempDirs(): void {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** One saved answer of a temporary fixture folder: a body, a status alone, or an error class. */
export interface Saved {
  body?: string | Buffer;
  content_type?: string;
  status?: number;
  error?: string;
}

/** Writes a fixture folder (`index.json` and one file for each saved body) and returns it; set it as `UT_FIXTURE_FEEDS`. */
export function writeFixtureDir(saved: Readonly<Record<string, Saved>>): string {
  const dir = tempDir("ut-fixture-feeds-");
  const index: Record<string, { file?: string; content_type?: string; status?: number; error?: string }> = {};
  let n = 0;
  for (const [url, s] of Object.entries(saved)) {
    const entry: { file?: string; content_type?: string; status?: number; error?: string } = {};
    if (s.body !== undefined) {
      const file = `body-${n++}.dat`;
      fs.writeFileSync(path.join(dir, file), s.body);
      entry.file = file;
    }
    if (s.content_type !== undefined) entry.content_type = s.content_type;
    if (s.status !== undefined) entry.status = s.status;
    if (s.error !== undefined) entry.error = s.error;
    index[url] = entry;
  }
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  return dir;
}

/** A `FetchResult` for a fake `fetchFeed()`: a 200 with a body, or a failure with its error class. */
export function answer(body: string | Buffer | null, o: { contentType?: string | null; error?: FetchResult["error"]; status?: number | null; attempts?: number; url?: string } = {}): FetchResult {
  const ok = o.error === undefined && body !== null;
  return {
    ok, status: o.status ?? (ok ? 200 : null), finalUrl: o.url ?? "https://example.org/ut-sample/answer", body: body === null ? null : Buffer.from(body), contentType: o.contentType ?? null,
    error: o.error ?? (body === null ? "network" : null), detail: ok ? null : "a fake failure with raw detail", durationMs: 1, attempts: o.attempts ?? 1,
  };
}

// ── The Retraction Watch file ────────────────────────────────────────────────────────────────────

/** The file's header as K1d read it: twenty named columns, and a comma after the last that makes a twenty-first with no name. */
export const RETRACTION_HEADER = "Record ID,Title,Subject,Institution,Journal,Publisher,Country,Author,URLS,ArticleType,RetractionDate,RetractionDOI,RetractionPubMedID,OriginalPaperDate,OriginalPaperDOI,OriginalPaperPubMedID,RetractionNature,Reason,Paywalled,Notes,";

export interface RetractionFixtureRow {
  nature?: string;
  reason?: string;
  originalDoi?: string;
  retractionDoi?: string;
  /** As the file writes it: `M/D/YYYY 0:00`. */
  date?: string;
  title?: string;
}

const csvField = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/** The file's text for some rows (an invented title and a record id for each), with the real header and the trailing comma on every record. */
export function retractionCsv(rows: readonly RetractionFixtureRow[]): string {
  const lines = rows.map((r, i) => {
    const cells: Record<string, string> = {
      "Record ID": String(99000 + i), Title: r.title ?? `A sample retracted paper ${i}`, Subject: "(BLS) Sample", Institution: "Placeholder Institute", Journal: "Journal of Placeholder Science",
      Publisher: "Placeholder Press", Country: "Nowhere", Author: "Ada Placeholder (SAMPLE)", URLS: "", ArticleType: "Research Article", RetractionDate: r.date ?? "10/1/2026 0:00",
      RetractionDOI: r.retractionDoi ?? "", RetractionPubMedID: "0", OriginalPaperDate: "1/2/2026 0:00", OriginalPaperDOI: r.originalDoi ?? "", OriginalPaperPubMedID: "0",
      RetractionNature: r.nature ?? "Retraction", Reason: r.reason ?? "Computer-Aided Content or Computer-Generated Content;", Paywalled: "No", Notes: "",
    };
    return `${RETRACTION_HEADER.split(",").slice(0, -1).map((h) => csvField(cells[h] ?? "")).join(",")},`;
  });
  return `${[RETRACTION_HEADER, ...lines].join("\n")}\n`;
}

/** A gzip of a value's JSON text, as RCSB's holdings file comes. */
export const gzipJson = (value: unknown): Buffer => zlib.gzipSync(Buffer.from(JSON.stringify(value)));
