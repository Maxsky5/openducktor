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

const buildRuntimeCheckErrorState = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeCheckError: string,
): RuntimeCheck => ({
  gitOk: false,
  gitVersion: null,
  ghOk: false,
  ghVersion: null,
  ghAuthOk: false,
  ghAuthLogin: null,
  ghAuthError: runtimeCheckError,
  runtimes: runtimeDefinitions.map((definition) => ({
    kind: definition.kind,
    ok: false,
    version: null,
  })),
  errors: [runtimeCheckError],
});

const buildBeadsCheckErrorState = (beadsCheckError: string): BeadsCheck => ({
  beadsOk: false,
  beadsPath: null,
  beadsError: beadsCheckError,
});

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
        runtimeFailureKind: "error",
        runtime: null,
        mcpOk: false,
        mcpError: runtimeHealthError,
        mcpFailureKind: "error",
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
  const runtimeCheckError = runtimeCheckQuery.error ? errorMessage(runtimeCheckQuery.error) : null;
  const runtimeCheckFailureKind = classifyRepoRuntimeFailure(runtimeCheckError);
  const runtimeCheckState = useMemo((): RuntimeCheck | null => {
    if (runtimeCheckQuery.data) {
      return runtimeCheckQuery.data;
    }

    if (runtimeCheckError) {
      return buildRuntimeCheckErrorState(runtimeDefinitions, runtimeCheckError);
    }

    return null;
  }, [runtimeCheckError, runtimeCheckQuery.data, runtimeDefinitions]);
  const beadsCheckError = beadsCheckQuery.error ? errorMessage(beadsCheckQuery.error) : null;
  const beadsCheckFailureKind = classifyRepoRuntimeFailure(beadsCheckError);
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
  const diagnosticsToastIssues = useMemo((): DiagnosticsToastIssue[] => {
    if (activeRepo === null) {
      return [];
    }

    const issues: DiagnosticsToastIssue[] = [];

    if (runtimeCheckError && runtimeCheckFailureKind !== null) {
      issues.push(
        buildRuntimeHealthToastIssue({
          id: "diagnostics:cli-tools",
          label: "CLI tools",
          detail: runtimeCheckError,
          failureKind: runtimeCheckFailureKind,
        }),
      );
    }

    if (beadsCheckError && beadsCheckFailureKind !== null) {
      issues.push(
        buildRuntimeHealthToastIssue({
          id: "diagnostics:beads-store",
          label: "Beads store",
          detail: beadsCheckError,
          failureKind: beadsCheckFailureKind,
        }),
      );
    }

    issues.push(
      ...runtimeDefinitions.flatMap((definition) => {
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
      }),
    );

    return issues;
  }, [
    activeRepo,
    activeRepoRuntimeHealthByRuntime,
    beadsCheckError,
    beadsCheckFailureKind,
    runtimeCheckError,
    runtimeCheckFailureKind,
    runtimeDefinitions,
  ]);
  const hasDiagnosticsTimeoutIssue = diagnosticsToastIssues.some(
    (issue) => issue.severity === "timeout",
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

    const shouldRetryRuntimeCheckTimeout =
      runtimeCheckFailureKind === "timeout" && !runtimeCheckQuery.isFetching;
    const shouldRetryBeadsCheckTimeout =
      activeRepo !== null && beadsCheckFailureKind === "timeout" && !beadsCheckQuery.isFetching;
    const shouldRetryRuntimeHealthTimeout =
      activeRepo !== null &&
      hasDiagnosticsTimeoutIssue &&
      runtimeDefinitions.length > 0 &&
      !runtimeHealthQuery.isFetching;

    if (
      !shouldRetryRuntimeCheckTimeout &&
      !shouldRetryBeadsCheckTimeout &&
      !shouldRetryRuntimeHealthTimeout
    ) {
      return;
    }

    diagnosticsRetryTimeoutRef.current = globalThis.setTimeout(() => {
      diagnosticsRetryTimeoutRef.current = null;
      const retries: Promise<unknown>[] = [];

      if (shouldRetryRuntimeCheckTimeout) {
        retries.push(refreshRuntimeCheck(true));
      }

      if (shouldRetryBeadsCheckTimeout && activeRepo !== null) {
        retries.push(refreshBeadsCheckForRepo(activeRepo, true));
      }

      if (shouldRetryRuntimeHealthTimeout && activeRepo !== null) {
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
    beadsCheckFailureKind,
    beadsCheckQuery.isFetching,
    hasDiagnosticsTimeoutIssue,
    refreshBeadsCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
    refreshRuntimeCheck,
    runtimeCheckFailureKind,
    runtimeCheckQuery.isFetching,
    runtimeDefinitions.length,
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
    activeBeadsCheck,
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
