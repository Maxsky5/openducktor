import type { CommitsAheadBehind } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { normalizeCanonicalTargetBranch } from "@/lib/target-branch";
import { host } from "@/state/operations/host";

export type AgentStudioRebaseConflictOperation = "rebase" | "pull_rebase";
export type AgentStudioRebaseConflictAction = "abort" | "ask_builder" | null;

export type AgentStudioRebaseConflict = {
  operation: AgentStudioRebaseConflictOperation;
  currentBranch: string | null;
  targetBranch: string;
  conflictedFiles: string[];
  output: string;
  workingDir: string | null;
};

export type AgentStudioPendingForcePush = {
  remote: string;
  branch: string;
  output: string;
};

export type AgentStudioPendingPullRebase = {
  branch: string;
  localAhead: number;
  upstreamBehind: number;
};

export type AgentStudioGitActionState = {
  isCommitting: boolean;
  isPushing: boolean;
  isRebasing: boolean;
  isHandlingRebaseConflict: boolean;
  rebaseConflictAction: AgentStudioRebaseConflictAction;
  rebaseConflictAutoOpenNonce: number;
  rebaseConflictCloseNonce: number;
  isGitActionsLocked: boolean;
  gitActionsLockReason: string | null;
  rebaseConflict: AgentStudioRebaseConflict | null;
  pendingForcePush: AgentStudioPendingForcePush | null;
  pendingPullRebase: AgentStudioPendingPullRebase | null;
  commitError: string | null;
  pushError: string | null;
  rebaseError: string | null;
  commitAll: (message: string) => Promise<void>;
  pushBranch: () => Promise<void>;
  confirmForcePush: () => Promise<void>;
  cancelForcePush: () => void;
  confirmPullRebase: () => Promise<void>;
  cancelPullRebase: () => void;
  rebaseOntoTarget: () => Promise<void>;
  abortRebase: () => Promise<void>;
  askBuilderToResolveRebaseConflict: () => Promise<void>;
  pullFromUpstream: () => Promise<void>;
};

type UseAgentStudioGitActionsInput = {
  repoPath: string | null;
  workingDir: string | null;
  branch: string | null;
  targetBranch: string;
  upstreamAheadBehind?: CommitsAheadBehind | null;
  detectedConflictedFiles?: string[];
  worktreeStatusSnapshotKey?: string | null;
  refreshDiffData: () => void | Promise<void>;
  isBuilderSessionWorking?: boolean;
  onResolveRebaseConflict?: (conflict: AgentStudioRebaseConflict) => Promise<boolean>;
};

const BUILDER_LOCK_REASON = "Git actions are disabled while the Builder session is working.";
const CONFLICT_LOCK_REASON = "Git actions are disabled while git conflicts are unresolved.";

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
};

const toConflictMessage = (
  conflictedFiles: string[],
  operation: AgentStudioRebaseConflictOperation,
): string => {
  const action = operation === "pull_rebase" ? "Pull with rebase" : "Rebase";
  return conflictedFiles.length > 0
    ? `${action} stopped due to conflicts in: ${conflictedFiles.join(", ")}.`
    : `${action} stopped due to conflicts.`;
};

export function useAgentStudioGitActions({
  repoPath,
  workingDir,
  branch,
  targetBranch,
  upstreamAheadBehind = null,
  detectedConflictedFiles = [],
  worktreeStatusSnapshotKey = null,
  refreshDiffData,
  isBuilderSessionWorking = false,
  onResolveRebaseConflict,
}: UseAgentStudioGitActionsInput): AgentStudioGitActionState {
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isRebasing, setIsRebasing] = useState(false);
  const [isHandlingRebaseConflict, setIsHandlingRebaseConflict] = useState(false);
  const [rebaseConflictAction, setRebaseConflictAction] =
    useState<AgentStudioRebaseConflictAction>(null);
  const [rebaseConflictAutoOpenNonce, setRebaseConflictAutoOpenNonce] = useState(0);
  const [rebaseConflictCloseNonce, setRebaseConflictCloseNonce] = useState(0);
  const [rebaseConflict, setRebaseConflict] = useState<AgentStudioRebaseConflict | null>(null);
  const [pendingForcePush, setPendingForcePush] = useState<AgentStudioPendingForcePush | null>(
    null,
  );
  const [pendingPullRebase, setPendingPullRebase] = useState<AgentStudioPendingPullRebase | null>(
    null,
  );
  const [commitError, setCommitError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [rebaseError, setRebaseError] = useState<string | null>(null);
  const rebaseConflictSnapshotKeyRef = useRef<string | null>(null);

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
          } satisfies AgentStudioRebaseConflict)
        : null,
    [branch, detectedConflictedFiles, workingDir],
  );
  const activeRebaseConflict = useMemo(
    () => rebaseConflict ?? detectedConflict,
    [detectedConflict, rebaseConflict],
  );
  const isGitActionsLocked = isBuilderSessionWorking || activeRebaseConflict != null;
  const gitActionsLockReason = isBuilderSessionWorking
    ? BUILDER_LOCK_REASON
    : activeRebaseConflict
      ? CONFLICT_LOCK_REASON
      : null;

  const clearActionErrors = useCallback(() => {
    setCommitError(null);
    setPushError(null);
    setRebaseError(null);
  }, []);

  useEffect(() => {
    if (rebaseConflict == null || isHandlingRebaseConflict || worktreeStatusSnapshotKey == null) {
      return;
    }

    const previousSnapshotKey = rebaseConflictSnapshotKeyRef.current;
    if (previousSnapshotKey !== null && previousSnapshotKey === worktreeStatusSnapshotKey) {
      return;
    }

    if (detectedConflictedFiles.length > 0) {
      rebaseConflictSnapshotKeyRef.current = worktreeStatusSnapshotKey;
      const conflictedFilesChanged =
        rebaseConflict.conflictedFiles.length !== detectedConflictedFiles.length ||
        rebaseConflict.conflictedFiles.some(
          (path, index) => path !== detectedConflictedFiles[index],
        );

      if (conflictedFilesChanged) {
        setRebaseConflict((currentConflict) =>
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

    rebaseConflictSnapshotKeyRef.current = null;
    setRebaseConflict(null);
    setRebaseConflictCloseNonce((nonce) => nonce + 1);
  }, [
    detectedConflictedFiles,
    isHandlingRebaseConflict,
    rebaseConflict,
    worktreeStatusSnapshotKey,
  ]);

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

  const commitAll = useCallback(
    async (message: string): Promise<void> => {
      if (isCommitting) {
        return;
      }
      if (!ensureGitActionsUnlocked("commit")) {
        return;
      }

      if (!repoPath) {
        setCommitError("Cannot commit because no repository is selected.");
        return;
      }

      const trimmedMessage = message.trim();
      if (trimmedMessage.length === 0) {
        setCommitError("Commit message cannot be empty.");
        return;
      }

      setIsCommitting(true);
      setCommitError(null);
      try {
        await host.gitCommitAll(repoPath, trimmedMessage, workingDir ?? undefined);
        clearActionErrors();
        await refreshDiffData();
      } catch (error) {
        setCommitError(toErrorMessage(error, "Commit failed."));
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
          const conflict: AgentStudioRebaseConflict = {
            operation: "pull_rebase",
            currentBranch: branch,
            targetBranch: "tracked upstream branch",
            conflictedFiles: result.conflictedFiles,
            output: result.output,
            workingDir,
          };
          const message = toConflictMessage(result.conflictedFiles, "pull_rebase");
          rebaseConflictSnapshotKeyRef.current = worktreeStatusSnapshotKey;
          setRebaseConflict(conflict);
          setRebaseConflictAutoOpenNonce((nonce) => nonce + 1);
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
          const conflict: AgentStudioRebaseConflict = {
            operation: "rebase",
            currentBranch: branch,
            targetBranch: trimmedTarget,
            conflictedFiles: result.conflictedFiles,
            output: result.output,
            workingDir,
          };
          const message = toConflictMessage(result.conflictedFiles, "rebase");
          rebaseConflictSnapshotKeyRef.current = worktreeStatusSnapshotKey;
          setRebaseConflict(conflict);
          setRebaseConflictAutoOpenNonce((nonce) => nonce + 1);
          toast.error("Rebase requires conflict resolution", { description: message });
          await refreshDiffData();
          return;
        }

        clearActionErrors();
        rebaseConflictSnapshotKeyRef.current = null;
        setRebaseConflict(null);
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
      normalizeCanonicalTargetBranch(targetBranch),
      "Cannot rebase because target branch is not configured.",
      "Rebase failed.",
    );
  }, [runRebase, targetBranch]);

  const abortRebase = useCallback(async (): Promise<void> => {
    if (!activeRebaseConflict || isHandlingRebaseConflict) {
      return;
    }

    if (!repoPath) {
      setRebaseError("Cannot abort rebase because no repository is selected.");
      return;
    }

    setIsHandlingRebaseConflict(true);
    setRebaseConflictAction("abort");
    try {
      await host.gitRebaseAbort(repoPath, workingDir ?? undefined);
      clearActionErrors();
      await refreshDiffData();
      rebaseConflictSnapshotKeyRef.current = null;
      setRebaseConflict(null);
      setRebaseConflictCloseNonce((nonce) => nonce + 1);
      toast.success("Rebase aborted");
    } catch (error) {
      const message = toErrorMessage(error, "Failed to abort rebase.");
      setRebaseError(message);
      toast.error("Failed to abort rebase", { description: message });
    } finally {
      setIsHandlingRebaseConflict(false);
      setRebaseConflictAction(null);
    }
  }, [
    activeRebaseConflict,
    clearActionErrors,
    isHandlingRebaseConflict,
    refreshDiffData,
    repoPath,
    workingDir,
  ]);

  const askBuilderToResolveRebaseConflict = useCallback(async (): Promise<void> => {
    if (!activeRebaseConflict || isHandlingRebaseConflict) {
      return;
    }

    if (!onResolveRebaseConflict) {
      setRebaseError("Cannot send conflict resolution request to Builder.");
      return;
    }

    setIsHandlingRebaseConflict(true);
    setRebaseConflictAction("ask_builder");
    try {
      const wasHandled = await onResolveRebaseConflict(activeRebaseConflict);
      if (!wasHandled) {
        return;
      }
      clearActionErrors();
      toast.success("Sent rebase conflict resolution request to Builder");
    } catch (error) {
      const message = toErrorMessage(
        error,
        "Failed to contact Builder for rebase conflict resolution.",
      );
      setRebaseError(message);
      toast.error("Failed to contact Builder", { description: message });
    } finally {
      setIsHandlingRebaseConflict(false);
      setRebaseConflictAction(null);
    }
  }, [activeRebaseConflict, clearActionErrors, isHandlingRebaseConflict, onResolveRebaseConflict]);

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
    isHandlingRebaseConflict,
    rebaseConflictAction,
    rebaseConflictAutoOpenNonce,
    rebaseConflictCloseNonce,
    isGitActionsLocked,
    gitActionsLockReason,
    rebaseConflict: activeRebaseConflict,
    pendingForcePush,
    pendingPullRebase,
    commitError,
    pushError,
    rebaseError,
    commitAll,
    pushBranch,
    confirmForcePush,
    cancelForcePush,
    confirmPullRebase,
    cancelPullRebase,
    rebaseOntoTarget,
    abortRebase,
    askBuilderToResolveRebaseConflict,
    pullFromUpstream,
  };
}
