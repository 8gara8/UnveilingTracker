// lib/dates.ts and lib/json.ts (SPEC §4.1). Cyber's tests/lib.test.ts at the fork commit, adapted: only the
// date cases, with this project's data cutoff, 13-week window and 2015 to 2019 baseline; the json cases are
// new; the URL, word-count and blocked-host cases return in P1 with lib/urls.ts, lib/text.ts and
// lib/vocab.ts (docs/PROVENANCE.md).
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  addDays, at, dataCutoffFor, daysBetween, inRange, isMonday, isoWeekStart, isValidDate, lastSunday, newestCompleteWeek,
  taipeiDateOf, taipeiTime, taipeiTimestamp, taipeiToday, utcDateOf, weekday, windowEnding,
} from "@/lib/dates";
import { jsonText, sha256Hex } from "@/lib/json";

describe("dates", () => {
  const keepTz = process.env.TZ;
  afterEach(() => {
    if (keepTz === undefined) delete process.env.TZ;
    else process.env.TZ = keepTz;
  });

  it("validates calendar dates", () => {
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2026-11-8")).toBe(false);
  });
  it("adds days across months and years", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-04", "2026-11-02")).toBe(29);
    expect(daysBetween("2026-11-02", "2026-10-04")).toBe(-29);
  });
  it("gives Taipei's date and time for a moment, whatever the machine's zone", () => {
    for (const tz of [undefined, "UTC", "America/Los_Angeles", "Asia/Taipei"]) {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
      // 03:15 Taipei is 19:15 UTC the day before (the scheduled task, SPEC §9.3).
      expect(taipeiToday(new Date("2026-11-22T19:15:00Z"))).toBe("2026-11-23");
      expect(taipeiToday(new Date("2026-11-22T15:59:00Z"))).toBe("2026-11-22");
      expect(taipeiDateOf("2026-11-22T23:00:00+01:00")).toBe("2026-11-23");
      expect(taipeiTime("2026-11-22T19:15:00Z")).toBe("03:15");
      expect(taipeiTimestamp(new Date("2026-11-22T19:15:12.345Z"))).toBe("2026-11-23T03:15:12+08:00");
    }
  });
  it("reads HH:MM as Taipei time", () => {
    expect(new Date(at("2026-11-23", "03:15")).toISOString()).toBe("2026-11-22T19:15:00.000Z");
    expect(new Date(at("2026-11-23", "04:25")).toISOString()).toBe("2026-11-22T20:25:00.000Z");
    expect(() => at("2026-11-23", "3:15")).toThrow();
  });
  it("reads timestamps as UTC dates, including ones without a zone", () => {
    for (const tz of [undefined, "Asia/Taipei", "America/Los_Angeles"]) {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
      expect(utcDateOf("2022-09-05T09:50:09")).toBe("2022-09-05");
      expect(utcDateOf("2026-11-06T23:59:59.000Z")).toBe("2026-11-06");
      expect(utcDateOf("2026-11-07T05:00:00+08:00")).toBe("2026-11-06");
      expect(utcDateOf("2026-11-06T20:00:00-0500")).toBe("2026-11-07");
      expect(utcDateOf("2026-11-06")).toBe("2026-11-06");
    }
    expect(() => utcDateOf("not a date")).toThrow();
    expect(() => utcDateOf("2026-02-30T00:00:00")).toThrow();
    for (const bad of ["2026-11-06T25:00:00", "2026-11-06T24:00:00", "2026-11-06T23:60:00", "2026-11-06T23:59:60", "2026-11-06T24:00:00Z", "2026-11-06T12:00:61+08:00"]) {
      expect(() => utcDateOf(bad), bad).toThrow();
    }
    expect(utcDateOf("2026-11-06T23:59:59.999")).toBe("2026-11-06");
  });
  it("puts the Pace's newest week in the newest ISO week ending at least 2 days before the edition (SPEC §4.1)", () => {
    expect(dataCutoffFor("2026-11-23")).toBe("2026-11-21");
    // A Monday edition: the week that ended the day before is too recent; the week before it is the newest.
    expect(lastSunday(dataCutoffFor("2026-11-23"))).toBe("2026-11-15");
    expect(newestCompleteWeek(dataCutoffFor("2026-11-23"))).toBe("2026-11-09");
    // A Tuesday edition: Sunday is exactly 2 days back, so that week counts.
    expect(lastSunday(dataCutoffFor("2026-11-24"))).toBe("2026-11-22");
    expect(dataCutoffFor("2027-01-01")).toBe("2026-12-30");
  });
  it("puts the 13-week window before the 8 provisional weeks, and the year-ago window 52 weeks back (SPEC §5.3)", () => {
    const cutoff = lastSunday(dataCutoffFor("2026-11-23"));
    const provisionalFrom = addDays(cutoff, -(7 * 8 - 1));
    expect([cutoff, provisionalFrom]).toEqual(["2026-11-15", "2026-09-21"]);
    const window = windowEnding(addDays(provisionalFrom, -1), 7 * 13);
    expect(window).toEqual({ from: "2026-06-22", to: "2026-09-20" });
    expect([isMonday(window.from), weekday(window.to)]).toEqual([true, 0]);
    expect([addDays(window.from, -364), addDays(window.to, -364)]).toEqual(["2025-06-23", "2025-09-21"]);
    expect(windowEnding("2026-11-06", 1)).toEqual({ from: "2026-11-06", to: "2026-11-06" });
    expect(() => windowEnding("2026-11-06", 0)).toThrow();
  });
  it("counts the 2015 to 2019 baseline as 260 whole ISO weeks (SPEC §5.3)", () => {
    expect(isMonday("2015-01-05")).toBe(true);
    expect(weekday("2019-12-29")).toBe(0);
    expect(daysBetween("2015-01-05", addDays("2019-12-29", 1)) / 7).toBe(260);
  });
  it("names ISO weeks by their Monday", () => {
    expect(weekday("2026-11-22")).toBe(0);
    expect(isMonday("2026-11-23")).toBe(true);
    expect(isoWeekStart("2026-11-22")).toBe("2026-11-16");
    expect(isoWeekStart("2026-11-16")).toBe("2026-11-16");
    expect(lastSunday("2026-11-20")).toBe("2026-11-15");
    expect(lastSunday("2026-11-22")).toBe("2026-11-22");
  });
  it("checks inclusive ranges", () => {
    expect(inRange("2026-11-15", "2026-08-17", "2026-11-15")).toBe(true);
    expect(inRange("2026-08-16", "2026-08-17", "2026-11-15")).toBe(false);
  });
});

describe("json", () => {
  it("prints two-space JSON with a trailing newline, keys in the schema's order", () => {
    expect(jsonText({ b: 1, a: [1, 2] })).toBe('{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}\n');
    const schema = z.strictObject({ a: z.number(), b: z.string() });
    expect(jsonText({ b: "x", a: 1 }, schema)).toBe('{\n  "a": 1,\n  "b": "x"\n}\n');
    expect(() => jsonText({ a: "not a number", b: "x" }, schema)).toThrow();
  });
  it("hashes strings as UTF-8 and buffers as bytes", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("數學")).toBe(sha256Hex(Buffer.from("數學", "utf8")));
  });
});
