// The glossary, `content/glossary.json` (SPEC §4.9), written only by publish (and by `ledger-seed.ts` in P2). A term
// is added the first time a published finding defines it and never changes after, except by a `removed`
// correction (§4.10) or, while its `zh` is null, the backlog's Chinese (§4.6).
//
// Shape only: a definition's 40-word budget is `WORDS`'s, `official` and `official_url` are `ZH_OFFICIAL`'s (a
// non-null `official` comes with an `official_url` on terms.naer.edu.tw and appears in that page), and the terms a
// finding lists exist here by `XREF`. The terms are sorted by id, which this file checks.
//
// New for this project; Cyber has no glossary.

import { z } from "zod";
import { FieldId, FindingId, IsoDate, TermId, uniqueArray } from "./common";

export const TermEn = z.strictObject({
  term: z.string().min(1).describe("The English term"),
  definition: z.string().min(1).describe("At most 40 words, plain, with no other undefined jargon"),
});

/** The Chinese side: everyday Taiwan usage (STYLE-ZH.md); `official` is the term in 樂詞網 when the Chinese pass found it. */
export const TermZh = z.strictObject({
  term: z.string().min(1),
  definition: z.string().min(1),
  official: z.string().min(1).nullable(),
  official_url: z.string().min(1).nullable(),
});

export const Term = z.strictObject({
  id: TermId,
  en: TermEn,
  zh: TermZh.nullable().describe("null only while an English-only edition's term awaits the backlog"),
  fields: uniqueArray(FieldId, "fields").min(1, { error: "A term belongs to at least one field" }),
  first_finding: FindingId,
  first_date: IsoDate,
});

/** content/glossary.json: `terms` sorted by id, in code-unit order, with no id twice. */
export const GlossaryFile = z.strictObject({
  schema_version: z.literal(1),
  terms: z.array(Term),
}).superRefine((g, ctx) => {
  g.terms.forEach((term, i) => {
    if (i > 0 && term.id <= g.terms[i - 1]!.id) {
      ctx.addIssue({ code: "custom", message: "terms are sorted by id, with no id twice", path: ["terms", i, "id"] });
    }
  });
});

export type TermEn = z.infer<typeof TermEn>;
export type TermZh = z.infer<typeof TermZh>;
export type Term = z.infer<typeof Term>;
export type GlossaryFile = z.infer<typeof GlossaryFile>;
