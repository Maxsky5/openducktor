import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { canUseRepoRootWorkspaceRuntimeForHydration } from "./hydration-runtime-policy";

const createRecord = (
  role: AgentSessionRecord["role"],
  workingDirectory: string,
): Pick<AgentSessionRecord, "role" | "workingDirectory"> => ({
  role,
  workingDirectory,
});

describe("canUseRepoRootWorkspaceRuntimeForHydration", () => {
  test("allows repo-root spec sessions", () => {
    expect(
      canUseRepoRootWorkspaceRuntimeForHydration(createRecord("spec", "/tmp/repo"), "/tmp/repo"),
    ).toBe(true);
  });

  test("allows normalized-equivalent repo-root planner sessions", () => {
    expect(
      canUseRepoRootWorkspaceRuntimeForHydration(
        createRecord("planner", "/tmp/repo/"),
        "/tmp/repo",
      ),
    ).toBe(true);
  });

  test("rejects repo-root build sessions", () => {
    expect(
      canUseRepoRootWorkspaceRuntimeForHydration(createRecord("build", "/tmp/repo"), "/tmp/repo"),
    ).toBe(false);
  });

  test("rejects worktree planner sessions", () => {
    expect(
      canUseRepoRootWorkspaceRuntimeForHydration(
        createRecord("planner", "/tmp/repo/worktree"),
        "/tmp/repo",
      ),
    ).toBe(false);
  });
});
