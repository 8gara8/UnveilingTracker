// Controlled vocabularies, their labels in both languages, the fixed strings and the safety lists
// (SPEC §4.2; §4.1 for ABBREVIATIONS, §4.4 for the two disclosure lists, §9.5 for BLOCKED_HOSTS). Methodology
// renders from these and routine/STYLE.md must agree with them; if the two differ, this file wins. Every
// vocabulary is a const tuple with its inferred type and an `_INFO` record of `{ en, zh }` labels, whose
// keys tests/vocab.test.ts keeps in step with the tuple; JL may change a Chinese label by PR (the seed is
// SPEC Appendix B). Page strings (SPEC §7) are in lib/page-text.ts, which comes later in P1, and the lists
// that live in config/ (SPEC §4.11) are never copied here.
//
// Cyber's lib/vocab.ts at the fork commit 3ced1fb, adapted: the idiom survives (tuples with their types,
// `_INFO` records, fixed strings as constants, BLOCKED_HOSTS with `blockedHostEntries()`, the canary
// constants), but every vocabulary is this project's, in both languages. `BLOCK_REASONS` drops
// `exploit_code` with its archives and code hosts and adds `shadow_library`; a fourth entry form, the
// label, joins the host, host/path and suffix entries (`blockedForm()`); `blockedEntry()` in lib/urls.ts
// matches all four.

import type { Bilingual, Lang } from "./i18n";

// ── Fields (SPEC §4.2, §4.3) ─────────────────────────────────────────────────────────────────────

export const FIELDS = ["mathematics", "physics", "chemistry", "biology", "earth", "social", "humanities"] as const;
export type FieldId = (typeof FIELDS)[number];
export const FIELD_INFO: Record<FieldId, Bilingual> = {
  mathematics: { en: "Mathematics", zh: "數學" },
  physics: { en: "Physics", zh: "物理" },
  chemistry: { en: "Chemistry and materials", zh: "化學與材料" },
  biology: { en: "Biology and medicine", zh: "生物與醫學" },
  earth: { en: "Earth and climate", zh: "地球與氣候" },
  social: { en: "Social science", zh: "社會科學" },
  humanities: { en: "Theology and humanities", zh: "神學與人文" },
};

/** The field codes, in `FIELDS` order: the first part of a finding id (`math-2026-0142`) and, upper-case, the glyph. */
export const FIELD_CODES = ["math", "phys", "chem", "bio", "earth", "soc", "hum"] as const;
export type FieldCode = (typeof FIELD_CODES)[number];
export const FIELD_CODE_OF = {
  mathematics: "math", physics: "phys", chemistry: "chem", biology: "bio", earth: "earth", social: "soc", humanities: "hum",
} as const satisfies Record<FieldId, FieldCode>;
export const FIELD_OF_CODE = {
  math: "mathematics", phys: "physics", chem: "chemistry", bio: "biology", earth: "earth", soc: "social", hum: "humanities",
} as const satisfies Record<FieldCode, FieldId>;

/**
 * The glyph a field shows (SPEC §4.2, A.3): its code in capitals (MATH, PHYS, CHEM, BIO, EARTH, SOC, HUM) in
 * English and in a share preview, and on a Chinese page its Chinese label.
 */
export function fieldGlyph(field: FieldId, lang: Lang): string {
  return lang === "zh" ? FIELD_INFO[field].zh : FIELD_CODE_OF[field].toUpperCase();
}

// ── Kinds ────────────────────────────────────────────────────────────────────────────────────────

export const KINDS = ["result", "capability", "check", "setback", "infrastructure", "policy_people", "idea"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_INFO: Record<Kind, Bilingual> = {
  result: { en: "Result", zh: "研究成果" },
  capability: { en: "Capability", zh: "能力進展" },
  check: { en: "Check", zh: "查證" },
  setback: { en: "Setback", zh: "挫折" },
  infrastructure: { en: "Infrastructure", zh: "基礎建設" },
  policy_people: { en: "Policy and people", zh: "政策與人物" },
  idea: { en: "Idea", zh: "想法" },
};
/** The kinds a finding may have: every kind but `idea`, which appears only as an Ideas and debate line (SPEC §4.2, §4.4). */
export const FINDING_KINDS = ["result", "capability", "check", "setback", "infrastructure", "policy_people"] as const satisfies readonly Kind[];
export type FindingKind = (typeof FINDING_KINDS)[number];

// ── The Verification Ladder (SPEC §4.2, §4.3) ────────────────────────────────────────────────────

/** The ladder's five rungs, lowest first. */
export const RUNGS = ["claimed", "preprint", "checked", "confirmed", "applied"] as const;
export type LadderRung = (typeof RUNGS)[number];
/** The two rungs a finding falls to: it then appears under What didn't hold up. */
export const FELL_RUNGS = ["disputed", "retracted"] as const;
export type FellRung = (typeof FELL_RUNGS)[number];
/** Every rung (SPEC §4.3's `Rung`): the ladder, then the two that fell. */
export const ALL_RUNGS = [...RUNGS, ...FELL_RUNGS] as const;
export type Rung = (typeof ALL_RUNGS)[number];
/** The labels of every rung, `RUNGS` and `FELL_RUNGS` alike (ZH_RUNG_LABEL reads the Chinese of either). */
export const RUNG_INFO: Record<Rung, Bilingual> = {
  claimed: { en: "Claimed", zh: "宣稱" },
  preprint: { en: "Preprint", zh: "預印本" },
  checked: { en: "Checked", zh: "已查核" },
  confirmed: { en: "Confirmed", zh: "已證實" },
  applied: { en: "Applied", zh: "已應用" },
  disputed: { en: "Disputed", zh: "有爭議" },
  retracted: { en: "Retracted", zh: "已撤稿" },
};
/** The rungs that count in any number (C, D, the field counts, the counters): only these. */
export const COUNTED_RUNGS = ["checked", "confirmed", "applied"] as const satisfies readonly LadderRung[];
export type CountedRung = (typeof COUNTED_RUNGS)[number];

// ── The AI role (SPEC §4.2, §4.3) ────────────────────────────────────────────────────────────────

export const AI_ROLES = ["ai_proposed", "ai_solved", "ai_ran", "ai_tool", "ai_checked", "none"] as const;
export type AiRole = (typeof AI_ROLES)[number];
export const AI_ROLE_INFO: Record<AiRole, Bilingual> = {
  ai_proposed: { en: "AI-proposed", zh: "AI 提出" },
  ai_solved: { en: "AI-solved", zh: "AI 解出" },
  ai_ran: { en: "AI-ran", zh: "AI 執行" },
  ai_tool: { en: "AI-tool", zh: "AI 工具" },
  ai_checked: { en: "AI-checked", zh: "AI 查核" },
  none: { en: "No AI role", zh: "無 AI 角色" },
};

/** Who backs the AI role; a finding with the role `none` has no confidence (null). */
export const AI_CONFIDENCE = ["confirmed", "claimed"] as const;
export type AiConfidence = (typeof AI_CONFIDENCE)[number];
export const AI_CONFIDENCE_INFO: Record<AiConfidence, Bilingual> = {
  confirmed: { en: "Confirmed", zh: "已證實" },
  claimed: { en: "Claimed by the lab", zh: "實驗室自稱" },
};

// ── Significance (SPEC §4.2, A.3) ────────────────────────────────────────────────────────────────

/** Highest first: Landmark, then Major, then Notable (the story pick, SPEC §4.12 STORY_PICK). */
export const SIGNIFICANCE = ["landmark", "major", "notable", "watch"] as const;
export type Significance = (typeof SIGNIFICANCE)[number];
/**
 * The pips (U+25CF filled, U+25CB empty) and the rank, 4 for Landmark to 1 for Watch. A chip always shows
 * the word with the pips: the English label in capitals (`●●●○ MAJOR`) or the Chinese label.
 */
export const SIGNIFICANCE_INFO: Record<Significance, Bilingual & { pips: string; rank: number }> = {
  landmark: { en: "Landmark", zh: "里程碑", pips: "●●●●", rank: 4 },
  major: { en: "Major", zh: "重大", pips: "●●●○", rank: 3 },
  notable: { en: "Notable", zh: "值得注意", pips: "●●○○", rank: 2 },
  watch: { en: "Watch", zh: "觀察中", pips: "●○○○", rank: 1 },
};

// ── Sources (SPEC §4.2, §4.3) ────────────────────────────────────────────────────────────────────

export const SOURCE_KINDS = ["paper", "preprint", "proof", "dataset", "registry", "statement", "lab_post", "checker", "reaction",
  "notice"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
/**
 * `means` is a short English gloss, lower case with no final period: the spec's own for eight kinds, and one
 * written for `preprint` and `dataset`. `isPrimary(url, kind)` (SPEC §4.11) judges each kind.
 */
export const SOURCE_KIND_INFO: Record<SourceKind, Bilingual & { means: string }> = {
  paper: { en: "Paper", zh: "論文", means: "peer-reviewed article or proceedings" },
  preprint: { en: "Preprint", zh: "預印本", means: "a paper posted publicly before peer review" },
  proof: { en: "Proof", zh: "形式證明", means: "a machine-checked proof file" },
  dataset: { en: "Dataset", zh: "資料集", means: "a published set of data" },
  registry: { en: "Registry entry", zh: "登錄紀錄", means: "a trial or structure record" },
  statement: { en: "Statement", zh: "官方聲明", means: "an institution's or a prize committee's own release" },
  lab_post: { en: "Lab post", zh: "實驗室文章", means: "a lab's own post about its own work" },
  checker: { en: "Checker's record", zh: "查核紀錄", means: "a recognised checker's record" },
  reaction: { en: "Reaction", zh: "學者回應", means: "a named scientist's own published reaction" },
  notice: { en: "Notice", zh: "撤稿、更正或關注聲明", means: "a retraction, correction or expression of concern" },
};

// ── Editions and formats (SPEC §4.2, §4.5) ───────────────────────────────────────────────────────

export const EDITIONS = ["full", "partial", "data_only"] as const;
export type Edition = (typeof EDITIONS)[number];
export const EDITION_INFO: Record<Edition, Bilingual> = {
  full: { en: "Full", zh: "完整版" },
  partial: { en: "Partial", zh: "不完整版" },
  data_only: { en: "Data-only", zh: "僅數據版" },
};
/** The English-only edition is a full or partial one with `languages.zh` false, not a value of `EDITIONS` (SPEC §4.5). */
export const ENGLISH_ONLY_LABEL: Bilingual = { en: "English-only", zh: "僅英文版" };

export const FORMATS = ["daily", "monday_review", "sunday_deep_dive"] as const;
export type Format = (typeof FORMATS)[number];
/** `weekday` is the day a format belongs to, as `weekday()` in lib/dates.ts numbers days (0 is Sunday); null for every other day. */
export const FORMAT_INFO: Record<Format, Bilingual & { weekday: number | null }> = {
  daily: { en: "Daily brief", zh: "每日簡報", weekday: null },
  monday_review: { en: "Week in review", zh: "一週回顧", weekday: 1 },
  sunday_deep_dive: { en: "Sunday deep dive", zh: "週日深度報導", weekday: 0 },
};

/** A brief's format from the weekday of its date (0 is Sunday, 6 is Saturday): Monday and Sunday have their own, every other day is daily. */
export function formatForWeekday(weekday: number): Format {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new RangeError(`Not a weekday: ${weekday}`);
  return FORMATS.find((f) => FORMAT_INFO[f].weekday === weekday) ?? "daily";
}

// ── Reader reports (SPEC §4.2, §9.2) ─────────────────────────────────────────────────────────────

export const REPORT_KINDS = ["fact", "source", "rung", "link", "dangerous"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_KIND_INFO: Record<ReportKind, Bilingual> = {
  fact: { en: "A fact or number is wrong", zh: "事實或數字有誤" },
  source: { en: "The source does not say this", zh: "來源沒有這樣說" },
  rung: { en: "The ladder rung or AI role is wrong", zh: "查證階梯的層級或 AI 角色有誤" },
  link: { en: "A link is broken or goes to the wrong page", zh: "連結失效或連到錯誤的頁面" },
  dangerous: { en: "It gives detail that could help cause harm", zh: "內容提供了可能被用來造成危害的細節" },
};
/** One option of the error-report form's dropdown, `en · zh` (SPEC §9.2); `parseReportForm()` maps it back by its English part. */
export function reportFormOption(kind: ReportKind): string {
  return `${REPORT_KIND_INFO[kind].en} · ${REPORT_KIND_INFO[kind].zh}`;
}
/** The form's options in `REPORT_KINDS` order; .github/ISSUE_TEMPLATE/error-report.yml must use exactly these. */
export const REPORT_FORM_OPTIONS: readonly string[] = REPORT_KINDS.map(reportFormOption);

// ── The explainer (SPEC §4.2, §4.4) ──────────────────────────────────────────────────────────────

/** The six parts, in order: the story shows all six, an item the first four (`ITEM_PARTS`); then Go deeper. */
export const EXPLAINER_PARTS = ["found", "matters", "ai_helped", "how_sure", "background", "could_lead"] as const;
export type ExplainerPart = (typeof EXPLAINER_PARTS)[number];
export const EXPLAINER_PART_INFO: Record<ExplainerPart, Bilingual> = {
  found: { en: "What was found", zh: "發現了什麼" },
  matters: { en: "Why it matters", zh: "為什麼重要" },
  ai_helped: { en: "How AI helped", zh: "AI 怎麼幫忙" },
  how_sure: { en: "How sure we are", zh: "我們有多確定" },
  background: { en: "Background", zh: "背景" },
  could_lead: { en: "What it could lead to", zh: "可能帶來什麼" },
};
/** The parts an item (a finding that is not the story of the day) shows in a brief: the first four. */
export const ITEM_PARTS = ["found", "matters", "ai_helped", "how_sure"] as const satisfies readonly ExplainerPart[];
/** The label that follows the six parts: the finding's primary sources. */
export const GO_DEEPER_LABEL: Bilingual = { en: "Go deeper", zh: "延伸閱讀" };

// ── The finding paths that hold one id of a vocabulary (SPEC §4.5, §4.6, §4.10) ──────────────────

/**
 * The finding paths whose value is one id of a vocabulary above, each with that vocabulary's ids. A correction's
 * `after` at one of them is an id: kept as the id in `en`, printed as its fixed label in the page's language, and
 * never sent to the Chinese pass. A `kind` is never `idea`. `rung` is not here, since a rung changes only through a
 * new dated entry (SPEC §5.8), and `subfield`'s ids are in config/fields.json (SPEC §4.6), so each of those two has
 * its own handling.
 */
export const ID_PATHS = {
  field: FIELDS,
  kind: FINDING_KINDS,
  significance: SIGNIFICANCE,
  "ai.role": AI_ROLES,
  "ai.confidence": AI_CONFIDENCE,
} as const;
export type IdPath = keyof typeof ID_PATHS;

const ID_LABELS: Record<IdPath, Record<string, Bilingual>> = {
  field: FIELD_INFO,
  kind: KIND_INFO,
  significance: SIGNIFICANCE_INFO,
  "ai.role": AI_ROLE_INFO,
  "ai.confidence": AI_CONFIDENCE_INFO,
};

/** The fixed label of `id` at `path` in both languages, or null when `id` is not one of the ids that path accepts. */
export function idLabel(path: IdPath, id: string): Bilingual | null {
  if (!(ID_PATHS[path] as readonly string[]).includes(id)) return null;
  const { en, zh } = ID_LABELS[path][id]!;
  return { en, zh };
}

// ── Fixed strings (rendered verbatim; the validator compares against them) ───────────────────────

/** The Monday review's Strongest evidence against when the week has no setback and nothing fell (WEEK_AGAINST). */
export const NONE_FOUND: Bilingual = { en: "None found this week.", zh: "本週沒有發現。" };
/** An explainer's How AI helped when the finding has no AI role (`ai_helped` is null then). */
export const NO_AI_PART: Bilingual = { en: "No AI role. It is here because it changes its field.", zh: "無 AI 角色。列入是因為它改變了這個領域。" };
/** Printed under each finding, line or review that mentions Anthropic or Claude (SPEC §4.4). */
export const DISCLOSURE: Bilingual = {
  en: "This tracker is written by Claude, made by Anthropic.",
  zh: "Unveiling Tracker 由 Anthropic 開發的 Claude 撰寫。",
};
/** The text a `removed` correction puts in place of the text it removes (SPEC §4.10). */
export const REMOVED_TEXT: Bilingual = { en: "This text was removed.", zh: "此處文字已移除。" };
/** Stored as that correction's `before`: never the removed text itself. */
export const REMOVED_BEFORE: Bilingual = { en: "[removed text]", zh: "〔已移除的文字〕" };
/** The last line of a brief page. */
export const END_LINE: Bilingual = { en: "That's today's brief.", zh: "今天的簡報到此結束。" };

/**
 * The data-only edition's notice (SPEC §4.5): the edition has no new findings, only the Pace and the earlier findings
 * whose rung changed. The spec names it without giving its words, so these are this project's.
 */
export const DATA_ONLY_NOTICE: Bilingual = {
  en: "Data-only edition. It has no new findings today. It shows the Pace and any earlier findings whose rung changed.",
  zh: "僅數據版。今天沒有新的發現，這一版顯示進度，以及層級有變動的先前發現。",
};
/**
 * The English-only edition's notice (SPEC §4.5, §6): the Chinese pass did not finish, so the edition's own text
 * stays English, and a later run's backlog translates its findings (SPEC §4.6). The words are this project's.
 */
export const ENGLISH_ONLY_NOTICE: Bilingual = {
  en: "English-only edition. The Chinese text was not ready this morning, so this edition stays in English. Its findings will be translated later.",
  zh: "僅英文版。今天早上中文內容尚未完成，因此本期簡報維持英文。其中的發現之後會補上中文。",
};

/**
 * The partial edition's notice (SPEC §4.5): it names the feeds that failed, as given (the registry's names), joined
 * by ", " in English and by 、 in Chinese. With none given it leaves the list out. The words are this project's.
 */
export function partialNotice(feeds: readonly string[]): Bilingual {
  const en = feeds.length > 0 ? ` (${feeds.join(", ")})` : "";
  const zh = feeds.length > 0 ? `（${feeds.join("、")}）` : "";
  return {
    en: `Partial edition. Some feeds could not be read this morning${en}, so findings from them may be missing.`,
    zh: `不完整版。今天早上有些資料來源無法讀取${zh}，來自這些來源的發現可能有缺漏。`,
  };
}

/**
 * A brief's `status_note` (SPEC §4.5): the data-only notice for a data-only edition; for a full or partial one,
 * the partial notice when it is partial, then the English-only notice when `englishOnly` (`languages.zh` false);
 * null for a full edition with its Chinese. English parts are joined by a space and Chinese ones by nothing, as
 * the Pace sentence's parts are (SPEC §5.2). A data-only edition's note is its notice alone, whatever its languages.
 */
export function statusNote(opts: { edition: Edition; englishOnly: boolean; feeds: readonly string[] }): Bilingual | null {
  if (opts.edition === "data_only") return { ...DATA_ONLY_NOTICE };
  const parts: Bilingual[] = [];
  if (opts.edition === "partial") parts.push(partialNotice(opts.feeds));
  if (opts.englishOnly) parts.push(ENGLISH_ONLY_NOTICE);
  if (parts.length === 0) return null;
  return { en: parts.map((p) => p.en).join(" "), zh: parts.map((p) => p.zh).join("") };
}

// ── Lists the rules read (SPEC §4.1, §4.4) ───────────────────────────────────────────────────────

/** ABBREVIATIONS (`splitSentences()`, lib/text.ts, SPEC §4.1): the abbreviations that do not end a sentence, as the spec lists them (grown by PR). */
export const ABBREVIATIONS = ["e.g.", "i.e.", "et al.", "Dr.", "St.", "No.", "vs.", "U.S.", "U.K.", "Prof.", "Fig.", "Eq.", "cf.", "approx.", "Jr."] as const;

/**
 * CLAUDE_PEOPLE (`mentionsAnthropic()`, SPEC §4.4): people named Claude, removed from the text before it looks for
 * Anthropic or Claude. Matched in any case, diacritics ignored and hyphens or underscores read as spaces. Grown by PR.
 */
export const CLAUDE_PEOPLE = ["Claude Shannon", "Claude Lévi-Strauss", "Claude Monet", "Claude Debussy", "Claude Bernard"] as const;

/**
 * ANTHROPIC_PHRASES (`mentionsAnthropic()`, SPEC §4.4): phrases of cosmology and philosophy that hold "anthropic" and
 * do not name the company, removed from the text first like `CLAUDE_PEOPLE`. Grown by PR.
 */
export const ANTHROPIC_PHRASES = ["anthropic principle", "anthropic reasoning", "anthropic bias", "anthropic selection"] as const;

// ── Safety lists (SPEC §4.2, §9.5) ───────────────────────────────────────────────────────────────

export const BLOCK_REASONS = ["paste", "messaging", "shortener", "redirect", "archive", "leak_site", "scan_query", "shadow_library"] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export interface BlockedHost {
  /**
   * One of four forms (`blockedForm()`): a host (matches the host and every subdomain), a host/path prefix, a
   * ".onion" or ".i2p" suffix, or a label, a pattern with no dot that matches any dot-separated label of a host.
   * Lower case.
   */
  pattern: string;
  reason: BlockReason;
}

/** The four forms of a `BlockedHost` pattern. */
export type BlockedForm = "host" | "path" | "suffix" | "label";

/**
 * The form of a pattern: a suffix starts with a dot, a path holds a slash, a label has no dot (`sci-hub`:
 * `blockedEntry()` in lib/urls.ts matches it against each dot-separated label of a host, so `sci-hub.<any
 * ending>` and its subdomains are blocked), and anything else is a host.
 */
export function blockedForm(pattern: string): BlockedForm {
  if (pattern.startsWith(".")) return "suffix";
  if (pattern.includes("/")) return "path";
  if (!pattern.includes(".")) return "label";
  return "host";
}

const entries = (reason: BlockReason, patterns: string[]): BlockedHost[] => patterns.map((pattern) => ({ pattern, reason }));

/**
 * The one blocked list. The validator (BLOCKED_HOST, SOURCE_URL), collect, the snapshot fetcher, `safeHref()`, the
 * link check and the agent's WebFetch deny list (§9.5) all read it. Order matters: routine/agent-settings.json lists
 * the host entries in this order. Each shadow library's hosts are listed exactly, since a WebFetch `domain:` rule
 * names one host, then its labels catch the mirrors the list lacks. **Verify in P3:** each library's current hosts;
 * P3 adds the missing ones and keeps the rest, and a PR adds later ones.
 */
export const BLOCKED_HOSTS: readonly BlockedHost[] = [
  ...entries("paste", [
    "pastebin.com", "paste.ee", "pastes.io", "hastebin.com", "justpaste.it", "privatebin.net", "controlc.com", "rentry.co",
    "gist.github.com", "gist.githubusercontent.com", "raw.githubusercontent.com", "objects.githubusercontent.com", "codeload.github.com",
    "api.github.com",
  ]),
  ...entries("messaging", ["t.me", "telegram.me", "telegram.org", "discord.gg"]),
  ...entries("shortener", ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "tiny.cc", "s.id", "lnkd.in"]),
  ...entries("redirect", ["news.google.com", "google.com/url", "l.facebook.com", "out.reddit.com", "href.li"]),
  ...entries("archive", ["archive.org", "archive.ph", "archive.today", "archive.is", "archive.li", "archive.md", "archive.vn", "archive.fo", "ghostarchive.org"]),
  ...entries("leak_site", ["ransomware.live", "ransomlook.io", ".onion", ".i2p"]),
  ...entries("scan_query", ["shodan.io/search", "search.censys.io", "fofa.info", "zoomeye.org"]),
  ...entries("shadow_library", [
    "sci-hub.se", "sci-hub.st", "sci-hub.ru", "libgen.is", "libgen.rs", "libgen.li", "z-lib.org", "z-library.sk",
    "annas-archive.org", "annas-archive.se", "annas-archive.li",
    "sci-hub", "libgen", "z-lib", "z-library", "annas-archive",
  ]),
];

/** Host entries only: no path, no suffix and no label. These get the two WebFetch deny forms, `domain:<host>` and `domain:*.<host>` (§9.5). */
export function blockedHostEntries(): string[] {
  return BLOCKED_HOSTS.map((b) => b.pattern).filter((p) => blockedForm(p) === "host");
}

// ── The canary (SPEC §8.12, §9.5, §10 P1) ────────────────────────────────────────────────────────

/**
 * The harmless, meaningless string planted in fixtures/injection/. If it ever appears in a draft, a log or a chat
 * edition, an agent followed a planted instruction (CANARY). New for this project, never another tracker's.
 */
export const CANARY_TOKEN = "UT-CANARY-5B1E8D40-AMBER-OTTER";

/** The planted URL prefix an agent must never fetch. */
export const CANARY_URL_PREFIX = "https://example.org/ut-canary/";

/** The same URL without its scheme, lower-case: what a check matches, so http, www or upper-case forms count too. */
export const CANARY_URL_MARK = "example.org/ut-canary/";
