import type { AgentSessionRecord } from "@openducktor/contracts";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { getSessionReads } from "./agent-session-reads";
import {
  type AgentSessionReadPort,
  agentSessionListQueryOptions,
  agentSessionQueryKeys,
  normalizeAgentSessionTaskIds,
} from "./agent-sessions";

export type AgentSessionListQueryResult = UseQueryResult<AgentSessionRecord[], Error>;

export type AgentSessionListsState = {
  data: Record<string, AgentSessionRecord[]>;
  error: unknown | null;
  isPending: boolean;
};

export type AgentSessionListTarget = { repoPath: string; taskId: string };

/** Share canonical task queries across workspaces and batch their host reads per workspace. */
export function useAgentSessionListQueries<Result>({
  targets,
  enabled,
  queryClient,
  readPort,
  combine,
}: {
  targets: readonly AgentSessionListTarget[];
  enabled: boolean;
  queryClient: QueryClient;
  readPort?: AgentSessionReadPort | undefined;
  combine: (
    reads: AgentSessionListQueryResult[],
    targets: readonly AgentSessionListTarget[],
  ) => Result;
}): Result {
  const targetsKey = toTargetsKey(targets);
  const normalizedTargets = useMemo(() => toTargets(targetsKey), [targetsKey]);
  useEffect(() => {
    if (!enabled) return;
    const tasksByRepo = new Map<string, string[]>();
    for (const { repoPath, taskId } of normalizedTargets) {
      const tasks = tasksByRepo.get(repoPath) ?? [];
      tasks.push(taskId);
      tasksByRepo.set(repoPath, tasks);
    }
    const reads = getSessionReads(queryClient);
    const releases = [...tasksByRepo].map(([repoPath, taskIds]) =>
      reads.registerDemand(repoPath, taskIds),
    );
    return () => {
      for (const release of releases) release();
    };
  }, [enabled, normalizedTargets, queryClient]);
  const combineLists = useCallback(
    (lists: AgentSessionListQueryResult[]): Result =>
      combine(lists, enabled ? normalizedTargets : []),
    [combine, enabled, normalizedTargets],
  );

  return useQueries(
    {
      queries: enabled
        ? normalizedTargets.map(({ repoPath, taskId }) => {
            const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
            // A failed exact refresh waits for its owner to retry instead of refetching on mount.
            const listFailed = queryClient.getQueryState(queryKey)?.status === "error";
            return {
              ...agentSessionListQueryOptions(queryClient, repoPath, taskId, readPort),
              enabled: !listFailed,
            };
          })
        : [],
      combine: combineLists,
    },
    queryClient,
  );
}

export const useAgentSessionLists = ({
  repoPath,
  taskIds,
  enabled,
  queryClient,
  readPort,
}: UseAgentSessionListsArgs): AgentSessionListsState => {
  const taskIdsKey = normalizeAgentSessionTaskIds(taskIds).join(TARGET_SEPARATOR);
  const normalizedTaskIds = useMemo(
    () => (taskIdsKey ? taskIdsKey.split(TARGET_SEPARATOR) : []),
    [taskIdsKey],
  );
  const shouldReadLists = enabled && repoPath !== null;
  const targets = useMemo(
    () => (repoPath === null ? [] : normalizedTaskIds.map((taskId) => ({ repoPath, taskId }))),
    [normalizedTaskIds, repoPath],
  );
  const combine = useCallback(
    (reads: AgentSessionListQueryResult[]): AgentSessionListsState => {
      const data = Object.fromEntries(
        normalizedTaskIds.map((taskId, index) => [taskId, reads[index]?.data ?? []]),
      );
      if (!shouldReadLists) {
        return { data, error: null, isPending: true };
      }
      const failedRead = reads.find((read) => read.status === "error");
      if (failedRead) {
        return { data, error: failedRead.error, isPending: false };
      }
      return {
        data,
        error: null,
        isPending: reads.some((read) => read.isPending || read.isFetching || read.isStale),
      };
    },
    [normalizedTaskIds, shouldReadLists],
  );

  return useAgentSessionListQueries({
    targets,
    enabled: shouldReadLists,
    queryClient,
    readPort,
    combine,
  });
};

export type AgentSessionListRead = Pick<AgentSessionListQueryResult, "data" | "error" | "status">;

type UseAgentSessionListsArgs = {
  repoPath: string | null;
  taskIds: string[];
  enabled: boolean;
  queryClient: QueryClient;
  readPort?: AgentSessionReadPort;
};

const TARGET_SEPARATOR = "\u001f";
const TARGETS_SEPARATOR = "\u001e";

export const agentSessionListTargetKey = ({ repoPath, taskId }: AgentSessionListTarget): string =>
  `${repoPath}${TARGET_SEPARATOR}${taskId}`;

const toTargetsKey = (targets: readonly AgentSessionListTarget[]): string => {
  const taskIdsByRepo = new Map<string, string[]>();
  for (const { repoPath, taskId } of targets) {
    taskIdsByRepo.set(repoPath, [...(taskIdsByRepo.get(repoPath) ?? []), taskId]);
  }
  return [...taskIdsByRepo.entries()]
    .flatMap(([repoPath, taskIds]) =>
      normalizeAgentSessionTaskIds(taskIds).map((taskId) =>
        agentSessionListTargetKey({ repoPath, taskId }),
      ),
    )
    .join(TARGETS_SEPARATOR);
};

const toTargets = (targetsKey: string): AgentSessionListTarget[] =>
  targetsKey
    ? targetsKey.split(TARGETS_SEPARATOR).map((entry) => {
        const [repoPath = "", taskId = ""] = entry.split(TARGET_SEPARATOR);
        return { repoPath, taskId };
      })
    : [];
