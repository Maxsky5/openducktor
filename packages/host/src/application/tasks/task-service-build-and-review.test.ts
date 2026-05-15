import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildStartRuntimeRegistry,
  createBuildStartWorktreeFiles,
  createBuildSystemCommands,
  createBuildWorkspaceSettingsService,
  createRuntimeDefinitionsService,
  createTaskService,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

describe("createTaskService build and review", () => {
  test("blocks a build after requiring a non-empty reason", async () => {
    const calls: unknown[] = [];
    const blockedTask = task({ id: "task-1", status: "blocked" });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", status: "in_progress" })];
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
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return blockedTask;
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    const blocked = await createTaskService({ taskStore }).buildBlocked({
      repoPath: "/repo",
      taskId: "task-1",
      reason: " Waiting on API ",
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "transition", input: { repoPath: "/repo", taskId: "task-1", status: "blocked" } },
    ]);
    expect(blocked).toMatchObject({
      id: "task-1",
      status: "blocked",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
  });

  test("rejects build_blocked without a reason before calling the store", async () => {
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
        throw new Error("should not transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).buildBlocked({
        repoPath: "/repo",
        taskId: "task-1",
        reason: " ",
      }),
    ).rejects.toThrow("build_blocked requires a non-empty reason");
  });

  test("resumes a blocked build through a targeted task load", async () => {
    const calls: unknown[] = [];
    const resumedTask = task({ id: "task-1", status: "in_progress" });
    const taskStore: TaskStorePort = {
      async listTasks() {
        throw new Error("should not list");
      },
      async getTask(input) {
        calls.push({ type: "get", input });
        return task({ id: "task-1", status: "blocked" });
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return resumedTask;
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    const resumed = await createTaskService({ taskStore }).buildResumed({
      repoPath: "/repo",
      taskId: "task-1",
    });

    expect(calls).toEqual([
      { type: "get", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
      },
    ]);
    expect(resumed).toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
  });

  test("returns the current task without store mutation when resumed build is already in progress", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        throw new Error("should not list");
      },
      async getTask() {
        return task({ id: "task-1", status: "in_progress" });
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async transitionTask() {
        throw new Error("should not transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).buildResumed({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toMatchObject({ id: "task-1", status: "in_progress" });
  });

  test("starts a build by preparing a worktree, ensuring runtime, and transitioning the task", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks() {
        throw new Error("should not list");
      },
      async getTask(input) {
        calls.push({ type: "getTask", input });
        return task({ id: "task-1", title: "Task 1", status: "ready_for_dev" });
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return task({ id: input.taskId, status: input.status });
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTaskMetadata() {
        throw new Error("unexpected metadata");
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
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    const bootstrap = await createTaskService({
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
    }).buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" });

    expect(bootstrap).toEqual({
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      workingDirectory: "/worktrees/repo/task-1",
    });
    expect(calls).toEqual([
      { type: "canonicalizePath", path: "/repo" },
      { type: "isGitRepository", path: "/repo" },
      { type: "getTask", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "ensureDirectory", path: "/worktrees/repo" },
      { type: "referenceExists", workingDir: "/repo", reference: "origin/main" },
      {
        type: "createWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        branch: "odt/task-1-task-1",
        createBranch: true,
        startPoint: "origin/main",
      },
      {
        type: "configureBranchUpstream",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        branch: "odt/task-1-task-1",
        upstreamRemote: "origin",
      },
      {
        type: "copyConfiguredPaths",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        relativePaths: [".env"],
      },
      { command: "bun", args: ["test"], options: { cwd: "/worktrees/repo/task-1" } },
      {
        type: "ensureRuntime",
        input: expect.objectContaining({
          runtimeKind: "opencode",
          repoPath: "/repo",
          workingDirectory: "/repo",
        }),
      },
      { type: "transition", input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" } },
    ]);
  });

  test("rolls back the build worktree when pre-start hooks fail", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks() {
        throw new Error("should not list");
      },
      async getTask(input) {
        calls.push({ type: "getTask", input });
        return task({ id: "task-1", title: "Task 1", status: "ready_for_dev" });
      },
      async transitionTask() {
        throw new Error("should not transition");
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTaskMetadata() {
        throw new Error("unexpected metadata");
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
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({
        taskStore,
        gitPort: createBuildStartGitPort({ calls }),
        runtimeDefinitionsService: createRuntimeDefinitionsService(),
        runtimeRegistry: createBuildStartRuntimeRegistry(calls),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        systemCommands: createBuildSystemCommands(calls, false),
        worktreeFiles: createBuildStartWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: ["bun test"], postComplete: [] },
        }),
      }).buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
    ).rejects.toThrow("Worktree setup script command failed: bun test");

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
  });

  test("completes a build into AI review and runs post-complete hooks in the builder worktree", async () => {
    const calls: unknown[] = [];
    const updatedTask = task({ id: "task-1", status: "ai_review" });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", status: "in_progress", aiReviewEnabled: true })];
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return updatedTask;
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
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };
    const existingPaths = new Set(["/repo", "/worktrees/repo/task-1"]);
    const service = createTaskService({
      taskStore,
      settingsConfig: createBuildSettingsConfig(existingPaths),
      systemCommands: createBuildSystemCommands(calls),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: ["sh -lc 'printf cleanup'"] },
      }),
    });

    const completed = await service.buildCompleted({
      repoPath: "/repo",
      taskId: "task-1",
      summary: "Done",
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        command: "sh",
        args: ["-lc", "printf cleanup"],
        options: { cwd: "/worktrees/repo/task-1" },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "ai_review" },
      },
    ]);
    expect(completed).toMatchObject({ id: "task-1", status: "ai_review" });
  });

  test("completes a build into human review when QA is already approved", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [
          task({
            id: "task-1",
            status: "blocked",
            aiReviewEnabled: true,
            documentSummary: {
              spec: { has: false },
              plan: { has: false },
              qaReport: { has: true, verdict: "approved" },
            },
          }),
        ];
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return task({ id: "task-1", status: "human_review" });
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
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({
        taskStore,
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        systemCommands: createBuildSystemCommands(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: ["  "] },
        }),
      }).buildCompleted({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toMatchObject({ id: "task-1", status: "human_review" });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "human_review" },
      },
    ]);
  });

  test("blocks build completion when a post-complete hook fails", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", status: "in_progress", aiReviewEnabled: false })];
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return task({ id: "task-1", status: input.status });
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
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({
        taskStore,
        settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        systemCommands: createBuildSystemCommands(calls, false),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: ["sh -lc 'echo cleanup failed >&2; exit 1'"] },
        }),
      }).buildCompleted({ repoPath: "/repo", taskId: "task-1" }),
    ).rejects.toThrow("Worktree cleanup script command failed");

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        command: "sh",
        args: ["-lc", "echo cleanup failed >&2; exit 1"],
        options: { cwd: "/worktrees/repo/task-1" },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "blocked" },
      },
    ]);
  });

  test("returns review tasks unchanged from duplicate build completion", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1", status: "human_review" })];
      },
      async transitionTask() {
        throw new Error("should not transition");
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
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({
        taskStore,
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        systemCommands: createBuildSystemCommands([]),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: ["sh -lc 'exit 1'"] },
        }),
      }).buildCompleted({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toMatchObject({ id: "task-1", status: "human_review" });
  });

  test("records approved QA and moves the task to human review", async () => {
    const calls: unknown[] = [];
    const approvedTask = task({
      id: "task-1",
      status: "human_review",
      documentSummary: {
        spec: { has: false },
        plan: { has: false },
        qaReport: { has: true, verdict: "approved" },
      },
    });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", status: "ai_review" })];
      },
      async recordQaOutcome(input) {
        calls.push({ type: "qa", input });
        return approvedTask;
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

    const approved = await createTaskService({ taskStore }).qaApproved({
      repoPath: "/repo",
      taskId: "task-1",
      markdown: "Looks good",
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "qa",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          status: "human_review",
          markdown: "Looks good",
          verdict: "approved",
        },
      },
    ]);
    expect(approved).toMatchObject({
      id: "task-1",
      status: "human_review",
      agentWorkflows: { qa: { completed: true } },
    });
  });

  test("records rejected QA and moves the task back to in progress", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", status: "human_review" })];
      },
      async recordQaOutcome(input) {
        calls.push({ type: "qa", input });
        return task({
          id: "task-1",
          status: "in_progress",
          documentSummary: {
            spec: { has: false },
            plan: { has: false },
            qaReport: { has: true, verdict: "rejected" },
          },
        });
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

    const rejected = await createTaskService({ taskStore }).qaRejected({
      repoPath: "/repo",
      taskId: "task-1",
      markdown: "Needs work",
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "qa",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          status: "in_progress",
          markdown: "Needs work",
          verdict: "rejected",
        },
      },
    ]);
    expect(rejected).toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_qa"]),
    });
  });

  test("rejects QA outcomes outside review statuses before persisting", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1", status: "in_progress" })];
      },
      async recordQaOutcome() {
        throw new Error("should not persist QA");
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
      createTaskService({ taskStore }).qaApproved({
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "Looks good",
      }),
    ).rejects.toThrow("QA outcomes are only allowed from ai_review or human_review");
  });

  test("requests human changes after checking direct merge metadata", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTaskMetadata(input) {
        calls.push({ type: "metadata", input });
        return {
          spec: { markdown: "" },
          plan: { markdown: "" },
          agentSessions: [],
        };
      },
      async getTask(input) {
        calls.push({ type: "get", input });
        return task({ id: "task-1", status: "human_review" });
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return task({ id: "task-1", status: "in_progress" });
      },
      async listTasks() {
        throw new Error("should not list");
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async recordQaOutcome() {
        throw new Error("unexpected QA");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    const reopened = await createTaskService({ taskStore }).humanRequestChanges({
      repoPath: "/repo",
      taskId: "task-1",
      note: "Please adjust",
    });

    expect(calls).toEqual([
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "get", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
      },
    ]);
    expect(reopened).toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
  });

  test("blocks human change requests when direct merge metadata is pending", async () => {
    const taskStore: TaskStorePort = {
      async getTaskMetadata() {
        return {
          spec: { markdown: "" },
          plan: { markdown: "" },
          directMerge: {
            method: "merge_commit",
            sourceBranch: "odt/task-1",
            targetBranch: { remote: "origin", branch: "main" },
            mergedAt: "2026-05-10T00:00:00.000Z",
          },
          agentSessions: [],
        };
      },
      async getTask() {
        throw new Error("should not load task");
      },
      async transitionTask() {
        throw new Error("should not transition");
      },
      async listTasks() {
        throw new Error("should not list");
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async recordQaOutcome() {
        throw new Error("unexpected QA");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).humanRequestChanges({
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).rejects.toThrow("local direct merge");
  });

  test("human approval closes review tasks", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", status: "human_review" })];
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return task({ id: "task-1", status: "closed" });
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
      async recordQaOutcome() {
        throw new Error("unexpected QA");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    const closed = await createTaskService({ taskStore }).humanApprove({
      repoPath: "/repo",
      taskId: "task-1",
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "transition", input: { repoPath: "/repo", taskId: "task-1", status: "closed" } },
    ]);
    expect(closed).toMatchObject({
      id: "task-1",
      status: "closed",
      availableActions: ["view_details"],
    });
  });
});
