import type { ResolveGitConflict } from "@/features/git-conflict-resolution/conflict-assistance";
import type { CommitsAheadBehind, GitLocalChanges } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateGitWorkingDirectoryQueries } from "@openducktor/frontend-core/queries/git";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type {
  AgentStudioPendingDiscard,
  AgentStudioPendingForcePush,
  AgentStudioPendingPullRebase,
  GitChangeIntent,
  GitCommitMode,
  GitConflict,
  GitConflictAction,
  GitDiffRefresh,
} from "@/features/agent-studio-git";
import { useAgentStudioGitActionErrors } from "./use-agent-studio-git-action-errors";
import { CONFLICT_LOCK_REASON, type GitActionKind } from "./use-agent-studio-git-action-utils";
import { useAgentStudioGitChangeActions } from "./use-agent-studio-git-change-actions";
import { useAgentStudioGitCommitActions } from "./use-agent-studio-git-commit-actions";
import { useAgentStudioGitConflictController } from "./use-agent-studio-git-conflict-controller";
import { useAgentStudioGitPushActions } from "./use-agent-studio-git-push-actions";
import { useAgentStudioGitRebaseActions } from "./use-agent-studio-git-rebase-actions";

type AgentStudioGitActionState = {
  isCommitting: boolean;
  committingMode: GitCommitMode | null;
  isPushing: boolean;
  isRebasing: boolean;
  isChanging: boolean;
  changingKey: string | null;
  /** Stage and Unstage requests that Git has not shown yet. The panel shows their result. */
  pendingChanges: readonly GitChangeIntent[];
  changeDisabledReason: string | null;
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
  pendingDiscard: AgentStudioPendingDiscard | null;
  commitError: string | null;
  pushError: string | null;
  rebaseError: string | null;
  changeError: string | null;
  commit: (mode: GitCommitMode, message: string) => Promise<boolean>;
  changeSelection: (intent: GitChangeIntent) => void;
  confirmDiscard: () => Promise<void>;
  cancelDiscard: () => void;
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
  localChanges: GitLocalChanges | null;
  upstreamAheadBehind?: CommitsAheadBehind | null;
  detectedConflict?: GitConflict | null;
  detectedConflictedFiles?: string[];
  worktreeStatusSnapshotKey?: string | null;
  refreshDiffData: GitDiffRefresh;
  /** Shows the local changes that a Git change returned, in the cache of this context. */
  applyLocalChanges: (changes: GitLocalChanges) => Promise<void>;
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
  localChanges,
  upstreamAheadBehind = null,
  detectedConflict = null,
  detectedConflictedFiles = [],
  worktreeStatusSnapshotKey = null,
  refreshDiffData: refreshInput,
  applyLocalChanges,
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
    changeError,
    setCommitError,
    setPushError,
    setRebaseError,
    setChangeError,
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

  const { committingMode, commit } = useAgentStudioGitCommitActions({
    isCurrentContext,
    repoPath,
    workingDir,
    localChanges,
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

  const {
    changingKey,
    isChanging,
    pendingChanges,
    changeDisabledReason,
    pendingDiscard,
    changeSelection,
    confirmDiscard,
    cancelDiscard,
  } = useAgentStudioGitChangeActions({
    isCurrentContext,
    repoPath,
    workingDir,
    localChanges,
    otherActionReason: otherGitActionReason({
      committingMode,
      isPushing,
      isRebasing,
      isHandlingGitConflict,
    }),
    activeGitConflict,
    refreshDiffData,
    applyLocalChanges,
    clearActionErrors,
    setChangeError,
  });

  useEffect(() => {
    confirmationKey.current = key;
    cancelForcePush();
    cancelPullRebase();
    cancelDiscard();
    clearActionErrors();
  }, [key, cancelForcePush, cancelPullRebase, cancelDiscard, clearActionErrors]);

  return useMemo(
    () => ({
      isCommitting: committingMode !== null,
      committingMode,
      isPushing,
      isRebasing,
      isChanging,
      changingKey,
      pendingChanges,
      changeDisabledReason,
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
      pendingDiscard: isConfirmationCurrent ? pendingDiscard : null,
      commitError,
      pushError,
      rebaseError,
      changeError,
      commit: async (mode: GitCommitMode, message: string) =>
        (await runAction(() => commit(mode, message))) ?? false,
      // Changes run in their own queue, so a click during another change waits instead of failing.
      changeSelection: (intent: GitChangeIntent) => void changeSelection(intent),
      confirmDiscard: async () => {
        if (isCurrentContext() && isConfirmationCurrent) await confirmDiscard();
      },
      cancelDiscard,
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
      committingMode,
      isPushing,
      isRebasing,
      changingKey,
      isChanging,
      pendingChanges,
      changeDisabledReason,
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
      pendingDiscard,
      commitError,
      pushError,
      rebaseError,
      changeError,
      commit,
      changeSelection,
      confirmDiscard,
      cancelDiscard,
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

/** A running commit, push, rebase, or conflict action blocks stage, unstage, and discard. */
function otherGitActionReason(state: {
  committingMode: GitCommitMode | null;
  isPushing: boolean;
  isRebasing: boolean;
  isHandlingGitConflict: boolean;
}): string | null {
  if (state.committingMode !== null) return "Wait for the commit to finish.";
  if (state.isPushing) return "Wait for the push to finish.";
  if (state.isRebasing) return "Wait for the rebase or pull to finish.";
  if (state.isHandlingGitConflict) return "Wait for the conflict action to finish.";
  return null;
}
