import type {
  BeadsCheck,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
} from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type {
  RepoRuntimeFailureKind,
  RepoRuntimeHealthCheck,
  RepoRuntimeHealthMap,
} from "@/types/diagnostics";
import {
  beadsCheckQueryOptions,
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

type UseChecksArgs = {
  activeRepo: string | null;
  runtimeDefinitions: RuntimeDescriptor[];
  checkRepoRuntimeHealth: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<RepoRuntimeHealthCheck>;
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

const RUNTIME_HEALTH_TIMEOUT_RETRY_DELAY_MS = 2_000;

const getSettledValue = <T>(result: PromiseSettledResult<T>): T => {
  if (result.status === "rejected") {
    throw result.reason;
  }

  return result.value;
};

export function useChecks({
  activeRepo,
  runtimeDefinitions,
  checkRepoRuntimeHealth,
}: UseChecksArgs): UseChecksResult {
  const queryClient = useQueryClient();
  const [isManualLoadingChecks, setIsManualLoadingChecks] = useState(false);
  const issueSignaturesRef = useRef(new Map<string, string>());
  const diagnosticsRetryTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const runtimeCheckQuery = useQuery(runtimeCheckQueryOptions());
  const beadsCheckQuery = useQuery({
    ...beadsCheckQueryOptions(activeRepo ?? "__disabled__"),
    enabled: activeRepo !== null,
  });
  const runtimeHealthQuery = useQuery({
    ...repoRuntimeHealthQueryOptions(
      activeRepo ?? "__disabled__",
      runtimeDefinitions,
      checkRepoRuntimeHealth,
    ),
    enabled: activeRepo !== null && runtimeDefinitions.length > 0,
  });

  const refreshRuntimeCheck = useCallback(
    async (force = false): Promise<RuntimeCheck> => {
      if (force) {
        await queryClient.invalidateQueries({
          queryKey: checksQueryKeys.runtime(),
          exact: true,
          refetchType: "none",
        });
        return queryClient.fetchQuery(runtimeCheckQueryOptions(true));
      }

      return loadRuntimeCheckFromQuery(queryClient);
    },
    [queryClient],
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
        ? queryClient.fetchQuery(beadsCheckQueryOptions(repoPath))
        : loadBeadsCheckFromQuery(queryClient, repoPath);
    },
    [queryClient],
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
    if (!activeRepo) {
      return;
    }

    setIsManualLoadingChecks(true);
    try {
      const [runtimeResult, beadsResult, runtimeHealthResult] = await Promise.allSettled([
        refreshRuntimeCheck(true),
        refreshBeadsCheckForRepo(activeRepo, true),
        refreshRepoRuntimeHealthForRepo(activeRepo, true),
      ]);
      const runtime = runtimeResult.status === "fulfilled" ? runtimeResult.value : null;
      const beads = beadsResult.status === "fulfilled" ? beadsResult.value : null;
      getSettledValue(runtimeHealthResult);
      if (runtime && beads && runtime.gitOk && beads.beadsOk) {
        return;
      }
    } finally {
      setIsManualLoadingChecks(false);
    }
  }, [activeRepo, refreshBeadsCheckForRepo, refreshRepoRuntimeHealthForRepo, refreshRuntimeCheck]);

  const hasCachedBeadsCheck = useCallback(
    (repoPath: string): boolean => {
      return queryClient.getQueryData(beadsCheckQueryOptions(repoPath).queryKey) !== undefined;
    },
    [queryClient],
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
    return queryClient.getQueryData(runtimeCheckQueryOptions().queryKey) !== undefined;
  }, [queryClient]);

  const clearActiveBeadsCheck = useCallback(() => {
    setIsManualLoadingChecks(false);
    if (activeRepo === null) {
      return;
    }
    queryClient.removeQueries({
      queryKey: checksQueryKeys.beads(activeRepo),
      exact: true,
    });
  }, [activeRepo, queryClient]);

  const clearActiveRepoRuntimeHealth = useCallback(() => {
    setIsManualLoadingChecks(false);
    if (activeRepo === null || runtimeDefinitions.length === 0) {
      return;
    }
    queryClient.removeQueries({
      queryKey: checksQueryKeys.runtimeHealth(
        activeRepo,
        runtimeDefinitions.map((definition) => definition.kind),
      ),
      exact: true,
    });
  }, [activeRepo, queryClient, runtimeDefinitions]);

  const activeRepoRuntimeHealthByRuntime = useMemo((): RepoRuntimeHealthMap => {
    if (activeRepo === null) {
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
    activeRepo,
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
  const activeBeadsCheck = useMemo((): BeadsCheck | null => {
    if (activeRepo === null) {
      return null;
    }

    if (beadsCheckQuery.data) {
      return beadsCheckQuery.data;
    }

    if (beadsCheckError) {
      return buildBeadsCheckErrorState(beadsCheckError);
    }

    return null;
  }, [activeRepo, beadsCheckError, beadsCheckQuery.data]);
  const diagnosticsToastIssues = useMemo(
    (): DiagnosticsToastIssue[] =>
      buildDiagnosticsToastIssues({
        activeRepo,
        runtimeDefinitions,
        runtimeCheckError,
        runtimeCheckFailureKind,
        beadsCheckError,
        beadsCheckFailureKind,
        runtimeHealthByRuntime: activeRepoRuntimeHealthByRuntime,
      }),
    [
      activeRepo,
      activeRepoRuntimeHealthByRuntime,
      beadsCheckError,
      beadsCheckFailureKind,
      runtimeCheckError,
      runtimeCheckFailureKind,
      runtimeDefinitions,
    ],
  );

  useEffect(() => {
    const nextIssueIds = new Set(diagnosticsToastIssues.map((issue) => issue.id));

    for (const issueId of [...issueSignaturesRef.current.keys()]) {
      if (nextIssueIds.has(issueId)) {
        continue;
      }

      toast.dismiss(issueId);
      issueSignaturesRef.current.delete(issueId);
    }

    for (const issue of diagnosticsToastIssues) {
      const signature = `${issue.severity}:${issue.title}:${issue.description}`;
      if (issueSignaturesRef.current.get(issue.id) === signature) {
        continue;
      }

      if (issue.severity === "timeout") {
        toast(issue.title, {
          id: issue.id,
          description: issue.description,
          duration: Number.POSITIVE_INFINITY,
        });
      } else {
        toast.error(issue.title, {
          id: issue.id,
          description: issue.description,
          duration: Number.POSITIVE_INFINITY,
        });
      }

      issueSignaturesRef.current.set(issue.id, signature);
    }
  }, [diagnosticsToastIssues]);

  useEffect(() => {
    if (diagnosticsRetryTimeoutRef.current !== null) {
      globalThis.clearTimeout(diagnosticsRetryTimeoutRef.current);
      diagnosticsRetryTimeoutRef.current = null;
    }

    const retryPlan = buildDiagnosticsRetryPlan({
      activeRepo,
      runtimeDefinitions,
      runtimeCheckFailureKind,
      runtimeCheckFetching: runtimeCheckQuery.isFetching,
      beadsCheckFailureKind,
      beadsCheckFetching: beadsCheckQuery.isFetching,
      runtimeHealthByRuntime: activeRepoRuntimeHealthByRuntime,
      runtimeHealthFetching: runtimeHealthQuery.isFetching,
    });

    if (
      !retryPlan.retryRuntimeCheck &&
      !retryPlan.retryBeadsCheck &&
      !retryPlan.retryRuntimeHealth
    ) {
      return;
    }

    diagnosticsRetryTimeoutRef.current = globalThis.setTimeout(() => {
      diagnosticsRetryTimeoutRef.current = null;
      const retries: Promise<unknown>[] = [];

      if (retryPlan.retryRuntimeCheck) {
        retries.push(refreshRuntimeCheck(true));
      }

      if (retryPlan.retryBeadsCheck && activeRepo !== null) {
        retries.push(refreshBeadsCheckForRepo(activeRepo, true));
      }

      if (retryPlan.retryRuntimeHealth && activeRepo !== null) {
        retries.push(refreshRepoRuntimeHealthForRepo(activeRepo, true));
      }

      void Promise.allSettled(retries);
    }, RUNTIME_HEALTH_TIMEOUT_RETRY_DELAY_MS);

    return () => {
      if (diagnosticsRetryTimeoutRef.current !== null) {
        globalThis.clearTimeout(diagnosticsRetryTimeoutRef.current);
        diagnosticsRetryTimeoutRef.current = null;
      }
    };
  }, [
    activeRepo,
    activeRepoRuntimeHealthByRuntime,
    beadsCheckFailureKind,
    beadsCheckQuery.isFetching,
    refreshBeadsCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
    refreshRuntimeCheck,
    runtimeCheckFailureKind,
    runtimeCheckQuery.isFetching,
    runtimeDefinitions,
    runtimeHealthQuery.isFetching,
  ]);

  useEffect(() => {
    return () => {
      if (diagnosticsRetryTimeoutRef.current !== null) {
        globalThis.clearTimeout(diagnosticsRetryTimeoutRef.current);
      }

      for (const issueId of issueSignaturesRef.current.keys()) {
        toast.dismiss(issueId);
      }
      issueSignaturesRef.current.clear();
    };
  }, []);

  const isLoadingChecks =
    isManualLoadingChecks ||
    runtimeCheckQuery.isFetching ||
    (activeRepo !== null &&
      (beadsCheckQuery.isFetching ||
        (runtimeDefinitions.length > 0 && runtimeHealthQuery.isFetching)));

  return {
    runtimeCheck: runtimeCheckState,
    runtimeCheckFailureKind,
    activeBeadsCheck,
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
