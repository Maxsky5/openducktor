import type { PlannerTools } from "@openducktor/core";

export { createAgentSessionLiveAttachment } from "./agent-session-live-attachment";

import { HostAgentSessionLiveClient } from "./agent-session-live-client";
import { HostAgentClient } from "./build-runtime-client";
import { HostClaudeRuntimeClient } from "./claude-runtime-client";
import { HostFilesystemClient } from "./filesystem-client";
import { HostGitClient } from "./git-client";
import type { InvokeFn } from "./invoke-utils";
import { HostPullRequestReviewClient } from "./pull-request-review-client";
import { HostSystemClient } from "./system-client";
import { HostTaskClient } from "./task-client";
import { TaskMetadataCache } from "./task-metadata-cache";
import { HostTerminalClient } from "./terminal-client";

export { HostInvokeError } from "./invoke-utils";
export { HostTerminalClientError } from "./terminal-client";

import { HostWorkspaceClient } from "./workspace-client";

type MethodName<TClient extends object> = {
  [TKey in keyof TClient]: TClient[TKey] extends (...args: infer _TArgs) => infer _TReturn
    ? TKey
    : never;
}[keyof TClient];

const WORKSPACE_METHODS = [
  "workspaceList",
  "workspaceAdd",
  "workspaceSelect",
  "workspaceReorder",
  "workspaceUpdateRepoConfig",
  "workspaceSaveRepoSettings",
  "workspaceUpdateRepoHooks",
  "workspaceGetRepoConfig",
  "workspaceGetSettingsSnapshot",
  "workspaceUpdateGlobalGitConfig",
  "workspaceDetectGithubRepository",
  "workspaceSaveSettingsSnapshot",
  "workspaceStageLocalAttachment",
  "workspaceResolveLocalAttachmentPath",
  "setTheme",
] as const satisfies readonly MethodName<HostWorkspaceClient>[];

const FILESYSTEM_METHODS = [
  "filesystemListDirectory",
  "filesystemListTree",
  "filesystemReadTextFile",
] as const satisfies readonly MethodName<HostFilesystemClient>[];

const PULL_REQUEST_REVIEW_METHODS = [
  "pullRequestReviewContextGet",
] as const satisfies readonly MethodName<HostPullRequestReviewClient>[];

const SYSTEM_METHODS = [
  "systemGetPlatform",
  "systemListOpenInTools",
  "systemOpenDirectoryInTool",
] as const satisfies readonly MethodName<HostSystemClient>[];

const TASK_METHODS = [
  "tasksList",
  "taskCreate",
  "taskUpdate",
  "taskDelete",
  "taskClose",
  "taskResetImplementation",
  "taskReset",
  "taskTransition",
  "specGet",
  "setSpec",
  "saveSpecDocument",
  "setPlan",
  "savePlanDocument",
  "planGet",
  "taskMetadataGet",
  "taskMetadataGetFresh",
  "taskDocumentGet",
  "taskDocumentGetFresh",
  "qaGetReport",
  "qaApproved",
  "qaRejected",
  "agentSessionsList",
  "agentSessionDelete",
  "agentSessionsListForTasks",
  "agentSessionUpsert",
] as const satisfies readonly MethodName<HostTaskClient>[];

const TERMINAL_METHODS = [
  "terminalCreate",
  "terminalList",
  "terminalPreparePathInput",
  "terminalClose",
] as const satisfies readonly MethodName<HostTerminalClient>[];

const AGENT_METHODS = [
  "systemCheck",
  "runtimeCheck",
  "taskStoreCheck",
  "runtimeDefinitionsList",
  "runtimeList",
  "taskWorktreeGet",
  "runtimeStop",
  "runtimeEnsure",
  "runtimeRequire",
  "repoRuntimeHealth",
  "repoRuntimeHealthStatus",
  "codexAppServerRequest",
  "buildStart",
  "taskSessionBootstrapPrepare",
  "taskSessionBootstrapComplete",
  "taskSessionBootstrapAbort",
  "taskSessionStartupLeasePrepare",
  "taskSessionStartupLeaseComplete",
  "taskSessionStartupLeaseAbort",
  "devServerGetState",
  "devServerStart",
  "devServerStop",
  "devServerRestart",
  "buildBlocked",
  "buildResumed",
  "buildCompleted",
  "taskApprovalContextGet",
  "taskDirectMerge",
  "taskDirectMergeComplete",
  "taskPullRequestUpsert",
  "taskPullRequestUnlink",
  "taskPullRequestDetect",
  "taskPullRequestLinkMerged",
  "repoPullRequestSync",
  "humanRequestChanges",
  "humanApprove",
  "agentSessionStop",
] as const satisfies readonly MethodName<HostAgentClient>[];

const AGENT_SESSION_LIVE_METHODS = [
  "agentSessionControlFork",
  "agentSessionControlRelease",
  "agentSessionControlResume",
  "agentSessionControlSend",
  "agentSessionControlStart",
  "agentSessionControlStop",
  "agentSessionControlUpdateModel",
  "agentSessionLiveList",
  "agentSessionLiveLoadContext",
  "agentSessionLiveRead",
  "agentSessionLiveRefresh",
  "agentSessionLiveReplyApproval",
  "agentSessionLiveReplyQuestion",
] as const satisfies readonly MethodName<HostAgentSessionLiveClient>[];

const CLAUDE_RUNTIME_METHODS = [
  "claudeRuntimeFileStatus",
  "claudeRuntimeListModels",
  "claudeRuntimeListSkills",
  "claudeRuntimeListSlashCommands",
  "claudeRuntimeListSubagents",
  "claudeRuntimeLoadSessionDiff",
  "claudeRuntimeLoadSessionHistory",
  "claudeRuntimeLoadSessionTodos",
  "claudeRuntimeSearchFiles",
] as const satisfies readonly MethodName<HostClaudeRuntimeClient>[];

const GIT_METHODS = [
  "gitCanonicalizePath",
  "gitGetBranches",
  "gitGetCurrentBranch",
  "gitSwitchBranch",
  "gitCreateWorktree",
  "gitRemoveWorktree",
  "gitPushBranch",
  "gitPullBranch",
  "gitFetchRemote",
  "gitCommitAll",
  "gitRebaseBranch",
  "gitRebaseAbort",
  "gitAbortConflict",
  "gitGetStatus",
  "gitGetDiff",
  "gitCommitsAheadBehind",
  "gitGetWorktreeStatus",
  "gitGetWorktreeStatusSummary",
  "gitResetWorktreeSelection",
] as const satisfies readonly MethodName<HostGitClient>[];

type WorkspaceMethodName = (typeof WORKSPACE_METHODS)[number];
type FilesystemMethodName = (typeof FILESYSTEM_METHODS)[number];
type PullRequestReviewMethodName = (typeof PULL_REQUEST_REVIEW_METHODS)[number];
type SystemMethodName = (typeof SYSTEM_METHODS)[number];
type TaskMethodName = (typeof TASK_METHODS)[number];
type TerminalMethodName = (typeof TERMINAL_METHODS)[number];
type AgentMethodName = (typeof AGENT_METHODS)[number];
type AgentSessionLiveMethodName = (typeof AGENT_SESSION_LIVE_METHODS)[number];
type ClaudeRuntimeMethodName = (typeof CLAUDE_RUNTIME_METHODS)[number];
type GitMethodName = (typeof GIT_METHODS)[number];

type HostClientApi = Pick<HostWorkspaceClient, WorkspaceMethodName> &
  Pick<HostFilesystemClient, FilesystemMethodName> &
  Pick<HostPullRequestReviewClient, PullRequestReviewMethodName> &
  Pick<HostSystemClient, SystemMethodName> &
  Pick<HostTaskClient, TaskMethodName> &
  Pick<HostTerminalClient, TerminalMethodName> &
  Pick<HostAgentClient, AgentMethodName> &
  Pick<HostAgentSessionLiveClient, AgentSessionLiveMethodName> &
  Pick<HostClaudeRuntimeClient, ClaudeRuntimeMethodName> &
  Pick<HostGitClient, GitMethodName>;

type MethodDelegate<TClient extends object, TMethodName extends MethodName<TClient>> = Extract<
  TClient[TMethodName],
  (...args: never[]) => unknown
>;

const bindDelegates = <
  THost extends object,
  TClient extends object,
  TMethodName extends MethodName<TClient>,
>(
  host: THost,
  client: TClient,
  methods: readonly TMethodName[],
): void => {
  for (const methodName of methods) {
    const candidate = client[methodName];
    if (typeof candidate !== "function") {
      throw new Error(`Cannot delegate non-function member: ${String(methodName)}`);
    }

    const delegate = candidate.bind(client) as MethodDelegate<TClient, TMethodName>;

    Object.defineProperty(host, methodName, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: delegate,
    });
  }
};

export type HostClient = HostClientApi & PlannerTools;

const createHostClientApi = (invokeFn: InvokeFn): HostClientApi => {
  const metadataCache = new TaskMetadataCache();
  const workspaceClient = new HostWorkspaceClient(invokeFn);
  const filesystemClient = new HostFilesystemClient(invokeFn);
  const pullRequestReviewClient = new HostPullRequestReviewClient(invokeFn);
  const systemClient = new HostSystemClient(invokeFn);
  const taskClient = new HostTaskClient(invokeFn, metadataCache);
  const terminalClient = new HostTerminalClient(invokeFn);
  const agentClient = new HostAgentClient(invokeFn, metadataCache);
  const agentSessionLiveClient = new HostAgentSessionLiveClient(invokeFn);
  const claudeRuntimeClient = new HostClaudeRuntimeClient(invokeFn);
  const gitClient = new HostGitClient(invokeFn);
  const hostClient = {} as HostClientApi;

  bindDelegates(hostClient, workspaceClient, WORKSPACE_METHODS);
  bindDelegates(hostClient, filesystemClient, FILESYSTEM_METHODS);
  bindDelegates(hostClient, pullRequestReviewClient, PULL_REQUEST_REVIEW_METHODS);
  bindDelegates(hostClient, systemClient, SYSTEM_METHODS);
  bindDelegates(hostClient, taskClient, TASK_METHODS);
  bindDelegates(hostClient, terminalClient, TERMINAL_METHODS);
  bindDelegates(hostClient, agentClient, AGENT_METHODS);
  bindDelegates(hostClient, agentSessionLiveClient, AGENT_SESSION_LIVE_METHODS);
  bindDelegates(hostClient, claudeRuntimeClient, CLAUDE_RUNTIME_METHODS);
  bindDelegates(hostClient, gitClient, GIT_METHODS);

  return hostClient;
};

export function createHostClient(invokeFn: InvokeFn): HostClient {
  return createHostClientApi(invokeFn);
}
