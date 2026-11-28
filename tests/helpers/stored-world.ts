// A small hand-built stored world for the stored-record engines' tests (SPEC §3, §4.12 "Stored records"): the records of three
// editions in the layout of SPEC §3, self-consistent so that the rules of lib/rules/published.ts find nothing to report, and a
// function that writes them to a folder. Every value is parsed through its schema, so a builder that drifts from the schema fails at
// once, and every call returns a fresh copy a test may change. The text is made up: no real paper, lab or result, and short, so it
// does not meet the word budgets that other rule groups hold the sample content to.
//
// The world, oldest first:
//   2026-11-18 (Wednesday)  A full edition in English only (`languages.zh` false, every `zh` null). Its story is
//                           `bio-2026-0001` and its one item `math-2026-0002`; the terms `protein-folding` and `proof-assistant`
//                           are first used, both without Chinese.
//   2026-11-19 (Thursday)   A full edition in both languages. Its story is `phys-2026-0003` (new, with its term and figure) and its
//                           one item is `bio-2026-0001` returning: the Chinese pass translated that finding, its rung note and its
//                           term. It lists the correction C-0001 (a reader's report on `bio-2026-0001`'s `explainer.how_sure`) and
//                           the report R-0001 that the correction answers.
//   2026-11-20 (Friday)     A data-only edition with `languages.zh` true: the Pace and one script rung change on `phys-2026-0003`.
//   `math-2026-0002` and `proof-assistant` stay English-only for good, and R-0002 is an open report no brief lists.
// `addSunday()` and `addMonday()` add a Sunday deep dive (on `bio-2026-0001`) and a Monday review to a copy of the world.
// Every edition has a metrics file and a status file (a whole-folder run's XREF checks that a brief's two files exist); only the
// data-only edition has an inputs manifest.
//
// New for this project; Cyber's tests built their stored records inline in each test file.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, type LoadedConfig } from "../../lib/config";
import { addDays, dataCutoffFor, lastSunday, weekday } from "../../lib/dates";
import { Brief } from "../../lib/schema/brief";
import { Finding } from "../../lib/schema/finding";
import { Term } from "../../lib/schema/glossary";
import { InputsManifest, MetricsFile, PaceWeeklyFile } from "../../lib/schema/metrics";
import { ArchiveIndex, Correction, Report } from "../../lib/schema/misc";
import { StatusFile } from "../../lib/schema/status";
import { normalizeUrl } from "../../lib/urls";
import { FIELDS, NONE_FOUND, REMOVED_TEXT, formatForWeekday, statusNote } from "../../lib/vocab";

// ── Names ────────────────────────────────────────────────────────────────────────────────────────

/** The three editions of the base world. */
export const EN_ONLY = "2026-11-18";
export const BILINGUAL = "2026-11-19";
export const DATA_ONLY = "2026-11-20";
/** The editions `addSunday()` and `addMonday()` add. */
export const SUNDAY = "2026-11-22";
export const MONDAY = "2026-11-23";

/** The findings: a story of the English-only edition, its item (English-only for good), and the bilingual edition's story. */
export const PROTEIN = "bio-2026-0001";
export const PROOF = "math-2026-0002";
export const LIGHT = "phys-2026-0003";

export const FOLDING = "protein-folding";
export const ASSISTANT = "proof-assistant";
export const LATTICE = "lattice";

export type Json = Record<string, any>;

export const l = (en: string): { en: string; zh: null } => ({ en, zh: null });
export const lz = (en: string, zh: string): { en: string; zh: string } => ({ en, zh });

/** A deep copy. */
export const clone = <T>(value: T): T => structuredClone(value);

/** Freezes a value and everything inside it, so a function that changes its input throws. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as object)) deepFreeze(inner);
  }
  return value;
}

let cachedConfig: LoadedConfig | null = null;
/** The repo's config/, loaded once (every test reads it, none changes it). */
export function config(): LoadedConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

// ── The records ──────────────────────────────────────────────────────────────────────────────────

export interface StoredWorld {
  /** Oldest first. */
  briefs: Brief[];
  /** In id order (`compareFindingIds`). */
  findings: Finding[];
  /** In id order (code units). */
  terms: Term[];
  /** C-0001, C-0002 and on, oldest first. */
  corrections: Correction[];
  /** R-0001, R-0002 and on. */
  reports: Report[];
  archive: ArchiveIndex;
  /** One per brief, in the brief's order. */
  metrics: MetricsFile[];
  inputs: InputsManifest[];
  status: StatusFile[];
  pace: PaceWeeklyFile;
}

const PACE_EN = "The Pace: 8.4% of papers named AI methods.";
const PACE_ZH = "進度：8.4% 的論文提到 AI 方法。";
const SAMPLE_COMMIT = "a".repeat(40);

const source = (id: string, o: Json): Json => ({
  id, kind: "paper", title: `A made-up paper ${id}`, publisher: "Nature", url: `https://www.nature.com/articles/nature-ut-store-${id}`,
  doi: null, published_at: "2026-11-17", seen_as: "pack", added: EN_ONLY, ...o,
});

/** What `explainer.how_sure` of `bio-2026-0001` says once C-0001 has corrected it, and what it said before. */
const HOW_SURE_PROTEIN = {
  en: "Checked: Nature published the paper after outside reviewers read it. The lab's own measurements agree with the model. Other groups have not yet repeated the work, so the result may still be refined.",
  zh: "已查核：Nature 在外部審查者讀過之後刊出了這篇論文。實驗室自己的測量與模型相符。其他團隊還沒有重複這項工作，所以結果仍可能修正。",
};
const HOW_SURE_PROTEIN_BEFORE =
  "Checked: Nature published the paper. The lab's own measurements agree with the model. Other groups have not yet repeated the work, so the result may still be refined.";

const emptyArtefacts = (): Json => ({ doi: [], arxiv: [], lean: [], trial: [], pdb: [] });

/** The first finding: a biology story of the English-only edition, translated and corrected by the bilingual one. */
function protein(): Finding {
  return Finding.parse({
    schema_version: 1,
    id: PROTEIN,
    field: "biology",
    subfield: "proteins",
    kind: "result",
    title: lz("A sample protein result", "範例蛋白質成果"),
    depth: "story",
    explainer: {
      found: lz(
        "A sample system worked out protein folding, the way a long chain of building blocks curls into its final shape. The team gave it only the order of the blocks. The shape it proposed matched what the lab later measured, and it took hours instead of the months that careful lab work usually needs.",
        "範例系統解開了蛋白質摺疊（protein folding）之謎：一條由許多基本單元組成的長鏈，如何捲成最後的形狀。研究團隊只給它這些單元的排列順序。它提出的形狀與實驗室後來量到的相符，而且只花了幾個小時，不像細緻的實驗室工作通常要花好幾個月。",
      ),
      matters: lz(
        "A protein's shape tells researchers what it does and how a drug might fit it. Finding a shape has meant long lab work for each protein. A fast and reliable guess lets teams choose which proteins deserve that careful work, and which can wait.",
        "蛋白質的形狀決定它的功能，也決定藥物能不能嵌進去。過去要找出一種形狀，每個蛋白質都得花很久的實驗室工作。快速又可靠的推測，讓團隊能挑出哪些蛋白質值得投入細緻的實驗，哪些可以先等一等。",
      ),
      ai_helped: lz(
        "Sample System 3, from Example Lab, proposed the shape. The lab gave it the chain, and the system returned a three-dimensional model with a score for each part. People at the lab then ran the measurements that tested the model. The system did not run any experiment itself.",
        "Example Lab 的 Sample System 3 提出了這個形狀。實驗室把蛋白質鏈交給它，系統回傳一個立體模型，並替每個部分打分數。實驗室的人員接著做了測量來檢驗這個模型。系統本身沒有做任何實驗。",
      ),
      // The text C-0001 corrected to (its `after`).
      how_sure: lz(HOW_SURE_PROTEIN.en, HOW_SURE_PROTEIN.zh),
      background: lz(
        "Proteins are chains of small building blocks. Each chain folds on its own into a shape, and the shape decides what the protein can do inside a living cell.",
        "蛋白質是由許多小單元組成的長鏈。每條鏈都會自己摺成一種形狀，這個形狀決定蛋白質在活細胞裡能做什麼。",
      ),
      could_lead: lz(
        "It could help researchers design new proteins, such as ones that break down waste. That use is still a hope. No such protein has been built from this result yet.",
        "它可能幫助研究人員設計新的蛋白質，例如能分解廢棄物的蛋白質。這仍然只是期望。目前還沒有任何蛋白質是依這項成果做出來的。",
      ),
    },
    go_deeper: ["s1"],
    ai: {
      role: "ai_solved",
      confidence: "confirmed",
      systems: [{ name: "Sample System 3", maker: "Example Lab" }],
      evidence: [{ source_id: "s1", quote: "the system solved it", from_claimant: false }],
    },
    significance: "major",
    rung: "checked",
    rung_history: [
      { rung: "preprint", date: "2026-10-01", recorded: EN_ONLY, source_id: "s2", by: "agent", note: null },
      {
        rung: "checked", date: "2026-11-17", recorded: EN_ONLY, source_id: "s1", by: "agent",
        note: lz("Published in Nature after peer review.", "經同儕審查後發表於《Nature》。"),
      },
    ],
    since_then: [{ date: BILINGUAL, text: lz("The source note was corrected after a reader's report.", "讀者回報後，來源說明已更正。"), source_ids: ["s1"] }],
    sources: [
      source("s1", { doi: "10.1038/nature-ut-store-0001", url: "https://www.nature.com/articles/nature-ut-store-0001" }),
      source("s2", { kind: "preprint", publisher: "arXiv", url: "https://arxiv.org/abs/2610.00001", published_at: "2026-10-01", seen_as: "search" }),
    ],
    reactions: [],
    artefacts: { ...emptyArtefacts(), doi: ["10.1038/nature-ut-store-0001"] },
    figure: null,
    who: [{ name: "Example Lab", ror: null }],
    terms: [FOLDING],
    related: [PROOF],
    first_published: "2026-10-01",
    first_brief: EN_ONLY,
    briefs: [EN_ONLY, BILINGUAL],
    history: false,
    disclosure: false,
    applications: [],
    updated: BILINGUAL,
  });
}

/** The second finding: a mathematics item of the English-only edition that no later edition names, so it stays English-only. */
function proof(): Finding {
  return Finding.parse({
    schema_version: 1,
    id: PROOF,
    field: "mathematics",
    subfield: "formal-proof",
    kind: "result",
    title: l("A sample proof checked by a program"),
    depth: "item",
    explainer: {
      found: l("A sample system found a proof of a made-up statement about whole numbers, and a proof assistant then checked each step of it. The statement had no known proof before."),
      matters: l("It shows what this method can do on a small, well-defined problem. Larger problems are still out of reach."),
      ai_helped: l("Sample Prover, from Example Lab, searched for the proof. A proof assistant then checked each step."),
      how_sure: l("Preprint: arXiv carries the paper, and no journal has reviewed it. Example Lab, the maker of the system, reports the result."),
      background: l("Proof assistants are programs that check every step of a proof. If a step is wrong, the program refuses it."),
      could_lead: l("Other proofs may follow, but that is not yet known."),
    },
    go_deeper: ["s1"],
    ai: {
      role: "ai_solved",
      confidence: "claimed",
      systems: [{ name: "Sample Prover", maker: "Example Lab" }],
      evidence: [{ source_id: "s1", quote: "the prover found the proof", from_claimant: true }],
    },
    significance: "notable",
    rung: "preprint",
    rung_history: [{ rung: "preprint", date: "2026-11-12", recorded: EN_ONLY, source_id: "s1", by: "agent", note: null }],
    since_then: [],
    sources: [source("s1", { kind: "preprint", publisher: "arXiv", url: "https://arxiv.org/abs/2611.00002", published_at: "2026-11-12", seen_as: "search" })],
    reactions: [],
    artefacts: emptyArtefacts(),
    figure: null,
    who: [{ name: "Example Lab", ror: null }],
    terms: [ASSISTANT],
    related: [],
    first_published: "2026-11-12",
    first_brief: EN_ONLY,
    briefs: [EN_ONLY],
    history: false,
    disclosure: false,
    applications: [],
    updated: EN_ONLY,
  });
}

/** The third finding: a physics story of the bilingual edition, with a figure, whose rung a script change moved on the data-only day. */
function light(): Finding {
  return Finding.parse({
    schema_version: 1,
    id: LIGHT,
    field: "physics",
    subfield: "atoms-optics",
    kind: "result",
    title: lz("A sample light-trapping result", "範例光捕捉成果"),
    depth: "story",
    explainer: {
      found: lz(
        "A sample tool found a new way to hold atoms in a lattice, a grid made of light. Physicists use such grids to keep single atoms still so they can study them. The tool searched thousands of layouts and picked one that holds the atoms more steadily than the usual design.",
        "範例工具找到一種新方法，把原子固定在晶格（lattice）裡，這是一種由光組成的格子。物理學家用這種格子讓單一原子保持不動，好研究它們。這個工具搜尋了數千種排列，挑出一種比常用設計更穩定地固定原子的排列。",
      ),
      matters: lz(
        "Steadier atoms make experiments more exact. Atomic clocks and some quantum devices depend on holding atoms still for a long time, so even a small gain adds up. A better grid could make both kinds of device work with fewer errors.",
        "原子更穩定，實驗就更精準。原子鐘和一些量子裝置都得讓原子長時間保持不動，所以即使一點小進步也會累積起來。更好的格子可以讓這兩種裝置少出一些錯。",
      ),
      ai_helped: lz(
        "Sample Optimizer, from Example Institute, chose the layout. The team described what a good grid should do, and the tool tried thousands of designs on a computer and scored each one. The team then built the best design in the lab and tested it. The tool did not run the lab work.",
        "Example Institute 的 Sample Optimizer 選出了這個排列。團隊先說明好格子該有什麼表現，工具就在電腦上試了數千種設計並替每一種打分數。團隊接著在實驗室裡做出最好的設計並加以測試。這個工具沒有做實驗室的工作。",
      ),
      how_sure: lz(
        "Preprint: arXiv carries the paper, and outside reviewers have not read it yet. The team's own measurements show the gain. Treat the result as promising but unconfirmed until a journal publishes it.",
        "預印本：arXiv 刊出了這篇論文，外部審查者還沒有讀過。團隊自己的測量顯示了這項進步。在期刊刊出之前，請把這個結果視為有希望但尚未證實。",
      ),
      background: lz(
        "Light waves can overlap to form bright and dark stripes. In a lattice, the bright spots act like little dishes that each hold one atom.",
        "光波可以重疊，形成明暗相間的條紋。在晶格裡，亮點就像一個個小碟子，每個碟子各固定一個原子。",
      ),
      could_lead: lz(
        "It could lead to steadier atomic clocks. That is a possibility, not a result: no clock has used the new design yet, and building one would take years of further work.",
        "它可能帶來更穩定的原子鐘。這是一種可能，不是已經發生的結果：目前還沒有任何原子鐘用過這項新設計，要做出來還需要多年的後續研究。",
      ),
    },
    go_deeper: ["s1"],
    ai: {
      role: "ai_tool",
      confidence: "confirmed",
      systems: [{ name: "Sample Optimizer", maker: "Example Institute" }],
      evidence: [{ source_id: "s1", quote: "we used a learned optimizer", from_claimant: false }],
    },
    significance: "major",
    rung: "checked",
    rung_history: [
      { rung: "preprint", date: "2026-11-10", recorded: BILINGUAL, source_id: "s1", by: "agent", note: null },
      {
        rung: "checked", date: "2026-11-19", recorded: DATA_ONLY, source_id: "s2", by: "script",
        note: lz("Published in Nature after peer review.", "經同儕審查後發表於《Nature》。"),
      },
    ],
    since_then: [],
    sources: [
      source("s1", { kind: "preprint", publisher: "arXiv", url: "https://arxiv.org/abs/2611.00003", published_at: "2026-11-10", seen_as: "pack", added: BILINGUAL }),
      source("s2", {
        doi: "10.1038/nature-ut-store-0003", url: "https://www.nature.com/articles/nature-ut-store-0003", published_at: "2026-11-19",
        seen_as: "fetched", added: DATA_ONLY,
      }),
    ],
    reactions: [],
    artefacts: { ...emptyArtefacts(), doi: ["10.1038/nature-ut-store-0003"] },
    figure: {
      source_id: "s1",
      image_url: "https://arxiv.org/html/2611.00003/figure1.png",
      licence: "CC-BY-4.0",
      licence_quote: "This work is licensed under a Creative Commons Attribution 4.0 International License.",
      credit: "Figure 1 from a made-up preprint, arXiv (2026), CC BY 4.0",
      alt: lz("A grid of bright spots, each holding one atom.", "一排亮點，每個亮點困住一個原子。"),
    },
    who: [{ name: "Example Institute", ror: null }],
    terms: [LATTICE],
    related: [],
    first_published: "2026-11-10",
    first_brief: BILINGUAL,
    briefs: [BILINGUAL],
    history: false,
    disclosure: false,
    applications: [],
    updated: DATA_ONLY,
  });
}

function terms(): Term[] {
  return [
    Term.parse({
      id: LATTICE,
      en: { term: "lattice", definition: "A grid of light that holds atoms in place." },
      zh: { term: "晶格", definition: "用光形成的格子，可以把原子固定在位置上。", official: null, official_url: null },
      fields: ["physics"],
      first_finding: LIGHT,
      first_date: BILINGUAL,
    }),
    Term.parse({
      id: ASSISTANT,
      en: { term: "proof assistant", definition: "A program that checks every step of a mathematical proof." },
      zh: null,
      fields: ["mathematics"],
      first_finding: PROOF,
      first_date: EN_ONLY,
    }),
    Term.parse({
      id: FOLDING,
      en: { term: "protein folding", definition: "How a chain of amino acids curls into a shape." },
      zh: { term: "蛋白質摺疊", definition: "一串胺基酸捲成立體形狀的過程。", official: null, official_url: null },
      fields: ["biology"],
      first_finding: PROTEIN,
      first_date: EN_ONLY,
    }),
  ];
}

function corrections(): Correction[] {
  return [Correction.parse({
    id: "C-0001",
    date: BILINGUAL,
    finding_id: PROTEIN,
    edition_date: null,
    term_id: null,
    type: "correction",
    path: "explainer.how_sure",
    // The text of an English-only edition, so its Chinese is null; publish copied it.
    before: l(HOW_SURE_PROTEIN_BEFORE),
    after: lz(HOW_SURE_PROTEIN.en, HOW_SURE_PROTEIN.zh),
    reason: lz("The source note was wrong.", "來源說明有誤。"),
    source_url: null,
    trigger: "reader_report",
    report_id: "R-0001",
  })];
}

function reports(): Report[] {
  return [
    Report.parse({
      id: "R-0001", received: "2026-11-18T10:00:00+08:00", issue_number: 12, finding_id: PROTEIN, kind: "source", evidence_url: null,
      status: "upheld", decided_by: "claude", resolved_on: BILINGUAL, reason: l("The page gives the other date."), correction_id: "C-0001",
    }),
    Report.parse({
      id: "R-0002", received: "2026-11-21T09:00:00+08:00", issue_number: 14, finding_id: PROOF, kind: "fact", evidence_url: null,
      status: "open", decided_by: null, resolved_on: null, reason: null, correction_id: null,
    }),
  ];
}

// ── The briefs ───────────────────────────────────────────────────────────────────────────────────

/** A brief with nothing in it but what every brief has; `over` says the rest. */
export function briefOf(date: string, over: Json = {}): Brief {
  return Brief.parse({
    schema_version: 1,
    date,
    edition: "full",
    format: formatForWeekday(weekday(date)),
    languages: { en: true, zh: true },
    published_at: `${date}T04:12:30+08:00`,
    late: false,
    pace: { sentence: lz(PACE_EN, PACE_ZH), status: "ok", metrics_file: `metrics/${date}.json` },
    lead: [],
    story: null,
    items: [],
    rung_changes: [],
    ideas: [],
    also: [],
    deep_dive: null,
    review: null,
    corrections: [],
    reports: [],
    sources: [],
    disclosure: [],
    status_note: null,
    computed: { word_count: 150, zh_chars: 260, finding_count: 0, source_count: 0 },
    provenance: { run_id: `${date.replaceAll("-", "")}-031500`, code_commit: SAMPLE_COMMIT, data_cutoff: lastSunday(dataCutoffFor(date)) },
    ...over,
  });
}

function briefs(): Brief[] {
  const enOnly = briefOf(EN_ONLY, {
    languages: { en: true, zh: false },
    pace: { sentence: l(PACE_EN), status: "ok", metrics_file: `metrics/${EN_ONLY}.json` },
    lead: [{ text: l("A protein result and a proof lead today."), finding_ids: [PROTEIN, PROOF] }],
    story: { finding_id: PROTEIN, new: true, update: null },
    items: [{ finding_id: PROOF, new: true, update: null }],
    status_note: statusNote({ edition: "full", englishOnly: true, feeds: [] }),
    computed: { word_count: 140, zh_chars: null, finding_count: 2, source_count: 0 },
  });
  const bilingual = briefOf(BILINGUAL, {
    lead: [{ text: lz("A light result leads today and a protein finding returns.", "今天的重點是一項光的成果，另有一項蛋白質發現再度登場。"), finding_ids: [LIGHT, PROTEIN] }],
    story: { finding_id: LIGHT, new: true, update: null },
    items: [{ finding_id: PROTEIN, new: false, update: lz("The source note was corrected after a reader's report.", "讀者回報後，來源說明已更正。") }],
    corrections: [{
      id: "C-0001", finding_id: PROTEIN, edition_date: null, term_id: null, type: "correction", reason: lz("The source note was wrong.", "來源說明有誤。"),
    }],
    reports: [{ id: "R-0001", finding_id: PROTEIN, status: "upheld" }],
    computed: { word_count: 150, zh_chars: 260, finding_count: 2, source_count: 0 },
  });
  const dataOnly = briefOf(DATA_ONLY, {
    edition: "data_only",
    rung_changes: [{ finding_id: LIGHT, from: "preprint", to: "checked", date: "2026-11-19", by: "script" }],
    status_note: statusNote({ edition: "data_only", englishOnly: false, feeds: [] }),
    computed: { word_count: 40, zh_chars: 60, finding_count: 0, source_count: 0 },
  });
  return [enOnly, bilingual, dataOnly];
}

// ── The Pace, the manifest and the status ────────────────────────────────────────────────────────

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

const share = (k: number, n: number): Json => {
  const value = round4(k / n);
  return { k, n, share: value, ci80: [round4(Math.max(0, value - 0.01)), round4(Math.min(1, value + 0.01))] };
};

const paceCell = (): Json => ({ window: share(84, 1000), baseline: share(20, 1000), year_ago: share(50, 1000), vs_baseline: "higher", vs_year_ago: "up" });

/** The metrics file of an edition: valid for the date (its data cutoff is the newest Sunday the date allows). */
export function metricsFor(date: string): MetricsFile {
  const cutoff = lastSunday(dataCutoffFor(date));
  const to = addDays(cutoff, -7);
  const from = addDays(to, -90);
  return MetricsFile.parse({
    schema_version: 1,
    date,
    computed_at: `${date}T03:20:00+08:00`,
    data_cutoff: cutoff,
    versions: { ai_terms: 1, journals: 1, fields: 1, counters: 1 },
    status: "ok",
    pace: {
      window: { from, to },
      provisional_from: addDays(to, 1),
      baseline: { from: "2015-01-05", to: "2019-12-29" },
      year_ago: { from: addDays(from, -364), to: addDays(to, -364) },
      leading: { pooled: paceCell(), by_field: Object.fromEntries(FIELDS.map((f) => [f, paceCell()])) },
      all: { pooled: paceCell(), by_field: Object.fromEntries(FIELDS.map((f) => [f, paceCell()])) },
      sentence: lz(PACE_EN, PACE_ZH),
      quotable: { "pace.leading.pooled.window": "8.4%" },
    },
    landmarks: { by_year: [], baseline: { ai: 0, all: 0 } },
    hold: { cases: 0, held: 0, fell: 0, open: 0, too_few: true },
    counters: [],
  });
}

function inputsFor(date: string): InputsManifest {
  return InputsManifest.parse({
    schema_version: 1,
    date,
    computed_at: `${date}T03:20:00+08:00`,
    data_cutoff: lastSunday(dataCutoffFor(date)),
    versions: { ai_terms: 1, journals: 1, fields: 1, counters: 1 },
    openalex: [],
    counters: [],
    landmark_ids: [],
    hold_case_ids: [],
  });
}

function statusFor(date: string): StatusFile {
  return StatusFile.parse({ schema_version: 1, date, runs: [] });
}

/**
 * The archive index of a world: its briefs newest first with their edition, publish time and finding count, and each URL the findings
 * and the briefs cite with the findings and editions that cite it (SPEC §4.10).
 */
export function archiveOf(world: Pick<StoredWorld, "briefs" | "findings" | "corrections">): ArchiveIndex {
  const urls = new Map<string, { first: string; refs: string[] }>();
  const cite = (url: string, added: string, ref: string): void => {
    const key = normalizeUrl(url);
    const entry = urls.get(key) ?? { first: added, refs: [] };
    if (added < entry.first) entry.first = added;
    if (!entry.refs.includes(ref)) entry.refs.push(ref);
    urls.set(key, entry);
  };
  for (const finding of world.findings) for (const s of finding.sources) cite(s.url, s.added, finding.id);
  for (const brief of world.briefs) for (const s of brief.sources) cite(s.url, s.added, `${brief.date}/brief`);
  const listed = new Set(world.corrections.map((c) => c.date));
  return ArchiveIndex.parse({
    schema_version: 1,
    editions: [...world.briefs].sort((a, b) => (a.date < b.date ? 1 : -1)).map((b) => ({
      date: b.date,
      edition: b.edition,
      published_at: b.published_at,
      finding_count: (b.story === null ? 0 : 1) + b.items.length,
      corrected: listed.has(b.date),
    })),
    urls: Object.fromEntries([...urls].sort(([a], [b]) => (a < b ? -1 : 1)).map(([url, e]) => [url, {
      first_cited: e.first, refs: e.refs, sha256: null, hashed_at: null, last_check: null,
    }])),
  });
}

// ── The world ────────────────────────────────────────────────────────────────────────────────────

/** A fresh copy of the base world, described in the header. */
export function storedWorld(): StoredWorld {
  const world: StoredWorld = {
    briefs: briefs(),
    findings: [protein(), proof(), light()],
    terms: terms(),
    corrections: corrections(),
    reports: reports(),
    archive: null as unknown as ArchiveIndex,
    metrics: [],
    inputs: [inputsFor(DATA_ONLY)],
    status: [statusFor(EN_ONLY), statusFor(BILINGUAL), statusFor(DATA_ONLY)],
    pace: PaceWeeklyFile.parse({ schema_version: 1, versions: { ai_terms: 1, journals: 1, fields: 1 }, updated: DATA_ONLY, weeks: [] }),
  };
  world.metrics = world.briefs.map((b) => metricsFor(b.date));
  world.archive = archiveOf(world);
  return world;
}

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("stored-world: a record the world should hold is missing");
  return value;
};

/** A record of the world by its id. */
export const findingOf = (world: StoredWorld, id: string): Finding => must(world.findings.find((f) => f.id === id));
export const termOf = (world: StoredWorld, id: string): Term => must(world.terms.find((t) => t.id === id));
export const briefOn = (world: StoredWorld, date: string): Brief => must(world.briefs.find((b) => b.date === date));

/**
 * Adds a brief with the metrics file and the status file of its date (every edition has both: publish writes the status file before any
 * edition and the metrics file with the data-only one), keeping the briefs oldest first, and rebuilds the archive index.
 */
export function addBrief(world: StoredWorld, brief: Brief): void {
  world.briefs.push(brief);
  world.briefs.sort((a, b) => (a.date < b.date ? -1 : 1));
  world.metrics.push(metricsFor(brief.date));
  world.status.push(statusFor(brief.date));
  world.archive = archiveOf(world);
}

/**
 * Adds the Sunday deep dive of 2026-11-22 to the world, on `bio-2026-0001` (which lists the edition and was last changed by it). Its
 * text is short, so it does not meet the deep dive's word budget.
 */
export function addSunday(world: StoredWorld): StoredWorld {
  addBrief(world, briefOf(SUNDAY, {
    lead: [{ text: lz("The Sunday deep dive returns to a protein result.", "週日深度報導回到一項蛋白質成果。"), finding_ids: [PROTEIN] }],
    deep_dive: { finding_id: PROTEIN, text: lz("A longer look at how the shape was found.", "更完整地看看這個形狀是怎麼找到的。"), source_ids: [], why_today: "rotation" },
    computed: { word_count: 120, zh_chars: 200, finding_count: 1, source_count: 0 },
  }));
  const finding = findingOf(world, PROTEIN);
  finding.briefs = [...finding.briefs, SUNDAY];
  finding.updated = SUNDAY;
  return world;
}

/**
 * Adds the Monday review of 2026-11-23: a week of three findings with no setback and no fall, so its box says none was found. Its
 * big picture is short, so it does not meet the review's word budget.
 */
export function addMonday(world: StoredWorld): StoredWorld {
  const counts: Record<string, [number, number]> = { biology: [1, 1], mathematics: [1, 0], physics: [1, 1] };
  addBrief(world, briefOf(MONDAY, {
    lead: [{ text: lz("The week brought three findings.", "這一週有三項發現。"), finding_ids: [LIGHT] }],
    review: {
      big_picture: lz("Three findings this week: one on proteins, one proof and one on light.", "這一週有三項發現：一項關於蛋白質，一項證明，一項關於光。"),
      remarkable: { finding_id: LIGHT, note: lz("The light result went from a preprint to a paper in a day.", "這項光的成果在一天之內從預印本變成了論文。") },
      strongest_against: { text: { ...NONE_FOUND }, finding_ids: [], source_ids: [] },
      field_counts: FIELDS.map((field) => ({ field, reported: counts[field]?.[0] ?? 0, counted: counts[field]?.[1] ?? 0 })),
      fell: [],
      setbacks: [],
    },
    computed: { word_count: 130, zh_chars: 210, finding_count: 0, source_count: 0 },
  }));
  return world;
}

/** The record a correction names: exactly one of the three. */
export interface CorrectionTarget {
  finding_id?: string;
  edition_date?: string;
  term_id?: string;
}

/**
 * Files a `removed` correction of `path` in the record `target` names, the next in the sequence (C-0002 in the base world), dated `date`
 * (the bilingual edition unless told). It rewrites nothing: the caller sets REMOVED_TEXT in the record, or leaves other text there to
 * make the removal fail XREF. Its `after` is REMOVED_TEXT and its `before` is REMOVED_BEFORE's words, as publish writes them.
 */
export function addRemoval(world: StoredWorld, target: CorrectionTarget, path: string, date: string = BILINGUAL): Correction {
  const correction = Correction.parse({
    id: `C-${String(world.corrections.length + 1).padStart(4, "0")}`,
    date,
    finding_id: target.finding_id ?? null,
    edition_date: target.edition_date ?? null,
    term_id: target.term_id ?? null,
    type: "removed",
    path,
    before: { en: "[removed text]", zh: "〔已移除的文字〕" },
    after: { ...REMOVED_TEXT },
    reason: lz("The text was unsafe.", "這段文字不安全。"),
    source_url: null,
    trigger: "editor",
    report_id: null,
  });
  world.corrections.push(correction);
  return correction;
}

/** A world where a `removed` correction rewrote `explainer.how_sure` of `bio-2026-0001`: the correction is filed and the finding holds REMOVED_TEXT there. */
export function removedHowSure(world: StoredWorld): StoredWorld {
  findingOf(world, PROTEIN).explainer.how_sure = { ...REMOVED_TEXT };
  addRemoval(world, { finding_id: PROTEIN }, "explainer.how_sure");
  return world;
}

/** The records of a world as `buildPublishedInput()` takes them. */
export function contentOf(world: StoredWorld): { findings: Finding[]; terms: Term[]; corrections: Correction[]; reports: Report[] } {
  return { findings: world.findings, terms: world.terms, corrections: world.corrections, reports: world.reports };
}

// ── Files ────────────────────────────────────────────────────────────────────────────────────────

/** Every file of a world in the layout of SPEC §3: its path under the content folder and its record. */
export function worldFiles(world: StoredWorld): [string, unknown][] {
  const files: [string, unknown][] = [];
  for (const b of world.briefs) files.push([`briefs/${b.date}.json`, b]);
  for (const f of world.findings) files.push([`findings/${f.id}.json`, f]);
  for (const m of world.metrics) files.push([`metrics/${m.date}.json`, m]);
  for (const i of world.inputs) files.push([`metrics/inputs/${i.date}.json`, i]);
  for (const s of world.status) files.push([`status/${s.date}.json`, s]);
  files.push(["state/pace-weekly.json", world.pace]);
  files.push(["glossary.json", { schema_version: 1, terms: world.terms }]);
  files.push(["corrections.json", { schema_version: 1, corrections: world.corrections }]);
  files.push(["reports.json", { schema_version: 1, reports: world.reports }]);
  files.push(["archive-index.json", world.archive]);
  return files;
}

const made: string[] = [];

/** A new empty folder under the system's temporary folder; `removeTempDirs()` deletes every one made. */
export function tempDir(label = "stored"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ut-${label}-`));
  made.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** Writes raw bytes at `rel` under `dir`, making the folders on the way. */
export function writeRaw(dir: string, rel: string, content: string | Uint8Array): void {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Writes a record as publish does: two-space JSON and a final newline. */
export function writeJson(dir: string, rel: string, value: unknown): void {
  writeRaw(dir, rel, `${JSON.stringify(value, null, 2)}\n`);
}

/** Writes every file of a world under `dir` (made if missing) and returns the paths written. */
export function writeWorld(dir: string, world: StoredWorld = storedWorld()): string[] {
  fs.mkdirSync(dir, { recursive: true });
  const files = worldFiles(world);
  for (const [rel, value] of files) writeJson(dir, rel, value);
  return files.map(([rel]) => rel);
}

/** The JSON of a file under `dir`. */
export function readJson<T = Json>(dir: string, rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8")) as T;
}

/** A folder holding the world, ready to use. */
export function worldDir(world: StoredWorld = storedWorld(), label = "world"): string {
  const dir = tempDir(label);
  writeWorld(dir, world);
  return dir;
}
