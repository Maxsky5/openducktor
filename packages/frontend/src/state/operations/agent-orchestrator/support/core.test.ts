import { describe, expect, test } from "bun:test";
import { createRepoStaleGuard, throwIfRepoStale } from "./core";

describe("agent-orchestrator/support/core", () => {
  test("creates a stale-repo guard bound to initial repo epoch", () => {
    const repoEpochRef = { current: 3 };
    const currentWorkspaceRepoPathRef = { current: "/repo/a" as string | null };
    const isStale = createRepoStaleGuard({
      repoPath: "/repo/a",
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    });

    expect(isStale()).toBe(false);
    repoEpochRef.current = 4;
    expect(isStale()).toBe(true);
  });

  test("uses only the stable current workspace repo path ref", () => {
    const repoEpochRef = { current: 1 };
    const currentWorkspaceRepoPathRef = { current: "/repo/a" as string | null };
    const isStale = createRepoStaleGuard({
      repoPath: "/repo/a",
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    });

    expect(isStale()).toBe(false);
    currentWorkspaceRepoPathRef.current = "/repo/b";
    expect(isStale()).toBe(true);
  });

  test("throws when stale guard reports changed repo", () => {
    expect(() => throwIfRepoStale(() => false, "stale")).not.toThrow();
    expect(() => throwIfRepoStale(() => true, "stale")).toThrow("stale");
  });
});
