import { type ComponentProps, useCallback, useMemo } from "react";
import type { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import type { useTasksState } from "@/state/app-state-provider";

type UseAgentStudioPullRequestModalModelArgs = {
  pendingMergedPullRequest: ReturnType<typeof useTasksState>["pendingMergedPullRequest"];
  linkingMergedPullRequestTaskId: ReturnType<
    typeof useTasksState
  >["linkingMergedPullRequestTaskId"];
  onLinkMergedPullRequest: () => Promise<void>;
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
  const handleConfirm = useCallback((): void => {
    void onLinkMergedPullRequest();
  }, [onLinkMergedPullRequest]);

  return useMemo(() => {
    if (!pendingMergedPullRequest) {
      return null;
    }

    return {
      pullRequest: pendingMergedPullRequest.pullRequest,
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
