import type { AgentSessionTodoItem } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "./agent-chat.types";

export const toAgentChatThreadSession = (
  session: AgentSessionState,
  todos: AgentSessionTodoItem[],
): AgentChatThreadSession => ({
  externalSessionId: session.externalSessionId,
  ...(session.title ? { title: session.title } : {}),
  status: session.status,
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
  messages: session.messages,
  pendingApprovals: session.pendingApprovals,
  pendingQuestions: session.pendingQuestions,
  selectedModel: session.selectedModel,
  todos,
});
