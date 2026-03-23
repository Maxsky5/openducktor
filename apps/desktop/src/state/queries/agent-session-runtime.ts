import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRuntimeConnection,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { queryOptions } from "@tanstack/react-query";

export const SESSION_MODEL_CATALOG_STALE_TIME_MS = 5 * 60_000;
export const SESSION_TODOS_STALE_TIME_MS = 30_000;

const normalizeWorkingDirectory = (workingDirectory: string): string => workingDirectory.trim();

const normalizeRuntimeEndpoint = (runtimeEndpoint: string): string => runtimeEndpoint.trim();

const agentSessionRuntimeQueryKeys = {
  all: ["agent-session-runtime"] as const,
  modelCatalog: (runtimeKind: RuntimeKind, runtimeConnection: AgentRuntimeConnection) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "model-catalog",
      runtimeKind,
      normalizeRuntimeEndpoint(runtimeConnection.endpoint ?? ""),
      normalizeWorkingDirectory(runtimeConnection.workingDirectory),
    ] as const,
  todos: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "todos",
      runtimeKind,
      normalizeRuntimeEndpoint(runtimeConnection.endpoint ?? ""),
      normalizeWorkingDirectory(runtimeConnection.workingDirectory),
      externalSessionId,
    ] as const,
};

export const sessionModelCatalogQueryOptions = (
  runtimeKind: RuntimeKind,
  runtimeConnection: AgentRuntimeConnection,
  readSessionModelCatalog: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<AgentModelCatalog>,
) =>
  queryOptions({
    queryKey: agentSessionRuntimeQueryKeys.modelCatalog(runtimeKind, runtimeConnection),
    queryFn: (): Promise<AgentModelCatalog> =>
      readSessionModelCatalog(runtimeKind, runtimeConnection),
    staleTime: SESSION_MODEL_CATALOG_STALE_TIME_MS,
  });

export const sessionTodosQueryOptions = (
  runtimeKind: RuntimeKind,
  runtimeConnection: AgentRuntimeConnection,
  externalSessionId: string,
  readSessionTodos: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<AgentSessionTodoItem[]>,
) =>
  queryOptions({
    queryKey: agentSessionRuntimeQueryKeys.todos(runtimeKind, runtimeConnection, externalSessionId),
    queryFn: (): Promise<AgentSessionTodoItem[]> =>
      readSessionTodos(runtimeKind, runtimeConnection, externalSessionId),
    staleTime: SESSION_TODOS_STALE_TIME_MS,
  });
