// The four valid drafts (SPEC §4.5 "DraftBrief", §4.12 "Fixtures and tests"): one for each edition of the fixture world, each
// built from the shared world (`world.ts`) and passing every validator rule with no error and no warning. The weekday
// draft is the base of every `invalid--<CODE>.json` and `soft--<CODE>.json` mutation, so it holds one of each thing a rule
// reads: a story that is a Landmark with a figure and two reactions, a Major result confirmed by an independent paper, a
// Major setback built from a publisher's statement and retraction notices, a claimed finding, a returning finding, a rung
// change, ideas, also-noted lines, new glossary terms, and two corrections that answer two reports.
//   weekday       Wednesday 2026-10-14: the story and three more new findings, a returning finding, a rung change
//   sunday        Sunday 2026-10-18: one new finding and the deep dive on the antibiotic finding, for news
//   monday        Monday 2026-10-12: one new finding and the review of the week 2026-10-05 to 2026-10-11
//   monday-short  Monday 2026-11-02: the review of a week with no finding
//
// The prose that only a draft carries (the Lead, the ideas and also-noted lines, the deep dive, the two big pictures, the
// remarkable note and the strongest evidence against) is written here, each text once. The findings' own prose is in
// `world-findings.ts`, and the corrections and report decisions in `world.ts`. All of it holds to the word budgets of §4.12,
// the sentence limit, reading grade 12, no hype word and no number a cited source does not hold (`tests/fixtures-base.test.ts`).
//
// Cyber's fixtures/src/drafts.ts at the fork commit 3ced1fb, adapted: its builders (one cached draft for each edition, a deep
// copy for each caller) and its named handles for the weekday's items (`WEEKDAY_ITEMS`) are the pattern; the drafts, the
// handles and the plans that tie a draft to its inputs are this project's.

import { compareFindingIds } from "../../lib/ids";
import { DraftBrief, type DraftCorrection, type DraftFinding, type DraftRung } from "../../lib/schema/draft";
import { NONE_FOUND } from "../../lib/vocab";
import {
  EDITIONS, WEEKDAY_CORRECTIONS, WEEKDAY_DECISION, draftFinding, draftSources, findingId, returningFact, rungEntryOf,
  sourceIds, sourceSpec, type EditionName, type FindingKey, type SourceKey,
} from "./world";

// ── Plans: what each edition holds ───────────────────────────────────────────────────────────────

/** What an edition's draft holds, by finding handle and source key: the one table the draft, its context and its evidence read. */
export interface EditionPlan {
  /** The new findings, in the order of their refs (`new-1`, `new-2`, ...). */
  readonly newFindings: readonly FindingKey[];
  /** The story of the day, a new or an existing finding, or null. */
  readonly story: FindingKey | null;
  /** The items in display order, new or existing. */
  readonly items: readonly FindingKey[];
  /** Existing findings with new facts, shown in the story or the items. */
  readonly returning: readonly FindingKey[];
  /** Existing findings the agent changed the rung of, shown nowhere else. */
  readonly rungChanges: readonly FindingKey[];
  /** The finding of the Sunday deep dive, or null. */
  readonly deepDive: FindingKey | null;
  /** The finding of the Monday review's remarkable note, or null. */
  readonly remarkable: FindingKey | null;
  /** The setbacks and the findings that fell, which the Monday review's strongest evidence against names (sorted by id). */
  readonly against: readonly FindingKey[];
  /** The brief-level sources, `b1`, `b2`, ... in this order. */
  readonly briefSources: readonly SourceKey[];
}

export const PLANS: Readonly<Record<EditionName, EditionPlan>> = {
  weekday: {
    newFindings: ["scroll", "protein", "retractWD", "erdos"],
    story: "scroll",
    items: ["protein", "retractWD", "erdos", "policy"],
    returning: ["policy"],
    rungChanges: ["catalyst"],
    deepDive: null, remarkable: null, against: [],
    briefSources: ["policy-final", "catalyst-confirm", "idea-proof-checking", "idea-open-review", "also-monsoon", "also-inscriptions"],
  },
  sunday: {
    newFindings: ["translation"],
    story: null,
    items: ["translation"],
    returning: [], rungChanges: [],
    deepDive: "antibiotic", remarkable: null, against: [],
    briefSources: ["antibiotic-paper", "antibiotic-trial", "antibiotic-release", "antibiotic-second"],
  },
  monday: {
    newFindings: ["plasma"],
    story: null,
    items: ["plasma"],
    returning: [], rungChanges: [],
    deepDive: null, remarkable: "antibiotic", against: ["fellW0", "retractW0"],
    briefSources: ["reviewer-statement", "fell-notice"],
  },
  "monday-short": {
    newFindings: [],
    story: null,
    items: [],
    returning: [], rungChanges: [],
    deepDive: null, remarkable: null, against: [],
    briefSources: [],
  },
};

/** The ref a draft gives a finding: `new-N` for a new finding, its id for an existing one. */
export function refOf(name: EditionName, key: FindingKey): string {
  const i = PLANS[name].newFindings.indexOf(key);
  return i >= 0 ? `new-${i + 1}` : findingId(key);
}

/** The brief-level source ids of an edition, by source key (`b1`, `b2`, ...). */
export const briefSourceIds = (name: EditionName): Record<string, string> => sourceIds(PLANS[name].briefSources, "b");

/** The id of a brief-level source of an edition; throws for a key the edition does not cite. */
export function briefSourceId(name: EditionName, key: SourceKey): string {
  const id = briefSourceIds(name)[key];
  if (id === undefined) throw new Error(`${name} has no brief-level source ${key}`);
  return id;
}

// ── Handles ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The weekday draft's findings by the role a rule reads them in: a `new-N` ref for a new finding and an id for an existing
 * one, so a mutation never counts on a position. `tests/fixtures-base.test.ts` checks each role still holds.
 */
export const WEEKDAY_ITEMS = {
  /** The story: a Landmark, ai_tool confirmed by a source that is not the claimant, two reactions, a figure, a DOI, two new terms. */
  story: refOf("weekday", "scroll"),
  landmark: refOf("weekday", "scroll"),
  figure: refOf("weekday", "scroll"),
  /** A Major result: Preprint then Confirmed by an independent paper, a DOI, a PDB entry, a new term. */
  result: refOf("weekday", "protein"),
  /** A Major setback built from the publisher's statement and two retraction notices, `ai.systems` []. */
  setback: refOf("weekday", "retractWD"),
  /** A Notable result at Preprint whose AI role is claimed, naming its maker; an arXiv id and a Lean file. */
  claimed: refOf("weekday", "erdos"),
  /** An existing finding with new facts (a returning entry), as it stands in the context. */
  returning: findingId("policy"),
  /** An existing finding whose rung the agent changed (an entry of `rung_changes`). */
  rungChange: findingId("catalyst"),
  /** The two stored findings the corrections correct: the weather finding (R-0001, upheld by JL) and the tilings finding (R-0002, open). */
  weather: findingId("weather"),
  tilings: findingId("tilings"),
} as const;

/** The two reports of the weekday's context, and where their corrections and decision stand in the draft. */
export const WEEKDAY_REPORTS = {
  /** Closed by JL as upheld before the run: the draft's last correction carries its `report_id`. */
  upheld: "R-0001",
  /** Open: the draft's one decision answers it, upholding it with `corrections[0]`. */
  open: "R-0002",
  /** The index of the correction that answers the open report. */
  openCorrection: 0,
  /** The index of the correction for the report JL upheld: the last, so that `soft--REPORT_UPHELD` can drop it and no decision index shifts. */
  upheldCorrection: WEEKDAY_CORRECTIONS.length - 1,
} as const;

/** The Sunday draft's findings: the one new item and the deep dive's finding. */
export const SUNDAY_ITEMS = {
  item: refOf("sunday", "translation"),
  /** The deep dive: a biology finding of the context's `ledger_for_sunday`, reason news. */
  deepDive: findingId("antibiotic"),
} as const;

/** The Monday draft's findings: the new item, the remarkable finding, the setback and the finding that fell. */
export const MONDAY_ITEMS = {
  item: refOf("monday", "plasma"),
  remarkable: findingId("antibiotic"),
  setback: findingId("retractW0"),
  fell: findingId("fellW0"),
} as const;

// ── The prose only a draft carries ───────────────────────────────────────────────────────────────

const WEEKDAY_TEXT = {
  lead: [
    "Scholars read the writing inside a sealed ancient scroll without opening it.",
    "A lab measured a protein that an AI model had predicted, and the shape matched.",
    "A publisher pulled many papers with undisclosed AI text, and a research council made its AI rule final.",
  ],
  ideas: [
    "Oren Nominal (SAMPLE) argues that journals should let AI check every submitted proof before human review begins.",
    "Sana Provisional (SAMPLE) argues that reviewers should be told plainly what they may share with AI tools.",
  ],
  also: [
    "SAMPLE: A model predicts monsoon rainfall weeks ahead",
    "SAMPLE: A public dataset of ancient inscriptions read with machine help",
  ],
} as const;

const SUNDAY_TEXT = {
  lead: [
    "A university says its AI drafted a Bible translation for a small language group.",
    "Today's deep dive follows an AI-proposed antibiotic from the first ranking to a second lab's tests.",
  ],
  deepDive: [
    "Some germs have stopped responding to the drugs that used to kill them. This is called antimicrobial resistance. It makes some infections hard to treat, and doctors need new antibiotics.",
    "Finding a new antibiotic has always been slow. A lab can make and test only a few molecules, and the list of molecules that might work is huge. That is where the AI model came in.",
    "Halden Research built an AI model called Halden Design. Its paper says the model ranked about 12 million molecules for their chance of killing drug-resistant bacteria. The ranking gave the lab a short list to work from. A ranking is a guess, and it only becomes a finding when someone makes the molecule and tests it.",
    "People took over from there. They made 40 of the top molecules and tested them. Three of the 40 stopped the growth of drug-resistant bacteria in dishes. The best of these cleared a drug-resistant skin infection in 8 of 10 mice.",
    "The Coldwater Institute says its team ran the tests in mice. It also runs a first safety trial in people. The trial plans to enrol 24 healthy volunteers. It tests safety, not cure, so it cannot yet tell us whether the compound treats an infection.",
    "So who did what? The AI model proposed which molecules to make. People made them, ran every test and judged the results.",
    "How sure are we? At first the record was one paper. Cell published it after peer review, so we marked it Checked. But Halden Research, which built the model, helped write the paper, and no other lab had repeated the tests. Our ladder has five steps, and a claim moves up only when the record earns it.",
    "That changed this week. A second lab, at Kestrel College, repeated the mouse tests with its own mice and its own samples of the compound. Cell Reports Medicine published its paper. The compound cleared the infection in 7 of 10 mice, close to the 8 of 10 that the first team reported. The lab says it has no tie to Halden Research.",
    "A matching result from a lab with no tie to the first team is what moves a claim up our ladder. The record now stands at Confirmed. It is still a result in mice.",
    "For this tracker, the order of events matters. The AI model made its proposals first, and people tested them afterwards. That order is what lets us say the AI helped, and it is what a second lab could check.",
    "Much is still open. Mice are not people, so a compound that works in mice may not work in a person. The safety trial has only begun. If it goes well, later trials could test whether the compound treats infections. It might also show that AI can find other new antibiotics, but that would take more cases. Other labs could test those cases, and their results would tell us how far the method reaches.",
  ],
} as const;

const MONDAY_TEXT = {
  lead: [
    "An AI controller kept a hot gas steady in a fusion test machine for longer than the standard controller.",
    "Last week's review picks out the AI antibiotic and weighs it against a journal setback and a retracted paper.",
  ],
  bigPicture: [
    "The week mixed progress with warnings. The clearest progress came where someone other than the makers tested a result. A proof about tiles was read and checked by two mathematicians who were not on the paper.",
    "The week's largest result involved no AI at all. Two mathematicians proved that tiles of one kind can fill a flat surface only in patterns that never repeat. We list it because a result of that size should never be missed, and we say plainly that no AI role is known.",
    "Where AI did play a part, the stage of the evidence varied. A new weather model beat the standard method in tests on past weather, but the tests were the maker's own. A robotic lab found a cheap metal mixture that splits water, but in one lab so far. An AI model proposed an antibiotic that cleared an infection in mice, and the first safety trial in people has only begun. In each case we mark how sure we are and who says so.",
    "The week also held harm. A journal found that reviewers had pasted unpublished papers into a public chatbot. A paper from a robot lab on a magnetic material was retracted after its authors found errors in the raw data. The second case matters most to this tracker, because AI helped make the first claim and the claim did not stand.",
    "Two items were about the rules and tools around the science. A research council proposed that applicants say whether AI helped write a proposal. A lab released a large set of AI-run survey interviews that other researchers can study.",
    "Our reading is cautious. The best evidence came from checks by people outside the team that made the claim. The weakest came from claims that rest on one lab. This week we will watch whether other labs repeat the antibiotic tests and what the research council decides.",
  ],
  remarkable: "An AI model proposed a new antibiotic that cleared a drug-resistant infection in mice. People made and tested every molecule, and the first safety trial in people has begun.",
  against: "Reviewers at the journal Sample Review pasted unpublished manuscripts into a public AI chatbot. A robot lab's paper on a magnetic material, planned by an AI, was retracted after the authors found errors in the raw data.",
} as const;

const MONDAY_SHORT_TEXT = {
  lead: ["Nothing cleared our bar today, and last week was quiet too."],
  bigPicture: "Last week was quiet. No finding cleared our bar, so there is no result to review and none to single out. The record is still short, and we would rather say so than pad this page. A quiet week is not evidence for or against the hope that AI is speeding up discovery. We keep reading the sources every morning and will report a result as soon as one clears the bar.",
} as const;

/** The texts only the drafts carry, by edition, for the tests that read them. */
export const DRAFT_TEXT = { weekday: WEEKDAY_TEXT, sunday: SUNDAY_TEXT, monday: MONDAY_TEXT, "monday-short": MONDAY_SHORT_TEXT } as const;

// ── Builders ─────────────────────────────────────────────────────────────────────────────────────

/** The new findings of an edition, as their drafts carry them, with refs in order. */
function newFindings(name: EditionName): DraftFinding[] {
  return PLANS[name].newFindings.map((key, i) => draftFinding(key, `new-${i + 1}`));
}

/** A rung entry as a draft carries one that cites a brief-level source: the event's own date, its `b` id and its note. */
function rungOnBriefSource(name: EditionName, key: FindingKey, rung: Parameters<typeof rungEntryOf>[1], recorded: string): DraftRung {
  const entry = rungEntryOf(key, rung, recorded);
  const note = typeof entry.note === "string" || entry.note === null ? entry.note : entry.note.en;
  return { rung: entry.rung, date: entry.date, source_id: briefSourceId(name, entry.source), note };
}

/** The shared parts of every draft: its date, its time and what the edition's plan lists. */
function base(name: EditionName, lead: readonly { text: string; refs: readonly FindingKey[] }[]) {
  const plan = PLANS[name];
  return {
    schema_version: 1 as const,
    date: EDITIONS[name].date,
    generated_at: EDITIONS[name].generatedAt,
    lead: lead.map((l) => ({ text: l.text, refs: l.refs.map((k) => refOf(name, k)) })),
    story: plan.story === null ? null : refOf(name, plan.story),
    items: plan.items.map((k) => refOf(name, k)),
    new_findings: newFindings(name),
    returning: [],
    rung_changes: [],
    ideas: [],
    also: [],
    deep_dive: null,
    review: null,
    corrections: [],
    report_decisions: [],
    sources: draftSources(plan.briefSources, "b"),
  };
}

function weekdayCorrections(): DraftCorrection[] {
  return WEEKDAY_CORRECTIONS.map((c) => ({
    finding_id: findingId(c.finding), edition_date: null, term_id: null, type: c.type, path: c.path, after: c.after,
    reason: c.reason, source_url: sourceSpec(c.source).url, report_id: c.draftReportId,
  }));
}

function buildWeekday(): DraftBrief {
  const name = "weekday";
  const t = WEEKDAY_TEXT;
  const plan = PLANS.weekday;
  const b = (key: SourceKey): string => briefSourceId(name, key);
  return DraftBrief.parse({
    ...base(name, [
      { text: t.lead[0], refs: ["scroll"] },
      { text: t.lead[1], refs: ["protein"] },
      { text: t.lead[2], refs: ["retractWD", "policy"] },
    ]),
    returning: plan.returning.map((k) => {
      const fact = returningFact(k, EDITIONS.weekday.date);
      return { finding_id: findingId(k), update: fact.text, source_ids: fact.sources.map(b), rung: null };
    }),
    rung_changes: plan.rungChanges.map((k) => ({
      finding_id: findingId(k), rung: rungOnBriefSource(name, k, "confirmed", EDITIONS.weekday.date),
    })),
    ideas: [
      { text: t.ideas[0], who: "Oren Nominal (SAMPLE)", source_id: b("idea-proof-checking") },
      { text: t.ideas[1], who: "Sana Provisional (SAMPLE)", source_id: b("idea-open-review") },
    ],
    also: [
      { title: t.also[0], field: "earth", source_id: b("also-monsoon") },
      { title: t.also[1], field: "humanities", source_id: b("also-inscriptions") },
    ],
    corrections: weekdayCorrections(),
    report_decisions: [{ ...WEEKDAY_DECISION }],
  });
}

function buildSunday(): DraftBrief {
  const name = "sunday";
  const t = SUNDAY_TEXT;
  const plan = PLANS.sunday;
  const ids = briefSourceIds(name);
  return DraftBrief.parse({
    ...base(name, [
      { text: t.lead[0], refs: ["translation"] },
      { text: t.lead[1], refs: ["antibiotic"] },
    ]),
    deep_dive: {
      finding_id: findingId(plan.deepDive!),
      text: t.deepDive.join("\n\n"),
      source_ids: plan.briefSources.map((k) => ids[k]!),
      why_today: "news",
    },
  });
}

function buildMonday(): DraftBrief {
  const name = "monday";
  const t = MONDAY_TEXT;
  const ids = briefSourceIds(name);
  const plan = PLANS.monday;
  return DraftBrief.parse({
    ...base(name, [
      { text: t.lead[0], refs: ["plasma"] },
      { text: t.lead[1], refs: ["antibiotic", "retractW0", "fellW0"] },
    ]),
    review: {
      big_picture: t.bigPicture.join("\n\n"),
      remarkable: { finding_id: findingId(plan.remarkable!), note: t.remarkable },
      strongest_against: {
        text: t.against,
        finding_ids: plan.against.map(findingId).sort(compareFindingIds),
        source_ids: plan.briefSources.map((k) => ids[k]!),
      },
    },
  });
}

function buildMondayShort(): DraftBrief {
  const t = MONDAY_SHORT_TEXT;
  return DraftBrief.parse({
    ...base("monday-short", [{ text: t.lead[0], refs: [] }]),
    review: {
      big_picture: t.bigPicture,
      remarkable: null,
      strongest_against: { text: NONE_FOUND.en, finding_ids: [], source_ids: [] },
    },
  });
}

const BUILDERS: Readonly<Record<EditionName, () => DraftBrief>> = {
  weekday: buildWeekday,
  sunday: buildSunday,
  monday: buildMonday,
  "monday-short": buildMondayShort,
};

const CACHE = new Map<EditionName, DraftBrief>();

/** A fresh deep copy of an edition's valid draft; callers may change it freely. */
export function editionDraft(name: EditionName): DraftBrief {
  let draft = CACHE.get(name);
  if (draft === undefined) {
    draft = BUILDERS[name]();
    CACHE.set(name, draft);
  }
  return structuredClone(draft);
}

export const weekdayDraft = (): DraftBrief => editionDraft("weekday");
export const sundayDraft = (): DraftBrief => editionDraft("sunday");
export const mondayDraft = (): DraftBrief => editionDraft("monday");
export const mondayShortDraft = (): DraftBrief => editionDraft("monday-short");

/** The new finding a ref names in a draft; throws when the draft has none, so a mutation never changes the wrong finding. */
export function newFindingOf(draft: DraftBrief, ref: string): DraftFinding {
  const found = draft.new_findings.find((f) => f.ref === ref);
  if (found === undefined) throw new Error(`The draft of ${draft.date} has no new finding ${ref}`);
  return found;
}
