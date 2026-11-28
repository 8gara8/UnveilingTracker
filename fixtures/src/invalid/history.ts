// F, S and T fixtures for the history rule group (SPEC §4.12 "Fixtures and tests"): SUBFIELD_UNKNOWN, DUPLICATE, RETURN_NEW_FACT,
// REPORT_DECISION (hard) and REPORT_UPHELD (soft).
//
//   F (`historyCases`)  one mutation of the weekday draft for each hard code, written to fixtures/drafts/invalid--<CODE>.json. Each
//                       fails `validateDraft()` with the weekday's inputs on exactly that code, and no other error and no warning.
//   S (`historySoft`)   REPORT_UPHELD: `soft--REPORT_UPHELD.json` is `valid-weekday.json` without its last correction, the one that
//                       answers the report JL upheld, so no `report_decisions[].correction` index shifts (SPEC §4.12, its row).
//   T (`historyNamed`)  one case for each sentence of a row that the F case does not show: the clauses of SUBFIELD_UNKNOWN's
//                       corrections, DUPLICATE's shared ids and its Jaccard boundary, RETURN_NEW_FACT's window edges, each clause of
//                       REPORT_DECISION. Each states the exact set of error codes and of warning codes it gives.
//
// What a fixture cannot show, because a mutation changes the draft and never the run's inputs: a "pass" case (a NamedCase must fail
// its code, so every sentence that says a test passes is in tests/rules-history.test.ts); an arXiv id shared with a stored finding
// (the weekday's evidence holds no page with a stored arXiv id, and a source the run never saw would fail SOURCE_SEEN as well); a
// title match against a finding from days 31 to 90, which only a run given the stored records (`DraftInputs.stored`) compares when
// the draft names it nowhere and the context does not list it (the context lists 30 days, and a case has no stored records); a
// standing story's three new facts (the config's list is empty at version 1, and so is the context's). Those are tested with inputs
// the tests build themselves.
//
// A case of published mode (a finding being published with a subfield its field does not list, a stored `field` correction with no
// `subfield` one, the same records when they are not being published) works on a copy of the sample content and is written with the
// sample content's tests, not here.
//
// Every sentence or title a case adds is invented and starts "SAMPLE:" (a `removed` correction's text is the vocabulary's own); the
// ids and dates it adds are invented, and no case adds an address that is not already in the sample world (the tilings paper and
// the medRxiv protocol page are pages of the weekday's evidence, and the protocol is a candidate of its pack).
//
// New for this project; Cyber's fixtures/src/invalid/ files hold its own domain's cases, and the file's role is the same.

import type { DraftSource } from "../../../lib/schema/common";
import type { DraftBrief, DraftCorrection } from "../../../lib/schema/draft";
import type { InvalidCase, NamedCase, SoftCase } from "../build";
import { WEEKDAY_ITEMS, WEEKDAY_REPORTS, newFindingOf } from "../drafts";
import { findingId, sourceSpec, type SourceKey } from "../world";

const I = WEEKDAY_ITEMS;
const R = WEEKDAY_REPORTS;

/** The stored biology finding the weekday's context lists (the AI antibiotic, subfield `drugs`): the finding that the corrections below refile. */
const BIOLOGY = findingId("antibiotic");
/** The stored chemistry finding of the context (the robotic lab), for a correction that belongs to another finding. */
const CHEMISTRY = findingId("catalyst");

/** A draft correction on a stored finding, by default a `correction` of the biology finding's subfield to `genomics`, with a plain SAMPLE reason. */
const correction = (over: Partial<DraftCorrection>): DraftCorrection => ({
  finding_id: BIOLOGY, edition_date: null, term_id: null, type: "correction", path: "subfield", after: "genomics",
  reason: "SAMPLE: the finding was filed under the wrong place.", source_url: null, report_id: null, ...over,
});

/** A source of the sample world as a draft carries it, under the id it is given. */
function worldSource(key: SourceKey, id: string): DraftSource {
  const s = sourceSpec(key);
  return { id, kind: s.kind, title: s.title, publisher: s.publisher, url: s.url, doi: s.doi, published_at: s.published_at };
}

/** The medRxiv page of a trial protocol that is a candidate of the weekday's pack (kept, not deep read), with a trial id a stored finding lists. */
const PROTOCOL: DraftSource = {
  id: "s5", kind: "preprint", title: "SAMPLE: Protocol for a first safety trial of an AI-proposed antibiotic", publisher: "medRxiv",
  url: "https://www.medrxiv.org/content/10.1101/2026.10.12.990021v1", doi: "10.1101/2026.10.12.990021", published_at: "2026-10-13",
};

/** A decision of the agent on a report, with a plain SAMPLE reason. */
const decision = (report_id: string, outcome: "upheld" | "rejected", correction: number | null): DraftBrief["report_decisions"][number] =>
  ({ report_id, outcome, reason: "SAMPLE: the source says what the first text said.", correction });

const only = (code: string) => ({ errors: [code], warnings: [] as string[] });

export const historyCases: readonly InvalidCase[] = [
  {
    // The new Major result is filed under `protein`; the biology subfields are `proteins`, `drugs`, `genomics` and four more.
    code: "SUBFIELD_UNKNOWN", file: "invalid--SUBFIELD_UNKNOWN.json",
    mutate: (d) => {
      newFindingOf(d, I.result).subfield = "protein";
    },
  },
  {
    // The new claimed proof takes the title of a stored mathematics finding of the last 30 days, word for word.
    code: "DUPLICATE", file: "invalid--DUPLICATE.json",
    mutate: (d) => {
      newFindingOf(d, I.claimed).title = "SAMPLE: An AI checker flags a gap in a published proof";
    },
  },
  {
    // The returning entry's one source is dated nine days before the run, outside the pack window and its two days of lookback.
    code: "RETURN_NEW_FACT", file: "invalid--RETURN_NEW_FACT.json",
    mutate: (d) => {
      d.sources[0]!.published_at = "2026-10-05T10:00:00+08:00";
    },
  },
  {
    // R-0002 is open in the context and gets no decision.
    code: "REPORT_DECISION", file: "invalid--REPORT_DECISION.json",
    mutate: (d) => {
      d.report_decisions = [];
    },
  },
];

export const historySoft: readonly SoftCase[] = [
  {
    // The correction for the report JL upheld (R-0001) is the last one, so dropping it leaves the decision's index (0) in place.
    code: "REPORT_UPHELD", file: "soft--REPORT_UPHELD.json",
    mutate: (d) => {
      d.corrections.pop();
    },
  },
];

export const historyNamed: readonly NamedCase[] = [
  // ── SUBFIELD_UNKNOWN: a new finding ──
  {
    name: "SUBFIELD_UNKNOWN: ancient-texts, a humanities id, as a new biology finding's subfield",
    code: "SUBFIELD_UNKNOWN", edition: "weekday", expect: only("SUBFIELD_UNKNOWN"),
    mutate: (d) => {
      newFindingOf(d, I.result).subfield = "ancient-texts";
    },
  },
  // ── SUBFIELD_UNKNOWN: a draft correction on `subfield` ──
  {
    name: "SUBFIELD_UNKNOWN: a correction of a stored biology finding's subfield to protein",
    code: "SUBFIELD_UNKNOWN", edition: "weekday", expect: only("SUBFIELD_UNKNOWN"),
    mutate: (d) => {
      d.corrections.push(correction({ after: "protein" }));
    },
  },
  {
    name: "SUBFIELD_UNKNOWN: a correction of a stored biology finding's subfield to ancient-texts",
    code: "SUBFIELD_UNKNOWN", edition: "weekday", expect: only("SUBFIELD_UNKNOWN"),
    mutate: (d) => {
      d.corrections.push(correction({ after: "ancient-texts" }));
    },
  },
  // ── SUBFIELD_UNKNOWN: a draft correction on `field` ──
  {
    name: "SUBFIELD_UNKNOWN: a correction of a stored finding's field to chemistry, with none of its subfield",
    code: "SUBFIELD_UNKNOWN", edition: "weekday", expect: only("SUBFIELD_UNKNOWN"),
    mutate: (d) => {
      d.corrections.push(correction({ path: "field", after: "chemistry" }));
    },
  },
  {
    // `genomics` is a biology id, and the finding is filed under chemistry once the same draft corrects its field.
    name: "SUBFIELD_UNKNOWN: a correction of a field to chemistry with a correction of its subfield to genomics",
    code: "SUBFIELD_UNKNOWN", edition: "weekday", expect: only("SUBFIELD_UNKNOWN"),
    mutate: (d) => {
      d.corrections.push(correction({ path: "field", after: "chemistry" }), correction({ after: "genomics" }));
    },
  },
  {
    // The pair is for one finding: a subfield correction of a chemistry finding does not carry the biology finding's field.
    name: "SUBFIELD_UNKNOWN: a correction of a field whose subfield correction is for another finding",
    code: "SUBFIELD_UNKNOWN", edition: "weekday", expect: only("SUBFIELD_UNKNOWN"),
    mutate: (d) => {
      d.corrections.push(correction({ path: "field", after: "chemistry" }), correction({ finding_id: CHEMISTRY, after: "catalysis" }));
    },
  },
  // ── A `removed` correction on `field` or `subfield` fails SCHEMA alone ──
  {
    name: "SCHEMA: a removed correction on a subfield fails SCHEMA alone, and SUBFIELD_UNKNOWN stays silent",
    code: "SCHEMA", edition: "weekday", expect: only("SCHEMA"),
    mutate: (d) => {
      d.corrections.push(correction({ type: "removed", after: "This text was removed." }));
    },
  },
  {
    name: "SCHEMA: a removed correction on a field fails SCHEMA alone, and SUBFIELD_UNKNOWN stays silent",
    code: "SCHEMA", edition: "weekday", expect: only("SCHEMA"),
    mutate: (d) => {
      d.corrections.push(correction({ type: "removed", path: "field", after: "This text was removed." }));
    },
  },

  // ── DUPLICATE ──
  {
    // The tilings paper (a fetched page of the weekday's evidence) holds the DOI of math-2026-0140, which the context lists.
    name: "DUPLICATE: a new finding that carries a stored finding's DOI",
    code: "DUPLICATE", edition: "weekday", expect: only("DUPLICATE"),
    mutate: (d) => {
      const f = newFindingOf(d, I.claimed);
      f.sources.push(worldSource("tilings-paper", "s3"));
      f.artefacts.doi.push("10.1017/ut-sample-0013");
    },
  },
  {
    // The medRxiv protocol page (a candidate of the weekday's pack) names trial NCT09999001, which the stored antibiotic finding lists.
    name: "DUPLICATE: a new finding that carries a stored finding's trial id",
    code: "DUPLICATE", edition: "weekday", expect: only("DUPLICATE"),
    mutate: (d) => {
      const f = newFindingOf(d, I.result);
      f.sources.push({ ...PROTOCOL });
      f.artefacts.trial.push("NCT09999001");
    },
  },
  {
    // The stored title has 10 different words. A title of 6 words, all of them in it, is 6 of 10: Jaccard 0.6, the limit itself.
    name: "DUPLICATE: a title at Jaccard 0.6 exactly, in the same field",
    code: "DUPLICATE", edition: "weekday", expect: only("DUPLICATE"),
    mutate: (d) => {
      newFindingOf(d, I.claimed).title = "SAMPLE: An AI checker flags gap";
    },
  },

  // ── RETURN_NEW_FACT ──
  {
    name: "RETURN_NEW_FACT: a returning entry that cites no source",
    code: "RETURN_NEW_FACT", edition: "weekday", expect: only("RETURN_NEW_FACT"),
    mutate: (d) => {
      d.returning[0]!.source_ids = [];
    },
  },
  {
    name: "RETURN_NEW_FACT: a returning entry whose source has no date",
    code: "RETURN_NEW_FACT", edition: "weekday", expect: only("RETURN_NEW_FACT"),
    mutate: (d) => {
      d.sources[0]!.published_at = null;
    },
  },
  {
    // The window starts 2026-10-13T03:15 and the lookback is 48 hours, so the span starts 2026-10-11T03:15.
    name: "RETURN_NEW_FACT: a source dated a minute before the lookback starts",
    code: "RETURN_NEW_FACT", edition: "weekday", expect: only("RETURN_NEW_FACT"),
    mutate: (d) => {
      d.sources[0]!.published_at = "2026-10-11T03:14:00+08:00";
    },
  },
  {
    // The window ends 2026-10-14T03:15.
    name: "RETURN_NEW_FACT: a source dated a minute after the window ends",
    code: "RETURN_NEW_FACT", edition: "weekday", expect: only("RETURN_NEW_FACT"),
    mutate: (d) => {
      d.sources[0]!.published_at = "2026-10-14T03:16:00+08:00";
    },
  },

  // ── REPORT_DECISION: each clause of the row ──
  {
    name: "REPORT_DECISION: two decisions for the one open report",
    code: "REPORT_DECISION", edition: "weekday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.report_decisions.push({ ...d.report_decisions[0]! });
    },
  },
  {
    name: "REPORT_DECISION: a decision for a report that is not in the context",
    code: "REPORT_DECISION", edition: "weekday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.report_decisions.push(decision("R-0009", "rejected", null));
    },
  },
  {
    name: "REPORT_DECISION: a decision for the report JL already upheld",
    code: "REPORT_DECISION", edition: "weekday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.report_decisions.push(decision("R-0001", "rejected", null));
    },
  },
  {
    name: "REPORT_DECISION: an upheld decision that points to no correction",
    code: "REPORT_DECISION", edition: "weekday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.report_decisions[0]!.correction = null;
    },
  },
  {
    name: "REPORT_DECISION: an upheld decision that points past the last correction",
    code: "REPORT_DECISION", edition: "weekday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.report_decisions[0]!.correction = d.corrections.length;
    },
  },
  {
    // The correction at the upheld report's index is the weather finding's, not the tilings finding's the report is about.
    name: "REPORT_DECISION: an upheld decision whose correction is on another finding",
    code: "REPORT_DECISION", edition: "weekday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.report_decisions[0]!.correction = R.upheldCorrection;
    },
  },
  {
    name: "REPORT_DECISION: a rejected decision that points to a correction",
    code: "REPORT_DECISION", edition: "weekday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.report_decisions[0]!.outcome = "rejected";
    },
  },
  {
    name: "REPORT_DECISION: a correction whose report_id names no report of the context",
    code: "REPORT_DECISION", edition: "weekday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.corrections[R.openCorrection]!.report_id = "R-0009";
    },
  },
  {
    // R-0002 is open: only a report JL upheld is answered through a correction's report_id; an open one is answered by a decision.
    name: "REPORT_DECISION: a correction whose report_id names the open report",
    code: "REPORT_DECISION", edition: "weekday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.corrections[R.openCorrection]!.report_id = "R-0002";
    },
  },
  {
    // The only correction left carries R-0001's id but is on the tilings finding, and R-0001 is about the weather finding.
    // The report keeps a correction with its report_id, so REPORT_UPHELD stays quiet: the row asks for one with the id, and
    // REPORT_DECISION owns the finding it must be on.
    name: "REPORT_DECISION: a correction for the report JL upheld that is on another finding",
    code: "REPORT_DECISION", edition: "weekday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.corrections = [d.corrections[R.openCorrection]!];
      d.corrections[0]!.report_id = "R-0001";
      d.report_decisions = [decision("R-0002", "rejected", null)];
    },
  },
  {
    // The clarification that upholds R-0002 also carries R-0001's id: two reports, one correction (and R-0001 now has two).
    name: "REPORT_DECISION: one correction that answers two reports",
    code: "REPORT_DECISION", edition: "weekday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.corrections[R.openCorrection]!.report_id = "R-0001";
    },
  },
  {
    name: "REPORT_DECISION: two corrections for the one report JL upheld",
    code: "REPORT_DECISION", edition: "weekday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.corrections.push({ ...d.corrections[R.upheldCorrection]! });
    },
  },
  {
    // The Sunday's context lists no report, since both of the weekday's have their corrections: no report gets a decision.
    name: "REPORT_DECISION: a Sunday decision, when the context holds no report",
    code: "REPORT_DECISION", edition: "sunday", expect: only("REPORT_DECISION"),
    mutate: (d) => {
      d.report_decisions.push(decision("R-0002", "rejected", null));
    },
  },

  // ── REPORT_UPHELD ──
  {
    // The correction on the weather finding stays, but without the report's id: it no longer answers R-0001. Nothing else reads the id.
    name: "REPORT_UPHELD: the upheld report's correction kept without its report_id",
    code: "REPORT_UPHELD", edition: "weekday", expect: { errors: [], warnings: ["REPORT_UPHELD"] },
    mutate: (d) => {
      d.corrections[R.upheldCorrection]!.report_id = null;
    },
  },
];
