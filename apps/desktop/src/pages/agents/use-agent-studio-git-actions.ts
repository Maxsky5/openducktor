import type { CommitsAheadBehind, GitResetWorktreeSelection } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  AgentStudioPendingForcePush,
  AgentStudioPendingPullRebase,
  AgentStudioPendingReset,
  GitConflict,
  GitConflictAction,
  GitConflictOperation,
} from "@/features/agent-studio-git";
import { getGitConflictCopy } from "@/features/git-conflict-resolution";
import { host } from "@/state/operations/shared/host";

type AgentStudioGitActionState = {
  isCommitting: boolean;
  isPushing: boolean;
  isRebasing: boolean;
  isResetting: boolean;
  isResetDisabled: boolean;
  resetDisabledReason: string | null;
  isHandlingGitConflict: boolean;
  gitConflictAction: GitConflictAction;
  gitConflictAutoOpenNonce: number;
  gitConflictCloseNonce: number;
  showLockReasonBanner: boolean;
  isGitActionsLocked: boolean;
  gitActionsLockReason: string | null;
  gitConflict: GitConflict | null;
  pendingForcePush: AgentStudioPendingForcePush | null;
  pendingPullRebase: AgentStudioPendingPullRebase | null;
  pendingReset: AgentStudioPendingReset | null;
  commitError: string | null;
  pushError: string | null;
  rebaseError: string | null;
  resetError: string | null;
  commitAll: (message: string) => Promise<boolean>;
  requestFileReset: (filePath: string) => void;
  requestHunkReset: (filePath: string, hunkIndex: number) => void;
  confirmReset: () => Promise<void>;
  cancelReset: () => void;
  pushBranch: () => Promise<void>;
  confirmForcePush: () => Promise<void>;
  cancelForcePush: () => void;
  confirmPullRebase: () => Promise<void>;
  cancelPullRebase: () => void;
  rebaseOntoTarget: () => Promise<void>;
  abortGitConflict: () => Promise<void>;
  askBuilderToResolveGitConflict: () => Promise<void>;
  pullFromUpstream: () => Promise<void>;
};

type UseAgentStudioGitActionsInput = {
  repoPath: string | null;
  workingDir: string | null;
  branch: string | null;
  targetBranch: string;
  hashVersion: number | null;
  statusHash: string | null;
  diffHash: string | null;
  upstreamAheadBehind?: CommitsAheadBehind | null;
  detectedConflictedFiles?: string[];
  worktreeStatusSnapshotKey?: string | null;
  refreshDiffData: () => void | Promise<void>;
  isDiffDataLoading?: boolean;
  isBuilderSessionWorking?: boolean;
  onResolveGitConflict?: (conflict: GitConflict) => Promise<boolean>;
};

const BUILDER_LOCK_REASON = "Git actions are disabled while the Builder session is working.";
const CONFLICT_LOCK_REASON = "Git actions are disabled while git conflicts are unresolved.";

const getGitActionsLockReason = (
  isBuilderSessionWorking: boolean,
  activeGitConflict: GitConflict | null,
): string | null => {
  if (isBuilderSessionWorking) {
    return BUILDER_LOCK_REASON;
  }

  if (activeGitConflict) {
    return CONFLICT_LOCK_REASON;
  }

  return null;
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
};

const toConflictMessage = (conflictedFiles: string[], operation: GitConflictOperation): string => {
  const action = getGitConflictCopy(operation).title.replace(" conflict detected", "");
  return conflictedFiles.length > 0
    ? `${action} stopped due to conflicts in: ${conflictedFiles.join(", ")}.`
    : `${action} stopped due to conflicts.`;
};

export function useAgentStudioGitActions({
  repoPath,
  workingDir,
  branch,
  targetBranch,
  hashVersion,
  statusHash,
  diffHash,
  upstreamAheadBehind = null,
  detectedConflictedFiles = [],
  worktreeStatusSnapshotKey = null,
  refreshDiffData,
  isDiffDataLoading = false,
  isBuilderSessionWorking = false,
  onResolveGitConflict,
}: UseAgentStudioGitActionsInput): AgentStudioGitActionState {
  const resolveGitConflict = onResolveGitConflict;
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isRebasing, setIsRebasing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isHandlingGitConflict, setIsHandlingGitConflict] = useState(false);
  const [gitConflictAction, setGitConflictAction] = useState<GitConflictAction>(null);
  const [gitConflictAutoOpenNonce, setGitConflictAutoOpenNonce] = useState(0);
  const [gitConflictCloseNonce, setGitConflictCloseNonce] = useState(0);
  const [gitConflict, setGitConflict] = useState<GitConflict | null>(null);
  const [pendingForcePush, setPendingForcePush] = useState<AgentStudioPendingForcePush | null>(
    null,
  );
  const [pendingPullRebase, setPendingPullRebase] = useState<AgentStudioPendingPullRebase | null>(
    null,
  );
  const [pendingReset, setPendingReset] = useState<AgentStudioPendingReset | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [rebaseError, setRebaseError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const gitConflictSnapshotKeyRef = useRef<string | null>(null);
  const resetSnapshotKeyRef = useRef<string | null>(null);

  const detectedConflict = useMemo(
    () =>
      detectedConflictedFiles.length > 0
        ? ({
            operation: "rebase",
            currentBranch: branch,
            targetBranch: "current rebase target",
            conflictedFiles: detectedConflictedFiles,
            output:
              "Git conflict is still in progress in this worktree. Previous command output is unavailable after reload.",
            workingDir,
          } satisfies GitConflict)
        : null,
    [branch, detectedConflictedFiles, workingDir],
  );
  const activeGitConflict = useMemo(
    () => gitConflict ?? detectedConflict,
    [detectedConflict, gitConflict],
  );
  const isGitActionsLocked = isBuilderSessionWorking || activeGitConflict != null;
  const gitActionsLockReason = getGitActionsLockReason(isBuilderSessionWorking, activeGitConflict);

  const clearActionErrors = useCallback(() => {
    setCommitError(null);
    setPushError(null);
    setRebaseError(null);
    setResetError(null);
  }, []);

  useEffect(() => {
    if (worktreeStatusSnapshotKey == null) {
      resetSnapshotKeyRef.current = null;
      return;
    }

    const previousSnapshotKey = resetSnapshotKeyRef.current;
    resetSnapshotKeyRef.current = worktreeStatusSnapshotKey;

    if (previousSnapshotKey !== null && previousSnapshotKey !== worktreeStatusSnapshotKey) {
      setResetError(null);
    }
  }, [worktreeStatusSnapshotKey]);

  useEffect(() => {
    if (gitConflict == null || isHandlingGitConflict || worktreeStatusSnapshotKey == null) {
      return;
    }

    const previousSnapshotKey = gitConflictSnapshotKeyRef.current;
    if (previousSnapshotKey !== null && previousSnapshotKey === worktreeStatusSnapshotKey) {
      return;
    }

    if (detectedConflictedFiles.length > 0) {
      gitConflictSnapshotKeyRef.current = worktreeStatusSnapshotKey;
      const conflictedFilesChanged =
        gitConflict.conflictedFiles.length !== detectedConflictedFiles.length ||
        gitConflict.conflictedFiles.some((path, index) => path !== detectedConflictedFiles[index]);

      if (conflictedFilesChanged) {
        setGitConflict((currentConflict) =>
          currentConflict == null
            ? currentConflict
            : {
                ...currentConflict,
                conflictedFiles: detectedConflictedFiles,
              },
        );
      }
      return;
    }

    gitConflictSnapshotKeyRef.current = null;
    setGitConflict(null);
    setGitConflictCloseNonce((nonce) => nonce + 1);
  }, [detectedConflictedFiles, gitConflict, isHandlingGitConflict, worktreeStatusSnapshotKey]);

  const ensureGitActionsUnlocked = useCallback(
    (kind: "commit" | "push" | "rebase"): boolean => {
      if (!isGitActionsLocked) {
        return true;
      }

      const lockReason = gitActionsLockReason ?? BUILDER_LOCK_REASON;

      if (kind === "commit") {
        setCommitError(lockReason);
      } else if (kind === "push") {
        setPushError(lockReason);
      } else {
        setRebaseError(lockReason);
      }
      return false;
    },
    [gitActionsLockReason, isGitActionsLocked],
  );

  const getResetBlockedReason = useCallback((): string | null => {
    if (isBuilderSessionWorking) {
      return BUILDER_LOCK_REASON;
    }

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
  }, [activeGitConflict, isBuilderSessionWorking, isDiffDataLoading, isResetting]);

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

      const resolvedRepoPath = repoPath;
      const resolvedHashVersion = hashVersion;
      const resolvedStatusHash = statusHash;
      const resolvedDiffHash = diffHash;
      if (
        resolvedRepoPath == null ||
        resolvedHashVersion == null ||
        resolvedStatusHash == null ||
        resolvedDiffHash == null
      ) {
        return {
          error: "Displayed diff is unavailable. Refresh and try again.",
        } as const;
      }

      return {
        request: {
          repoPath: resolvedRepoPath,
          workingDir: workingDir ?? undefined,
          targetBranch,
          snapshot: {
            hashVersion: resolvedHashVersion,
            statusHash: resolvedStatusHash,
            diffHash: resolvedDiffHash,
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
      setPendingReset(selection);
    },
    [buildResetRequest],
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
    if (pendingReset == null) {
      return;
    }

    const built = buildResetRequest(pendingReset);
    if ("error" in built) {
      setResetError(built.error);
      toast.error("Reset failed", { description: built.error });
      return;
    }

    setIsResetting(true);
    setResetError(null);
    try {
      const result = await host.gitResetWorktreeSelection(built.request);
      clearActionErrors();
      setPendingReset(null);
      await refreshDiffData();
      const affectedCount = result.affectedPaths.length;
      toast.success(pendingReset.kind === "file" ? "File reset" : "Chunk reset", {
        description:
          affectedCount === 1
            ? result.affectedPaths[0]
            : `${affectedCount} paths updated in the worktree.`,
      });
    } catch (error) {
      const message = toErrorMessage(error, "Reset failed.");
      setResetError(message);
      toast.error("Reset failed", { description: message });
    } finally {
      setIsResetting(false);
    }
  }, [buildResetRequest, clearActionErrors, pendingReset, refreshDiffData]);

  const cancelReset = useCallback((): void => {
    setPendingReset(null);
    setResetError(null);
  }, []);

  const commitAll = useCallback(
    async (message: string): Promise<boolean> => {
      if (isCommitting) {
        return false;
      }
      if (!ensureGitActionsUnlocked("commit")) {
        return false;
      }

      if (!repoPath) {
        setCommitError("Cannot commit because no repository is selected.");
        return false;
      }

      const trimmedMessage = message.trim();
      if (trimmedMessage.length === 0) {
        setCommitError("Commit message cannot be empty.");
        return false;
      }

      setIsCommitting(true);
      setCommitError(null);
      try {
        await host.gitCommitAll(repoPath, trimmedMessage, workingDir ?? undefined);
        clearActionErrors();
        await refreshDiffData();
        return true;
      } catch (error) {
        setCommitError(toErrorMessage(error, "Commit failed."));
        return false;
      } finally {
        setIsCommitting(false);
      }
    },
    [
      clearActionErrors,
      ensureGitActionsUnlocked,
      isCommitting,
      refreshDiffData,
      repoPath,
      workingDir,
    ],
  );

  const pushBranchInternal = useCallback(
    async (options?: { forceWithLease?: boolean }): Promise<void> => {
      if (isPushing) {
        return;
      }
      if (!ensureGitActionsUnlocked("push")) {
        return;
      }

      if (!repoPath) {
        setPushError("Cannot push because no repository is selected.");
        return;
      }

      if (!branch) {
        setPushError("Cannot push because current branch is unavailable.");
        return;
      }

      const forceWithLease = options?.forceWithLease ?? false;
      setIsPushing(true);
      setPushError(null);
      try {
        const pushResult = await host.gitPushBranch(repoPath, branch, {
          setUpstream: true,
          forceWithLease,
          ...(workingDir != null ? { workingDir } : {}),
        });

        if (pushResult.outcome === "rejected_non_fast_forward") {
          if (forceWithLease) {
            const message = pushResult.output.trim() || "Force push was rejected.";
            setPushError(message);
            toast.error("Force push rejected", { description: message });
            return;
          }

          setPendingForcePush({
            remote: pushResult.remote,
            branch: pushResult.branch,
            output: pushResult.output,
          });
          return;
        }

        clearActionErrors();
        setPendingForcePush(null);
        toast.success(`Pushed ${pushResult.branch}`, {
          description: `Remote: ${pushResult.remote}`,
        });
        await refreshDiffData();
      } catch (error) {
        const message = toErrorMessage(
          error,
          forceWithLease ? "Force push failed." : "Push failed.",
        );
        setPushError(message);
        toast.error(forceWithLease ? "Force push failed" : "Push failed", {
          description: message,
        });
      } finally {
        setIsPushing(false);
      }
    },
    [
      branch,
      clearActionErrors,
      ensureGitActionsUnlocked,
      isPushing,
      refreshDiffData,
      repoPath,
      workingDir,
    ],
  );

  const pushBranch = useCallback(async (): Promise<void> => {
    await pushBranchInternal();
  }, [pushBranchInternal]);

  const confirmForcePush = useCallback(async (): Promise<void> => {
    if (!pendingForcePush) {
      return;
    }

    setPendingForcePush(null);
    await pushBranchInternal({ forceWithLease: true });
  }, [pendingForcePush, pushBranchInternal]);

  const cancelForcePush = useCallback((): void => {
    setPendingForcePush(null);
    setPushError(null);
  }, []);

  const pullFromUpstreamInternal = useCallback(
    async (options?: {
      skipRebaseConfirmation?: boolean;
      localAhead?: number;
      upstreamBehind?: number;
    }): Promise<void> => {
      if (isRebasing) {
        return;
      }
      if (!ensureGitActionsUnlocked("rebase")) {
        return;
      }

      if (!repoPath) {
        setRebaseError("Cannot pull because no repository is selected.");
        return;
      }

      if (!branch || branch.trim().length === 0) {
        setRebaseError("Cannot pull because current branch is unavailable.");
        return;
      }

      const localAhead = options?.localAhead ?? upstreamAheadBehind?.ahead ?? 0;
      const upstreamBehindCount = options?.upstreamBehind ?? upstreamAheadBehind?.behind ?? 0;
      const willRebaseLocalCommits = localAhead > 0 && upstreamBehindCount > 0;
      const isConfirmedPullRebase =
        options?.skipRebaseConfirmation === true && willRebaseLocalCommits;

      if (willRebaseLocalCommits && !options?.skipRebaseConfirmation) {
        setPendingPullRebase({
          branch,
          localAhead,
          upstreamBehind: upstreamBehindCount,
        });
        return;
      }

      setIsRebasing(true);
      setRebaseError(null);
      try {
        const result = await host.gitPullBranch(repoPath, workingDir ?? undefined);

        if (result.outcome === "conflicts") {
          if (isConfirmedPullRebase) {
            setPendingPullRebase(null);
          }
          const conflict: GitConflict = {
            operation: "pull_rebase",
            currentBranch: branch,
            targetBranch: "tracked upstream branch",
            conflictedFiles: result.conflictedFiles,
            output: result.output,
            workingDir,
          };
          const message = toConflictMessage(result.conflictedFiles, "pull_rebase");
          gitConflictSnapshotKeyRef.current = worktreeStatusSnapshotKey;
          setGitConflict(conflict);
          setGitConflictAutoOpenNonce((nonce) => nonce + 1);
          toast.error("Pull requires conflict resolution", { description: message });
          await refreshDiffData();
          return;
        }

        clearActionErrors();
        if (isConfirmedPullRebase) {
          setPendingPullRebase(null);
        }
        if (result.outcome === "up_to_date") {
          toast.success("Already up to date");
        } else if (willRebaseLocalCommits) {
          toast.success("Rebased local commits onto upstream", {
            description: `Reapplied ${localAhead} local commit${localAhead === 1 ? "" : "s"}.`,
          });
        } else {
          toast.success("Pulled from upstream");
        }
        await refreshDiffData();
      } catch (error) {
        const message = toErrorMessage(error, "Pull failed.");
        setRebaseError(message);
        setPendingPullRebase(null);
        toast.error("Pull failed", { description: message });
      } finally {
        setIsRebasing(false);
      }
    },
    [
      branch,
      clearActionErrors,
      ensureGitActionsUnlocked,
      isRebasing,
      refreshDiffData,
      repoPath,
      upstreamAheadBehind?.ahead,
      upstreamAheadBehind?.behind,
      workingDir,
      worktreeStatusSnapshotKey,
    ],
  );

  const runRebase = useCallback(
    async (target: string, missingTargetError: string, fallbackError: string): Promise<void> => {
      if (isRebasing) {
        return;
      }
      if (!ensureGitActionsUnlocked("rebase")) {
        return;
      }

      if (!repoPath) {
        setRebaseError("Cannot rebase because no repository is selected.");
        return;
      }

      const trimmedTarget = target.trim();
      if (trimmedTarget.length === 0) {
        setRebaseError(missingTargetError);
        return;
      }

      setIsRebasing(true);
      setRebaseError(null);
      try {
        const result = await host.gitRebaseBranch(repoPath, trimmedTarget, workingDir ?? undefined);
        if (result.outcome === "conflicts") {
          const conflict: GitConflict = {
            operation: "rebase",
            currentBranch: branch,
            targetBranch: trimmedTarget,
            conflictedFiles: result.conflictedFiles,
            output: result.output,
            workingDir,
          };
          const message = toConflictMessage(result.conflictedFiles, "rebase");
          gitConflictSnapshotKeyRef.current = worktreeStatusSnapshotKey;
          setGitConflict(conflict);
          setGitConflictAutoOpenNonce((nonce) => nonce + 1);
          toast.error("Rebase requires conflict resolution", { description: message });
          await refreshDiffData();
          return;
        }

        clearActionErrors();
        gitConflictSnapshotKeyRef.current = null;
        setGitConflict(null);
        await refreshDiffData();
      } catch (error) {
        setRebaseError(toErrorMessage(error, fallbackError));
      } finally {
        setIsRebasing(false);
      }
    },
    [
      branch,
      clearActionErrors,
      ensureGitActionsUnlocked,
      isRebasing,
      refreshDiffData,
      repoPath,
      workingDir,
      worktreeStatusSnapshotKey,
    ],
  );

  const rebaseOntoTarget = useCallback(async (): Promise<void> => {
    await runRebase(
      targetBranch,
      "Cannot rebase because target branch is not configured.",
      "Rebase failed.",
    );
  }, [runRebase, targetBranch]);

  const abortGitConflict = useCallback(async (): Promise<void> => {
    if (!activeGitConflict || isHandlingGitConflict) {
      return;
    }

    if (!repoPath) {
      setRebaseError("Cannot abort the git conflict because no repository is selected.");
      return;
    }

    setIsHandlingGitConflict(true);
    setGitConflictAction("abort");
    try {
      await host.gitAbortConflict(
        repoPath,
        activeGitConflict.operation,
        activeGitConflict.workingDir ?? workingDir ?? undefined,
      );
      clearActionErrors();
      await refreshDiffData();
      gitConflictSnapshotKeyRef.current = null;
      setGitConflict(null);
      setGitConflictCloseNonce((nonce) => nonce + 1);
      toast.success(getGitConflictCopy(activeGitConflict.operation).abortedToastTitle);
    } catch (error) {
      const message = toErrorMessage(error, "Failed to abort the git conflict.");
      setRebaseError(message);
      toast.error(getGitConflictCopy(activeGitConflict.operation).abortFailureTitle, {
        description: message,
      });
    } finally {
      setIsHandlingGitConflict(false);
      setGitConflictAction(null);
    }
  }, [
    activeGitConflict,
    clearActionErrors,
    isHandlingGitConflict,
    refreshDiffData,
    repoPath,
    workingDir,
  ]);

  const askBuilderToResolveGitConflict = useCallback(async (): Promise<void> => {
    if (!activeGitConflict || isHandlingGitConflict) {
      return;
    }

    if (!resolveGitConflict) {
      setRebaseError("Cannot send conflict resolution request to Builder.");
      return;
    }

    setIsHandlingGitConflict(true);
    setGitConflictAction("ask_builder");
    try {
      const wasHandled = await resolveGitConflict(activeGitConflict);
      if (!wasHandled) {
        return;
      }
      clearActionErrors();
      toast.success(getGitConflictCopy(activeGitConflict.operation).builderSuccessTitle);
    } catch (error) {
      const message = toErrorMessage(
        error,
        getGitConflictCopy(activeGitConflict.operation).builderFailureMessage,
      );
      setRebaseError(message);
      toast.error("Failed to contact Builder", { description: message });
    } finally {
      setIsHandlingGitConflict(false);
      setGitConflictAction(null);
    }
  }, [activeGitConflict, clearActionErrors, isHandlingGitConflict, resolveGitConflict]);

  const pullFromUpstream = useCallback(async (): Promise<void> => {
    await pullFromUpstreamInternal();
  }, [pullFromUpstreamInternal]);

  const confirmPullRebase = useCallback(async (): Promise<void> => {
    if (!pendingPullRebase) {
      return;
    }

    const pending = pendingPullRebase;
    await pullFromUpstreamInternal({
      skipRebaseConfirmation: true,
      localAhead: pending.localAhead,
      upstreamBehind: pending.upstreamBehind,
    });
  }, [pendingPullRebase, pullFromUpstreamInternal]);

  const cancelPullRebase = useCallback((): void => {
    setPendingPullRebase(null);
    setRebaseError(null);
  }, []);

  return {
    isCommitting,
    isPushing,
    isRebasing,
    isResetting,
    isResetDisabled,
    resetDisabledReason,
    isHandlingGitConflict,
    gitConflictAction,
    gitConflictAutoOpenNonce,
    gitConflictCloseNonce,
    showLockReasonBanner: isGitActionsLocked && !isBuilderSessionWorking,
    isGitActionsLocked,
    gitActionsLockReason,
    gitConflict: activeGitConflict,
    pendingForcePush,
    pendingPullRebase,
    pendingReset,
    commitError,
    pushError,
    rebaseError,
    resetError,
    commitAll,
    requestFileReset,
    requestHunkReset,
    confirmReset,
    cancelReset,
    pushBranch,
    confirmForcePush,
    cancelForcePush,
    confirmPullRebase,
    cancelPullRebase,
    rebaseOntoTarget,
    abortGitConflict,
    askBuilderToResolveGitConflict,
    pullFromUpstream,
  };
}
