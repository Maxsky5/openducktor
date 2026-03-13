import type { GitBranch, GitCurrentBranch, WorkspaceRecord } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { DEFAULT_RUNTIME_KIND } from "@/state/agent-runtime-registry";
import { host } from "./host";
import {
  BRANCH_PROBE_ERROR_TOAST_THROTTLE_MS,
  BRANCH_SYNC_INTERVAL_MS,
  type BranchProbeError,
  type BranchProbeOutcome,
  branchProbeErrorSignature,
  classifyBranchProbeError,
  hasBranchIdentityChanged,
  normalizeRepoPath,
  shouldProbeExternalBranchChange,
  shouldReportBranchProbeError,
  shouldResetBranchStateForRepoChange,
  shouldSkipBranchSwitch,
} from "./workspace-operations-model";

type UseWorkspaceOperationsArgs = {
  activeRepo: string | null;
  setActiveRepo: (repoPath: string | null) => void;
  clearTaskData: () => void;
  clearActiveBeadsCheck: () => void;
};

type UseWorkspaceOperationsResult = {
  workspaces: WorkspaceRecord[];
  branches: GitBranch[];
  activeBranch: GitCurrentBranch | null;
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  branchSyncDegraded: boolean;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (repoPath: string) => Promise<void>;
  selectWorkspace: (repoPath: string) => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  switchBranch: (branchName: string) => Promise<void>;
  clearBranchData: () => void;
  applyWorkspaceRecords: (records: WorkspaceRecord[]) => void;
  applyWorkspaceRecord: (record: WorkspaceRecord) => void;
};

export function useWorkspaceOperations({
  activeRepo,
  setActiveRepo,
  clearTaskData,
  clearActiveBeadsCheck,
}: UseWorkspaceOperationsArgs): UseWorkspaceOperationsResult {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [activeBranch, setActiveBranch] = useState<GitCurrentBranch | null>(null);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  const [branchSyncDegraded, setBranchSyncDegraded] = useState(false);
  const workspaceSwitchVersionRef = useRef(0);
  const branchRequestVersionRef = useRef(0);
  const branchSyncInFlightRef = useRef(false);
  const lastProbeErrorToastAtRef = useRef<number | null>(null);
  const lastProbeErrorSignatureRef = useRef<string | null>(null);
  const lastKnownBranchNameRef = useRef<string | null>(null);
  const lastKnownDetachedRef = useRef<boolean | null>(null);
  const lastKnownRevisionRef = useRef<string | null>(null);
  const activeRepoRef = useRef(activeRepo);
  const previousActiveRepoRef = useRef(activeRepo);
  const probeGatesRef = useRef({
    isSwitchingWorkspace,
    isLoadingBranches,
    isSwitchingBranch,
  });

  probeGatesRef.current.isSwitchingWorkspace = isSwitchingWorkspace;
  probeGatesRef.current.isLoadingBranches = isLoadingBranches;
  probeGatesRef.current.isSwitchingBranch = isSwitchingBranch;

  const applyBranchState = useCallback(
    (current: GitCurrentBranch, allBranches: GitBranch[]): void => {
      setActiveBranch(current);
      setBranches(allBranches);
      lastKnownBranchNameRef.current = current.name ?? null;
      lastKnownDetachedRef.current = current.detached;
      lastKnownRevisionRef.current = current.revision ?? null;
      setBranchSyncDegraded(false);
    },
    [],
  );

  const clearBranchData = useCallback((): void => {
    branchRequestVersionRef.current += 1;
    branchSyncInFlightRef.current = false;
    lastProbeErrorToastAtRef.current = null;
    lastProbeErrorSignatureRef.current = null;
    lastKnownBranchNameRef.current = null;
    lastKnownDetachedRef.current = null;
    lastKnownRevisionRef.current = null;
    setBranches([]);
    setActiveBranch(null);
    setBranchSyncDegraded(false);
    setIsLoadingBranches(false);
    setIsSwitchingBranch(false);
  }, []);

  useEffect(() => {
    const previousActiveRepo = previousActiveRepoRef.current;

    previousActiveRepoRef.current = activeRepo;
    activeRepoRef.current = activeRepo;

    if (shouldResetBranchStateForRepoChange(previousActiveRepo, activeRepo)) {
      clearBranchData();
    }
  }, [activeRepo, clearBranchData]);

  const applyWorkspaceRecords = useCallback(
    (records: WorkspaceRecord[]): void => {
      setWorkspaces(records);
      const active = records.find((entry) => entry.isActive);
      setActiveRepo(active?.path ?? null);
    },
    [setActiveRepo],
  );

  const applyWorkspaceRecord = useCallback(
    (record: WorkspaceRecord): void => {
      setWorkspaces((current) => {
        const next = current.filter((entry) => entry.path !== record.path);
        next.push(record);
        next.sort((left, right) => left.path.localeCompare(right.path));
        return next;
      });
      if (record.isActive) {
        setActiveRepo(record.path);
      }
    },
    [setActiveRepo],
  );

  const refreshBranchesForRepo = useCallback(
    async (repoPath: string): Promise<void> => {
      const requestVersion = ++branchRequestVersionRef.current;
      setIsLoadingBranches(true);

      try {
        const [current, allBranches] = await Promise.all([
          host.gitGetCurrentBranch(repoPath),
          host.gitGetBranches(repoPath),
        ]);

        if (
          branchRequestVersionRef.current !== requestVersion ||
          activeRepoRef.current !== repoPath
        ) {
          return;
        }

        applyBranchState(current, allBranches);
      } finally {
        if (
          branchRequestVersionRef.current === requestVersion &&
          activeRepoRef.current === repoPath
        ) {
          setIsLoadingBranches(false);
        }
      }
    },
    [applyBranchState],
  );

  const refreshBranches = useCallback(
    async (force = false): Promise<void> => {
      if (!activeRepo) {
        clearBranchData();
        return;
      }

      try {
        await refreshBranchesForRepo(activeRepo);
      } catch (error) {
        if (force) {
          toast.error("Branch data unavailable", {
            description: errorMessage(error),
          });
        }
        throw error;
      }
    },
    [activeRepo, clearBranchData, refreshBranchesForRepo],
  );

  const switchBranch = useCallback(
    async (branchName: string): Promise<void> => {
      if (!activeRepo || !branchName) {
        return;
      }

      if (shouldSkipBranchSwitch(activeBranch, branchName)) {
        return;
      }

      const previousBranch = activeBranch;
      const requestVersion = ++branchRequestVersionRef.current;
      setIsSwitchingBranch(true);

      try {
        const current = await host.gitSwitchBranch(activeRepo, branchName);
        const allBranches = await host.gitGetBranches(activeRepo);

        if (branchRequestVersionRef.current !== requestVersion) {
          return;
        }

        applyBranchState(current, allBranches);
      } catch (error) {
        if (branchRequestVersionRef.current !== requestVersion) {
          return;
        }

        setActiveBranch(previousBranch);
        lastKnownBranchNameRef.current = previousBranch?.name ?? null;
        lastKnownDetachedRef.current = previousBranch?.detached ?? null;
        lastKnownRevisionRef.current = previousBranch?.revision ?? null;

        toast.error("Failed to switch branch", {
          description: errorMessage(error),
        });
        throw error;
      } finally {
        if (branchRequestVersionRef.current === requestVersion) {
          setIsSwitchingBranch(false);
          setIsLoadingBranches(false);
        }
      }
    },
    [activeBranch, activeRepo, applyBranchState],
  );

  const reportBranchProbeError = useCallback((error: BranchProbeError): void => {
    const nowMs = Date.now();
    const errorSignature = branchProbeErrorSignature(error);
    const shouldReport = shouldReportBranchProbeError({
      nowMs,
      throttleMs: BRANCH_PROBE_ERROR_TOAST_THROTTLE_MS,
      errorSignature,
      lastReportedAtMs: lastProbeErrorToastAtRef.current,
      lastReportedSignature: lastProbeErrorSignatureRef.current,
    });

    if (!shouldReport) {
      return;
    }

    lastProbeErrorToastAtRef.current = nowMs;
    lastProbeErrorSignatureRef.current = errorSignature;

    toast.error("Branch sync probe degraded", {
      description: `[${error.stage}] ${error.message}`,
    });
  }, []);

  const probeExternalBranchChange = useCallback(async (): Promise<BranchProbeOutcome> => {
    const repoPath = activeRepoRef.current;
    if (
      !shouldProbeExternalBranchChange({
        activeRepo: repoPath,
        isSwitchingWorkspace: probeGatesRef.current.isSwitchingWorkspace,
        isSwitchingBranch: probeGatesRef.current.isSwitchingBranch,
        isLoadingBranches: probeGatesRef.current.isLoadingBranches,
        isSyncInFlight: branchSyncInFlightRef.current,
      })
    ) {
      return {
        status: "skipped",
        reason: "preconditions",
      };
    }

    if (!repoPath) {
      return {
        status: "skipped",
        reason: "repo_missing",
      };
    }

    branchSyncInFlightRef.current = true;

    try {
      const current = await host.gitGetCurrentBranch(repoPath);
      if (activeRepoRef.current !== repoPath) {
        return {
          status: "skipped",
          reason: "repo_changed",
        };
      }
      const hasChanged = hasBranchIdentityChanged(
        current,
        lastKnownBranchNameRef.current,
        lastKnownDetachedRef.current,
        lastKnownRevisionRef.current,
      );

      if (hasChanged) {
        try {
          await refreshBranchesForRepo(repoPath);
          return { status: "synced" };
        } catch (error) {
          return {
            status: "degraded",
            error: classifyBranchProbeError(error, "branch_refresh"),
          };
        }
      }

      return { status: "unchanged" };
    } catch (error) {
      if (activeRepoRef.current !== repoPath) {
        return {
          status: "skipped",
          reason: "repo_changed",
        };
      }

      return {
        status: "degraded",
        error: classifyBranchProbeError(error, "current_branch_probe"),
      };
    } finally {
      branchSyncInFlightRef.current = false;
    }
  }, [refreshBranchesForRepo]);

  const syncExternalBranchChange = useCallback(async (): Promise<void> => {
    const outcome = await probeExternalBranchChange();

    if (outcome.status === "degraded") {
      setBranchSyncDegraded(true);
      reportBranchProbeError(outcome.error);
      return;
    }

    if (outcome.status === "synced" || outcome.status === "unchanged") {
      setBranchSyncDegraded(false);
    }
  }, [probeExternalBranchChange, reportBranchProbeError]);

  useEffect(() => {
    if (!activeRepo || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleFocus = (): void => {
      void syncExternalBranchChange();
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        void syncExternalBranchChange();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void syncExternalBranchChange();
      }
    }, BRANCH_SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [activeRepo, syncExternalBranchChange]);

  const refreshWorkspaces = useCallback(async (): Promise<void> => {
    const data = await host.workspaceList();
    applyWorkspaceRecords(data);
  }, [applyWorkspaceRecords]);

  const addWorkspace = useCallback(
    async (repoPath: string): Promise<void> => {
      const normalizedRepoPath = normalizeRepoPath(repoPath);
      if (!normalizedRepoPath) {
        return;
      }

      const workspace = await host.workspaceAdd(normalizedRepoPath);
      await refreshWorkspaces();
      toast.success("Repository added", {
        description: workspace.path,
      });
    },
    [refreshWorkspaces],
  );

  const selectWorkspace = useCallback(
    async (repoPath: string): Promise<void> => {
      const previousRepo = activeRepo;
      const switchVersion = ++workspaceSwitchVersionRef.current;

      setActiveRepo(repoPath);
      clearTaskData();
      clearActiveBeadsCheck();
      clearBranchData();
      setIsSwitchingWorkspace(true);

      try {
        await host.workspaceSelect(repoPath);
        void host
          .workspaceGetRepoConfig(repoPath)
          .then((repoConfig) =>
            host.runtimeEnsure(repoConfig?.defaultRuntimeKind ?? DEFAULT_RUNTIME_KIND, repoPath),
          )
          .catch((error) => {
            if (workspaceSwitchVersionRef.current !== switchVersion) {
              return;
            }
            toast.error("Runtime unavailable", {
              description: errorMessage(error),
            });
          });
        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }
        await refreshWorkspaces();
      } catch (error) {
        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }
        toast.error("Failed to switch repository", {
          description: errorMessage(error),
        });
        setIsSwitchingWorkspace(false);
        setActiveRepo(previousRepo ?? null);
        throw error;
      } finally {
        if (workspaceSwitchVersionRef.current === switchVersion) {
          setIsSwitchingWorkspace(false);
        }
      }
    },
    [
      activeRepo,
      clearBranchData,
      clearTaskData,
      clearActiveBeadsCheck,
      refreshWorkspaces,
      setActiveRepo,
    ],
  );

  return {
    workspaces,
    branches,
    activeBranch,
    isSwitchingWorkspace,
    isLoadingBranches,
    isSwitchingBranch,
    branchSyncDegraded,
    refreshWorkspaces,
    addWorkspace,
    selectWorkspace,
    refreshBranches,
    switchBranch,
    clearBranchData,
    applyWorkspaceRecords,
    applyWorkspaceRecord,
  };
}
