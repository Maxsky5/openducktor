import type {
  BeadsCheck,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
} from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { RepoRuntimeHealthCheck, RepoRuntimeHealthMap } from "@/types/diagnostics";
import { host } from "./host";

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

const toRuntimeHealthCacheKey = (repoPath: string, runtimeKind: RuntimeKind): string =>
  `${runtimeKind}::${repoPath}`;

const buildRuntimeHealthMap = (
  runtimeDefinitions: RuntimeDescriptor[],
  cache: Map<string, RepoRuntimeHealthCheck>,
  repoPath: string,
): RepoRuntimeHealthMap => {
  return Object.fromEntries(
    runtimeDefinitions.map((definition) => [
      definition.kind,
      cache.get(toRuntimeHealthCacheKey(repoPath, definition.kind)) ?? null,
    ]),
  );
};

export function useChecks({
  activeRepo,
  runtimeDefinitions,
  checkRepoRuntimeHealth,
}: UseChecksArgs): UseChecksResult {
  const [runtimeCheck, setRuntimeCheck] = useState<RuntimeCheck | null>(null);
  const [activeBeadsCheck, setActiveBeadsCheck] = useState<BeadsCheck | null>(null);
  const [activeRepoRuntimeHealthByRuntime, setActiveRepoRuntimeHealthByRuntime] =
    useState<RepoRuntimeHealthMap>({});
  const [isLoadingChecks, setIsLoadingChecks] = useState(false);
  const runtimeCheckRef = useRef<RuntimeCheck | null>(null);
  const beadsCheckCacheRef = useRef<Map<string, BeadsCheck>>(new Map());
  const runtimeHealthCacheRef = useRef<Map<string, RepoRuntimeHealthCheck>>(new Map());

  const refreshRuntimeCheck = useCallback(async (force = false): Promise<RuntimeCheck> => {
    if (!force && runtimeCheckRef.current) {
      return runtimeCheckRef.current;
    }

    const check = await host.runtimeCheck(force);
    runtimeCheckRef.current = check;
    setRuntimeCheck(check);
    return check;
  }, []);

  const refreshBeadsCheckForRepo = useCallback(
    async (repoPath: string, force = false): Promise<BeadsCheck> => {
      const cached = beadsCheckCacheRef.current.get(repoPath);
      if (cached && !force) {
        return cached;
      }

      const check = await host.beadsCheck(repoPath);
      beadsCheckCacheRef.current.set(repoPath, check);

      if (repoPath === activeRepo) {
        setActiveBeadsCheck(check);
      }

      return check;
    },
    [activeRepo],
  );

  const refreshRepoRuntimeHealthForRepo = useCallback(
    async (repoPath: string, force = false): Promise<RepoRuntimeHealthMap> => {
      if (runtimeDefinitions.length === 0) {
        if (repoPath === activeRepo) {
          setActiveRepoRuntimeHealthByRuntime({});
        }
        return {};
      }

      const hasAllCached = runtimeDefinitions.every((definition) =>
        runtimeHealthCacheRef.current.has(toRuntimeHealthCacheKey(repoPath, definition.kind)),
      );
      if (hasAllCached && !force) {
        const cached = buildRuntimeHealthMap(
          runtimeDefinitions,
          runtimeHealthCacheRef.current,
          repoPath,
        );
        if (repoPath === activeRepo) {
          setActiveRepoRuntimeHealthByRuntime(cached);
        }
        return cached;
      }

      const checks = await Promise.all(
        runtimeDefinitions.map(async (definition) => {
          const check = await checkRepoRuntimeHealth(repoPath, definition.kind);
          runtimeHealthCacheRef.current.set(
            toRuntimeHealthCacheKey(repoPath, definition.kind),
            check,
          );
          return [definition.kind, check] as const;
        }),
      );

      const runtimeHealthByRuntime = Object.fromEntries(checks) as RepoRuntimeHealthMap;

      if (repoPath === activeRepo) {
        setActiveRepoRuntimeHealthByRuntime(runtimeHealthByRuntime);
      }

      return runtimeHealthByRuntime;
    },
    [activeRepo, checkRepoRuntimeHealth, runtimeDefinitions],
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

  const hasCachedBeadsCheck = useCallback((repoPath: string): boolean => {
    return beadsCheckCacheRef.current.has(repoPath);
  }, []);

  const hasCachedRepoRuntimeHealth = useCallback(
    (repoPath: string, runtimeKinds: RuntimeKind[]): boolean => {
      return runtimeKinds.every((runtimeKind) =>
        runtimeHealthCacheRef.current.has(toRuntimeHealthCacheKey(repoPath, runtimeKind)),
      );
    },
    [],
  );

  const hasRuntimeCheck = useCallback((): boolean => {
    return runtimeCheckRef.current !== null;
  }, []);

  const clearActiveBeadsCheck = useCallback(() => {
    setActiveBeadsCheck(null);
  }, []);

  const clearActiveRepoRuntimeHealth = useCallback(() => {
    setActiveRepoRuntimeHealthByRuntime({});
  }, []);

  useEffect(() => {
    if (!activeRepo) {
      setActiveBeadsCheck(null);
      setActiveRepoRuntimeHealthByRuntime({});
      return;
    }

    setActiveBeadsCheck(beadsCheckCacheRef.current.get(activeRepo) ?? null);
    setActiveRepoRuntimeHealthByRuntime(
      buildRuntimeHealthMap(runtimeDefinitions, runtimeHealthCacheRef.current, activeRepo),
    );
  }, [activeRepo, runtimeDefinitions]);

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
