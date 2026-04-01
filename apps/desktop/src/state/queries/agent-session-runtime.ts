import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentRuntimeConnection,
  AgentSessionTodoItem,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";

export const SESSION_MODEL_CATALOG_STALE_TIME_MS = 5 * 60_000;
export const SESSION_SLASH_COMMANDS_STALE_TIME_MS = 5 * 60_000;
export const SESSION_FILE_SEARCH_STALE_TIME_MS = 15_000;
export const SESSION_TODOS_STALE_TIME_MS = 30_000;

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
  slashCommands: (runtimeKind: RuntimeKind, runtimeConnection: AgentRuntimeConnection) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "slash-commands",
      runtimeKind,
      normalizeRuntimeEndpoint(runtimeConnection.endpoint ?? ""),
      normalizeWorkingDirectory(runtimeConnection.workingDirectory),
    ] as const,
  fileSearch: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    query: string,
  ) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "file-search",
      runtimeKind,
      normalizeRuntimeEndpoint(runtimeConnection.endpoint ?? ""),
      normalizeWorkingDirectory(runtimeConnection.workingDirectory),
      query,
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

export const sessionSlashCommandsQueryOptions = (
  runtimeKind: RuntimeKind,
  runtimeConnection: AgentRuntimeConnection,
  readSessionSlashCommands: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<AgentSlashCommandCatalog>,
) =>
  queryOptions({
    queryKey: agentSessionRuntimeQueryKeys.slashCommands(runtimeKind, runtimeConnection),
    queryFn: (): Promise<AgentSlashCommandCatalog> =>
      readSessionSlashCommands(runtimeKind, runtimeConnection),
    staleTime: SESSION_SLASH_COMMANDS_STALE_TIME_MS,
  });

export const sessionFileSearchQueryOptions = (
  runtimeKind: RuntimeKind,
  runtimeConnection: AgentRuntimeConnection,
  query: string,
  readSessionFileSearch: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    query: string,
  ) => Promise<AgentFileSearchResult[]>,
) =>
  queryOptions({
    queryKey: agentSessionRuntimeQueryKeys.fileSearch(runtimeKind, runtimeConnection, query),
    queryFn: (): Promise<AgentFileSearchResult[]> =>
      readSessionFileSearch(runtimeKind, runtimeConnection, query),
    staleTime: SESSION_FILE_SEARCH_STALE_TIME_MS,
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
