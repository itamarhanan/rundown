import { afterEach, describe, expect, it } from "vitest";
import {
  dayWindow,
  isWorkday,
  makeCalendar,
  parseLocalDate,
  previousWorkday,
  sinceLastWorkday,
  weekWindow,
} from "../../src/domain/window";
import { DateTime } from "effect";
const israel = makeCalendar("Asia/Jerusalem", [0, 1, 2, 3, 4]);
const newYork = makeCalendar("America/New_York", [1, 2, 3, 4, 5]);
describe("sinceLastWorkday", () => {
  it("on a Sun–Thu Sunday, reaches back to Thursday and includes the weekend", () => {
    const w = sinceLastWorkday(israel, new Date("2026-11-08T07:00:00Z"));
    expect(w.start.toISOString()).toBe("2026-11-04T22:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-07T22:00:00.000Z");
    expect(w.key).toBe("2026-11-05");
    expect(w.label).toBe("Thu, Nov 5 → today");
  });
  it("on a Mon–Fri Monday, reaches back to Friday", () => {
    const w = sinceLastWorkday(newYork, new Date("2026-11-09T14:00:00Z"));
    expect(w.start.toISOString()).toBe("2026-11-06T05:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(w.key).toBe("2026-11-06");
    expect(w.label).toBe("Fri, Nov 6 → today");
  });
  it("mid-week is just yesterday, labelled without an arrow", () => {
    const w = sinceLastWorkday(newYork, new Date("2026-11-11T14:00:00Z"));
    expect(w.key).toBe("2026-11-10");
    expect(w.label).toBe("Tue, Nov 10");
    expect(w.end.getTime() - w.start.getTime()).toBe(86400000);
  });
  it("spans the DST change as wall-clock days, not 24h multiples", () => {
    const w = sinceLastWorkday(israel, new Date("2026-10-25T07:00:00Z"));
    expect(w.start.toISOString()).toBe("2026-10-21T21:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-24T21:00:00.000Z");
  });
  it("with no workdays configured, falls back to plain yesterday", () => {
    const none = makeCalendar("UTC", []);
    const d = previousWorkday(none, new Date("2026-11-08T12:00:00Z"));
    expect(DateTime.formatIsoDate(d)).toBe("2026-11-07");
  });
});
describe("weekWindow", () => {
  const tue = new Date("2026-11-10T08:00:00Z");
  it("this week runs from the first workday through the end of today", () => {
    const w = weekWindow(israel, tue);
    expect(w.start.toISOString()).toBe("2026-11-07T22:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-10T22:00:00.000Z");
    expect(w.key).toBe("2026-11-08");
    expect(w.label).toBe("Nov 8 – Nov 10");
  });
  it("offset -1 is the whole previous week", () => {
    const w = weekWindow(israel, tue, -1);
    expect(w.key).toBe("2026-11-01");
    expect(w.end.toISOString()).toBe("2026-11-07T22:00:00.000Z");
    expect(w.label).toBe("Nov 1 – Nov 7");
  });
  it("a Mon–Fri week starts on Monday", () => {
    expect(weekWindow(newYork, new Date("2026-11-12T15:00:00Z")).key).toBe("2026-11-09");
    expect(weekWindow(newYork, new Date("2026-11-12T15:00:00Z"), -2).key).toBe("2026-10-26");
  });
  it("a Sat–Wed week that wraps starts on Saturday", () => {
    const satWed = makeCalendar("UTC", [6, 0, 1, 2, 3]);
    expect(weekWindow(satWed, new Date("2026-11-10T12:00:00Z")).key).toBe("2026-11-07");
  });
});
describe("parseLocalDate", () => {
  it("parses YYYY-MM-DD as local noon in the calendar's zone", () => {
    expect(parseLocalDate(israel, "2026-11-05")?.toISOString()).toBe("2026-11-05T10:00:00.000Z");
    expect(dayWindow(israel, parseLocalDate(israel, "2026-11-05")!).key).toBe("2026-11-05");
  });
  it("rejects anything else", () => {
    expect(parseLocalDate(israel, "2026-11-5")).toBeUndefined();
    expect(parseLocalDate(israel, "yesterday")).toBeUndefined();
    expect(parseLocalDate(israel, "")).toBeUndefined();
  });
});
describe("time zone independence", () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
  it("gives the same windows whatever zone the machine is in", () => {
    const now = new Date("2026-11-11T21:30:00Z");
    const results = ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Asia/Jerusalem"].map((tz) => {
      process.env.TZ = tz;
      const w = sinceLastWorkday(israel, now);
      return [
        w.start.toISOString(),
        w.end.toISOString(),
        w.label,
        dayWindow(israel, now).key,
        isWorkday(israel, now),
      ];
    });
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]).toEqual([
      "2026-11-09T22:00:00.000Z",
      "2026-11-10T22:00:00.000Z",
      "Tue, Nov 10",
      "2026-11-11",
      true,
    ]);
  });
  it("decides workdays in the user's zone, not the machine's", () => {
    const fridayIl = new Date("2026-11-12T23:00:00Z");
    expect(isWorkday(israel, fridayIl)).toBe(false);
    expect(isWorkday(makeCalendar("UTC", [0, 1, 2, 3, 4]), fridayIl)).toBe(true);
  });
});
