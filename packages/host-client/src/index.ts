import type { PlannerTools } from "@openducktor/core";
import { HostAgentClient } from "./build-runtime-client";
import { HostFilesystemClient } from "./filesystem-client";
import { HostGitClient } from "./git-client";
import type { InvokeFn } from "./invoke-utils";
import { HostSystemClient } from "./system-client";
import { HostTaskClient } from "./task-client";
import { TaskMetadataCache } from "./task-metadata-cache";
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
] as const satisfies readonly MethodName<HostFilesystemClient>[];

const SYSTEM_METHODS = [
  "systemListOpenInTools",
  "systemOpenDirectoryInTool",
] as const satisfies readonly MethodName<HostSystemClient>[];

const TASK_METHODS = [
  "tasksList",
  "taskCreate",
  "taskUpdate",
  "taskDelete",
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
  "agentSessionUpsert",
] as const satisfies readonly MethodName<HostTaskClient>[];

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
  "codexAppServerRequest",
  "codexAppServerRespond",
  "codexAppServerNotifications",
  "codexAppServerRequests",
  "buildStart",
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

const GIT_METHODS = [
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
type SystemMethodName = (typeof SYSTEM_METHODS)[number];
type TaskMethodName = (typeof TASK_METHODS)[number];
type AgentMethodName = (typeof AGENT_METHODS)[number];
type GitMethodName = (typeof GIT_METHODS)[number];

type HostClientApi = Pick<HostWorkspaceClient, WorkspaceMethodName> &
  Pick<HostFilesystemClient, FilesystemMethodName> &
  Pick<HostSystemClient, SystemMethodName> &
  Pick<HostTaskClient, TaskMethodName> &
  Pick<HostAgentClient, AgentMethodName> &
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
  const systemClient = new HostSystemClient(invokeFn);
  const taskClient = new HostTaskClient(invokeFn, metadataCache);
  const agentClient = new HostAgentClient(invokeFn, metadataCache);
  const gitClient = new HostGitClient(invokeFn);
  const hostClient = {} as HostClientApi;

  bindDelegates(hostClient, workspaceClient, WORKSPACE_METHODS);
  bindDelegates(hostClient, filesystemClient, FILESYSTEM_METHODS);
  bindDelegates(hostClient, systemClient, SYSTEM_METHODS);
  bindDelegates(hostClient, taskClient, TASK_METHODS);
  bindDelegates(hostClient, agentClient, AGENT_METHODS);
  bindDelegates(hostClient, gitClient, GIT_METHODS);

  return hostClient;
};

export function createHostClient(invokeFn: InvokeFn): HostClient {
  return createHostClientApi(invokeFn);
}
