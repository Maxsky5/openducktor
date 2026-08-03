import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { toSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";
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
): AgentChatTranscriptSession => ({
  ...toAgentSessionIdentity(session),
  ...(session.title ? { title: session.title } : {}),
  activityState: getAgentSessionActivityStateFromSession(session),
  runtimeStatusMessage: session.runtimeStatusMessage,
  messages: toSessionMessagesState(session),
});
