import type { AgentSessionRecord } from "@openducktor/contracts";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { agentSessionListQueryOptions } from "@/state/queries/agent-sessions";
import { type TaskSessionRecords, toTaskSessionRecords } from "./task-session-records";

type AgentSessionListQueryResult = UseQueryResult<AgentSessionRecord[], Error>;

export type TaskSessionRecordsState =
  | { kind: "loading" }
  | { kind: "failed"; error: unknown }
  | { kind: "ready"; records: TaskSessionRecords };

type UseTaskSessionRecordsArgs = {
  repoPath: string | null;
  taskIds: string[];
  enabled: boolean;
  queryClient: QueryClient;
};

const TASK_ID_SEPARATOR = "\u001f";

const toTaskIdSetKey = (taskIds: string[]): string =>
  [...new Set(taskIds)].toSorted().join(TASK_ID_SEPARATOR);

const toTaskSessionTargets = (taskIdsKey: string): { id: string }[] => {
  if (!taskIdsKey) {
    return [];
  }
  return taskIdsKey.split(TASK_ID_SEPARATOR).map((id) => ({ id }));
};

export const useTaskSessionRecords = ({
  repoPath,
  taskIds,
  enabled,
  queryClient,
}: UseTaskSessionRecordsArgs): TaskSessionRecordsState => {
  const taskIdsKey = toTaskIdSetKey(taskIds);
  const taskSessionTargets = useMemo(() => toTaskSessionTargets(taskIdsKey), [taskIdsKey]);
  const shouldReadRecords = enabled && repoPath !== null;

  return useQueries(
    {
      queries: shouldReadRecords
        ? taskSessionTargets.map((task) => agentSessionListQueryOptions(repoPath, task.id))
        : [],
      combine: (queries: AgentSessionListQueryResult[]): TaskSessionRecordsState => {
        if (!shouldReadRecords) {
          return { kind: "loading" };
        }
        if (queries.some((query) => query.isPending)) {
          return { kind: "loading" };
        }
        const failedQuery = queries.find((query) => query.isError);
        if (failedQuery) {
          return { kind: "failed", error: failedQuery.error };
        }
        return {
          kind: "ready",
          records: toTaskSessionRecords(
            taskSessionTargets,
            Object.fromEntries(
              taskSessionTargets.map((task, index) => [task.id, queries[index]?.data ?? []]),
            ),
          ),
        };
      },
    },
    queryClient,
  );
};
