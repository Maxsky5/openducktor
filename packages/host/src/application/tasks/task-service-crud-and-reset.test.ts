import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createBuildWorkspaceSettingsService,
  createDirectMergeDevServerService,
  createDirectMergeGitPort,
  createTaskService,
  type TaskActivityGuardPort,
  type TaskStorePort,
  task,
  type WorktreeFilePort,
} from "./test-support/task-workflow-harness";

const createCleanupWorktreeFiles = (calls: unknown[]): WorktreeFilePort => ({
  async copyConfiguredPaths() {
    throw new Error("unexpected copy configured paths");
  },
  async removePathIfPresent(path) {
    calls.push({ type: "removePathIfPresent", path });
  },
  resolveWorktreePath(repoPath, worktreePath) {
    return worktreePath.startsWith("/") ? worktreePath : `${repoPath}/${worktreePath}`;
  },
  async pathIsWithinRoot(root, candidate) {
    return candidate === root || candidate.startsWith(`${root}/`);
  },
});

describe("createTaskService task mutations and reset", () => {
  test("creates a task after validating parent relationships and enriches the result", async () => {
    const calls: unknown[] = [];
    const createdTask = task({ id: "task-2", parentId: "epic-1", status: "open" });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "epic-1", issueType: "epic", status: "open" })];
      },
      async createTask(input) {
        calls.push({ type: "create", input });
        return createdTask;
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

    const created = await createTaskService({ taskStore }).createTask({
      repoPath: "/repo",
      task: {
        title: "Child",
        issueType: "task",
        priority: 2,
        parentId: " epic-1 ",
        aiReviewEnabled: true,
      },
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "create",
        input: {
          repoPath: "/repo",
          task: {
            title: "Child",
            issueType: "task",
            priority: 2,
            parentId: " epic-1 ",
            aiReviewEnabled: true,
          },
        },
      },
    ]);
    expect(created).toMatchObject({
      id: "task-2",
      availableActions: ["view_details", "set_spec", "set_plan", "build_start", "reset_task"],
    });
    expect(created.availableActions).not.toContain("defer_issue");
  });

  test("rejects subtasks under non-epic parents before creating", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1", issueType: "task" })];
      },
      async createTask() {
        throw new Error("should not create");
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
      createTaskService({ taskStore }).createTask({
        repoPath: "/repo",
        task: {
          title: "Child",
          issueType: "task",
          priority: 2,
          parentId: "task-1",
          aiReviewEnabled: true,
        },
      }),
    ).rejects.toThrow("Only epics can have subtasks.");
  });

  test("deletes a task without subtasks and stops task-scoped dev servers", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task()];
      },
      async deleteTask(input) {
        calls.push({ type: "delete", input });
        return true;
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
    };

    await expect(
      createTaskService({
        devServerService: createDirectMergeDevServerService(calls),
        gitPort: createDirectMergeGitPort({ calls }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        taskStore,
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).deleteTask({ repoPath: "/repo", taskId: "task-1", deleteSubtasks: false }),
    ).resolves.toEqual({ ok: true });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "listBranches", workingDir: "/repo" },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "delete",
        input: { repoPath: "/repo", taskId: "task-1", deleteSubtasks: false },
      },
    ]);
  });

  test("requires confirmation before deleting a task with subtasks", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [
          task({ id: "epic-1", issueType: "epic" }),
          task({ id: "task-1", parentId: "epic-1" }),
        ];
      },
      async deleteTask() {
        throw new Error("unexpected delete");
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
    };

    await expect(
      createTaskService({
        devServerService: createDirectMergeDevServerService(calls),
        gitPort: createDirectMergeGitPort({ calls }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        taskStore,
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).deleteTask({ repoPath: "/repo", taskId: "epic-1", deleteSubtasks: false }),
    ).rejects.toThrow("Task epic-1 has 1 subtasks. Confirm subtask deletion to continue.");

    expect(calls).toEqual([{ type: "list", input: { repoPath: "/repo" } }]);
  });

  test("deletes subtasks with inactive session guard and cleans related worktrees and branches", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [
          task({ id: "epic-1", issueType: "epic", subtaskIds: ["task-1"] }),
          task({
            id: "task-1",
            parentId: "epic-1",
            agentSessions: [
              createAgentSessionRecord({
                workingDirectory: "/worktrees/repo/task-1",
              }),
            ],
          }),
        ];
      },
      async deleteTask(input) {
        calls.push({ type: "delete", input });
        return true;
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
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      async ensureNoActiveTaskDeleteRuns(input) {
        calls.push({ type: "activityGuard", input });
      },
      async ensureNoActiveTaskResetActivity() {
        throw new Error("unexpected reset activity guard");
      },
    };

    await expect(
      createTaskService({
        devServerService: createDirectMergeDevServerService(calls),
        gitPort: createDirectMergeGitPort({
          calls,
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
          branches: {
            "/repo": [
              { name: "main", isCurrent: true, isRemote: false },
              { name: "odt/task-1", isCurrent: false, isRemote: false },
              { name: "origin/odt/task-1", isCurrent: false, isRemote: true },
            ],
          },
        }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        taskActivityGuard,
        taskStore,
        worktreeFiles: createCleanupWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).deleteTask({ repoPath: "/repo", taskId: "epic-1", deleteSubtasks: true }),
    ).resolves.toEqual({ ok: true });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "activityGuard",
        input: {
          repoPath: "/repo",
          taskIds: ["epic-1", "task-1"],
          tasks: expect.arrayContaining([
            expect.objectContaining({ id: "epic-1" }),
            expect.objectContaining({ id: "task-1" }),
          ]),
        },
      },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      { type: "listBranches", workingDir: "/repo" },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "epic-1" } },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: true,
      },
      { type: "removePathIfPresent", path: "/worktrees/repo/task-1" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      {
        type: "delete",
        input: { repoPath: "/repo", taskId: "epic-1", deleteSubtasks: true },
      },
    ]);
  });

  test("deletes closed tasks with stranded managed worktree directories", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [
          task({
            id: "task-1",
            status: "closed",
            agentSessions: [
              createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
            ],
          }),
        ];
      },
      async deleteTask(input) {
        calls.push({ type: "delete", input });
        return true;
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
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      async ensureNoActiveTaskDeleteRuns(input) {
        calls.push({ type: "activityGuard", input });
      },
      async ensureNoActiveTaskResetActivity() {
        throw new Error("unexpected reset activity guard");
      },
    };

    await expect(
      createTaskService({
        devServerService: createDirectMergeDevServerService(calls),
        gitPort: createDirectMergeGitPort({
          calls,
          branches: {
            "/repo": [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
          },
          removeWorktreeErrors: {
            "/repo|/worktrees/repo/task-1|true": new Error(
              "fatal: '/worktrees/repo/task-1' is not a working tree",
            ),
          },
        }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        taskActivityGuard,
        taskStore,
        worktreeFiles: createCleanupWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).deleteTask({ repoPath: "/repo", taskId: "task-1", deleteSubtasks: false }),
    ).resolves.toEqual({ ok: true });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "activityGuard",
        input: {
          repoPath: "/repo",
          taskIds: ["task-1"],
          tasks: [expect.objectContaining({ id: "task-1" })],
        },
      },
      { type: "listBranches", workingDir: "/repo" },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: true,
      },
      { type: "removePathIfPresent", path: "/worktrees/repo/task-1" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      {
        type: "delete",
        input: { repoPath: "/repo", taskId: "task-1", deleteSubtasks: false },
      },
    ]);
  });

  test("fails fast when task deletion needs live activity checks but no guard is configured", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [
          task({
            agentSessions: [
              createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
            ],
          }),
        ];
      },
      async deleteTask() {
        throw new Error("unexpected delete");
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
    };

    await expect(
      createTaskService({
        devServerService: createDirectMergeDevServerService([]),
        gitPort: createDirectMergeGitPort({ calls: [] }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        taskStore,
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).deleteTask({ repoPath: "/repo", taskId: "task-1", deleteSubtasks: false }),
    ).rejects.toThrow(
      "task_delete requires runtime session activity checks for tasks with build or QA sessions.",
    );
  });

  test("resets implementation after activity guard and cleans builder state", async () => {
    const calls: unknown[] = [];
    const currentTask = task({
      status: "ai_review",
      documentSummary: {
        spec: { has: true, updatedAt: "2026-05-01T00:00:00.000Z" },
        plan: { has: true, updatedAt: "2026-05-02T00:00:00.000Z" },
        qaReport: {
          has: true,
          updatedAt: "2026-05-03T00:00:00.000Z",
          verdict: "approved",
        },
      },
      agentSessions: [
        createAgentSessionRecord({
          workingDirectory: "/worktrees/repo/task-1",
        }),
      ],
    });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [currentTask];
      },
      async clearAgentSessionsByRoles(input) {
        calls.push({ type: "clearAgentSessions", input });
        return true;
      },
      async clearQaReports(input) {
        calls.push({ type: "clearQaReports", input });
        return true;
      },
      async setPullRequest(input) {
        calls.push({ type: "setPullRequest", input });
        return true;
      },
      async setDirectMerge(input) {
        calls.push({ type: "setDirectMerge", input });
        return true;
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return task({ id: "task-1", status: input.status });
      },
      async deleteTask() {
        throw new Error("unexpected delete");
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
        throw new Error("unexpected qa");
      },
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      async ensureNoActiveTaskDeleteRuns() {
        throw new Error("unexpected delete activity guard");
      },
      async ensureNoActiveTaskResetActivity(input) {
        calls.push({ type: "resetActivityGuard", input });
      },
    };

    await expect(
      createTaskService({
        devServerService: createDirectMergeDevServerService(calls),
        gitPort: createDirectMergeGitPort({
          calls,
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
          branches: {
            "/repo": [
              { name: "main", isCurrent: true, isRemote: false },
              { name: "odt/task-1", isCurrent: false, isRemote: false },
            ],
          },
        }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        taskActivityGuard,
        taskStore,
        worktreeFiles: createCleanupWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).resetImplementation({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toMatchObject({ id: "task-1", status: "ready_for_dev" });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "resetActivityGuard",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          sessions: currentTask.agentSessions,
          operationLabel: "reset implementation",
          sessionRoles: ["build", "qa"],
        },
      },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      { type: "listBranches", workingDir: "/repo" },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: true,
      },
      { type: "removePathIfPresent", path: "/worktrees/repo/task-1" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      {
        type: "clearAgentSessions",
        input: { repoPath: "/repo", taskId: "task-1", roles: ["build", "qa"] },
      },
      { type: "clearQaReports", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "setPullRequest",
        input: { repoPath: "/repo", taskId: "task-1", pullRequest: null },
      },
      {
        type: "setDirectMerge",
        input: { repoPath: "/repo", taskId: "task-1", directMerge: null },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "ready_for_dev" },
      },
    ]);
  });

  test("resets a task by clearing workflow artifacts and rolling status back to open", async () => {
    const calls: unknown[] = [];
    const currentTask = task({
      status: "human_review",
      agentSessions: [
        createAgentSessionRecord({
          role: "planner",
          workingDirectory: "/worktrees/repo/task-1",
        }),
      ],
    });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [currentTask];
      },
      async clearWorkflowDocuments(input) {
        calls.push({ type: "clearWorkflowDocuments", input });
        return true;
      },
      async clearAgentSessionsByRoles(input) {
        calls.push({ type: "clearAgentSessions", input });
        return true;
      },
      async setPullRequest(input) {
        calls.push({ type: "setPullRequest", input });
        return true;
      },
      async setDirectMerge(input) {
        calls.push({ type: "setDirectMerge", input });
        return true;
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return task({ id: "task-1", status: input.status });
      },
      async deleteTask() {
        throw new Error("unexpected delete");
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
        throw new Error("unexpected qa");
      },
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      async ensureNoActiveTaskDeleteRuns() {
        throw new Error("unexpected delete activity guard");
      },
      async ensureNoActiveTaskResetActivity(input) {
        calls.push({ type: "resetActivityGuard", input });
      },
    };

    await expect(
      createTaskService({
        devServerService: createDirectMergeDevServerService(calls),
        gitPort: createDirectMergeGitPort({
          calls,
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
          branches: {
            "/repo": [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
          },
        }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        taskActivityGuard,
        taskStore,
        worktreeFiles: createCleanupWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).resetTask({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toMatchObject({ id: "task-1", status: "open" });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "resetActivityGuard",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          sessions: currentTask.agentSessions,
          operationLabel: "reset task",
          sessionRoles: ["spec", "planner", "build", "qa"],
        },
      },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      { type: "listBranches", workingDir: "/repo" },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: true,
      },
      { type: "removePathIfPresent", path: "/worktrees/repo/task-1" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      {
        type: "clearWorkflowDocuments",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        type: "clearAgentSessions",
        input: { repoPath: "/repo", taskId: "task-1", roles: ["spec", "planner", "build", "qa"] },
      },
      {
        type: "setPullRequest",
        input: { repoPath: "/repo", taskId: "task-1", pullRequest: null },
      },
      {
        type: "setDirectMerge",
        input: { repoPath: "/repo", taskId: "task-1", directMerge: null },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "open" },
      },
    ]);
  });

  test("fails fast when implementation reset needs live activity checks but no guard is configured", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [
          task({
            status: "blocked",
            agentSessions: [
              createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
            ],
          }),
        ];
      },
      async clearAgentSessionsByRoles() {
        throw new Error("unexpected clear sessions");
      },
      async clearQaReports() {
        throw new Error("unexpected clear QA");
      },
      async setPullRequest() {
        throw new Error("unexpected set PR");
      },
      async setDirectMerge() {
        throw new Error("unexpected set direct merge");
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
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
    };

    await expect(
      createTaskService({
        devServerService: createDirectMergeDevServerService([]),
        gitPort: createDirectMergeGitPort({ calls: [] }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        taskStore,
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).resetImplementation({ repoPath: "/repo", taskId: "task-1" }),
    ).rejects.toThrow(
      "task_reset_implementation requires runtime session activity checks for tasks with build or QA sessions.",
    );
  });

  test("updates a task after validating parent relationships and enriches the result", async () => {
    const calls: unknown[] = [];
    const updatedTask = task({ id: "task-1", status: "ready_for_dev", issueType: "feature" });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", issueType: "task", status: "open" })];
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask(input) {
        calls.push({ type: "update", input });
        return updatedTask;
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

    const updated = await createTaskService({ taskStore }).updateTask({
      repoPath: "/repo",
      taskId: "task-1",
      patch: {
        issueType: "feature",
        title: "Updated",
        targetBranch: { remote: "origin", branch: "main" },
      },
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "update",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          patch: {
            issueType: "feature",
            title: "Updated",
            targetBranch: { remote: "origin", branch: "main" },
          },
        },
      },
    ]);
    expect(updated).toMatchObject({
      id: "task-1",
      agentWorkflows: {
        planner: { required: true, available: true },
        builder: { available: true },
      },
    });
  });

  test("rejects update when converting a task with subtasks into a subtask", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [
          task({ id: "task-1", issueType: "feature" }),
          task({ id: "task-2", parentId: "task-1" }),
          task({ id: "epic-2", issueType: "epic" }),
        ];
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("should not update");
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
      createTaskService({ taskStore }).updateTask({
        repoPath: "/repo",
        taskId: "task-1",
        patch: { parentId: "epic-2" },
      }),
    ).rejects.toThrow("Tasks with subtasks cannot become subtasks.");
  });

  test("transitions a task after validating workflow rules and enriches the result", async () => {
    const calls: unknown[] = [];
    const updatedTask = task({ id: "task-1", status: "in_progress", issueType: "bug" });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", issueType: "bug", status: "open" })];
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
        return updatedTask;
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    const transitioned = await createTaskService({ taskStore }).transitionTask({
      repoPath: "/repo",
      taskId: "task-1",
      status: "in_progress",
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
      },
    ]);
    expect(transitioned).toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
  });

  test("returns the current task without store mutation when transition status is unchanged", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1", issueType: "task", status: "open" })];
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
      createTaskService({ taskStore }).transitionTask({
        repoPath: "/repo",
        taskId: "task-1",
        status: "open",
      }),
    ).resolves.toMatchObject({ id: "task-1", status: "open" });
  });

  test("rejects invalid task transitions before calling the store", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "feature-1", issueType: "feature", status: "open" })];
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
      createTaskService({ taskStore }).transitionTask({
        repoPath: "/repo",
        taskId: "feature-1",
        status: "in_progress",
      }),
    ).rejects.toThrow("Transition not allowed for feature-1 (feature): open -> in_progress");
  });
});
