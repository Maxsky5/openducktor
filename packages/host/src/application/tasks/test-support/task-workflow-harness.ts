import type {
  AgentSessionRecord,
  CommitsAheadBehind,
  GitBranch,
  GitCurrentBranch,
  RepoConfig,
  TaskCard,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createToolDiscoveryAdapter } from "../../../adapters/system/tool-discovery";
import { HostOperationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { RuntimeRegistryPort } from "../../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { TaskActivityGuardPort as RealTaskActivityGuardPort } from "../../../ports/task-activity-guard-port";
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
type TaskActivityGuardPort = RealTaskActivityGuardPort;
const createSettingsConfigPort = (port: SettingsConfigPort): SettingsConfigPort =>
  port as unknown as SettingsConfigPort;
const createSystemCommandPort = (port: Partial<SystemCommandPort>): SystemCommandPort =>
  ({
    resolveCommandPath: (command: string) => Effect.succeed(command),
    versionCommand: () => Effect.succeed(null),
    runCommandAllowFailure: () => Effect.succeed({ ok: false, stdout: "", stderr: "" }),
    ...port,
  }) as unknown as SystemCommandPort;
const defaultSystemCommands = createSystemCommandPort({});
const createWorktreeFilePort = (port: Partial<WorktreeFilePort>): WorktreeFilePort =>
  ({
    ensureDirectory: () => Effect.dieMessage("unexpected ensure directory"),
    copyConfiguredPaths: () => Effect.dieMessage("unexpected copy configured paths"),
    removePathIfPresent: () => Effect.dieMessage("unexpected remove path"),
    resolveWorktreePath: (_repoPath, worktreePath) => worktreePath,
    pathIsWithinRoot: () => Effect.dieMessage("unexpected path root check"),
    ...port,
  }) as WorktreeFilePort;
const unexpectedRuntimeRegistryCall = (operation: string) =>
  Effect.fail(
    new HostOperationError({
      operation,
      message: `Unexpected runtime registry call: ${operation}`,
    }),
  );
const createRuntimeRegistryPort = (port: Partial<RuntimeRegistryPort>): RuntimeRegistryPort =>
  ({
    ensureWorkspaceRuntime: () =>
      unexpectedRuntimeRegistryCall("runtimeRegistry.ensureWorkspaceRuntime"),
    findRuntimeById: () => Effect.succeed(null),
    findWorkspaceRuntime: () => Effect.succeed(null),
    listRuntimes: () => Effect.succeed([]),
    listRuntimesByRepo: () => Effect.succeed([]),
    stopRuntime: () => unexpectedRuntimeRegistryCall("runtimeRegistry.stopRuntime"),
    stopAllRuntimes: () => Effect.succeed([]),
    stopSession: () => unexpectedRuntimeRegistryCall("runtimeRegistry.stopSession"),
    probeSessionStatus: () => Effect.succeed({ supported: false, hasLiveSession: false }),
    probeMcpStatus: () =>
      Effect.succeed({
        supported: false,
        connected: false,
        serverStatus: null,
        toolIds: [],
        detail: null,
        failureKind: null,
      }),
    ...port,
  }) as RuntimeRegistryPort;
const createGitPort = (port: Partial<GitPort>): GitPort =>
  ({
    canonicalizePath: (path: string) => Effect.succeed(path),
    isGitRepository: () => Effect.dieMessage("unexpected git repository check"),
    shareGitCommonDirectory: () => Effect.dieMessage("unexpected git common directory check"),
    referenceExists: () => Effect.dieMessage("unexpected reference exists"),
    listRemotes: () => Effect.dieMessage("unexpected list remotes"),
    listBranches: () => Effect.dieMessage("unexpected list branches"),
    getCurrentBranch: () => Effect.dieMessage("unexpected current branch"),
    getStatus: () => Effect.dieMessage("unexpected git status"),
    getDiff: () => Effect.dieMessage("unexpected git diff"),
    getWorktreeStatusData: () => Effect.dieMessage("unexpected worktree status data"),
    getWorktreeStatusSummaryData: () => Effect.dieMessage("unexpected worktree status summary"),
    createWorktree: () => Effect.dieMessage("unexpected create worktree"),
    configureBranchUpstream: () => Effect.dieMessage("unexpected configure branch upstream"),
    deleteReference: () => Effect.dieMessage("unexpected delete reference"),
    removeWorktree: () => Effect.dieMessage("unexpected remove worktree"),
    deleteLocalBranch: () => Effect.dieMessage("unexpected delete local branch"),
    isAncestor: () => Effect.dieMessage("unexpected ancestor check"),
    suggestedSquashCommitMessage: () => Effect.dieMessage("unexpected squash message"),
    mergeBranch: () => Effect.dieMessage("unexpected merge branch"),
    switchBranch: () => Effect.dieMessage("unexpected switch branch"),
    resetWorktreeSelection: () => Effect.dieMessage("unexpected reset worktree selection"),
    commitsAheadBehind: () => Effect.dieMessage("unexpected commits ahead behind"),
    fetchRemote: () => Effect.dieMessage("unexpected fetch remote"),
    pullBranch: () => Effect.dieMessage("unexpected pull branch"),
    commitAll: () => Effect.dieMessage("unexpected commit all"),
    pushBranch: () => Effect.dieMessage("unexpected push branch"),
    rebaseBranch: () => Effect.dieMessage("unexpected rebase branch"),
    rebaseAbort: () => Effect.dieMessage("unexpected rebase abort"),
    abortConflict: () => Effect.dieMessage("unexpected abort conflict"),
    ...port,
  }) as GitPort;
const createWorkspaceSettingsServicePort = (
  service: WorkspaceSettingsService | undefined,
): WorkspaceSettingsService | undefined =>
  service
    ? (service as unknown as WorkspaceSettingsService as unknown as WorkspaceSettingsService)
    : undefined;
const extendGitPort = (base: GitPort, overrides: Partial<GitPort>): GitPort =>
  createGitPort({
    ...base,
    ...overrides,
  } as GitPort);
const extendSettingsConfigPort = (
  base: SettingsConfigPort,
  overrides: Partial<SettingsConfigPort>,
): SettingsConfigPort =>
  createSettingsConfigPort({
    ...base,
    ...overrides,
  } as SettingsConfigPort);
const unexpectedTaskStoreCall = (methodName: string) => () =>
  Effect.dieMessage(`unexpected task store call: ${methodName}`);
const createTaskStorePort = (overrides: TaskStorePort): RealTaskStorePort =>
  ({
    clearAgentSessionsByRoles: unexpectedTaskStoreCall("clearAgentSessionsByRoles"),
    clearQaReports: unexpectedTaskStoreCall("clearQaReports"),
    clearWorkflowDocuments: unexpectedTaskStoreCall("clearWorkflowDocuments"),
    createTask: unexpectedTaskStoreCall("createTask"),
    deleteAgentSession: unexpectedTaskStoreCall("deleteAgentSession"),
    deleteTask: unexpectedTaskStoreCall("deleteTask"),
    diagnoseRepoStore: unexpectedTaskStoreCall("diagnoseRepoStore"),
    getTask: unexpectedTaskStoreCall("getTask"),
    getTaskMetadata: unexpectedTaskStoreCall("getTaskMetadata"),
    listPullRequestSyncCandidates: unexpectedTaskStoreCall("listPullRequestSyncCandidates"),
    listAgentSessionsForTasks: unexpectedTaskStoreCall("listAgentSessionsForTasks"),
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
  }) as unknown as RealTaskStorePort;
const createTaskActivityGuardPort = (
  guard: TaskActivityGuardPort | undefined,
): RealTaskActivityGuardPort | undefined =>
  guard ? (guard as unknown as RealTaskActivityGuardPort) : undefined;
const createTaskService = (
  input: Omit<CreateTaskServiceInput, "taskStore" | "taskActivityGuard"> & {
    taskActivityGuard?: TaskActivityGuardPort;
    taskStore: TaskStorePort;
  },
) => {
  const { taskActivityGuard, taskStore, toolDiscovery, ...rest } = input;
  return createRealTaskService({
    ...rest,
    terminalService:
      rest.terminalService ??
      ({
        acquireTaskCleanup: () => Effect.succeed({ closedTerminalIds: [] }),
      } satisfies NonNullable<CreateTaskServiceInput["terminalService"]>),
    toolDiscovery:
      toolDiscovery ??
      createToolDiscoveryAdapter({ systemCommands: rest.systemCommands ?? defaultSystemCommands }),
    workspaceSettingsService: createWorkspaceSettingsServicePort(rest.workspaceSettingsService),
    ...(taskActivityGuard
      ? { taskActivityGuard: createTaskActivityGuardPort(taskActivityGuard) }
      : {}),
    taskStore: createTaskStorePort(taskStore),
  } as CreateTaskServiceInput);
};
const createAgentSessionTaskStore = (calls: unknown[]): TaskStorePort => ({
  upsertAgentSession(input) {
    return Effect.sync(() => {
      calls.push(input);
      return true;
    });
  },
});
const createAgentSessionSettingsConfig = (existingPaths: Set<string>): SettingsConfigPort =>
  createSettingsConfigPort({
    readConfig() {
      return Effect.dieMessage("unexpected read config");
    },
    writeConfig() {
      return Effect.dieMessage("unexpected write config");
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
    canonicalizePath(rawPath) {
      return existingPaths.has(rawPath)
        ? Effect.succeed(rawPath)
        : Effect.fail(
            new HostOperationError({
              operation: "test.canonicalizePath",
              message: `Path does not exist: ${rawPath}`,
              details: { rawPath },
            }),
          );
    },
    pathExists(path) {
      return Effect.succeed(existingPaths.has(path));
    },
    join(...paths) {
      return paths.join("/").replaceAll(/\/+/g, "/");
    },
  });
const createAgentSessionWorkspaceSettingsService = (
  workspace: Pick<WorkspaceRecord, "repoPath" | "effectiveWorktreeBasePath">,
): WorkspaceSettingsService =>
  ({
    listWorkspaces() {
      return Effect.sync(() => {
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
      });
    },
  }) as unknown as WorkspaceSettingsService;
const createBuildSettingsConfig = (existingPaths: Set<string>): SettingsConfigPort =>
  createSettingsConfigPort({
    readConfig() {
      return Effect.dieMessage("unexpected read config");
    },
    writeConfig() {
      return Effect.dieMessage("unexpected write config");
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
    canonicalizePath(rawPath) {
      return existingPaths.has(rawPath)
        ? Effect.succeed(rawPath)
        : Effect.fail(
            new HostOperationError({
              operation: "test.canonicalizePath",
              message: `Path does not exist: ${rawPath}`,
              details: { rawPath },
            }),
          );
    },
    pathExists(path) {
      return Effect.succeed(existingPaths.has(path));
    },
    join(...paths) {
      return paths.join("/").replaceAll(/\/+/g, "/");
    },
  });
const createBuildWorkspaceSettingsService = (
  repoConfig: Partial<RepoConfig> & Pick<RepoConfig, "workspaceId" | "repoPath" | "hooks">,
): WorkspaceSettingsService =>
  ({
    getRepoConfigByRepoPath() {
      return Effect.sync(() => {
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
      });
    },
  }) as unknown as WorkspaceSettingsService;
const createBuildSystemCommands = (calls: unknown[], ok = true): SystemCommandPort =>
  createSystemCommandPort({
    versionCommand() {
      return Effect.dieMessage("unexpected version command");
    },
    runCommandAllowFailure(command, args, options) {
      return Effect.sync(() => {
        calls.push({ command, args, options });
        return {
          ok,
          stdout: "",
          stderr: ok ? "" : "cleanup failed",
        };
      });
    },
  });
const createBuildStartWorktreeFiles = (calls: unknown[]): WorktreeFilePort =>
  createWorktreeFilePort({
    ensureDirectory(path) {
      return Effect.sync(() => {
        calls.push({ type: "ensureDirectory", path });
      });
    },
    copyConfiguredPaths(repoPath, worktreePath, relativePaths) {
      return Effect.sync(() => {
        calls.push({ type: "copyConfiguredPaths", repoPath, worktreePath, relativePaths });
      });
    },
    removePathIfPresent(path) {
      return Effect.sync(() => {
        calls.push({ type: "removePathIfPresent", path });
      });
    },
    resolveWorktreePath(repoPath, worktreePath) {
      return worktreePath.startsWith("/") ? worktreePath : `${repoPath}/${worktreePath}`;
    },
    pathIsWithinRoot(root, candidate) {
      return Effect.sync(() => {
        return candidate === root || candidate.startsWith(`${root}/`);
      });
    },
  });
const createBuildStartRuntimeRegistry = (calls: unknown[]): RuntimeRegistryPort =>
  createRuntimeRegistryPort({
    ensureWorkspaceRuntime(input) {
      return Effect.sync(() => {
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
      });
    },
    listRuntimes() {
      return Effect.succeed([]);
    },
    stopRuntime() {
      return Effect.sync(() => {
        return false;
      });
    },
    stopSession() {
      return Effect.dieMessage("unexpected stop session");
    },
  });
const createBuildStartGitPort = ({
  calls,
  references = new Set(["origin/main"]),
}: {
  calls: unknown[];
  references?: Set<string>;
}): GitPort =>
  createGitPort({
    canonicalizePath(path) {
      return Effect.sync(() => {
        calls.push({ type: "canonicalizePath", path });
        return path;
      });
    },
    isGitRepository(path) {
      return Effect.sync(() => {
        calls.push({ type: "isGitRepository", path });
        return true;
      });
    },
    shareGitCommonDirectory(repoPath, workingDir) {
      return Effect.sync(() => {
        calls.push({ type: "shareGitCommonDirectory", repoPath, workingDir });
        return true;
      });
    },
    isRegisteredWorktree(repoPath, worktreePath) {
      return Effect.sync(() => {
        calls.push({ type: "isRegisteredWorktree", repoPath, worktreePath });
        return true;
      });
    },
    referenceExists(workingDir, reference) {
      return Effect.sync(() => {
        calls.push({ type: "referenceExists", workingDir, reference });
        return references.has(reference);
      });
    },
    listRemotes() {
      return Effect.sync(() => {
        return [];
      });
    },
    listBranches() {
      return Effect.sync(() => {
        return [];
      });
    },
    getCurrentBranch(workingDir) {
      return Effect.sync(() => {
        calls.push({ type: "currentBranch", workingDir });
        return { name: "odt/task-1-task-1", detached: false };
      });
    },
    getStatus() {
      return Effect.sync(() => {
        return [];
      });
    },
    getDiff() {
      return Effect.sync(() => {
        return [];
      });
    },
    getWorktreeStatusData() {
      return Effect.dieMessage("unexpected worktree status");
    },
    getWorktreeStatusSummaryData() {
      return Effect.dieMessage("unexpected worktree status summary");
    },
    createWorktree(repoPath, worktreePath, branch, createBranch, startPoint) {
      return Effect.sync(() => {
        calls.push({
          type: "createWorktree",
          repoPath,
          worktreePath,
          branch,
          createBranch,
          startPoint,
        });
      });
    },
    configureBranchUpstream(repoPath, worktreePath, branch, upstreamRemote) {
      return Effect.sync(() => {
        calls.push({
          type: "configureBranchUpstream",
          repoPath,
          worktreePath,
          branch,
          upstreamRemote,
        });
        return { createdTrackingRef: "refs/remotes/origin/odt/task-1-task-1" };
      });
    },
    deleteReference(repoPath, reference) {
      return Effect.sync(() => {
        calls.push({ type: "deleteReference", repoPath, reference });
      });
    },
    removeWorktree(repoPath, worktreePath, force) {
      return Effect.sync(() => {
        calls.push({ type: "removeWorktree", repoPath, worktreePath, force });
      });
    },
    deleteLocalBranch(repoPath, branch, force) {
      return Effect.sync(() => {
        calls.push({ type: "deleteLocalBranch", repoPath, branch, force });
      });
    },
    isAncestor() {
      return Effect.sync(() => {
        return true;
      });
    },
    suggestedSquashCommitMessage() {
      return Effect.dieMessage("unexpected suggested squash commit message");
    },
    mergeBranch() {
      return Effect.dieMessage("unexpected merge branch");
    },
    switchBranch() {
      return Effect.dieMessage("unexpected switch branch");
    },
    resetWorktreeSelection() {
      return Effect.dieMessage("unexpected reset");
    },
    commitsAheadBehind() {
      return Effect.sync(() => {
        return { ahead: 0, behind: 0 };
      });
    },
    fetchRemote() {
      return Effect.dieMessage("unexpected fetch");
    },
    pullBranch() {
      return Effect.dieMessage("unexpected pull");
    },
    commitAll() {
      return Effect.dieMessage("unexpected commit");
    },
    pushBranch() {
      return Effect.dieMessage("unexpected push");
    },
    rebaseBranch() {
      return Effect.dieMessage("unexpected rebase");
    },
    rebaseAbort() {
      return Effect.dieMessage("unexpected rebase abort");
    },
    abortConflict() {
      return Effect.dieMessage("unexpected conflict abort");
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
}): GitPort =>
  createGitPort({
    canonicalizePath(path) {
      return Effect.sync(() => {
        return path;
      });
    },
    isGitRepository() {
      return Effect.sync(() => {
        return true;
      });
    },
    shareGitCommonDirectory() {
      return Effect.sync(() => {
        return true;
      });
    },
    isRegisteredWorktree() {
      return Effect.succeed(true);
    },
    referenceExists() {
      return Effect.succeed(true);
    },
    listRemotes() {
      return Effect.sync(() => {
        return [];
      });
    },
    listBranches(workingDir) {
      return Effect.sync(() => {
        calls.push({ type: "listBranches", workingDir });
        return branches[workingDir] ?? [];
      });
    },
    getCurrentBranch(workingDir) {
      return Effect.sync(() => {
        calls.push({ type: "currentBranch", workingDir });
        return currentBranches[workingDir] ?? { detached: true };
      });
    },
    getStatus() {
      return Effect.sync(() => {
        return [];
      });
    },
    getDiff() {
      return Effect.sync(() => {
        return [];
      });
    },
    getWorktreeStatusData() {
      return Effect.dieMessage("unexpected worktree status");
    },
    getWorktreeStatusSummaryData() {
      return Effect.dieMessage("unexpected worktree status summary");
    },
    createWorktree() {
      return Effect.dieMessage("unexpected create worktree");
    },
    removeWorktree(repoPath, worktreePath, force) {
      calls.push({ type: "removeWorktree", repoPath, worktreePath, force });
      const error = removeWorktreeErrors[`${repoPath}|${worktreePath}|${String(force)}`];
      return error
        ? Effect.fail(
            new HostOperationError({
              operation: "test.removeWorktree",
              message: error.message,
              cause: error,
            }),
          )
        : Effect.void;
    },
    deleteLocalBranch(repoPath, branch, force) {
      return Effect.sync(() => {
        calls.push({ type: "deleteLocalBranch", repoPath, branch, force });
      });
    },
    isAncestor(workingDir, ancestor, descendant) {
      return Effect.sync(() => {
        calls.push({ type: "isAncestor", workingDir, ancestor, descendant });
        return ancestorResults[`${workingDir}|${ancestor}|${descendant}`] ?? true;
      });
    },
    suggestedSquashCommitMessage() {
      return Effect.dieMessage("unexpected suggested squash commit message");
    },
    mergeBranch() {
      return Effect.dieMessage("unexpected merge branch");
    },
    switchBranch() {
      return Effect.dieMessage("unexpected switch branch");
    },
    resetWorktreeSelection() {
      return Effect.dieMessage("unexpected reset");
    },
    restoreWorktreeToReference(workingDirectory, reference) {
      return Effect.sync(() => {
        calls.push({ type: "restoreWorktree", workingDirectory, reference });
      });
    },
    commitsAheadBehind(workingDir, targetBranch) {
      return Effect.sync(() => {
        calls.push({ type: "aheadBehind", workingDir, targetBranch });
        return aheadBehind[`${workingDir}|${targetBranch}`] ?? { ahead: 0, behind: 0 };
      });
    },
    fetchRemote() {
      return Effect.dieMessage("unexpected fetch");
    },
    pullBranch() {
      return Effect.dieMessage("unexpected pull");
    },
    commitAll() {
      return Effect.dieMessage("unexpected commit");
    },
    pushBranch() {
      return Effect.dieMessage("unexpected push");
    },
    rebaseBranch() {
      return Effect.dieMessage("unexpected rebase");
    },
    rebaseAbort() {
      return Effect.dieMessage("unexpected rebase abort");
    },
    abortConflict() {
      return Effect.dieMessage("unexpected conflict abort");
    },
  });
const createDirectMergeDevServerService = (calls: unknown[]): DevServerService =>
  ({
    getState() {
      return Effect.dieMessage("unexpected dev server get state");
    },
    restart() {
      return Effect.dieMessage("unexpected dev server restart");
    },
    start() {
      return Effect.dieMessage("unexpected dev server start");
    },
    stop(input: unknown) {
      return Effect.sync(() => {
        calls.push({ type: "stopDevServers", input });
        return {
          repoPath: "/repo",
          taskId: "task-1",
          worktreePath: null,
          scripts: [],
          updatedAt: "2026-05-10T11:30:00.000Z",
        };
      });
    },
  }) satisfies DevServerService as unknown as DevServerService;
const createDirectMergeTaskWorktreeService = (
  workingDirectory: string | null,
): TaskWorktreeService => ({
  getTaskWorktree: () => Effect.succeed(workingDirectory === null ? null : { workingDirectory }),
});
const createApprovalSystemCommands = (available = true): SystemCommandPort =>
  createSystemCommandPort({
    resolveCommandPath(command) {
      return Effect.succeed(command === "gh" && available ? command : null);
    },
    versionCommand() {
      return Effect.dieMessage("unexpected version command");
    },
    runCommandAllowFailure(command, args, options) {
      return Effect.sync(() => {
        return {
          ok: true,
          stdout: `Logged in to ${options?.env?.GH_PROMPT_DISABLED ? "github.com" : command} account octocat\n`,
          stderr: args.join(" "),
        };
      });
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
}): SystemCommandPort =>
  createSystemCommandPort({
    resolveCommandPath(command) {
      calls.push({ type: "resolveCommand", command });
      return Effect.succeed(command === "gh" ? command : null);
    },
    versionCommand() {
      return Effect.dieMessage("unexpected version command");
    },
    runCommandAllowFailure(command, args, options) {
      calls.push({ type: "command", command, args, options });
      if (args.includes("auth")) {
        return Effect.succeed({
          ok: true,
          stdout: "Logged in to github.com account octocat\n",
          stderr: "",
        });
      }
      if (args.includes("state=open")) {
        return Effect.succeed({ ok: true, stdout: openPayload, stderr: "" });
      }
      if (args.includes("state=all")) {
        return Effect.succeed({ ok: true, stdout: allPayload, stderr: "" });
      }
      return Effect.fail(
        new HostOperationError({
          operation: "test.runCommandAllowFailure",
          message: `unexpected command args: ${args.join(" ")}`,
          details: { command, args, options },
        }),
      );
    },
  });
const createPullRequestUpsertSystemCommands = ({
  calls,
  payload,
}: {
  calls: unknown[];
  payload: string;
}): SystemCommandPort =>
  createSystemCommandPort({
    resolveCommandPath(command) {
      calls.push({ type: "resolveCommand", command });
      return Effect.succeed(command === "gh" ? command : null);
    },
    versionCommand() {
      return Effect.dieMessage("unexpected version command");
    },
    runCommandAllowFailure(command, args, options) {
      calls.push({ type: "command", command, args, options });
      if (args.includes("auth")) {
        return Effect.succeed({
          ok: true,
          stdout: "Logged in to github.com account octocat\n",
          stderr: "",
        });
      }
      if (args.includes("--method") && (args.includes("POST") || args.includes("PATCH"))) {
        return Effect.succeed({ ok: true, stdout: payload, stderr: "" });
      }
      return Effect.fail(
        new HostOperationError({
          operation: "test.runCommandAllowFailure",
          message: `unexpected command args: ${args.join(" ")}`,
          details: { command, args, options },
        }),
      );
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
}): SystemCommandPort =>
  createSystemCommandPort({
    resolveCommandPath(command) {
      calls.push({ type: "resolveCommand", command });
      return Effect.succeed(command === "gh" && available ? command : null);
    },
    versionCommand() {
      return Effect.dieMessage("unexpected version command");
    },
    runCommandAllowFailure(command, args, options) {
      calls.push({ type: "command", command, args, options });
      if (args.some((arg) => arg.includes("pulls/42"))) {
        return Effect.succeed({ ok: true, stdout: payload, stderr: "" });
      }
      return Effect.fail(
        new HostOperationError({
          operation: "test.runCommandAllowFailure",
          message: `unexpected command args: ${args.join(" ")}`,
          details: { command, args, options },
        }),
      );
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
  createSystemCommandPort,
  createTaskService,
  extendGitPort,
  extendSettingsConfigPort,
  githubPullListPayload,
  githubPullResponsePayload,
  pullRequest,
  task,
};
