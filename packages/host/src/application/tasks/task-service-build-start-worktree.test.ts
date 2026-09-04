import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import { HostOperationError } from "../../effect/host-errors";
import { createTaskSessionLifecycleCoordinator } from "./worktrees/task-session-lifecycle-coordinator";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildStartRuntimeRegistry,
  createBuildStartWorktreeFiles,
  createBuildSystemCommands,
  createBuildWorkspaceSettingsService,
  createRuntimeDefinitionsService,
  createTaskService,
  type RuntimeRegistryPort,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

const createDependencies = (calls: unknown[], taskStore: TaskStorePort) => ({
  taskStore,
  gitPort: createBuildStartGitPort({ calls }),
  runtimeDefinitionsService: createRuntimeDefinitionsService(),
  runtimeRegistry: createBuildStartRuntimeRegistry(calls),
  settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
  systemCommands: createBuildSystemCommands(calls),
  worktreeFiles: createBuildStartWorktreeFiles(calls),
  workspaceSettingsService: createBuildWorkspaceSettingsService({
    workspaceId: "repo",
    repoPath: "/repo",
    hooks: { preStart: [], postComplete: [] },
  }),
});

describe("createTaskService build start worktree handling", () => {
  test("creates the canonical worktree and transitions the task", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
      transitionTask: (input) =>
        Effect.sync(() => {
          calls.push({ type: "transition", input });
          return task({ status: input.status });
        }),
    };

    const result = await Effect.runPromise(
      createTaskService(createDependencies(calls, taskStore)).buildStart({
        repoPath: "/repo",
        taskId: "task-1",
        runtimeKind: "opencode",
      }),
    );

    expect(result).toEqual({
      runtimeKind: "opencode",
      workingDirectory: "/worktrees/repo/task-1",
    });
    expect(calls).toContainEqual(
      expect.objectContaining({
        type: "createWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
      }),
    );
    expect(calls).toContainEqual({
      type: "transition",
      input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
    });
  });

  test("rejects an occupied canonical path that is not a Git worktree", async () => {
    const calls: unknown[] = [];
    const baseGitPort = createBuildStartGitPort({ calls });
    const gitPort = {
      ...baseGitPort,
      isGitRepository(path: string) {
        return Effect.sync(() => {
          calls.push({ type: "isGitRepository", path });
          return path !== "/worktrees/repo/task-1";
        });
      },
    };
    const dependencies = createDependencies(calls, {
      getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
    });

    await expect(
      Effect.runPromise(
        createTaskService({
          ...dependencies,
          gitPort,
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        }).buildStart({
          repoPath: "/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        }),
      ),
    ).rejects.toThrow("exists but is not a Git worktree");
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "removeWorktree" }));
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "createWorktree" }));
  });

  test("removes a new worktree when runtime startup fails", async () => {
    const calls: unknown[] = [];
    const dependencies = createDependencies(calls, {
      getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
    });
    const runtimeRegistry: RuntimeRegistryPort = {
      ...dependencies.runtimeRegistry,
      ensureWorkspaceRuntime(input) {
        return Effect.sync(() => calls.push({ type: "ensureRuntime", input })).pipe(
          Effect.zipRight(
            Effect.fail(
              new HostOperationError({
                operation: "test.ensureRuntime",
                message: "runtime failed",
              }),
            ),
          ),
        );
      },
    };

    await expect(
      Effect.runPromise(
        createTaskService({ ...dependencies, runtimeRegistry }).buildStart({
          repoPath: "/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        }),
      ),
    ).rejects.toThrow("runtime failed");
    expect(calls).toContainEqual({
      type: "removeWorktree",
      repoPath: "/repo",
      worktreePath: "/worktrees/repo/task-1",
      force: true,
    });
    expect(
      calls.some((call) => z.object({ type: z.literal("transition") }).safeParse(call).success),
    ).toBe(false);
  });

  test("waits for an active worktree read before runtime failure rollback", async () => {
    const calls: unknown[] = [];
    const coordinator = createTaskSessionLifecycleCoordinator();
    let finishRead = () => {};
    let failRuntime = () => {};
    let markReadStarted = () => {};
    let markRuntimeStarted = () => {};
    const readFinished = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    const runtimeFailureRequested = new Promise<void>((resolve) => {
      failRuntime = resolve;
    });
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const runtimeStarted = new Promise<void>((resolve) => {
      markRuntimeStarted = resolve;
    });
    const dependencies = createDependencies(calls, {
      getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
    });
    const runtimeRegistry: RuntimeRegistryPort = {
      ...dependencies.runtimeRegistry,
      ensureWorkspaceRuntime() {
        return Effect.sync(markRuntimeStarted).pipe(
          Effect.zipRight(Effect.promise(() => runtimeFailureRequested)),
          Effect.zipRight(
            Effect.fail(
              new HostOperationError({
                operation: "test.ensureRuntime",
                message: "runtime failed",
              }),
            ),
          ),
        );
      },
    };
    const startResult = Effect.runPromise(
      createTaskService({
        ...dependencies,
        runtimeRegistry,
        taskSessionLifecycleCoordinator: coordinator,
      }).buildStart({
        repoPath: "/repo",
        taskId: "task-1",
        runtimeKind: "opencode",
      }),
    );
    const startFailure = startResult.catch((cause: unknown) => cause);
    await runtimeStarted;
    const readResult = Effect.runPromise(
      coordinator.runWorktreeRead(
        "/worktrees/repo/task-1",
        Effect.sync(markReadStarted).pipe(
          Effect.zipRight(Effect.promise(() => readFinished)),
          Effect.tap(() => Effect.sync(() => calls.push({ type: "readFinished" }))),
        ),
      ),
    );
    await readStarted;

    failRuntime();
    await Promise.resolve();
    await Promise.resolve();

    const removedWhileReadWasActive = calls.some(
      (call) => z.object({ type: z.literal("removeWorktree") }).safeParse(call).success,
    );
    finishRead();
    const [, startCause] = await Promise.all([readResult, startFailure]);
    expect(String(startCause)).toContain("runtime failed");
    expect(removedWhileReadWasActive).toBe(false);
    expect(calls).toContainEqual({
      type: "removeWorktree",
      repoPath: "/repo",
      worktreePath: "/worktrees/repo/task-1",
      force: true,
    });
    expect(
      calls.findIndex(
        (call) => z.object({ type: z.literal("readFinished") }).safeParse(call).success,
      ),
    ).toBeLessThan(
      calls.findIndex(
        (call) => z.object({ type: z.literal("removeWorktree") }).safeParse(call).success,
      ),
    );
  });

  test("removes a new worktree when the Builder transition fails", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
      transitionTask: (input) =>
        Effect.sync(() => calls.push({ type: "transition", input })).pipe(
          Effect.zipRight(
            Effect.fail(
              new HostOperationError({
                operation: "test.transitionTask",
                message: "transition failed",
              }),
            ),
          ),
        ),
    };

    await expect(
      Effect.runPromise(
        createTaskService(createDependencies(calls, taskStore)).buildStart({
          repoPath: "/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        }),
      ),
    ).rejects.toThrow("transition failed");
    expect(calls).toContainEqual({
      type: "removeWorktree",
      repoPath: "/repo",
      worktreePath: "/worktrees/repo/task-1",
      force: true,
    });
  });
});
