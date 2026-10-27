import { type ComponentProps, useCallback, useMemo } from "react";
import type { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import type { useTasksState } from "@/state/app-state-provider";
import type { CloseTaskOptions } from "@openducktor/frontend-core/types/task-close";

type UseAgentStudioPullRequestModalModelArgs = {
  pendingMergedPullRequest: ReturnType<typeof useTasksState>["pendingMergedPullRequest"];
  linkingMergedPullRequestTaskId: ReturnType<
    typeof useTasksState
  >["linkingMergedPullRequestTaskId"];
  onLinkMergedPullRequest: (options: CloseTaskOptions) => Promise<void>;
  onCancelLinkMergedPullRequest: () => void;
};

export type AgentStudioPullRequestModalModel = ComponentProps<
  typeof MergedPullRequestConfirmDialog
>;

export function useAgentStudioPullRequestModalModel({
  pendingMergedPullRequest,
  linkingMergedPullRequestTaskId,
  onLinkMergedPullRequest,
  onCancelLinkMergedPullRequest,
}: UseAgentStudioPullRequestModalModelArgs): AgentStudioPullRequestModalModel | null {
  const handleConfirm = useCallback(
    (options: CloseTaskOptions): void => {
      void onLinkMergedPullRequest(options);
    },
    [onLinkMergedPullRequest],
  );

  return useMemo(() => {
    if (!pendingMergedPullRequest) {
      return null;
    }

    return {
      ...pendingMergedPullRequest,
      isLinking: pendingMergedPullRequest.taskId === linkingMergedPullRequestTaskId,
      onCancel: onCancelLinkMergedPullRequest,
      onConfirm: handleConfirm,
    };
  }, [
    handleConfirm,
    linkingMergedPullRequestTaskId,
    onCancelLinkMergedPullRequest,
    pendingMergedPullRequest,
  ]);
}
