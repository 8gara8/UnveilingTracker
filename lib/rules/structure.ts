// The structure rules (SPEC §4.12): DATE_MISMATCH, REF_UNKNOWN, FORMAT_SECTIONS, WEEK_AGAINST, COUNTS, FIELD_CAP, STORY_PICK and
// SOURCE_IDS. They judge the shape of an edition and never its words: the dates a draft or a file carries, the findings the
// Lead, the story and the items name, the sections a format has, how many of each thing there are, and how sources are
// numbered and cited. Each rule is a pure function of the frame's `RuleInput`, built from the views (views.ts) and the helpers
// of shared.ts; none reads a file, the clock or the network, and none changes its input.
//
// Where each one runs (SPEC §4.12 "Stored records"). The tests that need the run's own inputs, the context, run in draft mode
// only: REF_UNKNOWN, the context halves of DATE_MISMATCH, FORMAT_SECTIONS and WEEK_AGAINST. REF_UNKNOWN's use of `returning`
// and `rung_changes` is draft-only for a second reason: a stored brief holds no returning list (its items carry `new` and
// `update` together, which the Brief schema ties) and its `rung_changes` hold the script's changes and the agent's, on any
// finding. A test that reads a `run.json` budget runs on the records being published alone: COUNTS' `findings_max`. Every
// other test, the fixed counts included, runs on every stored record. A data-only edition is composed by script with every
// section empty (SPEC §4.5), so FORMAT_SECTIONS and WEEK_AGAINST read `input.edition` and skip it. Every finding a rule reads
// is read as filed (SPEC §4.10): with the draft's own corrections in draft mode, with the stored corrections dated on or
// before the brief's date in published mode. The Chinese run (zh mode) reads DATE_MISMATCH alone: a Chinese draft's `date` is
// the Chinese context's and its file's name, and its `generated_at` lies between the English draft's and the context's deadline.
//
// Cyber's lib/rules/meta.ts (`checkDates`), ids.ts (`checkIdSequence`) and items.ts (`checkCap`) at the fork commit 3ced1fb,
// adapted: the date and the window test, the first-break message of the id sequence and the cap message are Cyber's idioms;
// the refs, the Sunday and Monday sections, the week's setbacks and falls, the field cap, the story pick and the two kinds of
// source container are this project's.

import { draftFilings, latestFilings, significanceAtLeast } from "../items";
import { isFellRung } from "../rungs";
import { ID_PATTERNS } from "../schema/common";
import { NONE_FOUND } from "../vocab";
import {
  citations, contextFindingIds, extendPath, isDraft, isMondayEdition, isNewRef, newFindings, resolveSource, shownItems, sourceContainers,
  type SourceCitation,
} from "./shared";
import { files } from "./strings";
import { defineRule, error, list, plural, type DraftInput, type Rule, type RuleInput, type ValidationIssue } from "./types";
import type { Views } from "./views";

/**
 * FIELD_CAP: the most findings of one field in story and items (SPEC §4.12). No config file holds it, and no rule reads the
 * context's `config.field_cap` (SPEC §4.15), which is a copy of this constant for the agent to read.
 */
const FIELD_CAP = 2;
/** FORMAT_SECTIONS: the most findings, story included, on a Monday or a Sunday besides the review or the deep dive (SPEC §4.5). */
const LIGHT_EDITION_MAX = 2;
/** COUNTS: the most ideas, Also noted lines, reactions on a finding and related findings (SPEC §4.12). */
const IDEAS_MAX = 2;
const ALSO_MAX = 5;
const REACTIONS_MAX = 4;
const RELATED_MAX = 5;

type Judged = Exclude<RuleInput, { mode: "zh" }>;

/** A draft or a stored brief: DATE_MISMATCH alone of the structure rules reads the Chinese pass (it reads its own date and time). */
const isJudged = (input: RuleInput): input is Judged => input.mode !== "zh";

// ── DATE_MISMATCH ────────────────────────────────────────────────────────────────────────────────

/**
 * DATE_MISMATCH: a draft's `date` is the context's and the file's name when it has one; its `generated_at` is within the
 * window's end and the deadline, both inclusive. A stored brief's `date` is its file's name (SPEC §4.12 "Stored records":
 * the context is the run's own input, so only a draft is held to it). A data-only edition is checked as any other.
 *
 * A Chinese draft is held to the same two: its `date` is the Chinese context's (`input.date`) and the file's name when it has
 * one, and its `generated_at` is within the English draft's own `generated_at` (the pass starts after that draft validated, so
 * an earlier time was not written by this run) and the Chinese context's `deadline`, both inclusive.
 */
function checkDates(input: RuleInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (input.mode === "draft") {
    const { brief, context } = input.draft;
    if (brief.date !== input.date) {
      out.push(error("DATE_MISMATCH", "date", `date is ${brief.date} but the run's Taipei date is ${input.date}; set "date" to "${input.date}".`,
        "The edition date is the context's date, never the date of the news."));
    } else if (input.fileDate !== null && brief.date !== input.fileDate) {
      out.push(error("DATE_MISMATCH", "date", `date is ${brief.date} but the file is named ${input.fileDate}.json; they must match.`));
    }
    // A timestamp that does not parse is NaN, and every comparison with NaN is false: the schema reports it, not this rule.
    const written = Date.parse(brief.generated_at);
    const range = `between ${context.window.end} and ${context.deadline}`;
    if (written < Date.parse(context.window.end)) {
      out.push(error("DATE_MISMATCH", "generated_at",
        `generated_at is ${brief.generated_at}, before the news window ends at ${context.window.end} (Asia/Taipei); set it to when you finished, ${range}.`));
    } else if (written > Date.parse(context.deadline)) {
      out.push(error("DATE_MISMATCH", "generated_at",
        `generated_at is ${brief.generated_at}, after the deadline ${context.deadline} (Asia/Taipei); set it to when you finished, ${range}.`));
    }
  } else if (input.mode === "zh") {
    const { draft, context, english } = input.zh;
    if (draft.date !== input.date) {
      out.push(error("DATE_MISMATCH", "date", `date is ${draft.date} but the context's date is ${input.date}; set "date" to "${input.date}".`,
        "The edition date is the context's date, never the date of the news."));
    } else if (input.fileDate !== null && draft.date !== input.fileDate) {
      out.push(error("DATE_MISMATCH", "date", `date is ${draft.date} but the file is named ${input.fileDate}.json; they must match.`));
    }
    const written = Date.parse(draft.generated_at);
    const range = `between ${english.generated_at} and ${context.deadline}`;
    if (written < Date.parse(english.generated_at)) {
      out.push(error("DATE_MISMATCH", "generated_at",
        `generated_at is ${draft.generated_at}, before the English draft was written at ${english.generated_at} (Asia/Taipei); set it to when you finished, ${range}.`));
    } else if (written > Date.parse(context.deadline)) {
      out.push(error("DATE_MISMATCH", "generated_at",
        `generated_at is ${draft.generated_at}, after the deadline ${context.deadline} (Asia/Taipei); set it to when you finished, ${range}.`));
    }
  } else if (input.mode === "published") {
    const { brief } = input.published;
    if (brief !== null && input.fileDate !== null && brief.date !== input.fileDate) {
      out.push(error("DATE_MISMATCH", `${files.brief(input.fileDate)}: date`, `date is ${brief.date} but the file is named ${input.fileDate}.json; they must match.`));
    }
  }
  return out;
}

// ── REF_UNKNOWN ──────────────────────────────────────────────────────────────────────────────────

/** What the context lists, said the way the agent knows its parts, for a message (`contextFindingIds()` is the list itself). */
const CONTEXT_LISTS =
  "recent_findings, the week, the Sunday candidates, the open reports, the rung proposals, the standing stories, the flagged corrections or a pack candidate's stored_finding";

/**
 * The refs of the draft's own findings: where each of the Lead's refs, the story and the items sits, in that order (these
 * three places take `new-N` or a finding id; every other finding the draft names is an existing id, SPEC §4.5).
 */
function refsOf(views: Views): { key: string; path: string }[] {
  const { lead, story, items } = views.brief;
  return [
    ...lead.flatMap((line) => line.refs.map((key, j) => ({ key, path: extendPath(line.where, "refs", j) }))),
    ...(story === null ? [] : [{ key: story.key, path: story.where }]),
    ...items.map((item) => ({ key: item.key, path: item.where })),
  ];
}

/**
 * Where each ref or id of the story and the items sits, in display order (`story`, `items[0]`, ...); the Lead's refs do not
 * count. Each list grows in place, so a draft that names one ref thousands of times is read in linear time.
 */
function placesOf(views: Views): Map<string, string[]> {
  const places = new Map<string, string[]>();
  for (const item of shownItems(views)) {
    const held = places.get(item.key);
    if (held === undefined) places.set(item.key, [item.where]);
    else held.push(item.where);
  }
  return places;
}

/** The most places or findings a message lists: the story and the 5 items of the default budget; a longer list ends "and k more". */
const LISTED_MAX = 6;

/** `list()` of the first LISTED_MAX, then how many more, so that a message stays short however often a draft repeats a ref. */
function shortList(items: readonly string[]): string {
  return items.length <= LISTED_MAX ? list(items) : `${list(items.slice(0, LISTED_MAX))}, and ${items.length - LISTED_MAX} more`;
}

/**
 * How a draft uses the existing findings it names: the four rules that SPEC §4.5's comments on `returning` and `rung_changes`
 * state and no other row checks (a new finding's one use is `checkRefs`' own test). `returning` is "existing findings with new
 * facts, in the story or items", so each entry names a finding that story or items show, once, and each existing finding they
 * show has an entry: RETURN_NEW_FACT judges only the entries it finds, and the Brief schema ties an item's `update` to `new`, so
 * a shown finding with no entry would pass every other rule and fail when publish composes the brief. `rung_changes` is "agent
 * rung changes on findings not in story or items", so a finding they show takes its rung change in its returning entry's `rung`.
 * And a finding is shown once. Each fault is one issue, at the place to change. An id the context does not list is `checkRefs`'
 * own issue already, so it is left out here.
 */
function checkUses(views: Views, places: ReadonlyMap<string, readonly string[]>, strange: (id: string) => boolean): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const entries = new Map<string, string>();
  for (const r of views.brief.returning) {
    if (strange(r.finding_id)) continue;
    const path = extendPath(r.where, "finding_id");
    const first = entries.get(r.finding_id);
    if (first !== undefined) {
      out.push(error("REF_UNKNOWN", path,
        `${path} is ${r.finding_id}, which ${first} already names; a finding has one returning entry. Merge the two into one (an update of at most 60 words, and every source that shows the new facts) and delete this one.`));
      continue;
    }
    entries.set(r.finding_id, r.where);
    if (!places.has(r.finding_id)) {
      out.push(error("REF_UNKNOWN", path,
        `${path} is ${r.finding_id}, but neither story nor items names that finding; a returning entry is for a finding they show. Add ${r.finding_id} to items, or make it the story, or delete the entry (a rung change on a finding the brief does not show goes in rung_changes).`));
    }
  }
  for (const c of views.brief.rung_changes) {
    const shown = places.get(c.finding_id);
    if (shown === undefined || strange(c.finding_id)) continue;
    const path = extendPath(c.where, "finding_id");
    out.push(error("REF_UNKNOWN", path,
      `${path} is ${c.finding_id}, a finding that ${shown[0]} shows; rung_changes is for findings that story and items do not show. Move the rung change into the rung of ${c.finding_id}'s returning entry (add the entry if it has none) and delete this one.`));
  }
  for (const [id, where] of places) {
    // A new-N is never a listed id, so this skips the new findings too: `checkRefs` judges those itself.
    if (strange(id)) continue;
    if (!entries.has(id)) {
      out.push(error("REF_UNKNOWN", where[0]!,
        `${where[0]} is ${id}, an existing finding with no entry in returning; a finding comes back only with new facts. Add a returning entry for ${id} (an update of at most 60 words, and the sources added this run that show the new facts), or take it out of story and items.`));
    }
    if (where.length > 1) {
      out.push(error("REF_UNKNOWN", where[1]!,
        `${id} is named ${where.length} times in story and items (${shortList(where)}); a finding appears once. Keep one and remove the rest.`));
    }
  }
  return out;
}

/**
 * REF_UNKNOWN (draft mode only, since it reads the context): every ref of the Lead, the story and the items is a `new-N` that
 * `new_findings` defines or a finding id that the context lists; each `new-N` that `new_findings` defines is defined once and
 * is used exactly once in `story` or `items` (the Lead may cite it too, which does not count). The other places where a draft
 * names an existing finding are held to the context too, since only the context can have told the agent the id and publish
 * would meet a stranger there (XREF): a returning entry, a rung change, a correction, a new finding's `related` and the
 * strongest evidence against's `finding_ids`. The existing findings of the story, the items, the returning entries and the rung
 * changes are then held to how a draft may use them (`checkUses()`): a returning entry for each existing finding shown and for
 * none that is not, a rung change for none that is shown, and no finding shown twice. A deep dive and the remarkable finding
 * are held to their own lists by FORMAT_SECTIONS, so this row leaves them alone and each fault has one code.
 */
function checkRefs(input: RuleInput): ValidationIssue[] {
  if (!isDraft(input)) return [];
  const { views } = input;
  const out: ValidationIssue[] = [];
  const defined = newFindings(views).map((f) => f.key);
  // The id is known when any list of the context names it. Read from the context itself and not from a view of the id, since
  // a `related` id is no part of the roster the views are built from.
  const listed = contextFindingIds(input.draft.context);
  const strange = (id: string): boolean => !listed.has(id);

  for (const { key, path } of refsOf(views)) {
    if (isNewRef(key)) {
      if (!defined.includes(key)) {
        out.push(error("REF_UNKNOWN", path,
          `${path} is ${key}, but new_findings has no finding with that ref (it has ${defined.length === 0 ? "none" : list(defined)}). Add the finding to new_findings with ref "${key}", or cite a finding id from the context.`));
      }
    } else if (strange(key)) {
      out.push(error("REF_UNKNOWN", path,
        `${path} is ${key}, which is neither a new-N ref of new_findings nor a finding id the context lists (${CONTEXT_LISTS}). Cite a listed id or a new-N ref; never invent an id.`));
    }
  }

  const { returning, rung_changes, corrections, review } = views.brief;
  const named = [
    ...returning.map((r) => ({ id: r.finding_id, path: extendPath(r.where, "finding_id") })),
    ...rung_changes.map((c) => ({ id: c.finding_id, path: extendPath(c.where, "finding_id") })),
    ...corrections.flatMap((c) => (c.finding_id === null ? [] : [{ id: c.finding_id, path: extendPath(c.where, "finding_id") }])),
    ...newFindings(views).flatMap((f) => (f.related ?? []).map((id, j) => ({ id, path: extendPath(f.where("related"), j) }))),
    ...(review === null ? [] : review.strongest_against.finding_ids.map((id, j) => ({ id, path: extendPath(review.where, "strongest_against", "finding_ids", j) }))),
  ];
  for (const { id, path } of named) {
    if (strange(id)) {
      out.push(error("REF_UNKNOWN", path,
        `${path} is ${id}, which the context does not list (${CONTEXT_LISTS}). Name a finding id from the context; never invent an id.`));
    }
  }

  const places = placesOf(views);
  const seen = new Set<string>();
  for (const finding of newFindings(views)) {
    const ref = finding.where("ref");
    if (seen.has(finding.key)) {
      out.push(error("REF_UNKNOWN", ref, `${ref} is ${finding.key}, which an earlier new finding already has; give each new finding its own ref (new-1, new-2, ...).`));
      continue;
    }
    seen.add(finding.key);
    const used = places.get(finding.key) ?? [];
    if (used.length === 0) {
      out.push(error("REF_UNKNOWN", ref,
        `${ref} (${finding.key}) is in new_findings, but neither story nor items names it (the Lead's refs do not count). Add "${finding.key}" to items, or make it the story, or delete the finding.`));
    } else if (used.length > 1) {
      out.push(error("REF_UNKNOWN", used[1]!,
        `${finding.key} is named ${used.length} times in story and items (${shortList(used)}); a new finding appears once. Keep one and remove the rest.`));
    }
  }
  // Not `out.push(...uses)`: a spread passes each element as an argument, and a draft with more than about 120,000 faults of use
  // (the same returning entry that many times) would overflow the stack and turn this whole rule into a RULE_ERROR.
  for (const issue of checkUses(views, places, strange)) out.push(issue);
  return out;
}

// ── FORMAT_SECTIONS ──────────────────────────────────────────────────────────────────────────────

const EDITION_NAME = { weekday: "a weekday edition", sunday: "a Sunday edition", monday: "a Monday edition", "short-monday": "a Monday edition" } as const;

/**
 * The context halves of FORMAT_SECTIONS (draft mode): on a Sunday the deep dive is set unless `ledger_for_sunday` is empty, on
 * one of its candidates, with a `why_today` among that candidate's reasons; on a Monday `review.remarkable` names a finding of
 * the week and is null exactly when the week has none (SPEC §4.5, §4.15).
 */
function contextSections(input: DraftInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const { brief } = input.views;
  const { context } = input.draft;
  const deep = brief.deep_dive;
  if (input.edition === "sunday") {
    const candidates = context.ledger_for_sunday;
    const ids = candidates.length === 0 ? "none" : list(candidates.map((c) => c.id));
    if (deep === null) {
      if (candidates.length > 0) {
        out.push(error("FORMAT_SECTIONS", brief.where("deep_dive"),
          `deep_dive is null, but ledger_for_sunday lists ${plural(candidates.length, "candidate")} (${ids}). A Sunday edition has a deep dive: set it on one candidate, with a why_today among its reasons.`));
      }
    } else {
      const candidate = candidates.find((c) => c.id === deep.finding_id);
      if (candidate === undefined) {
        out.push(error("FORMAT_SECTIONS", extendPath(deep.where, "finding_id"),
          candidates.length === 0
            ? `deep_dive is on ${deep.finding_id}, but ledger_for_sunday lists no candidate today. Set deep_dive to null.`
            : `deep_dive is on ${deep.finding_id}, which is not one of the ${plural(candidates.length, "candidate")} of ledger_for_sunday (${ids}). Set it on one of them.`));
      } else if (!(candidate.reasons as readonly string[]).includes(deep.why_today)) {
        out.push(error("FORMAT_SECTIONS", extendPath(deep.where, "why_today"),
          `deep_dive.why_today is "${deep.why_today}", but the reasons for ${candidate.id} are ${list(candidate.reasons)}. Use one of them.`));
      }
    }
  }
  const { week } = context;
  const review = brief.review;
  if (isMondayEdition(input.edition) && week !== null && review !== null) {
    const remarkable = review.remarkable;
    const found = week.findings.map((f) => f.id);
    if (found.length === 0) {
      if (remarkable !== null) {
        out.push(error("FORMAT_SECTIONS", extendPath(review.where, "remarkable"),
          `review.remarkable names ${remarkable.finding_id}, but the week has no finding to name. Set remarkable to null.`));
      }
    } else if (remarkable === null) {
      out.push(error("FORMAT_SECTIONS", extendPath(review.where, "remarkable"),
        `review.remarkable is null, but the week has ${plural(found.length, "finding")} (${list(found)}). Name the week's most remarkable finding, one of them.`));
    } else if (!found.includes(remarkable.finding_id)) {
      out.push(error("FORMAT_SECTIONS", extendPath(review.where, "remarkable", "finding_id"),
        `review.remarkable names ${remarkable.finding_id}, which is not a finding of the week (${list(found)}). Name one of them.`));
    }
  }
  return out;
}

/**
 * FORMAT_SECTIONS: `deep_dive` only on a Sunday and `review` exactly on a Monday; a weekday's `story` is set when any finding
 * is; a Monday or a Sunday shows at most 2 findings, and a story only if it is filed as Major or Landmark. In a draft, also
 * against the context (contextSections()). A data-only edition has none of these sections and is skipped.
 */
function checkSections(input: RuleInput): ValidationIssue[] {
  if (!isJudged(input)) return [];
  const edition = input.edition;
  if (edition === "data-only" || edition === "none") return [];
  const { brief } = input.views;
  const out: ValidationIssue[] = [];
  const name = EDITION_NAME[edition];
  const monday = isMondayEdition(edition);

  if (brief.deep_dive !== null && edition !== "sunday") {
    out.push(error("FORMAT_SECTIONS", brief.where("deep_dive"), `deep_dive is set, but this is ${name}; only a Sunday edition has a deep dive. Set deep_dive to null.`));
  }
  if (monday && brief.review === null) {
    out.push(error("FORMAT_SECTIONS", brief.where("review"), `review is null, but this is ${name}; a Monday edition has the week in review. Write the review.`));
  } else if (!monday && brief.review !== null) {
    out.push(error("FORMAT_SECTIONS", brief.where("review"), `review is set, but this is ${name}; only a Monday edition has a review. Set review to null.`));
  }
  if (edition === "weekday" && brief.story === null && brief.items.length > 0) {
    out.push(error("FORMAT_SECTIONS", brief.where("story"),
      `story is null, but items names ${plural(brief.items.length, "finding")}; a weekday edition has a story whenever it has a finding. Make the strongest finding the story.`));
  }
  if (edition === "sunday" || monday) {
    const shown = shownItems(input.views);
    if (shown.length > LIGHT_EDITION_MAX) {
      out.push(error("FORMAT_SECTIONS", brief.where("items"),
        `${name} shows at most ${LIGHT_EDITION_MAX} findings besides ${edition === "sunday" ? "the deep dive" : "the review"}, story included; this one shows ${shown.length}. Cut at least ${shown.length - LIGHT_EDITION_MAX}.`));
    }
    const significance = brief.story?.finding?.latest.significance ?? null;
    if (brief.story !== null && significance !== null && !significanceAtLeast(significance, "major")) {
      out.push(error("FORMAT_SECTIONS", brief.story.where,
        `story is ${brief.story.key}, filed as ${significance}; on ${name} a story is set only for a Major or Landmark finding. Move it to items, or set story to null.`));
    }
  }
  if (isDraft(input)) out.push(...contextSections(input));
  return out;
}

// ── WEEK_AGAINST ─────────────────────────────────────────────────────────────────────────────────

/**
 * The findings that `strongest_against` must name, each with why, in the order they are found (setbacks, then falls). A draft
 * reads the context's week: the findings filed as setbacks with the draft's own corrections applied, and the rung changes to a
 * fallen rung; a stored brief reads its review's `setbacks` and `fell`. A context with no week (the loader gives a Monday
 * one, so this is a context built by hand) lists none.
 */
function weekProblems(input: Judged): Map<string, string[]> {
  const needed = new Map<string, string[]>();
  const add = (id: string, why: string): void => {
    const held = needed.get(id) ?? [];
    needed.set(id, held.includes(why) ? held : [...held, why]);
  };
  if (input.mode === "draft") {
    const { week } = input.draft.context;
    // The context files each finding on D already, by the stored corrections, so its own list of setbacks stands unless the
    // draft's corrections refile the finding's kind: then the finding is a setback only if the kind as filed with them says so.
    // (The draft's corrections are asked about themselves: a view of a stored finding that the run was given as a record has
    // its published kind, which the stored corrections may have changed since, so its `published` is no proof that none did.)
    const own = draftFilings(input.draft.brief.corrections, [], input.date);
    for (const id of week?.setbacks ?? []) {
      if (!latestFilings(id, own, input.date).has("kind") || input.views.find(id)?.latest.kind === "setback") add(id, "a setback");
    }
    // A finding of the week that is filed as a setback, as the context says or as the draft's corrections make it, joins them.
    for (const f of week?.findings ?? []) if (input.views.find(f.id)?.latest.kind === "setback") add(f.id, "a setback");
    for (const c of week?.rung_changes ?? []) if (isFellRung(c.to)) add(c.finding_id, `fell to ${c.to}`);
  } else {
    const { review } = input.views.brief;
    for (const id of review?.setbacks ?? []) add(id, "a setback");
    for (const id of review?.fell ?? []) add(id, "fell");
  }
  return needed;
}

/**
 * WEEK_AGAINST: on a Monday `strongest_against.text` is exactly NONE_FOUND only when the week has no setback and no finding that
 * fell, and then both its lists are empty; otherwise its `finding_ids` include every setback and every fall (weekProblems()).
 * A data-only edition has no review and is skipped.
 */
function checkAgainst(input: RuleInput): ValidationIssue[] {
  if (!isJudged(input) || !isMondayEdition(input.edition)) return [];
  const { brief } = input.views;
  if (brief.review === null) return [];
  const needed = weekProblems(input);
  const against = brief.review.strongest_against;
  const describe = (id: string): string => `${id} (${list(needed.get(id) ?? [])})`;
  if (against.text.en === NONE_FOUND.en) {
    if (needed.size > 0) {
      return [error("WEEK_AGAINST", brief.where("review.strongest_against.text", "en"),
        `strongest_against.text is "${NONE_FOUND.en}", but the week has ${plural(needed.size, "setback or fall", "setbacks or falls")}: ${list([...needed.keys()].map(describe))}. Write the evidence against and list ${needed.size === 1 ? "it" : "them"} in finding_ids.`)];
    }
    const listed = against.finding_ids.length + against.source_ids.length;
    if (listed > 0) {
      return [error("WEEK_AGAINST", brief.where("review.strongest_against"),
        `strongest_against.text is "${NONE_FOUND.en}", so finding_ids and source_ids are both []; they hold ${plural(listed, "id")}. Empty them, or write the evidence against.`)];
    }
    return [];
  }
  const missing = [...needed.keys()].filter((id) => !against.finding_ids.includes(id));
  if (missing.length === 0) return [];
  return [error("WEEK_AGAINST", brief.where("review.strongest_against.finding_ids"),
    `strongest_against.finding_ids leaves out ${plural(missing.length, "finding")} of the week: ${list(missing.map(describe))}. Add ${missing.length === 1 ? "its id" : "their ids"}.`)];
}

// ── COUNTS ───────────────────────────────────────────────────────────────────────────────────────

/**
 * COUNTS: story plus items at most `budgets.findings_max` of `run.json`, which only a draft and the brief being published are
 * held to (a budget may change after a brief was published, SPEC §4.12 "Stored records"); ideas at most 2, Also noted lines
 * at most 5, and on each finding record reactions at most 4 and related findings at most 5, on every record.
 */
function checkCounts(input: RuleInput): ValidationIssue[] {
  if (!isJudged(input)) return [];
  const { brief, findings } = input.views;
  const out: ValidationIssue[] = [];
  const max = input.config.run.budgets.findings_max;
  const shown = shownItems(input.views).length;
  if (brief.publishing && shown > max) {
    out.push(error("COUNTS", brief.where("items"),
      `story plus items hold ${shown} findings; the limit is ${max} (budgets.findings_max). Cut at least ${shown - max}, starting with the lowest-ranked item.`));
  }
  if (brief.ideas.length > IDEAS_MAX) {
    out.push(error("COUNTS", brief.where("ideas"), `ideas has ${brief.ideas.length} entries; the limit is ${IDEAS_MAX}. Cut at least ${brief.ideas.length - IDEAS_MAX}.`));
  }
  if (brief.also.length > ALSO_MAX) {
    out.push(error("COUNTS", brief.where("also"), `also has ${brief.also.length} entries; the limit is ${ALSO_MAX}. Cut at least ${brief.also.length - ALSO_MAX}.`));
  }
  for (const finding of findings) {
    if (finding.basis === "context") continue;
    const reactions = finding.reactions?.length ?? 0;
    if (reactions > REACTIONS_MAX) {
      out.push(error("COUNTS", finding.where("reactions"),
        `${finding.where("reactions")} has ${reactions} entries; the limit is ${REACTIONS_MAX}. Keep the most informative ones, cut at least ${reactions - REACTIONS_MAX}.`));
    }
    const related = finding.related?.length ?? 0;
    if (related > RELATED_MAX) {
      out.push(error("COUNTS", finding.where("related"),
        `${finding.where("related")} has ${related} entries; the limit is ${RELATED_MAX}. Keep the closest findings, cut at least ${related - RELATED_MAX}.`));
    }
  }
  return out;
}

// ── FIELD_CAP and STORY_PICK ─────────────────────────────────────────────────────────────────────

/**
 * FIELD_CAP: at most 2 findings of one field in story and items, each field read as filed on the edition's date (SPEC §4.10).
 * One issue for each field over the cap, at the first finding beyond it. A finding whose field is not known (an id the context
 * does not list) is left to REF_UNKNOWN.
 */
function checkFieldCap(input: RuleInput): ValidationIssue[] {
  if (!isJudged(input)) return [];
  const byField = new Map<string, { key: string; path: string }[]>();
  for (const item of shownItems(input.views)) {
    const field = item.finding?.latest.field ?? null;
    if (field === null) continue;
    const held = byField.get(field);
    const place = { key: item.key, path: item.where };
    if (held === undefined) byField.set(field, [place]);
    else held.push(place);
  }
  const out: ValidationIssue[] = [];
  for (const [field, held] of byField) {
    if (held.length > FIELD_CAP) {
      out.push(error("FIELD_CAP", held[FIELD_CAP]!.path,
        `${plural(held.length, "finding")} in story and items are filed under ${field} (${shortList(held.map((h) => h.key))}); the limit is ${FIELD_CAP} per field. Replace or cut at least ${held.length - FIELD_CAP}.`));
    }
  }
  return out;
}

/**
 * STORY_PICK: the story's significance is at least every item's, each as filed on the edition's date (SPEC §4.10). One issue
 * for each item that outranks the story. A finding whose significance is not known is left to REF_UNKNOWN.
 */
function checkStoryPick(input: RuleInput): ValidationIssue[] {
  if (!isJudged(input)) return [];
  const { story, items } = input.views.brief;
  const top = story?.finding?.latest.significance ?? null;
  if (story === null || top === null) return [];
  const out: ValidationIssue[] = [];
  for (const item of items) {
    const significance = item.finding?.latest.significance ?? null;
    if (significance !== null && !significanceAtLeast(top, significance)) {
      out.push(error("STORY_PICK", item.where,
        `${item.where} (${item.key}) is filed as ${significance}, above the story ${story.key}, which is filed as ${top}. The story is the finding with the highest significance: make ${item.key} the story and move ${story.key} to items.`));
    }
  }
  return out;
}

// ── SOURCE_IDS ───────────────────────────────────────────────────────────────────────────────────

/** "s1, s2" for a message, "none" for an empty container. */
const idsOf = (sources: readonly { id: string }[]): string => (sources.length === 0 ? "none" : list(sources.map((s) => s.id)));

/**
 * Why a citation fails: the id is not in its container. A `b` id is the brief's; an `s` id is its owner's (SPEC §4.3), and with
 * no owner (the finding is not known, REF_UNKNOWN's) or an owner whose sources the run cannot see, there is nothing to check.
 * The schemas already hold each place to its kind of id, so a finding's own record never cites a `b` id nor the brief an `s` id.
 */
function citationProblem(views: Views, cite: SourceCitation): string | null {
  const holder = ID_PATTERNS.briefSource.test(cite.id) ? views.brief : cite.owner;
  if (holder === null) return null;
  const found = resolveSource(views, cite.owner, cite.id);
  if (!found.known || found.source !== null) return null;
  return `${cite.path} cites ${cite.id}, which is not in ${holder.where("sources")} (${idsOf(holder.sources ?? [])}). Add the source or fix the id.`;
}

/**
 * SOURCE_IDS: in each container of sources, a finding's `s1`...`sN` and the brief's `b1`...`bN`, the ids run in array order with
 * no gaps (the first break is reported, with the count of ids out of place); and every id cited anywhere exists in its
 * container: a finding's own record cites its own sources, the brief's text the brief's, and a draft's returning and rung
 * entries either (SPEC §4.3, §4.5). A finding the context shows only in part has no sources to check.
 */
function checkSourceIds(input: RuleInput): ValidationIssue[] {
  if (!isJudged(input)) return [];
  const out: ValidationIssue[] = [];
  for (const container of sourceContainers(input.views)) {
    const sources = container.sources ?? [];
    const misplaced = sources.flatMap((s, i) => (s.id === `${container.prefix}${i + 1}` ? [] : [i]));
    if (misplaced.length === 0) continue;
    const first = misplaced[0]!;
    const path = extendPath(sources[first]!.where, "id");
    const more = misplaced.length > 1 ? ` ${misplaced.length} of the ${sources.length} sources are out of place.` : "";
    out.push(error("SOURCE_IDS", path,
      `${path} is "${sources[first]!.id}" but must be "${container.prefix}${first + 1}": source ids run ${container.prefix}1, ${container.prefix}2, ${container.prefix}3 in array order with no gaps or repeats.${more} Renumber the sources and every id that cites them.`));
  }
  for (const cite of citations(input.views)) {
    const problem = citationProblem(input.views, cite);
    if (problem !== null) out.push(error("SOURCE_IDS", cite.path, problem));
  }
  return out;
}

export const structureRules: Rule[] = [
  defineRule({ code: "DATE_MISMATCH", scope: ["draft", "published", "zh"], check: checkDates }),
  defineRule({ code: "REF_UNKNOWN", scope: "draft", check: checkRefs }),
  defineRule({ code: "FORMAT_SECTIONS", scope: ["draft", "published"], check: checkSections }),
  defineRule({ code: "WEEK_AGAINST", scope: ["draft", "published"], check: checkAgainst }),
  defineRule({ code: "COUNTS", scope: ["draft", "published"], check: checkCounts }),
  defineRule({ code: "FIELD_CAP", scope: ["draft", "published"], check: checkFieldCap }),
  defineRule({ code: "STORY_PICK", scope: ["draft", "published"], check: checkStoryPick }),
  defineRule({ code: "SOURCE_IDS", scope: ["draft", "published"], check: checkSourceIds }),
];
