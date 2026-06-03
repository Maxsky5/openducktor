import type { RuntimeRef } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type RuntimeRefSource =
  | {
      runtimeKind: AgentSessionState["runtimeKind"] | null | undefined;
      runtimeId: AgentSessionState["runtimeId"] | null | undefined;
    }
  | null
  | undefined;

export const toRuntimeRef = (source: RuntimeRefSource): RuntimeRef | null => {
  if (!source?.runtimeKind || !source.runtimeId) {
    return null;
  }
  return {
    kind: source.runtimeKind,
    runtimeId: source.runtimeId,
  };
};
