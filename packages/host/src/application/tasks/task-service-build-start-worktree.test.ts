import { describe, expect, test } from "bun:test";
import { Effect, Exit, Fiber } from "effect";
import { z } from "zod";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import { createTaskSessionLifecycleCoordinator } from "./worktrees/task-session-lifecycle-coordinator";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildStartRuntimeRegistry,
  createBuildStartWorktreeFiles,
  createBuildWorkspaceSettingsService,
  createBuildWorktreeActions,
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
  worktreeActions: createBuildWorktreeActions(calls),
  worktreeFiles: createBuildStartWorktreeFiles(calls),
  workspaceSettingsService: createBuildWorkspaceSettingsService({
    workspaceId: "repo",
    repoPath: "/repo",
    hooks: { postComplete: [] },
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
  test.each([false, true])(
    "waits for an interrupted transition before deciding cleanup (write fails: %s)",
    async (writeFails) => {
      const calls: unknown[] = [];
      const started = createGate();
      const finishWrite = createGate();
      const settled = createGate();
      let current = task({ status: "ready_for_dev" });
      const writeError = new HostOperationError({
        operation: "test.transition",
        message: "write failed",
      });
      const taskStore: TaskStorePort = {
        getTask: () => Effect.sync(() => current),
        transitionTask: () =>
          Effect.tryPromise({
            try: async () => {
              started.release();
              try {
                await finishWrite.promise;
                if (writeFails) throw writeError;
                current = task({ status: "in_progress" });
                return current;
              } finally {
                settled.release();
              }
            },
            catch: () => writeError,
          }),
      };
      const coordinator = createTaskSessionLifecycleCoordinator();
      const service = createTaskService({
        ...createDependencies(calls, taskStore),
        taskSessionLifecycleCoordinator: coordinator,
      });
      const fiber = Effect.runFork(
        service.buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
      );
      try {
        await started.promise;
        fiber.interruptUnsafe();
        finishWrite.release();
        await settled.promise;
        expect(Exit.isFailure(await Effect.runPromise(Fiber.await(fiber)))).toBe(true);
        expect(current.status).toBe(writeFails ? "ready_for_dev" : "in_progress");
        const removals = calls.filter(
          (call) => z.object({ type: z.literal("removeWorktree") }).safeParse(call).success,
        );
        expect(removals).toHaveLength(writeFails ? 1 : 0);
        await expect(
          Effect.runPromise(
            Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "close task")),
          ),
        ).resolves.toBeUndefined();
      } finally {
        finishWrite.release();
        await Effect.runPromise(Fiber.interrupt(fiber));
      }
    },
  );

  test("preserves preparation validation errors", async () => {
    const calls: unknown[] = [];
    const deps = createDependencies(calls, {});
    const failure = new HostValidationError({ field: "repoPath", message: "invalid repository" });
    const service = createTaskService({
      ...deps,
      workspaceSettingsService: {
        ...deps.workspaceSettingsService,
        getRepoConfigByRepoPath: () => Effect.fail(failure),
      },
    });
    const result = await Effect.runPromise(
      Effect.result(
        service.buildStart({
          repoPath: "/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        }),
      ),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure).toBe(failure);
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "removeWorktree" }));
  });

  test("cleans a new worktree once when preparation is interrupted during a worktree action", async () => {
    const calls: unknown[] = [];
    const started = createGate();
    const deps = createDependencies(calls, {
      getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
    });
    const coordinator = createTaskSessionLifecycleCoordinator();
    const service = createTaskService({
      ...deps,
      taskSessionLifecycleCoordinator: coordinator,
      worktreeActions: {
        createRun: () => ({
          run: () => Effect.sync(started.release).pipe(Effect.andThen(Effect.never)),
          stopTerminals: () => Effect.sync(() => void calls.push("stopWorktreeActionTerminals")),
        }),
      },
    });
    const fiber = Effect.runFork(
      service.buildStart({
        repoPath: "/repo",
        taskId: "task-1",
        runtimeKind: "opencode",
      }),
    );
    try {
      await started.promise;
      await Effect.runPromise(Fiber.interrupt(fiber));
      expect(
        calls.filter(
          (call) => z.object({ type: z.literal("removeWorktree") }).safeParse(call).success,
        ),
      ).toHaveLength(1);
      // The action terminals stop before Git removes their worktree.
      const closeIndex = calls.indexOf("stopWorktreeActionTerminals");
      const removeIndex = calls.findIndex(
        (call) => z.object({ type: z.literal("removeWorktree") }).safeParse(call).success,
      );
      expect(closeIndex).toBeGreaterThanOrEqual(0);
      expect(closeIndex).toBeLessThan(removeIndex);
      await expect(
        Effect.runPromise(
          Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "close task")),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await Effect.runPromise(Fiber.interrupt(fiber));
    }
  });

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
      worktreeFiles: {
        ...deps.worktreeFiles,
        copyConfiguredPaths: (repoPath, worktreePath, relativePaths) =>
          deps.worktreeFiles.copyConfiguredPaths(repoPath, worktreePath, relativePaths).pipe(
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

  test("rejects a status change from ai_review during Builder startup", async () => {
    const calls: unknown[] = [];
    let current = task({ status: "ai_review" });
    const taskStore: TaskStorePort = {
      getTask: () => Effect.sync(() => current),
      transitionTask: () => Effect.die(new Error("unexpected task transition")),
    };
    const deps = createDependencies(calls, taskStore);
    const service = createTaskService({
      ...deps,
      worktreeFiles: {
        ...deps.worktreeFiles,
        copyConfiguredPaths: (repoPath, worktreePath, relativePaths) =>
          deps.worktreeFiles.copyConfiguredPaths(repoPath, worktreePath, relativePaths).pipe(
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
        service.buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
      ),
    ).rejects.toThrow("changed from ai_review to blocked while Builder startup was in progress");
    expect(calls).toContainEqual({
      type: "removeWorktree",
      repoPath: "/repo",
      worktreePath: "/worktrees/repo/task-1",
      force: true,
    });
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

  test.each(["open", "spec_ready", "ready_for_dev"] as const)(
    "moves a %s task to in_progress at Builder start",
    async (status) => {
      const calls: unknown[] = [];
      let current = task({ status });
      const taskStore: TaskStorePort = {
        getTask: () => Effect.sync(() => current),
        transitionTask: (input) =>
          Effect.sync(() => {
            calls.push({ type: "transition", input });
            current = task({ status: input.status });
            return current;
          }),
      };

      await Effect.runPromise(
        createTaskService(createDependencies(calls, taskStore)).buildStart({
          repoPath: "/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        }),
      );

      expect(current.status).toBe("in_progress");
      expect(calls).toContainEqual({
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
      });
    },
  );

  test.each(["in_progress", "blocked", "ai_review", "human_review"] as const)(
    "keeps %s when starting another Builder session",
    async (status) => {
      const calls: unknown[] = [];
      const taskStore: TaskStorePort = {
        getTask: () => Effect.succeed(task({ status })),
        transitionTask: () => Effect.die(new Error("unexpected task transition")),
      };

      await expect(
        Effect.runPromise(
          createTaskService(createDependencies(calls, taskStore)).buildStart({
            repoPath: "/repo",
            taskId: "task-1",
            runtimeKind: "opencode",
          }),
        ),
      ).resolves.toEqual({
        runtimeKind: "opencode",
        workingDirectory: "/worktrees/repo/task-1",
      });
      expect(calls).not.toContainEqual(expect.objectContaining({ type: "transition" }));
    },
  );

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

  test("rejects Builder start before worktree setup when the runtime kind is not ready", async () => {
    const calls: unknown[] = [];
    const dependencies = createDependencies(calls, {
      getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
      transitionTask: () => Effect.die(new Error("unexpected task transition")),
    });
    const runtimeRegistry: RuntimeRegistryPort = {
      ...dependencies.runtimeRegistry,
      requireReady(runtimeKind) {
        return Effect.sync(() => calls.push({ type: "requireRuntime", runtimeKind })).pipe(
          Effect.andThen(
            Effect.fail(
              new HostResourceError({
                resource: "agent_runtime",
                operation: "runtime.requireReady",
                message:
                  "The OpenCode runtime is not ready. Wait for the runtime to start, or check Diagnostics.",
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
    ).rejects.toThrow("The OpenCode runtime is not ready.");
    expect(calls).toContainEqual({ type: "requireRuntime", runtimeKind: "opencode" });
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "ensureDirectory" }));
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "createWorktree" }));
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "removeWorktree" }));
  });

  test("waits for an active worktree read before transition failure rollback", async () => {
    const calls: unknown[] = [];
    const baseCoordinator = createTaskSessionLifecycleCoordinator();
    const readFinished = createGate();
    const readStarted = createGate();
    const rollbackStarted = createGate();
    const transitionFailureRequested = createGate();
    const transitionStarted = createGate();
    let trackRollbackAcquisition = false;
    const coordinator = {
      ...baseCoordinator,
      acquireWorktreeLifecycle(paths: readonly string[]) {
        return Effect.sync(() => {
          if (trackRollbackAcquisition) {
            rollbackStarted.release();
          }
        }).pipe(Effect.andThen(baseCoordinator.acquireWorktreeLifecycle(paths)));
      },
    };
    const dependencies = createDependencies(calls, {
      getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
      transitionTask: () =>
        Effect.sync(transitionStarted.release).pipe(
          Effect.andThen(Effect.promise(() => transitionFailureRequested.promise)),
          Effect.andThen(
            Effect.fail(
              new HostOperationError({
                operation: "test.transitionTask",
                message: "transition failed",
              }),
            ),
          ),
        ),
    });
    const startResult = Effect.runPromise(
      createTaskService({
        ...dependencies,
        taskSessionLifecycleCoordinator: coordinator,
      }).buildStart({
        repoPath: "/repo",
        taskId: "task-1",
        runtimeKind: "opencode",
      }),
    );
    const startFailure = startResult.catch((cause: unknown) => cause);
    await transitionStarted.promise;
    const readResult = Effect.runPromise(
      coordinator.runWorktreeRead(
        "/worktrees/repo/task-1",
        Effect.sync(readStarted.release).pipe(
          Effect.andThen(Effect.promise(() => readFinished.promise)),
        ),
      ),
    );
    await readStarted.promise;

    trackRollbackAcquisition = true;
    transitionFailureRequested.release();
    await rollbackStarted.promise;

    expect(calls).not.toContainEqual(expect.objectContaining({ type: "removeWorktree" }));
    readFinished.release();
    const [, startCause] = await Promise.all([readResult, startFailure]);
    expect(String(startCause)).toContain("transition failed");
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
          Effect.andThen(
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
    const closeIndex = calls.findIndex(
      (call) =>
        z.object({ type: z.literal("stopWorktreeActionTerminals") }).safeParse(call).success,
    );
    const removeIndex = calls.findIndex(
      (call) => z.object({ type: z.literal("removeWorktree") }).safeParse(call).success,
    );
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(closeIndex).toBeLessThan(removeIndex);
  });
});
