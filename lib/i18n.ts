// The language layer (SPEC §4.1, §4.2, §6, §7): `Lang`, the `L10n` type of every reader-facing string a
// model writes, `Bilingual` for the fixed strings of lib/vocab.ts and lib/page-text.ts, `t()` to pick one
// language, the `<html lang>` and Open Graph values, `hrefFor()` and the language switch's pairs. Pure:
// no clock, file, network or React, so the schemas, the validator, the chat edition and the site share it.
// New in P1; Cyber has no language layer (docs/PROVENANCE.md). Page strings (SPEC §7) are in
// lib/page-text.ts, which comes later in P1.
//
// The site has no i18n library and no middleware (SPEC §3): English pages live at `/…` and their Chinese
// counterparts at `/zh/…` (`/` and `/zh`), as two route groups with their own root layouts (SPEC §6).

export const LANGS = ["en", "zh"] as const;
export type Lang = (typeof LANGS)[number];

/**
 * A reader-facing string in both languages (SPEC §4.1). The English agent writes `en` and the Chinese pass
 * writes `zh`; `zh` is null only in text that an English-only edition wrote and in a correction's `before`
 * copied from it, and a Chinese page then shows the English text (`shownLang()`).
 */
export type L10n = { en: string; zh: string | null };

/**
 * A fixed string in both languages, never model-written: a vocabulary label, a fixed sentence or a
 * template (SPEC §4.2). Its Chinese is always there, and it is assignable to `L10n`.
 */
export type Bilingual = { readonly en: string; readonly zh: string };

/** The `<html lang>` value of each language's pages, and of the Chinese text on an English page (SPEC §6, A.4). */
export const HTML_LANG: Record<Lang, string> = { en: "en", zh: "zh-Hant-TW" };

/** The Open Graph `locale` of each language's pages (SPEC §6, Metadata). */
export const OG_LOCALE: Record<Lang, string> = { en: "en_US", zh: "zh_TW" };

/** Each language's name in its own language: the language switch reads "English · 中文" (SPEC §7). */
export const LANGUAGE_NAME: Record<Lang, string> = { en: "English", zh: "中文" };

/**
 * The text of `value` in `lang`. A Chinese page shows the English text of a string whose `zh` is null
 * (SPEC §6), so callers that mark it up ask `shownLang()` and wrap that text in `<span lang="en">`.
 */
export function t(value: L10n, lang: Lang): string {
  return lang === "zh" && value.zh !== null ? value.zh : value.en;
}

/** The language `t(value, lang)` is actually in: "zh" only on a Chinese page and when `value.zh` is set. */
export function shownLang(value: L10n, lang: Lang): Lang {
  return lang === "zh" && value.zh !== null ? "zh" : "en";
}

// ── Paths (SPEC §6) ──────────────────────────────────────────────────────────────────────────────

/** The path prefix of the Chinese route group: `/zh` is the Chinese Today page, `/zh/findings/<id>` a finding. */
const ZH_ROOT = "/zh";

/**
 * A site path starts with exactly one slash (`//host` and `/\host` are another site to a browser) and holds no
 * whitespace or control character (a browser drops a tab or a line break from a URL, which could turn `/<tab>/host`
 * into `//host`). A space is written `%20`.
 */
const SITE_PATH_RE = /^\/(?![/\\])[^\s\u0000-\u001f\u007f]*$/;

function sitePath(path: string): string {
  if (!SITE_PATH_RE.test(path)) throw new Error(`Not a site path: ${JSON.stringify(path)}`);
  return path;
}

/** Splits a site path into its pathname and what follows it (`?query` and `#fragment`, kept as written). */
function splitPath(path: string): [pathname: string, rest: string] {
  const i = path.search(/[?#]/);
  return i < 0 ? [path, ""] : [path.slice(0, i), path.slice(i)];
}

/** `/zh` and every path under it; never `/zhang`. */
function isChinesePathname(pathname: string): boolean {
  return pathname === ZH_ROOT || pathname.startsWith(`${ZH_ROOT}/`);
}

/** The language of a site path: Chinese under `/zh`, else English. Throws on anything but a site path. */
export function langOfPath(path: string): Lang {
  return isChinesePathname(splitPath(sitePath(path))[0]) ? "zh" : "en";
}

/**
 * The path of the page that `path` names, in `lang` (SPEC §6): `/findings/x` and `/zh/findings/x` give
 * `/zh/findings/x` for "zh" and `/findings/x` for "en", `/` and `/zh` give each other, and the query and
 * fragment stay as written (`/glossary#virtual-unwrapping`). The language switch and the main tab row link
 * through it, so a path of either language maps to the same page. It is for a route, never a share preview:
 * the `/og/…` images hold no language-specific text (SPEC §7) and have no `/zh` twin. Throws on anything
 * but a site path (a relative path, a URL, `//host`, whitespace); slashes and backslashes that the `/zh`
 * prefix leaves at the start collapse to one slash, so no result is protocol-relative.
 */
export function hrefFor(lang: Lang, path: string): string {
  const [pathname, rest] = splitPath(sitePath(path));
  const stripped = isChinesePathname(pathname) ? pathname.slice(ZH_ROOT.length) : pathname;
  const english = (stripped === "" ? "/" : stripped).replace(/^[/\\]{2,}/, "/");
  if (lang === "en") return `${english}${rest}`;
  return `${english === "/" ? ZH_ROOT : `${ZH_ROOT}${english}`}${rest}`;
}

/** One side of the masthead's language switch (SPEC §7): the current language is marked, the other links. */
export interface LanguageSwitchEntry {
  lang: Lang;
  /** The language's own name: "English", "中文". */
  label: string;
  /** The same page in that language: `hrefFor(lang, path)`. */
  href: string;
  /** True for the language of `path` itself. */
  current: boolean;
}

/**
 * The language switch's pairs for the page at `path` (what `usePathname()` gives), English first: the
 * current one marked, each with the same page's path in its language. Throws on anything but a site path.
 */
export function languageSwitch(path: string): LanguageSwitchEntry[] {
  const current = langOfPath(path);
  return LANGS.map((lang) => ({ lang, label: LANGUAGE_NAME[lang], href: hrefFor(lang, path), current: lang === current }));
}

/**
 * A page's `alternates.languages` (SPEC §6): its path in each language, keyed by the `<html lang>` value
 * Next.js writes as `hreflang`. Throws on anything but a site path.
 */
export function alternateLanguages(path: string): { en: string; "zh-Hant-TW": string } {
  return { en: hrefFor("en", path), "zh-Hant-TW": hrefFor("zh", path) };
}
