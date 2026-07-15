import type { AgentSessionRecord } from "@openducktor/contracts";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  agentSessionListHydrationQueryOptions,
  agentSessionListQueryOptions,
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
}: UseAgentSessionListsArgs): AgentSessionListsState => {
  const taskIdsKey = toTaskIdSetKey(taskIds);
  const normalizedTaskIds = useMemo(() => toTaskIds(taskIdsKey), [taskIdsKey]);
  const shouldReadLists = enabled && repoPath !== null;
  const shouldHydrateLists = shouldReadLists && normalizedTaskIds.length > 0;
  const hydrationQuery = useQuery(
    {
      ...agentSessionListHydrationQueryOptions(queryClient, repoPath ?? "", normalizedTaskIds),
      enabled: shouldHydrateLists,
    },
    queryClient,
  );
  const hydrationReady = normalizedTaskIds.length === 0 || hydrationQuery.isSuccess;
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
        ? normalizedTaskIds.map((taskId) => ({
            ...agentSessionListQueryOptions(repoPath, taskId),
            enabled: hydrationReady,
          }))
        : [],
      combine: combineAgentSessionListQueries,
    },
    queryClient,
  );
};
