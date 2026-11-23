// Date and time formatters for page text, the chat edition and the site (SPEC §5.2's `<d Mon>`, §5.8's
// `<d Mon YYYY>` and the Chinese forms beside them, §7 "Script-written page text"). Pure string work on
// "YYYY-MM-DD" calendar dates, so no machine time zone leaks in; clock times are Taipei (UTC+8, no daylight
// saving, lib/dates.ts). §5.2's number helpers (pct1, fmtPct, fmtInt, fmt1, fmtDate) are in
// lib/metrics/stats.ts.
// Cyber's lib/format.ts at the fork commit 3ced1fb, adapted: the Chinese forms zhDayMonth() and zhDate() are
// new, since every date in a Pace sentence or a script-written note has a Chinese twin (§5.2, §5.8); rfc822()
// is left out, because only P4's RSS route reads it (SPEC §6 `/feed.xml`).

import { isValidDate } from "./dates";

export { taipeiTime } from "./dates";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
  "December"] as const;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function parts(date: string): { y: number; m: number; d: number; dow: number } {
  if (!isValidDate(date)) throw new Error(`Invalid date: ${date}`);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** The month's three-letter English abbreviation, without a period: "Jan" to "Dec" ("Sep" for September). */
export function monthShort(month: number): string {
  const name = MONTHS[month - 1];
  if (!name) throw new Error(`Invalid month: ${month}`);
  return name.slice(0, 3);
}

/** "Sunday 8 November 2026": the brief's h1, page titles, the archive list and edition links. */
export function longDate(date: string): string {
  const { y, m, d, dow } = parts(date);
  return `${DAYS[dow]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "7 Nov 2026": §5.8's `<d Mon YYYY>`, and §5.2's fmtDate() form with the year always shown. */
export function shortDate(date: string): string {
  const { y, m, d } = parts(date);
  return `${d} ${monthShort(m)} ${y}`;
}

/** "3 Nov": §5.2's `<d Mon>`, the day without a leading zero and the short month, no year. */
export function dayMonth(date: string): string {
  const { m, d } = parts(date);
  return `${d} ${monthShort(m)}`;
}

/**
 * "11 月 3 日": the Chinese form of dayMonth(), as §5.2's Pace sentence writes it (「截至 8 月 31 日」). Numerals
 * stand apart from the Han characters beside them with a space, as every Chinese string of the spec does.
 */
export function zhDayMonth(date: string): string {
  const { m, d } = parts(date);
  return `${m} 月 ${d} 日`;
}

/** "2026 年 11 月 3 日": the Chinese form of shortDate(), as §5.8's script-written notes write it. */
export function zhDate(date: string): string {
  const { y, m, d } = parts(date);
  return `${y} 年 ${m} 月 ${d} 日`;
}
