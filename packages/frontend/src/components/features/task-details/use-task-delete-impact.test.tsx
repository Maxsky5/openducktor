import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import {
  getManagedTaskDeleteImpact,
  getManagedTaskDeleteImpactFromTasks,
  TASK_DELETE_IMPACT_ERROR_MESSAGE,
} from "./use-task-delete-impact";

const makeSession = (overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord => ({
  runtimeKind: "opencode",
  externalSessionId: overrides.externalSessionId ?? "session-1",
  role: overrides.role ?? "build",
  startedAt: overrides.startedAt ?? "2026-03-06T10:00:00.000Z",
  workingDirectory: overrides.workingDirectory ?? "/repo",
  selectedModel: null,
  ...overrides,
});

describe("getManagedTaskDeleteImpact", () => {
  test("counts unique build and qa worktrees outside the repo root", () => {
    const impact = getManagedTaskDeleteImpact("/repo", [
      makeSession({
        runtimeKind: "opencode",
        externalSessionId: "build-1",
        role: "build",
        workingDirectory: "/repo/worktrees/task-1",
      }),
      makeSession({
        runtimeKind: "opencode",
        externalSessionId: "qa-1",
        role: "qa",
        workingDirectory: "/repo/worktrees/task-1",
      }),
      makeSession({
        runtimeKind: "opencode",
        externalSessionId: "build-2",
        role: "build",
        workingDirectory: "/repo/worktrees/task-2",
      }),
      makeSession({
        runtimeKind: "opencode",
        externalSessionId: "planner-1",
        role: "planner",
        workingDirectory: "/repo/worktrees/task-3",
      }),
      makeSession({ externalSessionId: "build-root", role: "build", workingDirectory: "/repo" }),
    ]);

    expect(impact).toEqual({
      hasManagedSessionCleanup: true,
      managedWorktreeCount: 2,
      impactError: null,
      isLoadingImpact: false,
    });
  });

  test("normalizes trailing separators when comparing against the repo root", () => {
    const impact = getManagedTaskDeleteImpact("/repo/", [
      makeSession({ externalSessionId: "build-root", workingDirectory: "/repo" }),
      makeSession({
        runtimeKind: "opencode",
        externalSessionId: "qa-root",
        role: "qa",
        workingDirectory: "/repo///",
      }),
    ]);

    expect(impact).toEqual({
      hasManagedSessionCleanup: false,
      managedWorktreeCount: 0,
      impactError: null,
      isLoadingImpact: false,
    });
  });

  test("aggregates managed worktrees across multiple task session lists", () => {
    const impact = getManagedTaskDeleteImpactFromTasks("/repo", [
      [makeSession({ externalSessionId: "parent", workingDirectory: "/repo" })],
      [makeSession({ externalSessionId: "child", workingDirectory: "/repo/worktrees/task-2" })],
    ]);

    expect(impact).toEqual({
      hasManagedSessionCleanup: true,
      managedWorktreeCount: 1,
      impactError: null,
      isLoadingImpact: false,
    });
  });

  test("includes a stable explicit error message for impact lookup failures", () => {
    expect(TASK_DELETE_IMPACT_ERROR_MESSAGE).toBe("Unable to load linked worktree cleanup impact.");
  });
});
