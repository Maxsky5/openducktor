import type { CommitsAheadBehind } from "@openducktor/contracts";
import { useCallback, useMemo } from "react";
import type {
  AgentStudioPendingForcePush,
  AgentStudioPendingPullRebase,
  AgentStudioPendingReset,
  GitConflict,
  GitConflictAction,
  GitDiffRefresh,
} from "@/features/agent-studio-git";
import { useAgentStudioGitActionErrors } from "./use-agent-studio-git-action-errors";
import { BUILDER_LOCK_REASON, type GitActionKind } from "./use-agent-studio-git-action-utils";
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
  refreshDiffData: GitDiffRefresh;
  isDiffDataLoading?: boolean;
  isBuilderSessionWorking?: boolean;
  onResolveGitConflict?: (conflict: GitConflict) => Promise<boolean>;
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
  } = useAgentStudioGitActionErrors();

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
  } = useAgentStudioGitConflictController({
    repoPath,
    workingDir,
    branch,
    detectedConflictedFiles,
    worktreeStatusSnapshotKey,
    isBuilderSessionWorking,
    refreshDiffData,
    clearActionErrors,
    setRebaseError,
    ...(onResolveGitConflict ? { onResolveGitConflict } : {}),
  });

  const ensureGitActionsUnlocked = useCallback(
    (kind: GitActionKind): boolean => {
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
    repoPath,
    workingDir,
    targetBranch,
    hashVersion,
    statusHash,
    diffHash,
    worktreeStatusSnapshotKey,
    isDiffDataLoading,
    isBuilderSessionWorking,
    activeGitConflict,
    refreshDiffData,
    clearActionErrors,
    setResetError,
  });

  const { isCommitting, commitAll } = useAgentStudioGitCommitActions({
    repoPath,
    workingDir,
    refreshDiffData,
    clearActionErrors,
    ensureGitActionsUnlocked,
    setCommitError,
  });

  const { isPushing, pendingForcePush, pushBranch, confirmForcePush, cancelForcePush } =
    useAgentStudioGitPushActions({
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
    repoPath,
    workingDir,
    branch,
    targetBranch,
    upstreamAheadBehind,
    refreshDiffData,
    clearActionErrors,
    ensureGitActionsUnlocked,
    setRebaseError,
    captureFreshConflict,
  });

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
    }),
    [
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
