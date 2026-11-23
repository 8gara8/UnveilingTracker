// Every fixed string of the site in both languages (SPEC §6 Routes, §7 Components), keyed, with `pageText(key, lang)` to pick
// one, and the strings that carry a value (a date, a count, a name) as functions that return both languages. The site has no
// i18n library: a page reads its words here, from lib/vocab.ts (a vocabulary's labels and the fixed notices) or from an `L10n`
// value a model wrote (SPEC §6). The Chinese is Taiwan usage, set by routine/STYLE-ZH.md and checked by tests/page-text.test.ts
// with the checks of lib/zh.ts (ZH_TRADITIONAL, ZH_AVOID, ZH_NO_DASH, SPEC §4.12) and the English dash rule (NO_EM_DASH).
//
// Not here: a vocabulary's labels, the fixed notices and `END_LINE` (lib/vocab.ts), the Pace sentence with its stale and missing
// forms (lib/metrics/pace.ts), the tagline, a counter's label and unit, a marker's label (config/), the chat edition's lines
// (lib/chat.ts), a source's "Paper, Nature" line (lib/sources.ts) and every URL (lib/site.ts builds them). So that the file stays
// pure, it reads no config and no clock: the site name, the stale hour and every date are arguments.
//
// Every function returns a `Bilingual`; a component picks the language with `t()` of lib/i18n.ts. The lookup is `pageText`, not
// `t`, since lib/i18n.ts already exports `t()`. Pieces of text that a model wrote (a title, a quote, a name) are arguments and stay
// as written; a Chinese string puts one space between them and a Han character (STYLE-ZH.md §4), which `spaced()` does.
//
// Cyber's lib/page-text.ts at the fork commit 3ced1fb, adapted: Cyber's file builds the counted text of its pages and is English
// only, so only the idea survives (a pure module of fixed strings and typed builders, read by the pages and by the tests); the keyed
// table, the second language and every string are this project's (docs/PROVENANCE.md).

import { weekday } from "./dates";
import { longDate, shortDate, taipeiTime, zhDate } from "./format";
import type { Bilingual, Lang } from "./i18n";
import { fmtInt } from "./metrics/stats";
import { ladderIndex } from "./rungs";
import type { WhyToday } from "./schema/brief";
import type { FigureLicence } from "./schema/common";
import type { CorrectionType, ReportStatus } from "./schema/misc";
import {
  EDITION_INFO, ENGLISH_ONLY_LABEL, FORMAT_INFO, RUNGS, RUNG_INFO, SIGNIFICANCE_INFO, type Edition, type Rung, type Significance,
} from "./vocab";

/** A fresh `{ en, zh }` of a vocabulary label (FORMAT_INFO's entries carry a weekday too). */
const of = (label: Bilingual): Bilingual => ({ en: label.en, zh: label.zh });

const CHECKED = RUNG_INFO.checked;
const DISPUTED = RUNG_INFO.disputed;
const RETRACTED = RUNG_INFO.retracted;

// ── The table ────────────────────────────────────────────────────────────────────────────────────

/**
 * Every fixed string, by key (`group.name`). The English that the spec quotes is exactly as the spec writes it; the Chinese is the
 * seed of this project (JL may change any of it by PR, as for the vocabulary labels, SPEC §4.2). A string that carries a value is
 * a function below, not an entry here.
 */
export const PAGE_TEXT = {
  // The main tab row (§7 Masthead), in the order the spec lists it, and the rows' labels.
  "nav.today": { en: "Today", zh: "今日" },
  "nav.ledger": { en: "Ledger", zh: "發現紀錄" },
  "nav.trends": { en: "Trends", zh: "趨勢" },
  "nav.glossary": { en: "Glossary", zh: "名詞解釋" },
  "nav.didntHoldUp": { en: "What didn't hold up", zh: "經不起檢驗的發現" },
  "nav.archive": { en: "Archive", zh: "往期簡報" },
  "nav.methodology": { en: "Methodology", zh: "方法說明" },
  "nav.about": { en: "About", zh: "關於本站" },
  "nav.main": { en: "Main", zh: "主要選單" },
  "nav.trackers": { en: "Trackers", zh: "追蹤站" },
  "nav.language": { en: "Language", zh: "語言" },
  "nav.skip": { en: "Skip to the main content", zh: "跳到主要內容" },

  // The sibling tab row (§7 Masthead): names are the same in both languages, as on the siblings' own sites.
  "siblings.me": { en: "ME", zh: "ME" },
  "siblings.europe": { en: "Europe", zh: "Europe" },
  "siblings.cyber": { en: "Cyber", zh: "Cyber" },
  "siblings.unveiling": { en: "Unveiling", zh: "Unveiling" },

  // The footer (§7 Footer) and the sample banner (§7, Cyber's wording).
  "footer.written": {
    en: "Written each morning by Claude, Anthropic's AI, without human review. Numbers are computed by scripts.",
    zh: "每天早上由 Anthropic 的 AI Claude 撰寫，未經人工審核。數字由程式計算。",
  },
  "footer.credits": { en: "Data credits", zh: "資料來源與致謝" },
  "footer.repo": { en: "Code and data on GitHub", zh: "GitHub 上的程式碼與資料" },
  "footer.rss": { en: "RSS", zh: "RSS" },
  "banner.sample": { en: "Preview data, not the published brief", zh: "預覽資料，並非正式發布的簡報" },

  // The empty states of §6's route table (the home page's is `noEditionYet()`), and the 404 page.
  "empty.ledger": { en: "No findings yet.", zh: "目前還沒有任何發現。" },
  "empty.trends": { en: "The Pace history is not available yet.", zh: "進度的歷史資料目前還無法取得。" },
  "empty.glossary": { en: "No terms yet.", zh: "目前還沒有任何名詞。" },
  "empty.didntHoldUp": { en: "Nothing has fallen yet.", zh: "目前還沒有任何發現經不起檢驗。" },
  "empty.archive": { en: "No editions yet.", zh: "目前還沒有任何一期簡報。" },
  "notFound.title": { en: "Not found", zh: "找不到頁面" },
  "notFound.body": { en: "There is no page here.", zh: "這裡沒有這個頁面。" },
  "notFound.link": { en: "Browse the archive", zh: "瀏覽往期簡報" },

  // BriefView's sections, in page order (§7). The deep dive's and the review's titles are the formats' own labels.
  "brief.lead": { en: "Lead", zh: "導言" },
  "brief.story": { en: "Story of the day", zh: "今日焦點" },
  "brief.more": { en: "More", zh: "更多發現" },
  "brief.climbedOrFell": { en: "Climbed or fell", zh: "層級升降" },
  "brief.ideas": { en: "Ideas and debate", zh: "想法與討論" },
  "brief.also": { en: "Also noted", zh: "另外值得一提" },
  "brief.deepDive": of(FORMAT_INFO.sunday_deep_dive),
  "brief.review": of(FORMAT_INFO.monday_review),
  "brief.corrections": { en: "Corrections", zh: "更正" },
  "brief.sources": { en: "Sources", zh: "來源" },
  "brief.otherEditions": { en: "Other editions", zh: "其他期別" },
  "brief.newer": { en: "Newer edition", zh: "較新的一期" },
  "brief.older": { en: "Older edition", zh: "較舊的一期" },

  // The Monday review's parts (§7 BriefView).
  "review.bigPicture": { en: "The big picture", zh: "整體概況" },
  "review.remarkable": { en: "Most remarkable", zh: "本週最引人注目" },
  "review.charts": { en: "The charts", zh: "圖表" },
  "review.fieldCounts": { en: "Findings by field", zh: "各領域的發現數" },
  "review.countedNote": {
    en: `Reported: first briefed this week. Counted: not a setback, and now ${CHECKED.en} or higher.`,
    zh: `報導：本週首次刊出。計入：不屬於挫折，且目前已達「${CHECKED.zh}」或更高層級。`,
  },
  "review.fell": { en: "What didn't hold up this week", zh: "本週經不起檢驗的發現" },
  "review.against": { en: "Strongest evidence against", zh: "最有力的反面證據" },

  // FindingBlock and the finding's own page (§7 FindingBlock, FindingPage).
  "finding.readFull": { en: "Read the full explainer", zh: "閱讀完整解說" },
  "finding.back": { en: "Back with new facts", zh: "有新進展，再度報導" },
  "finding.report": {
    en: "Report an error (opens GitHub, needs a free GitHub account)",
    zh: "回報錯誤（會開啟 GitHub，需要免費的 GitHub 帳號）",
  },
  "finding.howSureFull": { en: "How sure we are, in full", zh: "我們有多確定：完整說明" },
  "finding.ladderHistory": { en: "Verification history", zh: "查證歷程" },
  "finding.aiEvidence": { en: "What shows the AI role", zh: "AI 角色的依據" },
  "finding.fromClaimant": { en: "From the maker or a lab that benefits", zh: "出自開發者或從中受益的實驗室" },
  "finding.reactions": { en: "Reactions", zh: "學者回應" },
  "finding.sinceThen": { en: "Since then", zh: "後續進展" },
  "finding.corrections": { en: "Corrections", zh: "更正" },
  "finding.reports": { en: "Reports", zh: "讀者回報" },
  "finding.terms": { en: "Terms", zh: "名詞" },
  "finding.related": { en: "Related findings", zh: "相關發現" },
  "finding.who": { en: "Who did the work", zh: "誰做了這項研究" },
  "finding.briefs": { en: "Reported in these editions", zh: "報導過這項發現的簡報" },
  "finding.share": { en: "Share link", zh: "分享連結" },

  // The figure's caption pieces and the licences a figure may carry (§4.3 `FIGURE_LICENCE`, §7 FigureBlock).
  "figure.credit": { en: "Credit", zh: "圖片出處" },
  "figure.licence": { en: "Licence", zh: "授權" },
  "licence.ccBy4": { en: "CC BY 4.0", zh: "CC BY 4.0" },
  "licence.ccBySa4": { en: "CC BY-SA 4.0", zh: "CC BY-SA 4.0" },
  "licence.cc0": { en: "CC0 1.0", zh: "CC0 1.0" },
  "licence.publicDomain": { en: "Public domain", zh: "公有領域" },

  // Ideas and debate, rung changes and the deep dive (§7).
  "ideas.unscored": { en: "Unscored: arguments, not findings", zh: "未評級：是論點，不是發現" },
  "change.byScript": { en: "(script)", zh: "（程式判定）" },
  "deepdive.whyLabel": { en: "Why today", zh: "為什麼選在今天" },
  "deepdive.why.news": { en: "New this week", zh: "本週新進展" },
  "deepdive.why.anniversary": { en: "Anniversary", zh: "週年紀念" },
  "deepdive.why.rotation": { en: "From the Ledger", zh: "取自發現紀錄" },

  // The Ledger's facets (§6 `/ledger/[facet]/[value]`) and the page of what fell.
  "ledger.browse": { en: "Browse by", zh: "瀏覽方式" },
  "ledger.all": { en: "All findings", zh: "全部發現" },
  "facet.field": { en: "Field", zh: "領域" },
  "facet.rung": { en: "Rung", zh: "層級" },
  "facet.role": { en: "AI role", zh: "AI 角色" },
  "facet.year": { en: "Year", zh: "年份" },
  "fell.intro": {
    en: `Findings now ${DISPUTED.en} or ${RETRACTED.en}, newest change first.`,
    zh: `目前被列為「${DISPUTED.zh}」或「${RETRACTED.zh}」的發現，最新變動排在最前面。`,
  },
  "fell.happened": { en: "What happened", zh: "發生了什麼事" },

  // The charts (§7 Charts): A, B (its label is the spec's), C, D and the counters.
  "charts.a": { en: "AI in leading journals", zh: "主要期刊中的 AI" },
  "charts.b": { en: "All papers: adoption, not discovery", zh: "所有論文：衡量的是採用程度，不是發現" },
  "charts.c": { en: "AI's share of the Landmarks", zh: "里程碑發現中的 AI 比例" },
  "charts.d": { en: "The Hold rate", zh: "經得起檢驗的比率" },
  "charts.counters": { en: "Counters", zh: "累計數字" },
  "charts.baseline": { en: "Pre-AI baseline: 2015 to 2019", zh: "AI 出現前的基準：2015 至 2019 年" },
  "charts.provisional": { en: "provisional", zh: "暫定" },
  "charts.provisionalNote": {
    en: "Provisional weeks: OpenAlex is still adding papers to them.",
    zh: "暫定週：OpenAlex 仍在補入這幾週的論文。",
  },
  "charts.monthly": { en: "Monthly", zh: "按月" },
  "charts.weekly": { en: "Weekly, newest 52 weeks", zh: "按週，最近 52 週" },
  "charts.noPapers": { en: "no papers", zh: "沒有論文" },
  "charts.tooFew": { en: "too few to judge yet", zh: "案例太少，尚無法判斷" },
  "charts.withAi": { en: "With an AI role", zh: "有 AI 角色" },
  "charts.withoutAi": { en: "Without an AI role", zh: "無 AI 角色" },
  "charts.held": { en: "Held up", zh: "經得起檢驗" },
  "charts.fell": { en: "Fell", zh: "經不起檢驗" },
  "charts.open": { en: "Still open", zh: "尚未定論" },

  // CounterRows (§7 Charts, §5.7): the breakdown keys `1`, `2`, `3`, `approved` and `total` take these labels.
  "counters.source": { en: "Source", zh: "來源" },
  "counters.stale": { en: "Showing the last reading", zh: "顯示上一次的讀數" },
  "counters.missing": { en: "No reading yet", zh: "尚無讀數" },
  "counters.phase1": { en: "Phase 1", zh: "臨床第 1 期" },
  "counters.phase2": { en: "Phase 2", zh: "臨床第 2 期" },
  "counters.phase3": { en: "Phase 3", zh: "臨床第 3 期" },
  "counters.approved": { en: "Approved", zh: "已核准" },
  "counters.total": { en: "Total", zh: "總計" },

  // The Glossary, Methodology and About pages (§6): their headings. Their prose is the pages' own.
  "glossary.firstUsed": { en: "First used in", zh: "首次出現於" },
  "methodology.written": { en: "How the brief is written", zh: "簡報的寫作規則" },
  "methodology.pace": { en: "How the Pace is measured", zh: "進度的計算方式" },
  "methodology.versions": { en: "Config versions", zh: "設定版本" },
  "methodology.journals": { en: "Journals counted", zh: "納入計算的期刊" },
  "methodology.phrases": { en: "AI phrases counted", zh: "納入計算的 AI 用語" },
  "methodology.ladder": { en: "The Verification Ladder", zh: "查證階梯" },
  "methodology.roles": { en: "AI roles", zh: "AI 角色" },
  "methodology.primary": { en: "Primary sources only", zh: "只引用原始來源" },
  "methodology.allowlist": { en: "Where primary sources come from", zh: "原始來源的範圍" },
  "methodology.feeds": { en: "Feed status, last 14 days", zh: "資料來源狀態，最近 14 天" },
  "methodology.corrections": { en: "Corrections log", zh: "更正紀錄" },
  "about.who": { en: "Who writes it", zh: "誰負責撰寫" },
  "about.how": { en: "How it is made", zh: "製作方式" },
  "about.credits": { en: "Data credits", zh: "資料來源與致謝" },
  "about.report": { en: "How to report an error", zh: "如何回報錯誤" },
  "about.reports": { en: "Reports and their status", zh: "回報與處理狀態" },

  // A correction's banner pieces (§4.10, §7) and a reader report's status (§4.10).
  "correction.corrected": { en: "Corrected", zh: "已更正" },
  "correction.clarified": { en: "Clarified", zh: "已釐清" },
  "correction.updated": { en: "Updated", zh: "已更新" },
  "correction.removed": { en: "Text removed", zh: "已移除文字" },
  "correction.source": { en: "Source", zh: "來源" },
  "correction.now": { en: "now", zh: "現為" },
  "correction.refiled": {
    en: "This changes how the finding is filed and counted from this date.",
    zh: "從這一天起，這項發現的歸類與計數隨之改變。",
  },
  "report.open": { en: "Open", zh: "待查核" },
  "report.upheld": { en: "Upheld", zh: "成立" },
  "report.rejected": { en: "Rejected", zh: "不成立" },
} as const satisfies Record<string, Bilingual>;

export type PageTextKey = keyof typeof PAGE_TEXT;

/** Every key of `PAGE_TEXT`, in the order the table writes them. */
export const PAGE_TEXT_KEYS = Object.keys(PAGE_TEXT) as PageTextKey[];

/**
 * The fixed string `key` in `lang`. Throws on a key that is not in the table or a language that is not `en` or `zh`, so a typo
 * in a caller that TypeScript does not check fails loudly instead of printing "undefined".
 */
export function pageText(key: PageTextKey, lang: Lang): string {
  if (!Object.hasOwn(PAGE_TEXT, key)) throw new RangeError(`Unknown page text key: ${String(key)}`);
  if (lang !== "en" && lang !== "zh") throw new RangeError(`Unknown language: ${String(lang)}`);
  return PAGE_TEXT[key][lang];
}

/** The main tab row, in order (§7 Masthead): each tab's label key and the English path that `hrefFor(lang, path)` maps. */
export const MAIN_TABS = [
  { key: "nav.today", path: "/" },
  { key: "nav.ledger", path: "/ledger" },
  { key: "nav.trends", path: "/trends" },
  { key: "nav.glossary", path: "/glossary" },
  { key: "nav.didntHoldUp", path: "/didnt-hold-up" },
  { key: "nav.archive", path: "/archive" },
  { key: "nav.methodology", path: "/methodology" },
  { key: "nav.about", path: "/about" },
] as const satisfies readonly { readonly key: PageTextKey; readonly path: string }[];

/**
 * The sibling tab row, in order (§7 Masthead): ME, Europe, Cyber, then this site, the current one marked. `id` is the key of
 * `config/run.json` `siblings` that holds the link (this site's own tab links to `/`).
 */
export const SIBLING_TABS = [
  { id: "me", key: "siblings.me" },
  { id: "europe", key: "siblings.europe" },
  { id: "cyber", key: "siblings.cyber" },
  { id: "unveiling", key: "siblings.unveiling" },
] as const satisfies readonly { readonly id: string; readonly key: PageTextKey }[];

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────

const ENDS_IN_LATIN_OR_DIGIT = /[\p{Script=Latin}\p{Nd}]$/u;

/**
 * `name` then `han`, Chinese text that starts with a Han character: one space between them where `name` ends in a Latin letter or
 * a digit, none otherwise (STYLE-ZH.md §4). For a name that a model or a feed wrote, which may end in either script.
 */
function beforeHan(name: string, han: string): string {
  return ENDS_IN_LATIN_OR_DIGIT.test(name) ? `${name} ${han}` : `${name}${han}`;
}

/** A count: a whole number that a double holds exactly, 0 or more; grouped with commas from 1,000 as `fmtInt()` writes it. */
function count(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`A count is a whole number, 0 or more, got ${n}`);
  return fmtInt(n);
}

/** `text` without the white space around it; throws when nothing is left. */
function needText(text: string, what: string): string {
  const trimmed = text.trim();
  if (trimmed === "") throw new RangeError(`${what} must not be blank`);
  return trimmed;
}

/** "7 Nov 2026, 05:12 Taipei" and 「2026 年 11 月 7 日 05:12（台北時間）」: an edition's date with the time it was published. */
function stamp(date: string, publishedAt: string): Bilingual {
  const time = taipeiTime(publishedAt);
  return { en: `${shortDate(date)}, ${time} Taipei`, zh: `${zhDate(date)} ${time}（台北時間）` };
}

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ZH_WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"] as const;

// ── Titles and descriptions (§6 Metadata) ────────────────────────────────────────────────────────

/** A page's `<title>` and Open Graph title (§6): `<page> · <site name>`, the page name in the page's language. Throws on a blank page name. */
export function pageTitle(page: string, siteName: string): string {
  return `${needText(page, "A page name")} · ${needText(siteName, "The site name")}`;
}

/**
 * A page's description (§6): the first sentence that its text gives (a finding's "What was found", an edition's Lead), else the
 * tagline. `first` is that sentence, already cut (lib/text.ts `splitSentences()`); null, undefined or only spaces gives the tagline.
 */
export function metaDescription(first: string | null | undefined, tagline: string): string {
  const sentence = first?.trim();
  return sentence ? sentence : needText(tagline, "The tagline");
}

// ── The page frame (§7) ──────────────────────────────────────────────────────────────────────────

/**
 * The home page's empty state (§6): "No edition yet. Each morning's brief is ready before 08:00 Taipei." `staleAfter` is
 * `config/run.json` `schedule.stale_after` ("HH:MM"); throws on anything else.
 */
export function noEditionYet(staleAfter: string): Bilingual {
  if (!HHMM.test(staleAfter)) throw new RangeError(`Not a time of day (HH:MM): ${JSON.stringify(staleAfter)}`);
  return {
    en: `No edition yet. Each morning's brief is ready before ${staleAfter} Taipei.`,
    zh: `還沒有任何一期簡報。每天早上的簡報會在台北時間 ${staleAfter} 前準備好。`,
  };
}

/**
 * The stale banner's text (§7, Cyber's wording with the zone named): "Not updated today. Last edition: 7 Nov 2026, 05:12 Taipei".
 * `lastDate` is the newest valid brief's date and `lastPublishedAt` its `published_at`; the time is Taipei's, whatever the reader's zone.
 */
export function staleBanner(lastDate: string, lastPublishedAt: string): Bilingual {
  const at = stamp(lastDate, lastPublishedAt);
  return { en: `Not updated today. Last edition: ${at.en}`, zh: `今天還沒有更新。最新一期：${at.zh}` };
}

/** The footer's last-updated time (§7 Footer): "Last updated: 7 Nov 2026, 05:12 Taipei", from the newest brief as `staleBanner()` reads it. */
export function lastUpdated(lastDate: string, lastPublishedAt: string): Bilingual {
  const at = stamp(lastDate, lastPublishedAt);
  return { en: `Last updated: ${at.en}`, zh: `最後更新：${at.zh}` };
}

/**
 * An edition's Taipei date as its title and the archive write it: "Sunday 8 November 2026" and 「2026 年 11 月 8 日（週日）」.
 * Throws on a date that does not exist.
 */
export function longDateText(date: string): Bilingual {
  return { en: longDate(date), zh: `${zhDate(date)}（週${ZH_WEEKDAY[weekday(date)]}）` };
}

/**
 * The masthead's edition time (§7): "Published 04:12 Taipei", with " (late)" for an edition published after `schedule.stale_after`
 * (a brief's `late`); `timestamp` is the brief's `published_at` and the time is Taipei's, whatever offset it is written in.
 */
export function editionTime(timestamp: string, late: boolean): Bilingual {
  const time = taipeiTime(timestamp);
  return {
    en: `Published ${time} Taipei${late ? " (late)" : ""}`,
    zh: `台北時間 ${time} 發布${late ? "（延遲）" : ""}`,
  };
}

// ── Counts and lines ─────────────────────────────────────────────────────────────────────────────

/** "1 finding", "3 findings", "0 findings": an edition's or a page's count (§6 Archive, Ledger). */
export function findingCount(n: number): Bilingual {
  return { en: `${count(n)} ${n === 1 ? "finding" : "findings"}`, zh: `${count(n)} 項發現` };
}

/** The archive's line (§6): "10 editions, newest first." ("1 edition, newest first."). */
export function editionsLine(n: number): Bilingual {
  return { en: `${count(n)} ${n === 1 ? "edition" : "editions"}, newest first.`, zh: `共 ${count(n)} 期簡報，由新到舊。` };
}

/** The Ledger's line (§6): "128 findings, newest first, grouped by year." */
export function ledgerLine(n: number): Bilingual {
  return {
    en: `${count(n)} ${n === 1 ? "finding" : "findings"}, newest first, grouped by year.`,
    zh: `共 ${count(n)} 項發現，由新到舊，依年份分組。`,
  };
}

/** One field's counts in the Monday review (§7, §4.5): `<n> reported, <m> counted` and 「報導 <n> 項，計入 <m> 項」. */
export function fieldCount(reported: number, counted: number): Bilingual {
  return { en: `${count(reported)} reported, ${count(counted)} counted`, zh: `報導 ${count(reported)} 項，計入 ${count(counted)} 項` };
}

/** The sources list's summary (§7 BriefView, the collapsed `<details>`): "Sources (12)". */
export function sourcesSummary(n: number): Bilingual {
  return { en: `Sources (${count(n)})`, zh: `來源（${count(n)}）` };
}

/**
 * An edition's kind as the archive writes it (§6): its label, then "English-only" when `languages.zh` is false (§4.5):
 * "Full", "Partial, English-only".
 */
export function editionLabel(edition: Edition, englishOnly: boolean): Bilingual {
  const kind = EDITION_INFO[edition];
  if (!englishOnly) return of(kind);
  return { en: `${kind.en}, ${ENGLISH_ONLY_LABEL.en}`, zh: `${kind.zh}，${ENGLISH_ONLY_LABEL.zh}` };
}

const WHY_KEY = {
  news: "deepdive.why.news",
  anniversary: "deepdive.why.anniversary",
  rotation: "deepdive.why.rotation",
} as const satisfies Record<WhyToday, PageTextKey>;

const LICENCE_KEY = {
  "CC-BY-4.0": "licence.ccBy4",
  "CC-BY-SA-4.0": "licence.ccBySa4",
  "CC0-1.0": "licence.cc0",
  "public-domain": "licence.publicDomain",
} as const satisfies Record<FigureLicence, PageTextKey>;

const CORRECTION_KEY = {
  correction: "correction.corrected",
  clarification: "correction.clarified",
  update: "correction.updated",
  removed: "correction.removed",
} as const satisfies Record<CorrectionType, PageTextKey>;

const REPORT_KEY = {
  open: "report.open",
  upheld: "report.upheld",
  rejected: "report.rejected",
} as const satisfies Record<ReportStatus, PageTextKey>;

// ── Chips and findings (§7) ──────────────────────────────────────────────────────────────────────

/**
 * The LadderBar's accessible name (§7): "Verification: Checked (3 of 5)" and 「查證：已查核（第 3 階，共 5 階）」; for Disputed and
 * Retracted, which are off the ladder, the rung alone: "Verification: Disputed".
 */
export function ladderName(rung: Rung): Bilingual {
  const label = RUNG_INFO[rung];
  const at = ladderIndex(rung);
  if (at === null) return { en: `Verification: ${label.en}`, zh: `查證：${label.zh}` };
  return {
    en: `Verification: ${label.en} (${at + 1} of ${RUNGS.length})`,
    zh: `查證：${label.zh}（第 ${at + 1} 階，共 ${RUNGS.length} 階）`,
  };
}

/** The significance chip's words (§7, A.3): `●●●○ MAJOR` and 「●●●○ 重大」; the words are always shown with the pips. */
export function significanceChip(significance: Significance): Bilingual {
  const level = SIGNIFICANCE_INFO[significance];
  return { en: `${level.pips} ${level.en.toUpperCase()}`, zh: `${level.pips} ${level.zh}` };
}

/**
 * The AI chip's maker (§7, A.3): "claimed by Google DeepMind". Only for confidence `claimed` with a named system; throws on a blank
 * maker, since a chip with no named system leaves this part out.
 */
export function claimedBy(maker: string): Bilingual {
  const name = needText(maker, "A maker");
  return { en: `claimed by ${name}`, zh: beforeHan(name, "自稱") };
}

/** A rung change in words (§7 ClimbedOrFell, A.3): "Preprint → Checked" and 「預印本 → 已查核」. */
export function rungChange(from: Rung, to: Rung): Bilingual {
  return { en: `${RUNG_INFO[from].en} → ${RUNG_INFO[to].en}`, zh: `${RUNG_INFO[from].zh} → ${RUNG_INFO[to].zh}` };
}

/** Who made an Ideas and debate line's argument (§7 IdeasAndDebate): "Argued by Ada Lovelace". Throws on a blank name. */
export function argumentBy(who: string): Bilingual {
  const name = needText(who, "A name");
  return { en: `Argued by ${name}`, zh: `論點提出者：${name}` };
}

/** A reaction's author and place (§7 FindingPage): "Ada Lovelace, University of London". Throws on a blank name or place. */
export function reactionLine(who: string, affiliation: string): Bilingual {
  const name = needText(who, "A name");
  const place = needText(affiliation, "An affiliation");
  return { en: `${name}, ${place}`, zh: `${name}，${place}` };
}

/** The deep dive's reason for today (§7 DeepDive): "New this week", "Anniversary" or "From the Ledger". */
export function whyToday(why: WhyToday): Bilingual {
  return of(PAGE_TEXT[WHY_KEY[why]]);
}

/** A correction's type word on its banner (§4.10, §7): "Corrected", "Clarified", "Updated" or "Text removed". */
export function correctionWord(type: CorrectionType): Bilingual {
  return of(PAGE_TEXT[CORRECTION_KEY[type]]);
}

/** A reader report's status as a finding's page shows it (§7 FindingPage): "Open", "Upheld" or "Rejected". */
export function reportStatus(status: ReportStatus): Bilingual {
  return of(PAGE_TEXT[REPORT_KEY[status]]);
}

/**
 * A figure's caption (§7 FigureBlock): "Credit: <credit> · Licence: CC BY 4.0". The credit stays as written; throws on a blank one,
 * since a figure is never shown without its credit and licence.
 */
export function figureCaption(credit: string, licence: FigureLicence): Bilingual {
  const name = needText(credit, "A figure's credit");
  const label = PAGE_TEXT[LICENCE_KEY[licence]];
  return {
    en: `${PAGE_TEXT["figure.credit"].en}: ${name} · ${PAGE_TEXT["figure.licence"].en}: ${label.en}`,
    zh: `${PAGE_TEXT["figure.credit"].zh}：${name} · ${PAGE_TEXT["figure.licence"].zh}：${label.zh}`,
  };
}

// ── The Ledger's facets (§6) ─────────────────────────────────────────────────────────────────────

/** The four facets of `/ledger/[facet]/[value]`. */
export type Facet = "field" | "rung" | "role" | "year";

/**
 * A year as a facet value or a counter's breakdown key shows it (§6, §7): "2026" and 「2026 年」. Takes the year as a number or as
 * four digits; throws on anything else.
 */
export function yearLabel(year: number | string): Bilingual {
  const digits = String(year);
  if (!/^\d{4}$/.test(digits)) throw new RangeError(`A year is four digits, got ${digits}`);
  return { en: digits, zh: `${digits} 年` };
}

/** A facet page's heading (§6): "Field: Biology and medicine" and 「領域：生物與醫學」. `value` is the value's label in both languages. */
export function facetHeading(facet: Facet, value: Bilingual): Bilingual {
  const name = PAGE_TEXT[`facet.${facet}`];
  return { en: `${name.en}: ${value.en}`, zh: `${name.zh}：${value.zh}` };
}

// ── The charts and counters (§7 Charts, §5) ──────────────────────────────────────────────────────

const BREAKDOWN_KEY: Readonly<Record<string, PageTextKey>> = {
  "1": "counters.phase1",
  "2": "counters.phase2",
  "3": "counters.phase3",
  approved: "counters.approved",
  total: "counters.total",
};

/**
 * A counter's breakdown key as CounterRows shows it (§7, §5.7): `1`, `2`, `3`, `approved` and `total` take their labels from the
 * table, a four-digit year key is that year, and any other key gives null.
 */
export function breakdownLabel(key: string): Bilingual | null {
  if (Object.hasOwn(BREAKDOWN_KEY, key)) return of(PAGE_TEXT[BREAKDOWN_KEY[key]!]);
  return /^\d{4}$/.test(key) ? yearLabel(key) : null;
}

/** A counter's date (§7 CounterRows): "as of 7 Nov 2026" and 「截至 2026 年 11 月 7 日」. */
export function counterAsOf(date: string): Bilingual {
  return { en: `as of ${shortDate(date)}`, zh: `截至 ${zhDate(date)}` };
}

/** A year's row of C and the baseline's totals: AI-role Landmarks (`ai`) among all Landmarks (`all`). */
export interface LandmarkTally {
  readonly ai: number;
  readonly all: number;
}

/**
 * C as counts (§5.5, §7): "5 of 9 in 2026 so far, against 4 of 46 in 2015 to 2019", never as a verdict. A tally of no Landmark reads
 * "no Landmarks in 2026 so far" or "no Landmarks in 2015 to 2019", and with neither, "no Landmarks in 2026 so far or in 2015 to 2019".
 * It ends without a full stop, to caption a bar.
 */
export function landmarkCompare(thisYear: LandmarkTally & { readonly year: number }, baseline: LandmarkTally): Bilingual {
  const year = yearLabel(thisYear.year).en;
  const none = thisYear.all === 0;
  const noneBefore = baseline.all === 0;
  if (none && noneBefore) return { en: `no Landmarks in ${year} so far or in 2015 to 2019`, zh: `${year} 年至今和 2015 至 2019 年都沒有里程碑發現` };
  const nowEn = none ? `no Landmarks in ${year} so far` : `${count(thisYear.ai)} of ${count(thisYear.all)} in ${year} so far`;
  const nowZh = none ? `${year} 年至今還沒有里程碑發現` : `${year} 年至今 ${count(thisYear.all)} 項中有 ${count(thisYear.ai)} 項`;
  const beforeEn = noneBefore ? "no Landmarks in 2015 to 2019" : `${count(baseline.ai)} of ${count(baseline.all)} in 2015 to 2019`;
  const beforeZh = noneBefore ? "2015 至 2019 年沒有里程碑發現" : `2015 至 2019 年為 ${count(baseline.all)} 項中有 ${count(baseline.ai)} 項`;
  return { en: `${nowEn}, against ${beforeEn}`, zh: `${nowZh}，${beforeZh}` };
}

/** D's counts (§5.6): the cases, and how many held, fell and are still open. */
export interface HoldTally {
  readonly cases: number;
  readonly held: number;
  readonly fell: number;
  readonly open: number;
}

/**
 * D's text summary for a screen reader (§7 Charts): "Of 23 AI claims first briefed at least 182 days ago, 15 held up, 3 fell and 5 are
 * still open." `afterDays` is `config/run.json` `pace.hold_after_days`. With no case it says so and what a case is.
 */
export function holdSummary(hold: HoldTally, afterDays: number): Bilingual {
  const days = count(afterDays);
  const ago = `${days} ${afterDays === 1 ? "day" : "days"} ago`;
  if (hold.cases === 0) {
    return {
      en: `No AI claims to judge yet. A case is a claim first briefed at least ${ago}.`,
      zh: `還沒有可判斷的 AI 說法。案例是指首次報導至少 ${days} 天的說法。`,
    };
  }
  const cases = count(hold.cases);
  return {
    en: `Of ${cases} AI ${hold.cases === 1 ? "claim" : "claims"} first briefed at least ${ago}, ${count(hold.held)} held up, `
      + `${count(hold.fell)} fell and ${count(hold.open)} ${hold.open === 1 ? "is" : "are"} still open.`,
    zh: `首次報導至少 ${days} 天的 ${cases} 項 AI 說法中，${count(hold.held)} 項經得起檢驗，${count(hold.fell)} 項經不起檢驗，`
      + `${count(hold.open)} 項尚未定論。`,
  };
}
