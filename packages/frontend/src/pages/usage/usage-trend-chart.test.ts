import { describe, expect, test } from "bun:test";
import type { UsagePeriod } from "@openducktor/contracts";
import { labelDates } from "./usage-trend-chart";

const days = (start: string, count: number): UsagePeriod[] =>
  Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.parse(`${start}T00:00:00Z`) + index * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { start: date, end: date, runtimes: [] };
  });

const labels = (periods: UsagePeriod[], count: number) =>
  labelDates(periods, count, "day").map((date) => date.toISOString().slice(0, 10));

describe("labelDates", () => {
  test("steps back from the last day in whole weeks and keeps the first day", () => {
    expect(labels(days("2026-10-24", 30), 5)).toEqual([
      "2026-10-24",
      "2026-11-01",
      "2026-11-08",
      "2026-11-15",
      "2026-11-22",
    ]);
  });

  test("gives a narrow plot the first, a middle, and the last day", () => {
    expect(labels(days("2026-10-24", 30), 3)).toEqual(["2026-10-24", "2026-11-08", "2026-11-22"]);
  });

  test("labels every day of a short range", () => {
    expect(labels(days("2026-11-16", 7), 7)).toHaveLength(7);
  });
});
