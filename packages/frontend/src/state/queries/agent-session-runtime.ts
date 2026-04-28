import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentPendingPermissionRequest,
  AgentRuntimeConnection,
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { runtimeConnectionTransportKey } from "@/state/operations/agent-orchestrator/runtime/runtime";

export const SESSION_MODEL_CATALOG_STALE_TIME_MS = 5 * 60_000;
export const SESSION_SLASH_COMMANDS_STALE_TIME_MS = 5 * 60_000;
export const SESSION_FILE_SEARCH_STALE_TIME_MS = 15_000;
export const SESSION_HISTORY_STALE_TIME_MS = 0;
export const SESSION_TODOS_STALE_TIME_MS = 30_000;

const agentSessionRuntimeQueryKeys = {
  all: ["agent-session-runtime"] as const,
  modelCatalog: (runtimeKind: RuntimeKind, runtimeConnection: AgentRuntimeConnection) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "model-catalog",
      runtimeKind,
      runtimeConnectionTransportKey(runtimeConnection),
      normalizeWorkingDirectory(runtimeConnection.workingDirectory),
    ] as const,
  slashCommands: (runtimeKind: RuntimeKind, runtimeConnection: AgentRuntimeConnection) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "slash-commands",
      runtimeKind,
      runtimeConnectionTransportKey(runtimeConnection),
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
      runtimeConnectionTransportKey(runtimeConnection),
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
      runtimeConnectionTransportKey(runtimeConnection),
      normalizeWorkingDirectory(runtimeConnection.workingDirectory),
      externalSessionId,
    ] as const,
  history: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "history",
      runtimeKind,
      runtimeConnectionTransportKey(runtimeConnection),
      normalizeWorkingDirectory(runtimeConnection.workingDirectory),
      externalSessionId,
    ] as const,
  pendingInput: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "pending-input",
      runtimeKind,
      runtimeConnectionTransportKey(runtimeConnection),
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

export const sessionHistoryQueryOptions = (
  runtimeKind: RuntimeKind,
  runtimeConnection: AgentRuntimeConnection,
  externalSessionId: string,
  readSessionHistory: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<AgentSessionHistoryMessage[]>,
) =>
  queryOptions({
    queryKey: agentSessionRuntimeQueryKeys.history(
      runtimeKind,
      runtimeConnection,
      externalSessionId,
    ),
    queryFn: (): Promise<AgentSessionHistoryMessage[]> =>
      readSessionHistory(runtimeKind, runtimeConnection, externalSessionId),
    staleTime: SESSION_HISTORY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });

export const sessionPendingInputQueryOptions = (
  runtimeKind: RuntimeKind,
  runtimeConnection: AgentRuntimeConnection,
  externalSessionId: string,
  readRuntimeSessionPendingInput: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<AgentPendingPermissionRequest[]>,
) =>
  queryOptions({
    queryKey: agentSessionRuntimeQueryKeys.pendingInput(
      runtimeKind,
      runtimeConnection,
      externalSessionId,
    ),
    queryFn: (): Promise<AgentPendingPermissionRequest[]> =>
      readRuntimeSessionPendingInput(runtimeKind, runtimeConnection, externalSessionId),
    staleTime: SESSION_HISTORY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
