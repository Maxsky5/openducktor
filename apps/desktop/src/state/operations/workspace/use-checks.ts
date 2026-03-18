import type {
  BeadsCheck,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { RepoRuntimeHealthCheck, RepoRuntimeHealthMap } from "@/types/diagnostics";
import {
  beadsCheckQueryOptions,
  checksQueryKeys,
  loadBeadsCheckFromQuery,
  loadRepoRuntimeHealthFromQuery,
  loadRuntimeCheckFromQuery,
  repoRuntimeHealthQueryOptions,
  runtimeCheckQueryOptions,
} from "../../queries/checks";
import { host } from "../shared/host";

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

const buildEmptyRuntimeHealthMap = (
  runtimeDefinitions: RuntimeDescriptor[],
): RepoRuntimeHealthMap =>
  Object.fromEntries(runtimeDefinitions.map((definition) => [definition.kind, null]));

export function useChecks({
  activeRepo,
  runtimeDefinitions,
  checkRepoRuntimeHealth,
}: UseChecksArgs): UseChecksResult {
  const queryClient = useQueryClient();
  const [runtimeCheck, setRuntimeCheck] = useState<RuntimeCheck | null>(null);
  const [activeBeadsCheck, setActiveBeadsCheck] = useState<BeadsCheck | null>(null);
  const [activeRepoRuntimeHealthByRuntime, setActiveRepoRuntimeHealthByRuntime] =
    useState<RepoRuntimeHealthMap>({});
  const [isLoadingChecks, setIsLoadingChecks] = useState(false);

  const refreshRuntimeCheck = useCallback(
    async (force = false): Promise<RuntimeCheck> => {
      if (force) {
        const check = await host.runtimeCheck(true);
        queryClient.setQueryData(checksQueryKeys.runtime(), check);
        setRuntimeCheck(check);
        return check;
      }

      const check = await loadRuntimeCheckFromQuery(queryClient);
      setRuntimeCheck(check);
      return check;
    },
    [queryClient],
  );

  const refreshBeadsCheckForRepo = useCallback(
    async (repoPath: string, force = false): Promise<BeadsCheck> => {
      if (force) {
        const check = await host.beadsCheck(repoPath);
        queryClient.setQueryData(checksQueryKeys.beads(repoPath), check);

        if (repoPath === activeRepo) {
          setActiveBeadsCheck(check);
        }

        return check;
      }

      const check = await loadBeadsCheckFromQuery(queryClient, repoPath);

      if (repoPath === activeRepo) {
        setActiveBeadsCheck(check);
      }

      return check;
    },
    [activeRepo, queryClient],
  );

  const refreshRepoRuntimeHealthForRepo = useCallback(
    async (repoPath: string, force = false): Promise<RepoRuntimeHealthMap> => {
      if (runtimeDefinitions.length === 0) {
        if (repoPath === activeRepo) {
          setActiveRepoRuntimeHealthByRuntime({});
        }
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
        });
      }

      const runtimeHealthByRuntime = await loadRepoRuntimeHealthFromQuery(
        queryClient,
        repoPath,
        runtimeDefinitions,
        checkRepoRuntimeHealth,
      );

      if (repoPath === activeRepo) {
        setActiveRepoRuntimeHealthByRuntime(runtimeHealthByRuntime);
      }

      return runtimeHealthByRuntime;
    },
    [activeRepo, checkRepoRuntimeHealth, queryClient, runtimeDefinitions],
  );

  const refreshChecks = useCallback(async (): Promise<void> => {
    if (!activeRepo) {
      return;
    }

    setIsLoadingChecks(true);
    try {
      const runtime = await refreshRuntimeCheck(true);
      const beads = await refreshBeadsCheckForRepo(activeRepo, true);
      const runtimeHealthByRuntime = await refreshRepoRuntimeHealthForRepo(activeRepo, true);
      const runtimesHealthy = runtime.runtimes.every((runtimeEntry) => runtimeEntry.ok);
      const runtimeHealthEntries = runtimeDefinitions.map(
        (definition) => runtimeHealthByRuntime[definition.kind],
      );
      const runtimeServersHealthy = runtimeHealthEntries.every(
        (entry) => entry?.runtimeOk !== false,
      );
      const runtimeMcpHealthy = runtimeDefinitions.every((definition) => {
        const health = runtimeHealthByRuntime[definition.kind];
        if (!definition.capabilities.supportsMcpStatus) {
          return true;
        }
        return health?.mcpOk !== false;
      });
      if (
        !runtime.gitOk ||
        !runtimesHealthy ||
        !beads.beadsOk ||
        !runtimeServersHealthy ||
        !runtimeMcpHealthy
      ) {
        const details = [
          ...runtime.errors,
          ...(beads.beadsError ? [`beads: ${beads.beadsError}`] : []),
          ...runtimeHealthEntries.flatMap((entry) => entry?.errors ?? []),
        ].join(" | ");
        toast.error("Diagnostics check failed", { description: details });
      }
    } catch (error) {
      toast.error("Diagnostics check unavailable", { description: errorMessage(error) });
    } finally {
      setIsLoadingChecks(false);
    }
  }, [
    activeRepo,
    refreshBeadsCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
    refreshRuntimeCheck,
    runtimeDefinitions,
  ]);

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
    setActiveBeadsCheck(null);
  }, []);

  const clearActiveRepoRuntimeHealth = useCallback(() => {
    setActiveRepoRuntimeHealthByRuntime({});
  }, []);

  useEffect(() => {
    setRuntimeCheck(
      (queryClient.getQueryData(runtimeCheckQueryOptions().queryKey) as RuntimeCheck | undefined) ??
        null,
    );

    if (!activeRepo) {
      setActiveBeadsCheck(null);
      setActiveRepoRuntimeHealthByRuntime({});
      return;
    }

    setActiveBeadsCheck(
      (queryClient.getQueryData(beadsCheckQueryOptions(activeRepo).queryKey) as
        | BeadsCheck
        | undefined) ?? null,
    );
    setActiveRepoRuntimeHealthByRuntime(
      (queryClient.getQueryData(
        checksQueryKeys.runtimeHealth(
          activeRepo,
          runtimeDefinitions.map((definition) => definition.kind),
        ),
      ) as RepoRuntimeHealthMap | undefined) ?? buildEmptyRuntimeHealthMap(runtimeDefinitions),
    );
  }, [activeRepo, queryClient, runtimeDefinitions]);

  return {
    runtimeCheck,
    activeBeadsCheck,
    activeRepoRuntimeHealthByRuntime,
    isLoadingChecks,
    setIsLoadingChecks,
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
