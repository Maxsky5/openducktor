import { z } from "zod";
import {
  type AgentSessionRecord,
  type WorkspaceRef,
  artifactScopeSchema,
} from "@openducktor/contracts";
import {
  notifyManager,
  QueriesObserver,
  type QueryClient,
  replaceEqualDeep,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  type AgentSessionReadPort,
  agentSessionListQueryOptions,
  normalizeAgentSessionTaskIds,
} from "./agent-sessions";

export type AgentSessionListQueryResult = UseQueryResult<AgentSessionRecord[], Error>;

export type AgentSessionListsState = {
  data: Record<string, AgentSessionRecord[]>;
  error: unknown | null;
  isPending: boolean;
};

export type AgentSessionListTarget = WorkspaceRef & { taskId: string };

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
  const targetsKey = useMemo(() => toTargetsKey(targets), [targets]);
  const normalizedTargets = useMemo(() => toTargets(targetsKey), [targetsKey]);
  const queries = useMemo(
    () =>
      enabled
        ? normalizedTargets.map(
            ({ workspaceId, repoPath, taskId }) =>
              // A mounted failed list stays active, so a later task change reads it again. A query
              // that will fetch reads as fetching in the first render, as with `useQueries`.
              ({
                ...agentSessionListQueryOptions({ workspaceId, repoPath }, taskId, readPort),
                _optimisticResults: "optimistic",
              }) satisfies ListQueryOptions,
          )
        : [],
    [enabled, normalizedTargets, readPort],
  );
  const lists = useQueryList(queryClient, queries);
  // An equal result keeps its objects, as with `useQueries`, so a read that changes only its
  // fetch state changes nothing for the reader.
  const previous = useRef<Result | undefined>(undefined);
  const combined = useMemo(
    () => replaceEqualDeep(previous.current, combine(lists, enabled ? normalizedTargets : [])),
    [combine, enabled, lists, normalizedTargets],
  );
  useLayoutEffect(() => {
    previous.current = combined;
  }, [combined]);
  return combined;
}

type ListQueryOptions = ReturnType<typeof agentSessionListQueryOptions> & {
  _optimisticResults?: "optimistic";
};

/**
 * The results of `queries`. `useQueries` matches every query again on each render, so with one
 * query per task, a live change of one task costs a pass over every task. Here one observer holds
 * the list until the list changes, and a render reads the results that it holds. The observer of
 * a new list reads the cached results at once, and its queries fetch when it subscribes.
 */
const useQueryList = (
  queryClient: QueryClient,
  queries: ListQueryOptions[],
): AgentSessionListQueryResult[] => {
  const observer = useMemo(() => new QueriesObserver(queryClient, queries), [queryClient, queries]);
  const subscribe = useCallback(
    (onChange: () => void) => observer.subscribe(notifyManager.batchCalls(onChange)),
    [observer],
  );
  const results = useSyncExternalStore(subscribe, observer.getCurrentResult.bind(observer));
  // SAFETY: each query of the observer reads one task's session records.
  return results as AgentSessionListQueryResult[];
};

export const useAgentSessionLists = ({
  workspaceId,
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
  const shouldReadLists = enabled && repoPath !== null && workspaceId !== null;
  const targets = useMemo(
    () =>
      repoPath === null || workspaceId === null
        ? []
        : normalizedTaskIds.map((taskId) => ({ workspaceId, repoPath, taskId })),
    [normalizedTaskIds, repoPath, workspaceId],
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
  workspaceId: string | null;
  repoPath: string | null;
  taskIds: string[];
  enabled: boolean;
  queryClient: QueryClient;
  readPort?: AgentSessionReadPort;
};

const TARGET_SEPARATOR = "\u001f";
export const agentSessionListTargetKey = ({
  workspaceId,
  repoPath,
  taskId,
}: AgentSessionListTarget): string => JSON.stringify([workspaceId, repoPath, taskId]);

const toTargetsKey = (targets: readonly AgentSessionListTarget[]): string => {
  const byWorkspace = new Map<string, { scope: WorkspaceRef; taskIds: string[] }>();
  for (const { workspaceId, repoPath, taskId } of targets) {
    const key = JSON.stringify([workspaceId, repoPath]);
    const entry = byWorkspace.get(key);
    if (entry) entry.taskIds.push(taskId);
    else byWorkspace.set(key, { scope: { workspaceId, repoPath }, taskIds: [taskId] });
  }
  return JSON.stringify(
    [...byWorkspace.values()].flatMap(({ scope, taskIds }) =>
      normalizeAgentSessionTaskIds(taskIds).map((taskId) => ({ ...scope, taskId })),
    ),
  );
};

const toTargets = (targetsKey: string): AgentSessionListTarget[] =>
  z.array(artifactScopeSchema).parse(JSON.parse(targetsKey));
