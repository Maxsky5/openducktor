import type { RuntimeDescriptor } from "@openducktor/contracts";
import { runtimeSupportsCapability } from "./agent-runtime";
import { isAgentSessionActivityActive } from "./agent-session-activity-state";
import type { OptionalAgentSessionActivityState } from "@/types/agent-session-activity";
import type { AgentChatMessage } from "@/types/agent-orchestrator";

/**
 * True when the transcript holds a user turn whose latest assistant reply is not final.
 * Tool output, partial assistant text, an interruption notice, and an error notice do not
 * make the turn complete.
 */
export const hasUnfinishedLatestTurn = (messages: readonly AgentChatMessage[]): boolean => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (message.role === "user") {
      return true;
    }
    if (message.role === "assistant" && message.meta?.kind === "assistant") {
      if (message.meta.isFinal === true) {
        return false;
      }
    }
  }
  return false;
};

export const canResumeInterruptedTurn = ({
  activityState,
  messages,
  runtimeDescriptor,
}: {
  activityState: OptionalAgentSessionActivityState;
  messages: readonly AgentChatMessage[];
  runtimeDescriptor: RuntimeDescriptor | null;
}): boolean => {
  if (activityState === null || isAgentSessionActivityActive(activityState)) {
    return false;
  }
  if (
    !runtimeDescriptor ||
    !runtimeSupportsCapability(runtimeDescriptor, "sessionLifecycle.supportsInterruptedTurnResume")
  ) {
    return false;
  }
  return hasUnfinishedLatestTurn(messages);
};
