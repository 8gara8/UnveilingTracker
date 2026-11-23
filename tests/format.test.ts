// lib/format.ts (SPEC §5.2's `<d Mon>`, §5.8's `<d Mon YYYY>` and their Chinese forms, §4.1 dates in Taipei
// time): the date formatters, each on hand-made dates, in both languages. Cyber's cases (tests/helpers.test.ts at
// the fork commit 3ced1fb) are adapted; the Chinese forms are new and are checked against the spec's own examples.
import { afterEach, describe, expect, it } from "vitest";
import { taipeiDateOf, taipeiTime as datesTaipeiTime, taipeiToday } from "@/lib/dates";
import { dayMonth, longDate, monthShort, shortDate, taipeiTime, zhDate, zhDayMonth } from "@/lib/format";

describe("monthShort", () => {
  it("is the three-letter month without a period, Sep for September (the form ZH_PARITY reads, §4.12)", () => {
    expect(Array.from({ length: 12 }, (_, i) => monthShort(i + 1))).toEqual(
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    );
  });

  it("throws on a month that does not exist", () => {
    for (const bad of [0, 13, -1, 1.5, Number.NaN]) expect(() => monthShort(bad), String(bad)).toThrow("Invalid month");
  });
});

describe("longDate, shortDate and dayMonth", () => {
  it("write the weekday, day, month and year in full for the brief's heading", () => {
    expect(longDate("2026-11-23")).toBe("Monday 23 November 2026");
    expect(longDate("2026-11-22")).toBe("Sunday 22 November 2026");
    expect(longDate("2028-02-29")).toBe("Tuesday 29 February 2028");
    expect(longDate("2026-01-01")).toBe("Thursday 1 January 2026");
  });

  it("name every month and every weekday, on the first day of each month of 2026", () => {
    const firsts: [string, string][] = [
      ["2026-01-01", "Thursday 1 January 2026"], ["2026-02-01", "Sunday 1 February 2026"], ["2026-03-01", "Sunday 1 March 2026"],
      ["2026-04-01", "Wednesday 1 April 2026"], ["2026-05-01", "Friday 1 May 2026"], ["2026-06-01", "Monday 1 June 2026"],
      ["2026-07-01", "Wednesday 1 July 2026"], ["2026-08-01", "Saturday 1 August 2026"], ["2026-09-01", "Tuesday 1 September 2026"],
      ["2026-10-01", "Thursday 1 October 2026"], ["2026-11-01", "Sunday 1 November 2026"], ["2026-12-01", "Tuesday 1 December 2026"],
    ];
    for (const [date, expected] of firsts) expect(longDate(date), date).toBe(expected);
  });

  it("write the day without a leading zero and the month short, with or without the year", () => {
    expect(shortDate("2026-08-31")).toBe("31 Aug 2026");
    expect(shortDate("2026-09-05")).toBe("5 Sep 2026");
    expect(dayMonth("2026-08-31")).toBe("31 Aug");
    expect(dayMonth("2026-01-01")).toBe("1 Jan");
    expect(dayMonth("2025-12-30")).toBe("30 Dec");
  });

  it("fill the spec's templates: the Pace sentence's `to <d Mon>` and the rung note's `on <d Mon YYYY>`", () => {
    expect(`in the 13 weeks to ${dayMonth("2026-08-31")}.`).toBe("in the 13 weeks to 31 Aug.");
    expect(`Retracted by Springer Nature on ${shortDate("2025-03-07")}.`).toBe("Retracted by Springer Nature on 7 Mar 2025.");
  });
});

describe("zhDayMonth and zhDate", () => {
  it("write the month and day as numerals set apart from the Han characters by spaces", () => {
    expect(zhDayMonth("2026-08-31")).toBe("8 月 31 日");
    expect(zhDayMonth("2026-12-05")).toBe("12 月 5 日");
    expect(zhDayMonth("2026-01-01")).toBe("1 月 1 日");
    expect(zhDate("2026-08-31")).toBe("2026 年 8 月 31 日");
    expect(zhDate("2025-03-07")).toBe("2025 年 3 月 7 日");
  });

  it("fill the spec's Chinese examples: the Pace sentence's 「截至 8 月 31 日」 and the rung note's `於 <YYYY> 年 <M> 月 <d> 日撤稿`", () => {
    expect(`截至 ${zhDayMonth("2026-08-31")}的 13 週內`).toBe("截至 8 月 31 日的 13 週內");
    expect(`Springer Nature 於 ${zhDate("2025-03-07")}撤稿。`).toBe("Springer Nature 於 2025 年 3 月 7 日撤稿。");
  });

  it("name the same day as the English forms", () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (const date of ["2026-02-28", "2026-10-09", "2027-07-14", "2028-02-29"]) {
      const [y, m, d] = date.split("-").map(Number);
      expect(zhDayMonth(date)).toBe(`${m} 月 ${d} 日`);
      expect(zhDate(date)).toBe(`${y} 年 ${m} 月 ${d} 日`);
      const [dayText, monthText] = dayMonth(date).split(" ");
      expect(Number(dayText)).toBe(d);
      expect(months.indexOf(monthText!) + 1).toBe(m);
      expect(shortDate(date)).toBe(`${dayMonth(date)} ${y}`);
    }
  });
});

describe("invalid dates", () => {
  it("throw from every formatter, never format a rolled-over or malformed date", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "26-1-1", "2026-1-1", "", "2026-11-23T04:00:00+08:00", "yesterday"]) {
      for (const format of [longDate, shortDate, dayMonth, zhDayMonth, zhDate]) {
        expect(() => format(bad), `${format.name}(${JSON.stringify(bad)})`).toThrow("Invalid date");
      }
    }
  });
});

describe("Taipei time (SPEC §4.1: dates are Taipei dates, clock times UTC+8 with no daylight saving)", () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("re-exports lib/dates.ts' taipeiTime, which reads HH:MM from an ISO timestamp or a Date", () => {
    expect(taipeiTime).toBe(datesTaipeiTime);
    expect(taipeiTime("2026-11-22T20:15:00Z")).toBe("04:15");
    expect(taipeiTime("2026-11-23T04:30:35+08:00")).toBe("04:30");
    expect(taipeiTime(new Date("2026-11-22T16:00:00Z"))).toBe("00:00");
    expect(taipeiTime("2026-11-22T15:59:59Z")).toBe("23:59");
  });

  it("formats the Taipei date of an instant, not its UTC date: 17:30 UTC on a Sunday is Monday morning in Taipei", () => {
    const instant = "2026-11-22T17:30:00Z";
    expect(taipeiDateOf(instant)).toBe("2026-11-23");
    expect(taipeiToday(new Date(instant))).toBe("2026-11-23");
    expect(longDate(taipeiDateOf(instant))).toBe("Monday 23 November 2026");
    expect(zhDate(taipeiDateOf(instant))).toBe("2026 年 11 月 23 日");
    expect(taipeiTime(instant)).toBe("01:30");
    expect(longDate(instant.slice(0, 10))).toBe("Sunday 22 November 2026");
  });

  it("gives the same strings whatever zone the machine is in, one that skipped a whole day included", () => {
    const at = (tz: string) => {
      process.env.TZ = tz;
      return [longDate("2026-11-23"), shortDate("2026-03-08"), dayMonth("2026-10-25"), zhDayMonth("2026-03-29"), zhDate("2026-01-01"),
        taipeiTime("2026-11-22T20:15:00Z"), taipeiDateOf("2026-11-22T17:30:00Z"), longDate("2011-12-30")];
    };
    // Samoa moved across the date line and skipped 30 December 2011: local midnight did not exist that day.
    const expected = ["Monday 23 November 2026", "8 Mar 2026", "25 Oct", "3 月 29 日", "2026 年 1 月 1 日", "04:15", "2026-11-23", "Friday 30 December 2011"];
    for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Pacific/Apia", "Europe/London", "Asia/Taipei"]) {
      expect(at(tz), tz).toEqual(expected);
    }
  });
});
