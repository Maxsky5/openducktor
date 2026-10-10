import type { AgentSessionRecord } from "@openducktor/contracts";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
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

/**
 * Read the saved session lists of tasks in one or more repositories.
 *
 * Each list keeps its own shared query. Lists of one repository that read together share one
 * host request. `combine` receives one read per target in normalized target order:
 * repositories in first-seen order, task IDs sorted within each repository.
 */
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
  combine: (reads: AgentSessionListRead[], targets: readonly AgentSessionListTarget[]) => Result;
}): Result {
  const targetsKey = toTargetsKey(targets);
  const normalizedTargets = useMemo(() => toTargets(targetsKey), [targetsKey]);
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
              ...agentSessionListQueryOptions(repoPath, taskId, readPort),
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
    (reads: AgentSessionListRead[]): AgentSessionListsState => {
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
      return { data, error: null, isPending: reads.some((read) => read.status === "pending") };
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

/** One task's saved session list. */
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
