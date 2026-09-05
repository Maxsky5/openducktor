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

type Gate = {
  readonly promise: Promise<void>;
  readonly release: () => void;
};

const createGate = (): Gate => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe("createTaskService build start worktree handling", () => {
  test("rejects a task status change during Builder startup and cleans up its worktree", async () => {
    const calls: unknown[] = [];
    let current = task({ status: "ready_for_dev" });
    const taskStore: TaskStorePort = {
      getTask: () => Effect.sync(() => current),
      transitionTask: () =>
        Effect.sync(() => {
          calls.push({ type: "unexpected-transition" });
          return current;
        }),
    };
    const deps = createDependencies(calls, taskStore);
    const coordinator = createTaskSessionLifecycleCoordinator();
    const service = createTaskService({
      ...deps,
      taskSessionLifecycleCoordinator: coordinator,
      runtimeRegistry: {
        ...deps.runtimeRegistry,
        ensureWorkspaceRuntime: (input) =>
          deps.runtimeRegistry.ensureWorkspaceRuntime(input).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                current = task({ status: "blocked" });
              }),
            ),
          ),
      },
    });
    await expect(
      Effect.runPromise(
        service.buildStart({
          repoPath: "/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        }),
      ),
    ).rejects.toThrow(
      "changed from ready_for_dev to blocked while Builder startup was in progress",
    );
    expect(calls).not.toContainEqual({ type: "unexpected-transition" });
    expect(calls).toContainEqual({
      type: "removeWorktree",
      repoPath: "/repo",
      worktreePath: "/worktrees/repo/task-1",
      force: true,
    });
    await expect(
      Effect.runPromise(
        Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "close task")),
      ),
    ).resolves.toBeUndefined();
  });

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
    const baseCoordinator = createTaskSessionLifecycleCoordinator();
    const readFinished = createGate();
    const readStarted = createGate();
    const rollbackStarted = createGate();
    const runtimeFailureRequested = createGate();
    const runtimeStarted = createGate();
    let trackRollbackAcquisition = false;
    const coordinator = {
      ...baseCoordinator,
      acquireWorktreeLifecycle(paths: readonly string[]) {
        return Effect.sync(() => {
          if (trackRollbackAcquisition) {
            rollbackStarted.release();
          }
        }).pipe(Effect.zipRight(baseCoordinator.acquireWorktreeLifecycle(paths)));
      },
    };
    const dependencies = createDependencies(calls, {
      getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
    });
    const runtimeRegistry: RuntimeRegistryPort = {
      ...dependencies.runtimeRegistry,
      ensureWorkspaceRuntime() {
        return Effect.sync(runtimeStarted.release).pipe(
          Effect.zipRight(Effect.promise(() => runtimeFailureRequested.promise)),
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
    await runtimeStarted.promise;
    const readResult = Effect.runPromise(
      coordinator.runWorktreeRead(
        "/worktrees/repo/task-1",
        Effect.sync(readStarted.release).pipe(
          Effect.zipRight(Effect.promise(() => readFinished.promise)),
        ),
      ),
    );
    await readStarted.promise;

    trackRollbackAcquisition = true;
    runtimeFailureRequested.release();
    await rollbackStarted.promise;

    expect(calls).not.toContainEqual(expect.objectContaining({ type: "removeWorktree" }));
    readFinished.release();
    const [, startCause] = await Promise.all([readResult, startFailure]);
    expect(String(startCause)).toContain("runtime failed");
    expect(calls).toContainEqual({
      type: "removeWorktree",
      repoPath: "/repo",
      worktreePath: "/worktrees/repo/task-1",
      force: true,
    });
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
