// F fixtures for the Chinese rule group (SPEC §4.6, §4.12 "Fixtures and tests"): one mutation of `valid-weekday.zh.json`
// for each hard code `validateZh()` checks (the ZH_* codes and CANARY among them), each failing with exactly that code. A
// Chinese draft is a `DraftZh` (strings keyed by the Chinese context, and terms), not a `DraftBrief`, so these cases have a
// type of their own and `fixtures/src/build.ts` keeps them apart from INVALID_CASES (ZH_INVALID_CASES). Each file is written
// to fixtures/drafts-zh/ as `invalid--<CODE>.zh.json`. The Chinese fixtures' author adds the cases here; the group holds
// none until then. Chinese is Traditional Chinese as used in Taiwan, and the sample text is invented.
//
// New for this project; Cyber has no Chinese pass.

import type { DraftZh } from "../../../lib/schema/draft-zh";
import type { EditionName } from "../world";

/** One Chinese F fixture: a mutation of an edition's valid Chinese draft that fails `validateZh()` with exactly `code`. */
export interface ZhInvalidCase {
  code: string;
  /** `invalid--<CODE>.zh.json`, written to fixtures/drafts-zh/. */
  file: string;
  /** The valid Chinese draft mutated, and whose inputs validate it; default "weekday". */
  edition?: EditionName;
  /** Changes the fresh Chinese draft in place, or returns a replacement (a value past the schema is written as is). */
  mutate: (draft: DraftZh) => unknown;
}

/** One Chinese S fixture: a mutation of an edition's valid Chinese draft that passes `validateZh()` with no error and exactly one warning (every ZH_ code is hard, so none exists today). */
export interface ZhSoftCase {
  code: string;
  /** `soft--<CODE>.zh.json`, written to fixtures/drafts-zh/. */
  file: string;
  edition?: EditionName;
  mutate: (draft: DraftZh) => unknown;
}

/** One Chinese T fixture: a named case for a check the weekday Chinese draft cannot reach, run by the tests, never written to fixtures/. */
export interface ZhNamedCase {
  name: string;
  code: string;
  edition: EditionName;
  mutate: (draft: DraftZh) => unknown;
  /** The exact result of `validateZh()`: the set of error codes and the set of warning codes, each in sorted order. */
  expect: { errors: readonly string[]; warnings: readonly string[] };
}

export const zhCases: readonly ZhInvalidCase[] = [];

export const zhSoft: readonly ZhSoftCase[] = [];

export const zhNamed: readonly ZhNamedCase[] = [];
