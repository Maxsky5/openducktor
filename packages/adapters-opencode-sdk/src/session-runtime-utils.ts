import type { PolicyBoundSessionRef, StartAgentSessionInput } from "@openducktor/core";
import { toAgentRuntimePolicyBinding } from "@openducktor/core";
import type { SessionInput } from "./types";

type SessionInputSource = StartAgentSessionInput | PolicyBoundSessionRef;

export const toIsoFromEpoch = (value: number | undefined, fallback: () => string): string => {
  if (value === undefined || Number.isNaN(value)) {
    return fallback();
  }
  const iso = new Date(value).toISOString();
  return Number.isNaN(new Date(iso).getTime()) ? fallback() : iso;
};

export const toSessionInput = (input: SessionInputSource): SessionInput => {
  const sessionScope = "sessionScope" in input ? input.sessionScope : undefined;
  const sessionInput: SessionInput = {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    systemPrompt: input.systemPrompt ?? "",
    ...toAgentRuntimePolicyBinding(input),
  };
  if (sessionScope) {
    sessionInput.sessionScope = sessionScope;
  }
  if (input.model) {
    sessionInput.model = input.model;
  }
  return sessionInput;
};
