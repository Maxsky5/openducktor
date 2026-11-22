import { describe, expect, test } from "bun:test";
import {
  addDays,
  createUsageCalendar,
  usageGranularity,
  usagePeriods,
  usageReadRange,
  usageReportPeriods,
} from "./usage-calendar";

describe("createUsageCalendar", () => {
  const paris = createUsageCalendar("Europe/Paris");

  test("gives the local date of an instant", () => {
    expect(paris.dateOf(Date.parse("2026-11-20T22:59:59Z"))).toBe("2026-11-20");
    expect(paris.dateOf(Date.parse("2026-11-20T23:00:00Z"))).toBe("2026-11-21");
  });

  test("starts a date at local midnight across a daylight saving change", () => {
    expect(paris.startOf("2026-03-29")).toBe(Date.parse("2026-03-28T23:00:00Z"));
    expect(paris.startOf("2026-03-30")).toBe(Date.parse("2026-03-29T22:00:00Z"));
    expect(paris.startOf("2026-10-26")).toBe(Date.parse("2026-10-25T23:00:00Z"));
  });
});

describe("usageGranularity", () => {
  test("uses days up to 92 days, weeks up to 371 days, then months", () => {
    expect(usageGranularity("2026-01-01", "2026-04-02")).toBe("day");
    expect(usageGranularity("2026-01-01", "2026-04-03")).toBe("week");
    expect(usageGranularity("2026-01-01", "2027-01-06")).toBe("week");
    expect(usageGranularity("2026-01-01", "2027-01-07")).toBe("month");
  });
});

describe("usagePeriods", () => {
  test("clips the first and last ISO weeks to the range", () => {
    expect(usagePeriods("2026-11-04", "2026-11-17", "week")).toEqual([
      { start: "2026-11-04", end: "2026-11-08" },
      { start: "2026-11-09", end: "2026-11-15" },
      { start: "2026-11-16", end: "2026-11-17" },
    ]);
  });

  test("groups calendar months across a year end", () => {
    expect(usagePeriods("2026-11-15", "2027-01-10", "month")).toEqual([
      { start: "2026-11-15", end: "2026-11-30" },
      { start: "2026-12-01", end: "2026-12-31" },
      { start: "2027-01-01", end: "2027-01-10" },
    ]);
  });
});

describe("createUsageCalendar where a change skips midnight", () => {
  test("starts the date at its first local instant", () => {
    const santiago = createUsageCalendar("America/Santiago");
    const start = santiago.startOf("2024-09-08");
    expect(santiago.dateOf(start)).toBe("2024-09-08");
    expect(santiago.dateOf(start - 1)).toBe("2024-09-07");
  });
});

describe("calendar arithmetic", () => {
  test("keeps early years and stays monotonic", () => {
    expect(addDays("0001-01-01", 1)).toBe("0001-01-02");
    expect(usagePeriods("2999-12-30", "2999-12-31", "day")).toEqual([
      { start: "2999-12-30", end: "2999-12-30" },
      { start: "2999-12-31", end: "2999-12-31" },
    ]);
  });
});

describe("usageReadRange", () => {
  test("ends a recent range today and counts today", () => {
    expect(usageReadRange({ kind: "last_7_days" }, "2026-11-21")).toEqual({
      start: "2026-11-15",
      end: "2026-11-21",
    });
    expect(usageReadRange({ kind: "last_90_days" }, "2026-11-21").start).toBe("2026-08-24");
    expect(usageReadRange({ kind: "all_time" }, "2026-11-21")).toEqual({
      start: null,
      end: "2026-11-21",
    });
  });
});

describe("usageReportPeriods", () => {
  test("starts All time at the earliest activity of the selected runtimes", () => {
    const earliest = { claude: "2026-09-19", codex: "2026-03-16" };
    const startOf = (runtimes: ("claude" | "codex" | "opencode")[]) =>
      usageReportPeriods({ start: null, end: "2026-11-21" }, earliest, runtimes).range.start;
    expect(startOf(["claude"])).toBe("2026-09-19");
    expect(startOf(["claude", "codex"])).toBe("2026-03-16");
    expect(startOf(["opencode"])).toBe("2026-11-21");
  });

  test("keeps a fixed start and splits the range by its granularity", () => {
    const report = usageReportPeriods({ start: "2026-11-02", end: "2026-11-04" }, {}, ["claude"]);
    expect(report.granularity).toBe("day");
    expect(report.periods.map((period) => period.start)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
    ]);
  });
});
