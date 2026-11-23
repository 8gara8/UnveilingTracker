// The sources of the fixture world (SPEC §4.12 "Fixtures and tests"): every page the sample drafts and stored findings
// cite, with the text the run saw there. Each address is on a host that config/source-tiers.json, labs.json or
// checkers.json allows for its kind, at an invented path (`ut-sample` in the path wherever the host's rules let the
// path carry it); each page is invented, begins "SAMPLE page" and is never fetched, so the text below is the whole of
// what the run "saw" and holds every quote and number the drafts use. No page is press. Every invented person is
// marked (SAMPLE), and the institutions, journals and AI systems are made up.
//
// A source's key is its handle in `fixtures/src/`: `world.ts` turns the table into draft sources, stored sources and
// evidence texts. `seen` says how the morning's run saw the page: in the pack (with the feed that carried it), in a
// fetch or in a search result; `types` are the article types its publisher's page shows (the evidence's `types`).
//
// Cyber's fixtures/src/world.ts at the fork commit 3ced1fb, adapted: its SOURCE_TABLE (a keyed table checked with
// `satisfies`, each entry holding the text the run saw) is the pattern; the pages, the hosts and the kinds are this
// project's.

import type { SourceKind } from "../../lib/vocab";

/** How the run saw a source's page: in the pack, in a fetch of its own, or in a search result (`seen_as`, SPEC §4.3). */
export type SeenHow = "pack" | "fetched" | "search";

/** One invented page of the sample world: where it lives, what it is, and the text the run saw there. */
export interface SourceSpec {
  readonly url: string;
  readonly kind: SourceKind;
  readonly title: string;
  readonly publisher: string;
  readonly doi: string | null;
  /** A timestamp when the page gives a time, else a bare date (`PublishedAt`). */
  readonly published_at: string;
  readonly seen: SeenHow;
  /** The feed that carried it, for a page seen in the pack (a `config/sources.yaml` id). */
  readonly feed?: string;
  /** The article types the publisher's page shows (the evidence's `types`). */
  readonly types?: readonly string[];
  /** The whole text the run saw: at most 1,000 characters, so it also serves as a pack candidate's abstract. */
  readonly text: string;
}

/** The text of an invented page: the marking sentence, then the page's own sentences. */
const page = (...sentences: string[]): string => ["SAMPLE page, invented for tests and never fetched.", ...sentences].join(" ");

export const SOURCE_TABLE = {
  // ── The weekday, 2026-10-14: the story, a sealed scroll read without opening it ─────────────────
  "scroll-paper": {
    url: "https://www.nature.com/articles/nature-ut-sample-0001",
    kind: "paper", publisher: "Nature",
    title: "SAMPLE: Reading a sealed Herculaneum scroll with machine learning",
    doi: "10.1038/nature-ut-sample-0001", published_at: "2026-10-13T23:00:00+08:00",
    seen: "pack", feed: "journal-nature", types: ["Article"],
    text: page(
      "Hundreds of papyrus scrolls from the library at Herculaneum were charred by the eruption of Mount Vesuvius in AD 79 and cannot be unrolled.",
      "We scanned one sealed scroll with X-rays and flattened its layers in software.",
      "We trained a machine-learning model to detect ink.",
      "The model was trained on small patches where ink had been found by hand.",
      "We read about 1,800 Greek letters in six columns of text.",
      "Scholars in two countries, outside our group, checked the readings.",
      "The text is a prose work on friendship.",
      "Open access. This article is licensed under a Creative Commons Attribution 4.0 International License.",
      "DOI 10.1038/nature-ut-sample-0001.",
    ),
  },
  "scroll-nv": {
    url: "https://www.nature.com/articles/d41586-ut-sample-0002",
    kind: "reaction", publisher: "Nature",
    title: "SAMPLE: News and Views: A scroll gives up its text",
    doi: null, published_at: "2026-10-13T23:00:00+08:00",
    seen: "fetched", types: ["News & Views"],
    text: page(
      "By Mira Placeholder (SAMPLE), Ravenhurst University.",
      "This is the first time a sealed scroll has given up a whole passage of connected prose.",
      "The result rests on a careful reading by people, helped by a model that finds ink.",
    ),
  },
  "scroll-smc": {
    url: "https://www.sciencemediacentre.org/expert-reaction-to-ut-sample-sealed-scroll-text/",
    kind: "reaction", publisher: "Science Media Centre",
    title: "SAMPLE: Expert reaction to a sealed scroll read without unrolling",
    doi: null, published_at: "2026-10-13T22:30:00+08:00",
    seen: "pack", feed: "smc-reactions",
    text: page(
      "Jonas Example (SAMPLE), Coldwater Institute, said: The readings are careful and the Greek is sound.",
      "The model found ink traces that no human reader could see, and the readings that followed are sound.",
      "People checked every letter.",
      "The ink model was built with machine learning, and people did the reading.",
    ),
  },
  "scroll-release": {
    url: "https://www.eurekalert.org/news-releases/ut-sample-0003",
    kind: "statement", publisher: "Eastvale University",
    title: "SAMPLE: Eastvale team reads a sealed scroll without opening it",
    doi: null, published_at: "2026-10-13T20:00:00+08:00",
    seen: "pack", feed: "eurekalert",
    text: page(
      "Eastvale University said its imaging group read about 1,800 Greek letters inside a sealed papyrus scroll from Herculaneum.",
      "The team trained a model called the Ink Reader to find ink that the human eye cannot see.",
      "Hundreds of scrolls from the same library are still sealed.",
      "The text is a prose work on friendship.",
      "The Ink Reader is a machine learning model.",
    ),
  },

  // ── The weekday: a lab's claim about an open problem ─────────────────────────────────────────────
  "erdos-preprint": {
    url: "https://arxiv.org/abs/2610.99001",
    kind: "preprint", publisher: "arXiv",
    title: "SAMPLE: A proof of an open problem on sums of sets of whole numbers",
    doi: null, published_at: "2026-10-13T08:00:00+08:00",
    seen: "pack", feed: "arxiv-math",
    text: page(
      "Authors: Marlow Labs (SAMPLE).",
      "We prove an open problem about sums of sets of whole numbers.",
      "The proof was found by the Marlow Prover with no human step in the argument.",
      "A Lean proof file is posted with this paper.",
      "This version has not been peer reviewed. arXiv:2610.99001.",
      "The Marlow Prover is built on a large language model.",
    ),
  },
  "erdos-lean": {
    url: "https://github.com/marlow-labs-sample/sumsets-proof/blob/main/SumSets.lean",
    kind: "proof", publisher: "GitHub",
    title: "SAMPLE: SumSets.lean, the Lean proof file",
    doi: null, published_at: "2026-10-13",
    seen: "fetched",
    text: page(
      "SumSets.lean, posted by Marlow Labs (SAMPLE).",
      "The file proves the main result of the preprint and builds against the public Lean library.",
    ),
  },

  // ── The weekday: an AI prediction measured by a second lab ───────────────────────────────────────
  "protein-preprint": {
    url: "https://www.biorxiv.org/content/10.1101/2026.09.02.990011v1",
    kind: "preprint", publisher: "bioRxiv",
    title: "SAMPLE: Predicted structure of a protein complex from Halden Fold",
    doi: "10.1101/2026.09.02.990011", published_at: "2026-09-02T10:00:00+08:00",
    seen: "search",
    text: page(
      "Halden Research (SAMPLE).",
      "Halden Fold predicted the structure of the complex before any measurement.",
      "We post the prediction here so that others can test it.",
      "This preprint has not been peer reviewed.",
    ),
  },
  "protein-paper": {
    url: "https://www.pnas.org/doi/10.1073/ut-sample.0003",
    kind: "paper", publisher: "PNAS",
    title: "SAMPLE: A measured structure tests an AI prediction of a protein complex",
    doi: "10.1073/ut-sample.0003", published_at: "2026-10-13T05:00:00+08:00",
    seen: "pack", feed: "journal-pnas", types: ["Research Article"],
    text: page(
      "Coldwater Institute structure lab (SAMPLE).",
      "We measured the structure of the complex by cryo-electron microscopy.",
      "The measured structure matches the model prediction in every chain.",
      "The two agree to within 2 angstroms.",
      "The prediction was posted by Halden Research before our measurement.",
      "Deposited as pdb_00009zz1.",
      "Halden Research made the prediction with a deep learning model.",
    ),
  },
  "protein-entry": {
    url: "https://www.rcsb.org/structure/pdb_00009zz1",
    kind: "registry", publisher: "RCSB Protein Data Bank",
    title: "SAMPLE: Structure entry pdb_00009zz1",
    doi: null, published_at: "2026-10-13",
    seen: "pack", feed: "rcsb",
    text: page(
      "Entry pdb_00009zz1, released 2026-10-13.",
      "Method: cryo-electron microscopy.",
      "Deposited by the Coldwater Institute structure lab (SAMPLE).",
      "The images and data on this page are released under the CC0 1.0 Universal license.",
    ),
  },
  "protein-trial": {
    url: "https://clinicaltrials.gov/study/NCT09999002",
    kind: "registry", publisher: "ClinicalTrials.gov",
    title: "SAMPLE: First safety trial of a drug that binds a protein complex",
    doi: null, published_at: "2026-10-12",
    seen: "search",
    text: page(
      "Study NCT09999002.",
      "A first safety trial of a drug that binds the protein complex whose structure Halden Fold predicted.",
      "Sponsor: Fernhill University (SAMPLE).",
    ),
  },

  // ── The weekday: a setback built from retraction notices and the publisher's statement ──────────
  "retract-statement": {
    url: "https://group.springernature.com/gp/group/media/press-releases/ut-sample-ai-retractions",
    kind: "statement", publisher: "Springer Nature",
    title: "SAMPLE: Springer Nature retracts papers with AI-made text and images",
    doi: null, published_at: "2026-10-13T17:00:00+08:00",
    seen: "search",
    text: page(
      "Springer Nature has retracted 84 papers in nine journals.",
      "The text and images in these papers were produced with an AI tool that the authors did not disclose.",
      "The retraction notices do not name the tool.",
      "We will keep checking papers from the same authors.",
    ),
  },
  "retract-notice-1": {
    url: "https://link.springer.com/article/10.1007/ut-sample-0005",
    kind: "notice", publisher: "Springer Nature",
    title: "SAMPLE: Retraction Note: A study of alloy coatings",
    doi: "10.1007/ut-sample-0005", published_at: "2026-10-13T16:00:00+08:00",
    seen: "pack", feed: "crossref-updates",
    text: page(
      "Retraction Note.",
      "The publisher has retracted this article because its text and images were produced with an undisclosed AI tool.",
    ),
  },
  "retract-notice-2": {
    url: "https://link.springer.com/article/10.1007/ut-sample-0006",
    kind: "notice", publisher: "Springer Nature",
    title: "SAMPLE: Retraction Note: Wear tests of a new steel",
    doi: "10.1007/ut-sample-0006", published_at: "2026-10-13T16:05:00+08:00",
    seen: "pack", feed: "crossref-updates",
    text: page(
      "Retraction Note.",
      "The publisher has retracted this article because its text and images were produced with an undisclosed AI tool.",
    ),
  },

  // ── The weekday: new facts on a returning finding, a rung change, two ideas and two lines ───────
  "policy-final": {
    url: "https://www.aldgate-council-sample.gov/ut-sample/ai-disclosure-final-rule",
    kind: "statement", publisher: "Aldgate Research Council",
    title: "SAMPLE: Final rule on AI use in grant proposals",
    doi: null, published_at: "2026-10-13T10:00:00+08:00",
    seen: "search",
    text: page(
      "The Aldgate Research Council has published its final rule.",
      "From 1 January, applicants must say if AI tools helped write any part of a proposal.",
      "The final rule covers every part of a proposal, not only the summary.",
    ),
  },
  "catalyst-confirm": {
    url: "https://onlinelibrary.wiley.com/doi/10.1002/ut-sample-0007",
    kind: "paper", publisher: "Applied Catalysis Letters",
    title: "SAMPLE: An independent repeat of a robot-found metal mixture",
    doi: "10.1002/ut-sample-0007", published_at: "2026-10-13T12:00:00+08:00",
    seen: "pack", feed: "crossref-journals",
    text: page(
      "Ravenhurst University (SAMPLE).",
      "We repeated the work of the Eastvale team with our own robot and our own metals.",
      "We find that the same mixture splits water almost as well as platinum does.",
      "Our robot chose each mixture with Bayesian optimization.",
    ),
  },
  "idea-proof-checking": {
    url: "https://www.sciencemediacentre.org/expert-reaction-to-ut-sample-ai-proof-checking/",
    kind: "reaction", publisher: "Science Media Centre",
    title: "SAMPLE: Expert reaction to AI proof checking",
    doi: null, published_at: "2026-10-12T10:00:00+08:00",
    seen: "search",
    text: page(
      "Oren Nominal (SAMPLE), Kestrel College, said: Journals should let AI check every submitted proof before human review begins.",
    ),
  },
  "idea-open-review": {
    url: "https://www.sciencemediacentre.org/expert-reaction-to-ut-sample-reviewers-and-ai-tools/",
    kind: "reaction", publisher: "Science Media Centre",
    title: "SAMPLE: Expert reaction to reviewers and AI tools",
    doi: null, published_at: "2026-10-12T14:00:00+08:00",
    seen: "search",
    text: page(
      "Sana Provisional (SAMPLE), Northgate University, said: Reviewers should be told plainly what they may share with AI tools.",
    ),
  },
  "also-monsoon": {
    url: "https://arxiv.org/abs/2610.99002",
    kind: "preprint", publisher: "arXiv",
    title: "SAMPLE: A model that predicts monsoon rainfall weeks ahead",
    doi: null, published_at: "2026-10-13T08:00:00+08:00",
    seen: "pack", feed: "arxiv-physics",
    text: page(
      "We describe a model that predicts monsoon rainfall weeks ahead.",
      "This version has not been peer reviewed. arXiv:2610.99002.",
      "The model is a neural network trained on past rainfall.",
    ),
  },
  "also-inscriptions": {
    url: "https://zenodo.org/records/9990003",
    kind: "dataset", publisher: "Zenodo",
    title: "SAMPLE: Inscriptions read with machine help, a public dataset",
    doi: "10.5281/zenodo.9990003", published_at: "2026-10-13T12:00:00+08:00",
    seen: "search",
    text: page(
      "Dataset record.",
      "Readings of ancient inscriptions, made with machine help and checked by scholars.",
      "DOI 10.5281/zenodo.9990003.",
    ),
  },

  // ── Stored findings of the week before (2026-10-05 to 2026-10-11) ────────────────────────────────
  "tilings-paper": {
    url: "https://www.cambridge.org/core/journals/ut-sample-journal-of-tiling-theory/article/ut-sample-0013",
    kind: "paper", publisher: "Journal of Tiling Theory",
    title: "SAMPLE: Tiles that fill the plane only without repeating",
    doi: "10.1017/ut-sample-0013", published_at: "2026-10-02T18:00:00+08:00",
    seen: "search",
    text: page(
      "Two mathematicians at Eastvale University prove that tiles of one kind can fill the flat plane only in patterns that never repeat.",
      "The question has been open since 1968.",
      "The proof runs to 38 pages and needs no computer search.",
      "We prove the result for tilings of the plane.",
      "The three-dimensional case remains open.",
      "Tilings appear in computer science and in the study of materials.",
      "DOI 10.1017/ut-sample-0013.",
    ),
  },
  "tilings-smc": {
    url: "https://www.sciencemediacentre.org/expert-reaction-to-ut-sample-tiling-proof/",
    kind: "reaction", publisher: "Science Media Centre",
    title: "SAMPLE: Expert reaction to a proof about tilings",
    doi: null, published_at: "2026-10-03T10:00:00+08:00",
    seen: "search",
    text: page(
      "Ines Fictional (SAMPLE), Kestrel College, said: I read the proof twice and I could not find a gap.",
      "Tomas Specimen (SAMPLE), Northgate University, said: The question is settled, and the method will be used for years.",
    ),
  },
  "weather-paper": {
    url: "https://www.science.org/doi/10.1126/ut-sample.0012",
    kind: "paper", publisher: "Science",
    title: "SAMPLE: An AI model that forecasts the weather ten days ahead",
    doi: "10.1126/ut-sample.0012", published_at: "2026-10-05T23:00:00+08:00",
    seen: "pack", feed: "journal-science", types: ["Research Article"],
    text: page(
      "Larch Weather Systems (SAMPLE).",
      "Larch Forecast is an AI model that predicts weather up to ten days ahead.",
      "In tests on two years of past weather, its ten-day forecasts had about 12 per cent fewer errors than numerical weather prediction, the standard method.",
      "Larch Weather Systems built the model and helped write this paper.",
      "The model learns from past weather records.",
      "Larch Forecast is a deep learning model.",
    ),
  },
  "weather-statement": {
    url: "https://www.meridian-weather-sample.gov/ut-sample/larch-forecast-guidance",
    kind: "statement", publisher: "Meridian Weather Service",
    title: "SAMPLE: Meridian Weather Service adds an AI model to its forecasts",
    doi: null, published_at: "2026-10-06T08:00:00+08:00",
    seen: "search",
    text: page(
      "The Meridian Weather Service said it runs Larch Forecast alongside its own system and uses the two together in its daily forecasts.",
      "The service said the AI model has not replaced its own system.",
    ),
  },
  "catalyst-paper": {
    url: "https://link.springer.com/article/10.1007/ut-sample-0008",
    kind: "paper", publisher: "Eastvale Journal of Materials",
    title: "SAMPLE: A robotic lab finds a cheap metal mixture that splits water",
    doi: "10.1007/ut-sample-0008", published_at: "2026-10-05T16:00:00+08:00",
    seen: "pack", feed: "crossref-journals",
    text: page(
      "Eastvale University robotics lab (SAMPLE).",
      "A robotic lab tested 200 mixtures of common metals in six weeks.",
      "One mixture sped up the splitting of water into hydrogen almost as well as platinum does.",
      "Marlow Selector, built by Marlow Labs, chose which mixtures to try next.",
      "Robot arms mixed and tested the samples.",
      "Marlow Labs helped write this paper.",
      "The tests ran in one lab.",
      "Marlow Selector is a machine learning model.",
    ),
  },
  "antibiotic-paper": {
    url: "https://www.cell.com/cell/abstract/ut-sample-0014",
    kind: "paper", publisher: "Cell",
    title: "SAMPLE: An AI model proposes a new antibiotic that clears resistant infections in mice",
    doi: "10.1016/ut-sample-0014", published_at: "2026-10-07T22:00:00+08:00",
    seen: "pack", feed: "crossref-journals", types: ["Research Article"],
    text: page(
      "Halden Research (SAMPLE) with the Coldwater Institute (SAMPLE).",
      "Our model, Halden Design, ranked about 12 million molecules for their chance of killing drug-resistant bacteria.",
      "We made and tested 40 of the top molecules.",
      "Three of the 40 stopped the growth of drug-resistant bacteria in dishes.",
      "The best of these cleared a drug-resistant skin infection in 8 of 10 mice.",
      "Antimicrobial resistance is when germs stop responding to the drugs that used to kill them.",
      "A first safety trial in people is registered as NCT09999001.",
      "No other lab has repeated the tests.",
      "DOI 10.1016/ut-sample-0014.",
      "Halden Design is a deep learning model.",
    ),
  },
  "antibiotic-trial": {
    url: "https://clinicaltrials.gov/study/NCT09999001",
    kind: "registry", publisher: "ClinicalTrials.gov",
    title: "SAMPLE: First safety trial of a new antibiotic",
    doi: null, published_at: "2026-10-07",
    seen: "search",
    text: page(
      "Study NCT09999001.",
      "A first safety trial of a new antibiotic proposed by an AI model.",
      "The trial plans to enrol 24 healthy volunteers.",
      "The first dose was given in September 2026.",
      "Sponsor: Coldwater Institute (SAMPLE).",
    ),
  },
  "antibiotic-release": {
    url: "https://www.coldwater-sample.edu/news/ut-sample-new-antibiotic",
    kind: "statement", publisher: "Coldwater Institute",
    title: "SAMPLE: Coldwater team tests an AI-proposed antibiotic",
    doi: null, published_at: "2026-10-07T21:00:00+08:00",
    seen: "search",
    text: page(
      "The Coldwater Institute said its lab tested compounds proposed by Halden Research's AI model, Halden Design.",
      "The Coldwater team ran the tests in mice and runs the first safety trial in people.",
    ),
  },
  "antibiotic-second": {
    url: "https://www.cell.com/cell-reports-medicine/fulltext/ut-sample-0015",
    kind: "paper", publisher: "Cell Reports Medicine",
    title: "SAMPLE: A second lab repeats tests of an AI-proposed antibiotic in mice",
    doi: "10.1016/ut-sample-0015", published_at: "2026-10-15T22:00:00+08:00",
    seen: "search", types: ["Research Article"],
    text: page(
      "Kestrel College (SAMPLE).",
      "We repeated the mouse tests with our own mice and our own samples of the compound.",
      "The compound was one of 40 that the AI model Halden Design had ranked at the top.",
      "The compound cleared the infection in 7 of 10 mice. The infection stayed in the other 3.",
      "We have no tie to Halden Research.",
      "DOI 10.1016/ut-sample-0015.",
    ),
  },
  "reviewer-statement": {
    url: "https://elifesciences.org/for-the-press/ut-sample-reviewer-ai-chatbot",
    kind: "statement", publisher: "eLife",
    title: "SAMPLE: eLife says reviewers shared unpublished papers with an AI chatbot",
    doi: null, published_at: "2026-10-08T17:00:00+08:00",
    seen: "search",
    text: page(
      "eLife has found that reviewers pasted the text of 31 unpublished manuscripts into a public AI chatbot to help write their reports.",
      "eLife has banned the practice and has told the authors.",
      "We do not name the chatbot.",
      "We have not said how many reviewers were involved.",
    ),
  },
  "reviewer-notice": {
    url: "https://elifesciences.org/articles/ut-sample-90001",
    kind: "notice", publisher: "eLife",
    title: "SAMPLE: Editorial note on the use of an AI chatbot in review",
    doi: null, published_at: "2026-10-08T17:30:00+08:00",
    seen: "search",
    text: page(
      "Editorial note.",
      "The reviews of 31 manuscripts were written with an AI chatbot after reviewers pasted in the unpublished text.",
      "The affected reviews have been withdrawn and the manuscripts will be reviewed again.",
    ),
  },
  "survey-preprint": {
    url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=9990001",
    kind: "preprint", publisher: "SSRN",
    title: "SAMPLE: An open dataset of AI-run survey interviews",
    doi: null, published_at: "2026-10-05T09:00:00+08:00",
    seen: "search",
    text: page(
      "Coldwater Institute survey lab (SAMPLE).",
      "We release 40,000 interviews that our AI interviewer, Survey Voice, ran by chat with adult volunteers.",
      "Survey Voice asked the questions and followed up on answers.",
      "People wrote the questions and checked a sample of the transcripts.",
      "This preprint has not been peer reviewed.",
    ),
  },
  "survey-data": {
    url: "https://zenodo.org/records/9990002",
    kind: "dataset", publisher: "Zenodo",
    title: "SAMPLE: Dataset of 40,000 AI-run survey interviews",
    doi: "10.5281/zenodo.9990002", published_at: "2026-10-05T09:30:00+08:00",
    seen: "search",
    text: page(
      "Dataset record.",
      "40,000 interview transcripts, with consent forms removed.",
      "DOI 10.5281/zenodo.9990002.",
    ),
  },
  "policy-draft": {
    url: "https://www.aldgate-council-sample.gov/ut-sample/ai-disclosure-draft-rule",
    kind: "statement", publisher: "Aldgate Research Council",
    title: "SAMPLE: Draft rule on AI use in grant proposals",
    doi: null, published_at: "2026-10-08T09:00:00+08:00",
    seen: "search",
    text: page(
      "The Aldgate Research Council has published a draft rule.",
      "Applicants must say if AI tools helped write any part of a proposal.",
      "The draft asks for this statement in the proposal summary only.",
      "Comments are open until the end of the year.",
    ),
  },
  "fell-paper": {
    url: "https://journals.aps.org/prl/abstract/10.1103/ut-sample-0016",
    kind: "paper", publisher: "Physical Review Letters",
    title: "SAMPLE: A robot lab reports a new magnetic material",
    doi: "10.1103/ut-sample-0016", published_at: "2026-09-21T23:00:00+08:00",
    seen: "pack", feed: "crossref-journals",
    text: page(
      "Hartwell Materials Lab (SAMPLE).",
      "A robot lab, run by the AI planner Cobalt Planner, found a new magnetic material that keeps its strength up to 400 degrees.",
      "The Cobalt Planner, built by Hartwell Materials Lab, chose each sample to make next.",
      "Robots made and tested the samples.",
      "The Cobalt Planner is a machine learning planner.",
    ),
  },
  "fell-notice": {
    url: "https://doi.org/10.1103/ut-sample-0017",
    kind: "notice", publisher: "Physical Review Letters",
    title: "SAMPLE: Retraction: A robot lab reports a new magnetic material",
    doi: "10.1103/ut-sample-0017", published_at: "2026-10-08",
    seen: "fetched",
    text: page(
      "Retraction.",
      "The authors found errors in the raw data and the paper is retracted.",
      "The claim of a new magnetic material is withdrawn.",
    ),
  },
  "disputed-preprint": {
    url: "https://arxiv.org/abs/2609.99003",
    kind: "preprint", publisher: "arXiv",
    title: "SAMPLE: Gapfinder checks a published proof and flags a gap",
    doi: null, published_at: "2026-09-14T08:00:00+08:00",
    seen: "pack", feed: "arxiv-math",
    text: page(
      "Marlow Labs (SAMPLE).",
      "Our checker, Gapfinder, read a published proof in number theory and flagged a gap in one step.",
      "The checker found the gap with no human help.",
      "This version has not been peer reviewed. arXiv:2609.99003.",
      "Gapfinder is built on a large language model.",
    ),
  },
  "disputed-statement": {
    url: "https://math.kestrel-sample.edu/news/ut-sample-reply-to-checker",
    kind: "statement", publisher: "Kestrel College",
    title: "SAMPLE: Authors reply to an AI checker's claim of a gap",
    doi: null, published_at: "2026-09-29T11:00:00+08:00",
    seen: "search",
    text: page(
      "Kestrel College said the authors of a published proof dispute the claim of the AI checker Gapfinder, from Marlow Labs, which flagged a gap in one step.",
      "They say the flagged step is correct and that the checker misread it.",
      "They have posted a reply.",
    ),
  },

  // ── The Monday, 2026-10-12: a new finding ────────────────────────────────────────────────────────
  "plasma-paper": {
    url: "https://link.springer.com/article/10.1007/ut-sample-0020",
    kind: "paper", publisher: "Fusion Science Reports",
    title: "SAMPLE: An AI controller holds a plasma steady in a test machine",
    doi: "10.1007/ut-sample-0020", published_at: "2026-10-11T18:00:00+08:00",
    seen: "pack", feed: "crossref-journals",
    text: page(
      "Fernhill Fusion Group (SAMPLE).",
      "An AI controller, the Fernhill Controller, held a plasma steady in a test machine for 90 seconds, three times longer than the standard controller.",
      "The controller, built by Fernhill Fusion Group, adjusted the magnets 1,000 times a second.",
      "It learned from practice runs.",
      "Other groups have not yet repeated the run.",
      "The Fernhill Controller was trained by reinforcement learning.",
    ),
  },
  "plasma-release": {
    url: "https://www.fernhill-sample.edu/news/ut-sample-plasma-controller",
    kind: "statement", publisher: "Fernhill University",
    title: "SAMPLE: Fernhill team shows AI control of a fusion plasma",
    doi: null, published_at: "2026-10-11T17:00:00+08:00",
    seen: "search",
    text: page(
      "Fernhill University said its fusion group ran the Fernhill Controller on a test machine.",
      "The controller kept the plasma steady for 90 seconds.",
      "People set the goal and ran the machine.",
    ),
  },

  // ── The Sunday, 2026-10-18: a new finding ────────────────────────────────────────────────────────
  "translation-release": {
    url: "https://www.quillon-sample.edu/news/ut-sample-bible-translation-draft",
    kind: "statement", publisher: "Quillon University",
    title: "SAMPLE: Quillon lab says its AI drafted a Bible translation",
    doi: null, published_at: "2026-10-17T15:00:00+08:00",
    seen: "search",
    text: page(
      "Quillon University said its language lab used an AI model, the Quill Translator, to draft a Bible translation in a language with 60,000 speakers.",
      "Native speakers will review each verse before the translation is shared.",
      "The lab has not published a paper.",
      "Many languages still have no full Bible.",
    ),
  },
  "translation-data": {
    url: "https://huggingface.co/datasets/ut-sample/quillon-bible-draft",
    kind: "dataset", publisher: "Hugging Face",
    title: "SAMPLE: Draft verses released for review",
    doi: null, published_at: "2026-10-17T15:30:00+08:00",
    seen: "search",
    text: page(
      "Dataset card.",
      "1,200 draft verses, marked as unreviewed.",
      "Released by Quillon University (SAMPLE) for native speakers to check.",
    ),
  },
} as const satisfies Record<string, SourceSpec>;

export type SourceKey = keyof typeof SOURCE_TABLE;
