import { useCallback, useEffect, useMemo, useReducer } from "react";
import { toast } from "sonner";
import type { GitConflict, GitConflictAction } from "@/features/agent-studio-git";
import { getGitConflictCopy } from "@/features/git-conflict-resolution";
import { host } from "@/state/operations/shared/host";
import {
  getGitActionsLockReason,
  type RefreshGitDiffData,
  toErrorMessage,
} from "./use-agent-studio-git-action-utils";

type GitConflictControllerState = {
  localConflict: GitConflict | null;
  gitConflictSnapshotKey: string | null;
  isHandlingGitConflict: boolean;
  gitConflictAction: GitConflictAction;
  gitConflictAutoOpenNonce: number;
  gitConflictCloseNonce: number;
};

type GitConflictControllerAction =
  | {
      type: "capture_conflict";
      conflict: GitConflict;
      snapshotKey: string | null;
    }
  | {
      type: "replace_conflicted_files";
      conflictedFiles: string[];
      snapshotKey: string | null;
    }
  | {
      type: "replace_conflict";
      conflict: GitConflict;
      snapshotKey: string | null;
    }
  | {
      type: "mark_snapshot_seen";
      snapshotKey: string | null;
    }
  | {
      type: "clear_local_conflict";
      closeModal: boolean;
    }
  | {
      type: "start_action";
      action: Exclude<GitConflictAction, null>;
    }
  | {
      type: "finish_action";
    };

type UseAgentStudioGitConflictControllerArgs = {
  repoPath: string | null;
  workingDir: string | null;
  branch: string | null;
  detectedConflict?: GitConflict | null;
  detectedConflictedFiles: string[];
  worktreeStatusSnapshotKey: string | null;
  isBuilderSessionWorking: boolean;
  refreshDiffData: RefreshGitDiffData;
  clearActionErrors: () => void;
  setRebaseError: (message: string | null) => void;
  onResolveGitConflict?: (conflict: GitConflict) => Promise<boolean>;
};

const initialState: GitConflictControllerState = {
  localConflict: null,
  gitConflictSnapshotKey: null,
  isHandlingGitConflict: false,
  gitConflictAction: null,
  gitConflictAutoOpenNonce: 0,
  gitConflictCloseNonce: 0,
};

const haveSameConflictedFiles = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();

  return sortedLeft.every((filePath, index) => filePath === sortedRight[index]);
};

const haveSameConflictMetadata = (left: GitConflict, right: GitConflict): boolean => {
  return (
    left.operation === right.operation &&
    left.currentBranch === right.currentBranch &&
    left.targetBranch === right.targetBranch &&
    left.output === right.output &&
    left.workingDir === right.workingDir &&
    haveSameConflictedFiles(left.conflictedFiles, right.conflictedFiles)
  );
};

function gitConflictControllerReducer(
  state: GitConflictControllerState,
  action: GitConflictControllerAction,
): GitConflictControllerState {
  switch (action.type) {
    case "capture_conflict":
      return {
        ...state,
        localConflict: action.conflict,
        gitConflictSnapshotKey: action.snapshotKey,
        gitConflictAutoOpenNonce: state.gitConflictAutoOpenNonce + 1,
      };
    case "replace_conflicted_files":
      if (state.localConflict == null) {
        return state;
      }
      return {
        ...state,
        localConflict: {
          ...state.localConflict,
          conflictedFiles: action.conflictedFiles,
        },
        gitConflictSnapshotKey: action.snapshotKey,
      };
    case "replace_conflict":
      return {
        ...state,
        localConflict: action.conflict,
        gitConflictSnapshotKey: action.snapshotKey,
      };
    case "mark_snapshot_seen":
      return {
        ...state,
        gitConflictSnapshotKey: action.snapshotKey,
      };
    case "clear_local_conflict":
      return {
        ...state,
        localConflict: null,
        gitConflictSnapshotKey: null,
        gitConflictCloseNonce: action.closeModal
          ? state.gitConflictCloseNonce + 1
          : state.gitConflictCloseNonce,
      };
    case "start_action":
      return {
        ...state,
        isHandlingGitConflict: true,
        gitConflictAction: action.action,
      };
    case "finish_action":
      return {
        ...state,
        isHandlingGitConflict: false,
        gitConflictAction: null,
      };
    default:
      return state;
  }
}

export function useAgentStudioGitConflictController({
  repoPath,
  workingDir,
  branch,
  detectedConflict = null,
  detectedConflictedFiles,
  worktreeStatusSnapshotKey,
  isBuilderSessionWorking,
  refreshDiffData,
  clearActionErrors,
  setRebaseError,
  onResolveGitConflict,
}: UseAgentStudioGitConflictControllerArgs) {
  const [state, dispatch] = useReducer(gitConflictControllerReducer, initialState);

  const fallbackDetectedConflict = useMemo(
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

  const effectiveDetectedConflict = detectedConflict ?? fallbackDetectedConflict;

  const activeGitConflict = state.localConflict ?? effectiveDetectedConflict;
  const isGitActionsLocked = isBuilderSessionWorking || activeGitConflict != null;
  const gitActionsLockReason = getGitActionsLockReason(isBuilderSessionWorking, activeGitConflict);
  const showLockReasonBanner = isGitActionsLocked && !isBuilderSessionWorking;

  useEffect(() => {
    if (
      state.localConflict == null ||
      state.isHandlingGitConflict ||
      worktreeStatusSnapshotKey == null
    ) {
      return;
    }

    if (state.gitConflictSnapshotKey === worktreeStatusSnapshotKey) {
      return;
    }

    if ((effectiveDetectedConflict?.conflictedFiles ?? detectedConflictedFiles).length > 0) {
      if (
        detectedConflict != null &&
        !haveSameConflictMetadata(state.localConflict, detectedConflict)
      ) {
        dispatch({
          type: "replace_conflict",
          conflict: detectedConflict,
          snapshotKey: worktreeStatusSnapshotKey,
        });
        return;
      }

      const conflictedFilesChanged = !haveSameConflictedFiles(
        state.localConflict.conflictedFiles,
        effectiveDetectedConflict?.conflictedFiles ?? detectedConflictedFiles,
      );

      if (conflictedFilesChanged) {
        dispatch({
          type: "replace_conflicted_files",
          conflictedFiles: effectiveDetectedConflict?.conflictedFiles ?? detectedConflictedFiles,
          snapshotKey: worktreeStatusSnapshotKey,
        });
        return;
      }

      dispatch({
        type: "mark_snapshot_seen",
        snapshotKey: worktreeStatusSnapshotKey,
      });
      return;
    }

    dispatch({ type: "clear_local_conflict", closeModal: true });
  }, [
    detectedConflictedFiles,
    detectedConflict,
    effectiveDetectedConflict,
    state.gitConflictSnapshotKey,
    state.isHandlingGitConflict,
    state.localConflict,
    worktreeStatusSnapshotKey,
  ]);

  const captureFreshConflict = useCallback(
    (conflict: GitConflict) => {
      dispatch({
        type: "capture_conflict",
        conflict,
        snapshotKey: worktreeStatusSnapshotKey,
      });
    },
    [worktreeStatusSnapshotKey],
  );

  const abortGitConflict = useCallback(async (): Promise<void> => {
    if (!activeGitConflict || state.isHandlingGitConflict) {
      return;
    }

    if (!repoPath) {
      setRebaseError("Cannot abort the git conflict because no repository is selected.");
      return;
    }

    dispatch({ type: "start_action", action: "abort" });
    try {
      await host.gitAbortConflict(
        repoPath,
        activeGitConflict.operation,
        activeGitConflict.workingDir ?? workingDir ?? undefined,
      );
      clearActionErrors();
      dispatch({ type: "clear_local_conflict", closeModal: true });
      toast.success(getGitConflictCopy(activeGitConflict.operation).abortedToastTitle);

      try {
        await refreshDiffData("soft");
      } catch (error) {
        const message = toErrorMessage(error, "Git conflict was aborted, but diff refresh failed.");
        setRebaseError(message);
        toast.error("Conflict aborted but refresh failed", {
          description: message,
        });
      }
    } catch (error) {
      const message = toErrorMessage(error, "Failed to abort the git conflict.");
      setRebaseError(message);
      toast.error(getGitConflictCopy(activeGitConflict.operation).abortFailureTitle, {
        description: message,
      });
    } finally {
      dispatch({ type: "finish_action" });
    }
  }, [
    activeGitConflict,
    clearActionErrors,
    refreshDiffData,
    repoPath,
    setRebaseError,
    state.isHandlingGitConflict,
    workingDir,
  ]);

  const askBuilderToResolveGitConflict = useCallback(async (): Promise<void> => {
    if (!activeGitConflict || state.isHandlingGitConflict) {
      return;
    }

    if (!onResolveGitConflict) {
      setRebaseError("Cannot send conflict resolution request to Builder.");
      return;
    }

    dispatch({ type: "start_action", action: "ask_builder" });
    try {
      const wasHandled = await onResolveGitConflict(activeGitConflict);
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
      dispatch({ type: "finish_action" });
    }
  }, [
    activeGitConflict,
    clearActionErrors,
    onResolveGitConflict,
    setRebaseError,
    state.isHandlingGitConflict,
  ]);

  return {
    activeGitConflict,
    isHandlingGitConflict: state.isHandlingGitConflict,
    gitConflictAction: state.gitConflictAction,
    gitConflictAutoOpenNonce: state.gitConflictAutoOpenNonce,
    gitConflictCloseNonce: state.gitConflictCloseNonce,
    isGitActionsLocked,
    gitActionsLockReason,
    showLockReasonBanner,
    captureFreshConflict,
    abortGitConflict,
    askBuilderToResolveGitConflict,
  };
}
