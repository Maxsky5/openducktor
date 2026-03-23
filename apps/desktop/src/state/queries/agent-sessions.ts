import type { AgentSessionRecord } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

const AGENT_SESSION_LIST_STALE_TIME_MS = 30_000;

export const agentSessionQueryKeys = {
  all: ["agent-sessions"] as const,
  list: (repoPath: string, taskId: string) =>
    [...agentSessionQueryKeys.all, "list", repoPath, taskId] as const,
  bulk: (repoPath: string, taskIds: string[]) =>
    [...agentSessionQueryKeys.all, "bulk", repoPath, [...new Set(taskIds)].sort()] as const,
};

export const agentSessionListQueryOptions = (repoPath: string, taskId: string) =>
  queryOptions({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    queryFn: (): Promise<AgentSessionRecord[]> => host.agentSessionsList(repoPath, taskId),
    staleTime: AGENT_SESSION_LIST_STALE_TIME_MS,
  });

export const agentSessionListBulkQueryOptions = (repoPath: string, taskIds: string[]) => {
  const normalizedTaskIds = [...new Set(taskIds)].sort();
  return queryOptions({
    queryKey: agentSessionQueryKeys.bulk(repoPath, normalizedTaskIds),
    queryFn: (): Promise<Record<string, AgentSessionRecord[]>> =>
      host.agentSessionsListBulk(repoPath, normalizedTaskIds),
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

export const loadAgentSessionListsFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
  options?: {
    forceFresh?: boolean;
  },
): Promise<Record<string, AgentSessionRecord[]>> => {
  if (taskIds.length === 0) {
    return Promise.resolve({});
  }

  return queryClient.fetchQuery({
    ...agentSessionListBulkQueryOptions(repoPath, taskIds),
    ...(options?.forceFresh ? { staleTime: 0 } : {}),
  });
};

export const upsertAgentSessionRecordInQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  session: AgentSessionRecord,
): void => {
  queryClient.setQueryData<AgentSessionRecord[] | undefined>(
    agentSessionQueryKeys.list(repoPath, taskId),
    (current): AgentSessionRecord[] | undefined => {
      if (!current) {
        return current;
      }

      const existingIndex = current.findIndex((entry) => entry.sessionId === session.sessionId);
      if (existingIndex === -1) {
        return [...current, session];
      }

      if (current[existingIndex] === session) {
        return current;
      }

      return current.map((entry, index) => (index === existingIndex ? session : entry));
    },
  );
};
