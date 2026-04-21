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

  test("allows worktree build sessions", () => {
    expect(
      canUseWorkspaceRuntimeForHydration(createRecord("build", "/tmp/repo/worktree"), "/tmp/repo"),
    ).toBe(true);
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
