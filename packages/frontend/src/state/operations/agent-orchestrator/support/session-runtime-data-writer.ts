import type { AgentSessionRef, AgentSessionTodoItem } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { agentSessionRuntimeQueryKeys } from "@/state/queries/agent-session-runtime";

type SessionTodosUpdater = (current: AgentSessionTodoItem[]) => AgentSessionTodoItem[];

export type SessionRuntimeDataWriter = {
  updateTodos: (session: AgentSessionRef, updater: SessionTodosUpdater) => void;
};

export const createSessionRuntimeDataWriter = (
  queryClient: QueryClient,
): SessionRuntimeDataWriter => ({
  updateTodos(session, updater): void {
    const queryKey = agentSessionRuntimeQueryKeys.todos(session);
    const current = queryClient.getQueryData<AgentSessionTodoItem[]>(queryKey) ?? [];
    queryClient.setQueryData(queryKey, updater(current));
  },
});
