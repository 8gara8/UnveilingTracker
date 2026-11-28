// Where collect, sources:check, the metrics and the backfill keep their local files (SPEC §3 `/cache/`, §9.8,
// gitignored): one function, so no module spells a cache path itself. Pure: it builds paths and touches no
// file. A name that could leave its folder (a slash, a leading dot, a malformed date) throws.
//
// Cyber's lib/feeds/cache.ts at the fork commit 3ced1fb, adapted: this project's folders (`cache/feeds` with
// `cache/feeds/arxiv` inside, `cache/openalex`, `cache/snapshots`, `cache/staged`, `cache/rung-watch.json`),
// none of Cyber's domain folders; `cacheBodyDirs()` (which Cyber kept beside `pruneCache()`) lives here, and
// lists `cache/feeds/arxiv` because `pruneCache()` never enters a subfolder on its own (§4.13, §9.8);
// `checkCachePaths()` (Cyber's was in its collect script) is the same layout under `cache/check/`.

import path from "node:path";
import { isValidDate } from "../dates";
import { arxivListName } from "./arxiv";

export interface CachePaths {
  /** cache/feeds */
  feedsDir: string;
  /** cache/feeds/index.json: the feeds' state, which collect writes. */
  feedIndex: string;
  /** cache/feeds/<id>.<ext>: a feed's body as collect read it (`journal-nature.xml`, `retraction-watch.csv`). */
  feedBody(id: string, ext: string): string;
  /** cache/feeds/arxiv: one file for each arXiv list, pruned after 60 days (§4.13). */
  arxivDir: string;
  /** cache/feeds/arxiv/<id>.<US date>.xml: the list of the announcement on that US date, as `arxiv-<cat>` got it. */
  arxivList(id: string, usDate: string): string;
  /** cache/openalex: the Pace's OpenAlex answers, never pruned (§5.4, §9.8). */
  openalexDir: string;
  /** cache/snapshots: page snapshots of cited pages (§4.12). */
  snapshotsDir: string;
  /** cache/staged: files staged before publish. */
  stagedDir: string;
  /** cache/staged/<date>: one morning's metrics files. */
  stagedMetrics(date: string): string;
  /** cache/staged/backfill */
  stagedBackfill: string;
  /** cache/rung-watch.json: each finding's last complete check (§5.8). */
  rungWatch: string;
  /** logs/recompute/<date>: a --recompute run's output. */
  recompute(date: string): string;
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const EXT_RE = /^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/;

function checked(ok: boolean, value: string, what: string): string {
  if (!ok) throw new Error(`cachePaths: not a valid ${what}: ${JSON.stringify(value)}`);
  return value;
}

const feedId = (id: string) => checked(ID_RE.test(id), id, "feed id");
const day = (date: string) => checked(isValidDate(date), date, "date");

/** Every cache path under the repo root `root`. */
export function cachePaths(root: string): CachePaths {
  const cache = path.join(root, "cache");
  const feedsDir = path.join(cache, "feeds");
  const arxivDir = path.join(feedsDir, "arxiv");
  const stagedDir = path.join(cache, "staged");
  return {
    feedsDir,
    feedIndex: path.join(feedsDir, "index.json"),
    feedBody: (id, ext) => path.join(feedsDir, `${feedId(id)}.${checked(EXT_RE.test(ext), ext, "extension")}`),
    arxivDir,
    arxivList: (id, usDate) => path.join(arxivDir, arxivListName(feedId(id), day(usDate))),
    openalexDir: path.join(cache, "openalex"),
    snapshotsDir: path.join(cache, "snapshots"),
    stagedDir,
    stagedMetrics: (date) => path.join(stagedDir, day(date)),
    stagedBackfill: path.join(stagedDir, "backfill"),
    rungWatch: path.join(cache, "rung-watch.json"),
    recompute: (date) => path.join(root, "logs", "recompute", day(date)),
  };
}

/**
 * The same layout under `cache/check/`, where `sources:check` keeps its bodies so that it never rewrites
 * collect's (§8.10; its bodies are `cache/check/feeds/...`). The rung watch's file and a recompute's output
 * are not cache paths of a check and stay where they are: a check writes neither.
 */
export function checkCachePaths(root: string): CachePaths {
  const from = path.join(root, "cache");
  const to = path.join(from, "check");
  const move = (p: string) => path.join(to, path.relative(from, p));
  const p = cachePaths(root);
  return {
    feedsDir: move(p.feedsDir),
    feedIndex: move(p.feedIndex),
    feedBody: (id, ext) => move(p.feedBody(id, ext)),
    arxivDir: move(p.arxivDir),
    arxivList: (id, usDate) => move(p.arxivList(id, usDate)),
    openalexDir: move(p.openalexDir),
    snapshotsDir: move(p.snapshotsDir),
    stagedDir: move(p.stagedDir),
    stagedMetrics: (date) => move(p.stagedMetrics(date)),
    stagedBackfill: move(p.stagedBackfill),
    rungWatch: p.rungWatch,
    recompute: p.recompute,
  };
}

/** A cache folder `pruneCache()` reads: its files (never its subfolders) go after 60 days, except `keep`. */
export interface CacheBodyDir {
  dir: string;
  keep: readonly string[];
}

/**
 * The folders of bodies and snapshots that `pruneCache()` reads (§9.8): collect's `cache/feeds` (but its
 * `index.json`), `cache/feeds/arxiv` (a subfolder, so it is listed on its own, §4.13) and `cache/snapshots`,
 * and the two feed folders again under `cache/check/`. `cache/openalex` is left out on purpose: the Pace's
 * answers are never pruned, since `metrics --recompute` and the backfill read them (§5.4). Staged files and
 * `cache/rung-watch.json` are not listed either.
 */
export function cacheBodyDirs(root: string): CacheBodyDir[] {
  const live = cachePaths(root);
  const check = checkCachePaths(root);
  const feeds = (p: CachePaths): CacheBodyDir[] => [
    { dir: p.feedsDir, keep: [path.basename(p.feedIndex)] },
    { dir: p.arxivDir, keep: [] },
  ];
  return [...feeds(live), { dir: live.snapshotsDir, keep: [] }, ...feeds(check)];
}
