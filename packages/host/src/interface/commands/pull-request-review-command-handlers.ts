import type { PullRequestReviewService } from "../../application/pull-requests/pull-request-review-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import { optionalString, requireRecord, requireStringPreservingWhitespace } from "./command-inputs";
import type { JsonValue } from "@openducktor/contracts";

const parsePullRequestReviewContextInput = (
  args: Record<string, JsonValue> | undefined,
): {
  repoPath: string;
  taskId?: string;
} => {
  const record = requireRecord(args, "pull_request_review_context_get input");
  const taskId = optionalString(record.taskId, "taskId");
  return {
    repoPath: requireStringPreservingWhitespace(record.repoPath, "repoPath"),
    ...(taskId ? { taskId } : {}),
  };
};

export const createPullRequestReviewCommandHandlers = (
  pullRequestReviewService: PullRequestReviewService,
): HostCommandHandlers => ({
  pull_request_review_context_get: (args) =>
    pullRequestReviewService.getContext(parsePullRequestReviewContextInput(args)),
});
