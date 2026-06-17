import type { AgentSessionTodoItem } from "@openducktor/core";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { toSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "./agent-chat.types";

export const toAgentChatThreadSession = (
  session: AgentSessionState,
  todos: AgentSessionTodoItem[],
): AgentChatThreadSession => ({
  ...toAgentSessionIdentity(session),
  ...(session.title ? { title: session.title } : {}),
  activityState: getAgentSessionActivityStateFromSession(session),
  messages: toSessionMessagesState(session),
  pendingApprovals: session.pendingApprovals,
  pendingQuestions: session.pendingQuestions,
  selectedModel: session.selectedModel,
  todos,
});
