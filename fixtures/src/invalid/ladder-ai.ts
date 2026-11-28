// F, S and T fixtures for the ladder and AI rule group (SPEC §4.12 "Fixtures and tests"): RUNG_EVIDENCE, RUNG_ORDER, CLAIMED_CAP,
// LANDMARK_BASIS, NON_AI_LANDMARK_ONLY, SETBACK_MAJOR, AI_CONFIDENCE, AI_SYSTEM_NAMED, WHO_SAYS and POSSIBILITY. Every code of the
// group is hard (H), so `ladderAiSoft` is empty: no code of the group has a soft gate.
//
//   F (`ladderAiCases`)  one mutation of the weekday draft per code, written to fixtures/drafts/invalid--<CODE>.json. Each fails
//                        `validateDraft()` with the weekday's inputs on exactly that code, and no other error and no warning.
//   T (`ladderAiNamed`)  the clauses of each row that one F case cannot show: each rung kind a source may and may not show (and a
//                        Confirmed entry that cites the paper which showed Checked, the original's own), the order and the date
//                        bounds of the entries, the ways a Landmark lacks its basis, a finding refiled by the draft's own
//                        corrections (SPEC §4.10: filed on the brief's date), the clauses of AI_CONFIDENCE, the two names
//                        AI_SYSTEM_NAMED asks for, the three parts of WHO_SAYS and both halves of POSSIBILITY, and the checks
//                        only a Sunday deep dive or another day's date reaches. Each states the exact set of error and warning
//                        codes, so it also shows that no other rule reads the same fault.
//
// Passing mutations (a Major setback built from notices and the publisher's statement with `ai.systems` [], a policy_people
// finding with no system, an entry dated D, a month called May, the Landmarks that keep their basis) cannot be named cases, which
// must fail on their code, so they live in tests/rules-ladder-ai.test.ts. So do the clauses that need a stored finding in full
// (its reactions, `who`, role, kind and rung dates): the fixtures' inputs give the context alone, which shows a stored finding
// in part, and the stage that validates a morning's draft passes the stored records too (`DraftInputs.stored`, SPEC §4.12
// "Stored records"). A published-mode case (a stored brief judged on its own date, a record being published or not) works on a
// copy of the sample content and is not here.
//
// Every string a case adds is invented. A whole new sentence of free text is marked SAMPLE (a `reason`, a note, the sentence of a
// changed `ai_helped` or `could_lead`); a case that swaps a few words of the valid draft's own prose keeps the rest of it. A
// finding that loses its AI role also loses its `ai_helped`, so the first four parts of its explainer lose their words too and
// `withoutAi()` adds a short sample note to keep them in budget: WORDS must not be what such a case fails on.
//
// Cyber's fixtures/src/invalid/cves-grounding-ai.ts at the fork commit 3ced1fb, adapted: the file's role, arrays of cases for one
// rule group listed in the builder, is the same, and so are its helpers that find a part of the draft and throw when its shape
// changes, so a case never mutates the wrong part; its cases are this project's.

import type { DraftBrief, DraftCorrection, DraftFinding, DraftRungChange } from "../../../lib/schema/draft";
import type { InvalidCase, NamedCase, SoftCase } from "../build";
import { MONDAY_ITEMS, newFindingOf, SUNDAY_ITEMS, WEEKDAY_ITEMS } from "../drafts";

const I = WEEKDAY_ITEMS;
const S = SUNDAY_ITEMS;
const M = MONDAY_ITEMS;

/** The set of codes a case must give: one error code, and no other error and no warning. */
const only = (code: string) => ({ errors: [code], warnings: [] as string[] });
/** The set of codes of a case that gives several errors, in sorted order, and no warning. */
const these = (...codes: string[]) => ({ errors: [...codes].sort(), warnings: [] as string[] });

const scroll = (d: DraftBrief): DraftFinding => newFindingOf(d, I.story);
const protein = (d: DraftBrief): DraftFinding => newFindingOf(d, I.result);
const retraction = (d: DraftBrief): DraftFinding => newFindingOf(d, I.setback);
const proof = (d: DraftBrief): DraftFinding => newFindingOf(d, I.claimed);

/** The element of a list, or a thrown error: a case never mutates the wrong part of a changed draft. */
function at<T>(list: T[], index: number, what: string): T {
  const found = list[index];
  if (found === undefined) throw new Error(`The draft has no ${what}`);
  return found;
}

/** The text with its first `from` swapped for `to`; it throws when the text has no `from`, so a case never edits words a changed draft lost. */
function replaced(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`The text has no "${from}": ${text}`);
  return text.replace(from, to);
}

/** A correction of a stored finding's own filing (SPEC §4.10), from the draft: a `correction` of one of the values a correction refiles. */
function refile(finding_id: string, path: string, after: string): DraftCorrection {
  return {
    finding_id, edition_date: null, term_id: null, type: "correction", path, after,
    reason: `SAMPLE: the record was filed with the wrong ${path}.`, source_url: null, report_id: null,
  };
}

/** A rung entry of a stored finding that the draft adds in `rung_changes`, citing one of the brief's own sources. */
function rungChange(finding_id: string, rung: DraftRungChange["rung"]["rung"], source_id: string, date: string = "2026-10-13"): DraftRungChange {
  return { finding_id, rung: { rung, date, source_id, note: null } };
}

/** Two sentences of 26 words in all, plain and marked SAMPLE: the words a finding loses with its `ai_helped`. */
const NO_AI_NOTE = "This SAMPLE note shows what is claimed and who made the claim. It also shows how far the checking of the claim has gone so far.";

/** Gives a new finding no AI role, with the `ai_helped` it then lacks and the words that keep the first four parts of the explainer in budget. */
function withoutAi(f: DraftFinding): void {
  f.ai = { role: "none", confidence: null, systems: [], evidence: [] };
  f.explainer.ai_helped = null;
  f.explainer.matters = `${f.explainer.matters} ${NO_AI_NOTE}`;
}

// ── F: one mutation of the weekday draft per code ────────────────────────────────────────────────

export const ladderAiCases: readonly InvalidCase[] = [
  {
    // The story's Checked entry cites Nature's News and Views (s2), a reaction, which cannot show Checked: a paper, a proof or a checker does.
    code: "RUNG_EVIDENCE", file: "invalid--RUNG_EVIDENCE.json",
    mutate: (d) => { at(scroll(d).rung_history, 0, "rung entry of the story").source_id = "s2"; },
  },
  {
    // The story's one entry is dated the day after the edition (the weekday's date is 2026-10-14): no entry is dated after D.
    code: "RUNG_ORDER", file: "invalid--RUNG_ORDER.json",
    mutate: (d) => { at(scroll(d).rung_history, 0, "rung entry of the story").date = "2026-10-15"; },
  },
  {
    // The Notable claimed proof is raised to Major while its rung is still Preprint: a Claimed or Preprint finding is at most Notable.
    code: "CLAIMED_CAP", file: "invalid--CLAIMED_CAP.json",
    mutate: (d) => { proof(d).significance = "major"; },
  },
  {
    // The story is a Landmark at Checked with one reaction left: it needs two from different affiliations, or a Confirmed or Applied rung.
    code: "LANDMARK_BASIS", file: "invalid--LANDMARK_BASIS.json",
    mutate: (d) => { scroll(d).reactions.pop(); },
  },
  {
    // The Notable claimed proof has no AI role: a finding with none is only a Landmark.
    code: "NON_AI_LANDMARK_ONLY", file: "invalid--NON_AI_LANDMARK_ONLY.json",
    mutate: (d) => { withoutAi(proof(d)); },
  },
  {
    // The setback is Notable: a setback is Major or Landmark.
    code: "SETBACK_MAJOR", file: "invalid--SETBACK_MAJOR.json",
    mutate: (d) => { retraction(d).significance = "notable"; },
  },
  {
    // Every evidence entry of the story comes from the claimant while its confidence is confirmed: confirmed needs one from another source.
    code: "AI_CONFIDENCE", file: "invalid--AI_CONFIDENCE.json",
    mutate: (d) => { at(scroll(d).ai.evidence, 1, "second evidence entry of the story").from_claimant = true; },
  },
  {
    // The Major result has an AI role and no AI system: only a setback, an infrastructure or a policy_people finding may list none.
    code: "AI_SYSTEM_NAMED", file: "invalid--AI_SYSTEM_NAMED.json",
    mutate: (d) => { protein(d).ai.systems = []; },
  },
  {
    // The claimed proof's how_sure starts with "Checked." while its rung is Preprint: it starts with the label of the rung.
    code: "WHO_SAYS", file: "invalid--WHO_SAYS.json",
    mutate: (d) => {
      const f = proof(d);
      f.explainer.how_sure = replaced(f.explainer.how_sure, "Preprint.", "Checked.");
    },
  },
  {
    // The claimed proof's could_lead says what the result is, with none of the words that make it a possibility.
    code: "POSSIBILITY", file: "invalid--POSSIBILITY.json",
    mutate: (d) => { proof(d).explainer.could_lead = "SAMPLE: The proof is accepted without waiting long for referees."; },
  },
];

// ── S: none ──────────────────────────────────────────────────────────────────────────────────────

export const ladderAiSoft: readonly SoftCase[] = [];

// ── T: the clauses one F case cannot show ────────────────────────────────────────────────────────

export const ladderAiNamed: readonly NamedCase[] = [
  // RUNG_EVIDENCE: the kind of source each rung needs.
  {
    name: "RUNG_EVIDENCE: a Preprint entry cites a registry entry",
    code: "RUNG_EVIDENCE", edition: "weekday",
    mutate: (d) => { at(protein(d).rung_history, 0, "first rung entry of the result").source_id = "s3"; },
    expect: only("RUNG_EVIDENCE"),
  },
  {
    name: "RUNG_EVIDENCE: a Claimed entry cites a preprint",
    code: "RUNG_EVIDENCE", edition: "weekday",
    mutate: (d) => {
      const f = proof(d);
      at(f.rung_history, 0, "rung entry of the claimed proof").rung = "claimed";
      f.explainer.how_sure = replaced(f.explainer.how_sure, "Preprint.", "Claimed.");
    },
    expect: only("RUNG_EVIDENCE"),
  },
  {
    name: "RUNG_EVIDENCE: a statement shows Checked only for a setback",
    code: "RUNG_EVIDENCE", edition: "weekday",
    mutate: (d) => {
      const f = retraction(d);
      f.kind = "infrastructure";
      f.go_deeper = ["s1"];
    },
    expect: only("RUNG_EVIDENCE"),
  },
  {
    name: "RUNG_EVIDENCE: a notice shows Checked only for a setback",
    code: "RUNG_EVIDENCE", edition: "weekday",
    mutate: (d) => {
      const f = retraction(d);
      f.kind = "infrastructure";
      f.go_deeper = ["s1"];
      at(f.rung_history, 0, "rung entry of the setback").source_id = "s2";
    },
    expect: only("RUNG_EVIDENCE"),
  },
  {
    name: "RUNG_EVIDENCE: a result's Checked entry cites only a notice",
    code: "RUNG_EVIDENCE", edition: "weekday",
    mutate: (d) => {
      const f = retraction(d);
      f.kind = "result";
      f.go_deeper = ["s1"];
      f.ai.systems = [{ name: "Screen Tool", maker: "Example Press" }];
      f.explainer.ai_helped = "SAMPLE: Example Press built the Screen Tool, which found the AI text that the authors did not disclose.";
      at(f.rung_history, 0, "rung entry of the result").source_id = "s2";
    },
    expect: only("RUNG_EVIDENCE"),
  },
  {
    name: "RUNG_EVIDENCE: a Confirmed entry for a stored finding cites a notice",
    code: "RUNG_EVIDENCE", edition: "weekday",
    mutate: (d) => { at(d.sources, 1, "second brief source").kind = "notice"; },
    expect: only("RUNG_EVIDENCE"),
  },
  {
    name: "RUNG_EVIDENCE: an Applied entry for a stored finding cites a paper",
    code: "RUNG_EVIDENCE", edition: "weekday",
    mutate: (d) => { at(d.rung_changes, 0, "rung change").rung.rung = "applied"; },
    expect: only("RUNG_EVIDENCE"),
  },
  {
    name: "RUNG_EVIDENCE: a Disputed entry cites a reaction",
    code: "RUNG_EVIDENCE", edition: "weekday",
    mutate: (d) => {
      const c = at(d.rung_changes, 0, "rung change");
      c.rung.rung = "disputed";
      c.rung.source_id = "b3";
    },
    expect: only("RUNG_EVIDENCE"),
  },
  {
    name: "RUNG_EVIDENCE: a Retracted entry cites a paper",
    code: "RUNG_EVIDENCE", edition: "weekday",
    mutate: (d) => { at(d.rung_changes, 0, "rung change").rung.rung = "retracted"; },
    expect: only("RUNG_EVIDENCE"),
  },
  {
    name: "RUNG_EVIDENCE: a Confirmed paper from the original's own publisher",
    code: "RUNG_EVIDENCE", edition: "weekday",
    mutate: (d) => {
      const f = protein(d);
      at(f.sources, 0, "first source of the result").publisher = "PNAS";
      f.artefacts.trial = [];
    },
    expect: only("RUNG_EVIDENCE"),
  },
  {
    name: "RUNG_EVIDENCE: a Confirmed entry cites the paper of the story's own Checked entry",
    code: "RUNG_EVIDENCE", edition: "weekday",
    mutate: (d) => {
      const f = scroll(d);
      f.rung_history.push({ rung: "confirmed", date: "2026-10-14", source_id: "s1", note: null });
      f.explainer.how_sure = replaced(f.explainer.how_sure, "Checked.", "Confirmed.");
    },
    expect: only("RUNG_EVIDENCE"),
  },
  {
    name: "RUNG_EVIDENCE: a returning entry's new rung cites a reaction",
    code: "RUNG_EVIDENCE", edition: "weekday",
    mutate: (d) => {
      at(d.returning, 0, "returning entry").rung = { rung: "applied", date: "2026-10-13", source_id: "b3", note: null };
    },
    expect: only("RUNG_EVIDENCE"),
  },

  // RUNG_ORDER: entries dated in order, none after D.
  {
    name: "RUNG_ORDER: a second entry is dated before the first",
    code: "RUNG_ORDER", edition: "weekday",
    mutate: (d) => { at(protein(d).rung_history, 1, "second rung entry of the result").date = "2026-09-01"; },
    expect: only("RUNG_ORDER"),
  },
  {
    name: "RUNG_ORDER: a rung change is dated the day after the edition",
    code: "RUNG_ORDER", edition: "weekday",
    mutate: (d) => { at(d.rung_changes, 0, "rung change").rung.date = "2026-10-15"; },
    expect: only("RUNG_ORDER"),
  },
  {
    name: "RUNG_ORDER: a returning entry's rung is dated the day after the edition",
    code: "RUNG_ORDER", edition: "weekday",
    mutate: (d) => {
      at(d.returning, 0, "returning entry").rung = { rung: "checked", date: "2026-10-15", source_id: "b2", note: null };
    },
    expect: only("RUNG_ORDER"),
  },
  {
    name: "RUNG_ORDER: the Sunday's entry is dated the day after the Sunday",
    code: "RUNG_ORDER", edition: "sunday",
    mutate: (d) => { at(newFindingOf(d, S.item).rung_history, 0, "rung entry of the Sunday item").date = "2026-10-19"; },
    expect: only("RUNG_ORDER"),
  },

  // CLAIMED_CAP: Claimed or Preprint is at most Notable, however the finding gets there.
  {
    name: "CLAIMED_CAP: a correction raises a Claimed finding to Major",
    code: "CLAIMED_CAP", edition: "weekday",
    mutate: (d) => { d.corrections.push(refile(I.returning, "significance", "major")); },
    expect: only("CLAIMED_CAP"),
  },
  {
    name: "CLAIMED_CAP: a rung entry moves a Major finding to Claimed",
    code: "CLAIMED_CAP", edition: "weekday",
    mutate: (d) => { d.rung_changes.push(rungChange("bio-2026-0143", "claimed", "b1")); },
    expect: only("CLAIMED_CAP"),
  },
  {
    name: "CLAIMED_CAP: a rung entry moves a Major finding to Preprint",
    code: "CLAIMED_CAP", edition: "weekday",
    mutate: (d) => { d.rung_changes.push(rungChange("bio-2026-0143", "preprint", "b5")); },
    expect: only("CLAIMED_CAP"),
  },
  {
    name: "CLAIMED_CAP: a new Preprint finding filed as a Landmark also lacks its basis",
    code: "CLAIMED_CAP", edition: "weekday",
    mutate: (d) => { proof(d).significance = "landmark"; },
    expect: these("CLAIMED_CAP", "LANDMARK_BASIS"),
  },

  // LANDMARK_BASIS: two reactions from different affiliations, none in `who`, or a Confirmed or Applied rung.
  {
    name: "LANDMARK_BASIS: two reactions from one affiliation",
    code: "LANDMARK_BASIS", edition: "weekday",
    mutate: (d) => {
      const f = scroll(d);
      at(f.reactions, 1, "second reaction of the story").affiliation = at(f.reactions, 0, "first reaction of the story").affiliation;
    },
    expect: only("LANDMARK_BASIS"),
  },
  {
    name: "LANDMARK_BASIS: a reaction's affiliation is the finding's own who",
    code: "LANDMARK_BASIS", edition: "weekday",
    mutate: (d) => {
      const f = scroll(d);
      at(f.reactions, 1, "second reaction of the story").affiliation = at(f.who, 0, "who entry of the story").name;
    },
    expect: only("LANDMARK_BASIS"),
  },
  {
    name: "LANDMARK_BASIS: a Landmark with no reactions",
    code: "LANDMARK_BASIS", edition: "weekday",
    mutate: (d) => { scroll(d).reactions = []; },
    expect: only("LANDMARK_BASIS"),
  },
  {
    name: "LANDMARK_BASIS: a setback raised to a Landmark on a Checked rung with no reactions",
    code: "LANDMARK_BASIS", edition: "weekday",
    mutate: (d) => { retraction(d).significance = "landmark"; },
    expect: only("LANDMARK_BASIS"),
  },

  // NON_AI_LANDMARK_ONLY: no AI role only on a Landmark, and a stored finding briefed as filed on the brief's date (SPEC §4.10).
  {
    name: "NON_AI_LANDMARK_ONLY: a Major setback with no AI role also fails SETBACK_MAJOR",
    code: "NON_AI_LANDMARK_ONLY", edition: "weekday",
    mutate: (d) => { withoutAi(retraction(d)); },
    expect: these("NON_AI_LANDMARK_ONLY", "SETBACK_MAJOR"),
  },
  {
    name: "NON_AI_LANDMARK_ONLY: a correction refiles a briefed finding with no AI role",
    code: "NON_AI_LANDMARK_ONLY", edition: "weekday",
    mutate: (d) => { d.corrections.push(refile(I.returning, "ai.role", "none")); },
    expect: only("NON_AI_LANDMARK_ONLY"),
  },
  {
    name: "NON_AI_LANDMARK_ONLY: the Sunday deep dive is on a finding refiled with no AI role",
    code: "NON_AI_LANDMARK_ONLY", edition: "sunday",
    mutate: (d) => { d.corrections.push(refile(S.deepDive, "ai.role", "none")); },
    expect: only("NON_AI_LANDMARK_ONLY"),
  },

  // SETBACK_MAJOR: a setback has an AI role and is Major or Landmark, and so does a stored finding briefed as filed on the brief's date.
  {
    name: "SETBACK_MAJOR: a setback at Watch",
    code: "SETBACK_MAJOR", edition: "weekday",
    mutate: (d) => { retraction(d).significance = "watch"; },
    expect: only("SETBACK_MAJOR"),
  },
  {
    name: "SETBACK_MAJOR: a correction refiles a briefed Notable finding as a setback",
    code: "SETBACK_MAJOR", edition: "weekday",
    mutate: (d) => { d.corrections.push(refile(I.returning, "kind", "setback")); },
    expect: only("SETBACK_MAJOR"),
  },
  {
    name: "SETBACK_MAJOR: the Sunday deep dive is on a finding refiled as a Notable setback",
    code: "SETBACK_MAJOR", edition: "sunday",
    mutate: (d) => {
      d.corrections.push(refile(S.deepDive, "kind", "setback"));
      d.corrections.push(refile(S.deepDive, "significance", "notable"));
    },
    expect: only("SETBACK_MAJOR"),
  },

  // AI_CONFIDENCE: confidence null exactly for none; confirmed needs evidence from another source; the two corrections.
  {
    name: "AI_CONFIDENCE: a setback confirmed on evidence from the claimant alone",
    code: "AI_CONFIDENCE", edition: "weekday",
    mutate: (d) => { at(retraction(d).ai.evidence, 0, "evidence entry of the setback").from_claimant = true; },
    expect: only("AI_CONFIDENCE"),
  },
  {
    name: "AI_CONFIDENCE: a correction gives a non-AI Landmark an AI role",
    code: "AI_CONFIDENCE", edition: "weekday",
    mutate: (d) => {
      const c = at(d.corrections, 0, "first correction");
      c.type = "correction";
      c.path = "ai.role";
      c.after = "ai_tool";
    },
    expect: only("AI_CONFIDENCE"),
  },
  {
    name: "AI_CONFIDENCE: a correction sets the confidence of a finding filed with no AI role",
    code: "AI_CONFIDENCE", edition: "weekday",
    mutate: (d) => {
      const c = at(d.corrections, 0, "first correction");
      c.type = "correction";
      c.path = "ai.confidence";
      c.after = "claimed";
    },
    expect: only("AI_CONFIDENCE"),
  },
  {
    name: "AI_CONFIDENCE: a draft correction refiles a finding with no AI role, then another sets its confidence",
    code: "AI_CONFIDENCE", edition: "weekday",
    mutate: (d) => {
      d.corrections.push(refile("phys-2026-0147", "ai.role", "none"));
      d.corrections.push(refile("phys-2026-0147", "ai.confidence", "confirmed"));
    },
    expect: only("AI_CONFIDENCE"),
  },

  // AI_SYSTEM_NAMED: `ai.systems` is not empty for a result, a capability or a check, and ai_helped names a system and its maker.
  {
    name: "AI_SYSTEM_NAMED: ai_helped names neither the system nor its maker",
    code: "AI_SYSTEM_NAMED", edition: "weekday",
    mutate: (d) => {
      protein(d).explainer.ai_helped = "SAMPLE: A computer model made the prediction. It posted its prediction before anyone had measured the complex.";
    },
    expect: only("AI_SYSTEM_NAMED"),
  },
  {
    name: "AI_SYSTEM_NAMED: ai_helped names the maker and not the system",
    code: "AI_SYSTEM_NAMED", edition: "weekday",
    mutate: (d) => {
      protein(d).explainer.ai_helped = "SAMPLE: Halden Research built the model. It posted its prediction before anyone had measured the complex.";
    },
    expect: only("AI_SYSTEM_NAMED"),
  },
  {
    name: "AI_SYSTEM_NAMED: ai_helped names the system and not its maker",
    code: "AI_SYSTEM_NAMED", edition: "weekday",
    mutate: (d) => {
      protein(d).explainer.ai_helped = "SAMPLE: A lab built the model, Halden Fold. It posted its prediction before anyone had measured the complex.";
    },
    expect: only("AI_SYSTEM_NAMED"),
  },
  {
    name: "AI_SYSTEM_NAMED: a capability finding lists no AI system",
    code: "AI_SYSTEM_NAMED", edition: "weekday",
    mutate: (d) => {
      const f = protein(d);
      f.kind = "capability";
      f.ai.systems = [];
    },
    expect: only("AI_SYSTEM_NAMED"),
  },
  {
    name: "AI_SYSTEM_NAMED: a check finding lists no AI system",
    code: "AI_SYSTEM_NAMED", edition: "weekday",
    mutate: (d) => {
      const f = protein(d);
      f.kind = "check";
      f.ai.systems = [];
    },
    expect: only("AI_SYSTEM_NAMED"),
  },
  {
    name: "AI_SYSTEM_NAMED: the Monday item's ai_helped names the system and not its maker",
    code: "AI_SYSTEM_NAMED", edition: "monday",
    mutate: (d) => {
      newFindingOf(d, M.item).explainer.ai_helped = "SAMPLE: The Fernhill Controller adjusted the magnets 1,000 times a second. It learned from practice runs.";
    },
    expect: only("AI_SYSTEM_NAMED"),
  },

  // WHO_SAYS: the rung's label first, then who says so; with confidence claimed, the maker too.
  {
    name: "WHO_SAYS: how_sure names no publisher",
    code: "WHO_SAYS", edition: "weekday",
    mutate: (d) => {
      const f = scroll(d);
      f.explainer.how_sure = replaced(f.explainer.how_sure, "Nature published the paper", "A journal published the paper");
    },
    expect: only("WHO_SAYS"),
  },
  {
    name: "WHO_SAYS: a claimed AI role and how_sure does not name the maker",
    code: "WHO_SAYS", edition: "weekday",
    mutate: (d) => {
      const f = proof(d);
      f.explainer.how_sure = replaced(f.explainer.how_sure, "Marlow Labs is the source", "The lab is the source");
    },
    expect: only("WHO_SAYS"),
  },
  {
    name: "WHO_SAYS: the label is in lower case",
    code: "WHO_SAYS", edition: "weekday",
    mutate: (d) => {
      const f = proof(d);
      f.explainer.how_sure = replaced(f.explainer.how_sure, "Preprint.", "preprint.");
    },
    expect: only("WHO_SAYS"),
  },
  {
    name: "WHO_SAYS: how_sure has no label",
    code: "WHO_SAYS", edition: "weekday",
    mutate: (d) => {
      const f = proof(d);
      f.explainer.how_sure = replaced(f.explainer.how_sure, "Preprint. ", "");
    },
    expect: only("WHO_SAYS"),
  },
  {
    name: "WHO_SAYS: the label is in the text and not at its start",
    code: "WHO_SAYS", edition: "weekday",
    mutate: (d) => {
      proof(d).explainer.how_sure = "arXiv hosts the paper, a Preprint, which has not been peer reviewed. Marlow Labs is the source of the claim.";
    },
    expect: only("WHO_SAYS"),
  },
  {
    name: "WHO_SAYS: a setback's how_sure names no publisher",
    code: "WHO_SAYS", edition: "weekday",
    mutate: (d) => {
      retraction(d).explainer.how_sure = "Checked. The publisher of the papers says so in its own statement and in two retraction notices.";
    },
    expect: only("WHO_SAYS"),
  },
  {
    name: "WHO_SAYS: a correction of how_sure has no label",
    code: "WHO_SAYS", edition: "weekday",
    mutate: (d) => {
      at(d.corrections, 1, "second correction").after =
        "The Meridian Weather Service says it runs the model alongside its own system and has not replaced that system.";
    },
    expect: only("WHO_SAYS"),
  },
  {
    name: "WHO_SAYS: a correction of how_sure names no publisher",
    code: "WHO_SAYS", edition: "weekday",
    mutate: (d) => {
      at(d.corrections, 1, "second correction").after = "Applied. The service says it runs the model alongside its own system and has not replaced that system.";
    },
    expect: only("WHO_SAYS"),
  },
  {
    name: "WHO_SAYS: the Monday item names no publisher",
    code: "WHO_SAYS", edition: "monday",
    mutate: (d) => {
      const f = newFindingOf(d, M.item);
      f.explainer.how_sure = replaced(f.explainer.how_sure, "Fusion Science Reports published", "A journal published");
    },
    expect: only("WHO_SAYS"),
  },

  // POSSIBILITY: a possibility word and no promise.
  {
    name: "POSSIBILITY: a promise beside a possibility word",
    code: "POSSIBILITY", edition: "weekday",
    mutate: (d) => {
      protein(d).explainer.could_lead = "SAMPLE: If more predictions match, AI will cure disease and could shorten the search.";
    },
    expect: only("POSSIBILITY"),
  },
  {
    name: "POSSIBILITY: a promise of a solution",
    code: "POSSIBILITY", edition: "weekday",
    mutate: (d) => { proof(d).explainer.could_lead = "SAMPLE: If the Lean file checks, the proof will solve the problem for good."; },
    expect: only("POSSIBILITY"),
  },
  {
    name: "POSSIBILITY: a promise in capital letters",
    code: "POSSIBILITY", edition: "weekday",
    mutate: (d) => { protein(d).explainer.could_lead = "SAMPLE: If more predictions match, AI WILL CURE disease."; },
    expect: only("POSSIBILITY"),
  },
  {
    name: "POSSIBILITY: a word that only holds a possibility word",
    code: "POSSIBILITY", edition: "weekday",
    mutate: (d) => { protein(d).explainer.could_lead = "SAMPLE: The result is iffy and the lab will share it."; },
    expect: only("POSSIBILITY"),
  },
  {
    name: "POSSIBILITY: a word near a possibility word that the list does not hold",
    code: "POSSIBILITY", edition: "weekday",
    mutate: (d) => { protein(d).explainer.could_lead = "SAMPLE: Labs will possibly share the result."; },
    expect: only("POSSIBILITY"),
  },
  {
    name: "POSSIBILITY: a correction of could_lead with no possibility word",
    code: "POSSIBILITY", edition: "weekday",
    mutate: (d) => { d.corrections.push(refile("earth-2026-0141", "explainer.could_lead", "SAMPLE: Forecasters use the model next year.")); },
    expect: only("POSSIBILITY"),
  },
  {
    name: "POSSIBILITY: the Sunday item's could_lead has no possibility word",
    code: "POSSIBILITY", edition: "sunday",
    mutate: (d) => { newFindingOf(d, S.item).explainer.could_lead = "SAMPLE: The method helps smaller language groups."; },
    expect: only("POSSIBILITY"),
  },
];
