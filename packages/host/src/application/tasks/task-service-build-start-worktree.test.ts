import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { z } from "zod";
import { HostOperationError } from "../../effect/host-errors";
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
import { createTaskSessionBootstrapCoordinator } from "./worktrees/task-session-bootstrap-coordinator";

const taskStoreEffect = <Success>(run: () => Promise<Success>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new HostOperationError({
        operation: "test.effect",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

describe("createTaskService build start worktree handling", () => {
  test("rejects bootstrap reservations that do not match the acquired startup role", async () => {
    const coordinator = createTaskSessionBootstrapCoordinator();
    await Effect.runPromise(coordinator.acquireBootstrap("/repo", "task-1", "bootstrap-1", "spec"));

    await expect(
      Effect.runPromise(
        coordinator.attachBootstrapReservation({
          bootstrapId: "bootstrap-1",
          canonicalRepoPath: "/repo",
          taskId: "task-1",
          role: "qa",
          preparedStatus: "ready_for_dev",
          cleanup: () => Effect.succeed(""),
        }),
      ),
    ).rejects.toThrow("does not match the active spec startup");
    await Effect.runPromise(coordinator.releaseBootstrap("/repo", "task-1", "bootstrap-1"));
  });

  test("supports Planner and QA as the first worktree creator", async () => {
    for (const role of ["planner", "qa"] as const) {
      const calls: unknown[] = [];
      const status = role === "qa" ? "blocked" : "ready_for_dev";
      const service = createTaskService({
        taskStore: {
          getTask: () => Effect.succeed(task({ status })),
        } satisfies TaskStorePort,
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
      const bootstrap = await Effect.runPromise(
        service.taskSessionBootstrapPrepare({
          repoPath: "/repo",
          taskId: "task-1",
          role,
          runtimeKind: "opencode",
        }),
      );
      expect(bootstrap.role).toBe(role);
      await Effect.runPromise(
        service.taskSessionBootstrapAbort({
          repoPath: "/repo",
          taskId: "task-1",
          bootstrapId: bootstrap.bootstrapId,
        }),
      );
    }
  });

  test.each([
    { role: "spec", task: task({ status: "closed" }) },
    { role: "planner", task: task({ issueType: "feature", status: "open" }) },
    { role: "qa", task: task({ status: "ready_for_dev" }) },
  ] as const)("rejects unavailable $role bootstrap before creating a worktree", async (entry) => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskStore: {
        getTask: () => Effect.succeed(entry.task),
      } satisfies TaskStorePort,
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

    await expect(
      Effect.runPromise(
        service.taskSessionBootstrapPrepare({
          repoPath: "/repo",
          taskId: "task-1",
          role: entry.role,
          runtimeKind: "opencode",
        }),
      ),
    ).rejects.toThrow(`${entry.role} workflow is not available for task task-1`);
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "createWorktree" }));
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "ensureRuntime" }));
  });

  test.each([
    {
      role: "spec",
      before: task({ status: "open" }),
      after: task({ status: "closed" }),
      error: "spec workflow is not available for task task-1",
    },
    {
      role: "planner",
      before: task({ issueType: "feature", status: "spec_ready" }),
      after: task({ issueType: "feature", status: "closed" }),
      error: "planner workflow is not available for task task-1",
    },
    {
      role: "qa",
      before: task({ status: "blocked" }),
      after: task({ status: "in_progress" }),
      error: "qa workflow is not available for task task-1",
    },
    {
      role: "build",
      before: task({ status: "ready_for_dev" }),
      after: task({ status: "blocked" }),
      error:
        "Task task-1 changed from ready_for_dev to blocked while Builder startup was in progress.",
    },
  ] as const)(
    "releases a $role bootstrap when completion rejects its changed task",
    async (entry) => {
      const calls: unknown[] = [];
      const coordinator = createTaskSessionBootstrapCoordinator();
      let currentTask = entry.before;
      const service = createTaskService({
        taskStore: {
          getTask: () => Effect.succeed(currentTask),
        } satisfies TaskStorePort,
        taskSessionBootstrapCoordinator: coordinator,
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
      const bootstrap = await Effect.runPromise(
        service.taskSessionBootstrapPrepare({
          repoPath: "/repo",
          taskId: "task-1",
          role: entry.role,
          runtimeKind: "opencode",
        }),
      );

      currentTask = entry.after;
      await expect(
        Effect.runPromise(
          service.taskSessionBootstrapComplete({
            repoPath: "/repo",
            taskId: "task-1",
            bootstrapId: bootstrap.bootstrapId,
          }),
        ),
      ).rejects.toThrow(entry.error);
      await expect(
        Effect.runPromise(
          Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "reset task")),
        ),
      ).resolves.toBeUndefined();

      await expect(
        Effect.runPromise(
          service.taskSessionBootstrapComplete({
            repoPath: "/repo",
            taskId: "task-1",
            bootstrapId: bootstrap.bootstrapId,
          }),
        ),
      ).rejects.toThrow(entry.error);
      await expect(
        Effect.runPromise(
          service.taskSessionBootstrapAbort({
            repoPath: "/repo",
            taskId: "task-1",
            bootstrapId: bootstrap.bootstrapId,
          }),
        ),
      ).resolves.toBe(true);
    },
  );

  test("rejects lifecycle changes during Builder startup and replays terminal calls safely", async () => {
    const status: ReturnType<typeof task>["status"] = "ready_for_dev";
    let updatedAt = "2026-01-01T00:00:00.000Z";
    const calls: unknown[] = [];
    const coordinator = createTaskSessionBootstrapCoordinator();
    const taskStore: TaskStorePort = {
      getTask: () => Effect.succeed(task({ status, updatedAt })),
      transitionTask: () => Effect.succeed(task({ status: "in_progress" })),
    };
    const service = createTaskService({
      taskStore,
      taskSessionBootstrapCoordinator: coordinator,
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
    const bootstrap = await Effect.runPromise(
      service.taskSessionBootstrapPrepare({
        repoPath: "/repo",
        taskId: "task-1",
        role: "build",
        runtimeKind: "opencode",
      }),
    );
    await expect(
      Effect.runPromise(
        Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "reset task")),
      ),
    ).rejects.toThrow("bootstrap is in progress");
    updatedAt = "2026-01-02T00:00:00.000Z";
    await expect(
      Effect.runPromise(
        service.taskSessionBootstrapComplete({
          repoPath: "/repo",
          taskId: "task-1",
          bootstrapId: bootstrap.bootstrapId,
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      Effect.runPromise(
        service.taskSessionBootstrapComplete({
          repoPath: "/repo",
          taskId: "task-1",
          bootstrapId: bootstrap.bootstrapId,
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      Effect.runPromise(
        service.taskSessionBootstrapAbort({
          repoPath: "/repo",
          taskId: "task-1",
          bootstrapId: bootstrap.bootstrapId,
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      Effect.runPromise(
        service.taskSessionBootstrapAbort({
          repoPath: "/repo",
          taskId: "other-task",
          bootstrapId: bootstrap.bootstrapId,
        }),
      ),
    ).rejects.toThrow("Unknown or mismatched");
    const lifecycleAcquired = Effect.runSync(Deferred.make<void>());
    const lifecycleFiber = Effect.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          yield* coordinator.acquireLifecycle("/repo", ["task-1"], "close task");
          yield* Deferred.succeed(lifecycleAcquired, undefined);
          yield* Effect.never;
        }),
      ),
    );
    await Effect.runPromise(Deferred.await(lifecycleAcquired));
    await expect(
      Effect.runPromise(
        service.taskSessionBootstrapPrepare({
          repoPath: "/repo",
          taskId: "task-1",
          role: "spec",
          runtimeKind: "opencode",
        }),
      ),
    ).rejects.toThrow("close task is in progress");
    await Effect.runPromise(Fiber.interrupt(lifecycleFiber));
  });

  test("prepares the same canonical worktree for non-Builder roles without transitioning", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "getTask", input });
          return task({
            id: "task-1",
            title: "Task 1",
            status: "ready_for_dev",
          });
        });
      },
      transitionTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "transition", input });
          return task({ id: input.taskId, status: input.status });
        });
      },
    };
    const service = createTaskService({
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
        hooks: { preStart: ["bun test"], postComplete: [] },
        worktreeCopyPaths: [".env"],
      }),
    });

    const bootstrap = await Effect.runPromise(
      service.taskSessionBootstrapPrepare({
        repoPath: "/repo",
        taskId: "task-1",
        role: "spec",
        runtimeKind: "opencode",
      }),
    );
    expect(bootstrap).toMatchObject({
      role: "spec",
      runtimeKind: "opencode",
      workingDirectory: "/worktrees/repo/task-1",
    });
    await Effect.runPromise(
      service.taskSessionBootstrapComplete({
        repoPath: "/repo",
        taskId: "task-1",
        bootstrapId: bootstrap.bootstrapId,
      }),
    );
    await expect(
      Effect.runPromise(
        service.taskSessionBootstrapComplete({
          repoPath: "/repo",
          taskId: "task-1",
          bootstrapId: bootstrap.bootstrapId,
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      Effect.runPromise(
        service.taskSessionBootstrapAbort({
          repoPath: "/repo",
          taskId: "task-1",
          bootstrapId: bootstrap.bootstrapId,
        }),
      ),
    ).resolves.toBe(true);
    expect(calls.filter((call) => JSON.stringify(call).includes('"type":"transition"'))).toEqual(
      [],
    );
    expect(
      calls.filter((call) => JSON.stringify(call).includes('"type":"createWorktree"')),
    ).toHaveLength(1);
    expect(
      calls.filter((call) => JSON.stringify(call).includes('"type":"copyConfiguredPaths"')),
    ).toHaveLength(1);
    expect(calls.filter((call) => JSON.stringify(call).includes('"command":"bun"'))).toHaveLength(
      1,
    );
  });

  test("accepts a canonical target worktree expressed through a symlinked base path", async () => {
    const calls: unknown[] = [];
    const configuredWorktreePath = "/configured/worktrees/task-1";
    const realWorktreePath = "/real/worktrees/task-1";
    const differentWorktreePath = "/real/worktrees/other-task";
    const gitPort = {
      ...createBuildStartGitPort({ calls }),
      canonicalizePath(path: string) {
        return Effect.succeed(
          path === configuredWorktreePath || path === realWorktreePath ? realWorktreePath : path,
        );
      },
    };
    const service = createTaskService({
      taskStore: {
        getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
      } satisfies TaskStorePort,
      gitPort,
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createBuildStartRuntimeRegistry(calls),
      settingsConfig: createBuildSettingsConfig(
        new Set(["/repo", configuredWorktreePath, realWorktreePath, differentWorktreePath]),
      ),
      systemCommands: createBuildSystemCommands(calls),
      worktreeFiles: createBuildStartWorktreeFiles(calls),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        worktreeBasePath: "/configured/worktrees",
        hooks: { preStart: [], postComplete: [] },
      }),
    });

    const bootstrap = await Effect.runPromise(
      service.taskSessionBootstrapPrepare({
        repoPath: "/repo",
        taskId: "task-1",
        role: "spec",
        runtimeKind: "opencode",
        targetWorkingDirectory: realWorktreePath,
      }),
    );

    expect(bootstrap.workingDirectory).toBe(configuredWorktreePath);
    await Effect.runPromise(
      service.taskSessionBootstrapAbort({
        repoPath: "/repo",
        taskId: "task-1",
        bootstrapId: bootstrap.bootstrapId,
      }),
    );
    await expect(
      Effect.runPromise(
        service.taskSessionBootstrapPrepare({
          repoPath: "/repo",
          taskId: "task-1",
          role: "spec",
          runtimeKind: "opencode",
          targetWorkingDirectory: differentWorktreePath,
        }),
      ),
    ).rejects.toThrow(`must use canonical task worktree ${configuredWorktreePath}`);
  });
  test("starts a build from an existing task worktree while still transitioning the task", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "getTask", input });
          return task({
            id: "task-1",
            title: "Task 1",
            status: "ready_for_dev",
          });
        });
      },
      transitionTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "transition", input });
          return task({ id: input.taskId, status: input.status });
        });
      },
    };

    const bootstrap = await Effect.runPromise(
      createTaskService({
        taskStore,
        gitPort: createBuildStartGitPort({ calls }),
        runtimeDefinitionsService: createRuntimeDefinitionsService(),
        runtimeRegistry: createBuildStartRuntimeRegistry(calls),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        systemCommands: createBuildSystemCommands(calls),
        worktreeFiles: createBuildStartWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: ["bun test"], postComplete: [] },
          worktreeCopyPaths: [".env"],
        }),
      }).buildStart({
        repoPath: "/repo",
        taskId: "task-1",
        runtimeKind: "opencode",
      }),
    );

    expect(bootstrap).toEqual({
      runtimeKind: "opencode",
      workingDirectory: "/worktrees/repo/task-1",
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        { type: "canonicalizePath", path: "/repo" },
        { type: "isGitRepository", path: "/repo" },
        { type: "getTask", input: { repoPath: "/repo", taskId: "task-1" } },
        { type: "isGitRepository", path: "/worktrees/repo/task-1" },
        {
          type: "shareGitCommonDirectory",
          repoPath: "/repo",
          workingDir: "/worktrees/repo/task-1",
        },
        { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
        {
          type: "ensureRuntime",
          input: expect.objectContaining({
            runtimeKind: "opencode",
            repoPath: "/repo",
            workingDirectory: "/repo",
          }),
        },
        {
          type: "transition",
          input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
        },
      ]),
    );
  });

  test("rejects an occupied canonical path that is not a git worktree", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "getTask", input });
          return task({
            id: "task-1",
            title: "Task 1",
            status: "ready_for_dev",
          });
        });
      },
      transitionTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "transition", input });
          return task({ id: "task-1", status: "in_progress" });
        });
      },
    };
    const baseGitPort = createBuildStartGitPort({ calls });
    const gitPort = {
      ...baseGitPort,
      isGitRepository(path: string) {
        return Effect.sync(() => {
          calls.push({ type: "isGitRepository", path });
          return path !== "/worktrees/repo/task-1";
        });
      },
      removeWorktree(repoPath: string, worktreePath: string, force: boolean) {
        calls.push({ type: "removeWorktree", repoPath, worktreePath, force });
        return Effect.fail(
          new HostOperationError({
            operation: "test.removeWorktree",
            message: "not a git worktree",
          }),
        );
      },
    };

    await expect(
      Effect.runPromise(
        createTaskService({
          taskStore,
          gitPort,
          runtimeDefinitionsService: createRuntimeDefinitionsService(),
          runtimeRegistry: createBuildStartRuntimeRegistry(calls),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          systemCommands: createBuildSystemCommands(calls),
          worktreeFiles: createBuildStartWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).buildStart({
          repoPath: "/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        }),
      ),
    ).rejects.toThrow("exists but is not a Git worktree");
    expect(calls.some((call) => JSON.stringify(call).includes("removeWorktree"))).toBe(false);
    expect(calls.some((call) => JSON.stringify(call).includes("createWorktree"))).toBe(false);
  });

  test("does not roll back an existing task worktree when transition fails", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "getTask", input });
          return task({
            id: "task-1",
            title: "Task 1",
            status: "ready_for_dev",
          });
        });
      },
      transitionTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "transition", input });
          throw new Error("transition failed");
        });
      },
    };

    await expect(
      Effect.runPromise(
        createTaskService({
          taskStore,
          gitPort: createBuildStartGitPort({ calls }),
          runtimeDefinitionsService: createRuntimeDefinitionsService(),
          runtimeRegistry: createBuildStartRuntimeRegistry(calls),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          systemCommands: createBuildSystemCommands(calls),
          worktreeFiles: createBuildStartWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: ["bun test"], postComplete: [] },
            worktreeCopyPaths: [".env"],
          }),
        }).buildStart({
          repoPath: "/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        }),
      ),
    ).rejects.toThrow("transition failed");
    expect(calls).toEqual(
      expect.arrayContaining([
        { type: "canonicalizePath", path: "/repo" },
        { type: "isGitRepository", path: "/repo" },
        { type: "getTask", input: { repoPath: "/repo", taskId: "task-1" } },
        { type: "isGitRepository", path: "/worktrees/repo/task-1" },
        {
          type: "shareGitCommonDirectory",
          repoPath: "/repo",
          workingDir: "/worktrees/repo/task-1",
        },
        { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
        {
          type: "ensureRuntime",
          input: expect.objectContaining({
            runtimeKind: "opencode",
            repoPath: "/repo",
            workingDirectory: "/repo",
          }),
        },
        {
          type: "transition",
          input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
        },
      ]),
    );
  });

  test("rolls back the task worktree when runtime startup fails", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "getTask", input });
          return task({
            id: "task-1",
            title: "Task 1",
            status: "ready_for_dev",
          });
        });
      },
      transitionTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "transition", input });
          return task({ id: input.taskId, status: input.status });
        });
      },
    };
    const runtimeRegistry: RuntimeRegistryPort = {
      ...createBuildStartRuntimeRegistry(calls),
      ensureWorkspaceRuntime(input) {
        return Effect.gen(function* () {
          yield* Effect.sync(() => {
            calls.push({ type: "ensureRuntime", input });
          });
          return yield* Effect.fail(
            new HostOperationError({
              operation: "test.ensureRuntime",
              message: "runtime failed",
            }),
          );
        });
      },
    };

    await expect(
      Effect.runPromise(
        createTaskService({
          taskStore,
          gitPort: createBuildStartGitPort({ calls }),
          runtimeDefinitionsService: createRuntimeDefinitionsService(),
          runtimeRegistry,
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          systemCommands: createBuildSystemCommands(calls),
          worktreeFiles: createBuildStartWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).buildStart({
          repoPath: "/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        }),
      ),
    ).rejects.toThrow("opencode build runtime failed to start for task task-1");
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          type: "deleteReference",
          repoPath: "/repo",
          reference: "refs/remotes/origin/odt/task-1-task-1",
        },
        {
          type: "removeWorktree",
          repoPath: "/repo",
          worktreePath: "/worktrees/repo/task-1",
          force: true,
        },
        {
          type: "deleteLocalBranch",
          repoPath: "/repo",
          branch: "odt/task-1-task-1",
          force: true,
        },
      ]),
    );
    const callTypeSchema = z.object({ type: z.string() }).passthrough();
    expect(
      calls.some((call) => {
        const parsed = callTypeSchema.safeParse(call);
        return parsed.success && parsed.data.type === "transition";
      }),
    ).toBe(false);
  });

  test("cleans an unregistered worktree residue so a later session can recreate it", async () => {
    const calls: unknown[] = [];
    const worktreePath = "/worktrees/repo/task-1";
    const runtimeCreatedPath = `${worktreePath}/.serena`;
    const existingPaths = new Set(["/repo"]);
    const runtimeCreatedPaths = new Set<string>();
    let registered = false;
    const baseGitPort = createBuildStartGitPort({ calls });
    const gitPort = {
      ...baseGitPort,
      createWorktree(
        repoPath: string,
        targetWorktreePath: string,
        branch: string,
        createBranch: boolean,
        startPoint?: string,
      ) {
        return baseGitPort
          .createWorktree(repoPath, targetWorktreePath, branch, createBranch, startPoint)
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                existingPaths.add(targetWorktreePath);
                registered = true;
              }),
            ),
          );
      },
      isRegisteredWorktree(repoPath: string, targetWorktreePath: string) {
        return Effect.sync(() => {
          calls.push({
            type: "isRegisteredWorktree",
            repoPath,
            worktreePath: targetWorktreePath,
          });
          return registered;
        });
      },
      removeWorktree(repoPath: string, targetWorktreePath: string, force: boolean) {
        return Effect.gen(function* () {
          yield* Effect.sync(() => {
            calls.push({
              type: "removeWorktree",
              repoPath,
              worktreePath: targetWorktreePath,
              force,
            });
            registered = false;
            runtimeCreatedPaths.add(`${targetWorktreePath}/.serena`);
          });
          return yield* Effect.fail(
            new HostOperationError({
              operation: "test.removeWorktree",
              message: "worktree directory changed during removal",
            }),
          );
        });
      },
    };
    const baseWorktreeFiles = createBuildStartWorktreeFiles(calls);
    const worktreeFiles = {
      ...baseWorktreeFiles,
      removePathIfPresent(path: string) {
        return Effect.sync(() => {
          calls.push({
            type: "removePathIfPresent",
            path,
            runtimeCreatedPathPresent: runtimeCreatedPaths.has(`${path}/.serena`),
          });
          existingPaths.delete(path);
          runtimeCreatedPaths.delete(`${path}/.serena`);
        });
      },
    };
    const service = createTaskService({
      taskStore: {
        getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
      },
      gitPort,
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry: createBuildStartRuntimeRegistry(calls),
      settingsConfig: createBuildSettingsConfig(existingPaths),
      systemCommands: createBuildSystemCommands(calls),
      worktreeFiles,
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
      }),
    });

    const failedSessionBootstrap = await Effect.runPromise(
      service.taskSessionBootstrapPrepare({
        repoPath: "/repo",
        taskId: "task-1",
        role: "spec",
        runtimeKind: "opencode",
      }),
    );
    await expect(
      Effect.runPromise(
        service.taskSessionBootstrapAbort({
          repoPath: "/repo",
          taskId: "task-1",
          bootstrapId: failedSessionBootstrap.bootstrapId,
        }),
      ),
    ).resolves.toBe(true);

    expect(existingPaths.has(worktreePath)).toBe(false);
    expect(runtimeCreatedPaths.has(runtimeCreatedPath)).toBe(false);
    expect(calls).toContainEqual({
      type: "isRegisteredWorktree",
      repoPath: "/repo",
      worktreePath,
    });
    expect(calls).toContainEqual({
      type: "removePathIfPresent",
      path: worktreePath,
      runtimeCreatedPathPresent: true,
    });

    const laterSessionBootstrap = await Effect.runPromise(
      service.taskSessionBootstrapPrepare({
        repoPath: "/repo",
        taskId: "task-1",
        role: "spec",
        runtimeKind: "opencode",
      }),
    );
    expect(laterSessionBootstrap.workingDirectory).toBe(worktreePath);
    expect(
      calls.filter(
        (call) => z.object({ type: z.literal("createWorktree") }).safeParse(call).success,
      ),
    ).toHaveLength(2);
    await Effect.runPromise(
      service.taskSessionBootstrapComplete({
        repoPath: "/repo",
        taskId: "task-1",
        bootstrapId: laterSessionBootstrap.bootstrapId,
      }),
    );
  });

  test("does not roll back a task worktree when worktree creation fails before creating it", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "getTask", input });
          return task({
            id: "task-1",
            title: "Task 1",
            status: "ready_for_dev",
          });
        });
      },
      transitionTask() {
        return taskStoreEffect(async () => {
          throw new Error("unexpected transition");
        });
      },
    };
    const gitPort = {
      ...createBuildStartGitPort({ calls }),
      createWorktree() {
        return Effect.fail(
          new HostOperationError({
            operation: "test.createWorktree",
            message: "worktree create failed",
          }),
        );
      },
    };

    await expect(
      Effect.runPromise(
        createTaskService({
          taskStore,
          gitPort,
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
        }).buildStart({
          repoPath: "/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        }),
      ),
    ).rejects.toThrow("worktree create failed");

    expect(
      calls.filter((call) => {
        const parsed = z.object({ type: z.string() }).safeParse(call);
        return (
          parsed.success &&
          ["deleteReference", "removeWorktree", "deleteLocalBranch"].includes(parsed.data.type)
        );
      }),
    ).toEqual([]);
  });

  test("releases bootstrap state and worktree state when runtime startup is interrupted", async () => {
    const calls: unknown[] = [];
    const coordinator = createTaskSessionBootstrapCoordinator();
    const ensureStarted = await Effect.runPromise(Deferred.make<void>());
    const ensureBlocked = await Effect.runPromise(Deferred.make<never>());
    const runtimeRegistry = {
      ...createBuildStartRuntimeRegistry(calls),
      ensureWorkspaceRuntime(input) {
        calls.push({ type: "ensureRuntime", input });
        return Deferred.succeed(ensureStarted, undefined).pipe(
          Effect.zipRight(Deferred.await(ensureBlocked)),
        );
      },
    } satisfies RuntimeRegistryPort;
    const service = createTaskService({
      taskStore: {
        getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
      } satisfies TaskStorePort,
      taskSessionBootstrapCoordinator: coordinator,
      gitPort: createBuildStartGitPort({ calls }),
      runtimeDefinitionsService: createRuntimeDefinitionsService(),
      runtimeRegistry,
      settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
      systemCommands: createBuildSystemCommands(calls),
      worktreeFiles: createBuildStartWorktreeFiles(calls),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
      }),
    });
    const controller = new AbortController();
    const preparing = Effect.runPromise(
      service.taskSessionBootstrapPrepare({
        repoPath: "/repo",
        taskId: "task-1",
        role: "spec",
        runtimeKind: "opencode",
      }),
      { signal: controller.signal },
    );
    await Effect.runPromise(Deferred.await(ensureStarted));

    controller.abort();
    await preparing.catch(() => undefined);

    await expect(
      Effect.runPromise(coordinator.acquireBootstrap("/repo", "task-1", "bootstrap-2", "spec")),
    ).resolves.toBeUndefined();
    await Effect.runPromise(
      coordinator.finishBootstrap("/repo", "task-1", "bootstrap-2", "completed"),
    );
    await expect(
      Effect.runPromise(coordinator.runWorktreeRead("/worktrees/repo/task-1", Effect.void)),
    ).resolves.toBeUndefined();
    expect(calls).toContainEqual({
      type: "removeWorktree",
      repoPath: "/repo",
      worktreePath: "/worktrees/repo/task-1",
      force: true,
    });
  });

  test("rolls back the task worktree when the task transition fails", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "getTask", input });
          return task({
            id: "task-1",
            title: "Task 1",
            status: "ready_for_dev",
          });
        });
      },
      transitionTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "transition", input });
          throw new Error("transition failed");
        });
      },
    };

    await expect(
      Effect.runPromise(
        createTaskService({
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
        }).buildStart({
          repoPath: "/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        }),
      ),
    ).rejects.toThrow("transition failed");
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          type: "ensureRuntime",
          input: expect.objectContaining({
            runtimeKind: "opencode",
            repoPath: "/repo",
            workingDirectory: "/repo",
          }),
        },
        {
          type: "transition",
          input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
        },
        {
          type: "deleteReference",
          repoPath: "/repo",
          reference: "refs/remotes/origin/odt/task-1-task-1",
        },
        {
          type: "removeWorktree",
          repoPath: "/repo",
          worktreePath: "/worktrees/repo/task-1",
          force: true,
        },
        {
          type: "deleteLocalBranch",
          repoPath: "/repo",
          branch: "odt/task-1-task-1",
          force: true,
        },
      ]),
    );
  });
});
