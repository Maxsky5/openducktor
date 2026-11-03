import { runTaskWorkflowAction } from "@openducktor/frontend-core/tasks/workflow/run-task-workflow-action";
import type { ResolvedTaskCard } from "@openducktor/workflows";
import { useCallback, useMemo } from "react";
import type { AgentStudioTaskQuickAction } from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import { useRequiredTaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import type { useTasksState } from "@/state/app-state-provider";
import {
  type AgentStudioPullRequestModalModel,
  useAgentStudioPullRequestModalModel,
} from "./use-agent-studio-pull-request-modal-model";
import type { CloseTaskOptions } from "@openducktor/frontend-core/types/task-close";

type UseAgentStudioShellTaskActionsArgs = {
  selectedTask: ResolvedTaskCard | null;
  linkingMergedPullRequestTaskId: ReturnType<
    typeof useTasksState
  >["linkingMergedPullRequestTaskId"];
  pendingMergedPullRequest: ReturnType<typeof useTasksState>["pendingMergedPullRequest"];
  syncPullRequests: ReturnType<typeof useTasksState>["syncPullRequests"];
  linkMergedPullRequest: ReturnType<typeof useTasksState>["linkMergedPullRequest"];
  cancelLinkMergedPullRequest: ReturnType<typeof useTasksState>["cancelLinkMergedPullRequest"];
};

export type AgentStudioShellTaskActionsModel = {
  /** Open the details of the selected task. */
  openTaskDetails: () => void;
  /** Opens the approval modal or the shared close confirmation of the selected task. */
  runTaskQuickAction: (action: AgentStudioTaskQuickAction) => void;
  mergedPullRequestModal: AgentStudioPullRequestModalModel | null;
  onDetectPullRequest: (taskId: string) => void;
};

export function useAgentStudioShellTaskActions({
  selectedTask,
  linkingMergedPullRequestTaskId,
  pendingMergedPullRequest,
  syncPullRequests,
  linkMergedPullRequest,
  cancelLinkMergedPullRequest,
}: UseAgentStudioShellTaskActionsArgs): AgentStudioShellTaskActionsModel {
  const onDetectPullRequest = useCallback(
    (taskId: string): void => {
      void syncPullRequests(taskId);
    },
    [syncPullRequests],
  );

  const onLinkMergedPullRequest = useCallback(
    (options: CloseTaskOptions): Promise<void> => linkMergedPullRequest(options),
    [linkMergedPullRequest],
  );

  const onCancelLinkMergedPullRequest = useCallback((): void => {
    cancelLinkMergedPullRequest();
  }, [cancelLinkMergedPullRequest]);

  const workflowActions = useRequiredTaskWorkflowActions();
  const { onOpenTaskDetails, onConfirmTaskAction } = workflowActions;
  const selectedTaskId = selectedTask?.id ?? null;
  const openTaskDetails = useCallback((): void => {
    if (selectedTaskId) onOpenTaskDetails(selectedTaskId);
  }, [onOpenTaskDetails, selectedTaskId]);
  const runTaskQuickAction = useCallback(
    (action: AgentStudioTaskQuickAction): void => {
      if (!selectedTask) return;
      runTaskWorkflowAction(
        action,
        selectedTask.id,
        {
          ...workflowActions,
          onCloseTask: (id, continuation) => onConfirmTaskAction(id, "close", continuation),
          onResetTask: (id, continuation) => onConfirmTaskAction(id, "reset_task", continuation),
          onRemoveTaskWorktree: (id) => onOpenTaskDetails(id),
        },
        { task: selectedTask },
      );
    },
    [onOpenTaskDetails, onConfirmTaskAction, workflowActions, selectedTask],
  );

  const mergedPullRequestModal = useAgentStudioPullRequestModalModel({
    pendingMergedPullRequest,
    linkingMergedPullRequestTaskId,
    onLinkMergedPullRequest,
    onCancelLinkMergedPullRequest,
  });

  return useMemo(
    () => ({
      openTaskDetails,
      runTaskQuickAction,
      mergedPullRequestModal,
      onDetectPullRequest,
    }),
    [mergedPullRequestModal, onDetectPullRequest, openTaskDetails, runTaskQuickAction],
  );
}
