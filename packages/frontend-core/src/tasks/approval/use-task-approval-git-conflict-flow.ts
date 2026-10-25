import { useCallback, useRef, useState } from "react";
import type { GitConflict, GitConflictAction } from "../../git/contracts";
import { abortGitConflict, isAbortableGitConflict } from "../../git/conflicts/abort-git-conflict";
import {
  CONFLICT_ABORT_UNAVAILABLE_MESSAGE,
  getGitConflictCopy,
} from "../../git/conflicts/conflict-copy";
import {
  describeConflictRequestReceipt,
  GitConflictRequestCancelled,
  type GitConflictAssistanceResult,
} from "../../git/conflicts/conflict-assistance";
import { errorMessage } from "../../lib/errors";
import type { TaskApprovalOpenOptions, TaskGitConflictDialogModel } from "./task-approval-types";
import { askBuilderToResolveTaskApprovalGitConflict } from "./task-approval-flow-git-conflict";
import { useClientConnection, useHostClient } from "../../connection/client-connection-react";

interface TaskApprovalGitConflictState {
  open: boolean;
  taskId: string | null;
  conflict: GitConflict | null;
  conflictAction: GitConflictAction;
}

type OpenTaskApproval = (taskId: string, options?: TaskApprovalOpenOptions) => void;

type UseTaskApprovalGitConflictFlowArgs = {
  onResolveGitConflict: (
    conflict: GitConflict,
    taskId: string,
  ) => Promise<GitConflictAssistanceResult>;
  openTaskApproval: OpenTaskApproval;
  reset: () => void;
  workspaceRepoPath: string | null;
};

const INITIAL_GIT_CONFLICT_STATE: TaskApprovalGitConflictState = {
  open: false,
  taskId: null,
  conflict: null,
  conflictAction: null,
};

export function useTaskApprovalGitConflictFlow({
  onResolveGitConflict,
  openTaskApproval,
  reset,
  workspaceRepoPath,
}: UseTaskApprovalGitConflictFlowArgs) {
  const host = useHostClient();
  const { feedback } = useClientConnection();
  const [gitConflictState, setGitConflictState] = useState(INITIAL_GIT_CONFLICT_STATE);
  const isHandlingConflict = gitConflictState.conflictAction !== null;
  const reservation = useRef(false);

  const closeGitConflict = useCallback(() => {
    setGitConflictState(INITIAL_GIT_CONFLICT_STATE);
  }, []);

  const openGitConflictDialog = useCallback((taskId: string, conflict: GitConflict): void => {
    setGitConflictState({
      open: true,
      taskId,
      conflict,
      conflictAction: null,
    });
  }, []);

  const abortConflict = useCallback((): void => {
    if (!workspaceRepoPath || !gitConflictState.conflict || reservation.current) {
      return;
    }

    const conflict = gitConflictState.conflict;
    const taskId = gitConflictState.taskId;
    if (!isAbortableGitConflict(conflict)) {
      feedback.show("error", getGitConflictCopy(conflict.operation).abortFailureTitle, {
        description: CONFLICT_ABORT_UNAVAILABLE_MESSAGE,
      });
      return;
    }
    reservation.current = true;
    void (async () => {
      setGitConflictState((current) => ({
        ...current,
        conflictAction: "abort",
      }));
      try {
        const result = await abortGitConflict(host, workspaceRepoPath, conflict);
        if (result.kind === "failed") {
          feedback.show("error", result.title, { description: errorMessage(result.error) });
          setGitConflictState((current) => ({
            ...current,
            conflictAction: null,
          }));
          return;
        }
        feedback.show("success", result.title);
        closeGitConflict();
        if (taskId) {
          openTaskApproval(taskId, {
            mode: "direct_merge",
          });
        }
      } finally {
        reservation.current = false;
      }
    })();
  }, [host, feedback, workspaceRepoPath, closeGitConflict, gitConflictState, openTaskApproval]);

  const askBuilderToResolveGitConflict = useCallback((): void => {
    if (!gitConflictState.conflict || !gitConflictState.taskId || reservation.current) {
      return;
    }

    const conflict = gitConflictState.conflict;
    const taskId = gitConflictState.taskId;
    reservation.current = true;
    void (async () => {
      setGitConflictState((current) => ({
        ...current,
        conflictAction: "ask_builder",
      }));
      try {
        const receipt = await askBuilderToResolveTaskApprovalGitConflict(
          conflict,
          taskId,
          onResolveGitConflict,
        );
        if (!receipt) {
          setGitConflictState((current) => ({
            ...current,
            conflictAction: null,
          }));
          return;
        }
        // The request is never sent again. An unknown result tells the user to check the session.
        const outcome = describeConflictRequestReceipt(receipt, "Builder");
        if (outcome.kind === "host_step_failed")
          feedback.show("error", outcome.title, { description: outcome.detail });
        else if (outcome.kind === "uncertain")
          feedback.show("warning", outcome.title, { description: outcome.message });
        closeGitConflict();
        reset();
      } catch (error) {
        const description = errorMessage(error);
        if (!(error instanceof GitConflictRequestCancelled))
          feedback.show("error", getGitConflictCopy(conflict.operation).builderFailureMessage, {
            description,
          });
        setGitConflictState((current) => ({
          ...current,
          conflictAction: null,
        }));
      } finally {
        reservation.current = false;
      }
    })();
  }, [closeGitConflict, feedback, gitConflictState, onResolveGitConflict, reset]);

  const taskGitConflictDialog = gitConflictState.conflict
    ? {
        open: gitConflictState.open,
        conflict: gitConflictState.conflict,
        isHandlingConflict,
        conflictAction: gitConflictState.conflictAction,
        onOpenChange: (open: boolean) => {
          if (!open && !isHandlingConflict) {
            closeGitConflict();
          }
        },
        onAbort: abortConflict,
        onAskBuilder: askBuilderToResolveGitConflict,
      }
    : null;

  return {
    taskGitConflictDialog,
    openGitConflictDialog,
  } satisfies {
    taskGitConflictDialog: TaskGitConflictDialogModel | null;
    openGitConflictDialog: (taskId: string, conflict: GitConflict) => void;
  };
}
