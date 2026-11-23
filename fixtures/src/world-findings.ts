// The findings of the fixture world (SPEC §4.4, §4.12 "Fixtures and tests"): fifteen invented findings in all seven
// fields, one table, each defined once. A finding here is the record as it stands at the end of the sample (every
// rung entry, every later note, every source), with the date on which each part came to be; `world.ts` turns it into
// the draft's `DraftFinding` (as the agent wrote it on the finding's first brief) or into the stored `Finding` as it
// was held before any date, so the prose and the numbers sit in this one place and agree everywhere.
//
// Six findings are new in a draft (the weekday `scroll`, `protein`, `retractWD` and `erdos`, the Monday `plasma` and the
// Sunday `translation`); nine are already stored when a draft starts (`tilings`, `weather`, `catalyst`, `antibiotic`,
// `retractW0`, `policy` and `survey` of the week 2026-10-05 to 2026-10-11, and the older `fellW0` and `disputedOld`).
// The ids are hand-assigned in publication order, the counter running across fields within the year (SPEC §4.3).
//
// Everything is invented and says so: a title starts with SAMPLE, a person's name ends with (SAMPLE), a page's text
// begins "SAMPLE page" (world-sources.ts). Institutions, journals and AI systems are made up and no real person is
// quoted. The prose holds to the budgets of §4.12 (each explainer's parts, sentences of at most 24 words, reading
// grade at most 12), names no dangerous detail, uses a jargon word only as a listed term, and holds each number it
// prints in the text of a source the finding cites, so `tests/fixtures-base.test.ts` can check all of it.
//
// New for this project; Cyber's fixtures/src/world.ts had one table of items for its drafts and none for stored records.

import { retractionNote } from "../../lib/rungs";
import type {
  AiConfidence, AiRole, AiSystem, Artefacts, FieldId, FigureLicence, FindingKind, L10n, Rung, RungBy, Significance, Who,
} from "../../lib/schema/common";
import type { Depth } from "../../lib/schema/finding";
import type { SourceKey } from "./world-sources";

/** The handles of the fifteen findings, in publication order. */
export const FINDING_KEYS = [
  "disputedOld", "fellW0",
  "tilings", "weather", "catalyst", "antibiotic", "retractW0", "policy", "survey",
  "plasma",
  "scroll", "protein", "retractWD", "erdos",
  "translation",
] as const;
export type FindingKey = (typeof FINDING_KEYS)[number];

/** A glossary term a finding defines on its first publication. */
export interface TermSpec {
  readonly term: string;
  readonly definition: string;
}

/** An AI-role evidence entry: a quote of at most 25 words from one of the finding's sources. */
export interface EvidenceSpec {
  readonly source: SourceKey;
  readonly quote: string;
  readonly from_claimant: boolean;
}

export interface ReactionSpec {
  readonly source: SourceKey;
  readonly who: string;
  readonly affiliation: string;
  readonly quote: string;
}

export interface FigureSpec {
  readonly source: SourceKey;
  readonly image_url: string;
  readonly licence: FigureLicence;
  readonly licence_quote: string;
  readonly credit: string;
  readonly alt: string;
}

/** A rung entry: `date` is the event's own date, `recorded` the edition that wrote it, `by` who wrote it. A string note is English only. */
export interface RungSpec {
  readonly rung: Rung;
  readonly date: string;
  readonly recorded: string;
  readonly source: SourceKey;
  readonly by: RungBy;
  readonly note: string | L10n | null;
}

/** A later dated fact, as a returning entry writes it (SPEC §4.4): the English text and the sources that show it. */
export interface SinceThenSpec {
  readonly date: string;
  readonly text: string;
  readonly sources: readonly SourceKey[];
}

/** A source the finding cites and the edition that added it; the finding's `s` ids run in this order. */
export interface SourceUse {
  readonly key: SourceKey;
  readonly added: string;
}

export interface FindingSpec {
  /** `<field code>-2026-<counter>`: the id the finding has, or gets when its first brief publishes. */
  readonly id: string;
  /** `story` when the finding was the story of the day on its first brief. */
  readonly depth: Depth;
  readonly field: FieldId;
  readonly subfield: string;
  readonly kind: FindingKind;
  readonly significance: Significance;
  readonly title: string;
  readonly explainer: {
    readonly found: string;
    readonly matters: string;
    readonly ai_helped: string | null;
    readonly how_sure: string;
    readonly background: string;
    readonly could_lead: string;
  };
  readonly go_deeper: readonly SourceKey[];
  readonly ai: {
    readonly role: AiRole;
    readonly confidence: AiConfidence | null;
    readonly systems: readonly AiSystem[];
    readonly evidence: readonly EvidenceSpec[];
  };
  readonly rung_history: readonly RungSpec[];
  readonly since_then: readonly SinceThenSpec[];
  readonly sources: readonly SourceUse[];
  readonly reactions: readonly ReactionSpec[];
  readonly artefacts: Artefacts;
  readonly figure: FigureSpec | null;
  readonly who: readonly Who[];
  /** Terms this finding defines on its first publication, in the order its explainer uses them. */
  readonly terms: readonly TermSpec[];
  readonly related: readonly FindingKey[];
  readonly first_published: string;
  /** The editions that show it, oldest first; the first is its first brief. */
  readonly briefs: readonly string[];
}

const NO_ARTEFACTS: Artefacts = { doi: [], arxiv: [], lean: [], trial: [], pdb: [] };
const person = (name: string): Who => ({ name, ror: null });

export const FINDING_TABLE: Readonly<Record<FindingKey, FindingSpec>> = {
  // ── Older findings, stored before the week of 2026-10-05 ─────────────────────────────────────────
  disputedOld: {
    id: "math-2026-0131", depth: "item", field: "mathematics", subfield: "number-theory", kind: "check", significance: "notable",
    title: "SAMPLE: An AI checker flags a gap in a published proof",
    explainer: {
      found: "Marlow Labs says its AI checker, Gapfinder, read a published proof in number theory and flagged a gap in one step.",
      matters: "Mathematicians rely on checks like this to trust long proofs, so a flagged gap needs a careful answer.",
      ai_helped: "Marlow Labs built Gapfinder, which found the gap with no human help.",
      how_sure: "Preprint. arXiv hosts the paper, which has not been peer reviewed. Marlow Labs, the maker of the checker, is the source of the claim.",
      background: "A published proof is one that a journal has accepted.",
      could_lead: "If the gap is real, the authors could repair the step or withdraw the proof.",
    },
    go_deeper: ["disputed-preprint"],
    ai: {
      role: "ai_checked", confidence: "claimed", systems: [{ name: "Gapfinder", maker: "Marlow Labs" }],
      evidence: [{ source: "disputed-preprint", quote: "The checker found the gap with no human help", from_claimant: true }],
    },
    rung_history: [
      { rung: "preprint", date: "2026-09-14", recorded: "2026-09-15", source: "disputed-preprint", by: "agent", note: null },
      {
        rung: "disputed", date: "2026-09-29", recorded: "2026-09-30", source: "disputed-statement", by: "agent",
        note: "Kestrel College says the authors reject the claim and say the flagged step is correct.",
      },
    ],
    since_then: [],
    sources: [{ key: "disputed-preprint", added: "2026-09-15" }, { key: "disputed-statement", added: "2026-09-30" }],
    reactions: [], artefacts: { ...NO_ARTEFACTS, arxiv: ["2609.99003"] }, figure: null,
    who: [person("Marlow Labs (SAMPLE)")], terms: [], related: [],
    first_published: "2026-09-14", briefs: ["2026-09-15"],
  },
  fellW0: {
    id: "phys-2026-0134", depth: "item", field: "physics", subfield: "condensed-matter", kind: "result", significance: "major",
    title: "SAMPLE: A robot lab reports a magnetic material that keeps its strength",
    explainer: {
      found: "A robot lab run by an AI planner reported a new magnetic material that keeps its strength up to 400 degrees.",
      matters: "Strong magnets that work in the heat could help motors and generators, so a new material with that property would be useful.",
      ai_helped: "Hartwell Materials Lab built the Cobalt Planner, which chose each sample to make next. Robots made and tested the samples.",
      how_sure: "Checked. Physical Review Letters published the paper after peer review. Hartwell Materials Lab, the maker of the planner, wrote the paper.",
      background: "A magnet loses strength as it gets hot, and each material has its own limit.",
      could_lead: "If other labs repeat the result, the material could be tried in real machines.",
    },
    go_deeper: ["fell-paper"],
    ai: {
      role: "ai_ran", confidence: "claimed", systems: [{ name: "Cobalt Planner", maker: "Hartwell Materials Lab" }],
      evidence: [{
        source: "fell-paper", quote: "The Cobalt Planner, built by Hartwell Materials Lab, chose each sample to make next", from_claimant: true,
      }],
    },
    rung_history: [
      { rung: "checked", date: "2026-09-21", recorded: "2026-09-22", source: "fell-paper", by: "agent", note: null },
      {
        rung: "retracted", date: "2026-10-08", recorded: "2026-10-09", source: "fell-notice", by: "script",
        note: retractionNote("Physical Review Letters", "2026-10-08"),
      },
    ],
    since_then: [],
    sources: [{ key: "fell-paper", added: "2026-09-22" }, { key: "fell-notice", added: "2026-10-09" }],
    reactions: [], artefacts: { ...NO_ARTEFACTS, doi: ["10.1103/ut-sample-0016"] }, figure: null,
    who: [person("Hartwell Materials Lab (SAMPLE)")], terms: [], related: [],
    first_published: "2026-09-21", briefs: ["2026-09-22"],
  },

  // ── The week of 2026-10-05 to 2026-10-11, stored when the Monday's draft is written ───────────────
  tilings: {
    id: "math-2026-0140", depth: "story", field: "mathematics", subfield: "combinatorics", kind: "result", significance: "landmark",
    title: "SAMPLE: Tiles that fill a surface only without repeating",
    explainer: {
      found: "Two mathematicians at Eastvale University proved that tiles of one kind can fill a flat surface only in patterns that never repeat. Mathematicians had left this question open since 1968. The proof runs to 38 pages and needs no computer search. Other mathematicians can follow every step of it by hand, without special tools.",
      matters: "Tilings appear in computer science and in the study of materials. A proof that some tiles can never form a repeating pattern tells designers what such patterns can and cannot do. It settles a question that had stood since 1968, and it gives researchers a new method to use.",
      ai_helped: null,
      how_sure: "Checked. The Journal of Tiling Theory published the paper after peer review. Two mathematicians who were not on the paper, at Kestrel College and Northgate University, say they read the proof and found no gap. Their words are quoted on this page. The result stands on the journal's review and their reading, not on any claim by the authors.",
      background: "A tiling covers a surface with copies of shapes and leaves no gaps. A floor of square tiles repeats the same pattern again and again. This proof is about tiles that can never do that.",
      could_lead: "The method could help with the three-dimensional case, which is still open. It might also help scientists who study materials with patterns that never repeat, and designers who need such patterns in their work.",
    },
    go_deeper: ["tilings-paper"],
    ai: { role: "none", confidence: null, systems: [], evidence: [] },
    rung_history: [{ rung: "checked", date: "2026-10-02", recorded: "2026-10-05", source: "tilings-paper", by: "agent", note: null }],
    since_then: [],
    sources: [{ key: "tilings-paper", added: "2026-10-05" }, { key: "tilings-smc", added: "2026-10-05" }],
    reactions: [
      {
        source: "tilings-smc", who: "Ines Fictional (SAMPLE)", affiliation: "Kestrel College",
        quote: "I read the proof twice and I could not find a gap",
      },
      {
        source: "tilings-smc", who: "Tomas Specimen (SAMPLE)", affiliation: "Northgate University",
        quote: "The question is settled, and the method will be used for years",
      },
    ],
    artefacts: { ...NO_ARTEFACTS, doi: ["10.1017/ut-sample-0013"] }, figure: null,
    who: [person("Eastvale University mathematicians (SAMPLE)")], terms: [], related: [],
    first_published: "2026-10-02", briefs: ["2026-10-05"],
  },
  weather: {
    id: "earth-2026-0141", depth: "story", field: "earth", subfield: "weather", kind: "result", significance: "major",
    title: "SAMPLE: An AI model forecasts the weather ten days ahead",
    explainer: {
      found: "Larch Weather Systems built an AI model, Larch Forecast, that predicts the weather up to ten days ahead. In tests on two years of past weather, its ten-day forecasts had about 12 per cent fewer errors. The comparison was with numerical weather prediction, the standard method.",
      matters: "Forecasts guide farmers, airlines and emergency plans. Fewer errors ten days out gives people more time to prepare for storms and heat. A small gain in accuracy reaches many people at once. Weather agencies pay close attention to any method that beats the standard one.",
      ai_helped: "Larch Weather Systems built Larch Forecast. The model learns from past weather records, so it finds patterns in them instead of solving the equations of the air. The company also helped write the paper. The tests in the paper are the company's own.",
      how_sure: "Applied. The Meridian Weather Service says it now relies on the model for its daily forecasts. Science published the paper after peer review, and Larch Weather Systems, the maker, helped write it. The tests used past weather only, so live forecasts may differ.",
      background: "For many years, weather agencies have forecast by solving physical equations on large computers. Tests on past weather show how a new model would have done on days that are already known.",
      could_lead: "If the gain holds in other seasons and other places, forecasters could trust longer forecasts and warn people earlier. Outside teams may test the model next, on live forecasts and in other regions.",
    },
    go_deeper: ["weather-paper", "weather-statement"],
    ai: {
      role: "ai_solved", confidence: "confirmed", systems: [{ name: "Larch Forecast", maker: "Larch Weather Systems" }],
      evidence: [
        { source: "weather-paper", quote: "Larch Forecast is an AI model that predicts weather up to ten days ahead", from_claimant: true },
        { source: "weather-statement", quote: "runs Larch Forecast alongside its own system", from_claimant: false },
      ],
    },
    rung_history: [
      { rung: "checked", date: "2026-10-05", recorded: "2026-10-06", source: "weather-paper", by: "agent", note: null },
      { rung: "applied", date: "2026-10-06", recorded: "2026-10-06", source: "weather-statement", by: "agent", note: null },
    ],
    since_then: [],
    sources: [{ key: "weather-paper", added: "2026-10-06" }, { key: "weather-statement", added: "2026-10-06" }],
    reactions: [], artefacts: { ...NO_ARTEFACTS, doi: ["10.1126/ut-sample.0012"] }, figure: null,
    who: [person("Larch Weather Systems (SAMPLE)")],
    terms: [{
      term: "numerical weather prediction",
      definition: "The standard way to forecast weather: computers solve the equations of the air and sea, starting from today's measurements.",
    }],
    related: [],
    first_published: "2026-10-05", briefs: ["2026-10-06"],
  },
  catalyst: {
    id: "chem-2026-0142", depth: "item", field: "chemistry", subfield: "catalysis", kind: "result", significance: "notable",
    title: "SAMPLE: A robotic lab finds a cheap metal mixture that splits water",
    explainer: {
      found: "A robotic lab at Eastvale University tested 200 mixtures of common metals in six weeks. One mixture sped up the splitting of water into hydrogen almost as well as platinum does.",
      matters: "Platinum is rare. A cheap mixture that works nearly as well could make hydrogen from water less costly.",
      ai_helped: "Marlow Labs built Marlow Selector, which chose which mixtures to try next. Robot arms mixed and tested the samples.",
      how_sure: "Checked. The Eastvale Journal of Materials published the paper. The tests ran in one lab, and Marlow Labs, the maker of the AI system, helped write it.",
      background: "Splitting water gives hydrogen. The reaction needs a material that speeds it up, and platinum is a common choice.",
      could_lead: "Robot labs could search many more mixtures in the same time and find other cheap materials.",
    },
    go_deeper: ["catalyst-paper"],
    ai: {
      role: "ai_ran", confidence: "claimed", systems: [{ name: "Marlow Selector", maker: "Marlow Labs" }],
      evidence: [{
        source: "catalyst-paper", quote: "Marlow Selector, built by Marlow Labs, chose which mixtures to try next", from_claimant: true,
      }],
    },
    rung_history: [
      { rung: "checked", date: "2026-10-05", recorded: "2026-10-06", source: "catalyst-paper", by: "agent", note: null },
      {
        rung: "confirmed", date: "2026-10-13", recorded: "2026-10-14", source: "catalyst-confirm", by: "agent",
        note: "An independent lab repeated the work and got a matching result.",
      },
    ],
    since_then: [],
    sources: [{ key: "catalyst-paper", added: "2026-10-06" }, { key: "catalyst-confirm", added: "2026-10-14" }],
    reactions: [], artefacts: { ...NO_ARTEFACTS, doi: ["10.1007/ut-sample-0008"] }, figure: null,
    who: [person("Eastvale University robotics lab (SAMPLE)")], terms: [], related: [],
    first_published: "2026-10-05", briefs: ["2026-10-06"],
  },
  antibiotic: {
    id: "bio-2026-0143", depth: "story", field: "biology", subfield: "drugs", kind: "result", significance: "major",
    title: "SAMPLE: An AI model proposes a new antibiotic that works in mice",
    explainer: {
      found: "An AI model proposed a new antibiotic that cleared a drug-resistant skin infection in 8 of 10 mice. The model, Halden Design, ranked about 12 million molecules. The team made and tested 40 of the top ones. Three of the 40 stopped the growth of drug-resistant bacteria in dishes.",
      matters: "Antimicrobial resistance makes some infections hard to treat, and doctors need new antibiotics. A first safety trial of the compound in people is registered as NCT09999001. The trial plans to enrol 24 healthy volunteers. It tests safety, not cure.",
      ai_helped: "Halden Research built Halden Design, which ranks molecules by their chance of killing drug-resistant bacteria. The model proposed which molecules to make. People made them and ran every test. The Coldwater Institute ran the mouse tests and runs the safety trial.",
      how_sure: "Checked. Cell published the paper after peer review. Halden Research, which built the model, helped write the paper, and no other lab has repeated the tests. The Coldwater Institute says it ran the mouse tests and runs the first safety trial.",
      background: "Drug makers once found antibiotics by testing natural samples one by one. Computers can now rank a huge list of molecules before anyone makes one. That lets labs test only the best candidates.",
      could_lead: "If later trials go well, the compound could become a treatment for drug-resistant infections. It might also show that AI can find other new antibiotics. First, other labs must repeat the tests.",
    },
    go_deeper: ["antibiotic-paper", "antibiotic-trial"],
    ai: {
      role: "ai_proposed", confidence: "claimed", systems: [{ name: "Halden Design", maker: "Halden Research" }],
      evidence: [{
        source: "antibiotic-paper", quote: "Our model, Halden Design, ranked about 12 million molecules for their chance of killing drug-resistant bacteria",
        from_claimant: true,
      }],
    },
    rung_history: [
      { rung: "checked", date: "2026-10-07", recorded: "2026-10-08", source: "antibiotic-paper", by: "agent", note: null },
      {
        rung: "confirmed", date: "2026-10-15", recorded: "2026-10-16", source: "antibiotic-second", by: "agent",
        note: "A second lab with no tie to the first repeated the mouse tests.",
      },
    ],
    since_then: [{
      date: "2026-10-16",
      text: "A second lab, Kestrel College, repeated the mouse tests with its own mice and samples. The compound cleared the infection in 7 of 10 mice. The lab says it has no tie to Halden Research.",
      sources: ["antibiotic-second"],
    }],
    sources: [
      { key: "antibiotic-paper", added: "2026-10-08" }, { key: "antibiotic-trial", added: "2026-10-08" },
      { key: "antibiotic-release", added: "2026-10-08" }, { key: "antibiotic-second", added: "2026-10-16" },
    ],
    reactions: [],
    artefacts: { ...NO_ARTEFACTS, doi: ["10.1016/ut-sample-0014"], trial: ["NCT09999001"] }, figure: null,
    who: [person("Halden Research (SAMPLE)"), person("Coldwater Institute (SAMPLE)")],
    terms: [{ term: "antimicrobial resistance", definition: "When germs stop responding to the drugs that used to kill them." }],
    related: [],
    first_published: "2026-10-07", briefs: ["2026-10-08", "2026-10-16", "2026-10-18"],
  },
  retractW0: {
    id: "soc-2026-0144", depth: "item", field: "social", subfield: "replication", kind: "setback", significance: "major",
    title: "SAMPLE: Reviewers shared unpublished papers with an AI chatbot",
    explainer: {
      found: "The journal eLife found that reviewers pasted the text of 31 unpublished manuscripts into a public AI chatbot to help write their reports.",
      matters: "Authors send unpublished work to a journal in confidence. Pasting it into a public tool breaks that trust and may expose the work.",
      ai_helped: "Reviewers used an AI chatbot to help write reports. eLife does not name the chatbot.",
      how_sure: "Checked. eLife, the journal involved, says so in its own statement and in an editorial note.",
      background: "Peer review is the step where outside experts judge a paper before it is published.",
      could_lead: "Journals could write clear rules and tell reviewers what they may share.",
    },
    go_deeper: ["reviewer-statement", "reviewer-notice"],
    ai: {
      role: "ai_tool", confidence: "confirmed", systems: [],
      evidence: [{
        source: "reviewer-statement", quote: "pasted the text of 31 unpublished manuscripts into a public AI chatbot", from_claimant: false,
      }],
    },
    rung_history: [{ rung: "checked", date: "2026-10-08", recorded: "2026-10-08", source: "reviewer-statement", by: "agent", note: null }],
    since_then: [],
    sources: [{ key: "reviewer-statement", added: "2026-10-08" }, { key: "reviewer-notice", added: "2026-10-08" }],
    reactions: [], artefacts: NO_ARTEFACTS, figure: null,
    who: [person("eLife editors (SAMPLE)")], terms: [], related: [],
    first_published: "2026-10-08", briefs: ["2026-10-08"],
  },
  policy: {
    id: "soc-2026-0145", depth: "story", field: "social", subfield: "politics-society", kind: "policy_people", significance: "notable",
    title: "SAMPLE: A research council plans to ask applicants about AI use",
    explainer: {
      found: "The Aldgate Research Council published a draft rule on AI in grant proposals. Applicants would have to say if AI tools helped write any part of a proposal. The draft asks for this statement in the proposal summary only. Comments are open until the end of the year.",
      matters: "Research councils decide who receives funding. A rule on AI use tells applicants what they must disclose, and it tells reviewers what they are reading. Other funders could copy a rule like this one, so its wording may matter far beyond one council.",
      ai_helped: "No AI system is named in the draft. The rule is about AI tools in general: it covers any tool that helped write a proposal. The council asks applicants to say what help they had, not which tool gave it.",
      how_sure: "Claimed. The Aldgate Research Council states the draft in its own announcement. It is a proposal, not yet a rule, and the council may change it after the comment period closes. No other source we read says how the council will act.",
      background: "Funding councils receive many proposals each year. Writers use many tools, from spell checkers to AI chatbots. A disclosure rule asks them to say what help they had.",
      could_lead: "A final rule could set a pattern for other funders. It might also push applicants to hide their use of AI if the rule is unclear. Clear examples in the rule could prevent that.",
    },
    go_deeper: ["policy-draft"],
    ai: {
      role: "ai_tool", confidence: "confirmed", systems: [],
      evidence: [{
        source: "policy-draft", quote: "Applicants must say if AI tools helped write any part of a proposal", from_claimant: false,
      }],
    },
    rung_history: [{ rung: "claimed", date: "2026-10-08", recorded: "2026-10-10", source: "policy-draft", by: "agent", note: null }],
    since_then: [{
      date: "2026-10-14",
      text: "The council published its final rule. From 1 January, applicants must say if AI tools helped write any part of a proposal. The final rule covers every part of a proposal, not only the summary.",
      sources: ["policy-final"],
    }],
    sources: [{ key: "policy-draft", added: "2026-10-10" }, { key: "policy-final", added: "2026-10-14" }],
    reactions: [], artefacts: NO_ARTEFACTS, figure: null,
    who: [person("Aldgate Research Council (SAMPLE)")], terms: [], related: [],
    first_published: "2026-10-08", briefs: ["2026-10-10", "2026-10-14"],
  },
  survey: {
    id: "soc-2026-0146", depth: "item", field: "social", subfield: "surveys-experiments", kind: "infrastructure", significance: "watch",
    title: "SAMPLE: An open dataset of 40,000 AI-run survey interviews",
    explainer: {
      found: "The Coldwater Institute survey lab released 40,000 interviews that an AI interviewer ran by chat with adult volunteers.",
      matters: "Surveys take a great deal of time. A shared dataset lets other researchers study how AI interviewers work.",
      ai_helped: "The Coldwater Institute survey lab built Survey Voice, which asked the questions and followed up on answers. People wrote the questions and checked a sample of the transcripts.",
      how_sure: "Preprint. SSRN hosts the paper, which has not been peer reviewed. The Coldwater Institute survey lab, which built the system, is the source.",
      background: "Researchers use interviews to learn what people think and why.",
      could_lead: "AI interviewers could make large surveys cheaper, if their answers match those of people.",
    },
    go_deeper: ["survey-preprint", "survey-data"],
    ai: {
      role: "ai_ran", confidence: "claimed", systems: [{ name: "Survey Voice", maker: "Coldwater Institute" }],
      evidence: [{
        source: "survey-preprint", quote: "Survey Voice asked the questions and followed up on answers", from_claimant: true,
      }],
    },
    rung_history: [{ rung: "preprint", date: "2026-10-05", recorded: "2026-10-10", source: "survey-preprint", by: "agent", note: null }],
    since_then: [],
    sources: [{ key: "survey-preprint", added: "2026-10-10" }, { key: "survey-data", added: "2026-10-10" }],
    reactions: [], artefacts: { ...NO_ARTEFACTS, doi: ["10.5281/zenodo.9990002"] }, figure: null,
    who: [person("Coldwater Institute survey lab (SAMPLE)")], terms: [], related: [],
    first_published: "2026-10-05", briefs: ["2026-10-10"],
  },

  // ── The Monday, 2026-10-12 ───────────────────────────────────────────────────────────────────────
  plasma: {
    id: "phys-2026-0147", depth: "item", field: "physics", subfield: "plasma-fusion", kind: "result", significance: "notable",
    title: "SAMPLE: An AI controller steadies a fusion test machine",
    explainer: {
      found: "An AI controller held a plasma steady in a fusion test machine for 90 seconds, three times longer than the standard controller.",
      matters: "Fusion machines need steady control to work, and long runs are hard to reach. Better control is one step toward fusion power.",
      ai_helped: "Fernhill Fusion Group built the Fernhill Controller, which adjusted the magnets 1,000 times a second. It learned from practice runs.",
      how_sure: "Checked. Fusion Science Reports published the paper after peer review. Fernhill Fusion Group built the controller, and other groups have not yet repeated the run.",
      background: "Fusion power needs a very hot gas held in place by magnets.",
      could_lead: "If other groups repeat the run, AI control could become a standard part of fusion machines.",
    },
    go_deeper: ["plasma-paper", "plasma-release"],
    ai: {
      role: "ai_ran", confidence: "claimed", systems: [{ name: "Fernhill Controller", maker: "Fernhill Fusion Group" }],
      evidence: [{
        source: "plasma-paper", quote: "The controller, built by Fernhill Fusion Group, adjusted the magnets 1,000 times a second", from_claimant: true,
      }],
    },
    rung_history: [{ rung: "checked", date: "2026-10-11", recorded: "2026-10-12", source: "plasma-paper", by: "agent", note: null }],
    since_then: [],
    sources: [{ key: "plasma-paper", added: "2026-10-12" }, { key: "plasma-release", added: "2026-10-12" }],
    reactions: [], artefacts: { ...NO_ARTEFACTS, doi: ["10.1007/ut-sample-0020"] }, figure: null,
    who: [person("Fernhill Fusion Group (SAMPLE)")],
    terms: [{
      term: "plasma",
      definition: "A very hot gas whose atoms have lost electrons, the state of matter in the sun and in fusion machines.",
    }],
    related: ["fellW0"],
    first_published: "2026-10-11", briefs: ["2026-10-12"],
  },

  // ── The weekday, 2026-10-14 ──────────────────────────────────────────────────────────────────────
  scroll: {
    id: "hum-2026-0148", depth: "story", field: "humanities", subfield: "ancient-texts", kind: "result", significance: "landmark",
    title: "SAMPLE: A sealed scroll is read without being opened",
    explainer: {
      found: "A team at Eastvale University read about 1,800 Greek letters inside a papyrus scroll that cannot be unrolled. The scroll came from the library at Herculaneum. The letters fill six columns of text, and the passage is part of a prose work on friendship.",
      matters: "Hundreds of scrolls from the same library are still sealed. A method that reads them without opening them leaves each scroll whole. Scholars could then study many scrolls, not only this one. One expert calls it the first whole passage of connected prose from a sealed scroll.",
      ai_helped: "Eastvale University built a model called the Ink Reader. The team scanned the scroll with X-rays and flattened its layers in software, a step called virtual unwrapping. The Ink Reader, trained on small patches where ink had been found by hand, then marked the ink in the scans. People read the marked letters.",
      how_sure: "Checked. Nature published the paper after peer review. Scholars in two countries, outside the Eastvale team, checked the readings. Two experts quoted here, at Ravenhurst University and the Coldwater Institute, call the readings careful.",
      background: "Mount Vesuvius erupted in AD 79 and buried the Roman town of Herculaneum. The eruption charred hundreds of papyrus scrolls in its library. None of them can be unrolled.",
      could_lead: "The same method could open other sealed scrolls and bring back books that no one has read since the eruption. Scholars may then learn what the library held.",
    },
    go_deeper: ["scroll-paper", "scroll-release"],
    ai: {
      role: "ai_tool", confidence: "confirmed", systems: [{ name: "Ink Reader", maker: "Eastvale University" }],
      evidence: [
        { source: "scroll-paper", quote: "trained a machine-learning model to detect ink", from_claimant: true },
        { source: "scroll-smc", quote: "The model found ink traces that no human reader could see", from_claimant: false },
      ],
    },
    rung_history: [{ rung: "checked", date: "2026-10-13", recorded: "2026-10-14", source: "scroll-paper", by: "agent", note: null }],
    since_then: [],
    sources: [
      { key: "scroll-paper", added: "2026-10-14" }, { key: "scroll-nv", added: "2026-10-14" },
      { key: "scroll-smc", added: "2026-10-14" }, { key: "scroll-release", added: "2026-10-14" },
    ],
    reactions: [
      {
        source: "scroll-nv", who: "Mira Placeholder (SAMPLE)", affiliation: "Ravenhurst University",
        quote: "This is the first time a sealed scroll has given up a whole passage of connected prose",
      },
      {
        source: "scroll-smc", who: "Jonas Example (SAMPLE)", affiliation: "Coldwater Institute",
        quote: "The readings are careful and the Greek is sound",
      },
    ],
    artefacts: { ...NO_ARTEFACTS, doi: ["10.1038/nature-ut-sample-0001"] },
    figure: {
      source: "scroll-paper", image_url: "https://media.springernature.com/ut-sample/scroll-figure-2.png", licence: "CC-BY-4.0",
      licence_quote: "This article is licensed under a Creative Commons Attribution 4.0 International License",
      credit: "Figure 2 from the Eastvale imaging team, Nature (SAMPLE), CC BY 4.0",
      alt: "A flattened scan of one scroll layer, with the ink the model found marked in yellow over a column of Greek letters.",
    },
    who: [person("Eastvale University imaging group (SAMPLE)")],
    terms: [
      {
        term: "virtual unwrapping",
        definition: "Scanning a rolled scroll and flattening its layers on a computer, so the text can be read without unrolling it.",
      },
      { term: "papyrus", definition: "A writing sheet made from the papyrus plant, used in the ancient Mediterranean world." },
    ],
    related: [],
    first_published: "2026-10-13", briefs: ["2026-10-14"],
  },
  protein: {
    id: "bio-2026-0149", depth: "item", field: "biology", subfield: "proteins", kind: "result", significance: "major",
    title: "SAMPLE: A lab measures a protein that an AI had predicted",
    explainer: {
      found: "A second lab measured the shape of a protein complex and found that an AI model had predicted it correctly.",
      matters: "A protein's shape shows how it works and how a drug might fit. Measuring a shape is slow.",
      ai_helped: "Halden Research built the model, Halden Fold. It posted its prediction before anyone had measured the complex.",
      how_sure: "Confirmed. PNAS published the measured structure, which matches the prediction in every chain. Halden Research did not do the measurement.",
      background: "The lab used cryo-electron microscopy, which images frozen molecules, to measure the complex. A first safety trial of a drug that binds the complex is registered as NCT09999002.",
      could_lead: "If more predictions match, AI could shorten the search for new medicines.",
    },
    go_deeper: ["protein-paper", "protein-entry"],
    ai: {
      role: "ai_solved", confidence: "confirmed", systems: [{ name: "Halden Fold", maker: "Halden Research" }],
      evidence: [
        {
          source: "protein-preprint", quote: "Halden Fold predicted the structure of the complex before any measurement", from_claimant: true,
        },
        { source: "protein-paper", quote: "The measured structure matches the model prediction in every chain", from_claimant: false },
      ],
    },
    rung_history: [
      { rung: "preprint", date: "2026-09-02", recorded: "2026-10-14", source: "protein-preprint", by: "agent", note: null },
      {
        rung: "confirmed", date: "2026-10-13", recorded: "2026-10-14", source: "protein-paper", by: "agent",
        note: "A second lab measured the structure and found the prediction correct.",
      },
    ],
    since_then: [],
    sources: [
      { key: "protein-preprint", added: "2026-10-14" }, { key: "protein-paper", added: "2026-10-14" },
      { key: "protein-entry", added: "2026-10-14" }, { key: "protein-trial", added: "2026-10-14" },
    ],
    reactions: [],
    artefacts: {
      ...NO_ARTEFACTS, doi: ["10.1073/ut-sample.0003", "10.1101/2026.09.02.990011"], pdb: ["pdb_00009zz1"], trial: ["NCT09999002"],
    },
    figure: null,
    who: [person("Halden Research (SAMPLE)")],
    terms: [{
      term: "cryo-electron microscopy",
      definition: "A way to see the shape of a molecule by imaging it frozen in ice with a beam of electrons.",
    }],
    related: ["antibiotic"],
    first_published: "2026-09-02", briefs: ["2026-10-14"],
  },
  retractWD: {
    id: "chem-2026-0150", depth: "item", field: "chemistry", subfield: "materials", kind: "setback", significance: "major",
    title: "SAMPLE: Springer Nature retracts 84 papers with undisclosed AI text",
    explainer: {
      found: "Springer Nature retracted 84 papers in nine journals. The text and images in these papers came from an AI tool that the authors did not disclose.",
      matters: "Other researchers may have cited these papers, so the harm can spread beyond the journals.",
      ai_helped: "An AI tool made the text and images. The publisher's notices do not name the tool.",
      how_sure: "Checked. Springer Nature, the publisher of the papers, says so in its own statement and in two retraction notices.",
      background: "A retraction notice tells readers that a paper should no longer be relied on.",
      could_lead: "Publishers could check for undisclosed AI text before they accept a paper.",
    },
    go_deeper: ["retract-statement", "retract-notice-1"],
    ai: {
      role: "ai_tool", confidence: "confirmed", systems: [],
      evidence: [{
        source: "retract-statement", quote: "produced with an AI tool that the authors did not disclose", from_claimant: false,
      }],
    },
    rung_history: [{ rung: "checked", date: "2026-10-13", recorded: "2026-10-14", source: "retract-statement", by: "agent", note: null }],
    since_then: [],
    sources: [
      { key: "retract-statement", added: "2026-10-14" }, { key: "retract-notice-1", added: "2026-10-14" },
      { key: "retract-notice-2", added: "2026-10-14" },
    ],
    reactions: [], artefacts: NO_ARTEFACTS, figure: null,
    who: [person("Springer Nature (SAMPLE statement)")], terms: [], related: ["retractW0"],
    first_published: "2026-10-13", briefs: ["2026-10-14"],
  },
  erdos: {
    id: "math-2026-0151", depth: "item", field: "mathematics", subfield: "combinatorics", kind: "result", significance: "notable",
    title: "SAMPLE: An AI lab claims a proof of an open problem",
    explainer: {
      found: "Marlow Labs says its AI system found a proof of an open problem about sums of sets of whole numbers.",
      matters: "A proof would settle a question that mathematicians had left open.",
      ai_helped: "Marlow Labs built the Marlow Prover. The lab says the system found the proof with no human step in the argument.",
      how_sure: "Preprint. arXiv hosts the paper, which has not been peer reviewed. Marlow Labs is the source of the claim.",
      background: "A Lean file posted with the paper lets a proof assistant check the argument by machine.",
      could_lead: "If the Lean file checks, the proof could be accepted without waiting long for referees.",
    },
    go_deeper: ["erdos-preprint", "erdos-lean"],
    ai: {
      role: "ai_solved", confidence: "claimed", systems: [{ name: "Marlow Prover", maker: "Marlow Labs" }],
      evidence: [{
        source: "erdos-preprint", quote: "The proof was found by the Marlow Prover with no human step in the argument", from_claimant: true,
      }],
    },
    rung_history: [{ rung: "preprint", date: "2026-10-13", recorded: "2026-10-14", source: "erdos-preprint", by: "agent", note: null }],
    since_then: [],
    sources: [{ key: "erdos-preprint", added: "2026-10-14" }, { key: "erdos-lean", added: "2026-10-14" }],
    reactions: [],
    artefacts: {
      ...NO_ARTEFACTS, arxiv: ["2610.99001"],
      lean: ["https://github.com/marlow-labs-sample/sumsets-proof/blob/main/SumSets.lean"],
    },
    figure: null,
    who: [person("Marlow Labs (SAMPLE)")],
    terms: [{ term: "proof assistant", definition: "A computer program that checks, step by step, that a mathematical proof follows the rules of logic." }],
    related: ["tilings", "disputedOld"],
    first_published: "2026-10-13", briefs: ["2026-10-14"],
  },

  // ── The Sunday, 2026-10-18 ───────────────────────────────────────────────────────────────────────
  translation: {
    id: "hum-2026-0152", depth: "item", field: "humanities", subfield: "scripture-translation", kind: "capability", significance: "notable",
    title: "SAMPLE: A university says AI drafted a Bible translation",
    explainer: {
      found: "Quillon University says its language lab used an AI model to draft a Bible translation in a language with 60,000 speakers.",
      matters: "Many languages still have no full Bible. A draft that native speakers review could reach readers sooner.",
      ai_helped: "Quillon University built the Quill Translator, which wrote the draft. Native speakers will review each verse before the translation is shared.",
      how_sure: "Claimed. Quillon University says so in its own statement, and the lab has not published a paper. The university built the system.",
      background: "Translators have long worked by hand, one verse at a time.",
      could_lead: "If reviewers find the drafts sound, the method could help smaller language groups.",
    },
    go_deeper: ["translation-release", "translation-data"],
    ai: {
      role: "ai_tool", confidence: "claimed", systems: [{ name: "Quill Translator", maker: "Quillon University" }],
      evidence: [{
        source: "translation-release", quote: "used an AI model, the Quill Translator, to draft a Bible translation", from_claimant: true,
      }],
    },
    rung_history: [{ rung: "claimed", date: "2026-10-17", recorded: "2026-10-18", source: "translation-release", by: "agent", note: null }],
    since_then: [],
    sources: [{ key: "translation-release", added: "2026-10-18" }, { key: "translation-data", added: "2026-10-18" }],
    reactions: [], artefacts: NO_ARTEFACTS, figure: null,
    who: [person("Quillon University language lab (SAMPLE)")], terms: [], related: [],
    first_published: "2026-10-17", briefs: ["2026-10-18"],
  },
};
