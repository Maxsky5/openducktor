import { describe, expect, test } from "bun:test";
import type { UsageFigure, UsagePeriod } from "@openducktor/contracts";
import {
  figureGaps,
  labelDates,
  missingReason,
  partialTotalText,
  periodTotal,
  shareOf,
} from "./usage-format";

const figure = (overrides: Partial<UsageFigure> = {}): UsageFigure => ({
  tokens: { input: 100, cacheRead: 800, cacheWrite: 50, output: 50, processed: 1_000 },
  unmeasured: 0,
  sessions: 2,
  complete: true,
  cost: { usd: 4, state: "complete", unpricedTokens: 0 },
  ...overrides,
});

const NO_TOKENS = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, processed: 0 };

/** A zero that unread history cannot confirm. */
const unconfirmedZero = (): UsageFigure =>
  figure({
    tokens: NO_TOKENS,
    sessions: 0,
    complete: false,
    cost: { usd: 0, state: "none", unpricedTokens: 0 },
  });

const period = (runtimes: UsagePeriod["runtimes"]): UsagePeriod => ({
  start: "2026-11-20",
  end: "2026-11-20",
  runtimes,
});

describe("figureGaps", () => {
  test("names what a value leaves out in each metric", () => {
    const gappy = figure({
      unmeasured: 3,
      complete: false,
      cost: { usd: 4, state: "partial", unpricedTokens: 200 },
    });
    expect(figureGaps(gappy, "tokens")).toEqual(["uncounted", "unread"]);
    expect(figureGaps(gappy, "cost")).toEqual(["unpriced", "unread"]);
    expect(figureGaps(figure(), "cost")).toEqual([]);
  });

  test("gives the reason of a missing value", () => {
    const noCounts = figure({
      tokens: NO_TOKENS,
      unmeasured: 1,
      cost: { usd: 0, state: "unavailable", unpricedTokens: 0 },
    });
    expect(missingReason(noCounts, "tokens")).toBe("These requests have no token counts.");
    expect(missingReason(noCounts, "cost")).toBe("These requests have no token counts.");
    expect(
      missingReason(
        figure({ cost: { usd: 0, state: "unavailable", unpricedTokens: 1_000 } }),
        "cost",
      ),
    ).toBe("The rate catalog lists no rate for this usage.");
    expect(missingReason(unconfirmedZero(), "tokens")).toBe(
      "Some history could not be read, so a zero is not confirmed.",
    );
    expect(missingReason(figure({ complete: false }), "tokens")).toBeNull();
  });
});

describe("shareOf", () => {
  test("gives no share to an unconfirmed zero or a missing total", () => {
    expect(shareOf(figure(), 4_000, "tokens")).toBe(0.25);
    expect(shareOf(unconfirmedZero(), 4_000, "tokens")).toBeNull();
    expect(shareOf(figure(), null, "tokens")).toBeNull();
    expect(shareOf(figure(), 0, "tokens")).toBeNull();
  });
});

describe("periodTotal", () => {
  test("sums the shown values and keeps the runtime order", () => {
    const total = periodTotal(
      period([
        { runtime: "codex", figure: figure() },
        {
          runtime: "claude",
          figure: figure({ cost: { usd: 1, state: "complete", unpricedTokens: 0 } }),
        },
      ]),
      ["claude", "codex", "opencode"],
      "cost",
    );
    expect(total.value).toBe(5);
    expect(total.partial).toBe(false);
    expect(total.parts.map((part) => [part.runtime, part.value])).toEqual([
      ["claude", 1],
      ["codex", 4],
      ["opencode", 0],
    ]);
  });

  test("is partial when a value is missing", () => {
    const total = periodTotal(
      period([
        { runtime: "claude", figure: figure() },
        {
          runtime: "codex",
          figure: figure({ cost: { usd: 0, state: "unavailable", unpricedTokens: 1_000 } }),
        },
      ]),
      ["claude", "codex"],
      "cost",
    );
    expect(total).toMatchObject({ value: 4, partial: true, gaps: ["unpriced"] });
    expect(partialTotalText(total.gaps)).toBe("Total of the known values. Some usage has no rate.");
  });

  test("is partial when a figure has unread history", () => {
    const total = periodTotal(
      period([{ runtime: "claude", figure: figure({ complete: false }) }]),
      ["claude"],
      "tokens",
    );
    expect(total).toMatchObject({ value: 1_000, partial: true, gaps: ["unread"] });
  });

  test("names a gap that leaves the total whole, without the partial mark", () => {
    const total = periodTotal(
      period([
        {
          runtime: "claude",
          figure: figure({ cost: { usd: 4, state: "partial", unpricedTokens: 200 } }),
        },
      ]),
      ["claude"],
      "cost",
    );
    expect(total).toMatchObject({ value: 4, partial: false, gaps: ["unpriced"] });
  });
});

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
