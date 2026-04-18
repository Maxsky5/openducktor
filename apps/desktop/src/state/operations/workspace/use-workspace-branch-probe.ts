import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ActiveWorkspace } from "@/types/state-slices";
import { gitQueryKeys, loadCurrentBranchFromQuery } from "../../queries/git";
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
import type {
  WorkspaceBranchProbeController,
  WorkspaceBranchProbeHostClient,
} from "./workspace-operations-types";

type UseWorkspaceBranchProbeArgs = {
  activeWorkspace: ActiveWorkspace | null;
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  hostClient: WorkspaceBranchProbeHostClient;
  branchProbeController: WorkspaceBranchProbeController;
  setBranchSyncDegraded: (value: boolean) => void;
};

type ProbeGates = {
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
};

export function useWorkspaceBranchProbe({
  activeWorkspace,
  isSwitchingWorkspace,
  isLoadingBranches,
  isSwitchingBranch,
  hostClient,
  branchProbeController,
  setBranchSyncDegraded,
}: UseWorkspaceBranchProbeArgs): void {
  const activeRepoPath =
    activeWorkspace?.repoPath ?? branchProbeController.currentWorkspaceRepoPathRef.current;
  const queryClient = useQueryClient();
  const probeGateRef = useRef(createProbeGateController());
  const lastProbeErrorToastAtRef = useRef<number | null>(null);
  const lastProbeErrorSignatureRef = useRef<string | null>(null);
  const previousWorkspaceRepoPathRef = useRef(activeRepoPath);
  const probeGatesRef = useRef<ProbeGates>({
    isSwitchingWorkspace,
    isLoadingBranches,
    isSwitchingBranch,
  });

  probeGatesRef.current.isSwitchingWorkspace = isSwitchingWorkspace;
  probeGatesRef.current.isLoadingBranches = isLoadingBranches;
  probeGatesRef.current.isSwitchingBranch = isSwitchingBranch;

  useEffect(() => {
    if (previousWorkspaceRepoPathRef.current === activeRepoPath) {
      return;
    }

    previousWorkspaceRepoPathRef.current = activeRepoPath;
    probeGateRef.current.reset();
    lastProbeErrorToastAtRef.current = null;
    lastProbeErrorSignatureRef.current = null;
  }, [activeRepoPath]);

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
    const repoPath = branchProbeController.currentWorkspaceRepoPathRef.current;

    if (
      !shouldProbeExternalBranchChange({
        activeWorkspaceRepoPath: repoPath,
        isSwitchingWorkspace: probeGatesRef.current.isSwitchingWorkspace,
        isSwitchingBranch: probeGatesRef.current.isSwitchingBranch,
        isLoadingBranches: probeGatesRef.current.isLoadingBranches,
        isSyncInFlight: probeGateRef.current.isInFlight(),
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

    const probeToken = probeGateRef.current.begin();

    try {
      await queryClient.invalidateQueries({
        queryKey: gitQueryKeys.currentBranch(repoPath),
        exact: true,
        refetchType: "none",
      });

      const current = await loadCurrentBranchFromQuery(queryClient, repoPath, hostClient);

      if (branchProbeController.currentWorkspaceRepoPathRef.current !== repoPath) {
        return {
          status: "skipped",
          reason: "repo_changed",
        };
      }

      const hasChanged = hasBranchIdentityChanged(
        current,
        branchProbeController.lastKnownBranchNameRef.current,
        branchProbeController.lastKnownDetachedRef.current,
        branchProbeController.lastKnownRevisionRef.current,
      );

      if (hasChanged) {
        try {
          await branchProbeController.refreshBranchesForRepo(repoPath);

          if (branchProbeController.currentWorkspaceRepoPathRef.current !== repoPath) {
            return {
              status: "skipped",
              reason: "repo_changed",
            };
          }

          return { status: "synced" };
        } catch (error) {
          if (branchProbeController.currentWorkspaceRepoPathRef.current !== repoPath) {
            return {
              status: "skipped",
              reason: "repo_changed",
            };
          }

          return {
            status: "degraded",
            error: classifyBranchProbeError(error, "branch_refresh"),
          };
        }
      }

      return { status: "unchanged" };
    } catch (error) {
      if (branchProbeController.currentWorkspaceRepoPathRef.current !== repoPath) {
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
      probeGateRef.current.finish(probeToken);
    }
  }, [branchProbeController, hostClient, queryClient]);

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
