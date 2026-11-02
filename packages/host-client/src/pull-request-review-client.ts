import {
  type PullRequestReviewContext,
  type WorkspaceRef,
  pullRequestReviewContextSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";

export class HostPullRequestReviewClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async pullRequestReviewContextGet(
    input: WorkspaceRef & {
      taskId?: string;
    },
  ): Promise<PullRequestReviewContext> {
    const request: WorkspaceRef & { taskId?: string } = {
      workspaceId: input.workspaceId,
      repoPath: input.repoPath,
    };
    if (input.taskId !== undefined) request.taskId = input.taskId;
    return this.invokeFn(
      "pull_request_review_context_get",
      request,
      pullRequestReviewContextSchema,
    );
  }
}
