import {
  type HostMcpBridgeCheck,
  type HostRuntimeSnapshot,
  hostMcpBridgeCheckSchema,
  hostRuntimeSnapshotSchema,
  type RuntimeLifecycleImpact,
  type RuntimeRestartResult,
  runtimeLifecycleImpactSchema,
  runtimeRestartResultSchema,
  type AgentSessionStopTarget,
  agentSessionStopTargetSchema,
  type BuildSessionBootstrap,
  buildSessionBootstrapSchema,
  type DevServerGroupState,
  type DevServerOwner,
  devServerGroupStateSchema,
  type PullRequest,
  pullRequestSchema,
  type RuntimeCheck,
  type RuntimeDescriptor,
  type RuntimeExecutableCheck,
  type RuntimeExecutableCheckInput,
  type RuntimeKind,
  runtimeCheckSchema,
  runtimeDescriptorSchema,
  runtimeExecutableCheckInputSchema,
  runtimeExecutableCheckSchema,
  type SystemCheck,
  systemCheckSchema,
  type TaskApprovalContextLoadResult,
  type TaskCard,
  type TaskDirectMergeInput,
  type TaskDirectMergeResult,
  type TaskStoreCheck,
  type TaskWorktreeSummary,
  taskApprovalContextLoadResultSchema,
  taskCardSchema,
  taskDirectMergeInputSchema,
  taskDirectMergeResultSchema,
  taskPullRequestDetectResultSchema,
  taskStoreCheckSchema,
  taskWorktreeSummarySchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { arrayResultSchema, booleanResultSchema, okResultSchema } from "./invoke-utils";

const systemCheck = async (invokeFn: InvokeFn, repoPath: string): Promise<SystemCheck> => {
  return invokeFn("system_check", { repoPath }, systemCheckSchema);
};

const runtimeCheck = async (invokeFn: InvokeFn, force = false): Promise<RuntimeCheck> => {
  return invokeFn("runtime_check", { force }, runtimeCheckSchema);
};

const taskStoreCheck = async (invokeFn: InvokeFn, repoPath: string): Promise<TaskStoreCheck> => {
  return invokeFn("task_store_check", { repoPath }, taskStoreCheckSchema);
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
  repoPath: string,
  taskId: string,
): Promise<TaskWorktreeSummary | null> => {
  return invokeFn("task_worktree_get", { repoPath, taskId }, taskWorktreeSummarySchema.nullable());
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

const hostMcpBridgeCheck = async (invokeFn: InvokeFn): Promise<HostMcpBridgeCheck> => {
  return invokeFn("host_mcp_bridge_check", {}, hostMcpBridgeCheckSchema);
};

const buildStart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  runtimeKind: RuntimeKind,
): Promise<BuildSessionBootstrap> => {
  return invokeFn("build_start", { repoPath, taskId, runtimeKind }, buildSessionBootstrapSchema);
};

const devServerGetState = async (
  invokeFn: InvokeFn,
  repoPath: string,
  owner: DevServerOwner,
): Promise<DevServerGroupState> => {
  return invokeFn("dev_server_get_state", { repoPath, owner }, devServerGroupStateSchema);
};

const devServerStart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  owner: DevServerOwner,
): Promise<DevServerGroupState> => {
  return invokeFn("dev_server_start", { repoPath, owner }, devServerGroupStateSchema);
};

const devServerStop = async (
  invokeFn: InvokeFn,
  repoPath: string,
  owner: DevServerOwner,
): Promise<DevServerGroupState> => {
  return invokeFn("dev_server_stop", { repoPath, owner }, devServerGroupStateSchema);
};

const devServerRestart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  owner: DevServerOwner,
): Promise<DevServerGroupState> => {
  return invokeFn("dev_server_restart", { repoPath, owner }, devServerGroupStateSchema);
};

const buildBlocked = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  reason: string,
): Promise<TaskCard> => {
  return invokeFn("build_blocked", { repoPath, taskId, reason }, taskCardSchema);
};

const buildResumed = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<TaskCard> => {
  return invokeFn("build_resumed", { repoPath, taskId }, taskCardSchema);
};

const buildCompleted = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  summary?: string,
): Promise<TaskCard> => {
  return invokeFn("build_completed", { repoPath, taskId, input: { summary } }, taskCardSchema);
};

const humanRequestChanges = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  note?: string,
): Promise<TaskCard> => {
  return invokeFn("human_request_changes", { repoPath, taskId, note }, taskCardSchema);
};

const humanApprove = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<TaskCard> => {
  return invokeFn("human_approve", { repoPath, taskId }, taskCardSchema);
};

const taskApprovalContextGet = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<TaskApprovalContextLoadResult> => {
  return invokeFn(
    "task_approval_context_get",
    { repoPath, taskId },
    taskApprovalContextLoadResultSchema,
  );
};

const taskDirectMerge = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  input: TaskDirectMergeInput,
): Promise<TaskDirectMergeResult> => {
  const parsedInput = taskDirectMergeInputSchema.parse(input);
  return invokeFn(
    "task_direct_merge",
    { repoPath, taskId, input: parsedInput },
    taskDirectMergeResultSchema,
  );
};

const taskDirectMergeComplete = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<TaskCard> => {
  return invokeFn("task_direct_merge_complete", { repoPath, taskId }, taskCardSchema);
};

const taskPullRequestUpsert = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  title: string,
  body: string,
) => {
  return invokeFn(
    "task_pull_request_upsert",
    { repoPath, taskId, input: { title, body } },
    pullRequestSchema,
  );
};

const taskPullRequestUnlink = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<{ ok: boolean }> => {
  const payload = await invokeFn(
    "task_pull_request_unlink",
    { repoPath, taskId },
    booleanResultSchema,
  );
  return { ok: payload };
};

const taskPullRequestDetect = async (invokeFn: InvokeFn, repoPath: string, taskId: string) => {
  return invokeFn(
    "task_pull_request_detect",
    { repoPath, taskId },
    taskPullRequestDetectResultSchema,
  );
};

const taskPullRequestLinkMerged = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  pullRequest: PullRequest,
) => {
  return invokeFn(
    "task_pull_request_link_merged",
    { repoPath, taskId, pullRequest },
    taskCardSchema,
  );
};

const repoPullRequestSync = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<{ ok: boolean }> => {
  return invokeFn("repo_pull_request_sync", { repoPath }, okResultSchema("repo_pull_request_sync"));
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

  async systemCheck(repoPath: string): Promise<SystemCheck> {
    return systemCheck(this.invokeFn, repoPath);
  }

  async runtimeCheck(force = false): Promise<RuntimeCheck> {
    return runtimeCheck(this.invokeFn, force);
  }

  async taskStoreCheck(repoPath: string): Promise<TaskStoreCheck> {
    return taskStoreCheck(this.invokeFn, repoPath);
  }

  async runtimeDefinitionsList(): Promise<RuntimeDescriptor[]> {
    return runtimeDefinitionsList(this.invokeFn);
  }

  async runtimeExecutablesCheck(
    input: RuntimeExecutableCheckInput,
  ): Promise<RuntimeExecutableCheck> {
    return runtimeExecutablesCheck(this.invokeFn, input);
  }

  async taskWorktreeGet(repoPath: string, taskId: string): Promise<TaskWorktreeSummary | null> {
    return taskWorktreeGet(this.invokeFn, repoPath, taskId);
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

  async hostMcpBridgeCheck(): Promise<HostMcpBridgeCheck> {
    return hostMcpBridgeCheck(this.invokeFn);
  }

  async buildStart(
    repoPath: string,
    taskId: string,
    runtimeKind: RuntimeKind,
  ): Promise<BuildSessionBootstrap> {
    return buildStart(this.invokeFn, repoPath, taskId, runtimeKind);
  }

  async devServerGetState(repoPath: string, owner: DevServerOwner): Promise<DevServerGroupState> {
    return devServerGetState(this.invokeFn, repoPath, owner);
  }

  async devServerStart(repoPath: string, owner: DevServerOwner): Promise<DevServerGroupState> {
    return devServerStart(this.invokeFn, repoPath, owner);
  }

  async devServerStop(repoPath: string, owner: DevServerOwner): Promise<DevServerGroupState> {
    return devServerStop(this.invokeFn, repoPath, owner);
  }

  async devServerRestart(repoPath: string, owner: DevServerOwner): Promise<DevServerGroupState> {
    return devServerRestart(this.invokeFn, repoPath, owner);
  }

  async buildBlocked(repoPath: string, taskId: string, reason: string): Promise<TaskCard> {
    return buildBlocked(this.invokeFn, repoPath, taskId, reason);
  }

  async buildResumed(repoPath: string, taskId: string): Promise<TaskCard> {
    return buildResumed(this.invokeFn, repoPath, taskId);
  }

  async buildCompleted(repoPath: string, taskId: string, summary?: string): Promise<TaskCard> {
    return buildCompleted(this.invokeFn, repoPath, taskId, summary);
  }

  async humanRequestChanges(repoPath: string, taskId: string, note?: string): Promise<TaskCard> {
    return humanRequestChanges(this.invokeFn, repoPath, taskId, note);
  }

  async humanApprove(repoPath: string, taskId: string): Promise<TaskCard> {
    return humanApprove(this.invokeFn, repoPath, taskId);
  }

  async taskApprovalContextGet(
    repoPath: string,
    taskId: string,
  ): Promise<TaskApprovalContextLoadResult> {
    return taskApprovalContextGet(this.invokeFn, repoPath, taskId);
  }

  async taskDirectMerge(
    repoPath: string,
    taskId: string,
    input: TaskDirectMergeInput,
  ): Promise<TaskDirectMergeResult> {
    return taskDirectMerge(this.invokeFn, repoPath, taskId, input);
  }

  async taskDirectMergeComplete(repoPath: string, taskId: string): Promise<TaskCard> {
    return taskDirectMergeComplete(this.invokeFn, repoPath, taskId);
  }

  async taskPullRequestUpsert(repoPath: string, taskId: string, title: string, body: string) {
    return taskPullRequestUpsert(this.invokeFn, repoPath, taskId, title, body);
  }

  async taskPullRequestUnlink(repoPath: string, taskId: string): Promise<{ ok: boolean }> {
    return taskPullRequestUnlink(this.invokeFn, repoPath, taskId);
  }

  async taskPullRequestDetect(repoPath: string, taskId: string) {
    return taskPullRequestDetect(this.invokeFn, repoPath, taskId);
  }

  async taskPullRequestLinkMerged(repoPath: string, taskId: string, pullRequest: PullRequest) {
    return taskPullRequestLinkMerged(this.invokeFn, repoPath, taskId, pullRequest);
  }

  async repoPullRequestSync(repoPath: string): Promise<{ ok: boolean }> {
    return repoPullRequestSync(this.invokeFn, repoPath);
  }

  async agentSessionStop(target: AgentSessionStopTarget): Promise<{ ok: boolean }> {
    return agentSessionStop(this.invokeFn, target);
  }
}
