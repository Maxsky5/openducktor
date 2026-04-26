import type { PlannerTools } from "@openducktor/core";
import { TauriAgentClient } from "./build-runtime-client";
import { TauriFilesystemClient } from "./filesystem-client";
import { TauriGitClient } from "./git-client";
import type { InvokeFn } from "./invoke-utils";
import { TauriSystemClient } from "./system-client";
import { TauriTaskClient } from "./task-client";
import { TaskMetadataCache } from "./task-metadata-cache";
import { TauriWorkspaceClient } from "./workspace-client";

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
] as const satisfies readonly MethodName<TauriWorkspaceClient>[];

const FILESYSTEM_METHODS = [
  "filesystemListDirectory",
] as const satisfies readonly MethodName<TauriFilesystemClient>[];

const SYSTEM_METHODS = [
  "systemListOpenInTools",
  "systemOpenDirectoryInTool",
] as const satisfies readonly MethodName<TauriSystemClient>[];

const TASK_METHODS = [
  "tasksList",
  "taskCreate",
  "taskUpdate",
  "taskDelete",
  "taskResetImplementation",
  "taskReset",
  "taskTransition",
  "taskDefer",
  "taskResumeDeferred",
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
  "agentSessionsListBulk",
  "agentSessionUpsert",
] as const satisfies readonly MethodName<TauriTaskClient>[];

const AGENT_METHODS = [
  "systemCheck",
  "runtimeCheck",
  "beadsCheck",
  "runtimeDefinitionsList",
  "runtimeList",
  "taskWorktreeGet",
  "runtimeStop",
  "runtimeEnsure",
  "runtimeStartupStatus",
  "repoRuntimeHealth",
  "repoRuntimeHealthStatus",
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
] as const satisfies readonly MethodName<TauriAgentClient>[];

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
] as const satisfies readonly MethodName<TauriGitClient>[];

type WorkspaceMethodName = (typeof WORKSPACE_METHODS)[number];
type FilesystemMethodName = (typeof FILESYSTEM_METHODS)[number];
type SystemMethodName = (typeof SYSTEM_METHODS)[number];
type TaskMethodName = (typeof TASK_METHODS)[number];
type AgentMethodName = (typeof AGENT_METHODS)[number];
type GitMethodName = (typeof GIT_METHODS)[number];

type TauriHostClientApi = Pick<TauriWorkspaceClient, WorkspaceMethodName> &
  Pick<TauriFilesystemClient, FilesystemMethodName> &
  Pick<TauriSystemClient, SystemMethodName> &
  Pick<TauriTaskClient, TaskMethodName> &
  Pick<TauriAgentClient, AgentMethodName> &
  Pick<TauriGitClient, GitMethodName>;

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

export type TauriHostClient = TauriHostClientApi & PlannerTools;

const createTauriHostClientApi = (invokeFn: InvokeFn): TauriHostClientApi => {
  const metadataCache = new TaskMetadataCache();
  const workspaceClient = new TauriWorkspaceClient(invokeFn);
  const filesystemClient = new TauriFilesystemClient(invokeFn);
  const systemClient = new TauriSystemClient(invokeFn);
  const taskClient = new TauriTaskClient(invokeFn, metadataCache);
  const agentClient = new TauriAgentClient(invokeFn, metadataCache);
  const gitClient = new TauriGitClient(invokeFn);
  const hostClient = {} as TauriHostClientApi;

  bindDelegates(hostClient, workspaceClient, WORKSPACE_METHODS);
  bindDelegates(hostClient, filesystemClient, FILESYSTEM_METHODS);
  bindDelegates(hostClient, systemClient, SYSTEM_METHODS);
  bindDelegates(hostClient, taskClient, TASK_METHODS);
  bindDelegates(hostClient, agentClient, AGENT_METHODS);
  bindDelegates(hostClient, gitClient, GIT_METHODS);

  return hostClient;
};

export function createTauriHostClient(invokeFn: InvokeFn): TauriHostClient {
  return createTauriHostClientApi(invokeFn);
}
