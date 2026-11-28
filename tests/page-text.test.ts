// lib/page-text.ts (SPEC §6 Routes, §7 Components, §4.12): every fixed string of the site in both languages, keyed, and the strings
// that carry a value as functions. The table is pinned here row by row, so a changed string shows in review; the rest checks what
// the spec requires of it: both languages for every key, the English dash rule (NO_EM_DASH), the Chinese checks of lib/zh.ts over
// every Chinese string (ZH_NO_DASH, ZH_TRADITIONAL, ZH_AVOID, SPEC §0.4 row 84, and ZH_PARITY and ZH_TERMS besides), STYLE-ZH.md's
// spacing and punctuation, the strings the spec quotes (read back from SPEC.md, so the spec and the code cannot drift apart,
// AGENTS.md rule 6), and every function with example arguments in both languages. New for this project; Cyber's tests/page-text.test.ts
// checks the counted text of its own pages, which this project's lib/page-text.ts does not hold (docs/PROVENANCE.md).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { loadConfig, type LoadedConfig } from "@/lib/config";
import { hrefFor, LANGS, type Bilingual, type L10n } from "@/lib/i18n";
import {
  argumentBy, breakdownLabel, claimedBy, correctionWord, counterAsOf, editionLabel, editionTime, editionsLine, facetHeading, fieldCount,
  figureCaption, findingCount, holdSummary, ladderName, landmarkCompare, lastUpdated, ledgerLine, longDateText, MAIN_TABS, metaDescription,
  noEditionYet, PAGE_TEXT, PAGE_TEXT_KEYS, pageText, pageTitle, reactionLine, reportStatus, rungChange, SIBLING_TABS, significanceChip,
  sourcesSummary, staleBanner, whyToday, yearLabel, type Facet, type PageTextKey,
} from "@/lib/page-text";
import { WHY_TODAY } from "@/lib/schema/brief";
import { FIGURE_LICENCES } from "@/lib/schema/common";
import { CORRECTION_TYPES, REPORT_STATUS } from "@/lib/schema/misc";
import {
  AI_ROLE_INFO, ALL_RUNGS, EDITIONS, EDITION_INFO, ENGLISH_ONLY_LABEL, FIELD_INFO, FORMAT_INFO, RUNGS, RUNG_INFO, SIGNIFICANCE, SIGNIFICANCE_INFO,
} from "@/lib/vocab";
import { avoidHits, dashHits, fixedMissing, parityProblems, traditionalHits, urlsIn } from "@/lib/zh";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
const CONFIG: LoadedConfig = loadConfig(path.join(ROOT, "config"));
const RUN = JSON.parse(read("config/run.json")) as { site: { name: string; tagline: L10n }; siblings: Record<string, string>; schedule: { stale_after: string } };
/** SPEC.md with each run of white space as one space, so a quote that the spec wraps over two lines is found. */
const SPEC = read("SPEC.md").replace(/\s+/g, " ");
const SOURCE = read("lib/page-text.ts");
const THIS_FILE = read("tests/page-text.test.ts");

// Dashes and curly quotes are built from code points, so that this file holds none itself (NO_EM_DASH).
const chr = (...cps: number[]): string => String.fromCodePoint(...cps);
const EM = chr(0x2014);
const EN = chr(0x2013);
const CURLY_QUOTE = new RegExp(`[${chr(0x2018)}${chr(0x2019)}${chr(0x201c)}${chr(0x201d)}]`);

// ── The table, pinned ────────────────────────────────────────────────────────────────────────────

const PINNED: Record<string, readonly [en: string, zh: string]> = {
  "nav.today": ["Today", "今日"],
  "nav.ledger": ["Ledger", "發現紀錄"],
  "nav.trends": ["Trends", "趨勢"],
  "nav.glossary": ["Glossary", "名詞解釋"],
  "nav.didntHoldUp": ["What didn't hold up", "經不起檢驗的發現"],
  "nav.archive": ["Archive", "往期簡報"],
  "nav.methodology": ["Methodology", "方法說明"],
  "nav.about": ["About", "關於本站"],
  "nav.main": ["Main", "主要選單"],
  "nav.trackers": ["Trackers", "追蹤站"],
  "nav.language": ["Language", "語言"],
  "nav.skip": ["Skip to the main content", "跳到主要內容"],
  "siblings.me": ["ME", "ME"],
  "siblings.europe": ["Europe", "Europe"],
  "siblings.cyber": ["Cyber", "Cyber"],
  "siblings.unveiling": ["Unveiling", "Unveiling"],
  "footer.written": ["Written each morning by Claude, Anthropic's AI, without human review. Numbers are computed by scripts.", "每天早上由 Anthropic 的 AI Claude 撰寫，未經人工審核。數字由程式計算。"],
  "footer.credits": ["Data credits", "資料來源與致謝"],
  "footer.repo": ["Code and data on GitHub", "GitHub 上的程式碼與資料"],
  "footer.rss": ["RSS", "RSS"],
  "banner.sample": ["Preview data, not the published brief", "預覽資料，並非正式發布的簡報"],
  "empty.ledger": ["No findings yet.", "目前還沒有任何發現。"],
  "empty.trends": ["The Pace history is not available yet.", "進度的歷史資料目前還無法取得。"],
  "empty.glossary": ["No terms yet.", "目前還沒有任何名詞。"],
  "empty.didntHoldUp": ["Nothing has fallen yet.", "目前還沒有任何發現經不起檢驗。"],
  "empty.archive": ["No editions yet.", "目前還沒有任何一期簡報。"],
  "notFound.title": ["Not found", "找不到頁面"],
  "notFound.body": ["There is no page here.", "這裡沒有這個頁面。"],
  "notFound.link": ["Browse the archive", "瀏覽往期簡報"],
  "brief.lead": ["Lead", "導言"],
  "brief.story": ["Story of the day", "今日焦點"],
  "brief.more": ["More", "更多發現"],
  "brief.climbedOrFell": ["Climbed or fell", "層級升降"],
  "brief.ideas": ["Ideas and debate", "想法與討論"],
  "brief.also": ["Also noted", "另外值得一提"],
  "brief.deepDive": ["Sunday deep dive", "週日深度報導"],
  "brief.review": ["Week in review", "一週回顧"],
  "brief.corrections": ["Corrections", "更正"],
  "brief.sources": ["Sources", "來源"],
  "brief.otherEditions": ["Other editions", "其他期別"],
  "brief.newer": ["Newer edition", "較新的一期"],
  "brief.older": ["Older edition", "較舊的一期"],
  "review.bigPicture": ["The big picture", "整體概況"],
  "review.remarkable": ["Most remarkable", "本週最引人注目"],
  "review.charts": ["The charts", "圖表"],
  "review.fieldCounts": ["Findings by field", "各領域的發現數"],
  "review.countedNote": ["Reported: first briefed this week. Counted: not a setback, and now Checked or higher.", "報導：本週首次刊出。計入：不屬於挫折，且目前已達「已查核」或更高層級。"],
  "review.fell": ["What didn't hold up this week", "本週經不起檢驗的發現"],
  "review.against": ["Strongest evidence against", "最有力的反面證據"],
  "finding.readFull": ["Read the full explainer", "閱讀完整解說"],
  "finding.back": ["Back with new facts", "有新進展，再度報導"],
  "finding.report": ["Report an error (opens GitHub, needs a free GitHub account)", "回報錯誤（會開啟 GitHub，需要免費的 GitHub 帳號）"],
  "finding.howSureFull": ["How sure we are, in full", "我們有多確定：完整說明"],
  "finding.ladderHistory": ["Verification history", "查證歷程"],
  "finding.aiEvidence": ["What shows the AI role", "AI 角色的依據"],
  "finding.fromClaimant": ["From the maker or a lab that benefits", "出自開發者或從中受益的實驗室"],
  "finding.reactions": ["Reactions", "學者回應"],
  "finding.sinceThen": ["Since then", "後續進展"],
  "finding.corrections": ["Corrections", "更正"],
  "finding.reports": ["Reports", "讀者回報"],
  "finding.terms": ["Terms", "名詞"],
  "finding.related": ["Related findings", "相關發現"],
  "finding.who": ["Who did the work", "誰做了這項研究"],
  "finding.briefs": ["Reported in these editions", "報導過這項發現的簡報"],
  "finding.share": ["Share link", "分享連結"],
  "figure.credit": ["Credit", "圖片出處"],
  "figure.licence": ["Licence", "授權"],
  "licence.ccBy4": ["CC BY 4.0", "CC BY 4.0"],
  "licence.ccBySa4": ["CC BY-SA 4.0", "CC BY-SA 4.0"],
  "licence.cc0": ["CC0 1.0", "CC0 1.0"],
  "licence.publicDomain": ["Public domain", "公有領域"],
  "ideas.unscored": ["Unscored: arguments, not findings", "未評級：是論點，不是發現"],
  "change.byScript": ["(script)", "（程式判定）"],
  "deepdive.whyLabel": ["Why today", "為什麼選在今天"],
  "deepdive.why.news": ["New this week", "本週新進展"],
  "deepdive.why.anniversary": ["Anniversary", "週年紀念"],
  "deepdive.why.rotation": ["From the Ledger", "取自發現紀錄"],
  "ledger.browse": ["Browse by", "瀏覽方式"],
  "ledger.all": ["All findings", "全部發現"],
  "facet.field": ["Field", "領域"],
  "facet.rung": ["Rung", "層級"],
  "facet.role": ["AI role", "AI 角色"],
  "facet.year": ["Year", "年份"],
  "fell.intro": ["Findings now Disputed or Retracted, newest change first.", "目前被列為「有爭議」或「已撤稿」的發現，最新變動排在最前面。"],
  "fell.happened": ["What happened", "發生了什麼事"],
  "charts.a": ["AI in leading journals", "主要期刊中的 AI"],
  "charts.b": ["All papers: adoption, not discovery", "所有論文：衡量的是採用程度，不是發現"],
  "charts.c": ["AI's share of the Landmarks", "里程碑發現中的 AI 比例"],
  "charts.d": ["The Hold rate", "經得起檢驗的比率"],
  "charts.counters": ["Counters", "累計數字"],
  "charts.baseline": ["Pre-AI baseline: 2015 to 2019", "AI 出現前的基準：2015 至 2019 年"],
  "charts.provisional": ["provisional", "暫定"],
  "charts.provisionalNote": ["Provisional weeks: OpenAlex is still adding papers to them.", "暫定週：OpenAlex 仍在補入這幾週的論文。"],
  "charts.monthly": ["Monthly", "按月"],
  "charts.weekly": ["Weekly, newest 52 weeks", "按週，最近 52 週"],
  "charts.noPapers": ["no papers", "沒有論文"],
  "charts.tooFew": ["too few to judge yet", "案例太少，尚無法判斷"],
  "charts.withAi": ["With an AI role", "有 AI 角色"],
  "charts.withoutAi": ["Without an AI role", "無 AI 角色"],
  "charts.held": ["Held up", "經得起檢驗"],
  "charts.fell": ["Fell", "經不起檢驗"],
  "charts.open": ["Still open", "尚未定論"],
  "counters.source": ["Source", "來源"],
  "counters.stale": ["Showing the last reading", "顯示上一次的讀數"],
  "counters.missing": ["No reading yet", "尚無讀數"],
  "counters.phase1": ["Phase 1", "臨床第 1 期"],
  "counters.phase2": ["Phase 2", "臨床第 2 期"],
  "counters.phase3": ["Phase 3", "臨床第 3 期"],
  "counters.approved": ["Approved", "已核准"],
  "counters.total": ["Total", "總計"],
  "glossary.firstUsed": ["First used in", "首次出現於"],
  "methodology.written": ["How the brief is written", "簡報的寫作規則"],
  "methodology.pace": ["How the Pace is measured", "進度的計算方式"],
  "methodology.versions": ["Config versions", "設定版本"],
  "methodology.journals": ["Journals counted", "納入計算的期刊"],
  "methodology.phrases": ["AI phrases counted", "納入計算的 AI 用語"],
  "methodology.ladder": ["The Verification Ladder", "查證階梯"],
  "methodology.roles": ["AI roles", "AI 角色"],
  "methodology.primary": ["Primary sources only", "只引用原始來源"],
  "methodology.allowlist": ["Where primary sources come from", "原始來源的範圍"],
  "methodology.feeds": ["Feed status, last 14 days", "資料來源狀態，最近 14 天"],
  "methodology.corrections": ["Corrections log", "更正紀錄"],
  "about.who": ["Who writes it", "誰負責撰寫"],
  "about.how": ["How it is made", "製作方式"],
  "about.credits": ["Data credits", "資料來源與致謝"],
  "about.report": ["How to report an error", "如何回報錯誤"],
  "about.reports": ["Reports and their status", "回報與處理狀態"],
  "correction.corrected": ["Corrected", "已更正"],
  "correction.clarified": ["Clarified", "已釐清"],
  "correction.updated": ["Updated", "已更新"],
  "correction.removed": ["Text removed", "已移除文字"],
  "correction.source": ["Source", "來源"],
  "correction.now": ["now", "現為"],
  "correction.refiled": ["This changes how the finding is filed and counted from this date.", "從這一天起，這項發現的歸類與計數隨之改變。"],
  "report.open": ["Open", "待查核"],
  "report.upheld": ["Upheld", "成立"],
  "report.rejected": ["Rejected", "不成立"],
};

/** The strings that are the same in both languages: names and identifiers, which the siblings' own sites also keep in Latin letters. */
const SAME_IN_BOTH: readonly PageTextKey[] = [
  "siblings.me", "siblings.europe", "siblings.cyber", "siblings.unveiling", "footer.rss", "licence.ccBy4", "licence.ccBySa4", "licence.cc0",
];

// ── Example arguments for every function: one clean case each, so the hygiene checks read what the function adds ─────────

const T_PLUS8 = "2026-11-07T05:12:40+08:00";
const T_UTC = "2026-11-06T21:12:40Z";

interface Sample {
  readonly name: string;
  readonly text: Bilingual;
}
const SAMPLES: Sample[] = [];
const sample = (name: string, text: Bilingual): void => void SAMPLES.push({ name, text });

sample("noEditionYet", noEditionYet("08:00"));
sample("staleBanner", staleBanner("2026-11-07", T_PLUS8));
sample("lastUpdated", lastUpdated("2026-11-07", T_PLUS8));
for (const date of ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]) sample(`longDateText ${date}`, longDateText(date));
sample("editionTime", editionTime("2026-11-08T04:12:00+08:00", false));
sample("editionTime late", editionTime("2026-11-08T09:40:00+08:00", true));
for (const n of [0, 1, 2, 1284]) {
  sample(`findingCount ${n}`, findingCount(n));
  sample(`editionsLine ${n}`, editionsLine(n));
  sample(`ledgerLine ${n}`, ledgerLine(n));
  sample(`sourcesSummary ${n}`, sourcesSummary(n));
}
sample("fieldCount", fieldCount(5, 2));
for (const edition of EDITIONS) for (const englishOnly of [false, true]) sample(`editionLabel ${edition} ${englishOnly}`, editionLabel(edition, englishOnly));
for (const rung of ALL_RUNGS) sample(`ladderName ${rung}`, ladderName(rung));
for (const level of SIGNIFICANCE) sample(`significanceChip ${level}`, significanceChip(level));
sample("claimedBy", claimedBy("Google DeepMind"));
sample("rungChange", rungChange("preprint", "checked"));
sample("rungChange fell", rungChange("checked", "disputed"));
sample("argumentBy", argumentBy("Ada Lovelace"));
sample("reactionLine", reactionLine("Ada Lovelace", "University of London"));
for (const why of WHY_TODAY) sample(`whyToday ${why}`, whyToday(why));
for (const type of CORRECTION_TYPES) sample(`correctionWord ${type}`, correctionWord(type));
for (const status of REPORT_STATUS) sample(`reportStatus ${status}`, reportStatus(status));
for (const licence of FIGURE_LICENCES) sample(`figureCaption ${licence}`, figureCaption("Figure 2 from Parker", licence));
sample("yearLabel", yearLabel(2026));
const FACETS: readonly Facet[] = ["field", "rung", "role", "year"];
for (const facet of FACETS) sample(`facetHeading ${facet}`, facetHeading(facet, facet === "year" ? yearLabel(2026) : FIELD_INFO.biology));
for (const key of ["1", "2", "3", "approved", "total", "2025"]) sample(`breakdownLabel ${key}`, breakdownLabel(key)!);
sample("counterAsOf", counterAsOf("2026-11-07"));
sample("landmarkCompare", landmarkCompare({ year: 2026, ai: 5, all: 9 }, { ai: 4, all: 46 }));
sample("landmarkCompare no year", landmarkCompare({ year: 2026, ai: 0, all: 0 }, { ai: 4, all: 46 }));
sample("landmarkCompare no baseline", landmarkCompare({ year: 2026, ai: 5, all: 9 }, { ai: 0, all: 0 }));
sample("landmarkCompare none", landmarkCompare({ year: 2026, ai: 0, all: 0 }, { ai: 0, all: 0 }));
sample("holdSummary", holdSummary({ cases: 23, held: 15, fell: 3, open: 5 }, 182));
sample("holdSummary one", holdSummary({ cases: 1, held: 0, fell: 0, open: 1 }, 182));
sample("holdSummary none", holdSummary({ cases: 0, held: 0, fell: 0, open: 0 }, 182));

const TABLE: Sample[] = PAGE_TEXT_KEYS.map((key) => ({ name: key, text: PAGE_TEXT[key] }));
const ALL: Sample[] = [...TABLE, ...SAMPLES];

// ── The table ────────────────────────────────────────────────────────────────────────────────────

describe("PAGE_TEXT", () => {
  it("holds exactly the pinned keys, each with the pinned English and Chinese", () => {
    expect([...PAGE_TEXT_KEYS].sort()).toEqual(Object.keys(PINNED).sort());
    for (const key of PAGE_TEXT_KEYS) {
      expect([PAGE_TEXT[key].en, PAGE_TEXT[key].zh], key).toEqual([...PINNED[key]!]);
    }
  });

  it("lists its keys in the order the table writes them, each once, as `group.name` or `group.name.name`", () => {
    expect(PAGE_TEXT_KEYS).toEqual(Object.keys(PAGE_TEXT));
    expect(new Set(PAGE_TEXT_KEYS).size).toBe(PAGE_TEXT_KEYS.length);
    for (const key of PAGE_TEXT_KEYS) expect(key, key).toMatch(/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*){1,2}$/);
  });

  it("has both languages for every key, and the same Chinese as English only for the names and identifiers", () => {
    expect(PAGE_TEXT_KEYS.length).toBeGreaterThan(120);
    for (const key of PAGE_TEXT_KEYS) {
      expect(PAGE_TEXT[key].en, key).toMatch(/\S/);
      expect(PAGE_TEXT[key].zh, key).toMatch(/\S/);
    }
    expect(PAGE_TEXT_KEYS.filter((key) => PAGE_TEXT[key].en === PAGE_TEXT[key].zh)).toEqual([...SAME_IN_BOTH]);
  });

  it("holds Bilingual values, which an L10n can hold, under keys that are the type of a key", () => {
    expectTypeOf(PAGE_TEXT["nav.today"]).toExtend<Bilingual>();
    expectTypeOf<Bilingual>().toExtend<L10n>();
    expectTypeOf<"nav.today">().toExtend<PageTextKey>();
    expectTypeOf<"nope">().not.toExtend<PageTextKey>();
  });

  it("builds the strings that name a vocabulary's label from lib/vocab.ts, so that they cannot drift from it", () => {
    expect(PAGE_TEXT["brief.deepDive"]).toEqual({ en: FORMAT_INFO.sunday_deep_dive.en, zh: FORMAT_INFO.sunday_deep_dive.zh });
    expect(PAGE_TEXT["brief.review"]).toEqual({ en: FORMAT_INFO.monday_review.en, zh: FORMAT_INFO.monday_review.zh });
    expect(PAGE_TEXT["brief.deepDive"]).not.toHaveProperty("weekday");
    expect(PAGE_TEXT["fell.intro"].en).toContain(`${RUNG_INFO.disputed.en} or ${RUNG_INFO.retracted.en}`);
    expect(PAGE_TEXT["fell.intro"].zh).toContain(`「${RUNG_INFO.disputed.zh}」或「${RUNG_INFO.retracted.zh}」`);
    expect(PAGE_TEXT["review.countedNote"].en).toContain(`now ${RUNG_INFO.checked.en} or higher`);
    expect(PAGE_TEXT["review.countedNote"].zh).toContain(`「${RUNG_INFO.checked.zh}」`);
  });

  it("uses one Chinese word for one thing across the table and the vocabulary", () => {
    const zh = (key: PageTextKey): string => PAGE_TEXT[key].zh;
    expect(zh("charts.withoutAi")).toBe(AI_ROLE_INFO.none.zh);
    expect(zh("facet.role")).toBe("AI 角色");
    for (const key of ["nav.didntHoldUp", "empty.didntHoldUp", "review.fell"] as const) expect(zh(key), key).toContain(zh("charts.fell"));
    expect(zh("charts.d")).toContain(zh("charts.held"));
    for (const key of ["nav.ledger", "deepdive.why.rotation"] as const) expect(zh(key), key).toContain("發現紀錄");
    expect(zh("facet.rung")).toBe("層級");
    expect(zh("methodology.ladder")).toBe("查證階梯");
    expect(zh("charts.noPapers")).toBe("沒有論文");
  });
});

describe("pageText", () => {
  it("gives each key's string in each language", () => {
    for (const key of PAGE_TEXT_KEYS) for (const lang of LANGS) expect(pageText(key, lang), `${key} ${lang}`).toBe(PAGE_TEXT[key][lang]);
    expect(pageText("nav.today", "en")).toBe("Today");
    expect(pageText("nav.today", "zh")).toBe("今日");
  });

  it("throws on a key that is not in the table, whatever the language, and on a language that is not one of the two", () => {
    // @ts-expect-error an unknown key is a type error as well
    expect(() => pageText("nav.nope", "en")).toThrow(RangeError);
    for (const inherited of ["constructor", "toString", "hasOwnProperty", "__proto__", ""]) {
      expect(() => pageText(inherited as PageTextKey, "en"), inherited).toThrow(/Unknown page text key/);
    }
    // @ts-expect-error a language other than en or zh is a type error as well
    expect(() => pageText("nav.today", "fr")).toThrow(/Unknown language/);
    expect(() => pageText("nav.today", "toString" as "en")).toThrow(RangeError);
  });
});

// ── Hygiene, over every string in both languages ─────────────────────────────────────────────────

const HAN = /\p{Script=Han}/u;
/** The punctuation Chinese text uses, full-width; none belongs in an English string. */
const CHINESE_PUNCTUATION = /[，。、：；？！（）「」『』〔〕《》〈〉]/;
/** Strings with no Han character of their own: the names and identifiers, and a line that holds only the two names it is given (Latin here). */
const NAMES_ONLY: readonly string[] = [...SAME_IN_BOTH, "reactionLine"];
const SIMPLE_NUMBER_MARKS = /(?<=\d)[.,:](?=\d)/g;
const HAN_NEXT_TO_LATIN = /[A-Za-z0-9][\p{Script=Han}]|[\p{Script=Han}][A-Za-z0-9]/u;
const SPACE_BESIDE_FULL_WIDTH = / [，。：；？！）、」』〕》〉]|[（「『〔《〈] /;

describe("every string, in both languages", () => {
  it("is covered: the table and every example of every function", () => {
    expect(ALL.length).toBe(TABLE.length + SAMPLES.length);
    expect(SAMPLES.length).toBeGreaterThan(70);
    expect(new Set(ALL.map((a) => a.name)).size).toBe(ALL.length);
  });

  it("has English with no Han character, no full-width punctuation, no stray space, no line break and no curly quote", () => {
    for (const { name, text } of ALL) {
      expect(text.en, name).toMatch(/\S/);
      expect(text.en, name).toBe(text.en.trim());
      expect(text.en, name).not.toMatch(/\n| {2}/);
      expect(text.en, name).not.toMatch(HAN);
      expect(text.en, name).not.toMatch(CHINESE_PUNCTUATION);
      expect(text.en, name).not.toMatch(CURLY_QUOTE);
    }
  });

  it("has English with no em dash and no en dash outside digits (NO_EM_DASH), and no other dash than the hyphen", () => {
    for (const { name, text } of ALL) {
      const rest = text.en.replace(new RegExp(`(?<=\\d)${EN}(?=\\d)`, "g"), "");
      expect(rest, name).not.toContain(EM);
      expect(rest, name).not.toContain(EN);
      expect([...rest].filter((c) => /\p{Pd}/u.test(c) && c !== "-"), name).toEqual([]);
    }
  });

  it("has Chinese with Han characters (but for the names and identifiers), no stray space, no line break and no straight quote", () => {
    for (const { name, text } of ALL) {
      expect(text.zh, name).toMatch(/\S/);
      expect(text.zh, name).toBe(text.zh.trim());
      expect(text.zh, name).not.toMatch(/\n| {2}/);
      expect(text.zh, name).not.toMatch(/["']/);
      if (!NAMES_ONLY.includes(name)) expect(text.zh, name).toMatch(HAN);
    }
  });

  it("has Chinese with full-width marks only, half-width ones staying inside numbers", () => {
    for (const { name, text } of ALL) {
      expect(text.zh.replace(SIMPLE_NUMBER_MARKS, ""), name).not.toMatch(/[.,;:?!()]/);
    }
  });

  it("puts one space between a Han character and a Latin letter or digit, and none beside a full-width mark (STYLE-ZH.md §4)", () => {
    for (const { name, text } of ALL) {
      expect(text.zh, name).not.toMatch(HAN_NEXT_TO_LATIN);
      expect(text.zh, name).not.toMatch(SPACE_BESIDE_FULL_WIDTH);
    }
    expect(SPACE_BESIDE_FULL_WIDTH.test("甲 ，乙")).toBe(true);
    expect(HAN_NEXT_TO_LATIN.test("AI角色")).toBe(true);
    expect(HAN_NEXT_TO_LATIN.test("AI 角色")).toBe(false);
  });

  it("writes the week as 週 (STYLE-ZH.md), never 周", () => {
    for (const { name, text } of ALL) expect(text.zh, name).not.toContain("周");
    expect(longDateText("2026-11-08").zh).toContain("週日");
  });

  it("differs in the two languages, but for the names and identifiers", () => {
    for (const { name, text } of ALL) {
      if (!(SAME_IN_BOTH as readonly string[]).includes(name)) expect(text.en, name).not.toBe(text.zh);
    }
  });

  it("holds no URL, in either language", () => {
    for (const { name, text } of ALL) {
      expect(urlsIn(text.en), name).toEqual([]);
      expect(urlsIn(text.zh), name).toEqual([]);
      expect(`${text.en} ${text.zh}`, name).not.toMatch(/https?:|www\.|\.com\b|\.org\b|\/\//);
    }
  });
});

// ── The Chinese checks of lib/zh.ts (SPEC §0.4 row 84) ───────────────────────────────────────────

describe("the Chinese checks of lib/zh.ts, over every Chinese string", () => {
  it("holds no character that only simplified or only Japanese writing uses (ZH_TRADITIONAL)", () => {
    for (const { name, text } of ALL) expect(traditionalHits(text.zh, CONFIG.index).map((h) => h.char), name).toEqual([]);
  });

  it("holds no term that Taiwan does not use (ZH_AVOID)", () => {
    for (const { name, text } of ALL) expect(avoidHits(text.zh, CONFIG.termsZh).map((h) => h.term), name).toEqual([]);
  });

  it("holds no dash that ZH_NO_DASH refuses", () => {
    for (const { name, text } of ALL) expect(dashHits(text.zh).map((h) => h.codePoint), name).toEqual([]);
  });

  it("matches its English in numbers and has no URL or Latin word that the English lacks (ZH_PARITY)", () => {
    for (const { name, text } of ALL) {
      const p = parityProblems(text.en, text.zh);
      expect({ missing: p.missing.map((n) => n.key), extra: p.extra.map((n) => n.key), urls: p.urls, latin: p.latin }, name).toEqual({
        missing: [], extra: [], urls: [], latin: [],
      });
    }
  });

  it("holds the Taiwan form of every fixed term that its English holds (ZH_TERMS)", () => {
    for (const { name, text } of ALL) expect(fixedMissing(CONFIG.termsZh.fixed, text.en, text.zh, null).map((e) => e.en), name).toEqual([]);
  });

  it("catches a planted failure of each kind, so the checks above can fail", () => {
    expect(traditionalHits(`这${chr(0x500b)}`, CONFIG.index).map((h) => h.char)).toEqual(["这"]);
    expect(avoidHits("人工智能", CONFIG.termsZh).map((h) => h.taiwan)).toEqual(["人工智慧"]);
    expect(dashHits(`甲${EM}乙`).map((h) => h.codePoint)).toEqual(["U+2014"]);
    expect(dashHits(`2015${EN}2019`)).toEqual([]);
    expect(parityProblems("5 items", "6 項").missing.map((n) => n.key).length).toBeGreaterThan(0);
    expect(fixedMissing(CONFIG.termsZh.fixed, "the journal", "那本雜誌", null).map((e) => e.en)).toEqual(["journal"]);
    expect(urlsIn("see example.org/x")).toEqual(["example.org/x"]);
  });
});

// ── The spec's own quotes ────────────────────────────────────────────────────────────────────────

describe("the strings the spec quotes", () => {
  const QUOTED: readonly (readonly [key: PageTextKey, spec: string])[] = [
    ["empty.ledger", '"No findings yet."'],
    ["empty.trends", '"The Pace history is not available yet."'],
    ["empty.glossary", '"No terms yet."'],
    ["empty.didntHoldUp", '"Nothing has fallen yet."'],
    ["empty.archive", '"No editions yet."'],
    ["footer.written", 'Footer`:** "Written each morning by Claude, Anthropic\'s AI, without human review. Numbers are computed by scripts." (both languages)'],
    ["finding.readFull", '"Read the full explainer"'],
    ["finding.back", '"Back with new facts"'],
    ["ideas.unscored", 'the label "Unscored: arguments, not findings"'],
    ["deepdive.why.news", '("New this week", "Anniversary", "From the Ledger")'],
    ["charts.b", 'labelled "All papers: adoption, not discovery"'],
    ["charts.noPapers", 'its figure reads "no papers"'],
    ["charts.tooFew", '"too few to judge yet" while cases < 30'],
    ["change.byScript", '"(script)" when `by` is script'],
  ];

  it("appear in the spec as the table writes them", () => {
    for (const [key, quote] of QUOTED) {
      expect(SPEC, key).toContain(quote);
      expect(quote, key).toContain(PAGE_TEXT[key].en);
    }
    expect(SPEC).toContain("(`<page> · Unveiling Tracker`)");
  });

  it("are the table's English, exactly", () => {
    expect(pageText("footer.written", "en")).toBe("Written each morning by Claude, Anthropic's AI, without human review. Numbers are computed by scripts.");
    expect(pageText("charts.noPapers", "zh")).toBe("沒有論文");
    expect(SPEC).toContain("(「沒有論文」)");
    expect(["Today", "Ledger", "Trends", "Glossary", "What didn't hold up", "Archive", "Methodology", "About"].join(", ")).toBe(
      MAIN_TABS.map((tab) => pageText(tab.key, "en")).join(", "),
    );
    expect(SPEC).toContain("Today, Ledger, Trends, Glossary, What didn't hold up, Archive, Methodology, About, labelled from `lib/page-text.ts`");
  });

  it("answer each empty state of the spec's route table, the home page's through noEditionYet()", () => {
    const table = SPEC.slice(SPEC.indexOf("### Route table"), SPEC.indexOf("**Link formats:**"));
    const empties = table.split("| ").filter((cell) => /^"[^"]+" \|?/.test(cell)).map((cell) => /^"([^"]+)"/.exec(cell)![1]);
    expect(empties).toEqual([
      noEditionYet(RUN.schedule.stale_after).en,
      pageText("empty.ledger", "en"),
      pageText("empty.trends", "en"),
      pageText("empty.glossary", "en"),
      pageText("empty.didntHoldUp", "en"),
      pageText("empty.archive", "en"),
    ]);
  });

  it("says in both languages that the Report an error link opens GitHub and needs a free GitHub account", () => {
    const link = PAGE_TEXT["finding.report"];
    expect(link.en).toMatch(/^Report an error \(opens GitHub, needs a free GitHub account\)$/);
    expect(link.zh).toMatch(/^回報錯誤（會開啟 GitHub，需要免費的 GitHub 帳號）$/);
    expect(SPEC).toContain("The link says, in both languages, that it opens GitHub and needs a free GitHub account.");
  });
});

// ── The tab rows ─────────────────────────────────────────────────────────────────────────────────

describe("the tab rows", () => {
  it("lists the eight main tabs in the spec's order, each with its route", () => {
    expect(MAIN_TABS.map((tab) => tab.key)).toEqual([
      "nav.today", "nav.ledger", "nav.trends", "nav.glossary", "nav.didntHoldUp", "nav.archive", "nav.methodology", "nav.about",
    ]);
    expect(MAIN_TABS.map((tab) => tab.path)).toEqual(["/", "/ledger", "/trends", "/glossary", "/didnt-hold-up", "/archive", "/methodology", "/about"]);
    const table = SPEC.slice(SPEC.indexOf("### Route table"), SPEC.indexOf("**Link formats:**"));
    for (const tab of MAIN_TABS) expect(table, tab.path).toContain(`| \`${tab.path}\` |`);
    for (const lang of LANGS) expect(new Set(MAIN_TABS.map((tab) => pageText(tab.key, lang))).size).toBe(MAIN_TABS.length);
  });

  it("maps each route to its Chinese counterpart the way the language switch does", () => {
    expect(MAIN_TABS.map((tab) => hrefFor("zh", tab.path))).toEqual([
      "/zh", "/zh/ledger", "/zh/trends", "/zh/glossary", "/zh/didnt-hold-up", "/zh/archive", "/zh/methodology", "/zh/about",
    ]);
    expect(MAIN_TABS.map((tab) => hrefFor("en", hrefFor("zh", tab.path)))).toEqual(MAIN_TABS.map((tab) => tab.path));
  });

  it("lists the sibling tabs as the spec does, the first three from run.json's siblings and this site last", () => {
    expect(SIBLING_TABS.map((tab) => tab.id)).toEqual(["me", "europe", "cyber", "unveiling"]);
    expect(SIBLING_TABS.slice(0, 3).map((tab) => tab.id)).toEqual(Object.keys(RUN.siblings));
    for (const lang of LANGS) expect(SIBLING_TABS.map((tab) => pageText(tab.key, lang)).join(" · ")).toBe("ME · Europe · Cyber · Unveiling");
    expect(SPEC).toContain("(ME · Europe · Cyber · Unveiling, the current one marked");
  });
});

// ── Titles and descriptions (SPEC §6 Metadata) ───────────────────────────────────────────────────

describe("pageTitle and metaDescription", () => {
  it("writes `<page> · <site name>` in each language, for each main tab", () => {
    expect(pageTitle("Ledger", "Unveiling Tracker")).toBe("Ledger · Unveiling Tracker");
    expect(pageTitle("發現紀錄", "Unveiling Tracker")).toBe("發現紀錄 · Unveiling Tracker");
    for (const lang of LANGS) {
      for (const tab of MAIN_TABS) {
        const title = pageTitle(pageText(tab.key, lang), RUN.site.name);
        expect(title).toBe(`${pageText(tab.key, lang)} · Unveiling Tracker`);
        expect(title.endsWith(" · Unveiling Tracker")).toBe(true);
      }
    }
    expect(pageTitle(longDateText("2026-11-08").en, RUN.site.name)).toBe("Sunday 8 November 2026 · Unveiling Tracker");
    expect(pageTitle(longDateText("2026-11-08").zh, RUN.site.name)).toBe("2026 年 11 月 8 日（週日） · Unveiling Tracker");
  });

  it("trims the white space round a page name or site name", () => {
    expect(pageTitle("  Ledger\n", " Unveiling Tracker ")).toBe("Ledger · Unveiling Tracker");
  });

  it("refuses a blank page name or site name", () => {
    for (const blank of ["", " ", "\n"]) {
      expect(() => pageTitle(blank, "Unveiling Tracker"), JSON.stringify(blank)).toThrow(RangeError);
      expect(() => pageTitle("Ledger", blank), JSON.stringify(blank)).toThrow(RangeError);
    }
  });

  it("describes a page by its first sentence, else by the tagline in the page's language", () => {
    const sentence = "A model solved a long-open problem in algebra.";
    for (const lang of LANGS) {
      const tagline = RUN.site.tagline[lang]!;
      expect(metaDescription(sentence, tagline)).toBe(sentence);
      expect(metaDescription(`  ${sentence}\n`, tagline)).toBe(sentence);
      for (const none of [null, undefined, "", "  ", "\n\t"]) expect(metaDescription(none, tagline), JSON.stringify(none)).toBe(tagline);
    }
    expect(metaDescription(sentence, "")).toBe(sentence);
    expect(() => metaDescription(null, "  ")).toThrow(RangeError);
  });
});

// ── The page frame ───────────────────────────────────────────────────────────────────────────────

describe("the page frame's functions", () => {
  it("noEditionYet: the home page's empty state, with the stale hour of run.json", () => {
    expect(noEditionYet(RUN.schedule.stale_after)).toEqual({
      en: "No edition yet. Each morning's brief is ready before 08:00 Taipei.",
      zh: "還沒有任何一期簡報。每天早上的簡報會在台北時間 08:00 前準備好。",
    });
    expect(noEditionYet("07:30").en).toContain("before 07:30 Taipei");
    expect(noEditionYet("07:30").zh).toContain("台北時間 07:30 前");
    for (const good of ["00:00", "04:30", "09:59", "10:00", "12:34", "19:59", "20:00", "23:59"]) {
      expect(noEditionYet(good).en, good).toBe(`No edition yet. Each morning's brief is ready before ${good} Taipei.`);
    }
    for (const bad of ["8:00", "24:00", "23:60", "08:60", "", "08:00 ", " 08:00", "0800", "08:00\n", "ab:cd", "08:0", "08:000", "008:00", "-1:00", "08-00"]) {
      expect(() => noEditionYet(bad), JSON.stringify(bad)).toThrow(RangeError);
    }
  });

  it("staleBanner: Cyber's words with the date and Taipei's time of the last edition", () => {
    const expected = {
      en: "Not updated today. Last edition: 7 Nov 2026, 05:12 Taipei",
      zh: "今天還沒有更新。最新一期：2026 年 11 月 7 日 05:12（台北時間）",
    };
    expect(staleBanner("2026-11-07", T_PLUS8)).toEqual(expected);
    expect(staleBanner("2026-11-07", T_UTC)).toEqual(expected);
    expect(staleBanner("2025-12-30", "2025-12-30T23:59:59+08:00")).toEqual({
      en: "Not updated today. Last edition: 30 Dec 2025, 23:59 Taipei",
      zh: "今天還沒有更新。最新一期：2025 年 12 月 30 日 23:59（台北時間）",
    });
    expect(staleBanner("2026-11-07", "2026-11-06T16:00:00Z").en).toBe("Not updated today. Last edition: 7 Nov 2026, 00:00 Taipei");
    expect(() => staleBanner("2026-02-30", T_PLUS8)).toThrow();
    expect(() => staleBanner("2026-11-07", "yesterday")).toThrow();
  });

  it("lastUpdated: the footer's time, written as the stale banner writes it", () => {
    expect(lastUpdated("2026-11-07", T_PLUS8)).toEqual({
      en: "Last updated: 7 Nov 2026, 05:12 Taipei",
      zh: "最後更新：2026 年 11 月 7 日 05:12（台北時間）",
    });
    expect(lastUpdated("2026-11-07", T_UTC).en).toBe("Last updated: 7 Nov 2026, 05:12 Taipei");
    expect(() => lastUpdated("2026-13-01", T_PLUS8)).toThrow();
  });

  it("longDateText: the long date in each language, with its weekday", () => {
    const week = [
      ["2026-11-08", "Sunday 8 November 2026", "2026 年 11 月 8 日（週日）"],
      ["2026-11-09", "Monday 9 November 2026", "2026 年 11 月 9 日（週一）"],
      ["2026-11-10", "Tuesday 10 November 2026", "2026 年 11 月 10 日（週二）"],
      ["2026-11-11", "Wednesday 11 November 2026", "2026 年 11 月 11 日（週三）"],
      ["2026-11-12", "Thursday 12 November 2026", "2026 年 11 月 12 日（週四）"],
      ["2026-11-13", "Friday 13 November 2026", "2026 年 11 月 13 日（週五）"],
      ["2026-11-14", "Saturday 14 November 2026", "2026 年 11 月 14 日（週六）"],
      ["2026-01-01", "Thursday 1 January 2026", "2026 年 1 月 1 日（週四）"],
    ] as const;
    for (const [date, en, zh] of week) expect(longDateText(date), date).toEqual({ en, zh });
    for (const bad of ["2026-13-01", "2026-02-30", "8 November 2026", ""]) expect(() => longDateText(bad), bad).toThrow();
  });

  it("editionTime: the masthead's edition time, in Taipei whatever offset the timestamp has, with (late) after the stale hour", () => {
    expect(editionTime("2026-11-08T04:12:00+08:00", false)).toEqual({ en: "Published 04:12 Taipei", zh: "台北時間 04:12 發布" });
    expect(editionTime("2026-11-07T20:12:00Z", false)).toEqual({ en: "Published 04:12 Taipei", zh: "台北時間 04:12 發布" });
    expect(editionTime("2026-11-08T09:40:00+08:00", true)).toEqual({ en: "Published 09:40 Taipei (late)", zh: "台北時間 09:40 發布（延遲）" });
    expect(() => editionTime("noon", false)).toThrow();
  });
});

describe("the counts and lines", () => {
  const COUNTS = [
    [0, "0 findings", "0 項發現", "0 editions, newest first.", "共 0 期簡報，由新到舊。", "0 findings, newest first, grouped by year.", "共 0 項發現，由新到舊，依年份分組。", "Sources (0)", "來源（0）"],
    [1, "1 finding", "1 項發現", "1 edition, newest first.", "共 1 期簡報，由新到舊。", "1 finding, newest first, grouped by year.", "共 1 項發現，由新到舊，依年份分組。", "Sources (1)", "來源（1）"],
    [2, "2 findings", "2 項發現", "2 editions, newest first.", "共 2 期簡報，由新到舊。", "2 findings, newest first, grouped by year.", "共 2 項發現，由新到舊，依年份分組。", "Sources (2)", "來源（2）"],
    [1284, "1,284 findings", "1,284 項發現", "1,284 editions, newest first.", "共 1,284 期簡報，由新到舊。", "1,284 findings, newest first, grouped by year.", "共 1,284 項發現，由新到舊，依年份分組。", "Sources (1,284)", "來源（1,284）"],
  ] as const;

  it("findingCount, editionsLine, ledgerLine and sourcesSummary: singular for one, grouped from a thousand, in both languages", () => {
    for (const [n, findingEn, findingZh, editionsEn, editionsZh, ledgerEn, ledgerZh, sourcesEn, sourcesZh] of COUNTS) {
      expect(findingCount(n), `findingCount ${n}`).toEqual({ en: findingEn, zh: findingZh });
      expect(editionsLine(n), `editionsLine ${n}`).toEqual({ en: editionsEn, zh: editionsZh });
      expect(ledgerLine(n), `ledgerLine ${n}`).toEqual({ en: ledgerEn, zh: ledgerZh });
      expect(sourcesSummary(n), `sourcesSummary ${n}`).toEqual({ en: sourcesEn, zh: sourcesZh });
    }
    expect(editionsLine(10).en).toBe("10 editions, newest first.");
    expect(findingCount(Number.MAX_SAFE_INTEGER).en).toBe("9,007,199,254,740,991 findings");
  });

  it("refuses a count that is not a whole number of 0 or more", () => {
    const refused = (call: () => unknown, label: string): void => {
      expect(call, label).toThrow(RangeError);
      expect(call, label).toThrow(/A count is a whole number, 0 or more/);
    };
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      refused(() => findingCount(bad), `findingCount ${bad}`);
      refused(() => editionsLine(bad), `editionsLine ${bad}`);
      refused(() => ledgerLine(bad), `ledgerLine ${bad}`);
      refused(() => sourcesSummary(bad), `sourcesSummary ${bad}`);
      refused(() => fieldCount(bad, 0), `fieldCount reported ${bad}`);
      refused(() => fieldCount(0, bad), `fieldCount counted ${bad}`);
      refused(() => holdSummary({ cases: 1, held: bad, fell: 0, open: 0 }, 182), `holdSummary held ${bad}`);
      refused(() => holdSummary({ cases: 1, held: 0, fell: 0, open: 0 }, bad), `holdSummary days ${bad}`);
      refused(() => landmarkCompare({ year: 2026, ai: bad, all: 9 }, { ai: 1, all: 2 }), `landmarkCompare ai ${bad}`);
    }
  });

  it("fieldCount: `<n> reported, <m> counted` and 「報導 <n> 項，計入 <m> 項」, as the spec writes them", () => {
    expect(fieldCount(5, 2)).toEqual({ en: "5 reported, 2 counted", zh: "報導 5 項，計入 2 項" });
    expect(fieldCount(0, 0)).toEqual({ en: "0 reported, 0 counted", zh: "報導 0 項，計入 0 項" });
    expect(fieldCount(1200, 3)).toEqual({ en: "1,200 reported, 3 counted", zh: "報導 1,200 項，計入 3 項" });
    expect(SPEC).toContain("`<n> reported, <m> counted`, `報導 <n> 項，計入 <m> 項`");
  });

  it("editionLabel: the edition's label, then English-only when the Chinese is missing", () => {
    expect(editionLabel("full", false)).toEqual({ en: "Full", zh: "完整版" });
    expect(editionLabel("full", true)).toEqual({ en: "Full, English-only", zh: "完整版，僅英文版" });
    expect(editionLabel("partial", true)).toEqual({ en: "Partial, English-only", zh: "不完整版，僅英文版" });
    expect(editionLabel("data_only", false)).toEqual({ en: "Data-only", zh: "僅數據版" });
    expect(editionLabel("data_only", true)).toEqual({ en: "Data-only, English-only", zh: "僅數據版，僅英文版" });
    for (const edition of EDITIONS) {
      expect(editionLabel(edition, true).en).toBe(`${EDITION_INFO[edition].en}, ${ENGLISH_ONLY_LABEL.en}`);
      expect(editionLabel(edition, false)).not.toBe(EDITION_INFO[edition]);
    }
  });
});

describe("the chips and the findings' functions", () => {
  it("ladderName: the LadderBar's accessible name, with the step of five, and the rung alone for Disputed and Retracted", () => {
    expect(ladderName("claimed")).toEqual({ en: "Verification: Claimed (1 of 5)", zh: "查證：宣稱（第 1 階，共 5 階）" });
    expect(ladderName("preprint")).toEqual({ en: "Verification: Preprint (2 of 5)", zh: "查證：預印本（第 2 階，共 5 階）" });
    expect(ladderName("checked")).toEqual({ en: "Verification: Checked (3 of 5)", zh: "查證：已查核（第 3 階，共 5 階）" });
    expect(ladderName("confirmed")).toEqual({ en: "Verification: Confirmed (4 of 5)", zh: "查證：已證實（第 4 階，共 5 階）" });
    expect(ladderName("applied")).toEqual({ en: "Verification: Applied (5 of 5)", zh: "查證：已應用（第 5 階，共 5 階）" });
    expect(ladderName("disputed")).toEqual({ en: "Verification: Disputed", zh: "查證：有爭議" });
    expect(ladderName("retracted")).toEqual({ en: "Verification: Retracted", zh: "查證：已撤稿" });
    expect(SPEC).toContain('"Verification: Checked (3 of 5)"');
    expect(RUNGS).toHaveLength(5);
  });

  it("significanceChip: the pips and the word, in capitals in English", () => {
    expect(significanceChip("landmark")).toEqual({ en: "●●●● LANDMARK", zh: "●●●● 里程碑" });
    expect(significanceChip("major")).toEqual({ en: "●●●○ MAJOR", zh: "●●●○ 重大" });
    expect(significanceChip("notable")).toEqual({ en: "●●○○ NOTABLE", zh: "●●○○ 值得注意" });
    expect(significanceChip("watch")).toEqual({ en: "●○○○ WATCH", zh: "●○○○ 觀察中" });
    for (const level of SIGNIFICANCE) expect(significanceChip(level).en.startsWith(SIGNIFICANCE_INFO[level].pips + " ")).toBe(true);
    expect(SPEC).toContain("`●●●○ MAJOR`");
  });

  it("claimedBy: `claimed by <maker>`, with a space in Chinese only where Latin text meets a Han character", () => {
    expect(claimedBy("Google DeepMind")).toEqual({ en: "claimed by Google DeepMind", zh: "Google DeepMind 自稱" });
    expect(claimedBy("OpenAI").zh).toBe("OpenAI 自稱");
    expect(claimedBy("Lab 42").zh).toBe("Lab 42 自稱");
    expect(claimedBy("智譜")).toEqual({ en: "claimed by 智譜", zh: "智譜自稱" });
    expect(claimedBy("中研院 AI")).toEqual({ en: "claimed by 中研院 AI", zh: "中研院 AI 自稱" });
    expect(claimedBy("中研院 AI 計畫")).toEqual({ en: "claimed by 中研院 AI 計畫", zh: "中研院 AI 計畫自稱" });
    expect(claimedBy("Mestrovi\u0107").zh).toBe("Mestrovi\u0107 自稱");
    expect(claimedBy("DeepMind (Google)").zh).toBe("DeepMind (Google)自稱");
    expect(claimedBy("  OpenAI \n")).toEqual({ en: "claimed by OpenAI", zh: "OpenAI 自稱" });
    for (const blank of ["", " ", "\n"]) expect(() => claimedBy(blank), JSON.stringify(blank)).toThrow(RangeError);
    expect(SPEC).toContain("`claimed by <maker>`");
  });

  it("rungChange: `from → to` in words, in each language", () => {
    expect(rungChange("preprint", "checked")).toEqual({ en: "Preprint → Checked", zh: "預印本 → 已查核" });
    expect(rungChange("checked", "disputed")).toEqual({ en: "Checked → Disputed", zh: "已查核 → 有爭議" });
    expect(rungChange("disputed", "claimed")).toEqual({ en: "Disputed → Claimed", zh: "有爭議 → 宣稱" });
    expect(rungChange("confirmed", "retracted")).toEqual({ en: "Confirmed → Retracted", zh: "已證實 → 已撤稿" });
    expect(rungChange("checked", "applied").en).toContain(chr(0x2192));
  });

  it("argumentBy and reactionLine: who said it, with Chinese punctuation in Chinese", () => {
    expect(argumentBy("Ada Lovelace")).toEqual({ en: "Argued by Ada Lovelace", zh: "論點提出者：Ada Lovelace" });
    expect(reactionLine("Ada Lovelace", "University of London")).toEqual({ en: "Ada Lovelace, University of London", zh: "Ada Lovelace，University of London" });
    expect(reactionLine("王小明", "中央研究院")).toEqual({ en: "王小明, 中央研究院", zh: "王小明，中央研究院" });
    expect(reactionLine("Ada Lovelace", "中央研究院").zh).toBe("Ada Lovelace，中央研究院");
    expect(argumentBy("王小明")).toEqual({ en: "Argued by 王小明", zh: "論點提出者：王小明" });
    expect(argumentBy(" Ada Lovelace\n")).toEqual({ en: "Argued by Ada Lovelace", zh: "論點提出者：Ada Lovelace" });
    expect(reactionLine(" Ada Lovelace ", "\tUniversity of London")).toEqual({ en: "Ada Lovelace, University of London", zh: "Ada Lovelace，University of London" });
    expect(() => argumentBy(" ")).toThrow(RangeError);
    expect(() => reactionLine("", "University of London")).toThrow(RangeError);
    expect(() => reactionLine("Ada Lovelace", "\n")).toThrow(RangeError);
  });

  it("whyToday, correctionWord and reportStatus: one label for each value of the vocabulary, as a fresh copy", () => {
    expect(WHY_TODAY.map((why) => whyToday(why))).toEqual([
      { en: "New this week", zh: "本週新進展" }, { en: "Anniversary", zh: "週年紀念" }, { en: "From the Ledger", zh: "取自發現紀錄" },
    ]);
    expect(CORRECTION_TYPES.map((type) => correctionWord(type))).toEqual([
      { en: "Corrected", zh: "已更正" }, { en: "Clarified", zh: "已釐清" }, { en: "Updated", zh: "已更新" }, { en: "Text removed", zh: "已移除文字" },
    ]);
    expect(REPORT_STATUS.map((status) => reportStatus(status))).toEqual([
      { en: "Open", zh: "待查核" }, { en: "Upheld", zh: "成立" }, { en: "Rejected", zh: "不成立" },
    ]);
    expect(whyToday("news")).not.toBe(PAGE_TEXT["deepdive.why.news"]);
    expect(correctionWord("removed")).not.toBe(PAGE_TEXT["correction.removed"]);
    expect(reportStatus("open")).not.toBe(PAGE_TEXT["report.open"]);
  });

  it("figureCaption: the credit as written, then the licence, and never without a credit", () => {
    const credit = "Figure 2 from Parker et al., Science (2025), CC BY 4.0";
    expect(figureCaption(credit, "CC-BY-4.0")).toEqual({
      en: `Credit: ${credit} · Licence: CC BY 4.0`,
      zh: `圖片出處：${credit} · 授權：CC BY 4.0`,
    });
    expect(figureCaption("Figure 1", "CC-BY-SA-4.0")).toEqual({ en: "Credit: Figure 1 · Licence: CC BY-SA 4.0", zh: "圖片出處：Figure 1 · 授權：CC BY-SA 4.0" });
    expect(figureCaption("Figure 1", "CC0-1.0")).toEqual({ en: "Credit: Figure 1 · Licence: CC0 1.0", zh: "圖片出處：Figure 1 · 授權：CC0 1.0" });
    expect(figureCaption("Figure 1", "public-domain")).toEqual({ en: "Credit: Figure 1 · Licence: Public domain", zh: "圖片出處：Figure 1 · 授權：公有領域" });
    expect(FIGURE_LICENCES.map((licence) => figureCaption("x", licence).en.split("Licence: ")[1])).toEqual(["CC BY 4.0", "CC BY-SA 4.0", "CC0 1.0", "Public domain"]);
    expect(figureCaption("  Figure 1 \n", "CC0-1.0")).toEqual({ en: "Credit: Figure 1 · Licence: CC0 1.0", zh: "圖片出處：Figure 1 · 授權：CC0 1.0" });
    for (const blank of ["", "  ", "\n"]) expect(() => figureCaption(blank, "CC0-1.0"), JSON.stringify(blank)).toThrow(RangeError);
  });
});

describe("the Ledger's facets", () => {
  it("yearLabel: a year as itself in English and with 年 in Chinese, from four digits only", () => {
    expect(yearLabel(2026)).toEqual({ en: "2026", zh: "2026 年" });
    expect(yearLabel("2015")).toEqual({ en: "2015", zh: "2015 年" });
    for (const bad of [99, "99", 999, "999", "20260", 2026.5, -2026, "abcd", "", " 2026", "2026 ", "２０２６"]) expect(() => yearLabel(bad), String(bad)).toThrow(RangeError);
  });

  it("facetHeading: the facet's name, then its value in each language", () => {
    expect(facetHeading("field", FIELD_INFO.biology)).toEqual({ en: "Field: Biology and medicine", zh: "領域：生物與醫學" });
    expect(facetHeading("rung", RUNG_INFO.checked)).toEqual({ en: "Rung: Checked", zh: "層級：已查核" });
    expect(facetHeading("role", AI_ROLE_INFO.ai_solved)).toEqual({ en: "AI role: AI-solved", zh: "AI 角色：AI 解出" });
    expect(facetHeading("year", yearLabel(2026))).toEqual({ en: "Year: 2026", zh: "年份：2026 年" });
  });
});

describe("the charts and counters' functions", () => {
  it("breakdownLabel: the five keys of the spec from the table, a year as itself, anything else null", () => {
    expect(breakdownLabel("1")).toEqual({ en: "Phase 1", zh: "臨床第 1 期" });
    expect(breakdownLabel("2")).toEqual({ en: "Phase 2", zh: "臨床第 2 期" });
    expect(breakdownLabel("3")).toEqual({ en: "Phase 3", zh: "臨床第 3 期" });
    expect(breakdownLabel("approved")).toEqual({ en: "Approved", zh: "已核准" });
    expect(breakdownLabel("total")).toEqual({ en: "Total", zh: "總計" });
    expect(breakdownLabel("2025")).toEqual({ en: "2025", zh: "2025 年" });
    for (const other of ["", "4", "0", "Approved", "TOTAL", "12345", "202", "2025x", " 2025", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(breakdownLabel(other), JSON.stringify(other)).toBeNull();
    }
    expect(breakdownLabel("1")).not.toBe(PAGE_TEXT["counters.phase1"]);
    expect(SPEC).toContain("The `breakdown` keys `1`, `2`, `3`, `approved` and `total` take their labels from `lib/page-text.ts`");
  });

  it("counterAsOf: a counter's date, in each language", () => {
    expect(counterAsOf("2026-11-07")).toEqual({ en: "as of 7 Nov 2026", zh: "截至 2026 年 11 月 7 日" });
    expect(counterAsOf("2025-01-31")).toEqual({ en: "as of 31 Jan 2025", zh: "截至 2025 年 1 月 31 日" });
    expect(() => counterAsOf("2025-02-30")).toThrow();
  });

  it("landmarkCompare: C as counts, the spec's example first, and the words for a tally of no Landmark", () => {
    expect(landmarkCompare({ year: 2026, ai: 5, all: 9 }, { ai: 4, all: 46 })).toEqual({
      en: "5 of 9 in 2026 so far, against 4 of 46 in 2015 to 2019",
      zh: "2026 年至今 9 項中有 5 項，2015 至 2019 年為 46 項中有 4 項",
    });
    expect(SPEC).toContain('"5 of 9 in 2026 so far, against 4 of 46 in 2015 to 2019"');
    expect(landmarkCompare({ year: 2026, ai: 0, all: 0 }, { ai: 4, all: 46 })).toEqual({
      en: "no Landmarks in 2026 so far, against 4 of 46 in 2015 to 2019",
      zh: "2026 年至今還沒有里程碑發現，2015 至 2019 年為 46 項中有 4 項",
    });
    expect(landmarkCompare({ year: 2026, ai: 5, all: 9 }, { ai: 0, all: 0 })).toEqual({
      en: "5 of 9 in 2026 so far, against no Landmarks in 2015 to 2019",
      zh: "2026 年至今 9 項中有 5 項，2015 至 2019 年沒有里程碑發現",
    });
    expect(landmarkCompare({ year: 2026, ai: 0, all: 0 }, { ai: 0, all: 0 })).toEqual({
      en: "no Landmarks in 2026 so far or in 2015 to 2019",
      zh: "2026 年至今和 2015 至 2019 年都沒有里程碑發現",
    });
    expect(landmarkCompare({ year: 2027, ai: 0, all: 12 }, { ai: 1200, all: 1500 }).en).toBe("0 of 12 in 2027 so far, against 1,200 of 1,500 in 2015 to 2019");
    expect(landmarkCompare({ year: 2026, ai: 1200, all: 1500 }, { ai: 4, all: 46 })).toEqual({
      en: "1,200 of 1,500 in 2026 so far, against 4 of 46 in 2015 to 2019",
      zh: "2026 年至今 1,500 項中有 1,200 項，2015 至 2019 年為 46 項中有 4 項",
    });
    expect(landmarkCompare({ year: 2026, ai: 5, all: 9 }, { ai: 0, all: 46 })).toEqual({
      en: "5 of 9 in 2026 so far, against 0 of 46 in 2015 to 2019",
      zh: "2026 年至今 9 項中有 5 項，2015 至 2019 年為 46 項中有 0 項",
    });
    expect(() => landmarkCompare({ year: 26, ai: 1, all: 2 }, { ai: 1, all: 2 })).toThrow(RangeError);
    expect(() => landmarkCompare({ year: 2026, ai: -1, all: 2 }, { ai: 1, all: 2 })).toThrow(RangeError);
    expect(() => landmarkCompare({ year: 2026, ai: 1, all: 2 }, { ai: 1, all: 2.5 })).toThrow(RangeError);
  });

  it("holdSummary: D's counts in a sentence, singular for one, and what a case is when there is none", () => {
    expect(holdSummary({ cases: 23, held: 15, fell: 3, open: 5 }, 182)).toEqual({
      en: "Of 23 AI claims first briefed at least 182 days ago, 15 held up, 3 fell and 5 are still open.",
      zh: "首次報導至少 182 天的 23 項 AI 說法中，15 項經得起檢驗，3 項經不起檢驗，5 項尚未定論。",
    });
    expect(holdSummary({ cases: 1, held: 0, fell: 0, open: 1 }, 182)).toEqual({
      en: "Of 1 AI claim first briefed at least 182 days ago, 0 held up, 0 fell and 1 is still open.",
      zh: "首次報導至少 182 天的 1 項 AI 說法中，0 項經得起檢驗，0 項經不起檢驗，1 項尚未定論。",
    });
    expect(holdSummary({ cases: 2, held: 1, fell: 0, open: 1 }, 90).en).toBe("Of 2 AI claims first briefed at least 90 days ago, 1 held up, 0 fell and 1 is still open.");
    expect(holdSummary({ cases: 3, held: 2, fell: 1, open: 0 }, 182).en).toBe("Of 3 AI claims first briefed at least 182 days ago, 2 held up, 1 fell and 0 are still open.");
    expect(holdSummary({ cases: 3, held: 1, fell: 0, open: 2 }, 1)).toEqual({
      en: "Of 3 AI claims first briefed at least 1 day ago, 1 held up, 0 fell and 2 are still open.",
      zh: "首次報導至少 1 天的 3 項 AI 說法中，1 項經得起檢驗，0 項經不起檢驗，2 項尚未定論。",
    });
    expect(holdSummary({ cases: 0, held: 0, fell: 0, open: 0 }, 1).en).toBe("No AI claims to judge yet. A case is a claim first briefed at least 1 day ago.");
    expect(holdSummary({ cases: 0, held: 0, fell: 0, open: 0 }, 90)).toEqual({
      en: "No AI claims to judge yet. A case is a claim first briefed at least 90 days ago.",
      zh: "還沒有可判斷的 AI 說法。案例是指首次報導至少 90 天的說法。",
    });
    expect(holdSummary({ cases: 0, held: 0, fell: 0, open: 0 }, 1500).zh).toBe("還沒有可判斷的 AI 說法。案例是指首次報導至少 1,500 天的說法。");
    expect(holdSummary({ cases: 3, held: 1, fell: 0, open: 2 }, 0).en).toBe("Of 3 AI claims first briefed at least 0 days ago, 1 held up, 0 fell and 2 are still open.");
    expect(holdSummary({ cases: 3, held: 1, fell: 0, open: 2 }, 1500).zh).toContain("首次報導至少 1,500 天的 3 項");
    expect(holdSummary({ cases: 1500, held: 1000, fell: 300, open: 200 }, 182).en).toContain("Of 1,500 AI claims");
    expect(holdSummary({ cases: 0, held: 0, fell: 0, open: 0 }, 182)).toEqual({
      en: "No AI claims to judge yet. A case is a claim first briefed at least 182 days ago.",
      zh: "還沒有可判斷的 AI 說法。案例是指首次報導至少 182 天的說法。",
    });
    expect(() => holdSummary({ cases: 3, held: 1, fell: 1, open: -1 }, 182)).toThrow(RangeError);
    expect(() => holdSummary({ cases: 3, held: 1, fell: 1, open: 1 }, 1.5)).toThrow(RangeError);
  });
});

describe("what every function returns", () => {
  it("is a Bilingual, which an L10n can hold", () => {
    expectTypeOf(noEditionYet("08:00")).toEqualTypeOf<Bilingual>();
    expectTypeOf(staleBanner("2026-11-07", T_PLUS8)).toEqualTypeOf<Bilingual>();
    expectTypeOf(breakdownLabel("1")).toEqualTypeOf<Bilingual | null>();
    expectTypeOf(pageTitle("a", "b")).toBeString();
    expectTypeOf(pageText("nav.today", "en")).toBeString();
    for (const { name, text } of SAMPLES) {
      expect(Object.keys(text).sort(), name).toEqual(["en", "zh"]);
      expect(typeof text.en, name).toBe("string");
      expect(typeof text.zh, name).toBe("string");
    }
  });
});

// ── The source files ─────────────────────────────────────────────────────────────────────────────

describe("lib/page-text.ts and this test", () => {
  it("hold no em dash and no en dash outside digits (NO_EM_DASH), and no tab", () => {
    for (const [file, text] of [["lib/page-text.ts", SOURCE], ["tests/page-text.test.ts", THIS_FILE]] as const) {
      const rest = text.replace(new RegExp(`(?<=\\d)${EN}(?=\\d)`, "g"), "");
      expect(rest, file).not.toContain(EM);
      expect(rest, file).not.toContain(EN);
      expect(text, file).not.toContain("\t");
    }
  });

  it("is pure: it reads no config, no file, no clock and no environment, and imports no React", () => {
    expect(SOURCE).not.toMatch(/from "(?:node:|fs|path|react|next)/);
    expect(SOURCE).not.toMatch(/from "(?:\.\/|\.\.\/|@\/)(?:config|site|content)"/);
    expect(SOURCE).not.toMatch(/\bDate\.now\b|new Date\(|\bprocess\.|\brequire\(|\bfetch\(|Math\.random/);
    expect(SOURCE).not.toMatch(/dangerouslySetInnerHTML/);
    for (const m of SOURCE.matchAll(/^import (?:type )?\{[^}]*\} from "([^"]+)";/gms)) expect(m[1], m[0]).toMatch(/^\.\//);
  });

  it("has every exported function run by this test", () => {
    const names = [...SOURCE.matchAll(/^export function (\w+)/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThanOrEqual(26);
    for (const name of names) expect(THIS_FILE, name).toMatch(new RegExp(`\\b${name}\\(`));
    for (const name of ["PAGE_TEXT", "PAGE_TEXT_KEYS", "MAIN_TABS", "SIBLING_TABS"]) expect(THIS_FILE, name).toContain(name);
  });

  it("names no URL", () => {
    expect(SOURCE).not.toMatch(/https?:\/\//);
  });
});
