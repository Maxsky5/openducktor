import type { AgentChatThreadSession } from "@/components/features/agents/agent-chat/agent-chat.types";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { toSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentStudioSelectedSessionState } from "./selected-session/selected-session-state";

export const toSelectedSessionThreadSession = ({
  identity,
  activityState,
  loadedSession,
}: Pick<
  AgentStudioSelectedSessionState,
  "identity" | "activityState" | "loadedSession"
>): AgentChatThreadSession | null => {
  if (!identity || !loadedSession || !matchesAgentSessionIdentity(loadedSession, identity)) {
    return null;
  }

  return {
    ...identity,
    ...(loadedSession.title ? { title: loadedSession.title } : {}),
    activityState,
    runtimeStatusMessage: loadedSession.runtimeStatusMessage,
    messages: toSessionMessagesState(loadedSession),
  };
};
