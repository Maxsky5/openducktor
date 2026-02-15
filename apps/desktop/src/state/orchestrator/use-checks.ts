import { errorMessage } from "@/state/orchestrator-helpers";
import type { BeadsCheck, RuntimeCheck, SystemCheck } from "@openblueprint/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { host } from "./host";

type UseChecksArgs = {
  activeRepo: string | null;
  setStatusText: (value: string) => void;
};

type UseChecksResult = {
  runtimeCheck: RuntimeCheck | null;
  activeBeadsCheck: BeadsCheck | null;
  systemCheck: SystemCheck | null;
  isLoadingChecks: boolean;
  setIsLoadingChecks: (value: boolean) => void;
  refreshRuntimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
  refreshChecks: () => Promise<void>;
  getCachedBeadsCheck: (repoPath: string) => BeadsCheck | null;
  hasRuntimeCheck: () => boolean;
  hasCachedBeadsCheck: (repoPath: string) => boolean;
  clearActiveBeadsCheck: () => void;
};

export function useChecks({ activeRepo, setStatusText }: UseChecksArgs): UseChecksResult {
  const [runtimeCheck, setRuntimeCheck] = useState<RuntimeCheck | null>(null);
  const [activeBeadsCheck, setActiveBeadsCheck] = useState<BeadsCheck | null>(null);
  const [isLoadingChecks, setIsLoadingChecks] = useState(false);
  const runtimeCheckRef = useRef<RuntimeCheck | null>(null);
  const beadsCheckCacheRef = useRef<Map<string, BeadsCheck>>(new Map());

  const refreshRuntimeCheck = useCallback(async (force = false): Promise<RuntimeCheck> => {
    if (!force && runtimeCheckRef.current) {
      return runtimeCheckRef.current;
    }

    const check = await host.runtimeCheck();
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

  const refreshChecks = useCallback(async (): Promise<void> => {
    if (!activeRepo) {
      return;
    }

    setIsLoadingChecks(true);
    setStatusText(`Refreshing checks for ${activeRepo}...`);
    try {
      const runtime = await refreshRuntimeCheck(true);
      const beads = await refreshBeadsCheckForRepo(activeRepo, true);
      if (!runtime.gitOk || !runtime.opencodeOk || !beads.beadsOk) {
        const details = [
          ...runtime.errors,
          ...(beads.beadsError ? [`beads: ${beads.beadsError}`] : []),
        ].join(" | ");
        setStatusText(`System check issues: ${details}`);
      } else {
        setStatusText("System checks passed");
      }
    } catch (error) {
      setStatusText(`System checks unavailable: ${errorMessage(error)}`);
    } finally {
      setIsLoadingChecks(false);
    }
  }, [activeRepo, refreshBeadsCheckForRepo, refreshRuntimeCheck, setStatusText]);

  const getCachedBeadsCheck = useCallback((repoPath: string): BeadsCheck | null => {
    return beadsCheckCacheRef.current.get(repoPath) ?? null;
  }, []);

  const hasCachedBeadsCheck = useCallback((repoPath: string): boolean => {
    return beadsCheckCacheRef.current.has(repoPath);
  }, []);

  const hasRuntimeCheck = useCallback((): boolean => {
    return runtimeCheckRef.current !== null;
  }, []);

  const clearActiveBeadsCheck = useCallback(() => {
    setActiveBeadsCheck(null);
  }, []);

  useEffect(() => {
    if (!activeRepo) {
      setActiveBeadsCheck(null);
      return;
    }

    setActiveBeadsCheck(beadsCheckCacheRef.current.get(activeRepo) ?? null);
  }, [activeRepo]);

  const systemCheck = useMemo<SystemCheck | null>(() => {
    if (!runtimeCheck || !activeBeadsCheck) {
      return null;
    }

    const errors = [...runtimeCheck.errors];
    if (activeBeadsCheck.beadsError) {
      errors.push(`beads: ${activeBeadsCheck.beadsError}`);
    }

    return {
      gitOk: runtimeCheck.gitOk,
      gitVersion: runtimeCheck.gitVersion,
      opencodeOk: runtimeCheck.opencodeOk,
      opencodeVersion: runtimeCheck.opencodeVersion,
      beadsOk: activeBeadsCheck.beadsOk,
      beadsPath: activeBeadsCheck.beadsPath,
      beadsError: activeBeadsCheck.beadsError,
      errors,
    };
  }, [activeBeadsCheck, runtimeCheck]);

  return {
    runtimeCheck,
    activeBeadsCheck,
    systemCheck,
    isLoadingChecks,
    setIsLoadingChecks,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshChecks,
    getCachedBeadsCheck,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    clearActiveBeadsCheck,
  };
}
