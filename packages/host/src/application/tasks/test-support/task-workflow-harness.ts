import type {
  AgentSessionRecord,
  CommitsAheadBehind,
  GitBranch,
  GitCurrentBranch,
  RepoConfig,
  TaskCard,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { GitPort } from "../../../ports/git-port";
import type { RuntimeRegistryPort } from "../../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { TaskActivityGuardPort } from "../../../ports/task-activity-guard-port";
import type { TaskStorePort as RealTaskStorePort } from "../../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import type { DevServerService } from "../../dev-servers/dev-server-service";
import { createRuntimeDefinitionsService } from "../../runtimes/runtime-definitions-service";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import {
  type CreateTaskServiceInput,
  createTaskService as createRealTaskService,
} from "../task-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";

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

type TaskStorePort = Partial<RealTaskStorePort>;

const unexpectedTaskStoreCall = (methodName: string) => async (): Promise<never> => {
  throw new Error(`unexpected task store call: ${methodName}`);
};

const createTaskStorePort = (overrides: TaskStorePort): RealTaskStorePort => ({
  clearAgentSessionsByRoles: unexpectedTaskStoreCall("clearAgentSessionsByRoles"),
  clearQaReports: unexpectedTaskStoreCall("clearQaReports"),
  clearWorkflowDocuments: unexpectedTaskStoreCall("clearWorkflowDocuments"),
  createTask: unexpectedTaskStoreCall("createTask"),
  deleteTask: unexpectedTaskStoreCall("deleteTask"),
  diagnoseRepoStore: unexpectedTaskStoreCall("diagnoseRepoStore"),
  getTask: unexpectedTaskStoreCall("getTask"),
  getTaskMetadata: unexpectedTaskStoreCall("getTaskMetadata"),
  listPullRequestSyncCandidates: unexpectedTaskStoreCall("listPullRequestSyncCandidates"),
  listTasks: unexpectedTaskStoreCall("listTasks"),
  recordQaOutcome: unexpectedTaskStoreCall("recordQaOutcome"),
  setDirectMerge: unexpectedTaskStoreCall("setDirectMerge"),
  setPlanDocument: unexpectedTaskStoreCall("setPlanDocument"),
  setPullRequest: unexpectedTaskStoreCall("setPullRequest"),
  setSpecDocument: unexpectedTaskStoreCall("setSpecDocument"),
  transitionTask: unexpectedTaskStoreCall("transitionTask"),
  updateTask: unexpectedTaskStoreCall("updateTask"),
  upsertAgentSession: unexpectedTaskStoreCall("upsertAgentSession"),
  ...overrides,
});

const createTaskService = (
  input: Omit<CreateTaskServiceInput, "taskStore"> & { taskStore: TaskStorePort },
) => createRealTaskService({ ...input, taskStore: createTaskStorePort(input.taskStore) });

const createAgentSessionTaskStore = (calls: unknown[]): RealTaskStorePort => ({
  async upsertAgentSession(input) {
    calls.push(input);
    return true;
  },
  async clearAgentSessionsByRoles() {
    throw new Error("unexpected clear agent sessions");
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
  async diagnoseRepoStore() {
    throw new Error("unexpected diagnostics");
  },
  async listPullRequestSyncCandidates() {
    throw new Error("unexpected pull request sync candidates");
  },
  async setPullRequest() {
    throw new Error("unexpected set pull request");
  },
  async setDirectMerge() {
    throw new Error("unexpected set direct merge");
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
  async clearWorkflowDocuments() {
    throw new Error("unexpected clear workflow documents");
  },
  async clearQaReports() {
    throw new Error("unexpected clear QA reports");
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
    return "/repo-default-worktrees/repo";
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
  }) as unknown as WorkspaceSettingsService;

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
    return "/repo-default-worktrees/repo";
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
  }) as unknown as WorkspaceSettingsService;

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
  async pathIsWithinRoot(root, candidate) {
    return candidate === root || candidate.startsWith(`${root}/`);
  },
});

const createBuildStartRuntimeRegistry = (calls: unknown[]): RuntimeRegistryPort => ({
  async ensureWorkspaceRuntime(input) {
    calls.push({ type: "ensureRuntime", input });
    return {
      kind: input.runtimeKind as "opencode" | "codex",
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
  removeWorktreeErrors = {},
}: {
  calls: unknown[];
  currentBranches?: Record<string, GitCurrentBranch>;
  branches?: Record<string, GitBranch[]>;
  aheadBehind?: Record<string, CommitsAheadBehind>;
  ancestorResults?: Record<string, boolean>;
  removeWorktreeErrors?: Record<string, Error>;
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
    const error = removeWorktreeErrors[`${repoPath}|${worktreePath}|${String(force)}`];
    if (error) {
      throw error;
    }
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

export type {
  AgentSessionRecord,
  CommitsAheadBehind,
  DevServerService,
  GitBranch,
  GitCurrentBranch,
  GitPort,
  RepoConfig,
  RuntimeRegistryPort,
  SettingsConfigPort,
  SystemCommandPort,
  TaskActivityGuardPort,
  TaskCard,
  TaskStorePort,
  TaskWorktreeService,
  WorkspaceRecord,
  WorkspaceSettingsService,
  WorktreeFilePort,
};
export {
  createAgentSessionRecord,
  createAgentSessionSettingsConfig,
  createAgentSessionTaskStore,
  createAgentSessionWorkspaceSettingsService,
  createApprovalSystemCommands,
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildStartRuntimeRegistry,
  createBuildStartWorktreeFiles,
  createBuildSystemCommands,
  createBuildWorkspaceSettingsService,
  createDirectMergeDevServerService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createPullRequestDetectSystemCommands,
  createPullRequestSyncSystemCommands,
  createPullRequestUpsertSystemCommands,
  createRuntimeDefinitionsService,
  createTaskService,
  githubPullListPayload,
  githubPullResponsePayload,
  pullRequest,
  task,
};
