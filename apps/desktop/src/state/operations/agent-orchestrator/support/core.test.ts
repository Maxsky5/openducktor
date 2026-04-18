import { describe, expect, test } from "bun:test";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  createRepoStaleGuard,
  READ_ONLY_ROLES,
  runningStates,
  shouldReattachListenerForAttachedSession,
  throwIfRepoStale,
  toBaseUrl,
} from "./core";

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

describe("agent-orchestrator/support/core", () => {
  test("exposes expected role and runtime constants", () => {
    expect(READ_ONLY_ROLES.has("spec")).toBe(true);
    expect(READ_ONLY_ROLES.has("build")).toBe(false);
    expect(runningStates.has("running")).toBe(true);
    expect(runningStates.has("closed")).toBe(false);
    expect(toBaseUrl(4444)).toBe("http://127.0.0.1:4444");
  });

  test("reattaches listener only for non-error attached sessions", () => {
    expect(shouldReattachListenerForAttachedSession("running", false)).toBe(true);
    expect(shouldReattachListenerForAttachedSession("idle", true)).toBe(false);
    expect(shouldReattachListenerForAttachedSession("error", false)).toBe(false);
  });

  test("creates a stale-repo guard bound to initial repo epoch", () => {
    const repoEpochRef = { current: 3 };
    const activeWorkspaceRef = {
      current: createActiveWorkspace("/repo/a") as ActiveWorkspace | null,
    };
    const currentWorkspaceRepoPathRef = { current: "/repo/a" as string | null };
    const isStale = createRepoStaleGuard({
      repoPath: "/repo/a",
      repoEpochRef,
      activeWorkspaceRef,
      currentWorkspaceRepoPathRef,
    });

    expect(isStale()).toBe(false);
    repoEpochRef.current = 4;
    expect(isStale()).toBe(true);
  });

  test("prefers the stable current workspace repo path ref", () => {
    const repoEpochRef = { current: 1 };
    const activeWorkspaceRef = {
      current: createActiveWorkspace("/repo/a") as ActiveWorkspace | null,
    };
    const currentWorkspaceRepoPathRef = { current: "/repo/a" as string | null };
    const isStale = createRepoStaleGuard({
      repoPath: "/repo/a",
      repoEpochRef,
      activeWorkspaceRef,
      currentWorkspaceRepoPathRef,
    });

    expect(isStale()).toBe(false);
    activeWorkspaceRef.current = createActiveWorkspace("/repo/b");
    expect(isStale()).toBe(false);
    currentWorkspaceRepoPathRef.current = "/repo/b";
    expect(isStale()).toBe(true);
  });

  test("throws when stale guard reports changed repo", () => {
    expect(() => throwIfRepoStale(() => false, "stale")).not.toThrow();
    expect(() => throwIfRepoStale(() => true, "stale")).toThrow("stale");
  });
});
