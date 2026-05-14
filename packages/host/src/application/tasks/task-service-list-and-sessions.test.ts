import {
  createAgentSessionRecord,
  createAgentSessionSettingsConfig,
  createAgentSessionTaskStore,
  createAgentSessionWorkspaceSettingsService,
  createTaskService,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

describe("createTaskService list and session reads", () => {
  test("loads tasks and enriches available actions and workflow state", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
      async listTasks(input) {
        calls.push(input);
        return [
          task({
            id: "epic-1",
            issueType: "epic",
            status: "human_review",
            documentSummary: {
              spec: { has: true, updatedAt: "2026-01-03T00:00:00Z" },
              plan: { has: true, updatedAt: "2026-01-04T00:00:00Z" },
              qaReport: { has: false, verdict: "not_reviewed" },
            },
          }),
          task({ id: "task-2", parentId: "epic-1" }),
        ];
      },
    };

    const service = createTaskService({ taskStore });
    const tasks = await service.listTasks({ repoPath: "/repo", doneVisibleDays: 3 });

    expect(calls).toEqual([{ repoPath: "/repo", doneVisibleDays: 3 }]);
    expect(tasks[0]).toMatchObject({
      id: "epic-1",
      availableActions: [
        "view_details",
        "set_spec",
        "set_plan",
        "qa_start",
        "open_builder",
        "reset_implementation",
        "reset_task",
        "defer_issue",
        "human_request_changes",
      ],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });
  });

  test("allows human approval only when an epic has no active direct subtasks", async () => {
    const taskStore: TaskStorePort = {
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
      async listTasks() {
        return [
          task({
            id: "epic-1",
            issueType: "epic",
            status: "human_review",
          }),
          task({ id: "task-2", parentId: "epic-1", status: "closed" }),
        ];
      },
    };

    const tasks = await createTaskService({ taskStore }).listTasks({ repoPath: "/repo" });

    expect(tasks[0]?.availableActions).toContain("human_approve");
  });

  test("rejects invalid list command input before calling the service", async () => {
    const taskStore: TaskStorePort = {
      async createTask() {
        throw new Error("should not call store");
      },
      async updateTask() {
        throw new Error("should not call store");
      },
      async getTask() {
        throw new Error("should not call store");
      },
      async transitionTask() {
        throw new Error("should not call store");
      },
      async deleteTask() {
        throw new Error("should not call store");
      },
      async listTasks() {
        throw new Error("should not call store");
      },
    };

    const { createTaskCommandHandlers } = await import(
      "../../interface/commands/task-command-handlers"
    );
    const service = createTaskService({ taskStore });
    const handlers = createTaskCommandHandlers(service);

    expect(() =>
      handlers.tasks_list?.(
        { repoPath: "/repo", doneVisibleDays: -1 },
        { command: "tasks_list", args: { repoPath: "/repo", doneVisibleDays: -1 } },
      ),
    ).toThrow("doneVisibleDays must be greater than or equal to 0.");
  });

  test("loads task metadata through the task store", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTaskMetadata(input) {
        calls.push(input);
        return {
          spec: { markdown: "# Spec", updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        };
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async setSpecDocument() {
        throw new Error("unexpected set spec");
      },
      async setPlanDocument() {
        throw new Error("unexpected set plan");
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
      async listTasks() {
        throw new Error("unexpected list");
      },
    };

    await expect(
      createTaskService({ taskStore }).getTaskMetadata({
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toEqual({
      spec: { markdown: "# Spec", updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 },
      plan: { markdown: "# Plan" },
      agentSessions: [],
    });
    expect(calls).toEqual([{ repoPath: "/repo", taskId: "task-1" }]);
  });

  test("loads Tauri-compatible document and agent-session read commands from metadata", async () => {
    const calls: unknown[] = [];
    const session = createAgentSessionRecord();
    const taskStore: TaskStorePort = {
      async getTaskMetadata(input) {
        calls.push(input);
        return {
          spec: { markdown: "# Spec", updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 },
          plan: { markdown: "# Plan", updatedAt: "2026-05-10T11:00:00.000Z", revision: 2 },
          qaReport: {
            markdown: "# QA",
            verdict: "approved",
            updatedAt: "2026-05-10T12:00:00.000Z",
            revision: 3,
          },
          agentSessions: [session],
        };
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async setSpecDocument() {
        throw new Error("unexpected set spec");
      },
      async setPlanDocument() {
        throw new Error("unexpected set plan");
      },
      async recordQaOutcome() {
        throw new Error("unexpected QA");
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
      async listTasks() {
        throw new Error("unexpected list");
      },
    };
    const service = createTaskService({ taskStore });

    await expect(service.specGet({ repoPath: "/repo", taskId: "task-1" })).resolves.toEqual({
      markdown: "# Spec",
      updatedAt: "2026-05-10T10:00:00.000Z",
      revision: 1,
    });
    await expect(service.planGet({ repoPath: "/repo", taskId: "task-1" })).resolves.toEqual({
      markdown: "# Plan",
      updatedAt: "2026-05-10T11:00:00.000Z",
      revision: 2,
    });
    await expect(service.qaGetReport({ repoPath: "/repo", taskId: "task-1" })).resolves.toEqual({
      markdown: "# QA",
      updatedAt: "2026-05-10T12:00:00.000Z",
      revision: 3,
    });
    await expect(
      service.agentSessionsList({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toEqual([session]);
    expect(calls).toEqual([
      { repoPath: "/repo", taskId: "task-1" },
      { repoPath: "/repo", taskId: "task-1" },
      { repoPath: "/repo", taskId: "task-1" },
      { repoPath: "/repo", taskId: "task-1" },
    ]);
  });

  test("returns an empty QA document when no report is present", async () => {
    const taskStore: TaskStorePort = {
      async getTaskMetadata() {
        return {
          spec: { markdown: "" },
          plan: { markdown: "" },
          agentSessions: [],
        };
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async setSpecDocument() {
        throw new Error("unexpected set spec");
      },
      async setPlanDocument() {
        throw new Error("unexpected set plan");
      },
      async recordQaOutcome() {
        throw new Error("unexpected QA");
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
      async listTasks() {
        throw new Error("unexpected list");
      },
    };

    await expect(
      createTaskService({ taskStore }).qaGetReport({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toEqual({ markdown: "" });
  });

  test("lists agent sessions in bulk from task cards", async () => {
    const calls: unknown[] = [];
    const session = {
      externalSessionId: "session-1",
      role: "build" as const,
      startedAt: "2026-05-10T10:00:00.000Z",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
      selectedModel: null,
    };
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push(input);
        return [
          task({ id: "task-1", agentSessions: [session] }),
          task({ id: "task-2", agentSessions: [] }),
        ];
      },
      async getTaskMetadata() {
        throw new Error("should not read metadata");
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async setSpecDocument() {
        throw new Error("unexpected set spec");
      },
      async setPlanDocument() {
        throw new Error("unexpected set plan");
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async recordQaOutcome() {
        throw new Error("unexpected QA");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).agentSessionsListBulk({
        repoPath: "/repo",
        taskIds: ["task-1", "task-2"],
      }),
    ).resolves.toEqual({
      "task-1": [session],
      "task-2": [],
    });
    expect(calls).toEqual([{ repoPath: "/repo" }]);
  });

  test("does not list tasks for empty bulk agent-session requests", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        throw new Error("should not list");
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).agentSessionsListBulk({ repoPath: "/repo", taskIds: [] }),
    ).resolves.toEqual({});
  });

  test("bulk agent-session requests fail for missing task ids", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1" })];
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).agentSessionsListBulk({
        repoPath: "/repo",
        taskIds: ["task-1", "missing-task"],
      }),
    ).rejects.toThrow("Task not found: missing-task");
  });

  test("upserts an agent session after validating a repository working directory", async () => {
    const calls: unknown[] = [];
    const taskStore = createAgentSessionTaskStore(calls);
    const service = createTaskService({
      taskStore,
      settingsConfig: createAgentSessionSettingsConfig(new Set(["/repo", "/repo/task-1"])),
      workspaceSettingsService: createAgentSessionWorkspaceSettingsService({
        repoPath: "/repo",
        effectiveWorktreeBasePath: "/worktrees/repo",
      }),
    });

    await expect(
      service.agentSessionUpsert({
        repoPath: "/repo",
        taskId: "task-1",
        session: createAgentSessionRecord({
          workingDirectory: "/repo/task-1",
        }),
      }),
    ).resolves.toBe(true);

    expect(calls).toEqual([
      {
        repoPath: "/repo",
        taskId: "task-1",
        session: createAgentSessionRecord({ workingDirectory: "/repo/task-1" }),
      },
    ]);
  });

  test("upserts an agent session from the configured worktree base", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskStore: createAgentSessionTaskStore(calls),
      settingsConfig: createAgentSessionSettingsConfig(
        new Set(["/repo", "/worktrees/repo", "/worktrees/repo/task-1"]),
      ),
      workspaceSettingsService: createAgentSessionWorkspaceSettingsService({
        repoPath: "/repo",
        effectiveWorktreeBasePath: "/worktrees/repo",
      }),
    });

    await expect(
      service.agentSessionUpsert({
        repoPath: "/repo",
        taskId: "task-1",
        session: createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
      }),
    ).resolves.toBe(true);

    expect(calls).toHaveLength(1);
  });

  test("upserts an agent session from the repository default worktree base", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskStore: createAgentSessionTaskStore(calls),
      settingsConfig: createAgentSessionSettingsConfig(
        new Set(["/repo", "/repo-default-worktrees/repo", "/repo-default-worktrees/repo/task-1"]),
      ),
      workspaceSettingsService: createAgentSessionWorkspaceSettingsService({
        repoPath: "/repo",
        effectiveWorktreeBasePath: "/worktrees/repo",
      }),
    });

    await expect(
      service.agentSessionUpsert({
        repoPath: "/repo",
        taskId: "task-1",
        session: createAgentSessionRecord({
          workingDirectory: "/repo-default-worktrees/repo/task-1",
        }),
      }),
    ).resolves.toBe(true);

    expect(calls).toHaveLength(1);
  });

  test("rejects agent sessions outside the repository and worktree bases", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskStore: createAgentSessionTaskStore(calls),
      settingsConfig: createAgentSessionSettingsConfig(new Set(["/repo", "/outside/task-1"])),
      workspaceSettingsService: createAgentSessionWorkspaceSettingsService({
        repoPath: "/repo",
        effectiveWorktreeBasePath: "/worktrees/repo",
      }),
    });

    await expect(
      service.agentSessionUpsert({
        repoPath: "/repo",
        taskId: "task-1",
        session: createAgentSessionRecord({ workingDirectory: "/outside/task-1" }),
      }),
    ).rejects.toThrow("Agent session workingDirectory must stay inside repository");
    expect(calls).toEqual([]);
  });
});
