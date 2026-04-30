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

      const existingIndex = current.findIndex(
        (entry) => entry.externalSessionId === session.externalSessionId,
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
