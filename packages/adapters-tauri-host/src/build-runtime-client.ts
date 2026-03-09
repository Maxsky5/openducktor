import {
  type BeadsCheck,
  beadsCheckSchema,
  type QaReviewTarget,
  qaReviewTargetSchema,
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
  taskCardSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { parseArray } from "./invoke-utils";

export type BuildRespondAction = "approve" | "deny" | "message";
export type BuildCleanupMode = "success" | "failure";

export const systemCheck = async (invokeFn: InvokeFn, repoPath: string): Promise<SystemCheck> => {
  const payload = await invokeFn<unknown>("system_check", { repoPath });
  return systemCheckSchema.parse(payload);
};

export const runtimeCheck = async (invokeFn: InvokeFn, force = false): Promise<RuntimeCheck> => {
  const payload = await invokeFn<unknown>("runtime_check", { force });
  return runtimeCheckSchema.parse(payload);
};

export const beadsCheck = async (invokeFn: InvokeFn, repoPath: string): Promise<BeadsCheck> => {
  const payload = await invokeFn<unknown>("beads_check", { repoPath });
  return beadsCheckSchema.parse(payload);
};

export const runsList = async (invokeFn: InvokeFn, repoPath?: string): Promise<RunSummary[]> => {
  const payload = await invokeFn<unknown>("runs_list", { repoPath });
  return parseArray(runSummarySchema, payload);
};

export const runtimeList = async (
  invokeFn: InvokeFn,
  runtimeKind: RuntimeKind,
  repoPath?: string,
): Promise<RuntimeInstanceSummary[]> => {
  const payload = await invokeFn<unknown>("runtime_list", { repoPath, runtimeKind });
  return parseArray(runtimeInstanceSummarySchema, payload);
};

export const runtimeDefinitionsList = async (invokeFn: InvokeFn): Promise<RuntimeDescriptor[]> => {
  const payload = await invokeFn<unknown>("runtime_definitions_list", {});
  return parseArray(runtimeDescriptorSchema, payload);
};

export const qaReviewTargetGet = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<QaReviewTarget> => {
  const payload = await invokeFn<unknown>("qa_review_target_get", {
    repoPath,
    taskId,
  });
  return qaReviewTargetSchema.parse(payload);
};

export const runtimeStop = async (
  invokeFn: InvokeFn,
  runtimeId: string,
): Promise<{ ok: boolean }> => {
  return invokeFn<{ ok: boolean }>("runtime_stop", {
    runtimeId,
  });
};

export const runtimeEnsure = async (
  invokeFn: InvokeFn,
  runtimeKind: RuntimeKind,
  repoPath: string,
): Promise<RuntimeInstanceSummary> => {
  const payload = await invokeFn<unknown>("runtime_ensure", {
    runtimeKind,
    repoPath,
  });
  return runtimeInstanceSummarySchema.parse(payload);
};

export const buildStart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  runtimeKind: RuntimeKind,
): Promise<RunSummary> => {
  const payload = await invokeFn<unknown>("build_start", { repoPath, taskId, runtimeKind });
  return runSummarySchema.parse(payload);
};

export const buildBlocked = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  reason: string,
): Promise<TaskCard> => {
  const payload = await invokeFn<unknown>("build_blocked", {
    repoPath,
    taskId,
    reason,
  });
  return taskCardSchema.parse(payload);
};

export const buildResumed = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<TaskCard> => {
  const payload = await invokeFn<unknown>("build_resumed", {
    repoPath,
    taskId,
  });
  return taskCardSchema.parse(payload);
};

export const buildCompleted = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  summary?: string,
): Promise<TaskCard> => {
  const payload = await invokeFn<unknown>("build_completed", {
    repoPath,
    taskId,
    input: { summary },
  });
  return taskCardSchema.parse(payload);
};

export const humanRequestChanges = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  note?: string,
): Promise<TaskCard> => {
  const payload = await invokeFn<unknown>("human_request_changes", {
    repoPath,
    taskId,
    note,
  });
  return taskCardSchema.parse(payload);
};

export const humanApprove = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<TaskCard> => {
  const payload = await invokeFn<unknown>("human_approve", {
    repoPath,
    taskId,
  });
  return taskCardSchema.parse(payload);
};

export const buildRespond = async (
  invokeFn: InvokeFn,
  runId: string,
  action: BuildRespondAction,
  payload?: string,
): Promise<{ ok: boolean }> => {
  return invokeFn<{ ok: boolean }>("build_respond", { runId, action, payload });
};

export const buildStop = async (invokeFn: InvokeFn, runId: string): Promise<{ ok: boolean }> => {
  return invokeFn<{ ok: boolean }>("build_stop", { runId });
};

export const buildCleanup = async (
  invokeFn: InvokeFn,
  runId: string,
  mode: BuildCleanupMode,
): Promise<{ ok: boolean }> => {
  return invokeFn<{ ok: boolean }>("build_cleanup", { runId, mode });
};

export class TauriAgentClient {
  constructor(private readonly invokeFn: InvokeFn) {}

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
    runtimeKind: RuntimeKind,
    repoPath?: string,
  ): Promise<RuntimeInstanceSummary[]> {
    return runtimeList(this.invokeFn, runtimeKind, repoPath);
  }

  async runtimeDefinitionsList(): Promise<RuntimeDescriptor[]> {
    return runtimeDefinitionsList(this.invokeFn);
  }

  async qaReviewTargetGet(repoPath: string, taskId: string): Promise<QaReviewTarget> {
    return qaReviewTargetGet(this.invokeFn, repoPath, taskId);
  }

  async runtimeStop(runtimeId: string): Promise<{ ok: boolean }> {
    return runtimeStop(this.invokeFn, runtimeId);
  }

  async runtimeEnsure(runtimeKind: RuntimeKind, repoPath: string): Promise<RuntimeInstanceSummary> {
    return runtimeEnsure(this.invokeFn, runtimeKind, repoPath);
  }

  async buildStart(
    repoPath: string,
    taskId: string,
    runtimeKind: RuntimeKind,
  ): Promise<RunSummary> {
    return buildStart(this.invokeFn, repoPath, taskId, runtimeKind);
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

  async buildRespond(
    runId: string,
    action: BuildRespondAction,
    payload?: string,
  ): Promise<{ ok: boolean }> {
    return buildRespond(this.invokeFn, runId, action, payload);
  }

  async buildStop(runId: string): Promise<{ ok: boolean }> {
    return buildStop(this.invokeFn, runId);
  }

  async buildCleanup(runId: string, mode: BuildCleanupMode): Promise<{ ok: boolean }> {
    return buildCleanup(this.invokeFn, runId, mode);
  }
}
