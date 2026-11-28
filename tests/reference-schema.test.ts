// lib/schema/reference.ts (SPEC Appendix D, §10 P2 step 6): the schema of fixtures/reference/pace-reference.json and the index of
// fixtures/openalex/. Every field has a valid case and the ways it can be wrong; the facts a value states about itself (a printed
// share is fmtPct1 of its counts, the pooled cell is the seven fields added up, A's papers are among B's, the dates agree with the
// data cutoff's rule, the index's URLs are the Pace's group-by URLs with their file named by kind and week) each have a case that
// fails on its own. The sample below is hand-made: invented counts, with every printed share worked here from its counts by the
// formula of SPEC §5.2, not by the code under test. The real files are written by the backfill's stage (wave 2).
// New for this project; Cyber's reference fixtures have another shape.
import { describe, expect, it } from "vitest";
import { jsonText } from "@/lib/json";
import {
  KnownDifference, OpenAlexFixtureEntry, OpenAlexFixtureIndex, PaceReferenceFile, ReferenceCell, ReferenceTally, ReferenceTallySet, openalexFixtureWeeks,
  paceRequestOf, referenceWeeks,
} from "@/lib/schema";
import { FIELDS, type FieldId } from "@/lib/vocab";
import { groupByUrl, paceFilter, weekRequests, type PaceQuery } from "@/scripts/lib/openalex";

// ── The sample ───────────────────────────────────────────────────────────────────────────────────

/** SPEC §5.2's pct1 worked by hand: floor((2000k + n) / (2n)) tenths of a percent, printed with its decimal. */
const printed = (k: number, n: number): string | null => {
  if (n === 0) return null;
  const tenths = Math.floor((2000 * k + n) / (2 * n));
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
};
const tally = (k: number, n: number) => ({ k, n, share: printed(k, n) });
type T = ReturnType<typeof tally>;

const sum = (ts: T[]): T => tally(ts.reduce((s, t) => s + t.k, 0), ts.reduce((s, t) => s + t.n, 0));

/** [baseline, window, year-ago] counts of A for each field: [k, n]. Humanities has no papers in the leading journals. */
const LEADING: Record<FieldId, [[number, number], [number, number], [number, number]]> = {
  mathematics: [[10, 200], [12, 100], [8, 100]],
  physics: [[30, 600], [50, 500], [40, 500]],
  chemistry: [[20, 500], [40, 450], [30, 450]],
  biology: [[40, 900], [110, 800], [70, 800]],
  earth: [[10, 300], [25, 250], [15, 250]],
  social: [[8, 250], [30, 220], [12, 220]],
  humanities: [[0, 0], [0, 0], [0, 0]],
};
/** B holds A's papers and more. */
const ALL = Object.fromEntries(FIELDS.map((f) => [f, LEADING[f].map(([k, n]) => [k * 20 + 5, n * 30 + 100])])) as typeof LEADING;

function tallySet(table: typeof LEADING, part: 0 | 1 | 2) {
  const by = Object.fromEntries(FIELDS.map((f) => [f, tally(...table[f][part])])) as Record<FieldId, T>;
  return { pooled: sum(FIELDS.map((f) => by[f])), by_field: by };
}

const VERDICTS: Record<FieldId, ["higher" | "lower" | "no_clear_change" | "too_few", "up" | "level" | "down" | "too_few"]> = {
  mathematics: ["no_clear_change", "level"],
  physics: ["higher", "up"],
  chemistry: ["higher", "up"],
  biology: ["higher", "up"],
  earth: ["too_few", "too_few"],
  social: ["higher", "down"],
  humanities: ["too_few", "too_few"],
};

function cellSet(table: typeof LEADING) {
  const win = tallySet(table, 1);
  const ago = tallySet(table, 2);
  const by = Object.fromEntries(FIELDS.map((f) => [f, { window: win.by_field[f], year_ago: ago.by_field[f], vs_baseline: VERDICTS[f][0], vs_year_ago: VERDICTS[f][1] }]));
  return { pooled: { window: win.pooled, year_ago: ago.pooled, vs_baseline: "higher", vs_year_ago: "up" }, by_field: by };
}

/** The edition of 2026-11-28 (a Saturday): cutoff Sunday 2026-11-22, provisional 2026-09-28 to 11-22, window 2026-06-29 to 09-27. */
function sample() {
  return {
    schema_version: 1,
    inputs: { edition_date: "2026-11-28", data_cutoff: "2026-11-22", versions: { ai_terms: 2, journals: 3, fields: 1, counters: 1 }, requests: 2486 },
    baseline: { from: "2015-01-05", to: "2019-12-29", leading: tallySet(LEADING, 0), all: tallySet(ALL, 0) },
    pace: {
      window: { from: "2026-06-29", to: "2026-09-27" },
      provisional_from: "2026-09-28",
      year_ago: { from: "2025-06-30", to: "2025-09-28" },
      leading: cellSet(LEADING),
      all: cellSet(ALL),
      sentence: { en: "The Pace: 9.1% of papers in leading journals named AI methods.", zh: "進度：主要期刊有 9.1% 的論文提到 AI 方法。" },
    },
    landmarks: {
      by_year: [{ year: 2015, ai: 1, all: 6 }, { year: 2016, ai: 2, all: 9 }, { year: 2017, ai: 0, all: 0 }],
      baseline: { ai: 3, all: 15 },
    },
    hold: { cases: 0, held: 0, fell: 0, open: 0, too_few: true },
    known_differences: [{ figure: "pace.leading.pooled.window", what: "A later run reads a larger count", why: "OpenAlex adds papers to a week for weeks after it ends" }],
  };
}

type Sample = ReturnType<typeof sample>;
// The tests below reach into the sample by path, so it is typed loosely.
type Loose = any;

/** The issues of `value` as "path: message" lines. */
function issues(value: unknown, schema: { safeParse(v: unknown): { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } } = PaceReferenceFile): string[] {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error!.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
}

/** The sample with `edit` applied to a copy. */
function edited(edit: (s: Loose) => void): Sample {
  const copy = structuredClone(sample());
  edit(copy);
  return copy;
}

describe("the sample is itself a valid reference file", () => {
  it("R1: the hand-made sample passes, and its printed shares are the ones worked by hand", () => {
    expect(issues(sample())).toEqual([]);
    const s = sample();
    // 8.4%: 84 of 1,000; 12.5%: 1 of 8; 100.0% and 0.0% at the ends; a tie rounds up (1 of 16 is 6.25, printed 6.3).
    expect(printed(84, 1000)).toBe("8.4%");
    expect(printed(1, 8)).toBe("12.5%");
    expect(printed(8, 8)).toBe("100.0%");
    expect(printed(0, 5)).toBe("0.0%");
    expect(printed(1, 16)).toBe("6.3%");
    expect(printed(3, 0)).toBeNull();
    expect(s.baseline.leading.pooled).toEqual({ k: 118, n: 2750, share: "4.3%" });
    expect(s.baseline.leading.by_field.humanities).toEqual({ k: 0, n: 0, share: null });
  });

  it("R2: the key order of the file is the schema's: parsing and printing keeps every level in the order Appendix D lists it", () => {
    const parsed = PaceReferenceFile.parse(sample());
    expect(Object.keys(parsed)).toEqual(["schema_version", "inputs", "baseline", "pace", "landmarks", "hold", "known_differences"]);
    expect(Object.keys(parsed.inputs)).toEqual(["edition_date", "data_cutoff", "versions", "requests"]);
    expect(Object.keys(parsed.inputs.versions)).toEqual(["ai_terms", "journals", "fields", "counters"]);
    expect(Object.keys(parsed.baseline)).toEqual(["from", "to", "leading", "all"]);
    expect(Object.keys(parsed.pace)).toEqual(["window", "provisional_from", "year_ago", "leading", "all", "sentence"]);
    expect(Object.keys(parsed.pace.leading.pooled)).toEqual(["window", "year_ago", "vs_baseline", "vs_year_ago"]);
    expect(Object.keys(parsed.pace.leading.by_field)).toEqual([...FIELDS]);
    expect(Object.keys(parsed.pace.leading.pooled.window)).toEqual(["k", "n", "share"]);
    // Printed through the schema, a shuffled input comes out in the schema's order, as the fixture writer prints it.
    const shuffled = { known_differences: [], hold: sample().hold, landmarks: sample().landmarks, pace: sample().pace, baseline: sample().baseline, inputs: sample().inputs, schema_version: 1 };
    expect(Object.keys(JSON.parse(jsonText(shuffled, PaceReferenceFile)))).toEqual(["schema_version", "inputs", "baseline", "pace", "landmarks", "hold", "known_differences"]);
  });

  it("R3: known_differences may be empty, as it is until a later figure disagrees", () => {
    expect(issues(edited((s) => { s.known_differences = []; }))).toEqual([]);
  });
});

describe("ReferenceTally: k, n and the share as it prints", () => {
  const ok = [tally(84, 1000), tally(0, 5), tally(5, 5), tally(0, 0)];
  it("R4: a tally is its counts and fmtPct1 of them, or null for no papers", () => {
    for (const t of ok) expect(issues(t, ReferenceTally)).toEqual([]);
  });

  it("R5: k above n, a wrong or missing share, a share for no papers, and counts that are not whole numbers all fail", () => {
    expect(issues({ k: 6, n: 5, share: "100.0%" }, ReferenceTally)).toEqual(["k: k is at most n"]);
    expect(issues({ k: 84, n: 1000, share: "8.5%" }, ReferenceTally)).toEqual(["share: share is fmtPct1(k, n), 8.4%"]);
    expect(issues({ k: 84, n: 1000, share: "8.4" }, ReferenceTally)).toEqual(["share: share is fmtPct1(k, n), 8.4%"]);
    expect(issues({ k: 84, n: 1000, share: null }, ReferenceTally)).toEqual(["share: share is fmtPct1(k, n), 8.4%"]);
    expect(issues({ k: 0, n: 0, share: "0.0%" }, ReferenceTally)).toEqual(["share: A share of no papers is null"]);
    expect(issues({ k: -1, n: 5, share: "0.0%" }, ReferenceTally)[0]).toMatch(/^k:/);
    expect(issues({ k: 1.5, n: 5, share: "30.0%" }, ReferenceTally)[0]).toMatch(/^k:/);
    expect(issues({ k: 1, n: -5, share: null }, ReferenceTally)[0]).toMatch(/^n:/);
    expect(issues({ k: 1, n: 5 }, ReferenceTally)[0]).toMatch(/^share:/);
    expect(issues({ k: 1, n: 5, share: "20.0%", extra: 1 }, ReferenceTally)[0]).toMatch(/Unrecognized key/);
  });

  it("R6: a tie in the tenths rounds half up, as the page prints it", () => {
    // 1 of 16 is 6.25%: printed 6.3%, not 6.2%.
    expect(issues({ k: 1, n: 16, share: "6.3%" }, ReferenceTally)).toEqual([]);
    expect(issues({ k: 1, n: 16, share: "6.2%" }, ReferenceTally)).toEqual(["share: share is fmtPct1(k, n), 6.3%"]);
  });
});

describe("the pooled cell is the seven fields added up", () => {
  it("R7: in D.2's baseline, for A and for B, a pooled k or n that is not the sum fails", () => {
    for (const set of ["leading", "all"] as const) {
      expect(issues(edited((s) => { s.baseline[set].pooled = tally(s.baseline[set].pooled.k + 1, s.baseline[set].pooled.n); }))).toContain(`baseline.${set}.pooled: pooled is the seven fields added up`);
      expect(issues(edited((s) => { s.baseline[set].pooled = tally(s.baseline[set].pooled.k, s.baseline[set].pooled.n + 1); }))).toContain(`baseline.${set}.pooled: pooled is the seven fields added up`);
    }
  });

  it("R8: in D.3, the pooled window and the pooled year-ago window each must add up, for A and for B", () => {
    for (const set of ["leading", "all"] as const) {
      for (const part of ["window", "year_ago"] as const) {
        const bad = issues(edited((s) => { const t = s.pace[set].pooled[part]; s.pace[set].pooled[part] = tally(t.k, t.n + 3); }));
        expect(bad).toContain(`pace.${set}.pooled.${part}: pooled ${part} is the seven fields added up`);
      }
    }
  });

  it("R9: a field changed without the pooled cell changing fails the same way", () => {
    const bad = issues(edited((s) => { s.baseline.leading.by_field.physics = tally(31, 600); }));
    expect(bad).toEqual(["baseline.leading.pooled: pooled is the seven fields added up"]);
  });

  it("R10: ReferenceTallySet needs every one of the seven fields and no other key", () => {
    const set = tallySet(LEADING, 0);
    expect(issues(set, ReferenceTallySet)).toEqual([]);
    const { humanities: _dropped, ...six } = set.by_field;
    expect(issues({ pooled: set.pooled, by_field: six }, ReferenceTallySet).length).toBeGreaterThan(0);
    expect(issues({ pooled: set.pooled, by_field: { ...set.by_field, cyber: tally(0, 0) } }, ReferenceTallySet).length).toBeGreaterThan(0);
  });
});

describe("A's papers are among B's", () => {
  /** Sets one field of B's tallies and adds B's pooled cell up again, so that only the rule under test can fail. */
  function setB(s: Loose, part: "baseline" | "window" | "year_ago", field: FieldId, k: number, n: number): void {
    if (part === "baseline") {
      s.baseline.all.by_field[field] = tally(k, n);
      s.baseline.all.pooled = sum(FIELDS.map((f) => s.baseline.all.by_field[f]));
    } else {
      s.pace.all.by_field[field][part] = tally(k, n);
      s.pace.all.pooled[part] = sum(FIELDS.map((f) => s.pace.all.by_field[f][part]));
    }
  }
  const MSG = "A's papers are among B's: its k and n are at most B's";

  it("R11: A's k above B's, or A's n above B's, in one field fails at that field's path, and only there", () => {
    // A's mathematics baseline is 10 of 200: B at 9 of 200 has too few AI papers, B at 10 of 199 too few papers.
    expect(issues(edited((s) => setB(s, "baseline", "mathematics", 9, 200)))).toEqual([`baseline.leading.by_field.mathematics: ${MSG}`]);
    expect(issues(edited((s) => setB(s, "baseline", "mathematics", 10, 199)))).toEqual([`baseline.leading.by_field.mathematics: ${MSG}`]);
    // The same at the window (A's biology is 110 of 800) and at the year-ago window (A's social is 12 of 220).
    expect(issues(edited((s) => setB(s, "window", "biology", 109, 800)))).toEqual([`pace.leading.window.by_field.biology: ${MSG}`]);
    expect(issues(edited((s) => setB(s, "window", "biology", 110, 799)))).toEqual([`pace.leading.window.by_field.biology: ${MSG}`]);
    expect(issues(edited((s) => setB(s, "year_ago", "social", 11, 220)))).toEqual([`pace.leading.year_ago.by_field.social: ${MSG}`]);
    expect(issues(edited((s) => setB(s, "year_ago", "social", 12, 219)))).toEqual([`pace.leading.year_ago.by_field.social: ${MSG}`]);
  });

  it("R11b: B equal to A in k and in n is the boundary and passes", () => {
    expect(issues(edited((s) => setB(s, "baseline", "mathematics", 10, 200)))).toEqual([]);
    expect(issues(edited((s) => setB(s, "window", "biology", 110, 800)))).toEqual([]);
    expect(issues(edited((s) => setB(s, "year_ago", "social", 12, 220)))).toEqual([]);
  });

  it("R12: a pooled A above pooled B fails on the pooled path", () => {
    const bad = issues(edited((s) => {
      for (const f of FIELDS) s.baseline.all.by_field[f] = tally(0, 0);
      s.baseline.all.pooled = tally(0, 0);
    }));
    expect(bad).toContain("baseline.leading.pooled: A's papers are among B's: its k and n are at most B's");
  });

  it("R13: equal tallies are fine (the journals may hold every paper of a field)", () => {
    expect(issues(edited((s) => { s.baseline.all = structuredClone(s.baseline.leading); }))).toEqual([]);
  });
});

describe("D.1 inputs", () => {
  it("R14: the edition date, the cutoff, the four config versions and the request count are each checked", () => {
    expect(issues(edited((s) => { s.inputs.edition_date = "2026-02-30"; }))[0]).toMatch(/^inputs\.edition_date:/);
    expect(issues(edited((s) => { s.inputs.edition_date = "28 Nov 2026"; }))[0]).toMatch(/^inputs\.edition_date:/);
    expect(issues(edited((s) => { s.inputs.data_cutoff = "2026-13-01"; }))[0]).toMatch(/^inputs\.data_cutoff:/);
    expect(issues(edited((s) => { s.inputs.requests = -1; }))[0]).toMatch(/^inputs\.requests:/);
    expect(issues(edited((s) => { s.inputs.requests = 2486.5; }))[0]).toMatch(/^inputs\.requests:/);
    for (const key of ["ai_terms", "journals", "fields", "counters"] as const) {
      expect(issues(edited((s) => { s.inputs.versions[key] = 0; }))[0]).toMatch(new RegExp(`^inputs\\.versions\\.${key}:`));
      expect(issues(edited((s) => { delete s.inputs.versions[key]; }))[0]).toMatch(new RegExp(`^inputs\\.versions\\.${key}:`));
    }
    expect(issues(edited((s) => { s.inputs.versions.extra = 1; }))[0]).toMatch(/^inputs\.versions:/);
  });

  it("R15: the cutoff is the newest Sunday on or before the edition date minus 2 days", () => {
    // 2026-11-28 minus 2 is Thursday the 26th; the newest Sunday on or before it is the 22nd.
    expect(issues(edited((s) => { s.inputs.data_cutoff = "2026-11-15"; }))).toContain("inputs.data_cutoff: data_cutoff is the newest Sunday on or before the edition date minus 2 days (2026-11-22)");
    expect(issues(edited((s) => { s.inputs.data_cutoff = "2026-11-23"; }))).toContain("inputs.data_cutoff: data_cutoff is the newest Sunday on or before the edition date minus 2 days (2026-11-22)");
    // On a Sunday edition the cutoff is the Sunday before: 2026-11-29 minus 2 is Friday the 27th.
    const sunday = edited((s) => { s.inputs.edition_date = "2026-11-29"; });
    expect(issues(sunday)).toEqual([]);
    // Edition on Monday 2026-11-30: minus 2 is Saturday the 28th, so Sunday the 22nd still.
    const monday = edited((s) => { s.inputs.edition_date = "2026-11-30"; });
    expect(issues(monday)).toEqual([]);
    // Tuesday 2026-12-01: minus 2 is Sunday the 29th, which is itself the cutoff.
    expect(issues(edited((s) => { s.inputs.edition_date = "2026-12-01"; }))).toContain("inputs.data_cutoff: data_cutoff is the newest Sunday on or before the edition date minus 2 days (2026-11-29)");
  });

  it("R16: the cutoff is after the window", () => {
    // Shift the whole window forward a week: still Monday to Sunday and still 52 weeks from its year-ago twin, but it now ends on the cutoff.
    const bad = issues(edited((s) => {
      s.pace.window = { from: "2026-07-06", to: "2026-10-04" };
      s.pace.provisional_from = "2026-10-05";
      s.pace.year_ago = { from: "2025-07-07", to: "2025-10-05" };
      s.inputs.data_cutoff = "2026-11-22";
    }));
    expect(bad).toEqual([]);
    const late = issues(edited((s) => {
      s.pace.window = { from: "2026-09-07", to: "2026-12-06" };
      s.pace.provisional_from = "2026-12-07";
      s.pace.year_ago = { from: "2025-09-08", to: "2025-12-07" };
    }));
    expect(late).toContain("inputs.data_cutoff: data_cutoff is after the window");
    // A window that ends on the cutoff itself is not before it either: 2026-08-24 to 2026-11-22 is 13 weeks.
    const same = issues(edited((s) => {
      s.pace.window = { from: "2026-08-24", to: "2026-11-22" };
      s.pace.provisional_from = "2026-11-23";
      s.pace.year_ago = { from: "2025-08-25", to: "2025-11-23" };
    }));
    expect(same).toEqual(["inputs.data_cutoff: data_cutoff is after the window"]);
  });
});

describe("D.2 baseline", () => {
  it("R17: the baseline is 2015-01-05 to 2019-12-29, nothing else", () => {
    expect(issues(edited((s) => { s.baseline.from = "2015-01-12"; }))[0]).toMatch(/^baseline\.from:/);
    expect(issues(edited((s) => { s.baseline.to = "2019-12-22"; }))[0]).toMatch(/^baseline\.to:/);
    expect(issues(edited((s) => { delete s.baseline.all; }))[0]).toMatch(/^baseline\.all:/);
    expect(issues(edited((s) => { s.baseline.extra = 1; }))[0]).toMatch(/^baseline:/);
  });
});

describe("D.3 the window", () => {
  it("R18: the window runs Monday to Sunday and ends after it starts", () => {
    expect(issues(edited((s) => { s.pace.window.from = "2026-06-30"; }))).toContain("pace.window.from: The window starts on a Monday");
    expect(issues(edited((s) => { s.pace.window.to = "2026-09-26"; }))).toContain("pace.window.to: The window ends on a Sunday");
    const reversed = issues(edited((s) => { s.pace.window = { from: "2026-09-28", to: "2026-09-27" }; }));
    expect(reversed).toContain("pace.window.to: The window ends after it starts");
    expect(issues(edited((s) => { s.pace.window.from = "2026-06-31"; }))[0]).toMatch(/^pace\.window\.from:/);
    // One day, a Monday: it is no Sunday, but it does not end before it starts.
    const oneDay = issues(edited((s) => { s.pace.window = { from: "2026-06-29", to: "2026-06-29" }; }));
    expect(oneDay).toContain("pace.window.to: The window ends on a Sunday");
    expect(oneDay).not.toContain("pace.window.to: The window ends after it starts");
  });

  it("R19: the year-ago window is the window 52 weeks (364 days) earlier, at both ends", () => {
    expect(issues(edited((s) => { s.pace.year_ago.from = "2025-06-23"; }))).toContain("pace.year_ago.from: year_ago starts 52 weeks before the window");
    expect(issues(edited((s) => { s.pace.year_ago.to = "2025-09-21"; }))).toContain("pace.year_ago.to: year_ago ends 52 weeks before the window");
    expect(issues(edited((s) => { s.pace.year_ago.from = "2025-07-07"; }))).toContain("pace.year_ago.from: year_ago starts 52 weeks before the window");
  });

  it("R20: the provisional weeks start the day after the window ends", () => {
    expect(issues(edited((s) => { s.pace.provisional_from = "2026-10-05"; }))).toContain("pace.provisional_from: The provisional weeks start the day after the window ends");
    expect(issues(edited((s) => { s.pace.provisional_from = "2026-09-27"; }))).toContain("pace.provisional_from: The provisional weeks start the day after the window ends");
    expect(issues(edited((s) => { s.pace.provisional_from = "soon"; }))[0]).toMatch(/^pace\.provisional_from:/);
  });

  it("R21: a verdict is one of the schema's words", () => {
    expect(issues(edited((s) => { s.pace.leading.pooled.vs_baseline = "up"; }))[0]).toMatch(/^pace\.leading\.pooled\.vs_baseline:/);
    expect(issues(edited((s) => { s.pace.all.by_field.earth.vs_year_ago = "higher"; }))[0]).toMatch(/^pace\.all\.by_field\.earth\.vs_year_ago:/);
    expect(issues(edited((s) => { delete s.pace.leading.by_field.physics.vs_baseline; }))[0]).toMatch(/^pace\.leading\.by_field\.physics\.vs_baseline:/);
    for (const v of ["higher", "lower", "no_clear_change", "too_few"]) expect(issues(edited((s) => { s.pace.leading.pooled.vs_baseline = v; }))).toEqual([]);
    for (const v of ["up", "level", "down", "too_few"]) expect(issues(edited((s) => { s.pace.leading.pooled.vs_year_ago = v; }))).toEqual([]);
  });

  it("R22: a cell holds the window, the year-ago window and the two verdicts, with no baseline of its own", () => {
    const cell = sample().pace.leading.pooled;
    expect(issues(cell, ReferenceCell)).toEqual([]);
    expect(issues({ ...cell, baseline: tally(1, 2) }, ReferenceCell)[0]).toMatch(/Unrecognized key/);
    expect(Object.keys(ReferenceCell.shape)).toEqual(["window", "year_ago", "vs_baseline", "vs_year_ago"]);
  });

  it("R23: the sentence is in both languages, neither empty nor null, and one character is enough", () => {
    expect(issues(edited((s) => { s.pace.sentence = { en: "x", zh: "y" }; }))).toEqual([]);
    expect(issues(edited((s) => { s.pace.sentence.zh = ""; }))[0]).toMatch(/^pace\.sentence\.zh:/);
    expect(issues(edited((s) => { s.pace.sentence.zh = null; }))[0]).toMatch(/^pace\.sentence\.zh:/);
    expect(issues(edited((s) => { s.pace.sentence.en = ""; }))[0]).toMatch(/^pace\.sentence\.en:/);
    expect(issues(edited((s) => { delete s.pace.sentence.en; }))[0]).toMatch(/^pace\.sentence\.en:/);
    expect(issues(edited((s) => { s.pace.sentence.fr = "x"; }))[0]).toMatch(/^pace\.sentence:/);
  });

  it("R24: every key is required and strict at each level", () => {
    for (const key of ["schema_version", "inputs", "baseline", "pace", "landmarks", "hold", "known_differences"]) {
      expect(issues(edited((s) => { delete (s as Loose)[key]; })).some((m) => m.startsWith(`${key}:`))).toBe(true);
    }
    for (const key of ["window", "provisional_from", "year_ago", "leading", "all", "sentence"]) {
      expect(issues(edited((s) => { delete (s.pace as Loose)[key]; })).some((m) => m.startsWith(`pace.${key}:`))).toBe(true);
    }
    expect(issues(edited((s) => { (s as Loose).extra = 1; }))[0]).toMatch(/^: Unrecognized key/);
    expect(issues(edited((s) => { s.pace.extra = 1; }))[0]).toMatch(/^pace: Unrecognized key/);
    expect(issues(edited((s) => { s.inputs.extra = 1; }))[0]).toMatch(/^inputs: Unrecognized key/);
    expect(issues(edited((s) => { s.pace.window.extra = 1; }))[0]).toMatch(/^pace\.window: Unrecognized key/);
    expect(issues(edited((s) => { s.pace.leading.pooled.extra = 1; }))[0]).toMatch(/^pace\.leading\.pooled: Unrecognized key/);
    expect(issues(edited((s) => { s.schema_version = 2; }))[0]).toMatch(/^schema_version:/);
  });

  it("R25: by_field names all seven fields and only them", () => {
    for (const set of ["leading", "all"] as const) {
      expect(issues(edited((s) => { delete s.pace[set].by_field.earth; })).some((m) => m.startsWith(`pace.${set}.by_field`))).toBe(true);
      expect(issues(edited((s) => { s.pace[set].by_field.theology = s.pace[set].by_field.earth; })).some((m) => m.startsWith(`pace.${set}.by_field`))).toBe(true);
    }
  });
});

describe("D.4 C and D, D.5 known differences", () => {
  it("R26: C by year is the metrics file's own: ascending years, ai at most all, and a baseline that adds up 2015 to 2019", () => {
    expect(issues(edited((s) => { s.landmarks.baseline = { ai: 4, all: 15 }; })).some((m) => m.startsWith("landmarks.baseline"))).toBe(true);
    expect(issues(edited((s) => { s.landmarks.by_year[1].ai = 10; })).some((m) => m.startsWith("landmarks.by_year.1"))).toBe(true);
    expect(issues(edited((s) => { s.landmarks.by_year[1].year = 2015; })).some((m) => m.startsWith("landmarks.by_year"))).toBe(true);
    expect(issues(edited((s) => { s.landmarks.by_year = []; s.landmarks.baseline = { ai: 0, all: 0 }; }))).toEqual([]);
  });

  it("R27: D, the Hold rate, is held + fell + open = cases, and zero cases is a valid go-live figure", () => {
    expect(issues(edited((s) => { s.hold = { cases: 3, held: 1, fell: 1, open: 0, too_few: true }; })).some((m) => m.startsWith("hold.cases"))).toBe(true);
    expect(issues(edited((s) => { s.hold = { cases: 3, held: 1, fell: 1, open: 1, too_few: true }; }))).toEqual([]);
    expect(issues(edited((s) => { delete s.hold.too_few; }))[0]).toMatch(/^hold\.too_few:/);
  });

  it("R28: a known difference names a figure by its dotted path, and says what and why", () => {
    const ok = sample().known_differences[0];
    expect(issues(ok, KnownDifference)).toEqual([]);
    expect(issues({ ...ok, what: "x", why: "y" }, KnownDifference)).toEqual([]);
    expect(issues({ ...ok, figure: "Pace Window" }, KnownDifference)[0]).toMatch(/^figure:/);
    expect(issues({ ...ok, figure: "" }, KnownDifference)[0]).toMatch(/^figure:/);
    expect(issues({ ...ok, what: "" }, KnownDifference)[0]).toMatch(/^what:/);
    expect(issues({ ...ok, why: "" }, KnownDifference)[0]).toMatch(/^why:/);
    expect(issues({ what: ok.what, why: ok.why }, KnownDifference)[0]).toMatch(/^figure:/);
    expect(issues({ ...ok, extra: 1 }, KnownDifference)[0]).toMatch(/Unrecognized key/);
    expect(issues(edited((s) => { s.known_differences.push({ figure: "pace.all.pooled.window", what: "x" } as Loose); })).some((m) => m.startsWith("known_differences.1.why"))).toBe(true);
  });
});

// ── The index of fixtures/openalex/ ──────────────────────────────────────────────────────────────

/** A small query: the URLs only need its shape. */
const QUERY: Pick<PaceQuery, "sources" | "phrases"> = { sources: ["S100", "S200"], phrases: ["machine learning", "deep learning"] };

/** The index the backfill writes: four requests for each of the given Mondays, each answer in its own file. */
function indexFor(weeks: string[]): Record<string, { file: string; content_type: string }> {
  const index: Record<string, { file: string; content_type: string }> = {};
  for (const week of weeks) {
    for (const r of weekRequests(week, QUERY)) index[r.url] = { file: `${r.request}-${week}.json`, content_type: "application/json" };
  }
  return index;
}

describe("the index of fixtures/openalex/", () => {
  const ref = PaceReferenceFile.parse(sample());
  const weeks = referenceWeeks(ref);

  it("R29: the weeks D's metrics read besides the baseline are the year-ago window, the window and the provisional weeks: 13 + 13 + 8 = 34, so 136 answers", () => {
    expect(weeks).toHaveLength(34);
    expect(weeks[0]).toBe("2025-06-30");
    expect(weeks[12]).toBe("2025-09-22");
    expect(weeks[13]).toBe("2026-06-29");
    expect(weeks[25]).toBe("2026-09-21");
    expect(weeks[26]).toBe("2026-09-28");
    expect(weeks[33]).toBe("2026-11-16");
    expect([...weeks].sort()).toEqual(weeks);
    expect(new Set(weeks).size).toBe(34);
    const index = indexFor(weeks);
    expect(Object.keys(index)).toHaveLength(136);
    expect(issues(index, OpenAlexFixtureIndex)).toEqual([]);
    expect(openalexFixtureWeeks(index)).toEqual(weeks);
  });

  it("R30: the weeks follow the file alone: another window length gives another count of weeks", () => {
    const shorter = structuredClone(ref);
    shorter.pace.window = { from: "2026-08-24", to: "2026-09-27" };
    shorter.pace.year_ago = { from: "2025-08-25", to: "2025-09-28" };
    expect(referenceWeeks(shorter)).toHaveLength(5 + 5 + 8);
    expect(referenceWeeks(shorter)[0]).toBe("2025-08-25");
  });

  it("R30b: each run of weeks includes the Monday its span ends on, and an empty span gives none", () => {
    const odd = structuredClone(ref);
    odd.pace.year_ago = { from: "2025-08-25", to: "2025-09-08" };
    odd.pace.window = { from: "2026-08-24", to: "2026-09-07" };
    odd.pace.provisional_from = "2026-09-14";
    odd.inputs.data_cutoff = "2026-09-21";
    expect(referenceWeeks(odd)).toEqual(["2025-08-25", "2025-09-01", "2025-09-08", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]);
    odd.pace.provisional_from = "2026-09-28";
    expect(referenceWeeks(odd).slice(6)).toEqual([]);
  });

  it("R31: the URLs the client builds are the keys the schema accepts, and each reads back as its kind and Monday", () => {
    for (const week of ["2015-01-05", "2016-02-29", "2026-09-07"]) {
      const requests = weekRequests(week, QUERY);
      expect(requests.map((r) => paceRequestOf(r.url))).toEqual(requests.map((r) => ({ request: r.request, week_start: week })));
    }
    expect(paceRequestOf(groupByUrl(paceFilter("all_total", "2026-09-07", QUERY)))).toEqual({ request: "all_total", week_start: "2026-09-07" });
  });

  it("R32: a key that is not a Pace group-by URL, holds a key, or names a week that does not run Monday to Sunday is refused", () => {
    const good = weekRequests("2026-09-07", QUERY)[0]!.url;
    expect(paceRequestOf(good)).not.toBeNull();
    expect(paceRequestOf(`${good}&api_key=sample-key`)).toBeNull();
    expect(paceRequestOf(good.replace("https://", "http://"))).toBeNull();
    expect(paceRequestOf(good.replace("api.openalex.org", "example.org"))).toBeNull();
    expect(paceRequestOf(good.replace("type:article", "type:book"))).toBeNull();
    expect(paceRequestOf(good.replace("has_abstract:true", "has_abstract:false"))).toBeNull();
    expect(paceRequestOf(good.replace("group_by=primary_topic.field.id", "group_by=publication_year"))).toBeNull();
    expect(paceRequestOf(good.replace("2026-09-07,", "2026-09-08,").replace("to_publication_date:2026-09-13", "to_publication_date:2026-09-14"))).toBeNull();
    expect(paceRequestOf(good.replace("to_publication_date:2026-09-13", "to_publication_date:2026-09-14"))).toBeNull();
    expect(paceRequestOf(good.replace("to_publication_date:2026-09-13", "to_publication_date:2026-09-31"))).toBeNull();
    expect(paceRequestOf("")).toBeNull();
    expect(paceRequestOf("https://api.openalex.org/works?filter=doi:10.1/x")).toBeNull();
  });

  it("R33: an entry is { file, content_type: application/json } and nothing else", () => {
    expect(issues({ file: "all_total-2026-09-07.json", content_type: "application/json" }, OpenAlexFixtureEntry)).toEqual([]);
    expect(issues({ file: "a", content_type: "application/json" }, OpenAlexFixtureEntry)).toEqual([]);
    expect(issues({ file: "", content_type: "application/json" }, OpenAlexFixtureEntry)[0]).toMatch(/^file:/);
    expect(issues({ file: "a.json", content_type: "text/html" }, OpenAlexFixtureEntry)[0]).toMatch(/^content_type:/);
    expect(issues({ file: "a.json" }, OpenAlexFixtureEntry)[0]).toMatch(/^content_type:/);
    expect(issues({ file: "a.json", content_type: "application/json", status: 200 }, OpenAlexFixtureEntry)[0]).toMatch(/Unrecognized key/);
  });

  it("R34: the index is non-empty, and holds all four requests of every week it lists", () => {
    expect(issues({}, OpenAlexFixtureIndex)).toContain(": The index lists at least one week");
    const index = indexFor(["2026-09-07", "2026-09-14"]);
    const keys = Object.keys(index);
    const drop = (k: string) => Object.fromEntries(Object.entries(index).filter(([key]) => key !== k));
    expect(issues(drop(keys[2]!), OpenAlexFixtureIndex)).toContain(": The index holds the 4 requests of every week it lists, so its entries come in fours");
    // The last week of the list short of one request.
    expect(issues(drop(keys[7]!), OpenAlexFixtureIndex).length).toBeGreaterThan(0);
    // Five entries: a fifth request with no week of its own.
    const extra = { ...index, ...indexFor(["2026-09-21"]) };
    delete extra[Object.keys(extra).at(-1)!];
    expect(issues(extra, OpenAlexFixtureIndex).length).toBeGreaterThan(0);
  });

  it("R35: a file is named for its kind and week, and a name for another request is refused", () => {
    const index = indexFor(["2026-09-07"]);
    const [first] = Object.keys(index);
    const wrongKind = structuredClone(index);
    wrongKind[first!]!.file = "all_total-2026-09-07.json";
    // The path is the key and then `file`, so a reader of the message finds the entry and the field.
    expect(issues(wrongKind, OpenAlexFixtureIndex)).toEqual([`${first}.file: The file is named leading_total-2026-09-07.json`]);
    const wrongWeek = structuredClone(index);
    wrongWeek[first!]!.file = "leading_total-2026-09-14.json";
    expect(issues(wrongWeek, OpenAlexFixtureIndex)).toEqual([`${first}.file: The file is named leading_total-2026-09-07.json`]);
  });

  it("R36: a week's four requests come in the order leading_total, leading_ai, all_total, all_ai", () => {
    const requests = weekRequests("2026-09-07", QUERY);
    const swapped: Record<string, { file: string; content_type: string }> = {};
    for (const r of [requests[1]!, requests[0]!, requests[2]!, requests[3]!]) swapped[r.url] = { file: `${r.request}-2026-09-07.json`, content_type: "application/json" };
    expect(issues(swapped, OpenAlexFixtureIndex).some((m) => m.includes("Entry 1 is leading_total"))).toBe(true);
    expect(issues(swapped, OpenAlexFixtureIndex).some((m) => m.includes("Entry 2 is leading_ai"))).toBe(true);
  });

  it("R37: weeks run oldest first and each once, with the four requests of a week together", () => {
    const w1 = Object.entries(indexFor(["2026-09-07"]));
    const w2 = Object.entries(indexFor(["2026-09-14"]));
    // Newest week first.
    const reversed = Object.fromEntries([...w2, ...w1]);
    expect(issues(reversed, OpenAlexFixtureIndex).filter((m) => m.endsWith(": Weeks run oldest first, each once"))).toHaveLength(1);
    // The first week listed again after the second, under another journal list (so its two leading URLs are new keys; the two
    // all-papers URLs do not name a journal and are the same keys): the repeat starts a week that is not newer.
    const other = weekRequests("2026-09-07", { sources: ["S300"], phrases: QUERY.phrases }).slice(0, 2).map((r) => [r.url, { file: `${r.request}-2026-09-07.json`, content_type: "application/json" }] as const);
    const again = Object.fromEntries([...w1, ...w2, ...other]);
    expect(Object.keys(again)).toHaveLength(10);
    expect(issues(again, OpenAlexFixtureIndex).filter((m) => m.endsWith(": Weeks run oldest first, each once"))).toHaveLength(1);
    expect(issues(Object.fromEntries([...w1, ...w2]), OpenAlexFixtureIndex)).toEqual([]);
    // The same week again straight after itself (its two leading URLs under another journal list): not a newer week either.
    const adjacent = Object.fromEntries([...w1, ...other]);
    expect(issues(adjacent, OpenAlexFixtureIndex).filter((m) => m.endsWith(": Weeks run oldest first, each once"))).toHaveLength(1);
    // The fifth to eighth entries are another week's requests in the middle of the first: the second group is not together.
    const split = Object.fromEntries([w1[0]!, w1[1]!, w2[0]!, w2[1]!, w1[2]!, w1[3]!, w2[2]!, w2[3]!]);
    const messages = issues(split, OpenAlexFixtureIndex);
    expect(messages.filter((m) => m.endsWith(": The four requests of a week are together")).length).toBeGreaterThan(0);
  });

  it("R38: a key holding api_key, or any other URL, is refused with the reason", () => {
    const index = indexFor(["2026-09-07"]);
    const withKey = Object.fromEntries(Object.entries(index).map(([u, e], i) => [i === 0 ? `${u}&api_key=sample-key` : u, e]));
    const keyed = Object.keys(withKey)[0]!;
    // The refused key comes first, with its own path; the rest of its week then has no first request to follow.
    expect(issues(withKey, OpenAlexFixtureIndex)[0]).toBe(`${keyed}: The key is the group-by URL of a Pace week (SPEC §5.1), without any key or e-mail address`);
    expect(issues({ ...index, "https://example.org/": { file: "x.json", content_type: "application/json" } }, OpenAlexFixtureIndex).length).toBeGreaterThan(0);
  });

  it("R39: openalexFixtureWeeks lists each Monday once, in index order, and skips a key that is not a Pace URL", () => {
    const index = indexFor(["2026-09-07", "2026-09-14"]);
    expect(openalexFixtureWeeks(index)).toEqual(["2026-09-07", "2026-09-14"]);
    expect(openalexFixtureWeeks({ ...index, "https://example.org/": 1 })).toEqual(["2026-09-07", "2026-09-14"]);
    expect(openalexFixtureWeeks({})).toEqual([]);
  });
});
