import {
  createAgentSessionRecord,
  createApprovalSystemCommands,
  createBuildSettingsConfig,
  createBuildWorkspaceSettingsService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createTaskService,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

describe("createTaskService approval context", () => {
  test("loads approval context from the active builder worktree", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTask(input) {
        calls.push({ type: "get", input });
        return task({
          status: "human_review",
          targetBranch: { remote: "origin", branch: "release" },
        });
      },
      async getTaskMetadata(input) {
        calls.push({ type: "metadata", input });
        return {
          spec: { markdown: "# Spec" },
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
    const service = createTaskService({
      gitPort: {
        ...createDirectMergeGitPort({
          calls,
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
        }),
        async listRemotes(workingDir) {
          calls.push({ type: "listRemotes", workingDir });
          return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
        },
        async getWorktreeStatusSummaryData(workingDir, targetBranch, diffScope) {
          calls.push({ type: "summary", workingDir, targetBranch, diffScope });
          return {
            currentBranch: { name: "odt/task-1", detached: false },
            fileStatuses: [
              { path: "src/main.ts", status: "modified", staged: false },
              { path: "src/app.ts", status: "added", staged: true },
            ],
            fileStatusCounts: { total: 2, staged: 1, unstaged: 1 },
            targetAheadBehind: { ahead: 3, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 3 },
          };
        },
        async suggestedSquashCommitMessage(workingDir, sourceBranch, targetBranch) {
          calls.push({ type: "suggestedSquash", workingDir, sourceBranch, targetBranch });
          return "Ship task approval context";
        },
      },
      settingsConfig: {
        ...createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        async readConfig() {
          return { version: 2, git: { defaultMergeMethod: "squash" } };
        },
      },
      systemCommands: createApprovalSystemCommands(),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
        git: {
          providers: {
            github: {
              enabled: true,
              repository: { host: "github.com", owner: "openai", name: "openducktor" },
              autoDetected: false,
            },
          },
        },
      }),
    });

    await expect(
      service.getApprovalContext({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toEqual({
      outcome: "ready",
      approvalContext: {
        taskId: "task-1",
        taskStatus: "human_review",
        workingDirectory: "/worktrees/repo/task-1",
        sourceBranch: "odt/task-1",
        targetBranch: { remote: "origin", branch: "release" },
        publishTarget: { remote: "origin", branch: "release" },
        defaultMergeMethod: "squash",
        hasUncommittedChanges: true,
        uncommittedFileCount: 2,
        pullRequest: undefined,
        providers: [{ providerId: "github", enabled: true, available: true }],
        suggestedSquashCommitMessage: "Ship task approval context",
      },
    });
    expect(calls).toContainEqual({
      type: "summary",
      workingDir: "/worktrees/repo/task-1",
      targetBranch: "origin/release",
      diffScope: "uncommitted",
    });
    expect(calls).toContainEqual({
      type: "suggestedSquash",
      workingDir: "/repo",
      sourceBranch: "odt/task-1",
      targetBranch: "origin/release",
    });
  });

  test("reports a missing builder worktree for approval context", async () => {
    const taskStore: TaskStorePort = {
      async getTask() {
        return task({ status: "ai_review" });
      },
      async getTaskMetadata() {
        return {
          spec: { markdown: "# Spec" },
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
      createTaskService({
        gitPort: createDirectMergeGitPort({ calls: [] }),
        settingsConfig: {
          ...createBuildSettingsConfig(new Set(["/repo"])),
          async readConfig() {
            return null;
          },
        },
        systemCommands: createApprovalSystemCommands(),
        taskStore,
        taskWorktreeService: createDirectMergeTaskWorktreeService(null),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).getApprovalContext({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toEqual({
      outcome: "missing_builder_worktree",
      taskId: "task-1",
      taskStatus: "ai_review",
    });
  });

  test("loads approval context from recorded direct merge metadata", async () => {
    const calls: unknown[] = [];
    const directMerge = {
      method: "merge_commit" as const,
      sourceBranch: "odt/task-1",
      targetBranch: { branch: "main" },
      mergedAt: "2026-05-10T11:00:00.000Z",
    };
    const taskStore: TaskStorePort = {
      async getTask() {
        return task({
          status: "human_review",
          agentSessions: [createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" })],
        });
      },
      async getTaskMetadata() {
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          directMerge,
          agentSessions: [],
        };
      },
      async listTasks() {
        return [
          task({
            status: "human_review",
            agentSessions: [
              createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
            ],
          }),
        ];
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
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
    };

    await expect(
      createTaskService({
        gitPort: createDirectMergeGitPort({
          calls,
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
        }),
        settingsConfig: {
          ...createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          async readConfig() {
            return null;
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
      }).getApprovalContext({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toMatchObject({
      outcome: "ready",
      approvalContext: {
        sourceBranch: "odt/task-1",
        targetBranch: { branch: "main" },
        publishTarget: undefined,
        hasUncommittedChanges: false,
        uncommittedFileCount: 0,
        directMerge,
        defaultMergeMethod: "merge_commit",
      },
    });
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "suggestedSquash" }));
  });
});
