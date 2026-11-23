// F, S and T fixtures for the history rule group (SPEC §4.12 "Fixtures and tests"): `historyCases` holds one mutation of the weekday
// draft for each hard code of the group that a draft can trigger, each failing validateDraft() with exactly that code and no
// other error and no warning, as `{ code, file: "invalid--<CODE>.json", edition?, mutate }`; `historySoft` holds one mutation for
// each soft code, passing with no error and exactly that warning, as `{ code, file: "soft--<CODE>.json", edition?, mutate }`;
// `historyNamed` holds the named cases for checks a weekday draft cannot reach, as `{ name, code, edition, mutate, expect }`
// (see `NamedCase` in ../build). `fixtures/src/build.ts` spreads each array into INVALID_CASES, SOFT_CASES and NAMED_CASES and
// writes the first two to fixtures/drafts/. The group's reviewer adds the cases here, with the handles of `../drafts`
// (`WEEKDAY_ITEMS` and `newFindingOf()`); the group holds none until then. Sample text is invented.
//
// New for this project; Cyber's fixtures/src/invalid/ files hold its own domain's cases, and the file's role is the same.

import type { InvalidCase, NamedCase, SoftCase } from "../build";

export const historyCases: readonly InvalidCase[] = [];

export const historySoft: readonly SoftCase[] = [];

export const historyNamed: readonly NamedCase[] = [];
