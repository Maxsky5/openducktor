import type { TaskMetadataArtifact } from "@openducktor/contracts";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { HostOperationError } from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
import {
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
} from "../../test-support/service-test-doubles";
import {
  createAgentSessionRecord,
  createAgentSessionSettingsConfig,
  createAgentSessionTaskStore,
  createAgentSessionWorkspaceSettingsService,
  createTaskService,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

describe("createTaskService list and session reads", () => {
  test("loads Kanban tasks with zero and default host-owned retention settings", async () => {
    const calls: Array<Parameters<NonNullable<TaskStorePort["listTasks"]>>[0]> = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        calls.push(input);
        return Effect.succeed([]);
      },
    };
    let globalReads = 0;
    let snapshotReads = 0;
    const settingsInputs = [
      {
        ...createDefaultGlobalConfig(),
        kanban: { doneVisibleDays: 0, emptyColumnDisplay: "show", taskCardView: "normal" },
      } as const,
      createDefaultGlobalConfig(),
    ];

    for (const settings of settingsInputs) {
      const workspaceSettingsService = createWorkspaceSettingsServiceTestDouble({
        getSettingsSnapshot: () => {
          snapshotReads += 1;
          return Effect.die(new Error("Unexpected full settings snapshot"));
        },
      });
      const service = createTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskStore,
        workspaceSettingsService,
        settingsConfig: createSettingsConfigTestDouble({
          readGlobalConfig: () => {
            globalReads += 1;
            return Effect.succeed(settings);
          },
        }),
      });
      await expect(
        Effect.runPromise(service.listKanbanTasks({ workspaceId: "repo", repoPath: "/repo" })),
      ).resolves.toEqual([]);
    }

    expect(calls).toEqual([
      { workspaceId: "repo", repoPath: "/repo", doneVisibleDays: 0 },
      { workspaceId: "repo", repoPath: "/repo", doneVisibleDays: 1 },
    ]);
    expect(globalReads).toBe(2);
    expect(snapshotReads).toBe(0);
  });

  test("lists all task IDs through the ID read without loading cards", async () => {
    const calls: Array<Parameters<NonNullable<TaskStorePort["listTaskIds"]>>[0]> = [];
    const taskStore: TaskStorePort = {
      listTaskIds(input) {
        calls.push(input);
        return Effect.succeed(["task-open", "task-closed-long-ago"]);
      },
    };
    const service = createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore });

    await expect(
      Effect.runPromise(service.listTaskIds({ workspaceId: "repo", repoPath: "/repo" })),
    ).resolves.toEqual(["task-open", "task-closed-long-ago"]);
    expect(calls).toEqual([{ workspaceId: "repo", repoPath: "/repo" }]);
  });

  test("preserves typed failures from the task ID read", async () => {
    const failure = new HostOperationError({
      operation: "sqliteTaskRepository.listTaskIds",
      message: "Cannot read task IDs.",
    });
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskStore: { listTaskIds: () => Effect.fail(failure) },
    });

    expect(
      await Effect.runPromise(
        Effect.flip(service.listTaskIds({ workspaceId: "repo", repoPath: "/repo" })),
      ),
    ).toBe(failure);
  });

  test("preserves typed task asset failures from task mutations", async () => {
    const failure = new TaskAssetError({
      operation: "create",
      code: "promotion",
      taskId: "task-1",
      assetIds: ["550e8400-e29b-41d4-a716-446655440000"],
      failedPhase: "promote_staged_file",
      durableState: "unchanged",
      retryAllowed: true,
      message: "Failed to promote a staged task asset.",
    });
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskStore: {
        createTask: () => Effect.fail(failure),
      },
    });

    await expect(
      Effect.runPromise(
        Effect.flip(service.createTask({ workspaceId: "repo", repoPath: "/repo", task: task() })),
      ),
    ).resolves.toBe(failure);
  });

  test("loads agent sessions for task IDs with one task-store call", async () => {
    const session = createAgentSessionRecord();
    const calls: Array<Parameters<NonNullable<TaskStorePort["listAgentSessionsForTasks"]>>[0]> = [];
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskStore: {
        listAgentSessionsForTasks(input) {
          calls.push(input);
          return Effect.succeed([{ taskId: "task-1", agentSessions: [session] }]);
        },
      },
    });

    await expect(
      Effect.runPromise(
        service.agentSessionsListForTasks({
          workspaceId: "repo",
          repoPath: "/repo",
          taskIds: ["task-1", "task-2"],
        }),
      ),
    ).resolves.toEqual([{ taskId: "task-1", agentSessions: [session] }]);
    expect(calls).toEqual([
      { workspaceId: "repo", repoPath: "/repo", taskIds: ["task-1", "task-2"] },
    ]);
  });

  test("loads tasks and enriches available actions and workflow state", async () => {
    const calls: Array<Parameters<NonNullable<TaskStorePort["listTasks"]>>[0]> = [];
    const taskStore: TaskStorePort = {
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            return [
              task({
                id: "feature-1",
                issueType: "feature",
                status: "human_review",
                artifactSummary: {
                  spec: { present: true, updatedAt: "2026-01-03T00:00:00Z" },
                  plan: { present: true, updatedAt: "2026-01-04T00:00:00Z" },
                  qaReport: { present: false },
                },
              }),
            ];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    const service = createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore });
    const tasks = await Effect.runPromise(
      service.listTasks({ workspaceId: "repo", repoPath: "/repo", doneVisibleDays: 3 }),
    );
    expect(calls).toEqual([{ workspaceId: "repo", repoPath: "/repo", doneVisibleDays: 3 }]);
    expect(tasks[0]).toMatchObject({
      id: "feature-1",
      availableActions: [
        "view_details",
        "set_spec",
        "set_plan",
        "qa_start",
        "open_builder",
        "reset_implementation",
        "reset_task",
        "human_request_changes",
        "human_approve",
        "close_task",
      ],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });
  });
  test("loads task metadata through the task store", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            return {
              artifacts: {
                spec: { markdown: "# Spec", updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 },
                plan: { markdown: "# Plan" },
              },
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore }).getTaskMetadata({
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).resolves.toEqual({
      artifacts: {
        spec: { markdown: "# Spec", updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 },
        plan: { markdown: "# Plan" },
      },
      agentSessions: [],
    });
    expect(calls).toEqual([{ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }]);
  });
  test("loads one workflow document without reading full metadata", async () => {
    const artifacts = new Map<string, TaskMetadataArtifact>([
      ["spec", { markdown: "# Spec", updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 }],
      ["plan", { markdown: "# Plan", updatedAt: "2026-05-10T11:00:00.000Z", revision: 2 }],
      ["qaReport", { markdown: "# QA", verdict: "approved", revision: 3 }],
    ]);
    const reads: string[] = [];
    const taskStore: TaskStorePort = {
      getWorkflowArtifact: ({ code }) => {
        reads.push(code);
        return Effect.succeed(artifacts.get(code) ?? { markdown: "" });
      },
    };
    const service = createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore });
    for (const code of ["spec", "plan", "qaReport"] as const) {
      expect(
        await Effect.runPromise(
          service.workflowArtifactGet({
            workspaceId: "repo",
            repoPath: "/repo",
            taskId: "task-1",
            code,
          }),
        ),
      ).toEqual(artifacts.get(code)!);
    }
    expect(reads).toEqual(["spec", "plan", "qaReport"]);
  });
  test("upserts an agent session after validating a repository working directory", async () => {
    const calls: unknown[] = [];
    const taskStore = createAgentSessionTaskStore(calls);
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskStore,
      gitPort: createGitPortTestDouble({
        readCheckout: (path) => Effect.succeed({ root: path, commonDirectory: "/repo/.git" }),
      }),
      settingsConfig: createAgentSessionSettingsConfig(new Set(["/repo", "/repo/task-1"])),
      workspaceSettingsService: createAgentSessionWorkspaceSettingsService({
        repoPath: "/repo",
        effectiveWorktreeBasePath: "/worktrees/repo",
      }),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionUpsert({
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          session: createAgentSessionRecord({
            workingDirectory: "/repo/task-1",
          }),
        }),
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual([
      {
        workspaceId: "repo",
        repoPath: "/repo",
        taskId: "task-1",
        session: createAgentSessionRecord({ workingDirectory: "/repo/task-1" }),
        ownershipScope: {
          catalogRevision: 0,
          workspaces: [{ workspaceId: "repo", repoPath: "/repo", workspaceName: "Repo" }],
        },
      },
    ]);
  });
  test("deletes one exact durable agent session identity", async () => {
    const calls: Array<Parameters<NonNullable<TaskStorePort["deleteAgentSession"]>>[0]> = [];
    const taskStore: TaskStorePort = {
      deleteAgentSession(input: Parameters<NonNullable<TaskStorePort["deleteAgentSession"]>>[0]) {
        return Effect.sync(() => {
          calls.push(input);
          return true;
        });
      },
    };
    const service = createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore });
    const identity = {
      externalSessionId: "session-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/task-1",
    };

    await expect(
      Effect.runPromise(
        service.agentSessionDelete({
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          identity,
        }),
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual([{ workspaceId: "repo", repoPath: "/repo", taskId: "task-1", identity }]);
  });
  test("upserts an agent session from the configured worktree base", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskStore: createAgentSessionTaskStore(calls),
      gitPort: createGitPortTestDouble({
        readCheckout: (path) => Effect.succeed({ root: path, commonDirectory: "/repo/.git" }),
      }),
      settingsConfig: createAgentSessionSettingsConfig(
        new Set(["/repo", "/worktrees/repo", "/worktrees/repo/task-1"]),
      ),
      workspaceSettingsService: createAgentSessionWorkspaceSettingsService({
        repoPath: "/repo",
        effectiveWorktreeBasePath: "/worktrees/repo",
      }),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionUpsert({
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          session: createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
        }),
      ),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(1);
  });
  test("validates the selected workspace worktree base when two workspaces share a repository", async () => {
    const calls: unknown[] = [];
    const base = createAgentSessionWorkspaceSettingsService({
      repoPath: "/repo",
      effectiveWorktreeBasePath: "/worktrees/foreign",
    });
    const catalog = await Effect.runPromise(base.getWorkspaceCatalog());
    const foreign = { ...catalog.openWorkspaces[0]!, workspaceId: "foreign" };
    const selected = {
      ...foreign,
      workspaceId: "selected",
      effectiveWorktreeBasePath: "/worktrees/selected",
    };
    const service = createTaskService({
      taskStore: createAgentSessionTaskStore(calls),
      settingsConfig: createAgentSessionSettingsConfig(
        new Set(["/repo", "/worktrees/selected", "/worktrees/selected/task-1"]),
      ),
      gitPort: createGitPortTestDouble({
        canonicalizePath: (path) => Effect.succeed(path),
        readCheckout: (path) => Effect.succeed({ root: path, commonDirectory: "/repo/.git" }),
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
        getRepoConfig: () =>
          Effect.succeed(
            repoConfigFixture({
              workspaceId: selected.workspaceId,
              workspaceName: selected.workspaceName,
              repoPath: selected.repoPath,
              worktreeBasePath: selected.effectiveWorktreeBasePath,
            }),
          ),
        getWorkspaceCatalog: () =>
          Effect.succeed({ ...catalog, openWorkspaces: [foreign, selected] }),
        listWorkspaces: () => Effect.succeed([foreign, selected]),
      }),
    });
    expect(
      await Effect.runPromise(
        service.agentSessionUpsert({
          workspaceId: selected.workspaceId,
          repoPath: "/repo",
          taskId: "task-1",
          session: createAgentSessionRecord({ workingDirectory: "/worktrees/selected/task-1" }),
        }),
      ),
    ).toBe(true);
    expect(calls).toMatchObject([{ workspaceId: selected.workspaceId }]);
  });
  test("upserts an agent session from the repository default worktree base", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskStore: createAgentSessionTaskStore(calls),
      gitPort: createGitPortTestDouble({
        readCheckout: (path) => Effect.succeed({ root: path, commonDirectory: "/repo/.git" }),
      }),
      settingsConfig: createAgentSessionSettingsConfig(
        new Set(["/repo", "/repo-default-worktrees/repo", "/repo-default-worktrees/repo/task-1"]),
      ),
      workspaceSettingsService: createAgentSessionWorkspaceSettingsService({
        repoPath: "/repo",
        effectiveWorktreeBasePath: "/worktrees/repo",
      }),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionUpsert({
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          session: createAgentSessionRecord({
            workingDirectory: "/repo-default-worktrees/repo/task-1",
          }),
        }),
      ),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(1);
  });
  test("rejects agent sessions outside the repository and worktree bases", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskStore: createAgentSessionTaskStore(calls),
      gitPort: createGitPortTestDouble({
        readCheckout: (path) => Effect.succeed({ root: path, commonDirectory: "/repo/.git" }),
      }),
      settingsConfig: createAgentSessionSettingsConfig(new Set(["/repo", "/outside/task-1"])),
      workspaceSettingsService: createAgentSessionWorkspaceSettingsService({
        repoPath: "/repo",
        effectiveWorktreeBasePath: "/worktrees/repo",
      }),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionUpsert({
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          session: createAgentSessionRecord({ workingDirectory: "/outside/task-1" }),
        }),
      ),
    ).rejects.toThrow("Agent session workingDirectory must stay inside repository");
    expect(calls).toEqual([]);
  });
});
