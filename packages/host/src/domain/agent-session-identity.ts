import { normalizePathForComparison } from "./path-comparison";

export type AgentSessionIdentityFields = {
  externalSessionId: string;
  runtimeKind: string;
  workingDirectory: string;
};

export const hasSameAgentSessionIdentity = (
  left: AgentSessionIdentityFields,
  right: AgentSessionIdentityFields,
): boolean =>
  left.externalSessionId.trim() === right.externalSessionId.trim() &&
  left.runtimeKind.trim() === right.runtimeKind.trim() &&
  normalizePathForComparison(left.workingDirectory) ===
    normalizePathForComparison(right.workingDirectory);
