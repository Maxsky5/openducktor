import type {
  AgentSessionRecord,
  CommitsAheadBehind,
  GitBranch,
  GitCurrentBranch,
  RepoConfig,
  TaskCard,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { GitPort } from "../ports/git-port";
import type { RuntimeRegistryPort } from "../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../ports/settings-config-port";
import type { SystemCommandPort } from "../ports/system-command-port";
import type { TaskActivityGuardPort } from "../ports/task-activity-guard-port";
import type { TaskStorePort } from "../ports/task-store-port";
import type { WorktreeFilePort } from "../ports/worktree-file-port";
import type { DevServerService } from "./dev-server-service";
import { createRuntimeDefinitionsService } from "./runtime-definitions-service";
import { createTaskService } from "./task-service";
import type { TaskWorktreeService } from "./task-worktree-service";
import type { WorkspaceSettingsService } from "./workspace-settings-service";

const task = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task 1",
  description: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: true, canSkip: false, available: false, completed: false },
  },
  updatedAt: "2026-01-02T03:04:05Z",
  createdAt: "2026-01-01T03:04:05Z",
  ...overrides,
});

const createAgentSessionRecord = (
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord => ({
  externalSessionId: "session-1",
  role: "build",
  startedAt: "2026-05-10T10:00:00.000Z",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
  selectedModel: null,
  ...overrides,
});

const pullRequest = () => ({
  providerId: "github",
  number: 12,
  url: "https://github.com/acme/repo/pull/12",
  state: "merged" as const,
  createdAt: "2026-05-10T10:00:00.000Z",
  updatedAt: "2026-05-10T11:00:00.000Z",
  mergedAt: "2026-05-10T11:00:00.000Z",
});

const createAgentSessionTaskStore = (calls: unknown[]): TaskStorePort => ({
  async upsertAgentSession(input) {
    calls.push(input);
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
  async transitionTask() {
    throw new Error("unexpected transition");
  },
  async deleteTask() {
    throw new Error("unexpected delete");
  },
  async listTasks() {
    throw new Error("unexpected list");
  },
});

const createAgentSessionSettingsConfig = (existingPaths: Set<string>): SettingsConfigPort => ({
  async readConfig() {
    throw new Error("unexpected read config");
  },
  async writeConfig() {
    throw new Error("unexpected write config");
  },
  defaultWorktreeBasePath(workspaceId) {
    return `/worktrees/${workspaceId}`;
  },
  defaultRepoWorktreeBasePath() {
    return "/legacy-worktrees/repo";
  },
  resolveConfiguredPath(rawPath) {
    return rawPath;
  },
  async canonicalizePath(rawPath) {
    if (!existingPaths.has(rawPath)) {
      throw new Error(`Path does not exist: ${rawPath}`);
    }
    return rawPath;
  },
  async pathExists(path) {
    return existingPaths.has(path);
  },
  join(...paths) {
    return paths.join("/").replaceAll(/\/+/g, "/");
  },
});

const createAgentSessionWorkspaceSettingsService = (
  workspace: Pick<WorkspaceRecord, "repoPath" | "effectiveWorktreeBasePath">,
): WorkspaceSettingsService =>
  ({
    async listWorkspaces() {
      return [
        {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: workspace.repoPath,
          iconDataUrl: null,
          isActive: true,
          hasConfig: true,
          configuredWorktreeBasePath: null,
          defaultWorktreeBasePath: "/worktrees/repo",
          effectiveWorktreeBasePath: workspace.effectiveWorktreeBasePath,
        },
      ];
    },
  }) as WorkspaceSettingsService;

const createBuildSettingsConfig = (existingPaths: Set<string>): SettingsConfigPort => ({
  async readConfig() {
    throw new Error("unexpected read config");
  },
  async writeConfig() {
    throw new Error("unexpected write config");
  },
  defaultWorktreeBasePath(workspaceId) {
    return `/worktrees/${workspaceId}`;
  },
  defaultRepoWorktreeBasePath() {
    return "/legacy-worktrees/repo";
  },
  resolveConfiguredPath(rawPath) {
    return rawPath;
  },
  async canonicalizePath(rawPath) {
    if (!existingPaths.has(rawPath)) {
      throw new Error(`Path does not exist: ${rawPath}`);
    }
    return rawPath;
  },
  async pathExists(path) {
    return existingPaths.has(path);
  },
  join(...paths) {
    return paths.join("/").replaceAll(/\/+/g, "/");
  },
});

const createBuildWorkspaceSettingsService = (
  repoConfig: Partial<RepoConfig> & Pick<RepoConfig, "workspaceId" | "repoPath" | "hooks">,
): WorkspaceSettingsService =>
  ({
    async getRepoConfigByRepoPath() {
      return {
        workspaceName: "Repo",
        defaultRuntimeKind: "opencode",
        branchPrefix: "odt",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: { providers: {} },
        devServers: [],
        worktreeCopyPaths: [],
        promptOverrides: {},
        agentDefaults: {},
        ...repoConfig,
      } satisfies RepoConfig;
    },
  }) as WorkspaceSettingsService;

const createBuildSystemCommands = (calls: unknown[], ok = true): SystemCommandPort => ({
  async requiredCommandError() {
    throw new Error("unexpected required command check");
  },
  async versionCommand() {
    throw new Error("unexpected version command");
  },
  async runCommandAllowFailure(command, args, options) {
    calls.push({ command, args, options });
    return {
      ok,
      stdout: "",
      stderr: ok ? "" : "cleanup failed",
    };
  },
});

const createBuildStartWorktreeFiles = (calls: unknown[]): WorktreeFilePort => ({
  async ensureDirectory(path) {
    calls.push({ type: "ensureDirectory", path });
  },
  async copyConfiguredPaths(repoPath, worktreePath, relativePaths) {
    calls.push({ type: "copyConfiguredPaths", repoPath, worktreePath, relativePaths });
  },
  async removePathIfPresent() {
    throw new Error("unexpected remove path");
  },
  resolveWorktreePath(repoPath, worktreePath) {
    return worktreePath.startsWith("/") ? worktreePath : `${repoPath}/${worktreePath}`;
  },
  async pathIsWithinRoot() {
    return true;
  },
});

const createBuildStartRuntimeRegistry = (calls: unknown[]): RuntimeRegistryPort => ({
  async ensureWorkspaceRuntime(input) {
    calls.push({ type: "ensureRuntime", input });
    return {
      kind: input.runtimeKind,
      runtimeId: "runtime-1",
      repoPath: input.repoPath,
      taskId: null,
      role: "workspace",
      workingDirectory: input.workingDirectory,
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
      startedAt: "2026-05-10T10:00:00.000Z",
      descriptor: input.descriptor,
    };
  },
  async listRuntimes() {
    return [];
  },
  async stopRuntime() {
    return false;
  },
  async stopSession() {
    throw new Error("unexpected stop session");
  },
});

const createBuildStartGitPort = ({
  calls,
  references = new Set(["origin/main"]),
}: {
  calls: unknown[];
  references?: Set<string>;
}): GitPort => ({
  async canonicalizePath(path) {
    calls.push({ type: "canonicalizePath", path });
    return path;
  },
  async isGitRepository(path) {
    calls.push({ type: "isGitRepository", path });
    return true;
  },
  async shareGitCommonDirectory() {
    return true;
  },
  async referenceExists(workingDir, reference) {
    calls.push({ type: "referenceExists", workingDir, reference });
    return references.has(reference);
  },
  async listRemotes() {
    return [];
  },
  async listBranches() {
    return [];
  },
  async getCurrentBranch() {
    throw new Error("unexpected current branch");
  },
  async getStatus() {
    return [];
  },
  async getDiff() {
    return [];
  },
  async getWorktreeStatusData() {
    throw new Error("unexpected worktree status");
  },
  async getWorktreeStatusSummaryData() {
    throw new Error("unexpected worktree status summary");
  },
  async createWorktree(repoPath, worktreePath, branch, createBranch, startPoint) {
    calls.push({
      type: "createWorktree",
      repoPath,
      worktreePath,
      branch,
      createBranch,
      startPoint,
    });
  },
  async configureBranchUpstream(repoPath, worktreePath, branch, upstreamRemote) {
    calls.push({ type: "configureBranchUpstream", repoPath, worktreePath, branch, upstreamRemote });
    return { createdTrackingRef: "refs/remotes/origin/odt/task-1-task-1" };
  },
  async deleteReference(repoPath, reference) {
    calls.push({ type: "deleteReference", repoPath, reference });
  },
  async removeWorktree(repoPath, worktreePath, force) {
    calls.push({ type: "removeWorktree", repoPath, worktreePath, force });
  },
  async deleteLocalBranch(repoPath, branch, force) {
    calls.push({ type: "deleteLocalBranch", repoPath, branch, force });
  },
  async isAncestor() {
    return true;
  },
  async suggestedSquashCommitMessage() {
    throw new Error("unexpected suggested squash commit message");
  },
  async mergeBranch() {
    throw new Error("unexpected merge branch");
  },
  async switchBranch() {
    throw new Error("unexpected switch branch");
  },
  async resetWorktreeSelection() {
    throw new Error("unexpected reset");
  },
  async commitsAheadBehind() {
    return { ahead: 0, behind: 0 };
  },
  async fetchRemote() {
    throw new Error("unexpected fetch");
  },
  async pullBranch() {
    throw new Error("unexpected pull");
  },
  async commitAll() {
    throw new Error("unexpected commit");
  },
  async pushBranch() {
    throw new Error("unexpected push");
  },
  async rebaseBranch() {
    throw new Error("unexpected rebase");
  },
  async rebaseAbort() {
    throw new Error("unexpected rebase abort");
  },
  async abortConflict() {
    throw new Error("unexpected conflict abort");
  },
});

const createDirectMergeGitPort = ({
  calls,
  currentBranches = {},
  branches = {},
  aheadBehind = {},
  ancestorResults = {},
}: {
  calls: unknown[];
  currentBranches?: Record<string, GitCurrentBranch>;
  branches?: Record<string, GitBranch[]>;
  aheadBehind?: Record<string, CommitsAheadBehind>;
  ancestorResults?: Record<string, boolean>;
}): GitPort => ({
  async canonicalizePath(path) {
    return path;
  },
  async isGitRepository() {
    return true;
  },
  async shareGitCommonDirectory() {
    return true;
  },
  async listRemotes() {
    return [];
  },
  async listBranches(workingDir) {
    calls.push({ type: "listBranches", workingDir });
    return branches[workingDir] ?? [];
  },
  async getCurrentBranch(workingDir) {
    calls.push({ type: "currentBranch", workingDir });
    return currentBranches[workingDir] ?? { detached: true };
  },
  async getStatus() {
    return [];
  },
  async getDiff() {
    return [];
  },
  async getWorktreeStatusData() {
    throw new Error("unexpected worktree status");
  },
  async getWorktreeStatusSummaryData() {
    throw new Error("unexpected worktree status summary");
  },
  async createWorktree() {
    throw new Error("unexpected create worktree");
  },
  async removeWorktree(repoPath, worktreePath, force) {
    calls.push({ type: "removeWorktree", repoPath, worktreePath, force });
  },
  async deleteLocalBranch(repoPath, branch, force) {
    calls.push({ type: "deleteLocalBranch", repoPath, branch, force });
  },
  async isAncestor(workingDir, ancestor, descendant) {
    calls.push({ type: "isAncestor", workingDir, ancestor, descendant });
    return ancestorResults[`${workingDir}|${ancestor}|${descendant}`] ?? true;
  },
  async suggestedSquashCommitMessage() {
    throw new Error("unexpected suggested squash commit message");
  },
  async mergeBranch() {
    throw new Error("unexpected merge branch");
  },
  async switchBranch() {
    throw new Error("unexpected switch branch");
  },
  async resetWorktreeSelection() {
    throw new Error("unexpected reset");
  },
  async commitsAheadBehind(workingDir, targetBranch) {
    calls.push({ type: "aheadBehind", workingDir, targetBranch });
    return aheadBehind[`${workingDir}|${targetBranch}`] ?? { ahead: 0, behind: 0 };
  },
  async fetchRemote() {
    throw new Error("unexpected fetch");
  },
  async pullBranch() {
    throw new Error("unexpected pull");
  },
  async commitAll() {
    throw new Error("unexpected commit");
  },
  async pushBranch() {
    throw new Error("unexpected push");
  },
  async rebaseBranch() {
    throw new Error("unexpected rebase");
  },
  async rebaseAbort() {
    throw new Error("unexpected rebase abort");
  },
  async abortConflict() {
    throw new Error("unexpected conflict abort");
  },
});

const createDirectMergeDevServerService = (calls: unknown[]): DevServerService => ({
  async getState() {
    throw new Error("unexpected dev server get state");
  },
  async restart() {
    throw new Error("unexpected dev server restart");
  },
  async start() {
    throw new Error("unexpected dev server start");
  },
  async stop(input: unknown) {
    calls.push({ type: "stopDevServers", input });
    return {
      repoPath: "/repo",
      taskId: "task-1",
      worktreePath: null,
      scripts: [],
      updatedAt: "2026-05-10T11:30:00.000Z",
    };
  },
});

const createDirectMergeTaskWorktreeService = (
  workingDirectory: string | null,
): TaskWorktreeService => ({
  async getTaskWorktree() {
    return workingDirectory === null ? null : { workingDirectory };
  },
});

const createApprovalSystemCommands = (available = true): SystemCommandPort => ({
  async requiredCommandError(command) {
    return command === "gh" && !available ? "Required command `gh` not found." : null;
  },
  async versionCommand() {
    throw new Error("unexpected version command");
  },
  async runCommandAllowFailure(command, args, options) {
    return {
      ok: true,
      stdout: `Logged in to ${options?.env?.GH_PROMPT_DISABLED ? "github.com" : command} account octocat\n`,
      stderr: args.join(" "),
    };
  },
});

const githubPullListPayload = (
  entries: Array<{
    number: number;
    state?: string;
    draft?: boolean;
    mergedAt?: string | null;
    updatedAt?: string;
    head?: string;
    base?: string;
  }>,
): string =>
  JSON.stringify(
    entries.map((entry) => ({
      number: entry.number,
      html_url: `https://github.com/openai/openducktor/pull/${entry.number}`,
      draft: entry.draft ?? false,
      state: entry.state ?? "open",
      created_at: "2026-05-10T09:00:00.000Z",
      updated_at: entry.updatedAt ?? "2026-05-10T10:00:00.000Z",
      merged_at: entry.mergedAt ?? null,
      closed_at: null,
      head: { ref: entry.head ?? "odt/task-1" },
      base: { ref: entry.base ?? "main" },
    })),
  );

const githubPullResponsePayload = (entry: {
  number: number;
  state?: string;
  draft?: boolean;
  mergedAt?: string | null;
  updatedAt?: string;
  head?: string;
  base?: string;
}): string =>
  JSON.stringify({
    number: entry.number,
    html_url: `https://github.com/openai/openducktor/pull/${entry.number}`,
    draft: entry.draft ?? false,
    state: entry.state ?? "open",
    created_at: "2026-05-10T09:00:00.000Z",
    updated_at: entry.updatedAt ?? "2026-05-10T10:00:00.000Z",
    merged_at: entry.mergedAt ?? null,
    closed_at: null,
    head: { ref: entry.head ?? "odt/task-1" },
    base: { ref: entry.base ?? "main" },
  });

const createPullRequestDetectSystemCommands = ({
  calls,
  openPayload = "[]",
  allPayload = "[]",
}: {
  calls: unknown[];
  openPayload?: string;
  allPayload?: string;
}): SystemCommandPort => ({
  async requiredCommandError(command) {
    calls.push({ type: "requiredCommand", command });
    return null;
  },
  async versionCommand() {
    throw new Error("unexpected version command");
  },
  async runCommandAllowFailure(command, args, options) {
    calls.push({ type: "command", command, args, options });
    if (args.includes("auth")) {
      return { ok: true, stdout: "Logged in to github.com account octocat\n", stderr: "" };
    }
    if (args.includes("state=open")) {
      return { ok: true, stdout: openPayload, stderr: "" };
    }
    if (args.includes("state=all")) {
      return { ok: true, stdout: allPayload, stderr: "" };
    }
    throw new Error(`unexpected command args: ${args.join(" ")}`);
  },
});

const createPullRequestUpsertSystemCommands = ({
  calls,
  payload,
}: {
  calls: unknown[];
  payload: string;
}): SystemCommandPort => ({
  async requiredCommandError(command) {
    calls.push({ type: "requiredCommand", command });
    return null;
  },
  async versionCommand() {
    throw new Error("unexpected version command");
  },
  async runCommandAllowFailure(command, args, options) {
    calls.push({ type: "command", command, args, options });
    if (args.includes("auth")) {
      return { ok: true, stdout: "Logged in to github.com account octocat\n", stderr: "" };
    }
    if (args.includes("--method") && (args.includes("POST") || args.includes("PATCH"))) {
      return { ok: true, stdout: payload, stderr: "" };
    }
    throw new Error(`unexpected command args: ${args.join(" ")}`);
  },
});

const createPullRequestSyncSystemCommands = ({
  calls,
  available = true,
  payload,
}: {
  calls: unknown[];
  available?: boolean;
  payload: string;
}): SystemCommandPort => ({
  async requiredCommandError(command) {
    calls.push({ type: "requiredCommand", command });
    return available ? null : "Required command `gh` not found.";
  },
  async versionCommand() {
    throw new Error("unexpected version command");
  },
  async runCommandAllowFailure(command, args, options) {
    calls.push({ type: "command", command, args, options });
    if (args.some((arg) => arg.includes("pulls/42"))) {
      return { ok: true, stdout: payload, stderr: "" };
    }
    throw new Error(`unexpected command args: ${args.join(" ")}`);
  },
});

describe("createTaskService", () => {
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
    const tasks = await service.listTasks({ repoPath: " /repo ", doneVisibleDays: 3 });

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

  test("rejects invalid list input before calling the store", async () => {
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

    const service = createTaskService({ taskStore });

    await expect(service.listTasks({ repoPath: "/repo", doneVisibleDays: -1 })).rejects.toThrow(
      "doneVisibleDays must be greater than or equal to 0.",
    );
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
        repoPath: " /repo ",
        taskId: " task-1 ",
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

    await expect(service.specGet({ repoPath: " /repo ", taskId: " task-1 " })).resolves.toEqual({
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
        repoPath: " /repo ",
        taskIds: [" task-1 ", "task-2"],
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
        repoPath: " /repo ",
        taskId: " task-1 ",
        session: createAgentSessionRecord({
          externalSessionId: " session-1 ",
          workingDirectory: " /repo/task-1 ",
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

  test("upserts an agent session from the legacy repo-scoped worktree base", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskStore: createAgentSessionTaskStore(calls),
      settingsConfig: createAgentSessionSettingsConfig(
        new Set(["/repo", "/legacy-worktrees/repo", "/legacy-worktrees/repo/task-1"]),
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
        session: createAgentSessionRecord({ workingDirectory: "/legacy-worktrees/repo/task-1" }),
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

  test("detects and links an existing open pull request for the builder branch", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTask(input) {
        calls.push({ type: "get", input });
        return task({ status: "human_review" });
      },
      async getTaskMetadata(input) {
        calls.push({ type: "metadata", input });
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        };
      },
      async setPullRequest(input) {
        calls.push({ type: "setPullRequest", input });
        return true;
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
      },
      systemCommands: createPullRequestDetectSystemCommands({
        calls,
        openPayload: githubPullListPayload([{ number: 42 }]),
      }),
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
      service.detectPullRequest({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toMatchObject({
      outcome: "linked",
      pullRequest: {
        providerId: "github",
        number: 42,
        state: "open",
        url: "https://github.com/openai/openducktor/pull/42",
      },
    });
    expect(calls).toContainEqual({
      type: "setPullRequest",
      input: {
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: expect.objectContaining({ number: 42, state: "open" }),
      },
    });
  });

  test("links a pull request by number after fetching provider metadata", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTask(input) {
        calls.push({ type: "get", input });
        return task({ status: "human_review" });
      },
      async getTaskMetadata(input) {
        calls.push({ type: "metadata", input });
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        };
      },
      async setPullRequest(input) {
        calls.push({ type: "setPullRequest", input });
        return true;
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
        ...createDirectMergeGitPort({ calls }),
        async listRemotes(workingDir) {
          calls.push({ type: "listRemotes", workingDir });
          return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
        },
      },
      systemCommands: {
        async requiredCommandError(command) {
          calls.push({ type: "requiredCommand", command });
          return null;
        },
        async versionCommand() {
          throw new Error("unexpected version command");
        },
        async runCommandAllowFailure(command, args, options) {
          calls.push({ type: "command", command, args, options });
          if (args.includes("auth")) {
            return { ok: true, stdout: "Logged in to github.com account octocat\n", stderr: "" };
          }
          if (args.some((arg) => arg.includes("pulls/77"))) {
            return { ok: true, stdout: githubPullResponsePayload({ number: 77 }), stderr: "" };
          }
          throw new Error(`unexpected command args: ${args.join(" ")}`);
        },
      },
      taskStore,
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
      service.linkPullRequest({
        repoPath: "/repo",
        taskId: "task-1",
        providerId: "github",
        number: 77,
      }),
    ).resolves.toMatchObject({
      providerId: "github",
      number: 77,
      url: "https://github.com/openai/openducktor/pull/77",
      state: "open",
    });
    expect(calls).toContainEqual({
      type: "setPullRequest",
      input: {
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: expect.objectContaining({ number: 77, state: "open" }),
      },
    });
  });

  test("detects a merged pull request without linking metadata", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTask() {
        return task({ status: "human_review" });
      },
      async getTaskMetadata() {
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        };
      },
      async setPullRequest(input) {
        calls.push({ type: "setPullRequest", input });
        return true;
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
        gitPort: {
          ...createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
          }),
          async listRemotes() {
            return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
          },
        },
        systemCommands: createPullRequestDetectSystemCommands({
          calls,
          allPayload: githubPullListPayload([
            {
              number: 12,
              state: "closed",
              mergedAt: "2026-05-10T11:00:00.000Z",
              updatedAt: "2026-05-10T11:00:00.000Z",
            },
          ]),
        }),
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
      }).detectPullRequest({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toMatchObject({
      outcome: "merged",
      pullRequest: {
        providerId: "github",
        number: 12,
        state: "merged",
      },
    });
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "setPullRequest" }));
  });

  test("reports not_found when no pull request matches the builder branch", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTask() {
        return task({ status: "human_review" });
      },
      async getTaskMetadata() {
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        };
      },
      async setPullRequest() {
        throw new Error("unexpected set pull request");
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
        gitPort: {
          ...createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
          }),
          async listRemotes() {
            return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
          },
        },
        systemCommands: createPullRequestDetectSystemCommands({ calls }),
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
      }).detectPullRequest({ repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toEqual({
      outcome: "not_found",
      sourceBranch: "odt/task-1",
      targetBranch: "main",
    });
  });

  test("creates a pull request from a clean builder worktree", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTask() {
        return task({ status: "human_review" });
      },
      async getTaskMetadata() {
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        };
      },
      async setPullRequest(input) {
        calls.push({ type: "setPullRequest", input });
        return true;
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
            fileStatuses: [],
            fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
          };
        },
        async suggestedSquashCommitMessage() {
          return undefined;
        },
        async pushBranch(workingDir, branch, options) {
          calls.push({ type: "push", workingDir, branch, options });
          return { outcome: "pushed", remote: options?.remote ?? "origin", branch, output: "" };
        },
      },
      settingsConfig: {
        ...createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        async readConfig() {
          return null;
        },
      },
      systemCommands: createPullRequestUpsertSystemCommands({
        calls,
        payload: githubPullResponsePayload({ number: 77 }),
      }),
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
      service.upsertPullRequest({
        repoPath: "/repo",
        taskId: "task-1",
        input: { title: " Create PR ", body: "Body" },
      }),
    ).resolves.toMatchObject({
      providerId: "github",
      number: 77,
      state: "open",
    });

    expect(calls).toContainEqual({
      type: "push",
      workingDir: "/worktrees/repo/task-1",
      branch: "odt/task-1",
      options: { remote: "origin", setUpstream: true, forceWithLease: false },
    });
    expect(calls).toContainEqual(
      expect.objectContaining({
        type: "command",
        args: expect.arrayContaining([
          "POST",
          "repos/openai/openducktor/pulls",
          "title=Create PR",
          "head=odt/task-1",
          "base=main",
          "body=Body",
        ]),
      }),
    );
    expect(calls).toContainEqual({
      type: "setPullRequest",
      input: {
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: expect.objectContaining({ number: 77, state: "open" }),
      },
    });
  });

  test("updates an existing editable pull request", async () => {
    const calls: unknown[] = [];
    const existingPullRequest = {
      providerId: "github" as const,
      number: 42,
      url: "https://github.com/openai/openducktor/pull/42",
      state: "draft" as const,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    const taskStore: TaskStorePort = {
      async getTask() {
        return task({ status: "human_review" });
      },
      async getTaskMetadata() {
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          pullRequest: existingPullRequest,
          agentSessions: [],
        };
      },
      async setPullRequest(input) {
        calls.push({ type: "setPullRequest", input });
        return true;
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
        gitPort: {
          ...createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
          }),
          async listRemotes() {
            return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
          },
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
          async pushBranch(workingDir, branch, options) {
            calls.push({ type: "push", workingDir, branch, options });
            return { outcome: "pushed", remote: options?.remote ?? "origin", branch, output: "" };
          },
        },
        settingsConfig: {
          ...createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          async readConfig() {
            return null;
          },
        },
        systemCommands: createPullRequestUpsertSystemCommands({
          calls,
          payload: githubPullResponsePayload({ number: 42, draft: true }),
        }),
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
      }).upsertPullRequest({
        repoPath: "/repo",
        taskId: "task-1",
        input: { title: "Updated PR", body: "Body" },
      }),
    ).resolves.toMatchObject({
      providerId: "github",
      number: 42,
      state: "draft",
    });

    expect(calls).toContainEqual(
      expect.objectContaining({
        type: "command",
        args: expect.arrayContaining([
          "PATCH",
          "repos/openai/openducktor/pulls/42",
          "title=Updated PR",
          "body=Body",
        ]),
      }),
    );
  });

  test("rejects pull request upsert from a dirty builder worktree", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTask() {
        return task({ status: "human_review" });
      },
      async getTaskMetadata() {
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        };
      },
      async setPullRequest() {
        throw new Error("unexpected set pull request");
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
        gitPort: {
          ...createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
          }),
          async listRemotes() {
            return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
          },
          async getWorktreeStatusSummaryData() {
            return {
              currentBranch: { name: "odt/task-1", detached: false },
              fileStatuses: [{ path: "src/main.ts", status: "modified", staged: false }],
              fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
              targetAheadBehind: { ahead: 1, behind: 0 },
              upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
            };
          },
          async suggestedSquashCommitMessage() {
            return undefined;
          },
        },
        settingsConfig: {
          ...createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          async readConfig() {
            return null;
          },
        },
        systemCommands: createPullRequestUpsertSystemCommands({
          calls,
          payload: githubPullResponsePayload({ number: 77 }),
        }),
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
      }).upsertPullRequest({
        repoPath: "/repo",
        taskId: "task-1",
        input: { title: "Create PR", body: "Body" },
      }),
    ).rejects.toThrow(
      "Human approval is blocked because the builder worktree has 1 uncommitted file. Commit or discard it before merging or opening a pull request.",
    );
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "push" }));
  });

  test("rejects pull request upsert when direct merge metadata exists", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTask() {
        return task({ status: "human_review" });
      },
      async getTaskMetadata() {
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          directMerge: {
            method: "squash",
            sourceBranch: "odt/task-1",
            targetBranch: { branch: "main" },
            mergedAt: "2026-05-10T11:00:00.000Z",
          },
          agentSessions: [],
        };
      },
      async setPullRequest() {
        throw new Error("unexpected set pull request");
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
        gitPort: createDirectMergeGitPort({ calls }),
        settingsConfig: {
          ...createBuildSettingsConfig(new Set(["/repo"])),
          async readConfig() {
            return null;
          },
        },
        systemCommands: createPullRequestUpsertSystemCommands({
          calls,
          payload: githubPullResponsePayload({ number: 77 }),
        }),
        taskStore,
        taskWorktreeService: createDirectMergeTaskWorktreeService(null),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).upsertPullRequest({
        repoPath: "/repo",
        taskId: "task-1",
        input: { title: "Create PR", body: "Body" },
      }),
    ).rejects.toThrow(
      "A local direct merge is already recorded for task task-1. Finish or discard that direct merge workflow before opening a pull request.",
    );
  });

  test("syncs a merged linked pull request and closes the task", async () => {
    const calls: unknown[] = [];
    const linkedPullRequest = {
      providerId: "github" as const,
      number: 42,
      url: "https://github.com/openai/openducktor/pull/42",
      state: "open" as const,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    const taskStore: TaskStorePort = {
      async listPullRequestSyncCandidates(input) {
        calls.push({ type: "syncCandidates", input });
        return [
          task({
            status: "human_review",
            pullRequest: linkedPullRequest,
            agentSessions: [
              createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
            ],
          }),
        ];
      },
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [
          task({
            status: "human_review",
            pullRequest: linkedPullRequest,
            agentSessions: [
              createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
            ],
          }),
        ];
      },
      async setPullRequest(input) {
        calls.push({ type: "setPullRequest", input });
        return true;
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return task({ status: input.status });
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
        throw new Error("unexpected QA");
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
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
          branches: {
            "/repo": [
              { name: "main", isCurrent: true, isRemote: false },
              { name: "odt/task-1", isCurrent: false, isRemote: false },
            ],
          },
          ancestorResults: { "/repo|odt/task-1|main": true },
        }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        systemCommands: createPullRequestSyncSystemCommands({
          calls,
          payload: githubPullResponsePayload({
            number: 42,
            state: "closed",
            mergedAt: "2026-05-10T11:00:00.000Z",
            updatedAt: "2026-05-10T11:00:00.000Z",
          }),
        }),
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
      }).repoPullRequestSync({ repoPath: "/repo" }),
    ).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({
      type: "setPullRequest",
      input: {
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: expect.objectContaining({ number: 42, state: "merged" }),
      },
    });
    expect(calls).toContainEqual({
      type: "transition",
      input: { repoPath: "/repo", taskId: "task-1", status: "closed" },
    });
    expect(calls).toContainEqual({
      type: "deleteLocalBranch",
      repoPath: "/repo",
      branch: "odt/task-1",
      force: false,
    });
  });

  test("syncs linked pull request metadata without closing open pull requests", async () => {
    const calls: unknown[] = [];
    const linkedPullRequest = {
      providerId: "github" as const,
      number: 42,
      url: "https://github.com/openai/openducktor/pull/42",
      state: "open" as const,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    const taskStore: TaskStorePort = {
      async listPullRequestSyncCandidates() {
        return [task({ status: "human_review", pullRequest: linkedPullRequest })];
      },
      async setPullRequest(input) {
        calls.push({ type: "setPullRequest", input });
        return true;
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async listTasks() {
        throw new Error("unexpected list");
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
        throw new Error("unexpected QA");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({
        systemCommands: createPullRequestSyncSystemCommands({
          calls,
          payload: githubPullResponsePayload({
            number: 42,
            state: "open",
            updatedAt: "2026-05-10T10:00:00.000Z",
          }),
        }),
        taskStore,
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
      }).repoPullRequestSync({ repoPath: "/repo" }),
    ).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({
      type: "setPullRequest",
      input: {
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: expect.objectContaining({
          number: 42,
          state: "open",
          updatedAt: "2026-05-10T10:00:00.000Z",
        }),
      },
    });
  });

  test("skips pull request sync before reading candidates when provider is unavailable", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listPullRequestSyncCandidates() {
        throw new Error("should not list candidates");
      },
      async setPullRequest() {
        throw new Error("should not set pull request");
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
        systemCommands: createPullRequestSyncSystemCommands({
          calls,
          available: false,
          payload: githubPullResponsePayload({ number: 42 }),
        }),
        taskStore,
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
      }).repoPullRequestSync({ repoPath: "/repo" }),
    ).resolves.toEqual({ ok: false });

    expect(calls).toEqual([{ type: "requiredCommand", command: "gh" }]);
  });

  test("unlinks a pull request after validating task state and metadata", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTask(input) {
        calls.push({ type: "get", input });
        return task({ status: "human_review" });
      },
      async getTaskMetadata(input) {
        calls.push({ type: "metadata", input });
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          pullRequest: {
            providerId: "github",
            number: 42,
            url: "https://github.com/openai/openducktor/pull/42",
            state: "open",
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-02T00:00:00.000Z",
          },
          agentSessions: [],
        };
      },
      async setPullRequest(input) {
        calls.push({ type: "setPullRequest", input });
        return true;
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
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
      createTaskService({ taskStore }).unlinkPullRequest({
        repoPath: " /repo ",
        taskId: " task-1 ",
      }),
    ).resolves.toBe(true);

    expect(calls).toEqual([
      { type: "get", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "setPullRequest",
        input: { repoPath: "/repo", taskId: "task-1", pullRequest: null },
      },
    ]);
  });

  test("rejects pull request unlink outside PR management statuses", async () => {
    const taskStore: TaskStorePort = {
      async getTask() {
        return task({ status: "ready_for_dev" });
      },
      async setPullRequest() {
        throw new Error("unexpected set pull request");
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
      createTaskService({ taskStore }).unlinkPullRequest({ repoPath: "/repo", taskId: "task-1" }),
    ).rejects.toThrow(
      "Pull request management is only available from in_progress, ai_review, or human_review.",
    );
  });

  test("rejects pull request unlink when no linked pull request exists", async () => {
    const taskStore: TaskStorePort = {
      async getTask() {
        return task({ status: "in_progress" });
      },
      async getTaskMetadata() {
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        };
      },
      async setPullRequest() {
        throw new Error("unexpected set pull request");
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
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
      createTaskService({ taskStore }).unlinkPullRequest({ repoPath: "/repo", taskId: "task-1" }),
    ).rejects.toThrow("Task task-1 does not have a linked pull request.");
  });

  test("links a merged pull request, closes the task, and cleans builder state", async () => {
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
          agentSessions: [],
        };
      },
      async setPullRequest(input) {
        calls.push({ type: "setPullRequest", input });
        return true;
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
          "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
        },
        branches: {
          "/repo": [
            { name: "main", isCurrent: true, isRemote: false },
            { name: "odt/task-1", isCurrent: false, isRemote: false },
          ],
        },
        ancestorResults: { "/repo|odt/task-1|main": true },
      }),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
      }),
    });

    await expect(
      service.linkMergedPullRequest({
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: pullRequest(),
      }),
    ).resolves.toMatchObject({ id: "task-1", status: "closed" });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      {
        type: "setPullRequest",
        input: { repoPath: "/repo", taskId: "task-1", pullRequest: pullRequest() },
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
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: false },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "closed" },
      },
    ]);
  });

  test("returns a closed task unchanged when the same merged pull request is already linked", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ status: "closed" })];
      },
      async getTaskMetadata(input) {
        calls.push({ type: "metadata", input });
        return {
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          pullRequest: pullRequest(),
          agentSessions: [],
        };
      },
      async setPullRequest() {
        throw new Error("should not set pull request");
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
        gitPort: createDirectMergeGitPort({ calls }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        taskStore,
        taskWorktreeService: createDirectMergeTaskWorktreeService(null),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).linkMergedPullRequest({
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: pullRequest(),
      }),
    ).resolves.toMatchObject({ id: "task-1", status: "closed" });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
    ]);
  });

  test("rejects pull request link completion for unmerged pull requests", async () => {
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
      async setPullRequest() {
        throw new Error("should not set pull request");
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
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: [] },
        }),
      }).linkMergedPullRequest({
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: { ...pullRequest(), state: "open" },
      }),
    ).rejects.toThrow("Task task-1 can only link a merged pull request from detection results.");
  });

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
      input: {
        title: "Child",
        issueType: "task",
        priority: 2,
        parentId: " epic-1 ",
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
        input: { title: "Child", issueType: "task", priority: 2, parentId: "task-1" },
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
      }).deleteTask({ repoPath: "/repo", taskId: "task-1" }),
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
      }).deleteTask({ repoPath: "/repo", taskId: "epic-1" }),
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
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      {
        type: "delete",
        input: { repoPath: "/repo", taskId: "epic-1", deleteSubtasks: true },
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
      }).deleteTask({ repoPath: "/repo", taskId: "task-1" }),
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
      reason: "Starting work",
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
      input: { summary: "Done" },
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
      reportMarkdown: " Looks good ",
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
      reportMarkdown: "Needs work",
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
        reportMarkdown: "Looks good",
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

  test("defers parent tasks from open states", async () => {
    const calls: unknown[] = [];
    const deferredTask = task({ id: "task-1", status: "deferred" });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", status: "human_review" })];
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
        return deferredTask;
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    const deferred = await createTaskService({ taskStore }).deferTask({
      repoPath: "/repo",
      taskId: "task-1",
      reason: "Later",
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "transition", input: { repoPath: "/repo", taskId: "task-1", status: "deferred" } },
    ]);
    expect(deferred).toMatchObject({
      id: "task-1",
      status: "deferred",
      availableActions: expect.arrayContaining(["resume_deferred"]),
    });
  });

  test("rejects deferring subtasks before calling the store", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1", parentId: "epic-1" })];
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
      createTaskService({ taskStore }).deferTask({ repoPath: "/repo", taskId: "task-1" }),
    ).rejects.toThrow("Subtasks cannot be deferred.");
  });

  test("rejects deferring closed or already deferred tasks before calling the store", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1", status: "closed" })];
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
      createTaskService({ taskStore }).deferTask({ repoPath: "/repo", taskId: "task-1" }),
    ).rejects.toThrow("Only non-closed open-state tasks can be deferred.");
  });

  test("resumes deferred tasks", async () => {
    const calls: unknown[] = [];
    const resumedTask = task({ id: "task-1", status: "open" });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", status: "deferred" })];
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
        return resumedTask;
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    const resumed = await createTaskService({ taskStore }).resumeDeferredTask({
      repoPath: "/repo",
      taskId: "task-1",
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "transition", input: { repoPath: "/repo", taskId: "task-1", status: "open" } },
    ]);
    expect(resumed).toMatchObject({
      id: "task-1",
      status: "open",
      availableActions: expect.arrayContaining(["defer_issue"]),
    });
  });

  test("rejects resuming non-deferred tasks before calling the store", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1", status: "open" })];
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
      createTaskService({ taskStore }).resumeDeferredTask({
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).rejects.toThrow("Task is not deferred: task-1");
  });

  test("sets spec markdown and promotes open tasks to spec_ready", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", status: "open", issueType: "feature" })];
      },
      async setSpecDocument(input) {
        calls.push({ type: "setSpec", input });
        return { markdown: input.markdown, updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 };
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return task({ id: "task-1", status: "spec_ready", issueType: "feature" });
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
      async setPlanDocument() {
        throw new Error("unexpected set plan");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).setSpec({
        repoPath: " /repo ",
        taskId: "task-1",
        markdown: " # Spec ",
      }),
    ).resolves.toEqual({
      markdown: "# Spec",
      updatedAt: "2026-05-10T10:00:00.000Z",
      revision: 1,
    });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "setSpec", input: { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "spec_ready" },
      },
    ]);
  });

  test("rejects set_spec for deferred tasks before persisting", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1", status: "deferred" })];
      },
      async setSpecDocument() {
        throw new Error("should not persist");
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
      async setPlanDocument() {
        throw new Error("unexpected set plan");
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).setSpec({
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "# Spec",
      }),
    ).rejects.toThrow(
      "set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: deferred)",
    );
  });

  test("sets an epic plan, replaces direct subtasks, and promotes to ready_for_dev", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [
          task({ id: "epic-1", status: "spec_ready", issueType: "epic" }),
          task({ id: "old-child", status: "ready_for_dev", parentId: "epic-1" }),
        ];
      },
      async setPlanDocument(input) {
        calls.push({ type: "setPlan", input });
        return { markdown: input.markdown, updatedAt: "2026-05-10T10:00:00.000Z", revision: 2 };
      },
      async deleteTask(input) {
        calls.push({ type: "delete", input });
        return true;
      },
      async createTask(input) {
        calls.push({ type: "create", input });
        return task({ id: `created-${input.task.title}`, parentId: "epic-1" });
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return task({ id: "epic-1", status: "ready_for_dev", issueType: "epic" });
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
    };

    await expect(
      createTaskService({ taskStore }).setPlan({
        repoPath: "/repo",
        taskId: "epic-1",
        input: {
          markdown: " # Plan ",
          subtasks: [
            { title: " Build UI ", issueType: "task", priority: 1, description: " Ship it " },
            { title: "build ui", issueType: "task", priority: 1 },
            { title: "Wire API", issueType: "feature" },
          ],
        },
      }),
    ).resolves.toEqual({
      markdown: "# Plan",
      updatedAt: "2026-05-10T10:00:00.000Z",
      revision: 2,
    });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "setPlan", input: { repoPath: "/repo", taskId: "epic-1", markdown: "# Plan" } },
      {
        type: "delete",
        input: { repoPath: "/repo", taskId: "old-child", deleteSubtasks: false },
      },
      {
        type: "create",
        input: {
          repoPath: "/repo",
          task: {
            title: "Build UI",
            issueType: "task",
            priority: 1,
            description: "Ship it",
            aiReviewEnabled: true,
            parentId: "epic-1",
          },
        },
      },
      {
        type: "create",
        input: {
          repoPath: "/repo",
          task: {
            title: "Wire API",
            issueType: "feature",
            priority: 2,
            description: undefined,
            aiReviewEnabled: true,
            parentId: "epic-1",
          },
        },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "epic-1", status: "ready_for_dev" },
      },
    ]);
  });

  test("saves plan documents without applying workflow transitions", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTask(input) {
        calls.push({ type: "get", input });
        return task({ id: "task-1", status: "in_progress" });
      },
      async setPlanDocument(input) {
        calls.push({ type: "setPlan", input });
        return { markdown: input.markdown, updatedAt: "2026-05-10T10:00:00.000Z", revision: 3 };
      },
      async listTasks() {
        throw new Error("unexpected list");
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
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).savePlanDocument({
        repoPath: "/repo",
        taskId: "task-1",
        markdown: " # Plan ",
      }),
    ).resolves.toEqual({
      markdown: "# Plan",
      updatedAt: "2026-05-10T10:00:00.000Z",
      revision: 3,
    });
    expect(calls).toEqual([
      { type: "get", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "setPlan", input: { repoPath: "/repo", taskId: "task-1", markdown: "# Plan" } },
    ]);
  });
});
