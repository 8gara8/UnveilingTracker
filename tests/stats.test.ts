// lib/metrics/stats.ts (SPEC §5.2 statistics and display helpers, §5.3 the verdicts that read them): the Wilson and
// Newcombe intervals against published values and hand arithmetic, the score equation that defines the Wilson
// bounds, exact decimal rounding against an independent BigInt rounding, and every display helper on hand-made
// values. Cyber's cases (tests/metrics.test.ts at the fork commit 3ced1fb) are adapted; pct1 and fmtPct1 are new.
import { describe, expect, it } from "vitest";
import {
  fmt1, fmtDate, fmtInt, fmtPct, fmtPct1, newcombe80, newcombeInterval, pct, pct1, plainDecimal, round4, roundTo, wilson80,
  wilsonInterval, Z80,
} from "@/lib/metrics/stats";

/** The two-sided 95% normal quantile, the z of the published tables below. */
const Z95 = 1.959963984540054;

/** erf by its Maclaurin series, accurate to double precision for |x| < 3: an independent check on the quantiles. */
function erf(x: number): number {
  let term = x;
  let sum = x;
  for (let n = 1; n < 80; n += 1) {
    term *= (-x * x) / n;
    sum += term / (2 * n + 1);
  }
  return (2 / Math.sqrt(Math.PI)) * sum;
}
const normalCdf = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));

/** A small deterministic generator (a linear congruential one), so the sampled cases are the same on every run. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** The score statistic of a null proportion p0 for k of n: |k/n - p0| / sqrt(p0 (1 - p0) / n). */
const score = (k: number, n: number, p0: number): number => Math.abs(k / n - p0) / Math.sqrt((p0 * (1 - p0)) / n);

/** P(the 80% Wilson interval holds p) when k is Binomial(n, p): the exact coverage, summed over every k. */
function coverage(n: number, p: number): number {
  let total = 0;
  let logChoose = 0;
  for (let k = 0; k <= n; k += 1) {
    if (k > 0) logChoose += Math.log(n - k + 1) - Math.log(k);
    const [lo, hi] = wilson80(k, n);
    if (lo <= p && p <= hi) total += Math.exp(logChoose + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  return total;
}

const GRID: [number, number][] = [];
for (const n of [1, 2, 5, 8, 10, 37, 100, 263, 1000]) for (const k of [0, 1, Math.floor(n / 3), Math.floor(n / 2), n - 1, n]) GRID.push([Math.max(0, k), n]);

describe("Z80", () => {
  it("is the 0.90 quantile of the standard normal, so the interval is two-sided 80%", () => {
    expect(normalCdf(Z80)).toBeCloseTo(0.9, 14);
    expect(Z80).toBeCloseTo(1.28155, 5);
    expect(normalCdf(Z95)).toBeCloseTo(0.975, 14);
  });
});

describe("wilson80 (the 80% Wilson score interval)", () => {
  // z² = 1.6424 at 80%. For 0 of n the bounds are 0 and z² / (n + z²); for n of n they are n / (n + z²) and 1.
  it("has the closed form 0 to z² / (n + z²) for no successes, and n / (n + z²) to 1 for all of them", () => {
    const z2 = Z80 ** 2;
    const [lo0, hi0] = wilson80(0, 10);
    expect(lo0).toBeCloseTo(0, 12);
    expect(hi0).toBeCloseTo(z2 / (10 + z2), 12); // 1.6424 / 11.6424 = 0.14107
    expect(round4(hi0)).toBe(0.1411);
    const [lo1, hi1] = wilson80(10, 10);
    expect(lo1).toBeCloseTo(10 / (10 + z2), 12); // 10 / 11.6424 = 0.85893
    expect(round4(lo1)).toBe(0.8589);
    expect(hi1).toBeCloseTo(1, 12);
  });

  // 8 of 100: p = 0.08, z² = 1.642374, den = 1 + z² / 100 = 1.016424.
  //   centre = (0.08 + z² / 200) / den = (0.08 + 0.008212) / 1.016424 = 0.086787
  //   half = z sqrt(0.08 x 0.92 / 100 + z² / 40000) / den = 1.281552 x sqrt(0.000736 + 0.000041) / 1.016424
  //        = 1.281552 x 0.027876 / 1.016424 = 0.035147
  it("matches the hand arithmetic for 8 of 100: centre 0.086787, half-width 0.035147", () => {
    const [lo, hi] = wilson80(8, 100);
    expect((lo + hi) / 2).toBeCloseTo(0.086787, 6);
    expect((hi - lo) / 2).toBeCloseTo(0.035147, 6);
    expect([round4(lo), round4(hi)]).toEqual([0.0516, 0.1219]);
  });

  it("is centred on 1/2 for half the trials: 50 of 100 gives 0.4364 to 0.5636", () => {
    const z2 = Z80 ** 2;
    const half = (Z80 * Math.sqrt(0.25 / 100 + z2 / 40_000)) / (1 + z2 / 100);
    const [lo, hi] = wilson80(50, 100);
    expect(lo).toBeCloseTo(0.5 - half, 12);
    expect(hi).toBeCloseTo(0.5 + half, 12);
    expect([round4(lo), round4(hi)]).toEqual([0.4364, 0.5636]);
  });

  it("puts each unclamped bound where the score statistic equals z (the Wilson interval inverts the score test)", () => {
    for (const [k, n] of GRID) {
      const [lo, hi] = wilson80(k, n);
      if (lo > 1e-12) expect(score(k, n, lo), `lower bound of ${k}/${n}`).toBeCloseTo(Z80, 9);
      if (hi < 1 - 1e-12) expect(score(k, n, hi), `upper bound of ${k}/${n}`).toBeCloseTo(Z80, 9);
    }
  });

  it("holds the proportion, stays in [0, 1], and is the mirror image for the complementary count", () => {
    for (const [k, n] of GRID) {
      const [lo, hi] = wilson80(k, n);
      expect(lo, `${k}/${n}`).toBeGreaterThanOrEqual(0);
      expect(hi, `${k}/${n}`).toBeLessThanOrEqual(1);
      // The bounds that touch 0 or 1 (no successes, all successes) are 0 or 1 only up to the last digit of a double.
      expect(lo, `${k}/${n}`).toBeLessThanOrEqual(k / n + 1e-12);
      expect(hi, `${k}/${n}`).toBeGreaterThanOrEqual(k / n - 1e-12);
      expect(lo, `${k}/${n}`).toBeLessThan(hi);
      const [mlo, mhi] = wilson80(n - k, n);
      expect(mlo, `${n - k}/${n}`).toBeCloseTo(1 - hi, 12);
      expect(mhi, `${n - k}/${n}`).toBeCloseTo(1 - lo, 12);
    }
  });

  it("rises with the count and narrows as the trials grow", () => {
    for (let k = 1; k <= 40; k += 1) {
      const [lo0, hi0] = wilson80(k - 1, 40);
      const [lo1, hi1] = wilson80(k, 40);
      expect(lo1).toBeGreaterThan(lo0);
      expect(hi1).toBeGreaterThan(hi0);
    }
    const widths = [10, 100, 1000, 10_000].map((n) => {
      const [lo, hi] = wilson80(n / 5, n);
      return hi - lo;
    });
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
    expect(new Set(widths).size).toBe(4);
  });

  it("covers the true proportion about 80% of the time (the exact coverage is within 0.76 and 0.86)", () => {
    for (const [n, p] of [[100, 0.2], [400, 0.05], [50, 0.5], [200, 0.1], [30, 0.3], [1000, 0.02]] as const) {
      const c = coverage(n, p);
      expect(c, `n=${n}, p=${p}`).toBeGreaterThan(0.76);
      expect(c, `n=${n}, p=${p}`).toBeLessThan(0.86);
    }
  });

  it("refuses counts it cannot read: no trials, more successes than trials, negative or fractional counts", () => {
    for (const [k, n] of [[0, 0], [1, 0], [5, 4], [-1, 5], [1.5, 4], [1, 4.5], [Number.NaN, 4], [1, Number.POSITIVE_INFINITY]] as const) {
      expect(() => wilson80(k, n), `${k}/${n}`).toThrow(RangeError);
    }
  });
});

describe("wilsonInterval at 95% against Newcombe (1998), Statistics in Medicine 17, pages 857 to 872, method 3", () => {
  // The Wilson score interval, for the four proportions of the paper's first table: the bounds to four places.
  it("gives his 81/263, 15/148, 0/20 and 1/29", () => {
    const rounded = (k: number, n: number) => wilsonInterval(k, n, Z95).map(round4);
    expect(rounded(81, 263)).toEqual([0.2553, 0.3662]);
    expect(rounded(15, 148)).toEqual([0.0624, 0.1605]);
    expect(rounded(0, 20)).toEqual([0, 0.1611]);
    expect(rounded(1, 29)).toEqual([0.0061, 0.1718]);
  });

  it("is wilson80 at Z80, and wider at 95% than at 80%", () => {
    for (const [k, n] of GRID) {
      expect(wilsonInterval(k, n, Z80)).toEqual(wilson80(k, n));
      const [lo80, hi80] = wilson80(k, n);
      const [lo95, hi95] = wilsonInterval(k, n, Z95);
      expect(lo95).toBeLessThanOrEqual(lo80 + 1e-12);
      expect(hi95).toBeGreaterThanOrEqual(hi80 - 1e-12);
    }
  });

  it("refuses a quantile that is not a positive number", () => {
    for (const z of [0, -1.96, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => wilsonInterval(5, 10, z), String(z)).toThrow(RangeError);
  });
});

describe("newcombe80 (Newcombe's hybrid score interval, method 10, at 80%)", () => {
  // 50 of 100 against 25 of 100: p1 = 0.5, p2 = 0.25, d = 0.25. The 80% Wilson bounds are
  //   50/100: 0.436442 to 0.563558 and 25/100: 0.198849 to 0.309230.
  //   lower = d - sqrt((p1 - l1)² + (u2 - p2)²) = 0.25 - sqrt(0.063558² + 0.059230²) = 0.25 - sqrt(0.0040396 + 0.0035082)
  //         = 0.25 - 0.086878 = 0.163122
  //   upper = d + sqrt((u1 - p1)² + (p2 - l2)²) = 0.25 + sqrt(0.063558² + 0.051151²) = 0.25 + sqrt(0.0040396 + 0.0026164)
  //         = 0.25 + 0.081584 = 0.331584
  it("matches the hand arithmetic for 50/100 against 25/100: 0.163122 to 0.331584", () => {
    const [lo, hi] = newcombe80(50, 100, 25, 100);
    expect(lo).toBeCloseTo(0.25 - Math.sqrt(0.063558 ** 2 + 0.05923 ** 2), 5);
    expect(hi).toBeCloseTo(0.25 + Math.sqrt(0.063558 ** 2 + 0.051151 ** 2), 5);
    expect(lo).toBeCloseTo(0.163122, 5);
    expect(hi).toBeCloseTo(0.331584, 5);
    expect([round4(lo), round4(hi)]).toEqual([0.1631, 0.3316]);
  });

  it("is the square-and-add of the two Wilson intervals, as the definition says", () => {
    const random = lcg(80);
    for (let i = 0; i < 200; i += 1) {
      const n1 = Math.floor(random() * 500) + 1;
      const n2 = Math.floor(random() * 500) + 1;
      const k1 = Math.floor(random() * (n1 + 1));
      const k2 = Math.floor(random() * (n2 + 1));
      const [l1, u1] = wilson80(k1, n1);
      const [l2, u2] = wilson80(k2, n2);
      const p1 = k1 / n1;
      const p2 = k2 / n2;
      const [lo, hi] = newcombe80(k1, n1, k2, n2);
      expect(lo).toBeCloseTo(p1 - p2 - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), 12);
      expect(hi).toBeCloseTo(p1 - p2 + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2), 12);
      expect(lo).toBeLessThan(p1 - p2 + 1e-12);
      expect(hi).toBeGreaterThan(p1 - p2 - 1e-12);
    }
  });

  it("swaps and negates when the two samples swap, and is symmetric about 0 for equal proportions", () => {
    for (const [k1, n1, k2, n2] of [[50, 100, 25, 100], [3, 40, 17, 90], [0, 12, 7, 12], [168, 2000, 44, 4000]] as const) {
      const [lo, hi] = newcombe80(k1, n1, k2, n2);
      const [slo, shi] = newcombe80(k2, n2, k1, n1);
      expect(slo).toBeCloseTo(-hi, 12);
      expect(shi).toBeCloseTo(-lo, 12);
    }
    const [lo, hi] = newcombe80(10, 100, 10, 100);
    expect(lo).toBeCloseTo(-hi, 12);
    expect(lo).toBeLessThan(0);
    expect(round4(hi)).toBe(0.0555);
  });

  it("is wholly above 0 for a clear rise, wholly below for a clear fall and spans 0 for a small difference (§5.3's tests)", () => {
    const [riseLo, riseHi] = newcombe80(90, 100, 10, 100);
    expect([round4(riseLo), round4(riseHi)]).toEqual([0.7362, 0.8456]);
    expect(riseLo).toBeGreaterThan(0);
    const [fallLo, fallHi] = newcombe80(10, 100, 90, 100);
    expect([round4(fallLo), round4(fallHi)]).toEqual([-0.8456, -0.7362]);
    expect(fallHi).toBeLessThan(0);
    const [flatLo, flatHi] = newcombe80(10, 100, 12, 100);
    expect(flatLo).toBeLessThan(0);
    expect(flatHi).toBeGreaterThan(0);
    // A Pace-like case: 8.4% of 2,000 papers in the window against 1.1% of 4,000 in the baseline.
    const [paceLo, paceHi] = newcombe80(168, 2000, 44, 4000);
    expect([round4(paceLo), round4(paceHi)]).toEqual([0.065, 0.0815]);
  });

  it("refuses what wilson80 refuses, for either sample", () => {
    expect(() => newcombe80(1, 0, 1, 10)).toThrow(RangeError);
    expect(() => newcombe80(1, 10, 1, 0)).toThrow(RangeError);
    expect(() => newcombe80(11, 10, 1, 10)).toThrow(RangeError);
    expect(() => newcombe80(1, 10, -1, 10)).toThrow(RangeError);
  });
});

describe("newcombeInterval at 95% against Newcombe (1998), Statistics in Medicine 17, pages 873 to 890, method 10", () => {
  // His example of 56/70 against 48/80: d = 0.8 - 0.6 = 0.2000. The 95% Wilson bounds are
  //   56/70: 0.69183 to 0.87695 and 48/80: 0.49045 to 0.70038, so
  //   lower = 0.2 - sqrt((0.8 - 0.69183)² + (0.70038 - 0.6)²) = 0.2 - sqrt(0.011701 + 0.010076) = 0.2 - 0.14757 = 0.0524
  //   upper = 0.2 + sqrt((0.87695 - 0.8)² + (0.6 - 0.49045)²) = 0.2 + sqrt(0.005921 + 0.012001) = 0.2 + 0.13388 = 0.3339
  it("gives his 0.2000 with the interval 0.0524 to 0.3339 for 56/70 against 48/80", () => {
    const [lo, hi] = newcombeInterval(56, 70, 48, 80, Z95);
    expect(round4(lo)).toBe(0.0524);
    expect(round4(hi)).toBe(0.3339);
    expect(round4(56 / 70 - 48 / 80)).toBe(0.2);
  });

  it("is newcombe80 at Z80", () => {
    expect(newcombeInterval(56, 70, 48, 80, Z80)).toEqual(newcombe80(56, 70, 48, 80));
  });

  it("refuses a quantile that is not a positive number", () => {
    expect(() => newcombeInterval(5, 10, 3, 10, 0)).toThrow(RangeError);
  });
});

describe("plainDecimal and roundTo (a stored value: half away from zero on the shortest decimal string)", () => {
  it("writes a number out of exponent form", () => {
    expect(plainDecimal(1e-7)).toBe("0.0000001");
    expect(plainDecimal(1.5e21)).toBe("1500000000000000000000");
    expect(plainDecimal(1e21)).toBe("1000000000000000000000");
    expect(plainDecimal(123.456)).toBe("123.456");
    expect(plainDecimal(0)).toBe("0");
    expect(plainDecimal(1.5e-7)).toBe("0.00000015");
    expect(plainDecimal(5)).toBe("5");
  });

  it("rounds a half away from zero, where binary floating point and toFixed would not", () => {
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(-2.55, 1)).toBe(-2.6);
    expect(roundTo(0.145, 2)).toBe(0.15);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(1.005.toFixed(2)).toBe("1.00");
    expect(Math.round(1.005 * 100) / 100).toBe(1);
    expect(round4(2.23605)).toBe(2.2361);
  });

  it("decides on the first dropped digit alone, never rounding an earlier one first", () => {
    expect(roundTo(1.2344999996, 3)).toBe(1.234);
    expect(roundTo(0.000049999999, 4)).toBe(0);
    expect(roundTo(0.00005, 4)).toBe(0.0001);
    expect(roundTo(0.285, 2)).toBe(0.29);
    expect(roundTo(0.12344, 4)).toBe(0.1234);
    expect(roundTo(0.12345, 4)).toBe(0.1235);
  });

  it("keeps a value that needs no rounding, large values and the sign of a rounded zero", () => {
    expect(roundTo(0.1234, 4)).toBe(0.1234);
    expect(roundTo(7, 3)).toBe(7);
    expect(roundTo(1.5e21, 0)).toBe(1.5e21);
    expect(roundTo(0, 4)).toBe(0);
    expect(Object.is(roundTo(-0.00001, 2), 0)).toBe(true);
    expect(roundTo(-0.00001, 2)).not.toBe(-0);
    expect(roundTo(-0.126, 2)).toBe(-0.13);
  });

  it("agrees with exact decimal rounding of the shortest decimal string, on sampled decimals and every dp", () => {
    const random = lcg(2026);
    for (let i = 0; i < 400; i += 1) {
      const fracLength = Math.floor(random() * 7) + 1;
      const fraction = String(Math.floor(random() * 10 ** fracLength)).padStart(fracLength, "0").replace(/0+$/, "") || "0";
      const text = `${Math.floor(random() * 1000)}.${fraction}`;
      const x = Number(text);
      expect(String(x)).toBe(text.replace(/\.0$/, ""));
      for (const dp of [0, 1, 2, 4]) {
        const [int = "0", frac = ""] = text.split(".");
        const padded = frac.padEnd(Math.max(frac.length, dp), "0");
        const divisor = 10n ** BigInt(padded.length - dp);
        const scaled = BigInt(int + padded);
        let units = scaled / divisor;
        if ((scaled % divisor) * 2n >= divisor) units += 1n;
        const expected = Number(units) / 10 ** dp;
        expect(roundTo(x, dp), `${text} at ${dp} dp`).toBe(expected);
        expect(roundTo(-x, dp), `-${text} at ${dp} dp`).toBe(expected === 0 ? 0 : -expected);
      }
    }
  });

  it("refuses a value or a precision it cannot use", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(() => roundTo(bad, 2)).toThrow(RangeError);
    for (const dp of [-1, 1.5, Number.NaN]) expect(() => roundTo(1.25, dp), String(dp)).toThrow(RangeError);
  });

  it("round4 is four decimal places", () => {
    expect(round4(0.123449999)).toBe(0.1234);
    expect(round4(0.12345)).toBe(0.1235);
    expect(round4(1)).toBe(1);
    expect(round4(0.99995)).toBe(1);
    expect(round4(-0.00005)).toBe(-0.0001);
  });
});

describe("pct (an integer percent) and pct1 (a percent with one decimal)", () => {
  it("pct is floor((200k + n) / (2n)): half up", () => {
    expect(pct(58, 157)).toBe(37);
    expect(pct(1, 8)).toBe(13);
    expect(pct(0, 9)).toBe(0);
    expect(pct(9, 9)).toBe(100);
    expect(pct(1, 200)).toBe(1);
    expect(pct(1, 201)).toBe(0);
  });

  it("pct1 is floor((2000k + n) / (2n)) / 10: the share rounded half up to a tenth of a percent", () => {
    expect(pct1(1, 8)).toBe(12.5);
    expect(pct1(8, 100)).toBe(8);
    expect(pct1(0, 5)).toBe(0);
    expect(pct1(5, 5)).toBe(100);
    expect(pct1(1, 3)).toBe(33.3);
    expect(pct1(2, 3)).toBe(66.7);
    expect(pct1(1, 6)).toBe(16.7);
    expect(pct1(1, 16)).toBe(6.3); // 6.25 rounds up
    expect(pct1(3, 16)).toBe(18.8); // 18.75 rounds up
    expect(pct1(1, 2000)).toBe(0.1); // 0.05 rounds up
    expect(pct1(1, 2001)).toBe(0); // 0.04998
    expect(pct1(84, 1000)).toBe(8.4);
  });

  it("does not make the mistake of rounding a float product: 201 of 400 is 50.3 where Math.round(0.5025 * 1000) gives 50.2", () => {
    expect(Math.round((201 / 400) * 1000) / 10).toBe(50.2);
    expect(pct1(201, 400)).toBe(50.3);
    expect(fmtPct1(201, 400)).toBe("50.3%");
    expect(pct1(1003, 2000)).toBe(50.2); // 50.15, which the float product rounds to 50.1
  });

  it("agrees with exact integer arithmetic on sampled counts", () => {
    const random = lcg(1000);
    for (let i = 0; i < 500; i += 1) {
      const n = Math.floor(random() * 5000) + 1;
      const k = Math.floor(random() * (n + 1));
      const exact = (2000n * BigInt(k) + BigInt(n)) / (2n * BigInt(n));
      expect(pct1(k, n), `${k}/${n}`).toBe(Number(exact) / 10);
      expect(pct(k, n), `${k}/${n}`).toBe(Number((200n * BigInt(k) + BigInt(n)) / (2n * BigInt(n))));
    }
  });

  it("throws on no denominator, as the spec says, and on counts that are not a share", () => {
    expect(() => pct1(0, 0)).toThrow(RangeError);
    expect(() => pct(0, 0)).toThrow(RangeError);
    for (const [k, n] of [[5, 4], [-1, 5], [1.5, 4], [1, 4.5], [Number.NaN, 4]] as const) expect(() => pct1(k, n), `${k}/${n}`).toThrow(RangeError);
    expect(() => pct(-1, 5)).toThrow(RangeError);
  });
});

describe("fmtPct1 (pct1 as printed: always its decimal and a percent sign, §5.2)", () => {
  it("prints the decimal even when it is 0: 8.0%, 0.0%, 100.0%", () => {
    expect(fmtPct1(8, 100)).toBe("8.0%");
    expect(fmtPct1(0, 40)).toBe("0.0%");
    expect(fmtPct1(40, 40)).toBe("100.0%");
    expect(fmtPct1(1, 8)).toBe("12.5%");
    expect(fmtPct1(1, 2001)).toBe("0.0%");
    expect(fmtPct1(1, 2000)).toBe("0.1%");
  });

  it("prints the figures of the spec's Pace sentence: 8.4%, 1.1% and 6.9%", () => {
    expect(fmtPct1(84, 1000)).toBe("8.4%");
    expect(fmtPct1(11, 1000)).toBe("1.1%");
    expect(fmtPct1(69, 1000)).toBe("6.9%");
    expect(`The Pace: ${fmtPct1(84, 1000)} of papers in leading journals named AI methods`).toBe("The Pace: 8.4% of papers in leading journals named AI methods");
  });

  it("is pct1 with a decimal and a sign, for every sampled count", () => {
    const random = lcg(7);
    for (let i = 0; i < 300; i += 1) {
      const n = Math.floor(random() * 3000) + 1;
      const k = Math.floor(random() * (n + 1));
      const text = fmtPct1(k, n);
      expect(text, `${k}/${n}`).toMatch(/^\d{1,3}\.\d%$/);
      expect(Number(text.slice(0, -1)), `${k}/${n}`).toBe(pct1(k, n));
    }
  });

  it("throws where pct1 throws", () => {
    expect(() => fmtPct1(0, 0)).toThrow(RangeError);
    expect(() => fmtPct1(3, 2)).toThrow(RangeError);
    expect(() => fmtPct1(-1, 2)).toThrow(RangeError);
  });
});

describe("fmtPct, fmtInt, fmt1 and fmtDate", () => {
  it("fmtPct prints a fraction as an integer percent, half up on its 4 dp value", () => {
    expect(fmtPct(0.3217)).toBe("32%");
    expect(fmtPct(0.285)).toBe("29%");
    expect(fmtPct(0.145)).toBe("15%");
    expect(fmtPct(0)).toBe("0%");
    expect(fmtPct(1)).toBe("100%");
    expect(fmtPct(0.004)).toBe("0%");
    expect(fmtPct(0.005)).toBe("1%");
    expect(fmtPct(-0.5)).toBe("-50%");
    expect(fmtPct(-0.0004)).toBe("0%");
    expect(() => fmtPct(Number.NaN)).toThrow(RangeError);
    expect(() => fmtPct(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("fmtPct shows the stored 4 dp value, never the raw double: 0.04495 is stored as 0.045 and shows 5%", () => {
    // In binary, 0.04495 * 10000 is 449.49999999999994, which a plain Math.round would take down to 449 and 4%.
    // round4() decides on the decimal string, half away from zero, and stores 0.045, which is 5%.
    expect(round4(0.04495)).toBe(0.045);
    expect(fmtPct(0.04495)).toBe("5%");
    expect(fmtPct(0.06495)).toBe("7%");
    expect(fmtPct(-0.04495)).toBe("-5%");
  });

  it("fmtInt prints a count with thousands separators", () => {
    expect(fmtInt(44_944)).toBe("44,944");
    expect(fmtInt(0)).toBe("0");
    expect(fmtInt(999)).toBe("999");
    expect(fmtInt(1_234_567)).toBe("1,234,567");
    expect(fmtInt(-1234)).toBe("-1,234");
    expect(() => fmtInt(1.5)).toThrow(RangeError);
    expect(() => fmtInt(Number.NaN)).toThrow(RangeError);
  });

  it("fmt1 prints a ratio to one decimal, always with the decimal", () => {
    expect(fmt1(5.2498)).toBe("5.2");
    expect(fmt1(5.0004)).toBe("5.0");
    expect(fmt1(1.25)).toBe("1.3");
    expect(fmt1(12.96)).toBe("13.0");
    expect(fmt1(0)).toBe("0.0");
    expect(fmt1(-1.25)).toBe("-1.3");
    expect(fmt1(-0.04)).toBe("0.0");
    expect(() => fmt1(Number.NaN)).toThrow(RangeError);
    expect(() => fmt1(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  it("fmt1 shows the stored 4 dp value too: 1.24995 is stored as 1.25 and shows 1.3", () => {
    // 1.24995 * 10000 is 12499.499999999998 in binary, which would give 1.2.
    expect(round4(1.24995)).toBe(1.25);
    expect(fmt1(1.24995)).toBe("1.3");
    expect(fmt1(4.14995)).toBe("4.2");
    expect(fmt1(-1.24995)).toBe("-1.3");
  });

  it("fmtDate prints day and month, adding the year only when it is not the edition's year", () => {
    expect(fmtDate("2026-08-31", "2026-11-23")).toBe("31 Aug");
    expect(fmtDate("2026-01-05", "2026-11-23")).toBe("5 Jan");
    expect(fmtDate("2025-12-30", "2026-11-23")).toBe("30 Dec 2025");
    expect(fmtDate("2027-01-02", "2026-11-23")).toBe("2 Jan 2027");
    expect(() => fmtDate("2026-08-31", "2026-02-30")).toThrow(RangeError);
    expect(() => fmtDate("2026-08-31", "soon")).toThrow(RangeError);
    expect(() => fmtDate("2026-02-30", "2026-11-23")).toThrow("Invalid date");
  });
});
