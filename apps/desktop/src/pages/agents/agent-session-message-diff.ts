import { findFirstChangedSessionMessageIndex } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export const findFirstChangedMessageIndex = (
  previousMessages: AgentSessionState["messages"] | null,
  nextSession: Pick<AgentSessionState, "sessionId" | "messages">,
): number => {
  return findFirstChangedSessionMessageIndex(previousMessages, nextSession);
};
