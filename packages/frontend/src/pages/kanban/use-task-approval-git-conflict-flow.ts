import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { GitConflict, GitConflictAction } from "@/features/agent-studio-git";
import { getGitConflictCopy } from "@/features/git-conflict-resolution";
import {
  GitConflictRequestCancelled,
  type GitConflictAssistanceResult,
} from "@/features/git-conflict-resolution/conflict-assistance";
import { errorMessage } from "@/lib/errors";
import type {
  TaskApprovalOpenOptions,
  TaskGitConflictDialogModel,
} from "./kanban-page-model-types";
import {
  abortTaskApprovalGitConflict,
  askBuilderToResolveTaskApprovalGitConflict,
} from "./task-approval-flow-git-conflict";

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

  const abortGitConflict = useCallback((): void => {
    if (!workspaceRepoPath || !gitConflictState.conflict || reservation.current) {
      return;
    }

    const conflict = gitConflictState.conflict;
    const taskId = gitConflictState.taskId;
    reservation.current = true;
    void (async () => {
      setGitConflictState((current) => ({
        ...current,
        conflictAction: "abort",
      }));
      try {
        await abortTaskApprovalGitConflict(workspaceRepoPath, conflict);
        toast.success(getGitConflictCopy(conflict.operation).abortedToastTitle);
        closeGitConflict();
        if (taskId) {
          openTaskApproval(taskId, {
            mode: "direct_merge",
          });
        }
      } catch (error) {
        const description = errorMessage(error);
        toast.error(getGitConflictCopy(conflict.operation).abortFailureTitle, {
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
  }, [workspaceRepoPath, closeGitConflict, gitConflictState, openTaskApproval]);

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
        if (receipt.postAcceptanceFailure)
          toast.error("Message accepted by Builder; host step failed", {
            description: receipt.postAcceptanceFailure,
          });
        closeGitConflict();
        reset();
      } catch (error) {
        const description = errorMessage(error);
        if (!(error instanceof GitConflictRequestCancelled))
          toast.error(getGitConflictCopy(conflict.operation).builderFailureMessage, {
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
  }, [closeGitConflict, gitConflictState, onResolveGitConflict, reset]);

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
        onAbort: abortGitConflict,
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
