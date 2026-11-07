import { workflowAgentSessionScope } from "@openducktor/core";
import type { AgentChatTranscriptSession } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript.types";
import type { AgentSessionTranscriptTarget } from "@openducktor/frontend-core/sessions/transcript/agent-session-transcript-target";
import { matchesAgentSessionIdentity } from "@openducktor/frontend-core/lib/agent-session-identity";
import { toSessionMessagesState } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentStudioSelectedSessionState } from "./selected-session/selected-session-state";
import type { WorkflowRoleId as AgentRole } from "@openducktor/workflows";

export const toAgentStudioTranscriptTarget = ({
  identity,
  workspaceId,
  taskId,
  role,
}: {
  identity: AgentSessionIdentity | null;
  workspaceId: string | null;
  taskId: string;
  role: AgentRole | null;
}): AgentSessionTranscriptTarget | null => {
  if (!identity || !workspaceId || !role) {
    return null;
  }

  return {
    ...identity,
    sessionScope: workflowAgentSessionScope(workspaceId, taskId, role),
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
