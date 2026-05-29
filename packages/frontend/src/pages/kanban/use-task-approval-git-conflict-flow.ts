import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { GitConflict, GitConflictAction } from "@/features/agent-studio-git";
import { getGitConflictCopy } from "@/features/git-conflict-resolution";
import { errorMessage } from "@/lib/errors";
import type { KanbanPageModels, TaskApprovalOpenOptions } from "./kanban-page-model-types";
import {
  abortTaskApprovalGitConflict,
  askBuilderToResolveTaskApprovalGitConflict,
} from "./task-approval-flow-git-conflict";

type OpenTaskApproval = (taskId: string, options?: TaskApprovalOpenOptions) => void;

type UseTaskApprovalGitConflictFlowArgs = {
  onResolveGitConflict: (conflict: GitConflict, taskId: string) => Promise<boolean>;
  openTaskApproval: OpenTaskApproval;
  reset: () => void;
  workspaceRepoPath: string | null;
};

const INITIAL_GIT_CONFLICT_STATE: {
  open: boolean;
  taskId: string | null;
  conflict: GitConflict | null;
  isHandlingConflict: boolean;
  conflictAction: GitConflictAction;
} = {
  open: false,
  taskId: null,
  conflict: null,
  isHandlingConflict: false,
  conflictAction: null,
};

export function useTaskApprovalGitConflictFlow({
  onResolveGitConflict,
  openTaskApproval,
  reset,
  workspaceRepoPath,
}: UseTaskApprovalGitConflictFlowArgs): {
  taskGitConflictDialog: KanbanPageModels["taskGitConflictDialog"];
  openGitConflictDialog: (taskId: string, conflict: GitConflict) => void;
} {
  const [gitConflictState, setGitConflictState] = useState(INITIAL_GIT_CONFLICT_STATE);

  const closeGitConflict = useCallback(() => {
    setGitConflictState(INITIAL_GIT_CONFLICT_STATE);
  }, []);

  const openGitConflictDialog = useCallback((taskId: string, conflict: GitConflict): void => {
    setGitConflictState({
      open: true,
      taskId,
      conflict,
      isHandlingConflict: false,
      conflictAction: null,
    });
  }, []);

  const abortGitConflict = useCallback((): void => {
    if (!workspaceRepoPath || !gitConflictState.conflict || gitConflictState.isHandlingConflict) {
      return;
    }

    const conflict = gitConflictState.conflict;
    const taskId = gitConflictState.taskId;
    void (async () => {
      setGitConflictState((current) => ({
        ...current,
        isHandlingConflict: true,
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
          isHandlingConflict: false,
          conflictAction: null,
        }));
      }
    })();
  }, [workspaceRepoPath, closeGitConflict, gitConflictState, openTaskApproval]);

  const askBuilderToResolveGitConflict = useCallback((): void => {
    if (
      !gitConflictState.conflict ||
      !gitConflictState.taskId ||
      gitConflictState.isHandlingConflict
    ) {
      return;
    }

    const conflict = gitConflictState.conflict;
    const taskId = gitConflictState.taskId;
    void (async () => {
      setGitConflictState((current) => ({
        ...current,
        isHandlingConflict: true,
        conflictAction: "ask_builder",
      }));
      try {
        const wasHandled = await askBuilderToResolveTaskApprovalGitConflict(
          conflict,
          taskId,
          onResolveGitConflict,
        );
        if (!wasHandled) {
          setGitConflictState((current) => ({
            ...current,
            isHandlingConflict: false,
            conflictAction: null,
          }));
          return;
        }
        closeGitConflict();
        reset();
      } catch (error) {
        const description = errorMessage(error);
        toast.error(getGitConflictCopy(conflict.operation).builderFailureMessage, {
          description,
        });
        setGitConflictState((current) => ({
          ...current,
          isHandlingConflict: false,
          conflictAction: null,
        }));
      }
    })();
  }, [closeGitConflict, gitConflictState, onResolveGitConflict, reset]);

  const taskGitConflictDialog = gitConflictState.conflict
    ? {
        open: gitConflictState.open,
        conflict: gitConflictState.conflict,
        isHandlingConflict: gitConflictState.isHandlingConflict,
        conflictAction: gitConflictState.conflictAction,
        onOpenChange: (open: boolean) => {
          if (!open && !gitConflictState.isHandlingConflict) {
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
  };
}
