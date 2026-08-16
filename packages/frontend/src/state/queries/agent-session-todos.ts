import type {
  AgentSessionRef,
  AgentSessionTodoItem,
  LoadAgentSessionTodosInput,
  SessionRef,
} from "@openducktor/core";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";

export const SESSION_TODOS_STALE_TIME_MS = 30_000;

export const agentSessionTodosQueryKeys = {
  all: ["agent-session-todos"] as const,
  identity: ({ repoPath, runtimeKind, workingDirectory, externalSessionId }: SessionRef) =>
    [
      ...agentSessionTodosQueryKeys.all,
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
      externalSessionId,
    ] as const,
  todos: (session: AgentSessionRef) =>
    [
      ...agentSessionTodosQueryKeys.identity(session),
      session.sessionScope?.kind ?? null,
      session.sessionScope?.kind === "workflow" ? session.sessionScope.taskId : null,
      session.sessionScope?.kind === "workflow" ? session.sessionScope.role : null,
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
  session: SessionRef,
  updater: SessionTodosUpdater,
): void => {
  const unscopedQueryKey = agentSessionTodosQueryKeys.todos(session);
  const hasUnscopedQuery = queryClient.getQueryState(unscopedQueryKey) !== undefined;
  queryClient.setQueriesData<AgentSessionTodoItem[]>(
    { queryKey: agentSessionTodosQueryKeys.identity(session) },
    (current) => updater(current ?? []),
  );
  if (!hasUnscopedQuery) {
    queryClient.setQueryData(unscopedQueryKey, updater([]));
  }
};
