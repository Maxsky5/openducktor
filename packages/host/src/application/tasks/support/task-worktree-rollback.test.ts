import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildStartRuntimeRegistry,
  createBuildStartWorktreeFiles,
  createBuildWorkspaceSettingsService,
  createBuildWorktreeActions,
  createRuntimeDefinitionsService,
  extendGitPort,
} from "../test-support/task-workflow-harness";
import { requireBuildStartDependencies } from "./required-task-dependencies";
import { rollbackFailedTaskWorktree } from "./task-worktree-rollback";

describe("rollbackFailedTaskWorktree", () => {
  test("runs every step after a failed step and lists each failure", async () => {
    const calls: unknown[] = [];
    const failingWorktreeFiles: WorktreeFilePort = {
      ...createBuildStartWorktreeFiles(calls),
      removePathIfPresent(path) {
        return Effect.fail(
          new HostOperationError({
            operation: "test.removePathIfPresent",
            message: `cannot remove ${path}`,
          }),
        );
      },
    };
    const rollbackFailure = await Effect.runPromise(
      Effect.flip(
        rollbackFailedTaskWorktree(
          requireBuildStartDependencies(
            extendGitPort(createBuildStartGitPort({ calls }), {
              deleteReference(repoPath, reference) {
                calls.push({ type: "deleteReference", repoPath, reference });
                return Effect.fail(
                  new HostOperationError({
                    operation: "test.deleteReference",
                    message: "cannot delete tracking ref",
                  }),
                );
              },
              deleteLocalBranch(repoPath, branch, force) {
                calls.push({ type: "deleteLocalBranch", repoPath, branch, force });
                return Effect.fail(
                  new HostOperationError({
                    operation: "test.deleteLocalBranch",
                    message: "cannot delete branch",
                  }),
                );
              },
            }),
            createRuntimeDefinitionsService(),
            createBuildStartRuntimeRegistry(calls),
            createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
            createBuildWorktreeActions(calls),
            failingWorktreeFiles,
            createBuildWorkspaceSettingsService({
              workspaceId: "repo",
              repoPath: "/repo",
              hooks: { postComplete: [] },
            }),
          ),
          "/repo",
          "/worktrees/repo/task-1",
          "odt/task-1",
          "refs/remotes/origin/odt/task-1",
          "/worktrees/repo",
        ),
      ),
    );

    // Each step runs after an earlier step fails, and the error lists every failed step.
    expect(rollbackFailure).toMatchObject({
      _tag: "TaskWorktreeRollbackError",
      worktreePath: "/worktrees/repo/task-1",
      branch: "odt/task-1",
      message: [
        "Also failed to delete created upstream tracking ref refs/remotes/origin/odt/task-1: cannot delete tracking ref",
        "Also failed to remove worktree /worktrees/repo/task-1: git worktree removal left filesystem path cleanup incomplete for /worktrees/repo/task-1 (canonical cleanup path: /worktrees/repo/task-1)",
        "Also failed to delete branch odt/task-1: cannot delete branch",
      ].join("\n"),
    });
    expect(rollbackFailure.cause).toHaveLength(3);
  });
});
