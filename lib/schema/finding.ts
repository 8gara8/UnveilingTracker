// The finding file, `content/findings/<id>.json` (SPEC §4.4): one file per finding, written only by publish (and by
// `ledger-seed.ts` in P2). `DraftFinding` (the agent's M fields, §4.5) is in draft.ts; publish adds the S fields.
//
// Shape only, as common.ts explains: the explainer's word budgets, `COUNTS` (reactions, related), `GO_DEEPER` (1 to
// 3 sources), `RUNG_ORDER`, `SOURCE_IDS`, `SUBFIELD_UNKNOWN` and the rest of §4.12 are rules in lib/rules. What a
// finding's own fields say about each other and no rule owns is checked here: the AI part, the id against the
// field and the dates, the brief list against `first_brief`, and a finding is never related to itself.
//
// New for this project; Cyber's lib/schema/item.ts (items, CVE ids, regions) has no counterpart. The refinement
// idiom is Cyber's `superRefine` with `path`, and an unrefined `FindingBase` stays for `.pick()` and `.shape`.

import { z } from "zod";
import { FIELD_CODE_OF } from "../vocab";
import {
  AiInfo, Artefacts, FieldId, Figure, FindingId, FindingKind, FindingSource, FindingSourceId, IsoDate, L10n, Reaction, Rung,
  RungEntry, Significance, SubfieldId, TermId, Who,
} from "./common";

/** `story` when the finding was the story of the day on its first publication, else `item` (§4.4). */
export const DEPTHS = ["story", "item"] as const;
export const Depth = z.enum(DEPTHS);

/** The six parts of the explainer, frozen at first publication (§4.4); `ai_helped` is null exactly when `ai.role` is none. */
export const Explainer = z.strictObject({
  found: L10n,
  matters: L10n,
  ai_helped: L10n.nullable(),
  how_sure: L10n,
  background: L10n,
  could_lead: L10n,
});

/** A dated later fact about a finding, with the sources that show it (§4.4, §4.5's returning entries). */
export const SinceThen = z.strictObject({
  date: IsoDate,
  text: L10n,
  source_ids: z.array(FindingSourceId),
});

export const FindingBase = z.strictObject({
  schema_version: z.literal(1),
  id: FindingId,
  field: FieldId,
  subfield: SubfieldId,
  kind: FindingKind,
  title: L10n,
  depth: Depth,
  explainer: Explainer,
  go_deeper: z.array(FindingSourceId),
  ai: AiInfo,
  significance: Significance,
  rung: Rung,
  rung_history: z.array(RungEntry).min(1, { error: "A finding has at least one rung entry" }),
  since_then: z.array(SinceThen),
  sources: z.array(FindingSource),
  reactions: z.array(Reaction),
  artefacts: Artefacts,
  figure: Figure.nullable(),
  who: z.array(Who).min(1, { error: "A finding has at least one who entry" }).max(8, { error: "A finding has at most 8 who entries" }),
  terms: z.array(TermId),
  related: z.array(FindingId),
  first_published: IsoDate,
  first_brief: IsoDate.nullable(),
  briefs: z.array(IsoDate),
  history: z.boolean(),
  disclosure: z.boolean(),
  applications: z.tuple([]),
  updated: IsoDate,
});

/** The year part of a finding id, or null when the id has none (its own issue stands then). */
function idYear(id: string): string | null {
  return /^[a-z]+-(\d{4})-\d{4}$/.exec(id)?.[1] ?? null;
}

export const Finding = FindingBase.superRefine((f, ctx) => {
  const none = f.ai.role === "none";
  if (none !== (f.explainer.ai_helped === null)) {
    ctx.addIssue({
      code: "custom",
      message: none ? "ai_helped is null when ai.role is none" : "ai_helped is set when ai.role is an AI role",
      path: ["explainer", "ai_helped"],
    });
  }
  if (f.related.includes(f.id)) {
    ctx.addIssue({ code: "custom", message: "A finding is never related to itself", path: ["related"] });
  }
  f.briefs.forEach((date, i) => {
    if (i > 0 && date <= f.briefs[i - 1]!) {
      ctx.addIssue({ code: "custom", message: "briefs run oldest first with no repeats", path: ["briefs", i] });
    }
  });
  if (f.first_brief !== (f.briefs[0] ?? null)) {
    ctx.addIssue({ code: "custom", message: "first_brief is the first of briefs, or null when briefs is empty", path: ["first_brief"] });
  }
  if (!f.history && f.first_brief === null) {
    ctx.addIssue({ code: "custom", message: "Only a history entry may have no first brief", path: ["first_brief"] });
  }
  // The id keeps the field and the year it was given, whatever a later correction says (§4.3).
  if (f.id.split("-")[0] !== FIELD_CODE_OF[f.field]) {
    ctx.addIssue({ code: "custom", message: `The id of a ${f.field} finding starts with ${FIELD_CODE_OF[f.field]}-`, path: ["id"] });
  }
  const year = idYear(f.id);
  const dated = f.history ? f.first_published : f.first_brief;
  if (year !== null && dated !== null && dated.slice(0, 4) !== year) {
    ctx.addIssue({
      code: "custom",
      message: f.history ? "A history entry's id carries the year of first_published" : "The id carries the year of the first brief",
      path: ["id"],
    });
  }
});

export type Depth = z.infer<typeof Depth>;
export type Explainer = z.infer<typeof Explainer>;
export type SinceThen = z.infer<typeof SinceThen>;
export type Finding = z.infer<typeof Finding>;
