// lib/metrics/counters.ts (SPEC §5.7 the seven counters, §4.7 `CounterReading`, §4.10 `filedAs()` on D - 1, §4.11 `counters.json` and
// `ai-drugs.json`): every counter worked by hand from small inline data. `ai_drugs`: the exact started-status list, PHASE1 to PHASE3, a trial
// with two phases as the lower, EARLY_PHASE1, PHASE4 and NA as none, `approved` whatever the trials, an entry with no stage left out.
// `pdb_structures`: released counts plus unreleased entries by deposit year, WDRN left out. `ai_retractions`: the Retraction Watch row (built
// on the header seen on the live file), its reasons, DOIs and date, the per-year count up to the day of the reading (a row dated later is
// left out). `full_bibles`: the difference of the two newest figures. `ancient_texts_ai`: the spec's own
// list, and the corrections that refile a finding on D - 1. Then the rules that settle a day: read, failed (stale), carried, and what
// `computeCounters()` reads on a day the counters are not read. New for this project; Cyber has no counterpart.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import type { FilingCorrection } from "@/lib/items";
import {
  ANCIENT_TEXTS, COMPUTER_GENERATED, DRUG_STAGES, RETRACTION_COLUMNS, STARTED_STATUSES, WITHDRAWN_STATUS,
  aiDrugs, aiRetractionYears, aiRetractions, ancientTextsAi, computeCounters, countersDue, drugStage, erdosAi, fullBibles, isComputerGenerated,
  manualReading, mathlibTheorems, missingReading, parseRetractionRow, pdbStructures, settleCounter, trialPhase, unreleasedByYear,
  type CounterAttempt, type CounterFinding, type PreviousCounters, type RetractionRow, type TrialLookup, type TrialRecord,
} from "@/lib/metrics/counters";
import type { Counter, Drug } from "@/lib/schema/config";
import { CounterInput, CounterReading } from "@/lib/schema/metrics";
import type { RequestRecord } from "@/lib/schema/metrics";

const SEED = loadConfig(path.join(__dirname, "..", "config"));
const counter = (id: string): Counter => structuredClone(SEED.counters.counters.find((c) => c.id === id)!);
/** The em dash and en dash, built from their code points so that no source line holds one. */
/** A pattern that matches exactly this message, nothing before it and nothing after. */
const exact = (message: string): RegExp => new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

/** Freezes a value and everything in it, so any write to it throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** A reading the schema accepts, returned as it is. */
function valid(reading: CounterReading): CounterReading {
  const found = CounterReading.safeParse(reading);
  expect(found.success, found.success ? "" : JSON.stringify(found.error.issues)).toBe(true);
  return reading;
}

// ── ai_drugs ─────────────────────────────────────────────────────────────────────────────────────

const trial = (status: string | undefined, phases: readonly string[] | undefined): TrialRecord => ({
  protocolSection: { statusModule: status === undefined ? {} : { overallStatus: status }, designModule: phases === undefined ? {} : { phases } },
});
const APPROVAL: NonNullable<Drug["approved"]> = { regulator: "fda", date: "2026-02-03", source_url: "https://www.fda.gov/ut-sample-approval" };
const drug = (trials: string[], approved: Drug["approved"] = null): Pick<Drug, "trials" | "approved"> => ({ trials, approved });

describe("trialPhase: a trial counts only once it has started (SPEC §5.7)", () => {
  it("lists exactly the six statuses of §5.7 as started", () => {
    expect([...STARTED_STATUSES]).toEqual(["RECRUITING", "ENROLLING_BY_INVITATION", "ACTIVE_NOT_RECRUITING", "SUSPENDED", "TERMINATED", "COMPLETED"]);
  });

  it.each([...STARTED_STATUSES])("counts a %s phase 2 trial toward phase 2", (status) => {
    expect(trialPhase(trial(status, ["PHASE2"]))).toBe(2);
  });

  it.each(["NOT_YET_RECRUITING", "WITHDRAWN", "UNKNOWN", "NO_LONGER_AVAILABLE", "AVAILABLE", "APPROVED_FOR_MARKETING", "TEMPORARILY_NOT_AVAILABLE", "", "recruiting"])(
    "adds no phase for a trial whose status is %j", (status) => {
      expect(trialPhase(trial(status, ["PHASE3"]))).toBeNull();
    },
  );

  it("adds no phase for a trial with no status, no record or no design", () => {
    expect(trialPhase(trial(undefined, ["PHASE3"]))).toBeNull();
    expect(trialPhase(null)).toBeNull();
    expect(trialPhase({})).toBeNull();
    expect(trialPhase({ protocolSection: {} })).toBeNull();
    expect(trialPhase(trial("RECRUITING", undefined))).toBeNull();
    expect(trialPhase(trial("RECRUITING", []))).toBeNull();
  });

  it("maps PHASE1, PHASE2 and PHASE3 to 1, 2 and 3", () => {
    expect(trialPhase(trial("COMPLETED", ["PHASE1"]))).toBe(1);
    expect(trialPhase(trial("COMPLETED", ["PHASE2"]))).toBe(2);
    expect(trialPhase(trial("COMPLETED", ["PHASE3"]))).toBe(3);
  });

  it("counts a trial that lists two phases as the lower, in either order", () => {
    expect(trialPhase(trial("RECRUITING", ["PHASE1", "PHASE2"]))).toBe(1);
    expect(trialPhase(trial("RECRUITING", ["PHASE2", "PHASE1"]))).toBe(1);
    expect(trialPhase(trial("RECRUITING", ["PHASE2", "PHASE3"]))).toBe(2);
    expect(trialPhase(trial("RECRUITING", ["PHASE3", "PHASE2"]))).toBe(2);
  });

  it("counts EARLY_PHASE1, PHASE4 and NA as none", () => {
    expect(trialPhase(trial("COMPLETED", ["EARLY_PHASE1"]))).toBeNull();
    expect(trialPhase(trial("COMPLETED", ["PHASE4"]))).toBeNull();
    expect(trialPhase(trial("COMPLETED", ["NA"]))).toBeNull();
    expect(trialPhase(trial("COMPLETED", ["PHASE_9"]))).toBeNull();
    // an early phase beside a real one leaves the real one
    expect(trialPhase(trial("COMPLETED", ["EARLY_PHASE1", "PHASE1"]))).toBe(1);
  });
});

describe("drugStage: approved, else the highest phase of a started trial", () => {
  const trials: TrialLookup = new Map<string, TrialRecord | null>([
    ["NCT00000001", trial("RECRUITING", ["PHASE1"])],
    ["NCT00000002", trial("COMPLETED", ["PHASE3"])],
    ["NCT00000003", trial("NOT_YET_RECRUITING", ["PHASE3"])],
    ["NCT00000004", trial("WITHDRAWN", ["PHASE2"])],
    ["NCT00000005", trial("COMPLETED", ["PHASE4"])],
    ["NCT00000006", null],
  ]);

  it("takes the highest phase among the started trials", () => {
    expect(drugStage(drug(["NCT00000001"]), trials)).toBe("1");
    expect(drugStage(drug(["NCT00000001", "NCT00000002"]), trials)).toBe("3");
    expect(drugStage(drug(["NCT00000002", "NCT00000001"]), trials)).toBe("3");
  });

  it("leaves a trial that has not started out of the stage", () => {
    expect(drugStage(drug(["NCT00000001", "NCT00000003"]), trials)).toBe("1");
    expect(drugStage(drug(["NCT00000003"]), trials)).toBeNull();
    expect(drugStage(drug(["NCT00000004"]), trials)).toBeNull();
    expect(drugStage(drug(["NCT00000001", "NCT00000004"]), trials)).toBe("1");
  });

  it("gives no stage to a drug with no trial, only a phase 4 trial, or a trial the registry does not know", () => {
    expect(drugStage(drug([]), trials)).toBeNull();
    expect(drugStage(drug(["NCT00000005"]), trials)).toBeNull();
    expect(drugStage(drug(["NCT00000006"]), trials)).toBeNull();
  });

  it("is approved whatever its trials, with or without one", () => {
    expect(drugStage(drug([], APPROVAL), trials)).toBe("approved");
    expect(drugStage(drug(["NCT00000003"], APPROVAL), trials)).toBe("approved");
    expect(drugStage(drug(["NCT00000002"], APPROVAL), trials)).toBe("approved");
  });

  it("asks for no trial of an approved drug, and throws for the trial of another that was not asked for", () => {
    expect(drugStage(drug(["NCT09999999"], APPROVAL), trials)).toBe("approved");
    expect(() => drugStage(drug(["NCT09999999"]), trials)).toThrow(exact("No ClinicalTrials.gov answer was given for NCT09999999"));
  });
});

describe("aiDrugs: the highest stage each drug reached", () => {
  const ai = counter("ai_drugs");
  const trials: TrialLookup = new Map<string, TrialRecord | null>([
    ["NCT10000001", trial("RECRUITING", ["PHASE1"])],
    ["NCT10000002", trial("COMPLETED", ["PHASE3"])],
    ["NCT10000003", trial("ACTIVE_NOT_RECRUITING", ["PHASE1", "PHASE2"])],
    ["NCT10000004", trial("ENROLLING_BY_INVITATION", ["PHASE2"])],
    ["NCT10000005", trial("WITHDRAWN", ["PHASE3"])],
    ["NCT10000006", trial("COMPLETED", ["PHASE4"])],
    ["NCT10000007", trial("NOT_YET_RECRUITING", ["PHASE2"])],
    ["NCT10000008", trial("TERMINATED", ["PHASE1"])],
  ]);
  const drugs = [
    drug([], APPROVAL), // approved with no trial
    drug(["NCT10000007"], APPROVAL), // approved, its one trial not started
    drug(["NCT10000001", "NCT10000002"]), // phase 1 and a completed phase 3: 3
    drug(["NCT10000003"]), // phases 1 and 2: counts as 1
    drug(["NCT10000004"]), // 2
    drug(["NCT10000005"]), // withdrawn: left out
    drug([]), // no approval, no trial: left out
    drug(["NCT10000006"]), // phase 4: none, so left out
    drug(["NCT10000007", "NCT10000008"]), // a trial not yet recruiting and a terminated phase 1: 1
  ];

  it("counts each drug once at its highest stage, with a breakdown of 1, 2, 3 and approved in that order", () => {
    const r = valid(aiDrugs(ai, drugs, trials, "2026-11-23"));
    expect(r.breakdown).toEqual([{ key: "1", value: 2 }, { key: "2", value: 1 }, { key: "3", value: 1 }, { key: "approved", value: 2 }]);
    expect(r.value).toBe(6);
    expect(r).toMatchObject({ id: "ai_drugs", kind: "api", as_of: "2026-11-23", status: "ok", source_url: ai.source_url });
    expect(DRUG_STAGES).toEqual(["1", "2", "3", "approved"]);
  });

  it("reads value 0 with four zero rows for the seed's empty list of drugs", () => {
    const r = valid(aiDrugs(ai, [], trials, "2026-11-23"));
    expect(r.value).toBe(0);
    expect(r.breakdown).toEqual([{ key: "1", value: 0 }, { key: "2", value: 0 }, { key: "3", value: 0 }, { key: "approved", value: 0 }]);
  });

  it("makes value the sum of the breakdown, and an entry with no stage adds to none of it", () => {
    const r = aiDrugs(ai, [drug(["NCT10000005"]), drug([])], trials, "2026-11-23");
    expect(r.value).toBe(0);
    expect(r.breakdown.every((row) => row.value === 0)).toBe(true);
  });

  it("throws on a date that is not a date, and does not change what it reads", () => {
    expect(() => aiDrugs(ai, drugs, trials, "2026-02-30")).toThrow(/^A reading's date must be a calendar date, got "2026-02-30"$/);
    const frozenDrugs = deepFreeze(structuredClone(drugs));
    expect(() => aiDrugs(ai, frozenDrugs, trials, "2026-11-23")).not.toThrow();
  });
});

// ── full_bibles ──────────────────────────────────────────────────────────────────────────────────

describe("fullBibles: the difference of the two newest annual figures", () => {
  const fig = (as_of: string, total: number) => ({ as_of, total, source_url: `https://www.wycliffe.net/ut-sample/${as_of}` });
  const bibles = (figures: Counter["figures"]): Counter => ({ ...counter("full_bibles"), figures });

  it("gives the newest total minus the one before it, from the two newest of three figures", () => {
    const r = valid(fullBibles(bibles([fig("2023-09-30", 724), fig("2024-09-30", 756), fig("2025-09-30", 775)])));
    expect(r).toMatchObject({ id: "full_bibles", kind: "manual", value: 19, as_of: "2025-09-30", status: "ok" });
    expect(r.breakdown).toEqual([{ key: "total", value: 775 }]);
  });

  it("takes as_of and source_url from the newest figure", () => {
    const r = fullBibles(bibles([fig("2024-09-30", 756), fig("2025-09-30", 775)]));
    expect(r.source_url).toBe("https://www.wycliffe.net/ut-sample/2025-09-30");
    expect(r.value).toBe(19);
  });

  it("works with exactly two figures", () => {
    expect(fullBibles(bibles([fig("2024-09-30", 756), fig("2025-09-30", 760)])).value).toBe(4);
  });

  it("is missing, with no value, with one figure or none", () => {
    for (const figures of [[], [fig("2025-09-30", 775)]]) {
      const r = valid(fullBibles(bibles(figures)));
      expect(r).toEqual(missingReading(bibles(figures)));
      expect(r).toMatchObject({ value: null, as_of: null, breakdown: [], status: "missing", source_url: counter("full_bibles").source_url });
    }
  });

  it("reads the seed's empty figures as missing", () => {
    expect(fullBibles(counter("full_bibles")).status).toBe("missing");
  });

  it("does not clamp a total that fell", () => {
    expect(fullBibles(bibles([fig("2024-09-30", 760), fig("2025-09-30", 758)])).value).toBe(-2);
  });
});

// ── ancient_texts_ai ─────────────────────────────────────────────────────────────────────────────

const fnd = (id: string, over: Partial<CounterFinding> = {}): CounterFinding => ({
  id, field: "humanities", subfield: "ancient-texts", kind: "result", significance: "notable",
  ai: { role: "ai_solved", confidence: "confirmed" }, rung: "checked", ...over,
});
const refile = (id: string, date: string, findingId: string, p: string, after: string): FilingCorrection => ({
  id, date, finding_id: findingId, type: "update", path: p, after: { en: after },
});

describe("ancientTextsAi: humanities results in ancient texts with an AI role and a counted rung", () => {
  const ledger = counter("ancient_texts_ai");
  const D = "2026-11-23";

  it("counts a checked result in ancient-texts, and leaves out a setback, an infrastructure item and a preprint there", () => {
    const findings = [
      fnd("hum-2026-0001"),
      fnd("hum-2026-0002", { kind: "setback" }),
      fnd("hum-2026-0003", { kind: "infrastructure" }),
      fnd("hum-2026-0004", { rung: "preprint" }),
    ];
    const r = valid(ancientTextsAi(ledger, findings, [], D));
    expect(r.value).toBe(1);
    expect(r).toMatchObject({ id: "ancient_texts_ai", kind: "ledger", breakdown: [], status: "ok", source_url: ledger.source_url });
  });

  it("counts each counted rung (checked, confirmed, applied) and no other", () => {
    const rungs = ["claimed", "preprint", "checked", "confirmed", "applied", "disputed", "retracted"] as const;
    const findings = rungs.map((rung, i) => fnd(`hum-2026-${String(i + 1).padStart(4, "0")}`, { rung }));
    expect(ancientTextsAi(ledger, findings, [], D).value).toBe(3);
  });

  it("leaves out the other kinds, a finding with no AI role, another subfield and another field", () => {
    const findings = [
      fnd("hum-2026-0001", { kind: "capability" }),
      fnd("hum-2026-0002", { kind: "check" }),
      fnd("hum-2026-0003", { kind: "policy_people" }),
      fnd("hum-2026-0004", { ai: { role: "none", confidence: null } }),
      fnd("hum-2026-0005", { subfield: "theology" }),
      fnd("bio-2026-0001", { field: "biology" }),
      fnd("hum-2026-0006"),
    ];
    expect(ancientTextsAi(ledger, findings, [], D).value).toBe(1);
  });

  it("counts every AI role but none, whatever the significance", () => {
    const roles = ["ai_solved", "ai_proposed", "ai_ran", "ai_tool", "ai_checked", "none"] as const;
    const findings = roles.map((role, i) => fnd(`hum-2026-${String(i + 1).padStart(4, "0")}`, {
      ai: { role, confidence: role === "none" ? null : "claimed" }, significance: i % 2 ? "landmark" : "watch",
    }));
    expect(ancientTextsAi(ledger, findings, [], D).value).toBe(5);
  });

  it("is dated D - 1, the day it reads the filing of", () => {
    expect(ancientTextsAi(ledger, [], [], D)).toMatchObject({ value: 0, as_of: "2026-11-22" });
    expect(ancientTextsAi(ledger, [], [], "2026-03-01").as_of).toBe("2026-02-28");
  });

  it("throws on a date that is not a date", () => {
    expect(() => ancientTextsAi(ledger, [], [], "2026-02-30")).toThrow(/^The date must be a calendar date, got "2026-02-30"$/);
  });

  it("reads each finding as `filedAs()` files it on D - 1: a correction dated D - 1 counts, one dated D does not", () => {
    const moved = fnd("bio-2026-0001", { field: "biology", subfield: "proteins" });
    const toHumanities = refile("C-0001", "2026-11-22", moved.id, "field", "humanities");
    const toAncient = refile("C-0002", "2026-11-22", moved.id, "subfield", "ancient-texts");
    expect(ancientTextsAi(ledger, [moved], [toHumanities, toAncient], D).value).toBe(1);
    const late = [refile("C-0001", "2026-11-23", moved.id, "field", "humanities"), refile("C-0002", "2026-11-23", moved.id, "subfield", "ancient-texts")];
    expect(ancientTextsAi(ledger, [moved], late, D).value).toBe(0);
    expect(ancientTextsAi(ledger, [moved], late, "2026-11-24").value).toBe(1);
  });

  it("counts a humanities finding whose subfield alone becomes ancient-texts, from the day of the correction and not before", () => {
    const f = fnd("hum-2026-0001", { subfield: "theology" });
    const toAncient = refile("C-0001", "2026-11-20", f.id, "subfield", "ancient-texts");
    expect(ancientTextsAi(ledger, [f], [], D).value).toBe(0);
    expect(ancientTextsAi(ledger, [f], [toAncient], D).value).toBe(1);
    // dated D - 1 it counts in D's reading, dated D it waits for the next one
    expect(ancientTextsAi(ledger, [f], [refile("C-0001", "2026-11-22", f.id, "subfield", "ancient-texts")], D).value).toBe(1);
    expect(ancientTextsAi(ledger, [f], [refile("C-0001", "2026-11-23", f.id, "subfield", "ancient-texts")], D).value).toBe(0);
    // the latest correction at the path wins
    expect(ancientTextsAi(ledger, [f], [toAncient, refile("C-0002", "2026-11-21", f.id, "subfield", "theology")], D).value).toBe(0);
  });

  it("drops a finding that a correction refiles as a setback or with no AI role", () => {
    const f = fnd("hum-2026-0001");
    expect(ancientTextsAi(ledger, [f], [refile("C-0001", "2026-11-01", f.id, "kind", "setback")], D).value).toBe(0);
    expect(ancientTextsAi(ledger, [f], [refile("C-0001", "2026-11-01", f.id, "ai.role", "none")], D).value).toBe(0);
    expect(ancientTextsAi(ledger, [f], [refile("C-0001", "2026-11-01", f.id, "subfield", "theology")], D).value).toBe(0);
  });

  it("names the subfield the config holds, and fields.json has ancient-texts among the humanities' subfields", () => {
    expect(ANCIENT_TEXTS).toBe("ancient-texts");
    expect(SEED.index.subfields.humanities.map((s) => s.id)).toContain("ancient-texts");
    const humanities = SEED.fields.fields.find((f) => f.id === "humanities");
    expect(humanities?.subfields.some((s) => s.id === ANCIENT_TEXTS)).toBe(true);
  });

  it("changes neither the findings nor the corrections it reads", () => {
    const findings = deepFreeze([fnd("hum-2026-0001")]);
    const corrections = deepFreeze([refile("C-0001", "2026-11-01", "hum-2026-0001", "subfield", "theology")]);
    expect(ancientTextsAi(ledger, findings, corrections, D).value).toBe(0);
  });
});

// ── pdb_structures ───────────────────────────────────────────────────────────────────────────────

describe("pdbStructures: released by deposit date plus unreleased entries deposited that year", () => {
  const pdb = counter("pdb_structures");
  const unreleased = (deposit_date: string, status = "HOLD") => ({ deposit_date, status });

  it("adds the unreleased entries of each year to its released count and gives both years, last year first", () => {
    const r = valid(pdbStructures(pdb, {
      released: { "2025": 17_400, "2026": 12_000 },
      unreleased: [unreleased("2026-03-04"), unreleased("2026-09-30"), unreleased("2025-12-31"), unreleased("2025-01-01"), unreleased("2025-06-15")],
    }, "2026-11-23"));
    expect(r.breakdown).toEqual([{ key: "2025", value: 17_403 }, { key: "2026", value: 12_002 }]);
    expect(r.value).toBe(12_002);
    expect(r).toMatchObject({ id: "pdb_structures", kind: "api", as_of: "2026-11-23", status: "ok" });
  });

  it("leaves out withdrawn entries, in any case, and counts every other status", () => {
    const entries = ["WDRN", "wdrn", " Wdrn ", "HOLD", "AUCO", "AUTH", "HPUB", "PROC", "REFI", "WAIT", "POLC", "REPL"].map((s) => unreleased("2026-05-05", s));
    const r = pdbStructures(pdb, { released: { "2025": 0, "2026": 0 }, unreleased: entries }, "2026-11-23");
    expect(r.value).toBe(9);
    expect(WITHDRAWN_STATUS).toBe("WDRN");
  });

  it("ignores entries deposited in other years", () => {
    const r = pdbStructures(pdb, {
      released: { "2025": 10, "2026": 20 }, unreleased: [unreleased("2024-12-31"), unreleased("2027-01-01"), unreleased("2023-05-05")],
    }, "2026-11-23");
    expect(r.breakdown).toEqual([{ key: "2025", value: 10 }, { key: "2026", value: 20 }]);
  });

  it("reads a timestamp that starts with the deposit date, and trims it", () => {
    const r = pdbStructures(pdb, {
      released: { "2025": 0, "2026": 0 },
      unreleased: [unreleased("2026-02-01T00:00:00Z"), unreleased(" 2026-02-02 "), unreleased("2026-02-03 08:30:00")],
    }, "2026-11-23");
    expect(r.value).toBe(3);
  });

  it("takes the years from the date of the reading, last year and this year", () => {
    const r = pdbStructures(pdb, { released: { "2024": 5, "2025": 6 }, unreleased: [unreleased("2024-07-07"), unreleased("2025-07-07")] }, "2025-01-06");
    expect(r.breakdown).toEqual([{ key: "2024", value: 6 }, { key: "2025", value: 7 }]);
    expect(r.value).toBe(7);
  });

  it("throws when a count of released entries is missing or is not a count, or a deposit date is not a date", () => {
    expect(() => pdbStructures(pdb, { released: { "2026": 20 }, unreleased: [] }, "2026-11-23")).toThrow(exact("No count of released entries was given for 2025"));
    expect(() => pdbStructures(pdb, { released: { "2025": 10 }, unreleased: [] }, "2026-11-23")).toThrow(exact("No count of released entries was given for 2026"));
    expect(() => pdbStructures(pdb, { released: { "2025": -1, "2026": 2 }, unreleased: [] }, "2026-11-23")).toThrow(exact("The released count for 2025 must be a non-negative whole number, got -1"));
    expect(() => pdbStructures(pdb, { released: { "2025": 1.5, "2026": 2 }, unreleased: [] }, "2026-11-23")).toThrow(exact("The released count for 2025 must be a non-negative whole number, got 1.5"));
    for (const bad of ["", "unknown", "2026-13-01", "2026-02-30", "20260301", "26-03-01"]) {
      expect(() => pdbStructures(pdb, { released: { "2025": 1, "2026": 2 }, unreleased: [unreleased(bad)] }, "2026-11-23")).toThrow(exact(`An unreleased entry has no deposit date: ${JSON.stringify(bad)}`));
    }
    expect(() => pdbStructures(pdb, { released: { "2025": 1, "2026": 2 }, unreleased: [] }, "2026-02-30")).toThrow(/^A reading's date must be a calendar date/);
  });

  it("quotes at most 40 characters of a deposit date that is not a date, so a file read wrongly does not flood the log", () => {
    const long = "x".repeat(5_000);
    let message = "";
    try {
      unreleasedByYear([unreleased(long)], [2026]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(`An unreleased entry has no deposit date: "${"x".repeat(40)}..."`);
    // exactly 40 characters are quoted whole
    expect(() => unreleasedByYear([unreleased("y".repeat(40))], [2026])).toThrow(exact(`An unreleased entry has no deposit date: "${"y".repeat(40)}"`));
    expect(() => unreleasedByYear([unreleased("y".repeat(41))], [2026])).toThrow(exact(`An unreleased entry has no deposit date: "${"y".repeat(40)}..."`));
  });

  it("does not read the date of a withdrawn entry", () => {
    expect(() => unreleasedByYear([unreleased("never", "WDRN")], [2026])).not.toThrow();
    expect(unreleasedByYear([unreleased("never", "WDRN")], [2026])).toEqual({ "2026": 0 });
  });

  it("counts by year in unreleasedByYear", () => {
    expect(unreleasedByYear([unreleased("2025-01-01"), unreleased("2026-01-01"), unreleased("2026-12-31"), unreleased("2020-01-01")], [2025, 2026])).toEqual({ "2025": 1, "2026": 2 });
  });
});

// ── ai_retractions ───────────────────────────────────────────────────────────────────────────────

/** A Retraction Watch record as a CSV reader that keys by header gives it: every column, invented content. */
const rwRecord = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  "Record ID": "90001", Title: "SAMPLE paper, invented for tests", Subject: "(BLS) Biology - Molecular;", Institution: "SAMPLE University",
  Journal: "SAMPLE Journal", Publisher: "SAMPLE Press", Country: "Nowhere", Author: "A. Author", URLS: "",
  ArticleType: "Research Article;", RetractionDate: "3/14/2025 0:00", RetractionDOI: "10.1000/ut-sample-notice", RetractionPubMedID: "0",
  OriginalPaperDate: "1/2/2025 0:00", OriginalPaperDOI: "10.1000/UT-SAMPLE-PAPER", OriginalPaperPubMedID: "0",
  RetractionNature: "Retraction", Reason: "+Computer-Aided Content or Computer-Generated Content;+Investigation by Journal/Publisher",
  Paywalled: "No", Notes: "", ...over,
});
const row = (over: Record<string, string | undefined> = {}): RetractionRow => parseRetractionRow(rwRecord(over));

describe("parseRetractionRow: the columns of a Retraction Watch row (SPEC §5.7, §5.8)", () => {
  it("is tried on a record with the 20 columns of the header seen on the live file (K1c, 2026-11-28), whose five used columns are RETRACTION_COLUMNS", () => {
    const header = "Record ID,Title,Subject,Institution,Journal,Publisher,Country,Author,URLS,ArticleType,RetractionDate,RetractionDOI,RetractionPubMedID,"
      + "OriginalPaperDate,OriginalPaperDOI,OriginalPaperPubMedID,RetractionNature,Reason,Paywalled,Notes";
    expect(Object.keys(rwRecord())).toEqual(header.split(","));
    for (const column of RETRACTION_COLUMNS) expect(header.split(",")).toContain(column);
  });

  it("reads the reasons as the live file words them: separated by semicolons, a semicolon after the last, no plus sign", () => {
    expect(row({ Reason: "Concerns/Issues about Data;Computer-Aided Content or Computer-Generated Content;" }).reasons)
      .toEqual(["Concerns/Issues about Data", "Computer-Aided Content or Computer-Generated Content"]);
    expect(isComputerGenerated(row({ Reason: "Duplication of/in Article;" }).reasons)).toBe(false);
  });

  it("reads the five columns the spec names", () => {
    expect(RETRACTION_COLUMNS).toEqual(["RetractionNature", "Reason", "OriginalPaperDOI", "RetractionDOI", "RetractionDate"]);
    expect(row()).toEqual({
      nature: "Retraction",
      reasons: ["Computer-Aided Content or Computer-Generated Content", "Investigation by Journal/Publisher"],
      original_doi: "10.1000/ut-sample-paper",
      retraction_doi: "10.1000/ut-sample-notice",
      retraction_date: "2025-03-14",
    });
  });

  it("splits the reason at semicolons, drops each leading plus sign and every empty part, and keeps the words", () => {
    expect(row({ Reason: "+A reason;+Another reason;" }).reasons).toEqual(["A reason", "Another reason"]);
    expect(row({ Reason: "  + A ;; + B  ; ; " }).reasons).toEqual(["A", "B"]);
    expect(row({ Reason: "" }).reasons).toEqual([]);
    expect(row({ Reason: "No plus sign" }).reasons).toEqual(["No plus sign"]);
  });

  it("stores each DOI as §4.1 does: lower case, without a resolver, and null when it is none", () => {
    expect(row({ OriginalPaperDOI: "https://doi.org/10.1000/ABC.DEF" }).original_doi).toBe("10.1000/abc.def");
    expect(row({ RetractionDOI: " DOI:10.2000/X " }).retraction_doi).toBe("10.2000/x");
    for (const none of ["", "unavailable", "Unavailable", "not a doi", "https://example.org/notice"]) {
      expect(row({ OriginalPaperDOI: none, RetractionDOI: none })).toMatchObject({ original_doi: null, retraction_doi: null });
    }
  });

  it("reads the retraction date from M/D/YYYY and from YYYY-MM-DD, with or without a time", () => {
    expect(row({ RetractionDate: "3/4/2025 0:00" }).retraction_date).toBe("2025-03-04");
    expect(row({ RetractionDate: "12/31/2024" }).retraction_date).toBe("2024-12-31");
    expect(row({ RetractionDate: "2025-03-04" }).retraction_date).toBe("2025-03-04");
    expect(row({ RetractionDate: "2025-03-04 00:00:00" }).retraction_date).toBe("2025-03-04");
    expect(row({ RetractionDate: "2025-03-04T01:02:03Z" }).retraction_date).toBe("2025-03-04");
    for (const bad of ["", "unknown", "13/1/2025", "2/30/2025", "2025-13-01", "2025/03/04", "March 2025", "3/4/25"]) {
      expect(row({ RetractionDate: bad }).retraction_date, bad).toBeNull();
    }
  });

  it("trims the nature", () => {
    expect(row({ RetractionNature: " Expression of concern " }).nature).toBe("Expression of concern");
  });

  it.each([...RETRACTION_COLUMNS])("throws when the %s column is missing, and not when it is empty", (column) => {
    expect(() => parseRetractionRow(rwRecord({ [column]: undefined }))).toThrow(exact(`The Retraction Watch row has no ${column} column`));
    expect(() => parseRetractionRow(rwRecord({ [column]: "" }))).not.toThrow();
  });
});

describe("isComputerGenerated: a reason that includes computer-generated content", () => {
  it("matches the phrase whatever the case, hyphens and spacing", () => {
    expect(COMPUTER_GENERATED).toBe("computer generated content");
    for (const r of [
      "Computer-Aided Content or Computer-Generated Content", "Computer Aided Content or Computer Generated Content", "computer generated content",
      "COMPUTER-GENERATED   CONTENT", `Computer${EN}Generated Content`, "Computer_Generated Content", "Concern over computer-generated content in figures",
    ]) {
      expect(isComputerGenerated([r]), r).toBe(true);
    }
  });

  it("matches one reason among several, and none of the other reasons the file lists", () => {
    expect(isComputerGenerated(["Investigation by Journal/Publisher", "Computer-Generated Content"])).toBe(true);
    for (const r of ["Computer-Aided Content", "Computer Generated Image", "Paper Mill", "Falsification/Fabrication of Data", "Concerns/Issues About Referencing/Attributions", "Content generated by a computer", ""]) {
      expect(isComputerGenerated([r]), r).toBe(false);
    }
    expect(isComputerGenerated([])).toBe(false);
  });
});

describe("aiRetractions: retractions per year whose reason includes computer-generated content", () => {
  const rw = counter("ai_retractions");
  const ai = (RetractionDate: string, over: Record<string, string | undefined> = {}) => row({ RetractionDate, ...over });

  it("counts by the year of RetractionDate, this year as the value and last year and this year as the breakdown", () => {
    const rows = [
      ai("3/14/2025"), ai("12/31/2025"), ai("1/1/2026"), ai("5/5/2026"), ai("11/20/2026"),
      ai("6/6/2024"), ai("2027-01-01"),
    ];
    const r = valid(aiRetractions(rw, rows, "2026-11-23"));
    expect(r.breakdown).toEqual([{ key: "2025", value: 2 }, { key: "2026", value: 3 }]);
    expect(r.value).toBe(3);
    expect(r).toMatchObject({ id: "ai_retractions", kind: "api", as_of: "2026-11-23", status: "ok" });
  });

  it("counts only rows whose nature is Retraction", () => {
    const rows = [
      ai("5/5/2026"), ai("5/5/2026", { RetractionNature: "retraction" }), ai("5/5/2026", { RetractionNature: "Correction" }),
      ai("5/5/2026", { RetractionNature: "Expression of concern" }), ai("5/5/2026", { RetractionNature: "Reinstatement" }), ai("5/5/2026", { RetractionNature: "" }),
    ];
    expect(aiRetractions(rw, rows, "2026-11-23").value).toBe(2);
  });

  it("counts only rows whose reason includes computer-generated content", () => {
    const rows = [
      ai("5/5/2026"), ai("5/5/2026", { Reason: "+Paper Mill" }), ai("5/5/2026", { Reason: "" }), ai("5/5/2026", { Reason: "+Falsification/Fabrication of Data;+Computer Generated Content" }),
    ];
    expect(aiRetractions(rw, rows, "2026-11-23").value).toBe(2);
  });

  it("counts a qualifying row with no readable date apart, in `undated`, and in no year", () => {
    const rows = [ai("5/5/2026"), ai("unknown"), ai(""), ai("unknown", { Reason: "+Paper Mill" })];
    expect(aiRetractionYears(rows, "2026-11-23")).toEqual({ by_year: { "2026": 1 }, undated: 2, future: 0 });
    expect(aiRetractions(rw, rows, "2026-11-23").value).toBe(1);
  });

  it("leaves out a row dated after the day of the reading, as the file holds one dated in 2027, and counts it apart in `future`", () => {
    const rows = [ai("11/23/2026"), ai("11/24/2026"), ai("12/31/2026"), ai("8/27/2027"), ai("11/22/2026"), ai("11/24/2026", { Reason: "+Paper Mill" })];
    expect(aiRetractionYears(rows, "2026-11-23")).toEqual({ by_year: { "2026": 2 }, undated: 0, future: 3 });
    const r = aiRetractions(rw, rows, "2026-11-23");
    expect(r.value).toBe(2);
    expect(r.breakdown).toEqual([{ key: "2025", value: 0 }, { key: "2026", value: 2 }]);
    // the same file read a month later counts the rows of that month
    expect(aiRetractions(rw, rows, "2026-12-31").value).toBe(4);
    // a row dated in the year after the reading never reaches the breakdown, which holds last year and this year only
    expect(aiRetractions(rw, [ai("8/27/2027")], "2026-11-23").breakdown).toEqual([{ key: "2025", value: 0 }, { key: "2026", value: 0 }]);
    expect(() => aiRetractionYears(rows, "2026-02-30")).toThrow(exact('The last day counted must be a calendar date, got "2026-02-30"'));
  });

  it("gives 0 for a year with no retraction, and throws for a file with no rows", () => {
    const r = aiRetractions(rw, [ai("5/5/2020")], "2026-11-23");
    expect(r.breakdown).toEqual([{ key: "2025", value: 0 }, { key: "2026", value: 0 }]);
    expect(r.value).toBe(0);
    expect(() => aiRetractions(rw, [], "2026-11-23")).toThrow(/^The Retraction Watch file holds no rows$/);
  });

  it("throws on a date that is not a date, before it reads a row", () => {
    expect(() => aiRetractions(rw, [ai("5/5/2020")], "2026-02-30")).toThrow(/^A reading's date must be a calendar date/);
    expect(() => aiRetractions(rw, [], "2026-02-30")).toThrow(/^A reading's date must be a calendar date/);
  });

  it("does not change the rows it reads", () => {
    expect(aiRetractions(rw, deepFreeze([ai("5/5/2026")]), "2026-11-23").value).toBe(1);
  });
});

// ── erdos_ai and mathlib_theorems ────────────────────────────────────────────────────────────────

describe("erdosAi and mathlibTheorems", () => {
  const erdos = counter("erdos_ai");
  const problem = (id: string, solved: boolean, ai_credit: boolean) => ({ id, solved, ai_credit });

  it("counts the problems that are solved and credit AI", () => {
    const r = valid(erdosAi(erdos, [problem("1", true, true), problem("2", true, false), problem("3", false, true), problem("4", false, false), problem("5", true, true)], "2026-11-23"));
    expect(r.value).toBe(2);
    expect(r).toMatchObject({ id: "erdos_ai", kind: "api", breakdown: [], as_of: "2026-11-23", status: "ok" });
    expect(erdosAi(erdos, [], "2026-11-23").value).toBe(0);
  });

  it("throws on a problem listed twice", () => {
    expect(() => erdosAi(erdos, [problem("7", true, true), problem("7", true, true)], "2026-11-23")).toThrow(exact("Erdős problem 7 is listed twice"));
  });

  it("reads mathlib's number of theorems", () => {
    const r = valid(mathlibTheorems(counter("mathlib_theorems"), 218_450, "2026-11-23"));
    expect(r).toMatchObject({ id: "mathlib_theorems", kind: "api", value: 218_450, breakdown: [], as_of: "2026-11-23", status: "ok" });
    expect(mathlibTheorems(counter("mathlib_theorems"), 0, "2026-11-23").value).toBe(0);
  });

  it("refuses a number of theorems that is not a count", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => mathlibTheorems(counter("mathlib_theorems"), bad, "2026-11-23")).toThrow(exact(`The number of theorems must be a non-negative whole number, got ${bad}`));
    }
    expect(() => mathlibTheorems(counter("mathlib_theorems"), 5, "2026-02-30")).toThrow(/^A reading's date must be a calendar date/);
  });
});

// ── manual and missing readings ──────────────────────────────────────────────────────────────────

describe("manualReading and missingReading", () => {
  it("shows a manual counter's own value and date from the config", () => {
    const erdos: Counter = { ...counter("erdos_ai"), kind: "manual", value: 41, as_of: "2026-11-02" };
    const r = valid(manualReading(erdos));
    expect(r).toEqual({ id: "erdos_ai", kind: "manual", value: 41, as_of: "2026-11-02", breakdown: [], source_url: erdos.source_url, status: "ok" });
  });

  it("is missing when the config has no value", () => {
    const erdos: Counter = { ...counter("erdos_ai"), kind: "manual" };
    expect(valid(manualReading(erdos))).toEqual(missingReading(erdos));
    expect(missingReading(erdos)).toEqual({ id: "erdos_ai", kind: "manual", value: null, as_of: null, breakdown: [], source_url: erdos.source_url, status: "missing" });
  });

  it("is missing when the config has only one of the value and its date", () => {
    const base: Counter = { ...counter("erdos_ai"), kind: "manual" };
    expect(manualReading({ ...base, value: 41, as_of: null })).toEqual(missingReading(base));
    expect(manualReading({ ...base, value: null, as_of: "2026-11-02" })).toEqual(missingReading(base));
    expect(manualReading({ ...base, value: 0, as_of: "2026-11-02" })).toMatchObject({ value: 0, as_of: "2026-11-02", status: "ok" });
  });
});

// ── Settling a day (§5.7: carried, stale) ────────────────────────────────────────────────────────

const REQ: RequestRecord = { url: "https://example.org/ut-sample", fetched_at: "2026-11-16T03:16:00+08:00", sha256: "a".repeat(64) };
const REQ2: RequestRecord = { url: "https://example.org/ut-sample-2", fetched_at: "2026-11-23T03:16:00+08:00", sha256: "b".repeat(64) };
const mathlib = counter("mathlib_theorems");
const lastWeek = (over: Partial<CounterReading> = {}): CounterReading => ({
  id: "mathlib_theorems", kind: "api", value: 100, as_of: "2026-11-16", breakdown: [], source_url: mathlib.source_url, status: "ok", ...over,
});
const prevOf = (reading: CounterReading, requests: RequestRecord[] = [REQ]): PreviousCounters => ({
  readings: [reading], inputs: [{ id: reading.id, requests, value: reading.value }],
});

describe("settleCounter: read, failed and not read today", () => {
  it("takes a reading from its attempt, with the requests behind it", () => {
    const reading = mathlibTheorems(mathlib, 120, "2026-11-23");
    const attempt: CounterAttempt = { outcome: "read", reading, requests: [REQ2] };
    const s = settleCounter(mathlib, attempt, prevOf(lastWeek()));
    expect(s.reading).toEqual(reading);
    expect(s.input).toEqual({ id: "mathlib_theorems", requests: [REQ2], value: 120 });
    expect(CounterInput.safeParse(s.input).success).toBe(true);
  });

  it("keeps the last reading with status stale and its own as_of when the source failed", () => {
    const s = settleCounter(mathlib, { outcome: "failed" }, prevOf(lastWeek()));
    expect(s.reading).toEqual(lastWeek({ status: "stale" }));
    expect(s.reading.as_of).toBe("2026-11-16");
    expect(s.reading.value).toBe(100);
    valid(s.reading);
  });

  it("keeps the last reading's breakdown when it goes stale", () => {
    const pdbRow: CounterReading = {
      id: "pdb_structures", kind: "api", value: 5, as_of: "2026-11-16", breakdown: [{ key: "2025", value: 4 }, { key: "2026", value: 5 }],
      source_url: counter("pdb_structures").source_url, status: "ok",
    };
    expect(settleCounter(counter("pdb_structures"), { outcome: "failed" }, prevOf(pdbRow)).reading.breakdown).toEqual(pdbRow.breakdown);
  });

  it("keeps the requests that the carried figure came from, for a stale counter and a carried one", () => {
    expect(settleCounter(mathlib, { outcome: "failed" }, prevOf(lastWeek())).input).toEqual({ id: "mathlib_theorems", requests: [REQ], value: 100 });
    expect(settleCounter(mathlib, undefined, prevOf(lastWeek())).input).toEqual({ id: "mathlib_theorems", requests: [REQ], value: 100 });
  });

  it("stays stale, with its own date, when it fails again", () => {
    const s = settleCounter(mathlib, { outcome: "failed" }, prevOf(lastWeek({ status: "stale", as_of: "2026-11-09" })));
    expect(s.reading).toMatchObject({ status: "stale", as_of: "2026-11-09", value: 100 });
  });

  it("is missing, with no value and no requests, when it failed and there is no earlier reading", () => {
    for (const previous of [null, { readings: [], inputs: [] }]) {
      const s = settleCounter(mathlib, { outcome: "failed" }, previous);
      expect(s.reading).toEqual(missingReading(mathlib));
      expect(s.input).toEqual({ id: "mathlib_theorems", requests: [], value: null });
    }
    expect(settleCounter(mathlib, { outcome: "failed" }, prevOf(lastWeek({ value: null, as_of: null, status: "missing" }))).reading.status).toBe("missing");
  });

  it("carries the last reading as it was when it was not read today: ok stays ok with its own as_of", () => {
    const s = settleCounter(mathlib, undefined, prevOf(lastWeek()));
    expect(s.reading).toEqual(lastWeek());
    expect(settleCounter(mathlib, undefined, prevOf(lastWeek({ status: "stale" }))).reading.status).toBe("stale");
  });

  it("is missing when it was not read and there is no earlier reading", () => {
    expect(settleCounter(mathlib, undefined, null).reading).toEqual(missingReading(mathlib));
  });

  it("finds its own reading among others, and takes its kind and source_url from today's config", () => {
    const other: CounterReading = { ...lastWeek(), id: "erdos_ai", value: 9 };
    const previous: PreviousCounters = {
      readings: [other, lastWeek({ kind: "manual", source_url: "https://example.org/old" })],
      inputs: [{ id: "erdos_ai", requests: [REQ2], value: 9 }, { id: "mathlib_theorems", requests: [REQ], value: 100 }],
    };
    const s = settleCounter(mathlib, undefined, previous);
    expect(s.reading).toMatchObject({ id: "mathlib_theorems", value: 100, kind: "api", source_url: mathlib.source_url });
    expect(s.input.requests).toEqual([REQ]);
  });

  it("refuses an attempt whose reading is another counter's or is not ok", () => {
    const erdosReading = erdosAi(counter("erdos_ai"), [], "2026-11-23");
    const message = "The attempt for mathlib_theorems holds a reading that is not its own, ok reading";
    expect(() => settleCounter(mathlib, { outcome: "read", reading: erdosReading, requests: [] }, null)).toThrow(exact(message));
    expect(() => settleCounter(mathlib, { outcome: "read", reading: lastWeek({ status: "stale" }), requests: [] }, null)).toThrow(exact(message));
  });

  it("does not change what it reads", () => {
    const previous = deepFreeze(prevOf(lastWeek()));
    expect(settleCounter(mathlib, { outcome: "failed" }, previous).reading.status).toBe("stale");
    expect(previous.readings[0]!.status).toBe("ok");
  });
});

describe("countersDue: counters are read on Mondays, and when forced", () => {
  it("is true on a Monday and false on every other day", () => {
    expect(countersDue("2026-11-23")).toBe(true);
    for (const d of ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]) expect(countersDue(d)).toBe(false);
  });

  it("is true on any day when forced (`metrics --counters`)", () => {
    expect(countersDue("2026-11-25", true)).toBe(true);
    expect(countersDue("2026-11-25", false)).toBe(false);
  });
});

describe("computeCounters: the seven readings of a day", () => {
  const configCounters = SEED.counters.counters;
  const MONDAY = "2026-11-23";
  const TUESDAY = "2026-11-24";
  const ok = (id: string, over: Partial<CounterReading> = {}): CounterReading => {
    const c = counter(id);
    return { id, kind: c.kind, value: 7, as_of: "2026-11-16", breakdown: [], source_url: c.source_url, status: "ok", ...over };
  };
  const attemptFor = (reading: CounterReading, requests: RequestRecord[] = [REQ2]): CounterAttempt => ({ outcome: "read", reading, requests });
  const previousWeek: PreviousCounters = {
    readings: [ok("erdos_ai"), ok("mathlib_theorems", { value: 100 }), ok("ai_drugs", { value: 20 }), ok("pdb_structures", { value: 300 }), ok("ai_retractions", { value: 400 }), ok("ancient_texts_ai", { value: 2, as_of: "2026-11-15" })],
    inputs: ["erdos_ai", "mathlib_theorems", "ai_drugs", "pdb_structures", "ai_retractions"].map((id) => ({ id, requests: [REQ], value: id === "mathlib_theorems" ? 100 : id === "ai_drugs" ? 20 : id === "pdb_structures" ? 300 : id === "ai_retractions" ? 400 : 7 })),
  };
  const run = (over: Partial<Parameters<typeof computeCounters>[0]> = {}) => computeCounters({
    counters: configCounters, date: MONDAY, readToday: true, attempts: {}, previous: null, findings: [], corrections: [], ...over,
  });

  it("returns one reading and one manifest row for each counter, in the config's order", () => {
    const r = run();
    expect(r.readings.map((x) => x.id)).toEqual(configCounters.map((c) => c.id));
    expect(r.inputs.map((x) => x.id)).toEqual(configCounters.map((c) => c.id));
    for (const reading of r.readings) valid(reading);
    for (const input of r.inputs) expect(CounterInput.safeParse(input).success).toBe(true);
  });

  it("reads each API counter from its attempt on a day it is read", () => {
    const attempts = { mathlib_theorems: attemptFor(mathlibTheorems(mathlib, 150, MONDAY)), erdos_ai: attemptFor(erdosAi(counter("erdos_ai"), [], MONDAY), [REQ]) };
    const r = run({ attempts, previous: previousWeek });
    const m = r.readings.find((x) => x.id === "mathlib_theorems")!;
    expect(m).toMatchObject({ value: 150, as_of: MONDAY, status: "ok" });
    expect(r.inputs.find((x) => x.id === "mathlib_theorems")).toEqual({ id: "mathlib_theorems", requests: [REQ2], value: 150 });
    expect(r.readings.find((x) => x.id === "erdos_ai")).toMatchObject({ value: 0, as_of: MONDAY });
  });

  it("keeps the last reading of an API counter stale when its attempt failed, and says so in the log", () => {
    const r = run({ attempts: { ai_drugs: { outcome: "failed" } }, previous: previousWeek });
    expect(r.readings.find((x) => x.id === "ai_drugs")).toMatchObject({ value: 20, as_of: "2026-11-16", status: "stale" });
    expect(r.log).toContain("Counter ai_drugs: its source failed, the reading of 2026-11-16 is kept.");
  });

  it("carries an API counter that has no attempt, on a Tuesday, with its own as_of and status", () => {
    const r = run({ date: TUESDAY, readToday: false, previous: previousWeek });
    expect(r.readings.find((x) => x.id === "pdb_structures")).toEqual(ok("pdb_structures", { value: 300 }));
    expect(r.inputs.find((x) => x.id === "pdb_structures")).toEqual({ id: "pdb_structures", requests: [REQ], value: 300 });
  });

  it("has no reading for an API counter with no attempt and no earlier reading, and says so", () => {
    const r = run();
    expect(r.readings.find((x) => x.id === "erdos_ai")).toEqual(missingReading(counter("erdos_ai")));
    expect(r.log).toContain("Counter erdos_ai: no reading.");
  });

  it("reads full_bibles from its figures every day, and it is missing with fewer than two", () => {
    const withFigures = configCounters.map((c) => (c.id === "full_bibles"
      ? { ...c, figures: [{ as_of: "2024-09-30", total: 756, source_url: "https://www.wycliffe.net/ut-sample/a" }, { as_of: "2025-09-30", total: 775, source_url: "https://www.wycliffe.net/ut-sample/b" }] }
      : c));
    for (const [date, readToday] of [[MONDAY, true], [TUESDAY, false]] as const) {
      const r = run({ counters: withFigures, date, readToday });
      expect(r.readings.find((x) => x.id === "full_bibles")).toMatchObject({ value: 19, as_of: "2025-09-30", status: "ok" });
      expect(r.inputs.find((x) => x.id === "full_bibles")).toEqual({ id: "full_bibles", requests: [], value: 19 });
    }
    expect(run().readings.find((x) => x.id === "full_bibles")!.status).toBe("missing");
  });

  it("reads a manual counter other than full_bibles from the config every day, so a pull request shows at once", () => {
    const manualErdos = configCounters.map((c) => (c.id === "erdos_ai" ? { ...c, kind: "manual" as const, value: 41, as_of: "2026-11-20" } : c));
    for (const [date, readToday] of [[MONDAY, true], [TUESDAY, false]] as const) {
      const r = run({ counters: manualErdos, date, readToday, previous: previousWeek });
      expect(r.readings.find((x) => x.id === "erdos_ai")).toEqual({ id: "erdos_ai", kind: "manual", value: 41, as_of: "2026-11-20", breakdown: [], source_url: counter("erdos_ai").source_url, status: "ok" });
      expect(r.inputs.find((x) => x.id === "erdos_ai")).toEqual({ id: "erdos_ai", requests: [], value: 41 });
    }
  });

  it("computes the ledger counter on a day the counters are read, and carries it on another", () => {
    const f = fnd("hum-2026-0001");
    const monday = run({ findings: [f], previous: previousWeek });
    expect(monday.readings.find((x) => x.id === "ancient_texts_ai")).toMatchObject({ value: 1, as_of: "2026-11-22", status: "ok" });
    expect(monday.inputs.find((x) => x.id === "ancient_texts_ai")).toEqual({ id: "ancient_texts_ai", requests: [], value: 1 });
    const tuesday = run({ date: TUESDAY, readToday: false, findings: [f], previous: previousWeek });
    expect(tuesday.readings.find((x) => x.id === "ancient_texts_ai")).toMatchObject({ value: 2, as_of: "2026-11-15", status: "ok" });
    expect(run({ date: TUESDAY, readToday: false, findings: [f] }).readings.find((x) => x.id === "ancient_texts_ai")!.status).toBe("missing");
  });

  it("counts a finding refiled by a correction from the first Monday reading after the correction's date (§4.10)", () => {
    const f = fnd("bio-2026-0001", { field: "biology", subfield: "proteins" });
    const corrections = [refile("C-0001", "2026-11-25", f.id, "field", "humanities"), refile("C-0002", "2026-11-25", f.id, "subfield", "ancient-texts")];
    const prior: PreviousCounters = { readings: [ok("ancient_texts_ai", { value: 0, as_of: "2026-11-22" })], inputs: [] };
    // Wednesday the correction is dated, Thursday the morning after: both days carry Monday's reading
    for (const date of ["2026-11-25", "2026-11-26", "2026-11-29"]) {
      expect(run({ date, readToday: false, findings: [f], corrections, previous: prior }).readings.find((x) => x.id === "ancient_texts_ai")).toMatchObject({ value: 0, as_of: "2026-11-22" });
    }
    // The next Monday reads it, as filed on Sunday 2026-11-29
    expect(run({ date: "2026-11-30", readToday: true, findings: [f], corrections, previous: prior }).readings.find((x) => x.id === "ancient_texts_ai")).toMatchObject({ value: 1, as_of: "2026-11-29" });
    // and a forced reading on a Thursday reads it too (`metrics --counters`)
    expect(run({ date: "2026-11-26", readToday: countersDue("2026-11-26", true), findings: [f], corrections, previous: prior }).readings.find((x) => x.id === "ancient_texts_ai")).toMatchObject({ value: 1, as_of: "2026-11-25" });
  });

  it("counts a humanities finding whose subfield becomes ancient-texts from the first Monday reading after the correction's date (§4.10)", () => {
    const f = fnd("hum-2026-0001", { subfield: "theology" });
    const corrections = [refile("C-0001", "2026-11-26", f.id, "subfield", "ancient-texts")];
    const prior: PreviousCounters = { readings: [ok("ancient_texts_ai", { value: 0, as_of: "2026-11-22" })], inputs: [] };
    for (const date of ["2026-11-26", "2026-11-27", "2026-12-06"]) {
      expect(run({ date, readToday: countersDue(date), findings: [f], corrections, previous: prior }).readings.find((x) => x.id === "ancient_texts_ai"), date)
        .toMatchObject({ value: 0, as_of: "2026-11-22" });
    }
    expect(run({ date: "2026-11-30", readToday: countersDue("2026-11-30"), findings: [f], corrections, previous: prior }).readings.find((x) => x.id === "ancient_texts_ai"))
      .toMatchObject({ value: 1, as_of: "2026-11-29" });
  });

  it("refuses a ledger counter that is not ancient_texts_ai", () => {
    const odd = configCounters.map((c) => (c.id === "erdos_ai" ? { ...c, kind: "ledger" as const } : c));
    expect(() => run({ counters: odd })).toThrow(exact("There is no ledger reading for erdos_ai"));
  });

  it("throws on a date that is not a date", () => {
    expect(() => run({ date: "2026-02-30" })).toThrow(/^The date must be a calendar date, got "2026-02-30"$/);
  });

  it("does not change what it reads", () => {
    const frozen = deepFreeze({ counters: structuredClone(configCounters), previous: structuredClone(previousWeek), findings: [fnd("hum-2026-0001")] });
    const r = computeCounters({
      counters: frozen.counters, date: TUESDAY, readToday: false, attempts: deepFreeze({ ai_drugs: { outcome: "failed" } }), previous: frozen.previous,
      findings: frozen.findings, corrections: [],
    });
    expect(r.readings).toHaveLength(7);
  });

  it("never writes a dash that the spec bans, in a log line or a reading", () => {
    const r = run({ attempts: { ai_drugs: { outcome: "failed" } }, previous: previousWeek });
    expect(JSON.stringify([r.readings, r.inputs, r.log])).not.toContain(EM);
  });
});
