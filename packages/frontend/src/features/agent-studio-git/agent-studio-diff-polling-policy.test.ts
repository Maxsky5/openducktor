import { describe, expect, test } from "bun:test";
import {
  createScheduledFetchCooldownKey,
  SCHEDULED_FETCH_COOLDOWN_MS,
  shouldRunScheduledFetch,
} from "./agent-studio-diff-polling-policy";

describe("agent-studio-diff-polling-policy", () => {
  test("keys scheduled fetch cooldowns by repo branch and worktree", () => {
    expect(
      createScheduledFetchCooldownKey({
        repoPath: "/repo",
        targetBranch: "origin/main",
        workingDir: "/repo/.worktrees/task-1",
      }),
    ).toBe("/repo::origin/main::/repo/.worktrees/task-1");
    expect(
      createScheduledFetchCooldownKey({
        repoPath: "/repo",
        targetBranch: "origin/main",
        workingDir: null,
      }),
    ).toBe("/repo::origin/main::");
  });

  test("runs scheduled fetches only after the cooldown expires", () => {
    const fetchedAtMs = 1_731_000_000_000;

    expect(shouldRunScheduledFetch({ lastFetchedAtMs: null, nowMs: fetchedAtMs })).toBe(true);
    expect(
      shouldRunScheduledFetch({
        lastFetchedAtMs: fetchedAtMs,
        nowMs: fetchedAtMs + SCHEDULED_FETCH_COOLDOWN_MS - 1,
      }),
    ).toBe(false);
    expect(
      shouldRunScheduledFetch({
        lastFetchedAtMs: fetchedAtMs,
        nowMs: fetchedAtMs + SCHEDULED_FETCH_COOLDOWN_MS,
      }),
    ).toBe(true);
  });
});
