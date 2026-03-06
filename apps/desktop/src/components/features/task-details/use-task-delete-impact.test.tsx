import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import {
  getConservativeTaskDeleteImpact,
  getManagedTaskDeleteImpact,
  getManagedTaskDeleteImpactFromTasks,
} from "./use-task-delete-impact";

const makeSession = (overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord => ({
  sessionId: overrides.sessionId ?? "session-1",
  role: overrides.role ?? "build",
  scenario: overrides.scenario ?? "build_implementation_start",
  startedAt: overrides.startedAt ?? "2026-03-06T10:00:00.000Z",
  workingDirectory: overrides.workingDirectory ?? "/repo",
  ...overrides,
});

describe("getManagedTaskDeleteImpact", () => {
  test("counts unique build and qa worktrees outside the repo root", () => {
    const impact = getManagedTaskDeleteImpact("/repo", [
      makeSession({
        sessionId: "build-1",
        role: "build",
        workingDirectory: "/repo/worktrees/task-1",
      }),
      makeSession({
        sessionId: "qa-1",
        role: "qa",
        scenario: "qa_review",
        workingDirectory: "/repo/worktrees/task-1",
      }),
      makeSession({
        sessionId: "build-2",
        role: "build",
        workingDirectory: "/repo/worktrees/task-2",
      }),
      makeSession({
        sessionId: "planner-1",
        role: "planner",
        scenario: "planner_initial",
        workingDirectory: "/repo/worktrees/task-3",
      }),
      makeSession({ sessionId: "build-root", role: "build", workingDirectory: "/repo" }),
    ]);

    expect(impact).toEqual({
      hasManagedSessionCleanup: true,
      managedWorktreeCount: 2,
    });
  });

  test("normalizes trailing separators when comparing against the repo root", () => {
    const impact = getManagedTaskDeleteImpact("/repo/", [
      makeSession({ sessionId: "build-root", workingDirectory: "/repo" }),
      makeSession({
        sessionId: "qa-root",
        role: "qa",
        scenario: "qa_review",
        workingDirectory: "/repo///",
      }),
    ]);

    expect(impact).toEqual({
      hasManagedSessionCleanup: false,
      managedWorktreeCount: 0,
    });
  });

  test("aggregates managed worktrees across multiple task session lists", () => {
    const impact = getManagedTaskDeleteImpactFromTasks("/repo", [
      [makeSession({ sessionId: "parent", workingDirectory: "/repo" })],
      [makeSession({ sessionId: "child", workingDirectory: "/repo/worktrees/task-2" })],
    ]);

    expect(impact).toEqual({
      hasManagedSessionCleanup: true,
      managedWorktreeCount: 1,
    });
  });

  test("falls back to a conservative cleanup warning when impact lookup fails", () => {
    expect(getConservativeTaskDeleteImpact()).toEqual({
      hasManagedSessionCleanup: true,
      managedWorktreeCount: 0,
    });
  });
});
