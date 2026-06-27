import type {
  AgentSessionRef,
  AgentSessionTodoItem,
  LoadAgentSessionTodosInput,
} from "@openducktor/core";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";

export const SESSION_TODOS_STALE_TIME_MS = 30_000;

export const agentSessionTodosQueryKeys = {
  all: ["agent-session-todos"] as const,
  todos: ({ repoPath, runtimeKind, workingDirectory, externalSessionId }: AgentSessionRef) =>
    [
      ...agentSessionTodosQueryKeys.all,
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
      externalSessionId,
    ] as const,
};

export const sessionTodosQueryOptions = (
  session: LoadAgentSessionTodosInput,
  readSessionTodos: (session: LoadAgentSessionTodosInput) => Promise<AgentSessionTodoItem[]>,
) =>
  queryOptions<AgentSessionTodoItem[], Error, AgentSessionTodoItem[], QueryKey>({
    queryKey: agentSessionTodosQueryKeys.todos(session),
    queryFn: (): Promise<AgentSessionTodoItem[]> => readSessionTodos(session),
    staleTime: SESSION_TODOS_STALE_TIME_MS,
  });

export type SessionTodosUpdater = (current: AgentSessionTodoItem[]) => AgentSessionTodoItem[];

export const updateSessionTodosQueryData = (
  queryClient: QueryClient,
  session: AgentSessionRef,
  updater: SessionTodosUpdater,
): void => {
  const queryKey = agentSessionTodosQueryKeys.todos(session);
  const current = queryClient.getQueryData<AgentSessionTodoItem[]>(queryKey) ?? [];
  queryClient.setQueryData(queryKey, updater(current));
};
