import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../../effect/host-errors";
import { createWorktreeFilePortTestDouble } from "../../../test-support/service-test-doubles";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createDirectMergeDevServerService,
  createDirectMergeGitPort,
} from "../test-support/task-workflow-harness";
import { appendTaskCleanupProgress, createTaskCleanupProgressState } from "./task-cleanup-progress";
import {
  collectResetWorktreePaths,
  runTaskLocalCleanup,
  validateExistingTaskWorktreeCandidate,
} from "./task-cleanup-support";

describe("task cleanup support", () => {
  test("reports reset implementation cleanup progress with the narrow operation label", () => {
    const error = appendTaskCleanupProgress(new Error("delete branch failed"), {
      operation: "task_reset_implementation",
      removedWorktrees: ["/worktrees/repo/task-1"],
      deletedBranches: [],
    });

    expect(error).toBeInstanceOf(HostOperationError);
    if (!(error instanceof HostOperationError)) throw error;
    expect(error.operation).toBe("task_reset_implementation.cleanup");
    expect(error.message).toContain(
      "Reset implementation cleanup already removed worktrees: /worktrees/repo/task-1.",
    );
    expect(error.message).toContain("Retry reset implementation to finish cleanup safely.");
  });

  test("keeps legacy implementation worktrees as reset cleanup targets without a canonical worktree", async () => {
    const legacyWorktree = "/legacy/repo/task-1";
    const worktreePaths = await Effect.runPromise(
      collectResetWorktreePaths(
        {
          gitPort: createDirectMergeGitPort({
            calls: [],
            currentBranches: {
              [legacyWorktree]: { name: "odt/task-1-legacy", detached: false },
            },
          }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", legacyWorktree])),
        },
        "/repo",
        "/worktrees/repo",
        "odt",
        "task-1",
        [createAgentSessionRecord({ workingDirectory: legacyWorktree })],
        new Set(["build", "qa"]),
        "reset implementation",
      ),
    );

    expect(worktreePaths).toEqual([legacyWorktree]);
  });

  test("accepts task branches created from a prefix with trailing slashes", async () => {
    const worktreePath = "/worktrees/repo/task-1";
    const result = await Effect.runPromise(
      validateExistingTaskWorktreeCandidate(
        createDirectMergeGitPort({
          calls: [],
          currentBranches: {
            [worktreePath]: { name: "feature/task-1-title", detached: false },
          },
        }),
        "/repo",
        worktreePath,
        "feature/",
        "task-1",
        "reset implementation",
      ),
    );

    expect(result).toBe(worktreePath);
  });

  test("validates all worktree owners before task cleanup removes a checkout", async () => {
    const worktreePath = "/worktrees/repo/task-1";
    const calls: unknown[] = [];

    await expect(
      Effect.runPromise(
        runTaskLocalCleanup({
          branchNames: [],
          devServerService: createDirectMergeDevServerService(calls),
          gitPort: createDirectMergeGitPort({ calls }),
          managedWorktreeBasePath: "/worktrees/repo",
          progress: createTaskCleanupProgressState(),
          repoPath: "/repo",
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", worktreePath])),
          taskIds: ["task-1"],
          terminalService: {
            acquireTaskCleanup: () => Effect.succeed({ closedTerminalIds: [] }),
          },
          worktreeCleanupOperation: "task_delete",
          worktreeFiles: createWorktreeFilePortTestDouble({}),
          worktreePaths: [worktreePath],
          withWorkStartLease: (_repoPath, effect, workingDirectory) =>
            workingDirectory === worktreePath
              ? Effect.fail(
                  new HostValidationError({
                    field: "workingDirectory",
                    message: `${worktreePath} belongs to another workspace.`,
                  }),
                )
              : effect,
        }).pipe(Effect.scoped),
      ),
    ).rejects.toThrow("belongs to another workspace");
    expect(calls).not.toContainEqual(
      expect.objectContaining({ type: "removeWorktree", worktreePath }),
    );
  });
});
