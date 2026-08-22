import type { AgentRole } from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import type { AgentChatTranscriptSession } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentSessionTranscriptTarget } from "@/components/features/agents/agent-chat/agent-session-transcript-target";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { toSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentStudioSelectedSessionState } from "./selected-session/selected-session-state";

export const toAgentStudioTranscriptTarget = ({
  identity,
  taskId,
  role,
}: {
  identity: AgentSessionIdentity | null;
  taskId: string;
  role: AgentRole;
}): AgentSessionTranscriptTarget | null => {
  if (!identity) {
    return null;
  }

  return {
    ...identity,
    sessionScope: workflowAgentSessionScope(taskId, role),
  };
};

export const toAgentStudioTranscriptSession = ({
  identity,
  activityState,
  loadedSession,
}: Pick<
  AgentStudioSelectedSessionState,
  "identity" | "activityState" | "loadedSession"
>): AgentChatTranscriptSession | null => {
  if (!identity || !loadedSession || !matchesAgentSessionIdentity(loadedSession, identity)) {
    return null;
  }

  return {
    ...identity,
    ...(() => {
      if (loadedSession.title) {
        return { title: loadedSession.title };
      }
      return {};
    })(),
    activityState,
    runtimeStatusMessage: loadedSession.runtimeStatusMessage,
    messages: toSessionMessagesState(loadedSession),
  };
};
