import type { AgentSessionRecord } from "@openducktor/contracts";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  type AgentSessionReadPort,
  agentSessionListHydrationQueryOptions,
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
 * Each list keeps its own shared query. One batch read per repository fills the lists that
 * have no cached result, and a list waits for that read instead of reading alone. `combine`
 * receives one read per target in normalized target order: repositories in first-seen order,
 * task IDs sorted within each repository.
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
  const missingTaskIdsByRepo = new Map<string, string[]>();
  if (enabled) {
    for (const { repoPath, taskId } of normalizedTargets) {
      const state = queryClient.getQueryState(agentSessionQueryKeys.list(repoPath, taskId));
      if (state?.status === "error" || state?.data !== undefined) continue;
      missingTaskIdsByRepo.set(repoPath, [...(missingTaskIdsByRepo.get(repoPath) ?? []), taskId]);
    }
  }
  const batchRepos = [...missingTaskIdsByRepo.keys()];
  const batchResults = useQueries(
    {
      queries: batchRepos.map((repoPath) =>
        agentSessionListHydrationQueryOptions(
          queryClient,
          repoPath,
          missingTaskIdsByRepo.get(repoPath) ?? [],
          readPort,
        ),
      ),
      combine: combineBatchReads,
    },
    queryClient,
  );
  const batchReposKey = batchRepos.join(TARGETS_SEPARATOR);
  const batchesByRepo = useMemo(
    () =>
      new Map(
        (batchReposKey ? batchReposKey.split(TARGETS_SEPARATOR) : []).map((repoPath, index) => [
          repoPath,
          batchResults[index] ?? PENDING_BATCH_READ,
        ]),
      ),
    [batchReposKey, batchResults],
  );
  const combineLists = useCallback(
    (lists: AgentSessionListQueryResult[]): Result => {
      const readTargets = enabled ? normalizedTargets : [];
      return combine(
        readTargets.map((target, index) =>
          toListRead(lists[index], batchesByRepo.get(target.repoPath)),
        ),
        readTargets,
      );
    },
    [batchesByRepo, combine, enabled, normalizedTargets],
  );

  return useQueries(
    {
      queries: enabled
        ? normalizedTargets.map(({ repoPath, taskId }) => {
            const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
            const batch = batchesByRepo.get(repoPath);
            const batchReady = batch === undefined || batch.status === "success";
            // A failed exact refresh waits for its owner to retry instead of refetching on mount.
            const listFailed = queryClient.getQueryState(queryKey)?.status === "error";
            return {
              ...agentSessionListQueryOptions(repoPath, taskId, readPort),
              enabled: batchReady && !listFailed,
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

/**
 * One task's saved session list. A list without data waits for its repository's batch read,
 * so it reports the state of that read until the read succeeds.
 */
export type AgentSessionListRead = Pick<AgentSessionListQueryResult, "data" | "error" | "status">;

type BatchRead = Pick<UseQueryResult<true, Error>, "error" | "status">;

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

const PENDING_BATCH_READ: BatchRead = { error: null, status: "pending" };

const combineBatchReads = (results: BatchRead[]): BatchRead[] =>
  results.map(({ error, status }) => ({ error, status }));

const toListRead = (
  list: AgentSessionListQueryResult | undefined,
  batch: BatchRead | undefined,
): AgentSessionListRead => {
  if (list?.data === undefined && batch && batch.status !== "success") {
    return { data: undefined, error: batch.error, status: batch.status };
  }
  if (!list) return { data: undefined, error: null, status: "pending" };
  return { data: list.data, error: list.error, status: list.status };
};
