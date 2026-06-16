import type { AgentSessionTodoItem } from "@openducktor/core";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { toSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "./agent-chat.types";

export const toAgentChatThreadSession = (
  session: AgentSessionState,
  todos: AgentSessionTodoItem[],
): AgentChatThreadSession => ({
  externalSessionId: session.externalSessionId,
  ...(session.title ? { title: session.title } : {}),
  activityState: getAgentSessionActivityStateFromSession(session),
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
  messages: toSessionMessagesState(session),
  pendingApprovals: session.pendingApprovals,
  pendingQuestions: session.pendingQuestions,
  selectedModel: session.selectedModel,
  todos,
});
