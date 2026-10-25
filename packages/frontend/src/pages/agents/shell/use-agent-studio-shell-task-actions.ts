import { useCallback, useMemo } from "react";
import { useRequiredTaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import type { useTasksState } from "@/state/app-state-provider";
import {
  type AgentStudioPullRequestModalModel,
  useAgentStudioPullRequestModalModel,
} from "./use-agent-studio-pull-request-modal-model";

type UseAgentStudioShellTaskActionsArgs = {
  selectedTaskId: string | null;
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
  mergedPullRequestModal: AgentStudioPullRequestModalModel | null;
  onDetectPullRequest: (taskId: string) => void;
};

export function useAgentStudioShellTaskActions({
  selectedTaskId,
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

  const onLinkMergedPullRequest = useCallback((): Promise<void> => {
    return linkMergedPullRequest();
  }, [linkMergedPullRequest]);

  const onCancelLinkMergedPullRequest = useCallback((): void => {
    cancelLinkMergedPullRequest();
  }, [cancelLinkMergedPullRequest]);

  const { onOpenTaskDetails } = useRequiredTaskWorkflowActions();
  const openTaskDetails = useCallback((): void => {
    if (selectedTaskId) onOpenTaskDetails(selectedTaskId);
  }, [onOpenTaskDetails, selectedTaskId]);

  const mergedPullRequestModal = useAgentStudioPullRequestModalModel({
    pendingMergedPullRequest,
    linkingMergedPullRequestTaskId,
    onLinkMergedPullRequest,
    onCancelLinkMergedPullRequest,
  });

  return useMemo(
    () => ({
      openTaskDetails,
      mergedPullRequestModal,
      onDetectPullRequest,
    }),
    [mergedPullRequestModal, onDetectPullRequest, openTaskDetails],
  );
}
