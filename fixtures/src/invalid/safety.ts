// F, S and T fixtures for the safety rule group (SPEC §4.12 "Fixtures and tests"): `safetyCases` holds one mutation of the weekday
// draft for each hard code of the group that a draft can trigger, each failing validateDraft() with exactly that code and no
// other error and no warning, as `{ code, file: "invalid--<CODE>.json", edition?, mutate }`; `safetySoft` holds one mutation for
// each soft code, passing with no error and exactly that warning, as `{ code, file: "soft--<CODE>.json", edition?, mutate }`;
// `safetyNamed` holds the named cases for checks a weekday draft cannot reach, as `{ name, code, edition, mutate, expect }`
// (see `NamedCase` in ../build). `fixtures/src/build.ts` spreads each array into INVALID_CASES, SOFT_CASES and NAMED_CASES and
// writes the first two to fixtures/drafts/. The group's reviewer adds the cases here, with the handles of `../drafts`
// (`WEEKDAY_ITEMS` and `newFindingOf()`); the group holds none until then. Sample text is invented.
//
// Cyber's fixtures/src/invalid/ files at the fork commit 3ced1fb, adapted: the file's role, arrays of cases for one rule group listed in the builder, is the same; its cases are this project's.

import type { InvalidCase, NamedCase, SoftCase } from "../build";

export const safetyCases: readonly InvalidCase[] = [];

export const safetySoft: readonly SoftCase[] = [];

export const safetyNamed: readonly NamedCase[] = [];
