import type { AgentSessionState } from "@/types/agent-orchestrator";

type RuntimeAttachmentState = Pick<AgentSessionState, "runtimeId">;

export const hasAttachedSessionRuntime = (
  session: RuntimeAttachmentState | null | undefined,
): boolean => {
  if (!session) {
    return false;
  }

  return !!session.runtimeId;
};
