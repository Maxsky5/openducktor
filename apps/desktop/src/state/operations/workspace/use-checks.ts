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
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import {
  classifyRepoRuntimeFailure,
  type RepoRuntimeFailureKind,
  type RepoRuntimeHealthCheck,
  type RepoRuntimeHealthMap,
} from "@/types/diagnostics";
import {
  beadsCheckQueryOptions,
  checksQueryKeys,
  loadBeadsCheckFromQuery,
  loadRepoRuntimeHealthFromQuery,
  loadRuntimeCheckFromQuery,
  repoRuntimeHealthQueryOptions,
  runtimeCheckQueryOptions,
} from "../../queries/checks";

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
  activeBeadsCheck: BeadsCheck | null;
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

type DiagnosticsToastIssue = {
  id: string;
  title: string;
  description: string;
  severity: Exclude<RepoRuntimeFailureKind, null>;
};

const RUNTIME_HEALTH_TIMEOUT_RETRY_DELAY_MS = 2_000;
const MANUAL_DIAGNOSTICS_UNAVAILABLE_TOAST_ID = "diagnostics:manual-unavailable";

const buildRuntimeHealthErrorMap = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeHealthError: string,
  checkedAt: string,
): RepoRuntimeHealthMap => {
  return Object.fromEntries(
    runtimeDefinitions.map((definition) => [
      definition.kind,
      {
        runtimeOk: false,
        runtimeError: runtimeHealthError,
        runtimeFailureKind: classifyRepoRuntimeFailure(runtimeHealthError),
        runtime: null,
        mcpOk: false,
        mcpError: runtimeHealthError,
        mcpFailureKind: classifyRepoRuntimeFailure(runtimeHealthError),
        mcpServerName: ODT_MCP_SERVER_NAME,
        mcpServerStatus: null,
        mcpServerError: runtimeHealthError,
        availableToolIds: [],
        checkedAt,
        errors: [runtimeHealthError],
      },
    ]),
  ) as RepoRuntimeHealthMap;
};

const getSettledErrorDescriptions = (
  results: Array<{ label: string; result: PromiseSettledResult<unknown> }>,
): string[] => {
  return results.flatMap(({ label, result }) => {
    if (result.status === "fulfilled") {
      return [];
    }

    return [`${label}: ${errorMessage(result.reason)}`];
  });
};

const getSettledValue = <T>(result: PromiseSettledResult<T>): T => {
  if (result.status === "rejected") {
    throw result.reason;
  }

  return result.value;
};

const buildTimeoutToastDescription = (label: string, detail: string | null): string => {
  if (!detail) {
    return `${label} is not yet available. Retrying automatically.`;
  }

  return `${label} is not yet available. Retrying automatically. Latest detail: ${detail}`;
};

const buildErrorToastDescription = (label: string, detail: string | null): string => {
  return detail ?? `${label} is unavailable.`;
};

const buildRuntimeHealthToastIssue = ({
  id,
  label,
  detail,
  failureKind,
}: {
  id: string;
  label: string;
  detail: string | null;
  failureKind: Exclude<RepoRuntimeFailureKind, null>;
}): DiagnosticsToastIssue => {
  return failureKind === "timeout"
    ? {
        id,
        title: `${label} not yet available`,
        description: buildTimeoutToastDescription(label, detail),
        severity: failureKind,
      }
    : {
        id,
        title: `${label} unavailable`,
        description: buildErrorToastDescription(label, detail),
        severity: failureKind,
      };
};

export function useChecks({
  activeRepo,
  runtimeDefinitions,
  checkRepoRuntimeHealth,
}: UseChecksArgs): UseChecksResult {
  const queryClient = useQueryClient();
  const [isManualLoadingChecks, setIsManualLoadingChecks] = useState(false);
  const issueSignaturesRef = useRef(new Map<string, string>());
  const runtimeHealthRetryTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(
    null,
  );
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
      const unavailableDetails = getSettledErrorDescriptions([
        { label: "runtime", result: runtimeResult },
        { label: "beads", result: beadsResult },
      ]);

      if (unavailableDetails.length > 0) {
        toast.error("Diagnostics check unavailable", {
          id: MANUAL_DIAGNOSTICS_UNAVAILABLE_TOAST_ID,
          description: unavailableDetails.join(" | "),
          duration: Number.POSITIVE_INFINITY,
        });
        return;
      }

      toast.dismiss(MANUAL_DIAGNOSTICS_UNAVAILABLE_TOAST_ID);

      const runtime = getSettledValue(runtimeResult);
      const beads = getSettledValue(beadsResult);
      getSettledValue(runtimeHealthResult);
      if (runtime.gitOk && beads.beadsOk) {
        toast.dismiss(MANUAL_DIAGNOSTICS_UNAVAILABLE_TOAST_ID);
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
  const runtimeHealthToastIssues = useMemo((): DiagnosticsToastIssue[] => {
    if (activeRepo === null) {
      return [];
    }

    return runtimeDefinitions.flatMap((definition) => {
      const runtimeHealth = activeRepoRuntimeHealthByRuntime[definition.kind];
      if (!runtimeHealth) {
        return [];
      }

      if (runtimeHealth.runtimeOk === false && runtimeHealth.runtimeFailureKind !== null) {
        return [
          buildRuntimeHealthToastIssue({
            id: `diagnostics:runtime:${definition.kind}`,
            label: `${definition.label} runtime`,
            detail: runtimeHealth.runtimeError,
            failureKind: runtimeHealth.runtimeFailureKind,
          }),
        ];
      }

      if (
        definition.capabilities.supportsMcpStatus &&
        runtimeHealth.mcpOk === false &&
        runtimeHealth.mcpFailureKind !== null
      ) {
        return [
          buildRuntimeHealthToastIssue({
            id: `diagnostics:mcp:${definition.kind}`,
            label: `${definition.label} OpenDucktor MCP`,
            detail: runtimeHealth.mcpServerError ?? runtimeHealth.mcpError,
            failureKind: runtimeHealth.mcpFailureKind,
          }),
        ];
      }

      return [];
    });
  }, [activeRepo, activeRepoRuntimeHealthByRuntime, runtimeDefinitions]);
  const hasRuntimeHealthTimeoutIssue = runtimeHealthToastIssues.some(
    (issue) => issue.severity === "timeout",
  );

  useEffect(() => {
    const nextIssueIds = new Set(runtimeHealthToastIssues.map((issue) => issue.id));

    for (const issueId of [...issueSignaturesRef.current.keys()]) {
      if (nextIssueIds.has(issueId)) {
        continue;
      }

      toast.dismiss(issueId);
      issueSignaturesRef.current.delete(issueId);
    }

    for (const issue of runtimeHealthToastIssues) {
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
  }, [runtimeHealthToastIssues]);

  useEffect(() => {
    if (runtimeHealthRetryTimeoutRef.current !== null) {
      globalThis.clearTimeout(runtimeHealthRetryTimeoutRef.current);
      runtimeHealthRetryTimeoutRef.current = null;
    }

    if (
      activeRepo === null ||
      !hasRuntimeHealthTimeoutIssue ||
      runtimeHealthQuery.isFetching ||
      runtimeDefinitions.length === 0
    ) {
      return;
    }

    runtimeHealthRetryTimeoutRef.current = globalThis.setTimeout(() => {
      runtimeHealthRetryTimeoutRef.current = null;
      void refreshRepoRuntimeHealthForRepo(activeRepo, true).catch(() => undefined);
    }, RUNTIME_HEALTH_TIMEOUT_RETRY_DELAY_MS);

    return () => {
      if (runtimeHealthRetryTimeoutRef.current !== null) {
        globalThis.clearTimeout(runtimeHealthRetryTimeoutRef.current);
        runtimeHealthRetryTimeoutRef.current = null;
      }
    };
  }, [
    activeRepo,
    hasRuntimeHealthTimeoutIssue,
    refreshRepoRuntimeHealthForRepo,
    runtimeDefinitions.length,
    runtimeHealthQuery.isFetching,
  ]);

  useEffect(() => {
    return () => {
      if (runtimeHealthRetryTimeoutRef.current !== null) {
        globalThis.clearTimeout(runtimeHealthRetryTimeoutRef.current);
      }

      for (const issueId of issueSignaturesRef.current.keys()) {
        toast.dismiss(issueId);
      }
      toast.dismiss(MANUAL_DIAGNOSTICS_UNAVAILABLE_TOAST_ID);
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
    runtimeCheck: runtimeCheckQuery.data ?? null,
    activeBeadsCheck: activeRepo === null ? null : (beadsCheckQuery.data ?? null),
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
