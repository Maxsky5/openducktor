import {
  type AgentRuntimeStartRole,
  type AgentRuntimeSummary,
  agentRuntimeSummarySchema,
  type BeadsCheck,
  beadsCheckSchema,
  type RunSummary,
  type RuntimeCheck,
  runSummarySchema,
  runtimeCheckSchema,
  type SystemCheck,
  systemCheckSchema,
  type TaskCard,
  taskCardSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { parseArray } from "./invoke-utils";

export type RuntimeRole = AgentRuntimeStartRole;
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

export const opencodeRuntimeList = async (
  invokeFn: InvokeFn,
  repoPath?: string,
): Promise<AgentRuntimeSummary[]> => {
  const payload = await invokeFn<unknown>("opencode_runtime_list", { repoPath });
  return parseArray(agentRuntimeSummarySchema, payload);
};

export const opencodeRuntimeStart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  role: RuntimeRole,
): Promise<AgentRuntimeSummary> => {
  const payload = await invokeFn<unknown>("opencode_runtime_start", {
    repoPath,
    taskId,
    role,
  });
  return agentRuntimeSummarySchema.parse(payload);
};

export const opencodeRuntimeStop = async (
  invokeFn: InvokeFn,
  runtimeId: string,
): Promise<{ ok: boolean }> => {
  return invokeFn<{ ok: boolean }>("opencode_runtime_stop", {
    runtimeId,
  });
};

export const opencodeRepoRuntimeEnsure = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<AgentRuntimeSummary> => {
  const payload = await invokeFn<unknown>("opencode_repo_runtime_ensure", {
    repoPath,
  });
  return agentRuntimeSummarySchema.parse(payload);
};

export const buildStart = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<RunSummary> => {
  const payload = await invokeFn<unknown>("build_start", { repoPath, taskId });
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

  async opencodeRuntimeList(repoPath?: string): Promise<AgentRuntimeSummary[]> {
    return opencodeRuntimeList(this.invokeFn, repoPath);
  }

  async opencodeRuntimeStart(
    repoPath: string,
    taskId: string,
    role: RuntimeRole,
  ): Promise<AgentRuntimeSummary> {
    return opencodeRuntimeStart(this.invokeFn, repoPath, taskId, role);
  }

  async opencodeRuntimeStop(runtimeId: string): Promise<{ ok: boolean }> {
    return opencodeRuntimeStop(this.invokeFn, runtimeId);
  }

  async opencodeRepoRuntimeEnsure(repoPath: string): Promise<AgentRuntimeSummary> {
    return opencodeRepoRuntimeEnsure(this.invokeFn, repoPath);
  }

  async buildStart(repoPath: string, taskId: string): Promise<RunSummary> {
    return buildStart(this.invokeFn, repoPath, taskId);
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
