// F, S and T fixtures for the structure rule group (SPEC §4.12 "Fixtures and tests"): DATE_MISMATCH, REF_UNKNOWN, FORMAT_SECTIONS,
// WEEK_AGAINST, COUNTS, FIELD_CAP, STORY_PICK and SOURCE_IDS. Every code of the group is hard (H), so `structureSoft` is empty: no
// code of the group has a soft gate.
//
//   F (`structureCases`)  one mutation of the weekday draft per code the weekday draft can trigger, written to
//                         fixtures/drafts/invalid--<CODE>.json. Each fails `validateDraft()` with the weekday's inputs on exactly that
//                         code, and no other error and no warning. WEEK_AGAINST has none: it runs on a Monday review (T below).
//   T (`structureNamed`) the sub-conditions of each row that one F case cannot show, and the checks only a Sunday or a Monday
//                         draft reaches (SPEC §4.12 "Fixtures and tests": a null deep dive, one on no candidate, one with a `why_today`
//                         its candidate lacks; a null `remarkable` in the full week, a set one in the empty week; WEEK_AGAINST's
//                         `NONE_FOUND` and a `finding_ids` without the setback, in the full week). Each states the exact set of error
//                         and warning codes, so it also shows that no other rule reads the same fault.
//
// A published-mode case (a stored brief judged against its own review, a record being published or not) works on a copy of the sample
// content and is not here (SPEC §4.12 "Stored records").
//
// Every string a case adds is invented and marked SAMPLE. A case that takes the story out of the weekday draft removes the scroll
// finding and its Lead line together (`withoutScroll()`), since a new finding that no `story` or `items` names is REF_UNKNOWN's. A
// case that shows an existing finding also gives it its returning entry (`returned()`), since an existing finding that story or
// items show with no returning entry, and a returning entry for one they do not show, are REF_UNKNOWN's too (SPEC §4.5).
//
// Cyber's fixtures/src/invalid/meta-items.ts at the fork commit 3ced1fb, adapted: the file's role, a list of mutations of the weekday
// draft with a one-line reason for each, and its helpers that find a part of the draft (and throw when its shape changes, so a case
// never mutates the wrong part) are the same; its cases are this project's.

import type { DraftBrief, DraftCorrection, DraftFinding } from "../../../lib/schema/draft";
import { NONE_FOUND } from "../../../lib/vocab";
import type { InvalidCase, NamedCase, SoftCase } from "../build";
import { MONDAY_ITEMS, newFindingOf, WEEKDAY_ITEMS } from "../drafts";

const I = WEEKDAY_ITEMS;
const M = MONDAY_ITEMS;

/** The set of codes a case must give: one error code, and no other error and no warning. */
const only = (code: string) => ({ errors: [code], warnings: [] as string[] });

const scroll = (d: DraftBrief): DraftFinding => newFindingOf(d, I.story);
const protein = (d: DraftBrief): DraftFinding => newFindingOf(d, I.result);
const retraction = (d: DraftBrief): DraftFinding => newFindingOf(d, I.setback);
const proof = (d: DraftBrief): DraftFinding => newFindingOf(d, I.claimed);

/** The first element of a list, or a thrown error: a case never mutates the wrong part of a changed draft. */
function at<T>(list: T[], index: number, what: string): T {
  const found = list[index];
  if (found === undefined) throw new Error(`The draft has no ${what}`);
  return found;
}

/**
 * Takes the scroll (the story, `new-1`) out of the weekday draft with its Lead line, so the story is free: a new finding that no
 * `story` or `items` names is REF_UNKNOWN's, and a new finding put in the items would be judged at the items' word budget.
 */
function withoutScroll(d: DraftBrief): void {
  d.new_findings = d.new_findings.filter((f) => f.ref !== I.story);
  d.lead = d.lead.filter((l) => !l.refs.includes(I.story));
  d.story = null;
}

/** A correction of a stored finding's own filing (SPEC §4.10), from the draft: an `update` of one of the values a correction refiles. */
function refile(finding_id: string, path: string, after: string): DraftCorrection {
  return {
    finding_id, edition_date: null, term_id: null, type: "update", path, after,
    reason: `SAMPLE: the record was filed with the wrong ${path}.`, source_url: null, report_id: null,
  };
}

/**
 * The returning entry that an existing finding needs where story or items show it (SPEC §4.5): an invented update and one brief
 * source of the draft, which RETURN_NEW_FACT reads as added this run and, with the packs' dates, as dated within the pack window
 * and its lookback: the weekday's `b1` and the Sunday's `b4` are, and the Monday's `b1` is once `returnedOnMonday()` dates it so.
 */
export function returned(d: DraftBrief, finding_id: string, source_id: string): void {
  d.returning.push({ finding_id, update: "SAMPLE: A later note on this finding, which the new source shows.", source_ids: [source_id], rung: null });
}

/** `returned()` on the Monday draft, whose two brief sources are dated before its pack window and its lookback: the first is dated inside them. */
export function returnedOnMonday(d: DraftBrief, finding_id: string): void {
  at(d.sources, 0, "first brief source").published_at = "2026-10-10T17:00:00+08:00";
  returned(d, finding_id, "b1");
}

// ── F: one mutation of the weekday draft per code ────────────────────────────────────────────────

export const structureCases: readonly InvalidCase[] = [
  {
    // The draft's own date is the next day's: the context's `date` is the 14th.
    code: "DATE_MISMATCH", file: "invalid--DATE_MISMATCH.json",
    mutate: (d) => {
      d.date = "2026-10-15";
    },
  },
  {
    // The last item names a finding id that the context lists nowhere (the id has the right shape, so SCHEMA passes it). The last
    // item was the returning finding's, so its returning entry is left with no place: the second issue, at that entry.
    code: "REF_UNKNOWN", file: "invalid--REF_UNKNOWN.json",
    mutate: (d) => {
      d.items[d.items.length - 1] = "soc-2026-0199";
    },
  },
  {
    // No story while four findings are shown: the scroll (the story) leaves with its Lead line, and the weekday's four items stay.
    code: "FORMAT_SECTIONS", file: "invalid--FORMAT_SECTIONS.json",
    mutate: (d) => {
      withoutScroll(d);
    },
  },
  {
    // A third idea line (at most 2), on a source the draft already cites.
    code: "COUNTS", file: "invalid--COUNTS.json",
    mutate: (d) => {
      d.ideas.push({
        text: "SAMPLE: Every journal could print what its AI checks found, argues a third reader.", who: "Pia Stand-in (SAMPLE)", source_id: "b3",
      });
    },
  },
  {
    // Three biology findings in the story and items (at most 2 of a field): the chemistry and mathematics findings are filed
    // under biology, each with a subfield that biology lists (a subfield is under one field, so the two change together).
    code: "FIELD_CAP", file: "invalid--FIELD_CAP.json",
    mutate: (d) => {
      for (const f of [retraction(d), proof(d)]) {
        f.field = "biology";
        f.subfield = "genomics";
      }
    },
  },
  {
    // The story is only Notable while two items are Major (the story's significance is at least every item's).
    code: "STORY_PICK", file: "invalid--STORY_PICK.json",
    mutate: (d) => {
      scroll(d).significance = "notable";
    },
  },
  {
    // The first Also noted line cites a brief-level source that the draft does not have (it has b1 to b6).
    code: "SOURCE_IDS", file: "invalid--SOURCE_IDS.json",
    mutate: (d) => {
      at(d.also, 0, "first Also noted line").source_id = "b9";
    },
  },
];

export const structureSoft: readonly SoftCase[] = [];

// ── T: the sub-conditions of each row, and the checks a weekday draft cannot reach ───────────────

export const structureNamed: readonly NamedCase[] = [
  // ── DATE_MISMATCH ──
  {
    name: "DATE_MISMATCH: generated_at one second after the deadline (03:49:00)",
    code: "DATE_MISMATCH", edition: "weekday", expect: only("DATE_MISMATCH"),
    mutate: (d) => {
      d.generated_at = "2026-10-14T03:49:01+08:00";
    },
  },
  {
    name: "DATE_MISMATCH: generated_at one second before the window's end (03:15:00)",
    code: "DATE_MISMATCH", edition: "weekday", expect: only("DATE_MISMATCH"),
    mutate: (d) => {
      d.generated_at = "2026-10-14T03:14:59+08:00";
    },
  },
  {
    name: "DATE_MISMATCH: generated_at a day early, at a time of day the window and the deadline would allow",
    code: "DATE_MISMATCH", edition: "weekday", expect: only("DATE_MISMATCH"),
    mutate: (d) => {
      d.generated_at = "2026-10-13T03:41:18+08:00";
    },
  },
  {
    name: "DATE_MISMATCH: a Sunday draft dated the day after its context",
    code: "DATE_MISMATCH", edition: "sunday", expect: only("DATE_MISMATCH"),
    mutate: (d) => {
      d.date = "2026-10-19";
    },
  },
  {
    name: "DATE_MISMATCH: a Monday draft dated the day before its context",
    code: "DATE_MISMATCH", edition: "monday", expect: only("DATE_MISMATCH"),
    mutate: (d) => {
      d.date = "2026-10-11";
    },
  },
  {
    name: "DATE_MISMATCH: a short Monday draft generated after its deadline",
    code: "DATE_MISMATCH", edition: "monday-short", expect: only("DATE_MISMATCH"),
    mutate: (d) => {
      d.generated_at = "2026-11-02T03:50:00+08:00";
    },
  },

  // ── REF_UNKNOWN ──
  {
    name: "REF_UNKNOWN: a new finding that neither the story nor the items name",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.items = d.items.filter((k) => k !== I.claimed);
    },
  },
  {
    // The last item is the returning finding: its place now names new-2, and its returning entry goes with it.
    name: "REF_UNKNOWN: a new finding named twice (a second item names new-2)",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.items[d.items.length - 1] = I.result;
      d.returning = [];
    },
  },
  {
    name: "REF_UNKNOWN: an item new-9 that the draft's new_findings do not define",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.items[d.items.length - 1] = "new-9";
      d.returning = [];
    },
  },
  {
    name: "REF_UNKNOWN: a Lead sentence that cites a finding id the context lists nowhere",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      at(d.lead, 2, "third Lead sentence").refs = [I.setback, "soc-2026-0199"];
    },
  },
  {
    // The finding the entry was for leaves the items, so that the unknown id is the draft's one fault.
    name: "REF_UNKNOWN: a returning entry for a finding id the context lists nowhere",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      at(d.returning, 0, "returning entry").finding_id = "soc-2026-0199";
      d.items = d.items.filter((k) => k !== I.returning);
    },
  },
  {
    name: "REF_UNKNOWN: a rung change for a finding id the context lists nowhere",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      at(d.rung_changes, 0, "rung change").finding_id = "chem-2026-0199";
    },
  },
  {
    name: "REF_UNKNOWN: a correction of a finding id the context lists nowhere",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.corrections.push(refile("math-2026-0199", "significance", "notable"));
    },
  },
  {
    name: "REF_UNKNOWN: a new finding's related finding that the context lists nowhere",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      protein(d).related = ["bio-2026-0199"];
    },
  },
  {
    name: "REF_UNKNOWN: a finding id that the context lists nowhere among the strongest evidence against (a Monday)",
    code: "REF_UNKNOWN", edition: "monday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.review!.strongest_against.finding_ids = [...d.review!.strongest_against.finding_ids, "soc-2026-0199"];
    },
  },

  // ── REF_UNKNOWN: how a draft uses an existing finding it names (SPEC §4.5, the comments on `returning` and `rung_changes`) ──
  {
    name: "REF_UNKNOWN: a returning entry for an existing finding that neither the story nor the items show",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.items = d.items.filter((k) => k !== I.returning);
    },
  },
  {
    name: "REF_UNKNOWN: a returning entry for an existing finding that a Sunday's story and items do not show",
    code: "REF_UNKNOWN", edition: "sunday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      returned(d, "soc-2026-0145", "b4");
    },
  },
  {
    name: "REF_UNKNOWN: two returning entries for one finding",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.returning.push(structuredClone(at(d.returning, 0, "returning entry")));
    },
  },
  {
    // The finding of the rung change takes the last item's place, with the returning entry: it is shown, and its rung change is still in rung_changes.
    name: "REF_UNKNOWN: a rung change for a finding that the items show (its place is the returning entry's rung)",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.items = d.items.map((k) => (k === I.returning ? I.rungChange : k));
      at(d.returning, 0, "returning entry").finding_id = I.rungChange;
    },
  },
  {
    name: "REF_UNKNOWN: an existing finding in the items with no returning entry",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.returning = [];
    },
  },
  {
    name: "REF_UNKNOWN: an existing finding in a Sunday's items with no returning entry",
    code: "REF_UNKNOWN", edition: "sunday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.items = [...d.items, "soc-2026-0145"];
    },
  },
  {
    name: "REF_UNKNOWN: an existing finding in a Monday's items with no returning entry",
    code: "REF_UNKNOWN", edition: "monday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.items = [...d.items, "soc-2026-0145"];
    },
  },
  {
    name: "REF_UNKNOWN: an existing finding in a short Monday's items with no returning entry",
    code: "REF_UNKNOWN", edition: "monday-short", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.items = ["soc-2026-0145"];
    },
  },
  {
    // The claimed finding goes (it is the last new finding, so the refs stay in order), and its place names the returning finding again.
    name: "REF_UNKNOWN: an existing finding named twice in the items",
    code: "REF_UNKNOWN", edition: "weekday", expect: only("REF_UNKNOWN"),
    mutate: (d) => {
      d.new_findings = d.new_findings.filter((f) => f.ref !== I.claimed);
      d.items = d.items.map((k) => (k === I.claimed ? I.returning : k));
    },
  },

  // ── FORMAT_SECTIONS: a Sunday (the context's ledger_for_sunday) ──
  {
    name: "FORMAT_SECTIONS: a Sunday with a null deep dive (its ledger has candidates)",
    code: "FORMAT_SECTIONS", edition: "sunday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.deep_dive = null;
    },
  },
  {
    name: "FORMAT_SECTIONS: a Sunday deep dive on a finding that is no candidate of the ledger (hum-2026-0148 is recent, not a candidate)",
    code: "FORMAT_SECTIONS", edition: "sunday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.deep_dive!.finding_id = "hum-2026-0148";
    },
  },
  {
    name: "FORMAT_SECTIONS: a Sunday deep dive on a finding id that the context lists nowhere (FORMAT_SECTIONS alone, not REF_UNKNOWN too)",
    code: "FORMAT_SECTIONS", edition: "sunday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.deep_dive!.finding_id = "bio-2026-0199";
    },
  },
  {
    name: "FORMAT_SECTIONS: a Sunday deep dive whose why_today (anniversary) its candidate lacks (news and rotation)",
    code: "FORMAT_SECTIONS", edition: "sunday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.deep_dive!.why_today = "anniversary";
    },
  },
  {
    name: "FORMAT_SECTIONS: three findings on a Sunday (at most 2)",
    code: "FORMAT_SECTIONS", edition: "sunday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.items = [...d.items, "soc-2026-0145", "earth-2026-0141"];
      returned(d, "soc-2026-0145", "b4");
      returned(d, "earth-2026-0141", "b4");
    },
  },
  {
    name: "FORMAT_SECTIONS: a Sunday story that is only Notable (phys-2026-0147)",
    code: "FORMAT_SECTIONS", edition: "sunday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.story = "phys-2026-0147";
      returned(d, "phys-2026-0147", "b4");
    },
  },
  {
    name: "FORMAT_SECTIONS: a Sunday story that is Major in its record and filed Notable by the draft's own correction",
    code: "FORMAT_SECTIONS", edition: "sunday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.story = "earth-2026-0141";
      returned(d, "earth-2026-0141", "b4");
      d.corrections.push(refile("earth-2026-0141", "significance", "notable"));
    },
  },

  // ── FORMAT_SECTIONS: a Monday (the context's week) ──
  {
    name: "FORMAT_SECTIONS: a Monday with a null remarkable finding in a week that has seven",
    code: "FORMAT_SECTIONS", edition: "monday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.review!.remarkable = null;
    },
  },
  {
    name: "FORMAT_SECTIONS: a Monday remarkable finding from before the week (math-2026-0131)",
    code: "FORMAT_SECTIONS", edition: "monday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.review!.remarkable!.finding_id = "math-2026-0131";
    },
  },
  {
    name: "FORMAT_SECTIONS: a Monday remarkable finding that the context lists nowhere (FORMAT_SECTIONS alone, not REF_UNKNOWN too)",
    code: "FORMAT_SECTIONS", edition: "monday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.review!.remarkable!.finding_id = "bio-2026-0199";
    },
  },
  {
    name: "FORMAT_SECTIONS: a Monday with no Week in review",
    code: "FORMAT_SECTIONS", edition: "monday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.review = null;
    },
  },
  {
    name: "FORMAT_SECTIONS: three findings on a Monday (at most 2)",
    code: "FORMAT_SECTIONS", edition: "monday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.items = [...d.items, "soc-2026-0145", "earth-2026-0141"];
      returnedOnMonday(d, "soc-2026-0145");
      returnedOnMonday(d, "earth-2026-0141");
    },
  },
  {
    name: "FORMAT_SECTIONS: a Monday story that is only Notable (soc-2026-0145)",
    code: "FORMAT_SECTIONS", edition: "monday", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.story = "soc-2026-0145";
      returnedOnMonday(d, "soc-2026-0145");
    },
  },
  {
    name: "FORMAT_SECTIONS: a remarkable finding in a week with no finding (the short Monday)",
    code: "FORMAT_SECTIONS", edition: "monday-short", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.review!.remarkable = { finding_id: "math-2026-0140", note: "SAMPLE: A proof about tiles was read and checked by two mathematicians who were not on the paper." };
    },
  },
  {
    name: "FORMAT_SECTIONS: a short Monday with no Week in review",
    code: "FORMAT_SECTIONS", edition: "monday-short", expect: only("FORMAT_SECTIONS"),
    mutate: (d) => {
      d.review = null;
    },
  },

  // ── WEEK_AGAINST: the full week has a setback (soc-2026-0144) and a fall (phys-2026-0134) ──
  {
    name: "WEEK_AGAINST: NONE_FOUND in a week with a setback and a fall",
    code: "WEEK_AGAINST", edition: "monday", expect: only("WEEK_AGAINST"),
    mutate: (d) => {
      d.review!.strongest_against = { text: NONE_FOUND.en, finding_ids: [], source_ids: [] };
    },
  },
  {
    name: "WEEK_AGAINST: finding_ids without the setback (soc-2026-0144)",
    code: "WEEK_AGAINST", edition: "monday", expect: only("WEEK_AGAINST"),
    mutate: (d) => {
      d.review!.strongest_against.finding_ids = [M.fell];
    },
  },
  {
    name: "WEEK_AGAINST: finding_ids without the finding that fell (phys-2026-0134)",
    code: "WEEK_AGAINST", edition: "monday", expect: only("WEEK_AGAINST"),
    mutate: (d) => {
      d.review!.strongest_against.finding_ids = [M.setback];
    },
  },
  {
    name: "WEEK_AGAINST: ordinary text with no finding_ids at all",
    code: "WEEK_AGAINST", edition: "monday", expect: only("WEEK_AGAINST"),
    mutate: (d) => {
      d.review!.strongest_against.finding_ids = [];
    },
  },
  {
    name: "WEEK_AGAINST: a week finding that the draft's own correction files as a setback (chem-2026-0142) is missing from finding_ids",
    code: "WEEK_AGAINST", edition: "monday", expect: only("WEEK_AGAINST"),
    mutate: (d) => {
      d.corrections.push(refile("chem-2026-0142", "kind", "setback"));
    },
  },
  {
    name: "WEEK_AGAINST: NONE_FOUND beside a finding id, in a week with no setback and no fall (the short Monday)",
    code: "WEEK_AGAINST", edition: "monday-short", expect: only("WEEK_AGAINST"),
    mutate: (d) => {
      d.review!.strongest_against.finding_ids = ["math-2026-0140"];
    },
  },

  // ── COUNTS: each limit of the row (the weekday has 5 findings, 2 ideas and 2 Also noted lines; findings_max is 5) ──
  {
    name: "COUNTS: six findings in the story and items (findings_max is 5)",
    code: "COUNTS", edition: "weekday", expect: only("COUNTS"),
    mutate: (d) => {
      d.items.push("phys-2026-0147");
      returned(d, "phys-2026-0147", "b1");
    },
  },
  {
    name: "COUNTS: six Also noted lines (at most 5)",
    code: "COUNTS", edition: "weekday", expect: only("COUNTS"),
    mutate: (d) => {
      const titles = [
        "SAMPLE: A third line about a model that reads old maps",
        "SAMPLE: A fourth line about a tool that sorts fossils",
        "SAMPLE: A fifth line about a model of ocean tides",
        "SAMPLE: A sixth line about a program that checks tables",
      ];
      titles.forEach((title, i) => d.also.push({ title, field: "earth", source_id: i % 2 === 0 ? "b5" : "b6" }));
    },
  },
  {
    name: "COUNTS: five reactions on a new finding (at most 4)",
    code: "COUNTS", edition: "weekday", expect: only("COUNTS"),
    mutate: (d) => {
      const f = scroll(d);
      const [a, b] = [at(f.reactions, 0, "first reaction"), at(f.reactions, 1, "second reaction")];
      f.reactions = [a, b, structuredClone(a), structuredClone(b), structuredClone(a)];
    },
  },
  {
    name: "COUNTS: six related findings on a new finding (at most 5)",
    code: "COUNTS", edition: "weekday", expect: only("COUNTS"),
    mutate: (d) => {
      proof(d).related = ["math-2026-0140", "math-2026-0131", "phys-2026-0134", "earth-2026-0141", "chem-2026-0142", "soc-2026-0146"];
    },
  },

  // ── FIELD_CAP: as filed ──
  {
    name: "FIELD_CAP: three biology findings once the draft's own corrections file the stored social item under biology",
    code: "FIELD_CAP", edition: "weekday", expect: only("FIELD_CAP"),
    mutate: (d) => {
      const f = proof(d);
      f.field = "biology";
      f.subfield = "genomics";
      d.corrections.push(refile(I.returning, "field", "biology"), refile(I.returning, "subfield", "drugs"));
    },
  },

  // ── STORY_PICK: as filed ──
  {
    name: "STORY_PICK: a stored Major story that the draft's own correction files as Notable, beside two Major items",
    code: "STORY_PICK", edition: "weekday", expect: only("STORY_PICK"),
    mutate: (d) => {
      withoutScroll(d);
      d.story = I.weather;
      returned(d, I.weather, "b1");
      d.corrections.push(refile(I.weather, "significance", "notable"));
    },
  },

  // ── SOURCE_IDS: order, gaps and every kind of citation ──
  {
    name: "SOURCE_IDS: a gap in the brief's source ids (b1 to b5, then b7), kept consistent in the Also noted line that cites it",
    code: "SOURCE_IDS", edition: "weekday", expect: only("SOURCE_IDS"),
    mutate: (d) => {
      at(d.sources, 5, "sixth brief source").id = "b7";
      at(d.also, 1, "second Also noted line").source_id = "b7";
    },
  },
  {
    name: "SOURCE_IDS: two brief sources out of order (b6 before b5)",
    code: "SOURCE_IDS", edition: "weekday", expect: only("SOURCE_IDS"),
    mutate: (d) => {
      at(d.sources, 4, "fifth brief source").id = "b6";
      at(d.sources, 5, "sixth brief source").id = "b5";
    },
  },
  {
    name: "SOURCE_IDS: a gap in a new finding's own ids (s1, s3), kept consistent in its Go deeper",
    code: "SOURCE_IDS", edition: "weekday", expect: only("SOURCE_IDS"),
    mutate: (d) => {
      const f = proof(d);
      at(f.sources, 1, "second source").id = "s3";
      f.go_deeper = ["s1", "s3"];
    },
  },
  {
    name: "SOURCE_IDS: a new finding's Go deeper cites s9, which the finding does not have",
    code: "SOURCE_IDS", edition: "weekday", expect: only("SOURCE_IDS"),
    mutate: (d) => {
      proof(d).go_deeper = ["s1", "s9"];
    },
  },
  {
    name: "SOURCE_IDS: a returning entry cites b9, which the brief does not have",
    code: "SOURCE_IDS", edition: "weekday", expect: only("SOURCE_IDS"),
    mutate: (d) => {
      at(d.returning, 0, "returning entry").source_ids = ["b1", "b9"];
    },
  },
  {
    name: "SOURCE_IDS: the Sunday deep dive cites b9, which the brief does not have",
    code: "SOURCE_IDS", edition: "sunday", expect: only("SOURCE_IDS"),
    mutate: (d) => {
      d.deep_dive!.source_ids = [...d.deep_dive!.source_ids, "b9"];
    },
  },
  {
    name: "SOURCE_IDS: the Monday review's strongest evidence against cites b9, which the brief does not have",
    code: "SOURCE_IDS", edition: "monday", expect: only("SOURCE_IDS"),
    mutate: (d) => {
      d.review!.strongest_against.source_ids = [...d.review!.strongest_against.source_ids, "b9"];
    },
  },
];
