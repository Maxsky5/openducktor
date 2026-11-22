import { describe, expect, test } from "bun:test";
import type { UsageFigure, UsageReport } from "@openducktor/contracts";
import { usageHighlights } from "./usage-report";

const NO_TOKENS = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, processed: 0 };

const figure = (processed: number, overrides: Partial<UsageFigure> = {}): UsageFigure => ({
  tokens: {
    input: processed / 4,
    cacheRead: processed / 2,
    cacheWrite: 0,
    output: processed / 4,
    processed,
  },
  unmeasured: 0,
  sessions: 1,
  complete: true,
  cost: { usd: processed / 100, state: "complete", unpricedTokens: 0 },
  ...overrides,
});

const report = (overrides: Partial<UsageReport> = {}): UsageReport => ({
  timeZone: "UTC",
  range: { start: "2026-11-18", end: "2026-11-20" },
  granularity: "day",
  resultAt: "2026-11-21T10:00:00.000Z",
  pricing: { source: "models.dev", updatedAt: null, issue: null },
  totals: figure(4_000, { sessions: 4 }),
  periods: [
    {
      start: "2026-11-18",
      end: "2026-11-18",
      runtimes: [{ runtime: "claude", figure: figure(1_000) }],
    },
    { start: "2026-11-19", end: "2026-11-19", runtimes: [] },
    {
      start: "2026-11-20",
      end: "2026-11-20",
      runtimes: [
        { runtime: "claude", figure: figure(1_000) },
        { runtime: "codex", figure: figure(2_000) },
      ],
    },
  ],
  byRuntime: [
    { runtime: "claude", figure: figure(2_000) },
    { runtime: "codex", figure: figure(2_000) },
  ],
  byModel: [],
  byProject: [],
  coverage: [],
  ...overrides,
});

describe("usageHighlights", () => {
  test("gives the cache hit rate, the busiest period, and the averages", () => {
    const highlights = usageHighlights(report(), "tokens");
    // 2,000 cache reads of 3,000 input-side tokens.
    expect(highlights.cacheHit.rate).toBeCloseTo(2 / 3);
    expect(highlights.values).toEqual([1_000, 0, 3_000]);
    expect(highlights.busiest).toMatchObject({ value: 3_000, index: 2 });
    expect(highlights.busiest.period?.start).toBe("2026-11-20");
    // The average spreads the total over every period, also the quiet one.
    expect(highlights.average).toMatchObject({ value: 4_000 / 3, activeCount: 2 });
    expect(highlights.perSession.value).toBe(1_000);
    expect(highlights.note).toBeNull();
  });

  test("shows dashes with their reasons when the range has no value", () => {
    const empty = figure(0, { tokens: NO_TOKENS, sessions: 0 });
    const highlights = usageHighlights(
      report({ totals: empty, periods: [], byRuntime: [] }),
      "tokens",
    );
    expect(highlights.cacheHit).toMatchObject({
      rate: null,
      missing: "No input tokens in this range.",
    });
    expect(highlights.busiest).toMatchObject({ value: null, missing: "No day with a value." });
    expect(highlights.average).toMatchObject({ value: null, missing: "No day with a value." });
    expect(highlights.perSession).toMatchObject({
      value: null,
      missing: "No sessions in this range.",
    });
  });

  test("names what the values leave out", () => {
    const highlights = usageHighlights(
      report({
        totals: figure(4_000, {
          complete: false,
          cost: { usd: 40, state: "partial", unpricedTokens: 500 },
        }),
      }),
      "cost",
    );
    expect(highlights.note).toBe(
      "This value leaves out usage without a published rate. Some history of this range could not be read, so this value can be higher.",
    );
    expect(highlights.cacheHit.note).toBe(
      "Some history of this range could not be read, so this value can be higher.",
    );
  });
});
