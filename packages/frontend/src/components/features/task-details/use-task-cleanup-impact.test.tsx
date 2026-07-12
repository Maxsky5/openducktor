import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import {
  getManagedTaskCleanupImpact,
  getManagedTaskCleanupImpactFromTasks,
  getTaskCleanupImpactFromSessionQueries,
  TASK_CLEANUP_IMPACT_ERROR_MESSAGE,
} from "./use-task-cleanup-impact";

const makeSession = (overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord => ({
  runtimeKind: "opencode",
  externalSessionId: overrides.externalSessionId ?? "session-1",
  role: overrides.role ?? "build",
  startedAt: overrides.startedAt ?? "2026-03-06T10:00:00.000Z",
  workingDirectory: overrides.workingDirectory ?? "/repo",
  selectedModel: null,
  ...overrides,
});

describe("getManagedTaskCleanupImpact", () => {
  test("counts unique workflow worktrees outside the repo root", () => {
    const impact = getManagedTaskCleanupImpact("/repo", [
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
      makeSession({
        runtimeKind: "opencode",
        externalSessionId: "spec-1",
        role: "spec",
        workingDirectory: "/repo/worktrees/task-4",
      }),
      makeSession({ externalSessionId: "build-root", role: "build", workingDirectory: "/repo" }),
    ]);

    expect(impact).toEqual({
      hasCanonicalWorktree: false,
      hasManagedSessionCleanup: true,
      managedWorktreeCount: 4,
      legacyWorktreeCount: 4,
      impactError: null,
      isLoadingImpact: false,
      terminalCount: 0,
    });
  });

  test("normalizes trailing separators when comparing against the repo root", () => {
    const impact = getManagedTaskCleanupImpact("/repo/", [
      makeSession({ externalSessionId: "build-root", workingDirectory: "/repo" }),
      makeSession({
        runtimeKind: "opencode",
        externalSessionId: "qa-root",
        role: "qa",
        workingDirectory: "/repo///",
      }),
    ]);

    expect(impact).toEqual({
      hasCanonicalWorktree: false,
      hasManagedSessionCleanup: false,
      managedWorktreeCount: 0,
      legacyWorktreeCount: 0,
      impactError: null,
      isLoadingImpact: false,
      terminalCount: 0,
    });
  });

  test("uses shared path comparison semantics when deduplicating managed worktrees", () => {
    const impact = getManagedTaskCleanupImpact("/repo", [
      makeSession({
        runtimeKind: "opencode",
        externalSessionId: "build-1",
        role: "build",
        workingDirectory: "/repo/worktrees/./task-1",
      }),
      makeSession({
        runtimeKind: "opencode",
        externalSessionId: "qa-1",
        role: "qa",
        workingDirectory: "/repo//worktrees/task-1/",
      }),
    ]);

    expect(impact).toEqual({
      hasCanonicalWorktree: false,
      hasManagedSessionCleanup: true,
      managedWorktreeCount: 1,
      legacyWorktreeCount: 1,
      impactError: null,
      isLoadingImpact: false,
      terminalCount: 0,
    });
  });

  test("aggregates managed worktrees across multiple task session lists", () => {
    const impact = getManagedTaskCleanupImpactFromTasks("/repo", [
      [makeSession({ externalSessionId: "parent", workingDirectory: "/repo" })],
      [makeSession({ externalSessionId: "child", workingDirectory: "/repo/worktrees/task-2" })],
    ]);

    expect(impact).toEqual({
      hasCanonicalWorktree: false,
      hasManagedSessionCleanup: true,
      managedWorktreeCount: 1,
      legacyWorktreeCount: 1,
      impactError: null,
      isLoadingImpact: false,
      terminalCount: 0,
    });
  });

  test("includes a stable explicit error message for impact lookup failures", () => {
    expect(TASK_CLEANUP_IMPACT_ERROR_MESSAGE).toBe(
      "Unable to load linked worktree cleanup impact.",
    );
  });

  test("keeps impact loading while cached session queries refetch", () => {
    const impact = getTaskCleanupImpactFromSessionQueries(
      "/repo",
      ["task-1"],
      [
        {
          data: [
            makeSession({
              externalSessionId: "build-1",
              workingDirectory: "/repo/worktrees/task-1",
            }),
          ],
          error: null,
          isLoading: false,
          isFetching: true,
        },
      ],
    );

    expect(impact).toEqual({
      hasCanonicalWorktree: false,
      hasManagedSessionCleanup: false,
      managedWorktreeCount: 0,
      legacyWorktreeCount: 0,
      impactError: null,
      isLoadingImpact: true,
      terminalCount: 0,
    });
  });

  test("distinguishes the retained canonical worktree from legacy session worktrees", () => {
    const impact = getTaskCleanupImpactFromSessionQueries(
      "/repo",
      ["task-1"],
      [
        {
          data: [
            makeSession({
              externalSessionId: "canonical-build",
              workingDirectory: "/worktrees/task-1",
            }),
            makeSession({
              externalSessionId: "legacy-qa",
              role: "qa",
              workingDirectory: "/legacy/task-1-qa",
            }),
            makeSession({
              externalSessionId: "legacy-planner",
              role: "planner",
              workingDirectory: "/legacy/task-1-planner",
            }),
          ],
          error: null,
          isLoading: false,
          isFetching: false,
        },
      ],
      [
        {
          data: { workingDirectory: "/worktrees/task-1" },
          error: null,
          isLoading: false,
          isFetching: false,
        },
      ],
    );

    expect(impact).toEqual({
      hasCanonicalWorktree: true,
      hasManagedSessionCleanup: true,
      managedWorktreeCount: 3,
      legacyWorktreeCount: 2,
      impactError: null,
      isLoadingImpact: false,
      terminalCount: 0,
    });
    expect(impact).toMatchObject({ hasCanonicalWorktree: true });
  });

  test("reports when only legacy worktrees exist", () => {
    const impact = getTaskCleanupImpactFromSessionQueries(
      "/repo",
      ["task-1"],
      [
        {
          data: [
            makeSession({
              externalSessionId: "legacy-build",
              workingDirectory: "/legacy/task-1-build",
            }),
          ],
          error: null,
          isLoading: false,
          isFetching: false,
        },
      ],
      [
        {
          data: null,
          error: null,
          isLoading: false,
          isFetching: false,
        },
      ],
    );

    expect(impact).toMatchObject({
      hasCanonicalWorktree: false,
      legacyWorktreeCount: 1,
    });
  });
});
