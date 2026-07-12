import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
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
  test("supports Planner and QA as the first worktree creator", async () => {
    for (const role of ["planner", "qa"] as const) {
      const calls: unknown[] = [];
      const service = createTaskService({
        taskStore: {
          getTask: () => Effect.succeed(task({ status: "ready_for_dev" })),
        } as TaskStorePort,
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

  test("rejects lifecycle changes during Builder startup and replays terminal calls safely", async () => {
    const status: ReturnType<typeof task>["status"] = "ready_for_dev";
    let updatedAt = "2026-01-01T00:00:00.000Z";
    const calls: unknown[] = [];
    const coordinator = createTaskSessionBootstrapCoordinator();
    const taskStore = {
      getTask: () => Effect.succeed(task({ status, updatedAt })),
      transitionTask: () => Effect.succeed(task({ status: "in_progress" })),
    } as TaskStorePort;
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
      Effect.runPromise(coordinator.beginLifecycle("/repo", ["task-1"], "reset task")),
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
    ).rejects.toThrow("changed from ready_for_dev to ready_for_dev");
    await Effect.runPromise(
      service.taskSessionBootstrapAbort({
        repoPath: "/repo",
        taskId: "task-1",
        bootstrapId: bootstrap.bootstrapId,
      }),
    );
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
    const releaseLifecycle = await Effect.runPromise(
      coordinator.beginLifecycle("/repo", ["task-1"], "close task"),
    );
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
    releaseLifecycle();
  });

  test("coordinates fork startup leases with destructive task lifecycle operations", async () => {
    const calls: unknown[] = [];
    const coordinator = createTaskSessionBootstrapCoordinator();
    const service = createTaskService({
      taskStore: {
        getTask: () => Effect.succeed(task({ status: "in_progress" })),
      } as TaskStorePort,
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

    const leaseId = await Effect.runPromise(
      service.taskSessionStartupLeasePrepare({ repoPath: "/repo", taskId: "task-1", role: "qa" }),
    );
    for (const operation of ["reset implementation", "reset task", "close task", "delete task"]) {
      await expect(
        Effect.runPromise(coordinator.beginLifecycle("/repo", ["task-1"], operation)),
      ).rejects.toThrow("bootstrap is in progress");
    }
    await Effect.runPromise(
      service.taskSessionStartupLeaseComplete({ repoPath: "/repo", taskId: "task-1", leaseId }),
    );

    const releaseLifecycle = await Effect.runPromise(
      coordinator.beginLifecycle("/repo", ["task-1"], "full reset"),
    );
    await expect(
      Effect.runPromise(
        service.taskSessionStartupLeasePrepare({
          repoPath: "/repo",
          taskId: "task-1",
          role: "spec",
        }),
      ),
    ).rejects.toThrow("full reset is in progress");
    releaseLifecycle();
  });
  test("prepares the same canonical worktree for non-Builder roles without transitioning", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "getTask", input });
          return task({ id: "task-1", title: "Task 1", status: "ready_for_dev" });
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
  test("starts a build from an existing task worktree while still transitioning the task", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "getTask", input });
          return task({ id: "task-1", title: "Task 1", status: "ready_for_dev" });
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
      }).buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
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
          return task({ id: "task-1", title: "Task 1", status: "ready_for_dev" });
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
        }).buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
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
          return task({ id: "task-1", title: "Task 1", status: "ready_for_dev" });
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
        }).buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
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

  test("rolls back the build worktree when runtime startup fails", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "getTask", input });
          return task({ id: "task-1", title: "Task 1", status: "ready_for_dev" });
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
        }).buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
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
    expect(
      calls.some(
        (call) =>
          typeof call === "object" && call !== null && "type" in call && call.type === "transition",
      ),
    ).toBe(false);
  });

  test("does not roll back a build worktree when worktree creation fails before creating it", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "getTask", input });
          return task({ id: "task-1", title: "Task 1", status: "ready_for_dev" });
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
        }).buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
      ),
    ).rejects.toThrow("worktree create failed");

    expect(
      calls.filter(
        (call) =>
          typeof call === "object" &&
          call !== null &&
          "type" in call &&
          ["deleteReference", "removeWorktree", "deleteLocalBranch"].includes(String(call.type)),
      ),
    ).toEqual([]);
  });

  test("rolls back the build worktree when the task transition fails", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return taskStoreEffect(async () => {
          calls.push({ type: "getTask", input });
          return task({ id: "task-1", title: "Task 1", status: "ready_for_dev" });
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
        }).buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
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
