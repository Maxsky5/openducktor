import { getAgentSessionActivityStateFromSession } from "@openducktor/frontend-core/lib/agent-session-activity-state";
import { toAgentSessionIdentity } from "@openducktor/frontend-core/lib/agent-session-identity";
import { toSessionMessagesState } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentChatTranscriptSession } from "./agent-chat.types";

type AgentChatTranscriptSessionSource = Pick<
  AgentSessionState,
  | "externalSessionId"
  | "title"
  | "runtimeKind"
  | "workingDirectory"
  | "status"
  | "runtimeStatusMessage"
  | "messages"
  | "pendingApprovals"
  | "pendingQuestions"
>;

export const toAgentChatTranscriptSession = (
  session: AgentChatTranscriptSessionSource,
): AgentChatTranscriptSession => {
  const transcriptSession: AgentChatTranscriptSession = {
    ...toAgentSessionIdentity(session),
    activityState: getAgentSessionActivityStateFromSession(session),
    runtimeStatusMessage: session.runtimeStatusMessage,
    messages: toSessionMessagesState(session),
    pendingQuestions: session.pendingQuestions,
  };
  if (session.title) {
    transcriptSession.title = session.title;
  }
  return transcriptSession;
};
