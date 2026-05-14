import {
  createAgentSessionRecord,
  createApprovalSystemCommands,
  createBuildSettingsConfig,
  createBuildWorkspaceSettingsService,
  createDirectMergeDevServerService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createTaskService,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

describe("createTaskService direct merge", () => {
  test("records a published direct merge and moves ai review to human review", async () => {
    const calls: unknown[] = [];
    const humanReviewTask = task({ status: "human_review" });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ status: "ai_review" })];
      },
      async getTaskMetadata(input) {
        calls.push({ type: "metadata", input });
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        };
      },
      async setDirectMerge(input) {
        calls.push({ type: "setDirectMerge", input });
        return true;
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return humanReviewTask;
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
        throw new Error("unexpected qa");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };
    const service = createTaskService({
      devServerService: createDirectMergeDevServerService(calls),
      gitPort: {
        ...createDirectMergeGitPort({
          calls,
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
        }),
        async getWorktreeStatusSummaryData(workingDir, targetBranch, diffScope) {
          calls.push({ type: "summary", workingDir, targetBranch, diffScope });
          return {
            currentBranch: { name: "odt/task-1", detached: false },
            fileStatuses: [],
            fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
          };
        },
        async suggestedSquashCommitMessage(workingDir, sourceBranch, targetBranch) {
          calls.push({ type: "suggestedSquash", workingDir, sourceBranch, targetBranch });
          return "Direct merge task";
        },
        async mergeBranch(workingDir, request) {
          calls.push({ type: "mergeBranch", workingDir, request });
          return { outcome: "merged", output: "merged" };
        },
      },
      settingsConfig: {
        ...createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        async readConfig() {
          calls.push({ type: "readConfig" });
          return { version: 2, git: { defaultMergeMethod: "merge_commit" } };
        },
      },
      systemCommands: createApprovalSystemCommands(),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
      }),
    });

    await expect(
      service.directMerge({
        repoPath: "/repo",
        taskId: "task-1",
        input: { mergeMethod: "merge_commit" },
      }),
    ).resolves.toMatchObject({
      outcome: "completed",
      task: { id: "task-1", status: "human_review" },
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "readConfig" },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      {
        type: "summary",
        workingDir: "/worktrees/repo/task-1",
        targetBranch: "origin/main",
        diffScope: "uncommitted",
      },
      {
        type: "suggestedSquash",
        workingDir: "/repo",
        sourceBranch: "odt/task-1",
        targetBranch: "origin/main",
      },
      {
        type: "mergeBranch",
        workingDir: "/repo",
        request: {
          sourceBranch: "odt/task-1",
          targetBranch: "origin/main",
          sourceWorkingDirectory: "/worktrees/repo/task-1",
          method: "merge_commit",
        },
      },
      {
        type: "setDirectMerge",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          directMerge: {
            method: "merge_commit",
            sourceBranch: "odt/task-1",
            targetBranch: { remote: "origin", branch: "main" },
            mergedAt: expect.any(String),
          },
        },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "human_review" },
      },
    ]);
  });

  test("returns direct merge conflicts without recording metadata", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ status: "human_review" })];
      },
      async getTaskMetadata(input) {
        calls.push({ type: "metadata", input });
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        };
      },
      async setDirectMerge() {
        throw new Error("should not set direct merge");
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
      async setSpecDocument() {
        throw new Error("unexpected set spec");
      },
      async setPlanDocument() {
        throw new Error("unexpected set plan");
      },
      async recordQaOutcome() {
        throw new Error("unexpected qa");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({
        devServerService: createDirectMergeDevServerService(calls),
        gitPort: {
          ...createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
          }),
          async getWorktreeStatusSummaryData() {
            return {
              currentBranch: { name: "odt/task-1", detached: false },
              fileStatuses: [],
              fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
              targetAheadBehind: { ahead: 1, behind: 0 },
              upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
            };
          },
          async suggestedSquashCommitMessage() {
            return undefined;
          },
          async mergeBranch() {
            return {
              outcome: "conflicts",
              conflictedFiles: ["src/main.ts"],
              output: "conflict",
            };
          },
        },
        settingsConfig: {
          ...createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          async readConfig() {
            return { version: 2, git: { defaultMergeMethod: "merge_commit" } };
          },
        },
        systemCommands: createApprovalSystemCommands(),
        taskStore,
        taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).directMerge({
        repoPath: "/repo",
        taskId: "task-1",
        input: { mergeMethod: "rebase" },
      }),
    ).resolves.toEqual({
      outcome: "conflicts",
      conflict: {
        operation: "direct_merge_rebase",
        currentBranch: "odt/task-1",
        targetBranch: "origin/main",
        conflictedFiles: ["src/main.ts"],
        output: "conflict",
        workingDir: "/worktrees/repo/task-1",
      },
    });
  });

  test("completes a published direct merge after sync and cleans builder state", async () => {
    const calls: unknown[] = [];
    const closedTask = task({ status: "closed" });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [
          task({
            status: "human_review",
            agentSessions: [
              createAgentSessionRecord({
                externalSessionId: "session-1",
                role: "build",
                startedAt: "2026-05-10T10:00:00.000Z",
                workingDirectory: "/worktrees/repo/task-1",
              }),
            ],
          }),
        ];
      },
      async getTaskMetadata(input) {
        calls.push({ type: "metadata", input });
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          directMerge: {
            method: "merge_commit",
            sourceBranch: "odt/task-1",
            targetBranch: { remote: "origin", branch: "main" },
            mergedAt: "2026-05-10T11:00:00.000Z",
          },
          agentSessions: [],
        };
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return closedTask;
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
    const service = createTaskService({
      devServerService: createDirectMergeDevServerService(calls),
      gitPort: createDirectMergeGitPort({
        calls,
        currentBranches: {
          "/repo": { name: "main", detached: false },
          "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
        },
        branches: {
          "/repo": [
            { name: "main", isCurrent: true, isRemote: false },
            { name: "odt/task-1", isCurrent: false, isRemote: false },
          ],
        },
        aheadBehind: { "/repo|origin/main": { ahead: 0, behind: 0 } },
        ancestorResults: { "/repo|odt/task-1|main": false },
      }),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
    });

    await expect(
      service.completeDirectMerge({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toMatchObject({ id: "task-1", status: "closed" });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "currentBranch", workingDir: "/repo" },
      { type: "aheadBehind", workingDir: "/repo", targetBranch: "origin/main" },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "closed" },
      },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "list", input: { repoPath: "/repo" } },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: false,
      },
      { type: "listBranches", workingDir: "/repo" },
      { type: "isAncestor", workingDir: "/repo", ancestor: "odt/task-1", descendant: "main" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
    ]);
  });

  test("rejects direct merge completion until the publish target is synchronized", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ status: "human_review" })];
      },
      async getTaskMetadata() {
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          directMerge: {
            method: "merge_commit",
            sourceBranch: "odt/task-1",
            targetBranch: { remote: "origin", branch: "main" },
            mergedAt: "2026-05-10T11:00:00.000Z",
          },
          agentSessions: [],
        };
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
        devServerService: createDirectMergeDevServerService(calls),
        gitPort: createDirectMergeGitPort({
          calls,
          currentBranches: { "/repo": { name: "main", detached: false } },
          aheadBehind: { "/repo|origin/main": { ahead: 1, behind: 0 } },
        }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        taskStore,
        taskWorktreeService: createDirectMergeTaskWorktreeService(null),
      }).completeDirectMerge({ repoPath: "/repo", taskId: "task-1" }),
    ).rejects.toThrow(
      "Cannot finish the direct merge for task task-1 until origin/main is fully published and synchronized.",
    );
  });

  test("rejects direct merge completion without recorded direct merge metadata", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ status: "human_review" })];
      },
      async getTaskMetadata() {
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        };
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
        devServerService: createDirectMergeDevServerService([]),
        gitPort: createDirectMergeGitPort({ calls: [] }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        taskStore,
        taskWorktreeService: createDirectMergeTaskWorktreeService(null),
      }).completeDirectMerge({ repoPath: "/repo", taskId: "task-1" }),
    ).rejects.toThrow("Task task-1 does not have a locally applied direct merge to complete.");
  });
});
