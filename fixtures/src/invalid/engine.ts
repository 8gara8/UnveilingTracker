// The F fixture for the validator's own code (SPEC §4.12 "Fixtures and tests"): SCHEMA, the one code of the rule table that the engine
// reports and no rule group owns (`group: "engine"`, lib/rules/index.ts). The table lists F and Z for it: the Z case is the
// Chinese draft's `invalid--SCHEMA.zh.json` (fixtures/src/invalid/zh.ts), and this file holds the English F case. The engine has no S
// fixture (SCHEMA is hard) and no T case here: the other ways to fail the schema (an unknown key, a missing key, a wrong type in
// another part, an invisible character, a correction that names a path it may not) are cases of tests/validate-draft-engine.test.ts.
//
//   F (`engineCases`)  one mutation of the weekday draft, written to fixtures/drafts/invalid--SCHEMA.json: the items written as one
//                      comma-joined string where the schema wants a list of refs, the commonest shape mistake of an agent that writes
//                      a list. The DraftBrief schema refuses it, so the draft is judged by its SCHEMA issue alone and no rule runs
//                      (lib/validate.ts): `validateDraft()` gives exactly one error, SCHEMA at `items`, and no warning.
//
// New for this project; Cyber's fixtures/src/invalid/meta-items.ts at the fork commit 3ced1fb, adapted: its SCHEMA cases there put an
// unknown key on a source and on an item; this one is a list written as a string, with the weekday draft and a one-line reason as there.

import type { InvalidCase } from "../build";

// ── F: one mutation of the weekday draft ─────────────────────────────────────────────────────────

export const engineCases: readonly InvalidCase[] = [
  {
    // The weekday's four items joined into one string, "new-2, new-3, new-4, soc-2026-0145": the schema wants a list of refs. The
    // replacement keeps every other part of the draft and the order of its keys, so the one change is the type of `items`.
    code: "SCHEMA", file: "invalid--SCHEMA.json",
    mutate: (d) => ({ ...d, items: d.items.join(", ") }),
  },
];
