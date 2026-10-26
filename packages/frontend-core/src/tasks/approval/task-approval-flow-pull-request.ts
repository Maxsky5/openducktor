import type { TaskApprovalFlowReadyState } from "./task-approval-flow-state";
import type { HostClient } from "@openducktor/host-client";

type SubmitPullRequestApprovalArgs = {
  host: Pick<HostClient, "taskPullRequestUpsert">;
  approval: TaskApprovalFlowReadyState;
  repoPath: string;
  requestPullRequestGeneration: (taskId: string) => Promise<string | undefined>;
  refreshTasks: () => Promise<void>;
};

export type SubmitPullRequestApprovalResult =
  | { outcome: "generation_started" }
  | { outcome: "generation_cancelled" }
  | {
      outcome: "pull_request_created";
      pullRequest: Awaited<ReturnType<HostClient["taskPullRequestUpsert"]>>;
    };

export async function submitPullRequestApproval({
  host,
  approval,
  repoPath,
  requestPullRequestGeneration,
  refreshTasks,
}: SubmitPullRequestApprovalArgs): Promise<SubmitPullRequestApprovalResult> {
  if (approval.pullRequestDraftMode === "generate_ai") {
    const externalSessionId = await requestPullRequestGeneration(approval.taskId);
    return externalSessionId
      ? { outcome: "generation_started" }
      : { outcome: "generation_cancelled" };
  }

  const pullRequest = await host.taskPullRequestUpsert(
    repoPath,
    approval.taskId,
    approval.title,
    approval.body,
  );
  await refreshTasks();

  return {
    outcome: "pull_request_created",
    pullRequest,
  };
}
