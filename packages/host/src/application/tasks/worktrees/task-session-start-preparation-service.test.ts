import { describe, expect, test } from "bun:test";
import type { GitCurrentBranch } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitPort } from "../../../ports/git-port";
import { createTaskStoreTestDouble } from "../../../test-support/task-store-test-double";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildStartRuntimeRegistry,
  createBuildStartWorktreeFiles,
  createBuildSystemCommands,
  createBuildWorkspaceSettingsService,
  createRuntimeDefinitionsService,
  task,
} from "../test-support/task-workflow-harness";
import { createTaskSessionLifecycleCoordinator } from "./task-session-lifecycle-coordinator";
import { createTaskSessionStartPreparationService } from "./task-session-start-preparation-service";

const worktreePath = "/worktrees/repo/task-1";

const createService = (gitOverrides: Partial<GitPort>) => {
  const calls: unknown[] = [];
  return createTaskSessionStartPreparationService({
    taskStore: createTaskStoreTestDouble({
      getTask: () => Effect.succeed(task({ status: "human_review" })),
    }),
    gitPort: {
      ...createBuildStartGitPort({ calls }),
      createWorktree: () => Effect.die(new Error("must keep the existing worktree")),
      removeWorktree: () => Effect.die(new Error("must keep the existing worktree")),
      deleteLocalBranch: () => Effect.die(new Error("must keep the existing branch")),
      configureBranchUpstream: () => Effect.die(new Error("must keep the existing branch")),
      ...gitOverrides,
    },
    settingsConfig: createBuildSettingsConfig(new Set(["/repo", worktreePath])),
    systemCommands: createBuildSystemCommands(calls),
    worktreeFiles: createBuildStartWorktreeFiles(calls),
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      workspaceId: "repo",
      repoPath: "/repo",
      hooks: { preStart: [], postComplete: [] },
    }),
    runtimeDefinitionsService: createRuntimeDefinitionsService(),
    runtimeRegistry: createBuildStartRuntimeRegistry(calls),
    taskSessionLifecycleCoordinator: createTaskSessionLifecycleCoordinator(),
  });
};

const branches: GitCurrentBranch[] = [
  { name: "feature/facebook-login", detached: false },
  { detached: true },
];

describe("task session preparation in an existing worktree", () => {
  test.each(
    (["spec", "planner", "build", "qa"] as const).flatMap((role) =>
      branches.map((branch) => ({ role, branch })),
    ),
  )("uses the task directory regardless of its branch: %j", async ({ role, branch }) => {
    const service = createService({ getCurrentBranch: () => Effect.succeed(branch) });
    const prepared = await Effect.runPromise(
      service.prepare({
        canonicalRepoPath: "/repo",
        taskId: "task-1",
        role,
        runtimeKind: "opencode",
        targetWorkingDirectory: worktreePath,
      }),
    );

    expect(prepared).toMatchObject({ workingDirectory: worktreePath, role });
    await Effect.runPromise(
      service.complete(prepared, () => Effect.die(new Error("must keep the task status"))),
    );
    await expect(Effect.runPromise(prepared.cleanup())).resolves.toBe("");
  });

  test.each<{
    reason: string;
    gitOverrides: Partial<GitPort>;
    error: string;
  }>([
    {
      reason: "repository root",
      gitOverrides: {
        canonicalizePath: () => Effect.succeed("/repo"),
      },
      error: "Canonical worktree for task task-1 resolves to the repository root.",
    },
    {
      reason: "another repository",
      gitOverrides: { shareGitCommonDirectory: () => Effect.succeed(false) },
      error: `Existing worktree path does not belong to repository /repo: ${worktreePath}`,
    },
    {
      reason: "unregistered worktree",
      gitOverrides: { isRegisteredWorktree: () => Effect.succeed(false) },
      error: `Existing canonical path is not a registered worktree for task task-1: ${worktreePath}`,
    },
    {
      reason: "directory without Git",
      gitOverrides: { isGitRepository: (path) => Effect.succeed(path === "/repo") },
      error: `Canonical task worktree path exists but is not a Git worktree: ${worktreePath}`,
    },
  ])("rejects an existing task directory that is $reason", async ({ gitOverrides, error }) => {
    const result = await Effect.runPromise(
      Effect.result(
        createService(gitOverrides).prepare({
          canonicalRepoPath: "/repo",
          taskId: "task-1",
          role: "qa",
          runtimeKind: "opencode",
        }),
      ),
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { operation: "task.session_start.prepare", message: error },
    });
  });
});
