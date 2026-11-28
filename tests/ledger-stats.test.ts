// lib/metrics/ledger-stats.ts (SPEC §5.5 C: AI's share of the Landmarks, §5.6 D: the Hold rate, §4.10 filedAs on D - 1, §5.2 the
// quotable counts): C's rows, baseline and ids built by hand from a table of findings, each exclusion on its own, the
// correction day (a correction dated D counts from D + 1), D's cases at every boundary, the four cases §5.6 names, the
// outcomes held, fell and open, `too_few` at 29 and 30, and the quotable figures. New for this project; Cyber has no
// counterpart.
import { describe, expect, it } from "vitest";
import {
  BASELINE_LAST_YEAR, FIRST_YEAR, HOLD_KINDS, holdRate, isHoldCase, landmarkCounts, landmarksThisYear, ledgerQuotable,
  type HoldSettings, type LedgerFinding,
} from "@/lib/metrics/ledger-stats";
import type { FilingCorrection } from "@/lib/items";
import { MetricPath } from "@/lib/schema/common";
import { Hold, Landmarks } from "@/lib/schema/metrics";
import { AI_ROLES, ALL_RUNGS, FINDING_KINDS, SIGNIFICANCE, type AiRole, type FindingKind, type Rung } from "@/lib/vocab";

const D = "2026-11-23"; // the edition: C and D read the findings as corrections filed them on 2026-11-22
const SETTINGS: HoldSettings = { min_cases: 30, hold_after_days: 182 };

/** A stored Landmark result at Checked with an AI role, first published and first briefed in March 2026. */
const lf = (id: string, over: Partial<LedgerFinding> = {}): LedgerFinding => ({
  id,
  field: "biology",
  subfield: "proteins",
  kind: "result",
  significance: "landmark",
  ai: { role: "ai_solved", confidence: "confirmed" },
  rung: "checked",
  rung_history: [{ rung: "checked", recorded: "2026-05-04" }],
  first_published: "2026-03-01",
  first_brief: "2026-03-05",
  history: false,
  ...over,
});

const correction = (id: string, date: string, findingId: string, path: string, after: string, over: Partial<FilingCorrection> = {}): FilingCorrection => ({
  id, date, finding_id: findingId, type: "update", path, after: { en: after }, ...over,
});

/** Freezes a value and everything in it, so any write to it throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

describe("the constants", () => {
  it("start C at 2015, end the baseline at 2019 and take the three kinds of D's cases", () => {
    expect(FIRST_YEAR).toBe(2015);
    expect(BASELINE_LAST_YEAR).toBe(2019);
    expect([...HOLD_KINDS]).toEqual(["result", "capability", "check"]);
  });
});

// ── C ────────────────────────────────────────────────────────────────────────────────────────────

describe("landmarkCounts: the rows, the baseline and the ids", () => {
  // Landmarks by year of first_published: [year, with an AI role, without one].
  const TABLE: [number, number, number][] = [
    [2015, 1, 1], [2016, 0, 0], [2017, 2, 1], [2018, 1, 0], [2019, 1, 3], [2020, 2, 0], [2025, 3, 2], [2026, 2, 1],
  ];
  const AI_ROLES_USED: AiRole[] = ["ai_proposed", "ai_solved", "ai_ran", "ai_tool", "ai_checked"];

  /** The findings of TABLE, ids in the order publish gave them (year, then counter), and the same ids as a list. */
  function build(): { findings: LedgerFinding[]; ids: string[] } {
    const findings: LedgerFinding[] = [];
    let counter = 0;
    for (const [year, ai, other] of TABLE) {
      for (let i = 0; i < ai + other; i += 1) {
        counter += 1;
        const id = `bio-${year}-${String(counter).padStart(4, "0")}`;
        const role: AiRole = i < ai ? AI_ROLES_USED[i % 5]! : "none";
        findings.push(lf(id, { first_published: `${year}-06-15`, ai: { role, confidence: role === "none" ? null : "confirmed" } }));
      }
    }
    return { findings, ids: findings.map((f) => f.id) };
  }

  it("makes one row for every year from 2015 to the year of D, a year with no Landmark included", () => {
    // 2015: 1 AI + 1 other = 2 all, ai 1.     2016: none.                     2017: 2 AI + 1 other = 3, ai 2.
    // 2018: 1 AI = 1, ai 1.                   2019: 1 AI + 3 other = 4, ai 1. 2020: 2 AI = 2, ai 2.
    // 2021 to 2024: none.                     2025: 3 AI + 2 other = 5, ai 3. 2026: 2 AI + 1 other = 3, ai 2.
    const { landmarks } = landmarkCounts(build().findings, [], D);
    expect(landmarks.by_year).toEqual([
      { year: 2015, ai: 1, all: 2 }, { year: 2016, ai: 0, all: 0 }, { year: 2017, ai: 2, all: 3 }, { year: 2018, ai: 1, all: 1 },
      { year: 2019, ai: 1, all: 4 }, { year: 2020, ai: 2, all: 2 }, { year: 2021, ai: 0, all: 0 }, { year: 2022, ai: 0, all: 0 },
      { year: 2023, ai: 0, all: 0 }, { year: 2024, ai: 0, all: 0 }, { year: 2025, ai: 3, all: 5 }, { year: 2026, ai: 2, all: 3 },
    ]);
  });

  it("adds 2015 to 2019 up as the baseline and leaves 2020 out of it", () => {
    // ai: 1 + 0 + 2 + 1 + 1 = 5.   all: 2 + 0 + 3 + 1 + 4 = 10.
    expect(landmarkCounts(build().findings, [], D).landmarks.baseline).toEqual({ ai: 5, all: 10 });
  });

  it("lists every finding counted, with or without an AI role, in the order publish gave the ids, whatever the order given", () => {
    const { findings, ids } = build();
    expect(ids).toHaveLength(20); // 2 + 0 + 3 + 1 + 4 + 2 + 5 + 3
    expect(landmarkCounts(findings, [], D).ids).toEqual(ids);
    expect(landmarkCounts([...findings].reverse(), [], D).ids).toEqual(ids);
  });

  it("sorts ids by year, then counter, then field code, and not as text", () => {
    const findings = [
      lf("math-2026-0142", { first_published: "2026-02-01" }),
      lf("bio-2026-0099", { first_published: "2026-02-01" }),
      lf("hum-2025-0300", { first_published: "2025-02-01" }),
      lf("hum-2026-0099", { first_published: "2026-02-01" }),
    ];
    expect(landmarkCounts(findings, [], D).ids).toEqual(["hum-2025-0300", "bio-2026-0099", "hum-2026-0099", "math-2026-0142"]);
  });

  it("gives a row of zeros for every year and an empty list of ids when there is no finding", () => {
    const { landmarks, ids } = landmarkCounts([], [], D);
    expect(landmarks.by_year).toHaveLength(12);
    expect(landmarks.by_year.every((row) => row.ai === 0 && row.all === 0)).toBe(true);
    expect(landmarks.by_year[0]!.year).toBe(2015);
    expect(landmarks.by_year[11]!.year).toBe(2026);
    expect(landmarks.baseline).toEqual({ ai: 0, all: 0 });
    expect(ids).toEqual([]);
  });

  it("runs the rows to the year of D, and the baseline stays 2015 to 2019 whichever year that is", () => {
    const findings = [lf("bio-2019-0001", { first_published: "2019-12-31" }), lf("bio-2020-0001", { first_published: "2020-01-01" })];
    const in2020 = landmarkCounts(findings, [], "2020-03-02");
    expect(in2020.landmarks.by_year.map((r) => r.year)).toEqual([2015, 2016, 2017, 2018, 2019, 2020]);
    expect(in2020.landmarks.baseline).toEqual({ ai: 1, all: 1 });
    expect(in2020.landmarks.by_year[5]).toEqual({ year: 2020, ai: 1, all: 1 });
    const in2019 = landmarkCounts(findings, [], "2019-12-31");
    expect(in2019.landmarks.by_year.map((r) => r.year)).toEqual([2015, 2016, 2017, 2018, 2019]);
    expect(in2019.ids).toEqual(["bio-2019-0001"]);
    const in2027 = landmarkCounts(findings, [], "2027-01-05");
    expect(in2027.landmarks.by_year).toHaveLength(13);
    expect(in2027.landmarks.by_year[12]).toEqual({ year: 2027, ai: 0, all: 0 });
  });

  it("files a finding in the year of first_published, not the year of its first brief or of its id", () => {
    const finding = lf("bio-2017-0001", { first_published: "2016-12-31", first_brief: "2017-01-03" });
    const { landmarks } = landmarkCounts([finding], [], D);
    expect(landmarks.by_year.find((r) => r.year === 2016)).toEqual({ year: 2016, ai: 1, all: 1 });
    expect(landmarks.by_year.find((r) => r.year === 2017)).toEqual({ year: 2017, ai: 0, all: 0 });
  });

  it("leaves out a finding first published before 2015 or after the year of D, and keeps the first and last days of the range", () => {
    const findings = [
      lf("bio-2014-0001", { first_published: "2014-12-31" }),
      lf("bio-2015-0001", { first_published: "2015-01-01" }),
      lf("bio-2026-0001", { first_published: "2026-12-31" }),
      lf("bio-2027-0001", { first_published: "2027-01-01" }),
    ];
    const { landmarks, ids } = landmarkCounts(findings, [], D);
    expect(ids).toEqual(["bio-2015-0001", "bio-2026-0001"]);
    expect(landmarks.by_year[0]).toEqual({ year: 2015, ai: 1, all: 1 });
    expect(landmarks.by_year[11]).toEqual({ year: 2026, ai: 1, all: 1 });
    expect(landmarks.baseline).toEqual({ ai: 1, all: 1 });
  });

  it("counts a finding that entered the Ledger as history, which gives C its before-AI years", () => {
    expect(landmarkCounts([lf("bio-2016-0001", { first_published: "2016-05-01", first_brief: null, history: true })], [], D).ids).toEqual(["bio-2016-0001"]);
  });

  it("changes neither the findings nor the corrections", () => {
    const { findings } = build();
    const corrections = [correction("C-0001", "2026-06-01", findings[0]!.id, "significance", "major")];
    deepFreeze(findings);
    deepFreeze(corrections);
    expect(landmarkCounts(findings, corrections, D).ids).toHaveLength(19);
  });

  it("gives a result the Landmarks schema accepts: oldest year first, the baseline adding 2015 to 2019 up", () => {
    const { landmarks } = landmarkCounts(build().findings, [], D);
    expect(Landmarks.safeParse(landmarks).success).toBe(true);
  });
});

describe("landmarkCounts: what is left out", () => {
  const ids = (findings: LedgerFinding[], corrections: FilingCorrection[] = [], date = D): string[] => landmarkCounts(findings, corrections, date).ids;

  it("counts only Landmarks, whichever the other significances", () => {
    for (const significance of SIGNIFICANCE) {
      expect(ids([lf("bio-2026-0001", { significance })]), significance).toEqual(significance === "landmark" ? ["bio-2026-0001"] : []);
    }
  });

  it("counts a Landmark of every kind but a setback, even one with a counted rung", () => {
    for (const kind of FINDING_KINDS) {
      expect(ids([lf("bio-2026-0001", { kind })]), kind).toEqual(kind === "setback" ? [] : ["bio-2026-0001"]);
    }
  });

  it("counts a Landmark at Checked, Confirmed or Applied and at no other rung", () => {
    for (const rung of ALL_RUNGS) {
      const counted = ["checked", "confirmed", "applied"].includes(rung);
      expect(ids([lf("bio-2026-0001", { rung })]), rung).toEqual(counted ? ["bio-2026-0001"] : []);
    }
  });

  it("counts a Landmark with no AI role in all and not in ai, and one with any role in both", () => {
    for (const role of AI_ROLES) {
      const row = landmarkCounts([lf("bio-2026-0001", { ai: { role, confidence: role === "none" ? null : "claimed" } })], [], D).landmarks.by_year[11];
      expect(row, role).toEqual({ year: 2026, ai: role === "none" ? 0 : 1, all: 1 });
    }
  });

  it("is not changed by a Landmark setback with a counted rung (SPEC §5.6's first test)", () => {
    const setback = lf("bio-2026-0001", { kind: "setback", rung: "checked" });
    const withIt = landmarkCounts([setback, lf("bio-2026-0002")], [], D);
    const without = landmarkCounts([lf("bio-2026-0002")], [], D);
    expect(withIt).toEqual(without);
    expect(withIt.landmarks.by_year[11]).toEqual({ year: 2026, ai: 1, all: 1 });
  });
});

describe("landmarkCounts: the findings as corrections filed them on D - 1", () => {
  const F = "bio-2026-0001";
  const rowOf = (findings: LedgerFinding[], corrections: FilingCorrection[], date: string) =>
    landmarkCounts(findings, corrections, date).landmarks.by_year.find((r) => r.year === Number(date.slice(0, 4)));

  it("does not apply a correction dated D to D's metrics, and applies it the next morning", () => {
    // Stage 3 computes D's metrics before publish writes D's corrections: 2026-11-23's metrics read the filing of 2026-11-22.
    const lowered = [correction("C-0001", "2026-11-23", F, "significance", "major")];
    expect(rowOf([lf(F)], lowered, "2026-11-23")).toEqual({ year: 2026, ai: 1, all: 1 });
    expect(rowOf([lf(F)], lowered, "2026-11-24")).toEqual({ year: 2026, ai: 0, all: 0 });
  });

  it("applies a correction dated D - 1 to D's metrics, and not to the day before", () => {
    const lowered = [correction("C-0001", "2026-11-22", F, "significance", "major")];
    expect(rowOf([lf(F)], lowered, "2026-11-23")).toEqual({ year: 2026, ai: 0, all: 0 });
    expect(rowOf([lf(F)], lowered, "2026-11-22")).toEqual({ year: 2026, ai: 1, all: 1 });
  });

  it("reads D - 1 across a month and a year, where the date arithmetic could slip", () => {
    const c = [correction("C-0001", "2025-12-31", F, "significance", "major")];
    const f = lf(F, { first_published: "2025-06-01" });
    expect(landmarkCounts([f], c, "2026-01-01").ids).toEqual([]);
    expect(landmarkCounts([f], c, "2025-12-31").ids).toEqual([F]);
    expect(landmarkCounts([f], [correction("C-0001", "2026-02-28", F, "significance", "major")], "2026-03-01").ids).toEqual([]);
    expect(landmarkCounts([f], [correction("C-0001", "2026-02-28", F, "significance", "major")], "2026-02-28").ids).toEqual([F]);
  });

  it("drops a Landmark refiled as a setback, and counts a finding refiled as a Landmark", () => {
    const asSetback = [correction("C-0001", "2026-06-01", F, "kind", "setback")];
    expect(landmarkCounts([lf(F)], asSetback, D).ids).toEqual([]);
    const raised = [correction("C-0001", "2026-06-01", F, "significance", "landmark")];
    expect(landmarkCounts([lf(F, { significance: "major" })], raised, D).ids).toEqual([F]);
    const fromSetback = [correction("C-0001", "2026-06-01", F, "kind", "result")];
    expect(landmarkCounts([lf(F, { kind: "setback" })], fromSetback, D).ids).toEqual([F]);
  });

  it("moves a finding refiled with no AI role from ai to all only, and back when an AI role is filed", () => {
    const none = [correction("C-0001", "2026-06-01", F, "ai.role", "none")];
    expect(rowOf([lf(F)], none, D)).toEqual({ year: 2026, ai: 0, all: 1 });
    const role = [correction("C-0001", "2026-06-01", F, "ai.role", "ai_tool")];
    expect(rowOf([lf(F, { ai: { role: "none", confidence: null } })], role, D)).toEqual({ year: 2026, ai: 1, all: 1 });
  });

  it("takes the latest correction at a path, a removed correction and another finding's correction never refile", () => {
    const c = [
      correction("C-0001", "2026-06-01", F, "significance", "major"),
      correction("C-0002", "2026-06-02", F, "significance", "landmark"),
      correction("C-0003", "2026-06-03", F, "significance", "watch", { type: "removed" }),
      correction("C-0004", "2026-06-04", "bio-2026-0002", "significance", "watch"),
    ];
    expect(landmarkCounts([lf(F), lf("bio-2026-0002")], c, D).ids).toEqual([F]);
  });

  it("does not let a correction at the rung or the field change the count, since the stored rung decides and C has no field", () => {
    const c = [correction("C-0001", "2026-06-01", F, "rung", "retracted"), correction("C-0002", "2026-06-01", F, "field", "physics")];
    expect(landmarkCounts([lf(F)], c, D).ids).toEqual([F]);
  });
});

describe("landmarksThisYear", () => {
  const { landmarks } = landmarkCounts([lf("bio-2026-0001"), lf("bio-2026-0002", { ai: { role: "none", confidence: null } }), lf("bio-2020-0001", { first_published: "2020-03-01" })], [], D);

  it("gives the row of the year of the date", () => {
    expect(landmarksThisYear(landmarks, D)).toEqual({ year: 2026, ai: 1, all: 2 });
    expect(landmarksThisYear(landmarks, "2020-01-01")).toEqual({ year: 2020, ai: 1, all: 1 });
    expect(landmarksThisYear(landmarks, "2015-12-31")).toEqual({ year: 2015, ai: 0, all: 0 });
  });

  it("is null when C has no row for that year", () => {
    expect(landmarksThisYear(landmarks, "2027-01-01")).toBeNull();
    expect(landmarksThisYear(landmarks, "2014-12-31")).toBeNull();
    expect(landmarksThisYear({ by_year: [], baseline: { ai: 0, all: 0 } }, D)).toBeNull();
  });
});

// ── D ────────────────────────────────────────────────────────────────────────────────────────────

/** A case of D: a result with an AI role, first briefed at Preprint on 2026-03-05 (263 days before D), and now at `rung`. */
const hcase = (id: string, rung: Rung = "checked", over: Partial<LedgerFinding> = {}): LedgerFinding =>
  lf(id, {
    kind: "result",
    significance: "major",
    rung,
    first_brief: "2026-03-05",
    rung_history: [{ rung: "preprint", recorded: "2026-03-05" }, ...(rung === "preprint" ? [] : [{ rung, recorded: "2026-06-01" }])],
    ...over,
  });

describe("isHoldCase", () => {
  it("is true for the base case, a result with an AI role first briefed at Preprint 263 days ago", () => {
    expect(isHoldCase(hcase("bio-2026-0001"), D, SETTINGS)).toBe(true);
  });

  it("takes a result, a capability or a check and no other kind", () => {
    for (const kind of FINDING_KINDS as readonly FindingKind[]) {
      expect(isHoldCase(hcase("bio-2026-0001", "checked", { kind }), D, SETTINGS), kind).toBe(["result", "capability", "check"].includes(kind));
    }
  });

  it("needs an AI role", () => {
    for (const role of AI_ROLES) {
      expect(isHoldCase(hcase("bio-2026-0001", "checked", { ai: { role, confidence: role === "none" ? null : "claimed" } }), D, SETTINGS), role).toBe(role !== "none");
    }
  });

  it("leaves out a history entry and a finding never briefed", () => {
    expect(isHoldCase(hcase("bio-2026-0001", "checked", { history: true }), D, SETTINGS)).toBe(false);
    expect(isHoldCase(hcase("bio-2026-0001", "checked", { first_brief: null }), D, SETTINGS)).toBe(false);
  });

  it("needs a first brief at least 182 days before D: 182 days is a case, 181 is not", () => {
    // 2026-11-23 minus 182 days is 2026-05-25 (22 days to 1 Nov, 31 + 30 + 31 + 31 + 30 more to 1 Jun is 175, and 7 more).
    const at = (first_brief: string) =>
      isHoldCase(hcase("bio-2026-0001", "checked", { first_brief, rung_history: [{ rung: "preprint", recorded: first_brief }] }), D, SETTINGS);
    expect(at("2026-05-24")).toBe(true); // 183 days
    expect(at("2026-05-25")).toBe(true); // 182 days
    expect(at("2026-05-26")).toBe(false); // 181 days
    expect(at("2026-11-22")).toBe(false);
    expect(at("2026-11-23")).toBe(false);
  });

  it("reads the number of days from the settings", () => {
    const at = (first_brief: string, hold_after_days: number) =>
      isHoldCase(hcase("bio-2026-0001", "checked", { first_brief, rung_history: [{ rung: "preprint", recorded: first_brief }] }), D, { hold_after_days });
    expect(at("2026-10-24", 30)).toBe(true); // 30 days
    expect(at("2026-10-25", 30)).toBe(false); // 29 days
    expect(at("2026-05-26", 181)).toBe(true);
    expect(at("2026-05-26", 182)).toBe(false);
  });

  it("needs the rung when first briefed to be Claimed or Preprint", () => {
    for (const rung of ALL_RUNGS) {
      const finding = hcase("bio-2026-0001", "checked", { rung_history: [{ rung, recorded: "2026-03-05" }, { rung: "checked", recorded: "2026-06-01" }] });
      expect(isHoldCase(finding, D, SETTINGS), rung).toBe(rung === "claimed" || rung === "preprint");
    }
  });

  it("takes the rung from the last entry recorded on or before the first brief", () => {
    const history = [{ rung: "preprint", recorded: "2026-03-01" }, { rung: "checked", recorded: "2026-03-05" }] as const;
    expect(isHoldCase(hcase("bio-2026-0001", "checked", { rung_history: [...history] }), D, SETTINGS)).toBe(false); // checked on the day itself
    const later = [{ rung: "preprint", recorded: "2026-03-01" }, { rung: "checked", recorded: "2026-03-06" }] as const;
    expect(isHoldCase(hcase("bio-2026-0001", "checked", { rung_history: [...later] }), D, SETTINGS)).toBe(true); // checked a day later
  });

  it("is not a case when no entry had been recorded by the first brief", () => {
    expect(isHoldCase(hcase("bio-2026-0001", "checked", { rung_history: [{ rung: "preprint", recorded: "2026-03-06" }] }), D, SETTINGS)).toBe(false);
    expect(isHoldCase(hcase("bio-2026-0001", "checked", { rung_history: [] }), D, SETTINGS)).toBe(false);
  });
});

describe("holdRate: the four cases SPEC §5.6 names", () => {
  it("a Landmark setback with a counted rung changes neither C nor D", () => {
    const setback = hcase("bio-2026-0001", "checked", { kind: "setback", significance: "landmark" });
    const real = hcase("bio-2026-0002", "checked");
    expect(holdRate([setback, real], [], D, SETTINGS)).toEqual(holdRate([real], [], D, SETTINGS));
    expect(holdRate([setback], [], D, SETTINGS).hold.cases).toBe(0);
    expect(landmarkCounts([setback], [], D).ids).toEqual([]);
  });

  it("a claimed policy and people item (a funding statement) is never a case", () => {
    const funding = hcase("bio-2026-0001", "claimed", { kind: "policy_people", significance: "notable", rung_history: [{ rung: "claimed", recorded: "2026-03-05" }] });
    expect(holdRate([funding], [], D, SETTINGS)).toEqual({ hold: { cases: 0, held: 0, fell: 0, open: 0, too_few: true }, case_ids: [] });
  });

  it("a finding briefed at Checked whose history starts with its preprint is not a case", () => {
    const finding = hcase("bio-2026-0001", "checked", {
      first_brief: "2026-02-10",
      rung_history: [{ rung: "preprint", recorded: "2026-01-05" }, { rung: "checked", recorded: "2026-02-10" }],
    });
    expect(holdRate([finding], [], D, SETTINGS).hold.cases).toBe(0);
  });

  it("a finding briefed at Preprint that later climbs to Checked is held", () => {
    const finding = hcase("bio-2026-0001", "checked", {
      first_brief: "2026-02-10",
      rung_history: [{ rung: "preprint", recorded: "2026-02-10" }, { rung: "checked", recorded: "2026-08-01" }],
    });
    expect(holdRate([finding], [], D, SETTINGS)).toEqual({ hold: { cases: 1, held: 1, fell: 0, open: 0, too_few: true }, case_ids: ["bio-2026-0001"] });
  });
});

describe("holdRate: held, fell and open", () => {
  const outcome = (rung: Rung) => holdRate([hcase("bio-2026-0001", rung)], [], D, SETTINGS).hold;

  it("counts a case now at Checked, Confirmed or Applied as held", () => {
    for (const rung of ["checked", "confirmed", "applied"] as const) expect(outcome(rung), rung).toEqual({ cases: 1, held: 1, fell: 0, open: 0, too_few: true });
  });

  it("counts a case now Disputed or Retracted as fell", () => {
    for (const rung of ["disputed", "retracted"] as const) expect(outcome(rung), rung).toEqual({ cases: 1, held: 0, fell: 1, open: 0, too_few: true });
  });

  it("counts a case still Claimed or at Preprint as open", () => {
    for (const rung of ["claimed", "preprint"] as const) expect(outcome(rung), rung).toEqual({ cases: 1, held: 0, fell: 0, open: 1, too_few: true });
  });

  it("goes by the stored rung, whatever the rung at the first brief or a correction at the rung path", () => {
    const c = [correction("C-0001", "2026-06-01", "bio-2026-0001", "rung", "retracted")];
    expect(holdRate([hcase("bio-2026-0001", "checked")], c, D, SETTINGS).hold.held).toBe(1);
  });
});

describe("holdRate: 23 and 30 cases", () => {
  // 15 held (5 each at Checked, Confirmed, Applied), 3 fell (Disputed, Retracted, Disputed) and 5 open (2 Claimed, 3 Preprint).
  const RUNGS_23: Rung[] = [
    ...(["checked", "confirmed", "applied"] as const).flatMap((r) => [r, r, r, r, r]),
    "disputed", "retracted", "disputed",
    "claimed", "claimed", "preprint", "preprint", "preprint",
  ];
  const cases = (n: number): LedgerFinding[] =>
    Array.from({ length: n }, (_, i) => hcase(`bio-2026-${String(i + 1).padStart(4, "0")}`, i < 23 ? RUNGS_23[i]! : "checked"));

  // Findings that are not cases, one for each way to miss.
  const noise = (): LedgerFinding[] => [
    hcase("bio-2026-0101", "checked", { kind: "setback" }),
    hcase("bio-2026-0102", "checked", { kind: "infrastructure" }),
    hcase("bio-2026-0103", "checked", { kind: "policy_people" }),
    hcase("bio-2026-0104", "checked", { ai: { role: "none", confidence: null } }),
    hcase("bio-2026-0105", "checked", { history: true }),
    hcase("bio-2026-0106", "checked", { first_brief: "2026-08-01", rung_history: [{ rung: "preprint", recorded: "2026-08-01" }] }),
    hcase("bio-2026-0107", "checked", { first_brief: null }),
    hcase("bio-2026-0108", "checked", { rung_history: [{ rung: "checked", recorded: "2026-03-05" }] }),
  ];

  it("counts 23 cases as 15 held, 3 fell and 5 open, with too few to judge, and ignores every non-case", () => {
    const result = holdRate([...noise(), ...cases(23)], [], D, SETTINGS);
    expect(result.hold).toEqual({ cases: 23, held: 15, fell: 3, open: 5, too_few: true });
    expect(result.case_ids).toHaveLength(23);
  });

  it("is too few at 29 cases and enough at 30", () => {
    expect(holdRate(cases(29), [], D, SETTINGS).hold).toEqual({ cases: 29, held: 21, fell: 3, open: 5, too_few: true });
    expect(holdRate(cases(30), [], D, SETTINGS).hold).toEqual({ cases: 30, held: 22, fell: 3, open: 5, too_few: false });
    expect(holdRate(cases(31), [], D, SETTINGS).hold).toEqual({ cases: 31, held: 23, fell: 3, open: 5, too_few: false });
  });

  it("reads the least number of cases from the settings, and is never too few when it is 0", () => {
    expect(holdRate(cases(5), [], D, { min_cases: 5, hold_after_days: 182 }).hold.too_few).toBe(false);
    expect(holdRate(cases(5), [], D, { min_cases: 6, hold_after_days: 182 }).hold.too_few).toBe(true);
    expect(holdRate([], [], D, { min_cases: 0, hold_after_days: 182 }).hold).toEqual({ cases: 0, held: 0, fell: 0, open: 0, too_few: false });
    expect(holdRate([], [], D, SETTINGS).hold).toEqual({ cases: 0, held: 0, fell: 0, open: 0, too_few: true });
  });

  it("lists every case, held, fell or open, in id order, whatever the order given", () => {
    const list = cases(23);
    const expected = list.map((f) => f.id);
    expect(holdRate(list, [], D, SETTINGS).case_ids).toEqual(expected);
    expect(holdRate([...list].reverse(), [], D, SETTINGS).case_ids).toEqual(expected);
  });

  it("gives a result the Hold schema accepts", () => {
    expect(Hold.safeParse(holdRate(cases(23), [], D, SETTINGS).hold).success).toBe(true);
    expect(Hold.safeParse(holdRate([], [], D, SETTINGS).hold).success).toBe(true);
  });

  it("changes neither the findings nor the corrections", () => {
    const list = deepFreeze(cases(3));
    const corrections = deepFreeze([correction("C-0001", "2026-06-01", "bio-2026-0001", "kind", "setback")]);
    expect(holdRate(list, corrections, D, SETTINGS).hold.cases).toBe(2);
  });
});

describe("holdRate: the findings as corrections filed them on D - 1", () => {
  const F = "bio-2026-0001";
  const casesOn = (findings: LedgerFinding[], corrections: FilingCorrection[], date: string): number =>
    holdRate(findings, corrections, date, SETTINGS).hold.cases;

  it("does not apply a correction dated D to D's metrics, and applies it the next morning", () => {
    const asSetback = [correction("C-0001", "2026-11-23", F, "kind", "setback")];
    expect(casesOn([hcase(F)], asSetback, "2026-11-23")).toBe(1);
    expect(casesOn([hcase(F)], asSetback, "2026-11-24")).toBe(0);
  });

  it("applies a correction dated D - 1 to D's metrics", () => {
    const asSetback = [correction("C-0001", "2026-11-22", F, "kind", "setback")];
    expect(casesOn([hcase(F)], asSetback, "2026-11-23")).toBe(0);
    expect(casesOn([hcase(F)], asSetback, "2026-11-22")).toBe(1);
  });

  it("drops a case refiled as a setback, an infrastructure item, a policy and people item, or with no AI role", () => {
    for (const kind of ["setback", "infrastructure", "policy_people"]) {
      expect(casesOn([hcase(F)], [correction("C-0001", "2026-06-01", F, "kind", kind)], D), kind).toBe(0);
    }
    expect(casesOn([hcase(F)], [correction("C-0001", "2026-06-01", F, "ai.role", "none")], D)).toBe(0);
  });

  it("makes a case of a policy and people item refiled as a result, and of a finding refiled with an AI role", () => {
    expect(casesOn([hcase(F, "checked", { kind: "policy_people" })], [correction("C-0001", "2026-06-01", F, "kind", "result")], D)).toBe(1);
    expect(casesOn([hcase(F, "checked", { kind: "setback" })], [correction("C-0001", "2026-06-01", F, "kind", "check")], D)).toBe(1);
    expect(casesOn([hcase(F, "checked", { ai: { role: "none", confidence: null } })], [correction("C-0001", "2026-06-01", F, "ai.role", "ai_tool")], D)).toBe(1);
  });

  it("takes the latest correction, and ignores a removed one, another finding's and a path D does not read", () => {
    const c = [
      correction("C-0001", "2026-06-01", F, "kind", "setback"),
      correction("C-0002", "2026-06-02", F, "kind", "result"),
      correction("C-0003", "2026-06-03", F, "kind", "setback", { type: "removed" }),
      correction("C-0004", "2026-06-04", "bio-2026-0002", "kind", "setback"),
      correction("C-0005", "2026-06-05", F, "significance", "watch"),
      correction("C-0006", "2026-06-05", F, "field", "physics"),
    ];
    expect(casesOn([hcase(F), hcase("bio-2026-0002")], c, D)).toBe(1);
  });
});

// ── quotable ─────────────────────────────────────────────────────────────────────────────────────

describe("ledgerQuotable", () => {
  const landmarks = (thisYear: { ai: number; all: number } | null, baseline: { ai: number; all: number }) => ({
    by_year: thisYear === null ? [{ year: 2025, ai: 7, all: 8 }] : [{ year: 2025, ai: 7, all: 8 }, { year: 2026, ...thisYear }],
    baseline,
  });
  const hold = (cases: number, held: number) => ({ cases, held, fell: 0, open: cases - held, too_few: cases < 30 });

  it("quotes this year's, the baseline's and the Hold rate's counts as 'a of b' (SPEC §5.5's '5 of 9 against 4 of 46', §5.6's '15 of 23')", () => {
    expect(ledgerQuotable(landmarks({ ai: 5, all: 9 }, { ai: 4, all: 46 }), hold(23, 15), D)).toEqual({
      "landmarks.this_year": "5 of 9",
      "landmarks.baseline": "4 of 46",
      hold: "15 of 23",
    });
  });

  it("writes thousands with a comma", () => {
    expect(ledgerQuotable(landmarks({ ai: 1000, all: 12345 }, { ai: 4, all: 1234 }), hold(1500, 1200), D)).toEqual({
      "landmarks.this_year": "1,000 of 12,345",
      "landmarks.baseline": "4 of 1,234",
      hold: "1,200 of 1,500",
    });
  });

  it("keeps a count of none out of all, not out of the figure", () => {
    expect(ledgerQuotable(landmarks({ ai: 0, all: 9 }, { ai: 0, all: 46 }), hold(30, 0), D)).toEqual({
      "landmarks.this_year": "0 of 9",
      "landmarks.baseline": "0 of 46",
      hold: "0 of 30",
    });
  });

  it("quotes a count out of one: a single Landmark this year, a single one in the baseline, a single case", () => {
    expect(ledgerQuotable(landmarks({ ai: 1, all: 1 }, { ai: 0, all: 1 }), hold(1, 0), D)).toEqual({
      "landmarks.this_year": "1 of 1",
      "landmarks.baseline": "0 of 1",
      hold: "0 of 1",
    });
  });

  it("has no entry for a count of nothing: no Landmark this year, none in the baseline, no case", () => {
    expect(ledgerQuotable(landmarks({ ai: 0, all: 0 }, { ai: 4, all: 46 }), hold(23, 15), D)).toEqual({ "landmarks.baseline": "4 of 46", hold: "15 of 23" });
    expect(ledgerQuotable(landmarks({ ai: 5, all: 9 }, { ai: 0, all: 0 }), hold(23, 15), D)).toEqual({ "landmarks.this_year": "5 of 9", hold: "15 of 23" });
    expect(ledgerQuotable(landmarks({ ai: 5, all: 9 }, { ai: 4, all: 46 }), hold(0, 0), D)).toEqual({ "landmarks.this_year": "5 of 9", "landmarks.baseline": "4 of 46" });
    expect(ledgerQuotable(landmarks({ ai: 0, all: 0 }, { ai: 0, all: 0 }), hold(0, 0), D)).toEqual({});
  });

  it("has no this-year entry when C has no row for the year of D", () => {
    expect(ledgerQuotable(landmarks(null, { ai: 4, all: 46 }), hold(23, 15), D)).toEqual({ "landmarks.baseline": "4 of 46", hold: "15 of 23" });
    expect(ledgerQuotable({ by_year: [], baseline: { ai: 0, all: 0 } }, hold(0, 0), D)).toEqual({});
  });

  it("reads the row of D's own year, whatever the other years hold", () => {
    expect(ledgerQuotable(landmarks({ ai: 5, all: 9 }, { ai: 4, all: 46 }), hold(0, 0), "2025-06-01")["landmarks.this_year"]).toBe("7 of 8");
  });

  it("uses keys that are valid metric paths, and quotes the figures of C and D as computed", () => {
    const counted = landmarkCounts([lf("bio-2026-0001"), lf("bio-2026-0002", { ai: { role: "none", confidence: null } }), lf("bio-2018-0001", { first_published: "2018-01-01" })], [], D);
    const held = holdRate([hcase("bio-2026-0003", "checked"), hcase("bio-2026-0004", "disputed")], [], D, SETTINGS);
    const quotable = ledgerQuotable(counted.landmarks, held.hold, D);
    expect(quotable).toEqual({ "landmarks.this_year": "1 of 2", "landmarks.baseline": "1 of 1", hold: "1 of 2" });
    for (const key of Object.keys(quotable)) expect(MetricPath.safeParse(key).success, key).toBe(true);
  });
});
