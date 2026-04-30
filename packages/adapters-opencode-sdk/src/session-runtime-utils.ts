import type { AgentRole, AgentScenario, StartAgentSessionInput } from "@openducktor/core";
import type { SessionInput } from "./types";

type SessionInputSource = Omit<StartAgentSessionInput, "sessionId" | "role" | "scenario"> & {
  role: AgentRole | null;
  scenario: AgentScenario | null;
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
    scenario: input.scenario,
    systemPrompt: input.systemPrompt,
    runtimeKind: input.runtimeKind,
    ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
    ...(input.runtimeConnection ? { runtimeConnection: input.runtimeConnection } : {}),
    ...(input.model ? { model: input.model } : {}),
  };
};
