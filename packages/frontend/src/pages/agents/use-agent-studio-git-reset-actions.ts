import type { GitResetWorktreeSelection } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { GitConflict } from "@/features/agent-studio-git";
import { host } from "@/state/operations/shared/host";
import {
  CONFLICT_LOCK_REASON,
  type RefreshGitDiffData,
  toErrorMessage,
} from "./use-agent-studio-git-action-utils";

type UseAgentStudioGitResetActionsArgs = {
  repoPath: string | null;
  workingDir: string | null;
  branchIdentityKey: string | null;
  targetBranch: string;
  hashVersion: number | null;
  statusHash: string | null;
  diffHash: string | null;
  worktreeStatusSnapshotKey: string | null;
  isDiffDataLoading: boolean;
  activeGitConflict: GitConflict | null;
  refreshDiffData: RefreshGitDiffData;
  clearActionErrors: () => void;
  setResetError: (message: string | null) => void;
};

export function useAgentStudioGitResetActions({
  repoPath,
  workingDir,
  branchIdentityKey,
  targetBranch,
  hashVersion,
  statusHash,
  diffHash,
  worktreeStatusSnapshotKey,
  isDiffDataLoading,
  activeGitConflict,
  refreshDiffData,
  clearActionErrors,
  setResetError,
}: UseAgentStudioGitResetActionsArgs) {
  const [isResetting, setIsResetting] = useState(false);
  const scopeKey = JSON.stringify([repoPath, workingDir, branchIdentityKey, targetBranch]);
  const [pending, setPending] = useState<{
    scopeKey: string;
    request: Parameters<typeof host.gitResetWorktreeSelection>[0];
  } | null>(null);
  const request = pending?.scopeKey === scopeKey ? pending.request : null;
  const pendingReset = request?.selection ?? null;

  const [lastSnapshot, setLastSnapshot] = useState({ scopeKey, key: worktreeStatusSnapshotKey });
  if (lastSnapshot.scopeKey !== scopeKey || lastSnapshot.key !== worktreeStatusSnapshotKey) {
    setLastSnapshot({ scopeKey, key: worktreeStatusSnapshotKey });
    if (
      lastSnapshot.scopeKey === scopeKey &&
      lastSnapshot.key !== null &&
      worktreeStatusSnapshotKey !== null
    ) {
      setResetError(null);
      if (request) setPending(null);
    }
  }

  const getResetBlockedReason = useCallback((): string | null => {
    if (activeGitConflict != null) {
      return CONFLICT_LOCK_REASON;
    }

    if (isDiffDataLoading) {
      return "Cannot reset while git diff data is loading.";
    }

    if (isResetting) {
      return "Reset is already in progress.";
    }

    return null;
  }, [activeGitConflict, isDiffDataLoading, isResetting]);

  const resetDisabledReason = useMemo((): string | null => {
    if (!repoPath) {
      return "Cannot reset because no repository is selected.";
    }

    const blockedReason = getResetBlockedReason();
    if (blockedReason) {
      return blockedReason;
    }

    if (hashVersion == null || statusHash == null || diffHash == null) {
      return "Displayed diff is unavailable. Refresh and try again.";
    }

    if (targetBranch.trim().length === 0) {
      return "Cannot reset because target branch is not configured.";
    }

    return null;
  }, [diffHash, getResetBlockedReason, hashVersion, repoPath, statusHash, targetBranch]);

  const isResetDisabled = resetDisabledReason != null;

  const buildResetRequest = useCallback(
    (selection: GitResetWorktreeSelection) => {
      if (resetDisabledReason != null) {
        return {
          error: resetDisabledReason,
        } as const;
      }

      if (repoPath == null || hashVersion == null || statusHash == null || diffHash == null) {
        return {
          error: "Displayed diff is unavailable. Refresh and try again.",
        } as const;
      }

      return {
        request: {
          repoPath,
          workingDir: workingDir ?? undefined,
          targetBranch,
          snapshot: {
            hashVersion,
            statusHash,
            diffHash,
          },
          selection,
        },
      } as const;
    },
    [diffHash, hashVersion, repoPath, resetDisabledReason, statusHash, targetBranch, workingDir],
  );

  const requestResetSelection = useCallback(
    (selection: GitResetWorktreeSelection): void => {
      const built = buildResetRequest(selection);
      if ("error" in built) {
        setResetError(built.error);
        return;
      }

      setResetError(null);
      setPending({ scopeKey, request: built.request });
    },
    [buildResetRequest, scopeKey, setResetError],
  );

  const requestFileReset = useCallback(
    (filePath: string): void => {
      requestResetSelection({ kind: "file", filePath });
    },
    [requestResetSelection],
  );

  const requestHunkReset = useCallback(
    (filePath: string, hunkIndex: number): void => {
      requestResetSelection({ kind: "hunk", filePath, hunkIndex });
    },
    [requestResetSelection],
  );

  const confirmReset = useCallback(async (): Promise<void> => {
    if (request == null) {
      return;
    }

    const selection = request.selection;
    // Check current availability, but send the snapshot the user approved.
    const built = buildResetRequest(selection);
    if ("error" in built) {
      setResetError(built.error);
      toast.error("Reset failed", { description: built.error });
      return;
    }

    setIsResetting(true);
    setResetError(null);
    try {
      const result = await host.gitResetWorktreeSelection(request);
      clearActionErrors();
      setPending(null);
      const affectedCount = result.affectedPaths.length;
      toast.success(selection.kind === "file" ? "File reset" : "Hunk reset", {
        description:
          affectedCount === 1
            ? result.affectedPaths[0]
            : `${affectedCount} paths updated in the worktree.`,
      });

      try {
        await refreshDiffData("soft");
      } catch (error) {
        const message = toErrorMessage(error, "Reset was applied, but diff refresh failed.");
        setResetError(message);
        toast.error("Reset applied but refresh failed", {
          description: message,
        });
      }
    } catch (error) {
      const message = toErrorMessage(error, "Reset failed.");
      setResetError(message);
      toast.error("Reset failed", { description: message });
    } finally {
      setIsResetting(false);
    }
  }, [buildResetRequest, clearActionErrors, request, refreshDiffData, setResetError]);

  const cancelReset = useCallback((): void => {
    setPending(null);
    setResetError(null);
  }, [setResetError]);

  return {
    isResetting,
    isResetDisabled,
    resetDisabledReason,
    pendingReset,
    requestFileReset,
    requestHunkReset,
    confirmReset,
    cancelReset,
  };
}
