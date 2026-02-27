import {
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
  role: "spec" | "planner" | "qa",
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
  action: "approve" | "deny" | "message",
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
  mode: "success" | "failure",
): Promise<{ ok: boolean }> => {
  return invokeFn<{ ok: boolean }>("build_cleanup", { runId, mode });
};
