import type {
  BeadsCheck,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
} from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { isRepoStoreReady } from "@/lib/repo-store-health";
import type {
  RepoRuntimeFailureKind,
  RepoRuntimeHealthCheck,
  RepoRuntimeHealthMap,
} from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  beadsCheckQueryOptions,
  type ChecksQueryDependencies,
  checksQueryKeys,
  classifyDiagnosticsQueryError,
  loadBeadsCheckFromQuery,
  loadRepoRuntimeHealthFromQuery,
  loadRuntimeCheckFromQuery,
  repoRuntimeHealthQueryOptions,
  runtimeCheckQueryOptions,
} from "../../queries/checks";
import {
  buildBeadsCheckErrorState,
  buildDiagnosticsRetryPlan,
  buildDiagnosticsToastIssues,
  buildRuntimeCheckErrorState,
  buildRuntimeHealthErrorMap,
  type DiagnosticsToastIssue,
} from "./check-diagnostics";
import {
  type DiagnosticsToastApi,
  useDiagnosticsRetryScheduler,
  useDiagnosticsToasts,
} from "./use-check-diagnostics-effects";

type UseChecksArgs = {
  activeWorkspace: ActiveWorkspace | null;
  runtimeDefinitions: RuntimeDescriptor[];
  checkRepoRuntimeHealth: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<RepoRuntimeHealthCheck>;
  runtimeCheck?: ChecksQueryDependencies["runtimeCheck"];
  beadsCheck?: ChecksQueryDependencies["beadsCheck"];
  toastApi?: DiagnosticsToastApi;
};

type UseChecksResult = {
  runtimeCheck: RuntimeCheck | null;
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  activeBeadsCheck: BeadsCheck | null;
  beadsCheckFailureKind: RepoRuntimeFailureKind;
  activeRepoRuntimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingChecks: boolean;
  setIsLoadingChecks: (value: boolean) => void;
  refreshRuntimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
  refreshRepoRuntimeHealthForRepo: (
    repoPath: string,
    force?: boolean,
  ) => Promise<RepoRuntimeHealthMap>;
  refreshChecks: () => Promise<void>;
  hasRuntimeCheck: () => boolean;
  hasCachedBeadsCheck: (repoPath: string) => boolean;
  hasCachedRepoRuntimeHealth: (repoPath: string, runtimeKinds: RuntimeKind[]) => boolean;
  clearActiveBeadsCheck: () => void;
  clearActiveRepoRuntimeHealth: () => void;
};

export function useChecks({
  activeWorkspace,
  runtimeDefinitions,
  checkRepoRuntimeHealth,
  runtimeCheck,
  beadsCheck,
  toastApi,
}: UseChecksArgs): UseChecksResult {
  const activeRepoPath = activeWorkspace?.repoPath ?? null;
  const queryClient = useQueryClient();
  const [isManualLoadingChecks, setIsManualLoadingChecks] = useState(false);
  const runtimeCheckQuery = useQuery(runtimeCheckQueryOptions(false, runtimeCheck));
  const beadsCheckQuery = useQuery({
    ...beadsCheckQueryOptions(activeRepoPath ?? "__disabled__", beadsCheck),
    enabled: activeRepoPath !== null,
  });
  const runtimeHealthQuery = useQuery({
    ...repoRuntimeHealthQueryOptions(
      activeRepoPath ?? "__disabled__",
      runtimeDefinitions,
      checkRepoRuntimeHealth,
    ),
    enabled: activeRepoPath !== null && runtimeDefinitions.length > 0,
  });

  const refreshRuntimeCheck = useCallback(
    async (force = false): Promise<RuntimeCheck> => {
      if (force) {
        await queryClient.invalidateQueries({
          queryKey: checksQueryKeys.runtime(),
          exact: true,
          refetchType: "none",
        });
        return queryClient.fetchQuery(runtimeCheckQueryOptions(true, runtimeCheck));
      }

      return loadRuntimeCheckFromQuery(queryClient, runtimeCheck);
    },
    [queryClient, runtimeCheck],
  );

  const refreshBeadsCheckForRepo = useCallback(
    async (repoPath: string, force = false): Promise<BeadsCheck> => {
      if (force) {
        await queryClient.invalidateQueries({
          queryKey: checksQueryKeys.beads(repoPath),
          exact: true,
          refetchType: "none",
        });
      }

      return force
        ? queryClient.fetchQuery(beadsCheckQueryOptions(repoPath, beadsCheck))
        : loadBeadsCheckFromQuery(queryClient, repoPath, beadsCheck);
    },
    [beadsCheck, queryClient],
  );

  const refreshRepoRuntimeHealthForRepo = useCallback(
    async (repoPath: string, force = false): Promise<RepoRuntimeHealthMap> => {
      if (runtimeDefinitions.length === 0) {
        return {};
      }

      const queryOptions = repoRuntimeHealthQueryOptions(
        repoPath,
        runtimeDefinitions,
        checkRepoRuntimeHealth,
      );

      if (force) {
        await queryClient.invalidateQueries({
          queryKey: queryOptions.queryKey,
          exact: true,
          refetchType: "none",
        });
        return queryClient.fetchQuery(queryOptions);
      }

      return loadRepoRuntimeHealthFromQuery(
        queryClient,
        repoPath,
        runtimeDefinitions,
        checkRepoRuntimeHealth,
      );
    },
    [checkRepoRuntimeHealth, queryClient, runtimeDefinitions],
  );

  const refreshChecks = useCallback(async (): Promise<void> => {
    if (!activeRepoPath) {
      return;
    }

    setIsManualLoadingChecks(true);
    try {
      const [runtimeResult, beadsResult, runtimeHealthResult] = await Promise.allSettled([
        refreshRuntimeCheck(true),
        refreshBeadsCheckForRepo(activeRepoPath, true),
        refreshRepoRuntimeHealthForRepo(activeRepoPath, true),
      ]);

      if (runtimeResult.status === "rejected") {
        throw runtimeResult.reason;
      }

      if (beadsResult.status === "rejected") {
        throw beadsResult.reason;
      }

      if (runtimeHealthResult.status === "rejected") {
        throw runtimeHealthResult.reason;
      }

      const runtime = runtimeResult.value;
      const beads = beadsResult.value;

      if (runtime && beads && runtime.gitOk && isRepoStoreReady(beads)) {
        return;
      }
    } finally {
      setIsManualLoadingChecks(false);
    }
  }, [
    activeRepoPath,
    refreshBeadsCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
    refreshRuntimeCheck,
  ]);

  const hasCachedBeadsCheck = useCallback(
    (repoPath: string): boolean => {
      return (
        queryClient.getQueryData(beadsCheckQueryOptions(repoPath, beadsCheck).queryKey) !==
        undefined
      );
    },
    [beadsCheck, queryClient],
  );

  const hasCachedRepoRuntimeHealth = useCallback(
    (repoPath: string, runtimeKinds: RuntimeKind[]): boolean => {
      return (
        queryClient.getQueryData(checksQueryKeys.runtimeHealth(repoPath, runtimeKinds)) !==
        undefined
      );
    },
    [queryClient],
  );

  const hasRuntimeCheck = useCallback((): boolean => {
    return (
      queryClient.getQueryData(runtimeCheckQueryOptions(false, runtimeCheck).queryKey) !== undefined
    );
  }, [queryClient, runtimeCheck]);

  const clearActiveBeadsCheck = useCallback(() => {
    setIsManualLoadingChecks(false);
    if (activeRepoPath === null) {
      return;
    }
    queryClient.removeQueries({
      queryKey: checksQueryKeys.beads(activeRepoPath),
      exact: true,
    });
  }, [activeRepoPath, queryClient]);

  const clearActiveRepoRuntimeHealth = useCallback(() => {
    setIsManualLoadingChecks(false);
    if (activeRepoPath === null || runtimeDefinitions.length === 0) {
      return;
    }
    queryClient.removeQueries({
      queryKey: checksQueryKeys.runtimeHealth(
        activeRepoPath,
        runtimeDefinitions.map((definition) => definition.kind),
      ),
      exact: true,
    });
  }, [activeRepoPath, queryClient, runtimeDefinitions]);

  const activeRepoRuntimeHealthByRuntime = useMemo((): RepoRuntimeHealthMap => {
    if (activeRepoPath === null) {
      return {};
    }

    if (runtimeHealthQuery.error && runtimeDefinitions.length > 0) {
      const runtimeHealthError = errorMessage(runtimeHealthQuery.error);
      const checkedAt =
        runtimeHealthQuery.errorUpdatedAt > 0
          ? new Date(runtimeHealthQuery.errorUpdatedAt).toISOString()
          : new Date().toISOString();
      return buildRuntimeHealthErrorMap(runtimeDefinitions, runtimeHealthError, checkedAt);
    }

    if (runtimeHealthQuery.data) {
      return runtimeHealthQuery.data;
    }

    return {};
  }, [
    activeRepoPath,
    runtimeDefinitions,
    runtimeHealthQuery.data,
    runtimeHealthQuery.error,
    runtimeHealthQuery.errorUpdatedAt,
  ]);
  const runtimeCheckQueryFailure = runtimeCheckQuery.error
    ? classifyDiagnosticsQueryError(runtimeCheckQuery.error)
    : null;
  const runtimeCheckError = runtimeCheckQueryFailure?.message ?? null;
  const runtimeCheckFailureKind = runtimeCheckQueryFailure?.failureKind ?? null;
  const runtimeCheckState = useMemo((): RuntimeCheck | null => {
    if (runtimeCheckQuery.data) {
      return runtimeCheckQuery.data;
    }

    if (runtimeCheckError) {
      return buildRuntimeCheckErrorState(runtimeDefinitions, runtimeCheckError);
    }

    return null;
  }, [runtimeCheckError, runtimeCheckQuery.data, runtimeDefinitions]);
  const beadsCheckQueryFailure = beadsCheckQuery.error
    ? classifyDiagnosticsQueryError(beadsCheckQuery.error)
    : null;
  const beadsCheckError = beadsCheckQueryFailure?.message ?? null;
  const beadsCheckFailureKind = beadsCheckQueryFailure?.failureKind ?? null;
  const rawBeadsCheck = useMemo((): BeadsCheck | null => {
    if (activeRepoPath === null) {
      return null;
    }

    if (beadsCheckQuery.data) {
      return beadsCheckQuery.data;
    }

    if (beadsCheckError) {
      return buildBeadsCheckErrorState(beadsCheckError);
    }

    return null;
  }, [activeRepoPath, beadsCheckError, beadsCheckQuery.data]);
  const diagnosticsToastIssues = useMemo(
    (): DiagnosticsToastIssue[] =>
      buildDiagnosticsToastIssues({
        activeWorkspace,
        runtimeDefinitions,
        runtimeCheck: runtimeCheckState,
        runtimeCheckError,
        runtimeCheckFailureKind,
        beadsCheck: rawBeadsCheck,
        beadsCheckError,
        beadsCheckFailureKind,
        runtimeHealthByRuntime: activeRepoRuntimeHealthByRuntime,
      }),
    [
      activeWorkspace,
      rawBeadsCheck,
      activeRepoRuntimeHealthByRuntime,
      beadsCheckError,
      beadsCheckFailureKind,
      runtimeCheckState,
      runtimeCheckError,
      runtimeCheckFailureKind,
      runtimeDefinitions,
    ],
  );

  const diagnosticsRetryPlan = useMemo(
    () =>
      buildDiagnosticsRetryPlan({
        activeWorkspace,
        runtimeDefinitions,
        runtimeCheckFailureKind,
        runtimeCheckFetching: runtimeCheckQuery.isFetching,
        beadsCheckFailureKind,
        beadsCheckFetching: beadsCheckQuery.isFetching,
        runtimeHealthByRuntime: activeRepoRuntimeHealthByRuntime,
        runtimeHealthFetching: runtimeHealthQuery.isFetching,
      }),
    [
      activeWorkspace,
      activeRepoRuntimeHealthByRuntime,
      beadsCheckFailureKind,
      beadsCheckQuery.isFetching,
      runtimeCheckFailureKind,
      runtimeCheckQuery.isFetching,
      runtimeDefinitions,
      runtimeHealthQuery.isFetching,
    ],
  );

  useDiagnosticsToasts(diagnosticsToastIssues, toastApi);
  useDiagnosticsRetryScheduler({
    activeWorkspace,
    retryPlan: diagnosticsRetryPlan,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
  });

  const isLoadingChecks =
    isManualLoadingChecks ||
    runtimeCheckQuery.isFetching ||
    (activeRepoPath !== null &&
      (beadsCheckQuery.isFetching ||
        (runtimeDefinitions.length > 0 && runtimeHealthQuery.isFetching)));

  return {
    runtimeCheck: runtimeCheckState,
    runtimeCheckFailureKind,
    activeBeadsCheck: rawBeadsCheck,
    beadsCheckFailureKind,
    activeRepoRuntimeHealthByRuntime,
    isLoadingChecks,
    setIsLoadingChecks: setIsManualLoadingChecks,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
    refreshChecks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    hasCachedRepoRuntimeHealth,
    clearActiveBeadsCheck,
    clearActiveRepoRuntimeHealth,
  };
}
