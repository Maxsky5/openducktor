import {
  type AgentRole,
  type AgentSessionStopTarget,
  agentSessionStopTargetSchema,
  type BuildSessionBootstrap,
  buildSessionBootstrapSchema,
  type DevServerGroupState,
  type CodexAppServerClientRequest,
  type CodexAppServerClientRequestMap,
  type CodexAppServerRequestMethod,
  codexAppServerRequestResultSchema,
  devServerGroupStateSchema,
  type FailureKind,
  type PullRequest,
  pullRequestSchema,
  type RepoRuntimeHealthCheck,
  type RuntimeCheck,
  type RuntimeDescriptor,
  type RuntimeExecutableCheck,
  type RuntimeExecutableCheckInput,
  type RuntimeInstanceSummary,
  type RuntimeKind,
  parseCodexAppServerRequestResult,
  runtimeEnsureFailureSourceSchema,
  type RuntimeEnsureFailureSource,
  repoRuntimeHealthCheckSchema,
  runtimeCheckSchema,
  runtimeDescriptorSchema,
  runtimeExecutableCheckInputSchema,
  runtimeExecutableCheckSchema,
  runtimeInstanceSummarySchema,
  type SystemCheck,
  systemCheckSchema,
  type TaskApprovalContextLoadResult,
  type TaskCard,
  type TaskDirectMergeInput,
  type TaskDirectMergeResult,
  type TaskSessionBootstrap,
  type TaskStoreCheck,
  type TaskWorktreeSummary,
  taskApprovalContextLoadResultSchema,
  taskCardSchema,
  taskDirectMergeInputSchema,
  taskDirectMergeResultSchema,
  taskPullRequestDetectResultSchema,
  taskSessionBootstrapSchema,
  taskStoreCheckSchema,
  taskWorktreeSummarySchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { arrayResultSchema, booleanResultSchema, okResultSchema } from "./invoke-utils";
import type { TaskMetadataCache } from "./task-metadata-cache";
import { z } from "zod";

const invalidStartupLeaseId = "task_session_startup_lease_prepare returned an invalid lease id.";
const startupLeaseIdSchema = z
  .string(invalidStartupLeaseId)
  .refine((leaseId) => leaseId.trim().length > 0, invalidStartupLeaseId);

type CodexAppServerClientRequestFor<Method extends CodexAppServerRequestMethod> = Extract<
  CodexAppServerClientRequest,
  { method: Method }
>;

type RuntimeEnsureFailureKind = FailureKind;

type RuntimeEnsureErrorInit = {
  failureKind: RuntimeEnsureFailureKind;
};

type NormalizedRuntimeEnsureFailure = RuntimeEnsureErrorInit & {
  message: string;
  cause?: unknown;
};

type TaskSessionBootstrapPrepareArgs = {
  repoPath: string;
  taskId: string;
  role: AgentRole;
  runtimeKind: RuntimeKind;
  targetWorkingDirectory?: string;
};

class RuntimeEnsureError extends Error {
  readonly failureKind: RuntimeEnsureFailureKind;

  constructor(message: string, failure: RuntimeEnsureErrorInit, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeEnsureError";
    this.failureKind = failure.failureKind;
  }
}

type RuntimeEnsureFailureEnvelope = {
  message?: string;
  error?: string;
  failureKind: RuntimeEnsureFailureKind;
};

const readRuntimeEnsureFailureEnvelope = (
  value: RuntimeEnsureFailureSource,
): RuntimeEnsureFailureEnvelope | null => {
  if (!value.failureKind) {
    return null;
  }

  const failure: RuntimeEnsureFailureEnvelope = {
    failureKind: value.failureKind,
  };
  if (value.message !== undefined) {
    failure.message = value.message;
  }
  if (value.error !== undefined) {
    failure.error = value.error;
  }
  return failure;
};

const buildRuntimeEnsureFailureSources = (cause: unknown): RuntimeEnsureFailureSource[] => {
  const source = runtimeEnsureFailureSourceSchema.safeParse(cause);
  if (!source.success) {
    return [];
  }

  const nestedSource = runtimeEnsureFailureSourceSchema.safeParse(source.data.cause);
  return nestedSource.success ? [source.data, nestedSource.data] : [source.data];
};

const extractRuntimeEnsureFailure = (cause: unknown): NormalizedRuntimeEnsureFailure | null => {
  if (cause instanceof RuntimeEnsureError) {
    const failure: NormalizedRuntimeEnsureFailure = {
      message: cause.message,
      failureKind: cause.failureKind,
    };
    if (cause.cause !== undefined) {
      failure.cause = cause.cause;
    }
    return failure;
  }

  const sources = buildRuntimeEnsureFailureSources(cause);
  const failureEnvelope = sources
    .map((source) => readRuntimeEnsureFailureEnvelope(source))
    .find((source): source is RuntimeEnsureFailureEnvelope => source !== null);
  if (!failureEnvelope?.failureKind) {
    return null;
  }

  const message =
    failureEnvelope.message ??
    failureEnvelope.error ??
    (cause instanceof Error && cause.message.trim().length > 0 ? cause.message : undefined) ??
    "Failed to ensure runtime.";

  const failure: NormalizedRuntimeEnsureFailure = {
    message,
    failureKind: failureEnvelope.failureKind,
  };
  if (cause !== undefined) {
    failure.cause = cause;
  }
  return failure;
};

const toRuntimeEnsureError = (cause: unknown): RuntimeEnsureError | null => {
  const failure = extractRuntimeEnsureFailure(cause);
  if (!failure) {
    return null;
  }

  return new RuntimeEnsureError(
    failure.message,
    { failureKind: failure.failureKind },
    failure.cause !== undefined ? { cause: failure.cause } : undefined,
  );
};

const systemCheck = async (invokeFn: InvokeFn, repoPath: string): Promise<SystemCheck> => {
  return invokeFn("system_check", { repoPath }, systemCheckSchema);
};

const runtimeCheck = async (invokeFn: InvokeFn, force = false): Promise<RuntimeCheck> => {
  return invokeFn("runtime_check", { force }, runtimeCheckSchema);
};

const taskStoreCheck = async (invokeFn: InvokeFn, repoPath: string): Promise<TaskStoreCheck> => {
  return invokeFn("task_store_check", { repoPath }, taskStoreCheckSchema);
};

const runtimeList = async (
  invokeFn: InvokeFn,
  repoPath: string | undefined,
  runtimeKind: RuntimeKind,
): Promise<RuntimeInstanceSummary[]> => {
  return invokeFn(
    "runtime_list",
    { repoPath, runtimeKind },
    arrayResultSchema(runtimeInstanceSummarySchema, "runtime_list"),
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
  repoPath: string,
  taskId: string,
): Promise<TaskWorktreeSummary | null> => {
  return invokeFn("task_worktree_get", { repoPath, taskId }, taskWorktreeSummarySchema.nullable());
};

const runtimeStop = async (invokeFn: InvokeFn, runtimeId: string): Promise<{ ok: boolean }> => {
  return invokeFn("runtime_stop", { runtimeId }, okResultSchema("runtime_stop"));
};

const runtimeEnsure = async (
  invokeFn: InvokeFn,
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<RuntimeInstanceSummary> => {
  try {
    return await invokeFn(
      "runtime_ensure",
      { repoPath, runtimeKind },
      runtimeInstanceSummarySchema,
    );
  } catch (error) {
    throw toRuntimeEnsureError(error) ?? error;
  }
};

const runtimeRequire = async (
  invokeFn: InvokeFn,
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<RuntimeInstanceSummary> => {
  return invokeFn("runtime_require", { repoPath, runtimeKind }, runtimeInstanceSummarySchema);
};

const repoRuntimeHealth = async (
  invokeFn: InvokeFn,
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<RepoRuntimeHealthCheck> => {
  return invokeFn("repo_runtime_health", { repoPath, runtimeKind }, repoRuntimeHealthCheckSchema);
};

const repoRuntimeHealthStatus = async (
  invokeFn: InvokeFn,
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<RepoRuntimeHealthCheck> => {
  return invokeFn(
    "repo_runtime_health_status",
    { repoPath, runtimeKind },
    repoRuntimeHealthCheckSchema,
  );
};

const codexAppServerRequest = async <Method extends CodexAppServerRequestMethod>(
  invokeFn: InvokeFn,
  runtimeId: string,
  request: CodexAppServerClientRequestFor<Method>,
): Promise<CodexAppServerClientRequestMap[Method]["result"]> => {
  const result = await invokeFn(
    "codex_app_server_request",
    { runtimeId, method: request.method, params: request.params },
    codexAppServerRequestResultSchema,
  );
  return parseCodexAppServerRequestResult(request.method, result);
};

const buildStart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  runtimeKind: RuntimeKind,
): Promise<BuildSessionBootstrap> => {
  return invokeFn("build_start", { repoPath, taskId, runtimeKind }, buildSessionBootstrapSchema);
};

const taskSessionBootstrapPrepare = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  role: AgentRole,
  runtimeKind: RuntimeKind,
  targetWorkingDirectory?: string,
): Promise<TaskSessionBootstrap> => {
  const args: TaskSessionBootstrapPrepareArgs = {
    repoPath,
    taskId,
    role,
    runtimeKind,
  };
  if (targetWorkingDirectory) {
    args.targetWorkingDirectory = targetWorkingDirectory;
  }
  return invokeFn("task_session_bootstrap_prepare", args, taskSessionBootstrapSchema);
};

const finalizeTaskSessionBootstrap = async (
  invokeFn: InvokeFn,
  command: "task_session_bootstrap_complete" | "task_session_bootstrap_abort",
  repoPath: string,
  taskId: string,
  bootstrapId: string,
): Promise<void> => {
  await invokeFn(command, { repoPath, taskId, bootstrapId }, booleanResultSchema);
};

const taskSessionStartupLeasePrepare = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  role: AgentRole,
): Promise<string> => {
  return invokeFn(
    "task_session_startup_lease_prepare",
    { repoPath, taskId, role },
    startupLeaseIdSchema,
  );
};

const finalizeTaskSessionStartupLease = async (
  invokeFn: InvokeFn,
  command: "task_session_startup_lease_complete" | "task_session_startup_lease_abort",
  repoPath: string,
  taskId: string,
  leaseId: string,
): Promise<void> => {
  await invokeFn(command, { repoPath, taskId, leaseId }, booleanResultSchema);
};

const devServerGetState = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<DevServerGroupState> => {
  return invokeFn("dev_server_get_state", { repoPath, taskId }, devServerGroupStateSchema);
};

const devServerStart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<DevServerGroupState> => {
  return invokeFn("dev_server_start", { repoPath, taskId }, devServerGroupStateSchema);
};

const devServerStop = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<DevServerGroupState> => {
  return invokeFn("dev_server_stop", { repoPath, taskId }, devServerGroupStateSchema);
};

const devServerRestart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<DevServerGroupState> => {
  return invokeFn("dev_server_restart", { repoPath, taskId }, devServerGroupStateSchema);
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
  return okResultSchema("task_pull_request_unlink").parse(payload);
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
  constructor(
    private readonly invokeFn: InvokeFn,
    private readonly metadataCache?: TaskMetadataCache,
  ) {}

  async systemCheck(repoPath: string): Promise<SystemCheck> {
    return systemCheck(this.invokeFn, repoPath);
  }

  async runtimeCheck(force = false): Promise<RuntimeCheck> {
    return runtimeCheck(this.invokeFn, force);
  }

  async taskStoreCheck(repoPath: string): Promise<TaskStoreCheck> {
    return taskStoreCheck(this.invokeFn, repoPath);
  }

  async runtimeList(
    repoPath: string | undefined,
    runtimeKind: RuntimeKind,
  ): Promise<RuntimeInstanceSummary[]> {
    return runtimeList(this.invokeFn, repoPath, runtimeKind);
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

  async runtimeStop(runtimeId: string): Promise<{ ok: boolean }> {
    return runtimeStop(this.invokeFn, runtimeId);
  }

  async runtimeEnsure(repoPath: string, runtimeKind: RuntimeKind): Promise<RuntimeInstanceSummary> {
    return runtimeEnsure(this.invokeFn, repoPath, runtimeKind);
  }

  async runtimeRequire(
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<RuntimeInstanceSummary> {
    return runtimeRequire(this.invokeFn, repoPath, runtimeKind);
  }

  async repoRuntimeHealth(
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<RepoRuntimeHealthCheck> {
    return repoRuntimeHealth(this.invokeFn, repoPath, runtimeKind);
  }

  async repoRuntimeHealthStatus(
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<RepoRuntimeHealthCheck> {
    return repoRuntimeHealthStatus(this.invokeFn, repoPath, runtimeKind);
  }

  async codexAppServerRequest<Method extends CodexAppServerRequestMethod>(
    runtimeId: string,
    request: CodexAppServerClientRequestFor<Method>,
  ): Promise<CodexAppServerClientRequestMap[Method]["result"]> {
    return codexAppServerRequest(this.invokeFn, runtimeId, request);
  }

  async buildStart(
    repoPath: string,
    taskId: string,
    runtimeKind: RuntimeKind,
  ): Promise<BuildSessionBootstrap> {
    return buildStart(this.invokeFn, repoPath, taskId, runtimeKind);
  }

  async taskSessionBootstrapPrepare(
    repoPath: string,
    taskId: string,
    role: AgentRole,
    runtimeKind: RuntimeKind,
    targetWorkingDirectory?: string,
  ): Promise<TaskSessionBootstrap> {
    return taskSessionBootstrapPrepare(
      this.invokeFn,
      repoPath,
      taskId,
      role,
      runtimeKind,
      targetWorkingDirectory,
    );
  }

  async taskSessionBootstrapComplete(
    repoPath: string,
    taskId: string,
    bootstrapId: string,
  ): Promise<void> {
    return finalizeTaskSessionBootstrap(
      this.invokeFn,
      "task_session_bootstrap_complete",
      repoPath,
      taskId,
      bootstrapId,
    );
  }

  async taskSessionBootstrapAbort(
    repoPath: string,
    taskId: string,
    bootstrapId: string,
  ): Promise<void> {
    return finalizeTaskSessionBootstrap(
      this.invokeFn,
      "task_session_bootstrap_abort",
      repoPath,
      taskId,
      bootstrapId,
    );
  }

  async taskSessionStartupLeasePrepare(
    repoPath: string,
    taskId: string,
    role: AgentRole,
  ): Promise<string> {
    return taskSessionStartupLeasePrepare(this.invokeFn, repoPath, taskId, role);
  }

  async taskSessionStartupLeaseComplete(
    repoPath: string,
    taskId: string,
    leaseId: string,
  ): Promise<void> {
    return finalizeTaskSessionStartupLease(
      this.invokeFn,
      "task_session_startup_lease_complete",
      repoPath,
      taskId,
      leaseId,
    );
  }

  async taskSessionStartupLeaseAbort(
    repoPath: string,
    taskId: string,
    leaseId: string,
  ): Promise<void> {
    return finalizeTaskSessionStartupLease(
      this.invokeFn,
      "task_session_startup_lease_abort",
      repoPath,
      taskId,
      leaseId,
    );
  }

  async devServerGetState(repoPath: string, taskId: string): Promise<DevServerGroupState> {
    return devServerGetState(this.invokeFn, repoPath, taskId);
  }

  async devServerStart(repoPath: string, taskId: string): Promise<DevServerGroupState> {
    return devServerStart(this.invokeFn, repoPath, taskId);
  }

  async devServerStop(repoPath: string, taskId: string): Promise<DevServerGroupState> {
    return devServerStop(this.invokeFn, repoPath, taskId);
  }

  async devServerRestart(repoPath: string, taskId: string): Promise<DevServerGroupState> {
    return devServerRestart(this.invokeFn, repoPath, taskId);
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
    const result = await taskDirectMerge(this.invokeFn, repoPath, taskId, input);
    this.metadataCache?.invalidate(repoPath, taskId);
    return result;
  }

  async taskDirectMergeComplete(repoPath: string, taskId: string): Promise<TaskCard> {
    const task = await taskDirectMergeComplete(this.invokeFn, repoPath, taskId);
    this.metadataCache?.invalidate(repoPath, taskId);
    return task;
  }

  async taskPullRequestUpsert(repoPath: string, taskId: string, title: string, body: string) {
    const pullRequest = await taskPullRequestUpsert(this.invokeFn, repoPath, taskId, title, body);
    this.metadataCache?.invalidate(repoPath, taskId);
    return pullRequest;
  }

  async taskPullRequestUnlink(repoPath: string, taskId: string): Promise<{ ok: boolean }> {
    const result = await taskPullRequestUnlink(this.invokeFn, repoPath, taskId);
    this.metadataCache?.invalidate(repoPath, taskId);
    return result;
  }

  async taskPullRequestDetect(repoPath: string, taskId: string) {
    const result = await taskPullRequestDetect(this.invokeFn, repoPath, taskId);
    this.metadataCache?.invalidate(repoPath, taskId);
    return result;
  }

  async taskPullRequestLinkMerged(repoPath: string, taskId: string, pullRequest: PullRequest) {
    const result = await taskPullRequestLinkMerged(this.invokeFn, repoPath, taskId, pullRequest);
    this.metadataCache?.invalidate(repoPath, taskId);
    return result;
  }

  async repoPullRequestSync(repoPath: string): Promise<{ ok: boolean }> {
    const result = await repoPullRequestSync(this.invokeFn, repoPath);
    this.metadataCache?.invalidateRepo(repoPath);
    return result;
  }

  async agentSessionStop(target: AgentSessionStopTarget): Promise<{ ok: boolean }> {
    return agentSessionStop(this.invokeFn, target);
  }
}
