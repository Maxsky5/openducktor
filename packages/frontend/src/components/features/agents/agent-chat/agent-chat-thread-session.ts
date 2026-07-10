import { workflowAgentSessionScope } from "@openducktor/core";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { toSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "./agent-chat.types";

export const toAgentChatThreadSession = (session: AgentSessionState): AgentChatThreadSession => ({
  ...toAgentSessionIdentity(session),
  ...(session.title ? { title: session.title } : {}),
  ...(session.role
    ? { sessionScope: workflowAgentSessionScope(session.taskId, session.role) }
    : {}),
  activityState: getAgentSessionActivityStateFromSession(session),
  runtimeStatusMessage: session.runtimeStatusMessage,
  messages: toSessionMessagesState(session),
});
