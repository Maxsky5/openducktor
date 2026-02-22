import type { StartAgentSessionInput } from "@openducktor/core";
import type { SessionInput } from "./types";

export const toIsoFromEpoch = (value: unknown, fallback: () => string): string => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback();
  }
  const iso = new Date(value).toISOString();
  return Number.isNaN(new Date(iso).getTime()) ? fallback() : iso;
};

export const toSessionInput = (
  input: Omit<StartAgentSessionInput, "sessionId"> & { sessionId: string },
): SessionInput => {
  return {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    taskId: input.taskId,
    role: input.role,
    scenario: input.scenario,
    systemPrompt: input.systemPrompt,
    baseUrl: input.baseUrl,
    ...(input.model ? { model: input.model } : {}),
    sessionId: input.sessionId,
  };
};
