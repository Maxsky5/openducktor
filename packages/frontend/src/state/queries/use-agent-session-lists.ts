import type { AgentSessionRecord } from "@openducktor/contracts";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  type AgentSessionReadPort,
  agentSessionListHydrationQueryOptions,
  agentSessionListQueryOptions,
  agentSessionQueryKeys,
  normalizeAgentSessionTaskIds,
} from "./agent-sessions";

type AgentSessionListQueryResult = UseQueryResult<AgentSessionRecord[], Error>;

export type AgentSessionListsState = {
  data: Record<string, AgentSessionRecord[]>;
  error: unknown | null;
  isPending: boolean;
};

type UseAgentSessionListsArgs = {
  repoPath: string | null;
  taskIds: string[];
  enabled: boolean;
  queryClient: QueryClient;
  readPort?: AgentSessionReadPort;
};

const TASK_ID_SEPARATOR = "\u001f";

const toTaskIdSetKey = (taskIds: string[]): string =>
  normalizeAgentSessionTaskIds(taskIds).join(TASK_ID_SEPARATOR);

const toTaskIds = (taskIdsKey: string): string[] =>
  taskIdsKey ? taskIdsKey.split(TASK_ID_SEPARATOR) : [];

export const useAgentSessionLists = ({
  repoPath,
  taskIds,
  enabled,
  queryClient,
  readPort,
}: UseAgentSessionListsArgs): AgentSessionListsState => {
  const taskIdsKey = toTaskIdSetKey(taskIds);
  const normalizedTaskIds = useMemo(() => toTaskIds(taskIdsKey), [taskIdsKey]);
  const shouldReadLists = enabled && repoPath !== null;
  const missingTaskIds = shouldReadLists
    ? normalizedTaskIds.filter((taskId) => {
        const queryState = queryClient.getQueryState(agentSessionQueryKeys.list(repoPath, taskId));
        return queryState?.status !== "error" && queryState?.data === undefined;
      })
    : [];
  const shouldHydrateLists = missingTaskIds.length > 0;
  const hydrationQuery = useQuery(
    {
      ...agentSessionListHydrationQueryOptions(
        queryClient,
        repoPath ?? "",
        missingTaskIds,
        readPort,
      ),
      enabled: shouldHydrateLists,
    },
    queryClient,
  );
  const hydrationReady = !shouldHydrateLists || hydrationQuery.isSuccess;
  const combineAgentSessionListQueries = useCallback(
    (queries: AgentSessionListQueryResult[]): AgentSessionListsState => {
      const data = Object.fromEntries(
        normalizedTaskIds.map((taskId, index) => [taskId, queries[index]?.data ?? []]),
      );
      if (!shouldReadLists) {
        return { data, error: null, isPending: true };
      }
      if (hydrationQuery.isError) {
        return { data, error: hydrationQuery.error, isPending: false };
      }
      const failedQuery = queries.find((query) => query.isError);
      if (failedQuery) {
        return { data, error: failedQuery.error, isPending: false };
      }
      return {
        data,
        error: null,
        isPending:
          (shouldHydrateLists && hydrationQuery.isPending) ||
          queries.some((query) => query.isPending),
      };
    },
    [
      hydrationQuery.error,
      hydrationQuery.isError,
      hydrationQuery.isPending,
      normalizedTaskIds,
      shouldHydrateLists,
      shouldReadLists,
    ],
  );

  return useQueries(
    {
      queries: shouldReadLists
        ? normalizedTaskIds.map((taskId) => {
            const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
            const exactRefreshFailed = queryClient.getQueryState(queryKey)?.status === "error";
            return {
              ...agentSessionListQueryOptions(repoPath, taskId, readPort),
              enabled: hydrationReady && !exactRefreshFailed,
            };
          })
        : [],
      combine: combineAgentSessionListQueries,
    },
    queryClient,
  );
};
