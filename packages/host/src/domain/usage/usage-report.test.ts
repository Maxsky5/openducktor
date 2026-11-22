import { describe, expect, test } from "bun:test";
import type { RuntimeKind } from "@openducktor/contracts";
import { usagePeriods } from "./usage-calendar";
import { EMPTY_USAGE_SUMS, type UsageSums } from "./usage-figure";
import { type UsageIndexFigures, usageReport } from "./usage-report";

const sums = (values: Partial<UsageSums>): UsageSums => ({ ...EMPTY_USAGE_SUMS, ...values });

const ALL: RuntimeKind[] = ["opencode", "codex", "claude"];

/** The figures of a daily range without activity, with the given changes. */
const figures = (
  changes: Partial<UsageIndexFigures> = {},
  range = { start: "2026-11-02", end: "2026-11-04" },
): UsageIndexFigures => ({
  resultAtMs: Date.parse("2026-11-21T12:00:00Z"),
  range,
  granularity: "day",
  periodBounds: usagePeriods(range.start, range.end, "day"),
  withoutHistory: [],
  issues: [],
  byRuntime: [],
  periods: [],
  byModel: [],
  byProject: [],
  projects: [],
  pricing: {
    source: "models.dev",
    updatedAtMs: Date.parse("2026-11-21T08:00:00Z"),
    failure: null,
  },
  ...changes,
});

const report = (changes: Partial<UsageIndexFigures>, runtimes = ALL) =>
  usageReport({ timeZone: "UTC", runtimes, figures: figures(changes) });

describe("usageReport", () => {
  test("marks only the figures whose dates an issue covers as incomplete", () => {
    const result = report({
      issues: [
        {
          runtime: "codex",
          scope: "source",
          code: "malformed_records",
          firstAtMs: Date.parse("2026-11-03T10:00:00Z"),
          lastAtMs: Date.parse("2026-11-03T11:00:00Z"),
        },
      ],
      byRuntime: [
        { runtime: "codex", ...sums({ input: 5, sessions: 1, costUsd: 1 }) },
        { runtime: "claude", ...sums({ input: 7, sessions: 2, costUsd: 2 }) },
      ],
      periods: [{ period: 1, runtime: "codex", ...sums({ input: 5, sessions: 1 }) }],
    });
    expect(result.totals.complete).toBe(false);
    expect(result.totals.tokens.input).toBe(12);
    expect(result.totals.sessions).toBe(3);
    expect(result.byRuntime.map((row) => [row.runtime, row.figure.complete])).toEqual([
      ["opencode", true],
      ["codex", false],
      ["claude", true],
    ]);
    const codexCells = result.periods.map(
      (period) => period.runtimes.find((cell) => cell.runtime === "codex")?.figure,
    );
    expect(codexCells.map((figure) => figure?.complete)).toEqual([true, false, true]);
    expect(codexCells.map((figure) => figure?.tokens.input)).toEqual([0, 5, 0]);
    const codex = result.coverage.find((entry) => entry.runtime === "codex");
    expect(codex?.state).toBe("partial");
    expect(codex?.issues.map((issue) => issue.message)).toEqual([
      "1 file of the Codex history has records that OpenDucktor cannot parse or attribute to one session. The figures leave those records out.",
    ]);
  });

  test("marks every date of a runtime with an unreadable location as incomplete", () => {
    const result = report({
      issues: [
        {
          runtime: "claude",
          scope: "location",
          code: "unreadable",
          firstAtMs: null,
          lastAtMs: null,
        },
        { runtime: "claude", scope: "source", code: "unreadable", firstAtMs: null, lastAtMs: null },
      ],
    });
    const claude = result.periods.map(
      (period) => period.runtimes.find((cell) => cell.runtime === "claude")?.figure.complete,
    );
    expect(claude).toEqual([false, false, false]);
    expect(
      result.coverage
        .find((entry) => entry.runtime === "claude")
        ?.issues.map((issue) => issue.message),
    ).toEqual([
      "OpenDucktor cannot read some Claude Code history folders or files. Usage shows the history that it can read.",
      "OpenDucktor cannot read 1 file of the Claude Code history.",
    ]);
  });

  test("labels projects without paths and merges a model across runtimes", () => {
    const result = report({
      withoutHistory: ["opencode"],
      byModel: [
        {
          runtime: "claude",
          provider: "anthropic",
          model: "claude-opus-5-5",
          ...sums({ input: 3, sessions: 1 }),
        },
        {
          runtime: "opencode",
          provider: "anthropic",
          model: "claude-opus-5-5",
          ...sums({ input: 4, sessions: 1 }),
        },
      ],
      byProject: [
        { group: "workspace:odt", ...sums({ input: 3 }) },
        { group: "path:/work/app", ...sums({ input: 9 }) },
        { group: "unknown", ...sums({ input: 1 }) },
      ],
      projects: [
        { key: "workspace:odt", workspaceName: "OpenDucktor", path: null },
        { key: "path:/work/app", workspaceName: null, path: "/work/app" },
        { key: "unknown", workspaceName: null, path: null },
      ],
    });
    expect(
      result.byModel.map((row) => [row.model, row.figure.tokens.input, row.figure.sessions]),
    ).toEqual([["claude-opus-5-5", 7, 2]]);
    expect(result.byProject.map((row) => row.label)).toEqual([
      "app",
      "OpenDucktor",
      "Unknown project",
    ]);
    expect(JSON.stringify(result)).not.toContain("/work/app");
    expect(result.coverage.find((entry) => entry.runtime === "opencode")?.state).toBe("no_history");
  });

  test("names a failed rate download with the action that fixes it", () => {
    const failed = (updatedAtMs: number | null) =>
      report({
        pricing: { source: "models.dev", updatedAtMs, failure: "The server answered 503." },
      }).pricing.issue;
    expect(failed(1_000)).toBe(
      "Usage could not update the API rates from models.dev: The server answered 503. Check the network access of the host, then refresh.",
    );
    expect(failed(null)).toStartWith("Usage could not load the API rates from models.dev:");
    expect(report({}).pricing.issue).toBeNull();
  });
});
