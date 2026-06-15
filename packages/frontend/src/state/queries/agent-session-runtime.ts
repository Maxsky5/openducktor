import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSessionHistoryMessage,
  AgentSessionRef,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";

export const SESSION_MODEL_CATALOG_STALE_TIME_MS = 5 * 60_000;
const SESSION_SLASH_COMMANDS_STALE_TIME_MS = 5 * 60_000;
const SESSION_SKILLS_STALE_TIME_MS = 5 * 60_000;
const SESSION_FILE_SEARCH_STALE_TIME_MS = 15_000;
export const SESSION_HISTORY_STALE_TIME_MS = 0;
export const SESSION_TODOS_STALE_TIME_MS = 30_000;

export const agentSessionRuntimeQueryKeys = {
  all: ["agent-session-runtime"] as const,
  modelCatalog: (repoPath: string, runtimeKind: RuntimeKind) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "model-catalog",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
    ] as const,
  modelCatalogUnavailable: () =>
    [...agentSessionRuntimeQueryKeys.all, "model-catalog-unavailable"] as const,
  slashCommands: (repoPath: string, runtimeKind: RuntimeKind) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "slash-commands",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
    ] as const,
  skills: (repoPath: string, runtimeKind: RuntimeKind, workingDirectory: string) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "skills",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
    ] as const,
  fileSearch: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    query: string,
  ) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "file-search",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
      query,
    ] as const,
  todos: ({ repoPath, runtimeKind, workingDirectory, externalSessionId }: AgentSessionRef) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "todos",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
      externalSessionId,
    ] as const,
  todosUnavailable: () => [...agentSessionRuntimeQueryKeys.all, "todos-unavailable"] as const,
  history: ({ repoPath, runtimeKind, workingDirectory, externalSessionId }: AgentSessionRef) =>
    [
      ...agentSessionRuntimeQueryKeys.all,
      "history",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
      externalSessionId,
    ] as const,
  historyUnavailable: () => [...agentSessionRuntimeQueryKeys.all, "history-unavailable"] as const,
};

export const sessionModelCatalogQueryOptions = (
  repoPath: string,
  runtimeKind: RuntimeKind,
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentModelCatalog>,
) =>
  queryOptions({
    queryKey: agentSessionRuntimeQueryKeys.modelCatalog(repoPath, runtimeKind),
    queryFn: (): Promise<AgentModelCatalog> => readSessionModelCatalog(repoPath, runtimeKind),
    staleTime: SESSION_MODEL_CATALOG_STALE_TIME_MS,
  });

export const sessionSlashCommandsQueryOptions = (
  repoPath: string,
  runtimeKind: RuntimeKind,
  readSessionSlashCommands: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentSlashCommandCatalog>,
) =>
  queryOptions({
    queryKey: agentSessionRuntimeQueryKeys.slashCommands(repoPath, runtimeKind),
    queryFn: (): Promise<AgentSlashCommandCatalog> =>
      readSessionSlashCommands(repoPath, runtimeKind),
    staleTime: SESSION_SLASH_COMMANDS_STALE_TIME_MS,
  });

export const sessionSkillsQueryOptions = (
  repoPath: string,
  runtimeKind: RuntimeKind,
  workingDirectory: string,
  readSessionSkills: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ) => Promise<AgentSkillCatalog>,
) =>
  queryOptions({
    queryKey: agentSessionRuntimeQueryKeys.skills(repoPath, runtimeKind, workingDirectory),
    queryFn: (): Promise<AgentSkillCatalog> =>
      readSessionSkills(repoPath, runtimeKind, workingDirectory),
    staleTime: SESSION_SKILLS_STALE_TIME_MS,
  });

export const sessionFileSearchQueryOptions = (
  repoPath: string,
  runtimeKind: RuntimeKind,
  workingDirectory: string,
  query: string,
  readSessionFileSearch: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    query: string,
  ) => Promise<AgentFileSearchResult[]>,
) =>
  queryOptions({
    queryKey: agentSessionRuntimeQueryKeys.fileSearch(
      repoPath,
      runtimeKind,
      workingDirectory,
      query,
    ),
    queryFn: (): Promise<AgentFileSearchResult[]> =>
      readSessionFileSearch(repoPath, runtimeKind, workingDirectory, query),
    staleTime: SESSION_FILE_SEARCH_STALE_TIME_MS,
  });

export const sessionTodosQueryOptions = (
  session: AgentSessionRef,
  readSessionTodos: (session: AgentSessionRef) => Promise<AgentSessionTodoItem[]>,
) =>
  queryOptions({
    queryKey: agentSessionRuntimeQueryKeys.todos(session),
    queryFn: (): Promise<AgentSessionTodoItem[]> => readSessionTodos(session),
    staleTime: SESSION_TODOS_STALE_TIME_MS,
  });

export type SessionTodosUpdater = (current: AgentSessionTodoItem[]) => AgentSessionTodoItem[];

export const updateSessionTodosQueryData = (
  queryClient: QueryClient,
  session: AgentSessionRef,
  updater: SessionTodosUpdater,
): void => {
  const queryKey = agentSessionRuntimeQueryKeys.todos(session);
  const current = queryClient.getQueryData<AgentSessionTodoItem[]>(queryKey) ?? [];
  queryClient.setQueryData(queryKey, updater(current));
};

export const sessionHistoryQueryOptions = (
  session: AgentSessionRef,
  readSessionHistory: (session: AgentSessionRef) => Promise<AgentSessionHistoryMessage[]>,
) =>
  queryOptions({
    queryKey: agentSessionRuntimeQueryKeys.history(session),
    queryFn: (): Promise<AgentSessionHistoryMessage[]> => readSessionHistory(session),
    staleTime: SESSION_HISTORY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
