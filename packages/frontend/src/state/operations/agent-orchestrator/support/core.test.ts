import { describe, expect, test } from "bun:test";
import {
  createRepoStaleGuard,
  runningStates,
  shouldStartSessionListener,
  throwIfRepoStale,
  toBaseUrl,
} from "./core";

describe("agent-orchestrator/support/core", () => {
  test("exposes expected runtime constants", () => {
    expect(runningStates.has("running")).toBe(true);
    expect(runningStates.has("closed")).toBe(false);
    expect(toBaseUrl(4444)).toBe("http://127.0.0.1:4444");
  });

  test("restarts listener only for non-error runtime sessions", () => {
    expect(shouldStartSessionListener("running", false)).toBe(true);
    expect(shouldStartSessionListener("idle", true)).toBe(false);
    expect(shouldStartSessionListener("error", false)).toBe(false);
  });

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
