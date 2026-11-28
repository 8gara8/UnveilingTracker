// A Ledger seed, one file of `seed/ledger/` (SPEC §8.13, §3, §10 P2 step 4): the shape `scripts/ledger-seed.ts` reads. It is
// a `DraftFinding` (draft.ts) whose strings are `L10n` with both languages filled (no null `zh`), whose new terms carry their
// Chinese fields, and whose rung entries are `by: "seed"`, plus `seeded`, the date Claude first wrote the file. The script
// gives the finding its id by `first_published` then file name, and writes every date from `seeded`: each source's `added`, each rung
// entry's `recorded`, the finding's `updated` and a new term's `first_date` (§8.13).
//
// Shape only, as common.ts explains: word budgets, the source rules, the Chinese rules and the rest of §4.12 are the validator's,
// run by the script. What a seed says about itself and no rule owns is checked here: the AI part (as `DraftFinding`), the file name
// (`seedFileName()`, §3: `<first_published>-<nn>.json`) and, with the script, the reading of each file. A seed has no `ref` (the
// script gives it `new-1` in the check), no `depth` (a seed is always item depth, §10 P2), no `schema_version` and none of a
// stored finding's S fields (`id`, `rung`, `first_brief`, `briefs`, `history`, `disclosure`, `applications`, `updated`), which the
// script writes.
//
// New for this project; Cyber has no Ledger. Built on `DraftFindingBase` (an unrefined object, so `.shape` works), as draft.ts says.

import { z } from "zod";
import { DraftFindingBase, DraftTermKnown, DraftTermNew } from "./draft";
import { Figure, FindingSourceId, IsoDate, Rung } from "./common";
import { TermZh } from "./glossary";

/** A reader-facing string in both languages with neither empty: `L10n` (common.ts) whose `zh` is never null. */
export const SeedL10n = z.strictObject({
  en: z.string().min(1),
  zh: z.string().min(1),
});

/** A term the seed defines: the draft's new term (English term and definition) with its Chinese fields, which the glossary stores as written. */
export const SeedTermNew = DraftTermNew.extend({
  zh: TermZh.describe("The Chinese term and definition (Taiwan usage), and 樂詞網's wording with its page when that site shows the term, else both null"),
});

/** A term another seed, or the glossary already in the content folder, defines. */
export const SeedTermKnown = DraftTermKnown;

export const SeedTerm = z.discriminatedUnion("new", [SeedTermNew, SeedTermKnown]);

/** The six parts of the explainer in both languages; the seed is item depth, so the first four parts are 70 to 100 words in English. */
export const SeedExplainer = z.strictObject({
  found: SeedL10n,
  matters: SeedL10n,
  ai_helped: SeedL10n.nullable().describe("null exactly when ai.role is none"),
  how_sure: SeedL10n.describe("Starts with the rung's label, and its Chinese with that rung's zh label (ZH_RUNG_LABEL)"),
  background: SeedL10n,
  could_lead: SeedL10n,
});

/** A rung entry of a seed: always `by: "seed"`; the script writes `recorded` (the file's `seeded`). */
export const SeedRung = z.strictObject({
  rung: Rung,
  date: IsoDate.describe("The event's own date (preprint posted, paper published, prize announced)"),
  source_id: FindingSourceId.describe("One of this finding's sources (s1, s2, ...)"),
  by: z.literal("seed"),
  note: SeedL10n.nullable().describe("At most 25 words in English, or null"),
});

/** The paper's own figure with its alt text in both languages. */
export const SeedFigure = Figure.extend({ alt: SeedL10n });

const base = DraftFindingBase.shape;

/** A file of `seed/ledger/`. The keys are in the order of the finding file they become (§4.4). */
export const SeedFinding = z.strictObject({
  field: base.field,
  subfield: base.subfield,
  kind: base.kind,
  title: SeedL10n.describe("At most 12 words in English, plain, no hype word"),
  explainer: SeedExplainer,
  go_deeper: base.go_deeper,
  ai: base.ai,
  significance: base.significance,
  rung_history: z.array(SeedRung).min(1, { error: "A finding has at least one rung entry" }).describe("Oldest first"),
  sources: base.sources,
  reactions: base.reactions,
  artefacts: base.artefacts,
  figure: SeedFigure.nullable(),
  who: base.who,
  terms: z.array(SeedTerm),
  related: base.related.describe("Ids of other findings, as the script gives them (it prints each seed's id with --json)"),
  first_published: base.first_published,
  seeded: IsoDate.describe("The date Claude first wrote this file; it sets every date the script writes"),
}).superRefine((f, ctx) => {
  const none = f.ai.role === "none";
  if (none !== (f.explainer.ai_helped === null)) {
    ctx.addIssue({
      code: "custom",
      message: none ? "ai_helped is null when ai.role is none" : "ai_helped is set when ai.role is an AI role",
      path: ["explainer", "ai_helped"],
    });
  }
});

/** A seed file's name, `<first_published>-<nn>.json` (§3): `nn` is 01, 02, ... for one date. */
export const SEED_FILE_RE = /^(\d{4}-\d{2}-\d{2})-(0[1-9]|[1-9]\d)\.json$/;

/** The file name for the `n`th seed (from 1) with `first_published` `date`. */
export function seedFileName(date: string, n: number): string {
  return `${date}-${String(n).padStart(2, "0")}.json`;
}

export type SeedL10n = z.infer<typeof SeedL10n>;
export type SeedTerm = z.infer<typeof SeedTerm>;
export type SeedTermNew = z.infer<typeof SeedTermNew>;
export type SeedExplainer = z.infer<typeof SeedExplainer>;
export type SeedRung = z.infer<typeof SeedRung>;
export type SeedFigure = z.infer<typeof SeedFigure>;
export type SeedFinding = z.infer<typeof SeedFinding>;
