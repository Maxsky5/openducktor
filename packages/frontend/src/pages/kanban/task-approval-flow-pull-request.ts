import { host } from "@/state/operations/shared/host";
import type { TaskApprovalFlowReadyState } from "./task-approval-flow-state";

type SubmitPullRequestApprovalArgs = {
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
      pullRequest: Awaited<ReturnType<typeof host.taskPullRequestUpsert>>;
    };

export async function submitPullRequestApproval({
  approval,
  repoPath,
  requestPullRequestGeneration,
  refreshTasks,
}: SubmitPullRequestApprovalArgs): Promise<SubmitPullRequestApprovalResult> {
  if (approval.pullRequestDraftMode === "generate_ai") {
    const sessionId = await requestPullRequestGeneration(approval.taskId);
    return sessionId ? { outcome: "generation_started" } : { outcome: "generation_cancelled" };
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
