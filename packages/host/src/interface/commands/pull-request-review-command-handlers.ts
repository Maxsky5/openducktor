import type { PullRequestReviewService } from "../../application/pull-requests/pull-request-review-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputOptionalStringSchema,
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  optionalString,
  requireRecord,
  requireStringPreservingWhitespace,
} from "./command-inputs";

const parsePullRequestReviewContextInput = (
  args: HostCommandArgs,
): Parameters<PullRequestReviewService["getContext"]>[0] => {
  const record = requireRecord(
    commandInputRecordSchema.safeParse(args),
    "pull_request_review_context_get input",
  );
  const taskId = optionalString(
    commandInputOptionalStringSchema.safeParse(record.taskId),
    "taskId",
  );
  const input: Parameters<PullRequestReviewService["getContext"]>[0] = {
    repoPath: requireStringPreservingWhitespace(
      commandInputStringSchema.safeParse(record.repoPath),
      "repoPath",
    ),
  };
  if (taskId) input.taskId = taskId;
  return input;
};

export const createPullRequestReviewCommandHandlers = (
  pullRequestReviewService: PullRequestReviewService,
) =>
  ({
    pull_request_review_context_get: (args) =>
      pullRequestReviewService.getContext(parsePullRequestReviewContextInput(args)),
  }) satisfies HostCommandHandlerDefinitions;
