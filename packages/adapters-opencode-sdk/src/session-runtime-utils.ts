import { hasRuntimeType } from "@openducktor/contracts";
import type { JsonValue } from "@openducktor/contracts";
import type { PolicyBoundSessionRef, StartAgentSessionInput } from "@openducktor/core";
import { toAgentRuntimePolicyBinding } from "@openducktor/core";
import type { SessionInput } from "./types";

type SessionInputSource = StartAgentSessionInput | PolicyBoundSessionRef;

export const toIsoFromEpoch = (value: JsonValue | undefined, fallback: () => string): string => {
  if (!hasRuntimeType(value, "number") || Number.isNaN(value)) {
    return fallback();
  }
  const iso = new Date(value).toISOString();
  return Number.isNaN(new Date(iso).getTime()) ? fallback() : iso;
};

export const toSessionInput = (input: SessionInputSource): SessionInput => {
  const sessionScope = "sessionScope" in input ? input.sessionScope : undefined;
  return {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    systemPrompt: input.systemPrompt ?? "",
    ...toAgentRuntimePolicyBinding(input),
    ...(sessionScope ? { sessionScope } : undefined),
    ...(input.model ? { model: input.model } : undefined),
  };
};
