import type { AgentSessionRuntimeRef, StartAgentSessionInput } from "@openducktor/core";
import { toAgentRuntimePolicyBinding } from "@openducktor/core";
import type { SessionInput } from "./types";

type SessionInputSource = StartAgentSessionInput | AgentSessionRuntimeRef;

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
    sessionScope: input.sessionScope,
    systemPrompt: input.systemPrompt ?? "",
    ...toAgentRuntimePolicyBinding(input),
    ...(input.model ? { model: input.model } : {}),
  };
};
