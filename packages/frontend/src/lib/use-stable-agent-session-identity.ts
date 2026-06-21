import { useMemo } from "react";
import {
  type AgentSessionIdentityLike,
  toAgentSessionIdentity,
} from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export const useStableAgentSessionIdentity = (
  identity: AgentSessionIdentityLike | null | undefined,
): AgentSessionIdentity | null => {
  const externalSessionId = identity?.externalSessionId ?? null;
  const runtimeKind = identity?.runtimeKind ?? null;
  const workingDirectory = identity?.workingDirectory ?? null;

  return useMemo(() => {
    if (externalSessionId === null || runtimeKind === null || workingDirectory === null) {
      return null;
    }

    return toAgentSessionIdentity({
      externalSessionId,
      runtimeKind,
      workingDirectory,
    });
  }, [externalSessionId, runtimeKind, workingDirectory]);
};
