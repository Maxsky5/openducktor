import type { GitCurrentBranch } from "@openducktor/contracts";
import { CancelledError, type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  gitQueryKeys,
  invalidateCurrentBranchQuery,
  invalidateRepoBranchesQuery,
  loadCurrentBranchFromQuery,
  loadRepoBranchesFromQuery,
} from "../../queries/git";
import { createProbeGateController } from "./workspace-branch-probe-gate";
import {
  BRANCH_PROBE_ERROR_TOAST_THROTTLE_MS,
  type BranchProbeError,
  type BranchProbeOutcome,
  branchProbeErrorSignature,
  classifyBranchProbeError,
  hasBranchIdentityChanged,
  shouldProbeExternalBranchChange,
  shouldReportBranchProbeError,
} from "./workspace-operations-model";
import type { WorkspaceBranchProbeHostClient } from "./workspace-operations-types";

type UseWorkspaceBranchProbeArgs = {
  activeRepoPath: string | null;
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  hostClient: WorkspaceBranchProbeHostClient;
  setBranchSyncDegraded: (repoPath: string, value: boolean) => void;
};

type ProbeGates = {
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
};

const refreshChangedBranchList = async (
  queryClient: QueryClient,
  repoPath: string,
  hostClient: WorkspaceBranchProbeHostClient,
  isRepoActive: () => boolean,
): Promise<BranchProbeOutcome> => {
  try {
    await invalidateRepoBranchesQuery(queryClient, repoPath);
    await loadRepoBranchesFromQuery(queryClient, repoPath, hostClient);
  } catch (error) {
    if (error instanceof CancelledError || !isRepoActive()) {
      return { status: "skipped" };
    }

    return {
      status: "degraded",
      error: classifyBranchProbeError(error, "branch_refresh"),
    };
  }

  return isRepoActive() ? { status: "synced" } : { status: "skipped" };
};

export function useWorkspaceBranchProbe({
  activeRepoPath,
  isSwitchingWorkspace,
  isLoadingBranches,
  isSwitchingBranch,
  hostClient,
  setBranchSyncDegraded,
}: UseWorkspaceBranchProbeArgs): void {
  const queryClient = useQueryClient();
  const [probeGate] = useState(createProbeGateController);
  const lastProbeErrorToastAtRef = useRef<number | null>(null);
  const lastProbeErrorSignatureRef = useRef<string | null>(null);
  const activeRepoPathRef = useRef(activeRepoPath);
  const probeGatesRef = useRef<ProbeGates>({
    isSwitchingWorkspace,
    isLoadingBranches,
    isSwitchingBranch,
  });

  useLayoutEffect(() => {
    probeGatesRef.current = {
      isSwitchingWorkspace,
      isLoadingBranches,
      isSwitchingBranch,
    };
  }, [isLoadingBranches, isSwitchingBranch, isSwitchingWorkspace]);

  useLayoutEffect(() => {
    const previousRepoPath = activeRepoPathRef.current;
    activeRepoPathRef.current = activeRepoPath;

    if (previousRepoPath === activeRepoPath) {
      return;
    }

    probeGate.reset();
    lastProbeErrorToastAtRef.current = null;
    lastProbeErrorSignatureRef.current = null;
  }, [activeRepoPath, probeGate]);

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
    const repoPath = activeRepoPathRef.current;

    if (!repoPath) {
      return { status: "skipped" };
    }

    if (
      !shouldProbeExternalBranchChange({
        activeWorkspaceRepoPath: repoPath,
        isSwitchingWorkspace: probeGatesRef.current.isSwitchingWorkspace,
        isSwitchingBranch: probeGatesRef.current.isSwitchingBranch,
        isLoadingBranches: probeGatesRef.current.isLoadingBranches,
        isSyncInFlight: probeGate.isInFlight(),
      })
    ) {
      return { status: "skipped" };
    }

    const probeToken = probeGate.begin();
    const previousBranch = queryClient.getQueryData<GitCurrentBranch>(
      gitQueryKeys.currentBranch(repoPath),
    );

    try {
      await invalidateCurrentBranchQuery(queryClient, repoPath);

      const current = await loadCurrentBranchFromQuery(queryClient, repoPath, hostClient);
      if (activeRepoPathRef.current !== repoPath) {
        return { status: "skipped" };
      }

      const hasChanged = hasBranchIdentityChanged(
        current,
        previousBranch?.name ?? null,
        previousBranch?.detached ?? null,
        previousBranch?.revision ?? null,
      );
      const branchListHasError =
        queryClient.getQueryState(gitQueryKeys.branches(repoPath))?.status === "error";

      if (!hasChanged && !branchListHasError) {
        return { status: "unchanged" };
      }

      return refreshChangedBranchList(
        queryClient,
        repoPath,
        hostClient,
        () => activeRepoPathRef.current === repoPath,
      );
    } catch (error) {
      if (error instanceof CancelledError) {
        return { status: "skipped" };
      }

      if (activeRepoPathRef.current !== repoPath) {
        return { status: "skipped" };
      }

      return {
        status: "degraded",
        error: classifyBranchProbeError(error, "current_branch_probe"),
      };
    } finally {
      probeGate.finish(probeToken);
    }
  }, [hostClient, probeGate, queryClient]);

  const syncExternalBranchChange = useCallback(async (): Promise<void> => {
    const repoPath = activeRepoPathRef.current;
    if (!repoPath) {
      return;
    }

    const outcome = await probeExternalBranchChange();

    if (activeRepoPathRef.current !== repoPath) {
      return;
    }

    if (outcome.status === "degraded") {
      setBranchSyncDegraded(repoPath, true);
      reportBranchProbeError(outcome.error);
      return;
    }

    if (outcome.status === "synced" || outcome.status === "unchanged") {
      setBranchSyncDegraded(repoPath, false);
    }
  }, [probeExternalBranchChange, reportBranchProbeError, setBranchSyncDegraded]);

  useEffect(() => {
    if (!activeRepoPath || typeof window === "undefined" || typeof document === "undefined") {
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

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeRepoPath, syncExternalBranchChange]);
}
