import type { AgentRole, StartAgentSessionInput } from "@openducktor/core";
import type { SessionInput } from "./types";

type SessionInputSource = Omit<StartAgentSessionInput, "role"> & {
  role: AgentRole | null;
};

export const toIsoFromEpoch = (value: unknown, fallback: () => string): string => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback();
  }
  const iso = new Date(value).toISOString();
  return Number.isNaN(new Date(iso).getTime()) ? fallback() : iso;
};

export const toSessionInput = (input: SessionInputSource): SessionInput => {
  return {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    taskId: input.taskId,
    role: input.role,
    systemPrompt: input.systemPrompt,
    runtimeKind: input.runtimeKind,
    ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
    ...(input.model ? { model: input.model } : {}),
  };
};
