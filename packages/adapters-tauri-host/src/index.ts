import type { PlannerTools } from "@openducktor/core";
import {
  type BuildCleanupMode,
  type BuildRespondAction,
  type RuntimeRole,
  TauriAgentClient,
} from "./build-runtime-client";
import { TauriGitClient } from "./git-client";
import type { InvokeFn } from "./invoke-utils";
import { type SetPlanInput, type SetSpecInput, TauriTaskClient } from "./task-client";
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
  "workspaceUpdateRepoConfig",
  "workspaceSaveRepoSettings",
  "workspaceUpdateRepoHooks",
  "workspaceGetRepoConfig",
  "workspacePrepareTrustedHooksChallenge",
  "workspaceSetTrustedHooks",
  "getTheme",
  "setTheme",
] as const satisfies readonly MethodName<TauriWorkspaceClient>[];

const TASK_METHODS = [
  "tasksList",
  "taskCreate",
  "taskUpdate",
  "taskDelete",
  "taskTransition",
  "taskDefer",
  "taskResumeDeferred",
  "specGet",
  "setSpec",
  "saveSpecDocument",
  "setPlan",
  "savePlanDocument",
  "planGet",
  "qaGetReport",
  "qaApproved",
  "qaRejected",
  "agentSessionsList",
  "agentSessionUpsert",
] as const satisfies readonly MethodName<TauriTaskClient>[];

const AGENT_METHODS = [
  "systemCheck",
  "runtimeCheck",
  "beadsCheck",
  "runsList",
  "opencodeRuntimeList",
  "opencodeRuntimeStart",
  "opencodeRuntimeStop",
  "opencodeRepoRuntimeEnsure",
  "buildStart",
  "buildBlocked",
  "buildResumed",
  "buildCompleted",
  "humanRequestChanges",
  "humanApprove",
  "buildRespond",
  "buildStop",
  "buildCleanup",
] as const satisfies readonly MethodName<TauriAgentClient>[];

const GIT_METHODS = [
  "gitGetBranches",
  "gitGetCurrentBranch",
  "gitSwitchBranch",
  "gitCreateWorktree",
  "gitRemoveWorktree",
  "gitPushBranch",
  "gitPullBranch",
  "gitCommitAll",
  "gitRebaseBranch",
  "gitGetStatus",
  "gitGetDiff",
  "gitCommitsAheadBehind",
  "gitGetWorktreeStatus",
] as const satisfies readonly MethodName<TauriGitClient>[];

type WorkspaceMethodName = (typeof WORKSPACE_METHODS)[number];
type TaskMethodName = (typeof TASK_METHODS)[number];
type AgentMethodName = (typeof AGENT_METHODS)[number];
type GitMethodName = (typeof GIT_METHODS)[number];

type TauriHostClientApi = Pick<TauriWorkspaceClient, WorkspaceMethodName> &
  Pick<TauriTaskClient, TaskMethodName> &
  Pick<TauriAgentClient, AgentMethodName> &
  Pick<TauriGitClient, GitMethodName>;

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

    Object.defineProperty(host, methodName, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: candidate.bind(client),
    });
  }
};

class TauriHostClientImpl implements PlannerTools {
  private readonly workspaceClient: TauriWorkspaceClient;
  private readonly taskClient: TauriTaskClient;
  private readonly agentClient: TauriAgentClient;
  private readonly gitClient: TauriGitClient;

  declare setSpec: (input: SetSpecInput) => ReturnType<TauriTaskClient["setSpec"]>;
  declare setPlan: (input: SetPlanInput) => ReturnType<TauriTaskClient["setPlan"]>;
  declare opencodeRuntimeStart: (
    repoPath: string,
    taskId: string,
    role: RuntimeRole,
  ) => ReturnType<TauriAgentClient["opencodeRuntimeStart"]>;
  declare buildRespond: (
    runId: string,
    action: BuildRespondAction,
    payload?: string,
  ) => ReturnType<TauriAgentClient["buildRespond"]>;
  declare buildCleanup: (
    runId: string,
    mode: BuildCleanupMode,
  ) => ReturnType<TauriAgentClient["buildCleanup"]>;

  constructor(invokeFn: InvokeFn) {
    const metadataCache = new TaskMetadataCache();
    this.workspaceClient = new TauriWorkspaceClient(invokeFn);
    this.taskClient = new TauriTaskClient(invokeFn, metadataCache);
    this.agentClient = new TauriAgentClient(invokeFn);
    this.gitClient = new TauriGitClient(invokeFn);

    bindDelegates(this, this.workspaceClient, WORKSPACE_METHODS);
    bindDelegates(this, this.taskClient, TASK_METHODS);
    bindDelegates(this, this.agentClient, AGENT_METHODS);
    bindDelegates(this, this.gitClient, GIT_METHODS);
  }
}

export type TauriHostClient = TauriHostClientApi & PlannerTools;

/**
 * Creates a TauriHostClient instance.
 * Uses unknown intermediate to assert interface conformance.
 */
export function createTauriHostClient(invokeFn: InvokeFn): TauriHostClient {
  const instance = new TauriHostClientImpl(invokeFn);
  return instance as unknown as TauriHostClient;
}

/** @deprecated Use createTauriHostClient() */
export const TauriHostClient = createTauriHostClient;
