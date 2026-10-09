import type { ResolveGitConflict } from "@/features/git-conflict-resolution/conflict-assistance";
import type { CommitsAheadBehind } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateGitWorkingDirectoryQueries } from "@/state/queries/git";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type {
  AgentStudioPendingForcePush,
  AgentStudioPendingPullRebase,
  AgentStudioPendingReset,
  GitConflict,
  GitConflictAction,
  GitDiffRefresh,
} from "@/features/agent-studio-git";
import { useAgentStudioGitActionErrors } from "./use-agent-studio-git-action-errors";
import { CONFLICT_LOCK_REASON, type GitActionKind } from "./use-agent-studio-git-action-utils";
import { useAgentStudioGitCommitActions } from "./use-agent-studio-git-commit-actions";
import { useAgentStudioGitConflictController } from "./use-agent-studio-git-conflict-controller";
import { useAgentStudioGitPushActions } from "./use-agent-studio-git-push-actions";
import { useAgentStudioGitRebaseActions } from "./use-agent-studio-git-rebase-actions";
import { useAgentStudioGitResetActions } from "./use-agent-studio-git-reset-actions";

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
  conflictRecipientLabel: "Builder" | "agent";
  conflictAssistanceBlockedReason: string | null;
  conflictAssistanceIsStarting: boolean;
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
  contextKey?: string | undefined;
  repoPath: string | null;
  workingDir: string | null;
  branch: string | null;
  branchIdentityKey?: string | null;
  targetBranch: string;
  resetTargetBranch?: string;
  hashVersion: number | null;
  statusHash: string | null;
  diffHash: string | null;
  upstreamAheadBehind?: CommitsAheadBehind | null;
  detectedConflict?: GitConflict | null;
  detectedConflictedFiles?: string[];
  worktreeStatusSnapshotKey?: string | null;
  refreshDiffData: GitDiffRefresh;
  isDiffDataLoading?: boolean;
  onResolveGitConflict?: ResolveGitConflict | undefined;
  assistanceContextKey?: string;
  conflictRecipientLabel?: "Builder" | "agent";
  conflictAssistanceBlockedReason?: string | null | undefined;
  conflictAssistanceIsStarting?: boolean | undefined;
};

export function useAgentStudioGitActions({
  contextKey,
  repoPath,
  workingDir,
  branch,
  branchIdentityKey = branch,
  targetBranch,
  resetTargetBranch = targetBranch,
  hashVersion,
  statusHash,
  diffHash,
  upstreamAheadBehind = null,
  detectedConflict = null,
  detectedConflictedFiles = [],
  worktreeStatusSnapshotKey = null,
  refreshDiffData: refreshInput,
  isDiffDataLoading = false,
  onResolveGitConflict,
  assistanceContextKey = "",
  conflictRecipientLabel = "Builder",
  conflictAssistanceBlockedReason = null,
  conflictAssistanceIsStarting = false,
}: UseAgentStudioGitActionsInput): AgentStudioGitActionState {
  const key = contextKey ?? JSON.stringify([repoPath, workingDir, branch, targetBranch]);
  const currentKey = useRef(key);
  useLayoutEffect(() => {
    currentKey.current = key;
  }, [key]);
  const isCurrentContext = useCallback(() => currentKey.current === key, [key]);
  const queryClient = useQueryClient();
  const refreshDiffData = useCallback<GitDiffRefresh>(
    async (mode) => {
      if (repoPath)
        await invalidateGitWorkingDirectoryQueries(queryClient, repoPath, workingDir ?? repoPath);
      if (isCurrentContext()) await refreshInput(mode);
    },
    [repoPath, workingDir, queryClient, isCurrentContext, refreshInput],
  );
  const operationInFlight = useRef(false);
  const runAction = useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    try {
      return await action();
    } finally {
      operationInFlight.current = false;
    }
  }, []);
  const confirmationKey = useRef(key);
  const isConfirmationCurrent = confirmationKey.current === key;
  const {
    commitError,
    pushError,
    rebaseError,
    resetError,
    setCommitError,
    setPushError,
    setRebaseError,
    setResetError,
    clearActionErrors,
  } = useAgentStudioGitActionErrors(JSON.stringify([repoPath, workingDir]));
  const conflictControllerInput: Parameters<typeof useAgentStudioGitConflictController>[0] = {
    contextKey: key,
    isCurrentContext,
    repoPath,
    workingDir,
    branch,
    detectedConflict,
    detectedConflictedFiles,
    worktreeStatusSnapshotKey,
    refreshDiffData,
    clearActionErrors,
    setRebaseError,
    assistanceContextKey,
    conflictRecipientLabel,
    conflictAssistanceBlockedReason,
  };
  if (onResolveGitConflict) {
    conflictControllerInput.onResolveGitConflict = onResolveGitConflict;
  }

  const {
    activeGitConflict,
    isHandlingGitConflict,
    gitConflictAction,
    gitConflictAutoOpenNonce,
    gitConflictCloseNonce,
    isGitActionsLocked,
    gitActionsLockReason,
    showLockReasonBanner,
    captureFreshConflict,
    abortGitConflict,
    askBuilderToResolveGitConflict,
  } = useAgentStudioGitConflictController(conflictControllerInput);

  const ensureGitActionsUnlocked = useCallback(
    (kind: GitActionKind): boolean => {
      if (!isGitActionsLocked) {
        return true;
      }

      const lockReason = gitActionsLockReason ?? CONFLICT_LOCK_REASON;

      if (kind === "commit") {
        setCommitError(lockReason);
      } else if (kind === "push") {
        setPushError(lockReason);
      } else {
        setRebaseError(lockReason);
      }
      return false;
    },
    [gitActionsLockReason, isGitActionsLocked, setCommitError, setPushError, setRebaseError],
  );

  const {
    isResetting,
    isResetDisabled,
    resetDisabledReason,
    pendingReset,
    requestFileReset,
    requestHunkReset,
    confirmReset,
    cancelReset,
  } = useAgentStudioGitResetActions({
    isCurrentContext,
    repoPath,
    workingDir,
    branchIdentityKey,
    targetBranch: resetTargetBranch,
    hashVersion,
    statusHash,
    diffHash,
    worktreeStatusSnapshotKey,
    isDiffDataLoading,
    activeGitConflict,
    refreshDiffData,
    clearActionErrors,
    setResetError,
  });

  const { isCommitting, commitAll } = useAgentStudioGitCommitActions({
    isCurrentContext,
    repoPath,
    workingDir,
    refreshDiffData,
    clearActionErrors,
    ensureGitActionsUnlocked,
    setCommitError,
  });

  const { isPushing, pendingForcePush, pushBranch, confirmForcePush, cancelForcePush } =
    useAgentStudioGitPushActions({
      isCurrentContext,
      repoPath,
      workingDir,
      branch,
      refreshDiffData,
      clearActionErrors,
      ensureGitActionsUnlocked,
      setPushError,
    });

  const {
    isRebasing,
    pendingPullRebase,
    pullFromUpstream,
    confirmPullRebase,
    cancelPullRebase,
    rebaseOntoTarget,
  } = useAgentStudioGitRebaseActions({
    isCurrentContext,
    repoPath,
    workingDir,
    branch,
    branchIdentityKey,
    targetBranch,
    upstreamAheadBehind,
    refreshDiffData,
    clearActionErrors,
    ensureGitActionsUnlocked,
    setRebaseError,
    captureFreshConflict,
  });

  useEffect(() => {
    confirmationKey.current = key;
    cancelForcePush();
    cancelPullRebase();
    cancelReset();
    clearActionErrors();
  }, [key, cancelForcePush, cancelPullRebase, cancelReset, clearActionErrors]);

  return useMemo(
    () => ({
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
      showLockReasonBanner,
      isGitActionsLocked,
      gitActionsLockReason,
      gitConflict: activeGitConflict,
      conflictRecipientLabel,
      conflictAssistanceBlockedReason:
        conflictAssistanceBlockedReason ??
        (activeGitConflict && !activeGitConflict.workingDir
          ? "Restore the Git conflict directory before asking for assistance."
          : null),
      conflictAssistanceIsStarting,
      pendingForcePush: isConfirmationCurrent ? pendingForcePush : null,
      pendingPullRebase: isConfirmationCurrent ? pendingPullRebase : null,
      pendingReset: isConfirmationCurrent ? pendingReset : null,
      commitError,
      pushError,
      rebaseError,
      resetError,
      commitAll: async (message: string) => (await runAction(() => commitAll(message))) ?? false,
      requestFileReset,
      requestHunkReset,
      confirmReset: async () => {
        if (isCurrentContext() && isConfirmationCurrent) await runAction(confirmReset);
      },
      cancelReset,
      pushBranch: () => runAction(pushBranch),
      confirmForcePush: async () => {
        if (isCurrentContext() && isConfirmationCurrent) await runAction(confirmForcePush);
      },
      cancelForcePush,
      confirmPullRebase: async () => {
        if (isCurrentContext() && isConfirmationCurrent) await runAction(confirmPullRebase);
      },
      cancelPullRebase,
      rebaseOntoTarget: () => runAction(rebaseOntoTarget),
      abortGitConflict: () => runAction(abortGitConflict),
      askBuilderToResolveGitConflict: () => runAction(askBuilderToResolveGitConflict),
      pullFromUpstream: () => runAction(pullFromUpstream),
    }),
    [
      runAction,
      isCurrentContext,
      isConfirmationCurrent,
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
      showLockReasonBanner,
      isGitActionsLocked,
      gitActionsLockReason,
      activeGitConflict,
      conflictRecipientLabel,
      conflictAssistanceBlockedReason,
      conflictAssistanceIsStarting,
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
    ],
  );
}
