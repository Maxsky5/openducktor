import type { PullRequestReviewService } from "../../application/pull-requests/pull-request-review-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import { optionalString, requireRecord, requireString } from "./command-inputs";

const parsePullRequestReviewContextInput = (
  args: Record<string, unknown> | undefined,
): {
  repoPath: string;
  taskId?: string;
  workingDirectory?: string;
} => {
  const record = requireRecord(args, "pull_request_review_context_get input");
  const taskId = optionalString(record.taskId, "taskId");
  const workingDirectory = optionalString(record.workingDirectory, "workingDirectory");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    ...(taskId ? { taskId } : {}),
    ...(workingDirectory ? { workingDirectory } : {}),
  };
};

export const createPullRequestReviewCommandHandlers = (
  pullRequestReviewService: PullRequestReviewService,
): HostCommandHandlers => ({
  pull_request_review_context_get: (args) =>
    pullRequestReviewService.getContext(parsePullRequestReviewContextInput(args)),
});
