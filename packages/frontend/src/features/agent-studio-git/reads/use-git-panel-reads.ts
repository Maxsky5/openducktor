import type { GitLocalChanges } from "@openducktor/contracts";
import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  localChangesQueryOptions,
  refreshGitHistoryQueries,
  skippedLocalChangesQueryOptions,
  skippedWorktreeStatusQueryOptions,
  worktreeStatusQueryOptions,
} from "@/state/queries/git";
import type { DiffScope, DiffScopeState } from "../contracts";
import { toLocalScopeSnapshot, toScopeSnapshot } from "../model/normalization";
import { createEmptyScopeState, toFailedScopeState } from "../model/scope-state";

export type GitPanelReadsInput = {
  /** The repository to read, or null while reads cannot start. */
  repoPath: string | null;
  workingDir: string | null;
  /** The checked comparison reference. Branch changes read only after the comparison is ready. */
  comparisonReference: string | null;
  /** The checkout identity, so each checkout keeps its own cache entries. */
  cacheKey: string;
  enabled: boolean;
};

/** The reads of one Git context. Each action reads the keys of the render that made it. */
export type GitPanelReads = {
  scopeStatesByScope: Record<DiffScope, DiffScopeState>;
  loadedScopesByScope: Record<DiffScope, boolean>;
  /** True during a first read, and during a read that a refresh or a Git action asked for. */
  isLoading: boolean;
  /** Reads local changes again. Rejects when the read fails. */
  readLocal: () => Promise<void>;
  /**
   * Reads Branch changes and the shown History again. Rejects when Branch changes fail to read,
   * and also when History fails with `reject`.
   */
  readComparison: (historyFailure: "reject" | "show") => Promise<void>;
  /** Reads every shown read again. Each view shows its own failure. */
  readInBackground: () => Promise<void>;
  /**
   * Shows the local changes that a Git change returned, and reads Branch changes again in the
   * background, because the index can change how they list a file.
   */
  applyLocalChanges: (changes: GitLocalChanges) => Promise<void>;
};

const NO_COMPARISON = createEmptyScopeState();

const toScopeState = (data: DiffScopeState | undefined, error: Error | null): DiffScopeState => {
  const state = data ?? createEmptyScopeState();
  // The text format matches the host error that the panel shows.
  return error ? toFailedScopeState(state, String(error)) : state;
};

/**
 * Observes the local changes and Branch changes of one Git context. Query keeps each context in
 * its own cache entries, so a late read cannot enter another view, and a return to a context
 * shows its cached result without a new read.
 */
export function useGitPanelReads({
  repoPath,
  workingDir,
  comparisonReference,
  cacheKey,
  enabled,
}: GitPanelReadsInput): GitPanelReads {
  const queryClient = useQueryClient();
  const canRead = enabled && repoPath !== null;
  const hasComparison = repoPath !== null && comparisonReference !== null;
  const comparisonReady = canRead && hasComparison;
  // A hidden view keeps its keys, so its cached data and late results stay in view.
  const localOptions =
    repoPath !== null
      ? localChangesQueryOptions(repoPath, workingDir, cacheKey)
      : skippedLocalChangesQueryOptions();
  const comparisonOptions = hasComparison
    ? worktreeStatusQueryOptions(
        repoPath,
        comparisonReference,
        "target",
        workingDir,
        undefined,
        cacheKey,
      )
    : skippedWorktreeStatusQueryOptions();
  // A refresh or a Git action reads again. Opening a view reuses the cached result.
  const local = useQuery({
    ...localOptions,
    select: toLocalScopeSnapshot,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: canRead,
  });
  const comparison = useQuery({
    ...comparisonOptions,
    select: toScopeSnapshot,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: comparisonReady,
  });
  const localKey = localOptions.queryKey;
  const comparisonKey = comparisonOptions.queryKey;
  useCancelReadOnExit(hashKey(localKey));
  useCancelReadOnExit(hashKey(comparisonKey));
  const [foregroundReads, setForegroundReads] = useState(0);
  const inForeground = useCallback(async (read: Promise<unknown>): Promise<void> => {
    setForegroundReads((count) => count + 1);
    try {
      await read;
    } finally {
      setForegroundReads((count) => count - 1);
    }
  }, []);
  const historyDirectory = workingDir ?? repoPath;
  const readLocal = useCallback(async (): Promise<void> => {
    if (!canRead) return;
    await inForeground(
      queryClient.refetchQueries(
        { queryKey: localKey, exact: true, type: "active" },
        { throwOnError: true },
      ),
    );
  }, [canRead, inForeground, localKey, queryClient]);
  const readComparison = useCallback(
    async (historyFailure: "reject" | "show"): Promise<void> => {
      if (!comparisonReady || repoPath === null || historyDirectory === null) return;
      await inForeground(
        Promise.all([
          queryClient.refetchQueries(
            { queryKey: comparisonKey, exact: true, type: "active" },
            { throwOnError: true },
          ),
          refreshGitHistoryQueries(queryClient, repoPath, historyDirectory, {
            throwOnError: historyFailure === "reject",
          }),
        ]),
      );
    },
    [comparisonKey, comparisonReady, historyDirectory, inForeground, queryClient, repoPath],
  );
  const readInBackground = useCallback(async (): Promise<void> => {
    if (!canRead || repoPath === null || historyDirectory === null) return;
    // A scheduled fetch can move the target, so History reads again too.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: localKey, exact: true }),
      comparisonReady && queryClient.invalidateQueries({ queryKey: comparisonKey, exact: true }),
      refreshGitHistoryQueries(queryClient, repoPath, historyDirectory, { throwOnError: false }),
    ]);
  }, [canRead, comparisonKey, comparisonReady, historyDirectory, localKey, queryClient, repoPath]);
  // Primitive inputs keep this callback stable, so the Git actions that use it stay stable too.
  const applyLocalChanges = useCallback(
    async (changes: GitLocalChanges): Promise<void> => {
      if (repoPath === null) return;
      const key = localChangesQueryOptions(repoPath, workingDir, cacheKey).queryKey;
      // A read that started before the change must not replace the newer result.
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.setQueryData(key, changes);
      if (comparisonReference === null) return;
      const comparison = worktreeStatusQueryOptions(
        repoPath,
        comparisonReference,
        "target",
        workingDir,
        undefined,
        cacheKey,
      ).queryKey;
      // Branch changes show their own failed read, so this read does not delay the next change.
      void queryClient.invalidateQueries({ queryKey: comparison, exact: true });
    },
    [cacheKey, comparisonReference, queryClient, repoPath, workingDir],
  );
  const scopeStatesByScope = useMemo(
    () => ({
      uncommitted: toScopeState(local.data, local.error),
      target: hasComparison ? toScopeState(comparison.data, comparison.error) : NO_COMPARISON,
    }),
    [comparison.data, comparison.error, hasComparison, local.data, local.error],
  );
  const localLoaded = local.data !== undefined || local.isError;
  const comparisonLoaded = hasComparison && (comparison.data !== undefined || comparison.isError);
  const loadedScopesByScope = useMemo(
    () => ({ uncommitted: localLoaded, target: comparisonLoaded }),
    [comparisonLoaded, localLoaded],
  );
  return {
    scopeStatesByScope,
    loadedScopesByScope,
    isLoading: foregroundReads > 0 || (canRead && local.isPending),
    readLocal,
    readComparison,
    readInBackground,
    applyLocalChanges,
  };
}

/**
 * Stops an unfinished read when its context or view ends, so a later visit cannot join an old
 * read. Hiding the view keeps the read, so its result still reaches the cache.
 */
function useCancelReadOnExit(queryHash: string): void {
  const queryClient = useQueryClient();
  useLayoutEffect(() => {
    return () => {
      void queryClient.cancelQueries({ predicate: (query) => query.queryHash === queryHash });
    };
  }, [queryClient, queryHash]);
}
