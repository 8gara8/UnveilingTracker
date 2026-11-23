// lib/ids.ts (SPEC §4.1: no localeCompare anywhere; §4.3: the id forms): the explicit comparators. Each is
// checked on hand-made lists and as an order: antisymmetric, transitive and never equal for distinct strings,
// since a sort of a comparator that is not an order has no defined result. New: Cyber's tests reach its id
// comparators only through its feed and rank tests, and this project's comparators are its own.
import { describe, expect, it } from "vitest";
import { byCodeUnit, compareFindingIds, compareSourceIds } from "@/lib/ids";

type Compare = (a: string, b: string) => number;

/** A small deterministic generator (a linear congruential one), so the sampled lists are the same on every run. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Checks that `compare` is an order on `ids`: antisymmetric, transitive and zero only for equal strings. */
function expectOrder(compare: Compare, ids: readonly string[]): void {
  for (const a of ids) {
    for (const b of ids) {
      const ab = Math.sign(compare(a, b));
      expect(ab + Math.sign(compare(b, a)), `${a} against ${b}`).toBe(0);
      expect(ab === 0, `${a} equals ${b}`).toBe(a === b);
    }
  }
  for (const a of ids) {
    for (const b of ids) {
      if (compare(a, b) >= 0) continue;
      for (const c of ids) {
        if (compare(b, c) < 0) expect(compare(a, c), `${a} < ${b} < ${c}`).toBeLessThan(0);
      }
    }
  }
}

describe("byCodeUnit", () => {
  it("compares UTF-16 code units: upper case before lower case, digits before letters, a prefix first", () => {
    expect(byCodeUnit("Z", "a")).toBe(-1);
    expect(byCodeUnit("a", "Z")).toBe(1);
    expect(byCodeUnit("10", "9")).toBe(-1);
    expect(byCodeUnit("9", "a")).toBe(-1);
    expect(byCodeUnit("ab", "abc")).toBe(-1);
    expect(byCodeUnit("abc", "ab")).toBe(1);
    expect(byCodeUnit("same", "same")).toBe(0);
    expect(byCodeUnit("", "")).toBe(0);
    expect(byCodeUnit("", "a")).toBe(-1);
  });

  it("orders by code unit, not by code point: a surrogate pair sorts before a high BMP character", () => {
    const astral = String.fromCodePoint(0x1f600); // two code units, 0xD83D 0xDE00
    const fullWidthA = String.fromCodePoint(0xff21); // one code unit, 0xFF21
    expect(byCodeUnit(astral, fullWidthA)).toBe(-1);
    expect(byCodeUnit(fullWidthA, astral)).toBe(1);
  });

  it("does what localeCompare would not: the same order in every locale, accents after z", () => {
    expect(byCodeUnit("z", "é")).toBe(-1);
    expect(byCodeUnit("B", "a")).toBe(-1);
    expect(["b", "a", "C", "B", "é", "A"].sort(byCodeUnit)).toEqual(["A", "B", "C", "a", "b", "é"]);
  });
});

describe("compareFindingIds (SPEC §4.3: field code, year, a counter across all fields)", () => {
  it("orders by year, then by the counter, which runs across fields, then by the field's code", () => {
    const sorted = ["math-2026-0142", "bio-2026-0150", "hum-2025-0300", "bio-2026-0099", "phys-2026-0142"].sort(compareFindingIds);
    expect(sorted).toEqual(["hum-2025-0300", "bio-2026-0099", "math-2026-0142", "phys-2026-0142", "bio-2026-0150"]);
  });

  it("puts bio-2026-0099 before math-2026-0142, where plain code-unit order would not", () => {
    expect(compareFindingIds("bio-2026-0099", "math-2026-0142")).toBe(-1);
    expect(byCodeUnit("bio-2026-0150", "math-2026-0142")).toBe(-1);
    expect(compareFindingIds("bio-2026-0150", "math-2026-0142")).toBe(1);
  });

  it("is zero only for the same id, and breaks a repeated counter by the code", () => {
    expect(compareFindingIds("soc-2027-0001", "soc-2027-0001")).toBe(0);
    expect(compareFindingIds("bio-2027-0001", "soc-2027-0001")).toBe(-1);
    expect(compareFindingIds("soc-2027-0001", "bio-2027-0001")).toBe(1);
  });

  it("compares the year and the counter as numbers of fixed width", () => {
    expect(compareFindingIds("math-2026-0999", "math-2026-1000")).toBe(-1);
    expect(compareFindingIds("math-2026-9999", "math-2027-0001")).toBe(-1);
  });

  it("puts anything that is not a finding id after every finding id, in code-unit order", () => {
    const refs = ["2026-11-23/brief", "math-2026-0142", "2026-11-02/brief", "bio-2026-0099"];
    expect(refs.sort(compareFindingIds)).toEqual(["bio-2026-0099", "math-2026-0142", "2026-11-02/brief", "2026-11-23/brief"]);
    for (const notAnId of ["math-2026-142", "MATH-2026-0142", "math-2026-0142x", "xyz-2026-0142", "math-26-0142", "", "new-1", "C-0007"]) {
      expect(compareFindingIds("hum-2099-9999", notAnId), notAnId).toBe(-1);
      expect(compareFindingIds(notAnId, "hum-2099-9999"), notAnId).toBe(1);
    }
    expect(compareFindingIds("C-0007", "R-0001")).toBe(-1);
  });

  it("is an order on a mixed sample of finding ids and other strings (no cycles)", () => {
    const random = lcg(20261123);
    const codes = ["math", "phys", "chem", "bio", "earth", "soc", "hum"];
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
    const sample = new Set<string>(["", "new-1", "C-0007", "2026-11-02/brief", "bio-2026-0150x", "bio-2026-0300x", "math-2026-142"]);
    while (sample.size < 40) {
      sample.add(`${pick(codes)}-${pick(["2025", "2026", "2027"])}-${String(Math.floor(random() * 5) * 50 + 1).padStart(4, "0")}`);
    }
    expectOrder(compareFindingIds, [...sample]);
  });
});

describe("compareSourceIds (SPEC §4.3: s1 to sN in a finding, b1 to bN in a brief)", () => {
  it("orders by the number, so s2 comes before s10, where code-unit order would not", () => {
    expect(byCodeUnit("s10", "s2")).toBe(-1);
    expect(compareSourceIds("s2", "s10")).toBe(-1);
    expect(compareSourceIds("s10", "s2")).toBe(1);
    expect(["s10", "s3", "s1", "s12", "s2", "s11"].sort(compareSourceIds)).toEqual(["s1", "s2", "s3", "s10", "s11", "s12"]);
  });

  it("puts a brief's b ids before a finding's s ids, each in numeric order", () => {
    expect(["s1", "b10", "b2", "s2"].sort(compareSourceIds)).toEqual(["b2", "b10", "s1", "s2"]);
  });

  it("compares the numbers as digit strings, exactly, past the largest integer a double holds", () => {
    expect(compareSourceIds("s9", "s10")).toBe(-1);
    expect(compareSourceIds("s99", "s100")).toBe(-1);
    expect(compareSourceIds("s9007199254740992", "s9007199254740993")).toBe(-1);
    expect(compareSourceIds("s9007199254740993", "s9007199254740992")).toBe(1);
    expect(compareSourceIds("s7", "s7")).toBe(0);
  });

  it("puts anything that is not a source id after every source id, in code-unit order", () => {
    for (const notAnId of ["s0", "s01", "S1", "s", "1", "ss1", "s1a", "", "new-1", "math-2026-0001"]) {
      expect(compareSourceIds("s999999", notAnId), notAnId).toBe(-1);
      expect(compareSourceIds(notAnId, "b1"), notAnId).toBe(1);
    }
    expect(["new-2", "s1", "C-0001", "b1"].sort(compareSourceIds)).toEqual(["b1", "s1", "C-0001", "new-2"]);
  });

  it("is an order on a mixed sample of source ids and other strings (no cycles)", () => {
    const random = lcg(1123);
    const sample = new Set<string>(["", "s0", "s01", "new-1", "s1a", "b", "S2"]);
    while (sample.size < 40) sample.add(`${random() < 0.5 ? "s" : "b"}${Math.floor(random() * 120) + 1}`);
    expectOrder(compareSourceIds, [...sample]);
  });
});
