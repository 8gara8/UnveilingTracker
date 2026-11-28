// The prose that only the sample week's hand-built drafts carry (SPEC §4.12 "Fixtures and tests", §10 P1), kept apart from the engine of
// `site.ts` so each text is written once: the Lead lines of Monday, Tuesday, Friday and Saturday, Monday's short big picture, Saturday's
// two Also noted lines with their two brief-level sources, and the Chinese of the strings that the shared table (`world-zh.ts`) does
// not hold, since the world's own drafts never wrote them (Tuesday's edition is English only, so its Lead has no Chinese). The Wednesday and Sunday drafts are the world's and bring their own text.
//
// Every title and every named person or organisation is marked SAMPLE, as the world's are; the lines that only the sample week writes
// are plain prose that holds to the same budgets as the world's (the Lead 60 words in all, the short big picture 120 words, an Also
// noted title 20 words) and to `config/hype-words.json`. Every source here is an invented arXiv record on a host the allowlist holds.
//
// New for this project (Cyber's fixtures/src/site.ts holds data, not prose).

import { zhText } from "./world-zh";

// ── Monday 2026-10-12: the short review ──────────────────────────────────────────────────────────

/** The two Lead sentences: the story (the weather model) and the item (the fusion controller). */
export const MONDAY_LEAD = [
  "An AI weather model forecasts ten days ahead.",
  "An AI controller steadied a fusion test machine.",
] as const;

/**
 * A week with fewer than 3 findings has a big picture of at most 120 words (SPEC §4.5): the sample's first Monday has no earlier edition,
 * so it says so. It names Claude once, so the brief's `disclosure` lists `review` (SPEC §4.4).
 */
export const MONDAY_BIG_PICTURE =
  "This is the first review in the sample record, so there is no earlier week to compare. No finding cleared our bar in the week before it. "
  + "A quiet week is not evidence for or against the hope that AI is speeding up discovery. We would rather say so than pad this page. "
  + "From here, each Monday looks back over the week: what changed in our understanding, what stood out, and what did not hold up. "
  + "Some findings involve AI tools from companies that also help draft this site, such as Claude, and we mark each one when it does.";

// ── Tuesday 2026-10-13: English only ─────────────────────────────────────────────────────────────

/** The three Lead sentences: the tiling proof (story), the robot lab, and the journal's finding about reviewers. The fourth item (the survey dataset) is not in the Lead. */
export const TUESDAY_LEAD = [
  "Mathematicians proved that one kind of tile can fill a surface only without repeating.",
  "A robot lab found a cheap metal mixture that splits water.",
  "A journal says reviewers shared unpublished papers with an AI chatbot.",
] as const;

// ── Friday 2026-10-16: a day with no new finding ─────────────────────────────────────────────────

export const FRIDAY_LEAD = "Nothing new cleared our bar today, but the evidence for an AI-proposed antibiotic grew stronger.";

// ── Saturday 2026-10-17: a quiet day with two Also noted lines ───────────────────────────────────

/** A day with no finding says so (SPEC §4.5): its one Lead sentence cites no finding. */
export const SATURDAY_LEAD = "No finding cleared our bar today, and two preprints are listed under Also noted.";

/** The two Also noted lines; the first names Claude, with an arXiv source, so `also.0` is in the brief's `disclosure` (SPEC §4.4). */
export const SATURDAY_ALSO = [
  { title: "SAMPLE: A preprint on checking a proof with Claude, step by step", field: "mathematics" },
  { title: "SAMPLE: A preprint on reading worn clay tablets with a vision model", field: "humanities" },
] as const;

/** The brief-level sources of the two Also noted lines, `b1` and `b2`: invented arXiv records, never fetched. */
export const SATURDAY_SOURCES = [
  {
    kind: "preprint", title: "SAMPLE: Checking a proof with Claude, step by step", publisher: "arXiv", url: "https://arxiv.org/abs/2610.99004",
    doi: null, published_at: "2026-10-16T08:00:00+08:00", seen: "pack",
  },
  {
    kind: "preprint", title: "SAMPLE: Reading worn clay tablets with a vision model", publisher: "arXiv", url: "https://arxiv.org/abs/2610.99005",
    doi: null, published_at: "2026-10-16T09:00:00+08:00", seen: "search",
  },
] as const;

// ── Chinese ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The Chinese of the English strings above, in Taiwan usage. A string of the world's drafts is in `world-zh.ts` and not here. The
 * Chinese holds each fixed translation of `config/terms-zh.json` that its English triggers (AI, model, journal), no mainland term and
 * no hype word, and each Lead stays within its group's 108 characters and the big picture within 216 (SPEC §4.6).
 */
const ZH_EXTRA: Readonly<Record<string, string>> = {
  [MONDAY_LEAD[0]]: "一個 AI 天氣模型能預報未來十天的天氣。",
  [MONDAY_LEAD[1]]: "AI 控制器讓一部核融合實驗機維持穩定。",
  [MONDAY_BIG_PICTURE]:
    "這是範例紀錄中的第一次週回顧，沒有更早的一週可以比較。前一週沒有任何發現達到我們的門檻。"
    + "平靜的一週，既不能證明也不能否定「AI 正在加快科學發現」這個期望。我們寧可直說，也不想硬湊內容。"
    + "往後每個星期一，我們會回顧過去一週：我們的理解有什麼改變、哪些發現最突出，以及哪些沒有站得住腳。"
    + "有些發現涉及也協助撰寫本站的公司所開發的 AI 工具，例如 Claude，我們會逐一標示。",
  [FRIDAY_LEAD]: "今天沒有新的發現達到我們的門檻，但一項由 AI 提出的抗生素，證據變得更強了。",
  [SATURDAY_LEAD]: "今天沒有發現達到我們的門檻，另有兩篇預印本列在「另外值得一提」。",
  [SATURDAY_ALSO[0].title]: "SAMPLE：以 Claude 逐步檢查證明的預印本",
  [SATURDAY_ALSO[1].title]: "SAMPLE：以視覺模型讀取磨損泥板的預印本",
};

/**
 * The Chinese of an English sample string: the table of this file for the sample week's own text, else the world's table
 * (`world-zh.ts`, which throws for a string it lacks, so a changed sentence cannot keep an old translation).
 */
export function zhOf(en: string): string {
  return ZH_EXTRA[en] ?? zhText(en);
}

/** Every English string this file translates. */
export const ZH_EXTRA_ENGLISH: readonly string[] = Object.keys(ZH_EXTRA);
