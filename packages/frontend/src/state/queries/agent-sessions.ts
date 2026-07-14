import type { AgentSessionIdentity, AgentSessionRecord } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { host } from "../operations/host";

const AGENT_SESSION_LIST_STALE_TIME_MS = 30_000;

const normalizeTaskIds = (taskIds: string[]): string[] =>
  Array.from(
    new Set(
      taskIds.flatMap((taskId) => {
        const normalizedTaskId = taskId.trim();
        return normalizedTaskId ? [normalizedTaskId] : [];
      }),
    ),
  ).sort();

export const agentSessionQueryKeys = {
  all: ["agent-sessions"] as const,
  list: (repoPath: string, taskId: string) =>
    [...agentSessionQueryKeys.all, "list", repoPath, taskId] as const,
  batches: (repoPath: string) =>
    [...agentSessionQueryKeys.all, "list-for-tasks", repoPath] as const,
  listForTasks: (repoPath: string, taskIds: string[]) =>
    [...agentSessionQueryKeys.batches(repoPath), normalizeTaskIds(taskIds)] as const,
};

export const agentSessionListQueryOptions = (repoPath: string, taskId: string) =>
  queryOptions({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    queryFn: (): Promise<AgentSessionRecord[]> => host.agentSessionsList(repoPath, taskId),
    staleTime: AGENT_SESSION_LIST_STALE_TIME_MS,
  });

export const agentSessionListsQueryOptions = (repoPath: string, taskIds: string[]) => {
  const queryKey = agentSessionQueryKeys.listForTasks(repoPath, taskIds);
  const normalizedTaskIds = queryKey[3];
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<Record<string, AgentSessionRecord[]>> => {
      const sessionsByTaskId = Object.fromEntries(
        normalizedTaskIds.map((taskId) => [taskId, [] as AgentSessionRecord[]]),
      );
      const taskSessions = await host.agentSessionsListForTasks(repoPath, normalizedTaskIds);
      for (const taskSession of taskSessions) {
        sessionsByTaskId[taskSession.taskId] = taskSession.agentSessions;
      }
      return sessionsByTaskId;
    },
    staleTime: AGENT_SESSION_LIST_STALE_TIME_MS,
  });
};

export const loadAgentSessionListFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  options?: {
    forceFresh?: boolean;
  },
): Promise<AgentSessionRecord[]> =>
  queryClient.fetchQuery({
    ...agentSessionListQueryOptions(repoPath, taskId),
    ...(options?.forceFresh ? { staleTime: 0 } : {}),
  });

export const loadAgentSessionListsFromQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
  options?: {
    forceFresh?: boolean;
  },
): Promise<Record<string, AgentSessionRecord[]>> => {
  const uniqueTaskIds = Array.from(new Set(taskIds));
  const entries = await Promise.all(
    uniqueTaskIds.map(async (taskId) => {
      const records = await loadAgentSessionListFromQuery(queryClient, repoPath, taskId, options);
      return [taskId, records] as const;
    }),
  );

  return Object.fromEntries(entries);
};

export const invalidateAgentSessionListQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  options?: {
    refetchActive?: boolean;
  },
): Promise<void> =>
  Promise.all([
    queryClient.invalidateQueries({
      queryKey: agentSessionQueryKeys.list(repoPath, taskId),
      exact: true,
      refetchType: options?.refetchActive === true ? "active" : "none",
    }),
    queryClient.invalidateQueries({
      queryKey: agentSessionQueryKeys.batches(repoPath),
      refetchType: options?.refetchActive === true ? "active" : "none",
    }),
  ]).then(() => undefined);

const areSelectedModelsEquivalent = (
  left: AgentSessionRecord["selectedModel"],
  right: AgentSessionRecord["selectedModel"],
): boolean => {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  return (
    left.runtimeKind === right.runtimeKind &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.variant === right.variant &&
    left.profileId === right.profileId
  );
};

const areAgentSessionRecordsEquivalent = (
  left: AgentSessionRecord,
  right: AgentSessionRecord,
): boolean =>
  left.externalSessionId === right.externalSessionId &&
  left.role === right.role &&
  left.startedAt === right.startedAt &&
  left.runtimeKind === right.runtimeKind &&
  left.workingDirectory === right.workingDirectory &&
  areSelectedModelsEquivalent(left.selectedModel, right.selectedModel);

const upsertAgentSessionRecord = (
  current: AgentSessionRecord[] | undefined,
  session: AgentSessionRecord,
): AgentSessionRecord[] | undefined => {
  if (!current) {
    return current;
  }

  const sessionKey = agentSessionIdentityKey(session);
  const existingIndex = current.findIndex((entry) => agentSessionIdentityKey(entry) === sessionKey);
  if (existingIndex === -1) {
    return [...current, session];
  }

  const existingSession = current[existingIndex];
  if (!existingSession || existingSession === session) {
    return current;
  }

  if (areAgentSessionRecordsEquivalent(existingSession, session)) {
    return current;
  }

  return current.map((entry, index) => (index === existingIndex ? session : entry));
};

export const upsertAgentSessionRecordInQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  session: AgentSessionRecord,
): void => {
  queryClient.setQueryData<AgentSessionRecord[] | undefined>(
    agentSessionQueryKeys.list(repoPath, taskId),
    (current) => upsertAgentSessionRecord(current, session),
  );
  queryClient.setQueriesData<Record<string, AgentSessionRecord[]> | undefined>(
    { queryKey: agentSessionQueryKeys.batches(repoPath) },
    (current) => {
      if (!current || !(taskId in current)) {
        return current;
      }
      const currentSessions = current[taskId];
      const nextSessions = upsertAgentSessionRecord(currentSessions, session);
      if (nextSessions === currentSessions || !nextSessions) {
        return current;
      }
      return { ...current, [taskId]: nextSessions };
    },
  );
};

export const removeAgentSessionRecordFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  identity: AgentSessionIdentity,
): void => {
  const identityKey = agentSessionIdentityKey(identity);
  queryClient.setQueryData<AgentSessionRecord[] | undefined>(
    agentSessionQueryKeys.list(repoPath, taskId),
    (current) => current?.filter((entry) => agentSessionIdentityKey(entry) !== identityKey),
  );
};
