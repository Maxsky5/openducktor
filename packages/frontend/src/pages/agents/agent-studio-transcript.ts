import { workflowAgentSessionScope } from "@openducktor/core";
import type { AgentChatTranscriptSession } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript.types";
import type { AgentSessionTranscriptTarget } from "@openducktor/frontend-core/sessions/transcript/agent-session-transcript-target";
import { matchesAgentSessionIdentity } from "@openducktor/frontend-core/lib/agent-session-identity";
import { toSessionMessagesState } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentStudioSelectedSessionState } from "./selected-session/selected-session-state";
import type { BuiltinRoleId as AgentRole } from "@openducktor/workflows";

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

  const transcriptSession: AgentChatTranscriptSession = {
    ...identity,
    activityState,
    runtimeStatusMessage: loadedSession.runtimeStatusMessage,
    messages: toSessionMessagesState(loadedSession),
    pendingQuestions: loadedSession.pendingQuestions,
  };
  if (loadedSession.title) {
    transcriptSession.title = loadedSession.title;
  }
  return transcriptSession;
};
