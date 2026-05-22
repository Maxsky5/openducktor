import type { AgentRole } from "@openducktor/core";
import { type ReactElement, useCallback, useRef } from "react";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import {
  TaskDetailsSheetController,
  type TaskDetailsSheetControllerHandle,
} from "@/components/features/task-details/task-details-sheet-controller";
import type { useTasksState, useWorkspaceState } from "@/state/app-state-provider";

type UseAgentsPageShellOverlaysArgs = {
  activeWorkspace: ReturnType<typeof useWorkspaceState>["activeWorkspace"];
  tasks: ReturnType<typeof useTasksState>["tasks"];
  selectedTaskId: string | null;
  pendingMergedPullRequest: ReturnType<typeof useTasksState>["pendingMergedPullRequest"];
  linkingMergedPullRequestTaskId: ReturnType<
    typeof useTasksState
  >["linkingMergedPullRequestTaskId"];
  detectingPullRequestTaskId: ReturnType<typeof useTasksState>["detectingPullRequestTaskId"];
  unlinkingPullRequestTaskId: ReturnType<typeof useTasksState>["unlinkingPullRequestTaskId"];
  onDetectPullRequest: (taskId: string) => void;
  onUnlinkPullRequest: (taskId: string) => void;
  onLinkMergedPullRequest: () => Promise<void>;
  onCancelLinkMergedPullRequest: () => void;
};

export type AgentsPageShellOverlaysModel = {
  openTaskDetails: () => void;
  mergedPullRequestModal: ReactElement | null;
  taskDetailsSheet: ReactElement;
};

const EMPTY_TASK_SESSIONS_BY_TASK_ID = new Map<string, KanbanTaskSession[]>();
const EMPTY_ACTIVE_TASK_SESSION_CONTEXT_BY_TASK_ID: ActiveTaskSessionContextByTaskId = new Map();

const noopOpenSession = (
  _taskId: string,
  _role: AgentRole,
  _options?: { externalSessionId?: string | null },
): void => {};

export function useAgentsPageShellOverlays({
  activeWorkspace,
  tasks,
  selectedTaskId,
  pendingMergedPullRequest,
  linkingMergedPullRequestTaskId,
  detectingPullRequestTaskId,
  unlinkingPullRequestTaskId,
  onDetectPullRequest,
  onUnlinkPullRequest,
  onLinkMergedPullRequest,
  onCancelLinkMergedPullRequest,
}: UseAgentsPageShellOverlaysArgs): AgentsPageShellOverlaysModel {
  const taskDetailsSheetRef = useRef<TaskDetailsSheetControllerHandle | null>(null);

  const openTaskDetails = useCallback((): void => {
    if (!selectedTaskId) {
      return;
    }
    taskDetailsSheetRef.current?.openTask(selectedTaskId);
  }, [selectedTaskId]);

  const mergedPullRequestModal = pendingMergedPullRequest ? (
    <MergedPullRequestConfirmDialog
      pullRequest={pendingMergedPullRequest.pullRequest}
      isLinking={pendingMergedPullRequest.taskId === linkingMergedPullRequestTaskId}
      onCancel={onCancelLinkMergedPullRequest}
      onConfirm={() => void onLinkMergedPullRequest()}
    />
  ) : null;

  const taskDetailsSheet = (
    <TaskDetailsSheetController
      ref={taskDetailsSheetRef}
      activeWorkspace={activeWorkspace}
      allTasks={tasks}
      taskSessionsByTaskId={EMPTY_TASK_SESSIONS_BY_TASK_ID}
      activeTaskSessionContextByTaskId={EMPTY_ACTIVE_TASK_SESSION_CONTEXT_BY_TASK_ID}
      workflowActionsEnabled={false}
      onOpenSession={noopOpenSession}
      onDetectPullRequest={onDetectPullRequest}
      onUnlinkPullRequest={onUnlinkPullRequest}
      detectingPullRequestTaskId={detectingPullRequestTaskId}
      unlinkingPullRequestTaskId={unlinkingPullRequestTaskId}
    />
  );

  return {
    openTaskDetails,
    mergedPullRequestModal,
    taskDetailsSheet,
  };
}
