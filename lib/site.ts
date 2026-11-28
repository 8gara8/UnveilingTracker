// Site-wide settings (SPEC §6 "Content loading", §9.7): the site's name and tagline, its address and the content folder. Names and
// the address come from config/run.json, which is imported as a module so that the site bundles it (lib/config.ts parses the same
// file with its schema). The one variable read is `UT_CONTENT_DIR`, never a secret; no variable overrides the address. Reading the
// process environment and working folder is all this file does: no clock, no network and no file.
//
// Cyber's lib/site.ts at the fork commit 3ced1fb, adapted: `siteUrl()`, `contentDir()` and `isSampleData()` are Cyber's, with this
// project's variable and a tagline in both languages (run.json holds an `en` and a `zh` one). P1 needs only these (docs/PROVENANCE.md);
// P4 adds what only the pages read: `siteAccent()` with `UT_ACCENT` (§9.7, Appendix A.2), `THEME_COLOR`, the stale-banner hour
// (`schedule.stale_after`), the sibling and repository links and the address builders of the page routes (§6 "Link formats").

import path from "node:path";
import run from "../config/run.json";
import type { Bilingual } from "./i18n";

/** run.json `site.name`. */
export const SITE_NAME: string = run.site.name;

/** run.json `site.tagline`, in both languages. */
export const SITE_TAGLINE: Bilingual = run.site.tagline;

/** run.json `site.url`, trailing slashes removed. No variable overrides it. */
export function siteUrl(): string {
  return run.site.url.replace(/\/+$/, "");
}

/** The content folder: `UT_CONTENT_DIR`, else run.json `paths.content_dir` ("content"), as given (relative to the repository root). */
export function contentDir(): string {
  return process.env.UT_CONTENT_DIR || run.paths.content_dir;
}

/**
 * True only when `dir` is a folder under `fixtures/` (the sample and the empty folder): the layout then shows the sample banner
 * (§6). `fixtures/` itself and every folder outside it (`content/`, `logs/dry-run/tree`, a temporary copy) are not. Relative paths
 * are read from `root`, the working folder by default.
 */
export function isSampleData(dir: string = contentDir(), root: string = process.cwd()): boolean {
  const rel = path.relative(path.resolve(root, "fixtures"), path.resolve(root, dir));
  return rel !== "" && rel.split(path.sep)[0] !== "..";
}
