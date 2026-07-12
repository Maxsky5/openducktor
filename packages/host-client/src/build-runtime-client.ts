import {
  type AgentRole,
  type AgentSessionStopTarget,
  agentSessionStopTargetSchema,
  type BuildSessionBootstrap,
  buildSessionBootstrapSchema,
  type CodexAppServerRequestId,
  type DevServerGroupState,
  devServerGroupStateSchema,
  type FailureKind,
  failureKindSchema,
  type PullRequest,
  pullRequestSchema,
  type RepoRuntimeHealthCheck,
  type RuntimeCheck,
  type RuntimeDescriptor,
  type RuntimeInstanceSummary,
  type RuntimeKind,
  repoRuntimeHealthCheckSchema,
  runtimeCheckSchema,
  runtimeDescriptorSchema,
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
import { parseArray, parseOkResult } from "./invoke-utils";
import type { TaskMetadataCache } from "./task-metadata-cache";

type RuntimeEnsureFailureKind = FailureKind;

export type CodexAppServerBufferedEvent = {
  runtimeId: string;
  kind: "notification" | "server_request";
  message: unknown;
  receivedAt: string;
};

type RuntimeEnsureErrorInit = {
  failureKind: RuntimeEnsureFailureKind;
};

type NormalizedRuntimeEnsureFailure = RuntimeEnsureErrorInit & {
  message: string;
  cause?: unknown;
};

class RuntimeEnsureError extends Error {
  readonly failureKind: RuntimeEnsureFailureKind;

  constructor(message: string, failure: RuntimeEnsureErrorInit, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeEnsureError";
    this.failureKind = failure.failureKind;
  }
}

const readUnknownProp = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
};

const readStringProp = (value: unknown, key: string): string | undefined => {
  const candidate = readUnknownProp(value, key);
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
};

const readFailureKind = (value: unknown): RuntimeEnsureFailureKind | undefined => {
  const candidate = readUnknownProp(value, "failureKind");
  const result = failureKindSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
};

type RuntimeEnsureFailureEnvelope = {
  message?: string;
  error?: string;
  failureKind: RuntimeEnsureFailureKind;
};

const readRuntimeEnsureFailureEnvelope = (value: unknown): RuntimeEnsureFailureEnvelope | null => {
  const failureKind = readFailureKind(value);
  if (!failureKind) {
    return null;
  }

  const message = readStringProp(value, "message");
  const error = readStringProp(value, "error");

  return {
    failureKind,
    ...(message !== undefined ? { message } : {}),
    ...(error !== undefined ? { error } : {}),
  };
};

const buildRuntimeEnsureFailureSources = (error: unknown): unknown[] => {
  return [error, readUnknownProp(error, "cause")];
};

const extractRuntimeEnsureFailure = (error: unknown): NormalizedRuntimeEnsureFailure | null => {
  if (error instanceof RuntimeEnsureError) {
    return {
      message: error.message,
      failureKind: error.failureKind,
      ...(error.cause !== undefined ? { cause: error.cause } : {}),
    };
  }

  const sources = buildRuntimeEnsureFailureSources(error);
  const failureEnvelope = sources
    .map((source) => readRuntimeEnsureFailureEnvelope(source))
    .find((source): source is RuntimeEnsureFailureEnvelope => source !== null);
  if (!failureEnvelope?.failureKind) {
    return null;
  }

  const message =
    failureEnvelope.message ??
    failureEnvelope.error ??
    (error instanceof Error && error.message.trim().length > 0 ? error.message : undefined) ??
    "Failed to ensure runtime.";

  return {
    message,
    failureKind: failureEnvelope.failureKind,
    ...(error !== undefined ? { cause: error } : {}),
  };
};

const toRuntimeEnsureError = (error: unknown): RuntimeEnsureError | null => {
  const failure = extractRuntimeEnsureFailure(error);
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
  const payload = await invokeFn("system_check", { repoPath });
  return systemCheckSchema.parse(payload);
};

const runtimeCheck = async (invokeFn: InvokeFn, force = false): Promise<RuntimeCheck> => {
  const payload = await invokeFn("runtime_check", { force });
  return runtimeCheckSchema.parse(payload);
};

const taskStoreCheck = async (invokeFn: InvokeFn, repoPath: string): Promise<TaskStoreCheck> => {
  const payload = await invokeFn("task_store_check", { repoPath });
  return taskStoreCheckSchema.parse(payload);
};

const runtimeList = async (
  invokeFn: InvokeFn,
  repoPath: string | undefined,
  runtimeKind: RuntimeKind,
): Promise<RuntimeInstanceSummary[]> => {
  const payload = await invokeFn("runtime_list", { repoPath, runtimeKind });
  return parseArray(runtimeInstanceSummarySchema, payload, "runtime_list");
};

const runtimeDefinitionsList = async (invokeFn: InvokeFn): Promise<RuntimeDescriptor[]> => {
  const payload = await invokeFn("runtime_definitions_list", {});
  return parseArray(runtimeDescriptorSchema, payload, "runtime_definitions_list");
};

const taskWorktreeGet = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<TaskWorktreeSummary | null> => {
  const payload = await invokeFn("task_worktree_get", {
    repoPath,
    taskId,
  });
  return taskWorktreeSummarySchema.nullable().parse(payload);
};

const runtimeStop = async (invokeFn: InvokeFn, runtimeId: string): Promise<{ ok: boolean }> => {
  const payload = await invokeFn("runtime_stop", {
    runtimeId,
  });
  return parseOkResult(payload, "runtime_stop");
};

const runtimeEnsure = async (
  invokeFn: InvokeFn,
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<RuntimeInstanceSummary> => {
  try {
    const payload = await invokeFn("runtime_ensure", {
      repoPath,
      runtimeKind,
    });
    return runtimeInstanceSummarySchema.parse(payload);
  } catch (error) {
    throw toRuntimeEnsureError(error) ?? error;
  }
};

const runtimeRequire = async (
  invokeFn: InvokeFn,
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<RuntimeInstanceSummary> => {
  const payload = await invokeFn("runtime_require", {
    repoPath,
    runtimeKind,
  });
  return runtimeInstanceSummarySchema.parse(payload);
};

const repoRuntimeHealth = async (
  invokeFn: InvokeFn,
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<RepoRuntimeHealthCheck> => {
  const payload = await invokeFn("repo_runtime_health", {
    repoPath,
    runtimeKind,
  });
  return repoRuntimeHealthCheckSchema.parse(payload);
};

const repoRuntimeHealthStatus = async (
  invokeFn: InvokeFn,
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<RepoRuntimeHealthCheck> => {
  const payload = await invokeFn("repo_runtime_health_status", {
    repoPath,
    runtimeKind,
  });
  return repoRuntimeHealthCheckSchema.parse(payload);
};

const codexAppServerRequest = async (
  invokeFn: InvokeFn,
  runtimeId: string,
  method: string,
  params?: unknown,
): Promise<unknown> => {
  return invokeFn("codex_app_server_request", {
    runtimeId,
    method,
    ...(params !== undefined ? { params } : {}),
  });
};

const codexAppServerRespond = async (
  invokeFn: InvokeFn,
  runtimeId: string,
  requestId: CodexAppServerRequestId,
  result?: unknown,
  error?: unknown,
): Promise<void> => {
  await invokeFn("codex_app_server_respond", {
    runtimeId,
    requestId,
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  });
};

const parseCodexAppServerBufferedEvent = (value: unknown): CodexAppServerBufferedEvent => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected Codex app-server buffered event payload");
  }

  const event = value as {
    runtimeId?: unknown;
    kind?: unknown;
    message?: unknown;
    receivedAt?: unknown;
  };
  if (typeof event.runtimeId !== "string" || event.runtimeId.trim().length === 0) {
    throw new Error("Expected Codex app-server buffered event runtimeId");
  }
  if (event.kind !== "notification" && event.kind !== "server_request") {
    throw new Error("Expected Codex app-server buffered event kind");
  }
  if (typeof event.receivedAt !== "string" || event.receivedAt.trim().length === 0) {
    throw new Error("Expected Codex app-server buffered event receivedAt");
  }
  if (!("message" in value)) {
    throw new Error("Expected Codex app-server buffered event message");
  }

  return {
    runtimeId: event.runtimeId,
    kind: event.kind,
    message: event.message,
    receivedAt: event.receivedAt,
  };
};

const takeCodexAppServerBufferedEvents = async (
  invokeFn: InvokeFn,
  runtimeId: string,
): Promise<CodexAppServerBufferedEvent[]> => {
  const payload = await invokeFn("codex_app_server_take_buffered_events", { runtimeId });
  return parseArray(
    { parse: parseCodexAppServerBufferedEvent },
    payload,
    "codex_app_server_take_buffered_events",
  );
};

const buildStart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  runtimeKind: RuntimeKind,
): Promise<BuildSessionBootstrap> => {
  const payload = await invokeFn("build_start", { repoPath, taskId, runtimeKind });
  return buildSessionBootstrapSchema.parse(payload);
};

const taskSessionBootstrapPrepare = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  role: AgentRole,
  runtimeKind: RuntimeKind,
  targetWorkingDirectory?: string,
): Promise<TaskSessionBootstrap> => {
  const payload = await invokeFn("task_session_bootstrap_prepare", {
    repoPath,
    taskId,
    role,
    runtimeKind,
    ...(targetWorkingDirectory ? { targetWorkingDirectory } : {}),
  });
  return taskSessionBootstrapSchema.parse(payload);
};

const finalizeTaskSessionBootstrap = async (
  invokeFn: InvokeFn,
  command: "task_session_bootstrap_complete" | "task_session_bootstrap_abort",
  repoPath: string,
  taskId: string,
  bootstrapId: string,
): Promise<void> => {
  await invokeFn(command, { repoPath, taskId, bootstrapId });
};

const devServerGetState = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<DevServerGroupState> => {
  const payload = await invokeFn("dev_server_get_state", { repoPath, taskId });
  return devServerGroupStateSchema.parse(payload);
};

const devServerStart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<DevServerGroupState> => {
  const payload = await invokeFn("dev_server_start", { repoPath, taskId });
  return devServerGroupStateSchema.parse(payload);
};

const devServerStop = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<DevServerGroupState> => {
  const payload = await invokeFn("dev_server_stop", { repoPath, taskId });
  return devServerGroupStateSchema.parse(payload);
};

const devServerRestart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<DevServerGroupState> => {
  const payload = await invokeFn("dev_server_restart", { repoPath, taskId });
  return devServerGroupStateSchema.parse(payload);
};

const buildBlocked = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  reason: string,
): Promise<TaskCard> => {
  const payload = await invokeFn("build_blocked", {
    repoPath,
    taskId,
    reason,
  });
  return taskCardSchema.parse(payload);
};

const buildResumed = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<TaskCard> => {
  const payload = await invokeFn("build_resumed", {
    repoPath,
    taskId,
  });
  return taskCardSchema.parse(payload);
};

const buildCompleted = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  summary?: string,
): Promise<TaskCard> => {
  const payload = await invokeFn("build_completed", {
    repoPath,
    taskId,
    input: { summary },
  });
  return taskCardSchema.parse(payload);
};

const humanRequestChanges = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  note?: string,
): Promise<TaskCard> => {
  const payload = await invokeFn("human_request_changes", {
    repoPath,
    taskId,
    note,
  });
  return taskCardSchema.parse(payload);
};

const humanApprove = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<TaskCard> => {
  const payload = await invokeFn("human_approve", {
    repoPath,
    taskId,
  });
  return taskCardSchema.parse(payload);
};

const taskApprovalContextGet = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<TaskApprovalContextLoadResult> => {
  const payload = await invokeFn("task_approval_context_get", {
    repoPath,
    taskId,
  });
  return taskApprovalContextLoadResultSchema.parse(payload);
};

const taskDirectMerge = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  input: TaskDirectMergeInput,
): Promise<TaskDirectMergeResult> => {
  const parsedInput = taskDirectMergeInputSchema.parse(input);
  const payload = await invokeFn("task_direct_merge", {
    repoPath,
    taskId,
    input: parsedInput,
  });
  return taskDirectMergeResultSchema.parse(payload);
};

const taskDirectMergeComplete = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<TaskCard> => {
  const payload = await invokeFn("task_direct_merge_complete", {
    repoPath,
    taskId,
  });
  return taskCardSchema.parse(payload);
};

const taskPullRequestUpsert = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  title: string,
  body: string,
) => {
  const payload = await invokeFn("task_pull_request_upsert", {
    repoPath,
    taskId,
    input: { title, body },
  });
  return pullRequestSchema.parse(payload);
};

const taskPullRequestUnlink = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<{ ok: boolean }> => {
  const payload = await invokeFn("task_pull_request_unlink", { repoPath, taskId });
  return parseOkResult(payload, "task_pull_request_unlink");
};

const taskPullRequestDetect = async (invokeFn: InvokeFn, repoPath: string, taskId: string) => {
  const payload = await invokeFn("task_pull_request_detect", { repoPath, taskId });
  return taskPullRequestDetectResultSchema.parse(payload);
};

const taskPullRequestLinkMerged = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  pullRequest: PullRequest,
) => {
  const payload = await invokeFn("task_pull_request_link_merged", {
    repoPath,
    taskId,
    pullRequest,
  });
  return taskCardSchema.parse(payload);
};

const repoPullRequestSync = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<{ ok: boolean }> => {
  const payload = await invokeFn("repo_pull_request_sync", { repoPath });
  return parseOkResult(payload, "repo_pull_request_sync");
};

const agentSessionStop = async (
  invokeFn: InvokeFn,
  target: AgentSessionStopTarget,
): Promise<{ ok: boolean }> => {
  const payload = await invokeFn("agent_session_stop", {
    request: agentSessionStopTargetSchema.parse(target),
  });
  return parseOkResult(payload, "agent_session_stop");
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

  async codexAppServerRequest(
    runtimeId: string,
    method: string,
    params?: unknown,
  ): Promise<unknown> {
    return codexAppServerRequest(this.invokeFn, runtimeId, method, params);
  }

  async codexAppServerRespond(
    runtimeId: string,
    requestId: CodexAppServerRequestId,
    result?: unknown,
    error?: unknown,
  ): Promise<void> {
    return codexAppServerRespond(this.invokeFn, runtimeId, requestId, result, error);
  }

  async takeCodexAppServerBufferedEvents(
    runtimeId: string,
  ): Promise<CodexAppServerBufferedEvent[]> {
    return takeCodexAppServerBufferedEvents(this.invokeFn, runtimeId);
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
