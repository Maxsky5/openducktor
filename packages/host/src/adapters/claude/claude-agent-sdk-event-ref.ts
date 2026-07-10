import { type AgentEvent, type SessionRef, withAgentSessionRef } from "@openducktor/core";
import type { ClaudeSessionContext } from "./claude-agent-sdk-types";
import { claudeSessionRef } from "./claude-agent-sdk-utils";

export const withClaudeAgentSessionEventRef = (
  session: ClaudeSessionContext,
  event: AgentEvent,
): ReturnType<typeof withAgentSessionRef> => {
  const ref: SessionRef = {
    ...claudeSessionRef(session),
    externalSessionId: event.externalSessionId,
  };
  return withAgentSessionRef(ref, event);
};
