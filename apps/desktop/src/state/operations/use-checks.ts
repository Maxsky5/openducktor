import { errorMessage } from "@/lib/errors";
import type { BeadsCheck, RuntimeCheck } from "@openblueprint/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { host } from "./host";

type UseChecksArgs = {
  activeRepo: string | null;
};

type UseChecksResult = {
  runtimeCheck: RuntimeCheck | null;
  activeBeadsCheck: BeadsCheck | null;
  isLoadingChecks: boolean;
  setIsLoadingChecks: (value: boolean) => void;
  refreshRuntimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
  refreshChecks: () => Promise<void>;
  hasRuntimeCheck: () => boolean;
  hasCachedBeadsCheck: (repoPath: string) => boolean;
  clearActiveBeadsCheck: () => void;
};

export function useChecks({ activeRepo }: UseChecksArgs): UseChecksResult {
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
    try {
      const runtime = await refreshRuntimeCheck(true);
      const beads = await refreshBeadsCheckForRepo(activeRepo, true);
      if (!runtime.gitOk || !runtime.opencodeOk || !beads.beadsOk) {
        const details = [
          ...runtime.errors,
          ...(beads.beadsError ? [`beads: ${beads.beadsError}`] : []),
        ].join(" | ");
        toast.error("Diagnostics check failed", { description: details });
      }
    } catch (error) {
      toast.error("Diagnostics check unavailable", { description: errorMessage(error) });
    } finally {
      setIsLoadingChecks(false);
    }
  }, [activeRepo, refreshBeadsCheckForRepo, refreshRuntimeCheck]);

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

  return {
    runtimeCheck,
    activeBeadsCheck,
    isLoadingChecks,
    setIsLoadingChecks,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshChecks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    clearActiveBeadsCheck,
  };
}
