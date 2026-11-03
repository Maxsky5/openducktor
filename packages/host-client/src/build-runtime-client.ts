import {
  type WorkspaceRef,
  repoPullRequestSyncRequestSchema,
  repoPullRequestSyncResponseSchema,
  type RepoPullRequestSyncResponse,
  taskDirectMergeCompleteIntentSchema,
  type TaskDirectMergeCompleteIntent,
} from "@openducktor/contracts";
import {
  type HostRuntimeSnapshot,
  hostRuntimeSnapshotSchema,
  type RuntimeLifecycleImpact,
  type RuntimeRestartResult,
  runtimeLifecycleImpactSchema,
  runtimeRestartResultSchema,
  type AgentSessionStopTarget,
  agentSessionStopTargetSchema,
  type BuildSessionBootstrap,
  buildSessionBootstrapSchema,
  type PullRequest,
  pullRequestSchema,
  type GitCheck,
  type PathCheck,
  type RuntimeDescriptor,
  type RuntimeExecutableCheck,
  type RuntimeExecutableCheckInput,
  type RuntimeKind,
  gitCheckSchema,
  pathCheckSchema,
  runtimeDescriptorSchema,
  runtimeExecutableCheckInputSchema,
  runtimeExecutableCheckSchema,
  type TaskApprovalContextLoadResult,
  type TaskDirectMergeInput,
  type TaskDirectMergeResult,
  type TaskStoreCheck,
  type TaskWorktreeSummary,
  taskApprovalContextLoadResultSchema,
  taskDirectMergeInputSchema,
  taskDirectMergeResultSchema,
  taskPullRequestDetectResultSchema,
  taskStoreCheckSchema,
  taskWorktreeSummarySchema,
} from "@openducktor/contracts";
import type { InvokeFn, InvokeOptions } from "./invoke-utils";
import { arrayResultSchema, booleanResultSchema, okResultSchema } from "./invoke-utils";
import { type TaskCard, taskCardSchema } from "@openducktor/contracts";

const taskStoreCheck = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  options?: InvokeOptions,
): Promise<TaskStoreCheck> => {
  return invokeFn(
    "task_store_check",
    { workspaceId: scope.workspaceId, repoPath: scope.repoPath },
    taskStoreCheckSchema,
    options,
  );
};

const runtimeDefinitionsList = async (invokeFn: InvokeFn): Promise<RuntimeDescriptor[]> => {
  return invokeFn(
    "runtime_definitions_list",
    {},
    arrayResultSchema(runtimeDescriptorSchema, "runtime_definitions_list"),
  );
};

const runtimeExecutablesCheck = async (
  invokeFn: InvokeFn,
  input: RuntimeExecutableCheckInput,
): Promise<RuntimeExecutableCheck> => {
  const parsedInput = runtimeExecutableCheckInputSchema.parse(input);
  return invokeFn("runtime_executables_check", parsedInput, runtimeExecutableCheckSchema);
};

const taskWorktreeGet = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  taskId: string,
): Promise<TaskWorktreeSummary | null> => {
  return invokeFn(
    "task_worktree_get",
    { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId },
    taskWorktreeSummarySchema.nullable(),
  );
};

const runtimeStatus = async (invokeFn: InvokeFn): Promise<HostRuntimeSnapshot> => {
  return invokeFn("runtime_status", {}, hostRuntimeSnapshotSchema);
};

const runtimeRestartImpact = async (
  invokeFn: InvokeFn,
  runtimeKind: RuntimeKind,
): Promise<RuntimeLifecycleImpact> => {
  return invokeFn("runtime_restart_impact", { runtimeKind }, runtimeLifecycleImpactSchema);
};

const runtimeRestart = async (
  invokeFn: InvokeFn,
  runtimeKind: RuntimeKind,
  confirmation: string,
): Promise<RuntimeRestartResult> => {
  return invokeFn("runtime_restart", { runtimeKind, confirmation }, runtimeRestartResultSchema);
};

const buildStart = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  taskId: string,
  runtimeKind: RuntimeKind,
): Promise<BuildSessionBootstrap> => {
  return invokeFn(
    "build_start",
    { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId, runtimeKind },
    buildSessionBootstrapSchema,
  );
};

const buildBlocked = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  taskId: string,
  reason: string,
): Promise<TaskCard> => {
  return invokeFn(
    "build_blocked",
    { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId, reason },
    taskCardSchema,
  );
};

const buildResumed = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  taskId: string,
): Promise<TaskCard> => {
  return invokeFn(
    "build_resumed",
    { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId },
    taskCardSchema,
  );
};

const buildCompleted = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  taskId: string,
  summary?: string,
): Promise<TaskCard> => {
  return invokeFn(
    "build_completed",
    { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId, input: { summary } },
    taskCardSchema,
  );
};

const humanRequestChanges = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  taskId: string,
  note?: string,
): Promise<TaskCard> => {
  return invokeFn(
    "human_request_changes",
    { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId, note },
    taskCardSchema,
  );
};

const taskApprovalContextGet = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  taskId: string,
): Promise<TaskApprovalContextLoadResult> => {
  return invokeFn(
    "task_approval_context_get",
    { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId },
    taskApprovalContextLoadResultSchema,
  );
};

const taskDirectMerge = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  taskId: string,
  input: TaskDirectMergeInput,
): Promise<TaskDirectMergeResult> => {
  const parsedInput = taskDirectMergeInputSchema.parse(input);
  return invokeFn(
    "task_direct_merge",
    { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId, input: parsedInput },
    taskDirectMergeResultSchema,
  );
};

const taskDirectMergeComplete = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  taskId: string,
  removeWorktree: boolean,
  publicationConsent?: TaskDirectMergeCompleteIntent["publicationConsent"],
): Promise<TaskCard> => {
  return invokeFn(
    "task_direct_merge_complete",
    taskDirectMergeCompleteIntentSchema.parse({
      workspaceId: scope.workspaceId,
      repoPath: scope.repoPath,
      taskId,
      removeWorktree,
      publicationConsent,
    }),
    taskCardSchema,
  );
};

const taskPullRequestUpsert = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  taskId: string,
  title: string,
  body: string,
) => {
  return invokeFn(
    "task_pull_request_upsert",
    { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId, input: { title, body } },
    pullRequestSchema,
  );
};

const taskPullRequestUnlink = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  taskId: string,
): Promise<{ ok: boolean }> => {
  const payload = await invokeFn(
    "task_pull_request_unlink",
    { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId },
    booleanResultSchema,
  );
  return { ok: payload };
};

const taskPullRequestDetect = async (invokeFn: InvokeFn, scope: WorkspaceRef, taskId: string) => {
  return invokeFn(
    "task_pull_request_detect",
    { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId },
    taskPullRequestDetectResultSchema,
  );
};

const taskPullRequestLinkMerged = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
  taskId: string,
  pullRequest: PullRequest,
  removeWorktree: boolean,
) => {
  return invokeFn(
    "task_pull_request_link_merged",
    {
      workspaceId: scope.workspaceId,
      repoPath: scope.repoPath,
      taskId,
      pullRequest,
      removeWorktree,
    },
    taskCardSchema,
  );
};

const repoPullRequestSync = async (
  invokeFn: InvokeFn,
  scope: WorkspaceRef,
): Promise<RepoPullRequestSyncResponse> => {
  return invokeFn(
    "repo_pull_request_sync",
    repoPullRequestSyncRequestSchema.parse({
      workspaceId: scope.workspaceId,
      repoPath: scope.repoPath,
    }),
    repoPullRequestSyncResponseSchema,
  );
};

const agentSessionStop = async (
  invokeFn: InvokeFn,
  target: AgentSessionStopTarget,
): Promise<{ ok: boolean }> => {
  return invokeFn(
    "agent_session_stop",
    { request: agentSessionStopTargetSchema.parse(target) },
    okResultSchema("agent_session_stop"),
  );
};

export class HostAgentClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async pathCheck(force = false, options?: InvokeOptions): Promise<PathCheck> {
    const invoke = this.invokeFn;
    return invoke("path_check", { force }, pathCheckSchema, options);
  }

  async gitCheck(options?: InvokeOptions): Promise<GitCheck> {
    const invoke = this.invokeFn;
    return invoke("git_check", {}, gitCheckSchema, options);
  }

  async taskStoreCheck(scope: WorkspaceRef, options?: InvokeOptions): Promise<TaskStoreCheck> {
    return taskStoreCheck(this.invokeFn, scope, options);
  }

  async runtimeDefinitionsList(): Promise<RuntimeDescriptor[]> {
    return runtimeDefinitionsList(this.invokeFn);
  }

  async runtimeExecutablesCheck(
    input: RuntimeExecutableCheckInput,
  ): Promise<RuntimeExecutableCheck> {
    return runtimeExecutablesCheck(this.invokeFn, input);
  }

  async taskWorktreeGet(scope: WorkspaceRef, taskId: string): Promise<TaskWorktreeSummary | null> {
    return taskWorktreeGet(this.invokeFn, scope, taskId);
  }

  async runtimeStatus(): Promise<HostRuntimeSnapshot> {
    return runtimeStatus(this.invokeFn);
  }

  async runtimeRestartImpact(runtimeKind: RuntimeKind): Promise<RuntimeLifecycleImpact> {
    return runtimeRestartImpact(this.invokeFn, runtimeKind);
  }

  async runtimeRestart(
    runtimeKind: RuntimeKind,
    confirmation: string,
  ): Promise<RuntimeRestartResult> {
    return runtimeRestart(this.invokeFn, runtimeKind, confirmation);
  }

  async buildStart(
    scope: WorkspaceRef,
    taskId: string,
    runtimeKind: RuntimeKind,
  ): Promise<BuildSessionBootstrap> {
    return buildStart(this.invokeFn, scope, taskId, runtimeKind);
  }

  async buildBlocked(scope: WorkspaceRef, taskId: string, reason: string): Promise<TaskCard> {
    return buildBlocked(this.invokeFn, scope, taskId, reason);
  }

  async buildResumed(scope: WorkspaceRef, taskId: string): Promise<TaskCard> {
    return buildResumed(this.invokeFn, scope, taskId);
  }

  async buildCompleted(scope: WorkspaceRef, taskId: string, summary?: string): Promise<TaskCard> {
    return buildCompleted(this.invokeFn, scope, taskId, summary);
  }

  async humanRequestChanges(scope: WorkspaceRef, taskId: string, note?: string): Promise<TaskCard> {
    return humanRequestChanges(this.invokeFn, scope, taskId, note);
  }

  async taskApprovalContextGet(
    scope: WorkspaceRef,
    taskId: string,
  ): Promise<TaskApprovalContextLoadResult> {
    return taskApprovalContextGet(this.invokeFn, scope, taskId);
  }

  async taskDirectMerge(
    scope: WorkspaceRef,
    taskId: string,
    input: TaskDirectMergeInput,
  ): Promise<TaskDirectMergeResult> {
    return taskDirectMerge(this.invokeFn, scope, taskId, input);
  }

  async taskDirectMergeComplete(
    scope: WorkspaceRef,
    taskId: string,
    removeWorktree: boolean,
    publicationConsent?: TaskDirectMergeCompleteIntent["publicationConsent"],
  ): Promise<TaskCard> {
    return taskDirectMergeComplete(
      this.invokeFn,
      scope,
      taskId,
      removeWorktree,
      publicationConsent,
    );
  }

  async taskPullRequestUpsert(scope: WorkspaceRef, taskId: string, title: string, body: string) {
    return taskPullRequestUpsert(this.invokeFn, scope, taskId, title, body);
  }

  async taskPullRequestUnlink(scope: WorkspaceRef, taskId: string): Promise<{ ok: boolean }> {
    return taskPullRequestUnlink(this.invokeFn, scope, taskId);
  }

  async taskPullRequestDetect(scope: WorkspaceRef, taskId: string) {
    return taskPullRequestDetect(this.invokeFn, scope, taskId);
  }

  async taskPullRequestLinkMerged(
    scope: WorkspaceRef,
    taskId: string,
    pullRequest: PullRequest,
    removeWorktree: boolean,
  ) {
    return taskPullRequestLinkMerged(this.invokeFn, scope, taskId, pullRequest, removeWorktree);
  }

  async repoPullRequestSync(scope: WorkspaceRef): Promise<RepoPullRequestSyncResponse> {
    return repoPullRequestSync(this.invokeFn, scope);
  }

  async agentSessionStop(target: AgentSessionStopTarget): Promise<{ ok: boolean }> {
    return agentSessionStop(this.invokeFn, target);
  }
}
