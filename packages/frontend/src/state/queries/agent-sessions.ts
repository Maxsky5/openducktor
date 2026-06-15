import type { AgentSessionRecord } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { host } from "../operations/host";

const AGENT_SESSION_LIST_STALE_TIME_MS = 30_000;

export const agentSessionQueryKeys = {
  all: ["agent-sessions"] as const,
  list: (repoPath: string, taskId: string) =>
    [...agentSessionQueryKeys.all, "list", repoPath, taskId] as const,
  bulk: (repoPath: string, taskIds: string[]) =>
    [
      ...agentSessionQueryKeys.all,
      "bulk",
      repoPath,
      ...Array.from(new Set(taskIds)).toSorted(),
    ] as const,
};

export const agentSessionListQueryOptions = (repoPath: string, taskId: string) =>
  queryOptions({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    queryFn: (): Promise<AgentSessionRecord[]> => host.agentSessionsList(repoPath, taskId),
    staleTime: AGENT_SESSION_LIST_STALE_TIME_MS,
  });

export const agentSessionBulkQueryOptions = (repoPath: string, taskIds: string[]) =>
  queryOptions({
    queryKey: agentSessionQueryKeys.bulk(repoPath, taskIds),
    queryFn: (): Promise<Record<string, AgentSessionRecord[]>> =>
      host.agentSessionsListBulk(repoPath, taskIds),
    staleTime: AGENT_SESSION_LIST_STALE_TIME_MS,
  });

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
  const recordsByTaskId = await queryClient.fetchQuery({
    ...agentSessionBulkQueryOptions(repoPath, taskIds),
    ...(options?.forceFresh ? { staleTime: 0 } : {}),
  });

  for (const taskId of taskIds) {
    queryClient.setQueryData(
      agentSessionQueryKeys.list(repoPath, taskId),
      recordsByTaskId[taskId] ?? [],
    );
  }

  return recordsByTaskId;
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

      const sessionKey = agentSessionIdentityKey(session);
      const existingIndex = current.findIndex(
        (entry) => agentSessionIdentityKey(entry) === sessionKey,
      );
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
