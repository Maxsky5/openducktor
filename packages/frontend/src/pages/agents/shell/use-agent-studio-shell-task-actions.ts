import { useCallback, useMemo } from "react";
import type { useTasksState, useWorkspaceState } from "@/state/app-state-provider";
import {
  type AgentStudioPullRequestModalModel,
  useAgentStudioPullRequestModalModel,
} from "./use-agent-studio-pull-request-modal-model";
import {
  type AgentStudioTaskDetailsLauncherModel,
  useAgentStudioTaskDetailsLauncher,
} from "./use-agent-studio-task-details-launcher";

type UseAgentStudioShellTaskActionsArgs = {
  activeWorkspace: ReturnType<typeof useWorkspaceState>["activeWorkspace"];
  tasks: ReturnType<typeof useTasksState>["tasks"];
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
  taskDetailsLauncher: AgentStudioTaskDetailsLauncherModel;
  mergedPullRequestModal: AgentStudioPullRequestModalModel | null;
  onDetectPullRequest: (taskId: string) => void;
};

export function useAgentStudioShellTaskActions({
  activeWorkspace,
  tasks,
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

  const taskDetailsLauncher = useAgentStudioTaskDetailsLauncher({
    activeWorkspace,
    tasks,
    selectedTaskId,
  });

  const mergedPullRequestModal = useAgentStudioPullRequestModalModel({
    pendingMergedPullRequest,
    linkingMergedPullRequestTaskId,
    onLinkMergedPullRequest,
    onCancelLinkMergedPullRequest,
  });

  return useMemo(
    () => ({
      taskDetailsLauncher,
      mergedPullRequestModal,
      onDetectPullRequest,
    }),
    [mergedPullRequestModal, onDetectPullRequest, taskDetailsLauncher],
  );
}
