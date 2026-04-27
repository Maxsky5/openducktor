import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { canUseWorkspaceRuntimeForHydration } from "./hydration-runtime-policy";

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

  test("rejects non-root build sessions", () => {
    expect(
      canUseWorkspaceRuntimeForHydration(
        createRecord("build", "/tmp/openducktor-worktrees/task-1"),
        "/tmp/repo",
      ),
    ).toBe(false);
  });

  test("rejects build sessions outside the repo root", () => {
    expect(
      canUseWorkspaceRuntimeForHydration(createRecord("build", "/tmp/other-worktree"), "/tmp/repo"),
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

  test("rejects worktree qa sessions", () => {
    expect(
      canUseWorkspaceRuntimeForHydration(createRecord("qa", "/tmp/repo/worktree"), "/tmp/repo"),
    ).toBe(false);
  });
});
