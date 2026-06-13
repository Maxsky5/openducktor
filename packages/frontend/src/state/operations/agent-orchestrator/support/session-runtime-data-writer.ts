import type { AgentSessionRef, AgentSessionTodoItem } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { agentSessionRuntimeQueryKeys } from "@/state/queries/agent-session-runtime";

type SessionTodosUpdater = (current: AgentSessionTodoItem[]) => AgentSessionTodoItem[];

export type SessionRuntimeDataWriter = {
  updateTodos: (session: AgentSessionRef, updater: SessionTodosUpdater) => void;
};

const todosQueryKey = ({
  repoPath,
  runtimeKind,
  workingDirectory,
  externalSessionId,
}: AgentSessionRef) =>
  agentSessionRuntimeQueryKeys.todos(repoPath, runtimeKind, workingDirectory, externalSessionId);

export const createSessionRuntimeDataWriter = (
  queryClient: QueryClient,
): SessionRuntimeDataWriter => ({
  updateTodos(session, updater): void {
    const queryKey = todosQueryKey(session);
    const current = queryClient.getQueryData<AgentSessionTodoItem[]>(queryKey) ?? [];
    queryClient.setQueryData(queryKey, updater(current));
  },
});
