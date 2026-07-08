import {
  type PullRequestReviewContext,
  pullRequestReviewContextSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";

export class HostPullRequestReviewClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async pullRequestReviewContextGet(input: {
    repoPath: string;
    taskId?: string;
    workingDirectory?: string;
  }): Promise<PullRequestReviewContext> {
    const payload = await this.invokeFn("pull_request_review_context_get", input);
    return pullRequestReviewContextSchema.parse(payload);
  }
}
