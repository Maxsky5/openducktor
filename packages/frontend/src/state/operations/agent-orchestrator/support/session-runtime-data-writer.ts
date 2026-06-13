import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionTodoItem } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { agentSessionRuntimeQueryKeys } from "@/state/queries/agent-session-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type SessionRuntimeDataSessionRef = Pick<
  AgentSessionState,
  "externalSessionId" | "repoPath" | "runtimeKind" | "workingDirectory"
>;

type SessionTodosUpdater = (current: AgentSessionTodoItem[]) => AgentSessionTodoItem[];

export type SessionRuntimeDataWriter = {
  updateTodos: (session: SessionRuntimeDataSessionRef, updater: SessionTodosUpdater) => void;
};

const todosQueryKey = ({
  repoPath,
  runtimeKind,
  workingDirectory,
  externalSessionId,
}: {
  repoPath: string;
  runtimeKind: RuntimeKind;
  workingDirectory: string;
  externalSessionId: string;
}) =>
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
