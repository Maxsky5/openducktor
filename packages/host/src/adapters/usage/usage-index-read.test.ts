import { describe, expect, test } from "bun:test";
import { knownRuntimeKindValues } from "@openducktor/contracts";
import { createUsageCheckMemo } from "./usage-index-read";

const DAY = 24 * 60 * 60 * 1000;

type Runtimes = readonly (typeof knownRuntimeKindValues)[number][];

const check = (
  checkedAtMs: number,
  runtimes: Runtimes,
  sinceMs: number | null,
  stopped = false,
) => ({
  discovery: { sources: [], unreadablePaths: [], withoutHistory: [], unreadableRuntimes: [] },
  checkedAtMs,
  scope: { runtimes, sinceMs },
  stopped,
});

describe("createUsageCheckMemo", () => {
  test("reuses a recent check for fewer runtimes or a later range start", () => {
    let now = 0;
    const checks = createUsageCheckMemo(() => now);
    const reusable = (runtimes: Runtimes, sinceMs: number | null) =>
      checks.reusable({ runtimes, sinceMs });
    checks.record(check(0, ["claude", "codex"], 30 * DAY));
    now = 60_000;
    expect(reusable(["codex"], 40 * DAY)?.checkedAtMs).toBe(0);
    // Another runtime, or an earlier start, needs a check of its own.
    expect(reusable(["opencode"], 40 * DAY)).toBeNull();
    expect(reusable(["codex"], 10 * DAY)).toBeNull();
    expect(reusable(["codex"], null)).toBeNull();
    now = 5 * 60_000;
    expect(reusable(["codex"], 40 * DAY)).toBeNull();
  });

  test("reuses any range once a check covered all history, and never a stopped check", () => {
    const checks = createUsageCheckMemo(() => 1_000);
    checks.record(check(0, knownRuntimeKindValues, null, true));
    expect(checks.reusable({ runtimes: ["codex"], sinceMs: null })).toBeNull();
    checks.record(check(0, knownRuntimeKindValues, null));
    expect(checks.reusable({ runtimes: ["codex"], sinceMs: 10 * DAY })?.checkedAtMs).toBe(0);
  });

  test("needs a catch-up after a read of a range or of one runtime, until a check covers all history", () => {
    const checks = createUsageCheckMemo(() => 1_000);
    expect(checks.needsCatchUp({ runtimes: knownRuntimeKindValues, sinceMs: null })).toBe(false);
    expect(checks.needsCatchUp({ runtimes: knownRuntimeKindValues, sinceMs: DAY })).toBe(true);
    expect(checks.needsCatchUp({ runtimes: ["codex"], sinceMs: null })).toBe(true);
    // A stopped check of all history does not count.
    checks.record(check(0, knownRuntimeKindValues, null, true));
    expect(checks.needsCatchUp({ runtimes: ["codex"], sinceMs: DAY })).toBe(true);
    checks.record(check(0, knownRuntimeKindValues, null));
    expect(checks.needsCatchUp({ runtimes: ["codex"], sinceMs: DAY })).toBe(false);
  });
});
