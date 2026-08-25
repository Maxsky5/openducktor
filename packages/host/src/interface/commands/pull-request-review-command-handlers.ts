import type { PullRequestReviewService } from "../../application/pull-requests/pull-request-review-service";
import { defineHostCommandHandlers } from "../router/host-command-router";
import { optionalString, requireRecord, requireStringPreservingWhitespace } from "./command-inputs";

const parsePullRequestReviewContextInput = (args: Record<string, unknown> | undefined) => {
  const record = requireRecord(args, "pull_request_review_context_get input");
  const taskId = optionalString(record.taskId, "taskId");
  return {
    repoPath: requireStringPreservingWhitespace(record.repoPath, "repoPath"),
    ...(taskId ? { taskId } : undefined),
  } satisfies {
    repoPath: string;
    taskId?: string;
  };
};

export const createPullRequestReviewCommandHandlers = (
  pullRequestReviewService: PullRequestReviewService,
) =>
  defineHostCommandHandlers({
    pull_request_review_context_get: (args) =>
      pullRequestReviewService.getContext(parsePullRequestReviewContextInput(args)),
  });
