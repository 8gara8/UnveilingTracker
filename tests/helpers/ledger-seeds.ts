// A small Ledger for the seeder's tests (SPEC §8.13): three SAMPLE seed files, built as plain objects a test may change, written to a temporary
// folder with `writeSeeds()`, and the pages their sources answer with, which are `fixtures/feeds/` (`UT_FIXTURE_FEEDS`). The text is invented
// sample text: no real paper, lab or result. New for this project; Cyber has no Ledger.
//
//   2018-03-02-01.json  physics, the oldest: its id is phys-2018-0001 (the counter restarts in a new year)
//   2019-05-01-01.json  biology: bio-2019-0001, with a paper and a registry page, a new term and its 樂詞網 page
//   2019-05-01-02.json  biology: bio-2019-0002 (the counter runs across fields), lists the term as one that exists
//
// The physics seed and the second biology seed cite the same preprint page, so the archive index lists it once with both ids.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SeedFinding } from "../../lib/schema/seed";

export const PAPER_URL = "https://www.cell.com/cell/abstract/ut-sample-ledger-0001";
export const TRIAL_URL = "https://clinicaltrials.gov/study/NCT09990101";
export const PREPRINT_URL = "https://arxiv.org/abs/2901.99003";
export const TERM_URL = "https://terms.naer.edu.tw/detail/9990001/";
export const MISSING_URL = "https://www.cell.com/cell/abstract/ut-sample-ledger-missing";
export const PDF_URL = "https://www.cell.com/cell/pdf/ut-sample-ledger-0001.pdf";

/** `UT_FIXTURE_FEEDS` for a test: the folder `fixtures/feeds/` of the repository. */
export const FEEDS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "feeds");

const clone = <T>(x: T): T => structuredClone(x);

export const TERM = {
  new: true as const,
  term: "antimicrobial resistance",
  definition: "When germs survive the medicines that used to kill them.",
  zh: { term: "抗微生物抗藥性", definition: "細菌等微生物能在原本可殺死它們的藥物下存活。", official: "抗微生物抗藥性", official_url: TERM_URL },
};

/** The first biology seed: a paper (s1) and a registry record (s2), a new term. */
export function seedBio1(): SeedFinding {
  return {
    field: "biology",
    subfield: "drugs",
    kind: "result",
    title: { en: "SAMPLE: A model proposes an antibiotic that works in mice", zh: "SAMPLE：模型提出對小鼠有效的抗生素" },
    explainer: {
      found: {
        en: "A model proposed a new antibiotic. It cleared a drug-resistant skin infection in 8 of 10 mice. The team made and tested 40 of the model's top molecules.",
        zh: "一個模型提出了新抗生素，在 10 隻小鼠中的 8 隻身上清除了抗藥性皮膚感染。團隊製作並測試了模型排名最前的 40 個分子。",
      },
      matters: {
        en: "Antimicrobial resistance makes some infections hard to treat, so doctors need new antibiotics. A first safety trial in people is registered as NCT09990101.",
        zh: "抗微生物抗藥性（antimicrobial resistance）讓某些感染難以治療，所以醫師需要新的抗生素。第一項人體安全性試驗已登記為 NCT09990101。",
      },
      ai_helped: {
        en: "Halden Research built Halden Design, which ranks molecules by their chance of killing resistant bacteria. People made and tested every molecule.",
        zh: "Halden Research 開發了 Halden Design，它依分子殺死抗藥性細菌的機率來排名。每一個分子都由人類製作並測試。",
      },
      how_sure: {
        en: "Checked. Cell published the paper after peer review. Halden Research, which built the model, helped write it, and no other lab has repeated the tests.",
        zh: "已查核。Cell 在同儕審查後發表了論文。開發這個模型的 Halden Research 也參與撰寫，且尚無其他實驗室重複過這些實驗。",
      },
      background: {
        en: "Computers can now rank huge lists of molecules before anyone makes one.",
        zh: "現在電腦能在有人製作分子之前，為極長的分子清單排出名次。",
      },
      could_lead: {
        en: "If later trials go well, it could become a treatment. Other labs must repeat the tests first.",
        zh: "如果後續試驗順利，它可能成為一種治療方法。不過其他實驗室必須先重複這些實驗。",
      },
    },
    go_deeper: ["s1", "s2"],
    ai: {
      role: "ai_proposed",
      confidence: "claimed",
      systems: [{ name: "Halden Design", maker: "Halden Research" }],
      evidence: [{
        source_id: "s1",
        quote: "Our model, Halden Design, ranked about 12 million molecules for their chance of killing drug-resistant bacteria",
        from_claimant: true,
      }],
    },
    significance: "major",
    rung_history: [{ rung: "checked", date: "2019-05-01", source_id: "s1", by: "seed", note: null }],
    sources: [
      {
        id: "s1", kind: "paper", title: "SAMPLE: A model proposes an antibiotic that clears resistant infections in mice", publisher: "Cell",
        url: PAPER_URL, doi: "10.1016/ut-sample-ledger-0001", published_at: "2019-05-01T22:00:00+08:00",
      },
      { id: "s2", kind: "registry", title: "SAMPLE: First safety trial of a new antibiotic", publisher: "ClinicalTrials.gov", url: TRIAL_URL, doi: null, published_at: "2019-05-01" },
    ],
    reactions: [],
    artefacts: { doi: ["10.1016/ut-sample-ledger-0001"], arxiv: [], lean: [], trial: ["NCT09990101"], pdb: [] },
    figure: null,
    who: [{ name: "Halden Research (SAMPLE)", ror: null }],
    terms: [clone(TERM)],
    related: [],
    first_published: "2019-05-01",
    seeded: "2026-11-20",
  };
}

/** The second biology seed: it cites the preprint the physics seed cites, and lists the term the first one defines. */
export function seedBio2(): SeedFinding {
  return {
    field: "biology",
    subfield: "proteins",
    kind: "result",
    title: { en: "SAMPLE: A network proposes proteins and seven of twenty hold their shape", zh: "SAMPLE：網路提出蛋白質，二十個中有七個維持預測形狀" },
    explainer: {
      found: {
        en: "A network proposed 300 new proteins. The team made 20 of them in the lab. Seven of the 20 held the shape the network predicted.",
        zh: "一個網路提出了 300 個新的蛋白質。團隊在實驗室製作了其中 20 個。這 20 個當中有 7 個維持了網路預測的形狀。",
      },
      matters: {
        en: "Designing proteins by hand is slow. A method that proposes good candidates could save labs months. Antimicrobial resistance is one problem such designs might help with.",
        zh: "以人工設計蛋白質很慢。能提出好候選對象的方法，可以替實驗室省下數月時間。抗微生物抗藥性（antimicrobial resistance）是這類設計可能幫上忙的問題之一。",
      },
      ai_helped: {
        en: "Sample Lab built Sample Network and trained it on known structures. The network proposed every candidate. People chose which ones to make.",
        zh: "Sample Lab 開發了 Sample Network，並以已知結構訓練它。每一個候選對象都由這個網路提出。要製作哪些由人決定。",
      },
      how_sure: {
        en: "Preprint. Sample Lab posted the work on arXiv, and no journal has reviewed it. No other lab has repeated it.",
        zh: "預印本。Sample Lab 把這項研究張貼在 arXiv，還沒有期刊審查過。也還沒有其他實驗室重複過。",
      },
      background: {
        en: "A protein is a chain that folds into a shape, and the shape decides what it does.",
        zh: "蛋白質是一條會摺成特定形狀的鏈，形狀決定了它的功能。",
      },
      could_lead: {
        en: "If the method holds up, labs could test far fewer designs by hand.",
        zh: "如果這個方法經得起檢驗，實驗室就可以少測許多手工設計。",
      },
    },
    go_deeper: ["s1"],
    ai: {
      role: "ai_proposed",
      confidence: "claimed",
      systems: [{ name: "Sample Network", maker: "Sample Lab" }],
      evidence: [{ source_id: "s1", quote: "We trained a network on known structures and asked it to propose new ones", from_claimant: true }],
    },
    significance: "notable",
    rung_history: [{ rung: "preprint", date: "2019-05-01", source_id: "s1", by: "seed", note: { en: "Posted on arXiv.", zh: "已張貼在 arXiv。" } }],
    sources: [{ id: "s1", kind: "preprint", title: "SAMPLE: A network proposes new structures that hold their shape", publisher: "arXiv", url: PREPRINT_URL, doi: null, published_at: "2019-05-01T20:00:00+08:00" }],
    reactions: [],
    artefacts: { doi: [], arxiv: ["2901.99003"], lean: [], trial: [], pdb: [] },
    figure: null,
    who: [{ name: "A sample academic team", ror: null }],
    terms: [{ new: false, id: "antimicrobial-resistance" }],
    related: [],
    first_published: "2019-05-01",
    seeded: "2026-11-20",
  };
}

/** The physics seed, the oldest: it cites the preprint the second biology seed cites. */
export function seedPhys(): SeedFinding {
  return {
    field: "physics",
    subfield: "condensed-matter",
    kind: "result",
    title: { en: "SAMPLE: A network proposes structures and seven of twenty hold their shape", zh: "SAMPLE：網路提出結構，二十個中有七個維持預測形狀" },
    explainer: {
      found: {
        en: "A network proposed 300 candidate structures. The team made 20 of them in the lab. Seven of the 20 held the predicted shape.",
        zh: "一個網路提出了 300 個候選結構。團隊在實驗室製作了其中 20 個。這 20 個當中有 7 個維持了預測的形狀。",
      },
      matters: {
        en: "Finding new materials by trial and error takes years. A method that proposes good candidates could shorten the search for a better material.",
        zh: "以反覆試誤尋找新材料要花上數年。能提出好候選對象的方法，可以縮短尋找更好材料的時間。",
      },
      ai_helped: {
        en: "Sample Lab built Sample Network and trained it on known structures. The network proposed every candidate. People chose which ones to make and measured each one.",
        zh: "Sample Lab 開發了 Sample Network，並以已知結構訓練它。每一個候選對象都由這個網路提出。要製作哪些由人決定，每一個也由人量測。",
      },
      how_sure: {
        en: "Preprint. Sample Lab posted the work on arXiv, and no journal has reviewed it. No other lab has repeated it.",
        zh: "預印本。Sample Lab 把這項研究張貼在 arXiv，還沒有期刊審查過。也還沒有其他實驗室重複過。",
      },
      background: {
        en: "A structure is the pattern in which atoms sit, and it decides how a material behaves.",
        zh: "結構是原子排列的方式，它決定了材料的表現。",
      },
      could_lead: {
        en: "If the method holds up, it could help labs find better materials sooner.",
        zh: "如果這個方法經得起檢驗，它可以幫助實驗室更早找到更好的材料。",
      },
    },
    go_deeper: ["s1"],
    ai: {
      role: "ai_proposed",
      confidence: "claimed",
      systems: [{ name: "Sample Network", maker: "Sample Lab" }],
      evidence: [{ source_id: "s1", quote: "It proposed 300 candidates, and the team made 20 of them in the lab", from_claimant: true }],
    },
    significance: "notable",
    rung_history: [{ rung: "preprint", date: "2018-03-02", source_id: "s1", by: "seed", note: null }],
    sources: [{ id: "s1", kind: "preprint", title: "SAMPLE: A network proposes new structures that hold their shape", publisher: "arXiv", url: PREPRINT_URL, doi: null, published_at: "2018-03-02T20:00:00+08:00" }],
    reactions: [],
    artefacts: { doi: [], arxiv: ["2901.99003"], lean: [], trial: [], pdb: [] },
    figure: null,
    who: [{ name: "A sample academic team", ror: null }],
    terms: [],
    related: [],
    first_published: "2018-03-02",
    seeded: "2026-11-18",
  };
}

/** The three seeds by file name. */
export function sampleSeeds(): Record<string, SeedFinding> {
  return { "2018-03-02-01.json": seedPhys(), "2019-05-01-01.json": seedBio1(), "2019-05-01-02.json": seedBio2() };
}

/** Writes the seeds as files of `dir` (created), in the form a person would write them; returns `dir`. */
export function writeSeeds(dir: string, seeds: Record<string, unknown> = sampleSeeds()): string {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, seed] of Object.entries(seeds)) fs.writeFileSync(path.join(dir, name), `${JSON.stringify(seed, null, 2)}\n`);
  return dir;
}
