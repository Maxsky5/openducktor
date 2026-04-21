import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import {
  canEnsureWorkspaceRuntimeForHydration,
  canUseWorkspaceRuntimeForHydration,
} from "./hydration-runtime-policy";

const createRecord = (
  role: AgentSessionRecord["role"],
  workingDirectory: string,
): Pick<AgentSessionRecord, "role" | "workingDirectory"> => ({
  role,
  workingDirectory,
});

describe("canUseWorkspaceRuntimeForHydration", () => {
  test("allows repo-root spec sessions", () => {
    expect(canUseWorkspaceRuntimeForHydration(createRecord("spec", "/tmp/repo"), "/tmp/repo")).toBe(
      true,
    );
  });

  test("allows normalized-equivalent repo-root planner sessions", () => {
    expect(
      canUseWorkspaceRuntimeForHydration(createRecord("planner", "/tmp/repo/"), "/tmp/repo"),
    ).toBe(true);
  });

  test("allows worktree build sessions", () => {
    expect(
      canUseWorkspaceRuntimeForHydration(createRecord("build", "/tmp/repo/worktree"), "/tmp/repo"),
    ).toBe(true);
  });

  test("rejects build sessions outside the repo worktree base", () => {
    expect(
      canUseWorkspaceRuntimeForHydration(createRecord("build", "/tmp/other"), "/tmp/repo"),
    ).toBe(false);
  });

  test("rejects worktree planner sessions", () => {
    expect(
      canUseWorkspaceRuntimeForHydration(
        createRecord("planner", "/tmp/repo/worktree"),
        "/tmp/repo",
      ),
    ).toBe(false);
  });

  test("rejects repo-root qa sessions", () => {
    expect(canUseWorkspaceRuntimeForHydration(createRecord("qa", "/tmp/repo"), "/tmp/repo")).toBe(
      false,
    );
  });
});

describe("canEnsureWorkspaceRuntimeForHydration", () => {
  test("allows repo-root roles to ensure a workspace runtime", () => {
    expect(canEnsureWorkspaceRuntimeForHydration(createRecord("spec", "/tmp/repo"))).toBe(true);
    expect(canEnsureWorkspaceRuntimeForHydration(createRecord("planner", "/tmp/repo"))).toBe(true);
  });

  test("rejects build and qa roles for ensured workspace hydration", () => {
    expect(canEnsureWorkspaceRuntimeForHydration(createRecord("build", "/tmp/repo/task"))).toBe(
      false,
    );
    expect(canEnsureWorkspaceRuntimeForHydration(createRecord("qa", "/tmp/repo/task"))).toBe(false);
  });
});
