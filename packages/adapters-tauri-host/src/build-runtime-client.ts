import {
  type BeadsCheck,
  type BuildContinuationTarget,
  beadsCheckSchema,
  buildContinuationTargetSchema,
  type DevServerGroupState,
  devServerGroupStateSchema,
  type PullRequest,
  pullRequestSchema,
  type RunSummary,
  type RuntimeCheck,
  type RuntimeDescriptor,
  type RuntimeInstanceSummary,
  type RuntimeKind,
  runSummarySchema,
  runtimeCheckSchema,
  runtimeDescriptorSchema,
  runtimeInstanceSummarySchema,
  type SystemCheck,
  systemCheckSchema,
  type TaskCard,
  type TaskDirectMergeInput,
  type TaskDirectMergeResult,
  taskApprovalContextSchema,
  taskCardSchema,
  taskDirectMergeInputSchema,
  taskDirectMergeResultSchema,
  taskPullRequestDetectResultSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { parseArray, parseOkResult } from "./invoke-utils";
import type { TaskMetadataCache } from "./task-metadata-cache";

export type BuildCleanupMode = "success" | "failure";
export type BuildRespondInput =
  | { action: "approve" }
  | { action: "deny" }
  | { action: "message"; message: string };

type RuntimeEnsureFailureKind = "timeout" | "error";

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
  if (!value || typeof value !== "object") {
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
  return candidate === "timeout" || candidate === "error" ? candidate : undefined;
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
  const failureSource = sources.find((source) => readFailureKind(source) !== undefined);
  const failureKind = failureSource ? readFailureKind(failureSource) : undefined;
  if (!failureKind) {
    return null;
  }

  const message =
    readStringProp(failureSource, "message") ??
    readStringProp(failureSource, "error") ??
    (error instanceof Error && error.message.trim().length > 0 ? error.message : undefined) ??
    "Failed to ensure runtime.";

  return {
    message,
    failureKind,
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

const beadsCheck = async (invokeFn: InvokeFn, repoPath: string): Promise<BeadsCheck> => {
  const payload = await invokeFn("beads_check", { repoPath });
  return beadsCheckSchema.parse(payload);
};

const runsList = async (invokeFn: InvokeFn, repoPath?: string): Promise<RunSummary[]> => {
  const payload = await invokeFn("runs_list", { repoPath });
  return parseArray(runSummarySchema, payload, "runs_list");
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

const buildContinuationTargetGet = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<BuildContinuationTarget | null> => {
  const payload = await invokeFn("build_continuation_target_get", {
    repoPath,
    taskId,
  });
  return buildContinuationTargetSchema.nullable().parse(payload);
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

const buildStart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  runtimeKind: RuntimeKind,
): Promise<RunSummary> => {
  const payload = await invokeFn("build_start", { repoPath, taskId, runtimeKind });
  return runSummarySchema.parse(payload);
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

const taskApprovalContextGet = async (invokeFn: InvokeFn, repoPath: string, taskId: string) => {
  const payload = await invokeFn("task_approval_context_get", {
    repoPath,
    taskId,
  });
  return taskApprovalContextSchema.parse(payload);
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

const buildRespond = async (
  invokeFn: InvokeFn,
  runId: string,
  input: BuildRespondInput,
): Promise<{ ok: boolean }> => {
  const response = await invokeFn("build_respond", {
    runId,
    action: input.action,
    ...(input.action === "message" ? { payload: input.message } : {}),
  });
  return parseOkResult(response, "build_respond");
};

const buildStop = async (invokeFn: InvokeFn, runId: string): Promise<{ ok: boolean }> => {
  const payload = await invokeFn("build_stop", { runId });
  return parseOkResult(payload, "build_stop");
};

const buildCleanup = async (
  invokeFn: InvokeFn,
  runId: string,
  mode: BuildCleanupMode,
): Promise<{ ok: boolean }> => {
  const payload = await invokeFn("build_cleanup", { runId, mode });
  return parseOkResult(payload, "build_cleanup");
};

export class TauriAgentClient {
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

  async beadsCheck(repoPath: string): Promise<BeadsCheck> {
    return beadsCheck(this.invokeFn, repoPath);
  }

  async runsList(repoPath?: string): Promise<RunSummary[]> {
    return runsList(this.invokeFn, repoPath);
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

  async buildContinuationTargetGet(
    repoPath: string,
    taskId: string,
  ): Promise<BuildContinuationTarget | null> {
    return buildContinuationTargetGet(this.invokeFn, repoPath, taskId);
  }

  async runtimeStop(runtimeId: string): Promise<{ ok: boolean }> {
    return runtimeStop(this.invokeFn, runtimeId);
  }

  async runtimeEnsure(repoPath: string, runtimeKind: RuntimeKind): Promise<RuntimeInstanceSummary> {
    return runtimeEnsure(this.invokeFn, repoPath, runtimeKind);
  }

  async buildStart(
    repoPath: string,
    taskId: string,
    runtimeKind: RuntimeKind,
  ): Promise<RunSummary> {
    return buildStart(this.invokeFn, repoPath, taskId, runtimeKind);
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

  async taskApprovalContextGet(repoPath: string, taskId: string) {
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

  async buildRespond(runId: string, input: BuildRespondInput): Promise<{ ok: boolean }> {
    return buildRespond(this.invokeFn, runId, input);
  }

  async buildStop(runId: string): Promise<{ ok: boolean }> {
    return buildStop(this.invokeFn, runId);
  }

  async buildCleanup(runId: string, mode: BuildCleanupMode): Promise<{ ok: boolean }> {
    return buildCleanup(this.invokeFn, runId, mode);
  }
}
