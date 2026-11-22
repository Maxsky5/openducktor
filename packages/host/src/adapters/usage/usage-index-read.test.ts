import { describe, expect, test } from "bun:test";
import { knownRuntimeKindValues } from "@openducktor/contracts";
import { createUsageCheckMemo } from "./usage-index-read";

const DAY = 24 * 60 * 60 * 1000;

const check = (
  checkedAtMs: number,
  runtimes: readonly (typeof knownRuntimeKindValues)[number][],
  sinceMs: number | null,
  stopped = false,
) => ({
  discovery: { sources: [], unreadablePaths: [], withoutHistory: [], locationIssues: [] },
  checkedAtMs,
  scope: { runtimes, sinceMs },
  stopped,
  progress: null,
});

describe("createUsageCheckMemo", () => {
  test("reuses a recent check for fewer runtimes or a later range start", () => {
    let now = 0;
    const checks = createUsageCheckMemo(() => now);
    checks.record(check(0, ["claude", "codex"], 30 * DAY));
    now = 60_000;
    expect(checks.reusable(["codex"], 40 * DAY)?.checkedAtMs).toBe(0);
    // Another runtime, or an earlier start, needs a check of its own.
    expect(checks.reusable(["opencode"], 40 * DAY)).toBeNull();
    expect(checks.reusable(["codex"], 10 * DAY)).toBeNull();
    expect(checks.reusable(["codex"], null)).toBeNull();
    now = 5 * 60_000;
    expect(checks.reusable(["codex"], 40 * DAY)).toBeNull();
  });

  test("reuses any range once a check covered all history, and never a stopped check", () => {
    const checks = createUsageCheckMemo(() => 1_000);
    checks.record(check(0, knownRuntimeKindValues, null, true));
    expect(checks.reusable(["codex"], null)).toBeNull();
    checks.record(check(0, knownRuntimeKindValues, null));
    expect(checks.complete()).toBe(true);
    expect(checks.reusable(["codex"], 10 * DAY)?.checkedAtMs).toBe(0);
  });
});
