import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { toast } from "sonner";
import type { GitConflict, GitConflictAction } from "@openducktor/frontend-core/git/contracts";
import {
  detectedGitConflict,
  CONFLICT_ABORT_REFRESH_FAILED_TITLE,
  CONFLICT_ABORT_UNAVAILABLE_MESSAGE,
} from "@openducktor/frontend-core/git/conflicts/conflict-copy";
import {
  abortGitConflict,
  isAbortableGitConflict,
} from "@openducktor/frontend-core/git/conflicts/abort-git-conflict";
import {
  describeConflictRequestReceipt,
  GitConflictRequestCancelled,
  type ResolveGitConflict,
} from "@openducktor/frontend-core/git/conflicts/conflict-assistance";
import {
  CONFLICT_LOCK_REASON,
  type RefreshGitDiffData,
  toErrorMessage,
} from "./use-agent-studio-git-action-utils";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";

type ConflictState = {
  localConflict: GitConflict | null;
  /** The repository and working directory where the local conflict happened. */
  directoryKey: string | null;
  snapshotKey: string | null;
  action: GitConflictAction;
  openNonce: number;
  closeNonce: number;
};

type ConflictEvent =
  | {
      type: "capture_conflict";
      conflict: GitConflict;
      directoryKey: string;
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
  contextKey?: string;
  isCurrentContext: () => boolean;
  repoPath: string | null;
  workingDir: string | null;
  branch: string | null;
  detectedConflict?: GitConflict | null;
  detectedConflictedFiles: string[];
  worktreeStatusSnapshotKey: string | null;
  refreshDiffData: RefreshGitDiffData;
  clearActionErrors: () => void;
  setRebaseError: (message: string | null) => void;
  onResolveGitConflict?: ResolveGitConflict;
  assistanceContextKey?: string;
  conflictRecipientLabel?: "Builder" | "agent";
  conflictAssistanceBlockedReason?: string | null;
};

export function useAgentStudioGitConflictController({
  isCurrentContext,
  contextKey,
  repoPath,
  workingDir,
  branch,
  detectedConflict = null,
  detectedConflictedFiles,
  worktreeStatusSnapshotKey,
  refreshDiffData,
  clearActionErrors,
  setRebaseError,
  onResolveGitConflict,
  assistanceContextKey = "",
  conflictRecipientLabel = "Builder",
  conflictAssistanceBlockedReason = null,
}: UseAgentStudioGitConflictControllerArgs) {
  const host = useHostClient();
  const [state, dispatch] = useReducer(reducer, initialState);
  const isHandlingGitConflict = state.action !== null;
  // Keep a command's conflict in the directory where it ran.
  const directoryKey = JSON.stringify([repoPath, workingDir]);
  const reservation = useRef(false);
  const selection = useRef({ key: "", version: 0, mounted: true });
  const selectionKey = JSON.stringify([directoryKey, contextKey, assistanceContextKey]);
  useLayoutEffect(() => {
    if (selection.current.key !== selectionKey) {
      selection.current = {
        key: selectionKey,
        version: selection.current.version + 1,
        mounted: true,
      };
    }
  }, [selectionKey]);
  useLayoutEffect(() => {
    selection.current.mounted = true;
    return () => {
      selection.current.mounted = false;
      selection.current.version += 1;
    };
  }, []);
  const localConflict = state.directoryKey === directoryKey ? state.localConflict : null;

  const fallbackDetectedConflict = useMemo(
    () => detectedGitConflict({ branch, conflictedFiles: detectedConflictedFiles, workingDir }),
    [branch, detectedConflictedFiles, workingDir],
  );

  const effectiveDetectedConflict = detectedConflict ?? fallbackDetectedConflict;

  const activeGitConflict = localConflict ?? effectiveDetectedConflict;
  const isGitActionsLocked = activeGitConflict != null;
  const gitActionsLockReason = activeGitConflict != null ? CONFLICT_LOCK_REASON : null;
  const showLockReasonBanner = isGitActionsLocked;

  useEffect(() => {
    if (localConflict == null || isHandlingGitConflict || worktreeStatusSnapshotKey == null) {
      return;
    }

    if (state.snapshotKey === worktreeStatusSnapshotKey) {
      return;
    }

    if ((effectiveDetectedConflict?.conflictedFiles ?? detectedConflictedFiles).length > 0) {
      // A status read can report a generic rebase and omit the original command's details.
      const refreshedConflict =
        detectedConflict && effectiveDetectedConflict
          ? {
              ...effectiveDetectedConflict,
              operation: localConflict.operation ?? effectiveDetectedConflict.operation,
              currentBranch: localConflict.currentBranch ?? effectiveDetectedConflict.currentBranch,
              targetBranch: localConflict.targetBranch || effectiveDetectedConflict.targetBranch,
              output: localConflict.output || effectiveDetectedConflict.output,
              workingDir: localConflict.workingDir ?? effectiveDetectedConflict.workingDir,
            }
          : null;
      if (refreshedConflict != null && !sameConflict(localConflict, refreshedConflict)) {
        dispatch({
          type: "replace_conflict",
          conflict: refreshedConflict,
          snapshotKey: worktreeStatusSnapshotKey,
        });
        return;
      }

      const conflictedFilesChanged = !sameFiles(
        localConflict.conflictedFiles,
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
    localConflict,
    state.snapshotKey,
    isHandlingGitConflict,
    worktreeStatusSnapshotKey,
  ]);

  const captureFreshConflict = useCallback(
    (conflict: GitConflict) => {
      if (!isCurrentContext()) return;
      dispatch({
        type: "capture_conflict",
        conflict,
        directoryKey,
        snapshotKey: worktreeStatusSnapshotKey,
      });
    },
    [isCurrentContext, directoryKey, worktreeStatusSnapshotKey],
  );

  const abortConflict = useCallback(async (): Promise<void> => {
    if (!activeGitConflict || reservation.current) {
      return;
    }

    if (!repoPath) {
      setRebaseError("Cannot abort the git conflict because no repository is selected.");
      return;
    }

    if (!isAbortableGitConflict(activeGitConflict)) {
      setRebaseError(CONFLICT_ABORT_UNAVAILABLE_MESSAGE);
      return;
    }
    reservation.current = true;
    const version = selection.current.version;
    const isCurrentSelection = () =>
      selection.current.version === version && selection.current.mounted;
    dispatch({ type: "start_action", action: "abort" });
    try {
      const result = await abortGitConflict(host, repoPath, activeGitConflict);
      if (result.kind === "failed") {
        if (!isCurrentContext()) return;
        const message = toErrorMessage(result.error, "Failed to abort the git conflict.");
        if (isCurrentSelection()) {
          setRebaseError(message);
          toast.error(result.title, { description: message });
        }
        return;
      }
      if (isCurrentContext() && isCurrentSelection()) {
        clearActionErrors();
        dispatch({ type: "clear_local_conflict", closeModal: true });
        toast.success(result.title);
      }

      try {
        await refreshDiffData("soft");
      } catch (error) {
        if (!isCurrentContext()) return;
        const message = toErrorMessage(error, "Git conflict was aborted, but diff refresh failed.");
        if (isCurrentSelection()) {
          setRebaseError(message);
          toast.error(CONFLICT_ABORT_REFRESH_FAILED_TITLE, { description: message });
        }
      }
    } finally {
      reservation.current = false;
      dispatch({ type: "finish_action" });
    }
  }, [
    host,
    isCurrentContext,
    activeGitConflict,
    clearActionErrors,
    refreshDiffData,
    repoPath,
    setRebaseError,
  ]);

  const askForHelp = useCallback(async (): Promise<void> => {
    if (!activeGitConflict || reservation.current) {
      return;
    }

    if (!onResolveGitConflict) {
      setRebaseError(
        `Cannot contact ${conflictRecipientLabel}. Select a saved chat and try again.`,
      );
      return;
    }

    if (
      conflictAssistanceBlockedReason ||
      !activeGitConflict.operation ||
      !activeGitConflict.workingDir
    ) {
      setRebaseError(
        conflictAssistanceBlockedReason ??
          "Restore the Git conflict operation and directory before asking for assistance.",
      );
      return;
    }
    reservation.current = true;
    const version = selection.current.version;
    const assertCurrent = () => {
      if (
        !isCurrentContext() ||
        !selection.current.mounted ||
        selection.current.version !== version
      )
        throw new GitConflictRequestCancelled();
    };
    dispatch({ type: "start_action", action: "ask_builder" });
    try {
      const receipt = await onResolveGitConflict(activeGitConflict, assertCurrent);
      assertCurrent();
      if (!receipt) return;
      clearActionErrors();
      const outcome = describeConflictRequestReceipt(receipt, conflictRecipientLabel);
      if (outcome.kind === "host_step_failed") {
        setRebaseError(outcome.message);
        toast.error(outcome.title, { description: outcome.detail });
      } else if (outcome.kind === "uncertain") {
        setRebaseError(outcome.message);
        toast.error(outcome.title);
      } else {
        toast.success(outcome.title);
      }
    } catch (error) {
      if (
        !isCurrentContext() ||
        error instanceof GitConflictRequestCancelled ||
        selection.current.version !== version ||
        !selection.current.mounted
      )
        return;
      const message = toErrorMessage(
        error,
        `Failed to contact ${conflictRecipientLabel}. Reopen the chat and try again.`,
      );
      setRebaseError(message);
      toast.error(`Failed to contact ${conflictRecipientLabel}`, { description: message });
    } finally {
      reservation.current = false;
      dispatch({ type: "finish_action" });
    }
  }, [
    isCurrentContext,
    activeGitConflict,
    clearActionErrors,
    onResolveGitConflict,
    conflictAssistanceBlockedReason,
    conflictRecipientLabel,
    setRebaseError,
  ]);

  return {
    activeGitConflict,
    isHandlingGitConflict,
    gitConflictAction: state.action,
    gitConflictAutoOpenNonce: state.openNonce,
    gitConflictCloseNonce: state.closeNonce,
    isGitActionsLocked,
    gitActionsLockReason,
    showLockReasonBanner,
    captureFreshConflict,
    abortGitConflict: abortConflict,
    askBuilderToResolveGitConflict: askForHelp,
  };
}

const initialState: ConflictState = {
  localConflict: null,
  directoryKey: null,
  snapshotKey: null,
  action: null,
  openNonce: 0,
  closeNonce: 0,
};

const sameFiles = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = left.toSorted();
  const sortedRight = right.toSorted();

  return sortedLeft.every((filePath, index) => filePath === sortedRight[index]);
};

const sameConflict = (left: GitConflict, right: GitConflict): boolean => {
  return (
    left.operation === right.operation &&
    left.currentBranch === right.currentBranch &&
    left.targetBranch === right.targetBranch &&
    left.output === right.output &&
    left.workingDir === right.workingDir &&
    sameFiles(left.conflictedFiles, right.conflictedFiles)
  );
};

function reducer(state: ConflictState, event: ConflictEvent): ConflictState {
  switch (event.type) {
    case "capture_conflict":
      return {
        ...state,
        localConflict: event.conflict,
        directoryKey: event.directoryKey,
        snapshotKey: event.snapshotKey,
        openNonce: state.openNonce + 1,
      };
    case "replace_conflicted_files":
      if (state.localConflict == null) {
        return state;
      }
      return {
        ...state,
        localConflict: {
          ...state.localConflict,
          conflictedFiles: event.conflictedFiles,
        },
        snapshotKey: event.snapshotKey,
      };
    case "replace_conflict":
      return {
        ...state,
        localConflict: event.conflict,
        snapshotKey: event.snapshotKey,
      };
    case "mark_snapshot_seen":
      return {
        ...state,
        snapshotKey: event.snapshotKey,
      };
    case "clear_local_conflict":
      return {
        ...state,
        localConflict: null,
        directoryKey: null,
        snapshotKey: null,
        closeNonce: event.closeModal ? state.closeNonce + 1 : state.closeNonce,
      };
    case "start_action":
      return {
        ...state,
        action: event.action,
      };
    case "finish_action":
      return {
        ...state,
        action: null,
      };
    default:
      return state;
  }
}
