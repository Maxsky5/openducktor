import { describe, expect, test } from "bun:test";
import type { GitCurrentBranch, RepoActions } from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import type { GitPort } from "../../../ports/git-port";
import { createTaskStoreTestDouble } from "../../../test-support/task-store-test-double";
import type { WorktreeActionRunner } from "../../actions/worktree-action-runner";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildStartRuntimeRegistry,
  createBuildStartWorktreeFiles,
  createBuildWorkspaceSettingsService,
  createBuildWorktreeActions,
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
    worktreeActions: {
      createRun: () => ({
        run: () => Effect.die(new Error("must not run worktree actions in an existing worktree")),
        stopTerminals: () => Effect.die(new Error("must not stop worktree action terminals")),
      }),
    },
    worktreeFiles: createBuildStartWorktreeFiles(calls),
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      workspaceId: "repo",
      repoPath: "/repo",
      hooks: { postComplete: [] },
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
    await expect(Effect.runPromise(prepared.rollback())).resolves.toBeUndefined();
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

const actions: RepoActions = {
  items: [
    {
      id: "install",
      icon: "build",
      name: "Install",
      command: "bun install",
      runOnWorktreeCreate: true,
      waitBeforeAgentStart: true,
    },
  ],
  defaultActionId: "install",
};

const createNewWorktreeService = (calls: unknown[], worktreeActions: WorktreeActionRunner) =>
  createTaskSessionStartPreparationService({
    taskStore: createTaskStoreTestDouble({
      getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
    }),
    gitPort: createBuildStartGitPort({ calls }),
    settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
    worktreeActions,
    worktreeFiles: createBuildStartWorktreeFiles(calls),
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      workspaceId: "repo",
      repoPath: "/repo",
      hooks: { postComplete: [] },
      worktreeCopyPaths: [".env"],
      actions,
    }),
    runtimeDefinitionsService: createRuntimeDefinitionsService(),
    runtimeRegistry: createBuildStartRuntimeRegistry(calls),
    taskSessionLifecycleCoordinator: createTaskSessionLifecycleCoordinator(),
  });

const buildPreparation = {
  canonicalRepoPath: "/repo",
  taskId: "task-1",
  role: "build",
  runtimeKind: "opencode",
} as const;

const typedCallSchema = z.object({ type: z.string() });

const callTypes = (calls: unknown[]): Array<string | null> =>
  calls.map((call) => typedCallSchema.safeParse(call).data?.type ?? null);

describe("task session preparation in a new worktree", () => {
  test("runs the worktree actions in the new worktree after configured files are copied", async () => {
    const calls: unknown[] = [];
    const service = createNewWorktreeService(calls, createBuildWorktreeActions(calls));

    const prepared = await Effect.runPromise(service.prepare(buildPreparation));

    expect(prepared.workingDirectory).toBe(worktreePath);
    expect(calls).toContainEqual({
      type: "runWorktreeActions",
      context: { repoPath: "/repo", taskId: "task-1" },
      worktreePath: worktreePath,
      actions,
    });
    const types = callTypes(calls);
    expect(types.filter((type) => type === "runWorktreeActions")).toHaveLength(1);
    expect(types.indexOf("copyConfiguredPaths")).toBeGreaterThan(types.indexOf("createWorktree"));
    expect(types.indexOf("runWorktreeActions")).toBeGreaterThan(
      types.indexOf("copyConfiguredPaths"),
    );
  });

  test("fails with the action message and removes the new worktree and branch", async () => {
    const calls: unknown[] = [];
    const service = createNewWorktreeService(
      calls,
      createBuildWorktreeActions(calls, {
        failMessage: 'Worktree action "Install" exited with code 1.',
      }),
    );

    const result = await Effect.runPromise(Effect.result(service.prepare(buildPreparation)));

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.message).toBe('Worktree action "Install" exited with code 1.');
    }
    expect(calls).toContainEqual({
      type: "removeWorktree",
      repoPath: "/repo",
      worktreePath,
      force: true,
    });
    expect(calls).toContainEqual({
      type: "deleteLocalBranch",
      repoPath: "/repo",
      branch: "odt/task-1-task-1",
      force: true,
    });
  });

  test("closes the action terminals before a later rollback removes the worktree", async () => {
    const calls: unknown[] = [];
    const service = createNewWorktreeService(calls, createBuildWorktreeActions(calls));
    const prepared = await Effect.runPromise(service.prepare(buildPreparation));

    await Effect.runPromise(prepared.rollback());

    const types = callTypes(calls);
    expect(calls).toContainEqual({
      type: "stopWorktreeActionTerminals",
      worktreePath,
      branch: "odt/task-1-task-1",
    });
    expect(types.indexOf("stopWorktreeActionTerminals")).toBeLessThan(
      types.indexOf("removeWorktree"),
    );
    expect(calls).toContainEqual({
      type: "deleteLocalBranch",
      repoPath: "/repo",
      branch: "odt/task-1-task-1",
      force: true,
    });
  });

  test("keeps the worktree and branch when an action terminal cannot stop", async () => {
    const calls: unknown[] = [];
    const service = createNewWorktreeService(
      calls,
      createBuildWorktreeActions(calls, { stopFailMessage: "Failed to stop terminal-1." }),
    );
    const prepared = await Effect.runPromise(service.prepare(buildPreparation));

    expect(await Effect.runPromise(Effect.flip(prepared.rollback()))).toMatchObject({
      _tag: "WorktreeKeptForRunningActionsError",
      worktreePath,
      branch: "odt/task-1-task-1",
      message: "Failed to stop terminal-1.",
    });
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "removeWorktree" }));
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "deleteLocalBranch" }));
  });
});
