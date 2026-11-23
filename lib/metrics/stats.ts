// Statistics and display helpers (SPEC §5.2, §5.3). Pure: no clock, no time zone, no network, no random source.
// Intervals are closed-form (no bootstrap, no sampling). Counts are integers; shares and intervals are IEEE
// doubles computed from the counts, and every direction or threshold test compares those exact values.
// Files store them with roundTo(); the page, the chat edition and the validator render every number with
// the display helpers below, so all three show the same string. A displayed share always comes from its two
// counts (pct1(), fmtPct1()), never from a stored fraction.
// Cyber's lib/metrics/stats.ts at the fork commit 3ced1fb, adapted: the Mann-Whitney test, the median and its
// interval, the Poisson interval, round1(), round2(), fmt2() and fmtDays() are dropped (this project's
// verdicts use Wilson and Newcombe intervals only, §5.3; the displays of scores and days went with Cyber's domain);
// wilsonInterval() and newcombeInterval() take the z, so that textbook 95% values test the very formulas
// wilson80() and newcombe80() use; pct1() and fmtPct1() are new (§5.2).

import { isValidDate } from "../dates";
import { dayMonth, shortDate } from "../format";
import type { Interval } from "../schema/common";

/** The standard normal quantile at 0.90: the z of every two-sided 80% interval here. */
export const Z80 = 1.2815515655446004;

// ── Intervals ────────────────────────────────────────────────────────────────────────────────────

function assertCount(x: number, what: string): void {
  if (!Number.isInteger(x) || x < 0) throw new RangeError(`${what} must be a non-negative integer, got ${x}`);
}

function assertZ(z: number): void {
  if (!Number.isFinite(z) || z <= 0) throw new RangeError(`z must be a positive number, got ${z}`);
}

/**
 * The Wilson score interval for k successes in n trials (n ≥ 1) at the two-sided normal quantile `z`,
 * clamped to [0, 1]: with p = k / n, centre = (p + z² / 2n) / (1 + z² / n) and
 * half = z · sqrt(p (1 - p) / n + z² / 4n²) / (1 + z² / n), the interval is [centre - half, centre + half].
 */
export function wilsonInterval(k: number, n: number, z: number): Interval {
  assertCount(k, "wilson k");
  assertCount(n, "wilson n");
  assertZ(z);
  if (n < 1 || k > n) throw new RangeError(`wilson needs 0 ≤ k ≤ n and n ≥ 1, got k=${k}, n=${n}`);
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** The 80% Wilson score interval for k successes in n trials (n ≥ 1), clamped to [0, 1]. */
export function wilson80(k: number, n: number): Interval {
  return wilsonInterval(k, n, Z80);
}

/**
 * Newcombe's hybrid score interval (method 10) at quantile `z` for d = p1 - p2, from the two Wilson
 * intervals [l1, u1] and [l2, u2]: [d - sqrt((p1 - l1)² + (u2 - p2)²), d + sqrt((u1 - p1)² + (p2 - l2)²)].
 */
export function newcombeInterval(k1: number, n1: number, k2: number, n2: number, z: number): Interval {
  const [l1, u1] = wilsonInterval(k1, n1, z);
  const [l2, u2] = wilsonInterval(k2, n2, z);
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const d = p1 - p2;
  return [d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)];
}

/** Newcombe's hybrid score interval at 80% for p1 - p2 (§5.3's "wholly above 0" and "wholly below 0" tests). */
export function newcombe80(k1: number, n1: number, k2: number, n2: number): Interval {
  return newcombeInterval(k1, n1, k2, n2, Z80);
}

// ── Stored values ────────────────────────────────────────────────────────────────────────────────

/** x.toString() of a finite a ≥ 0 written out of exponent form ("1.5e+21" → "1500000000000000000000"). */
export function plainDecimal(a: number): string {
  const [mant = "", exp = "0"] = a.toString().split("e");
  const [int = "", frac = ""] = mant.split(".");
  const digits = int + frac;
  const point = int.length + Number(exp);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * A stored value: half away from zero, decided on x.toString()'s shortest decimal string, so binary
 * floating point cannot move a half (2.5 → 3, -2.5 → -3, 0.145 at 2 dp → 0.15) and no digit is rounded
 * before the one that decides. Never toFixed, Math.round or Math.floor(x * 100 + 0.5).
 */
export function roundTo(x: number, dp: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`roundTo needs a finite number, got ${x}`);
  if (!Number.isInteger(dp) || dp < 0) throw new RangeError(`roundTo needs whole decimal places, got ${dp}`);
  const [i = "0", f = ""] = plainDecimal(Math.abs(x)).split(".");
  const p = f.padEnd(dp + 1, "0");
  let units = BigInt(i + p.slice(0, dp));
  if (p.charCodeAt(dp) - 48 >= 5) units += 1n; // the first dropped digit decides
  const r = Number(units) / 10 ** dp;
  return x < 0 && r !== 0 ? -r : r;
}

/** 4 dp: shares and interval bounds (§4.1). */
export const round4 = (x: number): number => roundTo(x, 4);

// ── Display ──────────────────────────────────────────────────────────────────────────────────────
// Shares are rounded in basis points first, so a value never rounds twice. A displayed share always uses
// pct(k, n), pct1(k, n) or fmtPct1(k, n) from the two counts, never fmtPct of the stored share.

/** A share in basis points, from its stored (4 dp) value. */
function basisPoints(x: number): number {
  return Math.round(round4(x) * 1e4);
}

/** Integer percent from a count and its denominator: floor((200k + n) / (2n)). pct(58, 157) is 37. */
export function pct(k: number, n: number): number {
  assertCount(k, "pct k");
  assertCount(n, "pct n");
  if (n < 1) throw new RangeError("pct needs a denominator of at least 1");
  return Math.floor((200 * k + n) / (2 * n));
}

/**
 * Tenths of a percent from a count and its denominator, floor((2000k + n) / (2n)): the share rounded half up
 * to one decimal, in whole tenths. The division is made on integers (the remainder is taken off first), so
 * no quotient is rounded in binary before the floor.
 */
function tenthsOfPercent(k: number, n: number, what: string): number {
  assertCount(k, `${what} k`);
  assertCount(n, `${what} n`);
  if (n < 1) throw new RangeError(`${what} needs a denominator of at least 1`);
  if (k > n) throw new RangeError(`${what} needs k ≤ n, got k=${k}, n=${n}`);
  const num = 2000 * k + n;
  const den = 2 * n;
  return (num - (num % den)) / den;
}

/**
 * Percent with one decimal from a count and its denominator: Math.floor((2000k + n) / (2n)) / 10 (§5.2).
 * pct1(1, 8) is 12.5 and pct1(8, 100) is 8, which fmtPct1() prints "8.0%". Throws when n is 0, as pct() does:
 * a share with no papers is never computed (§5.3).
 */
export function pct1(k: number, n: number): number {
  return tenthsOfPercent(k, n, "pct1") / 10;
}

/** pct1() as it is printed, always with its decimal and a percent sign: fmtPct1(8, 100) is "8.0%", fmtPct1(84, 1000) "8.4%". */
export function fmtPct1(k: number, n: number): string {
  const tenths = tenthsOfPercent(k, n, "fmtPct1");
  return `${Math.trunc(tenths / 10)}.${tenths % 10}%`;
}

/** A fraction (an interval bound) as a percent: 0.3217 → "32%", 0.285 → "29%", 0.145 → "15%". */
export function fmtPct(x: number): string {
  if (!Number.isFinite(x)) throw new RangeError(`fmtPct needs a finite number, got ${x}`);
  const sign = x < 0 ? "-" : "";
  const value = Math.floor((basisPoints(Math.abs(x)) + 50) / 100);
  return `${value === 0 ? "" : sign}${value}%`;
}

const INT_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** A count with thousands separators: 44944 → "44,944". */
export function fmtInt(n: number): string {
  if (!Number.isInteger(n)) throw new RangeError(`fmtInt needs an integer, got ${n}`);
  return INT_FORMAT.format(n);
}

/** A ratio to one decimal, always with the decimal: 5.2498 → "5.2", 5.0004 → "5.0", 1.25 → "1.3". */
export function fmt1(x: number): string {
  if (!Number.isFinite(x)) throw new RangeError(`fmt1 needs a finite number, got ${x}`);
  const tenths = Math.floor((basisPoints(Math.abs(x)) + 500) / 1000);
  const sign = x < 0 && tenths !== 0 ? "-" : "";
  return `${sign}${Math.trunc(tenths / 10)}.${tenths % 10}`;
}

/**
 * An ISO date: the day without a leading zero and the short month, plus the year when it is not the
 * edition's year ("2026-08-31" → "31 Aug" in a 2026 edition, "30 Dec 2025" for "2025-12-30" in a 2026
 * edition). For the year always shown, use shortDate() from lib/format.ts.
 */
export function fmtDate(date: string, editionDate: string): string {
  if (!isValidDate(editionDate)) throw new RangeError(`fmtDate needs a valid edition date, got ${editionDate}`);
  return date.slice(0, 4) === editionDate.slice(0, 4) ? dayMonth(date) : shortDate(date);
}
